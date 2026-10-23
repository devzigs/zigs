// Inert production-renderer QA. Synthetic data only; no app boot, signing or external requests.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";

const phase = process.argv[2] || "after";
assert.ok(["before", "after"].includes(phase));
const root = resolve("web"), out = resolve("docs/ux-redesign/visuals/activity-redesign", phase);
mkdirSync(out, { recursive: true });
const types = { js: "text/javascript", html: "text/html", css: "text/css", png: "image/png",
  woff2: "font/woff2" };
const baselineFiles = new Set(["index.html", "app-wallet.js", "app-drawer.js",
  "transaction-receipts.css"]);
function sourceBody(file, path) {
  const relative = file.slice(root.length + 1);
  let body = phase === "before" && baselineFiles.has(relative)
    ? execFileSync("git", ["show", "ebf236a:web/" + relative]) : readFileSync(file);
  if (path === "/") body = body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
    .replace(/<link[^>]+rel="(?:modulepreload|preload)"[^>]*>/g, "");
  if (path === "/app-loop.js") body = body.toString()
    .replace("export function render() {", "export function render() { return;")
    .replace("export function react() {", "export function react() { return;");
  if (path === "/app-wallet.js") body = body.toString() +
    "\nexport { activityTab, pageHeading, groupHead };\n";
  return path === "/app-sol.js" ? fixtureSol(body) : body;
}
function fixtureSol(source) {
  let body = source.toString();
  for (const key of ["solSetup", "solActivity", "solActivityWaits", "solOlderCount"])
    body = body.replace("export const " + key + " =", "const qaOriginal_" + key + " =");
  body = body.replace("export const solOn =", "const qaOriginal_solOn =");
  return body + `\nexport const solSetup=()=>globalThis.qaSol.setup;
      export const solOn=(gid)=>globalThis.qaSol.on??qaOriginal_solOn(gid);
      export function qaSolModuleState(loading,error){ solLoading=loading; solError=error; }
      export const solActivity=()=>globalThis.qaSol.rows;
      export const solActivityWaits=()=>globalThis.qaSol.waits||false;
      export const solOlderCount=()=>globalThis.qaSol.older||0;`;
}
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  const file = join(root, path === "/" ? "index.html" : path);
  if (!file.startsWith(root + "/") || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": types[file.split(".").pop()] || "text/plain" })
    .end(sourceBody(file, path));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = "http://127.0.0.1:" + server.address().port;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });
const context = await browser.newContext({ reducedMotion: "reduce", permissions: [
  "clipboard-read", "clipboard-write"] });
await context.route("**/*", (route) => new URL(route.request().url()).origin === origin ?
  route.continue() : route.abort());
const page = await context.newPage(), errors = [], checks = [], screenshots = [];
page.on("pageerror", (e) => errors.push(e.message));
const check = (ok, label) => { checks.push({ label, pass: !!ok }); assert.ok(ok, label); };

