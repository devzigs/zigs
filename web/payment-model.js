// The Send drafts, the age of a review and the headline of a payment. Display and convenience
// only: a draft fills the form, never the review, and nothing here proposes, approves or signs.

/** A draft lives 24 hours; after that the next read deletes it. */
export const DRAFT_MS = 24 * 60 * 60 * 1000;
/** A reviewed transaction older than this is built again before it is proposed. */
export const REVIEW_MS = 5 * 60 * 1000;
const MAX_ROWS = 20;

// A text of at most `max` characters; a missing one is empty.
function text(v, max) {
  const s = v ?? "";
  return typeof s === "string" && s.length <= max ? s : null;
}

// One typed row: the address or name, the amount and the memo as the person typed them. A ZNS
// name keeps no address here, so a restored name shows its address again before a submit pays it.
function rowOf(r) {
  if (!r || typeof r !== "object") return null;
  const row = { to: text(r.to, 1024), amt: text(r.amt, 40), memo: text(r.memo, 2048) };
  return Object.values(row).includes(null) ? null : row;
}

/**
 * The draft of a Send form, or null when it holds nothing to keep or does not fit.
 * @param {object} form rows ({to, amt, memo}), note, priority.
 * @param {number} at the time of the save, in ms.
 */
export function draftOf({ rows, note, priority }, at) {
  if (!Array.isArray(rows) || rows.length > MAX_ROWS || !Number.isSafeInteger(at)) return null;
  const kept = rows.map(rowOf), n = text(note, 80);
  if (kept.includes(null) || n === null) return null;
  const empty = !n && kept.every((r) => !r.to && !r.amt && !r.memo);
  return empty ? null : { v: 1, at, rows: kept, note: n, priority: priority === true };
}

/** True when the Send form holds nothing typed: no address, amount, memo or note. */
export const emptyForm = ({ rows, note }) => !note
  && (Array.isArray(rows) ? rows : []).every((r) => !r?.to && !r?.amt && !r?.memo);

/** True when draft `d` has the shape of draftOf and is not older than DRAFT_MS at `now`. */
export function draftLive(d, now) {
  if (d?.v !== 1 || !Number.isSafeInteger(d.at) || d.at > now + 300000) return false;
  return now - d.at <= DRAFT_MS && draftOf(d, d.at) !== null;
}

/** True while a reviewed transaction, built at `at`, may still be proposed at `now`. */
export const reviewFresh = (at, now) => Number.isSafeInteger(at) && now >= at
  && now - at < REVIEW_MS;

/** A sent payment that no synced block holds after this long may be lost: send it again. */
export const RESEND_MS = 10 * 60 * 1000;

// The headline of a payment and its one sentence: the first rule that holds names the state.
const HEADLINES = [
  ["landed", "In a block", "A block that this browser synced holds the payment."],
  ["ended", "Payment expired", "No device can send it now. A new payment needs a new review and "
    + "new approvals."],
  ["check", "Check the payment", "It may still go on chain. Check it before you make another "
    + "payment."],
  ["held", "Stopped, but it may still go on chain", "It was stopped after this browser approved "
    + "it. Another device can still send it, so Send stays off here. Read the note below."],
  ["stopped", "Payment stopped", "No device can approve, sign or send it. The reason is below."],
  ["error", "Payment stopped", "This page cannot tell whether a device sent it. Check the "
    + "wallet's activity before you make another payment."],
  ["rejected", "Payment needs attention", "This browser refuses this payment. The reason is "
    + "below. Do not approve it."],
  ["refused", "Payment needs attention", "This browser does not send this transaction. The reason "
    + "is below."],
  ["signingLost", "Check the payment", "One device reset this payment after its signing started. "
    + "Read the note below. Check the wallet's activity before you make another payment."],
  ["approvalLost", "Payment needs attention", "This browser lost its approval of this payment. "
    + "Read the note below. Cancel the payment, then propose it again."],
  ["approvalChanged", "Payment needs attention", "One device changed the proposal after this "
    + "browser approved it. Read the note below. Check the payment with the other devices."],
  ["mismatch", "Payment needs attention", "The transaction does not pay what the proposer listed. "
    + "Do not approve it. The reason is below."],
  ["wrongMove", "Payment needs attention", "The transaction does not move all the funds to the "
    + "address of the new wallet that this browser checked. Do not approve it. The reason is "
    + "below."],
  ["sentUnsynced", "Waiting for a block", "A device sent it. This browser has not checked the "
    + "blocks since the send yet."],
  ["resend", "Send it again", "No block that this browser synced holds it after "
    + RESEND_MS / 60000 + " minutes. Any device can send the same transaction again."],
  ["sent", "Waiting for a block", "A device sent it. No block that this browser synced holds it "
    + "yet. Wait for it before you make another payment."],
  ["late", "Too late to send", "It can no longer go to the network. A device may have sent it. "
    + "Check it before you make another payment."],
  ["sendFailed", "The send failed", "Read the error below. A device can send it again."],
  ["proved", "Ready to send", "Sending is a separate step. This browser checks that the finished "
    + "transaction has the approved id before it sends it."],
  ["proving", "Building the proof", "A device builds the proof. It takes about a minute."],
  ["signed", "Ready for the proof", "Any device can build the proof now."],
  ["signing", "Signing", "Each device that the signing package names signs while this wallet "
    + "is open on it."],
  ["approved", "Approvals are complete", "The device that proposed it builds the signing package "
    + "while this wallet is open there."],
  ["mine", "Your approval is needed", "Check the recipient, amount, network and fee. Approve only "
    + "if all are right. After enough approvals, the devices sign it, a device builds the proof, "
    + "and any device can send it."],
];
const WAITING = { title: "Waiting for approvals", detail: "The other devices approve it while "
  + "this wallet is open on them. You can close this page and come back." };

/**
 * The headline of a payment drawer, from facts that the drawer already reads.
 * @param {object} f true or false each: landed, ended, check (the engine cannot say that it
 *   expired), held (stopped, but an approval here holds Send), stopped (an error, no signing
 *   seen here, a synced chain), error, rejected (this browser refuses the transaction), refused
 *   (the send step refuses it), signingLost (one device reset the signing seen here),
 *   approvalLost (this browser lost its approval), approvalChanged (the proposal changed after
 *   an approval here), mismatch (it does not pay what the proposer listed), wrongMove (a move
 *   that does not pay the checked address of the new wallet), sentUnsynced (sent, and no sync
 *   since), resend, sent, late (too late to send), sendFailed, proved, proving, signed, signing,
 *   approved (enough approvals), mine (this browser can approve it).
 * @returns {{title: string, detail: string}}
 */
export function stageHeadline(f) {
  const hit = HEADLINES.find(([fact]) => f[fact] === true);
  return hit ? { title: hit[1], detail: hit[2] } : WAITING;
}
