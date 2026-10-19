// Checks the payment request helpers against the real engine. Run: node web/test/requests.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as Z from "../pkg/zigs_engine.js";
import {
  cardState, oneLine, payeeBlocker, payeeRows, quoted, readRequest, REQUEST_NET, requestNote,
  requestPayees, requestProblem, requestUri,
} from "../requests.js";
import { parsePayeeList } from "../payees.js";

Z.initSync({ module: readFileSync(new URL("../pkg/zigs_engine_bg.wasm", import.meta.url)) });

const A = "utest1m6h0x5p0ryej3e4raszk99rz3k3gxzj35j7ypw3mm98uxmxt3x7mnmu22cprpl7rls4cc5k"
  + "xzvhqxju6pp4rxsw6ajnkm0d4egf4yrjx";
const B = "utest1fm3azgphez3dtyp4yf22ake0pdv8v64sredvc68gqt6n952fd9annl7c80hpl3sl0j0dxad"
  + "q7ppte0wxdvxz7phuaw4n68yxqqd4q00q";
const MAIN = "u1ljgj2vz0uzz5ku88wq07pqwepyyaw6azem5rnl56xu0wfjkxpkd84e40y36wy6da7fvcd845jwl09"
  + "pg9uwc5zlx0cead3xsz7vuqm5z2";
const SAPLING = "ztestsapling10yy2ex5dcqkclhc7z7yrnjq2z6feyjad56ptwlfgmy77dmaqqrl9gyhprdx59qgm"
  + "snyfska2kez";
const TEX = "textest1qvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcrev4vgn";
const HEX = Buffer.from([0xff, 1]).toString("base64url");
const FIXED = "this is not a valid ZIP 321 request";
const memo64 = (text) => Buffer.from(text).toString("base64url");
// The app's `normalized`: the canonical address, or null.
const normalized = (address) => {
  try { return Z.normalizeAddress(address); } catch { return null; }
};
const env = (nets) => ({
  nets, parse: (uri, net) => Z.parseRequest(uri, net),
  blocker: (to) => payeeBlocker(to, normalized),
});
const room = env([REQUEST_NET.testnet]);
const direct = env(["test", "main"]);

// ── The detection rule: the whole text, trimmed, is one URI ──
const uri = `zcash:${A}?amount=1.5`;
assert.equal(requestUri(uri), uri);
assert.equal(requestUri(`  \n${uri}\t\n`), uri, "white space around it does not matter");
for (const text of [
  `Please pay ${uri}`, `${uri} thanks`, `pay me: ${uri}`, `${uri}\nthanks`, `${uri} ${uri}`,
  `${uri}\n${uri}`, `Zcash:${A}`, `ZCASH:${A}`, `https://example.com/${uri}`, "zcash:", "zcash: ",
  "zcash", "", "   ", null, undefined, 5, `<${uri}>`,
]) assert.equal(requestUri(text), null, String(text));
assert.equal(readRequest("hello", room), null, "plain text");
assert.equal(readRequest(`Please pay ${uri}`, room), null, "a URI inside other text is plain text");
assert.equal(readRequest("", room), null);

// ── A request for the network of the wallet ──
let r = readRequest(uri, room);
assert.deepEqual([r.net, r.total, r.open, r.blocker, r.uri], ["test", 150000000, 0, "", uri]);
assert.deepEqual(r.payees, [{ to: A, amount: 150000000, memo: null, label: null, message: null }]);

const memoUri = `zcash:?address=${A}&amount=1&memo=${memo64("October rent")}`
  + `&address.1=${B}&amount.1=0.5&label.1=Bob&message.1=Thanks%20Bob`;
r = readRequest(memoUri, room);
assert.deepEqual([r.payees.length, r.total, r.open], [2, 150000000, 0]);
assert.equal(r.payees[0].memo, "October rent");
assert.deepEqual([r.payees[1].label, r.payees[1].message], ["Bob", "Thanks Bob"]);

