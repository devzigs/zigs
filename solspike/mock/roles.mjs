// The role secrets of key B (the P4 test key, 0.035 SOL private on Devnet), derived in memory.
// The mock replay is the recorded sync of B, so the Worker needs B's nullifier secret, viewing
// scalar and Ed25519 public key. Nothing here is printed or written. The caller adds the values
// to the redactor. The SDK dist and kit come from the read-only Zolana repo.
import "../tools/quiet.mjs";
import { keyBFile, zolanaRepo } from "../tools/paths.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = zolanaRepo();
const hex = (bytes) => Buffer.from(bytes).toString("hex");

const sha = (text) => createHash("sha256").update(text).digest();

/**
 * { nullifierSecret, viewingSecret, groupKey, pda, pdaNullifierSecret, seedHex } in hex, and the
 * SDK owner hash. The replay holds no note of a PDA, so the PDA identity is a fixed test value.
 */
export async function roleSecretsOfB() {
  const sdk = await import(pathToFileURL(join(REPO, "sdk-libs/ts/dist/index.js")).href);
  const kit = createRequire(join(REPO, "package.json"))("@solana/kit");
  const seedHex = JSON.parse(readFileSync(keyBFile(), "utf8")).seedHex;
  const seed = Uint8Array.from(Buffer.from(seedHex, "hex"));
  await sdk.initializePoseidon();
  const keypair = sdk.ShieldedKeypair.fromKeypair(sdk.SigningKey.fromEd25519Bytes(seed));
  const signer = await kit.createKeyPairSignerFromPrivateKeyBytes(seed);
  const secrets = {
    nullifierSecret: hex(keypair.nullifierKey().secretBytes()),
    viewingSecret: hex(keypair.viewingKey().secretBytes()),
    groupKey: hex(kit.getAddressEncoder().encode(signer.address)),
    pda: hex(sha("zigs mock pda")),
    pdaNullifierSecret: hex(sha("zigs mock pda nullifier").subarray(0, 31)),
  };
  seed.fill(0);
  return { secrets, seedHex, ownerHash: hex(keypair.shieldedAddress().ownerHash()) };
}
