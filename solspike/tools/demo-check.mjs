// The read-only preflight of the demo days (M8 of docs/hackathon-release.md). Each check prints
// PASS, FAIL or SKIP with a reason; the exit code is 1 on any FAIL and 2 on a bad config. Nothing
// here writes to a chain. Helius gets getVersion, getAccountInfo, getBalance and getSlot. Its
// indexer gets reads of recorded rows and of random values, and its gateway gets three CORS
// preflights per app (S20). The prover gets an empty body that it refuses. The light-wallet
// servers get GetLatestBlock, GetLightdInfo, GetTreeState and GetTaddressBalance. The group socket
// opens and closes without a message.
// Usage: sh solspike/demo-check.sh [--dry-run] [--app-only] [--config FILE]
// The config (default ~/.config/zigs/demo-check.json, outside the repo) is optional:
//   { "apps": [
//       { "origin": "https://app.zigs.app", "passwordFile": "~/.config/zigs/app-password" },
//       { "origin": "https://staging.zigs.app",
//         "passwordFile": "~/.config/zigs/staging-password" }],
//     "solFees": [{ "address": "<fee address of a seat>", "min": "0.003" }],
//     "zecTransparent": [{ "address": "tm...", "min": "0.1" }] }
// - apps: without it, app.zigs.app and staging.zigs.app with no password. A password file has
//   mode 600; without one, the checks behind the password gate SKIP. The password is never printed.
// - zecTransparent: transparent addresses only. A unified address needs a viewing key: read its
//   Available balance in the app.
// The Helius URL comes from ~/.config/zigs/helius-app.url (HELIUS_URL_FILE moves it). The
// variables DEMO_CHECK_LWD, DEMO_CHECK_VALAR and DEMO_CHECK_SOL_FAUCET move the other servers, and
// DEMO_CHECK_TIMEOUT_MS changes the 10 s limit of each call.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { redact } from "../harness/redact.mjs";
import { heliusFile } from "./paths.mjs";
import { APP_ORIGIN, readText } from "./rpc.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const LWD = process.env.DEMO_CHECK_LWD ?? "https://zcash-testnet.chainsafe.dev";
const VALAR = process.env.DEMO_CHECK_VALAR ?? "https://faucet.testnet.valargroup.dev";
const SOL_FAUCET = process.env.DEMO_CHECK_SOL_FAUCET ?? "https://faucet.solana.com";
const CONFIG = join(homedir(), ".config", "zigs", "demo-check.json");
const DEFAULT_APPS = [{ origin: "https://app.zigs.app" }, { origin: "https://staging.zigs.app" }];
const KEYS = ["apps", "solFees", "zecTransparent"];
const TIMEOUT = process.env.DEMO_CHECK_TIMEOUT_MS ?? "";
const TIMEOUT_MS = /^[1-9]\d{0,6}$/.test(TIMEOUT) ? Number(TIMEOUT) : 10_000; // each call, socket
const HEIGHT_GAP = 5n; // blocks between the light-wallet servers
const TREE_DEPTH = 10n; // blocks below the lowest tip, so that every server has the block
const BRANCH_ID = "77190ad9"; // NU7, the BRANCH_ID of live/zec-pay.mjs
// The fields of a TreeState that must be the same on every server: the block hash and the trees.
const TREE_STATE = { hash: 3, sapling: 5, orchard: 6, ironwood: 7 };
const SOL_FLOOR = "0.003"; // docs/hackathon-release.md section 8, step 10
// Each connect makes the group server keep one small row for this id, so it stays the same.
const PROBE_GROUP = "0".repeat(20);
const LWD_SERVICE = "cash.z.wallet.sdk.rpc.CompactTxStreamer";
const SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const T_ADDRESS = /^t[m2][1-9A-HJ-NP-Za-km-z]{33}$/;
const POOL = "sppU489D7A4U1exNo1oeMGZtLEofq3a6o2fR7UeoWB6";
const TREE = "33KVhbT4QtdQDrrrGwwThqD47Dh4Q6tA443t9jMNcWFN";
const TREE_BYTES = 40_080;
const ELF_MAGIC = 0x7f454c46;
// The recorded sync of key B and the execute of the approvals program: old rows of tree 0.
const SYNC_FILE = "solspike/mock/fixtures/sync.json";
const VECTOR_FILE = "sol-program/svm-tests/vectors/devnet-main.txt";
// The page waits up to 60 s for the indexer after Add SOL (docs/hackathon-release.md): 150 slots.
const SLOT_LAG = 150n;
// The CORS preflights of the page: a proof (sync and async) and an indexer read (worker.js).
const PREFLIGHTS = [
  ["/prove", "content-type,x-sync"],
  ["/prove", "content-type,x-async"],
  ["/getShieldedTransactionsByTags", "content-type"],
];
// The SHA-256 of the ELF in ProgramData, cut at the size in its ELF header. The approvals value is
// ELF_V5 of tools/program-chain.mjs; the pool value is the release hash of ZOLANA.md 6.1.
const PINS = [
  {
    name: "approvals program",
    address: "5PHZEHBMaYbFL9SFmMyP8kUayh3TFEyq2dvEYY3UGjkL",
    sha256: "b4bad24c6ae7cf2455b52780f78e35573f014ab3bc618fcbb49772b06c0d6eac",
    what: "the version 5 ELF",
  },
  {
    name: "pool program",
    address: POOL,
    sha256: "3641ffe2b2e635a0ed5978416559944d8c1618fe49372f9082eefeb2ac322cab",
    what: "the pool that the SDK pin reads (SOL-37)",
  },
];

