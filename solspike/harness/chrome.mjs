// Headless Chrome for the Solana spike, driven over CDP. One Chrome with several in-memory
// browser contexts: disposing a context wipes its storage (see rig.mjs). Chrome closes with
// Browser.close. Only our own PID gets a SIGTERM, and only as a last resort.
import { spawn } from "node:child_process";
import { X509Certificate, createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { redact } from "./redact.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME =
  process.env.SOLSPIKE_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// Chrome needs a profile directory of its own. Pages never use it: they run in contexts.
const PROFILE = join(HERE, "../.state/chrome-profile");
// SOLSPIKE_CHROME_PORTS="LOW-HIGH" moves the range: several tracks share this machine.
const PORT_RANGE = process.env.SOLSPIKE_CHROME_PORTS ?? "9350-9369";
const PORTS = (/^(\d+)-(\d+)$/.exec(PORT_RANGE) ?? []).slice(1).map(Number);
if (PORTS.length !== 2) {
  throw new Error(`SOLSPIKE_CHROME_PORTS must be LOW-HIGH, got ${PORT_RANGE}`);
}
const WAIT_MS = 20000;
const KILL_GRACE_MS = 5000;
// One probe of the debugging port. A port that accepts and never answers must not hold a probe.
const PROBE_MS = 2000;
// The cap is 16 live processes for the whole stack (tools/procs.mjs says what counts). Chrome 155
// starts an omnibox popup renderer for each context window, a spare renderer and a GPU process.
// These flags leave the browser, the network and storage processes, and one renderer per context
// page.
const NO_EXTRA_RENDERERS = [
  "SpareRendererForSitePerProcess",
  "ChromeWebUIOmniboxPopup",
  "WebUIOmniboxPopup",
  "OmniboxAimPopup",
  "WebUIOmniboxAimPopup",
].join(",");
const FLAGS = [
  "--headless=new",
  "--no-startup-window",
  "--in-process-gpu",
  `--disable-features=${NO_EXTRA_RENDERERS}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-crash-reporter",
  "--disable-breakpad",
  "--disable-background-networking",
  "--disable-component-update",
  "--use-mock-keychain",
  "--password-store=basic",
];

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * The flags of an https origin: its host maps to the local server, and only the key of the cert of
 * serve.sh is trusted without a CA. SOLSPIKE_HOST_RULES adds rules (the mock run sends the Helius
 * host nowhere). Read at launch, so a module can set it first. server.mjs reads SOLSPIKE_PORT when
 * it loads, so it loads here too: live/zec-pay.mjs sets the port after its own imports.
 */
async function hostFlags() {
  const { CERT, HTTPS, ORIGIN, PORT } = await import("./server.mjs");
  const { hostname } = new URL(ORIGIN);
  const rules = LOCAL_HOSTS.has(hostname) ? [] : [`MAP ${hostname} 127.0.0.1:${PORT}`];
  if (process.env.SOLSPIKE_HOST_RULES) rules.push(process.env.SOLSPIKE_HOST_RULES);
  const flags = rules.length ? [`--host-resolver-rules=${rules.join(", ")}`] : [];
  if (!HTTPS) return flags;
  const key = new X509Certificate(readFileSync(CERT)).publicKey;
  const pin = createHash("sha256").update(key.export({ type: "spki", format: "der" }));
  return [...flags, `--ignore-certificate-errors-spki-list=${pin.digest("base64")}`];
}

export const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Polls fn until it is truthy. `what` is a function that names the wait for the timeout text. */
export async function waitFor(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout waiting for ${what()}`);
    await sleep(100);
  }
}

const portFree = (port) =>
  new Promise((ok) => {
    const probe = net.createServer();
    probe.once("error", () => ok(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => ok(true)));
  });

async function freePort() {
  for (let port = PORTS[0]; port <= PORTS[1]; port += 1) {
    if (await portFree(port)) return port;
  }
  throw new Error(`no free Chrome debugging port in ${PORTS[0]}-${PORTS[1]}`);
}

// The signal ends the whole fetch, also a body that never finishes.
const versionInfo = (port, leftMs) =>
  fetch(`http://127.0.0.1:${port}/json/version`, {
    signal: AbortSignal.timeout(Math.max(1, Math.min(leftMs, PROBE_MS))),
  })
    .then((r) => r.json())
    .catch(() => null);

