// The wire forms that the Solana wasm takes (wasm-sol/src/intent.rs, plan.rs, snapshot.rs,
// pins.rs) for four intents: create the nonce account, register, add SOL (the intent `shield`)
// and transfer. The page
// writes the intent bytes, the wasm compiles the message from them and checks it again on every
// approving device, so a wrong byte here makes a refusal and never a bad signature.
export const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
export const bytesOf = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

const isHex = (n) => (v) => typeof v === "string" && new RegExp(`^[0-9a-f]{${n * 2}}$`).test(v);
const KEY = isHex(32);
const le64 = (n) => hexOf(new Uint8Array(new BigUint64Array([BigInt(n)]).buffer));
const le16 = (n) => hexOf(new Uint8Array(new Uint16Array([n]).buffer));
const u8 = (n) => n.toString(16).padStart(2, "0");
const le64Of = (hex) => BigInt("0x" + (hex.match(/../g) ?? []).reverse().join(""));
/** The mint of SOL in the wire forms: the all zero key (the SDK writes it as 32 ones). */
export const ZERO_KEY = "00".repeat(32);
/** True for the hex text of a full shielded address (99 bytes). */
export const isAddress = isHex(99);

/** Lamports in one SOL, and the base fee of one signature. */
export const LAMPORTS = 1_000_000_000n;
export const BASE_FEE = 5000n;
/** The rent of the nonce account and of a registry record on Devnet (ZOLANA.md 6.3 and 6.4). */
export const NONCE_RENT = 1_056_640n;
export const RECORD_RENT = 1_330_960n;
const NONCE_SEED = "zigs-nonce-1";

/**
 * The intent bytes (hex) of a kind: createNonce, register, shield (Add SOL: a recent blockhash
 * and no nonce, the payer signs alone) or transfer.
 */
export function intentHex(kind, f) {
  const spend = () => f.nonce + le64(f.expiry) + u8(f.inputs) + u8(f.outputs);
  const fields = {
    createNonce: () => "00" + f.blockhash,
    register: () => "01" + f.nonce + f.nullifierPk + f.viewingPk,
    shield: () => "02" + f.blockhash + le64(f.amount),
    transfer: () => "03" + spend() + checkedAddress(f.payee) + ZERO_KEY + le64(f.amount),
  };
  if (!Object.hasOwn(fields, kind)) throw new Error("Unknown Solana intent: " + kind);
  return fields[kind]();
}

function checkedAddress(payee) {
  if (!isAddress(payee)) throw new Error("The payee is not a full shielded address.");
  return payee;
}

const READERS = {
  0: (h) => ({ kind: "createNonce", blockhash: h.slice(2, 66) }),
  1: (h) => ({
    kind: "register",
    nonce: h.slice(2, 66),
    nullifierPk: h.slice(66, 130),
    viewingPk: h.slice(130, 196),
  }),
  2: (h) => ({ kind: "shield", blockhash: h.slice(2, 66), amount: le64Of(h.slice(66, 82)) }),
  3: (h) => ({
    kind: "transfer",
    nonce: h.slice(2, 66),
    expiry: le64Of(h.slice(66, 82)),
    inputs: parseInt(h.slice(82, 84), 16),
    outputs: parseInt(h.slice(84, 86), 16),
    payee: h.slice(86, 284),
    mint: h.slice(284, 348),
    amount: le64Of(h.slice(348, 364)),
  }),
};
const LENGTHS = { 0: 33, 1: 98, 2: 41, 3: 182 };

/** The values of an intent (hex) of the four kinds, or null for any other bytes. */
export function decodeIntent(hex) {
  if (typeof hex !== "string" || !/^([0-9a-f]{2})+$/.test(hex)) return null;
  const tag = parseInt(hex.slice(0, 2), 16);
  if (!Object.hasOwn(READERS, tag) || hex.length !== LENGTHS[tag] * 2) return null;
  return READERS[tag](hex);
}

/**
 * The 129 pin bytes (hex): the group key, nullifier_pk and viewing_pk of the agreed soldone, and
 * the payer of the proposal (a fee key, see fee.js).
 */
export function pinsHex(done, payer) {
  const checks = [KEY(done?.groupKey), KEY(done?.nullifierPk), isHex(33)(done?.viewingPk)];
  if (!checks.every(Boolean))
    throw new Error("The Solana keys of this wallet are not well formed.");
  if (!KEY(payer)) throw new Error("The fee key of the payer is not well formed.");
  return done.groupKey + done.nullifierPk + done.viewingPk + payer;
}