class ConfigError extends Error {}
class Skip extends Error {}
const bad = (text) => {
  throw new ConfigError(text);
};
const skip = (text) => {
  throw new Skip(text);
};
const home = (path) => (path.startsWith("~/") ? join(homedir(), path.slice(2)) : path);
const short = (text) => `${text.slice(0, 6)}…${text.slice(-4)}`;
const signal = () => AbortSignal.timeout(TIMEOUT_MS);
const get = (url, auth) => {
  const headers = auth ? { authorization: auth } : {};
  return fetch(url, { headers, redirect: "manual", signal: signal() });
};

function options(argv) {
  const out = { dryRun: false, appOnly: false, config: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dry-run") out.dryRun = true;
    else if (argv[i] === "--app-only") out.appOnly = true;
    else if (argv[i] === "--config" && argv[i + 1]) out.config = argv[(i += 1)];
    else bad(`unknown argument ${argv[i]}. Use [--dry-run] [--app-only] [--config FILE]`);
  }
  return out;
}

function readConfig(file) {
  const path = home(file ?? CONFIG);
  if (file === null && !existsSync(path)) return {};
  let config = null;
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    bad(`cannot read the config ${path}: ${err.message}`);
  }
  return objectOf(config, KEYS, path);
}

/** The value, when it is a JSON object with no key outside `keys`. A misspelled key stops it. */
function objectOf(value, keys, where) {
  if (Object.prototype.toString.call(value) !== "[object Object]") bad(`${where}: not an object`);
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown) bad(`${where}: unknown key ${unknown}, use ${keys.join(", ")}`);
  return value;
}

const listOf = (config, key) =>
  Array.isArray(config[key] ?? []) ? (config[key] ?? []) : bad(`${key} must be a list`);

