// The words and numbers of the Overview: the asset rows and the pending shortcut. Display only:
// nothing here approves, signs or sends. An amount that is not known shows as unknown, never as
// zero.

/** The ZEC of the asset row in zatoshi: spendable plus incoming, or null before the first sync. */
export const zecTotal = (b) => (b ? b.spendable + b.pending : null);

// The row for each setup status of the Solana part (setupSummary of web/sol/view.js) but ready.
const SOL_STATES = {
  "not started": ["none", "Not added"], unavailable: ["unavailable", "Not available"],
  differs: ["differs", "Keys differ"], running: ["setup", "Setting up"],
  stopped: ["stopped", "Stopped"],
};

/**
 * The SOL asset row, or null when the wallet cannot have a Solana part.
 * @param {object} s on: the wallet can have the part; error: the module did not load; loading:
 *   the module loads or runs; setup: its setup summary (null before the module knows the
 *   wallet); balance: the private balance text of the last sync, or null.
 * @returns {{state: string, text: string} | null}
 */
export function solRow({ on, error, loading, setup, balance }) {
  if (!on) return null;
  if (error) return { state: "failed", text: "Did not load" };
  if (!setup) {
    return loading ? { state: "loading", text: "Loading…" } : { state: "idle", text: "Not open" };
  }
  if (setup.status !== "ready") {
    const [state, text] = SOL_STATES[setup.status] ?? ["unknown", "Unknown"];
    return { state, text };
  }
  if (balance == null) return { state: "unsynced", text: "Not synced yet" };
  return { state: "synced", text: balance };
}

/**
 * The pending shortcut to the Approvals inbox: ZEC payments that are open or wait for their
 * block, and the Solana proposals that a seat of this browser can approve. Null when nothing is
 * pending.
 * @returns {{count: number, text: string} | null}
 */
export function pendingShortcut({ zecOpen = 0, zecFlying = 0, solToApprove = 0 }) {
  const count = zecOpen + zecFlying + solToApprove;
  if (count <= 0) return null;
  return { count, text: count === 1 ? "1 payment is in progress."
    : count + " payments are in progress." };
}
