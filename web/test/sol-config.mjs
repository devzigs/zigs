// Where the page gets the Helius URL (cf/src/index.js serves /sol/config.json). fetchRpcUrl takes
// the URL from the server answer only, keeps nothing in storage, says "not available" for a 503 or
// a 404, and asks to check the connection for every other failure. When the server gives no
// URL, the page loads nothing of Solana, says so once, and does not ask again at the next redraw.
// Run: node web/test/sol-config.mjs   (Node 24)
import assert from "node:assert/strict";
import { NOT_LOADED, UNAVAILABLE, fetchRpcUrl } from "../sol/session.js";
import { config, loadRig, sleep, storage } from "./sol-rig.mjs";

const KEY_NAME = "api-key";

const URL_OK = `https://devnet.helius-rpc.com/?${KEY_NAME}=not-a-real-key`;
const asked = [];
const answering = (make) => async (url, init) => {
  asked.push([String(url), init]);
  return make();
};
const withFetch = async (make, body) => {
  const real = globalThis.fetch;
  globalThis.fetch = answering(make);
  try {
    return await body();
  } finally {
    globalThis.fetch = real;
  }
};
const json = (value, status = 200) => () => Response.json(value, { status });

// ── fetchRpcUrl ──
{
  const before = storage.size;
  const url = await withFetch(json({ rpcUrl: URL_OK }), fetchRpcUrl);
  assert.equal(url, URL_OK);
  assert.deepEqual(asked.at(-1), ["/sol/config.json", { cache: "no-store" }]);
  assert.equal(storage.size, before, "the URL is not stored");
  assert.equal(UNAVAILABLE, "Solana is not available on this server");
  // S12: only a 503 or a 404 says that this server has no Solana.
  const off = [
    ["a 503 answer", json({ error: "Solana is not set up on this server." }, 503)],
    ["a 404 answer", () => new Response("Not found\n", { status: 404 })],
    ["a rpcUrl in an error answer", json({ rpcUrl: URL_OK }, 503)],
  ];
  for (const [what, make] of off) {
    await assert.rejects(() => withFetch(make, fetchRpcUrl), { message: UNAVAILABLE }, what);
  }
  // Any other failure is the connection: the person can press Try again.
  const offline = () => {
    throw new TypeError("offline");
  };
  const down = [
    ["no answer", offline],
    ["a 500 answer", () => new Response("", { status: 500 })],
    ["a body that is no JSON", () => new Response("<html>", { status: 200 })],
    ["no rpcUrl", json({})],
    ["an empty rpcUrl", json({ rpcUrl: "" })],
    ["a number as rpcUrl", json({ rpcUrl: 7 })],
    ["null", json(null)],
  ];
  for (const [what, make] of down) {
    await assert.rejects(() => withFetch(make, fetchRpcUrl), { message: NOT_LOADED }, what);
  }
}

// ── The page, with a server that gives no URL ──
{
  config.down = true;
  const rig = await loadRig();
  const { t, waitFor } = rig;
  const gid = await rig.wallet({ name: "Down" });
  await waitFor("the wallet", () => t.state.gid === gid && t.state.g);
  assert.equal(t.solOn(), true, "a testnet wallet is on");
  const real = globalThis.fetch;
  let configCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url) === "/sol/config.json") configCalls++;
    return real(url, init);
  };
  try {
    const tab = () => t.walletView([], null);
    t.ui.tab = "solana";
    tab();
    await waitFor("the failure", () => t.solError !== "");
    assert.equal(t.solError, UNAVAILABLE);
    assert.equal(t.sol, null, "nothing of Solana is attached");
    assert.match(t.banner.text, /Solana did not load: Solana is not available on this server/);
    for (let i = 0; i < 5; i++) tab();
    await t.solLoad();
    await sleep(100);
    assert.equal(configCalls, 1, "a redraw does not ask the server again");
    await assert.rejects(
      () => t.applyBackup({ kind: "zigs-sol-backup", group: gid, seat: 1 }, true),
      new RegExp(UNAVAILABLE),
    );
  } finally {
    globalThis.fetch = real;
    t.ui.tab = "overview";
  }
}
console.log("sol-config: ok");
process.exit(0);
