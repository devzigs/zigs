// Serves web/ and gives it a shared document store: one Durable Object
// (SQLite) that pushes every change to all connected browsers over a WebSocket.
import { DurableObject } from "cloudflare:workers";

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") return env.STORE.get(env.STORE.idFromName("main")).fetch(req);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const page = await env.ASSETS.fetch(new URL("/index.html", url));
      return new HTMLRewriter()
        .on("title", { element: (e) => e.before('<script src="/shim.js"></script>', { html: true }) })
        .transform(page);
    }
    return env.ASSETS.fetch(req);
  },
};

// Limits for a public relay with no accounts. Real documents stay under 50 KB.
const MAX_MESSAGE = 300_000; // characters in one WebSocket message
const MAX_DOC = 256_000; // characters in one stored document
const MAX_PATH = 200;
// ponytail: every client downloads the whole store on connect, so this cap also bounds that
// download. Upgrade path: one Durable Object per group.
const MAX_TOTAL = 100_000_000;
const WRITES_PER_MIN = 300; // per client IP
const CHARS_PER_MIN = 8_000_000; // per client IP

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
    if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ ip: req.headers.get("CF-Connecting-IP") || "local" });
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
      this.limitRate(ws.deserializeAttachment()?.ip || "local", size);
      ws.send(JSON.stringify({ type: "reply", rid, ok: true, result: this.apply(m) }));
    } catch (e) {
      ws.send(JSON.stringify({ type: "reply", rid, ok: false, code: e.code || "internal", message: String(e.message || e) }));
    }
  }

  // ponytail: counters live in memory per IP and reset when the object is evicted.
  limitRate(ip, size) {
    const now = Date.now();
    if (this.rates.size > 10_000) this.rates.clear();
    let r = this.rates.get(ip);
    if (!r || now - r.start > 60_000) this.rates.set(ip, (r = { start: now, writes: 0, chars: 0 }));
    r.writes += 1;
    r.chars += size;
    if (r.writes > WRITES_PER_MIN || r.chars > CHARS_PER_MIN) {
      throw fail("resource_exhausted", "Too many changes from this network. Wait a minute, then try again.");
    }
  }

  apply(m) {
    const path = String(m.path || "");
    const validPath = path.startsWith("groups/") && path.length <= MAX_PATH && path.split("/").length % 2 === 0;
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
