// The second backup file (ZOLANA.md 4.3). The Zcash `.zigsbackup` and its restore stay as they
// are. This file has the same Argon2id and XChaCha20-Poly1305 shell (outer kind zigs-backup, made
// by the unchanged engine) and the inner kind `zigs-sol-backup`: the wallet id, the seat, the
// cluster, the key package, the public key package, the group key and solSeed. It has no snapshot
// and no nonce, and no fee key: the key share gives the fee key (fee.js), so a restore of any
// file brings back the key that the seat published. A restore runs only on a seat that settled
// and fits. When the document of the seat shows another key than the key share gives, the restore
// says that this seat cannot pay and what can still be done.
import { backupName, shareShape } from "../util.js";
import { agreement, fitsSolana } from "./ceremony.js";
import { CLUSTER, COLLECTIONS } from "./docs.js";
import { feeMismatch, mismatchText } from "./fee.js";
import { holdsShare, putSol, refuseStopped, solOf, stopOf } from "./secrets.js";

/** The inner kind of the sealed text. app-sol.js sends a file of this kind to restoreSolana. */
export const KIND = "zigs-sol-backup";
const NOT_A_BACKUP = "This file is not a Zigs Solana backup.";
const NOT_ENCRYPTED = "This Solana backup file is not encrypted. Make a new encrypted backup.";
const NO_FIT = "This Solana backup does not fit this wallet. It was not used.";
const WAIT_MS = 20000;
const HEX64 = /^[0-9a-f]{64}$/;
const isObj = (x) => !!x && typeof x === "object";

// The pin of local proving (SOL-4): a restored seat proves on its device without the server.
const pinOf = (part) => (part.proveLocal === true ? { proveLocal: true } : {});

/** The plain text of the backup of seat `i`. */
export function backupText(host, gid, i) {
  const s = solOf(host, gid, i);
  return JSON.stringify({
    kind: KIND,
    group: gid,
    groupName: host.state.g.name,
    seat: i,
    cluster: s.cluster ?? CLUSTER,
    keyPackage: s.keyPackage,
    publicKeyPackage: s.publicKeyPackage,
    groupKey: s.groupKey,
    solSeed: s.solSeed,
    ...pinOf(s),
  });
}

/** The words and the save call of the backup dialog of seat `i` (backupDialog, app-backups.js). */
export function backupWords(c, i) {
  const { host, gid } = c;
  refuseStopped(c);
  return {
    title: "Back up the Solana part of seat " + i,
    pass:
      "This passphrase opens your Solana key share. Zigs cannot recover it. Write it down " +
      "and keep it apart from the file. It is a second file with its own passphrase.",
    file:
      "The file holds your Solana key share and the secret that gives the Solana viewing and " +
      "proving keys. Your fee key comes from the key share. Anyone who has the file and the " +
      "passphrase can sign as this seat on Solana and spend the SOL of its fee address.",
    async save(pass) {
      refuseStopped(c);
      if (!holdsShare(solOf(host, gid, i)))
        throw new Error("Seat " + i + " has no Solana part yet.");
      const name = backupName(host.state.g.name + " solana", i);
      return host.sealAndSave(pass, backupText(host, gid, i), name);
    },
  };
}

const FILE_CHECKS = [
  (b) => b.kind === KIND && typeof b.group === "string" && b.cluster === CLUSTER,
  (b) => Number.isInteger(b.seat) && b.seat >= 1 && b.seat <= 7,
  (b) => HEX64.test(b.solSeed) && HEX64.test(b.groupKey),
  (b) => shareShape(b.keyPackage) && isObj(b.publicKeyPackage),
  (b) => b.proveLocal === undefined || b.proveLocal === true,
];

function readFile(b) {
  if (!isObj(b) || !FILE_CHECKS.every((ok) => ok(b))) throw new Error(NOT_A_BACKUP);
  return b;
}

const loaded = (c, gid) => c.gid === gid && COLLECTIONS.every((n) => c.loaded[n]) && c.wait === 0;
const REFUSE = (text) => ({ refuse: text });
const WAIT = (text) => ({ wait: text });

// Each check answers a verdict that stops the restore, or null to go on. Order matters.
const noSeat = (c, f) =>
  !c.host.sec(f.group, f.seat) &&
  REFUSE(
    "This browser holds no seat " +
      f.seat +
      " of this wallet. Restore the seat first, then open the Solana backup.",
  );
const notLoaded = (c, f) =>
  (c.host.state.gid !== f.group || !c.host.state.g || !loaded(c, f.group)) &&
  WAIT("The wallet did not load in time. Open it, then open the file again.");
const stopped = (c) => {
  const text = stopOf(c);
  return !!text && REFUSE(text);
};
const notSettled = (c, f) =>
  (!c.host.localSeats().includes(f.seat) || c.host.seatCheck(f.seat) !== true) &&
  WAIT(
    "Seat " + f.seat + " must show Address checked " + "before its Solana part can be restored.",
  );
const noDone = (c, f) =>
  !c.docs.soldone[f.seat] &&
  REFUSE("This wallet has no published Solana " + "key for seat " + f.seat + ".");
const hasData = (c, f) =>
  Object.keys(solOf(c.host, f.group, f.seat)).length > 0 &&
  REFUSE("Seat " + f.seat + " already has Solana data in this browser, so it was not restored.");
const noFit = (c, f) =>
  (!fitsSolana(c.W, f.seat, f, c.docs.soldone[f.seat]) || agreement(c).state === "differ") &&
  REFUSE(NO_FIT);
// fitsSolana compares the share with the published data, not with its own public share.
const badShare = (c, f) =>
  !c.W.sol_share_fits(JSON.stringify(f.keyPackage)) &&
  REFUSE("The key share in this Solana backup is damaged. It was not used.");
const CHECKS = [noSeat, notLoaded, stopped, notSettled, noDone, hasData, noFit, badShare];

/** What a restore of `f` may do now: { ok }, { wait: why } or { refuse: why }. */
function verdict(c, f) {
  for (const check of CHECKS) {
    const stop = check(c, f);
    if (stop) return stop;
  }
  return { ok: true };
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function settle(c, f) {
  const end = Date.now() + WAIT_MS;
  for (;;) {
    c.refresh();
    const v = verdict(c, f);
    if (!v.wait || Date.now() > end) return v;
    await sleep(150);
  }
}

/**
 * Restores the Solana part of a seat from the decrypted file `b`. It opens the wallet, waits for
 * its documents, and stores the part only when the key share equals the soldone document of the
 * seat and solSeed gives the published keys and address. Throws a clear text when it refuses.
 */
export async function restoreSolana(c, b, encrypted) {
  if (!encrypted) throw new Error(NOT_ENCRYPTED);
  const f = readFile(b),
    { host } = c,
    early = verdict(c, f);
  if (early.refuse) throw new Error(early.refuse);
  if (host.state.gid !== f.group) host.openGroup(f.group);
  const v = await settle(c, f);
  if (!v.ok) throw new Error(v.refuse ?? v.wait);
  const part = {
    keyPackage: f.keyPackage,
    publicKeyPackage: f.publicKeyPackage,
    groupKey: f.groupKey,
    solSeed: f.solSeed,
    cluster: CLUSTER,
    doneSent: true,
    ...pinOf(f),
  };
  if (!(await putSol(host, f.group, f.seat, part))) {
    throw new Error("This browser could not save the restored Solana part.");
  }
  const text = "Restored the Solana part of seat " + f.seat + ". It matches the wallet.";
  host.showBanner("ok", text + (feeMismatch(c, f.seat) ? " " + mismatchText(f.seat) : ""));
}
