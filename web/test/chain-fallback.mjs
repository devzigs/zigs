// The light-wallet fallback (S9 of docs/hackathon-release.md): a server that did not answer goes
// to the end of the list for 5 minutes (preferredServers), the first try waits 3 s, a sync that
// gets no blocks for 60 s stops and frees the busy flag, and a tab that comes back syncs at once.
// A wallet object is freed only when no engine call on it runs (ZEC-16).
// The engine is a fake. Timers of a second or more run 100 times faster.
// Run: node web/test/chain-fallback.mjs   (Node 26)
import assert from "node:assert/strict";
import { loadRig, sleep } from "./sol-rig.mjs";

const rig = await loadRig();
const { t } = rig;
const chainMod = await import("../app-chain.js");
const { NETWORKS, pickServer, preferredServers, runSync, syncOnReturn } = chainMod;
const { release, track } = await import("../app-kit.js");
const net = NETWORKS.testnet;
const [LWD, CHAINSAFE] = net.servers;
assert.ok(LWD.endsWith("/lwd") && CHAINSAFE.includes("chainsafe"), "the two testnet servers");

const realTimeout = globalThis.setTimeout;
const fast = () => {
  globalThis.setTimeout = (fn, ms, ...a) => realTimeout(fn, ms >= 1000 ? ms / 100 : ms, ...a);
};
const slow = () => { globalThis.setTimeout = realTimeout; };
const realNow = Date.now;
const later = (ms) => { const at = realNow(); Date.now = () => realNow() - at + at + ms; };
const now = () => { Date.now = realNow; };

// The engine: latestHeight answers per server, and a fake chain wallet.
const asked = [];
let answer = {};
const height = (url) => {
  asked.push(url);
  const how = answer[url] ?? "ok";
  if (how === "ok") return Promise.resolve(1000);
  if (how === "down") return Promise.reject(new Error("down"));
  if (how === "hang") return new Promise(() => {});
  return new Promise((res) => realTimeout(() => res(1000), how));   // a number: ms of real time
};
const BAL = JSON.stringify({ height: 1000, spendable: 0, pending: 0 });
const restoredFrom = [];
class FakeWallet {
  // The engine: a new object, or one restored from the state of another (connect in app-chain.js).
  static restore(_ufvk, _birthday, url, snap) {
    restoredFrom.push(snap);
    return new FakeWallet(async () => BAL, url);
  }
  constructor(script, url) { Object.assign(this, { script, url, freed: false, calls: 0 }); }
  sync(progress) { this.calls++; this.progress = progress; return this.script(progress); }
  received() { return "[]"; }
  sent() { return "[]"; }
  memoNeeds() { return "[]"; }
  snapshot() { return JSON.stringify({ from: this.name ?? "fresh" }); }
  balance() { return BAL; }
  free() { this.freed = true; }
}
t.setZ({ ...rig.Z, latestHeight: height, isDeepReorg: () => false, ChainWallet: FakeWallet });

// ── A server that did not answer goes last for 5 minutes ──
assert.deepEqual(preferredServers(net), [LWD, CHAINSAFE]);
answer = { [LWD]: "down" };
assert.equal(await pickServer(net), CHAINSAFE);
assert.deepEqual(asked, [LWD, CHAINSAFE]);
assert.deepEqual(preferredServers(net), [CHAINSAFE, LWD], "the failed server goes last");
asked.length = 0;
assert.equal(await pickServer(net), CHAINSAFE);
assert.deepEqual(asked, [CHAINSAFE], "the next pick does not wait for it");
later(5 * 60000 - 1000);
assert.deepEqual(preferredServers(net), [CHAINSAFE, LWD], "still last before 5 minutes");
later(5 * 60000 + 1000);
assert.deepEqual(preferredServers(net), [LWD, CHAINSAFE], "first again after 5 minutes");
answer = {};
assert.equal(await pickServer(net), LWD);
now();
console.log("ok  a failed server goes last for 5 minutes");

