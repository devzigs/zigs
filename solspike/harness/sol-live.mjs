// P8c live headless check, read only. The real app page at the local dev server starts the
// Solana Worker, which syncs a throwaway empty wallet, reads the P5 nonce account and the tree 0
// fee schedule on Devnet. The Helius URL comes from /sol/config.json (cf/.dev.vars has
// HELIUS_DEVNET_URL) and every record and error is redacted. There is no send, simulate or
// prepare call.
// Usage: node solspike/harness/sol-live.mjs
// It writes logs/sol-live.json. SOL_LIVE_QUICK=1 skips the load runs.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sleep } from "./chrome.mjs";
import { run } from "./page.mjs";
import { redact } from "./redact.mjs";
import { ORIGIN } from "./server.mjs";
import { withStack } from "./stack.mjs";
import * as facts from "./sol-facts.mjs";
import { THROTTLE, coldRun, openApp, startWorker } from "./sol-load.mjs";
import * as ref from "./sol-ref.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOGS = join(HERE, "../logs");
const NONCE_ACCOUNT = "4kf6Z6LTZC7E7PRvUAoADayFXQfDGppBx8m1AuUvUndE";
const TREE_ACCOUNT = "33KVhbT4QtdQDrrrGwwThqD47Dh4Q6tA443t9jMNcWFN";
const HELIUS = "devnet.helius-rpc.com";
const WORKER = "worker:/sol/worker.js";
const WORKER_POLICY =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; " +
  "connect-src 'self' https://devnet.helius-rpc.com; base-uri 'none'";
const FEE_FIELDS = ["feePerNullifier", "appendReimbursement", "closeReimbursement", "feeBalance"];

// Runs in the page: fn must not use outer variables (see run() in page.mjs).
const READ = (method, args) => window.__sol.call(method, args);

const pageFetchHelius = () =>
  fetch("https://devnet.helius-rpc.com/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
  }).then(
    (r) => `allowed ${r.status}`,
    (e) => `${e.name}: ${e.message}`,
  );

// Run in the Worker session. Each call must be blocked by the Worker policy.
const WORKER_PROBE = `(async () => {
  const out = {};
  const other = (r) => "allowed " + r.status;
  out.otherHost = await fetch("https://lwd.zigs.app/").then(other, (e) => e.name);
  try { (0, eval)("1+1"); out.eval = "allowed"; } catch (e) { out.eval = e.name; }
  try { new Function("return 1")(); out.newFunction = "allowed"; }
  catch (e) { out.newFunction = e.name; }
  return out;
})()`;

/** Runs a harness control and notes the window of records that it caused. */
async function control(page, action) {
  const from = page.records.length;
  const outcome = await action();
  await sleep(500);
  return { outcome, window: { from, to: page.records.length } };
}

async function workerProbe(page) {
  const [worker] = page.workers().filter((w) => w.who === WORKER);
  if (!worker) throw new Error("the Solana Worker has no CDP session");
  // CDP lets evaluated code use eval on a page that forbids it, unless this flag is false.
  const params = {
    expression: WORKER_PROBE,
    awaitPromise: true,
    returnByValue: true,
    allowUnsafeEvalBlockedByCSP: false,
  };
  return (await page.sendTo(worker.sessionId, "Runtime.evaluate", params)).result.value;
}

/** What the live run did: page control, Worker start, the reads and the Worker controls. */
async function liveRun(rig, roles) {
  const ctx = await rig.newContext("live");
  const page = await openApp(ctx);
  const out = { page };
  out.pageControl = await control(page, () => run(page, pageFetchHelius));
  out.started = await startWorker(page, roles);
  out.nonce = await run(page, READ, "readNonce", { account: NONCE_ACCOUNT });
  out.fees = await run(page, READ, "treeFees", { tree: TREE_ACCOUNT });
  out.blockhash = await run(page, READ, "blockhash", {});
  out.workerControl = await control(page, () => workerProbe(page));
  await ctx.dispose();
  return out;
}

const same = (a, b, names) => names.every((n) => a?.[n] === b?.[n]);
const is = (text, got, want) => [text, got === want];

