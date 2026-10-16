// Writes web/test/sol-group.json: a 2-of-3 Solana group made by the real ceremony of the page
// (web/test/sol-setup.mjs) and one private payment that the TS SDK builds OFFLINE for that group,
// in the layout of wasm-sol/vectors/ts: a sponsor key pays the fee (the fee key of a seat), so the
// SDK writes the change tag inline. The keys are test keys made for this file only. sol-pay.mjs
// puts the group into its wallet and runs the payment through propose, approve, share, aggregate
// and send against the fake chain.
//
//   ZOLANA_SDK=<zolana repo>/sdk-libs/ts/dist node solspike/tools/sol_group_fixture.mjs
//
// The SDK is the pinned Zolana commit of ZOLANA.md (PIN in solspike/build.mjs). No
// network, no RPC, no Devnet key.
import { writeFileSync } from "node:fs";
import { c, solOf } from "../../web/test/sol-setup.mjs";
import { base58 } from "../../web/sol/docs.js";

const dist = process.env.ZOLANA_SDK;
if (!dist) throw new Error("set ZOLANA_SDK to the dist folder of the Zolana TS SDK");
const sdk = await import(`${dist}/index.js`);
const tx = await import(`${dist}/transaction/index.js`);
const { AssetRegistry, ConfidentialTransfer, ProofInputUtxo, Utxo, encodeConfidentialSlots } = tx;
const { NullifierKey, ShieldedAddress, ShieldedPublicKey, ViewingKey } = sdk;
await sdk.initializePoseidon();

const hex = (b) => Buffer.from(b).toString("hex");
const bytes = (h) => Uint8Array.from(Buffer.from(h, "hex"));
const SOL = "11111111111111111111111111111111";
const SALT = Uint8Array.from({ length: 16 }, (_, i) => 0xb0 + i);
const INPUT = 5_000_000n;
const SEND = 2_000_000n;

function walletOf(signer, nullifierSecret, viewingSk) {
  const nullifier = NullifierKey.fromSecret(nullifierSecret);
  const viewing = ViewingKey.fromBytes(viewingSk);
  const address = ShieldedAddress.fromPublicKeys(
    ShieldedPublicKey.fromEd25519(signer),
    nullifier.publicKey(),
    viewing.publicKey(),
  );
  return { signer, nullifierSecret, viewingSk, nullifier, viewing, address };
}

const seats = [1, 2, 3].map((i) => solOf(i));
if (new Set(seats.map((s) => s.solSeed)).size !== 1) throw new Error("the seats differ in solSeed");
const { solSeed, groupKey } = seats[0];
const roles = JSON.parse(c.W.sol_roles(solSeed, groupKey));
const group = walletOf(bytes(groupKey), bytes(roles.nullifier_secret), bytes(roles.viewing_sk));
const payeeSigner = new Uint8Array(32).fill(0x43);
const payee = walletOf(payeeSigner, new Uint8Array(31).fill(0x43), new Uint8Array(32).fill(0x05));

const blinding = new Uint8Array(32).fill(0x07);
const utxo = new Utxo({
  owner: ShieldedPublicKey.fromEd25519(group.signer),
  asset: SOL,
  amount: INPUT,
  blinding,
});
const input = ProofInputUtxo.fromNullifierKey(utxo, group.nullifier);
const sponsor = base58("44".repeat(32));
const transfer = new ConfidentialTransfer(group.address, [input], sponsor);
transfer.send(payee.address, SOL, SEND);
const prepared = transfer.prepare();
const txKey = group.viewing.transactionViewingKey(prepared.firstNullifier);
const proofInputs = prepared.finalize({
  txViewingPublicKey: txKey.publicKey(),
  salt: SALT,
  payload: encodeConfidentialSlots(prepared.outputs, new AssetRegistry([]), txKey, SALT),
});
const signerOf = (address) => hex(address.signingPublicKey.toBytes());
const tagOf = (tag) =>
  tag.kind === "account"
    ? { kind: "account", index: tag.index }
    : { kind: "inline", value: hex(tag.value) };
const outputs = proofInputs.outputs.map((out, i) => {
  const published = proofInputs.externalData.outputs[i];
  let role = "dummy";
  const own = signerOf(out.ownerAddress) === signerOf(group.address);
  if (!out.isDummy()) role = own ? "change" : "payee";
  return {
    role,
    mint: out.asset,
    amount: out.amount.toString(),
    blinding: hex(out.blinding),
    utxoHash: hex(published.utxoHash),
    ownerTag: tagOf(published.ownerTag),
    data: hex(published.data),
  };
});
const txViewingPk = hex(txKey.publicKey().toBytes());
txKey.destroy();

const fixture = {
  note: "Test keys made by solspike/tools/sol_group_fixture.mjs. Never fund them.",
  solSeed,
  seats: Object.fromEntries(
    seats.map(({ keyPackage, publicKeyPackage }, i) => [i + 1, { keyPackage, publicKeyPackage }]),
  ),
  group: {
    key: groupKey,
    nullifierSecret: roles.nullifier_secret,
    viewingSk: roles.viewing_sk,
    nullifierPk: roles.nullifier_pk,
    viewingPk: roles.viewing_pk,
    ownerHash: hex(group.address.ownerHash()),
    address: roles.address,
  },
  payee: {
    address: hex(payee.address.toBytes()),
    key: hex(payeeSigner),
    ownerHash: hex(payee.address.ownerHash()),
  },
  salt: hex(SALT),
  blindingSeed: hex(prepared.blindingSeed),
  txViewingPk,
  inputs: [
    {
      mint: SOL,
      amount: INPUT.toString(),
      blinding: hex(blinding),
      utxoHash: hex(input.hash()),
      nullifier: hex(input.nullifier()),
    },
  ],
  outputs,
};
const out = new URL("../../web/test/sol-group.json", import.meta.url);
writeFileSync(out, JSON.stringify(fixture, null, 1) + "\n");
console.log("wrote", out.pathname, outputs.map((o) => o.role + ":" + o.amount).join(" "));
process.exit(0);
