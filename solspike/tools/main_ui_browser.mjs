// Local, unfunded UI verification against main. Real key ceremonies use separate browser stores.
// Chain height and balances are synthetic; non-local browser requests are blocked.
import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { exportTestWallet } from "../harness/test-wallet-snapshots.mjs";
import { premiumFrame, premiumReview } from "../harness/premium-records.mjs";
import { finishGuidedWallet, protectionFallback, unavailableService }
  from "../harness/guided-ui.mjs";
import { overviewPresentation } from "../harness/overview-ui.mjs";
import { compactDetails } from "../harness/compact-overview.mjs";
import { observeSecurity } from "../harness/security-explainers.mjs";
import { v3Surfaces } from "../harness/v3-surfaces.mjs";
import { prdEmptyDestinations, prdPresentation, prdUnfinishedDestinations, premiumReviewFixture }
  from "../harness/prd-ui.mjs";
import { installAuthenticator, invalidRpAddress, protectBeforeSetup, unlockIfNeeded }
  from "../harness/passkey-ui.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const sampleDir = process.env.ZIGS_TEST_WALLET_DIR || "";
if (sampleDir && !isAbsolute(sampleDir)) throw Error("Absolute sample output path required");
const phase = process.env.ZIGS_UI_PHASE || "after";
if (sampleDir && phase !== "after") throw Error("Samples require the current UI phase");
const capturePhase = process.env.ZIGS_CAPTURE_PHASE || phase;
const compactOverview = process.env.ZIGS_UI_COMPACT_OVERVIEW === "1";
const artDirection = process.env.ZIGS_UI_ART_DIRECTION === "1";
const securityExplainers = process.env.ZIGS_UI_SECURITY_EXPLAINERS === "1";
const optionalPasskey = process.env.ZIGS_UI_OPTIONAL_PASSKEY === "1";
const entryFlow = optionalPasskey || securityExplainers || process.env.ZIGS_UI_ENTRY_FLOW === "1";
const premium = entryFlow || compactOverview || artDirection || process.env.ZIGS_UI_PREMIUM === "1";
const premiumSlice = premium && process.env.ZIGS_PREMIUM_SLICE_ONLY === "1";
const guided = !!sampleDir || process.env.ZIGS_GUIDED === "1";
const newFlow = guided && phase === "after";
const prd = process.env.ZIGS_UI_PRD === "1";
const newPrd = prd && (premium || capturePhase !== "before");
const currentCapabilities = capturePhase !== "before" || prd;
const newOverview = process.env.ZIGS_UI_OVERVIEW === "1" && currentCapabilities;
const newPasskey = !!sampleDir || process.env.ZIGS_UI_PASSKEY === "1" && currentCapabilities;
const introTitle = newPasskey ? "Protect this browser" : "Your wallet, protected together";
const introNext = securityExplainers || entryFlow && capturePhase !== "before"
  ? "Continue to approval rule" : "Set up my wallet";
const ruleTitle = securityExplainers || entryFlow && capturePhase !== "before"
  ? "Set the approval threshold" : "Choose your protection";
const evidence = process.env.ZIGS_UI_V3 === "1" ? "web-v3"
  : optionalPasskey ? "web-optional-passkey"
  : securityExplainers ? "web-security-explainers"
  : entryFlow ? "web-entry-flow" : compactOverview ? "web-compact-overview"
  : artDirection ? "web-art-direction"
  : premium ? "web-premium" : prd ? "web-prd"
  : process.env.ZIGS_UI_PASSKEY === "1" ? "web-passkey"
  : process.env.ZIGS_UI_OVERVIEW === "1" ? "web-overview"
  : process.env.ZIGS_UI_FEEDBACK === "1" ? "web-feedback"
  : guided ? "guided-web" : "main-ui";
const setupLabels = newFlow ? {
  arrangement: "Use this arrangement", device: "Set up this device", review: "Continue",
  connect: "Connect your second device",
} : {
  arrangement: "Next", device: "Name your wallet", review: "Review wallet",
  connect: "Setting up your wallet",
};
const origin = process.env.ZIGS_TEST_ORIGIN || "http://127.0.0.1:" + (sampleDir ? "8794" : "8792");
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname))
  throw Error("Local server required");
