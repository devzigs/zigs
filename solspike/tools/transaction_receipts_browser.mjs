import { forEachCase } from "../harness/ui-matrix.mjs";
// Real presentation renderers with synthetic, non-authorizing data; no wallet boot or services.
// Set PLAYWRIGHT_MODULE to the installed Playwright module; run this script with before|after.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const phase = process.argv[2] || "after";
assert.ok(["before", "after"].includes(phase));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });
const context = await browser.newContext({ reducedMotion: "reduce",
  permissions: ["clipboard-read", "clipboard-write"] });
const origin = process.env.ZIGS_RECEIPTS_ORIGIN || "http://127.0.0.1:8819";
const output = resolve("docs/ux-redesign/visuals/transaction-receipts", phase);
mkdirSync(output, { recursive: true });
function baselineAsset(path) {
  const baseline = process.env.ZIGS_RECEIPTS_BASELINE_DIR;
  if (phase === "before" && baseline) {
    if (path === "/transaction-receipts.css") return { contentType: "text/css", body: "" };
    const file = { "/app-drawer.js": "app-drawer.js", "/sol/payview.js": "payview.js" }[path];
    if (file) return { contentType: "text/javascript", body: readFileSync(resolve(baseline,
      file), "utf8") };
  }
  return null;
}
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === "/app.js") return route.fulfill({ contentType: "text/javascript",
    body: "// No app boot in receipt QA." });
  if (url.origin === origin && url.pathname === "/app-loop.js") {
    const response = await route.fetch();
    const body = (await response.text())
      .replace("export function render() {", "export function render() { return;")
      .replace("export function react() {", "export function react() { return;");
    return route.fulfill({ response, body });
  }
  const saved = baselineAsset(url.pathname);
  if (saved) return route.fulfill(saved);
  return url.origin === origin ? route.continue() : route.abort();
});
const page = await context.newPage(), errors = [], checks = [], screenshots = [];
page.on("pageerror", (error) => errors.push(error.message));
const check = (ok, label) => { checks.push({ label, pass: !!ok }); assert.ok(ok, label); };

async function fixture(kind) {
  await page.goto(origin);
  return page.evaluate(async (kind) => {
    const { state } = await import("/app-state.js");
    const { setZ } = await import("/app-engine.js");
    const { setChain } = await import("/app-chain.js");
    const { sessionLayer } = await import("/app-drawer.js");
    const { el } = await import("/app-dom.js");
    const { payCards } = await import("/sol/payview.js");
    const address = "utest1" + "syntheticaddress".repeat(12), txid = "ab12".repeat(16);
    const amount = kind === "large" ? 123456712345678 : 25000000;
    Object.assign(state, { gid: "synthetic-receipt-wallet", g: {
      n: 3, t: 2, network: "testnet", name: "Household test wallet" },
      wallet: { orchard_fvk: "synthetic-viewing-key" }, pending: false,
      seats: {}, sessions: [], commits: {}, shares: {} });
    state.groups = [{ ...state.g, id: state.gid }];
    // Stub only engine answers in this isolated QA page, never production state or modules.
    setZ({ inspect: () => JSON.stringify(kind === "unreadable" ? {
      error: "Synthetic unreadable transaction" } : {
      txid, sighash: "synthetic-hash", expiry_height: 5000100, fee: 10000, standard_fee: 10000,
      tx_version: "v5", lines: [{ kind: "spend", value: amount + 10000 },
        { kind: "output", who: address, value: amount, memo_status: "empty" }] }),
    normalizeAddress: (address) => address,
    expiryState: () => JSON.stringify({ expired: false, seconds_left: 1000, blocks_left: 100 }) });
    const synced = kind !== "stale";
    setChain({ gid: state.gid, cw: {}, bal: { height: 5000000 },
      balAt: synced ? Date.now() : 0, sent: new Set(kind === "confirmed" ? [txid] : []) });
    const ss = { id: "synthetic-receipt-" + kind, pczt: "synthetic-" + kind,
      status: "collecting", by: 1, amount, fee: 10000, change: 0, noteValue: amount + 10000,
      createdAt: 1792627200000, payees: [{ to: address, amount, memo: "" }] };
    if (["submitted", "confirmed", "stale"].includes(kind)) Object.assign(ss, {
      status: "broadcast", broadcastAt: Date.now(), broadcastTxid: txid,
      final: { txid, tx_hex: "00".repeat(200), size: 200 } });
    if (kind === "failed") Object.assign(ss, { status: "complete",
      final: { txid, tx_hex: "00", size: 1 },
        broadcastError: "Synthetic network rejection. Payment was not submitted." });
    function showSolReceipt() {
      const host = document.createElement("div");
      const sol = { id: "synthetic-sol-receipt", by: 1,
        status: kind === "sol-expired" ? "collecting" : "sent",
        intent: "0a" + "00".repeat(50), expiry: "1", createdAt: 1,
        txId: "SyntheticSolanaSignature".repeat(4), slot: 123456,
        outcome: kind === "sol-failed" ? "failed" : "success" };
      const c = { host: { el, localSeats: () => [], seatIds: () => [1, 2, 3],
        sec: () => ({}), canWriteAs: () => false, state }, gid: state.gid, W: {},
        sessions: [sol], commits: {}, shares: {}, docs: { solstart: {}, soldone: {},
          solfee: {}, solabort: {} },
        loaded: {}, wait: 0, sessWait: 0, chain: null, sync: null, inited: null };
      host.append(...payCards(c, (fn) => fn, {}));
      const card = host.querySelector("[data-session]");
      const frame = el("main", { class: "receipt-qa-frame" }, card);
      document.getElementById("app").replaceChildren(frame);
    }
    if (kind.startsWith("sol-")) {
      showSolReceipt();
    } else document.getElementById("app").replaceChildren(sessionLayer(ss));
    const badge = el("p", { class: "receipt-qa-label" },
      "Synthetic presentation fixture · no real transaction");
    document.body.append(badge);
    return { address, txid, renderLog: state.log };
  }, kind);
}

