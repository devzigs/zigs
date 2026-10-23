import { forEachCase } from "../harness/ui-matrix.mjs";
// Read-only typography QA: frozen synthetic render captures, never a live wallet/profile.
// Set PLAYWRIGHT_MODULE to the installed Playwright module; run this script with before|after.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const phase = process.argv[2] || "after";
assert.ok(["before", "after"].includes(phase));
const out = join(root, "docs/ux-redesign/visuals/typography", phase);
const samples = join(root, "solspike/.state/test-wallet-preview");
const webRoot = process.env.ZIGS_TYPOGRAPHY_WEB || join(root, "web");
mkdirSync(out, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });
const context = await browser.newContext({ reducedMotion: "reduce" });
const checks = [], screenshots = [], errors = [];
const check = (ok, label) => checks.push({ pass: !!ok, label });
const routes = ["overview", "activity", "approvals", "send"];
const sources = Object.fromEntries(routes.map((id) => [id,
  createHash("sha256").update(readFileSync(join(samples, id + ".html"))).digest("hex")]));
const allowed = new Map([...["app.css", "design-system.css", "logo.png"].map((f) => [f, join(
  webRoot, f)]),
  ...["geist-latin", "geist-latin-ext", "geist-mono-latin", "geist-mono-latin-ext"]
    .map((f) => ["fonts/" + f + ".woff2", join(webRoot, "fonts", f + ".woff2")]),
  ...["zcash", "solana", "usdc"].map((f) => ["assets/" + f + ".svg", join(webRoot, "assets",
    f + ".svg")]),
  ...routes.map((id) => [id + ".html", join(samples, id + ".html")]),
  ["sample.css", join(samples, "sample.css")]]);
const types = { html: "text/html", css: "text/css", png: "image/png", svg: "image/svg+xml",
  woff2: "font/woff2" };
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url()), key = url.pathname.slice(1);
  if (url.origin !== "http://typography.invalid" || !allowed.has(key)) return route.abort();
  return route.fulfill({ body: readFileSync(allowed.get(key)),
    contentType: types[key.split(".").at(-1)], headers: {
      "Content-Security-Policy": "default-src 'none'; script-src 'none'; connect-src 'none'; "
        + "style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self'; form-action 'none'",
    } });
});
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.name));
async function settled() {
  await page.evaluate(async () => { await document.fonts.ready;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))); });
}
async function load(id, width, theme) {
  await page.setViewportSize({ width, height: width < 760 ? 844 : 1000 });
  await page.goto("http://typography.invalid/" + id + ".html");
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
  await settled();
}
async function capture(name) {
  const file = name + ".png";
  await page.screenshot({ path: join(out, file), fullPage: true, animations: "disabled" });
  screenshots.push("visuals/typography/" + phase + "/" + file);
}
async function layout(label) {
  const result = await page.evaluate(() => {
    const visible = (n) => !!n.getClientRects().length && getComputedStyle(n).visibility !==
      "hidden";
    const amounts = [...document.querySelectorAll(".money,.sol-amount,.asset-balance")].filter(
      visible);
    return { overflow: document.documentElement.scrollWidth > innerWidth + 1,
      clipped: amounts.filter((n) => n.scrollWidth > n.clientWidth + 1 && getComputedStyle(
        n).overflowX === "hidden").length,
      nonTabular: amounts.filter((n) => !getComputedStyle(n).fontVariantNumeric.includes(
        "tabular-nums")).length,
      tight: amounts.filter((n) => parseFloat(getComputedStyle(n).letterSpacing) < 0).length,
      tinyUnits: [...document.querySelectorAll(".money .cur")].filter(visible)
        .filter((n) => parseFloat(getComputedStyle(n).fontSize) < 13).length,
    };
  });
  check(!result.overflow, label + ": no horizontal page overflow");
  check(!result.clipped, label + ": amounts are not clipped");
  check(!result.nonTabular, label + ": tabular numerals survive font shorthands");
  check(!result.tight, label + ": neutral numeric tracking");
  check(!result.tinyUnits, label + ": units at least 13px");
}
async function doubleText() {
  await page.evaluate(() => {
    const sizes = [...document.querySelectorAll("body,body *")]
      .map((n) => [n, parseFloat(getComputedStyle(n).fontSize)]);
    for (const [n, size] of sizes) n.style.fontSize = size * 2 + "px";
  });
  await settled();
}

