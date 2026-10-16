// Three local servers, all bound to 127.0.0.1 only: the static server (test page, the shipped
// web/sol files), the mock Helius server (replays fixtures/sync.json and a few synthetic account
// replies) and a decoy that CSP must keep silent. From the P3b mock, changed for the P8c Worker.
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { syntheticEntries } from "./synthetic.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TYPES = {
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".html": "text/html; charset=utf-8",
};
const typeOf = (name) => TYPES[name.slice(name.lastIndexOf("."))] ?? "application/octet-stream";
const listen = (server) =>
  new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server.address().port)));
const body = (req) =>
  new Promise((ok) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c)).on("end", () => ok(Buffer.concat(chunks)));
  });

const recorded = () => JSON.parse(readFileSync(join(HERE, "fixtures/sync.json"), "utf8")).entries;

/** The recorded sync entries plus the synthetic ones that the Worker commands need. */
const fixtureEntries = (extra) => [...recorded(), ...syntheticEntries(), ...extra];

const matches = (entry, path, rpc, call) =>
  entry.path === path &&
  entry.rpcMethod === rpc &&
  (entry.param0 === undefined || call?.params?.[0] === entry.param0);

/** Replays recorded responses per (path, rpc method, first parameter) in order, then repeats. */
function mockHandler(entries, origins) {
  const used = new Map(),
    log = [],
    unmocked = [];
  const host = new URL(origins.mock).host;
  const cors = (req) => ({
    "access-control-allow-origin": req.headers.origin === origins.static ? origins.static : "null",
    "access-control-allow-headers": req.headers["access-control-request-headers"] ?? "*",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    vary: "Origin",
  });
  const answer = (req, res, raw) => {
    const { pathname } = new URL(req.url, "http://x");
    let call = {};
    try {
      call = JSON.parse(raw.toString("utf8"));
    } catch {
      /* not JSON: unmocked below */
    }
    const entry = { t: Date.now(), method: req.method, path: pathname, rpc: call.method ?? null };
    const list = entries.filter((e) => matches(e, pathname, entry.rpc, call));
    if (list.length === 0) {
      unmocked.push(entry);
      res.writeHead(404, cors(req));
      return res.end("{}");
    }
    const key = `${pathname}|${entry.rpc}|${call?.params?.[0] ?? ""}`;
    const n = used.get(key) ?? 0;
    used.set(key, n + 1);
    const hit = list[Math.min(n, list.length - 1)];
    const reply = { ...JSON.parse(hit.body.split("{{HOST}}").join(host)), id: call.id };
    log.push({ ...entry, seq: hit.seq, status: hit.status });
    res.writeHead(hit.status, { ...cors(req), "content-type": hit.contentType });
    res.end(JSON.stringify(reply));
  };
  const handler = async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors(req));
      return res.end();
    }
    answer(req, res, await body(req));
  };
  return { handler, log, unmocked };
}

/** The decoy counts every request. With a working CSP it sees none. */
function decoyHandler() {
  const hits = [];
  const handler = (req, res) => {
    hits.push({ method: req.method, path: req.url });
    res.writeHead(200, { "access-control-allow-origin": "*", "content-type": "text/javascript" });
    res.end("export default 1;");
  };
  return { handler, hits };
}

/** URL path to file path: the page files and every file of the Solana folder. */
function routes({ solDir, bundleDir }) {
  const table = {
    "/": join(HERE, "page/index.html"),
    "/index.html": join(HERE, "page/index.html"),
    "/page.js": join(HERE, "page/page.js"),
    "/control-worker.js": join(HERE, "page/control-worker.js"),
    "/test-worker.js": join(HERE, "page/test-worker.js"),
  };
  for (const name of readdirSync(solDir)) {
    if (/\.(js|wasm)$/.test(name)) table[`/sol/${name}`] = join(solDir, name);
  }
  const built = ["zolana.bundle.js", "hasher_wasm_simd_bg.wasm", "light_wasm_hasher_bg.wasm"];
  for (const name of built) {
    if (bundleDir) table[`/sol/${name}`] = join(bundleDir, name);
  }
  return table;
}

/**
 * cspFor(pathname, origins) gives the CSP of a response, or null for none. bundleDir serves
 * another build of the bundle (the unminified one). extraEntries adds mock replies.
 */
export async function startServers({ solDir, cspFor, bundleDir = null, extraEntries = [] }) {
  const [staticS, mockS, decoyS] = [createServer(), createServer(), createServer()];
  const [sp, mp, dp] = [await listen(staticS), await listen(mockS), await listen(decoyS)];
  const origins = {
    static: `http://127.0.0.1:${sp}`,
    mock: `http://127.0.0.1:${mp}`,
    decoy: `http://127.0.0.1:${dp}`,
  };
  const table = routes({ solDir, bundleDir });
  const mock = mockHandler(fixtureEntries(extraEntries), origins);
  const decoy = decoyHandler();
  const requests = [],
    reports = [];
  const send = (res, status, type, data, csp) => {
    const headers = {
      "content-type": type,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    };
    if (csp) headers["content-security-policy"] = csp;
    res.writeHead(status, headers);
    res.end(data);
  };
  staticS.on("request", async (req, res) => {
    const { pathname } = new URL(req.url, "http://x");
    requests.push({ t: Date.now(), method: req.method, path: pathname });
    if (pathname === "/csp-report") {
      reports.push(JSON.parse((await body(req)).toString("utf8") || "null"));
      return send(res, 204, "text/plain", "", null);
    }
    const file = table[pathname];
    const csp = cspFor(pathname, origins);
    if (!file) return send(res, 404, "text/plain", "not found", csp);
    send(res, 200, typeOf(file), readFileSync(file), csp);
  });
  mockS.on("request", mock.handler);
  decoyS.on("request", decoy.handler);
  const stop = () =>
    Promise.all([staticS, mockS, decoyS].map((s) => new Promise((ok) => s.close(ok))));
  return {
    origins,
    requests,
    reports,
    mockLog: mock.log,
    unmocked: mock.unmocked,
    decoyHits: decoy.hits,
    stop,
  };
}
