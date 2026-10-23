// Isolated UI fixtures: production renderers, synthetic data, no boot, network or signing.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = process.env.ZIGS_APPROVALS_SOURCE || root;
const phase = process.env.ZIGS_APPROVALS_PHASE || "after";
const output = resolve(root, "docs/ux-redesign/visuals/approvals-experience", phase);
await mkdir(output, { recursive: true });
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    const relative = path === "/" ? "index.html" : path.slice(1);
    const file = resolve(source, "web", relative);
    if (!file.startsWith(resolve(source, "web") + "/")) throw Error("Invalid path");
    let body = await readFile(file);
    if (relative === "index.html") body = body.toString()
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
      .replace(/<link[^>]+rel="(?:modulepreload|preload)"[^>]*>/g, "");
    if (relative === "app-loop.js") body = body.toString()
      .replace("export function render() {", "export function render() { return;");
    if (relative === "app-wallet.js") body += "\nexport { approvalsTab, groupHead };";
    res.writeHead(200, { "Content-Type": types[extname(file)] || "text/plain" }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const origin = "http://127.0.0.1:" + server.address().port;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });
const context = await browser.newContext({ reducedMotion: "reduce" });
await context.route("**/*", (r) => new URL(r.request().url()).origin === origin ?
  r.continue() : r.abort());
const page = await context.newPage();
const errors = [], checks = [], screens = [];
page.on("pageerror", (e) => errors.push(e.message));
const check = (ok, label) => { assert.ok(ok, label); checks.push(label); };

async function scene(name, count = 3) {
  await page.goto(origin);
  return page.evaluate(async ({ name, count }) => {
    const { state, ui } = await import("/app-state.js");
    const { el } = await import("/app-dom.js");
    const { setChain } = await import("/app-chain.js");
    const { setZ } = await import("/app-engine.js");
    const { setMe } = await import("/app-groups.js");
    const { setSecrets } = await import("/app-keystore.js");
    const wallet = await import("/app-wallet.js");
    setMe("fixture-local");
    const g = { id: "approvals-display-fixture", name: "Studio wallet", n: count, t: count ===
      2 ? 2 : Math.ceil(count / 2),
      version: 1, network: "testnet" };
    setSecrets({ [g.id + ":1"]: { keyPackage: "synthetic-non-signing-fixture" } });
    const address = "utest1" + "syntheticrecipient".repeat(8);
    const p = { id: "fixture-payment", status: "collecting", amount: 1250000000,
      fee: 10000, by: 2, createdAt: Date.now() - 240000, pczt: "synthetic-pczt",
      payees: [{ to: address, amount: 1250000000, memo: "" }] };
    const seats = Object.fromEntries(Array.from({ length: count }, (_, i) => [i + 1,
      { uid: i === 0 ? "fixture-local" : "fixture-device-" + i, name: ["This browser",
        "Studio laptop", "Recovery device"][i] || "Device " + (i + 1) }]));
    Object.assign(state, { g, gid: g.id, groups: [g], seats, seatsLoaded: true, seatsSettled: true,
      sessionsLoaded: true, sessionsFailed: false, pending: false, sessions: [],
      wallet: { birthday: 1, orchard_fvk: "synthetic-viewing-key" }, commits: {}, shares: {} });
    ui.tab = "approvals";
    setZ({ inspect: () => JSON.stringify({ lines: [
      { kind: "spend", value: 1250010000 },
      { kind: "output", who: address, value: 1250000000, memo_status: "empty" },
    ], fee: 10000, standard_fee: 10000, txid: "a".repeat(64) }), normalizeAddress: (a) => a });
    const sent = new Set();
    setChain({ gid: g.id, cw: {}, bal: { height: 1 }, sent, balAt: Date.now() });
    const scenes = {
      request: () => { state.sessions = [p]; },
      waiting: () => { state.sessions = [{ ...p, id: "waiting-payment", status: "signing",
        signers: [2, 3], package: "synthetic-package" }]; },
      multiple: () => { state.sessions = [p, { ...p, id: "second-request", amount: 250000000,
        note: "Equipment payment" }]; },
      loading: () => { state.sessionsLoaded = false; },
      failed: () => { state.sessionsFailed = true; },
    };
    scenes[name]?.();
    const app = document.getElementById("app");
    app.replaceChildren(el("p", { class: "small muted fixture-label" },
      "Synthetic preview · no funds or signing"),
      wallet.groupHead(g, true, null),
      wallet.walletView([], null));
    const nav = document.getElementById("side-nav");
    nav.replaceChildren(el("div", { class: "label", style: "padding:20px 12px 12px" },
      "Studio wallet"),
      ...["Overview", "Approvals", "Activity", "Security", "Settings"].map((label) =>
        el("div", { class: "side-item" + (label === "Approvals" ? " active" : "") },
          el("span", { "aria-hidden": "true" }, label === "Approvals" ? "◇" : "○"),
          el("span", { class: "side-label" }, label), el("span", { class: "side-tail" }))));
    if (["review", "review-failed", "review-unknown", "completed"].includes(name)) {
      const { sessionLayer } = await import("/app-drawer.js");
      state.sid = p.id; state.commits = { 2: {} };
      if (name === "review-unknown") state.commits = {};
      if (name === "completed") { p.broadcastTxid = "a".repeat(64); sent.add(p.broadcastTxid); }
      if (name === "review-failed") p.error = "Synthetic payment stopped";
      app.append(el("div", { class: "scrim" }), sessionLayer(p));
    }
    return { logs: state.log, address };
  }, { name, count });
}

