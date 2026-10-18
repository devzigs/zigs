// Drives the real page modules with a stub page and an in-memory store, for the version 3 rules
// that need the whole page: the pins, the filter, the writers and the ceremony.
// Run: node web/test/app.mjs
// The test loads the real page modules through page.mjs (the names it reads: NAMES there).
import assert from "node:assert/strict";
import fs from "node:fs";
import * as Z from "../pkg/zigs_engine.js";
import { newSignKey, signMsg, verifyMsg } from "../chat.js";
import { HIGH_TEXT as HIGH } from "../personal.js";
import { seatBackedUp } from "../util.js";
import { aesKey, open as openVault, seal } from "../vault.js";
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
Object.assign(globalThis, {
  Node: class {}, document: stub(), history: { replaceState() {} }, requestAnimationFrame: () => 0,
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
  assert.equal(t.proposer(ss), "S1 (seat 1)", "a name comes with its seat number");
  const name1 = t.state.seats[1].name;
  t.state.seats[1].name = "Ana (seat 2)";
  assert.equal(t.named(1), "Ana (seat 2) (seat 1)", "a false seat number gets the real one");
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
  // No network: the chain height is fixed, the sync fails, the proof is a fixed answer.
  class Offline { constructor() { throw new Error("offline"); } }
  const fakeZ = { ...Z, latestHeight: async () => 1000, ChainWallet: Offline,
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
  assert.match(t.state.sessions[0].error, /^Cancelled by .* \(seat \d\)\.$/);

  const second = await propose("second", 2);
  await t.failSession(gid, second, "Bad share.");
  const statusOf = (id) => t.state.sessions.find((x) => x.id === id)?.status;
  await waitFor("failed", () => statusOf(second.id) === "failed");

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
  class Sent { async broadcast() { return JSON.stringify({ txid: "T1" }); } free() {} }
  t.setZ({ ...fakeZ, ChainWallet: Sent });
  t.setChain({ gid, bal: {}, sent: new Set(), syncing: true, cw: null });
  await t.broadcastTx(live());
  await waitFor("sent", () => live().status === "broadcast");
  assert.deepEqual([live().broadcastTxid, data.get(path3).sentBy >= 1], ["T1", true]);
  assert.equal(t.state.ignored, 0, "nothing of an honest wallet is ignored");

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
    seat3.sol = { ...sol3, used: { d3: "s" } };   // Solana digests that another tab used
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
    await t.putSec(gid, 3, { m5Flag: undefined, marks: marks3, sol: sol3 });
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
    assert.equal(data.get(pathC).error, "The payment changed after a signer approved it.");
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
      [false, "The payment changed after a signer approved it."]);
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
    const said = (x) => x.includes("seat 1: its nonce for this payment is used or gone");
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
    t.setChain({ gid, url: "https://lwd.test", bal: { spendable: 1e8, pending: 0, height: 4500000 },
      balAt: Date.now(), received: [], sent: new Set(), cw: { free() {} } });
    const bare = Array.from({ length: 9 }, (_, k) => far("v" + k, { by: 1 }));
    const picked = t.toWatch([...bare, far("vp", { by: 1, package: "P" })]).map((x) => x.id);
    assert.deepEqual([picked.length, picked[0], picked.includes("v8")], [8, "vp", false],
      "at most 8, a package first, then the newest");
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
  t.openGroup(B);
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
  t.proposeRequest(one, { name: "Alice (seat 2)", verdict: "yes" }, gid);
  assert.deepEqual([t.ui.send, t.ui.sendFor, t.ui.note],
    [true, gid, "Request from Alice (seat 2)"]);
  // The note goes to every approver. A message of a sender that is not verified can carry any
  // name, so the name stays out of the note.
  for (const verdict of ["no", "changed", "unknown", "wait"]) {
    t.proposeRequest(one, { name: "Alice (seat 2)", verdict }, gid);
    assert.equal(t.ui.note, "Request from an unverified sender", verdict);
  }
  t.proposeRequest(one, { name: "a memo", verdict: "memo" }, gid);
  assert.equal(t.ui.note, "Request from a memo");
  t.proposeRequest(one, { name: "Alice (seat 2)", verdict: "yes" }, gid);
  assert.deepEqual(t.ui.pay.map(({ to, amt, memo: m }) => ({ to, amt, m })),
    [{ to: other, amt: "1.5", m: "October rent" }]);
  assert.equal(JSON.stringify([...data]), saved, "Propose this writes nothing to the store");
  t.proposeRequest(one, { name: "You (seat 1)", verdict: "yes", mine: true }, gid);
  assert.equal(t.ui.note, "Request from the proposer", "an approver is not \"You\"");
  const roomName = t.groupName(gid);
  t.proposeRequest(one, { name: "Bob (seat 2)", verdict: "yes" }, B);
  await waitFor("wallet B", () => t.state.gid === B);
  assert.deepEqual([t.ui.send, t.ui.note, t.ui.pay.length],
    [true, "Request from Bob (seat 2) in " + roomName, 1],
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
    createElement: (tag) => new Rec(tag), createTextNode: (text) => ({ text }),
  };
  try {
    const setBal = (spendable) => t.setChain({ gid, bal: { spendable, pending: 0 }, received: [],
      sent: new Set(["T1"]), cw: null });
    setBal(0);
    assert.equal(t.sendBlocker(), "This wallet has no funds yet.");
    setBal(10000);
    assert.equal(t.sendBlocker(), "The balance does not cover the network fee.");
    setBal(1e8);
    const card = (req, verdict, dm = false, name = "Alice") =>
      t.requestCard(req, { id: "m1", name, verdict, dm });
    let c = card(okReq, "yes", false, "Alice (seat 2)");
    assert.match(textOf(c), /^Payment request1\.00ZEC/);
    assert.match(textOf(c), /FromAlice \(seat 2\) · ✓ Verified/);
    assert.deepEqual(callouts(c), [], "a verified sender gets no warning");
    assert.equal(named(c, "button", "Propose this").attrs.disabled, undefined);
    named(c, "button", "Propose this").on.click();
    assert.deepEqual([t.ui.send, t.ui.note, t.ui.pay[0].amt],
      [true, "Request from Alice (seat 2)", "1"]);
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
    assert.match(textOf(c), /You hold no seat in a testnet wallet\./);
    assert.equal(named(c, "button", "Propose this").attrs.disabled, "");
    c = card(t.requestOf(`zcash:${mainAddr}`, true), "yes", true);
    assert.match(textOf(c), /You hold no seat in a mainnet wallet\./);
    assert.match(textOf(c), /Payment requestMainnet/, "a chat card names the network");

    // The Send form starts with the note of the request.
    t.ui.note = "Request from Alice";
    t.ui.pay = null;
    const dialog = t.sendDialog();
    assert.equal(all(dialog, (x) => x.attrs.id === "s-note")[0].attrs.value, "Request from Alice");

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
    assert.match(textOf(form), /You hold no seat in a wallet that can receive a request/);
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
    assert.equal(named(blocked, "button", "Propose payment").attrs.disabled, "");
    assert.match(textOf(blocked), /Wait for the first sync to finish\./);
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
    assert.equal(named(t.sendDialog(), "button", "Propose payment").attrs.disabled, undefined);

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
    assert.equal(textOf(t.statusChip(proposal)), "Needs approval");
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

    const sentOne = { id: "x2", pczt: "EXP1", status: "broadcast", signed: "s", broadcastTxid: "t5",
      final: { txid: "t5", tx_hex: "00" }, broadcastAt: Date.now() };
    t.state.sessions.push(sentOne);
    tipAt(4500000);
    assert.deepEqual(t.finishButtons(sentOne), [], "no Send again before 10 minutes");
    sentOne.broadcastAt = Date.now() - 11 * 60 * 1000;
    assert.deepEqual(labels(t.finishButtons(sentOne)), ["Send again"]);
    tipAt(4503453);
    assert.deepEqual(t.finishButtons(sentOne), [], "a node refuses it now");
    assert.match(textOf(t.expiryLine(sentOne)), /can no longer go to the network/);
    tipAt(4503459);
    // After signing, only the engine can say "Expired" (TICKETS.md ZEC-13): the chip asks to check.
    assert.equal(textOf(t.statusChip(sentOne)), "Check");
    const unmarkedOne = { ...proposal, id: "x5", signed: "s", final: { txid: "f", tx_hex: "00" },
      broadcastError: "timeout" };
    assert.equal(textOf(t.statusChip(unmarkedOne)), "Check");
    // One seat can rewrite the proposal of a signed payment, so after signing the page never says
    // that no block holds it and never offers "Propose again": it asks the signers to check.
    for (const signedOne of [sentOne, unmarkedOne]) {
      assert.equal(t.expired(signedOne), true);
      assert.deepEqual(t.nextAction(signedOne, null, { rows: [], extra: [] }), []);
      assert.match(textOf(t.expiryLine(signedOne)), /cannot prove that the signers signed/);
    }
    const falseId = callouts(t.txDetails(unmarkedOne)).join(" ");
    assert.match(falseId, /names the id f…f, but the proposal gives the id realtx…realtx/);
    tipAt(4503459, new Set(["realtx"]));
    assert.equal(t.expired(sentOne), false);
    assert.equal(textOf(t.statusChip(unmarkedOne)), "Sent", "a block holds the approved one");
    assert.equal(t.expiryLine(unmarkedOne), null);
    tipAt(4500000);
    assert.deepEqual(labels(t.finishButtons(unmarkedOne)), ["Send again"]);
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
    t.state.sessions.splice(t.state.sessions.indexOf(move), 1);
    t.state.g = group;
    delete t.ready.MV1;

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
      assert.deepEqual(labels(t.nextAction(signedA, null, none)), ["Propose again"]);
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
      assert.match(textOf(t.sessionLayer(evilA)), /proposal changed after a seat of this browser/);
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
      t.setZ({ ...fakeZ, latestHeight: async () => 4500001, normalizeAddress: (a) => a,
        inspect: (p) => { if (!decodes[p]) throw new Error("unreadable"); return S(decodes[p]); },
        signCommit: () => S({ nonces: ["n"], commitments: ["c"] }) });

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
      const cancelled = { ...copied, error: "Cancelled by a seat." };
      assert.equal(textOf(t.statusChip(cancelled)), "Sent");
      const rewrittenSent = { ...signedA, broadcastTxid: "tx-b", final: { txid: "tx-b",
        tx_hex: "00" }, broadcastAt: 1 };
      put(rewrittenSent);
      at(4500100, new Set(["tx-a"]));
      assert.equal(t.inFlight().includes(rewrittenSent), false, "the approved one landed");
      assert.doesNotMatch(String(t.sendBlocker()), /waiting for its block/);

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
      // The Move button of the card proposes the move, and the click event is no PCZT.
      t.state.sessions = t.state.sessions.filter((x) => x.id !== "zm");
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
      assert.equal(textOf(t.statusChip(failedA)), "Confirming");
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
      assert.match(String(t.sendBlocker()), /approved can still go on chain|waiting for its block/);
      // Path A of QA round 4: no sent mark ever comes, and one seat writes a failure part.
      put({ ...h1, package: "PK", signed: "SA", status: "failed", error: "Failed." });
      at(4500101);
      assert.ok(t.heldApprovals().includes("h1"), "an error part ends no hold");
      // Path B: the document leaves the list (a rewrite that fails its check drops it).
      t.state.sessions = t.state.sessions.filter((x) => x.id !== "h1");
      at(4500102);
      const askedFrom = asked.length;
      assert.ok(t.heldApprovals().includes("h1"), "a dropped document ends no hold");
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
      // Without the kept PCZT the ceiling ends it: 4,500,001 + 1 + 6,912 + 3.
      await t.putSec(t.state.gid, me, { marks: { ...t.sec(t.state.gid, me).marks,
        h2: { approved: "zz", tip: 4500001 }, h3: { approved: "zz" } } });
      at(4506916);
      assert.ok(t.heldApprovals().includes("h2"), "no PCZT: held up to the ceiling");
      assert.equal(t.heldApprovals().includes("h3"), false, "no height, no hold");
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
      // M5: the drawer says what the signature step waits for.
      const enough = Object.fromEntries(t.seatIds().slice(0, t.state.g.t).map((i) => [i, {}]));
      const drawn = (ss, shares) => {
        Object.assign(t.state, { commits: enough, shares });
        return textOf(t.sessionLayer(ss));
      };
      assert.match(drawn(open("w5", "PA"), {}),
        /Waiting for the proposer's browser to build the signing package/);
      const w5 = { ...open("w5", "PA"), package: "PK", signers: [me, other], status: "signing" };
      assert.match(drawn(w5, { [me]: {} }),
        /Signing · 1 of 2 shares\. Waiting for [^:,]+: each browser signs while this wallet/);
      Object.assign(t.state, { commits: {}, shares: {} });
      const mine = new Set(["za", "zh", "zs", "zp", "zw", "zf", "zn", "zx", "zl", "zm", "zr", "zq",
        "zv", "zy", "zu", "zt", "zk", "zj", "zg", "zz", "zal", "zho", "zc1", "zc2", "h1", "h4",
        "h5", "h5b", "h7", "h10"]);
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
      if (mid) mid();
      return "AAAA";
    } });
    const c = { gid: G, url: "https://lwd.test", cw: wallet(ids, plan), received: [] };
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
  await t.createPersonal("testnet");
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
  idbMap.set("personal:rec", await deviceSeal({ ...stored1, snapKey: "n".repeat(43) }));
  await t.rereadPersonal();
  assert.equal(t.acct.secret, "n".repeat(43), "the sync of the new key replaces the old one");
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
  await t.removeAccount();
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
    createElement: (tag) => new Rec(tag), createTextNode: (text) => ({ text }),
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
    }
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
    assert.match(textOf(c), /You hold no seat in a testnet wallet\./);
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
    for (const [typed, warned] of [["0.003", false], ["0.006", false], ["0.0060001", true],
      ["0.02", true], ["x", false], ["", false]]) {
      amount0.on.input({ target: { value: typed } });
      assert.equal(warnOf(form0).textContent, warned ? HIGH : "", typed);
    }
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
    assert.match(textOf(create), /Restore from backup/);
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
      /Back up seat 2.*opens your key share.*sign as this seat/);
    // The seat dialog and the note say why old files stop opening. The account file did not change.
    const CHANGED = /backup format changed on 16 October 2026\. Older backup files no longer open/;
    assert.match(textOf(t.backupDialog()), CHANGED);
    assert.match(textOf(t.backupDialog()), /Save a new backup now/);
    assert.match(textOf(t.backupNote([2])), CHANGED);
    assert.match(textOf(t.backupNote([2])), /Save a new backup now/);
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
    // And a save of another tab during the unlock comes in after it.
    const cidD = "fb".repeat(10), roomD = { ...roomU, key: "d".repeat(43) };
    const during = JSON.stringify(await seal(prfKey, rec0,
      { ...newer, chats: { profile: null, list: { [cidU]: roomU, [cidD]: roomD } } }));
    const subtleU = globalThis.crypto.subtle, decryptU = subtleU.decrypt.bind(subtleU);
    subtleU.decrypt = (...a) => { storage.set("zf-vault", during); return decryptU(...a); };
    await t.unlockVault();
    delete subtleU.decrypt;
    assert.deepEqual(t.chats.list[cidU], roomU, "the unlock opens the record of now");
    await waitFor("the save during the unlock", () => !!t.chats.list[cidD]);
    delete t.chats.list[cidU];
    delete t.chats.list[cidD];
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
    + "new backup on a device that still holds the seat");
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
  assert.match(t.banner.text, /^Restored seat 2 of Team\./);
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
  const OTHER = /: The message of seat 1 was made by another version of Zigs$/;
  assert.equal(Z.boxOpen(vecA, pkB, "g:1->2", box), text, "control: the vector opens");
  assert.throws(() => t.unboxFrom(1, 2, setUp(older)), OTHER, "version 2");
  assert.throws(() => t.unboxFrom(1, 2, setUp(box)), /: Seat 1 sent an unreadable message$/,
    "a box that opens with no JSON in it is another fault");
  assert.throws(() => t.unboxFrom(1, 2, setUp(5)), /: Seat 1 sent an unreadable message$/);

  // Version 1: the seat stops for good, and the text is the one of version 2.
  const s = setUp(older);
  await assert.rejects(t.round3V1(2), /another version of Zigs\. Do not use this wallet/);
  assert.match(t.sec(G, 2).aborted, /^The message of seat 1 was made by another version of Zigs\./);
  assert.equal(t.sec(G, 2).keyPackage, undefined, "no key share was made");
  assert.equal(s.aborted, t.sec(G, 2).aborted);
  t.secrets = {};
}

