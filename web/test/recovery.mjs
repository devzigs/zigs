// The Recovery model (web/recovery-model.js): the margin of devices that the wallet can lose,
// and the recovery state of the devices of this browser. A file that is not saved always shows,
// and no state says more than "saved from this browser".
// Run: node web/test/recovery.mjs   (Node 24)
import assert from "node:assert/strict";
import { protectionRisk, recoveryState, VIEWING_NOTE } from "../recovery-model.js";

assert.equal(protectionRisk(2, 3).margin, 1);
assert.equal(protectionRisk(2, 3).title, "1 key share can be lost");
assert.equal(protectionRisk(2, 4).title, "2 key shares can be lost");
assert.equal(protectionRisk(2, 3).detail, "A payment needs 2 of 3 devices, so the wallet still "
  + "pays when 1 key share is lost. Two files of the same key share count as one device.");
assert.equal(protectionRisk(2, 4).detail, "A payment needs 2 of 4 devices, so the wallet still "
  + "pays when up to 2 key shares are lost. Two files of the same key share count as one device.");
assert.equal(protectionRisk(3, 3).title, "No key share can be lost", "every device is needed");
assert.equal(protectionRisk(3, 3).detail, "Each payment needs every device. When one key share "
  + "is lost, the wallet cannot pay until its key share comes back from its file.");
assert.equal(protectionRisk(1, 1).margin, 0);
assert.equal(protectionRisk(2, 3).here, "", "one device here: no extra line");
assert.equal(protectionRisk(2, 3, 3).here, "This browser holds 3 devices of this wallet, so its "
  + "loss loses 3 key shares at once: more than the wallet can lose.",
  "all devices in one browser");
assert.match(protectionRisk(2, 4, 2).here, /loses 2 key shares at once\.$/, "within the margin");
console.log("ok  the margin");

const seat = (id, zecSaved, sol) => ({ id, zec: { has: true, saved: zecSaved }, sol });
assert.deepEqual(recoveryState([]), { state: "none", missing: [],
  label: "No device of this wallet in this browser" }, "no device of this wallet here");
assert.equal(recoveryState([{ id: 1, zec: { has: false, saved: false }, sol: null }]).state,
  "none", "a device whose share is not made yet");
assert.deepEqual(recoveryState([seat(1, true, null)]),
  { state: "saved", label: "The files of this wallet's devices in this browser are saved",
    missing: [] });
assert.deepEqual(recoveryState([seat(1, false, null)]), { state: "missing", missing: [[1, "zec"]],
  label: "A file of this wallet's devices in this browser is not saved" });
const both = recoveryState([seat(1, true, { has: true, saved: false }), seat(2, false, null)]);
assert.equal(both.state, "missing");
assert.deepEqual(both.missing, [[1, "sol"], [2, "zec"]], "each file that is not saved shows");
assert.equal(recoveryState([seat(1, true, { has: false, saved: false })]).state, "saved",
  "a device with no Solana share needs no Solana file");
const lost = recoveryState([seat(1, true, { has: true, saved: false, missing: true })]);
assert.deepEqual([lost.state, lost.missing], ["missing", [[1, "sol"]]],
  "a Solana part that this browser does not hold is not saved");
const unread = recoveryState([seat(1, true, { has: false, unknown: true, failed: false })]);
assert.deepEqual(unread, { state: "unknown", missing: [],
  label: "Zigs is still reading the Solana part of this wallet's devices in this browser" },
  "not read yet is not saved");
assert.equal(recoveryState([seat(1, true, { has: false, unknown: true, failed: true })]).label,
  "Zigs could not read the Solana part of this wallet's devices in this browser",
  "a failed load says so");
assert.equal(recoveryState([seat(1, true, { has: false, unknown: true }), seat(2, false, null)])
  .state, "missing", "a file that is not saved shows first");
assert.equal(VIEWING_NOTE, "Every device with viewing access sees the balances and the history of "
  + "this wallet, and a device label proves no identity.");
const texts = [VIEWING_NOTE, recoveryState([]), recoveryState([seat(1, true, null)]), unread,
  recoveryState([seat(1, false, null)]), protectionRisk(2, 3, 3), protectionRisk(3, 3),
  protectionRisk(2, 4)];
assert.doesNotMatch(JSON.stringify(texts), /safe|protected|secure/i,
  "no text claims that the wallet is safe");
console.log("ok  the recovery state");
console.log("recovery: ok");
