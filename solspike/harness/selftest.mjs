// Harness self test. Usage: lockf -k "$SOL/heavy.lock" node harness/selftest.mjs
// 1. Three in-memory contexts of one Chrome do not see each other's storage.
// 2. Disposing a context removes it from the browser, and a page cannot open in it any more.
// 3. Redaction: a dummy secret that a page logs and requests never reaches the log file.
// 4. The page helpers work on the real app, the page reaches the local group server, and a CSP
//    violation is seen (a control).
// 5. A CSP violation inside a Worker is seen too (the Worker side of the capture).
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sleep, waitFor } from "./chrome.mjs";
import {
  captureDownloads, clickText, readSol, run, setInput, takeDownloads, waitForText,
} from "./page.mjs";
import { loadNeedles, makeRedactor, MARK, redact } from "./redact.mjs";
import { ORIGIN } from "./server.mjs";
import { withStack } from "./stack.mjs";

const KEY_NAME = "api-key";

const STATE = join(dirname(fileURLToPath(import.meta.url)), "../.state/selftest");
const FAVICON = `${ORIGIN}/favicon.png`;

// A same-origin static file: the app page opens its own IndexedDB, so it cannot show an empty one.
const mark = (page, name) =>
  run(page, async (value) => {
    localStorage.setItem("zs-marker", value);
    await new Promise((ok, bad) => {
      const req = indexedDB.open("zs-idb", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("s");
      req.onsuccess = () => (req.result.close(), ok());
      req.onerror = () => bad(req.error);
    });
  }, name);

const look = (page) =>
  run(page, async () => ({
    keys: Object.keys(localStorage),
    marker: localStorage.getItem("zs-marker"),
    idb: (await indexedDB.databases()).map((d) => d.name),
  }));

async function isolation(rig) {
  const ctxs = await Promise.all(["A", "B", "C"].map((n) => rig.newContext(n)));
  const pages = [];
  for (const ctx of ctxs) {
    const page = await ctx.open(FAVICON);
    await mark(page, ctx.name);
    pages.push(page);
  }
  for (const [i, page] of pages.entries()) {
    const seen = await look(page);
    assert.deepEqual(seen, { keys: ["zs-marker"], marker: "ABC"[i], idb: ["zs-idb"] });
  }
  return { ctxs, pages };
}

// A new context is always empty, so only the browser can say that the old one is gone.
async function wipe(rig, { ctxs, pages }) {
  const doomed = ctxs[1];
  assert.ok((await rig.contextIds()).includes(doomed.id), "B is listed before dispose");
  await doomed.dispose();
  assert.ok(!(await rig.contextIds()).includes(doomed.id), "B is still listed after dispose");
  await assert.rejects(doomed.open(FAVICON), /browser context/i, "a disposed context opens a page");
  const fresh = await rig.newContext("D");
  const page = await fresh.open(FAVICON);
  assert.deepEqual(await look(page), { keys: [], marker: null, idb: [] }, "a new context is empty");
  assert.equal((await look(pages[0])).marker, "A", "context A lost its marker");
  assert.equal((await look(pages[2])).marker, "C", "context C lost its marker");
  await fresh.dispose();
}

function redactionUnit() {
  mkdirSync(STATE, { recursive: true });
  const url = `http://localhost:8795/zs-dummy-rpc?${KEY_NAME}=ZSDUMMYKEYabcdef0123456789`;
  writeFileSync(join(STATE, "dummy.url"), `${url}\n`);
  writeFileSync(join(STATE, "dummy.hex"), `${"c0ffee".repeat(10)}beef\n`);
  const sources = [
    { file: "dummy.url", kind: "helius-url", required: true },
    { file: "dummy.hex", kind: "hex" },
    { file: "absent.hex", kind: "hex" },
  ];
  const needles = loadNeedles(STATE, sources);
  assert.equal(needles.length, 2 + 4, "needle forms");
  const unit = makeRedactor(needles);
  const bare = "ZSDUMMYKEYabcdef0123456789";
  assert.equal(unit(`a ${bare} b`), `a ${MARK} b`, "bare key");
  assert.equal(unit(`u?${KEY_NAME}=other&x=1`), `u?${KEY_NAME}=${MARK}&x=1`, "api-key parameter");
  const missing = [{ file: "absent.url", kind: "helius-url", required: true }];
  assert.throws(() => loadNeedles(STATE, missing), /required/);
  return { url, bare, hex: needles[2], needles };
}

async function redaction(rig, dummy) {
  const ctx = await rig.newContext("R");
  const page = await ctx.open(FAVICON);
  redact.add(...dummy.needles);
  await run(page, async (url, bare, hex, name) => {
    console.log("typed", url, bare, hex);
    await fetch(`/zs-dummy-rpc?${name}=${bare}&k=${hex}`).catch(() => null);
  }, dummy.url, dummy.bare, dummy.hex, KEY_NAME);
  const text = readFileSync(rig.logPath, "utf8") + JSON.stringify(page.records);
  for (const secret of [dummy.url, dummy.bare, dummy.hex]) assert.ok(!text.includes(secret));
  assert.ok(text.split(MARK).length > 3, "the log holds redaction marks");
  await ctx.dispose();
}

// The page may open a socket to the local group server (CSP connect-src 'self').
const socketInit = (page) =>
  run(page, () =>
    new Promise((ok, bad) => {
      const id = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) =>
        b.toString(16).padStart(2, "0")).join("");
      const ws = new WebSocket(`ws://${location.host}/ws?g=${id}`);
      ws.onmessage = (ev) => (ws.close(), ok(JSON.parse(ev.data)));
      ws.onerror = () => bad(new Error("socket error"));
      setTimeout(() => bad(new Error("socket timeout")), 5000);
    }),
  );

