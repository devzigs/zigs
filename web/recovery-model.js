// The words of the Recovery section. Zigs knows one recovery fact only: a file that this browser
// saved. It cannot see the files of the other devices, and it does not reopen a saved file, so no
// text here says that the wallet is safe. Display only: nothing here makes or opens a file.

/**
 * How many devices the wallet can lose and still pay.
 * @returns {{margin: number, title: string, detail: string}}
 */
export function protectionRisk(t, n) {
  const margin = n - t;
  if (margin <= 0) {
    return { margin, title: "No device can be lost",
      detail: "Each payment needs every signer. When one device is lost, the wallet cannot pay "
        + "until its seat comes back from its file." };
  }
  return { margin, title: margin === 1 ? "1 device can be lost" : margin + " devices can be lost",
    detail: "A payment needs " + t + " of " + n + " signers, so the wallet still pays when "
      + margin + " of them lose their device. Two files of the same seat count as one signer." };
}

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
