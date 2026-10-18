// Tests of solspike/demo-check.sh against local stubs.
// Usage: node solspike/test/demo-check.test.mjs
// Two stub listeners play the app origins (behind a password gate), and the first one also plays
// the fallback light-wallet server, Helius, the prover and both faucets. The stub notes each call,
// so the test also checks that the script sends only reads and prints no secret.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const SPIKE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = join(SPIKE, ".state/tmp/demo-check");
const NEEDLE = randomBytes(16).toString("hex");
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
const stub = { calls: [], broken: false, ports: [] };
const servers = [];
const origin = (i) => `http://127.0.0.1:${stub.ports[i]}`;
const host = (i) => `127.0.0.1:${stub.ports[i]}`;
const short = (text) => `${text.slice(0, 6)}…${text.slice(-4)}`;
const heliusUrl = () => `${origin(0)}/rpc?api-key=${NEEDLE}`;

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

function elfAccount() {
  const elf = Buffer.alloc(64);
  elf.writeUInt32BE(0x7f454c46, 0);
  elf.writeBigUInt64LE(64n, 0x28);
  return { value: { data: [Buffer.concat([Buffer.alloc(45), elf]).toString("base64"), "base64"] } };
}

function treeAccount() {
  const data = Buffer.alloc(stub.broken ? 18_608 : 40_080);
  data.writeUInt16LE(500, 116);
  return { value: { owner: POOL, data: [data.toString("base64"), "base64"] } };
}

const programAccount = (programData) => ({
  value: { data: { parsed: { info: { programData } } } },
});
const ACCOUNTS = {
  [APPROVALS]: () => programAccount("PD1"),
  [POOL]: () => programAccount("PD2"),
  PD1: elfAccount,
  PD2: elfAccount,
  [TREE]: treeAccount,
};
const RPC = {
  getVersion: () => ({ "solana-core": "stub" }),
  getBalance: () => ({ value: stub.broken ? 1000 : 5_000_000 }),
  getAccountInfo: ([address]) => ACCOUNTS[address]?.() ?? { value: null },
};

function rpc(req, res, body) {
  const { method, params } = JSON.parse(body);
  stub.calls.push(`rpc ${method}`);
  const allowed = ["https://app.zigs.app", origin(0), stub.broken ? "" : origin(1)];
  if (!allowed.includes(req.headers.origin)) return send(res, 403, "Forbidden");
  send(res, 200, JSON.stringify({ jsonrpc: "2.0", id: 1, result: RPC[method]?.(params) ?? null }));
}

function lwd(req, res, base, method) {
  stub.calls.push(`lwd ${method}`);
  if (base === "lwd" && req.headers.authorization !== AUTH) return send(res, 401, "");
  const height = base === "lwd" ? 4_500_002 : stub.broken ? 1000 : 4_500_000;
  const reply = {
    GetLatestBlock: field(1, height),
    GetLightdInfo: Buffer.concat([field(4, "test"), field(6, "77190ad9")]),
    GetTaddressBalance: field(1, 20_000_000),
  }[method];
  const trailer = frame(0x80, Buffer.from("grpc-status: 0\r\n"));
  const type = { "content-type": "application/grpc-web" };
  send(res, 200, Buffer.concat([frame(0, reply), trailer]), type);
}

const gated = (req) =>
  req.headers.authorization === AUTH || (stub.broken && req.socket.localPort === stub.ports[1]);
const PAGES = {
  "/": (req, res) =>
    gated(req)
      ? send(res, 200, "<html>")
      : send(res, 401, "password", { "www-authenticate": 'Basic realm="stub"' }),
  "/sol/config.json": (req, res) =>
    send(res, gated(req) ? 200 : 401, JSON.stringify({ rpcUrl: heliusUrl() })),
  // A broken prover echoes the secrets, so the test sees the redaction work.
  "/v1/zolana/prove": (req, res) =>
    stub.broken
      ? send(res, 500, `no prover at ${heliusUrl()} for ${PASSWORD}`)
      : send(res, 400, JSON.stringify({ code: "malformed_body" })),
  "/valar/api/status": (req, res) =>
    send(res, 200, JSON.stringify({ ready: !stub.broken, payout: "0.125", capRemaining: "9" })),
  "/solfaucet": (req, res) => send(res, 200, "faucet"),
};

