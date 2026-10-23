// Tests of the password gate (cf/src/gate.js), offline: node cf/test/gate.mjs   (Node 26)
// The gate sets a session cookie after a valid password and gives no Basic challenge to a
// background request of a browser, so that iOS Safari, which sends no cached password on the
// group WebSocket, never prompts again while the page runs.
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { COOKIE, MAX_AGE_S, gate, sessionCookie, withCookie } from "../src/gate.js";

// The real fetch handler of cf/src/index.js, as web/test/lwd.mjs loads it: a stub for the
// Cloudflare import, and the file URL of the gate module, which a data: URL cannot resolve.
const index = readFileSync(new URL("../src/index.js", import.meta.url), "utf8")
  .replace('import { DurableObject } from "cloudflare:workers";', "const DurableObject = class {};")
  .replace('from "./gate.js";', `from "${new URL("../src/gate.js", import.meta.url).href}";`);
const { default: worker } = await import(
  `data:text/javascript;base64,${Buffer.from(index).toString("base64")}`);

const PASSWORD = `pw-${randomBytes(12).toString("hex")}`;
const ENV = { APP_PASSWORD: PASSWORD };
const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
const BASE = "https://app.zigs.app";
const basic = (pw, user = "demo") => `Basic ${Buffer.from(`${user}:${pw}`).toString("base64")}`;
const NAV = { "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" };
const SOCKET = {
  "Sec-Fetch-Mode": "websocket", "Sec-Fetch-Dest": "websocket", Upgrade: "websocket",
};
const request = (path, headers = {}) => new Request(BASE + path, { headers });
const valueOf = (setCookie) => setCookie.split(";")[0].slice(COOKIE.length + 1);
const withSession = (value, headers = {}) =>
  ({ ...headers, Cookie: `other=1; ${COOKIE}=${value}` });

// ── The https redirect comes first ──
{
  const http = request("/x?y=1", { "cf-visitor": '{"scheme":"http"}' });
  const { refused } = await gate(http, { DEV_NO_AUTH: "1" }, NOW);
  assert.equal(refused.status, 301, "even with DEV_NO_AUTH");
  assert.equal(refused.headers.get("Location"), `${BASE}/x?y=1`);
  const proxied = request("/", { "x-forwarded-proto": "http", Authorization: basic(PASSWORD) });
  const onHttp = await gate(proxied, ENV, NOW);
  assert.equal(onHttp.refused.status, 301, "a password never goes on http");
  assert.deepEqual(await gate(request("/"), { DEV_NO_AUTH: "1" }, NOW), {}, "local runs stay open");
  console.log("ok  the https redirect comes first, and DEV_NO_AUTH keeps local runs open");
}

// ── A valid password passes and gets the session cookie ──
let session = null;
{
  const { refused, cookie } = await gate(request("/", { ...NAV, Authorization: basic(PASSWORD) }),
    ENV, NOW);
  assert.equal(refused, undefined);
  const parts = cookie.split("; ");
  assert.equal(parts[0].split("=")[0], COOKIE);
  assert.deepEqual(parts.slice(1),
    [`Max-Age=${MAX_AGE_S}`, "Path=/", "HttpOnly", "Secure", "SameSite=Strict"]);
  assert.equal(MAX_AGE_S, 604_800, "seven days");
  session = valueOf(cookie);
  const b64 = Buffer.from(PASSWORD).toString("base64");
  assert.ok(!cookie.includes(PASSWORD) && !cookie.includes(b64), "the cookie holds no password");
  assert.match(session, /^\d+\.[A-Za-z0-9_-]{43}$/);
  assert.equal(Number(session.split(".")[0]), NOW / 1000 + MAX_AGE_S, "the expiry is in the value");
  const any = await gate(request("/x", { Authorization: basic(PASSWORD, "anyone") }), ENV, NOW);
  assert.ok(any.cookie, "any user name");
  const secureOn = async (url) => (await sessionCookie(new Request(url), PASSWORD, NOW))
    .includes("; Secure");
  // wrangler dev gives the Worker the route host over http, with no cf-visitor header.
  assert.equal(await secureOn("http://app.zigs.app/"), false, "local dev: Safari drops Secure");
  assert.equal(await secureOn("https://app.zigs.app/"), true, "production is https");
  console.log("ok  a valid password passes and gets a seven-day HttpOnly cookie with no password");
}

