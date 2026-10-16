// Writes wasm-sol/vectors/pay/*.json: private payments of a PDA identity (ZOLANA.md 7.2) that the
// TS SDK builds offline, in the layout of wasm-sol/vectors/ts, with the values that the program
// design needs from the SDK: `privateTxHash` and `messageHash` (the commitment of the approval).
// tests/pay_vectors.rs checks the Rust recompute of both against them.
//
//   node solspike/tools/payment_vectors.mjs <Zolana repo> [out dir]
//
// The seeds and keys are test values written in this file. The PDA is the one of the approvals
// program (getProgramDerivedAddress of @solana/kit), and its nullifier secret is option D, derived
// here with node:crypto. No network and no key of a Devnet account.
import { createHash, createPrivateKey, createPublicKey, hkdfSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zolanaRepo } from "./paths.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(process.argv[2] ?? zolanaRepo());
const out = process.argv[3] ?? path.join(here, "../../wasm-sol/vectors/pay");
const sdk = await import(`${repo}/sdk-libs/ts/dist/index.js`);
const tx = await import(`${repo}/sdk-libs/ts/dist/transaction/index.js`);
const kit = await import(`${repo}/node_modules/@solana/kit/dist/index.node.mjs`);
const { NullifierKey, ShieldedAddress, ShieldedPublicKey, ViewingKey } = sdk;
const { AssetRegistry, ConfidentialTransfer, ProofInputUtxo, SppProofInputs, Utxo } = tx;
const { createExternalData, encodeConfidentialSlots } = tx;
await sdk.initializePoseidon();

const PROGRAM = "5PHZEHBMaYbFL9SFmMyP8kUayh3TFEyq2dvEYY3UGjkL";
const SOL = "11111111111111111111111111111111";
const EXPIRY = 1_800_000_000n; // tests/common/mod.rs EXPIRY
const P256_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const expand = (seed, info, length) =>
  Buffer.from(hkdfSync("sha256", seed, Buffer.alloc(0), info, length));

function ed25519Public(seedByte) {
  const der = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.alloc(32, seedByte),
  ]);
  const key = createPublicKey(createPrivateKey({ key: der, format: "der", type: "pkcs8" }));
  return Uint8Array.from(key.export({ format: "der", type: "spki" }).subarray(-32));
}

function viewingScalar(seed) {
  const okm = expand(seed, "zigs-sol/viewing-scalar/v1", 48);
  const scalar = BigInt(`0x${hex(okm)}`) % P256_ORDER;
  return Buffer.from(scalar.toString(16).padStart(64, "0"), "hex");
}

/** The PDA identity of a seed under a group key: the owner of the program design. */
async function pdaIdentity(seed, group) {
  const [pda] = await kit.getProgramDerivedAddress({
    programAddress: kit.address(PROGRAM),
    seeds: [Buffer.from("multisig"), group],
  });
  const key = Uint8Array.from(kit.getAddressEncoder().encode(pda));
  const info = Buffer.concat([Buffer.from("zigs-sol/pda-nullifier-secret/v1"), key]);
  const secret = Uint8Array.from(expand(seed, info, 31));
  const viewingSk = Uint8Array.from(viewingScalar(seed));
  const nullifier = NullifierKey.fromSecret(secret);
  const viewing = ViewingKey.fromBytes(viewingSk);
  const address = ShieldedAddress.forPda({
    pda: key,
    nullifierPublicKey: nullifier.publicKey(),
    viewingPublicKey: viewing.publicKey(),
  });
  return { key, secret, viewingSk, nullifier, viewing, address };
}

function payeeOf(byte) {
  const nullifier = NullifierKey.fromSecret(new Uint8Array(31).fill(byte));
  const viewing = ViewingKey.fromBytes(new Uint8Array(32).fill(0).fill(byte, 31));
  const signer = ed25519Public(byte);
  const address = ShieldedAddress.fromPublicKeys(
    ShieldedPublicKey.fromEd25519(signer),
    nullifier.publicKey(),
    viewing.publicKey(),
  );
  return { signer, address };
}

const tagOf = (tag) =>
  tag.kind === "account"
    ? { kind: "account", index: tag.index }
    : { kind: "inline", value: hex(tag.value) };