r = readRequest(`zcash:?address=${A}&amount=1&address.1=${B}`, room);
assert.deepEqual([r.total, r.open, r.payees[1].amount], [null, 1, null], "one amount is left open");
r = readRequest(`zcash:${A}`, room);
assert.deepEqual([r.total, r.open], [null, 1], "no amount at all");
assert.equal(r.payees[0].amount, null);

// ── A request that cannot be used shows why ──
const err = (text, e = room) => readRequest(text, e).error;
assert.equal(err(`zcash:${MAIN}`), "payee 1: the address is not a testnet address");
assert.equal(err(`zcash:${A}`, env(["main"])), "payee 1: the address is not a mainnet address");
assert.equal(err(`zcash:${A}?memo=${memo64("hi")}&amount=x`), FIXED);
assert.equal(err(`zcash:${TEX}?memo=${memo64("hi")}`),
  "payee 1: a transparent address cannot receive a memo");
assert.equal(err(`zcash:${A}?memo=!!!`),
  "payee 1: the memo is not base64url text of at most 512 bytes");
assert.equal(err(`zcash:${A}?memo=${HEX}`), "payee 1: the memo is not text");
assert.equal(err("zcash:garbage"), FIXED);
assert.equal(err("zcash:?"), "the request has no payee");
assert.equal(err(`zcash:${A}?amount=0`), "payee 1: the amount is zero", "zero is not an amount");
assert.equal(err(`zcash:?address=${A}&amount=1&address.1=${B}&amount.1=0.00000000`),
  "payee 2: the amount is zero");
assert.equal(readRequest(`zcash:${A}?amount=0.00000001`, room).total, 1);
assert.equal(err(`zcash:${A}?x-Verified+by+your+signers=1&x-Verified+by+your+signers=2`),
  "payee 1: a parameter appears twice", "text from the sender stays out of the error");
assert.equal(err(`zcash:${A}?label=a&label=b`), "payee 1: the parameter label appears twice");
for (const suffix of ["0", "01", "10000", "4294967295", "18446744073709551615"]) {
  assert.equal(err(`zcash:${A}?memo.${suffix}=!!!`), FIXED, `memo.${suffix}`);
}
const many = Array.from({ length: 21 }, (_, i) => `address${i ? "." + i : ""}=${A}`)
  .join("&");
assert.equal(err(`zcash:?${many}`), "a request can have at most 20 payees; this one has 21");
assert.equal(readRequest("zcash:garbage", room).payees, undefined);

// ── In a chat, each network is tried ──
assert.equal(readRequest(`zcash:${A}`, direct).net, "test");
assert.equal(readRequest(`zcash:${MAIN}`, direct).net, "main");
assert.equal(err(`zcash:${MAIN}`, direct), undefined, "a mainnet request is fine in a chat");
assert.equal(err("zcash:garbage", direct), FIXED);
const badMemo = `zcash:?address=${A}&address.1=${B}&memo.1=${HEX}`;
assert.equal(err(badMemo, direct), "payee 2: the memo is not text",
  "the real reason wins over the wrong-network error of the other network");
assert.equal(err(`zcash:?address=${A}&address.1=${MAIN}`, direct),
  "payee 2: the address is not a testnet address",
  "a mix of networks: the error of the first try");

// ── Payees that Zigs cannot propose ──
assert.equal(readRequest(`zcash:${A}?amount=1`, room).blocker, "");
assert.equal(readRequest(`zcash:${TEX}?amount=1`, room).blocker,
  "Zigs pays shielded unified addresses only.");
assert.match(readRequest(`zcash:${SAPLING}`, room).blocker, /shielded unified/);