// ── /lwd in its first place waits 3 s; a fallback and the only server wait 8 s ──
fast();
later(20 * 60000);   // no server failed in the last 5 minutes
answer = { [LWD]: 50 };   // 50 ms real: over 3 s and under 8 s, scaled
assert.equal(await pickServer(net), CHAINSAFE, "a slow /lwd gives way after 3 s");
answer = { [LWD]: "hang", [CHAINSAFE]: 50 };
asked.length = 0;
assert.equal(await pickServer(net), CHAINSAFE, "the fallback gets the longer wait");
assert.deepEqual(asked, [CHAINSAFE], "/lwd failed, so ChainSafe is first now");
answer = { [LWD]: "down", [CHAINSAFE]: 50 };
assert.equal(await pickServer(net), CHAINSAFE, "a fallback in the first place still waits 8 s");
const main = NETWORKS.mainnet;
answer = { [main.servers[0]]: 50 };
assert.equal(await pickServer(main), main.servers[0], "the only server of mainnet waits 8 s");
answer = { [CHAINSAFE]: "hang", [LWD]: "hang" };
const PLAIN = /^Error: No light-wallet server answers\. Check your connection\.$/;
await assert.rejects(pickServer(net), PLAIN, "no server: a click gets the plain text");
const none = { gid: "noserveraaaaaaaaaaaa", net, cw: null, url: null, account: true,
  syncing: false };
t.setChain(none);
await runSync(none);
assert.match(none.error, /Check your connection\. The page tries again by itself\.$/,
  "a sync says that the page tries again");
slow();
now();
console.log("ok  /lwd first waits 3 s; a fallback and the only server wait 8 s");

// ── A sync that gets no blocks for 60 s stops ──
answer = {};
later(40 * 60000);   // the failures above are older than 5 minutes now
fast();
const url = await pickServer(net);
const stuck = new FakeWallet((progress) => {
  progress(JSON.stringify({ done: 1 }));
  realTimeout(() => progress(JSON.stringify({ done: 2 })), 300);
  return new Promise(() => {});
});
stuck.name = "stuck";
const before = { height: 900, spendable: 5, pending: 0 };   // an earlier sync
const c = { gid: "fallbackaaaaaaaaaaaa", net, cw: stuck, url, account: true, syncing: false,
  bal: before, sent: new Set(), prog: null, error: null };
t.setChain(c);
const t0 = realNow();
await runSync(c);
const took = realNow() - t0;
slow();
assert.ok(took >= 850 && took < 1300, "it stopped 60 s (scaled) after the last batch: " + took);
assert.match(c.error, /The light-wallet server stopped sending blocks\. The page tries again by/);
assert.deepEqual([c.syncing, c.url], [false, null], "the busy flag is free");
assert.equal(c.cw, stuck, "the stalled wallet stays, so a payment still finds a wallet object");
assert.equal(c.bal, before, "and the balance of the earlier sync stays");
assert.equal(stuck.freed, false, "the engine may still use the stalled wallet: not freed");
assert.equal(preferredServers(net).at(-1), url, "the stalled server goes last");
stuck.progress(JSON.stringify({ done: 3 }));
assert.equal(c.prog, null, "a late batch of the stalled wallet changes nothing");
// The next sync starts a new object from the state of the stalled one, and never frees it.
fast();
await runSync(c);
slow();
assert.equal(c.error, null, "the next sync works");
assert.notEqual(c.cw, stuck, "on a new wallet object");
assert.equal(restoredFrom.at(-1), JSON.stringify({ from: "stuck" }), "from the stalled state");
assert.deepEqual([stuck.freed, c.stalled], [false, null], "the stalled object is not freed");
now();
console.log("ok  a stalled sync stops after 60 s, frees the busy flag and keeps the wallet");

// ── A long sync that gets blocks goes on ──
fast();
const steady = new FakeWallet(async (progress) => {
  for (let i = 0; i < 6; i++) {
    progress(JSON.stringify({ done: i }));
    await sleep(250);   // 1.5 s in all, more than the scaled 60 s, but never 60 s without a batch
  }
  return BAL;
});
const d = { ...c, cw: steady, url: await pickServer(net), error: null };
t.setChain(d);
await runSync(d);
slow();
assert.equal(d.error, null, "no stall while batches come");
assert.equal(d.bal.height, 1000);
console.log("ok  a long sync that gets blocks goes on");

