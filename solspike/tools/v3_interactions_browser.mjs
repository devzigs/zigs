// Real shell interactions in empty isolated stores. No authentication or wallet action is run.
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const phase = process.env.ZIGS_PREMIUM_PHASE || "after";
assert.ok(["before", "after"].includes(phase));
const origin = "http://localhost:" + (phase === "before" ? "8795" : "8794");
const directory = resolve("docs/ux-redesign/visuals/web-v3", phase);
mkdirSync(directory, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });
const report = { phase, browser: browser.version(), viewport: { width: 390, height: 844 },
  context: "Isolated empty store; real shell menu and scrolling; no wallet work", trials: [] };

async function measure() {
  const tasks = [], shifts = [], frames = [], feedback = [];
  const long = new PerformanceObserver((list) => tasks.push(...list.getEntries()
    .map((e) => e.duration)));
  const layout = new PerformanceObserver((list) => shifts.push(...list.getEntries()
    .filter((e) => !e.hadRecentInput).map((e) => e.value)));
  long.observe({ type: "longtask" }); layout.observe({ type: "layout-shift" });
  let last;
  for (let i = 0; i < 180; i++) {
    const now = await new Promise((done) => requestAnimationFrame(done));
    if (last !== undefined) frames.push(now - last);
    last = now;
    if ([15, 45, 75, 105, 135, 165].includes(i)) {
      const button = document.getElementById("wallet-menu"), start = performance.now();
      button.click();
      await new Promise((done) => requestAnimationFrame(done));
      feedback.push(performance.now() - start);
    }
    const nav = document.getElementById("side-nav");
    if (document.querySelector(".side.menu-open")) nav.scrollTop += i % 2 ? 8 : -4;
  }
  long.disconnect(); layout.disconnect();
  return { frames: frames.length, within20ms: frames.filter((n) => n <= 20).length / frames.length,
    maxFrameMs: Math.max(...frames), feedbackMs: feedback, longTasksMs: tasks,
    layoutShift: shifts.reduce((a, b) => a + b, 0),
    idleDecorativeLoops: document.getAnimations().filter((a) =>
      a.effect?.getTiming().iterations === Infinity).length };
}

async function trial(index) {
  const context = await browser.newContext({ viewport: report.viewport, colorScheme: "light",
    reducedMotion: "no-preference", recordVideo: { dir: join(directory, ".interaction-video"),
      size: report.viewport } });
  await context.route("**/*", (route) => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto(origin);
  await page.waitForFunction(async () => !!(await import("/app-engine.js")).Z);
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const result = await page.evaluate(measure);
  report.trials.push(result);
  if (phase === "after") {
    assert.ok(result.within20ms >= .95, "95% of interaction frames within20ms");
    assert.ok(result.longTasksMs.every((n) => n <= 50), "No interaction task above50ms");
    assert.ok(result.feedbackMs.every((n) => n <= 100), "Local feedback within100ms");
    assert.equal(result.idleDecorativeLoops, 0);
  }
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.screenshot({ path: join(directory, "52-real-menu-" + index + ".png") });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.getElementById("wallet-menu")
    .getAttribute("aria-expanded") === "false");
  assert.equal(await page.locator("#wallet-menu").getAttribute("aria-expanded"), "false");
  assert.equal(await page.evaluate(() => document.activeElement.id), "wallet-menu");
  const video = page.video();
  await context.close();
  copyFileSync(await video.path(), join(directory, "52-shell-interactions-" + index + ".webm"));
}

try {
  for (let i = 0; i < 3; i++) await trial(i);
} finally {
  await browser.close();
  writeFileSync("docs/ux-redesign/web-v3-" + phase + "-interaction-validation.json",
    JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify(report));
