// Serves web/ and gives it a shared document store: one Durable Object (SQLite) per group that
// pushes every change of that group to its connected members over a WebSocket.
import { DurableObject } from "cloudflare:workers";

const GROUP_ID = /^[0-9a-f]{20}$/;
// The light-wallet servers in NETWORKS (web/app-chain.js) that the page calls itself. The page may
// connect to nothing else. Our testnet node is /lwd of this Worker, which 'self' covers.
const CHAIN_SERVERS = ["https://zcash-testnet.chainsafe.dev",
  "https://zcash-mainnet.chainsafe.dev"].join(" ");

// No inline script or style runs: the app sets styles only through the CSSOM.
function policy(url) {
  const ws = (url.protocol === "https:" ? "wss://" : "ws://") + url.host;
  return [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${ws} ${CHAIN_SERVERS}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

// One shared password (secret APP_PASSWORD) for every request, any user name, until launch.
// Without the secret the app refuses everything, so a missing secret never opens it.
function authorized(req, env) {
  const [scheme, b64] = (req.headers.get("Authorization") || "").split(" ");
  if (scheme !== "Basic" || !b64 || !env.APP_PASSWORD) return false;
  let pass;
  try { pass = atob(b64).split(":").slice(1).join(":"); } catch { return false; }
  const enc = new TextEncoder();
  const a = enc.encode(pass), b = enc.encode(env.APP_PASSWORD);
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}

// The Solana Worker (web/sol/worker.js) owns all Helius traffic. A Worker takes the policy of its
// own script response, so only the /sol responses name the Helius host and policy() stays as is.
const SOL_HOST = "https://devnet.helius-rpc.com";
// The pinned key folder of the local prover (SOL-4): a path source, so no other object of that
// host. Only the /sol policy names it: the Solana Worker fetches the keys, the page does not.
const SOL_KEYS = "https://d3gbdb0egjwcw9.cloudfront.net/proving-keys/3a1c88f90f609eb1/";
const SOL_CONFIG = "/sol/config.json";

function solWorkerPolicy() {
  return [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    `connect-src 'self' ${SOL_HOST} ${SOL_KEYS}`,
    "base-uri 'none'",
  ].join("; ");
}

// The nested Worker of the local prover (/sol/prover/prover.worker.js, SOL-4) holds the whole
// witness. It loads its own files and connects nowhere else: the Solana Worker fetches the keys.
function proverPolicy() {
  return [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "connect-src 'self'",
    "base-uri 'none'",
  ].join("; ");
}

// web/sol/ is the Solana beta (ZOLANA.md). Its files exist only when SOL is "1", and then every
// response under /sol carries the Worker policy, so no spelling of the path reaches the Worker
// script without it. The path is decoded and matched without case: the asset server maps spellings.
function isSolPath(url) {
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { return true; }
  return /^[/\\]+sol([/\\]|$)/i.test(path);
}

// A path below /sol/prover, in any spelling that decodes to it, gets the policy of the prover.
function isProverPath(url) {
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { return false; }
  return /^[/\\]+sol[/\\]+prover([/\\]|$)/i.test(path);
}

function solResponse(res, policy = solWorkerPolicy()) {
  const out = new Response(res.body, res);
  out.headers.set("Content-Security-Policy", policy);
  out.headers.set("Referrer-Policy", "no-referrer");
  out.headers.set("X-Content-Type-Options", "nosniff");
  return out;
}

// The Helius Devnet URL holds an API key, so it is the secret HELIUS_DEVNET_URL and never a file
// of web/. The page asks for it here, behind the password gate. The key also needs Allowed
// Domains at Helius: the page sends its origin with every call.
function solConfig(req, env) {
  if (req.method !== "GET") return solResponse(new Response("Use GET.\n", { status: 405 }));
  const url = env.HELIUS_DEVNET_URL;
  const body = url ? { rpcUrl: url } : { error: "Solana is not set up on this server." };
  return solResponse(Response.json(body, {
    status: url ? 200 : 503, headers: { "Cache-Control": "no-store" },
  }));
}

// Every file but the page.
async function assets(req, env, url) {
  if (!isSolPath(url)) return env.ASSETS.fetch(req);
  if (env.SOL !== "1") return new Response("Not found\n", { status: 404 });
  if (url.pathname === SOL_CONFIG) return solConfig(req, env);
  const policy = isProverPath(url) ? proverPolicy() : solWorkerPolicy();
  return solResponse(await env.ASSETS.fetch(req), policy);
}

// The public side of the testnet light-wallet server answers this Worker only: Envoy checks the
// secret LWD_KEY that the Worker adds (infra/lwd). The page calls /lwd behind the password gate
// and never holds the key. Only the gRPC methods that the engine calls pass (wasm/src/chain.rs),
// so the route is no open proxy, and long streams such as GetMempoolStream stay closed.
const LWD_ORIGIN = "https://lwd.zigs.app";
const LWD_PATH = /^\/lwd(\/cash\.z\.wallet\.sdk\.rpc\.CompactTxStreamer\/([A-Za-z]+))$/;
const LWD_METHODS = new Set(["GetLatestBlock", "GetTreeState", "GetBlockRange", "GetTransaction",
  "SendTransaction"]);
// One GetBlockRange call asks for at most this many blocks, so no call asks for the whole chain.
// The engine asks for BATCH (1,000) blocks at a time (wasm/src/chain.rs); the margin of one more
// batch keeps a later, larger BATCH working. web/test/lwd.mjs checks that the limit stays above.
const LWD_MAX_BLOCKS = 2_000;
const LWD_MAX_RANGE_BODY = 256; // bytes; the frame of the engine has 19
const LWD_REQUEST = ["content-type", "x-grpc-web", "x-user-agent", "grpc-timeout"];
const LWD_RESPONSE = ["content-type", "grpc-status", "grpc-message"];

function only(headers, names) {
  const out = new Headers();
  for (const name of names) if (headers.has(name)) out.set(name, headers.get(name));
  return out;
}

// One group of an IPv6 address as numbers: a hex group, or a dotted IPv4 tail as two groups.
function ipv6Group(text) {
  if (/^[0-9a-f]{1,4}$/.test(text)) return [parseInt(text, 16)];
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text)?.slice(1).map(Number);
  return v4 && v4.every((x) => x < 256) ? [v4[0] * 256 + v4[1], v4[2] * 256 + v4[3]] : [NaN];
}

// The eight 16-bit groups of an IPv6 address, with "::" and a dotted IPv4 tail, or null.
function ipv6Groups(ip) {
  const halves = ip.toLowerCase().split("::");
  const side = (text) => (text ? text.split(":").flatMap(ipv6Group) : []);
  const head = side(halves[0]), tail = side(halves[1] ?? "");
  const gap = 8 - head.length - tail.length;
  const fits = halves.length === 1 ? gap === 0 : halves.length === 2 && gap >= 1;
  const groups = [...head, ...Array(Math.max(gap, 0)).fill(0), ...tail];
  return fits && !groups.some(Number.isNaN) ? groups : null;
}

// The key of a client for the limits per network (WS_PER_IP, LWD_PER_IP and the sockets and
// writes of a Store): an IPv4 address, or the /64 of an IPv6 address, because a client usually
// holds a whole /64. An IPv4-mapped IPv6 address is its IPv4 address. Without the header (local
// dev) the key is "local", and an address that does not parse is its own key.
// ponytail: an ISP that gives a customer a /56 or a /48 still gives it many counters.
function clientKey(req) {
  const ip = (req.headers.get("CF-Connecting-IP") || "").trim();
  if (!ip.includes(":")) return ip || "local";
  const g = ipv6Groups(ip);
  if (!g) return ip;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join(".");
  }
  return g.slice(0, 4).map((x) => x.toString(16)).join(":") + "::/64";
}

