// The part of the old app.js that has not moved to a module yet. Step E1 deletes it.
import { qrSvg } from "./qr.js";
import {
  allPaid, MEMO_BYTES, memoBytes, memoError, memoShown, pairPayees, parsePayeeList, toZat, zatText,
} from "./payees.js";
import { open as openVault, parseVault, seal } from "./vault.js";
import {
  abortText, backupName, boxPairMatches, checkNetwork, chunks, confirmGate, conflictReason, finite,
  fmtInt, heldRefusal, keysOf, lateFields, makePassphrase, numberClash, passIssue, restoredSecret,
  seatBackedUp, settledFields, shareShape, skey, staleRestore, takenKeys, undoPlan, usesV2,
  walletVersion,
} from "./util.js";
import {
  docFields, filterWallet, IGNORED_NOTE, makeMemo, partFields, proposalFields, readSessions,
  signPart, trustShape, validShape, writerCheck,
} from "./signed.js";
import {
  byTime, canSign, chatWarning, checkText, countUnread, dmText, joinBlock, keyState, membersToPin,
  newRoom, newSignKey, parseDm, parseMsg, pickRoom, pin, pinMember, pinnedMembers, signedText,
  signMsg, signPairMatches, validId, validPk, validRoom, verifyMsg,
} from "./chat.js";
import {
  accountBackupName, accountBalance, addContact, backupPayload, balanceWarnings, chatTimeline,
  EXPIRY_MARGIN, feeFor, fundingPayees, fundingWarning, highestIndex, holdsNotes, messagePlan,
  NAME_MAX, newPersonal, normPersonal, otherWhere, KIND as PERSONAL_KIND, readBackup, receivedItems,
  removeWarning, restoredPersonal, routeItems, salvageBackup, sendGate, SENT_WORDS, sentNote,
  sentState,
} from "./personal.js";
import {
  cardState, payeeBlocker, payeeRows, quoted, readRequest, REQUEST_NET, requestNote, requestPayees,
  requestProblem, requestUri, WALLET_NET,
} from "./requests.js";
import {
  busy, clearBadBanner, emptyRaw, inbox, inboxSubs, log, raw, rawInbox, rawReady, ready, readySubs,
  showBanner, state, ui,
} from "./app-state.js";
import {
  about, elapsed, fmtZec, initials, isObj, isStr, J, oldest, randomHex32, readLocal, S, said,
  saveMerged, short, up, when, withTimeout, writeLocal, ZEC_FMT, zecText,
} from "./app-kit.js";
import { engineOffThread, engineSettled, Z } from "./app-engine.js";
import {
  chats, forgetVault, gkeys, idb, loadSnapshot, LOCKED_ELSEWHERE, lockedVault, lockWithPasskey,
  mySeatSecrets, persist, putKey, putSec, saveSnapshot, sec, secrets, snapId, storageOk,
  unlockVault, vault,
} from "./app-keystore.js";
import {
  allDone, allR1, allSeated, curSession, fitState, isCreator, isMe, keysAgree, keysDiffer,
  localSeats, myUid, r2For, seatIds, seatMine, seatNameOf, seatStage, signersOf, STAGE_LABEL,
} from "./app-seats.js";
import {
  BAD_CONTACT_LINK, badChatLink, chatLink, chatMessage, followHash, inviteLink, isChatId, openChat,
  setHash,
} from "./app-links.js";

export let personal = null;          // the personal account (web/personal.js), with its seed
export function setPersonal(v) { personal = v; }
export let personalError = "";       // why a saved account cannot be read
export let personalDamaged = null;   // the saved value that failed to read, kept so that no save erases it
export let personalPending = false;  // the start-up read of the saved account has not ended
// ── The personal account on disk ──
// With the passkey lock on, the account is a field of the sealed record. With the lock off, local
// storage never holds the seed: it is sealed with an AES key that this browser cannot export, and
// both sit in IndexedDB. Code on this site can still use that key, so the lock stays the safer way.
const DEVICE_REC = { cred: "device", salt: "device" };   // seal() wants a record; no passkey

async function deviceKey() {
  const have = await idb("readonly", (st) => st.get("personal:key"));
  if (have) return have;
  const fresh = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false,
    ["encrypt", "decrypt"]);
  // add() fails when another tab saved a key first. That key is then the one to use.
  try { await idb("readwrite", (st) => st.add(fresh, "personal:key")); return fresh; } catch {
    return idb("readonly", (st) => st.get("personal:key"));
  }
}

// The saved account, or null for none. Throws when IndexedDB fails. A throw with `stored` means
// that a record is there but does not open: it is damaged, and no new account may replace it.
export async function deviceRead() {
  const [key, rec] = await Promise.all(["personal:key", "personal:rec"]
    .map((name) => idb("readonly", (st) => st.get(name))));
  if (!rec) return null;
  const damaged = (e) => Object.assign(new Error(said(e)), { stored: true });
  if (!key) throw damaged(new Error("its key is missing"));
  try { return await openVault(key, rec); } catch (e) { throw damaged(e); }
}

// `fresh` is the first write of a new account: add() refuses it when another tab saved an
// account first, so two tabs cannot both make one.
async function deviceWrite(fresh = false) {
  const rec = await seal(await deviceKey(), DEVICE_REC, personal || personalDamaged);
  const write = (st) => (fresh ? st.add(rec, "personal:rec") : st.put(rec, "personal:rec"));
  await idb("readwrite", write);
}

function deviceClear() {
  return idb("readwrite", (st) => { st.delete("personal:rec"); return st.delete("personal:key"); });
}

// The account is in the sealed record now (a damaged one as it is), so the device copy goes.
export function dropDeviceCopy() {
  if (!personal && !personalDamaged) return;
  deviceClear().catch((e) => log("could not delete the account copy: " + (e.message || e)));
}

// Reads a saved account. A record that does not read stays as it is, and no new account is made
// over it.
export function adoptPersonal(x) {
  personal = null; personalError = ""; personalDamaged = null;
  if (x == null) return;
  try { personal = normPersonal(x, personalEnv()); } catch (e) {
    personalDamaged = x;
    personalError = "The personal account in this browser cannot be read: " + (e.message || e);
  }
}

// The engine calls and the words of each network, for the rules in web/personal.js.
const personalEnv = () => ({
  keys: (seed, net) => Z.accountKeys(seed, net), normalize: normalized,
  nets: Object.fromEntries(Object.entries(NETWORKS)
    .map(([name, n]) => [name, { prefix: n.prefix, label: n.label.toLowerCase() }])),
});

// The saved account is the truth: another tab may have made it, changed it or removed it. This
// reads it again, at start and before each change: the sealed record with the lock on, else the
// device copy. A failed read of IndexedDB as a whole shows nothing. A record that is there but does
// not open blocks a new account. A store that lost the account never erases the memory copy. The
// sync follows the account that it reads.
export async function rereadPersonal() {
  if (vault) return rereadVault();
  if (typeof indexedDB === "undefined") return;
  try {
    const stored = await deviceRead();
    if (stored) {
      adoptPersonal(stored);
      followAccount();
    }
  } catch (e) {
    log("saved account not read: " + said(e));
    if (e.stored && !personal) {
      personalError = "Zigs could not read the saved personal account (" + said(e)
        + "). Reload the page. Do not make a new account yet.";
    }
  }
}

// With the lock on, a storage event of another tab can come late or not at all. So the account in
// the sealed record is read again.
// Only the account is taken: the secrets, keys and chats of this tab can hold a change that is not
// saved yet, and the storage event brings those.
async function rereadVault() {
  let value = null;
  try { value = localStorage.getItem("zf-vault"); } catch { return; }
  if (!value) return;
  try {
    const got = await openVault(vault.key, parseVault(value));
    if (!("personal" in got)) return;   // a page from before the accounts; see takeVault
    adoptPersonal(got.personal);
    followAccount();
  } catch (e) { log("sealed record not read: " + said(e)); }
}

// Before the lock turns on: the account moves into the sealed record. A record that is there but
// does not open stops the lock, because the account would be left out. A store that fails as a
// whole holds no account that this page ever saw.
export async function takeDeviceAccount() {
  if (typeof indexedDB === "undefined") return;
  let stored;
  try { stored = await deviceRead(); } catch (e) {
    if (!e.stored && !personal && !personalDamaged) {
      log("saved account not read: " + said(e));
      return;
    }
    throw new Error("This browser could not read the personal account, so it did not lock ("
      + said(e) + "). Try again.");
  }
  if (stored) adoptPersonal(stored);
}

let personalWrite = Promise.resolve(true);
export function persistPersonal(fresh = false) {
  if (lockedVault) return Promise.resolve(false);
  if (vault) return persist();
  try {
    // Another tab turned the lock on: a write here would put the seed beside the sealed record.
    if (localStorage.getItem("zf-vault")) {
      showBanner("bad", LOCKED_ELSEWHERE);
      return Promise.resolve(false);
    }
  } catch { /* no local storage: IndexedDB may still work */ }
  const save = () => (personal || personalDamaged ? deviceWrite(fresh) : deviceClear());
  personalWrite = personalWrite.then(save).then(() => true, (e) => {
    showBanner("bad", "Could not save the personal account (" + said(e) + ").");
    return false;
  });
  return personalWrite;
}

// Runs `fn` when no other step with this name runs, in this tab and, where the browser has Web
// Locks, in every other tab. Web Locks are not reentrant: a step must not wait for its own name.
// ponytail: without Web Locks, only the steps of this tab queue.
const turns = new Map();
function exclusive(name, fn) {
  if (globalThis.navigator?.locks) return navigator.locks.request("zigs-" + name, fn);
  const next = (turns.get(name) || Promise.resolve()).then(fn);
  turns.set(name, next.catch(() => {}));
  return next;
}

// Changes the account and saves it. The change is undone when the save fails. The step reads the
// saved account first and runs alone, so two changes never overwrite each other.
export function changePersonal(change) {
  return exclusive("account", async () => {
    await rereadPersonal();
    if (!personal) throw new Error("There is no personal account.");
    const before = structuredClone(personal);
    try { change(personal); } catch (e) { personal = before; throw e; }
    if (await persistPersonal()) return;
    personal = before;
    throw new Error("Could not save this change in the browser, so it was not made.");
  });
}

// ───────────────────────── Platform ─────────────────────────
export let db = null, sdb = null, user = null, downloads = null, me = null, canWrite = null, dbReady = false;
export function setDb(v) { sdb = v; db = v; }
export function setMe(v) { me = v; }
export function setDownloads(v) { downloads = v; }
// Light-wallet servers in order of preference. Mainnet uses a third-party server, so the group
// server and the chain server have different operators (see PRIVACY.md). The first testnet server
// is /lwd of this origin: the Worker relays it to our node (cf/src/index.js).
const NETWORKS = {
  testnet: { label: "Testnet",
    servers: [location.origin + "/lwd", "https://zcash-testnet.chainsafe.dev"],
    explorer: "https://testnet.zecblock.com/tx/", prefix: "utest1", faucet: "https://zcashfaucet.jinolabs.xyz/" },
  mainnet: { label: "Mainnet", servers: ["https://zcash-mainnet.chainsafe.dev"],
    explorer: "https://zecblock.com/tx/", prefix: "u1", cap: 50000000 },
};
const validNet = (x) => typeof x === "string" && Object.hasOwn(NETWORKS, x);
const netName = (g) => g && validNet(g.network) ? g.network : "testnet";
const netOf = (g) => NETWORKS[netName(g)];
const curNet = () => netOf(state.g);
const capText = (zat) => zat / 1e8 + " ZEC";
const netBadge = (g) => netOf(g).cap
  ? el("span", { class: "badge bad", title: "Real ZEC. Not audited. At " + capText(netOf(g).cap)
    + " the app warns and hides the address. It cannot block deposits." }, "Mainnet")
  : el("span", { class: "badge plain" }, "Testnet");
const SERVER_TIMEOUT_MS = 8000;
let chain = null;   // { gid, cw, prog, bal, received, ms, error, syncing } for the open group
export function setChain(v) { chain = v; }
export let acct = null;    // the same for the personal account, with account: true (see startAccount)
export function setAcct(v) { acct = v; }
// Last known balance per wallet, so the wallet list shows money before a wallet syncs.
// Balances are sealed with each wallet's key, so the browser's storage does not show amounts.
let balSealed = {};
try {
  balSealed = JSON.parse(localStorage.getItem("zf-bal") || "{}");
  // Entries from before sealing hold plain amounts; drop them now rather than at the next sync.
  for (const [gid, v] of Object.entries(balSealed)) if (typeof v !== "string") delete balSealed[gid];
  localStorage.setItem("zf-bal", JSON.stringify(balSealed));
} catch {}
export const balCache = {};
function balOf(gid) {
  if (!(gid in balCache) && Z && gkeys[gid] && typeof balSealed[gid] === "string") {
    try { balCache[gid] = J(Z.secretOpen(gkeys[gid], "bal\n" + gid, balSealed[gid])); } catch { balCache[gid] = null; }
  }
  return balCache[gid];
}
function saveBal(gid, bal) {
  balCache[gid] = { total: bal.spendable + bal.pending, at: Date.now() };
  try { balSealed[gid] = Z.secretSeal(gkeys[gid], "bal\n" + gid, S(balCache[gid])); localStorage.setItem("zf-bal", JSON.stringify(balSealed)); } catch {}
}
let unsubGroup = [], unsubSession = [];
const inspectCache = new Map();
// A message room is a namespace of its own. Its key never enters gkeys, so it is never a wallet.
// A chat is one too. Its secret is pending while this browser joins it, before it is saved.
export const roomKeys = {}, pendingChats = {};
const keyOf = (path) => {
  const id = path.split("/")[1];
  return gkeys[id] || roomKeys[id] || (chats.list[id] || {}).key || pendingChats[id];
};

function sealDoc(path, data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) if (v !== undefined) out[k] = Z.secretSeal(keyOf(path), path + "\n" + k, S(v));
  return out;
}
// Plain text of fields already opened, so a snapshot decrypts only what is new.
// ponytail: 5000 fields cover about 1000 messages (5 fields each). A bigger room clears the cache
// on every snapshot. Upgrade path: an LRU, or one cache per namespace.
const opened = new Map();
function openField(key, path, k, v) {
  const id = key + "\n" + path + "\n" + k + "\n" + v;
  let text = opened.get(id);
  if (text === undefined) {
    text = Z.secretOpen(key, path + "\n" + k, v);
    if (opened.size >= 5000) opened.clear();
    opened.set(id, text);
  }
  const value = J(text);
  if (!plainJson(value)) throw new Error("not plain JSON");
  return value;
}
// A stored value must survive JSON.stringify unchanged: -1e999 parses to -Infinity, which a
// signature over null would cover, and very deep nesting makes JSON.stringify throw.
function plainJson(v, depth = 0) {
  if (typeof v === "number") return Number.isFinite(v);
  if (v === null || typeof v !== "object") return true;
  return depth < 32 && Object.values(v).every((x) => plainJson(x, depth + 1));
}
export function openDoc(path, raw) {
  const key = keyOf(path);
  if (!Z || !key || raw == null) return null;
  const out = {}; let ok = 0;
  for (const [k, v] of Object.entries(raw)) {
    try { out[k] = openField(key, path, k, v); ok++; }
    catch (e) { log("dropped undecryptable field " + k + " of " + path); }
  }
  return ok || !Object.keys(raw).length ? out : null;
}
function openSnap(path, snap) {
  const data = snap.exists ? openDoc(path, snap.data()) : null;
  return { id: snap.id, exists: data != null, data: () => data, metadata: snap.metadata };
}
function wrapDoc(ref) {
  return {
    id: ref.id, path: ref.path,
    get: async () => openSnap(ref.path, await ref.get()),
    set: (d) => ref.set(sealDoc(ref.path, d)),
    update: (d) => ref.update(sealDoc(ref.path, d)),
    acquire: (o) => ref.acquire(o),
    onSnapshot: (next, err) => ref.onSnapshot((s) => next(openSnap(ref.path, s)), err),
  };
}
function wrapStore(raw) {
  return {
    doc: (path) => wrapDoc(raw.doc(path)),
    collection: (path) => ({
      doc: (id) => wrapDoc(raw.collection(path).doc(id)),
      onSnapshot: (next, err) => raw.collection(path).onSnapshot((snap) => {
        const docs = snap.docs.map((d) => openSnap(path + "/" + d.id, d)).filter((d) => d.exists);
        next({ docs, size: docs.length, empty: docs.length === 0 });
      }, err),
    }),
  };
}

export async function boot() {
  startAccount();   // the account needs no group server
  const [dbNs, userNs, dlNs] = await Promise.all([zigs.use("db"), zigs.use("user"), zigs.use("downloads")]);
  db = dbNs; user = userNs; downloads = dlNs;
  if (db) sdb = wrapStore(db);
  if (user) { me = await user.id(); canWrite = await user.can("data.write"); }
  if (!db) {
    showBanner("bad", "The group server is not available. Reload the page, or try again later.");
    return;
  }
  if (!me) showBanner("bad", "This browser cannot tell who you are, so you cannot take a seat.");
  if (canWrite === false) showBanner("bad", "This page is read-only here. You cannot take part.");
  if (!storageOk) showBanner("bad", "This browser does not let the page save your key share. Keep this tab open, and use Back up.");
  // The server keeps each wallet apart, so this browser opens the wallets it has keys for.
  for (const id of [...Object.keys(gkeys), ...Object.keys(chats.list)]) db.join?.(id);
  sdb.collection("groups").onSnapshot((snap) => {
    dbReady = true;
    state.groups = snap.docs.filter((d) => gkeys[d.id]).map((d) => cleanGroup(d.id, d.data()))
      .sort((a, b) => finite(b.createdAt) - finite(a.createdAt));
    watchInbox();
    syncRooms();
    if (state.gid && !state.g) openGroup(state.gid);
    refilter();
  }, (e) => showBanner("bad", "Lost connection to the group server (" + e.code + "). Reload."));
  followHash();
  render();
}

// A wallet document comes from another signer. Check the fields the page counts on, so one bad
// document shows as an unreadable item and never breaks the page.
const validWallet = (g) => validShape(g.n, g.t);
// Every wallet keeps the first network that this device saw. A version 3 wallet also keeps the
// first n and t. The group document has no signature, so a holder of the invite link could write
// other values (PROTOCOL.md section 15).
export function cleanGroup(id, d) {
  pinVersion(id, d);
  const g = {
    ...d, id, name: typeof d.name === "string" ? d.name : "Wallet", unreadable: !validWallet(d),
    ...pinNetwork(id, d),
  };
  if (!signedMode(id)) return g;
  const shape = trustShape(signPins, id, g);
  if (shape.fresh) saveMerged("zf-signpins", signPins, oldest);
  return shape.g;
}

function watchInbox() {
  for (const g of state.groups) {
    if (!readySubs.has(g.id)) {
      readySubs.set(g.id, sdb.doc("groups/" + g.id + "/meta/wallet").onSnapshot((d) => {
        rawReady[g.id] = d.exists ? d.data() : false;
        refilter();
      }));
    }
    if (inboxSubs.has(g.id) || !mySeatSecrets(g.id).length) continue;
    inboxSubs.set(g.id, sdb.collection("groups/" + g.id + "/sessions").onSnapshot((snap) => {
      rawInbox[g.id] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      refilter();
    }));
  }
}

// A seat records its nonces locally when it approves, so no server read is needed.
export function needsMyApproval(gid, ss) {
  if (ss.status !== "collecting" || ss.package || ss.error) return false;
  if (gid === state.gid && expired(ss)) return false;
  // In the open wallet only owned seats count; a restored seat that does not fit cannot approve.
  const owned = gid === state.gid ? localSeats() : null;
  return mySeatSecrets(gid).some(([i, s]) => (!owned || owned.includes(i))
    && s.keyPackage && !(s.nonces && s.nonces[ss.id]));
}
const toApprove = (gid) => (gid === state.gid ? state.sessions : inbox[gid] || []).filter((ss) => needsMyApproval(gid, ss));

function sub(path, fn) {
  return sdb.collection(path).onSnapshot((snap) => {
    const m = {}; for (const d of snap.docs) m[d.id] = d.data();
    fn(m); refilter();
  }, (e) => log("subscription error on " + path + ": " + e.code));
}

export function openGroup(gid) {
  for (const u of unsubGroup) u(); unsubGroup = [];
  sol?.close();
  closeSession();
  // A form filled from a request belongs to the wallet it was made for.
  if (ui.sendFor && ui.sendFor !== gid) { ui.send = false; ui.pay = null; ui.note = ""; }
  ui.backup = null;   // the dialog names a seat of the wallet that was open
  dropChain();
  Object.assign(state, {
    gid, cid: null, contact: null, g: null, seats: {}, seatsLoaded: false, seatsSettled: false,
    dkg1: {}, dkg2: {},
    confirm: {}, abort: {}, done: {}, verify: {}, wallet: null, sessions: [], ignored: 0,
    pending: false, log: [],
  });
  Object.assign(raw, emptyRaw());
  resetSolStart();
  loggedIgnored.delete(gid);
  if (!gid) { setHash("#"); render(); return; }
  setHash("#" + gid);
  const base = "groups/" + gid;
  let solWatched = false;
  const watchSol = () => {
    if (solWatched || !solOn(gid)) return;
    solWatched = true;
    solAttach(gid, base);
  };
  unsubGroup.push(sdb.doc(base).onSnapshot((d) => {
    state.g = d.exists ? cleanGroup(d.id, d.data()) : null;
    watchSol();
    refilter();
  }));
  unsubGroup.push(sub(base + "/seats", (m) => { raw.seats = m; state.seatsLoaded = true; }));
  for (const name of ["dkg1", "dkg2", "confirm", "abort", "done", "verify", "sessions"]) {
    unsubGroup.push(sub(base + "/" + name, (m) => { raw[name] = m; }));
  }
  unsubGroup.push(sdb.doc(base + "/meta/wallet").onSnapshot((d) => {
    raw.wallet = d.exists ? d.data() : null;
    refilter();
  }));
  watchSol();
  render();
}

function openSession(sid) {
  closeSession();
  state.sid = sid;
  const base = "groups/" + state.gid + "/sessions/" + sid;
  unsubSession.push(sub(base + "/commits", (m) => { raw.commits = m; }));
  unsubSession.push(sub(base + "/shares", (m) => { raw.shares = m; }));
  render();
}
function closeSession() {
  for (const u of unsubSession) u();
  unsubSession = []; state.sid = null;
  state.commits = {}; state.shares = {}; raw.commits = {}; raw.shares = {};
}

// ───────────────────────── Reactor ─────────────────────────
// Each browser advances the steps it can do for its own seats. Steps that
// need a human decision (approving a spend) wait for a click.
const RETRY_MS = 3000;
async function once(key, fn) {
  if (busy.has(key)) return; busy.add(key);
  let wait = 0;
  try { await fn(); } catch (e) {
    wait = RETRY_MS;
    const text = e && e.message ? e.message : String(e);
    log("✗ " + key + ": " + text); showBanner("bad", text);
  }
  finally { busy.delete(key); render(); setTimeout(react, wait); }
}

export function react() {
  try {
    settleRestore();
    syncRooms();
    reactNow();
  } catch (e) { log("✗ react: " + (e && e.message ? e.message : e)); }
}

const canReact = () => !!(Z && db && state.g && !state.g.unreadable && groupVersion());
const chainReady = () => state.wallet && state.wallet.birthday && myVerified() && !keysDiffer();

function reactNow() {
  if (!canReact() || signedHold()) return;
  reactStops();
  reactConfirm();
  for (const i of localSeats()) reactSeat(i);
  if (chainReady()) ensureChain();
  // Group creator builds the shared wallet once all group keys agree.
  if (canCreateWallet()) once("wallet", createWallet);
  // Signing.
  const ss = curSession();
  if (ss && state.wallet) reactSession(ss);
  solReact();
}

// ── Solana beta (web/sol, ZOLANA.md) ──
// Devnet, for version 3 wallets on testnet only. The network is the first one that this device
// saw (pinNetwork). web/sol loads when the Solana tab opens, or when a seat signed the wallet's
// solstart document. Any other wallet, and a wallet that is not loaded yet, never fetches any of
// it.
const solGroup = (gid) =>
  (gid === state.gid && state.g) || state.groups.find((x) => x.id === gid);
export const solOn = (gid = state.gid) => {
  const g = solGroup(gid);
  return g?.network === "testnet" && walletVersion(g) === 3 && signedMode(gid);
};
const SOL_BACKUP_KIND = "zigs-sol-backup";
const SOL_OFF = "Solana is not available on this server";
export let sol = null, solLoading = null, solError = "";
let solStartDoc = null;   // the stored solstart/1 of the open wallet, whoever wrote it
function resetSolStart() { solStartDoc = null; }
const solHost = () => ({
  Z, sdb, state, el, act, log, once, render, refilter, showBanner, sec, putSec, signedDoc,
  canWriteAs, localSeats, seatIds, checkIn, safetyNo, seatCheck, openGroup, restore,
  groupVersion, sealAndSave, network: () => netName(state.g),
  askBackup: (words) => { ui.backup = { words, made: false, busy: false }; render(); },
});
// A server with SOL off does not serve the module, and the text says so.
const solModule = () => import("./sol/main.js").catch(() => { throw new Error(SOL_OFF); });
// A failed load is final until the page reloads: a retry on every redraw would loop.
export function solLoad() {
  solLoading ||= solModule().then((m) => m.attach(solHost())).then((m) => {
    sol = m;
    if (solOn()) sol.open(state.gid, "groups/" + state.gid);
    render(); react();
  }, (e) => {
    solError = said(e);
    showBanner("bad", "Solana did not load: " + solError);
    render();
  });
  return solLoading;
}
// Before the module loads, one watch keeps the start document. Any holder of the invite link can
// write one, so solReact loads the module only when a seat signed it.
function solAttach(gid, base) {
  if (sol) { sol.open(gid, base); return; }
  unsubGroup.push(sdb.collection(base + "/solstart").onSnapshot((snap) => {
    solStartDoc = snap.docs.find((d) => d.id === "1")?.data() ?? null;
    refilter();
  }));
}
const solStartSigned = () => !!solStartDoc && checkIn(state.gid)("solstart/1", solStartDoc.by,
  solStartDoc.sig, docFields(solStartDoc), 1) === "yes";
function solReact() {
  if (!solOn()) return;
  if (sol) sol.react();
  else if (!solLoading && solStartSigned()) solLoad();
}
export const solTab = () => sol ? guard(sol.view)
  : solError ? el("p", { class: "small" }, solError)
  : (solLoad(), el("p", { class: "small" }, "Loading Solana…"));
async function solRestore(b, encrypted) {
  if (solGroup(b.group) && !solOn(b.group)) {
    throw new Error("Solana runs on version 3 testnet wallets only.");
  }
  await solLoad();
  if (!sol) throw new Error(solError || "Solana did not load.");
  return sol.restore(b, encrypted);
}

// ── Key ceremony ──
// Version 1 wallets: the creator picks nk and rivk. Version 2 wallets (ZIP 2005): the signers
// agree on a secret sk together, and nk, qsk and rivk follow from it (PROTOCOL.md section 4).
export const groupVersion = () => walletVersion(state.g);
// A seat keeps the version that its wallet had when it took the seat ("version"), so a change of
// the wallet document later cannot move the seat to another ceremony. A seat from before that
// follows its own progress; before it began, the wallet's version decides.
function seatMode(s) {
  if (s.version) return s.version;
  if (s.skPart || s.vaultSk) return 2;
  return s.r1secret || s.r2secret || s.keyPackage ? 1 : groupVersion();
}
const launch = (key, fn) => { once(key, fn); return true; };

function reactSeat(i) {
  const gid = state.gid, s = sec(gid, i);
  // Seats taken before secrets kept their identity: record it while this browser still knows it.
  if (!s.uid) putSec(gid, i, { uid: state.seats[i].uid });
  ensureSignKey(gid, i);
  // A seat that cannot sign writes nothing in a version 3 wallet (signedNotes tells the person).
  if (!canWriteAs(i)) return;
  if (s.aborted || (!s.keyPackage && remoteAborts().length)) return;
  const started = usesV2(seatMode(s)) ? stepV2(i, s) : stepV1(i, s);
  if (!started) verifyStep(i, s);
}

// The store can show another wallet version, another seat key, or data of the other ceremony
// than the one a seat took. Each ends the setup of that seat for good (conflictReason).
const sawV2Data = () => Object.keys(state.confirm).length > 0
  || Object.values(state.dkg1).some((d) => d.commit !== undefined);
const conflictOf = (i, s, number) => conflictReason(s, state.seats[i], groupVersion(), seatMode(s),
  { sawV2: sawV2Data(), number });

// Runs over every seat that this browser holds a secret for, also a seat that the store now
// shows under another identity. A stopped seat tells the other seats until the store holds its
// abort document with a reason.
function reactStops() {
  const number = safetyNo();
  for (const [i, s] of mySeatSecrets(state.gid)) {
    const reason = s.aborted ? null : conflictOf(i, s, number);
    if (reason) putSec(state.gid, i, { aborted: abortText(reason) });
    const text = sec(state.gid, i).aborted;
    if (mustAbort(i, text)) launch("abort:" + i, () => publishAbort(i, text));
  }
}
// A stopped seat tells the others, if it may write as that seat. In version 3 that needs the
// signing key that readers pinned, so a replaced seat document cannot stop the abort.
const mustAbort = (i, text) => text && canWriteAs(i) && !abortSent(i);
// A published abort document is one that exists and holds a reason.
const abortSent = (i) => !!state.abort[i] && isStr(state.abort[i].reason);
// A seat that stopped its setup also stops the seats that hold no key share yet.
const remoteAborts = () => seatIds().filter(abortSent);
async function publishAbort(i, text) {
  const gid = state.gid;
  await sdb.doc("groups/" + gid + "/abort/" + i)
    .set(await signedDoc(gid, "abort/" + i, i, { reason: text }));
}

const needR1 = (i, s) => !state.dkg1[i] && !s.keyPackage;
// Round 2 needs every seat taken (for their encryption keys) and every round-1 package.
const needR2 = (s) => s.r1secret && !s.r2secret && !s.keyPackage && allSeated() && allR1();
// Round 3 (local): decrypt the shares sent to me, compute my key share.
const needR3 = (i, s) => s.r2secret && !s.keyPackage && allR1() && r2For(i);
// The done document is the only proof to the other seats that this seat holds its key share. A
// failed write is retried until it succeeds.
const needDone = (i, s) => s.keyPackage && !s.doneSent && !state.done[i];

function stepV1(i, s) {
  if (needR1(i, s)) return launch("r1:" + i, () => round1V1(i));
  if (needR2(s)) return launch("r2:" + i, () => round2V1(i));
  if (needR3(i, s)) return launch("r3:" + i, () => round3V1(i));
  if (needDone(i, s)) return launch("done:" + i, () => publishDone(i));
  return false;
}

async function publishDone(i) {
  const gid = state.gid, s = sec(gid, i);
  const fields = { groupKey: s.groupKey, publicKeyPackage: S(s.publicKeyPackage), at: Date.now() };
  await sdb.doc("groups/" + gid + "/done/" + i).set(await signedDoc(gid, "done/" + i, i, fields));
  await putSec(gid, i, { doneSent: true });
  log("seat " + i + ": key share ready, wallet key " + s.groupKey.slice(0, 12) + "…");
}

async function round1V1(i) {
  const g = state.g, gid = state.gid, s = sec(gid, i);
  let secret = s.r1secret, pkg = s.r1package;
  if (!secret) { const r = J(Z.dkgPart1(i, g.n, g.t)); secret = r.secret; pkg = r.package; putSec(gid, i, { r1secret: secret, r1package: pkg }); }
  await sdb.doc("groups/" + gid + "/dkg1/" + i).set({ package: pkg, at: Date.now() });
  log("seat " + i + ": round 1 commitment published");
}

async function round2V1(i) {
  const gid = state.gid, s = sec(gid, i);
  const r1 = {}; for (const j of seatIds()) if (j !== i) r1[j] = state.dkg1[j].package;
  const r = J(Z.dkgPart2(S(s.r1secret), S(r1)));
  for (const [to, pkg] of Object.entries(r.outgoing)) {
    const sealed = Z.boxSeal(s.boxSk, state.seats[to].boxPk, gid + ":" + i + "->" + to, S(pkg));
    await sdb.doc("groups/" + gid + "/dkg2/" + i + "-" + to).set({ sealed, at: Date.now() });
  }
  putSec(gid, i, { r2secret: r.secret, r1secret: null });
  log("seat " + i + ": " + Object.keys(r.outgoing).length + " encrypted shares sent");
}

// Opens the box that seat j sent to seat i. A box that does not open comes from another version
// of Zigs: a version before 16 October 2026 made its box key with another label.
function openBox(j, i, s, sealed) {
  const context = state.gid + ":" + j + "->" + i;
  let text;
  try { text = Z.boxOpen(s.boxSk, state.seats[j].boxPk, context, sealed); }
  catch { throw new Error("The message of seat " + j + " was made by another version of Zigs"); }
  try { return J(text); } catch { throw new Error("Seat " + j + " sent an unreadable message"); }
}

export async function round3V1(i) {
  const gid = state.gid, s = sec(gid, i);
  const r1 = {}, r2 = {};
  for (const j of seatIds()) if (j !== i) {
    r1[j] = state.dkg1[j].package;
    const sealed = state.dkg2[j + "-" + i].sealed;
    if (!isStr(sealed)) throw new Error("Seat " + j + " sent an unreadable message.");
    // A box that does not open ends this seat's setup, as in version 2: a retry cannot fix it.
    r2[j] = await ceremonyStep(i, () => openBox(j, i, s, sealed));
  }
  const r = J(Z.dkgPart3(S(s.r2secret), S(r1), S(r2)));
  putSec(gid, i, { keyPackage: r.key_package, publicKeyPackage: r.public_key_package, groupKey: r.group_key, r2secret: null, r1package: null });
}

// Verify the published wallet against my own DKG output.
// The store's verify documents are claims anyone with the wallet key can write, so each seat
// keeps its own result, tied to the exact wallet document, and checks again when it changes.
function verifyStep(i, s) {
  const wk = walletKey();
  if (!s.keyPackage || !state.wallet || s.checkedWallet === wk || s.rejectedWallet === wk) return;
  once("verify:" + i, async () => {
    const gid = state.gid, { ok, error } = verifyOutcome(s);
    // Sign first: this browser keeps its result only for a seat that can tell the others.
    const doc = await signedDoc(gid, "verify/" + i, i, { ok, error, at: Date.now() });
    await putSec(gid, i, ok ? { checkedWallet: wk, rejectedWallet: null } : { rejectedWallet: wk });
    await sdb.doc("groups/" + gid + "/verify/" + i).set(doc);
    log("seat " + i + (ok ? ": wallet verified, ak equals my wallet key" : ": WALLET REJECTED: " + error));
  });
}

function verifyOutcome(s) {
  try { verifyWallet(s); return { ok: true, error: null }; }
  catch (e) { return { ok: false, error: e.message || String(e) }; }
}

