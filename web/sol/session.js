// The Worker session of the tab: it checks that the Worker script carries its own policy, starts
// the Worker with the role secrets of the group (never the key share, solSeed or a nonce), checks
// both of its addresses against the wasm addresses, runs a sync and keeps the sealed snapshot. The
// funds of the group belong to the PDA of the approvals program (ZOLANA.md 7.2); the sync also
// reads the beta funds that the group key holds until they move to the PDA. The Helius URL comes
// from the server (/sol/config.json). It is held in memory, passed to the Worker and never logged
// or stored.
import { startSolWorker } from "./client.js";
import { agreement } from "./ceremony.js";
import { base58 } from "./docs.js";
import { feeOf } from "./fee.js";
import { gateAnswer } from "./localprove.js";
import { PROPOSAL_SPACE, nonceAccountHex } from "./intent.js";
import { holdsShare, refuseStopped, solOf, stopOf } from "./secrets.js";
import { SESSIONS, isPayment } from "./sessions.js";
import { loadSnap, saveSnap } from "./store.js";

const J = JSON.parse;
export const UNAVAILABLE = "Solana is not available on this server";
// The policy that cf/src/index.js gives the response of /sol/worker.js when SOL is "1". Without
// it the Worker would run with no policy of its own, so the page does not start it.
const WORKER_POLICY =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; " +
  "connect-src 'self' https://devnet.helius-rpc.com " +
  "https://d3gbdb0egjwcw9.cloudfront.net/proving-keys/3a1c88f90f609eb1/; base-uri 'none'";

// The text of app-sol.js for a load that failed on the connection (SOL_DOWN, S12): the page
// shows it as it is, and the tab turns it into the text of its Try again button.
export const NOT_LOADED = "Solana did not load. Check your connection, then reload the page.";

/**
 * The Helius Devnet URL that the server serves. Throws UNAVAILABLE when the server has no Solana
 * (a 503 or a 404), and NOT_LOADED for any other failure: no answer, another status, or no URL.
 */
const NO_SOLANA = new Set([503, 404]);
export async function fetchRpcUrl() {
  const res = await fetch("/sol/config.json", { cache: "no-store" }).catch(() => null);
  if (NO_SOLANA.has(res?.status)) throw new Error(UNAVAILABLE);
  const url = res?.ok ? (await res.json().catch(() => null))?.rpcUrl : undefined;
  if (typeof url !== "string" || !url) throw new Error(NOT_LOADED);
  return url;
}

/** Lamports (a decimal text) as SOL text. */
export function solText(lamports) {
  const n = BigInt(lamports),
    frac = String(n % 1_000_000_000n)
      .padStart(9, "0")
      .replace(/0+$/, "");
  return n / 1_000_000_000n + (frac ? "." + frac : "") + " SOL";
}

async function requireWorkerPolicy() {
  const res = await fetch("/sol/worker.js");
  if (!res.ok || res.headers.get("content-security-policy") !== WORKER_POLICY) {
    throw new Error(
      "The server did not send the policy of the Solana worker, so the worker " +
        "was not started.",
    );
  }
}

/** The first seat of this browser that holds a Solana key share. None when the wallet stopped. */
export const shareSeat = (c) =>
  stopOf(c) ? undefined : c.host.localSeats().find((i) => holdsShare(solOf(c.host, c.gid, i)));

// A step that awaits checks this after each await: a wallet that closed (or opened again) meanwhile
// gets a new number, and the step writes nothing into its state.
const CLOSED = "The wallet closed during this Solana step.";
export const stillOpen = (c, opened) => c.opened === opened;

/** Throws when the Worker made other addresses than the wasm for this group. */
function sameAddresses(init, roles, groupKey) {
  const { pda } = roles;
  const old = init.shielded === roles.address && init.owner === base58(groupKey);
  const owner = init.pdaShielded === pda.address && init.pda === base58(pda.pda);
  if (!old || !owner) {
    throw new Error(
      "The Solana worker made another address than the wasm. Do not use this wallet.",
    );
  }
}

async function start(c, rpcUrl, roles, groupKey) {
  if (c.worker && c.inited === rpcUrl) return;
  const opened = c.opened;
  await requireWorkerPolicy();
  if (!stillOpen(c, opened)) throw new Error(CLOSED);
  c.worker ??= startSolWorker(undefined, () => gateAnswer(c));
  const { pda } = roles;
  const init = await c.worker.call("init", {
    rpcUrl,
    nullifierSecret: roles.nullifier_secret,
    pdaNullifierSecret: pda.nullifier_secret,
    viewingSecret: roles.viewing_sk,
    groupKey,
    pda: pda.pda,
  });
  sameAddresses(init, roles, groupKey);
  c.inited = rpcUrl;
  c.workerAddress = "the SDK addresses equal the wasm addresses";
}

