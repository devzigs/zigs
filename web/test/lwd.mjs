// The /lwd route of cf/src/index.js. The Worker relays the light-wallet calls of the page to the
// testnet server, adds the secret key, and passes no credential of the user. Also the key of a
// client for the limits per network (PRIV-9) at its three places. The Cloudflare import and fetch
// are stubs, so nothing here reaches a network.
// Run: node web/test/lwd.mjs   (Node 26)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A data: URL module resolves no relative import, so the gate module gets its file URL.
const GATE = new URL("../../cf/src/gate.js", import.meta.url).href;
const source = readFileSync(new URL("../../cf/src/index.js", import.meta.url), "utf8").replace(
  'import { DurableObject } from "cloudflare:workers";',
  "const DurableObject = class { constructor(ctx, env) { this.ctx = ctx; this.env = env; } };",
).replace('from "./gate.js";', `from "${GATE}";`);
assert.ok(!source.includes("cloudflare:workers"), "the Cloudflare import is stubbed");
const { default: worker, Store } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

const KEY = "0".repeat(64);
const SERVICE = "/cash.z.wallet.sdk.rpc.CompactTxStreamer/";
const UPSTREAM = "https://lwd.zigs.app" + SERVICE;
const calls = [];
let upstream = () => new Response("ok");
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  return upstream();
};
const assets = { fetch: async () => new Response("asset", { status: 404 }) };
const env = { DEV_NO_AUTH: "1", LWD_KEY: KEY, ASSETS: assets };
const ask = (path, init = {}, e = env) =>
  worker.fetch(new Request("https://app.zigs.app" + path, { method: "POST", ...init }), e);
const text = (stream) => new Response(stream).text();
const step = (name) => console.log(`ok  ${name}`);
// The key goes upstream only, never into an answer of the Worker itself.
const keyless = async (res, name) => {
  assert.ok(![...res.headers.values()].some((v) => v.includes(KEY)), name + ": header");
  assert.ok(!(await res.text()).includes(KEY), name + ": body");
};

// The GetBlockRange body that the engine (web/pkg) sends for its largest range: blocks 3,000,000
// to 3,000,999 (BATCH), recorded from ChainWallet.sync with a stub of fetch.
const ENGINE_RANGE = Buffer.from("000000000e0a0508c08db701120508a795b701", "hex");
const varint = (n) => {
  const out = [];
  for (; n >= 128; n = Math.floor(n / 128)) out.push((n % 128) | 128);
  return [...out, n];
};
const blockId = (height) => [0x08, ...varint(height)];
const sub = (num, bytes) => [num * 8 + 2, bytes.length, ...bytes];
const range = (start, end, more = []) => [
  ...(start === undefined ? [] : sub(1, blockId(start))),
  ...(end === undefined ? [] : sub(2, blockId(end))),
  ...more,
];
const frame = (msg, flag = 0) => {
  const out = new Uint8Array(5 + msg.length);
  out[0] = flag;
  new DataView(out.buffer).setUint32(1, msg.length);
  out.set(msg, 5);
  return out;
};

