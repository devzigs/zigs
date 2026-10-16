// The vectors of the TS SDK (wasm-sol/vectors/ts) laid out for the page code: the `transact` data
// as the program reads it, and the intent, the plan and the snapshot as the page writes them.
// Shared with sol-transfer.mjs and sol-pay.mjs.
import fs from "node:fs";
import { ZERO_KEY, hexOf, intentHex, planHex } from "../sol/intent.js";

export const NONCE = "09".repeat(32);
export const EXPIRY = 1_800_000_000n;
export const NOW = EXPIRY - 3600n;
export const step = (name) => console.log("ok  " + name);
export const vector = (name) =>
  JSON.parse(fs.readFileSync(new URL(`../../wasm-sol/vectors/ts/${name}.json`, import.meta.url)));

const u16 = (n) => hexOf(new Uint8Array(new Uint16Array([n]).buffer));
const u64 = (n) => hexOf(new Uint8Array(new BigUint64Array([BigInt(n)]).buffer));
const byte = (n) => n.toString(16).padStart(2, "0");

/** The `transact` data as the program reads it (wasm-sol/src/transact.rs, `Transact::write`). */
export function transactHex(v, expiry = EXPIRY) {
  const owner = (o) =>
    o.ownerTag.kind === "account" ? "01" + byte(o.ownerTag.index) : "00" + o.ownerTag.value;
  const output = (o) => o.utxoHash + owner(o) + "01" + u16(o.data.length / 2) + o.data;
  return (
    "10" +
    u64(expiry) +
    v.txViewingPk +
    v.salt +
    "00" +
    "00" +
    "00" +
    byte(v.outputs.length) +
    v.outputs.map(output).join("") +
    "00" +
    "00".repeat(31) +
    "4d" + // the private transaction hash: 77, unread by the checker
    "0000" +
    byte(v.inputs.length) +
    byte(v.outputs.length) +
    "03" +
    "00".repeat(192) +
    byte(v.inputs.length) +
    v.inputs.map((i) => i.nullifier + "00").join("") +
    "01" +
    "00000000"
  );
}

/**
 * What the page writes for the vector: the fields of the proposal part and the snapshot. `payer`
 * is the fee key (hex) that the TS SDK used as the sponsor of the vector.
 */
export function pageSide(v, change = {}) {
  const intent = intentHex("transfer", {
    nonce: NONCE,
    expiry: EXPIRY,
    inputs: v.inputs.length,
    outputs: v.outputs.length,
    payee: v.payee.address,
    amount: v.outputs.find((o) => o.role === "payee").amount,
    ...change,
  });
  const plan = planHex({
    blindingSeed: v.blindingSeed,
    outputs: v.outputs.map((o) => ({
      role: o.role,
      mint: ZERO_KEY,
      amount: o.amount,
      blinding: o.blinding,
    })),
  });
  const spend = {
    fee: "0",
    inputs: v.inputs.map((i) => ({ mint: ZERO_KEY, amount: i.amount, blinding: i.blinding })),
    salts: [],
  };
  const roles = { nullifier_secret: v.group.nullifierSecret, viewing_sk: v.group.viewingSk };
  const { key: groupKey, nullifierPk, viewingPk } = v.group;
  const done = { groupKey, nullifierPk, viewingPk };
  return {
    ss: { intent, plan },
    spend,
    roles,
    done,
    payer: v.group.payer,
    transact: transactHex(v),
  };
}
