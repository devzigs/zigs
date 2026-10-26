// Real presentation/controller, isolated synthetic app, no wallet boot or service requests.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { overviewFixture, settleOverview }
  from "../harness/overview-redesign-fixture.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const out = resolve(process.env.ZIGS_PRIVACY_CRAFT_OUTPUT || "solspike/.state/privacy-popup-craft");
mkdirSync(out, { recursive: true });
const checks = [], screens = [], layouts = [], errors = [];
const check = (ok, message) => { assert.ok(ok, message); checks.push(message); };
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });
const context = await browser.newContext({ reducedMotion: "reduce",
  viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
const page = await context.newPage();
page.setDefaultTimeout(5000);
page.on("pageerror", (error) => errors.push(error.message));
const popup = page.locator("#privacy-demo-popup"), status = page.locator("#privacy-demo-status");
const click = (name) => popup.getByRole("button", { name, exact: true }).click();
await page.addInitScript(() => {
  const interval = window.setInterval.bind(window);
  window.setInterval = (fn, ms, ...args) => ms === 60000 ? 0 : interval(fn, ms, ...args);
});

async function openStage(screen) {
  if (await popup.isVisible()) await click("Close privacy preview");
  await status.click();
  if (screen === "offer") return;
  await click("Preview private connection");
  if (screen === "connecting") return;
  await click("Continue");
  if (screen === "success") await click("Skip animation");
}

async function capture(name) {
  await page.screenshot({ path: resolve(out, name + ".png"), animations: "disabled" });
  screens.push(name + ".png");
}

async function inspect(label) {
  const facts = await popup.evaluate((dialog) => {
    const box = dialog.getBoundingClientRect();
    const visible = (node) => node.checkVisibility({ checkVisibilityCSS: true });
    const controls = [...dialog.querySelectorAll("button,summary")].filter(visible);
    const small = controls.filter((node) => {
      const r = node.getBoundingClientRect(); return r.width < 44 || r.height < 44;
    }).map((n) => n.textContent);
    const named = controls.every((n) => !!(n.getAttribute("aria-label") || n.textContent.trim()));
    return { width: box.width, top: box.top, bottom: box.bottom, height: innerHeight,
      overflow: dialog.scrollWidth > dialog.clientWidth + 1
        || document.documentElement.scrollWidth > innerWidth + 1,
      small, named, font: getComputedStyle(dialog).fontFamily,
      duplicateClose: dialog.querySelectorAll('.pp-close [data-icon="close"]').length !== 1,
      pseudoClose: getComputedStyle(dialog.querySelector(".pp-close"), "::before").content,
      note: dialog.querySelector("#pp-demo-note").textContent };
  });
  check(!facts.overflow, label + ": no horizontal overflow");
  check(facts.top >= -1 && facts.bottom <= facts.height + 1, label + ": dialog fits viewport");
  check(!facts.small.length && facts.named, label + ": named controls have 44 px targets");
  check(facts.font.includes("Geist"), label + ": matches the restored app typography");
  check(!facts.duplicateClose && facts.pseudoClose === "none", label + ": one shared close icon");
  check(facts.note.includes("No Tor connection is created; traffic stays direct"),
    label + ": direct connection remains explicit");
  check(!/protected|route is ready/i.test(await popup.innerText()),
    label + ": no false connected or protected state");
  layouts.push({ label, ...facts });
}

async function matrix() {
  const variants = [320, 390, 1440].flatMap((width) =>
    ["dark", "light"].map((theme) => ({ width, theme })));
  for (const { width, theme } of variants) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    for (const screen of ["offer", "connecting", "camouflage", "success"]) {
      await openStage(screen); await settleOverview(page);
      await inspect(screen + " " + width + " " + theme);
      if (width === 1440 || screen === "offer") await capture(screen + "-" + width + "-" + theme);
    }
  }
}

async function keyboardAndExit() {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openStage("offer");
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    check(await popup.evaluate((node) => node.contains(document.activeElement)),
      "keyboard focus remains inside the preview");
  }
  await page.keyboard.press("Escape");
  check(!await popup.isVisible(), "Escape closes immediately");
  check(await status.evaluate((n) => n === document.activeElement), "close restores opener focus");
  for (const screen of ["offer", "connecting", "camouflage", "success"]) {
    await openStage(screen); await click("Close privacy preview");
    check(!await popup.isVisible(), screen + ": X closes in one step");
    await openStage(screen); await page.keyboard.press("Escape");
    check(!await popup.isVisible(), screen + ": Escape closes in one step");
  }
  await openStage("offer"); await click("Not now");
  check(!await popup.isVisible(), "Not now dismisses without a second prompt");
  await openStage("offer"); await page.mouse.click(5, 5);
  check(!await popup.isVisible(), "backdrop dismisses without a second prompt");
}

