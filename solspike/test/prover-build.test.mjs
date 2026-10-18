// Checks of the vendored web prover (SOL-4). Usage: node solspike/test/prover-build.test.mjs
// Every file of web/sol/prover equals its line in web/sol/prover/SHA256SUMS. The real bundle
// names the key folder that web/sol/localprover.js, the /sol policy of cf/src/index.js and the
// policy check of web/sol/session.js allow, and it exports what the Worker imports. With
// ZOLANA_WEB_REPO (a checkout of zolana-web-sdk at PROVER_PIN), build-prover.mjs rebuilds every
// file into a temporary folder and must give the same bytes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FILES, buildProver } from "../build-prover.mjs";

const DIR = new URL("../../web/sol/prover/", import.meta.url);
const read = (name) => readFileSync(new URL(name, DIR));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const step = (name) => console.log(`ok  ${name}`);

const sums = Object.fromEntries(
  read("SHA256SUMS")
    .toString()
    .trim()
    .split("\n")
    .map((line) => line.split("  ").reverse()),
);
assert.deepEqual(Object.keys(sums).sort(), [...FILES].sort(), "SHA256SUMS lists other files");
for (const name of FILES) assert.equal(sha256(read(name)), sums[name], name);
step("every file of web/sol/prover equals its SHA-256 in SHA256SUMS");

const source = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const folderOf = (text, pattern) => pattern.exec(text)?.[1];
const FOLDER = /(https:\/\/d3gbdb0egjwcw9\.cloudfront\.net\/proving-keys\/[0-9a-f]{16}\/)/;
const bundle = await import(new URL("prover.js", DIR).href);
const folders = {
  bundle: bundle.KEY_BASE_URL,
  worker: folderOf(source("web/sol/localprover.js"), FOLDER),
  policy: folderOf(source("cf/src/index.js"), FOLDER),
  page: folderOf(source("web/sol/session.js"), FOLDER),
};
for (const [where, folder] of Object.entries(folders)) {
  assert.equal(folder, bundle.KEY_BASE_URL, `the key folder of ${where}`);
}
assert.equal(typeof bundle.ZolanaWebProver, "function", "the bundle exports no ZolanaWebProver");
const shapes = bundle.TRANSFER_SHAPES.filter((s) => s.outputs === 2).map((s) => s.inputs);
for (const n of [1, 2, 3, 4, 5, 6, 8]) assert.ok(shapes.includes(n), `no ${n}x2 key`);
step("the bundle, the Worker, the /sol policy and the page name one key folder");

const test = JSON.parse(read("selftest-1x2.json"));
assert.deepEqual([test.circuitType, test.nInputs, test.nOutputs], ["transfer-confidential", 1, 2]);
step("the request of the device check is a 1x2 confidential transfer");

if (process.env.ZOLANA_WEB_REPO) {
  const out = mkdtempSync(join(tmpdir(), "zigs-prover-test-"));
  try {
    const hashes = await buildProver({ out, repo: process.env.ZOLANA_WEB_REPO });
    assert.deepEqual(hashes, sums, "a rebuild gives other bytes");
    step("a rebuild from the pinned checkout gives the same bytes");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
} else {
  console.log("skip the rebuild: set ZOLANA_WEB_REPO to a checkout of zolana-web-sdk");
}
console.log("prover build tests passed");
