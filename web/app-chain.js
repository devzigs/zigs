// Networks, chain sync, the balance cache, memo reading and the 60 s refresh.
import { finite } from "./util.js";
import { log, state } from "./app-state.js";
import { fmtZec, J, readLocal, S, short, withTimeout, writeLocal } from "./app-kit.js";
import { Z } from "./app-engine.js";
import { gkeys, idb, loadSnapshot, saveSnapshot, snapId } from "./app-keystore.js";
import { localSeats } from "./app-seats.js";
import { leavesOf } from "./app-dom.js";
import { myVerified } from "./app-dkg.js";
import {
  approvedHold, approvedSpent, DAY2_BLOCKS, expired, expiryAt, landed, txidOf,
} from "./app-payments.js";
import { acct } from "./app-account.js";
import { render } from "./app-loop.js";

// Light-wallet servers in order of preference. Mainnet uses a third-party server, so the group
// server and the chain server have different operators (see PRIVACY.md). The first testnet server
// is /lwd of this origin: the Worker relays it to our node (cf/src/index.js).
export const NETWORKS = {
  testnet: { label: "Testnet",
    servers: [location.origin + "/lwd", "https://zcash-testnet.chainsafe.dev"],
    explorer: "https://testnet.zecblock.com/tx/", prefix: "utest1", faucet: "https://zcashfaucet.jinolabs.xyz/" },
  mainnet: { label: "Mainnet", servers: ["https://zcash-mainnet.chainsafe.dev"],
    explorer: "https://zecblock.com/tx/", prefix: "u1", cap: 50000000 },
};
export const validNet = (x) => typeof x === "string" && Object.hasOwn(NETWORKS, x);
export const netName = (g) => g && validNet(g.network) ? g.network : "testnet";
export const netOf = (g) => NETWORKS[netName(g)];
export const curNet = () => netOf(state.g);
export const capText = (zat) => zat / 1e8 + " ZEC";
export const SERVER_TIMEOUT_MS = 8000;
export let chain = null;   // { gid, cw, prog, bal, received, ms, error, syncing } for the open group
export function setChain(v) { chain = v; }
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
export function balOf(gid) {
  if (!(gid in balCache) && Z && gkeys[gid] && typeof balSealed[gid] === "string") {
    try { balCache[gid] = J(Z.secretOpen(gkeys[gid], "bal\n" + gid, balSealed[gid])); } catch { balCache[gid] = null; }
  }
  return balCache[gid];
}
function saveBal(gid, bal) {
  balCache[gid] = { total: bal.spendable + bal.pending, at: Date.now() };
  try { balSealed[gid] = Z.secretSeal(gkeys[gid], "bal\n" + gid, S(balCache[gid])); localStorage.setItem("zf-bal", JSON.stringify(balSealed)); } catch {}
}

export function dropChain() { const c = chain; chain = null; if (c && !c.syncing && c.cw) c.cw.free(); }

export function ensureChain() {
  if (!Z || (chain && chain.gid === state.gid)) return;
  const w = state.wallet;
  chain = {
    gid: state.gid, secret: gkeys[state.gid], net: curNet(), ufvk: w.ufvk, birthday: w.birthday,
    cw: null, url: null, prog: null, bal: null, ms: 0, error: null, syncing: false,
  };
  runSync(chain);
}

// Returns the first light-wallet server of `net` that answers, in order of preference.
export async function pickServer(net) {
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
// The expected milliseconds from block `from` to block `to`, at the block time of each block (75
// seconds before NU7, 25 from it). The engine knows the upgrade heights of each network.
export const spanMs = (net, from, to) => Z.blockSpanSeconds(net, from, to) * 1000;
// A signer shows the address only after its own seat checked it against its key share.
export const addrHidden = () => atCap() || (localSeats().length > 0 && !myVerified());
export const curChain = () => chain && chain.gid === state.gid ? chain : null;

// Sent payments that no synced block contains yet. Until one does, the synced balance still
// counts their inputs as unspent, so the app subtracts them itself.
export function inFlight() {
  const c = curChain();
  if (!c || !c.sent || !c.bal) return [];
  return state.sessions.filter((ss) => keepsNotes(ss, c));
}

// A browser that approved and saw the payment sent holds by what it approved (approvedHold). For
// any other browser one seat writes the document, so a payment with an error part, with no
// expiry that counts (see expiryAt), or that expires later than any approval allows holds no
// notes: holding them for ever would stop every payment (TICKETS.md ZEC-13).
const sentNow = (ss) => !!(ss.broadcastTxid && ss.final && !ss.error);
// A block holds the payment, or it can no longer land.
const over = (ss) => landed(ss) || expired(ss) || approvedSpent(ss);
function keepsNotes(ss, c) {
  if (approvedHold(ss)) return true;
  if (!sentNow(ss)) return false;
  const at = expiryAt(ss);
  if (at === null || at > c.bal.height + 1 + DAY2_BLOCKS) return false;
  return !c.sent.has(txidOf(ss) ?? ss.final.txid) && !over(ss);
}
export function balanceNow(b) {
  const out = inFlight(), sum = (f) => out.reduce((n, ss) => n + finite(f(ss)), 0);
  return {
    spendable: Math.max(0, b.spendable - sum((ss) => ss.noteValue)),
    pending: b.pending + sum((ss) => ss.change),
    sending: sum(leavesOf),
  };
}

// Unaudited code holds real money only up to the network's cap; past it the address is hidden.
export function atCap() {
  const cap = curNet().cap, total = openTotal();
  return !!cap && total !== undefined && total >= cap;
}

// The balance of the open wallet, or undefined before its first sync.
export function openTotal() {
  const c = curChain();
  if (!c || !c.bal) return undefined;
  const b = balanceNow(c.bal);
  return b.spendable + b.pending;
}

// A request names the address of a wallet, so the app offers it only when it knows that the balance
// is under the cap of the network. `total` is undefined when the balance is not known.
export const underCap = (g, total) => !netOf(g).cap || total < netOf(g).cap;
// New blocks every 25 s: refresh the open wallet once a minute while someone looks at it.
setInterval(() => {
  if (document.visibilityState !== "visible") return;
  for (const c of [curChain(), acct]) if (c && !c.syncing) runSync(c);
}, 60000);
