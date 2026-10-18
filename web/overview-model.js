// The words and numbers of the Overview: the asset rows and the pending shortcut. Display only:
// nothing here approves, signs or sends. An amount that is not known shows as unknown, never as
// zero.

/** The ZEC of the asset row in zatoshi: spendable plus incoming, or null before the first sync. */
export const zecTotal = (b) => (b ? b.spendable + b.pending : null);

/**
 * The SOL asset row, or null when the wallet has no Solana part.
 * @param {object} s on: the part is on; error: the module did not load; setup: the setup
 *   summary of the module (null while it loads); balance: the private balance text of the last
 *   sync, or null.
 * @returns {{state: string, text: string} | null}
 */
export function solRow({ on, error, setup, balance }) {
  if (!on) return null;
  if (error) return { state: "failed", text: "Did not load" };
  if (!setup) return { state: "loading", text: "Loading…" };
  if (setup.status === "stopped") return { state: "stopped", text: "Stopped" };
  if (setup.status !== "ready") return { state: "setup", text: "Setting up" };
  if (balance == null) return { state: "unsynced", text: "Not synced yet" };
  return { state: "synced", text: balance };
}

/**
 * The pending shortcut: ZEC payments that are open or wait for their block, and the Solana
 * proposals that a seat of this browser can approve. Null when nothing is pending.
 * @returns {{count: number, text: string, to: string} | null} `to`: the section to open.
 */
export function pendingShortcut({ zecOpen = 0, zecFlying = 0, solToApprove = 0 }) {
  const zec = zecOpen + zecFlying, count = zec + solToApprove;
  if (count <= 0) return null;
  const text = count === 1 ? "1 payment is in progress." : count + " payments are in progress.";
  return { count, text, to: zec > 0 ? "activity" : "solana" };
}
