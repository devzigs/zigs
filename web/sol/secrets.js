// The Solana secrets of a seat live in one sub-object, `sol`, of the seat secret (ZOLANA.md 3.6):
// the key package, the public key package, the group key, `solSeed`, the secret parts of the
// ceremony and, later, the nonces by digest. The passkey lock, the tab sync and the sealed record
// cover it because it sits in the secrets. backupText (app-backups.js) skips it in the Zcash file.

/** The Solana secrets of seat `seat` (an empty object when there are none). */
export const solOf = (host, gid, seat) => host.sec(gid, seat)?.sol ?? {};

/**
 * Merges `patch` into the sub-object and saves the seat secret. A null value deletes the field.
 * putSec replaces a field of the seat secret as a whole, so the merge happens here. Resolves
 * true once saved. It runs under the lock of the secrets, after this tab took what storage holds
 * now: each tab writes the whole record, so a write from an older copy would bring back the
 * nonces that another tab spent (nonces.js).
 */
export const putSol = (host, gid, seat, patch) =>
  host.exclusive("secrets", async () => {
    try {
      await host.takeStored();
    } catch (e) {
      host.log?.("Solana save refused: storage did not read: " + String(e?.message ?? e));
      return false;
    }
    return putSolHeld(host, gid, seat, patch);
  });

/**
 * putSol for a step that holds the lock of the secrets already: the lock is not reentrant. putSec
 * changes memory before it saves, so a failed save gives memory the old values back: no step acts
 * on a change that storage does not hold, such as a spent nonce whose share would go out.
 */
export async function putSolHeld(host, gid, seat, patch) {
  const before = host.sec(gid, seat)?.sol;
  const next = { ...before };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  if (await host.putSec(gid, seat, { sol: next })) return true;
  await host.putSec(gid, seat, { sol: before });
  return false;
}

/** True when the seat holds a finished Solana key share. */
export const holdsShare = (s) => !!s.keyPackage && !!s.solSeed && !!s.groupKey;

const ABORT_MAX = 200;

/**
 * The stop text of the first seat (lowest number) that published a signed abort document with a
 * reason, or undefined. `docs` holds only documents that passed the signature check.
 */
export function remoteStop(docs) {
  const found = Object.entries(docs?.solabort ?? {})
    .filter(([, d]) => typeof d?.reason === "string")
    .sort(([a], [b]) => Number(a) - Number(b))[0];
  if (!found) return undefined;
  const [seat, doc] = found;
  return (
    "Device " + seat + " stopped the Solana part of this wallet. " + doc.reason.slice(0, ABORT_MAX)
  );
}

const localStop = (host, gid) =>
  host
    .localSeats()
    .map((i) => solOf(host, gid, i).aborted)
    .find(Boolean);

/**
 * The stop text of this wallet, or undefined. A stopped seat of this browser, or a signed abort
 * document of any seat, stops the Solana part of the wallet: the tab, the sync, the backup, the
 * restore and every signing step read it. The document survives a restore, because the group
 * server holds it.
 */
export const stopOf = (c) => localStop(c.host, c.gid) ?? remoteStop(c.docs);

/** Throws the stop text when the wallet stopped. */
export function refuseStopped(c) {
  const text = stopOf(c);
  if (text) throw new Error(text);
}
