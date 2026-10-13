// Pure helpers for signed writes in version 3 wallets (PROTOCOL.md section 15). The engine builds
// the signed text (docPayload). Checked by web/test/signed.mjs.
import { validPk } from "./chat.js";

const FLAT = /^(?:seats|confirm|abort|dkg1|done|verify)\/([1-9]\d?)$/;
const DKG2 = /^dkg2\/([1-9]\d?)-[1-9]\d?$/;
const IN_SESSION = /^sessions\/[\w-]{1,64}\/(?:commits|shares)\/([1-9]\d?)$/;

// The seat that must have written the document at `rel`, a path below the wallet. A document that
// a seat signs as a whole has one writer: the seat in its name, or seat 1 (the creator) for the
// wallet document. undefined: `rel` is no such document.
export function writerOf(rel) {
  if (rel === "meta/wallet") return 1;
  const m = FLAT.exec(rel) || DKG2.exec(rel) || IN_SESSION.exec(rel);
  return m ? Number(m[1]) : undefined;
}

// The signed fields of a document that a seat signs as a whole: all but the signature itself.
export const docFields = (d) => Object.fromEntries(
  Object.entries(d).filter(([k]) => k !== "by" && k !== "sig"));

// A wallet has 2 to 7 signers, and an approval rule of at least 2 and at most all of them.
export const validShape = (n, t) => Number.isInteger(n) && n >= 2 && n <= 7
  && Number.isInteger(t) && t >= 2 && t <= n;

// A version 3 wallet keeps the first valid number of signers (n) and rule (t) that this device
// saw, in `pins` under "shape:<wallet id>" as "n/t". The group document has no signature, so a
// later value in the store never counts. Returns `fresh` (a new pin, for the caller to save) and
// `g`: the group document with the pinned n and t, and `shapeMoved` when the store shows others.
export function trustShape(pins, gid, g) {
  const key = "shape:" + gid;
  const fresh = !Object.hasOwn(pins, key) && validShape(g.n, g.t);
  if (fresh) pins[key] = g.n + "/" + g.t;
  const [n, t] = String(pins[key] ?? "").split("/").map(Number);
  if (!validShape(n, t)) return { fresh, g };
  return { fresh, g: { ...g, n, t, unreadable: false, shapeMoved: g.n !== n || g.t !== t } };
}

// "no" when the document cannot be right: `by` is no seat of the wallet (1 to `n`), or it is not
// the seat `need` (null: any seat may write it). "wait" when the key of the seat is not known yet
// and the seats may still load (`known` false). Else "check": verify with the pinned key `pk`.
export function writerCheck(by, need, n, pk, known) {
  if (!Number.isInteger(by) || by < 1 || by > n) return "no";
  if (need != null && by !== need) return "no";
  if (validPk(pk)) return "check";
  return known ? "no" : "wait";
}

// A session document has several writers. Each part has its own writer and signature, over only
// its own fields. The status and the progress marks are not signed. The signed PCZT, the proof and
// the sent transaction are signed by the seat that made them, and each needs the part before it.
export const PARTS = {
  proposal: {
    by: "by", sig: "sig",
    fields: ["payees", "note", "pool", "amount", "change", "fee", "noteValue", "pczt", "move",
      "createdAt"],
  },
  package: { by: "packageBy", sig: "packageSig", fields: ["package", "signers"] },
  // A part counts only when the part in `needs` counts.
  signed: { by: "signedBy", sig: "signedSig", fields: ["signed", "signatures"], needs: "package" },
  final: { by: "finalBy", sig: "finalSig", fields: ["final"], needs: "signed" },
  sent: {
    by: "sentBy", sig: "sentSig", fields: ["broadcastTxid", "broadcastAt"], needs: "final",
  },
  cancel: { by: "cancelBy", sig: "cancelSig", fields: ["error"], fixed: { status: "cancelled" } },
  failure: { by: "errorBy", sig: "errorSig", fields: ["error"] },
};

