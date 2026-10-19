// The FROST nonces of a seat (ZOLANA.md 5, steps 4 and 5; PROTOCOL.md 7.3). A nonce signs once.
// The wasm cannot enforce that: it signs again with the same nonces for another set of signers
// (p8b verdict), so these rules are the guard, and tests/sol-sessions.mjs pins each one:
//  1. The nonces are saved with the digest of the message before the commit is published.
//  2. When the share is made, the nonces are deleted, the digest is marked used and the share is
//     kept, all in one save, before the share is published. If the save fails, nothing goes out.
//     The read of the nonces, the share and that save run under one lock across the tabs of the
//     browser (shareOnce): a nonce that signs two signing packages breaks the once-only rule of
//     FROST.
//  3. A made share that was not published is published again. The nonces are never used again.
//  4. A digest that made a share is used: no second approval of it, whatever the session. A seat
//     that approved and did not sign can approve the same bytes again in a new session (new
//     nonces), because the old nonces go when their session ends.
// They sit in the seat secret under `sol`, so the passkey lock and the tab sync cover them, and
// they stay out of every backup. A restored seat has none.
import { putSolHeld, solOf } from "./secrets.js";

const part = (c, seat, name) => solOf(c.host, c.gid, seat)[name] ?? {};

/** The saved { digest, nonces, commitments } of seat `seat` for session `sid`, or undefined. */
export const savedNonces = (c, seat, sid) => part(c, seat, "nonces")[sid];
/** True when seat `seat` made a share for this digest, or approved it once. */
export const usedDigest = (c, seat, digest) => digest in part(c, seat, "used");
/** The made share { share, digest } of seat `seat` that is not published yet, or undefined. */
export const pendingShare = (c, seat, sid) => part(c, seat, "pending")[sid];

// Each change runs under the lock of the secrets, after this tab took what storage holds now, as
// the Zcash nonces do (app-payments.js). The secrets are one record that each tab writes whole, so
// two tabs that change it at once undo each other, and a nonce that one tab burned comes back.
// Every other Solana write takes the same lock (putSol). The lock holds across the tabs with Web
// Locks only (app-kit.js). ponytail: every other save of the record takes no lock (ZEC-12: Zcash
// steps, a backup, a restore, a room, the account, the chats, the wallet keys, a seat field such
// as solAuto), so a stale tab can still write old Solana records back through them.
const locked = (c, run) =>
  c.host.exclusive("secrets", async () => {
    await c.host.takeStored();
    return run();
  });

const without = (map, key) => Object.fromEntries(Object.entries(map).filter(([k]) => k !== key));

// Inside the lock only: the lock is not reentrant, so a step that holds it saves with `put`.
async function put(c, seat, make, failure) {
  if (!(await putSolHeld(c.host, c.gid, seat, make()))) throw new Error(failure);
}
const save = (c, seat, make, failure) => locked(c, () => put(c, seat, make, failure));

/**
 * Saves the nonces of an approval, and with them the (first nullifier, salt) pair of a private
 * payment (spend.js) and, for a payment of the program design, its commitment with the SHA-256 of
 * its body (one body per commitment, ZOLANA.md 7.2). It throws when the save fails, so no commit
 * goes out.
 */
export const saveNonces = (c, seat, sid, entry) =>
  save(
    c,
    seat,
    () => ({
      nonces: { ...part(c, seat, "nonces"), [sid]: entry },
      ...(entry.spend ? { salts: { ...part(c, seat, "salts"), [sid]: entry.spend.pair } } : {}),
      ...(entry.body ? { bodies: { ...part(c, seat, "bodies"), ...entry.body } } : {}),
    }),
    "Could not save the approval in this browser, so it was not sent.",
  );

/**
 * The (commitment, SHA-256 of the body) of every payment that a seat of this browser approved.
 * ponytail: the list lives in this browser only (the salts also read the group server, SOL-8): a
 * restored seat or another browser of the seat starts with none. Upgrade path: a signed list
 * (SOL-53).
 */
export function approvedBodies(c) {
  const seen = new Map();
  for (const seat of c.host.localSeats()) {
    for (const [commitment, body] of Object.entries(part(c, seat, "bodies"))) {
      seen.set(commitment + body, { commitment, body });
    }
  }
  return [...seen.values()];
}

const SPEND_FAILED = "Could not save the used nonce, so the signature share was not sent.";
const DROP_FAILED = "Could not delete the nonces of an ended session.";
// The share is made: delete the nonces, mark the digest used, keep the share. One save.
const spent = (c, seat, sid, entry, share) => () => ({
  nonces: without(part(c, seat, "nonces"), sid),
  used: { ...part(c, seat, "used"), [entry.digest]: sid },
  pending: { ...part(c, seat, "pending"), [sid]: { share, digest: entry.digest } },
});
const dropped = (c, seat, sid) => () => ({ nonces: without(part(c, seat, "nonces"), sid) });

/**
 * Makes the share of seat `seat` for session `sid` at most once in this browser, also across its
 * tabs. Under the lock, with what storage holds now, it reads the nonces, calls `make(entry)` (no
 * network) and saves the spend before it returns { share, digest } to publish. null: the nonces
 * are used or gone, a made share waits (the reactor publishes it), or `make` is not ready (null).
 * A throw of `make` deletes the nonces and returns { refused }. A failed save throws: nothing goes
 * out.
 */
export const shareOnce = (c, seat, sid, make) =>
  locked(c, async () => {
    if (pendingShare(c, seat, sid)) return null;
    const entry = savedNonces(c, seat, sid);
    if (!entry) return null;
    let made;
    try {
      made = make(entry);
    } catch (refused) {
      await put(c, seat, dropped(c, seat, sid), DROP_FAILED);
      return { refused };
    }
    if (made === null) return null;
    await put(c, seat, spent(c, seat, sid, entry, made.share), SPEND_FAILED);
    return made;
  });

/** The share is in the store: forget it. */
export const clearPending = (c, seat, sid) =>
  save(
    c,
    seat,
    () => ({ pending: without(part(c, seat, "pending"), sid) }),
    "Could not save that the signature share was sent.",
  );

/** Deletes the nonces of session `sid` that were never used (the session ended without them). */
export const dropNonces = (c, seat, sid) => save(c, seat, dropped(c, seat, sid), DROP_FAILED);
