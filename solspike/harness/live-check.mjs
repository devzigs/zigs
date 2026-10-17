// P8a live headless check, no Helius. One context loads the page at the local server. The engine
// must say it is ready, the page must raise no CSP violation and no error, every script must
// answer 200 with Cache-Control: no-cache (also for a request with a password, as every request
// of the live site has), wrangler dev must serve the engine wasm as application/wasm, and the
// policy that Chrome received for the page must be the one that baseline.json recorded from the
// dev server. The output (logs/live-check.json) also has the text of #app and #side-nav after
// the engine is ready, and the timing of a second load with 100 ms of latency on each request:
// the first paint and the start of each script. Timing is data, not a check.
// Usage: lockf -k "$SOL/heavy.lock" node harness/live-check.mjs [earlier live-check.json]
// With an earlier output, the text of #app and #side-nav must be the same (app.js split, K8).
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sleep } from "./chrome.mjs";
import { run, waitForText } from "./page.mjs";
import { ORIGIN } from "./server.mjs";
import { withStack } from "./stack.mjs";

const SPIKE = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(SPIKE, "logs/live-check.json");
const WASM = `${ORIGIN}/pkg/zigs_engine_bg.wasm`;
const CSP_TEXT = /content security policy|refused to/i;
const CSP_HEADER = "content-security-policy";
const READY = "Crypto engine ready (WebAssembly)";
const LATENCY = { offline: false, latency: 100, downloadThroughput: -1, uploadThroughput: -1 };
const PASSWORD = { Authorization: `Basic ${btoa("check:any")}` };
const recordedPolicy = () =>
  JSON.parse(readFileSync(join(SPIKE, "baseline.json"), "utf8")).served?.[CSP_HEADER];

async function headers() {
  const [wasm, page] = await Promise.all([fetch(WASM), fetch(`${ORIGIN}/`)]);
  const csp = page.headers.get(CSP_HEADER);
  return { wasmType: wasm.headers.get("content-type"), csp };
}

const pageResponse = (rec) => rec.find((r) => r.kind === "response" && r.type === "Document");
const isScript = (url) => new URL(url).pathname.endsWith(".js");

function facts(page) {
  const rec = page.records;
  const asked = rec.filter((r) => r.kind === "request");
  const origins = new Set(asked.map((r) => new URL(r.url).origin));
  const logged = (r) => ["console", "log", "exception"].includes(r.kind) && CSP_TEXT.test(r.text);
  const scripts = rec.filter((r) => r.kind === "response" && isScript(r.url));
  return {
    cspEvents: rec.filter((r) => r.kind === "csp").length,
    cspLogEntries: rec.filter(logged).length,
    errors: rec.filter((r) => r.level === "error" || r.kind === "exception").map((r) => r.text),
    wasmResponse: rec.find((r) => r.kind === "response" && r.url.endsWith(".wasm")) ?? null,
    pagePolicy: pageResponse(rec)?.headers[CSP_HEADER],
    failedRequests: rec.filter((r) => r.kind === "failed").length,
    requestedOrigins: [...origins],
    scriptsAsked: new Set(asked.filter((r) => isScript(r.url)).map((r) => r.url)).size,
    scripts: scripts.map((r) => ({ url: r.url, status: r.status })),
  };
}

// The Cache-Control of each script, asked with a password as the live site always is.
async function scriptCache(urls) {
  const out = {};
  for (const url of urls) {
    const res = await fetch(url, { headers: PASSWORD });
    out[new URL(url).pathname] = res.headers.get("cache-control");
  }
  return out;
}

const dump = (page) => run(page, () => ({
  app: document.getElementById("app").innerText,
  sideNav: document.getElementById("side-nav").innerText,
}));

// A second load with 100 ms of latency: the first paint and the start of each script (ms).
async function timing(rig) {
  const ctx = await rig.newContext("timing");
  const page = await ctx.open();
  await page.emulateNetwork(LATENCY);
  await page.navigate(`${ORIGIN}/`);
  await waitForText(page, READY);
  return run(page, () => {
    const ms = (e) => Math.round(e.startTime);
    const paint = performance.getEntriesByType("paint").map((e) => [e.name, ms(e)]);
    const scripts = performance.getEntriesByType("resource")
      .filter((e) => new URL(e.name).pathname.endsWith(".js"))
      .map((e) => [new URL(e.name).pathname, ms(e)]);
    return { latencyMs: 100, paint: Object.fromEntries(paint), scripts };
  });
}

// The asserts of the page load: no error, every script answers, no cache.
function assertScripts(out) {
  assert.deepEqual(out.errors, [], "the page logged an error");
  assert.equal(out.failedRequests, 0, "a request failed");
  const answered = new Set(out.scripts.map((s) => s.url)).size;
  assert.ok(answered > 0 && answered === out.scriptsAsked, "a script had no answer");
  for (const s of out.scripts) assert.equal(s.status, 200, `script ${s.url}`);
  for (const [path, cc] of Object.entries(out.scriptCache)) assert.equal(cc, "no-cache", path);
}

async function check(rig) {
  const earlier = process.argv[2] && JSON.parse(readFileSync(process.argv[2], "utf8")).dump;
  const ctx = await rig.newContext("live");
  const page = await ctx.open(`${ORIGIN}/`);
  await waitForText(page, READY);
  await sleep(1500);
  const engine = await run(page, () => document.getElementById("engine-text").textContent);
  const seen = facts(page);
  const out = { engine, ...seen, ...(await headers()), dump: await dump(page),
    scriptCache: await scriptCache(seen.scripts.map((s) => s.url)), timing: await timing(rig) };
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  assert.equal(engine, READY);
  assert.equal(out.cspEvents + out.cspLogEntries, 0, "CSP violations");
  assert.equal(out.wasmType, "application/wasm");
  assert.equal(out.wasmResponse?.mime, "application/wasm");
  assert.equal(out.pagePolicy, recordedPolicy(), "the page policy is not the recorded one");
  assert.deepEqual(out.requestedOrigins, [ORIGIN], "the page asked another origin");
  assertScripts(out);
  if (earlier) assert.deepEqual(out.dump, earlier, "the first screen is not the earlier one");
  console.log(JSON.stringify(out));
}

withStack("live-check", check).catch((err) => {
  console.error(err.stack ?? err);
  process.exitCode = 1;
});
