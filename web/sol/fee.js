// The fee key of a seat (ZOLANA.md 5). Each seat has its own Devnet key. It pays the fees and the
// rents of the proposals that its seat makes, so the group key never pays. The wasm derives it from
// the key share of the seat, so a second tab, a second browser and a restore of any Solana backup
// hold the same key, and the page stores no fee key. The seat publishes the public key in the
// signed document `solfee/<i>` when no valid document shows a key for the seat. A valid document
// with another key is forged or broken: the page writes nothing over it, and the seat says that
// it cannot pay. An approver takes the payer of a proposal from the document of the proposing
// seat and never from the proposal.
import { CLUSTER } from "./docs.js";
import { holdsShare, solOf } from "./secrets.js";

const J = JSON.parse;
const isKey = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

/** The fee key that the key share of seat `seat` gives: { secret, key } (hex), or null. */
export function feeOf(c, seat) {
  const s = solOf(c.host, c.gid, seat);
  if (!holdsShare(s)) return null;
  const made = J(c.W.sol_fee_key(JSON.stringify(s.keyPackage)));
  return { secret: made.secret, key: made.public };
}

/** The fee key (hex) that seat `seat` published in a valid signed document, or undefined. */
export function publishedFee(c, seat) {
  const doc = c.docs.solfee?.[seat];
  return isKey(doc?.key) && doc.cluster === CLUSTER ? doc.key : undefined;
}

/** True when the seat has a fee key and no valid document shows a key for it. */
export const feeUnpublished = (c, seat) =>
  feeOf(c, seat) !== null && publishedFee(c, seat) === undefined;

/** True when a valid document shows another key for the seat than its key share gives. */
export const feeMismatch = (c, seat) => {
  const held = feeOf(c, seat),
    shown = publishedFee(c, seat);
  return held !== null && shown !== undefined && shown !== held.key;
};

/** The text for a seat whose valid document shows another key than its key share gives. */
export const mismatchText = (seat) =>
  "The fee document of seat " +
  seat +
  " does not show the key of this seat. It is forged or broken, and seat " +
  seat +
  " cannot pay while that document stands. Seat " +
  seat +
  " can still approve and sign, and the other seats can propose and add SOL.";

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

/** The fee key of the seat and no reason when its published document shows it, else { why }. */
function checked(c, seat) {
  const held = feeOf(c, seat),
    shown = publishedFee(c, seat);
  if (held === null || shown === undefined) return { why: NOT_READY(seat) };
  return shown === held.key ? { held } : { why: mismatchText(seat) };
}

/** Why seat `seat` cannot pay now (a text), or null when its document shows its fee key. */
export const feeProblem = (c, seat) => checked(c, seat).why ?? null;

/** The fee key of `seat`, when its published document shows it. Throws a text when it does not. */
export function readyFee(c, seat) {
  const { held, why } = checked(c, seat);
  if (why) throw new Error(why);
  return held;
}
