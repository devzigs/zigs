// Current-working-tree audit. All real operations use isolated, unfunded local wallets.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { overviewFixture, settleOverview } from "./overview-redesign-fixture.mjs";
import { unlockIfNeeded } from "./passkey-ui.mjs";

const phase = process.env.ZIGS_AUDIT_PHASE || "before";
const output = resolve("docs/ux-redesign/visuals/finalpass", phase,
  process.env.ZIGS_AUDIT_SUITE || ".");
const records = [], actions = [], failures = [], seen = new Set();
const masks = ".safety,.qr,input[type=password],input[type=file],.secret-link,"
  + ".addr-full,.qr-toggle,.log,.invite-link";
mkdirSync(output, { recursive: true });
const savedFile = resolve(output, "results.json");
if (process.env.ZIGS_AUDIT_RESUME === "1" && existsSync(savedFile)) {
  const saved = JSON.parse(readFileSync(savedFile, "utf8"));
  const redo = new Set((process.env.ZIGS_AUDIT_RECAPTURE || "").split(","));
  records.push(...saved.records.filter((record) => !redo.has(record.name)));
  for (const record of records) seen.add(record.name);
}

function save() {
  writeFileSync(resolve(output, "results.json"), JSON.stringify({ phase, records, actions,
    failures }, null, 2) + "\n");
}

export async function layout(page, label) {
  const value = await page.evaluate(() => {
    const visible = (n) => n.getClientRects().length && n.checkVisibility()
      && !n.closest("details:not([open]) :not(summary,summary *)");
    const box = (n) => n.getBoundingClientRect();
    const name = (n) => (n.getAttribute("aria-label") || n.textContent || n.id).trim();
    const controls = [...document.querySelectorAll("button,summary,select")].filter(visible);
    const small = controls.filter((n) => box(n).width < 47.5 || box(n).height < 47.5);
    const fields = [...document.querySelectorAll("input:not([type=hidden]),textarea,select")]
      .filter(visible).filter((n) => !n.labels?.length && !n.getAttribute("aria-label")
        && !n.getAttribute("aria-labelledby"));
    const containers = [...document.querySelectorAll(
      "dialog[open],.dialog,.drawer,.recipient-editor")]
      .filter(visible).filter((n) => n.scrollWidth > n.clientWidth + 1);
    const crushed = [...document.querySelectorAll(".wallet-context-header h1")]
      .filter(visible).filter((node) => box(node).width
        < parseFloat(getComputedStyle(node).fontSize) * 4);
    return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      shortControls: small.map((n) => ({ name: name(n).slice(0, 100), disabled: !!n.disabled,
        width: box(n).width, height: box(n).height, class: n.className })),
      unlabelled: fields.map((n) => n.id || n.outerHTML.slice(0, 120)),
      overflowContainers: containers.map((n) => n.className),
      crushedWalletNames: crushed.map((node) => ({
        width: box(node).width, height: box(node).height })) };
  });
  return { label, ...value };
}

function stateName(name) {
  return name.replace(/-(?:320|390|768|1024|1440|1920)-(?:light|dark|system)$/, "");
}

export async function capture(page, rawName, method = "isolated real web flow") {
  const name = stateName(rawName);
  if (seen.has(name)) return;
  seen.add(name);
  const viewport = page.viewportSize();
  const theme = await page.locator("html").getAttribute("data-theme");
  const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  const stress = /2x|forced|enlarged|short-viewport|mobile-menu/.test(name);
  const widths = stress ? [viewport.width] : [1440, 1024, 768, 390];
  for (const width of widths)
    await captureWidth(page, { name, method, width, stress, height: viewport.height });
  await page.setViewportSize(viewport);
  await page.evaluate((value) => {
    if (value) document.documentElement.dataset.theme = value;
    else delete document.documentElement.dataset.theme;
  }, theme);
  await page.evaluate(({ x, y }) => scrollTo(x, y), scroll);
  save();
  console.log("Audited " + name);
}

