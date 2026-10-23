// The Approvals inbox model (web/approvals-model.js). Every combination of facts lands in one
// bucket or counts as finished, by the precedence that the drawer and the Activity chips use; a
// payment that is not finished, or that an approval here still holds, never drops out. The inbox
// says that nothing waits only when it knows it, and the Solana line never says that nothing else
// waits.
// Run: node web/test/approvals.mjs   (Node 26)
import assert from "node:assert/strict";
import { BUCKETS, bucketOf, emptyState, solLine } from "../approvals-model.js";

const IDS = BUCKETS.map(([id]) => id);
assert.deepEqual(IDS, ["review", "ready", "waiting", "attention"]);

// The expected bucket: the first rule that holds, written as a table. A finished payment and the
// Check state go to "attention" while an approval here holds Send, else out of the inbox.
const hold = (f) => (f.held ? "attention" : null);
const RULES = [
  [(f) => f.sendRefused, () => "attention"],
  [(f) => f.check, hold],
  [(f) => f.review, () => "review"],
  [(f) => f.landed || f.ended || f.error, hold],
  [(f) => f.step, () => "ready"],
  [(f) => f.status === "lost", () => "attention"],
];
const expected = (f) => {
  const hit = RULES.find(([holds]) => holds(f));
  return hit ? hit[1](f) : "waiting";
};
const FLAGS = ["landed", "held", "check", "review", "ended", "error", "sendRefused"];
const STATUSES = ["collecting", "signing", "signed", "proving", "complete", "broadcast", "lost"];
let n = 0;
for (let bits = 0; bits < 1 << FLAGS.length; bits++) {
  for (const step of [null, "proof", "send", "resend"]) {
    for (const status of STATUSES) {
      const f = { step, status };
      FLAGS.forEach((k, i) => { f[k] = !!(bits & (1 << i)); });
      const got = bucketOf(f);
      assert.equal(got, expected(f), JSON.stringify(f));
      assert.ok(got === null || IDS.includes(got));
      assert.ok(!f.held || got !== null, "a hold never drops out: " + JSON.stringify(f));
      n += 1;
    }
  }
}
console.log("ok  " + n + " combinations: one bucket each, by the precedence of the drawer");

assert.equal(bucketOf({ held: true, ended: true, error: true, status: "collecting" }),
  "attention", "an approval that still holds notes after a cancel is no finished payment (S7)");
assert.equal(bucketOf({ held: true, ended: true, status: "collecting" }), "attention",
  "an approval that holds Send after its payment ended, with no error part");
assert.equal(bucketOf({ check: true, held: true, status: "broadcast" }), "attention",
  "the Check state of an approval here");
assert.equal(bucketOf({ check: true, status: "broadcast" }), null,
  "the Check state with no hold here: the Activity chip says Check");
assert.equal(bucketOf({ status: "collecting" }), "waiting", "another seat must approve");
assert.equal(bucketOf({ sendRefused: true, step: "send", status: "complete" }), "attention",
  "a send that this browser refuses is no Ready row");
assert.equal(bucketOf({ status: "proving" }), "waiting", "another browser builds the proof");
assert.equal(bucketOf({ step: "proof", status: "signed" }), "ready");
assert.equal(bucketOf({ step: "resend", status: "broadcast" }), "ready", "a lost send");
assert.equal(bucketOf({ status: "collecting", error: true }), null, "cancelled, nothing held");
assert.equal(bucketOf({ step: "send", status: "complete", error: true }), null,
  "a failed payment: the drawer offers no step, so no Ready row");
assert.equal(bucketOf({ review: true, landed: true, status: "collecting" }), "review",
  "the badge counts it, so the inbox lists it");
assert.equal(bucketOf({ status: undefined }), "attention", "a document with no status");
console.log("ok  the named cases");

const known = { loaded: true, failed: false, checking: false, synced: true, ignored: 0,
  sol: false };
assert.equal(emptyState(known), "empty");
assert.equal(emptyState({ ...known, loaded: false }), "loading", "the payments did not arrive");
assert.equal(emptyState({ ...known, failed: true }), "failed", "their read failed");
assert.equal(emptyState({ ...known, failed: true, loaded: false }), "failed");
assert.equal(emptyState({ ...known, checking: true }), "loading", "a check is open");
assert.equal(emptyState({ ...known, ignored: 2 }), "ignored", "records failed their check");
assert.equal(emptyState({ ...known, synced: false }), "syncing",
  "before the sync, the holds of approvals are not known");
assert.equal(emptyState({ ...known, sol: true }), "zec",
  "with a Solana part, the empty text speaks of Zcash only");
console.log("ok  the inbox says that nothing waits only when it knows");

const ready = { status: "ready" };
assert.equal(solLine({ on: false, setup: ready, toApprove: 3 }), null, "no Solana part");
assert.equal(solLine({ on: true, error: "x", setup: ready }).kind, "attention");
assert.match(solLine({ on: true, error: "offline" }).text, /not shown here: offline$/);
assert.equal(solLine({ on: true, loading: true, setup: null }).kind, "loading");
assert.equal(solLine({ on: true, loading: false, setup: null }).kind, "idle");
assert.equal(solLine({ on: true, setup: { status: "not started" } }), null, "no part yet");
assert.equal(solLine({ on: true, setup: { status: "differs" } }).kind, "info");
assert.deepEqual(solLine({ on: true, setup: ready, toApprove: 1 }),
  { kind: "review", text: "1 Solana proposal waits for your approval." });
assert.match(solLine({ on: true, setup: ready, toApprove: 2 }).text, /^2 Solana proposals/);
const none = solLine({ on: true, setup: ready, toApprove: 0 });
assert.equal(none.kind, "info");
assert.match(none.text, /waits for your approval/, "it speaks of your approval only");
assert.deepEqual(solLine({ on: true, setup: ready, toApprove: 0, reading: 1 }),
  { kind: "loading", text: "A Solana proposal is loading. Open Solana." },
  "a proposal that this device still reads: no claim that nothing waits");
assert.equal(solLine({ on: true, setup: ready, toApprove: 1, reading: 1 }).kind, "review",
  "a proposal to approve comes first");
assert.match(solLine({ on: true, setup: ready, toApprove: 0, older: 2 }).text,
  / 2 older Solana proposals are not listed here or in Solana\.$/, "older ones are not hidden");
assert.match(solLine({ on: true, setup: ready, toApprove: 1, older: 1 }).text,
  /^1 Solana proposal waits.* 1 older Solana proposal is not listed/);
assert.equal(solLine({ on: true, setup: ready, toApprove: 0, older: 0 }).text, none.text);
console.log("ok  the Solana line");
console.log("approvals: ok");
