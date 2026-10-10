// Multi-browser simulation of the web app: three jsdom windows share one
// in-memory db (mimicking the group store), each with its own
// user id and localStorage, and the real WASM engine.
import fs from "fs";
import { JSDOM } from "jsdom";
import * as wasm from "./web/pkg/zec_frost_wasm.js";
await wasm.default({ module_or_path: fs.readFileSync("./web/pkg/zec_frost_wasm_bg.wasm") });

const html = fs.readFileSync("./web/index.html", "utf8");
const body = html.replace(/<script type="module">[\s\S]*<\/script>/, "");
let script = fs.readFileSync(new URL("./app.mjs", import.meta.url), "utf8")
  .replace('await import("./pkg/zec_frost_wasm.js")', "window.__wasm");

// ── in-memory db with onSnapshot ──
const docs = new Map(); const listeners = new Set();
const clone = (x) => JSON.parse(JSON.stringify(x));
function notify() { setTimeout(() => { for (const l of [...listeners]) l(); }, 5); }
let idc = 0;
function makeDb() {
  const docRef = (path) => ({
    id: path.split("/").pop(), path,
    async get() { const d = docs.get(path); return { id: path.split("/").pop(), exists: !!d, data: () => d && clone(d), metadata: {} }; },
    async set(v) { docs.set(path, clone(v)); notify(); },
    async update(v) { if (!docs.has(path)) throw { code: "invalid_argument" }; docs.set(path, { ...docs.get(path), ...clone(v) }); notify(); },
    async delete() { docs.delete(path); notify(); },
    async acquire() { return { acquired: true }; },
    onSnapshot(next) { const l = () => { const d = docs.get(path); next({ id: path.split("/").pop(), exists: !!d, data: () => d && clone(d), metadata: {} }); }; listeners.add(l); l(); return () => listeners.delete(l); },
    collection: (p) => colRef(path + "/" + p),
  });
  const colRef = (path) => ({
    path,
    doc: (id) => docRef(path + "/" + (id || ("auto" + (++idc)))),
    onSnapshot(next) {
      const l = () => {
        const ds = [...docs.entries()].filter(([k]) => k.startsWith(path + "/") && k.slice(path.length + 1).split("/").length === 1)
          .map(([k, v]) => ({ id: k.split("/").pop(), exists: true, data: () => clone(v), metadata: {} }));
        next({ docs: ds, size: ds.length, empty: !ds.length, docChanges: () => [], metadata: {} });
      };
      listeners.add(l); l(); return () => listeners.delete(l);
    },
  });
  return { doc: docRef, collection: colRef };
}

function browser(uid) {
  const dom = new JSDOM(body, { url: "https://zigs.example/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.__wasm = { ...wasm, default: async () => {} };
  const db = makeDb();
  const user = { id: async () => uid, can: async () => true, profiles: async (ids) => Object.fromEntries([].concat(ids).map((i) => [i, { id: i, name: i, avatarUrl: "", isMe: i === uid }])) };
  w.zigs = { use: async (n) => (n === "db" ? db : n === "user" ? user : null) };
  w.performance = performance;
  // jsdom: run module source as an async function
  w.eval("(async () => {" + script.replace(/^import .*$/m, "") + "})()");
  return w;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $$ = (w, sel) => [...w.document.querySelectorAll(sel)];
const btn = (w, text) => $$(w, "button").find((b) => b.textContent.trim() === text && !b.disabled);
async function until(desc, f, ms = 20000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (f()) return; await sleep(100); } throw new Error("timeout: " + desc); }

const A = browser("alice"), B = browser("bob"), C = browser("carol");
await until("engine", () => A.document.getElementById("engine-text").textContent.includes("ready"));
await until("lobby", () => btn(A, "Create and take seat 1"));
A.document.getElementById("g-name").value = "Club treasury";
A.document.querySelector("form").dispatchEvent(new A.Event("submit", { bubbles: true, cancelable: true }));
await until("group created", () => [...docs.keys()].some((k) => /^groups\/[^/]+\/seats\/1$/.test(k)));
const gid = [...docs.keys()].find((k) => /^groups\/[^/]+$/.test(k)).split("/")[1];
console.log("group", gid, "created by alice, seat 1 taken");

for (const w of [B, C]) {
  await until("group visible", () => $$(w, ".group-link").length);
  $$(w, ".group-link")[0].click();
  await until("take seat btn", () => btn(w, "Take this seat"));
  btn(w, "Take this seat").click();
  await sleep(300);
}
await until("ceremony done", () => docs.has(`groups/${gid}/meta/wallet`) && [1, 2, 3].every((i) => docs.get(`groups/${gid}/verify/${i}`)?.ok), 30000);
const wallet = docs.get(`groups/${gid}/meta/wallet`);
console.log("wallet", wallet.address.slice(0, 30) + "…  verified by all 3");
console.log("seat ladder A:", $$(A, ".ladder-label").map((x) => x.textContent).join(" | "));

// Bob proposes an Ironwood spend.
await until("propose", () => btn(B, "Propose spend"));
B.document.querySelector("#s-amt").closest("form").dispatchEvent(new B.Event("submit", { bubbles: true, cancelable: true }));
await until("session", () => [...docs.keys()].some((k) => k.includes("/sessions/") && k.split("/").length === 4));
const sidKey = [...docs.keys()].find((k) => k.includes("/sessions/") && k.split("/").length === 4);
console.log("spend proposed by bob:", docs.get(sidKey).amount, "zat,", docs.get(sidKey).pool);
// Alice and Carol open it and approve.
for (const w of [C, A]) {
  await until("session link", () => $$(w, ".session-link").length);
  $$(w, ".session-link")[0].click();
  await until("approve btn", () => btn(w, "Approve this spend"));
  console.log((w === A ? "alice" : "carol") + " sees:", $$(w, "table.tx tbody tr").map((r) => r.textContent).join(" / "));
  btn(w, "Approve this spend").click();
  await sleep(200);
}
// Bob (coordinator) must have the session open to coordinate.
await until("signed", () => docs.get(sidKey).status === "signed" || docs.get(sidKey).error, 30000);
if (docs.get(sidKey).error) throw new Error(docs.get(sidKey).error);
console.log("signed by", docs.get(sidKey).signers, "sig verifies under rk:", docs.get(sidKey).signatures[0].rk.slice(0, 16));
await until("finalize btn", () => btn(B, "Build proof and finish"));
console.log("bob builds the proof (main-thread fallback in jsdom)…");
btn(B, "Build proof and finish").click();
await until("complete", () => docs.get(sidKey).status === "complete", 180000);
const fin = docs.get(sidKey).final;
console.log("COMPLETE txid", fin.txid, fin.size, "bytes", fin.version, fin.ms, "ms");
await until("carol sees txid", () => C.document.body.textContent.includes(fin.txid));
console.log("carol's page shows the txid. Secrets in carol's localStorage:", Object.keys(JSON.parse(C.localStorage.getItem("zf-secrets"))));
const shared = JSON.stringify([...docs.values()]);
console.log("key packages in shared store?", shared.includes("signing_share"));
process.exit(0);
