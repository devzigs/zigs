// Device-wide recipient CRUD, strict formats, vault migration and existing Send-field selection.
// Run: node web/test/recipients.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import * as Z from "../pkg/zigs_engine.js";
import { aesKey, open, seal } from "../vault.js";
import {
  changeRecipient, checkedRecipient, emptyRecipients, matchingRecipients, readRecipients,
  publicSolAddress, shieldedSolAddress,
} from "../recipients.js";
import { base58, keyOfBase58 } from "../sol/docs.js";
import { isAddress } from "../sol/intent.js";
import { fakeLocks } from "./passkey-fixture.mjs";

Z.initSync({ module: fs.readFileSync(new URL("../pkg/zigs_engine_bg.wasm", import.meta.url)) });
const address = JSON.parse(Z.accountKeys("01".repeat(32), "testnet")).address;
const zec = { name: "Studio", address, asset: "ZEC", network: "testnet", type: "shielded" };
const sol = { name: "SOL partner", address: "ab".repeat(99), asset: "SOL", network: "devnet", type: "shielded" };
const pub = { ...sol, name: "Public partner", address: "1".repeat(32), type: "public" };
const normalize = Z.normalizeAddress;
assert.equal(checkedRecipient({ ...zec, name: " Studio " }, normalize).name, "Studio");
for (const value of [
  { ...zec, address: "studio.zec" }, { ...zec, address: "zcash:" + address },
  { ...zec, network: "mainnet" }, { ...zec, type: "public" }, { ...zec, asset: "USDC" },
  { ...sol, address: pub.address }, { ...pub, address: sol.address },
  { ...sol, network: "mainnet" }, { ...zec, name: "bad\nlabel" },
]) assert.throws(() => checkedRecipient(value, normalize), /Enter|Choose/);
assert.deepEqual(checkedRecipient(sol, normalize), sol);
assert.deepEqual(checkedRecipient(pub, normalize), pub);
for (const text of ["", "0".repeat(32), "1".repeat(31), "1".repeat(32), "1".repeat(33),
  ...Array.from({ length: 100 }, (_, i) => base58(i.toString(16).padStart(64, "0"))),
  ...Array.from({ length: 50 }, () => base58(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")))]) {
  assert.equal(publicSolAddress(text), keyOfBase58(text) !== null, "public format matches existing Solana Send");
}
for (const text of ["", "ab".repeat(99), "ab".repeat(98), "AB".repeat(99), "gg".repeat(99)]) {
  assert.equal(shieldedSolAddress(text), isAddress(text), "shielded format matches existing Solana Send");
}
const first = changeRecipient(emptyRecipients(), null, zec, "01".repeat(16));
const saved = first.entries[0];
assert.throws(() => readRecipients({ ...first, version: 2 }), /cannot be read/);
assert.throws(() => readRecipients({ ...first, entries: [{ ...saved, memo: "secret" }] }), /cannot be read/);
assert.throws(() => readRecipients({ ...first, entries: [saved, saved] }), /cannot be read/);
assert.throws(() => changeRecipient(first, null, { ...zec, name: "Duplicate" }, "02".repeat(16)), /already/);
const renamed = changeRecipient(first, saved, { ...zec, name: "Studio new" });
assert.throws(() => changeRecipient(renamed, saved, zec), /another tab/);
assert.throws(() => changeRecipient(renamed, saved, null), /another tab/);
assert.equal(matchingRecipients(renamed, { asset: "ZEC", network: "mainnet" }).length, 0);
assert.equal(matchingRecipients(renamed, {}, "TESTNET")[0].name, "Studio new");
assert.deepEqual(changeRecipient(renamed, renamed.entries[0], null), emptyRecipients());

const stub = () => new Proxy(function () {}, {
  get: (t, k) => k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : stub(),
  apply: () => stub(), construct: () => stub(), set: () => true, has: () => true,
});
class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.listeners = {}; this.value = ""; this.style = {}; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (["id", "value"].includes(k)) this[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(k, v) { (this.listeners[k] ||= []).push(v); }
  append(...kids) { this.children.push(...kids); }
  replaceChildren(...kids) { this.children = kids; }
  dispatchEvent(event) {
    Object.defineProperty(event, "target", { value: this, configurable: true });
    for (const f of this.listeners[event.type] || []) f(event);
    return true;
  }
  focus() { document.activeElement = this; }
  remove() {}
}
const storage = new Map(), listeners = {};
let blockedWrites = false;
Object.assign(globalThis, {
  Node: Element, document: new Proxy(stub(), { get: (t, k) => ({
    createElement: (tag) => new Element(tag), createTextNode: (text) => String(text),
    getElementById: () => stub(),
  })[k] ?? t[k] }), history: { replaceState() {} }, requestAnimationFrame: () => 0,
  matchMedia: () => ({ matches: false }),
  location: { hash: "", href: "http://localhost/", origin: "http://localhost" },
  localStorage: { getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => { if (blockedWrites) throw new Error("quota"); storage.set(k, String(v)); },
    removeItem: (k) => { storage.delete(k); } },
  window: new Proxy(stub(), { get: (t, k) => ({ crypto, addEventListener: (name, fn) => {
    (listeners[name] ||= []).push(fn);
  } })[k] ?? t[k] }),
  zigs: { use: async () => stub() },
});
// Banners are existing UI, not the subject of this test.
document.getElementById = () => ({ setAttribute() {}, hidden: false, remove() {} });
const { loadPage } = await import("./page.mjs");
const t = await loadPage();
t.setZ(Z);
const ks = await import("../app-keystore.js");
const view = await import("../app-recipients.js");
ks.setIdb(async () => null);
await ks.saveRecipient(zec);
assert.equal(ks.recipients.entries.length, 1);
assert.deepEqual(JSON.parse(storage.get(ks.RECIPIENTS_KEY)), ks.recipients);
const original = { ...ks.recipients.entries[0] };
// A save event is late: mutation rereads storage before adding, and a stale edit is refused.
const elsewhere = changeRecipient(ks.recipients, null, sol, "09".repeat(16));
storage.set(ks.RECIPIENTS_KEY, JSON.stringify(elsewhere));
await ks.saveRecipient(pub);
assert.equal(ks.recipients.entries.length, 3, "keeps another tab's addition before the event arrives");
await ks.saveRecipient({ ...zec, name: "Renamed" }, original);
await assert.rejects(ks.deleteRecipient(original), /another tab/);
const beforeFailure = structuredClone(ks.recipients);
blockedWrites = true;
await assert.rejects(ks.saveRecipient({ ...zec, name: "Not saved" }, ks.recipients.entries[0]), /could not be saved/);
assert.deepEqual(ks.recipients, beforeFailure, "failed save does not claim a successful edit");
blockedWrites = false;
storage.set(ks.RECIPIENTS_KEY, "{damaged");
await assert.rejects(ks.saveRecipient(zec), /cannot be read/);
assert.equal(storage.get(ks.RECIPIENTS_KEY), "{damaged", "never erases damaged plain data");
storage.set(ks.RECIPIENTS_KEY, JSON.stringify(beforeFailure));
await ks.takeFromTab(ks.RECIPIENTS_KEY);

// No spending wallet is selected merely by opening or editing the global book.
const gidBefore = t.state.gid;
view.recipientsView();
assert.equal(t.state.gid, gidBefore);
const walk = (node) => [node, ...(node?.children || []).flatMap(walk)];
const find = (node, id) => walk(node).find((n) => n?.id === id);
Object.assign(t.state, { gid: "wallet", g: { n: 2, t: 2, network: "testnet" },
  wallet: { address: "utest1other" }, seats: {} });
Object.assign(t.ui, { send: true, sendReview: null, sendMove: null, after: null, note: "Note stays",
  pay: [{ k: 1, to: "old.zec", name: "old", shown: { typed: "old.zec" }, amt: "1.25", memo: "Keep memo" },
    { k: 2, to: address, amt: "2", memo: "Second memo" }] });
// Avoid a name lookup: an existing shown result would otherwise ask the live registry.
t.ui.pay[0].to = "";
const dialog = t.sendDialog(), picker = find(dialog, "s-saved-1");
assert.ok(picker);
picker.value = ks.recipients.entries.find((r) => r.asset === "ZEC").id;
picker.dispatchEvent(new Event("change"));
assert.deepEqual(t.ui.pay.map((r) => [r.to, r.amt, r.memo]),
  [[address, "1.25", "Keep memo"], [address, "2", "Second memo"]]);
assert.equal(t.ui.pay[0].name, null, "selection clears a stale ZNS association through the existing field");
assert.equal(t.ui.note, "Note stays");
assert.equal(t.ui.sendReview, null, "selection opens no review or payment");
assert.equal(t.state.sid, null, "selection submits no proposal");
const publicPicker = view.recipientSelect({ asset: "SOL", network: "devnet", type: "public", onSelect() {} });
assert.equal(walk(publicPicker).filter((n) => n?.tagName === "OPTION").length, 2,
  "public withdrawals cannot select shielded destinations");
const stale = view.recipientSelect({ asset: "SOL", network: "devnet", type: "shielded", onSelect() {
  assert.fail("a stale picker must not fill a changed address");
}, id: "stale" });
const s = ks.recipients.entries.find((r) => r.asset === "SOL" && r.type === "shielded");
await ks.deleteRecipient(s);
find(stale, "stale").value = s.id;
find(stale, "stale").dispatchEvent(new Event("change"));
assert.match(find(stale, "stale-hint").textContent, /changed/);

// The existing passkey mechanism migrates plaintext into its existing AES-GCM record.
const bytes = new Uint8Array(32).fill(7), key = await aesKey(bytes);
Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
  locks: fakeLocks(), credentials: {
  create: async () => ({ rawId: new Uint8Array([1]), getClientExtensionResults: () => ({ prf: { enabled: true } }) }),
  get: async () => ({ getClientExtensionResults: () => ({ prf: { results: { first: bytes.buffer } } }) }),
} } });
Object.assign(t.state, { gid: null, g: null, wallet: null });
await ks.lockWithPasskey();
assert.equal(storage.has(ks.RECIPIENTS_KEY), false, "only the sealed copy remains after locking");
const rec = JSON.parse(storage.get("zf-vault")), encrypted = storage.get("zf-vault");
assert.ok(!encrypted.includes("Renamed") && !encrypted.includes(address));
const held = await open(key, rec);
assert.deepEqual(held.recipients, ks.recipients);
const savedSealedBook = structuredClone(ks.recipients);
blockedWrites = true;
await assert.rejects(ks.saveRecipient({ ...ks.recipients.entries[0], name: "Not saved under lock" },
  ks.recipients.entries[0]), /could not be saved/);
