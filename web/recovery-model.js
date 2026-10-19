// The words of the Recovery section. Zigs knows one recovery fact only: a file that this browser
// saved. It cannot see the files of the other devices, and it does not reopen a saved file, so no
// text here says that the wallet is safe. Display only: nothing here makes or opens a file.

/**
 * How many key shares the wallet can lose and still pay, and what one browser that holds `here`
 * seats puts at risk: its loss loses all of them at once.
 * @returns {{margin: number, title: string, detail: string, here: string}}
 */
export function protectionRisk(t, n, here = 1) {
  const margin = n - t;
  return { margin, title: marginTitle(margin), detail: marginDetail(t, n, margin),
    here: here > 1 ? "This browser holds " + here + " seats, so its loss loses " + here
      + " key shares at once" + (here > margin ? ": more than the wallet can lose." : ".") : "" };
}
const marginTitle = (m) => (m <= 0 ? "No key share can be lost"
  : m === 1 ? "1 key share can be lost" : m + " key shares can be lost");
const marginDetail = (t, n, m) => (m <= 0
  ? "Each payment needs every signer. When one key share is lost, the wallet cannot pay until "
    + "its seat comes back from its file."
  : "A payment needs " + t + " of " + n + " signers, so the wallet still pays when "
    + (m === 1 ? "1 key share is" : "up to " + m + " key shares are") + " lost. Two files of "
    + "the same seat count as one signer.");

/**
 * The recovery state of the seats of this browser.
 * @param {Array<{id: number, zec: {has: boolean, saved: boolean},
 *   sol: {has: boolean, saved: boolean} | null}>} seats
 * @returns {{state: string, label: string, missing: Array<[number, string]>}} state: none (no
 *   key share here), missing (a file is not saved) or saved; missing: [seat, "zec" | "sol"].
 */
export function recoveryState(seats) {
  const missing = seats.flatMap((s) => [["zec", s.zec], ["sol", s.sol]]
    .filter(([, part]) => part?.has && !part.saved).map(([what]) => [s.id, what]));
  if (!seats.some((s) => s.zec.has)) {
    return { state: "none", label: "No key share in this browser", missing };
  }
  return missing.length
    ? { state: "missing", label: "A recovery file is not saved", missing }
    : { state: "saved", label: "The recovery files of this browser are saved", missing };
}
