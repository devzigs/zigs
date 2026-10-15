// Tests of web/sol/client.js (P8c fix). Usage: node solspike/test/client.test.mjs
// A fake Worker class stands in for the browser. A call settles with the result or with an
// Error: also after close() and after a Worker error. Nothing waits for an answer that never comes.
import assert from "node:assert/strict";
import { startSolWorker } from "../../web/sol/client.js";

const step = (name) => console.log(`ok  ${name}`);

class FakeWorker {
  constructor(url, options) {
    Object.assign(this, { url, options, sent: [], terminated: false });
    FakeWorker.last = this;
  }
  postMessage(message) {
    this.sent.push(message);
  }
  terminate() {
    this.terminated = true;
  }
}
globalThis.Worker = FakeWorker;

/** "ok <value>", "error <text>" or "pending" if the promise has not settled after a short wait. */
const outcome = (promise) =>
  Promise.race([
    promise.then(
      (value) => `ok ${JSON.stringify(value)}`,
      (err) => `error ${err.message}`,
    ),
    new Promise((done) => setTimeout(() => done("pending"), 30)),
  ]);

async function answers() {
  const client = startSolWorker();
  const worker = FakeWorker.last;
  assert.deepEqual([worker.url, worker.options], ["/sol/worker.js", { type: "module" }]);
  const first = client.call("sync");
  const second = client.call("send", { tx: "AQID" });
  assert.deepEqual(worker.sent, [
    { id: 1, cmd: "sync", args: {} },
    { id: 2, cmd: "send", args: { tx: "AQID" } },
  ]);
  worker.onmessage({ data: { id: 9, ok: true, result: 0 } });
  worker.onmessage({ data: null });
  worker.onmessage({ data: { id: 2, ok: false, error: "Error: the node said no" } });
  worker.onmessage({ data: { id: 1, ok: true, result: { slot: "5" } } });
  assert.equal(await outcome(first), 'ok {"slot":"5"}');
  assert.equal(await outcome(second), "error Error: the node said no");
  step("a call settles with the result or the error of its own id; other messages are ignored");
}

async function afterClose() {
  const client = startSolWorker();
  const worker = FakeWorker.last;
  const pending = client.call("sync");
  client.close();
  assert.equal(worker.terminated, true);
  assert.equal(await outcome(pending), "error The Solana worker was closed");
  const sent = worker.sent.length;
  assert.equal(await outcome(client.call("sync")), "error The Solana worker was closed");
  assert.equal(worker.sent.length, sent, "a call after close() was sent to the Worker");
  client.close();
  assert.equal(await outcome(client.call("blockhash")), "error The Solana worker was closed");
  step("a pending call and every later call reject after close() (none stays pending)");
}

async function afterError() {
  const client = startSolWorker();
  const worker = FakeWorker.last;
  const pending = client.call("sync");
  let prevented = false;
  worker.onerror({ preventDefault: () => (prevented = true) });
  assert.equal(prevented, true, "the error event was not handled");
  assert.equal(await outcome(pending), "error The Solana worker failed");
  assert.equal(await outcome(client.call("sync")), "error The Solana worker failed");
  step("a pending call and every later call reject after a Worker error");
}

await answers();
await afterClose();
await afterError();
console.log("client tests passed");
