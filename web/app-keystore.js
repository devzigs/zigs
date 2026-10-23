// Local secrets, the passkey lock, other-tab sync and IndexedDB.
import { createPasskey, open as openVault, parseVault, seal, unlockKey } from "./vault.js";
import { canonical, skey } from "./util.js";
import { normChats } from "./chat.js";
import { changeRecipient, checkedRecipient, emptyRecipients, readRecipients } from "./recipients.js";
import { log, showBanner } from "./app-state.js";
import { exclusive, isObj, S, said, withTimeout } from "./app-kit.js";
import { Z } from "./app-engine.js";
import { adoptInviteKey } from "./app-links.js";
import { boot } from "./app-groups.js";
import {
  adoptPersonal, dropDeviceCopy, followAccount, personal, personalDamaged, takeDeviceAccount,
} from "./app-account.js";
import { react, render } from "./app-loop.js";

// Key shares, DKG secrets, signing nonces and wallet keys never leave this browser. With the
// passkey lock on, they are stored only as one sealed record (web/vault.js), and the page asks for
// the passkey when it opens.
const mem = {};
// False while a read failed or a record was damaged (for good on this page), or while the last
// write failed (a write that works clears it).
export let storageOk = true;
let readFailed = false, writeFailed = false;
const setOk = () => { storageOk = !readFailed && !writeFailed; };
const wrote = (ok) => { writeFailed = !ok; setOk(); return ok; };
export let lockedVault = null;   // the sealed record until unlock; { damaged } if it does not parse
export let vault = null;         // { rec, key } while unlocked
let protectionVerified = false, protectionPending = false;
// A deliberate setup choice in this tab only; never a claim that saved data is encrypted.
let unprotectedSetupAcknowledged = false;
export function setLocked(v) { lockedVault = v; protectionVerified = false; }
export function setVault(v) { vault = v; protectionVerified = false; }
try {
  const raw = localStorage.getItem("zf-vault");
  if (raw) lockedVault = parseVault(raw) || { damaged: true };
} catch {}
function readPlain(name) {
  try { return JSON.parse(localStorage.getItem(name) || "{}"); }
  catch { readFailed = true; setOk(); return name === "zf-secrets" ? mem : {}; }
}
export let secrets = lockedVault ? {} : readPlain("zf-secrets");
// No storage that the page can read: the secrets live in this tab only. A damaged record may
// still hold key shares, so nothing is written in this mode.
export const memoryOnly = () => secrets === mem;
export function setSecrets(v) { secrets = v; }
export let chats = normChats(lockedVault ? null : readPlain("zf-chats"));
// The book is device-wide, independent of a wallet and of chat contacts. With the passkey lock
// on it lives inside the existing sealed vault. A damaged record stays intact until repaired.
export const RECIPIENTS_KEY = "zf-recipients";
export let recipients = emptyRecipients(), recipientsError = "";
let recipientsRaw = recipients;
let recipientsReadFailed = false;
function takeRecipients(value) {
  recipientsRaw = value ?? emptyRecipients();
  try { recipients = readRecipients(recipientsRaw); recipientsError = ""; }
  catch (e) { recipients = emptyRecipients(); recipientsError = e.message; }
}
function readPlainRecipients() {
  let raw;
  try { raw = localStorage.getItem(RECIPIENTS_KEY); recipientsReadFailed = false; }
  catch {
    recipientsReadFailed = true;
    recipientsError = "The saved address book cannot be read. Its stored copy has been kept.";
    return;
  }
  // Malformed JSON is still readable data. Keep its exact text as an opaque vault value so
  // the optional book cannot prevent the existing wallet lock from protecting the key shares.
  try { takeRecipients(raw === null ? null : JSON.parse(raw)); }
  catch { takeRecipients(raw); }
}
if (!lockedVault) readPlainRecipients();
export const recipientsBlocked = () => lockedVault || lockedElsewhere()
  ? "Unlock Zigs in the active tab to use this device's address book." : recipientsError;
