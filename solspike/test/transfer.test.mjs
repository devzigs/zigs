// Tests of web/sol/transfer.js with the real SDK (the shipped bundle).
// Usage: node solspike/test/transfer.test.mjs
// The Worker builds the proof inputs of a transfer from public pieces of the SDK and binds the
// expiry itself, because finalize() of the SDK fixes it at u64::MAX. Offline: no prover, no RPC.
//   1. finalize() binds u64::MAX (the control), and buildProofInputs binds the expiry.
//   2. The hash of the external data follows the expiry.
//   3. Selection: largest first, SOL, plain, unspent, in the tree of the client, enough to cover.
//   4. The payment and the change reach the right owners.
//   5. The fee payer is not the owner: the proof binds both, the group is the owner signer, and
//      the change tag is inline (the sponsor mode of the SDK, which the fee key of a seat uses).
//   6. A payment of the PDA identity (ZOLANA.md 7.2), rebuilt from its plan and its first proof
//      for another payer, has the commitment of the first proof; another plan has another one.
import "../tools/quiet.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WEB_SOL = new URL("../../web/sol/", import.meta.url);
const U64_MAX = 0xffff_ffff_ffff_ffffn;
const TREE = "11111111111111111111111111111113";
const PAYER = "11111111111111111111111111111112";
const EXPIRY = 1_900_000_000n;
const step = (name) => console.log(`ok  ${name}`);

// Node cannot fetch a file: URL, which the hasher uses for its wasm file. Read it from disk.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const href = String(input instanceof Request ? input.url : input);
  if (!href.startsWith("file:")) return realFetch(input, init);
  const body = readFileSync(fileURLToPath(href));
  return new Response(body, { headers: { "content-type": "application/wasm" } });
};
const sdk = await import(new URL("zolana.bundle.js", WEB_SOL).href);
const { buildProofInputs, ownerSigners, rebuildProofInputs, selectInputs } = await import(
  new URL("transfer.js", WEB_SOL).href
);
await sdk.initializePoseidon();

const scalar = (n) => {
  const out = new Uint8Array(32);
  new DataView(out.buffer).setBigUint64(24, BigInt(n));
  return out;
};

/** A test wallet from one byte: a signer key and the shielded keys that the SDK derives from it. */
function testWallet(seed) {
  const signer = sdk.SigningKey.fromEd25519Bytes(new Uint8Array(32).fill(seed));
  const keypair = sdk.ShieldedKeypair.fromKeypair(signer);
  const address = keypair.shieldedAddress();
  return {
    address,
    owner: address.signingPublicKey,
    nullifier: keypair.nullifierKey(),
    viewing: keypair.viewingKey(),
  };
}

const group = testWallet(0x42);
const payee = testWallet(0x43);

/** A synced entry of the group wallet, as sdk.syncWallet leaves it. */
function entry(amount, seed, options = {}) {
  const { asset = sdk.SOL_MINT, tree = TREE, ...rest } = options;
  const utxo = new sdk.Utxo({ owner: group.owner, asset, amount, blinding: scalar(seed) });
  const nullifier = sdk.ProofInputUtxo.fromNullifierKey(utxo, group.nullifier).nullifier();
  const outputContext = { hash: scalar(0x900 + seed), tree, leafIndex: BigInt(seed) };
  return { utxo, nullifier, spent: false, outputContext, ...rest };
}

const client = { tree: TREE };
const session = {
  address: group.address,
  viewing: group.viewing,
  owner: group.address.solanaAddress(),
  groupOwner: group.address.solanaAddress(),
};
const walletOf = (entries) => ({ utxos: () => entries, registry: new sdk.AssetRegistry([]) });
const build = (entries, amount = 40n, expiry = EXPIRY) =>
  buildProofInputs(sdk, client, session, walletOf(entries), {
    recipient: payee.address,
    amount,
    expiry,
    payer: PAYER,
  });

/** The unpatched path of the SDK: finalize() has no way to set the expiry. */
function sdkDefault(entries) {
  const inputs = entries.map((e) => sdk.ProofInputUtxo.fromNullifierKey(e.utxo, group.nullifier));
  const transfer = new sdk.ConfidentialTransfer(group.address, inputs, PAYER);
  transfer.send(payee.address, sdk.SOL_MINT, 40n);
  const prepared = transfer.prepare();
  const txKey = group.viewing.transactionViewingKey(prepared.firstNullifier);
  const assets = new sdk.AssetRegistry([]);
  const sealed = sdk.encryptConfidentialTransfer(txKey, { outputs: prepared.outputs, assets });
  const { txViewingPublicKey, salt, payload } = sealed;
  return prepared.finalize({ txViewingPublicKey, salt, payload });
}

