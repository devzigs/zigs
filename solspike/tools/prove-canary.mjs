// The prove canary (S20): one real proof of key B at the Helius gateway, then a simulation of the
// signed transaction on the live pool, with the signature checked. It never lands anything: no
// call of this file can submit a transaction, and web/test/demo-check.mjs checks its source. Key B
// is a test key, so its witness may go to the hosted prover. The empty body of demo-check cannot
// see a new proving key, a new request schema or a gateway that refuses a real witness; this can.
// One sync proof at low load does not reach the 429 or async path of the SDK.
//   ZOLANA_REPO=<pinned checkout> SOLSPIKE_KEY_B=<key file> node solspike/tools/prove-canary.mjs
// ZOLANA_REPO gives kit and the v1 compiler of the SDK; HELIUS_URL_FILE moves the Helius URL file.
// Each step prints PASS or FAIL. The exit code is 0 on PASS, 1 on a FAIL and 2 on a bad setup.
import "./quiet.mjs";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { redact } from "../harness/redact.mjs";
import { heliusFile, keyBFile, zolanaRepo } from "./paths.mjs";
import { APP_ORIGIN, readText, rpcCall, sleep } from "./rpc.mjs";

const WEB_SOL = new URL("../../web/sol/", import.meta.url);
const COMPUTE_UNITS = 217_000; // the cap of the P3 template, as in worker.js
const AMOUNT = 1000n; // lamports, as the run of ZOLANA.md 6.10 (SDK move)
const BASELINE_UNITS = 138_355; // the same run: the pool transact of key B
const EXPIRY_S = 3600;
const SYNC_TRIES = 8;

/** The bundle gets its wasm from disk, Helius gets the app Origin, and no other host is reached. */
function heliusFetch(host) {
  const realFetch = globalThis.fetch;
  return async (input, init) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    if (target.protocol === "file:") {
      const wasm = { headers: { "content-type": "application/wasm" } };
      return new Response(readFileSync(fileURLToPath(target)), wasm);
    }
    if (target.host !== host) throw new Error(`blocked a request to ${target.host}`);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}));
    headers.set("origin", APP_ORIGIN);
    return realFetch(input, { ...init, headers });
  };
}

/** Key B as the bundle and kit see it. The seed goes to the redactor at once. */
async function keysOfB(sdk, kit) {
  const { seedHex } = JSON.parse(readFileSync(keyBFile(), "utf8"));
  redact.add(seedHex);
  const seed = Uint8Array.from(Buffer.from(seedHex, "hex"));
  try {
    const keypair = sdk.ShieldedKeypair.fromKeypair(sdk.SigningKey.fromEd25519Bytes(seed));
    const signer = await kit.createKeyPairSignerFromPrivateKeyBytes(seed);
    const owner = keypair.shieldedAddress().solanaAddress();
    if (signer.address !== owner) throw new Error("the kit signer of key B is not its owner");
    return { keypair, signer, owner };
  } finally {
    seed.fill(0);
  }
}

/** The pieces of a live run: the shipped bundle, web/sol/transfer.js, kit, and an SDK client. */
async function setup() {
  const repo = zolanaRepo();
  const url = readText(heliusFile());
  const { host, search, searchParams } = new URL(url);
  redact.add(url, search, searchParams.get("api-key"));
  // The Solana RPC of the SDK takes the global fetch, so the global fetch is the guarded one.
  globalThis.fetch = heliusFetch(host);
  const sdk = await import(new URL("zolana.bundle.js", WEB_SOL).href);
  const transfer = await import(new URL("transfer.js", WEB_SOL).href);
  // Kit signs only in a secure context (its error 3610000), and Node marks none.
  globalThis.isSecureContext = true;
  const kit = createRequire(join(repo, "package.json"))("@solana/kit");
  const compile = await import(pathToFileURL(join(repo, "sdk-libs/ts/dist/flows/compile.js")).href);
  await sdk.initializePoseidon();
  const gateway = new URL(url);
  gateway.pathname = "/v1/zolana";
  const client = await sdk.createZolanaClient({
    solanaRpcUrl: url,
    indexerUrl: gateway.href,
    proverUrl: gateway.href,
    proverTee: false,
    fetch: globalThis.fetch,
    computeUnitLimit: COMPUTE_UNITS,
  });
  return { sdk, transfer, kit, compile, client, ...(await keysOfB(sdk, kit)) };
}

/** A sync of key B. A sync that the indexer refuses or has not caught up with is tried again. */
async function syncedWallet({ sdk, client, keypair }) {
  let last = null;
  for (let i = 0; i < SYNC_TRIES; i += 1) {
    const wallet = new sdk.Wallet({ identity: keypair.shieldedAddress() });
    const keys = sdk.LocalKeys.fromKeypair(keypair, client.proofService);
    try {
      await sdk.syncWallet({ client, wallet, keys });
      return { wallet, keys };
    } catch (err) {
      last = err;
      await sleep(4000);
    }
  }
  throw last;
}

