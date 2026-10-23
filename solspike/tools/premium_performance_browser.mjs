// Opt-in local comparison fixture. Source frames are sanitized by premium-records.mjs.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, copyFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { gzipSync } from "node:zlib";
import { installGallery, measureGallery, verifyMotion } from "../harness/premium-performance.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const phase = process.env.ZIGS_PREMIUM_PHASE || "after", after = phase === "after";
const evidence = process.env.ZIGS_PREMIUM_EVIDENCE || "web-premium";
assert.ok(["before", "after"].includes(phase));
assert.ok(["web-premium", "web-art-direction", "web-v3"].includes(evidence));
const origin = "http://localhost:" + (after ? "8794" : "8795");
const directory = process.env.ZIGS_PREMIUM_FRAMES_DIR;
assert.ok(directory && directory.startsWith("/"), "Absolute sanitized frame directory required");
const frames = Object.fromEntries(["welcome", "overview", "review"]
  .map((scene) => [scene, readFileSync(join(directory, scene + ".html"), "utf8")]));
const out = "docs/ux-redesign/visuals/" + evidence + "/" + phase;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });
const report = { phase, browser: browser.version(), hardware: "Apple M3 Max (Mac15,8)",
  renderer: "Headless Chromium on local desktop; mobile viewport emulation",
  fixture: "Sanitized actual welcome, populated wallet and blocked-review renderers",
  calibration: "Both phases warm actual fonts/images in all three views, then reset the "
    + "presentation controller and observers. First-load costs are reported separately.",
  trials: [], recordings: [], motion: {}, qr: [], scripts: {}, issues: [] };
const restricted = (context) => context.route("**/*", (route) => {
  const url = new URL(route.request().url());
  return ["localhost", "127.0.0.1"].includes(url.hostname) ? route.continue() : route.abort();
});

async function gallery(width, record) {
  const context = await browser.newContext({ viewport: { width, height: 900 },
    reducedMotion: "no-preference", colorScheme: "dark",
    ...(record ? { recordVideo: { dir: resolve(out, ".temporary-video"),
      size: { width, height: 900 } } } : {}) });
  await restricted(context);
  const page = await context.newPage();
  const html = '<!doctype html><html data-theme="dark"><head><base href="' + origin
    + '"><link rel="stylesheet" href="/design-system.css">'
    + '<link rel="stylesheet" href="/app.css"><style>'
    + '.sample-banner{padding:12px 20px;background:var(--panel);'
    + 'border-bottom:1px solid var(--line)}'
    + '.sample-banner details{display:none}.drawer{position:relative;inset:auto;transform:none;'
    + 'margin:24px auto;width:min(620px,calc(100% - 32px));height:auto;max-height:none}'
    + '.scrim{display:none}</style></head><body></body></html>';
  await page.route("**/__premium_gallery__", (route) => route.fulfill({
    status: 200, contentType: "text/html", body: html }));
  await page.goto(origin + "/__premium_gallery__");
  await page.waitForFunction(() => document.styleSheets.length >= 3);
  await page.evaluate(installGallery, { origin, frames,
    after: after || evidence === "web-art-direction" });
  return { context, page };
}

async function trial(width, index) {
  const record = index === 0, { context, page } = await gallery(width, record);
  const errors = []; page.on("pageerror", (e) => errors.push(e.name));
  const result = await page.evaluate(measureGallery);
  report.trials.push({ width, index, ...result, errors });
  if (after) {
    assert.ok(result.within20ms >= .95, "95% of presentation frames within20ms");
    assert.equal(result.longTasks.length, 0, "No added presentation long task");
    assert.equal(result.layoutShift, 0, "No decorative layout shift");
    assert.equal(result.decorativeLoops, 0, "No perpetual decorative loop");
    const motion = await page.evaluate(verifyMotion);
    assert.ok(Object.values(motion).every(Boolean), JSON.stringify(motion));
    report.motion = motion;
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  }
  const video = page.video();
  await context.close();
  if (record) {
    const name = "46-presentation-" + width + ".webm";
    copyFileSync(await video.path(), join(out, name)); report.recordings.push(name);
  }
}

async function initialScripts() {
  const context = await browser.newContext(); await restricted(context);
  const page = await context.newPage(), promises = [], scripts = new Map();
  page.on("response", (response) => {
    if (response.request().resourceType() !== "script" || response.status() !== 200) return;
    promises.push(response.body().then((body) => scripts.set(new URL(response.url()).pathname,
      gzipSync(body).length)));
  });
  await page.goto(origin); await page.locator(".welcome").waitFor();
  await page.waitForFunction(async () => !!(await import("/app-engine.js")).Z);
  await Promise.all(promises);
  report.scripts = { count: scripts.size,
    gzipBytes: [...scripts.values()].reduce((sum, n) => sum + n, 0) };
  await context.close();
}

async function qrFixtures() {
  const context = await browser.newContext(); await restricted(context);
  const page = await context.newPage();
  await page.goto(origin); await page.locator(".welcome").waitFor();
  for (const theme of ["dark", "light"]) {
    await page.evaluate(async (value) => {
      document.documentElement.dataset.theme = value;
      const { qrSvg } = await import("/qr.js");
      const frame = document.createElement("section"); frame.className = "qr";
      frame.innerHTML = qrSvg("zigs-ui-safe-rendered-qr-fixture", "Safe QR fixture");
      document.body.replaceChildren(frame);
    }, theme);
    const svg = page.locator(".qr svg");
    const geometry = await svg.evaluate((n) => ({ width: n.getBoundingClientRect().width,
      height: n.getBoundingClientRect().height, viewBox: n.getAttribute("viewBox"),
      animations: n.getAnimations({ subtree: true }).length,
      backing: n.querySelector("rect").getAttribute("fill") }));
    assert.equal(geometry.animations, 0); assert.equal(geometry.backing, "#fff");
    await svg.screenshot({ path: join(directory, "qr-" + theme + ".png") });
    report.qr.push({ theme, ...geometry });
  }
  await context.close();
}

try {
  for (const width of [390, 1440]) for (const index of [0, 1, 2]) await trial(width, index);
  await initialScripts(); await qrFixtures();
} finally {
  await browser.close();
  writeFileSync("docs/ux-redesign/" + evidence + "-" + phase + "-performance.json",
    JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify({ phase, trials: report.trials.length, issues: report.issues }));
