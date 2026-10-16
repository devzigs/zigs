// Pure helpers of the Worker commands prepare and reprove. No import, so Node tests load this file
// as it is. They cut the pool instruction out of a message, read it, compute its commitment, and
// turn the body of the prover call into the plaintext plan of ZOLANA.md section 5 (the Plan of the
// checker, not trusted by it).

const ZERO_KEY = "0".repeat(64);
// The asset field of SOL in the prover body: the hash of the 32 zero bytes of its mint (the SDK
// hashBytes of the mint address, as in the UTXO commitment). It is not the asset id 1.
const SOL_ASSET = 0x2098f5fb9e239eab3ceac3f27b81e481dc3124d55ffed523a839ee8446b64864n;
const TAG_TRANSACT = 16;

export const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** The data of the one instruction of a version 1 message that the pool program runs. */
export function cutTransact(message, pool) {
  if (message.instructionHeaders === undefined) throw new Error("the message is not version 1");
  const keys = message.staticAccounts;
  const found = message.instructionHeaders
    .map((head, i) => ({ program: keys[head.programAccountIndex], at: i }))
    .filter((ix) => ix.program === pool);
  if (found.length !== 1) throw new Error(`the message has ${found.length} pool instructions`);
  return Uint8Array.from(message.instructionPayloads[found[0].at].instructionData);
}

function cursor(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = 0;
  const take = (n) => {
    if (at + n > data.length) throw new Error("the transact data ends inside a field");
    at += n;
    return data.subarray(at - n, at);
  };
  const read = (n, get) => {
    const start = at;
    take(n);
    return get(start);
  };
  return {
    take,
    done: () => at === data.length,
    rest: () => data.length - at,
    u8: () => take(1)[0],
    u16: () => read(2, (s) => view.getUint16(s, true)),
    u64: () => read(8, (s) => view.getBigUint64(s, true)),
  };
}

/** One output: its hash, its owner tag (inline: the 32 byte tag; account: null) and its data. */
function readOutput(c) {
  const utxoHash = hex(c.take(32));
  const tag = c.u8() === 0 ? hex(c.take(32)) : (c.u8(), null);
  const data = c.u8() === 1 ? hex(c.take(c.u16())) : null;
  return { utxoHash, tag, data };
}

function skipTransfers(c) {
  for (let n = c.u8(); n > 0; n--) {
    const kind = c.u8();
    c.u64();
    if (kind >= 2) c.u8();
  }
}

function skipMessages(c) {
  for (let n = c.u8(); n > 0; n--) {
    c.take(32);
    c.take(c.u16());
  }
}

/**
 * Reads the data: the head, the outputs (`published`), `private_tx_hash` and the length of the
 * external-data prefix (`prefixLength`: the bytes before `private_tx_hash`, which the commitment
 * hashes), and counts the rest. The parse must end on the last byte.
 */
export function parseTransact(data) {
  const c = cursor(data);
  if (c.u8() !== TAG_TRANSACT) throw new Error("not a transact instruction");
  const expiry = c.u64();
  const txViewingPk = hex(c.take(33));
  const salt = Uint8Array.from(c.take(16));
  skipTransfers(c);
  for (let i = 0; i < 2; i++) if (c.u8() === 1) c.take(32);
  const outputs = c.u8();
  const published = Array.from({ length: outputs }, () => readOutput(c));
  skipMessages(c);
  const prefixLength = data.length - c.rest();
  const privateTxHash = hex(c.take(32));
  if (c.u16() !== 0) throw new Error("the circuit is not the default ring");
  c.take(3 + 192);
  const inputs = c.u8();
  // Each input is a nullifier (32 bytes) and the index of its tree.
  const nullifiers = c.take(33 * inputs);
  c.take(4 * c.u8());
  if (!c.done()) throw new Error("bytes follow the transact data");
  const firstNullifier = inputs > 0 ? hex(nullifiers.subarray(0, 32)) : "";
  return {
    expiry,
    salt,
    outputs,
    inputs,
    firstNullifier,
    txViewingPk,
    published,
    privateTxHash,
    prefixLength,
  };
}

const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));

/**
 * The commitment of `transact` data (hex): SHA-256(private_tx_hash || external-data hash), the
 * external-data hash being SHA-256 of the prefix with its first byte cleared (a BN254 field), as
 * the approvals program computes it (ZOLANA.md 7.2). The approval of the group binds this value.
 */
export async function commitmentOf(data) {
  const { prefixLength } = parseTransact(data);
  const external = await sha256(data.subarray(0, prefixLength));
  external[0] = 0;
  const preimage = new Uint8Array(64);
  preimage.set(data.subarray(prefixLength, prefixLength + 32));
  preimage.set(external, 32);
  return hex(await sha256(preimage));
}

const ROLES = ["payee", "change", "dummy"];

/**
 * The plan of a proposal (the wire form of web/sol/intent.js planHex, hex): the root seed and each
 * output slot with its role, mint, amount and blinding. The whole text must be read.
 */
export function parsePlan(text) {
  if (typeof text !== "string" || !/^([0-9a-f]{2})+$/.test(text)) throw new Error("bad plan");
  const c = cursor(Uint8Array.from(text.match(/../g), (h) => parseInt(h, 16)));
  const blindingSeed = hex(c.take(32));
  const outputs = Array.from({ length: c.u8() }, () => {
    const role = ROLES[c.u8()];
    if (role === undefined) throw new Error("the plan has an unknown output role");
    return { role, mint: hex(c.take(32)), amount: c.u64().toString(), blinding: hex(c.take(32)) };
  });
  if (!c.done()) throw new Error("bytes follow the plan");
  return { blindingSeed, outputs };
}

/** A prover field "0x1f..." as 32 big-endian bytes in hex. */
export function field32(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{1,64}$/.test(value)) {
    throw new Error("a prover field is not a hex value of at most 32 bytes");
  }
  return value.slice(2).padStart(64, "0");
}

const need = (obj, name) => {
  if (obj === null || typeof obj !== "object" || !(name in obj)) {
    throw new Error(`the prover body has no field ${name}`);
  }
  return obj[name];
};

const isDummy = (slot) => BigInt(need(slot, "isDummy")) !== 0n;

function slotUtxo(slot) {
  const utxo = need(slot, "utxo");
  const amount = BigInt(need(utxo, "amount"));
  const blinding = field32(need(utxo, "blinding"));
  if (isDummy(slot)) {
    if (amount !== 0n) throw new Error("a dummy slot has an amount");
    return { mint: ZERO_KEY, amount: "0", blinding };
  }
  if (BigInt(need(utxo, "asset")) !== SOL_ASSET) {
    throw new Error("only SOL is supported: an asset field is not that of SOL");
  }
  return { mint: ZERO_KEY, amount: amount.toString(), blinding };
}

/**
 * The plan of a transfer from the body of the prover call: the root blinding seed, the real
 * inputs (the spent UTXOs, in the order of the instruction) and every output slot with its role.
 * An output with the owner of the first input is change. A zero output is a dummy.
 */
export function planFromProve(body) {
  const slots = need(body, "inputs").filter((slot) => !isDummy(slot));
  if (slots.length === 0) throw new Error("the prover body spends no input");
  const owner = need(slots[0], "ownerPkHash");
  const role = (slot) => {
    if (isDummy(slot)) return "dummy";
    return need(slot, "ownerPkHash") === owner ? "change" : "payee";
  };
  return {
    blindingSeed: field32(need(body, "blindingSeed")),
    inputs: slots.map(slotUtxo),
    outputs: need(body, "outputs").map((slot) => ({ role: role(slot), ...slotUtxo(slot) })),
  };
}