// ── A tab that comes back syncs when its last sync is older than 15 s ──
const realDoc = globalThis.document;
globalThis.document = { visibilityState: "visible" };
t.state.gid = d.gid;
t.setChain(d);
const calls = steady.calls;
steady.script = async () => BAL;
d.balAt = realNow() - 1000;
syncOnReturn();
await sleep(20);
assert.equal(steady.calls, calls, "a sync 1 s ago is new enough");
d.balAt = realNow() - 10000;
syncOnReturn();
await sleep(20);
assert.equal(steady.calls, calls, "a sync 10 s ago is new enough");
d.balAt = realNow() - 16000;
syncOnReturn();
await sleep(20);
assert.equal(steady.calls, calls + 1, "a sync 16 s ago runs again");
globalThis.document = { visibilityState: "hidden" };
d.balAt = 0;
syncOnReturn();
await sleep(20);
assert.equal(steady.calls, calls + 1, "a hidden tab does not sync");
globalThis.document = realDoc;
console.log("ok  a tab that comes back syncs at once");

// ── A wallet object is freed only when no engine call on it runs (ZEC-16) ──
// As in wasm-bindgen, free() throws while an async call holds the object.
const BORROWED = "attempted to take ownership of Rust value while it was borrowed";
class BusyWallet extends FakeWallet {
  constructor(url) { super(async () => BAL, url); Object.assign(this, { open: 0, frees: 0 }); }
  // A proposal or a message on the object, as the page tracks it, until the test ends it.
  call() {
    this.open++;
    let end;
    track(this, new Promise((res) => { end = () => { this.open--; res("{}"); }; }));
    return end;
  }
  free() {
    if (this.open) throw new Error(BORROWED);
    this.frees++;
  }
}
const idle = new BusyWallet(LWD);
release(idle);
release(idle);
const ended = new BusyWallet(LWD);
ended.call()();
await sleep(0);
release(ended);
assert.deepEqual([idle.frees, ended.frees], [1, 1], "an idle object is freed, and only once");
const chainOf = (cw, url) => ({ gid: "freeaaaaaaaaaaaaaaaa", net, cw, url, account: true,
  syncing: false, bal: before, sent: new Set(), prog: null, error: null });
// Another wallet opens while a proposal runs, or with no call.
const opened = new BusyWallet(LWD), endOpened = opened.call(), quiet = new BusyWallet(LWD);
t.setChain(chainOf(opened, LWD));
chainMod.dropChain();
t.setChain(chainOf(quiet, LWD));
chainMod.dropChain();
assert.deepEqual([opened.frees, quiet.frees], [0, 1], "dropChain leaves only a busy object");
// A sync moves to another server while a proposal on the old object runs.
answer = { [LWD]: "down" };
const moved = new BusyWallet(LWD), endMoved = moved.call(), m = chainOf(moved, LWD);
t.setChain(m);
await runSync(m);
assert.deepEqual([m.error, m.url, m.cw !== moved, moved.frees], [null, CHAINSAFE, true, 0],
  "connect moves on and leaves the busy object");
// A free that throws still leaves the new object on the chain.
const dead = new FakeWallet(async () => BAL, "https://gone.test"), dd = chainOf(dead, dead.url);
dead.free = () => { throw new Error("null pointer passed to rust"); };
t.setChain(dd);
await runSync(dd);
assert.deepEqual([dd.cw !== dead, dd.url], [true, CHAINSAFE], "connect sets the new object first");
// A stalled object whose call ended is freed at the next connect.
const late = new BusyWallet("https://gone.test"), lc = chainOf(late, late.url);
late.call()();
await sleep(0);
lc.stalled = late;
t.setChain(lc);
await runSync(lc);
assert.deepEqual([lc.url, lc.stalled, late.frees], [CHAINSAFE, null, 1], "freed after its call");
// The sync of a wallet that closed ends while a proposal on it runs.
const closed = new BusyWallet(CHAINSAFE), endClosed = closed.call();
const cl = chainOf(closed, CHAINSAFE);
t.setChain(null);
await runSync(cl);
assert.deepEqual([cl.error, closed.calls, closed.frees], [null, 1, 0], "the end of the sync too");
// A deep reorganisation drops the object while a proposal on it runs.
const deepZ = (e) => e === "deep";
t.setZ({ ...rig.Z, latestHeight: height, isDeepReorg: deepZ, ChainWallet: FakeWallet });
const deep = new BusyWallet(CHAINSAFE), endDeep = deep.call(), dc = chainOf(deep, CHAINSAFE);
deep.script = async () => { throw new Error("deep"); };
t.setChain(dc);
await runSync(dc);
assert.deepEqual([dc.cw, deep.frees], [null, 0], "the rescan drops the busy object");
assert.match(dc.error, /reorganised by more than the wallet can undo/);
for (const end of [endOpened, endMoved, endClosed, endDeep]) end();
// A broadcast that gets no answer: the next server is asked, and its object is freed.
const sentBy = [];
class SendWallet {
  constructor(_ufvk, _birthday, url) { Object.assign(this, { url, open: 0, frees: 0 }); }
  broadcast() {
    sentBy.push(this);
    if (this.url.includes("throws")) throw new Error("bad input");   // as the glue does at once
    if (this.url.includes("silent")) { this.open++; return new Promise(() => {}); }
    return Promise.resolve(JSON.stringify({ txid: "T1" }));
  }
  free() {
    if (this.open) throw new Error(BORROWED);
    this.frees++;
  }
}
t.setZ({ ...rig.Z, ChainWallet: SendWallet });
fast();
const sent = await t.broadcastAnywhere("00", { net: { servers: ["https://throws.test",
  "https://silent.test", "https://next.test"] }, ufvk: "u", birthday: 1 });
