// The Recovery model (web/recovery-model.js): the margin of devices that the wallet can lose,
// and the recovery state of the seats of this browser. A file that is not saved always shows,
// and no state says more than "saved from this browser".
// Run: node web/test/recovery.mjs   (Node 24)
import assert from "node:assert/strict";
import { protectionRisk, recoveryState } from "../recovery-model.js";

assert.equal(protectionRisk(2, 3).margin, 1);
assert.equal(protectionRisk(2, 3).title, "1 device can be lost");
assert.equal(protectionRisk(2, 4).title, "2 devices can be lost");
assert.match(protectionRisk(2, 3).detail, /needs 2 of 3 signers/);
assert.equal(protectionRisk(3, 3).title, "No device can be lost", "every signer is needed");
assert.equal(protectionRisk(1, 1).margin, 0);
console.log("ok  the margin");

const seat = (id, zecSaved, sol) => ({ id, zec: { has: true, saved: zecSaved }, sol });
assert.equal(recoveryState([]).state, "none", "no seat in this browser");
assert.equal(recoveryState([{ id: 1, zec: { has: false, saved: false }, sol: null }]).state,
  "none", "a seat whose share is not made yet");
assert.deepEqual(recoveryState([seat(1, true, null)]),
  { state: "saved", label: "The recovery files of this browser are saved", missing: [] });
assert.deepEqual(recoveryState([seat(1, false, null)]).missing, [[1, "zec"]]);
const both = recoveryState([seat(1, true, { has: true, saved: false }), seat(2, false, null)]);
assert.equal(both.state, "missing");
assert.deepEqual(both.missing, [[1, "sol"], [2, "zec"]], "each file that is not saved shows");
assert.equal(recoveryState([seat(1, true, { has: false, saved: false })]).state, "saved",
  "a seat with no Solana share needs no Solana file");
assert.doesNotMatch(JSON.stringify([recoveryState([seat(1, true, null)])]), /safe|protected/i,
  "no state claims that the wallet is safe");
console.log("ok  the recovery state");
console.log("recovery: ok");
