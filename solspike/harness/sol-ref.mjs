// Independent references for the live Solana check (P8c), computed outside the Worker:
// - the shielded address of a set of role secrets, with the SDK dist of the Zolana repo (Node);
// - raw account reads over JSON-RPC (read-only), parsed here with fixed offsets.
// The Helius URL is read from its file inside this module. Nothing here prints it, and every error
// text passes redact() before it is thrown.
import { execFileSync } from "node:child_process";
import "../tools/quiet.mjs";
import { randomBytes, createECDH, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { heliusFile, zolanaRepo } from "../tools/paths.mjs";
import { redact } from "./redact.mjs";

const REPO = zolanaRepo();
const URL_FILE = heliusFile();
const hex = (bytes) => Buffer.from(bytes).toString("hex");

/** Fresh random role secrets and a fresh Ed25519 public key: nothing of any real group. */
export function throwawayRoles() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const { publicKey } = generateKeyPairSync("ed25519");
  return {
    nullifierSecret: randomBytes(31).toString("hex"),
    viewingSecret: ecdh.getPrivateKey().toString("hex").padStart(64, "0"),
    groupKey: publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex"),
  };
}

/** The shielded address and owner (base58) that the SDK dist gives for these secrets. */
export async function referenceAddress(roles) {
  const sdk = await import(pathToFileURL(join(REPO, "sdk-libs/ts/dist/index.js")).href);
  const kit = createRequire(join(REPO, "package.json"))("@solana/kit");
  await sdk.initializePoseidon();
  const unhex = (text) => Uint8Array.from(Buffer.from(text, "hex"));
  const viewing = sdk.ViewingKey.fromBytes(unhex(roles.viewingSecret));
  const nullifier = sdk.NullifierKey.fromSecret(unhex(roles.nullifierSecret));
  const owner = sdk.ShieldedPublicKey.fromEd25519(unhex(roles.groupKey));
  const address = sdk.ShieldedAddress.fromPublicKeys(
    owner,
    nullifier.publicKey(),
    viewing.publicKey(),
  );
  const ownerBase58 = kit.getAddressDecoder().decode(unhex(roles.groupKey));
  return { shielded: hex(address.toBytes()), ownerHash: hex(address.ownerHash()), ownerBase58 };
}

/** The 32 bytes of a base58 address or blockhash, in hex. */
export const hexOfBase58 = (text) =>
  hex(createRequire(join(REPO, "package.json"))("@solana/kit").getAddressEncoder().encode(text));

/** getAccountInfo over JSON-RPC: { owner, lamports, data (Buffer) }. Read-only. */
export async function rawAccount(address) {
  const url = readFileSync(URL_FILE, "utf8").trim();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [address, { encoding: "base64", commitment: "confirmed" }],
      }),
    });
    const { result, error } = await res.json();
    if (error || !result?.value) throw new Error(`no account data (HTTP ${res.status})`);
    const { owner, lamports, data } = result.value;
    return { owner, lamports: BigInt(lamports), data: Buffer.from(data[0], "base64") };
  } catch (err) {
    throw new Error(redact(`raw read of ${address} failed: ${err.message}`));
  }
}

/** The nonce account fields at the fixed offsets of the System program layout. */
export function parseNonce({ data, lamports }) {
  const kit = createRequire(join(REPO, "package.json"))("@solana/kit");
  const decode = (from, to) => kit.getAddressDecoder().decode(data.subarray(from, to));
  return {
    authority: decode(8, 40),
    nonce: decode(40, 72),
    lamports: `${lamports}`,
    size: data.length,
  };
}

/** The fee schedule of a tree account at the offsets of the Rust layout test (8, 16, 24, 32). */
export function parseTreeFees({ data }) {
  const u64 = (at) => `${data.readBigUInt64LE(at)}`;
  return {
    size: data.length,
    discriminator: data[0],
    feePerNullifier: u64(8),
    appendReimbursement: u64(16),
    closeReimbursement: u64(24),
    feeBalance: u64(32),
    // Anchors that are not zero today: the leaf count at 72 and the root history capacity at 116
    // (72 + 44). They show that the bytes are aligned as the layout test says.
    nextIndex: u64(72),
    rootHistoryCapacity: data.readUInt16LE(116),
  };
}

const CLONE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * policy(url) of the base commit (the one in baseline.json), as written then. The live page
 * policy must equal it, except for the host of the WebSocket source: wrangler dev answers with
 * the host of the route, not the one that the browser used.
 */
export function basePagePolicy() {
  const { baseCommit } = JSON.parse(readFileSync(join(CLONE, "solspike/baseline.json"), "utf8"));
  const source = execFileSync("git", ["show", `${baseCommit}:cf/src/index.js`], {
    cwd: CLONE,
    encoding: "utf8",
  });
  const chain = /const CHAIN_SERVERS = [\s\S]*?;\n/.exec(source)?.[0];
  const fn = /function policy\(url\) \{[\s\S]*?\n\}\n/.exec(source)?.[0];
  return runInNewContext(`${chain}\n${fn}\npolicy`, {}, { timeout: 1000 });
}

/** The policy with the host of its ws:// or wss:// source replaced, for a comparison. */
export const withoutSocketHost = (policy) => policy.replace(/wss?:\/\/[^\s;]+/, "ws://HOST");
