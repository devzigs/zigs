// Tests of solspike/demo-check.sh (M8) against local stubs. Usage: node web/test/demo-check.mjs
// Two stub listeners play the app origins: the config gives host 0 a password file and host 1
// none. Host 0 also plays the fallback light-wallet server, Helius, its indexer, the prover and
// both faucets. Each run names the faults that the stub plays. The stub notes each call, so the
// test also checks that the script sends only reads and prints no secret. The last tests run the
// steps of solspike/tools/prove-canary.mjs (S20) with a stub SDK client, offline.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { redact } from "../../solspike/harness/redact.mjs";
import {
  STEPS, heliusFetch, keysOfB, runCanary,
} from "../../solspike/tools/prove-canary.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TMP = join(ROOT, "solspike/.state/tmp/demo-check");
const NEEDLE = randomBytes(16).toString("hex");
const OTHER_KEY = randomBytes(16).toString("hex");
const PASSWORD = `pw-${randomBytes(12).toString("hex")}`;
const AUTH = `Basic ${Buffer.from(`demo:${PASSWORD}`).toString("base64")}`;
const APPROVALS = "5PHZEHBMaYbFL9SFmMyP8kUayh3TFEyq2dvEYY3UGjkL";
const POOL = "sppU489D7A4U1exNo1oeMGZtLEofq3a6o2fR7UeoWB6";
const TREE = "33KVhbT4QtdQDrrrGwwThqD47Dh4Q6tA443t9jMNcWFN";
const FEE = `Fee${"1".repeat(40)}`;
const TADDR = `tm${"1".repeat(33)}`;
const READS = new RegExp(
  "^(GET /(|sol/config.json|valar/api/status|solfaucet)|POST /v1/zolana/prove|ws|" +
    "POST /v1/zolana/(getShieldedTransactionsBy(Signature|Tags|Nullifiers)|getMerkleProofs|" +
    "getNonInclusionProofs|getEncryptedUtxosByTags)|" +
    "OPTIONS /v1/zolana/(prove|getShieldedTransactionsByTags) POST|" +
    "rpc (getVersion|getAccountInfo|getBalance|getSlot)|" +
    "lwd (GetLatestBlock|GetLightdInfo|GetTaddressBalance))$",
);
const stub = { calls: [], values: [], faults: new Set(), ports: [] };
const servers = [];
const has = (fault) => stub.faults.has(fault);
const origin = (i) => `http://127.0.0.1:${stub.ports[i]}`;
const host = (i) => `127.0.0.1:${stub.ports[i]}`;
const short = (text) => `${text.slice(0, 6)}…${text.slice(-4)}`;
const heliusUrl = () => `${origin(0)}/rpc?api-key=${NEEDLE}`;

// A 64-byte ELF header with no sections, then zero bytes as in a real ProgramData account.
const ELF = Buffer.alloc(64);
ELF.writeUInt32BE(0x7f454c46, 0);
ELF.writeBigUInt64LE(64n, 0x28);
const ELF_SHA = createHash("sha256").update(ELF).digest("hex");

const varint = (n) => {
  const out = [];
  for (let v = BigInt(n); v >= 0x80n; v >>= 7n) out.push(Number(v & 0x7fn) | 0x80);
  return Buffer.from([...out, Number(BigInt(n) >> BigInt(7 * out.length))]);
};
const field = (no, value) =>
  typeof value === "string"
    ? Buffer.concat([varint((no << 3) | 2), varint(value.length), Buffer.from(value)])
    : Buffer.concat([varint(no << 3), varint(value)]);
const frame = (flag, bytes) => {
  const head = Buffer.from([flag, 0, 0, 0, 0]);
  head.writeUInt32BE(bytes.length, 1);
  return Buffer.concat([head, bytes]);
};
const send = (res, status, body, headers = {}) => res.writeHead(status, headers).end(body);
const base64 = (bytes) => [Buffer.from(bytes).toString("base64"), "base64"];

function treeAccount() {
  const data = Buffer.alloc(has("tree-size") ? 18_608 : 40_080);
  data.writeUInt16LE(has("tree-anchor") ? 499 : 500, 116);
  return { value: { owner: has("tree-owner") ? APPROVALS : POOL, data: base64(data) } };
}

const programAccount = (programData) => ({
  value: { data: { parsed: { info: { programData } } } },
});
const elfAccount = () => ({ value: { data: base64([...Buffer.alloc(45), ...ELF, 0, 0, 0, 0]) } });
const ACCOUNTS = {
  [APPROVALS]: () => programAccount("PD1"),
  [POOL]: () => programAccount("PD2"),
  PD1: elfAccount,
  PD2: elfAccount,
  [TREE]: treeAccount,
};
const SLOT = 512_000_000;
const RPC = {
  // The default commitment is finalized, about 32 slots behind confirmed.
  getSlot: ([config] = []) => (config?.commitment === "confirmed" ? SLOT : SLOT - 40),
  getVersion: () => ({ "solana-core": "stub" }),
  getBalance: () => ({ value: has("sol-low") ? 1000 : 5_000_000 }),
  getAccountInfo: ([address]) => ACCOUNTS[address]?.() ?? { value: null },
};

function rpc(req, res, body) {
  const { method, params } = JSON.parse(body);
  stub.calls.push(`rpc ${method}`);
  const allowed = ["https://app.zigs.app", origin(0), has("origin-refused") ? "" : origin(1)];
  const otherKey = new URL(req.url, "http://stub").searchParams.get("api-key") === OTHER_KEY;
  if (otherKey || !allowed.includes(req.headers.origin)) return send(res, 403, "Forbidden");
  const cors = has("no-cors") ? {} : { "access-control-allow-origin": "*" };
  const result = RPC[method]?.(params) ?? null;
  send(res, 200, JSON.stringify({ jsonrpc: "2.0", id: 1, result }), cors);
}