/** The seat, the URL and the roles that the Worker needs, or an error that says what is missing. */
function workerInputs(c) {
  const { host, W, gid } = c;
  refuseStopped(c);
  const seat = shareSeat(c),
    { rpcUrl } = c;
  if (seat === undefined) throw new Error("This browser holds no Solana key share of this wallet.");
  if (!rpcUrl) throw new Error(UNAVAILABLE);
  const s = solOf(host, gid, seat);
  const roles = J(W.sol_roles(s.solSeed, s.groupKey));
  return { rpcUrl, s, roles: { ...roles, pda: J(W.sol_pda_roles(s.solSeed, s.groupKey)) } };
}

/** The Worker of this tab, started if needed (it checks its own policy and its addresses). */
export async function ensureWorker(c) {
  const { rpcUrl, s, roles } = workerInputs(c);
  await start(c, rpcUrl, roles, s.groupKey);
  return c.worker;
}

// The private lamports and the hash and the amount of each synced note, for the available balance
// (S4). The blinding of a note stays in the sealed snapshot.
const notesOf = ({ balance, utxos }) => ({
  lamports: balance,
  notes: (utxos ?? []).map(({ hash, amount }) => ({ hash, amount })),
});

/**
 * Starts the Worker if needed, syncs the funds of the group (the PDA identity) and the beta funds
 * of the group key, and seals the result into the snapshot store. `busyText` is the worker line
 * while it runs.
 */
export async function syncSolana(c, busyText = "syncing") {
  const { host, gid, opened } = c;
  const { rpcUrl, s, roles } = workerInputs(c);
  c.sync = { ...c.sync, busy: true, text: busyText };
  host.render();
  try {
    await start(c, rpcUrl, roles, s.groupKey);
    const r = await c.worker.call("sync");
    const old = await c.worker.call("syncOld");
    const snap = { slot: r.slot, balance: r.balance, utxos: r.utxos, at: Date.now() };
    snap.old = { balance: old.balance, movable: old.movable, utxos: old.utxos };
    await saveSnap(host.Z, roles.seal_key, gid, snap);
    if (!stillOpen(c, opened)) return;
    c.sync = {
      balance: solText(r.balance),
      ...notesOf(r),
      oldBalance: old.movable,
      text: "synced at slot " + r.slot + ", " + c.workerAddress,
    };
  } catch (e) {
    if (!stillOpen(c, opened)) return;
    c.sync = { ...c.sync, busy: false, text: "failed: " + (e.message ?? e) };
    throw e;
  } finally {
    host.render();
  }
}

/**
 * Reads the public balance of the fee address of each seat of this browser that has one, the
 * public balance of the group key (SOL that the group held before the fee keys), whether the
 * nonce account of the beta exists (the move of the beta funds needs it), and the rent that a
 * proposal account holds until it closes.
 */
