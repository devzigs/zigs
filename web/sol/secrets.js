// The Solana secrets of a seat live in one sub-object, `sol`, of the seat secret (ZOLANA.md 3.6):
// the key package, the public key package, the group key, `solSeed`, the secret parts of the
// ceremony and, later, the nonces by digest. The passkey lock, the tab sync and the sealed record
// cover it because it sits in the secrets. backupText in app.js leaves it out of the Zcash file.

/** The Solana secrets of seat `seat` (an empty object when there are none). */
export const solOf = (host, gid, seat) => host.sec(gid, seat)?.sol ?? {};

/**
 * Merges `patch` into the sub-object and saves the seat secret. A null value deletes the field.
 * putSec replaces a field of the seat secret as a whole, so the merge happens here. Resolves
 * true once saved.
 */
export function putSol(host, gid, seat, patch) {
  const next = { ...solOf(host, gid, seat) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return host.putSec(gid, seat, { sol: next });
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
    "Seat " + seat + " stopped the Solana part of this wallet. " + doc.reason.slice(0, ABORT_MAX)
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