// Like WS_PER_IP in groupSocket, this fails open: without the binding (local tests), no limit.
async function overLwdLimit(req, env) {
  if (!env.LWD_PER_IP) return false;
  return !(await env.LWD_PER_IP.limit({ key: clientKey(req) })).success;
}

// A protobuf varint at p of b: [value, next p], or null. The value stays exact up to 2^53, which
// is far above any height that is allowed.
function varint(b, p) {
  let value = 0, scale = 1;
  for (let i = 0; i < 10 && p < b.length; i++, p++) {
    value += (b[p] & 0x7f) * scale;
    if (b[p] < 0x80) return [value, p + 1];
    scale *= 128;
  }
  return null;
}

// The readers of the protobuf wire types: [value, next p], or null. Groups (3, 4) are refused.
const WIRE = [
  varint,
  (b, p) => (p + 8 <= b.length ? [null, p + 8] : null),
  (b, p) => {
    const len = varint(b, p);
    const end = len && len[1] + len[0];
    return len && end <= b.length ? [b.subarray(len[1], end), end] : null;
  },
  null, null,
  (b, p) => (p + 4 <= b.length ? [null, p + 4] : null),
];

// The fields of one protobuf message: field number -> the values in order, or null.
function fields(b) {
  const out = new Map();
  for (let p = 0; p < b.length;) {
    const tag = varint(b, p);
    const read = tag && tag[0] >= 8 ? WIRE[tag[0] % 8] : null;
    const got = read ? read(b, tag[1]) : null;
    if (!got) return null;
    const num = Math.floor(tag[0] / 8);
    out.set(num, [...(out.get(num) ?? []), got[0]]);
    p = got[1];
  }
  return out;
}

