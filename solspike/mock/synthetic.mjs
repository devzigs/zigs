// Synthetic mock replies, made up here (not recorded): the slot, a blockhash, a nonce account and
// a tree account. They let the mock scenarios run the Worker commands readNonce, treeFees and
// blockhash in a browser. The values differ from each other on purpose, so a wrong offset shows.

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const NONCE_ACCOUNT = "4kf6Z6LTZC7E7PRvUAoADayFXQfDGppBx8m1AuUvUndE";
export const TREE_ACCOUNT = "33KVhbT4QtdQDrrrGwwThqD47Dh4Q6tA443t9jMNcWFN";
export const GROUP = "B1o5q9sWLRVY2uk43bd1GLLPcNmhqJQ53CfKKxKzeShD";
const POOL = "sppU489D7A4U1exNo1oeMGZtLEofq3a6o2fR7UeoWB6";
const SYSTEM = "11111111111111111111111111111111";
export const TREE_SIZE = 40_080;
export const FEES = { feePerNullifier: 7n, appendReimbursement: 190n, closeReimbursement: 300n };
export const FEE_BALANCE = 12_345n;
export const SLOT = 510_911_100;
// A landed Devnet signature (public, the register transaction of the P5 group).
export const SIGNATURE =
  "5hTcKMgFEgNNatq8YQ7ZiF3XqxLifq3zoaaXZiP7c5wywDDcbjbFX9dNCk98BHsx9fCvCDeV3tgEGSnar1hxnVYX";
export const UNITS = 138_500;
export const STALE_ROOT = 7008;

/** Base58 to bytes (32 bytes for an address). */
export function decode58(text) {
  let n = 0n;
  for (const ch of text) n = n * 58n + BigInt(ALPHABET.indexOf(ch));
  const hex = n.toString(16).padStart(64, "0");
  return Buffer.from(hex, "hex");
}

function nonceAccount() {
  const data = Buffer.alloc(80);
  data.writeUInt32LE(1, 0);
  data.writeUInt32LE(1, 4);
  decode58(GROUP).copy(data, 8);
  decode58(NONCE_ACCOUNT).copy(data, 40);
  data.writeBigUInt64LE(5000n, 72);
  return data;
}

function treeAccount() {
  const data = Buffer.alloc(TREE_SIZE);
  data[0] = 1;
  data.writeBigUInt64LE(FEES.feePerNullifier, 8);
  data.writeBigUInt64LE(FEES.appendReimbursement, 16);
  data.writeBigUInt64LE(FEES.closeReimbursement, 24);
  data.writeBigUInt64LE(FEE_BALANCE, 32);
  return data;
}

const account = (data, owner) => ({
  context: { slot: SLOT },
  value: {
    data: [data.toString("base64"), "base64"],
    executable: false,
    lamports: 1_056_640,
    owner,
    rentEpoch: 0,
    space: data.length,
  },
});

const reply = (seq, rpcMethod, result, param0) => ({
  seq,
  method: "POST",
  path: "/",
  rpcMethod,
  ...(param0 === undefined ? {} : { param0 }),
  status: 200,
  contentType: "application/json",
  synthetic: true,
  body: JSON.stringify({ jsonrpc: "2.0", result }),
});

const context = { slot: SLOT };

/** The first simulation passes. The second fails like a stale root (custom error 7008). */
function simulations() {
  const logs = ["Program sppU489D7A4U1exNo1oeMGZtLEofq3a6o2fR7UeoWB6 success"];
  const stale = { InstructionError: [1, { Custom: STALE_ROOT }] };
  return [
    reply(104, "simulateTransaction", {
      context,
      value: { err: null, logs, unitsConsumed: UNITS },
    }),
    reply(105, "simulateTransaction", {
      context,
      value: { err: stale, logs, unitsConsumed: 91_000 },
    }),
  ];
}

/** The signature is unknown at the first poll and confirmed at the second. */
function statuses() {
  const done = { slot: SLOT + 1, confirmations: 1, err: null, confirmationStatus: "confirmed" };
  return [
    reply(107, "getSignatureStatuses", { context, value: [null] }),
    reply(108, "getSignatureStatuses", { context, value: [done] }),
  ];
}

export function syntheticEntries() {
  const value = { blockhash: GROUP, lastValidBlockHeight: 99 };
  const blockhash = { context: { slot: SLOT }, value };
  return [
    reply(100, "getSlot", SLOT),
    reply(101, "getLatestBlockhash", blockhash),
    reply(102, "getAccountInfo", account(nonceAccount(), SYSTEM), NONCE_ACCOUNT),
    reply(103, "getAccountInfo", account(treeAccount(), POOL), TREE_ACCOUNT),
    ...simulations(),
    reply(106, "sendTransaction", SIGNATURE),
    ...statuses(),
  ];
}
