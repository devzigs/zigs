// The Zigs web app. Loaded by index.html as a module, so the page needs no inline script.
import { qrSvg } from "/qr.js";
import { parsePayeeList, toZat, zatText } from "/payees.js";
import { createPasskey, unlockKey, seal, open as openVault, parseVault } from "/vault.js";
import { chunks, finite, fmtInt, samePackages } from "/util.js";
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

// Slow step (proof) in a worker, with main-thread fallback.
let worker = null, workerSeq = 0; const workerWait = new Map();
function finalizeOffThread(signedPczt) {
  try {
    if (!worker) {
      worker = new Worker(new URL("./worker.js", location.href), { type: "module" });
      worker.onmessage = (ev) => { const w = workerWait.get(ev.data.id); if (w) { workerWait.delete(ev.data.id); ev.data.ok ? w.res(ev.data.out) : w.rej(new Error(ev.data.error)); } };
      worker.onerror = (ev) => { for (const w of workerWait.values()) w.rej(new Error("worker failed: " + (ev.message || "unknown"))); workerWait.clear(); worker = null; };
    }
    const id = ++workerSeq;
    return new Promise((res, rej) => { workerWait.set(id, { res, rej }); worker.postMessage({ id, signedPczt }); });
  } catch {
    return new Promise((res, rej) => setTimeout(() => { try { const t0 = performance.now(); const o = J(Z.finalize(signedPczt)); o.ms = Math.round(performance.now() - t0); res(o); } catch (e) { rej(e); } }, 50));
  }
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
    return true;
  } catch { storageOk = false; return false; }
}

async function persistSealed() {
  try {
    const rec = await seal(vault.key, vault.rec, { secrets, keys: gkeys });
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
  vault = { rec: { cred: lockedVault.cred, salt: lockedVault.salt }, key };
  lockedVault = null;
  adoptInviteKey();   // an invite link opened while locked waits in the fragment
  boot();
}

function forgetVault() {
  try { localStorage.removeItem("zf-vault"); } catch {}
  location.reload();
}
const skey = (gid, seat) => gid + ":" + seat;
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
const state = { groups: [], gid: null, g: null, seats: {}, dkg1: {}, dkg2: {}, done: {}, verify: {}, wallet: null, sessions: [], sid: null, commits: {}, shares: {}, log: [] };
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
function adoptInviteKey() {
  if (lockedVault) return;
  const [gid, key] = location.hash.slice(1).split(".");
  if (!key) return;
  // A link must not replace a wallet key this browser already has: whoever knows the wallet id
  // could otherwise point the wallet at documents sealed with their own key.
  if (gkeys[gid] && gkeys[gid] !== key) {
    showBanner("bad", "This invite link has a different wallet secret for a wallet you already "
      + "have, so it was ignored.");
  }
  else if (/^[0-9a-f]{20}$/.test(gid) && /^[\w-]{43}$/.test(key)) putKey(gid, key);
  try { history.replaceState(null, "", "#" + gid); } catch {}
}
const inviteLink = (gid) => location.origin + location.pathname + "#" + gid + "." + gkeys[gid];
const keyOf = (path) => gkeys[path.split("/")[1]];

function sealDoc(path, data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) if (v !== undefined) out[k] = Z.secretSeal(keyOf(path), path + "\n" + k, S(v));
  return out;
}
// ponytail: every snapshot decrypts the whole group again; cache by ciphertext if stores grow.
function openDoc(path, raw) {
  if (!Z || !keyOf(path) || raw == null) return null;
  const out = {}; let ok = 0;
  for (const [k, v] of Object.entries(raw)) {
    try { out[k] = J(Z.secretOpen(keyOf(path), path + "\n" + k, v)); ok++; }
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
    showBanner("bad", "The Zigs server is not available. Reload the page, or try again later.");
    return;
  }
  if (!me) showBanner("bad", "This browser cannot tell who you are, so you cannot take a seat.");
  if (canWrite === false) showBanner("bad", "This page is read-only here. You cannot take part.");
  if (!storageOk) showBanner("bad", "This browser does not let the page save your key share. Keep this tab open, and use Back up.");
  // The server keeps each wallet apart, so this browser opens the wallets it has keys for.
  for (const gid of Object.keys(gkeys)) db.join?.(gid);
  sdb.collection("groups").onSnapshot((snap) => {
    dbReady = true;
    state.groups = snap.docs.map((d) => cleanGroup(d.id, d.data()))
      .sort((a, b) => finite(b.createdAt) - finite(a.createdAt));
    watchInbox();
    if (state.gid && !state.g) openGroup(state.gid);
    render();
  }, (e) => showBanner("bad", "Lost connection to the Zigs server (" + e.code + "). Reload."));
  const h = location.hash.replace("#", "");
  if (h && !gkeys[h]) showBanner("bad", MISSING_SECRET);
  else if (h) openGroup(h);
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
  return mySeatSecrets(gid).some(([, s]) => s.keyPackage && !(s.nonces && s.nonces[ss.id]));
}
const toApprove = (gid) => (gid === state.gid ? state.sessions : inbox[gid] || []).filter((ss) => needsMyApproval(gid, ss));