// The height in the BlockID of a BlockRange field: 0 when it is absent (proto3 leaves zeros out),
// null when the field repeats or does not parse (protobuf would merge a repeat or take the last).
function heightOf(values) {
  if (!values) return 0;
  const one = values.length === 1 && values[0] instanceof Uint8Array;
  return one ? blockHeight(fields(values[0])) : null;
}

// The height (field 1) of a parsed BlockID: below 2^32 (the engine uses u32), 0 when absent.
function blockHeight(id) {
  if (!id) return null;
  const h = id.get(1) ?? [0];
  return h.length === 1 && typeof h[0] === "number" && h[0] < 2 ** 32 ? h[0] : null;
}

// The number of blocks that a GetBlockRange body asks for, or null when the body is not one
// uncompressed gRPC-web frame (flag 0) of a BlockRange. lightwalletd also streams a range
// backwards, so the span counts both ways.
function rangeSpan(b) {
  const len = ((b[1] * 256 + b[2]) * 256 + b[3]) * 256 + b[4];
  const range = b.length >= 5 && b[0] === 0 && len + 5 === b.length ? fields(b.subarray(5)) : null;
  const start = range && heightOf(range.get(1)), end = range && heightOf(range.get(2));
  return start === null || end === null ? null : Math.abs(end - start) + 1;
}

