// The /lwd route of cf/src/index.js. The Worker relays the light-wallet calls of the page to the
// testnet server, adds the secret key, and passes no credential of the user. The Cloudflare import
// and fetch are stubs, so nothing here reaches a network.
// Run: node web/test/lwd.mjs   (Node 24)
import assert from "node:assert/strict";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../cf/src/index.js", import.meta.url), "utf8").replace(
  'import { DurableObject } from "cloudflare:workers";',
  "const DurableObject = class {};",
);
assert.ok(!source.includes("cloudflare:workers"), "the Cloudflare import is stubbed");
const { default: worker } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);
// timingSafeEqual on crypto.subtle is a Cloudflare extension: Node has it in node:crypto.
crypto.subtle.timingSafeEqual ??= timingSafeEqual;

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

// ── Only the gRPC methods of the service pass: 404 for a path, then 405 for a method ──
{
  const paths = [
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
    const res = await ask("/lwd" + SERVICE + "GetBlock", { method });
    assert.equal(res.status, 405, method);
    await keyless(res, method);
    assert.equal((await ask("/lwd/other", { method })).status, 404, method + " on a bad path");
  }
  assert.deepEqual(calls, [], "no call went upstream");
  step("a bad path gives 404, a bad method gives 405, and nothing goes upstream");
}

// ── Without a key the route is closed ──
for (const LWD_KEY of [undefined, "", null]) {
  const res = await ask("/lwd" + SERVICE + "GetLatestBlock", {}, { ...env, LWD_KEY });
  assert.equal(res.status, 503, `LWD_KEY ${JSON.stringify(LWD_KEY)}`);
  assert.equal(calls.length, 0);
}
step("a missing or empty LWD_KEY gives 503 and nothing goes upstream");

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
  const res = await ask("/lwd" + SERVICE + "GetBlockRange");
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

console.log("lwd tests passed");
