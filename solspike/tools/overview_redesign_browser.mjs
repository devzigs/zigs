// Run with PLAYWRIGHT_MODULE and CHROME_EXECUTABLE, using fresh synthetic browser stores.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { overviewFixture, settleOverview } from "../harness/overview-redesign-fixture.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const output = resolve(process.env.ZIGS_OVERVIEW_OUTPUT
  || "docs/ux-redesign/visuals/premium-overview/after");
mkdirSync(output, { recursive: true });
const checks = [], errors = [];
const check = (pass, label) => checks.push({ pass: !!pass, label });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });
const context = await browser.newContext({ reducedMotion: "reduce" });
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
const capture = (name) => page.screenshot({ path: resolve(output, name + ".png"), fullPage: true });
const draw = () => page.evaluate(async () => (await import("/app-loop.js")).draw());

async function layout(width, theme) {
  const facts = await page.evaluate(() => {
    const rect = (selector) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
    };
    const buttons = [...document.querySelectorAll(".premium-overview-grid button,"
      + ".premium-overview-grid summary")].filter((n) => n.getClientRects().length);
    return { overflow: document.documentElement.scrollWidth > innerWidth + 1,
      hero: rect(".overview-hero"), assets: rect(".asset-section"),
      activity: rect(".overview-transactions"), custody: rect(".shared-control"),
      railGap: parseFloat(getComputedStyle(document.querySelector(".overview-rail")).rowGap),
      targets: buttons.every((n) => {
        const r = n.getBoundingClientRect(); return r.width >= 47.5 && r.height >= 47.5;
      }), rows: document.querySelectorAll(".asset-row").length };
  });
  const label = width + " " + theme;
  check(!facts.overflow, label + ": no horizontal overflow");
  check(facts.targets && facts.rows === 3, label + ": three assets and 48px controls");
  if (width >= 1100) {
    check(facts.custody.x >= facts.hero.right && facts.activity.x >= facts.assets.right,
      label + ": balanced desktop columns");
    check(Math.abs(facts.hero.y - facts.custody.y) < 2
      && Math.abs(facts.activity.y - facts.custody.bottom - facts.railGap) < 2,
    label + ": transactions follow shared control with the normal section gap");
  } else check(facts.hero.bottom <= facts.assets.y && facts.assets.bottom <= facts.activity.y
    && facts.activity.bottom <= facts.custody.y, label + ": deliberate mobile reading order");
}

