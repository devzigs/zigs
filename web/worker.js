// Runs the slow engine steps off the main thread so the page stays responsive: the Halo2 proof
// and full transaction verification (about a minute), and the Argon2id of a backup.
import init, * as Z from "./pkg/zigs_engine.js";
import { slowCall } from "./util.js";

const ready = init();

self.onmessage = async (ev) => {
  const { id, method, args } = ev.data;
  const text = (e) => String(e && e.message ? e.message : e);
  try {
    await ready;
  } catch (e) {
    // The engine did not load here. The page can still run the step on its own thread.
    self.postMessage({ id, ok: false, startFailed: true, error: text(e) });
    return;
  }
  try {
    self.postMessage({ id, ok: true, out: slowCall(Z, method, args) });
  } catch (e) {
    self.postMessage({ id, ok: false, error: text(e) });
  }
};