// ── Only the methods that the engine calls pass: 404 for a path, then 405 for a method ──
{
  // The other methods of the service (CompactTxStreamer, zcash_client_backend 0.25).
  const closed = ["GetAddressUtxos", "GetAddressUtxosStream", "GetBlock", "GetBlockNullifiers",
    "GetBlockRangeNullifiers", "GetLatestTreeState", "GetLightdInfo", "GetMempoolStream",
    "GetMempoolTx", "GetSubtreeRoots", "GetTaddressBalance", "GetTaddressBalanceStream",
    "GetTaddressTransactions", "GetTaddressTxids", "Ping"];
  const paths = [
    ...closed.map((m) => "/lwd" + SERVICE + m),
    "/lwd/",
    "/lwd/other",
    "/lwd" + SERVICE,
    "/lwd" + SERVICE + "GetBlock2",
    "/lwd" + SERVICE + "Get%42lock",
    "/lwd" + SERVICE + "GetBlock/more",
    "/lwd" + SERVICE + "GetBlock%2Fmore",
    "/lwd/" + SERVICE + "GetBlock",
    "/lwd/https://example.test/",
    "/lwd/cash.z.wallet.sdk.rpc.Other/GetBlock",
  ];
  for (const path of paths) {
    const res = await ask(path);
    assert.equal(res.status, 404, path);
    await keyless(res, path);
  }
  for (const method of ["GET", "PUT", "DELETE", "OPTIONS", "HEAD"]) {
    const res = await ask("/lwd" + SERVICE + "GetLatestBlock", { method });
    assert.equal(res.status, 405, method);
    await keyless(res, method);
    assert.equal((await ask("/lwd/other", { method })).status, 404, method + " on a bad path");
  }
  assert.deepEqual(calls, [], "no call went upstream");
  step("the 15 methods that the engine does not call, and a bad path, give 404; a bad method 405");
}

// ── The five methods that the engine calls go upstream with their body ──
{
  // A body of 300 bytes that is no BlockRange: only GetBlockRange gets the range check.
  const raw = frame(sub(1, Array(295).fill(7)));
  const methods = ["GetLatestBlock", "GetTreeState", "GetBlockRange", "GetTransaction",
    "SendTransaction"];
  for (const method of methods) {
    const body = method === "GetBlockRange" ? ENGINE_RANGE : raw;
    calls.length = 0;
    const res = await ask("/lwd" + SERVICE + method, { body });
    assert.equal(res.status, 200, method);
    assert.equal(calls[0].url, UPSTREAM + method, method);
    const sent = new Uint8Array(await new Response(calls[0].init.body).arrayBuffer());
    assert.deepEqual(sent, new Uint8Array(body), method + ": the body goes unchanged");
  }
  calls.length = 0;
  step("the five methods that the engine calls go upstream, and only GetBlockRange is bounded");
}