function pageControlOk(run1, csp) {
  const blocked = facts.cspBlocked(run1.page.records, run1.pageControl.window, HELIUS);
  const event = csp.control.some((e) => e.who === "page" && e.directive === "connect-src");
  return blocked && event && /TypeError/.test(run1.pageControl.outcome);
}

function workerControlOk(run1, csp) {
  const out = run1.workerControl.outcome;
  const denied = out.otherHost === "TypeError" && out.eval === "EvalError";
  const events = csp.control.filter((e) => e.who === WORKER);
  const directives = new Set(events.map((e) => e.directive));
  const blocked = facts.cspBlocked(run1.page.records, run1.workerControl.window, "lwd.zigs.app");
  return denied && out.newFunction === "EvalError" && directives.size === 2 && blocked;
}

/** The facts of the live run that the checks and the log use. No query string, no secret. */
function liveFacts(run1, truth) {
  const records = run1.page.records;
  const list = facts.requests(records);
  const workerOut = facts.outbound(list, WORKER);
  const csp = facts.cspEvents(records, [run1.pageControl.window, run1.workerControl.window]);
  const [script] = facts.responses(records, "/sol/worker.js");
  const [index] = facts.responses(records, "/").filter((r) => r.type === "Document");
  const base = ref.basePagePolicy()(new URL("http://localhost:8795/"));
  return {
    csp,
    problems: facts.consoleProblems(records, [run1.pageControl.window, run1.workerControl.window]),
    list,
    workerOut,
    calls: facts.countCalls(workerOut),
    preflights: facts.preflights(records),
    script,
    pageCsp: index?.headers["content-security-policy"],
    basePolicy: ref.withoutSocketHost(base),
    wasm: records.filter((r) => r.kind === "response" && r.url.endsWith(".wasm")),
    webSockets: records.filter((r) => r.kind === "websocket").length,
    pageControlOk: pageControlOk(run1, csp),
    workerControlOk: workerControlOk(run1, csp),
    truth,
  };
}

function checks(run1, f) {
  const { init, sync } = run1.started;
  const headers = f.script?.headers ?? {};
  const answered = f.preflights.every((p) => p.status < 300);
  const origin = (p) =>
    ["*", ORIGIN].includes(p.headers["access-control-allow-origin"]);
  const hosts = [...new Set(f.workerOut.map((r) => r.host))];
  return [
    is(
      "zero CSP violations in the page and the Worker (controls excluded)",
      f.csp.product.length,
      0,
    ),
    is("no console error, warning or exception outside the controls", f.problems.length, 0),
    ["control: the page cannot fetch the Helius host (csp blocks it)", f.pageControlOk],
    ["control: the Worker cannot fetch another host, eval or new Function", f.workerControlOk],
    [
      "the Worker reached the Helius host and none of its calls was blocked",
      f.workerOut.length > 0 && f.workerOut.every((r) => r.blocked === null),
    ],
    is("every Worker call goes to one host", hosts.join(), HELIUS),
    is("no WebSocket was created", f.webSockets, 0),
    is("/sol/worker.js carries the Worker CSP", headers["content-security-policy"], WORKER_POLICY),
    is("/sol/worker.js carries Referrer-Policy", headers["referrer-policy"], "no-referrer"),
    is(
      "/sol/worker.js carries X-Content-Type-Options",
      headers["x-content-type-options"],
      "nosniff",
    ),
    is("the page policy is the base string", ref.withoutSocketHost(f.pageCsp ?? ""), f.basePolicy),
    ["the page policy names no Helius host", !/helius/i.test(f.pageCsp ?? "")],
    [
      "every .wasm response has the type application/wasm",
      f.wasm.length > 0 && f.wasm.every((r) => r.mime === "application/wasm"),
    ],
    [
      "the Worker address equals the SDK dist address of the same secrets",
      same(init, f.truth.address, ["shielded", "ownerHash"]),
    ],
    is("the owner is the group key in base58", init.owner, f.truth.address.ownerBase58),
    is("the empty wallet has balance 0", sync.balance, "0"),
    is("the empty wallet has no UTXO", sync.utxos.length, 0),
    [
      "readNonce equals the raw read",
      same(run1.nonce, f.truth.nonce, ["authority", "nonce", "lamports"]),
    ],
    ["treeFees equals the raw read at the Rust offsets", same(run1.fees, f.truth.fees, FEE_FIELDS)],
    is(
      "blockhash gives the same 32 bytes as its base58 text",
      run1.blockhash.blockhashHex,
      ref.hexOfBase58(run1.blockhash.blockhash),
    ),
    is("the tree account has the size of the SDK", f.truth.fees.size, 40_080),
    is(
      "anchor: the root history capacity at offset 116 is 500",
      f.truth.fees.rootHistoryCapacity,
      500,
    ),
    ["anchor: the leaf count at offset 72 is not zero", f.truth.fees.nextIndex !== "0"],
    ["every CORS preflight was answered", f.preflights.length > 0 && answered],
    ["every preflight allows the page origin", f.preflights.every(origin)],
  ];
}

