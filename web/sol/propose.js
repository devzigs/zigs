// The proposal of a Solana intent (ZOLANA.md 5, steps 1 and 2, and 7.2). The fee key of the
// proposing seat pays (fee.js).
//
// A private payment (`pay`) is a payment of the program design: the Worker proves it once (the
// first proof holds the outputs and the ciphertexts that the commitment binds), the checker of
// this device accepts it as an approver would and gives its commitment, body and proposal account,
// and the fee key signs the create message of that account, after the checker accepted it. The
// account is created on chain first, then the seat publishes the proposal part. The group then
// approves its digest once, with no nonce.
//
// The move of the beta funds to the PDA (`migrate`, and `createNonce` when the nonce account is
// missing) is the one nonce payment left: the message is compiled from the fixed template with the
// nonce, signed by the fee key, run once without the group signature, and then proposed.
import { agreement } from "./ceremony.js";
import { base58 } from "./docs.js";
import { poorFeeText, readyFee } from "./fee.js";
import { payerSeat, settledBlock } from "./gate.js";
import {
  bytesOf,
  hexOf,
  intentHex,
  isAddress,
  lamportsOf,
  nonceAccountHex,
  paymentHex,
  pinsHex,
  planHex,
  readVerdict,
  snapshotHex,
  wireBase64,
} from "./intent.js";
import { feeSignature, refusalText, reviewOf, rolesOf, signAsFee } from "./approve.js";
import { ensureWorker } from "./session.js";
import { writePart } from "./sessions.js";
import { pairsBefore } from "./spend.js";

/** A proof binds an expiry: 23 hours, inside the 24 hour window of the checker and its skew. */
const EXPIRY_SECS = 23 * 3600;
const CONFIRMED = new Set(["confirmed", "finalized"]);

const newId = () => hexOf(crypto.getRandomValues(new Uint8Array(16)));

/** The lifetime that a message of the beta needs, read from the chain. */
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

/** What the network said to a test run, as a text, with the poor-fee text first. */
function refusalOf(run, seat) {
  const logs = run.logs.join(" | ").slice(0, 300);
  const refused = "The network refused this in a test run: " + run.err + " " + logs;
  return poorFeeText(run, seat) ?? refused;
}

/** The network runs the message once, with no signature. Nothing is charged. */
async function preflight(worker, messageHex, seat) {
  const message = bytesOf(messageHex);
  const tx = wireBase64(message, new Uint8Array(64 * message[1]));
  const run = await worker.call("preflight", { tx });
  if (run.err !== null) throw new Error(refusalOf(run, seat));
}

/** The tree fee and the inputs of a draft spend: the snapshot for the check of the proposer. */
async function draftSpend(c, worker, prepared) {
  const fees = await worker.call("treeFees", { tree: prepared.inputs[0].tree });
  return {
    fee: fees.feePerNullifier,
    inputs: prepared.inputs.map(({ mint, amount, blinding }) => ({ mint, amount, blinding })),
    salts: pairsBefore(c, "new"),
  };
}

/** The payee and the amount that a person typed, checked. */
function typedPayment(args) {
  const payee = String(args.recipient ?? "")
    .trim()
    .toLowerCase();
  const amount = lamportsOf(args.amount);
  if (!isAddress(payee)) throw new Error("Enter the full shielded address of the payee.");
  if (amount === null) throw new Error("Enter an amount of SOL, for example 0.005.");
  return { payee, amount };
}

/** The Worker proves the spend; the fields of the proposal part that every kind of spend has. */
async function proved(worker, kind, { payee, amount }, fee) {
  const expiry = BigInt(Math.floor(Date.now() / 1000) + EXPIRY_SECS);
  const request = { kind, recipient: payee, amount: String(amount), expiry: String(expiry) };
  request.payer = base58(fee.key);
  const prepared = await worker.call("prepare", request);
  const counts = { inputs: prepared.inputs.length, outputs: prepared.outputs.length };
  const fields = {
    plan: planHex(prepared),
    inputIds: prepared.inputs.map((input) => input.id),
    salt: prepared.salt,
    expiry: prepared.expiry,
  };
  return { prepared, fields, terms: { expiry, ...counts, payee, amount } };
}

/** The test run, the send and the confirmation of a transaction that the fee key signed alone. */
async function land(worker, message, signature, seat) {
  const tx = wireBase64(message, bytesOf(signature));
  const run = await worker.call("simulate", { tx });
  if (run.err !== null) throw new Error(refusalOf(run, seat));
  await worker.call("send", { tx });
  const txId = base58(signature);
  const seen = await worker.call("confirm", { signature: txId });
  if (!CONFIRMED.has(seen.status)) {
    throw new Error("The proposal account is not confirmed yet (" + seen.status + "): " + txId);
  }
  return txId;
}

