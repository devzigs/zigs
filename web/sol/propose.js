// The proposal of a Solana intent (ZOLANA.md 5, steps 1 and 2). A seat picks the kind and its
// values: the amount of a shield, the payee and the amount of a private payment. The Worker reads
// the lifetime of the message from the chain: a recent blockhash for the nonce account, the value
// of the nonce for every later intent. A private payment is proved first (the Worker prepares the
// transact data and the plaintext outputs). The wasm compiles the message from the fixed
// template, this device checks it as an approver would, the network runs it once without
// signatures, and only then does the seat sign and publish the proposal part.
import { agreement } from "./ceremony.js";
import { base58 } from "./docs.js";
import { settledBlock, writerSeats } from "./gate.js";
import {
  bytesOf,
  hexOf,
  intentHex,
  isAddress,
  lamportsOf,
  nonceAccountHex,
  pinsHex,
  planHex,
  wireBase64,
} from "./intent.js";
import { reviewOf } from "./approve.js";
import { ensureWorker } from "./session.js";
import { writePart } from "./sessions.js";
import { pairsBefore } from "./spend.js";

/** A proof binds an expiry: 23 hours, inside the 24 hour window of the checker and its skew. */
const EXPIRY_SECS = 23 * 3600;

const newId = () => hexOf(crypto.getRandomValues(new Uint8Array(16)));

/** The lifetime that the message of this kind needs, read from the chain. */
async function lifetimeOf(worker, kind, groupKey) {
  const owner = base58(groupKey);
  const account = base58(await nonceAccountHex(groupKey));
  if (kind === "createNonce") {
    const held = await worker.call("balance", { account });
    if (held.lamports !== "0") throw new Error("The nonce account exists already.");
    return { blockhash: (await worker.call("blockhash")).blockhashHex };
  }
  const found = await worker.call("readNonce", { account }).catch(() => null);
  if (found === null) throw new Error("Create the nonce account first.");
  if (found.authority !== owner) throw new Error("The nonce account is not owned by the group.");
  return { nonce: found.nonceHex };
}

/** The network runs the message once, with no signature. Nothing is charged. */
async function preflight(worker, messageHex) {
  const tx = wireBase64(bytesOf(messageHex), new Uint8Array(64));
  const run = await worker.call("preflight", { tx });
  if (run.err === null) return;
  const logs = run.logs.join(" | ").slice(0, 300);
  throw new Error("The network refused this message in a test run: " + run.err + " " + logs);
}

function valuesOf(kind, args) {
  if (kind !== "shield") return {};
  const amount = lamportsOf(args.amount);
  if (amount === null) throw new Error("Enter an amount of SOL, for example 0.02.");
  return { amount };
}

/** The fields of a proposal that has no plan: the intent only. */
async function plainDraft(c, worker, kind, args) {
  const values = valuesOf(kind, args),
    done = agreement(c).done;
  const when = await lifetimeOf(worker, kind, done.groupKey);
  return { fields: { intent: intentHex(kind, { ...when, ...values, ...done }) } };
}

/** The tree fee and the inputs of a draft payment: the snapshot for the check of the proposer. */
async function draftSpend(c, worker, prepared) {
  const fees = await worker.call("treeFees", { tree: prepared.inputs[0].tree });
  return {
    fee: fees.feePerNullifier,
    inputs: prepared.inputs.map(({ mint, amount, blinding }) => ({ mint, amount, blinding })),
    salts: pairsBefore(c, "new"),
  };
}

/**
 * A private payment: the Worker proves it (a few seconds), then the nonce is read, so the message
 * names the nonce as late as possible. The intent holds the payee and the amount that the
 * approvers confirm. The plan, the input ids, the salt and the expiry are the proposer's claims:
 * every approver checks them again on its own snapshot.
 */
async function transferDraft(c, worker, kind, args) {
  const done = agreement(c).done;
  const payee = String(args.recipient ?? "").trim().toLowerCase();
  const amount = lamportsOf(args.amount);
  if (!isAddress(payee)) throw new Error("Enter the full shielded address of the payee.");
  if (amount === null) throw new Error("Enter an amount of SOL, for example 0.005.");
  const expiry = BigInt(Math.floor(Date.now() / 1000) + EXPIRY_SECS);
  const request = { kind, recipient: payee, amount: String(amount), expiry: String(expiry) };
  const prepared = await worker.call("prepare", request);
  const { nonce } = await lifetimeOf(worker, kind, done.groupKey);
  const counts = { inputs: prepared.inputs.length, outputs: prepared.outputs.length };
  const intent = intentHex(kind, { nonce, expiry, ...counts, payee, amount });
  const fields = {
    intent,
    plan: planHex(prepared),
    inputIds: prepared.inputs.map((input) => input.id),
    salt: prepared.salt,
    expiry: prepared.expiry,
  };
  const spend = await draftSpend(c, worker, prepared);
  return { fields, spend, transact: bytesOf(prepared.data) };
}

const DRAFTS = { transfer: transferDraft };

/**
 * Seat 1..n of this browser proposes `kind` ("createNonce", "register", "shield" with
 * `args.amount` in SOL, or "transfer" with `args.recipient` and `args.amount`). Resolves with the
 * session id.
 */
export async function propose(c, kind, args = {}) {
  const block = await settledBlock(c);
  if (block) throw new Error(block);
  const seat = writerSeats(c)[0];
  if (seat === undefined) throw new Error("This browser holds no seat that can sign for Solana.");
  const worker = await ensureWorker(c);
  const draft = await (DRAFTS[kind] ?? plainDraft)(c, worker, kind, args);
  const pins = bytesOf(pinsHex(agreement(c).done));
  const proposal = bytesOf(draft.fields.intent + (draft.fields.plan ?? ""));
  const compiled = c.W.compile_message(proposal, pins, draft.transact ?? new Uint8Array(0));
  const fields = { ...draft.fields, message: hexOf(compiled), createdAt: Date.now() };
  const own = reviewOf(c, { id: "new", status: "collecting", ...fields }, seat, draft.spend);
  if (!own.ok) throw new Error(own.why);
  await preflight(worker, fields.message);
  const id = newId();
  await writePart(c, id, "proposal", fields, { seat, create: true });
  c.host.log("seat " + seat + ": proposed " + kind);
  return id;
}