// The wallet must name its group's network. A seat that holds sk checks every part of the wallet,
// so only version 2 verification applies to it, whatever the stored documents say. A seat without
// sk never accepts a version 2 or 3 wallet.
function verifyWallet(s) {
  checkNetwork(state.wallet, netName(state.g));
  if (s.vaultSk) return Z.walletVerifyV2(S(state.wallet), S(s.publicKeyPackage), s.vaultSk);
  if (usesV2(groupVersion())) {
    throw new Error("This seat holds no setup secret for a version 2 or 3 wallet. "
      + "Do not use this wallet.");
  }
  return Z.walletVerify(S(state.wallet), S(s.publicKeyPackage));
}

const v2Secret = () => localSeats().map((i) => sec(state.gid, i))
  .find((s) => s.vaultSk && s.publicKeyPackage);
const canCreateWallet = () => isCreator() && !state.wallet && keysAgree()
  && (!usesV2(groupVersion()) || !!v2Secret())
  && canWriteAs(1);

async function walletStands(gid) {
  const cur = await sdb.doc("groups/" + gid + "/meta/wallet").get();
  if (!cur.exists) return false;
  if (!signedMode(gid)) return true;
  const d = cur.data();
  const part = { rel: "meta/wallet", by: d.by, sig: d.sig, fields: docFields(d), need: 1 };
  return (await partNow(gid, part)) !== "no";
}

async function createWallet() {
  const g = state.g, gid = state.gid, base = "groups/" + gid;
  // The wallet snapshot can arrive after the DKG ones; never replace a published wallet. In a
  // version 3 wallet, a stored document that is not signed by seat 1 is no wallet.
  if (await walletStands(gid)) return;
  const birthday = await Z.latestHeight(await pickServer(netOf(g)));
  if (state.gid !== gid) return;   // the person opened another wallet while the server answered
  const net = g.network || "testnet", mine = usesV2(groupVersion()) ? v2Secret() : null;
  const w = J(mine ? Z.walletCreateV2(S(mine.publicKeyPackage), net, mine.vaultSk)
    : Z.walletCreate(state.done[1].publicKeyPackage, net));
  const doc = await signedDoc(gid, "meta/wallet", 1, { ...w, birthday, at: Date.now() });
  await sdb.doc(base + "/meta/wallet").set(doc);
  log("wallet created: " + w.address.slice(0, 24) + "…");
}

// ── Key ceremony, versions 2 and 3 ──
// The safety number covers the wallet id, t, n, the network and every seat's encryption key. The
// signers compare it out of band. A confirm document is only a claim, so a seat also keeps the
// number its person confirmed ("confirmed"), and the ceremony runs only when both agree with the
// local number.
export function safetyNo() {
  if (!state.g || !allSeated()) return null;
  const keys = {}; for (const i of seatIds()) keys[i] = state.seats[i].boxPk;
  try { return Z.safetyNumber(state.gid, state.g.t, state.g.n, netName(state.g), S(keys)); }
  catch { return null; }
}
const gateOf = (s) => confirmGate(safetyNo(), s.confirmed, state.confirm, seatIds());
const canConfirm = (s) => !s.keyPackage && !s.aborted && usesV2(seatMode(s));
const confirmSeatsOf = () => localSeats()
  .filter((i) => canWriteAs(i) && canConfirm(sec(state.gid, i)));
// A browser that holds every seat has nobody else to compare with.
const holdsAllSeats = () => localSeats().length === state.g.n;
const confirmedBy = (no) => seatIds().filter((i) => state.confirm[i] && state.confirm[i].number === no);

// The reason a seat of this browser ended its setup, or null. This counts every seat that the
// browser holds a secret for, also a seat that the store shows under another identity.
const abortedText = () => mySeatSecrets(state.gid).map(([, s]) => s.aborted).find(Boolean) || null;

// Writes the confirm document of a seat whose person confirmed but whose document is missing, and
// confirms for itself when this browser holds every seat.
function reactConfirm() {
  const no = usesV2(groupVersion()) ? safetyNo() : null;
  if (!no) return;
  const auto = holdsAllSeats();
  const todo = confirmSeatsOf().filter((i) => {
    const same = sec(state.gid, i).confirmed === no;
    return same ? !state.confirm[i] : auto;
  });
  if (todo.length) once("confirm", () => confirmSeats(todo, no));
}

async function confirmSeats(ids, no) {
  const gid = state.gid;
  for (const i of ids) {
    // Sign first: a seat that cannot sign must not keep a number that nobody saw.
    const doc = await signedDoc(gid, "confirm/" + i, i, { number: no });
    await putSec(gid, i, { confirmed: no });
    await sdb.doc("groups/" + gid + "/confirm/" + i).set(doc);
  }
  log("safety number confirmed for seat " + ids.join(", "));
}

const DIFFERENT = "Signers saw different setup data";
// A failed check ends this seat's setup for good. The reason stays in the seat, so the reactor
// does not retry it.
async function abortSeat(i, text) {
  await putSec(state.gid, i, { aborted: text });
  setTimeout(react, 0);
  throw new Error(text);
}
async function ceremonyStep(i, compute) {
  try { return compute(); } catch (e) { return abortSeat(i, abortText(e && e.message ? e.message : e)); }
}

// Seats whose setup secret this browser could not save. Another try waits for the person.
const saveFailed = new Set();
const needR1V2 = (i, s) => needR1(i, s) && !saveFailed.has(skey(state.gid, i));

function stepV2(i, s) {
  const open = gateOf(s) === "ok";
  if (open && needR1V2(i, s)) return launch("r1:" + i, () => round1V2(i));
  if (open && needR2(s)) return launch("r2:" + i, () => round2V2(i));
  if (needR3(i, s)) return launch("r3:" + i, () => round3V2(i));
  if (needDone(i, s)) return launch("done:" + i, () => publishDone(i));
  return false;
}

const SAVE_FAILED = "This browser could not save your setup secret, so setup did not start.";

// The secret part of sk is saved before its commitment goes out: a seat that loses it cannot finish.
async function round1V2(i) {
  const g = state.g, gid = state.gid;
  if (!sec(gid, i).r1secret) {
    const r = J(Z.dkgPart1(i, g.n, g.t));
    const made = { r1secret: r.secret, r1package: r.package, skPart: randomHex32() };
    if (!(await putSec(gid, i, made))) {
      putSec(gid, i, { r1secret: null, r1package: null, skPart: null });
      saveFailed.add(skey(gid, i));
      throw new Error(SAVE_FAILED);
    }
  }
  const s = sec(gid, i);
  const commit = Z.skCommit(gid, i, state.seats[i].boxPk, s.skPart);
  const fields = { package: s.r1package, commit, at: Date.now() };
  await sdb.doc("groups/" + gid + "/dkg1/" + i).set(await signedDoc(gid, "dkg1/" + i, i, fields));
  log("seat " + i + ": round 1 commitment published");
}

// The echo is one digest of every seat's round-1 document. Each seat puts it in its round-2
// documents, so a seat that saw other data than the rest is found before anyone uses its data.
function echoNow() {
  const r1 = {};
  for (const j of seatIds()) {
    const d = state.dkg1[j];
    if (!isStr(d.commit)) throw new Error("Seat " + j + " sent no commitment, so its app is too old for this wallet");
    r1[j] = { package: d.package, commit: d.commit };
  }
  return Z.dkgEcho(state.gid, S(r1));
}

async function round2V2(i) {
  const gid = state.gid, s = sec(gid, i);
  const { echo, boxes, secret } = await ceremonyStep(i, () => {
    const echo = s.echo || echoNow();
    const r1 = {}; for (const j of seatIds()) if (j !== i) r1[j] = state.dkg1[j].package;
    const r = J(Z.dkgPart2(S(s.r1secret), S(r1)));
    const boxes = {};
    for (const [to, pkg] of Object.entries(r.outgoing)) {
      boxes[to] = Z.boxSeal(s.boxSk, state.seats[to].boxPk, gid + ":" + i + "->" + to, S({ package: pkg, r: s.skPart }));
    }
    return { echo, boxes, secret: r.secret };
  });
  await putSec(gid, i, { echo });
  // Sign every document first, then write them, and only then drop the round-1 secret.
  const docs = [];
  for (const [to, sealed] of Object.entries(boxes)) {
    const rel = "dkg2/" + i + "-" + to;
    docs.push([rel, await signedDoc(gid, rel, i, { sealed, echo, at: Date.now() })]);
  }
  for (const [rel, doc] of docs) await sdb.doc("groups/" + gid + "/" + rel).set(doc);
  await putSec(gid, i, { r2secret: secret, r1secret: null });
  log("seat " + i + ": " + Object.keys(boxes).length + " encrypted shares sent");
}

// Opens the box seat j sent to seat i: its round-2 package and its secret part of sk.
export function unboxFrom(j, i, s) {
  const d = state.dkg2[j + "-" + i];
  if (d.echo !== s.echo) throw new Error(DIFFERENT);
  const bad = new Error("Seat " + j + " sent an unreadable message");
  if (!isStr(d.sealed)) throw bad;
  const box = openBox(j, i, s, d.sealed);
  if (!box || !isStr(box.r) || !box.package || typeof box.package !== "object") throw bad;
  return box;
}

// Every check of round 3 runs before the key share is made: the echo twice (my stored echo, and
// each seat's), every commitment, and then the key share itself.
function openRound3(i, s) {
  const r1 = {}, r2 = {};
  const parts = { [i]: { r: s.skPart, commit: state.dkg1[i].commit, boxPk: state.seats[i].boxPk } };
  if (!s.echo || echoNow() !== s.echo) throw new Error(DIFFERENT);
  for (const j of seatIds()) {
    if (j === i) continue;
    const box = unboxFrom(j, i, s);
    r1[j] = state.dkg1[j].package;
    r2[j] = box.package;
    parts[j] = { r: box.r, commit: state.dkg1[j].commit, boxPk: state.seats[j].boxPk };
  }
  const sk = Z.vaultSk(state.gid, s.echo, S(parts));
  return { ...J(Z.dkgPart3(S(s.r2secret), S(r1), S(r2))), sk };
}

async function round3V2(i) {
  const gid = state.gid, s = sec(gid, i);
  const r = await ceremonyStep(i, () => openRound3(i, s));
  const saved = await putSec(gid, i, {
    keyPackage: r.key_package, publicKeyPackage: r.public_key_package, groupKey: r.group_key,
    vaultSk: r.sk, skPart: null, echo: null, r2secret: null, r1package: null,
  });
  if (!saved) showBanner("bad", "This browser could not save your key share. Keep this tab open, and use Back up.");
}

export function reactSession(ss) {
  const fvk = state.wallet.orchard_fvk;
  // The engine takes only strings. A document with another type would crash it.
  if (!isStr(ss.pczt) || !isStr(fvk) || (ss.package != null && !isStr(ss.package))) return;
  if (ss.error || expired(ss)) return;
  if (!ss.package && isProposer(ss)) buildPackage(ss, fvk);
  if (ss.package) signMyShares(ss, fvk);
  if (ss.package && !ss.signed) aggregateShares(ss);
}

const sessionPath = (ss, gid = state.gid) => "groups/" + gid + "/sessions/" + ss.id;
// In a version 3 wallet the proposer is the seat in `by`. Before, it is the identity in
// `createdBy`.
const isProposer = (ss) => Number.isInteger(ss.by)
  ? localSeats().includes(ss.by) && canWriteAs(ss.by) : isMe(ss.createdBy);

// Does the stored session document hold a package that may be used? In a version 3 wallet an
// unsigned package must not block the real one.
async function packageStands(gid, sid, d) {
  if (!d.package) return false;
  if (!signedMode(gid)) return true;
  const part = {
    rel: "sessions/" + sid, by: d.packageBy, sig: d.packageSig, fields: partFields("package", d),
    need: null,
  };
  return (await partNow(gid, part)) !== "no";
}

// Coordinator: once t approvals are in, build the signing package.
function buildPackage(ss, fvk) {
  const gid = state.gid, t = state.g.t;
  const ids = Object.keys(state.commits).map(Number).sort((a, b) => a - b).slice(0, t);
  if (ids.length < t) return;
  once("pkg:" + ss.id, async () => {
    const c = {}; for (const i of ids) c[i] = state.commits[i].commitments;
    const pkg = Z.signPackage(ss.pczt, fvk, S(c), t);
    // Two browsers can hold the same seat (a restored copy): only one writes the package.
    const ref = sdb.doc(sessionPath(ss, gid));
    if (!(await ref.acquire({ holder: crypto.randomUUID(), ttlMs: 10000 })).acquired) return;
    const cur = await ref.get();
    if (cur.exists && (await packageStands(gid, ss.id, cur.data()))) return;
    const fields = { package: pkg, signers: ids };
    const sig = await sigPart(gid, ss.id, "package", fields, ss.by);
    await ref.update({ ...fields, status: "signing", ...sig });
    log("signing package sent to signers " + ids.join(", "));
  });
}

// Signer: once the package names a seat of this browser, re-verify everything and sign.
function signMyShares(ss, fvk) {
  for (const i of localSeats()) {
    const n = (sec(state.gid, i).nonces || {})[ss.id];
    if (canWriteAs(i) && signersOf(ss).includes(i) && n && !state.shares[i]) {
      once("share:" + ss.id + ":" + i, () => signShare(ss, fvk, i, n));
    }
  }
}

async function signShare(ss, fvk, i, n) {
  const gid = state.gid, s = sec(gid, i);
  const nonces = { ...(s.nonces || {}) }; delete nonces[ss.id];
  const ins = inspectOf(ss);
  if (!n.sighash || !ins || ins.error || ins.sighash !== n.sighash) {
    await putSec(gid, i, { nonces });
    await failSession(gid, ss, "The payment changed after a signer approved it.");
    throw new Error("This payment changed after you approved it, so this browser did not sign it.");
  }
  // The engine checks the approved sighash again before it signs.
  const shares = Z.signShare(ss.pczt, fvk, ss.package, S(n), S(s.keyPackage), i);
  const rel = "sessions/" + ss.id + "/shares/" + i;
  const doc = await signedDoc(gid, rel, i, { shares, at: Date.now() });
  // Save the burn before the share goes out: a nonce that comes back could sign twice.
  if (!(await putSec(gid, i, { nonces }))) {
    throw new Error("Could not save the used nonce, so the signature share was not sent.");
  }
  await sdb.doc("groups/" + gid + "/" + rel).set(doc);
  log("seat " + i + ": signature share sent");
}

// Any participant: aggregate. The result is deterministic, so a race is harmless.
function aggregateShares(ss) {
  const gid = state.gid;
  if (!localSeats().length || !mayAct() || !signersOf(ss).every((i) => state.shares[i])) return;
  once("agg:" + ss.id, async () => {
    const sh = {}; for (const i of signersOf(ss)) sh[i] = J(state.shares[i].shares);
    const ref = sdb.doc(sessionPath(ss, gid));
    let r;
    try { r = J(Z.signAggregate(ss.pczt, state.done[1].publicKeyPackage, ss.package, S(sh))); }
    catch (e) { await failSession(gid, ss, e.message || String(e)); throw e; }
    // A seat signs the result. A seat that cannot sign is no failure of the payment.
    const result = { signed: r.signed_pczt, signatures: r.signatures };
    const sig = await sigPart(gid, ss.id, "signed", result);
    await ref.update({ ...result, status: "signed", ...sig });
    log("signatures aggregated and verified under rk");
  });
}

