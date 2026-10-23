import { forEachCase } from "../harness/ui-matrix.mjs";
// Production wallet navigation plus isolated reusable glass-component fixtures.
// Local-only UI fixtures: no keys, balances, persisted wallets or external requests.
// PLAYWRIGHT_MODULE and CHROME_EXECUTABLE may select the installed browser runtime.
// Before captures: ZIGS_GLASS_PHASE=before ZIGS_GLASS_BASELINE=<saved asset directory>.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const phase = process.env.ZIGS_GLASS_PHASE || "after";
assert.ok(["before", "after"].includes(phase));
const origin = process.env.ZIGS_GLASS_ORIGIN || "http://127.0.0.1:8803";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const visualSet = phase === "after" ? "wallet-navigation" : "liquid-glass";
const output = join(root, "docs/ux-redesign/visuals", visualSet, phase);
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });
const checks = [], screens = [], errors = [];
const check = (ok, label) => { assert.ok(ok, label); checks.push(label); };
const shot = async (page, name) => {
  await page.evaluate(() => document.fonts.ready);
  const file = name + ".png";
  await page.screenshot({ path: join(output, file), animations: "disabled" });
  screens.push("visuals/" + visualSet + "/" + phase + "/" + file);
};
async function fixture(page, count, custom = false, long = false) {
  await page.evaluate(async ({ count, custom, long }) => {
    const { state, ui } = await import("/app-state.js");
    const { groupView } = await import("/app-wallet.js");
    const { renderSide } = await import("/app-shell.js");
    state.groups = Array.from({ length: count }, (_, i) => ({ id: "fixture-" + i,
      name: i === 0 ? "Savings vault" : i === 1
        ? "Travel and shared expenses wallet with a very long name" : "Family wallet " + (i + 1),
      n: 3, t: 2, network: "testnet" }));
    if (long) {
      state.groups[0].name = "A very long household savings vault name for independent devices";
      delete state.groups[2].n; delete state.groups[2].t;
    }
    state.g = state.groups[0]; state.gid = state.g.id;
    state.wallet = { birthday: 1 }; ui.tab = "overview";
    renderSide();
    let root = document.getElementById("glass-fixture");
    if (!root) {
      root = document.createElement("div"); root.id = "glass-fixture";
      document.querySelector(".main").append(root);
      document.getElementById("app").style.display = "none";
    }
    root.replaceChildren(groupView());
    window.glassMountPicker = async () => {
      const { walletSwitcher } = await import("/app-wallet-switcher.js");
      window.glassPicks = [];
      document.querySelector("#glass-fixture .wallet-name-block h1").replaceWith(
        walletSwitcher(state.groups, state.g,
        (id) => window.glassPicks.push(id)));
    };
    if (custom) await window.glassMountPicker();
  }, { count, custom, long });
}
async function preferenceChecks(page, context, width, theme) {
      await fixture(page, 3, true);
      const summary = page.locator(".wallet-picker-trigger");
      await summary.press("Enter");
      await page.waitForFunction(() => document.activeElement.getAttribute("aria-checked") ===
        "true");
      await page.keyboard.press("ArrowDown");
      check(await page.evaluate(() => window.glassPicks.length === 0),
        "navigation never switches wallets");
      await page.keyboard.press("Enter");
      check(await page.evaluate(() => window.glassPicks.join() === "fixture-1"),
        "selection delegates once immediately");
      await summary.press("Enter"); await page.keyboard.press("Enter");
      check(await page.evaluate(() => window.glassPicks.length === 1),
        "current wallet closes without reopening its session");
      await fixture(page, 3, true, true);
      await summary.click();
      const menu = page.getByRole("menu", { name: "Your wallets" });
      await page.waitForFunction(() => !!document.querySelector(".wallet-picker-panel")?.style.top);
      check(await menu.getByText("Approval rule unavailable", { exact: true }).count() === 1,
        "missing approval metadata is not invented");
      check(await summary.evaluate((n) => n.scrollWidth <= n.clientWidth),
        "long current identity fits trigger");
      await shot(page, "long-current-name-" + width + "-" + theme);
      await page.evaluate(() => {
        window.glassSizes = [...document.querySelectorAll("#glass-fixture *")]
          .map((n) => [n, n.style.fontSize, getComputedStyle(n).fontSize]);
        for (const [n, , size] of window.glassSizes) n.style.fontSize = parseFloat(size) * 2 + "px";
        dispatchEvent(new Event("resize"));
      });
      check(await menu.evaluate((n) => n.scrollWidth <= n.clientWidth),
        "200% text keeps wallet names within panel");
      await shot(page, "double-text-" + width + "-" + theme);
      await page.evaluate(() => {
        for (const [n, size] of window.glassSizes) n.style.fontSize = size;
        delete window.glassSizes; dispatchEvent(new Event("resize"));
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      check(await menu.evaluate((n) => getComputedStyle(n).animationName === "none"
        && getComputedStyle(n).backdropFilter === "none"),
          "reduced motion is opaque and immediate");
      await shot(page, "reduced-motion-" + width + "-" + theme);
      await page.emulateMedia({ forcedColors: "active" });
      check(await menu.evaluate((n) => getComputedStyle(n).backdropFilter === "none"),
        "forced colors disables blur");
      await shot(page, "forced-colors-" + width + "-" + theme);
      await page.emulateMedia({ forcedColors: "none", reducedMotion: "no-preference" });
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setEmulatedMedia", { features: [
        { name: "prefers-reduced-transparency", value: "reduce" },
        { name: "prefers-color-scheme", value: theme },
      ] });
      check(await menu.evaluate((n) => matchMedia("(prefers-reduced-transparency: reduce)").matches
        && getComputedStyle(n).backdropFilter === "none"), "reduced transparency is opaque");
      await shot(page, "reduced-transparency-" + width + "-" + theme);
      await cdp.send("Emulation.setEmulatedMedia", { features: [] });
      await fixture(page, 3);
      if (width === 1440) await forEachCase([1366, 1440, 768, 390, 320], async (size) => {
        await page.setViewportSize({ width: size, height: size === 1440 ? 900 : 800 });
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          "production header fits " + size + " " + theme);
        check(await page.getByRole("button", { name: "Return home", exact: true }).isVisible(),
          "home remains visible at " + size + " " + theme);
        await shot(page, "header-" + size + "-" + theme);
      });
      await page.setViewportSize({ width: 320, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
      await page.evaluate(() => {
        for (const [node, size] of [...document.querySelectorAll("#glass-fixture *")]
          .map((node) => [node, getComputedStyle(node).fontSize])) node.style.fontSize =
            parseFloat(size) * 2 + "px";
      });
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        "production header fits forced colors and doubled text at 320px");
      await shot(page, "header-preferences-" + width + "-" + theme);
      const destination = await page.evaluate(async () => {
        const { state, ui } = await import("/app-state.js");
        const { mainView, restoreFocus } = await import("/app-loop.js");
        const wallets = JSON.stringify(state.groups);
        ui.tab = "recovery";
        document.querySelector(".wallet-home").click();
        const root = document.getElementById("glass-fixture");
        root.replaceChildren(mainView()); restoreFocus(root, null, null);
        return !state.gid && ui.tab === "overview" && JSON.stringify(state.groups) === wallets
          && document.activeElement.matches('[data-key="home-page"]') && !!root.querySelector(
            ".welcome");
      });
      check(destination,
        "Return home opens the first page, focuses it and preserves saved wallets");
      await fixture(page, 3);
      check(await page.evaluate(async () => {
        const { state, ui } = await import("/app-state.js");
        const { setDb } = await import("/app-groups.js");
        const subscription = () => ({ onSnapshot: () => () => {} });
        setDb({ doc: subscription, collection: subscription });
        document.querySelector('[data-key="wallet-fixture-1"]').click();
        return state.gid === "fixture-1" && ui.tab === "overview";
      }), "sidebar wallet choice delegates to the existing wallet navigation");
    }

