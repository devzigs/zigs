// Tests of web/sol/transfer.js with the real SDK (the shipped bundle).
// Usage: node solspike/test/transfer.test.mjs
// The Worker builds the proof inputs of a transfer from public pieces of the SDK and binds the
// expiry itself, because finalize() of the SDK fixes it at u64::MAX. Offline: no prover, no RPC.
//   1. finalize() binds u64::MAX (the control), and buildProofInputs binds the expiry.
//   2. The hash of the external data follows the expiry.
//   3. Selection: largest first, SOL, plain, unspent, in the tree of the client, enough to cover.
//   4. The payment and the change reach the right owners.
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
const { buildProofInputs, selectInputs } = await import(new URL("transfer.js", WEB_SOL).href);
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

const session = {
  client: { tree: TREE },
  address: group.address,
  viewing: group.viewing,
  owner: PAYER,
};
const walletOf = (entries) => ({ utxos: () => entries, registry: new sdk.AssetRegistry([]) });
const build = (entries, amount = 40n, expiry = EXPIRY) =>
  buildProofInputs(sdk, session, walletOf(entries), { recipient: payee.address, amount, expiry });

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
  assert.deepEqual(picked.map((e) => e.utxo.amount), [70n, 50n], "not largest first");
  const all = selectInputs(sdk, walletOf(entries), tree, 160n);
  assert.deepEqual(all.map((e) => e.utxo.amount), [70n, 50n, 30n, 10n]);
  const one = selectInputs(sdk, walletOf(entries), tree, 70n);
  assert.deepEqual(one.map((e) => e.utxo.amount), [70n], "took more than it needed");
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
  assert.deepEqual(spent.map((i) => i.utxo.amount), [100n]);
  step("the payment goes to the payee, the change to the owner, and the input is the UTXO");
}

function exactAmountHasNoChange() {
  const { proofInputs } = build([entry(40n, 1)]);
  const real = proofInputs.outputs.filter((o) => !o.isDummy());
  assert.deepEqual(real.map((o) => o.amount), [40n], "an exact payment has a change output");
  step("an exact payment has no change output");
}

expiryIsBound();
hashFollowsExpiry();
selection();
selectionSkips();
inputCap();
ownersOfOutputs();
exactAmountHasNoChange();
console.log("transfer tests passed");
