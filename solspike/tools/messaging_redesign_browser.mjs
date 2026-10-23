// Real messaging presentation with synthetic fixtures; no app boot or external service access.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installMessagingFixture } from "../harness/messaging-redesign.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const phase = process.argv[2] || "after";
assert.ok(["before", "after"].includes(phase));
const output = resolve(root, "docs/ux-redesign/visuals/messaging-redesign", phase);
await mkdir(output, { recursive: true });
const mime = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const sourceText = async (relative) => phase === "before"
  ? execFileSync("git", ["show", "HEAD:web/" + relative], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
  : readFile(resolve(root, "web", relative));
const server = createServer(async (req, res) => {
  try {
    const relative = new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
    if (relative.includes("..")) throw Error("Invalid path");
    let body = await sourceText(relative);
    if (relative === "index.html") body = body.toString()
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
      .replace(/<link[^>]+rel="(?:modulepreload|preload)"[^>]*>/g, "");
    if (relative === "app-loop.js") {
      body = body.toString().replace("export function react() {",
        "export function react() { return;")
        .replace("function pageView() {", (
          "function pageView() { if (globalThis.__messagingView) "
          + "return globalThis.__messagingView();"
        ))
        .replace("export function draw() {", (
          "export function draw() { globalThis.__messagingDraws = "
          + "(globalThis.__messagingDraws || 0) + 1;"
        ));
      if (phase === "before") body = body.replace("export function render() {",
        "export function render() { return;");
    }
    res.writeHead(200, { "Content-Type": mime[extname(relative)] || "text/plain" }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const origin = "http://127.0.0.1:" + server.address().port;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });
const context = await browser.newContext({ reducedMotion: "reduce", permissions: [
  "clipboard-read", "clipboard-write"] });
await context.route("**/*", (route) => new URL(route.request().url()).origin === origin ?
  route.continue() : route.abort());
const page = await context.newPage(), errors = [], checks = [], screenshots = [], layouts = [];
page.on("pageerror", (e) => errors.push(e.message));
const settled = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(
  () => requestAnimationFrame(r))));
const check = (ok, label) => { checks.push({ label, pass: !!ok }); assert.ok(ok, label); };
async function scene(name) {
  await page.goto(origin);
  const result = await installMessagingFixture(page, name, phase);
  if (name === "setup" && phase === "after") await page.getByRole("tab", { name: "Zcash",
    exact: true }).click();
  await settled();
  return result;
}
async function capture(name, width, theme) {
  await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
  await page.evaluate(async (theme) => {
    document.documentElement.dataset.theme = theme; window.scrollTo(0, 0);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
  }, theme);
  const file = `${name}-${width}-${theme}.png`;
  await page.screenshot({ path: resolve(output, file), animations: "disabled" });
  screenshots.push(file);
  const png = await readFile(resolve(output, file));
  check(png.readUInt32BE(16) === width && png.readUInt32BE(20) === (width < 600 ? 844 : 1000),
    file + " has the requested viewport dimensions");
  layouts.push(await page.evaluate((file) => ({ file, viewport: { width: innerWidth,
    height: innerHeight },
    surfaces: [".messages-thread", ".messages-composer", ".chat-log", "textarea",
      ".messages-backup-reminder"]
      .map((selector) => { const node = document.querySelector(selector); if (!node) return null;
        const r = node.getBoundingClientRect(); return { selector, top: r.top,
          bottom: r.bottom, width: r.width, height: r.height }; })
      .filter(Boolean) }), file));
  const fit = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  if (phase === "after") check(fit, name + " fits " + width + " " + theme);
}

async function verifyWorkspaceNavigation() {
  await scene("team"); await page.setViewportSize({ width: 1440, height: 1000 });
  const tab = (name) => page.getByRole("tab", { name, exact: true });
  check(await page.getByRole("heading", { name: "Messages", exact: true }).count() === 1,
    "one Messages workspace heading");
  check(await page.locator(".messages-conversation-row").count() === 2,
    "Relay inbox renders Team and Direct as real conversation buttons");
  check(!await page.locator(".messages-inbox").innerText().then((s) => /\[object/.test(s)),
    "inbox never exposes stringified DOM objects");
  check(await page.locator(".vmark").innerText().catch(() => "") !== "Verified person",
    "signatures do not claim personal identity verification");
  check(await page.locator(".vmark").allTextContents().then((xs) => xs.every(
    (s) => /signature matches/i.test(s))),
    "genuine synthetic message signatures preserve continuity marks");
  check(await page.getByRole("combobox", { name: "Send as" }).locator("option").count() === 2,
    "multiple local signing seats preserve sender selection");
  await tab("Relay").focus(); await page.keyboard.press("End");
  await settled();
  check(await tab("Zcash").getAttribute("aria-selected") === "true",
    "End selects the Zcash transport");
  await page.keyboard.press("End");
  await settled();
  check(await tab("Zcash").getAttribute("aria-selected") === "true",
    "End stays on the final transport");
  await page.keyboard.press("Home");
  await settled();
  check(await tab("Relay").getAttribute("aria-selected") === "true", "Home selects Relay");
  await page.keyboard.press("Home");
  await settled();
  check(await tab("Relay").getAttribute("aria-selected") === "true",
    "Home stays on the first transport");
  await page.keyboard.press("ArrowRight");
  await settled();
  const focus = await page.evaluate(() => ({ tag: document.activeElement.tagName,
    key: document.activeElement.dataset.key, text: document.activeElement.textContent.slice(0,
      50) }));
  check(await tab("Zcash").evaluate((n) => n === document.activeElement),
    "arrow navigation moves keyboard focus with transport " + JSON.stringify(focus));
  check(await page.locator(".messages-section-label").allTextContents().then((xs) =>
    xs.includes("On-chain contacts") && !xs.includes("Team")),
      "Zcash filters out relay teams and chats");
  await tab("Relay").click();
  await settled();
  await page.getByRole("searchbox", { name: "Search conversations" }).fill("Studio");
  await settled();
  check(await page.locator(".messages-conversation-row").count() === 1
    && await page.locator(".messages-conversation-row").innerText().then((s) => s.includes(
      "Studio")),
  "search filters real conversation rows");
  await page.getByRole("searchbox", { name: "Search conversations" }).fill("missing contact");
  await settled();
  check(await page.locator(".messages-conversation-row").count() === 0,
    "unmatched search shows no unrelated conversations");
  await page.getByRole("searchbox", { name: "Search conversations" }).fill("");
  await settled();
  const draws = await page.evaluate(() => globalThis.__messagingDraws);
  await page.waitForTimeout(250);
  check(await page.evaluate(() => globalThis.__messagingDraws) === draws,
    "restoring the search field settles without a repeated redraw loop");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".messages-conversation-row").filter({ hasText: "Morgan" }).click();
  await settled();
  check(await page.locator(".messages-inbox").isHidden() && await page.locator(
    ".messages-thread").isVisible(),
    "phone opens one conversation and hides its inbox");
  const composerRect = await page.locator(".messages-composer").boundingBox();
  check(composerRect && composerRect.y >= 0 && composerRect.y + composerRect.height <= 845,
    "phone composer is docked inside the visible viewport");
  await page.getByRole("button", { name: "Back to conversations", exact: true }).click();
  await settled();
  check(await page.locator(".messages-inbox").isVisible() && await page.locator(
    ".messages-thread").isHidden(),
    "phone Back returns to inbox");
  await capture("relay-inbox", 390, "dark");

}

async function verifyRelayStates() {
  await scene("direct");
  const directBox = page.locator("textarea[name=text]");
  await directBox.fill("Synthetic draft survives an offline send.");
  await settled();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await settled();
  check(await directBox.inputValue() === "Synthetic draft survives an offline send.",
    "offline relay keeps the current draft");
  check(await page.locator("#banner-text").innerText().then(
    (s) => /send it when you reconnect|not been sent|No network connection/i.test(s)),
    "offline relay explains that explicit resend is needed");
  check(!await page.locator(".messages-thread").innerText().then(
    (s) => /automatically send|queued|delivered|read receipt/i.test(s)),
    "offline relay never promises an automatic queue or read receipt");
  await capture("relay-offline", 390, "dark");
  await context.setOffline(false);

  await scene("changed-key");
  check(await page.locator("[role=alert]").allTextContents().then((xs) => xs.some(
    (s) => /key.*changed/i.test(s))),
    "changed direct signing key remains a visible warning");
  check(await page.locator(".vmark").allTextContents().then((xs) => xs.some(
    (s) => /not verified/i.test(s))),
    "changed key message is not treated as signature verified");
  await capture("changed-key", 390, "dark");
  await scene("invite");
  check(await page.getByRole("heading", { name: "Invite your contact", exact: true }).count() === 1,
    "existing waiting direct chat retains its invitation controls");
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await settled();
  check(await page.evaluate(() => navigator.clipboard.readText()).then(
    (s) => /#c\.[a-f0-9]{20}\.[\w-]{43}$/.test(s)),
    "direct invitation copy preserves the existing private-link format");
  await capture("direct-invite", 390, "light");

}

async function verifyAccountSetup() {
  await scene("setup");
  check(await page.getByRole("button", { name: "Create account", exact: true }).isEnabled(),
    "Zcash setup reuses the explicit account-creation action");
  check(await page.evaluate(() => globalThis.__messagingFixture.account.personal === null),
    "opening Zcash never creates or replaces an account automatically");
  check(await page.locator(".messages-account-setup").innerText().then(
    (s) => /controls this browser/.test(s)
    && /backup file/i.test(s) && /network fee/.test(s)),
      "setup explains browser control, recovery and fees");

}

async function verifyCostReview() {
  await scene("contact");
  const box = page.locator("#chat-text-oc-1");
  check(await page.getByRole("button", { name: "Send on chain", exact: true }).isEnabled(),
    "funded separate account keeps its existing explicit send action");
  await box.fill("A line break is not an on-chain send.");
  await box.press("Enter");
  await settled();
  check(await page.getByRole("dialog", { name: "Review message cost", exact: true }).count() === 0,
    "Enter in an on-chain composer never submits a permanent transaction");
  await box.fill("First on-chain message needs a cost review.");
  await settled();
  await page.getByRole("button", { name: "Send on chain", exact: true }).click();
  await settled();
  await page.getByRole("dialog", { name: "Review message cost", exact: true }).waitFor();
  check(await page.locator("#messaging-cost-title").evaluate((n) => n === document.activeElement),
    "long fee review focuses its heading without accidental confirmation");
  const title = await page.locator("#messaging-cost-title").boundingBox();
  const close = await page.getByRole("button", { name: "Close cost review",
    exact: true }).boundingBox();
  check(title?.y >= 0 && close?.y >= 0 && title.y + title.height <= 844 && close.y +
    close.height <= 844,
    "cost-review title and Close begin inside the phone viewport");
  check(await page.locator(".messages-cost-summary").innerText().then((s) => s.includes(
    "0.0001 ZEC")
    && s.includes("1 memo part") && s.includes("0 ZEC")),
      "cost review shows exact debit, recipient value and parts");
  check(!await page.evaluate(() => globalThis.__messagingAttempts),
    "opening cost review never calls message construction");
  await capture("cost-review", 390, "dark");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
  check(await page.locator("[data-key=messaging-review-cancel]").evaluate((n) => n ===
    document.activeElement),
    "Keep editing remains reachable through dialog keyboard navigation");
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await settled();
  check(await box.inputValue() === "First on-chain message needs a cost review.",
    "canceling fee review retains the draft");
  check(await page.locator(".composer").evaluate((n) => n.contains(document.activeElement)),
    "canceling fee review restores keyboard focus to the composer");
  await box.fill("m".repeat(401));
  await settled();
  check(await page.locator("#chat-plan-oc-1").innerText().then((s) => s.includes("0.00015 ZEC")
    && /2.*parts|parts.*2/.test(s)), "multipart draft updates visible parts and fee beside send");
  await page.getByRole("button", { name: "Send on chain", exact: true }).click();
  await settled();
  await page.getByRole("dialog", { name: "Review message cost", exact: true }).waitFor();
  await page.evaluate(() => { const text = document.getElementById(
    "chat-text-oc-1"); text.value = "m".repeat(801); });
  await page.getByRole("button", { name: "Send for 0.00015 ZEC", exact: true }).click();
  await settled();
  check(await page.locator(".messages-cost-review").innerText().then((s) => s.includes(
    "message changed")
    && s.includes("3 memo parts") && s.includes("0.0002 ZEC")),
      "confirm recalculates changed draft before allowing send");
  check(!await page.evaluate(() => globalThis.__messagingAttempts),
    "changed cost never submits under the previous review");
  await capture("changed-cost-review", 390, "light");
  await page.getByRole("button", { name: "Send for 0.0002 ZEC", exact: true }).click();
  await settled();
  await page.getByRole("dialog", { name: "Review message cost", exact: true }).waitFor({
    state: "detached" });
  check(await box.inputValue() === "m".repeat(801),
    "failed message construction retains the exact multipart draft");
  check(await page.locator("#banner-text").innerText().then((s) => s.includes(
    "Synthetic message build failed")),
    "send failure preserves the existing truthful error surface");
  check(await page.evaluate(() => globalThis.__messagingAttempts === 1),
    "only explicit up-to-date confirmation calls message construction");
  await capture("send-failed", 390, "dark");

  await scene("contact");
  await page.evaluate(() => {
    const f = globalThis.__messagingFixture; f.account.acct.bal.spendable = 5000; f.loop.draw();
  });
  check(await page.getByRole("button", { name: "Send on chain", exact: true }).isDisabled()
    && await page.locator(".composer").innerText().then(
      (s) => /does not cover the network fee/.test(s)),
  "insufficient account funds preserve the existing spending gate");
  await capture("insufficient-funds", 390, "light");

}

async function verifyDraftNavigation() {
  await scene("contact"); await page.setViewportSize({ width: 1440, height: 1000 });
  const transport = (name) => page.getByRole("tab", { name, exact: true });
  await page.locator("#chat-text-oc-1").fill("Zcash conversation draft retained.");
  await transport("Relay").click(); await settled();
  await page.locator(".messages-conversation-row").filter({
    hasText: "Morgan" }).click(); await settled();
  await page.locator("textarea[name=text]").fill("Direct relay draft retained.");
  await transport("Zcash").click(); await settled();
  await page.locator(".messages-conversation-row").filter({
    hasText: "Morgan" }).click(); await settled();
  check(await page.locator("#chat-text-oc-1").inputValue() === "Zcash conversation draft retained.",
    "switching transport and conversation restores the matching on-chain draft");
  await transport("Relay").click(); await settled();
  await page.locator(".messages-conversation-row").filter({
    hasText: "Morgan" }).click(); await settled();
  check(await page.locator("textarea[name=text]").inputValue() === "Direct relay draft retained.",
    "direct relay draft stays separate from an on-chain contact with the same name");
  await transport("Zcash").click(); await settled();
  await page.locator(".messages-conversation-row").filter({
    hasText: "Morgan" }).click(); await settled();
  await page.getByRole("button", { name: "Send on chain", exact: true }).click(); await settled();
  await page.getByRole("dialog", { name: "Review message cost", exact: true }).waitFor();
  await page.evaluate(() => {
    const f = globalThis.__messagingFixture;
    f.account.setAcct({ ...f.account.acct, secret: "replacement-synthetic-account" });
    f.loop.draw();
  });
  check(await page.getByRole("dialog", { name: "Review message cost", exact: true }).count() === 0,
    "account replacement invalidates a pending fee review");
  check(await page.locator("#chat-text-oc-1").inputValue() === "",
    "account replacement never carries the prior account draft into a matching contact index");
}

async function verifyFunding() {
  await scene("contact"); await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator(".messages-account-details").filter({ has: page.locator(
    ".messages-account-setup") })
    .locator(":scope > summary").click();
  await settled();
  await page.getByRole("button", { name: "Back up account", exact: true }).first().click();
  await settled();
  check(await page.evaluate(() => !!globalThis.__messagingFixture.ui.backup?.personal),
    "account setup opens the existing separate-account encrypted backup dialog");
  await page.keyboard.press("Escape");
  await settled();
  // Re-establish an already-open wallet for the existing funding handler; this avoids a store boot.
  await page.evaluate(() => {
    const f = globalThis.__messagingFixture; f.state.gid = f.gid; f.state.g = f.state.groups[0];
    f.loop.draw();
  });
  const accountDetails = page.locator(".messages-account-details").filter({ has: page.locator(
    ".messages-account-setup") });
  if (!await accountDetails.evaluate((n) => n.open)) await accountDetails.locator(
    ":scope > summary").click();
  await settled();
  const funding = page.locator(".messages-account-funding");
  if (!await funding.evaluate((n) => n.open)) await funding.locator(":scope > summary").click();
  await settled();
  await page.locator("#fund-amt").fill("0.00001");
  await settled();
  check(await page.locator("#fund-error").innerText().then((s) => /Fund at least/.test(s)),
    "funding preserves its minimum three-note validation");
  await page.locator("#fund-amt").fill("0.003");
  await settled();
  await page.getByRole("button", { name: "Fund from a wallet", exact: true }).click();
  await settled();
  check(await page.evaluate(() => {
    const f = globalThis.__messagingFixture;
    return f.ui.send === true && f.ui.pay?.length === 3 && f.state.sessions.length === 0;
  }), "funding prepares the shared-wallet Send form with three notes without authorizing payment");

}

async function verifyTutorial() {
  await scene("team"); await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Back to conversations", exact: true }).click();
  await settled();
  await page.getByRole("button", { name: "How it works", exact: true }).first().focus();
  await page.keyboard.press("Enter");
  await settled();
  const titles = ["One inbox. Two ways to talk.", "A small account for on-chain messages.",
    "Give each contact their reply address.", "Another layer. A future step."];
  for (let i = 0; i < titles.length; i++) {
    await page.getByRole("heading", { name: titles[i], exact: true }).waitFor();
    check(await page.locator(".messages-tutorial").innerText().then((s) => s.includes((i +
      1) + " of 4")),
      "tutorial step " + (i + 1) + " has accurate progress");
    check(await page.locator(".messages-education-art").evaluate((n) => n.getAttribute(
      "aria-hidden") === "true"
      && !n.getAnimations({ subtree: true }).some((a) => a.playState === "running")),
    "tutorial step " + (i + 1) + " is decorative and static under reduced motion");
    await capture("tutorial-" + (i + 1), 390, i % 2 ? "light" : "dark");
    if (i === 3) check(await page.locator(".messages-tutorial").innerText().then(
      (s) => /unavailable/.test(s)
      && /security review/.test(s)), "advanced encryption remains future education only");
    await page.getByRole("button", { name: i === 3 ? "Done" : "Next", exact: true }).click();
  await settled();
  }
  check(await page.getByRole("dialog").count() === 0,
    "tutorial completion returns to Messages without changing account state");
  await page.getByRole("button", { name: "How it works", exact: true }).first().click();
  await settled();
  await page.keyboard.press("Escape");
  await settled();
  check(await page.getByRole("button", { name: "How it works", exact: true }).first().evaluate(
    (n) => n === document.activeElement),
    "Escape closes education and restores keyboard focus");

}

async function verifyNarrowLayouts() {
  for (const name of ["team", "direct", "contact", "setup"]) {
    await scene(name);
    await capture(name, 320, "dark");
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    check(await page.locator(".messages-workspace").isVisible(), name +
      " stays readable in forced colors");
    await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
  }
}

async function verifyTouchKeyboard() {
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true,
    isMobile: true, reducedMotion: "reduce" });
  await touch.route("**/*", (route) => new URL(route.request().url()).origin === origin ?
    route.continue() : route.abort());
  const phone = await touch.newPage();
  phone.on("pageerror", (e) => errors.push(e.message));
  try {
    await phone.goto(origin); await installMessagingFixture(phone, "team", phase);
    const box = phone.locator("textarea[name=text]");
    await box.fill("Touch Enter adds a line."); await box.press("Enter");
    check(await box.inputValue() === "Touch Enter adds a line.\n",
      "touch keyboard Enter preserves a newline without submitting a relay message");
    check(await phone.locator("#banner").isHidden(),
      "touch newline does not trigger a failed relay send");
  } finally { await touch.close(); }
}

