// Checks the personal account calls of the engine, as the page calls them. Run:
// node web/test/account.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as Z from "../pkg/zigs_engine.js";
import { release, track } from "../app-kit.js";

Z.initSync({ module: readFileSync(new URL("../pkg/zigs_engine_bg.wasm", import.meta.url)) });

const json = (text) => JSON.parse(text);
const refused = (fn, part) => assert.throws(fn, (err) => err.message.includes(part), part);

// ── Keys ──
const made = json(Z.accountNew("testnet"));
assert.deepEqual(Object.keys(made).sort(), ["address", "seed", "ufvk"]);
assert.match(made.seed, /^[0-9a-f]{64}$/);
assert.ok(made.ufvk.startsWith("uviewtest1") && made.address.startsWith("utest1"));
assert.notEqual(json(Z.accountNew("testnet")).seed, made.seed, "each account has its own seed");
const keys = json(Z.accountKeys(made.seed, "testnet"));
assert.deepEqual(keys, { ufvk: made.ufvk, address: made.address });
const main = json(Z.accountKeys(made.seed, "mainnet"));
assert.ok(main.ufvk.startsWith("uview1") && main.address.startsWith("u1"));
assert.equal(Z.addressAt(made.ufvk, 0), made.address, "index 0 is the public address");
assert.notEqual(Z.addressAt(made.ufvk, 1), made.address);
assert.equal(Z.addressAt(made.ufvk, 4294967295), Z.addressAt(made.ufvk, 4294967295));
assert.ok(Z.addressAt(main.ufvk, 3).startsWith("u1"));
// A value that is no index never gives another index, and never the public address.
for (const index of [undefined, null, -1, 4294967296, 1.5, NaN, "3", Infinity]) {
  refused(() => Z.addressAt(made.ufvk, index), "whole number from 0 to 4294967295");
}
for (const seed of ["", "0a", made.seed.slice(1), `${made.seed}0`, `${made.seed.slice(2)}zz`]) {
  refused(() => Z.accountKeys(seed, "testnet"), "64 hexadecimal");
}
refused(() => Z.accountNew("regtest"), "network");
refused(() => Z.addressAt("nope", 0), "bad viewing key");

// ── Parts ──
assert.deepEqual(json(Z.splitMessage("hello")), ["hello"]);
const long = "Zigs ✓ 😀 héllo. ".repeat(55);
const parts = json(Z.splitMessage(long));
assert.equal(parts.length, 3);
parts.forEach((part, k) => {
  assert.ok(part.startsWith(`(${k + 1}/3) `));
  assert.ok(Buffer.byteLength(part) <= 512);
});
const text = (memos) => json(Z.joinMessage(JSON.stringify(memos))).text;
assert.equal(text(parts), long);
assert.equal(text([parts[2], parts[0], parts[1]]), long, "any order");
assert.equal(text([parts[0], parts[0], parts[2]]), null, "a duplicate marker");
assert.equal(text([parts[0], parts[1]]), null, "a missing part");
assert.equal(text(["(1/2) a", "(2/3) b"]), null, "two totals");
assert.equal(text(["plain"]), "plain");
assert.equal(text([]), null);
refused(() => Z.splitMessage(""), "The message is empty.");
refused(() => Z.splitMessage("a\0b"), "null character");
refused(() => Z.splitMessage("a".repeat(2001)), "2001 characters");
refused(() => Z.splitMessage("é".repeat(1266)), "more than 5 parts");
refused(() => Z.joinMessage("{}"), "memo list");

// ── A message is checked before the page asks the network for anything ──
const wallet = new Z.ChainWallet(made.ufvk, 4500000, "http://localhost:1");
await assert.rejects(wallet.createMessage("nope", "hi"), /must be a testnet unified address/);
await assert.rejects(wallet.createMessage(made.address, ""), /The message is empty\./);

// ── A free() during a call throws, and release waits for the call (ZEC-16) ──
// fetch never answers, so no request leaves and each call stays open.
const realFetch = globalThis.fetch;
globalThis.fetch = () => new Promise(() => {});
const live = () => new Z.ChainWallet(made.ufvk, 4500000, "https://silent.test");
const busy = (cw) => cw.createMessage(made.address, "hi");
const raw = live();
busy(raw);
await new Promise((r) => setTimeout(r, 20));
assert.throws(() => raw.free(), /while it was borrowed/, "the engine refuses a free during a call");
const kept = live();
track(kept, busy(kept));
await new Promise((r) => setTimeout(r, 20));
release(kept);
assert.equal(typeof kept.balance(), "string", "release leaves the busy object alive");
const gone = live();
release(gone);
assert.throws(() => gone.balance(), /null pointer/, "release frees an idle object");
globalThis.fetch = realFetch;
console.log("account.mjs: ok");