function sub(path, fn) {
  return sdb.collection(path).onSnapshot((snap) => { const m = {}; for (const d of snap.docs) m[d.id] = d.data(); fn(m); render(); react(); },
    (e) => log("subscription error on " + path + ": " + e.code));
}

function openGroup(gid) {
  for (const u of unsubGroup) u(); unsubGroup = [];
  closeSession();
  dropChain();
  Object.assign(state, { gid, g: null, seats: {}, dkg1: {}, dkg2: {}, done: {}, verify: {}, wallet: null, sessions: [], log: [] });
  if (!gid) { try { history.replaceState(null, "", "#"); } catch {} render(); return; }
  try { history.replaceState(null, "", "#" + gid); } catch {}
  const base = "groups/" + gid;
  unsubGroup.push(sdb.doc(base).onSnapshot((d) => {
    state.g = d.exists ? cleanGroup(d.id, d.data()) : null;
    render(); react();
  }));
  unsubGroup.push(sub(base + "/seats", (m) => state.seats = m));
  unsubGroup.push(sub(base + "/dkg1", (m) => state.dkg1 = m));
  unsubGroup.push(sub(base + "/dkg2", (m) => state.dkg2 = m));
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
// FROST identifiers are the seat number as a 32-byte little-endian scalar.
const frostId = (i) => i.toString(16).padStart(2, "0") + "0".repeat(62);
// A restored key share must be the one the wallet published for that seat.
function fitsWallet(i, s) {
  const kp = s.keyPackage, done = state.done[i];
  if (!kp || !done || kp.identifier !== frostId(i)) return false;
  try {
    const shares = J(done.publicKeyPackage).verifying_shares || {};
    return shares[kp.identifier] === kp.verifying_share;
  } catch { return false; }
}
// A seat is this browser's when it took the seat (its identity then, or now), or restored the
// seat's key share. Tor Browser gets a new identity each session, so identity alone is not enough.
function ownsSeat(i, s) {
  const seat = state.seats[i];
  if (!seat) return false;
  return seat.uid === me || seat.uid === s.uid || (!!s.restored && fitsWallet(i, s));
}
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
async function once(key, fn) {
  if (busy.has(key)) return; busy.add(key);
  try { await fn(); } catch (e) { log("✗ " + key + ": " + (e && e.message ? e.message : e)); showBanner("bad", (e && e.message) ? e.message : String(e)); }
  finally { busy.delete(key); render(); setTimeout(react, 0); }
}

function react() {
  try { reactNow(); } catch (e) { log("✗ react: " + (e && e.message ? e.message : e)); }
}

function reactNow() {
  if (!Z || !db || !state.g || state.g.unreadable) return;
  const g = state.g, gid = state.gid, base = "groups/" + gid;
  for (const i of localSeats()) {
    const s = sec(gid, i);
    // Seats taken before secrets kept their identity: record it while this browser still knows it.
    if (!s.uid) putSec(gid, i, { uid: state.seats[i].uid });
    // Round 1
    if (!state.dkg1[i] && !s.keyPackage) {
      once("r1:" + i, async () => {
        let secret = s.r1secret, pkg = s.r1package;
        if (!secret) { const r = J(Z.dkgPart1(i, g.n, g.t)); secret = r.secret; pkg = r.package; putSec(gid, i, { r1secret: secret, r1package: pkg }); }
        await sdb.doc(base + "/dkg1/" + i).set({ package: pkg, at: Date.now() });
        log("seat " + i + ": round 1 commitment published");
      });
      continue;
    }
    // Round 2: needs every seat taken (for their encryption keys) and every round-1 package.
    if (s.r1secret && !s.r2secret && !s.keyPackage && allSeated() && allR1()) {
      once("r2:" + i, async () => {
        const r1 = {}; for (const j of seatIds()) if (j !== i) r1[j] = state.dkg1[j].package;
        const r = J(Z.dkgPart2(S(s.r1secret), S(r1)));
        for (const [to, pkg] of Object.entries(r.outgoing)) {
          const sealed = Z.boxSeal(s.boxSk, state.seats[to].boxPk, gid + ":" + i + "->" + to, S(pkg));
          await sdb.doc(base + "/dkg2/" + i + "-" + to).set({ sealed, at: Date.now() });
        }
        putSec(gid, i, { r2secret: r.secret, r1secret: null });
        log("seat " + i + ": " + Object.keys(r.outgoing).length + " encrypted shares sent");
      });
      continue;
    }
    // Round 3 (local): decrypt the shares sent to me, compute my key share.
    if (s.r2secret && !s.keyPackage && allR1() && r2For(i)) {
      once("r3:" + i, async () => {
        const r1 = {}, r2 = {};
        for (const j of seatIds()) if (j !== i) {
          r1[j] = state.dkg1[j].package;
          const sealed = state.dkg2[j + "-" + i].sealed;
          if (!isStr(sealed)) throw new Error("Seat " + j + " sent an unreadable message.");
          r2[j] = J(Z.boxOpen(s.boxSk, state.seats[j].boxPk, gid + ":" + j + "->" + i, sealed));
        }
        const r = J(Z.dkgPart3(S(s.r2secret), S(r1), S(r2)));
        putSec(gid, i, { keyPackage: r.key_package, publicKeyPackage: r.public_key_package, groupKey: r.group_key, r2secret: null, r1package: null });
        await sdb.doc(base + "/done/" + i).set({ groupKey: r.group_key, publicKeyPackage: S(r.public_key_package), at: Date.now() });
        log("seat " + i + ": key share ready, wallet key " + r.group_key.slice(0, 12) + "…");
      });
      continue;
    }
    // Verify the published wallet against my own DKG output.
    // The store's verify documents are claims anyone with the wallet key can write, so each seat
    // keeps its own result, tied to the exact wallet document, and checks again when it changes.
    const wk = walletKey();
    if (s.keyPackage && state.wallet && s.checkedWallet !== wk && s.rejectedWallet !== wk) {
      once("verify:" + i, async () => {
        let ok = true, error = null;
        try { Z.walletVerify(S(state.wallet), S(s.publicKeyPackage)); } catch (e) { ok = false; error = e.message || String(e); }
        await putSec(gid, i, ok ? { checkedWallet: wk, rejectedWallet: null } : { rejectedWallet: wk });
        await sdb.doc(base + "/verify/" + i).set({ ok, error, at: Date.now() });
        log("seat " + i + (ok ? ": wallet verified, ak equals my wallet key" : ": WALLET REJECTED: " + error));
      });
    }
  }
  if (state.wallet && state.wallet.birthday && myVerified() && !keysDiffer()) ensureChain();
  // Group creator builds the shared wallet once all group keys agree.
  if (isCreator() && !state.wallet && keysAgree()) {
    once("wallet", async () => {
      // The wallet snapshot can arrive after the DKG ones; never replace a published wallet.
      if ((await sdb.doc(base + "/meta/wallet").get()).exists) return;
      const birthday = await Z.latestHeight(await pickServer(netOf(g)));
      const w = J(Z.walletCreate(state.done[1].publicKeyPackage, g.network || "testnet"));
      await sdb.doc(base + "/meta/wallet").set({ ...w, birthday, at: Date.now() });
      log("wallet created: " + w.address.slice(0, 24) + "…");
    });
  }
  // Signing.
  const ss = curSession();
  if (ss && state.wallet) reactSession(ss);
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
  await ref.set({ name, n, t, network, createdBy: me, createdAt: Date.now(), movedFrom: from || undefined });
  if (from) await sdb.doc("groups/" + from).update({ movedTo: ref.id, movedAt: Date.now() });
  openGroup(ref.id);
  await takeSeat(1);
}

async function takeSeat(i) {
  if (!Z) return;
  const ref = sdb.doc("groups/" + state.gid + "/seats/" + i);
  const lease = await ref.acquire({ holder: crypto.randomUUID(), ttlMs: 5000 });
  if (!lease.acquired) { showBanner("bad", "Someone else is taking seat " + i + " right now."); return; }
  const cur = await ref.get();
  if (cur.exists && cur.data().uid) { showBanner("bad", "Seat " + i + " is already taken."); return; }
  const kp = J(Z.boxKeypair());
  putSec(state.gid, i, { boxSk: kp.sk, uid: me });
  const name = user ? (await user.me()).name : "";
  await ref.set({ uid: me, name, boxPk: kp.pk, at: Date.now() });
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

async function finalizeTx(ss) {
  await sdb.doc(sessionPath(ss)).update({ status: "proving", provingAt: Date.now() });
  log("building Halo2 proof (about a minute)…");
  let out;
  try { out = await finalizeOffThread(ss.signed); }
  catch (e) { await sdb.doc(sessionPath(ss)).update({ status: "signed" }); throw e; }
  await sdb.doc(sessionPath(ss)).update({ status: "complete", final: out });
  log("transaction complete: " + out.txid);
  showBanner("ok", "Proof ready. Send the payment to the network.");
}

async function backup(i) {
  // Nonces stay out: a restored copy must never sign with a nonce this browser may also use.
  const { nonces, backedUp, ...s } = sec(state.gid, i);
  s.uid = s.uid || state.seats[i].uid;
  const data = JSON.stringify({
    kind: "zec-frost-key-share", group: state.gid, groupName: state.g.name, seat: i,
    threshold: state.g.t, of: state.g.n, key: gkeys[state.gid], wallet: state.wallet, secret: s,
  }, null, 2);
  if (!downloads) { showBanner("bad", "Downloads are not available in this view."); return; }
  try {
    const name = state.g.name.replace(/\W+/g, "-") || "wallet";
    await downloads.save({ filename: "zec-frost-" + name + "-seat-" + i + ".json", data });
    await putSec(state.gid, i, { backedUp: true });
  } catch (e) {
    if (e && e.code !== "declined") showBanner("bad", "Backup not saved: " + (e.message || e.code));
  }
}

function restore(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const b = JSON.parse(r.result);
      if (b.kind !== "zec-frost-key-share") throw new Error("This is not a key share backup.");
      if (b.key) putKey(b.group, b.key);
      // Older backups hold nonces: a restored nonce could sign a second, different package.
      const { nonces, uid, ...secret } = b.secret || {};
      const kept = (sec(b.group, b.seat) || {}).nonces || {};
      putSec(b.group, b.seat, { ...secret, nonces: kept, restored: true, backedUp: true });
      showBanner("ok", "Restored seat " + b.seat + " of " + (b.groupName || "wallet") + ".");
      openGroup(b.group);
    } catch (e) { showBanner("bad", e.message); }
  };
  r.readAsText(file);
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
  return el("button", { class: cls, type: "button", onclick: async (ev) => { const b = ev.currentTarget; try { await navigator.clipboard.writeText(text); b.textContent = "Copied"; } catch { b.textContent = "Select and copy"; } setTimeout(() => b.textContent = label, 1500); } }, label);
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
  create: false, receive: false, move: false, net: "testnet", ack: false,
};
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
let drawPending = false;
function render() {
  if (drawPending) return;
  drawPending = true;
  const run = () => { if (drawPending) { drawPending = false; draw(); } };
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
    return !dbReady ? loadingView() : state.gid ? groupView() : lobby();
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
  renderSide();
  const pending = state.groups.reduce((n, g) => n + toApprove(g.id).length, 0);
  document.title = pending ? "(" + pending + ") Zigs" : "Zigs";
  const form = saveFormState(app);
  const view = pageView(), top = lockedVault ? [] : layers();
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

// Keep what the viewer is typing, open <details>, and the drawer scroll across live updates.
function saveFormState(app) {
  const values = {};
  for (const i of app.querySelectorAll("input[id], select[id], textarea[id]")) {
    if (i.type !== "file") values[i.id] = i.value;
  }
  const open = new Set([...app.querySelectorAll("details[open] > summary")].map((x) => x.textContent));
  return { values, open, scroll: app.querySelector(".drawer-body")?.scrollTop || 0 };
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
  const body = app.querySelector(".drawer-body");
  if (body) body.scrollTop = form.scroll;
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
  try { return buildLayers(); }
  catch (e) { log("unreadable layer: " + (e && e.message ? e.message : e)); return []; }
}

function buildLayers() {
  const scrim = (close) => el("div", { class: "scrim", onclick: () => { close(); render(); } });
  const ss = state.gid && state.wallet ? curSession() : null;
  if (ss) return [scrim(closeSession), sessionLayer(ss)];
  const inWallet = state.gid && state.wallet;
  if (ui.send && inWallet) return [scrim(() => ui.send = false), sendDialog()];
  if (ui.receive && inWallet) return [scrim(() => ui.receive = false), receiveDialog()];
  if (ui.create && !state.gid) return [scrim(() => ui.create = false), createDialog()];
  if (ui.move && inWallet) return [scrim(() => ui.move = false), createDialog(state.g)];
  return [];
}

function renderSide() {
  const nav = document.getElementById("side-nav");
  const newWallet = () => { openGroup(null); ui.create = true; render(); };
  nav.replaceChildren(
    el("div", { class: "side-head" }, el("span", { class: "label" }, "Wallets"),
      el("button", { class: "icon-btn", type: "button", title: "New wallet", "aria-label": "New wallet", onclick: newWallet }, "+")),
    ...(state.groups.length ? state.groups.map((g) => guard(sideItem, g))
      : [el("p", { class: "side-empty" }, sideEmpty())]));
}

const sideEmpty = () => lockedVault ? "Locked." : dbReady ? "No wallets yet." : "Connecting…";

function sideItem(g) {
  const n = toApprove(g.id).length, here = g.id === state.gid;
  const tail = n
    ? el("span", { class: "side-count", role: "img", title: n + " to approve",
      "aria-label": n + " to approve" }, String(n))
    : el("span", { class: "side-meta", title: ruleText(g.t, g.n) },
      g.movedTo ? "Moved" : g.t + " of " + g.n);
  return el("button", {
    class: "side-item" + (here ? " active" : ""), type: "button",
    "aria-current": here ? "page" : null, "data-key": "wallet-" + g.id,
    onclick: () => { ui.tab = "overview"; openGroup(g.id); },
  }, el("span", { class: "av" }, initials(g.name)),
  el("span", { class: "side-name" }, g.name), tail);
}

function forgetBox() {
  const cancel = () => { ui.forget = false; render(); };
  return el("div", { class: "callout bad" },
    el("p", {}, "Without the passkey, the key shares in this browser cannot be opened. Delete "
      + "them, then restore each seat from its backup file. A seat with no backup is lost, but "
      + "the wallet still works while enough other signers remain."),
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
    el("h3", {}, Z ? "Connecting to the Zigs server" : "Loading the crypto engine"),
    el("p", { class: "small" }, "Your wallets appear in a moment."));
}

// ── Lobby ──
function lobby() {
  const restoreInput = el("input", {
    id: "restore", type: "file", accept: "application/json", hidden: true,
    onchange: (ev) => ev.target.files[0] && restore(ev.target.files[0]),
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
  return el("div", { class: "page" }, head, body, restoreInput);
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
    n ? el("span", { class: "badge warn" }, n + " to approve") : null),
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

// The name other signers see on your seat; saved in this browser and read when you take a seat.
function nameField(id) {
  let saved = ""; try { saved = localStorage.getItem("zf-name") || ""; } catch {}
  const save = (ev) => { try { localStorage.setItem("zf-name", ev.target.value.trim()); } catch {} };
  return el("label", { class: "field" }, el("span", {}, "Your name"),
    el("input", { class: "input", id, value: saved, maxlength: "40", autocomplete: "nickname", placeholder: "Shown to your signers", oninput: save }));
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
  const ready = state.wallet && state.wallet.birthday && rejectedSeats().length === 0
    && !keysDiffer();
  const why = ready ? sendBlocker() : null;
  const head = groupHead(g, ready, why);
  return ready ? walletView(head, why) : el("div", { class: "page" }, head, setupView());
}

function walletView(head, why) {
  const unsaved = localSeats().filter((i) => {
    const s = sec(state.gid, i);
    return s.keyPackage && !s.backedUp;
  });
  const n = toApprove(state.gid).length;
  const tabs = [["overview", "Overview"], ["activity", "Activity", n], ["members", "Signers"],
    ["details", "Details"]];
  const bodies = {
    overview: overviewTab, activity: activityTab, members: membersTab, details: detailsTab,
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
  const tab = ([id, label, count]) => el("button", {
    class: "tab", type: "button", role: "tab", id: "tab-" + id, "data-key": "tab-" + id,
    "aria-selected": ui.tab === id ? "true" : "false",
    "aria-controls": ui.tab === id ? "panel-" + id : null,
    tabindex: ui.tab === id ? "0" : "-1", onclick: () => { ui.tab = id; render(); },
  }, label, count
    ? el("span", { class: "count attn", role: "img", "aria-label": count + " to approve" }, count)
    : null);
  return el("div", { class: "tabs", role: "tablist", "aria-label": "Wallet sections", onkeydown },
    tabs.map(tab));
}

// Private windows, Tor Browser and cleared site data delete the key share with the browser data.
function backupNote(seats) {
  const text = "Back up your key share. This browser can forget it: private windows and Tor "
    + "Browser delete it when they close. Keep the file safe and offline.";
  return el("div", { class: "callout warn", role: "status" },
    el("span", { style: "flex:1 1 16rem" }, text),
    seats.map((i) => el("button", {
      class: "btn sm", type: "button", onclick: act(() => backup(i)),
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
  return el("div", { class: "page", style: "gap:16px" }, split, top,
    el("div", { class: "setup" }, progressCard(), seatsCard(open)));
}

function joinCard(seat) {
  const take = el("button", {
    class: "btn primary lg", type: "button", disabled: !Z || canWrite === false,
    onclick: act(() => takeSeat(seat)),
  }, "Take seat " + seat);
  return el("section", { class: "card card-pad hero-card" },
    el("div", { style: "display:grid;gap:4px" }, el("h2", {}, "Join " + state.g.name),
      el("p", { class: "small muted" }, "Take a seat to become a signer. Your device creates its "
        + "own key share. It never leaves this browser unless you save a backup.")),
    nameField("seat-name"),
    el("div", {}, take));
}

function inviteCard(openCount) {
  const link = inviteLink(state.gid);
  const share = navigator.share ? el("button", {
    class: "btn sm", type: "button",
    onclick: () => navigator.share({ title: "Join " + state.g.name + " on Zigs", url: link })
      .catch(() => {}),
  }, "Share") : null;
  return el("section", { class: "card card-pad hero-card" },
    el("div", { class: "card-head" }, el("h2", {}, "Invite your signers"),
      el("span", { class: "badge plain" },
        openCount === 1 ? "1 seat open" : openCount + " seats open")),
    el("p", { class: "small muted" }, "Send this invite link to each signer through a private "
      + "channel. It contains the wallet secret: anyone who has it can take an open seat."),
    el("div", { class: "addr-box" }, el("span", { class: "hex nowrap" }, link),
      copyBtn(link, "Copy link", "btn sm primary"), share),
    secretQr(link));
}

// Counts for the three setup steps.
function setupCounts() {
  const n = state.g.n;
  return {
    n, w: state.wallet, pairs: n * (n - 1),
    r1: Object.keys(state.dkg1).length, r2: Object.keys(state.dkg2).length,
    d: Object.keys(state.done).length, ver: verifiedCount(),
    seated: seatIds().filter((i) => state.seats[i]).length,
    mismatch: keysDiffer(), rejected: rejectedSeats(),
  };
}

function keyStep(c) {
  if (c.mismatch) {
    const text = "The signers made different wallet keys. Do not use this wallet. "
      + "Create a new wallet.";
    return ["bad", text];
  }
  if (c.d === c.n) return ["done", "Each signer holds one piece. The full key never existed."];
  if (!allSeated()) return ["", "Starts when every seat is taken."];
  if (c.r2 === c.pairs) return ["now", "Each device is computing its piece of the key…"];
  if (c.r1 === c.n) {
    return ["now", "Devices are exchanging encrypted shares (" + c.r2 + " of " + c.pairs + ")…"];
  }
  return ["now", "Devices are publishing their commitments (" + c.r1 + " of " + c.n + ")…"];
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
  if (!c.w.birthday) return [stage, "This wallet predates testnet support. Create a new one."];
  const checked = c.ver + " of " + c.n;
  return [stage, checked + " signers checked that the address belongs to the wallet key."];
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
  const to = state.g.movedTo, ss = state.sessions.find((x) => x.move === to && x.status !== "failed");
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
  const started = state.sessions.some((x) => x.move === state.g.movedTo && x.status !== "failed");
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

function memberRow(i) {
  const s = state.seats[i], mine = s && isMe(s.uid) && sec(state.gid, i), v = seatCheck(i);
  return el("div", { class: "member" }, avatar(i, "lg"),
    el("div", { class: "ri-main" }, el("span", { class: "ri-title" }, s ? (isMe(s.uid) ? (s.name || "You") : s.name || "Signer " + i) : "Open seat", mine ? el("span", { class: "you" }, "You") : null),
      el("span", { class: "ri-sub" }, "Seat " + i + (s ? " · joined " + when(s.at) : ""))),
    el("div", { class: "m-actions" },
      v !== null ? el("span", { class: "badge " + (v ? "ok" : "bad") }, v ? "Address checked" : "Rejected address") : el("span", { class: "badge" }, STAGE_LABEL[seatStage(i)]),
      mine && sec(state.gid, i).keyPackage
        ? el("button", {
          class: "btn sm", type: "button", onclick: act(() => backup(i)),
        }, "Back up key share")
        : null));
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
      el("dt", {}, "Wallet key"), el("dd", { class: "hex" }, w.group_verifying_key)));
}

function privacyCard() {
  const w = state.wallet;
  const host = chain && chain.url ? new URL(chain.url).host : "a light-wallet server";
  return el("section", { class: "card card-pad" },
    el("h2", { style: "font-size:15px" }, "Privacy and keys"),
    el("p", { class: "small muted" }, "Your key share is created and used in this browser. "
      + "It leaves this browser only if you save a backup. The Zigs server stores encrypted "
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
function secretQr(link) {
  return el("details", { class: "qr-toggle" }, el("summary", {}, "Show QR code"),
    qrBox(link, "Invite link"),
    el("p", { class: "small faint" }, "Scan with a phone camera to open the wallet there."));
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
  hint.textContent = !v ? "" : ok ? "Valid " + net + " address" : "Not a " + net + " unified address with an Orchard receiver";
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
    if (!onNetwork(to)) throw new Error(who + "Enter a " + net.label.toLowerCase() + " unified address with an Orchard receiver (it starts with " + net.prefix + ").");
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
    + "with this approval. Propose it again.");
}

function sessionDrawer(ss) {
  const ins = inspectOf(ss), refused = ins && ins.error, rc = recipientCheck(ss, ins);
  const actions = nextAction(ss, ins, rc);
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
      ss.final ? guard(txDetails, ss) : null,
      ss.broadcastTxid ? chainSees() : null,
      ins && !refused ? el("p", { class: "small faint" }, "Signed message " + short(ins.sighash, 12) + " · " + ins.tx_version) : null),
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
      el("div", { class: "group" }, "Notes used"),
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

// Another tab saved: take its secrets, so this tab neither misses nor overwrites them.
window.addEventListener("storage", async (ev) => {
  if (lockedVault || (ev.key !== "zf-secrets" && ev.key !== "zf-vault") || !ev.newValue) return;
  try {
    if (!vault && ev.key === "zf-secrets") secrets = JSON.parse(ev.newValue);
    if (vault && ev.key === "zf-vault") {
      ({ secrets, keys: gkeys } = await openVault(vault.key, parseVault(ev.newValue)));
    }
  } catch (e) { log("could not read another tab's save: " + (e.message || e)); }
  render();
});

document.getElementById("banner-close").addEventListener("click", () => {
  document.getElementById("banner").hidden = true;
});
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  if (state.sid) closeSession(); else { ui.send = false; ui.create = false; ui.receive = false; ui.move = false; }
  render();
});

// Back, forward and pasted invite links change only the fragment; follow them.
window.addEventListener("hashchange", () => {
  adoptInviteKey();
  if (lockedVault) return;
  const gid = location.hash.slice(1).split(".")[0] || null;
  if (gid === state.gid) return;
  if (gid && !gkeys[gid]) { showBanner("bad", MISSING_SECRET); return; }
  ui.tab = "overview";
  openGroup(gid);
});
// New blocks every 25 s: refresh the open wallet once a minute while someone looks at it.
setInterval(() => { const c = curChain(); if (c && !c.syncing && document.visibilityState === "visible") runSync(c); }, 60000);

adoptInviteKey();
draw();   // the first paint does not wait for the engine
loadEngine().then(() => lockedVault ? render() : boot());
