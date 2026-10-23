// Guided education, strict passive reports, persistence and no new authorization authority.
// Run: node web/test/guided-setup.mjs (Node 26)
import assert from "node:assert/strict";
import fs from "node:fs";
import * as Z from "../pkg/zigs_engine.js";
import { newSignKey, signMsg, verifyMsg } from "../chat.js";
import { filterWallet, writerOf } from "../signed.js";
import { actualSafety, deriveGuidedSetup, emptyGuidedRecord, GUIDED_STAGES,
  readGuidedRecord, readSetupReports } from "../guided-setup-model.js";

Z.initSync({ module: fs.readFileSync(new URL("../pkg/zigs_engine_bg.wasm", import.meta.url)) });
const gid = "0123456789abcdef0123", no = "12345 67890 12345 67890 12345 67890";
const readyFacts = { created: true, n: 3, t: 2, seated: 3, confirmed: 3,
  zecReady: true, zecVerified: 3, solWanted: true, solStatus: "ready",
  backups: [{ seat: 1, local: true, zec: true, sol: true }] };
const derive = (change) => deriveGuidedSetup({ ...readyFacts, ...change });
assert.deepEqual(GUIDED_STAGES, ["Plan", "Connect", "Verify", "Prepare", "Back up"]);
for (const [facts, expected] of [
  [{ created: false }, "Plan"], [{ seated: 2 }, "Connect"], [{ confirmed: 2 }, "Verify"],
  [{ zecVerified: 2 }, "Prepare"], [{ zecReady: false }, "Prepare"],
  [{ solStatus: "running" }, "Prepare"], [{ solStatus: "unavailable" }, "Prepare"],
  [{ solStatus: "differs" }, "Prepare"], [{ solStatus: "stopped" }, "Prepare"],
  [{}, "Back up"],
]) assert.equal(derive(facts).stage, expected);
assert.equal(derive({}).complete, true, "formation permits leaving; backups are optional");
assert.equal(derive({}).protocolReady, true);
assert.deepEqual(derive({}).backupWaiting, [2, 3], "remote pending remains visible");
assert.equal(derive({ backups: [] }).complete, true, "zero saved files cannot block Overview");
assert.equal(derive({ backups: [] }).backupSavedCount, 0);
const partial = derive({ backups: [{ seat: 1, local: true, zecSaved: true }] });
assert.equal(partial.protocolReady, true, "one saved file needs no reupload or passphrase check");
assert.equal(partial.backupSavedCount, 1, "one of three devices is real backup progress");
assert.equal(partial.zecSavedCount, 1);
assert.equal(partial.zecCheckedCount, 0, "saving does not imply a checked file");
assert.equal(partial.solSavedCount, 0, "a ZEC backup does not cover SOL");
assert.equal(partial.backupThreshold, 2, "one saved share is fewer than the two required");
assert.equal(partial.backups[0].zecChecked, false);
assert.equal(partial.backups[0].zec, false, "legacy checked alias is never set by saving");
assert.deepEqual(partial.backupCheckWaiting, [1, 2, 3], "checks remain optional and distinct");
const duplicateSeat = derive({ backups: [{ seat: 1, zecSaved: true },
  { seat: 1, zecSaved: true }] });
assert.equal(duplicateSeat.zecSavedCount, 1, "two copies of one share are one independent seat");
assert.equal(derive({ backups: [{ seat: 1, zec: true }] }).backups[0].zecSaved, true,
  "a successfully reopened existing file is also an existing saved copy");
assert.equal(derive({ solWanted: false }).complete, true, "no unavailable chain is invented");
assert.equal(derive({ blocked: "Mismatch" }).complete, false);
assert.equal(derive({ confirmed: 2, completed: true, review: 4 }).complete, false,
  "tutorial flags cannot bypass actual confirmation");
assert.equal(derive({ fees: [] }).complete, true, "fee funding is not initial key preparation");
assert.equal(actualSafety(no.slice(0, 8)), false, "a short quick code is not a safety number");

const clean = emptyGuidedRecord();
assert.deepEqual(readGuidedRecord(clean), clean);
for (const invalid of [null, [], { ...clean, v: 2 }, { ...clean, review: 5 },
  { ...clean, solAuto: true }, { ...clean, safety: "short" },
  { ...clean, checked: { 8: { zec: true, sol: true } } },
  { ...clean, checked: { 1: { zec: true, sol: true, zecFor: "bad", solFor: null } } }]) {
  assert.equal(readGuidedRecord(invalid), null, "unknown or malformed progress stays unread");
}

