// The fee key of a seat (ZOLANA.md 5). Each seat has its own Devnet key. It pays the fees and the
// rents of the proposals that its seat makes, so the group key never pays. The device makes it
// when the Solana setup of the seat finishes, or at the first run for a seat that finished before
// the fee key existed. The secret sits in the Solana secret of the seat, so the passkey lock, the
// tab sync and the Solana backup cover it, and it goes to no Worker: the wasm signs with it.
// The seat publishes the public key in the signed document `solfee/<i>`. An approver takes the
// payer of a proposal from the document of the proposing seat and never from the proposal.
import { CLUSTER } from "./docs.js";
import { putSol, solOf } from "./secrets.js";

const J = JSON.parse;
const isKey = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const SAVE_FAILED = "This browser could not save the fee key of the seat.";

/** The fee key that seat `seat` holds in this browser: { secret, key } (hex), or null. */
export function feeOf(c, seat) {
  const s = solOf(c.host, c.gid, seat);
  const found = isKey(s.feeSecret) && isKey(s.feePublic);
  return found ? { secret: s.feeSecret, key: s.feePublic } : null;
}

/** The fee key (hex) that seat `seat` published in a valid signed document, or undefined. */
export function publishedFee(c, seat) {
  const doc = c.docs.solfee?.[seat];
  return isKey(doc?.key) && doc.cluster === CLUSTER ? doc.key : undefined;
}

/** A fresh fee key as the patch of the Solana secret of a seat. */
export function newFeePatch(W) {
  const made = J(W.sol_fee_key());
  return { feeSecret: made.secret, feePublic: made.public };
}

/**
 * Makes the fee key of a seat that has none. The callers check that the seat holds a Solana key
 * share (the reactor step in ceremony.js and the backup): a seat that lost its Solana part must
 * stay empty, or a restore would refuse it ("already has Solana data").
 */
export async function makeFeeKey(c, seat) {
  if (solOf(c.host, c.gid, seat).feeSecret) return;
  if (!(await putSol(c.host, c.gid, seat, newFeePatch(c.W)))) throw new Error(SAVE_FAILED);
  c.host.log("seat " + seat + ": fee key made");
}

/** True when this browser holds a fee key of the seat that its signed document does not show. */
export const feeUnpublished = (c, seat) => {
  const held = feeOf(c, seat);
  return held !== null && publishedFee(c, seat) !== held.key;
};

/** The reactor step: publish the signed document of the fee key of a seat. */
export async function publishFee(c, seat) {
  const held = feeOf(c, seat);
  if (held === null) return;
  const rel = "solfee/" + seat;
  const doc = await c.host.signedDoc(c.gid, rel, seat, {
    key: held.key,
    cluster: CLUSTER,
    at: Date.now(),
  });
  await c.host.sdb.doc(c.base + "/" + rel).set(doc);
  c.host.log("seat " + seat + ": fee address published");
}

/**
 * The payer of the proposal `ss` (hex): the fee key that the proposing seat published. The seat
 * is `ss.by`, the signer of the proposal part (sessions.js), never a field that the proposer wrote.
 */
export const payerOf = (c, ss) => publishedFee(c, ss.by);

// What a test run says when the payer cannot pay: no account, or too few lamports.
const NO_SOL = /AccountNotFound|InsufficientFunds|insufficient lamports/i;

/** A text for a failed test run of a message that seat `seat` pays, when it lacks SOL, or null. */
export function poorFeeText(run, seat) {
  if (!NO_SOL.test(run.err + " " + run.logs.join(" "))) return null;
  return (
    "The fee address of seat " +
    seat +
    " has too little Devnet SOL. " +
    "Fund it with the link in the fund card, then try again."
  );
}

const NOT_READY = (seat) =>
  "The fee address of seat " + seat + " is not published yet. Try again in a moment.";

/** The fee key of `seat`, when its published document shows it. Throws a text when it does not. */
export function readyFee(c, seat) {
  const held = feeOf(c, seat);
  if (held === null || publishedFee(c, seat) !== held.key) throw new Error(NOT_READY(seat));
  return held;
}
