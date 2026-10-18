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
 *   the module loads or runs; setup: its setup summary (null until the module has read the
 *   Solana documents of the wallet); balance: the private balance text of the last sync, or
 *   null; sync: {text, busy} of that sync.
 * @returns {{state: string, text: string} | null}
 */
export function solRow({ on, error, loading, setup, balance, sync }) {
  if (!on) return null;
  if (error) return { state: "failed", text: "Did not load" };
  if (!setup) {
    return loading ? { state: "loading", text: "Loading…" } : { state: "idle", text: "Not open" };
  }
  if (setup.status !== "ready") {
    const [state, text] = SOL_STATES[setup.status] ?? ["unknown", "Unknown"];
    return { state, text };
  }
  return balanceRow(balance, sync ?? {});
}

// A balance carries the age of its sync: this page, a saved sync, or an older one when the last
// sync failed.
function balanceRow(balance, { text = "", busy = false }) {
  if (balance == null) {
    return busy ? { state: "syncing", text: "Syncing…" }
      : { state: "unsynced", text: "Not synced yet" };
  }
  if (text.startsWith("failed")) return { state: "stale", text: balance };
  return { state: text.startsWith("saved") ? "saved" : "synced", text: balance };
}

/**
 * The pending shortcut to the Approvals inbox, or null when nothing is pending. zec: the ZEC
 * payments in progress (open, waiting for their block, or held by an approval here), each counted
 * once; sol: the Solana proposals that a seat of this browser can approve.
 * @returns {{count: number, text: string} | null}
 */
export function pendingShortcut({ zec, sol }) {
  if (!(zec + sol > 0)) return null;
  const text = [zec && zecLine(zec), sol && solLine(sol)].filter(Boolean).join(" ");
  return { count: zec + sol, text };
}
const zecLine = (n) => (n === 1 ? "1 Zcash payment is in progress."
  : n + " Zcash payments are in progress.");
const solLine = (n) => (n === 1 ? "1 Solana proposal waits for your approval."
  : n + " Solana proposals wait for your approval.");