// ── A GetBlockRange call asks for at most LWD_MAX_BLOCKS blocks ──
{
  const worker = readFileSync(new URL("../../cf/src/index.js", import.meta.url), "utf8");
  const chain = readFileSync(new URL("../../wasm/src/chain.rs", import.meta.url), "utf8");
  const max = Number(/const LWD_MAX_BLOCKS = ([\d_]+);/.exec(worker)[1].replaceAll("_", ""));
  const batch = Number(/const BATCH: u32 = ([\d_]+);/.exec(chain)[1].replaceAll("_", ""));
  assert.ok(max > batch, `LWD_MAX_BLOCKS ${max} must stay above BATCH ${batch}`);
  const path = "/lwd" + SERVICE + "GetBlockRange";
  const send = (body) => ask(path, { body });
  calls.length = 0;
  let res = await send(ENGINE_RANGE);
  assert.equal(res.status, 200, "the range that the engine asks for passes");
  assert.deepEqual(new Uint8Array(calls[0].init.body), new Uint8Array(ENGINE_RANGE), "unchanged");
  const ok = [
    ["the limit", range(5000, 5000 + max - 1)],
    ["backwards within the limit", range(9000, 9000 - max + 1)],
    ["one block, no fields", range()],
    ["pool types", range(10, 20, [0x1a, 2, 1, 2])],
    ["a block hash", [...sub(1, [...blockId(10), ...sub(2, [1, 2, 3])]), ...sub(2, blockId(20))]],
    ["a varint of 10 bytes", sub(1, [0x08, 0x85, ...Array(8).fill(0x80), 0])],
    ["a frame of 256 bytes", range(10, 20, [0x22, ...varint(240), ...Array(240).fill(0)])],
  ];
  assert.equal(frame(ok.at(-1)[1]).length, 256);
  for (const [name, msg] of ok) assert.equal((await send(frame(msg))).status, 200, name);
  assert.equal(calls.length, 1 + ok.length);
  calls.length = 0;
  const big = new Uint8Array(300);
  const bad = [
    ["one block over the limit", frame(range(5000, 5000 + max))],
    ["the whole chain", frame(range(undefined, 3_000_000))],
    ["backwards over the limit", frame(range(3_000_000, 1))],
    ["a second end", frame(range(10, 20, sub(2, blockId(3_000_000))))],
    ["a second height in one BlockID", frame([...sub(1, [...blockId(10), ...blockId(0)])])],
    ["a height of 2^32", frame(range(2 ** 32, 2 ** 32))],
    ["a varint of 11 bytes", frame(sub(1, [0x08, 0x85, ...Array(9).fill(0x80), 0]))],
    ["a compressed frame", frame(range(10, 20), 1)],
    ["a frame that is too short", ENGINE_RANGE.subarray(0, 18)],
    ["bytes after the frame", Buffer.concat([ENGINE_RANGE, Buffer.from([0])])],
    ["two frames", Buffer.concat([ENGINE_RANGE, ENGINE_RANGE])],
    ["a group field", frame([0x0b, 0x0c])],
    ["a BlockID that does not parse", frame([0x0a, 2, 0x08, 0x80])],
    ["no body", undefined],
    ["an empty body", new Uint8Array(0)],
    ["a body of 4 bytes", Buffer.from("ABCD")],
    ["the head of a frame without its last byte", new Uint8Array(4)],
    ["the text form (base64)", Buffer.from(ENGINE_RANGE.toString("base64"))],
    ["a body of 300 bytes", big],
    ["a valid range in 268 bytes", frame(range(10, 20, [0x22, ...varint(250), ...big.slice(50)]))],
  ];
  for (const [name, body] of bad) {
    res = await send(body);
    assert.equal(res.status, 400, name);
    await keyless(res, name);
  }
  assert.match(await (await send(frame(range(0, max)))).text(), /at most 2000 blocks/);
  assert.equal(calls.length, 0, "a refused range sends nothing upstream");
  step(`a range of up to ${max} blocks passes (BATCH ${batch}); a larger or bad one gives 400`);
}

// ── Without a key the route is closed ──
for (const LWD_KEY of [undefined, "", null]) {
  const res = await ask("/lwd" + SERVICE + "GetLatestBlock", {}, { ...env, LWD_KEY });
  assert.equal(res.status, 503, `LWD_KEY ${JSON.stringify(LWD_KEY)}`);
  assert.equal(calls.length, 0);
}
step("a missing or empty LWD_KEY gives 503 and nothing goes upstream");

// ── The limit for each IP address: after the path and method checks, before upstream ──
{
  const keys = [];
  let allow = false;
  const LWD_PER_IP = {
    limit: async ({ key }) => {
      keys.push(key);
      return { success: allow };
    },
  };
  const limited = { ...env, LWD_PER_IP };
  const path = "/lwd" + SERVICE + "GetLatestBlock";
  const from = { headers: { "cf-connecting-ip": "203.0.113.7" } };
  assert.equal((await ask("/lwd/other", from, limited)).status, 404);
  assert.equal((await ask(path, { ...from, method: "GET" }, limited)).status, 405);
  assert.deepEqual(keys, [], "a bad path or method is not counted");
  const res = await ask(path, from, limited);
  assert.equal(res.status, 429);
  assert.match(await res.text(), /Wait a minute/);
  const rangePath = "/lwd" + SERVICE + "GetBlockRange";
  const badRange = { ...from, body: "bad" };
  assert.equal((await ask(rangePath, badRange, limited)).status, 429, "the limit before the body");
  assert.equal(calls.length, 0, "a limited call sends nothing upstream");
  const noKey = { ...limited, LWD_KEY: undefined };
  assert.equal((await ask(path, from, noKey)).status, 429, "the limit comes before the key");
  allow = true;
  assert.equal((await ask(path, from, limited)).status, 200);
  assert.equal(calls.length, 1, "an allowed call goes upstream");
  assert.equal((await ask(rangePath, badRange, limited)).status, 400, "a bad body is counted");
  assert.deepEqual(keys, Array(5).fill("203.0.113.7"), "the key is the IP address");
  calls.length = 0;
  step("over the limit gives 429 and nothing goes upstream; under it the call passes");
}