let vaultWrite = Promise.resolve(true);
export const LOCKED_ELSEWHERE = "Zigs was locked in another tab, so this tab cannot save. "
  + "Close it and continue in the locked tab.";

// Another tab turned the lock on: a plain write here would put the keys back in clear.
export function lockedElsewhere() {
  if (vault || lockedVault) return false;
  try { return !!localStorage.getItem("zf-vault"); } catch { return false; }
}

function persistPlain() {
  // With no storage at all, nothing can come back after a reload, so signing stays safe.
  if (secrets === mem) return true;
  if (lockedElsewhere()) { showBanner("bad", LOCKED_ELSEWHERE); return false; }
  try {
    localStorage.setItem("zf-secrets", S(secrets));
    localStorage.setItem("zf-keys", S(gkeys));
    localStorage.setItem("zf-chats", S(chats));
    return wrote(true);
  } catch { return wrote(false); }
}

// Fields of the stored record that this page does not know stay in it. A page of another version
// saved them, and this save must not erase them.
const VAULT_FIELDS = ["secrets", "keys", "chats", "personal"];
async function foreignFields() {
  try {
    const stored = parseVault(localStorage.getItem("zf-vault"));
    const got = stored ? await openVault(vault.key, stored) : {};
    return Object.fromEntries(Object.entries(got).filter(([k]) => !VAULT_FIELDS.includes(k)));
  } catch (e) {
    log("could not read the saved record again: " + said(e));
    return {};
  }
}

export async function persistSealed(recipientOverride) {
  try {
    const foreign = await foreignFields();
    const rec = await seal(vault.key, vault.rec, { ...foreign, secrets,
      keys: gkeys, chats, personal: personal || personalDamaged,
      recipients: recipientOverride === undefined
        ? (Object.hasOwn(foreign, "recipients") ? foreign.recipients : recipientsRaw)
        : recipientOverride });
    localStorage.setItem("zf-vault", S(rec));
    return wrote(true);
  } catch (e) {
    wrote(false);
    showBanner("bad", "Could not save your key share (" + (e.message || e)
      + "). Keep this tab open, and use Back up.");
    return false;
  }
}

// Writes the secrets and wallet keys. Resolves true once saved. Sealed writes are queued, so the
// last one always holds the newest state. A save also saves the changes that came before it.
export function persist(recipientOverride) {
  const upTo = changes;
  const done = (ok) => {
    if (ok) for (const [k, n] of unsaved) if (n <= upTo) unsaved.delete(k);
    return ok;
  };
  if (lockedVault) return Promise.resolve(false);
  if (!vault) return Promise.resolve(done(persistPlain()));
  vaultWrite = vaultWrite.then(() => persistSealed(recipientOverride)).then(done);
  return vaultWrite;
}
// The seats whose last change no save holds yet, with the number of that change (putSec).
const unsaved = new Map();
let changes = 0;

