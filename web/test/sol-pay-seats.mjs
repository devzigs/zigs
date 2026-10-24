// Payments against the fake chain, part 3 of sol-pay.mjs: a refused balance read, a retry after
// a dropped send, a tab that marks an execute of another device, a browser with no fee address
// that can pay, and a create that fails or lands late.
// Run: node web/test/sol-pay-seats.mjs   (Node 26)
import assert from "node:assert/strict";
import { approve } from "../sol/approve.js";
import { base58 } from "../sol/docs.js";
import { forgetBalances } from "../sol/execute.js";
import { bytesOf } from "../sol/intent.js";
import { feeOf } from "../sol/fee.js";
import { solView } from "../sol/view.js";
import { verifies } from "./sol-chain.mjs";
import { c, chain, data, ssOf, waitFor, waitStatus } from "./sol-setup.mjs";
import { step } from "./sol-vector.mjs";
import {
  FUNDED,
  approvalOf,
  count,
  cur,
  forgetPairs,
  fund,
  installTestGroup,
  marked,
  node,
  proposedPay,
  textOf,
} from "./sol-pay-rig.mjs";

await installTestGroup();

// ── A refused balance read is no empty seat: the card shows its text, and no try counts ──
{
  await forgetPairs();
  const id = await proposedPay();
  cur.id = id;
  const refused = "Too many Helius calls. Wait a minute.";
  const card = () => textOf(solView({ ...c, host: { ...c.host, el: node } }, (fn) => fn, {}));
  chain.balances.get = () => {
    throw new Error(refused);
  };
  forgetBalances();
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitFor("the text of the refused reads", () => c.execErrors[id] === refused);
  assert.equal(ssOf(id).status, "signed", "no execute without a read of the balance");
  assert.equal(c.tries[id] ?? 0, 0, "a refused read counts no try");
  assert.ok(card().includes(refused), "the card shows the text of the Worker");
  assert.equal(c.execWait[id], undefined, "a refused read is no seat that cannot pay");
  assert.ok(!card().includes("No device of this browser can pay"), "and no line of the wait");
  delete chain.balances.get; // the reads work again
  await waitStatus(id, "sent", 90000);
  assert.equal(c.execErrors[id], undefined, "the text goes with the next good read");
  assert.equal(c.tries[id] ?? 0, 0, "and no try was counted");
}
step("a refused balance read shows its text, counts no try, and the next good read executes");

// ── A retry after a dropped send uses the seat that sent, not the first seat ──
{
  await forgetPairs();
  const id = await proposedPay();
  cur.id = id;
  fund([0n, 0n, 5_000_000n]); // only seat 3 can pay
  chain.sendMode = "late";
  const sent = count("send");
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitFor("the send of seat 3", () => c.sending[id] !== undefined, 60000);
  assert.equal(c.sending[id].seat, 3, "the tab keeps the seat that sent");
  const poor = [];
  const watch = setInterval(() => poor.push(c.execErrors[id] ?? ""), 50);
  chain.late.splice(0); // the send is dropped: it never lands
  chain.sendMode = null;
  c.sending[id].at -= 200_000; // past the send window: the retry runs
  await waitStatus(id, "sent", 60000);
  clearInterval(watch);
  assert.ok(!poor.some((text) => /too little Devnet SOL/.test(text)), "no text of an empty seat");
  assert.equal(c.tries[id] ?? 0, 0, "the retry is no counted try");
  assert.equal(count("send"), sent + 2, "the dropped send, then the retry");
  const landed = chain.landed.find((x) => x.signature === ssOf(id).txId);
  assert.ok(verifies(feeOf(c, 3).key, bytesOf(landed.message), bytesOf(landed.sigs[0])));
  fund(FUNDED);
}
step("a retry after a dropped send uses the seat that sent it");

