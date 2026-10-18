// One headless Chrome with in-memory browser contexts. Every page and Worker event becomes a
// redacted record in logs/<label>.jsonl and in page.records. Nothing logs the parameters of a CDP
// command. Pages open only in a context, never in the default one. A JavaScript dialog is
// recorded and accepted (page.acceptDialogs = false dismisses it), so a confirm() cannot hang.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, failWith, launch, shutdown } from "./chrome.mjs";
import { redact } from "./redact.mjs";

const LOGS = join(dirname(fileURLToPath(import.meta.url)), "../logs");
const BINDING = "__zsReport";
// CDP injects this listener, so the page policy cannot block it. It runs in pages and Workers.
const CSP_HOOK = `self.addEventListener("securitypolicyviolation", (e) => {
  self.${BINDING}(JSON.stringify({ directive: e.effectiveDirective, blocked: e.blockedURI,
    source: e.sourceFile, line: e.lineNumber, disposition: e.disposition }));
}, true);`;
const PAGE_TYPES = new Set(["page", "iframe"]);
// The page hides its engine line on a narrow window, so every page gets a desktop size.
const VIEWPORT = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };

// The response headers that the checks read. The rest never reaches a log.
const HEADERS = [
  "content-type",
  "content-encoding",
  "content-length",
  "content-security-policy",
  "referrer-policy",
  "x-content-type-options",
  "access-control-allow-origin",
  "access-control-allow-headers",
  "access-control-allow-methods",
  "access-control-allow-credentials",
  "access-control-max-age",
  "vary",
];
const pickHeaders = (all = {}) => {
  const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), v]));
  return Object.fromEntries(HEADERS.filter((h) => h in lower).map((h) => [h, lower[h]]));
};

const argText = (a) => (a.value !== undefined ? String(a.value) : (a.description ?? a.type));
const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: String(text).slice(0, 200) };
  }
};

const RECORDERS = {
  "Runtime.consoleAPICalled": (p) => ({
    kind: "console",
    level: p.type,
    text: p.args.map(argText).join(" "),
  }),
  "Runtime.exceptionThrown": (p) => ({
    kind: "exception",
    text: p.exceptionDetails.exception?.description ?? p.exceptionDetails.text,
    url: p.exceptionDetails.url,
  }),
  "Log.entryAdded": (p) => ({
    kind: "log",
    level: p.entry.level,
    source: p.entry.source,
    text: p.entry.text,
    url: p.entry.url,
  }),
  "Network.requestWillBeSent": (p) => ({
    kind: "request",
    id: p.requestId,
    url: p.request.url,
    method: p.request.method,
    type: p.type,
    initiator: p.initiator?.type ?? null,
  }),
  "Network.responseReceived": (p) => ({
    kind: "response",
    id: p.requestId,
    url: p.response.url,
    status: p.response.status,
    mime: p.response.mimeType,
    type: p.type,
    headers: pickHeaders(p.response.headers),
  }),
  // The headers as they came on the wire, also when CORS keeps the response from the page.
  "Network.responseReceivedExtraInfo": (p) => ({
    kind: "response-extra",
    id: p.requestId,
    status: p.statusCode,
    headers: pickHeaders(p.headers),
  }),
  "Network.loadingFinished": (p) => ({
    kind: "finished",
    id: p.requestId,
    bytes: p.encodedDataLength,
  }),
  "Network.loadingFailed": (p) => ({
    kind: "failed",
    id: p.requestId,
    error: p.errorText,
    blocked: p.blockedReason ?? null,
    cors: p.corsErrorStatus?.corsError ?? null,
  }),
  "Network.webSocketCreated": (p) => ({ kind: "websocket", url: p.url }),
  "Runtime.bindingCalled": (p) =>
    p.name === BINDING ? { kind: "csp", ...parse(p.payload) } : null,
  "Page.javascriptDialogOpening": (p) => ({ kind: "dialog", type: p.type, text: p.message }),
};

function emit(state, sessionId, rec) {
  const info = state.sessions.get(sessionId);
  const full = { t: Date.now(), ctx: info?.page.ctx ?? "-", who: info?.who ?? "browser", ...rec };
  const line = redact(JSON.stringify(full));
  appendFileSync(state.logPath, `${line}\n`);
  (info?.page.records ?? state.loose).push(JSON.parse(line));
}

const targetName = (t) => {
  try {
    return `${t.type}:${new URL(t.url).pathname}`;
  } catch {
    return t.type;
  }
};

async function instrument(state, sessionId, type) {
  const send = (method, params) => state.cdp.send(method, params, sessionId);
  for (const d of ["Runtime", "Log", "Network", ...(PAGE_TYPES.has(type) ? ["Page"] : [])]) {
    await send(`${d}.enable`);
  }
  await send("Runtime.addBinding", { name: BINDING });
  if (!PAGE_TYPES.has(type)) await send("Runtime.evaluate", { expression: CSP_HOOK });
}

/** A Worker or frame under a page starts paused: instrument it, then let it run. */
async function attachChild(state, m) {
  const { sessionId, targetInfo } = m.params;
  const parent = state.sessions.get(m.sessionId);
  if (!parent) return;
  state.sessions.set(sessionId, { who: targetName(targetInfo), page: parent.page });
  emit(state, sessionId, { kind: "attached", type: targetInfo.type });
  try {
    await instrument(state, sessionId, targetInfo.type);
    if (parent.page.network) {
      await state.cdp.send("Network.emulateNetworkConditions", parent.page.network, sessionId);
    }
  } catch (err) {
    emit(state, sessionId, { kind: "harness-warning", text: err.message });
  }
  await state.cdp.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch((err) => {
    emit(state, sessionId, { kind: "harness-warning", text: err.message });
  });
}

