// Saved-file verification uses the real backup cipher, then compares with a snapshot of the
// already verified local share. It never restores a file or imports a nonce. Run with Node 26.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as Z from "../pkg/zigs_engine.js";
import { checkBackupPayload, checkSavedBackup, MAX_CHECK_BYTES } from "../backup-check.js";
import { frostId, slowCall } from "../util.js";

Z.initSync({ module: readFileSync(new URL("../pkg/zigs_engine_bg.wasm", import.meta.url)) });
const clone = structuredClone;
const freeze = (v) => {
  if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); }
  return v;
};
const packageOf = (curve) => ({ identifier: frostId(1), verifying_share: curve + "-public",
  signing_share: curve + "-private", verifying_key: curve + "-group" });
const publicOf = (curve) => ({ verifying_key: curve + "-group",
  verifying_shares: { [frostId(1)]: curve + "-public", [frostId(2)]: curve + "-other" } });
const zec = freeze({ kind: "zigs-key-share", group: "aaaaaaaaaaaaaaaaaaaa", seat: 1,
  threshold: 2, of: 3, key: "k".repeat(43),
  wallet: { address: "utest1-example", network: "testnet" },
  secret: { keyPackage: packageOf("zec"), publicKeyPackage: publicOf("zec"),
    groupKey: "a".repeat(64), vaultSk: "b".repeat(64), boxSk: "c".repeat(64),
    signSk: "d".repeat(64), version: 3,
    room: { id: "cccccccccccccccccccc", key: "m".repeat(43) } } });
const sol = freeze({ kind: "zigs-sol-backup", group: zec.group, seat: 1, cluster: "devnet",
  keyPackage: packageOf("sol"), publicKeyPackage: publicOf("sol"),
  groupKey: "e".repeat(64), solSeed: "f".repeat(64), proveLocal: true });
const wrong = (expected, change, why) => {
  const file = clone(expected); change(file);
  assert.throws(() => checkBackupPayload(freeze(file), expected), /not the saved recovery file/,
    why);
};
let checks = 0;
for (const expected of [zec, sol]) {
  assert.equal(checkBackupPayload(expected, expected), true); checks++;
  for (const [key, value] of [["group", "bbbbbbbbbbbbbbbbbbbb"], ["seat", 2],
    ["kind", "personal"]]) { wrong(expected, (f) => { f[key] = value; }, key); checks++; }
  const kp = expected === zec ? "secret" : null;
  const part = (f) => kp ? f[kp] : f;
  for (const key of ["signing_share", "verifying_share", "identifier", "verifying_key"]) {
    wrong(expected, (f) => { part(f).keyPackage[key] = "another-value"; }, key); checks++;
    wrong(expected, (f) => { delete part(f).keyPackage[key]; }, "missing " + key); checks++;
  }
  wrong(expected, (f) => { part(f).groupKey = "0".repeat(64); }, "group key"); checks++;
  wrong(expected, (f) => { part(f).publicKeyPackage.verifying_key = "other"; }, "public package");
  checks++;
  wrong(expected, (f) => { part(f).publicKeyPackage = "not JSON"; }, "unreadable package");
  checks++;
  const reordered = clone(expected), localPart = part(reordered), original = localPart.keyPackage;
  localPart.keyPackage = Object.fromEntries(Object.entries(original).reverse());
  localPart.publicKeyPackage = JSON.stringify(localPart.publicKeyPackage);
  assert.equal(checkBackupPayload(freeze(reordered), expected), true,
    "JSON key order and a public-package JSON representation carry the same data"); checks++;
}
for (const [key, value] of [["threshold", 3], ["of", 4], ["key", "other-room-key"]]) {
  wrong(zec, (f) => { f[key] = value; }, key); checks++;
}
wrong(zec, (f) => { f.wallet.network = "mainnet"; }, "another Zcash network"); checks++;
wrong(zec, (f) => { delete f.wallet.network; }, "no Zcash network"); checks++;
wrong(zec, (f) => { f.wallet.address = "another-address"; }, "another wallet address"); checks++;
wrong(zec, (f) => { delete f.wallet; }, "no wallet context"); checks++;
for (const key of ["vaultSk", "boxSk", "signSk"]) {
  wrong(zec, (f) => { f.secret[key] = "another-private-key"; }, key); checks++;
  wrong(zec, (f) => { delete f.secret[key]; }, "missing " + key); checks++;
}
for (const [key, value] of [["version", 2], ["room", { id: zec.group, key: "other" }]]) {
  wrong(zec, (f) => { f.secret[key] = value; }, "changed " + key); checks++;
  wrong(zec, (f) => { delete f.secret[key]; }, "missing " + key); checks++;
}
wrong(sol, (f) => { f.cluster = "mainnet-beta"; }, "another Solana cluster"); checks++;
wrong(sol, (f) => { f.solSeed = "0".repeat(64); }, "another Solana setup secret"); checks++;
wrong(sol, (f) => { delete f.solSeed; }, "missing Solana setup secret"); checks++;
wrong(sol, (f) => { f.proveLocal = false; }, "changed local-proving privacy pin"); checks++;
wrong(sol, (f) => { delete f.proveLocal; }, "missing local-proving privacy pin"); checks++;
for (const value of [null, [], false, "text", {}]) {
  assert.throws(() => checkBackupPayload(value, zec), /not the saved recovery file/); checks++;
}
console.log("ok  " + checks + " payload checks bind full private shares, device, wallet and "
  + "network");

