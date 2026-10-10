// Inlines the WASM engine and the worker into one HTML file.
// Usage: node web/bundle.mjs  ->  web/dist/index.html
import fs from "fs";

const dir = new URL("./", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, dir));
const glue = read("pkg/zec_frost_wasm.js").toString();
const wasmB64 = read("pkg/zec_frost_wasm_bg.wasm").toString("base64");
let html = read("index.html").toString();

// The worker gets the glue code plus its handler; WASM bytes arrive by message.
const workerSrc = glue + `
let ready = null;
self.onmessage = async (ev) => {
  const { id, wasm, signedPczt } = ev.data;
  if (wasm) { ready = __wbg_init({ module_or_path: wasm }); return; }
  try {
    await ready;
    const t0 = performance.now();
    const out = JSON.parse(finalize(signedPczt));
    out.ms = Math.round(performance.now() - t0);
    self.postMessage({ id, ok: true, out });
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e && e.message ? e.message : e) });
  }
};`;

const prelude = `
const __glue = ${JSON.stringify(glue)};
const __workerSrc = ${JSON.stringify(workerSrc)};
const __wasmBytes = Uint8Array.from(atob("${wasmB64}"), (c) => c.charCodeAt(0));
const __blobUrl = (src) => URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
`;

function swap(from, to) {
  if (!html.includes(from)) throw new Error("bundle: marker not found in index.html: " + from);
  html = html.replace(from, to);
}
swap('<script type="module">', '<script type="module">' + prelude);
swap('await import("./pkg/zec_frost_wasm.js")', "await import(__blobUrl(__glue))");
swap("await mod.default();", "await mod.default({ module_or_path: __wasmBytes });");
swap('new Worker(new URL("./worker.js", location.href), { type: "module" });',
  'new Worker(__blobUrl(__workerSrc), { type: "module" });\n      worker.postMessage({ wasm: __wasmBytes });');

fs.mkdirSync(new URL("dist/", dir), { recursive: true });
fs.writeFileSync(new URL("dist/index.html", dir), html);
console.log("wrote web/dist/index.html", (html.length / 1e6).toFixed(1) + " MB");
