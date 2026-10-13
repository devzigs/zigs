// Checks the payment list parser. Run: node web/test/payees.mjs
import assert from "node:assert/strict";
import {
  allPaid, MEMO_BYTES, memoBytes, memoError, memoShown, outputMemo, pairPayees, parsePayeeList,
  toZat, zatText,
} from "../payees.js";

assert.equal(toZat("1.5"), 150000000);
assert.equal(toZat("0.29"), 29000000);
assert.equal(toZat("0.00000001"), 1);
assert.equal(toZat(" 2 "), 200000000);
assert.equal(toZat("1,5"), 150000000);
assert.equal(toZat("21000000"), 21e14);
assert.equal(toZat("21000000.00000001"), null);
for (const bad of ["0", "0.0", "", "1.123456789", "-1", "1e3", "1.5.1", "123456789", "abc", ".5", undefined]) assert.equal(toZat(bad), null, String(bad));
assert.equal(zatText(150000000), "1.5");
assert.equal(zatText(200000000), "2");
assert.equal(zatText(1), "0.00000001");

const sheet = "Address\tAmount\nu1aaa\t0.5\r\nu1bbb\t1\n\n  u1ccc , 0.25 \nu1ddd; 2\nu1eee 3";
assert.deepEqual(parsePayeeList(sheet), { rows: [
  { to: "u1aaa", amount: 50000000 }, { to: "u1bbb", amount: 100000000 }, { to: "u1ccc", amount: 25000000 },
  { to: "u1ddd", amount: 200000000 }, { to: "u1eee", amount: 300000000 }], errors: [] });

const r = parsePayeeList("u1aaa, 0.5\nAlice, u1bbb, 1\nu1ccc\nu1ddd, 0\nu1eee, 1,");
assert.deepEqual(r.rows, [{ to: "u1aaa", amount: 50000000 }, { to: "u1eee", amount: 100000000 }]);
assert.deepEqual(r.errors.map((e) => e.split(":")[0]), ["Line 2", "Line 3", "Line 4"]);
assert.deepEqual(parsePayeeList("address is here, 1"), { rows: [], errors: [] }, "a first line naming address is a header");
assert.deepEqual(parsePayeeList("\n Address,Amount\ru1aaa,1\ru1bbb\u00a02").rows, [{ to: "u1aaa", amount: 100000000 }, { to: "u1bbb", amount: 200000000 }], "lone CR, NBSP and a header after a blank line");

// The third column is a memo: everything after the amount, with its spaces and commas.
const memos = parsePayeeList("Address, Amount, Memo\n"
  + "u1aaa, 0.5, October rent, part 1\nu1bbb\t1\tpaid  twice\n"
  + "u1ccc 2 hello there\nu1ddd;3;\nu1eee, 4, ");
assert.deepEqual(memos, { rows: [
  { to: "u1aaa", amount: 50000000, memo: "October rent, part 1" },
  { to: "u1bbb", amount: 100000000, memo: "paid  twice" },
  { to: "u1ccc", amount: 200000000, memo: "hello there" },
  { to: "u1ddd", amount: 300000000 }, { to: "u1eee", amount: 400000000 }], errors: [] });
// A comma directly between digits is unclear, so the line is an error and pays nothing.
for (const line of ["u1x, 1,5", "u1x\t1,5", "u1bbb;2,25;rent", "u1aaa,1,2025 rent", "u1x 1,5",
  "u1x, 1.5,3", "u1x\t0,5\tmemo", "u1x,,1,5", "u1x;;1,5", "u1x, ,1,5", "u1x,\t,1,5"]) {
  const got = parsePayeeList(line);
  assert.deepEqual(got.rows, [], line);
  assert.match(got.errors[0], /^Line 1: a comma between digits is not clear/, line);
}
assert.deepEqual(parsePayeeList("u1x, 1, 2025 rent\nu1y;2;5,5 euros").rows, [
  { to: "u1x", amount: 100000000, memo: "2025 rent" },
  { to: "u1y", amount: 200000000, memo: "5,5 euros" }], "a space after the comma is a memo");
const first = parsePayeeList("u1aaa, 1, new address for rent");
assert.deepEqual(first.rows, [{ to: "u1aaa", amount: 100000000, memo: "new address for rent" }],
  "a memo that says address does not make the first line a header");
assert.deepEqual(parsePayeeList("u1aaa, nope, memo").rows, [], "a bad amount is still an error");
assert.equal(parsePayeeList("u1aaa, 1, " + "a".repeat(MEMO_BYTES)).errors.length, 0);
const long = parsePayeeList("u1aaa, 1\nu1bbb, 1, " + "é".repeat(257));
assert.deepEqual([long.rows.length, long.errors.length], [1, 1]);
assert.match(long.errors[0], /^Line 2: The memo is 514 bytes\. The limit is 512 bytes\.$/);

