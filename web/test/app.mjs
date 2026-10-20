// Drives the real page modules with a stub page and an in-memory store, for the version 3 rules
// that need the whole page: the pins, the filter, the writers and the ceremony.
// Run: node web/test/app.mjs
// The test loads the real page modules through page.mjs (the names it reads: NAMES there).
import assert from "node:assert/strict";
import fs from "node:fs";
import * as Z from "../pkg/zigs_engine.js";
import { newSignKey, signMsg, verifyMsg } from "../chat.js";
import { memoError } from "../payees.js";
import { HIGH_TEXT as HIGH } from "../personal.js";
import { seatBackedUp } from "../util.js";
import { aesKey, open as openVault, seal } from "../vault.js";
import { createRegistry, registry, ZNS_KEY } from "../zns.js";
import { loadPage, stallFreeClock } from "./page.mjs";

const web = new URL("../", import.meta.url);
Z.initSync({ module: fs.readFileSync(new URL("pkg/zigs_engine_bg.wasm", web)) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A page that does nothing: any property is a function that returns the page again.
const stub = () => new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : stub()),
  apply: () => stub(), construct: () => stub(), set: () => true, has: () => true,
});
const storage = new Map();
// The listeners of the page on window, so that a test can fire a real storage event.
const windowOn = {};
const onWindow = (type, fn) => { (windowOn[type] ||= []).push(fn); };
const storageEvent = (key) =>
  Promise.all((windowOn.storage || []).map((fn) => fn({ key, newValue: storage.get(key) })));
// The listeners of the page on document, so that a test can press a real key.
const documentOn = {};
const pageDocument = new Proxy(stub(), {
  get: (t, k) => (k === "addEventListener"
    ? (type, fn) => { (documentOn[type] ||= []).push(fn); } : t[k]),
});
Object.assign(globalThis, {
  Node: class {}, document: pageDocument, history: { replaceState() {} },
  requestAnimationFrame: () => 0,
  matchMedia: () => ({ matches: false }),
  location: { hash: "", href: "http://localhost/", origin: "http://localhost" },
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => { storage.set(k, String(v)); }, removeItem: (k) => { storage.delete(k); },
  },
  // The engine takes its random numbers from window.crypto in a page.
  window: new Proxy(stub(), {
    get: (t, k) => ({ crypto: globalThis.crypto, addEventListener: onWindow })[k] ?? t[k],
  }),
});

const t = await loadPage();
// The test clock leaves out a stall, such as a sleep of the computer (VEL-4).
{
  let wall = 1000;
  const clock = stallFreeClock(() => wall, 5000);
  wall += 4000;
  assert.equal(clock(), 5000, "a gap under the limit counts");
  wall += 900000;
  assert.equal(clock(), 5000, "a stall of 15 minutes does not count");
  wall += 300;
  assert.equal(clock(), 5300, "the time goes on after the stall");
  wall += 5000;
  assert.equal(clock(), 10300, "a gap of exactly the limit counts");
  wall -= 60000;
  assert.equal(clock(), 10300, "a step back of the wall clock does not count");
  wall += 100;
  assert.equal(clock(), 10400);
  assert.equal(Date.now.stallFree, true, "loadPage installs the test clock");
}
t.setZ(Z);
await sleep(50);
assert.equal(t.signing, true, "this Node signs with Ed25519");

const settle = async () => {
  for (let i = 0; i < 100; i++) { t.refilter(); await sleep(30); if (!t.state.pending) return; }
  throw new Error("the checks did not end");
};
const waitFor = async (what, ok, ms = 60000) => {
  for (const t0 = Date.now(); !ok();) {
    if (Date.now() - t0 > ms) throw new Error("timeout: " + what);
    await sleep(50);
  }
};
const A = "aaaaaaaaaaaaaaaaaaaa", B = "bbbbbbbbbbbbbbbbbbbb";
const sealed = (gid, rel, seat, fields, key, names = ["by", "sig"]) =>
  signMsg(key.signSk, Z.docPayload(gid, rel, seat, JSON.stringify(fields)))
    .then((sig) => ({ ...fields, [names[0]]: seat, [names[1]]: sig }));

// ── The pins and the filter, with documents that the test signs ──
{
  const keys = { 1: await newSignKey(), 2: await newSignKey(), 3: await newSignKey() };
  const attacker = await newSignKey();
  const seatDoc = (i, key = keys[i]) =>
    ({ uid: "u" + i, name: "S" + i, boxPk: "b" + i, signPk: key.signPk, at: i });
  t.secrets = {};
  t.state.gid = A;
  t.state.g = t.cleanGroup(A, { name: "W", n: 3, t: 2, version: 3, network: "testnet" });
  assert.equal(t.signedMode(A), true, "version 3 is pinned at first sight");
  assert.deepEqual([t.state.g.n, t.state.g.t, t.state.g.shapeMoved], [3, 2, false]);
  // A holder of the link raises n, writes junk, and lowers the version.
  const raised = t.cleanGroup(A, { name: "W", n: 7, t: 2, version: 2, network: "testnet" });
  assert.deepEqual([raised.n, raised.t, raised.shapeMoved], [3, 2, true]);
  assert.equal(t.signedMode(A), true, "a lower version does not turn the checks off");
  const junk = t.cleanGroup(A, { name: "W", n: 65540, t: 2, version: 3 });
  assert.deepEqual([junk.n, junk.unreadable], [3, false]);

  t.raw.seats = {};
  for (const i of [1, 2, 3]) t.raw.seats[i] = await sealed(A, "seats/" + i, i, seatDoc(i), keys[i]);
  t.state.seatsLoaded = true;
  await settle();
  assert.deepEqual(Object.keys(t.state.seats), ["1", "2", "3"]);
  assert.equal(t.signPins[A + ":2"], keys[2].signPk, "pinned after the seat signed its document");
  assert.equal(t.state.seats[1].by, undefined);

  // A fake seat 4 (n raised), a seat above any n, and a relabelled seat 2.
  t.raw.seats[4] = await sealed(A, "seats/4", 4, seatDoc(4, attacker), attacker);
  t.raw.seats["65537"] = await sealed(A, "seats/65537", 65537, seatDoc(65537, attacker), attacker);
  t.raw.seats[2] = { ...t.raw.seats[2], name: "Ana" };
  await settle();
  assert.deepEqual(Object.keys(t.state.seats), ["1", "3"], "no seat 4, and seat 2 is ignored");
  assert.equal(t.state.ignored >= 3, true);
  assert.equal(t.signPins[A + ":4"], undefined, "no pin for a seat above n");
  t.raw.seats[2] = await sealed(A, "seats/2", 2, seatDoc(2), keys[2]);

  // A made-up n never sizes an array: a group document with n = 1e9 has no seats, and the page
  // filters it at once.
  const C = "cccccccccccccccccccc";
  t.state.gid = C;
  t.state.g = t.cleanGroup(C, { name: "J", n: 1e9, t: 2, version: 2 });
  assert.deepEqual(t.seatIds(), []);
  t.raw.seats = { 1: { signPk: "x" } };
  const t0 = Date.now();
  t.refilter();
  await sleep(50);
  assert.equal(Date.now() - t0 < 2000, true, "no time is lost on a made-up n");
  t.state.gid = A;
  t.state.g = t.cleanGroup(A, { name: "W", n: 3, t: 2, version: 3, network: "testnet" });
  t.raw.seats = {};
  for (const i of [1, 2, 3]) t.raw.seats[i] = await sealed(A, "seats/" + i, i, seatDoc(i), keys[i]);

  // Results that a holder of the link wrote himself, and an approval of Ana.
  const SID = "ab12cd34ef56ab12cd34";
  const spend = { pool: "ironwood", amount: 5, change: 1, fee: 10000, note_value: 20, pczt: "AAA" };
  const fields = t.proposalFields([{ to: "utest1x", amount: 5 }], "", spend, null, 1760000000000);
  t.raw.sessions[SID] = {
    ...(await sealed(A, "sessions/" + SID, 1, fields, keys[1])), createdBy: "x",
    status: "broadcast", signed: "x", signatures: [], final: { txid: "t" }, broadcastTxid: "t",
    broadcastAt: 1,
  };
  t.raw.commits[1] = { commitments: { a: 1 }, at: 1, by: 1, sig: "AAAA" };
  t.state.sid = SID;
  await settle();
  const ss = t.state.sessions.find((x) => x.id === SID);
  assert.equal(ss.status, "collecting", "made-up results are no status");
  assert.deepEqual([ss.final, ss.broadcastTxid], [undefined, undefined]);
  assert.deepEqual(t.state.commits, {}, "no approval of seat 1");
  assert.equal(t.proposer(ss), "S1 (device 1)", "a name comes with its device number");
  const name1 = t.state.seats[1].name;
  t.state.seats[1].name = "Ana (device 2)";
  assert.equal(t.named(1), "Ana (device 2) (device 1)", "a false device number gets the real one");
  t.state.seats[1].name = "";
  assert.equal(t.named(1), "Device 1", "an unnamed device reads Device N once");
  t.state.seats[1].name = name1;

  // Memo: the same length with the old signature is a new check.
  const real = await sealed(A, "confirm/2", 2, { number: "1111" }, keys[2]);
  t.raw.confirm[2] = real;
  await settle();
  assert.deepEqual(t.state.confirm[2], { number: "1111" });
  t.raw.confirm[2] = { ...real, number: "2222" };
  await settle();
  assert.equal(t.state.confirm[2], undefined, "the same length, another text");
  t.raw.confirm[2] = real;
  await settle();
  assert.deepEqual(t.state.confirm[2], { number: "1111" }, "the real document is back");

  // A flood of large rewrites: the memo and the log stay bounded.
  const big = "x".repeat(250000);
  for (let k = 0; k < 140; k++) {
    const sig = "A".repeat(80) + String(k).padStart(6, "0") + "==";
    t.raw.confirm[1] = { number: big + k, by: 1, sig };
    t.refilter();
    await sleep(2);
  }
  await sleep(300);
  assert.equal(t.docMemo.size > 50, true, "the flood reached the memo");
  assert.equal(t.docMemo.chars <= 32e6 + 10 * 260000, true, "the memo is bounded");
  for (let k = 0; k < 300; k++) t.raw.sessions["j" + k] = { by: 1, sig: "short" };
  await settle();
  assert.equal(t.loggedIgnored.get(A).size <= 200, true, "the log set is bounded");
}

// ── Writers for another wallet than the open one ──
{
  const keysA = { 1: await newSignKey(), 2: await newSignKey() };
  t.secrets = {
    [A + ":1"]: { version: 3, ...keysA[1] }, [A + ":2"]: { version: 3, ...keysA[2] },
  };
  t.state.gid = B;
  t.state.g = null;
  assert.equal(t.signedMode(A), true, "wallet A is signed through its seats");
  assert.equal(t.canWriteAs(1, A), false, "no pin yet");
  t.signPins[A + ":1"] = keysA[1].signPk;
  const doc = await t.signedDoc(A, "confirm/1", 1, { number: "1" });
  const text = Z.docPayload(A, "confirm/1", 1, JSON.stringify({ number: "1" }));
  const ok = await verifyMsg(keysA[1].signPk, doc.sig, text);
  assert.equal(ok, true, "signed for A while B is open");
  await assert.rejects(() => t.signedDoc(A, "confirm/2", 2, {}), /no signing key/, "no pin");
  assert.equal(t.writer(2, A), 1);
  const part = await t.sigPart(A, "s1", "package", { package: "P", signers: [1, 2] }, 1);
  assert.deepEqual(Object.keys(part).sort(), ["packageBy", "packageSig"]);
  await assert.rejects(() => t.sigPart(A, "s1", "package", { package: "P", extra: 1 }, 1), /extra/);
}

// ── A whole wallet: the ceremony and the payments, in one browser that holds every seat ──
{
  const data = new Map(), subs = [];
  const under = (p) => [...data.keys()].filter((k) => k.startsWith(p + "/")
    && !k.slice(p.length + 1).includes("/"));
  const notify = () => { for (const s of subs) s(); };
  const listen = (run) => {
    subs.push(run);
    queueMicrotask(run);
    return () => subs.splice(subs.indexOf(run), 1);
  };
  const merged = (p, v) => ({ ...data.get(p), ...JSON.parse(JSON.stringify(v)) });
  const docRef = (p) => ({
    id: p.split("/").pop(),
    async set(v) { data.set(p, JSON.parse(JSON.stringify(v))); notify(); },
    async update(v) { data.set(p, merged(p, v)); notify(); },
    async get() { return { exists: data.has(p), data: () => data.get(p) }; },
    async acquire() { return { acquired: true }; },
    onSnapshot: (cb) => listen(() => cb({
      exists: data.has(p), id: p.split("/").pop(), data: () => data.get(p),
    })),
  });
  const colRef = (p) => ({
    doc: (id) => docRef(p + "/" + (id ?? Math.random().toString(16).slice(2, 22).padEnd(20, "0"))),
    onSnapshot: (cb) => listen(() => cb({ docs: under(p).map((k) => ({
      id: k.split("/").pop(), data: () => data.get(k) })) })),
  });
  // No network: the chain height is fixed, the sync fails, the proof is a fixed answer. Until the
  // wallet is made, the server answers one height, then stops answering: the birthday is the
  // answer to the server check, so making the wallet never waits for a second one.
  class Offline { constructor() { throw new Error("offline"); } }
  let heights = 0, letHeights;
  const heldHeight = new Promise((r) => { letHeights = () => r(1000); });
  const fakeZ = { ...Z, latestHeight: () => (heights++ ? heldHeight : Promise.resolve(1000)),
    ChainWallet: Offline,
    finalize: () => JSON.stringify({ tx_hex: "00ff", txid: "T1", size: 2, version: "V5" }) };
  t.secrets = {};
  t.setZ(fakeZ);
  t.setDb({ doc: docRef, collection: colRef });
  t.setMe("me-uid");

  await t.createGroup("Team", 3, 2);
  const gid = t.state.gid;
  const g = t.state.g;
  assert.deepEqual([t.signedMode(gid), g.n, g.t, g.version], [true, 3, 2, 3]);
  await waitFor("seat 1", () => t.state.seats[1]);
  const seat1 = data.get(`groups/${gid}/seats/1`);
  assert.equal(seat1.by, 1);
  assert.equal(t.signPins[`${gid}:1`], seat1.signPk, "pinned after the self check");
  await t.takeSeat(2, 3);
  await t.takeSeat(3, 3);
  await waitFor("three seats", () => Object.keys(t.state.seats).length === 3);
  assert.deepEqual(t.localSeats(), [1, 2, 3]);
  // This browser holds every seat, so the page runs the whole ceremony by itself.
  await waitFor("wallet made with one height", () => data.get(`groups/${gid}/meta/wallet`));
  letHeights();
  await waitFor("wallet checked", () => Object.keys(t.state.verify).length === 3 && t.state.wallet);
  assert.equal(t.state.ignored, 0, "an honest wallet ignores nothing");
  for (const kind of ["confirm", "dkg1", "done", "verify"]) {
    assert.deepEqual(Object.keys(t.state[kind]).sort(), ["1", "2", "3"], kind);
    for (const i of [1, 2, 3]) {
      const stored = data.get(`groups/${gid}/${kind}/${i}`);
      assert.equal(stored.by, i, `${kind}/${i} names its writer`);
      assert.equal(typeof stored.sig, "string");
    }
  }
  assert.equal(Object.keys(t.state.dkg2).length, 6);
  assert.equal(data.get(`groups/${gid}/meta/wallet`).by, 1);
  assert.equal(t.state.wallet.by, undefined);
  assert.equal(data.get(`groups/${gid}/meta/wallet`).birthday, 1000, "the height of the check");

  // Payments, through the real writers.
  const spend = { pool: "ironwood", amount: 5, change: 1, fee: 10000, note_value: 20, pczt: "AAA" };
  t.setChain({ gid, bal: { spendable: 1e8, pending: 0 }, received: [], sent: new Set(),
    cw: { createSpend: async () => JSON.stringify(spend), free() {} } });
  const propose = async (note, n) => {
    await t.newSpend([{ to: "utest1x", amount: 5 }], note);
    await waitFor(note, () => t.state.sessions.length === n);
    return t.state.sessions.find((x) => x.status === "collecting");
  };
  const first = await propose("rent", 1);
  assert.deepEqual([first.status, t.proposer(first)], ["collecting", "you"]);
  await t.cancelPayment(first);
  await waitFor("cancel", () => t.state.sessions[0].status === "cancelled");
  assert.equal(t.state.sessions[0].error, "Cancelled by device 1.",
    "a cancel of a seat with no name says only the device");

  const second = await propose("second", 2);
  await t.failSession(gid, second, "Bad share.");
  const statusOf = (id) => t.state.sessions.find((x) => x.id === id)?.status;
  await waitFor("failed", () => statusOf(second.id) === "failed");

  // The third payment has a PCZT of its own, which the engine decodes: its id is the id of the
  // finished transaction (fakeZ.finalize).
  const decode3 = { sighash: "s3", txid: "T1", tx_version: "V5", spends: [], lines: [] };
  const z3 = { ...fakeZ,
    inspect: (p, f) => (p === "P3" ? JSON.stringify(decode3) : fakeZ.inspect(p, f)) };
  t.setZ(z3);
  t.setChain({ ...t.chain, cw: { createSpend: async () => JSON.stringify({ ...spend, pczt: "P3" }),
    free() {} } });
  const third = await propose("third", 3);
  const path3 = `groups/${gid}/sessions/${third.id}`;
  const put = async (name, f, prefer, extra) => {
    const sig = await t.sigPart(gid, third.id, name, f, prefer);
    data.set(path3, { ...data.get(path3), ...f, ...extra, ...sig });
    notify();
  };
  await put("package", { package: "PKG", signers: [1, 2] }, 2, { status: "signing" });
  const result = { signed: "SIGNED", signatures: [{ action: 0 }] };
  await put("signed", result, undefined, { status: "signed" });
  const live = () => t.state.sessions.find((x) => x.id === third.id);
  await waitFor("signed", () => live().status === "signed");
  await t.finalizeTx(live());
  await waitFor("complete", () => live().status === "complete");
  assert.equal(live().final.txid, "T1");
  assert.equal(typeof data.get(path3).finalSig, "string");
  // The person opens the lobby while the transaction goes out: the payment still counts as sent.
  let sends = 0, duringSend = () => t.setChain(null);
  class Sent {
    async broadcast() { sends += 1; duringSend(); return JSON.stringify({ txid: "T1" }); }
    free() {}
  }
  t.setZ({ ...z3, ChainWallet: Sent });
  t.setChain({ gid, bal: {}, sent: new Set(), syncing: true, cw: null });
  // A finished transaction with another id goes nowhere, and the payment keeps no error of it.
  for (const send of [t.broadcastTx, t.resendTx]) {
    await assert.rejects(send({ ...live(), final: { ...live().final, txid: "T2" } }),
      /another id than the proposal/);
  }
  assert.deepEqual([sends, data.get(path3).broadcastError, data.get(path3).sentBy],
    [0, undefined, undefined], "no send, no error, no sent mark");
  await t.broadcastTx(live());
  await waitFor("sent", () => live().status === "broadcast");
  assert.deepEqual([live().broadcastTxid, data.get(path3).sentBy >= 1, sends], ["T1", true, 1]);
  assert.equal(data.get(path3).broadcastError, null, "no sync error on a payment that went out");
  // Another wallet is open by then: its chain gets no sync from this payment.
  const otherChain = { gid: "ffffffffffffffffffff", syncing: false, error: "untouched" };
  duringSend = () => { t.state.gid = otherChain.gid; t.setChain(otherChain); };
  await t.broadcastTx(live());
  t.state.gid = gid;
  assert.deepEqual([otherChain.error, data.get(path3).broadcastError], ["untouched", null]);
  // The same wallet stays open: its chain syncs after the payment.
  const ownChain = { gid, bal: {}, sent: new Set(), syncing: false, error: "untouched", cw: null };
  duringSend = () => {};
  t.setChain(ownChain);
  await t.broadcastTx(live());
  assert.notEqual(ownChain.error, "untouched", "the open wallet syncs after its payment");
  assert.equal(t.state.ignored, 0, "nothing of an honest wallet is ignored");

  let checkingSession = null;   // a payment that readSession marked "checking" (the M5 block)
  // M5: the signing steps run with no payment open. The proposer's browser builds the package
  // from the approvals, each seat signs its share and the shares are combined, from the watch
  // alone. Then the drawer is open on another payment, and the watch goes on.
  {
    const m5Spend = { ...spend, pczt: "M5P" }, engine = [];
    t.setChain({ gid, url: "https://lwd.test", bal: { spendable: 1e8, pending: 0, height: 4500000 },
      balAt: Date.now(), received: [], sent: new Set(),
      cw: { createSpend: async () => JSON.stringify(m5Spend), free() {} } });
    const z5 = { ...fakeZ, latestHeight: async () => 4500001,
      inspect: () => JSON.stringify({ sighash: "aa", txid: "tm5", tx_version: "V6", spends: [],
        lines: [], fee: 10000, standard_fee: 10000, expiry_height: 4503456 }),
      signPackage: () => { engine.push("package"); return "PKG5"; },
      signShare: (pczt, fvk, pkg, n, kp, i) => { engine.push("share " + i); return "[1]"; },
      signCommit: () => {
        engine.push("commit");
        return JSON.stringify({ nonces: ["n"], commitments: ["c"] });
      },
      signAggregate: () => {
        engine.push("combine");
        return JSON.stringify({ signed_pczt: "SIG5", signatures: [] });
      } };
    t.setZ(z5);
    t.closeSession();
    const listeners = subs.length;
    const approveAs = async (sid, seats) => {
      for (const i of seats) {
        const rel = `sessions/${sid}/commits/${i}`;
        const nonces = { ...t.sec(gid, i).nonces, [sid]: { nonces: "n" + i, sighash: "aa" } };
        await t.putSec(gid, i, { nonces });
        const doc = await t.signedDoc(gid, rel, i, { commitments: "c", at: 1 });
        data.set(`groups/${gid}/${rel}`, doc);
      }
    };
    const m5 = await propose("m5", 4);
    // Closing the drawer reacts on nothing: the open payment is watched already (QA H1).
    assert.equal(t.watched.has(m5.id), true, "the open payment is watched");
    t.closeSession();
    assert.equal(t.watched.has(m5.id), true, "and stays watched when its drawer closes");
    const path5 = `groups/${gid}/sessions/${m5.id}`;
    await approveAs(m5.id, [2, 3]);
    // A made-up approval of seat 1 (no signature) is no approval for the watch either.
    data.set(`${path5}/commits/1`, { commitments: "forged", at: 1 });
    notify();
    await waitFor("the package", () => data.get(path5)?.package === "PKG5");
    assert.deepEqual(data.get(path5).signers, [2, 3], "the package names the signed approvals");
    assert.equal(t.state.sid, null, "no payment is open");
    await waitFor("the first share", () => engine.includes("share 2"));
    t.openSession(third.id);
    const both = () => data.has(path5 + "/shares/2") && data.has(path5 + "/shares/3");
    await waitFor("both shares", both);
    await waitFor("combined", () => data.get(path5)?.signed === "SIG5");
    assert.deepEqual(engine, ["package", "share 2", "share 3", "combine"]);
    assert.equal(t.state.sid, third.id, "the drawer stays on the other payment");
    t.closeSession();
    await waitFor("no watch", () => !t.watched.has(m5.id));
    assert.equal(subs.length, listeners, "the listeners of the watch end with it");
    const drop = async (path) => {
      for (const k of [...data.keys()]) if (k.startsWith(path)) data.delete(k);
      notify();
      await waitFor("three payments", () => t.state.sessions.length === 3 && !t.state.pending);
    };
    await drop(path5);
    // Another tab of this browser signs for seat 1: it holds the lock of the secrets, and it saves
    // its burn before it lets go. This tab waits, takes what storage holds, and signs nothing for
    // seat 1 (QA M1). Seat 2 signs after the lock.
    engine.length = 0;
    let unlock;
    const otherTab = t.exclusive("secrets", () => new Promise((ok) => { unlock = ok; }));
    const m6 = await propose("m6", 4);
    t.closeSession();
    const path6 = `groups/${gid}/sessions/${m6.id}`;
    await approveAs(m6.id, [1, 2]);
    notify();
    await waitFor("the package of m6", () => data.get(path6)?.package === "PKG5");
    await sleep(200);
    assert.deepEqual(engine, ["package"], "no share while the other tab holds the lock");
    const kept = JSON.parse(storage.get("zf-secrets"));
    delete kept[gid + ":1"].nonces[m6.id];
    kept[gid + ":3"] = null;   // a damaged entry: the check of the other seats still holds
    storage.set("zf-secrets", JSON.stringify(kept));
    unlock();
    await otherTab;
    await waitFor("the share of seat 2", () => data.has(path6 + "/shares/2"));
    await sleep(300);
    assert.equal(data.has(path6 + "/shares/1"), false, "the used nonce signs nothing");
    assert.deepEqual(engine, ["package", "share 2"]);
    assert.equal((t.sec(gid, 1).nonces || {})[m6.id], undefined, "and leaves this tab too");
    assert.equal(!!t.sec(gid, 3)?.keyPackage, true, "the damaged entry leaves seat 3 as it is");
    await drop(path6);
    // A seat whose share the payment holds already does not sign again.
    const m7 = { id: "m7", pczt: "M5P", package: "PKG7", signers: [1], status: "signing", by: 1,
      createdAt: 1 };
    await t.putSec(gid, 1, { nonces: { ...t.sec(gid, 1).nonces, m7: { sighash: "aa" } } });
    t.reactSession(m7, { commits: {}, shares: { 1: { shares: "[1]" } } });
    assert.equal(t.busy.has("share:m7:1"), false, "the share is there");
    // The person opens another wallet while the step waits for the lock: it signs nothing.
    let unlock7;
    const held7 = t.exclusive("secrets", () => new Promise((ok) => { unlock7 = ok; }));
    t.reactSession(m7, { commits: {}, shares: {} });
    assert.equal(t.busy.has("share:m7:1"), true, "control: without it, seat 1 would sign");
    t.state.gid = B;
    unlock7();
    await held7;
    await waitFor("the step ends", () => !t.busy.has("share:m7:1"));
    t.state.gid = gid;
    assert.equal(engine.includes("share 1"), false, "no share for another wallet");
    for (const k of [...data.keys()]) if (k.includes("/sessions/m7/")) data.delete(k);
    // An approval and a cancel wait for the lock of the secrets, and a share write that does not
    // end holds no lock.
    const holdLock = () => {
      let open;
      const done = t.exclusive("secrets", () => new Promise((ok) => { open = ok; }));
      return () => { open(); return done; };
    };
    engine.length = 0;
    const m8 = await propose("m8", 4);
    t.closeSession();
    const path8 = `groups/${gid}/sessions/${m8.id}`;
    const live8 = () => t.state.sessions.find((x) => x.id === m8.id);
    let unhold = holdLock();
    const approving = t.approve(live8(), 2);
    await sleep(200);
    assert.deepEqual(engine, [], "the approval waits for the lock");
    await unhold();
    await approving;
    assert.deepEqual(engine, ["commit"]);
    // The person opens another wallet while the approval waits for the lock: it stops.
    unhold = holdLock();
    const approving3 = t.approve(live8(), 3).then(() => "approved", (e) => e.message);
    t.state.gid = B;
    await unhold();
    assert.match(await approving3, /Another wallet is open now/);
    t.state.gid = gid;
    assert.deepEqual(engine, ["commit"], "no approval for another wallet");
    unhold = holdLock();
    const cancelling = t.cancelPayment(live8());
    await sleep(200);
    assert.ok((t.sec(gid, 2).nonces || {})[m8.id], "the cancel waits for the lock");
    await unhold();
    await cancelling;
    assert.equal((t.sec(gid, 2).nonces || {})[m8.id], undefined);
    await drop(path8);
    const { [m8.id]: _m8, ...marks8 } = t.sec(gid, 2).marks || {};
    await t.putSec(gid, 2, { marks: marks8 });   // the test approval holds nothing
    let openShares;
    const shareGate = new Promise((ok) => { openShares = ok; });
    t.setDb({ doc: (p) => p.includes("/shares/")
      ? { ...docRef(p), set: (v) => shareGate.then(() => docRef(p).set(v)) } : docRef(p),
    collection: colRef });
    const m9 = await propose("m9", 4);
    t.closeSession();
    const path9 = `groups/${gid}/sessions/${m9.id}`;
    await approveAs(m9.id, [1, 2]);
    notify();
    const signed9 = () => engine.filter((x) => x.startsWith("share")).length === 2;
    await waitFor("the shares are signed", signed9);
    assert.equal(await Promise.race([t.exclusive("secrets", async () => "free"),
      sleep(500).then(() => "held")]), "free", "no lock while the share write waits");
    openShares();
    await waitFor("the shares of m9", () => data.has(path9 + "/shares/2"));
    t.setDb({ doc: docRef, collection: colRef });
    await drop(path9);
    // A save that fails keeps its change in this tab, and a locked step keeps it too: of that
    // seat, only the nonces and marks (also the Solana ones) come from storage. Every other stored
    // seat comes in whole, so a newer save of another tab stays. A wallet key that only storage
    // holds (a new wallet of another tab) stays, and one from the save of another tab comes in.
    const mx = await propose("mx", 4);
    t.closeSession();
    const pathX = `groups/${gid}/sessions/${mx.id}`;
    await approveAs(mx.id, [1, 2]);
    storage.set("zf-vault", "{}");   // the plain save refuses
    assert.equal(await t.putSec(gid, 3, { m5Flag: 2 }), false, "the save fails");
    storage.delete("zf-vault");
    const storedX = JSON.parse(storage.get("zf-secrets")), seat3 = storedX[gid + ":3"];
    seat3.marks = { ...seat3.marks, m5x: { seen: 1 } };   // a mark that another tab saved
    const sol2 = t.sec(gid, 2).sol, sol3 = t.sec(gid, 3).sol;
    const sol2Used = { ...sol2, used: { d2: "s" } };
    storedX[gid + ":2"] = { ...storedX[gid + ":2"], m5kp: "KPY", sol: sol2Used };   // a key share
    seat3.sol = { ...sol3, used: { d3: "s" }, salts: { z3: "p3" }, bodies: { c3: "b3" } };
    seat3.unsent = { zk3: { changed: true } };   // approval records that another tab saved
    storedX[gid + ":9"] = { m5new: 1 };   // a new seat of another tab
    storage.set("zf-secrets", JSON.stringify(storedX));
    const keysX = JSON.parse(storage.get("zf-keys"));
    storage.set("zf-keys", JSON.stringify({ ...keysX, m5other: "k" }));
    const chatsX = storage.get("zf-chats"), cidX = "cc".repeat(10), oldChats = JSON.parse(chatsX);
    const roomX = { key: "k".repeat(43), member: "dd".repeat(10), at: 1 };
    const chatsWith = { ...oldChats, list: { ...oldChats.list, [cidX]: roomX } };
    storage.set("zf-chats", JSON.stringify(chatsWith));   // a chat of another tab
    const cidM = "ab".repeat(10);
    t.chats.list[cidM] = roomX;   // a chat that only this tab holds
    notify();
    await waitFor("the shares of mx", () => data.has(pathX + "/shares/2"));
    await sleep(300);
    assert.equal(t.sec(gid, 3).m5Flag, 2, "the unsaved change stays in this tab");
    assert.equal(JSON.parse(storage.get("zf-secrets"))[gid + ":3"].m5Flag, 2, "the burn saves it");
    assert.deepEqual(t.sec(gid, 3).marks.m5x, { seen: 1 }, "a mark of another tab comes in");
    const storedAfter = JSON.parse(storage.get("zf-secrets"));
    assert.deepEqual([t.sec(gid, 2).m5kp, storedAfter[gid + ":2"].m5kp, t.sec(gid, 2).sol.used],
      ["KPY", "KPY", { d2: "s" }], "a newer save of another tab stays");
    assert.deepEqual([t.sec(gid, 3).sol.used, t.sec(gid, 9), storedAfter[gid + ":9"]],
      [{ d3: "s" }, { m5new: 1 }, { m5new: 1 }], "the Solana nonces and a new seat come in");
    const s3 = t.sec(gid, 3);
    assert.deepEqual([s3.sol.salts, s3.sol.bodies, s3.unsent],
      [{ z3: "p3" }, { c3: "b3" }, { zk3: { changed: true } }], "and the other approval records");
    assert.equal(JSON.parse(storage.get("zf-keys")).m5other, "k", "the key of the other tab stays");
    assert.deepEqual([t.chats.list[cidX], t.chats.list[cidM]], [roomX, roomX], "both chats stay");
    delete t.chats.list[cidM];
    storage.set("zf-keys", JSON.stringify({ ...JSON.parse(storage.get("zf-keys")), m5tab: "k" }));
    await storageEvent("zf-keys");
    assert.deepEqual([t.gkeys.m5tab, t.gkeys[gid] === keysX[gid]], ["k", true], "both keep");
    delete t.gkeys.m5other; delete t.gkeys.m5tab;
    const { m5x: _m5x, ...marks3 } = t.sec(gid, 3).marks;
    delete t.secrets[gid + ":9"];
    await t.putSec(gid, 2, { m5kp: undefined, sol: sol2 });
    await t.putSec(gid, 3, { m5Flag: undefined, marks: marks3, sol: sol3, unsent: undefined });
    // A storage event of another tab: the seats of its save come in, and a seat that only this
    // tab holds stays, because it may be the last copy.
    t.secrets["zz:9"] = { m5only: 1 };
    const fromTab = JSON.parse(storage.get("zf-secrets"));
    fromTab[gid + ":2"] = { ...fromTab[gid + ":2"], m5ev: 1 };
    storage.set("zf-secrets", JSON.stringify(fromTab));
    const unholdEv = holdLock();
    const eventDone = storageEvent("zf-secrets");
    await sleep(100);
    assert.equal(t.sec(gid, 2).m5ev, undefined, "the event waits for a locked step");
    await unholdEv();
    await eventDone;
    assert.deepEqual([t.secrets["zz:9"], t.sec(gid, 2).m5ev], [{ m5only: 1 }, 1], "both stay");
    delete t.secrets["zz:9"];
    await t.putSec(gid, 2, { m5ev: undefined });
    // The chats come in as the other tab saved them: a chat that it left goes here too.
    storage.set("zf-chats", chatsX);
    await storageEvent("zf-chats");
    assert.equal(t.chats.list[cidX], undefined, "a chat that the other tab left goes");
    await drop(pathX);
    // A payment that changed after an approval fails for everyone, and the nonce goes. With the
    // drawer on another payment, the banner names the payment that changed.
    const mc = await propose("mc\n" + "x".repeat(60), 4);
    t.closeSession();
    const pathC = `groups/${gid}/sessions/${mc.id}`;
    await approveAs(mc.id, [1, 2]);
    await t.putSec(gid, 1, { nonces: { ...t.sec(gid, 1).nonces, [mc.id]: { sighash: "bb" } } });
    t.openSession(third.id);
    notify();
    await waitFor("the error of mc", () => !!data.get(pathC)?.error);
    await sleep(300);
    assert.equal(data.get(pathC).error, "The payment changed after a device approved it.");
    assert.equal((t.sec(gid, 1).nonces || {})[mc.id], undefined, "the nonce of seat 1 goes");
    assert.equal(data.has(pathC + "/shares/1"), false, "seat 1 signs nothing");
    assert.equal(t.banner.text, "\"mc " + "x".repeat(37)
      + "\": This payment changed after you approved it, so this browser did not sign it.");
    t.closeSession();
    await drop(pathC);
    // With its drawer open, the payment needs no name.
    const md = await propose("md", 4);
    assert.equal(t.state.sid, md.id, "the drawer is on md");
    const pathD = `groups/${gid}/sessions/${md.id}`;
    await approveAs(md.id, [1, 2]);
    await t.putSec(gid, 1, { nonces: { ...t.sec(gid, 1).nonces, [md.id]: { sighash: "bb" } } });
    notify();
    await waitFor("the error of md", () => !!data.get(pathD)?.error);
    await sleep(300);
    assert.equal(t.banner.text,
      "This payment changed after you approved it, so this browser did not sign it.");
    t.closeSession();
    await drop(pathD);
    // The drawer at the time of the failure counts: here it moves to another payment while the
    // step waits for the lock.
    const mf = await propose("mf", 4);
    const pathF = `groups/${gid}/sessions/${mf.id}`;
    await approveAs(mf.id, [1, 2]);
    await t.putSec(gid, 1, { nonces: { ...t.sec(gid, 1).nonces, [mf.id]: { sighash: "bb" } } });
    const unholdF = holdLock();
    notify();
    await waitFor("the share step waits", () => t.busy.has("share:" + mf.id + ":1"));
    t.openSession(third.id);
    await unholdF();
    await waitFor("the error of mf", () => !!data.get(pathF)?.error);
    await sleep(300);
    assert.equal(t.banner.text,
      "\"mf\": This payment changed after you approved it, so this browser did not sign it.");
    t.closeSession();
    await drop(pathF);
    const pathOf = (ss) => `groups/${gid}/sessions/${ss.id}`;
    const liveOf = (ss) => t.state.sessions.find((x) => x.id === ss.id);
    // A cancel part of another seat whose check has no result yet: the payment is "checking" and
    // needs no approval. When the check ends, it is cancelled. The cards below show its chip.
    const mu = await propose("mu", 4);
    t.closeSession();
    const cancelU = { error: "Cancelled by Ana (device 2)." };
    const sigU = await t.sigPart(gid, mu.id, "cancel", cancelU, 2);
    const subtleU = globalThis.crypto.subtle, verifyU = subtleU.verify.bind(subtleU);
    let openChecks;
    const checksHeld = new Promise((ok) => { openChecks = ok; });
    subtleU.verify = (...a) => checksHeld.then(() => verifyU(...a));   // no result for now
    data.set(pathOf(mu), { ...data.get(pathOf(mu)), ...cancelU, status: "cancelled", ...sigU });
    notify();
    await waitFor("the cancel part waits for its check", () => !!liveOf(mu)?.checking);
    checkingSession = liveOf(mu);
    assert.deepEqual([checkingSession.status, t.needsMyApproval(gid, checkingSession)],
      ["collecting", false], "checking");
    openChecks();
    delete subtleU.verify;
    await waitFor("the check of the cancel", () => liveOf(mu)?.status === "cancelled");
    assert.equal(liveOf(mu).checking, false);
    await drop(pathOf(mu));
    // The cancel of this browser drops a share that it made and could not send yet.
    let downC = true;
    t.setDb({ doc: (p) => p.endsWith("/shares/1") && downC
      ? { ...docRef(p), set: async () => { throw new Error("down"); } } : docRef(p),
    collection: colRef });
    const mv2 = await propose("mv2", 4);
    t.closeSession();
    await approveAs(mv2.id, [1, 2]);
    notify();
    await waitFor("the kept share of mv2", () => !!(t.sec(gid, 1).unsent || {})[mv2.id]);
    downC = false;
    t.setDb({ doc: docRef, collection: colRef });
    // A seat with a name signs the cancel with it; cancelNow reads the name when it starts.
    const nameOf1 = t.state.seats[1].name;
    t.state.seats[1].name = "Ana";
    const asAna = t.cancelPayment(liveOf(mv2));
    t.state.seats[1].name = nameOf1;
    await asAna;
    assert.equal(data.get(pathOf(mv2)).error, "Cancelled by Ana (device 1).",
      "a cancel names the device with its name");
    assert.equal((t.sec(gid, 1).unsent || {})[mv2.id], undefined,
      "the cancel drops the kept share");
    await drop(pathOf(mv2));
    // The person cancels while the share steps wait for the lock: they sign nothing.
    const mk = await propose("mk", 4);
    t.closeSession();
    await approveAs(mk.id, [1, 2]);
    engine.length = 0;
    const unholdK = holdLock();
    notify();
    await waitFor("the share steps wait", () => t.busy.has("share:" + mk.id + ":1"));
    const cancelK = t.cancelPayment(liveOf(mk));
    await unholdK();
    await cancelK;
    await sleep(300);
    assert.deepEqual([data.get(pathOf(mk)).status, engine.filter((x) => x.startsWith("share"))],
      ["cancelled", []], "no share after the cancel");
    await drop(pathOf(mk));
    // An approval that waits for the lock when the person cancels is refused.
    const mn = await propose("mn", 4);
    t.closeSession();
    const unholdN = holdLock();
    const approvingN = t.approve(liveOf(mn), 3).then(() => "approved", (e) => e.message);
    await sleep(100);
    const cancelN = t.cancelPayment(liveOf(mn));
    await unholdN();
    await cancelN;
    assert.match(await approvingN, /cancelled or failed, so it was not approved/);
    assert.equal(data.has(pathOf(mn) + "/commits/3"), false, "no commitment goes out");
    await drop(pathOf(mn));
    // A share whose write fails stays kept with the burn, and the next try sends it. It is signed
    // once.
    let failShare = true;
    t.setDb({ doc: (p) => p.endsWith("/shares/1") && failShare
      ? { ...docRef(p), set: async () => { failShare = false; throw new Error("not connected"); } }
      : docRef(p), collection: colRef });
    engine.length = 0;
    const mr = await propose("mr", 4);
    t.closeSession();
    await approveAs(mr.id, [1, 2]);
    notify();
    await waitFor("the share of seat 1 after a retry", () => data.has(pathOf(mr) + "/shares/1"),
      10000);
    t.setDb({ doc: docRef, collection: colRef });
    assert.deepEqual([failShare, engine.filter((x) => x === "share 1").length], [false, 1]);
    await waitFor("the kept copy goes", () => !(t.sec(gid, 1).unsent || {})[mr.id]);
    await drop(pathOf(mr));
    // A payment that changed: when the write of its failure fails, the next try writes it.
    let failUpdate = true;
    t.setDb({ doc: (p) => ({ ...docRef(p), update: async (v) => {
      if (!v.error || !failUpdate) return docRef(p).update(v);
      failUpdate = false;
      throw new Error("not connected");
    } }), collection: colRef });
    const mq = await propose("mq", 4);
    t.closeSession();
    await approveAs(mq.id, [1, 2]);
    await t.putSec(gid, 1, { nonces: { ...t.sec(gid, 1).nonces, [mq.id]: { sighash: "bb" } } });
    notify();
    await waitFor("the failure after a retry", () => !!data.get(pathOf(mq))?.error, 10000);
    t.setDb({ doc: docRef, collection: colRef });
    assert.deepEqual([failUpdate, data.get(pathOf(mq)).error],
      [false, "The payment changed after a device approved it."]);
    await drop(pathOf(mq));
    // The save of the burn fails: no share goes out, the nonce stays, and the next try signs.
    const mb = await propose("mb", 4);
    t.closeSession();
    await approveAs(mb.id, [1, 2]);
    storage.set("zf-vault", "{}");   // every plain save refuses
    notify();
    await waitFor("the failed burn", () => /Could not save the used nonce/.test(t.banner?.text));
    assert.deepEqual([data.has(pathOf(mb) + "/shares/1"), !!(t.sec(gid, 1).nonces || {})[mb.id]],
      [false, true], "no share, and the nonce stays");
    storage.delete("zf-vault");
    notify();
    await waitFor("the shares of mb", () => data.has(pathOf(mb) + "/shares/1"), 10000);
    await drop(pathOf(mb));
    // A burn that keeps failing: each new try waits longer, so the engine does not sign again and
    // again while the save fails. The step goes on by itself when the wait ends.
    engine.length = 0;
    const mt = await propose("mt", 4);
    t.closeSession();
    await approveAs(mt.id, [1, 2]);
    storage.set("zf-vault", "{}");
    notify();
    await waitFor("the first try", () => engine.includes("share 1"));
    await sleep(200);
    for (let k = 0; k < 5; k++) { notify(); await sleep(100); }
    assert.equal(engine.filter((x) => x === "share 1").length, 1, "no new try during the wait");
    const tries = () => engine.filter((x) => x === "share 1").length;
    await waitFor("the second try", () => tries() === 2, 10000);
    await sleep(200);
    storage.delete("zf-vault");   // nothing reacts now: the end of the 6 s wait starts the step
    await waitFor("the shares of mt", () => data.has(pathOf(mt) + "/shares/1"), 10000);
    await drop(pathOf(mt));
    // A share is made and its write fails, so it stays kept. Another seat cancels, and the person
    // releases the hold. When a seat then resets the payment to signing, no share of this browser
    // goes out.
    let shareDown = true;
    t.setDb({ doc: (p) => p.endsWith("/shares/1") && shareDown
      ? { ...docRef(p), set: async () => { throw new Error("down"); } } : docRef(p),
    collection: colRef });
    const mp = await propose("mp", 4);
    t.closeSession();
    await approveAs(mp.id, [1, 2]);
    const markP = { approved: "aa", tip: 4500000 };
    await t.putSec(gid, 1, { marks: { ...t.sec(gid, 1).marks, [mp.id]: markP } });
    notify();
    await waitFor("the kept share", () => !!(t.sec(gid, 1).unsent || {})[mp.id]);
    const signingP = { ...data.get(pathOf(mp)) };
    const cancelP = { error: "Cancelled by Ana (device 2)." };
    const sigP = await t.sigPart(gid, mp.id, "cancel", cancelP, 2);
    data.set(pathOf(mp), { ...signingP, ...cancelP, status: "cancelled", ...sigP });
    notify();
    await waitFor("the cancel", () => !!liveOf(mp)?.error);
    await t.releaseHold(mp.id);
    const s1 = t.sec(gid, 1);
    assert.deepEqual([s1.marks[mp.id].released, (s1.unsent || {})[mp.id], (s1.nonces || {})[mp.id]],
      [true, undefined, undefined], "the release burns the kept share too");
    shareDown = false;
    data.set(pathOf(mp), signingP);   // a seat resets the payment
    notify();
    await sleep(500);
    assert.equal(data.has(pathOf(mp) + "/shares/1"), false, "no share after the release");
    t.setDb({ doc: docRef, collection: colRef });
    const { [mp.id]: _mp, ...marksP } = t.sec(gid, 1).marks;
    await t.putSec(gid, 1, { marks: marksP });
    await drop(pathOf(mp));
    // The save of an approval fails: no commitment goes out, and memory gets its old state back,
    // so the next click approves.
    const ma = await propose("ma", 4);
    t.closeSession();
    storage.set("zf-vault", "{}");
    assert.match(await t.approve(liveOf(ma), 3).then(() => "approved", (e) => e.message),
      /Could not save the approval/);
    storage.delete("zf-vault");
    const seatA = () => [(t.sec(gid, 3).nonces || {})[ma.id], (t.sec(gid, 3).marks || {})[ma.id]];
    assert.deepEqual([data.has(pathOf(ma) + "/commits/3"), ...seatA()],
      [false, undefined, undefined], "nothing went out, and memory is as before");
    await t.approve(liveOf(ma), 3);
    assert.equal(data.has(pathOf(ma) + "/commits/3"), true, "the next click approves");
    const { [ma.id]: _na, ...noncesA } = t.sec(gid, 3).nonces;
    const { [ma.id]: _ma, ...marksA } = t.sec(gid, 3).marks;
    await t.putSec(gid, 3, { nonces: noncesA, marks: marksA });
    await drop(pathOf(ma));
    // A locked step with a damaged or a missing record keeps this tab's copy, and its save writes
    // that copy again.
    for (const bad of ["not json", null]) {
      const mh = await propose("mh", 4);
      t.closeSession();
      await approveAs(mh.id, [1]);
      if (bad === null) storage.delete("zf-secrets");
      else storage.set("zf-secrets", bad);
      await t.cancelPayment(liveOf(mh));
      const back = JSON.parse(storage.get("zf-secrets"))[gid + ":1"];
      assert.deepEqual([!!t.sec(gid, 1)?.keyPackage, !!back?.keyPackage], [true, true],
        String(bad));
      await drop(pathOf(mh));
    }
    // The package and the combine steps name their payment too.
    const { signPackage, signAggregate } = z5;
    z5.signPackage = () => { throw new Error("no package"); };
    const mg = await propose("mg", 4);
    t.openSession(third.id);
    await approveAs(mg.id, [1, 2]);
    notify();
    await waitFor("the package error", () => t.banner?.text === "\"mg\": no package");
    Object.assign(z5, { signPackage, signAggregate: () => { throw new Error("no signature"); } });
    notify();
    await waitFor("the combine error", () => t.banner?.text === "\"mg\": no signature", 10000);
    z5.signAggregate = signAggregate;
    assert.equal(data.get(pathOf(mg)).error, "no signature");
    t.closeSession();
    await drop(pathOf(mg));
    // A sealed store (the passkey lock): a nonce that the sealed record lacks signs nothing and
    // says so in the log. A write of this tab during the decrypt is kept.
    engine.length = 0;
    const vkey = await crypto.subtle.importKey("raw", crypto.getRandomValues(new Uint8Array(32)),
      "AES-GCM", false, ["encrypt", "decrypt"]);
    const vrec = { cred: "c", salt: "s" };
    t.setVault({ rec: vrec, key: vkey });
    const mv = await propose("mv", 4);
    t.closeSession();
    const pathV = `groups/${gid}/sessions/${mv.id}`;
    await approveAs(mv.id, [1, 2]);
    await sleep(100);
    const sealed = await openVault(vkey, JSON.parse(storage.get("zf-vault")));
    delete sealed.secrets[gid + ":1"].nonces[mv.id];
    sealed.keys = { ...sealed.keys, m5sealed: "k" };   // a new wallet of another tab
    sealed.secrets[gid + ":2"].m5kp = "KPY";   // a newer save of another tab
    const cidV = "ee".repeat(10), roomV = { key: "v".repeat(43), member: "dd".repeat(10), at: 1 };
    sealed.chats = { ...sealed.chats, list: { ...sealed.chats?.list, [cidV]: roomV } };
    storage.set("zf-vault", JSON.stringify(await seal(vkey, vrec, sealed)));
    const keysBefore = t.gkeys;
    t.gkeys = { ...keysBefore, m5probe: "kept" };   // only this tab knows it
    t.setLocked({});   // the save of the next change does not happen
    assert.equal(await t.putSec(gid, 3, { m5Flag: 3 }), false);
    t.setLocked(null);
    notify();
    await waitFor("the share of seat 2 (sealed)", () => data.has(pathV + "/shares/2"));
    await sleep(300);
    assert.deepEqual(engine, ["package", "share 2"], "seat 1 signs nothing");
    const said = (x) => x.includes("device 1: its nonce for this payment is used or gone");
    assert.ok(t.state.log.some(said), "the log says why");
    assert.deepEqual([t.gkeys.m5probe, t.gkeys.m5sealed], ["kept", "k"], "both wallet keys");
    assert.equal(t.sec(gid, 3).m5Flag, 3, "the change that this tab did not save stays");
    assert.equal(t.sec(gid, 2).m5kp, "KPY", "a newer save of another tab stays");
    await t.putSec(gid, 2, { m5kp: undefined });
    assert.deepEqual(t.chats.list[cidV], roomV, "a chat of another tab comes in");
    delete t.chats.list[cidV];
    t.gkeys = keysBefore;
    await drop(pathV);
    const mw = await propose("mw", 4);
    t.closeSession();
    const pathW = `groups/${gid}/sessions/${mw.id}`;
    await approveAs(mw.id, [1, 2]);
    await sleep(100);
    const subtle = globalThis.crypto.subtle, decrypt = subtle.decrypt.bind(subtle);
    let wrote = false;
    subtle.decrypt = (...a) => {
      if (!wrote) { wrote = true; t.putSec(gid, 3, { m5Flag: 1 }); }
      return decrypt(...a);
    };
    notify();
    await waitFor("the shares of mw", () => data.has(pathW + "/shares/2"));
    await sleep(300);
    delete subtle.decrypt;
    assert.equal(wrote, true);
    assert.equal(t.sec(gid, 3).m5Flag, 1, "a write during the decrypt stays in memory");
    const after = await openVault(vkey, JSON.parse(storage.get("zf-vault")));
    assert.equal(after.secrets[gid + ":3"].m5Flag, 1, "and in the sealed record");
    // A storage event of another tab takes what storage holds now, after the writes of this tab: a
    // burn of this tab during its decrypt stays, in memory and in the sealed record.
    await t.putSec(gid, 3, { nonces: { ...t.sec(gid, 3).nonces, m5e: { sighash: "aa" } } });
    let burnedE = false;
    subtle.decrypt = (...a) => {
      if (!burnedE) {
        burnedE = true;
        const { m5e: _e, ...rest } = t.sec(gid, 3).nonces;
        t.putSec(gid, 3, { nonces: rest });
      }
      return decrypt(...a);
    };
    await storageEvent("zf-vault");
    delete subtle.decrypt;
    const afterE = await openVault(vkey, JSON.parse(storage.get("zf-vault")));
    const nonceE = (x) => (x.nonces || {}).m5e;
    assert.deepEqual([burnedE, nonceE(t.sec(gid, 3)), nonceE(afterE.secrets[gid + ":3"])],
      [true, undefined, undefined], "the burn stays");
    await drop(pathW);
    // A sealed record that does not open stops an approval, with a message that says what to do.
    const mz = await propose("mz", 4);
    t.closeSession();
    storage.set("zf-vault", "{\"v\":1,\"junk\":true}");
    const liveZ = t.state.sessions.find((x) => x.id === mz.id);
    assert.equal(await t.approve(liveZ, 3).then(() => "approved", (e) => e.message),
      "The locked keys in this browser cannot be read again. Reload the page.");
    storage.delete("zf-vault");
    t.setVault(null);
    await t.putSec(gid, 3, { m5Flag: undefined });
    await drop(`groups/${gid}/sessions/${mz.id}`);
    // Which payments the watch takes: a proposal of a seat here, a package that a seat here
    // approved (its mark, or the nonce of an approval from before the marks), not one with an
    // error or past its expiry. Payments with a package come first, at most 8.
    const far = (id, extra) => ({ id, pczt: "M5P", status: "collecting", createdAt: 1, ...extra });
    const others = { by: 99, package: "P" };
    const mark2 = { approved: "aa", tip: 4500001 };
    await t.putSec(gid, 2, { marks: { ...t.sec(gid, 2).marks, w2: mark2 },
      nonces: { ...t.sec(gid, 2).nonces, w3: { sighash: "aa" } } });
    assert.deepEqual([far("w1", { by: 1 }), far("w2", others), far("w3", others),
      far("w4", others), far("w5", { by: 1, error: "Failed." })].map((x) => t.needsWork(x)),
    [true, true, true, false, false], "proposer; mark; old nonce; neither; failed");
    t.setChain({ gid, url: "https://lwd.test", bal: { spendable: 1e8, pending: 0, height: 4503500 },
      balAt: Date.now(), received: [], sent: new Set(), cw: { free() {} } });
    assert.equal(t.needsWork(far("w1", { by: 1 })), false, "past its expiry");
    const { w2: _w2, ...marks2 } = t.sec(gid, 2).marks;
    const { w3: _w3, ...nonces2 } = t.sec(gid, 2).nonces;
    await t.putSec(gid, 2, { marks: marks2, nonces: nonces2 });   // the test approvals hold nothing
    t.setChain({ gid, url: "https://lwd.test", bal: { spendable: 1e8, pending: 0, height: 4500000 },
      balAt: Date.now(), received: [], sent: new Set(), cw: { free() {} } });
    const bare = Array.from({ length: 9 }, (_, k) => far("v" + k, { by: 1 }));
    const picked = t.toWatch([...bare, far("vp", { by: 1, package: "P" })]).map((x) => x.id);
    assert.deepEqual([picked.length, picked[0], picked.includes("v8")], [8, "vp", false],
      "at most 8, a package first, then the newest");
    // An open proposal of another device is watched for its count, after the payments that need
    // work here.
    const counted = far("vo", { by: 99 });
    assert.deepEqual([t.toWatch([counted]).map((x) => x.id), t.toWatch([...bare, counted])
      .includes(counted)], [["vo"], false], "an open proposal is watched for its count");
    // The steps that failed above try again after 3 s, and each step draws when it ends. Those
    // end here, while the page can draw, and not under the recorder of the tests below.
    await sleep(3500);
    t.setZ({ ...fakeZ, ChainWallet: Sent });
    t.setChain({ gid, bal: {}, sent: new Set(), syncing: true, cw: null });
  }

  // A holder of the link: made-up results on the cancelled payment, a seat 4, n = 7, a new name.
  const p1 = `groups/${gid}/sessions/${first.id}`;
  const madeUp = { signed: "x", final: { txid: "t" }, broadcastTxid: "t", broadcastAt: 1 };
  data.set(p1, { ...data.get(p1), ...madeUp });
  const key4 = await newSignKey();
  const f4 = { uid: "x", name: "Ana", boxPk: "bb", signPk: key4.signPk, at: 1 };
  data.set(`groups/${gid}/seats/4`, await sealed(gid, "seats/4", 4, f4, key4));
  const real2 = data.get(`groups/${gid}/seats/2`);
  data.set(`groups/${gid}/seats/2`, { ...real2, name: "Ana" });
  data.set(`groups/${gid}`, { ...data.get(`groups/${gid}`), n: 7 });
  notify();
  await waitFor("ignored", () => t.state.ignored >= 3 && !t.state.pending);
  assert.deepEqual(Object.keys(t.state.seats), ["1", "3"], "seat 2 is ignored, there is no seat 4");
  assert.deepEqual([t.state.g.n, t.state.g.shapeMoved], [3, true]);
  const cancelled = t.state.sessions.find((x) => x.id === first.id);
  assert.deepEqual([cancelled.status, cancelled.final, cancelled.broadcastTxid],
    ["cancelled", undefined, undefined]);
  data.set(`groups/${gid}/seats/2`, real2);
  notify();
  await waitFor("seat 2 back", () => Object.keys(t.state.seats).length === 3 && !t.state.pending);

  // The person opens an unsigned wallet while a write for the first wallet is on its way: the
  // write is signed for the first wallet, with its key and its id.
  data.set(`groups/${B}`, { name: "B", n: 2, t: 2, version: 2 });
  t.gkeys = { ...t.gkeys, [B]: "k".repeat(43) };
  t.ui.sendReview = { prep: { gid }, note: "of wallet A" };
  t.openGroup(B);
  assert.equal(t.ui.sendReview, null, "a review stays with the wallet that built it");
  await waitFor("wallet B", () => t.state.gid === B);
  assert.equal(t.signedMode(B), false);
  await t.failSession(gid, { id: second.id }, "Late failure.");
  assert.equal(data.get(`groups/${gid}/sessions/${second.id}`).errorBy >= 1, true);
  assert.equal(data.has(`groups/${B}/sessions/${second.id}`), false, "nothing went to wallet B");
  t.openGroup(gid);
  await waitFor("wallet A again", () => t.state.sessions.length === 3 && !t.state.pending);
  const late = t.state.sessions.find((x) => x.id === second.id);
  assert.deepEqual([late.status, late.error], ["failed", "Late failure."]);

  // A memo goes into the signed payee list. A payee without a memo stays {to, amount}.
  let asked;
  const stubWallet = {
    createSpend: async (list) => { asked = JSON.parse(list); return JSON.stringify(spend); },
    free() {},
  };
  t.setChain({ gid, bal: { spendable: 1e8, pending: 0 }, received: [], sent: new Set(),
    cw: stubWallet });
  const payees = [{ to: "utest1x", amount: 5, memo: "rent, part 1" }, { to: "utest1y", amount: 6 },
    { to: "utest1z", amount: 7 }];
  await t.newSpend([payees[0], { ...payees[1], memo: "" }, payees[2]], "memos");
  assert.deepEqual(asked, payees, "the engine gets a memo only where there is text");
  await waitFor("memo proposal", () => t.state.sessions.some((x) => x.note === "memos"));
  const memoed = t.state.sessions.find((x) => x.note === "memos");
  assert.deepEqual(memoed.payees, payees, "the reader accepts the signed proposal with its memo");

  // The approver compares address, amount and memo of every payee with the decoded outputs.
  const addr = t.state.wallet.address, who = Z.normalizeAddress(addr);
  const opt = (memo) => (memo === undefined ? {} : { memo });
  const out = (status, memo) => (
    { kind: "output", who, value: 5, memo_status: status, ...opt(memo) });
  const check = (memo, line) => t.recipientCheck(
    { payees: [{ to: addr, amount: 5, ...opt(memo) }], amount: 5 }, { lines: [line] });
  assert.equal(check("rent", out("text", "rent")).match, true);
  assert.equal(check(undefined, out("empty")).match, true);
  assert.equal(check("", out("empty")).match, true);
  for (const [memo, line] of [["rent", out("empty")], [undefined, out("text", "rent")],
    ["rent", out("unknown")], [undefined, out("unknown")], ["rent", out("not_text")],
    ["rent", out("text", "Rent")], [5, out("text", "5")]]) {
    const what = JSON.stringify([memo, line.memo_status, line.memo]);
    assert.equal(check(memo, line).match, false, what);
  }
  assert.equal(check("rent", out("text", "Rent")).rows[0].got, "Rent");

  // The engine gets the fee choice of the proposer.
  let priority;
  const feeWallet = {
    createSpend: async (list, fast) => { priority = fast; return JSON.stringify(spend); },
    free() {},
  };
  t.setChain({ gid, bal: { spendable: 1e8, pending: 0 }, received: [], sent: new Set(),
    cw: feeWallet });
  await t.newSpend([{ to: "utest1x", amount: 5 }], "fast", null, true);
  assert.equal(priority, true);
  await t.newSpend([{ to: "utest1x", amount: 5 }], "slow");
  assert.equal(priority, false);

  // A proposal expires at the height that the engine decodes. The page counts the blocks from
  // its last sync. An expired proposal asks for no approval, gets none, and "Propose again"
  // fills the Send form with its payees, memos, note and fee choice.
  const decoded = { sighash: "00", tx_version: "V6", spends: [], lines: [], fee: 100000,
    standard_fee: 10000, expiry_height: 4503456, txid: "realtx" };
  const realZ = { ...Z };
  t.setZ({ ...Z, inspect: (pczt) => {
    if (pczt !== "EXP1") throw new Error("unreadable");
    return JSON.stringify(decoded);
  } });
  const lateSpend = { ...spend, pczt: "EXP1", fee: 100000 };
  const lateChain = (height, sent = new Set()) => t.setChain({ gid, url: "https://lwd.test",
    bal: { spendable: 1e8, pending: 0, height }, received: [], sent,
    cw: { createSpend: async () => JSON.stringify(lateSpend), free() {} } });
  lateChain(4500000);
  await t.newSpend([{ to: "utest1x", amount: 5, memo: "rent" }], "late rent", null, true);
  await waitFor("late proposal", () => t.state.sessions.some((x) => x.note === "late rent"));
  const lateOne = () => t.state.sessions.find((x) => x.note === "late rent");
  assert.deepEqual(t.expiryOf(lateOne()),
    { expired: false, blocks_left: 3456, seconds_left: 86400 }, "one day at 25 seconds");
  assert.equal(t.expired(lateOne()), false);
  assert.equal(t.priorityTimes(decoded), 10);
  assert.equal(t.needsMyApproval(gid, lateOne()), true);
  assert.equal(t.needsMyApproval(gid, { ...lateOne(), checking: true }), false,
    "a part waits for its check: it may be a cancel");
  lateChain(4503453);
  assert.equal(t.expired(lateOne()), true, "a node refuses it 3 blocks before its height");
  assert.equal(t.needsMyApproval(gid, lateOne()), false);
  const seat = t.localSeats()[0];
  await assert.rejects(t.approve(lateOne(), seat), /expired, so it was not approved/);
  Object.assign(t.ui, { send: false, pay: null, note: "", priority: false });
  await t.proposeAgain(lateOne());
  assert.equal(t.ui.send, true);
  assert.deepEqual(t.ui.pay.map((r) => [r.to, r.amt, r.memo]), [["utest1x", "0.00000005", "rent"]]);
  assert.deepEqual([t.ui.note, t.ui.priority], ["late rent", true]);
  t.ui.send = false;
  // The engine checks the expiry again, with the height that the server gives at the moment of
  // approval, not with the height of the last sync. A server that is down passes the question
  // to the next server of the network.
  lateChain(4500000);
  let tipSeen;
  const height = async (url) => {
    if (url === "https://lwd.test") throw new Error("down");
    return 4503460;
  };
  t.setZ({ ...Z, latestHeight: height, signCommit: (...args) => {
    tipSeen = args[3];
    throw new Error("the engine refuses it");
  } });
  await assert.rejects(t.approve(lateOne(), seat), /the engine refuses it/);
  assert.equal(tipSeen, 4503460);
  // During the wait for the chain height another tab saves the secrets of the seat, and the
  // signer clicks Approve twice. One approval runs, and the nonces of the other tab survive.
  let release, commits = 0;
  const gate = new Promise((done) => { release = done; });
  t.setZ({ ...Z, latestHeight: () => gate.then(() => 4500001), signCommit: () => {
    commits += 1;
    return JSON.stringify({ nonces: ["n"], commitments: ["c"] });
  } });
  const slot = t.state.gid + ":" + seat;
  const click1 = t.approve(lateOne(), seat), click2 = t.approve(lateOne(), seat);
  await click2;
  t.secrets = { ...t.secrets, [slot]: { ...t.secrets[slot], nonces: { other: { sighash: "11" } } } };
  storage.set("zf-secrets", JSON.stringify(t.secrets));   // the other tab saved it
  release();
  await click1;
  const kept = t.sec(t.state.gid, seat).nonces;
  assert.deepEqual([commits, Object.keys(kept).sort()], [1, [lateOne().id, "other"].sort()]);
  await assert.rejects(t.approve(lateOne(), seat), /already approved this payment/);

  // A sent payment that no block held up to 3 blocks after its expiry height frees its notes.
  // One that a block holds stays sent.
  const sentOne = { id: "zz", pczt: "EXP1", broadcastTxid: "tx9", final: { txid: "tx9" } };
  t.state.sessions.push(sentOne);
  lateChain(4503458);
  assert.deepEqual([t.expired(sentOne), t.inFlight().includes(sentOne)], [false, true]);
  lateChain(4503459);
  assert.deepEqual([t.expired(sentOne), t.inFlight().includes(sentOne)], [true, false]);
  lateChain(4503459, new Set(["realtx"]));
  assert.equal(t.expired(sentOne), false, "a block holds it");
  // A seat writes `final.txid` alone. The page takes the id from the approved PCZT, so a false
  // id can neither free the notes of a payment that a block holds nor keep them held.
  lateChain(4503600, new Set(["tx9"]));
  assert.equal(t.expired(sentOne), true, "the id that a seat wrote does not count");
  const forged = { id: "zf", pczt: "EXP1", broadcastTxid: "fake", final: { txid: "fake" } };
  t.state.sessions.push(forged);
  lateChain(4503600, new Set(["realtx"]));
  assert.deepEqual([t.expired(forged), t.inFlight().includes(forged)], [false, false]);
  t.state.sessions.splice(t.state.sessions.indexOf(forged), 1);
  t.state.sessions.splice(t.state.sessions.indexOf(sentOne), 1);
  // A finished payment without its sent mark (the send timed out after a server took it, or the
  // mark was not saved) can still be on the network. It counts as gone only 3 blocks after its
  // expiry height, and never once a block holds it: "Propose again" would pay twice.
  const unmarked = { id: "zy", pczt: "EXP1", signed: "s", final: { txid: "tx8" },
    broadcastError: "timeout" };
  lateChain(4503453);
  assert.equal(t.expired(unmarked), false, "it may be on the network");
  lateChain(4503459);
  assert.equal(t.expired(unmarked), true);
  lateChain(4503600, new Set(["realtx"]));
  assert.equal(t.expired(unmarked), false, "a block holds it");
  t.setZ(realZ);
  assert.equal(Z.blockSpanSeconds("mainnet", 3500000, 3500010), 750, "75 seconds before NU7");
  assert.equal(Z.blockSpanSeconds("testnet", 4500000, 4500010), 250, "25 seconds after NU7");

  // "Propose this" fills the Send form and writes nothing. A form made for one wallet is dropped
  // when another wallet opens.
  const other = "utest1m6h0x5p0ryej3e4raszk99rz3k3gxzj35j7ypw3mm98uxmxt3x7mnmu22cprpl7rls4cc5k"
    + "xzvhqxju6pp4rxsw6ajnkm0d4egf4yrjx";
  const memo = Buffer.from("October rent").toString("base64url");
  const mainAddr = "u1ljgj2vz0uzz5ku88wq07pqwepyyaw6azem5rnl56xu0wfjkxpkd84e40y36wy6da7f"
    + "vcd845jwl09pg9uwc5zlx0cead3xsz7vuqm5z2";
  const mixed = t.requestOf(`zcash:${other}?amount=1.5&memo=${memo}&address.1=${addr}`, false);
  assert.deepEqual([mixed.payees.length, mixed.total, mixed.open], [2, null, 1]);
  assert.equal(mixed.blocker, "", "a request that pays the open wallet is checked by the card");
  assert.equal(t.requestOf("pay zcash:x later", false), null);
  // Plain text costs no engine call: the page asks for every message on every draw.
  let normalizeCalls = 0;
  const counting = (a) => { normalizeCalls++; return Z.normalizeAddress(a); };
  t.setZ({ ...fakeZ, normalizeAddress: counting });
  for (const text of ["hello", "pay zcash:x later", "", "x".repeat(2000)]) t.requestOf(text, false);
  assert.equal(normalizeCalls, 0, "plain text makes no engine call");
  t.requestOf(`zcash:${other}?amount=1`, false);
  assert.ok(normalizeCalls > 0, "a request does");
  t.setZ(fakeZ);
  const one = t.requestOf(`zcash:${other}?amount=1.5&memo=${memo}`, false);
  assert.equal(one.blocker, "");
  const saved = JSON.stringify([...data]);
  t.ui.send = false; t.ui.pay = null; t.ui.note = "";
  t.proposeRequest(one, { name: "Alice (device 2)", verdict: "yes" }, gid);
  assert.deepEqual([t.ui.send, t.ui.sendFor, t.ui.note],
    [true, gid, "Request from Alice (device 2)"]);
  // The note goes to every approver. A message of a sender that is not verified can carry any
  // name, so the name stays out of the note.
  for (const verdict of ["no", "changed", "unknown", "wait"]) {
    t.proposeRequest(one, { name: "Alice (device 2)", verdict }, gid);
    assert.equal(t.ui.note, "Request from an unverified sender", verdict);
  }
  t.proposeRequest(one, { name: "a memo", verdict: "memo" }, gid);
  assert.equal(t.ui.note, "Request from a memo");
  t.proposeRequest(one, { name: "Alice (device 2)", verdict: "yes" }, gid);
  assert.deepEqual(t.ui.pay.map(({ to, amt, memo: m }) => ({ to, amt, m })),
    [{ to: other, amt: "1.5", m: "October rent" }]);
  assert.equal(JSON.stringify([...data]), saved, "Propose this writes nothing to the store");
  t.proposeRequest(one, { name: "You (device 1)", verdict: "yes", mine: true }, gid);
  assert.equal(t.ui.note, "Request from the proposer", "an approver is not \"You\"");
  const roomName = t.groupName(gid);
  t.proposeRequest(one, { name: "Bob (device 2)", verdict: "yes" }, B);
  await waitFor("wallet B", () => t.state.gid === B);
  assert.deepEqual([t.ui.send, t.ui.note, t.ui.pay.length],
    [true, "Request from Bob (device 2) in " + roomName, 1],
    "the form stays for the wallet that it was made for, and the note names the room");
  t.openGroup(gid);
  assert.deepEqual([t.ui.send, t.ui.note, t.ui.pay], [false, "", null], "another wallet drops it");
  await waitFor("wallet A again", () => t.state.sessions.length > 0 && !t.state.pending);

  // A chat offers the wallets where this browser holds a key share, and the address that its own
  // seat checked, whatever the store says now.
  t.state.groups = [t.state.g];
  t.ready[gid] = { address: "utest1fromthestore" };
  assert.deepEqual(t.proposeWallets("test").map((w) => w.id), [gid]);
  assert.deepEqual(t.proposeWallets("main"), [], "the network of the wallet must match");
  assert.deepEqual(t.dmChoices(), [{ id: gid, name: "Team", address: addr, net: "testnet" }]);
  t.state.groups = [{ ...t.state.g, movedTo: B }];
  assert.deepEqual([t.proposeWallets("test"), t.dmChoices()], [[], []],
    "a moved wallet is left out");
  t.ready[gid] = false;
  t.state.groups = [t.state.g];
  assert.deepEqual(t.proposeWallets("test"), [], "a wallet that is still setting up is left out");

  // A request pasted in a recipient field replaces that row. The new rows have new keys.
  const hint = { textContent: "", className: "" };
  const two = `zcash:${other}?amount=2&address.1=${other}`;
  let rows = [{ k: 1, to: two, amt: "", memo: "" }, { k: 2, to: "", amt: "", memo: "" }];
  t.ui.payKey = 10;
  assert.equal(t.fillFromRequest(rows[0], rows, hint), true);
  assert.deepEqual(rows.map((r) => [r.k, r.to === other, r.amt]),
    [[11, true, "2"], [12, true, ""], [2, false, ""]]);
  assert.equal(hint.textContent, "", "no error");
  rows = [{ k: 1, to: other, amt: "", memo: "" }];
  assert.equal(t.fillFromRequest(rows[0], rows, hint), false, "an address is not a request");
  rows = [{ k: 1, to: "zcash:garbage", amt: "", memo: "" }];
  assert.equal(t.fillFromRequest(rows[0], rows, hint), true);
  assert.equal(hint.textContent,
    "This request cannot be used. This is not a valid ZIP 321 request.");
  assert.deepEqual([hint.className, rows.length, rows[0].to], ["hint bad", 1, "zcash:garbage"]);
  rows = Array.from({ length: 20 }, (_, k) => ({ k: k + 1, to: k ? "" : two, amt: "", memo: "" }));
  assert.equal(t.fillFromRequest(rows[0], rows, hint), true);
  assert.equal(hint.textContent, "A payment can have at most 20 recipients.");
  assert.equal(rows.length, 20, "the rows stay as they were");

  // The cards and the forms draw in every state. The page is a stub, so this finds only errors.
  const okReq = t.requestOf(`zcash:${other}?amount=1`, false);
  const badReq = t.requestOf("zcash:garbage", false);
  for (const verdict of ["yes", "wait", "no", "changed", "unknown", "memo"]) {
    for (const dm of [false, true]) {
      for (const req of [okReq, mixed, badReq]) {
        t.requestCard(req, { id: "m1", name: "Alice", verdict, dm });
      }
    }
  }
  t.state.groups = [t.state.g];
  t.ready[gid] = { address: addr };
  t.requestCard(t.requestOf(`zcash:${other}`, true),
    { id: "m2", name: "Bob", verdict: "yes", dm: true });
  t.memoBody({ id: "x:0", text: `zcash:${other}?amount=1` });
  t.memoBody({ id: "x:1", text: null });
  t.memoBody({ id: "x:2", text: "thanks" });
  const room = { kind: "wallet-x", why: "", seats: [1, 2], to: "Message", fine: "", key: "k",
    send() {} };
  for (const request of [null, t.roomRequest(), t.chatRequest()]) {
    for (const open of [null, "wallet-x"]) {
      t.ui.request = open;
      t.composer({ ...room, request });
      t.composer({ ...room, request, why: "Not now." });
    }
  }
  t.ui.request = null;
  t.ui.pay = null;
  t.sendDialog();

  // What the cards and the forms say, with a recorder in place of the page.
  const realDocument = globalThis.document;
  class Rec extends Node {
    constructor(tag) {
      super();
      Object.assign(this, { tag, attrs: {}, kids: [], on: {}, style: {} });
    }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    addEventListener(type, fn) { this.on[type] = fn; }
    replaceChildren(...x) { this.kids = x; }
    append(...x) {
      this.kids.push(...x);
      if (this.tag === "select" && this.value === undefined) this.value = x[0]?.attrs?.value;
    }
  }
  const textOf = (n) => n.text ?? n.kids.map(textOf).join("");
  const all = (n, pred, out = []) => {
    if (n.kids) { if (pred(n)) out.push(n); n.kids.forEach((k) => all(k, pred, out)); }
    return out;
  };
  const named = (n, tag, label) => all(n, (x) => x.tag === tag && textOf(x) === label)[0];
  const callouts = (n) => all(n, (x) => x.className === "callout bad").map(textOf);
  globalThis.document = {
    createElement: (tag) => new Rec(tag), createElementNS: (ns, tag) => new Rec(tag),
    createTextNode: (text) => ({ text }),
  };
  try {
    assert.equal(textOf(t.statusChip(checkingSession)), "Checking", "the chip of that payment");
    const setBal = (spendable) => t.setChain({ gid, bal: { spendable, pending: 0 }, received: [],
      sent: new Set(["T1"]), cw: null });
    setBal(0);
    assert.equal(t.sendBlocker(), "This wallet has no funds yet.");
    setBal(10000);
    assert.equal(t.sendBlocker(), "The balance does not cover the network fee.");
    setBal(1e8);
    const card = (req, verdict, dm = false, name = "Alice") =>
      t.requestCard(req, { id: "m1", name, verdict, dm });
    let c = card(okReq, "yes", false, "Alice (device 2)");
    assert.match(textOf(c), /^Payment request1\.00ZEC/);
    assert.match(textOf(c), /FromAlice \(device 2\) · ✓ Verified/);
    assert.deepEqual(callouts(c), [], "a verified sender gets no warning");
    assert.equal(named(c, "button", "Propose this").attrs.disabled, undefined);
    named(c, "button", "Propose this").on.click();
    assert.deepEqual([t.ui.send, t.ui.note, t.ui.pay[0].amt],
      [true, "Request from Alice (device 2)", "1"]);
    for (const verdict of ["no", "changed", "unknown"]) {
      c = card(okReq, verdict);
      assert.match(callouts(c)[0], /Check this request with the sender before you pay\./, verdict);
      assert.equal(named(c, "button", "Propose this").attrs.disabled, undefined,
        "the person decides");
      named(c, "button", "Propose this").on.click();
      assert.equal(t.ui.note, "Request from an unverified sender",
        "the name of a sender that is not verified stays out of the note: " + verdict);
    }
    c = card(okReq, "memo", false, "a memo");
    named(c, "button", "Propose this").on.click();
    assert.equal(t.ui.note, "Request from a memo");
    c = card(okReq, "wait");
    assert.deepEqual(callouts(c), []);
    assert.equal(named(c, "button", "Propose this").attrs.disabled, "");
    assert.match(textOf(c), /Wait until the app has checked the sender\./);
    c = card(okReq, "memo", false, "a memo");
    assert.match(textOf(c), /Froma memo · Not verified/);
    assert.match(callouts(c)[0], /A memo has no sender/);
    c = card(mixed, "yes");
    assert.match(textOf(c), /The payer chooses some amounts/);
    assert.match(textOf(c), /MemoOctober rent/);
    c = card(t.requestOf(`zcash:${other}`, false), "yes");
    assert.match(textOf(c), /The payer chooses the amount.*The payer chooses the amount/);
    // The name and the message are text from the sender. The card cuts them and says so.
    const claim = (label, message) => t.requestOf(`zcash:${other}?amount=1&label=`
      + `${encodeURIComponent(label)}&message=${encodeURIComponent(message)}`, false);
    c = card(claim("Verified by your signers " + "x".repeat(300), "a\nb\nc\nd\ne"), "yes");
    assert.match(textOf(c), /From the request, not checked/);
    assert.match(textOf(c), /NameVerified by your signers x+…/);
    assert.equal(textOf(c).includes("x".repeat(150)), false, "the name is cut");
    assert.match(textOf(c), /Messagea\nb\nc…/, "the message has at most 3 lines");
    assert.equal(textOf(card(t.requestOf(`zcash:${other}?amount=1`, false), "yes"))
      .includes("not checked"), false, "no claim, no note");
    c = card(badReq, "yes");
    assert.match(textOf(c), /This request cannot be used\. This is not a valid ZIP 321 request\./);
    assert.equal(named(c, "button", "Propose this"), undefined,
      "an unusable request has no button");
    // The warning of a refused request in a wallet that reads the other network.
    c = card(t.requestOf(`zcash:${mainAddr}`, false), "yes");
    assert.match(textOf(c), /Payee 1: the address is not a testnet address\./);

    // In a chat the person picks the wallet.
    const chatReq = t.requestOf(`zcash:${other}?amount=1`, true);
    c = card(chatReq, "yes", true);
    assert.equal(all(c, (x) => x.tag === "option").map(textOf).join(), "Team (Testnet)");
    assert.match(textOf(c), /Payment requestTestnet/, "a chat card names the network");
    t.ui.send = false;
    named(c, "button", "Propose this").on.click();
    assert.deepEqual([t.ui.send, t.ui.sendFor], [true, gid]);
    t.state.groups = [];
    c = card(chatReq, "yes", true);
    assert.match(textOf(c), /This browser holds no device of a testnet wallet\./);
    assert.equal(named(c, "button", "Propose this").attrs.disabled, "");
    // Mainnet is off (M1): a chat reads a mainnet request as one for testnet, and refuses it.
    c = card(t.requestOf(`zcash:${mainAddr}`, true), "yes", true);
    assert.match(textOf(c), /Payee 1: the address is not a testnet address\./);

    // The Send form starts with the note of the request.
    t.ui.note = "Request from Alice";
    t.ui.pay = null;
    const dialog = t.sendDialog();
    assert.equal(all(dialog, (x) => x.attrs.id === "s-note")[0].attrs.value, "Request from Alice");
    // The invite link carries the key that seals the note, so the form does not say "only".
    assert.match(textOf(dialog),
      /Encrypted\. The devices of this wallet, and anyone else who has the invite link, can read/,
      "the note hint names the holder of the invite link");
    assert.doesNotMatch(textOf(dialog), /Only the devices of this wallet can read it/);

    // The request form: the open wallet in a room, a choice in a chat.
    t.state.groups = [t.state.g];
    const composer = (request, why = "") => {
      t.ui.request = "wallet-x";
      return t.composer({ ...room, request, why });
    };
    let form = composer(t.roomRequest());
    assert.ok(named(form, "button", "Request a payment"), "the toggle");
    assert.match(textOf(form), /Pays to Team/);
    assert.equal(named(form, "button", "Send request").attrs.disabled, undefined);
    assert.match(textOf(form), /Leave it empty to let the payer choose the amount\./);
    form = composer(t.roomRequest(), "Not now.");
    assert.equal(named(form, "button", "Request a payment").attrs.disabled, "");
    assert.equal(named(form, "button", "Send request"), undefined, "off while the composer is off");
    form = composer(t.chatRequest());
    assert.match(textOf(form), /Pays to Team/);
    assert.match(textOf(form), /anyone else who has the contact link, can read the address/);
    t.state.groups = [];
    form = composer(t.chatRequest());
    assert.match(textOf(form),
      /This browser holds no device of a wallet that can receive a request/);
    assert.equal(named(form, "button", "Send request").attrs.disabled, "");

    // Wallets for the next checks: Team (open), Savings and Treasury (mainnet).
    const recorder = globalThis.document;
    const third = "utest1fm3azgphez3dtyp4yf22ake0pdv8v64sredvc68gqt6n952fd9annl7c80hpl3sl0j0dxad"
      + "q7ppte0wxdvxz7phuaw4n68yxqqd4q00q";
    const W2 = "cccccccccccccccccccc", M = "dddddddddddddddddddd";
    const extra = (id, name, network, address) => {
      t.secrets[`${id}:1`] = { keyPackage: "kp", checkedWallet: JSON.stringify({ address }) };
      t.ready[id] = { address };
      return { ...t.state.g, id, name, network };
    };
    const team = t.state.g, savings = extra(W2, "Savings", "testnet", third);
    const treasury = extra(M, "Treasury", "mainnet", mainAddr);
    const ids = () => t.dmChoices().map((x) => x.id);
    const optionsOf = (n) => all(n, (x) => x.tag === "option").map(textOf);
    t.state.groups = [team, savings, treasury];

    // A mainnet wallet is offered only when its balance is known and under the cap.
    delete t.balCache[M];
    assert.deepEqual(ids(), [gid, W2], "an unknown balance on mainnet: no address");
    t.balCache[M] = null;
    assert.deepEqual(ids(), [gid, W2], "an unreadable balance counts as unknown");
    t.balCache[M] = { total: 50000000, at: 0 };
    assert.deepEqual(ids(), [gid, W2], "at the cap");
    t.balCache[M] = { total: 49999999, at: 0 };
    assert.deepEqual(ids(), [gid, W2, M], "under the cap");

    // The open wallet, in a room, follows the same rule, also before its first sync.
    const live = t.state.g, chainOf = (bal) => ({ gid, bal, received: [], sent: new Set(["T1"]),
      cw: null });
    assert.deepEqual(t.roomRequest().choices(),
      [{ id: gid, name: "Team", address: addr, net: "testnet" }],
      "the address that the wallet has");
    t.setChain(chainOf(null));
    assert.equal(t.roomRequest().why(), "", "a testnet wallet has no cap");
    t.state.g = { ...live, network: "mainnet" };
    assert.match(t.roomRequest().why(), /Wait for the first sync to finish\./);
    assert.deepEqual(t.roomRequest().choices(), []);
    t.setChain(chainOf({ spendable: 5e7, pending: 0 }));
    assert.match(t.roomRequest().why(), /This wallet holds 0\.5 ZEC/);
    t.setChain(chainOf({ spendable: 1e7, pending: 0 }));
    assert.equal(t.roomRequest().why(), "");
    t.state.g = live;
    t.setChain(chainOf({ spendable: 1e8, pending: 0 }));

    // A request that pays a wallet is not offered from that wallet, in a chat or in a room.
    const picks = (uri, dm) => card(t.requestOf(uri, dm), "yes", dm);
    let c2 = picks(`zcash:${addr}?amount=1`, true);
    assert.deepEqual(optionsOf(c2), ["Savings (Testnet)"], "Team is paid by this request");
    c2 = picks(`zcash:${other}?amount=1`, true);
    assert.deepEqual(optionsOf(c2), ["Team (Testnet)", "Savings (Testnet)"]);
    assert.equal(named(c2, "button", "Propose this").attrs.disabled, undefined);
    const both = `zcash:?address=${addr}&amount=1&address.1=${third}&amount.1=1`;
    for (const groups of [[team, savings, treasury], [team]]) {
      t.state.groups = groups;
      for (const uri of [both, `zcash:${addr}?amount=1`]) {
        if (groups.length === 3 && uri !== both) continue;
        c2 = picks(uri, true);
        assert.deepEqual(optionsOf(c2), [], "no wallet is left");
        assert.equal(named(c2, "button", "Propose this").attrs.disabled, "");
        assert.match(textOf(c2), /A wallet cannot pay itself\./);
      }
    }
    t.state.groups = [team, savings, treasury];
    // In a room, the open wallet proposes, unless the request pays it.
    c2 = picks(`zcash:${other}?amount=1`, false);
    assert.deepEqual(optionsOf(c2), [], "no picker");
    assert.equal(named(c2, "button", "Propose this").attrs.disabled, undefined);
    c2 = picks(`zcash:${addr}?amount=1`, false);
    assert.deepEqual(optionsOf(c2), ["Savings (Testnet)"], "another wallet proposes it");
    assert.equal(named(c2, "button", "Propose this").attrs.disabled, undefined);
    t.state.groups = [team];
    c2 = picks(`zcash:${addr}?amount=1`, false);
    assert.equal(named(c2, "button", "Propose this").attrs.disabled, "");
    assert.match(textOf(c2), /A wallet cannot pay itself\./);
    t.state.groups = [team, savings, treasury];

    // The form names each wallet with its network, and holds the id of the wallet.
    form = composer(t.chatRequest());
    const toSelect = all(form, (x) => x.tag === "select" && x.attrs.name === "to")[0];
    assert.deepEqual(optionsOf(toSelect),
      ["Team (Testnet)", "Savings (Testnet)", "Treasury (Mainnet)"]);
    assert.deepEqual(all(toSelect, (x) => x.tag === "option").map((x) => x.attrs.value),
      [gid, W2, M]);
    form = composer(t.roomRequest());
    const hidden = all(form, (x) => x.attrs.type === "hidden" && x.attrs.name === "to")[0];
    assert.equal(hidden.attrs.value, gid, "a single wallet has its id in a hidden field");
    assert.match(textOf(form), /Pays to Team \(Testnet\)/);

    // submitRequest: the text of the message, the network, and the wallet found by its id.
    const sent = [];
    const fields = (to, amt, memo, as) => ({ elements: {
      ...(to === undefined ? {} : { to: { value: to } }), amt: { value: amt },
      memo: { value: memo },
      ...(as === undefined ? {} : { as: { value: as } }),
    } });
    const opts = (request) => ({ key: "k-req", seats: [3], request, send: async (text, seat) => {
      assert.equal(t.busy.has("k-req"), true, "busy while the message goes out");
      sent.push([text, seat]);
    } });
    const uriOf = (net, ...rows) => Z.makeRequest(JSON.stringify(rows), net);
    t.ui.request = "wallet-x";
    await t.submitRequest(fields(gid, "1.5", " rent "), opts(t.roomRequest()));
    assert.deepEqual(sent, [[uriOf("test", { to: addr, amount: 150000000, memo: "rent" }), 3]]);
    assert.deepEqual([t.ui.request, t.busy.has("k-req")], [null, false]);
    t.ui.request = "wallet-x";
    await t.submitRequest(fields(W2, "", "", "2"), opts(t.chatRequest()));
    assert.deepEqual(sent.at(-1), [uriOf("test", { to: third }), 2], "Savings, by its id");
    await t.submitRequest(fields(M, "2", ""), opts(t.chatRequest()));
    assert.equal(sent.at(-1)[0], uriOf("main", { to: mainAddr, amount: 200000000 }));
    assert.match(sent.at(-1)[0], /^zcash:u1/, "a mainnet wallet gives a mainnet request");
    // The list changes while the person types: the choice is the same wallet or an error.
    t.state.groups = [savings, team, treasury];
    await t.submitRequest(fields(gid, "", ""), opts(t.chatRequest()));
    assert.equal(sent.at(-1)[0], uriOf("test", { to: addr }), "Team, though its place moved");
    t.state.groups = [team, treasury];
    const count = sent.length;
    await assert.rejects(t.submitRequest(fields(W2, "", ""), opts(t.chatRequest())),
      /Choose a wallet again\./);
    await assert.rejects(t.submitRequest(fields(W2, "", ""), opts(t.roomRequest())),
      /Choose a wallet again\./, "also for a single wallet");
    await assert.rejects(t.submitRequest(fields(undefined, "", ""), opts(t.chatRequest())),
      /Choose a wallet again\./);
    await assert.rejects(t.submitRequest(fields(gid, "abc", ""), opts(t.roomRequest())),
      /Enter an amount above zero/);
    await assert.rejects(t.submitRequest(fields(gid, "", "a".repeat(513)), opts(t.roomRequest())),
      /513 bytes/);
    assert.equal(sent.length, count, "an error sends nothing");
    assert.equal(t.busy.has("k-req"), false);
    t.state.groups = [team, savings, treasury];

    // Enter in a field of the request form sends and closes the form. The focused field must not
    // keep the form on the page.
    const page = { contains: () => true, querySelectorAll: () => [] };
    const typing = (id, open) => {
      t.ui.request = open;
      globalThis.document = { activeElement: { id, dataset: {}, addEventListener() {} } };
      const result = t.typingMessage(page, []);
      globalThis.document = recorder;
      return result;
    };
    assert.equal(typing("chat-text-wallet-x", null), true, "a message box always protects");
    for (const id of ["req-amt-wallet-x", "req-memo-wallet-x"]) {
      assert.equal(typing(id, "wallet-x"), true, "an open form protects " + id);
      assert.equal(typing(id, null), false, "after the send, " + id + " must not keep the form");
    }
    assert.equal(typing("req-as-wallet-x", "wallet-x"), false);
    assert.equal(typing("s-note", "wallet-x"), false);

    // The Send form follows sendBlocker: the button is off and a submit says why.
    t.setChain(chainOf(null));
    t.ui.pay = null;
    const blocked = t.sendDialog();
    assert.match(textOf(blocked), new RegExp("Pay a priority fee: .*The fee is public\\. Few "
      + "wallets pay a priority fee, so it can show that Zigs made this payment, as the expiry "
      + "height can\\."), "the priority fee label");
    assert.equal(named(blocked, "button", "Review payment").attrs.disabled, "");
    assert.match(textOf(blocked), /Wait for the first sync to finish\./);
    const reasonId = named(blocked, "button", "Review payment").attrs["aria-describedby"];
    assert.equal(all(blocked, (x) => x.attrs?.id === reasonId
      && /Wait for the first sync/.test(textOf(x))).length, 1,
    "the Review button points at the reason that it is off");
    const sessions = () => [...data.keys()].filter((k) => k.includes("/sessions/")).join();
    const stored = sessions();
    globalThis.document = { ...recorder, activeElement: { dataset: {} },
      getElementById: () => new Rec("div") };
    await blocked.on.submit({ preventDefault() {}, currentTarget: null });
    globalThis.document = realDocument;
    await sleep(300);   // the submit asks the page to draw and react: let that end here
    globalThis.document = recorder;
    assert.deepEqual(t.banner, { kind: "bad", text: "Wait for the first sync to finish." });
    assert.equal(sessions(), stored, "a refused submit proposes nothing");
    t.setChain(chainOf({ spendable: 1e8, pending: 0 }));
    assert.equal(named(t.sendDialog(), "button", "Review payment").attrs.disabled, undefined);
    assert.equal(named(t.sendDialog(), "button", "Review payment").attrs["aria-describedby"],
      undefined, "no reason, no pointer");
    t.ui.proposing = true;
    assert.notEqual(named(t.sendDialog(), "button", "Review payment").attrs.disabled, undefined,
      "off while a proposal runs (S8)");
    assert.match(t.sendBlocker(), /proposal of a payment is not complete yet/);
    t.ui.proposing = false;

    // Drafts: the typed form, sealed with the wallet key on this device, for 24 hours. A restored
    // name shows its address again; a locked key keeps the draft; an expired one goes without a
    // key; Discard deletes it.
    {
      const gidNow = t.state.gid, book = () => JSON.parse(storage.get("zf-drafts") || "{}");
      t.ui.draftGid = gidNow;
      Object.assign(t.ui, { after: null, sendFor: null, note: "rent", priority: true, pay: [{ k: 1,
        to: "alice.zec", amt: "0.5", memo: "m", name: "alice", shown: { address: "utest1x" } }] });
      t.keepDraft();
      const entry = book()[gidNow];
      assert.ok(Number.isSafeInteger(entry.at) && !/alice|rent/.test(entry.box), "sealed");
      Object.assign(t.ui, { pay: null, note: "", priority: false });
      const restored = t.sendDialog();
      assert.deepEqual(t.ui.pay.map((r) => [r.to, r.amt, r.memo, r.shown ?? null, r.name]),
        [["alice.zec", "0.5", "m", null, undefined]], "the typed text, no shown address");
      assert.deepEqual([t.ui.note, t.ui.priority], ["rent", true]);
      assert.match(textOf(restored), /Draft saved in this browser for 24 hours\./);
      const keys = t.gkeys;
      t.gkeys = { ...keys, [gidNow]: undefined };
      t.ui.pay = null;
      t.sendDialog();
      assert.equal(t.ui.pay[0].to, "", "a locked key restores nothing");
      assert.ok(book()[gidNow], "and keeps the draft");
      t.gkeys = keys;
      storage.set("zf-drafts", JSON.stringify({ [gidNow]: { ...entry, at: entry.at - 86400001 },
        other: { at: entry.at, box: "x" } }));
      t.sweepDrafts();
      assert.deepEqual(Object.keys(book()), ["other"], "an expired draft goes, a live one stays");
      Object.assign(t.ui, { pay: [{ k: 2, to: "x", amt: "", memo: "" }], note: "rent",
        after: null });
      t.keepDraft();
      // The page keeps typed values over a redraw (saveFormState), so Discard empties the fields.
      const fields = [{ value: "x" }, { value: "rent" }];
      named(t.sendDialog(), "button", "Discard draft").on.click({ currentTarget: { form: {
        querySelectorAll: () => fields } } });
      assert.equal(book()[gidNow], undefined, "Discard deletes it");
      assert.deepEqual(fields.map((f) => f.value), ["", ""], "and empties the typed fields");
      assert.deepEqual([t.ui.note, t.ui.pay.map((r) => r.to)], ["", [""]], "a new form");
      assert.deepEqual(t.wantFocus, { key: "INPUT:s-to-" + t.ui.pay[0].k + ":0", force: true },
        "the focus goes to the first recipient field");
      t.keepDraft();   // the click goes on to the form, which saves what it holds now
      assert.equal(book()[gidNow], undefined, "the empty form saves no new draft");
      Object.assign(t.ui, { pay: [{ k: 3, to: "x", amt: "", memo: "" }],
        after: { pczt: "EXP1" } });
      t.keepDraft();
      assert.equal(book()[gidNow], undefined, "no draft for Propose again");
      // A form that does not fit (a memo too long) keeps the last draft and says so.
      Object.assign(t.ui, { pay: [{ k: 5, to: "kept", amt: "", memo: "" }], after: null });
      t.keepDraft();
      const last = book()[gidNow];
      t.ui.pay = [{ k: 6, to: "kept", amt: "", memo: "m".repeat(2049) }];
      t.keepDraft();
      assert.deepEqual(book()[gidNow], last, "the last draft stays");
      const failed = t.sendDialog();
      assert.match(textOf(failed), /draft could not be saved in this browser/);
      assert.equal(failed.on.click, t.keepDraft, "a click saves too: Remove, Max, Use this list");
      t.endSend();
      assert.equal(t.ui.draftFailed, false, "a close forgets the failure of that form");
      Object.assign(t.ui, { draftFailed: true, pay: null });
      assert.doesNotMatch(textOf(t.sendDialog()), /could not be saved/, "so does a new form");
      // A form that a payment request filled is no draft of the person: it saves nothing and
      // offers no Discard, so Cancel keeps the person's own draft.
      Object.assign(t.ui, { pay: [{ k: 9, to: "utest1request", amt: "1", memo: "" }],
        note: "Request from Bob", sendFor: gidNow });
      t.keepDraft();
      assert.deepEqual(book()[gidNow], last, "the draft of the person stays");
      assert.equal(named(t.sendDialog(), "button", "Discard draft"), undefined);
      t.ui.sendFor = null;
      // A click with no change keeps the time of the draft; a draft from the future goes.
      Object.assign(t.ui, { pay: [{ k: 11, to: "same", amt: "", memo: "" }], note: "",
        priority: false });
      t.keepDraft();
      const timed = book()[gidNow].at;
      await sleep(5);
      t.keepDraft();
      assert.equal(book()[gidNow].at, timed, "no new 24 hours without typing");
      storage.set("zf-drafts", JSON.stringify({ ...book(), future: { at: Date.now() + 400000,
        box: "x" } }));
      t.sweepDrafts();
      assert.equal(book().future, undefined, "a clock that was ahead");
      // The form of another wallet is no draft of this one.
      t.ui.draftGid = "another wallet";
      t.ui.pay = [{ k: 10, to: "utest1other", amt: "", memo: "" }];
      t.keepDraft();
      assert.equal(book()[gidNow].at, timed, "the draft of this wallet stays");
      t.ui.draftGid = gidNow;
      // A draft that this browser cannot open shows no draft line and fills nothing, also when
      // only its sealed time is old.
      const aad = "draft\n" + gidNow, seal = (d) => Z.secretSeal(t.gkeys[gidNow], aad,
        JSON.stringify(d));
      const typed = { v: 1, rows: [{ to: "old", amt: "", memo: "" }], note: "", priority: false };
      for (const box of ["not a box", seal({ ...typed, at: Date.now() - 86400001 })]) {
        storage.set("zf-drafts", JSON.stringify({ [gidNow]: { at: Date.now(), box } }));
        t.ui.pay = null;
        assert.doesNotMatch(textOf(t.sendDialog()), /Draft saved/);
        assert.equal(t.ui.pay[0].to, "", "nothing restored");
      }
      // Forget deletes the drafts too: they are sealed with keys that go with the vault.
      const vault = storage.get("zf-vault"), reload = location.reload;
      location.reload = () => {};
      try {
        t.forgetVault();
      } finally {
        location.reload = reload;
        if (vault !== undefined) storage.set("zf-vault", vault);
      }
      assert.equal(storage.has("zf-drafts"), false, "Forget deletes the sealed drafts");
      // A draft for the review below, which must delete it.
      Object.assign(t.ui, { pay: [{ k: 4, to: "utest1d", amt: "1", memo: "" }], after: null });
      t.keepDraft();
      assert.ok(book()[gidNow]);
    }

    // The Send review: prepareSpend builds the transaction, the review shows what the engine
    // decoded from it, and Propose publishes that transaction as it is. A decode that does not
    // match the payees offers no Propose; a stale review is built again.
    {
      let builds = 0;
      const reviewed = { ...spend, pczt: "REV1", amount: 5, fee: 10000 };
      // The approvals of the tests above hold Send until the engine says that they expired.
      const expiredAll = () => JSON.stringify({ state: "expired", txid: "x", why: "t",
        spent: false });
      t.setChain({ ...chainOf({ spendable: 1e8, pending: 0 }),
        cw: { createSpend: async () => { builds += 1; return JSON.stringify(reviewed); },
          sessionState: expiredAll, free() {} } });
      const decodes = { REV1: 5, REV2: 6, REV3: 5 };
      t.setZ({ ...fakeZ, inspect: (pczt, fvk) => {
        if (!(pczt in decodes)) return fakeZ.inspect(pczt, fvk);
        const fee = pczt === "REV3" ? 100000 : 10000;
        return JSON.stringify({ sighash: "rr", tx_version: "V6", spends: [], fee,
          lines: [{ kind: "output", who, value: decodes[pczt], memo_status: "empty" }],
          standard_fee: 10000, expiry_height: 4503456, txid: "revtx" });
      } });
      // Async steps draw the page later: they run with the page stub, the dialogs with the
      // recorder.
      const recorderDoc = globalThis.document;
      const drawn = () => { globalThis.document = recorderDoc; return t.sendDialog(); };
      globalThis.document = realDocument;
      try {
        const prep = await t.prepareSpend([{ to: addr, amount: 5 }], false);
        assert.equal(builds, 1, "one build for the review");
        t.ui.sendReview = { prep, note: "reviewed", priority: false };
        const shown = drawn();
        assert.match(textOf(shown), /decoded the transaction that it built/);
        assert.match(textOf(shown), /Network fee0/, "the decoded fee is the standard fee");
        assert.match(textOf(shown), new RegExp("The chain does not show the recipients, the "
          + "amounts or the memos\\. The expiry height is public and can show that Zigs made "
          + "this payment\\. So can a priority fee\\. Every device of this wallet can read the "
          + "recipients, the "
          + "amounts, the memos and the note, in the shared history of the wallet\\. So can "
          + "anyone who has its invite link\\. A memo goes on chain with the payment, and its "
          + "recipient can read it too\\."), "the review says who can read the payment now");
        assert.match(textOf(shown), new RegExp("A device that a later Change devices leaves out "
          + "keeps the viewing key and the messages of this wallet\\. It can still read this "
          + "history and each later payment of this wallet\\. It cannot read the new wallet\\. "
          + "The move payment gives it the address, the amount and the note of that payment, and "
          + "the id of the new wallet\\. With the id, the device can get the sealed documents of "
          + "the new wallet and each later write from the group server\\. The server also accepts "
          + "writes from it, so the device can stop the new wallet with false documents\\."),
        "the review says what a device left out later keeps");
        assert.ok(named(shown, "button", "Propose payment"), "a match can be proposed");
        t.ui.sendReview = { prep: { ...prep, t: { ...prep.t, pczt: "REV3" } }, note: "x" };
        assert.match(textOf(drawn()), /Network fee \(priority\)/, "the fee as decoded");
        globalThis.document = realDocument;
        // A close while the build runs opens no review when the build ends.
        let release;
        const held = new Promise((r) => { release = r; });
        const built = t.chain.cw.createSpend;
        t.chain.cw.createSpend = async (...a) => { await held; return built(...a); };
        Object.assign(t.ui, { send: true, sendReview: null });
        const building = t.openReview([{ to: addr, amount: 5 }], "late");
        await sleep(20);
        assert.match(t.sendBlocker(), /still builds the review of a payment/,
          "while the review builds, Send says so: a review, no proposal");
        for (const press of documentOn.keydown) press({ key: "Escape" });
        release();
        await building;
        assert.equal(t.ui.sendReview, null, "the review of a closed Send does not open");
        t.chain.cw.createSpend = built;
        Object.assign(t.ui, { send: true });
        await t.openReview([{ to: addr, amount: 5 }], "open");
        assert.equal(t.ui.sendReview?.note, "open", "control: an open Send gets its review");
        Object.assign(t.ui, { send: false, sendReview: null });
        // Each opener starts a new run: no review of an earlier Send comes back.
        t.ui.sendReview = { prep, note: "old" };
        t.openSend({ pay: null, after: null });
        assert.deepEqual([t.ui.send, t.ui.sendReview], [true, null], "the Send button");
        await t.openReview([{ to: addr, amount: 5 }], "stale", -1);
        assert.equal(t.ui.sendReview, null, "a build of an earlier run opens no review");
        t.ui.send = false;
        // The review shows a memo as the drawer does: a character that hides text is replaced.
        t.ui.sendReview = { prep: { ...prep, payees: [{ ...prep.payees[0], memo: "a\u202eb" }] },
          note: "m" };
        assert.match(textOf(drawn()), /Memoa\ufffdb/);
        globalThis.document = realDocument;
        t.ui.sendReview = null;
        // Every close drops the review, so it never comes back over another payment: the scrim,
        // Escape, and then "Propose again" opens its own form with a direct Propose.
        t.closeSession();
        Object.assign(t.ui, { send: true, sendReview: { prep, note: "x" } });
        globalThis.document = recorderDoc;
        const [scrim] = t.layers();
        globalThis.document = realDocument;
        scrim.on.click({ detail: 2 });
        assert.equal(t.ui.send, true, "a second click on the scrim closes nothing");
        scrim.on.click({ detail: 1 });
        assert.deepEqual([t.ui.send, t.ui.sendReview], [false, null], "the scrim drops it");
        Object.assign(t.ui, { send: true, sendReview: { prep, note: "x" } });
        for (const press of documentOn.keydown) press({ key: "Escape" });
        assert.deepEqual([t.ui.send, t.ui.sendReview], [false, null], "Escape drops it");
        Object.assign(t.ui, { create: true, createStep: 2, createDraft: { n: 3, t: 2 } });
        for (const press of documentOn.keydown) press({ key: "Escape" });
        assert.deepEqual([t.ui.create, t.ui.createStep, t.ui.createDraft], [false, 0, null],
          "Escape puts the create dialog back at its first step");
        Object.assign(t.ui, { send: true, pay: null, after: { pczt: "EXP1" } });
        const again = drawn();
        globalThis.document = realDocument;
        assert.ok(named(again, "button", "Propose payment"), "Propose again: the form");
        Object.assign(t.ui, { send: false, pay: null, after: null });
        // The checks of Send run again at Propose: here the funds went meanwhile. A review of
        // another wallet goes nowhere either.
        const funded = t.chain;
        t.setChain({ ...funded, bal: { ...funded.bal, spendable: 0 } });
        await assert.rejects(t.proposeReviewed({ prep, note: "x" }), /no funds/);
        t.setChain(funded);
        await assert.rejects(t.proposeReviewed({ prep: { ...prep, gid: "other" }, note: "x" }),
          /another wallet/);
        t.ui.sendReview = { prep: { ...prep, t: { ...prep.t, pczt: "REV2" } }, note: "x",
          priority: false };
        const odd = drawn();
        globalThis.document = realDocument;
        assert.match(textOf(odd), /does not match the form/, "a decode that differs");
        assert.doesNotMatch(textOf(odd), /Leaves the wallet|Network fee/,
          "no total that the decode did not confirm");
        assert.equal(named(odd, "button", "Propose payment"), undefined, "and no Propose");
        await assert.rejects(t.proposeReviewed(t.ui.sendReview), /does not match the form/,
          "nor a Propose by another path");
        const before = t.state.sessions.length;
        t.ui.sendReview = { prep: { ...prep, at: prep.at - 5 * 60 * 1000 }, note: "old",
          priority: false };
        await assert.rejects(t.proposeReviewed(t.ui.sendReview), /out of date/, "a stale review");
        assert.equal(t.ui.sendReview, null, "the person reviews it again");
        t.ui.sendReview = { prep, note: "reviewed", priority: false };
        const buildsBefore = builds;
        await t.proposeReviewed(t.ui.sendReview);
        await waitFor("the reviewed proposal", () => t.state.sessions.length > before);
        const made = t.state.sessions.find((x) => x.note === "reviewed");
        assert.equal(made.pczt, "REV1", "the proposal is the reviewed transaction");
        assert.equal(builds, buildsBefore, "with no second build");
        assert.equal(t.ui.sendReview, null);
        assert.equal(storage.has("zf-drafts") && JSON.parse(storage.get("zf-drafts"))[t.state.gid],
          undefined, "a proposal deletes the draft of its wallet");
        // A review of a form that a request filled: its proposal keeps the person's draft.
        Object.assign(t.ui, { draftGid: t.state.gid, sendFor: null, after: null,
          pay: [{ k: 12, to: "mine", amt: "", memo: "" }], note: "", priority: false });
        t.keepDraft();
        t.ui.sendFor = t.state.gid;
        await t.openReview([{ to: addr, amount: 5 }], "from a request");
        assert.equal(t.ui.sendReview.own, false);
        const count = t.state.sessions.length;
        await t.proposeReviewed(t.ui.sendReview);
        await waitFor("the request proposal", () => t.state.sessions.length > count);
        assert.ok(JSON.parse(storage.get("zf-drafts"))[t.state.gid], "the draft stays");
        t.ui.sendFor = null;
      } finally {
        await sleep(300);
        globalThis.document = recorderDoc;
        t.setZ(fakeZ);
        t.ui.sendReview = null;
      }
    }

    // An expired payment: the chip and the drawer say so, the drawer offers "Propose again" and
    // no Cancel, and the page signs nothing for it. "Send again" comes 10 minutes after a send
    // that no block holds, and not when a node would refuse it. A move proposes the move again.
    const tipAt = (height, sent = new Set(), balAt = Date.now()) => {
      const c = { gid: t.state.gid, url: "https://lwd.test", bal: { spendable: 1e8, pending: 0,
        height }, balAt, received: [], sent, cw: null };
      t.setChain(c);
      return c;
    };
    const proposal = { id: "x1", pczt: "EXP1", status: "collecting", amount: 5, createdAt: 1,
      payees: [{ to: "utest1x", amount: 5 }] };
    const labels = (list) => list.map(textOf);
    tipAt(4500000);
    assert.equal(textOf(t.statusChip(proposal)), "Approvals open");
    assert.equal(textOf(t.statusChip({ ...proposal, checking: true })), "Checking",
      "a part of it waits for its check");
    assert.match(textOf(t.expiryLine(proposal)), /^Expires at block 4,503,456, in about 24 hours/);
    tipAt(4500000, new Set(), Date.now() - 2 * 3600 * 1000);
    assert.match(textOf(t.expiryLine(proposal)), /in about 22 hours/, "the time since the sync");
    tipAt(4500000, new Set(), null);
    assert.match(textOf(t.expiryLine(proposal)), /^Expires at block 4,503,456\. The approvals/,
      "a height from saved state gives no time");
    assert.deepEqual(labels(t.cancelAction(proposal)), ["Cancel payment"]);
    tipAt(4503453);
    assert.equal(textOf(t.statusChip(proposal)), "Expired");
    assert.match(textOf(t.expiryLine(proposal)), /expired at block 4,503,456/);
    assert.deepEqual(labels(t.nextAction(proposal, null, { rows: [], extra: [] })),
      ["Propose again"]);
    assert.deepEqual(t.cancelAction(proposal), []);
    const signer = t.localSeats()[0], nonces = t.sec(t.state.gid, signer).nonces || {};
    const packaged = { ...proposal, id: "x4", package: "P", signers: [signer] };
    await t.putSec(t.state.gid, signer, { nonces: { ...nonces, x4: { sighash: "00" } } });
    t.reactSession(packaged);
    assert.equal(t.busy.has("share:x4:" + signer), false, "no share for an expired payment");
    assert.deepEqual(t.nextAction(packaged, null, { rows: [], extra: [] }), [],
      "with a signing package, shares can make a transaction: no Propose again");
    await t.putSec(t.state.gid, signer, { nonces });

    const sentOne = { id: "x2", pczt: "EXP1", status: "broadcast", signed: "s",
      broadcastTxid: "realtx",
      final: { txid: "realtx", tx_hex: "00" }, broadcastAt: Date.now() };
    t.state.sessions.push(sentOne);
    // The bucket of the Approvals inbox that holds a payment, or null.
    const bucket = (ss) =>
      Object.entries(t.inboxRows()).find(([, list]) => list.includes(ss))?.[0] ?? null;
    tipAt(4500000);
    assert.deepEqual(t.finishButtons(sentOne), [], "no Send again before 10 minutes");
    assert.equal(bucket(sentOne), "waiting", "the inbox: a sent payment waits for its block");
    sentOne.broadcastAt = Date.now() - 11 * 60 * 1000;
    assert.deepEqual(labels(t.finishButtons(sentOne)), ["Send again"]);
    assert.equal(t.finishButtons(sentOne)[0].attrs.disabled, undefined);
    assert.equal(bucket(sentOne), "ready", "the inbox: Send again is the next step");
    // A finished transaction whose id is not the id of the proposal: Send again is off with its
    // reason, and the inbox lists the payment under attention, not as ready.
    const otherId = { ...sentOne, id: "x2b", final: { txid: "t5", tx_hex: "00" } };
    t.state.sessions.push(otherId);
    const [again, why] = t.finishButtons(otherId);
    assert.deepEqual([textOf(again), again.attrs.disabled], ["Send again", ""]);
    assert.match(textOf(why), /another id than the proposal/);
    assert.equal(t.refusedSend(otherId), true);
    assert.equal(bucket(otherId), "attention", "the inbox agrees with the drawer");
    const unsent = { ...otherId, status: "complete", broadcastTxid: undefined };
    assert.equal(textOf(t.statusChip(unsent)), "Check", "a refused send is not Ready to send");
    const cancelledOther = { ...otherId, id: "x2c", error: "Cancelled.", status: "cancelled",
      broadcastTxid: undefined };
    t.state.sessions.push(cancelledOther);
    assert.equal(t.refusedSend(cancelledOther), true, "a send step that this browser refuses");
    assert.equal(bucket(cancelledOther), null, "a cancelled payment offers no send step");
    t.state.sessions.splice(t.state.sessions.indexOf(cancelledOther), 1);
    t.state.sessions.splice(t.state.sessions.indexOf(otherId), 1);
    tipAt(4503453);
    assert.deepEqual(t.finishButtons(sentOne), [], "a node refuses it now");
    assert.match(textOf(t.expiryLine(sentOne)), /can no longer go to the network/);
    tipAt(4503459);
    // After signing, only the engine can say "Expired" (TICKETS.md ZEC-13): the chip asks to check.
    assert.equal(textOf(t.statusChip(sentOne)), "Check");
    assert.equal(bucket(sentOne), null,
      "the inbox: no approval here holds Send, so the Check state shows in Activity only");
    const checkOther = { ...otherId, id: "x2d" };
    t.state.sessions.push(checkOther);
    assert.equal(textOf(t.statusChip(checkOther)), "Check");
    assert.equal(bucket(checkOther), null, "a refused send in the Check state: no step, no row");
    t.state.sessions.splice(t.state.sessions.indexOf(checkOther), 1);
    // The inbox for the other states: a proposal to approve, an expired one, a cancelled one, and
    // a document whose facts cannot be read, which never drops out of the list.
    tipAt(4500000);
    const fresh = { ...proposal, id: "x9" }, cancelled = { ...proposal, id: "x8", error: "x" };
    const odd = { id: "x7", get status() { throw new Error("unreadable"); } };
    t.state.sessions.push(fresh, cancelled, odd);
    assert.equal(t.needsMyApproval(t.state.gid, fresh), true, "a seat here can approve x9");
    assert.equal(bucket(fresh), "review", "the inbox: a proposal to approve");
    assert.equal(bucket(cancelled), null, "the inbox: a cancelled payment that holds nothing");
    assert.equal(bucket(odd), "attention", "the inbox: a payment it cannot read");
    tipAt(4503453);
    assert.equal(bucket(fresh), null, "the inbox: an expired proposal is finished");
    t.state.sessions.splice(t.state.sessions.indexOf(fresh), 3);
    tipAt(4503459);
    const unmarkedOne = { ...proposal, id: "x5", signed: "s", final: { txid: "f", tx_hex: "00" },
      broadcastError: "timeout" };
    assert.equal(textOf(t.statusChip(unmarkedOne)), "Check");
    // One seat can rewrite the proposal of a signed payment, so after signing the page never says
    // that no block holds it and never offers "Propose again": it asks the signers to check.
    for (const signedOne of [sentOne, unmarkedOne]) {
      assert.equal(t.expired(signedOne), true);
      assert.deepEqual(t.nextAction(signedOne, null, { rows: [], extra: [] }), []);
      assert.match(textOf(t.expiryLine(signedOne)), /cannot prove that the devices signed/);
    }
    const falseId = callouts(t.txDetails(unmarkedOne)).join(" ");
    assert.match(falseId, /names the id f…f, but the proposal gives the id realtx…realtx/,
      "the false id note");
    tipAt(4503459, new Set(["realtx"]));
    assert.equal(t.expired(sentOne), false);
    assert.equal(textOf(t.statusChip(unmarkedOne)), "Sent", "a block holds the approved one");
    assert.equal(bucket(sentOne), null, "the inbox: a sent payment in a block is finished");
    assert.equal(t.expiryLine(unmarkedOne), null);
    tipAt(4500000);
    // Its finished transaction names another id than the proposal: the drawer that shows the
    // false id above sends nothing.
    const [resend, refused] = t.finishButtons(unmarkedOne);
    assert.deepEqual([textOf(resend), resend.attrs.disabled], ["Send again", ""]);
    assert.match(textOf(refused), /another id than the proposal/);
    assert.deepEqual(labels(t.finishButtons({ ...unmarkedOne,
      final: { txid: "realtx", tx_hex: "00" } })), ["Send again"]);
    tipAt(4500000, new Set(["realtx"]));
    assert.deepEqual(t.finishButtons(unmarkedOne), [], "no Send again for a payment on chain");
    t.state.sessions.splice(t.state.sessions.indexOf(sentOne), 1);

    const group = t.state.g;
    t.state.g = { ...group, movedTo: "MV1" };
    t.gkeys = { ...t.gkeys, MV1: "k".repeat(43) };
    t.ready.MV1 = { address: "utest1m" };
    const move = { ...proposal, id: "x3", move: "MV1" };
    t.state.sessions.push(move);
    assert.equal(t.moveState(tipAt(4500000)).session, move);
    assert.equal(t.moveState(tipAt(4503453)).propose, true, "the expired move goes again");
    const moveCard = () => all(t.walletView(null, null),
      (x) => /^card card-pad/.test(x.className ?? "")
        && /Changing devices|This wallet moved|The Zcash funds moved/
        .test(textOf(x)))[0];
    const cancelIn = (card) => all(card, (x) => x.tag === "button" && textOf(x) === "Cancel move");
    t.ui.tab = "overview";
    assert.equal(cancelIn(moveCard()).length, 1, "Cancel while no move payment is open");
    // The move sends the Zcash funds only. An empty Zcash balance counts as of the last sync and
    // closes nothing. Before a sync the page knows only that a device sent the move. A wallet that
    // can have a Solana part says that such a part stays, and the move can still be done.
    const sentMove = { ...move, id: "x3s", broadcastTxid: "realtx", broadcastAt: 1,
      final: { txid: "realtx", tx_hex: "00" } };
    t.state.sessions.splice(t.state.sessions.indexOf(move), 1, sentMove);
    const emptied = () => {
      const c = tipAt(4500000, new Set(["realtx"]));
      c.bal.spendable = 0;
      return c;
    };
    const SOL_STAYS = new RegExp(" If this wallet has a Solana part, it does not move this way: "
      + "check it in its Solana section\\. A device that is left out keeps its key share of that "
      + "part, so it can still read the Solana history and approve Solana payments\\.$");
    const solKey = "confirmednet:" + t.state.gid, pinned = t.signPins[solKey];
    delete t.signPins[solKey];
    try {
      assert.equal(t.solOn(), false, "no Solana part: the wallet is not confirmed on testnet");
      let m = t.moveState(emptied());
      assert.match(m.text, /^The Zcash funds moved to .+, as of the last sync\.$/,
        "the Zcash funds moved, as of the last sync");
      assert.equal(m.done, true);
      assert.equal(t.moveWord(t.state.g), "ZEC moved",
        "the open wallet reads its move payment");
      assert.match(textOf(moveCard()), /^The Zcash funds moved/,
        "the heading names the Zcash funds only");
      assert.doesNotMatch(textOf(moveCard()), /Closed|is closed/, "no Closed badge or text");
      assert.equal(cancelIn(moveCard()).length, 0, "no Cancel once the move payment exists");
      const incoming = emptied();
      incoming.bal.pending = 5;
      assert.match(t.moveState(incoming).text, /Move the Zcash funds to it\./,
        "incoming funds keep the move open");
      const more = () => tipAt(4500000, new Set(["realtx"]));
      assert.match(t.moveState(more()).text, /Move the Zcash funds to it\. Like any/,
        "more funds came in: move them too");
      assert.equal(t.moveWord(t.state.g), "Moving", "and the open wallet is still moving");
      const devicesText = () => {
        t.ui.tab = "members";
        try { return textOf(t.walletView(null, null)); } finally { t.ui.tab = "overview"; }
      };
      assert.doesNotMatch(devicesText(), /Solana part/, "Devices: no Solana text without one");
      const SENT = new RegExp("^A device sent the Zcash funds to .+\\. This browser has not "
        + "synced yet, so it cannot show if they arrived\\.$");
      for (const c of [null, { ...more(), bal: null }]) {
        t.setChain(c);
        const n = t.moveState(c);
        assert.match(n.text, SENT, "a sent move before a sync says only what the page knows");
        assert.deepEqual([n.propose, n.done, n.open], [undefined, undefined, "MV1"],
          "no Move button and no done before a sync");
      }
      t.signPins[solKey] = "testnet";
      assert.equal(t.solOn(), true, "a wallet that can have a Solana part");
      // Its start documents say that it never added Solana: no place names a Solana part.
      // With no seat here, Recovery reads no Solana file, so it loads no Solana module.
      const recoveryText = () => {
        const seatsHere = t.secrets;
        Object.assign(t, { secrets: {} });
        t.ui.tab = "recovery";
        try { return textOf(t.walletView(null, null)); } finally {
          t.ui.tab = "overview";
          Object.assign(t, { secrets: seatsHere });
        }
      };
      const stays = /If this wallet has a Solana part, it does not move this way/;
      const names = () => [stays.test(t.moveState(emptied()).text), stays.test(devicesText()),
        /a Solana part does not move this way/.test(recoveryText()),
        stays.test(textOf(t.createDialog(t.state.g)))];
      assert.deepEqual([t.solNotAdded(), ...names()], [true, false, false, false, false],
        "a wallet that never added Solana names no Solana part");
      // Before its start documents are read, the sentence shows: it holds either way.
      t.resetSolStart();
      assert.deepEqual([t.solNotAdded(), ...names()], [false, true, true, true, true],
        "a wallet that may have a Solana part names it everywhere");
      m = t.moveState(emptied());
      assert.match(m.text, /^The Zcash funds moved to .+, as of the last sync\./);
      assert.match(m.text, SOL_STAYS, "a move with a Solana part says that this part stays");
      assert.equal(m.done, true, "the Solana sentence does not keep the move open");
      assert.match(textOf(moveCard()), /^The Zcash funds moved/,
        "with a Solana part too, the heading names the Zcash funds only");
      assert.match(t.moveState(more()).text, SOL_STAYS, "also in the other steps");
      assert.match(devicesText(), /move the Zcash funds to it\. If this wallet has a Solana part,/,
        "Devices: a Solana part does not move");
    } finally {
      t.signPins[solKey] = pinned;
    }
    t.state.sessions.splice(t.state.sessions.indexOf(sentMove), 1);
    t.state.g = group;
    delete t.ready.MV1;
    // The start documents of the wallet are read again: it never added Solana. The read draws
    // the page, so it runs under the stub page.
    {
      const drawing = globalThis.document;
      globalThis.document = realDocument;
      try {
        t.solAttach(t.state.gid, "groups/" + t.state.gid);
        await waitFor("the start documents", () => t.solNotAdded());
        await sleep(300);
      } finally {
        globalThis.document = drawing;
      }
    }

    {
      // A redraw keeps an open secret link open by its link, and never opens the secret link of
      // another card, whose summary reads the same (saveFormState, restoreFormState).
      const box = (link, open) => {
        const d = { open, dataset: link ? { link } : {} };
        d.summary = { textContent: "Show link and QR code", parentElement: d };
        return d;
      };
      const page = (boxes) => ({
        querySelector: () => null,
        querySelectorAll: (sel) => (sel === "details[open] > summary"
          ? boxes.filter((b) => b.open).map((b) => b.summary)
          : sel === "details > summary" ? boxes.map((b) => b.summary) : []),
      });
      const form = t.saveFormState(page([box("gidA", true), box(null, true)]));
      const other = box("gidB", false), same = box("gidA", false), plain = box(null, false);
      t.restoreFormState(page([other, same, plain]), form);
      assert.equal(other.open, false, "a redraw does not open the secret link of another card");
      assert.equal(same.open, true, "a redraw keeps the open link of the same card");
      assert.equal(plain.open, true, "and a plain disclosure with the same summary");
    }

    {
      // ── ZEC-13: after signing, "done", "expired" and "Propose again" come from the engine
      // The engine is a stub that records what the page passes. The browser keeps the sighash
      // that it approved (in the seat secrets) and the PCZT (sealed in IndexedDB), and passes them,
      // not a proposal that one seat rewrote.
      const keptStore = new Map(), idbBefore = t.getIdb();
      let slowKey = null, slowGate = null;
      t.setIdb(async (mode, fn) => {
        const r = fn({
          get: (k) => ({ result: keptStore.get(k), wait: k === slowKey ? slowGate : null }),
          put: (v, k) => { keptStore.set(k, v); return { result: k }; },
          delete: (k) => { keptStore.delete(k); return { result: undefined }; },
        });
        if (r.wait) await r.wait;
        return r.result;
      });
      const tx = (sighash, txid) => ({ sighash, txid, tx_version: "V6", spends: [], lines: [],
        fee: 10000, standard_fee: 10000, expiry_height: 4503456 });
      // The approved transaction pays what the test proposals list: 5 to utest1x.
      const pays5 = [{ kind: "output", who: "utest1x", value: 5, memo_status: "empty" }];
      const decodes = { PA: { ...tx("aa", "tx-a"), lines: pays5 }, PB: tx("bb", "tx-b"),
        PC: tx("cc", "tx-c"), PD: tx("dd", "tx-d"), SA: { ...tx("aa", "tx-a"), lines: pays5 },
        PH: { ...tx("hh", "tx-h"), fee: 20000 },
        PE: { ...tx("ee", "tx-e"), expiry_height: 4400000 },
        PF: { ...tx("ff", "tx-f"), expiry_height: 4999999 },
        PG: { ...tx("aa", "tx-a"), expiry_height: 4503556 } };
      const asked = [];
      let answer = () => ({ state: "unknown", txid: null, why: "no transaction" });
      const S = JSON.stringify;
      // From = 4,503,456 - 6,912 = 4,496,544: x4 is at the first block that counts, x5 before it.
      const history = [{ txid: "x1", h: 4496000 }, { txid: "x2", h: 4497000 },
        { txid: "x3", h: 4500000 }, { txid: "x4", h: 4496544 }, { txid: "x5", h: 4496543 }];
      const engine = {
        sessionState: (p, sg, a) => { asked.push([p, sg, a]); return S(answer(p, sg, a)); },
        createSpend: async (...args) => { asked.push(["spend", ...args]); return S(spend); },
        snapshot: () => S({ sent: history }),
        free() {},
      };
      // A new chain state is a new sync: the page asks the engine again.
      const at = (height, sent = new Set(), balAt = Date.now()) => {
        const c = { gid: t.state.gid, url: "https://lwd.test", bal: { spendable: 1e8, pending: 0,
          height }, balAt, received: [], sent, cw: engine };
        t.setChain(c);
        return c;
      };
      t.setZ({ ...fakeZ, latestHeight: async () => 4500001, normalizeAddress: (a) => a,
        inspect: (p) => { if (!decodes[p]) throw new Error("unreadable"); return S(decodes[p]); },
        signCommit: () => S({ nonces: ["n"], commitments: ["c"] }) });
      const [me, other, third] = t.localSeats();
      const markOf = (seat, sid) => (t.sec(t.state.gid, seat).marks || {})[sid];
      const none = { rows: [], extra: [] };
      // These calls show banners: they run with the stub page, not the recorder.
      const quiet = async (fn) => {
        const drawing = globalThis.document;
        globalThis.document = realDocument;
        try { return await fn(); } finally { globalThis.document = drawing; }
      };
      // The page rebuilds its list from the store after a write: a test session goes in by id.
      const put = (...list) => {
        const ids = new Set(list.map((x) => x.id));
        t.state.sessions = [...t.state.sessions.filter((x) => !ids.has(x.id)), ...list];
      };
      const open = (id, pczt = "PA", createdAt = 10) => ({ id, pczt, status: "collecting",
        amount: 5, createdAt, payees: [{ to: "utest1x", amount: 5 }] });
      const unburn = async (seat, sid) => {
        const nonces = { ...t.sec(t.state.gid, seat).nonces };
        delete nonces[sid];
        await t.putSec(t.state.gid, seat, { nonces });
      };
      const approved = async (seat, ss) => { put(ss); await quiet(() => t.approve(ss, seat)); };
      // The headline of the drawer follows the Approve buttons: a transaction that pays what the
      // proposer listed asks for an approval here, one that pays another payee asks for none.
      const headOf = (ss) =>
        textOf(all(t.sessionLayer(ss), (x) => x.className === "pay-status")[0]);
      at(4500000);
      assert.match(headOf(open("zn")), /^Your approval is needed/,
        "a transaction that pays the listed payee asks for an approval here");
      assert.match(headOf({ ...open("zm"), payees: [{ to: "utest1other", amount: 5 }] }),
        /^Payment needs attention.*does not pay what the proposer listed/,
        "a payee that the transaction does not pay asks for no approval");

      // An approval keeps the sighash after the nonce burn, and the PCZT in its own store.
      at(4500000);
      const za = open("za");
      await approved(me, za);
      assert.deepEqual([markOf(me, "za").approved, markOf(me, "za").tip], ["aa", 4500001],
        "the sighash and the chain height of the approval");
      assert.ok(keptStore.has(`kept:${t.state.gid}:za`), "the approved PCZT is kept, sealed");
      await unburn(me, "za");
      assert.equal(markOf(me, "za").approved, "aa", "the burn of the nonce leaves the approval");
      assert.equal(JSON.parse(t.backupText(me)).secret.marks, undefined, "no marks in a backup");

      // Signing started. One seat rewrites the proposal: the page passes the kept PCZT and the
      // approved sighash, and only the engine says "expired".
      const signedA = { ...za, pczt: "PB", status: "signing", package: "PK", signed: "SA" };
      put(signedA);
      t.noteSessions();
      assert.equal(t.sawSigning(t.state.gid, "za"), true, "this browser saw the signing start");
      // The send step takes the id of the approved PCZT, never the id of a rewritten proposal.
      const finished = (txid) => ({ ...signedA, final: { txid, tx_hex: "00" } });
      assert.equal(t.sendRefusal(finished("tx-a")), null, "the approved transaction goes out");
      assert.match(String(t.sendRefusal(finished("tx-b"))), /another id than the approved one/,
        "the rewritten proposal does not");
      assert.deepEqual(callouts(t.txDetails(finished("tx-a"))), [],
        "the drawer shows no false id next to a Send that goes out");
      assert.match(callouts(t.txDetails(finished("tx-b"))).join(" "), /names the id tx-b/);
      assert.match(String(t.sendRefusal({ id: "zq", pczt: "PX", final: { txid: "tx-x" } })),
        /cannot read the proposal/, "nothing unreadable goes out");
      await t.putSec(t.state.gid, me, { marks: { ...t.sec(t.state.gid, me).marks,
        zq: { approved: "qq" } } });   // no height: it holds nothing
      assert.match(String(t.sendRefusal({ id: "zq", pczt: "PX", final: { txid: "tx-x" } })),
        /cannot read the approved transaction/, "nor without the approved one");
      assert.match(String(t.sendRefusal({ ...signedA, final: { tx_hex: "00" } })),
        /finished transaction cannot be read/, "a finished transaction with no id");
      answer = (p, sg, a) => a === "aa" && p === "PA"
        ? { state: "expired", txid: "tx-a", why: "it expired and its notes are unspent" }
        : { state: "unknown", txid: null, why: "no" };
      at(4503500);
      assert.equal(textOf(t.statusChip(signedA)), "Expired");
      assert.deepEqual(asked.at(-1), ["PA", "SA", "aa"], "the kept PCZT and sighash, not PB");
      const line = textOf(t.expiryLine(signedA));
      assert.match(line, /none of its notes is spent/);
      assert.match(line, /3 transactions of this wallet went on chain from block 4,496,544/,
        "the engine's list, from 2 days of blocks before the expiry, the first block included");
      assert.match(line, /Each id opens testnet\.zecblock\.com in a new tab\. That site is not/,
        "the ids say what the explorer sees");
      const sentBefore = history.splice(0);
      at(4503500);
      const noIds = textOf(t.expiryLine(signedA));
      assert.match(noIds, /0 transactions of this wallet went on chain/);
      assert.doesNotMatch(noIds, /Each id opens/, "no ids, no explorer note");
      history.push(...sentBefore);
      at(4503500);
      assert.deepEqual(labels(t.nextAction(signedA, null, none)), ["Propose again"]);
      // The engine says that it expired before its height does, and the finished id is not the
      // approved one: the drawer offers Propose again, and the inbox lists no refused send.
      const endedOther = { ...signedA, final: { txid: "tx-b", tx_hex: "00" } };
      put(endedOther);
      at(4500100);
      assert.equal(t.refusedSend(endedOther), true);
      assert.deepEqual(labels(t.nextAction(endedOther, null, none)), ["Propose again"]);
      const zaBucket = Object.entries(t.inboxRows())
        .find(([k, list]) => k !== "lost" && list.some((x) => x.id === "za"))?.[0] ?? null;
      assert.equal(zaBucket, null, "the inbox agrees with the drawer");
      put(signedA);
      at(4503500);
      Object.assign(t.ui, { send: false, after: null });
      await quiet(() => t.proposeAgain(signedA));
      assert.deepEqual([t.ui.send, t.ui.after], [true, "PA"], "the new proposal spends its notes");
      t.ui.send = false;
      const again = [{ to: "utest1x", amount: 5 }];
      await quiet(() => t.newSpend(again, "again", null, false, t.ui.after));
      assert.equal(asked.find((x) => x[0] === "spend")[3], "PA", "createSpend gets the old PCZT");
      t.ui.after = null;
      // The fee comes from the approved transaction, and rows that one seat rewrote are not
      // proposed again.
      const highA = { ...signedA, pczt: "PH" };
      put(highA);
      await quiet(() => t.proposeAgain(highA));
      assert.deepEqual([t.ui.send, t.ui.priority], [true, false], "the fee of the approved one");
      Object.assign(t.ui, { send: false, after: null });
      const evilA = { ...signedA, payees: [{ to: "utest1evil", amount: 5 }] };
      put(evilA);
      await assert.rejects(quiet(() => t.proposeAgain(evilA)),
        /recipients of this payment changed/);
      assert.equal(t.ui.send, false);
      assert.match(textOf(t.sessionLayer(evilA)), /proposal changed after this browser approved/);
      put(signedA);
      await settle();

      // A reset of the signed session to a fresh proposal asks no seat of this browser to approve
      // again, the approval is refused, and Cancel does not show.
      const reset = open("za", "PB");
      put(reset);
      answer = () => ({ state: "unknown", txid: "tx-a", why: "it may still land" });
      at(4500000);
      assert.equal(t.needsMyApproval(t.state.gid, reset), false);
      await assert.rejects(quiet(() => t.approve(reset, other)),
        /signing of this payment started before/);
      assert.deepEqual(labels(t.nextAction(reset, null, none)), [], "no Propose again");
      assert.deepEqual(t.cancelAction(reset), [], "no Cancel on a reset document");

      // An approver that never saw the package: after a reset to a proposal that expired, the
      // engine decides, and while it says "unknown" the page asks the signers to check.
      const zh = open("zh");
      await approved(me, zh);
      await unburn(me, "zh");
      const zhReset = open("zh", "PD");
      put(zhReset);
      at(4503500);
      assert.equal(t.sawSigning(t.state.gid, "zh"), false);
      assert.ok(t.verdict(zhReset), "the approval is enough for the engine to decide");
      assert.equal(textOf(t.statusChip(zhReset)), "Check");
      assert.deepEqual(labels(t.nextAction(zhReset, null, none)), []);

      // A seat whose nonce was lost but whose approval stays is not asked again and is refused.
      // A changed proposal is refused for another seat of this browser.
      at(4500000);
      const zs = open("zs", "PC");
      await approved(me, zs);
      await unburn(me, "zs");
      await assert.rejects(quiet(() => t.approve(zs, me)), /already approved this payment/);
      const zsChanged = open("zs", "PB");
      put(zsChanged);
      await assert.rejects(quiet(() => t.approve(zsChanged, other)), /changed after this browser/);
      const zp = open("zp", "PC");
      put(zp);
      for (const seat of [me, other, third]) {
        await t.putSec(t.state.gid, seat, { marks: { ...t.sec(t.state.gid, seat).marks,
          zp: { approved: "cc" } } });
      }
      assert.equal(t.needsMyApproval(t.state.gid, zp), false, "every seat approved");

      // The signing starts while the approval waits for the chain height: it is refused.
      const zw = open("zw", "PC");
      put(zw);
      let release;
      const gate = new Promise((done) => { release = done; });
      t.setZ({ ...fakeZ, latestHeight: () => gate.then(() => 4500001),
        inspect: (p) => { if (!decodes[p]) throw new Error("unreadable"); return S(decodes[p]); },
        signCommit: () => S({ nonces: ["n"], commitments: ["c"] }) });
      const waiting = quiet(() => t.approve(zw, third));
      put({ ...zw, package: "PK", status: "signing" });
      t.noteSessions();
      release();
      await assert.rejects(waiting, /signing of this payment started before/);
      const z8 = { ...fakeZ, latestHeight: async () => 4500001, normalizeAddress: (a) => a,
        inspect: (p) => { if (!decodes[p]) throw new Error("unreadable"); return S(decodes[p]); },
        signCommit: () => S({ nonces: ["n"], commitments: ["c"] }) };
      t.setZ(z8);

      // Without the kept PCZT, the notes of "Propose again" come from the signed part when its
      // sighash is the approved one.
      const zf = { ...open("zf", "PB"), package: "PK", signed: "SA", status: "signing" };
      put(zf);
      await t.putSec(t.state.gid, me, { marks: { ...t.sec(t.state.gid, me).marks,
        zf: { approved: "aa" } } });
      answer = (p, sg, a) => a === "aa" ? { state: "expired", txid: "tx-a", why: "x" }
        : { state: "unknown", txid: null, why: "no" };
      at(4503500);
      Object.assign(t.ui, { send: false, after: null });
      await quiet(() => t.proposeAgain(zf));
      assert.equal(t.ui.after, "SA");
      Object.assign(t.ui, { send: false, after: null });

      // The engine says "expired", but no PCZT here has the approved sighash: the page cannot tell
      // which notes a new proposal must spend, so it offers no Propose again.
      const zn = { ...open("zn", "PB"), package: "PK", status: "signing" };
      put(zn);
      await t.putSec(t.state.gid, me, { marks: { ...t.sec(t.state.gid, me).marks,
        zn: { approved: "aa" } } });
      at(4503500);
      assert.deepEqual(t.nextAction(zn, null, none), []);
      assert.equal(textOf(t.statusChip(zn)), "Check");
      // A sent payment whose proposal does not decode: the engine's "expired" frees its notes,
      // and while it may still land it holds them.
      const zx = { ...open("zx", "PX"), package: "PK", signed: "SA", status: "broadcast",
        broadcastTxid: "tx-x", final: { txid: "tx-x", tx_hex: "00" }, broadcastAt: 1 };
      put(zx);
      await t.putSec(t.state.gid, me, { marks: { ...t.sec(t.state.gid, me).marks,
        zx: { approved: "aa" } } });
      at(4503500);
      assert.equal(t.inFlight().includes(zx), false, "the engine says that it expired");
      answer = () => ({ state: "unknown", txid: "tx-a", why: "it may still land" });
      at(4500100);
      assert.equal(t.inFlight().includes(zx), true, "it may still land");

      // Another tab marked the signing start of a session that this tab has not noted: the mark
      // counts at once. Blocked or broken storage keeps the marks of this tab.
      const zr = open("zr", "PC");
      put(zr);
      localStorage.setItem("zf-signing", JSON.stringify({
        ...JSON.parse(localStorage.getItem("zf-signing") || "{}"), [t.state.gid + ":zr"]: true }));
      at(4500000);
      // The approval reads the key at once; other checks read it at most every 250 ms.
      await assert.rejects(quiet(() => t.approve(zr, third)), /signing of this payment started/);
      await quiet(() => sleep(300));
      assert.equal(t.needsMyApproval(t.state.gid, zr), false, "the other tab's mark counts");
      const realGet = localStorage.getItem;
      const before = realGet.call(localStorage, "zf-signing");
      localStorage.getItem = () => { throw new Error("blocked"); };
      put({ ...open("zq", "PC"), package: "PK", status: "signing" });
      t.noteSessions();
      localStorage.getItem = realGet;
      assert.equal(localStorage.getItem("zf-signing"), before, "a blocked read writes nothing");
      assert.equal(t.sawSigning(t.state.gid, "zr"), true, "a blocked read drops no mark");
      t.noteSessions();   // the read works again: the mark of zq is saved now
      const stored = JSON.parse(localStorage.getItem("zf-signing"));
      assert.equal(stored[t.state.gid + ":zr"] && stored[t.state.gid + ":zq"], true, "merged");
      localStorage.setItem("zf-signing", "{broken");
      assert.equal(t.sawSigning(t.state.gid, "zr"), true, "a broken stored text drops no mark");
      localStorage.setItem("zf-signing", "{}");
      assert.equal(t.sawSigning(t.state.gid, "zr"), true, "a stored text without it drops none");
      localStorage.setItem("zf-signing", JSON.stringify(stored));

      // A seen session that is still signing keeps its Cancel; a sent one says "Confirming"
      // until a block holds it.
      const live = { ...open("zv", "PC"), package: "PK", status: "signing" };
      put(live);
      t.noteSessions();
      assert.deepEqual(labels(t.cancelAction(live)), ["Cancel payment"]);
      const liveReset = open("zv", "PC");
      put(liveReset);
      assert.deepEqual(t.cancelAction(liveReset), [], "no Cancel after a reset, without approval");
      put(live);
      const going = { ...live, status: "broadcast", signed: "SC", broadcastTxid: "tx-c",
        final: { txid: "tx-c", tx_hex: "00" }, broadcastAt: Date.now() };
      put(going);
      answer = () => ({ state: "unknown", txid: "tx-c", why: "it may still land" });
      at(4500100);
      assert.equal(textOf(t.statusChip(going)), "Confirming");

      // A sent payment holds no notes when one seat can make it hold them for ever: an error part,
      // a proposal that does not decode, an expiry more than two days away.
      const failed = { ...going, id: "zy", error: "Failed." };
      const unreadable = { ...going, id: "zu", pczt: "UNREADABLE" };
      const far = { ...going, id: "zt", pczt: "PF" };
      put(failed, unreadable, far);
      at(4500100);
      for (const x of [failed, unreadable, far]) {
        assert.equal(t.inFlight().includes(x), false, x.id + " holds no notes");
      }
      assert.equal(t.inFlight().includes(going), true, "an honest sent payment holds its notes");

      // On a browser that approved, the expiry of the approved transaction counts, not that of a
      // proposal that one seat rewrote. Without the approved transaction, nothing that the seat
      // approved can land two days of blocks after its approval.
      const zk = { ...open("zk", "PA"), signed: "SA", package: "PK", status: "broadcast",
        broadcastTxid: "tx-a", final: { txid: "tx-a", tx_hex: "00" }, broadcastAt: Date.now() };
      put(zk);
      await t.putSec(t.state.gid, me, { marks: { ...t.sec(t.state.gid, me).marks,
        zk: { approved: "aa", tip: 4500001 } } });
      const zkRewritten = { ...zk, pczt: "PE" };
      put(zkRewritten);
      answer = () => ({ state: "unknown", txid: "tx-a", why: "it may still land" });
      at(4500100);
      assert.equal(t.expiryAt(zkRewritten), 4503456, "the expiry of the approved one");
      assert.equal(t.expired(zkRewritten), false);
      assert.equal(t.inFlight().includes(zkRewritten), true, "it may still land");
      const zj = { ...zkRewritten, id: "zj", signed: "" };
      put(zj);
      await t.putSec(t.state.gid, me, { marks: { ...t.sec(t.state.gid, me).marks,
        zj: { approved: "aa", tip: 4500001 } } });
      at(4506916);
      assert.equal(t.expiryAt(zj), null, "no PCZT with the approved sighash");
      assert.equal(t.expired(zj), false, "the ceiling is 4,500,001 + 1 + 6,912 + 3");
      at(4506917);
      assert.equal(t.expired(zj), true);
      assert.match(textOf(t.expiryLine(zj)), /can no longer go on chain/);

      // A verdict of "done" counts again after a sync without its txid (a reorganisation).
      answer = () => ({ state: "done", txid: "tx-a", why: "a synced block holds it" });
      at(4500100, new Set(["tx-a"]));
      assert.equal(textOf(t.statusChip(zk)), "Sent");
      answer = () => ({ state: "unknown", txid: "tx-a", why: "it may still land" });
      at(4500101, new Set());
      assert.notEqual(textOf(t.statusChip(zk)), "Sent", "a reorganisation took it back");

      // Two expired payments with other expiries: each callout counts from its own block.
      const zg = { ...signedA, id: "zg", pczt: "PG", signed: "" };
      put(zg);
      await t.putSec(t.state.gid, me, { marks: { ...t.sec(t.state.gid, me).marks,
        zg: { approved: "aa", tip: 4500001 } } });
      answer = (p, sg, a) => (a === "aa"
        ? { state: "expired", txid: "tx-a", why: "x" }
        : { state: "unknown", txid: null, why: "no" });
      at(4503600);
      assert.match(textOf(t.expiryLine(signedA)), /from block 4,496,544/);
      assert.match(textOf(t.expiryLine(zg)), /from block 4,496,644/);

      // A load of a kept PCZT that ends after an approval does not replace the approved one.
      answer = () => ({ state: "unknown", txid: "tx-a", why: "it may still land" });
      const zz = open("zz", "PA");
      put(zz);
      const sealedOld = Z.secretSeal(t.gkeys[t.state.gid], `kept\n${t.state.gid}:zz`, "PC");
      keptStore.set(`kept:${t.state.gid}:zz`, sealedOld);
      slowKey = `kept:${t.state.gid}:zz`;
      let releaseLoad;
      slowGate = new Promise((done) => { releaseLoad = done; });
      await t.putSec(t.state.gid, other, { marks: { ...t.sec(t.state.gid, other).marks,
        zz: { approved: "aa", tip: 4500001 } } });
      at(4500100);
      t.verdict(zz);   // starts the load, which waits
      await approved(me, zz);
      releaseLoad();
      await sleep(20);
      at(4500101);
      t.verdict(zz);
      assert.equal(asked.at(-1)[0], "PA", "the approved PCZT stays");
      slowKey = null;

      // The signed part of an older payment, copied into the session: a browser that approved does
      // not show it as sent, offers no Propose again and asks the signers to check. tx-b, the txid
      // of the rewritten proposal, is an older payment that a block holds.
      const copied = { ...signedA, signed: "OLD" };
      put(copied);
      answer = () => ({ state: "unknown", txid: "tx-a", why: "the combined signatures cover "
        + "another transaction than the one this device approved" });
      at(4503500, new Set(["tx-old", "tx-b"]));
      assert.equal(textOf(t.statusChip(copied)), "Check");
      assert.deepEqual(t.nextAction(copied, null, none), []);
      assert.match(textOf(t.expiryLine(copied)), /cannot prove.*another transaction/s);
      // The approved transaction that a block holds is "done", whatever the signed part says, and
      // a cancel part that one seat writes does not hide it. It no longer holds Send.
      answer = () => ({ state: "done", txid: "tx-a", why: "a synced block holds it" });
      at(4503500, new Set(["tx-a"]));
      assert.equal(textOf(t.statusChip(copied)), "Sent");
      assert.equal(t.expiryLine(copied), null);
      const cancelled = { ...copied, error: "Cancelled by a device." };
      assert.equal(textOf(t.statusChip(cancelled)), "Sent");
      const rewrittenSent = { ...signedA, broadcastTxid: "tx-b", final: { txid: "tx-b",
        tx_hex: "00" }, broadcastAt: 1 };
      put(rewrittenSent);
      at(4500100, new Set(["tx-a"]));
      assert.equal(t.inFlight().includes(rewrittenSent), false, "the approved one landed");
      assert.doesNotMatch(String(t.sendBlocker()), /waiting for its block/);
      // The last step of the drawer, "In a block", from the synced blocks of this browser only.
      const landedA = { ...signedA, broadcastTxid: "tx-a", final: { txid: "tx-a", tx_hex: "00" },
        broadcastAt: 1 };
      const blockStep = (ss) => textOf(t.sessionLayer(ss));
      const stepClass = (ss) => all(t.sessionLayer(ss), (x) => /^step /.test(x.className ?? "")
        && textOf(x).includes("In a block"))[0].className;
      assert.match(blockStep(landedA), /In a blockA synced block holds the payment\./);
      assert.equal(stepClass(landedA), "step done");
      // The headline above the steps names the state; the steps that wait show their number.
      const headline = (ss) =>
        textOf(all(t.sessionLayer(ss), (x) => x.className === "pay-status")[0]);
      const current = (ss) => all(t.sessionLayer(ss), (x) => x.attrs?.["aria-current"] === "step")
        .map(textOf);
      assert.match(headline(landedA), /^In a blockA block that this browser synced holds/,
        "a synced block holds it: the headline says so");
      // The head of the drawer names the network, as the wallet head does. What the chain sees
      // names the public expiry, and the explorer link says what that site sees.
      const drawerHead = (ss) => all(t.sessionLayer(ss), (x) => x.className === "leaves")[0];
      assert.ok(named(drawerHead(landedA), "span", "Testnet"),
        "the drawer head names the network");
      assert.match(blockStep(landedA), new RegExp("The expiry height is public too\\. Zigs sets "
        + "it up to one day after the proposal, and a standard wallet sets it 40 blocks ahead\\. "
        + "So the expiry height can show that Zigs made this payment\\. Few wallets pay a "
        + "priority fee, so a priority fee can mark a payment too\\."));
      const sendStepOf = (ss) => all(t.sessionLayer(ss), (x) => /^step /.test(x.className ?? "")
        && textOf(x).includes("Sent to the network"))[0];
      assert.match(textOf(sendStepOf(landedA)), new RegExp("View in explorer ↗View in explorer "
        + "opens testnet\\.zecblock\\.com in a new tab\\. That site is not Zigs: it sees the "
        + "transaction id that you open and your IP address\\."),
      "the explorer note sits next to its link");
      const seesOf = (ss) => all(t.sessionLayer(ss), (x) => x.tag === "div"
        && textOf(x).startsWith("What the chain sees"))[0];
      assert.doesNotMatch(textOf(seesOf(landedA)), /View in explorer opens/,
        "What the chain sees does not repeat it");
      const testnetG = t.state.g;
      t.state.g = { ...testnetG, network: "mainnet" };
      try {
        assert.ok(named(drawerHead(landedA), "span", "Mainnet"), "a mainnet drawer reads Mainnet");
        assert.match(blockStep(landedA), /View in explorer opens zecblock\.com in a new tab/,
          "the explorer host of a mainnet wallet");
      } finally {
        t.state.g = testnetG;
      }
      answer = () => ({ state: "unknown", txid: "tx-a", why: "it may still land" });
      at(4500100);
      assert.match(blockStep(landedA), /In a blockNo synced block holds it yet\./);
      assert.equal(stepClass(landedA), "step now", "a sent mark is no block");
      assert.match(blockStep(signedA), /In a blockAfter the send\./);
      assert.equal(stepClass(signedA), "step ");
      // signedA shows a proposal that one seat rewrote after the approval here: okA does not.
      const okA = { ...signedA, pczt: "PA" };
      assert.match(headline({ ...landedA, pczt: "PA" }),
        /^Waiting for a blockA device sent it\. No /, "sent, and no block holds it yet");
      assert.match(current(landedA).join(), /In a blockNo synced block holds it yet/,
        "the step that waits is the current step");
      assert.match(headline(okA), /^Ready for the proofAny device can build the proof now\./,
        "signed: the proof is next");
      assert.deepEqual(all(t.sessionLayer(signedA), (x) => x.className === "tick").map(textOf)
        .slice(3), ["4", "5", "6"], "the steps that wait show their number");
      assert.ok(all(t.sessionLayer(signedA), (x) => x.className === "tick")
        .every((x) => x.attrs["aria-hidden"] === "true"), "a screen reader skips the marks");
      assert.match(current(signedA).join(), /^4Proof/, "signed: the proof is the step now");
      assert.match(current(signedA).join(), /Any device can build the zero-knowledge proof now\./);
      assert.deepEqual(all(t.sessionLayer(signedA), (x) => x.className === "sr-only").map(textOf)
        .slice(0, 1), ["Done: "], "and hears which steps are done");
      assert.equal(all(t.sessionLayer(signedA), (x) => x.className === "pay-status")[0].attrs.role,
        undefined, "the headline is no live region: the page draws it anew each time");
      at(4503460);
      assert.match(blockStep(landedA), /In a blockNo synced block holds it\./,
        "past its expiry it waits for no block");
      assert.match(headline(landedA), /^Check the payment/, "only the engine can say expired");
      assert.deepEqual(current(landedA), [], "a checked payment has no step that waits");
      // Under "It may still go on chain" a waiting step says only what this page saw.
      const proofOf = (ss) => textOf(all(t.sessionLayer(ss), (x) => /^step /.test(x.className ?? "")
        && textOf(x).includes("Proof"))[0]);
      assert.ok(proofOf(signedA).endsWith("Not seen on this page."),
        "a page that cannot tell says only what it saw");
      // Step 6 there too, but a finished transaction past its expiry + 3 is in no synced block.
      const blockOf = (ss) => textOf(all(t.sessionLayer(ss), (x) => /^step /.test(x.className ?? "")
        && textOf(x).includes("In a block"))[0]);
      assert.ok(blockOf(signedA).endsWith("Not seen on this page."),
        "under It may still go on chain, step 6 says only what this page saw");
      assert.ok(blockOf({ ...okA, final: { txid: "tx-a", tx_hex: "00" } }).endsWith("Not done."),
        "a finished transaction past its expiry + 3 is in no block");
      t.setChain({ ...t.chain, cw: null });
      assert.match(blockStep(landedA), /In a blockThis page has not synced the blocks since you /,
        "before a sync the page does not say that no block holds it");
      {
        // ── Each fact of the headline, in the drawer: the detail says which fact holds, and a
        // payment that cannot go on has no step that waits. Fresh session ids, no hold.
        const kept13 = { sessions: t.state.sessions, commits: t.state.commits,
          shares: t.state.shares };
        Object.assign(t.state, { commits: {}, shares: {} });
        const look = (ss) => {
          const layer = t.sessionLayer(ss);
          const now = all(layer, (x) => x.attrs?.["aria-current"] === "step").map(textOf);
          assert.ok(now.length <= 1, "at most one step waits now");
          const step = (title) => all(layer, (x) => /^step /.test(x.className ?? "")
            && textOf(x).includes(title))[0];
          return { head: textOf(all(layer, (x) => x.className === "pay-status")[0]), now, step,
            text: textOf(layer), buttons: all(layer, (x) => x.tag === "button").map(textOf),
            foot: all(layer, (x) => x.className === "drawer-foot").length,
            chip: textOf(all(all(layer, (x) => x.className === "drawer-head")[0],
              (x) => /^badge/.test(x.className ?? ""))[0]) };
        };
        const nonces = (seat, patch) => t.putSec(t.state.gid, seat,
          { nonces: { ...t.sec(t.state.gid, seat).nonces, ...patch } });
        const unknownA = () => ({ state: "unknown", txid: "tx-a", why: "it may still land" });
        const lateSent = () => ({ ...okA, status: "broadcast", broadcastTxid: "tx-a",
          final: { txid: "tx-a", tx_hex: "00" }, broadcastAt: 1 });
        // An expired proposal: no step waits, and the steps keep their numbers.
        answer = (p, sg, a) => a === "aa" && p === "PA"
          ? { state: "expired", txid: "tx-a", why: "x" }
          : { state: "unknown", txid: null, why: "no" };
        at(4503500);
        const oldOne = look(open("hd1", "PA"));
        assert.match(oldOne.head, /^Payment expiredNo device can send it now\./,
          "headline: an expired proposal ends");
        assert.deepEqual(oldOne.now, [], "an expired payment has no step that waits");
        // A payment that cannot go on says nothing about now in its waiting steps.
        for (const [step, why] of [["Combined signature", "signature"], ["Proof", "proof"],
          ["Sent to the network", "send"], ["In a block", "block"]]) {
          assert.ok(textOf(oldOne.step(step)).endsWith("Not done."), "not done: the " + why);
        }
        assert.deepEqual([oldOne.step("Approvals").className,
          textOf(all(oldOne.step("Approvals"), (x) => x.className === "tick")[0])], ["step ", "2"]);
        const endedA = look(okA);
        assert.ok(endedA.head.startsWith("Payment expiredThe transaction this browser approved "
          + "expired. This page cannot tell whether a device sent another one."),
        "headline: the engine says that it expired");
        assert.deepEqual(endedA.now, [], "an ended payment has no step that waits");
        assert.deepEqual([textOf(endedA.step("Proof")).endsWith("Not seen on this page."),
          textOf(endedA.step("In a block")).endsWith("Not done.")], [true, true],
        "the engine says that the approved transaction expired: no block");
        // Stopped: before any signing and after a sync, no device can send it. Else the page
        // cannot tell.
        answer = unknownA;
        at(4500100);
        const stop = look({ ...open("hd2", "PA"), status: "cancelled", error: "Cancelled." });
        assert.match(stop.head, /^Payment stoppedNo device can approve, sign or send it\./,
          "headline: an error before any signing, after a sync");
        assert.deepEqual(stop.now, [], "a stopped payment has no step that waits");
        assert.ok(stop.step("Combined signature").className === "step bad"
          && textOf(stop.step("Combined signature")).startsWith("!"), "the stop mark stays");
        assert.ok(textOf(stop.step("Combined signature")).endsWith("Cancelled."),
          "the stop reason sits in the steps");
        assert.ok(textOf(stop.step("Proof")).endsWith("Not done."),
          "a stop after a sync here: not done");
        assert.equal(textOf(t.statusChip({ ...open("hd2", "PA"), status: "cancelled",
          error: "Cancelled." })), "Cancelled", "a synced stop keeps the chip of its status");
        const unsure = /^Check the paymentThis page cannot tell whether a device sent it\. Check /;
        const failedSigned = { ...okA, id: "hd3", status: "failed", error: "Failed." };
        assert.match(look(failedSigned).head, unsure,
          "headline: an error after the signing started");
        assert.deepEqual(look(failedSigned).now, [],
          "a stopped payment with a signed part has no step that waits");
        assert.ok(textOf(look(failedSigned).step("Proof")).endsWith("Not seen on this page."),
          "an error after signing: not seen on this page");
        assert.deepEqual([look(failedSigned).chip, textOf(t.statusChip(failedSigned))],
          ["Check", "Check"], "the chip asks for a check when the headline does");
        // An approval here, then a cancel before the package: the hold of the approval ended
        // (this mark has no height), and still the page cannot tell.
        await t.putSec(t.state.gid, me, { marks: { ...t.sec(t.state.gid, me).marks,
          hda: { approved: "aa" } } });
        assert.match(look({ ...open("hda", "PA"), status: "cancelled", error: "Cancelled." }).head,
          unsure, "headline: a cancel after an approval here, with no hold");
        const { hda: _hda, ...marksNoHda } = t.sec(t.state.gid, me).marks;
        await t.putSec(t.state.gid, me, { marks: marksNoHda });
        // A sent payment with a later error part: the done steps stay done.
        const errSent = look({ ...lateSent(), id: "hde", error: "Failed." });
        assert.deepEqual(["Combined signature", "Sent to the network"]
          .map((x) => errSent.step(x).className), ["step done", "step done"],
        "a later error part keeps the done steps");
        assert.match(errSent.head, /^Check the paymentA device sent it, and the payment shows a /,
          "headline: an error part after a sent mark");
        assert.equal(textOf(t.statusChip({ ...lateSent(), id: "hde", error: "Failed." })), "Check",
          "an error part next to a sent mark reads Check");
        // A state restored from storage is no sync of this page.
        at(4500100, new Set(), 0);
        assert.match(look({ ...open("hd2", "PA"), status: "cancelled", error: "Cancelled." }).head,
          unsure, "headline: a restored state is no sync of this page");
        assert.equal(textOf(t.statusChip({ ...open("hd2", "PA"), status: "cancelled",
          error: "Cancelled." })), "Check", "a stop before a sync of this page reads Check");
        assert.match(look(lateSent()).head, /^Waiting for a blockA device sent it\. This page has /,
          "headline: a restored state is no sync since the send");
        assert.ok(textOf(look(lateSent()).step("In a block")).endsWith("This page has not synced "
          + "the blocks since you opened this wallet."),
        "a restored state: the block step says that this page has not synced");
        t.setChain({ ...t.chain, cw: null });
        assert.match(look({ ...open("hd2", "PA"), error: "Cancelled." }).head, unsure,
          "headline: an error before a sync");
        assert.match(look(lateSent()).head,
          /^Waiting for a blockA device sent it\. This page has not synced the blocks since you /,
          "headline: no sync since the send");
        at(4500100);
        // The reasons of this browser: it refuses the transaction or the send.
        assert.match(look(open("hd4", "PX")).head, /^Payment needs attentionThis browser refuses /,
          "headline: a transaction that this browser cannot decode");
        const doneA = { ...okA, final: { txid: "tx-a", tx_hex: "00" } };
        const refusedB = look({ ...doneA, final: { txid: "tx-b", tx_hex: "00" } });
        assert.match(refusedB.head,
          /^Payment needs attentionThis browser does not send this transaction\./,
          "headline: a finished transaction with another id");
        assert.deepEqual([refusedB.now, refusedB.step("Sent to the network").className], [[],
          "step bad"], "a refused send is no step that waits");
        assert.match(textOf(refusedB.step("Sent to the network")), /another id than the approved/);
        // The local reasons that WAITING must not hide.
        const seenOne = { ...open("hd7", "PA"), package: "PK", status: "signing" };
        put(seenOne);
        t.noteSessions();
        const resetOne = look(open("hd7", "PA"));
        assert.match(resetOne.head, /^Check the paymentThis browser saw the signing start, and /,
          "headline: one device reset the signing seen here");
        assert.equal(resetOne.chip, "Check", "the chip of a lost signing asks for a check");
        assert.deepEqual(resetOne.now, [], "a reset keeps no approvals step that waits");
        assert.match(resetOne.text, /a device or the server reset it/);
        assert.match(resetOne.text, /saw the signing of this payment start, but the payment does /,
          "the note that the headline points to");
        assert.match(resetOne.text, /may have signed it before the reset\.(?!.*may still send)/s);
        t.state.commits = { [me]: {} };
        const lostOne = look(open("hd6", "PA"));
        assert.match(lostOne.head, /^Payment needs attentionA device of this browser lost its /,
          "headline: this browser lost its approval");
        // Two other devices here can still approve: the note names the device that lost it. With
        // fewer than t approvals, the page cannot tell which devices sign.
        assert.ok(lostOne.text.includes("This browser lost the approval of device " + me + " for "
          + "this payment: the browser data that held it was deleted. If the signing package "
          + "names that device, the payment cannot finish. Then cancel it, and propose it again."),
        "the note names the device that lost its approval");
        assert.deepEqual(lostOne.buttons.filter((b) => b.startsWith("Approve")),
          ["Approve as device " + other, "Approve as device " + third]);
        assert.deepEqual(lostOne.now, [], "a lost approval keeps no approvals step that waits");
        // t approvals: the package takes the first t by device number.
        await nonces(other, { hd6: ["n"], hd6b: ["n"] });
        await nonces(me, { hd6b: ["n"] });
        t.state.commits = { [me]: {}, [other]: {} };
        assert.ok(look(open("hd6", "PA")).text.includes("This browser lost the approval of device "
          + me + " for this payment: the browser data that held it was deleted. The payment cannot "
          + "finish with it. Cancel the payment, then propose it again."),
        "a lost device among the first t approvals stops the payment");
        t.state.commits = { [me]: {}, [other]: {}, [third]: {} };
        const beyond = look(open("hd6b", "PA"));
        assert.deepEqual([beyond.head.startsWith("Payment needs attention"),
          beyond.text.includes("lost the approval")], [false, false],
        "a device outside the first t approvals lost nothing");
        await nonces(other, { hd6: undefined, hd6b: undefined });
        await nonces(me, { hd6b: undefined });
        t.state.commits = {};
        const changed = look(signedA);
        assert.match(changed.head, /^Payment needs attentionOne device changed the proposal after /,
          "headline: one device rewrote the proposal after the approval here");
        assert.match(changed.text, /proposal changed after this browser approved it/);
        // A move pays the address that the store names, not the one that this browser checked.
        t.secrets["MVX:1"] = { checkedWallet: JSON.stringify({ address: "utest1other" }) };
        const moveOff = look({ ...open("hd8", "PA"), move: "MVX" });
        assert.match(moveOff.head, /^Payment needs attentionThe transaction does not move all the /,
          "headline: a move that does not pay the checked address");
        assert.match(moveOff.text, /This is not the address of the new wallet\. Do not approve/);
        assert.equal(moveOff.buttons.some((b) => b.startsWith("Approve")), false);
        assert.deepEqual(moveOff.now, [], "a wrong move keeps no approvals step that waits");
        const moveList = look({ ...open("hd9", "PA"), move: "MVX",
          payees: [{ to: "utest1other", amount: 5 }] });
        assert.match(moveList.head, /^Payment needs attentionThe transaction does not pay what /,
          "a move that does not pay its list is a mismatch");
        assert.deepEqual(moveList.now, [], "a mismatch keeps no approvals step that waits");
        t.secrets["MVX:1"] = { checkedWallet: JSON.stringify({ address: "utest1x" }) };
        assert.deepEqual([t.solOn(), t.solNotAdded(),
          look({ ...open("hd8", "PA"), move: "MVX" }).text.includes("Solana part")],
        [true, true, false], "a move of a wallet that never added Solana names no Solana part");
        t.resetSolStart();   // the start documents are not read: the sentence shows
        const moveOk = look({ ...open("hd8", "PA"), move: "MVX" });
        assert.match(moveOk.head, /^Your approval is needed/,
          "a move to the checked address asks for an approval");
        // The move takes the confirmed Zcash funds only. The Solana sentence shows only for a
        // wallet that can have a Solana part (solOn).
        const solMove = " If this wallet has a Solana part, it does not move this way: check it "
          + "in its Solana section.";
        const checkedMove = "This moves the confirmed Zcash funds to the new wallet, the wallet "
          + "that replaces this one. Your browser checked its address.";
        const blindMove = "This moves the confirmed Zcash funds to a new wallet that replaces this "
          + "one. Your browser has no checked copy of its address, so it cannot check it.";
        const moveIn = (text) => look({ ...open("hd8", "PA"), move: "MVX" }).text.includes(text);
        const g13 = t.state.g;
        assert.deepEqual([t.solOn(), moveOk.text.includes(checkedMove + solMove)], [true, true],
          "a move names the confirmed Zcash funds and the Solana part");
        t.state.g = { ...g13, version: 2 };
        assert.deepEqual([t.solOn(), moveIn(checkedMove), moveIn("Solana part")],
          [false, true, false], "a wallet without a Solana part reads no Solana sentence");
        t.state.g = g13;
        delete t.secrets["MVX:1"];
        assert.ok(moveIn(blindMove + solMove), "and so does a move with no checked copy");
        t.state.g = { ...g13, version: 2 };
        assert.deepEqual([moveIn(blindMove), moveIn("Solana part")], [true, false]);
        t.state.g = g13;
        const memoOne = look({ ...open("hdm", "PA"), payees: [{ to: "utest1x", amount: 5,
          memo: "rent" }] });
        assert.ok(memoOne.text.includes("A memo goes on chain with the payment. Its recipient, "
          + "every device of this wallet and anyone else who has the invite link can read it. A "
          + "device that Change devices leaves out later can still read it."),
        "the readers of a memo");
        // Before the send, the drawer says what the chain will show, also the expiry height.
        // After the send, the chain summary says it, once.
        const expiryNotes = (text) => text.split("The expiry height is public too.").length - 1;
        assert.deepEqual([expiryNotes(memoOne.text), expiryNotes(look(lateSent()).text)], [1, 1],
        "the drawer says before the send that the expiry height is public, and once after it");
        // The steps after the approvals.
        const lateA = lateSent();
        put(lateA);
        assert.match(look(lateA).head, /^Send it againNo block that this browser synced holds it/,
          "headline: a sent payment that no block holds after 10 minutes");
        assert.match(look(lateA).head, /after 10 minutes\. Any device can send/);
        at(4503453);
        const late = look(doneA);
        assert.match(late.head, /^Too late to sendIt can no longer go to the network\./,
          "headline: a node refuses it now");
        assert.equal(textOf(t.statusChip({ ...doneA, status: "complete" })), "Too late",
          "a payment too late to send reads Too late, not Ready to send");
        assert.deepEqual(late.now, [], "a payment too late to send has no step that waits");
        assert.ok(textOf(late.step("In a block")).endsWith("Not done."),
          "too late to send: not done in a block");
        at(4503453, new Set(), 0);
        assert.ok(textOf(look(doneA).step("In a block")).endsWith("This page has not synced the "
          + "blocks since you opened this wallet."),
        "too late with a restored state: step 6 says that this page has not synced");
        at(4503453);
        assert.match(textOf(late.step("Sent to the network")), /can no longer go to the network/);
        // A sent mark with a false id waits for its block, under the false id note.
        at(4500100);
        const falseSent = look({ ...lateSent(), broadcastAt: Date.now(), broadcastTxid: "tx-b",
          final: { txid: "tx-b", tx_hex: "00" } });
        assert.deepEqual([falseSent.head.startsWith("Waiting for a blockA device sent it."),
          falseSent.text.includes("names the id tx-b")], [true, true],
        "a sent mark with a false id waits for its block, under the false id note");
        assert.ok(falseSent.text.includes("RecipientsAmountsDevicesApproval rule"),
          "the chain sees no device");
        at(4503453);
        // A sent payment in the same window may still land: it is not too late.
        const sentNear = look(lateSent());
        assert.deepEqual([textOf(t.statusChip(lateSent())) === "Too late",
          sentNear.now.join().includes("In a block")], [false, true],
        "a sent payment near its expiry is not too late");
        at(4500100);
        assert.match(look({ ...doneA, broadcastError: "timeout" }).head,
          /^The send failedRead the error below\. A device can send it again\./,
          "headline: the send failed");
        const proved = look(doneA);
        assert.match(proved.head, /^Ready to sendSending is a separate step\. This browser sends /,
          "headline: this browser can send it");
        assert.match(proved.head, /only when the finished transaction names the approved id\./);
        assert.match(proved.now.join(), /Any device can send the finished transaction\./);
        const seats13 = t.secrets;
        t.secrets = {};
        assert.match(look(doneA).head, /^Ready to sendThe proof is built\. A device of this wallet/,
          "headline: the proof is built, and this browser has no seat");
        // One seat can write any status: the refusal does not read it.
        const falseId = { ...doneA, status: "signed", final: { txid: "tx-b", tx_hex: "00" } };
        assert.deepEqual([look(falseId).head.startsWith("Payment needs attentionThis browser does "
          + "not send"), textOf(t.statusChip(falseId))], [true, "Check"],
        "a browser without a seat refuses a false id, whatever the status");
        t.secrets = seats13;
        // A block holds it, with parts missing: no step waits, and no step is offered.
        answer = () => ({ state: "done", txid: "tx-a", why: "a synced block holds it" });
        at(4500100, new Set(["tx-a"]));
        const landedNoMark = look(doneA);
        assert.deepEqual([landedNoMark.now, landedNoMark.step("Sent to the network").className],
          [[], "step done"], "a landed payment without a sent mark has no step that waits");
        assert.match(textOf(landedNoMark.step("Sent to the network")), /A synced block holds/);
        assert.equal(landedNoMark.foot, 0, "a landed payment offers no step");
        const landedSigned = look(okA);
        assert.equal(landedSigned.step("Proof").className, "step done",
          "a block marks the proof done");
        assert.deepEqual([landedSigned.now, landedSigned.buttons.includes("Build proof")],
          [[], false], "a landed payment offers no Build proof");
        const landedPackage = look({ ...okA, signed: "" });
        assert.equal(landedPackage.step("Approvals").className, "step done",
          "a block marks the approvals done");
        assert.equal(landedPackage.step("Combined signature").className, "step done",
          "a block marks the signature done");
        assert.deepEqual([landedPackage.now, landedPackage.buttons.includes("Cancel payment")],
          [[], false], "a landed payment offers no Cancel");
        assert.match(textOf(landedPackage.step("Combined signature")), /A synced block holds/);
        assert.deepEqual(look(open("hdl", "PA")).now, [],
          "a proposal whose transaction a block holds has no step that waits");
        answer = unknownA;
        at(4500100);
        const proving = look({ ...okA, status: "proving", provingAt: Date.now() });
        assert.match(proving.head, /^Building the proofA device builds the proof\./,
          "headline: a device builds the proof");
        assert.match(proving.now.join(), /A device is building the proof/);
        const signing = look({ ...okA, signed: "" });
        assert.match(signing.head, /^SigningEach device that the signing package names signs/,
          "headline: the devices sign");
        assert.equal(signing.step("Approvals").className, "step ",
          "a package alone does not mark the approvals done");
        assert.match(signing.now.join(), /^3Combined signature/,
          "a package without loaded approvals waits for its signature");
        // Enough approvals: no device here approves any more, and the lists that count the
        // approvals (the open payment, the watched ones) agree.
        await nonces(me, { hd5: ["n"] });
        await nonces(other, { hd5: ["n"] });
        t.state.commits = { [me]: {}, [other]: {} };
        const full = look(open("hd5", "PA"));
        assert.match(full.head, /^Approvals are completeEnough devices approved\. Another /,
          "headline: t approvals are in");
        assert.deepEqual(full.buttons.filter((b) => b.startsWith("Approve")), [],
          "no Approve button after t approvals");
        assert.equal(full.step("Approvals").className, "step done");
        assert.deepEqual([full.chip, textOf(t.statusChip(open("hd5", "PA")))],
          ["Approved", "Approvals open"], "the drawer chip says Approved after t approvals");
        assert.equal(look({ ...okA, id: "hdk", signed: "" }).chip, "Signing",
          "the Approved chip is only for a payment that collects approvals");
        put(open("hd5", "PA", Date.now()));   // the newest row shows in the overview
        t.state.sid = "hd5";
        const row5 = () => textOf(all(t.walletView(null, null),
          (x) => x.attrs?.["data-key"] === "pay-hd5")[0]);
        assert.deepEqual([t.needsMyApproval(t.state.gid, open("hd5", "PA")),
          t.toApprove(t.state.gid).some((x) => x.id === "hd5")], [false, false],
        "the inbox follows the drawer after t approvals");
        assert.match(row5(), /Approved/, "the Activity row says Approved after t approvals");
        t.state.commits = { [me]: {} };
        assert.match(row5(), /Your approval/, "below t a device here can approve");
        t.state.sid = null;
        // A closed drawer: the inbox counts the approvals of a watched payment, from the parts
        // that pass their check.
        const hdw = open("hdw", "PA", Date.now());
        await approved(me, hdw);
        await approved(other, hdw);
        t.state.commits = {};
        const part = (seat) => data.get(`groups/${t.state.gid}/sessions/hdw/commits/${seat}`);
        const watchW = (commits) => t.watched.set("hdw",
          { gid: t.state.gid, raw: { commits, shares: {} }, unsubs: [] });
        assert.equal(t.needsMyApproval(t.state.gid, hdw), true,
          "a payment that this page does not watch keeps the old rule");
        // The checks of the parts run in the background and draw when they end, and a redraw may
        // change the watch: the test starts the checks, waits for their draw under the stub
        // page, and watches again.
        const checked = async (commits) => {
          watchW(commits);
          t.needsMyApproval(t.state.gid, hdw);
          await quiet(() => sleep(500));
          watchW(commits);
        };
        await checked({ [me]: part(me), [other]: part(other) });
        assert.deepEqual([t.needsMyApproval(t.state.gid, hdw),
          t.toApprove(t.state.gid).some((x) => x.id === "hdw")], [false, false],
        "the inbox counts the approvals of a watched payment");
        await checked({ [me]: part(me), [third]: { ...part(other), by: third } });
        assert.equal(t.needsMyApproval(t.state.gid, hdw), true,
          "a part that fails its check does not count");
        t.watched.delete("hdw");
        for (const seat of [me, other]) {
          const { hdw: _hdw, ...marksW } = t.sec(t.state.gid, seat).marks;
          await t.putSec(t.state.gid, seat, { marks: marksW });
        }
        t.state.commits = { [me]: {} };
        assert.match(look(open("hd5", "PA")).head, /^Your approval is needed/);
        await nonces(me, { hd5: undefined });
        await nonces(other, { hd5: undefined });
        Object.assign(t.state, kept13);
      }
      answer = () => ({ state: "done", txid: "tx-a", why: "a synced block holds it" });
      at(4500100, new Set(["tx-a"]));

      // A browser that did not approve keeps no tie and shows what t seats signed. A sent payment
      // frees its notes by height, and one whose signed transaction a block holds is "Sent" and
      // holds no notes.
      const loose = { id: "zl", pczt: "PD", status: "broadcast", signed: "SL",
        broadcastTxid: "tx-d", final: { txid: "tx-d", tx_hex: "00" }, broadcastAt: 1,
        createdAt: 30 };
      put(loose);
      t.noteSessions();
      assert.equal(markOf(me, "zl"), undefined, "no tie");
      answer = () => ({ state: "unknown", txid: "tx-old", why: "t seats signed it" });
      at(4503459);
      assert.equal(t.verdict(loose).bound, false);
      assert.equal(asked.at(-1)[2], "", "no approved sighash");
      assert.deepEqual([t.expired(loose), t.inFlight().includes(loose)], [true, false]);
      assert.equal(textOf(t.statusChip(loose)), "Check");
      at(4500100, new Set(["tx-old"]));
      assert.equal(textOf(t.statusChip(loose)), "Sent", "what t seats signed landed");
      assert.equal(t.inFlight().includes(loose), false);

      // A move that started signing goes again only when the engine says that it expired.
      t.state.g = { ...group, movedTo: "MV1" };
      t.ready.MV1 = { address: "utest1m" };
      const mv = { ...signedA, id: "zm", move: "MV1" };
      put(mv);
      await t.putSec(t.state.gid, me, { marks: { ...t.sec(t.state.gid, me).marks,
        zm: { approved: "aa" } } });
      answer = () => ({ state: "unknown", txid: "tx-a", why: "it may still land" });
      assert.equal(t.moveState(at(4503500)).session, mv, "no second move while it may land");
      answer = (p, sg, a) =>
        ({ state: a === "aa" ? "expired" : "unknown", txid: "tx-a", why: "x" });
      assert.equal(t.moveState(at(4503501)).propose, true, "the expired move goes again");
      // The Move button of the card proposes the move, and the click event is no PCZT. Nothing
      // may block Send then (S8): no payment in flight or open, and no approval that holds.
      t.state.sessions = t.state.sessions.filter((x) => x.id !== "zm");
      const sessionsBefore = t.state.sessions;
      const marksBefore = t.localSeats().map((i) => [i, t.sec(t.state.gid, i).marks]);
      t.state.sessions = [];
      for (const [i] of marksBefore) await t.putSec(t.state.gid, i, { marks: {} });
      const mc = at(4500000);
      mc.bal.max_send = 50000;
      Object.assign(t.ui, { tab: "overview" });
      const moveBtn = all(t.walletView(null, null),
        (x) => x.tag === "button" && textOf(x).startsWith("Move "))[0];
      asked.length = 0;
      const click = { type: "click", preventDefault() {}, currentTarget: null };
      await quiet(() => moveBtn.on.click(click));
      const moveCall = asked.find((x) => x[0] === "spend");
      assert.ok(moveCall, "the move is proposed");
      assert.equal(moveCall[3], undefined, "no PCZT of an expired payment");
      t.state.sessions = sessionsBefore;
      for (const [i, marks] of marksBefore) await t.putSec(t.state.gid, i, { marks });
      t.state.g = group;
      await settle();

      // A payment that this browser approved and saw sent holds its notes whatever one seat
      // writes or removes later: an error part, a reset without the sent mark.
      const sentA = { ...signedA, status: "broadcast", broadcastTxid: "tx-a",
        final: { txid: "tx-a", tx_hex: "00" }, broadcastAt: Date.now() };
      put(sentA);
      t.noteSessions();
      answer = () => ({ state: "unknown", txid: "tx-a", why: "it may still land" });
      at(4500100);
      assert.equal(t.inFlight().includes(sentA), true);
      // Another transaction spent a note of it 3 blocks deep: neither the approval nor the sent
      // document holds its notes then.
      answer = () => ({ state: "unknown", txid: "tx-a", why: "spent", spent: true });
      at(4500100);
      assert.equal(t.inFlight().includes(sentA), false, "a spend of one of its notes frees it");
      const notMine = { ...open("h13", "PA"), package: "PK", signed: "SA", status: "broadcast",
        broadcastTxid: "tx-a", final: { txid: "tx-a", tx_hex: "00" }, broadcastAt: Date.now() };
      put(notMine);
      at(4500100);
      assert.equal(t.inFlight().includes(notMine), true, "no approval here: `spent` frees nothing");
      t.state.sessions = t.state.sessions.filter((x) => x.id !== "h13");
      answer = () => ({ state: "unknown", txid: "tx-a", why: "it may still land" });
      at(4500100);
      const failedA = { ...sentA, error: "Failed.", status: "failed" };
      put(failedA);
      at(4500101);
      assert.equal(t.inFlight().includes(failedA), true, "an error part frees nothing");
      assert.equal(textOf(t.statusChip(failedA)), "Confirming",
        "an error part that an approval here holds reads Confirming");
      assert.match(headOf(failedA), /^Stopped, but it may still go on chain/,
        "an approval here holds Send, so the stop is not the end");
      const resetA = open("za", "PB");
      put(resetA);
      at(4500102);
      assert.equal(t.inFlight().includes(resetA), true, "a dropped sent mark frees nothing");
      assert.match(String(t.sendBlocker()), /waiting for its block/);
      at(4503459);
      assert.equal(t.inFlight().includes(resetA), false, "free after the approved expiry + 3");

      // A browser that approved but lost the PCZT gets no approval prompt, no Approve button and no
      // Cancel after a reset.
      const zal = open("zal", "PC");
      put(zal);
      await t.putSec(t.state.gid, me, { marks: { ...t.sec(t.state.gid, me).marks,
        zal: { approved: "aa", tip: 4500001 } } });
      at(4500100);
      const match = { rows: [{ to: "utest1x", ok: true }], extra: [], match: true };
      assert.equal(t.needsMyApproval(t.state.gid, zal), false);
      assert.deepEqual(t.nextAction(zal, decodes.PC, match), [], "no Approve button");
      assert.deepEqual(t.cancelAction(zal), [], "no Cancel");
      const honest = open("zho", "PC");
      put(honest);
      assert.deepEqual(labels(t.cancelAction(honest)), ["Cancel payment"],
        "an open payment keeps its Cancel");

      // A browser without an approval holds a sent payment up to the latest expiry that an
      // approval allows: 1 + 6912 blocks after the height.
      const capOk = { ...going, id: "zc1", pczt: "PH" };
      const capOver = { ...going, id: "zc2", pczt: "PI" };
      decodes.PH = { ...tx("hh", "tx-h"), expiry_height: 4500100 + 1 + 6912 };
      decodes.PI = { ...tx("ii", "tx-i"), expiry_height: 4500100 + 2 + 6912 };
      put(capOk, capOver);
      at(4500100);
      assert.deepEqual([t.inFlight().includes(capOk), t.inFlight().includes(capOver)],
        [true, false]);

      // A snapshot that cannot be read leaves the expired callout without its list.
      answer = (p, sg, a) => (a === "aa" && p === "PA"
        ? { state: "expired", txid: "tx-a", why: "x" }
        : { state: "unknown", txid: null, why: "no" });
      put(signedA);
      const snap = engine.snapshot;
      engine.snapshot = () => { throw new Error("no snapshot"); };
      at(4503600);
      assert.match(textOf(t.expiryLine(signedA)), /none of its notes is spent/);
      engine.snapshot = snap;

      // The drawer of a browser that approved gives the expiry of the approved transaction, not
      // that of a proposal that one seat rewrote.
      answer = () => ({ state: "unknown", txid: "tx-a", why: "it may still land" });
      put({ ...signedA, pczt: "PE" });
      at(4500000);
      assert.match(textOf(t.expiryLine({ ...signedA, pczt: "PE" })), /block 4,503,456/);

      // A stored `false` does not undo a mark.
      localStorage.setItem("zf-signing", JSON.stringify({ [t.state.gid + ":za"]: false }));
      await quiet(() => sleep(300));
      assert.equal(t.sawSigning(t.state.gid, "za"), true);
      // ── The hold of an approval (the owner's choice of 18 October 2026): the approval alone
      // holds Send until the approved transaction can no longer land, from the records of this
      // browser only. ──
      answer = () => ({ state: "unknown", txid: "tx-a", why: "it may still land", spent: false });
      at(4500000);
      const h1 = open("h1", "PA");
      await approved(me, h1);
      at(4500100);
      assert.ok(t.heldApprovals().includes("h1"), "the approval holds");
      assert.match(String(t.sendBlocker()),
        /approved can still go on chain|waiting for its block|Finish or cancel the open payment/);
      // Path A of QA round 4: no sent mark ever comes, and one seat writes a failure part.
      const inboxOf = (id) => Object.entries(t.inboxRows())
        .find(([k, list]) => k !== "lost" && list.some((x) => x.id === id))?.[0] ?? null;
      // Every approval that holds Send is in a bucket of the inbox or in its lost note.
      const heldListed = () => {
        const list = { sessionsLoaded: t.state.sessionsLoaded,
          sessionsFailed: t.state.sessionsFailed, pending: t.state.pending };
        Object.assign(t.state, { sessionsLoaded: true, sessionsFailed: false, pending: false });
        try {
          const rows = t.inboxRows(), shown = new Set(rows.lost);
          for (const [k, list] of Object.entries(rows)) {
            if (k !== "lost") list.forEach((x) => shown.add(x.id));
          }
          for (const id of t.heldApprovals()) assert.ok(shown.has(id), "the inbox holds " + id);
        } finally {
          Object.assign(t.state, list);
        }
      };
      put(h1);
      assert.equal(inboxOf("h1"), "review", "the inbox: two other seats here can approve it");
      heldListed();
      put({ ...h1, package: "PK", signed: "SA", status: "failed", error: "Failed." });
      at(4500101);
      assert.ok(t.heldApprovals().includes("h1"), "an error part ends no hold");
      assert.equal(inboxOf("h1"), "attention",
        "the inbox: a failed payment that an approval here still holds (S7)");
      heldListed();
      // Path B: the document leaves the list (a rewrite that fails its check drops it).
      t.state.sessions = t.state.sessions.filter((x) => x.id !== "h1");
      at(4500102);
      const askedFrom = asked.length;
      assert.ok(t.heldApprovals().includes("h1"), "a dropped document ends no hold");
      const listState = { sessionsLoaded: true, sessionsFailed: false, pending: false };
      const keptList = Object.fromEntries(Object.keys(listState).map((k) => [k, t.state[k]]));
      Object.assign(t.state, listState);
      for (const unknown of [{ sessionsLoaded: false }, { sessionsFailed: true },
        { pending: true }]) {
        Object.assign(t.state, unknown);
        assert.deepEqual(t.inboxRows().lost, [], "no lost record while the list is unknown");
        Object.assign(t.state, listState);
      }
      assert.ok(t.inboxRows().lost.includes("h1"), "the inbox names a hold with no record");
      const tab = t.ui.tab;
      t.ui.tab = "approvals";
      const page = t.groupView();
      t.ui.tab = tab;
      const attention = all(page, (x) => x.attrs?.["aria-label"] === "Needs attention")[0];
      assert.ok(attention, "the lost note shows in Needs attention");
      const badge = all(attention, (x) => x.className === "badge plain")[0];
      const rows = t.inboxRows();
      assert.ok(rows.lost.length > 0);
      assert.equal(textOf(badge), String(rows.attention.length + rows.lost.length),
        "the count holds the lost records");
      heldListed();
      assert.match(textOf(attention), /approved ha(s|ve) no record here any more/);
      Object.assign(t.state, keptList);
      assert.ok(asked.slice(askedFrom).some((x) => S(x) === S(["PA", "", "aa"])),
        "the engine gets the kept PCZT and the approved sighash alone");
      // The hold ends when a block holds the approved transaction, when it expired, when another
      // transaction spent a note of it, and 3 blocks past the expiry of the kept PCZT.
      answer = () => ({ state: "done", txid: "tx-a", why: "in a block", spent: false });
      at(4500103);
      assert.equal(t.heldApprovals().includes("h1"), false, "a block holds it");
      answer = () => ({ state: "expired", txid: "tx-a", why: "x", spent: false });
      at(4500104);
      assert.equal(t.heldApprovals().includes("h1"), false, "the engine says that it expired");
      answer = () => ({ state: "unknown", txid: "tx-a", why: "spent", spent: true });
      at(4500105);
      assert.equal(t.heldApprovals().includes("h1"), false, "a move or another payment spent it");
      answer = () => ({ state: "unknown", txid: "tx-a", why: "it may still land", spent: false });
      at(4503458);
      assert.ok(t.heldApprovals().includes("h1"), "held up to the expiry + 2");
      at(4503459);
      assert.equal(t.heldApprovals().includes("h1"), false, "free at the expiry + 3");
      // A failed payment that no approval here holds any more leaves the inbox: past its hold,
      // after another payment spent its notes, and past the ceiling of the approval, where it is
      // in the Check state.
      const failedH1 = { ...h1, package: "PK", signed: "SA", status: "failed", error: "Failed." };
      put(failedH1);
      at(4503460);
      assert.equal(inboxOf("h1"), null, "past its hold");
      answer = () => ({ state: "unknown", txid: "tx-a", why: "spent", spent: true });
      at(4503461);
      assert.equal(inboxOf("h1"), null, "another payment spent its notes");
      answer = () => ({ state: "unknown", txid: "tx-a", why: "it may still land", spent: false });
      at(4506917);
      assert.equal(t.expired(failedH1), true, "the Check state: past the ceiling");
      assert.equal(inboxOf("h1"), null, "past the ceiling");
      t.state.sessions = t.state.sessions.filter((x) => x.id !== "h1");
      // Without the kept PCZT the ceiling ends it: 4,500,001 + 1 + 6,912 + 3.
      await t.putSec(t.state.gid, me, { marks: { ...t.sec(t.state.gid, me).marks,
        h2: { approved: "zz", tip: 4500001 }, h3: { approved: "zz" } } });
      at(4506916);
      assert.ok(t.heldApprovals().includes("h2"), "no PCZT: held up to the ceiling");
      assert.equal(t.heldApprovals().includes("h3"), false, "no height, no hold");
      // An approval of the listed proposal whose PCZT this browser did not keep: the engine says
      // that the proposal expired, so the payment ended, but with the approved sighash alone it
      // cannot say so, and the approval holds Send up to the ceiling. The inbox lists it under
      // attention, never as finished.
      await t.putSec(t.state.gid, me, { marks: { ...t.sec(t.state.gid, me).marks,
        hk1: { approved: "aa", tip: 4500001 } } });
      put(open("hk1", "PA"));
      answer = (p) => (p === "" ? { state: "unknown", txid: "tx-a", why: "no expiry", spent: false }
        : { state: "expired", txid: "tx-a", why: "it expired", spent: false });
      at(4503460);
      assert.equal(t.ended(open("hk1", "PA")), true, "the payment ended");
      assert.ok(t.heldApprovals().includes("hk1"), "the approval still holds Send");
      assert.equal(inboxOf("hk1"), "attention", "a listed hold with no kept PCZT");
      heldListed();
      t.state.sessions = t.state.sessions.filter((x) => x.id !== "hk1");
      answer = () => ({ state: "unknown", txid: "tx-a", why: "it may still land", spent: false });
      at(4506917);
      assert.equal(t.heldApprovals().includes("h2"), false, "free at the ceiling");
      // A document with a sent mark shows "Confirming" while the approval holds, also before this
      // browser noted the send.
      at(4500000);
      const h4 = open("h4", "PA");
      await approved(me, h4);
      const h4sent = { ...h4, status: "failed", error: "Failed.", signed: "SA",
        broadcastTxid: "tx-a", final: { txid: "tx-a", tx_hex: "00" }, broadcastAt: Date.now() };
      put(h4sent);
      at(4500100);
      assert.equal(textOf(t.statusChip(h4sent)), "Confirming", "not the Failed of one seat");
      // A new approval in the same sync holds at once.
      t.heldApprovals();
      await t.putSec(t.state.gid, me, { marks: { ...t.sec(t.state.gid, me).marks,
        h9: { approved: "aa", tip: 4500001 } } });
      assert.ok(t.heldApprovals().includes("h9"), "no stale list");
      // A kept PCZT whose sighash is not the approved one does not end the hold by its expiry.
      keptStore.set(`kept:${t.state.gid}:h8`,
        Z.secretSeal(t.gkeys[t.state.gid], `kept\n${t.state.gid}:h8`, "PE"));
      await t.putSec(t.state.gid, me, { marks: { ...t.sec(t.state.gid, me).marks,
        h8: { approved: "aa", tip: 4500001 } } });
      t.heldApprovals();
      await quiet(() => sleep(20));
      at(4500101);
      assert.ok(t.heldApprovals().includes("h8"), "another sighash: its expiry does not count");
      // An approved session whose proposal no longer decodes asks for no approval.
      const h5 = { ...open("h5", "UNREADABLE") };
      put(h5);
      await t.putSec(t.state.gid, me, { marks: { ...t.sec(t.state.gid, me).marks,
        h5: { approved: "aa", tip: 4500001 } } });
      assert.equal(t.needsMyApproval(t.state.gid, h5), false);
      const h5b = { ...open("h5b", "PA"), pczt: undefined };
      put(h5b);
      await t.putSec(t.state.gid, me, { marks: { ...t.sec(t.state.gid, me).marks,
        h5b: { approved: "aa", tip: 4500001 } } });
      assert.equal(t.needsMyApproval(t.state.gid, h5b), false, "no proposal to compare");
      // A mark of another tab counts after the read window, with no approval in between.
      localStorage.setItem("zf-signing", JSON.stringify({
        ...JSON.parse(localStorage.getItem("zf-signing") || "{}"), [t.state.gid + ":h6"]: true }));
      await quiet(() => sleep(300));
      assert.equal(t.sawSigning(t.state.gid, "h6"), true);
      // A failed write is written again, and so are the marks of this tab that another tab's
      // write left out.
      const realSet = localStorage.setItem;
      localStorage.setItem = () => { throw new Error("quota"); };
      put({ ...open("h7", "PC"), package: "PK", status: "signing" });
      t.noteSessions();
      localStorage.setItem = realSet;
      assert.equal(JSON.parse(localStorage.getItem("zf-signing"))[t.state.gid + ":h7"], undefined);
      t.noteSessions();
      assert.equal(JSON.parse(localStorage.getItem("zf-signing"))[t.state.gid + ":h7"], true,
        "written again");
      localStorage.setItem("zf-signing", JSON.stringify({ other: true }));
      await quiet(() => sleep(300));
      t.sawSigning(t.state.gid, "h7");
      t.noteSessions();
      const back = JSON.parse(localStorage.getItem("zf-signing"));
      assert.equal(back[t.state.gid + ":h7"] && back.other, true, "merged and written again");
      // The activity list shows "Confirming" for a payment that holds notes, also when the status
      // of the document says otherwise.
      at(4500100);
      const h10 = { ...open("h10", "PB", Date.now()), package: "PK", status: "complete",
        broadcastTxid: "tx-b", final: { txid: "tx-b", tx_hex: "00" } };
      put(h10);
      assert.equal(textOf(t.statusChip(h10)), "Ready to send");
      const row = all(t.walletView(null, null), (x) => x.attrs?.["data-key"] === "pay-h10")[0];
      assert.match(textOf(row), /Confirming/);
      assert.match(textOf(row), /Zcash Testnet · Proposed by /, "a payment row names its chain");
      // A wallet with no Solana part has no chain select on its Activity section.
      const section = t.ui.tab;
      t.ui.tab = "activity";
      assert.equal(all(t.walletView(null, null), (x) => x.className === "field activity-filter")
        .length, 0, "no chain select without a Solana part");
      t.ui.tab = section;
      // The approval of another seat of this browser holds too. A stale restored seat whose
      // approval holds stays in this browser.
      const marks3 = t.sec(t.state.gid, third).marks;
      await t.putSec(t.state.gid, third, { marks: { h11: { approved: "aa", tip: 4500001 } } });
      assert.ok(t.heldApprovals().includes("h11"), "the approval of another seat");
      const was3 = { restored: t.sec(t.state.gid, third).restored,
        groupKey: t.sec(t.state.gid, third).groupKey };
      await t.putSec(t.state.gid, third, { restored: true, groupKey: "another key" });
      const stale = t.staleRestoreNote();
      assert.match(textOf(stale), /can still go on chain/);
      assert.equal(all(stale, (x) => x.tag === "button").length, 0, "no Remove while it holds");
      await t.putSec(t.state.gid, third, { marks: { old: { approved: "aa", tip: 4400000 } } });
      assert.notEqual(named(t.staleRestoreNote(), "button", "Remove from this browser"), undefined,
        "a mark past its ceiling holds nothing");
      await t.putSec(t.state.gid, third, { ...was3, marks: marks3 });
      // A kept PCZT that loads late counts in the same sync: here its expiry ends the hold.
      keptStore.set(`kept:${t.state.gid}:h12`,
        Z.secretSeal(t.gkeys[t.state.gid], `kept\n${t.state.gid}:h12`, "PA"));
      await t.putSec(t.state.gid, me, { marks: { ...t.sec(t.state.gid, me).marks,
        h12: { approved: "aa", tip: 4500001 } } });
      at(4503459);
      assert.ok(t.heldApprovals().includes("h12"), "held until the kept PCZT loads");
      await quiet(() => sleep(20));
      assert.equal(t.heldApprovals().includes("h12"), false,
        "its expiry frees it in the same sync");
      // S7 (the owner's decision D2): Approve, then Cancel in the drawer. With t < n the hold
      // stays, and the drawer of the cancelled payment releases it after a check and a second
      // click. The page takes t and n from the store again after each write: the tests set them
      // just before a check.
      const gid7 = t.state.gid, all7 = { ...group, t: group.n, shapeMoved: false };
      const drawerOn = async (ss) => {
        put(ss);
        await quiet(async () => {
          t.openSession(ss.id);
          await waitFor("the approvals of " + ss.id, () => Object.keys(t.state.commits).length > 0);
          await sleep(150);   // the draw of the open drawer runs with the stub page
        });
      };
      const storeWithout = (seat, sid) => {
        const inStore = JSON.parse(storage.get("zf-secrets"));
        delete inStore[gid7 + ":" + seat].nonces[sid];
        storage.set("zf-secrets", JSON.stringify(inStore));
      };
      at(4500000);
      const s7 = open("s7", "PA");
      await approved(me, s7);
      await drawerOn(s7);
      at(4500100);
      await quiet(() => t.cancelPayment(s7));
      assert.deepEqual([markOf(me, "s7").burned, (t.sec(gid7, me).nonces || {}).s7],
        [true, undefined], "the nonce went without a share");
      t.closeSession();
      at(4500101);
      assert.ok(t.heldApprovals().includes("s7"), "t < n: one cancel does not stop the others");
      const gone = { ...s7, status: "cancelled", error: "Cancelled by a device." };
      const holdOf = (ss) => all(t.sessionLayer(ss),
        (x) => x.attrs?.["data-key"] === "hold-" + ss.id)[0];
      assert.equal(holdOf(s7), undefined, "a payment that can still finish offers no release");
      put(gone);
      const kept7 = t.state.sessions;
      t.state.sessions = [gone];
      assert.match(String(t.sendBlocker()), /After a cancel, open that payment to release it\./);
      t.state.sessions = kept7;
      const card = () => holdOf(gone);
      assert.match(textOf(card()), new RegExp("other devices can still sign and send it\\. Send "
        + "stays off until block 4,503,459, in about \\d+ hours\\. Release Send only"));
      const hours = () => Number(/in about (\d+) hours/.exec(textOf(card()))[1]);
      const fresh = hours();
      at(4500101, new Set(), Date.now() - 2 * 3600 * 1000);
      assert.equal(hours(), fresh - 2, "the time since the sync counts");
      at(4500101);
      const labels7 = () => all(card(), (x) => x.tag === "button").map(textOf);
      const press = async (label, now = false) => {
        if (label === "Release Send now" && !now) await quiet(() => sleep(450));
        const button = named(card(), "button", label);
        await quiet(() => button.on.click(click));
      };
      t.ui.release = "another";
      assert.deepEqual(labels7(), ["I checked, release"], "the check of another payment");
      t.ui.release = null;
      await press("I checked, release");
      assert.equal(t.heldApprovals().includes("s7"), true, "one click releases nothing");
      assert.deepEqual(labels7(), ["Release Send now", "Keep the hold"],
        "Keep the hold takes the place of the first button");
      await quiet(async () => { t.openSession("s7"); await sleep(150); });
      t.closeSession();
      assert.deepEqual(labels7(), ["I checked, release"], "a closed drawer forgets the check");
      await press("I checked, release");
      await press("Keep the hold");
      assert.equal(named(card(), "button", "Release Send now"), undefined, "kept");
      await press("I checked, release");
      await press("Release Send now", true);
      assert.equal(t.heldApprovals().includes("s7"), true, "a double click releases nothing");
      await press("Release Send now");
      assert.equal(t.heldApprovals().includes("s7"), false, "released by hand");
      assert.equal(card(), undefined, "no card once released");
      // A failure part that one seat wrote, with no cancel here: the release burns the nonce of
      // each seat here first, so this browser never signs that payment after Send opens again.
      at(4500000);
      const s7h = open("s7h", "PA");
      await approved(other, s7h);
      at(4500100);
      const fakeFail = { ...s7h, status: "failed", error: "Failed." };
      put(fakeFail);
      assert.ok((t.sec(gid7, other).nonces || {}).s7h, "the nonce is live");
      Object.assign(t.ui, { release: "s7h", releaseAt: 0 });
      const release7h = named(holdOf(fakeFail), "button", "Release Send now");
      await quiet(() => release7h.on.click(click));
      assert.equal(t.heldApprovals().includes("s7h"), false, "released by hand (the second seat)");
      assert.equal((t.sec(gid7, other).nonces || {}).s7h, undefined, "and its nonce is gone");
      t.reactSession({ ...s7h, package: "PK", signers: [other] });
      assert.equal(t.busy.has("share:s7h:" + other), false, "no share after the release");
      // A release that this browser cannot save changes nothing.
      at(4500000);
      const s7q = open("s7q", "PA");
      await approved(other, s7q);
      at(4500100);
      const failQ = { ...s7q, status: "failed", error: "Failed." };
      put(failQ);
      Object.assign(t.ui, { release: "s7q", releaseAt: 0 });
      const releaseQ = named(holdOf(failQ), "button", "Release Send now");
      // A lock of another tab makes the plain save refuse, with no change of the storage state.
      storage.set("zf-vault", "{}");
      await quiet(() => releaseQ.on.click(click));
      storage.delete("zf-vault");
      assert.match(t.banner.text, /could not save the change of device/);
      assert.ok(t.heldApprovals().includes("s7q"), "still held");
      assert.ok((t.sec(gid7, other).nonces || {}).s7q, "and the nonce is still there");
      // Two seats here approved. The save of the second burn fails: the first nonce is gone,
      // nothing says released, and the hold stays (no release next to a live nonce).
      const s7p = open("s7p", "PA");
      await approved(me, s7p);
      await approved(other, s7p);
      const failP = { ...s7p, status: "failed", error: "Failed." };
      put(failP);
      Object.assign(t.ui, { release: "s7p", releaseAt: 0 });
      const releaseP = named(holdOf(failP), "button", "Release Send now");
      const setItem = localStorage.setItem;
      let writes = 0;
      localStorage.setItem = (k, v) => {
        setItem.call(localStorage, k, v);
        if (k === "zf-secrets" && ++writes === 1) storage.set("zf-vault", "{}");
      };
      await quiet(() => releaseP.on.click(click));
      localStorage.setItem = setItem;
      storage.delete("zf-vault");
      assert.match(t.banner.text, /could not save the change of device/);
      assert.deepEqual([markOf(me, "s7p").released, markOf(other, "s7p").released],
        [undefined, undefined], "nothing says released");
      assert.ok(t.heldApprovals().includes("s7p"), "the hold stays");
      // A release waits for the lock of the secrets.
      let unlockP;
      const busyTab = t.exclusive("secrets", () => new Promise((ok) => { unlockP = ok; }));
      const releaseP2 = named(holdOf(failP), "button", "Release Send now");
      const releasing = quiet(async () => { releaseP2.on.click(click); await sleep(200); });
      await releasing;
      assert.ok(t.heldApprovals().includes("s7p"), "it waits for the lock");
      unlockP();
      await busyTab;
      await quiet(() => sleep(100));
      assert.equal(t.heldApprovals().includes("s7p"), false, "then it releases");
      t.ui.release = null;
      // The second burn fails once: the release stops before any mark. The first nonce is gone,
      // the second stays, nothing says released, and the hold stays.
      const s7d = open("s7d", "PA");
      await approved(me, s7d);
      await approved(other, s7d);
      const failD = { ...s7d, status: "failed", error: "Failed." };
      put(failD);
      Object.assign(t.ui, { release: "s7d", releaseAt: 0 });
      const releaseD = named(holdOf(failD), "button", "Release Send now");
      const getItem = localStorage.getItem, setItemD = localStorage.setItem;
      let burns = 0, refused = false;
      localStorage.setItem = (k, v) => {
        setItemD.call(localStorage, k, v);
        if (k === "zf-secrets") burns++;
      };
      localStorage.getItem = (k) => {
        if (k !== "zf-vault" || burns !== 1 || refused) return getItem.call(localStorage, k);
        refused = true;
        return "{}";
      };
      await quiet(() => releaseD.on.click(click));
      Object.assign(localStorage, { getItem, setItem: setItemD });
      assert.equal(refused, true, "one save refused");
      assert.equal(t.banner.text,
        "This browser could not save the change of device " + other + ".");
      const nonceD = (seat) => !!(t.sec(gid7, seat).nonces || {}).s7d;
      assert.deepEqual([markOf(me, "s7d").released, markOf(other, "s7d").released, nonceD(me),
        nonceD(other)], [undefined, undefined, false, true], "no release next to a live nonce");
      assert.ok(t.heldApprovals().includes("s7d"), "the hold stays");
      t.ui.release = null;
      // A cancel whose burn cannot be saved says that the payment is cancelled, that the approval
      // stays here, and how to end the hold.
      at(4500000);
      const s7f = open("s7f", "PA");
      await approved(me, s7f);
      await drawerOn(s7f);
      storage.set("zf-vault", "{}");
      const saidF = await quiet(() => t.cancelPayment(s7f).then(() => "", (e) => e.message));
      storage.delete("zf-vault");
      t.closeSession();
      assert.match(saidF, new RegExp("^The payment is cancelled, but this browser could not "
        + "change its saved keys, so its approval stays here\\. This browser could not save the "
        + "change of device " + me + "\\. To end the hold, release it in the payment\\.$"));
      assert.ok((t.sec(gid7, me).nonces || {}).s7f, "the nonce stays");
      // With t = n every seat must sign, so the cancel of a seat that made no share ends the
      // hold. Both seats of this browser that approved burn. Only a signed shape counts.
      at(4500000);
      const s7n = open("s7n", "PA");
      await approved(me, s7n);
      await approved(other, s7n);
      await drawerOn(s7n);
      at(4500100);
      await quiet(() => t.cancelPayment(s7n));
      t.closeSession();
      assert.deepEqual([markOf(me, "s7n").burned, markOf(other, "s7n").burned], [true, true]);
      t.state.g = all7;
      at(4500101);
      assert.equal(t.heldApprovals().includes("s7n"), false, "t = n: the hold ends");
      t.state.g = { ...all7, shapeMoved: true };
      at(4500102);
      assert.equal(t.heldApprovals().includes("s7n"), true, "a shape that moved does not count");
      t.state.g = { ...group };
      at(4500103);
      assert.equal(t.heldApprovals().includes("s7n"), true, "control: with t < n it holds");
      // No burn when a share of the seat may exist: storage has no nonce (a share went out), the
      // drawer is closed, the open payment shows a share of the seat, or another copy approved.
      const noBurn = async (sid, before) => {
        at(4500000);
        const ss = open(sid, "PA");
        await approved(me, ss);
        await drawerOn(ss);
        await before(ss);
        await quiet(() => t.cancelPayment(ss));
        t.closeSession();
        t.state.g = all7;
        at(4500104);
        assert.equal(markOf(me, sid).burned, undefined, sid + ": not burned");
        assert.ok(t.heldApprovals().includes(sid), sid + ": the hold stays");
        t.state.g = group;
      };
      await noBurn("s7s", () => storeWithout(me, "s7s"));
      await noBurn("s7o", () => t.closeSession());
      await noBurn("s7m", async (ss) => {
        const rel = "sessions/" + ss.id + "/commits/" + me;
        data.set("groups/" + gid7 + "/" + rel,
          await t.signedDoc(gid7, rel, me, { commitments: ["another copy"], at: 1 }));
        notify();
        await waitFor("the other approval", () => S(t.state.commits[me]?.commitments)
          === S(["another copy"]));
      });
      await noBurn("s7c", async (ss) => {
        const rel = "sessions/" + ss.id + "/shares/" + me;
        data.set("groups/" + gid7 + "/" + rel,
          await t.signedDoc(gid7, rel, me, { shares: "[1]", at: 1 }));
        notify();
        await waitFor("the share of " + ss.id, () => t.state.shares[me]);
      });
      // A cancel waits for the lock of a seat that signs. Inside the lock the seat saved its burn
      // and sent its share, so the cancel marks nothing.
      const s7w = open("s7w", "PA");
      await approved(me, s7w);
      await drawerOn(s7w);
      let unlock;
      const signing = t.exclusive("secrets", () => new Promise((ok) => { unlock = ok; }));
      const cancelling = quiet(() => t.cancelPayment(s7w));
      await sleep(50);
      storeWithout(me, "s7w");
      unlock();
      await signing;
      await cancelling;
      t.closeSession();
      assert.equal(markOf(me, "s7w").burned, undefined, "the cancel waited for the share");
      t.state.g = group;
      // S8 (ZEC-10): one open payment at a time. A faucet wallet holds one note, so a second
      // proposal would spend it again and fail only at the broadcast.
      const OPEN8 = "Finish or cancel the open payment, or wait until it expires.";
      at(4500100);
      const o8 = open("o8", "PA");
      await t.putSec(t.state.gid, me, { marks: { ...t.sec(t.state.gid, me).marks,
        o8c: { approved: "aa", tip: 4500001 } } });
      // The approved PCZT is kept, so the expiry of the changed payment is known.
      keptStore.set(`kept:${t.state.gid}:o8c`,
        Z.secretSeal(t.gkeys[t.state.gid], `kept\n${t.state.gid}:o8c`, "PA"));
      t.expiryAt(open("o8c", "PB"));
      await quiet(() => sleep(20));
      assert.equal(t.expiryAt(open("o8c", "PB")), 4503456, "the kept PCZT gives the expiry");
      const cases = [o8, { ...o8, error: "Cancelled." }, { ...o8, broadcastTxid: "tx-a" },
        open("o8u", "UNREADABLE"), open("o8f", "PF"), open("o8c", "PB")];
      assert.deepEqual(cases.map((x) => t.isOpen(x)), [true, false, false, false, false, false],
        "open; cancelled; sent; unreadable; an expiry past any approval; an approval changed");
      at(4500100, new Set(["tx-a"]));
      assert.equal(t.isOpen(o8), false, "a block holds it");
      at(4503456 - 1 - 6912);
      assert.equal(t.isOpen(o8), true, "the latest expiry that an approval allows counts");
      at(4503456 - 2 - 6912);
      assert.equal(t.isOpen(o8), false, "one block later than that does not");
      at(4503500);
      assert.equal(t.isOpen(o8), false, "an expired proposal is not open");
      // Send and every proposal refuse while one is open, also "Propose again" on a move: all go
      // through newSpend. The approvals of this block hold Send, so they step aside here.
      at(4500100);
      const sessions8 = t.state.sessions;
      const marks8 = t.localSeats().map((i) => [i, t.sec(t.state.gid, i).marks]);
      for (const [i] of marks8) await t.putSec(t.state.gid, i, { marks: {} });
      t.state.sessions = [{ ...o8, status: "cancelled", error: "Cancelled." }, o8];
      assert.equal(t.sendBlocker(), OPEN8, "one open payment in the list is enough");
      asked.length = 0;
      await assert.rejects(quiet(() => t.newSpend([{ to: "utest1x", amount: 5 }], "two")),
        /Finish or cancel the open payment/);
      assert.equal(asked.some((x) => x[0] === "spend"), false, "the engine makes nothing");
      t.state.sessions = [{ ...o8, status: "cancelled", error: "Cancelled." }];
      assert.equal(t.sendBlocker(), null, "a cancelled one blocks nothing");
      // A proposal also refuses on a payment in flight and on a held approval, with their texts.
      const flying8 = { ...o8, id: "o8s", signed: "SA", broadcastTxid: "tx-a", broadcastAt: 1,
        final: { txid: "tx-a", tx_hex: "00" }, status: "broadcast" };
      t.state.sessions = [flying8];
      await assert.rejects(quiet(() => t.newSpend([{ to: "utest1x", amount: 5 }], "f")),
        /waiting for its block/);
      t.state.sessions = [open("o8c", "PB")];
      await t.putSec(t.state.gid, me, { marks: { o8c: { approved: "aa", tip: 4500001 } } });
      assert.match(String(t.sendBlocker()), /approved can still go on chain/,
        "a changed approval shows the text of its hold");
      await assert.rejects(quiet(() => t.newSpend([{ to: "utest1x", amount: 5 }], "h")),
        /approved can still go on chain/);
      await t.putSec(t.state.gid, me, { marks: {} });
      t.state.sessions = [];
      assert.equal(asked.some((x) => x[0] === "spend"), false, "the engine makes nothing");
      // ── Pay to a ZNS name (testnet). Each case starts a new registry on a fake /zns, so that
      // no copy of an earlier case is left. `gets` counts the calls of the page to
      // registry.get(), `fetches` the downloads.
      const pageGet = registry.get;
      const znsRec = (name, address, height = 1, lastAction = "claim") => ({
        name, address, txid: "ab".repeat(32), height, last_action: lastAction,
        expires_at: "none" });
      const NAMED = "utest1x", MOVED = "utest1bobnow", UNPAYABLE = "utest1unpayable";
      const OTHER = "utest1someoneelse";
      // The engine gives another form of the address of "alice": a payee must keep the string of
      // the registry, not this one.
      const canon = (a) => (a === NAMED ? "utest1canonicalform" : a);
      const OWN = t.state.wallet.address;
      const ZNS_NAMES = [znsRec("alice", NAMED), znsRec("bob", MOVED), znsRec("odd", UNPAYABLE),
        znsRec("self", OWN), znsRec("fresh", NAMED, 4500100 - 3455),
        znsRec("aged", NAMED, 4500100 - 3456),
        znsRec("moved", NAMED, 4495100, "update")];
      let gets = 0, fetches = 0;
      const znsServes = (answer) => {
        gets = 0; fetches = 0;
        const fresh = createRegistry({ fetch: async () => { fetches++; return answer(); } });
        registry.get = () => { gets++; return fresh.get(); };
      };
      const znsOk = (names = ZNS_NAMES, height = 4500100) => () => Response.json(
        { network: "test", key: ZNS_KEY, height, synced: true, names });
      const znsDown = () => new Response("down", { status: 503 });
      const ZNS_DOWN = "The ZNS registry cannot be read. Try again.";
      const zStub = (normalizeAddress = (a) => a) => ({ ...fakeZ, latestHeight: async () => 4500001,
        normalizeAddress, signCommit: () => S({ nonces: ["n"], commitments: ["c"] }),
        inspect: (p) => {
          if (!decodes[p]) throw new Error("unreadable");
          return S(decodes[p]);
        } });
      let againPayees = null;
      {
        at(4500100);
        t.ui.send = false;   // the page draws no Send form of its own during these cases
        t.setZ(zStub(canon));
        const sessionDocs = () => [...data.keys()].filter((k) => /\/sessions\/[^/]+$/.test(k));
        const rowsOf = (...list) => {
          t.ui.pay = list.map(([to, amt = "0.5", memo = ""]) =>
            ({ k: ++t.ui.payKey, to, amt, memo }));
          return t.sendDialog();
        };
        // A form whose hints have answered, as a person sees it before the click.
        const settled = async (...list) => {
          const form = rowsOf(...list);
          await quiet(() => sleep(10));
          return form;
        };
        const boxOf = (d, n = 0) => all(d, (x) => /^s-to-/.test(x.attrs?.id ?? ""))[n];
        const hintOf = (d, n = 0) => all(d, (x) => x.className === "pay-row")[n].kids
          .find((k) => k.tag === "span" && /^hint/.test(k.className));
        const typeIn = (d, text, n = 0) => {
          boxOf(d, n).on.input({ target: { value: text } });
          return hintOf(d, n);
        };
        const shows = (hint) => [hint.textContent, hint.className];
        // The proposals made since `before`: their payees. They are taken out of the store.
        const proposedSince = async (before) => {
          const fresh = sessionDocs().filter((k) => !before.has(k));
          const payees = fresh.map((k) => data.get(k).payees);
          for (const k of fresh) data.delete(k);
          if (fresh.length) { t.closeSession(); notify(); await quiet(settle); }
          t.state.sessions = [];
          return payees;
        };
        // The form gives a review, or for "Propose again" a proposal: the payees of either.
        const madeSince = async (before) => {
          const review = t.ui.sendReview;
          t.ui.sendReview = null;
          return review ? [review.prep.payees] : proposedSince(before);
        };
        // A submit with the stub page, as the page draws and reacts after it.
        const stubPage = () => ({ ...recorder, activeElement: { dataset: {} },
          getElementById: () => new Rec("div") });
        const submit = async (dialog) => {
          const before = new Set(sessionDocs());
          globalThis.document = stubPage();
          await dialog.on.submit({ preventDefault() {}, currentTarget: null });
          globalThis.document = realDocument;
          await sleep(300);
          globalThis.document = recorder;
          return madeSince(before);
        };
        // Two submits at once: `release()` runs when both wait for the registry.
        const submitTwice = async (dialog, release) => {
          const before = new Set(sessionDocs());
          const ev = { preventDefault() {}, currentTarget: null };
          globalThis.document = stubPage();
          const both = [dialog.on.submit(ev), dialog.on.submit(ev)];
          globalThis.document = realDocument;
          release();
          await Promise.all(both);
          await sleep(300);
          globalThis.document = recorder;
          return madeSince(before);
        };
        const refused = async (dialog, text) => {
          asked.length = 0;
          assert.deepEqual(await submit(dialog), [], "nothing is proposed");
          assert.deepEqual(t.banner, { kind: "bad", text });
          assert.equal(asked.some((x) => x[0] === "spend"), false, "the engine makes nothing");
        };

        // The label and the placeholder, and the lookup of a name in the hint.
        znsServes(znsOk());
        let form = rowsOf([""]);
        assert.equal(boxOf(form).attrs.placeholder, "utest1… or alice.zec");
        assert.equal(boxOf(form).attrs["aria-label"], "Recipient address or ZNS name");
        assert.match(textOf(form), /One address or ZNS name and amount per line, then an optional/);
        let hint = typeIn(form, "Alice.ZEC ");
        assert.equal(hint.attrs.role, "status", "a screen reader hears the hint");
        assert.deepEqual(shows(hint), ["Looking up alice.zec…", "hint "]);
        await quiet(() => sleep(20));
        assert.deepEqual(shows(hint), [`alice.zec gives this address: ${NAMED}`, "hint ok"]);
        assert.deepEqual([gets, fetches], [1, 1]);
        for (const [typed, note] of [["bob", ""], ["fresh.zcash", " This name got this address at "
          + "block 4496645, less than a day ago. Check the address with the payee."],
        ["aged", ""], ["moved", " This name moved to a new address at block 4495100."]]) {
          hint = typeIn(form, typed);
          await quiet(() => sleep(10));
          const address = ZNS_NAMES.find((r) => r.name === typed.split(".")[0]).address;
          const name = typed.split(".")[0];
          assert.equal(hint.textContent, `${name}.zec gives this address: ${address}${note}`);
        }
        hint = typeIn(form, "nobody");
        await quiet(() => sleep(10));
        assert.deepEqual(shows(hint), ["nobody is not a unified address, and the testnet ZNS "
          + "registry has no name nobody.", "hint bad"]);
        assert.equal(fetches, 1, "one download serves every lookup");

        // An address, a request and a transparent address are no names: no lookup.
        znsServes(znsOk());
        form = rowsOf([""]);
        const OWN_REFUSAL = "This is the address of this wallet. Enter the address of someone "
          + "else.";
        assert.deepEqual(shows(typeIn(form, OTHER)), ["Valid testnet address", "hint ok"]);
        assert.equal(boxOf(form).attrs["aria-invalid"], "false",
          "an address that Send takes is no error");
        assert.equal(boxOf(form).attrs["aria-describedby"], hintOf(form).attrs.id,
          "the field points at the note under it");
        assert.deepEqual(shows(typeIn(form, OWN)), [OWN_REFUSAL, "hint bad"],
          "the address of this wallet reads as refused");
        assert.equal(boxOf(form).attrs["aria-invalid"], "true",
          "the address of this wallet marks the field as invalid, as Review refuses it");
        const tAddress = "tmBsTi2xWTjUdEXnuTceL7fecEQKeWaPDJd";
        assert.deepEqual(shows(typeIn(form, tAddress)),
          ["Not a shielded Zcash testnet address. It starts with utest1.", "hint bad"]);
        assert.equal(boxOf(form).attrs["aria-invalid"], "true",
          "a red hint marks the recipient field as invalid");
        assert.equal(typeIn(form, "tex1" + "q".repeat(30)).className, "hint bad");
        typeIn(form, `zcash:${OWN}?amount=1`);
        assert.equal(t.ui.pay.length, 1);
        assert.equal(t.ui.pay[0].to, OWN, "the request fills the row");
        await quiet(() => sleep(20));
        assert.deepEqual([gets, fetches], [0, 0],
          "no address, request or t-address asks the registry");
        await refused(rowsOf([tAddress]), "Enter a shielded Zcash testnet address. It starts with "
          + "utest1.");
        assert.deepEqual([gets, fetches], [0, 0], "the submit asks no registry either");

        // A late answer does not overwrite the hint of newer text.
        const waiting = [];
        registry.get = () => new Promise((ok) => { waiting.push(ok); });
        const parsed = await createRegistry({ fetch: async () => znsOk()() }).get();
        form = rowsOf([""]);
        hint = typeIn(form, "alice");
        typeIn(form, "bob");
        assert.equal(waiting.length, 2);
        waiting[0](parsed);
        await quiet(() => sleep(10));
        assert.equal(hint.textContent, "Looking up bob.zec…", "the answer for alice is late");
        waiting[1](parsed);
        await quiet(() => sleep(10));
        assert.equal(hint.textContent, `bob.zec gives this address: ${MOVED}`);

        // The submit looks the name up again, and pays the address of the registry. The row shows
        // the address first: a form whose hint did not answer refuses.
        znsServes(znsOk());
        await refused(rowsOf(["alice.zec"]), "Wait until the form shows the address of alice.zec.");
        let sent = await submit(await settled(["alice.zec"]));
        assert.deepEqual(sent, [[{ to: NAMED, amount: 50000000, name: "alice" }]],
          "the string of the registry, not the form of the engine");
        assert.notEqual(t.banner?.kind, "bad", "the review opens with no error");
        assert.equal(gets >= 1, true, "the submit asks the registry");
        sent = await submit(await settled([OTHER, "0.1"], ["Bob", "0.2", "rent"]));
        assert.deepEqual(sent, [[{ to: OTHER, amount: 10000000 },
          { to: MOVED, amount: 20000000, memo: "rent", name: "bob" }]],
        "an address row keeps no name key");
        // The name moves after the hint: the submit refuses and the form shows the new address
        // with the note of a recent change. A second submit proposes the new address.
        form = await settled(["alice"]);
        assert.equal(t.ui.pay[0].shown.address, NAMED);
        znsServes(znsOk([znsRec("alice", MOVED, 4500090)]));
        await refused(form, "The name alice.zec now gives another address. Check it, then "
          + "propose again.");
        assert.equal(t.ui.pay[0].shown.address, MOVED, "the row keeps the new address");
        assert.equal(t.ui.pay[0].shown.seen, false, "but no hint drew it yet");
        // A second click before the redraw pays nothing: the form never showed that address.
        await refused(form, "Wait until the form shows the address of alice.zec.");
        const redrawn = hintOf(t.sendDialog()).textContent;
        assert.equal(t.ui.pay[0].shown.seen, true, "the hint drew it");
        assert.equal(redrawn, `alice.zec gives this address: ${MOVED} This name got this address `
          + "at block 4500090, less than a day ago. Check the address with the payee.");
        assert.deepEqual(await submit(form), [[{ to: MOVED, amount: 50000000, name: "alice" }]],
          "after the redraw one submit proposes it");
        // A close of Send while the names are looked up: the build that follows opens no review.
        znsServes(znsOk());
        form = await settled(["alice"]);
        const lookups = [];
        registry.get = () => new Promise((ok) => { lookups.push(ok); });
        const named0 = await createRegistry({ fetch: async () => znsOk()() }).get();
        const bannerBefore = t.banner;
        globalThis.document = stubPage();
        const lateSubmit = form.on.submit({ preventDefault() {}, currentTarget: null });
        globalThis.document = realDocument;
        assert.equal(lookups.length, 1, "the submit waits for the registry");
        t.endSend();
        lookups.forEach((ok) => ok(named0));
        await lateSubmit;
        await sleep(300);
        globalThis.document = recorder;
        assert.equal(t.ui.sendReview, null, "no review after a close during the lookup");
        assert.ok(t.banner === bannerBefore || t.banner?.kind !== "bad", "the build ran");
        // Two submits at once, the answer of the registry held: the first refuses with the new
        // address, and the second does not pay it either.
        znsServes(znsOk());
        form = await settled(["alice"]);
        const held = [];
        registry.get = () => new Promise((ok) => { held.push(ok); });
        const movedReg = await createRegistry({
          fetch: async () => znsOk([znsRec("alice", MOVED, 4500090)])() }).get();
        asked.length = 0;
        const twice = await submitTwice(form, () => {
          assert.equal(held.length, 2, "both submits wait for the registry");
          held.forEach((ok) => ok(movedReg));
        });
        assert.deepEqual(twice, [], "neither pays the address that the form never showed");
        assert.equal(asked.some((x) => x[0] === "spend"), false, "the engine makes nothing");
        assert.deepEqual([t.ui.pay[0].shown.address, t.ui.pay[0].shown.seen], [MOVED, false]);
        znsServes(znsOk([znsRec("alice", MOVED, 4500090)]));
        hintOf(t.sendDialog());
        assert.deepEqual(await submit(form), [[{ to: MOVED, amount: 50000000, name: "alice" }]],
          "after the redraw one submit proposes it");
        // Two rows that moved both show the new address after one refusal.
        znsServes(znsOk());
        form = await settled(["alice"], ["bob", "0.2"]);
        znsServes(znsOk([znsRec("alice", OTHER), znsRec("bob", NAMED)]));
        await refused(form, "Recipient 1: The name alice.zec now gives another address. Check it, "
          + "then propose again.");
        assert.deepEqual(t.ui.pay.map((r) => r.shown.address), [OTHER, NAMED]);
        // Typing again clears the shown address until the new hint answers.
        znsServes(znsOk());
        form = await settled(["alice"]);
        typeIn(form, "bob");
        assert.equal(t.ui.pay[0].shown, null);
        await refused(form, "Wait until the form shows the address of bob.zec.");
        // "Propose again" keeps the name with the address: the same payee, and the approvers check
        // the name. Typing in the field drops the name.
        znsServes(znsOk());
        const expired8 = { ...open("pa1", "PA"),
          payees: [{ to: NAMED, amount: 5, name: "alice" }] };
        Object.assign(t.ui, { send: false, after: null });
        await quiet(() => t.proposeAgain(expired8));
        assert.deepEqual(t.ui.pay.map(({ to, amt, name }) => ({ to, amt, name })),
          [{ to: NAMED, amt: "0.00000005", name: "alice" }]);
        form = t.sendDialog();
        assert.deepEqual(shows(hintOf(form)), ["Kept from the first proposal: alice.zec. Each "
          + "approver in the web app checks the name again.", "hint ok"]);
        assert.deepEqual([gets, fetches], [0, 0], "an address row asks no registry");
        againPayees = (await submit(form))[0];
        assert.deepEqual(againPayees, [{ to: NAMED, amount: 5, name: "alice" }]);
        Object.assign(t.ui, { send: false, after: null });
        await quiet(() => t.proposeAgain(expired8));
        form = t.sendDialog();
        typeIn(form, OTHER);
        assert.equal(t.ui.pay[0].name, null);
        assert.deepEqual(await submit(form), [[{ to: OTHER, amount: 5 }]], "no name key");
        // A kept name on the address of this wallet: Review refuses it, so the note is red.
        Object.assign(t.ui, { send: false, after: null });
        await quiet(() => t.proposeAgain({ ...open("pa1", "PA"),
          payees: [{ to: OWN, amount: 5, name: "alice" }] }));
        form = t.sendDialog();
        assert.deepEqual(shows(hintOf(form)), [OWN_REFUSAL, "hint bad"],
          "a kept name on the address of this wallet reads as refused");
        assert.equal(boxOf(form).attrs["aria-invalid"], "true",
          "and marks the field as invalid, as Review refuses it");
        t.ui.send = false;

        // These stop the proposal with their text.
        znsServes(znsOk());
        await refused(rowsOf(["nobody"]), "nobody is not a unified address, and the testnet ZNS "
          + "registry has no name nobody.");
        await refused(rowsOf([OTHER, "0.1"], ["nobody"]), "Recipient 2: nobody is "
          + "not a unified address, and the testnet ZNS registry has no name nobody.");
        form = await settled(["self"]);
        assert.deepEqual(shows(hintOf(form)), [OWN_REFUSAL, "hint bad"],
          "a name that gives the address of this wallet reads as refused");
        assert.equal(boxOf(form).attrs["aria-invalid"], "true",
          "and marks the field as invalid, as Review refuses it");
        await refused(form, OWN_REFUSAL);
        await refused(await settled(["alice", ""]), "Enter an amount greater than zero, with at "
          + "most 8 decimals.");
        await refused(await settled(["alice", "0.5", "x".repeat(600)]),
          memoError("x".repeat(600)));
        znsServes(znsOk(ZNS_NAMES, 4500089));
        await refused(rowsOf(["alice"]), "The ZNS registry is 11 blocks behind the chain, so a ZNS "
          + "name cannot be used now.");
        znsServes(znsOk(ZNS_NAMES, 4500090));
        assert.deepEqual(await submit(await settled(["alice"])),
          [[{ to: NAMED, amount: 50000000, name: "alice" }]], "10 blocks behind still works");
        znsServes(znsDown);
        await refused(rowsOf(["alice"]), ZNS_DOWN);
        hint = typeIn(rowsOf([""]), "alice");
        await quiet(() => sleep(10));
        assert.deepEqual(shows(hint), [ZNS_DOWN, "hint bad"]);
        // A registry address that the engine does not accept for this network.
        znsServes(znsOk());
        t.setZ(zStub((a) => { if (a === UNPAYABLE) throw new Error("no"); return canon(a); }));
        form = await settled(["odd"]);
        assert.deepEqual(shows(hintOf(form)),
          ["The name odd.zec gives an address that Zigs cannot pay.", "hint bad"],
          "a name that gives an address that Send cannot take reads as refused");
        assert.equal(boxOf(form).attrs["aria-invalid"], "true",
          "and marks the field as invalid, as Review refuses it");
        await refused(form, "The name odd.zec gives an address that Zigs cannot pay.");
        t.setZ(zStub(canon));
        // The memo and the pasted list mark their fields as well.
        const idOf = (re) => (d, n = 0) => all(d, (x) => re.test(x.attrs?.id ?? ""))[n];
        form = rowsOf([OTHER, "0.1", "x".repeat(600)]);
        const memoField = idOf(/^s-memo-\d/)(form), memoNote = idOf(/^s-memo-hint-/)(form);
        assert.equal(memoField.attrs["aria-invalid"], "true",
          "an over-long memo marks the memo field as invalid");
        assert.equal(memoField.attrs["aria-describedby"], memoNote.attrs.id);
        memoField.on.input({ target: { value: "rent" } });
        assert.equal(memoField.attrs["aria-invalid"], "false", "a short memo clears the mark");
        t.ui.listError = "Paste at least one line.";
        form = t.sendDialog();
        const listField = idOf(/^s-list$/)(form), listNote = idOf(/^s-list-error$/)(form);
        assert.deepEqual([listField.attrs["aria-invalid"], listNote.textContent],
          ["true", "Paste at least one line."], "the pasted list is marked invalid with its error");
        assert.equal(listField.attrs["aria-describedby"], "s-list-error");
        listField.on.input({ target: { value: "" } });
        assert.equal(listField.attrs["aria-invalid"], "true",
          "a redraw that puts the same text back keeps the error of the list");
        listField.on.input({ target: { value: "0.5" } });
        assert.deepEqual([listField.attrs["aria-invalid"], listNote.textContent, t.ui.listError],
          ["false", "", ""], "an edit of the list clears its error");
        // The wallet lost its sync between the draw and the submit.
        form = await settled(["alice"]);
        const keptChain = t.chain;
        t.setChain({ ...keptChain, bal: null });
        await refused(form, "The wallet has not finished its first sync.");
        t.setChain(keptChain);

        // A mainnet wallet looks no name up and keeps the address error.
        const testnet = t.state.g;
        t.state.g = { ...testnet, network: "mainnet" };
        znsServes(znsOk());
        form = rowsOf([""]);
        assert.equal(boxOf(form).attrs.placeholder, "u1…");
        assert.equal(boxOf(form).attrs["aria-label"], "Recipient address");
        assert.match(textOf(form), /One address and amount per line, then an optional memo/);
        assert.deepEqual(shows(typeIn(form, "alice.zec")),
          ["Not a shielded Zcash mainnet address. It starts with u1.", "hint bad"]);
        await refused(rowsOf(["alice.zec"]), "Enter a shielded Zcash mainnet address. It starts "
          + "with u1.");
        assert.deepEqual([gets, fetches], [0, 0], "a mainnet wallet makes no lookup");
        // "Propose again" on a mainnet wallet keeps no name: no name text in the hint, and the
        // payee is {to, amount}.
        const mainPay = { ...open("pa2", "PA"),
          payees: [{ to: "u1mainnetpayee", amount: 5, name: "alice" }] };
        Object.assign(t.ui, { send: false, after: null });
        await quiet(() => t.proposeAgain(mainPay));
        form = t.sendDialog();
        assert.deepEqual(shows(hintOf(form)), ["Valid mainnet address", "hint ok"]);
        assert.deepEqual(await submit(form), [[{ to: "u1mainnetpayee", amount: 5 }]],
          "a mainnet payee keeps no name");
        t.ui.send = false;
        t.state.g = testnet;
        t.ui.pay = null;
        t.setZ(zStub());
      }
      // A double tap proposes once: the second call refuses at once.
      let free8;
      const slow = new Promise((ok) => { free8 = ok; });
      const real = engine.createSpend;
      engine.createSpend = async () => { await slow; throw new Error("No notes."); };
      const one = quiet(() => t.newSpend([{ to: "utest1x", amount: 5 }], "one"));
      assert.equal(t.ui.proposing, true, "the Propose button is off");
      const late = sleep(500).then(() => "the second call waited");
      const second = quiet(() => t.newSpend([{ to: "utest1x", amount: 5 }], "two"))
        .then(() => "the second call ran", (e) => e.message);
      assert.equal(await Promise.race([second, late]),
        "The proposal of a payment is not complete yet. Wait a moment.");
      free8();
      await assert.rejects(one, /No notes/);
      assert.equal(t.ui.proposing, false, "on again after the call");
      // S9: a proposal with no answer in 60 s stops and frees Propose. The engine may still use
      // the wallet object, so it counts as stalled, and the next sync starts a new one. An answer
      // ends the wait, and an object that a sync started meanwhile stays.
      const realTimeout = globalThis.setTimeout;
      globalThis.setTimeout = (fn, ms, ...a) => realTimeout(fn, ms >= 60000 ? ms / 600 : ms, ...a);
      const propose9 = (note) => quiet(() => t.newSpend([{ to: "utest1x", amount: 5 }], note))
        .then(() => "proposed", (e) => e.message);
      const stallOf = () => [t.chain.stalled ?? null, t.chain.url];
      engine.createSpend = async () => { throw new Error("No notes."); };
      assert.equal(await propose9("fast"), "No notes.");
      await quiet(() => sleep(300));
      assert.deepEqual(stallOf(), [null, "https://lwd.test"], "an answer ends the wait");
      engine.createSpend = () => new Promise(() => {});
      const swapped = propose9("swap");
      t.chain.cw = { ...engine };
      await swapped;
      assert.deepEqual(stallOf(), [null, "https://lwd.test"], "the new object of a sync stays");
      t.chain.cw = engine;
      // The next server answers when the test lets it: the sync that starts after the timeout
      // waits for it.
      let openNext;
      const nextUp = new Promise((ok) => { openNext = ok; });
      const made = [];
      class NextWallet {
        constructor(ufvk, birthday, url) { made.push(url); }
        static restore() { throw new Error("no saved state"); }
        async sync() { return S({ height: 4500002, tip: 4500002, spendable: 1e8, pending: 0 }); }
        received() { return "[]"; }
        sent() { return "[]"; }
        snapshot() { return "{}"; }
        free() { this.freed = true; }
      }
      const tipOf = async (url) => { if (url.includes("next")) await nextUp; return 4500001; };
      t.setZ({ ...z8, latestHeight: tipOf, ChainWallet: NextWallet });
      t.chain.net = { servers: ["https://lwd.test", "https://next.test"] };
      let engineFreed = false;
      const engineFree = engine.free;
      engine.free = () => { engineFreed = true; };
      const stuck = propose9("stuck");
      assert.equal(t.ui.proposing, true, "Propose is off while the engine works");
      const stuckSaid = await stuck;
      globalThis.setTimeout = realTimeout;
      const WHEN_SYNCED = "Propose again when the wallet is up to date.";
      assert.equal(stuckSaid, "The proposal got no answer in 60 s, so it stopped. " + WHEN_SYNCED);
      assert.equal(t.ui.proposing, false, "Propose works again");
      assert.deepEqual(stallOf(), [engine, null], "the object is stalled");
      // Until a sync connects to the next server, a new proposal waits: the old wallet object
      // would ask the server that stopped answering.
      const RECONNECT = "The light-wallet server stopped answering. " + WHEN_SYNCED;
      assert.equal(t.sendBlocker(), RECONNECT);
      assert.equal(await propose9("again"), RECONNECT, "no proposal on the silent server");
      // Approve does not wait for that sync: it asks the other servers for the chain height.
      const zt = open("zt");
      await approved(me, zt);
      assert.equal(markOf(me, "zt")?.approved, "aa", "the approval after the timeout");
      // With no server of a sync, Approve takes the order of preferredServers: a /lwd that failed
      // comes after ChainSafe. When both failed, /lwd in first place waits 3 s, as in pickServer.
      const LWD = "http://localhost/lwd", CS = "https://zcash-testnet.chainsafe.dev";
      const both = { servers: [LWD, CS] };
      const withTip = (latestHeight) => t.setZ({ ...z8, latestHeight, ChainWallet: NextWallet });
      withTip(async (u) => { if (u === LWD) throw new Error("down"); return 4500001; });
      assert.equal(await t.pickServer(both), CS, "/lwd is marked failed");
      withTip(async (u) => (u === LWD ? new Promise(() => {}) : 4500001));
      const timed = async (id) => {
        const t1 = Date.now();
        await approved(me, open(id));
        return [markOf(me, id)?.approved, Date.now() - t1 < 2000, Date.now() - t1 < 6000];
      };
      assert.deepEqual((await timed("zv9")).slice(0, 2), ["aa", true], "ChainSafe first");
      withTip(async () => { throw new Error("down"); });
      await t.pickServer(both).catch(() => {});   // both are marked failed now
      withTip(async (u) => (u === LWD ? new Promise(() => {}) : 4500001));
      const bothFailed = await timed("zy9");
      assert.deepEqual([bothFailed[0], bothFailed[2]], ["aa", true],
        "both failed: /lwd waits 3 s, not 8");
      // Before the first sync, Approve refuses.
      const balNow = t.chain.bal;
      t.chain.bal = null;
      const early = await quiet(() => t.approve(open("zq9"), me)
        .then(() => "approved", (e) => e.message));
      t.chain.bal = balNow;
      assert.equal(early, "Wait for the first sync to finish, then approve.");
      withTip(tipOf);
      openNext();
      await quiet(async () => {
        await waitFor("the sync on the next server", () => t.chain.url === "https://next.test");
        await sleep(300);
      });
      assert.deepEqual([made, t.sendBlocker() === RECONNECT], [["https://next.test"], false],
        "a new wallet object on the next server, and Propose is free of the stall");
      assert.equal(engineFreed, false, "the engine may still build that proposal: not freed");
      engine.free = engineFree;
      // A sync that cannot make a new wallet object keeps the stall, and Propose stays off.
      t.setZ(z8);   // its ChainWallet throws
      Object.assign(t.chain, { stalled: t.chain.cw, url: null });
      await quiet(() => t.runSync(t.chain));
      assert.equal(t.sendBlocker(), RECONNECT, "no new object: the stall stays");
      Object.assign(t.chain, { stalled: null, url: "https://next.test", error: null });
      // A sync on another server frees the old object when it is not stalled.
      const oldCw = t.chain.cw;
      withTip(async (u) => { if (u.includes("next")) throw new Error("down"); return 4500001; });
      await quiet(async () => { await t.runSync(t.chain); await sleep(200); });
      assert.deepEqual([t.chain.url, oldCw.freed], ["https://lwd.test", true],
        "the old one is freed");
      // syncAgain while a sync runs: one more sync follows it, and only one.
      let openSync, tips = 0;
      const syncHeld = new Promise((ok) => { openSync = ok; });
      withTip(async () => { tips += 1; await syncHeld; return 4500001; });
      const firstSync = quiet(() => t.runSync(t.chain));
      await sleep(50);
      t.syncAgain(t.chain);
      assert.deepEqual([t.chain.syncing, tips], [true, 1], "no second sync while one runs");
      openSync();
      await firstSync;
      await quiet(async () => {
        await waitFor("one more sync", () => tips === 2 && !t.chain.syncing, 3000);
        await sleep(200);
      });
      assert.equal(tips, 2, "one more, and no loop");
      // Approve asks the server of the last sync first, so a server that does not answer, and whose
      // failure is no longer marked, makes it wait no 8 s.
      t.chain.url = "https://zcash-testnet.chainsafe.dev";
      const silentLwd = async (url) => (url.endsWith("/lwd") ? new Promise(() => {}) : 4500001);
      t.setZ({ ...z8, latestHeight: silentLwd });
      const t0 = Date.now();
      await approved(other, open("zu"));
      assert.equal(markOf(other, "zu")?.approved, "aa", "approved");
      assert.ok(Date.now() - t0 < 2000, "no wait on the server that does not answer");
      // The person opened another wallet while its proposal waited: the closed wallet gets no
      // sync after the timeout.
      t.state.sessions = [];
      for (const i of t.localSeats()) await t.putSec(t.state.gid, i, { marks: {} });   // no holds
      Object.assign(t.chain, { cw: engine, url: "https://lwd.test", stalled: null });
      let closedTips = 0;
      withTip(async () => { closedTips += 1; return 4500001; });
      globalThis.setTimeout = (fn, ms, ...a) => realTimeout(fn, ms >= 60000 ? ms / 600 : ms, ...a);
      const closed = propose9("closed");
      const closedChain = t.chain;
      t.setChain({ ...closedChain });   // another chain object is the open one now
      const closedSaid = await closed;
      globalThis.setTimeout = realTimeout;
      await quiet(() => sleep(300));
      assert.deepEqual([closedSaid.slice(0, 26), closedTips], ["The proposal got no answer", 0],
        "no sync of the closed wallet");
      t.setZ(z8);
      t.state.sessions = sessions8;
      for (const [i, marks] of marks8) await t.putSec(t.state.gid, i, { marks });
      const { o8c: _o8c, ...marksMe } = t.sec(t.state.gid, me).marks;
      await t.putSec(t.state.gid, me, { marks: marksMe });
      engine.createSpend = real;
      // M5: the drawer says what the signature step waits for.
      const enough = Object.fromEntries(t.seatIds().slice(0, t.state.g.t).map((i) => [i, {}]));
      const drawn = (ss, shares) => {
        Object.assign(t.state, { commits: enough, shares });
        return textOf(t.sessionLayer(ss));
      };
      assert.match(drawn(open("w5", "PA"), {}),
        /Waiting for the proposer's device to build the signing package/);
      const w5 = { ...open("w5", "PA"), package: "PK", signers: [me, other], status: "signing" };
      assert.match(drawn(w5, { [me]: {} }),
        /Signing · 1 of 2 shares\. Waiting for [^:,]+: each device signs while this wallet/);
      Object.assign(t.state, { commits: {}, shares: {} });
      // ── The approval of a payment to a ZNS name: this browser looks the name up again.
      const znsIds = [];
      const znsPay = (id, name, to = NAMED) => {
        znsIds.push(id);
        return { ...open(id, "PA"), payees: [{ to, amount: 5, name }] };
      };
      {
        const untouched = (sid, seat, why) => {
          const commit = `groups/${t.state.gid}/sessions/${sid}/commits/${seat}`;
          assert.equal(data.has(commit), false, why + ": no approval is published");
          assert.equal((t.sec(t.state.gid, seat).nonces || {})[sid], undefined, why + ": no nonce");
          assert.equal(markOf(seat, sid), undefined, why + ": no mark");
          assert.equal(keptStore.has(`kept:${t.state.gid}:${sid}`), false, why + ": no kept PCZT");
        };
        const refuses = async (ss, seat, message, why) => {
          put(ss);
          await assert.rejects(quiet(() => t.approve(ss, seat)), { message });
          untouched(ss.id, seat, why);
        };
        at(4500000);
        znsServes(znsOk());
        await approved(me, znsPay("n1", "alice"));
        assert.equal(markOf(me, "n1").approved, "aa", "the name still gives the address");
        assert.deepEqual([gets, fetches], [1, 1]);
        // The name moved to another address, or is gone, or is not a name; the copy is behind or
        // cannot be read.
        znsServes(znsOk());
        await refuses(znsPay("n2", "bob"), me, "The ZNS name bob.zec now gives another address "
          + "than this payment, so this browser did not approve.", "moved");
        await refuses(znsPay("n3", "ghost"), me, "The ZNS name ghost.zec has no address in the "
          + "registry now, so this browser did not approve.", "unknown");
        await refuses(znsPay("n4", "Alice.zec"), me, "This payment names an invalid ZNS name, so "
          + "this browser did not approve.", "invalid");
        await refuses(znsPay("n5", ""), me, "This payment names an invalid ZNS name, so this "
          + "browser did not approve.", "empty name");
        znsServes(znsOk(ZNS_NAMES, 4499000));
        await refuses(znsPay("n6", "alice"), me, "The ZNS registry is 1001 blocks behind the "
          + "chain, so this browser did not approve.", "behind");
        znsServes(znsDown);
        await refuses(znsPay("n7", "alice"), me, ZNS_DOWN, "down");
        // The proposal made again (same address, same name): the approver checks the name.
        znsServes(znsOk());
        await approved(third, { ...znsPay("n10", "alice"), payees: againPayees });
        assert.equal(markOf(third, "n10").approved, "aa", "the name still gives the address");
        znsServes(znsOk([znsRec("alice", MOVED)]));
        await refuses({ ...znsPay("n11", "alice"), payees: againPayees }, other, "The ZNS name "
          + "alice.zec now gives another address than this payment, so this browser did not "
          + "approve.", "moved after Propose again");
        // A proposal without names asks no registry.
        znsServes(znsDown);
        const plain = open("n8");
        znsIds.push("n8");
        await approved(other, plain);
        assert.equal(markOf(other, "n8").approved, "aa");
        assert.deepEqual([gets, fetches], [0, 0], "a payment without names asks no registry");
        // A mainnet wallet looks no name up.
        const testnet = t.state.g;
        t.state.g = { ...testnet, network: "mainnet" };
        await refuses(znsPay("n9", "alice"), third, "ZNS names work on testnet only, so this "
          + "browser did not approve.", "mainnet");
        assert.deepEqual([gets, fetches], [0, 0], "a mainnet wallet makes no lookup");
        t.state.g = testnet;
        // The drawer shows the name of a payee and says that this browser checks it again.
        const NOTE = /alice\.zec This browser checks the name again when it approves\./;
        assert.match(drawn(znsPay("d1", "alice"), {}), NOTE);
        assert.doesNotMatch(drawn(open("d2"), {}), /checks the name again/);
        assert.doesNotMatch(drawn(znsPay("d3", "Alice.zec"), {}), /checks the name again/,
          "a name that is not valid is not shown");
        const rc = t.recipientCheck(znsPay("d4", "alice"), { lines: pays5 });
        assert.deepEqual([rc.match, rc.rows[0].name], [true, "alice"]);
        // A testnet wallet downloads the registry once when it opens. A mainnet wallet makes no
        // call. Drawing the page again asks nothing, and a failed download is ignored.
        const syncing = t.chain;
        znsServes(znsDown);
        t.setChain(null);
        t.ensureChain();
        await quiet(() => sleep(20));
        assert.deepEqual([gets, fetches], [1, 1], "the wallet opens: one download");
        t.ensureChain();
        t.ensureChain();
        assert.equal(gets, 1, "no call for each draw");
        t.setChain(null);
        t.state.g = { ...testnet, network: "mainnet" };
        t.ensureChain();
        await quiet(() => sleep(20));
        assert.equal(gets, 1, "a mainnet wallet makes no call");
        t.state.g = testnet;
        t.setChain(syncing);
        registry.get = pageGet;
      }
      const mine = new Set([...znsIds, "za", "zh", "zs", "zp", "zw", "zf", "zn", "zx", "zl", "zm",
        "zr", "zq",
        "zv", "zy", "zu", "zt", "zk", "zj", "zg", "zz", "zal", "zho", "zc1", "zc2", "h1", "h4",
        "h5", "h5b", "h7", "h10", "s7", "s7h", "s7q", "s7p", "s7n", "s7s", "s7o", "s7m", "s7c",
        "s7w", "s7d", "s7f"]);
      t.state.sessions = t.state.sessions.filter((x) => !mine.has(x.id));
      t.state.g = group;
      t.setZ(fakeZ);
      t.setIdb(idbBefore);
    }

    for (const id of [W2, M]) {
      delete t.secrets[`${id}:1`]; delete t.ready[id]; delete t.balCache[id];
    }
    t.state.groups = [];
    t.ui.request = null;
  } finally { globalThis.document = realDocument; }
}

// ── A stored field must be plain JSON: no infinite number, no deep nesting ──
{
  const G = "cccccccccccccccccccc", path = `groups/${G}/sessions/x`;
  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  t.gkeys = { ...t.gkeys, [G]: key };
  const seal = (k, text) => Z.secretSeal(key, path + "\n" + k, text);
  let deep = "0";
  for (let i = 0; i < 7000; i++) deep = "[" + deep + "]";
  const doc = t.openDoc(path, {
    note: seal("note", '"fine"'), move: seal("move", "-1e999"), list: seal("list", "[1,-1e999]"),
    deep: seal("deep", deep), at: seal("at", "1760000000000"),
  });
  assert.deepEqual(doc, { note: "fine", at: 1760000000000 }, "bad fields are dropped");
}

// ── Memos of received payments: opt in, and a run that no failed read can stall ──
{
  const G = "dddddddddddddddddddd";
  const tx = (k) => ({ txid: "t" + k, hash: "h" + k, height: 500 + k });
  let fetched, attached, settled;
  // `plan` says what happens to the transaction "t<k>": "net" fails to fetch, "bad" is refused by
  // the engine, anything else gives its memo.
  const wallet = (ids, plan) => ({
    memoNeeds: () => JSON.stringify(ids.map(tx)),
    attachTransaction(id) {
      attached.push(id);
      if (plan[id] === "bad") throw new Error("the server sent another transaction");
      settled++;
      return JSON.stringify({ attached: 1 });
    },
    received: () => JSON.stringify([{ txid: "t1", memo_pending: false }]),
    snapshot: () => "{}", free() {},
  });
  const run = async (ids, plan, { on = true, mid } = {}) => {
    [fetched, attached, settled] = [[], [], 0];
    t.setZ({ ...Z, fetchTransaction: async (url, hash) => {
      fetched.push(hash);
      if (plan["t" + hash.slice(1)] === "net") throw new Error("no answer");
      if (mid) mid(c);
      return "AAAA";
    } });
    const c = { gid: G, url: "https://lwd.test", cw: wallet(ids, plan), received: [] };
    t.state.log.length = 0;
    t.setChain(null);   // turning reading on starts a run of the open wallet; there is none yet
    t.setMemoReading(G, on);
    t.setChain(c);
    await t.runMemos(c);
    return c;
  };
  // Off by default: the server is never asked.
  await run([1, 2], {}, { on: false });
  assert.deepEqual([t.readsMemos(G), fetched], [false, []], "reading is opt in");
  // One transaction fails to fetch, one is refused by the engine, one works.
  let c = await run([1, 2, 3], { t1: "net", t2: "bad" });
  assert.deepEqual([fetched, attached, settled], [["h1", "h2", "h3"], ["t2", "t3"], 1]);
  assert.deepEqual(c.received, [{ txid: "t1", memo_pending: false }], "a read updates the list");
  // The engine refuses every answer: all are tried, because the server did answer.
  await run([1, 2, 3, 4, 5], { t1: "bad", t2: "bad", t3: "bad", t4: "bad", t5: "bad" });
  assert.equal(fetched.length, 5, "refused answers do not end the run");
  // The server does not answer three times in a row: the run ends there.
  await run([1, 2, 3, 4, 5], { t1: "net", t2: "net", t3: "net" });
  assert.deepEqual(fetched, ["h1", "h2", "h3"], "three failures to fetch end the run");
  // A success in between resets the count.
  await run([1, 2, 3, 4, 5, 6, 7], { t1: "net", t2: "net", t4: "net", t5: "net", t6: "net" });
  assert.equal(fetched.length, 6, "the success reset the count, so the run ends after t6");
  // Another wallet replaces this one while the first read waits: the run stops at once.
  const c2 = await run([1, 2, 3], {}, { mid: () => { t.setChain({ gid: G }); } });
  assert.deepEqual([fetched, attached, c2.received], [["h1"], [], []], "a stale run is dropped");
  // The signer turns reading off while the first read waits: no further request goes out.
  await run([1, 2, 3], {}, { mid: () => { t.setMemoReading(G, false); } });
  assert.deepEqual([fetched, attached], [["h1"], []], "turning reading off stops the run");
  // A proposal stalls while the first read waits, so dropStalled clears the server: the run keeps
  // the memo it read and ends without an "Invalid URL" for each other transaction.
  const c3 = await run([1, 2, 3], {}, { mid: (at) => { at.url = null; } });
  assert.deepEqual([fetched, attached, c3.received.length], [["h1"], ["t1"], 1]);
  const tried = t.state.log.find((l) => /Invalid URL|memo of/.test(l));
  assert.equal(tried, undefined, "no read goes out without a server");
}

// ── A reorganisation deeper than the wallet can undo: the saved state goes ──
{
  const G = "eeeeeeeeeeeeeeeeeeee";
  // The engine's own words (wasm/src/chain.rs). The engine tells the page whether it matches.
  const deep = "the chain reorganised by more than 100 blocks. "
    + "Scan the wallet again from its birthday.";
  assert.equal(Z.isDeepReorg(deep), true, "the page asks the engine, which knows its words");
  assert.equal(Z.isDeepReorg("lightwalletd: unavailable"), false);
  const sync = (message) => {
    let freed = 0;
    class Failing {
      async sync() { throw new Error(message); }
      free() { freed++; }
    }
    t.setZ({ ...Z, latestHeight: async () => 1000, ChainWallet: Failing });
    const c = { gid: G, net: { servers: ["https://lwd.test"] }, ufvk: "u", birthday: 5,
      cw: null, bal: { height: 9 }, received: [{}], sent: new Set(["x"]), prog: null };
    return t.runSync(c).then(() => [c, () => freed]);
  };
  const [lost] = await sync(deep);
  assert.match(lost.error, /deleted the saved state/);
  assert.deepEqual([lost.cw, lost.bal, lost.received, lost.sent.size], [null, null, [], 0]);
  const [kept] = await sync("lightwalletd: unavailable");
  assert.equal(kept.error, "lightwalletd: unavailable");
  assert.deepEqual([kept.cw !== null, kept.bal.height], [true, 9], "another error keeps the state");
  // S9: a broadcast starts at the servers that did not fail in the last 5 minutes.
  const tried = [];
  class Recorder {
    constructor(ufvk, birthday, url) { tried.push(url); }
    async broadcast() { return JSON.stringify({ txid: "t9" }); }
    free() {}
  }
  const down = async (url) => { if (url.includes("a9")) throw new Error("down"); return 1; };
  t.setZ({ ...Z, latestHeight: down, ChainWallet: Recorder });
  const where = (net) => ({ net, ufvk: "u", birthday: 1 });
  const fresh = { servers: ["https://a8.test", "https://b8.test"] };
  await t.broadcastAnywhere("00", where(fresh));
  assert.deepEqual(tried, ["https://a8.test"], "control: the configured order");
  const net9 = { servers: ["https://a9.test", "https://b9.test"] };
  assert.equal(await t.pickServer(net9), "https://b9.test");
  tried.length = 0;
  assert.equal((await t.broadcastAnywhere("00", where(net9))).txid, "t9");
  assert.deepEqual(tried, ["https://b9.test"], "the server that failed is not asked first");
}


// The inbox of a wallet that is not open: a part of a seat that this device has not pinned waits
// for good. It stays out, and the payment is not "checking", so a forged part hides no proposal.
{
  const W = "cd".repeat(10), SID = "ab12cd34ef56ab12cd34";
  const k1 = await newSignKey(), k2 = await newSignKey();
  const made = { pool: "ironwood", amount: 5, change: 1, fee: 10000, note_value: 20, pczt: "AAA" };
  const fields = t.proposalFields([{ to: "utest1x", amount: 5 }], "", made, null, 1760000000000);
  const proposal = await sealed(W, "sessions/" + SID, 1, fields, k1);
  const pins = { [W + ":1"]: k1.signPk, [W + ":2"]: k2.signPk, ["version:" + W]: "3" };
  Object.assign(t.signPins, pins);
  t.secrets[W + ":2"] = { version: 3, ...k2, keyPackage: "kp" };
  const groupsBefore = t.state.groups;
  t.state.groups = [...groupsBefore,
    t.cleanGroup(W, { name: "W", n: 3, t: 2, version: 3, network: "testnet" })];
  const listed = async (extra) => {
    t.rawInbox[W] = [{ id: SID, ...proposal, status: "collecting", ...extra }];
    t.refilter();
    await sleep(300);
    const ss = t.inbox[W]?.find((x) => x.id === SID);
    return [ss?.checking, ss?.status, t.toApprove(W).length];
  };
  assert.deepEqual(await listed({}), [false, "collecting", 1], "control");
  const forged = { cancelBy: 3, cancelSig: "AAAA", error: "x", status: "cancelled" };
  assert.deepEqual(await listed(forged), [false, "collecting", 1],
    "a part of a seat that is not pinned hides nothing");
  // A cancel of a pinned seat whose check has no result yet: the payment is "checking".
  const cancelW = await t.sigPart(W, SID, "cancel", { error: "Cancelled." }, 2);
  const subtleW = globalThis.crypto.subtle, verifyW = subtleW.verify.bind(subtleW);
  let openW;
  const heldW = new Promise((ok) => { openW = ok; });
  subtleW.verify = (...a) => heldW.then(() => verifyW(...a));
  const cancelled = { error: "Cancelled.", status: "cancelled", ...cancelW };
  assert.deepEqual(await listed(cancelled), [true, "collecting", 0], "a pinned seat: checking");
  openW();
  delete subtleW.verify;
  assert.deepEqual(await listed(cancelled), [false, "cancelled", 0], "then cancelled");
  delete t.rawInbox[W];
  delete t.inbox[W];
  delete t.secrets[W + ":2"];
  for (const k of Object.keys(pins)) delete t.signPins[k];
  t.state.groups = groupsBefore;
  t.refilter();
}

// ── The personal account: storage, sync, sending, funding, backup and restore ──
{
  const storageText = () => JSON.stringify([...storage]);
  // There is no IndexedDB here: the page's `idb` helper gets a map and the same request shape.
  const idbMap = new Map(), idbFail = { put: false }, idbHide = new Set();
  const store = {
    get: (k) => ({ result: idbHide.has(k) ? undefined : idbMap.get(k) }),
    put: (v, k) => {
      if (idbFail.put && k === "personal:rec") throw new Error("disk full");
      idbMap.set(k, v);
      return { result: k };
    },
    add: (v, k) => {
      if (idbMap.has(k)) throw new Error("ConstraintError");
      if (idbFail.put && k === "personal:rec") throw new Error("disk full");
      idbMap.set(k, v);
      return { result: k };
    },
    delete: (k) => { idbMap.delete(k); return { result: undefined }; },
  };
  globalThis.indexedDB = {};   // only its presence counts: the helper below is the stand-in
  const realIdb = t.getIdb(), fakeIdb = async (mode, fn) => fn(store).result;
  t.setIdb(fakeIdb);
  const feeOf = (parts) => 5000 * Math.max(2, parts + 1);
  // The light-wallet server and the proof are fixed answers. The calls are recorded.
  const net = {
    bal: { height: 4500100, tip: 4500100, spendable: 300000, pending: 0, notes: 3, max_send: 1 },
    received: [], sentIds: [], created: [], broadcast: [], opened: [], signed: [], n: 0,
    broadcastError: "", broadcastBy: {}, needs: [], fetched: [], attached: [], freed: 0,
  };
  class Wallet {
    constructor(ufvk, birthday, url) { net.opened.push([ufvk, birthday, url]); this.url = url; }
    async sync() { return JSON.stringify(net.bal); }
    balance() { return JSON.stringify(net.bal); }
    received() { return JSON.stringify(net.received); }
    sent() { return JSON.stringify(net.sentIds); }
    snapshot() { return "{}"; }
    memoNeeds() { return JSON.stringify(net.needs); }
    attachTransaction(txid) {
      net.attached.push(txid);
      net.needs = net.needs.filter((n) => n.txid !== txid);
      return JSON.stringify({ attached: 1 });
    }
    async createMessage(to, text) {
      net.created.push([to, text]);
      const parts = JSON.parse(Z.splitMessage(text)).length, fee = feeOf(parts);
      return JSON.stringify({ pczt: "P" + net.created.length, pool: "ironwood", fee, parts,
        note_value: 100000, change: 100000 - fee });
    }
    async broadcast(hex) {
      const said = net.broadcastBy[this.url] ?? net.broadcastError;
      if (said) throw new Error(said);
      net.broadcast.push(hex);
      return JSON.stringify({ txid: "ok" });
    }
    free() { net.freed++; }
  }
  const Zp = { ...Z, latestHeight: async () => 4500000, ChainWallet: Wallet,
    fetchTransaction: async (url, hash) => { net.fetched.push(hash); return "RAW"; },
    accountSign: (pczt, seed, network) => {
      net.signed.push([pczt, seed, network]);
      return JSON.stringify({ signed_pczt: "S:" + pczt });
    },
    finalize: (pczt) => JSON.stringify({ tx_hex: "hex:" + pczt, txid: "TX" + (++net.n), size: 3,
      version: "V6" }) };
  t.setZ(Zp);

  // The page opens at once. The saved account loads beside it, also when IndexedDB never answers,
  // and an open that did not answer is tried again at the next call.
  const asked = [], opens = [];
  globalThis.zigs = { use: async (name) => { asked.push(name); return null; } };
  globalThis.indexedDB = { open: () => { opens.push(1); return {}; } };
  t.setIdb(realIdb);
  t.setIdbMs(40);
  t.startUp();
  assert.deepEqual([asked.length, t.personalPending], [3, true], "boot does not wait for the read");
  await waitFor("the saved account read ends", () => !t.personalPending);
  assert.deepEqual([t.personal, t.personalError], [null, ""], "a hung store blocks nothing");
  await t.rereadPersonal();
  assert.equal(opens.length, 2, "a failed open is forgotten");
  // The error event of a request reaches the transaction before tx.error is set, and a commit can
  // abort. The helper rejects with an Error in both cases, so the callers can name it.
  const txs = [], fakeDb = { transaction: () => {
    const tx = { error: null, objectStore: () => ({ add: () => ({}) }) };
    txs.push(tx);
    return tx;
  } };
  globalThis.indexedDB = { open: () => {
    const r = {};
    setTimeout(() => { r.result = fakeDb; r.onsuccess(); });
    return r;
  } };
  const conflict = realIdb("readwrite", (st) => st.add(1, "personal:rec"));
  await waitFor("a transaction", () => txs.length === 1);
  txs[0].onerror({ target: { error: new Error("ConstraintError") } });
  await assert.rejects(conflict, /ConstraintError/);
  const quota = realIdb("readwrite", (st) => st.add(1, "x"));
  await waitFor("a second transaction", () => txs.length === 2);
  txs[1].error = new Error("QuotaExceededError");
  txs[1].onabort();
  await assert.rejects(quota, /QuotaExceededError/);
  globalThis.indexedDB = {};
  t.setIdb(fakeIdb);
  delete globalThis.zigs;

  // A store that fails as a whole knows no account. It does not block the lock or a new account,
  // but an account that this page saw stays safe from a lock that would leave it out.
  t.setIdb(async () => { throw new Error("blocked by the browser"); });
  await t.rereadPersonal();
  assert.deepEqual([t.personal, t.personalError], [null, ""]);
  await t.takeDeviceAccount();
  await assert.rejects(t.createPersonal("testnet"), /could not save the account/);
  t.personal = { seed: "kept" };
  await assert.rejects(t.takeDeviceAccount(), /did not lock/);
  t.personal = null;
  t.setIdb(fakeIdb);

  const synced = () => waitFor("account sync", () => t.acct && t.acct.bal && !t.acct.syncing);
  const copied = [];
  // The passkey is a fixed 32-byte secret here; Web Locks are added by the tests that need them.
  const nav = {
    clipboard: { writeText: async (x) => { copied.push(x); } },
    credentials: {
      create: async () => ({ rawId: new Uint8Array(16).fill(1),
        getClientExtensionResults: () => ({ prf: { enabled: true } }) }),
      get: async () => ({ getClientExtensionResults: () =>
        ({ prf: { results: { first: new Uint8Array(32).fill(7) } } }) }),
    },
  };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: nav });
  const downloaded = [];
  t.setDownloads({ save: async (file) => { downloaded.push(file); } });

  // Create. A mainnet account needs the confirmation, and a failed save leaves nothing.
  await assert.rejects(t.createPersonal("mainnet"), /Confirm that you understand/);
  idbFail.put = true;
  await assert.rejects(t.createPersonal("testnet"), /could not save the account/);
  assert.deepEqual([t.personal, t.acct, [...idbMap.keys()].includes("personal:rec")],
    [null, null, false], "a failed save makes no account");
  idbFail.put = false;
  // The server answers the server check, then stops answering until the test lets it: the
  // birthday is that answer, so Create account does not wait for a second one.
  let heights = 0, letHeights, accountMade = false;
  const heldHeight = new Promise((r) => { letHeights = () => r(4500000); });
  t.setZ({ ...Zp, latestHeight: () => (heights++ ? heldHeight : Promise.resolve(4500000)) });
  const making = t.createPersonal("testnet").then(() => { accountMade = true; });
  await waitFor("Create account with one height", () => accountMade, 5000);
  t.setZ(Zp);
  letHeights();
  await making;
  const seed = t.personal.seed, keys = JSON.parse(Z.accountKeys(seed, "testnet"));
  assert.match(seed, /^[0-9a-f]{64}$/);
  assert.deepEqual([t.personal.network, t.personal.birthday, t.personal.contacts,
    t.personal.backedUp], ["testnet", 4500000, [], false]);
  await synced();
  assert.deepEqual([t.acct.address, t.acct.ufvk], [keys.address, keys.ufvk]);
  assert.deepEqual([net.opened[0][0], net.opened[0][1]], [keys.ufvk, 4500000],
    "it syncs by the viewing key, from the birthday");
  assert.equal(t.acct.account, true);
  await assert.rejects(t.createPersonal("testnet"), /personal account already/);

  // The seed is not in local storage, the sealed record, a log line or the view state.
  const hygiene = (what) => {
    const sealedRec = JSON.stringify([...idbMap.entries()]
      .map(([k, v]) => [k, v instanceof CryptoKey ? "key" : v]));
    for (const hay of [storageText(), sealedRec, t.state.log.join("\n"), JSON.stringify(t.ui),
      t.banner ? t.banner.text : ""]) assert.equal(hay.includes(seed), false, what);
  };
  hygiene("after create");
  assert.deepEqual([...idbMap.keys()].sort().filter((k) => k.startsWith("personal")),
    ["personal", "personal:key", "personal:rec"], "the key, the record and the sync state");
  assert.equal(idbMap.get("personal:key").extractable, false, "the device key cannot be exported");

  // A reload reads the account again. A changed record is not read, and blocks a new account.
  const saved = t.personal;
  t.personal = null;
  await t.rereadPersonal();
  assert.deepEqual(t.personal, saved, "the sealed record gives the same account");
  const rec = idbMap.get("personal:rec");
  const tampered = rec.box.startsWith("A") ? "B" + rec.box.slice(1) : "A" + rec.box.slice(1);
  idbMap.set("personal:rec", { ...rec, box: tampered });
  t.personal = null;
  await t.rereadPersonal();
  assert.equal(t.personal, null);
  assert.match(t.personalError, /could not read the saved personal account/);
  await assert.rejects(t.createPersonal("testnet"), /Do not make a new account yet/);
  assert.equal(idbMap.get("personal:rec").box, tampered, "nothing overwrote it");
  idbMap.set("personal:rec", rec);
  await t.rereadPersonal();
  assert.deepEqual([t.personalError, t.personal.seed], ["", seed]);

  // Another tab made the account while this tab still shows the Create card: this tab adopts it.
  const alt = JSON.parse(Z.accountNew("testnet"));
  const strangers = { kind: "personal", version: 1, network: "testnet", seed: alt.seed,
    birthday: 1, contacts: [] };
  const first = idbMap.get("personal:rec");
  t.personal = null;
  await assert.rejects(t.createPersonal("testnet"), /personal account already/);
  assert.equal(t.personal.seed, seed, "the saved account is the account of this tab now");
  t.personal = null;
  await assert.rejects(t.restoreAccount(strangers, true), /personal account already/);
  assert.equal(t.personal.seed, seed);
  assert.equal(idbMap.get("personal:rec"), first, "nothing wrote over the saved account");
  // A read that misses it does not help: the store refuses a second account.
  idbHide.add("personal:rec");
  t.personal = null;
  await assert.rejects(t.createPersonal("testnet"), /could not save the account/);
  t.personal = null;
  await assert.rejects(t.restoreAccount(strangers, true), /could not save the restored account/);
  idbHide.delete("personal:rec");
  assert.equal(idbMap.get("personal:rec"), first, "the store refused the write over it");
  await t.rereadPersonal();
  assert.equal(t.personal.seed, seed);
  // The reads miss the saved account and the store refuses the write: the page reads once more
  // and takes the saved account.
  const realAdd = store.add;
  idbHide.add("personal:rec");
  store.add = (v, k) => { idbHide.delete("personal:rec"); return realAdd(v, k); };
  t.personal = null;
  await assert.rejects(t.createPersonal("testnet"), /personal account already/);
  store.add = realAdd;
  assert.equal(t.personal.seed, seed, "the page took the saved account after the refused write");
  assert.equal(idbMap.get("personal:rec"), first);
  assert.equal(t.acct.address, keys.address, "the account of this tab did not change");

  // The account reads memos by itself, and the sync is not dropped as a stale run.
  assert.equal(t.readsMemos("personal"), false, "no memo switch for the account");
  net.needs = [{ txid: "M1", hash: "h1", height: 4500050 }];
  await runAcctSync();
  await waitFor("the memo read", () => net.attached.length === 1);
  assert.deepEqual([net.fetched, net.attached], [["h1"], ["M1"]]);
  assert.equal(net.freed, 0, "the wallet of the account stays while the account is current");

  // Contacts: the next index, the rules, and a save that comes before the answer.
  const other = JSON.parse(Z.accountNew("testnet")), at = (k) => Z.addressAt(other.ufvk, k);
  await assert.rejects(t.addPersonalContact("Ana", keys.address), /address of your own account/);
  await assert.rejects(t.addPersonalContact("Ana", "nope"), /Enter a shielded Zcash testnet/);
  const ana = await t.addPersonalContact("Ana", at(0));
  const ben = await t.addPersonalContact("Ben", at(1));
  assert.deepEqual([ana.index, ben.index], [1, 2]);
  await assert.rejects(t.addPersonalContact("Cy", at(0)), /already a contact: Ana/);
  await assert.rejects(t.addPersonalContact("ana", at(2)), /name already/);
  await assert.rejects(t.addPersonalContact("Cy", t.addressFor(1)),
    /address of your own account/, "the address that was made for a contact is not a contact");
  const stored = await t.deviceRead();
  assert.deepEqual(stored.contacts.map((c) => [c.name, c.index]), [["Ana", 1], ["Ben", 2]],
    "the contacts are in the saved record");
  idbFail.put = true;
  await assert.rejects(t.addPersonalContact("Cy", at(2)), /Could not save this change/);
  idbFail.put = false;
  assert.equal(t.personal.contacts.length, 2, "a change that was not saved is undone");
  assert.notEqual(t.addressFor(1), t.addressFor(2));
  assert.equal(t.addressFor(0), keys.address);
  assert.equal(t.addressFor(1), Z.addressAt(keys.ufvk, 1), "the address for a contact");

  // The balance and the gate.
  assert.equal(t.acctBalance().total, 300000);
  assert.equal(t.messageWhy(), "");
  assert.equal(t.messageWhy(2e6).length > 0, true);

  // Send: build, sign, prove, save, and only then broadcast. The seed signs on this thread.
  const sentAfter = async (text, contact = ana) => {
    await t.sendOnChain(contact, text);
    return t.personal.sent.at(-1);
  };
  let one = await sentAfter("hello Ana");
  assert.deepEqual(net.created.at(-1), [ana.address, "hello Ana"]);
  assert.deepEqual(net.signed.at(-1), ["P1", seed, "testnet"]);
  assert.deepEqual(net.broadcast, ["hex:S:P1"], "the signed, proved transaction goes out");
  assert.deepEqual([one.txid, one.to, one.text, one.fee, one.parts, one.broadcast, one.failed],
    ["TX1", 1, "hello Ana", 10000, 1, true, ""]);
  assert.equal(one.tip, 4500100);
  assert.equal(t.sentStateOf(one), "sending", "no block holds it yet");
  assert.match(t.messageWhy(), /waiting for its block/, "one message at a time");
  assert.deepEqual(t.acctBalance(), { spendable: 200000, pending: 90000, total: 290000 },
    "the spent note leaves the balance, the change is incoming");
  assert.equal((await t.deviceRead()).sent.length, 1, "the text is saved sealed with its txid");
  await assert.rejects(t.sendOnChain(ana, "again"), /waiting for its block/);
  assert.equal(net.created.length, 1, "a refused message builds nothing");
  net.sentIds = ["TX1"];
  await runAcctSync();
  assert.equal(t.sentStateOf(one), "chain");
  assert.equal(t.messageWhy(), "", "after its block, the next message can go");
  // A block keeps its time between syncs: the count starts at the end of the last sync.
  const h = t.acct.bal.height - 4, realNow = Date.now;
  const firstTime = t.blockTime(h);
  Date.now = () => realNow() + 600000;
  try { assert.equal(t.blockTime(h), firstTime, "ten minutes later, the same time"); }
  finally { Date.now = realNow; }

  // A broadcast that a node refuses: marked, the composer is free, nothing is left waiting. Only
  // the engine's words for a refusal count (isNodeRefusal).
  net.broadcastError = "node rejected the transaction: bad-txns";
  await assert.rejects(t.sendOnChain(ana, "second"),
    /The message was not sent: .*node rejected the transaction: bad-txns/);
  const refused = t.personal.sent.at(-1);
  assert.deepEqual([refused.failed.includes("bad-txns"), refused.broadcast,
    t.sentStateOf(refused)], [true, false, "failed"]);
  assert.equal(t.messageWhy(), "");
  assert.equal(t.flightNow().length, 0, "a refused message holds no note");
  net.broadcastError = "";

  // A save that fails stops the send before the broadcast.
  const out = net.broadcast.length;
  idbFail.put = true;
  await assert.rejects(t.sendOnChain(ana, "third"), /Could not save this change/);
  idbFail.put = false;
  assert.deepEqual([net.broadcast.length, t.personal.sent.length], [out, 2],
    "no broadcast without a saved record");
  assert.equal(t.acct.progress, "");

  // A record that was saved but never confirmed as sent (the page closed, or the save of the
  // answer failed) may be on the network. It holds its note like a sent one, until it expires.
  t.personal.sent.push({ txid: "TXQ", to: 1, text: "q", at: 1, tip: 4500100, fee: 1, parts: 1,
    note_value: 1, change: 1, broadcast: false, failed: "" });
  assert.equal(t.sentStateOf(t.personal.sent.at(-1)), "unsure");
  assert.equal(t.flightNow().length, 1, "an unconfirmed message holds its note");
  assert.match(t.messageWhy(), /waiting for its block/);
  t.personal.sent.push({ txid: "TXE", to: 1, text: "e", at: 1, tip: 4500100, fee: 1, parts: 1,
    note_value: 1, change: 1, broadcast: true, failed: "" });
  assert.equal(t.sentStateOf(t.personal.sent.at(-1)), "sending");
  assert.equal(t.flightNow().length, 2);
  t.acct.bal = { ...t.acct.bal, height: 4500100 + 44 };
  assert.deepEqual(t.personal.sent.slice(-2).map(t.sentStateOf), ["expired", "expired"]);
  assert.equal(t.flightNow().length, 0, "an expired message frees the account");
  t.acct.bal = net.bal;
  t.personal.sent.length = 2;

  // A broadcast that gets no answer may have reached the node. The message holds its note until a
  // block holds it or it expires, so the next message cannot spend the same note. Only a node that
  // answered with a refusal frees the note, on every server.
  const lost = async (said, by = {}) => {
    net.broadcastError = said;
    net.broadcastBy = by;
    await assert.rejects(t.sendOnChain(ana, "maybe"), /may not have been sent/);
    net.broadcastError = "";
    net.broadcastBy = {};
    const rec = t.personal.sent.at(-1);
    assert.deepEqual([rec.failed, rec.broadcast, t.sentStateOf(rec)], ["", false, "unsure"]);
    assert.equal(t.flightNow().length, 1, "its note stays held");
    assert.deepEqual(t.acctBalance(), { spendable: 200000, pending: 90000, total: 290000 });
    assert.match(t.messageWhy(), /waiting for its block/);
    const built = net.created.length;
    await assert.rejects(t.sendOnChain(ana, "again"), /waiting for its block/);
    assert.equal(net.created.length, built, "no second message from the same note");
    t.acct.bal = { ...net.bal, height: 4500100 + 44 };
    assert.equal(t.flightNow().length, 0, "it frees the note when it expires");
    assert.equal(t.sentStateOf(rec), "expired");
    t.acct.bal = net.bal;
    net.sentIds.push(rec.txid);
    await runAcctSync();
    assert.deepEqual([t.sentStateOf(rec), t.flightNow().length], ["chain", 0],
      "a block settles it");
  };
  await lost("app.zigs.app did not answer in 16 s");
  await lost("lightwalletd: unavailable");
  const servers = [location.origin + "/lwd", "https://zcash-testnet.chainsafe.dev"];
  const refuse = "node rejected the transaction: bad-txns";
  await lost("", { [servers[0]]: refuse, [servers[1]]: "chainsafe did not answer in 16 s" });
  await lost("", { [servers[0]]: "lightwalletd: node rejected the transaction: forged",
    [servers[1]]: refuse });
  net.broadcastBy = { [servers[0]]: refuse, [servers[1]]: refuse };
  await assert.rejects(t.sendOnChain(ana, "refused twice"), /The message was not sent/);
  net.broadcastBy = {};
  assert.equal(t.sentStateOf(t.personal.sent.at(-1)), "failed", "every server refused it");
  assert.equal(t.flightNow().length, 0);

  // A longer message costs more, and the split error comes before any work.
  one = await sentAfter("x".repeat(1200), ben);
  assert.deepEqual([one.parts, one.fee, one.to], [3, 20000, 2]);
  net.sentIds.push(one.txid);
  await runAcctSync();
  const made = net.created.length;
  await assert.rejects(t.sendOnChain(ana, "a".repeat(2001)), /2001 characters/);
  await assert.rejects(t.sendOnChain(ana, "é".repeat(1266)), /more than 5 parts/);
  assert.equal(net.created.length, made);
  net.bal = { ...net.bal, spendable: 9000, pending: 0 };
  await runAcctSync();
  assert.match(t.messageWhy(), /does not cover the network fee/);
  await assert.rejects(t.sendOnChain(ana, "poor"), /does not cover the network fee/);
  net.bal = { ...net.bal, spendable: 300000 };
  await runAcctSync();
  hygiene("after sending");

  // Two changes at once never overwrite each other: the second reads what the first saved, so
  // the two contacts get two indexes.
  const known = t.personal.contacts.length;
  const pair = await Promise.all([t.addPersonalContact("Pia", at(5)),
    t.addPersonalContact("Quin", at(6))]);
  assert.notEqual(pair[0].index, pair[1].index);
  assert.deepEqual((await t.deviceRead()).contacts.slice(known).map((c) => c.name).sort(),
    ["Pia", "Quin"], "both contacts are saved");
  await t.changePersonal((p) => { p.contacts.length = known; });

  // Two tabs without the lock: tab B has not read the record that tab A saved. It reads the saved
  // account before it builds, and one message goes at a time, also across tabs (Web Locks).
  const tails = new Map(), asked2 = [];
  nav.locks = { request: (name, fn) => {
    asked2.push(name);
    const run = (tails.get(name) || Promise.resolve()).then(fn);
    tails.set(name, run.catch(() => {}));
    return run;
  } };
  const tabB = structuredClone(t.personal);
  const fromA = await sentAfter("from tab A", ana);
  assert.deepEqual([...new Set(asked2)].sort(), ["zigs-account", "zigs-send"],
    "a send and a change each take their own lock, so the send cannot wait for itself");
  t.personal = tabB;
  const madeByA = net.created.length;
  await assert.rejects(t.sendOnChain(ben, "from tab B"), /waiting for its block/);
  assert.equal(net.created.length, madeByA, "tab B builds nothing from the note of tab A");
  assert.equal(t.personal.sent.some((r) => r.txid === fromA.txid), true, "tab B reads the record");
  // Both at once: the second waits for the first, then sees its record.
  net.sentIds.push(fromA.txid);
  await runAcctSync();
  const both = await Promise.allSettled([t.sendOnChain(ana, "one"), t.sendOnChain(ben, "two")]);
  assert.deepEqual(both.map((r) => r.status), ["fulfilled", "rejected"]);
  assert.match(both[1].reason.message, /waiting for its block/);
  net.sentIds.push(t.personal.sent.at(-1).txid);
  await runAcctSync();
  delete nav.locks;
  assert.equal(t.messageWhy(), "");

  // The server does not answer a message: it stops after 60 s, so the lock of the send, which the
  // sends of every tab wait for, comes free. Until a sync connects to the next server, a message
  // would wait on the same server, so the composer says why and builds nothing. `during` runs
  // while the engine builds the message.
  const realTimeout = globalThis.setTimeout, buildMessage = Wallet.prototype.createMessage;
  const scaleTimers = () => {
    globalThis.setTimeout = (fn, ms, ...a) => realTimeout(fn, ms >= 60000 ? ms / 600 : ms, ...a);
  };
  const silentSend = async (text, during = () => {}) => {
    let stopped = null;
    scaleTimers();
    Wallet.prototype.createMessage = function (to, words) {
      net.created.push([to, words]);
      during();
      return new Promise(() => {});
    };
    try {
      t.sendOnChain(ana, text).catch((e) => { stopped = e; });
      await waitFor("the silent message stops", () => stopped, 5000);
    } finally {
      globalThis.setTimeout = realTimeout;
      Wallet.prototype.createMessage = buildMessage;
    }
    return stopped.message;
  };
  let letSync;
  const syncHeld = new Promise((r) => { letSync = () => r(4500000); });
  const silentCw = t.acct.cw, freedBefore = net.freed, builtBefore = net.created.length;
  t.setZ({ ...Zp, latestHeight: () => syncHeld });
  assert.match(await silentSend("silent"),
    /^The message got no answer in 60 s, so it stopped. Send it again/);
  assert.match(t.messageWhy(), /^The light-wallet server stopped answering. Wait until/);
  await assert.rejects(t.sendOnChain(ana, "too soon"), /stopped answering/, "the lock is free");
  assert.equal(net.created.length, builtBefore + 1, "nothing is built on the stalled object");
  assert.equal(t.acct.syncing, true, "a sync on the next server started at once");
  letSync();
  await synced();
  t.setZ(Zp);
  assert.notEqual(t.acct.cw, silentCw, "the sync made a new wallet object");
  assert.equal(net.freed, freedBefore, "the engine may still use the stalled object: not freed");
  assert.equal(t.messageWhy(), "", "the next message can go");
  // A sync replaced the wallet object while the message waited: the new object is not stalled,
  // and no sync starts.
  const liveCw = t.acct.cw, openedBefore = net.opened.length;
  await silentSend("replaced", () => { t.acct.cw = Object.create(Wallet.prototype); });
  await waitFor("no sync", () => !t.acct.syncing);
  assert.deepEqual([t.acct.stalled, t.messageWhy(), net.opened.length], [null, "", openedBefore]);
  t.acct.cw = liveCw;
  // Another tab replaced the account while the message waited: the old account gets no sync.
  await silentSend("account replaced", () => { t.setAcct({ ...t.acct, progress: "" }); });
  await waitFor("no sync", () => !t.acct.syncing);
  assert.deepEqual([net.opened.length, net.freed, t.messageWhy()],
    [openedBefore, freedBefore, ""], "the old account is dropped, the new one sends");
  // The message stops while a sync of the same object runs: one more sync follows that sync, and
  // it connects to the next server.
  const realSync = Wallet.prototype.sync;
  let letBlocks, inSync = false;
  const blocksHeld = new Promise((r) => { letBlocks = r; });
  Wallet.prototype.sync = function () {
    inSync = true;
    return blocksHeld.then(() => JSON.stringify(net.bal));
  };
  const syncing = runAcctSync();
  await waitFor("the sync runs", () => inSync);   // its own stall timer is not scaled
  const duringCw = t.acct.cw;
  await silentSend("during a sync");
  assert.match(t.messageWhy(), /stopped answering/);
  Wallet.prototype.sync = realSync;
  letBlocks();
  await syncing;
  await synced();
  assert.deepEqual([t.acct.cw !== duringCw, t.messageWhy()], [true, ""], "the next sync connects");
  // No server answers the sync after the stall: the stalled object still builds nothing.
  t.setZ({ ...Zp, latestHeight: async () => { throw new Error("down"); } });
  const downBuilt = net.created.length;
  await silentSend("both down");
  await waitFor("the failed sync", () => !t.acct.syncing && t.acct.error);
  await assert.rejects(t.sendOnChain(ana, "still down"), /stopped answering/);
  assert.equal(net.created.length, downBuilt + 1, "nothing is built after the failed sync");
  t.setZ(Zp);
  await runAcctSync();
  assert.equal(t.messageWhy(), "", "a sync that connects opens the composer");
  // A message that the engine builds in time leaves no timer that stalls the account later, and
  // the limit is not shorter than a slow answer. The signature fails, so no message goes out.
  const builtIn = async (ms, scale) => {
    if (scale) scaleTimers();
    Wallet.prototype.createMessage = async function (to, words) {
      await sleep(ms);
      return buildMessage.call(this, to, words);
    };
    t.setZ({ ...Zp, accountSign: () => { throw new Error("no signature"); } });
    const keptCw = t.acct.cw;
    try {
      await assert.rejects(t.sendOnChain(ana, "built"), /no signature/);
      await sleep(150);   // longer than the 60 s limit of a scaled timer
    } finally {
      globalThis.setTimeout = realTimeout;
      Wallet.prototype.createMessage = buildMessage;
      t.setZ(Zp);
    }
    // A late stall would start a sync that makes a new object.
    assert.deepEqual([t.acct.cw === keptCw, t.acct.stalled, t.messageWhy()], [true, null, ""]);
  };
  await builtIn(0, true);
  await builtIn(700, false);
  // Another tab replaces the account while the message goes out: the old account gets no sync.
  const realBroadcast = Wallet.prototype.broadcast;
  let oldAcct = null;
  Wallet.prototype.broadcast = function (hex) {
    oldAcct = t.acct;
    t.setAcct({ ...t.acct, progress: "", live: "" });
    return realBroadcast.call(this, hex);
  };
  const oldBalAt = t.acct.balAt;
  try { await t.sendOnChain(ana, "replaced while it goes out"); }
  finally { Wallet.prototype.broadcast = realBroadcast; }
  await sleep(100);
  assert.deepEqual([oldAcct.balAt, oldAcct.syncing], [oldBalAt, false], "no sync of the old one");
  net.sentIds.push(t.personal.sent.at(-1).txid);
  await runAcctSync();
  assert.equal(t.messageWhy(), "");

  // The sync follows the saved account. Another tab can leave a record that does not read, or an
  // account with another sync key. Then a send stops with a sentence, and the contact addresses
  // come from the account that the record holds.
  const deviceSeal = async (record) => seal(idbMap.get("personal:key"),
    { cred: "device", salt: "device" }, record);
  const goodRec = idbMap.get("personal:rec"), stored1 = await t.deviceRead();
  idbMap.set("personal:rec", await deviceSeal({ ...stored1, seed: "00" }));
  const madeBefore = net.created.length;
  await assert.rejects(t.sendOnChain(ana, "after a damage"), /Wait for the first sync/);
  assert.deepEqual([t.personal, t.acct, net.created.length], [null, null, madeBefore],
    "no message is built from an account that does not read");
  idbMap.set("personal:rec", goodRec);
  await t.rereadPersonal();
  await synced();
  const freedAtSwap = net.freed;
  idbMap.set("personal:rec", await deviceSeal({ ...stored1, snapKey: "n".repeat(43) }));
  await t.rereadPersonal();
  assert.equal(t.acct.secret, "n".repeat(43), "the sync of the new key replaces the old one");
  assert.equal(net.freed, freedAtSwap + 1, "the idle object of the old account is freed");
  idbMap.set("personal:rec", goodRec);
  await t.rereadPersonal();
  await synced();
  assert.equal(t.acct.secret, stored1.snapKey);

  // Funding: a request with 3 payees. A wallet of this browser proposes it, and nothing is sent.
  t.ui.personal.fund = "0.003";
  const req = JSON.parse(Z.parseRequest(t.fundingUri(), "test")).payees;
  assert.deepEqual(req.map((p) => [p.to, p.amount]), Array(3).fill([keys.address, 100000]));
  t.ui.personal.fund = "0.0003";
  assert.equal(JSON.parse(Z.parseRequest(t.fundingUri(), "test")).payees.length, 3);
  for (const bad of ["0", "0.00001", "x", "", "1e3"]) {
    t.ui.personal.fund = bad;
    assert.throws(() => t.fundingUri(), /Enter an amount|Fund at least/, bad);
  }
  t.ui.personal.fund = "0.003";
  const W = "ffffffffffffffffffff";
  t.state.groups = [{ id: W, name: "Team", network: "testnet" }];
  t.secrets[W + ":1"] = { keyPackage: {} };
  t.ready[W] = { address: "x" };
  const writes = [];
  const quiet = (path) => ({ id: path.split("/").pop(), path, onSnapshot: () => () => {},
    set: async () => writes.push(path), update: async () => writes.push(path),
    acquire: async () => ({ acquired: true }), get: async () => ({ exists: false }) });
  t.setDb({ doc: quiet, collection: (p) => ({ doc: (id) => quiet(p + "/" + id),
    onSnapshot: () => () => {} }) });
  t.fundFromWallet(W);
  assert.deepEqual([t.ui.send, t.ui.sendFor, t.ui.note],
    [true, W, "Fund the proposer's personal account"]);
  assert.deepEqual(t.ui.pay.map((r) => [r.to, r.amt, r.memo]),
    Array(3).fill([keys.address, "0.001", ""]));
  assert.deepEqual(writes, [], "Fund from a wallet writes nothing to the store");
  t.openGroup(null);
  t.ui.send = false; t.ui.pay = null; t.ui.note = "";
  await t.copyFundingRequest();
  assert.equal(copied.at(-1), t.fundingUri());
  assert.equal(t.banner.text, "Request copied. Pay it from any wallet.");

  // Backup: the payload round trips through the encrypted file, and restore gives it back.
  assert.equal(t.personal.backedUp, false, "the contacts are not in a file yet");
  assert.equal(await t.saveAccountBackup("this is a long test passphrase"), true);
  const file = downloaded.at(-1);
  assert.equal(file.filename, "zigs-personal-testnet.zigsbackup");
  assert.equal(file.data.includes(seed), false, "the file does not show the seed");
  const payload = JSON.parse(Z.backupOpen("this is a long test passphrase", file.data));
  assert.deepEqual(Object.keys(payload).sort(),
    ["birthday", "contacts", "kind", "network", "seed", "version"]);
  assert.deepEqual([payload.seed, payload.network, payload.birthday, payload.contacts.length],
    [seed, "testnet", 4500000, 2]);
  assert.deepEqual([t.personal.backedUp, t.personal.everBackedUp], [true, true]);
  const sealedKey = t.personal.snapKey, sentBefore = t.personal.sent.length;
  assert.equal(sentBefore > 0, true);
  await t.addPersonalContact("Dee", at(3));
  assert.deepEqual([t.personal.backedUp, t.personal.everBackedUp], [false, true],
    "a new contact makes the file out of date, but the file exists");
  await assert.rejects(t.restoreAccount(payload, true), /keeps one account|already/);
  await assert.rejects(t.applyBackup(payload, true), /already/,
    "a backup goes to the account path");
  // The account goes while a message builds: the engine still uses its object, so it is not freed.
  assert.equal(t.messageWhy(), "");
  const freedAtRemove = net.freed;
  let removing = null;
  await silentSend("removed", () => { removing = t.removeAccount(); });
  await removing;
  assert.equal(net.freed, freedAtRemove, "the busy object of the account is left to the finalizer");
  assert.deepEqual([t.personal, t.acct, [...idbMap.keys()].filter((k) => k.startsWith("personal"))],
    [null, null, []], "the seed, the key and the sync state are gone");
  await assert.rejects(t.applyBackup(payload, false), /not encrypted/);
  await assert.rejects(t.restoreAccount({ ...payload, seed: "zz" }, true), /valid seed/);
  await assert.rejects(t.restoreAccount({ ...payload, kind: "zigs-key-share" }, true),
    /not a backup/);
  // A name that is not text is an error in words. An index above the cap is refused.
  const ana0 = payload.contacts[0];
  await assert.rejects(t.restoreAccount({ ...payload, contacts: [{ ...ana0, name: 5 }] }, true),
    /^Error: Contact 1: Enter a name for this contact\.$/);
  await assert.rejects(t.restoreAccount({ ...payload,
    contacts: [{ ...ana0, index: 4294967295 }] }, true), /Contact 1: has a bad index/);
  assert.equal(t.personal, null);
  await t.applyBackup(payload, true);
  // Before the first sync, Zigs does not know which addresses got a payment.
  assert.equal(t.acct.bal, null, "the first sync is not done");
  await assert.rejects(t.addPersonalContact("Kim", at(5)), /Wait for the first sync/);
  await synced();
  assert.deepEqual([t.personal.seed, t.personal.birthday, t.personal.sent, t.personal.backedUp],
    [seed, 4500000, [], true]);
  assert.deepEqual(t.personal.contacts.map((c) => [c.name, c.index]),
    [["Ana", 1], ["Ben", 2]], "the file had the contacts of its time");
  assert.notEqual(t.personal.snapKey, sealedKey, "a new sync key");
  assert.equal(t.acct.address, keys.address, "the same account");
  assert.deepEqual([net.opened.at(-1)[0], net.opened.at(-1)[1]], [keys.ufvk, 4500000]);
  hygiene("after restore");

  // The old file lacks Dee, who had index 3 and wrote to her address. The chain shows that this
  // address got a payment, so the next contact does not take it.
  net.received = [{ txid: "ZD", height: 4500060, confirmed: true, value: 0, memo_pending: false,
    memos: [{ status: "text", text: "hello again", index: 3 }], indexes: [3] }];
  await runAcctSync();
  const kim = await t.addPersonalContact("Kim", at(5));
  assert.equal(kim.index, 4, "index 3 got a payment, so Kim does not take it");
  await t.changePersonal((p) => { p.contacts.pop(); });
  net.received = [];
  await runAcctSync();

  // The sealed record of the passkey lock holds the account too, and not the device copy.
  const vkey = await crypto.subtle.importKey("raw", crypto.getRandomValues(new Uint8Array(32)),
    "AES-GCM", false, ["encrypt", "decrypt"]);
  const puts = () => JSON.stringify([...idbMap.entries()].map(([k, v]) => [k, v && v.iv]));
  const before = puts();
  t.setVault({ rec: { cred: "c", salt: "s" }, key: vkey });
  await t.addPersonalContact("Eve", at(4));
  assert.equal(puts(), before, "with the lock on, the device copy is not written");
  const vrec = JSON.parse(storage.get("zf-vault"));
  assert.equal(storage.get("zf-vault").includes(seed), false);
  const opened = await openVault(vkey, vrec);
  assert.deepEqual([opened.personal.seed, opened.personal.contacts.map((c) => c.name)],
    [seed, ["Ana", "Ben", "Eve"]]);
  // A field that this page does not know stays in the record when the page saves.
  storage.set("zf-vault", JSON.stringify(await seal(vkey, vrec, { ...opened, future: { x: 1 } })));
  await t.persistSealed();
  const resaved = await openVault(vkey, JSON.parse(storage.get("zf-vault")));
  assert.deepEqual([resaved.future, resaved.personal.seed], [{ x: 1 }, seed]);
  // With the lock on, the save of another tab can reach this tab late. A change reads the sealed
  // record first, so it keeps the contact of the other tab and does not take its index.
  const top = Math.max(...resaved.personal.contacts.map((c) => c.index));
  const pia = { name: "Pia", address: at(7), index: top + 1 };
  storage.set("zf-vault", JSON.stringify(await seal(vkey, vrec, { ...resaved,
    personal: { ...resaved.personal, contacts: [...resaved.personal.contacts, pia] } })));
  await t.addPersonalContact("Bo", at(8));
  const merged = await openVault(vkey, JSON.parse(storage.get("zf-vault")));
  assert.deepEqual(merged.personal.contacts.slice(-2).map((c) => [c.name, c.index]),
    [["Pia", top + 1], ["Bo", top + 2]], "the late save of another tab is kept");
  // A key share that this tab could not save yet stays in memory when a change reads the record.
  const UNSAVED = "a".repeat(20) + ":1";
  t.secrets = { ...t.secrets, [UNSAVED]: { keyPackage: "kp" } };
  storage.set("zf-vault", JSON.stringify(await seal(vkey, vrec, merged)));
  await t.changePersonal((p) => { p.backedUp = true; });
  assert.equal(t.secrets[UNSAVED]?.keyPackage, "kp", "the re-read takes only the account");
  delete t.secrets[UNSAVED];
  // Another tab saves an account while this tab makes one: this tab writes nothing over it.
  const otherTab = storage.get("zf-vault");
  storage.set("zf-vault", JSON.stringify(await seal(vkey, vrec, { ...merged, personal: null })));
  await t.rereadPersonal();
  assert.equal(t.personal, null);
  t.setZ({ ...Zp, latestHeight: async () => { storage.set("zf-vault", otherTab); return 4500000; } });
  await assert.rejects(t.createPersonal("testnet"), /personal account already/);
  t.setZ(Zp);
  assert.equal(storage.get("zf-vault"), otherTab, "nothing wrote over the account of the other tab");
  assert.equal(t.personal.seed, seed, "this tab took the account of the other tab");
  // A locked step keeps an account that a record of another tab holds and this tab does not have
  // yet, so it never seals "no account" over one.
  t.adoptPersonal(null);
  await t.takeStored();
  assert.equal(t.personal?.seed, seed, "a locked step takes the account of the record");
  await synced();
  // A page from before the accounts saves the record with no `personal` field and drops the
  // account. This page keeps it in memory and seals it again. A null means that a page removed it.
  const keepSecrets = t.secrets, keepKeys = t.gkeys;
  const oldPage = JSON.stringify(await seal(vkey, vrec, { secrets: {}, keys: {}, chats: {} }));
  storage.set("zf-vault", oldPage);
  await t.takeFromTab("zf-vault", oldPage);
  await waitFor("the account is sealed again", () => storage.get("zf-vault") !== oldPage);
  t.secrets = keepSecrets;
  t.gkeys = keepKeys;
  assert.equal(t.personal.seed, seed, "the account stays in memory");
  const healed = await openVault(vkey, JSON.parse(storage.get("zf-vault")));
  assert.equal(healed.personal.seed, seed, "and in the record");
  t.personal = null;
  t.adoptPersonal(opened.personal);
  assert.equal(t.personal.seed, seed, "the account comes back from the sealed record");
  t.adoptPersonal({ ...opened.personal, seed: "00" });
  assert.deepEqual([t.personal, /cannot be read/.test(t.personalError)], [null, true]);
  await t.persistSealed();
  const kept = await openVault(vkey, JSON.parse(storage.get("zf-vault")));
  assert.equal(kept.personal.seed, "00", "a record that does not read is kept, not erased");
  t.adoptPersonal(opened.personal);
  // The lock moves a device copy into the sealed record. A copy that cannot be read stops it.
  t.setVault(null);
  storage.delete("zf-vault");
  await t.persistPersonal();
  assert.equal((await t.deviceRead()).contacts.length, 3);
  t.personal = null;
  await t.takeDeviceAccount();
  assert.equal(t.personal.seed, seed);
  idbMap.set("personal:rec", { ...idbMap.get("personal:rec"), box: "AAAA" });
  await assert.rejects(t.takeDeviceAccount(), /did not lock/);
  // Another tab turned the lock on: this tab writes nothing beside it.
  storage.set("zf-vault", "{}");
  idbMap.set("personal:rec", rec);
  const frozen = puts();
  await assert.rejects(t.changePersonal((p) => { p.backedUp = true; }), /Could not save/);
  assert.equal(puts(), frozen);
  t.setLocked({ damaged: true });
  assert.equal(await t.persistPersonal(), false, "locked: nothing is written");
  t.setLocked(null);
  storage.delete("zf-vault");

  // ── What the pages show ──
  const realDocument = globalThis.document;
  class Rec extends Node {
    constructor(tag) {
      super();
      Object.assign(this, { tag, attrs: {}, kids: [], on: {}, style: {} });
    }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    addEventListener(type, fn) { this.on[type] = fn; }
    replaceChildren(...x) { this.kids = x; }
    append(...x) {
      this.kids.push(...x);
      if (this.tag === "select" && this.value === undefined) this.value = x[0]?.attrs?.value;
    }
  }
  const textOf = (n) => n.text ?? n.kids.map(textOf).join("");
  const all = (n, pred, found = []) => {
    if (n.kids) { if (pred(n)) found.push(n); n.kids.forEach((k) => all(k, pred, found)); }
    return found;
  };
  const named = (n, tag, label) => all(n, (x) => x.tag === tag && textOf(x) === label)[0];
  const marks = (n) => all(n, (x) => /^vmark/.test(x.className || "")).map(textOf);
  globalThis.document = {
    createElement: (tag) => new Rec(tag), createElementNS: (ns, tag) => new Rec(tag),
    createTextNode: (text) => ({ text }),
  };
  // The recorder has no layout. A step that redraws the page runs with the stub page, and the
  // redraw timer (120 ms) fires before the recorder comes back.
  const recorder = globalThis.document;
  const live = async (fn) => {
    globalThis.document = realDocument;
    try { return await fn(); } finally { await sleep(200); globalThis.document = recorder; }
  };
  try {
    const parts3 = JSON.parse(Z.splitMessage("long text ".repeat(120)));
    assert.equal(parts3.length, 3);
    const txt = (text, index) => ({ status: "text", text, index });
    const reqUri = `zcash:${other.address}?amount=1.5`;
    t.acct.received = [
      { txid: "A", height: 4500090, confirmed: true, value: 0,
        memos: [txt(parts3[2], 1), txt(parts3[0], 1), txt(parts3[1], 1)] },
      { txid: "B", height: 4500091, confirmed: true, value: 0, memos: [txt("(1/2) lone", 2)] },
      { txid: "C", height: 4500092, confirmed: true, value: 0, memos: [txt("hello public", 0)] },
      { txid: "D", height: 4500093, confirmed: true, value: 0, memos: [txt("who is this", 99)] },
      { txid: "E", height: 4500094, confirmed: true, value: 0, memos: [txt(reqUri, 1)] },
      { txid: "F", height: 4500095, confirmed: true, value: 0, memos: [txt("a‮b", 1)] },
      { txid: "G", height: 4500096, confirmed: true, value: 0,
        memos: [{ status: "not_text", index: 1 }] },
      { txid: "H", height: 4500097, confirmed: true, value: 0, memos: [txt("no index", null)] },
    ];
    t.personal.sent = [
      { txid: "S1", to: 1, text: "S-sending", at: 5, tip: 4500100, fee: 10000, parts: 1,
        note_value: 100000, change: 90000, broadcast: true, failed: "" },
      { txid: "S2", to: 1, text: "S-chain", at: 4, tip: 4500000, fee: 20000, parts: 3,
        note_value: 1, change: 1, broadcast: true, failed: "" },
      { txid: "S3", to: 1, text: "S-failed", at: 3, tip: 4500000, fee: 10000, parts: 1,
        note_value: 1, change: 1, broadcast: false, failed: "refused" },
      { txid: "S4", to: 1, text: "S-expired", at: 2, tip: 4400000, fee: 10000, parts: 1,
        note_value: 1, change: 1, broadcast: true, failed: "" },
      { txid: "S5", to: 2, text: "S-for-Ben", at: 6, tip: 4500000, fee: 10000, parts: 1,
        note_value: 1, change: 1, broadcast: true, failed: "" },
    ];
    t.acct.sent = new Set(["S2"]);
    t.acct.progress = "";
    t.state.contact = 1;
    let view = t.contactView();
    let text = textOf(view);
    assert.match(text, /Your address for Ana/);
    assert.equal(text.includes(t.addressFor(1)), true);
    assert.equal(text.includes("long text ".repeat(119) + "long text"), true,
      "the 3 parts are joined");
    assert.match(text, /Joined from 3 parts/);
    assert.equal(text.includes("(1/3)"), false, "no marker is left in a joined message");
    assert.match(text, /On chain · sent to the address you gave Ana/);
    assert.match(text, /View transaction opens testnet\.zecblock\.com in a new tab\. That site/,
      "the chat says what the explorer sees");
    {
      // A chat with no explorer link: no received message, and no sent one that a block holds.
      const [received, sent] = [t.acct.received, t.personal.sent];
      t.acct.received = [];
      t.personal.sent = sent.filter((r) => r.txid === "S1");
      try {
        assert.doesNotMatch(textOf(t.contactView()), /View transaction opens/,
          "no explorer link, no explorer note");
        // Its only explorer link is a sent message that a block holds (S2).
        t.personal.sent = sent.filter((r) => r.txid === "S2");
        const sentOnly = textOf(t.contactView());
        assert.match(sentOnly, /View transaction ↗/);
        assert.match(sentOnly, /View transaction opens testnet\.zecblock\.com/,
          "a chat whose only links are sent messages has the explorer note");
      } finally {
        t.acct.received = received;
        t.personal.sent = sent;
      }
    }
    assert.equal(text.includes("✓"), false, "an on-chain message is never marked verified");
    assert.equal(marks(view).filter((m) => m.startsWith("On chain · sent")).length, 4);
    assert.match(text, /Payment request/);
    assert.match(text, /A memo has no sender\./, "a request in a memo has the memo warning");
    assert.match(text, /Froma memo · Not verified/);
    assert.equal(text.includes("a�b") && !text.includes("‮"), true, "memo text is filtered");
    assert.match(text, /Memo is not text/);
    for (const gone of ["hello public", "who is this", "(1/2) lone", "no index", "S-for-Ben"]) {
      assert.equal(text.includes(gone), false, gone + " is not in this chat");
    }
    assert.deepEqual(marks(view).filter((m) => !/^On chain · sent|^Not verified/.test(m)),
      ["Not on chain", "Not sent", "On chain", "Sending"], "the sent messages, oldest first");
    assert.match(text, /The network refused it: refused/);
    assert.match(text, /No block held it in time/);
    assert.match(text, /Fee 0\.0002 ZEC · 3 parts/);
    // The composer is off while a message waits for its block.
    let form = all(view, (x) => x.tag === "form").at(-1);
    let box = all(form, (x) => x.tag === "textarea")[0];
    assert.equal(box.attrs.disabled, "");
    assert.match(textOf(form), /A message is waiting for its block/);
    assert.equal(named(form, "button", "Send on chain").attrs.disabled, "");
    assert.equal(all(view, (x) => x.tag === "textarea").length, 1);

    // The other messages: not verified, and not in the chat of a contact.
    const others = textOf(t.otherMessages());
    assert.match(others, /Other messages \(not verified\)/);
    assert.match(others, /View transaction opens testnet\.zecblock\.com in a new tab\./);
    for (const shown of ["hello public", "who is this", "no index", "Unknown sender",
      "Sent to your public address", "Sent to an address of this account that no contact has",
      "Sent to an address that this app cannot place"]) {
      assert.equal(others.includes(shown), true, shown);
    }
    assert.equal(others.includes("S-sending") || others.includes("Joined from"), false);
    assert.equal(marks(t.otherMessages()).every((m) => m === "Not verified"), true);

    // After the block the composer is on and the fee follows the text.
    t.personal.sent = t.personal.sent.filter((r) => r.txid !== "S1");
    net.bal = { ...net.bal, spendable: 300000 };
    t.acct.progress = "Signing…";
    form = all(t.contactView(), (x) => x.tag === "form").at(-1);
    assert.match(textOf(form), /Signing…/, "the step that runs");
    assert.match(textOf(form), /A message is being sent\./, "one message is built at a time");
    assert.equal(named(form, "button", "Send on chain").attrs.disabled, "");
    t.acct.progress = "";
    view = t.contactView();
    form = all(view, (x) => x.tag === "form").at(-1);
    box = all(form, (x) => x.tag === "textarea")[0];
    assert.equal(box.attrs.disabled, undefined);
    assert.equal(box.on.keydown, undefined, "Enter does not send a message on chain");
    assert.doesNotMatch(box.attrs.placeholder, /Enter sends/);
    assert.equal(named(form, "button", "Send on chain").attrs.disabled, undefined);
    const line = all(form, (x) => x.attrs && x.attrs["aria-live"] === "polite")[0];
    assert.deepEqual([line.textContent, line.className], ["On chain · fee 0.0001 ZEC", "hint"]);
    for (const [value, fee, bad] of [["x".repeat(1200), "On chain · fee 0.0002 ZEC", false],
      ["x".repeat(2000), "On chain · fee 0.00025 ZEC", false],
      ["x".repeat(513), "On chain · fee 0.00015 ZEC", false],
      ["hi", "On chain · fee 0.0001 ZEC", false], ["a".repeat(2001), "2001 characters", true],
      ["é".repeat(1266), "more than 5 parts", true], ["", "On chain · fee 0.0001 ZEC", false]]) {
      box.value = value;
      box.on.input();
      assert.equal(line.textContent.includes(fee), true, value.length + ": " + line.textContent);
      assert.equal(line.className, bad ? "hint bad" : "hint");
      assert.equal(box.attrs["aria-invalid"], String(bad),
        "the message box is invalid exactly when its line shows an error: " + value.length);
    }
    assert.equal(box.attrs["aria-describedby"], line.attrs.id, "the box points at its line");
    t.acct.progress = "";
    t.acct.bal = { ...net.bal, spendable: 5000 };
    form = all(t.contactView(), (x) => x.tag === "form").at(-1);
    assert.match(textOf(form), /does not cover the network fee/,
      "a balance that cannot pay the fee");
    assert.equal(named(form, "button", "Send on chain").attrs.disabled, "");
    t.acct.bal = net.bal;

    // The home page: create, balance, address, warnings, funding, contacts.
    const card = () => t.accountCard();
    t.state.groups = [];
    let c = card();
    assert.match(textOf(c), /Back up the account\./);
    assert.match(textOf(c), /Public address/);
    assert.match(textOf(c), /Fund the account/);
    assert.match(textOf(c), /This browser holds no device of a testnet wallet\./);
    assert.equal(named(c, "button", "Fund from a wallet").attrs.disabled, "");
    assert.equal(named(c, "button", "Copy request").attrs.disabled, undefined);
    // The question before a removal names the loss that is real. A new contact makes the file out
    // of date, but the seed is in it.
    const flagsNow = [t.personal.backedUp, t.personal.everBackedUp];
    t.ui.personal.drop = true;
    const question = (backedUp, everBackedUp) => {
      Object.assign(t.personal, { backedUp, everBackedUp });
      return textOf(card());
    };
    assert.match(question(false, false), /no backup file, so the money in the account is lost/);
    const outdated = question(false, true);
    assert.match(outdated, /seed but not your newest contacts/);
    assert.doesNotMatch(outdated, /money in the account is lost/);
    assert.doesNotMatch(question(true, true), /no backup file|newest contacts/);
    t.ui.personal.drop = false;
    [t.personal.backedUp, t.personal.everBackedUp] = flagsNow;
    // The funding form warns while the person types, before the money is sent.
    const warnOf = (n) => all(n, (x) => x.attrs && x.attrs.id === "fund-warn")[0];
    t.acct.bal = { ...net.bal, spendable: 400000, pending: 0 };
    const form0 = t.fundBlock();
    const amount0 = all(form0, (x) => x.attrs && x.attrs.id === "fund-amt")[0];
    // The warning is advice for an amount that the request takes. Only an amount that the request
    // refuses marks the field as invalid.
    for (const [typed, warned, refused] of [["0.003", false, false], ["0.006", false, false],
      ["0.0060001", true, false], ["0.02", true, false], ["x", false, true], ["", false, true],
      ["0", false, true], ["0.00000001", false, true]]) {
      amount0.on.input({ target: { value: typed } });
      assert.equal(warnOf(form0).textContent, warned ? HIGH : "", typed);
      assert.equal(amount0.attrs["aria-invalid"], String(refused),
        "the amount field is invalid exactly when the request refuses the amount: " + typed);
    }
    assert.equal(amount0.attrs["aria-describedby"], "fund-hint fund-warn fund-error",
      "the field points at its notes");
    // The label holds the caption and the field only: the notes are no part of its name.
    const label0 = all(form0, (x) => x.tag === "label" && all(x, (y) => y === amount0).length)[0];
    assert.equal(textOf(label0), "Amount in ZEC", "the name of the amount field is its caption");
    t.ui.personal.fund = "0.02";
    assert.equal(warnOf(t.fundBlock()).textContent, HIGH, "the form shows it when it is drawn");
    t.ui.personal.fund = "0.003";
    t.acct.bal = net.bal;
    const lowCallouts = (n) => all(n, (x) => x.className === "callout warn"
      && /pays fewer than 3/.test(textOf(x))).length;
    assert.equal(lowCallouts(c), 0);
    t.state.groups = [{ id: W, name: "Team", network: "testnet" }];
    t.ready[W] = { address: "x" };
    c = card();
    assert.equal(named(c, "button", "Fund from a wallet").attrs.disabled, undefined);
    assert.equal(all(c, (x) => x.tag === "select").length, 0, "one wallet needs no picker");
    t.state.groups = [{ id: W, name: "Team", network: "testnet" },
      { id: "e".repeat(20), name: "Savings", network: "testnet" }];
    t.secrets["e".repeat(20) + ":1"] = { keyPackage: {} };
    t.ready["e".repeat(20)] = { address: "y" };
    c = card();
    assert.equal(all(c, (x) => x.tag === "select")[0].kids.length, 2, "two wallets: a picker");
    t.state.groups = [];
    const warnAt = (spendable, pending = 0) => {
      t.acct.bal = { ...net.bal, spendable, pending };
      return all(card(), (x) => x.className === "callout warn" && x.attrs.role === "status")
        .map(textOf).filter((x) => /fewer than 3|more than 0\.01/.test(x));
    };
    assert.match(warnAt(29999)[0], /pays fewer than 3 messages/);
    assert.deepEqual(warnAt(30000), []);
    assert.deepEqual(warnAt(1000000), []);
    assert.match(warnAt(1000001)[0], /more than 0\.01 ZEC/);
    assert.match(warnAt(0, 5)[0], /fewer than 3/);
    t.acct.bal = net.bal;
    // On mainnet the address stays hidden until the balance is known and under the cap.
    const testnetAccount = t.personal;
    t.personal = { ...testnetAccount, network: "mainnet" };
    t.acct.bal = null;
    assert.match(t.addressBlock(t.acct).kids.map(textOf).join(), /only when it knows the balance/);
    t.acct.bal = { ...net.bal, spendable: 50000000, pending: 0 };
    assert.match(textOf(t.addressBlock(t.acct)), /holds 0\.5 ZEC/);
    assert.equal(t.fundBlock(), null, "no funding request at the cap");
    assert.match(textOf(t.contactView()), /holds 0\.5 ZEC/);
    assert.equal(textOf(t.contactView()).includes(t.addressFor(1)), false, "no address at the cap");
    t.acct.bal = { ...net.bal, spendable: 49999999, pending: 0 };
    assert.match(textOf(t.addressBlock(t.acct)), /Public address/);
    t.personal = testnetAccount;
    t.acct.bal = net.bal;
    const list = textOf(t.contactsCard());
    assert.match(list, /Contacts on chain/);
    assert.match(list, /AnaOn chain · 4 messages/);
    assert.match(list, /BenOn chain · 1 message(?!s)/);
    assert.match(list, /EveOn chain · 0 messages/);
    // Without an account the card creates one. A saved account that does not read shows why.
    const mine = t.personal, acctNow = t.acct;
    t.personal = null;
    const create = t.personalCard(() => {});
    assert.match(textOf(create), /Create account/);
    assert.match(textOf(create), /Recover access/);
    assert.equal(named(create, "button", "Create account").attrs.disabled, undefined);
    assert.equal(t.contactsCard(), null);
    t.personal = mine;
    t.adoptPersonal({ kind: "personal" });
    const card0 = t.personalCard(() => {});
    assert.match(textOf(card0), /cannot be read/);
    assert.equal(named(card0, "button", "Create account"), undefined);
    assert.equal(named(card0, "button", "Back up account"), undefined, "no seed to save");
    assert.notEqual(named(card0, "button", "Remove from this browser"), undefined);
    t.adoptPersonal(null);
    t.personal = mine;
    assert.match(textOf(t.forgetBox()), /personal account is deleted as well/);
    // The backup dialog serves a seat and the account, and the file note says what it holds.
    t.ui.backup = { seat: 2, made: false, busy: false };
    assert.match(textOf(t.backupDialog()),
      /Back up device 2.*opens your key share.*sign as this device/);
    // S13: the seat dialog and the note no longer name the format change of 16 October 2026 or
    // the iPhone and Mac apps. Only the restore error of an old file names the change.
    const CHANGED = /backup format changed on 16 October 2026|iPhone and Mac apps/;
    assert.doesNotMatch(textOf(t.backupDialog()), CHANGED);
    assert.doesNotMatch(textOf(t.backupNote([2])), CHANGED);
    assert.match(textOf(t.backupNote([2])), /Back up your key share/);
    t.ui.backup = { personal: true, made: false, busy: false };
    const backup = textOf(t.backupDialog());
    assert.match(backup, /Back up the personal account.*opens the backup of your personal account/);
    assert.match(backup, /holds the seed of the account and your contacts.*It holds no messages/);
    assert.doesNotMatch(backup, /16 October 2026|no longer open/, "account files did not change");
    t.state.gid = null;
    assert.equal(t.layers().length, 2, "the backup of the account opens in the wallet list");
    t.ui.backup = null;
    // Sending on chain lets go of the box, so that the steps show (typingMessage). A normal
    // message does not.
    const blurred = [];
    const formOf = (value) => ({ elements: { text: { value, id: "chat-text-x",
      blur: () => blurred.push(value) } } });
    globalThis.document = { ...globalThis.document, getElementById: () => null };
    await t.submitMessage(formOf("on chain"),
      { key: "k1", seats: [], plan: () => ({}), send: async () => {} });
    await t.submitMessage(formOf("instant"), { key: "k2", seats: [1], send: async () => {} });
    assert.deepEqual(blurred, ["on chain"]);
    t.busy.clear();
    assert.match(textOf(t.contactDialog()), /Add a contact/);
    t.ui.contactAdd = true;
    t.state.gid = null;
    assert.equal(t.layers().length, 2, "the dialog opens in the wallet list");
    t.ui.contactAdd = false;
    // The plus button of the sidebar shows in an open wallet too. The dialog opens there, and it
    // does not wait for the person to leave the wallet.
    t.state.gid = A;
    await live(async () => t.openContactDialog());
    assert.equal(t.ui.contactAdd, true);
    assert.equal(t.layers().length, 2, "the dialog opens over an open wallet");
    t.ui.contactAdd = false;
    assert.equal(t.layers().length, 0);
    t.state.gid = null;

    // A contact at the end of the index range is refused, so that the saved record keeps reading.
    const far = Z.normalizeAddress(at(8));
    await live(async () => {
      await t.changePersonal((p) => {
        p.contacts.push({ name: "Hi", address: far, index: 2 ** 31 });
      });
      await assert.rejects(t.addPersonalContact("Zed", at(9)), /no free address left/);
      await t.rereadPersonal();
      assert.deepEqual([t.personalError, t.personal.contacts.at(-1).index], ["", 2 ** 31],
        "the record still reads after the refusal");
      await t.changePersonal((p) => { p.contacts.pop(); });
    });

    // A record that does not read keeps its seed. The person can save what reads, remove the
    // record, and restore the file. Remove does not write the record back.
    const hurt = JSON.parse(JSON.stringify(t.personal));
    hurt.contacts = [{ name: "Hi", address: far, index: 4294967295 }];
    t.adoptPersonal(hurt);
    assert.deepEqual([t.personal, /bad index/.test(t.personalError)], [null, true]);
    await live(() => t.persistPersonal());
    const sick = t.personalCard(() => {});
    assert.match(textOf(sick), /bad index/);
    assert.equal(named(sick, "button", "Create account"), undefined);
    assert.notEqual(named(sick, "button", "Back up account"), undefined);
    assert.match(textOf(sick), /saves the seed and the contacts that Zigs can read/);
    assert.notEqual(named(sick, "button", "Remove from this browser"), undefined);
    t.ui.backup = { personal: true, made: false, busy: false };
    assert.equal(await live(() => t.saveAccountBackup("this is a long test passphrase")), true);
    t.ui.backup = null;
    const rescue = JSON.parse(Z.backupOpen("this is a long test passphrase",
      downloaded.at(-1).data));
    assert.deepEqual([rescue.seed, rescue.contacts], [hurt.seed, []], "the seed, and what reads");
    t.ui.personal.drop = true;
    assert.match(textOf(t.personalCard(() => {})), /does not read\. Make a backup first/);
    await live(() => t.removeAccount());
    assert.deepEqual([t.personal, t.personalError, [...idbMap.keys()]
      .filter((k) => k.startsWith("personal"))], [null, "", []], "the damaged record is gone");
    await live(() => t.rereadPersonal());
    assert.deepEqual([t.personal, t.personalError], [null, ""], "and it does not come back");
    assert.notEqual(named(t.personalCard(() => {}), "button", "Create account"), undefined);
    await live(() => t.restoreAccount(rescue, true));
    assert.equal(t.personal.seed, hurt.seed, "the file brings the account back");
    t.setAcct(acctNow);
  } finally { globalThis.document = realDocument; }

  // The passkey lock moves the account into the sealed record and deletes the device copy, also
  // for a record that does not read: that one is sealed as it is. An unlock deletes a copy that an
  // earlier lock could not delete.
  {
    const damaged = JSON.parse(JSON.stringify(t.personal));
    damaged.contacts = [{ name: "Hi", address: Z.normalizeAddress(Z.addressAt(other.ufvk, 0)),
      index: 4294967295 }];
    t.adoptPersonal(damaged);
    assert.equal(t.personal, null);
    await t.persistPersonal();
    const copy = () => [...idbMap.keys()].filter((k) => k.startsWith("personal:")).sort();
    assert.deepEqual(copy(), ["personal:key", "personal:rec"]);
    await t.lockWithPasskey();
    await sleep(30);
    assert.deepEqual(copy(), [], "the device copy is deleted");
    const prfKey = await aesKey(new Uint8Array(32).fill(7));
    const inVault = await openVault(prfKey, JSON.parse(storage.get("zf-vault")));
    assert.equal(inVault.personal.seed, damaged.seed, "sealed as it is");
    t.setVault(null);
    t.adoptPersonal(null);
    t.setLocked(JSON.parse(storage.get("zf-vault")));
    idbMap.set("personal:key", "x");
    idbMap.set("personal:rec", "y");
    globalThis.zigs = { use: async () => null };
    // Another tab saves after this page loaded: the unlock opens the record that storage holds now.
    const rec0 = JSON.parse(storage.get("zf-vault")), cidU = "fa".repeat(10);
    const newer = await openVault(prfKey, rec0);
    const roomU = { key: "u".repeat(43), member: "dd".repeat(10), at: 1 };
    newer.chats = { profile: null, list: { [cidU]: roomU } };
    storage.set("zf-vault", JSON.stringify(await seal(prfKey, rec0, newer)));
    // And a save of another tab during the decrypt of the unlock comes in, also when an invite link
    // waits in the fragment: the unlock takes that save before the link saves.
    const cidD = "fb".repeat(10), roomD = { ...roomU, key: "d".repeat(43) };
    const during = JSON.stringify(await seal(prfKey, rec0,
      { ...newer, chats: { profile: null, list: { [cidU]: roomU, [cidD]: roomD } } }));
    const subtleU = globalThis.crypto.subtle, decryptU = subtleU.decrypt.bind(subtleU);
    subtleU.decrypt = (...a) => { storage.set("zf-vault", during); return decryptU(...a); };
    const gidI = "ac".repeat(10), keyI = "i".repeat(43);
    location.hash = "#" + gidI + "." + keyI;
    await t.unlockVault();
    delete subtleU.decrypt;
    location.hash = "";
    assert.deepEqual([t.chats.list[cidU], t.chats.list[cidD], t.gkeys[gidI]], [roomU, roomD, keyI],
      "the unlock opens the record of now, then takes the save during it, then the link");
    await waitFor("the link is saved", () => storage.get("zf-vault") !== during);
    const sealedU = await openVault(prfKey, JSON.parse(storage.get("zf-vault")));
    assert.deepEqual([sealedU.chats.list[cidD], sealedU.keys[gidI]], [roomD, keyI],
      "the save of the link keeps the save of the other tab");
    delete t.chats.list[cidU];
    delete t.chats.list[cidD];
    delete t.gkeys[gidI];
    await sleep(30);
    assert.deepEqual([t.personal, /bad index/.test(t.personalError), copy()], [null, true, []]);
    t.setVault(null);
    storage.delete("zf-vault");
    delete globalThis.zigs;
    t.adoptPersonal(null);
  }

  hygiene("at the end");
  assert.equal(JSON.stringify(net.created).includes(seed), false);
  delete globalThis.navigator;
}

// ── Seat backups: the kind of the file, the flag of the seat and the files of older versions
{
  t.setZ(Z);
  const files = [];
  t.setDownloads({ save: async (file) => { files.push(file); } });
  const pass = "this is a long test passphrase";
  const share = { identifier: "02" + "0".repeat(62), verifying_share: "ab", signing_share: "cd" };
  const seatOf = (extra) => ({ keyPackage: share, uid: "u2", ...extra });
  const unsaved = (gid, seat) => !seatBackedUp(t.sec(gid, seat));
  t.state.gid = A;
  t.state.g = { id: A, name: "Team", n: 3, t: 2, version: 3, network: "testnet" };
  t.state.seats = { 2: { uid: "u2" } };
  t.state.wallet = { address: "utest1x", birthday: 123 };
  t.gkeys = { [A]: "K".repeat(43) };

  // A seat that only the old flag marks as backed up asks again. The old flag leaves at the next
  // write, and a restore never brings it back.
  t.secrets = { [A + ":2"]: seatOf({ nonces: { s1: "n" }, backedUp: true }),
    [A + ":3"]: seatOf({ backedUp: true }) };
  assert.deepEqual([unsaved(A, 2), unsaved(A, 3)], [true, true], "the old flag counts for nothing");
  t.putSec(A, 3, { room: null });
  assert.equal("backedUp" in t.sec(A, 3), false, "a write drops the old flag");
  const stored = JSON.parse(storage.get("zf-secrets"));
  assert.equal("backedUp" in stored[A + ":3"], false, "the stored copy lost it too");

  // The file holds the new kind, no nonce and no flag, even when the seat still holds the old one.
  assert.equal(await t.saveBackup(2, pass), true);
  const made = JSON.parse(Z.backupOpen(pass, files.at(-1).data));
  assert.equal(made.kind, "zigs-key-share");
  assert.deepEqual(Object.keys(made.secret).sort(), ["keyPackage", "uid"]);
  assert.deepEqual([t.sec(A, 2).backupSaved, "backedUp" in t.sec(A, 2), unsaved(A, 2)],
    [true, false, false], "the saved file marks the seat");

  // The file passes the checks, and a restore on a browser without the seat stores it as not
  // backed up until the file fits the wallet.
  t.checkShape(made);
  assert.equal(t.restoredFor(made, undefined).backupSaved, false);
  assert.equal("backedUp" in t.restoredFor(made, t.sec(A, 2)), false);
  const NEW = new RegExp("not a Zigs backup, or an older version of Zigs made it.*"
    + "changed on 16 October 2026.*older files no longer open.*"
    + "new backup in a browser that still holds the key share");
  // The kind of the files that older versions made. It is built here, so that the old name is
  // not in the source as one string. A kind from a file must not reach a method of Object either.
  const OLD_KIND = "zec" + "-frost-key-share";
  const kinds = [OLD_KIND, "zigs-backup", "x", "", 5, undefined, "constructor", "__proto__",
    "toString"];
  for (const kind of kinds) {
    await assert.rejects(t.applyBackup({ ...made, kind }, true), NEW, String(kind));
    await assert.rejects(t.applyBackup({ ...made, kind }, false), NEW, String(kind));
  }
  // A plain file of the old kind, picked in the page: the banner says it, and nothing is stored.
  const oldFile = JSON.stringify({ ...made, kind: OLD_KIND });
  await t.restore({ size: oldFile.length, text: async () => oldFile });
  assert.match(t.banner.text, NEW);
  assert.equal(t.banner.kind, "bad");
  assert.deepEqual(Object.keys(t.secrets).sort(), [A + ":2", A + ":3"],
    "a refused file stores nothing");
  // A step that failed shows its error until the same step succeeds (S11). The error of another
  // step stays.
  const fails = (text) => async () => { throw new Error(text); };
  await t.once("s11-a", fails("A failed."));
  assert.equal(t.banner.text, "A failed.");
  await t.once("s11-a", async () => {});
  assert.equal(t.banner, null, "the success of the step hides its error");
  await t.once("s11-a", fails("A failed."));
  await t.once("s11-b", fails("B failed."));
  await t.once("s11-a", async () => {});
  assert.equal(t.banner.text, "B failed.", "the error of another step stays");
  await t.once("s11-b", async () => {});
  assert.equal(t.banner, null);
  await t.once("s11-c", fails("C1."));
  await t.once("s11-c", fails("C2."));
  await t.once("s11-c", async () => {});
  assert.equal(t.banner, null, "the last text of the step counts");
  await t.once("s11-d", fails("D failed."));
  await t.once("s11-e", async () => {});
  assert.equal(t.banner.text, "D failed.", "a step that never failed hides nothing");
  await t.once("s11-d", async () => {});
  await t.once("s11-f", fails("F."));
  await t.once("s11-f", async () => {});
  await t.once("s11-g", fails("F."));
  await t.once("s11-f", async () => {});
  assert.equal(t.banner.text, "F.", "a success forgets the step: it hides nothing later");
  await t.once("s11-g", async () => {});

  // A browser that holds nothing takes the file. The seat counts as backed up only after it fits.
  const quiet = { onSnapshot: () => () => {} };
  t.setDb({ doc: () => quiet, collection: () => quiet });
  t.secrets = {}; t.gkeys = {};
  await t.applyBackup(made, true);
  const got = t.sec(A, 2);
  assert.deepEqual([got.keyPackage, got.backupSaved, got.restored, got.nonces],
    [share, false, true, {}]);
  assert.equal(t.gkeys[A], "K".repeat(43));
  assert.match(t.banner.text, /^Restored device 2 of Team\./);
  assert.equal(unsaved(A, 2), true);
}

// ── A key ceremony that was open when this version came: the boxes of the older version ──
// The vectors are the ones of util.mjs. Seat 2 opens the box of seat 1. The box of an older
// version does not open, and the page says so without blaming the seat. In version 1, too, the
// seat ends its setup, so that the reactor does not try again every few seconds.
{
  const G = "g", vecA = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
  const pkB = "493e82fc74464a59268817623d2053c5eb8e2cc4a988b4fee179ec6b010d531d";
  const text = "hello from seat 1";   // opens, but is no JSON
  const box = "a0a1a2a3a4a5a6a7a8a9aaab.sPL7xNK7CcWZd334CFmY2DWnZz3/TEm8bfO62yTstApM";
  const older = "a0a1a2a3a4a5a6a7a8a9aaab.scXfOHjAXmCNrnI3jX7QwXmjb3388IvIn/0vp8pN6phe";
  const setUp = (sealed) => {
    t.secrets = { [G + ":2"]: { boxSk: vecA, echo: "e", r2secret: "x", version: 3 } };
    t.state.gid = G;
    t.state.g = { id: G, n: 2, t: 2, version: 3, network: "testnet" };
    t.state.seats = { 1: { boxPk: pkB }, 2: { boxPk: "bb" } };
    t.state.dkg1 = { 1: { package: "p1" }, 2: { package: "p2" } };
    t.state.dkg2 = { "1-2": { sealed, echo: "e" } };
    return t.sec(G, 2);
  };
  const OTHER = /: The message of device 1 was made by another version of Zigs$/;
  assert.equal(Z.boxOpen(vecA, pkB, "g:1->2", box), text, "control: the vector opens");
  assert.throws(() => t.unboxFrom(1, 2, setUp(older)), OTHER, "version 2");
  assert.throws(() => t.unboxFrom(1, 2, setUp(box)), /: Device 1 sent an unreadable message$/,
    "a box that opens with no JSON in it is another fault");
  assert.throws(() => t.unboxFrom(1, 2, setUp(5)), /: Device 1 sent an unreadable message$/);

  // Version 1: the seat stops for good, and the text is the one of version 2.
  const s = setUp(older);
  await assert.rejects(t.round3V1(2), /another version of Zigs\. Do not use this wallet/);
  assert.match(t.sec(G, 2).aborted, /^The message of device 1 was made by another version of Zigs\./);
  assert.equal(t.sec(G, 2).keyPackage, undefined, "no key share was made");
  assert.equal(s.aborted, t.sec(G, 2).aborted);
  t.secrets = {};
}

async function runAcctSync() {
  // The sync of the account that the 60 second timer starts.
  t.acct.syncing = false;
  await t.runSync(t.acct);
}

// Paths of the page that no check above runs: a good action clears a bad banner, a pick in the
// side list shows a wallet section, the phone Menu closes, the skip link moves the focus, and
// Leave chat asks first. Each one asks for the focus of a control, which the next redraw (120 ms
// later) takes. A recorder stands in for the page.
{
  const realDocument = globalThis.document;
  class Rec extends Node {
    constructor(tag) {
      super();
      Object.assign(this, { tag, attrs: {}, kids: [], on: {} });
    }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    addEventListener(type, fn) { this.on[type] = fn; }
    append(...x) { this.kids.push(...x); }
  }
  const banner = new Rec("div"), bannerText = new Rec("span");
  const page = { focused: false, focus() { this.focused = true; } };
  const menuButton = { focus() { document.activeElement = menuButton; } };
  const lastItem = { focus() { document.activeElement = lastItem; } };
  const nav = { querySelectorAll: () => [{}, lastItem] };
  globalThis.document = {
    activeElement: { dataset: { key: "send-ok" } },
    getElementById: (id) => ({ banner, "banner-text": bannerText, app: page,
      "wallet-menu": menuButton, "side-nav": nav })[id] ?? null,
    createElement: (tag) => new Rec(tag), createElementNS: (ns, tag) => new Rec(tag),
    createTextNode: (text) => ({ text }),
  };
  const ev = { preventDefault() {}, currentTarget: null };
  const { tab, leave, menu } = t.ui;
  try {
    t.showBanner("bad", "an earlier error");
    assert.equal(banner.hidden, false);
    await t.act(async () => {})(ev);
    assert.equal(t.banner, null, "a good action clears a bad banner");
    assert.equal(banner.hidden, true, "and hides it");
    assert.deepEqual(t.wantFocus, { key: "send-ok", force: false }, "the control gets the focus");
    t.showBanner("ok", "saved");
    await t.act(async () => {})(ev);
    assert.deepEqual(t.banner, { kind: "ok", text: "saved" }, "a good banner stays");
    await t.act(async () => { throw new Error("no"); })(ev);
    assert.deepEqual(t.banner, { kind: "bad", text: "no" }, "a failed action shows its error");

    const sections = [["overview", "Overview"], ["activity", "Activity"], ["members", "Devices"]];
    const item = (id) => t.sectionNav(sections).find((n) => n.attrs.id === "tab-" + id);
    t.ui.tab = "solana";
    assert.equal(item("overview").attrs["aria-current"], "page",
      "a section that the wallet lacks shows Overview");
    assert.equal(t.ui.tab, "overview");
    assert.equal(item("members").attrs["aria-current"], undefined, "only one section is current");
    item("members").on.click();
    assert.equal(t.ui.tab, "members", "a pick shows the section");
    assert.deepEqual(t.wantFocus, { key: "panel-members", force: true },
      "and the focus goes to the section");

    t.ui.menu = true;
    t.menuKey({ key: "x" });
    assert.equal(t.ui.menu, true, "another key keeps the Menu open");
    // On a phone, Tab goes round in the open Menu: from the last item to Menu, and back.
    let stops = 0;
    const press = (shiftKey) =>
      t.menuKey({ key: "Tab", shiftKey, preventDefault: () => { stops += 1; } });
    const wide = globalThis.matchMedia, active = document.activeElement;
    globalThis.matchMedia = () => ({ matches: true });
    try {
      document.activeElement = lastItem;
      press(false);
      assert.equal(document.activeElement, menuButton, "Tab on the last item goes to Menu");
      press(true);
      assert.equal(document.activeElement, lastItem, "Shift+Tab on Menu goes to the last item");
      document.activeElement = {};
      press(true);
      press(false);
      assert.equal(stops, 2, "Tab from another item moves as usual");
      document.activeElement = lastItem;
      globalThis.matchMedia = wide;
      press(false);
      assert.equal(stops, 2, "wider than a phone, Tab moves as usual");
    } finally {
      Object.assign(globalThis, { matchMedia: wide });
      document.activeElement = active;
    }
    t.menuKey({ key: "Escape" });
    assert.equal(t.ui.menu, false, "Escape closes the Menu");
    assert.deepEqual(t.wantFocus, { key: "menu", force: true }, "and the focus goes back to Menu");
    t.ui.menu = true;
    t.menuWidth({ matches: true });
    assert.equal(t.ui.menu, true, "a phone width keeps the Menu open");
    t.menuWidth({ matches: false });
    assert.equal(t.ui.menu, false, "a wider window closes the Menu");
    t.ui.menu = true;
    t.menuOutside({ target: { closest: (sel) => (sel === ".side" ? {} : null) } });
    assert.equal(t.ui.menu, true, "a click in the side list keeps it open");
    t.menuOutside({ target: { closest: () => null } });
    assert.equal(t.ui.menu, false, "a click outside the side list closes it");
    let stopped = false;
    t.skipToPage({ preventDefault: () => { stopped = true; } });
    assert.ok(stopped && page.focused, "the skip link focuses the page and changes no fragment");

    t.ui.leave = false;
    const ask = t.leaveBox("chat-id").kids[0];
    assert.equal(ask.attrs["data-key"], "leave-ask");
    ask.on.click();
    assert.equal(t.ui.leave, true, "Leave chat asks first");
    assert.deepEqual(t.wantFocus, { key: "leave-no", force: true }, "and the focus goes to Cancel");
  } finally {
    globalThis.document = realDocument;
    Object.assign(t.ui, { tab, leave, menu });
  }
  await sleep(200);
}

// ── The status line of an offline browser ──
// It shows while navigator.onLine is false and goes away when the browser is online again. A
// recorder stands in for the page, and the listeners are the ones that the page put on window.
{
  const realDocument = globalThis.document;
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  class Rec extends Node {
    constructor(tag) {
      super();
      Object.assign(this, { tag, attrs: {}, kids: [] });
    }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    addEventListener() {}
    append(...x) { this.kids.push(...x); }
  }
  const textOf = (n) => n.text ?? n.kids.map(textOf).join("");
  const box = { kids: [], replaceChildren(...x) { this.kids = x; } };
  globalThis.document = {
    getElementById: (id) => (id === "offline" ? box : null),
    createElement: (tag) => new Rec(tag), createTextNode: (text) => ({ text }),
  };
  const browser = (value) => Object.defineProperty(globalThis, "navigator",
    { configurable: true, value });
  const fire = (type) => { for (const fn of windowOn[type] ?? []) fn(); };
  try {
    browser({ onLine: false });
    fire("offline");
    assert.match(box.kids.map(textOf).join(""),
      /^No network connection\. Network actions need a connection\. .* can be old\.$/,
      "offline, the line shows");
    assert.equal(box.kids[0].className, "callout warn");
    browser({ onLine: true });
    fire("online");
    assert.deepEqual(box.kids, [], "back online, the line goes away");
    browser({});
    t.showOffline();
    assert.deepEqual(box.kids, [], "a browser that does not say its state is not offline");
    delete globalThis.navigator;
    t.showOffline();
    assert.deepEqual(box.kids, [], "a page without navigator is not offline");
  } finally {
    globalThis.document = realDocument;
    if (realNavigator) Object.defineProperty(globalThis, "navigator", realNavigator);
    else delete globalThis.navigator;
  }
}

// ── Tab in an open dialog or drawer goes round (layerTab) ──
// A recorder stands in for the layer, its controls and the banner. The key goes through the
// listeners that the page put on document, so the check covers the listener too.
{
  const realDocument = globalThis.document;
  const control = (over = {}) => ({
    tabIndex: 0, disabled: false, getClientRects: () => [{}], checkVisibility: () => true,
    focus() { document.activeElement = this; }, ...over,
  });
  let layer = null, banner = { querySelectorAll: () => [] };
  let stops = 0;
  globalThis.document = {
    activeElement: null,
    querySelector: (selector) => (selector === ".dialog, .drawer" ? layer : null),
    getElementById: (id) => (id === "banner" ? banner : null),
  };
  const open = (...controls) => {
    layer = { querySelectorAll: () => controls, focus() { document.activeElement = layer; } };
  };
  const press = (shiftKey, key = "Tab") => {
    const preventDefault = () => { stops += 1; };
    for (const fn of documentOn.keydown) fn({ key, shiftKey, preventDefault });
  };
  const from = (control0) => { document.activeElement = control0; stops = 0; };
  try {
    const [a, b, c] = [control(), control(), control()];
    open(a, b, c);
    from(c);
    press(false);
    assert.equal(document.activeElement, a, "Tab on the last control goes to the first");
    assert.equal(stops, 1, "and the page does not move the focus as well");
    from(a);
    press(true);
    assert.equal(document.activeElement, c, "Shift+Tab on the first control goes to the last");
    from(b);
    press(false);
    press(true);
    assert.deepEqual([stops, document.activeElement], [0, b], "Tab in the middle moves as usual");
    from({});
    press(false);
    assert.equal(document.activeElement, a, "Tab from outside the layer goes to the first one");
    from({});
    press(true);
    assert.equal(document.activeElement, c, "Shift+Tab from outside goes to the last control");
    from(layer);
    press(true);
    assert.equal(document.activeElement, c, "Shift+Tab on the layer itself goes to the last one");
    from(c);
    press(false, "Enter");
    assert.equal(stops, 0, "another key moves nothing");
    for (const [what, off] of [["a disabled control", control({ disabled: true })],
      ["a control that is not shown", control({ getClientRects: () => [] })],
      ["a control in a closed details", control({ checkVisibility: () => false })],
      ["a control with tabindex -1", control({ tabIndex: -1 })]]) {
      open(a, c, off);
      from(c);
      press(false);
      assert.equal(document.activeElement, a, what + " is no stop at the end");
      open(off, a, c);
      from(a);
      press(true);
      assert.equal(document.activeElement, c, what + " is no stop at the start");
    }
    // A control of the layer that is no stop (tabindex -1) has the focus: Tab goes to the next
    // stop after it, and Shift+Tab to the stop before it.
    const quiet = control({ tabIndex: -1 });
    open(a, quiet, c);
    from(quiet);
    press(false);
    assert.equal(document.activeElement, c,
      "Tab from a control of the layer that is no stop goes to the next stop");
    from(quiet);
    press(true);
    assert.equal(document.activeElement, a, "Shift+Tab from it goes to the stop before");
    open(a, c, quiet);
    from(quiet);
    press(false);
    assert.equal(document.activeElement, a, "Tab from it after the last stop goes to the first");
    open(quiet, a, c);
    from(quiet);
    press(true);
    assert.equal(document.activeElement, c,
      "Shift+Tab from it before the first stop goes to the last");
    // A control before it that is no stop does not count: Tab and Shift+Tab still reach the stops
    // next to it.
    for (const [what, off] of [["a disabled control", control({ disabled: true })],
      ["a control that is not shown", control({ getClientRects: () => [] })]]) {
      open(a, off, quiet, c);
      from(quiet);
      press(false);
      assert.equal(document.activeElement, c,
        "Tab from it after " + what + " goes to the next stop");
      from(quiet);
      press(true);
      assert.equal(document.activeElement, a,
        "Shift+Tab from it after " + what + " goes to the stop before");
    }
    // The Close button of an open banner is a stop after the controls of the layer.
    const close = control();
    banner = { querySelectorAll: () => [close] };
    open(a, b, c);
    from(c);
    press(false);
    // Native Tab goes from the last control of the layer to the banner only when nothing between
    // them takes focus: the footer is inert while a layer is open (the next block).
    assert.deepEqual([stops, document.activeElement], [0, c],
      "Tab on the last control of the layer moves on to the banner as usual");
    from(close);
    press(false);
    assert.equal(document.activeElement, a, "Tab on the Close button of the banner goes round");
    from(a);
    press(true);
    assert.equal(document.activeElement, close, "Shift+Tab on the first control reaches it");
    banner = { querySelectorAll: () => [control({ getClientRects: () => [] })] };
    open(a, b, c);
    from(c);
    press(false);
    assert.equal(document.activeElement, a, "the Close button of a hidden banner is no stop");
    open(control({ disabled: true }));
    from({});
    assert.doesNotThrow(() => press(false), "Tab in a layer without controls keeps the focus");
    assert.deepEqual([stops, document.activeElement], [1, layer], "in the layer itself");
    assert.equal(layer.tabIndex, -1, "a layer without controls can take the focus after a redraw");
    layer = null;
    from(a);
    assert.doesNotThrow(() => press(false), "Tab with no open layer does nothing");
    assert.equal(stops, 0, "and the page moves the focus as usual");
  } finally {
    globalThis.document = realDocument;
  }
}

// ── A layer takes the page, the side list and the footer out of reach (setModal) ──
{
  const realDocument = globalThis.document;
  const marks = [];
  const part = (name) => ({ toggleAttribute: (k, on) => marks.push(name + ":" + k + ":" + on) });
  const parts = { ".side": part("side"), ".app-foot": part("foot") };
  globalThis.document = { querySelector: (selector) => parts[selector] ?? null };
  try {
    t.setModal(part("view"), true);
    assert.deepEqual(marks, ["view:inert:true", "side:inert:true", "foot:inert:true"],
      "an open layer takes the footer out of reach, as the page and the side list");
    marks.length = 0;
    t.setModal(part("view"), false);
    assert.deepEqual(marks, ["view:inert:false", "side:inert:false", "foot:inert:false"],
      "a closed layer gives them back");
  } finally {
    globalThis.document = realDocument;
  }
}

// ── The keyboard fit of a phone (fitKeyboard) ──
// The visual viewport, the window and the focused field are recorders. Each call to view() is one
// resize event of the visual viewport.
{
  const realWindow = globalThis.window, realDocument = globalThis.document;
  const style = {}, scrolled = [];
  const inLayer = (name) => ({
    closest: (selector) => (selector === ".dialog, .drawer" && name !== "outside" ? {} : null),
    scrollIntoView: (o) => scrolled.push(name + ":" + o.block),
    getAttribute: (k) => (k === "aria-describedby" ? "other-note field-note" : null),
  });
  const note = { scrollIntoView: (o) => scrolled.push("note:" + o.block) };
  globalThis.document = {
    activeElement: inLayer("field"),
    documentElement: { style: { setProperty: (k, v) => { style[k] = v; } } },
    getElementById: (id) => (id === "field-note" ? note : null),
  };
  const view = (visual) => {
    globalThis.window = { innerHeight: 812,
      visualViewport: { height: 812, offsetTop: 0, scale: 1, ...visual } };
    scrolled.length = 0;
    t.fitKeyboard();
    return [style["--keyboard-inset"], style["--visual-height"], scrolled.join(" ")];
  };
  try {
    assert.deepEqual(view({ scale: 2 }).slice(0, 2), ["0px", "100dvh"],
      "a pinch zoom turns the fit off");
    assert.deepEqual(view({ height: 476 }), ["336px", "476px", "field:nearest note:nearest"],
      "the keyboard opens: the dialog ends above it, and the field and its note scroll into view");
    assert.deepEqual(view({ height: 476 }), ["336px", "476px", ""],
      "an event with the same inset scrolls nothing");
    assert.deepEqual(view({ height: 400 }), ["412px", "400px", "field:nearest note:nearest"],
      "a keyboard that grows scrolls again");
    assert.deepEqual(view({ height: 476, offsetTop: 100 }), ["236px", "476px", ""],
      "a pan of the visual viewport that shrinks the inset scrolls nothing");
    assert.deepEqual(view({ scale: 2, height: 400 }), ["0px", "100dvh", ""], "zoom again");
    assert.deepEqual(view({ scale: 1.005, height: 476 }),
      ["336px", "476px", "field:nearest note:nearest"],
      "a scale within 0.01 of 1 counts as no zoom");
    assert.equal(view({ scale: 1.02, height: 476 })[0], "0px", "a scale of 1.02 is a zoom");
    view({ height: 812 });
    globalThis.document.activeElement = inLayer("outside");
    assert.equal(view({ height: 476 })[2], "", "a field outside a layer does not scroll");
    const before = { ...style };
    assert.doesNotThrow(() => view({ height: NaN }), "an unknown height does not throw");
    assert.deepEqual(style, before, "and it changes nothing");
    globalThis.window = { innerHeight: 812 };
    assert.doesNotThrow(() => t.fitKeyboard(), "a page without a visual viewport does not throw");
    assert.deepEqual(style, before, "and it changes nothing");
  } finally {
    globalThis.window = realWindow;
    globalThis.document = realDocument;
  }
}

// ── The second field of the backup dialog is tied to its note ──
{
  const realDocument = globalThis.document;
  class Rec extends Node {
    constructor(tag) {
      super();
      Object.assign(this, { tag, attrs: {}, kids: [], on: {}, style: {} });
    }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    addEventListener(type, fn) { this.on[type] = fn; }
    append(...x) { this.kids.push(...x); }
  }
  const all = (n, pred, out = []) => {
    if (n.kids) { if (pred(n)) out.push(n); n.kids.forEach((k) => all(k, pred, out)); }
    return out;
  };
  globalThis.document = {
    createElement: (tag) => new Rec(tag), createElementNS: (ns, tag) => new Rec(tag),
    createTextNode: (text) => ({ text }),
  };
  const { backup } = t.ui;
  try {
    t.ui.backup = { seat: 2, made: false, busy: false };
    const dialog = t.backupDialog();
    const [pass, again, note] = ["bk-pass", "bk-again", "bk-hint"]
      .map((id) => all(dialog, (x) => x.attrs?.id === id)[0]);
    const good = "abcdefghijklmnopqrstuvwxyz0123";
    const type = (first, second) => {
      pass.value = first;
      again.value = second;
      dialog.on.input();
    };
    assert.equal(again.attrs["aria-describedby"], "bk-hint", "the field points at its note");
    type(good, good.slice(0, 29) + "X");
    assert.deepEqual([again.attrs["aria-invalid"], note.className], ["true", "hint bad"],
      "a wrong confirmation marks the second passphrase field as invalid");
    type(good, good.slice(0, 5));
    assert.equal(again.attrs["aria-invalid"], "false",
      "a confirmation that is still being typed is fine");
    type(good, good);
    assert.deepEqual([again.attrs["aria-invalid"], note.className], ["false", "hint ok"]);
  } finally {
    t.ui.backup = backup;
    globalThis.document = realDocument;
  }
}

// ── The note under the passphrase fields is red only for a confirmation that is wrong ──
{
  const good = "abcdefghijklmnopqrstuvwxyz0123";
  const [, weak] = t.passNote("short", "short".repeat(9));
  assert.equal(weak, "hint ", "a weak first passphrase is not an error of the second field");
  assert.equal(t.passNote(good, "")[1], "hint ", "no confirmation yet");
  assert.equal(t.passNote(good, good.slice(0, 10))[1], "hint ",
    "a confirmation that is still being typed is no error");
  assert.equal(t.passNote(good, good.slice(0, 29) + "X")[1], "hint bad",
    "a full confirmation that differs is an error");
  assert.equal(t.passNote(good, good + "x")[1], "hint bad", "a longer confirmation is an error");
  assert.deepEqual(t.passNote(good, good), ["The passphrases match.", "hint ok"]);
}

// ── A page that loads offline shows the line at once ──
// A second copy of app-loop.js runs its load code with an offline browser. The other modules are
// the copies that the test already loaded. This block stays last: the second copy adds listeners.
{
  const realDocument = globalThis.document;
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  class Rec extends Node {
    constructor(tag) {
      super();
      Object.assign(this, { tag, attrs: {}, kids: [] });
    }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    addEventListener() {}
    append(...x) { this.kids.push(...x); }
  }
  const box = { kids: [], replaceChildren(...x) { this.kids = x; } };
  globalThis.document = {
    addEventListener() {}, getElementById: (id) => (id === "offline" ? box : null),
    createElement: (tag) => new Rec(tag), createTextNode: (text) => ({ text }),
  };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
  try {
    await import(new URL("app-loop.js?load-offline", web));
    assert.equal(box.kids.length, 1, "a page that loads offline shows the line");
  } finally {
    globalThis.document = realDocument;
    if (realNavigator) Object.defineProperty(globalThis, "navigator", realNavigator);
    else delete globalThis.navigator;
  }
}

// ── Opening another wallet drops the notes of an expired payment of the open one, and the
// wallet list keeps no watch of it ──
t.ui.after = "PA";
let unwatched = 0;
t.watched.set("wl", { gid: t.state.gid, raw: { commits: {}, shares: {} },
  unsubs: [() => { unwatched += 1; }] });
t.openGroup(null);
assert.equal(t.ui.after, null);
assert.deepEqual([t.watched.size, unwatched], [0, 1],
  "the wallet list keeps no watch of the last wallet");

console.log("app ok");
process.exit(0);