// Production review/row selectors with labelled synthetic values; no simulated approvals.
async function reviewSpecimens() {
  await page.evaluate(() => {
    document.body.innerHTML = (
      "<header class=\"sample-banner\" style=\"line-height:1.5\"><"
      + "strong style=\"line-height:1.3\">Typography specimens · "
      + "Sample data</strong>\n      <p style=\"line-height:1.5\">L"
      + "ayout probes only. No funds, signing or transaction "
      + "actions.</p></header>\n      <section class=\"dialog "
      + "sol-view\" role=\"dialog\" aria-labelledby=\"review-title\">"
      + "\n        <div class=\"card-head\"><h2 "
      + "id=\"review-title\">Exact transaction "
      + "amounts</h2></div>\n        <div "
      + "class=\"review-hero\"><span class=\"label\">Leaves the "
      + "wallet · Zcash testnet</span>\n          <span "
      + "class=\"money lg\" role=\"img\" aria-label=\"21,000,000.1234"
      + "5678 ZEC\">21,000,000.12345678<span class=\"cur\" "
      + "aria-hidden=\"true\">ZEC</span></span>\n        "
      + "</div><div class=\"review-amount\"><span "
      + "class=\"label\">Private payment · Solana Devnet</span>\n  "
      + "        <strong class=\"sol-amount money\" role=\"img\" "
      + "aria-label=\"0.000000001 SOL\">0.000000001 <span "
      + "class=\"cur\" aria-hidden=\"true\">SOL</span></strong>\n    "
      + "      <p class=\"small muted\">Amount hidden · payee "
      + "public. Sample test SOL only.</p></div>\n        <div "
      + "class=\"review-costs\"><h3>Costs · sample "
      + "values</h3><div class=\"lines\">\n          "
      + "<div><span>Network fee</span><span class=\"money "
      + "md\">0.0001<span class=\"cur\">ZEC</span></span></div>\n   "
      + "       <div><span>Additional fee</span><span "
      + "class=\"money md\">0.00<span class=\"cur\">ZEC</span></span"
      + "></div>\n        </div></div><div class=\"list "
      + "stacked\"><div class=\"row-item\"><span class=\"tx-ico\" "
      + "aria-hidden=\"true\">↓</span>\n          <div "
      + "class=\"ri-main\"><span class=\"ri-title\">Incoming</span><"
      + "span class=\"ri-sub\">Pending confirmation</span></div>\n "
      + "         <div class=\"ri-end\"><span class=\"money md "
      + "in\">+0.00000001<span class=\"cur\">ZEC</span></span><span"
      + " class=\"badge info\">Confirming</span></div></div></div>"
      + "\n        <label class=\"field pay-amt\"><span>Amount · "
      + "ZEC</span><input class=\"input\" inputmode=\"decimal\" "
      + "value=\"0.00000001\"></label>\n      </section>"
    );
  });
  await settled();
}

