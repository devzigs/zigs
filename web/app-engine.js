// The WebAssembly engine, and the worker for slow engine calls.
import { slowCall } from "./util.js";
import { showBanner } from "./app-state.js";
import { react, render } from "./app-loop.js";

export let Z = null, engineSettled = false;   // settled: the engine loaded or failed
export function setZ(m) { Z = m; }
const engineDot = document.getElementById("engine-dot");
const engineText = document.getElementById("engine-text");
function setEngine(state, text) { engineDot.className = "dot " + state; engineText.textContent = text; }

// The link to the group server (the "link" of web/shim.js) gets a line under the engine line
// while it is not open. An open link shows nothing, so the line never hides the engine line on a
// phone (app.css hides the side foot when it holds an ok dot).
const LINK_WHY = { 0: "no network", 401: "the preview password is missing or wrong",
  429: "too many connections from this network" };
const linkWhy = (code) => LINK_WHY[code] ?? (code >= 500 ? "the server has a problem" : null);
// What the line shows: { show, dot, text, wait }. The wait counts down and is not read out.
export function linkView(s, now) {
  if (s.state === "idle" || s.state === "open") return { show: false, dot: "", text: "", wait: "" };
  if (s.state === "connecting") {
    return { show: true, dot: "busy", text: "Connecting to the group server…", wait: "" };
  }
  const why = linkWhy(s.code), left = Math.ceil((s.retryAt - now) / 1000);
  return { show: true, dot: "bad",
    text: "The group server does not answer" + (why ? " (" + why + ")" : "") + ".",
    wait: left > 0 ? " Next try in " + left + " s." : " Trying again now." };
}
let linkNow = null, linkTick = 0;
function showLink(s) {
  linkNow = s;
  const line = document.getElementById("link") ?? addLinkLine();
  if (!line) return;
  const v = linkView(s, Date.now());
  // Through the CSSOM: .engine sets display, which the hidden attribute does not beat.
  line.style.display = v.show ? "" : "none";
  const [dot, text, wait] = line.children;
  dot.className = "dot " + v.dot;
  if (text.textContent !== v.text) text.textContent = v.text;
  wait.textContent = v.wait;
  // The wait counts down while the state is "retrying", on the second marks of retryAt.
  if (s.state === "retrying" && !linkTick) {
    const next = (s.retryAt - Date.now()) % 1000;
    linkTick = setTimeout(() => { linkTick = 0; showLink(linkNow); }, next > 0 ? next : 1000);
  }
}
function addLinkLine() {
  const engine = document.getElementById("engine");
  if (!engine) return null;
  const line = document.createElement("div");
  line.className = "engine";
  line.id = "link";
  line.setAttribute("role", "status");
  const wait = document.createElement("span");
  wait.setAttribute("aria-hidden", "true");
  line.append(document.createElement("span"), document.createElement("span"), wait);
  engine.after(line);
  return line;
}
if (typeof zigs !== "undefined") zigs.use("link").then((link) => link?.watch(showLink));

export async function loadEngine() {
  try {
    const mod = await import("./pkg/zigs_engine.js");
    await mod.default();
    Z = mod;
    setEngine("ok", "Crypto engine ready (WebAssembly)");
  } catch (e) {
    setEngine("bad", "Crypto engine failed to load");
    // Tor Browser's Safer and Safest levels turn WebAssembly off.
    const why = typeof WebAssembly === "undefined"
      ? "This browser blocks WebAssembly, which Zigs needs for its cryptography. "
        + "In Tor Browser, set the security level to Standard, then reload."
      : "The WebAssembly engine did not load: " + (e && e.message ? e.message : e)
        + ". Try a current Chrome, Edge, Firefox or Safari.";
    showBanner("bad", why);
  }
  engineSettled = true;
  render(); react();
}

// Slow steps (the proof, the Argon2id of a backup) run in a worker. Without a worker they run on
// the main thread, and the page freezes while the step runs, after the busy text has been drawn.
// A backup is the way back to a lost key share, so it also retries there when the worker fails
// to start. The proof does not: it would freeze the page for a minute.
let worker = null, workerSeq = 0; const workerWait = new Map();
const workerFailed = (why) =>
  Object.assign(new Error("worker failed: " + why), { workerFailed: true });
const onMainThread = (method, args) => new Promise((res, rej) => setTimeout(() => {
  try { res(slowCall(Z, method, args)); } catch (e) { rej(e); }
}, 50));
function startInWorker(method, args) {
  if (!worker) {
    worker = new Worker(new URL("./worker.js", location.href), { type: "module" });
    worker.onmessage = (ev) => {
      const w = workerWait.get(ev.data.id);
      if (!w) return;
      workerWait.delete(ev.data.id);
      if (ev.data.ok) w.res(ev.data.out);
      else w.rej(ev.data.startFailed ? workerFailed(ev.data.error) : new Error(ev.data.error));
    };
    worker.onerror = (ev) => {
      for (const w of workerWait.values()) w.rej(workerFailed(ev.message || "unknown"));
      workerWait.clear();
      worker = null;
    };
  }
  const id = ++workerSeq;
  return new Promise((res, rej) => {
    workerWait.set(id, { res, rej });
    worker.postMessage({ id, method, args });
  });
}
export function engineOffThread(method, ...args) {
  let run;
  try { run = startInWorker(method, args); } catch { return onMainThread(method, args); }
  if (method === "finalize") return run;
  return run.catch((e) => { if (e && e.workerFailed) return onMainThread(method, args); throw e; });
}
