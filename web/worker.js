// Runs the slow step (Halo2 proof + full transaction verification) off the
// main thread so the page stays responsive for about a minute.
import init, { finalize } from "./pkg/zec_frost_wasm.js";

const ready = init();

self.onmessage = async (ev) => {
  const { id, signedPczt } = ev.data;
  try {
    await ready;
    const t0 = performance.now();
    const out = JSON.parse(finalize(signedPczt));
    out.ms = Math.round(performance.now() - t0);
    self.postMessage({ id, ok: true, out });
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e && e.message ? e.message : e) });
  }
};
