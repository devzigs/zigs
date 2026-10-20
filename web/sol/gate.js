// The checks that every signing step shares. Nothing is proposed, approved or signed while the
// wallet is stopped (here or by a signed abort of any seat), while a document waits for its
// signature check, before the collections are loaded, or before the seats agree on one key.
import { agreement, startBlock } from "./ceremony.js";
import { COLLECTIONS } from "./docs.js";
import { feeProblem } from "./fee.js";
import { holdsShare, solOf, stopOf } from "./secrets.js";
import { SESSIONS } from "./sessions.js";

const LOADING = "Zigs has not loaded the Solana data of this wallet yet. Try again in a moment.";
const CHECKING = "Zigs is still checking the Solana data of this wallet. Try again in a moment.";

/** Why no signing step may run now, or null. */
export function signingBlock(c) {
  const stop = stopOf(c);
  if (stop) return stop;
  const start = startBlock(c.host);
  if (start) return start;
  if (![...COLLECTIONS, SESSIONS].every((name) => c.loaded[name])) return LOADING;
  if (c.wait > 0 || c.sessWait > 0) return CHECKING;
  if (agreement(c).state !== "agree") return "The devices have not agreed on one Solana key yet.";
  return null;
}

const TRANSIENT = [LOADING, CHECKING];
/** True when `why` of `signingBlock` is a short wait: a document is still loaded or checked. */
export const isWait = (why) => TRANSIENT.includes(why);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * `signingBlock`, after a short wait while the only reason is that a document of the wallet is
 * still being loaded or checked (a signature check takes a moment). A real reason comes at once.
 */
export async function settledBlock(c, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const why = signingBlock(c);
    if (!isWait(why) || Date.now() > end) return why;
    await sleep(50);
  }
}

/** The seats of this browser that hold a Solana key share and may sign a document. */
export const writerSeats = (c) =>
  c.host.localSeats().filter((i) => c.host.canWriteAs(i) && holdsShare(solOf(c.host, c.gid, i)));

/** The first seat of this browser that holds a key share and a fee key that its document shows. */
export const readySeat = (c) => writerSeats(c).find((i) => feeProblem(c, i) === null);

/**
 * The seat that proposes and pays: the first ready one. Throws why there is none: the reason of
 * the first seat that can sign, or that this browser holds no such seat.
 */
export function payerSeat(c) {
  const seat = readySeat(c),
    first = writerSeats(c)[0];
  if (seat !== undefined) return seat;
  if (first === undefined) {
    throw new Error("This browser holds no device that can sign for Solana.");
  }
  throw new Error(feeProblem(c, first));
}
