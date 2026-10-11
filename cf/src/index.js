// Serves web/ and gives it a shared document store: one Durable Object (SQLite) per group that
// pushes every change of that group to its connected members over a WebSocket.
import { DurableObject } from "cloudflare:workers";

const GROUP_ID = /^[0-9a-f]{20}$/;
// The light-wallet servers in NETWORKS (web/index.html). The page may connect to nothing else.
const CHAIN_SERVERS = ["https://lwd.zigs.app", "https://zcash-testnet.chainsafe.dev",
  "https://zcash-mainnet.chainsafe.dev"].join(" ");

// ponytail: 'unsafe-inline' because the app script and styles are inline; a hash would be stricter.
function policy(url) {
  const ws = (url.protocol === "https:" ? "wss://" : "ws://") + url.host;
  return [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    "worker-src 'self'",
    "style-src 'self' 'unsafe-inline'",
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

async function groupSocket(req, env, url) {
  const gid = url.searchParams.get("g") || "";
  if (!GROUP_ID.test(gid)) return new Response("Add ?g= with a group id of 20 hex characters.", { status: 400 });
  const ip = req.headers.get("CF-Connecting-IP") || "local";
  if (env.WS_PER_IP && !(await env.WS_PER_IP.limit({ key: ip })).success) {
    return new Response("Too many connections from this network. Wait a minute.", { status: 429 });
  }
  const fwd = new Request(req);
  fwd.headers.set("X-Group", gid);
  return env.STORE.get(env.STORE.idFromName("g:" + gid)).fetch(fwd);
}

export default {
  async fetch(req, env) {
    if (env.DEV_NO_AUTH !== "1" && !authorized(req, env)) {
      return new Response("Password required", {
        status: 401, headers: { "WWW-Authenticate": 'Basic realm="Zigs", charset="UTF-8"' },
      });
    }
    const url = new URL(req.url);
    if (url.pathname === "/ws") return groupSocket(req, env, url);
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
    return env.ASSETS.fetch(req);
  },
};

// Limits for a public relay with no accounts. Real documents stay under 50 KB.
const MAX_MESSAGE = 300_000; // characters in one WebSocket message
const MAX_DOC = 256_000; // characters in one stored document
const MAX_PATH = 200;
// Per group: members download their group's whole store on connect, so this also bounds that.
const MAX_TOTAL = 10_000_000;
const WRITES_PER_MIN = 300; // per client IP
const CHARS_PER_MIN = 8_000_000; // per client IP
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
    const ip = req.headers.get("CF-Connecting-IP") || "local";
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

  // ponytail: counters live in memory per IP and reset when the object is evicted.
  // A blocked IP does not count toward the global cap, so one IP cannot stop everyone.
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
