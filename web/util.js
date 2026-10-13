// Pure helpers for the web app. Checked by web/test/util.mjs.

// "abcdefgh" -> ["abcde", "fgh"]. The page shows each group in its own span, so no space is ever
// part of a copied address.
export function chunks(text, n = 5) {
  const s = String(text ?? ""), out = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out;
}

// Numbers in documents from other signers are untrusted. A bad one shows as "unknown".
export const fmtInt = (x) => Number.isFinite(x) ? x.toLocaleString("en-US") : "unknown";
export const finite = (x) => Number.isFinite(x) ? x : 0;

// JSON text with sorted object keys, so equal values give equal text.
export function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

// True when every package (a JSON string or a value) is present, parses, and equals the others.
export function samePackages(list) {
  if (!list.length || list.some((p) => p == null)) return false;
  try {
    const texts = list.map((p) => canonical(typeof p === "string" ? JSON.parse(p) : p));
    return texts.every((t) => t === texts[0]);
  } catch { return false; }
}

// Wallet document version: 1 when the document has none, 2 for the ZIP 2005 ceremony, 0 for a
// version this app does not know.
export const walletVersion = (g) =>
  g.version === undefined || g.version === 1 ? 1 : g.version === 2 ? 2 : 0;

// Seats whose confirm document holds another safety number than `number`.
export function numberClash(number, docs, ids) {
  return ids.filter((i) => {
    const doc = docs[i];
    return doc && typeof doc.number === "string" && doc.number !== number;
  });
}

// May the key ceremony of a version 2 wallet run? "ok" when this seat and every seat confirmed
// `number`; "mismatch" when a seat confirmed another number; else "wait". `mine` is the number the
// person confirmed on this device: a confirm document alone is only a claim.
export function confirmGate(number, mine, docs, ids) {
  if (!number) return "wait";
  if (numberClash(number, docs, ids).length) return "mismatch";
  const all = ids.every((i) => docs[i] && docs[i].number === number);
  return all && mine === number ? "ok" : "wait";
}

// What a seat keeps when its setup ends: the reason as one sentence, then what to do.
export function abortText(reason) {
  const msg = String(reason || "Setup failed").replace(/\.+$/, "");
  return msg.charAt(0).toUpperCase() + msg.slice(1)
    + ". Do not use this wallet. Create a new wallet.";
}

// The wallet document must name the network its group runs on. Else a rewritten document could
// show an address of another network.
export function checkNetwork(wallet, network) {
  if (wallet.network !== network) {
    throw new Error("The wallet names another network than its group. Do not use this wallet.");
  }
}

// Why a seat must end its setup for good, or null. `s` is the seat secret, `seat` the seat
// document in the store, `g` the version of the wallet document, `mode` the ceremony of the seat,
// and `seen` what the store shows: `sawV2` (data of the version 2 ceremony) and `number` (the
// safety number now, or null).
const versionMoved = (s, g) => s.version && s.version !== g
  && "The setup version of this wallet changed after you took your seat";
const newSetupSeen = (s, mode, seen) => mode === 1 && !s.keyPackage && seen.sawV2
  && "Other signers use the new setup, but this seat does not";
const keyReplaced = (s, mode, seat) => mode === 2 && s.boxPk && seat && seat.boxPk !== s.boxPk
  && "Your seat key was replaced";
const numberMoved = (s, mode, seen) => mode === 2 && !s.keyPackage
  && typeof s.confirmed === "string" && typeof seen.number === "string"
  && s.confirmed !== seen.number
  && "The safety number changed after you confirmed it. Someone may have replaced a seat";
export const conflictReason = (s, seat, g, mode, seen) =>
  versionMoved(s, g) || newSetupSeen(s, mode, seen) || keyReplaced(s, mode, seat)
  || numberMoved(s, mode, seen) || null;

// ───────────── Encrypted backups ─────────────
// Both apps normalize a passphrase to Unicode NFC, count it in Unicode scalar values and never
// trim it, so one passphrase opens a backup in either app, whatever keyboard typed it. The engine
// enforces the same minimums and does not normalize.
export const PASS_MIN = 16;
export const PASS_DISTINCT = 8;
export const passNormal = (s) => String(s).normalize("NFC");
export const passLength = (s) => [...String(s)].length;

// Why the passphrase cannot be used yet, as one sentence, or "" when it can.
export function passIssue(pass, again) {
  const a = passNormal(pass);
  const n = passLength(a), different = new Set(a).size;
  if (n < PASS_MIN) return "Use at least " + PASS_MIN + " characters (" + n + " so far).";
  if (different < PASS_DISTINCT) {
    return "Use at least " + PASS_DISTINCT + " different characters (" + different
      + " so far), or choose Make a passphrase for me.";
  }
  if (!again) return "Type or paste the passphrase again to confirm it.";
  return a === passNormal(again) ? "" : "The two passphrases are not the same.";
}