const has = (d, ...keys) => keys.some((k) => d[k] !== undefined);
// A part is there when the document holds any of its fields or its writer or signature. A lone
// `error` belongs to a cancel when the cancel has a writer, else to a failure.
const PRESENT = {
  proposal: () => true,
  package: (d) => has(d, "package", "signers", "packageBy", "packageSig"),
  signed: (d) => has(d, "signed", "signatures", "signedBy", "signedSig"),
  final: (d) => has(d, "final", "finalBy", "finalSig"),
  sent: (d) => has(d, "broadcastTxid", "broadcastAt", "sentBy", "sentSig"),
  cancel: (d) => has(d, "cancelBy", "cancelSig"),
  failure: (d) => has(d, "errorBy", "errorSig") || (has(d, "error") && !PRESENT.cancel(d)),
};

// The fields that part `name` signs, as the document holds them now.
export function partFields(name, d) {
  const out = {};
  for (const k of PARTS[name].fields) if (d[k] !== undefined) out[k] = d[k];
  return { ...out, ...PARTS[name].fixed };
}

// The fields of a new payment, as the proposer writes and signs them (the part "proposal").
// `t` is the answer of the engine for the transaction.
export const proposalFields = (payees, note, t, move, createdAt) => ({
  payees, note: note || null, pool: t.pool, amount: t.amount, change: t.change, fee: t.fee,
  noteValue: t.note_value, pczt: t.pczt, move, createdAt,
});

// The writer and signature fields of part `name`, for the part fields `fields` and the writer
// `seat`. `sign(signedFields)` returns the signature. Every writer of a session part goes through
// here, so what a writer signs is what the reader checks. A field that the part does not list
// would stay unsigned, so it is an error. The status and the progress marks go in apart.
export async function signPart(name, fields, seat, sign) {
  const p = PARTS[name], extra = Object.keys(fields).filter((k) => !p.fields.includes(k));
  if (extra.length) throw new Error("Unsigned field in the part " + name + ": " + extra.join(", "));
  return { [p.by]: seat, [p.sig]: await sign(partFields(name, fields)) };
}

function dropPart(ss, name) {
  const p = PARTS[name];
  for (const k of [...p.fields, p.by, p.sig]) delete ss[k];
}

// The state of a payment follows from its verified parts. The stored `status` counts only for
// "proving", a progress mark that has no signature.
function statusOf(stored, ok) {
  if (ok.cancel) return "cancelled";
  if (ok.failure) return "failed";
  if (ok.sent) return "broadcast";
  if (ok.final) return "complete";
  if (ok.signed) return stored === "proving" ? "proving" : "signed";
  return ok.package ? "signing" : "collecting";
}

function build(id, d, ok) {
  const ss = { ...d, id };
  for (const name of Object.keys(PARTS)) if (name !== "proposal" && !ok[name]) dropPart(ss, name);
  if (ok.cancel || ok.failure) ss.error = d.error;
  ss.status = statusOf(d.status, ok);
  return ss;
}

// The answer for one part: "yes", "no" or "wait". A part that builds on another waits for it, and
// is "no" when that one is not valid. A sent mark must name the txid of the final transaction.
const sentMatches = (d) => typeof d.broadcastTxid === "string"
  && d.final?.txid === d.broadcastTxid;
function askPart(name, d, check, verdict) {
  const need = PARTS[name].needs;
  if (need && verdict[need] !== "yes") return verdict[need] === "wait" ? "wait" : "no";
  if (name === "sent" && !sentMatches(d)) return "no";
  const p = PARTS[name];
  return check(name, d[p.by], d[p.sig], partFields(name, d));
}

// Reads a session document. `check(name, by, sig, fields)` answers "yes", "no" or "wait" for one
// part. A session with no valid proposal is dropped (`ss` null). Another part that is not valid
// is taken out of it. `bad` names the parts that failed, and `wait` counts the unanswered ones.
export function readSession(id, d, check) {
  const res = { ss: null, bad: [], wait: 0 };
  const ok = {}, verdict = {};
  for (const name of Object.keys(PARTS)) {
    if (!PRESENT[name](d)) continue;
    const v = verdict[name] = askPart(name, d, check, verdict);
    ok[name] = v === "yes";
    if (v === "no") res.bad.push(name);
    else if (v === "wait") res.wait++;
    if (name === "proposal" && !ok.proposal) return res;
  }
  res.ss = build(id, d, ok);
  return res;
}

