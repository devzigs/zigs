// Browser-level zoom and modal focus checks. Disposable profiles, synthetic renderers only.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { overviewFixture, settleOverview } from "../harness/overview-redesign-fixture.mjs";

const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const output = resolve("docs/ux-redesign/visuals/finalpass",
  process.env.ZIGS_AUDIT_PHASE || "after", "accessibility");
const checks = [], measurements = [], errors = [];
mkdirSync(output, { recursive: true });
const check = (pass, label) => { assert.ok(pass, label); checks.push(label); };

async function keyboard(type, name) {
  const browser = await type.launch({ headless: true,
    ...(name === "Chrome" ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await overviewFixture(context, page);
  await page.evaluate(async () => {
    (await import("/app-state.js")).ui.restore = {
      name: "Synthetic recovery file", text: "", busy: false };
    (await import("/app-loop.js")).draw();
  });
  await page.locator("#rs-pass").focus();
  await page.keyboard.press("Tab");
  check(await page.getByRole("button", { name: "Cancel", exact: true })
    .evaluate((node) => node === document.activeElement),
  name + ": Tab from passphrase reaches Cancel, with disabled submit skipped");
  for (const key of ["Tab", "Shift+Tab"]) await tabLoop(page, name, key);
  await page.screenshot({ path: resolve(output, name + "-modal-focus.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  check(true, name + ": Escape dismisses the existing recovery dialog");
  await browser.close();
}

async function tabLoop(page, name, key) {
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press(key);
    check(await page.evaluate(() => !!document.activeElement.closest(".dialog")),
      name + ": recovery dialog contains " + key + " step " + i);
  }
}

async function zoom() {
  const profile = resolve("solspike/.state/finalpass/zoom-settings-profile");
  const context = await chromium.launchPersistentContext(profile, { headless: true,
    executablePath: process.env.CHROME_EXECUTABLE, viewport: null,
    reducedMotion: "reduce", args: ["--window-size=1440,1000"] });
  try {
    const settings = await context.newPage();
    await settings.goto("chrome://settings/appearance");
    await settings.locator("#zoomLevel").selectOption({ label: "200%" });
    await settings.close();
    const page = await context.newPage();
    await overviewFixture(context, page);
    const facts = await page.evaluate(() => ({ innerWidth, outerWidth, devicePixelRatio }));
    check(Math.abs(facts.devicePixelRatio - 2) < .05,
      "Chrome settings apply real 200% browser zoom (devicePixelRatio = 2)");
    for (const id of ["overview", "activity", "recovery", "settings"])
      await zoomRoute(page, id, facts);
  } finally { await context.close(); }
}

async function zoomRoute(page, id, facts) {
  const menu = page.locator("#wallet-menu");
  if (await menu.isVisible() && await menu.getAttribute("aria-expanded") !== "true")
    await menu.click();
  await page.locator("#tab-" + id).click();
  await settleOverview(page);
  const value = await page.evaluate(() => ({ width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth }));
  check(value.scrollWidth <= value.width + 1, id + ": no overflow at real 200% zoom");
  measurements.push({ route: id, ...facts, ...value });
  await page.screenshot({ path: resolve(output, "zoom-200-" + id + ".png"),
    fullPage: true, mask: [page.locator(".qr-toggle,.addr-full,.log")] });
}

async function enlargedSetup() {
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.CHROME_EXECUTABLE });
  const context = await browser.newContext({ reducedMotion: "reduce" });
  await context.route("**/*", (route) => new URL(route.request().url()).origin
    === "http://localhost:8872" ? route.continue() : route.abort());
  for (const width of [320, 390, 768, 1024, 1440])
    for (const theme of ["light", "dark"]) await enlargedSetupCase(context, width, theme);
  await context.close(); await browser.close();
}

async function enlargedSetupCase(context, width, theme) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height: width < 600 ? 1000 : 900 });
  await page.goto("http://localhost:8872");
  await page.waitForFunction(async () => !!(await import("/app-engine.js")).Z
    && (await import("/app-groups.js")).dbReady);
  await page.getByRole("button", { name: "Create wallet", exact: true }).click();
  await settleOverview(page);
  const rules = await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
    const selectors = [".guided-plan>.card-head h2", ".guided-plan .guide-step>h3",
      ".guided-plan .btn", ".guided-plan .small", ".guided-plan .dialog-actions .off-why"];
    return selectors.map((selector) => {
      const node = document.querySelector(selector);
      return node ? selector + "{font-size:"
        + parseFloat(getComputedStyle(node).fontSize) * 2 + "px!important}" : "";
    }).join("\n");
  }, theme);
  const url = "http://localhost:8872/__finalpass-text.css";
  await page.route(url, (route) => route.fulfill({ contentType: "text/css", body: rules }));
  await page.addStyleTag({ url });
  await settleOverview(page);
  const facts = await page.evaluate(() => {
    const title = document.querySelector(".guided-plan>.card-head h2");
    const progress = document.querySelector(".setup-plan-progress");
    return { headingBottom: title.getBoundingClientRect().bottom,
      progressTop: progress.getBoundingClientRect().top,
      fontSize: parseFloat(getComputedStyle(title).fontSize) };
  });
  console.log("Enlarged setup " + width + " " + theme + ": " + JSON.stringify(facts));
  check(facts.fontSize >= 39 && facts.headingBottom <= facts.progressTop,
    width + " " + theme + ": doubled setup heading never overlaps progress");
  const action = page.getByRole("button", { name: "Protect this browser", exact: true });
  await action.scrollIntoViewIfNeeded(); await action.focus();
  check(await action.evaluate((node) => node.getBoundingClientRect().bottom
    <= node.closest(".dialog").querySelector(".dialog-actions").getBoundingClientRect().top + 1),
  width + " " + theme + ": enlarged protection action is reachable above the action bar");
  await page.screenshot({ path: resolve(output,
    "setup-text-200-" + width + "-" + theme + ".png") });
  measurements.push({ kind: "setup text-only 200%", width, theme, ...facts });
  await page.close();
}

try {
  await keyboard(chromium, "Chrome");
  await keyboard(webkit, "WebKit");
  await zoom();
  await enlargedSetup();
  check(errors.length === 0, "no uncaught browser errors");
} finally {
  writeFileSync(resolve(output, "validation.json"), JSON.stringify({ checks, measurements,
    errors }, null, 2) + "\n");
  console.log(JSON.stringify({ checks: checks.length, measurements, errors }));
}
