// The stage model of the setup page (web/setup-model.js): each stage follows from the counts of
// the progress card, and a stop always shows as blocked, never as a stage on track.
// Run: node web/test/setup-stage.mjs   (Node 24)
import assert from "node:assert/strict";
import { SETUP_STAGES, setupStage } from "../setup-model.js";

assert.deepEqual(SETUP_STAGES, ["Plan", "Connect", "Verify", "Prepare", "Back up"]);
const base = { n: 3, seated: 3, verify: true, confirmed: 3, keysDone: 3, checked: 3,
  solPending: false, blocked: null };
const at = (f) => SETUP_STAGES[setupStage({ ...base, ...f }).index];

assert.equal(at({ seated: 1 }), "Connect", "a seat is open");
assert.equal(at({ seated: 2, confirmed: 0 }), "Connect", "seats first");
assert.equal(at({ confirmed: 2 }), "Verify", "a signer has not confirmed the safety number");
assert.equal(at({ verify: false, confirmed: 0, keysDone: 1 }), "Prepare",
  "a wallet before version 2 has no safety number to confirm");
assert.equal(at({ keysDone: 2 }), "Prepare", "the key ceremony runs");
assert.equal(at({ checked: 2 }), "Prepare", "a seat still checks the address");
assert.equal(at({ solPending: true }), "Prepare", "the Solana part still sets up");
assert.equal(at({}), "Back up", "everything is ready: the files come next");
console.log("ok  the stages follow the counts");

assert.equal(setupStage(base).blocked, null);
const stop = setupStage({ ...base, keysDone: 1, blocked: "Seat 2 stopped setup." });
assert.equal(stop.blocked, "Seat 2 stopped setup.", "the text of the stop");
assert.equal(SETUP_STAGES[stop.index], "Prepare", "at the stage where it stopped");
console.log("ok  a stop is blocked");
console.log("setup-stage: ok");