// The fields of a seat secret that a restore takes from a file. The others (wallet checks, aborts,
// setup state) are claims of whoever made the file, so this device makes its own. A restore never
// takes `uid` or `nonces` either.
export const RESTORE_FIELDS = ["keyPackage", "publicKeyPackage", "groupKey", "vaultSk", "boxSk",
  "boxPk", "signSk", "signPk", "version", "room"];
export const restoredFields = (secret) => Object.fromEntries(
  RESTORE_FIELDS.filter((k) => Object.hasOwn(secret, k)).map((k) => [k, secret[k]]));

// The version and the room of a file wait for the wallet document (settledFields). The key pairs
// wait for the published keys of the seat (takenKeys).
const LATE_FIELDS = ["version", "room"];
const holdsShare = (held) => !!held && shareShape(held.keyPackage);

// What a restore stores at once. A device that holds a key share for the seat takes no field of
// the file: it keeps what it holds, and a copied share cannot add other secret values.
export function restoredSecret(file, held) {
  if (holdsShare(held)) return restoredFields(held);
  return split(withoutKeys(restoredFields(file)), LATE_FIELDS, false);
}

// The fields of the file that a restore holds back until the seat fits the wallet.
export const lateFields = (file, held) =>
  holdsShare(held) ? {} : split(restoredFields(file), LATE_FIELDS, true);

const roomShape = (r) => !!r && typeof r.id === "string" && typeof r.key === "string";
const sameRoom = (a, b) => roomShape(a) && roomShape(b) && a.id === b.id && a.key === b.key;

// What to store of the late fields once the seat fits. A field of the file counts only when it
// equals the wallet's own value (`version` of the wallet document, its `room`). The stored value
// is the wallet's.
export function settledFields(late, version, room) {
  const out = {};
  if ([1, 2].includes(version) && late.version === version) out.version = version;
  if (sameRoom(late.room, room)) out.room = { id: room.id, key: room.key };
  return out;
}

// A key package names its share by identifier and verifying share.
export const shareShape = (kp) => !!kp && typeof kp === "object"
  && typeof kp.identifier === "string" && typeof kp.verifying_share === "string";
export const sameShare = (a, b) => shareShape(a) && shareShape(b)
  && a.identifier === b.identifier && a.verifying_share === b.verifying_share;

export const LINK_NEW_SECRET = "This invite link has a different wallet secret for a wallet you "
  + "already have, so it was ignored.";
export const LINK_CHAT_ID = "This invite link uses the id of a chat or message room that you have, "
  + "so it was ignored.";

// Why an invite link is ignored, or null. A link must not replace the wallet secret `known` of
// the id: whoever knows the id could point the wallet at documents sealed with their own key. It
// must not store a wallet secret under the id of a chat or message room (`isChat`) either.
export function linkRefusal(known, key, isChat) {
  if (known && known !== key) return LINK_NEW_SECRET;
  return isChat ? LINK_CHAT_ID : null;
}

// The key of a seat secret, and of a restore that waits for its seat.
export const skey = (gid, seat) => gid + ":" + seat;

// FROST identifiers are the seat number as a 32-byte little-endian scalar, in hex.
export const frostId = (i) => i.toString(16).padStart(2, "0") + "0".repeat(62);

// The share of identifier `id` in a published key package (JSON text), or undefined.
function publishedShare(done, id) {
  try { return (JSON.parse(done.publicKeyPackage).verifying_shares || {})[id]; } catch {
    return undefined;
  }
}

// A restored seat must hold the key data that the wallet published for it in its done document
// `done`: the share, the public key package and the group key. All three must equal. The version 2
// setup secret is checked apart, against the wallet document.
export function fitsPublished(seat, secret, done) {
  const kp = secret.keyPackage;
  if (!shareShape(kp) || !done || kp.identifier !== frostId(seat)) return false;
  if (!samePackages([secret.publicKeyPackage, done.publicKeyPackage])) return false;
  const sameKey = typeof secret.groupKey === "string" && secret.groupKey === done.groupKey;
  return sameKey && publishedShare(done, kp.identifier) === kp.verifying_share;
}

