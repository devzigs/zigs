// The light-wallet fallback (S9 of docs/hackathon-release.md): a server that did not answer goes
// to the end of the list for 5 minutes (preferredServers), the first try waits 3 s, a sync that
// gets no blocks for 60 s stops and frees the busy flag, and a tab that comes back syncs at once.
// The engine is a fake. Timers of a second or more run 100 times faster.
// Run: node web/test/chain-fallback.mjs   (Node 24)
import assert from "node:assert/strict";
import { loadRig, sleep } from "./sol-rig.mjs";

const rig = await loadRig();
const { t } = rig;
const chainMod = await import("../app-chain.js");
const { NETWORKS, pickServer, preferredServers, runSync, syncOnReturn } = chainMod;
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
console.log("chain-fallback: ok");
process.exit(0);