function lightdInfo() {
  if (has("lightd-status")) return [null, "grpc-status: 12\r\ngrpc-message: unimplemented\r\n"];
  return [Buffer.concat([field(4, has("chain-main") ? "main" : "test"), field(6, "77190ad9")])];
}

// The /lwd route is 5 blocks ahead of the fallback server: the largest gap that passes.
const tipOf = (base) => (base === "lwd" ? 4_500_005 : has("fallback-behind") ? 1000 : 4_500_000);
const zatOf = (body) => (!body.includes(TADDR) ? 0 : has("taz-low") ? 5_000_000 : 20_000_000);
const LWD_REPLIES = {
  GetLatestBlock: (base) => [field(1, tipOf(base))],
  GetLightdInfo: lightdInfo,
  GetTaddressBalance: (base, body) => [field(1, zatOf(body))],
};

function lwd(req, res, [, base, method], body) {
  stub.calls.push(`lwd ${method}`);
  const gated = base === "lwd";
  if (gated && req.headers.authorization !== AUTH) return send(res, 401, "");
  if (gated && has("lwd-503")) return send(res, 503, "");
  const [message, trailer = "grpc-status: 0\r\n"] = LWD_REPLIES[method](base, body);
  const frames = [message && frame(0, message), frame(0x80, Buffer.from(trailer))];
  send(res, 200, Buffer.concat(frames.filter(Boolean)), { "content-type": "application/grpc-web" });
}

function home(req, res) {
  if (req.headers.authorization === AUTH) return send(res, has("page-500") ? 500 : 200, "<html>");
  if (has("gate-open")) return send(res, 200, "<html>");
  const prompt = has("gate-no-prompt") ? {} : { "www-authenticate": 'Basic realm="stub"' };
  send(res, 401, "password", prompt);
}

function solConfig(req, res) {
  if (req.headers.authorization !== AUTH) return send(res, 401, "");
  if (has("config-503")) return send(res, 503, JSON.stringify({ error: "not set up" }));
  const rpcUrl = has("served-refused") ? `${origin(0)}/rpc?api-key=${OTHER_KEY}` : heliusUrl();
  send(res, 200, JSON.stringify({ rpcUrl }));
}

function prove(req, res) {
  // An echo of the secrets, so the test sees the redaction work.
  if (has("prover-echo")) return send(res, 500, `no prover at ${heliusUrl()} for ${PASSWORD}`);
  if (has("prover-403")) return send(res, 403, "Forbidden");
  send(res, 400, JSON.stringify({ code: "malformed_body" }));
}

// The indexer answers with the recorded sync of key B. No proof answer is recorded, so the stub
// writes the proofs by hand. It notes each value that is not a recorded one: those are random.
const SYNC = JSON.parse(readFileSync(join(ROOT, "solspike/mock/fixtures/sync.json"), "utf8"));
const results = (method) =>
  SYNC.entries.filter((e) => e.rpcMethod === method).map((e) => JSON.parse(e.body).result);
const [TAGGED, UNTAGGED] = results("getShieldedTransactionsByTags");
const [MATCHED, UNMATCHED] = results("getEncryptedUtxosByTags");
const [NO_NULLIFIER] = results("getShieldedTransactionsByNullifiers");
const ROWS = TAGGED.transactions;
const MINE = MATCHED.matches[0].outputSlot.viewTag;
const HASH = ROWS[0].outputSlots[0].outputContext.hash;
const VECTOR = readFileSync(join(ROOT, "sol-program/svm-tests/vectors/devnet-main.txt"), "utf8");
const [, EXECUTE] = /^# execute (\S+)$/m.exec(VECTOR);
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** The first byte of a 32-byte value in base58. */
const firstByte = (text) =>
  Number([...text].reduce((n, c) => n * 58n + BigInt(B58.indexOf(c)), 0n) >> 248n);

const gone = (signature) =>
  has("canary-empty") ||
  (has("execute-gone") && signature === EXECUTE) ||
  (has("sync-gone") && signature === ROWS[0].txSignature);

function bySignature({ txSignature }) {
  if (gone(txSignature)) return { outputTreeId: 0, transactions: [] };
  const tree = has("canary-tree") ? APPROVALS : TREE;
  const outputSlots = ROWS[0].outputSlots.map((slot) => ({
    ...slot,
    outputContext: { ...slot.outputContext, tree },
  }));
  // canary-other-sig: an indexed row of another signature.
  const transaction = has("canary-other-sig") ? ROWS[1] : { ...ROWS[0], txSignature, outputSlots };
  // canary-shape: the row without its wrapper, as the impact review first expected it.
  const row = has("canary-shape") ? transaction : { eventIndex: 0, transaction };
  return { outputTreeId: 0, transactions: [row] };
}

const proof = (leaf, treeType, more) => ({
  leaf,
  merkleContext: { treeType, tree: TREE },
  path: [HASH, HASH],
  ...more,
  root: HASH,
  rootSeq: 1,
  rootIndex: 0,
});
const bounds = { lowElement: HASH, lowElementIndex: 1, highElement: HASH, highElementIndex: 2 };
const INDEXER = {
  getShieldedTransactionsBySignature: bySignature,
  getMerkleProofs: ({ leaves }) => ({ proofs: leaves.map((l) => proof(l, 1, { leafIndex: 7 })) }),
  getNonInclusionProofs: ({ leaves }) => ({
    proofs: leaves.map((leaf) => proof(leaf, 2, bounds)),
    ...(has("indexer-extra") ? { note: "a field of a new release" } : {}),
  }),
  getShieldedTransactionsByTags: ({ tags }) => (tags.includes(MINE) ? TAGGED : UNTAGGED),
  getEncryptedUtxosByTags: ({ tags }) => (tags.includes(MINE) ? MATCHED : UNMATCHED),
  getShieldedTransactionsByNullifiers: () => NO_NULLIFIER,
};

