// The approval of a Solana proposal (ZOLANA.md 5, steps 3 and 4, and 7.2). Every approving device
// runs the checker of the wasm on its own snapshot, with the pins of the agreed `soldone` document
// and the payer that the proposing seat published (fee.js), and shows what the checker accepted:
// the values come from the intent bytes that the checker compared with the proof or the message,
// never from the display fields of the proposer.
//
// A payment (the intent `approve`, or `withdraw` to a public address) has no message: the device
// rebuilds its commitment from the plan, its own snapshot and the first proof, reads the proposal
// account (and the recipient account of a withdrawal) from the chain, and the group signs the
// digest of that account once. The move of the beta funds to the PDA signs a v1
// message, which the payer signed when it was proposed: the device checks that signature too. Only
// then does the device make its nonces, save them with the digest and publish its commitment.
import { agreement } from "./ceremony.js";
import { CLUSTER, base58 } from "./docs.js";
import { feeOf, payerOf } from "./fee.js";
import { settledBlock, signingBlock } from "./gate.js";
import {
  bytesOf,
  chainHex,
  decodeIntent,
  describeMessage,
  hexOf,
  nonceAccountHex,
  pinsHex,
  proposalHex,
  readVerdict,
  snapshotHex,
} from "./intent.js";
import { approvedBodies, saveNonces, savedNonces, usedDigest } from "./nonces.js";
import { holdsShare, solOf } from "./secrets.js";
import { ensureWorker } from "./session.js";
import { SESSIONS, isPayment } from "./sessions.js";
import { deviceSpend } from "./spend.js";

const J = JSON.parse,
  S = JSON.stringify;
/** A recent blockhash lives about 60 to 90 seconds. After this, an approval is no use. */
export const BLOCKHASH_MS = 120_000;
const HEXTEXT = /^([0-9a-f]{2})+$/;
const KEY = /^[0-9a-f]{64}$/;
const FEE_SIG = /^[0-9a-f]{128}$/;
const REFUSED = "This device refused the proposal. ";
const READING = "Zigs is reading your wallet to check this payment. Try again in a moment.";
// The intents of the PDA identity: a payment or a withdrawal, their messages, Add SOL and the
// cancel that gets back the rent of an expired proposal.
const PDA_KINDS = new Set([
  "approve",
  "withdraw",
  "propose",
  "execute",
  "shield",
  "cancelProposal",
]);

let rules = null;
const ruleTexts = (W) =>
  (rules ??= new Map(
    W.rule_list()
      .split("\n")
      .map((line) => line.split("\t")),
  ));

/** The refusal text of the checker: each broken rule, its statement and the detail. */
export function refusalText(W, verdict) {
  const lines = verdict.split("\n").slice(1).filter(Boolean);
  const named = lines.map((line) => {
    const [id, detail] = line.split("\t");
    return (ruleTexts(W).get(id) ?? id) + (detail ? " (" + detail + ")" : "");
  });
  return REFUSED + (named.join("; ") || verdict.replace("\t", ": "));
}

/**
 * The role secrets of seat `seat` for an intent of `kind`: the nullifier secret of the PDA
 * identity for a payment, its messages and Add SOL, of the group key for the move of the beta
 * funds. The viewing key is the same for both.
 */
export function rolesOf(c, seat, kind) {
  const { W } = c;
  const s = solOf(c.host, c.gid, seat);
  const roles = J(W.sol_roles(s.solSeed, s.groupKey));
  if (!PDA_KINDS.has(kind)) return roles;
  return { ...roles, nullifier_secret: J(W.sol_pda_roles(s.solSeed, s.groupKey)).nullifier_secret };
}

/**
 * The wasm inputs of seat `seat` for the proposal `ss`: message (none for a payment), intent (and
 * plan and first proof), pins (with the payer of the proposing seat) and snapshot. `spend` is the
 * device snapshot of a private spend (spend.js).
 */
