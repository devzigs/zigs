// The lifetime that verify-chain.mjs reports comes from the decoder, for every message version.
// Bytes 8 to 40 hold it in a version 1 message only: in a version 0 message they are part of the
// account keys. The test reads the landed version 1 messages of the fixtures and builds a
// version 0 message by hand. Nothing reads the network.
// Usage: node solspike/test/verify-chain.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { lifetimeHex } from "../tools/verify-chain.mjs";

// The kit comes from the Zolana checkout through the symlink solspike/tools/node_modules.
const kit = createRequire(new URL("../tools/verify-chain.mjs", import.meta.url))("@solana/kit");
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const decode = (bytes) => kit.getCompiledTransactionMessageDecoder().decode(bytes);

// Version 1: the lifetime is at bytes 8 to 40.
for (const name of ["chain-p6a.msg", "chain-p6b.msg"]) {
  const bytes = readFileSync(new URL(`fixtures/${name}`, import.meta.url));
  const message = decode(bytes);
  assert.equal(message.version, 1, name);
  assert.equal(lifetimeHex(message), hex(bytes.subarray(8, 40)), name);
}

// Version 0: one signer, two account keys, a blockhash, no instruction, no lookup table.
const key = (fill) => Buffer.alloc(32, fill);
const blockhash = Buffer.from(Array.from({ length: 32 }, (_, i) => 0xa0 + i));
const v0 = Buffer.concat([
  Buffer.from([0x80, 1, 0, 0, 2]),
  key(1),
  key(2),
  blockhash,
  Buffer.from([0, 0]),
]);
const message = decode(v0);
assert.equal(message.version, 0);
assert.equal(lifetimeHex(message), hex(blockhash), "the blockhash of a version 0 message");
assert.notEqual(hex(v0.subarray(8, 40)), hex(blockhash), "bytes 8 to 40 are other bytes here");

console.log("verify-chain: ok, the lifetime comes from the decoder");
process.exit(0);
