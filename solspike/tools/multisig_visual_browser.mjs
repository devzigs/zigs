// Local-only, synthetic presentation fixtures. No app boot, protocol, secrets or signing actions.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = resolve(ROOT, "docs/ux-redesign/visuals/multisig/after");
await mkdir(output, { recursive: true });
const checks = [], screens = [], errors = [];
const check = (ok, label) => { assert.ok(ok, label); checks.push(label); };
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    const file = resolve(ROOT, "web", path === "/" ? "index.html" : "." + path);
    if (!file.startsWith(resolve(ROOT, "web") + "/")) throw Error("Invalid path");
    let body = await readFile(file);
    if (path === "/") body = body.toString().replace(
      '<script type="module" src="/app.js"></script>', "");
    const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
      ".woff2": "font/woff2", ".png": "image/png" };
    res.setHeader("Content-Type", types[extname(file)] || "application/octet-stream");
    res.end(body);
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok); });
const origin = "http://127.0.0.1:" + server.address().port;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
let browser;
try {
  browser = await chromium.launch({ headless: true,
    executablePath: process.env.CHROME_EXECUTABLE });
  const context = await browser.newContext({ reducedMotion: "reduce" });
  await context.route("**/*", (route) => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort());
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  const drawer = await page.evaluate(async () => {
    const { state } = await import("/app-state.js");
    const { sessionLayer } = await import("/app-drawer.js");
    state.g = { n: 3, t: 2, network: "testnet", name: "Sample shared wallet" };
    state.gid = "synthetic-multisig"; state.sid = "synthetic-payment"; state.wallet = {};
    state.commits = { 1: {} };
    state.seats = { 1: { name: "Device 1" }, 2: { name: "Device 2" }, 3: { name: "Device 3" } };
    const ss = { id: state.sid, status: "collecting", by: 1, createdAt: 1, amount: 10000,
      fee: 1000, payees: [], error: "Synthetic display-only blocked payment" };
    document.getElementById("app").replaceChildren(sessionLayer(ss));
    return { html: document.documentElement.outerHTML.replace(
      /<script[^>]*>[\s\S]*?<\/script>/g, ""), log: state.log,
        count: document.querySelectorAll(".approval-device.received").length };
  });
  await page.route("**/frozen", (route) => route.fulfill({ contentType: "text/html",
    body: drawer.html }));
  await page.goto(origin + "/frozen");
  check(drawer.log.length === 0 && drawer.count === 1,
    "existing drawer renders exactly one recorded approval");
  check(await page.locator(".drawer-foot button").count() === 0,
    "blocked real drawer preserves its absence of payment actions");
  for (const width of [1440, 390]) for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    const file = `drawer-${width}-${theme}.png`;
    await page.screenshot({ path: resolve(output, file), fullPage: true }); screens.push(file);
    const approvalFile = `drawer-approvals-${width}-${theme}.png`;
    await page.locator(".steps>.step").nth(1).screenshot({ path: resolve(output, approvalFile) });
    screens.push(approvalFile);
  }
  await page.evaluate(() => {
    document.querySelector(".side").style.display = "none";
    const app = document.getElementById("app");
    app.className = "multisig-fixtures";
    const style = document.createElement("style");
    style.textContent = (
      ".shell{display:block}.multisig-fixtures{max-width:1080p"
      + "x;margin:auto;padding:24px;display:grid;grid-template-c"
      + "olumns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap"
      + ":24px}.multisig-fixtures>article{min-width:0}.multisig-"
      + "fixtures h2{font-size:16px;margin:0 0 "
      + "12px}.multisig-fixtures button{margin-bottom:12px}"
    );
    document.head.append(style);
  });
  const result = await page.evaluate(async () => {
    const { ApprovalVisualization, announceApprovalProgress } = await import(
      "/app-approval-visualization.js");
    const { el } = await import("/app-dom.js");
    const app = document.getElementById("app"); app.replaceChildren();
    const stage = (title, detail) => ({ title, detail });
    const base = { total: 3, required: 2, confirmed: 1, context: "synthetic-payment",
      stage: stage("Waiting for approvals", "Waiting for another device's approval."),
      participants: [1, 2, 3].map((id) => ({ id, name: "Device " + id, confirmed: id === 1,
        motionValue: id === 1 ? "on" : "off" })) };
    const fixture = (name, facts) => {
      const node = el("article", {}, el("h2", {}, name), ApprovalVisualization(facts));
      app.append(node); return node;
    };
    const waiting = fixture("Waiting · synthetic", base);
    const threshold = fixture("Threshold met · synthetic", { ...base, confirmed: 2,
      stage: stage("Approvals are complete", "Signing and submission are separate steps."),
      participants: base.participants.map((p) => ({ ...p, confirmed: p.id <= 2 })) });
    const submitted = fixture("Submitted · synthetic", { ...base,
      stage: stage("Waiting for a block", "A device sent it. No synced block holds it yet.") });
    const attention = fixture("Stopped · synthetic", { ...base, error: true,
      stage: stage("Payment needs attention", "Check the payment before proceeding.") });
    const missing = fixture("Missing records · synthetic", { ...base, confirmed: undefined,
      participants: undefined });
    const large = fixture("Seven devices · synthetic", { ...base, total: 7, required: 4,
      confirmed: 2, participants: undefined });
    const long = fixture("Long labels · synthetic", { ...base, participants: base.participants.map(
      (p) => ({ ...p, name: "Sample device with a deliberately long display name " + p.id })) });
    const checking = fixture("Checking records · synthetic", { ...base, isBusy: true });
    const mismatch = ApprovalVisualization({ ...base, confirmed: 2 });
    const noData = ApprovalVisualization({ ...base, participants: undefined });
    const unknown = ApprovalVisualization({ ...base, confirmed: null });
    announceApprovalProgress(document);
    const live = document.getElementById("payment-approval-announcement");
    const initial = live.textContent;
    waiting.querySelector("section").replaceWith(ApprovalVisualization({ ...base, confirmed: 0,
      participants: base.participants.map((p) => ({ ...p, confirmed: false })) }));
    announceApprovalProgress(document);
    const changed = live.textContent;
    const observer = new MutationObserver(() => {}); observer.observe(live, { childList: true });
    announceApprovalProgress(document);
    const repeated = observer.takeRecords().length; observer.disconnect();
    waiting.querySelector("section").replaceWith(ApprovalVisualization({ ...base,
      context: "another-wallet" }));
    announceApprovalProgress(document);
    const switched = live.textContent;
    waiting.querySelector("section").replaceWith(ApprovalVisualization(base));
    announceApprovalProgress(document);
    return { received: waiting.querySelectorAll(".received").length,
      threshold: threshold.textContent, submitted: submitted.textContent,
      attention: attention.querySelector("section").className,
      aggregate: large.querySelectorAll(".approval-device").length,
      missing: missing.textContent, noDataNodes: noData.querySelectorAll(".approval-device").length,
      mismatchNodes: mismatch.querySelectorAll(".approval-device").length,
      unknownNodes: unknown.querySelectorAll(".approval-device").length,
      checkingMotion: [...checking.querySelectorAll("[data-motion-value]")].every(
        (n) => n.dataset.motionValue === "unknown"), initial, changed, repeated, switched,
      interactive: app.querySelectorAll("button,a,input").length, long: !!long };
  });
  check(result.received === 1, "membership does not illuminate unapproved devices");
  check(result.threshold.includes("Approvals are complete"), "threshold uses the supplied stage");
  check(result.submitted.includes("Waiting for a block"),
    "submission remains distinct from finality");
  check(result.attention.includes("attention") && result.checkingMotion,
    "errors and checking suppress approval glow and motion");
  check(result.aggregate === 0 && result.noDataNodes === 0 && result.mismatchNodes === 0
    && result.unknownNodes === 0, (
      "large, missing and inconsistent data use aggregate "
      + "counts without invented devices"
    ));
  check(result.missing.includes("Count unavailable"), "unknown count is not zero approvals");
  check(result.initial === "" && result.changed.startsWith("0 of 2") && result.repeated === 0
    && result.switched === "", (
      "announcements handle revocation, suppress redraw "
      + "duplicates and reset across payments"
    ));
  check(result.interactive === 0, "visualization introduces no controls or wallet actions");
  const gallery = await page.evaluate(() => document.documentElement.outerHTML.replace(
    /<script[^>]*>[\s\S]*?<\/script>/g, ""));
  await page.route("**/gallery", (route) => route.fulfill({ contentType: "text/html",
    body: gallery }));
  await page.goto(origin + "/gallery");
  for (const width of [1440, 390, 320]) for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `no horizontal overflow at ${width}px in ${theme}`);
    const file = `states-${width}-${theme}.png`;
    await page.screenshot({ path: resolve(output, file), fullPage: true }); screens.push(file);
  }
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    "200% base text has no horizontal overflow");
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.locator(".approval-node").first().evaluate((n) => n.classList.add(
    "motion-complete-enter"));
  check(await page.locator(".approval-node").first().evaluate((n) =>
    getComputedStyle(n).animationName === "none"), "reduced motion removes the approval effect");
  await page.screenshot({ path: resolve(output, "forced-colors-390.png"), fullPage: true });
  screens.push("forced-colors-390.png");
  check(errors.length === 0, "no uncaught browser errors");
  await context.close();
} finally {
  await browser?.close(); await new Promise((r) => server.close(r));
  await writeFile(resolve(ROOT, "docs/ux-redesign/multisig-visual-validation.json"),
    JSON.stringify({ checks, screens: screens.map((s) => "visuals/multisig/after/" + s), errors,
      limitation: (
        "Synthetic presentation fixtures; no live signing, "
        + "transactions or physical assistive technology tested."
      ) }, null, 2) + "\n");
}
console.log(JSON.stringify({ checks: checks.length, screenshots: screens.length, errors }));
