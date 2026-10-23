// The Solana part of the page (ZOLANA.md 3). app-sol.js loads this file with a dynamic import when
// the Solana tab of a version 3 testnet wallet opens, when a seat signed the solstart document, or
// early for a wallet whose group document asks for Solana (the M3 hint), so the ceremony does not
// wait for it.
// `attach(host)` asks the server for the Helius URL, loads the Solana wasm and returns the
// controller that the page calls: open and close follow the open wallet, react advances the
// ceremony, the stops and the signing sessions, view builds the tab, restore takes a backup.
import { reactAborts } from "./abort.js";
import { addSol } from "./addsol.js";
import { approve } from "./approve.js";
import { backupWords, restoreSolana } from "./backup.js";
import { addSolana, reactCeremony } from "./ceremony.js";
import { COLLECTIONS, filterSol } from "./docs.js";
import { tryAgain } from "./execute.js";
import { reactProve, turnOnLocal } from "./localprove.js";
import { propose } from "./propose.js";
import {
  autoSync,
  ensureWorker,
  fetchRpcUrl,
  refreshChain,
  showSaved,
  pollBalances,
  syncNow,
} from "./session.js";
import { SESSIONS, filterSessions } from "./sessions.js";
import { reactSessions } from "./signing.js";
import { solView } from "./view.js";

const LOG_MAX = 200;
// Any holder of the wallet link can add session documents. The page watches the commits and the
// shares of the valid sessions that did not end, and at most this many of them (newest first).
const WATCH_MAX = 50;
const SESSION_ID = /^[\w-]{1,64}$/;
const ENDED = new Set(["sent", "failed"]);

// What belongs to the open wallet. The host, the wasm and the Worker session outlive it. Each
// blank state gets a new number: a step that started before a close writes nothing after it.
let opens = 0;
const blank = () => ({
  opened: ++opens,
  gid: null,
  base: null,
  raw: {},
  loaded: {},
  unsubs: [],
  logged: new Set(),
  sync: {},
  viewed: false,
  balanceViewed: false,
  autoSynced: false,
  autoSyncFails: 0,
  autoSyncAfter: 0,
  autoSyncBusy: false,
  syncedSent: new Set(),
  pollWanted: 0,
  chain: {},
  docs: Object.fromEntries(COLLECTIONS.map((name) => [name, {}])),
  wait: 0,
  sessions: [],
  commits: {},
  shares: {},
  sessWait: 0,
  watching: new Map(),
  snaps: {},
  seen: {},
  tries: {},
  execErrors: {},
  execWait: {},
  readFails: {},
  sending: {},
  added: null,
  savedShown: false,
  rent: null,
  rentDone: null,
  proveChecked: false,
});

function teardown(c) {
  for (const stop of [...c.unsubs, ...c.watching.values()]) stop();
  c.worker?.close();
  Object.assign(c, blank(), { worker: null, inited: null });
}

function logIgnored(c, rel) {
  if (c.logged.has(rel) || c.logged.size >= LOG_MAX) return;
  c.logged.add(rel);
  c.host.log("ignored Solana data without a valid signature: " + rel);
}

/** Reads the stored documents again, with the signature checks of the page (memoised there). */
function refresh(c) {
  const check = c.host.checkIn(c.gid),
    onBad = (rel) => logIgnored(c, rel);
  const f = filterSol(c.raw, check, onBad),
    s = filterSessions(c.raw, check, onBad);
  Object.assign(c, { docs: f.docs, wait: f.wait, sessWait: s.wait });
  Object.assign(c, { sessions: s.sessions, commits: s.commits, shares: s.shares });
}

// The commits and the shares of a session are collections below its document. Returns the
// function that stops both watches.
function watchSession(c, gid, base, id) {
  const stops = [];
  for (const [kind, name] of [
    ["commits", "solcommits"],
    ["shares", "solshares"],
  ]) {
    const onDocs = (snap) => {
      if (c.gid !== gid) return;
      c.raw[name] ??= {};
      c.raw[name][id] = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
      c.host.refilter();
    };
    const path = base + "/" + SESSIONS + "/" + id + "/" + kind;
    const onError = (e) => c.host.log("subscription error on a Solana session: " + e.code);
    stops.push(c.host.sdb.collection(path).onSnapshot(onDocs, onError));
  }
  return () => stops.forEach((stop) => stop());
}

