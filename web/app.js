// The Zigs web app. Loaded by index.html as a module, so the page needs no inline script.
import { qrSvg } from "/qr.js";
import { parsePayeeList, toZat, zatText } from "/payees.js";
import { createPasskey, unlockKey, seal, open as openVault, parseVault } from "/vault.js";
import {
  abortText, backupName, boxPairMatches, checkNetwork, chunks, confirmGate, conflictReason, finite,
  fitsPublished, fmtInt, frostId, heldRefusal, keysOf, lateFields, LINK_CHAT_ID, linkRefusal,
  makePassphrase, numberClash, passIssue, restoredSecret, samePackages, seatOwned, settledFields,
  shareShape, skey, slowCall, staleRestore, takenKeys, undoPlan, walletVersion,
} from "/util.js";
import {
  byTime, canSign, chatWarning, checkText, countUnread, dmText, joinBlock, keyState, newRoom,
  newSignKey, normChats, parseDm, parseHash, parseMsg, pickRoom, pin, pinMember, pinnedMembers,
  signMsg, signPairMatches, signedText, validId, validPk, validRoom, verifyMsg,
} from "/chat.js";
// ───────────────────────── Engine (WASM) ─────────────────────────
let Z = null, engineSettled = false;   // settled: the engine loaded or failed
const engineDot = document.getElementById("engine-dot");
const engineText = document.getElementById("engine-text");
function setEngine(state, text) { engineDot.className = "dot " + state; engineText.textContent = text; }

async function loadEngine() {
  try {
    const mod = await import("./pkg/zec_frost_wasm.js");
    await mod.default();
    Z = mod;
    setEngine("ok", "Crypto engine ready (WebAssembly)");
  } catch (e) {
    setEngine("bad", "Crypto engine failed to load");
    // Tor Browser's Safer and Safest levels turn WebAssembly off.
    const why = typeof WebAssembly === "undefined"
      ? "This browser blocks WebAssembly, which Zigs needs for its cryptography. "
        + "In Tor Browser, set the security level to Standard, then reload."
      : "The WebAssembly engine did not load: " + (e && e.message ? e.message : e)
        + ". Try a current Chrome, Edge, Firefox or Safari.";
    showBanner("bad", why);
  }
  engineSettled = true;
  render(); react();
}
const J = (s) => JSON.parse(s);
const S = (o) => JSON.stringify(o);

// Slow steps (the proof, the Argon2id of a backup) run in a worker. Without a worker they run on
// the main thread, and the page freezes while the step runs, after the busy text has been drawn.
// A backup is the way back to a lost key share, so it also retries there when the worker fails
// to start. The proof does not: it would freeze the page for a minute.
let worker = null, workerSeq = 0; const workerWait = new Map();
const workerFailed = (why) =>
  Object.assign(new Error("worker failed: " + why), { workerFailed: true });
const onMainThread = (method, args) => new Promise((res, rej) => setTimeout(() => {
  try { res(slowCall(Z, method, args)); } catch (e) { rej(e); }
}, 50));
function startInWorker(method, args) {
  if (!worker) {
    worker = new Worker(new URL("./worker.js", location.href), { type: "module" });
    worker.onmessage = (ev) => {
      const w = workerWait.get(ev.data.id);
      if (!w) return;
      workerWait.delete(ev.data.id);
      if (ev.data.ok) w.res(ev.data.out);
      else w.rej(ev.data.startFailed ? workerFailed(ev.data.error) : new Error(ev.data.error));
    };
    worker.onerror = (ev) => {
      for (const w of workerWait.values()) w.rej(workerFailed(ev.message || "unknown"));
      workerWait.clear();
      worker = null;
    };
  }
  const id = ++workerSeq;
  return new Promise((res, rej) => {
    workerWait.set(id, { res, rej });
    worker.postMessage({ id, method, args });
  });
}
function engineOffThread(method, ...args) {
  let run;
  try { run = startInWorker(method, args); } catch { return onMainThread(method, args); }
  if (method === "finalize") return run;
  return run.catch((e) => { if (e && e.workerFailed) return onMainThread(method, args); throw e; });
}

// ───────────────────────── Local secrets ─────────────────────────
// Key shares, DKG secrets, signing nonces and wallet keys never leave this browser. With the
// passkey lock on, they are stored only as one sealed record (web/vault.js), and the page asks for
// the passkey when it opens.
const mem = {};
let storageOk = true;
let lockedVault = null;   // the sealed record until unlock; { damaged } if it does not parse
let vault = null;         // { rec, key } while unlocked
try {
  const raw = localStorage.getItem("zf-vault");
  if (raw) lockedVault = parseVault(raw) || { damaged: true };
} catch {}
function readPlain(name) {
  try { return JSON.parse(localStorage.getItem(name) || "{}"); }
  catch { storageOk = false; return name === "zf-secrets" ? mem : {}; }
}
let secrets = lockedVault ? {} : readPlain("zf-secrets");
let chats = normChats(lockedVault ? null : readPlain("zf-chats"));
let vaultWrite = Promise.resolve(true);
const LOCKED_ELSEWHERE = "Zigs was locked in another tab, so this tab cannot save. "
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

async function persistSealed() {
  try {
    const rec = await seal(vault.key, vault.rec, { secrets, keys: gkeys, chats });
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
function persist() {
  if (lockedVault) return Promise.resolve(false);
  if (!vault) return Promise.resolve(persistPlain());
  vaultWrite = vaultWrite.then(persistSealed);
  return vaultWrite;
}

async function lockWithPasskey() {
  if (!storageOk) throw new Error("This browser does not let the page save data.");
  const made = await createPasskey();
  // Another tab may have saved newer secrets: seal what storage holds now.
  secrets = readPlain("zf-secrets");
  gkeys = readPlain("zf-keys");
  chats = normChats(readPlain("zf-chats"));
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
  showBanner("ok", "Locked. Zigs asks for this passkey each time it opens in this browser.");
}

async function unlockVault() {
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
  vault = { rec: { cred: lockedVault.cred, salt: lockedVault.salt }, key };
  lockedVault = null;
  adoptInviteKey();   // an invite link opened while locked waits in the fragment
  boot();
}

function forgetVault() {
  try { localStorage.removeItem("zf-vault"); } catch {}
  location.reload();
}
function mySeatSecrets(gid) { return Object.entries(secrets).filter(([k]) => k.startsWith(gid + ":")).map(([k, v]) => [Number(k.split(":")[1]), v]); }
function sec(gid, seat) { return secrets[skey(gid, seat)]; }
function putSec(gid, seat, patch) {
  secrets[skey(gid, seat)] = Object.assign(secrets[skey(gid, seat)] || {}, patch);
  return persist();
}

// ───────────────────────── Platform ─────────────────────────
let db = null, sdb = null, user = null, downloads = null, me = null, canWrite = null, dbReady = false;
// Light-wallet servers in order of preference. Mainnet uses a third-party server, so the group
// server and the chain server have different operators (see PRIVACY.md).
const NETWORKS = {
  testnet: { label: "Testnet", servers: ["https://lwd.zigs.app", "https://zcash-testnet.chainsafe.dev"],
    explorer: "https://testnet.zecblock.com/tx/", prefix: "utest1", faucet: "https://zcashfaucet.jinolabs.xyz/" },
  mainnet: { label: "Mainnet", servers: ["https://zcash-mainnet.chainsafe.dev"],
    explorer: "https://zecblock.com/tx/", prefix: "u1", cap: 50000000 },
};
const netName = (g) => g && Object.hasOwn(NETWORKS, g.network) ? g.network : "testnet";
const netOf = (g) => NETWORKS[netName(g)];
const curNet = () => netOf(state.g);
const capText = (zat) => zat / 1e8 + " ZEC";
const netBadge = (g) => netOf(g).cap
  ? el("span", { class: "badge bad", title: "Real ZEC. Not audited. At " + capText(netOf(g).cap)
    + " the app warns and hides the address. It cannot block deposits." }, "Mainnet")
  : el("span", { class: "badge plain" }, "Testnet");
const SERVER_TIMEOUT_MS = 8000;
const MISSING_SECRET = "This link is missing the wallet secret. Ask for the full invite link.";
let chain = null;   // { gid, cw, prog, bal, received, ms, error, syncing } for the open group
// Last known balance per wallet, so the wallet list shows money before a wallet syncs.
// Balances are sealed with each wallet's key, so the browser's storage does not show amounts.
let balSealed = {};
try {
  balSealed = JSON.parse(localStorage.getItem("zf-bal") || "{}");
  // Entries from before sealing hold plain amounts; drop them now rather than at the next sync.
  for (const [gid, v] of Object.entries(balSealed)) if (typeof v !== "string") delete balSealed[gid];
  localStorage.setItem("zf-bal", JSON.stringify(balSealed));
} catch {}
const balCache = {};
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
// Payment proposals of every wallet where this browser holds a seat, for the approval counts.
const inbox = {}, inboxSubs = new Map();
const ready = {}, readySubs = new Map();
const state = { groups: [], gid: null, cid: null, g: null, seats: {}, dkg1: {}, dkg2: {}, confirm: {}, abort: {}, done: {}, verify: {}, wallet: null, sessions: [], sid: null, commits: {}, shares: {}, log: [] };
let unsubGroup = [], unsubSession = [];
const busy = new Set();
const inspectCache = new Map();
let banner = null;

let bannerTimer = null;
function showBanner(kind, text) {
  banner = { kind, text };
  const b = document.getElementById("banner");
  b.setAttribute("role", kind === "bad" ? "alert" : "status");
  b.hidden = false; b.className = kind;
  document.getElementById("banner-text").textContent = text;
  clearTimeout(bannerTimer);
  if (kind === "ok") bannerTimer = setTimeout(() => { b.hidden = true; }, 4000);
}
function log(msg) { state.log.unshift(new Date().toLocaleTimeString() + "  " + msg); state.log.length = Math.min(state.log.length, 60); }

// ───────────────────────── Encrypted store ─────────────────────────
// Every field under groups/{gid} is sealed with the group secret. The secret lives in the invite
// link fragment and in this browser; the server sees paths and field names only.
let gkeys = {};
if (!lockedVault) gkeys = readPlain("zf-keys");
function putKey(gid, key) { gkeys[gid] = key; persist(); }
const setHash = (h) => { try { history.replaceState(null, "", h); } catch {} };
function adoptInviteKey() {
  if (lockedVault) return;
  const { chat, id, key } = parseHash(location.hash);
  if (chat) adoptChatLink(id, key); else adoptWalletLink(id, key);
}

function adoptWalletLink(gid, key) {
  if (!key) return;
  const refusal = linkRefusal(gkeys[gid], key, isChatId(gid));
  if (refusal) showBanner("bad", refusal);
  else if (validRoom({ id: gid, key })) putKey(gid, key);
  // The id of a chat opens no wallet: clear it, or the missing-secret banner hides the reason.
  setHash(refusal === LINK_CHAT_ID ? "#" : "#" + gid);
}

// A chat and a wallet never share an id: a wallet key must not be stored under a chat id.
const isChatId = (id) => !!chats.list[id] || !!roomKeys[id];
const badChatLink = (cid, key) => !validRoom({ id: cid, key }) || !!gkeys[cid] || !!roomKeys[cid];
// The secret leaves the fragment at once. A new chat waits in joinLinks until the person clicks
// "Join chat": a page that only loads the link, such as a link scanner, must not take the place.
function adoptChatLink(cid, key) {
  if (!key) return;
  const known = chats.list[cid], bad = badChatLink(cid, key);
  if (bad) showBanner("bad", BAD_CONTACT_LINK);
  else if (known && known.key !== key) {
    showBanner("bad", "This contact link has a different secret for a chat you already have, so "
      + "it was ignored.");
  }
  else if (!known) joinLinks.set(cid, key);
  setHash(bad ? "#" : "#c." + cid);
}
const inviteLink = (gid) => location.origin + location.pathname + "#" + gid + "." + gkeys[gid];
// A message room is a namespace of its own. Its key never enters gkeys, so it is never a wallet.
// A chat is one too. Its secret is pending while this browser joins it, before it is saved.
const roomKeys = {}, pendingChats = {};
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
  return J(text);
}
function openDoc(path, raw) {
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

async function boot() {
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
    render();
  }, (e) => showBanner("bad", "Lost connection to the group server (" + e.code + "). Reload."));
  followHash();
  render();
}

