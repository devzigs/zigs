// The proof inputs of a private SOL transfer (ZOLANA.md 3.3), built from public pieces of the SDK
// package. `sdk` is the bundle, so a test can pass the real one. buildTransferTransaction cannot
// set the expiry that the proof binds: finalize() fixes it at u64::MAX. So the Worker selects the
// inputs, seals the outputs, sets the expiry in the external data and proves the result itself.
// The fee key of a seat pays (ZOLANA.md 5), so the payer is not the owner: the proof binds the
// payer and every other input owner as a signer (the SDK sponsor mode, #424), and the instruction
// lists those owners as owner signers (`ownerSigners`).
//
// The owner is an identity of the group: the PDA of the approvals program for a payment
// (ZOLANA.md 7.2), the group key for the move of the beta funds. A payment is approved once and
// proved again when it is executed: `rebuildProofInputs` makes the same proof inputs from the plan
// and the data of the first proof, for any payer, so the commitment stays the one approved.

const largestFirst = (a, b) => {
  if (a.utxo.amount === b.utxo.amount) return 0;
  return a.utxo.amount > b.utxo.amount ? -1 : 1;
};

/** A UTXO that the default rail always proves: no ring, no data. */
const isPlain = (e) =>
  e.utxo.ringProgramId === undefined &&
  e.ringDataHash === undefined &&
  e.dataHash === undefined &&
  e.utxo.data.isEmpty();

const isSpendable = (sdk, tree, e) =>
  !e.spent &&
  e.utxo.asset === sdk.SOL_MINT &&
  e.utxo.amount > 0n &&
  e.outputContext.tree === tree &&
  isPlain(e);

// ponytail: the SDK limit of a wallet spend (MAX_SPEND_INPUTS in flows/select.ts, not exported).
// A wider spend gets a wider proof shape that does not fit one transaction. Ceiling: this copy
// drifts if the SDK changes its limit. Upgrade path: read the limit from the SDK once exported.
const MAX_INPUTS = 40;

/** The synced SOL UTXOs of `tree` that cover `amount`, largest first (the SDK default). */
export function selectInputs(sdk, wallet, tree, amount) {
  if (amount <= 0n) throw new Error("the amount must be more than zero");
  const sorted = wallet
    .utxos()
    .filter((e) => isSpendable(sdk, tree, e))
    .sort(largestFirst);
  const picked = [];
  let held = 0n;
  for (const entry of sorted.slice(0, MAX_INPUTS)) {
    if (held >= amount) break;
    picked.push(entry);
    held += entry.utxo.amount;
  }
  if (held >= amount) return picked;
  const total = sorted.reduce((sum, e) => sum + e.utxo.amount, 0n);
  if (total >= amount) {
    throw new Error(`the payment needs more than ${MAX_INPUTS} UTXOs: merge first`);
  }
  throw new Error("the synced balance does not cover the amount");
}

function proofInput(sdk, entry, address) {
  // A spend of a synced UTXO of the identity, with its nullifier.
  return new sdk.ProofInputUtxo({
    utxo: entry.utxo,
    nullifierPublicKey: address.nullifierPublicKey,
    nullifier: entry.nullifier,
  });
}

/** Seals the outputs under the key of this transaction and finalizes the proof inputs. */
function seal(sdk, identity, wallet, prepared) {
  const txKey = identity.viewing.transactionViewingKey(prepared.firstNullifier);
  try {
    const assets = wallet.registry;
    const sealed = sdk.encryptConfidentialTransfer(txKey, { outputs: prepared.outputs, assets });
    const { txViewingPublicKey, salt, payload } = sealed;
    return prepared.finalize({ txViewingPublicKey, salt, payload });
  } finally {
    txKey.destroy();
  }
}

/** The same proof inputs with `expiry` in the external data, which the proof and the data bind. */
function withExpiry(sdk, open, expiry) {
  const externalData = sdk.createExternalData({ ...open.externalData, expiryUnixTs: expiry });
  return new sdk.SppProofInputs({
    payer: open.payer,
    inputUtxos: open.inputUtxos,
    outputs: open.outputs,
    externalData,
    blindingSeed: open.blindingSeed,
    outputTreeId: open.outputTreeId,
    cacheAccounts: open.cacheAccounts,
  });
}

/**
 * The owner signers of a spend, in the order of the SDK (`ownerSignerAddresses` of
 * client/prover/assembly.ts, which the package does not export): the Ed25519 owners of the real
 * inputs that are not the payer, each once. The proof and the instruction must agree on this list.
 */
