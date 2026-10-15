// Read-only probe of the CORS answers of the Helius Devnet host (P8c). It sends OPTIONS preflights
// only, with the Origin of the local app, to the paths that the Worker calls. It sends no body and
// no transaction. The URL is read from a file inside this script. Only status codes and the
// Access-Control headers are printed, never the URL or its key.
// Usage: node solspike/tools/cors_probe.mjs [URL_FILE]   (writes logs/cors-probe.json)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { redact } from "../harness/redact.mjs";
import { heliusFile } from "./paths.mjs";

const FILE = process.argv[2] ?? heliusFile();
const ORIGINS = ["http://localhost:8795", "http://127.0.0.1:8795"];
// [name, path, keyed]: the prover paths take no key (ZOLANA.md 6.4), the others do.
const PATHS = [
  ["rpc", "/", true],
  ["indexer", "/v1/zolana/getShieldedTransactionsByTags", true],
  ["prove", "/v1/zolana/prove", false],
  ["prove-status", "/v1/zolana/prove/status", false],
];
const SHOWN = [
  "access-control-allow-origin",
  "access-control-allow-methods",
  "access-control-allow-headers",
  "access-control-allow-credentials",
  "access-control-max-age",
  "vary",
];

async function preflight(base, [name, path, keyed], origin) {
  const url = `${base.origin}${path}${keyed ? base.search : ""}`;
  const headers = {
    origin,
    "access-control-request-method": "POST",
    "access-control-request-headers": "content-type",
  };
  const res = await fetch(url, { method: "OPTIONS", headers });
  const answer = Object.fromEntries(SHOWN.map((h) => [h, res.headers.get(h)]));
  return { name, path, origin, status: res.status, ...answer };
}

async function main() {
  const base = new URL(readFileSync(FILE, "utf8").trim());
  const out = [];
  for (const origin of ORIGINS) {
    for (const spec of PATHS) out.push(await preflight(base, spec, origin));
  }
  mkdirSync(join(HERE, "../logs"), { recursive: true });
  writeFileSync(join(HERE, "../logs/cors-probe.json"), redact(JSON.stringify(out, null, 1)));
  for (const row of out) console.log(redact(JSON.stringify(row)));
}

main().catch((err) => {
  console.error(redact(String(err?.stack ?? err)));
  process.exitCode = 1;
});
