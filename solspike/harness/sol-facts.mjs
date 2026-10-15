// Facts from the CDP records of a live Solana check (P8c). Pure functions: they read the records
// of a page (page.records) and return plain values. URLs are cut to host and path, so a query
// (which holds the Helius key) never appears in a result.
import { ORIGIN } from "./server.mjs";

const SELF = new URL(ORIGIN).host;
const HELIUS = "devnet.helius-rpc.com";

export const hostOf = (url) => new URL(url).host;
export const pathOf = (url) => new URL(url).pathname;
const isHttp = (url) => /^https?:/.test(url);
const byId = (records, kind) =>
  new Map(records.filter((r) => r.kind === kind).map((r) => [r.id, r]));

/** Every request that a page or Worker session made: { who, method, host, path, type, blocked }. */
export function requests(records) {
  const failed = byId(records, "failed");
  return records
    .filter((r) => r.kind === "request" && isHttp(r.url))
    .map((r) => ({
      who: r.who,
      method: r.method,
      host: hostOf(r.url),
      path: pathOf(r.url),
      type: r.type,
      blocked: failed.get(r.id)?.blocked ?? null,
    }));
}

/** Count of requests per "who METHOD host/path", for the record of a check. */
export function countCalls(list) {
  const counts = {};
  for (const r of list) {
    const key = `${r.who} ${r.method} ${r.host}${r.path}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** Requests of one session (by who label) to hosts other than the app itself. */
export const outbound = (list, who) => list.filter((r) => r.who === who && r.host !== SELF);

/** The CSP events of a page, with the control windows cut out: product events are the rest. */
export function cspEvents(records, windows = []) {
  const events = records
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.kind === "csp")
    .map(({ r, i }) => ({
      i,
      who: r.who,
      directive: r.directive,
      blocked: r.blocked,
      source: pathOf(r.source || "http://x/"),
    }));
  const inControl = ({ i }) => windows.some((w) => i >= w.from && i < w.to);
  return { product: events.filter((e) => !inControl(e)), control: events.filter(inControl) };
}

/** The responses for a URL path: { status, mime, headers }. */
export function responses(records, path) {
  return records
    .filter((r) => r.kind === "response" && pathOf(r.url) === path)
    .map((r) => ({ status: r.status, mime: r.mime, type: r.type, headers: r.headers }));
}

/** The answers to CORS preflights, per host and path. */
export function preflights(records) {
  return records
    .filter((r) => r.kind === "response" && r.type === "Preflight")
    .map((r) => ({
      host: hostOf(r.url),
      path: pathOf(r.url),
      status: r.status,
      headers: Object.fromEntries(
        Object.entries(r.headers ?? {}).filter(
          ([k]) => k.startsWith("access-control") || k === "vary",
        ),
      ),
    }));
}

/** Transfer bytes of the requests that match, with the content encodings that were used. */
export function transfer(records, match) {
  const done = byId(records, "finished");
  const responded = byId(records, "response");
  const mine = records.filter((r) => r.kind === "request" && isHttp(r.url) && match(r));
  const files = mine.map((r) => ({
    host: hostOf(r.url),
    path: pathOf(r.url),
    bytes: done.get(r.id)?.bytes ?? 0,
    encoding: responded.get(r.id)?.headers?.["content-encoding"] ?? "identity",
  }));
  return { bytes: files.reduce((sum, f) => sum + f.bytes, 0), files };
}

export const isSolana = (r) => pathOf(r.url).startsWith("/sol/") || hostOf(r.url) === HELIUS;
export const isHelius = (r) => hostOf(r.url) === HELIUS;

/**
 * True when the CSP stopped a request to this host inside a window of records. Chrome blocks a
 * fetch before the network stack, so the proof is a connect-src event for the host and no request
 * record for it in the window (the browser sent nothing).
 */
export function cspBlocked(records, window, host) {
  const part = records.slice(window.from, window.to);
  const event = part.some(
    (r) => r.kind === "csp" && r.directive === "connect-src" && r.blocked.includes(`//${host}`),
  );
  const sent = part.some((r) => r.kind === "request" && isHttp(r.url) && hostOf(r.url) === host);
  return event && !sent;
}

/**
 * Console errors, warnings and exceptions of a page and its Workers, outside the windows of the
 * harness controls (a control is meant to fail). Each is { who, level, text } with the text cut.
 */
export function consoleProblems(records, windows = []) {
  const inControl = (i) => windows.some((w) => i >= w.from && i < w.to);
  return records
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => ["console", "log", "exception"].includes(r.kind))
    .filter(({ r }) => r.kind === "exception" || ["error", "warning"].includes(r.level))
    .filter(({ i }) => !inControl(i))
    .map(({ r }) => ({
      who: r.who,
      level: r.level ?? "exception",
      text: (r.text ?? "").slice(0, 160),
    }));
}

export const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
