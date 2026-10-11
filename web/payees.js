// Reads a pasted payment list: one "address, amount in ZEC" per line. A spreadsheet copy works:
// tab, comma, semicolon or spaces may separate the two. If the first line that is not empty names
// "address", it is a header and is skipped.
export function parsePayeeList(text) {
  const rows = [], errors = [];
  let first = true;
  String(text).split(/\r\n|\r|\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const header = first && /address/i.test(line);
    first = false;
    if (header) return;
    const [to, amount, ...rest] = line.split(/\s*[,;\t]\s*|\s+/).filter(Boolean);
    const zat = toZat(amount);
    if (!to || rest.length || zat === null) errors.push("Line " + (i + 1) + ": write an address and an amount, like u1…, 0.5");
    else rows.push({ to, amount: zat });
  });
  return { rows, errors };
}

// The Zcash supply limit, 21 million ZEC, in zatoshis.
const MAX_MONEY = 21e14;

// "1.5" or "1,5" -> 150000000 zatoshis. Null unless it is a positive amount, at most MAX_MONEY,
// with at most 8 decimals.
export function toZat(s) {
  const m = /^(\d{1,8})(?:[.,](\d{1,8}))?$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const zat = Number(m[1]) * 1e8 + Number((m[2] || "").padEnd(8, "0"));
  return zat > 0 && zat <= MAX_MONEY ? zat : null;
}

// 150000000 -> "1.5"
export const zatText = (zat) => (zat / 1e8).toFixed(8).replace(/\.?0+$/, "");
