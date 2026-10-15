// The FROST nonces of a seat (ZOLANA.md 5, steps 4 and 5; PROTOCOL.md 7.3). A nonce signs once.
// The wasm cannot enforce that: it signs again with the same nonces for another set of signers
// (p8b verdict), so these rules are the guard, and tests/sol-sessions.mjs pins each one:
//  1. The nonces are saved with the digest of the message before the commit is published.
//  2. When the share is made, the nonces are deleted, the digest is marked used and the share is
//     kept, all in one save, before the share is published. If the save fails, nothing goes out.
//  3. A made share that was not published is published again. The nonces are never used again.
//  4. A digest that made a share is used: no second approval of it, whatever the session. A seat
//     that approved and did not sign can approve the same bytes again in a new session (new
//     nonces), because the old nonces go when their session ends.
// They sit in the seat secret under `sol`, so the passkey lock and the tab sync cover them, and
// they stay out of every backup. A restored seat has none.
import { putSol, solOf } from "./secrets.js";

const part = (c, seat, name) => solOf(c.host, c.gid, seat)[name] ?? {};

/** The saved { digest, nonces, commitments } of seat `seat` for session `sid`, or undefined. */
export const savedNonces = (c, seat, sid) => part(c, seat, "nonces")[sid];
/** True when seat `seat` made a share for this digest, or approved it once. */
export const usedDigest = (c, seat, digest) => digest in part(c, seat, "used");
/** The made share { share, digest } of seat `seat` that is not published yet, or undefined. */
export const pendingShare = (c, seat, sid) => part(c, seat, "pending")[sid];

// One save at a time: each change reads the object, changes one key and writes it whole.
let chain = Promise.resolve();
const serial = (run) => {
  const next = chain.then(run, run);
  chain = next.catch(() => {});
  return next;
};

const without = (map, key) => Object.fromEntries(Object.entries(map).filter(([k]) => k !== key));

async function save(c, seat, make, failure) {
  const saved = await serial(() => putSol(c.host, c.gid, seat, make()));
  if (!saved) throw new Error(failure);
}

/**
 * Saves the nonces of an approval, and with them the (first nullifier, salt) pair of a private
 * payment (spend.js). It throws when the save fails, so no commit goes out.
 */
export const saveNonces = (c, seat, sid, entry) =>
  save(
    c,
    seat,
    () => ({
      nonces: { ...part(c, seat, "nonces"), [sid]: entry },
      ...(entry.spend ? { salts: { ...part(c, seat, "salts"), [sid]: entry.spend.pair } } : {}),
    }),
    "Could not save the approval in this browser, so it was not sent.",
  );

/** The share is made: delete the nonces, mark the digest used, keep the share. One save. */
export const spendNonces = (c, seat, sid, entry, share) =>
  save(
    c,
    seat,
    () => ({
      nonces: without(part(c, seat, "nonces"), sid),
      used: { ...part(c, seat, "used"), [entry.digest]: sid },
      pending: { ...part(c, seat, "pending"), [sid]: { share, digest: entry.digest } },
    }),
    "Could not save the used nonce, so the signature share was not sent.",
  );

/** The share is in the store: forget it. */
export const clearPending = (c, seat, sid) =>
  save(
    c,
    seat,
    () => ({ pending: without(part(c, seat, "pending"), sid) }),
    "Could not save that the signature share was sent.",
  );

/** Deletes the nonces of session `sid` that were never used (the session ended without them). */
export const dropNonces = (c, seat, sid) =>
  save(
    c,
    seat,
    () => ({ nonces: without(part(c, seat, "nonces"), sid) }),
    "Could not delete the nonces of an ended session.",
  );