// ── The cookie alone opens every route, the WebSocket too ──
{
  for (const [path, headers] of [["/ws?g=" + "0".repeat(20), SOCKET], ["/sol/worker.js", {}],
    ["/lwd/x", { "Sec-Fetch-Mode": "cors" }], ["/", NAV]]) {
    assert.deepEqual(await gate(request(path, withSession(session, headers)), ENV, NOW), {}, path);
  }
  const both = request("/", withSession(session, { Authorization: basic(PASSWORD) }));
  assert.deepEqual(await gate(both, ENV, NOW), {}, "a valid cookie gets no new one");
  const shadowed = { Cookie: `${COOKIE}=junk; ${COOKIE}=1.x; other=2; ${COOKIE}=${session}` };
  assert.deepEqual(await gate(request("/ws", { ...SOCKET, ...shadowed }), ENV, NOW), {},
    "a cookie of the same name from a sibling host shadows no valid one");
  const junk = (n) => Array(n).fill(`${COOKIE}=junk`);
  const fourth = { Cookie: [...junk(3), `${COOKIE}=${session}`].join("; ") };
  assert.deepEqual(await gate(request("/ws", { ...SOCKET, ...fourth }), ENV, NOW), {},
    "the fourth value still counts");
  const many = { Cookie: [...junk(4), `${COOKIE}=${session}`].join("; ") };
  const capped = await gate(request("/ws", { ...SOCKET, ...many }), ENV, NOW);
  assert.equal(capped.refused?.status, 401, "at most four values of the name count");
  const late = NOW + (MAX_AGE_S - 1) * 1000;
  assert.deepEqual(await gate(request("/ws", withSession(session, SOCKET)), ENV, late), {});
  console.log("ok  the cookie alone opens every route, the WebSocket too, until it expires");
}

// ── A forged, expired, malformed or old cookie is refused ──
{
  const [expiry, mac] = session.split(".");
  const flipped = (mac[0] === "A" ? "B" : "A") + mac.slice(1);
  const bad = [
    ["a forged mac", `${expiry}.${flipped}`],
    ["a longer life", `${Number(expiry) + 3600}.${mac}`],
    ["no mac", expiry],
    ["a short mac", `${expiry}.${mac.slice(1)}`],
    ["a long mac", `${expiry}.${mac}A`],
    ["junk", "x"],
    ["an empty value", ""],
  ];
  for (const [what, value] of bad) {
    const { refused } = await gate(request("/ws", withSession(value, SOCKET)), ENV, NOW);
    assert.equal(refused?.status, 401, what);
  }
  const expired = await gate(request("/ws", withSession(session, SOCKET)), ENV,
    NOW + MAX_AGE_S * 1000);
  assert.equal(expired.refused?.status, 401, "an expired cookie");
  const renamed = { Cookie: `x${COOKIE}=${session}` };
  assert.equal((await gate(request("/", renamed), ENV, NOW)).refused?.status, 401, "another name");
  const changed = { APP_PASSWORD: PASSWORD + "-new" };
  const old = await gate(request("/ws", withSession(session, SOCKET)), changed, NOW);
  assert.equal(old.refused?.status, 401, "a new password ends every old cookie");
  console.log("ok  a forged, expired, malformed, renamed or old-password cookie fails");
}

// ── No secret, no entry: also not with a cookie that an empty password would sign ──
{
  // WebCrypto takes no empty HMAC key, so node:crypto signs as cookieKey would with "".
  const keyOfEmpty = createHmac("sha256", "").update("zigs session cookie v1").digest();
  const expiry = String(NOW / 1000 + MAX_AGE_S);
  const empty = `${expiry}.${createHmac("sha256", keyOfEmpty).update(expiry).digest("base64url")}`;
  for (const env of [{}, { APP_PASSWORD: "" }]) {
    const tries = [request("/", withSession(empty, NAV)),
      request("/", { Authorization: basic("") }), request("/", withSession(session, NAV))];
    for (const req of tries) assert.equal((await gate(req, env, NOW)).refused?.status, 401);
  }
  const typo = request("/", { ...NAV, Authorization: basic(PASSWORD + "x") });
  const wrong = await gate(typo, ENV, NOW);
  assert.equal(wrong.refused?.status, 401, "a wrong password");
  const broken = await gate(request("/", { Authorization: "Basic %%%" }), ENV, NOW);
  assert.equal(broken.refused?.status, 401, "credentials that are no base64");
  const b64 = Buffer.from(`demo:${PASSWORD}`).toString("base64");
  const bearer = await gate(request("/", { Authorization: `Bearer ${b64}` }), ENV, NOW);
  assert.equal(bearer.refused?.status, 401, "only the Basic scheme");
  const colon = { APP_PASSWORD: "a:b:c" };
  const colons = await gate(request("/", { Authorization: basic("a:b:c") }), colon, NOW);
  assert.ok(colons.cookie, "a password with colons: all after the first colon counts");
  // A wrong password whose SHA-256 ends with the same byte: a compare of one byte would take it.
  const last = (text) => createHash("sha256").update(text).digest().at(-1);
  let twin = 0;
  while (last(PASSWORD + twin) !== last(PASSWORD)) twin += 1;
  const near = await gate(request("/", { Authorization: basic(PASSWORD + twin) }), ENV, NOW);
  assert.equal(near.refused?.status, 401, "every byte of the digest counts");
  console.log("ok  without the secret nothing passes, and a wrong password fails");
}

