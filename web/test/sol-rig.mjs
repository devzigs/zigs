// A rig for the Solana tests (sol-ceremony.mjs, sol-app.mjs). It loads the real page modules,
// as app.mjs does, with a stub page, an in-memory group store and the two wasm engines. One browser
// holds every seat of the wallets that it makes, so the page runs both ceremonies by itself.
// It loads the page modules through page.mjs, as app.mjs does (the names it reads: NAMES there).
import fs from "node:fs";
import * as Z from "../pkg/zigs_engine.js";
import * as W from "../sol/wasm/sol_wasm.js";
import { loadPage } from "./page.mjs";

const KEY_NAME = "api-key";

const web = new URL("../", import.meta.url);
Z.initSync({ module: fs.readFileSync(new URL("pkg/zigs_engine_bg.wasm", web)) });
W.initSync({ module: fs.readFileSync(new URL("sol/wasm/sol_wasm_bg.wasm", web)) });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The server of the page: /sol/config.json answers with `rpcUrl`, or with 503 when `down` is set.
// `calls` counts the requests for it.
// The URL has the shape of a Helius URL and no real key.
export const config = {
  rpcUrl: `https://devnet.helius-rpc.com/?${KEY_NAME}=not-a-real-key`,
  down: false,
  calls: 0,
};
const otherFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) !== "/sol/config.json") return otherFetch(url, init);
  config.calls++;
  if (config.down) {
    return Response.json({ error: "Solana is not set up on this server." }, { status: 503 });
  }
  return Response.json({ rpcUrl: config.rpcUrl });
};

// A page that does nothing: any property is a function that returns the page again.
const stub = () =>
  new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : stub()),
    apply: () => stub(),
    construct: () => stub(),
    set: () => true,
    has: (_target, key) => key !== "Notification",
  });
export const storage = new Map();
Object.assign(globalThis, {
  Node: class {},
  document: stub(),
  history: { replaceState() {} },
  requestAnimationFrame: () => 0,
  matchMedia: () => ({ matches: false }),
  location: { hash: "", href: "http://localhost/", origin: "http://localhost" },
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => {
      storage.set(k, String(v));
    },
    removeItem: (k) => {
      storage.delete(k);
    },
  },
  window: new Proxy(stub(), { get: (t, k) => (k === "crypto" ? globalThis.crypto : t[k]) }),
});

/** Loads the page and returns { t, Z, W, data, ... }. Call it once in a test. */
export async function loadRig() {
  const t = await loadPage();
  t.setZ(Z);
  await sleep(50);
  const store = makeStore();
  t.setDb(store.db);
  t.setMe("me-uid");
  const fakeZ = { ...Z, latestHeight: async () => 1000, ChainWallet: Offline };
  t.setZ(fakeZ);
  const waitFor = async (what, ok, ms = 60000) => {
    for (const t0 = Date.now(); !ok();) {
      if (Date.now() - t0 > ms) throw new Error("timeout: " + what);
      await sleep(50);
    }
  };
  return { t, Z, W, ...store, waitFor, wallet: (opts) => wallet(t, waitFor, opts) };
}

// No network: the chain height is fixed and a sync fails at once.
class Offline {
  constructor() {
    throw new Error("offline");
  }
}

/** A group store in memory, as the page sees it. `before(path, data)` (it may be async)
 * may change a write. `live(prefix)` counts the open watches under a path. */
function makeStore() {
  const data = new Map(),
    subs = [];
  // `before` may change a write; `lease(path)` says whether a lease of the path is free.
  const hook = { before: (_path, value) => value, lease: () => true };
  const under = (p) =>
    [...data.keys()].filter((k) => k.startsWith(p + "/") && !k.slice(p.length + 1).includes("/"));
  const notify = () => {
    for (const s of subs) s.run();
  };
  const listen = (path, run) => {
    const entry = { path, run };
    subs.push(entry);
    queueMicrotask(run);
    return () => {
      const at = subs.indexOf(entry);
      if (at >= 0) subs.splice(at, 1);
    };
  };
  // How many watches are open on a path that starts with `prefix`.
  const live = (prefix) => subs.filter((s) => s.path.startsWith(prefix)).length;
  const plain = (v) => JSON.parse(JSON.stringify(v));
  const docRef = (p) => ({
    id: p.split("/").pop(),
    async set(v) {
      data.set(p, await hook.before(p, plain(v)));
      notify();
    },
    async update(v) {
      data.set(p, await hook.before(p, { ...data.get(p), ...plain(v) }));
      notify();
    },
    async get() {
      return { exists: data.has(p), data: () => data.get(p) };
    },
    async acquire(o) {
      return { acquired: hook.lease(p, o) };
    },
    onSnapshot: (cb) =>
      listen(p, () =>
        cb({
          exists: data.has(p),
          id: p.split("/").pop(),
          data: () => data.get(p),
        }),
      ),
  });
  const colRef = (p) => ({
    doc: (id) => docRef(p + "/" + (id ?? Math.random().toString(16).slice(2, 22).padEnd(20, "0"))),
    onSnapshot: (cb) =>
      listen(p, () => {
        const docs = under(p).map((k) => ({ id: k.split("/").pop(), data: () => data.get(k) }));
        cb({ docs, size: docs.length });
      }),
  });
  return { data, notify, live, hook, db: { doc: docRef, collection: colRef } };
}

/** A wallet of `n` seats and rule `k`, held by this browser, up to its checked Zcash address. */
async function wallet(t, waitFor, { name = "Team", n = 3, k = 2, network = "testnet" } = {}) {
  await t.createGroup(name, n, k, null, network);
  const gid = t.state.gid;
  await waitFor("seat 1", () => t.state.seats[1]);
  for (let i = 2; i <= n; i++) await t.takeSeat(i, 3);
  await waitFor("every seat", () => Object.keys(t.state.seats).length === n);
  await waitFor("wallet checked", () => Object.keys(t.state.verify).length === n && t.state.wallet);
  return gid;
}
