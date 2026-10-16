// Tests of the pure helpers of the Worker command prepare (P8c).
// Usage: node solspike/test/prepare.test.mjs   (needs web/sol/zolana.bundle.js for the decoder)
// 1. The pool instruction is cut out of the two landed P6 messages (public chain data), read, and
//    the parse ends on the last byte. Their expiry is finite.
// 2. The cut and the parse refuse other messages and damaged data.
// 3. The plan of a transfer is read from a body that has the field names of the prover client.
// 4. The commitment of the transact data of the two payments that landed through the approvals
//    program (wasm-sol/vectors/program/landed.json) is the commitment of their body, and the plan
//    of a proposal reads back.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  commitmentOf,
  cutTransact,
  field32,
  hex,
  parsePlan,
  parseTransact,
  planFromProve,
} from "../../web/sol/prepare.js";
import { planHex } from "../../web/sol/intent.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SDK = pathToFileURL(resolve(HERE, "../../web/sol/zolana.bundle.js")).href;
const sdk = await import(SDK);
const step = (name) => console.log(`ok  ${name}`);
const message = (name) =>
  sdk
    .getCompiledTransactionMessageDecoder()
    .decode(Uint8Array.from(readFileSync(join(HERE, "fixtures", name))));
const text = (fn) => {
  try {
    fn();
  } catch (err) {
    return err.message;
  }
  return null;
};

// The expiry of each landed message: the proposal time plus 24 hours (ZOLANA.md 6.6).
const LANDED = [
  ["chain-p6a.msg", 1792048408n, "4ea913073c961b60db4b5c2efcb2e3ea"],
  ["chain-p6b.msg", 1792053556n, "36592a0ddff0475ada2efc8511e07b8d"],
];

function landedMessages() {
  for (const [name, expiry, salt] of LANDED) {
    const data = cutTransact(message(name), sdk.SHIELDED_POOL_PROGRAM_ID);
    assert.equal(data[0], 16);
    const parsed = parseTransact(data);
    assert.deepEqual(
      [parsed.expiry, hex(parsed.salt), parsed.outputs, parsed.inputs],
      [expiry, salt, 2, 1],
    );
    assert.notEqual(parsed.expiry, 0n);
    assert.notEqual(parsed.expiry, 0xffff_ffff_ffff_ffffn);
  }
  step("the transact data of both landed messages is cut, read and parsed to the last byte");
}

function refusals() {
  const msg = message("chain-p6a.msg");
  const data = cutTransact(msg, sdk.SHIELDED_POOL_PROGRAM_ID);
  assert.match(
    text(() => cutTransact(msg, "11111111111111111111111111111112")),
    /0 pool instr/,
  );
  assert.match(
    text(() => cutTransact({ ...msg, instructionHeaders: undefined }, "x")),
    /not version 1/,
  );
  const pool = sdk.SHIELDED_POOL_PROGRAM_ID;
  const isPool = (h) => msg.staticAccounts[h.programAccountIndex] === pool;
  const at = msg.instructionHeaders.findIndex(isPool);
  const twice = {
    ...msg,
    instructionHeaders: [...msg.instructionHeaders, msg.instructionHeaders[at]],
    instructionPayloads: [...msg.instructionPayloads, msg.instructionPayloads[at]],
  };
  assert.match(
    text(() => cutTransact(twice, pool)),
    /2 pool instructions/,
    "U5: a message with two pool instructions was accepted",
  );
  assert.match(
    text(() => parseTransact(data.subarray(0, data.length - 1))),
    /ends inside|bytes follow/,
  );
  assert.match(
    text(() => parseTransact(Uint8Array.from([...data, 0]))),
    /bytes follow/,
  );
  assert.match(
    text(() => parseTransact(Uint8Array.from([15, ...data.subarray(1)]))),
    /not a transact/,
  );
  assert.match(
    text(() => parseTransact(data.subarray(0, 20))),
    /ends inside/,
  );
  for (let n = 0; n < data.length; n += 7) {
    assert.notEqual(
      text(() => parseTransact(data.subarray(0, n))),
      null,
      `cut at ${n} parses`,
    );
  }
  step("U5 a wrong program, two pool instructions, a legacy message, cut data and extra bytes");
}

const SOL = 0x2098f5fb9e239eab3ceac3f27b81e481dc3124d55ffed523a839ee8446b64864n;
const hexField = (n) => `0x${BigInt(n).toString(16)}`;
const utxo = (asset, amount, blinding) => ({
  domain: "0x0",
  owner: "0x1234",
  asset: hexField(asset),
  amount: hexField(amount),
  blinding: hexField(blinding),
  dataHash: "0x0",
  ringDataHash: "0x0",
  ringProgramId: "0x0",
});
const slot = (owner, asset, amount, blinding, dummy = false) => ({
  utxo: utxo(asset, amount, blinding),
  isDummy: dummy ? "0x1" : "0x0",
  ownerPkHash: owner,
  hash: "0x99",
});