// ── The card state: the warning and the reason that Propose is off ──
const ok = readRequest(`zcash:${A}?amount=1`, room);
assert.deepEqual(cardState(ok, "yes"), { warning: "", why: "" });
for (const verdict of ["no", "changed", "unknown", "memo"]) {
  const s = cardState(ok, verdict);
  assert.match(s.warning, /Check this request with the sender before you pay\./, verdict);
  assert.equal(s.why, "", "a warning does not turn Propose off: the person decides");
}
assert.match(cardState(ok, "memo").warning, /A memo has no sender/);
assert.equal(cardState(ok, "wait").warning, "", "no warning while the check runs");
assert.match(cardState(ok, "wait").why, /checked the sender/);
assert.equal(cardState(ok, "yes", "Wait for the first sync to finish.").why,
  "Wait for the first sync to finish.");
const sapling = readRequest(`zcash:${SAPLING}`, room);
assert.match(cardState(sapling, "wait", "other").why, /shielded unified/,
  "the request comes first");
assert.deepEqual(Object.keys(cardState(ok, "bogus")), ["warning", "why"]);
assert.equal(cardState(ok, "bogus").warning, "");

// ── The rows of the Send form ──
let n = 0;
const key = () => ++n;
r = readRequest(
  `zcash:?address=${A}&amount=0.00000001&memo=${memo64("rent é")}&address.1=${B}`, room);
assert.deepEqual(payeeRows(r.payees, key), [
  { k: 1, to: A, amt: "0.00000001", memo: "rent é" },
  { k: 2, to: B, amt: "", memo: "" },
]);
assert.deepEqual(payeeRows([{ to: A, amount: 150000000 }, { to: B, amount: 3, memo: "m" }], key),
  [{ k: 3, to: A, amt: "1.5", memo: "" }, { k: 4, to: B, amt: "0.00000003", memo: "m" }]);
assert.deepEqual(payeeRows([], key), []);
// The field of the form hides a line break, so the state of the form must not keep it.
assert.equal(payeeRows([{ to: A, amount: 1, memo: "a\nb" }], key)[0].memo, "a b");
assert.equal(payeeRows([{ to: A, amount: 1, memo: "a\r\n\n b\u202Ec\0" }], key)[0].memo,
  "a  b\ufffdc\ufffd");
assert.equal(oneLine(null), "");
const hidden = readRequest(`zcash:${A}?memo=${memo64("pay\nnow\u202E")}`, room);
assert.equal(hidden.payees[0].memo, "pay\nnow\u202E", "the engine gives the memo as written");
assert.equal(payeeRows(hidden.payees, key)[0].memo, "pay now\ufffd",
  "the row of the form holds what the field shows");
const list = parsePayeeList(`${A}, 0.5, October rent`);
const listed = payeeRows(list.rows, key)[0];
assert.deepEqual(listed, { k: n, to: A, amt: "0.5", memo: "October rent" },
  "rows of a pasted list use the same function");
// A row keeps the name of a payee that was paid by name, when it is a valid bare name.
const kept = payeeRows([{ to: A, amount: 1, name: "alice" }], key);
assert.deepEqual(kept, [{ k: n, to: A, amt: "0.00000001", memo: "", name: "alice" }]);
for (const name of ["Alice", "alice.zec", "", 5, null, "a b"]) {
  assert.equal(Object.hasOwn(payeeRows([{ to: A, amount: 1, name }], key)[0], "name"), false,
    "no name kept for " + JSON.stringify(name));
}

// ── The note: every approver reads it, so only a verified sender is named ──
assert.equal(requestNote("Alice", "yes"), "Request from Alice");
assert.equal(requestNote("Alice (seat 2)", "yes"), "Request from Alice (seat 2)");
assert.equal(requestNote("a".repeat(200), "yes").length, 80);
assert.equal(requestNote("a".repeat(66) + "🙂🙂", "yes").length, 79,
  "a pair of surrogates is never cut");
assert.equal(requestNote(`${"a".repeat(66)} `, "yes"), "Request from " + "a".repeat(66),
  "no trailing space");
