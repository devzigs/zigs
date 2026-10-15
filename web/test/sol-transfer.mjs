// The wire forms of a private payment that the page writes (web/sol/intent.js), against the real
// checker. The fixtures are the vectors that the TS SDK built with fixed test keys
// (wasm-sol/vectors/ts, the same files as tests/ts_vectors.rs): the group, the payee, the inputs,
// the outputs with their hashes and ciphertexts. This test lays the instruction data out as the
// program does, and lets the page code write the intent, the plan, the snapshot and the screen. The
// real wasm must compile the message, and accept it on the snapshot of the device, and refuse
// each change: a wrong payee, a wrong amount, an input that the device does not hold, and a
// (first nullifier, salt) pair that the device used before.
// Run: node web/test/sol-transfer.mjs   (Node 24)
import assert from "node:assert/strict";
import { base58 } from "../sol/docs.js";
import {
  ZERO_KEY,
  bytesOf,
  decodeIntent,
  intentHex,
  pinsHex,
  planHex,
  proposalHex,
  readVerdict,
  snapshotHex,
} from "../sol/intent.js";
import { transferRows } from "../sol/payview.js";
import * as W from "../sol/wasm/sol_wasm.js";
import "./sol-rig.mjs"; // starts the wasm engines and stubs the page
import { EXPIRY, NONCE, NOW, pageSide, step, vector } from "./sol-vector.mjs";

function verdictOf(side, { spend = side.spend, ss = side.ss, message } = {}) {
  const pins = bytesOf(pinsHex(side.done));
  const made = message ?? W.compile_message(bytesOf(proposalHex(ss)), pins, bytesOf(side.transact));
  const snapshot = bytesOf(snapshotHex(side.roles, spend));
  const text = W.check_message(made, bytesOf(proposalHex(ss)), pins, snapshot, NOW);
  return { text, message: made };
}

// ── The intent: the fields round trip, and the wire form has the length of the checker ──
{
  const side = pageSide(vector("transfer-sol"));
  const intent = decodeIntent(side.ss.intent);
  assert.equal(intent.kind, "transfer");
  assert.equal(intent.nonce, NONCE);
  assert.equal(intent.expiry, EXPIRY);
  assert.equal([intent.inputs, intent.outputs].join(), "1,2");
  assert.equal(intent.payee, vector("transfer-sol").payee.address);
  assert.equal(intent.mint, ZERO_KEY);
  assert.equal(intent.amount, 40n);
  assert.equal(side.ss.intent.length, 182 * 2);
  const big = 0x0102030405060708n;
  const wide = decodeIntent(intentHex("transfer", { ...intent, amount: big }));
  assert.equal(wide.amount, big, "all eight bytes of the amount are read");
  assert.throws(
    () =>
      intentHex("transfer", {
        nonce: NONCE,
        expiry: 1n,
        inputs: 1,
        outputs: 2,
        payee: "ab",
        amount: 1n,
      }),
    /full shielded address/,
  );
  assert.equal(decodeIntent(side.ss.intent + "00"), null, "a byte too many has no screen");
  assert.equal(proposalHex({ intent: "00" + "ab".repeat(32), plan: "ff" }).length, 66, "no plan");
  assert.throws(() => planHex({ blindingSeed: "00", outputs: [{ role: "x" }] }), /Unknown output/);
}
step("the intent and the plan have the wire form of the checker");