// ── The password gate comes first ──
{
  const gated = { APP_PASSWORD: "pw", LWD_KEY: KEY, ASSETS: assets };
  const basic = (pass) => ({ authorization: `Basic ${btoa("user:" + pass)}` });
  const path = "/lwd" + SERVICE + "GetLatestBlock";
  assert.equal((await ask(path, {}, gated)).status, 401);
  assert.equal((await ask(path, { headers: basic("other") }, gated)).status, 401);
  assert.equal(calls.length, 0, "a refused user reached the server");
  assert.equal((await ask(path, { headers: basic("pw") }, gated)).status, 200);
  assert.equal(calls.length, 1);
  calls.length = 0;
  step("a request without the password gets 401 and nothing goes upstream");
}

// ── The call upstream: allowlisted headers, the key, the body ──
{
  upstream = () =>
    new Response("answer", {
      status: 200,
      headers: {
        "content-type": "application/grpc-web+proto",
        "grpc-status": "0",
        "grpc-message": "fine",
        "set-cookie": "a=b",
        "access-control-allow-origin": "*",
        server: "envoy",
        "x-envoy-upstream-service-time": "3",
      },
    });
  const res = await ask("/lwd" + SERVICE + "GetLatestBlock?x=1", {
    body: "request body",
    headers: {
      "content-type": "application/grpc-web+proto",
      "x-grpc-web": "1",
      "x-user-agent": "grpc-web-rust/0.9",
      "grpc-timeout": "8S",
      authorization: "Basic dXNlcjpwdw==",
      cookie: "session=abc",
      "cf-connecting-ip": "203.0.113.7",
      "cf-ray": "abc",
      origin: "https://app.zigs.app",
      "x-forwarded-for": "203.0.113.7",
      "x-zigs-lwd-key": "sent-by-the-caller",
    },
  });
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, UPSTREAM + "GetLatestBlock", "no query string upstream");
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "manual");
  assert.deepEqual(Object.fromEntries(new Headers(init.headers)), {
    "content-type": "application/grpc-web+proto",
    "x-grpc-web": "1",
    "x-user-agent": "grpc-web-rust/0.9",
    "grpc-timeout": "8S",
    "x-zigs-lwd-key": KEY,
  });
  assert.ok(init.body instanceof ReadableStream, "the request body streams");
  assert.equal(await text(init.body), "request body");
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "answer");
  assert.deepEqual(Object.fromEntries(res.headers), {
    "cache-control": "no-store",
    "content-type": "application/grpc-web+proto",
    "grpc-status": "0",
    "grpc-message": "fine",
  });
  step("the call upstream has the allowed headers and the key only, and the answer is trimmed");
}

// ── The status and the body of the server pass through ──
{
  calls.length = 0;
  upstream = () => new Response("not found", { status: 404 });
  const res = await ask("/lwd" + SERVICE + "GetTransaction");
  assert.deepEqual([res.status, await res.text()], [404, "not found"]);
  assert.equal(res.headers.get("cache-control"), "no-store");
  upstream = () => {
    throw new TypeError("offline");
  };
  const lost = await ask("/lwd" + SERVICE + "GetTransaction");
  assert.equal(lost.status, 502);
  await keyless(lost, "502");
  step("the server status and body pass through, and a failed call gives 502");
}

// ── A server stream reaches the page before it ends ──
{
  const enc = new TextEncoder();
  let release;
  const held = new Promise((resolve) => (release = resolve));
  upstream = () =>
    new Response(
      new ReadableStream({
        async start(controller) {
          controller.enqueue(enc.encode("block 1;"));
          await held;
          controller.enqueue(enc.encode("block 2"));
          controller.close();
        },
      }),
    );
  const res = await ask("/lwd" + SERVICE + "GetBlockRange", { body: ENGINE_RANGE });
  const reader = res.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "block 1;");
  release();
  const rest = [];
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    rest.push(part.value);
  }
  assert.equal(new TextDecoder().decode(Buffer.concat(rest)), "block 2");
  step("a response body streams through and is not held back");
}

