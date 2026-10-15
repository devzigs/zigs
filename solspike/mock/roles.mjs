// The role secrets of key B (the P4 test key, 0.035 SOL private on Devnet), derived in memory.
// The mock replay is the recorded sync of B, so the Worker needs B's nullifier secret, viewing
// scalar and Ed25519 public key. Nothing here is printed or written. The caller adds the values
// to the redactor. The SDK dist and kit come from the read-only Zolana repo.
import "../tools/quiet.mjs";
import { keyBFile, zolanaRepo } from "../tools/paths.mjs";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = zolanaRepo();
const hex = (bytes) => Buffer.from(bytes).toString("hex");

/** { nullifierSecret, viewingSecret, groupKey, seedHex } in hex, and the SDK owner hash. */
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
  };
  seed.fill(0);
  return { secrets, seedHex, ownerHash: hex(keypair.shieldedAddress().ownerHash()) };
}