async function runAcctSync() {
  // The sync of the account that the 60 second timer starts.
  t.acct.syncing = false;
  await t.runSync(t.acct);
}

// Three paths of the page that no check above runs: a good action clears a bad banner, an arrow
// key moves the tab, and Leave chat asks first. Each one asks for the focus of a control, which
// the next redraw (120 ms later) takes. A recorder stands in for the page.
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
  globalThis.document = {
    activeElement: { dataset: { key: "send-ok" } },
    getElementById: (id) => ({ banner, "banner-text": bannerText })[id] ?? null,
    createElement: (tag) => new Rec(tag), createTextNode: (text) => ({ text }),
  };
  const ev = { preventDefault() {}, currentTarget: null };
  const key = (k) => ({ key: k, preventDefault() {} });
  const { tab, leave } = t.ui;
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

    const tabs = [["a", "A"], ["b", "B"], ["c", "C"]];
    t.ui.tab = "a";
    t.tabBar(tabs).on.keydown(key("ArrowRight"));
    assert.equal(t.ui.tab, "b", "the right arrow moves to the next tab");
    assert.deepEqual(t.wantFocus, { key: "tab-b", force: true }, "and the focus goes with it");
    t.tabBar(tabs).on.keydown(key("End"));
    assert.equal(t.ui.tab, "c");
    t.tabBar(tabs).on.keydown(key("ArrowRight"));
    assert.equal(t.ui.tab, "a", "the right arrow wraps around");
    t.tabBar(tabs).on.keydown(key("x"));
    assert.equal(t.ui.tab, "a", "another key changes nothing");

    t.ui.leave = false;
    const ask = t.leaveBox("chat-id").kids[0];
    assert.equal(ask.attrs["data-key"], "leave-ask");
    ask.on.click();
    assert.equal(t.ui.leave, true, "Leave chat asks first");
    assert.deepEqual(t.wantFocus, { key: "leave-no", force: true }, "and the focus goes to Cancel");
  } finally {
    globalThis.document = realDocument;
    Object.assign(t.ui, { tab, leave });
  }
  await sleep(200);
}

// ── Opening another wallet drops the notes of an expired payment of the open one ──
t.ui.after = "PA";
t.openGroup(null);
assert.equal(t.ui.after, null);

console.log("app ok");
process.exit(0);
