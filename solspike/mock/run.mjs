// Mock run of the Solana Worker (P8c): the six P3b scenarios and the product configuration, each
// in a fresh in-memory context of one headless Chrome, against the shipped web/sol files and a
// replay of one real Devnet sync (key B, 0.035 SOL). No Helius key and no network are used.
// Usage: lockf -k "$SOL/heavy.lock" node solspike/mock/run.mjs [scenario ...]
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBundle } from "../build.mjs";
import { waitFor } from "../harness/chrome.mjs";
import { run } from "../harness/page.mjs";
import { redact } from "../harness/redact.mjs";
import { withStack } from "../harness/stack.mjs";
import { expectations, facts } from "./judge.mjs";
import { roleSecretsOfB } from "./roles.mjs";
import { SCENARIOS, cspFor } from "./scenarios.mjs";
import { startServers } from "./servers.mjs";
import { NONCE_ACCOUNT, TREE_ACCOUNT } from "./synthetic.mjs";

const KEY_NAME = "api-key";

const HERE = dirname(fileURLToPath(import.meta.url));
const SPIKE = resolve(HERE, "..");
const WEB_SOL = resolve(SPIKE, "../web/sol");
const LOGS = join(SPIKE, "logs");
const expected = JSON.parse(readFileSync(join(HERE, "fixtures/expected.json"), "utf8"));

/** The RPC error that a hostile server could send: it echoes the URL and the key. */
const echoEntry = (key) => ({
  seq: 900,
  method: "POST",
  path: "/",
  rpcMethod: "getLatestBlockhash",
  status: 200,
  contentType: "application/json",
  synthetic: true,
  body: JSON.stringify({
    jsonrpc: "2.0",
    error: { code: -32000, message: `rejected http://{{HOST}}/?${KEY_NAME}=${key}` },
  }),
});

function config(servers, roles, keys) {
  const { mock, decoy } = servers.origins;
  return {
    mock,
    decoy,
    nonceAccount: NONCE_ACCOUNT,
    treeAccount: TREE_ACCOUNT,
    init: { rpcUrl: `${mock}/?${KEY_NAME}=${keys.good}`, ...roles.secrets },
    deadUrl: `${mock}/?${KEY_NAME}=${keys.dead}`,
    deadKey: keys.dead,
  };
}

async function drive(page, cfg) {
  await waitFor(
    () => run(page, () => typeof window.__start === "function"),
    15000,
    () => "the mock page",
  );
  await run(page, (c) => void window.__start(c), cfg);
  await waitFor(
    () => run(page, () => window.__done === true),
    90000,
    () => "the mock page",
  );
  return run(page, () => window.__result);
}

async function scenario(rig, name, roles, bundles) {
  const began = Date.now();
  const keys = { good: randomBytes(12).toString("hex"), dead: randomBytes(12).toString("hex") };
  redact.add(keys.good, keys.dead);
  const bundleDir = SCENARIOS[name].bundle === "unmin" ? bundles.unmin : null;
  const servers = await startServers({
    solDir: WEB_SOL,
    cspFor: cspFor(name),
    bundleDir,
    extraEntries: [echoEntry(keys.dead)],
  });
  const ctx = await rig.newContext(name);
  try {
    const page = await ctx.open(null);
    await page.navigate(`${servers.origins.static}/`);
    const result = await drive(page, config(servers, roles, keys));
    const verdict = facts(page.records, servers, result);
    const checks = expectations(name, verdict, expected);
    return { name, checks, verdict, ms: Date.now() - began };
  } finally {
    await ctx.dispose();
    await servers.stop();
  }
}

function report({ name, checks, verdict, ms }) {
  const failed = checks.filter(([, ok]) => !ok);
  const state = failed.length === 0 ? "pass" : "FAIL";
  console.log(`${state}  ${name} (${checks.length} checks, ${ms} ms)`);
  for (const [text, ok] of checks) if (!ok) console.log(`      FAIL: ${text}`);
  const { page, ...rest } = verdict;
  const shown = page.filter((f) => f.type !== "control");
  mkdirSync(LOGS, { recursive: true });
  writeFileSync(
    join(LOGS, `mock-${name.replace(/\W/g, "_")}.json`),
    redact(JSON.stringify({ name, checks, verdict: rest, facts: shown }, null, 1)),
  );
  return failed.length === 0;
}

function pickScenarios() {
  const names = process.argv.slice(2);
  const todo = names.length > 0 ? names : Object.keys(SCENARIOS);
  const unknown = todo.find((name) => !Object.hasOwn(SCENARIOS, name));
  if (unknown !== undefined) throw new Error(`unknown scenario ${unknown}`);
  return todo;
}

/** The role secrets of B, with every secret added to the redactor. */
async function loadRoles() {
  const roles = await roleSecretsOfB();
  const { nullifierSecret, viewingSecret } = roles.secrets;
  redact.add(roles.seedHex, nullifierSecret, viewingSecret);
  if (roles.ownerHash !== expected.ownerHashHex) throw new Error("the SDK owner hash of B differs");
  return roles;
}

async function main(rig) {
  const todo = pickScenarios();
  const roles = await loadRoles();
  const unmin = join(SPIKE, ".state/mock/unminified");
  if (todo.includes("strict-unminified")) await buildBundle({ out: unmin, minify: false });
  let ok = true;
  for (const name of todo) ok = report(await scenario(rig, name, roles, { unmin })) && ok;
  if (!ok) process.exitCode = 1;
}

withStack("mock-run", main, { server: false }).catch((err) => {
  console.error(redact(err.stack ?? err));
  process.exitCode = 1;
});
