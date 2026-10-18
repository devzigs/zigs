// Live CORS check of the real prove endpoint, from the browser Worker (P8c fix). The Worker of the
// real app page sends ONE deliberately invalid request to POST /v1/zolana/prove on the Devnet
// Helius host: the body is "{}" (no witness, no secret), with the headers of the SDK prover client
// (content-type and X-Sync). The check records the preflight answer, the status of the error
// response and its access-control-allow-origin header. JavaScript cannot read that header, so it
// comes from the CDP network records. The URL is read from the Helius file inside this script
// and goes only into one CDP command; every record and error is redacted.
// Usage: lockf -k "$SOL/heavy.lock" node solspike/harness/sol-cors.mjs  (writes logs/sol-cors.json)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { heliusFile } from "../tools/paths.mjs";
import { sleep, waitFor } from "./chrome.mjs";
import { run } from "./page.mjs";
import { redact } from "./redact.mjs";
import { ORIGIN } from "./server.mjs";
import { withStack } from "./stack.mjs";
import { openApp } from "./sol-load.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER = "worker:/sol/worker.js";
const PROVE = "/v1/zolana/prove";

// Runs in the page: starts the Worker and gives it no command. No init, so no secret.
const START = async () => {
  const { startSolWorker } = await import("/sol/client.js");
  window.__sol = startSolWorker();
};

/** The prove URL of the SDK: the Worker sets /v1/zolana, the prover client adds /prove. */
function proveUrl() {
  const url = new URL(readFileSync(heliusFile(), "utf8").trim());
  url.pathname = "/v1/zolana/prove";
  return url.href;
}

const probe = (url) => `(async () => {
  const out = {};
  const headers = { "content-type": "application/json", "x-sync": "true" };
  try {
    const res = await fetch(${JSON.stringify(url)}, { method: "POST", headers, body: "{}" });
    out.fetch = "response";
    out.status = res.status;
    out.type = res.type;
    out.body = (await res.text()).slice(0, 300);
  } catch (e) {
    out.fetch = e.name;
  }
  return out;
})()`;

const evalIn = async (page, worker, expression) => {
  const params = { expression, awaitPromise: true, returnByValue: true };
  const res = await page.sendTo(worker.sessionId, "Runtime.evaluate", params);
  if (res.exceptionDetails) throw new Error(redact(res.exceptionDetails.text));
  return res.result.value;
};

/** The worker session, once its script has run and installed its message handler. */
async function readyWorker(page) {
  const worker = await waitFor(
    () => page.workers().find((w) => w.who === WORKER),
    10000,
    () => "the Solana Worker session",
  );
  const ready = async () => (await evalIn(page, worker, "typeof self.onmessage")) === "function";
  await waitFor(() => ready().catch(() => false), 10000, () => "the Worker script");
  return worker;
}

const path = (r) => new URL(r.url).pathname;
const first = (...values) => values.find((v) => v !== undefined) ?? null;

/** What the network records say about one request id (wire headers first: CORS hides them). */
function wire(records, id) {
  const of = (kind) => records.find((r) => r.kind === kind && r.id === id) ?? {};
  const [seen, extra, failed] = ["response", "response-extra", "failed"].map(of);
  const headers = first(extra.headers, seen.headers) ?? {};
  return {
    status: first(extra.status, seen.status),
    allowOrigin: first(headers["access-control-allow-origin"]),
    headers,
    pageSeesResponse: seen.kind === "response",
    failed: failed.kind === "failed" ? { error: failed.error, cors: failed.cors } : null,
  };
}

/** The preflight and the POST of the one prove call, from the records after `from`. */
function corsFacts(records) {
  const calls = records.filter((r) => r.kind === "request" && path(r) === PROVE);
  const pick = (method) => calls.find((r) => r.method === method);
  const options = pick("OPTIONS");
  const post = pick("POST");
  return {
    requests: calls.map((r) => `${r.method} ${r.type}`),
    preflight: options ? wire(records, options.id) : null,
    post: post ? wire(records, post.id) : null,
  };
}

async function check(rig) {
  const url = proveUrl();
  const ctx = await rig.newContext("cors");
  try {
    const page = await openApp(ctx, { flag: true });
    await run(page, START);
    const worker = await readyWorker(page);
    const from = page.records.length;
    const outcome = await evalIn(page, worker, probe(url));
    await sleep(500);
    const facts = corsFacts(page.records.slice(from));
    const text = redact(JSON.stringify({ origin: ORIGIN, outcome, ...facts }, null, 1));
    mkdirSync(join(HERE, "../logs"), { recursive: true });
    writeFileSync(join(HERE, "../logs/sol-cors.json"), text);
    console.log(text);
    if (!facts.post || facts.post.status === null) process.exitCode = 1;
  } finally {
    await ctx.dispose();
  }
}

withStack("sol-cors", check).catch((err) => {
  console.error(redact(String(err?.stack ?? err)));
  process.exitCode = 1;
});