try {
  await forEachCase(["dark", "light"], async (theme) => { await forEachCase([390, 1440],
    async (width) => {
    await forEachCase(routes, async (id) => {
      await load(id, width, theme);
      await layout(id + " " + width + " " + theme);
      await capture(id + "-" + width + "-" + theme);
    });
    // Stress only the inert capture's presentation. No fixture enters application stores.
    await load("overview", width, theme);
    await page.evaluate(() => {
      const amounts = document.querySelectorAll(".asset-balance-block>.money");
      for (const [i, n] of [...amounts].entries()) {
        const unit = n.querySelector(".cur").cloneNode(true);
        n.replaceChildren(i ? "0.000000001" : "21,000,000.12345678", unit);
      }
      const title = document.querySelector(".ph-left h1");
      if (title) title.textContent = "Shared household and reserve wallet with a long name";
    });
    await layout("large/dust " + width + " " + theme);
    await capture("large-dust-" + width + "-" + theme);
    await doubleText();
    await layout("200% text " + width + " " + theme);
    await capture("large-dust-200pct-" + width + "-" + theme);
    await load("send", width, theme);
    await reviewSpecimens();
    await layout("review specimens " + width + " " + theme);
    check(await page.locator(".sol-amount").getAttribute("aria-label") === "0.000000001 SOL",
      "exact dust amount and SOL unit remain accessible " + width + " " + theme);
    await page.locator("input[inputmode=decimal]").focus();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("0.000000010");
    check(await page.locator("input[inputmode=decimal]").inputValue() === "0.000000010",
      "decimal field remains keyboard editable " + width + " " + theme);
    await capture("review-specimens-" + width + "-" + theme);
    await doubleText();
    await layout("review 200% text " + width + " " + theme);
    await capture("review-specimens-200pct-" + width + "-" + theme);
  }); });
  // State geometry belongs to the balance block, not the surrounding metadata/actions.
  await load("overview", 390, "dark");
  const geometry = await page.evaluate(() => {
    const block = document.querySelector(".asset-balance-block"), value = block.querySelector(
      ".money.xl");
    const height = () => block.getBoundingClientRect().height;
    const loaded = height();
    const placeholder = document.createElement("span"); placeholder.className = "skel";
    placeholder.setAttribute("role", "img"); placeholder.setAttribute("aria-label",
      "Loading balance");
    value.replaceWith(placeholder);
    const loading = height();
    const unknown = document.createElement("p"); unknown.className = "asset-balance unknown";
    unknown.textContent = "Unavailable"; placeholder.replaceWith(unknown);
    const unavailable = height();
    unknown.replaceWith(value);
    value.firstChild.textContent = "0.00";
    return { loaded, loading, unavailable, zero: height() };
  });
  check(Math.abs(geometry.loaded - geometry.loading) < 1, "loading balance reserves loaded height");
  check(Math.abs(geometry.loaded - geometry.zero) < 1, "zero balance reserves loaded height");
  check(Math.abs(geometry.loaded - geometry.unavailable) < 1,
    "unavailable balance reserves loaded height");
  await capture("zero-390-dark");
  await forEachCase(["rtl"], async (dir) => {
    await page.evaluate((d) => { document.documentElement.dir = d; }, dir);
    await layout(dir + " 390 dark");
    check(await page.locator(".asset-balance-block>.money").first().evaluate((n) =>
      getComputedStyle(n).direction === "ltr"), "RTL keeps decimal figures in reading order");
    await capture("rtl-390-dark");
  });
  check(errors.length === 0, "no uncaught browser errors");
  const report = { phase, browser: browser.version(), sources, geometry, checks, screenshots,
    styles: Object.fromEntries(["app.css", "design-system.css"].map((f) => [f,
      createHash("sha256").update(readFileSync(join(webRoot, f))).digest("hex")])),
    limitations: ["Inert synthetic captures; no live signing, payment, sync or passkey operation.",
      "Large/dust, doubled text, RTL and loading probes alter only the isolated QA DOM.",
      (
        "Review/fee/row specimens use production selectors with "
        + "synthetic markup; no approval is simulated."
      ),
      "No assistive-technology, physical device or live network state validation."], errors };
  writeFileSync(join(root, "docs/ux-redesign/typography-" + phase + "-validation.json"),
    JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ phase, checks: checks.length,
    failed: checks.filter((c) => !c.pass), screenshots: screenshots.length }, null, 2));
  if (phase === "after") assert.ok(checks.every((c) => c.pass), "Typography QA failed");
} finally { await context.close(); await browser.close(); }
