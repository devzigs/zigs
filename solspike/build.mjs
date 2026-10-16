// Builds the Solana browser bundle web/sol/zolana.bundle.js (one ES module, minified) and copies
// the two slim hasher wasm files next to it (with the home folder of their author cut out of the
// panic text). Reads the Zolana repo and changes nothing in it. The build rewrites no SDK source:
// it only maps module names (aliases), and build.test.mjs checks that every SDK file in the
// bundle equals its blob at the pin.
// Usage: node solspike/build.mjs [--out DIR] [--unminified]
// ZOLANA_REPO names the repo. It must be at PIN.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
// The newest main commit of helius-labs/zolana that the Devnet pool runs (ZOLANA.md 3.4).
export const PIN = "c232da1bd6748628b56bb8c277bcffbaaf2b0774";
// The slim hasher loads its wasm with new URL(name, import.meta.url): the two files sit next to
// the bundle under the names that the hasher package gives them.
const SISD = "light_wasm_hasher_bg.wasm";
const SIMD = "hasher_wasm_simd_bg.wasm";
const FILES = ["zolana.bundle.js", SISD, SIMD];

// No import of tools/paths.mjs: build.test.mjs copies this file to another folder.
function repoDir() {
  if (!process.env.ZOLANA_REPO) throw new Error("set ZOLANA_REPO");
  return process.env.ZOLANA_REPO;
}
const git = (repo, ...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });

/** The build needs the pinned commit and an unchanged SDK source tree. */
function checkPin(repo) {
  const head = git(repo, "rev-parse", "HEAD").trim();
  if (head !== PIN) throw new Error(`Zolana repo is at ${head}, expected ${PIN}`);
  if (git(repo, "status", "--porcelain", "--", "sdk-libs/ts/src").trim() !== "") {
    throw new Error("sdk-libs/ts/src has local changes; the build needs the pinned source");
  }
  return head;
}

/**
 * The module names of entry.js and the two stubs. "zolana-sdk", "zolana-interface" and
 * "zolana-transaction" are the public subpaths of the SDK package (its `exports` map). The hasher
 * alias takes the slim build of the same package, which its `exports` map lists as "./slim": the
 * SDK imports the fat build, which holds the wasm as text and is 4.39 MB.
 */
export function aliases(repo) {
  const src = join(repo, "sdk-libs/ts/src");
  const hasher = "node_modules/@lightprotocol/hasher.rs/dist/browser-slim/es/index_browser_slim.js";
  return {
    "zolana-sdk": join(src, "index.ts"),
    "zolana-interface": join(src, "interface/index.ts"),
    "zolana-transaction": join(src, "transaction/index.ts"),
    "@phala/dcap-qvl": join(HERE, "stubs/dcap-qvl-stub.js"),
    crypto: join(HERE, "stubs/node-crypto-stub.js"),
    "@lightprotocol/hasher.rs": join(repo, hasher),
  };
}

/**
 * The slim hasher wasm holds the home folder of its author in panic text (a path below the
 * macOS home root, then the crate registry). The same number of bytes of a neutral name go in its
 * place, so every offset stays valid.
 */
export function withoutHomePaths(bytes) {
  const home = /\/Users\/[^/\0]*\//g;
  const text = bytes.toString("latin1");
  return Buffer.from(
    text.replace(home, (m) => `/build/${"x".repeat(m.length - 8)}/`),
    "latin1",
  );
}

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

function wasmFiles(repo) {
  const dir = join(repo, "node_modules/@lightprotocol/hasher.rs/dist");
  return [SISD, SIMD].map((name) => ({ from: join(dir, name), to: name }));
}

/** The esbuild options. No plugin: nothing here changes the text of a source file. */
export function buildOptions({ out, minify, repo }) {
  return {
    absWorkingDir: HERE,
    entryPoints: [join(HERE, "src/entry.js")],
    outfile: join(out, "zolana.bundle.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify,
    metafile: true,
    legalComments: "eof",
    logLevel: "warning",
    nodePaths: [join(repo, "node_modules")],
    define: { "process.env.NODE_ENV": '"production"' },
    alias: aliases(repo),
  };
}

/**
 * Builds into `out`. Returns the file hashes and the esbuild metafile.
 * The minified bundle is the same in every checkout location.
 */
export async function buildBundle({ out, minify = true, repo = repoDir() }) {
  const commit = checkPin(repo);
  const wasm = wasmFiles(repo);
  const result = await build(buildOptions({ out, minify, repo }));
  mkdirSync(out, { recursive: true });
  for (const w of wasm) {
    writeFileSync(join(out, w.to), withoutHomePaths(readFileSync(w.from)));
  }
  const hashes = Object.fromEntries(FILES.map((f) => [f, sha256(join(out, f))]));
  const sums = FILES.map((f) => `${hashes[f]}  ${f}`).join("\n");
  writeFileSync(join(out, "SHA256SUMS"), `${sums}\n`);
  return { commit, hashes, metafile: result.metafile };
}

function cli() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--out");
  const out = resolve(at < 0 ? join(HERE, "../web/sol") : args[at + 1]);
  return buildBundle({ out, minify: !args.includes("--unminified") }).then((r) => {
    console.log(`built ${out} at Zolana ${r.commit.slice(0, 8)}, no SDK patch`);
    for (const [name, hash] of Object.entries(r.hashes)) console.log(`${hash}  ${name}`);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