function expiryIsBound() {
  const entries = [entry(100n, 1)];
  assert.equal(sdkDefault(entries).externalData.expiryUnixTs, U64_MAX, "the SDK default moved");
  const { proofInputs, tree } = build(entries);
  assert.equal(proofInputs.externalData.expiryUnixTs, EXPIRY, "the expiry is not bound");
  assert.equal(tree, TREE);
  assert.equal(proofInputs.payer, PAYER);
  assert.equal(proofInputs.externalData.salt.length, 16);
  step("finalize() binds u64::MAX; buildProofInputs binds the expiry of the request");
}

function hashFollowsExpiry() {
  const { proofInputs } = build([entry(100n, 1)]);
  const data = proofInputs.externalData;
  const same = sdk.createExternalData({ ...data });
  assert.deepEqual(same.hash(), data.hash(), "the external data hash is not reproducible");
  const later = sdk.createExternalData({ ...data, expiryUnixTs: EXPIRY + 1n });
  assert.notDeepEqual(later.hash(), data.hash(), "the external data hash ignores the expiry");
  const other = build([entry(100n, 1)], 40n, EXPIRY + 1n).proofInputs.externalData;
  assert.notDeepEqual(other.hash(), data.hash(), "two proofs of one expiry share a hash");
  step("the hash of the external data follows the expiry");
}

function selection() {
  const tree = TREE;
  const entries = [entry(10n, 1), entry(70n, 2), entry(30n, 3), entry(50n, 4)];
  const picked = selectInputs(sdk, walletOf(entries), tree, 90n);
  assert.deepEqual(
    picked.map((e) => e.utxo.amount),
    [70n, 50n],
    "not largest first",
  );
  const all = selectInputs(sdk, walletOf(entries), tree, 160n);
  assert.deepEqual(
    all.map((e) => e.utxo.amount),
    [70n, 50n, 30n, 10n],
  );
  const one = selectInputs(sdk, walletOf(entries), tree, 70n);
  assert.deepEqual(
    one.map((e) => e.utxo.amount),
    [70n],
    "took more than it needed",
  );
  assert.throws(() => selectInputs(sdk, walletOf(entries), tree, 161n), /does not cover/);
  assert.throws(() => selectInputs(sdk, walletOf(entries), tree, 0n), /more than zero/);
  assert.throws(() => selectInputs(sdk, walletOf([]), tree, 1n), /does not cover/);
  step("selection takes the largest UTXOs first, only as many as needed, and refuses the rest");
}

function selectionSkips() {
  const spent = entry(500n, 5, { spent: true });
  const elsewhere = entry(500n, 6, { tree: "11111111111111111111111111111114" });
  const token = entry(500n, 7, { asset: "11111111111111111111111111111115" });
  const withData = entry(500n, 8, { dataHash: scalar(9) });
  const ringed = entry(500n, 9, { ringDataHash: scalar(9) });
  const empty = entry(1n, 10);
  const skipped = [spent, elsewhere, token, withData, ringed];
  const wallet = walletOf([...skipped, empty]);
  assert.deepEqual(selectInputs(sdk, wallet, TREE, 1n), [empty], "a UTXO that must be skipped");
  assert.throws(() => selectInputs(sdk, wallet, TREE, 2n), /does not cover/);
  step("selection skips spent, other-tree, non-SOL, data and ring UTXOs");
}

function inputCap() {
  const many = Array.from({ length: 41 }, (_v, i) => entry(1n, i + 1));
  assert.equal(selectInputs(sdk, walletOf(many), TREE, 40n).length, 40, "40 UTXOs are allowed");
  assert.throws(() => selectInputs(sdk, walletOf(many), TREE, 41n), /more than 40 UTXOs/);
  assert.throws(() => selectInputs(sdk, walletOf(many), TREE, 42n), /does not cover/);
  step("a payment of more than 40 UTXOs is refused as the SDK refuses it, with a merge hint");
}

function ownersOfOutputs() {
  const { proofInputs } = build([entry(100n, 1)]);
  const real = proofInputs.outputs.filter((o) => !o.isDummy());
  assert.deepEqual(real.map((o) => o.amount).sort(), [40n, 60n], "payment and change");
  const hashes = new Map(real.map((o) => [o.amount, Buffer.from(o.ownerHash()).toString("hex")]));
  const hex = (address) => Buffer.from(address.ownerHash()).toString("hex");
  assert.equal(hashes.get(40n), hex(payee.address), "the payment is not for the payee");
  assert.equal(hashes.get(60n), hex(group.address), "the change is not for the owner");
  const spent = proofInputs.inputUtxos.filter((i) => !i.isDummy());
  assert.deepEqual(
    spent.map((i) => i.utxo.amount),
    [100n],
  );
  step("the payment goes to the payee, the change to the owner, and the input is the UTXO");
}

