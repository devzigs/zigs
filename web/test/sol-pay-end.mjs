// Payments against the fake chain, part 6 of sol-pay.mjs: how a signed payment ends when its
// account is gone, open or incomplete in the history, and the sent mark.
// Run: node web/test/sol-pay-end.mjs   (Node 26)
import assert from "node:assert/strict";
import { approve } from "../sol/approve.js";
import { base58 } from "../sol/docs.js";
import { tryAgain } from "../sol/execute.js";
import { readSolSession } from "../sol/sessions.js";
import { c, chain, ssOf, waitFor, waitStatus } from "./sol-setup.mjs";
import { step } from "./sol-vector.mjs";
import {
  DAY,
  approvalOf,
  cur,
  forgetPairs,
  installTestGroup,
  later,
  pause,
  proposedPay,
  realNow,
} from "./sol-pay-rig.mjs";

await installTestGroup();

// ── An account that is gone with only its create in the history: the session ends ──
{
  await forgetPairs();
  const id = await proposedPay();
  cur.id = id;
  chain.refuse = "Custom 9999";
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitFor("a refused try", () => (c.tries[id] ?? 0) >= 1);
  chain.accounts.delete(base58(ssOf(id).account));
  chain.refuse = null;
  // Before the expiry a node may lag: the page reads the history again later, and fails nothing.
  await pause(6000);
  assert.equal(ssOf(id).status, "signed", "no failure before the expiry");
  later(DAY);
  await waitStatus(id, "failed", 60000);
  Date.now = realNow;
  assert.match(ssOf(id).error, /no execute of it landed/);
}
step("an account that is gone with no execute in its history ends the session at the expiry");

// ── A signed payment past its expiry with its account still open ends ──
{
  await forgetPairs();
  const id = await proposedPay();
  cur.id = id;
  chain.refuse = "Custom 9999";
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitFor("a refused try", () => (c.tries[id] ?? 0) >= 1);
  chain.refuse = null;
  later(DAY);
  tryAgain(c, ssOf(id));
  await waitStatus(id, "failed");
  Date.now = realNow;
  assert.match(ssOf(id).error, /expired before it was executed/);
  assert.ok(chain.accounts.has(base58(ssOf(id).account)), "it read the open account first");
}
step("a signed payment past its expiry ends only after the page read its open account");

// ── A history that the node does not give in full: the page reads it again, no failure ──
{
  await forgetPairs();
  const id = await proposedPay();
  cur.id = id;
  chain.refuse = "Custom 9999";
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitFor("a refused try", () => (c.tries[id] ?? 0) >= 1);
  const address = base58(ssOf(id).account);
  const [create] = chain.history.get(address);
  chain.accounts.delete(address);
  chain.refuse = null;
  const executed = "8".repeat(88);
  const unread = () => /history of the proposal account is not complete/.test(c.execErrors[id]);
  // Past the expiry the page reports an incomplete history (before it, it waits in silence).
  later(DAY);
  const readAgain = async (history, what) => {
    chain.history.set(address, history);
    delete c.execErrors[id];
    tryAgain(c, ssOf(id));
    await waitFor(what, unread);
    assert.equal(ssOf(id).status, "signed", what + ": no failure");
  };
  // A history that does not reach back to the create, then one whose execute the node lacks.
  const other = "9".repeat(88);
  chain.txs.set(other, { found: true, failed: false, tx: Buffer.from([0xcc]).toString("base64") });
  await readAgain([{ signature: other, failed: false, slot: "13" }], "no create");
  chain.txs.set(executed, { found: false, failed: false, tx: "" });
  const entry = { signature: executed, failed: false, slot: "12" };
  await readAgain([entry, create], "an unread execute");
  const signed = Buffer.from("aa" + approvalOf(ssOf(id)), "hex").toString("base64");
  chain.txs.set(executed, { found: true, failed: false, tx: signed });
  tryAgain(c, ssOf(id));
  await waitStatus(id, "sent");
  Date.now = realNow;
  assert.equal(ssOf(id).txId, executed, "the execute, once the node gives it, past the expiry");
}
step("a history with no create or with an unread transaction is read again, not failed");

// ── The sent mark of a payment needs the approval signature and a transaction id ──
{
  const ss = ssOf(cur.id);
  const PARTS = ["intent", "plan", "inputIds", "salt", "transact", "account", "body", "createTx"];
  const d = Object.fromEntries([...PARTS, "expiry", "createdAt"].map((k) => [k, ss[k]]));
  Object.assign(d, { package: "{}", signers: [1, 2], digest: "d".repeat(64) });
  Object.assign(d, { signature: "55".repeat(64), slot: "1", outcome: "confirmed" });
  const read = (txId) => readSolSession("x", { ...d, txId }, () => "yes").ss?.status;
  assert.equal(read("4".repeat(88)), "sent", "the control");
  assert.equal(read("short"), "signed", "a sent mark with no transaction id does not count");
  const failedMark = { ...d, txId: "4".repeat(88), outcome: "failed" };
  const status = readSolSession("x", failedMark, () => "yes").ss?.status;
  assert.equal(status, "signed", "a failed execute does not count as sent");
}
step("the sent mark of a payment needs a transaction id");
console.log("sol-pay-end: ok");
process.exit(0);
