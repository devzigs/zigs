// Production wallet presentation, synthetic public identities, no backend or signing.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = process.env.ZIGS_MARBLE_OUTPUT
  || resolve(root, "docs/ux-redesign/visuals/marble-animation");
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const preview = process.argv.includes("--preview");
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    const file = resolve(root, "web", path === "/" ? "index.html" : path.slice(1));
    if (!file.startsWith(resolve(root, "web") + "/")) throw Error("Invalid path");
    let body = await readFile(file);
    if (file.endsWith("/index.html")) body = body.toString()
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
      .replace(/<link[^>]+rel="(?:modulepreload|preload)"[^>]*>/g, "")
      + `<script type="module">(${fixture.toString()})()</script>`;
    if (path === "/app-loop.js") body = body.toString()
      .replace("export function render() {", "export function render() { return;");
    if (path === "/app-wallet.js") body += "\nexport { groupHead };";
    res.writeHead(200, { "Content-Type": types[extname(file)] || "text/plain" }).end(body);
  } catch { res.writeHead(404).end(); }
});

async function fixture() {
  const { state, ui, ready } = await import("/app-state.js");
  const { el } = await import("/app-dom.js");
  const { icon } = await import("/app-icons.js");
  const { setChain } = await import("/app-chain.js");
  const { setMe } = await import("/app-groups.js");
  const { setSecrets } = await import("/app-keystore.js");
  const { groupHead, walletView } = await import("/app-wallet.js");
  const { presentWalletMarble } = await import("/wallet-marble.js");
  const { walletReveal, presentWalletReveal } = await import("/app-wallet-art.js");
  const { FLOW_FIXTURES } = await import("/dev/metal-orbs/flow-fixtures.js");
  const fixtures = Object.values(FLOW_FIXTURES);
  const groups = fixtures.map((f, i) => ({ id: f.id, version: 1, network: "testnet",
    name: ["Treasury Wallet", "Travel fund", "Ember reserve"][i], n: 2, t: 2 }));
  const wallets = fixtures.map((f) => ({ birthday: 1, network: "testnet",
    address: f.zcash.address, orchard_fvk: "synthetic-non-signing-display-fixture" }));
  setMe("fixture-local");
  setSecrets(Object.fromEntries(groups.map((g, i) => [g.id + ":1", {
    uid: "fixture-local", keyPackage: "synthetic-share",
    checkedWallet: JSON.stringify(wallets[i]),
  }])));
  groups.forEach((g, i) => { ready[g.id] = wallets[i]; });
  const sidebar = document.getElementById("side-nav");
  sidebar.replaceChildren(...[["overview", "Overview", "home"],
    ["approvals", "Approvals", "approvals"], ["activity", "Activity", "activity"],
    ["recovery", "Security", "security"], ["settings", "Settings", "settings"]]
    .map(([id, title, mark]) => el("button", { type: "button",
      class: "side-item" + (id === "overview" ? " active" : ""), onclick: () => {
        ui.tab = id; draw();
      } }, icon(mark), el("span", { class: "side-label" }, title))));
  let showingReveal = false, backupOptions = 0;
  function draw() {
    const app = document.getElementById("app");
    app.replaceChildren(showingReveal
      ? el("div", { class: "page guided-setup wallet-reveal-page" }, walletReveal(state.g, () => {
        backupOptions++; showingReveal = false; draw();
      }))
      : el("div", { class: "page wallet-page" },
        groupHead(state.g, true, null), walletView([], null)));
    presentWalletMarble(document);
    presentWalletReveal(document);
    // Fixture-only wallet selection; the production picker retains its normal callback.
    for (const row of app.querySelectorAll(".wallet-picker-row")) {
      row.onclick = (ev) => { ev.stopImmediatePropagation();
        select(groups.findIndex((g) => g.name === row.dataset.name)); };
      row.addEventListener("click", row.onclick, { capture: true, once: true });
    }
  }
  function select(index) {
    showingReveal = false;
    Object.assign(state, { g: groups[index], gid: groups[index].id, groups,
      wallet: wallets[index], seats: { 1: { uid: "fixture-local", name: "This browser" },
        2: { uid: "fixture-other", name: "Recovery device" } },
      seatsLoaded: true, seatsSettled: true, sessionsLoaded: true, sessions: [],
      dkg1: {}, dkg2: {}, confirm: {}, abort: {}, done: {}, verify: {} });
    ui.tab = "overview";
    setChain({ gid: state.gid, cw: {}, bal: null, sent: new Set(),
      syncing: true, balAt: Date.now() }); draw();
  }
  function showReveal(index = 0) { select(index); showingReveal = true; draw(); }
  window.marbleFixture = { draw, select, showReveal, groups, wallets,
    get backupOptions() { return backupOptions; } };
  document.documentElement.dataset.theme = "dark";
  document.getElementById("engine-text").textContent = "Synthetic preview · no funds or signing";
  document.getElementById("engine-dot").className = "dot";
  if (new URL(location.href).searchParams.has("reveal")) showReveal(2);
  else select(0);
}