// A wallet document comes from another signer. Check the fields the page counts on, so one bad
// document shows as an unreadable item and never breaks the page.
const validWallet = (g) => Number.isInteger(g.n) && g.n >= 2 && g.n <= 7
  && Number.isInteger(g.t) && g.t >= 2 && g.t <= g.n;
const cleanGroup = (id, d) => ({
  ...d, id, name: typeof d.name === "string" ? d.name : "Wallet", unreadable: !validWallet(d),
});

function watchInbox() {
  for (const g of state.groups) {
    if (!readySubs.has(g.id)) readySubs.set(g.id, sdb.doc("groups/" + g.id + "/meta/wallet").onSnapshot((d) => { ready[g.id] = d.exists ? d.data() : false; render(); }));
    if (inboxSubs.has(g.id) || !mySeatSecrets(g.id).length) continue;
    inboxSubs.set(g.id, sdb.collection("groups/" + g.id + "/sessions").onSnapshot((snap) => {
      inbox[g.id] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    }));
  }
}

// A seat records its nonces locally when it approves, so no server read is needed.
function needsMyApproval(gid, ss) {
  if (ss.status !== "collecting" || ss.package || ss.error) return false;
  // In the open wallet only owned seats count; a restored seat that does not fit cannot approve.
  const owned = gid === state.gid ? localSeats() : null;
  return mySeatSecrets(gid).some(([i, s]) => (!owned || owned.includes(i))
    && s.keyPackage && !(s.nonces && s.nonces[ss.id]));
}
const toApprove = (gid) => (gid === state.gid ? state.sessions : inbox[gid] || []).filter((ss) => needsMyApproval(gid, ss));

function sub(path, fn) {
  return sdb.collection(path).onSnapshot((snap) => { const m = {}; for (const d of snap.docs) m[d.id] = d.data(); fn(m); render(); react(); },
    (e) => log("subscription error on " + path + ": " + e.code));
}

function openGroup(gid) {
  for (const u of unsubGroup) u(); unsubGroup = [];
  closeSession();
  ui.backup = null;   // the dialog names a seat of the wallet that was open
  dropChain();
  Object.assign(state, { gid, cid: null, g: null, seats: {}, dkg1: {}, dkg2: {}, confirm: {}, abort: {}, done: {}, verify: {}, wallet: null, sessions: [], log: [] });
  if (!gid) { setHash("#"); render(); return; }
  setHash("#" + gid);
  const base = "groups/" + gid;
  unsubGroup.push(sdb.doc(base).onSnapshot((d) => {
    state.g = d.exists ? cleanGroup(d.id, d.data()) : null;
    render(); react();
  }));
  unsubGroup.push(sub(base + "/seats", (m) => { state.seats = m; pinSigners(m); }));
  unsubGroup.push(sub(base + "/dkg1", (m) => state.dkg1 = m));
  unsubGroup.push(sub(base + "/dkg2", (m) => state.dkg2 = m));
  unsubGroup.push(sub(base + "/confirm", (m) => state.confirm = m));
  unsubGroup.push(sub(base + "/abort", (m) => state.abort = m));
  unsubGroup.push(sub(base + "/done", (m) => state.done = m));
  unsubGroup.push(sub(base + "/verify", (m) => state.verify = m));
  unsubGroup.push(sdb.doc(base + "/meta/wallet").onSnapshot((d) => { state.wallet = d.exists ? d.data() : null; render(); react(); }));
  unsubGroup.push(sub(base + "/sessions", (m) => {
    state.sessions = Object.entries(m).map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => finite(b.createdAt) - finite(a.createdAt));
  }));
  render();
}

function openSession(sid) {
  closeSession();
  state.sid = sid;
  const base = "groups/" + state.gid + "/sessions/" + sid;
  unsubSession.push(sub(base + "/commits", (m) => state.commits = m));
  unsubSession.push(sub(base + "/shares", (m) => state.shares = m));
  render();
}
function closeSession() { for (const u of unsubSession) u(); unsubSession = []; state.sid = null; state.commits = {}; state.shares = {}; }

// ───────────────────────── Derived state ─────────────────────────
const seatIds = () => state.g ? Array.from({ length: state.g.n }, (_, i) => i + 1) : [];
const allSeated = () => seatIds().every((i) => {
  const s = state.seats[i];
  return s && s.uid && isStr(s.boxPk);
});
const allR1 = () => seatIds().every((i) => state.dkg1[i]);
const r2For = (to) => seatIds().filter((i) => i !== to).every((i) => state.dkg2[i + "-" + to]);
const allDone = () => seatIds().every((i) => state.done[i]);
// Every seat's published key package must be identical, and so must the ones this browser made
// itself. Equal group keys alone are not enough: seats with different packages cannot sign
// together.
function keysMatch() {
  const dones = seatIds().map((i) => state.done[i]);
  if (!dones.every((d) => isStr(d.publicKeyPackage))) return false;
  if (new Set(dones.map((d) => d.groupKey)).size !== 1) return false;
  const mine = localSeats().map((i) => sec(state.gid, i).publicKeyPackage).filter(Boolean);
  return samePackages([...dones.map((d) => d.publicKeyPackage), ...mine]);
}
const keysAgree = () => allDone() && keysMatch();
const keysDiffer = () => allDone() && !keysAgree();
// Does the key data in the seat secret `s` equal what the wallet published for seat `i`? true or
// false, or null while the documents that decide it have not loaded.
function fitState(i, s) {
  const done = state.done[i];
  if (!done || !state.g) return null;
  return fitsPublished(i, s, done) ? setupFit(i, s, done) : false;
}

// A seat of a version 2 wallet must hold the setup secret that, with the seat's published data,
// gives the full viewing key of the wallet. A seat of another version holds none.
function setupFit(i, s, done) {
  if (!s.vaultSk) return groupVersion() !== 2;
  if (!state.wallet || !Z) return null;
  const inputs = [state.wallet, done.publicKeyPackage, s.vaultSk];
  return cached(skey(state.gid, i), inputs, () => walletMatches(...inputs));
}
function walletMatches(wallet, publishedPackage, sk) {
  try { Z.walletVerifyV2(S(wallet), publishedPackage, sk); return true; } catch { return false; }
}
// The engine call is slow and a redraw asks again and again: reuse the last answer for the same
// inputs.
const lastAnswer = new Map();
function cached(key, inputs, ask) {
  const last = lastAnswer.get(key);
  if (last && last.inputs.every((x, n) => x === inputs[n])) return last.value;
  const value = ask();
  lastAnswer.set(key, { inputs, value });
  return value;
}
// A seat is this browser's when it took the seat (its identity then, or now), or restored the
// seat's key share and the share fits the wallet. Tor Browser gets a new identity each session, so
// identity alone is not enough.
const ownsSeat = (i, s) => seatOwned(state.seats[i], s, me, () => fitState(i, s));
const localSeats = () => !state.gid ? []
  : mySeatSecrets(state.gid).filter(([i, s]) => ownsSeat(i, s)).map(([i]) => i);
// This browser, or a seat it holds in the open wallet.
const isMe = (uid) => !!uid && (uid === me || localSeats().some((i) => state.seats[i].uid === uid));
// The identity other signers know: the first local seat's, which outlives a Tor session.
const myUid = () => { const i = localSeats()[0]; return i ? state.seats[i].uid : me; };
const isCreator = () => state.g && isMe(state.g.createdBy);
const seatNameOf = (uid) => (Object.values(state.seats).find((s) => s.uid === uid) || {}).name || "someone";
const curSession = () => state.sessions.find((s) => s.id === state.sid) || null;
const isStr = (x) => typeof x === "string";
const signersOf = (ss) => Array.isArray(ss.signers) ? ss.signers : [];

