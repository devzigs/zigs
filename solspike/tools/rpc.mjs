// The Helius Devnet RPC for the Node tools (fund, verify-chain). The URL is read from its file
// here, inside this module, and goes to redact() at once. Every error text that leaves this
// module goes through redact() too. The kit comes from the Zolana checkout through the symlink
// solspike/tools/node_modules. The key of the app accepts only calls with the origin of the app.
import { readFileSync } from "node:fs";
import { redact } from "../harness/redact.mjs";
import { heliusFile } from "./paths.mjs";

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
export const APP_ORIGIN = "https://app.zigs.app";

/** The text of a file. */
export const readText = (file) => readFileSync(file, "utf8").trim();

let url = null;
function heliusUrl() {
  if (url === null) {
    url = readText(heliusFile());
    redact.add(url);
  }
  return url;
}

/** One JSON-RPC call. It returns the result and throws a redacted error. */
export async function rpcCall(method, params = []) {
  try {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
    const headers = { "content-type": "application/json", origin: APP_ORIGIN };
    const res = await fetch(heliusUrl(), { method: "POST", headers, body });
    const reply = await res.json();
    if (reply.error) throw new Error(`${method}: ${reply.error.message}`);
    return reply.result;
  } catch (err) {
    throw new Error(redact(String(err?.message ?? err)));
  }
}

/** The balance of an address in lamports (a bigint). */
export const balanceOf = async (account) =>
  BigInt((await rpcCall("getBalance", [account, { commitment: "confirmed" }])).value);
