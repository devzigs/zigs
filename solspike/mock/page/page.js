// Mock page of the P8c scenarios. The harness calls window.__start(cfg) with the Worker settings
// (the role secrets never sit in a file or a URL). The page starts the product Worker through
// client.js, by way of /test-worker.js (loopback test mode), drives it against the mock Helius
// server, runs the page CSP controls and a control Worker, and leaves the facts in
// window.__result. No inline script, no eval.
import { startSolWorker } from "/sol/client.js";

const facts = [];
const out = document.getElementById("out");
const add = (e) => {
  facts.push({ t: Math.round(performance.now()), ...e });
  out.textContent = `${facts.length} facts`;
};
const reason = (e) => `${e?.name ?? "Error"}: ${e?.message ?? e}`;
const attempt = (fn) =>
  Promise.resolve()
    .then(fn)
    .then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error: reason(error) }),
    );

async function drive(sol, cfg) {
  const started = performance.now();
  const init = await sol.call("init", cfg.init);
  add({ type: "init", ...init, pageMs: Math.round(performance.now() - started) });
  const t1 = performance.now();
  const sync = await sol.call("sync");
  const sum = sync.utxos.reduce((total, u) => total + BigInt(u.amount), 0n).toString();
  const ms = Math.round(performance.now() - t1);
  add({ type: "sync", ...sync, utxos: sync.utxos.length, sum, ms });
  add({ type: "blockhash", ...(await sol.call("blockhash")) });
  add({ type: "nonce", ...(await sol.call("readNonce", { account: cfg.nonceAccount })) });
  add({ type: "fees", ...(await sol.call("treeFees", { tree: cfg.treeAccount })) });
  await proposalCalls(sol);
  return init;
}

/** simulate, send and confirm against the replay. The bytes are not read by the mock. */
async function proposalCalls(sol) {
  const tx = "AQIDBAUGBwgJCgsMDQ4P";
  add({ type: "simulate", ...(await sol.call("simulate", { tx })) });
  add({ type: "simulate-stale", ...(await sol.call("simulate", { tx })) });
  const sent = await sol.call("send", { tx });
  add({ type: "send", ...sent });
  add({ type: "confirm", ...(await sol.call("confirm", { signature: sent.signature })) });
}

async function refusals(sol, cfg, init) {
  const extra = { ...cfg.init, solSeed: "00".repeat(32) };
  const prepare = {
    kind: "transfer",
    recipient: init.shielded,
    amount: "1000",
    expiry: "1900000000",
  };
  const cases = {
    initWithSolSeed: ["init", extra],
    initWithKeyPackage: ["init", { ...cfg.init, keyPackage: "00" }],
    syncWithArgument: ["sync", { nonces: [] }],
    unknownCommand: ["sign", {}],
    prepareWithoutProof: ["prepare", prepare],
  };
  for (const [name, [cmd, args]] of Object.entries(cases)) {
    const result = await attempt(() => sol.call(cmd, args));
    add({ type: "refusal", name, ok: result.ok, error: result.error ?? null });
  }
  add({ type: "after-refusals", sync: (await sol.call("sync")).balance });
}

/** An RPC error that echoes the URL and key must reach the page redacted (made-up key). */
async function redaction(sol, cfg) {
  const bad = { ...cfg.init, rpcUrl: cfg.deadUrl };
  await sol.call("init", bad);
  const result = await attempt(() => sol.call("blockhash"));
  const text = result.error ?? "";
  const leaked = text.includes(cfg.deadKey) || text.includes(new URL(cfg.deadUrl).host);
  add({ type: "redaction", failed: !result.ok, leaked, text: text.slice(0, 160) });
}

async function pageControls(cfg) {
  const tries = {
    // oxlint-disable-next-line no-eval -- deliberate CSP control: this call must be blocked
    eval: () => (0, eval)("1+1"),
    fetchDecoy: () => fetch(`${cfg.decoy}/ping`).then((r) => r.status),
    importDecoy: () => import(`${cfg.decoy}/m.js`).then(() => "loaded"),
    fetchMock: () => fetch(`${cfg.mock}/ping`).then((r) => r.status),
  };
  for (const [name, fn] of Object.entries(tries)) {
    add({ type: "control", scope: "page", name, ...(await attempt(fn)) });
  }
}

function controlWorker(cfg) {
  return new Promise((done) => {
    const worker = new Worker("/control-worker.js", { type: "module" });
    worker.onmessage = ({ data }) => {
      if (data.type === "control") add({ scope: "control-worker", ...data });
      if (data.type === "done") done();
    };
    worker.onerror = (e) => {
      add({ type: "control-worker-error", message: e.message });
      done();
    };
    worker.postMessage({ mock: cfg.mock, decoy: cfg.decoy });
  });
}

window.__start = async (cfg) => {
  const sol = startSolWorker("/test-worker.js");
  try {
    const init = await drive(sol, cfg);
    await refusals(sol, cfg, init);
    await redaction(sol, cfg);
  } catch (error) {
    add({ type: "step-error", message: reason(error) });
  }
  sol.close();
  await controlWorker(cfg);
  await pageControls(cfg);
  await new Promise((done) => setTimeout(done, 300));
  window.__result = { facts };
  window.__done = true;
};
