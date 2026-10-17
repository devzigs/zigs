// Pure helpers and the localStorage merge helpers. Imports no page module.
import { finite } from "./util.js";

export const J = (s) => JSON.parse(s);
export const S = (o) => JSON.stringify(o);

export const said = (e) => (e && e.message) || String(e);
export const isStr = (x) => typeof x === "string";

export const randomHex32 = () => {
  const b = new Uint8Array(32); crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
};

export function withTimeout(promise, ms, what) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(what + " did not answer in " + ms / 1000 + " s")), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

export const isObj = (x) => !!x && typeof x === "object";

// Each wallet has a message room: a store namespace of its own (CHAT.md). The wallet document
// names it in the sealed field "room". Each message is signed with its seat's Ed25519 key.
export const readLocal = (name) => {
  try { return { ...JSON.parse(localStorage.getItem(name) || "{}") }; } catch { return {}; }
};
export const writeLocal = (name, v) => { try { localStorage.setItem(name, S(v)); } catch { /* none */ } };
// Another tab may have saved too. Merge with its copy before writing: `keep` picks the value.
export function saveMerged(name, mine, keep) {
  for (const [k, v] of Object.entries(readLocal(name))) {
    mine[k] = Object.hasOwn(mine, k) ? keep(v, mine[k]) : v;
  }
  writeLocal(name, mine);
}
export const oldest = (stored) => stored;   // a pin keeps the value seen first
export const fmtZec = (zat) => Number.isFinite(zat) ? zecText(zat) + " ZEC" : "an unknown amount";
export const zecText = (zat) => ZEC_FMT.format(finite(zat) / 1e8);
export const short = (h, n = 10) => h ? h.slice(0, n) + "…" + h.slice(-6) : "";
export const ZEC_FMT = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 });
export const initials = (name) => String(name || "?").trim().split(/\s+/).map((w) => w[0]).join("")
  .slice(0, 2).toUpperCase() || "?";
export const when = (ms) => {
  const d = new Date(Number.isFinite(ms) ? ms : NaN);
  const fmt = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
  return isNaN(d) ? "" : d.toLocaleString(undefined, fmt);
};
export const up = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const elapsed = (ms) => { const sec = Math.max(0, Math.floor((Date.now() - (ms || Date.now())) / 1000)); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); };

export function about(sec) {
  if (sec >= 5400) return Math.round(sec / 3600) + " hours";
  const min = Math.max(1, Math.round(sec / 60));
  return min === 1 ? "1 minute" : min + " minutes";
}