const csp = (page) => page.records.filter((r) => r.kind === "csp").length;

async function helpers(page) {
  await page.navigate(`${ORIGIN}/`);
  await waitForText(page, "Crypto engine ready (WebAssembly)");
  assert.equal(csp(page), 0, "the app page raises no CSP violation");
  await clickText(page, "Set up a wallet");
  await waitForText(page, "New shared wallet");
  await setInput(page, "#g-name", "Harness wallet");
  await setInput(page, "#g-n", 4);
  await setInput(page, "#g-t", 3);
  await waitForText(page, "Any 3 of 4 signers must approve each payment.");
  await clickText(page, "Cancel", { exact: true });
  await run(page, () => {
    document.body.insertAdjacentHTML("beforeend",
      '<span data-sol="probe"> 42 </span><input data-sol="field" value="x">');
  });
  assert.deepEqual(await readSol(page), { probe: "42", field: "x" });
  await captureDownloads(page);
  await run(page, () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["hello"], { type: "text/plain" }));
    a.download = "probe.txt";
    a.click();
  });
  const got = await takeDownloads(page);
  assert.deepEqual(got, [{ name: "probe.txt", type: "text/plain", text: "hello" }]);
  assert.deepEqual(await socketInit(page), { type: "init", docs: [] }, "group socket");
  assert.equal(csp(page), 0, "the socket raises no CSP violation");
  assert.equal(await run(page, () => confirm("sure?")), true, "a dialog is accepted");
  assert.ok(page.records.some((r) => r.kind === "dialog"), "the dialog is recorded");
}

async function cspControl(page) {
  const probe = () => fetch("https://csp-probe.invalid/").then(() => "sent", () => "blocked");
  assert.equal(await run(page, probe), "blocked");
  await sleep(300);
  const policy = /content security policy/i;
  const logged = page.records.filter((r) => r.kind === "log" && policy.test(r.text));
  assert.equal(csp(page), 1, "the CSP event is seen");
  assert.ok(logged.length >= 1, "the Log entry is seen");
}

// A Worker whose script response has its own policy: connect-src 'none'. The script runs a
// forbidden fetch. The harness must attach to the paused Worker, hook it and see the violation.
const WORKER_SCRIPT = 'self.fetch("http://127.0.0.1:1/probe").catch(() => {}); postMessage("up");';

async function workerCapture(rig) {
  const server = http.createServer((req, res) => {
    const worker = req.url === "/w.js";
    const csp = worker ? { "content-security-policy": "connect-src 'none'" } : {};
    res.writeHead(200, { "content-type": worker ? "text/javascript" : "text/html", ...csp });
    res.end(worker ? WORKER_SCRIPT : "<!doctype html><title>w</title>");
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  try {
    const ctx = await rig.newContext("W");
    const page = await ctx.open(`http://127.0.0.1:${server.address().port}/`);
    await run(page, () => {
      window.w = new Worker("/w.js");
    });
    const fromWorker = (r) => r.kind === "csp" && r.who === "worker:/w.js";
    await waitFor(() => page.records.some(fromWorker), 5000, () => "a CSP event from the Worker");
    assert.ok(page.records.some((r) => r.kind === "attached" && r.type === "worker"));
    assert.equal(page.records.filter((r) => r.kind === "harness-warning").length, 0);
    assert.equal(page.records.filter(fromWorker)[0].directive, "connect-src");
    await ctx.dispose();
  } finally {
    // A failed assertion must not leave the listener open: the process would never end.
    server.closeAllConnections();
    await new Promise((ok) => server.close(ok));
  }
}

async function selftest(rig) {
  const set = await isolation(rig);
  await wipe(rig, set);
  await redaction(rig, redactionUnit());
  await helpers(set.pages[0]);
  await cspControl(set.pages[0]);
  await workerCapture(rig);
  console.log("harness self test ok: isolation, wipe, redaction, helpers, csp, worker csp");
}

withStack("selftest", selftest).catch((err) => {
  console.error(err.stack ?? err);
  process.exitCode = 1;
});