async function captureWidth(page, spec) {
  const { name, method, width, stress } = spec;
  await page.setViewportSize({ width, height: stress ? spec.height : width < 600 ? 844 : 900 });
  for (const theme of stress ? ["dark"] : ["light", "dark"]) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    // Full-page captures start at the top so sticky headers are not composited twice.
    await page.evaluate(() => scrollTo(0, 0));
    await settleOverview(page);
    const metrics = await layout(page, name);
    const file = name + "-" + width + "-" + theme + ".png";
    await page.screenshot({ path: resolve(output, file), fullPage: true,
      animations: "disabled", mask: [page.locator(masks)], maskColor: "#343b45" });
    records.push({ name, method, theme, file, ...metrics });
  }
}

async function attempt(page, name, fn) {
  try { await fn(); actions.push({ name, pass: true }); }
  catch (error) {
    failures.push({ name, error: error.message.split("\n")[0] });
    console.log("AUDIT ACTION FAILED: " + name + ": " + error.message.split("\n")[0]);
    await page.screenshot({ path: resolve(output, "failure-" + name + ".png"),
      mask: [page.locator(masks)] }).catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});
  }
  save();
}

async function nav(page, id) {
  await settleOverview(page);
  const menu = page.locator("#wallet-menu");
  if (await menu.isVisible() && await menu.getAttribute("aria-expanded") !== "true")
    await menu.click();
  await page.locator("#tab-" + id).click();
  if (await page.evaluate(() => window.finalpassInert === true))
    await page.evaluate(async () => (await import("/app-loop.js")).draw());
  await page.locator("#tab-" + id + "[aria-current=page]").waitFor({ state: "attached" });
  await settleOverview(page);
}

export async function entry(page) {
  page.setDefaultTimeout(8000);
  for (const id of ["overview", "approvals", "activity", "recovery", "settings"])
    await attempt(page, "empty-" + id, async () => {
      await nav(page, id); await capture(page, "empty-" + id);
    });
  await nav(page, "overview");
  await attempt(page, "optional-skip-warning", async () => {
    await page.getByRole("button", { name: "Create wallet", exact: true }).click();
    await page.getByRole("button", { name: "Skip for now", exact: true }).click();
    await capture(page, "skip-warning");
    await page.getByRole("button", { name: "Go back", exact: true })
      .click({ timeout: 1500 });
    await page.getByRole("button", { name: "Save and exit", exact: true }).click();
  });
  // Closing an app-owned dialog never accepts the optional protection exception.
  await page.getByRole("button", { name: "Save and exit", exact: true })
    .click({ timeout: 1000 }).catch(() => {});
}

export async function run(page, qa, pages) {
  await capture(page, "overview");
  await collectionFlow(page);
  for (const id of ["approvals", "activity", "recipients", "swap", "chats", "recovery",
    "settings"]) await attempt(page, id, async () => {
      await nav(page, id); await capture(page, id);
    });
  await recipientFlow(page);
  await paymentDialogs(page);
  await settingsFlows(page);
  await recoveryFlows(page);
  await chatFlows(page);
  await swapFlows(page);
  await feedbackStates(page);
  await preferences(page);
  await lockFlow(page);
  await rendererStates(page);
  await webkitSmoke();
  qa.check(pages.length === 3, "final pass uses three isolated unfunded signer contexts");
}

