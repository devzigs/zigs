// Checks the store's abuse limits against a running server:
//   npx wrangler dev   (in cf/), then: node test/limits.mjs ws://localhost:8787
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const hex = randomBytes(10).toString("hex");
const base = process.argv[2] || "ws://localhost:8787";
const url = base + "/ws?g=" + hex;
const ws = new WebSocket(url);
const waiting = new Map();
let rid = 0;
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.type === "reply") waiting.get(m.rid)?.(m);
};
const send = (msg) => new Promise((resolve) => {
  waiting.set(++rid, resolve);
  ws.send(typeof msg === "string" ? msg : JSON.stringify({ rid, ...msg }));
});
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

const gid = "groups/" + hex;
assert.equal((await send({ op: "set", path: gid, data: { a: 1 } })).ok, true, "a normal write works");
assert.equal((await send({ op: "update", path: gid, data: { b: 2 } })).ok, true, "an update works");
assert.equal((await send({ op: "set", path: "other/x", data: {} })).code, "invalid_argument", "paths outside groups/ fail");
const other = "groups/" + randomBytes(10).toString("hex");
assert.equal((await send({ op: "set", path: other, data: {} })).code, "invalid_argument", "another group's path fails");
const refused = await new Promise((res) => { const w = new WebSocket(base + "/ws"); w.onopen = () => { w.close(); res(false); }; w.onerror = () => res(true); });
assert.ok(refused, "a socket without a group id is refused");
assert.equal((await send({ op: "delete", path: gid })).code, "invalid_argument", "delete is gone");
const big = { blob: "x".repeat(260_000) };
assert.match((await send({ op: "set", path: gid, data: big })).message, /document is larger/, "a 260 KB document fails");
// The server rejects an oversized message before parsing it, so the reply carries no rid.
const hugeReply = new Promise((resolve) => waiting.set(undefined, resolve));
ws.send(JSON.stringify({ op: "set", path: gid, data: { blob: "x".repeat(310_000) } }));
assert.match((await hugeReply).message, /message is larger/, "a 310 KB message fails");

let limited = null;
for (let i = 0; i < 320 && !limited; i++) {
  const r = await send({ op: "set", path: gid + "/n/" + i, data: { i } });
  if (!r.ok) limited = { i, r };
}
assert.ok(limited && limited.r.code === "resource_exhausted", "the per-minute write limit applies");

// This socket is open, so 19 more fit under the per-IP limit of 20 and the next one fails.
const open = (u) => new Promise((resolve) => {
  const s = new WebSocket(u);
  s.onopen = () => resolve(s);
  s.onerror = () => resolve(null);
});
const extra = [];
for (let i = 0; i < 20; i++) extra.push(await open(url));
assert.equal(extra.slice(0, 19).filter(Boolean).length, 19, "20 sockets per IP are allowed");
assert.equal(extra[19], null, "the 21st socket from one IP fails");
extra.forEach((s) => s && s.close());

console.log("all limits hold; rate limit hit after", limited.i, "writes in this run");
ws.close();
