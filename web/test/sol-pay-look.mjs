// Payments against the fake chain, part 5 of sol-pay.mjs: a tab with no funded seat that reads
// the proposal account once a minute, and an account that another device executed.
// Run: node web/test/sol-pay-look.mjs   (Node 26)
import assert from "node:assert/strict";
import { approve } from "../sol/approve.js";
import { base58 } from "../sol/docs.js";
import { forgetBalances } from "../sol/execute.js";
import { c, chain, ssOf, waitFor, waitStatus } from "./sol-setup.mjs";
import { step } from "./sol-vector.mjs";
import {
  FUNDED,
  approvalOf,
  count,
  cur,
  forgetPairs,
  fund,
  installTestGroup,
  proposedPay,
} from "./sol-pay-rig.mjs";

await installTestGroup();

// ── An unfunded tab: a refused account read shows its text, no try, one read a minute ──
{
  await forgetPairs();
  const id = await proposedPay();
  cur.id = id;
  fund([0n, 0n, 0n]);
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitFor("signed", () => ssOf(id).status === "signed");
  const refused = "Helius refused this website. Its key does not allow this domain.";
  const address = base58(ssOf(id).account);
  const get = chain.accounts.get;
  chain.accounts.get = function (key) {
    if (key === address) throw new Error(refused);
    return get.call(this, key);
  };
  forgetBalances();
  await waitFor("the text of the refused read", () => c.execErrors[id] === refused, 30000);
  assert.equal(c.tries[id] ?? 0, 0, "a refused account read counts no try");
  const reads = count("account");
  await new Promise((done) => setTimeout(done, 16_000)); // one more pass of the tab
  assert.equal(count("account"), reads, "no second account read within a minute");
  assert.equal(c.execErrors[id], refused, "the text stays between the reads");
  delete chain.accounts.get;
  fund(FUNDED);
  await waitStatus(id, "sent", 90000);
}
step("a tab with no funded seat shows a refused account read and reads once a minute");

// ── An account that another device executed is read back as sent ──
{
  await forgetPairs();
  const id = await proposedPay();
  cur.id = id;
  const ss = ssOf(id);
  const elsewhere = "4".repeat(88);
  const before = chain.refuse;
  chain.refuse = "Custom 9999"; // this device cannot land it
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitFor("a refused try", () => (c.tries[id] ?? 0) >= 1);
  // Someone sent lamports to the open account, then the execute of another device closed it.
  // Later, someone sent lamports to the address again (a System account now) and landed a
  // transaction that names it. Only the execute carries the approval of this payment.
  const address = base58(ss.account);
  chain.accounts.set(address, { owner: "00".repeat(32), data: "" });
  const [early, late] = ["6".repeat(88), "7".repeat(88)];
  chain.history.set(address, [
    { signature: late, failed: false, slot: "14" },
    { signature: elsewhere, failed: false, slot: "12" },
    { signature: "5".repeat(88), failed: true, slot: "11" },
    { signature: early, failed: false, slot: "10" },
    ...(chain.history.get(address) ?? []),
  ]);
  const base64 = (text) => Buffer.from(text, "hex").toString("base64");
  const tx = (text) => ({ found: true, failed: false, tx: base64(text) });
  chain.txs.set(elsewhere, tx("aa" + approvalOf(ssOf(id)) + "bb"));
  // A failed execute of this payment by another device carries the approval too.
  chain.txs.set("5".repeat(88), { ...tx("dd" + approvalOf(ssOf(id))), failed: true });
  // An earlier memo with the approval signature alone, and a later copy of the whole approval.
  chain.txs.set(early, tx("cc" + ssOf(id).signature));
  chain.txs.set(late, tx("ee" + approvalOf(ssOf(id))));
  chain.refuse = before;
  await waitStatus(id, "sent");
  assert.equal(ssOf(id).txId, elsewhere, "the transaction that holds the approval");
}
step("an execute that another device landed is read back from the history of the account");
console.log("sol-pay-look: ok");
process.exit(0);
