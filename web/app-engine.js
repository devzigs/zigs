// The WebAssembly engine, and the worker for slow engine calls.
import { slowCall } from "./util.js";
import { showBanner } from "./app-state.js";
import { react, render } from "./app-loop.js";

export let Z = null, engineSettled = false;   // settled: the engine loaded or failed
export function setZ(m) { Z = m; }
const engineDot = document.getElementById("engine-dot");
const engineText = document.getElementById("engine-text");
function setEngine(state, text) { engineDot.className = "dot " + state; engineText.textContent = text; }

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
