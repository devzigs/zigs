// The Worker session of the tab: it checks that the Worker script carries its own policy, starts
// the Worker with the two role secrets of the group (never the key share, solSeed or a nonce),
// checks its address against the wasm address, runs a sync and keeps the sealed snapshot. The
// Helius URL comes from the server (/sol/config.json). It is held in memory, passed to the Worker
// and never logged or stored.
import { startSolWorker } from "./client.js";
import { agreement } from "./ceremony.js";
import { base58 } from "./docs.js";
import { feeOf } from "./fee.js";
import { nonceAccountHex } from "./intent.js";
import { holdsShare, refuseStopped, solOf, stopOf } from "./secrets.js";
import { loadSnap, saveSnap } from "./store.js";

const J = JSON.parse;
export const UNAVAILABLE = "Solana is not available on this server";
// The policy that cf/src/index.js gives the response of /sol/worker.js when SOL is "1". Without
// it the Worker would run with no policy of its own, so the page does not start it.
const WORKER_POLICY =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; " +
  "connect-src 'self' https://devnet.helius-rpc.com; base-uri 'none'";

/** The Helius Devnet URL that the server serves. Throws UNAVAILABLE when it gives none. */
export async function fetchRpcUrl() {
  let body;
  try {
    const res = await fetch("/sol/config.json", { cache: "no-store" });
    if (res.ok) body = await res.json();
  } catch {
    /* the text below says it */
  }
  if (typeof body?.rpcUrl !== "string" || !body.rpcUrl) throw new Error(UNAVAILABLE);
  return body.rpcUrl;
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

async function start(c, rpcUrl, roles, groupKey) {
  if (c.worker && c.inited === rpcUrl) return;
  await requireWorkerPolicy();
  c.worker ??= startSolWorker();
  const init = await c.worker.call("init", {
    rpcUrl,
    nullifierSecret: roles.nullifier_secret,
    viewingSecret: roles.viewing_sk,
    groupKey,
  });
  if (init.shielded !== roles.address || init.owner !== base58(groupKey)) {
    throw new Error(
      "The Solana worker made another address than the wasm. Do not use this wallet.",
    );
  }
  c.inited = rpcUrl;
  c.workerAddress = "the SDK address equals the wasm address";
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
  return { rpcUrl, s, roles: J(W.sol_roles(s.solSeed, s.groupKey)) };
}

/** The Worker of this tab, started if needed (it checks its own policy and its address). */
export async function ensureWorker(c) {
  const { rpcUrl, s, roles } = workerInputs(c);
  await start(c, rpcUrl, roles, s.groupKey);
  return c.worker;
}

/** Starts the Worker if needed, syncs the wallet and seals the result into the snapshot store. */
export async function syncSolana(c) {
  const { host, gid } = c;
  const { rpcUrl, s, roles } = workerInputs(c);
  c.sync = { ...c.sync, busy: true, text: "syncing" };
  host.render();
  try {
    await start(c, rpcUrl, roles, s.groupKey);
    const r = await c.worker.call("sync");
    const snap = { slot: r.slot, balance: r.balance, utxos: r.utxos, at: Date.now() };
    await saveSnap(host.Z, roles.seal_key, gid, snap);
    c.sync = {
      balance: solText(r.balance),
      text: "synced at slot " + r.slot + ", " + c.workerAddress,
    };
  } catch (e) {
    c.sync = { ...c.sync, busy: false, text: "failed: " + (e.message ?? e) };
    throw e;
  } finally {
    host.render();
  }
}

/**
 * Reads the public balance of the fee address of each seat of this browser that has one, the
 * public balance of the owner address (SOL that the group held before the fee keys) and whether
 * the nonce account exists.
 */
export async function refreshChain(c) {
  const { groupKey } = agreement(c).done;
  const worker = await ensureWorker(c);
  const owner = base58(groupKey),
    nonce = base58(await nonceAccountHex(groupKey));
  const seats = c.host.localSeats().filter((i) => feeOf(c, i) !== null);
  const read = (account) => worker.call("balance", { account });
  const [funds, held, ...fees] = await Promise.all([
    read(owner),
    read(nonce),
    ...seats.map((i) => read(base58(feeOf(c, i).key))),
  ]);
  c.chain = {
    balance: solText(funds.lamports),
    nonce: held.lamports === "0" ? "missing" : "created",
    fees: Object.fromEntries(seats.map((seat, n) => [seat, solText(fees[n].lamports)])),
    at: Date.now(),
  };
  c.host.render();
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
  c.sync = { balance: solText(snap.balance), text: "saved sync of slot " + snap.slot };
  host.render();
}