async function checkReceiptCopy(kind, values) {
      if (kind !== "unreadable") {
        const copy = page.getByRole("button", { name: "Copy recipient address", exact: true });
        await copy.focus(); await page.keyboard.press("Enter");
        check(await page.evaluate(() => navigator.clipboard.readText()) === values.address,
          kind + " exact address copy by keyboard");
        const focus = await page.evaluate(() => getComputedStyle(
          document.activeElement).outlineStyle !== "none");
        check(focus, kind + " keyboard focus visible");
      }
      if (["submitted", "confirmed", "stale", "failed"].includes(kind)) {
        await page.getByRole("button", { name: "Copy transaction ID", exact: true }).click();
        check(await page.evaluate(() => navigator.clipboard.readText()) === values.txid,
          kind + " exact ID copy");
        if (kind === "submitted") {
          await page.setViewportSize({ width:390, height:844 });
          const name = "submitted-execution-390-light.png";
          await page.screenshot({ path:resolve(output,name), animations:"disabled" });
          screenshots.push(name);
          await page.setViewportSize({ width:320, height:844 });
        }
      }
    }

async function checkZcashReceipt(kind, values) {
      if (!await page.locator(".pay-status").count()) console.log({ kind,
        renderLog:values.renderLog });
      const status = await page.locator(".pay-status").innerText();
      const included = /^(In a block|Transaction in a block)/.test(status);
      check(kind === "confirmed" ? included : !included, kind + " honest finality");
      if (kind === "stale") check(/has not synced/.test(status), "stale sync disclosure persists");
      if (kind === "submitted") check(/^(Waiting for a block|Transaction submitted)/.test(
        status), "submission never claims confirmation");
      if (kind === "failed") check((await page.locator(".drawer").innerText()).includes(
        "Synthetic network rejection"), "send error persists");
      await checkReceiptCopy(kind, values);
}

try {
  await forEachCase(["pending", "submitted", "confirmed", "failed", "stale", "unreadable",
    "large", "sol-expired", "sol-sent", "sol-failed"], async (kind) => {
    const values = await fixture(kind);
    await page.addStyleTag({ content: (
      ".shell{display:block}.shell>.side{display:none}.main{pa"
      + "dding:0}.receipt-qa-label{position:fixed;left:12px;bott"
      + "om:8px;font:12px sans-serif;max-width:180px;color:var(-"
      + "-text);background:var(--bg);padding:8px}.receipt-qa-fra"
      + "me{max-width:620px;margin:32px auto;padding:16px}"
    ) });
    await forEachCase([1440, 390, 320], async (width) => {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await forEachCase(["dark", "light"], async (theme) => {
        await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme);
        await page.evaluate(async () => { await document.fonts.ready; await new Promise(
          requestAnimationFrame); });
        const fit = await page.evaluate(() => ({ page: document.documentElement.scrollWidth <=
          innerWidth,
          parts: [...document.querySelectorAll(
            ".drawer,.drawer-body,.transaction-receipt,.sol-review")]
            .every((n) => n.scrollWidth <= n.clientWidth + 1) }));
        if (phase === "after") check(fit.page && fit.parts, kind + " fits " + width + " " + theme);
        if (width !== 320 && ["pending", "submitted", "confirmed", "failed",
          "sol-failed"].includes(kind)) {
          const name = `${kind}-${width}-${theme}.png`;
          await page.screenshot({ path: resolve(output, name), fullPage: true,
            animations: "disabled" });
          screenshots.push(name);
        }
      });
    });
    if (phase === "after" && !kind.startsWith("sol-")) await checkZcashReceipt(kind, values);
    if (phase === "after" && kind === "sol-failed") {
      const card = page.locator("[data-session]");
      check(await card.locator(".receipt-stage").innerText() === "Failed on chain",
        "Solana failed outcome is never labeled Executed");
    }
    if (phase === "after") {
      await page.emulateMedia({ forcedColors: "active" });
      check(await page.locator(".drawer,.sol-review").first().isVisible(), kind +
        " forced colors readable surface");
      await page.emulateMedia({ forcedColors: "none" });
      // Exercise long values with doubled text at the narrowest viewport.
      await page.addStyleTag({
        content: "body *{font-size:200%!important}body * *{font-size:inherit!important}" });
      const enlarged = await page.evaluate(() => [...document.querySelectorAll(
        ".drawer,.drawer-body,.sol-review")]
        .every((n) => n.scrollWidth <= n.clientWidth + 1));
      if (!enlarged) console.log(await page.evaluate(() => [...document.querySelectorAll("body *")]
        .filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => ({ tag: n.tagName,
          class: n.className, width: n.clientWidth, scroll: n.scrollWidth })).slice(-20)));
      check(enlarged, kind + " enlarged text fits at320");
    }
  });
  check(!errors.length, "no uncaught browser errors");
} finally {
  await browser.close();
  writeFileSync(resolve(output, "validation.json"), JSON.stringify({ phase, checks, errors,
    screenshots,
    limitations: ["Synthetic renderer fixtures; no signing, submission or live chain exercised.",
      "Chromium only; no physical device or assistive technology verification."] }, null, 2) +
        "\n");
}
console.log(JSON.stringify({ phase, checks: checks.length, screenshots: screenshots.length,
  errors }));