// ───────────────────────── Actions ─────────────────────────
// `from` is the wallet this one replaces. The old wallet gets only the new id, never its key:
// signers left out of the new wallet must not get its viewing key.
export async function createGroup(name, n, t, from = null, network = "testnet") {
  // Signed writes need a signing key for every seat, so check before anything is made.
  if (!(await canSign())) throw new Error(NO_SIGNING_SEAT);
  const ref = sdb.collection("groups").doc();
  const key = new Uint8Array(32); crypto.getRandomValues(key);
  putKey(ref.id, btoa(String.fromCharCode(...key)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
  await ref.set({
    name, n, t, network, version: 3, createdBy: me, createdAt: Date.now(),
    movedFrom: from || undefined,
  });
  if (from) await sdb.doc("groups/" + from).update({ movedTo: ref.id, movedAt: Date.now() });
  openGroup(ref.id);
  await takeSeat(1, 3);
}

// The signing key of a new seat, or null where Ed25519 is missing (a seat then has no messages).
// A version 3 seat needs one.
async function newSeatKey(version) {
  const sign = await newSignKey().catch(() => null);
  if (!sign && version === 3) throw new Error(NO_SIGNING_SEAT);
  return sign;
}

// The seat keeps the version of its wallet and its own box key. The store can show another
// version or key later (reactStops).
export async function takeSeat(i, version = groupVersion()) {
  if (!Z || !version) return;
  const gid = state.gid, sign = await newSeatKey(version);
  const ref = sdb.doc("groups/" + gid + "/seats/" + i);
  const lease = await ref.acquire({ holder: crypto.randomUUID(), ttlMs: 5000 });
  if (!lease.acquired) { showBanner("bad", "Someone else is taking seat " + i + " right now."); return; }
  const cur = await ref.get();
  if (cur.exists && cur.data().uid) { showBanner("bad", "Seat " + i + " is already taken."); return; }
  const kp = J(Z.boxKeypair());
  putSec(gid, i, { boxSk: kp.sk, version, uid: me, ...sign });
  const name = user ? (await user.me()).name : "";
  const doc = { uid: me, name, boxPk: kp.pk, at: Date.now(), signPk: sign?.signPk };
  // In a version 3 wallet the seat signs its own document with the new key. Readers pin the key
  // only when this signature checks out.
  if (version === 3) {
    const text = Z.docPayload(gid, "seats/" + i, i, S(doc));
    Object.assign(doc, { by: i, sig: await signMsg(sign.signSk, text) });
  }
  await ref.set(doc);
  // Saved only after the store holds the seat: a failed take must not look like a replaced key.
  await putSec(gid, i, { boxPk: kp.pk });
  log("you took seat " + i);
}

function dropChain() { const c = chain; chain = null; if (c && !c.syncing && c.cw) c.cw.free(); }

function ensureChain() {
  if (!Z || (chain && chain.gid === state.gid)) return;
  const w = state.wallet;
  chain = {
    gid: state.gid, secret: gkeys[state.gid], net: curNet(), ufvk: w.ufvk, birthday: w.birthday,
    cw: null, url: null, prog: null, bal: null, ms: 0, error: null, syncing: false,
  };
  runSync(chain);
}

// Returns the first light-wallet server of `net` that answers, in order of preference.
async function pickServer(net) {
  for (const url of net.servers) {
    try { await withTimeout(Z.latestHeight(url), SERVER_TIMEOUT_MS, new URL(url).host); return url; }
    catch (e) { log(new URL(url).host + " unreachable: " + (e.message || e)); }
  }
  throw new Error("No light-wallet server answers. Check your connection, then click Sync.");
}

// A new server or a reload continues from saved state; without it the wallet syncs from the birthday.
async function connect(c) {
  const url = await pickServer(c.net);
  if (c.cw && c.url === url) return;
  let snap = null;
  try { snap = c.cw ? c.cw.snapshot() : await loadSnapshot(c); } catch (e) {
    log("no usable wallet state: " + (e.message || e));
  }
  let next = null;
  if (snap) {
    try { next = Z.ChainWallet.restore(c.ufvk, c.birthday, url, snap); } catch (e) { log("saved wallet state rejected: " + (e.message || e)); }
  }
  if (c.cw) c.cw.free();
  c.cw = next || new Z.ChainWallet(c.ufvk, c.birthday, url);
  c.url = url;
  log("using " + new URL(url).host + (next ? ", continuing from saved state" : ""));
  if (next && !c.bal) { c.bal = J(c.cw.balance()); c.received = J(c.cw.received()); c.sent = new Set(J(c.cw.sent())); render(); }
}

export async function runSync(c) {
  if (c.syncing) return;
  c.syncing = true; c.error = null; render();
  const t0 = performance.now();
  try {
    await connect(c);
    c.bal = J(await c.cw.sync((p) => { c.prog = J(p); render(); }));
    c.balAt = Date.now();
    c.received = J(c.cw.received());
    c.sent = new Set(J(c.cw.sent()));
    c.prog = null; c.ms = Math.round(performance.now() - t0);
    if (!c.account) saveBal(c.gid, c.bal);
    saveSnapshot(c);
    log("synced to " + c.bal.height + ", spendable " + fmtZec(c.bal.spendable));
    runMemos(c);
  }
  catch (e) {
    c.error = e.message || String(e); log("sync failed: " + c.error);
    if (Z.isDeepReorg(c.error)) await rescanFromBirthday(c);
  }
  finally { c.syncing = false; if (!current(c) && c.cw) c.cw.free(); render(); }
}

// Drops the saved state, so that the next sync scans the wallet again from its birthday.
async function rescanFromBirthday(c) {
  c.error = "The chain reorganised by more than the wallet can undo. Zigs deleted the saved "
    + "state of this wallet. Refresh to scan it again from the start.";
  try { await idb("readwrite", (st) => st.delete(snapId(c))); }
  catch (e) { log("could not delete wallet state: " + (e.message || e)); }
  if (c.cw) { c.cw.free(); c.cw = null; }
  c.bal = null; c.received = []; c.sent = new Set(); c.prog = null;
}

// Reads the memos of received payments, in the wallets where this browser turned it on. A memo is
// in the full transaction only, so this asks the light-wallet server for each transaction that the
// sync found. The server learns which ones (see memoSwitch). It runs after a sync and never blocks
// it. A failed read skips that transaction. The engine moves it back in its list, so the next run
// starts with other transactions. The next sync tries again.
export async function runMemos(c) {
  if (c.memoBusy || !c.cw || !memosOn(c)) return;
  c.memoBusy = true;
  const cw = c.cw;
  try {
    const got = await memoPass(c, cw);
    if (got && !memoStale(c, cw)) { c.received = J(cw.received()); saveSnapshot(c); render(); }
  }
  catch (e) { log("could not read memos: " + (e.message || e)); }
  finally { c.memoBusy = false; }
}

// The wallet of the open page, or the personal account, is the one that a run may go on for.
const current = (c) => c === chain || c === acct;
// The personal account always reads memos, because its messages are memos.
const memosOn = (c) => c.account === true || readsMemos(c.gid);
// Another server, wallet or rescan replaced the wallet that started a run, or the signer turned
// memo reading off: each read tells the light-wallet server which transaction pays the wallet.
const memoStale = (c, cw) => c.cw !== cw || !current(c) || !memosOn(c);

// Reads the transactions that the engine lists. Three failures to reach the server in a row end
// the pass: the server is the problem. An answer that the engine refuses does not count, because
// the server answered. Returns how many notes got a memo.
async function memoPass(c, cw) {
  let got = 0, down = 0;
  for (const n of J(cw.memoNeeds())) {
    if (memoStale(c, cw) || down >= 3) break;
    try { got += await readMemo(c, cw, n); down = 0; }
    catch (e) {
      down = e.network ? down + 1 : 0;
      log("could not read the memo of " + short(n.txid, 8) + ": " + (e.message || e));
    }
  }
  return got;
}

// Fetches the transaction of `n` and gives it to the engine, which checks that it is that
// transaction. Returns how many notes left the pending state. Only a failure to fetch has
// `network`.
async function readMemo(c, cw, n) {
  const host = new URL(c.url).host;
  let raw;
  try { raw = await withTimeout(Z.fetchTransaction(c.url, n.hash), SERVER_TIMEOUT_MS, host); }
  catch (e) { throw Object.assign(new Error(e.message || String(e)), { network: true }); }
  if (memoStale(c, cw)) return 0;
  return J(cw.attachTransaction(n.txid, raw)).attached;
}

// `payees` (address, amount and optional memo) and `note` are the proposer's words; approvers
// check `payees` against the transaction.
export async function newSpend(payees, note, move = null, priority = false) {
  const gid = state.gid, approvals = state.g.t;
  if (!chain || chain.gid !== gid || !chain.bal) {
    throw new Error("The wallet has not finished its first sync.");
  }
  if (!mayAct()) throw new Error(NO_SEAT_KEY);
  // A payee has a memo only when it has text. A proposal without memos stays {to, amount}.
  payees = payees.map(({ to, amount, memo }) => memo ? { to, amount, memo } : { to, amount });
  const t = J(await chain.cw.createSpend(S(payees), priority));
  const ref = sdb.collection("groups/" + gid + "/sessions").doc();
  const fields = proposalFields(payees, note, t, move, Date.now());
  const sig = await sigPart(gid, ref.id, "proposal", fields);
  await ref.set({ createdBy: myUid(), status: "collecting", ...fields, ...sig });
  log("new spend: " + fmtZec(t.amount));
  showBanner("ok", "Payment proposed. It needs " + approvals + " approvals.");
  if (state.gid === gid) openSession(ref.id);
}

// Sends every confirmed note to the wallet that replaces this one.
async function proposeMove() {
  const to = state.g.movedTo, tw = ready[to], c = curChain();
  if (!tw) throw new Error("The new wallet has no address yet.");
  const amount = c && c.bal ? c.bal.max_send : 0;
  if (!(amount > 0)) throw new Error("No confirmed funds to move yet.");
  await newSpend([{ to: tw.address, amount }], "Move to " + groupName(to), to);
}

async function cancelMove() {
  await sdb.doc("groups/" + state.gid).update({ movedTo: null, movedAt: null });
  showBanner("ok", "Move cancelled. This wallet stays as it is.");
}

export async function broadcastTx(ss) {
  const gid = state.gid, ref = sdb.doc(sessionPath(ss, gid));
  try {
    if (!isStr(ss.final.tx_hex) || !isStr(ss.final.txid)) {
      throw new Error("The finished transaction cannot be read.");
    }
    // The sent mark names the txid of the final transaction, and a seat signs it. A seat that
    // cannot sign fails here, before the transaction goes out.
    const sent = { broadcastTxid: ss.final.txid, broadcastAt: Date.now() };
    const sig = await sigPart(gid, ss.id, "sent", sent);
    await broadcastAnywhere(ss.final.tx_hex);
    await ref.update({ ...sent, ...sig, broadcastError: null, status: "broadcast" });
    log("transaction broadcast: " + ss.final.txid);
    showBanner("ok", "Sent to the network. It confirms with the next block.");
    runSync(chain);
  } catch (e) {
    await ref.update({ broadcastError: e.message || String(e) });
  }
}

// Tries each server in turn; a temporary wallet is enough because broadcasting needs no sync.
// `where` names the network, viewing key and birthday of the sender: the open wallet or account.
// The error has `refused` when every server answered with a refusal. Any other failure (a timeout,
// a lost connection) leaves open whether a server took the transaction.
async function broadcastAnywhere(txHex, where = {
  net: curNet(), ufvk: state.wallet.ufvk, birthday: state.wallet.birthday,
}) {
  const errors = [];
  let refused = true;
  for (const url of where.net.servers) {
    const cw = new Z.ChainWallet(where.ufvk, where.birthday, url);
    try { return J(await withTimeout(cw.broadcast(txHex), SERVER_TIMEOUT_MS * 2, new URL(url).host)); }
    catch (e) {
      refused = refused && Z.isNodeRefusal(said(e));
      errors.push(new URL(url).host + ": " + said(e));
    }
    finally { cw.free(); }
  }
  throw Object.assign(new Error(errors.join("; ")), { refused });
}

// Why seat i cannot approve the payment now, or null.
function approveRefusal(ss, i, ins) {
  if (ss.error) return "This payment was cancelled or failed, so it was not approved.";
  if (expired(ss)) return "This payment expired, so it was not approved. Propose it again.";
  if (state.pending) return "Zigs is still checking this wallet's data. Try again in a moment.";
  if (!ins || ins.error) return "This browser could not check the payment, so it did not approve.";
  if (seatCheck(i) === true) return null;
  return "Seat " + i + " has not checked this wallet against its key share, so it did not approve.";
}

// One approval at a time for each payment and seat: a second click during the waits below would
// make other nonces.
export async function approve(ss, i) {
  const key = "approve:" + ss.id + ":" + i;
  if (busy.has(key)) return;
  busy.add(key);
  try { await approveNow(ss, i); } finally { busy.delete(key); }
}

async function approveNow(ss, i) {
  const gid = state.gid, ins = inspectOf(ss);
  const why = approveRefusal(ss, i, ins);
  if (why) throw new Error(why);
  // The engine refuses an expired payment. It checks against the chain height now, because the
  // last sync can be minutes old.
  const tip = await freshTip();
  // Another tab can save the secrets of this seat during the waits. Read them after each wait, so
  // that a write here neither brings back a burned nonce nor drops a new one.
  if ((sec(gid, i).nonces || {})[ss.id]) throw new Error("This seat already approved this payment.");
  const r = J(Z.signCommit(ss.pczt, state.wallet.orchard_fvk, S(sec(gid, i).keyPackage), tip));
  // The approval covers this exact transaction: a share is signed later only for the same sighash.
  const mine = { nonces: r.nonces, commitments: r.commitments, sighash: ins.sighash };
  const rel = "sessions/" + ss.id + "/commits/" + i;
  // A seat that cannot sign fails here, before the approval is saved.
  const doc = await signedDoc(gid, rel, i, { commitments: r.commitments, at: Date.now() });
  const nonces = { ...(sec(gid, i).nonces || {}), [ss.id]: mine };
  if (!(await putSec(gid, i, { nonces }))) {
    throw new Error("Could not save the approval in this browser, so it was not sent.");
  }
  await sdb.doc("groups/" + gid + "/" + rel).set(doc);
  log("seat " + i + ": approved the spend, nonce commitment published");
  showBanner("ok", "Approved" + (localSeats().length > 1 ? " as seat " + i : "") + ".");
}

// The chain height now, from the open wallet's light-wallet server, else from the other servers
// of its network.
async function freshTip() {
  const c = curChain();
  if (!c || !c.url) throw new Error("Wait for the first sync to finish, then approve.");
  const errors = [];
  for (const url of [c.url, ...curNet().servers.filter((u) => u !== c.url)]) {
    const host = new URL(url).host;
    try { return await withTimeout(Z.latestHeight(url), SERVER_TIMEOUT_MS, host); }
    catch (e) { errors.push(host + ": " + said(e)); }
  }
  throw new Error("No light-wallet server gave the chain height, so this browser did not "
    + "approve. " + errors.join("; "));
}

// A sent payment that no block holds yet keeps the wallet's notes until it expires. A node can
// drop it, so any signer can send the same transaction again. The sent mark stays as it is.
async function resendTx(ss) {
  await broadcastAnywhere(ss.final.tx_hex);
  showBanner("ok", "Sent again. It confirms with the next block.");
}

export async function cancelPayment(ss) {
  if (ss.signed || ss.error) throw new Error("This payment is already signed or closed, so it cannot be cancelled.");
  const gid = state.gid, seat = writer(undefined, gid) ?? localSeats()[0];
  const who = ((state.seats[seat] || {}).name || "a signer") + " (seat " + seat + ")";
  const fields = { error: "Cancelled by " + who + "." };
  const sig = await sigPart(gid, ss.id, "cancel", fields);
  await sdb.doc(sessionPath(ss, gid)).update({
    ...fields, status: "cancelled", cancelledAt: Date.now(), ...sig,
  });
  for (const [i, s] of mySeatSecrets(gid)) {
    const nonces = { ...(s.nonces || {}) };
    if (!nonces[ss.id]) continue;
    delete nonces[ss.id];
    await putSec(gid, i, { nonces });
  }
  showBanner("ok", "Payment cancelled.");
}

export async function finalizeTx(ss) {
  const gid = state.gid, ref = sdb.doc(sessionPath(ss, gid));
  if (!mayAct()) throw new Error(NO_SEAT_KEY);   // checked before a minute of work
  await ref.update({ status: "proving", provingAt: Date.now() });
  log("building Halo2 proof (about a minute)…");
  let out;
  try { out = await engineOffThread("finalize", ss.signed); }
  catch (e) { await ref.update({ status: "signed" }); throw e; }
  // A seat signs the proof and the finished transaction.
  const sig = await sigPart(gid, ss.id, "final", { final: out });
  await ref.update({ status: "complete", final: out, ...sig });
  log("transaction complete: " + out.txid);
  showBanner("ok", "Proof ready. Send the payment to the network.");
}

// ───────────────────────── Backups ─────────────────────────
// A backup file is the key share, sealed with a passphrase (PROTOCOL.md section 9). The engine
// does the Argon2id and the cipher. The passphrase lives only in the dialog's input and in the
// worker call, never in `ui`.
const BACKUP_KIND = "zigs-key-share";   // what the sealed text holds, also in a plain file
// The key share files changed on this date (PROTOCOL.md section 9). Account and Solana files did
// not, so only the seat backup screens and these two texts say it.
const BACKUP_CHANGED = "The backup format changed on 16 October 2026. Older backup files no longer "
  + "open. Save a new backup now. iPhone and Mac apps need their next version to open new files.";
const NOT_A_BACKUP = "This file is not a Zigs backup, or an older version of Zigs made it. "
  + "The backup format changed on 16 October 2026, and older files no longer open. "
  + "Make a new backup on a device that still holds the seat.";
const NOT_ENCRYPTED = "This backup file is not encrypted. Make a new encrypted backup now.";
const MAX_BACKUP_BYTES = 1000000;
const ACCOUNT_PASS_NOTE = "This passphrase opens the backup of your personal account. Zigs cannot "
  + "recover it. Write it down and keep it apart from the file.";
const ACCOUNT_FILE_NOTE = "The file holds the seed of the account and your contacts. Anyone who "
  + "has the file and the passphrase can spend the account and read the contacts. It holds no "
  + "messages.";
const PASS_NOTE = "This passphrase opens your key share. Zigs cannot recover it. Write it down and "
  + "keep it apart from the file.";

// Nonces stay out: a restored copy must never sign with a nonce this browser may also use.
export function backupText(i) {
  const {
    nonces: _nonces, backupSaved: _saved, backedUp: _oldFlag, sol: _sol, ...s
  } = sec(state.gid, i);
  s.uid = s.uid || state.seats[i].uid;
  return S({
    kind: BACKUP_KIND, group: state.gid, groupName: state.g.name, seat: i,
    threshold: state.g.t, of: state.g.n, key: gkeys[state.gid], wallet: state.wallet, secret: s,
  });
}

function openBackup(i) {
  if (!downloads) { showBanner("bad", "Downloads are not available in this view."); return; }
  ui.backup = { seat: i, made: false, busy: false };
  render();
}

function closeBackup() {
  if ((ui.backup || ui.restore || {}).busy) return;
  ui.backup = null; ui.restore = null;
  render();
}

// Seals `plain`, opens the file again in memory to prove it holds the same text, and only then
// offers the download. Returns false when the person declined to save.
export async function sealAndSave(pass, plain, filename) {
  const sealed = await engineOffThread("backupSeal", pass, plain);
  if (await engineOffThread("backupOpen", pass, sealed) !== plain) {
    throw new Error("The backup did not open to the same data, so it was not saved. Try again.");
  }
  try {
    await downloads.save({ filename, data: sealed });
  } catch (e) {
    if (e && e.code === "declined") return false;
    throw new Error("Backup not saved: " + (e.message || e.code));
  }
  return true;
}

export async function saveBackup(i, pass) {
  // The wallet that is open can change while the engine works (the Back button).
  const gid = state.gid, wallet = state.g.name;
  if (!(await sealAndSave(pass, backupText(i), backupName(wallet, i)))) return false;
  await putSec(gid, i, { backupSaved: true });
  return true;
}

// The backup of the personal account: the seed, the network, the birthday and the contacts. An
// account that does not read gives what can be read of it.
export async function saveAccountBackup(pass) {
  const payload = personal ? backupPayload(personal)
    : salvageBackup(personalDamaged, personalEnv());
  if (!payload) {
    throw new Error("This page cannot read the seed of the saved account, so it cannot make a "
      + "backup.");
  }
  if (!(await sealAndSave(pass, S(payload), accountBackupName(payload.network)))) return false;
  if (personal) await changePersonal((p) => { p.backedUp = true; p.everBackedUp = true; });
  return true;
}

function openAccountBackup() {
  if (!downloads) { showBanner("bad", "Downloads are not available in this view."); return; }
  ui.backup = { personal: true, made: false, busy: false };
  render();
}

// The words of the backup dialog and the call that saves, for a seat and for the account.
const seatBackup = (i) => ({
  title: "Back up seat " + i, pass: PASS_NOTE, save: (pass) => saveBackup(i, pass),
  changed: BACKUP_CHANGED,
  file: "The file holds your key share. Anyone who has the file and the passphrase can sign as "
    + "this seat.",
});
const ACCOUNT_BACKUP = {
  title: "Back up the personal account", pass: ACCOUNT_PASS_NOTE, file: ACCOUNT_FILE_NOTE,
  save: (pass) => saveAccountBackup(pass),
};

export function backupDialog() {
  const b = ui.backup, words = b.words ?? (b.personal ? ACCOUNT_BACKUP : seatBackup(b.seat));
  const pass = el("input", {
    class: "input mono", id: "bk-pass", type: b.made ? "text" : "password", autocomplete: "off",
    spellcheck: "false", autocapitalize: "off", disabled: b.busy, "aria-describedby": "bk-hint",
  });
  const again = el("input", {
    class: "input mono", id: "bk-again", type: "password", autocomplete: "off",
    spellcheck: "false", autocapitalize: "off", disabled: b.busy, "aria-describedby": "bk-hint",
  });
  const hint = el("span", { class: "hint", id: "bk-hint" });
  const go = el("button", { class: "btn primary", type: "submit" },
    b.busy ? "Encrypting…" : "Encrypt and save");
  const update = () => {
    const issue = passIssue(pass.value, again.value);
    hint.textContent = issue || "The passphrases match.";
    hint.className = "hint " + (issue ? "" : "ok");
    go.disabled = !!issue || b.busy || !Z;
  };
  // The new values are set on the inputs, because a redraw keeps what the inputs hold.
  const make = () => {
    pass.value = makePassphrase(crypto.getRandomValues(new Uint8Array(30)));
    again.value = "";
    b.made = true;
    render();
  };
  const submit = act(async () => {
    const p = pass.value;
    if (passIssue(p, again.value)) return;
    b.busy = true; render();
    try {
      if (!(await words.save(p))) return;
      if (ui.backup === b) ui.backup = null;
      showBanner("ok", "Backup saved. Keep the passphrase apart from the file.");
    } finally { b.busy = false; }
  });
  const form = el("form", {
    class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "backup-title",
    oninput: update, onsubmit: submit,
  },
  el("div", { class: "card-head" }, el("h2", { id: "backup-title" }, words.title),
    el("button", {
      class: "icon-btn", type: "button", "aria-label": "Close", onclick: closeBackup,
    }, "×")),
  el("p", { class: "small" }, words.pass),
  words.changed ? el("p", { class: "small" }, words.changed) : null,
  el("label", { class: "field" }, el("span", {}, "Passphrase"), pass),
  el("div", { class: "row-actions" },
    el("button", { class: "btn sm", type: "button", disabled: b.busy, onclick: make },
      "Make a passphrase for me"),
    b.made ? copyBtn(() => pass.value, "Copy passphrase") : null),
  b.made ? el("p", { class: "small" }, "Copy keeps the passphrase on the clipboard until you copy "
    + "something else. Write it down, then clear the clipboard.") : null,
  el("label", { class: "field" }, el("span", {}, "Type it again"), again, hint),
  el("div", { class: "callout" }, words.file),
  el("div", { class: "dialog-actions" },
    el("button", {
      class: "btn", type: "button", disabled: b.busy, onclick: closeBackup,
    }, "Cancel"),
    go));
  update();
  return form;
}

function restoreDialog() {
  const r = ui.restore;
  const pass = el("input", {
    class: "input mono", id: "rs-pass", type: "password", autocomplete: "off",
    spellcheck: "false", autocapitalize: "off", disabled: r.busy,
  });
  const submit = act(async () => {
    const p = pass.value;
    if (!p) throw new Error("Enter the passphrase of this backup.");
    r.busy = true; render();
    try {
      const plain = await engineOffThread("backupOpen", p, r.text);
      await applyBackup(parseBackup(plain), true);
      ui.restore = null;
    } finally { r.busy = false; }
  });
  return el("form", {
    class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "restore-title",
    onsubmit: submit,
  },
  el("div", { class: "card-head" }, el("h2", { id: "restore-title" }, "Open a backup"),
    el("button", {
      class: "icon-btn", type: "button", "aria-label": "Close", onclick: closeBackup,
    }, "×")),
  el("p", { class: "small" }, "Enter the passphrase you chose when you made " + r.name + "."),
  el("label", { class: "field" }, el("span", {}, "Passphrase"), pass),
  el("div", { class: "dialog-actions" },
    el("button", {
      class: "btn", type: "button", disabled: r.busy, onclick: closeBackup,
    }, "Cancel"),
    el("button", { class: "btn primary", type: "submit", disabled: r.busy || !Z },
      r.busy ? "Opening…" : "Open backup")));
}

function parseBackup(text) {
  try { return J(text); } catch { throw new Error(NOT_A_BACKUP); }
}

// An encrypted file asks for its passphrase. A plain file of the current kind restores at once and
// leaves the backup note up, so the person makes an encrypted file. A plain file of an older
// version has another kind: checkShape refuses it.
export async function restore(file) {
  try {
    if (file.size > MAX_BACKUP_BYTES) throw new Error(NOT_A_BACKUP);
    const text = await file.text();
    const b = parseBackup(text);
    if (b && b.kind === "zigs-backup") {
      ui.restore = { text, name: file.name, busy: false };
      render();
      return;
    }
    await applyBackup(b, false);
  } catch (e) { showBanner("bad", e.message); }
}
const BACKUP_SEAT_MAX = 7;
const wellFormed = (b) => isObj(b) && b.kind === BACKUP_KIND && isObj(b.secret);
const validSeatRef = (b) => validId(b.group) && Number.isInteger(b.seat) && b.seat >= 1
  && b.seat <= BACKUP_SEAT_MAX;
const validKey = (b) => b.key === undefined || validRoom({ id: b.group, key: b.key });
const NO_FIT = "This backup does not fit this wallet. It was not used.";
const RESTORE_PENDING = "A restore of this seat is still being checked. Open the wallet and "
  + "wait, then try again.";

export function checkShape(b) {
  if (!(wellFormed(b) && validSeatRef(b) && validKey(b))) throw new Error(NOT_A_BACKUP);
  if (!shareShape(b.secret.keyPackage)) throw new Error("This backup holds no key share.");
}

// A restore must not replace what this browser holds: not the wallet secret (the rule for invite
// links, too), not a seat that is still in setup, not the key share of the seat, and not a chat
// that has the id of the wallet.
function checkClash({ group, seat, key, secret }) {
  const held = heldRefusal(sec(group, seat), secret.keyPackage, seat);
  const found = [
    [key && gkeys[group] && gkeys[group] !== key, "This backup has a different wallet secret for "
      + "a wallet you already have, so it was not restored."],
    [isChatId(group), "A chat that you have uses the id of this wallet, so the backup was not "
      + "restored."],
    [held, held],
    [restoreWatch.has(skey(group, seat)), RESTORE_PENDING],
  ].find(([clash]) => clash);
  if (found) throw new Error(found[1]);
}

// Throws unless the page can store `b`. A wallet that is open already shows if the backup fits.
// While a document that decides it has not loaded, settleRestore decides later.
function checkBackup(b) {
  checkShape(b);
  checkClash(b);
  if (state.gid === b.group && fitState(b.seat, b.secret) === false) throw new Error(NO_FIT);
}

// A restore waits here until the documents of its seat have loaded (settleRestore), by wallet and
// seat. `keys` holds the key pairs of the file, and `late` its version and room. They are not
// stored before the published keys of the seat and the wallet document check them.
export const restoreWatch = new Map();

// What a restore stores now: the allowed fields of the file without its key pairs, version and
// room, which wait for the check of settleRestore. Older backups hold nonces: a restored nonce
// could sign a second, different package, so the nonces of this browser stay. A seat that held a
// key share stays what it was: the flag `restored` would put the seat of this browser under the
// fit rule of seatOwned.
export function restoredFor(b, held) {
  const nonces = (held || {}).nonces || {};
  return { ...restoredSecret(b.secret, held), nonces, ...(held ? {} : { restored: true }),
    backupSaved: false };
}

// The files that are no key share of a seat. A Map, because the kind comes from a file: a plain
// object would answer for "constructor".
const OTHER_BACKUPS = new Map([[PERSONAL_KIND, restoreAccount], [SOL_BACKUP_KIND, solRestore]]);

// Stores the key share of a backup, from the fields that restoredFields allows. `encrypted` says
// the file was sealed: only then does the seat count as backed up, and only when the backup fits
// the wallet.
export async function applyBackup(b, encrypted) {
  const other = isObj(b) ? OTHER_BACKUPS.get(b.kind) : undefined;
  if (other) return other(b, encrypted);
  checkBackup(b);
  const { group, seat, key } = b;
  const held = secrets[skey(group, seat)];
  const before = held && structuredClone(held);
  const addedKey = !!key && !gkeys[group];
  if (key) putKey(group, key);
  if (!(await putSec(group, seat, restoredFor(b, held)))) {
    throw new Error("This browser could not save the restored key share.");
  }
  const where = "seat " + seat + " of " + (b.groupName || "wallet");
  restoreWatch.set(skey(group, seat), {
    gid: group, seat, encrypted, before, addedKey, where, keys: keysOf(b.secret),
    late: lateFields(b.secret, held),
  });
  announceRestore(where, encrypted);
  openGroup(group);
}

function announceRestore(where, encrypted) {
  const text = "Restored " + where + ". It counts as your seat once it matches the wallet.";
  if (encrypted) showBanner("ok", text);
  else showBanner("bad", text + " " + NOT_ENCRYPTED);
}

// Removes the seat secret that the restore made (undoPlan). Returns false when it leaves the seat
// alone, else true when the wallet went away too.
export function undoRestore(w) {
  if (undoPlan(w.before) === "keep") return false;
  delete secrets[skey(w.gid, w.seat)];
  const dropped = releaseKey(w);
  persist();
  return dropped;
}

// The restore that added the wallet secret removes it again, unless a seat of the wallet remains.
// A restore of the same wallet that still waits takes over the duty to remove it.
function releaseKey({ gid, addedKey }) {
  const heir = [...restoreWatch.values()].find((o) => o.gid === gid);
  if (heir) heir.addedKey = heir.addedKey || addedKey;
  const drop = addedKey && !mySeatSecrets(gid).length;
  if (drop) delete gkeys[gid];
  return drop;
}

// A restored key share counts when the key data of the seat equals what the wallet published
// for it, which is known when the documents of the seat have loaded. Else the restore is undone.
// Each restore settles alone, and the first one may close the wallet.
export function settleRestore() {
  let settled = false;
  for (const [key, w] of [...restoreWatch]) settled = settleOne(key, w) || settled;
  if (settled) render();
}

function settleOne(key, w) {
  if (w.gid !== state.gid || !state.seats[w.seat]) return false;
  const fit = fitState(w.seat, sec(w.gid, w.seat) || {});
  if (fit === null) return false;
  restoreWatch.delete(key);
  if (fit) acceptRestore(w, state.seats[w.seat]);
  else rejectRestore(w);
  return true;
}

function rejectRestore(w) {
  if (undoRestore(w)) openGroup(null);
  showBanner("bad", NO_FIT);
}

// A restored seat that does not fit is no seat of this browser (seatOwned). The watch of a restore
// is in memory, so after a reload no restore settles it: the note stays.
// Removing it deletes only this browser's copy. The wallet's verdict can come from a document that
// any holder of the invite link can rewrite, so removal asks first.
const STALE_RESTORE = "This restored seat does not match the wallet, so this browser does not use "
  + "it. Remove it from this browser, then restore the right backup.";
function staleRestoreNote() {
  const gid = state.gid, stale = mySeatSecrets(gid).filter(([i, s]) =>
    staleRestore(s, () => fitState(i, s), restoreWatch.has(skey(gid, i)))).map(([i]) => i);
  if (!stale.length) return null;
  const sure = ui.dropStale === gid;
  const drop = () => {
    for (const i of stale) delete secrets[skey(gid, i)];
    ui.dropStale = null; persist(); render();
  };
  const keep = () => { ui.dropStale = null; render(); };
  return el("div", { class: "callout bad", role: "alert" }, STALE_RESTORE,
    el("div", { class: "dialog-actions" },
      sure ? el("button", { class: "btn", type: "button", onclick: keep }, "Keep it") : null,
      el("button", {
        class: "btn", type: "button", onclick: sure ? drop : () => { ui.dropStale = gid; render(); },
      }, sure ? "Remove seat " + stale.join(", ") + " from this browser" : "Remove from this browser")));
}

// The version and room of the file join the seat only when they equal the wallet's own.
function acceptRestore(w, published) {
  once("restore-keys:" + skey(w.gid, w.seat), () => takeRestoredKeys(w, published));
  const later = settledFields(w.late, groupVersion(), state.g.room);
  if (Object.keys(later).length) putSec(w.gid, w.seat, later);
  if (!w.encrypted) return;
  putSec(w.gid, w.seat, { backupSaved: true });
  showBanner("ok", "Restored " + w.where + ". It matches the wallet.");
}

// A pair checks out when the secret key of the file makes the public key that the seat published.
const PAIR_CHECKS = {
  box: async (f, p) => boxPairMatches(Z, f.boxSk, p.boxPk),
  sign: async (f, p) => signPairMatches(f.signSk, p.signPk),
};

// Adds the key pairs of a restored file to the seat once each is the pair that the seat published.
// A pair that does not check out is dropped.
async function takeRestoredKeys({ gid, seat, keys }, published) {
  const good = [];
  for (const [name, check] of Object.entries(PAIR_CHECKS)) {
    if (await check(keys, published)) good.push(name);
  }
  const held = sec(gid, seat);
  if (held) await putSec(gid, seat, takenKeys(keys, held, good, published));
}
// Reading the memo of a received payment asks the light-wallet server for that transaction, so the
// server learns which transactions pay the wallet. It is off until a person turns it on, for one
// wallet in one browser. It is not a field of the wallet, which every signer would read.
let memoPref = readLocal("zf-memos");        // wallet id -> true while this browser reads memos
export const readsMemos = (gid) => memoPref[gid] === true;
export function setMemoReading(gid, on) {
  memoPref = readLocal("zf-memos");          // another tab may have changed it
  if (on) memoPref[gid] = true; else delete memoPref[gid];
  writeLocal("zf-memos", memoPref);
  if (on && chain && chain.gid === gid) runMemos(chain);
}
const roomPins = readLocal("zf-rooms");      // wallet id -> first room id seen
export const signPins = readLocal("zf-signpins");   // "wallet id:seat" -> first signing key seen
const readMarks = readLocal("zf-read");      // "room id:thread" -> time of the newest message read
const rooms = {};                            // wallet id -> its room id, while it matches the pin
const roomWarn = new Map(), roomSubs = new Map(), chat = {}, tried = new Set(), checked = new Map();
export let signing = null;                          // does this browser have Ed25519? null until known
canSign().then((ok) => { signing = ok; refilter(); });

const isWalletId = (id) => !!gkeys[id] || !!chats.list[id];   // ids of chats are taken too
const mineIn = (id) => chats.list[id] ? [chats.list[id].member] : mySeatSecrets(id).map(([i]) => i);
// The id that the read marks of a conversation hang on: the room of a wallet, or the chat itself.
const markId = (id) => chats.list[id] ? id : rooms[id];
const MAX_SKEW = 10 * 60000;   // a message dated further ahead than this is never "unread"
// Messages that can be unread: the wallet thread, and the threads of payments that exist. Without
// the second rule, a thread of no payment would hold a count that no drawer can clear.
function countable(gid, list = chat[gid] || []) {
  const horizon = Date.now() + MAX_SKEW;
  if (chats.list[gid]) return list.filter((m) => m.at <= horizon);
  const sessions = gid === state.gid ? state.sessions : inbox[gid] || [];
  const threads = new Set(["wallet", ...sessions.map((ss) => "pay:" + ss.id)]);
  return list.filter((m) => threads.has(m.thread) && m.at <= horizon);
}
const unreadIn = (gid, thread) => markId(gid)
  ? countUnread(countable(gid), mineIn(gid), readMarks, markId(gid), thread) : 0;
const NO_SIGNING = "This browser cannot sign messages. "
  + "Use a current Chrome, Edge, Firefox or Safari.";
const ROOM_CHANGED = "The message room of this wallet changed. Messages are paused. "
  + "Ask your signers.";
const ROOM_MISSING = "The message room of this wallet is missing. Messages are paused. "
  + "Ask your signers.";
const ROOM_WARN = { changed: ROOM_CHANGED, missing: ROOM_MISSING };

// The reactor runs often, and each failed write counts against the server's rate limit.
function throttled(key, fn) {
  if (tried.has(key)) return;
  tried.add(key);
  setTimeout(() => tried.delete(key), 30000);
  once(key, fn);
}

function syncRooms() {
  if (!sdb || !Z) return;
  recallRooms(); adoptRooms(); watchRooms(); ensureRooms(); watchChats();
}

// Seat secrets keep each room (and backups carry it), so a room field that is later lost or
// damaged in the store cannot take the room with it after a reload.
function recallRooms() {
  for (const [k, s] of Object.entries(secrets)) {
    if (!s || !validRoom(s.room)) continue;
    roomKeys[s.room.id] ||= s.room.key;
    if (pin(roomPins, k.split(":")[0], s.room.id) === "new") saveMerged("zf-rooms", roomPins, oldest);
  }
}

function adoptRooms() {
  for (const g of state.groups) {
    let pick = pickRoom(g.id, g.room, roomPins, isWalletId);
    const known = pick === "use" && roomKeys[g.room.id];
    if (known && known !== g.room.key) pick = "changed";   // the key is pinned with the id
    if (pick === "use") learnRoom(g.id, g.room);
    const id = roomOf(g, pick);
    if (id) rooms[g.id] = id; else delete rooms[g.id];
    const warn = id ? null : ROOM_WARN[pick];
    if (warn) roomWarn.set(g.id, warn); else roomWarn.delete(g.id);
  }
}

function learnRoom(gid, room) {
  roomKeys[room.id] ||= room.key;   // the first key seen for a room id wins
  if (pin(roomPins, gid, room.id) === "new") saveMerged("zf-rooms", roomPins, oldest);
  for (const [i, s] of mySeatSecrets(gid)) if (!validRoom(s.room)) putSec(gid, i, { room });
}

// A wallet document that lost its room field keeps the pinned room, while this page holds its key.
function roomOf(g, pick) {
  const id = pick === "use" ? g.room.id : pick === "missing" ? roomPins[g.id] : null;
  return roomKeys[id] ? id : null;
}

// Reads the rooms of every wallet where this browser holds a seat, open or not.
function watchRooms() {
  for (const [gid, w] of roomSubs) {
    if (rooms[gid] === w.id) continue;
    w.off(); roomSubs.delete(gid); delete chat[gid];
  }
  for (const [gid, id] of Object.entries(rooms)) {
    if (roomSubs.has(gid) || !mySeatSecrets(gid).length) continue;
    const off = sdb.collection("groups/" + id + "/messages").onSnapshot((snap) => {
      const list = snap.docs.map((d) => parseMsg(d.id, d.data())).filter(Boolean);
      onMessages(gid, list.sort(byTime));
      render();
    }, (e) => log("message room error: " + e.code));
    roomSubs.set(gid, { id, off });
  }
}

function ensureRooms() {
  for (const g of state.groups) {
    if (g.unreadable || !mySeatSecrets(g.id).length) continue;
    const pick = pickRoom(g.id, g.room, roomPins, isWalletId);
    if (pick === "none" || pick === "missing") throttled("room:" + g.id, () => publishRoom(g.id));
  }
}

// Writes the room field of a wallet that names none. A wallet with a pinned room gets that room
// again, and never a new one: a new room would split the signers.
async function publishRoom(gid) {
  const pinned = roomPins[gid], room = pinned ? { id: pinned, key: roomKeys[pinned] } : newRoom();
  if (!room.key) return;   // the pinned room's key is not in this page: another signer can help
  const ref = sdb.doc("groups/" + gid);
  if (!(await ref.acquire({ holder: crypto.randomUUID(), ttlMs: 10000 })).acquired) return;
  const cur = await ref.get();
  const pick = cur.exists && pickRoom(gid, cur.data().room, roomPins, isWalletId);
  if (pick !== "none" && pick !== "missing") return;
  await ref.update({ room });
  log("message room written");
}

// A seat made before messages gets its signing key once. The seat document keeps the first key.
// The lease comes first, so two tabs of one browser cannot make two keys. The key is published
// only after this browser saved it. An older backup file lacks the key, so a new key on a
// backed-up seat clears `backupSaved` and the page asks for a new backup.
function ensureSignKey(gid, i) {
  if (!signing || validPk(state.seats[i].signPk)) return;
  throttled("sign:" + gid + ":" + i, async () => {
    const ref = sdb.doc("groups/" + gid + "/seats/" + i);
    if (!(await ref.acquire({ holder: crypto.randomUUID(), ttlMs: 10000 })).acquired) return;
    const s = sec(gid, i), made = s.signPk ? null : await newSignKey();   // read after the lease
    const unsaved = made && s.keyPackage ? { backupSaved: false } : {};
    if (!(await putSec(gid, i, { ...made, ...unsaved }))) return;
    const cur = await ref.get();
    if (cur.exists && !validPk(cur.data().signPk)) await ref.update({ signPk: sec(gid, i).signPk });
  });
}

// Pins only keys that came from the store, never one this browser just made. This is for a wallet
// before version 3, whose seat documents have no signature (a version 3 wallet uses pinSeats).
// Only seats of 1 to n count.
function pinSigners() {
  let fresh = false;
  for (const i of seatIds()) {
    const pk = (raw.seats[i] || {}).signPk;
    if (validPk(pk) && pin(signPins, skey(state.gid, i), pk) === "new") fresh = true;
  }
  if (fresh) saveMerged("zf-signpins", signPins, oldest);
}

const changedSigners = () => seatIds().filter((i) => {
  const pk = signPins[skey(state.gid, i)];
  return validPk(pk) && (state.seats[i] || {}).signPk !== pk;
});

// Seats of this browser that hold the signing key their seat document names.
const sendSeats = () => localSeats().filter((i) => {
  const s = sec(state.gid, i);
  return s.signSk && s.signPk === state.seats[i].signPk;
});

// Why this browser cannot send in the open wallet, or null.
function chatWhy() {
  const gid = state.gid;
  if (roomWarn.has(gid)) return roomWarn.get(gid);
  if (!localSeats().length) return "Take a seat to read and send messages.";
  if (!rooms[gid]) return "The message room is being set up.";
  if (signing === false) return NO_SIGNING;
  if (sendSeats().length) return null;
  const making = localSeats().some((i) => !validPk(state.seats[i].signPk));
  return making ? "Your seat key is being created."
    : "This browser has no signing key for your seat, so it cannot send messages. "
      + "A backup file from before messages does not hold this key.";
}

async function sendMessage(thread, text, seat) {
  const gid = state.gid, room = rooms[gid];
  const ref = sdb.collection("groups/" + room + "/messages").doc();
  const m = { id: ref.id, seat, thread, text, at: Date.now() };
  const sig = await signMsg(sec(gid, seat).signSk, signedText(gid, room, m));
  // A send with no answer fails after 10 s. It can still arrive later, so a retry can repeat it.
  await withTimeout(ref.set({ seat, thread, text, at: m.at, sig }), 10000, "The group server");
}

// "yes", "no", "changed" or "wait" for a message of the open wallet.
function trust(m, roomId) {
  const gid = state.gid, seat = state.seats[m.seat], pk = signPins[skey(gid, m.seat)];
  const isSeat = !!seat && seatIds().includes(m.seat);
  return verdict(m, signedText(gid, roomId, m), isSeat, seat && seat.signPk, pk);
}

// `isMember` and `memberPk` come from the store, `pinnedPk` from this browser.
function verdict(m, text, isMember, memberPk, pinnedPk) {
  const gate = keyState(isMember, memberPk, pinnedPk);
  if (gate !== "check") return gate;
  const ok = cachedCheck(pinnedPk, m.sig, text);
  return ok === null ? "wait" : ok ? "yes" : "no";
}

// The key holds everything the result depends on, so no two messages can share an entry.
// null while the check runs. A miss clears a full cache; results that arrive later still fill it.
function cachedCheck(pk, sig, text, done = render, cache = checked) {
  const id = S([pk, sig, text]);
  if (cache.has(id)) return cache.get(id);
  if (cache.size >= 5000) cache.clear();
  cache.set(id, null);
  verifyMsg(pk, sig, text).then((ok) => { cache.set(id, ok); done(); });
  return null;
}

// ───────────────────────── Signed writes (version 3) ─────────────────────────
// The store shows what any holder of the invite link wrote. In a version 3 wallet, each document
// that matters carries the signature of the seat that wrote it (PROTOCOL.md section 15). The page
// keeps the stored documents in `raw` and puts into `state` only those whose signature verifies.
// A document without a result yet counts as absent, and the reactor waits until all results are in.
const NO_SIGNING_SEAT = "This browser cannot sign, so it cannot take part in this wallet. "
  + "Use a current Chrome, Edge, Firefox or Safari.";
const NO_SEAT_KEY = "This browser has no signing key for a seat of this wallet, "
  + "so it cannot write to this wallet.";

// A device keeps the first version that it saw for a wallet, and the version of its own seats. A
// lower version written into the store later does not turn the checks off.
const hasV3Seat = (gid) => mySeatSecrets(gid).some(([, s]) => s.version === 3);
const versionKey = (gid) => "version:" + gid;   // apart from the "wallet id:seat" keys
export const signedMode = (gid) => !!gid && (hasV3Seat(gid) || signPins[versionKey(gid)] === "3");
function pinVersion(gid, g) {
  const v = walletVersion(g);
  if (v && pin(signPins, versionKey(gid), String(v)) === "new") {
    saveMerged("zf-signpins", signPins, oldest);
  }
}

// The first network name that this device saw for a wallet, in `zf-signpins` under
// "network:<wallet id>". A missing or unknown name is not pinned. Returns the fields that replace
// the stored ones: the pinned `network`, and `networkMoved` when the store shows another.
function pinNetwork(gid, d) {
  const key = "network:" + gid;
  if (validNet(d.network) && pin(signPins, key, d.network) === "new") {
    saveMerged("zf-signpins", signPins, oldest);
  }
  const pinned = signPins[key];
  return pinned ? { network: pinned, networkMoved: d.network !== pinned } : {};
}

// The number of signers of a wallet. In a version 3 wallet it is the one this device saw first
// (cleanGroup), so a made-up seat above it never counts.
const seatCount = (gid) => {
  const g = gid === state.gid ? state.g : state.groups.find((x) => x.id === gid);
  return g && validShape(g.n, g.t) ? g.n : 0;
};

// Checks of documents have a memo of their own, apart from the messages. It keeps the signed text
// of each entry and answers only for the same text, and it stays bounded (makeMemo).
export const docMemo = makeMemo();
const SIG_MAX = 128, REL_MAX = 200;   // an Ed25519 signature has 88 characters in base64

// The text that a document signs, from the engine, or null where the engine refuses it.
function payloadOf(gid, rel, by, fieldsText) {
  try { return Z.docPayload(gid, rel, by, fieldsText); } catch { return null; }
}

// A signed part: the document path `rel` below the wallet, the writer `by`, its signature `sig`,
// the signed `fields`, and `need`, the seat that must have written them (null: any seat). `pk`
// names the key to check with, when it is not the pinned one. What a check needs, or its answer
// already: "no", or "wait" while the engine, the signing support or the seat keys are not known.
function partGate(gid, part, known) {
  const { rel, by, sig, need } = part;
  if (!signing || !Z) return "wait";
  if (typeof sig !== "string" || sig.length > SIG_MAX || rel.length > REL_MAX) return "no";
  const pk = part.pk ?? signPins[skey(gid, by)];
  const gate = writerCheck(by, need, seatCount(gid), pk, known);
  return gate === "check" ? { pk } : gate;
}

// At most a few checks run at once, so a flood of large documents cannot fill the memory with
// pending work. The others wait in a queue and start when one ends.
const CHECKS_MAX = 8;
let checking = 0, resultTimer = 0;
const checkQueue = [];
// Results of many documents come one by one. The page filters once for each short wait, not once
// for each result.
function refilterSoon() {
  if (resultTimer) return;
  resultTimer = setTimeout(() => { resultTimer = 0; refilter(); }, 40);
}
function startCheck(entry, gid, part, pk) {
  const run = () => {
    const text = payloadOf(gid, part.rel, part.by, entry.fields);
    const end = (ok) => { entry.ok = ok; checking--; checkQueue.shift()?.(); refilterSoon(); };
    checking++;
    if (text === null) end(false); else verifyMsg(pk, part.sig, text).then(end);
  };
  if (checking < CHECKS_MAX) run(); else checkQueue.push(run);
}

function partVerdict(gid, part, known) {
  const gate = partGate(gid, part, known);
  if (typeof gate === "string") return gate;
  const key = [gid, part.rel, part.by, part.sig].join("|");
  const ok = docMemo.ask(key, S(part.fields), gate.pk,
    (entry) => startCheck(entry, gid, part, gate.pk));
  return ok === null ? "wait" : ok ? "yes" : "no";
}

// The same for a decision that cannot wait for a redraw (it reads the store again).
async function partNow(gid, part) {
  const gate = partGate(gid, part, gid === state.gid && state.seatsSettled);
  if (typeof gate === "string") return gate;
  const text = payloadOf(gid, part.rel, part.by, S(part.fields));
  return text !== null && (await verifyMsg(gate.pk, part.sig, text)) ? "yes" : "no";
}

// The answer for the seat document of seat `i` when no key is pinned for it yet: the document is
// checked with the key that it names. "" when there is nothing to pin.
function seatPin(gid, i) {
  const d = raw.seats[i];
  if (!d || Object.hasOwn(signPins, skey(gid, i))) return "";
  const part = {
    rel: "seats/" + i, by: d.by, sig: d.sig, fields: docFields(d), need: i, pk: d.signPk,
  };
  return partVerdict(gid, part, true);
}

// Pins the first key of each seat of 1 to n, but only a key that signed its own seat document, so
// a made-up document pins nothing. Returns how many seat documents wait for their result.
function pinSeats(gid) {
  let wait = state.seatsLoaded ? 0 : 1, fresh = false;
  for (const i of seatIds()) {
    const verdict = seatPin(gid, i);
    if (verdict === "wait") wait++;
    if (verdict === "yes") { signPins[skey(gid, i)] = raw.seats[i].signPk; fresh = true; }
  }
  if (fresh) saveMerged("zf-signpins", signPins, oldest);
  return wait;
}

// The device logs a document that it ignores once for each time a wallet opens, however often the
// page checks again. A signature is no part of the key, and the set has a limit.
const LOG_MAX = 200;
export const loggedIgnored = new Map();   // wallet id -> the documents already logged
function logIgnored(gid, what) {
  const path = what.slice(0, 120);
  if (!loggedIgnored.has(gid)) loggedIgnored.set(gid, new Set());
  const seen = loggedIgnored.get(gid);
  if (seen.has(path) || seen.size >= LOG_MAX) return;
  seen.add(path);
  log("ignored data without a valid signature (wallet " + gid.slice(0, 6) + "): " + path);
}

const newest = (a, b) => finite(b.createdAt) - finite(a.createdAt);
const asSessions = (map) => Object.entries(map).map(([id, v]) => ({ id, ...v })).sort(newest);
const seatUid = (gid, seat) => gid === state.gid ? (state.seats[seat] || {}).uid : undefined;
const checkIn = (gid) => (rel, by, sig, fields, need) =>
  partVerdict(gid, { rel, by, sig, fields, need }, gid === state.gid && state.seatsSettled);

// A proposal comes from a seat. Its identity is the one in that seat's document, not a field.
const withProposer = (gid) => (ss) => ({ ...ss, createdBy: seatUid(gid, ss.by) });

function filterOpen(gid) {
  const wait = pinSeats(gid);
  state.seatsSettled = wait === 0;
  const f = filterWallet(raw, state.sid, checkIn(gid), (what) => logIgnored(gid, what));
  Object.assign(state, f.docs, {
    sessions: f.sessions.map(withProposer(gid)).sort(newest), ignored: f.bad,
    pending: f.wait > 0 || wait > 0,
  });
}

function readyOf(gid, d) {
  if (!d || !signedMode(gid)) return d;
  const verdict = checkIn(gid)("meta/wallet", d.by, d.sig, docFields(d), 1);
  if (verdict === "no") logIgnored(gid, "meta/wallet");
  return verdict === "yes" ? docFields(d) : verdict === "wait" ? undefined : false;
}

function inboxOf(gid, list) {
  if (!signedMode(gid)) return list;
  const t = { bad: 0, wait: 0, onBad: (what) => logIgnored(gid, what) };
  return readSessions(list.map((d) => [d.id, d]), checkIn(gid), t);
}

// Shows the stored documents as they are in a wallet before version 3.
function copyRaw() {
  if (signedMode(state.gid)) return;   // its group document has not come yet: show nothing
  Object.assign(state, {
    seats: raw.seats, dkg1: raw.dkg1, dkg2: raw.dkg2, confirm: raw.confirm, abort: raw.abort,
    done: raw.done, verify: raw.verify, wallet: raw.wallet, sessions: asSessions(raw.sessions),
    commits: raw.commits, shares: raw.shares, ignored: 0, pending: false,
  });
  pinSigners();
}

function applyFilter() {
  if (state.gid && state.g && signedMode(state.gid)) filterOpen(state.gid); else copyRaw();
  for (const [gid, d] of Object.entries(rawReady)) ready[gid] = readyOf(gid, d);
  for (const [gid, list] of Object.entries(rawInbox)) inbox[gid] = inboxOf(gid, list);
}

// Every change of a stored document, a pin or a check result ends here: the page filters again,
// draws, and lets the reactor act. Several changes in one turn make one pass.
let refilterQueued = false;
export function refilter() {
  if (refilterQueued) return;
  refilterQueued = true;
  queueMicrotask(() => {
    refilterQueued = false;
    try { applyFilter(); } catch (e) { log("✗ filter: " + (e && e.message ? e.message : e)); }
    render();
    react();
  });
}

// The reactor writes nothing while a check is open, or when this browser cannot check at all.
const signedHold = () => state.pending || (signedMode(state.gid) && !signing);

// The text of a document that seat `seat` signs, signed with its key.
const signText = (gid, rel, seat, fields) =>
  signMsg(sec(gid, seat).signSk, Z.docPayload(gid, rel, seat, S(fields)));

// The writer and signature to add to `fields` of the document at `rel` that a seat signs as a
// whole. A wallet before version 3 adds none. Every caller names its wallet (`gid`), because the
// person can open another wallet while an earlier step waits.
async function sigFor(gid, rel, seat, fields) {
  if (!signedMode(gid)) return {};
  if (!canWriteAs(seat, gid)) throw new Error(NO_SEAT_KEY);
  return { by: seat, sig: await signText(gid, rel, seat, fields) };
}
export const signedDoc = async (gid, rel, seat, fields) => ({
  ...fields, ...(await sigFor(gid, rel, seat, fields)),
});

// The same for part `name` of the payment `sid`: the writer is `prefer` if this browser can sign
// for it, else another seat. Only the fields of the part are signed (signPart).
export async function sigPart(gid, sid, name, fields, prefer) {
  if (!signedMode(gid)) return {};
  const seat = writer(prefer, gid);
  if (seat == null) throw new Error(NO_SEAT_KEY);
  return signPart(name, fields, seat, (f) => signText(gid, "sessions/" + sid, seat, f));
}

// May this browser write as seat i? Always before version 3. In version 3 the seat needs the
// signing key that readers pinned (the key in the seat document only while nothing is pinned).
export function canWriteAs(i, gid = state.gid) {
  if (!signedMode(gid)) return true;
  const s = sec(gid, i);
  if (!s || !s.signSk) return false;
  const pinned = signPins[skey(gid, i)];
  const shown = gid === state.gid ? (state.seats[i] || {}).signPk : undefined;
  return s.signPk === (validPk(pinned) ? pinned : shown);
}

// The seat that signs a write that has no seat of its own: `prefer` if this browser can sign for
// it, else another seat of this browser.
export function writer(prefer, gid = state.gid) {
  if (!signedMode(gid)) return null;
  const held = gid === state.gid ? localSeats() : mySeatSecrets(gid).map(([i]) => i);
  const own = held.filter((i) => canWriteAs(i, gid));
  return own.includes(prefer) ? prefer : own[0];
}

// May this browser change the open wallet? Always before version 3. In version 3 it needs a seat
// that can sign: the signed PCZT, the proof and the sent mark are signed parts.
const mayAct = () => !signedMode(state.gid) || writer() != null;

export async function failSession(gid, ss, error) {
  const sig = await sigPart(gid, ss.id, "failure", { error });
  await sdb.doc(sessionPath(ss, gid)).update({ error, status: "failed", ...sig });
}

// The threads this browser shows right now: a chat, or in a wallet the wallet thread (tab or setup
// page) and a payment.
function openThreads() {
  const cid = state.cid;
  return cid ? (chats.list[cid] ? [[cid, "dm"]] : []) : walletThreads();
}

function walletThreads() {
  const gid = state.gid;
  if (!rooms[gid] || !state.g || state.g.unreadable) return [];
  const out = [];
  if (!walletReady() || ui.tab === "messages") out.push([gid, "wallet"]);
  if (state.sid && state.wallet) out.push([gid, "pay:" + state.sid]);
  return out;
}

// A window that is visible but has no focus (open beside another app) is not being read.
const watching = () => document.visibilityState === "visible" && document.hasFocus();
const viewing = (gid, thread) => watching()
  && openThreads().some(([g, t]) => g === gid && t === thread);

// ponytail: the read mark is the time of the newest message from another seat that this browser
// showed. A sender clock behind another sender's clock can make its new messages count as read.
// A message dated more than MAX_SKEW ahead is shown but never counted. Upgrade path: seen ids.
function markRead() {
  if (!watching()) return;
  let changed = false;
  for (const [gid, thread] of openThreads()) {
    const mine = mineIn(gid);
    const theirs = countable(gid).filter((m) => m.thread === thread && !mine.includes(m.seat));
    const top = Math.max(0, ...theirs.map((m) => m.at));
    const k = markId(gid) + ":" + thread;
    if (top > (readMarks[k] || 0)) { readMarks[k] = top; changed = true; }
  }
  if (changed) saveMerged("zf-read", readMarks, Math.max);
}

// The first snapshot holds old messages; only later ones can notify.
function onMessages(gid, list) {
  const old = chat[gid];
  chat[gid] = list;
  if (!old) { seedMarks(markId(gid), list, chats.list[gid] ? "dm" : "wallet"); return; }
  const known = new Set(old.map((m) => m.id));
  const fresh = list.filter((m) => !known.has(m.id) && !viewing(gid, m.thread)
    && countUnread(countable(gid, [m]), mineIn(gid), readMarks, markId(gid)));
  if (fresh.length) notifyNew(gid, fresh);
}

// A new device, private window or Tor session has no read marks. It treats the history it finds
// as read, so old messages do not all show as unread. An empty first visit leaves a zero mark on
// the main thread, so messages that come before the next visit are unread.
function seedMarks(roomId, list, main) {
  if (!roomId || Object.keys(readMarks).some((k) => k.startsWith(roomId + ":"))) return;
  const now = Date.now();
  readMarks[roomId + ":" + main] = 0;
  for (const m of list) {
    const k = roomId + ":" + m.thread;
    readMarks[k] = Math.max(readMarks[k] || 0, Math.min(m.at, now));
  }
  saveMerged("zf-read", readMarks, Math.max);
}

// A notification cannot wait for the signature check. It names the contact only when every new
// message comes from the member id that this browser pinned for the contact.
function notifyTitle(gid, fresh) {
  if (!chats.list[gid]) return "New message in " + groupName(gid);
  return fresh.every((m) => m.from === contactOf(gid)) ? "New message from " + contactName(gid)
    : "New message in a chat";
}

function notifyNew(gid, fresh) {
  if (!ui.notify || !("Notification" in window) || Notification.permission !== "granted") return;
  try { new Notification(notifyTitle(gid, fresh), { tag: gid }); }
  catch (e) { log("could not show a notification: " + (e.message || e)); }
}

async function toggleNotify() {
  if (!ui.notify && (await Notification.requestPermission()) !== "granted") {
    throw new Error("This browser did not allow notifications. Change this in the site settings.");
  }
  ui.notify = !ui.notify;
  try { localStorage.setItem("zf-notify", ui.notify ? "1" : ""); } catch { /* no storage */ }
}

// ───────────────────────── Direct chats ─────────────────────────
// A direct chat is a store namespace of its own with two members (PROTOCOL.md 14). It has no
// wallet document, so it never lists as a wallet. One personal key, chats.profile, signs them all.
const chatPins = readLocal("zf-chatpins");   // "chat id:member id" -> first signing key seen
export const chatSubs = new Map(), chatMembers = {}, joinLinks = new Map();

const contactOf = (cid) => pinnedMembers(chatPins, cid).find((id) => id !== chats.list[cid].member);

function contactName(cid) {
  const members = chatMembers[cid], id = contactOf(cid);
  if (!members) return "Loading…";
  return id ? (members[id] || {}).name || "Your contact" : "Waiting for your contact";
}

function pinChat(cid, member, pk) {
  const r = pinMember(chatPins, cid, member, pk);
  if (r === "new") saveMerged("zf-chatpins", chatPins, oldest);
}

// ponytail: two tabs that make their first chat in the same instant can make two keys. Upgrade
// path: a lease on the store, as for seat keys.
async function ensureProfile() {
  if (!(await canSign())) throw new Error(NO_SIGNING);
  chats.profile ||= await newSignKey();
  return chats.profile;
}

function readMembers(cid) {
  return withTimeout(new Promise((res) => {
    const off = sdb.collection("groups/" + cid + "/members")
      .onSnapshot((snap) => { res(snap.docs); queueMicrotask(() => off()); });
  }), 10000, "The group server");
}

// The chat and the key are saved here before the member document goes to the server, so a failed
// save cannot leave a place taken that this browser does not know about.
async function enterChat(cid, key) {
  if (!storageOk) throw new Error("This browser cannot save data, so it cannot keep a chat.");
  const profile = await ensureProfile(), member = newRoom().id;
  chats.list[cid] = { key, member, at: Date.now() };
  if (!(await persist())) {
    delete chats.list[cid];
    throw new Error("Could not save the chat in this browser, so it was not opened.");
  }
  try {
    const name = user ? (await user.me()).name : "";
    await sdb.doc("groups/" + cid + "/members/" + member)
      .set({ name, signPk: profile.signPk, at: Date.now() });
  } catch (e) {
    delete chats.list[cid];
    await persist();
    throw e;
  }
  pinChat(cid, member, profile.signPk);
  openChat(cid);
}

const createChat = () => { const { id, key } = newRoom(); return enterChat(id, key); };

// The lease keeps two openers of one link apart. A chat holds two members. The link stays in
// joinLinks after a failure, so the person can try again; its secret is no longer in the URL.
async function joinChat(cid, key) {
  pendingChats[cid] = key;
  try {
    if (badChatLink(cid, key)) throw new Error(BAD_CONTACT_LINK);
    await ensureProfile();   // a browser without Ed25519 stops before it takes the second place
    const lease = await sdb.doc("groups/" + cid + "/meta/join")
      .acquire({ holder: crypto.randomUUID(), ttlMs: 10000 });
    const docs = await readMembers(cid);
    const blocked = joinBlock(docs.length, lease.acquired);
    if (blocked) throw new Error(blocked);
    onMembers(cid, docs);   // pins the first member before this browser becomes the second
    await enterChat(cid, key);
    joinLinks.delete(cid);
  } finally { delete pendingChats[cid]; }
}

async function leaveChat(cid) {
  const was = chats.list[cid];
  delete chats.list[cid];
  if (!(await persist())) {
    chats.list[cid] = was;
    throw new Error("Could not save this change in the browser, so the chat stays.");
  }
  for (const k of Object.keys(chatPins)) if (k.startsWith(cid + ":")) delete chatPins[k];
  writeLocal("zf-chatpins", chatPins);
  openChat(null);
}

function watchChats() {
  for (const [cid, off] of chatSubs) {
    if (chats.list[cid]) continue;
    off(); chatSubs.delete(cid); delete chat[cid]; delete chatMembers[cid];
  }
  if (state.cid && !chats.list[state.cid]) openChat(null);
  for (const cid of Object.keys(chats.list)) {
    if (!chatSubs.has(cid)) chatSubs.set(cid, subscribeChat(cid));
  }
}

function subscribeChat(cid) {
  const base = "groups/" + cid, fail = (e) => log("chat error: " + e.code);
  const offs = [
    sdb.collection(base + "/members").onSnapshot((snap) => {
      onMembers(cid, snap.docs); healMember(cid); render();
    }, fail),
    sdb.collection(base + "/messages").onSnapshot((snap) => {
      const list = snap.docs.map((d) => parseDm(d.id, d.data())).filter(Boolean);
      onMessages(cid, list.sort(byTime)); render();
    }, fail),
  ];
  return () => offs.forEach((off) => off());
}

function onMembers(cid, docs) {
  const members = {};
  for (const d of docs) {
    const x = d.data();
    const name = typeof x.name === "string" ? x.name.slice(0, 40) : "";
    members[d.id] = { name, signPk: x.signPk };
  }
  const mine = (chats.list[cid] || {}).member;
  for (const id of membersToPin(members, pinnedMembers(chatPins, cid), mine)) {
    pinChat(cid, id, members[id].signPk);
  }
  chatMembers[cid] = members;
}

// A chat saved while the connection dropped may lack this browser's member document. It is written
// again while the chat has room, so the contact can still join.
function healMember(cid) {
  const c = chats.list[cid], members = chatMembers[cid] || {};
  if (!c || members[c.member] || Object.keys(members).length >= 2) return;
  throttled("member:" + cid, async () => {
    const name = user ? (await user.me()).name : "";
    await sdb.doc("groups/" + cid + "/members/" + c.member)
      .set({ name, signPk: chats.profile.signPk, at: Date.now() });
  });
}

async function sendDm(cid, text) {
  const ref = sdb.collection("groups/" + cid + "/messages").doc();
  const m = { id: ref.id, from: chats.list[cid].member, at: Date.now(), text };
  const sig = await signMsg(chats.profile.signSk, dmText(cid, m));
  await withTimeout(ref.set({ from: m.from, text, at: m.at, sig }), 10000, "The group server");
}

// Like trust(), for a message of a chat. A sender that is not pinned is "unknown".
function dmTrust(cid, m) {
  const pk = chatPins[cid + ":" + m.from], member = (chatMembers[cid] || {})[m.from];
  if (pk === undefined) return "unknown";
  return verdict(m, dmText(cid, m), !!member, member && member.signPk, pk);
}

// ───────────────────────── Rendering ─────────────────────────
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "class") n.className = v;
    // Through the CSSOM, which the style-src policy allows; a style attribute it refuses.
    else if (k === "style") n.style.cssText = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return n;
};
// A success makes an earlier error message obsolete, so it is cleared.
// A disabled button loses focus, so the key of the focused control is kept to give it back.
export const act = (fn) => async (ev) => {
  ev.preventDefault();
  const b = ev.currentTarget, key = document.activeElement.dataset.key;
  if (b) b.disabled = true;
  try {
    await fn(ev);
    clearBadBanner();
  } catch (e) { showBanner("bad", e.message || String(e)); }
  finally {
    if (b) b.disabled = false;
    focusAfter(key, false);
    render(); react();
  }
};
function copyBtn(text, label = "Copy", cls = "btn sm") {
  const copy = async (ev) => {
    const b = ev.currentTarget;
    try {
      await navigator.clipboard.writeText(typeof text === "function" ? text() : text);
      b.textContent = "Copied";
    } catch { b.textContent = "Select and copy"; }
    setTimeout(() => b.textContent = label, 1500);
  };
  return el("button", { class: cls, type: "button", onclick: copy }, label);
}