const ROLE = { payee: 0, change: 1, dummy: 2 };

/**
 * The plaintext outputs of a spend (hex): the blinding seed, the count, then for each output slot
 * its role, mint, amount and blinding. The proposer writes it, and the checker trusts none of it.
 */
export function planHex(plan) {
  const slot = (o) => {
    if (!Object.hasOwn(ROLE, o.role)) throw new Error("Unknown output role: " + o.role);
    return u8(ROLE[o.role]) + o.mint + le64(o.amount) + o.blinding;
  };
  return plan.blindingSeed + u8(plan.outputs.length) + plan.outputs.map(slot).join("");
}

/** The bytes that the wasm takes as `intent`: the intent and, for a transfer, its plan. */
export const proposalHex = (ss) =>
  ss.intent + (decodeIntent(ss.intent)?.kind === "transfer" ? (ss.plan ?? "") : "");

/**
 * The snapshot of a device (hex): both role secrets, the insertion fee of the tree, the inputs
 * that the proposal spends and the (first nullifier, salt) pairs of the earlier proposals. With no
 * `spend` it holds no input and no pair, as the three intents without a plan need.
 */
export function snapshotHex(roles, spend = {}) {
  const { fee = 0n, inputs = [], salts = [] } = spend;
  const input = (u) => u.mint + le64(u.amount) + u.blinding;
  return (
    roles.nullifier_secret +
    roles.viewing_sk +
    le64(fee) +
    u8(inputs.length) +
    inputs.map(input).join("") +
    le16(salts.length) +
    salts.map((p) => p.first + p.salt).join("")
  );
}

/** The address (hex) of the nonce account of a group key: the account made with a seed. */
export async function nonceAccountHex(groupKey) {
  const seed = new TextEncoder().encode(NONCE_SEED);
  const input = Uint8Array.from([...bytesOf(groupKey), ...seed, ...new Uint8Array(32)]);
  return hexOf(new Uint8Array(await crypto.subtle.digest("SHA-256", input)));
}

/** The fields of the verdict of an accepted transfer: payee, amounts, expiry and tree fee. */
export function readVerdict(verdict) {
  const out = { paid: [], change: [] };
  for (const line of verdict.split("\n").slice(1)) {
    const [name, a, b, c] = line.split(" ");
    if (name === "payee") out.payee = { tag: a, ownerHash: b, viewingPk: c };
    else if (name === "paid" || name === "change") out[name].push({ mint: a, amount: BigInt(b) });
    else if (name === "expiry") out.expiry = BigInt(a);
    else if (name === "tree_fee") out.treeFee = BigInt(a);
  }
  return out;
}

/**
 * What a v1 message says outside its instructions, for the approval screen: the lifetime, the
 * priority fee, the compute limit and the number of signatures. The checker has accepted these
 * bytes, so this only reads them. Layout: wasm-sol/src/v1.rs.
 */
export function describeMessage(message) {
  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
  const mask = view.getUint32(4, true);
  let at = 42 + 32 * message[41];
  const read = (bit, size) => {
    if (!(mask & bit)) return null;
    const value = size === 8 ? view.getBigUint64(at, true) : BigInt(view.getUint32(at, true));
    at += size;
    return value;
  };
  const priority = read(0b11, 8),
    units = read(0b100, 4);
  return {
    signatures: message[1],
    lifetime: hexOf(message.subarray(8, 40)),
    priorityFee: priority ?? 0n,
    computeUnits: units,
  };
}

/** The lamports of a SOL amount typed as decimal text (up to 9 decimals), or null. */
export function lamportsOf(text) {
  const m = /^(\d{1,6})(?:\.(\d{1,9}))?$/.exec(String(text).trim());
  if (!m) return null;
  const lamports = BigInt(m[1]) * LAMPORTS + BigInt((m[2] ?? "").padEnd(9, "0"));
  return lamports > 0n ? lamports : null;
}

/**
 * The base64 text of a signed v1 transaction: the message, then its signatures in the order of its
 * signers: the payer first, then the group key (the payer alone for Add SOL).
 */
export function wireBase64(message, signature) {
  return btoa(String.fromCharCode(...message, ...signature));
}
