// The approval of a Solana proposal (ZOLANA.md 5, steps 3 and 4). Every approving device runs the
// checker of the wasm on its own snapshot, with the pins of the agreed `soldone` document and the
// payer that the proposing seat published (fee.js), and shows what the checker accepted: the values
// come from the intent bytes that the checker compared with the message, never from the display
// fields of the proposer. The payer signed the message when it was proposed, and the device checks
// that signature too. Only then does the device make its nonces, save them with the digest and
// publish its commitment.
import { agreement } from "./ceremony.js";
import { CLUSTER, base58 } from "./docs.js";
import { feeOf, payerOf } from "./fee.js";
import { settledBlock, signingBlock } from "./gate.js";
import {
  bytesOf,
  decodeIntent,
  describeMessage,
  nonceAccountHex,
  pinsHex,
  proposalHex,
  snapshotHex,
} from "./intent.js";
import { saveNonces, savedNonces, usedDigest } from "./nonces.js";
import { holdsShare, solOf } from "./secrets.js";
import { ensureWorker } from "./session.js";
import { SESSIONS } from "./sessions.js";
import { deviceSpend } from "./spend.js";

const J = JSON.parse,
  S = JSON.stringify;
/** A recent blockhash lives about 60 to 90 seconds. After this, an approval is no use. */
export const BLOCKHASH_MS = 120_000;
const HEXTEXT = /^([0-9a-f]{2})+$/;
const FEE_SIG = /^[0-9a-f]{128}$/;
const REFUSED = "This device refused the proposal. ";
const READING = "Zigs is reading your wallet to check this payment. Try again in a moment.";

let rules = null;
const ruleTexts = (W) =>
  (rules ??= new Map(
    W.rule_list()
      .split("\n")
      .map((line) => line.split("\t")),
  ));

/** The refusal text of the checker: each broken rule, its statement and the detail. */
function refusalText(W, verdict) {
  const lines = verdict.split("\n").slice(1).filter(Boolean);
  const named = lines.map((line) => {
    const [id, detail] = line.split("\t");
    return (ruleTexts(W).get(id) ?? id) + (detail ? " (" + detail + ")" : "");
  });
  return REFUSED + (named.join("; ") || verdict.replace("\t", ": "));
}

/**
 * The wasm inputs of seat `seat` for the proposal `ss`: message, intent (and plan), pins (with
 * the payer of the proposing seat) and snapshot. `spend` is the device snapshot of a private
 * payment (spend.js).
 */
export function inputsOf(c, ss, seat, spend) {
  const { W } = c;
  const s = solOf(c.host, c.gid, seat);
  const roles = J(W.sol_roles(s.solSeed, s.groupKey));
  return {
    roles,
    message: bytesOf(ss.message),
    intent: bytesOf(proposalHex(ss)),
    pins: bytesOf(pinsHex(agreement(c).done, payerOf(c, ss))),
    snapshot: bytesOf(snapshotHex(roles, spend)),
  };
}

/**
 * The signature (hex) of the fee key of seat `seat` on the message of `ss`. The wasm runs the
 * checker on the exact bytes first and throws its refusal, so the fee key signs nothing else.
 */
export function feeSignature(c, ss, seat, spend) {
  const wasm = inputsOf(c, ss, seat, spend);
  const now = Math.floor(Date.now() / 1000);
  const round = S({ now, secret: feeOf(c, seat).secret });
  return c.W.sol_fee_sign(wasm.message, wasm.intent, wasm.pins, wasm.snapshot, round);
}

const isTransfer = (ss) => decodeIntent(ss?.intent)?.kind === "transfer";
const readable = (ss) =>
  HEXTEXT.test(String(ss?.message)) &&
  HEXTEXT.test(String(ss?.intent)) &&
  (!isTransfer(ss) || HEXTEXT.test(String(ss.plan)));

/** The intent of `ss` and no reason, or the reason why seat `seat` cannot review it yet. */
function reviewBlock(c, ss, seat, spend) {
  const block = signingBlock(c);
  if (block) return { why: block };
  const intent = readable(ss) && decodeIntent(ss.intent);
  if (!intent) return { why: "This proposal is not one that this app can show." };
  if (!holdsShare(solOf(c.host, c.gid, seat))) {
    return { why: "Seat " + seat + " holds no Solana key share." };
  }
  if (!payerOf(c, ss)) {
    const why = "Seat " + ss.by + " has not published its fee address, so the payer is unknown.";
    return { why };
  }
  return intent.kind === "transfer" && !spend ? { why: READING } : { intent };
}