async function capture(name, width, theme = "dark") {
  await page.setViewportSize({ width, height: width < 600 ? 1000 : 1080 });
  await page.evaluate(async (theme) => { document.documentElement.dataset.theme =
    theme; window.scrollTo(0, 0);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }, theme);
  const file = `${name}-${width}-${theme}.png`;
  await page.screenshot({ path: resolve(output, file) }); screens.push(file);
  if (width === 390 && ["empty", "request"].includes(name) && phase === "after") {
    const control = `${name}-shared-control-${width}-${theme}.png`;
    await page.locator(".shared-control").screenshot({ path: resolve(output,
      control) }); screens.push(control);
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    `${name}: no overflow at ${width}/${theme}`);
}

async function captureMainScene(name) {
  for (const width of [1440, 390]) {
      await capture(name, width);
      if (name === "review" || name === "completed") {
        await page.locator(".approval-visualization").scrollIntoViewIfNeeded();
        const file = `${name}-progress-${width}-dark.png`;
        await page.screenshot({ path: resolve(output, file) }); screens.push(file);
        await page.locator(".drawer-body").evaluate((n) => { n.scrollTop = 0; });
      }
  }
}

async function verifyScene(name, result) {
      if (name === "empty") {
        check(await page.getByRole("heading", { name: "No approvals waiting",
          exact: true }).count() === 1, "verified empty queue has precise headline");
        check(await page.locator(".approval-empty").evaluate(
          (n) => n.getBoundingClientRect().height < 280), "empty surface is compact");
        check(await page.locator(".shared-control .signer-node").count() === 3,
          "configuration uses actual device count");
        check(await page.locator(".approvals-layout").evaluate((n) =>
          n.children[1].classList.contains("approvals-support") &&
            n.children[2].classList.contains("approval-history-link")),
              "shared control precedes history on mobile");
      }
      if (name === "request") {
        check(await page.locator(".approval-request").count() === 1,
          "actionable request uses a review card");
        check(await page.locator(".approval-request").innerText().then((s) => s.includes(
          "Review transaction") && s.includes("12.5") && !s.includes("of 2 approvals")),
            "request displays actual amount without inferred approval count");
        await page.locator(".approval-request").focus();
        check(await page.locator(".approval-request").evaluate((n) => n ===
          document.activeElement), "request is keyboard focusable");
      }
      if (name === "waiting") check(await page.locator(".approval-request").innerText().then(
        (s) => s.includes("Waiting") && !s.includes("Awaiting your approval")),
          "waiting is separate from local approval");
      if (name === "review") {
        check(await page.locator(".drawer").innerText().then((s) => s.includes(
          "Verify before signing") && s.replace(/\s/g, "").includes(result.address)),
            "review keeps full recipient and deliberate verification guidance");
        check(await page.locator(".approval-device.received").count() === 1,
          "review illuminates only the actual recorded approval");
      }
      if (name === "completed") check(await page.locator(
        "[data-outcome-kind=included]").count() === 1,
          "block inclusion uses existing chain outcome");
}

try {
  for (const name of ["empty", "request", "waiting", "review", "completed"]) {
    const result = await scene(name);
    check(result.logs.length === 0, name + ": production renderer has no fallback errors");
    await captureMainScene(name);
    if (phase === "after") await verifyScene(name, result);
  }
  if (phase === "after") {
    await scene("multiple");
    for (const width of [1280, 768, 390, 320]) await capture("multiple", width);
    for (const name of ["empty", "request", "review"]) { await scene(name); await capture(
      name, 1440, "light"); await capture(name, 390, "light"); }
    for (const name of ["loading", "failed"]) {
      await scene(name); check(await page.getByText("No approvals waiting", {
        exact: true }).count() === 0, name + " never claims an empty queue");
      await capture(name, 390);
    }
    for (const n of [2, 7]) { await scene("empty", n); await capture("devices-" + n, 390); }
    await scene("empty", 7);
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%";
      document.querySelectorAll(".signer-node-name").forEach((n) => { n.textContent =
        "Long synthetic device name with spaces and wrapping"; }); });
    await capture("text-200-percent", 390);
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    await scene("review-failed"); await capture("review-failed", 390);
    check(await page.locator("[data-outcome-kind=attention]").count() > 0,
      "failure uses an attention outcome without success styling");
    await scene("review-unknown");
    check(await page.locator(".approval-visualization").innerText().then((s) => s.includes(
      "Count unavailable")), "empty approval map never invents a verified zero before a snapshot");
    check(await page.locator(".approval-visualization .signer-node").count() === 0,
      "unknown count does not invent per-device approval states");
    await page.locator(".approval-visualization").scrollIntoViewIfNeeded(); await capture(
      "unknown-progress", 390);
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    check(await page.locator(".approval-node").first().evaluate((n) => getComputedStyle(
      n).animationName === "none"), "reduced motion disables approval effects");
    await capture("forced-colors", 390);
  }
  check(errors.length === 0, "no uncaught browser errors");
} finally {
  await browser.close(); await new Promise((r) => server.close(r));
  await writeFile(resolve(output, "validation.json"), JSON.stringify({ phase, checks, screens,
    errors,
    limitation: "Isolated synthetic presentation fixtures; no live wallet or signing ceremony." },
    null, 2) + "\n");
}
console.log(JSON.stringify({ phase, checks: checks.length, screenshots: screens.length, errors }));
