// Setup protection completion uses the real vault/store code with synthetic credentials only.
// Run: node web/test/passkey-setup.mjs (Node 26).
import assert from "node:assert/strict";
import { aesKey, open, parseVault, seal } from "../vault.js";
import { newPersonal } from "../personal.js";
import { loadRig, storage } from "./sol-rig.mjs";
import { fakeLocks, fakePasskey } from "./passkey-fixture.mjs";

const { t } = await loadRig();
const ks = await import("../app-keystore.js");
const originalStorage = { ...localStorage }, originalWindow = window;
const originalIndexedDB = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
const originalDecrypt = Object.getOwnPropertyDescriptor(crypto.subtle, "decrypt");
const prf = new Uint8Array(32).fill(7), key = await aesKey(prf);
const marker = "synthetic saved signing share";
let cases = 0;

function restoreDecrypt() {
  if (originalDecrypt) Object.defineProperty(crypto.subtle, "decrypt", originalDecrypt);
  else delete crypto.subtle.decrypt;
}
async function reset() {
  Object.assign(localStorage, originalStorage);
  globalThis.window = originalWindow;
  if (originalIndexedDB) Object.defineProperty(globalThis, "indexedDB", originalIndexedDB);
  else delete globalThis.indexedDB;
  restoreDecrypt();
  ks.setVault(null); ks.setLocked(null); ks.setSecrets({}); ks.setGkeys({});
  t.adoptPersonal(null); t.setAcct(null); ks.setIdb(async () => null);
  Object.assign(t.state, { gid: null, g: null });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: fakePasskey() });
  globalThis.zigs = { use: async () => null };
  storage.clear();
  await ks.persist(); // A successful save also clears a previous transient write failure.
  storage.set("zf-secrets", JSON.stringify({ "wallet:1": { keyPackage: marker } }));
  storage.set("zf-keys", JSON.stringify({ wallet: "k".repeat(43) }));
}
async function check(name, run) {
  await reset();
  await run();
  cases += 1;
  const completed = ["completed activation", "complete unlock", "legacy vault unlock",
    "identical leftovers"].includes(name);
  assert.equal(ks.passkeyProtected(), completed,
    name + ": only a fully completed operation is ready for new setup");
}
function blocked() {
  assert.throws(ks.requirePasskeyProtection, /Protect this browser with a passkey/);
}
const cancelled = () => { throw new DOMException("Cancelled", "NotAllowedError"); };
const foreign = await seal(await aesKey(new Uint8Array(32).fill(9)),
  { cred: "b3RoZXI", salt: "b3RoZXI" }, { secrets: { foreign: true } });
const foreignText = JSON.stringify(foreign);

