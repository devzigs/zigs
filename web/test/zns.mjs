// The /zns route of cf/src/index.js and the page module web/zns.js. A fake resolver replaces
// fetch and Date.now is stubbed: no network, no wait. Run: node web/test/zns.mjs   (Node 24)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ZNS_KEY, ZNS_MAX_LAG, ZNS_RECENT_BLOCKS, createRegistry, movedNote, nameOf, nameRefusal,
  recentNote, registry, resolveRecipient, zecName } from "../zns.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const workerSource = read("../../cf/src/index.js");
// A data: URL module resolves no relative import, so the gate module gets its file URL.
const GATE = new URL("../../cf/src/gate.js", import.meta.url).href;
let copies = 0; // a copy of the Worker has its own snapshot: the comment makes a new data: URL
const loadWorker = async () => {
  const code = workerSource.replace('import { DurableObject } from "cloudflare:workers";',
    "const DurableObject = class {};").replace('from "./gate.js";', `from "${GATE}";`) +
    `\n// copy ${copies++}`;
  return (await import("data:text/javascript," + encodeURIComponent(code))).default;
};
const step = (name) => console.log(`ok  ${name}`);
const hex = (n) => n.toString(16).padStart(64, "0");
const addr = (tag) => "utest1" + String(tag).padEnd(40, "q");
const [A, C] = ["a", "c"].map(addr), B = "utest1" + "q".repeat(994); // B: the longest address
const MSG = "The ZNS registry cannot be read. Try again.";
const WORKER_ERROR = "The ZNS registry could not be read.\n";

// The fake resolver: the names, the status and list_names. `cap` is the largest page that it
// gives; its answer says so in `limit`.
const chain = { height: 1000, synced: true, cap: 500, names: new Map() };
const put = (name, address, height, last_action = "claim") => chain.names.set(name,
  { name, address, txid: hex(height), height, last_action, expires_at: "none" });
