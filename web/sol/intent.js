// The wire forms that the Solana wasm takes (wasm-sol/src/intent.rs, plan.rs, snapshot.rs,
// pins.rs, pay.rs). The group pays with approvals of the approvals program (ZOLANA.md 7.2): the
// intent `approve` (a private payment that the group approves once), and the two messages that a
// fee key signs alone, `propose` (the create message of the proposal account) and `execute`. Add
// SOL is the intent `shield`. The move of the beta funds to the PDA is the one nonce payment left:
// `createNonce` and `transfer`. The page writes the intent bytes, the wasm compiles the messages
// from them and checks them again on every approving device, so a wrong byte here makes a refusal
// and never a bad signature.
export const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
export const bytesOf = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
export const bytesOfBase64 = (text) => Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));

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
/** The rent of the nonce account on Devnet (ZOLANA.md 6.3), for the move of the beta funds. */
export const NONCE_RENT = 1_056_640n;
const NONCE_SEED = "zigs-nonce-1";
/** The bytes of a proposal account: kind, bump and a body with one abort authority. */
export const PROPOSAL_SPACE = 2 + 32 + 32 + 8 + 32 + 1 + 32;
/** The fee of an execute: the signature of the payer and the Ed25519 verification of the group. */
export const EXECUTE_FEE = 2n * BASE_FEE;

/**
 * The intent bytes (hex) of a kind: createNonce and transfer (the move of the beta funds, with a
 * nonce), shield (Add SOL: a recent blockhash, the payer signs alone), approve (a payment of the
 * program design), propose (its create message) and execute.
 */
export function intentHex(kind, f) {
  const spend = () => f.nonce + le64(f.expiry) + u8(f.inputs) + u8(f.outputs);
  const counts = () => le64(f.expiry) + u8(f.inputs) + u8(f.outputs);
  const pay = () => counts() + checkedAddress(f.payee) + ZERO_KEY + le64(f.amount);
  const fields = {
    createNonce: () => "00" + f.blockhash,
    shield: () => "02" + f.blockhash + le64(f.amount),
    transfer: () => "03" + spend() + checkedAddress(f.payee) + ZERO_KEY + le64(f.amount),
    propose: () => "06" + pay() + f.commitment + f.blockhash,
    execute: () => "07" + le64(f.expiry) + f.rentRecipient + f.signature + f.blockhash,
    approve: () => "08" + pay(),
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
  8: (h) => ({
    kind: "approve",
    expiry: le64Of(h.slice(2, 18)),
    inputs: parseInt(h.slice(18, 20), 16),
    outputs: parseInt(h.slice(20, 22), 16),
    payee: h.slice(22, 220),
    mint: h.slice(220, 284),
    amount: le64Of(h.slice(284, 300)),
  }),
};
const LENGTHS = { 0: 33, 2: 41, 3: 182, 8: 150 };

/** The values of an intent (hex) that a session or Add SOL holds, or null for any other bytes. */
export function decodeIntent(hex) {
  if (typeof hex !== "string" || !/^([0-9a-f]{2})+$/.test(hex)) return null;
  const tag = parseInt(hex.slice(0, 2), 16);
  if (!Object.hasOwn(READERS, tag) || hex.length !== LENGTHS[tag] * 2) return null;
  return READERS[tag](hex);
}

/**
 * The 161 pin bytes (hex): the group key, nullifier_pk and viewing_pk of the agreed soldone, the
 * payer of the proposal (a fee key, see fee.js) and the nullifier_pk of the PDA identity.
 */
export function pinsHex(done, payer) {
  const checks = [KEY(done?.groupKey), KEY(done?.nullifierPk), isHex(33)(done?.viewingPk)];
  if (!checks.every(Boolean) || !KEY(done?.pdaNullifierPk))
    throw new Error("The Solana keys of this wallet are not well formed.");
  if (!KEY(payer)) throw new Error("The fee key of the payer is not well formed.");
  return done.groupKey + done.nullifierPk + done.viewingPk + payer + done.pdaNullifierPk;
}

/**
 * What the device saw for an approval (wasm-sol/src/pay.rs `Seen`, hex): the proposal account that
 * it read ({ owner, data } as hex, or null when there is none) and the (commitment, SHA-256 of the
 * body) of every payment that its seats approved before.
 */
export function seenHex(account, approved = []) {
  const head = account ? "01" + account.owner + le16(account.data.length / 2) + account.data : "00";
  return head + le16(approved.length) + approved.map((a) => a.commitment + a.body).join("");
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

/**
 * The bytes that the wasm takes as `intent`: the intent, the plan of a transfer or a payment, and
 * the `transact` data of the first proof of a payment (its length as u16, then the bytes).
 */
export function proposalHex(ss) {
  const kind = decodeIntent(ss.intent)?.kind;
  if (kind === "approve") return paymentHex(ss.intent, ss);
  return ss.intent + (kind === "transfer" ? (ss.plan ?? "") : "");
}

/** The wire form of a payment intent (approve or propose) with the plan and the transact data. */
export function paymentHex(intent, { plan, transact }) {
  return intent + plan + le16(transact.length / 2) + transact;
}

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

const VERDICT_KEYS = ["commitment", "proposal", "digest", "body"];

/**
 * The fields of the verdict of an accepted transfer or payment: payee, amounts, expiry and tree
 * fee, and for a payment its commitment, proposal account, digest and body (hex).
 */
export function readVerdict(verdict) {
  const out = { paid: [], change: [] };
  for (const line of verdict.split("\n").slice(1)) {
    const [name, a, b, c] = line.split(" ");
    if (name === "payee") out.payee = { tag: a, ownerHash: b, viewingPk: c };
    else if (name === "paid" || name === "change") out[name].push({ mint: a, amount: BigInt(b) });
    else if (name === "expiry") out.expiry = BigInt(a);
    else if (name === "tree_fee") out.treeFee = BigInt(a);
    else if (VERDICT_KEYS.includes(name)) out[name] = a;
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
