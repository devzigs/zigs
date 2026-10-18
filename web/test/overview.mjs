// The Overview model (web/overview-model.js): the ZEC total, the states of the SOL row and the
// pending shortcut. An unknown amount is never zero, and nothing pending gives no shortcut.
// Run: node web/test/overview.mjs   (Node 24)
import assert from "node:assert/strict";
import { pendingShortcut, solRow, zecTotal } from "../overview-model.js";

assert.equal(zecTotal(null), null, "no sync yet: unknown, not zero");
assert.equal(zecTotal({ spendable: 0, pending: 0, sending: 0 }), 0, "an empty wallet is zero");
assert.equal(zecTotal({ spendable: 150, pending: 25, sending: 40 }), 175,
  "spendable plus incoming; the amount on its way out is not counted twice");
console.log("ok  the ZEC total");

const ready = { status: "ready" };
assert.equal(solRow({ on: false, setup: ready, balance: "1 SOL" }), null, "no Solana part");
assert.equal(solRow({ on: true, error: "x", setup: ready, balance: "1 SOL" }).state, "failed");
assert.equal(solRow({ on: true, loading: true, setup: null }).state, "loading",
  "the module still loads");
assert.deepEqual(solRow({ on: true, loading: false, setup: null }),
  { state: "idle", text: "Not open" }, "nothing loads: no Loading text");
const status = (s) => solRow({ on: true, setup: { status: s }, balance: "1 SOL" });
assert.equal(status("stopped").state, "stopped");
assert.equal(status("running").state, "setup");
assert.deepEqual(status("not started"), { state: "none", text: "Not added" });
assert.equal(status("unavailable").state, "unavailable");
assert.deepEqual(status("differs"), { state: "differs", text: "Keys differ" },
  "seats with different keys never show a balance");
assert.deepEqual(status("something new"), { state: "unknown", text: "Unknown" },
  "an unknown status is no setup step");
assert.deepEqual(solRow({ on: true, setup: ready, balance: null }),
  { state: "unsynced", text: "Not synced yet" }, "no sync yet: unknown, not zero");
assert.deepEqual(solRow({ on: true, setup: ready, balance: "0 SOL" }),
  { state: "synced", text: "0 SOL" }, "a synced empty wallet is zero");
assert.deepEqual(solRow({ on: true, setup: ready, balance: "0.0025 SOL" }),
  { state: "synced", text: "0.0025 SOL" }, "the exact text of the sync");
console.log("ok  the SOL row");

assert.equal(pendingShortcut({}), null, "nothing pending, no shortcut");
assert.equal(pendingShortcut({ zecOpen: 0, zecFlying: 0, solToApprove: 0 }), null);
assert.deepEqual(pendingShortcut({ zecOpen: 1 }),
  { count: 1, text: "1 payment is in progress.", to: "activity" });
assert.deepEqual(pendingShortcut({ zecFlying: 1, solToApprove: 2 }),
  { count: 3, text: "3 payments are in progress.", to: "activity" },
  "ZEC first: the Activity section lists the ZEC payments");
assert.equal(pendingShortcut({ solToApprove: 2 }).to, "solana", "only Solana: its section");
console.log("ok  the pending shortcut");
console.log("overview: ok");
