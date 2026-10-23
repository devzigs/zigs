import { forEachCase } from "../harness/ui-matrix.mjs";
// Presentation QA in fresh stores. All requests are fulfilled locally; wallet APIs are refused.
// Run with Node 24 and PLAYWRIGHT_MODULE pointing to the installed Playwright package.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { resolve, dirname, extname, sep, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const phase = process.env.ZIGS_MICRO_PHASE || "after";
assert.ok(["before", "after"].includes(phase));
const webRoot = resolve(process.env.ZIGS_MICRO_WEB || join(root, "web"));
const samples = resolve(process.env.ZIGS_MICRO_SAMPLES || join(root,
  "solspike/.state/test-wallet-preview"));
const cssFile = process.env.ZIGS_MICRO_CSS || join(webRoot, "app.css");
const label = process.env.ZIGS_MICRO_LABEL || phase;
assert.match(label, /^[a-z-]+$/);
const out = join(root, "docs/ux-redesign/visuals/microinteractions", label);
mkdirSync(out, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE || chromium.executablePath() });
const origin = "http://localhost:18808";
const results = [];
const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".wasm": "application/wasm", ".png": "image/png", ".svg": "image/svg+xml",
  ".woff2": "font/woff2" };
const check = (value, label) => {
  results.push({ label, pass: !!value });
  if (phase === "after") assert.ok(value, label);
};

function sampleBody(file, path, sample, theme, pathname) {
    let body = readFileSync(pathname === "/app.css" ? cssFile : file);
    // The actual worker inserts this existing store client before the title.
    if (!sample && path === "index.html") body = Buffer.from(body.toString()
      .replace("<title>", '<script src="/shim.js"></script><title>'));
    if (sample && extname(file) === ".html") body = Buffer.from(body.toString()
      .replace('<html lang="en">', `<html lang="en" data-theme="${theme}">`)
      .replace('href="/sample.css"', 'href="/sample/sample.css"'));
  return body;
}

async function fresh(width = 1440, theme = "dark", touch = false, record = false) {
  const context = await browser.newContext({ viewport: { width, height: 960 },
    colorScheme: theme, hasTouch: touch, isMobile: touch,
    ...(record ? { recordVideo: { dir: out, size: { width: 960, height: 640 } } } : {}) });
  await context.routeWebSocket("**/*", socket => socket.close());
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const sample = url.pathname.startsWith("/sample/");
    const base = sample ? samples : webRoot;
    const path = sample ? url.pathname.slice(8) : url.pathname === "/" ? "index.html"
      : url.pathname.slice(1);
    const file = resolve(base, path);
    if (!file.startsWith(base + sep) || !existsSync(file) || !mime[extname(file)])
      return route.fulfill({ status: 503, body: "Unavailable in presentation QA" });
    const body = sampleBody(file, path, sample, theme, url.pathname);
    return route.fulfill({ contentType: mime[extname(file)], body });
  });
  const page = await context.newPage();
  page.on("pageerror", error => console.error("Page error:", error.message));
  return { context, page };
}

async function capture(page, name) {
  await page.screenshot({ path: join(out, name + ".png"), fullPage: true,
    animations: "disabled", mask: [page.locator(
      ".qr,.safety,.secret-link,input[type=password]")] });
}

async function matrix() {
  await forEachCase([1440, 390], async (width) => { await forEachCase(["dark", "light"],
    async (theme) => {
    const { context, page } = await fresh(width, theme, width === 390);
    try {
      await page.goto(origin + "/sample/overview.html");
      await page.locator(".overview-hero").waitFor();
      await capture(page, `overview-${width}-${theme}`);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `Overview has no horizontal overflow at ${width} in ${theme}`);
      await page.goto(origin);
      await page.locator(".welcome").waitFor();
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await capture(page, `welcome-${width}-${theme}`);
      if (phase === "after") {
        const create = page.getByRole("button", { name: /^(Create wallet|Set up a wallet)$/ });
        await create.focus();
        check(await create.evaluate(el => getComputedStyle(el).outlineStyle === "solid"),
          `Create wallet has keyboard focus in ${theme} at ${width}`);
        await create.press("Enter");
        await page.getByRole("dialog").waitFor();
        check(await page.evaluate(() => document.querySelector('[role="dialog"]')
          .contains(document.activeElement)), "Dialog immediately receives focus");
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "detached" });
        check(await create.evaluate(el => document.activeElement === el),
          "Escape restores focus to Create wallet");
      }
    } finally { await context.close(); }
  }); });
}