// One bad document from another signer must not break the page: the item it feeds shows as a
// small unreadable card instead.
const unreadable = () =>
  el("div", { class: "bad-card" }, "This item has data this app cannot read.");
function guard(build, ...args) {
  try { return build(...args); }
  catch (e) { log("unreadable item: " + (e && e.message ? e.message : e)); return unreadable(); }
}

let openLayer = "", tickTimer = null;
export let opener = "", lastTrigger = "", wantFocus = null;   // focus bookkeeping, see draw()
function focusAfter(key, force) { wantFocus = key ? { key, force } : null; }
// ZIP 317 for a payment from up to `outputs` notes: one action per output, change included. A
// priority payment pays PRIORITY_FACTOR times as much (the engine's cap).
const PRIORITY_FACTOR = 10;
const feeEstimate = (payees, priority = false) =>
  5000 * Math.max(2, payees + 1) * (priority ? PRIORITY_FACTOR : 1);
const MAX_PAYEES = 20;
const TOO_MANY = "A payment can have at most " + MAX_PAYEES + " recipients.";
// The expected milliseconds from block `from` to block `to`, at the block time of each block (75
// seconds before NU7, 25 from it). The engine knows the upgrade heights of each network.
const spanMs = (net, from, to) => Z.blockSpanSeconds(net, from, to) * 1000;

// `sign` is "out" or "in" for money leaving or entering the wallet.
function money(zat, size = "md", sign = "") {
  if (!Number.isFinite(zat)) return el("span", { class: "money " + size }, "unknown");
  const [i, d] = ZEC_FMT.format(zat / 1e8).split(".");
  const pre = sign === "out" ? "−" : sign === "in" ? "+" : "";
  const text = pre + i + "." + (d || "00");
  // Screen readers get "12.50 ZEC" as one phrase; the visible unit is a separate, smaller span.
  const cls = "money " + size + (sign ? " " + sign : "");
  return el("span", { class: cls, role: "img", "aria-label": text + " ZEC" },
    text, el("span", { class: "cur", "aria-hidden": "true" }, "ZEC"));
}
function seatLabel(i) {
  const s = state.seats[i];
  if (!s) return "Open seat";
  if (!seatMine(i)) return s.name || "Signer " + i;
  return localSeats().length > 1 ? "You (seat " + i + ")" : "You";
}
// In a version 3 wallet a name comes with its seat number, because two seats can use one name.
// A member picks the name, so a name can carry a false seat number: the real one goes after it.
export function named(i) {
  const label = seatLabel(i);
  const tag = " (seat " + i + ")";
  return signedMode(state.gid) && !label.endsWith(tag) ? label + tag : label;
}
function avatar(i, cls = "") {
  const s = state.seats[i], mine = s && seatMine(i);
  return el("span", { class: "av round " + cls + (mine ? " me" : ""), title: seatLabel(i) }, s ? initials(mine ? (s.name || "You") : s.name || "M " + i) : "+");
}
const walletKey = () => state.wallet ? S(state.wallet) : "";
// This browser's own result for its seats; other seats' results come from the store.
export function seatCheck(i) {
  const s = localSeats().includes(i) ? sec(state.gid, i) : null;
  if (s) return s.checkedWallet === walletKey() ? true : s.rejectedWallet === walletKey() ? false : null;
  return state.verify[i] ? !!state.verify[i].ok : null;
}
const myVerified = () => localSeats().some((i) => seatCheck(i) === true);
const verifiedCount = () => seatIds().filter((i) => seatCheck(i) === true).length;
const rejectedSeats = () => seatIds().filter((i) => seatCheck(i) === false);
// A signer shows the address only after its own seat checked it against its key share.
const addrHidden = () => atCap() || (localSeats().length > 0 && !myVerified());
const curChain = () => chain && chain.gid === state.gid ? chain : null;

const STATUS = {
  collecting: ["Needs approval", "warn"], signing: ["Signing", "info"], signed: ["Ready to prove", "info"],
  proving: ["Building proof", "info"], complete: ["Ready to send", "ok"], broadcast: ["Sent", "ok"], failed: ["Failed", "bad"],
  cancelled: ["Cancelled", ""],
};
export function statusChip(s) {
  if (onChain(s)) return el("span", { class: "badge ok" }, "Sent");
  if (expired(s)) return el("span", { class: "badge" }, "Expired");
  const [t, c] = Object.hasOwn(STATUS, s.status) ? STATUS[s.status] : [String(s.status), ""];
  return el("span", { class: "badge " + c }, t);
}

// Payment wording. `who` comes from the engine: an address for the recipient, or a fixed phrase.
const OWN_OUTPUT = new Set(["this wallet", "change (back to this wallet)"]);
const isPayee = (l) => l.kind === "output" && !OWN_OUTPUT.has(l.who);
function payTitle(ss) {
  const p = payeesOf(ss);
  if (typeof ss.note === "string" && ss.note) return ss.note;
  if (p.length === 1) return "Payment to " + short(p[0].to, 8);
  return p.length ? "Payment to " + p.length + " recipients" : "Payment";
}
// What the proposer says leaves the wallet: the payees plus the fee.
const leavesOf = (ss) => Number.isFinite(ss.amount) ? ss.amount + finite(ss.fee) : NaN;
const ruleText = (t, n) => "Any " + t + " of " + n + " signers must approve each payment.";
export const groupName = (gid) => (state.groups.find((x) => x.id === gid) || {}).name || "the new wallet";
// In a version 3 wallet the proposer is the seat in `by`. Before, it is the identity in
// `createdBy`.
export const proposer = (ss) => Number.isInteger(ss.by)
  ? (localSeats().includes(ss.by) ? "you" : named(ss.by))
  : isMe(ss.createdBy) ? "you" : seatNameOf(ss.createdBy);
function normalized(addr) { try { return Z.normalizeAddress(addr); } catch { return null; } }
const onNetwork = (addr) => (normalized(addr) || "").startsWith(curNet().prefix);

// Sent payments that no synced block contains yet. Until one does, the synced balance still
// counts their inputs as unspent, so the app subtracts them itself.
export function inFlight() {
  const c = curChain();
  if (!c || !c.sent) return [];
  return state.sessions.filter((ss) => ss.broadcastTxid && ss.final
    && !c.sent.has(txidOf(ss) ?? ss.final.txid) && !expired(ss));
}
function balanceNow(b) {
  const out = inFlight(), sum = (f) => out.reduce((n, ss) => n + finite(f(ss)), 0);
  return {
    spendable: Math.max(0, b.spendable - sum((ss) => ss.noteValue)),
    pending: b.pending + sum((ss) => ss.change),
    sending: sum(leavesOf),
  };
}

export function sendBlocker() {
  const c = curChain();
  if (keysDiffer()) return "The signers hold different wallet keys. Do not use this wallet.";
  if (!localSeats().length) return "You hold no seat in this wallet.";
  if (!myVerified()) return "Your seat is still checking the wallet address.";
  if (!c || !c.bal) return "Wait for the first sync to finish.";
  // ponytail: the engine does not know about unmined spends and would pick the same notes again.
  if (inFlight().length) return "A payment is waiting for its block. Send again in a minute.";
  const b = balanceNow(c.bal);
  if (b.spendable > feeEstimate(1)) return null;
  if (b.pending) return "Incoming funds need 3 confirmations first.";
  return b.spendable ? "The balance does not cover the network fee." : "This wallet has no funds yet.";
}

// Draws once per frame, however many changes arrive together. A hidden tab gets no frames, so a
// timer backs it up and the tab title still shows the approvals.
let drawPending = false, composing = false;
export function render() {
  if (drawPending) return;
  drawPending = true;
  // A redraw replaces the text box and ends an IME composition, so it waits until the end.
  const run = () => { if (drawPending && !composing) { drawPending = false; draw(); } };
  requestAnimationFrame(run);
  setTimeout(run, 120);
}

const FOCUSABLE = "button, a[href], input, select, textarea, summary";
// A rebuilt control is a new element. A key from its label (or an explicit data-key) lets focus
// find it again; equal labels get a number.
function keyControls(root) {
  const seen = new Map();
  for (const n of root.querySelectorAll(FOCUSABLE)) {
    if (n.dataset.key) continue;
    const base = n.tagName + ":" + controlLabel(n), count = seen.get(base) || 0;
    seen.set(base, count + 1);
    n.dataset.key = base + ":" + count;
  }
}

function controlLabel(n) {
  const text = n.textContent.trim().slice(0, 40);
  return n.id || n.getAttribute("aria-label") || n.name || text || n.type;
}
const controlByKey = (root, key) =>
  [...root.querySelectorAll("[data-key]")].find((n) => n.dataset.key === key);

function focusSnapshot(root) {
  const a = document.activeElement;
  if (!a || !root.contains(a) || !a.dataset.key) return null;
  const snap = { key: a.dataset.key };
  try {
    snap.sel = [a.selectionStart, a.selectionEnd, a.selectionDirection];
  } catch { /* not a text control */ }
  return snap;
}

// `wantFocus.force` wins over the old focus (arrow keys in tabs, the opener of a closed layer).
function restoreFocus(root, snap) {
  const want = wantFocus; wantFocus = null;
  const key = want && (want.force || !snap) ? want.key : snap && snap.key;
  const n = key && controlByKey(root, key);
  if (!n) return;
  n.focus({ preventScroll: true });
  if (snap && snap.key === key) restoreSelection(n, snap.sel);
}

function restoreSelection(n, sel) {
  if (!sel || sel[0] == null) return;
  try { n.setSelectionRange(...sel); } catch { /* not a text control */ }
}

function focusLayer(layer) {
  layer.tabIndex = -1;
  const pick = layer.classList.contains("drawer") ? ".icon-btn" : "input, button.btn";
  (layer.querySelector(pick) || layer).focus();
}

// The page behind a dialog or the drawer cannot take focus or clicks while the layer is open.
function setModal(view, on) {
  view.toggleAttribute("inert", on);
  document.querySelector(".side").toggleAttribute("inert", on);
}

const appFoot = () => el("footer", { class: "app-foot" }, "Beta · not audited · ",
  el("a", { href: "https://zigs.app", target: "_blank", rel: "noopener" }, "About Zigs"));

// The page when no wallet is open: a direct chat, a contact on chain, or the wallet list.
export const mainView = () => (state.cid ? chatView() : state.contact != null ? contactView() : lobby());

function pageView() {
  try {
    if (lockedVault) return lockView();
    if (!dbReady) return loadingView();
    return state.gid ? groupView() : mainView();
  } catch (e) {
    log("unreadable page: " + (e && e.message ? e.message : e));
    const back = el("button", {
      class: "btn ghost sm", type: "button", onclick: () => openGroup(null),
    }, "← Wallets");
    return el("div", { class: "page" }, back,
      el("div", { class: "card empty" }, el("h3", {}, "This wallet has data this app cannot read"),
        el("p", { class: "small" }, "Another signer may use a newer version of Zigs. "
          + "Reload the page, or ask them.")));
  }
}

export function draw() {
  const shell = document.querySelector(".shell"), app = document.getElementById("app");
  const snap = focusSnapshot(shell);
  markRead();
  renderSide();
  const pending = state.groups.reduce((n, g) => n + toApprove(g.id).length + unreadIn(g.id), 0)
    + Object.keys(chats.list).reduce((n, cid) => n + unreadIn(cid), 0);
  document.title = pending ? "(" + pending + ") Zigs" : "Zigs";
  const form = saveFormState(app);
  const view = pageView(), top = lockedVault ? [] : layers();
  if (typingMessage(app, [view, ...top])) return;
  app.replaceChildren(view, ...top, appFoot());
  keyControls(shell);
  setModal(view, top.length > 0);
  const entered = trackLayer(top);
  clearTimeout(tickTimer);
  const ss = curSession();
  if (ss && ss.status === "proving") tickTimer = setTimeout(render, 1000);
  restoreFormState(app, form);
  if (entered) focusLayer(top[1]); else restoreFocus(shell, snap);
}

// Rebuilding a focused text box closes a phone's keyboard. While a message box or a field of the
// request form has focus, only the message logs update; the whole page redraws when it loses focus.
// A field of the request form counts only while its form is open: after a send, the form must go.
const typingIn = (box) => !!box && (box.id.startsWith("chat-text-") || box.id === "fund-amt"
  || (!!ui.request && /^req-(amt|memo)-/.test(box.id)));
export function typingMessage(app, parts) {
  const box = document.activeElement;
  if (!typingIn(box) || !app.contains(box)) return false;
  const logs = saveLogs(app);
  for (const old of app.querySelectorAll(".chat-log")) {
    const fresh = parts.map((p) => p && p.querySelector("#" + old.id)).find(Boolean);
    if (!fresh) continue;
    old.replaceWith(fresh);
    fresh.scrollTop = logs[fresh.id] ?? fresh.scrollHeight;
  }
  if (!box.dataset.redraw) {
    box.dataset.redraw = "1";
    box.addEventListener("focusout", () => render(), { once: true });
  }
  return true;
}

// Keep what the viewer is typing, open <details>, and the drawer scroll across live updates.
function saveFormState(app) {
  const values = {};
  for (const i of app.querySelectorAll("input[id], select[id], textarea[id]")) {
    if (i.type !== "file") values[i.id] = i.value;
  }
  const open = new Set([...app.querySelectorAll("details[open] > summary")].map((x) => x.textContent));
  const scroll = app.querySelector(".drawer-body")?.scrollTop || 0;
  const tabs = app.querySelector(".tabs")?.scrollLeft || 0;
  return { values, open, logs: saveLogs(app), scroll, tabs };
}

// A message log that was at its end stays at its end; otherwise it keeps its place.
function saveLogs(app) {
  const logs = {};
  for (const l of app.querySelectorAll(".chat-log")) {
    logs[l.id] = l.scrollHeight - l.scrollTop - l.clientHeight < 24 ? null : l.scrollTop;
  }
  return logs;
}

function restoreFormState(app, form) {
  for (const [id, v] of Object.entries(form.values)) {
    const i = document.getElementById(id);
    if (!i) continue;
    i.value = v;
    i.dispatchEvent(new Event("input", { bubbles: true }));
  }
  for (const x of app.querySelectorAll("details > summary")) {
    if (form.open.has(x.textContent)) x.parentElement.open = true;
  }
  restoreScroll(app, form);
}

function restoreScroll(app, form) {
  const body = app.querySelector(".drawer-body"), tabs = app.querySelector(".tabs");
  if (body) body.scrollTop = form.scroll;
  if (tabs) tabs.scrollLeft = form.tabs;
  for (const l of app.querySelectorAll(".chat-log")) {
    l.scrollTop = form.logs[l.id] ?? l.scrollHeight;
  }
}

// Remembers which control opened a layer, and asks for it back when the layer closes. Returns true
// when a new layer just opened.
function trackLayer(top) {
  const layer = top[1];
  const key = layer ? layer.getAttribute("aria-labelledby") || layer.getAttribute("aria-label") : "";
  if (key && !openLayer) { opener = lastTrigger; lastTrigger = ""; }
  if (!key && openLayer && opener) { wantFocus = { key: opener, force: true }; opener = ""; }
  const entered = !!key && key !== openLayer;
  openLayer = key;
  return entered;
}

// The control that opened a layer gets focus back when the layer closes.
document.addEventListener("click", (ev) => {
  const n = ev.target.closest && ev.target.closest(FOCUSABLE);
  if (n && n.dataset.key && !n.closest(".dialog, .drawer")) lastTrigger = n.dataset.key;
}, true);

export function layers() {
  try { return ui.newChat ? [scrim(() => ui.newChat = false), newChatDialog()] : buildLayers(); }
  catch (e) { log("unreadable layer: " + (e && e.message ? e.message : e)); return []; }
}

const scrim = (close) => el("div", { class: "scrim", onclick: () => { close(); render(); } });

// The dialogs, in the order that they take the screen: [is shown, close, build]. `open` is true in
// an open wallet that has its wallet document. A restore starts in the wallet list.
const DIALOGS = [
  [() => ui.restore, closeBackup, () => restoreDialog()],
  [(open) => ui.backup && (open || ui.backup.personal), closeBackup, () => backupDialog()],
  [(open) => ui.send && open, () => ui.send = false, () => sendDialog()],
  [(open) => ui.receive && open, () => ui.receive = false, () => receiveDialog()],
  [() => ui.create && !state.gid, () => ui.create = false, () => createDialog()],
  [() => ui.contactAdd && !!personal, () => ui.contactAdd = false, () => contactDialog()],
  [(open) => ui.move && open, () => ui.move = false, () => createDialog(state.g)],
];

function buildLayers() {
  const ss = state.gid && state.wallet ? curSession() : null;
  if (ss) return [scrim(closeSession), sessionLayer(ss)];
  const open = state.gid && state.wallet;
  const dialog = DIALOGS.find(([shown]) => shown(open));
  return dialog ? [scrim(dialog[1]), dialog[2]()] : [];
}

function renderSide() {
  const nav = document.getElementById("side-nav");
  const newWallet = () => { openGroup(null); ui.create = true; render(); };
  nav.replaceChildren(
    el("div", { class: "side-head" }, el("span", { class: "label" }, "Wallets"),
      el("button", { class: "icon-btn", type: "button", title: "New wallet", "aria-label": "New wallet", onclick: newWallet }, "+")),
    ...(state.groups.length ? state.groups.map((g) => guard(sideItem, g))
      : [el("p", { class: "side-empty" }, sideEmpty())]),
    el("div", { class: "side-head" }, el("span", { class: "label" }, "Chats"),
      el("button", { class: "icon-btn", type: "button", title: "New chat", "aria-label": "New chat",
      onclick: newChat }, "+")),
    ...Object.keys(chats.list).map((cid) => guard(chatItem, cid)),
    ...(personal ? [el("div", { class: "side-head" }, el("span", { class: "label" }, "On chain"),
      el("button", { class: "icon-btn", type: "button", title: "Add contact",
        "aria-label": "Add contact", onclick: openContactDialog }, "+")),
    ...personal.contacts.map((c) => guard(contactItem, c))] : []));
}

const newChat = () => { ui.newChat = true; render(); };

const unreadChip = (u) => u ? el("span", { class: "side-unread", role: "img", title: u + " unread",
  "aria-label": u + " unread" }, String(u)) : null;

function chatItem(cid) {
  const here = cid === state.cid, name = contactName(cid);
  return el("button", {
    class: "side-item" + (here ? " active" : ""), type: "button",
    "aria-current": here ? "page" : null, "data-key": "chat-" + cid, onclick: () => openChat(cid),
  }, el("span", { class: "av" }, initials(contactOf(cid) ? name : "")),
  el("span", { class: "side-name" }, name),
  el("span", { class: "side-tail" }, unreadChip(unreadIn(cid))));
}

const sideEmpty = () => lockedVault ? "Locked." : dbReady ? "No wallets yet." : "Connecting…";

function sideItem(g) {
  const n = toApprove(g.id).length, u = unreadIn(g.id), here = g.id === state.gid;
  const tail = n
    ? el("span", { class: "side-count", role: "img", title: n + " to approve",
      "aria-label": n + " to approve" }, String(n))
    : el("span", { class: "side-meta", title: ruleText(g.t, g.n) },
      g.movedTo ? "Moved" : g.t + " of " + g.n);
  const unread = unreadChip(u);
  return el("button", {
    class: "side-item" + (here ? " active" : ""), type: "button",
    "aria-current": here ? "page" : null, "data-key": "wallet-" + g.id,
    onclick: () => { ui.tab = "overview"; openGroup(g.id); },
  }, el("span", { class: "av" }, initials(g.name)),
  el("span", { class: "side-name" }, g.name), el("span", { class: "side-tail" }, unread, tail));
}

export function forgetBox() {
  const cancel = () => { ui.forget = false; render(); };
  return el("div", { class: "callout bad" },
    el("p", {}, "Without the passkey, the key shares in this browser cannot be opened. Delete "
      + "them, then restore each seat from its backup file. A seat with no backup is lost, but "
      + "the wallet still works while enough other signers remain. Direct chats in this browser "
      + "are deleted too. They are not in backup files, and a chat with two people cannot be "
      + "joined again. The personal account is deleted as well. Only its backup file brings it "
      + "back, and without one its money is lost."),
    el("div", { class: "dialog-actions" },
      el("button", { class: "btn", type: "button", onclick: cancel }, "Cancel"),
      el("button", { class: "btn", type: "button", onclick: forgetVault },
        "Delete the locked keys")));
}

function lockView() {
  const ask = () => { ui.forget = true; render(); };
  const text = lockedVault.damaged
    ? "The locked keys in this browser are damaged and cannot be opened."
    : "The key shares in this browser are encrypted with your passkey. "
      + "Unlock with Face ID, Touch ID or your security key.";
  return el("div", { class: "card empty" }, el("h3", {}, "Zigs is locked"),
    el("p", { class: "small" }, text),
    lockedVault.damaged ? null
      : el("button", {
        class: "btn primary", type: "button", disabled: !engineSettled, onclick: act(unlockVault),
      }, "Unlock"),
    ui.forget ? forgetBox()
      : el("button", { class: "btn ghost sm", type: "button", onclick: ask }, "Lost the passkey?"));
}

