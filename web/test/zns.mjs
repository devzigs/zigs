// The /zns route of cf/src/index.js and the page module web/zns.js. A fake resolver replaces
// fetch and Date.now is stubbed: no network, no wait. Run: node web/test/zns.mjs   (Node 24)
import assert from "node:assert/strict";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { ZNS_KEY, createRegistry, movedNote, nameOf, nameRefusal, registry, resolveRecipient,
  zecName } from "../zns.js";

crypto.subtle.timingSafeEqual ??= timingSafeEqual;
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const workerSource = read("../../cf/src/index.js");
let copies = 0; // a copy of the Worker has its own snapshot: the comment makes a new data: URL
const loadWorker = async () => {
  const code = workerSource.replace('import { DurableObject } from "cloudflare:workers";',
    "const DurableObject = class {};") + `\n// copy ${copies++}`;
  return (await import("data:text/javascript," + encodeURIComponent(code))).default;
};
const step = (name) => console.log(`ok  ${name}`);
const hex = (n) => n.toString(16).padStart(64, "0");
const addr = (tag) => "utest1" + String(tag).padEnd(40, "q");
const [A, C] = ["a", "c"].map(addr), B = "utest1" + "q".repeat(994); // B: the longest address
const MSG = "The ZNS registry cannot be read. Try again.";

// The fake resolver: a chain of events, the names that follow, and its three methods. `shift`
// repeats an item at a page boundary: a new event moves the newest-first list down.
const chain = { height: 1000, names: new Map(), events: [], shift: 0 };
let eventId = 0;
const act = (action, name, address, height) => {
  const txid = hex(++eventId), last_action = action, expires_at = "none";
  chain.events.push({ id: eventId, name, action, txid, height, address, expires_at });
  if (action === "release") chain.names.delete(name);
  else chain.names.set(name, { name, address, txid, height, last_action, expires_at });
};
const pageOf = (list, { limit, offset }, field) => {
  const at = offset ? offset - chain.shift : 0;
  return { [field]: list.slice(at, at + limit), total: list.length, limit, offset };
};
const answers = {
  status: () => ({ synced_height: chain.height, synced: true, viewing_key: ZNS_KEY }),
  list_names: (p) => pageOf([...chain.names.values()], p, "items"),
  events: (p) => pageOf(chain.events.filter((e) => e.height > p.since_height).reverse(), p,
    "events"),
};
const rpc = (call, result) => Response.json({ jsonrpc: "2.0", id: call.id, result });
const calls = [], named = [];
let fault = null; // (call) => a Response, nothing, or a throw
globalThis.fetch = async (url, init) => {
  const call = { url: String(url), init, ...JSON.parse(init.body) };
  calls.push(call);
  if ("name" in call.params) named.push(call);
  return fault?.(call) ?? rpc(call, answers[call.method](call.params));
};
const tamper = (method, edit) => (call) => {
  if (call.method !== method) return undefined;
  const result = structuredClone(answers[method](call.params));
  return edit(result), rpc(call, result);
};
const taken = () => calls.splice(0);
const methods = () => taken().map((c) => c.method);
let clock = 1_700_000_000_000;
Date.now = () => clock;
console.error = () => {}; // the 502 steps log their cause
const env = { DEV_NO_AUTH: "1", ASSETS: { fetch: async () => new Response("asset") } };
const ask = (worker, init = {}, e = env) =>
  worker.fetch(new Request("https://app.zigs.app/zns", init), e);
const later = (ms, w) => { clock += ms; return ask(w ?? worker); }; // a request ms later
const byName = async (res) => new Map((await res.json()).names.map((r) => [r.name, r]));
const fullLoad = () =>
  ["status", ...Array(Math.floor(chain.names.size / 500) + 1).fill("list_names")];
const pages = (extra) => [0, 500].map((offset) => ({ ...extra, limit: 500, offset }));

