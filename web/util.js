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
