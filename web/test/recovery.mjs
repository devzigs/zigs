// The Recovery model (web/recovery-model.js): the margin of devices that the wallet can lose,
// and the recovery state of the seats of this browser. A file that is not saved always shows,
// and no state says more than "saved from this browser".
// Run: node web/test/recovery.mjs   (Node 24)
import assert from "node:assert/strict";
import { protectionRisk, recoveryState } from "../recovery-model.js";

assert.equal(protectionRisk(2, 3).margin, 1);
assert.equal(protectionRisk(2, 3).title, "1 key share can be lost");
assert.equal(protectionRisk(2, 4).title, "2 key shares can be lost");
assert.equal(protectionRisk(2, 3).detail, "A payment needs 2 of 3 signers, so the wallet still "
  + "pays when 1 key share is lost. Two files of the same seat count as one signer.");
assert.equal(protectionRisk(2, 4).detail, "A payment needs 2 of 4 signers, so the wallet still "
  + "pays when up to 2 key shares are lost. Two files of the same seat count as one signer.");
assert.equal(protectionRisk(3, 3).title, "No key share can be lost", "every signer is needed");
assert.equal(protectionRisk(3, 3).detail, "Each payment needs every signer. When one key share "
  + "is lost, the wallet cannot pay until its seat comes back from its file.");
assert.equal(protectionRisk(1, 1).margin, 0);
assert.equal(protectionRisk(2, 3).here, "", "one seat here: no extra line");
assert.equal(protectionRisk(2, 3, 3).here, "This browser holds 3 seats of this wallet, so its loss "
  + "loses 3 key shares at once: more than the wallet can lose.", "all seats in one browser");
assert.match(protectionRisk(2, 4, 2).here, /loses 2 key shares at once\.$/, "within the margin");
console.log("ok  the margin");

const seat = (id, zecSaved, sol) => ({ id, zec: { has: true, saved: zecSaved }, sol });
assert.deepEqual(recoveryState([]), { state: "none", missing: [],
  label: "No seat of this wallet in this browser" }, "no seat of this wallet here");
assert.equal(recoveryState([{ id: 1, zec: { has: false, saved: false }, sol: null }]).state,
  "none", "a seat whose share is not made yet");
assert.deepEqual(recoveryState([seat(1, true, null)]),
  { state: "saved", label: "The files of your seats in this wallet are saved", missing: [] });
assert.deepEqual(recoveryState([seat(1, false, null)]), { state: "missing", missing: [[1, "zec"]],
  label: "A file of your seats in this wallet is not saved" });
const both = recoveryState([seat(1, true, { has: true, saved: false }), seat(2, false, null)]);
assert.equal(both.state, "missing");
assert.deepEqual(both.missing, [[1, "sol"], [2, "zec"]], "each file that is not saved shows");
assert.equal(recoveryState([seat(1, true, { has: false, saved: false })]).state, "saved",
  "a seat with no Solana share needs no Solana file");
const lost = recoveryState([seat(1, true, { has: true, saved: false, missing: true })]);
assert.deepEqual([lost.state, lost.missing], ["missing", [[1, "sol"]]],
  "a Solana part that this browser does not hold is not saved");
const texts = [recoveryState([]), recoveryState([seat(1, true, null)]),
  recoveryState([seat(1, false, null)]), protectionRisk(2, 3, 3), protectionRisk(3, 3),
  protectionRisk(2, 4)];
assert.doesNotMatch(JSON.stringify(texts), /safe|protected|secure/i,
  "no text claims that the wallet is safe");
console.log("ok  the recovery state");
console.log("recovery: ok");