async function matrix() {
  for (const width of [1440, 1280, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    for (const theme of ["dark", "light"]) {
      await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await settleOverview(page);
      await layout(width, theme);
      await capture("pending-" + width + "-" + theme);
    }
  }
}

async function assetDetails() {
  for (const id of ["zec", "sol", "usdc"]) {
    const summary = page.locator("#" + id + "-asset-details>summary");
    await summary.focus(); await summary.press("Enter"); await draw();
    check(await page.locator("#" + id + "-asset-details").getAttribute("open") !== null,
      id + ": native disclosure remains open after a real redraw");
    check(await summary.evaluate((n) => n === document.activeElement),
      id + ": disclosure retains keyboard focus");
    await summary.press("Enter");
  }
  const assets = page.locator(".asset-rows");
  for (const id of ["zec", "usdc"]) check(await assets.locator("[aria-labelledby=asset-"
    + id + "] .shielding-actions button").evaluateAll((ns) => ns.every((n) => n.disabled)),
  id + ": unavailable transfers stay disabled");
  check(await assets.locator("[aria-labelledby=asset-sol] .shielding-actions button")
    .evaluateAll((ns) => ns.every((n) => !n.disabled)), "SOL retains existing form launchers");
  check(await page.getByText("Do not deposit USDC to this wallet.", { exact: true }).isVisible(),
    "USDC deposit restriction remains visible");
}

async function activityStates() {
  const recent = page.getByRole("button", { name: "Recent", exact: true });
  await recent.focus(); await recent.press("Enter");
  await page.getByText("No recent transactions", { exact: true }).waitFor();
  check(await recent.getAttribute("aria-pressed") === "true", "Recent selects by keyboard");
  check(await recent.evaluate((n) => n === document.activeElement), "Recent retains focus");
  await capture("recent-320-light");
  await page.evaluate(async () => {
    const { state } = await import("/app-state.js");
    state.sessions = [{ id: "synthetic-failure", status: "failed", error: "Synthetic failure",
      by: 1, createdAt: 1792735200000, payees: [{ to: "synthetic", amount: 1000 }] }];
  });
  await draw();
  check(await page.locator(".recent-transactions .row-item").count() > 0,
    "populated Recent reuses actual transaction rows");
  await page.setViewportSize({ width: 1440, height: 900 });
  await capture("recent-populated-1440-light");
  await page.evaluate(async () => {
    const { state } = await import("/app-state.js");
    const { sessionLayer } = await import("/app-drawer.js");
    document.getElementById("app").append(sessionLayer(state.sessions[0]));
  });
  await settleOverview(page);
  const receipt = page.locator(".transaction-receipt .review-context");
  check(await receipt.locator(".wallet-avatar").getAttribute("src")
    === await page.locator(".wallet-identity>.wallet-avatar").getAttribute("src"),
  "payment review uses the same wallet identity");
  await receipt.screenshot({ path: resolve(output, "review-context-1440-light.png") });
  await page.evaluate(async () => {
    const { state, ui } = await import("/app-state.js");
    state.sessions = []; state.sessionsFailed = true; ui.overviewActivity = "pending";
  });
  await draw();
  check(await page.getByText(/could not be read/).isVisible(), "failed reads retain their notice");
  check(await page.getByText("No approvals waiting", { exact: true }).count() === 0,
    "failed read never claims an empty queue");
  await page.evaluate(async () => {
    const { state } = await import("/app-state.js");
    state.sessionsFailed = false; state.sessionsLoaded = false;
  });
  await draw();
  check(await page.getByText(/Checking the payments of this wallet/).isVisible(),
    "unread payments retain their checking state");
  await page.evaluate(async () => { (await import("/app-state.js")).state.sessionsLoaded = true; });
  await draw();
}

async function actionLaunchers() {
  const picker = page.locator(".overview-action-picker").filter({
    has: page.locator("summary").filter({ hasText: /^Receive$/ }) });
  await picker.locator("summary").press("Enter");
  await capture("receive-choices-1440-light");
  check(await picker.getByRole("button", { name: /USDC/ }).isDisabled(),
    "Receive never enables USDC");
  await picker.getByRole("button", { name: /^ZEC/ }).click();
  await page.getByRole("dialog").waitFor();
  check(await page.getByRole("heading", { name: "Receive ZEC", exact: true }).isVisible(),
    "Receive opens the original ZEC dialog");
  const sources = await page.locator(".wallet-identity>.wallet-avatar,.dialog .wallet-avatar")
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("src")));
  check(sources.length === 2 && sources[0] === sources[1],
    "transaction dialog uses the same wallet avatar");
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  check(await page.evaluate(async () => !(await import("/app-state.js")).state.sid),
    "opening Receive creates no proposal");
  check(await page.locator(".overview-hero")
    .getByRole("button", { name: "Swap", exact: true }).isDisabled(),
    "Swap stays unavailable");
}

async function membership() {
  await page.evaluate(async () => {
    const { state } = await import("/app-state.js");
    delete state.seats[3];
  });
  await draw();
  check(await page.getByText("3 participating devices · 2 joined", { exact: true }).isVisible(),
    "configured participants and joined devices stay distinct");
  check(await page.locator(".custody-device-state").last().innerText() === "Not joined",
    "missing seat does not invent invitation delivery or online status");
  await page.evaluate(async () => {
    const { state } = await import("/app-state.js"); state.seatsLoaded = false;
  });
  await draw();
  check(await page.locator(".custody-device-state").last().innerText() === "Checking",
    "unread membership is unknown");
  await page.evaluate(async () => {
    const { state } = await import("/app-state.js");
    state.seatsLoaded = true; state.seats[3] = { name: "Reserve" };
    state.g.shapeMoved = true;
  });
  await draw();
  check(await page.getByText("Configuration mismatch", { exact: true }).isVisible(),
    "configuration mismatch remains explicit");
  await page.evaluate(async () => { delete (await import("/app-state.js")).state.g.shapeMoved; });
  await draw();
  const open = page.locator(".shared-control").getByRole("button", { name: /Security/ });
  await open.click();
  await page.getByRole("heading", { name: "Devices and approval rule", exact: true }).waitFor();
  check(true, "Shared control opens the existing Security destination");
  await page.evaluate(async () => { (await import("/app-state.js")).ui.tab = "overview"; });
  await draw();
}