async function constrainedDisplays() {
  await page.setViewportSize({ width: 320, height: 420 });
  await openStage("connecting"); await inspect("short mobile window");
  const button = popup.getByRole("button", { name: "Continue", exact: true });
  await button.focus();
  check(await button.evaluate((node) => {
    const r = node.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight;
  }), "focused action scrolls into view in a short window");
  await page.emulateMedia({ forcedColors: "active" });
  await openStage("offer"); await inspect("forced colors");
  await page.emulateMedia({ forcedColors: "none" });
}

async function motionReview() {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openStage("connecting");
  const started = Date.now();
  await popup.locator('[aria-current="step"]').waitFor();
  await page.waitForFunction(() => document.querySelector("#privacy-demo-popup")
    .dataset.screen === "camouflage", null, { timeout: 20000 });
  check(Date.now() - started >= 11500, "the existing four-step timing is preserved");
  check(await popup.locator(".pp-zebra-walk").evaluate((node) =>
    getComputedStyle(node).animationName === "pp-zebra-vanish"),
  "normal motion retains the illustrative camouflage sequence");
  await page.waitForFunction(() => document.querySelector("#privacy-demo-popup")
    .dataset.screen === "success", null, { timeout: 10000 });
  check(Date.now() - started >= 16500, "completion follows the complete camouflage sequence");
  check(await status.innerText() === "Tor · Preview",
    "completion never changes connection status");
  await openStage("connecting"); await click("Close privacy preview");
  await page.waitForTimeout(3100);
  check(!await popup.isVisible(), "a cancelled timer cannot reopen the preview");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openStage("camouflage");
  check(await popup.evaluate((node) => [node, ...node.querySelectorAll("*")]
    .every((n) => getComputedStyle(n).animationName === "none")),
  "reduced motion removes shell, scene, icon and decorative animation");
  await page.waitForFunction(() => document.querySelector("#privacy-demo-popup")
    .dataset.screen === "success");
  check(await status.innerText() === "Tor · Preview", "reduced motion also preserves status");
}

try {
  await overviewFixture(context, page, { messaging: true });
  await page.evaluate(async () => {
    const { state, ui } = await import("/app-state.js");
    state.g = null; state.gid = null; state.groups = []; ui.tab = "overview";
    (await import("/app-loop.js")).draw();
  });
  check(!await popup.isVisible(), "the preview stays optional on arrival");
  const before = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  await status.click();
  check(await popup.getByRole("heading", { name: "Make your connection private.", exact: true })
    .isVisible(), "the earlier benefit-led headline is restored");
  await matrix(); await keyboardAndExit(); await constrainedDisplays(); await motionReview();
  check(before === await page.evaluate(() => JSON.stringify({ ...localStorage })),
    "all preview flows leave browser storage unchanged");
  check(!errors.length, "no browser errors: " + errors.join("; "));
  console.log("Privacy popup craft: " + checks.length + " checks; " + layouts.length + " layouts");
} finally {
  await browser.close();
  writeFileSync(resolve(out, "report.json"), JSON.stringify({ checks, layouts, screens, errors,
    scope: "Real UI; synthetic display; external requests blocked; no wallet operations" },
  null, 2));
}
