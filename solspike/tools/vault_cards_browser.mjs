import { forEachCase } from "../harness/ui-matrix.mjs";
// Presentation fixtures only: fresh browser stores, no boot, engine, backend or real wallets.
// PLAYWRIGHT_MODULE and CHROME_EXECUTABLE may point to an installed local runtime.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(process.env.ZIGS_VAULT_SOURCE
  || join(dirname(fileURLToPath(import.meta.url)), "../.."));
const phase = process.env.ZIGS_VAULT_PHASE || "after";
assert.ok(["before", "after"].includes(phase));
const output = resolve(process.env.ZIGS_VAULT_OUTPUT
  || join(ROOT, "docs/ux-redesign/visuals/vault-cards", phase));
mkdirSync(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });
const checks = [], errors = [], screenshots = [];
const origin = "http://localhost:8801";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2",
    ".wasm": "application/wasm" };
const check = (ok, label) => { checks.push({ label, pass: !!ok }); assert.ok(ok, label); };
const rgb = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number);
const light = (color) => color.map((n) => n / 255)
  .map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
  .reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
function contrast(a, b) {
  const [high, low] = [light(a), light(b)].sort((x, y) => y - x);
  return (high + .05) / (low + .05);
}

// Keep only pixel/palette chunks: evidence never contains local paths or other PNG metadata.
function stripMetadata(file) {
  const b = readFileSync(file), chunks = [b.subarray(0, 8)];
  for (let at = 8; at + 12 <= b.length;) {
    const end = at + b.readUInt32BE(at) + 12;
    if (["IHDR", "IDAT", "IEND", "PLTE", "tRNS"].includes(b.toString("ascii", at + 4, at + 8)))
      chunks.push(b.subarray(at, end));
    at = end;
  }
  writeFileSync(file, Buffer.concat(chunks));
}

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
}

async function capture(page, name) {
  const file = name + ".png";
  await page.screenshot({ path: join(output, file), fullPage: true, animations: "disabled" });
  stripMetadata(join(output, file)); screenshots.push(file);
}

async function fresh(touch = false) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce", hasTouch: touch });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/app.js") return route.fulfill({ contentType: "text/javascript",
      body: "// Synthetic visual fixture: application boot intentionally disabled." });
    const web = join(ROOT, "web"), file = resolve(web, "." + (url.pathname === "/" ?
      "/index.html" : url.pathname));
    if (!file.startsWith(web + sep) || !existsSync(file)) return route.abort();
    let body = readFileSync(file);
    // The fixture has no group server. This flag only permits the existing render loop to paint.
    if (url.pathname === "/app-groups.js")
      body = Buffer.from(body.toString().replace("dbReady = false", "dbReady = true"));
    return route.fulfill({ contentType: types[extname(file)] || "application/octet-stream", body });
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page.evaluate(async () => {
    const groups = await import("/app-groups.js");
    // Actual selection handlers run against inert subscriptions, never a network or engine.
    const subscription = { onSnapshot: () => () => {} };
    groups.setDb({ doc: () => subscription, collection: () => subscription });
    await import("/app-shell.js");
    const motion = await import("/app-motion.js");
    motion.observeWalletPicker?.(document);
  });
  return { context, page };
}

async function paint(page, count, options = {}) {
  await page.evaluate(async ({ count, options }) => {
    const { state, ui, ready } = await import("/app-state.js");
    state.gid = null; state.g = null; ui.tab = "overview"; ui.send = false;
    state.groups = Array.from({ length: count }, (_, i) => ({
      id: "synthetic-vault-" + i,
      name: options.long && i === 0
        ? "A shared wallet with a very long name — " + "LongLabel".repeat(10)
        : ["Family vault", "Travel and shared expenses", "Long-term savings"][i] ||
          "Shared wallet " + (i + 1),
      network: i === 2 ? "mainnet" : "testnet", n: [3, 2, 5][i % 3], t: [2, 2, 3][i % 3],
    }));
    for (const g of state.groups) delete ready[g.id];
    if (options.setup) ready[state.groups[0].id] = false;
    if (options.unreadable) state.groups[0].unreadable = true;
    if (options.selected) state.gid = state.groups[0].id;
    const shell = await import("/app-shell.js");
    document.getElementById("app").replaceChildren(shell.lobby());
    shell.renderSide();
  }, { count, options });
  await settle(page);
}

