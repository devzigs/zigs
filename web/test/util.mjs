// Checks the pure helpers. Run: node web/test/util.mjs
import assert from "node:assert/strict";
import {
  abortText, canonical, checkNetwork, chunks, confirmGate, conflictReason, finite, fmtInt,
  numberClash, samePackages, walletVersion,
} from "../util.js";

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

assert.equal(walletVersion({}), 1);
assert.equal(walletVersion({ version: 1 }), 1);
assert.equal(walletVersion({ version: 2 }), 2);
for (const bad of [0, 3, "2", null, NaN, {}]) assert.equal(walletVersion({ version: bad }), 0);

const ids = [1, 2, 3], no = "1234 5678 9012", other = "1234 5678 9013";
const docs = (...nums) => Object.fromEntries(nums.map((n, k) => [k + 1, n === null ? undefined : { number: n }]));
assert.equal(confirmGate(no, no, docs(no, no, no), ids), "ok");
assert.equal(confirmGate(no, no, docs(no, no, null), ids), "wait");          // a seat has not confirmed
assert.equal(confirmGate(no, null, docs(no, no, no), ids), "wait");          // documents alone are claims
assert.equal(confirmGate(no, other, docs(no, no, no), ids), "wait");         // confirmed another number
assert.equal(confirmGate(no, no, docs(no, other, no), ids), "mismatch");
assert.equal(confirmGate(no, no, docs(no, other, null), ids), "mismatch");   // a clash beats a gap
assert.equal(confirmGate(no, no, docs(no, 7, no), ids), "wait");             // a bad number is a gap
assert.equal(confirmGate(null, no, docs(no, no, no), ids), "wait");
assert.deepEqual(numberClash(no, docs(no, other, other), ids), [2, 3]);
assert.deepEqual(numberClash(no, docs(no, null, no), ids), []);
assert.equal(abortText("Signers saw different setup data."),
  "Signers saw different setup data. Do not use this wallet. Create a new wallet.");
assert.equal(abortText("seat 2: the secret part does not match its commitment"),
  "Seat 2: the secret part does not match its commitment. Do not use this wallet. Create a new wallet.");
assert.equal(abortText(""), "Setup failed. Do not use this wallet. Create a new wallet.");
assert.doesNotThrow(() => checkNetwork({ network: "testnet" }, "testnet"));
assert.throws(() => checkNetwork({ network: "mainnet" }, "testnet"), /another network/);
assert.throws(() => checkNetwork({}, "testnet"), /another network/);

// A seat ends its setup when the store changes what it took: its wallet version, its key, or the
// safety number that its person confirmed.
const mine = { version: 2, boxPk: "aa" };
const conflict = conflictReason;
const none = { sawV2: false }, v2 = { sawV2: true };
assert.equal(conflict(mine, { boxPk: "aa" }, 2, 2, none), null);
assert.equal(conflict(mine, undefined, 2, 2, none), null);                 // seat not loaded yet
assert.match(conflict(mine, { boxPk: "bb" }, 2, 2, none), /seat key was replaced/);
assert.match(conflict(mine, { boxPk: "aa" }, 1, 2, none), /version of this wallet changed/);
assert.equal(conflict({ version: 1 }, { boxPk: "bb" }, 1, 1, none), null);  // version 1: no key check
assert.match(conflict({ version: 1 }, {}, 1, 1, v2), /new setup/);
assert.equal(conflict({ version: 1, keyPackage: {} }, {}, 1, 1, v2), null);
assert.equal(conflict({}, { boxPk: "bb" }, 2, 2, none), null);              // seat from before keys

// The safety number changed after this seat confirmed it: the seat stops, with no new tap.
const confirmed = { ...mine, confirmed: no }, same = { boxPk: "aa" };
const moved = conflict(confirmed, same, 2, 2, { sawV2: true, number: other });
assert.match(moved, /safety number changed after you confirmed/);
assert.equal(abortText(moved), "The safety number changed after you confirmed it. Someone may have "
  + "replaced a seat. Do not use this wallet. Create a new wallet.");
assert.equal(conflict(confirmed, same, 2, 2, { sawV2: true, number: no }), null);   // same number
assert.equal(conflict(mine, same, 2, 2, { sawV2: true, number: other }), null);     // not confirmed
assert.equal(conflict(confirmed, same, 2, 2, { sawV2: true, number: null }), null); // no number now
assert.equal(conflict({ ...confirmed, keyPackage: {} }, same, 2, 2, { number: other }), null);
assert.equal(conflict({ ...confirmed, version: 1 }, same, 1, 1, { number: other }), null);
assert.equal(conflict({ ...confirmed, confirmed: 7 }, same, 2, 2, { number: other }), null);
assert.match(conflict(confirmed, { boxPk: "bb" }, 2, 2, { number: other }), /seat key was replaced/);
console.log("util ok");