function lockButton() {
  if (vault) {
    return el("button", { class: "btn", type: "button", onclick: () => location.reload(),
      title: "Encrypted with your passkey. Reload to lock the page." }, "Lock now");
  }
  const can = storageOk && !!window.PublicKeyCredential;
  return el("button", { class: "btn", type: "button", disabled: !can, onclick: act(lockWithPasskey),
    title: can ? "Encrypt the key shares and the personal account in this browser with a passkey"
      : "This browser has no passkey support" }, "Lock with a passkey");
}

function loadingView() {
  return el("div", { class: "card empty" }, el("span", { class: "dot busy" }),
    el("h3", {}, Z ? "Connecting to the group server" : "Loading the crypto engine"),
    el("p", { class: "small" }, "Your wallets appear in a moment."));
}

// ── Lobby ──
function lobby() {
  const restoreInput = el("input", {
    id: "restore", type: "file", accept: ".zigsbackup,.json,application/json", hidden: true,
    onchange: (ev) => {
      const file = ev.target.files[0];
      ev.target.value = "";
      if (file) restore(file);
    },
  });
  const restoreBtn = (cls) => el("button", {
    class: cls, type: "button", onclick: () => restoreInput.click(),
  }, "Restore from backup");
  const canCreate = Z && db && canWrite !== false;
  const actions = lobbyActions(canCreate, restoreBtn("btn"));
  const head = el("header", { class: "page-head" },
    el("div", { class: "ph-left" }, el("h1", {}, "Wallets"),
      el("p", { class: "muted" }, "Each wallet is a separate shared account, with its own address, "
        + "signers and approval rule.")),
    actions.length ? el("div", { class: "ph-actions" }, ...actions) : null);
  const rows = state.groups.map((g) => guard(walletRow, g));
  const body = state.groups.length
    ? el("section", { class: "card" }, el("div", { class: "list" }, rows))
    : welcome(canCreate, restoreBtn("btn ghost sm"));
  const joins = [...joinLinks.keys()].map((cid) => guard(chatJoinCard, cid));
  return el("div", { class: "page" }, ...joins, head, body, chatsCard(),
    guard(personalCard, () => restoreInput.click()), guard(contactsCard), restoreInput);
}

// A contact link waits here until the person clicks Join. The link is kept after a failure.
function chatJoinCard(cid) {
  const key = "chatjoin:" + cid, joining = busy.has(key);
  const join = (ev) => {
    ev.preventDefault();
    once(key, () => joinChat(cid, joinLinks.get(cid)));
    render();
  };
  return el("form", { class: "card card-pad hero-card", onsubmit: join },
    el("div", { class: "card-head" }, el("h2", {}, "Join a chat")),
    el("p", { class: "small muted" }, "Someone sent you a contact link. A chat holds two people. "
      + "Your contact sees the name below."),
    nameField("chat-join-" + cid, "your contact"),
    el("div", { class: "dialog-actions" },
      el("button", { class: "btn", type: "button", disabled: joining,
        onclick: () => { joinLinks.delete(cid); render(); } }, "Cancel"),
      el("button", { class: "btn primary", type: "submit",
        disabled: joining || !Z || !db || canWrite === false },
      joining ? "Joining the chat…" : "Join chat")));
}

// The sidebar is hidden on a phone, so the chats are listed here too.
function chatsCard() {
  const ids = Object.keys(chats.list);
  return el("section", { class: "card" },
    el("div", { class: "card-head card-pad", style: "padding-bottom:12px" }, el("h2", {}, "Chats"),
      el("button", { class: "btn sm", type: "button", disabled: !Z || !db || canWrite === false,
        onclick: newChat }, "New chat")),
    ids.length ? el("div", { class: "list", style: "border-top:1px solid var(--line)" },
      ids.map((cid) => guard(chatRow, cid)))
      : el("p", { class: "small muted card-pad" }, "Write to one person who uses Zigs."));
}

function chatRow(cid) {
  const name = contactName(cid);
  return el("button", {
    class: "row-item", type: "button", "data-key": "chat-row-" + cid, onclick: () => openChat(cid),
  },
  el("span", { class: "av lg" }, initials(contactOf(cid) ? name : "")),
  el("span", { class: "ri-main" }, el("span", { class: "ri-title" }, name),
    el("span", { class: "ri-sub" }, "Direct chat · group server")),
  el("span", { class: "ri-end" }, newBadge(unreadIn(cid))),
  el("span", { class: "chev" }, "›"));
}

// With no wallet yet, the welcome card has the only actions. Locking waits until there is a wallet
// or a key share to lock.
function lobbyActions(canCreate, restoreBtn) {
  const newBtn = el("button", {
    class: "btn primary", type: "button", disabled: !canCreate,
    onclick: () => { ui.create = true; render(); },
  }, "New wallet");
  if (state.groups.length) return [lockButton(), restoreBtn, newBtn];
  return Object.keys(secrets).length || vault ? [lockButton()] : [];
}

function walletRow(g) {
  if (g.unreadable) return unreadable();
  const seats = mySeatSecrets(g.id).length, n = toApprove(g.id).length, bal = balOf(g.id);
  const unread = newBadge(unreadIn(g.id));
  const status = g.movedTo ? el("span", { class: "badge plain" }, "Moved")
    : ready[g.id] === false ? el("span", { class: "badge info" }, "Setting up")
    : bal ? money(bal.total) : el("span", { class: "small faint" }, "Open to sync");
  return el("button", {
    class: "row-item", type: "button", "data-key": "wallet-row-" + g.id,
    onclick: () => { ui.tab = "overview"; openGroup(g.id); },
  },
  el("span", { class: "av lg" }, initials(g.name)),
  el("span", { class: "ri-main" }, el("span", { class: "ri-title" }, g.name),
    el("span", { class: "ri-sub" }, netOf(g).label + " · " + g.t + " of " + g.n
      + " signers must approve" + (seats ? "" : " · view only"))),
  el("span", { class: "ri-end" }, status,
    n ? el("span", { class: "badge warn" }, n + " to approve") : null, unread),
  el("span", { class: "chev" }, "›"));
}

function welcome(canCreate, restoreLink) {
  const steps = [
    ["Pick a rule", "For example, any 2 of 3 signers must approve each payment."],
    ["Invite your signers", "Send one private invite link. Each device creates its own key share."],
    ["Approve together", "A payment goes out only after enough signers approve. On chain it looks "
      + "like a shielded payment from a standard wallet."],
  ];
  const create = el("button", {
    class: "btn primary lg", type: "button", disabled: !canCreate,
    onclick: () => { ui.create = true; render(); },
  }, "Create wallet");
  return el("section", { class: "card card-pad welcome" },
    el("div", { style: "display:grid;gap:6px" }, el("h2", {}, "Create your first shared wallet"),
      el("p", { class: "muted" }, "Nobody ever holds the whole key, and nobody outside your team "
        + "can read the wallet.")),
    el("ol", { class: "how" }, steps.map(([t, d], i) => el("li", {},
      el("span", { class: "how-no" }, String(i + 1)),
      el("div", { style: "display:grid;gap:2px" }, el("h3", {}, t), el("p", { class: "small muted" }, d))))),
    el("div", { style: "display:flex;align-items:center;gap:12px;flex-wrap:wrap" },
      create, restoreLink));
}

// The name that `to` sees (your signers, or your contact); saved in this browser and read when you
// take a seat or join a chat.
function nameField(id, to = "your signers") {
  let saved = ""; try { saved = localStorage.getItem("zf-name") || ""; } catch {}
  const save = (ev) => { try { localStorage.setItem("zf-name", ev.target.value.trim()); } catch {} };
  return el("label", { class: "field" }, el("span", {}, "Your name"),
    el("input", { class: "input", id, value: saved, maxlength: "40", autocomplete: "nickname", placeholder: "Any nickname · shown to " + to, oninput: save }));
}

// With `from`, the dialog creates the wallet that replaces `from`, with new signers or a new rule.
function createDialog(from = null) {
  const close = () => { ui.create = false; ui.move = false; render(); };
  const n0 = from ? from.n : 3, t0 = from ? from.t : 2;
  const rule = el("p", { class: "rule", id: "rule-text" }, ruleText(t0, n0));
  const update = () => {
    const n = Number(document.getElementById("g-n")?.value), t = Number(document.getElementById("g-t")?.value);
    const ok = n >= 2 && n <= 7 && t >= 2 && t <= n;
    rule.textContent = ok ? ruleText(t, n) : "Choose 2 to 7 signers, and at least 2 approvals but no more than the signers.";
    rule.classList.toggle("bad", !ok);
  };
  const f = el("form", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "create-title", oninput: update, onsubmit: act(async (ev) => {
    const fd = new FormData(ev.target); const n = Number(fd.get("n")), t = Number(fd.get("t"));
    if (!(n >= 2 && n <= 7)) throw new Error("A wallet needs between 2 and 7 signers.");
    if (t < 2 || t > n) throw new Error("Approvals needed must be at least 2 and at most the number of signers.");
    // A replacement wallet stays on its predecessor's network: funds cannot move between networks.
    const network = from ? from.network || "testnet" : ui.net;
    if (network === "mainnet" && !ui.ack) throw new Error("Confirm that you understand Zigs is not audited before you create a mainnet wallet.");
    ui.create = false; ui.move = false; ui.net = "testnet"; ui.ack = false;
    await createGroup(String(fd.get("name") || "").trim() || (from ? from.name : "Treasury"), n, t, from && from.id, network);
  }) },
    el("div", { class: "card-head" }, el("h2", { id: "create-title" }, from ? "Change signers" : "New shared wallet"), el("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: close }, "×")),
    from ? el("ol", { class: "small muted move-steps" },
      el("li", {}, "You create a new wallet with the signers and rule you want."),
      el("li", {}, "The new signers join it with an invite link."),
      el("li", {}, "This wallet sends all its funds to the new one. Like any payment, this needs " + from.t + " approvals.")) : null,
    nameField("my-name"),
    el("label", { class: "field" }, el("span", {}, from ? "New wallet name" : "Wallet name"), el("input", { class: "input", id: "g-name", name: "name", placeholder: from ? from.name : "Team treasury", maxlength: "40", autocomplete: "off" })),
    el("div", { class: "two" },
      el("label", { class: "field" }, el("span", {}, "Signers"), el("input", { class: "input", id: "g-n", name: "n", type: "number", min: "2", max: "7", value: String(n0) })),
      el("label", { class: "field" }, el("span", {}, "Approvals needed"), el("input", { class: "input", id: "g-t", name: "t", type: "number", min: "2", max: "7", value: String(t0) }))),
    rule,
    from ? null : networkPick(),
    el("div", { class: "callout" }, from
      ? "The new wallet gets a new address. Signers you leave out can still see this old wallet's payments, but not the new wallet's."
      : "You take seat 1. Then share the invite link with your signers. When every seat is taken, your devices create the wallet key together."),
    el("div", { class: "dialog-actions" },
      el("button", { class: "btn", type: "button", onclick: close }, "Cancel"),
      el("button", { class: "btn primary", type: "submit", disabled: !Z || !db || canWrite === false }, from ? "Create new wallet" : "Create wallet")));
  return f;
}

// The choice lives in `sel` (`ui`, or `ui.personal`), so a redraw keeps it. `what` names the thing
// that holds the funds, and `idp` prefixes the ids.
function networkPick(sel = ui, what = "wallet", idp = "g") {
  const on = (value) => (sel.net === value ? " on" : "");
  const opt = (value, title, text) => el("label", { class: "net-opt" + on(value) },
    el("input", { type: "radio", name: idp + "-network", value, id: idp + "-net-" + value,
      checked: sel.net === value, onchange: () => { sel.net = value; render(); } }),
    el("span", { class: "net-text" }, el("b", {}, title), el("span", { class: "small muted" }, text)));
  return el("fieldset", { class: "net-pick" },
    el("legend", { class: "label" }, "Network"),
    el("div", { class: "two" },
      opt("testnet", "Testnet", "Free test coins, for trying Zigs."),
      opt("mainnet", "Mainnet", "Real ZEC. At " + capText(NETWORKS.mainnet.cap)
        + " the app warns and hides the address. It cannot block deposits.")),
    sel.net === "mainnet" ? el("label", { class: "ack" },
      el("input", { type: "checkbox", id: idp + "-ack", checked: sel.ack,
        onchange: (ev) => { sel.ack = ev.target.checked; } }),
      el("span", { class: "small" }, "I understand that Zigs is not audited and that I can lose "
        + "the funds in this " + what + ".")) : null);
}

// ── Wallet ──
export function groupView() {
  const g = state.g;
  const back = el("button", {
    class: "btn ghost sm", type: "button", onclick: () => openGroup(null),
  }, "← Wallets");
  if (!g) return el("div", { class: "page" }, back, loadingView());
  if (g.unreadable) {
    return el("div", { class: "page" }, back, el("div", { class: "card" }, unreadable()));
  }
  if (!groupVersion()) {
    return el("div", { class: "page" }, back, el("div", { class: "callout bad", role: "alert" },
      "A newer version of Zigs made this wallet. This version cannot set it up. Reload the page "
      + "to get the newest version."));
  }
  if (signedMode(state.gid) && signing === false) {
    return el("div", { class: "page" }, back, el("div", { class: "callout bad", role: "alert" },
      NO_SIGNING_WALLET));
  }
  const ready = walletReady();
  const why = ready ? sendBlocker() : null;
  const head = [groupHead(g, ready, why), staleRestoreNote(), signedNotes(), networkNote()];
  return ready ? walletView(head, why) : el("div", { class: "page" }, head, setupView());
}

// A note for any wallet version: the store shows another network than the first this device saw.
const networkNote = () => state.g.networkMoved ? el("div", { class: "callout bad", role: "alert" },
  "The store shows another network than the first this browser saw. Zigs keeps the first. "
  + "Ask your signers.") : null;

const NO_SIGNING_WALLET = "This wallet needs signatures, and this browser cannot check them. "
  + "Use a current Chrome, Edge, Firefox or Safari.";

// Notes for a version 3 wallet: a seat of this browser that cannot sign, and ignored data.
function signedNotes() {
  if (!signedMode(state.gid)) return null;
  const mute = localSeats().filter((i) => !canWriteAs(i));
  const lost = mute.length ? el("div", { class: "callout bad", role: "alert" },
    "This browser has no signing key for seat " + mute.join(", ") + ", so it cannot write to "
    + "this wallet. Restore a backup of the seat.") : null;
  const moved = state.g.shapeMoved ? el("div", { class: "callout bad", role: "alert" },
    "The store shows another number of signers or approval rule than the first this browser saw. "
    + "Zigs keeps the first. Ask your signers.") : null;
  const ignored = state.ignored ? el("p", { class: "small faint" }, IGNORED_NOTE) : null;
  return lost || moved || ignored
    ? el("div", { style: "display:grid;gap:8px" }, lost, moved, ignored) : null;
}

const walletReady = () => !!(state.wallet && state.wallet.birthday)
  && rejectedSeats().length === 0 && !keysDiffer();

export function walletView(head, why) {
  const unsaved = localSeats().filter((i) => {
    const s = sec(state.gid, i);
    return s.keyPackage && !seatBackedUp(s);
  });
  const tabs = [
    ["overview", "Overview"],
    ["activity", "Activity", countBadge(toApprove(state.gid).length, "to approve", "attn")],
    ["messages", "Messages", countBadge(unreadIn(state.gid), "unread", "note")],
    ["members", "Signers"], ["details", "Details"],
  ];
  const bodies = {
    overview: overviewTab, activity: activityTab, messages: messagesCard, members: membersTab,
    details: detailsTab,
  };
  if (solOn()) { tabs.push(["solana", "Solana"]); bodies.solana = solTab; }
  if (!Object.hasOwn(bodies, ui.tab)) ui.tab = "overview";
  return el("div", { class: "page" }, head, tabBar(tabs),
    unsaved.length ? backupNote(unsaved) : null,
    el("div", { role: "tabpanel", id: "panel-" + ui.tab, "aria-labelledby": "tab-" + ui.tab },
      bodies[ui.tab]()),
    el("div", { class: "action-bar" }, ...walletActions(why)));
}

function groupHead(g, ready, why) {
  const seated = seatIds().filter((i) => state.seats[i]).length;
  const old = state.groups.find((x) => x.id === g.movedFrom);
  return el("header", { class: "page-head" },
    el("div", { class: "ph-left" },
      el("button", { class: "btn ghost sm back", type: "button", onclick: () => openGroup(null) },
        "← Wallets"),
      el("h1", {}, g.name),
      el("div", { class: "ph-meta" },
        netBadge(g),
        el("span", { class: "badge plain", title: ruleText(g.t, g.n) },
          g.t + " of " + g.n + " signers must approve"),
        el("span", { class: "stack" }, seatIds().map((i) => avatar(i))),
        el("span", {}, seated + " of " + g.n + " signers joined"),
        g.movedFrom
          ? el("span", {}, "Replaces " + ((old || {}).name || "an older wallet")) : null)),
    ready ? el("div", { class: "ph-actions wallet-actions" }, ...walletActions(why)) : null);
}

const countBadge = (n, what, cls) => n
  ? el("span", { class: "count " + cls, role: "img", "aria-label": n + " " + what }, n) : null;

// Arrow keys, Home and End move between tabs. Only the selected tab is in the Tab order.
export function tabBar(tabs) {
  const ids = tabs.map(([id]) => id), last = ids.length - 1, at = ids.indexOf(ui.tab);
  const target = {
    ArrowRight: at >= last ? 0 : at + 1, ArrowLeft: at <= 0 ? last : at - 1, Home: 0, End: last,
  };
  const onkeydown = (ev) => {
    if (!(ev.key in target)) return;
    ev.preventDefault();
    ui.tab = ids[target[ev.key]];
    focusAfter("tab-" + ui.tab, true);
    render();
  };
  const tab = ([id, label, badge]) => el("button", {
    class: "tab", type: "button", role: "tab", id: "tab-" + id, "data-key": "tab-" + id,
    "aria-selected": ui.tab === id ? "true" : "false",
    "aria-controls": ui.tab === id ? "panel-" + id : null,
    tabindex: ui.tab === id ? "0" : "-1", onclick: () => { ui.tab = id; render(); },
  }, label, badge);
  return el("div", { class: "tabs", role: "tablist", "aria-label": "Wallet sections", onkeydown },
    tabs.map(tab));
}
export function setTabBar(f) { tabBar = f; }

// Private windows, Tor Browser and cleared site data delete the key share with the browser data.
export function backupNote(seats) {
  const text = "Back up your key share. This browser can forget it: private windows and Tor "
    + "Browser delete it when they close. The file is locked with a passphrase that you choose. "
    + "Keep the file safe, and keep the passphrase apart from it. " + BACKUP_CHANGED;
  return el("div", { class: "callout warn", role: "status" },
    el("span", { style: "flex:1 1 16rem" }, text),
    seats.map((i) => el("button", {
      class: "btn sm", type: "button", onclick: () => openBackup(i),
    }, seats.length > 1 ? "Back up seat " + i : "Back up key share")));
}

// `why` is the reason Send is off, shown as text because touch screens have no tooltip.
function walletActions(why) {
  return [
    el("button", { class: "btn", type: "button", onclick: () => { ui.receive = true; render(); } }, "Receive"),
    el("button", {
      class: "btn primary", type: "button", disabled: !!why, title: why,
      onclick: () => {
        Object.assign(ui, { send: true, pay: null, note: "", priority: false, sendFor: null });
        render();
      },
    }, "Send"),
    why ? el("p", { class: "send-why" }, why) : null,
  ];
}

// ── Setup (key ceremony) ──
function setupView() {
  const open = seatIds().filter((i) => !state.seats[i]);
  const top = !localSeats().length && open.length ? joinCard(open[0])
    : open.length ? inviteCard(open.length) : null;
  const split = keysDiffer() ? el("div", { class: "callout bad", role: "alert" },
    "The signers made different wallet keys, so this wallet is not safe to use. "
    + "Do not send funds to it. Create a new wallet.") : null;
  const stopped = abortedText();
  return el("div", { class: "page", style: "gap:16px" }, split,
    stopped ? el("div", { class: "callout bad", role: "alert" }, stopped) : null,
    saveFailedCard(), top, safetyCard(),
    el("div", { class: "setup" }, progressCard(), seatsCard(open)),
    localSeats().length ? messagesCard() : null);
}

// Version 2 wallets: the signers compare one number before the key ceremony starts. It stays
// visible until every seat holds its key share.
const safetyOpen = () => usesV2(groupVersion()) && allSeated() && !allDone() && !holdsAllSeats();

// The person fixes the cause, then tries again. The reactor does not retry a failed save.
function saveFailedCard() {
  if (![...saveFailed].some((k) => k.startsWith(state.gid + ":"))) return null;
  const again = () => { saveFailed.clear(); render(); react(); };
  return el("div", { class: "callout bad", role: "alert" },
    el("span", { style: "flex:1 1 16rem" }, SAVE_FAILED),
    el("button", { class: "btn sm", type: "button", onclick: again }, "Try again"));
}

function safetyCard() {
  if (!safetyOpen() || abortedText()) return null;
  const no = safetyNo(), n = state.g.n;
  if (!no) {
    return el("div", { class: "callout bad", role: "alert" },
      "A seat holds a key that this app cannot read. Do not use this wallet. Create a new wallet.");
  }
  const yes = confirmedBy(no).length, clash = numberClash(no, state.confirm, seatIds());
  const todo = confirmSeatsOf().filter((i) => sec(state.gid, i).confirmed !== no);
  return el("section", { class: "card card-pad hero-card" },
    el("div", { class: "card-head" }, el("h2", {}, "Check the safety number"),
      el("span", { class: "badge " + (yes === n ? "ok" : "warn") }, yes + " of " + n + " confirmed")),
    el("div", { class: "safety" }, no),
    el("p", { class: "small muted" }, "Compare this number with every signer, on a call or in "
      + "person. If it is different, someone else took a seat. In that case, do not tap "
      + "\"It matches\". Create a new wallet."),
    clash.length ? el("div", { class: "callout bad", role: "alert" }, "Seat " + clash.join(", ")
      + " confirmed another number. Someone else may have taken a seat. Do not continue. "
      + "Create a new wallet.") : null,
    todo.length ? confirmButton(todo, no) : null);
}

const confirmButton = (todo, no) => el("div", {}, el("button", {
  class: "btn primary", type: "button", disabled: !Z || canWrite === false,
  onclick: act(() => confirmSeats(todo, no)),
}, "It matches"));

const NOT_ZIP2005 = "This wallet is not built to ZIP 2005. Funds cannot be recovered if quantum "
  + "computers break today's keys. Do you want to take a seat?";

function joinCard(seat) {
  const take = el("button", {
    class: "btn primary lg", type: "button", disabled: !Z || canWrite === false || state.pending,
    onclick: act(() => (usesV2(groupVersion()) || confirm(NOT_ZIP2005)) && takeSeat(seat)),
  }, "Take seat " + seat);
  return el("section", { class: "card card-pad hero-card" },
    el("div", { style: "display:grid;gap:4px" }, el("h2", {}, "Join " + state.g.name),
      el("p", { class: "small muted" }, "Zigs is a shared wallet for shielded Zcash. Any "
        + state.g.t + " of the " + state.g.n + " signers approve each payment. Take a seat to "
        + "become a signer. Your device creates its own key share. It never leaves this browser "
        + "unless you save a backup. Keep this page open until the wallet is ready.")),
    nameField("seat-name"),
    el("div", {}, take));
}

// The message carries the link, so it is as secret as the link.
const inviteMessage = (link) => "I made a shared wallet \"" + state.g.name + "\" on Zigs, a "
  + "private shared wallet for shielded Zcash. You are one of " + state.g.n + " signers, and "
  + state.g.t + " must approve each payment.\n\n1. Open this link on your phone or computer: "
  + link + "\n2. Take a seat.\n3. Keep the page open until the wallet is ready.\n\nThis link is "
  + "a secret. Do not post it in a public place. About Zigs: https://zigs.app";

function inviteCard(openCount) {
  const link = inviteLink(state.gid), message = inviteMessage(link);
  const share = navigator.share ? el("button", {
    class: "btn sm", type: "button",
    onclick: () => navigator.share({ title: "Join " + state.g.name + " on Zigs", text: message })
      .catch(() => {}),
  }, "Share") : null;
  return el("section", { class: "card card-pad hero-card" },
    el("div", { class: "card-head" }, el("h2", {}, "Invite your signers"),
      el("span", { class: "badge plain" },
        openCount === 1 ? "1 seat open" : openCount + " seats open")),
    el("p", { class: "small muted" }, "Send this invite link to each signer through a private "
      + "channel. It contains the wallet secret: anyone who has it can take an open seat."),
    el("div", { class: "addr-box" }, el("span", { class: "hex nowrap" }, link),
      copyBtn(link, "Copy link", "btn sm primary"), copyBtn(message, "Copy invite message", "btn sm"),
      share),
    secretQr(link));
}

// Counts for the three setup steps.
function setupCounts() {
  const n = state.g.n, no = usesV2(groupVersion()) ? safetyNo() : null;
  return {
    n, w: state.wallet, pairs: n * (n - 1),
    r1: Object.keys(state.dkg1).length, r2: Object.keys(state.dkg2).length,
    d: Object.keys(state.done).length, ver: verifiedCount(),
    seated: seatIds().filter((i) => state.seats[i]).length,
    mismatch: keysDiffer(), rejected: rejectedSeats(),
    v2: usesV2(groupVersion()), no, clash: no ? numberClash(no, state.confirm, seatIds()) : [],
    conf: no ? confirmedBy(no).length : 0, stopped: abortedText(),
    aborts: remoteAborts(),
    old: oldSeats(),
  };
}

// Seats whose round-1 document has no commitment: an old app made it.
const HEX64 = /^[0-9a-f]{64}$/;
const oldSeats = () => seatIds().filter((i) => state.dkg1[i] && !HEX64.test(state.dkg1[i].commit));

// The states that stop the key step. The first check that holds decides.
const KEY_BLOCKS = [
  (c) => c.stopped && ["bad", c.stopped],
  (c) => c.aborts.length && ["bad", "Seat " + c.aborts[0] + " stopped setup. "
    + state.abort[c.aborts[0]].reason.slice(0, 200)],
  (c) => c.mismatch && ["bad", "The signers made different wallet keys. Do not use this wallet. "
    + "Create a new wallet."],
  (c) => c.v2 && c.old.length && ["bad", "Seat " + c.old.join(", ") + " uses an old version of "
    + "Zigs and cannot join this wallet. Update it, or create a new wallet."],
  (c) => c.v2 && allSeated() && !c.no && ["bad", "A seat holds a key that this app cannot read. "
    + "Do not use this wallet. Create a new wallet."],
  (c) => c.clash.length && c.d < c.n && ["bad", "Seat " + c.clash.join(", ") + " confirmed "
    + "another safety number. Do not continue. Create a new wallet."],
  (c) => c.v2 && allSeated() && c.r1 < c.n && c.conf < c.n && ["", "Starts when every signer "
    + "confirmed the safety number (" + c.conf + " of " + c.n + ")."],
];
const keyBlock = (c) => KEY_BLOCKS.map((check) => check(c)).find(Boolean) || null;

function keyStep(c) {
  const blocked = keyBlock(c);
  if (blocked) return blocked;
  if (c.d === c.n) return ["done", "Each signer holds one piece. The full key never existed."];
  if (!allSeated()) return ["", "Starts when every seat is taken."];
  if (c.r2 === c.pairs) return ["now", "Each device is computing its piece of the key…"];
  if (c.r1 === c.n) {
    return ["now", "Devices are sharing encrypted parts of the key (" + c.r2 + " of " + c.pairs + ")…"];
  }
  return ["now", "Each device is preparing its part of the key (" + c.r1 + " of " + c.n + ")…"];
}

function addrStage(c) {
  if (c.rejected.length) return "bad";
  if (c.mismatch) return "";
  if (c.w && c.ver === c.n) return "done";
  return c.d === c.n ? "now" : "";
}

function addrStep(c) {
  const stage = addrStage(c);
  if (c.rejected.length) {
    const seats = c.rejected.join(", ");
    return [stage, "Seat " + seats + " rejected the address. Do not use this wallet."];
  }
  if (!c.w) return [stage, c.d === c.n ? "Building the shared address…" : "Comes after the key."];
  if (!c.w.birthday) return [stage, "An older version of Zigs made this wallet. Create a new wallet."];
  const checked = c.ver + " of " + c.n;
  const wait = c.ver < c.n ? " Send funds only after all " + c.n + " checked." : "";
  return [stage, checked + " signers checked the address against their own key share." + wait];
}

// One third each for seats, key ceremony and address checks.
function setupProgress(c) {
  const key = c.d === c.n ? 1 : (c.r1 / c.n + c.r2 / Math.max(1, c.pairs)) / 2;
  return Math.round((c.seated / c.n + key + (c.w ? c.ver / c.n : 0)) / 3 * 100);
}

function setupStep(cls, no, title, text) {
  return el("div", { class: "step " + cls },
    el("span", { class: "tick" }, cls === "done" ? "✓" : cls === "bad" ? "!" : no),
    el("div", { style: "display:grid;gap:2px" }, el("h3", {}, title), el("p", {}, text)));
}

function progressCard() {
  const c = setupCounts(), pct = setupProgress(c);
  const [keyStage, keyText] = keyStep(c), [addrStage, addrText] = addrStep(c);
  return el("section", { class: "card card-pad" },
    el("div", { class: "card-head" }, el("h2", {}, "Setting up your wallet"),
      el("span", { class: "mono faint" }, pct + "%")),
    el("div", { class: "progress" }, el("i", { style: "width:" + pct + "%" })),
    el("div", { class: "steps", style: "margin-top:6px" },
      setupStep(allSeated() ? "done" : "now", 1, "Signers join",
        c.seated + " of " + c.n + " seats taken."),
      setupStep(keyStage, 2, "Create the key together", keyText),
      setupStep(addrStage, 3, "Check the address", addrText)),
    addrStage === "done" ? null : el("p", { class: "small muted" }, "Every signer must keep Zigs "
      + "open until setup finishes."),
    activityLog());
}

function seatsCard(open) {
  const testing = localSeats().length && open.length
    ? el("details", { class: "testing" }, el("summary", {}, "Trying Zigs alone? Play the other seats in this browser"),
      el("p", { class: "small faint" }, "For a demo or a review only. In real use, each signer takes a seat on their own device."),
      el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, open.map((i) => el("button", {
        class: "btn sm", type: "button", disabled: !Z || canWrite === false || state.pending,
        onclick: act(() => takeSeat(i)),
      }, "Play seat " + i))))
    : null;
  return el("section", { class: "card card-pad" },
    el("div", { class: "card-head" }, el("h2", {}, "Seats"), el("span", { class: "small muted" }, state.g.t + " of " + state.g.n + " signers must approve")),
    el("div", { class: "seat-grid" }, seatIds().map((i) => guard(seatTile, i))),
    testing);
}

// Is seat i held by this browser, or by the same person in another browser?
function seatOwner(i) {
  const taken = !!state.seats[i] && seatMine(i), here = !!sec(state.gid, i);
  return { mine: taken && here, elsewhere: taken && !here && !signedMode(state.gid) };
}

function seatTile(i) {
  const s = state.seats[i], { mine, elsewhere } = seatOwner(i);
  const st = seatStage(i);
  return el("div", { class: "seat" + (mine ? " mine" : "") + (s ? "" : " open") },
    el("div", { style: "display:flex;align-items:center;gap:10px;min-width:0" }, avatar(i),
      el("div", { style: "display:grid;min-width:0" }, el("span", { class: "ri-title nowrap" }, seatLabel(i)), el("span", { class: "ri-sub" }, "Seat " + i))),
    el("span", { class: "badge " + (st === 5 ? "ok" : s ? "info" : "plain") }, STAGE_LABEL[st]),
    elsewhere ? el("span", { class: "small faint" }, "Yours, in another browser") : null);
}

// ── Overview ──
function overviewTab() {
  const c = curChain(), list = activity(), pend = toApprove(state.gid);
  return el("div", { class: "page", style: "gap:16px" },
    state.g.movedTo ? moveCard(c) : null,
    pend.length ? approvalsCard(pend) : null,
    el("div", { class: "grid-ov" }, balanceCard(c), receiveCard()),
    signersCard(),
    el("section", { class: "card" },
      el("div", { class: "card-head card-pad", style: "padding-bottom:12px" }, el("h2", {}, "Activity"),
        list.length > 6 ? el("button", { class: "btn ghost sm", type: "button", onclick: () => { ui.tab = "activity"; render(); } }, "View all") : null),
      activityRows(list.slice(0, 6))));
}

// The steps of a move, read from the old wallet: new wallet ready, payment proposed, funds gone.
export function moveState(c) {
  const to = state.g.movedTo;
  const ss = state.sessions.find((x) => x.move === to && !x.error && !expired(x));
  const b = c && c.bal ? balanceNow(c.bal) : null;
  if (!gkeys[to]) return { text: "A signer started moving this wallet to a new one. If you are one of its signers, ask them for its invite link." };
  if (!ready[to]) return { text: groupName(to) + " is still setting up. When its address is ready, move the funds here.", open: to };
  if (ss && !ss.broadcastTxid) return { text: "Moving the funds to " + groupName(to) + " is in progress. Open the payment to approve it or take the next step.", session: ss };
  if (ss && inFlight().includes(ss)) return { text: "The funds are on their way to " + groupName(to) + ". They arrive with the next block.", open: to };
  if (ss && b && b.spendable + b.pending === 0) return { text: "All funds moved to " + groupName(to) + ". This wallet is closed.", open: to, done: true };
  return { text: groupName(to) + " is ready. Move all funds to it. Like any payment, this needs " + state.g.t + " approvals.", propose: true };
}

function moveCard(c) {
  const m = moveState(c), why = m.propose ? sendBlocker() : null;
  const started = state.sessions.some((x) => x.move === state.g.movedTo && !x.error && !expired(x));
  return el("section", { class: "card card-pad " + (m.done ? "" : "attention") },
    el("div", { class: "card-head" }, el("h2", {}, m.done ? "This wallet moved" : "Changing signers"),
      m.done ? el("span", { class: "badge plain" }, "Closed") : null),
    el("p", { class: "small muted" }, m.text),
    el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" },
      m.propose ? el("button", { class: "btn primary", type: "button", disabled: !!why, title: why, onclick: act(proposeMove) }, "Move " + fmtZec(c && c.bal ? c.bal.max_send : 0)) : null,
      m.session ? el("button", { class: "btn primary", type: "button", onclick: () => openSession(m.session.id) }, "Open the payment") : null,
      m.open ? el("button", { class: "btn", type: "button", onclick: () => { ui.tab = "overview"; openGroup(m.open); } }, "Open " + groupName(m.open)) : null,
      !started ? el("button", { class: "btn ghost", type: "button", onclick: act(cancelMove) }, "Cancel move") : null),
    why ? el("p", { class: "small faint" }, why) : null);
}

function signersCard() {
  return el("section", { class: "card card-pad" },
    el("div", { class: "card-head" }, el("h2", {}, "Signers"),
      el("button", { class: "btn ghost sm", type: "button", onclick: () => { ui.tab = "members"; render(); } }, "Manage")),
    el("p", { class: "small muted" }, ruleText(state.g.t, state.g.n)),
    el("div", { class: "signer-list" }, seatIds().map((i) => el("span", { class: "signer" },
      avatar(i), el("span", { class: "small" }, named(i))))));
}

