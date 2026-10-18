// Read-only checks of the approvals program on Devnet (ZOLANA.md 7.2), from the raw transactions
// and accounts, not from the code of the app: the proposal address of version 5 (kit), the group
// signature over the approval digest (Node's own Ed25519), the closed account, the settlement
// accounts of a withdrawal and the deployed ELF. Nothing here signs or sends.
import { createHash } from "node:crypto";
import {
  address,
  getCompiledTransactionMessageDecoder,
  getProgramDerivedAddress,
  getTransactionDecoder,
} from "@solana/kit";
import { rpcCall, sleep } from "./rpc.mjs";
import { addressOfKey, keyOfAddress, verifiesUnder } from "./verify-chain.mjs";

export const PROGRAM = "5PHZEHBMaYbFL9SFmMyP8kUayh3TFEyq2dvEYY3UGjkL";
const ED25519 = "Ed25519SigVerify111111111111111111111111111";
const GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
// The SOL interface of the Devnet pool (`["sol_interface", 0]` of the pool).
const SOL_INTERFACE = "2iAazE9tAWcUJhNhfscRzX17Gb32Km9jJYZLGy1AnkVP";
// The version 5 ELF of sol-program/build.sh: its bytes after the 45-byte header of ProgramData.
const ELF_V5 = "b4bad24c6ae7cf2455b52780f78e35573f014ab3bc618fcbb49772b06c0d6eac";
const ELF_BYTES = 53_144;

/** Waits until the signature is confirmed. A failure on chain throws. */
export async function confirmed(signature) {
  for (let i = 0; i < 60; i += 1) {
    const { value } = await rpcCall("getSignatureStatuses", [[signature]]);
    if (value[0]?.err) throw new Error(`failed on chain: ${JSON.stringify(value[0].err)}`);
    if (["confirmed", "finalized"].includes(value[0]?.confirmationStatus)) return;
    await sleep(1500);
  }
  throw new Error("not confirmed: " + signature);
}

/** The raw transaction: the decoded transaction and message, the meta and the slot. */
export async function txOf(signature) {
  const options = { encoding: "base64", commitment: "confirmed" };
  options.maxSupportedTransactionVersion = 1;
  for (let i = 0; i < 20; i += 1) {
    const reply = await rpcCall("getTransaction", [signature, options]);
    if (reply !== null) {
      const tx = getTransactionDecoder().decode(Buffer.from(reply.transaction[0], "base64"));
      const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
      return { tx, message, meta: reply.meta, slot: reply.slot };
    }
    await sleep(1500);
  }
  throw new Error("transaction not found: " + signature);
}

/** The instructions of a decoded message (legacy, v0 or v1): program, accounts and data. */
function ixsOf(message) {
  const keys = message.staticAccounts;
  if (message.instructionHeaders) {
    return message.instructionHeaders.map((head, i) => ({
      program: keys[head.programAccountIndex],
      data: Buffer.from(message.instructionPayloads[i].instructionData),
      accounts: [...(message.instructionPayloads[i].instructionAccountIndices ?? [])].map(
        (k) => keys[k],
      ),
    }));
  }
  return message.instructions.map((ix) => ({
    program: keys[ix.programAddressIndex],
    data: Buffer.from(ix.data ?? []),
    accounts: (ix.accountIndices ?? []).map((k) => keys[k]),
  }));
}

const accountOf = async (account) =>
  (await rpcCall("getAccountInfo", [account, { encoding: "base64", commitment: "confirmed" }]))
    .value;

/** The digest that the group signs, from the body of the create (ZOLANA.md 7.2). */
const digestOf = (proposal, body) =>
  createHash("sha256")
    .update("Zigs_SolApproval_v1")
    .update(Buffer.from(keyOfAddress(GENESIS), "hex"))
    .update(Buffer.from(keyOfAddress(PROGRAM), "hex"))
    .update(Buffer.from(keyOfAddress(proposal), "hex"))
    .update(body)
    .digest();

/** True when the proposal account exists and the program owns it. */
export const proposalOpen = async (proposal) => (await accountOf(proposal))?.owner === PROGRAM;

