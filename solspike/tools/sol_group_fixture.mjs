// Writes web/test/sol-group.json: a 2-of-3 Solana group made by the real ceremony of the page
// (web/test/sol-setup.mjs) and the payments that the TS SDK builds OFFLINE for that group,
// in the layout of wasm-sol/vectors/ts: a sponsor key pays the fee (the fee key of a seat), so the
// SDK writes the change tag inline. `pay` is a payment of the PDA identity of the group (the
// approvals program, ZOLANA.md 7.2) with the SDK values of privateTxHash and messageHash;
// `withdraw` is the same with a withdrawal to the public key 0x66..66 (SOL-32); `migrate` moves the
// whole input of the group key to the PDA address (the one nonce payment of the beta), and
// `migrate2` does the same with another salt.
// The keys are test keys made for this file only. web/test/sol-fixture.mjs puts the group into a
// wallet, and sol-pay.mjs and sol-sessions.mjs run the payments against the fake chain.
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
const { SppProofInputs, createExternalData } = tx;
await sdk.initializePoseidon();

const hex = (b) => Buffer.from(b).toString("hex");
const bytes = (h) => Uint8Array.from(Buffer.from(h, "hex"));
const SOL = "11111111111111111111111111111111";
const INPUT = 5_000_000n;
const SEND = 2_000_000n;
const EXPIRY = 1_800_000_000n; // the expiry of the recorded messageHash; tests write their own
const RECIPIENT = "66".repeat(32); // the public recipient of the withdrawal

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
const pdaRoles = JSON.parse(c.W.sol_pda_roles(solSeed, groupKey));
const group = walletOf(bytes(groupKey), bytes(roles.nullifier_secret), bytes(roles.viewing_sk));
const pda = {
  nullifier: NullifierKey.fromSecret(bytes(pdaRoles.nullifier_secret)),
  viewing: group.viewing,
};
pda.address = ShieldedAddress.forPda({
  pda: bytes(pdaRoles.pda),
  nullifierPublicKey: pda.nullifier.publicKey(),
  viewingPublicKey: group.viewing.publicKey(),
});
if (hex(pda.address.toBytes()) !== pdaRoles.address) throw new Error("the PDA address differs");
const payeeSigner = new Uint8Array(32).fill(0x43);
const payee = walletOf(payeeSigner, new Uint8Array(31).fill(0x43), new Uint8Array(32).fill(0x05));
const sponsor = base58("44".repeat(32));
const signerOf = (address) => hex(address.signingPublicKey.toBytes());
const tagOf = (tag) =>
  tag.kind === "account"
    ? { kind: "account", index: tag.index }
    : { kind: "inline", value: hex(tag.value) };

/**
 * One payment of `owner` ({ address, nullifier, viewing }, its UTXO owned by `ownerKey`) to `to`:
 * a ShieldedAddress, or { withdrawTo } for a withdrawal to a public account (a base58 address).
 */
function payment(owner, ownerKey, to, send, saltByte) {
  const blinding = new Uint8Array(32).fill(0x07);
  const utxo = new Utxo({ owner: ownerKey, asset: SOL, amount: INPUT, blinding });
  const input = ProofInputUtxo.fromNullifierKey(utxo, owner.nullifier);
  const transfer = new ConfidentialTransfer(owner.address, [input], sponsor);
  if (to.withdrawTo) transfer.withdraw(SOL, send, { kind: "sol", recipient: to.withdrawTo });
  else transfer.send(to, SOL, send);
  const prepared = transfer.prepare();
  const txKey = owner.viewing.transactionViewingKey(prepared.firstNullifier);
  const salt = Uint8Array.from({ length: 16 }, (_, i) => saltByte + i);
  const open = prepared.finalize({
    txViewingPublicKey: txKey.publicKey(),
    salt,
    payload: encodeConfidentialSlots(prepared.outputs, new AssetRegistry([]), txKey, salt),
  });
  const proofInputs = new SppProofInputs({
    payer: open.payer,
    inputUtxos: open.inputUtxos,
    outputs: open.outputs,
    externalData: createExternalData({ ...open.externalData, expiryUnixTs: EXPIRY }),
    blindingSeed: open.blindingSeed,
    outputTreeId: open.outputTreeId,
  });
  const own = signerOf(owner.address);
  const outputs = proofInputs.outputs.map((out, i) => {
    const published = proofInputs.externalData.outputs[i];
    let role = "dummy";
    if (!out.isDummy()) role = signerOf(out.ownerAddress) === own ? "change" : "payee";
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
  const result = {
    salt: hex(salt),
    blindingSeed: hex(proofInputs.blindingSeed),
    txViewingPk: hex(txKey.publicKey().toBytes()),
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
    privateTxHash: hex(proofInputs.privateTxHash()),
    messageHash: hex(proofInputs.messageHash()),
    expiry: EXPIRY.toString(),
  };
  if (to.withdrawTo) result.withdraw = { recipient: RECIPIENT, amount: send.toString() };
  txKey.destroy();
  return result;
}

const pdaKey = ShieldedPublicKey.fromPda(bytes(pdaRoles.pda));
const pay = payment(pda, pdaKey, payee.address, SEND, 0xb0);
const withdraw = payment(pda, pdaKey, { withdrawTo: base58(RECIPIENT) }, SEND, 0xc0);
const groupKeyOwner = ShieldedPublicKey.fromEd25519(group.signer);
const migrate = payment(group, groupKeyOwner, pda.address, INPUT, 0xd0);
// A second move of the same input with another salt: two proposals on one nonce (sol-limits.mjs).
const migrate2 = payment(group, groupKeyOwner, pda.address, INPUT, 0xe0);
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
    pda: pdaRoles.pda,
    pdaNullifierSecret: pdaRoles.nullifier_secret,
    pdaNullifierPk: pdaRoles.nullifier_pk,
    pdaOwnerHash: hex(pda.address.ownerHash()),
    pdaAddress: pdaRoles.address,
  },
  payee: {
    address: hex(payee.address.toBytes()),
    key: hex(payeeSigner),
    ownerHash: hex(payee.address.ownerHash()),
  },
  pay,
  withdraw,
  migrate,
  migrate2,
};
const out = new URL("../../web/test/sol-group.json", import.meta.url);
writeFileSync(out, JSON.stringify(fixture, null, 1) + "\n");
const roleText = (p) => p.outputs.map((o) => o.role + ":" + o.amount).join(" ");
console.log("wrote", out.pathname, "pay", roleText(pay), "migrate", roleText(migrate));
process.exit(0);