function approvalsCard(list) {
  return el("section", { class: "card attention" },
    el("div", { class: "card-head card-pad", style: "padding-bottom:12px" },
      el("h2", {}, list.length === 1 ? "A payment needs your approval" : list.length + " payments need your approval")),
    el("div", { class: "list" }, list.map((ss) => guard(approvalRow, ss))));
}

function approvalRow(ss) {
  return el("button", {
    class: "row-item", type: "button", "data-key": "pay-approve-" + ss.id,
    onclick: () => openSession(ss.id),
  },
  el("span", { class: "tx-ico out", "aria-hidden": "true" }, "↗"),
  el("span", { class: "ri-main" }, el("span", { class: "ri-title" }, payTitle(ss)),
    el("span", { class: "ri-sub" }, "Proposed by " + proposer(ss) + " · " + when(ss.createdAt))),
  el("span", { class: "ri-end" }, money(leavesOf(ss), "md", "out")),
  el("span", { class: "btn sm primary", "aria-hidden": "true" }, "Review"));
}

function balanceCard(c) {
  const b = c && c.bal ? balanceNow(c.bal) : null, empty = b && b.spendable + b.pending + b.sending === 0 && !state.g.movedTo;
  return el("section", { class: "card card-pad balance" },
    el("span", { class: "label" }, "Balance"),
    b ? money(b.spendable + b.pending, "xl")
      : el("span", { class: "skel xl", role: "img", "aria-label": "Loading balance" }),
    el("div", { class: "stats" },
      el("div", {}, el("span", { class: "label" }, "Available"), b ? money(b.spendable) : el("span", { class: "skel" })),
      el("div", {}, el("span", { class: "label" }, "Incoming"), b ? money(b.pending) : el("span", { class: "skel" }))),
    b && b.sending ? el("div", { class: "sending" }, el("span", { class: "dot busy" }), "Sending ", money(b.sending, "md", "out"), el("span", { class: "faint" }, " · waiting for a block")) : null,
    empty ? el("div", { class: "callout" }, curNet().faucet
      ? el("span", {}, "This wallet is empty. Share its address to receive ZEC, or get free testnet ZEC from a ",
        el("a", { href: curNet().faucet, target: "_blank", rel: "noopener" }, "faucet ↗"), ".")
      : el("span", {}, "This wallet is empty. Share its address to receive ZEC. Keep it under "
        + capText(curNet().cap) + ": the app warns at that level. It cannot block deposits."))
      : null,
    atCap() ? capNote() : null,
    syncLine(c));
}

// Unaudited code holds real money only up to the network's cap; past it the address is hidden.
function atCap() {
  const cap = curNet().cap, total = openTotal();
  return !!cap && total !== undefined && total >= cap;
}

// The balance of the open wallet, or undefined before its first sync.
function openTotal() {
  const c = curChain();
  if (!c || !c.bal) return undefined;
  const b = balanceNow(c.bal);
  return b.spendable + b.pending;
}

// A request names the address of a wallet, so the app offers it only when it knows that the balance
// is under the cap of the network. `total` is undefined when the balance is not known.
const underCap = (g, total) => !netOf(g).cap || total < netOf(g).cap;
const capNote = () => el("div", { class: "callout bad" },
  "This wallet holds " + capText(curNet().cap) + ", the warning level for unaudited mainnet "
  + "wallets. Do not send more to it. The app cannot block deposits. Payments out still work.");

const receiveWhat = () => curNet().cap ? "ZEC" : "testnet ZEC";
const receiveLimit = () => curNet().cap ? " Keep the total under " + capText(curNet().cap)
  + ". The app warns at that level and cannot block deposits." : "";

function receiveCard() {
  const w = state.wallet;
  return el("section", { class: "card card-pad" },
    el("div", { class: "card-head" }, el("h2", {}, "Receive"), el("span", { class: "badge ok plain" }, "Private address")),
    state.g.movedTo ? el("div", { class: "callout" }, "This wallet moved to " + groupName(state.g.movedTo) + ". Ask senders to use the new wallet's address.")
      : atCap() ? capNote()
      : el("p", { class: "small muted" }, "Share this address to receive " + receiveWhat()
        + ". Payments to it are shielded." + receiveLimit()),
    addrHidden() ? null : el("div", { class: "addr-box" }, el("span", { class: "hex" }, short(w.address, 18)), copyBtn(w.address)),
    el("p", { class: "small faint" }, verifiedCount() + " of " + state.g.n + " signers checked this address against their own key."));
}

function syncLine(c) {
  if (!c) return el("div", { class: "sync" }, el("span", {}, el("span", { class: "dot" }), "Sync starts after your seat checks the address."));
  const p = c.prog || c.bal;
  const span = p ? p.tip - c.birthday : 0;
  const pct = span > 0 ? Math.max(0, Math.min(100, ((p.height - c.birthday) / span) * 100)) : 0;
  const text = c.error ? "Sync failed" : c.syncing ? (c.prog ? "Syncing · " + Math.floor(pct) + "%" : "Connecting to the network…") : p ? "Up to date · block " + p.height.toLocaleString() : "Not synced";
  return el("div", { style: "display:grid;gap:8px" },
    c.syncing && c.prog ? el("div", { class: "progress" }, el("i", { style: "width:" + pct.toFixed(1) + "%" })) : null,
    el("div", { class: "sync" },
      el("span", {}, el("span", { class: "dot " + (c.error ? "bad" : c.syncing ? "busy" : "ok") }), text),
      el("button", { class: "btn ghost sm", type: "button", disabled: c.syncing, onclick: act(() => runSync(c)) }, c.syncing ? "Syncing…" : "Refresh")),
    c.error ? el("div", { class: "callout bad" }, c.error) : null);
}

// Received payments carry only a block height; estimate a time so they sort among proposals.
function activity() {
  const c = curChain(), tip = c && c.bal ? c.bal.height : 0;
  const sent = state.sessions.map((ss) => ({ t: ss.createdAt || 0, ss }));
  const net = netName(state.g);
  const got = (c && c.received || [])
    .map((r) => ({ t: Date.now() - spanMs(net, r.height, tip), r }));
  return [...sent, ...got].sort((a, b) => b.t - a.t);
}

function activityRows(list) {
  const line = "border-top:1px solid var(--line)";
  if (!list.length) {
    return el("div", { class: "empty", style: line }, el("h3", {}, "No activity yet"),
      el("p", { class: "small" },
        "Money you receive and payments your signers propose show up here."));
  }
  const rows = list.map((a) => guard(a.ss ? sentRow : receivedRow, a.ss || a.r));
  return el("div", { class: "list", style: line }, rows);
}

function sentRow(ss) {
  const chip = needsMyApproval(state.gid, ss) ? el("span", { class: "badge warn" }, "Your approval")
    : inFlight().includes(ss) ? el("span", { class: "badge info" }, "Confirming") : statusChip(ss);
  return el("button", {
    class: "row-item", type: "button", "data-key": "pay-" + ss.id,
    "aria-current": ss.id === state.sid ? "true" : "false", onclick: () => openSession(ss.id),
  },
  el("span", { class: "tx-ico out", "aria-hidden": "true" }, "↗"),
  el("span", { class: "ri-main" }, el("span", { class: "ri-title" }, payTitle(ss)),
    el("span", { class: "ri-sub" }, "Proposed by " + proposer(ss) + " · " + when(ss.createdAt))),
  el("span", { class: "ri-end" }, money(leavesOf(ss), "md", "out"), chip),
  el("span", { class: "chev" }, "›"));
}

// The memos of a received payment, for display. A memo that is not text says so.
const ON_CHAIN = "On chain · shared with all signers";
const memoTexts = (r) => (Array.isArray(r.memos) ? r.memos : [])
  .map((m) => m && m.status === "text" && typeof m.text === "string" ? memoShown(m.text) : null);

function receivedRow(r) {
  const memos = memoTexts(r);
  return el("a", { class: "row-item", href: curNet().explorer + r.txid, target: "_blank", rel: "noopener", title: "View in explorer" },
    el("span", { class: "tx-ico in", "aria-hidden": "true" }, "↙"),
    el("span", { class: "ri-main" },
      el("span", { class: "ri-title" }, "Received"),
      el("span", { class: "ri-sub" }, "Block " + r.height.toLocaleString()),
      memos.map((m) => el("span", { class: "ri-memo" + (m === null ? " faint" : "") },
        m === null ? "Memo is not text" : m)),
      memos.length ? el("span", { class: "ri-sub" }, ON_CHAIN) : null,
      r.memo_pending && readsMemos(state.gid)
        ? el("span", { class: "ri-sub" }, "Memo not read yet") : null),
    el("span", { class: "ri-end" }, money(r.value, "md", "in"), el("span", { class: "badge " + (r.confirmed ? "ok" : "info") }, r.confirmed ? "Confirmed" : "Confirming")),
    el("span", { class: "chev" }, "↗"));
}

// ── Activity ──
function activityTab() {
  return el("section", { class: "card" }, el("div", { class: "card-head card-pad", style: "padding-bottom:12px" }, el("h2", {}, "All activity")), activityRows(activity()));
}

// ── Messages ──
const FINE = "Signers, and anyone else who has the invite link, can read these messages. The "
  + "group server stores them sealed and sees only when they are sent.";
const sender = (i) => state.seats[i] ? named(i) : "Unknown sender";

function messagesCard() {
  const changed = changedSigners();
  return el("section", { class: "card card-pad chat" },
    el("div", { class: "card-head" }, el("h2", {}, "Messages"), notifyButton()),
    changed.length ? el("div", { class: "callout bad", role: "alert" }, "Signing key changed: "
      + changed.map((i) => "seat " + i).join(", ") + ". Their messages are not verified.") : null,
    chat[state.gid] || memoMessages().length ? chatLog("wallet") : null,
    readsMemos(state.gid) ? null : el("p", { class: "small faint" }, "Memos of payments to this "
      + "wallet are off. You can turn them on under Details."),
    walletComposer("wallet"));
}

// The thread of one payment, under the payment's steps.
function discussion(ss) {
  const thread = "pay:" + ss.id;
  return el("section", { class: "chat-section" }, el("span", { class: "label" }, "Discussion"),
    chat[state.gid] ? chatLog(thread) : null, walletComposer(thread));
}

function notifyButton() {
  if (!("Notification" in window)) return null;
  return el("button", {
    class: "btn sm", type: "button", "aria-pressed": ui.notify ? "true" : "false",
    onclick: act(toggleNotify),
  }, ui.notify ? "Notifications on" : "Notify me while Zigs is open");
}

function chatLog(thread) {
  const wallet = thread === "wallet", items = threadItems(thread, rooms[state.gid]);
  const none = wallet
    ? el("div", { class: "empty" }, el("h3", {}, "No messages yet"),
      el("p", { class: "small" }, FINE))
    : el("p", { class: "small faint" }, "No messages about this payment yet.");
  const id = (wallet ? "log-wallet-" : "log-pay-") + state.gid;
  return logBox(id, wallet ? "Messages" : "Discussion", items, none);
}

const logBox = (id, label, items, none) => el("div", {
  class: "chat-log", id, role: "log", tabindex: "0", "data-key": id, "aria-label": label,
}, items.length ? items : none);

// Messages of one thread, with the payment events of the wallet thread, oldest first.
function threadItems(thread, roomId) {
  const msgs = (chat[state.gid] || []).filter((m) => m.thread === thread)
    .map((m) => ({ ...m, kind: "msg" }));
  const events = thread === "wallet"
    ? [...state.sessions.flatMap(payEvents), ...memoMessages()] : [];
  const item = { msg: msgItem, memo: memoItem };
  return [...msgs, ...events].sort(byTime)
    .map((x) => guard(item[x.kind] || eventItem, x, roomId));
}

// Memos of payments that came in to the wallet. They are on chain, so they have no sender and no
// signature: the app shows them as received data, never as a verified message. A block height
// gives only an estimated time.
function memoMessages() {
  const c = curChain(), tip = c && c.bal ? c.bal.height : 0;
  return (c && c.received || []).flatMap((r) => memoTexts(r).map((text, i) => ({
    kind: "memo", id: r.txid + ":" + i, text, value: r.value, txid: r.txid,
    at: Date.now() - spanMs(netName(state.g), r.height, tip),
  })));
}

function memoItem(m) {
  return el("div", { class: "msg memo-msg", "data-key": "memo-" + m.id },
    el("span", { class: "tx-ico in", "aria-hidden": "true" }, "↙"),
    el("div", { class: "msg-body" },
      el("div", { class: "msg-head" }, el("b", {}, "Memo with a payment of " + fmtZec(m.value)),
        el("time", {}, when(m.at)), el("span", { class: "vmark" }, ON_CHAIN)),
      memoBody(m),
      el("a", {
        class: "small", href: curNet().explorer + m.txid, target: "_blank", rel: "noopener",
      }, "View payment ↗")));
}

// A memo that is a payment request shows as a card. It has no sender and no signature.
export function memoBody(m) {
  const req = m.text === null ? null : requestOf(m.text, false);
  if (req) return requestCard(req, { id: m.id, name: "a memo", verdict: "memo", dm: false });
  return el("p", { class: "msg-text" + (m.text === null ? " faint" : "") },
    m.text === null ? "Memo is not text" : m.text);
}

const payEvents = (ss) => [
  ["1", "proposed", finite(ss.createdAt)],
  ...(Number.isFinite(ss.broadcastAt) ? [["2", "sent", ss.broadcastAt]] : []),
  ...(ss.status === "cancelled"
    ? [["3", "cancelled", finite(ss.cancelledAt || ss.createdAt)]] : []),
].map(([n, what, at]) => ({ kind: "event", id: ss.id + ":" + n, at, what, ss }));

const EVENT_TEXT = {
  proposed: (ss) => up(proposer(ss)) + " proposed " + payTitle(ss),
  sent: (ss) => "Sent: " + payTitle(ss),
  cancelled: (ss) => "Cancelled: " + payTitle(ss),
};

function eventItem(e) {
  const n = e.what === "proposed" ? unreadIn(state.gid, "pay:" + e.ss.id) : 0;
  return el("button", {
    class: "msg-event", type: "button", "data-key": "event-" + e.id,
    onclick: () => openSession(e.ss.id),
  }, el("span", {}, EVENT_TEXT[e.what](e.ss), newBadge(n)), el("time", {}, when(e.at)));
}

const newBadge = (n) => n
  ? el("span", { class: "badge info plain", role: "img", "aria-label": n + " unread" }, n + " new")
  : null;

const TRUST = {
  yes: ["ok", "✓ Verified"], wait: ["", "Checking…"], no: ["bad", "Not verified"],
  changed: ["bad", "Key changed. Not verified."], unknown: ["bad", "Unknown sender. Not verified."],
  memo: ["bad", "Not verified"],
};

function msgItem(m, roomId) {
  return bubble(m, avatar(m.seat), sender(m.seat), trust(m, roomId), seatMine(m.seat));
}

function bubble(m, av, name, verdictKey, mine) {
  const [cls, label] = TRUST[verdictKey];
  const req = requestOf(m.text, m.thread === "dm");
  return el("div", { class: "msg" }, av,
    el("div", { class: "msg-body" },
      el("div", { class: "msg-head" }, el("b", {}, name), el("time", {}, when(m.at)),
        el("span", { class: "vmark " + cls }, label)),
      req ? requestCard(req, { id: m.id, name, verdict: verdictKey, dm: m.thread === "dm", mine })
        : el("p", { class: "msg-text" }, m.text)));
}

const coarse = () => matchMedia("(pointer: coarse)").matches;

// Enter sends and Shift+Enter adds a line. A touch screen has no Shift key, so there Enter adds a
// line and the Send button sends.
function sendOnEnter(ev) {
  const newLine = ev.shiftKey || ev.isComposing || ev.keyCode === 229 || coarse();
  if (ev.key !== "Enter" || newLine) return;
  ev.preventDefault();
  ev.target.form.requestSubmit();
}

// The line under a message box that follows the text as it changes: `plan(text)` gives { fine,
// error }. A redraw gives the text back to the new box and fires an input event, which shows it.
function planLine(plan, box) {
  const line = el("p", { class: "hint", "aria-live": "polite" });
  const show = () => {
    const got = plan(box.value);
    line.textContent = got.error || got.fine;
    line.className = "hint" + (got.error ? " bad" : "");
  };
  box.addEventListener("input", show);
  show();
  return line;
}

const sendButton = (o, sending) => el("button", {
  class: "btn primary", type: "submit", disabled: !!o.why || sending,
}, sending ? "Sending…" : o.label || "Send message");

// The message box. A message on chain is permanent and costs a fee, so only the button sends it.
function messageBox(o) {
  const quick = !o.plan && !coarse();
  return el("textarea", {
    class: "input", id: "chat-text-" + o.kind, name: "text", rows: "2", disabled: !!o.why,
    onkeydown: o.plan ? null : sendOnEnter, "aria-label": o.to,
    placeholder: o.to + (quick ? ". Enter sends, Shift+Enter adds a line" : ""),
  });
}

// `o`: kind (names the ids, so a draft stays with its own wallet or chat; no ":" in it), why (why
// it is off), warn, seats (the senders to choose from), to (the label), fine, key (the busy key),
// send(text, seat) and request (roomRequest or chatRequest, or none: it adds the form that sends a
// payment request). A message on chain also has label (the button), plan(text) (the fee line) and
// progress (the words of the step that is running).
export function composer(o) {
  const sending = busy.has(o.key);
  const box = messageBox(o);
  const form = el("form", { class: "composer", onsubmit: act((ev) => submitMessage(ev.target, o)) },
    o.why ? el("p", { class: "hint" + (o.warn ? " bad" : "") }, o.why) : null,
    o.progress ? el("p", { class: "hint", role: "status" }, o.progress) : null,
    box, o.plan ? planLine(o.plan, box) : null,
    el("div", { class: "composer-row" }, seatPicker(o, "chat-as-" + o.kind), requestToggle(o),
      sendButton(o, sending)),
    el("p", { class: "small faint" }, o.fine));
  return asking(o) ? el("div", { class: "composer-wrap" }, form, requestForm(o)) : form;
}

// Whether the request form of a composer is open.
const asking = (o) => !!o.request && !o.why && ui.request === o.kind;

function requestToggle(o) {
  if (!o.request) return null;
  const open = asking(o);
  return el("button", {
    class: "btn", type: "button", disabled: !!o.why, "aria-expanded": String(open),
    onclick: () => { ui.request = open ? null : o.kind; render(); },
  }, "Request a payment");
}

function seatPicker(o, id) {
  return o.seats.length > 1 ? el("label", { class: "composer-as small muted" }, "Send as",
    el("select", { class: "input", id, name: "as" },
      o.seats.map((i) => el("option", { value: String(i) }, "Seat " + i)))) : null;
}

function walletComposer(thread) {
  return composer({
    kind: (thread === "wallet" ? "wallet-" : "pay-") + state.gid, why: chatWhy(),
    warn: roomWarn.has(state.gid),
    seats: sendSeats(), to: "Message to the signers", fine: FINE,
    key: "chat:" + rooms[state.gid] + ":" + thread,
    send: (text, seat) => sendMessage(thread, text, seat),
    request: thread === "wallet" ? roomRequest() : null,
  });
}

export async function submitMessage(form, o) {
  const box = form.elements.text, draft = box.value, r = checkText(draft);
  if (r.error) throw new Error(r.error);
  if (busy.has(o.key)) return;
  // A box with focus keeps the page from drawing (typingMessage): let go, so that the steps show.
  if (o.plan && box.blur) box.blur();
  busy.add(o.key); render();
  try {
    await o.send(r.text, form.elements.as ? Number(form.elements.as.value) : o.seats[0]);
    // A redraw during the send replaced the form: clear the live box, but not new typing.
    const live = document.getElementById(box.id);
    if (live && live.value === draft) live.value = "";
  } finally { busy.delete(o.key); }
}

// ── Payment requests ──
// A message or a memo whose whole text is a ZIP 321 URI shows as a card (web/requests.js). The
// engine reads the URI. "Propose this" fills the Send form and sends nothing.
const parsedRequests = new Map();   // "net\nuri" -> { out } or { err }; bounded

function parseCached(uri, net) {
  const key = net + "\n" + uri;
  let hit = parsedRequests.get(key);
  if (!hit) {
    if (parsedRequests.size >= 500) parsedRequests.clear();
    try { hit = { out: Z.parseRequest(uri, net) }; } catch (e) {
      hit = { err: e.message || String(e) };
    }
    parsedRequests.set(key, hit);
  }
  if (hit.err !== undefined) throw new Error(hit.err);
  return hit.out;
}

// A wallet reads a request for its own network, and so does the personal account (`network`). A
// chat has no wallet, so it tries both.
const requestEnv = (dm, network) => ({
  nets: network ? [REQUEST_NET[network]] : dm ? ["test", "main"] : [REQUEST_NET[netName(state.g)]],
  parse: parseCached, blocker: (to) => payeeBlocker(to, normalized),
});

// The request in `text`, or null for plain text. Until the engine loads, a request shows as text.
// The page asks for every message on every draw, so plain text must cost no engine call.
export const requestOf = (text, dm, network) =>
  Z && requestUri(text) ? readRequest(text, requestEnv(dm, network)) : null;

// Wallets where this browser holds a key share. A wallet that moved or has no address is left out.
const seatWallets = () => state.groups.filter((g) => !g.unreadable && !g.movedTo && ready[g.id]
  && mySeatSecrets(g.id).some(([, s]) => s.keyPackage));
export const proposeWallets = (net) => seatWallets().filter((g) => netName(g) === WALLET_NET[net]);

function requestTotal(req) {
  if (req.total != null) return money(req.total);
  const all = req.open === req.payees.length;
  const words = all ? "The payer chooses the amount" : "The payer chooses some amounts";
  return el("span", { class: "small muted" }, words);
}

// The name and the message of a payee are text from the sender. The card cuts them and says that
// the app did not check them.
function requestClaims(p) {
  const rows = [["Name", quoted(p.label)], ["Message", quoted(p.message)]].filter((r) => r[1]);
  if (!rows.length) return null;
  return el("div", { class: "req-claims" },
    el("span", { class: "small faint" }, "From the request, not checked"),
    rows.map(([label, text]) => memoRow(label, text)));
}

function requestPayee(p) {
  return el("div", { class: "payee-item" },
    el("div", { class: "payee" }, el("span", { class: "hex" }, short(p.to, 12)),
      el("span", { class: "payee-end" }, p.amount == null
        ? el("span", { class: "small muted" }, "The payer chooses the amount") : money(p.amount))),
    requestClaims(p),
    p.memo ? memoRow("Memo", p.memo) : null);
}

function requestError(req) {
  return el("div", { class: "to-box req-card" },
    el("span", { class: "label" }, "Payment request"),
    el("div", { class: "callout bad" }, requestProblem(req.error)),
    el("p", { class: "msg-text small faint" }, memoShown(req.uri)));
}

const PAYS_OWN = "This request pays each wallet that you could propose it from. "
  + "A wallet cannot pay itself.";

// The checked addresses that the payees of a request name. A wallet cannot pay itself.
const paidBy = (req) => new Set(req.payees.map((p) => normalized(p.to)));

// The person picks the wallet to propose from: a wallet of the request's network where this
// browser holds a key share, and that the request does not pay. Returns { select, why }; `select`
// is null when there is none.
function walletPicker(req, id, paid) {
  const held = proposeWallets(req.net);
  if (!held.length) {
    return { select: null, why: "You hold no seat in a " + WALLET_NET[req.net] + " wallet." };
  }
  const wallets = held.filter((g) => !paid.has(normalized(moveAddress(g.id))));
  if (!wallets.length) return { select: null, why: PAYS_OWN };
  const options = wallets.map((g) => el("option", { value: g.id },
    g.name + " (" + netOf(g).label + ")"));
  const select = el("select", {
    class: "input", id: "req-wallet-" + id, "aria-label": "Propose from wallet",
  }, options);
  return { select, why: "" };
}

// Where "Propose this" proposes from. In a room it is the open wallet, unless the request pays that
// wallet. In a chat, and for a request that pays the open wallet, the person picks a wallet.
function proposeSource(req, o) {
  const paid = paidBy(req);
  const paysOpen = !o.dm && !!state.wallet && paid.has(normalized(state.wallet.address));
  if (o.dm || paysOpen) return walletPicker(req, o.id, paid);
  return { select: null, why: sendBlocker() || "" };
}

// `o`: id (of the message), name (of the sender), verdict (the sender check, or "memo"), dm, and
// mine (the message is from this browser).
export function requestCard(req, o) {
  if (req.error) return requestError(req);
  const { select, why: where } = proposeSource(req, o);
  const st = cardState(req, o.verdict, where), [cls, mark] = TRUST[o.verdict];
  return el("div", { class: "to-box req-card" },
    el("div", { class: "card-head" },
      el("span", { class: "req-title" }, el("span", { class: "label" }, "Payment request"),
        o.dm ? netBadge({ network: WALLET_NET[req.net] }) : null),
      requestTotal(req)),
    req.payees.map((p) => guard(requestPayee, p)),
    el("div", { class: "memo-line" }, el("span", { class: "label" }, "From"),
      el("span", { class: "memo-text" }, o.name, " · ",
        el("span", { class: "vmark " + cls }, mark))),
    st.warning ? el("div", { class: "callout bad" }, st.warning) : null,
    el("div", { class: "req-actions" }, select,
      el("button", {
        class: "btn primary sm", type: "button", disabled: !!st.why,
        onclick: () => proposeRequest(req, o, select ? select.value : state.gid),
      }, "Propose this"),
      copyBtn(req.uri, "Copy request")),
    st.why ? el("p", { class: "small faint" }, st.why) : null);
}

// Opens the Send form with the payees of a request. The normal checks and approvals apply. The
// note names the sender only when the sender is verified (see requestNote).
export function proposeRequest(req, o, gid) {
  ui.pay = payeeRows(req.payees, () => ++ui.payKey);
  const room = o.dm || gid === state.gid ? "" : groupName(state.gid);
  ui.note = requestNote(o.name, o.verdict, { mine: o.mine, room });
  ui.listError = ""; ui.priority = false;
  ui.send = true;
  ui.sendFor = gid;
  if (gid === state.gid) { closeSession(); render(); return; }
  ui.tab = "overview";
  openGroup(gid);
}

const NO_BALANCE = "Wait for the first sync to finish. The app offers the address of a mainnet "
  + "wallet only when it knows the balance.";

// What the "Request a payment" form of a composer needs: the wallets that can receive, and why not.
function roomRequestWhy() {
  if (!state.wallet) return "The wallet address is not ready yet.";
  if (state.g.movedTo) {
    return "This wallet moved to " + groupName(state.g.movedTo)
      + ". Ask for payments to the new wallet.";
  }
  const total = openTotal();
  if (!underCap(state.g, total)) {
    return total === undefined ? NO_BALANCE : "This wallet holds " + capText(curNet().cap)
      + ", the warning level for unaudited mainnet wallets. Do not ask for more.";
  }
  return myVerified() ? "" : "Your seat is still checking the wallet address.";
}

// In a wallet room, the request pays the open wallet. Only the wallet thread offers it.
export const roomRequest = () => ({
  why: roomRequestWhy,
  choices: () => roomRequestWhy() ? []
    : [{ id: state.gid, name: state.g.name, address: state.wallet.address,
      net: netName(state.g) }],
  fine: "Signers, and anyone else who has the invite link, can read the request.",
});

// In a direct chat, the person picks one of their wallets. The address is the one that this
// browser's own seat checked, never the store's copy.
export const chatRequest = () => ({
  why: () => dmChoices().length ? "" : "You hold no seat in a wallet that can receive a request. "
    + "A wallet needs a checked address and, on mainnet, a known balance under the cap.",
  choices: dmChoices,
  fine: "Your contact, and anyone else who has the contact link, can read the address, the "
    + "amount and the memo of this request.",
});

export function dmChoices() {
  return seatWallets().flatMap((g) => {
    const address = moveAddress(g.id);
    const ok = address && underCap(g, balOf(g.id)?.total);
    return ok ? [{ id: g.id, name: g.name, address, net: netName(g) }] : [];
  });
}

// The wallet that the request pays: a choice in a chat, the open wallet in a room. The form holds
// the id of the wallet, never a position in the list, because the list can change while the person
// types. A single wallet has a hidden field, so submitRequest checks it in the same way.
function requestTarget(choices, kind, field) {
  const label = (c) => c.name + " (" + NETWORKS[c.net].label + ")";
  if (choices.length > 1) {
    const options = choices.map((c) => el("option", { value: c.id }, label(c)));
    const select = el("select", { class: "input", id: "req-to-" + kind, name: "to" }, options);
    return field("Pay to", select, "");
  }
  if (!choices.length) return el("p", { class: "small muted" });
  return [el("p", { class: "small muted" }, "Pays to " + label(choices[0])),
    el("input", { type: "hidden", name: "to", value: choices[0].id })];
}

function requestForm(o) {
  const choices = o.request.choices(), why = o.request.why(), sending = busy.has(o.key);
  const field = (label, input, hint) => el("label", { class: "field" }, el("span", {}, label),
    input, el("span", { class: "hint" }, hint));
  const text = (id, extra) => el("input", {
    class: "input", id: id + o.kind, type: "text", autocomplete: "off", ...extra,
  });
  const to = requestTarget(choices, o.kind, field);
  return el("form", {
    class: "composer req-form", onsubmit: act((ev) => submitRequest(ev.target, o)),
  },
  el("h3", {}, "Request a payment"), why ? el("p", { class: "hint bad" }, why) : null, to,
  field("Amount in ZEC (optional)", text("req-amt-", {
    name: "amt", inputmode: "decimal", placeholder: "The payer chooses the amount",
    "aria-label": "Amount",
  }), "Leave it empty to let the payer choose the amount."),
  field("Memo (optional)", text("req-memo-", { name: "memo", "aria-label": "Memo" }),
    "The payer can send this memo with the payment."),
  el("div", { class: "composer-row" }, seatPicker(o, "req-as-" + o.kind),
    el("button", { class: "btn", type: "button", onclick: () => { ui.request = null; render(); } },
      "Cancel"),
    el("button", {
      class: "btn primary", type: "submit", disabled: !Z || !!why || !choices.length || sending,
    }, sending ? "Sending…" : "Send request")),
  el("p", { class: "small faint" }, o.request.fine));
}

// The wallet that the person chose, found by its id in the list as it is now.
function chosenWallet(form, o) {
  const id = form.elements.to ? form.elements.to.value : "";
  const choice = o.request.choices().find((c) => c.id === id);
  if (!choice) throw new Error(o.request.why() || "Choose a wallet again.");
  return choice;
}

export async function submitRequest(form, o) {
  if (busy.has(o.key)) return;
  const choice = chosenWallet(form, o);
  const made = requestPayees(choice.address, form.elements.amt.value, form.elements.memo.value);
  if (made.error) throw new Error(made.error);
  const r = checkText(Z.makeRequest(S(made.payees), REQUEST_NET[choice.net]));
  if (r.error) throw new Error(r.error);
  busy.add(o.key); render();
  try {
    await o.send(r.text, form.elements.as ? Number(form.elements.as.value) : o.seats[0]);
    ui.request = null;
  } finally { busy.delete(o.key); }
}

// ── Direct chat page ──
const DM_FINE = "Your contact, and anyone else who has the contact link, can read these messages. "
  + "Keep the link private. The group server stores them sealed. It sees when you write, and that "
  + "your two devices use this chat.";

function chatView() {
  const cid = state.cid;
  if (!chats.list[cid]) return lobby();
  return el("div", { class: "page" },
    el("header", { class: "page-head" }, el("div", { class: "ph-left" },
      el("button", { class: "btn ghost sm back", type: "button", onclick: () => openChat(null) },
        "← Wallets"),
      el("h1", {}, contactName(cid)),
      el("div", { class: "ph-meta" },
        el("span", { class: "badge plain" }, "Direct chat · group server")))),
    chatMembers[cid] && !contactOf(cid) ? chatInviteCard(cid) : null,
    chatCard(cid));
}

// The ids hold the chat id, so a draft or a scroll place stays with its own chat.
function chatCard(cid) {
  const msgs = chat[cid], kind = "dm-" + cid;
  const items = (msgs || []).map((m) => guard(dmItem, m, cid));
  const none = el("p", { class: "small faint" }, msgs ? "No messages yet." : "Loading messages…");
  const alert = chatWarning(chatPins, cid, chatMembers[cid], msgs || []);
  return el("section", { class: "card card-pad chat" },
    el("div", { class: "card-head" }, el("h2", {}, "Messages"), notifyButton()),
    alert ? el("div", { class: "callout bad", role: "alert" }, alert) : null,
    logBox("log-" + kind, "Messages", items, none),
    composer({
      kind, why: signing === false ? NO_SIGNING : null, seats: [], key: "chat:" + cid + ":dm",
      to: "Message to your contact", fine: DM_FINE, send: (text) => sendDm(cid, text),
      request: chatRequest(),
    }),
    el("p", { class: "small faint" }, "This chat lives in this browser. Private windows and Tor "
      + "Browser forget it when they close."),
    leaveBox(cid));
}

function chatInviteCard(cid) {
  const link = chatLink(cid);
  return el("section", { class: "card card-pad hero-card" },
    el("div", { class: "card-head" }, el("h2", {}, "Invite your contact")),
    el("p", { class: "small muted" }, "Send this link to one person through a private channel. "
      + "Until they open it, anyone who has the link can join the chat."),
    el("div", { class: "addr-box" }, el("span", { class: "hex nowrap" }, link),
      copyBtn(link, "Copy link", "btn sm primary"),
      copyBtn(chatMessage(link), "Copy message", "btn sm")),
    secretQr(link, "chat"));
}

function dmItem(m, cid) {
  const mine = m.from === chats.list[cid].member, contact = m.from === contactOf(cid);
  const name = mine ? "You" : contact ? contactName(cid) : "Unknown sender";
  const av = el("span", { class: "av round" + (mine ? " me" : ""), title: name }, initials(name));
  return bubble(m, av, name, dmTrust(cid, m), mine);
}

// The confirm moves focus to Cancel, so a repeated Enter cannot leave the chat.
export function leaveBox(cid) {
  const ask = (on) => () => {
    ui.leave = on; focusAfter(on ? "leave-no" : "leave-ask", true); render();
  };
  const btn = (key, cls, onclick, text) => el("button", {
    class: cls, type: "button", onclick, "data-key": key,
  }, text);
  if (!ui.leave) return el("div", {}, btn("leave-ask", "btn sm", ask(true), "Leave chat"));
  const again = contactOf(cid) ? " You cannot join this chat again." : "";
  return el("div", { class: "callout bad", role: "alert" },
    el("p", {}, "Leave this chat? It is removed from this browser only. The sealed messages stay "
      + "on the group server." + again),
    el("div", { class: "dialog-actions" }, btn("leave-no", "btn", ask(false), "Cancel"),
      btn("leave-yes", "btn", act(() => leaveChat(cid)), "Leave chat")));
}

