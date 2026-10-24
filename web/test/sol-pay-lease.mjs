// Payments against the fake chain, part 4 of sol-pay.mjs: the lease of another device, a signed
// payment that ends at its expiry, a payment that expired, and the move of the beta funds.
// Run: node web/test/sol-pay-lease.mjs   (Node 26)
import assert from "node:assert/strict";
import { approve } from "../sol/approve.js";
import { base58 } from "../sol/docs.js";
import { EXECUTE_TRIES, tryAgain } from "../sol/execute.js";
import { decodeIntent } from "../sol/intent.js";
import { savedNonces } from "../sol/nonces.js";
import { feeOf } from "../sol/fee.js";
import { syncSolana } from "../sol/session.js";
import { writePart } from "../sol/sessions.js";
import { verifies } from "./sol-chain.mjs";
import { G, preparedOf, transactOf, utxoOf } from "./sol-fixture.mjs";
import { c, chain, hook, notify, proposed, ssOf, waitFor, waitStatus } from "./sol-setup.mjs";
import { step } from "./sol-vector.mjs";
import {
  DAY,
  FUNDED,
  count,
  cur,
  forgetPairs,
  fund,
  installTestGroup,
  later,
  marked,
  pause,
  proposedPay,
  realNow,
  textOf,
} from "./sol-pay-rig.mjs";

await installTestGroup();

// ── The lease of another device holds the execute back; the last try waits for a click ──
{
  await forgetPairs();
  const id = await proposedPay();
  cur.id = id;
  // Another device holds the lease of the execute (the signing round has its own leases).
  hook.lease = (p) => !(p.endsWith("/" + id) && ssOf(id)?.status === "signed");
  const sims = count("simulate");
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitStatus(id, "signed");
  await pause(5000);
  assert.equal(count("simulate"), sims, "no execute while another device holds the lease");
  hook.lease = () => true;
  chain.refuse = "Custom 9999";
  await waitFor("the tries", () => (c.tries[id] ?? 0) >= EXECUTE_TRIES, 60000);
  const tried = count("simulate");
  await pause(5000);
  assert.equal(count("simulate"), tried, "no try after the last one without a click");
  assert.equal(marked("execute-" + id).length, 1, "the card offers to try again");
  chain.refuse = null;
  tryAgain(c, ssOf(id)); // the button of the card

  await waitStatus(id, "sent");
}
step("an execute waits for the lease of another device, and stops after its tries");

// ── A signed payment whose tries ran out still ends at its expiry, with no click ──
{
  await forgetPairs();
  const id = await proposedPay();
  cur.id = id;
  chain.refuse = "Custom 9999";
  const delays = []; // a quiet tab: the step arms a pass of the reactor for the end of the payment
  const setTimer = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...rest) => (delays.push(ms), setTimer(fn, ms, ...rest));
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitFor("the tries", () => (c.tries[id] ?? 0) >= EXECUTE_TRIES, 60000);
  const end = (Number(ssOf(id).expiry) + 600) * 1000 + 1000;
  const armed = () => delays.some((ms) => Math.abs(Date.now() + ms - end) < 10_000);
  notify();
  await waitFor("the pass at the end of the payment", armed);
  globalThis.setTimeout = setTimer;
  assert.equal(marked("execute-" + id).length, 1, "before the expiry the card asks for a click");
  chain.refuse = null;
  const [sims, sends] = [count("simulate"), count("send")];
  // First the node shows no account and a history with no create: the end check fails.
  const address = base58(ssOf(id).account);
  const [stored, history] = [chain.accounts.get(address), chain.history.get(address)];
  chain.accounts.delete(address);
  chain.history.set(address, []);
  later(DAY);
  notify(); // a pass of the reactor, with no click
  const unread = () => /history of the proposal account is not complete/.test(c.execErrors[id]);
  await waitFor("the failed end check", unread);
  assert.equal(c.tries[id], EXECUTE_TRIES, "a failed end check is no new try");
  // Then the node shows the open account: the end check reads again later, and the payment ends.
  chain.accounts.set(address, stored);
  chain.history.set(address, history);
  await waitStatus(id, "failed", 60000);
  Date.now = realNow;
  assert.match(ssOf(id).error, /expired before it was executed/);
  assert.equal(c.tries[id], EXECUTE_TRIES, "the end check is no new try");
  assert.equal(count("simulate"), sims, "it tests no execute");
  assert.equal(count("send"), sends, "and sends nothing");
}
step("a signed payment whose tries ran out ends at its expiry, with no click and no new try");

// ── A signed payment past its expiry ends also when no seat of this browser can pay ──
{
  await forgetPairs();
  const id = await proposedPay();
  cur.id = id;
  fund([0n, 0n, 0n]);
  const reads = count("balance");
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitFor("the look of the tab", () => count("balance") >= reads + 3);
  assert.equal(ssOf(id).status, "signed", "no seat can pay: no execute");
  later(DAY); // past the expiry and the clock margin of 600 s
  await waitStatus(id, "failed", 60000);
  Date.now = realNow;
  assert.match(ssOf(id).error, /expired before it was executed/);
  fund(FUNDED);
}
step("a signed payment with no funded seat still ends at its expiry: its end pays no fee");