/** One payment: `amounts` of the inputs, `send` to the payee, `salt` byte. */
async function vector(name, { seedLabel, groupByte, amounts, send, saltByte }) {
  const seed = createHash("sha256").update(`zigs-sol pay vectors: ${seedLabel}`).digest();
  const group = ed25519Public(groupByte);
  const owner = await pdaIdentity(seed, group);
  const payee = payeeOf(0x43);
  const sponsor = kit.getAddressDecoder().decode(ed25519Public(0x51));
  const inputs = amounts.map((amount, i) => {
    const blinding = new Uint8Array(32).fill(0x10 + i);
    const utxo = new Utxo({
      owner: ShieldedPublicKey.fromPda(owner.key),
      asset: SOL,
      amount,
      blinding,
    });
    return ProofInputUtxo.fromNullifierKey(utxo, owner.nullifier);
  });
  const transfer = new ConfidentialTransfer(owner.address, inputs, sponsor);
  transfer.send(payee.address, SOL, send);
  const prepared = transfer.prepare();
  const txKey = owner.viewing.transactionViewingKey(prepared.firstNullifier);
  const salt = new Uint8Array(16).fill(saltByte);
  const open = prepared.finalize({
    txViewingPublicKey: txKey.publicKey(),
    salt,
    payload: encodeConfidentialSlots(prepared.outputs, new AssetRegistry([]), txKey, salt),
  });
  const proof = new SppProofInputs({
    payer: open.payer,
    inputUtxos: open.inputUtxos,
    outputs: open.outputs,
    externalData: createExternalData({ ...open.externalData, expiryUnixTs: EXPIRY }),
    blindingSeed: open.blindingSeed,
    outputTreeId: open.outputTreeId,
  });
  const ownSigner = hex(owner.address.signingPublicKey.toBytes());
  const outputs = proof.outputs.map((o, i) => {
    const published = proof.externalData.outputs[i];
    let role = "dummy";
    if (!o.isDummy()) {
      role = hex(o.ownerAddress.signingPublicKey.toBytes()) === ownSigner ? "change" : "payee";
    }
    return {
      role,
      mint: o.asset,
      amount: o.amount.toString(),
      blinding: hex(o.blinding),
      utxoHash: hex(published.utxoHash),
      ownerTag: tagOf(published.ownerTag),
      data: hex(published.data),
    };
  });
  const result = {
    name,
    groupKey: hex(group),
    group: {
      key: hex(owner.key),
      payer: hex(kit.getAddressEncoder().encode(sponsor)),
      nullifierSecret: hex(owner.secret),
      viewingSk: hex(owner.viewingSk),
      nullifierPk: hex(owner.address.nullifierPublicKey),
      viewingPk: hex(owner.address.viewingPublicKey.toBytes()),
      ownerHash: hex(owner.address.ownerHash()),
    },
    payee: { address: hex(payee.address.toBytes()), key: hex(payee.signer) },
    salt: hex(salt),
    blindingSeed: hex(proof.blindingSeed),
    txViewingPk: hex(txKey.publicKey().toBytes()),
    expiry: EXPIRY.toString(),
    inputs: inputs.map((input, i) => ({
      mint: SOL,
      amount: amounts[i].toString(),
      blinding: hex(input.utxo.blinding),
      utxoHash: hex(input.hash()),
      nullifier: hex(input.nullifier()),
    })),
    withdraw: null,
    outputs,
    privateTxHash: hex(proof.privateTxHash()),
    externalDataHash: hex(proof.externalData.hash()),
    messageHash: hex(proof.messageHash()),
  };
  txKey.destroy();
  return result;
}

const cases = [
  ["pay-change", { seedLabel: "a", groupByte: 0x61, amounts: [5_000_000n], send: 2_000_000n }],
  ["pay-all", { seedLabel: "b", groupByte: 0x62, amounts: [3_000_000n], send: 3_000_000n }],
  [
    "pay-two-inputs",
    { seedLabel: "c", groupByte: 0x63, amounts: [4_000_000n, 1_000_000n], send: 4_500_000n },
  ],
];
mkdirSync(out, { recursive: true });
let saltByte = 0xc0;
for (const [name, spec] of cases) {
  const v = await vector(name, { ...spec, saltByte: saltByte++ });
  writeFileSync(path.join(out, `${name}.json`), `${JSON.stringify(v, null, 1)}\n`);
  console.log(name, v.outputs.map((o) => `${o.role}:${o.amount}`).join(" "));
}
process.exit(0);