function newChatDialog() {
  const close = () => { ui.newChat = false; render(); };
  return el("form", {
    class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "chat-title",
    onsubmit: act(async () => { ui.newChat = false; await createChat(); }),
  },
  el("div", { class: "card-head" }, el("h2", { id: "chat-title" }, "New chat"),
    el("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: close },
      "×")),
  nameField("chat-name", "your contact"),
  el("div", { class: "callout" }, "You get a contact link. Send it to one person. Then the two of "
    + "you can write to each other."),
  el("div", { class: "dialog-actions" },
    el("button", { class: "btn", type: "button", onclick: close }, "Cancel"),
    el("button", { class: "btn primary", type: "submit",
      disabled: !Z || !db || canWrite === false }, "Create")));
}

// ───────────────────────── Personal account ─────────────────────────
// A single-signer account that pays the fee of messages on chain (CHAT.md section 5). It syncs by
// its viewing key like a wallet, always reads memos, and never touches the group server. The seed
// stays in `personal`. It never goes into `ui`, a log line or an error message.
const FUND_NOTE = "Fund the proposer's personal account";
const NOT_READY = "Wait for the account to load.";
const splitParts = (text) => {
  if (!Z) throw new Error("The crypto engine is not ready.");
  return J(Z.splitMessage(text));
};
const joinTexts = (texts) => J(Z.joinMessage(S(texts))).text;

export function startAccount() {
  if (!Z || !personal || acct) return;
  let keys;
  try { keys = J(Z.accountKeys(personal.seed, personal.network)); } catch (e) {
    log("account keys: " + (e.message || e));
    return;
  }
  acct = {
    account: true, gid: "personal", id: "personal", secret: personal.snapKey,
    net: NETWORKS[personal.network], ufvk: keys.ufvk, address: keys.address,
    birthday: personal.birthday, addrs: new Map(), cw: null, url: null, prog: null, bal: null,
    received: [], sent: new Set(), ms: 0, error: null, syncing: false, progress: "", live: "",
  };
  runSync(acct);
}

function dropAccount() {
  const c = acct;
  acct = null;
  if (c && !c.syncing && c.cw) c.cw.free();
}

// Another tab removed or replaced the account: this tab's sync follows (the sync key is new then).
export function followAccount() {
  if (acct && (!personal || acct.secret !== personal.snapKey)) dropAccount();
  startAccount();
}

const heightNow = () => (acct && acct.bal ? acct.bal.height : undefined);
export function sentStateOf(rec) {
  const sent = acct ? acct.sent : new Set();
  return sentState(rec, { sent, height: heightNow(), live: !!acct && acct.live === rec.txid });
}
// The sent messages that hold notes (see holdsNotes): the engine does not know about them yet.
export const flightNow = () => (personal ? personal.sent.filter((r) => holdsNotes(sentStateOf(r))) : []);
export const acctBalance = () => (acct && acct.bal ? accountBalance(acct.bal, flightNow()) : null);

// The address of the account is shown on testnet. On mainnet it is shown while the balance is
// known and under the cap, as for a wallet. Returns why it is not, or "".
function acctAddressWhy() {
  const cap = NETWORKS[personal.network].cap, b = acctBalance();
  if (!cap) return "";
  if (!b) {
    return "Wait for the first sync to finish. The app shows the address of a mainnet account "
      + "only when it knows the balance.";
  }
  return b.total < cap ? "" : "This account holds " + capText(cap) + ", the warning level for "
    + "unaudited mainnet accounts. Do not send more to it. The app cannot block deposits.";
}

// Why the composer is off, or "".
export function messageWhy(fee = feeFor(1)) {
  if (!acct || !acct.cw) return "Wait for the first sync to finish.";
  if (acct.progress) return "A message is being sent. Wait until it is done.";
  return sendGate(acctBalance(), flightNow(), fee);
}

// The address of the account at `index`: 0 is the public address, a contact has its own.
export function addressFor(index) {
  if (index === 0) return acct.address;
  if (!acct.addrs.has(index)) acct.addrs.set(index, Z.addressAt(acct.ufvk, index));
  return acct.addrs.get(index);
}

const HAS_ACCOUNT = "This browser has a personal account already. A browser keeps one account.";

// Makes the account that `build` gives the account of this browser. It never replaces a saved
// one: the page reads the saved account again first, and the device store refuses a write over it.
async function claimAccount(build, failure) {
  await rereadPersonal();
  if (personal || personalError) throw new Error(personalError || HAS_ACCOUNT);
  const made = await build();
  // The last read, the check and the save run alone, as a change does. With the lock on, the
  // sealed record has no add() that refuses a second account.
  return exclusive("account", async () => {
    await rereadPersonal();   // another tab may have saved an account while `build` waited
    if (personal || personalError) throw new Error(personalError || HAS_ACCOUNT);
    personal = made;
    if (await persistPersonal(true)) return;
    if (personal === made) personal = null;
    await rereadPersonal();   // another tab may have saved an account in the meantime
    throw new Error(personal ? HAS_ACCOUNT : failure);
  });
}

export async function createPersonal(network) {
  if (!Z) throw new Error("The crypto engine is not ready.");
  if (network === "mainnet" && !ui.personal.ack) {
    throw new Error("Confirm that you understand Zigs is not audited before you make a mainnet "
      + "account.");
  }
  await claimAccount(async () => {
    const birthday = await Z.latestHeight(await pickServer(NETWORKS[network]));
    const made = J(Z.accountNew(network));
    return newPersonal({ seed: made.seed, network, birthday }, newRoom().key);
  }, "This browser could not save the account, so it was not made. Lock Zigs with a passkey, or "
    + "use a browser that keeps site data.");
  ui.personal.ack = false;
  startAccount();
  showBanner("ok", "Account made. Back it up now: the file is the only copy outside this browser.");
}

// The backup file brings the seed, the network, the birthday and the contacts back. The sync
// starts at the birthday. The text of sent messages is not in the file.
export async function restoreAccount(b, encrypted) {
  if (!encrypted) {
    throw new Error("This backup file is not encrypted. Make a new encrypted backup of the "
      + "account.");
  }
  await claimAccount(() => restoredPersonal(readBackup(b, personalEnv()), newRoom().key),
    "This browser could not save the restored account, so it was not used.");
  startAccount();
  showBanner("ok", "Restored the personal account. It syncs from block " + fmtInt(personal.birthday)
    + ". A contact that you added after you made the file is not in it. Messages to the address "
    + "of that contact show under Other messages.");
}

// Removes the account, also one that does not read (`personalDamaged`).
export async function removeAccount() {
  const was = [personal, personalDamaged, personalError];
  personal = personalDamaged = null;
  personalError = "";
  if (!(await persistPersonal())) {
    [personal, personalDamaged, personalError] = was;
    throw new Error("Could not save this change in the browser, so the account stays.");
  }
  dropAccount();
  try { await idb("readwrite", (st) => st.delete("personal")); } catch { /* the state is sealed */ }
  ui.personal.drop = false;
  state.contact = null;
  showBanner("ok", "The personal account is removed from this browser.");
}

function contactCtx(own) {
  const net = NETWORKS[personal.network];
  return { normalize: normalized, prefix: net.prefix, label: net.label.toLowerCase(), own };
}

// A new contact needs an index that no address of the account used. The chain tells which ones got
// a payment, so the first sync must be done.
const NOT_SYNCED = "Wait for the first sync to finish. Zigs then knows which addresses of the "
  + "account already got a payment.";

export async function addPersonalContact(name, address) {
  const c = acct;
  if (!c) throw new Error(NOT_READY);
  if (!c.bal) throw new Error(NOT_SYNCED);
  const own = [c.address, ...personal.contacts.map((x) => addressFor(x.index))];
  let made;
  await changePersonal((p) => {
    const ctx = { ...contactCtx(own), seen: highestIndex(c.received) };
    const got = addContact(p.contacts, name, address, ctx);
    if (got.error) throw new Error(got.error);
    p.contacts.push(got.contact);
    p.backedUp = false;   // the file does not hold this contact yet
    made = got.contact;
  });
  return made;
}

export function openContact(index) {
  openGroup(null);
  state.contact = index;
  render();
}

// The funding request: 3 payees to the public address of the account (web/personal.js).
export function fundingUri() {
  if (!acct) throw new Error(NOT_READY);
  const made = fundingPayees(acct.address, toZat(ui.personal.fund));
  if (made.error) throw new Error(made.error);
  return Z.makeRequest(S(made.payees), REQUEST_NET[personal.network]);
}

// Opens the Send form of a wallet with the request. It sends nothing: the wallet's approvals apply.
export function fundFromWallet(gid) {
  const req = requestOf(fundingUri(), true, personal.network);
  if (!req || req.error) throw new Error(req ? requestProblem(req.error) : NOT_READY);
  proposeRequest(req, { name: "", verdict: "yes", mine: true, dm: true }, gid);
  ui.note = FUND_NOTE;
}

export async function copyFundingRequest() {
  const uri = fundingUri();
  try { await navigator.clipboard.writeText(uri); } catch {
    throw new Error("This browser did not let the page copy. Allow clipboard access for this "
      + "site.");
  }
  showBanner("ok", "Request copied. Pay it from any wallet.");
}

// Builds the message, signs it with the seed, builds the proof, saves the record, and only then
// sends it. A record that is saved but not confirmed as sent holds its notes until a block holds
// it or it expires (sentState). The seed stays on this thread: the worker gets the signed
// transaction only. One message at a time, also across tabs: the next one starts after the
// saved record of this one is there to read.
export const sendOnChain = (contact, text) => exclusive("send", () => sendLocked(contact, text));

async function sendLocked(contact, text) {
  await rereadPersonal();
  const c = acct, plan = messagePlan(text, splitParts);
  const why = plan.error || messageWhy(plan.fee);
  if (why) throw new Error(why);
  const step = (words) => { c.progress = words; render(); };
  try {
    step("Building the message…");
    const m = J(await c.cw.createMessage(contact.address, text));
    const tip = J(c.cw.balance()).tip;
    step("Signing…");
    const signed = J(Z.accountSign(m.pczt, personal.seed, personal.network)).signed_pczt;
    step("Building the proof. This takes about a minute.");
    const out = await engineOffThread("finalize", signed);
    const rec = {
      txid: out.txid, to: contact.index, text, at: Date.now(), tip, fee: m.fee, parts: m.parts,
      note_value: m.note_value, change: m.change, broadcast: false, failed: "",
    };
    await changePersonal((p) => { p.sent.push(rec); });
    c.live = rec.txid;
    step("Sending to the network…");
    await deliver(c, rec, out.tx_hex);
  } finally { c.progress = ""; c.live = ""; render(); }
}

async function deliver(c, rec, txHex) {
  const mark = (patch) => changePersonal((p) => {
    Object.assign(p.sent.find((r) => r.txid === rec.txid) || {}, patch);
  });
  try {
    await broadcastAnywhere(txHex, { net: c.net, ufvk: c.ufvk, birthday: c.birthday });
  } catch (e) {
    const reason = e.message || String(e);
    if (!e.refused) {
      throw new Error("The message may not have been sent: " + reason + ". Zigs holds its notes "
        + "until a block holds it or it expires.");
    }
    await mark({ failed: reason }).catch((err) => log("could not save: " + err.message));
    throw new Error("The message was not sent: " + reason);
  }
  await mark({ broadcast: true }).catch((err) => log("could not save the send: " + err.message));
  log("message sent: " + rec.txid);
  showBanner("ok", "Sent to the network. It arrives with the next block.");
  runSync(c);
}

// The received memos of the account, joined and sorted into the chats of the contacts and the other
// messages. The result is kept until the list of memos or the contacts change.
export function accountInbox() {
  const c = acct;
  if (!c || !personal) return { chats: new Map(), other: [] };
  const key = personal.contacts.map((x) => x.index).join(",");
  if (!c.routed || c.routed.received !== c.received || c.routed.key !== key) {
    const items = receivedItems(c.received, joinTexts);
    c.routed = { received: c.received, key, ...routeItems(items, personal.contacts) };
  }
  return c.routed;
}

// A block height as a time. A received message has only its block height.
// The time of a block, counted back from the end of the last sync. The clock goes on between
// syncs and the height does not, so a count from now would move every message later.
export function blockTime(height) {
  const tip = heightNow() ?? height;
  return (acct?.balAt ?? Date.now()) - spanMs(personal.network, height, tip);
}

const contactRows = (contact) => chatTimeline(accountInbox().chats.get(contact.index) || [],
  personal.sent.filter((r) => r.to === contact.index), blockTime);

// ── Personal account: the home page ──
export function personalCard(pickRestore) {
  if (personalPending) {
    return el("section", { class: "card card-pad" }, el("h2", {}, "Personal account"),
      el("p", { class: "small faint" }, "Loading the saved account…"));
  }
  if (personalError) return damagedCard();
  return personal ? accountCard() : createCard(pickRestore);
}

// A saved account that does not read. The record stays as it is. If it still holds a seed, the
// person can save a backup of what reads, or remove it and start again.
export function damagedCard() {
  const canSave = !!personalDamaged && !!salvageBackup(personalDamaged, personalEnv());
  return el("section", { class: "card card-pad" }, el("h2", {}, "Personal account"),
    el("div", { class: "callout bad", role: "alert" }, personalError),
    canSave ? el("p", { class: "small muted" }, "Back up account saves the seed and the "
      + "contacts that Zigs can read.") : null,
    personalDamaged ? accountActions(DAMAGED_WARNING, canSave) : null);
}

function createCard(pickRestore) {
  const p = ui.personal;
  return el("section", { class: "card card-pad" },
    el("div", { class: "card-head" }, el("h2", {}, "Personal account"),
      el("span", { class: "badge plain" }, "Optional")),
    el("p", { class: "small muted" }, "Write to anyone who has a shielded Zcash address, also if "
      + "they do not use Zigs. A message is a small payment on chain, and this account pays its "
      + "fee. The account is apart from your wallets, and the group server never sees it."),
    networkPick(p, "account", "p"),
    el("div", { class: "callout" }, "Keep only a few cents here. Whoever controls this browser can "
      + "spend the account. Make a backup file right after you create it."),
    el("div", { class: "dialog-actions" },
      el("button", { class: "btn", type: "button", onclick: pickRestore }, "Restore from backup"),
      el("button", {
        class: "btn primary", type: "button", disabled: !Z,
        onclick: act(() => createPersonal(p.net)),
      }, "Create account")));
}

const skeleton = (cls = "") => el("span", { class: "skel " + cls, role: "img",
  "aria-label": "Loading balance" });

function accountBalanceBlock(b) {
  const money2 = (zat) => (b ? money(zat) : skeleton());
  return el("div", { style: "display:grid;gap:10px" },
    el("span", { class: "label" }, "Balance"), b ? money(b.total, "xl") : skeleton("xl"),
    el("div", { class: "stats" },
      el("div", {}, el("span", { class: "label" }, "Available"), money2(b && b.spendable)),
      el("div", {}, el("span", { class: "label" }, "Incoming"), money2(b && b.pending))),
    flightNow().length ? el("div", { class: "sending" }, el("span", { class: "dot busy" }),
      "A message is waiting for its block") : null);
}

export function accountCard() {
  const c = acct, b = acctBalance();
  return el("section", { class: "card card-pad" },
    el("div", { class: "card-head" }, el("h2", {}, "Personal account"),
      netBadge({ network: personal.network })),
    el("p", { class: "small muted" }, "This account pays the fee of your messages on chain. It is "
      + "not a wallet and it has no signers. Whoever controls this browser can spend it."),
    personal.backedUp ? null : accountBackupNote(),
    accountBalanceBlock(b),
    b ? balanceWarnings(b.total).map((t) => el("div", { class: "callout warn", role: "status" }, t))
      : null,
    c ? syncLine(c) : el("p", { class: "small faint" }, NOT_READY),
    c ? addressBlock(c) : null,
    c ? fundBlock() : null,
    accountActions(removeWarning(personal)),
    otherMessages());
}

function accountBackupNote() {
  return el("div", { class: "callout warn", role: "status" },
    el("span", { style: "flex:1 1 16rem" }, "Back up the account. This browser can forget it: "
      + "private windows and Tor Browser delete it when they close. The file holds the seed and "
      + "your contacts. A passphrase that you choose locks it."),
    el("button", { class: "btn sm", type: "button", onclick: openAccountBackup },
      "Back up account"));
}

export function addressBlock(c) {
  const why = acctAddressWhy();
  if (why) return el("div", { class: "callout" + (acctBalance() ? " bad" : "") }, why);
  return el("div", { style: "display:grid;gap:8px" },
    el("span", { class: "label" }, "Public address"),
    el("div", { class: "addr-box" }, el("span", { class: "hex" }, short(c.address, 18)),
      copyBtn(c.address)),
    el("details", { class: "qr-toggle" }, el("summary", {}, "Show QR code"),
      qrBox(c.address, "Account address")),
    el("p", { class: "small faint" }, "Anyone who has this address can pay it and write to it. "
      + "A message that reaches it shows under Other messages, marked not verified. Give each "
      + "contact their own address instead."));
}

// The request pays 3 notes, so the account can send a message after each block.
export function fundBlock() {
  if (acctAddressWhy()) return null;
  const b = acctBalance();
  const wallets = proposeWallets(REQUEST_NET[personal.network]);
  const pick = wallets.length > 1 ? el("select", {
    class: "input", id: "fund-wallet", "aria-label": "Fund from wallet",
  }, wallets.map((g) => el("option", { value: g.id },
    g.name + " (" + netOf(g).label + ")"))) : null;
  // The warning follows the typing, as the fee line of the composer does.
  const warn = el("span", { class: "hint bad", id: "fund-warn", role: "status" });
  const showWarn = () => {
    warn.textContent = fundingWarning(toZat(ui.personal.fund), b ? b.total : 0);
  };
  const amount = el("input", {
    class: "input", id: "fund-amt", type: "text", inputmode: "decimal", autocomplete: "off",
    value: ui.personal.fund, "aria-describedby": "fund-hint fund-warn",
    oninput: (ev) => { ui.personal.fund = ev.target.value; showWarn(); },
  });
  showWarn();
  return el("div", { class: "to-box", style: "display:grid;gap:10px" },
    el("span", { class: "label" }, "Fund the account"),
    el("label", { class: "field" }, el("span", {}, "Amount in ZEC"), amount,
      el("span", { class: "hint", id: "fund-hint" }, "The request asks for 3 equal notes, so the "
        + "account can send a message after each block. A wallet pays it, and its signers "
        + "approve it as they approve any payment."), warn),
    el("div", { class: "req-actions" }, pick,
      el("button", {
        class: "btn primary sm", type: "button", disabled: !wallets.length,
        onclick: act(() => fundFromWallet(pick ? pick.value : wallets[0].id)),
      }, "Fund from a wallet"),
      el("button", { class: "btn sm", type: "button", onclick: act(copyFundingRequest) },
        "Copy request")),
    wallets.length ? null : el("p", { class: "small faint" }, "You hold no seat in a "
      + personal.network + " wallet. Copy the request and pay it from any wallet."));
}

const DAMAGED_WARNING = "This account does not read. Make a backup first if you want to keep it.";

// The backup and remove buttons. `warning` adds a sentence to the question before a removal.
function accountActions(warning, canSave = true) {
  const ask = (on) => () => { ui.personal.drop = on; render(); };
  const sure = ui.personal.drop;
  return el("div", { style: "display:grid;gap:10px" },
    el("div", { class: "row-actions" },
      canSave ? el("button", { class: "btn sm", type: "button", onclick: openAccountBackup },
        "Back up account") : null,
      sure ? null : el("button", { class: "btn ghost sm", type: "button", onclick: ask(true) },
        "Remove from this browser")),
    sure ? el("div", { class: "callout bad", role: "alert" },
      el("p", {}, "Remove the account from this browser? The seed is deleted. Only a backup file "
        + "brings the account back." + (warning ? " " + warning : "")),
      el("div", { class: "dialog-actions" },
        el("button", { class: "btn", type: "button", onclick: ask(false) }, "Cancel"),
        el("button", { class: "btn", type: "button", onclick: act(removeAccount) },
          "Remove the account"))) : null);
}

// Messages to the public address, or to an address that no contact has. Nobody can say who wrote
// them, so the page marks them not verified.
export function otherMessages() {
  const items = accountInbox().other;
  if (!items.length) return null;
  const rows = chatTimeline(items, [], blockTime).slice(-50);
  return el("details", {}, el("summary", {}, "Other messages (not verified)"),
    el("p", { class: "small muted" }, items.length + " in all. Anyone who knows an address of "
      + "this account can write to it."),
    el("div", { class: "chat-log" }, rows.map((r) =>
      guard(receivedBubble, r, "Unknown sender", "Not verified", otherWhere(r.index)))));
}

// ── Personal account: contacts ──
export function contactsCard() {
  if (!personal) return null;
  const list = personal.contacts;
  return el("section", { class: "card" },
    el("div", { class: "card-head card-pad", style: "padding-bottom:12px" },
      el("h2", {}, "Contacts on chain"),
      el("button", { class: "btn sm", type: "button", onclick: openContactDialog }, "Add contact")),
    list.length ? el("div", { class: "list", style: "border-top:1px solid var(--line)" },
      list.map((c) => guard(contactRow, c)))
      : el("p", { class: "small muted card-pad" }, "Add the address of a person. You can then "
        + "write to them on chain, also if they do not use Zigs."));
}

export function openContactDialog() {
  ui.contactAdd = true;
  render();
}

function contactRow(c) {
  const name = memoShown(c.name), n = (accountInbox().chats.get(c.index) || []).length;
  return el("button", {
    class: "row-item", type: "button", "data-key": "contact-row-" + c.index,
    onclick: () => openContact(c.index),
  },
  el("span", { class: "av lg" }, initials(name)),
  el("span", { class: "ri-main" }, el("span", { class: "ri-title" }, name),
    el("span", { class: "ri-sub" }, "On chain · " + (n === 1 ? "1 message" : n + " messages"))),
  el("span", { class: "ri-end" }), el("span", { class: "chev" }, "›"));
}

function contactItem(c) {
  const here = state.contact === c.index, name = memoShown(c.name);
  return el("button", {
    class: "side-item" + (here ? " active" : ""), type: "button",
    "aria-current": here ? "page" : null, "data-key": "contact-" + c.index,
    onclick: () => openContact(c.index),
  }, el("span", { class: "av" }, initials(name)), el("span", { class: "side-name" }, name));
}

export function contactDialog() {
  const close = () => { ui.contactAdd = false; render(); };
  const net = NETWORKS[personal.network];
  return el("form", {
    class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "contact-title",
    onsubmit: act(async (ev) => {
      const fd = new FormData(ev.target);
      const made = await addPersonalContact(String(fd.get("name") || ""),
        String(fd.get("address") || ""));
      ui.contactAdd = false;
      openContact(made.index);
    }),
  },
  el("div", { class: "card-head" }, el("h2", { id: "contact-title" }, "Add a contact"),
    el("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: close },
      "×")),
  el("label", { class: "field" }, el("span", {}, "Name"), el("input", {
    class: "input", id: "oc-name", name: "name", maxlength: String(NAME_MAX), autocomplete: "off",
    required: true,
  }), el("span", { class: "hint" }, "Only you see this name.")),
  el("label", { class: "field" }, el("span", {}, "Shielded address"), el("input", {
    class: "input mono", id: "oc-addr", name: "address", placeholder: net.prefix + "…",
    autocomplete: "off", spellcheck: "false", required: true,
  })),
  el("div", { class: "callout" }, "Next, Zigs shows an address for this contact. Give it to them. "
    + "A message to that address shows in this chat."),
  el("div", { class: "dialog-actions" },
    el("button", { class: "btn", type: "button", onclick: close }, "Cancel"),
    el("button", { class: "btn primary", type: "submit", disabled: !Z || !acct }, "Add contact")));
}

// ── Personal account: a chat with a contact ──
const ON_CHAIN_FINE = "The message is a payment of no value, and your text is its memo. It is "
  + "permanent, and only the memo encryption of Zcash protects its text. Sending takes about a "
  + "minute, because this browser builds a proof. A wallet that hides payments of no value does "
  + "not show it.";
const ON_CHAIN_LIMITS = "This browser keeps the text of the messages that you sent. It is not in "
  + "the backup file. Private windows and Tor Browser forget it when they close.";

export function contactView() {
  const contact = personal && personal.contacts.find((c) => c.index === state.contact);
  if (!contact) return lobby();
  const name = memoShown(contact.name);
  return el("div", { class: "page" },
    el("header", { class: "page-head" }, el("div", { class: "ph-left" },
      el("button", {
        class: "btn ghost sm back", type: "button",
        onclick: () => { state.contact = null; render(); },
      }, "← Wallets"),
      el("h1", {}, name),
      el("div", { class: "ph-meta" },
        el("span", { class: "badge plain" }, "On chain · Zcash memos")))),
    contactAddress(contact, name),
    contactMessages(contact, name));
}

function contactAddress(contact, name) {
  const why = acct ? acctAddressWhy() : NOT_READY;
  if (why) return el("div", { class: "callout" }, why);
  const address = addressFor(contact.index);
  return el("section", { class: "card card-pad hero-card" },
    el("div", { class: "card-head" }, el("h2", {}, "Your address for " + name)),
    el("p", { class: "small muted" }, "Give this address to " + name + ". A message that reaches "
      + "it shows in this chat, marked as sent to the address you gave " + name + ". Anyone who "
      + "knows the address can write here."),
    el("div", { class: "addr-box" }, el("span", { class: "hex nowrap" }, address),
      copyBtn(address, "Copy address", "btn sm primary")),
    el("details", { class: "qr-toggle" }, el("summary", {}, "Show QR code"),
      qrBox(address, "Address for " + name)));
}

function contactMessages(contact, name) {
  const items = contactRows(contact).map((r) => guard(onChainRow, r, name));
  const none = el("p", { class: "small faint" }, "No messages yet. A message to the address above "
    + "shows here after the next block.");
  return el("section", { class: "card card-pad chat" },
    el("div", { class: "card-head" }, el("h2", {}, "Messages")),
    logBox("log-oc-" + contact.index, "Messages with " + name, items, none),
    composer({
      kind: "oc-" + contact.index, why: messageWhy(), seats: [], to: "Message to " + name,
      fine: ON_CHAIN_FINE, label: "Send on chain", key: "chat:personal:" + contact.index,
      send: (text) => sendOnChain(contact, text), plan: (text) => messagePlan(text, splitParts),
      progress: acct ? acct.progress : "",
    }),
    el("p", { class: "small faint" }, ON_CHAIN_LIMITS));
}

function onChainRow(row, name) {
  if (row.dir === "out") return sentBubble(row);
  return receivedBubble(row, name, "On chain · sent to the address you gave " + name, "");
}

// The text of a message from the chain, already through memoShown. A whole text that is a payment
// request shows as a card with the verdict "memo".
function memoBodyOf(key, text) {
  const req = requestOf(text, true, personal.network);
  if (!req) return el("p", { class: "msg-text" }, text);
  return requestCard(req, { id: key, name: "a memo", verdict: "memo", dm: true });
}

// A message from the chain, as the contact's chat and the other messages show it.
function receivedBubble(row, name, label, where) {
  const body = row.text === null ? el("p", { class: "msg-text faint" }, "Memo is not text")
    : memoBodyOf(row.key, memoShown(row.text));
  return el("div", { class: "msg" },
    el("span", { class: "av round", title: name }, initials(name)),
    el("div", { class: "msg-body" },
      el("div", { class: "msg-head" }, el("b", {}, name), el("time", {}, when(row.at)),
        el("span", { class: "vmark" + (label === "Not verified" ? " bad" : "") }, label)),
      body, where ? el("span", { class: "small faint" }, where) : null,
      row.parts > 1 ? el("span", { class: "small faint" }, "Joined from " + row.parts + " parts")
        : null,
      el("a", {
        class: "small", href: NETWORKS[personal.network].explorer + row.txid, target: "_blank",
        rel: "noopener",
      }, "View transaction ↗")));
}

function sentBubble(rec) {
  const st = sentStateOf(rec), note = sentNote(rec, st);
  const cls = st === "chain" ? " ok" : holdsNotes(st) ? "" : " bad";
  return el("div", { class: "msg" },
    el("span", { class: "av round me", title: "You" }, "Y"),
    el("div", { class: "msg-body" },
      el("div", { class: "msg-head" }, el("b", {}, "You"), el("time", {}, when(rec.at)),
        el("span", { class: "vmark" + cls }, SENT_WORDS[st])),
      el("p", { class: "msg-text" }, memoShown(rec.text)),
      el("span", { class: "small faint" }, "Fee " + zatText(rec.fee) + " ZEC"
        + (rec.parts > 1 ? " · " + rec.parts + " parts" : "")),
      note ? el("span", { class: "small faint" }, note) : null,
      st === "chain" ? el("a", {
        class: "small", href: NETWORKS[personal.network].explorer + rec.txid, target: "_blank",
        rel: "noopener",
      }, "View transaction ↗") : null));
}

// ── Members ──
function membersTab() {
  return el("div", { class: "page", style: "gap:16px" },
    el("section", { class: "card" },
      el("div", { class: "card-pad", style: "padding-bottom:14px" }, el("div", { class: "card-head" }, el("h2", {}, "Signers"), el("span", { class: "small muted" }, ruleText(state.g.t, state.g.n)))),
      el("div", { style: "border-top:1px solid var(--line)" },
        seatIds().map((i) => guard(memberRow, i)))),
    changeSignersCard(),
    el("section", { class: "card card-pad" },
      el("h2", { style: "font-size:15px" }, "Invite link"),
      el("p", { class: "small muted" }, "Signers open this wallet on another device with this "
        + "invite link and their key share backup. The link contains the wallet secret, so share "
        + "it only with signers."),
      el("div", { class: "addr-box" }, el("span", { class: "hex nowrap" }, inviteLink(state.gid)), copyBtn(inviteLink(state.gid), "Copy link")),
      secretQr(inviteLink(state.gid))));
}

// FROST fixes the signers when the key is made, so a change means a new wallet and one payment.
function changeSignersCard() {
  const moving = !!state.g.movedTo;
  return el("section", { class: "card card-pad" },
    el("h2", { style: "font-size:15px" }, "Add or remove signers"),
    el("p", { class: "small muted" }, "The signers and the approval rule are part of the wallet key, so they cannot change in place. "
      + "To change them, create a new wallet with the signers you want, then move the funds to it."),
    el("div", {}, moving
      ? el("button", { class: "btn", type: "button", onclick: () => { ui.tab = "overview"; render(); } }, "See the move")
      : el("button", { class: "btn", type: "button", disabled: !localSeats().length, onclick: () => { ui.move = true; render(); } }, "Change signers")));
}

const seatTitle = (i, s) =>
  s ? (seatMine(i) ? (s.name || "You") : s.name || "Signer " + i) : "Open seat";

function seatBadge(i) {
  const v = seatCheck(i);
  if (v === null) return el("span", { class: "badge" }, STAGE_LABEL[seatStage(i)]);
  const text = v ? "Address checked" : "Rejected address";
  return el("span", { class: "badge " + (v ? "ok" : "bad") }, text);
}

const keyBackupButton = (i) => el("button", {
  class: "btn sm", type: "button", onclick: () => openBackup(i),
}, "Back up key share");

function memberRow(i) {
  const s = state.seats[i], mine = s && seatMine(i) && sec(state.gid, i);
  const title = el("span", { class: "ri-title" }, seatTitle(i, s),
    mine ? el("span", { class: "you" }, "You") : null);
  const sub = el("span", { class: "ri-sub" }, "Seat " + i + (s ? " · joined " + when(s.at) : ""));
  const backup = mine && sec(state.gid, i).keyPackage ? keyBackupButton(i) : null;
  return el("div", { class: "member" }, avatar(i, "lg"), el("div", { class: "ri-main" }, title, sub),
    el("div", { class: "m-actions" }, seatBadge(i), backup));
}

// ── Details ──
function detailsTab() {
  return el("div", { class: "page", style: "gap:16px" }, walletFacts(), privacyCard());
}

function checkedBadge() {
  const rejected = rejectedSeats(), ver = verifiedCount(), n = state.g.n;
  if (rejected.length) {
    const text = "Seat " + rejected.join(", ") + " rejected this wallet";
    return el("span", { class: "badge bad" }, text);
  }
  return el("span", { class: "badge " + (ver === n ? "ok" : "") }, ver + " of " + n + " signers");
}

function walletFacts() {
  const w = state.wallet, net = curNet();
  const address = addrHidden()
    ? el("dd", {}, "Shown after your seat checks it against your key share.")
    : el("dd", {}, el("div", { class: "addr-full" }, addrGroups(w.address)),
      el("div", { style: "margin-top:8px" }, copyBtn(w.address, "Copy address")));
  return el("section", { class: "card card-pad" },
    el("h2", { style: "font-size:15px" }, "Wallet"),
    el("dl", { class: "kv" },
      el("dt", {}, "Address"), address,
      el("dt", {}, "Approval rule"),
      el("dd", {}, "Any " + state.g.t + " of " + state.g.n + " signers"),
      el("dt", {}, "Checked by"), el("dd", {}, checkedBadge()),
      el("dt", {}, "Network"), el("dd", {}, "Zcash " + net.label.toLowerCase()
        + (net.cap ? " · warning at " + capText(net.cap) : "")),
      el("dt", {}, "Created at block"), el("dd", { class: "mono" }, fmtInt(w.birthday)),
      el("dt", {}, "Wallet key"), el("dd", { class: "hex" }, w.group_verifying_key),
      usesV2(groupVersion()) ? [el("dt", {}, "Key setup"),
        el("dd", {}, "Built to ZIP 2005 (Proposed) so that funds can be recovered if quantum "
          + "computers break today's keys.")] : null,
      signedMode(state.gid) ? [el("dt", {}, "Signed writes"), el("dd", {}, "Each signer signs the "
        + "data it writes to this wallet. Zigs ignores data without a valid signature.")] : null),
    groupVersion() === 1 ? el("p", { class: "small muted", style: "margin-top:12px" },
      "This wallet was made before quantum recoverability (ZIP 2005). To get it, move the funds "
      + "to a new wallet with Change signers.") : null);
}

function privacyCard() {
  const w = state.wallet;
  const host = chain && chain.url ? new URL(chain.url).host : "a light-wallet server";
  return el("section", { class: "card card-pad" },
    el("h2", { style: "font-size:15px" }, "Privacy and keys"),
    el("p", { class: "small muted" }, "Your key share is created and used in this browser. "
      + "It leaves this browser only if you save a backup. The group server stores encrypted "
      + "data it cannot read. This page downloads blocks from " + host
      + ", which sees your IP address but never a key. The wallet syncs again on every load."),
    memoSwitch(host),
    el("details", {}, el("summary", {}, "Viewing key"),
      el("div", { class: "addr-full", style: "margin-top:10px" }, w.ufvk),
      el("div", { style: "margin-top:8px" }, copyBtn(w.ufvk, "Copy viewing key"))),
    el("p", { class: "small faint" }, "The viewing key shows every payment of this wallet. "
      + "Share it only with people who may see your balance."),
    activityLog());
}