/**
 * A private payment of the program design: the first proof, the check of this device, then the
 * create message of the proposal account. Resolves with the fields of the proposal part.
 */
async function payDraft(c, worker, seat, fee, args) {
  const { prepared, fields, terms } = await proved(worker, "pay", typedPayment(args), fee);
  Object.assign(fields, { intent: intentHex("approve", terms), transact: prepared.data });
  const spend = await draftSpend(c, worker, prepared);
  const roles = rolesOf(c, seat, "approve");
  const inputs = {
    pins: bytesOf(pinsHex(agreement(c).done, fee.key)),
    snapshot: bytesOf(snapshotHex(roles, spend)),
  };
  const now = BigInt(Math.floor(Date.now() / 1000));
  const proposal = bytesOf(paymentHex(fields.intent, fields));
  const verdict = c.W.check_payment(proposal, inputs.pins, inputs.snapshot, new Uint8Array(0), now);
  if (!verdict.startsWith("accepted")) throw new Error(refusalText(c.W, verdict));
  const said = readVerdict(verdict);
  const { blockhashHex } = await worker.call("blockhash");
  const lifetime = { commitment: said.commitment, blockhash: blockhashHex };
  const create = intentHex("propose", { ...terms, ...lifetime });
  const createProposal = bytesOf(paymentHex(create, fields));
  const message = c.W.compile_message(createProposal, inputs.pins, new Uint8Array(0));
  const signature = signAsFee(c, seat, message, createProposal, inputs);
  const createTx = await land(worker, message, signature, seat);
  return { ...fields, account: said.proposal, body: said.body, createTx };
}

/** The nonce account of the beta: no plan, a recent blockhash. */
async function nonceDraft(c, worker) {
  const done = agreement(c).done;
  const when = await lifetimeOf(worker, "createNonce", done.groupKey);
  return { fields: { intent: intentHex("createNonce", when) } };
}

/**
 * The move of the beta funds: the whole balance of the group key to the PDA address of the group,
 * with no change. The nonce is read after the proof, so the message names it as late as possible.
 */
async function migrationDraft(c, worker, seat, fee) {
  const done = agreement(c).done;
  const old = await worker.call("syncOld");
  const amount = BigInt(old.balance);
  if (amount <= 0n) throw new Error("The group key holds no private SOL to move.");
  const typed = { payee: done.pdaAddress, amount };
  const { prepared, fields, terms } = await proved(worker, "migrate", typed, fee);
  const { nonce } = await lifetimeOf(worker, "transfer", done.groupKey);
  fields.intent = intentHex("transfer", { ...terms, nonce });
  const spend = await draftSpend(c, worker, prepared);
  return { fields, spend, transact: bytesOf(prepared.data) };
}

/** A message of the beta, signed by the fee key and run once, as the proposal part holds it. */
async function betaFields(c, worker, seat, fee, draft) {
  const pins = bytesOf(pinsHex(agreement(c).done, fee.key));
  const proposal = bytesOf(draft.fields.intent + (draft.fields.plan ?? ""));
  const compiled = c.W.compile_message(proposal, pins, draft.transact ?? new Uint8Array(0));
  const unsigned = { id: "new", status: "collecting", by: seat, ...draft.fields };
  unsigned.message = hexOf(compiled);
  const feeSig = feeSignature(c, unsigned, seat, draft.spend);
  const own = reviewOf(c, { ...unsigned, feeSig }, seat, draft.spend);
  if (!own.ok) throw new Error(own.why);
  await preflight(worker, unsigned.message, seat);
  return { ...draft.fields, message: unsigned.message, feeSig };
}

const BETA = {
  createNonce: (c, worker) => nonceDraft(c, worker),
  migrate: migrationDraft,
};

/**
 * The first ready seat of this browser proposes `kind`: "pay" (a private payment, with
 * `args.recipient` and `args.amount`), or "createNonce" and "migrate" (the move of the beta funds
 * to the PDA). Its fee key pays. Resolves with the session id.
 */
export async function propose(c, kind, args = {}) {
  const block = await settledBlock(c);
  if (block) throw new Error(block);
  if (kind !== "pay" && !Object.hasOwn(BETA, kind)) throw new Error("Unknown proposal: " + kind);
  const seat = payerSeat(c);
  const fee = readyFee(c, seat);
  const worker = await ensureWorker(c);
  const fields =
    kind === "pay"
      ? await payDraft(c, worker, seat, fee, args)
      : await betaFields(c, worker, seat, fee, await BETA[kind](c, worker, seat, fee));
  const id = newId();
  await writePart(c, id, "proposal", { ...fields, createdAt: Date.now() }, { seat, create: true });
  c.host.log("seat " + seat + ": proposed " + kind);
  return id;
}