export async function finishGuidedWallet(pages, qa) {
  for (const page of pages) await page.getByRole("heading", {
    name: "Meet your new wallet", exact: true }).waitFor({ timeout: 90000 });
  const first = pages[0];
  await capture(first, "wallet-marble-reveal");
  for (const page of pages) await page.getByRole("button", {
    name: "Continue to backup options", exact: true }).click();
  await capture(first, "prepared-optional-backups");
  await first.getByRole("button", { name: "Save ZEC backup", exact: true }).click();
  await capture(first, "backup-encryption-form");
  await first.locator("#bk-pass").fill("synthetic local backup verification 4728");
  await first.locator("#bk-again").fill("synthetic local backup verification 4728");
  const pending = first.waitForEvent("download");
  await first.getByRole("button", { name: "Encrypt and save", exact: true }).click();
  const download = await pending, file = await download.path();
  await first.getByRole("dialog").waitFor({ state: "detached" });
  await first.getByText("Optional: check saved files", { exact: true }).first().click();
  await first.getByRole("button", { name: "Check saved ZEC file", exact: true }).first().click();
  await capture(first, "backup-file-check");
  await first.locator("#bc-file").setInputFiles(file);
  await first.locator("#bc-pass").fill("wrong synthetic passphrase");
  await first.getByRole("button", { name: "Check saved file", exact: true }).click();
  await first.getByRole("alert").filter({ hasText: "could not be opened" }).waitFor();
  await capture(first, "backup-file-check-error");
  await first.locator("#bc-file").setInputFiles(file);
  await first.locator("#bc-pass").fill("synthetic local backup verification 4728");
  await first.getByRole("button", { name: "Check saved file", exact: true }).click();
  await first.getByRole("dialog").waitFor({ state: "detached" });
  await capture(first, "backup-file-checked");
  await importFlow(first, file, qa.patchEngine);
  await first.getByRole("button", { name: "Continue to wallet name", exact: true }).click();
  await capture(first, "wallet-name-demo");
  await first.locator("#zns-name").fill("invalid name !");
  await capture(first, "wallet-name-invalid");
  await first.locator("#zns-name").fill("syntheticwallet");
  await first.getByRole("button", { name: "Preview payment", exact: true }).click();
  await capture(first, "wallet-name-checkout-zec");
  await first.getByRole("button", { name: "Edit name or payment currency", exact: true }).click();
  await first.locator('input[name="zns-currency"][value="sol"]').check();
  await first.getByRole("button", { name: "Preview payment", exact: true }).click();
  await capture(first, "wallet-name-checkout-sol");
  await first.getByRole("button", { name: "Skip for now · Open Overview", exact: true }).click();
  for (const page of pages.slice(1)) await page.getByRole("button", {
    name: "Skip name · Open Overview", exact: true }).click();
  actions.push({ name: "real-formation-encrypted-backup-and-read-only-check", pass: true });
}