assert.deepEqual(ks.recipients, savedSealedBook, "failed encrypted save leaves the last saved book in memory");
assert.equal(storage.get("zf-vault"), encrypted, "failed encrypted save leaves the stored key shares and book intact");
blockedWrites = false;
await ks.persistSealed();
// A current or older page's ordinary save must preserve the book and unknown future fields.
storage.set("zf-vault", JSON.stringify(await seal(key, rec, { ...held, future: { keep: true } })));
await ks.persistSealed();
assert.deepEqual((await open(key, JSON.parse(storage.get("zf-vault")))).future, { keep: true });
const sealedBefore = await open(key, JSON.parse(storage.get("zf-vault")));
sealedBefore.recipients = { version: 3, entries: ["future format"] };
storage.set("zf-vault", JSON.stringify(await seal(key, rec, sealedBefore)));
await ks.takeFromTab("zf-vault");
await assert.rejects(ks.saveRecipient(zec), /cannot be read/);
await ks.persistSealed();
assert.deepEqual((await open(key, JSON.parse(storage.get("zf-vault")))).recipients,
  sealedBefore.recipients, "unrelated vault saves preserve an unreadable book whole");
storage.set("zf-vault", JSON.stringify(await seal(key, rec, held)));
await ks.takeFromTab("zf-vault");
await ks.deleteRecipient(ks.recipients.entries[0]);
const afterDelete = await open(key, JSON.parse(storage.get("zf-vault")));
assert.equal(afterDelete.recipients.entries.length, held.recipients.entries.length - 1);
ks.setLocked(JSON.parse(storage.get("zf-vault")));
await assert.rejects(ks.deleteRecipient(ks.recipients.entries[0]), /locked/);
ks.setLocked(null);
// Deletion sync comes in whole rather than resurrecting an entry from this tab.
const emptied = { ...afterDelete, recipients: emptyRecipients() };
storage.set("zf-vault", JSON.stringify(await seal(key, rec, emptied)));
await ks.takeFromTab("zf-vault");
assert.deepEqual(ks.recipients, emptyRecipients());
// Optional damaged metadata must not block the existing wallet lock or lose readable data.
ks.setVault(null);
storage.delete("zf-vault");
storage.set("zf-secrets", JSON.stringify({ "wallet:1": { keyPackage: "keep this key share" } }));
storage.set("zf-keys", "{}");
storage.set("zf-chats", "{}");
const brokenText = "{ damaged book with exact spacing  ";
storage.set(ks.RECIPIENTS_KEY, brokenText);
await ks.lockWithPasskey();
const opaque = await open(key, JSON.parse(storage.get("zf-vault")));
assert.equal(opaque.recipients, brokenText, "malformed JSON is sealed as exact opaque text");
assert.equal(opaque.secrets["wallet:1"].keyPackage, "keep this key share", "existing key shares stay intact");
assert.equal(storage.has(ks.RECIPIENTS_KEY), false, "verified opaque copy permits plaintext cleanup");
ks.setVault(null);
ks.setLocked(JSON.parse(storage.get("zf-vault")));
await ks.unlockVault();
assert.match(ks.recipientsBlocked(), /cannot be read/, "corrupt book remains disabled after unlock");
assert.equal(ks.secrets["wallet:1"].keyPackage, "keep this key share");
// An old tab's vault with no book field migrates a readable plain book during unlock too.
const oldRecord = { ...opaque };
delete oldRecord.recipients;
storage.set("zf-vault", JSON.stringify(await seal(key, rec, oldRecord)));
storage.set(ks.RECIPIENTS_KEY, brokenText);
ks.setVault(null);
ks.setLocked(JSON.parse(storage.get("zf-vault")));
await ks.unlockVault();
assert.equal((await open(key, JSON.parse(storage.get("zf-vault")))).recipients, brokenText);
assert.equal(storage.has(ks.RECIPIENTS_KEY), false);
console.log("recipients ok: strict formats, CRUD, stale tabs, failed saves, Send selection and vault migration");
process.exit(0);