// The memo rules.
assert.equal(memoBytes("é✓😀"), 2 + 3 + 4);
assert.equal(memoBytes(undefined), 0);
assert.equal(memoError(""), "");
assert.equal(memoError("é".repeat(256)), "");
assert.match(memoError("é".repeat(256) + "a"), /513 bytes/);
assert.match(memoError("a\0b"), /null character/);
assert.match(memoError("a\ud800"), /not valid text/);
assert.match(memoError("\udc00a"), /not valid text/);
assert.equal(memoError("😀"), "", "a surrogate pair is a valid character");
assert.equal(memoShown("a\nb\tc"), "a\nb\ufffdc", "a new line stays, a tab goes");
assert.equal(memoShown("pay\u202eevil\u0007\u2066x"), "pay\ufffdevil\ufffd\ufffdx");
assert.equal(memoShown("héllo ✓ 😀"), "héllo ✓ 😀");

// The recipient check with memos: the decoded outputs are the truth.
const norm = (a) => a.toLowerCase();
const out = (who, value, status = "empty", memo) => ({
  kind: "output", who, value, memo_status: status, ...(memo === undefined ? {} : { memo }),
});
const A = "utest1a", B = "utest1b";
assert.equal(outputMemo(out(A, 1)), "");
assert.equal(outputMemo(out(A, 1, "text", "hi")), "hi");
const unreadable = [
  out(A, 1, "not_text"), out(A, 1, "unknown"), out(A, 1, "text"), { who: A, value: 1 },
];
for (const line of unreadable) {
  assert.equal(outputMemo(line), null, JSON.stringify(line));
}
const pair = (payees, outputs) => pairPayees(payees, outputs, norm);
let pr = pair([{ to: "UTEST1A", amount: 5, memo: "rent" }, { to: B, amount: 7 }],
  [out(B, 7), out(A, 5, "text", "rent")]);
assert.deepEqual(pr.rows.map((x) => x.ok), [true, true]);
assert.equal(pr.extra.length, 0);
assert.equal(allPaid(pr.rows, pr.extra, 12), true);
assert.equal(allPaid(pr.rows, pr.extra, 13), false, "the amounts must add up");
// No memo proposed means no memo in the transaction. "" and null and a missing field are alike.
for (const memo of [undefined, null, ""]) {
  assert.equal(pair([{ to: A, amount: 5, memo }], [out(A, 5)]).rows[0].ok, true);
  assert.equal(pair([{ to: A, amount: 5, memo }], [out(A, 5, "text", "sneaky")]).rows[0].ok, false);
}
// Any difference in the memo is a difference.
for (const [proposed, line] of [
  ["rent", out(A, 5)], ["rent", out(A, 5, "text", "Rent")], ["rent", out(A, 5, "text", "rent ")],
  ["rent", out(A, 5, "not_text")], ["rent", out(A, 5, "unknown")], ["", out(A, 5, "unknown")],
  [undefined, out(A, 5, "unknown")], [undefined, out(A, 5, "not_text")],
  [7, out(A, 5, "text", "7")],
  [{}, out(A, 5)], [["x"], out(A, 5, "text", "x")],
]) {
  pr = pair([{ to: A, amount: 5, memo: proposed }], [line]);
  assert.equal(pr.rows[0].ok, false, JSON.stringify([proposed, line]));
  assert.equal(allPaid(pr.rows, pr.extra, 5), false);
  assert.equal(pr.extra.length, 0, "it pays the proposed address and amount, so it is not extra");
  assert.equal(pr.rows[0].got, outputMemo(line));
}
// Same address and amount, other memos: each payee takes its own output, in any order.
pr = pair([{ to: A, amount: 5, memo: "x" }, { to: A, amount: 5, memo: "y" }],
  [out(A, 5, "text", "y"), out(A, 5, "text", "x")]);
assert.deepEqual(pr.rows.map((x) => x.ok), [true, true]);
pr = pair([{ to: A, amount: 5, memo: "x" }, { to: A, amount: 5, memo: "x" }],
  [out(A, 5, "text", "x"), out(A, 5, "text", "y")]);
assert.deepEqual(pr.rows.map((x) => [x.ok, x.got]), [[true, undefined], [false, "y"]]);
// An output that nobody proposed, and a proposal that nothing pays.
pr = pair([{ to: A, amount: 5 }], [out(A, 5), out(B, 1)]);
assert.deepEqual([pr.rows[0].ok, pr.extra.map((x) => x.who)], [true, [B]]);
assert.equal(allPaid(pr.rows, pr.extra, 5), false);
pr = pair([{ to: A, amount: 5 }, { to: B, amount: 1 }], [out(A, 5)]);
assert.deepEqual([pr.rows[1].ok, pr.rows[1].got], [false, undefined]);
assert.equal(allPaid([], [], 0), false, "a proposal with no recipients matches nothing");
console.log("payees.js ok");