export function inputsOf(c, ss, seat, spend) {
  const roles = rolesOf(c, seat, decodeIntent(ss.intent)?.kind);
  return {
    roles,
    message: isPayment(ss) ? new Uint8Array(0) : bytesOf(ss.message),
    intent: bytesOf(proposalHex(ss)),
    pins: bytesOf(pinsHex(agreement(c).done, payerOf(c, ss))),
    snapshot: bytesOf(snapshotHex(roles, spend)),
  };
}

/**
 * The signature (hex) of the fee key of seat `seat` on `message`, which the wasm compiled from
 * `proposal` (bytes). The wasm runs the checker on the exact bytes first and throws its refusal,
 * so the fee key signs nothing else.
 */
export function signAsFee(c, seat, message, proposal, inputs) {
  const now = Math.floor(Date.now() / 1000);
  const round = S({ now, secret: feeOf(c, seat).secret });
  return c.W.sol_fee_sign(message, proposal, inputs.pins, inputs.snapshot, round);
}

/** `signAsFee` for the message of a session `ss` (the move of the beta funds, Add SOL). */
export function feeSignature(c, ss, seat, spend) {
  const wasm = inputsOf(c, ss, seat, spend);
  return signAsFee(c, seat, wasm.message, wasm.intent, wasm);
}

const kindOf = (ss) => decodeIntent(ss?.intent)?.kind;
const isSpend = (ss) => ["transfer", "approve", "withdraw"].includes(kindOf(ss));
const readable = (ss) =>
  HEXTEXT.test(String(ss?.intent)) &&
  (isPayment(ss)
    ? HEXTEXT.test(String(ss.transact)) && KEY.test(String(ss.account))
    : HEXTEXT.test(String(ss?.message))) &&
  (!isSpend(ss) || HEXTEXT.test(String(ss.plan)));
// Add SOL (the intent `shield`) is no session: one member signs it alone and sends it at once.
const SESSION_KINDS = new Set(["createNonce", "transfer", "approve", "withdraw"]);
const NOT_SHOWN = "This proposal is not one that this app can show.";
/** True for a session that this app shows and signs: a payment or the move of the beta funds. */
export const showable = (ss) => readable(ss) && SESSION_KINDS.has(kindOf(ss));

// A spend waits for the snapshot of this device, and a payment for its chain state too.
const waits = (ss, spend, seen) => (isSpend(ss) && !spend) || (isPayment(ss) && !seen);

/** The intent of `ss` and no reason, or the reason why seat `seat` cannot review it yet. */
function reviewBlock(c, ss, seat, spend, seen) {
  const block = signingBlock(c);
  if (block) return { why: block };
  if (!showable(ss)) return { why: NOT_SHOWN };
  const intent = decodeIntent(ss.intent);
  if (!holdsShare(solOf(c.host, c.gid, seat))) {
    return { why: "Seat " + seat + " holds no Solana key share." };
  }
  if (!payerOf(c, ss)) {
    const why = "Seat " + ss.by + " has not published its fee address, so the payer is unknown.";
    return { why };
  }
  return waits(ss, spend, seen) ? { why: READING } : { intent };
}

/**
 * The review of a payment: the checker rebuilds its commitment, its body and its proposal account
 * from the plan, the snapshot of this device and the first proof, and checks the account that the
 * device read. The account and the body that the proposer wrote must be those.
 */
function paymentReview(c, ss, seat, { spend, seen, intent }) {
  const wasm = inputsOf(c, ss, seat, spend),
    now = BigInt(Math.floor(Date.now() / 1000));
  const chain = bytesOf(chainHex(seen, seen.recipient ?? null));
  const verdict = c.W.check_payment(wasm.intent, wasm.pins, wasm.snapshot, chain, now);
  if (!verdict.startsWith("accepted")) return { ok: false, why: refusalText(c.W, verdict) };
  const said = readVerdict(verdict);
  if (said.proposal !== ss.account || said.body !== ss.body) {
    const why = "The proposal names another account or body than the payment gives.";
    return { ok: false, why: REFUSED + why };
  }
  const payer = payerOf(c, ss);
  return { ok: true, intent, digest: said.digest, verdict, said, payer, by: ss.by };
}