// ── The one-time move of the beta funds: the card shows while the group key holds SOL ──
{
  // The card counts only the notes that a move can take.
  const stuck = { ...utxoOf(G.migrate), hash: "ef".repeat(32), movable: false };
  chain.oldUtxos = [utxoOf(G.migrate), stuck];
  await syncSolana(c);
  assert.equal(c.sync.oldBalance, G.migrate.inputs[0].amount, "the movable SOL of the old address");

  chain.oldUtxos = [];
  const kept = { sync: c.sync, chain: c.chain };
  c.sync = { ...c.sync, oldBalance: "5000000" };
  c.chain = { ...c.chain, nonce: "missing" };
  assert.equal(marked("move").length, 1, "the card of the move");
  assert.match(textOf(marked("move")[0]), /links the old address .* in public\. Helius makes/);
  assert.equal(marked("create-nonce").length, 1, "first the nonce account");
  assert.equal(marked("move-funds").length, 0);
  c.chain = { ...c.chain, nonce: "created" };
  assert.equal(textOf(marked("move-funds")[0]), "Move to the program address");
  assert.equal(textOf(marked("move-held")[0]), "Old address: 0.005 SOL", "the balance to move");
  c.sync = { ...c.sync, oldBalance: "0" };
  assert.equal(marked("move").length, 0, "no card once the funds moved");
  Object.assign(c, kept);
}
step("the move of the beta funds shows as a one-time step");

// ── A payment that expired ends, and an Approve gives way to the reason ──
{
  const id = "expired-pay";
  const ss = ssOf(cur.id);
  const PARTS = ["intent", "plan", "inputIds", "salt", "transact", "account", "body", "createTx"];
  const late = Object.fromEntries(PARTS.map((k) => [k, ss[k]]));
  await forgetPairs();
  // Inside the margin for the clock of the device (600 s): no end yet.
  const fields = (secs) => ({ ...late, expiry: String(secs), createdAt: Date.now() });
  const just = fields(Math.floor(Date.now() / 1000) - 100);
  await writePart(c, "just-expired", "proposal", just, { seat: 1, create: true });
  await waitFor("the session", () => ssOf("just-expired"));
  await pause(1500);
  assert.equal(ssOf("just-expired").status, "collecting", "the clock margin of the device");
  late.expiry = String(Math.floor(Date.now() / 1000) - 700); // past the clock margin
  await writePart(c, id, "proposal", { ...late, createdAt: Date.now() }, { seat: 1, create: true });
  await waitStatus(id, "failed");
  assert.match(ssOf(id).error, /expired before it was executed/);
}
step("a payment past its expiry ends with a clear text");

// ── The move of the beta funds: the last payment with a nonce ──
{
  // A second old note that this move does not take: the Worker moves whole UTXOs, as many as one
  // proof takes, and the intent names what it moves, not the old balance.
  const extra = { ...utxoOf(G.migrate), hash: "ee".repeat(32), amount: "1000" };
  chain.oldUtxos = [utxoOf(G.migrate), extra];
  chain.inspected = { salt: G.migrate.salt, firstNullifier: G.migrate.inputs[0].nullifier };
  const moved = BigInt(G.migrate.inputs[0].amount);
  chain.prepared = (args) => {
    assert.equal(args.kind, "migrate", "the move spends the group key");
    assert.equal(args.recipient, G.group.pdaAddress, "to the PDA address of the group");
    assert.equal(args.amount, String(moved + 1000n), "the old balance is the bound of the move");
    return preparedOf(G.migrate, args);
  };
  const nonceRun = await proposed("createNonce");
  await approve(c, ssOf(nonceRun), 1);
  await approve(c, ssOf(nonceRun), 2);
  await waitStatus(nonceRun, "sent");
  const id = await proposed("migrate");
  assert.equal(decodeIntent(ssOf(id).intent).kind, "transfer");
  assert.equal(decodeIntent(ssOf(id).intent).amount, moved, "the intent names the moved amount");
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitStatus(id, "sent");
  const landed = chain.landed.find((x) => x.signature === ssOf(id).txId);
  assert.equal(landed.sigs.length, 2, "the payer first, then the group key");
  const message = Buffer.from(landed.message, "hex");
  const [payerSig, groupSig] = landed.sigs.map((s) => Buffer.from(s, "hex"));
  assert.ok(verifies(feeOf(c, 1).key, message, payerSig), "the fee key of seat 1 paid");
  assert.ok(verifies(G.group.key, message, groupSig), "the group key signed the move");
  assert.equal(ssOf(id).txId, base58(landed.sigs[0]), "the id is the first signature");
  const dataHex = transactOf(G.migrate, decodeIntent(ssOf(id).intent).expiry);
  assert.ok(landed.message.includes(dataHex), "the message holds the transact data of the move");
}
step("the beta funds move to the PDA address with the last nonce payment");

// ── A move on a nonce that changed after the proposal: no approval, no nonces ──
{
  await forgetPairs();
  chain.inspected = { salt: G.migrate2.salt, firstNullifier: G.migrate2.inputs[0].nullifier };
  chain.prepared = (args) => preparedOf(G.migrate2, args);
  const fresh = await proposed("migrate");
  const kept = chain.nonce;
  chain.nonce = "cd".repeat(32);
  await assert.rejects(() => approve(c, ssOf(fresh), 1), /nonce changed/);
  assert.equal(savedNonces(c, 1, fresh), undefined, "no nonces for a stale proposal");
  chain.nonce = kept;
  // The nonce holds again, but the proof of the move went stale before the send (error 7008).
  chain.refuse = JSON.stringify({ InstructionError: [1, { Custom: 7008 }] });
  await approve(c, ssOf(fresh), 1);
  await approve(c, ssOf(fresh), 2);
  await waitStatus(fresh, "failed");
  chain.refuse = null;
  assert.match(ssOf(fresh).error, /proof expired because the pool moved on/);
}
step("a move on a stale nonce is refused, and a stale proof at the send ends the move");
console.log("sol-pay-lease: ok");
process.exit(0);
