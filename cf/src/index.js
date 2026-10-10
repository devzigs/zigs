// Serves web/ and gives it a shared document store: one Durable Object
// (SQLite) that pushes every change to all connected browsers over a WebSocket.
import { DurableObject } from "cloudflare:workers";

// One shared password (secret APP_PASSWORD) for every request, any user name.
function authorized(req, env) {
  const [scheme, b64] = (req.headers.get("Authorization") || "").split(" ");
  if (scheme !== "Basic" || !b64) return false;
  let pass;
  try { pass = atob(b64).split(":").slice(1).join(":"); } catch { return false; }
  const enc = new TextEncoder();
  const a = enc.encode(pass), b = enc.encode(env.APP_PASSWORD);
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}

export default {
  async fetch(req, env) {
    if (env.DEV_NO_AUTH === "1") return route(req, env);
    if (!env.APP_PASSWORD) return new Response("APP_PASSWORD is not set. Run: npx wrangler secret put APP_PASSWORD", { status: 500 });
    if (!authorized(req, env)) {
      return new Response("Password required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="zec-frost", charset="UTF-8"' } });
    }
    return route(req, env);
  },
};

async function route(req, env) {
  const url = new URL(req.url);
  if (url.pathname === "/ws") return env.STORE.get(env.STORE.idFromName("main")).fetch(req);
  if (url.pathname === "/" || url.pathname === "/index.html") {
    const page = await env.ASSETS.fetch(new URL("/index.html", url));
    return new HTMLRewriter()
      .on("title", { element: (e) => e.before('<script src="/shim.js"></script>', { html: true }) })
      .transform(page);
  }
  return env.ASSETS.fetch(req);
}

export class Store extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, data TEXT NOT NULL)");
    this.leases = new Map();
  }

  async fetch(req) {
    if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const docs = this.sql.exec("SELECT path, data FROM docs").toArray()
      .map((r) => ({ path: r.path, data: JSON.parse(r.data) }));
    server.send(JSON.stringify({ type: "init", docs }));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, raw) {
    const m = JSON.parse(raw);
    try {
      ws.send(JSON.stringify({ type: "reply", rid: m.rid, ok: true, result: this.apply(m) }));
    } catch (e) {
      ws.send(JSON.stringify({ type: "reply", rid: m.rid, ok: false, code: e.code || "internal", message: String(e.message || e) }));
    }
  }

  apply(m) {
    const path = String(m.path || "");
    if (!path || path.split("/").length % 2) throw Object.assign(new Error("bad doc path: " + path), { code: "invalid_argument" });
    if (m.op === "acquire") return this.acquire(path, m.holder, m.ttlMs);
    if (m.op === "delete") {
      this.sql.exec("DELETE FROM docs WHERE path = ?", path);
      return this.broadcast({ type: "put", path, data: null });
    }
    let data = m.data;
    if (m.op === "update") {
      const row = this.sql.exec("SELECT data FROM docs WHERE path = ?", path).toArray()[0];
      if (!row) throw Object.assign(new Error("no document at " + path), { code: "not_found" });
      data = { ...JSON.parse(row.data), ...m.data };
    } else if (m.op !== "set") {
      throw Object.assign(new Error("unknown op " + m.op), { code: "invalid_argument" });
    }
    this.sql.exec("INSERT OR REPLACE INTO docs (path, data) VALUES (?, ?)", path, JSON.stringify(data));
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
