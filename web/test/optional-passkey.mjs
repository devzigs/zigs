// Optional setup uses the real store and vault with synthetic credentials, never a policy setter.
// Each case loads a fresh page module graph, so acknowledgement cannot leak between cases.
// Run: node web/test/optional-passkey.mjs (Node 26).
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fakePasskey } from "./passkey-fixture.mjs";

const names = ["default", "confirmed", "cancelled creation", "cancelled assertion", "unsupported",
  "missing PRF", "vault before confirmation", "vault after confirmation", "locked", "partial",
  "pending", "vault during confirmation", "damaged vault", "empty vault", "damaged plaintext",
  "unreadable storage",
  "memory only", "write failure", "damaged recipients", "damaged account", "cleanup failure",
  "later protection", "reload"];
const child = (name, records = {}) => spawnSync(process.execPath,
  [fileURLToPath(import.meta.url), "case", name], { encoding: "utf8", timeout: 120000,
    input: JSON.stringify(records) });
function passed(result, name) {
  assert.equal(result.status, 0, name + "\n" + result.stdout + result.stderr);
}
if (process.argv[2] !== "case") {
  for (const name of names) passed(child(name), name);
  console.log("optional-passkey: ok (" + names.length + " isolated policy and storage cases)");
  process.exit(0);
}

