// The switch of local proving (SOL-4, web/sol/localprove.js) against the fake chain of sol-setup:
//  - off, the gate answers "hosted" after its round trip to the group server;
//  - the turn-on writes nothing when the pool moved, when the device cannot make a test proof, or
//    when the person says no; with a yes, the seat signs the document and every seat is pinned;
//  - a browser that sees the switch runs the device check once, in the background, with no write
//    to the server, and a failed check shows on the tile of the seat and is not tried again.
// The approvals path with the switch on is in sol-pay.mjs, the backup pin in sol-app.mjs.
// Run: node web/test/sol-prove.mjs   (Node 24)
import assert from "node:assert/strict";
import {
  checkLine,
  gateAnswer,
  provesLocally,
  turnOnLocal,
} from "../sol/localprove.js";
import { putSol } from "../sol/secrets.js";
import { ensureWorker } from "../sol/session.js";
import { POOL_SLOT } from "./sol-chain.mjs";
import { c, chain, data, gid, notify, path, solOf, waitFor } from "./sol-setup.mjs";
import { step } from "./sol-vector.mjs";

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const switchDocs = () => [...data.keys()].filter((k) => k.startsWith(path(gid, "solprove/")));
const pins = () => [1, 2, 3].map((i) => solOf(i).proveLocal === true);
const selftests = () => chain.commands.filter((m) => m.cmd === "selftest").length;
const NONE = [false, false, false];
const worker = await ensureWorker(c);
const asked = [];

// ── Off: the gate makes its round trip and answers hosted ──
{
  assert.equal(provesLocally(c), false);
  assert.deepEqual(await gateAnswer(c), { mode: "hosted" });
}
step("SOL-4 off: the gate answers hosted after its round trip to the group server");

// ── The turn-on writes nothing unless the pool, the device and the person say yes ──
{
  chain.poolSlot = "600000000";
  await assert.rejects(() => turnOnLocal(c, worker), /Helius changed the Solana pool after/);
  assert.equal(selftests(), 0, "the device check ran on a moved pool");
  chain.poolSlot = POOL_SLOT;
  const keyText = "This device could not load the proving key for this payment size.";
  chain.selftest = () => {
    throw new Error(keyText);
  };
  const failed = /could not make a test proof: .*key.*Local proving was not turned on\.$/;
  await assert.rejects(() => turnOnLocal(c, worker), failed);
  chain.selftest = () => ({ ms: 3100 });
  globalThis.confirm = (text) => {
    asked.push(text);
    return false;
  };
  await turnOnLocal(c, worker);
  assert.match(asked[0], /made a test proof in 3\.1 s\..*It cannot be turned off\.$/);
  assert.deepEqual([switchDocs(), pins()], [[], NONE], "a check or a no wrote the switch");
  assert.equal(provesLocally(c), false);
}
step("SOL-4 a moved pool, a failed test proof or a no writes no switch and pins no seat");

// ── A wallet switch during the turn-on stops it: the next wallet gets nothing ──
{
  const opened = c.opened;
  const said = globalThis.confirm;
  globalThis.confirm = () => true; // the person would say yes: only the switch stops it
  // The person opens another wallet while the test proof runs (main.js openGroup counts up).
  const switching = {
    call: async (cmd) => {
      if (cmd === "poolSlot") return { slot: POOL_SLOT, pinned: POOL_SLOT, text: null };
      c.opened += 1;
      return { ms: 3100 };
    },
  };
  await assert.rejects(() => turnOnLocal(c, switching), /The wallet changed during this step/);
  c.opened = opened;
  globalThis.confirm = said;
  assert.deepEqual([switchDocs(), pins()], [[], NONE], "a switch mid-step wrote the switch");
}
step("SOL-4 a wallet switch during the turn-on writes no switch and pins no seat");

// ── A yes: the seat signs the document, and every seat of this browser is pinned ──
{
  globalThis.confirm = () => true;
  await turnOnLocal(c, worker);
  assert.deepEqual(switchDocs(), [path(gid, "solprove/1")], "seat 1 signs the switch");
  await waitFor("the switch", () => provesLocally(c));
  assert.deepEqual(pins(), [true, true, true]);
  assert.deepEqual(solOf(1).proveCheck?.ok, true, "the test proof of the turn-on is kept");
  assert.deepEqual(await gateAnswer(c), { mode: "local" });
  await turnOnLocal(c, worker);
  assert.equal(asked.length, 1, "a second turn-on asks nothing");
}
step("SOL-4 a yes signs the switch of the seat and pins every seat of this browser");

// ── The device check: once per open wallet, in the background, shown on the tile ──
{
  for (const i of [1, 2, 3]) await putSol(c.host, gid, i, { proveCheck: null });
  const known = new Set(data.keys());
  chain.selftest = () => {
    throw new Error("This device could not start the local prover. Nothing was sent to Helius.");
  };
  Object.assign(c, { viewed: true, proveChecked: false });
  const before = selftests();
  notify();
  await waitFor("the device check", () => solOf(1).proveCheck?.ok === false);
  assert.match(checkLine(c, 1), /could not make a test proof, so it cannot pay .* local prover/);
  assert.equal(selftests(), before + 1);
  await sleep(300);
  notify();
  await sleep(300);
  assert.equal(selftests(), before + 1, "a failed check ran again");
  const added = [...data.keys()].filter((k) => !known.has(k) && !k.includes("/solprove/"));
  assert.deepEqual(added, [], "the device check wrote to the group server");
  chain.selftest = () => ({ ms: 3100 });
  // A browser that cannot store the result still checks once per open wallet, not on each pass.
  for (const i of [1, 2, 3]) await putSol(c.host, gid, i, { proveCheck: null });
  const putSec = c.host.putSec;
  c.host.putSec = async () => false;
  c.proveChecked = false;
  const once = selftests();
  for (let i = 0; i < 3; i += 1) {
    notify();
    await sleep(300);
  }
  c.host.putSec = putSec;
  assert.equal(selftests(), once + 1, "a check that could not be stored ran again");
  // A check that ends after a wallet switch stores nothing: the Worker of that wallet was closed.
  for (const i of [1, 2, 3]) await putSol(c.host, gid, i, { proveCheck: null });
  const opened = c.opened;
  chain.selftest = () => {
    c.opened += 1;
    throw new Error("The Solana worker was closed");
  };
  c.proveChecked = false;
  notify();
  await waitFor("the check ends", () => c.proveChecked && selftests() === once + 2);
  await sleep(300);
  c.opened = opened;
  chain.selftest = () => ({ ms: 3100 });
  assert.equal(solOf(1).proveCheck, undefined, "a check of a closed wallet was stored");
}
step("SOL-4 a seat that sees the switch tests its device once, and the tile shows the result");

console.log("sol-prove: ok");
process.exit(0);
