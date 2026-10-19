// The Send drafts and the age of a review (web/payment-model.js): a draft keeps only what the
// person typed, within bounds, for 24 hours; a review older than 5 minutes is built again.
// Run: node web/test/payment-model.mjs   (Node 24)
import assert from "node:assert/strict";
import {
  DRAFT_MS, draftLive, draftOf, emptyForm, REVIEW_MS, reviewFresh, stageHeadline,
} from "../payment-model.js";

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
assert.equal(emptyForm({ rows: [{ to: "", amt: "", memo: "" }], note: "" }), true);
assert.equal(emptyForm({ rows: [{ to: "", amt: "", memo: "m" }], note: "" }), false, "a memo");
assert.equal(emptyForm({ rows: [], note: "n" }), false, "a note");
assert.equal(emptyForm({ rows: null }), true);
assert.equal(emptyForm({ rows: [{ memo: "m".repeat(2049) }] }), false,
  "a form too long for a draft is not empty: the page keeps the last draft");
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
// The headline: the first fact that holds names the state. A later stage wins over an earlier
// one, and an end (a block, an expiry, a stop) wins over every step.
const title = (f) => stageHeadline(f).title;
assert.equal(title({}), "Waiting for approvals", "no fact: the approvals");
assert.equal(title({ mine: true }), "Your approval is needed");
assert.equal(title({ mine: true, signing: true }), "Signing", "approved: the signing step");
assert.equal(title({ signing: true, signed: true }), "Ready for the proof");
assert.equal(title({ signed: true, proving: true }), "Building the proof");
assert.equal(title({ proving: true, proved: true }), "Ready to send");
assert.equal(title({ proved: true, sendFailed: true }), "The send failed");
assert.equal(title({ proved: true, sent: true, sendFailed: true }), "Waiting for a block");
assert.equal(title({ proved: true, refused: true }), "Payment needs attention",
  "a send that this browser refuses is no Ready to send");
assert.equal(title({ sent: true, landed: true }), "In a block");
assert.equal(title({ sent: true, check: true }), "Check the payment");
assert.equal(title({ check: true, ended: true }), "Payment expired");
assert.equal(title({ error: true, mine: true }), "Payment stopped");
assert.equal(title({ rejected: true, mine: true }), "Payment needs attention",
  "a payment that this browser refuses asks for no approval");
assert.equal(title({ landed: true, ended: true, error: true }), "In a block", "a block wins");
assert.equal(title({ mine: "yes" }), "Waiting for approvals", "only true counts");
assert.match(stageHeadline({ mine: true }).detail, /An approval sends nothing\.$/);
console.log("ok  the headline of a payment");
console.log("payment-model: ok");