async function importFlow(first, file, patchEngine) {
  const context = await first.context().browser().newContext({ reducedMotion: "reduce" });
  await context.route("**/*", (r) => new URL(r.request().url()).origin
    === "http://localhost:8872" ? r.continue() : r.abort());
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  await attempt(page, "real-recovery-import", async () => {
    await page.goto("http://localhost:8872");
    await patchEngine(page);
    const pending = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Recover access", exact: true }).click();
    const chooser = await pending;
    await chooser.setFiles({ name: "synthetic-wallet-backup.json", mimeType: "application/json",
      buffer: readFileSync(file) });
    await page.getByRole("dialog").waitFor();
    await capture(page, "import-passphrase");
    await page.locator("#rs-pass").fill("wrong synthetic passphrase");
    await page.getByRole("button", { name: "Open backup", exact: true }).click();
    await page.locator("#banner.bad:not([hidden])").waitFor();
    await capture(page, "import-wrong-passphrase");
    await page.locator("#rs-pass").fill("synthetic local backup verification 4728");
    await page.getByRole("button", { name: "Open backup", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.waitForFunction(async () => (await import("/app-dkg.js")).myVerified());
    await capture(page, "import-verified", "actual recovery of isolated unfunded test signer");
  });
  await context.close();
}

async function collectionFlow(page) {
  await attempt(page, "returning-wallet-collection", async () => {
    await page.locator(".wallet-home").click();
    await page.locator(".welcome").waitFor();
    await capture(page, "returning-wallet-collection");
    await page.locator(".welcome-wallet-list .wallet-vault-card").first().click();
    await page.getByRole("heading", { name: "Your assets", exact: true }).waitFor();
  });
}

async function recipientFlow(page) {
  await attempt(page, "recipient-validation", async () => {
    await nav(page, "recipients");
    await page.getByRole("button", { name: "Add recipient", exact: true }).click();
    await capture(page, "recipient-editor");
    await page.getByRole("textbox", { name: "Name on this device", exact: true })
      .fill("Synthetic household recipient with a deliberately long name");
    await page.getByRole("textbox", { name: "Full payment address", exact: true })
      .fill("invalid synthetic address");
    await page.getByRole("button", { name: "Save recipient", exact: true }).click();
    await page.getByRole("alert").waitFor();
    await capture(page, "recipient-error");
    const address = await page.evaluate(async () =>
      (await import("/app-state.js")).state.wallet.address);
    await page.getByRole("textbox", { name: "Full payment address", exact: true })
      .fill(address);
    await page.getByRole("button", { name: "Save recipient", exact: true }).click();
    await page.locator(".recipient-card").waitFor();
    await capture(page, "recipient-saved");
    await page.getByRole("button", { name: /^Delete Synthetic household/ }).click();
    await capture(page, "recipient-delete-warning");
    await page.getByRole("button", { name: "Keep recipient", exact: true }).click();
    await page.getByRole("searchbox").fill("nothing-matches");
    await capture(page, "recipients-no-results");
    await page.getByRole("searchbox").fill("");
  });
}

async function paymentDialogs(page) {
  for (const kind of ["send", "receive"]) await attempt(page, kind, async () => {
    await nav(page, "overview");
    await page.evaluate(async (value) => {
      if (value === "send") (await import("/app-send.js")).openSend();
      else (await import("/app-state.js")).ui.receive = true;
      (await import("/app-loop.js")).render();
    }, kind);
    await page.getByRole("dialog").waitFor();
    await capture(page, kind);
    await keyboardDialog(page, kind);
    await page.setViewportSize({ width: 390, height: 480 });
    await capture(page, kind + "-short-viewport");
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
  });
}

async function keyboardDialog(page, kind) {
  const dialog = page.getByRole("dialog");
  await dialog.locator("button:not(:disabled)").last().focus();
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let step = 0; step < 12; step++) {
      await page.keyboard.press(key);
        const inLayer = await page.evaluate(() =>
          !!document.activeElement.closest("dialog[open],.dialog,.drawer,#banner"));
        if (!inLayer)
        throw Error(kind + " dialog lets " + key + " keyboard focus escape");
    }
  }
}

async function settingsFlows(page) {
  await nav(page, "settings");
  for (const title of ["Guides & frequently asked questions", "Diagnostics",
    "Technical wallet details", "Network & privacy"])
    await attempt(page, "settings-" + title.split(" ")[0], async () => {
      const disclosure = page.locator("summary").filter({ hasText: title });
      await disclosure.click({ timeout: 2000 });
      await capture(page, "settings-" + title.toLowerCase().replace(/[^a-z]+/g, "-"));
      await disclosure.click();
    });
}

async function recoveryFlows(page) {
  for (const kind of ["backup", "backup-check", "restore", "replace"])
    await attempt(page, kind, async () => {
      await nav(page, "recovery");
      await page.evaluate(async (value) => {
        const { ui } = await import("/app-state.js"), b = await import("/app-backups.js");
        if (value === "backup") b.openBackup(1);
        if (value === "backup-check") b.openBackupCheck(1, "zec");
        if (value === "restore") ui.restore = { name: "Synthetic recovery file",
          text: "", busy: false };
        if (value === "replace") ui.move = true;
        (await import("/app-loop.js")).render();
      }, kind);
      await page.getByRole("dialog").waitFor();
      await capture(page, kind, kind === "restore" ? "staged recovery dialog; no import"
        : "existing dialog entry on isolated real wallet");
      await keyboardDialog(page, kind);
      await page.keyboard.press("Escape");
    });
}