await new Promise((ok) => server.listen(preview ? 8798 : 0, "127.0.0.1", ok));
const origin = "http://127.0.0.1:" + server.address().port;
if (preview) console.log("Marble animation preview: " + origin);
else {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.CHROME_EXECUTABLE });
  try { await run(browser); } finally { await browser.close(); server.close(); }
}

async function run(browser) {
  await mkdir(output, { recursive: true });
  const context = await browser.newContext({ reducedMotion: "no-preference",
    viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  await context.route("**/*", (r) => new URL(r.request().url()).origin === origin
    ? r.continue() : r.abort());
  const page = await context.newPage(), errors = [], checks = [];
  page.on("pageerror", (e) => {
    errors.push(e.message); console.error("Page error: " + e.message);
  });
  const check = (ok, label) => { assert.ok(ok, label); checks.push(label); };
  await page.goto(origin);
  await page.waitForSelector(".wallet-marble-live canvas", { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  const marble = page.locator(".wallet-marble"), canvas = marble.locator("canvas");
  const pixels = () => canvas.evaluate((n) => n.toDataURL());
  check(await page.locator(".wallet-marble").count() === 1, "one live header marble");
  check(await marble.locator("img").getAttribute("data-art-digest")
    === await page.locator(".overview-wallet-summary img").getAttribute("data-art-digest"),
  "header and balance use the same verified address identity");
  const before = await pixels(); await page.waitForTimeout(900);
  check(before !== await pixels(), "real 3D pixels change while the header stays in place");
  await checkContinuity(page, check, pixels);
  await checkMotion(page, check, pixels);
  await capture(page, check);
  await checkSwitching(page, check);
  await checkSculptures(page, check);
  await checkReveal(page, check);
  await checkFallback(page, check, context);
  check(errors.length === 0, "no browser page errors");
  await writeFile(resolve(output, "validation.json"), JSON.stringify({ checks,
    pageErrors: errors,
    limitation: "Synthetic public display fixtures in Chromium; no live wallet or signing.",
  }, null, 2) + "\n");
  console.log(JSON.stringify({ passed: checks.length, output }));
  await context.close();
}

async function checkContinuity(page, check, pixels) {
  await page.evaluate(() => {
    window.originalMarbleCanvas = document.querySelector(".wallet-marble canvas");
    window.marbleFixture.draw(); });
  await page.waitForTimeout(180);
  check(await page.evaluate(() => document.querySelector(".wallet-marble canvas")
    === window.originalMarbleCanvas), "ordinary DOM redraw reuses the original canvas");
  const before = await pixels(); await page.waitForTimeout(180);
  check(before !== await pixels(), "rotation continues after a DOM redraw");
  await page.locator(".wallet-marble").focus(); await page.keyboard.press("Space");
  check(await page.locator(".wallet-marble").getAttribute("aria-label")
    === "Play wallet marble animation", "keyboard can pause the animation");
  const stopped = await pixels(); await page.waitForTimeout(250);
  check(stopped === await pixels(), "pause stops rendering at the current 3D orientation");
  await page.evaluate(() => window.marbleFixture.draw()); await page.waitForTimeout(120);
  check(stopped === await pixels(), "pause survives ordinary DOM redraws");
  await page.locator(".wallet-marble").click(); await page.waitForTimeout(180);
  check(stopped !== await pixels(), "resume continues the sculpture rotation");
}

async function checkMotion(page, check, pixels) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => document.querySelector(".wallet-marble").disabled);
  const settled = await pixels(); await page.waitForTimeout(200);
  check(settled === await pixels(), "reduced motion freezes the sculpture without a loop");
  check(await page.locator(".wallet-marble").isDisabled(),
    "reduced motion has no active play control");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => {
    window.fixtureHidden = true;
    Object.defineProperty(document, "hidden", { configurable: true,
      get: () => window.fixtureHidden });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hidden = await pixels(); await page.waitForTimeout(200);
  check(hidden === await pixels(), "hidden-document lifecycle stops rendering");
  await page.evaluate(() => { window.fixtureHidden = false;
    document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForTimeout(150);
  check(hidden !== await pixels(), "returning to the visible page resumes rotation");
  await page.evaluate(() => {
    document.querySelector(".wallet-marble").style.marginTop = "1600px";
  });
  await page.waitForTimeout(150);
  const outside = await pixels(); await page.waitForTimeout(200);
  check(outside === await pixels(), "offscreen marble stops rendering");
  await page.evaluate(() => { document.querySelector(".wallet-marble").style.marginTop = ""; });
  await page.waitForTimeout(150);
  check(outside !== await pixels(), "returning into the viewport resumes rotation");
  await page.evaluate(async () => {
    document.querySelector(".wallet-page,.wallet-reveal-page").inert = true;
    (await import("/wallet-marble.js")).presentWalletMarble(document);
  });
  const covered = await pixels(); await page.waitForTimeout(150);
  check(covered === await pixels(), "modal background stops rendering");
  await page.evaluate(async () => {
    document.querySelector(".wallet-page,.wallet-reveal-page").inert = false;
    (await import("/wallet-marble.js")).presentWalletMarble(document);
  });
  await page.waitForTimeout(150);
  check(covered !== await pixels(), "closing a modal resumes the same sculpture");
}

async function capture(page, check) {
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 600 ? 900 : 1000 });
    for (const theme of ["dark", "light"]) {
      await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
      await page.waitForTimeout(100);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        "no horizontal overflow at " + width + " / " + theme);
      check(await page.locator(".wallet-marble").evaluate((n) => {
        const b = n.getBoundingClientRect(); return b.width >= 44 && b.height >= 44;
      }), "comfortable marble control at " + width + " / " + theme);
      await page.screenshot({ path: resolve(output, `overview-${width}-${theme}.png`) });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.locator(".wallet-topbar").screenshot({ path: resolve(output, "header.png") });
}

async function checkSwitching(page, check) {
  const first = await page.locator(".wallet-marble img").getAttribute("data-art-digest");
  if (await page.locator(".wallet-picker-trigger").count()) {
    await page.locator(".wallet-picker-trigger").click();
    await page.getByRole("menuitemradio", { name: /Travel fund/ }).click();
  } else await page.evaluate(() => window.marbleFixture.select(1));
  await page.waitForSelector(".wallet-marble-live canvas");
  check(await page.locator(".wallet-marble img").getAttribute("data-art-digest") !== first,
    "wallet switching chooses that wallet's unique sculpture");
  await page.evaluate(() => window.marbleFixture.select(2));
  await page.waitForSelector(".wallet-marble-live canvas");
  await page.locator(".wallet-topbar").screenshot({ path: resolve(output, "ember-header.png") });
  check(await page.locator(".wallet-marble").evaluate((n) =>
    n._walletMarbleEntry.descriptor.traits.rare), "Ember identity keeps its seeded metal inlay");
  await page.evaluate(() => { document.getElementById("app").replaceChildren();
    import("/wallet-marble.js").then((m) => m.presentWalletMarble(document)); });
  check(await page.locator(".wallet-marble canvas").count() === 0,
    "leaving the wallet removes the live scene");
  await page.evaluate(() => window.marbleFixture.select(0));
  await page.waitForSelector(".wallet-marble-live canvas");
}

async function checkSculptures(page, check) {
  const result = await page.evaluate(async () => {
    const { createStudio } = await import("/dev/metal-orbs/renderer.js");
    const { describeOrb } = await import("/dev/metal-orbs/identity.js");
    const { FIXTURES } = await import("/dev/metal-orbs/fixtures.js");
    const studio = createStudio({ size: 96 }), seen = new Set(), turns = [];
    try {
      for (const f of FIXTURES) {
        const p = await describeOrb(f.chain, f.address);
        if (seen.has(p.family)) continue;
        seen.add(p.family); studio.setSculpture(p); studio.draw();
        const rest = studio.canvas.toDataURL();
        studio.draw(Math.PI * .6, .04);
        turns.push(rest !== studio.canvas.toDataURL());
        const png = studio.render(p);
        turns.push(png.startsWith("data:image/png"));
      }
    } finally { studio.dispose(); }
    return { families: seen.size, turns };
  });
  check(result.families === 6 && result.turns.every(Boolean),
    "all six sculpture families rotate and retain the static PNG renderer");
}

async function checkReveal(page, check) {
  const digest = await page.locator(".wallet-marble img").getAttribute("data-art-digest");
  await page.evaluate(() => window.marbleFixture.showReveal());
  await page.waitForSelector(".wallet-reveal .wallet-marble-live canvas");
  const marble = page.locator(".wallet-reveal .wallet-marble"), canvas = marble.locator("canvas");
  const pixels = () => canvas.evaluate((n) => n.toDataURL());
  check(await marble.locator("img").getAttribute("data-art-digest") === digest,
    "reveal and header use the same verified wallet identity");
  check(await canvas.evaluate((n) => n.width === 384 && n.height === 384),
    "large reveal renders sharply at twice its display size");
  check(await marble.evaluate((n) => !n.closest('[aria-hidden="true"]')),
    "reveal pause control is exposed to assistive technology");
  check(await page.getByRole("button", { name: "Continue to backup options" }).isEnabled(),
    "backup continuation is available during the decorative introduction");
  await page.waitForTimeout(6200);
  const before = await pixels(); await page.waitForTimeout(250);
  check(before !== await pixels(), "reveal continues spinning after its introduction completes");
  const revealCheck = (ok, label) => check(ok, "reveal: " + label);
  await checkContinuity(page, revealCheck, pixels);
  await checkMotion(page, revealCheck, pixels);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        "reveal has no horizontal overflow at " + width + " / " + theme);
      await page.screenshot({ path: resolve(output, `reveal-${width}-${theme}.png`),
        fullPage: true });
    }
  }
  await page.emulateMedia({ forcedColors: "active" });
  await page.waitForFunction(() => document.querySelector(".wallet-marble")?.disabled);
  check(await marble.isDisabled() && await canvas.isHidden(),
    "forced colors disables reveal motion and hides the canvas");
  check(await marble.locator("img").isVisible(),
    "forced colors keeps the reveal's static wallet identity visible");
  await page.emulateMedia({ forcedColors: "none" });
  await page.getByRole("button", { name: "Continue to backup options" }).click();
  check(await page.evaluate(() => window.marbleFixture.backupOptions === 1),
    "Continue calls the existing backup-options callback once");
  await page.waitForSelector(".wallet-topbar .wallet-marble-live canvas");
  check(await page.locator(".wallet-marble").count() === 1,
    "leaving the reveal reuses one controller for the compact header");
  await page.setViewportSize({ width: 1440, height: 1000 });
}

