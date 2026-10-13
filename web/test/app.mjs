// Drives the real web/app.js with a stub page and an in-memory store, for the version 3 rules that
// need the whole page: the pins, the filter, the writers and the ceremony.
// Run: node web/test/app.mjs
// The test loads a copy of app.js that also exports a few inner names (see HOOKS).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Z from "../pkg/zec_frost_wasm.js";
import { newSignKey, signMsg, verifyMsg } from "../chat.js";

const web = new URL("../", import.meta.url);
Z.initSync({ module: fs.readFileSync(new URL("pkg/zec_frost_wasm_bg.wasm", web)) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A page that does nothing: any property is a function that returns the page again.
const stub = () => new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : stub()),
  apply: () => stub(), construct: () => stub(), set: () => true, has: () => true,
});
const storage = new Map();
Object.assign(globalThis, {
  Node: class {}, document: stub(), history: { replaceState() {} }, requestAnimationFrame: () => 0,
  matchMedia: () => ({ matches: false }),
  location: { hash: "", href: "http://localhost/", origin: "http://localhost" },
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => { storage.set(k, String(v)); }, removeItem: (k) => { storage.delete(k); },
  },
  // The engine takes its random numbers from window.crypto in a page.
  window: new Proxy(stub(), { get: (t, k) => (k === "crypto" ? globalThis.crypto : t[k]) }),
});

const HOOKS = `
export const T = {
  state, raw, signPins, docMemo, loggedIgnored, inbox,
  get secrets() { return secrets; }, set secrets(v) { secrets = v; },
  get gkeys() { return gkeys; }, set gkeys(v) { gkeys = v; },
  get signing() { return signing; },
  setZ(m) { Z = m; }, setDb(v) { sdb = v; db = v; }, setMe(v) { me = v; },
  setChain(v) { chain = v; },
  cleanGroup, refilter, sigPart, signedDoc, canWriteAs, writer, named, proposer, signedMode,
  localSeats, seatIds, openGroup, createGroup, takeSeat, newSpend, cancelPayment, failSession,
  finalizeTx, broadcastTx, sec, proposalFields, openDoc, recipientCheck,
  runMemos, runSync, setMemoReading, readsMemos,
  ui, ready, requestOf, proposeRequest, proposeWallets, dmChoices, fillFromRequest, requestCard,
  composer, roomRequest, chatRequest, memoBody, sendDialog, submitRequest, typingMessage,
  balCache, busy, groupName, sendBlocker,
  get banner() { return banner; },
};
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zigs-app-"));
let source = fs.readFileSync(new URL("app.js", web), "utf8");
source = source.replace(/from "\/(\w+\.js)"/g, (_, f) => `from "${new URL(f, web).href}"`);
source = source.replace(/^loadEngine\(\)\.then.*$/m, "").replace(/^draw\(\);.*$/m, "");
fs.writeFileSync(path.join(dir, "app.mjs"), source + HOOKS);
const { T: t } = await import(path.join(dir, "app.mjs"));
fs.rmSync(dir, { recursive: true });
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

console.log("app ok");
process.exit(0);