// The whole body of a request when it has at most `max` bytes, else null.
async function smallBody(req, max) {
  const parts = [];
  let size = 0;
  for (const reader = req.body?.getReader(); reader;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  parts.reduce((at, part) => (out.set(part, at), at + part.length), 0);
  return out;
}

// The body to send upstream: a GetBlockRange body only when its range is small enough. Other
// bodies stream as they come. A Response when the call is refused.
async function lwdBody(req, method) {
  if (method !== "GetBlockRange") return req.body;
  const bytes = await smallBody(req, LWD_MAX_RANGE_BODY);
  const span = bytes && rangeSpan(bytes);
  if (!span) return new Response("Send one GetBlockRange request.\n", { status: 400 });
  if (span <= LWD_MAX_BLOCKS) return bytes;
  return new Response(`A block range has at most ${LWD_MAX_BLOCKS} blocks.\n`, { status: 400 });
}

// The answer bodies stream: GetBlockRange is a server stream. The redirect stays unfollowed, so
// the key never goes to another host.
async function lwd(req, env, url) {
  const [, path, method] = LWD_PATH.exec(url.pathname) ?? [];
  if (!LWD_METHODS.has(method)) return new Response("Not found\n", { status: 404 });
  if (req.method !== "POST") return new Response("Use POST.\n", { status: 405 });
  if (await overLwdLimit(req, env)) {
    const text = "Too many light-wallet calls from this network. Wait a minute.\n";
    return new Response(text, { status: 429 });
  }
  const body = await lwdBody(req, method);
  if (body instanceof Response) return body;
  if (!env.LWD_KEY) {
    return new Response("The light-wallet server is not set up on this server.\n", { status: 503 });
  }
  const headers = only(req.headers, LWD_REQUEST);
  headers.set("x-zigs-lwd-key", env.LWD_KEY);
  let up;
  try {
    up = await fetch(LWD_ORIGIN + path, {
      method: "POST", headers, body, redirect: "manual",
    });
  } catch {
    return new Response("The light-wallet server did not answer.\n", { status: 502 });
  }
  const out = only(up.headers, LWD_RESPONSE);
  out.set("Cache-Control", "no-store");
  return new Response(up.body, { status: up.status, headers: out });
}

// The testnet registry of ZNS (docs/zns-spike.md). The page asks /zns for the whole registry and
// looks names up on the device, so no resolver learns which name a person pays. No header of the
// user goes upstream. web/zns.js holds the same ZNS_KEY, and web/test/zns.mjs checks both.
const ZNS_KEY = [
  "uviewtest1gkq78nsemsvs4qekadrv6qlqdmvcv2cct8k3c8cwycedpk90p8rtkx24qe8q73gg2ark8crqmmaavrer",
  "f7cxu0sp50an54crmeaalfxl72aetxnr89ksad4lvxzmnkyejhhwn65euzamt9wsukgfemeayhcesreasarmq600lf",
  "eju3qenh05e5e5cz6nhhsw3cfdcd3d08d0nxswxmkkxl2fq0hzv6t5dm3ftnz4y76236a49v3us4uq2tlsewf86tjt",
  "fwm6kue348me04rm7dw6uawv8myw7t5tyx2t453clhjz5f55lvh7hnvr8g8zt8lf4sy5rzq23ntp7g5ly6kyz2nkwf",
  "ek06llhjtuz2fft9rg6cuuwg4n7299vajnmq6swg3sf563r0jjzuwuvfpjhmfmydar9dcu3fkuawt6u8qu08vhg5mt",
  "hrcggrjuhht6f0perh0tqmdfrtgzvhjymay7h9ymvfxgd4r56uz6zrsf5gnvw5jy",
].join("");
const ZNS_PAGE = 500, ZNS_MAX_PAGES = 40; // the largest page of the resolver; pages per refresh
const ZNS_FRESH_MS = 60_000, ZNS_PAUSE_MS = 30_000, ZNS_DEADLINE_MS = 20_000;
// The only causes that the log holds: no text of the resolver, no text of an exception.
const ZNS_CAUSES = ["upstream", "deadline", "status", "bad page", "page cap"];
// The address has at most 1,000 characters: "utest1" and up to 994 more.
const ZNS_TEXT = {
  name: /^[a-z0-9]{1,63}$/, address: /^utest1[0-9a-z]{1,994}$/, txid: /^[0-9a-f]{64}$/,
  expires_at: /^(?:none|[0-9]+)$/,
};

const znsFail = (cause) => new Error(cause);

// A record that fails this check is left out, so its name gives "not found" and never a wrong
// address. One odd record must not stop the names of everyone else.
function znsValid(r) {
  const text = ([field, re]) => typeof r[field] === "string" && re.test(r[field]);
  return r !== null && typeof r === "object" && Object.entries(ZNS_TEXT).every(text)
    && Number.isSafeInteger(r.height) && r.height >= 0
    && ["claim", "update"].includes(r.last_action);
}

// An address in bech32 is the same in upper case. One such record must not fail the registry, so
// the Worker serves it in lower case. A mixed-case address is no bech32 and fails the check above.
const znsLower = (r) => (r && typeof r.address === "string" && r.address === r.address.toUpperCase()
  ? { ...r, address: r.address.toLowerCase() } : r);

const znsRecord = ({ name, address, txid, height, last_action, expires_at }) =>
  ({ name, address, txid, height, last_action, expires_at });

// One call. The error holds only a cause of ZNS_CAUSES: the text of a failure can hold text of the
// resolver, such as the start of a body that is not JSON.
async function znsCall(method, params, signal) {
  let body;
  try {
    const res = await fetch("https://light.zcash.me/zns-testnet", {
      method: "POST", headers: new Headers({ "content-type": "application/json" }),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      redirect: "manual", signal,
    });
    body = res.status === 200 ? await res.json() : null;
  } catch {
    throw znsFail(signal.aborted ? "deadline" : "upstream");
  }
  if (!body || body.error != null || !body.result || typeof body.result !== "object") {
    throw znsFail("upstream");
  }
  return body.result;
}

// The height that the resolver has read, from a resolver that shows the pinned key.
async function znsStatus(signal) {
  const { viewing_key, synced_height, synced } = await znsCall("status", {}, signal);
  const heightOk = Number.isSafeInteger(synced_height) && synced_height >= 0;
  if (viewing_key !== ZNS_KEY || !heightOk || typeof synced !== "boolean") throw znsFail("status");
  return { height: synced_height, synced };
}

// Every record of list_names. A page with fewer items than its limit is the last page, and then
// the count must reach `total`: a resolver that cuts a page short would hide names.
async function znsNames(signal) {
  const items = [];
  for (let n = 0; n < ZNS_MAX_PAGES; n++) {
    const page = await znsCall("list_names", { limit: ZNS_PAGE, offset: items.length }, signal);
    const sound = Array.isArray(page.items) && Number.isSafeInteger(page.limit) && page.limit > 0
      && Number.isSafeInteger(page.total);
    if (!sound) throw znsFail("bad page");
    items.push(...page.items);
    if (page.items.length >= page.limit) continue;
    if (items.length < page.total) throw znsFail("bad page");
    return items;
  }
  throw znsFail("page cap");
}

// ponytail: the snapshot lives in one isolate, and each isolate loads the registry on its own. A
// refresh reads every page: about 20 pages a minute per isolate at 10,000 names. The upgrade is a
// delta with a check for a reorganisation, and one copy in the Cache API or a Durable Object.
// Above ZNS_MAX_PAGES pages (20,000 names) every request answers 502.
let znsSnap = null; // { at, body }
let znsLoading = null; // the refresh in flight, shared by parallel requests
let znsPausedUntil = 0; // no call upstream before this time

// The sound records by name. A page boundary can repeat a record. A name with two different
// addresses, or with one record that fails the check, is left out: its address is not clear. A
// refresh that leaves something out writes one fixed line, so the operator sees it.
function znsByName(rows) {
  const all = rows.map(znsLower), good = all.filter(znsValid), byName = new Map();
  const unclear = new Set(all.filter((r) => !znsValid(r)).map((r) => r && r.name));
  for (const r of good) {
    const seen = byName.get(r.name);
    if (seen && seen.address !== r.address) unclear.add(r.name);
    byName.set(r.name, znsRecord(r));
  }
  for (const name of unclear) byName.delete(name);
  if (unclear.size) console.error("zns: left out");
  return byName;
}

// One refresh with one deadline. The answer body is made once, for all requests of the minute.
async function znsRefresh() {
  const signal = AbortSignal.timeout(ZNS_DEADLINE_MS), started = Date.now();
  const { height, synced } = await znsStatus(signal);
  const byName = znsByName(await znsNames(signal));
  const names = [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
  const body = JSON.stringify({ network: "test", key: ZNS_KEY, height, synced, names });
  znsSnap = { at: started, body };
  return znsSnap;
}

function znsFailed(e) {
  znsPausedUntil = Date.now() + ZNS_PAUSE_MS;
  console.error("zns: " + (ZNS_CAUSES.includes(e.message) ? e.message : "internal"));
  throw e;
}

// The shared refresh outlives the request that starts it (ctx.waitUntil). After a failure the
// route answers 502 with no call upstream for ZNS_PAUSE_MS, so a failing resolver is not hammered.
function znsSnapshot(ctx) {
  if (znsSnap && Date.now() - znsSnap.at < ZNS_FRESH_MS) return Promise.resolve(znsSnap);
  if (Date.now() < znsPausedUntil) return Promise.reject(znsFail("paused"));
  if (!znsLoading) {
    znsLoading = znsRefresh().catch(znsFailed).finally(() => { znsLoading = null; });
    // The waiting requests get the error. waitUntil gets a promise that does not reject, so the
    // runtime logs no second report of the same failure.
    ctx?.waitUntil(znsLoading.catch(() => {}));
  }
  return znsLoading;
}

async function zns(req, ctx) {
  if (req.method !== "GET") {
    return new Response("Use GET.\n", { status: 405, headers: { Allow: "GET" } });
  }
  try {
    const { body } = await znsSnapshot(ctx);
    return new Response(body, {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch {
    return new Response("The ZNS registry could not be read.\n", { status: 502 });
  }
}

async function groupSocket(req, env, url) {
  const gid = url.searchParams.get("g") || "";
  if (!GROUP_ID.test(gid)) return new Response("Add ?g= with a group id of 20 hex characters.", { status: 400 });
  if (env.WS_PER_IP && !(await env.WS_PER_IP.limit({ key: clientKey(req) })).success) {
    return new Response("Too many connections from this network. Wait a minute.", { status: 429 });
  }
  const fwd = new Request(req);
  fwd.headers.set("X-Group", gid);
  return env.STORE.get(env.STORE.idFromName("g:" + gid)).fetch(fwd);
}

// The https redirect and the password prompt: the Response to send, or null to let the request on.
function gate(req, env) {
  // Redirect before the password prompt, so a password never travels over plain http.
  // The scheme comes from the edge headers: local dev also sees http URLs.
  const http = (req.headers.get("cf-visitor") || "").includes('"http"')
    || req.headers.get("x-forwarded-proto") === "http";
  if (http) {
    const to = new URL(req.url);
    to.protocol = "https:";
    return Response.redirect(to.toString(), 301);
  }
  if (env.DEV_NO_AUTH === "1" || authorized(req, env)) return null;
  const text = "Zigs is not open yet. This preview needs a password.\n"
    + "Read about Zigs and get early access at https://zigs.app\n";
  return new Response(text, {
    status: 401, headers: { "WWW-Authenticate": 'Basic realm="Zigs preview", charset="UTF-8"' },
  });
}

export default {
  async fetch(req, env, ctx) {
    const refused = gate(req, env);
    if (refused) return refused;
    const url = new URL(req.url);
    if (url.pathname === "/ws") return groupSocket(req, env, url);
    if (url.pathname.startsWith("/lwd/")) return lwd(req, env, url);
    if (url.pathname === "/zns") return zns(req, ctx);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const page = await env.ASSETS.fetch(new URL("/index.html", url));
      const res = new HTMLRewriter()
        .on("title", { element: (e) => e.before('<script src="/shim.js"></script>', { html: true }) })
        .transform(page);
      const out = new Response(res.body, res);
      out.headers.set("Content-Security-Policy", policy(url));
      out.headers.set("X-Content-Type-Options", "nosniff");
      // web/_headers covers the assets served without this Worker; the page needs them here.
      out.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
      out.headers.set("Referrer-Policy", "no-referrer");
      out.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
      return out;
    }
    return assets(req, env, url);
  },
};

// Limits for a public relay with no accounts. Real documents stay under 50 KB.
const MAX_MESSAGE = 300_000; // characters in one WebSocket message
const MAX_DOC = 256_000; // characters in one stored document
const MAX_PATH = 200;
// Per group: members download their group's whole store on connect, so this also bounds that.
const MAX_TOTAL = 10_000_000;
const WRITES_PER_MIN = 300; // per client key (clientKey)
const CHARS_PER_MIN = 8_000_000; // per client key
// Global caps bound the cost when many IPs spam together; they can delay real users instead.
const WRITES_PER_MIN_ALL = 3_000;
const MAX_SOCKETS = 200;
const MAX_SOCKETS_PER_IP = 20;

const fail = (code, message) => Object.assign(new Error(message), { code });

export class Store extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, data TEXT NOT NULL)");
    this.total = this.sql.exec("SELECT COALESCE(SUM(LENGTH(data)), 0) AS n FROM docs").one().n;
    this.leases = new Map();
    this.rates = new Map();
  }

  async fetch(req) {
    const url = new URL(req.url);
    // Internal only: the Worker never routes a request to the old shared object named "main".
    if (url.pathname === "/export") return this.exportGroup(url.searchParams.get("g") || "");
    if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const gid = req.headers.get("X-Group") || "";
    if (!GROUP_ID.test(gid)) return new Response("missing group", { status: 400 });
    await this.adopt(gid);
    const ip = clientKey(req);
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) {
      return new Response("The group server is busy. Try again in a minute.", { status: 503 });
    }
    if (this.ctx.getWebSockets(ip).length >= MAX_SOCKETS_PER_IP) {
      return new Response("Too many connections from this network.", { status: 429 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [ip]);
    server.serializeAttachment({ gid });
    const docs = this.sql.exec("SELECT path, data FROM docs").toArray()
      .map((r) => ({ path: r.path, data: JSON.parse(r.data) }));
    server.send(JSON.stringify({ type: "init", docs }));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, raw) {
    let rid;
    try {
      const size = typeof raw === "string" ? raw.length : raw.byteLength;
      if (size > MAX_MESSAGE) throw fail("invalid_argument", "message is larger than " + MAX_MESSAGE + " characters");
      const m = JSON.parse(raw);
      rid = m.rid;
      this.limitRate(this.ctx.getTags(ws)[0] || "local", size);
      ws.send(JSON.stringify({ type: "reply", rid, ok: true, result: this.apply(m, ws.deserializeAttachment()?.gid) }));
    } catch (e) {
      ws.send(JSON.stringify({ type: "reply", rid, ok: false, code: e.code || "internal", message: String(e.message || e) }));
    }
  }

  // ponytail: counters live in memory per client key and reset when the object is evicted.
  // A blocked key does not count toward the global cap, so one network cannot stop everyone.
  limitRate(ip, size) {
    if (this.rates.size > 10_000) this.rates.clear();
    const mine = this.window(ip);
    mine.writes += 1;
    mine.chars += size;
    if (mine.writes > WRITES_PER_MIN || mine.chars > CHARS_PER_MIN) {
      throw fail("resource_exhausted", "Too many changes from this network. Wait a minute, then try again.");
    }
    const all = this.window("*");
    all.writes += 1;
    if (all.writes > WRITES_PER_MIN_ALL) {
      throw fail("resource_exhausted", "The group server is busy. Wait a minute, then try again.");
    }
  }

  window(key) {
    const now = Date.now();
    let r = this.rates.get(key);
    if (!r || now - r.start > 60_000) this.rates.set(key, (r = { start: now, writes: 0, chars: 0 }));
    return r;
  }

  apply(m, gid) {
    const path = String(m.path || ""), base = "groups/" + gid;
    const inGroup = path === base || path.startsWith(base + "/");
    const validPath = inGroup && path.length <= MAX_PATH && path.split("/").length % 2 === 0;
    if (!validPath) throw fail("invalid_argument", "bad doc path: " + path.slice(0, MAX_PATH));
    if (m.op === "acquire") return this.acquire(path, m.holder, m.ttlMs);
    if (m.op === "set" || m.op === "update") return this.write(path, m.op, m.data);
    throw fail("invalid_argument", "unknown op " + m.op);
  }

  write(path, op, patch) {
    const row = this.sql.exec("SELECT data FROM docs WHERE path = ?", path).toArray()[0];
    if (op === "update" && !row) throw fail("not_found", "no document at " + path);
    const data = op === "update" ? { ...JSON.parse(row.data), ...patch } : patch;
    const json = JSON.stringify(data);
    if (json.length > MAX_DOC) throw fail("invalid_argument", "document is larger than " + MAX_DOC + " characters");
    const delta = json.length - (row ? row.data.length : 0);
    if (this.total + delta > MAX_TOTAL) throw fail("resource_exhausted", "The group server is full.");
    this.sql.exec("INSERT OR REPLACE INTO docs (path, data) VALUES (?, ?)", path, json);
    this.total += delta;
    return this.broadcast({ type: "put", path, data });
  }

  // The store began as one object for every group. Copy this group's documents over once.
  async adopt(gid) {
    if (this.adopted) return;
    this.sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    if (!this.sql.exec("SELECT v FROM meta WHERE k = 'adopted'").toArray().length) {
      const old = await this.env.STORE.get(this.env.STORE.idFromName("main")).fetch("https://store/export?g=" + gid);
      for (const d of await old.json()) this.sql.exec("INSERT OR IGNORE INTO docs (path, data) VALUES (?, ?)", d.path, d.data);
      this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('adopted', ?)", gid);
      this.total = this.sql.exec("SELECT COALESCE(SUM(LENGTH(data)), 0) AS n FROM docs").one().n;
    }
    this.adopted = true;
  }

  exportGroup(gid) {
    if (!GROUP_ID.test(gid)) return Response.json([]);
    const base = "groups/" + gid;
    return Response.json(this.sql.exec("SELECT path, data FROM docs WHERE path = ? OR path LIKE ?", base, base + "/%").toArray());
  }

  // ponytail: leases live in memory; an evicted object forgets them, which only reopens a 5 s race.
  acquire(path, holder, ttlMs) {
    const now = Date.now();
    const cur = this.leases.get(path);
    if (cur && cur.until > now && cur.holder !== holder) return { acquired: false };
    this.leases.set(path, { holder, until: now + Math.min(Number(ttlMs) || 5000, 60000) });
    return { acquired: true };
  }

  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(s); } catch {} }
    return null;
  }
}
