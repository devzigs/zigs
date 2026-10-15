// The scenarios of the mock run: which CSP each response gets. The first six are the P3b
// scenarios. "product" is the real configuration: the page gets policy() of cf/src/index.js as it
// is, and only the Worker scripts get solWorkerPolicy() with the mock origin in place of the
// Helius host: /test-worker.js (the entry of the product Worker in this run, see its header),
// /sol/worker.js and the control Worker, which stands in for a bad Worker. Both functions are
// cut out of cf/src/index.js and run as written.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = readFileSync(join(ROOT, "cf/src/index.js"), "utf8");
const HELIUS = "https://devnet.helius-rpc.com";

const piece = (pattern) => {
  const text = pattern.exec(SOURCE)?.[0];
  if (!text) throw new Error(`cf/src/index.js has no ${pattern}`);
  return text;
};

/** policy(url) of the Zigs page, exactly as written. */
function pagePolicy() {
  const chain = piece(/const CHAIN_SERVERS = [\s\S]*?;\n/);
  const fn = piece(/function policy\(url\) \{[\s\S]*?\n\}\n/);
  return runInNewContext(`${chain}\n${fn}\npolicy`, {}, { timeout: 1000 });
}

/** solWorkerPolicy() as written, with the mock origin in place of the Helius host. */
function workerPolicy(mockOrigin) {
  const host = piece(/const SOL_HOST = [^\n]*\n/);
  const fn = piece(/function solWorkerPolicy\(\) \{[\s\S]*?\n\}\n/);
  if (!host.includes(HELIUS)) throw new Error("SOL_HOST is not the Devnet Helius host");
  const code = `${host.replace(HELIUS, mockOrigin)}\n${fn}\nsolWorkerPolicy`;
  return runInNewContext(code, {}, { timeout: 1000 })();
}

const strict = (mock, { wasmEval = true } = {}) =>
  [
    "default-src 'none'",
    `script-src 'self'${wasmEval ? " 'wasm-unsafe-eval'" : ""}`,
    "worker-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${mock}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "report-uri /csp-report",
  ].join("; ");

const zigs = pagePolicy();
const withMock = (csp, mock) => csp.replace("connect-src 'self'", `connect-src 'self' ${mock}`);

const everywhere = (policy) => ({ page: policy, script: policy, other: policy });

/** Per scenario: the CSP of the page, of a Worker script and of every other response. */
export const SCENARIOS = {
  strict: { ...everywhere((o) => strict(o.mock)), bundle: "min" },
  "strict-unminified": { ...everywhere((o) => strict(o.mock)), bundle: "unmin" },
  "page-only": { page: (o) => strict(o.mock), script: () => null, other: () => null },
  "no-wasm-eval": everywhere((o) => strict(o.mock, { wasmEval: false })),
  zigs: everywhere((o) => zigs(new URL(o.static))),
  "zigs+mock": everywhere((o) => withMock(zigs(new URL(o.static)), o.mock)),
  product: {
    page: (o) => zigs(new URL(o.static)),
    script: (o) => workerPolicy(o.mock),
    other: () => null,
  },
};

const SCRIPTS = new Set(["/sol/worker.js", "/test-worker.js", "/control-worker.js"]);

/** The cspFor function of startServers for one scenario. */
export function cspFor(name) {
  const spec = SCENARIOS[name];
  return (pathname, origins) => {
    if (pathname === "/" || pathname === "/index.html") return spec.page(origins);
    return (SCRIPTS.has(pathname) ? spec.script : spec.other)(origins);
  };
}