const keys = await Promise.all([newSignKey(), newSignKey(), newSignKey()]);
async function report(seat, fields = {}) {
  const flags = fields.v === 2 ? { zecSaved: true, solSaved: false,
    zecChecked: false, solChecked: false } : { zec: true, sol: true };
  const f = { v: 1, safety: no, ...flags, ...fields };
  const text = Z.docPayload(gid, "setupstatus/" + seat, seat, JSON.stringify(f));
  return { ...f, by: seat, sig: await signMsg(keys[seat - 1].signSk, text) };
}
async function realReports(entries, safety = no) {
  const verdicts = new Map();
  for (const [id, d] of entries) {
    const { by, sig, ...fields } = d;
    const text = Z.docPayload(gid, "setupstatus/" + id, by, JSON.stringify(fields));
    const pk = keys[by - 1]?.signPk;
    verdicts.set(text + sig, !!pk && await verifyMsg(pk, sig, text));
  }
  return readSetupReports(entries, { n: 3, safety, check: (rel, by, sig, fields, need) => {
    const text = Z.docPayload(gid, rel, by, JSON.stringify(fields));
    return need === by && verdicts.get(text + sig) ? "yes" : "no";
  } });
}
const valid = await report(1);
assert.deepEqual(await realReports([["1", valid]]), {
  1: { zec: true, sol: true, zecChecked: true, solChecked: true,
    zecSaved: true, solSaved: true, reported: true },
});
for (const altered of [{ ...valid, v: 2 }, { ...valid, safety: no.replace("1", "2") },
  { ...valid, zec: false }, { ...valid, sol: false }, { ...valid, by: 2 },
  { ...valid, filename: "private" }, { ...valid, sig: valid.sig.slice(1) }]) {
  assert.deepEqual(await realReports([["1", altered]]), {});
}
assert.deepEqual(await realReports([["2", valid]]), {}, "path and seat cannot be relabelled");
assert.deepEqual(await realReports([["1", valid]], no.replace("1", "2")), {});
const v2 = await report(2, { v: 2 });
assert.deepEqual(await realReports([["2", v2]]), {
  2: { zec: false, sol: false, zecChecked: false, solChecked: false,
    zecSaved: true, solSaved: false, reported: true },
}, "a signed v2 saved-only report never claims that a file was reopened");
for (const altered of [{ ...v2, zecSaved: false }, { ...v2, solSaved: true },
  { ...v2, zecChecked: true }, { ...v2, solChecked: true }, { ...v2, zec: true },
  { ...v2, filename: "private" }, { ...v2, v: 3 }]) {
  assert.deepEqual(await realReports([["2", altered]]), {}, "strict signed v2 fields");
}
assert.deepEqual(await realReports([["2", await report(2, {
  v: 2, zecSaved: false, zecChecked: true,
})]]), {}, "even a signed report cannot claim a checked file while denying a saved copy");
for (const answer of ["no", "wait"]) {
  assert.deepEqual(readSetupReports([["1", valid]], { n: 3, safety: no, check: () => answer }), {});
}
assert.deepEqual(readSetupReports([["1", valid]], { n: 3, safety: no,
  check: () => { throw new Error("optional check unavailable"); } }), {});
const raw = Object.fromEntries(["seats", "dkg1", "dkg2", "confirm", "abort", "done", "verify",
  "sessions", "commits", "shares"].map((name) => [name, {}]));
raw.wallet = null;
raw.setupstatus = { 1: { ...valid, sig: "forged" } };
const filtered = filterWallet(raw, null, () => "yes", () => {});
assert.equal(filtered.wait, 0, "optional bad reports cannot hold the wallet reactor");
assert.equal(filtered.bad, 0, "reports cannot alter core ignored-data counts");
assert.equal(writerOf("setupstatus/1"), undefined, "core protocol allowlist is unchanged");

const storage = new Map();
let failWrite = false;
const nativeInterval = globalThis.setInterval, unitIntervals = new Set();
const stub = () => new Proxy(function () {}, {
  get: (_t, k) => k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : stub(),
  apply: () => stub(), construct: () => stub(), set: () => true,
});
Object.assign(globalThis, {
  document: stub(), window: stub(), history: { replaceState() {} },
  location: { hash: "", href: "http://localhost/", origin: "http://localhost" },
  localStorage: { getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => { if (failWrite) throw new Error("quota"); storage.set(k, String(v)); },
    removeItem: (k) => storage.delete(k) },
  zigs: { use: async () => stub() }, requestAnimationFrame: () => 0, setTimeout: () => 0,
  setInterval: (callback, delay) => {
    const timer = nativeInterval(callback, delay);
    unitIntervals.add(timer);
    return timer;
  },
  matchMedia: () => ({ matches: false }),
});
const { loadPage } = await import("./page.mjs");
const page = await loadPage();
page.setZ(Z);
// Let the existing asynchronous browser signing-capability probe finish before this isolated
// fixture is installed. Its normal refilter is deliberately independent of tutorial state.
while (page.signing === null) await new Promise(setImmediate);
const guide = await import("../app-guided-setup.js");
const key = "zf-guided-setup:" + gid;
assert.equal(guide.guidedEnabled(gid), false, "established wallets are not enrolled silently");
guide.beginGuided(gid, { solExpected: true });
assert.equal(guide.guidedEnabled(gid), true);
guide.pauseGuided(gid);
assert.equal(guide.guidedRecord(gid).paused, true);
guide.resumeGuided(gid);
assert.equal(guide.guidedRecord(gid).paused, false);
failWrite = true;
assert.throws(() => guide.pauseGuided(gid), /could not save tutorial progress/);
assert.equal(guide.guidedRecord(gid).paused, true,
  "failed save keeps only educational memory");