async function chatFlows(page) {
  await attempt(page, "chat-draft", async () => {
    await nav(page, "chats");
    const conversation = page.locator(".messages-conversation-row").first();
    if (await conversation.isVisible()) await conversation.click();
    const composer = page.locator("textarea").first();
    await composer.fill("Synthetic local draft for presentation verification only.");
    await capture(page, "chat-draft");
    await nav(page, "settings"); await nav(page, "chats");
    if (await conversation.isVisible()) await conversation.click();
    if (!await composer.inputValue()) throw Error("Draft was lost after navigation");
    await composer.fill("");
    const details = page.locator(".messages-details summary").first();
    await details.click(); await capture(page, "chat-privacy-details");
  });
}

async function swapFlows(page) {
  await attempt(page, "swap-demo", async () => {
    await nav(page, "swap");
    await privateSwap(page);
    await page.getByRole("tab", { name: "Post-Quantum Privacy", exact: true }).click();
    await capture(page, "swap-quantum-introduction");
    await page.getByRole("button", { name: "Continue to post-quantum swap demo",
      exact: true }).click();
    await capture(page, "swap-configure");
    const details = page.getByRole("button", { name: "Swap details & privacy", exact: true });
    if (await details.count()) {
      await details.click();
      await capture(page, "swap-quantum-details");
      await keyboardDialog(page, "swap-quantum-details");
      await page.keyboard.press("Escape");
      if (!await details.evaluate((node) => node === document.activeElement))
        throw Error("Swap details did not restore focus to its opener");
    }
    await page.locator("#pq-amount").fill("invalid");
    await capture(page, "swap-quantum-invalid");
    await page.locator("#pq-amount").fill("1.25");
    await page.getByRole("button", { name: "Review demo swap", exact: true }).click();
    await capture(page, "swap-review");
    await page.getByRole("button", { name: "Simulate quote expiry", exact: true }).click();
    await capture(page, "swap-expired");
    await page.getByRole("button", { name: "Refresh demo quote", exact: true }).click();
    await quantumOutcome(page, false);
    await page.getByRole("button", { name: "Try another demo swap", exact: true }).click();
    await quantumOutcome(page, true);
  });
}

async function privateSwap(page) {
  await page.getByRole("textbox", { name: "Amount you pay", exact: true }).fill("1.25");
  await page.getByRole("button", { name: /^Preview swap/ }).waitFor();
  await capture(page, "swap-private-quote");
  await page.getByRole("button", { name: "Choose asset to receive", exact: true }).click();
  await capture(page, "swap-asset-picker");
  await page.getByRole("searchbox").fill("no-such-asset");
  await capture(page, "swap-asset-no-results");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Preview swap/ }).click();
  await capture(page, "swap-private-review");
  await page.keyboard.press("Escape");
}

async function quantumOutcome(page, refund) {
  await page.getByRole("button", { name: "Review demo swap", exact: true }).click();
  await page.getByRole("button", { name: "Continue to demo approvals", exact: true }).click();
  await capture(page, "swap-approvals-zero");
  await page.getByRole("button", { name: "Simulate this device approval", exact: true }).click();
  await capture(page, "swap-approvals-one");
  await page.getByRole("button", { name: "Simulate second device approval", exact: true }).click();
  await capture(page, "swap-approvals-complete");
  await page.getByRole("button", { name: "Continue to simulated execution", exact: true }).click();
  await capture(page, "swap-deposit-waiting");
  await page.getByRole("button", { name: "Simulate deposit confirmation", exact: true }).click();
  await capture(page, "swap-route-waiting");
  await page.getByRole("button", { name: "Simulate route execution", exact: true }).click();
  await capture(page, "swap-delivery-waiting");
  await page.getByRole("button", { name: refund ? "Simulate refund instead" : "Simulate delivery",
    exact: true }).click();
  await capture(page, refund ? "swap-refund" : "swap-delivered");
}