async function identities() {
  const before = await page.locator(".wallet-identity>.wallet-avatar").getAttribute("src");
  await draw(); await settleOverview(page);
  const after = await page.locator(".wallet-identity>.wallet-avatar").getAttribute("src");
  const side = await page.locator(".wallet-context .wallet-avatar").first().getAttribute("src");
  check(before === after && after === side, "header/sidebar identity survives redraws");
  await page.locator(".wallet-picker-trigger").click();
  await settleOverview(page);
  const current = await page.locator(".wallet-picker-row[aria-checked=true] .wallet-avatar")
    .getAttribute("src");
  check(current === after, "switcher identity matches Overview");
  await page.keyboard.press("Escape");
  check(await page.locator(".wallet-picker-trigger").evaluate((n) => n === document.activeElement),
    "wallet menu Escape restores focus");
  await page.setViewportSize({ width: 320, height: 844 });
  await page.locator(".wallet-picker-trigger").click();
  await settleOverview(page);
  check(await page.locator(".wallet-picker-row").evaluateAll((rows) => rows.every((row) =>
    row.querySelector(".wallet-avatar").getBoundingClientRect().right
      < row.querySelector(".wallet-picker-copy").getBoundingClientRect().left)),
  "phone wallet menu reserves space for each avatar");
  await capture("wallet-switcher-320-light");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 900 });
  const race = await page.evaluate(async () => {
    const { state } = await import("/app-state.js");
    const { walletAvatarFor } = await import("/app-wallet-identity.js");
    const first = { ...state.g, id: "ba".repeat(10) };
    const second = { ...state.g, id: "bb".repeat(10) };
    const { ready } = await import("/app-state.js");
    ready[first.id] = { address: "utest1" + "p".repeat(180) };
    ready[second.id] = { address: "utest1" + "z".repeat(180) };
    const host = document.createElement("div"), old = walletAvatarFor(first);
    document.body.append(host); host.append(old);
    const fresh = walletAvatarFor(second); host.replaceChildren(fresh);
    await new Promise((done) => setTimeout(done, 100));
    const { describeOrb } = await import("/wallet-identity.js");
    const { fallbackUrl } = await import("/wallet-avatar-svg.js");
    const expected = fallbackUrl(await describeOrb("zcash:testnet", ready[second.id].address));
    const result = fresh.getAttribute("src") === expected && !old.isConnected;
    host.remove(); delete ready[first.id]; delete ready[second.id]; return result;
  });
  check(race, "late avatar work cannot cross wallet contexts");
}

async function largeValues() {
  await page.evaluate(async () => {
    const { balanceOverview } = await import("/app-wallet.js");
    document.querySelector(".overview-hero").replaceWith(balanceOverview(123456789.12));
    const chain = await import("/app-chain.js");
    chain.chain.bal.spendable = 123456712345678;
    chain.chain.bal.pending = 2345678;
  });
  check(await page.locator("[data-valuation-state=known]").innerText() === "$123,456,789.12",
    "finite USD valuation formats without a placeholder");
  await capture("known-usd-1440-light");
  await draw();
  await page.setViewportSize({ width: 320, height: 844 });
  await settleOverview(page);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "full-precision large native balance fits 320px");
  check(await page.locator("[aria-labelledby=asset-zec] .money.xl")
    .getAttribute("aria-label") === "1,234,567.12345678 ZEC", "large ZEC retains exact precision");
  await capture("large-balance-320-light");
}