failWrite = false;
guide.resumeGuided(gid);
assert.equal(JSON.parse(storage.get(key)).paused, false, "a later save can recover");
const other = "f".repeat(20), opaque = JSON.stringify({ v: 99, future: "preserve" });
storage.set("zf-guided-setup:" + other, opaque);
assert.throws(() => guide.beginGuided(other), /stored copy is kept/);
assert.equal(storage.get("zf-guided-setup:" + other), opaque);
assert.equal(guide.guidedEnabled(other), true, "unknown stored record permits memory-only guide");
assert.equal(page.state.gid, null, "tutorial edits do not select a wallet or create shares");
const wallet = { birthday: 1, address: "utest1synthetic" };
const held = { uid: "local-device", version: 3, keyPackage: { signing_share: "a".repeat(64) },
  publicKeyPackage: {}, groupKey: "b".repeat(64), ...keys[0],
  checkedWallet: JSON.stringify(wallet) };
page.setSecrets({ [gid + ":1"]: held });
Object.assign(page.state, { gid, wallet, g: { id: gid, n: 3, t: 2, version: 3,
  network: "testnet" }, seats: Object.fromEntries([1, 2, 3].map((i) => [i,
    { uid: i === 1 ? held.uid : "remote-device-" + i, boxPk: String(i).repeat(64),
      signPk: keys[i - 1].signPk }])),
  verify: { 2: { ok: true }, 3: { ok: true } }, confirm: {} });
const actualNo = page.safetyNo();
assert.ok(actualSafety(actualNo));
page.state.confirm = Object.fromEntries([1, 2, 3].map((i) => [i, { number: actualNo }]));
const snapshots = [], writes = [];
let holdNextWrite = false, releaseWrite = null;
async function waitFor(test) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (test()) return;
    await new Promise(setImmediate);
  }
  assert.fail("the expected asynchronous report did not arrive");
}
const store = {
  collection: () => ({ onSnapshot: (next, fail) => {
    const watcher = { next, fail, stopped: false };
    snapshots.push(watcher);
    return () => { watcher.stopped = true; };
  } }),
  doc: (path) => ({ set: async (data) => {
    writes.push({ path, data });
    if (holdNextWrite) {
      holdNextWrite = false;
      await new Promise((resolve) => { releaseWrite = resolve; });
    }
  } }),
};
const stopReports = guide.watchGuidedReports(gid, store);
assert.throws(() => guide.completeGuided(), /remaining setup steps/,
  "optional backup rules do not bypass required Solana formation");
const zecOnly = guide.guidedRecord(gid);
zecOnly.solExpected = false;
storage.set(key, JSON.stringify(zecOnly));
assert.equal(guide.guidedState().protocolReady, true);
guide.completeGuided();
assert.equal(guide.guidedRecord(gid).completed, true, "host permits zero-backup completion");
assert.equal(guide.guidedState().backupSavedCount, 0);
guide.beginGuided(gid, { solExpected: true });
held.backupSaved = true;
const storedTutorial = storage.get(key);
storage.delete(key);
guide.reportBackupSaved(gid, 1);
await guide.retryGuidedReports();
assert.equal(storage.has(key), false, "reporting saved files creates no tutorial or check record");
storage.set(key, storedTutorial);
assert.equal(guide.guidedState().backupSavedCount, 1);
assert.equal(guide.guidedState().backups[0].zecSaved, true);
assert.equal(guide.guidedState().backups[0].zecChecked, false);
assert.equal(writes[0].data.v, 2, "new writers use only the truthful saved/checked schema");
assert.equal(writes[0].data.zecSaved, true);
assert.equal(writes[0].data.zecChecked, false);
const beforeWrongWallet = writes.length;
guide.reportBackupSaved(other, 1);
assert.equal(writes.length, beforeWrongWallet, "a late save cannot report another wallet");
await guide.markBackupChecked(gid, 1, "zec");
await guide.retryGuidedReports();
const saved = guide.guidedRecord(gid);
assert.match(saved.checked[1].zecFor, /^[0-9a-f]{64}$/);
assert.equal(guide.guidedState().backups[0].zec, true);
assert.equal(guide.guidedState().complete, false, "display-only SOL expectation remains pending");
const sent = writes.at(-1);
assert.equal(sent.path, "groups/" + gid + "/setupstatus/1");
assert.deepEqual(Object.keys(sent.data).sort(),
  ["by", "safety", "sig", "solChecked", "solSaved", "v", "zecChecked", "zecSaved"]);