async function verifyConversationActions() {
  for (const width of [390, 320]) {
    await scene("team"); await page.setViewportSize({ width, height: 844 });
    await page.locator(".messages-actions > summary").click(); await settled();
    const button = page.getByRole("button", { name: "Request a payment", exact: true });
    const bounds = await button.boundingBox();
    check(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0,
      "conversation actions remain visible above the composer at " + width);
    await capture("conversation-actions", width, "dark");
    await button.click(); await settled();
    check(await page.evaluate(() => !globalThis.__messagingFixture.ui.send
      && globalThis.__messagingFixture.state.sessions.length === 0),
    "opening a chat payment request never authorizes a wallet payment at " + width);
  }
}
async function captureMainScenes() {
  for (const name of ["team", "direct", "contact", "setup"]) {
    const result = await scene(name);
    check(!result.log.length, name + " renders without fallback errors");
    for (const width of [1440, 390]) for (const theme of ["dark", "light"]) await capture(
      name, width, theme);
  }
}

try {
  await captureMainScenes();
  if (phase === "after") {
    await verifyWorkspaceNavigation();
    await verifyRelayStates();
    await verifyAccountSetup();
    await verifyCostReview();
    await verifyDraftNavigation();
    await verifyFunding();
    await verifyTutorial();
    await verifyNarrowLayouts();
    await verifyTouchKeyboard();
    await verifyConversationActions();
  }
  check(!errors.length, "no uncaught browser errors");
} finally {
  await browser.close(); await new Promise((ok) => server.close(ok));
  await writeFile(resolve(output, "validation.json"), JSON.stringify({ phase, checks,
    screenshots, layouts, errors,
    limitations: [(
      "Synthetic unfunded production-renderer fixtures; no "
      + "real keys, proof, chain sync or submission."
    ),
      "Chromium only; physical devices and assistive technology not exercised."] }, null, 2) +
        "\n");
}
console.log(JSON.stringify({ phase, checks: checks.length, screenshots: screenshots.length,
  errors }));