const worker = await loadWorker();
act("claim", "alice", A, 1);
act("claim", "bob", addr("bob"), 2);
for (let i = 0; i < 499; i++) act("claim", `n${i}`, addr(`n${i}`), 3 + i);
{
  const res = await ask(worker);
  const body = await res.json();
  assert.deepEqual([res.status, res.headers.get("content-type"), res.headers.get("cache-control")],
    [200, "application/json", "no-store"]);
  assert.deepEqual([body.network, body.key, body.height], ["test", ZNS_KEY, 1000]);
  assert.deepEqual(body.names.map((r) => r.name), [...chain.names.keys()].sort());
  const seen = taken();
  assert.deepEqual(seen.map((c) => c.method), fullLoad());
  assert.deepEqual(seen.slice(1).map((c) => c.params), pages({}));
  assert.equal((await later(59_999)).status, 200);
  assert.deepEqual(methods(), []);
  step("a full load reads the status and two pages; a request within 60 s makes no call");
}
{
  // alice moves twice: only the oldest-first order ends at C. Page 2 repeats the event of alice.
  act("update", "alice", B, 1001);
  act("release", "bob", addr("bob"), 1002);
  act("claim", "carol", addr("carol"), 1003);
  act("update", "alice", C, 1004);
  for (let i = 0; i < 499; i++) act("claim", `f${i}`, addr(`f${i}`), 1005 + i);
  Object.assign(chain, { height: 2000, shift: 1 });
  clock += 1;
  const all = await Promise.all([ask(worker), ask(worker), ask(worker)]);
  const seen = taken();
  assert.deepEqual(seen.map((c) => c.method), ["status", "events", "events"]);
  assert.deepEqual(seen.slice(1).map((c) => c.params), pages({ since_height: 1000 }));
  const got = await byName(all[0]);
  assert.deepEqual(got.get("alice"), { name: "alice", address: C, txid: hex(505), height: 1004,
    last_action: "update", expires_at: "none" });
  assert.ok(!got.has("bob") && got.get("carol").last_action === "claim" && got.size === 1000);
  step("a delta takes 503 events over two pages with one repeat, oldest first, in one refresh");
}
{
  Object.assign(chain, { height: 1900, shift: 0 }); // the resolver rolled back
  chain.names.delete("carol");
  const got = await byName(await later(60_000));
  assert.deepEqual(methods(), fullLoad());
  assert.ok(!got.has("carol") && got.size === 999);
  await later(3_540_000); // fullAt is 59 minutes old: still a delta
  assert.deepEqual(methods(), ["status", "events"]);
  await later(60_000); // fullAt is one hour old
  assert.deepEqual(methods(), fullLoad());
  step("a lower status height forces a full load; a delta follows; a full load after one hour");
}

const faults = {
  "a wrong registry key": tamper("status", (r) => { r.viewing_key = "uviewtest1other"; }),
  "an invalid event": tamper("events", (r) => { r.events[0].address = "utest1BAD"; }),
  "a JSON-RPC error": (c) => Response.json({ jsonrpc: "2.0", id: c.id, error: { code: -1 } }),
  "a status 503 upstream": () => new Response("down", { status: 503 }),
  "a fetch that throws": () => { throw new TypeError("fetch failed"); },
  "an invalid record in a full load": tamper("list_names", (r) => { r.items[5].txid = "xyz"; }),
};
for (const [label, make] of Object.entries(faults)) {
  const w = await loadWorker(), fresh = label.endsWith("full load"), zed = "zed" + eventId;
  if (!fresh) await ask(w);
  act("claim", zed, addr("zed"), ++chain.height);
  fault = make;
  const res = await later(60_000, w);
  assert.deepEqual([res.status, await res.text()],
    [502, "The ZNS registry could not be read.\n"], label);
  fault = null;
  taken();
  assert.ok((await byName(await ask(w))).has(zed), label);
  const seen = taken();
  assert.deepEqual(seen.map((c) => c.method), fresh ? fullLoad() : ["status", "events"], label);
  if (!fresh) assert.equal(seen[1].params.since_height, chain.height - 1, label);
}
step("a wrong key, bad data, an RPC error, a 503 and a throw give 502 and keep the old snapshot");