function seatStage(i) {
  if (!state.seats[i]) return 0;
  if (seatCheck(i) === true) return 5;
  if (state.done[i]) return 4;
  if (seatIds().filter((j) => j !== i).some((j) => state.dkg2[i + "-" + j])) return 3;
  if (state.dkg1[i]) return 2;
  return 1;
}
// A seat publishes its first key message right after joining, so stage 2 still reads as joined.
const STAGE_LABEL = ["Open", "Joined", "Joined", "Creating key", "Key ready", "Address checked"];

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

function react() {
  try {
    settleRestore();
    syncRooms();
    reactNow();
  } catch (e) { log("✗ react: " + (e && e.message ? e.message : e)); }
}

const canReact = () => !!(Z && db && state.g && !state.g.unreadable && groupVersion());
const chainReady = () => state.wallet && state.wallet.birthday && myVerified() && !keysDiffer();

function reactNow() {
  if (!canReact()) return;
  reactStops();
  reactConfirm();
  for (const i of localSeats()) reactSeat(i);
  if (chainReady()) ensureChain();
  // Group creator builds the shared wallet once all group keys agree.
  if (canCreateWallet()) once("wallet", createWallet);
  // Signing.
  const ss = curSession();
  if (ss && state.wallet) reactSession(ss);
}

// ── Key ceremony ──
// Version 1 wallets: the creator picks nk and rivk. Version 2 wallets (ZIP 2005): the signers
// agree on a secret sk together, and nk, qsk and rivk follow from it (PROTOCOL.md section 4).
const groupVersion = () => walletVersion(state.g);
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
  if (s.aborted || (!s.keyPackage && remoteAborts().length)) return;
  const started = seatMode(s) === 2 ? stepV2(i, s) : stepV1(i, s);
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
    if (text && !abortSent(i)) launch("abort:" + i, () => publishAbort(i, text));
  }
}
// A published abort document is one that exists and holds a reason.
const abortSent = (i) => !!state.abort[i] && isStr(state.abort[i].reason);
// A seat that stopped its setup also stops the seats that hold no key share yet.
const remoteAborts = () => seatIds().filter(abortSent);
const publishAbort = (i, text) => sdb.doc("groups/" + state.gid + "/abort/" + i)
  .set({ reason: text });

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
  await sdb.doc("groups/" + gid + "/done/" + i).set({
    groupKey: s.groupKey, publicKeyPackage: S(s.publicKeyPackage), at: Date.now(),
  });
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

async function round3V1(i) {
  const gid = state.gid, s = sec(gid, i);
  const r1 = {}, r2 = {};
  for (const j of seatIds()) if (j !== i) {
    r1[j] = state.dkg1[j].package;
    const sealed = state.dkg2[j + "-" + i].sealed;
    if (!isStr(sealed)) throw new Error("Seat " + j + " sent an unreadable message.");
    r2[j] = J(Z.boxOpen(s.boxSk, state.seats[j].boxPk, gid + ":" + j + "->" + i, sealed));
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
    await putSec(gid, i, ok ? { checkedWallet: wk, rejectedWallet: null } : { rejectedWallet: wk });
    await sdb.doc("groups/" + gid + "/verify/" + i).set({ ok, error, at: Date.now() });
    log("seat " + i + (ok ? ": wallet verified, ak equals my wallet key" : ": WALLET REJECTED: " + error));
  });
}

function verifyOutcome(s) {
  try { verifyWallet(s); return { ok: true, error: null }; }
  catch (e) { return { ok: false, error: e.message || String(e) }; }
}

// The wallet must name its group's network. A seat that holds sk checks every part of the wallet,
// so only version 2 verification applies to it, whatever the stored documents say. A seat without
// sk never accepts a version 2 wallet.
function verifyWallet(s) {
  checkNetwork(state.wallet, netName(state.g));
  if (s.vaultSk) return Z.walletVerifyV2(S(state.wallet), S(s.publicKeyPackage), s.vaultSk);
  if (groupVersion() === 2) throw new Error("This seat holds no setup secret for a version 2 wallet. Do not use this wallet.");
  return Z.walletVerify(S(state.wallet), S(s.publicKeyPackage));
}

const v2Secret = () => localSeats().map((i) => sec(state.gid, i))
  .find((s) => s.vaultSk && s.publicKeyPackage);
const canCreateWallet = () => isCreator() && !state.wallet && keysAgree()
  && (groupVersion() !== 2 || !!v2Secret());

async function createWallet() {
  const g = state.g, gid = state.gid, base = "groups/" + gid;
  // The wallet snapshot can arrive after the DKG ones; never replace a published wallet.
  if ((await sdb.doc(base + "/meta/wallet").get()).exists) return;
  const birthday = await Z.latestHeight(await pickServer(netOf(g)));
  const net = g.network || "testnet", mine = groupVersion() === 2 ? v2Secret() : null;
  const w = J(mine ? Z.walletCreateV2(S(mine.publicKeyPackage), net, mine.vaultSk)
    : Z.walletCreate(state.done[1].publicKeyPackage, net));
  await sdb.doc(base + "/meta/wallet").set({ ...w, birthday, at: Date.now() });
  log("wallet created: " + w.address.slice(0, 24) + "…");
}

// ── Key ceremony, version 2 ──
// The safety number covers the wallet id, t, n, the network and every seat's encryption key. The
// signers compare it out of band. A confirm document is only a claim, so a seat also keeps the
// number its person confirmed ("confirmed"), and the ceremony runs only when both agree with the
// local number.
function safetyNo() {
  if (!state.g || !allSeated()) return null;
  const keys = {}; for (const i of seatIds()) keys[i] = state.seats[i].boxPk;
  try { return Z.safetyNumber(state.gid, state.g.t, state.g.n, netName(state.g), S(keys)); }
  catch { return null; }
}
const gateOf = (s) => confirmGate(safetyNo(), s.confirmed, state.confirm, seatIds());
const canConfirm = (s) => !s.keyPackage && !s.aborted && seatMode(s) === 2;
const confirmSeatsOf = () => localSeats().filter((i) => canConfirm(sec(state.gid, i)));
// A browser that holds every seat has nobody else to compare with.
const holdsAllSeats = () => localSeats().length === state.g.n;
const confirmedBy = (no) => seatIds().filter((i) => state.confirm[i] && state.confirm[i].number === no);

// The reason a seat of this browser ended its setup, or null. This counts every seat that the
// browser holds a secret for, also a seat that the store shows under another identity.
const abortedText = () => mySeatSecrets(state.gid).map(([, s]) => s.aborted).find(Boolean) || null;

// Writes the confirm document of a seat whose person confirmed but whose document is missing, and
// confirms for itself when this browser holds every seat.
function reactConfirm() {
  const no = groupVersion() === 2 ? safetyNo() : null;
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
    await putSec(gid, i, { confirmed: no });
    await sdb.doc("groups/" + gid + "/confirm/" + i).set({ number: no });
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

const randomHex32 = () => {
  const b = new Uint8Array(32); crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
};

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
  await sdb.doc("groups/" + gid + "/dkg1/" + i).set({ package: s.r1package, commit, at: Date.now() });
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
  for (const [to, sealed] of Object.entries(boxes)) {
    await sdb.doc("groups/" + gid + "/dkg2/" + i + "-" + to).set({ sealed, echo, at: Date.now() });
  }
  await putSec(gid, i, { r2secret: secret, r1secret: null });
  log("seat " + i + ": " + Object.keys(boxes).length + " encrypted shares sent");
}