// ── The real wasm accepts a payment that the page encoded ──
for (const name of ["transfer-sol", "transfer-everything-with-dummy"]) {
  const v = vector(name),
    side = pageSide(v);
  const { text, message } = verdictOf(side);
  assert.match(text, /^accepted\n/, `${name}: ${text}`);
  const said = readVerdict(text);
  assert.equal(said.payee.tag, v.payee.key, "the payee key of the output");
  assert.equal(said.payee.ownerHash, v.payee.ownerHash);
  assert.equal(said.expiry, EXPIRY);
  assert.equal(said.treeFee, 0n);
  const paid = v.outputs.filter((o) => o.role === "payee").map((o) => BigInt(o.amount));
  const kept = v.outputs.filter((o) => o.role === "change").map((o) => BigInt(o.amount));
  assert.deepEqual(
    said.paid.map((o) => o.amount),
    paid,
  );
  assert.deepEqual(
    said.change.map((o) => o.amount),
    kept,
  );
  const rows = Object.fromEntries(transferRows(v.group.key, { verdict: text }, 5000n));
  assert.equal(rows.Payee, base58(v.payee.key));
  const literal = {
    "transfer-sol": "0.00000004 SOL",
    "transfer-everything-with-dummy": "0.0000001 SOL",
  };
  assert.equal(rows.Amount, literal[name], "the amount is the lamports of the payee output");
  const change = { "transfer-sol": "0.00000006 SOL", "transfer-everything-with-dummy": "0 SOL" };
  assert.equal(rows.Change, change[name] + " stays with the group.", "the change row");
  const until = new Date(Number(EXPIRY) * 1000).toISOString().slice(0, 16).replace("T", " ");
  assert.match(rows.Lasts, new RegExp(`^Until ${until} UTC`));
  assert.match(rows["Network fee"], /^0\.000005 SOL$/);
  const data = Buffer.from(side.transact, "hex");
  assert.ok(Buffer.from(message).includes(data), "the message holds the transact data");
}
step("the real checker accepts the payment that the page encoded");

// ── The tree fee of the snapshot reaches the checker ──
{
  const v = vector("transfer-sol"),
    side = pageSide(v);
  const fee = (value) => verdictOf(side, { spend: { ...side.spend, fee: value } }).text;
  const said = readVerdict(fee("162"));
  assert.equal(said.treeFee, 162n * BigInt(v.inputs.length), "the fee of every input");
  assert.match(fee("163"), /^refused\n.*163 lamports over 162/s, "a fee over the cap");
}
step("the snapshot gives the checker the tree fee");

// ── Every change is refused ──
{
  const v = vector("transfer-sol"),
    side = pageSide(v);
  const refused = (what, got, pattern) => {
    assert.match(got.text, /^refused\n/, `${what}: ${got.text}`);
    assert.match(got.text, pattern, what);
  };
  // The payee: the screen shows what the intent says, so a payee that the outputs do not pay.
  const other = pageSide(v, { payee: v.payee.address.replace(/^0122/, "0123") });
  refused("another payee", verdictOf(other), /./);
  const greedy = pageSide(v, { amount: 41n });
  refused("another amount", verdictOf(greedy), /./);
  const lacking = { ...side.spend, inputs: [{ ...side.spend.inputs[0], amount: "99" }] };
  refused("an input that the device does not hold", verdictOf(side, { spend: lacking }), /./);
  const none = { ...side.spend, inputs: [] };
  refused("no input", verdictOf(side, { spend: none }), /./);
  const nonce = pageSide(v, { nonce: "0a".repeat(32) });
  refused("another nonce", verdictOf(nonce, { message: verdictOf(side).message }), /./);
  const early = { ...side.ss, plan: side.ss.plan.slice(0, -2) };
  assert.match(
    verdictOf(side, { ss: early, message: verdictOf(side).message }).text,
    /^error\t/,
    "a plan that ends inside a field",
  );
  // The pair of an earlier proposal: this device approved the same inputs and salt before.
  const first = v.inputs[0].nullifier;
  const reused = { ...side.spend, salts: [{ first, salt: v.salt }] };
  refused("a salt that the device used before", verdictOf(side, { spend: reused }), /salt-reused/);
  const fresh = {
    ...side.spend,
    salts: [
      { first, salt: "ff".repeat(16) },
      { first: "01".repeat(32), salt: v.salt },
    ],
  };
  assert.match(verdictOf(side, { spend: fresh }).text, /^accepted\n/, "another pair is no reuse");
}
step("a wrong payee, amount, input, nonce, plan or a reused salt is refused");
console.log("sol-transfer: ok");
process.exit(0);
