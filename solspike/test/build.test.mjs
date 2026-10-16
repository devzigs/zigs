// Build tests. Usage: lockf -k "$SOL/heavy.lock" node solspike/test/build.test.mjs
// 1. The minified bundle and both wasm files are the same when built twice, in two locations.
// 2. The bundle has no node: import, no import statement, one copy of transact.ts and of kit, and
//    the dcap stub is the only dcap code. The stub throws. The bundle is at most 1 MB.
// 3. No SDK patch: the build has no plugin, every SDK file in the bundle is byte for byte its
//    blob at the pin, every other input is a dependency or an own file, and the shipped bundle
//    equals a plain esbuild build of the pinned commit (so a patch that comes back, in the
//    build options or in an alias, changes the hash and fails here).
import "../tools/quiet.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { PIN, aliases, buildBundle, buildOptions, withoutHomePaths } from "../build.mjs";
import { zolanaRepo } from "../tools/paths.mjs";

const SPIKE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = realpathSync(zolanaRepo());
const WORK = join(SPIKE, ".state/build-test");
const BUDGET = 1_000_000;
const SDK_SRC = "sdk-libs/ts/src";
const step = (name) => console.log(`ok  ${name}`);
const git = (...args) => execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8" });

/** Copies the build inputs to another directory, so the second build runs from another path. */
function otherLocation() {
  const dir = join(WORK, "loc2");
  mkdirSync(dir, { recursive: true });
  for (const name of ["build.mjs", "src", "stubs"]) {
    cpSync(join(SPIKE, name), join(dir, name), { recursive: true });
  }
  symlinkSync(join(SPIKE, "node_modules"), join(dir, "node_modules"));
  return pathToFileURL(join(dir, "build.mjs")).href;
}

async function reproducible() {
  const first = await buildBundle({ out: join(WORK, "a") });
  const { buildBundle: again } = await import(otherLocation());
  const second = await again({ out: join(WORK, "b"), repo: REPO });
  assert.deepEqual(second.hashes, first.hashes, "two locations give different files");
  step("two builds in two locations give the same bundle and wasm hashes");
  return first;
}

function shippedMatches(built) {
  const lines = readFileSync(join(SPIKE, "../web/sol/SHA256SUMS"), "utf8").trim().split("\n");
  const shipped = Object.fromEntries(lines.map((l) => l.split("  ").reverse()));
  assert.deepEqual(shipped, built.hashes, "web/sol is not the output of this build");
  for (const name of Object.keys(shipped)) {
    const same = readFileSync(join(SPIKE, "../web/sol", name)).equals(
      readFileSync(join(WORK, "a", name)),
    );
    assert.equal(same, true, `${name} in web/sol differs from the build`);
  }
  step("web/sol holds the files of this build (SHA256SUMS and the bytes)");
}

/** The home folder of the author of the slim hasher is cut out, with the same length. */
function homePaths() {
  const root = "/" + "Users" + "/";
  const sample = Buffer.from(`ab${root}someone/.cargo/x\0${root}a/b${root}`, "latin1");
  const clean = withoutHomePaths(sample);
  assert.equal(clean.length, sample.length, "the length changed");
  assert.equal(clean.toString("latin1"), "ab/build/xxxxxxx/.cargo/x\0/build/x/b" + root);
  for (const name of ["light_wasm_hasher_bg.wasm", "hasher_wasm_simd_bg.wasm"]) {
    for (const dir of [join(WORK, "a"), join(SPIKE, "../web/sol")]) {
      const holds = readFileSync(join(dir, name)).includes(root);
      assert.equal(holds, false, `${name} holds a home path`);
    }
  }
  step("the hasher wasm files hold no home path, and the cut keeps the length");
}