// These schema fixtures are synthetic, not usable signing shares. The encryption/opening below
// is the production engine's Argon2id and authenticated backup cipher, without any restore API.
const pass = "saved example recovery passphrase";
let openCalls = 0;
const open = async (p, text) => { openCalls++; return slowCall(Z, "backupOpen", [p, text]); };
const blob = (text, size = new TextEncoder().encode(text).length) => Object.freeze({
  size, text: async () => text,
});
const sealed = (plain) => slowCall(Z, "backupSeal", [pass, JSON.stringify(plain)]);
const before = JSON.stringify([zec, sol]);
const stored = new Map([["shares", before], ["nonces", "existing nonce data"]]);
let mutations = 0;
const refuseMutation = () => { mutations++; throw new Error("Backup checking must not write"); };
const prior = { localStorage: globalThis.localStorage, fetch: globalThis.fetch };
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null,
  setItem: refuseMutation, removeItem: refuseMutation, clear: refuseMutation };
globalThis.fetch = refuseMutation;
try {
  for (const expected of [zec, sol]) {
    const encrypted = sealed(expected);
    assert.equal(await checkSavedBackup(blob(encrypted), pass, expected, open), true,
      "the saved encrypted file reopens locally");
    assert.equal(encrypted.includes("-private"), false, "the cipher hides the synthetic share");
    await assert.rejects(checkSavedBackup(blob(encrypted), "wrong passphrase", expected, open),
      /could not be opened.*No key shares were changed/);
    const damaged = JSON.parse(encrypted);
    assert.equal(typeof damaged.ct, "string", "the engine wrapper has an authenticated ciphertext");
    damaged.ct = (damaged.ct[0] === "A" ? "B" : "A") + damaged.ct.slice(1);
    await assert.rejects(checkSavedBackup(blob(JSON.stringify(damaged)), pass, expected, open),
      /could not be opened/);
    const bad = clone(expected);
    (expected === zec ? bad.secret : bad).keyPackage.signing_share = "another-private-value";
    await assert.rejects(checkSavedBackup(blob(sealed(bad)), pass, expected, open),
      /not the saved recovery file/, "valid encryption cannot make the wrong share count");
  }
  // Validate cheap refusals before invoking the expensive password/cipher operation.
  const callsBefore = openCalls;
  for (const invalid of [blob(JSON.stringify(zec)), blob("not JSON"), blob("null"), blob("[]"),
    blob('{"kind":"personal"}'), blob("{}", MAX_CHECK_BYTES + 1), null]) {
    await assert.rejects(checkSavedBackup(invalid, pass, zec, open));
  }
  await assert.rejects(checkSavedBackup(blob('{"kind":"zigs-backup"}'), "", zec, open),
    /Enter the passphrase/);
  // Do not trust a reported size alone; UTF-8 bytes can exceed a character count.
  await assert.rejects(checkSavedBackup(blob("é".repeat(MAX_CHECK_BYTES / 2 + 1), 1), pass, zec,
    open), /too large/);
  assert.equal(openCalls, callsBefore,
    "plaintext, oversized files and absent passphrases never open");
  const carryingNonces = clone(zec);
  carryingNonces.secret.nonces = { injected: "a nonce that must not be restored" };
  assert.equal(await checkSavedBackup(blob(sealed(carryingNonces)), pass, zec, open), true,
    "checking a copy does not import additional data from it");
  assert.equal(mutations, 0, "no local storage or network write was attempted");
  assert.deepEqual([...stored], [["shares", before], ["nonces", "existing nonce data"]]);
  assert.equal(JSON.stringify([zec, sol]), before, "frozen verified snapshots stay unchanged");
} finally {
  if (prior.localStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = prior.localStorage;
  globalThis.fetch = prior.fetch;
}
console.log("ok  encrypted files reopen without restore, network, storage or nonce mutations");
console.log("backup-check: ok");