/**
 * What seat `seat` sees of the proposal: { ok: true, intent, digest, info, verdict, payer, by }
 * when the payer signed these bytes and the checker accepts them on the snapshot of this device,
 * else { ok: false, why }. `payer` is the fee key (hex) of seat `by`, the proposing seat. A
 * private payment needs the snapshot `spend` of this device: the one read for this session.
 */
export function reviewOf(c, ss, seat, spend = c.snaps?.[ss.id]) {
  const early = reviewBlock(c, ss, seat, spend);
  if (early.why) return { ok: false, why: early.why };
  const { intent } = early;
  const payer = payerOf(c, ss);
  const wasm = inputsOf(c, ss, seat, spend),
    now = BigInt(Math.floor(Date.now() / 1000));
  if (!FEE_SIG.test(ss.feeSig) || !c.W.sol_fee_verify(payer, wasm.message, ss.feeSig)) {
    return { ok: false, why: REFUSED + "The fee signature of seat " + ss.by + " does not fit it." };
  }
  const verdict = c.W.check_message(wasm.message, wasm.intent, wasm.pins, wasm.snapshot, now);
  if (!verdict.startsWith("accepted")) return { ok: false, why: refusalText(c.W, verdict) };
  const digest = c.W.sol_digest(CLUSTER, wasm.message);
  const info = describeMessage(wasm.message);
  return { ok: true, intent, digest, info, verdict, payer, by: ss.by };
}

// A proposal of the recent-blockhash kind lives about as long as the blockhash.
const expired = (ss) =>
  decodeIntent(ss.intent)?.kind === "createNonce" &&
  !(Date.now() - Number(ss.createdAt) <= BLOCKHASH_MS);

/** Why seat `seat` may not approve `ss` now, or null. The checker runs after these. */
function approveBlock(c, ss, seat) {
  const { host } = c;
  if (!host.localSeats().includes(seat) || !host.canWriteAs(seat)) {
    return "This browser cannot sign for seat " + seat + ".";
  }
  if (ss.status !== "collecting") return "This proposal is not collecting approvals any more.";
  if (c.commits[ss.id]?.[seat]) return "Seat " + seat + " approved this already.";
  return expired(ss) ? "This proposal expired. Propose it again." : null;
}

/** The nonce account must hold the nonce that the proposal names, and the group must own it. */
async function checkNonce(c, review) {
  const { nonce } = review.intent;
  if (nonce === undefined) return;
  const { groupKey } = agreement(c).done;
  const account = base58(await nonceAccountHex(groupKey));
  const worker = await ensureWorker(c);
  const found = await worker.call("readNonce", { account });
  if (found.authority !== base58(groupKey) || found.nonceHex !== nonce) {
    throw new Error("The nonce changed since this was proposed. Propose it again.");
  }
}

/** Fresh nonces for this digest, saved before anything is published. */
async function makeNonces(c, ss, seat, review) {
  if (usedDigest(c, seat, review.digest)) {
    throw new Error("Seat " + seat + " signed these bytes before, so it will not approve again.");
  }
  const s = solOf(c.host, c.gid, seat);
  const made = J(c.W.sol_nonces(S(s.keyPackage), review.digest));
  const entry = { digest: review.digest, nonces: made.nonces, commitments: made.commitments };
  if (review.intent.kind === "transfer") entry.spend = c.snaps[ss.id];
  await saveNonces(c, seat, ss.id, entry);
  return entry;
}

/**
 * Seat `seat` approves the proposal `ss`. A retry after a crash between the save and the publish
 * publishes the saved commitment again: the nonces are never made twice for one session.
 */
export async function approve(c, ss, seat) {
  const why = (await settledBlock(c)) ?? approveBlock(c, ss, seat);
  if (why) throw new Error(why);
  if (isTransfer(ss)) c.snaps[ss.id] = await deviceSpend(c, ss);
  const review = reviewOf(c, ss, seat);
  if (!review.ok) throw new Error(review.why);
  await checkNonce(c, review);
  const entry = savedNonces(c, seat, ss.id) ?? (await makeNonces(c, ss, seat, review));
  if (entry.digest !== review.digest) throw new Error("The saved approval is for other bytes.");
  const rel = SESSIONS + "/" + ss.id + "/commits/" + seat;
  const fields = { commitments: entry.commitments, digest: entry.digest, at: Date.now() };
  const doc = await c.host.signedDoc(c.gid, rel, seat, fields);
  await c.host.sdb.doc(c.base + "/" + rel).set(doc);
  c.host.log("seat " + seat + ": approved a Solana proposal, commitment published");
}