/** A decimal amount such as "0.003" in base units, with at most `decimals` decimals. */
function units(text, decimals, what) {
  const [, whole, part = ""] = /^(\d+)(?:\.(\d+))?$/.exec(String(text)) ?? [];
  if (!whole || part.length > decimals) bad(`${what}: "${text}" is no amount of this unit`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(part.padEnd(decimals, "0"));
}

const amount = (n, decimals) => {
  const digits = n.toString().padStart(decimals + 1, "0");
  return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`.replace(/\.?0+$/, "");
};

function appOf(value) {
  const entry = objectOf(value, ["origin", "passwordFile"], "apps");
  const origin = String(entry.origin ?? "");
  if (!/^https?:\/\/[^/]+$/.test(origin)) bad(`apps: "${origin}" is no origin`);
  const app = { origin, host: new URL(origin).host };
  if (!entry.passwordFile) return app;
  const file = home(String(entry.passwordFile));
  if (!existsSync(file) || (statSync(file).mode & 0o077) !== 0) {
    bad(`apps: ${entry.passwordFile} must exist with mode 600`);
  }
  // The same bytes as the secret of scripts/deploy-staging.sh: the file without its newlines.
  const password = readFileSync(file, "utf8").replace(/\n/g, "");
  if (!password) bad(`apps: ${entry.passwordFile} is empty`);
  app.auth = `Basic ${Buffer.from(`demo:${password}`).toString("base64")}`;
  redact.add(password, app.auth.slice(6));
  return app;
}

function solFeeOf(value) {
  const entry = objectOf(value, ["address", "min"], "solFees");
  const address = String(entry.address ?? "");
  if (!SOL_ADDRESS.test(address)) bad(`solFees: "${address}" is no Solana address`);
  return { address, floor: units(entry.min ?? SOL_FLOOR, 9, `solFees ${short(address)}`) };
}

function zecOf(value) {
  const entry = objectOf(value, ["address", "min"], "zecTransparent");
  const address = String(entry.address ?? "");
  if (address.startsWith("utest1")) {
    bad(`zecTransparent: ${short(address)} is a unified address. A shielded balance needs the ` +
      "viewing key: read the Available balance in the app.");
  }
  if (!T_ADDRESS.test(address)) bad(`zecTransparent: "${address}" is no transparent address`);
  if (entry.min === undefined) bad(`zecTransparent: ${short(address)} needs a min`);
  return { address, floor: units(entry.min, 8, `zecTransparent ${short(address)}`) };
}

const FIXED_BYTES = { 1: 8, 5: 4 }; // protobuf wire types 1 and 5

/** The fields of a protobuf message: varints as BigInt, length-delimited fields as Buffers. */
function fields(bytes) {
  const out = new Map();
  let at = 0;
  const take = (size) => {
    if (at + size > bytes.length) throw new Error("a protobuf message is cut short");
    at += size;
    return bytes.subarray(at - size, at);
  };
  const varint = () => {
    let n = 0n;
    for (let shift = 0n; ; shift += 7n) {
      const [byte] = take(1);
      n |= BigInt(byte & 0x7f) << shift;
      if (byte < 0x80) return n;
    }
  };
  while (at < bytes.length) {
    const key = Number(varint());
    const type = key & 7;
    if (type === 0) out.set(key >> 3, varint());
    else if (type === 2) out.set(key >> 3, take(Number(varint())));
    else if (FIXED_BYTES[type]) take(FIXED_BYTES[type]);
    else throw new Error(`protobuf wire type ${type} is not known`);
  }
  return out;
}

/** The frames of a gRPC-web body, as [flag, bytes]. */
function framesOf(bytes) {
  const frames = [];
  for (let at = 0; at + 5 <= bytes.length; at += 5 + bytes.readUInt32BE(at + 1)) {
    frames.push([bytes[at], bytes.subarray(at + 5, at + 5 + bytes.readUInt32BE(at + 1))]);
  }
  return frames;
}

/** The message of a gRPC-web answer. A status other than 0 throws with the server's text. */
function unframe(bytes, headers, method) {
  const frames = framesOf(bytes);
  // A trailers-only answer has the status in the HTTP headers, else it is in the trailer frame.
  const trailer = String(frames.find(([flag]) => flag & 0x80)?.[1] ?? "");
  const field = (name) =>
    new RegExp(`${name}:\\s*([^\\r\\n]*)`, "i").exec(trailer)?.[1] ?? headers.get(name);
  const status = field("grpc-status");
  if (status !== "0") {
    throw new Error(`${method} failed with gRPC status ${status}: ${field("grpc-message")}`);
  }
  return frames.find(([flag]) => flag === 0)?.[1] ?? Buffer.alloc(0);
}

async function grpc(base, method, message, auth) {
  const headers = { "content-type": "application/grpc-web+proto", "x-grpc-web": "1" };
  if (auth) headers.authorization = auth;
  const body = Buffer.alloc(5 + message.length);
  body.writeUInt32BE(message.length, 1);
  message.copy(body, 5);
  const url = `${base}/${LWD_SERVICE}/${method}`;
  const init = { method: "POST", headers, body, redirect: "manual", signal: signal() };
  const res = await fetch(url, init);
  if (res.status !== 200) throw new Error(`${method} answered HTTP ${res.status}`);
  return unframe(Buffer.from(await res.arrayBuffer()), res.headers, method);
}

// One GetLatestBlock call per server: the /lwd check, the fallback check and the height check
// share it. The first caller awaits it at once, so a refusal never goes unhandled.
const tips = new Map();
function tipOf(base, auth) {
  if (!tips.has(base)) tips.set(base, latestHeight(base, auth));
  return tips.get(base);
}

async function latestHeight(base, auth) {
  const height = fields(await grpc(base, "GetLatestBlock", Buffer.alloc(0), auth)).get(1);
  if (typeof height !== "bigint" || height === 0n) throw new Error("GetLatestBlock gave no height");
  return height;
}

let heliusUrl = null;
function helius() {
  if (heliusUrl === null) {
    heliusUrl = readText(heliusFile());
    redact.add(heliusUrl);
  }
  return heliusUrl;
}

/** The Helius URL with a path of the Zolana gateway. The api-key query stays. */
function zolanaUrl(path) {
  const url = new URL(helius());
  url.pathname = `/v1/zolana${path}`;
  return url;
}

// A missing key file gives null here; the Helius checks report it with its path.
const localHelius = () => {
  try {
    return helius();
  } catch {
    return null;
  }
};

async function rpc(method, params, origin = APP_ORIGIN, url = helius()) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const headers = { "content-type": "application/json", origin };
  const res = await fetch(url, { method: "POST", headers, body, signal: signal() });
  if (res.status === 403) {
    throw new Error(`${method} answered 403 for Origin ${origin}: add it to the Allowed Domains ` +
      "of the Helius key (D4)");
  }
  if (res.status !== 200) throw new Error(`${method} answered HTTP ${res.status}`);
  // The Solana Worker of the page can read an answer only when its CORS header allows the origin.
  const cors = res.headers.get("access-control-allow-origin");
  if (cors !== "*" && cors !== origin) throw new Error(`${method}: CORS does not allow ${origin}`);
  const reply = await res.json();
  if (reply.error) throw new Error(`${method}: ${reply.error.message}`);
  return reply.result;
}

const accountData = (reply) => Buffer.from(reply?.value?.data?.[0] ?? "", "base64");

async function gateCheck(app) {
  const res = await get(`${app.origin}/`);
  const prompt = /^Basic /i.test(res.headers.get("www-authenticate") ?? "");
  if (res.status !== 401 || !prompt) {
    throw new Error(`/ answered ${res.status} with no password, not 401 with a password prompt`);
  }
  return "/ answers 401 and asks for the password";
}

async function pagesCheck(app) {
  const page = await get(`${app.origin}/`, app.auth);
  if (page.status !== 200) throw new Error(`/ answered ${page.status} with the password`);
  const config = await get(`${app.origin}/sol/config.json`, app.auth);
  const rpcUrl = config.status === 200 ? (await config.json()).rpcUrl : undefined;
  if (typeof rpcUrl !== "string") throw new Error(`/sol/config.json answered ${config.status}`);
  redact.add(rpcUrl);
  const pages = "/ and /sol/config.json answer 200 with the password";
  // The other Helius checks use the local key file: a server with another key gets its own read.
  if (rpcUrl === localHelius()) return pages;
  await rpc("getVersion", [], app.origin, rpcUrl).catch((err) => {
    throw new Error(`the app serves another Helius key than the local file: ${err.message}`);
  });
  return `${pages}; its own Helius key answers for this origin`;
}

function socketCheck(app) {
  const url = `${app.origin.replace(/^http/, "ws")}/ws?g=${PROBE_GROUP}`;
  return new Promise((done, fail) => {
    const ws = new WebSocket(url, { headers: { authorization: app.auth } });
    // Node 22 fires error again inside close() of a socket that is not open: run end() once.
    let ended = false;
    const end = (error) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      ws.close();
      if (error) fail(new Error(error));
      else done("the socket opened and sent its init message");
    };
    const late = `no init message within ${TIMEOUT_MS / 1000} s`;
    const timer = setTimeout(() => end(late), TIMEOUT_MS);
    const init = (data) => String(data).startsWith('{"type":"init"');
    ws.onmessage = (event) => end(init(event.data) ? null : "the first message is no init message");
    ws.onerror = () => end("the socket did not open (refused upgrade or network error)");
  });
}

async function originCheck(app) {
  const version = await rpc("getVersion", [], app.origin);
  return `getVersion answers for Origin ${app.origin} (solana-core ${version?.["solana-core"]})`;
}

const lwdRouteCheck = async (app) => `height ${await tipOf(`${app.origin}/lwd`, app.auth)}`;

function appChecks(app) {
  const gated = (run) => () => (app.auth ? run(app) : skip("no passwordFile for it in the config"));
  return [
    { name: `${app.host} gate`, run: () => gateCheck(app) },
    { name: `${app.host} pages`, run: gated(pagesCheck) },
    { name: `${app.host} /lwd`, run: gated(lwdRouteCheck) },
    { name: `${app.host} group socket`, run: gated(socketCheck) },
    { name: `${app.host} Helius origin`, run: () => originCheck(app) },
  ].map((check) => ({ ...check, target: app.origin }));
}

async function fallbackCheck() {
  const height = await tipOf(LWD);
  const info = fields(await grpc(LWD, "GetLightdInfo", Buffer.alloc(0)));
  const [chain, branch] = [4, 6].map((n) => String(info.get(n) ?? ""));
  if (chain !== "test") throw new Error(`GetLightdInfo names the chain "${chain}", not test`);
  if (branch !== BRANCH_ID) {
    throw new Error(`GetLightdInfo names the branch id "${branch}", not ${BRANCH_ID} of NU7`);
  }
  return `height ${height}, chain test, branch id ${branch}`;
}

const nameOf = (base) => base.replace(/^https?:\/\//, "");
const lowest = (list) => list.reduce((a, b) => (a < b ? a : b));

/** The light-wallet servers whose tip is known, as [base, auth, tip]: at least two, else SKIP. */
async function answered(sources) {
  const settled = await Promise.allSettled(sources.map(([base, auth]) => tipOf(base, auth)));
  const known = sources.flatMap(([base, auth], i) =>
    settled[i].status === "fulfilled" ? [[base, auth, settled[i].value]] : [],
  );
  if (known.length < 2) skip("fewer than two light-wallet servers answered");
  return known;
}

async function heightsCheck(sources) {
  const known = await answered(sources);
  const heights = known.map(([, , tip]) => tip);
  const gap = heights.reduce((a, b) => (a > b ? a : b)) - lowest(heights);
  const list = known.map(([base, , tip]) => `${nameOf(base)} ${tip}`).join(", ");
  if (gap > HEIGHT_GAP) throw new Error(`the heights differ by ${gap} blocks: ${list}`);
  return `within ${gap} blocks: ${list}`;
}

const varintOf = (n) => {
  const out = [];
  for (let v = n; v >= 0x80n; v >>= 7n) out.push(Number(v & 0x7fn) | 0x80);
  return Buffer.from([...out, Number(n >> BigInt(7 * out.length))]);
};

/** The TreeState of one server at height h, as hex texts, after the checks on its own. */
async function treeStateOf(base, auth, h) {
  const request = Buffer.concat([Buffer.from([0x08]), varintOf(h)]); // BlockID.height
  const state = fields(
    await grpc(base, "GetTreeState", request, auth).catch((err) => {
      throw new Error(`${nameOf(base)}: ${err.message}`, { cause: err.cause });
    }),
  );
  const text = (n) => String(state.get(n) ?? "");
  const problem = [
    [text(1) === "test", `the network "${text(1)}", not test`],
    [state.get(2) === h, `the height ${state.get(2)}, not ${h}`],
    [/^[0-9a-f]{64}$/.test(text(3)), "a hash that is not 64 hex characters"],
    [text(7) !== "", "an empty ironwood tree"],
  ].find(([ok]) => !ok);
  if (problem) throw new Error(`${nameOf(base)} gives ${problem[1]}`);
  return Object.fromEntries(Object.entries(TREE_STATE).map(([key, n]) => [key, text(n)]));
}

async function treeStatesCheck(sources) {
  const known = await answered(sources);
  const h = lowest(known.map(([, , tip]) => tip)) - TREE_DEPTH;
  const states = await Promise.all(known.map(([base, auth]) => treeStateOf(base, auth, h)));
  const [first] = states;
  const differs = Object.keys(TREE_STATE).find((key) => states.some((s) => s[key] !== first[key]));
  if (differs) {
    const list = known.map(([base], i) => `${nameOf(base)} ${short(states[i][differs])}`);
    throw new Error(`the ${differs} at height ${h} differs: ${list.join(", ")}`);
  }
  const lengths = ["sapling", "orchard", "ironwood"].map((key) => `${key} ${first[key].length}`);
  return `height ${h}, hash ${short(first.hash)}, tree lengths: ${lengths.join(", ")}`;
}

/** The SHA-256 of the ELF after the 45-byte header of ProgramData, cut at its section table end. */
function elfHash(data) {
  const elf = data.subarray(45);
  if (elf.length < 64 || elf.readUInt32BE(0) !== ELF_MAGIC) throw new Error("ProgramData: no ELF");
  const size = Number(elf.readBigUInt64LE(0x28)) + elf.readUInt16LE(0x3a) * elf.readUInt16LE(0x3c);
  return createHash("sha256").update(elf.subarray(0, size)).digest("hex");
}

async function programCheck(pin) {
  const parsed = await rpc("getAccountInfo", [pin.address, { encoding: "jsonParsed" }]);
  const programData = parsed?.value?.data?.parsed?.info?.programData;
  if (!programData) throw new Error(`${pin.address} has no ProgramData account`);
  const data = accountData(await rpc("getAccountInfo", [programData, { encoding: "base64" }]));
  const sha = elfHash(data);
  const got = `${sha.slice(0, 8)}…, deployed at slot ${data.readBigUInt64LE(4)}`;
  if (sha !== pin.sha256) throw new Error(`Devnet runs ${got}, not ${pin.what}`);
  return `${pin.what}: ${got}`;
}

async function treeCheck() {
  const reply = await rpc("getAccountInfo", [TREE, { encoding: "base64" }]);
  const data = accountData(reply);
  const pinned = data.length === TREE_BYTES && reply.value.owner === POOL;
  if (!pinned || data.readUInt16LE(116) !== 500) {
    throw new Error(`tree 0 has ${data.length} bytes, not the layout of the SDK pin (SOL-37)`);
  }
  return `${TREE_BYTES} bytes, root history 500, fee per nullifier ${data.readBigUInt64LE(8)}`;
}

async function proverCheck() {
  const headers = { "content-type": "application/json", "x-sync": "true", origin: APP_ORIGIN };
  const init = { method: "POST", headers, body: "{}", signal: signal() };
  const res = await fetch(zolanaUrl("/prove"), init);
  const text = await res.text();
  if (res.status !== 400 || !text.includes("malformed_body")) {
    throw new Error(`an empty body answered ${res.status}: ${text.slice(0, 120)}`);
  }
  return "an empty body gets 400 malformed_body";
}

/** The recorded sync of key B: a signature, the hash of its first output, and the view tag of B. */
function recorded() {
  const { entries } = JSON.parse(readFileSync(join(ROOT, SYNC_FILE), "utf8"));
  const result = (method) => JSON.parse(entries.find((e) => e.rpcMethod === method).body).result;
  const [first] = result("getShieldedTransactionsByTags").transactions;
  const [match] = result("getEncryptedUtxosByTags").matches;
  const { hash } = first.outputSlots[0].outputContext;
  return { signature: first.txSignature, hash, viewTag: match.outputSlot.viewTag };
}

/** The execute of the approvals program on Devnet (ZOLANA.md 6.10): its pool part is a CPI. */
function executeSignature() {
  const vector = readFileSync(join(ROOT, VECTOR_FILE), "utf8");
  const [, signature] = /^# execute (\S+)$/m.exec(vector) ?? [];
  if (!signature) throw new Error(`${VECTOR_FILE} names no execute signature`);
  return signature;
}

/** One indexer call as plain JSON-RPC with the app Origin, as the page sends it. */
async function indexerCall(method, params) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const headers = { "content-type": "application/json", origin: APP_ORIGIN };
  // A redirect fails: the page would not follow it either (worker.js).
  const init = { method: "POST", headers, body, redirect: "error", signal: signal() };
  const res = await fetch(zolanaUrl(`/${method}`), init);
  if (res.status !== 200) throw new Error(`${method} answered HTTP ${res.status}`);
  const reply = await res.json();
  if (reply.error) throw new Error(`${method}: ${reply.error.message}`);
  return reply.result;
}

const asList = (value) => (Array.isArray(value) ? value : []);

/**
 * The rows of `signature` in the indexer: one names it and has an output in tree 0. Returns the
 * outputTreeId of the answer, the newest tree of the whole indexer: it tells nothing of the pool.
 */
async function indexedRows(signature) {
  const name = short(signature);
  const method = "getShieldedTransactionsBySignature";
  const result = await indexerCall(method, { txSignature: signature });
  const rows = result?.transactions;
  if (!Array.isArray(rows)) throw new Error(`the answer for ${name} has no transactions list`);
  if (rows.length === 0) throw new Error(`${name} is not indexed: an outage or a reset?`);
  const own = rows.map((row) => row?.transaction).filter((tx) => tx?.txSignature === signature);
  if (own.length === 0) throw new Error(`no row of ${name} has its transaction.txSignature`);
  const trees = own.flatMap((tx) => asList(tx.outputSlots)).map((s) => s?.outputContext?.tree);
  if (!trees.includes(TREE)) throw new Error(`${name} has no output in tree 0 (${short(TREE)})`);
  return result.outputTreeId;
}

/**
 * The liveness and wire-shape canary of the indexer: two old signatures stay indexed. It sees an
 * outage, a reset of the index and a changed answer. It does not see a new pool id: the rows of
 * the old pool can stay.
 */
async function canaryCheck() {
  const ids = await Promise.all([executeSignature(), recorded().signature].map(indexedRows));
  return `the execute and the recorded sync are indexed in tree 0 (outputTreeId ${ids.join(", ")})`;
}

let shipped = null;
/** The SDK client of the shipped bundle (web/sol). Its decoders refuse any unknown field. */
function bundleClient() {
  shipped ??= loadBundle();
  return shipped;
}

async function loadBundle() {
  // The bundle fetches its hasher wasm by a file: URL, and the fetch of Node refuses those.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const href = String(input instanceof Request ? input.url : input);
    if (!href.startsWith("file:")) return realFetch(input, init);
    const wasm = { headers: { "content-type": "application/wasm" } };
    return Promise.resolve(new Response(readFileSync(fileURLToPath(href)), wasm));
  };
  const sdk = await import(pathToFileURL(join(ROOT, "web/sol/zolana.bundle.js")).href);
  const withOrigin = (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("origin", APP_ORIGIN);
    const abort = AbortSignal.any([signal(), ...(init.signal ? [init.signal] : [])]);
    return realFetch(input, { ...init, headers, signal: abort });
  };
  const gateway = zolanaUrl("").href;
  const client = await sdk.createZolanaClient({
    solanaRpcUrl: helius(),
    indexerUrl: gateway,
    proverUrl: gateway,
    proverTee: false,
    fetch: withOrigin,
  });
  return { sdk, client };
}

/** 32 random bytes that match no row. Byte 0 is zero, so the value is in the BN254 field. */
const unknown = () => Uint8Array.from(randomBytes(32).fill(0, 0, 1));

/** The reads of a sync, on recorded rows and on random values. No list is empty. */
function shapeCalls(sdk, client, rows) {
  const bytes = (base58) => sdk.getAddressEncoder().encode(base58);
  const mine = { tags: [bytes(rows.viewTag)] };
  const none = { tags: [unknown()] };
  return [
    () => client.getShieldedTransactionsBySignature(rows.signature),
    () => client.getMerkleProofs(TREE, [bytes(rows.hash)]),
    () => client.getNonInclusionProofs(TREE, [unknown()]),
    () => client.getShieldedTransactionsByTags(mine),
    () => client.getEncryptedUtxosByTags(mine),
    () => client.getShieldedTransactionsByTags(none),
    () => client.getEncryptedUtxosByTags(none),
    () => client.getShieldedTransactionsByNullifiers({ nullifiers: [unknown()] }),
  ];
}

/** A refusal of the SDK as its code, method and path. These hold no key. */
function sdkRefusal(err) {
  if (typeof err?.code !== "string") throw err;
  const where = [err.details?.method, err.details?.path].filter(Boolean).join(" ");
  throw new Error(where ? `${err.code} (${where})` : err.code);
}

/**
 * The indexer shape check. The reads of a sync go through the SDK client of the shipped bundle.
 * So a new or a missing field fails here before it fails in the page. The indexer must also be
 * at most SLOT_LAG slots behind the RPC. An indexer ahead of the RPC is fine.
 */
async function shapeCheck() {
  const rows = recorded();
  const { sdk, client } = await bundleClient();
  // The RPC slot comes first, so the time of the calls does not count as lag.
  const rpcSlot = BigInt(await rpc("getSlot", [{ commitment: "confirmed" }]));
  const calls = shapeCalls(sdk, client, rows);
  const answers = await Promise.all(calls.map((call) => call().catch(sdkRefusal)));
  if (answers[0].transactions.length === 0) {
    throw new Error("the recorded signature is not indexed: the pool or the indexer was replaced?");
  }
  const oldest = answers.map((a) => a.context.slot).reduce((a, b) => (a < b ? a : b));
  const lag = rpcSlot > oldest ? rpcSlot - oldest : 0n;
  if (lag > SLOT_LAG) throw new Error(`the indexer trails the RPC by ${lag} > ${SLOT_LAG} slots`);
  return `${calls.length} reads decode in the SDK of the bundle, ${lag} slots behind the RPC`;
}

/** True when a CORS list (comma separated, any case) is "*" or names each item of `wanted`. */
function allows(list, wanted) {
  const names = String(list ?? "").toLowerCase().split(",").map((name) => name.trim());
  return names.includes("*") || wanted.split(",").every((name) => names.includes(name));
}

/**
 * One CORS preflight of the page, with the api-key query that the page sends. A browser fails on
 * a redirected preflight. It does not read allow-methods for POST, a CORS-safelisted method.
 */
async function preflight(origin, [path, asked]) {
  const headers = {
    origin,
    "access-control-request-method": "POST",
    "access-control-request-headers": asked,
  };
  const init = { method: "OPTIONS", headers, redirect: "error", signal: signal() };
  const res = await fetch(zolanaUrl(path), init);
  const allowed = (name) => res.headers.get(`access-control-allow-${name}`);
  const what = `OPTIONS ${path} (${asked})`;
  if (res.status >= 300) throw new Error(`${what} answered ${res.status}`);
  const origins = [origin, "*"];
  if (!origins.includes(allowed("origin"))) throw new Error(`${what} does not allow ${origin}`);
  if (!allows(allowed("headers"), asked)) throw new Error(`${what} does not allow these headers`);
}

async function corsCheck(app) {
  await Promise.all(PREFLIGHTS.map((route) => preflight(app.origin, route)));
  return `the ${PREFLIGHTS.length} preflights of the prover and the indexer allow ${app.origin}`;
}

async function valarCheck() {
  const res = await get(`${VALAR}/api/status`);
  const status = res.status === 200 ? await res.json() : {};
  if (status.ready !== true) throw new Error(`/api/status answered ${res.status}, not ready`);
  return `ready, payout ${status.payout} TAZ, ${status.capRemaining} TAZ left today`;
}

async function pageCheck(url) {
  const res = await get(url);
  if (res.status !== 200) throw new Error(`${url} answered ${res.status}`);
  return `${url} answers 200`;
}

function floorCheck(have, floor, decimals, unit) {
  const text = `${amount(have, decimals)} ${unit}, floor ${amount(floor, decimals)}`;
  if (have < floor) throw new Error(`${text}: fund it`);
  return text;
}

async function zecCheck(entry) {
  const address = Buffer.from(entry.address);
  const message = Buffer.concat([Buffer.from([0x0a, address.length]), address]);
  const balance = fields(await grpc(LWD, "GetTaddressBalance", message));
  return floorCheck(balance.get(1) ?? 0n, entry.floor, 8, "TAZ");
}

async function solFeeCheck(fee) {
  const reply = await rpc("getBalance", [fee.address, { commitment: "confirmed" }]);
  return floorCheck(BigInt(reply.value), fee.floor, 9, "SOL");
}

function chainChecks(config, apps) {
  const lwds = [[LWD], ...apps.filter((a) => a.auth).map((a) => [`${a.origin}/lwd`, a.auth])];
  const target = lwds.map(([base]) => base).join(" ");
  return [
    { name: "fallback lwd", target: LWD, run: fallbackCheck },
    { name: "lwd heights", target, run: () => heightsCheck(lwds) },
    { name: "lwd tree state", target, run: () => treeStatesCheck(lwds) },
    ...PINS.map((pin) => ({ name: pin.name, target: pin.address, run: () => programCheck(pin) })),
    { name: "tree 0", target: TREE, run: treeCheck },
    { name: "indexer", target: "Helius /v1/zolana, 8 reads in the SDK client", run: shapeCheck },
    { name: "indexer canary", target: "Helius by-signature reads", run: canaryCheck },
    { name: "prover", target: "Helius /v1/zolana/prove", run: proverCheck },
    // In chainChecks, not appChecks: scripts/deploy-staging.sh runs --app-only.
    ...apps.map((app) => ({
      name: `${app.host} Helius CORS`, target: app.origin, run: () => corsCheck(app),
    })),
    { name: "Valar faucet", target: VALAR, run: valarCheck },
    { name: "Solana faucet", target: SOL_FAUCET, run: () => pageCheck(SOL_FAUCET) },
    ...listOf(config, "solFees").map(solFeeOf).map((fee) => ({
      name: `SOL fee ${short(fee.address)}`, target: fee.address, run: () => solFeeCheck(fee),
    })),
    ...listOf(config, "zecTransparent").map(zecOf).map((entry) => ({
      name: `TAZ ${short(entry.address)}`, target: entry.address, run: () => zecCheck(entry),
    })),
  ];
}

/** PASS, FAIL or SKIP and the reason of one check. A fetch error names its cause. */
async function outcome(check) {
  try {
    return ["PASS", check.name, await check.run()];
  } catch (err) {
    const reason = [err.message, err.cause?.code ?? err.cause?.message].filter(Boolean).join(": ");
    return [err instanceof Skip ? "SKIP" : "FAIL", check.name, reason];
  }
}

async function main(argv) {
  const opts = options(argv);
  const config = readConfig(opts.config);
  const apps = (config.apps ? listOf(config, "apps") : DEFAULT_APPS).map(appOf);
  const checks = [...apps.flatMap(appChecks), ...(opts.appOnly ? [] : chainChecks(config, apps))];
  if (opts.dryRun) {
    for (const check of checks) console.log(`PLAN  ${check.name}: ${check.target}`);
    return 0;
  }
  const results = await Promise.all(checks.map(outcome));
  for (const [word, name, reason] of results) console.log(redact(`${word}  ${name}: ${reason}`));
  const count = (word) => results.filter(([w]) => w === word).length;
  console.log(`demo-check: ${count("PASS")} pass, ${count("FAIL")} fail, ${count("SKIP")} skipped`);
  return count("FAIL") > 0 ? 1 : 0;
}

// The group server holds the close handshake of the socket for 10 s, so the run exits as soon as
// its text is written.
const exit = (code) => process.stdout.write("", () => process.exit(code));
main(process.argv.slice(2)).then(exit, (err) => {
  const code = err instanceof ConfigError ? 2 : 1;
  process.stderr.write(redact(`demo-check: ${err?.message ?? err}\n`), () => exit(code));
});
