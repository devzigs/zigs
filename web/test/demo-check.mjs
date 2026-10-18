// Tests of solspike/demo-check.sh (M8) against local stubs. Usage: node web/test/demo-check.mjs
// Two stub listeners play the app origins: the config gives host 0 a password file and host 1
// none. Host 0 also plays the fallback light-wallet server, Helius, the prover and both faucets.
// Each run names the faults that the stub plays. The stub notes each call, so the test also checks
// that the script sends only reads and prints no secret.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

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
    "rpc (getVersion|getAccountInfo|getBalance)|" +
    "lwd (GetLatestBlock|GetLightdInfo|GetTaddressBalance))$",
);
const stub = { calls: [], faults: new Set(), ports: [] };
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
const RPC = {
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
  stub.calls.push(`${req.method} ${path}`);
  (PAGES[path] ?? ((_, r) => send(r, 404, "no route")))(req, res);
}

function upgrade(req, socket) {
  stub.calls.push("ws");
  socket.on("error", () => {});
  if (req.headers.authorization !== AUTH) return socket.end("HTTP/1.1 401 No\r\n\r\n");
  const key = `${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`;
  const accept = createHash("sha1").update(key).digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n");
  socket.write(`Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.on("data", () => socket.end());
  if (has("socket-silent")) return;
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
const allWords = (changes = {}) => ({
  ...appWords(),
  ...marked("PASS", ["fallback lwd", "lwd heights", "tree 0", "prover", "Valar faucet"]),
  ...marked("PASS", ["Solana faucet", `SOL fee ${short(FEE)}`, `TAZ ${short(TADDR)}`]),
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
  noSecret(out);
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

test("dead servers give a FAIL, and one light-wallet server alone is a SKIP", async () => {
  const faults = ["gate-no-prompt", "page-500", "socket-silent", "lwd-503", "lightd-status"];
  faults.push("tree-anchor", "prover-403", "solfaucet-503");
  const fast = { DEMO_CHECK_TIMEOUT_MS: "500" };
  const { code, out } = await run(["--config", CONFIGS.good], faults, fast);
  assert.equal(code, 1, out);
  const app = [`${host(0)} gate`, `${host(1)} gate`, `${host(0)} pages`, `${host(0)} /lwd`];
  const chain = [`${host(0)} group socket`, "fallback lwd", "tree 0", "prover", "Solana faucet"];
  const changes = { ...marked("FAIL", [...app, ...chain]), "lwd heights": "SKIP" };
  assert.deepEqual(words(out), allWords(changes));
  assert.match(out, /group socket: no init message within 0\.5 s/);
  assert.match(out, /fallback lwd: GetLightdInfo failed with gRPC status 12: unimplemented/);
  assert.match(out, /tree 0: tree 0 has 40080 bytes, not the layout/);
});

test("a wrong tree owner and a refused Helius key of the app are a FAIL", async () => {
  const { code, out } = await run(["--config", CONFIGS.good], ["tree-owner", "served-refused"]);
  assert.equal(code, 1, out);
  assert.deepEqual(words(out), allWords(marked("FAIL", ["tree 0", `${host(0)} pages`])));
  assert.match(out, /pages: getVersion answered 403 for Origin/);
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
