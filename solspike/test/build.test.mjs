// Build tests (P8c). Usage: lockf -k "$SOL/heavy.lock" node solspike/test/build.test.mjs
// 1. The minified bundle and both wasm files are the same when built twice, in two locations.
// 2. The bundle has no node: import, no import statement, one copy of transact.ts and of kit, and
//    the dcap stub is the only dcap code. The stub throws. The bundle is at most 1 MB.
// 3. The expiry patch has one site (the bare literal has two), and the patched SDK binds the
//    expiry that setProofExpiry sets, while the unpatched dist binds u64::MAX (offline, no RPC).
import "../tools/quiet.mjs";
import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { EXPIRY_SITE, aliases, buildBundle, expiryPlugin, withoutHomePaths } from "../build.mjs";
import { zolanaRepo } from "../tools/paths.mjs";

const SPIKE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = zolanaRepo();
const WORK = join(SPIKE, ".state/build-test");
const BUDGET = 1_000_000;
const U64_MAX = 0xffff_ffff_ffff_ffffn;
const step = (name) => console.log(`ok  ${name}`);

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
  assert.deepEqual(first.count, { hasher: 2, expiry: 1 });
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
function homePaths(built) {
  const root = "/" + "Users" + "/";
  const sample = Buffer.from(`ab${root}someone/.cargo/x\0${root}a/b${root}`, "latin1");
  const clean = withoutHomePaths(sample);
  assert.equal(clean.length, sample.length, "the length changed");
  assert.equal(clean.toString("latin1"), "ab/build/xxxxxxx/.cargo/x\0/build/x/b" + root);
  for (const name of ["hasher-sisd.wasm", "hasher-simd.wasm"]) {
    for (const dir of [join(WORK, "a"), join(SPIKE, "../web/sol")]) {
      const holds = readFileSync(join(dir, name)).includes(root);
      assert.equal(holds, false, `${name} holds a home path`);
    }
  }
  assert.equal(built.count.hasher, 2);
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

async function stubThrows() {
  const sdk = await import(pathToFileURL(join(WORK, "a/zolana.bundle.js")).href);
  assert.throws(() => sdk.dcapStubVerify(), /dcap-qvl stub/);
  const names = ["setProofExpiry", "decodeTreeFees", "getAddressDecoder", "getAddressEncoder"];
  for (const name of [...names, "getCompiledTransactionMessageDecoder"]) {
    assert.equal(typeof sdk[name], "function", `${name} is not exported`);
  }
  step("the dcap stub throws and the Worker helpers are exported");
}

function patchSite() {
  const source = readFileSync(
    join(REPO, "sdk-libs/ts/src/transaction/instructions/transact.ts"),
    "utf8",
  );
  assert.equal(source.match(EXPIRY_SITE)?.length, 1, "the expiry site is not unique");
  assert.equal(source.match(/0xffff_ffff_ffff_ffffn/g)?.length, 2, "NO_EXPIRY moved");
  step("the expiry site is one line (the bare literal also sits in NO_EXPIRY)");
}

const ed25519Public = (seedByte) => {
  const der = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.alloc(32, seedByte),
  ]);
  const key = createPublicKey(createPrivateKey({ key: der, format: "der", type: "pkcs8" }));
  return Uint8Array.from(key.export({ format: "der", type: "spki" }).subarray(-32));
};

const scalar = (n) => {
  const out = new Uint8Array(32);
  new DataView(out.buffer).setBigUint64(24, BigInt(n));
  return out;
};

/** A test wallet from one byte: Ed25519 signer, nullifier secret, viewing scalar. */
function testWallet(sdk, seed) {
  const signer = ed25519Public(seed);
  const nullifier = sdk.NullifierKey.fromSecret(new Uint8Array(31).fill(seed));
  const viewing = sdk.ViewingKey.fromBytes(scalar(0x1000_0000 + seed));
  const owner = sdk.ShieldedPublicKey.fromEd25519(signer);
  const address = sdk.ShieldedAddress.fromPublicKeys(
    owner,
    nullifier.publicKey(),
    viewing.publicKey(),
  );
  return { signer, nullifier, viewing, owner, address };
}

