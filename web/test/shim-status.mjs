// The link state of web/shim.js (S1 of docs/hackathon-release.md): connecting, open, retrying
// with the HTTP status of a refusal, the wallet list that waits for each group, the error
// callback, and the send timeout. A fake WebSocket, a fake fetch and a virtual clock stand in for
// the browser. Also the text of the status line (linkWords in web/app-engine.js).
// Run: node web/test/shim-status.mjs   (Node 26)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const code = readFileSync(new URL("../shim.js", import.meta.url), "utf8");
const G1 = "a".repeat(20), G2 = "b".repeat(20);

/** Runs shim.js on a virtual clock. `answer` is the status that the probe fetch gets. */
function load() {
  let now = 1_000_000;
  const timers = [];
  const sockets = [], fetched = [];
  const page = { answer: 429 };
  class WebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    constructor(url) {
      Object.assign(this, { url, readyState: 0, sent: [] });
      sockets.push(this);
    }
    send(text) { this.sent.push(JSON.parse(text)); }
    close() { this.readyState = 3; this.onclose?.(); }
    // Test helpers: the server takes the socket, sends a message, or refuses it.
    up() { this.readyState = 1; this.onopen?.(); }
    say(m) { this.onmessage?.({ data: JSON.stringify(m) }); }
    refuse() { this.close(); }
  }
  const setTimeout = (fn, ms) => {
    const t = { at: now + ms, fn, live: true };
    timers.push(t);
    return t;
  };
  const clearTimeout = (t) => { if (t) t.live = false; };
  const sandbox = {
    WebSocket, setTimeout, clearTimeout, console: { error: console.error, log: console.log },
    Date: { now: () => now },
    location: { protocol: "https:", host: "app.zigs.app" },
    localStorage: { getItem: () => null, setItem() {} },
    crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000000" },
    fetch: async (url) => { fetched.push(url); return { status: page.answer }; },
    window: { addEventListener() {} },
    document: { getElementById: () => null },
  };
  runInNewContext(code, sandbox);
  // Runs every timer that is due by now + ms, in time order.
  const advance = async (ms) => {
    const end = now + ms;
    for (;;) {
      const due = timers.filter((t) => t.live && t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      due.live = false;
      due.fn();
      await settle();
    }
    now = end;
  };
  return { sandbox, sockets, fetched, page, advance, now: () => now };
}
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const plain = (x) => JSON.parse(JSON.stringify(x));   // an object of the vm realm, as a plain one

// ── Idle, connecting, open ──
{
  const p = load();
  const link = await p.sandbox.window.zigs.use("link");
  const db = await p.sandbox.window.zigs.use("db");
  const heard = [], errors = [];
  const stop = link.watch((s) => heard.push(s.state + (s.groups[G1]?.loaded ? "+" : "")));
  db.collection("groups").onSnapshot(() => {}, (e) => errors.push(e));
  assert.deepEqual(heard, ["idle"], "watch calls at once");
  db.join(G1);
  assert.equal(p.sockets.length, 1);
  assert.equal(p.sockets[0].url, "wss://app.zigs.app/ws?g=" + G1);
  assert.equal(link.now().state, "connecting");
  p.sockets[0].up();
  assert.equal(link.now().state, "open");
  assert.deepEqual(plain(link.now().groups[G1]),
    { open: true, loaded: false, failed: false, retryAt: 0 });
  p.sockets[0].say({ type: "init", docs: [] });
  assert.equal(link.now().groups[G1].loaded, true);
  assert.deepEqual(heard, ["idle", "connecting", "open", "open+"],
    "a listener hears the join, the open socket and the load");
  // A second group: the link is open only when every socket is open.
  db.join(G2);
  assert.equal(link.now().state, "connecting", "one socket still connects");
  assert.equal(heard.at(-1), "connecting+", "and the listener hears it");
  p.sockets[1].up();
  assert.equal(link.now().state, "open");
  stop();
  const count = heard.length;
  p.sockets[0].close();
  assert.equal(heard.length, count, "a stopped listener hears nothing more");
  assert.equal(errors.length, 0, "a group that loaded and dropped calls no error callback");
  assert.equal(link.now().state, "retrying", "a dropped socket retries");
  assert.equal(p.fetched.length, 0, "a socket that was open needs no probe");
  console.log("ok  idle, connecting, open, and a drop that retries");
}