/**
 * What seat `seat` sees of the proposal: { ok: true, intent, digest, verdict, payer, by, ... }
 * when the checker accepts it on the snapshot of this device (and, for the move of the beta funds,
 * the payer signed these bytes), else { ok: false, why }. `payer` is the fee key (hex) of seat
 * `by`, the proposing seat. A spend needs the snapshot `spend` of this device and a payment the
 * chain state `seen` (deviceSeen): the ones read for this session.
 */
export function reviewOf(c, ss, seat, spend = c.snaps?.[ss.id], seen = c.seen?.[ss.id]) {
  const early = reviewBlock(c, ss, seat, spend, seen);
  if (early.why) return { ok: false, why: early.why };
  const { intent } = early;
  if (isPayment(ss)) return paymentReview(c, ss, seat, { spend, seen, intent });
  return messageReview(c, ss, seat, { spend, intent });
}

/** The review of a message that the group key signs: the fee signature, then the checker. */
function messageReview(c, ss, seat, { spend, intent }) {
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

// A proposal of the recent-blockhash kind lives about as long as the blockhash. A payment lives
// until the expiry of its body.
const expired = (ss) => {
  if (isPayment(ss)) return !(Math.floor(Date.now() / 1000) < Number(ss.expiry));
  return kindOf(ss) === "createNonce" && !(Date.now() - Number(ss.createdAt) <= BLOCKHASH_MS);
};

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

/**
 * What this device reads of the public `recipient` (hex) of a withdrawal: its account ({ owner,
 * lamports, executable }, or null when there is none) and the rent-exempt minimum of an account
 * with no data. The checker refuses a recipient that could not take the SOL (wasm-sol pay.rs).
 */
export async function recipientRead(worker, recipient) {
  const [got, rent] = await Promise.all([
    worker.call("recipientAccount", { account: base58(recipient) }),
    worker.call("rent", { space: "0" }),
  ]);
  const { owner, lamports, executable } = got;
  return { account: got.exists ? { owner, lamports, executable } : null, rentMin: rent.lamports };
}

/**
 * What this device sees on chain for the payment `ss`: its proposal account ({ owner, data } as
 * hex, or null when there is none), the bodies that the seats of this browser approved, and for
 * a withdrawal the recipient account (`recipientRead`).
 */
export async function deviceSeen(c, ss) {
  if (!KEY.test(String(ss.account))) throw new Error(NOT_SHOWN);
  const worker = await ensureWorker(c);
  const got = await worker.call("account", { account: base58(ss.account) });
  const account = got.exists ? { owner: got.owner, data: got.data } : null;
  const intent = decodeIntent(ss.intent);
  const recipient =
    intent?.kind === "withdraw" ? await recipientRead(worker, intent.recipient) : null;
  return { account, approved: approvedBodies(c), recipient };
}

const sha256Hex = async (hex) =>
  hexOf(new Uint8Array(await crypto.subtle.digest("SHA-256", bytesOf(hex))));

/** Fresh nonces for this digest, saved before anything is published. */
async function makeNonces(c, ss, seat, review) {
  if (usedDigest(c, seat, review.digest)) {
    throw new Error("Seat " + seat + " signed these bytes before, so it will not approve again.");
  }
  const s = solOf(c.host, c.gid, seat);
  const made = J(c.W.sol_nonces(S(s.keyPackage), review.digest));
  const entry = { digest: review.digest, nonces: made.nonces, commitments: made.commitments };
  if (isSpend(ss)) entry.spend = c.snaps[ss.id];
  if (isPayment(ss)) entry.body = { [review.said.commitment]: await sha256Hex(review.said.body) };
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
  if (isSpend(ss)) c.snaps[ss.id] = await deviceSpend(c, ss);
  if (isPayment(ss)) c.seen[ss.id] = await deviceSeen(c, ss);
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
