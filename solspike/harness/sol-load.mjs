// Load measurements of the live Solana check (P8c): the cost of starting the Worker in a cold
// context (unthrottled and at 9 Mbps with 60 ms latency). Every run uses a new in-memory context,
// so nothing is cached.
import { run, waitForText } from "./page.mjs";
import { ORIGIN } from "./server.mjs";
import { isHelius, isSolana, transfer } from "./sol-facts.mjs";

export const THROTTLE = {
  offline: false,
  latency: 60,
  downloadThroughput: 9_000_000 / 8,
  uploadThroughput: 9_000_000 / 8,
};
const READY = "Crypto engine ready (WebAssembly)";

/** The page of a new context, loaded to the point where the engine is ready. */
export async function openApp(ctx) {
  const page = await ctx.open(null);
  await page.navigate(`${ORIGIN}/`);
  await waitForText(page, READY, 30000);
  return page;
}

const START = async (roles) => {
  const t0 = performance.now();
  const { startSolWorker } = await import("/sol/client.js");
  window.__sol = startSolWorker();
  const { rpcUrl } = await (await fetch("/sol/config.json")).json();
  const init = await window.__sol.call("init", { rpcUrl, ...roles });
  return { init, ms: Math.round(performance.now() - t0) };
};

const SYNC = async () => {
  const t0 = performance.now();
  const sync = await window.__sol.call("sync");
  return { sync, ms: Math.round(performance.now() - t0) };
};

/** Starts the Worker in the page and runs init and the first sync. Returns the timings. */
export async function startWorker(page, roles) {
  const { init, ms: initMs } = await run(page, START, roles);
  const { sync, ms: syncMs } = await run(page, SYNC);
  return { init, sync, initMs, syncMs };
}

const solanaBytes = (records, from) => {
  const part = records.slice(from);
  return {
    solana: transfer(part, (r) => isSolana(r) && !isHelius(r)),
    helius: transfer(part, isHelius),
  };
};

/** One cold run: the page loads, then the Worker starts. `throttle` slows the network first. */
export async function coldRun(rig, roles, { throttle = null } = {}) {
  const ctx = await rig.newContext(throttle ? "cold-throttled" : "cold");
  try {
    const page = await openApp(ctx);
    if (throttle) await page.emulateNetwork(throttle);
    const from = page.records.length;
    const worker = await startWorker(page, roles);
    const sizes = solanaBytes(page.records, from);
    return { ...worker, bytes: sizes.solana.bytes, files: sizes.solana.files };
  } finally {
    await ctx.dispose();
  }
}