for (const verdict of ["no", "changed", "unknown", "wait", "bogus", undefined]) {
  assert.equal(requestNote("Alice (seat 2)", verdict), "Request from an unverified sender",
    "a sender that is not verified is not named: " + verdict);
}
assert.equal(requestNote("a memo", "memo"), "Request from a memo");
assert.equal(requestNote("Al\u202Eice\nBob", "yes"), "Request from Al\ufffdice Bob",
  "no bidirectional mark and no line break in a name");
// The approvers do not read "You" as the sender, nor the seat numbers of another wallet.
assert.equal(requestNote("You (seat 1)", "yes", { mine: true }), "Request from the proposer");
assert.equal(requestNote("You", "no", { mine: true }), "Request from an unverified sender");
assert.equal(requestNote("Ana (seat 2)", "yes", { room: "Rent" }),
  "Request from Ana (seat 2) in Rent");
assert.equal(requestNote("Ana", "yes", { room: "R\u202E\nx" }), "Request from Ana in R\ufffd x");

// ── Text that the sender of a request wrote ──
assert.equal(quoted("Alice"), "Alice");
assert.equal(quoted(null), "");
assert.equal(quoted(" \n \n"), "", "only blank lines");
assert.equal(quoted("a\n\n\nb\nc"), "a\nb\nc", "blank lines go");
assert.equal(quoted("1\n2\n3\n4\n5"), "1\n2\n3…", "at most 3 lines");
assert.equal(quoted("a".repeat(120)), "a".repeat(120));
assert.equal(quoted("a".repeat(121)), "a".repeat(120) + "…", "at most 120 characters");
assert.equal(quoted("🙂".repeat(121)), "🙂".repeat(120) + "…", "characters, not UTF-16 units");
assert.equal(quoted("x\u202Ey"), "x\ufffdy");
assert.equal(quoted("a\u200Bb"), "a\u200Bb", "a zero-width joiner stays: emoji need it");

// ── The words for a request that the engine refuses ──
assert.equal(requestProblem("payee 1: the address is missing"),
  "This request cannot be used. Payee 1: the address is missing.");
assert.equal(requestProblem(FIXED),
  "This request cannot be used. This is not a valid ZIP 321 request.");
assert.equal(requestProblem("Done."), "This request cannot be used. Done.");

// ── The request form ──
assert.deepEqual(requestPayees(A, "", ""), { payees: [{ to: A }] });
assert.deepEqual(requestPayees(A, " 1.5 ", " rent "),
  { payees: [{ to: A, amount: 150000000, memo: "rent" }] });
assert.deepEqual(requestPayees(A, undefined, undefined), { payees: [{ to: A }] });
for (const bad of ["0", "-1", "abc", "1.123456789", "21000001"]) {
  assert.match(requestPayees(A, bad, "").error, /Enter an amount above zero/, bad);
}
assert.match(requestPayees(A, "", "a".repeat(513)).error, /513 bytes/);
assert.match(requestPayees(A, "", "a\0b").error, /null character/);

// ── The form and the card agree: a request that the form makes reads back as it was ──
const forms = [["", ""], ["0.25", ""], ["", "hello"], ["12", "é ✓"], ["0.00000001", "x"]];
for (const [amount, memo] of forms) {
  const form = requestPayees(A, amount, memo);
  const made = Z.makeRequest(JSON.stringify(form.payees), "test");
  assert.ok(requestUri(made), made);
  const back = readRequest(made, room);
  const want = { to: A, amount: form.payees[0].amount ?? null, memo: form.payees[0].memo ?? null };
  assert.deepEqual(back.payees.map(({ to, amount: a, memo: m }) => ({ to, amount: a, memo: m })),
    [want]);
  assert.equal(payeeRows(back.payees, key)[0].memo, memo.trim());
}
assert.throws(() => Z.makeRequest(JSON.stringify([{ to: MAIN }]), "test"), /not a testnet address/);
console.log("requests ok");