// ── Only a navigation or a request without fetch metadata gets the Basic challenge ──
{
  const challenge = async (headers) =>
    (await gate(request("/", headers), ENV, NOW)).refused.headers.get("WWW-Authenticate");
  const BASIC = 'Basic realm="Zigs preview", charset="UTF-8"';
  assert.equal(await challenge(NAV), BASIC, "a navigation");
  assert.equal(await challenge({ "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "document" }),
    BASIC, "a document");
  assert.equal(await challenge({}), BASIC, "no fetch metadata: curl, a tool, an old browser");
  assert.equal(await challenge({ "Sec-Fetch-Mode": "cors" }), BASIC,
    "Node fetch: a mode but no Sec-Fetch-Dest, as demo-check sends it");
  assert.equal(await challenge({ "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "iframe" }),
    BASIC, "a navigation of a frame");
  const quiet = [SOCKET, { "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty" },
    { "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "image" },
    { "Sec-Fetch-Mode": "same-origin", "Sec-Fetch-Dest": "worker" }];
  for (const headers of quiet) {
    assert.equal(await challenge(headers), null, JSON.stringify(headers));
  }
  const plain = (await gate(request("/ws", SOCKET), ENV, NOW)).refused;
  assert.equal(plain.status, 401);
  assert.match(await plain.text(), /needs a password/);
  console.log("ok  a navigation or a tool gets the Basic challenge; a background request does not");
}

// ── The cookie goes on the response, but not on a WebSocket upgrade ──
{
  const res = withCookie(new Response("page", { headers: { "X-A": "1" } }), "c=1");
  assert.equal(res.headers.get("Set-Cookie"), "c=1");
  assert.equal(res.headers.get("X-A"), "1");
  assert.equal(await res.text(), "page");
  const frozen = await fetch("data:text/plain,asset");
  assert.equal(withCookie(frozen, "c=1").headers.get("Set-Cookie"), "c=1", "immutable headers");
  const upgrade = { status: 101, webSocket: {} };
  assert.equal(withCookie(upgrade, "c=1"), upgrade, "a 101 passes as it is");
  const none = new Response("x");
  assert.equal(withCookie(none, undefined), none);
  console.log("ok  the response carries the cookie; a WebSocket upgrade passes unchanged");
}
// ── The real handler sets the cookie, takes it alone, and prompts no background request ──
{
  const assets = { fetch: async () => new Response("asset body") };
  const env = { ...ENV, ASSETS: assets };
  const call = (headers) => worker.fetch(request("/app.js", headers), env);
  const first = await call({ Authorization: basic(PASSWORD) });
  assert.equal(first.status, 200);
  const cookie = first.headers.get("Set-Cookie");
  const attributes = "; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Strict";
  assert.ok(cookie.startsWith(`${COOKIE}=`) && cookie.endsWith(attributes), cookie);
  assert.equal(await first.text(), "asset body");
  const again = await call({ Cookie: cookie.split(";")[0], ...SOCKET });
  assert.deepEqual([again.status, again.headers.get("Set-Cookie")], [200, null]);
  const quiet = await call(SOCKET);
  assert.deepEqual([quiet.status, quiet.headers.get("WWW-Authenticate")], [401, null]);
  console.log("ok  the real handler sets the cookie, takes it alone, and prompts no socket");
}
console.log("gate: ok");