async function invalidJoin(page) {
    // Existing real join form: validation stays immediate and preserves the entered draft.
    await page.goto(origin);
    await page.waitForFunction(async () => (await import("/app-engine.js")).Z
      && (await import("/app-groups.js")).dbReady);
    await page.getByRole("button", {
      name: /^Join (a wallet|wallet|a shared wallet|with a link)$/ }).click();
    const input = page.locator("#join-link");
    await page.waitForFunction(() => {
      const button = document.querySelector(".join-row button");
      return button && !button.disabled;
    });
    await input.fill("invalid synthetic link");
    await input.press("Enter");
    await page.waitForFunction(() => document.getElementById("join-link")
      .getAttribute("aria-invalid") === "true");
    check(await input.inputValue() === "invalid synthetic link",
      "Invalid join retains typed value");
    check(await input.getAttribute("aria-invalid") === "true",
      "Join exposes the actual invalid state");
    check(await input.evaluate(el => document.activeElement === el),
      "Actual invalid join preserves keyboard focus");
    check(await input.evaluate(el => getComputedStyle(el).borderLeftColor ===
      getComputedStyle(el).getPropertyValue("--bad").trim()
      || getComputedStyle(el).boxShadow !== "none"), "Invalid field has a persistent error edge");
    await capture(page, "join-error-keyboard");
    await page.keyboard.press("Escape");

}