try {
  await forEachCase([390, 1440], async (width) => { await forEachCase(["dark", "light"],
    async (theme) => {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ?
      844 : 900 },
      colorScheme: theme });
    await context.route("**/*", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (new URL(route.request().url()).origin !== origin) return route.abort();
      if (path === "/app.js") return route.fulfill({ body: "", contentType: "text/javascript" });
      if (phase === "before" && ["/app-wallet.js", "/app.css"].includes(path))
        return route.fulfill({ body: readFileSync(join(process.env.ZIGS_GLASS_BASELINE, path)),
          contentType: path.endsWith(".css") ? "text/css" : "text/javascript" });
      return route.continue();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.name + ": " + error.message));
    await page.goto(origin);
    await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme);
    await forEachCase([1, 3, 15], async (count) => {
      await fixture(page, count);
      const name = count + "-wallets-" + width + "-" + theme;
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        name + " fits page");
      await shot(page, name + "-closed");
      if (phase === "after") {
        check(await page.locator(".wallet-topbar .wallet-picker").count() === 0,
          name + " production header has no wallet selector");
        check(await page.locator(".wallet-topbar").getByRole("button", { name: "← Wallets",
          exact: true }).count() === 0,
          name + " removes duplicate Wallets navigation");
        check(await page.locator(".wallet-topbar h1").textContent() === "Savings vault",
          name + " retains a plain wallet identity");
        check(await page.locator("#side-nav .wallet-context").count() === count,
          name + " retains all sidebar wallet choices");
        const home = page.getByRole("button", { name: "Return home", exact: true });
        check(await home.evaluate((node) => {
          const box = node.getBoundingClientRect(), bar = node.closest(
            "header").getBoundingClientRect();
          return box.height >= 44 && Math.abs(box.right - bar.right) < 2 && box.top < bar.top + 10;
        }), name + " home control is operable at the top right");
      }
      if (count === 1) {
        check(await page.getByLabel("Switch wallet", { exact: true }).count() === 0, name +
          " retains single-wallet heading");
        return;
      }
      if (phase === "before") return;
      // Keep the reusable glass component's isolated checks; it is no longer in the product header.
      await fixture(page, count, true);
      const summary = page.locator(".wallet-picker-trigger"), menu = page.getByRole("menu", {
        name: "Your wallets" });
      await summary.press("Enter");
      await menu.waitFor();
      await page.waitForFunction(() => !!document.querySelector(".wallet-picker-panel")?.style.top);
      check(await menu.getByRole("menuitemradio").count() === count, name + " retains all wallets");
      check(await menu.locator('[aria-checked="true"]').textContent().then((s) => s.includes(
        "Current")), name + " textual selection");
      check(await menu.getByRole("menuitemradio").evaluateAll((rows) => rows.every(
        (n) => n.getBoundingClientRect().height >= 44)), name + " touch targets");
      check(await menu.evaluate((n) => {
        const b = n.getBoundingClientRect();
        return b.left >= 15 && b.right <= innerWidth - 15 && b.top >= 15 && b.bottom <= innerHeight;
      }), name + " panel fits viewport");
      check(await menu.evaluate((n) => n.scrollWidth <= n.clientWidth), name + " long rows wrap");
      await shot(page, name + "-open");
      await page.keyboard.press("ArrowUp");
      check(await page.evaluate(() => document.activeElement.dataset.key ===
        "wallet-option-fixture-" +
        (document.querySelectorAll('[role="menuitemradio"]').length - 1)), name + " ArrowUp wraps");
      await page.keyboard.press("Home"); await page.keyboard.press("t");
      check(await page.evaluate(() => document.activeElement.dataset.key ===
        "wallet-option-fixture-1"), name + " typeahead");
      await page.keyboard.press("r");
      check(await page.evaluate(() => document.activeElement.dataset.key ===
        "wallet-option-fixture-1"), name + " multi-letter typeahead");
      await page.keyboard.press("Escape");
      check(await summary.evaluate((n) => n === document.activeElement &&
        !n.parentElement.open), name + " Escape and focus return");
      await summary.click(); await page.mouse.click(width - 4, 140);
      check(await summary.evaluate((n) => !n.parentElement.open && n ===
        document.activeElement), name + " outside click and focus return");
      await summary.press("ArrowDown"); await page.keyboard.press("Tab");
      check(await summary.evaluate((n) => !n.parentElement.open), name + " Tab dismisses");
      // The real save/restore helpers preserve disclosure, text values and focused option keys.
      await summary.click(); await page.keyboard.press("End");
      await page.evaluate(async () => {
        const { saveFormState, restoreFormState } = await import("/app-loop.js");
        const { groupView } = await import("/app-wallet.js");
        const app = document.getElementById("glass-fixture"), saved = saveFormState(app);
        app.replaceChildren(groupView()); await window.glassMountPicker(); restoreFormState(
          app, saved);
      });
      check(await page.locator(".wallet-picker").evaluate((n) => n.open), name +
        " disclosure survives redraw");
      await page.locator(".wallet-picker-trigger").press("Escape");
    });
    if (phase === "after") await preferenceChecks(page, context, width, theme);
    await context.close();
  }); });
  check(errors.length === 0, "no browser errors");
} finally {
  await browser.close();
  writeFileSync(join(output, "validation.json"), JSON.stringify({ phase, checks, screens, errors,
    scope: (
      "Runtime-only synthetic fixtures using the actual "
      + "wallet renderer. No wallet backend or keys."
    ) }, null, 2) + "\n");
}
console.log(JSON.stringify({ phase, checks: checks.length, screenshots: screens.length, errors }));
