// The proof inputs of a private SOL transfer (ZOLANA.md 3.3), built from public pieces of the SDK
// package. `sdk` is the bundle, so a test can pass the real one. buildTransferTransaction cannot
// set the expiry that the proof binds: finalize() fixes it at u64::MAX. So the Worker selects the
// inputs, seals the outputs, sets the expiry in the external data and proves the result itself.

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
  return new sdk.ProofInputUtxo({
    utxo: entry.utxo,
    nullifierPublicKey: address.nullifierPublicKey,
    nullifier: entry.nullifier,
  });
}

/** Seals the outputs under the key of this transaction and finalizes the proof inputs. */
function seal(sdk, session, wallet, prepared) {
  const txKey = session.viewing.transactionViewingKey(prepared.firstNullifier);
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
 * The proof inputs that pay `amount` to `recipient` (a ShieldedAddress) from the synced wallet,
 * with the change to the owner and `expiry` bound. Returns { proofInputs, tree }: the tree is the
 * one that every input sits in.
 */
export function buildProofInputs(sdk, session, wallet, { recipient, amount, expiry }) {
  const { tree } = session.client;
  const picked = selectInputs(sdk, wallet, tree, amount);
  const inputs = picked.map((entry) => proofInput(sdk, entry, session.address));
  const transfer = new sdk.ConfidentialTransfer(session.address, inputs, session.owner);
  transfer.send(recipient, sdk.SOL_MINT, amount);
  const open = seal(sdk, session, wallet, transfer.prepare());
  return { proofInputs: withExpiry(sdk, open, expiry), tree };
}
