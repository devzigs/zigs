// Writes wasm-sol/vectors/roles.json: the public values that the TS SDK gives for the role
// secrets of a throwaway seed (ZOLANA.md 4.2). tests/roles.rs compares the Rust values with them.
//
//   node solspike/tools/role_vectors.mjs <Zolana repo> [out file]
//
// The seed and the group key are test values written in this file. The two role secrets are
// derived here in JavaScript, independent of the Rust code (HKDF-SHA256 of node:crypto, empty
// salt, the info strings of the Zigs labels, and a reduction modulo the P-256 order with BigInt).
// The public keys, the owner hash and the address come from the SDK of the Zolana repo
// (`NullifierKey.fromSecret`, `ViewingKey.fromBytes`, `ShieldedAddress`), not from Rust.
// The PDA identity of each seed (ZOLANA.md 7.2) too: the PDA from `getProgramDerivedAddress` of
// @solana/kit, its nullifier secret from node:crypto, its address from `ShieldedAddress.forPda`.
import { createHash, createPrivateKey, createPublicKey, hkdfSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zolanaRepo } from "./paths.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(process.argv[2] ?? zolanaRepo());
const out = process.argv[3] ?? path.join(here, "../../wasm-sol/vectors/roles.json");
const sdk = await import(`${repo}/sdk-libs/ts/dist/index.js`);
const kit = await import(`${repo}/node_modules/@solana/kit/dist/index.node.mjs`);
const { NullifierKey, ShieldedAddress, ShieldedPublicKey, ViewingKey } = sdk;
await sdk.initializePoseidon();

const P256_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const INFO_NULLIFIER = "zigs-sol/nullifier-secret/v1";
const INFO_VIEWING = "zigs-sol/viewing-scalar/v1";
const INFO_PDA_NULLIFIER = "zigs-sol/pda-nullifier-secret/v1";
const PROGRAM = "5PHZEHBMaYbFL9SFmMyP8kUayh3TFEyq2dvEYY3UGjkL";
const hex = (bytes) => Buffer.from(bytes).toString("hex");

const expand = (seed, info, length) =>
  Buffer.from(hkdfSync("sha256", seed, Buffer.alloc(0), info, length));

function viewingScalar(seed) {
  const okm = expand(seed, INFO_VIEWING, 48);
  const scalar = BigInt(`0x${hex(okm)}`) % P256_ORDER;
  return Buffer.from(scalar.toString(16).padStart(64, "0"), "hex");
}

function ed25519Public(seedByte) {
  const der = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.alloc(32, seedByte),
  ]);
  const key = createPublicKey(createPrivateKey({ key: der, format: "der", type: "pkcs8" }));
  return Uint8Array.from(key.export({ format: "der", type: "spki" }).subarray(-32));
}

async function pdaOf(seed, group, viewing) {
  const [pda] = await kit.getProgramDerivedAddress({
    programAddress: kit.address(PROGRAM),
    seeds: [Buffer.from("multisig"), group],
  });
  const pdaBytes = Uint8Array.from(kit.getAddressEncoder().encode(pda));
  const info = Buffer.concat([Buffer.from(INFO_PDA_NULLIFIER), pdaBytes]);
  const secret = expand(seed, info, 31);
  const nullifier = NullifierKey.fromSecret(Uint8Array.from(secret));
  const address = ShieldedAddress.forPda({
    pda: pdaBytes,
    nullifierPublicKey: nullifier.publicKey(),
    viewingPublicKey: viewing.publicKey(),
  });
  return {
    pda: hex(pdaBytes),
    pdaNullifierSecret: hex(secret),
    pdaNullifierPk: hex(address.nullifierPublicKey),
    pdaOwnerHash: hex(address.ownerHash()),
    pdaAddress: hex(address.toBytes()),
  };
}

async function vector(name, seed, groupByte) {
  const group = ed25519Public(groupByte);
  const nullifierSecret = expand(seed, INFO_NULLIFIER, 31);
  const viewingSk = viewingScalar(seed);
  const nullifier = NullifierKey.fromSecret(Uint8Array.from(nullifierSecret));
  const viewing = ViewingKey.fromBytes(Uint8Array.from(viewingSk));
  const address = ShieldedAddress.fromPublicKeys(
    ShieldedPublicKey.fromEd25519(group),
    nullifier.publicKey(),
    viewing.publicKey(),
  );
  return {
    name,
    solSeed: hex(seed),
    groupKey: hex(group),
    nullifierSecret: hex(nullifierSecret),
    viewingSk: hex(viewingSk),
    nullifierPk: hex(address.nullifierPublicKey),
    viewingPk: hex(address.viewingPublicKey.toBytes()),
    ownerHash: hex(address.ownerHash()),
    address: hex(address.toBytes()),
    ...(await pdaOf(seed, group, viewing)),
  };
}

const seedOf = (label) => createHash("sha256").update(`zigs-sol role vectors: ${label}`).digest();
const vectors = [
  await vector("seed-a", seedOf("a"), 0x42),
  await vector("seed-b", seedOf("b"), 0x43),
  await vector("seed-zero", Buffer.alloc(32), 0x44),
  await vector("seed-ff", Buffer.alloc(32, 0xff), 0x45),
];
writeFileSync(out, `${JSON.stringify({ vectors }, null, 1)}\n`);
console.log(`${vectors.length} role vectors written`);