function route(req, res, body) {
  const path = new URL(req.url, "http://stub").pathname;
  const grpc = /^\/(lwd|chain)\/cash\.z\.wallet\.sdk\.rpc\.CompactTxStreamer\/(\w+)$/.exec(path);
  if (grpc) return lwd(req, res, grpc[1], grpc[2]);
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
  const init = Buffer.from('{"type":"init","docs":[]}');
  socket.write(Buffer.concat([Buffer.from([0x81, init.length]), init]));
  socket.on("data", () => socket.end());
}

function writeConfig(name, config) {
  writeFileSync(join(TMP, name), JSON.stringify(config));
  return join(TMP, name);
}

let CONFIG = "";
before(async () => {
  for (let i = 0; i < 2; i += 1) {
    const server = createServer((req, res) => {
      const parts = [];
      req.on("data", (part) => parts.push(part));
      req.on("end", () => route(req, res, Buffer.concat(parts).toString()));
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
  writeFileSync(join(TMP, "open-password"), PASSWORD);
  chmodSync(join(TMP, "open-password"), 0o644);
  CONFIG = writeConfig("good.json", {
    apps: [{ origin: origin(0), passwordFile: join(TMP, "password") }, { origin: origin(1) }],
    solFees: [{ address: FEE }],
    zecTransparent: [{ address: TADDR, min: "0.1" }],
  });
});

after(() => servers.forEach((server) => server.closeAllConnections() || server.close()));

/** Runs demo-check.sh with the stub servers: the exit code and stdout plus stderr. */
function run(...args) {
  const env = {
    ...process.env,
    PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
    HELIUS_URL_FILE: join(TMP, "helius.url"),
    DEMO_CHECK_LWD: `${origin(0)}/chain`,
    DEMO_CHECK_VALAR: `${origin(0)}/valar`,
    DEMO_CHECK_SOL_FAUCET: `${origin(0)}/solfaucet`,
  };
  delete env.SOLSPIKE_FUNDER;
  delete env.SOLSPIKE_MOCK;
  stub.calls = [];
  return new Promise((done) => {
    execFile("sh", [join(SPIKE, "demo-check.sh"), ...args], { env }, (err, out, errOut) =>
      done({ code: err ? err.code : 0, out: out + errOut }),
    );
  });
}

const words = (out) =>
  Object.fromEntries(
    [...out.matchAll(/^(PASS|FAIL|SKIP|PLAN) {2}(.+?): /gm)].map(([, word, name]) => [name, word]),
  );

const appWords = () => ({
  [`${host(0)} gate`]: "PASS",
  [`${host(0)} pages`]: "PASS",
  [`${host(0)} /lwd`]: "PASS",
  [`${host(0)} group socket`]: "PASS",
  [`${host(0)} Helius origin`]: "PASS",
  [`${host(1)} gate`]: "PASS",
  [`${host(1)} pages`]: "SKIP",
  [`${host(1)} /lwd`]: "SKIP",
  [`${host(1)} group socket`]: "SKIP",
  [`${host(1)} Helius origin`]: "PASS",
});

// The stub ELF cannot have the pinned hashes, so both program checks fail on good stubs too.
const allWords = (changes = {}) => ({
  ...appWords(),
  "fallback lwd": "PASS",
  "lwd heights": "PASS",
  "approvals program": "FAIL",
  "pool program": "FAIL",
  "tree 0": "PASS",
  prover: "PASS",
  "Valar faucet": "PASS",
  "Solana faucet": "PASS",
  [`SOL fee ${short(FEE)}`]: "PASS",
  [`TAZ ${short(TADDR)}`]: "PASS",
  ...changes,
});

test("a dry run lists every check and sends nothing", async () => {
  const { code, out } = await run("--dry-run", "--config", CONFIG);
  assert.equal(code, 0, out);
  const plan = Object.fromEntries(Object.keys(allWords()).map((name) => [name, "PLAN"]));
  assert.deepEqual(words(out), plan);
  assert.deepEqual(stub.calls, []);
});

test("the app part passes on good stubs, and a SKIP is no failure", async () => {
  const { code, out } = await run("--app-only", "--config", CONFIG);
  assert.equal(code, 0, out);
  assert.deepEqual(words(out), appWords());
  assert.match(out, /demo-check: 7 pass, 0 fail, 3 skipped/);
});

test("a full run fails only the pinned hashes, sends only reads and prints no secret", async () => {
  const { code, out } = await run("--config", CONFIG);
  assert.equal(code, 1, out);
  assert.deepEqual(words(out), allWords());
  assert.match(out, /FAIL {2}approvals program: Devnet runs .*, not the version 5 ELF/);
  assert.match(out, /PASS {2}lwd heights: within 2 blocks/);
  assert.match(out, /PASS {2}TAZ tm1111…1111: 0\.2 TAZ, floor 0\.1/);
  assert.match(out, /PASS {2}SOL fee Fee111…1111: 0\.005 SOL, floor 0\.003/);
  assert.deepEqual(stub.calls.filter((call) => !READS.test(call)), []);
  assert.ok(stub.calls.includes("ws") && stub.calls.includes("lwd GetTaddressBalance"));
  assert.ok(!out.includes(NEEDLE) && !out.includes(PASSWORD), "a secret was printed");
});

test("broken stubs give a FAIL with a reason, and the secrets stay hidden", async () => {
  stub.broken = true;
  const { code, out } = await run("--config", CONFIG);
  stub.broken = false;
  assert.equal(code, 1, out);
  const failed = [`${host(1)} gate`, `${host(1)} Helius origin`, "lwd heights", "tree 0", "prover"];
  const more = ["Valar faucet", `SOL fee ${short(FEE)}`];
  const changes = Object.fromEntries([...failed, ...more].map((name) => [name, "FAIL"]));
  assert.deepEqual(words(out), allWords(changes));
  assert.match(out, /gate: \/ answered 200 with no password/);
  assert.match(out, /Helius origin: getVersion answered 403 for Origin/);
  assert.match(out, /lwd heights: the heights differ by 4499002 blocks/);
  assert.match(out, /prover: an empty body answered 500: .*api-key=\[REDACTED\] for \[REDACTED\]/);
  assert.ok(!out.includes(NEEDLE) && !out.includes(PASSWORD), "a secret was printed");
});

test("a bad config stops the run with exit 2 and names the problem", async () => {
  const unified = { zecTransparent: [{ address: `utest1${"q".repeat(100)}`, min: "1" }] };
  const open = { apps: [{ origin: origin(0), passwordFile: join(TMP, "open-password") }] };
  const cases = [
    [unified, /is a unified address\. A shielded balance needs the viewing key/],
    [open, /open-password must exist with mode 600/],
    [{ solFee: [] }, /unknown key solFee/],
    [{ solFees: [{ address: FEE, min: "0.0000000001" }] }, /is no amount of this unit/],
  ];
  for (const [config, problem] of cases) {
    const { code, out } = await run("--dry-run", "--config", writeConfig("bad.json", config));
    assert.equal(code, 2, out);
    assert.match(out, problem);
  }
});

test("the approvals pin is ELF_V5 of tools/program-chain.mjs", () => {
  const text = (name) => readFileSync(join(SPIKE, "tools", name), "utf8");
  const [, v5] = /const ELF_V5 = "([0-9a-f]{64})"/.exec(text("program-chain.mjs"));
  assert.match(text("demo-check.mjs"), new RegExp(`sha256: "${v5}"`));
});