assert.equal(sent.data.zecSaved, true);
assert.equal(sent.data.zecChecked, true);
assert.equal(sent.data.solChecked, false);
const { by: sentBy, sig: sentSig, ...sentFields } = sent.data;
assert.equal(await verifyMsg(keys[0].signPk, sentSig,
  Z.docPayload(gid, "setupstatus/1", sentBy, JSON.stringify(sentFields))), true);
const snapshot = (data) => ({ docs: Object.entries(data)
  .map(([id, d]) => ({ id, data: () => d })) });
snapshots[0].fail();
assert.match(guide.guidedState().reportIssue, /could not be read/);
snapshots[0].next(snapshot({ 1: { ...sent.data, v: 99 } }));
assert.equal(guide.guidedState().reportIssue, "");
assert.deepEqual(guide.setupReports(), {});
assert.equal(page.state.pending, false, "report signature checks add no authorization wait");
snapshots[0].next(snapshot({}));
assert.deepEqual(guide.setupReports(), {}, "deleted reports do not leave a completion claim");
held.keyPackage = { signing_share: "c".repeat(64) };
assert.equal(guide.guidedState().backups[0].zec, false,
  "a changed local share invalidates the previously checked flag");
await guide.retryGuidedReports();
assert.equal(writes.at(-1).data.zecChecked, false, "retry cannot publish stale raw local checks");
assert.equal(writes.at(-1).data.zecSaved, true, "the existing saved flag is separate from checks");
const beforeDelay = writes.length;
holdNextWrite = true;
await guide.markBackupChecked(gid, 1, "zec");
await waitFor(() => releaseWrite !== null);
assert.equal(guide.guidedState().backups[0].zec, true,
  "a delayed remote write does not hold local file-check completion");
held.sol = { keyPackage: { signing_share: "d".repeat(64) }, publicKeyPackage: {},
  groupKey: "e".repeat(64), solSeed: "f".repeat(64), cluster: "devnet" };
await guide.markBackupChecked(gid, 1, "sol");
assert.equal(guide.guidedState().backups[0].sol, true,
  "another local check completes while the older report is still pending");
assert.equal(writes.length, beforeDelay + 1, "the newer report waits for actual write completion");
releaseWrite();
await guide.retryGuidedReports();
assert.equal(writes.at(-1).data.zecChecked, true);
assert.equal(writes.at(-1).data.solChecked, true,
  "the last serialized report keeps both current checks");
assert.ok(writes.every((w) => w.data.v === 2), "saved flags are never sent as legacy check claims");
held.checkedWallet = "rejected-or-changed-document";
await assert.rejects(guide.markBackupChecked(gid, 1, "zec"), /preparation/);
stopReports();
guide.watchGuidedReports(other, store);
snapshots[0].next(snapshot({ 1: sent.data }));
assert.deepEqual(guide.setupReports(), {}, "an old wallet's late snapshot is ignored");
const legacy = "b".repeat(20), legacyShare = { ...held, version: 1,
  checkedWallet: JSON.stringify(wallet) };
page.setSecrets({ [legacy + ":1"]: legacyShare });
Object.assign(page.state, { gid: legacy, wallet, g: { id: legacy, n: 3, t: 2, version: 1,
  network: "testnet" }, seats: { 1: { uid: held.uid, boxPk: "1".repeat(64) } },
  confirm: {}, verify: {} });
guide.beginGuided(legacy);
const writesBeforeLegacy = writes.length;
await guide.markBackupChecked(legacy, 1, "zec");
assert.equal(guide.guidedRecord(legacy).safety, null,
  "legacy local file checking needs no invented safety confirmation");
assert.equal(guide.guidedState().backups[0].zec, true);
assert.equal(writes.length, writesBeforeLegacy,
  "legacy wallets publish no unauthenticated report");
// The real page owns a minute-long balance polling interval. This unit does not sync a chain;
// dispose the page timers it imported so the test exits naturally after its assertions.
for (const timer of unitIntervals) clearInterval(timer);
console.log("guided-setup: ok (optional backups, saved vs checked, strict signed reports, "
  + "storage)");