export function ownerSigners(sdk, proofInputs) {
  const decoder = sdk.getAddressDecoder();
  const owners = proofInputs.inputUtxos
    .filter((input) => !input.isDummy() && input.utxo.owner.signatureType() !== "p256")
    .map((input) => decoder.decode(input.utxo.owner.confidentialViewTag()))
    .filter((address) => address !== proofInputs.payer);
  return [...new Set(owners)];
}

/** The group key and the owner of the identity never pay: a fee key of a seat does. */
function checkPayer(identity, payer) {
  if (payer === identity.owner || payer === identity.groupOwner) {
    throw new Error("the group key cannot pay the fee");
  }
}

/**
 * The proof inputs that pay `amount` to `recipient` (a ShieldedAddress) from the synced wallet of
 * `identity` ({ address, viewing, owner, groupOwner }), with the change to the owner and `expiry`
 * bound. `payer` (a base58 address) pays the fee: it is not the owner. Returns { proofInputs,
 * tree }: the tree is the one that every input sits in.
 */
export function buildProofInputs(sdk, client, identity, wallet, request) {
  const { recipient, amount, expiry, payer } = request;
  checkPayer(identity, payer);
  const { tree } = client;
  const picked = selectInputs(sdk, wallet, tree, amount);
  const inputs = picked.map((entry) => proofInput(sdk, entry, identity.address));
  const transfer = new sdk.ConfidentialTransfer(identity.address, inputs, payer);
  transfer.send(recipient, sdk.SOL_MINT, amount);
  const open = seal(sdk, identity, wallet, transfer.prepare());
  return { proofInputs: withExpiry(sdk, open, expiry), tree };
}

/** The unspent synced UTXOs of `ids`, in order. Throws when one is not in the wallet. */
function entriesOf(wallet, ids) {
  return ids.map((id) => {
    const found = wallet.utxos().find((u) => !u.spent && hexOf(u.outputContext.hash) === id);
    if (found === undefined) throw new Error("an input of the payment is not in the synced wallet");
    return found;
  });
}

// The one live tree (`DEFAULT_TREE_ID` of the SDK). The checker accepts no other.
const TREE_ID = 0;

const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const bytesOf = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

/** One output slot of the plan as the prover takes it: the payee, the change or a dummy. */
function proofOutput(sdk, slot, owners, tag) {
  const base = { amount: BigInt(slot.amount), blinding: bytesOf(slot.blinding) };
  if (slot.role === "dummy") {
    return sdk.createProofOutput({ ...base, asset: sdk.SOL_MINT, ownerTag: bytesOf(tag) });
  }
  const ownerAddress = slot.role === "payee" ? owners.payee : owners.change;
  return sdk.createProofOutput({ ...base, asset: sdk.SOL_MINT, ownerAddress });
}

/**
 * The proof inputs of an approved payment, for a new proof with `payer`: the inputs by id from the
 * synced wallet, the outputs of the plan (payee, change to the identity, dummies), the root seed
 * of the plan, and the external data of the first proof (`first`: parseTransact of its data). The
 * payer is not in the commitment, so any seat can execute. The caller compares the commitment.
 */
export function rebuildProofInputs(sdk, client, identity, wallet, request) {
  const { recipient, payer, plan, inputIds, first } = request;
  checkPayer(identity, payer);
  if (first.inputs !== inputIds.length || first.outputs !== plan.outputs.length) {
    throw new Error("the first proof does not have the inputs and outputs of the plan");
  }
  if (first.published.some((o) => o.tag === null || o.data === null)) {
    throw new Error("an output of the first proof has no inline owner tag or no data");
  }
  const inputs = entriesOf(wallet, inputIds).map((e) => proofInput(sdk, e, identity.address));
  const owners = { payee: recipient, change: identity.address };
  const tagOf = (i) => first.published[i].tag;
  const outputs = plan.outputs.map((slot, i) => proofOutput(sdk, slot, owners, tagOf(i)));
  const published = first.published.map((o) => ({
    utxoHash: bytesOf(o.utxoHash),
    ownerTag: { kind: "inline", value: bytesOf(o.tag) },
    data: bytesOf(o.data),
  }));
  const externalData = sdk.createExternalData({
    expiryUnixTs: first.expiry,
    txViewingPublicKey: sdk.P256PublicKey.fromBytes(bytesOf(first.txViewingPk)),
    salt: first.salt,
    outputs: published,
    resolvedOwnerTags: published.map((o) => o.ownerTag.value),
    messages: [],
  });
  return new sdk.SppProofInputs({
    payer,
    inputUtxos: inputs,
    outputs,
    externalData,
    blindingSeed: bytesOf(plan.blindingSeed),
    outputTreeId: TREE_ID,
  });
}