/** Builds one SOL transfer from fixed test keys and returns the external data it binds. */
function finalizeTransfer(sdk, expiry) {
  const group = testWallet(sdk, 0x42);
  const payee = testWallet(sdk, 0x43);
  const salt = Uint8Array.from({ length: 16 }, (_, i) => 0xa0 + i);
  const SOL = "11111111111111111111111111111111";
  const utxo = new sdk.Utxo({ owner: group.owner, asset: SOL, amount: 100n, blinding: scalar(7) });
  const input = sdk.ProofInputUtxo.fromNullifierKey(utxo, group.nullifier);
  const key = "11111111111111111111111111111112";
  const transfer = new sdk.ConfidentialTransfer(group.address, [input], key);
  transfer.send(payee.address, SOL, 40n);
  const prepared = transfer.prepare();
  const txKey = group.viewing.transactionViewingKey(prepared.firstNullifier);
  if (expiry !== undefined) sdk.proofConfig.expiryUnixTs = expiry;
  const assets = new sdk.AssetRegistry([]);
  const payload = sdk.encodeConfidentialSlots(prepared.outputs, assets, txKey, salt);
  const inputs = prepared.finalize({ txViewingPublicKey: txKey.publicKey(), salt, payload });
  return inputs.externalData;
}

/** The Node hasher stays a bare import, which Node finds through the repo's node_modules. */
async function patchedBundle() {
  const out = join(WORK, "expiry-test.mjs");
  symlinkSync(join(REPO, "node_modules"), join(WORK, "node_modules"));
  const { "@lightprotocol/hasher.rs": _browserHasher, ...names } = aliases(REPO);
  await build({
    absWorkingDir: SPIKE,
    entryPoints: [join(SPIKE, "test/expiry-entry.js")],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    nodePaths: [join(REPO, "node_modules")],
    external: ["@lightprotocol/hasher.rs"],
    alias: { ...names, "zolana-tx": join(REPO, "sdk-libs/ts/src/transaction/index.ts") },
    plugins: [expiryPlugin({ expiry: 0 })],
    logLevel: "warning",
  });
  return import(pathToFileURL(out).href);
}

/** The hash is a function of the expiry: same fields, same hash; another expiry, another hash. */
function hashFollowsExpiry(sdk, bound) {
  const again = sdk.createExternalData({ ...bound, expiryUnixTs: bound.expiryUnixTs });
  assert.deepEqual(again.hash(), bound.hash(), "the external data hash is not reproducible");
  const other = sdk.createExternalData({ ...bound, expiryUnixTs: bound.expiryUnixTs + 1n });
  assert.notDeepEqual(other.hash(), bound.hash(), "the external data hash ignores the expiry");
}

async function expiryIsBound() {
  const dist = await import(pathToFileURL(join(REPO, "sdk-libs/ts/dist/index.js")).href);
  const distTx = await import(
    pathToFileURL(join(REPO, "sdk-libs/ts/dist/transaction/index.js")).href
  );
  await dist.initializePoseidon();
  const control = finalizeTransfer({ ...dist, ...distTx });
  assert.equal(control.expiryUnixTs, U64_MAX, "the unpatched SDK does not bind u64::MAX");
  const sdk = await patchedBundle();
  await sdk.initializePoseidon();
  assert.equal(finalizeTransfer(sdk).expiryUnixTs, U64_MAX, "the default is not u64::MAX");
  const expiry = 1_900_000_000n;
  const bound = finalizeTransfer(sdk, expiry);
  assert.equal(bound.expiryUnixTs, expiry, "the patched site ignores the setter");
  hashFollowsExpiry(sdk, bound);
  step("the proof binds the expiry of setProofExpiry; the unpatched SDK binds u64::MAX");
}

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
const built = await reproducible();
shippedMatches(built);
homePaths(built);
bundleFacts(built);
await stubThrows();
patchSite();
await expiryIsBound();
console.log("build tests passed");