if (sampleDir && new URL(origin).port !== "8794") throw Error("Sample QA origin must use 8794");
const out = sampleDir || `docs/ux-redesign/visuals/${evidence}/${capturePhase}`;
mkdirSync(out, { recursive: true });
const checks = [],
  screens = [],
  errors = [],
  notes = [];
const securitySeen = new Set();
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_EXECUTABLE,
});
const contexts = [],
  pages = [];
const check = (ok, label) => {
  if (!ok) throw Error(label);
  checks.push(label);
};
async function stable(p) {
  await p.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}
async function capture(p, name, fullPage = false) {
  if (sampleDir) return;
  await p.evaluate(() => scrollTo(0, 0));
  await stable(p);
  if (securityExplainers) await observeSecurity(p, { check }, securitySeen, name);
  if (premium) await premiumFrame(p, name);
  if (premiumSlice) return;
  await p.screenshot({
    path: `${out}/${name}.png`,
    fullPage,
    animations: "disabled",
    maskColor: "#343b45",
    mask: [p.locator(".safety,.qr,input[type=password],input[type=file],"
      + ".secret-link,.qr-toggle .addr-full")],
  });
  screens.push(name);
}
async function captureOverview(p, width, theme) {
  await capture(p, `06-overview-${width}-${theme}`);
  if (process.env.ZIGS_UI_OVERVIEW === "1" && [390, 1440].includes(width))
    await capture(p, `06-overview-full-${width}-${theme}`, true);
}
async function layout(p, label) {
  await stable(p);
  const over = await p.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    outside: [...document.querySelectorAll("body *")]
      .filter(
        (n) => n.getClientRects().length && n.getBoundingClientRect().right > innerWidth + 1,
      )
      .slice(0, 12)
      .map((n) => ({
        tag: n.tagName,
        class: n.className,
        text: n.textContent.trim().slice(0, 80),
        right: n.getBoundingClientRect().right,
      })),
    parts: [...document.querySelectorAll(".dialog,.drawer,.recipient-editor")]
      .filter((n) => n.getClientRects().length)
      .map((n) => ({ scroll: n.scrollWidth, width: n.clientWidth })),
  }));
  const fits =
    over.scroll <= over.width + 1 && over.parts.every((n) => n.scroll <= n.width + 1);
  if (phase === "before" && !fits) notes.push(label + " baseline has horizontal overflow");
  else
    check(
      fits,
      label + " no page/dialog horizontal overflow " + (fits ? "" : JSON.stringify(over)),
    );
  if (phase === "after")
    check(
      await p.locator(".stats .money").evaluateAll((ns) =>
        ns.every((n) => {
          const r = n.getBoundingClientRect(),
            q = n.parentElement.getBoundingClientRect();
          return r.left >= q.left - 1 && r.right <= q.right + 1;
        }),
      ),
      label + " exact amount wells stay within parent",
    );
  await reviewAmountLayout(p, label);
  // Read visibility and geometry atomically: redraws can detach previously resolved locators.
  const small = await p.evaluate(() =>
      [...document.querySelectorAll("button,summary,select")]
        .filter((n) => n.getClientRects().length && getComputedStyle(n).visibility === "visible")
        .filter((n) => {
          const r = n.getBoundingClientRect();
          return r.width < 47.5 || r.height < 47.5;
        })
        .map((n) => ({
          text: (n.getAttribute("aria-label") || n.textContent).slice(0, 36),
          width: n.getBoundingClientRect().width,
          height: n.getBoundingClientRect().height,
        })),
    );
  if (phase === "after")
    check(!small.length, label + " 48px controls " + JSON.stringify(small));
  else if (small.length) notes.push(label + " main has sub48px controls");
}
async function reviewAmountLayout(p, label) {
  if (!newPrd) return;
  const fits = await p.locator(".drawer .leaves .money.lg").evaluateAll((ns) => ns.every((n) =>
    n.scrollWidth <= n.clientWidth + 1 && getComputedStyle(n).overflowX !== "auto"));
  check(fits, label + " review amounts are fully visible without an internal horizontal scroll");
}
async function init(p) {
  await p.goto(origin);
  await patchEngine(p);
}
async function patchEngine(p) {
  await p.waitForFunction(async () => !!(await import("/app-engine.js")).Z);
  if (newPasskey) await unlockIfNeeded(p, check);
  // Unlocking the vault precedes asynchronous store boot and wallet selection. Wait for the
  // existing readiness facts before navigating; otherwise a late boot redraw races the test.
  await p.waitForFunction(async () => {
    const groups = await import("/app-groups.js"), { state } = await import("/app-state.js");
    return groups.dbReady && !state.pending && (!state.gid || state.seatsSettled);
  });
  await p.evaluate(async () => {
    const e = await import("/app-engine.js");
    class DisplayChain {
      static restore() {
        return new DisplayChain();
      }
      balance() {
        return JSON.stringify({
          spendable: 123456789,
          pending: 2345678,
          sending: 0,
          max_send: 123400000,
          height: 4500000,
          tip: 4500000,
        });
      }
      async sync() {
        return this.balance();
      }
      received() {
        return "[]";
      }
      sent() {
        return "[]";
      }
      snapshot() {
        return "{}";
      }
      free() {}
    }
    e.setZ({ ...e.Z, latestHeight: async () => 4500000, ChainWallet: DisplayChain });
    const c = await import("/app-chain.js");
    if (c.chain) {
      c.setChain({
        ...c.chain,
        cw: new DisplayChain(),
        bal: JSON.parse(new DisplayChain().balance()),
        syncing: false,
        error: null,
      });
      (await import("/app-loop.js")).render();
    }
  });
}
async function doubleText(p, label) {
  await stable(p);
  await p.evaluate(() => {
    const ns = [...document.querySelectorAll("body *")];
    const sizes = ns.map((n) => parseFloat(getComputedStyle(n).fontSize));
    window.__scaledText = ns.map((n) => [n, n.style.fontSize]);
    const probe = document.querySelector("#app h1,#app h2");
    window.__doubleProbe = { node: probe, size: parseFloat(getComputedStyle(probe).fontSize) };
    ns.forEach((n, i) => {
      if (sizes[i]) n.style.fontSize = sizes[i] * 2 + "px";
    });
  });
  await layout(p, label);
  check(
    await p.evaluate(
      () =>
        window.__doubleProbe.node.isConnected &&
        Math.abs(
          parseFloat(getComputedStyle(window.__doubleProbe.node).fontSize) -
            window.__doubleProbe.size * 2,
        ) < 0.1,
    ),
    label + " actual body text remains doubled after render",
  );
}
async function resetText(p) {
  await p.evaluate(() => {
    for (const [n, size] of window.__scaledText || [])
      if (n.isConnected) n.style.fontSize = size;
  });
  await stable(p);
}
async function nav(p, id) {
  const m = p.getByRole("button", { name: "Menu", exact: true });
  if (p.viewportSize().width <= 760) {
    await m.waitFor({ state: "visible" });
    if (await m.getAttribute("aria-expanded") !== "true") await m.click();
  }
  const target = p.locator("#tab-" + id);
  await target.waitFor({ state: "visible" });
  await target.press("Enter");
  await p.locator("#tab-" + id + "[aria-current=page]").waitFor({ state: "attached" });
  await stable(p);
}
async function captureConnect(p, name) {
  if (!newFlow || name !== "Everyday wallet") return;
  await layout(p, "guided second-device connection");
  await capture(p, "04-guided-connect");
  if (newPrd) await prdUnfinishedDestinations(p, { check, nav });
}
async function checkProtection(p, name) {
  if (newFlow) await p.locator("#g-description").fill("Shared everyday expenses");
  if (newFlow && !newPasskey && name === "Everyday wallet")
    await protectionFallback(p, { check });
}
async function chooseZcashOnly(p, name) {
  if (newFlow) {
    if (name === "Everyday wallet") await capture(p, "04-review-default-networks");
    await p.getByText("Solana setup options", { exact: true }).click();
  }
  const opt = p.locator("#g-sol");
  if (!await opt.count()) return;
  check(await opt.isChecked(), "Solana is included by default in the final review");
  await opt.uncheck();
  notes.push("Unfunded browser ceremony uses advanced Zcash-only choice; "
    + "Node fixtures cover automatic Solana without live RPC/prover.");
}
async function firstProtection(p, name) {
  if (newPasskey) await protectBeforeSetup(p, { check, layout, capture, doubleText, resetText },
    name === "Everyday wallet");
}
async function createWalletWizard(name) {
  const a = pages[0];
  const start = a.getByRole("button", { name: "Create wallet", exact: true });
  if (await start.isVisible()) await start.click();
  else {
    if (await a.getByRole("button", { name: "Menu", exact: true }).isVisible())
      await a.getByRole("button", { name: "Menu", exact: true }).click();
    await a.getByRole("button", { name: "New wallet", exact: true }).click();
  }
  await a
    .getByRole("heading", {
      name: introTitle, exact: true,
    })
    .waitFor();
  await firstProtection(a, name);
  if (name === "Everyday wallet") {
    await layout(a, "tutorial introduction");
    await capture(a, "02-tutorial-introduction");
    await a.setViewportSize({ width: 320, height: 1000 });
    await doubleText(a, "tutorial actual2x320");
    await capture(a, "02-tutorial-2x-320");
    await resetText(a);
    await a.setViewportSize({ width: 390, height: 1000 });
    const d = a.getByRole("dialog");
    await d.getByRole("button").last().focus();
    await a.keyboard.press("Tab");
    check(
      await d.evaluate((n) => n.contains(document.activeElement)),
      "setup dialog forward keyboard containment",
    );
    await a.keyboard.press("Shift+Tab");
    check(
      await d.evaluate((n) => n.contains(document.activeElement)),
      "setup dialog reverse keyboard containment",
    );
  }
  await a.waitForTimeout(420); // Respect main’s 400ms accidental double-tap guard.
  await a.getByRole("button", { name: introNext, exact: true }).click();
  await a.getByRole("heading", { name: ruleTitle, exact: true }).waitFor();
  if (name === "Everyday wallet") {
    await layout(a, "protection rule");
    await capture(a, "03-tutorial-rule");
  }
  await a.waitForTimeout(420); // Respect main’s 400ms accidental double-tap guard.
  await a.getByRole("button", {
    name: setupLabels.arrangement, exact: true,
  }).click();
  await a.getByRole("heading", {
    name: setupLabels.device, exact: true,
  }).waitFor();
  await a.locator("#g-name").fill(name);
  await a.locator("#my-name").fill("Everyday phone");
  await checkProtection(a, name);
  if (!newFlow) await chooseZcashOnly(a, name);
  await a.waitForTimeout(420); // Respect main’s 400ms accidental double-tap guard.
  await a.getByRole("button", {
    name: setupLabels.review, exact: true,
  }).click();
  await a.getByRole("heading", { name: "Review your wallet", exact: true }).waitFor();
  if (newFlow) await chooseZcashOnly(a, name);
  if (name === "Everyday wallet") {
    await layout(a, "wallet review");
    await capture(a, "04-tutorial-review");
  }
  await a.waitForTimeout(420); // Respect main’s 400ms accidental double-tap guard.
  await a.getByRole("dialog").getByRole("button", { name: "Create wallet", exact: true }).click();
  await a.getByRole("heading", {
    name: setupLabels.connect, exact: true,
  }).waitFor();
  await captureConnect(a, name);
  const invite = await a.evaluate(async () => {
    const { state } = await import("/app-state.js");
    return (await import("/app-links.js")).inviteLink(state.gid);
  });
  return invite;
}
async function joinWalletParticipants(invite, name) {
  for (let i = 1; i < 3; i++) {
    const p = pages[i];
    await p.goto(invite);
    await p.waitForFunction(async () => !!(await import("/app-engine.js")).Z);
    if (newPasskey) await unlockIfNeeded(p, check);
    await p.evaluate(async () => {
      const e = await import("/app-engine.js");
      e.setZ({ ...e.Z, latestHeight: async () => 4500000 });
    });
    await p.getByRole("heading", { name: "Join " + name, exact: true }).waitFor();
    if (newPasskey) await protectBeforeSetup(p, { check, layout, capture });
    await p.locator("#seat-name").fill(i === 1 ? "Everyday computer" : "Reserve device");
    await p.getByRole("button", { name: "Join as device " + (i + 1), exact: true }).click();
  }
}
async function finishWalletCeremony(name) {
  const a = pages[0];
  for (const p of pages)
    await p
      .getByRole("heading", { name: "Check that your devices match", exact: true })
      .waitFor();
  const nums = await Promise.all(pages.map((p) => p.locator(".safety").innerText()));
  check(
    new Set(nums).size === 1 && nums[0].replace(/\D/g, "").length === 30,
    name + " actual 30digit safety numbers match",
  );
  for (const p of pages) {
    check(
      await p.getByRole("button", { name: "It matches", exact: true }).isDisabled(),
      name + " confirmation requires full-number acknowledgment",
    );
    await p
      .getByRole("checkbox", { name: "I compared all 30 digits on every device.", exact: true })
      .check();
  }
  if (name === "Everyday wallet") {
    await layout(a, "safety verification");
    await capture(a, "05-device-verification");
  }
  await pages[0].getByRole("button", { name: "It matches", exact: true }).click();
  await pages[1].getByRole("button", { name: "It matches", exact: true }).click();
  check(
    await a.evaluate(
      async () => Object.keys((await import("/app-state.js")).state.dkg1).length === 0,
    ),
    name + " two confirmations cannot start three-device ceremony",
  );
  await pages[2].getByRole("button", { name: "It matches", exact: true }).click();
  if (newFlow) {
    await finishGuidedWallet(pages, { check, layout, capture, doubleText, resetText },
      name === "Everyday wallet");
  }
  await a
    .getByRole("heading", { name: "Your assets", exact: true })
    .waitFor({ timeout: 90000 })
    .catch(async (e) => {
      if (phase === "before")
        await a.getByRole("heading", { name: "ZEC", exact: true }).waitFor({ timeout: 90000 });
      else throw e;
    });
  await a.waitForFunction(async () => {
    const c = (await import("/app-chain.js")).chain;
    return !!c?.bal;
  });
  check(
    (await a.locator("[data-key^=wallet-]").count()) >=
      (await a.evaluate(async () => (await import("/app-state.js")).state.groups.length)),
    name + " sidebar renders every wallet without unreadable fallback",
  );
  check(true, name + " real unfunded three-device wallet formed");
  return a.evaluate(async () => (await import("/app-state.js")).state.wallet.address);
}
async function createWallet(name) {
  const invite = await createWalletWizard(name);
  await joinWalletParticipants(invite, name);
  return finishWalletCeremony(name);
}