async function layout(page, label) {
  const facts = await page.evaluate(() => {
    const list = document.querySelector(".welcome-wallet-list");
    const nodes = [...document.querySelectorAll(".wallet-vault-card")];
    const compact = [...document.querySelectorAll(".wallet-context")];
    return { page: document.documentElement.scrollWidth <= innerWidth + 1,
      list: list.scrollWidth <= list.clientWidth + 1,
      cards: nodes.every((n) => n.scrollWidth <= n.clientWidth + 1 && n.scrollHeight <=
        n.clientHeight + 1),
      labels: nodes.every((n) => [".ri-title", ".vault-network", ".vault-rule"].every((s) => {
        const r = n.querySelector(s).getBoundingClientRect(), box = n.getBoundingClientRect();
        return r.left >= box.left && r.right <= box.right + 1 && r.bottom <= box.bottom;
      })),
      compact: compact.every((n, i) => !i || n.getBoundingClientRect().top
        >= compact[i - 1].getBoundingClientRect().bottom - 1) };
  });
  for (const [name, pass] of Object.entries(facts)) {
    const detail = pass ? "" : JSON.stringify(await page.locator(
      ".wallet-vault-card").evaluateAll((nodes) =>
      nodes.map((n) => ({ width: n.clientWidth, height: n.clientHeight,
        scrollWidth: n.scrollWidth, scrollHeight: n.scrollHeight,
        parts: [...n.children].map((c) => [c.className, c.getBoundingClientRect().height]) }))));
    check(pass, label + " " + name + detail);
  }
}