async function scene(kind) {
  await page.goto(origin);
  await page.evaluate(async (kind) => {
    globalThis.qaSol = { setup: { status: "ready" }, rows: [] };
    const { state, ui } = await import("/app-state.js");
    const { setChain } = await import("/app-chain.js");
    const { setZ } = await import("/app-engine.js");
    const { el } = await import("/app-dom.js");
    const w = await import("/app-wallet.js");
    const address = "utest1" + "syntheticaddress".repeat(12), txid = "ab12".repeat(16);
    const g = { id: "activity-display-fixture", name: "Household wallet", n: 3, t: 2,
      version: 2, network: "testnet" };
    Object.assign(state, { g, gid: g.id, groups: [g], wallet: { birthday: 4500000,
      orchard_fvk: "synthetic-viewing-key" },
      sessions: [], seats: { 1: { name: "Device 1" } }, commits: {}, shares: {}, pending: false });
    Object.assign(ui, { tab: "activity", chainFilter: "all" });
    setZ({ normalizeAddress: (a) => a, blockSpanSeconds: (_net, from, to) => (to - from) * 75,
      inspect: () => JSON.stringify({ txid, sighash: "synthetic-hash", expiry_height: 5000100,
        fee: 10000, standard_fee: 10000, tx_version: "v5", lines: [
          { kind: "spend", value: 25010000 }, { kind: "output", who: address, value: 25000000,
            memo_status: "empty" }] }),
      expiryState: () => JSON.stringify({ expired: false, seconds_left: 1000,
        blocks_left: 100 }) });
    const c = { gid: g.id, cw: {}, bal: { height: 5000000, tip: 5000000 }, balAt: Date.now(),
      sent: new Set(), received: [] };
    const ss = { id: "synthetic-payment", pczt: "synthetic-payment", status: "collecting", by: 1,
      amount: 25000000, fee: 10000, change: 0, noteValue: 25010000,
      createdAt: 1792713600000, payees: [{ to: address, amount: 25000000, memo: "" }] };
    if (["populated", "busy", "filtered", "receipt"].includes(kind)) {
      state.sessions = [ss];
      const count = kind === "busy" ? 105 : 4;
      c.received = Array.from({ length: count }, (_, i) => ({ height: 4999999 - i * 35,
        txid: i.toString(16).padStart(64, "a"), value: [245000000, 12500000, 100,
          123456789][i % 4], confirmed: i !== 1, memos: [] }));
    }
    if (kind === "filtered") ui.chainFilter = "sol";
    if (kind === "loading") { c.cw = null; c.bal = null; globalThis.qaSol.rows = null; }
    if (kind === "error") c.error = "Synthetic retrieval error";
    if (kind === "solana") globalThis.qaSol.rows = [
      { id: "sample-deposit", t: 1792713600000, title: "Received SOL", by: 1,
        amount: "0.0025 SOL", sign: "in", word: "Confirmed", tone: "ok", added: "Added",
          slot: 123456 },
      { id: "sample-failed", t: 1792713500000, title: "Add SOL", by: 1, amount: "0.003 SOL",
        sign: "", word: "Failed on chain", tone: "bad", added: "Tried" },
      { id: "sample-pending", t: 1792713400000, title: "Private payment", by: 1,
        amount: "0.001 SOL", sign: "out", word: "Signing", tone: "info" }];
    setChain(c);
    globalThis.qaActivityDraw = () => document.getElementById("app").replaceChildren(
      el("div", { class: "page wallet-page" }, w.groupHead(g, true, null),
        el("section", { id: "panel-activity", class: "panel", "aria-label": "Activity" },
          w.pageHeading("activity", "Activity"), w.activityTab())));
    globalThis.qaActivityDraw();
    if (kind === "receipt") {
      Object.assign(ss, { status: "broadcast", broadcastTxid: txid, broadcastAt: Date.now(),
        final: { txid, tx_hex: "00".repeat(200), size: 200 } });
      state.sessions = [ss]; state.sid = ss.id;
      document.getElementById("app").append((await import("/app-drawer.js")).sessionLayer(ss));
    }
    const { sectionNav } = await import("/app-shell.js");
    document.getElementById("side-nav").replaceChildren(...sectionNav([
      ["overview", "Overview"], ["approvals", "Approvals"], ["activity", "Activity"],
      ["recipients", "Address book"], ["swap", "Swap"], ["chats", "Chats"],
      ["recovery", "Security"], ["settings", "Settings"]], "activity"));
    document.getElementById("engine-text").textContent = "Presentation fixture";
    document.getElementById("app").append(el("p", { class: "small faint" },
      "Synthetic presentation fixture · No funds or signing"));
  }, kind);
}