/**
 * Watches the sessions that can still progress: valid (the filter read their proposal), not sent
 * and not failed, at most WATCH_MAX. A session that ended gives its watches back, and a document
 * that is not a valid session never takes one.
 */
function syncWatches(c) {
  const live = c.sessions
    .filter((ss) => !ENDED.has(ss.status) && SESSION_ID.test(ss.id))
    .slice(0, WATCH_MAX)
    .map((ss) => ss.id);
  for (const [id, stop] of c.watching) {
    if (live.includes(id)) continue;
    stop();
    c.watching.delete(id);
  }
  for (const id of live) {
    if (!c.watching.has(id)) c.watching.set(id, watchSession(c, c.gid, c.base, id));
  }
}

function watchSessions(c, gid, base) {
  const onDocs = (snap) => {
    if (c.gid !== gid) return;
    c.raw[SESSIONS] = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
    c.loaded[SESSIONS] = true;
    c.host.refilter();
  };
  const onError = (e) => c.host.log("subscription error on solsessions: " + e.code);
  c.unsubs.push(c.host.sdb.collection(base + "/" + SESSIONS).onSnapshot(onDocs, onError));
}

function openGroup(c, gid, base) {
  teardown(c);
  if (!gid) return;
  Object.assign(c, { gid, base });
  for (const name of COLLECTIONS) {
    const onDocs = (snap) => {
      if (c.gid !== gid) return;
      c.raw[name] = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
      c.loaded[name] = true;
      c.host.refilter();
    };
    const onError = (e) => c.host.log("subscription error on " + name + ": " + e.code);
    c.unsubs.push(c.host.sdb.collection(base + "/" + name).onSnapshot(onDocs, onError));
  }
  watchSessions(c, gid, base);
}

/** Loads the wasm and returns the controller of the Solana part. */
export async function attach(host) {
  const rpcUrl = await fetchRpcUrl();
  const W = await import("./wasm/sol_wasm.js");
  await W.default();
  const c = { host, W, rpcUrl, worker: null, inited: null, ...blank() };
  c.refresh = () => refresh(c);
  // A hidden tab runs no sync, and the page only redraws when the tab shows again: a pass of the
  // reactor runs the retry or the first sync that came due meanwhile.
  globalThis.document?.addEventListener("visibilitychange", () => host.refilter());
  const actions = {
    add: () => addSolana(c),
    sync: () => syncNow(c),
    backup: (seat) => host.askBackup(backupWords(c, seat)),
    restoreFile: (file) => host.restore(file),
    refresh: () => refreshChain(c),
    propose: (kind, args) => propose(c, kind, args),
    approve: (ss, seat) => approve(c, ss, seat),
    /** Tries the execute of a signed payment again, after the tries of this tab ran out. */
    execute: (ss) => tryAgain(c, ss),
    /** Turns on local proving for the group, after the pool and device checks (SOL-4). */
    proveOn: async () => turnOnLocal(c, await ensureWorker(c)),
    async addSol(args) {
      c.added = await addSol(c, args);
      host.render();
      if (c.added.status !== "failed") pollBalances(c);
    },
  };
  return {
    ctl: c, // the state of the controller, for the tests
    open: (gid, base) => openGroup(c, gid, base),
    close: () => teardown(c),
    observe(gid) {
      if (gid !== c.gid || c.gid !== host.state.gid) return;
      // Overview observes balances without opening payment tools or local-prover selftests.
      c.balanceViewed = true;
      refresh(c);
      autoSync(c);
    },
    react() {
      if (c.gid !== host.state.gid) return;
      refresh(c);
      syncWatches(c);
      reactCeremony(c);
      reactAborts(c);
      reactSessions(c);
      reactProve(c, () => ensureWorker(c));
      autoSync(c);
      showSaved(c).catch((e) => host.log("saved Solana state not shown: " + (e.message ?? e)));
    },
    view: () => {
      c.viewed = true; // the Solana tab shows this wallet: autoSync may call Helius
      refresh(c);
      return solView(c, host.act, actions);
    },
    restore: (b, encrypted) => restoreSolana(c, b, encrypted),
    add: actions.add,
  };
}