// Counts one answer in `t` ({ bad, wait, onBad }). Returns true for a document that may be used.
function count(t, what, verdict) {
  if (verdict === "no") { t.bad++; t.onBad(what); }
  else if (verdict === "wait") t.wait++;
  return verdict === "yes";
}

// The sessions of `entries` ([id, document] pairs) whose proposal verifies, each without the parts
// that do not. `check(rel, by, sig, fields, need)` answers "yes", "no" or "wait".
export function readSessions(entries, check, t) {
  const out = [];
  for (const [id, d] of entries) {
    const rel = "sessions/" + id;
    const res = readSession(id, d, (_, by, sig, fields) => check(rel, by, sig, fields, null));
    t.wait += res.wait;
    for (const part of res.bad) count(t, rel + " " + part, "no");
    if (res.ss) out.push(res.ss);
  }
  return out;
}

// What the page may use of the stored documents of one wallet (`raw`, as the page keeps them) and
// of the open session `sid` (or null). A document that is not valid is left out, and one that
// waits for its result is left out for now. Returns the collections, `bad` (how many documents
// were ignored) and `wait` (how many wait). `onBad(what)` hears each ignored document. The
// approvals and shares count only for the open payment, because the page loads only those.
export function filterWallet(raw, sid, check, onBad) {
  const t = { bad: 0, wait: 0, onBad };
  const whole = (map, prefix) => {
    const out = {};
    for (const [id, d] of Object.entries(map)) {
      const rel = prefix + id, need = writerOf(rel);
      const verdict = need === undefined ? "no" : check(rel, d.by, d.sig, docFields(d), need);
      if (count(t, rel, verdict)) out[id] = docFields(d);
    }
    return out;
  };
  const inSession = (name) => sid ? whole(raw[name], "sessions/" + sid + "/" + name + "/") : {};
  const docs = {};
  for (const name of ["seats", "dkg1", "dkg2", "confirm", "abort", "done", "verify"]) {
    docs[name] = whole(raw[name], name + "/");
  }
  docs.wallet = raw.wallet ? whole({ wallet: raw.wallet }, "meta/").wallet ?? null : null;
  docs.commits = inSession("commits");
  docs.shares = inSession("shares");
  const sessions = readSessions(Object.entries(raw.sessions), check, t);
  return { docs, sessions, bad: t.bad, wait: t.wait };
}

// A bounded memo of signature checks. The key names the document (wallet, path, writer and
// signature, all short). An entry also keeps the signed text and the public key, and answers only
// for the same ones: another text, even of the same length, is a new check. Past `maxEntries` or
// `maxChars` of kept text the memo drops its oldest finished entries. An entry that still runs
// stays, so the memo never checks one document twice at once.
// ponytail: a store with more than `maxChars` of signed documents makes the page check some of
// them again on every pass. The tab holds that store in memory anyway. Upgrade path: keep a
// SHA-256 digest of the text, not the text.
// `start(entry)` runs a new check and sets `entry.ok` (true or false) when it ends.
export function makeMemo(maxEntries = 4000, maxChars = 32e6) {
  const map = new Map();
  let chars = 0;
  const forget = (key, entry) => { map.delete(key); chars -= entry.fields.length; };
  const trim = (room) => {
    for (const [key, entry] of map) {
      if (map.size < maxEntries && chars + room <= maxChars) return;
      if (entry.ok !== null) forget(key, entry);
    }
  };
  return {
    ask(key, fields, pk, start) {
      const old = map.get(key);
      if (old && old.fields === fields && old.pk === pk) return old.ok;
      if (old) forget(key, old);
      trim(fields.length);
      const entry = { fields, pk, ok: null };
      map.set(key, entry);
      chars += fields.length;
      start(entry);
      return entry.ok;
    },
    get size() { return map.size; },
    get chars() { return chars; },
  };
}

// The one line that the wallet page shows when it ignored a document.
export const IGNORED_NOTE = "Some data in this wallet was not signed by a signer. Zigs ignored it.";
