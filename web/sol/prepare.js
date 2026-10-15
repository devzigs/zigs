// Pure helpers of the Worker command prepare. No import, so Node tests load this file as it is.
// They cut the pool instruction out of a message, read it, and turn the body of the prover call
// into the plaintext plan of ZOLANA.md section 5 (the Plan of the checker, not trusted by it).

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
    u8: () => take(1)[0],
    u16: () => read(2, (s) => view.getUint16(s, true)),
    u64: () => read(8, (s) => view.getBigUint64(s, true)),
  };
}

function skipOutput(c) {
  c.take(32);
  if (c.u8() === 0) c.take(32);
  else c.u8();
  if (c.u8() === 1) c.take(c.u16());
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

/** Reads the head of the data and counts the rest. The parse must end on the last byte. */
export function parseTransact(data) {
  const c = cursor(data);
  if (c.u8() !== TAG_TRANSACT) throw new Error("not a transact instruction");
  const expiry = c.u64();
  c.take(33);
  const salt = Uint8Array.from(c.take(16));
  skipTransfers(c);
  for (let i = 0; i < 2; i++) if (c.u8() === 1) c.take(32);
  const outputs = c.u8();
  for (let n = outputs; n > 0; n--) skipOutput(c);
  skipMessages(c);
  c.take(32);
  if (c.u16() !== 0) throw new Error("the circuit is not the default ring");
  c.take(3 + 192);
  const inputs = c.u8();
  // Each input is a nullifier (32 bytes) and the index of its tree.
  const nullifiers = c.take(33 * inputs);
  c.take(4 * c.u8());
  if (!c.done()) throw new Error("bytes follow the transact data");
  const firstNullifier = inputs > 0 ? hex(nullifiers.subarray(0, 32)) : "";
  return { expiry, salt, outputs, inputs, firstNullifier };
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
