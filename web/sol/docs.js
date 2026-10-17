// The Solana documents of a wallet (ZOLANA.md 3.2) and their reader. The group server accepts a
// document only at a path with an even number of segments, so the names are flat (`soldkg1/<i>`).
// web/signed.js stays as it is: its reader knows no Solana name, so this file reads them. A seat
// signs each document as a whole, as in signed.js.
import { docFields } from "../signed.js";

// The collections of whole documents. `solsessions` has its own reader (sessions.js): its
// documents have several writers, and the commits and shares below each one are read per session.
export const COLLECTIONS = ["solstart", "soldkg1", "soldkg2", "soldone", "solfee", "solabort"];

// Devnet is the only cluster of the beta. A testnet wallet gets it, a mainnet wallet gets none.
export const CLUSTER = "devnet";

const START = /^solstart\/(1)$/;
const FLAT = /^(?:soldkg1|soldone|solfee|solabort)\/([1-9]\d?)$/;
const DKG2 = /^soldkg2\/([1-9]\d?)-[1-9]\d?$/;
const IN_SESSION = /^solsessions\/[\w-]{1,64}\/(?:commits|shares)\/([1-9]\d?)$/;

/** The seat that must have written the document at `rel`, or undefined: `rel` is no such path. */
export function writerOf(rel) {
  const m = START.exec(rel) || FLAT.exec(rel) || DKG2.exec(rel) || IN_SESSION.exec(rel);
  return m ? Number(m[1]) : undefined;
}

/**
 * The documents of the collection `prefix` (`map`: { id: document }) that a seat of the wallet
 * signed. `check(rel, by, sig, fields, need)` answers "yes", "no" or "wait" (checkIn).
 * A document that is not valid is left out, and `onBad(rel)` hears it. One that waits for its
 * result is left out for now and counted in `wait`.
 */
export function readDocs(prefix, map, check, onBad) {
  const docs = {};
  let bad = 0,
    wait = 0;
  for (const [id, d] of Object.entries(map ?? {})) {
    const rel = prefix + "/" + id,
      need = writerOf(rel);
    const verdict = need === undefined ? "no" : check(rel, d.by, d.sig, docFields(d), need);
    if (verdict === "yes") docs[id] = docFields(d);
    else if (verdict === "wait") wait++;
    else {
      bad++;
      onBad(rel);
    }
  }
  return { docs, bad, wait };
}

/** `readDocs` for every collection of COLLECTIONS in `raw` ({ name: { id: document } }). */
export function filterSol(raw, check, onBad) {
  const docs = {};
  let bad = 0,
    wait = 0;
  for (const name of COLLECTIONS) {
    const found = readDocs(name, raw[name], check, onBad);
    docs[name] = found.docs;
    bad += found.bad;
    wait += found.wait;
  }
  return { docs, bad, wait };
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** The base58 text of a byte string given as hex (the Solana address of a 32 byte key). */
export function base58(hex) {
  let n = BigInt("0x" + hex),
    out = "";
  for (; n > 0n; n /= 58n) out = BASE58[Number(n % 58n)] + out;
  return "1".repeat(/^(?:00)*/.exec(hex)[0].length / 2) + out;
}

/** The 32 byte key (hex) of a Solana address, or null when the text is not exactly one. */
export function keyOfBase58(text) {
  if (typeof text !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text)) return null;
  let n = 0n;
  for (const ch of text) n = n * 58n + BigInt(BASE58.indexOf(ch));
  const body = n === 0n ? "" : n.toString(16);
  const hex = "00".repeat(/^1*/.exec(text)[0].length) + (body.length % 2 ? "0" : "") + body;
  return hex.length === 64 ? hex : null;
}
