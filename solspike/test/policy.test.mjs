// Policy tests (P8c). Usage: node solspike/test/policy.test.mjs
// 1. policy() of the clone gives the same string as policy() of the base commit, for three URLs.
// 2. The page policy names no Helius host, also with SOL=1.
// 3. With SOL=1 every response under /sol, in every spelling of the path, carries the Worker
//    policy, and no other path does.
// 4. With SOL unset or any value but the string 1, every /sol path answers 404 and the asset
//    server is never asked. Other paths still reach it.
// 5. The password gate stays in front of the /sol route.
// 6. /sol/config.json gives the secret HELIUS_DEVNET_URL as JSON (503 when it is unset), with
//    no-store and the Worker policy, to GET only, behind the gate, and only with SOL=1. No other
//    spelling of the path gives the value.
// The real fetch handler of cf/src/index.js runs in a vm with stubs for the Cloudflare parts.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = JSON.parse(readFileSync(join(ROOT, "solspike/baseline.json"), "utf8")).baseCommit;
const URLS = ["http://localhost:8795/", "https://app.zigs.app/", "http://127.0.0.1:8795/"];
const WORKER_POLICY =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; " +
  "connect-src 'self' https://devnet.helius-rpc.com; base-uri 'none'";
const step = (name) => console.log(`ok  ${name}`);

const baseSource = () =>
  execFileSync("git", ["show", `${BASE}:cf/src/index.js`], { cwd: ROOT, encoding: "utf8" });

/** policy() as written in a source text, run alone (the way tools/baseline.mjs does). */
function policyOf(source) {
  const chain = /const CHAIN_SERVERS = [\s\S]*?;\n/.exec(source)?.[0];
  const fn = /function policy\(url\) \{[\s\S]*?\n\}\n/.exec(source)?.[0];
  assert.ok(chain && fn, "policy() not found");
  return {
    text: chain + fn,
    run: runInNewContext(`${chain}\n${fn}\npolicy`, {}, { timeout: 1000 }),
  };
}

class Rewriter {
  on() {
    return this;
  }
  transform(res) {
    return res;
  }
}

/** The default export of cf/src/index.js, with the Cloudflare imports replaced by stubs. */
function loadWorker() {
  const code = readFileSync(join(ROOT, "cf/src/index.js"), "utf8")
    .replace('import { DurableObject } from "cloudflare:workers";', "class DurableObject {}")
    .replace("export default {", "globalThis.worker = {")
    .replace("export class Store", "class Store");
  // timingSafeEqual on crypto.subtle is a Cloudflare extension: Node has it in node:crypto.
  const crypto = { subtle: { timingSafeEqual } };
  const context = { Response, Request, URL, TextEncoder, crypto, atob, HTMLRewriter: Rewriter };
  runInNewContext(code, context, { timeout: 1000 });
  return context.worker;
}

const served = [];
const assets = {
  fetch: async (req) => {
    served.push(new URL(req.url ?? req).pathname);
    return new Response("asset body", { headers: { "content-type": "text/javascript" } });
  },
};
const ask = (worker, env, url) =>
  worker.fetch(new Request(url, { headers: { "x-forwarded-proto": "https" } }), env);

function samePolicy() {
  const base = policyOf(baseSource());
  const now = policyOf(readFileSync(join(ROOT, "cf/src/index.js"), "utf8"));
  assert.equal(now.text, base.text, "the source of policy() or CHAIN_SERVERS changed");
  for (const url of URLS) assert.equal(now.run(new URL(url)), base.run(new URL(url)));
  assert.equal(/helius/i.test(now.run(new URL(URLS[1]))), false, "the page policy names Helius");
  step("policy() equals the base policy for three URLs and names no Helius host");
}

// Every spelling that the asset server may map to a file under web/sol, and a few that it does not.
const SOL_PATHS = [
  "/sol/worker.js",
  "/sol/worker.js?x=1",
  "/sol/guard.js",
  "/sol/wasm/sol_wasm_bg.wasm",
  "/sol/zolana.bundle.js",
  "/sol",
  "/sol/",
  "/SOL/worker.js",
  "/Sol/Worker.js",
  "/%73ol/worker.js",
  "/%53OL/worker.js",
  "/sol/%77orker.js",
  "/sol/worker%2ejs",
  "/sol%2Fworker.js",
  "/sol%5Cworker.js",
  "/sol//worker.js",
  "//sol/worker.js",
  "/sol/./worker.js",
  "/sol/../sol/worker.js",
  "/sol\\worker.js",
  "/sol/%zz",
  "/%zz",
];
const OTHER_PATHS = ["/app.js", "/solar.js", "/soldier/x.js", "/pkg/sol.js", "/fonts/sol/a.woff2"];
const EVERY_FLAG_OFF = [undefined, "0", "true", "", 1, " 1", "1 ", "on", null, true];
const HEADERS = ["content-security-policy", "referrer-policy", "x-content-type-options"];

async function workerHeaders(worker) {
  const env = { DEV_NO_AUTH: "1", SOL: "1", ASSETS: assets };
  for (const path of SOL_PATHS) {
    const res = await ask(worker, env, `https://app.zigs.app${path}`);
    assert.equal(res.headers.get("content-security-policy"), WORKER_POLICY, path);
    assert.equal(res.headers.get("referrer-policy"), "no-referrer", path);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff", path);
    assert.equal(await res.text(), "asset body", path);
  }
  for (const path of OTHER_PATHS) {
    const res = await ask(worker, env, `https://app.zigs.app${path}`);
    assert.equal(res.headers.get("content-security-policy"), null, `${path} got the policy`);
  }
  const page = await ask(worker, env, "https://app.zigs.app/");
  const base = policyOf(baseSource()).run(new URL("https://app.zigs.app/"));
  assert.equal(page.headers.get("content-security-policy"), base, "the page policy changed");
  step("with SOL=1 every spelling of a /sol path carries the Worker policy; the page does not");
}