async function interactions() {
  const { context, page } = await fresh(1440, "dark", false, true);
  try {
    await page.goto(origin + "/sample/overview.html");
    // Eight real preview navigation links plus two native disclosures exercise ten controls.
    for (const route of ["approvals", "activity", "recipients", "swap", "chats",
      "recovery", "settings", "overview"]) {
      const link = page.locator("#tab-" + route);
      await link.focus();
      check(await link.evaluate(el => getComputedStyle(el).outlineStyle === "solid"),
        route + " navigation has keyboard focus");
      await link.press("Enter");
      await page.waitForURL("**/" + route + ".html");
      check(await page.locator('.side-item[aria-current="page"]').count() === 1,
        route + " has one current destination");
    }
    for (const summary of [page.locator(".sample-banner summary"),
      page.locator(".asset-note summary").first()]) {
      if (!await summary.count()) continue;
      await summary.focus();
      for (let n = 0; n < 8; n++) await summary.press("Enter");
      check(await summary.evaluate(el => !el.parentElement.open),
        "Rapid disclosure toggles settle without an invisible open layer");
      check(await summary.evaluate(el => el.getBoundingClientRect().height >= 44),
        "Disclosure target is at least 44px");
    }
    await page.mouse.click(1000, 900);
    await page.locator("#tab-activity").hover();
    await page.mouse.down();
    await page.waitForFunction(() => new DOMMatrixReadOnly(getComputedStyle(
      document.getElementById("tab-activity")).transform).m42 === 1);
    const pressed = await page.locator("#tab-activity").evaluate(el =>
      getComputedStyle(el).transform);
    check(pressed === "matrix(1, 0, 0, 1, 0, 1)",
      "Navigation press travels exactly one pixel: " + pressed);
    await page.mouse.move(1000, 900); await page.mouse.up();
    await page.waitForTimeout(180);
    check(await page.locator("#tab-activity").evaluate(el => getComputedStyle(
      el).transform === "none"),
      "Interrupted press returns to rest");
    await page.evaluate(() => {
      const control = document.createElement("button");
      control.id = "micro-disabled-sample"; control.className = "btn primary";
      control.setAttribute("aria-disabled", "true"); control.textContent =
        "Disabled sample control";
      document.querySelector("#app").prepend(control);
    });
    const disabled = page.locator("#micro-disabled-sample");
    await disabled.hover(); await page.mouse.down(); await page.waitForTimeout(100);
    check(await disabled.evaluate(el => getComputedStyle(el).transform === "none"
      && getComputedStyle(el).boxShadow === "none"),
        "ARIA-disabled control has no hover/press elevation");
    await page.mouse.move(1000, 900); await page.mouse.up();
    await disabled.evaluate(el => el.remove());
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#tab-activity").hover(); await page.mouse.down();
    check(await page.locator("#tab-activity").evaluate(el => {
      const style = getComputedStyle(el);
      return style.transform === "none" && style.transitionDuration === "0s";
    }), "Reduced motion removes press movement and transitions");
    await page.mouse.move(1000, 900); await page.mouse.up();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForTimeout(350);
    check(await page.evaluate(() => document.getAnimations().filter(a => a.playState === "running")
      .length === 0), "Settled UI has no ongoing animation");

    await invalidJoin(page);

    // 200% text sizing in an actual native disclosure, with a long synthetic label.
    await page.goto(origin + "/sample/overview.html");
    await page.evaluate(() => document.documentElement.style.fontSize = "200%");
    const summary = page.locator(".asset-note summary").first();
    await summary.click();
    check(await summary.evaluate(el => el.parentElement.scrollHeight <=
      el.parentElement.getBoundingClientRect().height + 2),
        "Expanded disclosure does not clip at 200% text");
    await capture(page, "disclosure-200-percent");
  } finally {
    await context.close();
    if (page.video()) renameSync(await page.video().path(), join(out, "interactions.webm"));
  }
}

async function inputModes() {
  for (const theme of ["dark", "light"]) {
    const { context, page } = await fresh(390, theme, true);
    try {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await page.goto(origin);
      const create = page.getByRole("button", { name: /^(Create wallet|Set up a wallet)$/ });
      await page.waitForFunction(async () => (await import("/app-engine.js")).Z
        && (await import("/app-groups.js")).dbReady);
      await page.waitForTimeout(180);
      const restingFill = await create.evaluate((node) => getComputedStyle(node).backgroundColor);
      await create.tap();
      await page.getByRole("dialog").waitFor();
      check(await page.getByRole("dialog").isVisible(),
        `Touch opens the actual dialog on a throttled device in ${theme}`);
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "detached" });
      await page.waitForTimeout(200);
      const finalFill = await create.evaluate(el => getComputedStyle(el).backgroundColor);
      check(finalFill === restingFill,
        `Touch leaves no sticky pointer hover fill in ${theme}: ${restingFill} -> ${finalFill}`);
      const summary = page.locator(".welcome-details>summary");
      await summary.tap();
      check(await summary.evaluate(el => el.getBoundingClientRect().height >= 44),
        `Touch disclosure target is at least 44px in ${theme}`);
      await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
      await page.keyboard.press("Tab");
      await summary.focus();
      check(await summary.evaluate(el => getComputedStyle(el).outlineStyle === "solid"),
        `Forced-colors keyboard focus stays visible in ${theme}`);
      await capture(page, "touch-reduced-forced-colors-" + theme);
    } finally { await context.close(); }
  }
}

try {
  await matrix();
  if (phase === "after") { await interactions(); await inputModes(); }
} finally {
  await browser.close();
  writeFileSync(join(out, "validation.json"), JSON.stringify({ phase, results }, null, 2) + "\n");
}
console.log(`${phase}: ${results.length} checks, ${results.filter(r => !r.pass).length} failed`);