function exactAmountHasNoChange() {
  const { proofInputs } = build([entry(40n, 1)]);
  const real = proofInputs.outputs.filter((o) => !o.isDummy());
  assert.deepEqual(
    real.map((o) => o.amount),
    [40n],
    "an exact payment has a change output",
  );
  step("an exact payment has no change output");
}

function theFeeKeyPaysAndTheGroupIsTheOwnerSigner() {
  const { proofInputs } = build([entry(100n, 1), entry(50n, 2)], 120n);
  assert.equal(proofInputs.payer, PAYER, "the payer is the fee key");
  assert.notEqual(proofInputs.payer, session.owner);
  assert.deepEqual(ownerSigners(sdk, proofInputs), [session.owner], "the group signs as owner");
  // Two inputs of one owner give one owner signer. A spend that the owner pays has none.
  const alone = new sdk.ConfidentialTransfer(group.address, [entryInput(1)], session.owner);
  alone.send(payee.address, sdk.SOL_MINT, 10n);
  const prepared = alone.prepare();
  const key = group.viewing.transactionViewingKey(prepared.firstNullifier);
  const sealed = sdk.encryptConfidentialTransfer(key, {
    outputs: prepared.outputs,
    assets: new sdk.AssetRegistry([]),
  });
  const own = prepared.finalize(sealed);
  assert.deepEqual(ownerSigners(sdk, own), [], "the owner that pays signs once, as payer");
  // With a sponsor every tag is inline: the account index 0 would name the payer.
  for (const out of proofInputs.externalData.outputs) assert.equal(out.ownerTag.kind, "inline");
  assert.equal(own.externalData.outputs[0].ownerTag.kind, "account", "the control: owner pays");
  assert.throws(
    () =>
      buildProofInputs(sdk, client, session, walletOf([entry(100n, 1)]), {
        recipient: payee.address,
        amount: 40n,
        expiry: EXPIRY,
        payer: session.owner,
      }),
    /the group key cannot pay the fee/,
  );
  step("the fee key pays, the group is the owner signer, and no tag names the payer");
}

/** ownerSigners equals the function of the SDK that the package does not export, when the
 * checkout of the pinned commit is at hand (ZOLANA_REPO): the proof and the instruction must
 * agree on the list. A dummy input and a repeated owner give no signer, nor does the payer. */
async function ownerSignersEqualTheSdk() {
  if (!process.env.ZOLANA_REPO)
    return console.log("skip  ownerSigners against the SDK (no ZOLANA_REPO)");
  const file = `${process.env.ZOLANA_REPO}/sdk-libs/ts/dist/client/prover/assembly.js`;
  const { ownerSignerAddresses } = await import(file);
  const other = testWallet(0x44);
  const make = (wallet, seed) =>
    sdk.ProofInputUtxo.fromNullifierKey(
      new sdk.Utxo({
        owner: wallet.owner,
        asset: sdk.SOL_MINT,
        amount: 1n,
        blinding: scalar(seed),
      }),
      wallet.nullifier,
    );
  const inputs = [make(group, 1), make(other, 2), make(group, 3), make(other, 4)];
  const names = [group.address.solanaAddress(), other.address.solanaAddress(), PAYER];
  for (const payer of names) {
    const want = [...ownerSignerAddresses(inputs, payer)];
    assert.deepEqual(ownerSigners(sdk, { inputUtxos: inputs, payer }), want, payer);
  }
  assert.deepEqual(
    ownerSigners(sdk, { inputUtxos: inputs, payer: PAYER }),
    [group.address.solanaAddress(), other.address.solanaAddress()],
    "first-input order, each owner once",
  );
  step("ownerSigners equals ownerSignerAddresses of the SDK, in the same order");
}

const entryInput = (seed) =>
  sdk.ProofInputUtxo.fromNullifierKey(entry(100n, seed).utxo, group.nullifier);

// ── The PDA identity: a payment that any seat proves again ──
const hexOf = (bytes) => Buffer.from(bytes).toString("hex");
const PDA = new Uint8Array(32).fill(0x6a);
const pdaNullifier = sdk.NullifierKey.fromSecret(new Uint8Array(31).fill(0x4d));
const pdaAddress = sdk.ShieldedAddress.forPda({
  pda: PDA,
  nullifierPublicKey: pdaNullifier.publicKey(),
  viewingPublicKey: group.viewing.publicKey(),
});
const pda = {
  address: pdaAddress,
  viewing: group.viewing,
  owner: pdaAddress.solanaAddress(),
  groupOwner: group.address.solanaAddress(),
};

/** A synced UTXO of the PDA identity. */
function pdaEntry(amount, seed) {
  const utxo = new sdk.Utxo({
    owner: sdk.ShieldedPublicKey.fromPda(PDA),
    asset: sdk.SOL_MINT,
    amount,
    blinding: scalar(seed),
  });
  const nullifier = sdk.ProofInputUtxo.fromNullifierKey(utxo, pdaNullifier).nullifier();
  const outputContext = { hash: scalar(0x700 + seed), tree: TREE, leafIndex: BigInt(seed) };
  return { utxo, nullifier, spent: false, outputContext };
}

