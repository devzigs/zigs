// The Send drafts and the age of a review (web/payment-model.js): a draft keeps only what the
// person typed, within bounds, for 24 hours; a review older than 5 minutes is built again.
// Run: node web/test/payment-model.mjs   (Node 24)
import assert from "node:assert/strict";
import {
  DRAFT_MS, draftLive, draftOf, emptyForm, headlineFacts, RESEND_MS, REVIEW_MS, reviewFresh,
  stageHeadline,
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
assert.equal(title({ proved: true, sendFailed: true }), "The send did not finish");
assert.equal(title({ proved: true, sent: true, sendFailed: true }), "Waiting for a block");
assert.equal(title({ proved: true, refused: true }), "Payment needs attention",
  "a send that this browser refuses is no Ready to send");
assert.equal(title({ sent: true, landed: true }), "In a block");
assert.equal(title({ sent: true, check: true }), "Check the payment");
assert.equal(title({ check: true, ended: true }), "Payment expired");
assert.equal(title({ error: true, mine: true }), "Check the payment");
assert.equal(title({ rejected: true, mine: true }), "Payment needs attention",
  "a payment that this browser refuses asks for no approval");
assert.equal(title({ landed: true, ended: true, error: true }), "In a block", "a block wins");
assert.equal(title({ mine: "yes" }), "Waiting for approvals", "only true counts");
assert.ok(stageHeadline({ mine: true }).detail.endsWith("After enough approvals, the devices "
  + "sign it, a device builds the proof, and any device can send it."));
assert.equal(title({ held: true, error: true }), "Stopped, but it may still go on chain",
  "an approval here still holds Send");
assert.equal(title({ check: true, error: true }), "Check the payment");
assert.equal(title({ ended: true, error: true }), "Payment expired");
assert.equal(title({ mismatch: true, mine: true }), "Payment needs attention",
  "a transaction that pays another payee asks for no approval");
assert.equal(title({ approved: true, mine: true }), "Approvals are complete",
  "enough approvals: no approval is needed");
assert.equal(title({ sent: true, resend: true }), "Send it again");
assert.equal(title({ proved: true, late: true }), "Too late to send", "a node refuses it now");
assert.equal(title({ proved: true, late: true, sendFailed: true }), "Too late to send");
assert.equal(title({ rejected: true, refused: true }), "Payment needs attention");
assert.equal(title({ refused: true, sent: true }), "Payment needs attention");
// Two facts can share a title: the detail says which one holds.
const detail = (f) => stageHeadline(f).detail;
assert.match(detail({ stopped: true, error: true }), /^No device can approve, sign or send it\./);
assert.match(detail({ error: true }), /^This page cannot tell whether a device sent it\./,
  "without the stopped fact, the page does not say that no device can send it");
assert.equal(title({ error: true }), "Check the payment", "the page cannot tell: a check");
assert.equal(title({ stopped: true }), "Payment stopped");
assert.equal(title({ endedSigned: true, check: true }), "Payment expired");
assert.match(detail({ endedSigned: true }), /^The transaction this browser approved expired\. /);
assert.match(detail({ ended: true, endedSigned: true }), /^No device can send it now\./);
assert.equal(title({ held: true, stopped: true }), "Stopped, but it may still go on chain");
// A local reason wins over the steps, so Waiting for approvals shows only without one.
assert.equal(title({ signingLost: true, approvalLost: true }), "Check the payment");
assert.match(detail({ signingLost: true, mine: true }), /^This browser saw the signing start/);
assert.match(detail({ approvalLost: true, approvalChanged: true }), /^A device of this browser /);
assert.match(detail({ approvalChanged: true, mismatch: true }), /changed the proposal after/);
assert.equal(title({ refused: true, signingLost: true }), "Payment needs attention");
for (const f of ["approvalLost", "approvalChanged", "wrongMove"]) {
  assert.equal(title({ [f]: true, mine: true }), "Payment needs attention", f);
}
assert.match(detail({ mismatch: true, wrongMove: true }), /does not pay what the proposer listed/);
assert.match(detail({ wrongMove: true }), /address of the new wallet that this browser checked/);
assert.match(detail({ sentUnsynced: true, resend: true, sent: true }),
  /^A device sent it\. This page has not synced the blocks since you opened this wallet\.$/);
assert.equal(title({ sentUnsynced: true }), "Waiting for a block");
assert.match(detail({ sendHere: true, proved: true }), /This browser sends it only when the /);
assert.doesNotMatch(detail({ proved: true }), /browser/, "no send of this browser without a seat");
assert.match(detail({ approved: true, mine: true }), /^Enough devices approved\. Another /);
assert.equal(RESEND_MS, 10 * 60 * 1000);
assert.match(detail({ resend: true }), / after 10 minutes\. /, "the minutes come from RESEND_MS");
// Every row and the default, from the rows themselves, so that a new row cannot escape.
const all = [...headlineFacts.map((f) => stageHeadline({ [f]: true })), stageHeadline({})];
// The approved row sits below every row above it: a payment with a package also has t approvals.
for (const f of headlineFacts.slice(0, headlineFacts.indexOf("approved"))) {
  assert.equal(detail({ [f]: true, approved: true }), detail({ [f]: true }),
    "approved stays below " + f);
}
assert.equal(title({ held: true, sentStopped: true }), "Stopped, but it may still go on chain");
assert.match(detail({ sentStopped: true, error: true }), /^A device sent it, and the payment /);
assert.equal(all.filter((h) => /signer|seat|passkey|USD|Swap|USDC/i.test(h.title + h.detail))
  .length, 0, "device wording");
assert.equal(new Set(all.map((h) => h.detail)).size, all.length, "each fact has its own detail");
console.log("ok  the headline of a payment");
console.log("payment-model: ok");
