// Motion/interaction review against real renderers and isolated synthetic wallet data.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { overviewFixture, settleOverview } from "../harness/overview-redesign-fixture.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const out = resolve(process.env.ZIGS_PREMIUM_OUTPUT || "solspike/.state/premium-ui-review");
mkdirSync(out, { recursive: true });
const checks = [], layouts = [], errors = [], motion = [];
const check = (pass, label) => { assert.ok(pass, label); checks.push(label); };
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 },
  recordVideo: { dir: resolve(out, "video"), size: { width: 1440, height: 1000 } } });
const page = await context.newPage();
page.setDefaultTimeout(5000);
page.on("pageerror", (error) => errors.push(error.stack || error.message));
// The renderer fixture has no engine. Hold main's minute-based chain refresh during this
// longer visual review; real synchronization remains covered by the repository's own tests.
await page.addInitScript(() => {
  const interval = window.setInterval.bind(window);
  window.setInterval = (callback, delay, ...args) => delay === 60000 ? 0
    : interval(callback, delay, ...args);
});

async function choose(tab, theme = "dark") {
  await page.evaluate(async ({ tab, theme }) => {
    const { state, ui } = await import("/app-state.js");
    document.documentElement.dataset.theme = theme;
    state.g = tab === "home" ? null : state.groups[0]; state.gid = state.g?.id ?? null;
    ui.tab = tab === "home" ? "overview" : tab;
    (await import("/app-loop.js")).draw();
  }, { tab, theme });
  await settleOverview(page);
}

const snapshot = () => page.evaluate(async () => {
  const { state } = await import("/app-state.js");
  return JSON.stringify({ groups: state.groups, wallet: state.wallet, seats: state.seats,
    sessions: state.sessions, storage: { ...localStorage }, hash: location.hash });
});

async function geometry(selector) {
  return page.locator(selector).first().evaluate((node) => {
    const { x, y, width, height } = node.getBoundingClientRect();
    return { x, y, width, height, text: node.textContent };
  });
}

async function reviewPage(tab) {
  await choose(tab);
  const facts = await page.evaluate(() => {
    const headings = document.querySelectorAll("#app h1,#app h2");
    const moving = [...headings].flatMap((node) => node.getAnimations())
      .filter((animation) => animation.effect.getTiming().duration >= 400);
    return { moving: moving.length, surfaces: document.querySelectorAll(
      "#app [data-premium-surface]").length };
  });
  motion.push({ tab, ...facts });
  // Some operational headings are deliberately excluded if they contain safety information.
  check(facts.moving > 0, tab + ": page title has a measured, finite entrance");
  await page.waitForTimeout(850);
  await page.evaluate(async () => (await import("/app-loop.js")).draw());
  check(await page.evaluate(() => ![...document.querySelectorAll("#app h1,#app h2")]
    .some((node) => node.getAnimations().some((a) => a.playState === "running"))),
  tab + ": background redraw does not replay title entrances");
}

async function hoverReview() {
  await choose("overview"); await page.waitForTimeout(850);
  const target = ".overview-actions .btn";
  const before = await geometry(target), balance = await geometry(".portfolio-value");
  await page.locator(target).first().hover(); await page.waitForTimeout(400);
  check(JSON.stringify(before) === JSON.stringify(await geometry(target)),
    "hover keeps the full action hit area fixed");
  check(JSON.stringify(balance) === JSON.stringify(await geometry(".portfolio-value")),
    "hover keeps the exact portfolio text and position fixed");
  check(await page.locator(target).first().evaluate((node) => {
    const detail = node.querySelector(".icon-detail");
    return detail && getComputedStyle(detail).translate !== "none";
  }), "Send arrow articulates separately from its stationary control");
  await page.mouse.move(360, 165); await page.waitForTimeout(420);
  check(await page.locator(".overview-hero").evaluate((node) =>
    Number(getComputedStyle(node, "::after").opacity) > .5),
  "pointer light responds on the portfolio frame");
  check(await page.locator(".portfolio-value").evaluate((node) => {
    for (let n = node; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.transform !== "none" || Number(s.opacity) !== 1) return false;
    }
    return true;
  }), "financial value and its ancestors never transform or fade");
  await page.screenshot({ path: resolve(out, "overview-hover.png") });
}