async function flagOff(worker) {
  for (const SOL of EVERY_FLAG_OFF) {
    const env = { DEV_NO_AUTH: "1", SOL, ASSETS: assets };
    served.length = 0;
    for (const path of SOL_PATHS) {
      const res = await ask(worker, env, `https://app.zigs.app${path}`);
      assert.equal(res.status, 404, `${path} with SOL=${String(SOL)}`);
      for (const name of HEADERS) assert.equal(res.headers.get(name), null, `${name} on ${path}`);
      assert.equal(/asset body/.test(await res.text()), false, `${path} served a file`);
    }
    assert.deepEqual(served, [], `the asset server was asked with SOL=${String(SOL)}`);
    for (const path of OTHER_PATHS) {
      assert.equal((await ask(worker, env, `https://app.zigs.app${path}`)).status, 200, path);
    }
    assert.equal(served.length, OTHER_PATHS.length, "another path did not reach the asset server");
  }
  step("unless SOL is the string 1, every /sol path answers 404 and no file is asked for");
}

async function gate(worker) {
  const env = { SOL: "1", APP_PASSWORD: "x", ASSETS: assets };
  served.length = 0;
  const res = await ask(worker, env, "https://app.zigs.app/sol/worker.js");
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("content-security-policy"), null);
  assert.deepEqual(served, []);
  step("the password gate answers before the /sol route");
}

const SECRET = "https://devnet.helius-rpc.com/?api-key=policy-test-value";
const CONFIG_URL = "https://app.zigs.app/sol/config.json";
const CONFIG_SPELLINGS = [
  "/SOL/config.json",
  "/sol//config.json",
  "/sol/config.json/",
  "/sol/%63onfig.json",
  "//sol/config.json",
  "/sol/Config.json",
  "/sol%2Fconfig.json",
];

function sameHeaders(res, what) {
  assert.equal(res.headers.get("content-security-policy"), WORKER_POLICY, what);
  assert.equal(res.headers.get("referrer-policy"), "no-referrer", what);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff", what);
}

async function configRoute(worker) {
  const on = { DEV_NO_AUTH: "1", SOL: "1", HELIUS_DEVNET_URL: SECRET, ASSETS: assets };
  served.length = 0;
  const ok = await ask(worker, on, CONFIG_URL);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("content-type"), /^application\/json/);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  sameHeaders(ok, "config");
  assert.deepEqual(await ok.json(), { rpcUrl: SECRET });
  const query = await ask(worker, on, `${CONFIG_URL}?x=1`);
  assert.equal(query.status, 200, "a query string");
  assert.deepEqual(served, [], "the asset server was not asked for the config");
  for (const unset of [undefined, "", null]) {
    const res = await ask(worker, { ...on, HELIUS_DEVNET_URL: unset }, CONFIG_URL);
    assert.equal(res.status, 503, `unset as ${JSON.stringify(unset)}`);
    assert.equal(res.headers.get("cache-control"), "no-store");
    sameHeaders(res, "config 503");
    const body = await res.json();
    assert.equal(typeof body.error, "string");
    assert.equal(body.rpcUrl, undefined);
  }
  const post = await worker.fetch(new Request(CONFIG_URL, { method: "POST" }), {
    ...on,
    HELIUS_DEVNET_URL: SECRET,
  });
  assert.equal(post.status, 405);
  assert.equal((await post.text()).includes("policy-test-value"), false, "POST gave the value");
  for (const path of CONFIG_SPELLINGS) {
    const res = await ask(worker, on, `https://app.zigs.app${path}`);
    assert.equal((await res.text()).includes("policy-test-value"), false, `${path} gave the value`);
  }
  step("config.json gives the secret, or 503, to GET only, with no-store and the Worker policy");
}

async function configGuarded(worker) {
  for (const SOL of EVERY_FLAG_OFF) {
    const env = { DEV_NO_AUTH: "1", SOL, HELIUS_DEVNET_URL: SECRET, ASSETS: assets };
    const res = await ask(worker, env, CONFIG_URL);
    assert.equal(res.status, 404, `config with SOL=${String(SOL)}`);
    assert.equal((await res.text()).includes("policy-test-value"), false);
  }
  const gated = { SOL: "1", APP_PASSWORD: "pw", HELIUS_DEVNET_URL: SECRET, ASSETS: assets };
  const denied = await ask(worker, gated, CONFIG_URL);
  assert.equal(denied.status, 401);
  assert.equal((await denied.text()).includes("policy-test-value"), false);
  const wrong = { "x-forwarded-proto": "https", authorization: `Basic ${btoa("u:other")}` };
  const bad = await worker.fetch(new Request(CONFIG_URL, { headers: wrong }), gated);
  assert.equal(bad.status, 401, "a wrong password");
  const good = { "x-forwarded-proto": "https", authorization: `Basic ${btoa("u:pw")}` };
  const res = await worker.fetch(new Request(CONFIG_URL, { headers: good }), gated);
  assert.equal(res.status, 200, "the right password");
  assert.deepEqual(await res.json(), { rpcUrl: SECRET });
  step("config.json needs SOL=1 and the password");
}

const worker = loadWorker();
samePolicy();
await workerHeaders(worker);
await flagOff(worker);
await gate(worker);
await configRoute(worker);
await configGuarded(worker);
console.log("policy tests passed");