async function sync(w) {
  const { wallet, keys } = await syncedWallet(w);
  const held = w.transfer.spendableSum(w.sdk, wallet, w.client.tree);
  if (held < AMOUNT) {
    throw new Error(`key B holds ${held} lamports in plain SOL notes of tree 0, not ${AMOUNT}: ` +
      "fund it with Add SOL (a write: ask the owner)");
  }
  const reply = await rpcCall("getBalance", [w.owner, { commitment: "confirmed" }]);
  const text = `key B holds ${held} lamports to spend in tree 0 and ${reply.value} public`;
  return { wallet, keys, text };
}

function build(w, s) {
  const address = w.keypair.shieldedAddress();
  // Key B is no group and pays its own fee: its identity names no owner that may not pay.
  const identity = { address, viewing: w.keypair.viewingKey() };
  const expiry = BigInt(Math.floor(Date.now() / 1000) + EXPIRY_S);
  const request = { recipient: address, amount: AMOUNT, expiry, payer: w.owner };
  const { proofInputs, tree } = w.transfer.buildProofInputs(w.sdk, w.client, identity, s.wallet,
    request);
  const notes = proofInputs.inputUtxos.filter((input) => !input.isDummy()).length;
  const text = `a self-payment of ${AMOUNT} lamports from ${notes} note(s), expiry in 1 h`;
  return { proofInputs, tree, text };
}

async function prove(w, s) {
  const started = performance.now();
  // The SDK compares the proving key that the gateway reports with its own pin (proof.ts).
  const data = await w.client.proveTransact(s.proofInputs, s.keys);
  const seconds = ((performance.now() - started) / 1000).toFixed(2);
  return { data, text: `the gateway proved it in ${seconds} s (0.77 s in ZOLANA.md 6.10)` };
}

const plain = (_key, value) => (typeof value === "bigint" ? `${value}` : value);

async function simulate(w, s) {
  const { owner } = w;
  const call = { payer: owner, ownerSigners: [], inputTree: s.tree, outputTree: w.client.tree };
  const ix = await w.sdk.transactInstruction({ ...call, data: s.data });
  const { value } = await rpcCall("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const lifetime = { ...value, lastValidBlockHeight: BigInt(value.lastValidBlockHeight) };
  const instructions = [ix];
  const message = { feePayer: owner, lifetime, computeUnitLimit: COMPUTE_UNITS, instructions };
  const unsigned = w.compile.compileUnsignedTransaction(message);
  const signed = await w.kit.signTransactionWithSigners([w.signer], unsigned);
  const wire = w.kit.getBase64EncodedWireTransaction(signed);
  const options = { encoding: "base64", sigVerify: true, commitment: "confirmed" };
  const result = (await rpcCall("simulateTransaction", [wire, options])).value;
  const units = Number(result.unitsConsumed ?? 0);
  if (result.err !== null) {
    const logs = (result.logs ?? []).slice(-3).join(" | ");
    const err = JSON.stringify(result.err, plain);
    throw new Error(`the pool refused it: ${err}, ${units} units; ${logs}`);
  }
  const drift = `${units - BASELINE_UNITS >= 0 ? "+" : ""}${units - BASELINE_UNITS}`;
  return {
    text: `no error, ${units} compute units, pool transact only (an execute adds about 11k for ` +
      `the CPI, ZOLANA.md 6.10 SOL-35); ${drift} from ${BASELINE_UNITS} on 16 October`,
  };
}

export const STEPS = { sync, build, prove, simulate };

/** The SDK code, the text and the details of an error. SDK details hold no secret by design. */
export function failureText(err) {
  const message = String(err?.message ?? err);
  const code = typeof err?.code === "string" && err.code !== message ? `${err.code}: ` : "";
  const details = err?.details ? ` ${JSON.stringify(err.details, plain)}` : "";
  return redact(`${code}${message}${details}`);
}

/** Runs the steps in order, one line each, and stops at the first FAIL. Returns 0 or 1. */
export async function runCanary(steps, world, print = console.log) {
  let state = {};
  for (const name of Object.keys(STEPS)) {
    try {
      const { text, ...more } = await steps[name](world, state);
      state = { ...state, ...more };
      print(redact(`PASS  ${name}: ${text}`));
    } catch (err) {
      print(`FAIL  ${name}: ${failureText(err)}`);
      print("prove-canary: FAIL");
      return 1;
    }
  }
  print("prove-canary: PASS");
  return 0;
}

async function main() {
  let world = null;
  try {
    world = await setup();
  } catch (err) {
    console.error(`prove-canary: ${failureText(err)}`);
    return 2;
  }
  return runCanary(STEPS, world);
}

// True when node runs this file, also through a symlink (the rule of solspike/smoke.mjs).
const isMain = () => {
  try {
    const real = realpathSync.native;
    return real(process.argv[1]) === real(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (isMain()) process.exitCode = await main();
