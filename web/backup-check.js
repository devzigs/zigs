// Read-only saved-file checks. This module has no storage, restore or network capabilities.
import { canonical, samePackages, shareShape } from "./util.js";

export const MAX_CHECK_BYTES = 1000000;
const WRONG = "This is not the saved recovery file for this device, wallet and network. "
  + "No key shares were changed.";
const object = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const same = (a, b) => a !== undefined && b !== undefined && canonical(a) === canonical(b);
const fits = (a, b) => shareShape(a) && same(a, b);
const secretFields = ["vaultSk", "boxSk", "signSk", "version", "room"];
const heldFieldsMatch = (a, b) => secretFields.every((key) => b[key] === undefined
  || same(a[key], b[key]));
const zecChecks = [
  (f, e) => object(f.secret) && object(e.secret),
  (f, e) => fits(f.secret.keyPackage, e.secret.keyPackage),
  (f, e) => samePackages([f.secret.publicKeyPackage, e.secret.publicKeyPackage]),
  (f, e) => same(f.secret.groupKey, e.secret.groupKey),
  (f, e) => f.key === e.key,
  (f, e) => f.threshold === e.threshold && f.of === e.of,
  (f, e) => object(f.wallet) && object(e.wallet),
  (f, e) => f.wallet.address === e.wallet.address,
  (f, e) => (f.wallet.network ?? null) === (e.wallet.network ?? null),
  (f, e) => heldFieldsMatch(f.secret, e.secret),
];
const solChecks = [
  (f, e) => f.cluster === "devnet" && e.cluster === "devnet",
  (f, e) => fits(f.keyPackage, e.keyPackage),
  (f, e) => samePackages([f.publicKeyPackage, e.publicKeyPackage]),
  (f, e) => same(f.groupKey, e.groupKey) && same(f.solSeed, e.solSeed),
  (f, e) => e.proveLocal !== true || f.proveLocal === true,
];
const kinds = new Map([["zigs-key-share", zecChecks], ["zigs-sol-backup", solChecks]]);

/** Compare the decrypted file with a snapshot of the existing, verified local share. */
export function checkBackupPayload(file, expected) {
  if (!object(file) || !object(expected)) throw new Error(WRONG);
  const checks = kinds.get(expected.kind);
  if (!checks || file.kind !== expected.kind || file.group !== expected.group
      || file.seat !== expected.seat) throw new Error(WRONG);
  if (!checks.every((check) => check(file, expected))) throw new Error(WRONG);
  return true;
}

async function encryptedText(file) {
  if (!file || file.size > MAX_CHECK_BYTES) {
    throw new Error("Choose a Zigs recovery file smaller than 1 MB.");
  }
  const text = await file.text();
  if (new TextEncoder().encode(text).length > MAX_CHECK_BYTES) {
    throw new Error("This recovery file is too large.");
  }
  let outer;
  try { outer = JSON.parse(text); }
  catch { throw new Error("Choose the encrypted .zigsbackup file you saved."); }
  if (!object(outer) || outer.kind !== "zigs-backup") {
    throw new Error("This is not an encrypted Zigs recovery file. "
      + "Save an encrypted backup, then reopen that file.");
  }
  return text;
}

async function openedPayload(passphrase, text, open) {
  try { return JSON.parse(await open(passphrase, text)); }
  catch {
    throw new Error("The file could not be opened. Check its passphrase and choose the saved "
      + "file again. No key shares were changed.");
  }
}

/** Only an encrypted, reopened file counts. `open` is the existing backupOpen engine call. */
export async function checkSavedBackup(file, passphrase, expected, open) {
  if (!passphrase) {
    throw new Error("Enter the passphrase you saved separately from this file.");
  }
  const text = await encryptedText(file);
  return checkBackupPayload(await openedPayload(passphrase, text, open), expected);
}
