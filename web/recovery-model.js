// The words of the Recovery section, for the seats of the open wallet in this browser. Zigs knows
// one recovery fact only: a file that this browser saved. It cannot see the files of the other
// devices, and it does not reopen a saved file, so no text here says that the wallet is safe.
// Display only: nothing here makes or opens a file.

/**
 * How many key shares the wallet can lose and still pay, and what one browser that holds `here`
 * seats puts at risk: its loss loses all of them at once.
 * @returns {{margin: number, title: string, detail: string, here: string}}
 */
export function protectionRisk(t, n, here = 1) {
  const margin = n - t;
  return { margin, title: marginTitle(margin), detail: marginDetail(t, n, margin),
    here: here > 1 ? "This browser holds " + here + " devices of this wallet, so its loss loses "
      + here + " key shares at once" + (here > margin ? ": more than the wallet can lose." : ".")
      : "" };
}
const marginTitle = (m) => (m <= 0 ? "No key share can be lost"
  : m === 1 ? "1 key share can be lost" : m + " key shares can be lost");
const marginDetail = (t, n, m) => (m <= 0
  ? "Each payment needs every device. When one key share is lost, the wallet cannot pay until "
    + "its key share comes back from its file."
  : "A payment needs " + t + " of " + n + " devices, so the wallet still pays when "
    + (m === 1 ? "1 key share is" : "up to " + m + " key shares are") + " lost. Two files of "
    + "the same key share count as one device.");

/**
 * The recovery state of your seats in the open wallet. A part with `missing` has no share here;
 * a part with `unknown` is not read yet (`failed`: it could not be read).
 * @param {Array<{id: number, zec: {has: boolean, saved: boolean},
 *   sol: {has: boolean, saved: boolean, unknown?: boolean, failed?: boolean} | null}>} seats
 * @returns {{state: string, label: string, missing: Array<[number, string]>}} state: none (no
 *   key share here), missing (a file is not saved), unknown (the Solana part is not read) or
 *   saved; missing: [seat, "zec" | "sol"].
 */
export function recoveryState(seats) {
  const missing = seats.flatMap((s) => [["zec", s.zec], ["sol", s.sol]]
    .filter(([, part]) => part?.has && !part.saved).map(([what]) => [s.id, what]));
  const unread = seats.find((s) => s.sol?.unknown)?.sol;
  if (!seats.some((s) => s.zec.has)) {
    return { state: "none", label: "No device of this wallet in this browser", missing };
  }
  if (missing.length) {
    const label = "A file of your devices in this wallet is not saved";
    return { state: "missing", label, missing };
  }
  if (unread) return { state: "unknown", label: unreadLabel(unread.failed), missing };
  return { state: "saved", label: "The files of your devices in this wallet are saved", missing };
}
const unreadLabel = (failed) => (failed ? "Zigs could not read the Solana part of your devices"
  : "Zigs is still reading the Solana part of your devices");