{
  const w = await loadWorker();
  const res = await ask(w, { method: "POST" });
  assert.deepEqual([res.status, await res.text(), calls.length], [405, "Use GET.\n", 0]);
  const gated = { ASSETS: env.ASSETS, APP_PASSWORD: "pw" };
  assert.deepEqual([(await ask(w, {}, gated)).status, calls.length], [401, 0]);
  step("POST gives 405, and without the password the gate answers 401 before any upstream call");
  const user = { cookie: "s=1", authorization: "Basic " + btoa("u:pw"),
    "cf-connecting-ip": "203.0.113.9", "user-agent": "Mozilla/5.0" };
  assert.equal((await ask(w, { headers: user }, gated)).status, 200);
  for (const c of taken()) {
    assert.equal(c.url, "https://light.zcash.me/zns-testnet");
    assert.deepEqual([c.init.method, c.init.redirect, c.jsonrpc], ["POST", "manual", "2.0"]);
    assert.ok(c.init.signal instanceof AbortSignal, "a timeout");
    assert.deepEqual([...new Headers(c.init.headers)], [["content-type", "application/json"]]);
  }
  step("the upstream request has only content-type, whatever headers the page sends");
  const reg = await createRegistry({ fetch: () => ask(w), now: () => clock }).get();
  assert.equal(resolveRecipient("alice.zec", "test", reg).address, C);
  assert.deepEqual(named, []);
  step("no call has a name param, and the page module reads the answer of the Worker");
}

const record = (name, address, last_action = "claim", height = 5) =>
  ({ name, address, txid: hex(5), height, last_action, expires_at: "none" });
const answer = (list, over = {}) =>
  ({ network: "test", key: ZNS_KEY, height: 7, names: list, ...over });
const serve = (body, status = 200) => async () =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
const LONG = "q".repeat(100);
const names = [["Alice.ZEC", "alice"], ["alice.zcash", "alice"], ["alice", "alice"],
  [" alice ", "alice"], ["a".repeat(63), "a".repeat(63)], ["a".repeat(64), null],
  ["alice.zec.zec", null], ["al-ice", null], ["", null], [".zec", null], ["utest1" + LONG, null],
  ["u1" + LONG, null], [null, null], [5, null]];
