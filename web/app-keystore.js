// Local secrets, the passkey lock, other-tab sync and IndexedDB.
import { createPasskey, open as openVault, parseVault, seal, unlockKey } from "./vault.js";
import { skey } from "./util.js";
import { normChats } from "./chat.js";
import { log, showBanner } from "./app-state.js";
import { S, said, withTimeout } from "./app-kit.js";
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
export let storageOk = true;
export let lockedVault = null;   // the sealed record until unlock; { damaged } if it does not parse
export let vault = null;         // { rec, key } while unlocked
export function setLocked(v) { lockedVault = v; }
export function setVault(v) { vault = v; }
try {
  const raw = localStorage.getItem("zf-vault");
  if (raw) lockedVault = parseVault(raw) || { damaged: true };
} catch {}
function readPlain(name) {
  try { return JSON.parse(localStorage.getItem(name) || "{}"); }
  catch { storageOk = false; return name === "zf-secrets" ? mem : {}; }
}
export let secrets = lockedVault ? {} : readPlain("zf-secrets");
export function setSecrets(v) { secrets = v; }
export let chats = normChats(lockedVault ? null : readPlain("zf-chats"));
let vaultWrite = Promise.resolve(true);
export const LOCKED_ELSEWHERE = "Zigs was locked in another tab, so this tab cannot save. "
  + "Close it and continue in the locked tab.";

function persistPlain() {
  // With no storage at all, nothing can come back after a reload, so signing stays safe.
  if (secrets === mem) return true;
  try {
    // Another tab turned the lock on: a plain write here would put the keys back in clear.
    if (localStorage.getItem("zf-vault")) { showBanner("bad", LOCKED_ELSEWHERE); return false; }
    localStorage.setItem("zf-secrets", S(secrets));
    localStorage.setItem("zf-keys", S(gkeys));
    localStorage.setItem("zf-chats", S(chats));
    return true;
  } catch { storageOk = false; return false; }
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

export async function persistSealed() {
  try {
    const rec = await seal(vault.key, vault.rec, { ...(await foreignFields()), secrets,
      keys: gkeys, chats, personal: personal || personalDamaged });
    localStorage.setItem("zf-vault", S(rec));
    return true;
  } catch (e) {
    storageOk = false;
    showBanner("bad", "Could not save your key share (" + (e.message || e)
      + "). Keep this tab open, and use Back up.");
    return false;
  }
}

// Writes the secrets and wallet keys. Resolves true once saved. Sealed writes are queued, so the
// last one always holds the newest state.
export function persist() {
  if (lockedVault) return Promise.resolve(false);
  if (!vault) return Promise.resolve(persistPlain());
  vaultWrite = vaultWrite.then(persistSealed);
  return vaultWrite;
}

export async function lockWithPasskey() {
  if (!storageOk) throw new Error("This browser does not let the page save data.");
  const made = await createPasskey();
  // Another tab may have saved newer secrets: seal what storage holds now.
  secrets = readPlain("zf-secrets");
  gkeys = readPlain("zf-keys");
  chats = normChats(readPlain("zf-chats"));
  await takeDeviceAccount();
  vault = made;
  const back = (await persist()) && parseVault(localStorage.getItem("zf-vault"));
  // The sealed copy must open before the plain copy goes.
  const opens = back ? await openVault(vault.key, back).then(() => true, () => false) : false;
  if (!opens) {
    vault = null;
    try { localStorage.removeItem("zf-vault"); } catch {}
    throw new Error("The locked copy was not saved. Your keys stay unlocked in this browser.");
  }
  localStorage.removeItem("zf-secrets");
  localStorage.removeItem("zf-keys");
  localStorage.removeItem("zf-chats");
  dropDeviceCopy();
  showBanner("ok", "Locked. Zigs asks for this passkey each time it opens in this browser.");
}

export async function unlockVault() {
  if (lockedVault.damaged) {
    throw new Error("The locked keys in this browser are damaged and cannot be opened.");
  }
  const key = await unlockKey(lockedVault);
  let got;
  try { got = await openVault(key, lockedVault); }
  catch { throw new Error("This passkey does not open the saved keys. Use the Zigs passkey."); }
  secrets = got.secrets || {};
  gkeys = got.keys || {};
  chats = normChats(got.chats);
  adoptPersonal(got.personal);
  dropDeviceCopy();   // a copy that an earlier lock could not delete
  vault = { rec: { cred: lockedVault.cred, salt: lockedVault.salt }, key };
  lockedVault = null;
  adoptInviteKey();   // an invite link opened while locked waits in the fragment
  boot();
}

export function forgetVault() {
  try { localStorage.removeItem("zf-vault"); } catch {}
  location.reload();
}

export function mySeatSecrets(gid) { return Object.entries(secrets).filter(([k]) => k.startsWith(gid + ":")).map(([k, v]) => [Number(k.split(":")[1]), v]); }
export function sec(gid, seat) { return secrets[skey(gid, seat)]; }
export function putSec(gid, seat, patch) {
  const held = Object.assign(secrets[skey(gid, seat)] || {}, patch);
  delete held.backedUp;   // the flag of an older version, see seatBackedUp in util.js
  secrets[skey(gid, seat)] = held;
  return persist();
}

// Every field under groups/{gid} is sealed with the group secret. The secret lives in the invite
// link fragment and in this browser; the server sees paths and field names only.
export let gkeys = {};
export function setGkeys(v) { gkeys = v; }
if (!lockedVault) gkeys = readPlain("zf-keys");
export function putKey(gid, key) { gkeys[gid] = key; persist(); }

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

// Another tab saved: take its secrets and chats, so this tab neither misses nor overwrites them.
const TAB_KEYS = new Set(["zf-secrets", "zf-chats", "zf-vault"]);
export async function takeFromTab(key, value) {
  if (!vault && key === "zf-secrets") secrets = JSON.parse(value);
  if (!vault && key === "zf-chats") chats = normChats(JSON.parse(value));
  if (vault && key === "zf-vault") await takeVault(value);
}

async function takeVault(value) {
  const got = await openVault(vault.key, parseVault(value));
  ({ secrets, keys: gkeys } = got);
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

window.addEventListener("storage", async (ev) => {
  if (lockedVault || !TAB_KEYS.has(ev.key) || !ev.newValue) return;
  try { await takeFromTab(ev.key, ev.newValue); }
  catch (e) { log("could not read another tab's save: " + (e.message || e)); }
  render(); react();
});