verification: try {
  for (let i = 0; i < 3; i++) {
    const c = await browser.newContext({
      viewport: { width: 390, height: 1000 },
      reducedMotion: "reduce",
      colorScheme: "dark",
    });
    contexts.push(c);
    await c.route("**/*", (r) =>
      ["127.0.0.1", "localhost"].includes(new URL(r.request().url()).hostname)
        ? r.continue()
        : r.abort(),
    );
    const p = await c.newPage();
    if (newPasskey) await installAuthenticator(p);
    pages.push(p);
    p.on("pageerror", (e) => errors.push(e.name + ": " + e.message));
  }
  const a = pages[0];
  if (newPasskey && !sampleDir) await invalidRpAddress(browser, origin, { check, layout, capture });
  await init(a);
  if (newPrd) await prdEmptyDestinations(a, { check, nav });
  if (newFlow) check(await a.locator("#tab-chats").isDisabled(),
    "Chats is unavailable before opening a wallet");
  await layout(a, "welcome");
  await capture(a, "01-welcome");
  const address = await createWallet(sampleDir ? "Test wallet" : "Everyday wallet");
  if (premiumSlice) {
    await a.setViewportSize({ width: 1440, height: 900 });
    await capture(a, "06-overview-1440-dark");
    await premiumReview(a, await premiumReviewFixture(a));
    check(errors.length === 0, "presentation frame build has no browser errors");
    break verification;
  }
  if (sampleDir) {
    await exportTestWallet(a, { directory: sampleDir, nav, stable, check });
    check(errors.length === 0, "sample build has no uncaught browser errors");
    break verification;
  }
  for (const width of [320, 390, 768, 1440]) {
    await a.setViewportSize({ width, height: 1000 });
    for (const theme of ["dark", "light"]) {
      await a.evaluate((t) => {
        document.documentElement.dataset.theme = t;
        localStorage.setItem("zf-theme", t);
      }, theme);
      await layout(a, "Overview " + width + " " + theme);
      await captureOverview(a, width, theme);
    }
  }
  await a.setViewportSize({ width: 390, height: 1000 });
  if (phase === "after") {
    check(await a.locator(".overview-approvals").isVisible(), "Approvals inside Overview");
    if (newOverview) await overviewPresentation(a, {
      check, layout, capture, stable, doubleText, resetText, nav,
    });
    if (compactOverview) await compactDetails(a, { check, stable });
    if (!newOverview) check(
      (await a
        .locator(".overview-page")
        .getByRole("heading", { name: "Activity", exact: true })
        .count()) === 0,
      "Overview has no recent Activity panel",
    );
    check(
      await a
        .locator("[aria-labelledby=asset-usdc]")
        .getByRole("button")
        .evaluateAll((ns) => ns.every((n) => n.disabled)),
      "Unavailable USDC actions remain disabled",
    );
    const navNames = newPrd
      ? "Overview|Approvals|Activity|Address book|Swap|Chats|Security|Settings"
      : "Overview|Activity|Address book|Swap|Chats|Settings";
    check(
      (await a.locator("#side-nav > button[id^=tab-]").allTextContents())
        .map((s) => s.replace(/\d/g, "").trim())
        .join("|") === navNames,
      "agreed sidebar destinations match the current presentation phase",
    );
    if (prd) await prdPresentation(a, {
      check, layout, capture, stable, doubleText, resetText, nav,
    }, { after: newPrd });
    if (process.env.ZIGS_UI_V3 === "1") {
      await premiumReview(a, await premiumReviewFixture(a));
      await v3Surfaces(a, { check, layout, capture, stable, nav });
    }
    await nav(a, "recipients");
    await a.getByRole("button", { name: "Add recipient", exact: true }).click();
    await a
      .getByRole("textbox", { name: "Name on this device", exact: true })
      .fill("Everyday recipient");
    await a.getByRole("textbox", { name: "Full payment address", exact: true }).fill(address);
    await a.getByRole("button", { name: "Save recipient", exact: true }).click();
    await a.locator(".recipient-card").waitFor();
    check(
      await pages[1].evaluate(
        async () => (await import("/app-keystore.js")).recipients.entries.length === 0,
      ),
      "saved recipient is not shared with another device of the same wallet",
    );
    await layout(a, "Address book");
    await capture(a, "07-address-book");
    await a.getByRole("button", { name: "Edit Everyday recipient", exact: true }).click();
    await a
      .getByRole("textbox", { name: "Name on this device", exact: true })
      .fill("Primary recipient");
    await a.getByRole("button", { name: "Save recipient", exact: true }).click();
    await a.getByRole("heading", { name: "Primary recipient", exact: true }).waitFor();
    await a
      .getByRole("searchbox", { name: "Search payment recipients", exact: true })
      .fill("no-match");
    check(
      await a.getByRole("heading", { name: "No matching recipients", exact: true }).isVisible(),
      "recipient search filters without deleting",
    );
    await a
      .getByRole("searchbox", { name: "Search payment recipients", exact: true })
      .fill("Primary");
    check(
      (await a.locator(".recipient-card").count()) === 1,
      "recipient search finds renamed entry",
    );
    await a.reload();
    await patchEngine(a);
    await nav(a, "recipients");
    await a.getByRole("heading", { name: "Primary recipient", exact: true }).waitFor();
    check(true, "recipient edit persists across reload");
    await a.getByRole("button", { name: "Delete Primary recipient", exact: true }).click();
    await a.getByRole("button", { name: "Keep recipient", exact: true }).click();
    check(
      (await a.locator(".recipient-card").count()) === 1,
      "delete confirmation cancellation preserves recipient",
    );
    await nav(a, "chats");
    check(
      (await a.locator(".asset-card,.assets-grid,#fund-amt").count()) === 0,
      "general Chats has no holdings or funding cards",
    );
    await layout(a, "Chats");
    await capture(a, "08-chats");
    if (!newFlow) {
    await a.getByRole("button", { name: "New chat", exact: true }).click();
    await a.locator("#chat-name").fill("Synthetic contact");
    await a.getByRole("button", { name: "Create", exact: true }).click();
    await a.waitForFunction(async () => !!(await import("/app-state.js")).state.cid);
    await a.getByRole("heading", { name: "Messages", exact: true }).waitFor();
    check(
      await a.evaluate(async () => (await import("/app-state.js")).state.gid === null),
      "direct Chat opens independently of selected wallet",
    );
    check(
      (await a.locator(".asset-card,.assets-grid,#fund-amt").count()) === 0,
      "direct conversation has no holdings or funding",
    );
    await capture(a, "08-direct-chat");
    await nav(a, "chats");
    await a.locator("[data-key^=wallet-chat-]").first().click();
    }
    await a.getByRole("heading", { name: "Messages", exact: true }).waitFor();
    check(
      (await a.locator(".asset-card,.assets-grid,#fund-amt").count()) === 0,
      "wallet conversation opens messages without holdings",
    );
    if (newFlow) check(await a.evaluate(async () =>
      !!(await import("/app-state.js")).state.gid), "Chats keeps its selected wallet context");
    await nav(a, "activity");
    await layout(a, "Activity");
    await capture(a, "09-activity");
    await nav(a, "swap");
    await layout(a, "Swap");
    check(
      await a.getByRole("button", { name: "Swap unavailable", exact: true }).isDisabled(),
      "Swap unavailable without simulated quotes",
    );
    await capture(a, "10-swap");
  }
  await nav(a, "settings");
  if (newFlow) {
    await a.locator("textarea[id^=wallet-description-]")
      .fill("Shared everyday expenses · private note");
    await a.getByRole("button", { name: "Save description", exact: true }).click();
    await a.locator("#banner-close").click();
    await a.reload();
    await patchEngine(a);
    await nav(a, "settings");
    check(await a.locator("textarea[id^=wallet-description-]").inputValue()
      === "Shared everyday expenses · private note", "private description persists after reload");
    check(await pages[1].evaluate(async () => {
      const { state } = await import("/app-state.js");
      return (await import("/wallet-description.js")).descriptionOf(state.gid).text === "";
    }), "description is not sent to another signer of the same wallet");
  }
  await layout(a, "Settings");
  await capture(a, "11-settings");
  await nav(a, "overview");
  if (phase === "after")
    await a
      .locator("[aria-labelledby=asset-zec]")
      .getByRole("button", { name: "Deposit", exact: true })
      .click();
  else await a.getByRole("button", { name: "Receive", exact: true }).first().click();
  await a.getByRole("dialog").waitFor();
  await layout(a, "Deposit dialog");
  await capture(a, "12-deposit");
  await a.getByRole("button", { name: "Close", exact: true }).click();
  await patchEngine(a);
  if (phase === "after")
    await a
      .locator("[aria-labelledby=asset-zec]")
      .getByRole("button", { name: "Send", exact: true })
      .click();
  else await a.getByRole("button", { name: "Send", exact: true }).first().click();
  await a.getByRole("dialog").waitFor();
  await layout(a, "Send dialog");
  await capture(a, "13-send");
  if (phase === "after") {
    const saved = a.locator("#zec-saved-recipient");
    const pick = (await saved.count()) ? saved : a.locator(".recipient-picker select");
    const value = await pick.locator("option").last().getAttribute("value");
    await pick.selectOption(value);
    check(
      (await a.locator("input[id^=s-to-]").first().inputValue()) === address,
      "saved recipient fills only existing ZEC recipient field",
    );
  }
  await a.setViewportSize({ width: 320, height: 1000 });
  await doubleText(a, "Send dialog actual2x320");
  await capture(a, "13-send-2x-320");
  await resetText(a);
  await a.setViewportSize({ width: 390, height: 1000 });
  await a.keyboard.press("Escape");
  await stable(a);
  // Double the settled page’s actual computed sizes, then verify a body-text probe survives.
  await doubleText(a, "Overview actual 2x text");
  await capture(a, "14-enlarged-text");
  await a.reload();
  await patchEngine(a);
  await a.evaluate(() => {
    delete document.documentElement.dataset.theme;
    localStorage.removeItem("zf-theme");
  });
  await a.emulateMedia({
    forcedColors: "active",
    reducedMotion: "reduce",
    colorScheme: "light",
  });
  await layout(a, "forced colors reduced motion system light");
  await capture(a, "15-forced-colors");
  if (phase === "after") {
    const motion = await a.evaluate(() => ({
      match: matchMedia("(prefers-reduced-motion: reduce)").matches,
      animated: document.getAnimations().filter((x) => x.playState === "running").length,
    }));
    check(motion.match && !motion.animated, "reduced motion stops decorative animations");
    await a.emulateMedia({
      forcedColors: "none",
      reducedMotion: "reduce",
      colorScheme: "dark",
    });
    const cdp = await a.context().newCDPSession(a);
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [
        { name: "prefers-reduced-transparency", value: "reduce" },
        { name: "prefers-reduced-motion", value: "reduce" },
        { name: "prefers-color-scheme", value: "dark" },
      ],
    });
    check(
      await a.evaluate(() => matchMedia("(prefers-reduced-transparency: reduce)").matches),
      "reduced transparency preference rendered",
    );
    await layout(a, "reduced transparency");
    await capture(a, "16-reduced-transparency");
    await createWallet("Reserve wallet");
    await nav(a, "overview");
    await patchEngine(a);
    await a
      .locator("[aria-labelledby=asset-zec]")
      .getByRole("button", { name: "Send", exact: true })
      .click();
    const cross = a.locator(".recipient-picker select");
    const crossValue = await cross.locator("option").last().getAttribute("value");
    await cross.selectOption(crossValue);
    check(
      (await a.locator("input[id^=s-to-]").first().inputValue()) === address,
      "device-private saved recipient available in second independently formed wallet",
    );
    await a.keyboard.press("Escape");
    await nav(a, "recipients");
    await a.getByRole("button", { name: "Delete Primary recipient", exact: true }).click();
    await a.getByRole("button", { name: "Remove recipient", exact: true }).click();
    await a
      .getByRole("heading", { name: "Your recipients, in one place", exact: true })
      .waitFor();
    check(true, "confirmed recipient deletion removes only recipient");
  }
  if (newFlow) await unavailableService(a, { check, layout, capture, patchEngine });
  check(errors.length === 0, "no uncaught browser errors");
} catch (error) {
  errors.push(error.name + ": " + error.message.split("\n")[0]
    .replace(/\/Users\/[^\s]+/g, "[local path]"));
  throw error;
} finally {
  const report = {
    phase: capturePhase,
    uiPhase: phase,
    checks,
    screens,
    errors,
    notes: [...new Set(notes)],
    ...(securityExplainers ? { securityEducationObserved: [...securitySeen].sort() } : {}),
    limitations: [
      "Synthetic chain height and unfunded display balances; "
        + "no funded payment was prepared, approved or broadcast.",
      "Any received-row fixture is synthetic display data, not a funded transaction.",
      "No live Solana RPC, prover, swap or USDC support verified.",
      "Physical devices, software keyboards and assistive technology "
        + "are outside browser emulation.",
      ...(newPasskey ? ["Passkeys use Chrome virtual authenticators; "
        + "physical biometrics, security keys and provider synchronization are unverified."] : []),
      ...(prd ? ["PRD review screenshots use actual read-only component rendering with synthetic "
        + "unreadable ZEC and expired SOL inputs, with no approval handlers "
        + "or real payment session."]
        : []),
    ],
  };
  writeFileSync(
    sampleDir ? join(sampleDir, "build-validation.json")
      : `docs/ux-redesign/${evidence}-${capturePhase}${premiumSlice ? "-slice" : ""}`
        + "-validation.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
  console.log(
    JSON.stringify({ phase: capturePhase, checks: checks.length, screens: screens.length, errors }),
  );
}
