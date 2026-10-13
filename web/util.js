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
