// Real page routing and render loop, isolated public wallet identities, no service requests.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { overviewFixture, settleOverview } from "../harness/overview-redesign-fixture.mjs";

const output = resolve(process.env.ZIGS_HEADER_OUTPUT || "/tmp/zigs-wallet-header");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });
const context = await browser.newContext({ reducedMotion: "no-preference" });
const page = await context.newPage(), checks = [], errors = [];
const check = (ok, label) => { assert.ok(ok, label); checks.push(label); };
page.on("pageerror", (error) => errors.push(error.message));
mkdirSync(output, { recursive: true });

async function navigate(id) {
  const menu = page.locator("#wallet-menu");
  if (await menu.isVisible() && await menu.getAttribute("aria-expanded") !== "true")
    await menu.click();
  await page.locator("#tab-" + id).click();
  await settleOverview(page);
}

async function checkRoute(id, width, theme) {
  await navigate(id);
  await page.evaluate(() => scrollTo(0, 0));
  await settleOverview(page);
  const headerBox = await page.locator(".wallet-context-header").boundingBox();
  if (id === "overview") await page.evaluate((box) => { window.headerBox = box; }, headerBox);
  const baseline = await page.evaluate(() => window.headerBox);
  check(["x", "y", "width", "height"].every((key) =>
    Math.abs(headerBox[key] - baseline[key]) < 1),
  id + " / " + width + " / " + theme + ": stable header bounds " + JSON.stringify(headerBox));
  check(await page.locator(".wallet-topbar").count() === 1,
    id + " / " + width + " / " + theme + ": exactly one wallet header");
  check(await page.evaluate(() => document.querySelector(".wallet-context-header")
    === window.originalHeader), id + ": header survives navigation");
  check(await page.evaluate(() => document.querySelector(".wallet-context-header canvas")
    === window.originalHeaderCanvas), id + ": rotation keeps the same canvas");
  check(await page.locator(".wallet-context-header h1").innerText() === "Everyday wallet",
    id + ": selected wallet stays visible");
  check(await page.locator(".wallet-context-header h1").evaluate((node) => {
    const box = node.getBoundingClientRect(), font = parseFloat(getComputedStyle(node).fontSize);
    return box.width >= font * 6 && box.height <= font * 4;
  }), id + " / " + width + ": wallet name has readable width and wrapping");
  check(await page.locator(".wallet-context-header .wallet-home").isVisible(),
    id + ": Return home remains available");
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    id + " / " + width + ": no horizontal overflow");
  if (id === "recovery") check(await page.locator("#panel-recovery")
    .getByRole("heading", { name: "Security", exact: true }).isVisible(),
  "Security destination uses its new label");
  if (id === "swap") await page.screenshot({
    path: resolve(output, "swap-" + width + "-" + theme + ".png") });
}

async function checkHeaderLifecycle() {
  await page.evaluate(async () => {
    const { setModal } = await import("/app-loop.js");
    setModal(document.querySelector("#app>.wallet-page"), true);
    (await import("/wallet-marble.js")).presentWalletMarble(document);
    document.querySelector(".wallet-home").focus();
  });
  check(await page.locator(".wallet-context-header").evaluate((node) => node.inert
    && !node.contains(document.activeElement)), "modal background cannot focus the wallet header");
  await page.evaluate(async () => {
    (await import("/app-loop.js")).setModal(document.querySelector("#app>.wallet-page"), false);
    const { setLocked } = await import("/app-keystore.js");
    setLocked({}); (await import("/app-loop.js")).draw();
  });
  check(await page.locator(".wallet-context-header").count() === 0
    && await page.getByRole("heading", { name: "Zigs is locked" }).isVisible(),
  "locked vault hides the wallet header");
  await page.evaluate(async () => {
    (await import("/app-keystore.js")).setLocked(null);
    (await import("/app-loop.js")).draw();
  });
  await page.waitForSelector(".wallet-context-header .wallet-marble-live canvas");
  check(await page.locator(".wallet-context-header h1").innerText() === "Everyday wallet",
    "unlocking restores the actual selected wallet context");
  await page.evaluate(async () => {
    const { state, ready } = await import("/app-state.js");
    const { FLOW_FIXTURES } = await import("/dev/metal-orbs/flow-fixtures.js");
    const { signPins } = await import("/app-filter.js");
    const { setSecrets } = await import("/app-keystore.js");
    const g = state.groups[1]; g.version = 1; signPins["version:" + g.id] = "1";
    state.g = g; state.gid = g.id;
    state.wallet = { ...state.wallet, address: FLOW_FIXTURES.everyday.zcash.address };
    ready[g.id] = state.wallet;
    setSecrets({ [g.id + ":1"]: { uid: "fixture-local", keyPackage: "synthetic",
      checkedWallet: JSON.stringify(state.wallet) } });
    (await import("/app-loop.js")).draw();
  });
  await page.waitForSelector(".wallet-context-header .wallet-marble-live canvas");
  check(await page.locator(".wallet-context-header h1").innerText() === "Travel wallet",
    "wallet switching replaces the header identity without stale wallet text");
}