// ── A refused socket: the wallet list stops waiting, the error callback, the probe ──
{
  const p = load();
  const db = await p.sandbox.window.zigs.use("db");
  const link = await p.sandbox.window.zigs.use("link");
  let lists = 0;
  const errors = [];
  db.join(G1);
  db.join(G2);
  db.collection("groups").onSnapshot(() => lists++, (e) => errors.push(e));
  assert.equal(lists, 0, "the wallet list waits while sockets open");
  p.sockets[0].up();
  p.sockets[0].say({ type: "init", docs: [] });
  await p.advance(5000);
  assert.equal(lists, 0, "no blind timeout: the list still waits for the second group");
  const before = p.now();
  p.sockets[1].refuse();
  await settle();
  assert.equal(lists, 1, "a group that failed once lets the list show");
  assert.equal(errors.length, 1, "the error callback hears it");
  assert.match(errors[0].message, /The group server did not answer/);
  assert.deepEqual(p.fetched, ["https://app.zigs.app/ws?g=" + G2], "one probe of the same address");
  const s = link.now();
  assert.equal(s.state, "retrying");
  assert.equal(s.code, 429, "the probe gives the HTTP status");
  assert.equal(s.retryAt, before + 1000, "the first retry comes after 1 s");
  // The retries grow, and the probe runs at most once in 30 s.
  await p.advance(1000);
  assert.equal(p.sockets.length, 3, "a new socket after the delay");
  p.sockets[2].refuse();
  assert.equal(link.now().retryAt, p.now() + 2000, "the next delay is 2 s");
  assert.equal(p.fetched.length, 1, "no second probe within 30 s");
  assert.equal(errors.length, 1, "the error callback hears only the first failure");
  await p.advance(30_000);
  p.sockets.at(-1).refuse();
  await settle();
  assert.equal(p.fetched.length, 2, "a probe again after 30 s");
  // 426 means that the server would take a socket: the reason is not known.
  p.page.answer = 426;
  await p.advance(31_000);
  p.sockets.at(-1).refuse();
  await settle();
  assert.equal(link.now().code, null, "426 is no refusal code");
  // The group comes back: the state is open, no code stays, and it is no failed group now.
  p.page.answer = 429;
  await p.advance(60_000);
  p.sockets.at(-1).refuse();
  await settle();
  assert.equal(link.now().code, 429);
  await p.advance(60_000);
  p.sockets.at(-1).up();
  p.sockets.at(-1).say({ type: "init", docs: [] });
  assert.equal(link.now().state, "open");
  assert.equal(link.now().code, null, "an open socket clears the code");
  assert.deepEqual([link.now().groups[G2].failed, link.now().groups[G2].retryAt], [false, 0]);
  // A drop after the group loaded calls no error callback, and no old code shows.
  p.sockets.at(-1).close();
  assert.equal(errors.length, 1, "no error callback for a group that loaded");
  assert.equal(link.now().code, null, "a plain drop shows no old code");
  console.log("ok  a refused socket: the list shows, one error callback, a probe each 30 s");
}

// ── The probe answer, the earliest retry, and callbacks that throw ──
{
  const p = load();
  const db = await p.sandbox.window.zigs.use("db");
  const link = await p.sandbox.window.zigs.use("link");
  // A probe that answers after the socket opened again is old: it gives no code.
  let answer;
  p.sandbox.fetch = (url) => { p.fetched.push(url); return new Promise((r) => { answer = r; }); };
  db.join(G1);
  p.sockets[0].refuse();
  await p.advance(1000);
  p.sockets[1].up();
  answer({ status: 429 });
  await settle();
  assert.equal(link.now().code, null, "an answer after the socket opened is old");
  p.sockets[1].close();   // G1 waits 2 s now: its delay doubled
  assert.equal(link.now().code, null, "and it does not show at the next drop");
  // Two late groups: retryAt is the earliest try.
  db.join(G2);
  p.sockets[2].refuse();   // G2 waits 1 s
  const { groups: g } = link.now();
  assert.ok(g[G1].retryAt > g[G2].retryAt, "each group has its own retryAt");
  assert.equal(link.now().retryAt, g[G2].retryAt, "the page shows the earliest try");
  // A listener or an error callback that throws does not stop the others.
  const q = load();
  const qdb = await q.sandbox.window.zigs.use("db");
  const qlink = await q.sandbox.window.zigs.use("link");
  const quiet = { error() {} };
  q.sandbox.console.error = quiet.error;
  const heard = [], told = [];
  let armed = false;   // the first call comes from watch() itself, to its own caller
  qlink.watch(() => { if (armed) throw new Error("boom"); });
  armed = true;
  qlink.watch((s) => heard.push(s.state));
  qdb.join(G1);
  qdb.join(G2);
  qdb.collection("groups").onSnapshot(() => {}, () => { throw new Error("boom"); });
  qdb.collection("groups").onSnapshot(() => {}, (e) => told.push(e.message));
  q.sockets[0].refuse();
  q.sockets[1].refuse();
  assert.equal(heard.at(-1), "retrying", "the second listener still hears");
  assert.equal(told.length, 1, "the second callback hears once, not once for each group");
  console.log("ok  an old probe answer, the earliest retry, and callbacks that throw");
}