function bundleFacts(built) {
  const text = readFileSync(join(WORK, "a/zolana.bundle.js"), "utf8");
  const { inputs, outputs } = built.metafile;
  const names = Object.keys(inputs);
  const [output] = Object.values(outputs);
  assert.equal(Buffer.byteLength(text) < BUDGET, true, "the bundle is over 1 MB");
  assert.deepEqual(output.imports, [], "the bundle imports something");
  assert.equal(/["'`]node:/.test(text), false, "a node: string");
  assert.equal(/\bimport\s*\(/.test(text), false, "a dynamic import");
  assert.equal(/(^|\n)\s*import[\s{*]/.test(text), false, "an import statement");
  assert.equal(names.filter((n) => n.endsWith("instructions/transact.ts")).length, 1);
  const kit = new Set(
    names.filter((n) => n.includes("@solana/kit")).map((n) => n.split("/dist")[0]),
  );
  assert.equal(kit.size, 1, "more than one copy of @solana/kit");
  assert.deepEqual(
    names.filter((n) => /dcap/.test(n)),
    ["stubs/dcap-qvl-stub.js"],
  );
  step(
    `the bundle is ${Buffer.byteLength(text)} bytes, one copy of kit and transact.ts, no import`,
  );
}

const NEEDED = [
  "AssetRegistry",
  "ConfidentialTransfer",
  "ProofInputUtxo",
  "SppProofInputs",
  "createExternalData",
  "decodeTreeFees",
  "encryptConfidentialTransfer",
  "getAddressDecoder",
  "getAddressEncoder",
  "getCompiledTransactionMessageDecoder",
  "transactInstruction",
];

async function stubThrows() {
  const sdk = await import(pathToFileURL(join(WORK, "a/zolana.bundle.js")).href);
  assert.throws(() => sdk.dcapStubVerify(), /dcap-qvl stub/);
  for (const name of NEEDED) assert.equal(typeof sdk[name], "function", `${name} is not exported`);
  for (const name of ["setProofExpiry", "proofConfig"]) {
    assert.equal(sdk[name], undefined, `${name} is back: the SDK has a patch again`);
  }
  step("the dcap stub throws, the Worker pieces are exported, no expiry setter exists");
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The blob ids of the SDK source at the pin, by path from the repo root. */
function pinnedBlobs() {
  const rows = git("ls-tree", "-r", PIN, "--", SDK_SRC).trim().split("\n");
  return new Map(rows.map((row) => [row.split("\t")[1], row.split(/\s/)[2]]));
}

// The only own files in the bundle: the entry and the two stubs. A patched copy of an SDK file
// that sits in this folder and a module alias to it would show up as another input.
const OWN = new Set(["src/entry.js", "stubs/dcap-qvl-stub.js", "stubs/node-crypto-stub.js"]);

/** One of the three own files, or a package that npm installed in the Zolana checkout. */
function isOwnOrDependency(abs) {
  const installed = abs.startsWith(REPO + "/") && abs.includes("/node_modules/");
  return installed || (abs.startsWith(SPIKE + "/") && OWN.has(abs.slice(SPIKE.length + 1)));
}

/** Every SDK file that the bundle reads is its blob at the pin. No other input is from the repo. */
function sdkInputsAreThePin(built) {
  const blobs = pinnedBlobs();
  const sdk = [];
  for (const key of Object.keys(built.metafile.inputs)) {
    // esbuild marks a module that a package leaves out of the browser build as "(disabled):path".
    const abs = resolve(SPIKE, key.replace(/^\(disabled\):/, ""));
    if (abs.startsWith(join(REPO, SDK_SRC) + "/")) sdk.push(abs);
    else assert.equal(isOwnOrDependency(abs), true, `${key} is a stray input`);
  }
  assert.equal(sdk.length > 100, true, "the bundle reads too few SDK files");
  const disk = git("hash-object", ...sdk).trim().split("\n");
  sdk.forEach((abs, i) => {
    const rel = abs.slice(REPO.length + 1);
    assert.equal(disk[i], blobs.get(rel), `${rel} is not its blob at ${PIN.slice(0, 8)}`);
  });
  step(`the ${sdk.length} SDK files in the bundle are byte for byte their blobs at the pin`);
}

/** A plain esbuild run with the same module names and no plugin: the shipped hash must match. */
async function equalsPlainBuild(built) {
  assert.equal(buildOptions({ out: WORK, minify: true, repo: REPO }).plugins, undefined);
  const out = join(WORK, "plain/zolana.bundle.js");
  await build({
    absWorkingDir: SPIKE,
    entryPoints: [join(SPIKE, "src/entry.js")],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    legalComments: "eof",
    logLevel: "warning",
    nodePaths: [join(REPO, "node_modules")],
    define: { "process.env.NODE_ENV": '"production"' },
    alias: aliases(REPO),
  });
  assert.equal(sha256(readFileSync(out)), built.hashes["zolana.bundle.js"], "a patch is in");
  step("the bundle equals a plain build of the pinned commit with no plugin");
}

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
const built = await reproducible();
shippedMatches(built);
homePaths();
bundleFacts(built);
await stubThrows();
sdkInputsAreThePin(built);
await equalsPlainBuild(built);
console.log("build tests passed");
