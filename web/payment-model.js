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

// The headline of a payment and its one sentence: the first rule that holds names the state.
const HEADLINES = [
  ["landed", "In a block", "A block that this browser synced holds the payment."],
  ["ended", "Payment expired", "No signer can send it now. A new payment needs a new review and "
    + "new approvals."],
  ["check", "Check the payment", "It may still go on chain. Check it before you make another "
    + "payment."],
  ["error", "Payment stopped", "This payment takes no more steps. The reason is below."],
  ["rejected", "Payment needs attention", "This browser refuses this payment. The reason is "
    + "above. Do not approve it."],
  ["refused", "Payment needs attention", "This browser does not send this transaction. The reason "
    + "is below."],
  ["sent", "Waiting for a block", "The payment went to the network. Check it here before you make "
    + "another payment."],
  ["sendFailed", "The send failed", "Read the error below, then send it again."],
  ["proved", "Ready to send", "Sending is a separate step. This browser checks the transaction "
    + "again before it sends it."],
  ["proving", "Building the proof", "A signer's browser builds the proof. It takes about a "
    + "minute."],
  ["signed", "Ready for the proof", "Any signer can build the proof now."],
  ["signing", "Signing", "The devices that approved sign while this wallet is open on them."],
  ["mine", "Your approval is needed", "Check the recipient, amount, network and fee before you "
    + "approve. An approval sends nothing."],
];
const WAITING = { title: "Waiting for approvals",
  detail: "You can close this and come back. Opening it makes no new payment." };

/**
 * The headline of a payment drawer, from facts that the drawer already reads.
 * @param {object} f landed, ended, check (the engine cannot say that it expired), error, rejected
 *   (this browser refuses the transaction), refused (the send step refuses it), sent, sendFailed,
 *   proved, proving, signed, signing, mine (this browser can approve it): true or false each.
 * @returns {{title: string, detail: string}}
 */
export function stageHeadline(f) {
  const hit = HEADLINES.find(([fact]) => f[fact] === true);
  return hit ? { title: hit[1], detail: hit[2] } : WAITING;
}
