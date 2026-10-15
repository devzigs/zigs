// A stand-in for web/sol/zolana.bundle.js in worker.test.mjs. The decoders and constants are the
// real ones from the bundle. The client, the keys, the wallet and the transfer builder are fakes
// that record what the Worker asked for and answer from `control`. Nothing here reaches a network.
import * as real from "../../web/sol/zolana.bundle.js";

const OWNER = "B1o5q9sWLRVY2uk43bd1GLLPcNmhqJQ53CfKKxKzeShD";

export const control = {
  /** The names of the SDK calls that the Worker made, in order. */
  calls: [],
  /** The values that setProofExpiry received, in order. */
  expiries: [],
  /** The options of createZolanaClient (the fetch of the Worker is options.fetch). */
  options: null,
  /** Per RPC method: async (...args) => value. A method without a reply throws. */
  rpc: {},
  /** What wallet.utxos() returns. */
  utxos: [],
  /** async (params) => { messageBytes }: the transfer builder. */
  build: async () => {
    throw new Error("no builder");
  },
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
    get: (_target, method) => (...args) => ({
      send: async () => {
        control.calls.push(`rpc:${String(method)}`);
        if (!control.rpc[method]) throw new Error(`no reply for ${String(method)}`);
        return control.rpc[method](...args);
      },
    }),
  },
);

const address = {
  solanaAddress: () => OWNER,
  toBytes: () => Uint8Array.from({ length: 4 }, (_v, i) => i + 1),
  ownerHash: () => Uint8Array.from({ length: 4 }, (_v, i) => 0xf0 + i),
};

export const SOL_MINT = "SOL";
export const SHIELDED_POOL_PROGRAM_ID = real.SHIELDED_POOL_PROGRAM_ID;
export const decodeTreeFees = real.decodeTreeFees;
export const getAddressDecoder = real.getAddressDecoder;
export const getAddressEncoder = real.getAddressEncoder;
export const getCompiledTransactionMessageDecoder = real.getCompiledTransactionMessageDecoder;

export const ViewingKey = { fromBytes: () => ({ publicKey: () => ({}) }) };
export const NullifierKey = { fromSecret: () => ({ publicKey: () => ({}) }) };
export const ShieldedPublicKey = { fromEd25519: () => ({}) };
export const ShieldedAddress = { fromPublicKeys: () => address, fromBytes: () => ({}) };
export const LocalKeys = { fromKeys: () => ({}) };

export class Wallet {
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
  return { proofService: {}, solanaRpc };
}

export async function syncWallet() {
  note("syncWallet");
  return { storedUtxos: control.utxos.length, undecryptableCandidates: 0 };
}

export function setProofExpiry(value) {
  control.expiries.push(value);
}

export async function buildTransferTransaction(params) {
  note("buildTransferTransaction");
  return control.build(params);
}