async function checkHeaderPreferences() {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.evaluate(async () => {
    (await import("/app-state.js")).state.g.name = "SharedHouseholdAndTravelWalletWithALongName";
    (await import("/app-loop.js")).draw();
    const sizes = [...document.querySelectorAll(".wallet-context-header *")]
      .map((node) => [node, getComputedStyle(node).fontSize]);
    for (const [node, size] of sizes) node.style.fontSize = parseFloat(size) * 2 + "px";
  });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "long wallet names and doubled header text remain inside the phone viewport");
  check(await page.locator(".wallet-home").evaluate((node) => {
    const box = node.getBoundingClientRect(); return box.width >= 48 && box.height >= 48;
  }), "Return home retains a 48px target with enlarged text and forced colors");
  await page.screenshot({ path: resolve(output, "header-preferences-320.png") });
  await page.emulateMedia({ forcedColors: "none", reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(async () => {
    (await import("/app-state.js")).state.g.name = "Travel wallet";
    (await import("/app-loop.js")).draw();
  });
}

try {
  await overviewFixture(context, page);
  // Complete the newer entry popup using its normal controls before exercising navigation.
  const privacyPopup = page.locator("#privacy-demo-popup");
  if (await privacyPopup.isVisible()) {
    await privacyPopup.getByRole("button", { name: "Close privacy setup", exact: true }).click();
    await privacyPopup.getByRole("button", { name: "Continue without Tor", exact: true }).click();
    await privacyPopup.waitFor({ state: "hidden" });
  }
  await page.evaluate(async () => {
    const { state, ready } = await import("/app-state.js");
    const { FLOW_FIXTURES } = await import("/dev/metal-orbs/flow-fixtures.js");
    const { signPins } = await import("/app-filter.js");
    const { setSecrets } = await import("/app-keystore.js");
    (await import("/app-groups.js")).setMe("fixture-local");
    state.g.version = 1; signPins["version:" + state.gid] = "1";
    state.wallet = { ...state.wallet, network: "testnet",
      address: FLOW_FIXTURES.ember.zcash.address };
    state.seats[1].uid = "fixture-local";
    ready[state.gid] = state.wallet;
    setSecrets({ [state.gid + ":1"]: { uid: "fixture-local", keyPackage: "synthetic",
      checkedWallet: JSON.stringify(state.wallet) } });
    (await import("/app-loop.js")).draw();
    window.originalHeader = document.querySelector(".wallet-context-header");
  });
  await page.waitForSelector(".wallet-context-header .wallet-marble-live canvas");
  await page.evaluate(() => {
    window.originalHeaderCanvas = document.querySelector(".wallet-context-header canvas");
  });
  const routes = ["overview", "approvals", "activity", "recipients", "swap", "chats",
    "recovery", "settings"];
  const layouts = [1440, 1024, 768, 390, 320].flatMap((width) =>
    ["dark", "light"].map((theme) => ({ width, theme })));
  for (const { width, theme } of layouts) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    for (const id of routes) await checkRoute(id, width, theme);
    await page.screenshot({ path: resolve(output, "settings-" + width + "-" + theme + ".png") });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigate("swap");
  await page.locator("#swap-amount").fill("1.25");
  await page.locator("#swap-amount").focus();
  await page.evaluate(async () => {
    window.swapAmount = document.querySelector("#swap-amount");
    (await import("/app-loop.js")).draw();
  });
  check(await page.evaluate(() => window.swapAmount === document.querySelector("#swap-amount")
    && document.activeElement === window.swapAmount && window.swapAmount.value === "1.25"),
  "ordinary redraw preserves Swap input, focus and value");
  await navigate("recovery");
  await page.evaluate(() => scrollTo(0, 600));
  check(await page.locator(".wallet-context-header").evaluate((node) =>
    Math.abs(node.getBoundingClientRect().top) < 2),
      "wallet header remains visible when scrolling");
  await page.evaluate(() => scrollTo(0, 0));
  await checkHeaderLifecycle();
  await checkHeaderPreferences();
  await page.evaluate(async () => {
    const { state, ui } = await import("/app-state.js");
    state.g = null; state.gid = null; ui.tab = "chats";
    (await import("/app-loop.js")).draw();
  });
  check(await page.locator(".wallet-context-header h1").innerText() === "Travel wallet",
    "independent chat lifecycle keeps read-only wallet navigation context");
  await navigate("recipients");
  check(await page.locator(".wallet-context-header").count() === 1,
    "wallet context survives leaving the independent messaging workspace");
  await page.locator(".wallet-home").click(); await settleOverview(page);
  check(await page.locator(".wallet-context-header").count() === 0,
    "Return home clears the selected-wallet header");
  check(await page.locator("#tab-recovery").innerText() === "Security",
    "sidebar consistently says Security");
  check(errors.length === 0, "no browser errors");
  writeFileSync(resolve(output, "validation.json"), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, output }));
} finally {
  await context.close(); await browser.close();
}