async function feedbackStates(page) {
  await nav(page, "overview");
  await attempt(page, "offline", async () => {
    await page.context().setOffline(true);
    await page.locator("#offline").filter({ hasText: "No network connection" }).waitFor();
    await capture(page, "offline");
    await page.context().setOffline(false);
  });
  await page.context().setOffline(false);
  await attempt(page, "feedback", async () => {
    await page.evaluate(async () => (await import("/app-state.js"))
      .showBanner("bad", "Synthetic local validation error. Review the fields and try again."));
    await capture(page, "feedback-error");
    await page.locator("#banner-close").click();
  });
}

async function preferences(page) {
  await nav(page, "overview");
  await attempt(page, "accessibility-preferences", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await capture(page, "forced-colors");
    await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
    await page.locator("#wallet-menu").click();
    await capture(page, "mobile-menu");
    await page.keyboard.press("Escape");
  });
  for (const id of ["overview", "settings"]) await attempt(page, "text-200-" + id, async () => {
    await nav(page, id);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      const nodes = [...document.querySelectorAll("body *")];
      window.finalpassText = nodes.map((n) => [n, n.style.fontSize, n.style.lineHeight,
        getComputedStyle(n).fontSize, getComputedStyle(n).lineHeight]);
      for (const [n, , , size, line] of window.finalpassText) {
        n.style.fontSize = parseFloat(size) * 2 + "px";
        if (line.endsWith("px")) n.style.lineHeight = parseFloat(line) * 2 + "px";
      }
    });
    await capture(page, "enlarged-text-" + id);
    await page.evaluate(() => {
      for (const [n, size, line] of window.finalpassText) {
        n.style.fontSize = size; n.style.lineHeight = line;
      }
    });
  });
}

async function lockFlow(page) {
  await attempt(page, "lock-unlock", async () => {
    await nav(page, "settings");
    await page.getByRole("button", { name: "Lock now", exact: true }).click();
    await page.getByRole("heading", { name: "Zigs is locked", exact: true }).waitFor();
    await capture(page, "locked");
    await unlockIfNeeded(page, (ok, label) => { if (!ok) throw Error(label); });
  });
}

async function rendererStates(page) {
  const context = await page.context().browser().newContext({ reducedMotion: "reduce" });
  const fixturePage = await inertPage(context);
  await attempt(fixturePage, "blocked-review-renderer", async () => {
    const { premiumReviewFixture } = await import("./prd-ui.mjs");
    const fixture = await premiumReviewFixture(fixturePage);
    await fixturePage.evaluate((html) => {
      document.getElementById("app").replaceChildren();
      document.getElementById("app").innerHTML = html;
    }, fixture.html);
    await capture(fixturePage, "blocked-zec-review",
      "inert production renderer; synthetic refused review");
  });
  await context.close();
}

async function inertPage(context) {
  const page = await context.newPage();
  await page.route("**/app-loop.js", (route) => route.fulfill({
    contentType: "text/javascript", body: readFileSync("web/app-loop.js", "utf8")
      .replace("export function render() {", "export function render() { return;")
      .replace("export function react() {", "export function react() { return;") }));
  await overviewFixture(context, page);
  await page.evaluate(() => { window.finalpassInert = true; });
  return page;
}

