// The Overview model (web/overview-model.js): the ZEC total, the states of the SOL row and the
// pending shortcut. An unknown amount is never zero, and nothing pending gives no shortcut.
// Run: node web/test/overview.mjs   (Node 26)
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  formatUsdBalance, pendingShortcut, solRow, zecInProgress, zecTotal,
} from "../overview-model.js";
import { describeOrb } from "../wallet-identity.js";
import { fallbackSvg } from "../wallet-avatar-svg.js";

for (const unknown of [null, undefined, NaN, Infinity, -Infinity, "12", {}, false]) {
  assert.deepEqual(formatUsdBalance(unknown), {
    known: false, text: "$0.00", whole: "$0", fraction: ".00",
  }, "only finite numbers are confirmed valuations");
}
assert.deepEqual(formatUsdBalance(0), {
  known: true, text: "$0.00", whole: "$0", fraction: ".00",
});
assert.equal(formatUsdBalance(-0).text, "$0.00", "numeric zero has no negative sign");
assert.equal(formatUsdBalance(1234567.89).text, "$1,234,567.89");
assert.equal(formatUsdBalance(-42.5).text, "-$42.50");
const source = Object.freeze({ valuation: null });
formatUsdBalance(source.valuation);
assert.equal(source.valuation, null, "presentation never overwrites an unknown valuation");

const publicAddress = "utest1" + "q".repeat(180);
const first = await describeOrb("zcash:testnet", publicAddress);
const again = await describeOrb("zcash:testnet", publicAddress.toUpperCase());
assert.equal(first.digest, again.digest, "canonical public address keeps one identity");
assert.equal(fallbackSvg(first), fallbackSvg(again), "SVG geometry is deterministic");
assert.equal(createHash("sha256").update(fallbackSvg(first)).digest("hex"),
  "a4b39cc58f8a7282193e3c75447e3dff7c4a53ba3c618053782818beebd5f9f6",
  "promoted SVG keeps the existing prototype projection byte-for-byte");
assert.notEqual(first.digest, (await describeOrb("zcash:mainnet", publicAddress)).digest);
assert.notEqual(first.digest, (await describeOrb("zcash:testnet", "utest1pppp")).digest);
assert.doesNotMatch(fallbackSvg(first), /utest1|address|keyPackage|viewing/i);

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
const synced = (text, busy = false) => solRow({ on: true, setup: ready, balance: "1 SOL",
  sync: { text, busy } }).state;
assert.equal(synced("synced at slot 9, x"), "synced");
assert.equal(synced("saved sync of slot 9"), "saved", "a balance of the saved sync says so");
assert.equal(synced("failed: offline"), "stale", "a failed sync marks the old balance");
assert.equal(synced("failed: offline", true), "resync", "a retry keeps the balance marked old");
assert.equal(synced("saved sync of slot 9", true), "resync");
assert.equal(solRow({ on: true, setup: ready, balance: null, sync: { text: "", busy: true } })
  .state, "syncing", "a first sync runs");
console.log("ok  the SOL row");

assert.equal(pendingShortcut({ zec: 0, sol: 0 }), null, "nothing pending, no shortcut");
assert.equal(pendingShortcut({}), null, "no counts, no shortcut");
assert.deepEqual(pendingShortcut({ zec: 1, sol: 0 }),
  { count: 1, text: "1 Zcash payment is in progress." });
assert.deepEqual(pendingShortcut({ zec: 2, sol: 1 }), { count: 3,
  text: "2 Zcash payments are in progress. 1 Solana proposal waits for your approval." },
  "each chain says what it counts");
assert.deepEqual(pendingShortcut({ zec: 0, sol: 2 }),
  { count: 2, text: "2 Solana proposals wait for your approval." }, "only Solana");
assert.equal(zecInProgress(["a", "b"], ["a"], ["c", "a"]), 3, "each payment once");
assert.equal(zecInProgress([], [], ["h"]), 1, "a held approval alone counts");
assert.equal(zecInProgress([], [], []), 0);
console.log("ok  the pending shortcut");
console.log("overview: ok");
