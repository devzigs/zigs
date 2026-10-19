// Add SOL (ZOLANA.md 2 and 5): a pool deposit from the fee address of a seat of this browser into
// the shielded balance of the group. It is the SOL of one member, so the seat signs alone with its
// fee key: no approval round and no group signature. The message has a recent blockhash and no
// nonce, so it never touches the nonce account of the group. The amount and the sender are
// public. The wasm runs the checker on the exact bytes before the fee key signs, so the deposit
// goes to the shielded address of the group and to nobody else.
import { feeSignature } from "./approve.js";
import { agreement } from "./ceremony.js";
import { base58 } from "./docs.js";
import { poorFeeText, readyFee } from "./fee.js";
import { payerSeat, settledBlock } from "./gate.js";
import { bytesOf, hexOf, intentHex, lamportsOf, pinsHex, wireBase64 } from "./intent.js";
import { ensureWorker } from "./session.js";

/** What the network said to a test run of the deposit, as a text for the page. */
function refusalOf(run, seat) {
  const logs = run.logs.join(" | ").slice(0, 300);
  return (
    poorFeeText(run, seat) ?? "The network refused this in a test run: " + run.err + " " + logs
  );
}

/**
 * The first ready seat of this browser adds `args.amount` (SOL, as text) to the shielded balance
 * of the group. Resolves with { seat, amount, txId, status, slot, at } once the transaction is
 * confirmed or the wait ended (status "unknown"). `at` is the time of the answer (ms).
 */
export async function addSol(c, args) {
  const block = await settledBlock(c);
  if (block) throw new Error(block);
  const seat = payerSeat(c);
  const amount = lamportsOf(args.amount);
  if (amount === null) throw new Error("Enter an amount of SOL, for example 0.02.");
  const fee = readyFee(c, seat);
  const worker = await ensureWorker(c);
  const { blockhashHex } = await worker.call("blockhash");
  const intent = intentHex("shield", { blockhash: blockhashHex, amount });
  const pins = bytesOf(pinsHex(agreement(c).done, fee.key));
  const message = c.W.compile_message(bytesOf(intent), pins, new Uint8Array(0));
  const proposal = { id: "add-sol", by: seat, intent, message: hexOf(message) };
  const signature = feeSignature(c, proposal, seat);
  const tx = wireBase64(message, bytesOf(signature));
  const run = await worker.call("simulate", { tx });
  if (run.err !== null) throw new Error(refusalOf(run, seat));
  await worker.call("send", { tx });
  const txId = base58(signature);
  const { status, slot } = await worker.call("confirm", { signature: txId });
  c.host.log("seat " + seat + ": added SOL, " + status);
  return { seat, amount, txId, status, slot, at: Date.now() };
}
