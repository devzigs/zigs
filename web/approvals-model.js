// The buckets of the Approvals inbox. Display only: a row opens its payment, and the payment
// drawer keeps every action. The facts come from the predicates that act on the payment, so the
// inbox and the drawer never disagree. A payment that is not finished lands in exactly one
// bucket; a state that no rule names goes to "attention", never out of the list.

/** The buckets in their order on the page: [id, heading]. */
export const BUCKETS = [
  ["review", "Needs your approval"],
  ["ready", "Ready to send"],
  ["waiting", "Waiting for the other signers or the network"],
  ["attention", "Needs attention"],
];

// The statuses of a payment that is still under way when it has no error.
const UNDER_WAY = new Set(["collecting", "signing", "signed", "proving", "complete", "broadcast"]);

/**
 * The bucket of one payment, or null when it is finished (the Activity list keeps it).
 * @param {object} f landed: a block holds it; held: an approval here still holds its notes (S7);
 *   check: the signing started, it did not end, and the engine says it expired (the "Check"
 *   chip); review: a seat here can approve it (needsMyApproval); step: the next step that a
 *   signer here can take (finishStep); ended: it ended (the "Expired" chip); error: cancelled,
 *   failed or refused; status: the status of the payment document.
 * @returns {string | null}
 */
export function bucketOf(f) {
  if (f.landed) return null;
  if (stuck(f)) return "attention";
  if (f.review) return "review";
  if (f.step) return "ready";
  if (over(f)) return null;
  return UNDER_WAY.has(f.status) ? "waiting" : "attention";
}
const stuck = (f) => f.held || f.check;
const over = (f) => f.ended || f.error;

/**
 * What the inbox may say when it shows no payment: "failed", "loading", "ignored" or "empty".
 * Only "empty" lets the page say that nothing waits.
 * @param {object} s loaded: the payments of the wallet arrived; failed: their read failed;
 *   checking: a check of a stored record is still open; ignored: records that failed their check;
 *   solKnown: the Solana part is off, or its state is known.
 */
export function emptyState({ loaded, failed, checking, ignored, solKnown }) {
  if (failed) return "failed";
  if (!loaded || checking || !solKnown) return "loading";
  return ignored ? "ignored" : "empty";
}

const SOL_READING = { kind: "loading", text: "Reading the Solana proposals…" };
const SOL_CLOSED = { kind: "idle", text: "Open Solana to read its proposals." };
const SOL_STATE = { kind: "info",
  text: "The Solana part is not ready. Open Solana for its state." };
const SOL_NONE = { kind: "info",
  text: "No Solana proposal waits for your approval. Open Solana to see all of its proposals." };
const solReview = (n) => ({ kind: "review", text: n === 1
  ? "1 Solana proposal waits for your approval."
  : n + " Solana proposals wait for your approval." });

/**
 * The one line of the inbox for the Solana part, or null when the wallet has none. It counts
 * only what this browser can approve, so it never says that nothing else waits.
 * @param {object} s on: the wallet can have the part; error: the module did not load; loading:
 *   the module loads or runs; setup: its setup summary; toApprove: solPending().
 * @returns {{kind: string, text: string} | null} kind: review, attention, loading, idle or info.
 */
export function solLine({ on, error, loading, setup, toApprove }) {
  if (!on) return null;
  if (error) return { kind: "attention", text: "Solana did not load, so its proposals are not "
    + "shown here: " + error };
  if (!setup) return loading ? SOL_READING : SOL_CLOSED;
  if (setup.status === "not started") return null;
  if (setup.status !== "ready") return SOL_STATE;
  return toApprove > 0 ? solReview(toApprove) : SOL_NONE;
}