slow();
assert.deepEqual([sent.txid, sentBy.map((w) => [w.url, w.frees])], ["T1", [["https://throws.test",
  1], ["https://silent.test", 0], ["https://next.test", 1]]], "the next server sends it");
await assert.rejects(t.resendTx({ final: { tx_hex: 5 } }), /The finished transaction cannot be/);
t.setZ({ ...rig.Z, latestHeight: height, isDeepReorg: () => false, ChainWallet: FakeWallet });
console.log("ok  a wallet object is freed only when no engine call on it runs");

// ── A sync that a stall asked for again does not run for a wallet that closed meanwhile ──
const shut = new FakeWallet(async () => BAL, CHAINSAFE), sc = chainOf(shut, CHAINSAFE);
t.setChain(null);
sc.again = true;
await runSync(sc);
await sleep(20);
assert.deepEqual([shut.calls, sc.again, sc.syncing], [1, false, false], "one sync, then none");
console.log("ok  no sync again for a wallet that closed");

// ── A server that answers the height but fails the sync goes last (ZEC-17) ──
later(90 * 60000);   // the marks above are older than 5 minutes now
answer = {};
const synced = () => rig.waitFor("the syncs end", () => !bc.syncing);   // also the one at once
const broken = new FakeWallet(async () => {
  throw new Error("lightwalletd: GetTreeState failed");
}, LWD);
let bc = chainOf(broken, LWD);
t.setChain(bc);
await runSync(bc);
await synced();
assert.deepEqual([bc.error, bc.url, preferredServers(net), broken.freed],
  [null, CHAINSAFE, [CHAINSAFE, LWD], true], "the next sync, at once, on the other server");
// Both servers fail the sync: one sync on each, then the page waits for the next refresh.
later(180 * 60000);
const tried = [], realRestore = FakeWallet.restore;
const failing = (url) => new FakeWallet(async () => {
  tried.push(url);
  throw new Error("lightwalletd returned no blocks for the requested range");
}, url);
FakeWallet.restore = (_ufvk, _birthday, url) => failing(url);
bc = chainOf(failing(LWD), LWD);
t.setChain(bc);
await runSync(bc);
await synced();
await sleep(50);
FakeWallet.restore = realRestore;
assert.deepEqual(tried, [LWD, CHAINSAFE], "no loop");
assert.match(bc.error, /^lightwalletd returned no blocks/);
// An error of the engine, not of the server, marks no server.
later(270 * 60000);
const own = new FakeWallet(async () => { throw new Error("the progress callback threw"); }, LWD);
bc = chainOf(own, LWD);
t.setChain(bc);
await runSync(bc);
await synced();
assert.deepEqual([own.calls, preferredServers(net)], [1, [LWD, CHAINSAFE]], "no server is marked");
t.setChain(null);
now();
console.log("ok  a server that fails the sync goes last, and the next server syncs at once");
console.log("chain-fallback: ok");
process.exit(0);