export async function systemRenderers() {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.CHROME_EXECUTABLE });
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await inertPage(context);
  for (const kind of ["loading-engine", "loading-group", "unreadable-wallet", "damaged-vault",
    "lost-passkey-warning"]) {
    await page.evaluate(async (value) => {
      const shell = await import("/app-shell.js"), keys = await import("/app-keystore.js");
      const { ui } = await import("/app-state.js");
      const engine = await import("/app-engine.js");
      if (value.startsWith("loading")) engine.setZ(value === "loading-group" ? {} : null);
      keys.setLocked({ damaged: true }); ui.forget = value === "lost-passkey-warning";
      const view = value.startsWith("loading") ? shell.loadingView()
        : value === "unreadable-wallet" ? (await import("/app-dom.js")).unreadable()
          : shell.lockView();
      document.getElementById("app").replaceChildren(view);
    }, kind);
    await capture(page, kind, "inert production renderer; synthetic system state");
  }
  await rendererStates(page);
  await context.close(); await browser.close();
  await finish({ method: "synthetic system renderers; no delete action invoked" });
}

export async function currentSwap() {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.CHROME_EXECUTABLE });
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await inertPage(context); page.setDefaultTimeout(8000);
  await nav(page, "swap");
  await capture(page, "swap", "current concurrent Swap source; synthetic renderer");
  await swapFlows(page);
  await context.close(); await browser.close();
  await finish({ method: "current concurrent Swap sources; no real operations" });
}

async function webkitSmoke() {
  const { webkit } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await webkit.launch({ headless: true });
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await attempt(page, "webkit-renderers", async () => {
    await overviewFixture(context, page);
    for (const id of ["overview", "approvals", "activity", "recipients", "swap", "chats",
      "recovery", "settings"]) {
      await nav(page, id);
      await capture(page, "webkit-" + id, "WebKit production renderer; synthetic state");
    }
    await nav(page, "overview");
    for (const kind of ["send", "receive", "restore"]) {
      await page.evaluate(async (value) => {
        const { ui } = await import("/app-state.js");
        if (value === "send") (await import("/app-send.js")).openSend();
        if (value === "receive") ui.receive = true;
        if (value === "restore") ui.restore = { name: "Synthetic recovery file", text: "" };
        (await import("/app-loop.js")).draw();
      }, kind);
      await capture(page, "webkit-" + kind, "WebKit production dialog; synthetic state");
      await keyboardDialog(page, kind);
      await page.keyboard.press("Escape");
    }
  });
  await webkitEntry(browser);
  await browser.close();
}

async function webkitEntry(browser) {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await context.route("**/*", (r) => new URL(r.request().url()).origin
    === "http://localhost:8872" ? r.continue() : r.abort());
  await attempt(page, "webkit-entry-setup", async () => {
    await page.goto("http://localhost:8872");
    await page.getByRole("button", { name: "Create wallet", exact: true }).click();
    await capture(page, "webkit-protection", "WebKit real local entry; no wallet creation");
    await page.getByRole("button", { name: "Skip for now", exact: true }).click();
    await capture(page, "webkit-skip-warning", "WebKit real local opt-out warning");
    await page.getByRole("button", { name: "Continue without protection", exact: true }).click();
    await capture(page, "webkit-approval-rule", "WebKit real setup form; no wallet creation");
    await page.getByRole("button", { name: "Use this arrangement", exact: true }).click();
    await capture(page, "webkit-device-naming", "WebKit real setup form; no wallet creation");
    await page.getByRole("button", { name: "Save and exit", exact: true }).click();
  });
  await context.close();
}

export async function finish(journey) {
  save();
  writeFileSync(resolve(output, "journey.json"), JSON.stringify(journey, null, 2) + "\n");
}

export async function captureScreenshot(page, options) {
  const file = String(options.path).split("/").at(-1).replace(/\.png$/, "");
  await capture(page, file, "inert production-renderer fixture; synthetic data");
  return page.screenshot(options);
}

let styleIndex = 0;
export async function fixtureStyle(page, options) {
  // Serve test-only layout CSS from the same origin; preserve the real CSP unchanged.
  if (!options.content) return page.addStyleTag(options);
  const url = new URL("/__finalpass-fixture-" + (++styleIndex) + ".css", page.url()).href;
  await page.route(url, (route) => route.fulfill({
    contentType: "text/css", body: options.content }));
  return page.addStyleTag({ url });
}
