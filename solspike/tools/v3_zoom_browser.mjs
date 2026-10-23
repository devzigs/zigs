// Genuine browser zoom in a newly created test profile; never edits a user profile.
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import assert from "node:assert/strict";
import { layout, SAMPLE_ROUTES, settled } from "../harness/premium-visuals.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const phase = process.env.ZIGS_PREMIUM_PHASE || "after";
assert.ok(["before", "after"].includes(phase));
const directory = process.env.ZIGS_PREMIUM_SAMPLE_DIR;
assert.ok(directory && isAbsolute(directory), "Absolute synthetic sample directory required");
const origin = "http://localhost:" + (phase === "before" ? "8795" : "8794");
const out = "docs/ux-redesign/visuals/web-v3/" + phase;
mkdirSync(out, { recursive: true });
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "zigs-v3-zoom-")),
  { headless: true, executablePath: process.env.CHROME_EXECUTABLE,
    viewport: { width: 1440, height: 900 } });
const checks = [], screens = [], measurements = [];
const qa = { check(ok, label) { checks.push({ label, pass: !!ok }); },
  async capture(page, name) {
    await page.screenshot({ path: join(out, name), fullPage: true, animations: "disabled" });
    screens.push(name);
  } };

async function route(request) {
  const url = new URL(request.request().url());
  if (url.pathname.startsWith("/__zoom__/")) {
    const id = url.pathname.split("/").pop().replace(/\.html$/, "");
    assert.ok(SAMPLE_ROUTES.includes(id));
    return request.fulfill({ contentType: "text/html",
      body: readFileSync(join(directory, id + ".html")) });
  }
  if (url.pathname === "/sample.css") return request.fulfill({ contentType: "text/css",
    body: readFileSync(join(directory, "sample.css")) });
  return url.origin === origin ? request.continue() : request.abort();
}

async function screen(page, id, width, theme) {
  await page.setViewportSize({ width, height: 1600 });
  await page.goto(origin + "/__zoom__/" + id + ".html");
  await page.evaluate((value) => document.documentElement.dataset.theme = value, theme);
  await settled(page);
  const facts = await page.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio,
    pinchScale: visualViewport.scale }));
  measurements.push({ id, physicalWidth: width, theme, ...facts });
  qa.check(Math.abs(facts.dpr - 2) < .05 && facts.width === width / 2
    && facts.pinchScale === 1, id + " genuine 200% browser zoom at " + width + " " + theme);
  await layout(page, qa, "browser zoom " + id + " " + width + " " + theme);
  await qa.capture(page, "54-zoom-" + id + "-" + width + "-" + theme + ".png");
}

try {
  const page = context.pages()[0];
  await page.goto("chrome://settings/appearance");
  await page.getByRole("combobox", { name: "Page zoom", exact: true })
    .selectOption({ label: "200%" });
  await context.route("**/*", route);
  const cases = SAMPLE_ROUTES.flatMap((id) => [640, 1440].flatMap((width) =>
    ["light", "dark"].map((theme) => ({ id, width, theme }))));
  for (const { id, width, theme } of cases) await screen(page, id, width, theme);
} finally {
  await context.close();
  writeFileSync("docs/ux-redesign/web-v3-" + phase + "-zoom-validation.json",
    JSON.stringify({ phase, checks, screens, measurements,
      method: "Chrome Page zoom setting at200% in a disposable profile; no CSS zoom or pinch" },
    null, 2) + "\n");
}
assert.ok(checks.every((check) => check.pass), "Browser zoom checks pass");
console.log(JSON.stringify({ phase, checks: checks.length, screens: screens.length }));
