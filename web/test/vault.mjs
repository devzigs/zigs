// Checks the sealed record of the passkey lock. Run: node web/test/vault.mjs
import assert from "node:assert/strict";
import { aesKey, seal, open, parseVault } from "../vault.js";

const rec = { cred: "Y3JlZA", salt: "c2FsdA" };
const key = await aesKey(crypto.getRandomValues(new Uint8Array(32)));
const data = {
  secrets: { "g1:2": { keyPackage: "kp", nonces: { s1: "n" } } },
  keys: { g1: "k".repeat(43) },
};

const sealed = await seal(key, rec, data);
assert.equal(sealed.cred, rec.cred);
assert.equal(sealed.salt, rec.salt);
assert.ok(!JSON.stringify(sealed).includes("kp"), "the key package is not readable");
assert.deepEqual(await open(key, sealed), data);
assert.deepEqual(parseVault(JSON.stringify(sealed)), sealed);

const other = await aesKey(crypto.getRandomValues(new Uint8Array(32)));
await assert.rejects(open(other, sealed), "a wrong passkey does not open it");
const flipped = sealed.box.startsWith("A") ? "B" + sealed.box.slice(1) : "A" + sealed.box.slice(1);
await assert.rejects(open(key, { ...sealed, box: flipped }), "a changed record does not open");
assert.notEqual((await seal(key, rec, data)).iv, sealed.iv, "each seal uses a new IV");

const junk = [null, "", "{}", "[]", "not json",
  JSON.stringify({ ...sealed, v: 2 }), JSON.stringify({ ...sealed, box: "" })];
for (const bad of junk) {
  assert.equal(parseVault(bad), null, String(bad));
}
console.log("vault ok");