// 150 slots behind the RPC is the largest lag that passes. indexer-stale puts one answer at 151.
function contextOf(method) {
  const stale = has("indexer-stale") && method === "getMerkleProofs";
  const lag = has("indexer-ahead") ? -5000 : stale ? 151 : 150;
  const context = { blockTime: 1_792_340_760, slot: SLOT - lag };
  if (has("indexer-blocktime") && method === "getMerkleProofs") delete context.blockTime;
  return context;
}

const json = { "content-type": "application/json" };

function indexer(req, res, method, body) {
  stub.calls.push(`POST /v1/zolana/${method}`);
  if (req.headers.origin !== "https://app.zigs.app") return send(res, 403, "Forbidden");
  if (has("indexer-hang") && method === "getNonInclusionProofs") return;
  const { id, params } = JSON.parse(body);
  const values = [params.leaves, params.tags, params.nullifiers].flat().filter(Boolean);
  stub.values.push(...values.filter((value) => value !== MINE && value !== HASH));
  if (has("canary-rpc-error") && method === "getShieldedTransactionsBySignature") {
    const error = { code: -32000, message: `index offline for key ${NEEDLE}` };
    return send(res, 200, JSON.stringify({ jsonrpc: "2.0", id, error }), json);
  }
  const result = { ...INDEXER[method](params), context: contextOf(method) };
  send(res, 200, JSON.stringify({ jsonrpc: "2.0", id, result }), json);
}

// Host 0 gets "*" for the origin and the headers. Host 1 gets its origin back and a header list
// in the case of a real server.
const PREFLIGHT_STATUS = { "cors-403": 403, "cors-300": 300 };
function preflight(req, res, url) {
  stub.calls.push(`OPTIONS ${url.pathname} ${req.headers["access-control-request-method"]}`);
  // The page sends its preflight to the URL of its call, with the key.
  if (url.searchParams.get("api-key") !== NEEDLE) return send(res, 401, "no api-key");
  const fault = Object.keys(PREFLIGHT_STATUS).find(has);
  if (fault) return send(res, PREFLIGHT_STATUS[fault], "");
  const host0 = req.headers.origin === origin(0);
  const echo = has("cors-origin") ? "https://other.example" : req.headers.origin;
  const list = `Content-Type, X-Sync${has("cors-headers") ? "" : ", X-Async"}`;
  send(res, 204, "", {
    "access-control-allow-origin": host0 ? "*" : echo,
    "access-control-allow-headers": host0 ? "*" : list,
  });
}

// The redirect fault: each call of the gateway moves once, but the POST of the prover check.
function redirected(req, res, url) {
  const proverPost = req.method === "POST" && url.pathname === "/v1/zolana/prove";
  const moved = url.searchParams.has("moved") || !url.pathname.startsWith("/v1/zolana/");
  if (!has("redirect") || proverPost || moved) return false;
  send(res, 307, "", { location: `${url.pathname}${url.search}&moved=1` });
  return true;
}

const PAGES = {
  "/": home,
  "/sol/config.json": solConfig,
  "/v1/zolana/prove": prove,
  "/valar/api/status": (req, res) =>
    send(res, 200, JSON.stringify({ ready: !has("valar-down"), payout: "0.125" })),
  "/solfaucet": (req, res) => send(res, has("solfaucet-503") ? 503 : 200, "faucet"),
};