const answers = {
  status: () => ({ synced_height: chain.height, synced: chain.synced, viewing_key: ZNS_KEY }),
  list_names: ({ limit, offset }) => {
    const n = Math.min(limit, chain.cap), list = [...chain.names.values()];
    return { items: list.slice(offset, offset + n), total: list.length, limit: n, offset };
  },
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
// A fault in the first page of a method (or in the status) only.
const tamper = (method, edit) => (call) => {
  if (call.method !== method || call.params.offset) return undefined;
  const result = structuredClone(answers[method](call.params));
  return edit(result), rpc(call, result);
};
const taken = () => calls.splice(0);
const methods = () => taken().map((c) => c.method);
let clock = 1_700_000_000_000;
Date.now = () => clock;
const errors = [];
console.error = (...a) => errors.push(a.join(" "));
// The deadline of the Worker is 20 s: `fastDeadline` makes one of a few ms (a timer that keeps the
// process alive, which AbortSignal.timeout does not).
const realTimeout = AbortSignal.timeout, deadlines = [];
let fastDeadline = null;
AbortSignal.timeout = (ms) => {
  deadlines.push(ms);
  if (fastDeadline === null) return realTimeout.call(AbortSignal, ms);
  const stop = new AbortController();
  setTimeout(() => stop.abort(new DOMException("timed out", "TimeoutError")), fastDeadline);
  return stop.signal;
};
const waited = [], ctx = { waitUntil: (p) => waited.push(p) };
const env = { DEV_NO_AUTH: "1", ASSETS: { fetch: async () => new Response("asset") } };
const ask = (worker, init = {}, e = env) =>
  worker.fetch(new Request("https://app.zigs.app/zns", init), e, ctx);
const later = (ms, w) => { clock += ms; return ask(w ?? worker); }; // a request ms later
const byName = async (res) => new Map((await res.json()).names.map((r) => [r.name, r]));
const fullLoad = (pages = 2) => ["status", ...Array(pages).fill("list_names")];
const pages = [0, 500].map((offset) => ({ limit: 500, offset }));

const worker = await loadWorker();
put("alice", A, 1);
put("bob", addr("bob"), 2);
for (let i = 0; i < 499; i++) put(`n${i}`, addr(`n${i}`), 3 + i);
{
  const res = await ask(worker);
  const text = await res.text(), body = JSON.parse(text);
  assert.deepEqual([res.status, res.headers.get("content-type"), res.headers.get("cache-control")],
    [200, "application/json", "no-store"]);
  assert.deepEqual([body.network, body.key, body.height, body.synced],
    ["test", ZNS_KEY, 1000, true]);
  assert.deepEqual(body.names.map((r) => r.name), [...chain.names.keys()].sort());
  const seen = taken();
  assert.deepEqual(seen.map((c) => c.method), fullLoad());
  assert.deepEqual(seen.slice(1).map((c) => c.params), pages);
  assert.deepEqual([new Set(seen.map((c) => c.init.signal)).size, deadlines, waited.length],
    [1, [20_000], 1]);
  const again = await later(59_999);
  assert.deepEqual([await again.text(), calls.length, waited.length], [text, 0, 1]);
  step("a full load reads the status and two pages with one deadline; a request within 60 s "
    + "gets the same body with no call");
}
{
  // Every refresh is a full load: a name that moved, one that went, a lower height and a
  // capital-letter address (bech32 is the same in capitals) all come from the pages.
  put("alice", B, 1001, "update");
  chain.names.delete("bob");
  put("carol", addr("carol"), 1003);
  put("shout", "UTEST1" + "Q".repeat(40), 1004);
  chain.height = 900;
  const all = await Promise.all([later(1), later(0), later(0)]);
  assert.deepEqual([methods(), waited.length], [fullLoad(), 2]);
  const got = await byName(all[0]), body = await all[2].json();
  assert.deepEqual(got.get("alice"), { name: "alice", address: B, txid: hex(1001), height: 1001,
    last_action: "update", expires_at: "none" });
  assert.ok(!got.has("bob") && got.get("carol").last_action === "claim" && got.size === 502);
  assert.deepEqual([got.get("shout").address, body.height], ["utest1" + "q".repeat(40), 900]);
  step("a refresh after 60 s is a full load, also for a lower height; parallel requests share it");
}
{
  chain.cap = 100; // a resolver with a smaller page, which it says in `limit`
  const got = await byName(await later(60_000));
  assert.deepEqual([methods(), got.size], [fullLoad(6), 502]);
  chain.cap = 500;
  put("zed", addr("zed"), 1005);
  const endless = (c) => c.method === "list_names" ? rpc(c, { total: 1e9, limit: 500,
    offset: c.params.offset, items: [...chain.names.values()].slice(0, 500) }) : undefined;
  const w = await loadWorker();
  fault = endless;
  assert.equal((await ask(w)).status, 502);
  fault = null;
  assert.equal(taken().length, 41, "a status and 40 pages");
  step("a smaller page that the answer states is read in full; 40 pages without end are refused");
}

// Each fault gives 502 with one fixed cause in the log, never serves a snapshot older than 60 s,
// and stops the calls upstream for 30 s. The texts "SECRET" must not reach the log.
const bad = (field, value) => tamper("list_names", (r) => { r.items[0][field] = value; });
const hang = (c) => c.method === "list_names" && c.params.offset ? new Promise((_, no) =>
  c.init.signal.addEventListener("abort", () => no(new Error("SECRET")))) : undefined;
// A bad record is left out: its name gives "not found", every other name stays, nothing is logged.
const badRecords = {
  "a name in capitals": bad("name", "Bad-Name"),
  "an address of another network": bad("address", "u1" + "q".repeat(60)),
  "an address in mixed case": bad("address", "uTeSt1" + "q".repeat(40)),
  "a txid that is no hash": bad("txid", "xyz"),
  "an expiry that is no number": bad("expires_at", 5),
  "a negative height": bad("height", -1),
  "a release record": bad("last_action", "release"),
  "a record that is no object": tamper("list_names", (r) => { r.items[0] = null; }),
};
for (const [label, make] of Object.entries(badRecords)) {
  const w = await loadWorker(), first = [...chain.names.keys()][0];
  errors.length = 0;
  fault = make;
  const res = await ask(w);
  fault = null;
  const got = await byName(res);
  assert.deepEqual([res.status, got.has(first), got.size, errors], [200, false,
    chain.names.size - 1, ["zns: left out"]], label);
}
{
  // The name of items[0] comes twice: with another address, with a copy that fails the check,
  // and as the same record. Only the plain repeat keeps the name, and it logs nothing.
  const first = [...chain.names.keys()][0];
  const twice = async (copy) => {
    errors.length = 0;
    fault = tamper("list_names", (r) => { r.items[1] = copy(r.items[0]); });
    const got = await byName(await ask(await loadWorker()));
    fault = null;
    return [got.get(first)?.address ?? null, errors.slice()];
  };
  assert.deepEqual(await twice((r) => ({ ...r, address: addr("other") })),
    [null, ["zns: left out"]]);
  assert.deepEqual(await twice((r) => ({ ...r, txid: "xyz" })), [null, ["zns: left out"]]);
  assert.deepEqual(await twice((r) => structuredClone(r)), [chain.names.get(first).address, []]);
  // Two names left out in one refresh still give one line.
  errors.length = 0;
  fault = tamper("list_names", (r) => { r.items[0].txid = "xyz"; r.items[1].txid = "xyz"; });
  const two = await byName(await ask(await loadWorker()));
  fault = null;
  assert.deepEqual([two.size, errors], [chain.names.size - 2, ["zns: left out"]]);
}
step("a bad record is left out, and so is a name with two addresses or a bad copy; the rest is "
  + "served, and a refresh that leaves something out logs one fixed line");

const faults = {
  "a wrong registry key": [tamper("status", (r) => { r.viewing_key = "uviewtest1x"; }), "status"],
  "a synced that is no boolean": [tamper("status", (r) => { r.synced = "yes"; }), "status"],
  "a page with no limit": [tamper("list_names", (r) => { delete r.limit; }), "bad page"],
  "a page cut short": [tamper("list_names", (r) => { r.items.length = 100; }), "bad page"],
  "a JSON-RPC error": [(c) => Response.json({ jsonrpc: "2.0", id: c.id, error: { code: -1 } }),
    "upstream"],
  "a status 503": [() => new Response("down", { status: 503 }), "upstream"],
  "a body that is not JSON": [() => new Response("<html>SECRET"), "upstream"],
  "a fetch that throws": [() => { throw new TypeError("fetch failed SECRET"); }, "upstream"],
  "a call that hangs": [hang, "deadline", 5],
};
for (const [label, [make, cause, deadline]] of Object.entries(faults)) {
  const w = await loadWorker();
  await ask(w);
  taken();
  deadlines.length = errors.length = 0;
  [fault, fastDeadline] = [make, deadline ?? null];
  const res = await later(60_000, w);
  [fault, fastDeadline] = [null, null];
  assert.deepEqual([res.status, await res.text()], [502, WORKER_ERROR], label);
  assert.deepEqual([errors, deadlines], [["zns: " + cause], [20_000]], label);
  taken();
  assert.deepEqual([(await later(29_999, w)).status, calls.length], [502, 0], label);
  assert.equal((await later(1, w)).status, 200, label);
  assert.deepEqual(methods(), fullLoad(), label);
}
step("a wrong key, bad data, a cut page, a 503, text, a throw and a hang: 502, one fixed cause, "
  + "a 30 s pause");

{
  const w = await loadWorker();
  const res = await ask(w, { method: "POST" });
  assert.deepEqual([res.status, res.headers.get("allow"), await res.text(), calls.length],
    [405, "GET", "Use GET.\n", 0]);
  const gated = { ASSETS: env.ASSETS, APP_PASSWORD: "pw" };
  assert.deepEqual([(await ask(w, {}, gated)).status, calls.length], [401, 0]);
  step("POST gives 405 with Allow, and without the password the gate answers 401 first");
  const user = { cookie: "s=1", authorization: "Basic " + btoa("u:pw"),
    "cf-connecting-ip": "203.0.113.9", "user-agent": "Mozilla/5.0" };
  assert.equal((await ask(w, { headers: user }, gated)).status, 200);
  for (const c of taken()) {
    assert.equal(c.url, "https://light.zcash.me/zns-testnet");
    assert.deepEqual([c.init.method, c.init.redirect, c.jsonrpc], ["POST", "manual", "2.0"]);
    assert.ok(c.init.signal instanceof AbortSignal, "a deadline");
    assert.deepEqual([...new Headers(c.init.headers)], [["content-type", "application/json"]]);
  }
  step("the upstream request has only content-type, whatever headers the page sends");
  const reg = await createRegistry({ fetch: () => ask(w), now: () => clock }).get();
  assert.deepEqual([reg.height, reg.synced], [900, true]);
  assert.equal(resolveRecipient("alice.zec", "test", reg, 900).address, B);
  assert.deepEqual(named, []);
  step("no call has a name param, and the page module reads the answer of the Worker");
}

const record = (name, address, last_action = "claim", height = 5) =>
  ({ name, address, txid: hex(5), height, last_action, expires_at: "none" });
const answer = (list, over = {}) =>
  ({ network: "test", key: ZNS_KEY, height: 7, synced: true, names: list, ...over });
const serve = (body, status = 200) => async () =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
const LONG = "q".repeat(100), TIP = 7;
const nameCases = [["Alice.ZEC", "alice"], ["alice.zcash", "alice"], ["alice", "alice"],
  [" alice ", "alice"], ["a".repeat(63), "a".repeat(63)], ["a".repeat(64), null],
  ["alice.zec.zec", null], ["al-ice", null], ["", null], [".zec", null], ["utest1" + LONG, null],
  ["u1" + LONG, null], [null, null], [5, null], ["trade", "trade"], ["texas", "texas"],
  ["tmBsTi2xWTjUdEXnuTceL7fecEQKeWaPDJd", null], ["t1VmmGiyjVNeCjxDZzg7vZmd99WyzVby9yC", null],
  ["tex1s2rt77ggv6q989lr49rkgzmh5slsksa9khdgte", null],
  ["textest1s2rt77ggv6q989lr49rkgzmh5slsksa9kh", null],
  ["TEX1S2RT77GGV6Q989LR49RKGZMH5SLSKSA9K", null],
  ["tmBsTi2xWTjUdEXnuTceL7fecEQKeWaPDJd.zec", null], ["Kate", null], ["ALİCE", null],
  ["alice​", null], ["ａｌｉｃｅ", null]];
for (const [text, want] of nameCases) assert.equal(nameOf(text), want, String(text));
assert.equal(zecName("alice"), "alice.zec");
step("nameOf: suffixes, case, 63 and 64 characters, t-addresses and TEX forms, non-ASCII text");
{
  const fetch = serve(answer([record("alice", A), record("bob", B)]));
  const reg = await createRegistry({ fetch, now: () => 0 }).get();
  assert.deepEqual(resolveRecipient(" Alice.ZEC ", "test", reg, TIP),
    { name: "alice", address: A, record: reg.byName.get("alice") });
  assert.equal(resolveRecipient("utest1" + LONG, "test", reg, TIP), null);
  assert.throws(() => resolveRecipient(" Zed.zec ", "test", reg, TIP), {
    message: "Zed.zec is not a unified address, and the testnet ZNS registry has no name zed." });
  assert.throws(() => resolveRecipient("alice", "main", reg, TIP),
    { message: "ZNS names work on testnet only." });
  assert.equal(resolveRecipient("u1" + LONG, "main", reg, TIP), null);
  step("a lookup gives the name and the address; an unknown name and mainnet are refused");
  const proposal = { to: A, amount: 1, name: "alice" };
  const behind = (tip) => `The ZNS registry is ${tip - 7} blocks behind the chain`;
  assert.equal(resolveRecipient("alice", "test", reg, TIP + ZNS_MAX_LAG).address, A);
  assert.equal(nameRefusal([proposal], reg, TIP + ZNS_MAX_LAG), null);
  assert.throws(() => resolveRecipient("alice", "test", reg, TIP + ZNS_MAX_LAG + 1),
    { message: behind(18) + ", so a ZNS name cannot be used now." });
  assert.equal(nameRefusal([proposal], reg, TIP + ZNS_MAX_LAG + 1),
    behind(18) + ", so this browser did not approve.");
  const noTip = "This wallet has no synced chain height to compare with the registry";
  for (const tip of [undefined, null, NaN, -1, 1.5, "17"]) {
    assert.throws(() => resolveRecipient("alice", "test", reg, tip),
      { message: noTip + ", so a ZNS name cannot be used now." });
    assert.equal(nameRefusal([proposal], reg, tip), noTip + ", so this browser did not approve.");
  }
  assert.equal(nameRefusal([{ to: C, amount: 1 }], reg, undefined), null);
  assert.equal(resolveRecipient("utest1" + LONG, "test", reg, undefined), null);
  step("a registry 10 blocks behind the tip passes; 11 blocks, or a missing or bad tip, refuses");
}
{
  const ok = record("alice", A);
  const bad = (edit) => serve(answer([{ ...ok, ...edit }]));
  const cases = { "a wrong key": serve(answer([ok], { key: "uviewtest1other" })),
    "mainnet": serve(answer([ok], { network: "main" })),
    "no synced": serve(answer([ok], { synced: undefined })),
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
  let hung = 0;
  const hangs = (url, { signal }) => new Promise((_, no) => (hung++,
    signal.addEventListener("abort", () => no(signal.reason))));
  const slow = createRegistry({ fetch: hangs, timeoutMs: 20 });
  deadlines.length = 0;
  fastDeadline = 20;
  await assert.rejects(slow.get(), { message: MSG });
  await assert.rejects(slow.get(), { message: MSG });
  fastDeadline = null;
  assert.deepEqual([hung, deadlines], [2, [20, 20]]);
  step("a request that hangs ends with the error after the time limit; the next call asks again");
}
{
  let t = 0, body = answer([record("alice", A), record("bob", B)]);
  const fetch = async () => new Response(JSON.stringify(body));
  const reg = createRegistry({ fetch, now: () => t });
  const one = await reg.get();
  const proposal = { to: A, amount: 100, name: "alice" };
  assert.equal(nameRefusal([proposal], one, TIP), null);
  assert.equal(movedNote(one.byName.get("alice")), null);
  body = answer([record("alice", B, "update", 9), record("bob", B)]);
  const two = await (t += 60_000, reg.get());
  const another = "The ZNS name alice.zec now gives another address than this payment, "
    + "so this browser did not approve.";
  assert.equal(nameRefusal([proposal], two, TIP), another);
  assert.equal(movedNote(two.byName.get("alice")), "This name moved to a new address at block 9.");
  const wrong = { to: C, amount: 100, name: "alice" };
  assert.equal(nameRefusal([wrong], one, TIP), another);
  body = answer([record("alice", A)]);
  assert.equal(nameRefusal([{ to: B, name: "bob" }], await (t += 60_000, reg.get()), TIP),
    "The ZNS name bob.zec has no address in the registry now, so this browser did not approve.");
  assert.equal(nameRefusal([{ to: C, amount: 1 }, proposal], one, TIP), null);
  assert.equal(nameRefusal([wrong, proposal], one, TIP), another);
  const invalid = "This payment names an invalid ZNS name, so this browser did not approve.";
  for (const name of ["Alice", "alice.zec", 5, null]) {
    assert.equal(nameRefusal([{ to: A, name }, wrong], one, TIP), invalid, String(name));
  }
  step("a name that moved is refused after the TTL with a note of the block; a mismatch, a "
    + "released name and an invalid name are refused; a match and a plain payee pass");
}
{
  const TIP2 = 5_000_000, at = (height, last = "claim") =>
    ({ name: "alice", address: A, height, last_action: last });
  const note = (height) => "This name got this address at block " + height + ", less than a day "
    + "ago. Check the address with the payee.";
  assert.equal(ZNS_RECENT_BLOCKS, 3456, "one day of 25 s blocks");
  const edge = TIP2 - ZNS_RECENT_BLOCKS;
  assert.equal(recentNote(at(edge + 1), TIP2), note(edge + 1), "one block inside the limit");
  assert.equal(recentNote(at(edge), TIP2), null, "at the limit a claim has no note");
  assert.equal(recentNote(at(edge - 1), TIP2), null, "one block over the limit");
  assert.equal(recentNote(at(edge, "update"), TIP2), movedNote(at(edge, "update")),
    "at the limit an update has the note of a moved name");
  assert.equal(recentNote(at(1, "update"), TIP2),
    "This name moved to a new address at block 1.", "an old update");
  assert.equal(recentNote(at(TIP2), TIP2), note(TIP2), "a claim in the tip block");
  assert.equal(recentNote(at(TIP2 - 5, "update"), TIP2), note(TIP2 - 5),
    "a recent update, and a claim after a release, get the warning");
  assert.equal(recentNote(at(TIP2 + 1), TIP2), note(TIP2 + 1), "a record above the tip");
  step("a name that got its address less than a day ago has a warning; an old update has the "
    + "note of a moved name");
}
const copy = (src, from) => [...src.slice(src.indexOf(from)).split(".join")[0]
  .matchAll(/"([^"]+)"/g)].map((m) => m[1]).join("");
assert.equal(copy(workerSource, "const ZNS_KEY"), ZNS_KEY);
assert.equal(copy(read("../zns.js"), "export const ZNS_KEY"), ZNS_KEY);
step("the key of the Worker equals the key of the page module");
console.log("zns tests passed");