async function capture(kind, width, theme) {
  await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
  await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme);
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(
    requestAnimationFrame); });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    kind + " fits " + width + " " + theme);
  if (phase === "after") {
    const grid = await page.evaluate(() => [...document.querySelectorAll(
      ".activity-ledger .row-item")]
      .every((n) => { const main = n.querySelector(".ri-main").getBoundingClientRect();
        const end = n.querySelector(".ri-end").getBoundingClientRect();
        return main.width >= 80 && end.left >= main.right - 1; }));
    check(grid, kind + " title and amount columns remain readable " + width + " " + theme);
  }
  if ((width !== 1440 && width !== 390) || theme !== "dark" && kind !== "empty") return;
  const name = `${kind}-${width}-${theme}.png`;
  await page.screenshot({ path: join(out, name), fullPage: !["busy", "receipt"].includes(
    kind), animations: "disabled" });
  screenshots.push(name);
}

async function interactionChecks(kind) {
  if (kind === "populated") {
    check(await page.locator(".activity-ledger .row-item").count() === 5,
      "Five real-renderer fixture records");
    check(await page.locator(".activity-ledger a").first().getAttribute("href") ===
      "https://testnet.zecblock.com/tx/" + "0".padStart(64, "a"),
        "Received record retains exact explorer destination");
    const pick = page.getByRole("button", { name: "Solana", exact: true });
    await pick.focus();
    check(await pick.evaluate((n) => getComputedStyle(n).outlineStyle !== "none"),
      "Keyboard focus is visible");
    await page.keyboard.press("Enter");
    check(await page.evaluate(async () => (await import("/app-state.js")).ui.chainFilter ===
      "sol"), "Keyboard invokes existing network filter");
    await page.evaluate(() => globalThis.qaActivityDraw());
    check(await page.getByRole("button", { name: "Solana", exact: true }).getAttribute(
      "aria-pressed") === "true", "Active filter is visible");
    check(await page.getByText("No matching activity", { exact: true }).isVisible(),
      "Filtered empty differs from true empty");
    await page.getByRole("button", { name: "Show all activity", exact: true }).click();
    await page.evaluate(() => globalThis.qaActivityDraw());
    check(await page.locator(".activity-ledger .row-item").count() === 5,
      "Reset restores all existing records");
    await page.locator(".activity-limitation>summary").click();
    check((await page.locator(".activity-limitation-body").innerText()).includes(
      "until you leave this wallet or reload"), "Temporary Solana deposit limitation preserved");
    check((await page.locator(".activity-limitation-body").innerText()).includes(
      "other people send"), "Unindexed incoming SOL disclosure preserved");
    await page.evaluate(async () => {
      const { saveFormState, restoreFormState } = await import("/app-loop.js");
      const app = document.getElementById("app"), saved = saveFormState(app);
      globalThis.qaActivityDraw(); restoreFormState(app, saved);
    });
    check(await page.locator(".activity-limitation").getAttribute("open") !== null,
      "Disclosure survives existing redraw preservation");
  }
  if (kind === "loading" || kind === "error") check(!await page.getByText(
    "Your activity starts here", { exact: true }).count(), kind + " never claims empty history");
  if (kind === "busy") check(await page.locator(".activity-ledger .row-item").count() === 106,
    "All 106 records retain existing list behavior");
  if (kind === "solana") {
    const failed = page.locator('[data-key="sol-act-sample-failed"]');
    check((await failed.innerText()).includes("Failed on chain"),
      "Solana failed outcome stays failed");
    check(!await failed.locator(".money").getAttribute("aria-label").then((s) => s.startsWith(
      "+")), "Failed deposit has no incoming sign");
    check(await page.getByText("Public transfer", { exact: true }).count() === 2,
      "Deposit rows use public privacy cue");
    check(await page.getByText("Privacy in details", { exact: true }).count() === 1,
      "Proposal privacy is not inferred");
  }
  if (kind === "receipt") await receiptChecks();
}