// ── A tab with no funded seat writes the mark of an execute that another device landed ──
{
  await forgetPairs();
  const id = await proposedPay();
  cur.id = id;
  fund([0n, 0n, 0n]);
  const sent = count("send");
  const reads = count("balance");
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitFor("the look of the tab", () => count("balance") >= reads + 3);
  assert.equal(ssOf(id).status, "signed", "the account is open: nothing to mark yet");
  // Another device executed it: the account is a System account, the history holds the execute.
  const address = base58(ssOf(id).account);
  const executed = "3".repeat(88);
  const tx = Buffer.from("aa" + approvalOf(ssOf(id)), "hex").toString("base64");
  chain.accounts.set(address, { owner: "00".repeat(32), data: "" });
  chain.history.set(address, [
    { signature: executed, failed: false, slot: "14" },
    ...(chain.history.get(address) ?? []),
  ]);
  chain.txs.set(executed, { found: true, failed: false, tx });
  forgetBalances(); // the tab looks at the account once a minute: the next pass looks now
  await waitStatus(id, "sent", 60000);
  assert.equal(ssOf(id).txId, executed, "the transaction of the history");
  assert.equal(count("send"), sent, "the tab sent nothing");
  assert.equal(c.tries[id] ?? 0, 0, "and counted no try");
  assert.equal(c.execWait[id], undefined, "the account that is gone clears the line of the wait");
  fund(FUNDED);
}
step("a tab with no funded seat marks an execute that another device landed");

// ── No fee address of this browser can pay: a neutral line says why, and no try counts ──
{
  await forgetPairs();
  const id = await proposedPay();
  cur.id = id;
  fund([999_999n, 999_999n, 999_999n]); // the create needs seat 1 funded, so this comes after it
  const sends = count("send");
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitFor("the line of the wait", () => c.execWait[id] !== undefined);
  const [line] = marked("exec-wait-" + id);
  const NEEDS = /^No device of this browser can pay the execute\. A fee address needs 0\.001 SOL/;
  assert.match(textOf(line), NEEDS);
  assert.doesNotMatch(line.attrs.class, /\bbad\b/, "the line is no error");
  assert.equal(c.execErrors[id], undefined, "no red text");
  assert.equal(c.tries[id] ?? 0, 0, "no try");
  assert.equal(count("send"), sends, "nothing sent");
  // Seat 3 gets the exact minimum. Its execute lands late, so the card shows it while signed.
  chain.sendMode = "late";
  fund([999_999n, 999_999n, 1_000_000n]);
  await waitFor("the send of seat 3", () => c.sending[id] !== undefined, 60000);
  assert.equal(c.sending[id].seat, 3, "the funded seat executes");
  assert.equal(ssOf(id).status, "signed", "the execute did not land yet");
  assert.equal(marked("exec-wait-" + id).length, 0, "the funded seat clears the line");
  assert.equal(c.execErrors[id], undefined, "and no red text shows");
  chain.sendMode = null;
  chain.release();
  await waitStatus(id, "sent");
  const landed = chain.landed.find((x) => x.signature === ssOf(id).txId);
  assert.ok(verifies(feeOf(c, 3).key, bytesOf(landed.message), bytesOf(landed.sigs[0])));
  fund(FUNDED);
}
step("a browser with no funded seat says why on the card; a funded seat clears it and executes");

// ── A create that fails writes no session; a create that lands late is waited for ──
{
  await forgetPairs();
  const stored = () => [...data.keys()].filter((k) => k.includes("solsessions/")).length;
  const before = stored();
  chain.sendMode = "fail";
  await assert.rejects(() => proposedPay(), /not confirmed yet \(failed\)/);
  assert.equal(stored(), before, "no session for a create that failed");
  chain.sendMode = "late";
  setTimeout(() => {
    chain.sendMode = null;
    chain.release();
  }, 5000);
  const id = await proposedPay();
  assert.ok(chain.accounts.has(base58(ssOf(id).account)), "the late create landed first");
}
step("a create that fails on chain writes no session, and a late create is waited for");
console.log("sol-pay-seats: ok");
process.exit(0);
