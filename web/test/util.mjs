// Checks the pure helpers. Run: node web/test/util.mjs
import assert from "node:assert/strict";
import { canonical, chunks, finite, fmtInt, samePackages } from "../util.js";

assert.deepEqual(chunks("abcdefghij"), ["abcde", "fghij"]);
assert.deepEqual(chunks("abcdefg"), ["abcde", "fg"]);
assert.deepEqual(chunks(""), []);
assert.deepEqual(chunks(null), []);
assert.equal(chunks("u1abcdefghijklmnopqrstuvwxyz").join(""), "u1abcdefghijklmnopqrstuvwxyz");

assert.equal(fmtInt(1234567), "1,234,567");
for (const bad of ["12", null, undefined, NaN, Infinity, {}, [], "abc"]) assert.equal(fmtInt(bad), "unknown");
assert.equal(finite(5), 5);
for (const bad of ["5", null, undefined, NaN, Infinity]) assert.equal(finite(bad), 0);

assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
const a = { verifying_shares: { x: "1", y: "2" }, verifying_key: "k" };
const sameButReordered = { verifying_key: "k", verifying_shares: { y: "2", x: "1" } };
assert.equal(samePackages([a, JSON.stringify(sameButReordered), JSON.stringify(a)]), true);
assert.equal(samePackages([a, { ...a, verifying_shares: { x: "1", y: "3" } }]), false);
assert.equal(samePackages([a, { ...a, extra: 1 }]), false);
assert.equal(samePackages([a, null]), false);
assert.equal(samePackages([a, "{not json"]), false);
assert.equal(samePackages([]), false);
console.log("util ok");
