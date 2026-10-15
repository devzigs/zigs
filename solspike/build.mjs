// Builds the Solana browser bundle web/sol/zolana.bundle.js (one ES module, minified) and copies
// the two slim hasher wasm files next to it (with the home folder of their author cut out of the
// panic text). Reads the Zolana repo and changes nothing in it.
// Usage: node solspike/build.mjs [--out DIR] [--unminified]
// ZOLANA_REPO names the repo. It must be at 89640630.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const PIN = "89640630";
const FILES = ["zolana.bundle.js", "hasher-sisd.wasm", "hasher-simd.wasm"];
// A literal with its key: the bare literal also sits in `const NO_EXPIRY`.
export const EXPIRY_SITE = /expiryUnixTs: 0xffff_ffff_ffff_ffffn,/g;

// No import of tools/paths.mjs: build.test.mjs copies this file to another folder.
function repoDir() {
  if (!process.env.ZOLANA_REPO) throw new Error("set ZOLANA_REPO");
  return process.env.ZOLANA_REPO;
}
const git = (repo, ...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });

/** The build needs the pinned commit and an unchanged SDK source tree. */
function checkPin(repo) {
  const head = git(repo, "rev-parse", "HEAD").trim();
  if (!head.startsWith(PIN)) throw new Error(`Zolana repo is at ${head}, expected ${PIN}`);
  if (git(repo, "status", "--porcelain", "--", "sdk-libs/ts/src").trim() !== "") {
    throw new Error("sdk-libs/ts/src has local changes; the build needs the pinned source");
  }
  return head;
}

/** The slim hasher loads its wasm with new URL(name, import.meta.url). Point it at our copies. */
function hasherUrlPlugin(wasm, count) {
  const names = "light_wasm_hasher_bg|hasher_wasm_simd_bg";
  const pattern = new RegExp(`new URL\\('(${names})\\.wasm', import\\.meta\\.url\\)`, "g");
  return {
    name: "hasher-url",
    setup(b) {
      b.onLoad({ filter: /index_browser_slim\.js$/ }, (args) => {
        const contents = readFileSync(args.path, "utf8").replace(pattern, (_m, name) => {
          count.hasher += 1;
          return `new URL('${wasm[name].to}', import.meta.url)`;
        });
        return { contents, loader: "js" };
      });
    },
  };
}

/**
 * finalizeTransfer binds `expiryUnixTs: 0xffff_ffff_ffff_ffffn` into the external data hash, the
 * proof and the instruction data. The plugin makes it read `proofConfig.expiryUnixTs`, a module
 * variable that setProofExpiry() in entry.js writes.
 */
export function expiryPlugin(count) {
  return {
    name: "expiry",
    setup(b) {
      b.onLoad({ filter: /transaction[\\/]instructions[\\/]transact\.ts$/ }, (args) => {
        const source = readFileSync(args.path, "utf8");
        const found = source.match(EXPIRY_SITE)?.length ?? 0;
        if (found !== 1) throw new Error(`expiry site matched ${found} places, expected 1`);
        count.expiry += 1;
        const patched = source.replace(EXPIRY_SITE, "expiryUnixTs: proofConfig.expiryUnixTs,");
        const contents = `${patched}\nexport const proofConfig = { expiryUnixTs: NO_EXPIRY };\n`;
        return { contents, loader: "ts" };
      });
    },
  };
}

/** The module names of entry.js and the two stubs. Every name resolves to the SDK's own copy. */
export function aliases(repo) {
  const src = join(repo, "sdk-libs/ts/src");
  const hasher = "node_modules/@lightprotocol/hasher.rs/dist/browser-slim/es/index_browser_slim.js";
  return {
    "zolana-sdk": join(src, "index.ts"),
    "zolana-interface": join(src, "interface/index.ts"),
    "zolana-transact": join(src, "transaction/instructions/transact.ts"),
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
  return {
    light_wasm_hasher_bg: { from: join(dir, "light_wasm_hasher_bg.wasm"), to: "hasher-sisd.wasm" },
    hasher_wasm_simd_bg: { from: join(dir, "hasher_wasm_simd_bg.wasm"), to: "hasher-simd.wasm" },
  };
}

/**
 * Builds into `out`. Returns the file hashes, the esbuild metafile and the patch counts.
 * The minified bundle is the same in every checkout location.
 */
export async function buildBundle({ out, minify = true, repo = repoDir() }) {
  const commit = checkPin(repo);
  const wasm = wasmFiles(repo);
  const count = { hasher: 0, expiry: 0 };
  const result = await build({
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
    plugins: [hasherUrlPlugin(wasm, count), expiryPlugin(count)],
  });
  if (count.hasher !== 2) throw new Error(`hasher URL patch matched ${count.hasher}, expected 2`);
  if (count.expiry !== 1) throw new Error(`expiry patch ran ${count.expiry} times, expected 1`);
  mkdirSync(out, { recursive: true });
  for (const w of Object.values(wasm)) {
    writeFileSync(join(out, w.to), withoutHomePaths(readFileSync(w.from)));
  }
  const hashes = Object.fromEntries(FILES.map((f) => [f, sha256(join(out, f))]));
  const sums = FILES.map((f) => `${hashes[f]}  ${f}`).join("\n");
  writeFileSync(join(out, "SHA256SUMS"), `${sums}\n`);
  return { commit, hashes, metafile: result.metafile, count };
}

function cli() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--out");
  const out = resolve(at < 0 ? join(HERE, "../web/sol") : args[at + 1]);
  return buildBundle({ out, minify: !args.includes("--unminified") }).then((r) => {
    const patches = JSON.stringify(r.count);
    console.log(`built ${out} at Zolana ${r.commit.slice(0, 8)}, patches: ${patches}`);
    for (const [name, hash] of Object.entries(r.hashes)) console.log(`${hash}  ${name}`);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
