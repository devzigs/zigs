// Live check of the /sol route on the real dev server (P8c fix). It restarts the server with the
// switch SOL set to 0 and to 1, sends raw paths (no URL normalisation on our side) and checks that:
//   SOL=0: every /sol path answers 404, with no file and no Worker header; other files work.
//   SOL=1: every response under /sol, redirects included, carries the Worker policy, and
//          /sol/worker.js answers 200 with the exact policy.
//   /sol/config.json answers 503 with no HELIUS_DEVNET_URL, and 200 with a dummy value. Both
//          carry no-store and the Worker policy. No other spelling of the path gives the value.
// Usage: node solspike/harness/sol-route.mjs
// It changes the lines SOL, HELIUS_DEVNET_URL and DEV_NO_AUTH of cf/.dev.vars and puts them back.
// It reads no secret and calls no RPC.
import { request } from "node:http";
import { ORIGIN, setDevVar, startServer, stopServer } from "./server.mjs";

const DUMMY = "https://devnet.helius-rpc.com/?api-key=route-check";
const CONFIG_SPELLINGS = ["/SOL/config.json", "/sol//config.json", "/sol/config.json/",
  "/sol/%63onfig.json", "//sol/config.json"];
const POLICY =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; " +
  "connect-src 'self' https://devnet.helius-rpc.com; base-uri 'none'";
const SOL_PATHS = [
  "/sol/worker.js", "/sol/worker.js?x=1", "/sol/guard.js", "/sol/zolana.bundle.js",
  "/sol/hasher-simd.wasm", "/sol/wasm/sol_wasm_bg.wasm", "/sol", "/sol/", "/SOL/worker.js",
  "/%73ol/worker.js", "/sol/%77orker.js", "/sol/worker%2ejs", "/sol%2Fworker.js",
  "/sol%5Cworker.js", "/sol//worker.js", "//sol/worker.js", "/sol/./worker.js",
  "/sol/../sol/worker.js", "/sol\\worker.js", "/sol/worker.js/", "/sol/%zz", "/%zz",
];
const OTHER_PATHS = ["/app.js", "/sol-nothing.js", "/solar.js", "/nosuch.js"];

/** One GET with the path as given. Resolves { status, csp, location, cache, body }. */
const get = (path) =>
  new Promise((ok, bad) => {
    const { hostname, port } = new URL(ORIGIN);
    // agent: false, so no socket of the stopped server is reused after a restart.
    const req = request({ hostname, port, path, method: "GET", agent: false }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      const csp = res.headers["content-security-policy"] ?? null;
      res.on("end", () => {
        const { location, "cache-control": cache } = res.headers;
        const body = Buffer.concat(chunks).toString();
        ok({ status: res.statusCode, csp, location, cache, body });
      });
    });
    req.on("error", bad);
    req.end();
  });

function restart(vars) {
  stopServer();
  for (const [name, value] of Object.entries(vars)) setDevVar(name, value);
  startServer();
}

const problems = [];
const expect = (ok, text) => {
  if (!ok) problems.push(text);
};

async function switchOff() {
  for (const path of SOL_PATHS) {
    const r = await get(path);
    expect(r.status === 404 && r.csp === null, `SOL=0: ${path} gave ${r.status}`);
  }
  expect((await get("/app.js")).status === 200, "SOL=0: /app.js is not served");
  console.log(`SOL=0: ${SOL_PATHS.length} /sol spellings checked`);
}

async function switchOn() {
  let served = 0;
  for (const path of SOL_PATHS) {
    const r = await get(path);
    expect(r.csp === POLICY, `SOL=1: ${path} gave ${r.status} without the Worker policy`);
    if (r.status === 200) served += 1;
  }
  const worker = await get("/sol/worker.js");
  expect(worker.status === 200 && worker.csp === POLICY, "SOL=1: /sol/worker.js is not served");
  for (const path of OTHER_PATHS) {
    expect((await get(path)).csp === null, `SOL=1: ${path} has the Worker policy`);
  }
  console.log(`SOL=1: ${SOL_PATHS.length} /sol spellings checked, ${served} answered 200`);
}

async function config(want) {
  const r = await get("/sol/config.json");
  const body = JSON.parse(r.body);
  expect(r.status === want.status, `config: status ${r.status}, wanted ${want.status}`);
  expect(r.csp === POLICY, "config: no Worker policy");
  expect(r.cache === "no-store", "config: no Cache-Control no-store");
  expect(want.ok ? body.rpcUrl === DUMMY : body.rpcUrl === undefined, "config: wrong body");
  expect(want.ok || typeof body.error === "string", "config: no error text");
  for (const path of CONFIG_SPELLINGS) {
    const other = await get(path);
    expect(!other.body.includes(DUMMY), `config: ${path} gave the value`);
  }
  console.log(`config: ${want.status} as wanted, ${CONFIG_SPELLINGS.length} spellings checked`);
}

const before = {};
try {
  for (const name of ["DEV_NO_AUTH", "SOL", "HELIUS_DEVNET_URL"]) {
    before[name] = setDevVar(name, null);
  }
  restart({ DEV_NO_AUTH: "1", SOL: "0" });
  await switchOff();
  restart({ SOL: null });
  await switchOn();
  await config({ status: 503, ok: false });
  restart({ HELIUS_DEVNET_URL: DUMMY });
  await config({ status: 200, ok: true });
} finally {
  try {
    stopServer();
  } catch (err) {
    problems.push(`stop failed: ${err.message}`);
  }
  for (const [name, value] of Object.entries(before)) setDevVar(name, value);
}
for (const text of problems) console.log(`FAIL  ${text}`);
console.log(problems.length === 0 ? "route check passed" : "route check FAILED");
process.exitCode = problems.length === 0 ? 0 : 1;