// The setting that lets this browser read memos. It names the leak: the light-wallet server learns
// which transactions pay this wallet.
function memoSwitch(host) {
  const gid = state.gid, on = readsMemos(gid);
  return el("div", { class: "memo-switch" },
    el("p", { class: "small muted" }, "A memo is only in the full transaction. To read it, this "
      + "browser asks " + host + " for each transaction that pays this wallet. That server then "
      + "learns which transactions pay this wallet, and it sees your IP address. This setting "
      + "is for this browser and this wallet. It is off until you turn it on. Memos that were "
      + "read stay after you turn it off."),
    el("button", {
      class: "btn sm", type: "button", "aria-pressed": on ? "true" : "false",
      onclick: act(() => setMemoReading(gid, !on)),
    }, on ? "Reading memos: on" : "Read memos of incoming payments"));
}

function activityLog() {
  if (!state.log.length) return null;
  return el("details", {}, el("summary", {}, "Activity in this browser"),
    el("div", { class: "log" }, state.log.join("\n")));
}

// Groups of 5 characters help people compare an address by eye. Each group is its own span, so
// the spaces are only layout and a copied address has none.
const addrGroups = (addr) =>
  el("span", {}, chunks(addr).map((c) => el("span", { class: "addr-g" }, c)));

// The SVG comes from our own encoder and holds only path data, so innerHTML is safe here.
function qrBox(text, label) {
  const box = el("div", { class: "qr" });
  box.innerHTML = qrSvg(text, label);
  return box;
}
// A link with the wallet secret stays hidden until asked for: cameras and people can read screens.
function secretQr(link, what = "wallet") {
  return el("details", { class: "qr-toggle" }, el("summary", {}, "Show QR code"),
    qrBox(link, what === "chat" ? "Contact link" : "Invite link"),
    el("p", { class: "small faint" }, "Scan with a phone camera to open the " + what + " there."));
}

// ── Receive ──
function receiveDialog() {
  const w = state.wallet, hidden = addrHidden();
  const close = el("button", {
    class: "icon-btn", type: "button", "aria-label": "Close",
    onclick: () => { ui.receive = false; render(); },
  }, "×");
  const faucet = curNet().faucet
    ? el("a", { class: "btn ghost", href: curNet().faucet, target: "_blank", rel: "noopener" },
      "Get testnet ZEC ↗") : el("span");
  return el("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "recv-title" },
    el("div", { class: "card-head" }, el("h2", { id: "recv-title" }, "Receive ZEC"), close),
    atCap() ? capNote() : el("p", { class: "small muted" }, "Send " + receiveWhat()
      + " to this shielded address. Senders and the network cannot see the balance or who "
      + "controls it." + receiveLimit()),
    hidden ? null : qrBox(w.address, "Wallet address"),
    hidden ? null : el("div", { class: "addr-full" }, addrGroups(w.address)),
    el("div", { class: "dialog-actions", style: "justify-content:space-between" },
      faucet, hidden ? null : copyBtn(w.address, "Copy address", "btn primary")));
}

// ── Send ──
function addressHint(hint, to) {
  const v = to.trim(), ok = v ? onNetwork(v) : null, net = curNet().label.toLowerCase();
  hint.textContent = !v ? "" : ok ? "Valid " + net + " address"
    : "Not a shielded Zcash " + net + " address. It starts with " + curNet().prefix + ".";
  hint.className = "hint " + (!v ? "" : ok ? "ok" : "bad");
}

function payRow(r, i, rows, sumUp) {
  const c = curChain(), hint = el("span", { class: "hint" }), n = rows.length > 1 ? " " + (i + 1) : "";
  const amt = el("input", { class: "input", id: "s-amt-" + r.k, type: "text", inputmode: "decimal", placeholder: "0.00", required: true, autocomplete: "off", "aria-label": "Amount" + n, value: r.amt, oninput: (ev) => { r.amt = ev.target.value.trim(); sumUp(); } });
  const max = () => { r.amt = zatText(Math.max(0, c && c.bal ? c.bal.max_send : 0)); amt.value = r.amt; sumUp(); };
  addressHint(hint, r.to);
  return el("div", { class: "pay-row" },
    el("input", {
      class: "input mono", id: "s-to-" + r.k, type: "text", placeholder: curNet().prefix + "…",
      required: true, autocomplete: "off", spellcheck: "false",
      "aria-label": "Recipient address" + n, value: r.to,
      oninput: (ev) => {
        r.to = ev.target.value;
        fillFromRequest(r, rows, hint) || addressHint(hint, r.to);
      },
    }),
    el("div", { class: "input-wrap" }, amt, rows.length === 1 ? el("button", { class: "btn sm", type: "button", onclick: max }, "Max") : null),
    rows.length > 1 ? el("button", { class: "icon-btn", type: "button", "aria-label": "Remove recipient" + n, onclick: () => { rows.splice(i, 1); render(); } }, "×") : null,
    hint, memoBox(r, n));
}

// Shows the bytes of a memo once it comes near the limit, and says why a memo cannot be sent.
const MEMO_NEAR = 400;
function memoHint(hint, memo) {
  const bad = memoError(memo), bytes = memoBytes(memo);
  hint.textContent = bad || (bytes >= MEMO_NEAR ? bytes + " of " + MEMO_BYTES + " bytes" : "");
  hint.className = "hint" + (bad ? " bad" : "");
}

// The optional memo of one recipient.
function memoBox(r, n) {
  const hint = el("span", { class: "hint" });
  memoHint(hint, r.memo);
  return el("div", { class: "memo-row" },
    el("input", {
      class: "input", id: "s-memo-" + r.k, type: "text", placeholder: "Memo (optional)",
      autocomplete: "off", "aria-label": "Memo" + n + " (optional)", value: r.memo,
      oninput: (ev) => { r.memo = ev.target.value; memoHint(hint, r.memo); },
    }),
    hint);
}

// A whole request pasted in a recipient field replaces that row with the rows of its payees. It
// returns true when the field holds a request. The rows get new keys, so the redraw does not read
// the pasted text again.
export function fillFromRequest(r, rows, hint) {
  const req = requestOf(r.to, false);
  if (!req) return false;
  const fresh = req.payees ? payeeRows(req.payees, () => ++ui.payKey) : [];
  const tooMany = rows.length - 1 + fresh.length > MAX_PAYEES;
  const error = req.error ? requestProblem(req.error) : tooMany ? TOO_MANY : "";
  if (error) { hint.textContent = error; hint.className = "hint bad"; return true; }
  rows.splice(rows.indexOf(r), 1, ...fresh);
  render();
  return true;
}

// The rows and the errors of the "Paste a list" box: a whole request, or lines of address, amount
// and memo.
function pastedList(text) {
  const req = requestOf(text, false);
  if (!req) return parsePayeeList(text);
  if (req.error) return { rows: [], errors: [requestProblem(req.error)] };
  return { rows: req.payees, errors: [] };
}

function listProblem(rows, errors) {
  if (errors[0]) return errors[0];
  if (!rows.length) return "Paste at least one line.";
  return rows.length > MAX_PAYEES ? TOO_MANY : "";
}

function useList() {
  const box = document.getElementById("s-list"), { rows, errors } = pastedList(box.value);
  ui.listError = listProblem(rows, errors);
  if (!ui.listError) {
    ui.pay = payeeRows(rows, () => ++ui.payKey);
    box.value = ""; box.closest("details").open = false;
  }
  render();
}

// Checks each row and returns the payees in zatoshis, or throws with the row number.
function readPayees(rows) {
  const net = curNet(), own = normalized(state.wallet.address);
  return rows.map((r, i) => {
    const to = r.to.trim(), amount = toZat(r.amt), who = rows.length > 1 ? "Recipient " + (i + 1) + ": " : "";
    const memo = String(r.memo || "").trim();
    if (!onNetwork(to)) throw new Error(who + "Enter a shielded Zcash " + net.label.toLowerCase() + " address. It starts with " + net.prefix + ".");
    if (normalized(to) === own) throw new Error(who + "This is the address of this wallet. Enter the address of someone else.");
    if (!amount) throw new Error(who + "Enter an amount greater than zero, with at most 8 decimals.");
    if (memoError(memo)) throw new Error(who + memoError(memo));
    return memo ? { to, amount, memo } : { to, amount };
  });
}

function pasteList(net) {
  return el("details", { class: "paste" }, el("summary", { class: "btn sm" }, "Paste a list"),
    el("textarea", {
      class: "input mono", id: "s-list", rows: "5", spellcheck: "false",
      "aria-label": "Payment list",
      placeholder: net.prefix + "…, 0.5, October rent\n" + net.prefix + "…, 1.25",
    }),
    el("span", { class: "hint" },
      "One address and amount per line, then an optional memo. A spreadsheet copy works. "
      + "A payment request (zcash:) works too."),
    ui.listError ? el("span", { class: "hint bad" }, ui.listError) : null,
    el("button", { class: "btn sm", type: "button", onclick: useList }, "Use this list"));
}

export function sendDialog() {
  const c = curChain(), bal = c && c.bal, spendable = bal ? bal.spendable : 0, net = curNet();
  if (!ui.pay) { ui.pay = [{ k: ++ui.payKey, to: "", amt: "", memo: "" }]; ui.listError = ""; }
  const rows = ui.pay;
  const fee = el("span", {}), total = el("span", { id: "s-total" });
  const sumUp = () => {
    const f = feeEstimate(rows.length, ui.priority);
    fee.replaceChildren(money(f));
    total.replaceChildren(money(rows.reduce((n, r) => n + (toZat(r.amt) || 0), 0) + f));
  };
  const why = sendBlocker();
  const f = el("form", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "send-title", onsubmit: act(async (ev) => {
    if (why) throw new Error(why);
    const payees = readPayees(rows);
    const need = payees.reduce((n, p) => n + p.amount, 0) + feeEstimate(payees.length, ui.priority);
    if (need > spendable) throw new Error("Not enough funds: " + fmtZec(spendable) + " available, " + fmtZec(need) + " needed (amounts + fee).");
    const note = String(new FormData(ev.target).get("note") || "").trim();
    await newSpend(payees, note, null, ui.priority);
    ui.send = false;
  }) },
    el("div", { class: "card-head" }, el("h2", { id: "send-title" }, "Send ZEC"), el("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: () => { ui.send = false; render(); } }, "×")),
    el("div", { class: "field" }, el("span", {}, rows.length > 1 ? rows.length + " recipients, one transaction" : "To and amount"),
      rows.map((r, i) => payRow(r, i, rows, sumUp)),
      el("div", { class: "row-actions" },
        el("button", {
          class: "btn sm", type: "button", disabled: rows.length >= MAX_PAYEES,
          onclick: () => { rows.push({ k: ++ui.payKey, to: "", amt: "", memo: "" }); render(); },
        }, "Add recipient"),
        pasteList(net))),
    el("label", { class: "field" }, el("span", {}, "Note for signers (optional)"),
      el("input", {
        class: "input", id: "s-note", name: "note", type: "text", maxlength: "80",
        placeholder: rows.length > 1 ? "October payroll" : "Pay the audit firm",
        autocomplete: "off", value: ui.note, oninput: (ev) => { ui.note = ev.target.value; },
      }),
      el("span", { class: "hint" }, "Encrypted. Only signers of this wallet can read it.")),
    el("p", { class: "small faint" }, "A memo goes on chain with the payment. Its recipient and "
      + "every signer of this wallet can read it."),
    priorityBox(sumUp),
    el("div", { class: "summary" },
      el("div", {}, el("span", { class: "muted" }, "Available"), money(spendable)),
      el("div", {}, el("span", { class: "muted" }, "Network fee (estimate)"), fee),
      el("div", { class: "total" }, el("span", {}, "Total leaving the wallet"), total),
      el("div", {}, el("span", { class: "muted" }, "Approvals needed"), el("span", {}, state.g.t + " of " + state.g.n))),
    el("p", { class: "small faint" }, EXPIRY_NOTE),
    el("div", { class: "dialog-actions" },
      el("button", { class: "btn", type: "button", onclick: () => { ui.send = false; render(); } }, "Cancel"),
      el("button", {
        class: "btn primary", type: "submit", disabled: !Z || !!why,
      }, "Propose payment")),
    why ? el("p", { class: "small faint" }, why) : null);
  sumUp();
  return f;
}

// The expiry window of the engine (wasm/src/expiry.rs), in words.
const EXPIRY_NOTE = "The approvals must finish within about 24 hours. After that the payment "
  + "expires, and a signer proposes it again.";

// The priority fee: 10 times the standard fee, for a faster block when the network is busy. It
// is public on chain, so it marks the payment. Older builds of the apps refuse it.
function priorityBox(sumUp) {
  return el("label", { class: "ack" },
    el("input", {
      type: "checkbox", id: "s-priority", checked: ui.priority,
      onchange: (ev) => { ui.priority = ev.target.checked; sumUp(); },
    }),
    el("span", { class: "small" }, "Pay a priority fee: " + PRIORITY_FACTOR + " times the "
      + "standard fee, for a faster block when the network is busy. The fee is public on chain. "
      + "An iPhone or Mac app built before this version cannot approve it."));
}
// A prover that closed its tab leaves status "proving"; let someone else take over.
const proofStalled = (ss) => Date.now() - (ss.provingAt || 0) > 180000;

// Keyed by the transaction itself: a session whose transaction is replaced is decoded again.
function inspectOf(ss) {
  const key = ss.pczt, fvk = state.wallet.orchard_fvk;
  let ins = inspectCache.get(key);
  if (!ins && Z && key) {
    // The engine takes only strings. A document with another type would crash it.
    if (!isStr(key) || !isStr(fvk)) ins = { error: "This payment has no readable transaction." };
    else {
      try { ins = J(Z.inspect(key, fvk)); }
      catch (e) { ins = { error: e.message || String(e) }; }
    }
    inspectCache.set(key, ins);
  }
  return ins;
}

// When the payment expires, counted by the engine from the height of the last sync:
// {expired, blocks_left, seconds_left}. Null while this browser cannot tell.
export function expiryOf(ss) {
  const c = curChain(), ins = state.wallet && ss.pczt ? inspectOf(ss) : null;
  if (!c || !c.bal || !ins || ins.error || !Number.isInteger(ins.expiry_height)) return null;
  try { return J(Z.expiryState(netName(state.g), ins.expiry_height, c.bal.height)); }
  catch { return null; }
}

// The id that the payment's transaction gets on chain, from the approved PCZT. One seat writes
// `final.txid` alone, so the page never uses it to decide whether a block holds the payment.
function txidOf(ss) {
  const ins = state.wallet && ss.pczt ? inspectOf(ss) : null;
  return ins && !ins.error && isStr(ins.txid) ? ins.txid : null;
}
// A synced block holds the payment, whatever the session document says.
function onChain(ss) {
  const c = curChain(), id = txidOf(ss);
  return !!(c && c.sent && id && c.sent.has(id));
}

// A payment that no signer can approve, sign or send any more, and that no block holds: its notes
// are free again. A payment with a finished transaction can be on the network without a sent mark
// (a send that timed out after a server took it, or a mark that was not saved). So it counts as
// gone only EXPIRY_MARGIN blocks after its expiry height, as a message does, because a
// reorganisation of the last blocks can still bring it on chain.
export function expired(ss) {
  const e = !ss.error && expiryOf(ss), c = curChain();
  if (!e || onChain(ss)) return false;
  if (!ss.final) return e.expired;
  return c.bal.height >= inspectOf(ss).expiry_height + EXPIRY_MARGIN;
}

// The expiry of an open payment, or why an expired one ends here. The engine counts from the
// last sync, so the time since that sync comes off. A height from saved state gives no time.
export function expiryLine(ss) {
  const e = expiryOf(ss), ins = inspectOf(ss), c = curChain();
  if (!e || ss.error || onChain(ss)) return null;
  const at = "block " + fmtInt(ins.expiry_height);
  if (expired(ss) && signingStarted(ss)) {
    return el("div", { class: "callout bad" }, "This payment expired at " + at + ", and no synced "
      + "block holds the transaction that this page shows. This page cannot prove that the "
      + "signers signed that transaction. Check the wallet's activity and an explorer before "
      + "anyone proposes it again.");
  }
  if (expired(ss)) {
    return el("div", { class: "callout bad" }, "This payment expired at " + at + ". No signer "
      + "can approve, sign or send it now. Propose it again.");
  }
  if (e.expired) {
    return el("div", { class: "callout" }, "This payment can no longer go to the network: it "
      + "expires at " + at + ". If a signer sent it, a block can still hold it.");
  }
  if (ss.broadcastTxid) return null;
  const must = "The approvals, the proof and the send must be done by then.";
  if (!c.balAt) return el("p", { class: "small muted" }, "Expires at " + at + ". " + must);
  const left = e.seconds_left - Math.max(0, (Date.now() - c.balAt) / 1000);
  return el("p", { class: "small muted" }, "Expires at " + at + ", in about "
    + about(Math.max(0, left)) + ". " + must);
}

// A payment that has a signing package may have a signed transaction that a block holds. One seat
// can rewrite the proposal and drop the later parts, so the page cannot tell which transaction
// the signers signed (TICKETS.md, ZEC-9). It offers "Propose again" only before signing starts.
const signingStarted = (ss) => !!(ss.package || ss.signed || ss.final || ss.broadcastTxid);

// An expired payment ends with a new proposal of the same recipients, amounts, memos, note and
// fee choice, which needs new approvals. A move proposes the move again.
export async function proposeAgain(ss) {
  if (ss.move) { closeSession(); await proposeMove(); return; }
  const payees = payeesOf(ss);
  Object.assign(ui, {
    pay: payees.length ? payeeRows(payees, () => ++ui.payKey) : null, listError: "",
    note: typeof ss.note === "string" ? ss.note : "", priority: priorityTimes(inspectOf(ss)) > 0,
    send: true, sendFor: null,
  });
  closeSession();
  render();
}

// A fee above the ZIP 317 fee is a priority fee: this many times the standard fee, or 0. The
// engine refuses more than 10 times.
export const priorityTimes = (ins) => ins && !ins.error && ins.fee > ins.standard_fee
  ? Math.round((ins.fee / ins.standard_fee) * 10) / 10 : 0;

// The proposer's list, without entries that have no address text.
const payeesOf = (ss) => Array.isArray(ss.payees) ? ss.payees.filter((p) => p && typeof p.to === "string") : [];

export function recipientCheck(ss, ins) {
  if (!ins || ins.error) return { rows: [], extra: [], match: null };
  const paid = ins.lines.filter(isPayee);
  const { rows, extra } = pairPayees(payeesOf(ss), paid, normalized);
  const match = allPaid(rows, extra, ss.amount);
  const addr = ss.move ? moveAddress(ss.move) : null;
  const intoNew = addr ? paid.length === 1 && normalized(addr) === paid[0].who : null;
  return { rows, extra, match, intoNew };
}

// Only the copy that this browser's own seat in the new wallet checked counts. The store's copy
// is a claim anyone with the wallet key can write.
function moveAddress(gid) {
  const mine = mySeatSecrets(gid).find(([, s]) => s.checkedWallet);
  return mine ? J(mine[1].checkedWallet).address : null;
}

function checkWarnings(rc) {
  const out = rc.extra.map((l) => "The transaction also pays " + fmtZec(l.value) + " to " + short(l.who, 12) + ", which the proposer did not list. Do not approve it.");
  // Paid with another memo (`got` is set): the address and the amount are right.
  const memoOnly = rc.rows.filter((r) => !r.ok && r.got !== undefined);
  out.push(...memoOnly.map((r) => "The memo in the transaction for " + short(r.to, 12)
    + " is not the memo the proposer listed. Do not approve it."));
  if (!rc.rows.length) out.push("The proposal lists no recipients. Do not approve it.");
  else if (!rc.match && !rc.extra.length && !memoOnly.length) {
    out.push("The transaction does not pay what the proposer listed. Do not approve it.");
  }
  return out.map((t) => el("div", { class: "callout bad" }, t));
}

// A memo for display: "" is no memo and null is one that the engine could not read as text.
const memoWords = (m) => m === null ? "Memo is not text" : m ? memoShown(m) : "No memo";
const memoRow = (label, m, bad = false) => el("div", { class: "memo-line" + (bad ? " bad" : "") },
  el("span", { class: "label" }, label),
  el("span", { class: "memo-text" + (m ? "" : " faint") }, memoWords(m)));

// The memo lines of one payee row. For a payee paid with another memo, the memo that the
// transaction carries is the decoded one, so it shows as well.
function memoLines(r) {
  const own = r.memo == null ? "" : typeof r.memo === "string" ? r.memo : null;
  if (!r.ok && r.got !== undefined) {
    return [memoRow("Proposed memo", own), memoRow("Memo in the transaction", r.got, true)];
  }
  return own === "" ? [] : [memoRow("Memo", own)];
}

function checkHead(rc) {
  return el("div", { class: "card-head" }, el("span", { class: "label" }, rc.rows.length > 1 ? rc.rows.length + " recipients" : "To"),
    el("span", { class: "badge " + (rc.match ? "ok" : "bad") }, rc.match ? "Matches the transaction" : "Does not match the transaction"));
}

function recipientBox(ss, rc) {
  // Payments proposed before batch payments have no list; only one still open for approval needs
  // the check.
  if (rc.match === null || (!rc.rows.length && ss.package)) return null;
  return el("div", { class: "to-box" }, checkHead(rc),
    rc.rows.map((r) => el("div", { class: "payee-item" },
      el("div", { class: "payee" }, el("span", { class: "hex" }, addrGroups(r.to)),
        el("span", { class: "payee-end" }, money(r.amount), r.ok ? null
          : el("span", { class: "badge bad" },
            r.got === undefined ? "Not in the transaction" : "Memo differs"))),
      memoLines(r))),
    rc.rows.some((r) => r.memo) ? el("p", { class: "small faint" },
      "A memo goes on chain with the payment. Its recipient and every signer can read it.") : null,
    checkWarnings(rc),
    ss.move ? moveNote(ss, rc) : null);
}

function moveNote(ss, rc) {
  if (rc.intoNew === false) return el("div", { class: "callout bad" }, "This is not the address of " + groupName(ss.move) + ". Do not approve it.");
  if (rc.intoNew) return el("div", { class: "callout" }, "This moves all funds to " + groupName(ss.move) + ", the wallet that replaces this one. Your browser checked its address.");
  return el("div", { class: "callout" }, "This moves all funds to a new wallet that replaces this one. Your browser has no checked copy of its address, so it cannot check it.");
}

// The seats of this browser that can approve the payment now. None while the wallet's data is
// being checked: an approval written twice would replace its own nonces.
const approvers = (ss) => state.pending ? [] : localSeats().filter((i) => canWriteAs(i)
  && sec(state.gid, i).keyPackage && seatCheck(i) === true && !state.commits[i] && !ss.package);

const bigButton = (label, onclick, extra = {}) =>
  el("button", { class: "btn primary lg", type: "button", onclick, ...extra }, label);

function approveButtons(ss, myPending) {
  const several = localSeats().length > 1;
  return myPending.map((i) => bigButton(several ? "Approve as seat " + i : "Approve payment",
    act(() => approve(ss, i))));
}

const needsProof = (ss) => ss.signed && !ss.final
  && (ss.status !== "proving" || proofStalled(ss));

// The step after the approvals. The proof and the sent mark are signed writes, so they need a seat
// that can sign.
export function finishButtons(ss) {
  if (!mayAct()) return [];
  if (needsProof(ss)) return [bigButton("Build proof", act(() => finalizeTx(ss)))];
  // A node refuses a payment that expires within EXPIRY_MARGIN blocks (see expiryLine).
  if (!ss.final || expiryOf(ss)?.expired || onChain(ss)) return [];
  if (ss.broadcastTxid) {
    const late = Date.now() - finite(ss.broadcastAt) > RESEND_MS && inFlight().includes(ss);
    return late ? [bigButton("Send again", act(() => resendTx(ss)))] : [];
  }
  return [bigButton(ss.broadcastError ? "Send again" : "Send to network",
    act(() => broadcastTx(ss)), { disabled: !curChain() })];
}

// A sent payment that no block holds after this long may be lost: offer to send it again.
const RESEND_MS = 10 * 60 * 1000;

export function nextAction(ss, ins, rc) {
  if (expired(ss)) {
    return !signingStarted(ss) && mayAct() && localSeats().length
      ? [bigButton("Propose again", act(() => proposeAgain(ss)))] : [];
  }
  const myPending = approvers(ss);
  const canApprove = myPending.length && rc.match === true && rc.intoNew !== false;
  return canApprove ? approveButtons(ss, myPending) : finishButtons(ss);
}

const CANCEL_ASK = "Cancel this payment? No signer can approve it after this. Anyone can propose it again.";
// Until the signatures are combined, any signer can withdraw a payment, for example one that lost
// an approval. A signature share alone cannot move funds.
export const cancelAction = (ss) => ss.signed || expired(ss) || !localSeats().length || !mayAct() ? [] : [
  el("button", { class: "btn lg", type: "button", onclick: act(() => confirm(CANCEL_ASK) && cancelPayment(ss)) }, "Cancel payment"),
];

// An approval is a published commitment plus nonces kept here. Without the nonces the seat cannot
// sign, and the payment waits forever: say so instead of stalling.
function lostApproval(ss) {
  if (ss.signed || ss.error) return null;
  const chosen = (i) => !ss.package || signersOf(ss).includes(i);
  const lost = localSeats().filter((i) => state.commits[i] && !state.shares[i] && chosen(i)
    && !((sec(state.gid, i).nonces || {})[ss.id]) && !busy.has("share:" + ss.id + ":" + i));
  if (!lost.length) return null;
  return el("div", { class: "callout bad" }, "This browser does not hold its approval for this "
    + "payment any more: the browser data that held it was deleted. The payment cannot finish "
    + "with this approval. Cancel it, then propose it again.");
}

function sessionDrawer(ss) {
  const ins = inspectOf(ss), refused = ins && ins.error, rc = recipientCheck(ss, ins);
  // A cancelled or failed payment takes no more steps.
  const actions = ss.error ? [] : [...nextAction(ss, ins, rc), ...cancelAction(ss)];
  return el("aside", { class: "drawer", role: "dialog", "aria-modal": "true", "aria-label": "Payment details" },
    el("div", { class: "drawer-head" }, el("div", { style: "display:flex;align-items:center;gap:10px;min-width:0" }, el("h2", { class: "nowrap", style: "font-size:15px" }, payTitle(ss)), statusChip(ss)),
      closeBtn()),
    el("div", { class: "drawer-body" },
      leavesHead(ss, ins && !refused ? ins : null),
      refused ? el("div", { class: "callout bad" }, "Your browser refuses this payment: " + ins.error) : null,
      guard(expiryLine, ss),
      guard(recipientBox, ss, rc),
      lostApproval(ss),
      ins && !refused ? guard(breakdown, ins) : null,
      guard(timeline, ss, refused),
      guard(discussion, ss),
      ss.final ? guard(txDetails, ss) : null,
      ss.broadcastTxid ? chainSees() : null,
      ins && !refused ? el("details", { class: "small faint" }, el("summary", {}, "Technical details"),
        el("p", {}, "Signed message " + short(ins.sighash, 12) + " · " + ins.tx_version)) : null),
    actions.length ? el("div", { class: "drawer-foot" }, ...actions) : null);
}

const closeBtn = () => el("button", {
  class: "icon-btn", type: "button", "aria-label": "Close",
  onclick: () => { closeSession(); render(); },
}, "×");

// If the payment's document cannot be shown, the drawer still opens and closes.
function sessionLayer(ss) {
  try { return sessionDrawer(ss); }
  catch (e) { log("unreadable payment: " + (e && e.message ? e.message : e)); }
  return el("aside", {
    class: "drawer", role: "dialog", "aria-modal": "true", "aria-label": "Payment details",
  },
  el("div", { class: "drawer-head" }, el("h2", { style: "font-size:15px" }, "Payment"), closeBtn()),
  el("div", { class: "drawer-body" }, unreadable()));
}

// The decoded transaction is the truth. Spent notes minus change is what leaves the wallet: the
// payees and the fee.
function decodedTotals(ins) {
  const sum = (keep) => ins.lines.filter(keep).reduce((n, l) => n + finite(l.value), 0);
  const spent = sum((l) => l.kind === "spend"), paid = sum(isPayee);
  const back = sum((l) => l.kind !== "spend" && !isPayee(l));
  return { spent, paid, back, fee: spent - paid - back, leaves: spent - back };
}

function leavesHead(ss, ins) {
  const t = ins ? decodedTotals(ins) : { leaves: leavesOf(ss), fee: finite(ss.fee) };
  return el("div", { class: "leaves" },
    el("span", { class: "label" }, ins ? "Leaves the wallet" : "Proposed to leave the wallet"),
    money(t.leaves, "lg"),
    el("span", { class: "small muted" }, "includes " + zecText(t.fee)
      + (priorityTimes(ins) ? " priority fee" : " fee")),
    el("span", { class: "small muted" },
      "Proposed by " + proposer(ss) + " · " + when(ss.createdAt)));
}

function feeLabel(ins) {
  const times = priorityTimes(ins);
  return times ? "Priority fee (" + times + " times the standard fee)" : "Network fee";
}

function breakdown(ins) {
  const t = decodedTotals(ins);
  const row = (label, zat, cls = "") => el("div", {}, el("span", { class: cls }, label),
    el("span", { class: "mono " + cls }, zecText(zat)));
  const own = (l) => l.kind !== "spend" && !isPayee(l);
  const spent = ins.lines.filter((l) => l.kind === "spend");
  return el("div", { style: "display:grid;gap:8px" },
    el("span", { class: "label" }, "What this payment does"),
    el("div", { class: "lines" },
      ins.lines.filter(isPayee).map((l) => row("To " + short(l.who, 10), l.value)),
      row(feeLabel(ins), t.fee, "neg"),
      el("div", { class: "total" }, el("span", {}, "Leaves the wallet"),
        el("span", { class: "mono" }, zecText(t.leaves))),
      el("div", { class: "group" }, "Funds used"),
      spent.map((l) => row("Spent from this wallet", l.value, "neg")),
      ins.lines.filter(own).map((l) => row("Change back to this wallet", l.value, "neg"))),
    el("p", { class: "small faint" }, "Your browser decoded this from the transaction itself, "
      + "not from the proposer's description."));
}

// Each seat with its name and seat number, and a check mark when it approved.
const approverChips = () => el("div", {
  style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap",
}, seatIds().map((i) => el("span", { class: "approver" + (state.commits[i] ? " yes" : "") },
  avatar(i), el("span", { class: "small" }, named(i) + (state.commits[i] ? " ✓" : "")))));

function timeline(ss, refused) {
  const g = state.g, approvals = Object.keys(state.commits).length;
  const signers = signersOf(ss), shared = signers.filter((i) => state.shares[i]).length;
  const tl = (cls, title, body) => el("div", { class: "step " + cls }, el("span", { class: "tick" }, cls === "done" ? "✓" : cls === "bad" ? "!" : "•"), el("div", { style: "display:grid;gap:6px;min-width:0" }, el("h3", {}, title), body));
  return el("div", { class: "steps" },
    tl("done", "Proposed", el("p", {}, when(ss.createdAt))),
    tl(approvals >= g.t ? "done" : refused ? "bad" : "now", "Approvals · " + Math.min(approvals, g.t) + " of " + g.t + " needed",
      approverChips()),
    tl(ss.error ? "bad" : ss.signed ? "done" : ss.package ? "now" : "", "Combined signature",
      el("p", {}, ss.error ? ss.error : ss.signed ? "All signatures combined and verified." : ss.package ? "Signing · " + shared + " of " + signers.length + " shares" : "Starts after " + g.t + " approvals.")),
    tl(ss.final ? "done" : ss.status === "proving" ? "now" : "", "Proof",
      el("p", {}, ss.final ? "Proof built and the whole transaction checked." : ss.status === "proving" && !proofStalled(ss) ? "A signer's browser is building the proof · " + elapsed(ss.provingAt) + " of about a minute." : "Any signer can build the zero-knowledge proof once the payment is signed.")),
    tl(ss.broadcastTxid ? "done" : ss.broadcastError ? "bad" : ss.final ? "now" : "", "Sent to the network",
      el("div", { style: "display:grid;gap:8px" },
        ss.broadcastTxid ? el("p", {}, when(ss.broadcastAt) + " · ", el("a", { href: curNet().explorer + ss.broadcastTxid, target: "_blank", rel: "noopener" }, "View in explorer ↗"))
          : el("p", {}, ss.final ? "Any signer can send the finished transaction." : "Available after the proof."),
        ss.broadcastError && !ss.broadcastTxid ? el("div", { class: "callout bad" }, ss.broadcastError) : null)));
}

export function txDetails(ss) {
  const size = Number.isFinite(ss.final.size) ? fmtInt(ss.final.size) + " bytes" : "unknown";
  const id = txidOf(ss);
  const falseId = id && id !== ss.final.txid ? el("div", { class: "callout bad" }, "The finished "
    + "transaction names the id " + short(String(ss.final.txid), 12) + ", but the proposal gives "
    + "the id " + short(id, 12) + ". One signer's device wrote one of them alone. Check the "
    + "payment in an explorer.") : null;
  return el("div", { style: "display:grid;gap:10px" },
    el("span", { class: "label" }, "Transaction"),
    falseId,
    el("dl", { class: "kv", style: "grid-template-columns:110px minmax(0,1fr)" },
      el("dt", {}, "ID"), el("dd", { class: "hex" }, id || ss.final.txid),
      el("dt", {}, "Size"), el("dd", {}, size)),
    el("details", {}, el("summary", {}, "Raw transaction"),
      el("div", { class: "log" }, ss.final.tx_hex),
      el("div", { style: "margin-top:8px" }, copyBtn(ss.final.tx_hex, "Copy hex"))));
}

// What an observer of the chain learns from a sent payment.
function chainSees() {
  const hidden = () => el("span", { class: "redact", role: "img", "aria-label": "Hidden" });
  const row = (name) => [el("dt", {}, name), el("dd", {}, hidden())];
  return el("div", { style: "display:grid;gap:10px" },
    el("span", { class: "label" }, "What the chain sees"),
    el("p", { class: "small" }, "One shielded transaction."),
    el("dl", { class: "kv", style: "grid-template-columns:110px minmax(0,1fr)" },
      ["Recipients", "Amounts", "Signers", "Approval rule"].flatMap(row)),
    el("p", { class: "small faint" }, "The number of actions is public. So is the fee."));
}

document.addEventListener("visibilitychange", render);
window.addEventListener("focus", render);
const endCompose = () => {
  if (!composing) return;
  composing = false; drawPending = false; render();
};
document.addEventListener("compositionstart", () => { composing = true; });
document.addEventListener("compositionend", endCompose);
document.addEventListener("focusout", endCompose);
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  if (state.sid) closeSession();
  else {
    ui.send = false; ui.create = false; ui.receive = false; ui.move = false; ui.newChat = false;
    ui.contactAdd = false;
    closeBackup();
  }
  render();
});
// New blocks every 25 s: refresh the open wallet once a minute while someone looks at it.
setInterval(() => {
  if (document.visibilityState !== "visible") return;
  for (const c of [curChain(), acct]) if (c && !c.syncing) runSync(c);
}, 60000);

// The page does not wait for the saved account: it opens at once, and the account follows.
export function startUp() {
  personalPending = true;
  boot();
  rereadPersonal().finally(() => { personalPending = false; startAccount(); render(); });
}