/** What the page keeps of a first proof: the plan and the fields of its data (parseTransact). */
function firstOf(proofInputs) {
  const data = proofInputs.externalData;
  const roles = proofInputs.outputs.map((o) => {
    if (o.isDummy()) return "dummy";
    return hexOf(o.ownerHash()) === hexOf(pdaAddress.ownerHash()) ? "change" : "payee";
  });
  const plan = {
    blindingSeed: hexOf(proofInputs.blindingSeed),
    outputs: proofInputs.outputs.map((o, i) => ({
      role: roles[i],
      mint: "00".repeat(32),
      amount: o.amount.toString(),
      blinding: hexOf(o.blinding),
    })),
  };
  const first = {
    expiry: data.expiryUnixTs,
    salt: data.salt,
    txViewingPk: hexOf(data.txViewingPublicKey.toBytes()),
    inputs: proofInputs.inputUtxos.length,
    outputs: proofInputs.outputs.length,
    published: data.outputs.map((o) => ({
      utxoHash: hexOf(o.utxoHash),
      tag: hexOf(o.ownerTag.value),
      data: hexOf(o.data),
    })),
  };
  return { plan, first };
}

function aPaymentIsRebuiltWithItsCommitmentForAnyPayer() {
  for (const [amount, sent] of [
    [100n, 40n],
    [40n, 40n],
  ]) {
    const entries = [pdaEntry(amount, 1)];
    const request = { recipient: payee.address, amount: sent, expiry: EXPIRY, payer: PAYER };
    const { proofInputs } = buildProofInputs(sdk, client, pda, walletOf(entries), request);
    const { plan, first } = firstOf(proofInputs);
    const inputIds = entries.map((e) => hexOf(e.outputContext.hash));
    const again = { recipient: payee.address, plan, inputIds, first };
    const other = "11111111111111111111111111111119";
    const elsewhere = { ...again, payer: other };
    const rebuilt = rebuildProofInputs(sdk, client, pda, walletOf(entries), elsewhere);
    assert.equal(rebuilt.payer, other);
    assert.equal(hexOf(rebuilt.messageHash()), hexOf(proofInputs.messageHash()), `${sent}`);
    assert.equal(hexOf(rebuilt.privateTxHash()), hexOf(proofInputs.privateTxHash()));
    const moved = structuredClone(plan);
    moved.outputs[0].blinding = "11".repeat(32);
    const changed = rebuildProofInputs(sdk, client, pda, walletOf(entries), {
      ...again,
      plan: moved,
      payer: other,
    });
    assert.notEqual(hexOf(changed.messageHash()), hexOf(proofInputs.messageHash()), "a blinding");
  }
  step("a payment of the PDA rebuilt for another payer has the commitment of its first proof");
}

function aRebuildRefusesTheGroupKeyAMissingInputAndAnAccountTag() {
  const entries = [pdaEntry(100n, 1)];
  const request = { recipient: payee.address, amount: 40n, expiry: EXPIRY, payer: PAYER };
  const { proofInputs } = buildProofInputs(sdk, client, pda, walletOf(entries), request);
  const { plan, first } = firstOf(proofInputs);
  const again = { recipient: payee.address, plan, first, inputIds: [hexOf(scalar(0x701))] };
  const rebuild = (change) =>
    rebuildProofInputs(sdk, client, pda, walletOf(entries), { ...again, payer: PAYER, ...change });
  assert.throws(() => rebuild({ payer: pda.groupOwner }), /the group key cannot pay/);
  assert.throws(() => rebuild({ payer: pda.owner }), /the group key cannot pay/);
  assert.throws(() => rebuild({ inputIds: [hexOf(scalar(5))] }), /not in the synced wallet/);
  assert.throws(() => rebuild({ inputIds: [] }), /inputs and outputs of the plan/);
  const tagless = { ...first, published: first.published.map((o) => ({ ...o, tag: null })) };
  assert.throws(() => rebuild({ first: tagless }), /no inline owner tag/);
  step("a rebuild refuses the group key as payer, an input that is not synced and an account tag");
}

expiryIsBound();
theFeeKeyPaysAndTheGroupIsTheOwnerSigner();
hashFollowsExpiry();
selection();
selectionSkips();
inputCap();
ownersOfOutputs();
exactAmountHasNoChange();
await ownerSignersEqualTheSdk();
aPaymentIsRebuiltWithItsCommitmentForAnyPayer();
aRebuildRefusesTheGroupKeyAMissingInputAndAnAccountTag();
console.log("transfer tests passed");
