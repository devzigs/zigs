// Key B of P4 (a registered Devnet key), read-only: its full shielded address (public) and its
// shielded balance by a Node sync with the Zolana SDK. The seed is read from its file here and
// goes to redact() at once. Nothing here prints a secret, signs or sends. The key of the app takes
// only calls with the app origin, so the SDK calls to the Helius host get that Origin header.
//   import { addressOfB, balanceOfB } from "./key-b.mjs";
import "./quiet.mjs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { redact } from "../harness/redact.mjs";
import { roleSecretsOfB } from "../mock/roles.mjs";
import { zolanaRepo, heliusFile } from "./paths.mjs";
import { APP_ORIGIN, readText, sleep } from "./rpc.mjs";

const REPO = zolanaRepo();
const HELIUS_HOST = "devnet.helius-rpc.com";

/** fetch with the app Origin on every request to the Helius host. */
const realFetch = globalThis.fetch;
async function appFetch(input, init) {
  const asked = input instanceof Request ? input : null;
  if (new URL(asked ? asked.url : String(input)).hostname !== HELIUS_HOST) {
    return realFetch(input, init);
  }
  const headers = new Headers(init?.headers ?? asked?.headers ?? {});
  headers.set("origin", APP_ORIGIN);
  return realFetch(input, { ...init, headers });
}

const hex = (bytes) => Buffer.from(bytes).toString("hex");

async function keysOfB(sdk) {
  const { seedHex, secrets } = await roleSecretsOfB();
  redact.add(seedHex, ...Object.values(secrets));
  const seed = Uint8Array.from(Buffer.from(seedHex, "hex"));
  const keypair = sdk.ShieldedKeypair.fromKeypair(sdk.SigningKey.fromEd25519Bytes(seed));
  seed.fill(0);
  return keypair;
}

async function loadSdk() {
  const sdk = await import(pathToFileURL(join(REPO, "sdk-libs/ts/dist/index.js")).href);
  await sdk.initializePoseidon();
  return sdk;
}

/** The 99 byte shielded address of B as hex (public). */
export async function addressOfB() {
  const sdk = await loadSdk();
  return hex((await keysOfB(sdk)).shieldedAddress().toBytes());
}

/** One sync of B that reads at least `requireSlot`, and its balance in lamports (a bigint). */
async function syncOnce(sdk, keypair, requireSlot) {
  const url = readText(heliusFile());
  redact.add(url);
  const zolana = new URL(url);
  zolana.pathname = "/v1/zolana";
  globalThis.fetch = appFetch; // the Solana RPC of the SDK uses the global fetch
  const client = await sdk.createZolanaClient({
    solanaRpcUrl: url,
    indexerUrl: zolana.href,
    proverUrl: zolana.href,
  });
  const wallet = new sdk.Wallet({ identity: keypair.shieldedAddress() });
  const keys = sdk.LocalKeys.fromKeypair(keypair, client.proofService);
  const config = requireSlot === undefined ? {} : { config: { requireSlot: BigInt(requireSlot) } };
  await sdk.syncWallet({ client, wallet, keys, ...config });
  return wallet.balance(sdk.SOL_MINT).amount;
}

/**
 * The shielded balance of B in lamports (a bigint), by a sync that reaches `requireSlot`. A sync
 * that the indexer has not caught up with yet is tried again a few times.
 */
export async function balanceOfB(requireSlot) {
  const sdk = await loadSdk();
  const keypair = await keysOfB(sdk);
  let last = null;
  for (let i = 0; i < 8; i += 1) {
    try {
      return await syncOnce(sdk, keypair, requireSlot);
    } catch (err) {
      last = new Error(redact(String(err?.message ?? err)));
      await sleep(4000);
    }
  }
  throw last;
}