// The key pairs of a seat. A restore takes a pair from a file only when the secret key makes the
// public key that the seat published.
export const KEY_PAIRS = { box: ["boxSk", "boxPk"], sign: ["signSk", "signPk"] };
const KEY_FIELDS = Object.values(KEY_PAIRS).flat();
// The entries of `obj` whose name is in `names` (`inside` true), or those whose name is not.
const split = (obj, names, inside) => Object.fromEntries(
  Object.entries(obj).filter(([k]) => names.includes(k) === inside));
export const withoutKeys = (secret) => split(secret, KEY_FIELDS, false);
export const keysOf = (secret) => split(secret, KEY_FIELDS, true);

// The fields to add to the seat secret `held` for the pairs in `good` (names in KEY_PAIRS): the
// secret key of the file and the published public key. A pair that the seat holds already wins.
export function takenKeys(file, held, good, published) {
  const out = {};
  for (const name of good) {
    const [sk, pk] = KEY_PAIRS[name];
    if (!held[sk] && !held[pk]) Object.assign(out, { [sk]: file[sk], [pk]: published[pk] });
  }
  return out;
}

// True when the X25519 secret key `sk` makes the public key `pk`. `Z` is the engine: a box that
// one side seals to `pk` opens with `sk` only when they belong together.
export function boxPairMatches(Z, sk, pk) {
  try {
    const other = JSON.parse(Z.boxKeypair());
    return Z.boxOpen(sk, other.pk, "pair", Z.boxSeal(other.sk, pk, "pair", "ok")) === "ok";
  } catch { return false; }
}

// How to undo a restore, from the seat secret `before` it: "remove" when the seat held nothing,
// else "keep". A seat that held a key share keeps it, because the old copy has old nonces. A seat
// that held a secret without a key share takes no restore (heldRefusal).
export const undoPlan = (before) => before ? "keep" : "remove";

export const SETUP_HELD = "This seat is still being set up on this device. Finish setup, or "
  + "remove the seat first.";

// Why the seat secret `held` blocks a restore of the key share `file` for `seat`, or null. A seat
// in setup holds secrets but no key share. A restore would take its data from the file at once.
export function heldRefusal(held, file, seat) {
  if (!held) return null;
  if (!shareShape(held.keyPackage)) return SETUP_HELD;
  return sameShare(held.keyPackage, file) ? null
    : "This browser holds another key share for seat " + seat + " of this wallet, so the backup "
      + "was not restored.";
}

// Is the seat with the document `seat` this browser's? A restored seat (`restored` in its secret)
// counts only while its key data fits the wallet: `fit()` is true. The identity of the seat does
// not count then, because the secret can hold an identity that a restore recorded.
export function seatOwned(seat, secret, me, fit) {
  if (!seat) return false;
  if (secret.restored) return fit() === true;
  return !!seat.uid && (seat.uid === me || seat.uid === secret.uid);
}

// A restored seat secret that the wallet does not confirm (`fit()` is false), and that no restore
// that waits will settle. It is no seat of this browser (seatOwned).
export const staleRestore = (held, fit, waiting) => !!held && !!held.restored && !waiting
  && fit() === false;

// 30 random bytes give 30 symbols of 5 bits (150 bits), shown as 6 groups of 5. The alphabet has
// no i, l, o or u. `b & 31` keeps every symbol equally likely.
const PASS_SYMBOLS = "0123456789abcdefghjkmnpqrstvwxyz";
export function makePassphrase(bytes) {
  if (bytes.length !== 30) throw new Error("A generated passphrase needs 30 random bytes.");
  return chunks(Array.from(bytes, (b) => PASS_SYMBOLS[b & 31]).join(""), 5).join("-");
}

// "zigs-<wallet>-seat-<i>.zigsbackup", with any run of other characters in the name as one "-".
export function backupName(wallet, seat) {
  const name = String(wallet ?? "").replace(/\W+/g, "-").replace(/^-+|-+$/g, "") || "wallet";
  return "zigs-" + name + "-seat-" + seat + ".zigsbackup";
}

// Engine calls that are slow enough to run in a worker (web/worker.js), or on the main thread when
// no worker starts. `Z` is the engine module. finalize returns its parsed result with its time in
// ms; the backup calls return the engine's text.
const SLOW = {
  finalize: (Z, pczt) => {
    const t0 = performance.now();
    const out = JSON.parse(Z.finalize(pczt));
    out.ms = Math.round(performance.now() - t0);
    return out;
  },
  backupSeal: (Z, pass, plain) => Z.backupSeal(passNormal(pass), plain),
  backupOpen: (Z, pass, sealed) => Z.backupOpen(passNormal(pass), sealed),
};
export function slowCall(Z, method, args) {
  if (!Object.hasOwn(SLOW, method)) throw new Error("Unknown engine call: " + method);
  return SLOW[method](Z, ...args);
}