// Opens the box seat j sent to seat i: its round-2 package and its secret part of sk.
function unboxFrom(j, i, s) {
  const d = state.dkg2[j + "-" + i];
  if (d.echo !== s.echo) throw new Error(DIFFERENT);
  const bad = new Error("Seat " + j + " sent an unreadable message");
  if (!isStr(d.sealed)) throw bad;
  let box;
  try { box = J(Z.boxOpen(s.boxSk, state.seats[j].boxPk, state.gid + ":" + j + "->" + i, d.sealed)); }
  catch { throw new Error("Seat " + j + " sent a message that cannot be opened"); }
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

function reactSession(ss) {
  const fvk = state.wallet.orchard_fvk;
  // The engine takes only strings. A document with another type would crash it.
  if (!isStr(ss.pczt) || !isStr(fvk) || (ss.package != null && !isStr(ss.package))) return;
  if (ss.error) return;
  if (!ss.package && isMe(ss.createdBy)) buildPackage(ss, fvk);
  if (ss.package) signMyShares(ss, fvk);
  if (ss.package && !ss.signed) aggregateShares(ss);
}

const sessionPath = (ss) => "groups/" + state.gid + "/sessions/" + ss.id;

// Coordinator: once t approvals are in, build the signing package.
function buildPackage(ss, fvk) {
  const t = state.g.t;
  const ids = Object.keys(state.commits).map(Number).sort((a, b) => a - b).slice(0, t);
  if (ids.length < t) return;
  once("pkg:" + ss.id, async () => {
    const c = {}; for (const i of ids) c[i] = state.commits[i].commitments;
    const pkg = Z.signPackage(ss.pczt, fvk, S(c), t);
    // Two browsers can hold the same seat (a restored copy): only one writes the package.
    const ref = sdb.doc(sessionPath(ss));
    if (!(await ref.acquire({ holder: crypto.randomUUID(), ttlMs: 10000 })).acquired) return;
    const cur = await ref.get();
    if (cur.exists && cur.data().package) return;
    await ref.update({ package: pkg, signers: ids, status: "signing" });
    log("signing package sent to signers " + ids.join(", "));
  });
}

// Signer: once the package names a seat of this browser, re-verify everything and sign.
function signMyShares(ss, fvk) {
  for (const i of localSeats()) {
    const n = (sec(state.gid, i).nonces || {})[ss.id];
    if (signersOf(ss).includes(i) && n && !state.shares[i]) {
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
    const error = "The payment changed after a signer approved it.";
    await sdb.doc(sessionPath(ss)).update({ error, status: "failed" });
    throw new Error("This payment changed after you approved it, so this browser did not sign it.");
  }
  // The engine checks the approved sighash again before it signs.
  const shares = Z.signShare(ss.pczt, fvk, ss.package, S(n), S(s.keyPackage), i);
  // Save the burn before the share goes out: a nonce that comes back could sign twice.
  if (!(await putSec(gid, i, { nonces }))) {
    throw new Error("Could not save the used nonce, so the signature share was not sent.");
  }
  await sdb.doc(sessionPath(ss) + "/shares/" + i).set({ shares, at: Date.now() });
  log("seat " + i + ": signature share sent");
}

// Any participant: aggregate. The result is deterministic, so a race is harmless.
function aggregateShares(ss) {
  if (!localSeats().length || !signersOf(ss).every((i) => state.shares[i])) return;
  once("agg:" + ss.id, async () => {
    const sh = {}; for (const i of signersOf(ss)) sh[i] = J(state.shares[i].shares);
    const ref = sdb.doc(sessionPath(ss));
    let r;
    try { r = J(Z.signAggregate(ss.pczt, state.done[1].publicKeyPackage, ss.package, S(sh))); }
    catch (e) { await ref.update({ error: e.message || String(e), status: "failed" }); throw e; }
    await ref.update({ signed: r.signed_pczt, signatures: r.signatures, status: "signed" });
    log("signatures aggregated and verified under rk");
  });
}

// ───────────────────────── Actions ─────────────────────────
// `from` is the wallet this one replaces. The old wallet gets only the new id, never its key:
// signers left out of the new wallet must not get its viewing key.
async function createGroup(name, n, t, from = null, network = "testnet") {
  const ref = sdb.collection("groups").doc();
  const key = new Uint8Array(32); crypto.getRandomValues(key);
  putKey(ref.id, btoa(String.fromCharCode(...key)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
  await ref.set({ name, n, t, network, version: 2, createdBy: me, createdAt: Date.now(), movedFrom: from || undefined });
  if (from) await sdb.doc("groups/" + from).update({ movedTo: ref.id, movedAt: Date.now() });
  openGroup(ref.id);
  await takeSeat(1, 2);
}

// The seat keeps the version of its wallet and its own box key. The store can show another
// version or key later (reactStops).
async function takeSeat(i, version = groupVersion()) {
  if (!Z || !version) return;
  const ref = sdb.doc("groups/" + state.gid + "/seats/" + i);
  const lease = await ref.acquire({ holder: crypto.randomUUID(), ttlMs: 5000 });
  if (!lease.acquired) { showBanner("bad", "Someone else is taking seat " + i + " right now."); return; }
  const cur = await ref.get();
  if (cur.exists && cur.data().uid) { showBanner("bad", "Seat " + i + " is already taken."); return; }
  const kp = J(Z.boxKeypair());
  const sign = await newSignKey().catch(() => null);   // null: no Ed25519 here, so no messages
  putSec(state.gid, i, { boxSk: kp.sk, version, uid: me, ...sign });
  const name = user ? (await user.me()).name : "";
  await ref.set({ uid: me, name, boxPk: kp.pk, at: Date.now(), signPk: sign?.signPk });
  // Saved only after the store holds the seat: a failed take must not look like a replaced key.
  await putSec(state.gid, i, { boxPk: kp.pk });
  log("you took seat " + i);
}

function dropChain() { const c = chain; chain = null; if (c && !c.syncing && c.cw) c.cw.free(); }

function ensureChain() {
  if (!Z || (chain && chain.gid === state.gid)) return;
  const w = state.wallet;
  chain = { gid: state.gid, net: curNet(), ufvk: w.ufvk, birthday: w.birthday, cw: null, url: null, prog: null, bal: null, ms: 0, error: null, syncing: false };
  runSync(chain);
}

function withTimeout(promise, ms, what) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(what + " did not answer in " + ms / 1000 + " s")), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

// Returns the first light-wallet server of `net` that answers, in order of preference.
async function pickServer(net) {
  for (const url of net.servers) {
    try { await withTimeout(Z.latestHeight(url), SERVER_TIMEOUT_MS, new URL(url).host); return url; }
    catch (e) { log(new URL(url).host + " unreachable: " + (e.message || e)); }
  }
  throw new Error("No light-wallet server answers. Check your connection, then click Sync.");
}

// Wallet sync state, sealed with the group key, so a reload continues from the last block.
let idbOpen = null;
function idb(mode, fn) {
  idbOpen ||= new Promise((res, rej) => {
    const r = indexedDB.open("zigs", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("chain");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return idbOpen.then((db) => new Promise((res, rej) => {
    const tx = db.transaction("chain", mode), req = fn(tx.objectStore("chain"));
    tx.oncomplete = () => res(req.result); tx.onerror = () => rej(tx.error);
  }));
}
async function loadSnapshot(gid) {
  try { const sealed = await idb("readonly", (st) => st.get(gid)); return sealed ? Z.secretOpen(gkeys[gid], "chain\n" + gid, sealed) : null; }
  catch (e) { log("saved wallet state unreadable: " + (e.message || e)); return null; }
}
async function saveSnapshot(c) {
  try { const sealed = Z.secretSeal(gkeys[c.gid], "chain\n" + c.gid, c.cw.snapshot()); await idb("readwrite", (st) => st.put(sealed, c.gid)); }
  catch (e) { log("could not save wallet state: " + (e.message || e)); }
}

// A new server or a reload continues from saved state; without it the wallet syncs from the birthday.
async function connect(c) {
  const url = await pickServer(c.net);
  if (c.cw && c.url === url) return;
  let snap = null;
  try { snap = c.cw ? c.cw.snapshot() : await loadSnapshot(c.gid); } catch (e) { log("no usable wallet state: " + (e.message || e)); }
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

async function runSync(c) {
  if (c.syncing) return;
  c.syncing = true; c.error = null; render();
  const t0 = performance.now();
  try {
    await connect(c);
    c.bal = J(await c.cw.sync((p) => { c.prog = J(p); render(); }));
    c.received = J(c.cw.received());
    c.sent = new Set(J(c.cw.sent()));
    c.prog = null; c.ms = Math.round(performance.now() - t0);
    saveBal(c.gid, c.bal);
    saveSnapshot(c);
    log("synced to " + c.bal.height + ", spendable " + fmtZec(c.bal.spendable));
  }
  catch (e) { c.error = e.message || String(e); log("sync failed: " + c.error); }
  finally { c.syncing = false; if (chain !== c && c.cw) c.cw.free(); render(); }
}

// `payees` and `note` are the proposer's words; approvers check `payees` against the transaction.
async function newSpend(payees, note, move = null) {
  if (!chain || chain.gid !== state.gid || !chain.bal) throw new Error("The wallet has not finished its first sync.");
  payees = payees.map(({ to, amount }) => ({ to, amount }));
  const t = J(await chain.cw.createSpend(S(payees)));
  const ref = sdb.collection("groups/" + state.gid + "/sessions").doc();
  await ref.set({ createdBy: myUid(), createdAt: Date.now(), payees, note: note || null, pool: t.pool, amount: t.amount, change: t.change, fee: t.fee, noteValue: t.note_value, pczt: t.pczt, move, status: "collecting" });
  log("new spend: " + fmtZec(t.amount));
  showBanner("ok", "Payment proposed. It needs " + state.g.t + " approvals.");
  openSession(ref.id);
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

async function broadcastTx(ss) {
  const ref = sdb.doc(sessionPath(ss));
  try {
    if (!isStr(ss.final.tx_hex)) throw new Error("The finished transaction cannot be read.");
    const r = await broadcastAnywhere(ss.final.tx_hex);
    await ref.update({ broadcastTxid: r.txid || ss.final.txid, broadcastAt: Date.now(), broadcastError: null, status: "broadcast" });
    log("transaction broadcast: " + (r.txid || ss.final.txid));
    showBanner("ok", "Sent to the network. It confirms with the next block.");
    runSync(chain);
  } catch (e) {
    await ref.update({ broadcastError: e.message || String(e) });
  }
}

// Tries each server in turn; a temporary wallet is enough because broadcasting needs no sync.
async function broadcastAnywhere(txHex) {
  const errors = [];
  for (const url of curNet().servers) {
    const cw = new Z.ChainWallet(state.wallet.ufvk, state.wallet.birthday, url);
    try { return J(await withTimeout(cw.broadcast(txHex), SERVER_TIMEOUT_MS * 2, new URL(url).host)); }
    catch (e) { errors.push(new URL(url).host + ": " + (e.message || e)); }
    finally { cw.free(); }
  }
  throw new Error(errors.join("; "));
}

async function approve(ss, i) {
  const s = sec(state.gid, i), ins = inspectOf(ss);
  if (ss.error) throw new Error("This payment was cancelled or failed, so it was not approved.");
  if (!ins || ins.error) throw new Error("This browser could not check the payment, so it did not approve.");
  if (seatCheck(i) !== true) throw new Error("Seat " + i + " has not checked this wallet against its key share, so it did not approve.");
  const r = J(Z.signCommit(ss.pczt, state.wallet.orchard_fvk, S(s.keyPackage)));
  // The approval covers this exact transaction: a share is signed later only for the same sighash.
  const mine = { nonces: r.nonces, commitments: r.commitments, sighash: ins.sighash };
  if (!(await putSec(state.gid, i, { nonces: { ...(s.nonces || {}), [ss.id]: mine } }))) {
    throw new Error("Could not save the approval in this browser, so it was not sent.");
  }
  await sdb.doc(sessionPath(ss) + "/commits/" + i).set({ commitments: r.commitments, at: Date.now() });
  log("seat " + i + ": approved the spend, nonce commitment published");
  showBanner("ok", "Approved" + (localSeats().length > 1 ? " as seat " + i : "") + ".");
}

async function cancelPayment(ss) {
  if (ss.signed || ss.error) throw new Error("This payment is already signed or closed, so it cannot be cancelled.");
  const who = (state.seats[localSeats()[0]] || {}).name || "a signer";
  await sdb.doc(sessionPath(ss)).update({
    status: "cancelled", error: "Cancelled by " + who + ".", cancelledAt: Date.now(),
  });
  for (const i of localSeats()) {
    const nonces = { ...(sec(state.gid, i).nonces || {}) };
    if (!nonces[ss.id]) continue;
    delete nonces[ss.id];
    await putSec(state.gid, i, { nonces });
  }
  showBanner("ok", "Payment cancelled.");
}

async function finalizeTx(ss) {
  await sdb.doc(sessionPath(ss)).update({ status: "proving", provingAt: Date.now() });
  log("building Halo2 proof (about a minute)…");
  let out;
  try { out = await engineOffThread("finalize", ss.signed); }
  catch (e) { await sdb.doc(sessionPath(ss)).update({ status: "signed" }); throw e; }
  await sdb.doc(sessionPath(ss)).update({ status: "complete", final: out });
  log("transaction complete: " + out.txid);
  showBanner("ok", "Proof ready. Send the payment to the network.");
}

// ───────────────────────── Backups ─────────────────────────
// A backup file is the key share, sealed with a passphrase (PROTOCOL.md section 9). The engine
// does the Argon2id and the cipher. The passphrase lives only in the dialog's input and in the
// worker call, never in `ui`.
const BACKUP_KIND = "zec-frost-key-share";   // what the sealed text holds, also in a plain file
const NOT_A_BACKUP = "This file is not a Zigs backup.";
const NOT_ENCRYPTED = "This backup file is not encrypted. Make a new encrypted backup now.";
const MAX_BACKUP_BYTES = 1000000;
const PASS_NOTE = "This passphrase opens your key share. Zigs cannot recover it. Write it down and "
  + "keep it apart from the file.";

// Nonces stay out: a restored copy must never sign with a nonce this browser may also use.
function backupText(i) {
  const { nonces, backedUp, ...s } = sec(state.gid, i);
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

// Seals the seat, opens the file again in memory to prove it holds the same text, and only then
// offers the download. Returns false when the person declined to save.
async function saveBackup(i, pass) {
  // The wallet that is open can change while the engine works (the Back button).
  const gid = state.gid, wallet = state.g.name;
  const plain = backupText(i);
  const sealed = await engineOffThread("backupSeal", pass, plain);
  if (await engineOffThread("backupOpen", pass, sealed) !== plain) {
    throw new Error("The backup did not open to the same key share, so it was not saved. "
      + "Try again.");
  }
  try {
    await downloads.save({ filename: backupName(wallet, i), data: sealed });
  } catch (e) {
    if (e && e.code === "declined") return false;
    throw new Error("Backup not saved: " + (e.message || e.code));
  }
  await putSec(gid, i, { backedUp: true });
  return true;
}

function backupDialog() {
  const b = ui.backup, i = b.seat;
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
      if (!(await saveBackup(i, p))) return;
      if (ui.backup === b) ui.backup = null;
      showBanner("ok", "Backup saved. Keep the passphrase apart from the file.");
    } finally { b.busy = false; }
  });
  const form = el("form", {
    class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "backup-title",
    oninput: update, onsubmit: submit,
  },
  el("div", { class: "card-head" }, el("h2", { id: "backup-title" }, "Back up seat " + i),
    el("button", {
      class: "icon-btn", type: "button", "aria-label": "Close", onclick: closeBackup,
    }, "×")),
  el("p", { class: "small" }, PASS_NOTE),
  el("label", { class: "field" }, el("span", {}, "Passphrase"), pass),
  el("div", { class: "row-actions" },
    el("button", { class: "btn sm", type: "button", disabled: b.busy, onclick: make },
      "Make a passphrase for me"),
    b.made ? copyBtn(() => pass.value, "Copy passphrase") : null),
  b.made ? el("p", { class: "small" }, "Copy keeps the passphrase on the clipboard until you copy "
    + "something else. Write it down, then clear the clipboard.") : null,
  el("label", { class: "field" }, el("span", {}, "Type it again"), again, hint),
  el("div", { class: "callout" }, "The file holds your key share. Anyone who has the file and the "
    + "passphrase can sign as this seat."),
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

// An encrypted file asks for its passphrase. A plain file from before encryption restores at once
// and leaves the backup note up, so the person makes an encrypted file.
async function restore(file) {
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

const isObj = (x) => !!x && typeof x === "object";
const BACKUP_SEAT_MAX = 7;
const wellFormed = (b) => isObj(b) && b.kind === BACKUP_KIND && isObj(b.secret);
const validSeatRef = (b) => validId(b.group) && Number.isInteger(b.seat) && b.seat >= 1
  && b.seat <= BACKUP_SEAT_MAX;
const validKey = (b) => b.key === undefined || validRoom({ id: b.group, key: b.key });
const NO_FIT = "This backup does not fit this wallet. It was not used.";
const RESTORE_PENDING = "A restore of this seat is still being checked. Open the wallet and "
  + "wait, then try again.";

function checkShape(b) {
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
const restoreWatch = new Map();

// What a restore stores now: the allowed fields of the file without its key pairs, version and
// room, which wait for the check of settleRestore. Older backups hold nonces: a restored nonce
// could sign a second, different package, so the nonces of this browser stay. A seat that held a
// key share stays what it was: the flag `restored` would put the seat of this browser under the
// fit rule of seatOwned.
function restoredFor(b, held) {
  const nonces = (held || {}).nonces || {};
  return { ...restoredSecret(b.secret, held), nonces, ...(held ? {} : { restored: true }),
    backedUp: false };
}

// Stores the key share of a backup, from the fields that restoredFields allows. `encrypted` says
// the file was sealed: only then does the seat count as backed up, and only when the backup fits
// the wallet.
async function applyBackup(b, encrypted) {
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
function undoRestore(w) {
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
function settleRestore() {
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
  putSec(w.gid, w.seat, { backedUp: true });
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

// ───────────────────────── Messages ─────────────────────────
// Each wallet has a message room: a store namespace of its own (CHAT.md). The wallet document
// names it in the sealed field "room". Each message is signed with its seat's Ed25519 key.
const readLocal = (name) => {
  try { return { ...JSON.parse(localStorage.getItem(name) || "{}") }; } catch { return {}; }
};
const writeLocal = (name, v) => { try { localStorage.setItem(name, S(v)); } catch { /* none */ } };
// Another tab may have saved too. Merge with its copy before writing: `keep` picks the value.
function saveMerged(name, mine, keep) {
  for (const [k, v] of Object.entries(readLocal(name))) {
    mine[k] = Object.hasOwn(mine, k) ? keep(v, mine[k]) : v;
  }
  writeLocal(name, mine);
}
const oldest = (stored) => stored;   // a pin keeps the value seen first
const roomPins = readLocal("zf-rooms");      // wallet id -> first room id seen
const signPins = readLocal("zf-signpins");   // "wallet id:seat" -> first signing key seen
const readMarks = readLocal("zf-read");      // "room id:thread" -> time of the newest message read
const rooms = {};                            // wallet id -> its room id, while it matches the pin
const roomWarn = new Map(), roomSubs = new Map(), chat = {}, tried = new Set(), checked = new Map();
let signing = null;                          // does this browser have Ed25519? null until known
canSign().then((ok) => { signing = ok; render(); react(); });

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
// backed-up seat clears `backedUp` and the page asks for a new backup.
function ensureSignKey(gid, i) {
  if (!signing || validPk(state.seats[i].signPk)) return;
  throttled("sign:" + gid + ":" + i, async () => {
    const ref = sdb.doc("groups/" + gid + "/seats/" + i);
    if (!(await ref.acquire({ holder: crypto.randomUUID(), ttlMs: 10000 })).acquired) return;
    const s = sec(gid, i), made = s.signPk ? null : await newSignKey();   // read after the lease
    const unsaved = made && s.keyPackage ? { backedUp: false } : {};
    if (!(await putSec(gid, i, { ...made, ...unsaved }))) return;
    const cur = await ref.get();
    if (cur.exists && !validPk(cur.data().signPk)) await ref.update({ signPk: sec(gid, i).signPk });
  });
}

// Pins only keys that came from the store, never one this browser just made.
function pinSigners(seats) {
  let fresh = false;
  for (const [i, s] of Object.entries(seats)) {
    if (validPk(s.signPk) && pin(signPins, skey(state.gid, i), s.signPk) === "new") fresh = true;
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
  const ok = cachedCheck(m, text, pinnedPk);
  return ok === null ? "wait" : ok ? "yes" : "no";
}

// The key holds everything the result depends on, so no two messages can share an entry.
// null while the check runs. A miss clears a full cache; results that arrive later still fill it.
function cachedCheck(m, text, pk) {
  const id = S([pk, m.sig, text]);
  if (checked.has(id)) return checked.get(id);
  if (checked.size >= 5000) checked.clear();
  checked.set(id, null);
  verifyMsg(pk, m.sig, text).then((ok) => { checked.set(id, ok); render(); });
  return null;
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
const chatSubs = new Map(), chatMembers = {}, joinLinks = new Map();
const BAD_CONTACT_LINK = "This contact link is not valid. Ask for a new one.";
const MISSING_CHAT_SECRET = "This link is missing the chat secret. Ask your contact for the full "
  + "contact link.";

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

function openChat(cid) {
  if (cid) openGroup(null);
  state.cid = cid; ui.leave = false;
  setHash(cid ? "#c." + cid : "#");
  render();
}

function followHash() {
  const { chat: isChat, id } = parseHash(location.hash);
  if (isChat) { followChat(id); return; }
  const gid = id || null;
  if (gid === state.gid && !state.cid) return;
  if (gid && !gkeys[gid]) { showBanner("bad", MISSING_SECRET); return; }
  ui.tab = "overview";
  openGroup(gid);
}

// `cid` comes from parseHash: "" or 20 hex characters, so it cannot name a property of Object.
function followChat(cid) {
  if (state.cid === cid) return;
  if (joinLinks.has(cid)) openGroup(null);   // the lobby shows the join card
  else if (chats.list[cid]) openChat(cid);
  else showBanner("bad", MISSING_CHAT_SECRET);
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
    if (validId(d.id) && validPk(x.signPk)) pinChat(cid, d.id, x.signPk);
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
const fmtZec = (zat) => Number.isFinite(zat) ? zecText(zat) + " ZEC" : "an unknown amount";
const zecText = (zat) => ZEC_FMT.format(finite(zat) / 1e8);
const short = (h, n = 10) => h ? h.slice(0, n) + "…" + h.slice(-6) : "";
// A success makes an earlier error message obsolete, so it is cleared.
// A disabled button loses focus, so the key of the focused control is kept to give it back.
const act = (fn) => async (ev) => {
  ev.preventDefault();
  const b = ev.currentTarget, key = document.activeElement.dataset.key;
  if (b) b.disabled = true;
  try {
    await fn(ev);
    if (banner && banner.kind === "bad") {
      banner = null;
      document.getElementById("banner").hidden = true;
    }
  } catch (e) { showBanner("bad", e.message || String(e)); }
  finally {
    if (b) b.disabled = false;
    wantFocus = key ? { key, force: false } : null;
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
let opener = "", lastTrigger = "", wantFocus = null;   // focus bookkeeping, see draw()
// View state that only this browser cares about.
const ui = {
  forget: false, tab: "overview", send: false, pay: null, payKey: 0, listError: "",
  create: false, receive: false, move: false, net: "testnet", ack: false, notify: false,
  newChat: false, leave: false, backup: null, restore: null,
};
try { ui.notify = localStorage.getItem("zf-notify") === "1"; } catch { /* no storage */ }
const ZEC_FMT = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 });
// ZIP 317 for a payment from up to `outputs` notes: one action per output, change included.
const feeEstimate = (payees) => 5000 * Math.max(2, payees + 1);
const MAX_PAYEES = 20;
const BLOCK_SECONDS = 25;
const initials = (name) => String(name || "?").trim().split(/\s+/).map((w) => w[0]).join("")
  .slice(0, 2).toUpperCase() || "?";
const when = (ms) => {
  const d = new Date(Number.isFinite(ms) ? ms : NaN);
  const fmt = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
  return isNaN(d) ? "" : d.toLocaleString(undefined, fmt);
};

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
  if (!isMe(s.uid)) return s.name || "Signer " + i;
  return localSeats().length > 1 ? "You (seat " + i + ")" : "You";
}
function avatar(i, cls = "") {
  const s = state.seats[i], mine = s && isMe(s.uid);
  return el("span", { class: "av round " + cls + (mine ? " me" : ""), title: seatLabel(i) }, s ? initials(mine ? (s.name || "You") : s.name || "M " + i) : "+");
}
const walletKey = () => state.wallet ? S(state.wallet) : "";
// This browser's own result for its seats; other seats' results come from the store.
function seatCheck(i) {
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
function statusChip(s) {
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
const groupName = (gid) => (state.groups.find((x) => x.id === gid) || {}).name || "the new wallet";
const proposer = (ss) => isMe(ss.createdBy) ? "you" : seatNameOf(ss.createdBy);
function normalized(addr) { try { return Z.normalizeAddress(addr); } catch { return null; } }
const onNetwork = (addr) => (normalized(addr) || "").startsWith(curNet().prefix);

// Sent payments that no synced block contains yet. Until one does, the synced balance still
// counts their inputs as unspent, so the app subtracts them itself.
function inFlight() {
  const c = curChain();
  if (!c || !c.sent) return [];
  return state.sessions.filter((ss) => ss.broadcastTxid && ss.final && !c.sent.has(ss.final.txid));
}
function balanceNow(b) {
  const out = inFlight(), sum = (f) => out.reduce((n, ss) => n + finite(f(ss)), 0);
  return {
    spendable: Math.max(0, b.spendable - sum((ss) => ss.noteValue)),
    pending: b.pending + sum((ss) => ss.change),
    sending: sum(leavesOf),
  };
}

function sendBlocker() {
  const c = curChain();
  if (keysDiffer()) return "The signers hold different wallet keys. Do not use this wallet.";
  if (!localSeats().length) return "You hold no seat in this wallet.";
  if (!myVerified()) return "Your seat is still checking the wallet address.";
  if (!c || !c.bal) return "Wait for the first sync to finish.";
  // ponytail: the engine does not know about unmined spends and would pick the same notes again.
  if (inFlight().length) return "A payment is waiting for its block. Send again in a minute.";
  const b = balanceNow(c.bal);
  if (b.spendable > feeEstimate(1)) return null;
  return b.pending ? "Incoming funds need 3 confirmations first." : "This wallet has no funds yet.";
}

// Draws once per frame, however many changes arrive together. A hidden tab gets no frames, so a
// timer backs it up and the tab title still shows the approvals.
let drawPending = false, composing = false;
function render() {
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

function pageView() {
  try {
    if (lockedVault) return lockView();
    if (!dbReady) return loadingView();
    return state.gid ? groupView() : state.cid ? chatView() : lobby();
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

function draw() {
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

// Rebuilding a focused text box closes a phone's keyboard. While a message box has focus, only the
// message logs update; the whole page redraws when the box loses focus.
function typingMessage(app, parts) {
  const box = document.activeElement;
  if (!box || !box.id.startsWith("chat-text-") || !app.contains(box)) return false;
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

function layers() {
  try { return ui.newChat ? [scrim(() => ui.newChat = false), newChatDialog()] : buildLayers(); }
  catch (e) { log("unreadable layer: " + (e && e.message ? e.message : e)); return []; }
}

const scrim = (close) => el("div", { class: "scrim", onclick: () => { close(); render(); } });

// The dialogs, in the order that they take the screen: [is shown, close, build]. `open` is true in
// an open wallet that has its wallet document. A restore starts in the wallet list.
const DIALOGS = [
  [() => ui.restore, closeBackup, () => restoreDialog()],
  [(open) => ui.backup && open, closeBackup, () => backupDialog()],
  [(open) => ui.send && open, () => ui.send = false, () => sendDialog()],
  [(open) => ui.receive && open, () => ui.receive = false, () => receiveDialog()],
  [() => ui.create && !state.gid, () => ui.create = false, () => createDialog()],
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
    ...Object.keys(chats.list).map((cid) => guard(chatItem, cid)));
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

function forgetBox() {
  const cancel = () => { ui.forget = false; render(); };
  return el("div", { class: "callout bad" },
    el("p", {}, "Without the passkey, the key shares in this browser cannot be opened. Delete "
      + "them, then restore each seat from its backup file. A seat with no backup is lost, but "
      + "the wallet still works while enough other signers remain. Direct chats in this browser "
      + "are deleted too. They are not in backup files, and a chat with two people cannot be "
      + "joined again."),
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
    title: can ? "Encrypt the key shares in this browser with a passkey"
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
  return el("div", { class: "page" }, ...joins, head, body, chatsCard(), restoreInput);
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

// The choice lives in `ui`, so a live update that redraws the dialog keeps it.
function networkPick() {
  const opt = (value, title, text) => el("label", { class: "net-opt" + (ui.net === value ? " on" : "") },
    el("input", { type: "radio", name: "network", value, id: "g-net-" + value, checked: ui.net === value,
      onchange: () => { ui.net = value; render(); } }),
    el("span", { class: "net-text" }, el("b", {}, title), el("span", { class: "small muted" }, text)));
  return el("fieldset", { class: "net-pick" },
    el("legend", { class: "label" }, "Network"),
    el("div", { class: "two" },
      opt("testnet", "Testnet", "Free test coins, for trying Zigs."),
      opt("mainnet", "Mainnet", "Real ZEC. At " + capText(NETWORKS.mainnet.cap)
        + " the app warns and hides the address. It cannot block deposits.")),
    ui.net === "mainnet" ? el("label", { class: "ack" },
      el("input", { type: "checkbox", id: "g-ack", checked: ui.ack, onchange: (ev) => { ui.ack = ev.target.checked; } }),
      el("span", { class: "small" }, "I understand that Zigs is not audited and that I can lose the funds in this wallet.")) : null);
}

// ── Wallet ──
function groupView() {
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
  const ready = walletReady();
  const why = ready ? sendBlocker() : null;
  const head = [groupHead(g, ready, why), staleRestoreNote()];
  return ready ? walletView(head, why) : el("div", { class: "page" }, head, setupView());
}

const walletReady = () => !!(state.wallet && state.wallet.birthday)
  && rejectedSeats().length === 0 && !keysDiffer();

function walletView(head, why) {
  const unsaved = localSeats().filter((i) => {
    const s = sec(state.gid, i);
    return s.keyPackage && !s.backedUp;
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
function tabBar(tabs) {
  const ids = tabs.map(([id]) => id), last = ids.length - 1, at = ids.indexOf(ui.tab);
  const target = {
    ArrowRight: at >= last ? 0 : at + 1, ArrowLeft: at <= 0 ? last : at - 1, Home: 0, End: last,
  };
  const onkeydown = (ev) => {
    if (!(ev.key in target)) return;
    ev.preventDefault();
    ui.tab = ids[target[ev.key]];
    wantFocus = { key: "tab-" + ui.tab, force: true };
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

// Private windows, Tor Browser and cleared site data delete the key share with the browser data.
function backupNote(seats) {
  const text = "Back up your key share. This browser can forget it: private windows and Tor "
    + "Browser delete it when they close. The file is locked with a passphrase that you choose. "
    + "Keep the file safe, and keep the passphrase apart from it.";
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
    el("button", { class: "btn primary", type: "button", disabled: !!why, title: why, onclick: () => { ui.send = true; ui.pay = null; render(); } }, "Send"),
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
const safetyOpen = () => groupVersion() === 2 && allSeated() && !allDone() && !holdsAllSeats();

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
    class: "btn primary lg", type: "button", disabled: !Z || canWrite === false,
    onclick: act(() => (groupVersion() === 2 || confirm(NOT_ZIP2005)) && takeSeat(seat)),
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
  const n = state.g.n, no = groupVersion() === 2 ? safetyNo() : null;
  return {
    n, w: state.wallet, pairs: n * (n - 1),
    r1: Object.keys(state.dkg1).length, r2: Object.keys(state.dkg2).length,
    d: Object.keys(state.done).length, ver: verifiedCount(),
    seated: seatIds().filter((i) => state.seats[i]).length,
    mismatch: keysDiffer(), rejected: rejectedSeats(),
    v2: groupVersion() === 2, no, clash: no ? numberClash(no, state.confirm, seatIds()) : [],
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
      el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, open.map((i) => el("button", { class: "btn sm", type: "button", disabled: !Z || canWrite === false, onclick: act(() => takeSeat(i)) }, "Play seat " + i))))
    : null;
  return el("section", { class: "card card-pad" },
    el("div", { class: "card-head" }, el("h2", {}, "Seats"), el("span", { class: "small muted" }, state.g.t + " of " + state.g.n + " signers must approve")),
    el("div", { class: "seat-grid" }, seatIds().map((i) => guard(seatTile, i))),
    testing);
}

function seatTile(i) {
  const s = state.seats[i], mine = s && isMe(s.uid) && sec(state.gid, i);
  const elsewhere = s && isMe(s.uid) && !sec(state.gid, i);
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
function moveState(c) {
  const to = state.g.movedTo, ss = state.sessions.find((x) => x.move === to && !x.error);
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
  const started = state.sessions.some((x) => x.move === state.g.movedTo && !x.error);
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
    el("div", { class: "signer-list" }, seatIds().map((i) => el("span", { class: "signer" }, avatar(i), el("span", { class: "small" }, seatLabel(i))))));
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
  const cap = curNet().cap, c = curChain();
  if (!cap || !c || !c.bal) return false;
  const b = balanceNow(c.bal);
  return b.spendable + b.pending >= cap;
}
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
  const pct = p && p.tip > state.wallet.birthday ? Math.max(0, Math.min(100, ((p.height - state.wallet.birthday) / (p.tip - state.wallet.birthday)) * 100)) : 0;
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
  const got = (c && c.received || []).map((r) => ({ t: Date.now() - Math.max(0, tip - r.height) * BLOCK_SECONDS * 1000, r }));
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

function receivedRow(r) {
  return el("a", { class: "row-item", href: curNet().explorer + r.txid, target: "_blank", rel: "noopener", title: "View in explorer" },
    el("span", { class: "tx-ico in", "aria-hidden": "true" }, "↙"),
    el("span", { class: "ri-main" }, el("span", { class: "ri-title" }, "Received"), el("span", { class: "ri-sub" }, "Block " + r.height.toLocaleString())),
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
const up = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const sender = (i) => state.seats[i] ? seatLabel(i) : "Unknown sender";

function messagesCard() {
  const changed = changedSigners();
  return el("section", { class: "card card-pad chat" },
    el("div", { class: "card-head" }, el("h2", {}, "Messages"), notifyButton()),
    changed.length ? el("div", { class: "callout bad", role: "alert" }, "Signing key changed: "
      + changed.map((i) => "seat " + i).join(", ") + ". Their messages are not verified.") : null,
    chat[state.gid] ? chatLog("wallet") : null,
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
  const events = thread === "wallet" ? state.sessions.flatMap(payEvents) : [];
  return [...msgs, ...events].sort(byTime)
    .map((x) => guard(x.kind === "msg" ? msgItem : eventItem, x, roomId));
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
};

function msgItem(m, roomId) {
  return bubble(m, avatar(m.seat), sender(m.seat), trust(m, roomId));
}

function bubble(m, av, name, verdictKey) {
  const [cls, label] = TRUST[verdictKey];
  return el("div", { class: "msg" }, av,
    el("div", { class: "msg-body" },
      el("div", { class: "msg-head" }, el("b", {}, name), el("time", {}, when(m.at)),
        el("span", { class: "vmark " + cls }, label)),
      el("p", { class: "msg-text" }, m.text)));
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

// `o`: kind (names the ids, so a draft stays with its own wallet or chat; no ":" in it), why (why
// it is off), warn, seats (the senders to choose from), to (the label), fine, key (the busy key)
// and send(text, seat).
function composer(o) {
  const sending = busy.has(o.key);
  const as = o.seats.length > 1 ? el("label", { class: "composer-as small muted" }, "Send as",
    el("select", { class: "input", id: "chat-as-" + o.kind, name: "as" },
      o.seats.map((i) => el("option", { value: String(i) }, "Seat " + i)))) : null;
  return el("form", { class: "composer", onsubmit: act((ev) => submitMessage(ev.target, o)) },
    o.why ? el("p", { class: "hint" + (o.warn ? " bad" : "") }, o.why) : null,
    el("textarea", {
      class: "input", id: "chat-text-" + o.kind, name: "text", rows: "2", disabled: !!o.why,
      onkeydown: sendOnEnter, "aria-label": o.to,
      placeholder: o.to + (coarse() ? "" : ". Enter sends, Shift+Enter adds a line"),
    }),
    el("div", { class: "composer-row" }, as,
      el("button", { class: "btn primary", type: "submit", disabled: !!o.why || sending },
        sending ? "Sending…" : "Send message")),
    el("p", { class: "small faint" }, o.fine));
}

function walletComposer(thread) {
  return composer({
    kind: (thread === "wallet" ? "wallet-" : "pay-") + state.gid, why: chatWhy(),
    warn: roomWarn.has(state.gid),
    seats: sendSeats(), to: "Message to the signers", fine: FINE,
    key: "chat:" + rooms[state.gid] + ":" + thread,
    send: (text, seat) => sendMessage(thread, text, seat),
  });
}

async function submitMessage(form, o) {
  const box = form.elements.text, draft = box.value, r = checkText(draft);
  if (r.error) throw new Error(r.error);
  if (busy.has(o.key)) return;
  busy.add(o.key); render();
  try {
    await o.send(r.text, form.elements.as ? Number(form.elements.as.value) : o.seats[0]);
    // A redraw during the send replaced the form: clear the live box, but not new typing.
    const live = document.getElementById(box.id);
    if (live && live.value === draft) live.value = "";
  } finally { busy.delete(o.key); }
}

// ── Direct chat page ──
const DM_FINE = "Your contact, and anyone else who has the contact link, can read these messages. "
  + "Keep the link private. The group server stores them sealed. It sees when you write, and that "
  + "your two devices use this chat.";
const chatLink = (cid) => location.origin + location.pathname + "#c." + cid + "."
  + chats.list[cid].key;
const chatMessage = (link) => "I started a private chat with you on Zigs. Open this link: " + link
  + ". This link is a secret. Do not post it in a public place. About Zigs: https://zigs.app";

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
  return bubble(m, av, name, dmTrust(cid, m));
}

// The confirm moves focus to Cancel, so a repeated Enter cannot leave the chat.
function leaveBox(cid) {
  const ask = (on) => () => {
    ui.leave = on; wantFocus = { key: on ? "leave-no" : "leave-ask", force: true }; render();
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
  s ? (isMe(s.uid) ? (s.name || "You") : s.name || "Signer " + i) : "Open seat";

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
  const s = state.seats[i], mine = s && isMe(s.uid) && sec(state.gid, i);
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
      groupVersion() === 2 ? [el("dt", {}, "Key setup"), el("dd", {}, "Built to ZIP 2005 (Proposed) "
        + "so that funds can be recovered if quantum computers break today's keys.")] : null),
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
    el("details", {}, el("summary", {}, "Viewing key"),
      el("div", { class: "addr-full", style: "margin-top:10px" }, w.ufvk),
      el("div", { style: "margin-top:8px" }, copyBtn(w.ufvk, "Copy viewing key"))),
    el("p", { class: "small faint" }, "The viewing key shows every payment of this wallet. "
      + "Share it only with people who may see your balance."),
    activityLog());
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
    el("input", { class: "input mono", id: "s-to-" + r.k, type: "text", placeholder: curNet().prefix + "…", required: true, autocomplete: "off", spellcheck: "false", "aria-label": "Recipient address" + n, value: r.to, oninput: (ev) => { r.to = ev.target.value; addressHint(hint, r.to); } }),
    el("div", { class: "input-wrap" }, amt, rows.length === 1 ? el("button", { class: "btn sm", type: "button", onclick: max }, "Max") : null),
    rows.length > 1 ? el("button", { class: "icon-btn", type: "button", "aria-label": "Remove recipient" + n, onclick: () => { rows.splice(i, 1); render(); } }, "×") : null,
    hint);
}

function useList() {
  const box = document.getElementById("s-list"), { rows, errors } = parsePayeeList(box.value);
  ui.listError = errors[0] || (!rows.length ? "Paste at least one line." : rows.length > MAX_PAYEES ? "A payment can have at most " + MAX_PAYEES + " recipients." : "");
  if (!ui.listError) {
    ui.pay = rows.map((p) => ({ k: ++ui.payKey, to: p.to, amt: zatText(p.amount) }));
    box.value = ""; box.closest("details").open = false;
  }
  render();
}

// Checks each row and returns the payees in zatoshis, or throws with the row number.
function readPayees(rows) {
  const net = curNet(), own = normalized(state.wallet.address);
  return rows.map((r, i) => {
    const to = r.to.trim(), amount = toZat(r.amt), who = rows.length > 1 ? "Recipient " + (i + 1) + ": " : "";
    if (!onNetwork(to)) throw new Error(who + "Enter a shielded Zcash " + net.label.toLowerCase() + " address. It starts with " + net.prefix + ".");
    if (normalized(to) === own) throw new Error(who + "This is the address of this wallet. Enter the address of someone else.");
    if (!amount) throw new Error(who + "Enter an amount greater than zero, with at most 8 decimals.");
    return { to, amount };
  });
}

function pasteList(net) {
  return el("details", { class: "paste" }, el("summary", { class: "btn sm" }, "Paste a list"),
    el("textarea", { class: "input mono", id: "s-list", rows: "5", spellcheck: "false", "aria-label": "Payment list", placeholder: net.prefix + "…, 0.5\n" + net.prefix + "…, 1.25" }),
    el("span", { class: "hint" }, "One address and amount per line. A spreadsheet copy works."),
    ui.listError ? el("span", { class: "hint bad" }, ui.listError) : null,
    el("button", { class: "btn sm", type: "button", onclick: useList }, "Use this list"));
}

function sendDialog() {
  const c = curChain(), bal = c && c.bal, spendable = bal ? bal.spendable : 0, net = curNet();
  if (!ui.pay) { ui.pay = [{ k: ++ui.payKey, to: "", amt: "" }]; ui.listError = ""; }
  const rows = ui.pay;
  const fee = el("span", {}), total = el("span", { id: "s-total" });
  const sumUp = () => {
    const f = feeEstimate(rows.length);
    fee.replaceChildren(money(f));
    total.replaceChildren(money(rows.reduce((n, r) => n + (toZat(r.amt) || 0), 0) + f));
  };
  const f = el("form", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "send-title", onsubmit: act(async (ev) => {
    const payees = readPayees(rows);
    const need = payees.reduce((n, p) => n + p.amount, 0) + feeEstimate(payees.length);
    if (need > spendable) throw new Error("Not enough funds: " + fmtZec(spendable) + " available, " + fmtZec(need) + " needed (amounts + fee).");
    await newSpend(payees, String(new FormData(ev.target).get("note") || "").trim());
    ui.send = false;
  }) },
    el("div", { class: "card-head" }, el("h2", { id: "send-title" }, "Send ZEC"), el("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: () => { ui.send = false; render(); } }, "×")),
    el("div", { class: "field" }, el("span", {}, rows.length > 1 ? rows.length + " recipients, one transaction" : "To and amount"),
      rows.map((r, i) => payRow(r, i, rows, sumUp)),
      el("div", { class: "row-actions" },
        el("button", { class: "btn sm", type: "button", disabled: rows.length >= MAX_PAYEES, onclick: () => { rows.push({ k: ++ui.payKey, to: "", amt: "" }); render(); } }, "Add recipient"),
        pasteList(net))),
    el("label", { class: "field" }, el("span", {}, "Note for signers (optional)"),
      el("input", { class: "input", id: "s-note", name: "note", type: "text", maxlength: "80", placeholder: rows.length > 1 ? "October payroll" : "Pay the audit firm", autocomplete: "off" }),
      el("span", { class: "hint" }, "Encrypted. Only signers of this wallet can read it.")),
    el("div", { class: "summary" },
      el("div", {}, el("span", { class: "muted" }, "Available"), money(spendable)),
      el("div", {}, el("span", { class: "muted" }, "Network fee (estimate)"), fee),
      el("div", { class: "total" }, el("span", {}, "Total leaving the wallet"), total),
      el("div", {}, el("span", { class: "muted" }, "Approvals needed"), el("span", {}, state.g.t + " of " + state.g.n))),
    el("div", { class: "dialog-actions" },
      el("button", { class: "btn", type: "button", onclick: () => { ui.send = false; render(); } }, "Cancel"),
      el("button", { class: "btn primary", type: "submit", disabled: !(myVerified() && Z && bal) }, "Propose payment")));
  sumUp();
  return f;
}

// ── Payment drawer ──
const elapsed = (ms) => { const sec = Math.max(0, Math.floor((Date.now() - (ms || Date.now())) / 1000)); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); };
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

// The proposer's list, without entries that have no address text.
const payeesOf = (ss) => Array.isArray(ss.payees) ? ss.payees.filter((p) => p && typeof p.to === "string") : [];

// Pairs each proposed payee with one decoded output of the same address and amount. Returns the
// rows with `ok`, and the decoded outputs that no payee claimed.
function pairPayees(payees, outputs) {
  const left = [...outputs];
  const rows = payees.map((p) => {
    const i = left.findIndex((l) => l.who === normalized(p.to) && l.value === p.amount);
    if (i >= 0) left.splice(i, 1);
    return { ...p, ok: i >= 0 };
  });
  return { rows, extra: left };
}

// The decoded outputs are the truth. Each one must be a proposed payee with the same amount, and
// the proposal must list nothing else. The typed addresses only help people recognise them.
function allPaid(rows, extra, total) {
  if (!rows.length || extra.length || !rows.every((r) => r.ok)) return false;
  return rows.reduce((n, r) => n + r.amount, 0) === total;
}

function recipientCheck(ss, ins) {
  if (!ins || ins.error) return { rows: [], extra: [], match: null };
  const paid = ins.lines.filter(isPayee), { rows, extra } = pairPayees(payeesOf(ss), paid);
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
  if (!rc.rows.length) out.push("The proposal lists no recipients. Do not approve it.");
  else if (!rc.match && !rc.extra.length) out.push("The transaction does not pay what the proposer listed. Do not approve it.");
  return out.map((t) => el("div", { class: "callout bad" }, t));
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
    rc.rows.map((r) => el("div", { class: "payee" }, el("span", { class: "hex" }, addrGroups(r.to)),
      el("span", { class: "payee-end" }, money(r.amount), r.ok ? null : el("span", { class: "badge bad" }, "Not in the transaction")))),
    checkWarnings(rc),
    ss.move ? moveNote(ss, rc) : null);
}

function moveNote(ss, rc) {
  if (rc.intoNew === false) return el("div", { class: "callout bad" }, "This is not the address of " + groupName(ss.move) + ". Do not approve it.");
  if (rc.intoNew) return el("div", { class: "callout" }, "This moves all funds to " + groupName(ss.move) + ", the wallet that replaces this one. Your browser checked its address.");
  return el("div", { class: "callout" }, "This moves all funds to a new wallet that replaces this one. Your browser has no checked copy of its address, so it cannot check it.");
}

function nextAction(ss, ins, rc) {
  const myPending = localSeats().filter((i) => sec(state.gid, i).keyPackage && seatCheck(i) === true && !state.commits[i] && !ss.package);
  const canApprove = myPending.length && rc.match === true && rc.intoNew !== false;
  if (canApprove) return myPending.map((i) => el("button", { class: "btn primary lg", type: "button", onclick: act(() => approve(ss, i)) }, localSeats().length > 1 ? "Approve as seat " + i : "Approve payment"));
  if (ss.signed && !ss.final && (ss.status !== "proving" || proofStalled(ss))) return [el("button", { class: "btn primary lg", type: "button", onclick: act(() => finalizeTx(ss)) }, "Build proof")];
  if (ss.final && !ss.broadcastTxid) return [el("button", { class: "btn primary lg", type: "button", disabled: !curChain(), onclick: act(() => broadcastTx(ss)) }, ss.broadcastError ? "Send again" : "Send to network")];
  return [];
}

const CANCEL_ASK = "Cancel this payment? No signer can approve it after this. Anyone can propose it again.";
// Until the signatures are combined, any signer can withdraw a payment, for example one that lost
// an approval. A signature share alone cannot move funds.
const cancelAction = (ss) => ss.signed || !localSeats().length ? [] : [
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
    el("span", { class: "small muted" }, "includes " + zecText(t.fee) + " fee"),
    el("span", { class: "small muted" },
      "Proposed by " + proposer(ss) + " · " + when(ss.createdAt)));
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
      row("Network fee", t.fee, "neg"),
      el("div", { class: "total" }, el("span", {}, "Leaves the wallet"),
        el("span", { class: "mono" }, zecText(t.leaves))),
      el("div", { class: "group" }, "Funds used"),
      spent.map((l) => row("Spent from this wallet", l.value, "neg")),
      ins.lines.filter(own).map((l) => row("Change back to this wallet", l.value, "neg"))),
    el("p", { class: "small faint" }, "Your browser decoded this from the transaction itself, "
      + "not from the proposer's description."));
}

function timeline(ss, refused) {
  const g = state.g, approvals = Object.keys(state.commits).length;
  const signers = signersOf(ss), shared = signers.filter((i) => state.shares[i]).length;
  const tl = (cls, title, body) => el("div", { class: "step " + cls }, el("span", { class: "tick" }, cls === "done" ? "✓" : cls === "bad" ? "!" : "•"), el("div", { style: "display:grid;gap:6px;min-width:0" }, el("h3", {}, title), body));
  return el("div", { class: "steps" },
    tl("done", "Proposed", el("p", {}, when(ss.createdAt))),
    tl(approvals >= g.t ? "done" : refused ? "bad" : "now", "Approvals · " + Math.min(approvals, g.t) + " of " + g.t + " needed",
      el("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap" }, seatIds().map((i) => el("span", { class: "approver" + (state.commits[i] ? " yes" : "") }, avatar(i), el("span", { class: "small" }, seatLabel(i) + (state.commits[i] ? " ✓" : "")))))),
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

function txDetails(ss) {
  const size = Number.isFinite(ss.final.size) ? fmtInt(ss.final.size) + " bytes" : "unknown";
  return el("div", { style: "display:grid;gap:10px" },
    el("span", { class: "label" }, "Transaction"),
    el("dl", { class: "kv", style: "grid-template-columns:110px minmax(0,1fr)" },
      el("dt", {}, "ID"), el("dd", { class: "hex" }, ss.final.txid),
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

// Another tab saved: take its secrets and chats, so this tab neither misses nor overwrites them.
const TAB_KEYS = new Set(["zf-secrets", "zf-chats", "zf-vault"]);
async function takeFromTab(key, value) {
  if (!vault && key === "zf-secrets") secrets = JSON.parse(value);
  if (!vault && key === "zf-chats") chats = normChats(JSON.parse(value));
  if (vault && key === "zf-vault") {
    const got = await openVault(vault.key, parseVault(value));
    ({ secrets, keys: gkeys } = got);
    chats = normChats(got.chats);
  }
}

window.addEventListener("storage", async (ev) => {
  if (lockedVault || !TAB_KEYS.has(ev.key) || !ev.newValue) return;
  try { await takeFromTab(ev.key, ev.newValue); }
  catch (e) { log("could not read another tab's save: " + (e.message || e)); }
  render(); react();
});

document.addEventListener("visibilitychange", render);
window.addEventListener("focus", render);
const endCompose = () => {
  if (!composing) return;
  composing = false; drawPending = false; render();
};
document.addEventListener("compositionstart", () => { composing = true; });
document.addEventListener("compositionend", endCompose);
document.addEventListener("focusout", endCompose);
document.getElementById("banner-close").addEventListener("click", () => {
  document.getElementById("banner").hidden = true;
});
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  if (state.sid) closeSession();
  else {
    ui.send = false; ui.create = false; ui.receive = false; ui.move = false; ui.newChat = false;
    closeBackup();
  }
  render();
});

// Back, forward and pasted invite links change only the fragment; follow them.
window.addEventListener("hashchange", () => {
  adoptInviteKey();
  if (!lockedVault) followHash();
});
// New blocks every 25 s: refresh the open wallet once a minute while someone looks at it.
setInterval(() => { const c = curChain(); if (c && !c.syncing && document.visibilityState === "visible") runSync(c); }, 60000);

adoptInviteKey();
draw();   // the first paint does not wait for the engine
loadEngine().then(() => lockedVault ? render() : boot());
