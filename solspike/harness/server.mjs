// Starts and stops the local wrangler dev server of the clone through serve.sh (by PID).
// serve.sh start waits until the server answers. SOLSPIKE_PORT moves the port (default 8795).
// SOLSPIKE_ORIGIN=https://app.zigs.app gives the pages the origin that the Helius key of the app
// accepts: serve.sh then serves https on 127.0.0.1, and Chrome maps the host there (chrome.mjs).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, "../serve.sh");
const PIDFILE = join(HERE, "../.state/serve.pid");
const DEV_VARS = join(HERE, "../../cf/.dev.vars");
export const PORT = Number(process.env.SOLSPIKE_PORT ?? 8795);
export const ORIGIN = process.env.SOLSPIKE_ORIGIN || `http://localhost:${PORT}`;
export const HTTPS = new URL(ORIGIN).protocol === "https:";
/** The self-signed cert of the https server (serve.sh makes it). */
export const CERT = join(HERE, "../.state/tls", new URL(ORIGIN).hostname, "cert.pem");

const serve = (cmd) => execFileSync(SERVE, [cmd], { encoding: "utf8" }).trim();
export const startServer = () => serve("start");
export const stopServer = () => serve("stop");
// The pid file holds the PID of the server. serve.sh checks it before it sends a signal.
export const serverPid = () =>
  existsSync(PIDFILE) ? Number(readFileSync(PIDFILE, "utf8").trim().split(/\s+/)[0]) : null;

/**
 * Sets one variable of cf/.dev.vars (not tracked), or removes it when `value` is null, and keeps
 * the other lines. It returns the old value (null if none), so that a caller can put it back.
 * The server reads the file when it starts.
 */
export function setDevVar(name, value) {
  const lines = existsSync(DEV_VARS) ? readFileSync(DEV_VARS, "utf8").split("\n") : [];
  const mine = (line) => line.startsWith(`${name}=`);
  const old = lines.find(mine)?.slice(name.length + 1) ?? null;
  const kept = lines.filter((line) => line && !mine(line));
  if (value !== null) kept.push(`${name}=${value}`);
  writeFileSync(DEV_VARS, kept.join("\n") + "\n", { mode: 0o600 });
  return old;
}

/**
 * A GET of `path` from the local server, as the page asks it: with the host of ORIGIN, also over
 * https, where the host resolves to the server in Chrome only. Resolves a Response.
 */
export function localGet(path, headers = {}) {
  if (!HTTPS) return fetch(`${ORIGIN}${path}`, { headers });
  const { hostname, host } = new URL(ORIGIN);
  const options = { host: "127.0.0.1", port: PORT, path, servername: hostname, agent: false };
  Object.assign(options, { ca: readFileSync(CERT), headers: { ...headers, host } });
  return new Promise((ok, bad) => {
    const req = request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const list = Object.entries(res.headers).flatMap(([k, v]) => [v].flat().map((x) => [k, x]));
        ok(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: list }));
      });
    });
    req.on("error", bad);
    req.end();
  });
}