async function receiptChecks() {
  const receipt = page.locator(".transaction-receipt");
  check((await receipt.innerText()).includes("Transaction submitted"),
    "Receipt submission is not confirmation");
  const address = "utest1" + "syntheticaddress".repeat(12), txid = "ab12".repeat(16);
  await page.getByRole("button", { name: "Copy recipient address", exact: true }).click();
  check(await page.evaluate(() => navigator.clipboard.readText()) === address,
    "Full recipient copied exactly");
  await page.getByRole("button", { name: "Copy transaction ID", exact: true }).click();
  check(await page.evaluate(() => navigator.clipboard.readText()) === txid,
    "Full transaction ID copied exactly");
  check((await receipt.innerText()).includes("0.2501"), "Receipt preserves amount including fee");
  await page.getByRole("button", { name: "Copy transaction ID",
    exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(out, "receipt-execution-390-light.png"),
    animations: "disabled" });
  screenshots.push("receipt-execution-390-light.png");
}

async function preferenceChecks() {
  await scene("populated");
  await page.setViewportSize({ width: 320, height: 844 });
  await page.addStyleTag({ content: (
    "#panel-activity{font-size:200%}#panel-activity "
    + ":is(.ri-title,.ri-sub,.money,.badge){font-size:1em}"
  ) });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    "320px enlarged text fits");
  check(await page.evaluate(() => document.getAnimations().every((a) => a.playState !==
    "running")), "Reduced motion has no running animation");
  await page.emulateMedia({ forcedColors: "active" });
  check(await page.locator(".activity-ledger").isVisible(),
    "Forced colors retains financial surface");
  await page.screenshot({ path: join(out, "stress-320-forced-colors.png"), fullPage: true });
  screenshots.push("stress-320-forced-colors.png");
  await page.emulateMedia({ forcedColors: "none", reducedMotion: "no-preference" });
  await scene("empty");
  check(await page.evaluate(() => document.getAnimations().every((a) => a.playState !==
    "running")), "No continuous idle animation");
  for (const status of ["stopped", "differs", "running"]) {
    await page.evaluate((status) => { globalThis.qaSol.setup = {
      status }; globalThis.qaActivityDraw(); }, status);
    check(await page.locator(".activity-limitation").isVisible(), status +
      " Solana limitation remains visible");
  }
  await page.evaluate(() => { globalThis.qaSol.setup = null; globalThis.qaActivityDraw(); });
  check(!await page.locator(".activity-filters").count(),
    "No Solana network filter without a Solana part");
  await page.evaluate(async () => {
    globalThis.qaSol.on = true;
    (await import("/app-sol.js")).qaSolModuleState(true, ""); globalThis.qaActivityDraw();
  });
  check(await page.getByRole("heading", { name: "Loading Solana activity",
    exact: true }).isVisible(), "Unloaded Solana module never claims empty history");
  await page.evaluate(async () => {
    (await import("/app-sol.js")).qaSolModuleState(true,
      "Synthetic module failure"); globalThis.qaActivityDraw();
  });
  check(await page.getByRole("heading", { name: "Solana history unavailable",
    exact: true }).isVisible(), "Solana module failure is not empty history");
  await page.evaluate(async () => {
    (await import("/app-chain.js")).curChain().error = "Synthetic Zcash sync failure";
    globalThis.qaActivityDraw();
  });
  check(await page.getByRole("heading", { name: "The sync failed", exact: true }).isVisible(),
    "Zcash sync failure remains visible alongside Solana module failure");
}

async function sceneMatrix(kind) {
  await scene(kind);
  for (const width of [1440, 1280, 768, 390]) {
    for (const theme of ["dark", "light"]) await capture(kind, width, theme);
  }
  if (phase === "after") await interactionChecks(kind);
}
try {
  for (const kind of ["empty", "populated", "filtered", "loading", "error", "solana", "busy",
    "receipt"])
    await sceneMatrix(kind);
  if (phase === "after") await preferenceChecks();
  check(!errors.length, "No uncaught browser errors");
} finally {
  await browser.close(); server.close();
  writeFileSync(join(out, "validation.json"), JSON.stringify({ phase, checks, errors,
    screenshots }, null, 2) + "\n");
}
console.log(JSON.stringify({ phase, checks: checks.length, errors,
  screenshots: screenshots.length }));