const SESSION_EVENTS = {
  "Target.attachedToTarget": (state, m) => void attachChild(state, m),
  // The CSP binding is a record. Another binding goes to page.onBinding (harness/mock-chain.mjs).
  "Runtime.bindingCalled": (state, m) => {
    if (m.params.name === BINDING) return record(state, m);
    state.sessions.get(m.sessionId)?.page.onBinding?.(m.params);
  },
  "Target.detachedFromTarget": (state, m) => state.sessions.delete(m.params.sessionId),
  "Page.loadEventFired": (state, m) => {
    const info = state.sessions.get(m.sessionId);
    if (info?.who === "page") info.page.loadWaiters.splice(0).forEach((done) => done());
  },
};

function record(state, m) {
  const info = state.sessions.get(m.sessionId);
  const rec = info && RECORDERS[m.method]?.(m.params);
  if (!rec) return;
  emit(state, m.sessionId, rec);
  if (rec.kind === "dialog") answerDialog(state, m.sessionId, info.page);
}

const onEvent = (state, m) => (SESSION_EVENTS[m.method] ?? record)(state, m);

function answerDialog(state, sessionId, page) {
  const params = { accept: page.acceptDialogs };
  state.cdp.send("Page.handleJavaScriptDialog", params, sessionId).catch((err) => {
    emit(state, sessionId, { kind: "harness-warning", text: err.message });
  });
}

function nextLoad(page, ms = 30000) {
  return new Promise((ok, bad) => {
    const timer = setTimeout(() => bad(new Error("timeout waiting for the page load")), ms);
    page.loadWaiters.push(() => {
      clearTimeout(timer);
      ok();
    });
  });
}

/** The sessions of the Workers that this page started: [{ sessionId, who }]. */
const workersOf = (state, page) =>
  [...state.sessions]
    .filter(([, info]) => info.page === page && info.who !== "page")
    .map(([sessionId, info]) => ({ sessionId, who: info.who }));

/** Throttles the page and its Workers, now and for every Worker that starts later. */
async function emulateNetwork(state, page, conditions) {
  page.network = conditions;
  const ids = [page.sessionId, ...workersOf(state, page).map((w) => w.sessionId)];
  for (const id of ids) await state.cdp.send("Network.emulateNetworkConditions", conditions, id);
}

async function openPage(state, ctx, url) {
  const { cdp } = state;
  const params = { url: "about:blank", browserContextId: ctx.id };
  const { targetId } = await cdp.send("Target.createTarget", params);
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const page = { ctx: ctx.name, ctxId: ctx.id, targetId, sessionId, records: [], loadWaiters: [] };
  page.acceptDialogs = true;
  page.send = (method, args, ms) => cdp.send(method, args, sessionId, ms);
  page.navigate = async (to) => {
    const loaded = nextLoad(page);
    const res = await page.send("Page.navigate", { url: to });
    if (res.errorText) throw new Error(`navigate failed: ${res.errorText}`);
    await loaded;
  };
  page.close = () => cdp.send("Target.closeTarget", { targetId });
  page.workers = () => workersOf(state, page);
  page.sendTo = (id, method, args, ms) => cdp.send(method, args, id, ms);
  page.emulateNetwork = (conditions) => emulateNetwork(state, page, conditions);
  state.sessions.set(sessionId, { who: "page", page });
  await instrument(state, sessionId, "page");
  await page.send("Emulation.setDeviceMetricsOverride", VIEWPORT);
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: CSP_HOOK });
  const auto = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true };
  await page.send("Target.setAutoAttach", auto);
  if (state.pageHook) await state.pageHook(page);
  if (url) await page.navigate(url);
  return page;
}

async function newContext(state, name) {
  const { browserContextId } = await state.cdp.send("Target.createBrowserContext");
  await state.cdp.send("Browser.setDownloadBehavior", { behavior: "deny", browserContextId });
  const ctx = { name, id: browserContextId };
  ctx.open = (url) => openPage(state, ctx, url);
  ctx.dispose = async () => {
    await state.cdp.send("Target.disposeBrowserContext", { browserContextId });
    for (const [sid, info] of state.sessions) {
      if (info.page.ctxId === ctx.id) state.sessions.delete(sid);
    }
  };
  return ctx;
}

/**
 * Starts Chrome and the CDP client. `label` names the log file logs/<label>.jsonl. `waitMs` limits
 * each wait of the start. A Chrome that starts but cannot be driven is stopped before the error
 * goes up: the caller has no rig to close.
 */
export async function startRig(label, waitMs) {
  mkdirSync(LOGS, { recursive: true });
  const logPath = join(LOGS, `${label}.jsonl`);
  writeFileSync(logPath, "");
  const chrome = await launch(waitMs);
  const state = { chrome, logPath, sessions: new Map(), loose: [], cdp: null };
  try {
    state.cdp = await connect(chrome.wsUrl, (m) => onEvent(state, m), waitMs);
  } catch (err) {
    return failWith(chrome, err);
  }
  return {
    chrome,
    logPath,
    records: state.loose,
    contextIds: () => state.cdp.send("Target.getBrowserContexts").then((r) => r.browserContextIds),
    newContext: (name) => newContext(state, name),
    // hook(page) runs on each new page before its first load.
    onPage: (hook) => {
      state.pageHook = hook;
    },
    close: () => shutdown(state.cdp, chrome),
  };
}
