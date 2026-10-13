// Reads a pasted payment list: one "address, amount in ZEC, memo" per line. A spreadsheet copy
// works: tab, comma, semicolon or spaces may separate the fields. The memo is optional. It is
// everything after the amount, so it may hold spaces and commas. If the first line that is not
// empty names "address" in its address or amount field, it is a header and is skipped.
export function parsePayeeList(text) {
  const rows = [], errors = [];
  let first = true;
  String(text).split(/\r\n|\r|\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const [to, afterTo] = cut(line);
    const header = first && /address/i.test(to + " " + cut(afterTo)[0]);
    first = false;
    if (header) return;
    const r = payeeRow(to, afterTo);
    if (r.error) errors.push("Line " + (i + 1) + ": " + r.error);
    else rows.push(r.row);
  });
  return { rows, errors };
}

// One line, after its address: `{row}`, or `{error}`. A comma directly between digits could be a
// decimal comma ("1,5" is 1.5) or a field separator ("1,5 rent" is 1 and the memo "5 rent"). Either
// reading pays a wrong amount or writes a wrong memo, so the line is an error.
function payeeRow(to, afterTo) {
  const [amount, memo] = cut(afterTo), zat = toZat(amount), bad = memoError(memo);
  if (/^[\d.]+,\d/.test(afterTo.replace(/^[\s,;]+/, ""))) {
    return { error: "a comma between digits is not clear. Write the amount with a point, like 1.5, "
      + "or put a space after the comma." };
  }
  if (!to || zat === null) return { error: "write an address and an amount, like u1…, 0.5" };
  if (bad) return { error: bad };
  return { row: memo ? { to, amount: zat, memo } : { to, amount: zat } };
}

// The first field of `s` and the rest. A separator is a comma, a semicolon, a tab or spaces.
function cut(s) {
  const t = s.replace(/^[\s,;]+/, ""), m = /\s*[,;\t]\s*|\s+/.exec(t);
  return m ? [t.slice(0, m.index), t.slice(m.index + m[0].length)] : [t, ""];
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

// ZIP 302: a text memo holds at most 512 bytes of UTF-8.
export const MEMO_BYTES = 512;
export const memoBytes = (text) => new TextEncoder().encode(String(text ?? "")).length;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

// Why `memo` cannot go in a payment, or "" when it can. The engine checks the same rules.
export function memoError(memo) {
  const text = String(memo ?? ""), n = memoBytes(text);
  if (text.includes("\0")) return "The memo cannot contain a null character.";
  if (LONE_SURROGATE.test(text)) return "The memo has a character that is not valid text.";
  if (n <= MEMO_BYTES) return "";
  return "The memo is " + n + " bytes. The limit is " + MEMO_BYTES + " bytes.";
}

// Text from the chain comes from anyone. This replaces the characters that could hide or reorder
// other text (control characters and bidirectional marks) with U+FFFD. A new line stays.
const HIDING = new RegExp("[\\u0000-\\u0009\\u000b-\\u001f\\u007f-\\u009f\\u061c"
  + "\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]", "g");
export const memoShown = (text) => String(text ?? "").replace(HIDING, "\ufffd");

// The memo that the proposer wrote for a payee ("" for none), or null if it is not text.
const proposedMemo = (p) => p.memo == null ? "" : typeof p.memo === "string" ? p.memo : null;

// The memo that a decoded output of the engine carries ("" for none), or null when the engine
// could not read it or it is not text. A null never equals what the proposer wrote.
export const outputMemo = (line) => line.memo_status === "empty" ? ""
  : line.memo_status === "text" && typeof line.memo === "string" ? line.memo : null;

const sameTarget = (p, line, norm) => line.who === norm(p.to) && line.value === p.amount;
const sameMemo = (p, line) => {
  const want = proposedMemo(p), got = outputMemo(line);
  return want !== null && got !== null && want === got;
};

// Pairs each proposed payee with one decoded output of the same address, amount and memo.
// `norm` gives the canonical form of an address. Returns the rows with `ok`, and the decoded
// outputs that no payee claimed (`extra`). A row that is not `ok` but has `got` is paid with
// another memo; `got` is that memo ("" for none, null if unreadable).
export function pairPayees(payees, outputs, norm) {
  const left = [...outputs];
  const rows = payees.map((p) => ({ ...p, ok: false }));
  const claim = (test) => {
    const i = left.findIndex(test);
    return i >= 0 ? left.splice(i, 1)[0] : null;
  };
  for (const r of rows) r.ok = !!claim((l) => sameTarget(r, l, norm) && sameMemo(r, l));
  for (const r of rows.filter((x) => !x.ok)) {
    const l = claim((o) => sameTarget(r, o, norm));
    if (l) r.got = outputMemo(l);
  }
  return { rows, extra: left };
}

// The decoded outputs are the truth. Each one must be a proposed payee with the same amount and
// memo, and the proposal must list nothing else. `total` is the amount the proposal states.
export function allPaid(rows, extra, total) {
  if (!rows.length || extra.length || !rows.every((r) => r.ok)) return false;
  return rows.reduce((n, r) => n + r.amount, 0) === total;
}
