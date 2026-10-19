// Boot, the sealed store, the group and session watchers and the approval queue.
import { finite } from "./util.js";
import { trustShape, validShape } from "./signed.js";
import {
  emptyRaw, inbox, inboxSubs, log, raw, rawInbox, rawReady, readySubs, showBanner, state, ui,
} from "./app-state.js";
import { J, oldest, S, saveMerged } from "./app-kit.js";
import { Z } from "./app-engine.js";
import { chats, gkeys, mySeatSecrets, storageOk } from "./app-keystore.js";
import { localSeats } from "./app-seats.js";
import { followHash, setHash } from "./app-links.js";
import { dropChain } from "./app-chain.js";
import {
  loggedIgnored, pinConfirmedNet, pinNetwork, pinVersion, refilter, signedMode, signPins,
} from "./app-filter.js";
import { syncRooms } from "./app-messages.js";
import { expired, noApproval } from "./app-payments.js";
import { startAccount } from "./app-account.js";
import { render } from "./app-loop.js";
import { resetSolStart, sol, solWatch } from "./app-sol.js";
import { confirmedNetwork } from "./app-dkg.js";

export let db = null, sdb = null, user = null, downloads = null, me = null, canWrite = null, dbReady = false;
export function setDb(v) { sdb = v; db = v; }
export function setMe(v) { me = v; }
export function setDownloads(v) { downloads = v; }
export let unsubGroup = [], unsubSession = [];
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
// A proposal with no package and no error, whose parts all passed their check.
const openProposal = (ss) => ss.status === "collecting" && !ss.package && !ss.error && !ss.checking;
export function needsMyApproval(gid, ss) {
  if (!openProposal(ss)) return false;
  if (gid === state.gid && expired(ss)) return false;
  // Never again once this browser saw the signing start or a seat approved (TICKETS.md ZEC-9).
  if (noApproval(ss, gid)) return false;
  // In the open wallet only owned seats count; a restored seat that does not fit cannot approve.
  const owned = gid === state.gid ? localSeats() : null;
  return mySeatSecrets(gid).some(([i, s]) => (!owned || owned.includes(i))
    && s.keyPackage && !(s.nonces && s.nonces[ss.id]) && !(s.marks || {})[ss.id]?.approved);
}
export const toApprove = (gid) => (gid === state.gid ? state.sessions : inbox[gid] || []).filter((ss) => needsMyApproval(gid, ss));

// `fail` runs when the subscription ends with an error: the page must not show old data as all.
function sub(path, fn, fail) {
  return sdb.collection(path).onSnapshot((snap) => {
    const m = {}; for (const d of snap.docs) m[d.id] = d.data();
    fn(m); refilter();
  }, (e) => { log("subscription error on " + path + ": " + e.code); fail?.(e); });
}

let groupDoc = null;   // the group document of the open wallet, as the store shows it

// The network that the people of the open wallet confirmed replaces the first one that this device
// saw (SOL-34). The reactor asks first, before a setup step compares safety numbers. A chain that
// runs on the other network starts again.
export function learnNetwork() {
  const gid = state.gid, before = state.g?.network;
  if (!groupDoc || !pinConfirmedNet(gid, confirmedNetwork())) return;
  state.g = cleanGroup(gid, groupDoc);
  state.groups = state.groups.map((g) => (g.id === gid ? cleanGroup(gid, groupDoc) : g));
  if (state.g.network !== before) dropChain();
}

export function openGroup(gid) {
  for (const u of unsubGroup) u(); unsubGroup = [];
  groupDoc = null;
  sol?.close();
  closeSession();
  watchOnly([]);
  // A form filled from a request belongs to the wallet it was made for.
  if (ui.sendFor && ui.sendFor !== gid) { ui.send = false; ui.pay = null; ui.note = ""; }
  ui.after = null;   // the notes of an expired payment of the wallet that was open
  ui.backup = null;   // the dialog names a seat of the wallet that was open
  dropChain();
  Object.assign(state, {
    gid, cid: null, contact: null, g: null, seats: {}, seatsLoaded: false, seatsSettled: false,
    sessionsLoaded: false, sessionsFailed: false,
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
  unsubGroup.push(sdb.doc(base).onSnapshot((d) => {
    groupDoc = d.exists ? d.data() : null;
    state.g = groupDoc ? cleanGroup(d.id, groupDoc) : null;
    solWatch();
    refilter();
  }));
  unsubGroup.push(sub(base + "/seats", (m) => { raw.seats = m; state.seatsLoaded = true; }));
  for (const name of ["dkg1", "dkg2", "confirm", "abort", "done", "verify"]) {
    unsubGroup.push(sub(base + "/" + name, (m) => { raw[name] = m; }));
  }
  // The Approvals inbox says that nothing waits only once the payments arrived.
  unsubGroup.push(sub(base + "/sessions", (m) => {
    raw.sessions = m;
    Object.assign(state, { sessionsLoaded: true, sessionsFailed: false });
  }, () => { state.sessionsFailed = true; render(); }));
  unsubGroup.push(sdb.doc(base + "/meta/wallet").onSnapshot((d) => {
    raw.wallet = d.exists ? d.data() : null;
    refilter();
  }));
  solWatch();
  render();
}

export function openSession(sid) {
  closeSession();
  state.sid = sid;
  const base = "groups/" + state.gid + "/sessions/" + sid;
  unsubSession.push(sub(base + "/commits", (m) => { raw.commits = m; }));
  unsubSession.push(sub(base + "/shares", (m) => { raw.shares = m; }));
  render();
}
export function closeSession() {
  for (const u of unsubSession) u();
  unsubSession = []; state.sid = null; ui.release = null;
  state.commits = {}; state.shares = {}; raw.commits = {}; raw.shares = {};
}

// The approvals and shares of the payments that this browser must act on while their drawer is
// closed (M5): session id to { gid, raw: { commits, shares }, unsubs }. A snapshot that comes after
// an unwatch or for another wallet changes nothing.
export const watched = new Map();
function watchSession(sid) {
  const gid = state.gid, base = "groups/" + gid + "/sessions/" + sid;
  const w = { gid, raw: { commits: {}, shares: {} }, unsubs: [] };
  const take = (name) => (m) => {
    if (watched.get(sid) === w && state.gid === gid) w.raw[name] = m;
  };
  watched.set(sid, w);
  w.unsubs.push(sub(base + "/commits", take("commits")), sub(base + "/shares", take("shares")));
}
function unwatch(sid) {
  for (const u of watched.get(sid)?.unsubs ?? []) u();
  watched.delete(sid);
}
/** Watches exactly the sessions `sids` of the open wallet. */
export function watchOnly(sids) {
  const want = new Set(sids);
  for (const [sid, w] of watched) if (!want.has(sid) || w.gid !== state.gid) unwatch(sid);
  for (const sid of want) if (!watched.has(sid)) watchSession(sid);
}
