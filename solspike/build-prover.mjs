// Builds the web prover of Helius (SOL-4, local proving) into web/sol/prover/: the prover API and
// its Worker as two ES modules (esbuild, minified), the Go wasm bridge (go1.27.1, GOOS=js), the
// 1x2 request of the device check, the license, and SHA256SUMS. It reads a checkout of
// helius-labs/zolana-web-sdk at PROVER_PIN and changes nothing in it: the Worker imports the Go
// shim from src/vendor/, which the repo does not track, so the sources are copied to a temporary
// folder with the shim of the same Go toolchain. The repo's npm scripts never run.
// Usage: ZOLANA_WEB_REPO=<checkout> node solspike/build-prover.mjs [--out DIR]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROVER_PIN = "25b694a92a2c3250724e95ec405bc86bc05bfa83";
// The Go of the bridge: the repo builds with it (scripts/build-wasm.sh), and wasm_exec.js must
// come from the same toolchain.
export const GO = "go1.27.1";
export const FILES = [
  "prover.js",
  "prover.worker.js",
  "zolana-prover.wasm",
  "selftest-1x2.json",
  "LICENSE",
];
const SOURCES = ["packages/web-prover/src", "wasm"];

const git = (repo, ...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });

function repoDir() {
  if (!process.env.ZOLANA_WEB_REPO) throw new Error("set ZOLANA_WEB_REPO");
  return process.env.ZOLANA_WEB_REPO;
}

/** The build needs the pinned commit and unchanged sources of the prover and the bridge. */
function checkPin(repo) {
  const head = git(repo, "rev-parse", "HEAD").trim();
  if (head !== PROVER_PIN) throw new Error(`zolana-web-sdk is at ${head}, expected ${PROVER_PIN}`);
  if (git(repo, "status", "--porcelain", "--", ...SOURCES).trim() !== "") {
    throw new Error("the prover sources have local changes; the build needs the pinned source");
  }
}

const goEnv = { ...process.env, GOTOOLCHAIN: GO, GOFLAGS: "-mod=readonly" };
const go = (cwd, args, env = {}) =>
  execFileSync("go", args, { cwd, encoding: "utf8", env: { ...goEnv, ...env } });

/** The Go bridge, built as scripts/build-wasm.sh of the repo builds it. */
function buildWasm(repo, out) {
  const env = { GOOS: "js", GOARCH: "wasm", CGO_ENABLED: "0" };
  const args = ["build", "-trimpath", "-ldflags=-s -w", "-o", join(out, "zolana-prover.wasm")];
  go(join(repo, "wasm"), [...args, "./prover-wasm"], env);
  chmodSync(join(out, "zolana-prover.wasm"), 0o644);
}

/** The prover sources with the Go shim in src/vendor/, in a new temporary folder. */
function stagedSources(repo) {
  const dir = mkdtempSync(join(tmpdir(), "zigs-prover-"));
  cpSync(join(repo, "packages/web-prover/src"), join(dir, "src"), { recursive: true });
  const root = go(join(repo, "wasm"), ["env", "GOROOT"]).trim();
  mkdirSync(join(dir, "src/vendor"), { recursive: true });
  cpSync(join(root, "lib/wasm/wasm_exec.js"), join(dir, "src/vendor/wasm_exec.js"));
  return dir;
}

/** The esbuild options of one entry. No plugin and no alias: no source text changes. */
export function buildOptions(dir, entry, outfile) {
  return {
    absWorkingDir: dir,
    entryPoints: [join(dir, "src", entry)],
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    legalComments: "eof",
    logLevel: "warning",
  };
}

async function bundle(repo, out) {
  const dir = stagedSources(repo);
  try {
    await build(buildOptions(dir, "index.ts", join(out, "prover.js")));
    await build(buildOptions(dir, "prover.worker.ts", join(out, "prover.worker.js")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** Builds into `out` and returns the hash of each file. */
export async function buildProver({ out, repo = repoDir() }) {
  checkPin(repo);
  mkdirSync(out, { recursive: true });
  buildWasm(repo, out);
  await bundle(repo, out);
  cpSync(join(repo, "wasm/prover-wasm/testdata/transfer-1x2.json"), join(out, FILES[3]));
  cpSync(join(repo, "LICENSE"), join(out, "LICENSE"));
  const hashes = Object.fromEntries(FILES.map((f) => [f, sha256(join(out, f))]));
  const sums = FILES.map((f) => `${hashes[f]}  ${f}`).join("\n");
  writeFileSync(join(out, "SHA256SUMS"), `${sums}\n`);
  return hashes;
}

function cli() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--out");
  const out = resolve(at < 0 ? join(HERE, "../web/sol/prover") : args[at + 1]);
  return buildProver({ out }).then((hashes) => {
    console.log(`built ${out} at zolana-web-sdk ${PROVER_PIN.slice(0, 8)} with ${GO}`);
    for (const [name, hash] of Object.entries(hashes)) console.log(`${hash}  ${name}`);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