export async function refreshChain(c) {
  const { groupKey } = agreement(c).done;
  const { opened } = c;
  const worker = await ensureWorker(c);
  const owner = base58(groupKey),
    nonce = base58(await nonceAccountHex(groupKey));
  const seats = c.host.localSeats().filter((i) => feeOf(c, i) !== null);
  const read = (account) => worker.call("balance", { account });
  const [funds, held, rent, ...fees] = await Promise.all([
    read(owner),
    read(nonce),
    worker.call("rent", { space: String(PROPOSAL_SPACE) }),
    ...seats.map((i) => read(base58(feeOf(c, i).key))),
  ]);
  if (!stillOpen(c, opened)) return;
  c.chain = {
    balance: solText(funds.lamports),
    nonce: held.lamports === "0" ? "missing" : "created",
    proposalRent: rent.lamports,
    fees: Object.fromEntries(seats.map((seat, n) => [seat, solText(fees[n].lamports)])),
    at: Date.now(),
  };
  c.host.render();
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
// The indexer shows a deposit or an execute a few seconds after it lands.
const POLL_MS = 4_000;
const INDEXER_WAIT_MS = 60_000;
const INDEXER_TEXT = "Waiting for the indexer";

/**
 * Reads the chain, then syncs every 4 s until the private balance or the beta funds change, for
 * 60 s at most. The worker line says that the page waits for the indexer.
 */
export async function syncUntilChanged(c) {
  const { opened } = c;
  const before = [c.sync.balance, c.sync.oldBalance];
  const end = Date.now() + INDEXER_WAIT_MS;
  await refreshChain(c);
  for (let text = "syncing"; stillOpen(c, opened); text = INDEXER_TEXT) {
    await syncSolana(c, text);
    const changed = c.sync.balance !== before[0] || c.sync.oldBalance !== before[1];
    if (!stillOpen(c, opened) || changed || Date.now() > end) return;
    c.sync = { ...c.sync, busy: true, text: INDEXER_TEXT }; // the Sync button waits too
    c.host.render();
    await sleep(POLL_MS);
  }
}

// A sync job that failed is tried again after 15 s, then twice as long each time up to 5 min.
const RETRY_FIRST_MS = 15_000;
const RETRY_MAX_MS = 300_000;
const unsynced = (c) =>
  c.sessions.filter((ss) => ss.status === "sent" && isPayment(ss) && !c.syncedSent.has(ss.id));
// Nothing to sync: the first sync is done, and no sent payment or deposit waits for a poll.
const idle = (c, ids) => c.autoSynced && !ids.length && !c.pollWanted;
// Overview or the Solana workspace showed this wallet and its sessions are loaded and checked.
// Balance observation never opens the separate local-prover device-check gate (`viewed`).
const shown = (c) => (c.viewed || c.balanceViewed)
  && c.rpcUrl && c.loaded[SESSIONS] && c.sessWait === 0;
// No sync runs, the retry time passed, and the tab of the browser is not hidden.
const due = (c) =>
  !c.autoSyncBusy &&
  Date.now() >= c.autoSyncAfter &&
  globalThis.document?.visibilityState !== "hidden";

async function firstSync(c, opened) {
  await refreshChain(c);
  if (stillOpen(c, opened)) await syncSolana(c);
  if (stillOpen(c, opened)) c.autoSynced = true;
}

/** A failed sync job: the worker line says why, and a pass of the reactor tries again later. */
function retryLater(c, e) {
  c.autoSyncFails += 1;
  const wait = Math.min(RETRY_FIRST_MS * 2 ** (c.autoSyncFails - 1), RETRY_MAX_MS);
  c.autoSyncAfter = Date.now() + wait;
  c.sync = { ...c.sync, busy: false, text: "failed: " + (e?.message ?? e) };
  c.host.render();
  setTimeout(() => c.host.refilter(), wait + 100);
}

/**
 * Runs `sync`. Only when it worked do the payments `ids` and `polls` deposits count as synced; a
 * failed sync leaves them waiting and is tried again later.
 */
async function syncedAfter(c, opened, sync, { ids, polls }) {
  try {
    await sync();
    if (!stillOpen(c, opened)) return;
    for (const id of ids) c.syncedSent.add(id);
    c.pollWanted -= polls;
    c.autoSyncFails = 0;
  } catch (e) {
    if (stillOpen(c, opened)) retryLater(c, e);
  }
}

/** Runs one sync job of this open wallet, under one key, with `autoSyncBusy` set. */
function syncJob(c, run) {
  const { opened } = c;
  c.host.once("sol:autosync:" + opened, async () => {
    c.autoSyncBusy = true;
    try {
      await run(opened);
    } finally {
      if (stillOpen(c, opened)) c.autoSyncBusy = false;
    }
  });
}

/**
 * The Sync button: a sync that works ends the back-off of the automatic syncs. When it shows a
 * change, it also counts the payments that were sent before it as synced.
 */
export async function syncNow(c) {
  const { opened } = c;
  const ids = unsynced(c).map((ss) => ss.id);
  const before = [c.sync.balance, c.sync.oldBalance];
  await syncSolana(c);
  if (!stillOpen(c, opened)) return;
  // The indexer may lag: a sync that shows no change leaves the payments to the poll.
  const changed = c.sync.balance !== before[0] || c.sync.oldBalance !== before[1];
  if (changed) for (const id of ids) c.syncedSent.add(id);
  Object.assign(c, { autoSyncFails: 0, autoSyncAfter: 0 });
}

/** Syncs until the balances change, after a deposit (Add SOL) that this browser sent. */
export function pollBalances(c) {
  c.pollWanted += 1;
  autoSync(c);
}

/**
 * Syncs with no click (S2): once when the Solana tab shows a loaded wallet, and again until the
 * balances change after a payment ends as sent, on this device or another. The reactor calls it
 * on every pass, so the cheap checks come first.
 */
export function autoSync(c) {
  if (!shown(c) || !due(c)) return;
  const ids = unsynced(c).map((ss) => ss.id);
  if (idle(c, ids)) return;
  if (shareSeat(c) === undefined || agreement(c).state !== "agree") return;
  // The first sync shows the payments sent before it started; a deposit waits for a poll.
  const [sync, polls] = c.autoSynced
    ? [() => syncUntilChanged(c), c.pollWanted]
    : [(opened) => firstSync(c, opened), 0];
  syncJob(c, (opened) => syncedAfter(c, opened, () => sync(opened), { ids, polls }));
}

/** Shows the saved snapshot once, before the first sync of this tab. */
export async function showSaved(c) {
  const { host, W, gid } = c,
    seat = shareSeat(c);
  if (seat === undefined || c.savedShown) return;
  c.savedShown = true;
  const s = solOf(host, gid, seat),
    roles = J(W.sol_roles(s.solSeed, s.groupKey));
  const snap = await loadSnap(host.Z, roles.seal_key, gid);
  if (!snap || c.gid !== gid || c.sync.balance !== undefined) return;
  const oldBalance = snap.old?.movable;
  c.sync = {
    balance: solText(snap.balance),
    ...notesOf(snap),
    oldBalance,
    text: "saved sync of slot " + snap.slot,
  };
  host.render();
}
