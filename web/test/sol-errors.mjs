// Helius errors (S5 of docs/hackathon-release.md):
//  - the Worker answers a refused or failed HTTP call of Helius with a readable text: of the RPC
//    (SolanaError 8100002, the SDK bundle has no texts) and of the indexer (the SDK drops the
//    status, so the fetch of the Worker keeps it); any other error stays as it was;
//  - a failed wallet read waits 3 s, twice as long each time up to 60 s, and shows its banner once
//    for each text.
// The real worker.js and the real SDK bundle run in Node with a fake network.
// Run: node web/test/sol-errors.mjs   (Node 26)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { backOff } from "../sol/signing.js";

const WEB_SOL = new URL("../sol/", import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    if (!specifier.startsWith("/sol/")) return next(specifier, context);
    return { url: new URL(specifier.slice(5), WEB_SOL).href, shortCircuit: true };
  },
});
const step = (name) => console.log(`ok  ${name}`);

// ---- the Worker, the real SDK and a fake Helius ----

// What Helius answers: 200, an HTTP status, or "cors" (the browser hides the status).
let mode = { rpc: 200, indexer: 200 };
function wasmFile(href) {
  const body = readFileSync(fileURLToPath(href));
  return new Response(body, { headers: { "content-type": "application/wasm" } });
}
function rpcAnswer(init) {
  const body = init?.body ? JSON.parse(init.body) : null;
  const results = { getSlot: 9, getBalance: { context: { slot: 9 }, value: 5 } };
  return Response.json({ jsonrpc: "2.0", id: body?.id, result: results[body?.method] ?? null });
}
function helius(url, init) {
  const status = url.pathname.startsWith("/v1/zolana") ? mode.indexer : mode.rpc;
  if (status === "cors") throw new TypeError("Failed to fetch");
  return status === 200 ? rpcAnswer(init) : new Response("no", { status });
}
globalThis.fetch = async (input, init) => {
  const href = String(input instanceof Request ? input.url : input);
  return href.startsWith("file:") ? wasmFile(href) : helius(new URL(href), init);
};

const waiting = new Map();
globalThis.self = { postMessage: (message) => waiting.get(message.id)?.(message) };
const { guardedFetch, heliusText } = await import(new URL("worker.js", WEB_SOL).href);
let ids = 0;
function ask(cmd, args) {
  ids += 1;
  const id = ids;
  const answer = new Promise((ok) => waiting.set(id, ok));
  globalThis.self.onmessage({ data: { id, cmd, args } });
  return answer;
}

const init = await ask("init", {
  rpcUrl: "https://devnet.helius-rpc.com/?api-key=" + "k3y9".repeat(5),
  nullifierSecret: "c1".repeat(31),
  pdaNullifierSecret: "c3".repeat(31),
  viewingSecret: "a7".repeat(32),
  groupKey: "e5".repeat(32),
  pda: "d4".repeat(32),
});
assert.equal(init.ok, true, init.error);
const ACCOUNT = { account: "11111111111111111111111111111111" };
const errorOf = async (cmd, args, how) => {
  mode = how;
  const answer = await ask(cmd, args);
  assert.equal(answer.ok, false, cmd + " was accepted");
  return answer.error;
};

const REFUSED = "Helius refused this website. Its key does not allow this domain.";
const TOO_MANY = "Too many Helius calls. Wait a minute.";
const DOWN = "Helius is not answering.";
const rpc = (status) => ({ rpc: status, indexer: 200 });
assert.equal(await errorOf("balance", ACCOUNT, rpc(403)), REFUSED);
assert.equal(await errorOf("balance", ACCOUNT, rpc(429)), TOO_MANY);
assert.equal(await errorOf("balance", ACCOUNT, rpc(500)), DOWN);
assert.equal(await errorOf("sync", {}, rpc(503)), DOWN, "the slot read of the sync");
step("an RPC call that Helius refused answers with a readable text");

const indexer = (status) => ({ rpc: 200, indexer: status });
assert.equal(await errorOf("sync", {}, indexer(403)), REFUSED);
assert.equal(await errorOf("sync", {}, indexer(429)), TOO_MANY);
assert.equal(await errorOf("sync", {}, indexer(502)), DOWN);
step("an indexer call that Helius refused answers with a readable text");

// A status of an earlier command does not name the error of the next one.
mode = rpc(200);
assert.equal((await ask("balance", ACCOUNT)).ok, true);
assert.match(await errorOf("balance", ACCOUNT, rpc("cors")), /^TypeError: Failed to fetch/);
assert.match(await errorOf("sync", {}, indexer("cors")), /WALLET_SYNC/, "no status: as it was");
step("an error with no HTTP status stays as it was");

// A refusal that the SDK handled (the 429 that queues a proof, a 5xx in the job poll) is followed
// by other replies of the same command: a later error of another kind keeps its own text.
{
  const call = guardedFetch("https://devnet.helius-rpc.com", {});
  const slot = { method: "POST", body: JSON.stringify({ id: 1, method: "getSlot" }) };
  const plain = new Error("the new proof does not give the approved commitment");
  mode = rpc(429);
  await call("https://devnet.helius-rpc.com/?api-key=x", slot);
  assert.equal(heliusText(plain), TOO_MANY, "control: the refusal is the last reply");
  mode = rpc(200);
  await call("https://devnet.helius-rpc.com/?api-key=x", slot);
  assert.equal(heliusText(plain), null, "a later reply clears the refusal");
}
step("a refusal that later replies follow does not name a later error");

// ---- the wallet read ----

const banners = [];
const host = { log: () => {}, showBanner: (_kind, text) => banners.push(text) };
const c = { readFails: {}, host };
const waits = [1, 2, 3, 4, 5, 6, 7].map(() => backOff(c, "snap:x", new Error(TOO_MANY)));
assert.deepEqual(waits, [3000, 6000, 12000, 24000, 48000, 60000, 60000], "3 s doubling to 60 s");
assert.deepEqual(banners, [TOO_MANY], "one banner for seven failures with one text");
backOff(c, "snap:x", new Error(REFUSED));
assert.deepEqual(banners, [TOO_MANY, REFUSED], "a new text shows once");
assert.equal(backOff(c, "snap:y", new Error(REFUSED)), 3000, "each step counts on its own");
step("a failed wallet read waits longer each time and shows each text once");

console.log("sol-errors: ok");
process.exit(0);