// ── The key of a client for the limits per network: IPv4, or the /64 of IPv6 (PRIV-9) ──
{
  const cases = [
    ["203.0.113.7", "203.0.113.7"],
    [" 203.0.113.7 ", "203.0.113.7"],
    ["2001:db8:1:2:3:4:5:6", "2001:db8:1:2::/64"],
    ["2001:0DB8:0001:0002::9", "2001:db8:1:2::/64"],
    ["2001:db8:1:2::", "2001:db8:1:2::/64"],
    ["2001:db8:1:3::1", "2001:db8:1:3::/64"],
    ["::1", "0:0:0:0::/64"],
    ["64:ff9b::198.51.100.1", "64:ff9b:0:0::/64"],
    ["::ffff:203.0.113.7", "203.0.113.7"],
    ["::FFFF:cb00:7107", "203.0.113.7"],
    ["0:0:0:0:0:ffff:203.0.113.7", "203.0.113.7"],
    ["1:0:0:0:0:ffff:203.0.113.7", "1:0:0:0::/64"],
    [undefined, "local"],
    ["", "local"],
    ["1::2::3", "1::2::3"],
    ["2001:db8::1::2", "2001:db8::1::2"],
    ["1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7:8:9"],
    ["1:2:3:4::5:6:7:8", "1:2:3:4::5:6:7:8"],
    ["::ffff:300.1.2.3", "::ffff:300.1.2.3"],
    ["fe80::1%eth0", "fe80::1%eth0"],
  ];
  const headers = (ip) => (ip === undefined ? {} : { "cf-connecting-ip": ip });
  const keys = [];
  const counter = { limit: async ({ key }) => (keys.push(key), { success: true }) };
  upstream = () => new Response("ok");
  for (const [ip] of cases) {
    await ask("/lwd" + SERVICE + "GetLatestBlock", { headers: headers(ip) }, {
      ...env, LWD_PER_IP: counter,
    });
  }
  assert.deepEqual(keys, cases.map(([, key]) => key), "LWD_PER_IP");
  // The group socket route: WS_PER_IP, then the Store of the group.
  keys.length = 0;
  const up = { fetch: async () => new Response("up") };
  const store = { idFromName: (name) => name, get: () => up };
  for (const [ip] of cases) {
    const url = "https://app.zigs.app/ws?g=" + "a".repeat(20);
    const req = new Request(url, { headers: headers(ip) });
    const res = await worker.fetch(req, { ...env, WS_PER_IP: counter, STORE: store });
    assert.equal(await res.text(), "up");
  }
  assert.deepEqual(keys, cases.map(([, key]) => key), "WS_PER_IP");
  // The sockets of a Store: a client with 20 sockets under its key gets 429.
  const sql = { exec: () => ({ one: () => ({ n: 0 }), toArray: () => [{ v: "adopted" }] }) };
  const tags = [];
  const ctx = {
    storage: { sql },
    getWebSockets: (tag) => (tag === undefined ? [] : (tags.push(tag), Array(20).fill({}))),
  };
  const room = new Store(ctx, env);
  for (const [ip] of cases) {
    const h = { ...headers(ip), upgrade: "websocket", "x-group": "a".repeat(20) };
    const res = await room.fetch(new Request("https://store/ws", { headers: h }));
    assert.equal(res.status, 429);
  }
  assert.deepEqual(tags, cases.map(([, key]) => key), "the socket count of a Store");
  calls.length = 0;
  step("one key at three places: an IPv4 address, the /64 of IPv6, the IPv4 of a mapped address");
}

console.log("lwd tests passed");