const PLAIN_KEYS = ["zf-secrets", "zf-keys", "zf-chats", RECIPIENTS_KEY];
const sameVault = (a, b) => !!a && !!b && a.cred === b.cred && a.salt === b.salt;
/** Setup readiness follows a completed storage operation, never the presence of a key alone. */
export function passkeyProtected() {
  if (!protectionVerified || protectionPending || !vault || lockedVault || !storageOk) return false;
  try {
    return sameVault(vault.rec, parseVault(localStorage.getItem("zf-vault")))
      && PLAIN_KEYS.every((name) => localStorage.getItem(name) === null);
  } catch { return false; }
}
export function requirePasskeyProtection() {
  if (!passkeyProtected()) throw new Error("Protect this browser with a passkey before "
    + "creating or joining a wallet.");
}
/** Only an ordinary, readable unprotected store can take the explicit setup opt-out. */
export function canSkipPasskeyProtection() {
  if (vault || lockedVault || protectionPending || !storageOk || memoryOnly()
    || recipientsReadFailed || recipientsError || personalDamaged !== null) {
    return clearSetupAcknowledgement();
  }
  try {
    // Read again even if no storage event arrived: another tab may have enabled protection.
    // Any existing record, including a damaged or empty one, must be kept for recovery.
    if (localStorage.getItem("zf-vault") !== null) return clearSetupAcknowledgement();
    for (const name of PLAIN_KEYS) {
      const text = localStorage.getItem(name);
      if (text === null) continue;
      if (name === RECIPIENTS_KEY) readRecipients(JSON.parse(text));
      else plainCopy(name, text);
    }
    if (localStorage.getItem("zf-vault") !== null) return clearSetupAcknowledgement();
    return true;
  } catch { return clearSetupAcknowledgement(); }
}
function clearSetupAcknowledgement() { unprotectedSetupAcknowledged = false; return false; }
/** Called only by the explicit confirmation action, never by a cancelled credential prompt. */
export function acknowledgeUnprotectedSetup() {
  if (!canSkipPasskeyProtection()) throw new Error("Browser protection cannot be skipped while "
    + "saved data is locked, unreadable or incompletely protected. Reload and unlock the saved "
    + "copy; keep recovery files before deleting anything.");
  unprotectedSetupAcknowledged = true;
}
export function setupProtectionReady() {
  return passkeyProtected() || (unprotectedSetupAcknowledged && canSkipPasskeyProtection());
}
export function requireSetupProtection() {
  if (!setupProtectionReady()) throw new Error("Protect this browser with a passkey or explicitly "
    + "confirm continuing without protection before creating or joining a wallet.");
}
function canEnableProtection() {
  if (!storageOk) throw new Error("This browser does not let the page save data.");
  if (vault || lockedVault || localStorage.getItem("zf-vault")) throw new Error(
    "A passkey-protected copy already exists or protection is incomplete. Reload and unlock "
    + "that copy; keep recovery files before deleting anything.");
}
function lockSources() {
  // Another tab may have saved newer secrets: seal what storage holds now.
  const next = { secrets: readPlain("zf-secrets"), keys: readPlain("zf-keys"),
    chats: normChats(readPlain("zf-chats")) };
  readPlainRecipients();
  if (!storageOk) throw new Error("The saved keys could not be read, so Zigs did not lock. "
    + "Their stored copies have been kept.");
  if (recipientsReadFailed) throw new Error("The address book could not be read, so Zigs did "
    + "not lock. Its stored copy has been kept.");
  return next;
}
function removePlainCopies() {
  for (const name of PLAIN_KEYS) localStorage.removeItem(name);
  if (PLAIN_KEYS.some((name) => localStorage.getItem(name) !== null)) {
    throw new Error("The unprotected copies could not be removed. Keep this tab open and "
      + "save recovery files; passkey protection is incomplete.");
  }
}
function rollbackLock(made, saved) {
  vault = null;
  try {
    const text = localStorage.getItem("zf-vault");
    // A tab or storage change must never make a failed activation delete another vault.
    if (text === saved && sameVault(parseVault(text), made.rec)) {
      localStorage.removeItem("zf-vault");
    }
  } catch { /* the plain copies remain, and setup stays blocked */ }
}
async function finishProtection(made) {
  const next = lockSources();
  const bookToLock = recipientsRaw;
  await takeDeviceAccount();
  canEnableProtection();
  secrets = next.secrets; gkeys = next.keys; chats = next.chats;
  vault = made;
  let saved;
  try {
    if (!await persist(bookToLock)) throw new Error("The locked copy was not saved.");
    saved = localStorage.getItem("zf-vault");
    const back = parseVault(saved);
    if (!sameVault(back, made.rec)) throw new Error("The locked copy changed during setup.");
    const got = await openVault(made.key, back);
    const expected = { secrets, keys: gkeys, chats, personal: personal || personalDamaged,
      recipients: bookToLock };
    if (S(got) !== S(expected)) throw new Error("The locked copy did not preserve the saved data.");
    if (localStorage.getItem("zf-vault") !== saved) {
      throw new Error("The locked copy changed while it was being checked.");
    }
  } catch (e) {
    rollbackLock(made, saved);
    throw new Error((e.message || "The locked copy could not be checked.")
      + " Your unprotected copies have been kept; passkey protection is incomplete.");
  }
  removePlainCopies();
  await dropDeviceCopy(true);
  protectionVerified = true;
  showBanner("ok", "Locked. Zigs asks for this passkey each time it opens in this browser.");
}
export async function lockWithPasskey() {
  clearSetupAcknowledgement();
  if (protectionPending) throw new Error("Passkey protection is still being enabled. Wait for it.");
  if (passkeyProtected()) return;
  canEnableProtection();
  if (!globalThis.navigator?.locks?.request) throw new Error("This browser cannot safely enable "
    + "passkey protection across tabs. Use a browser with Web Locks support.");
  protectionPending = true; protectionVerified = false;
  try {
    // Account changes take only `account`; secret changes take only `secrets`. Neither takes
    // these in reverse order. Holding both also keeps their saves out of the credential prompt.
    await exclusive("account", () => exclusive("secrets", async () => {
      canEnableProtection();
      const made = await createPasskey();
      canEnableProtection();
      await finishProtection(made);
    }));
  } finally { protectionPending = false; }
}