/** The create of a proposal: its signature, slot, payer and body. Checks the v5 address. */
async function createOf(proposal, groupKey) {
  const list = await rpcCall("getSignaturesForAddress", [proposal, { commitment: "confirmed" }]);
  const signature = list.at(-1).signature;
  const made = await txOf(signature);
  const ix = ixsOf(made.message).find((one) => one.program === PROGRAM);
  if (ix?.data[0] !== 0) throw new Error("the first transaction of the account is no create");
  const body = ix.data.subarray(1);
  const [v5] = await getProgramDerivedAddress({
    programAddress: address(PROGRAM),
    seeds: [Buffer.from("proposed_transaction"), Buffer.from(groupKey, "hex"),
      body.subarray(0, 32), createHash("sha256").update(body).digest()],
  });
  if (v5 !== proposal) throw new Error("the proposal address is not the one of version 5");
  return { signature, slot: made.slot, payer: made.message.staticAccounts[0], body };
}

/** The execute: the Ed25519 instruction just before it holds the group signature. */
function approvalOf(ixs, proposal, body, groupKey) {
  const at = ixs.findIndex((ix) => ix.program === PROGRAM);
  if (ixs[at]?.data[0] !== 1) throw new Error("no execute instruction");
  if (ixs[at - 1]?.program !== ED25519) throw new Error("no Ed25519 instruction before it");
  const ed = ixs[at - 1].data;
  const [key, sig, digest] = [ed.subarray(16, 48), ed.subarray(48, 112), ed.subarray(112, 144)];
  if (key.toString("hex") !== groupKey) throw new Error("the approval is not of the group key");
  if (!digest.equals(digestOf(proposal, body))) throw new Error("the digest is not of the body");
  if (!verifiesUnder(addressOfKey(groupKey), digest, sig)) throw new Error("bad group signature");
  return { execute: ixs[at], digest: digest.toString("hex") };
}

/**
 * The create and the execute of one payment, read from the chain. `fees` maps each seat to its
 * fee address. Throws when a check fails. Returns public facts only.
 */
export async function paymentFacts(proposal, executeSig, groupKey, fees) {
  const seatOf = (key) => Object.keys(fees).find((s) => fees[s] === key) ?? "none";
  const create = await createOf(proposal, groupKey);
  const exe = await txOf(executeSig);
  const { digest } = approvalOf(ixsOf(exe.message), proposal, create.body, groupKey);
  if (exe.meta.err !== null) throw new Error("the execute failed on chain");
  if ((await accountOf(proposal)) !== null) throw new Error("the proposal account is not closed");
  const rentRecipient = addressOfKey(create.body.subarray(72, 104).toString("hex"));
  return {
    create: { signature: create.signature, slot: create.slot, payerSeat: seatOf(create.payer) },
    execute: {
      signature: executeSig,
      slot: exe.slot,
      fee: exe.meta.fee,
      computeUnits: exe.meta.computeUnitsConsumed,
      payerSeat: seatOf(exe.message.staticAccounts[0]),
    },
    bodyBytes: create.body.length,
    rentRecipientSeat: seatOf(rentRecipient),
    digest,
  };
}

/** The execute of a withdrawal ends with the owner PDA, the SOL interface and the recipient. */
export async function settlementFacts(executeSig, recipient) {
  const ix = ixsOf((await txOf(executeSig)).message).find((one) => one.program === PROGRAM);
  const tail = ix.accounts.slice(-3);
  const want = [ix.accounts[2], SOL_INTERFACE, recipient];
  if (tail.join() !== want.join()) throw new Error("the settlement accounts of the leg");
  return { accounts: tail, count: ix.accounts.length };
}

/** The payer of a transaction (its first account). */
export const payerOf = async (signature) => (await txOf(signature)).message.staticAccounts[0];

/** Devnet runs the version 5 ELF: else nothing may be sent. */
export async function deployedElf() {
  const parsed = await rpcCall("getAccountInfo", [PROGRAM, { encoding: "jsonParsed" }]);
  const programData = parsed.value.data.parsed.info.programData;
  const raw = await rpcCall("getAccountInfo", [programData, { encoding: "base64" }]);
  const data = Buffer.from(raw.value.data[0], "base64");
  const sha = createHash("sha256").update(data.subarray(45, 45 + ELF_BYTES)).digest("hex");
  if (sha !== ELF_V5) throw new Error("Devnet does not run the version 5 ELF");
  return { sha256: sha, deploySlot: String(data.readBigUInt64LE(4)), programData };
}