for (const [text, want] of names) assert.equal(nameOf(text), want, String(text));
assert.equal(zecName("alice"), "alice.zec");
step("nameOf: suffixes, case, spaces, 63 and 64 characters, text that is no name");
{
  const fetch = serve(answer([record("alice", A), record("bob", B)]));
  const reg = await createRegistry({ fetch, now: () => 0 }).get();
  assert.deepEqual(resolveRecipient(" Alice.ZEC ", "test", reg),
    { name: "alice", address: A, record: reg.byName.get("alice") });
  assert.equal(resolveRecipient("utest1" + LONG, "test", reg), null);
  assert.throws(() => resolveRecipient(" Zed.zec ", "test", reg), {
    message: "Zed.zec is not a unified address, and the testnet ZNS registry has no name zed." });
  assert.throws(() => resolveRecipient("alice", "main", reg),
    { message: "ZNS names work on testnet only." });
  assert.equal(resolveRecipient("u1" + LONG, "main", reg), null);
  step("a lookup gives the name and the address; an unknown name and mainnet are refused");
}
{
  const ok = record("alice", A);
  const bad = (edit) => serve(answer([{ ...ok, ...edit }]));
  const cases = { "a wrong key": serve(answer([ok], { key: "uviewtest1other" })),
    "mainnet": serve(answer([ok], { network: "main" })),
    "names that are no list": serve(answer("alice")), "an upper-case name": bad({ name: "Alice" }),
    "a long address": bad({ address: B + "q" }), "a bad txid": bad({ txid: "1" }),
    "a release record": bad({ last_action: "release" }), "a negative height": bad({ height: -1 }),
    "a bad expiry": bad({ expires_at: "soon" }),
    "a duplicate name": serve(answer([ok, { ...ok, address: B }])), "text": serve("<html>"),
    "a status 503": serve(answer([ok]), 503),
    "a throw": async () => { throw new TypeError("Failed to fetch"); } };
  for (const [label, fetch] of Object.entries(cases)) {
    await assert.rejects(createRegistry({ fetch, now: Date.now }).get(), { message: MSG }, label);
  }
  step("a wrong key, bad data and a failed request all reject");
}
{
  let t = 0, fetches = 0, down = true;
  const fetch = async () => {
    fetches++;
    if (down) throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(answer([record("alice", A)])));
  };
  const reg = createRegistry({ fetch, now: () => t, ttlMs: 60_000 });
  await assert.rejects(reg.get(), { message: MSG });
  down = false;
  const [x, y] = await Promise.all([reg.get(), reg.get()]);
  await (t += 59_999, reg.get());
  assert.deepEqual([fetches, x === y], [2, true]);
  await (t += 1, reg.get());
  assert.equal(fetches, 3);
  const asked = [], saved = globalThis.fetch;
  globalThis.fetch = async (url) => (asked.push(url), new Response(JSON.stringify(answer([]))));
  await registry.get();
  globalThis.fetch = saved;
  assert.deepEqual(asked, ["/zns"]);
  step("a failed request retries, parallel calls share one fetch, the TTL asks again, "
    + "and the default registry reads /zns with the global fetch of the moment");
}

{
  let t = 0, body = answer([record("alice", A), record("bob", B)]);
  const fetch = async () => new Response(JSON.stringify(body));
  const reg = createRegistry({ fetch, now: () => t });
  const one = await reg.get();
  const proposal = { to: A, amount: 100, name: "alice" };
  assert.equal(nameRefusal([proposal], one), null);
  assert.equal(movedNote(one.byName.get("alice")), null);
  body = answer([record("alice", B, "update", 9), record("bob", B)]);
  const two = await (t += 60_000, reg.get());
  const another = "The ZNS name alice.zec now gives another address than this payment, "
    + "so this browser did not approve.";
  assert.equal(nameRefusal([proposal], two), another);
  assert.equal(movedNote(two.byName.get("alice")), "This name moved to a new address at block 9.");
  const wrong = { to: C, amount: 100, name: "alice" };
  assert.equal(nameRefusal([wrong], one), another);
  body = answer([record("alice", A)]);
  assert.equal(nameRefusal([{ to: B, name: "bob" }], await (t += 60_000, reg.get())),
    "The ZNS name bob.zec has no address in the registry now, so this browser did not approve.");
  assert.equal(nameRefusal([{ to: C, amount: 1 }, proposal], one), null);
  assert.equal(nameRefusal([wrong, proposal], one), another);
  const invalid = "This payment names an invalid ZNS name, so this browser did not approve.";
  for (const name of ["Alice", "alice.zec", 5, null]) {
    assert.equal(nameRefusal([{ to: A, name }, wrong], one), invalid, String(name));
  }
  step("a name that moved is refused after the TTL with a note of the block; a mismatch, a "
    + "released name and an invalid name are refused; a match and a plain payee pass");
}

const copy = (src, from) => [...src.slice(src.indexOf(from)).split(".join")[0]
  .matchAll(/"([^"]+)"/g)].map((m) => m[1]).join("");
assert.equal(copy(workerSource, "const ZNS_KEY"), ZNS_KEY);
assert.equal(copy(read("../zns.js"), "export const ZNS_KEY"), ZNS_KEY);
step("the key of the Worker equals the key of the page module");
console.log("zns tests passed");