function route(req, res, body) {
  const path = new URL(req.url, "http://stub").pathname;
  const grpc = /^\/(lwd|chain)\/cash\.z\.wallet\.sdk\.rpc\.CompactTxStreamer\/(\w+)$/.exec(path);
  if (grpc) return lwd(req, res, grpc, body);
  if (path === "/rpc") return rpc(req, res, body);
  const url = new URL(req.url, "http://stub");
  if (redirected(req, res, url)) return;
  if (req.method === "OPTIONS") return preflight(req, res, url);
  const method = path.replace(/^\/v1\/zolana\//, "");
  if (Object.hasOwn(INDEXER, method)) return indexer(req, res, method, body);
  stub.calls.push(`${req.method} ${path}`);
  (PAGES[path] ?? ((_, r) => send(r, 404, "no route")))(req, res);
}

function upgrade(req, socket) {
  stub.calls.push("ws");
  socket.on("error", () => {});
  if (req.headers.authorization !== AUTH) return socket.end("HTTP/1.1 401 No\r\n\r\n");
  // A held upgrade leaves the socket in CONNECTING, where Node 22 fired error inside close().
  if (has("socket-hang")) return;
  const key = `${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`;
  const accept = createHash("sha1").update(key).digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n");
  socket.write(`Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.on("data", () => socket.end());
  const text = Buffer.from(has("socket-other") ? '{"type":"reply"}' : '{"type":"init","docs":[]}');
  socket.write(Buffer.concat([Buffer.from([0x81, text.length]), text]));
}

function writeConfig(name, config) {
  writeFileSync(join(TMP, name), JSON.stringify(config));
  return join(TMP, name);
}

const config = (passwordFile) => ({
  apps: [{ origin: origin(0), passwordFile: join(TMP, passwordFile) }, { origin: origin(1) }],
  solFees: [{ address: FEE }],
  zecTransparent: [{ address: TADDR, min: "0.1" }],
});

const CONFIGS = {};
before(async () => {
  for (let i = 0; i < 2; i += 1) {
    const server = createServer((req, res) => {
      const parts = [];
      req.on("data", (part) => parts.push(part));
      req.on("end", () => route(req, res, Buffer.concat(parts).toString("latin1")));
    });
    server.on("upgrade", upgrade);
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    servers.push(server);
    stub.ports.push(server.address().port);
  }
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  writeFileSync(join(TMP, "helius.url"), `${heliusUrl()}\n`);
  writeFileSync(join(TMP, "password"), `${PASSWORD}\n`, { mode: 0o600 });
  writeFileSync(join(TMP, "wrong-password"), "not-the-password", { mode: 0o600 });
  writeFileSync(join(TMP, "open-password"), PASSWORD);
  chmodSync(join(TMP, "open-password"), 0o644);
  CONFIGS.good = writeConfig("good.json", config("password"));
  CONFIGS.wrong = writeConfig("wrong.json", config("wrong-password"));
});

after(() => servers.forEach((server) => server.closeAllConnections() || server.close()));

/** Runs demo-check.sh against the stubs with these faults: the exit code and the whole output. */
function run(args, faults = [], extra = {}) {
  const env = {
    ...process.env,
    PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
    HELIUS_URL_FILE: join(TMP, "helius.url"),
    DEMO_CHECK_LWD: `${origin(0)}/chain`,
    DEMO_CHECK_VALAR: `${origin(0)}/valar`,
    DEMO_CHECK_SOL_FAUCET: `${origin(0)}/solfaucet`,
    ...extra,
  };
  delete env.SOLSPIKE_FUNDER;
  delete env.SOLSPIKE_MOCK;
  stub.calls = [];
  stub.values = [];
  stub.faults = new Set(faults);
  const script = join(ROOT, "solspike/demo-check.sh");
  return new Promise((done) => {
    execFile("sh", [script, ...args], { env }, (err, out, errOut) =>
      done({ code: err ? err.code : 0, out: out + errOut }),
    );
  });
}

const words = (out) =>
  Object.fromEntries(
    [...out.matchAll(/^(PASS|FAIL|SKIP|PLAN) {2}(.+?): /gm)].map(([, word, name]) => [name, word]),
  );
const marked = (word, names) => Object.fromEntries(names.map((name) => [name, word]));
const noSecret = (out) => assert.ok(!out.includes(NEEDLE) && !out.includes(PASSWORD), out);

const APP_CHECKS = ["gate", "pages", "/lwd", "group socket", "Helius origin"];
const appWords = (changes = {}) => ({
  ...marked("PASS", APP_CHECKS.map((check) => `${host(0)} ${check}`)),
  ...marked("PASS", [`${host(1)} gate`, `${host(1)} Helius origin`]),
  ...marked("SKIP", ["pages", "/lwd", "group socket"].map((check) => `${host(1)} ${check}`)),
  ...changes,
});

// The stub ELF cannot have the pinned hashes, so both program checks fail on good stubs too.
// The ports are known only after before(): a function, not a constant.
const cors = () => [0, 1].map((i) => `${host(i)} Helius CORS`);
const allWords = (changes = {}) => ({
  ...appWords(),
  ...marked("PASS", ["fallback lwd", "lwd heights", "tree 0", "prover", "Valar faucet"]),
  ...marked("PASS", ["Solana faucet", `SOL fee ${short(FEE)}`, `TAZ ${short(TADDR)}`]),
  ...marked("PASS", ["indexer", "indexer canary", ...cors()]),
  ...marked("FAIL", ["approvals program", "pool program"]),
  ...changes,
});

test("a dry run lists every check and sends nothing", async () => {
  const { code, out } = await run(["--dry-run", "--config", CONFIGS.good]);
  assert.equal(code, 0, out);
  assert.deepEqual(words(out), marked("PLAN", Object.keys(allWords())));
  assert.deepEqual(stub.calls, []);
});

test("the app part passes on good stubs, and a SKIP is no failure", async () => {
  const { code, out } = await run(["--app-only", "--config", CONFIGS.good]);
  assert.equal(code, 0, out);
  assert.deepEqual(words(out), appWords());
  assert.match(out, /demo-check: 7 pass, 0 fail, 3 skipped/);
});

test("a full run fails only the pinned hashes, sends only reads and prints no secret", async () => {
  const { code, out } = await run(["--config", CONFIGS.good]);
  assert.equal(code, 1, out);
  assert.deepEqual(words(out), allWords());
  const elf = `Devnet runs ${ELF_SHA.slice(0, 8)}…, deployed at slot 0, not the version 5 ELF`;
  assert.ok(out.includes(`FAIL  approvals program: ${elf}`), out);
  assert.match(out, /PASS {2}lwd heights: within 5 blocks/);
  assert.match(out, /PASS {2}TAZ tm1111…1111: 0\.2 TAZ, floor 0\.1/);
  assert.match(out, /PASS {2}SOL fee Fee111…1111: 0\.005 SOL, floor 0\.003/);
  assert.deepEqual(stub.calls.filter((call) => !READS.test(call)), []);
  assert.ok(stub.calls.includes("ws") && stub.calls.includes("lwd GetTaddressBalance"));
  assert.match(out, /PASS {2}indexer: 8 reads decode in the SDK of the bundle, 150 slots behind/);
  assert.match(out, /PASS {2}indexer canary: the execute and the recorded sync are indexed in/);
  assert.match(out, /Helius CORS: the 3 preflights of the prover and the indexer allow http:/);
  assert.equal(stub.calls.filter((call) => call.startsWith("OPTIONS")).length, 6);
  // A leaf, two tags and a nullifier, each random and below the BN254 field.
  assert.deepEqual(stub.values.map(firstByte), [0, 0, 0, 0], stub.values.join(" "));
  noSecret(out);
});

// Each run plays one fault of the indexer canary and, for the first four, one of the CORS
// preflights. A null shape means that the shape check passes: the two checks differ.
const SDK_BY_SIGNATURE = /indexer: CLIENT_INVALID_RPC_RESPONSE \(getShieldedTransactionsBySig/;
const NOT_INDEXED = /indexer: the recorded signature is not indexed: the pool or the indexer/;
const CANARY_CASES = [
  ["canary-empty", /canary: \S+ is not indexed: an outage or a reset\?/, NOT_INDEXED],
  ["canary-tree", /canary: \S+ has no output in tree 0 \(33KVhb…cWFN\)/, SDK_BY_SIGNATURE],
  ["canary-shape", /canary: no row of \S+ has its transaction\.txSignature/, SDK_BY_SIGNATURE],
  ["sync-gone", /canary: 2CtnN3…\w{4} is not indexed/, NOT_INDEXED],
  ["execute-gone", /canary: 2bJ4T8…d2CV is not indexed/, null],
  ["canary-other-sig", /canary: no row of \S+ has its transaction\.txSignature/, null],
  ["canary-rpc-error", /canary: getShieldedTransactionsBySignature: index offline for key \[RED/,
    /indexer: CLIENT_\w+ \(getShieldedTransactionsBySignature/],
];
const CORS_CASES = [
  ["cors-403", /answered 403/, [0, 1]],
  ["cors-origin", /does not allow http:/, [1]],
  ["cors-headers", /\(content-type,x-async\) does not allow these headers/, [1]],
  ["cors-300", /answered 300/, [0, 1]],
];

test("the indexer canary fails when a probe is gone, moved, reshaped or refused", async () => {
  for (const [i, [fault, canary, shape]] of CANARY_CASES.entries()) {
    const [corsFault, cors, hosts] = CORS_CASES[i] ?? [null, null, []];
    const { code, out } = await run(["--config", CONFIGS.good], [fault, corsFault]);
    assert.equal(code, 1, out);
    const failed = ["indexer canary", ...hosts.map((h) => `${host(h)} Helius CORS`)];
    if (shape) failed.push("indexer");
    assert.deepEqual(words(out), allWords(marked("FAIL", failed)), `${fault}\n${out}`);
    assert.match(out, canary, out);
    if (shape) assert.match(out, shape, out);
    for (const h of hosts) {
      assert.match(out, new RegExp(`${host(h)} Helius CORS: OPTIONS /.*${cors.source}`));
    }
    noSecret(out);
  }
});

test("the shape check fails on a new field, a missing field and a stale answer", async () => {
  const blockTime = /CLIENT_INVALID_RPC_RESPONSE \(getMerkleProofs \$\.context\.blockTime\)/;
  const cases = [
    ["indexer-extra", "FAIL", /CLIENT_INVALID_RPC_RESPONSE \(getNonInclusionProofs\)/],
    ["indexer-blocktime", "FAIL", blockTime],
    // One answer of eight is 151 slots behind: the oldest answer counts.
    ["indexer-stale", "FAIL", /the indexer trails the RPC by 151 > 150 slots/],
    // An indexer ahead of the RPC is no lag.
    ["indexer-ahead", "PASS", /8 reads decode in the SDK of the bundle, 0 slots behind the RPC/],
  ];
  for (const [fault, word, text] of cases) {
    const { code, out } = await run(["--config", CONFIGS.good], [fault]);
    assert.equal(code, 1, out);
    // The canary reads no field of these: it passes, so the two checks are not the same test.
    const changes = word === "FAIL" ? marked("FAIL", ["indexer"]) : {};
    assert.deepEqual(words(out), allWords(changes), `${fault}\n${out}`);
    assert.match(out, new RegExp(`${word} {2}indexer: ${text.source}`), out);
    noSecret(out);
  }
});

test("a redirect of the gateway fails the indexer checks and both CORS checks", async () => {
  const { code, out } = await run(["--config", CONFIGS.good], ["redirect"]);
  assert.equal(code, 1, out);
  const failed = ["indexer", "indexer canary", ...cors()];
  assert.deepEqual(words(out), allWords(marked("FAIL", failed)), out);
  assert.match(out, /indexer canary: fetch failed: unexpected redirect/);
  assert.match(out, /Helius CORS: fetch failed: unexpected redirect/);
});

test("broken servers give a FAIL with a reason, and the secrets stay hidden", async () => {
  const faults = ["gate-open", "origin-refused", "fallback-behind", "chain-main", "tree-size"];
  faults.push("prover-echo", "valar-down", "sol-low", "taz-low", "config-503", "socket-other");
  const { code, out } = await run(["--config", CONFIGS.good], faults);
  assert.equal(code, 1, out);
  const app = [`${host(0)} gate`, `${host(1)} gate`, `${host(1)} Helius origin`];
  const more = [`${host(0)} pages`, `${host(0)} group socket`, "lwd heights", "fallback lwd"];
  const chain = ["tree 0", "prover", "Valar faucet", `SOL fee ${short(FEE)}`];
  chain.push(`TAZ ${short(TADDR)}`);
  assert.deepEqual(words(out), allWords(marked("FAIL", [...app, ...more, ...chain])));
  assert.match(out, /gate: \/ answered 200 with no password/);
  assert.match(out, /Helius origin: getVersion answered 403 for Origin/);
  assert.match(out, /lwd heights: the heights differ by 4499005 blocks/);
  assert.match(out, /fallback lwd: GetLightdInfo names the chain "main"/);
  assert.match(out, /group socket: the first message is no init message/);
  assert.match(out, /prover: an empty body answered 500: .*api-key=\[REDACTED\] for \[REDACTED\]/);
  noSecret(out);
});

// A time limit, so a lost timeout fails here and does not hold the run.
test("dead servers give a FAIL, and one light-wallet server alone is a SKIP", { timeout: 30_000 },
  async () => {
    const faults = ["gate-no-prompt", "page-500", "socket-hang", "lwd-503", "lightd-status"];
    faults.push("tree-anchor", "prover-403", "solfaucet-503", "indexer-hang");
    const fast = { DEMO_CHECK_TIMEOUT_MS: "500" };
    const started = Date.now();
    const { code, out } = await run(["--config", CONFIGS.good], faults, fast);
    assert.equal(code, 1, out);
    assert.ok(Date.now() - started < 8000, "a hung indexer read ends at the time limit");
    const app = [`${host(0)} gate`, `${host(1)} gate`, `${host(0)} pages`, `${host(0)} /lwd`];
    const chain = [`${host(0)} group socket`, "fallback lwd", "tree 0", "prover", "Solana faucet"];
    chain.push("indexer");
    const changes = { ...marked("FAIL", [...app, ...chain]), "lwd heights": "SKIP" };
    assert.deepEqual(words(out), allWords(changes));
    assert.match(out, /group socket: no init message within 0\.5 s/);
    assert.match(out, /fallback lwd: GetLightdInfo failed with gRPC status 12: unimplemented/);
    assert.match(out, /tree 0: tree 0 has 40080 bytes, not the layout/);
    assert.match(out, /indexer: CLIENT_REQUEST \(getNonInclusionProofs\)/);
  });

test("a wrong tree owner and a refused Helius key of the app are a FAIL", async () => {
  const { code, out } = await run(["--config", CONFIGS.good], ["tree-owner", "served-refused"]);
  assert.equal(code, 1, out);
  assert.deepEqual(words(out), allWords(marked("FAIL", ["tree 0", `${host(0)} pages`])));
  assert.match(out, /pages: the app serves another Helius key .*: getVersion answered 403/);
  assert.ok(!out.includes(OTHER_KEY), out);
});

test("a wrong password and a Helius answer with no CORS fail, and the run ends", async () => {
  const { code, out } = await run(["--app-only", "--config", CONFIGS.wrong], ["no-cors"]);
  assert.equal(code, 1, out);
  const failed = ["pages", "/lwd", "group socket", "Helius origin"].map((c) => `${host(0)} ${c}`);
  const changes = marked("FAIL", [...failed, `${host(1)} Helius origin`]);
  assert.deepEqual(words(out), appWords(changes));
  assert.match(out, /group socket: the socket did not open/);
  assert.match(out, /Helius origin: getVersion: CORS does not allow/);
  assert.match(out, /demo-check: 2 pass, 5 fail, 3 skipped/);
});

test("a bad config stops the run with exit 2 and names the problem", async () => {
  const unified = { zecTransparent: [{ address: `utest1${"q".repeat(100)}`, min: "1" }] };
  const open = { apps: [{ origin: origin(0), passwordFile: join(TMP, "open-password") }] };
  const cases = [
    [unified, /is a unified address\. A shielded balance needs the viewing key/],
    [open, /open-password must exist with mode 600/],
    [{ solFee: [] }, /unknown key solFee/],
    [{ apps: [{ origin: origin(0), passwrdFile: "x" }] }, /apps: unknown key passwrdFile/],
    [{ solFees: [{ address: FEE, minimum: "1" }] }, /solFees: unknown key minimum/],
    [{ zecTransparent: [{ address: TADDR, min: "1", floor: "1" }] }, /unknown key floor/],
    [{ solFees: [{ address: FEE, min: "0.0000000001" }] }, /is no amount of this unit/],
  ];
  for (const [bad, problem] of cases) {
    const { code, out } = await run(["--dry-run", "--config", writeConfig("bad.json", bad)]);
    assert.equal(code, 2, out);
    assert.match(out, problem);
  }
});

test("the pins are ELF_V5 of program-chain.mjs and the pool release hash of ZOLANA.md", () => {
  const text = (path) => readFileSync(join(ROOT, path), "utf8");
  const script = text("solspike/tools/demo-check.mjs");
  const [, v5] = /const ELF_V5 = "([0-9a-f]{64})"/.exec(text("solspike/tools/program-chain.mjs"));
  assert.match(script, new RegExp(`sha256: "${v5}"`));
  const [, pool] = /equals the release hash `([0-9a-f]{8})…`/.exec(text("ZOLANA.md"));
  assert.match(script, new RegExp(`address: POOL,\\s+sha256: "${pool}[0-9a-f]{56}"`));
});

const CANARY = join(ROOT, "solspike/tools/prove-canary.mjs");

/** A stub world of the prove canary: what each step gets, and a note of what it sends. */
function canaryWorld({ held = 5000n, lamports = 298_659_040, err = null } = {}) {
  const seen = { rpc: [] };
  const address = { solanaAddress: () => "OWNER" };
  const ANSWERS = {
    getBalance: { value: lamports },
    getLatestBlockhash: { value: { blockhash: "BH", lastValidBlockHeight: 100 } },
    simulateTransaction: { value: { err, unitsConsumed: 138_000, logs: ["log a", "log b"] } },
  };
  const inputs = { inputUtxos: [{ isDummy: () => false }, { isDummy: () => true }] };
  const world = {
    owner: "OWNER",
    signer: { address: "OWNER" },
    keypair: { shieldedAddress: () => address, viewingKey: () => "VIEWING" },
    client: {
      tree: "TREE",
      proveTransact: async (...args) => ((seen.prove = args), "DATA"),
    },
    sdk: {
      Wallet: class {},
      LocalKeys: { fromKeypair: () => "KEYS" },
      syncWallet: async () => {},
      transactInstruction: async (call) => ((seen.ix = call), "IX"),
    },
    transfer: {
      spendableSum: () => held,
      buildProofInputs: (...args) => ((seen.build = args), { proofInputs: inputs, tree: "TREE" }),
    },
    compile: { compileUnsignedTransaction: (message) => ((seen.message = message), "UNSIGNED") },
    kit: {
      signTransactionWithSigners: async (...args) => ((seen.sign = args), "SIGNED"),
      getBase64EncodedWireTransaction: () => "WIRE",
    },
    rpc: async (method, params) => (seen.rpc.push([method, params]), ANSWERS[method]),
  };
  return { world, seen, address, inputs };
}

const linesOf = async (steps, world, ms) => {
  const lines = [];
  const code = await runCanary(steps, world, (line) => lines.push(line), ms);
  return { code, lines };
};

test("the steps of the prove canary send what they should and nothing that writes", async () => {
  const { world, seen, address, inputs } = canaryWorld();
  const before = BigInt(Math.floor(Date.now() / 1000));
  const { code, lines } = await linesOf(STEPS, world);
  assert.equal(code, 0, lines.join("\n"));
  assert.deepEqual(lines.slice(0, 2), [
    "PASS  sync: key B holds 5000 lamports to spend in tree 0 and 298659040 public",
    "PASS  build: a self-payment of 1000 lamports from 1 note(s), expiry in 1 h",
  ]);
  assert.match(lines[2], /^PASS {2}prove: the gateway proved it in \d+\.\d\d s/);
  assert.match(lines[3], /^PASS {2}simulate: no error, 138000 compute units, pool transact only/);
  assert.match(lines[3], /-355 from 138355 on 16 October$/);
  assert.equal(lines[4], "prove-canary: PASS");
  const [, , identity, , request] = seen.build;
  assert.deepEqual(Object.keys(identity), ["address", "viewing"], "no owner that may not pay");
  assert.equal(request.recipient, address, "a self-payment");
  assert.deepEqual([request.amount, request.payer], [1000n, "OWNER"]);
  assert.ok(request.expiry > before && request.expiry <= before + 3601n, "a finite expiry");
  assert.deepEqual(seen.prove, [inputs, "KEYS"]);
  const ix = { payer: "OWNER", ownerSigners: [], inputTree: "TREE", outputTree: "TREE" };
  assert.deepEqual(seen.ix, { ...ix, data: "DATA" });
  assert.equal(seen.message.computeUnitLimit, 217_000);
  assert.equal(seen.message.lifetime.lastValidBlockHeight, 100n);
  assert.deepEqual(seen.sign, [[world.signer], "UNSIGNED"]);
  const options = { encoding: "base64", sigVerify: true, commitment: "confirmed" };
  assert.deepEqual(seen.rpc.at(-1), ["simulateTransaction", ["WIRE", options]]);
  assert.deepEqual(seen.rpc.map(([method]) => method),
    ["getBalance", "getLatestBlockhash", "simulateTransaction"]);
});

test("the prove canary stops on a missing note, an empty fee payer and a refused simulation",
  async () => {
    const cases = [
      [{ held: 999n }, "FAIL  sync: key B holds 999 lamports in plain SOL notes of tree 0, " +
        "not 1000: fund it with Add SOL (a write: ask the owner)"],
      [{ lamports: 9999 }, "FAIL  sync: key B holds 9999 public lamports, under 10000: it " +
        "cannot pay the fee (funding is a write: ask the owner)"],
      [{ err: { InstructionError: [0, { Custom: 7008 }] } }, "FAIL  simulate: the pool " +
        'refused it: {"InstructionError":[0,{"Custom":7008}]}, 138000 units; log a | log b'],
    ];
    for (const [change, failure] of cases) {
      const { code, lines } = await linesOf(STEPS, canaryWorld(change).world);
      assert.equal(code, 1, lines.join("\n"));
      assert.deepEqual(lines.slice(-2), [failure, "prove-canary: FAIL"]);
    }
  });

test("the prove canary prints the code of a refused proving key and the cause of a failure",
  { timeout: 10_000 }, async () => {
    const code = "CLIENT_PROVING_KEY_MISMATCH";
    const details = { keyName: "transfer_confidential_1_2", expectedSha256: "a".repeat(64) };
    details.reportedSha256 = "b".repeat(64);
    const { world } = canaryWorld();
    world.client.proveTransact = async () => {
      throw Object.assign(new Error(code), { code, details });
    };
    const steps = { ...STEPS, simulate: () => assert.fail("a refused proof was simulated") };
    const refused = await linesOf(steps, world);
    assert.equal(refused.code, 1);
    const keys = `"expectedSha256":"${details.expectedSha256}",` +
      `"reportedSha256":"${details.reportedSha256}"`;
    const named = `{"keyName":"transfer_confidential_1_2",${keys}}`;
    assert.equal(refused.lines.at(-2), `FAIL  prove: ${code} ${named}`);
    const http = Object.assign(new Error("API returned an HTTP error"), { facts: { status: 403 } });
    const indexer = Object.assign(new Error("CLIENT_INDEXER"), {
      code: "CLIENT_INDEXER", details: { method: "getShieldedTransactionsByTags" }, cause: http,
    });
    const sync = () => Promise.reject(Object.assign(new Error("WALLET_SYNC"), {
      code: "WALLET_SYNC", cause: indexer,
    }));
    const chain = await linesOf({ ...STEPS, sync }, world);
    assert.equal(chain.lines[0], "FAIL  sync: WALLET_SYNC <- CLIENT_INDEXER " +
      '{"method":"getShieldedTransactionsByTags"} <- API returned an HTTP error {"status":403}');
    const late = await linesOf({ ...STEPS, sync: () => new Promise(() => {}) }, world, 50);
    const lines = ["FAIL  sync: no answer in 0.05 s", "prove-canary: FAIL"];
    assert.deepEqual(late, { code: 1, lines });
  });

test("the fetch of the prove canary reaches only Helius, adds the Origin and refuses writes",
  async () => {
    const asked = [];
    const realFetch = async (url, init) => {
      asked.push([url, init.headers.get("origin")]);
      return new Response("{}");
    };
    const guarded = heliusFetch("helius.example", realFetch);
    const read = { method: "POST", body: '{"jsonrpc":"2.0","id":1,"method":"getBalance"}' };
    await guarded("https://helius.example/?api-key=k", read);
    assert.deepEqual(asked, [["https://helius.example/?api-key=k", "https://app.zigs.app"]]);
    for (const method of ["sendTransaction", "requestAirdrop"]) {
      const body = JSON.stringify([{ jsonrpc: "2.0", id: 1, method }]);
      await assert.rejects(guarded("https://helius.example/", { method: "POST", body }),
        new RegExp(`blocked the write method ${method}`));
    }
    await assert.rejects(guarded("https://enclave.example/prove", read), /blocked a request to/);
    const bytes = { method: "POST", body: new Uint8Array(4) };
    await assert.rejects(guarded("https://helius.example/", bytes), /body that is no text/);
    const request = new Request("https://helius.example/", read);
    await assert.rejects(guarded(request), /blocked a Request object/);
    assert.equal(asked.length, 1, "no refused call reached the network");
    const wasm = await guarded(pathToFileURL(CANARY).href);
    assert.equal(await wasm.text(), readFileSync(CANARY, "utf8"));
  });

test("key B: its seed and derived secrets are needles, and its signer must be its owner",
  async () => {
    const seedHex = randomBytes(32).toString("hex");
    const [nullifier, viewing] = ["11", "22"].map((byte) => byte.repeat(32));
    writeFileSync(join(TMP, "key-b.json"), JSON.stringify({ seedHex }));
    writeFileSync(join(TMP, "key-none.json"), JSON.stringify({ seed: seedHex }));
    const keypair = {
      nullifierKey: () => ({ secretBytes: () => Buffer.from(nullifier, "hex") }),
      viewingKey: () => ({ secretBytes: () => Buffer.from(viewing, "hex") }),
      shieldedAddress: () => ({ solanaAddress: () => "OWNER" }),
    };
    const sdk = { SigningKey: { fromEd25519Bytes: (seed) => seed }, ShieldedKeypair: {} };
    sdk.ShieldedKeypair.fromKeypair = () => keypair;
    let seen = null;
    const kitOf = (address) => ({
      createKeyPairSignerFromPrivateKeyBytes: async (seed) => ((seen = seed), { address }),
    });
    const before = process.env.SOLSPIKE_KEY_B;
    try {
      process.env.SOLSPIKE_KEY_B = join(TMP, "key-b.json");
      const keys = await keysOfB(sdk, kitOf("OWNER"));
      assert.equal(keys.owner, "OWNER");
      assert.ok(seen.every((byte) => byte === 0), "the seed bytes are wiped after use");
      const masked = redact(`${seedHex} ${nullifier} ${viewing}`);
      assert.equal(masked, "[REDACTED] [REDACTED] [REDACTED]");
      await assert.rejects(keysOfB(sdk, kitOf("OTHER")), /the kit signer of key B is not its/);
      process.env.SOLSPIKE_KEY_B = join(TMP, "key-none.json");
      await assert.rejects(keysOfB(sdk, kitOf("OWNER")), /the key B file has no seedHex/);
    } finally {
      if (before === undefined) delete process.env.SOLSPIKE_KEY_B;
      else process.env.SOLSPIKE_KEY_B = before;
    }
  });

test("the prove canary hides the Helius URL, needs its setup, and has no send call", async () => {
  redact.add(heliusUrl());
  const leak = { ...STEPS, sync: () => Promise.reject(new Error(`no answer from ${heliusUrl()}`)) };
  const { code, lines } = await linesOf(leak, {});
  assert.equal(code, 1);
  const hidden = `FAIL  sync: no answer from ${origin(0)}/rpc?api-key=[REDACTED]`;
  assert.deepEqual(lines, [hidden, "prove-canary: FAIL"]);
  const env = { ...process.env };
  delete env.ZOLANA_REPO;
  const out = await new Promise((done) => {
    execFile(process.execPath, [CANARY], { env }, (err, stdout, stderr) =>
      done({ code: err?.code ?? 0, text: stdout + stderr }),
    );
  });
  assert.deepEqual(out, { code: 2, text: "prove-canary: set ZOLANA_REPO\n" });
  const source = readFileSync(CANARY, "utf8");
  assert.doesNotMatch(source, /sendTransaction|sendAndConfirm|\.send\(/, "no send call");
});