const name = process.argv[3];
const { loadRig, storage } = await import("./sol-rig.mjs");
for (const [key, value] of Object.entries(JSON.parse(fs.readFileSync(0, "utf8")))) {
  storage.set(key, value);
}
const originalStorage = { ...localStorage };
if (name === "memory only") localStorage.getItem = () => { throw new Error("read denied"); };
const { t } = await loadRig();
const ks = await import("../app-keystore.js");
const { aesKey, open, parseVault } = await import("../vault.js");
Object.defineProperty(globalThis, "navigator", { configurable: true, value: fakePasskey() });
globalThis.zigs = { use: async () => null };
ks.setIdb(async () => null);
const initialStored = Object.fromEntries(storage);
const marker = "synthetic unprotected signing share";
const strictBlocked = () => assert.throws(ks.requirePasskeyProtection, /Protect this browser/);
function blocked() {
  assert.equal(ks.setupProtectionReady(), false);
  assert.throws(ks.requireSetupProtection, /Protect this browser/);
  strictBlocked();
}
function cannotSkip() {
  assert.equal(ks.canSkipPasskeyProtection(), false);
  assert.throws(ks.acknowledgeUnprotectedSetup, /cannot be skipped/);
  blocked();
}
function confirmed() {
  assert.equal(ks.canSkipPasskeyProtection(), true);
  ks.acknowledgeUnprotectedSetup();
  assert.equal(ks.setupProtectionReady(), true);
  ks.requireSetupProtection();
  assert.equal(ks.passkeyProtected(), false, "acknowledgement never asserts encryption");
  strictBlocked();
}
const cancelled = () => { throw new DOMException("Cancelled", "NotAllowedError"); };
const cases = {
  default() {
    assert.equal(ks.canSkipPasskeyProtection(), true);
    blocked();
    assert.deepEqual(Object.fromEntries(storage), initialStored,
      "eligibility checks never create a wallet or consent record");
  },
  async confirmed() {
    confirmed();
    assert.deepEqual(Object.fromEntries(storage), initialStored,
      "acknowledgement has no durable consent record");
    await ks.putSec("synthetic-wallet", 1, { keyPackage: marker });
    assert.equal(ks.sec("synthetic-wallet", 1).keyPackage, marker);
    assert.equal(JSON.parse(storage.get("zf-secrets"))["synthetic-wallet:1"].keyPackage, marker);
    assert.equal(storage.has("zf-vault"), false, "the existing plain path is used unchanged");
    ks.requireSetupProtection();
    strictBlocked();
  },
  async "cancelled creation"() {
    confirmed();
    navigator.credentials.create = cancelled;
    await assert.rejects(ks.lockWithPasskey, { name: "NotAllowedError" });
    blocked();
    confirmed();
  },
  async "cancelled assertion"() {
    navigator.credentials.get = cancelled;
    await assert.rejects(ks.lockWithPasskey, { name: "NotAllowedError" });
    blocked();
  },
  async unsupported() {
    globalThis.window = {};
    await assert.rejects(ks.lockWithPasskey, /no passkey support/);
    blocked();
  },
  async "missing PRF"() {
    navigator.credentials.get = async () => ({ getClientExtensionResults: () => ({}) });
    await assert.rejects(ks.lockWithPasskey, /does not support the PRF extension/);
    blocked();
  },
  "vault before confirmation"() {
    assert.equal(ks.canSkipPasskeyProtection(), true);
    storage.set("zf-vault", "synthetic other-tab vault");
    cannotSkip();
    assert.equal(storage.get("zf-vault"), "synthetic other-tab vault");
  },
  "vault after confirmation"() {
    confirmed();
    storage.set("zf-vault", "synthetic other-tab vault");
    cannotSkip();
    assert.equal(storage.get("zf-vault"), "synthetic other-tab vault",
      "a gate rechecks storage even before a storage event arrives");
    storage.delete("zf-vault");
    assert.equal(ks.canSkipPasskeyProtection(), true);
    blocked();
    confirmed();
  },
  locked() { ks.setLocked({ damaged: true }); cannotSkip(); },
  partial() { ks.setVault({ rec: { cred: "YQ", salt: "Yg" }, key: null }); cannotSkip(); },
  async pending() {
    let release, entered;
    const waiting = new Promise((done) => { entered = done; });
    navigator.credentials.create = () => {
      entered();
      return new Promise((_resolve, reject) => { release = () => reject(
        new DOMException("Cancelled", "NotAllowedError")); });
    };
    const activation = ks.lockWithPasskey();
    const failed = assert.rejects(activation, { name: "NotAllowedError" });
    await waiting;
    cannotSkip();
    release();
    await failed;
    blocked();
  },
  "vault during confirmation"() {
    let reads = 0;
    localStorage.getItem = (key) => {
      if (key === "zf-vault" && ++reads === 2) storage.set(key, "other-tab vault");
      return originalStorage.getItem(key);
    };
    assert.throws(ks.acknowledgeUnprotectedSetup, /cannot be skipped/);
    assert.equal(storage.get("zf-vault"), "other-tab vault");
    blocked();
  },
  "damaged vault"() { storage.set("zf-vault", "{ damaged"); cannotSkip(); },
  "empty vault"() { storage.set("zf-vault", ""); cannotSkip(); },
  "damaged plaintext"() {
    confirmed();
    for (const value of ["{ damaged", "[]", "null", "17"]) {
      storage.set("zf-secrets", value);
      cannotSkip();
      assert.equal(storage.get("zf-secrets"), value);
    }
  },
  "unreadable storage"() {
    confirmed();
    localStorage.getItem = () => { throw new Error("read denied"); };
    cannotSkip();
    Object.assign(localStorage, originalStorage);
    assert.equal(ks.canSkipPasskeyProtection(), true);
    blocked();
  },
  "memory only"() {
    Object.assign(localStorage, originalStorage);
    assert.equal(ks.memoryOnly(), true);
    cannotSkip();
  },
  async "write failure"() {
    confirmed();
    localStorage.setItem = () => { throw new Error("quota"); };
    assert.equal(await ks.persist(), false);
    assert.equal(ks.storageOk, false);
    cannotSkip();
  },
  "damaged recipients"() {
    confirmed();
    storage.set(ks.RECIPIENTS_KEY, '{"version":1,"entries":"damaged"}');
    cannotSkip();
    assert.equal(storage.get(ks.RECIPIENTS_KEY), '{"version":1,"entries":"damaged"}');
  },
  "damaged account"() { t.adoptPersonal({ damaged: true }); cannotSkip(); },
  async "cleanup failure"() {
    await ks.putSec("synthetic-wallet", 1, { keyPackage: marker });
    localStorage.removeItem = (key) => {
      if (key === "zf-secrets") throw new Error("deletion denied");
      originalStorage.removeItem(key);
    };
    await assert.rejects(ks.lockWithPasskey, /deletion denied/);
    assert.ok(ks.vault && storage.has("zf-vault") && storage.has("zf-secrets"));
    cannotSkip();
  },
  async "later protection"() {
    confirmed();
    await ks.putSec("synthetic-wallet", 1, { keyPackage: marker });
    await ks.lockWithPasskey();
    assert.equal(ks.passkeyProtected(), true);
    assert.equal(ks.setupProtectionReady(), true);
    ks.requirePasskeyProtection();
    assert.equal(storage.has("zf-secrets"), false);
    assert.equal(storage.has("zf-keys"), false);
    assert.equal(storage.has("zf-chats"), false);
    const key = await aesKey(new Uint8Array(32).fill(7));
    const saved = await open(key, parseVault(storage.get("zf-vault")));
    assert.equal(saved.secrets["synthetic-wallet:1"].keyPackage, marker);
    passed(child("reloaded protected", Object.fromEntries(storage)), "reloaded protected");
  },
  async reload() {
    confirmed();
    await ks.putSec("synthetic-wallet", 1, { keyPackage: marker });
    passed(child("reloaded unprotected", Object.fromEntries(storage)), "reloaded unprotected");
  },
  "reloaded unprotected"() {
    blocked();
    assert.equal(ks.canSkipPasskeyProtection(), true);
    assert.equal(ks.sec("synthetic-wallet", 1).keyPackage, marker,
      "existing wallet access does not depend on the expired setup acknowledgement");
  },
  async "reloaded protected"() {
    cannotSkip();
    await ks.unlockVault();
    assert.equal(ks.passkeyProtected(), true);
    ks.requirePasskeyProtection();
    ks.requireSetupProtection();
    assert.equal(ks.sec("synthetic-wallet", 1).keyPackage, marker);
  },
};
await cases[name]();
console.log("optional-passkey case: " + name + " ok");
process.exit(0);