export async function unlockVault() {
  protectionVerified = false;
  if (lockedVault.damaged) {
    throw new Error("The locked keys in this browser are damaged and cannot be opened.");
  }
  const key = await unlockKey(lockedVault);
  // Another tab may have saved since this page loaded: open the record that storage holds now.
  const rec = parseVault(localStorage.getItem("zf-vault")) || lockedVault;
  let got;
  try { got = await openVault(key, rec); }
  catch { throw new Error("This passkey does not open the saved keys. Use the Zigs passkey."); }
  secrets = got.secrets || {};
  gkeys = got.keys || {};
  chats = normChats(got.chats);
  takeRecipients(got.recipients);
  // A tab from before the address book may have turned on the lock. Its vault has no book
  // field, so migrate the device record rather than silently deleting the only copy.
  const migrateRecipients = !Object.hasOwn(got, "recipients") && localStorage.getItem(RECIPIENTS_KEY) !== null;
  if (migrateRecipients) readPlainRecipients();
  adoptPersonal(got.personal);
  vault = { rec: { cred: lockedVault.cred, salt: lockedVault.salt }, key };
  lockedVault = null;
  // A storage event of another tab during the unlock was dropped: take what storage holds now,
  // before this tab saves anything over it.
  const reread = await rereadUnlocked();
  const migrated = !migrateRecipients || (!recipientsReadFailed && await persist(recipientsRaw));
  const saved = migrated ? localStorage.getItem("zf-vault") : null;
  const checked = saved && await openVault(key, parseVault(saved)).catch(() => null);
  if (reread && checked && bookMatches(checked)) await finishUnlockedProtection(checked, saved);
  adoptInviteKey();   // an invite link opened while locked waits in the fragment
  boot();
}

async function rereadUnlocked() {
  try { await takeFromTab("zf-vault"); return true; }
  catch (e) { log("could not read another tab's save: " + said(e)); return false; }
}
function bookMatches(data) {
  const book = Object.hasOwn(data, "recipients") ? data.recipients : emptyRecipients();
  return S(book) === S(recipientsRaw);
}
// Older tabs can leave a plain copy beside a vault. Keep every changed or extra value until
// reviewed; successful unlock alone proves nothing about those separate records.
function coveredBy(plain, sealed) {
  if (!isObj(plain) || Array.isArray(plain)) return canonical(plain) === canonical(sealed);
  if (!isObj(sealed) || Array.isArray(sealed)) return false;
  return Object.entries(plain).every(([name, value]) => Object.hasOwn(sealed, name)
    && coveredBy(value, sealed[name]));
}
function checkPlainCopies(data) {
  const fields = [["zf-secrets", "secrets"], ["zf-keys", "keys"], ["zf-chats", "chats"],
    [RECIPIENTS_KEY, "recipients"]];
  for (const [name, field] of fields) {
    const text = localStorage.getItem(name);
    if (text === null) continue;
    const plain = plainCopy(name, text);
    if (!coveredBy(plain, data[field])) throw new Error(
      "An unprotected browser copy has data outside the verified vault. Its exact copy was "
      + "kept. Save recovery files and review it before setting up another wallet.");
  }
}
function plainCopy(name, text) {
  let plain;
  try { plain = JSON.parse(text); }
  catch (e) { if (name === RECIPIENTS_KEY) return text; throw e; }
  if (name !== RECIPIENTS_KEY && (!isObj(plain) || Array.isArray(plain))) {
    throw new Error("An unprotected browser copy is unreadable. Its exact copy was kept.");
  }
  return plain;
}
async function finishUnlockedProtection(data, saved) {
  try {
    if (localStorage.getItem("zf-vault") !== saved) {
      throw new Error("The locked copy changed while protection was being checked. Try again.");
    }
    checkPlainCopies(data);
    removePlainCopies();
    await dropDeviceCopy(true);
    protectionVerified = true;
  } catch (e) { showBanner("bad", e.message || "Passkey protection is incomplete."); }
}