/** A body with the field names of inputJson, outputJson and utxoJson in client/prover/client.ts. */
function proveBody() {
  const group = "0xaaaa";
  return {
    blindingSeed: hexField(0xabcdef),
    inputs: [slot(group, SOL, 100, 0x11), slot("0x0", 1, 0, 0x22, true)],
    outputs: [
      slot("0xbbbb", SOL, 40, 0x33),
      slot(group, SOL, 60, 0x44),
      slot("0x0", SOL, 0, 0x55, true),
      slot("0x0", SOL, 0, 0x66, true),
    ],
  };
}

function plans() {
  const plan = planFromProve(proveBody());
  assert.equal(plan.blindingSeed, "0".repeat(58) + "abcdef");
  assert.deepEqual(plan.inputs, [
    { mint: "0".repeat(64), amount: "100", blinding: "0".repeat(62) + "11" },
  ]);
  assert.deepEqual(
    plan.outputs.map((o) => [o.role, o.amount]),
    [
      ["payee", "40"],
      ["change", "60"],
      ["dummy", "0"],
      ["dummy", "0"],
    ],
  );
  assert.equal(plan.outputs[1].blinding, "0".repeat(62) + "44");
  assert.equal(field32("0x" + "f".repeat(64)), "f".repeat(64));
  step("the plan reads roles, amounts, blindings and the root seed (padded to 32 bytes)");
}

function planRefusals() {
  const body = (change) => {
    const b = proveBody();
    change(b);
    return b;
  };
  const cases = [
    [(b) => (b.outputs[0].utxo.asset = "0x2"), /only SOL/],
    [(b) => (b.outputs[2].utxo.amount = "0x1"), /dummy slot has an amount/],
    [(b) => delete b.blindingSeed, /no field blindingSeed/],
    [(b) => delete b.outputs[0].utxo, /no field utxo/],
    [(b) => (b.inputs[0].isDummy = "0x1"), /spends no input/],
    [(b) => (b.blindingSeed = "12"), /not a hex value/],
    [(b) => (b.blindingSeed = `0x${"1".repeat(65)}`), /not a hex value/],
  ];
  for (const [change, pattern] of cases) {
    assert.match(
      text(() => planFromProve(body(change))),
      pattern,
    );
  }
  assert.match(
    text(() => planFromProve(null)),
    /no field inputs/,
  );
  step("a non-SOL asset, a dummy with value and a missing or damaged field are refused");
}

const APPROVALS = JSON.parse(
  readFileSync(resolve(HERE, "../../wasm-sol/vectors/program/landed.json"), "utf8"),
);
const bytesOf = (h) => Uint8Array.from(Buffer.from(h, "hex"));

async function landedCommitments() {
  for (const name of ["dmain", "emain"]) {
    const track = APPROVALS[name];
    const execute = bytesOf(track.execute_data);
    const data = Uint8Array.from([16, ...execute.subarray(1)]);
    assert.equal(await commitmentOf(data), track.body.slice(0, 64), name);
    const parsed = parseTransact(data);
    assert.equal(parsed.published.length, parsed.outputs);
    assert.ok(parsed.published.every((o) => /^[0-9a-f]{64}$/.test(o.tag)), "inline tags");
    assert.match(parsed.txViewingPk, /^[0-9a-f]{66}$/);
    const moved = Uint8Array.from(data);
    moved[20] ^= 1;
    assert.notEqual(await commitmentOf(moved), track.body.slice(0, 64), "a changed key");
  }
  step("the commitment of a landed execute is the commitment of its body (approvals program)");
}

function plansReadBack() {
  const plan = {
    blindingSeed: "11".repeat(32),
    outputs: [
      { role: "change", mint: "00".repeat(32), amount: "60", blinding: "22".repeat(32) },
      { role: "payee", mint: "00".repeat(32), amount: "40", blinding: "33".repeat(32) },
      { role: "dummy", mint: "00".repeat(32), amount: "0", blinding: "44".repeat(32) },
    ],
  };
  assert.deepEqual(parsePlan(planHex(plan)), plan);
  for (const bad of ["", "zz", planHex(plan) + "00", planHex(plan).slice(0, -2)]) {
    assert.throws(() => parsePlan(bad), /plan|ends inside/, bad.slice(0, 8));
  }
  const unknown = planHex(plan).slice(0, 66) + "07" + planHex(plan).slice(68);
  assert.throws(() => parsePlan(unknown), /unknown output role/);
  step("the plan of a proposal reads back, and a damaged plan is refused");
}

landedMessages();
refusals();
plans();
planRefusals();
await landedCommitments();
plansReadBack();
console.log("prepare tests passed");