try {
  const { context, page } = await fresh();
  await forEachCase([320, 390, 768, 1440], async (width) => {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    await forEachCase(["dark", "light"], async (theme) => {
      await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await forEachCase([1, 3, 12], async (count) => {
        await paint(page, count);
        if (phase === "after") {
          check(await page.locator(".wallet-vault-card").count() === count,
            `${width} ${theme} ${count} wallets`);
          await layout(page, `${width} ${theme} ${count}`);
          if (count === 3 && width === 1440) {
            const colors = await page.locator(".wallet-vault-card").first().evaluate((n) => ({
              background: getComputedStyle(n).backgroundColor,
              text: [".ri-title", ".vault-network", ".vault-rule", ".vault-entry-label",
                ".ri-end .small"]
                .map((s) => getComputedStyle(n.querySelector(s)).color),
            }));
            const base = rgb(colors.background);
            // Test the strongest point of the restrained .045-alpha satin highlight as well.
            const highlighted = base.map((v, i) => v * .955 + [217, 221, 224][i] * .045);
            check(colors.text.every((c) => contrast(rgb(c), base) >= 4.5
              && contrast(rgb(c), highlighted) >= 4.5), theme +
                " rendered card text contrast >=4.5:1");
          }
          const last = page.locator(".welcome-wallet-list button").last();
          await last.focus();
          check(await last.evaluate((n) => document.activeElement === n),
            "last wallet keyboard reachable");
          check(await last.evaluate((n) => {
            const r = n.getBoundingClientRect(), p = n.closest(
              ".wallet-popover,.welcome-wallet-list").getBoundingClientRect();
            return r.top >= p.top - 1 && r.bottom <= p.bottom + 1;
          }), "last wallet scrolls into view");
        }
        await page.locator(".welcome-wallet-list button").first().focus();
        if (count === 3 && [390, 1440].includes(width))
          await capture(page, `wallets-${width}-${theme}`);
      });
    });
  });
  if (phase === "after") {
    await page.setViewportSize({ width: 390, height: 844 });
    await paint(page, 12, { long: true });
    await page.evaluate(() => {
      const sizes = [...document.querySelectorAll("body *")]
        .map((n) => [n, parseFloat(getComputedStyle(n).fontSize)]);
      for (const [n, size] of sizes) n.style.fontSize = size * 2 + "px";
    });
    await settle(page); await layout(page, "200% text and long name");
    await capture(page, "long-name-200-percent");
    const rule = page.locator(".wallet-vault-card .vault-rule").first();
    await rule.scrollIntoViewIfNeeded();
    check(await rule.evaluate((n) => {
      const r = n.getBoundingClientRect();
      const p = n.closest(".wallet-popover,.welcome-wallet-list").getBoundingClientRect();
      return r.top >= p.top && r.bottom <= p.bottom;
    }), "approval rule remains discoverable by scrolling at 200% text");
    await capture(page, "long-name-200-percent-rule");
    await context.close();
    const next = await fresh(), p = next.page;
    await paint(p, 3);
    check(await p.locator(".vault-rule").allTextContents().then((rules) =>
      rules.join("|") === "Any 2 of 3 devices|Any 2 of 2 devices|Any 3 of 5 devices"),
    "actual approval rules stay independent for each wallet");
    check(await p.locator(".vault-card-top .wallet-art").evaluateAll((nodes) =>
      nodes.length === 3 && new Set(nodes.map((n) => n.getAttribute("src"))).size === 1
      && nodes.every((n) => n.getAttribute("data-art-state") === "unavailable"
        && !n.getAttribute("src").includes("synthetic-vault"))),
    "unverified wallet identities use the same neutral artwork without invented verification");
    check(await p.evaluate(async () => {
      const { state } = await import("/app-state.js");
      state.gid = state.groups[0].id;
      const view = (await import("/app-shell.js")).lobby();
      state.gid = null;
      return view.querySelector(".wallet-vault-card[aria-current=true]")?.textContent.includes(
        "Selected");
    }), "selected renderer has visible text as well as aria-current");
    await paint(p, 3, { setup: true });
    check(await p.locator(".wallet-vault-card").first().textContent()
      .then((s) => s.includes("Setup unfinished") && s.includes("Any 2 of 3 devices")),
    "setup status never replaces approval rule");
    await paint(p, 3, { unreadable: true });
    check(await p.locator(".wallet-vault-card").count() === 2,
      "unreadable wallet retains existing fallback");
    await paint(p, 3);
    const first = p.locator(".wallet-vault-card").first();
    await first.hover();
    check(await first.evaluate((n) => getComputedStyle(n).transform === "none"
      && getComputedStyle(n).transitionDuration === "0s"), "reduced motion has no hover movement");
    await p.emulateMedia({ reducedMotion: "no-preference" });
    await first.hover(); await p.waitForTimeout(200);
    check(await first.evaluate((n) => n.matches(":hover")
      && getComputedStyle(n).transform === "none"),
      "homepage hover keeps the wallet card stationary");
    check(await first.evaluate((n) => n.getAnimations({ subtree: true }).length === 0),
      "settled cards have no ongoing animation");
    await p.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
    await p.keyboard.press("Tab");
    await first.focus();
    check(await first.evaluate((n) => getComputedStyle(n).outlineStyle === "solid"
      && parseFloat(getComputedStyle(n).outlineWidth) >= 2),
        "forced-colors keyboard focus remains visible");
    await capture(p, "forced-colors-focus");
    await p.emulateMedia({ reducedMotion: "reduce", forcedColors: "none" });
    check(await p.locator("#welcome-wallets summary").count() === 0,
      "wallet actions are directly discoverable without an intermediate picker");
    await first.focus();
    await p.evaluate(async () => (await import("/app-loop.js")).draw());
    check(await first.evaluate((n) => n === document.activeElement),
      "redraw preserves focus on the wallet entry action");
    check(await p.locator(".wallet-vault-card .money").count() === 0,
      "unknown fixture balances are never fabricated");
    await p.locator(".wallet-vault-card").first().press("Enter");
    check(await p.evaluate(async () => (await import("/app-state.js")).state.gid ===
      "synthetic-vault-0"),
      "keyboard uses existing wallet selection immediately");
    check(await p.evaluate(async () => (await import("/app-engine.js")).Z === null),
      "fixture selection does not initialize a crypto engine");
    await next.context.close();
    const touch = await fresh(true);
    await touch.page.setViewportSize({ width: 390, height: 844 });
    await paint(touch.page, 3);
    await touch.page.locator(".wallet-vault-card").nth(1).tap();
    check(await touch.page.evaluate(async () => (await import("/app-state.js")).state.gid ===
      "synthetic-vault-1"),
      "touch uses the unchanged wallet selection handler");
    await touch.context.close();
  } else await context.close();
} catch (e) {
  errors.push(e.message.replace(/\/Users\/[^\s]+/g, "[local path]"));
} finally {
  await browser.close();
  const report = { phase, checks, screenshots, errors,
    scope: (
      "Real presentation modules with synthetic in-memory "
      + "wallet metadata and inert subscriptions; app boot and "
      + "crypto disabled."
    ),
    limitations: [(
      "No real wallets, device credentials, backend "
      + "subscriptions, funded payments or physical assistive "
      + "technology tested."
    ),
      (
        "Mainnet label is a synthetic legacy-wallet display "
        + "fixture, not a mainnet creation or support claim."
      )] };
  writeFileSync(join(output, "validation.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ phase, checks: checks.length, screenshots: screenshots.length,
    errors }));
  if (errors.length) process.exitCode = 1;
}