export function forgetVault() {
  try { localStorage.removeItem("zf-vault"); } catch {}
  try { localStorage.removeItem("zf-drafts"); } catch {}   // sealed with keys that go too
  location.reload();
}

/**
 * Takes what storage holds now into this tab, after this tab's own queued writes: another tab
 * may have saved a change that this tab has not taken yet (takeSecrets, takeKeys, takeChats and,
 * from a sealed record, takeAccount). A missing or unreadable plain record leaves this tab as it
 * is: it may be the last copy. A sealed record that does not open stops the step. Resolves to the
 * opened sealed record, else null.
 */
export async function takeStored() {
  if (lockedVault) return null;
  if (vault) return takeSealed();
  if (secrets === mem) return null;
  try {
    if (localStorage.getItem("zf-vault")) return null;
    takeSecrets(plainRecord("zf-secrets", {}));
    takeKeys(plainRecord("zf-keys", {}));
    takeChats(normChats(plainRecord("zf-chats", null)));
    readPlainRecipients();
  } catch { /* blocked or damaged: keep this tab's copy */ }
  return null;
}
// The plain record `name`, or `empty` when there is none. A damaged record throws.
const plainRecord = (name, empty) => JSON.parse(localStorage.getItem(name)) ?? empty;
// Each seat in storage comes in whole: another tab may have saved it since this tab read it. A
// seat whose last change no save holds keeps that change. Only the records of its approvals come
// from storage: the nonces, the marks, the kept shares and the Solana records (SOL_RECORDS). A
// change that was not saved never went out. A seat that only this tab holds stays.
function takeSecrets(stored) {
  for (const [k, v] of Object.entries(stored)) {
    if (!isObj(v)) continue;
    secrets[k] = unsaved.has(k) && secrets[k] ? withStoredNonces(secrets[k], v) : v;
  }
}
function withStoredNonces(mine, v) {
  const out = { ...mine, nonces: v.nonces, marks: v.marks, unsent: v.unsent };
  if (!mine.sol && !v.sol) return out;
  out.sol = { ...mine.sol };
  for (const f of SOL_RECORDS) out.sol[f] = v.sol?.[f];
  return out;
}
// The Solana records of the approvals of a seat (web/sol/nonces.js).
const SOL_RECORDS = ["nonces", "used", "pending", "salts", "bodies"];
// Both sides keep their wallet keys. ponytail: a key that an undone restore removed in another tab
// comes back here, and opens that wallet with no seat, as an invite link does.
const takeKeys = (stored) => { gkeys = { ...stored, ...gkeys }; };
// Both sides keep their chats, and this tab keeps its profile. ponytail: a chat that the person
// left in another tab comes back when a step here saves before the storage event of the leave.
const takeChats = (stored) => {
  chats = { profile: chats.profile || stored.profile, list: { ...stored.list, ...chats.list } };
};
// A step here keeps an account that a record of another tab holds and this tab does not have
// yet, so it never seals "no account" over one.
function takeAccount(got) {
  if (personal || personalDamaged || got.personal == null) return;
  adoptPersonal(got.personal);
  followAccount();
}
export function mySeatSecrets(gid) { return Object.entries(secrets).filter(([k]) => k.startsWith(gid + ":")).map(([k, v]) => [Number(k.split(":")[1]), v]); }
export function sec(gid, seat) { return secrets[skey(gid, seat)]; }
export function putSec(gid, seat, patch) {
  const k = skey(gid, seat);
  const held = Object.assign(secrets[k] || {}, patch);
  delete held.backedUp;   // the flag of an older version, see seatBackedUp in util.js
  secrets[k] = held;
  unsaved.set(k, ++changes);
  return persist();
}

