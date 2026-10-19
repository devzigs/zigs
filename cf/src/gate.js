// The https redirect and the password gate of the preview: one shared password (secret
// APP_PASSWORD) for every request, any user name, until launch. Without the secret the gate
// refuses everything, so a missing secret never opens it.
//
// iOS Safari sends no cached Basic password on the group WebSocket and on some other requests.
// So a valid password also gets a session cookie, which those requests carry, and only a
// navigation gets the Basic challenge: a background request can never pop a password prompt.

export const COOKIE = "zigs_session";
export const MAX_AGE_S = 7 * 24 * 3600;
const LABEL = "zigs session cookie v1";
const VALUE = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/;
const enc = new TextEncoder();

const hmacKey = (raw, uses) =>
  crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, uses);

/** The key of the cookies: HMAC-SHA256 of a label under the password. A new password ends them. */
async function cookieKey(password) {
  const base = await hmacKey(enc.encode(password), ["sign"]);
  return hmacKey(await crypto.subtle.sign("HMAC", base, enc.encode(LABEL)), ["sign", "verify"]);
}

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (text) =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/") + "="), (c) => c.charCodeAt(0));

/** True when two texts are equal. It compares their SHA-256 digests in constant time. */
async function sameText(a, b) {
  const digest = (t) => crypto.subtle.digest("SHA-256", enc.encode(t));
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  const [u, v] = [new Uint8Array(x), new Uint8Array(y)];
  let diff = 0;
  for (let i = 0; i < u.length; i += 1) diff |= u[i] ^ v[i];
  return diff === 0;
}

/** True when the request carries the password as Basic credentials. */
async function basicOk(req, password) {
  const [scheme, b64] = (req.headers.get("Authorization") || "").split(" ");
  if (scheme !== "Basic" || !b64) return false;
  let pass;
  try {
    pass = atob(b64).split(":").slice(1).join(":");
  } catch {
    return false;
  }
  return sameText(pass, password);
}

// A cookie of the same name from another place (a sibling host) can come first in the header, so
// every value counts. A few are enough: a request with many is no session of ours.
const MAX_VALUES = 4;

/** The values of cookie `name` in the Cookie header, in order, at most MAX_VALUES. */
function cookiesOf(req, name) {
  const values = [];
  for (const part of (req.headers.get("Cookie") || "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) values.push(part.slice(at + 1).trim());
  }
  return values.slice(0, MAX_VALUES);
}

/** True when `value` is an unexpired session cookie that `key` signed. */
async function signedValue(value, key, now) {
  const [, expiry, mac] = VALUE.exec(value) ?? [];
  if (!expiry || Number(expiry) * 1000 <= now) return false;
  return crypto.subtle.verify("HMAC", key, fromB64url(mac), enc.encode(expiry));
}

/** True when the request carries a session cookie that the key of `password` signed. */
async function cookieOk(req, password, now) {
  const values = cookiesOf(req, COOKIE);
  if (values.length === 0) return false;
  const key = await cookieKey(password);
  const checks = await Promise.all(values.map((value) => signedValue(value, key, now)));
  return checks.includes(true);
}

// The hosts of the local dev server. Safari drops a Secure cookie on http://localhost.
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The Set-Cookie value of a new session: an expiry and its HMAC, never the password. It is Secure
 * on every host but the local dev server.
 */
export async function sessionCookie(req, password, now = Date.now()) {
  const expiry = String(Math.floor(now / 1000) + MAX_AGE_S);
  const mac = await crypto.subtle.sign("HMAC", await cookieKey(password), enc.encode(expiry));
  const secure = LOCAL.has(new URL(req.url).hostname) ? "" : "; Secure";
  return `${COOKIE}=${expiry}.${b64url(mac)}; Max-Age=${MAX_AGE_S}; Path=/; HttpOnly${secure}` +
    "; SameSite=Strict";
}

/**
 * Only a background request of a browser gets a plain 401: one with a Sec-Fetch-Dest other than
 * document, and no navigation. A browser that sends fetch metadata sends Sec-Fetch-Dest on every
 * request. A request without it (curl, Node fetch, an old browser) gets the Basic challenge.
 */
function challenges(req) {
  const dest = req.headers.get("Sec-Fetch-Dest");
  return dest === null || dest === "document" || req.headers.get("Sec-Fetch-Mode") === "navigate";
}

function refusal(req) {
  const text = "Zigs is not open yet. This preview needs a password.\n"
    + "Read about Zigs and get early access at https://zigs.app\n";
  const headers = challenges(req)
    ? { "WWW-Authenticate": 'Basic realm="Zigs preview", charset="UTF-8"' }
    : {};
  return new Response(text, { status: 401, headers });
}

function httpsRedirect(req) {
  // The scheme comes from the edge headers: local dev also sees http URLs.
  const http = (req.headers.get("cf-visitor") || "").includes('"http"')
    || req.headers.get("x-forwarded-proto") === "http";
  if (!http) return null;
  const to = new URL(req.url);
  to.protocol = "https:";
  return Response.redirect(to.toString(), 301);
}

/**
 * The gate of one request: { refused } is the Response to send, else the request goes on, and
 * { cookie } is a Set-Cookie value for its response. The https redirect comes first, so a
 * password never travels over plain http. The secret is checked before any cookie: without it
 * the key of the cookies would be public.
 */
export async function gate(req, env, now = Date.now()) {
  const redirect = httpsRedirect(req);
  if (redirect) return { refused: redirect };
  if (env.DEV_NO_AUTH === "1") return {};
  const password = env.APP_PASSWORD;
  if (!password) return { refused: refusal(req) };
  if (await cookieOk(req, password, now)) return {};
  if (await basicOk(req, password)) return { cookie: await sessionCookie(req, password, now) };
  return { refused: refusal(req) };
}

/** The response with the session cookie set. A WebSocket upgrade (101) passes as it is. */
export function withCookie(res, cookie) {
  if (!cookie || res.status === 101 || res.webSocket) return res;
  const out = new Response(res.body, res);
  out.headers.append("Set-Cookie", cookie);
  return out;
}
