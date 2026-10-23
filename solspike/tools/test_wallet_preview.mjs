// Build once from isolated synthetic stores, then serve inert UI snapshots on loopback.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync }
  from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createPreviewServer, PAGES } from "./test_wallet_server.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DIRECTORY = join(ROOT, "solspike/.state/test-wallet-preview");
const BUILD = join(ROOT, "solspike/.state/test-wallet-build");
const STAMP = join(DIRECTORY, "source.sha256");

function fingerprint() {
  const hash = createHash("sha256");
  for (const dir of ["web", "web/sol", "solspike/harness", "solspike/tools"]) {
    for (const name of readdirSync(join(ROOT, dir)).sort()) {
      if (!/\.(?:js|mjs|css|html)$/.test(name)) continue;
      hash.update(dir + "/" + name + "\0").update(readFileSync(join(ROOT, dir, name)));
    }
  }
  return hash.digest("hex");
}

function current(hash) {
  return existsSync(STAMP) && readFileSync(STAMP, "utf8").trim() === hash
    && PAGES.every((page) => existsSync(join(DIRECTORY, page + ".html")));
}

function buildConfig() {
  mkdirSync(BUILD, { recursive: true });
  mkdirSync(DIRECTORY, { recursive: true });
  const file = join(BUILD, "wrangler.json");
  writeFileSync(file, JSON.stringify({
    name: "zigs-ui-sample-builder", main: join(ROOT, "cf/src/index.js"),
    compatibility_date: "2026-09-15", observability: { enabled: false },
    assets: { directory: join(ROOT, "web"), binding: "ASSETS", run_worker_first: true },
    vars: { DEV_NO_AUTH: "1", SOL: "1", HELIUS_DEVNET_URL: "https://synthetic.invalid/" },
    durable_objects: { bindings: [{ name: "STORE", class_name: "Store" }] },
    migrations: [{ tag: "v1", new_sqlite_classes: ["Store"] }],
  }, null, 2));
  return file;
}

async function waitReady(child) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw Error("Sample build server stopped; inspect build logs.");
    if (!readFileSync(join(BUILD, "server.log"), "utf8")
      .includes("Ready on http://127.0.0.1:8794")) { await delay(250); continue; }
    try {
      const answer = await fetch("http://localhost:8794/", { signal: AbortSignal.timeout(500) });
      if (answer.ok) return;
    } catch { /* Local dev server is still starting. */ }
    await delay(250);
  }
  throw Error("Sample build server did not become ready.");
}

function completed(child) {
  return new Promise((ok, bad) => {
    child.once("error", bad);
    child.once("exit", (code) => code === 0 ? ok() : bad(Error("Sample build failed; inspect "
      + "solspike/.state/test-wallet-build/browser.log.")));
  });
}

async function build(hash) {
  const cli = process.env.WRANGLER_CLI || join(ROOT, "cf/node_modules/wrangler/bin/wrangler.js");
  if (!existsSync(cli)) {
    throw Error("Install cf dependencies or set WRANGLER_CLI before rebuilding.");
  }
  const config = buildConfig();
  const log = openSync(join(BUILD, "server.log"), "w");
  const worker = spawn(process.execPath, [cli, "dev", "--config", config, "--local",
    "--ip", "127.0.0.1", "--port", "8794", "--inspector-port", "0",
    "--persist-to", join(BUILD, "state")], { cwd: BUILD, detached: true,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, stdio: ["ignore", log, log] });
  closeSync(log);
  try {
    await waitReady(worker);
    const browserLog = openSync(join(BUILD, "browser.log"), "w");
    const runner = spawn(process.execPath, ["solspike/tools/main_ui_browser.mjs"], { cwd: ROOT,
      env: { ...process.env, ZIGS_TEST_WALLET_DIR: DIRECTORY,
        ZIGS_TEST_ORIGIN: "http://localhost:8794", ZIGS_UI_PASSKEY: "1", ZIGS_UI_OVERVIEW: "1",
        ZIGS_GUIDED: "1", ZIGS_UI_ENTRY_FLOW: "1", ZIGS_UI_PHASE: "after",
        ZIGS_CAPTURE_PHASE: "after" },
      stdio: ["ignore", browserLog, browserLog] });
    closeSync(browserLog);
    await completed(runner);
    writeFileSync(STAMP, hash + "\n");
  } finally {
    try { process.kill(-worker.pid, "SIGTERM"); } catch { /* Already stopped. */ }
  }
}

if (!process.version.startsWith("v24.")) throw Error("The sample builder requires Node 24.");
const hash = fingerprint();
if (process.argv.includes("--rebuild") || !current(hash)) {
  console.log("Preparing the Test wallet sample in isolated browser stores…");
  await build(hash);
}
if (!process.argv.includes("--build-only")) {
  const server = createPreviewServer({ directory: DIRECTORY });
  server.on("error", () => { console.error("Sample preview port8793 is unavailable.");
    process.exitCode = 1; });
  server.listen(8793, "127.0.0.1", () => console.log("Test wallet: http://localhost:8793/"));
}
