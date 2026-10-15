// Independent read-only checks of what landed on Devnet. Nothing here signs or sends: it only
// reads. It does not use the code of the app: the first signature is checked with Node's own
// Ed25519 (crypto.verify), the message is read with the decoder of the kit, and the registry
// record and the nonce account are read from their raw account data.
//   import { verifyTransaction, verifyRecord, verifyNonceAccount } from "./verify-chain.mjs";
import { createHash, createPublicKey, verify } from "node:crypto";
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getCompiledTransactionMessageDecoder,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  getTransactionDecoder,
} from "@solana/kit";
import { rpcCall, sleep } from "./rpc.mjs";

const REGISTRY = "regyS5rkAcw2YzDJCmTwCTHs2s246FXxbmuRZ42u2PD";
const POOL = "sppU489D7A4U1exNo1oeMGZtLEofq3a6o2fR7UeoWB6";
const RECORD_SEED = "zolana/registry/v0";
const SPKI = Buffer.from("302a300506032b6570032100", "hex");
const SYSTEM = "1".repeat(32);
const NAMES = { [REGISTRY]: "user-registry", [POOL]: "shielded-pool", [SYSTEM]: "system" };

const hex = (bytes) => Buffer.from(bytes).toString("hex");
const keyOf = (addressText) => Buffer.from(getAddressEncoder().encode(address(addressText)));

/** The 32 byte key (hex) of a Solana address. */
export const keyOfAddress = (addressText) => keyOf(addressText).toString("hex");

/** The Solana address (base58) of a 32 byte key given as hex. */
export const addressOfKey = (hexKey) => getAddressDecoder().decode(Buffer.from(hexKey, "hex"));

/**
 * The nonce account of a group key, derived here and not by the app: the SHA-256 of the key, the
 * seed "zigs-nonce-1" and the System program (an account made with a seed).
 */
export function nonceAccountOf(groupKeyHex) {
  const hash = createHash("sha256");
  hash.update(Buffer.from(groupKeyHex, "hex"));
  hash.update("zigs-nonce-1");
  hash.update(Buffer.alloc(32));
  return addressOfKey(hash.digest("hex"));
}

/** True when Node verifies `signature` over `message` under the address (an Ed25519 key). */
export function verifiesUnder(addressText, message, signature) {
  const der = Buffer.concat([SPKI, keyOf(addressText)]);
  const key = createPublicKey({ key: der, format: "der", type: "spki" });
  return verify(null, message, key, signature);
}

async function fetchTransaction(signature) {
  const options = {
    encoding: "base64",
    commitment: "confirmed",
    maxSupportedTransactionVersion: 1,
  };
  for (let i = 0; i < 20; i += 1) {
    const reply = await rpcCall("getTransaction", [signature, options]);
    if (reply !== null) return reply;
    await sleep(1500);
  }
  throw new Error(`transaction ${signature} was not found`);
}

const computeLines = (meta) =>
  (meta.logMessages ?? []).filter((line) => /consumed \d+ of \d+ compute units/.test(line));

// The instructions of a version 1 message: the program (by name) and the tag of its data (the
// first byte, or the u32 of a System instruction), in the order of the message.
function instructionsOf(message) {
  const keys = message.staticAccounts;
  return (message.instructionHeaders ?? []).map((head, i) => {
    const data = Buffer.from(message.instructionPayloads[i].instructionData);
    const program = keys[head.programAccountIndex];
    const tag = program === SYSTEM ? data.readUInt32LE(0) : data[0];
    return { program: NAMES[program] ?? program, tag };
  });
}

/** The template of a version 1 message: the config (limits) and the ordered instructions. */
const templateOf = (message) => ({
  configMask: message.configMask ?? null,
  config: (message.configValues ?? []).map((v) => `${v.kind}:${v.value}`),
  instructions: instructionsOf(message),
});

/**
 * One landed transaction: its first signature under `signer` (the group key, or the funder for
 * the funding transaction), the error, slot, fee and compute units, the lifetime (bytes 8 to 40 of
 * the message: the nonce value for a durable nonce) and the programs that it ran.
 */
export async function verifyTransaction(signature, signer) {
  const reply = await fetchTransaction(signature);
  const raw = Buffer.from(reply.transaction[0], "base64");
  const tx = getTransactionDecoder().decode(raw);
  const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  const [first] = Object.values(tx.signatures);
  const payer = message.staticAccounts[0];
  const { meta } = reply;
  return {
    signature,
    slot: reply.slot,
    err: meta.err,
    fee: meta.fee,
    computeUnits: meta.computeUnitsConsumed,
    version: message.version,
    template: templateOf(message),
    lifetime: hex(tx.messageBytes.subarray(8, 40)),
    payerIsSigner: payer === signer,
    firstSignatureVerifies: verifiesUnder(signer, tx.messageBytes, first),
    firstSignatureIsTxId: getSignatureFromTransaction(tx) === signature,
    programs: [...new Set(computeLines(meta).map((line) => line.split(" ")[1]))].map(
      (id) => NAMES[id] ?? id,
    ),
  };
}

/** The raw data of an account, or null when it does not exist. */
async function accountData(account) {
  const reply = await rpcCall("getAccountInfo", [
    account,
    { encoding: "base64", commitment: "confirmed" },
  ]);
  if (reply.value === null) return null;
  const { owner, lamports } = reply.value;
  return { owner, lamports, data: Buffer.from(reply.value.data[0], "base64") };
}

/**
 * The registry record of a group key. The layout is UserRecord of the Zolana repo, written with
 * borsh into an account of 134 bytes: a tag, the owner (32), the bump, the optional P-256 key
 * (one byte 0 for none, else 1 and 33 bytes), the nullifier key (32), the viewing key (33) and
 * the merge flag. A record with no P-256 owner is 101 bytes long, then zeros. The record must
 * belong to the group, have no P-256 owner, and hold the given keys.
 */
export async function verifyRecord(groupKeyHex, { nullifierPk, viewingPk }) {
  const seeds = [RECORD_SEED, Buffer.from(groupKeyHex, "hex")];
  const [record] = await getProgramDerivedAddress({ programAddress: address(REGISTRY), seeds });
  const found = await accountData(record);
  if (found === null) throw new Error("the registry record does not exist");
  const { data } = found;
  const keys = data[34] === 1 ? 68 : 35;
  const end = keys + 32 + 33 + 1;
  return {
    record,
    registryOwned: found.owner === REGISTRY,
    size: data.length,
    rent: String(found.lamports),
    tag: data[0],
    ownerIsGroup: hex(data.subarray(1, 33)) === groupKeyHex,
    ownerP256Absent: data[34] === 0,
    nullifierEqualsSoldone: hex(data.subarray(keys, keys + 32)) === nullifierPk,
    viewingEqualsSoldone: hex(data.subarray(keys + 32, keys + 65)) === viewingPk,
    mergingEnabled: data[keys + 65] === 1,
    zerosAfter: data.subarray(end).every((byte) => byte === 0),
  };
}

/** The nonce account of the group: owned by System, 80 bytes, version 1, the group as authority. */
export async function verifyNonceAccount(account, groupKeyHex) {
  const found = await accountData(account);
  if (found === null) throw new Error("the nonce account does not exist");
  const { data } = found;
  return {
    account,
    systemOwned: found.owner === SYSTEM,
    size: data.length,
    initialised: data.readUInt32LE(0) === 1 && data.readUInt32LE(4) === 1,
    authorityIsGroup: hex(data.subarray(8, 40)) === groupKeyHex,
    nonce: hex(data.subarray(40, 72)),
    rent: String(found.lamports),
  };
}