async function referenceTruth(roles) {
  const nonce = ref.parseNonce(await ref.rawAccount(NONCE_ACCOUNT));
  const fees = ref.parseTreeFees(await ref.rawAccount(TREE_ACCOUNT));
  return { address: await ref.referenceAddress(roles), nonce, fees };
}

async function loads(rig, roles) {
  const plain = [];
  const slow = [];
  for (let i = 0; i < 3; i += 1) plain.push(await coldRun(rig, roles));
  for (let i = 0; i < 3; i += 1) slow.push(await coldRun(rig, roles, { throttle: THROTTLE }));
  const view = ({ initMs, syncMs, bytes, files }) => ({ initMs, syncMs, bytes, files });
  return { plain: plain.map(view), throttled: slow.map(view) };
}

const BUDGET_BYTES = 1_000_000;
const BUDGET_MS = 3000;

/** The load budget of the plan, and a sanity check that the throttle reached the Worker. */
function budgetChecks(load) {
  const bytes = [...load.plain, ...load.throttled].map((r) => r.bytes);
  const slow = load.throttled.map((r) => r.initMs);
  const fast = load.plain.map((r) => r.initMs);
  const floorMs = (Math.max(...bytes) / (9_000_000 / 8)) * 1000 * 0.9;
  return [
    [
      "load: the Solana files transfer at most 1 MB (gzip as served)",
      Math.max(...bytes) <= BUDGET_BYTES,
    ],
    [
      "load: the hasher is ready within 3 s at 9 Mbps and 60 ms (every run)",
      Math.max(...slow) <= BUDGET_MS,
    ],
    [
      "load: the throttle reached the Worker (not faster than the line allows)",
      Math.min(...slow) >= floorMs,
    ],
    [
      "load: the throttled start is slower than the plain start",
      Math.min(...slow) > Math.max(...fast),
    ],
  ];
}

async function check(rig) {
  const roles = ref.throwawayRoles();
  redact.add(...Object.values(roles));
  const truth = await referenceTruth(roles);
  const run1 = await liveRun(rig, roles);
  const f = liveFacts(run1, truth);
  const quick = process.env.SOL_LIVE_QUICK === "1";
  const load = quick ? null : await loads(rig, roles);
  const list = [...checks(run1, f), ...(quick ? [] : budgetChecks(load))];
  const failed = list.filter(([, ok]) => !ok);
  for (const [text, ok] of list) console.log(`${ok ? "pass" : "FAIL"}  ${text}`);
  const { page: _page, ...rest } = run1;
  const log = { checks: list, calls: f.calls, preflights: f.preflights, csp: f.csp, load };
  mkdirSync(LOGS, { recursive: true });
  writeFileSync(
    join(LOGS, "sol-live.json"),
    redact(JSON.stringify({ ...log, run: rest }, null, 1)),
  );
  if (!quick) console.log(redact(JSON.stringify({ load })));
  if (failed.length > 0) process.exitCode = 1;
}

withStack("sol-live", check).catch((err) => {
  console.error(redact(String(err?.stack ?? err)));
  process.exitCode = 1;
});
