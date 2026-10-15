// P8a live headless check, no Helius. One context loads the page at the local server. The engine
// must say it is ready, the page must raise no CSP violation, wrangler dev must serve the engine
// wasm as application/wasm, and the policy that Chrome received for the page must be the one that
// baseline.json recorded from the dev server.
// Usage: lockf -k "$SOL/heavy.lock" node harness/live-check.mjs
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
const WASM = `${ORIGIN}/pkg/zec_frost_wasm_bg.wasm`;
const CSP_TEXT = /content security policy|refused to/i;
const CSP_HEADER = "content-security-policy";
const recordedPolicy = () =>
  JSON.parse(readFileSync(join(SPIKE, "baseline.json"), "utf8")).served?.[CSP_HEADER];

async function headers() {
  const [wasm, page] = await Promise.all([fetch(WASM), fetch(`${ORIGIN}/`)]);
  const csp = page.headers.get(CSP_HEADER);
  return { wasmType: wasm.headers.get("content-type"), csp };
}

const pageResponse = (rec) => rec.find((r) => r.kind === "response" && r.type === "Document");

function facts(page) {
  const rec = page.records;
  const asked = rec.filter((r) => r.kind === "request");
  const origins = new Set(asked.map((r) => new URL(r.url).origin));
  const logged = (r) => ["console", "log", "exception"].includes(r.kind) && CSP_TEXT.test(r.text);
  return {
    cspEvents: rec.filter((r) => r.kind === "csp").length,
    cspLogEntries: rec.filter(logged).length,
    errors: rec.filter((r) => r.level === "error" || r.kind === "exception").map((r) => r.text),
    wasmResponse: rec.find((r) => r.kind === "response" && r.url.endsWith(".wasm")) ?? null,
    pagePolicy: pageResponse(rec)?.headers[CSP_HEADER],
    failedRequests: rec.filter((r) => r.kind === "failed").length,
    requestedOrigins: [...origins],
  };
}

async function check(rig) {
  const ctx = await rig.newContext("live");
  const page = await ctx.open(`${ORIGIN}/`);
  await waitForText(page, "Crypto engine ready (WebAssembly)");
  await sleep(1500);
  const engine = await run(page, () => document.getElementById("engine-text").textContent);
  const out = { engine, ...facts(page), ...(await headers()) };
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  assert.equal(engine, "Crypto engine ready (WebAssembly)");
  assert.equal(out.cspEvents + out.cspLogEntries, 0, "CSP violations");
  assert.equal(out.wasmType, "application/wasm");
  assert.equal(out.wasmResponse?.mime, "application/wasm");
  assert.equal(out.pagePolicy, recordedPolicy(), "the page policy is not the recorded one");
  assert.deepEqual(out.requestedOrigins, [ORIGIN], "the page asked another origin");
  console.log(JSON.stringify(out));
}

withStack("live-check", check).catch((err) => {
  console.error(err.stack ?? err);
  process.exitCode = 1;
});