async function preferences() {
  await page.evaluate(() => {
    const nodes = [...document.querySelectorAll(".main *")];
    const sizes = nodes.map((node) => parseFloat(getComputedStyle(node).fontSize));
    nodes.forEach((node, i) => { node.style.fontSize = sizes[i] * 2 + "px"; });
  });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "doubled text fits a 320px viewport");
  await capture("doubled-text-320-light");
  await draw();
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  check(await page.evaluate(() => getComputedStyle(document.querySelector(".overview-hero"))
    .backgroundImage === "none"), "forced colors remove decorative financial materials");
  check(await page.evaluate(() => getComputedStyle(document.querySelector(
    ".asset-rows .privacy-shielded>span:last-child")).color === getComputedStyle(
      document.body).color),
  "forced-color shielded text uses readable system text color");
  await capture("forced-colors-320");
  await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
  check(await page.evaluate(() => !document.querySelector(".premium-overview-grid")
    .getAnimations({ subtree: true }).length), "reduced motion has no active Overview animations");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setEmulatedMedia", { features: [
    { name: "prefers-reduced-transparency", value: "reduce" },
    { name: "prefers-reduced-motion", value: "reduce" },
  ] });
  const picker = page.locator(".overview-action-picker").first();
  await picker.locator("summary").press("Enter");
  check(await picker.locator(".asset-choices").evaluate((n) =>
    getComputedStyle(n).backdropFilter === "none"), "reduced transparency keeps choices opaque");
  await picker.locator("summary").press("Enter");
  await cdp.detach();
}

async function syncAndNames() {
  for (const mode of ["stale", "resync"]) {
    await page.evaluate(async (value) => {
      await (await import("/app-sol.js")).overviewFixtureSol(value);
    }, mode);
    await draw();
    check((await page.locator("[aria-labelledby=asset-sol] .asset-row-status").innerText())
      .includes(mode === "stale" ? "Sync failed" : "Syncing"),
    mode + ": SOL freshness is explicit");
  }
  await page.evaluate(async () => {
    const { state } = await import("/app-state.js");
    state.g.name = "Travel and shared household expenses — a very long wallet name";
    await (await import("/app-sol.js")).overviewFixtureSol();
  });
  await draw();
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "long wallet names remain within the phone viewport");
  await page.locator(".wallet-picker-trigger").click();
  check(await page.locator(".wallet-picker-row[aria-checked=true]").innerText()
    .then((text) => text.includes("shared household expenses")),
  "switcher retains the full wallet name");
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    (await import("/app-state.js")).state.g.name = "Everyday wallet";
  });
  await draw();
}

async function eventMotion() {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(async () => {
    (await import("/app-state.js")).state.g.n = 4;
  });
  await draw();
  check(await page.locator(".custody-node.motion-complete-enter").count() === 0,
    "initial membership never animates a completed event");
  await page.evaluate(async () => {
    (await import("/app-state.js")).state.seats[4] = { name: "Fourth device" };
  });
  await draw();
  const completed = page.locator(".custody-device").last().locator(".motion-complete-enter");
  check(await completed.count() === 1,
    "an observed membership change receives existing event-driven feedback");
  await page.waitForTimeout(350);
  await draw();
  check(await page.locator(".custody-node.motion-complete-enter").count() === 0,
    "routine redraw does not replay a membership completion");
  await page.evaluate(async () => {
    const { state } = await import("/app-state.js"); state.g.n = 3; delete state.seats[4];
  });
  await page.emulateMedia({ reducedMotion: "reduce" }); await draw();
}

try {
  await overviewFixture(context, page);
  await matrix(); await assetDetails(); await activityStates(); await actionLaunchers();
  await membership(); await identities(); await largeValues(); await syncAndNames();
  await eventMotion(); await preferences();
} finally {
  await browser.close();
  const report = {
    fixture: "Synthetic unfunded renderer; real redraw/controls; no external services",
    checks, errors, failures: checks.filter((c) => !c.pass) };
  writeFileSync(resolve(output, "validation.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ checks: checks.length, failures: report.failures, errors }));
  if (report.failures.length || errors.length) process.exitCode = 1;
}