async function artworkReview() {
  await choose("chats"); await page.waitForTimeout(1300);
  check(await page.locator(".messages-empty-art .symbol-sculpted").count() === 1,
    "Messages uses a layered 64-unit relief object");
  const object = page.locator(".messages-empty-art");
  const before = await object.locator(".relief-face .relief-part-1").evaluate(
    (node) => getComputedStyle(node).translate);
  await object.hover(); await page.waitForTimeout(650);
  check(before !== await object.locator(".relief-face .relief-part-1").evaluate(
    (node) => getComputedStyle(node).translate), "message relief separates its physical layers");
  check(await page.evaluate(() => ![...document.querySelectorAll(".premium-empty-art")]
    .some((node) => node.getAnimations().some((a) =>
      a.effect.getTiming().iterations === Infinity))),
  "new empty-state artwork has no endless idle animation");
  await page.screenshot({ path: resolve(out, "messages-relief.png") });
}

async function pressReview() {
  await choose("overview"); await page.waitForTimeout(850);
  const action = page.locator(".overview-actions .btn").first();
  const before = await geometry(".overview-actions .btn");
  await action.hover(); await page.waitForTimeout(350);
  await page.mouse.down(); await page.waitForTimeout(120);
  check(JSON.stringify(before) === JSON.stringify(await geometry(".overview-actions .btn")),
    "pointer press keeps the complete button hit area stationary");
  check(await action.locator(".symbol").evaluate((node) =>
    Number(getComputedStyle(node).scale) < 1), "press compresses only the decorative icon");
  await page.screenshot({ path: resolve(out, "overview-press.png") });
  await page.mouse.move(230, 940); await page.mouse.up(); await page.waitForTimeout(400);
  check(await action.locator(".icon-detail").evaluate((node) =>
    getComputedStyle(node).translate === "0px"), "icon settles after pointer departure");
  await action.focus(); await page.keyboard.down("Space"); await page.waitForTimeout(100);
  check(JSON.stringify(before) === JSON.stringify(await geometry(".overview-actions .btn")),
    "keyboard press leaves the focus ring and control geometry stationary");
  check(await action.evaluate((node) => parseFloat(getComputedStyle(node).outlineWidth) >= 2),
    "keyboard focus retains a visible outline during the press");
  await action.evaluate((node) => node.blur()); await page.keyboard.up("Space");
  await choose("swap");
  const disabled = page.getByRole("button", { name: "Review demo swap", exact: true });
  const idle = await disabled.locator(".icon-detail").evaluate((node) =>
    getComputedStyle(node).translate);
  await disabled.hover({ force: true }); await page.waitForTimeout(350);
  check(idle === await disabled.locator(".icon-detail").evaluate((node) =>
    getComputedStyle(node).translate), "disabled actions have no inviting icon gesture");
}

async function navigationReview() {
  for (const tab of ["approvals", "activity", "chats", "settings"]) {
    await choose(tab);
    const fact = await page.locator("#side-nav .side-item[aria-current=page]").evaluate((node) => ({
      title: node.textContent,
      mark: node.querySelector(".symbol").getAnimations().some((a) =>
        a.playState === "running" && a.effect.getTiming().duration === 360),
      rail: getComputedStyle(node, "::before").animationName,
    }));
    check(fact.mark && fact.rail === "premium-selection-arrive",
      tab + ": active navigation icon and selection rail settle together");
  }
  await page.waitForTimeout(850);
  await page.evaluate(async () => (await import("/app-loop.js")).draw());
  check(await page.locator("#side-nav .side-item[aria-current=page]").evaluate((node) =>
    !node.querySelector(".symbol").getAnimations().length
    && getComputedStyle(node, "::before").animationName === "none"),
  "same-screen background redraw does not replay navigation choreography");
  check(await page.evaluate(() => document.getAnimations().every((a) =>
    a.effect?.target?.isConnected !== false)), "rapid navigation leaves no detached animation");
}

async function floatingReview() {
  await choose("swap");
  await page.getByRole("button", { name: "Choose asset to pay", exact: true }).click();
  const swap = page.locator(".swap-modal[open]");
  await swap.waitFor();
  check(await swap.evaluate((node) => getComputedStyle(node).animationName
    === "premium-layer-arrive"), "native swap picker uses the same framing entrance");
  await page.getByRole("button", { name: "Close preview dialog", exact: true }).click();
  check(await page.locator(".swap-modal[open]").count() === 0,
    "native swap picker dismisses immediately through its existing close action");
  await choose("overview");
  await page.locator("#privacy-demo-status").click();
  const popup = page.locator(".privacy-demo-popup[open]");
  await popup.waitFor();
  const close = page.getByRole("button", { name: "Close the Tor demo", exact: true });
  check(await close.evaluate((node) => {
    const r = node.getBoundingClientRect();
    return r.width >= 48 && r.height >= 48
      && getComputedStyle(node, "::before").content !== "none";
  }), "standalone demo has a crisp close mark inside a 48 px target");
  await close.click();
  check(await page.locator(".privacy-demo-popup[open]").count() === 0,
    "standalone demo close action is immediate");
}