await check("no fake completion", async () => {
  blocked();
  ks.setVault({ rec: { cred: "YQ", salt: "Yg" }, key });
  assert.equal(ks.passkeyProtected(), false, "a setter cannot assert verified protection");
  blocked();
});
await check("no Web Locks", async () => {
  let prompted = false;
  delete navigator.locks;
  navigator.credentials.create = async () => { prompted = true; };
  await assert.rejects(ks.lockWithPasskey, /Web Locks/);
  assert.equal(prompted, false, "unsafe activation never starts the credential prompt");
  assert.equal(storage.has("zf-vault"), false);
  blocked();
});
await check("unsupported browser", async () => {
  globalThis.window = {};
  await assert.rejects(ks.lockWithPasskey, /no passkey support/);
  assert.equal(storage.has("zf-vault"), false);
});
await check("creation cancelled", async () => {
  navigator.credentials.create = cancelled;
  await assert.rejects(ks.lockWithPasskey, { name: "NotAllowedError" });
  assert.equal(storage.has("zf-vault"), false);
  assert.ok(storage.get("zf-secrets").includes(marker));
});
await check("assertion cancelled", async () => {
  navigator.credentials.get = cancelled;
  await assert.rejects(ks.lockWithPasskey, { name: "NotAllowedError" });
  assert.equal(storage.has("zf-vault"), false);
});
await check("missing creation PRF", async () => {
  navigator.credentials.create = async () => ({ getClientExtensionResults: () => ({}) });
  await assert.rejects(ks.lockWithPasskey, /does not support the PRF extension/);
  assert.equal(storage.has("zf-vault"), false);
});
await check("missing assertion PRF", async () => {
  navigator.credentials.get = async () => ({ getClientExtensionResults: () => ({}) });
  await assert.rejects(ks.lockWithPasskey, /does not support the PRF extension/);
  assert.equal(storage.has("zf-vault"), false);
});
await check("completed activation", async () => {
  const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
  let release, entered;
  const reading = new Promise((done) => { entered = done; });
  crypto.subtle.decrypt = async (...args) => {
    entered();
    await new Promise((done) => { release = done; });
    return decrypt(...args);
  };
  const activation = ks.lockWithPasskey();
  await reading;
  assert.ok(ks.vault, "the existing key is available before read-back finishes");
  assert.equal(ks.passkeyProtected(), false, "a partial vault cannot unlock setup");
  blocked();
  await assert.rejects(ks.lockWithPasskey, /still being enabled/);
  release();
  await activation;
  restoreDecrypt();
  assert.deepEqual(navigator.locks.requested, ["zigs-account", "zigs-secrets"]);
  ks.requirePasskeyProtection();
  const got = await open(key, parseVault(storage.get("zf-vault")));
  assert.equal(got.secrets["wallet:1"].keyPackage, marker);
  assert.equal(storage.has("zf-secrets"), false);
  assert.equal(storage.has("zf-keys"), false);
  assert.equal(storage.has("zf-chats"), false);
  assert.equal(storage.has(ks.RECIPIENTS_KEY), false);
});
await check("write failure", async () => {
  localStorage.setItem = (name, value) => {
    if (name === "zf-vault") throw new Error("quota");
    originalStorage.setItem(name, value);
  };
  await assert.rejects(ks.lockWithPasskey, /locked copy was not saved/);
  assert.ok(storage.get("zf-secrets").includes(marker));
  assert.equal(storage.has("zf-vault"), false);
});
await check("failed read-back", async () => {
  localStorage.setItem = (name, value) => {
    const rec = name === "zf-vault" ? JSON.parse(value) : null;
    originalStorage.setItem(name, rec ? JSON.stringify({ ...rec, box: "AAAA" }) : value);
  };
  await assert.rejects(ks.lockWithPasskey, /protection is incomplete/);
  assert.ok(storage.get("zf-secrets").includes(marker));
  assert.equal(storage.has("zf-vault"), false, "only the failed candidate is rolled back");
});
await check("other tab before prompt", async () => {
  storage.set("zf-vault", foreignText);
  let prompted = false;
  navigator.credentials.create = async () => { prompted = true; };
  await assert.rejects(ks.lockWithPasskey, /already exists/);
  assert.equal(prompted, false);
  assert.equal(storage.get("zf-vault"), foreignText);
});
await check("queued tab loses activation", async () => {
  let release, entered, prompted = false;
  const held = new Promise((done) => { entered = done; });
  const otherTab = navigator.locks.request("zigs-secrets", () => {
    entered(); return new Promise((done) => { release = done; });
  });
  await held;
  navigator.credentials.create = async () => { prompted = true; };
  const activating = ks.lockWithPasskey();
  await new Promise((done) => setTimeout(done, 0));
  assert.deepEqual(navigator.locks.requested,
    ["zigs-secrets", "zigs-account", "zigs-secrets"]);
  storage.set("zf-vault", foreignText);
  release();
  await otherTab;
  await assert.rejects(activating, /already exists/);
  assert.equal(prompted, false, "a queued loser checks again under the shared Web Lock");
  assert.equal(storage.get("zf-vault"), foreignText);
});
await check("other tab during prompt", async () => {
  const create = navigator.credentials.create;
  navigator.credentials.create = async (options) => {
    storage.set("zf-vault", foreignText);
    return create(options);
  };
  await assert.rejects(ks.lockWithPasskey, /already exists/);
  assert.equal(storage.get("zf-vault"), foreignText, "the loser never erases the other vault");
  assert.ok(storage.get("zf-secrets").includes(marker));
});
await check("other tab during read-back", async () => {
  const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
  crypto.subtle.decrypt = async (...args) => {
    const result = await decrypt(...args);
    storage.set("zf-vault", foreignText);
    return result;
  };
  await assert.rejects(ks.lockWithPasskey, /changed while it was being checked/);
  assert.equal(storage.get("zf-vault"), foreignText);
  assert.ok(storage.get("zf-secrets").includes(marker),
    "cleanup waits for the final identity check");
});
await check("plaintext cleanup failure", async () => {
  localStorage.removeItem = (name) => {
    if (name === "zf-secrets") throw new Error("deletion denied");
    originalStorage.removeItem(name);
  };
  await assert.rejects(ks.lockWithPasskey, /deletion denied/);
  assert.ok(storage.has("zf-vault") && storage.has("zf-secrets"));
  assert.ok(ks.vault, "the usable current-tab key remains available for recovery");
  await assert.rejects(ks.lockWithPasskey, /already exists/);
  blocked();
});
await check("complete unlock", async () => {
  await ks.lockWithPasskey();
  const saved = parseVault(storage.get("zf-vault"));
  ks.setVault(null); ks.setLocked(saved);
  assert.equal(ks.passkeyProtected(), false);
  await ks.unlockVault();
  ks.requirePasskeyProtection();
});
await check("legacy vault unlock", async () => {
  await ks.lockWithPasskey();
  const rec = parseVault(storage.get("zf-vault")), old = await open(key, rec);
  delete old.recipients;
  const legacy = await seal(key, rec, old);
  storage.set("zf-vault", JSON.stringify(legacy));
  ks.setVault(null); ks.setLocked(legacy);
  await ks.unlockVault();
  ks.requirePasskeyProtection();
  assert.equal(storage.has(ks.RECIPIENTS_KEY), false,
    "a valid old vault with no address book does not need a migration record");
});
await check("identical leftovers", async () => {
  await ks.lockWithPasskey();
  const rec = parseVault(storage.get("zf-vault")), data = await open(key, rec);
  storage.set("zf-secrets", JSON.stringify(data.secrets));
  storage.set("zf-keys", "{}");
  storage.set("zf-chats", JSON.stringify(data.chats));
  ks.setVault(null); ks.setLocked(rec);
  await ks.unlockVault();
  assert.equal(storage.has("zf-secrets"), false);
  assert.equal(storage.has("zf-keys"), false);
  assert.equal(storage.has("zf-chats"), false);
});
await check("unique leftover share", async () => {
  await ks.lockWithPasskey();
  const rec = parseVault(storage.get("zf-vault"));
  const unique = '{ "other:2": { "keyPackage": "another synthetic share" } }  ';
  storage.set("zf-secrets", unique);
  storage.set("zf-keys", '{ "other": "different wallet key" }');
  ks.setVault(null); ks.setLocked(rec);
  await ks.unlockVault();
  assert.equal(storage.get("zf-secrets"), unique,
    "unlock never deletes a share absent from the verified encrypted record");
  assert.equal(storage.get("zf-keys"), '{ "other": "different wallet key" }');
  assert.equal(ks.secrets["wallet:1"].keyPackage, marker,
    "the existing vault remains usable while new setup stays blocked");
  blocked();
});
await check("unique leftover recipient", async () => {
  await ks.lockWithPasskey();
  const rec = parseVault(storage.get("zf-vault"));
  const unique = '{ "version": 1, "entries": [{ "name": "Only in this old copy" }] }  ';
  storage.set(ks.RECIPIENTS_KEY, unique);
  ks.setVault(null); ks.setLocked(rec);
  await ks.unlockVault();
  assert.equal(storage.get(ks.RECIPIENTS_KEY), unique,
    "a separate address book is never erased merely because the modern vault opens");
  blocked();
});
await check("wrong unlock key", async () => {
  await ks.lockWithPasskey();
  ks.setLocked(parseVault(storage.get("zf-vault"))); ks.setVault(null);
  const nav = fakePasskey(fakeLocks(), new Uint8Array(32).fill(8));
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: nav });
  await assert.rejects(ks.unlockVault, /does not open the saved keys/);
  blocked();
});
await check("account cleanup failure", async () => {
  const account = newPersonal({ seed: "01".repeat(32), network: "testnet", birthday: 1000 },
    "a".repeat(43));
  const deviceKey = await aesKey(new Uint8Array(32).fill(2));
  const deviceRec = await seal(deviceKey, { cred: "device", salt: "device" }, account);
  const device = new Map([["personal:key", deviceKey], ["personal:rec", deviceRec]]);
  globalThis.indexedDB = {};
  ks.setIdb(async (_mode, fn) => fn({ get: (name) => device.get(name),
    delete: () => { throw new Error("account deletion denied"); } }));
  await assert.rejects(ks.lockWithPasskey, /account deletion denied/);
  assert.equal(device.get("personal:rec"), deviceRec);
  const got = await open(key, parseVault(storage.get("zf-vault")));
  assert.equal(got.personal.seed, account.seed, "the sealed copy is still usable");
  blocked();
  ks.setLocked(parseVault(storage.get("zf-vault"))); ks.setVault(null);
  t.setAcct({ secret: account.snapKey }); // Keep this recovery test entirely offline.
  await ks.unlockVault();
  assert.equal(device.get("personal:rec"), deviceRec);
  blocked();
});
await check("account cleanup not persisted", async () => {
  const account = newPersonal({ seed: "02".repeat(32), network: "testnet", birthday: 1000 },
    "b".repeat(43));
  const deviceKey = await aesKey(new Uint8Array(32).fill(2));
  const deviceRec = await seal(deviceKey, { cred: "device", salt: "device" }, account);
  const device = new Map([["personal:key", deviceKey], ["personal:rec", deviceRec]]);
  globalThis.indexedDB = {};
  ks.setIdb(async (_mode, fn) => fn({ get: (name) => device.get(name), delete: () => {} }));
  await assert.rejects(ks.lockWithPasskey, /device account copy could not be removed/);
  assert.equal(device.get("personal:key"), deviceKey,
    "a successful delete request alone never confirms protection");
});
await check("source damaged during prompt", async () => {
  const create = navigator.credentials.create, damaged = "{ damaged saved secrets  ";
  navigator.credentials.create = async (options) => {
    storage.set("zf-secrets", damaged);
    return create(options);
  };
  await assert.rejects(ks.lockWithPasskey, /saved keys could not be read/);
  assert.equal(storage.get("zf-secrets"), damaged, "the original opaque record is never erased");
  assert.equal(storage.has("zf-vault"), false);
});
restoreDecrypt();
console.log("passkey-setup: ok (" + cases + " completion, failure and cross-tab cases)");
process.exit(0);