// ── A socket that hangs while it connects counts as refused ──
{
  const p = load();
  const db = await p.sandbox.window.zigs.use("db");
  const link = await p.sandbox.window.zigs.use("link");
  db.join(G1);
  await p.advance(9_999);
  assert.equal(link.now().state, "connecting");
  await p.advance(1);
  assert.equal(link.now().state, "retrying", "closed after 10 s");
  assert.equal(link.now().groups[G1].failed, true);
  console.log("ok  a hanging socket is closed after 10 s");
}

// ── send(): a timeout after 10 s, and nothing is sent late ──
{
  const p = load();
  const db = await p.sandbox.window.zigs.use("db");
  const write = db.doc("groups/" + G1 + "/seats/1").set({ a: 1 });
  let failed = null;
  write.catch((e) => { failed = e; });
  await p.advance(10_000);
  assert.match(failed?.message ?? "", /The group server did not answer/, "the write fails");
  p.sockets[0].up();
  p.sockets[0].say({ type: "init", docs: [] });
  await settle();
  assert.deepEqual(p.sockets[0].sent, [], "a write that failed is never sent after that");
  // An open, loaded group: the write goes out, and its reply answers it.
  const ok = db.doc("groups/" + G1 + "/seats/2").set({ b: 2 });
  await settle();
  const [sent] = p.sockets[0].sent;
  assert.equal(sent.op, "set");
  p.sockets[0].say({ type: "reply", rid: sent.rid, ok: true, result: "done" });
  assert.equal(await ok, "done");
  // A reply that comes after the timeout finds nothing to answer.
  const slow = db.doc("groups/" + G1 + "/seats/3").set({ c: 3 });
  let slowError = null;
  slow.catch((e) => { slowError = e; });
  await settle();
  const late = p.sockets[0].sent.at(-1);
  await p.advance(10_000);
  assert.match(slowError?.message ?? "", /did not answer/);
  p.sockets[0].say({ type: "reply", rid: late.rid, ok: true, result: "late" });
  console.log("ok  a write times out after 10 s and is never sent late");
}

// ── What the status line shows ──
await import("./sol-rig.mjs");   // the stub page that the page modules need
const { linkView } = await import("../app-engine.js");
const at = 5_000_000;
const retrying = (code, wait) => ({ state: "retrying", code, retryAt: at + wait });
for (const state of ["idle", "open"]) {
  assert.equal(linkView({ state }, at).show, false, "no line while the link is " + state);
}
assert.deepEqual(linkView({ state: "connecting" }, at),
  { show: true, dot: "busy", text: "Connecting to the group server…", wait: "" });
const NO = "The group server does not answer";
const views = [
  [retrying(429, 12_000), NO + " (too many connections from this network).", " Next try in 12 s."],
  [retrying(401, 1), NO + " (the preview password is missing or wrong).", " Next try in 1 s."],
  [retrying(0, 3_000), NO + " (no network).", " Next try in 3 s."],
  [retrying(503, 2_500), NO + " (the server has a problem).", " Next try in 3 s."],
  [retrying(null, 0), NO + ".", " Trying again now."],
  [retrying(404, -5), NO + ".", " Trying again now."],
];
for (const [s, text, wait] of views) {
  assert.deepEqual(linkView(s, at), { show: true, dot: "bad", text, wait }, JSON.stringify(s));
}
console.log("ok  the status line shows a link that is not open, with its reason");
console.log("shim-status: ok");
process.exit(0);
