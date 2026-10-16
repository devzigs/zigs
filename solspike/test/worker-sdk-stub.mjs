// A stand-in for web/sol/zolana.bundle.js and for web/sol/transfer.js in worker.test.mjs. The
// decoders and constants are the real ones from the bundle. The client, the keys, the wallet and
// the proof input builder are fakes that record what the Worker asked for and answer from
// `control`. Nothing here reaches a network. transfer.js has its own test (transfer.test.mjs).
import * as real from "../../web/sol/zolana.bundle.js";

const OWNER = "B1o5q9sWLRVY2uk43bd1GLLPcNmhqJQ53CfKKxKzeShD";
const PDA = "UgrqxxdDh3m4pf1DLYGw6fnzk9NGuWJaUnerUp4Mxqd";

export const control = {
  /** The names of the SDK calls that the Worker made, in order. */
  calls: [],
  /** The options of createZolanaClient (the fetch of the Worker is options.fetch). */
  options: null,
  /** Per RPC method: async (...args) => value. A method without a reply throws. */
  rpc: {},
  /** What wallet.utxos() returns. */
  utxos: [],
  /** (request) => { proofInputs, tree }: the proof input builder of transfer.js. */
  inputs: () => {
    throw new Error("no proof inputs");
  },
  /** (request) => proofInputs with messageHash(): the rebuild of an approved payment. */
  rebuild: () => {
    throw new Error("no rebuild");
  },
  /** The request of the last rebuild, and the identities that the builders got. */
  rebuilt: null,
  /** The identity of the wallet of the last sync. */
  synced: null,
  /** async (proofInputs) => data: client.proveTransact. It may post a prover body first. */
  prove: async () => {
    throw new Error("no prover");
  },
  /** The bytes that sdk.transactInstruction answers with. */
  instructionData: new Uint8Array(0),
  /** What the Worker passed to the builder, to proveTransact and to transactInstruction. */
  request: null,
  proved: null,
  instruction: null,
  /** The proof inputs that the Worker passed to ownerSigners. */
  signed: null,
  /** Per call name: an Error that the fake throws. */
  fail: {},
};

const note = (name) => {
  control.calls.push(name);
  if (control.fail[name]) throw control.fail[name];
};

const solanaRpc = new Proxy(
  {},
  {
    get:
      (_target, method) =>
      (...args) => ({
        send: async () => {
          control.calls.push(`rpc:${String(method)}`);
          if (!control.rpc[method]) throw new Error(`no reply for ${String(method)}`);
          return control.rpc[method](...args);
        },
      }),
  },
);

const addressOf = (owner, first) => ({
  solanaAddress: () => owner,
  toBytes: () => Uint8Array.from({ length: 4 }, (_v, i) => first + i),
  ownerHash: () => Uint8Array.from({ length: 4 }, (_v, i) => 0xf0 + first + i),
});
/** The address of the group key (1, 2, 3, 4) and of the PDA identity (9, 10, 11, 12). */
const address = addressOf(OWNER, 1);
const pdaAddress = addressOf(PDA, 9);

export const SOL_MINT = "SOL";
export const SHIELDED_POOL_PROGRAM_ID = real.SHIELDED_POOL_PROGRAM_ID;
export const decodeTreeFees = real.decodeTreeFees;
export const getAddressDecoder = real.getAddressDecoder;
export const getAddressEncoder = real.getAddressEncoder;
export const getCompiledTransactionMessageDecoder = real.getCompiledTransactionMessageDecoder;

export const ViewingKey = { fromBytes: () => ({ publicKey: () => ({}) }) };
export const NullifierKey = { fromSecret: () => ({ publicKey: () => ({}) }) };
export const ShieldedPublicKey = { fromEd25519: () => ({}) };
export const ShieldedAddress = {
  fromPublicKeys: () => address,
  forPda: () => pdaAddress,
  fromBytes: () => ({}),
};
export const LocalKeys = { fromKeys: () => ({}) };

export class Wallet {
  constructor({ identity } = {}) {
    this.identity = identity;
  }
  balance() {
    return { amount: 0n };
  }
  utxos() {
    return control.utxos;
  }
}

export async function createZolanaClient(options) {
  note("createZolanaClient");
  control.options = options;
  const proveTransact = async (proofInputs, keys) => {
    note("proveTransact");
    control.proved = { proofInputs, keys };
    return control.prove(proofInputs);
  };
  return { proofService: {}, solanaRpc, tree: "TREE", proveTransact };
}

export async function syncWallet({ wallet } = {}) {
  note("syncWallet");
  control.synced = wallet?.identity;
  return { storedUtxos: control.utxos.length, undecryptableCandidates: 0 };
}

export async function transactInstruction(call) {
  note("transactInstruction");
  control.instruction = call;
  return { data: control.instructionData };
}

/** The owner signers of transfer.js: the group, as the fake wallet has one owner. */
export function ownerSigners(_sdk, proofInputs) {
  note("ownerSigners");
  control.signed = proofInputs;
  return [OWNER];
}

/** web/sol/transfer.js, resolved to this file by the hook of worker.test.mjs. */
export function buildProofInputs(_sdk, _client, identity, _wallet, request) {
  note("buildProofInputs");
  control.request = { identity, ...request };
  return control.inputs(request);
}

/** The movable SOL of a synced wallet, as transfer.js computes it: here the control value. */
export const spendableSum = () => control.movable ?? 0n;

/** The rebuild of transfer.js: records the identity and the request. */
export function rebuildProofInputs(_sdk, _client, identity, _wallet, request) {
  note("rebuildProofInputs");
  control.rebuilt = { identity, ...request };
  return control.rebuild(request);
}
