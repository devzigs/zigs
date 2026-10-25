// Isolated UX-state review. Real renderers; synthetic facts; no account or payment submissions.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { overviewFixture, settleOverview } from "../harness/overview-redesign-fixture.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const out = resolve(process.env.ZIGS_UX_OUTPUT || "solspike/.state/ux-flow-review");
mkdirSync(out, { recursive: true });
const checks = [], layouts = [], errors = [];
const check = (pass, label) => { assert.ok(pass, label); checks.push(label); };
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });
const context = await browser.newContext({ reducedMotion: "reduce",
  viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(5000);
page.on("pageerror", (error) => errors.push(error.message));
await page.addInitScript(() => {
  const interval = window.setInterval.bind(window);
  window.setInterval = (fn, delay, ...args) => delay === 60000 ? 0 : interval(fn, delay, ...args);
});

async function mount(flow) {
  await page.evaluate(async (flow) => {
    const { state, ui } = await import("/app-state.js");
    const shell = await import("/app-shell.js"), send = await import("/app-send.js");
    const backups = await import("/app-backups.js"), thread = await import("/app-thread.js");
    const account = await import("/app-account.js"), ks = await import("/app-keystore.js");
    const { el } = await import("/app-dom.js");
    state.g = state.groups[0]; state.gid = state.g.id;
    Object.assign(ui, { create: false, createStep: 0, send: false, sendReview: null,
      receive: false, newChat: false, leave: false, backup: null, restore: null, tab: "overview" });
    const addr = "utest1" + "r".repeat(180), cid = "cd".repeat(10);
    ks.chats.list[cid] = { key: "synthetic-view-only-chat-key", member: "synthetic-owner" };
    account.setPersonal({ network: "testnet", contacts: [] });
    const plan = (step) => {
      state.g = null; state.gid = null; ui.create = true; ui.createStep = step;
      ui.createDraft = { n: 3, t: 2, name: "Everyday wallet", label: "Everyday phone" };
      return shell.createDialog();
    };
    const backup = (checking) => {
      ui.backup = { seat: 1, chain: "zec", gid: state.gid, made: false, busy: false,
        check: checking };
      return backups.backupDialog();
    };
    const review = (mismatch) => {
      ui.send = true; state.wallet.orchard_fvk = "synthetic-view-only-fvk";
      ui.sendReview = { prep: { gid: state.gid, payees: [{ to: addr, amount: 10000, memo: "" }],
        t: { pczt: mismatch ? "synthetic-mismatch" : "synthetic-match", amount: 10000 } },
      note: "Synthetic wallet note" };
      return send.sendDialog();
    };
    const builders = {
      "setup-protection": () => plan(0), "setup-rule": () => plan(1),
      "setup-labels": () => plan(2), "setup-review": () => plan(3),
      "replacement-wallet": () => shell.createDialog(state.g),
      "backup-save": () => backup(false), "backup-check": () => backup(true),
      "backup-restore": () => {
        ui.restore = { name: "Synthetic recovery file.zigsbackup", text: "synthetic", busy: false };
        return backups.restoreDialog();
      },
      "direct-chat-create": () => { ui.newChat = true; return thread.newChatDialog(); },
      "direct-chat-invite": () => thread.chatInviteCard(cid),
      "direct-chat-leave": () => { ui.leave = true; return thread.leaveBox(cid); },
      "contact-create": () => (import("/app-account-view.js")).then((m) => m.contactDialog()),
      "locked-data-delete": () => shell.forgetBox(),
      "send-entry": () => { ui.send = true; return send.sendDialog(); },
      "payment-review": () => review(false), "payment-mismatch": () => review(true),
      "receive": () => { ui.receive = true; return send.receiveDialog(); },
      "address-book": () => {
        ui.tab = "recipients";
        return (import("/app-recipients.js")).then((m) => m.recipientsView());
      },
      "settings": () => shell.settingsWorkspace(),
      "network-privacy": () => (import("/app-network-privacy.js")).then(
        (m) => m.networkPrivacyPanel()),
    };
    const root = await builders[flow]();
    if (!root.classList.contains("dialog")) {
      const wrapper = el("div", { class: "page ux-review-surface", style: "max-width:900px" },
        root);
      document.getElementById("app").replaceChildren(wrapper);
    } else document.getElementById("app").replaceChildren(root);
  }, flow);
  await settleOverview(page);
}

async function inspect(flow, theme, width) {
  const facts = await page.evaluate(() => {
    const root = document.querySelector("#app"), dialog = root.querySelector(".dialog");
    const visible = (node) => node.checkVisibility({ checkVisibilityCSS: true });
    const described = [...root.querySelectorAll("[aria-describedby]")].filter(visible);
    const missing = described.flatMap((node) => node.getAttribute("aria-describedby")
      .split(/\s+/).filter((id) => !document.getElementById(id)));
    const bounds = (dialog || root).getBoundingClientRect();
    const actions = [...root.querySelectorAll(".dialog-actions>.btn,.ux-form-actions>.btn")]
      .filter(visible).map((node) => ({ text: node.textContent,
        width: node.offsetWidth, height: node.offsetHeight, order: getComputedStyle(node).order }));
    return { overflow: document.documentElement.scrollWidth > innerWidth + 1
        || !!dialog && dialog.scrollWidth > dialog.clientWidth + 1,
      missing, actions, inViewport: bounds.left >= -1 && bounds.right <= innerWidth + 1 };
  });
  const label = `${flow} ${width} ${theme}`;
  check(!facts.overflow && facts.inViewport, label + ": readable without horizontal overflow");
  check(!facts.missing.length, label + ": descriptions resolve: " + facts.missing.join(","));
  check(facts.actions.every((a) => a.height >= 47 && a.width >= 44),
    label + ": actions retain usable touch targets");
  check(facts.actions.every((a) => a.order === "0"),
    label + ": CSS does not reverse keyboard action order");
  layouts.push({ flow, theme, width, ...facts });
  if (["setup-review", "backup-restore", "direct-chat-create", "payment-review",
    "locked-data-delete"].includes(flow)) await page.screenshot({
    path: resolve(out, `${flow}-${width}-${theme}.png`), animations: "disabled" });
}

async function copyChecks() {
  await mount("setup-protection");
  check(await page.getByRole("button", { name: "Pause plan", exact: true }).count() === 1,
    "unfinished setup says Pause plan");
  check((await page.locator("#setup-plan-lifetime").textContent()).includes("Closing or reloading"),
    "unfinished plan lifetime is stated beside the actions");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    await mount("setup-protection");
    await page.locator('[data-key="skip-device-create-first"]').click();
    await page.getByText("Continue without passkey protection?", { exact: true }).waitFor();
    check(await page.locator('[data-key="skip-back-create-first"]').textContent()
      === "Back to protection", "Skip names the consequence and the safe return action");
    await inspect("setup-skip", "light", width);
    await page.locator('[data-key="skip-back-create-first"]').click();
  }
  await mount("payment-review");
  check(await page.getByRole("button", { name: "Request approvals", exact: true }).count() === 1,
    "verified review states the next action: Request approvals");
  check((await page.locator("#proposal-help").textContent()).includes("does not sign or send"),
    "requesting approvals is distinguished from signing or sending");
  await mount("payment-mismatch");
  check(await page.getByRole("button", { name: "Request approvals", exact: true }).count() === 0,
    "mismatched transaction still offers no proposal action");
  await mount("backup-restore");
  check(await page.getByRole("button", { name: "Restore backup", exact: true }).count() === 1,
    "restoring a share is labeled as a restore rather than opening a file");
  await mount("direct-chat-create");
  check(await page.getByRole("button", { name: "Create invite link", exact: true }).isDisabled(),
    "direct chat labels the created object and preserves unavailable-relay gating");
  check((await page.locator("#chat-create-availability").textContent()).includes("unavailable"),
    "disabled chat action has a visible explanation");
  await mount("locked-data-delete");
  check(await page.locator(".ux-consequences>li").count() === 4,
    "locked-data deletion separately explains each lost data category");
}

async function recipientEditor() {
  await mount("address-book");
  await page.getByRole("button", { name: "Add recipient", exact: true }).click();
  await page.locator(".recipient-editor").waitFor();
  const labels = await page.locator(".ux-form-actions>button").allTextContents();
  check(JSON.stringify(labels) === JSON.stringify(["Cancel", "Save recipient"]),
    "recipient editor uses Cancel then Save in DOM and visual order");
  check(await page.locator(".recipient-editor textarea").getAttribute("aria-describedby")
    === await page.locator(".recipient-editor p[id]").first().getAttribute("id"),
  "full-address field is associated with its format guidance");
  await page.screenshot({ path: resolve(out, "recipient-editor.png") });
}

async function scrollAndShortWindow() {
  for (const flow of ["send-entry", "backup-save", "backup-restore", "direct-chat-create"]) {
    await mount(flow);
    const dialog = page.getByRole("dialog");
    await dialog.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    const close = dialog.locator(".card-head .icon-btn");
    check(await close.evaluate((node) => {
      const r = node.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight;
    }), flow + ": Close remains visible after scrolling a long dialog");
    const fields = dialog.locator(":is(input,textarea,select):enabled:visible");
    for (const index of new Set([0, await fields.count() - 1])) {
      await fields.nth(index).focus(); await settleOverview(page);
      check(await fields.nth(index).evaluate((node) => {
        const box = node.getBoundingClientRect(), sheet = node.closest(".dialog");
        const header = sheet.querySelector(".card-head").getBoundingClientRect();
        const footer = sheet.querySelector(".dialog-actions").getBoundingClientRect();
        return box.top >= header.bottom - 1 && box.bottom <= footer.top + 1;
      }), flow + ": focused field " + index + " is clear of sticky header and actions");
    }
  }
  await page.setViewportSize({ width: 740, height: 420 });
  await mount("backup-restore");
  check(await page.locator(".dialog>.card-head").evaluate((node) =>
    getComputedStyle(node).position === "static"),
  "short windows release sticky chrome to preserve reading space");
  await inspect("backup-restore-short", "light", 740);
}

try {
  await overviewFixture(context, page);
  await page.evaluate(async () => {
    // Read-only decoder facts for layout; never used to prepare, approve or submit anything.
    (await import("/app-engine.js")).setZ({ normalizeAddress: (value) => value,
      inspect: (key) => JSON.stringify({ fee: 1000, standard_fee: 1000, expiry_height: 4529000,
        lines: [{ kind: "output", who: "utest1" + (key.includes("mismatch") ? "s" : "r")
          .repeat(180), value: 10000, memo_status: "empty", change: false }],
      tx_version: "v5" }) });
    // Match the label restored by main's existing name-field input handling during redraws.
    localStorage.setItem("zf-name", "Everyday phone");
  });
  const storageBefore = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  const flows = ["setup-protection", "setup-rule", "setup-labels", "setup-review",
    "replacement-wallet", "backup-save", "backup-check", "backup-restore", "direct-chat-create",
    "direct-chat-invite", "direct-chat-leave", "contact-create", "locked-data-delete", "send-entry",
    "payment-review", "payment-mismatch", "receive", "address-book", "settings", "network-privacy"];
  const variants = ["dark", "light"].flatMap((theme) =>
    [320, 390, 1440].map((width) => ({ theme, width })));
  for (const { theme, width } of variants) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
    for (const flow of flows) { await mount(flow); await inspect(flow, theme, width); }
  }
  await copyChecks(); await recipientEditor(); await scrollAndShortWindow();
  const storageAfter = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  if (storageBefore !== storageAfter) writeFileSync(resolve(out, "fixture-storage.json"),
    JSON.stringify({ before: JSON.parse(storageBefore), after: JSON.parse(storageAfter) },
      null, 2));
  check(storageBefore === storageAfter,
    "UX rendering and non-authorizing inspection leave browser wallet storage unchanged");
  check(!errors.length, "no browser errors: " + errors.join("; "));
  console.log(`UX flow review: ${checks.length} checks, ${layouts.length} state variants`);
} finally {
  await browser.close();
  writeFileSync(resolve(out, "report.json"), JSON.stringify({ checks, layouts, errors }, null, 2));
}
