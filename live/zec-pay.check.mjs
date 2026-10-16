// Self-check of the pure rules of zec-pay.mjs. Run: node live/zec-pay.check.mjs
import assert from "node:assert/strict";
import { parseHeader, verify, zatOfText } from "./zec-pay.mjs";

const raw = Buffer.alloc(24);
raw.writeUInt32LE(0x80000006, 0);
raw.writeUInt32LE(0x77190ad9, 8);
raw.writeUInt32LE(4512480, 16);
const header = parseHeader(raw);
assert.deepEqual(header, { version: 6, branchId: 0x77190ad9, expiry: 4512480 });
assert.throws(() => parseHeader(Buffer.alloc(19)), /no header/);

assert.equal(zatOfText("0.0001"), 10_000);
assert.equal(zatOfText("1,234.5"), 123_450_000_000);
assert.equal(zatOfText("2"), 200_000_000);
assert.throws(() => zatOfText("0.0001 ZEC"), /cannot read/);

const facts = {
  header,
  tipBefore: 4509023,
  totalBefore: 12_190_000,
  totalAfter: 12_080_000,
  pageFee: 10_000,
  priority: false,
};
assert.deepEqual(verify(facts), { fee: 10_000, problems: [] });
assert.equal(verify({ ...facts, tipBefore: 4509022 }).problems.length, 0, "one block more");
const failing = (change) => verify({ ...facts, ...change }).problems.length;
assert.equal(failing({ tipBefore: 4509021 }), 1, "expiry too early");
assert.equal(failing({ tipBefore: 4509024 }), 1, "expiry too late");
assert.equal(failing({ totalAfter: 12_085_000, pageFee: 5000 }), 1, "k = 1");
assert.equal(failing({ pageFee: 15_000 }), 1, "page fee differs");
assert.equal(failing({ priority: true }), 1, "10000 is not 50000 x k");
assert.equal(failing({ header: { ...header, version: 5 } }), 1, "version");
assert.equal(failing({ header: { ...header, branchId: 1 } }), 1, "branch id");
console.log("zec-pay.check: ok");
