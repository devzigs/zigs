// Real local application, temporary unfunded stores, external requests blocked.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { entryReady, syntheticList } from "../harness/entry-flow.mjs";
import { settled } from "../harness/premium-visuals.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const phase = process.env.ZIGS_HOME_PHASE || "after";
assert.ok(["before", "composition", "materials", "after"].includes(phase));
const origin = process.env.ZIGS_HOME_ORIGIN || "http://localhost:55846";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const output = resolve("docs/ux-redesign/visuals/premium-home", phase);
mkdirSync(output, { recursive: true });
const checks = [], facts = [], errors = [], screens = [];
const check = (pass, label) => { checks.push({ pass: !!pass, label }); assert.ok(pass, label); };
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
  httpCredentials: { username: "Preview", password: "local-preview" } });
const routeLocal = (route) => new URL(route.request().url()).origin === origin
  ? route.continue() : route.abort();
await context.route("**/*", routeLocal);
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.name + ": " + error.message));
async function capture(name, fullPage = false) {
  await page.evaluate(() => document.fonts.ready); await settled(page);
  await page.screenshot({ path: resolve(output, name + ".png"), animations: "disabled", fullPage });
  screens.push(name + ".png");
}
async function matrix(scene) {
  for (const width of phase === "after" ? [1440, 1280, 768, 390, 320] : [1440, 390]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    for (const theme of ["dark", "light"]) await matrixCase(scene, width, theme);
  }
}
async function matrixCase(scene, width, theme) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme; scrollTo(0, 0);
      }, theme);
      await settled(page);
      const value = await page.evaluate(() => {
        const rect = (s) => document.querySelector(s).getBoundingClientRect();
        const main = rect(".main"), hero = rect(".welcome-main");
        const object = rect(".welcome-brand-plate");
        const buttons = [...document.querySelectorAll(".welcome-actions>.btn")]
          .map((n) => n.getBoundingClientRect());
        return { overflow: document.documentElement.scrollWidth > innerWidth + 1,
          heroLeft: hero.left, heroTop: hero.top, heroWidth: hero.width,
          centerOffset: (hero.left + hero.right - main.left - main.right) / 2,
          objectWidth: object.width,
          buttons: buttons.map((r) => ({ width: r.width, height: r.height, bottom: r.bottom })),
          readable: [...document.querySelectorAll(".welcome-intro p")]
            .every((n) => n.scrollWidth <= n.clientWidth + 1) };
      });
      facts.push({ scene, width, theme, ...value });
      check(!value.overflow && value.readable, scene + " no clipping " + width + " " + theme);
      if (phase === "after") {
        check(value.buttons.length === 2 && value.buttons.every((r) => r.height >= 48),
          "comfortable entry controls " + width);
        if (width >= 1280) check(Math.abs(value.centerOffset) <= 2
          && value.buttons.every((r) => r.bottom <= 900),
        "centered composition and visible actions " + width);
      }
      await capture(scene + "-" + width + "-" + theme);
}
async function motionCheck() {
  const motion = await browser.newContext({ reducedMotion: "no-preference",
    viewport: { width: 1440, height: 900 },
    httpCredentials: { username: "Preview", password: "local-preview" } });
  await motion.route("**/*", routeLocal);
  try {
    const p = await motion.newPage(); await entryReady(p, origin);
    const plate = p.locator(".welcome-brand-plate");
    await p.waitForTimeout(850);
    check(await plate.evaluate((n) => !n.getAnimations({ subtree: true })
      .some((a) => a.playState === "running")), "zebra entrance finishes without repetition");
    const box = await plate.boundingBox();
    await p.mouse.move(box.x + box.width * .85, box.y + box.height * .15);
    await p.waitForTimeout(100);
    check(await plate.evaluate((n) => {
      const x = parseFloat(n.style.getPropertyValue("--brand-rx"));
      const y = parseFloat(n.style.getPropertyValue("--brand-ry"));
      return Number.isFinite(x) && Math.abs(x) <= 2 && Math.abs(y) <= 2;
    }), "desktop hover tilt remains within two degrees of its resting pose");
    await p.mouse.move(10, 10);
    await p.evaluate(async () => (await import("/app-loop.js")).render()); await settled(p);
    check(await plate.evaluate((n) => !n.classList.contains("motion-brand-arrive")),
      "ordinary redraw does not replay the zebra entrance");
    await p.emulateMedia({ reducedMotion: "reduce" });
    check(await plate.evaluate((n) => getComputedStyle(n).transform === "none"),
      "reduced motion removes perspective");
  } finally { await motion.close(); }
}
try {
  await entryReady(page, origin); await matrix("welcome");
  if (phase === "after") {
    const copy = "The multisig wallet for shielded Zcash. "
      + "Secure your ZEC across independent devices. "
      + "No single device holds the complete spending key.";
    check(await page.locator(".welcome-summary").textContent() === copy,
      "approved supporting copy");
    check(!/beta|not audited|test networks/i
      .test(await page.locator(".welcome-intro").textContent()),
    "release disclosure separated from marketing copy");
    const summary = page.locator(".welcome-details>summary");
    await summary.press("Enter");
    await page.waitForFunction(() => document.querySelector(".welcome-details").open);
    check(await page.locator(".welcome-release-note").isVisible(),
      "original release notice remains accessible in security disclosure");
    check(/fee address.*public/s.test(await page.locator(".welcome-disclosures").innerText()),
      "Solana privacy boundaries retained");
    await capture("expanded-320-light", true);
    await page.setViewportSize({ width: 1440, height: 900 });
    await capture("expanded-1440-light", true);
    await page.evaluate(async () => (await import("/app-loop.js")).render()); await settled(page);
    check(await page.locator(".welcome-details").evaluate((n) => n.open),
      "open disclosure survives ordinary redraw");
    await page.locator(".welcome-details>summary").press("Enter");
    await page.getByRole("button", { name: "Join a wallet", exact: true }).press("Enter");
    await page.locator("#join-link").waitFor();
    check(await page.locator("#join-link").isVisible(), "Join opens existing private invite field");
    await page.getByRole("button", { name: "Join a wallet", exact: true }).click();
    await page.getByRole("button", { name: "Create wallet", exact: true }).press("Enter");
    await page.locator(".guided-plan").waitFor();
    check(await page.locator(".guided-plan").isVisible(), "Create opens existing setup flow");
    await page.keyboard.press("Escape");
    await page.locator(".guided-plan").waitFor({ state: "hidden" });
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Recover access", exact: true }).press("Enter");
    await (await chooser).setFiles([]);
    check(await page.locator("#restore").count() === 1,
      "Recover retains existing local-file action");
    await page.setViewportSize({ width: 320, height: 844 });
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await page.evaluate(() => {
      window.homeSizes = [...document.querySelectorAll("body *")]
        .map((n) => [n, n.style.fontSize, getComputedStyle(n).fontSize]);
      for (const [n, , size] of window.homeSizes) n.style.fontSize = parseFloat(size) * 2 + "px";
    });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      "forced colors and 200% text fit 320px");
    await page.locator(".welcome-details>summary").click();
    check(await page.locator(".welcome-release-note").isVisible(),
      "disclosures readable at 200% text");
    await capture("preferences-320", true);
    await page.evaluate(() => {
      for (const [n, size] of window.homeSizes) n.style.fontSize = size;
    });
    await page.locator(".welcome-details>summary").click();
    await page.emulateMedia({ forcedColors: "none" });
    await syntheticList(page); await matrix("returning");
    await motionCheck();
  }
  check(errors.length === 0, "no browser errors");
} catch (error) { errors.push(error.message.split("\n")[0]); process.exitCode = 1; }
finally {
  await browser.close();
  const report = { phase, checks, facts, errors, screens,
    scope: "Actual local app in isolated stores. Returning-wallet rows use synthetic metadata." };
  writeFileSync(resolve(output, "validation.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ phase, checks: checks.length,
    screenshots: screens.length, errors }));
}