async function checkFallback(page, check, context) {
  await page.locator(".wallet-marble canvas").evaluate((n) =>
    n.getContext("webgl2").getExtension("WEBGL_lose_context").loseContext());
  await page.waitForTimeout(150);
  check(await page.locator(".wallet-marble canvas").count() === 0
    && await page.locator(".wallet-marble img").isVisible(),
  "context loss restores static artwork");
  const fallback = await context.newPage();
  await fallback.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      return kind.startsWith("webgl") ? null : original.call(this, kind, ...args);
    };
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (name, ...args) => {
      if (name === "zigs-metal-orb-preview-v1")
        throw new DOMException("Synthetic image-cache refusal", "SecurityError");
      return open(name, ...args);
    };
  });
  await fallback.goto(origin);
  await fallback.waitForFunction(() => document.querySelector(".wallet-marble img")
    ?.dataset.artState === "svg");
  check(await fallback.locator(".wallet-marble").isDisabled(), "no WebGL keeps a static marble");
  check(await fallback.locator(".overview-hero").isVisible(),
    "no WebGL leaves the wallet controls and content available");
  await fallback.screenshot({ path: resolve(output, "svg-fallback.png") });
  await fallback.goto(origin + "?reveal");
  await fallback.waitForFunction(() => document.querySelector(".wallet-reveal .wallet-art")
    ?.dataset.artState === "svg");
  check(await fallback.locator(".wallet-reveal .wallet-marble").isDisabled(),
    "reveal keeps its static identity when WebGL is unavailable");
  check(await fallback.getByRole("button", { name: "Continue to backup options" }).isEnabled(),
    "unavailable WebGL never blocks backup continuation");
  await fallback.close();
  await page.evaluate(async () => {
    const { state } = await import("/app-state.js");
    state.wallet = { ...state.wallet, address: "utest1unverifiedfixture" };
    window.marbleFixture.draw();
  });
  check(await page.locator(".wallet-marble").isDisabled()
    && await page.locator(".wallet-marble canvas").count() === 0,
  "unverified address never receives an invented wallet identity");
}