// Every field under groups/{gid} is sealed with the group secret. The secret lives in the invite
// link fragment and in this browser; the server sees paths and field names only.
export let gkeys = {};
export function setGkeys(v) { gkeys = v; }
if (!lockedVault) gkeys = readPlain("zf-keys");
export function putKey(gid, key) { gkeys[gid] = key; return persist(); }

// Sync state, sealed with the group key (the account: with its own sync key), so a reload
// continues from the last block. `c.id` and `c.secret` name the entry and its key; a wallet has
// its id and its group key.
export const snapId = (c) => c.id ?? c.gid;
const snapSecret = (c) => c.secret ?? gkeys[c.gid];
let idbOpen = null, idbOpenMs = 5000;
export function setIdbMs(v) { idbOpenMs = v; }
// Opens the database once. An open that fails or never answers is forgotten, so that the next call
// tries again and a stuck browser cannot hold a caller for ever.
function idbHandle() {
  idbOpen ||= withTimeout(new Promise((res, rej) => {
    const r = indexedDB.open("zigs", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("chain");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }), idbOpenMs, "IndexedDB").catch((e) => { idbOpen = null; throw e; });
  return idbOpen;
}
export function idb(mode, fn) {
  return idbHandle().then((db) => new Promise((res, rej) => {
    const tx = db.transaction("chain", mode), req = fn(tx.objectStore("chain"));
    // The error event of a request reaches the transaction before tx.error is set.
    tx.oncomplete = () => res(req.result);
    tx.onerror = (ev) => rej(ev.target.error || tx.error || new Error("IndexedDB request failed"));
    tx.onabort = () => rej(tx.error || new Error("IndexedDB transaction aborted"));
  }));
}
export function setIdb(f) { idb = f; }
export async function loadSnapshot(c) {
  try {
    const sealed = await idb("readonly", (st) => st.get(snapId(c)));
    return sealed ? Z.secretOpen(snapSecret(c), "chain\n" + snapId(c), sealed) : null;
  }
  catch (e) { log("saved wallet state unreadable: " + (e.message || e)); return null; }
}
export async function saveSnapshot(c) {
  try {
    const sealed = Z.secretSeal(snapSecret(c), "chain\n" + snapId(c), c.cw.snapshot());
    await idb("readwrite", (st) => st.put(sealed, snapId(c)));
  }
  catch (e) { log("could not save wallet state: " + (e.message || e)); }
}

// The PCZT of a payment that a seat of this browser approved (TICKETS.md ZEC-13), sealed
// with the group key like the sync state. Losing it only turns "expired" into "unknown".
const keptId = (gid, sid) => "kept:" + gid + ":" + sid;
export async function saveKept(gid, sid, pczt) {
  try {
    const sealed = Z.secretSeal(gkeys[gid], "kept\n" + gid + ":" + sid, pczt);
    await idb("readwrite", (st) => st.put(sealed, keptId(gid, sid)));
  }
  catch (e) { log("could not keep the approved payment: " + (e.message || e)); }
}
export async function loadKept(gid, sid) {
  try {
    const sealed = await idb("readonly", (st) => st.get(keptId(gid, sid)));
    return sealed ? Z.secretOpen(gkeys[gid], "kept\n" + gid + ":" + sid, sealed) : null;
  }
  catch (e) { log("kept payment unreadable: " + (e.message || e)); return null; }
}

// Another tab saved. Under the lock of the secrets this tab takes what storage holds now, as a
// locked step does, so a step of this tab is never undone and a late event changes nothing. Then
// the chats, and the account of a sealed record, come in as the other tab saved them: a chat or an
// account that it removed goes here too.
const TAB_KEYS = new Set(["zf-secrets", "zf-keys", "zf-chats", "zf-vault", RECIPIENTS_KEY]);
export function takeFromTab(key) {
  if (vault ? key !== "zf-vault" : key === "zf-vault") return Promise.resolve();
  return exclusive("secrets", async () => {
    const got = await takeStored();
    if (got) takeVaultRest(got);
    else if (key === "zf-chats") chats = normChats(plainRecord(key, null));
    else if (key === RECIPIENTS_KEY) readPlainRecipients();
  });
}

// Reads the sealed record again until no write of this tab came in during the decrypt, so such a
// write (a removed seat too) is never undone. Resolves to the opened record.
async function takeSealed() {
  for (;;) {
    const queued = vaultWrite;
    await queued;
    const text = localStorage.getItem("zf-vault");
    if (!text) return null;
    const got = await openVault(vault.key, parseVault(text)).catch(() => {
      throw new Error("The locked keys in this browser cannot be read again. Reload the page.");
    });
    if (queued !== vaultWrite) continue;
    if (got.secrets) takeSecrets(got.secrets);
    if (got.keys) takeKeys(got.keys);
    takeChats(normChats(got.chats));
    takeAccount(got);
    // Missing on an older page's save: keep our book, as unknown vault fields are preserved by
    // current pages. An explicitly empty book is a deletion and must come in whole.
    if (Object.hasOwn(got, "recipients")) takeRecipients(got.recipients);
    return got;
  }
}

function takeVaultRest(got) {
  chats = normChats(got.chats);
  // A page from before the accounts writes no `personal` field, not even null. It erased the
  // account from the record: seal ours again. A null means that another tab removed it.
  if (!("personal" in got)) {
    if (personal || personalDamaged) persist();
    return;
  }
  adoptPersonal(got.personal);
  followAccount();
}

/** Save one destination under the same device lock as other vault changes, taking the latest
 * stored book first. No payment is built or submitted here. Failed writes leave the old book. */
export function saveRecipient(value, previous = null) {
  const next = checkedRecipient(value, (address) => Z.normalizeAddress(address));
  return updateRecipient(previous, next);
}
export const deleteRecipient = (previous) => updateRecipient(previous, null);
function updateRecipient(previous, next) {
  return exclusive("secrets", async () => {
    if (lockedVault || lockedElsewhere()) throw new Error(LOCKED_ELSEWHERE);
    if (memoryOnly()) throw new Error("This browser cannot save recipients. Keep using manual addresses.");
    // A failed/unreadable sealed reread must abort instead of replacing a newer record.
    await takeStored();
    if (!vault) readPlainRecipients();
    if (recipientsBlocked()) throw new Error(recipientsBlocked());
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)),
      (b) => b.toString(16).padStart(2, "0")).join("");
    const changed = changeRecipient(recipients, previous, next, id);
    if (vault) {
      if (!await persist(changed)) throw new Error("The recipient could not be saved. Your changes are still in the form.");
    } else {
      if (lockedElsewhere()) throw new Error(LOCKED_ELSEWHERE);
      try { localStorage.setItem(RECIPIENTS_KEY, S(changed)); }
      catch { throw new Error("The recipient could not be saved. Your changes are still in the form."); }
    }
    takeRecipients(changed);
    return changed;
  });
}

window.addEventListener("storage", async (ev) => {
  if (lockedVault || !TAB_KEYS.has(ev.key) || (!ev.newValue && ev.key !== RECIPIENTS_KEY)) return;
  try { await takeFromTab(ev.key); }
  catch (e) { log("could not read another tab's save: " + (e.message || e)); }
  render(); react();
});