/**
 * True when `promise` settles within `ms`, false when the time is up first. The timer is cleared
 * when the race ends: a pending timer would keep node alive for its full time.
 */
export async function settlesWithin(promise, ms) {
  let timer;
  const late = new Promise((ok) => {
    timer = setTimeout(ok, ms, false);
  });
  try {
    return await Promise.race([promise.then(() => true), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stops a Chrome that we started: SIGTERM to its PID, then SIGKILL only if it is still alive
 * after the grace time. Returns a short text that tells how it ended.
 */
export async function killChrome(chrome, graceMs = KILL_GRACE_MS) {
  const { proc } = chrome;
  if (proc.exitCode !== null || proc.signalCode !== null) return "had exited";
  proc.kill("SIGTERM");
  if (await settlesWithin(chrome.exited, graceMs)) return "stopped by SIGTERM";
  proc.kill("SIGKILL");
  await chrome.exited;
  return `SIGKILL to own pid after ${graceMs} ms`;
}

/** Stops a Chrome that cannot be used, then throws the error with the way it ended. */
export async function failWith(chrome, err) {
  const how = await killChrome(chrome);
  throw new Error(`${err.message ?? err} (Chrome ${how})`, { cause: err });
}

/** Starts Chrome on a free port of the range. A Chrome that does not answer is stopped. */
export async function launch(waitMs = WAIT_MS) {
  mkdirSync(PROFILE, { recursive: true });
  const port = await freePort();
  const args = [...FLAGS, ...(await hostFlags()), `--remote-debugging-port=${port}`];
  args.push(`--user-data-dir=${PROFILE}`);
  const proc = spawn(CHROME, args, { stdio: "ignore" });
  // A missing binary is a spawn error, not an exit: without a handler it ends node.
  let spawnError = null;
  proc.once("error", (err) => { spawnError = err; });
  const exited = new Promise((ok) => {
    proc.once("exit", ok);
    proc.once("error", ok);
  });
  const chrome = { proc, pid: proc.pid, port, exited };
  const exitedEarly = () => proc.exitCode !== null || proc.signalCode !== null;
  const end = Date.now() + waitMs;
  try {
    const info = await waitFor(
      () => {
        if (spawnError) throw new Error(`Chrome did not start (${CHROME}): ${spawnError.code}`);
        if (exitedEarly()) {
          throw new Error(`Chrome exited with code ${proc.exitCode ?? proc.signalCode}`);
        }
        return versionInfo(port, end - Date.now());
      },
      waitMs,
      () => "the Chrome debugging port",
    );
    return { ...chrome, wsUrl: info.webSocketDebuggerUrl, version: info.Browser };
  } catch (err) {
    return failWith(chrome, err);
  }
}

/** A flat-session CDP client. It never logs the parameters of a command. */
export async function connect(wsUrl, onEvent, waitMs = WAIT_MS) {
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, bad) => {
    const timer = setTimeout(() => {
      bad(new Error(`CDP connection: no answer in ${waitMs} ms`));
      ws.close();
    }, waitMs);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      ok();
    });
    ws.addEventListener("error", (ev) => {
      clearTimeout(timer);
      bad(new Error(`CDP connection failed: ${ev.message ?? ev.type}`));
    });
  });
  const waiting = new Map();
  let id = 0;
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) {
      waiting.get(m.id)(m);
      waiting.delete(m.id);
    } else onEvent(m);
  });
  const send = (method, params = {}, sessionId, ms = 30000) =>
    new Promise((ok, bad) => {
      const n = ++id;
      const timer = setTimeout(() => {
        waiting.delete(n);
        bad(new Error(`${method}: no answer in ${ms} ms`));
      }, ms);
      waiting.set(n, (m) => {
        clearTimeout(timer);
        if (m.error) bad(new Error(redact(`${method}: ${m.error.message}`)));
        else ok(m.result);
      });
      ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  return { send, close: () => ws.close() };
}

/** Closes Chrome with Browser.close, then waits for the process we started. */
export async function shutdown(cdp, chrome) {
  const note = await cdp.send("Browser.close", {}, undefined, 5000).then(
    () => "",
    (err) => ` (Browser.close: ${err.message})`,
  );
  const gone = await settlesWithin(chrome.exited, 10000);
  const how = gone ? "closed by Browser.close" : `${await killChrome(chrome)} after 10 s`;
  cdp.close();
  return `${how}${note}`;
}
