// The Send drafts and the age of a review (web/payment-model.js): a draft keeps only what the
// person typed, within bounds, for 24 hours; a review older than 5 minutes is built again.
// Run: node web/test/payment-model.mjs   (Node 24)
import assert from "node:assert/strict";
import { DRAFT_MS, draftLive, draftOf, REVIEW_MS, reviewFresh } from "../payment-model.js";

const at = 1_800_000_000_000;
const typed = { k: 4, to: "alice.zec", amt: "0.5", memo: "rent", name: "alice",
  shown: { address: "utest1x", seen: true } };
const d = draftOf({ rows: [typed], note: "October", priority: true }, at);
assert.deepEqual(d, { v: 1, at, rows: [{ to: "alice.zec", amt: "0.5", memo: "rent" }],
  note: "October", priority: true }, "only the typed text: no key, no shown address, no name");
assert.equal(draftOf({ rows: [{ to: "", amt: "", memo: "" }], note: "" }, at), null,
  "an empty form keeps no draft");
assert.equal(draftOf({ rows: [{ to: "x" }], note: "", priority: "yes" }, at).priority, false);
assert.equal(draftOf({ rows: [{ to: "x".repeat(1025) }] }, at), null, "a row out of bounds");
assert.equal(draftOf({ rows: Array.from({ length: 21 }, () => ({ to: "x" })) }, at), null,
  "more rows than a payment takes");
assert.equal(draftOf({ rows: [null] }, at), null);
assert.equal(draftOf({ rows: [{ to: "x" }], note: "n".repeat(81) }, at), null);
console.log("ok  a draft keeps the typed form only");

assert.equal(draftLive(d, at), true);
assert.equal(draftLive(d, at + DRAFT_MS), true, "24 hours");
assert.equal(draftLive(d, at + DRAFT_MS + 1), false, "older: gone");
assert.equal(draftLive(d, at - 300001), false, "from the future");
assert.equal(draftLive({ ...d, v: 2 }, at), false);
assert.equal(draftLive({ ...d, rows: [{ to: 5 }] }, at), false, "a stored draft is checked too");
assert.equal(draftLive(null, at), false);
console.log("ok  a draft lives 24 hours");

assert.equal(reviewFresh(at, at), true);
assert.equal(reviewFresh(at, at + REVIEW_MS - 1), true);
assert.equal(reviewFresh(at, at + REVIEW_MS), false, "5 minutes: build it again");
assert.equal(reviewFresh(at, at - 1), false, "a clock that went back");
assert.equal(reviewFresh(undefined, at), false);
console.log("ok  the age of a review");
console.log("payment-model: ok");