async function dialogReview(kind) {
  await choose(kind === "create" ? "home" : "overview");
  await page.evaluate(async (kind) => {
    (await import("/app-state.js")).ui[kind] = true;
    (await import("/app-loop.js")).draw();
  }, kind);
  await page.getByRole("dialog").waitFor();
  check(await page.getByRole("dialog").evaluate((node) => {
    const moving = node.getAnimations().filter((a) => a.playState === "running");
    return moving.every((a) => a.effect.getKeyframes().every((frame) =>
      !frame.transform && !frame.translate && frame.opacity === undefined));
  }), kind + ": dialog entrance animates framing without moving or fading its content");
  check(await page.evaluate(() => document.querySelector(".dialog")
    .contains(document.activeElement)), kind + ": existing initial focus stays inside the dialog");
  const stable = page.locator(".dialog .addr-full,.dialog .qr");
  const rects = await stable.evaluateAll((nodes) => nodes.map((node) => {
    const { x, y, width, height } = node.getBoundingClientRect();
    return { x, y, width, height, text: node.textContent };
  }));
  await page.waitForTimeout(550);
  check(JSON.stringify(rects) === JSON.stringify(await stable.evaluateAll((nodes) =>
    nodes.map((node) => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height, text: node.textContent };
    }))), kind + ": address and QR stay stable throughout the entrance");
  for (let i = 0; i < 14; i++) await page.keyboard.press("Tab");
  check(await page.evaluate(() => document.querySelector(".dialog")
    .contains(document.activeElement)), kind + ": Tab remains in the existing focus loop");
  await page.screenshot({ path: resolve(out, kind + "-dialog.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  check(true, kind + ": Escape dismisses through the existing handler");
}

async function phoneDialogReview(kind) {
  await page.setViewportSize({ width: 390, height: 844 });
  await choose(kind === "create" ? "home" : "overview");
  await page.evaluate(async (kind) => {
    (await import("/app-state.js")).ui[kind] = true;
    (await import("/app-loop.js")).draw();
  }, kind);
  await page.getByRole("dialog").waitFor(); await page.waitForTimeout(550);
  check(await page.getByRole("dialog").evaluate((node) =>
    node.scrollWidth <= node.clientWidth + 1), kind + ": phone dialog content does not overflow");
  if (kind === "receive") check(await page.locator(".dialog .qr").evaluate((node) => {
    const r = node.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight;
  }), "Receive: complete QR is visible in the initial phone viewport");
  await page.screenshot({ path: resolve(out, kind + "-phone.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
}

async function guideReview() {
  await choose("home");
  await page.getByRole("button", { name: "How Zigs works", exact: true }).first().click();
  await page.getByRole("dialog", { name: "How Zigs works" }).waitFor();
  await page.getByRole("button", { name: "Explore the journeys", exact: true }).click();
  await page.locator(".hw-journey-choice").nth(1).click();
  await page.waitForTimeout(650);
  check(await page.locator(".hw-journey-choice[aria-pressed=true]").count() === 1,
    "guide retains manual journey selection");
  await page.getByRole("button", { name: "Pause illustrations", exact: true }).click();
  check(await page.locator(".hw-art").first().evaluate((node) =>
    getComputedStyle(node).animationPlayState === "paused"),
  "guide pause also suspends the new artwork entrance");
  await page.getByRole("button", { name: "Resume illustrations", exact: true }).click();
  await page.screenshot({ path: resolve(out, "guide-motion.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
}

async function responsiveReview() {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const variants = ["dark", "light"].flatMap((theme) =>
    [320, 390, 768, 1440].map((width) => ({ theme, width })));
  for (const { theme, width } of variants) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    for (const tab of ["home", "overview", "approvals", "activity", "recipients", "swap",
      "chats", "recovery", "settings"]) {
      await choose(tab, theme);
      const facts = await page.evaluate(() => {
        const ids = [...document.querySelectorAll("[id]")].map((node) => node.id);
        return { overflow: document.documentElement.scrollWidth > innerWidth + 1,
          distinctIds: ids.length === new Set(ids).size,
          headerHeight: document.querySelector(".wallet-context-header")?.offsetHeight ?? 0 };
      });
      check(!facts.overflow, `${tab} ${theme} ${width}: no horizontal overflow`);
      check(facts.distinctIds, `${tab} ${theme} ${width}: unique SVG/control identifiers`);
      layouts.push({ tab, theme, width, ...facts });
      if ([390, 1440].includes(width)) await page.screenshot({
        path: resolve(out, `${tab}-${width}-${theme}.png`), animations: "disabled" });
    }
  }
}

async function accessibleMotionReview() {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await choose("chats");
  check(await page.evaluate(() => [...document.querySelectorAll("#app *")].every((node) =>
    node.getAnimations().every((a) => a.playState !== "running"))),
  "reduced motion leaves content available with no running app animations");
  await page.emulateMedia({ reducedMotion: "no-preference", forcedColors: "active" });
  await choose("recipients");
  check(await page.locator(".relief-face").first().evaluate((node) =>
    !getComputedStyle(node).stroke.startsWith("url")),
  "forced colors replaces metallic gradients with system text color");
  check(await page.evaluate(() => document.documentElement.classList.contains("premium-paused")),
    "forced colors disables the new ambient experience");
  await page.emulateMedia({ forcedColors: "none" });
  await choose("overview");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    Object.defineProperty(document, "visibilityState", {
      configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  check(await page.evaluate(() => document.documentElement.classList.contains("premium-paused")
    && !document.querySelector(".premium-lit")),
  "hidden document cancels ambient animation and pointer light");
  await page.evaluate(async () => {
    // A fresh synthetic sync age keeps main's real sync-on-return listener outside this QA.
    (await import("/app-chain.js")).curChain().balAt = Date.now();
    delete document.hidden; delete document.visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(900);
  check(await page.evaluate(() => ![...document.querySelectorAll("#app h1,#app h2")]
    .some((node) => node.getAnimations().some((a) => a.playState === "running"))),
  "returning to the document does not replay the canceled page entrance");
  await choose("chats"); await page.waitForTimeout(150);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await settleOverview(page);
  const running = await page.evaluate(() => document.getAnimations().filter((a) =>
    a.playState === "running").map((a) => ({ target: a.effect?.target?.className,
    name: a.animationName || "web-animation" })));
  check(running.length === 0,
    "enabling reduced motion cancels in-flight decorative motion: " + JSON.stringify(running));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForTimeout(850);
  check(await page.locator(".premium-empty-art").evaluate((node) =>
    !node.getAnimations().some((a) => a.playState === "running")),
  "turning motion back on does not replay settled artwork");
}

let video;
try {
  await overviewFixture(context, page);
  await choose("home"); await page.waitForTimeout(1400);
  // Main's device-name field saves on blur. Seed its empty default before the invariant.
  await page.evaluate(() => localStorage.setItem("zf-name", ""));
  const before = await snapshot();
  for (const tab of ["overview", "approvals", "activity", "recipients", "swap", "chats",
    "recovery", "settings", "home"]) await reviewPage(tab);
  await hoverReview(); await artworkReview(); await pressReview(); await navigationReview();
  await floatingReview();
  for (const kind of ["receive", "send", "create"]) await dialogReview(kind);
  for (const kind of ["receive", "send", "create"]) await phoneDialogReview(kind);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await guideReview(); await responsiveReview(); await accessibleMotionReview();
  const after = await snapshot();
  if (before !== after) {
    writeFileSync(resolve(out, "fixture-state-difference.json"),
      JSON.stringify({ before: JSON.parse(before), after: JSON.parse(after) }, null, 2));
  }
  check(before === after,
    "presentation review leaves wallet facts and storage unchanged");
  check(errors.length === 0, "no browser JavaScript errors: " + errors.join("; "));
  video = await page.video().path();
  console.log(`premium UI: ${checks.length} checks, ${layouts.length} page/theme/width variants`);
} finally {
  await context.close(); await browser.close();
  writeFileSync(resolve(out, "report.json"), JSON.stringify({ checks, layouts, motion,
    errors, video: video && "video/" + video.split("/").pop() }, null, 2));
}
