// Explicit opt-out checks use temporary unfunded stores and real local ceremony handlers.
import { layout, navigation, palette, settled, THEMES, WIDTHS } from "./premium-visuals.mjs";
import { installAuthenticator, unlockIfNeeded } from "./passkey-ui.mjs";

export const button = (page, name) => page.getByRole("button", { name, exact: true });
export const NEXT = "Continue to approval rule";
export const SKIP = "Skip for now";
export const CONTINUE = "Continue without protection";
export const RETURN = "Go back";
export const WARNING = "Are you sure?";

export async function protectionFacts(page) {
  return page.evaluate(async () => {
    const k = await import("/app-keystore.js"), { state } = await import("/app-state.js");
    return { protected: k.passkeyProtected(), ready: k.setupProtectionReady?.() || false,
      canSkip: k.canSkipPasskeyProtection?.() || false,
      sealed: !!localStorage.getItem("zf-vault"), groups: state.groups.length,
      secrets: Object.keys(k.secrets).length,
      plain: ["zf-secrets", "zf-keys", "zf-chats"].some((key) =>
        !!localStorage.getItem(key)),
      shares: Object.values(k.secrets).filter((share) => !!share.keyPackage).length };
  });
}

export async function protectionMatrix(page, qa, scene) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    for (const theme of THEMES) {
      await palette(page, theme); await layout(page, qa, scene + " " + width + " " + theme.name);
      if (["dark", "light"].includes(theme.name))
        await qa.capture(page, scene + "-" + width + "-" + theme.name);
    }
  }
}

async function doubleText(page, qa, scene) {
  await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("body *")];
    window.__optionalSizes = nodes.map((n) => [n, n.style.fontSize, getComputedStyle(n).fontSize]);
    for (const [node, , size] of window.__optionalSizes)
      node.style.fontSize = parseFloat(size) * 2 + "px";
  });
  await layout(page, qa, scene + " actual 200% text");
  const action = button(page, qa.after && scene === "warning" ? CONTINUE : NEXT);
  await action.evaluate((node) => node.scrollIntoView({ block: "center" }));
  qa.check(await action.isVisible(), scene + " 200% action remains reachable by internal scroll");
  await qa.capture(page, scene + "-320-double-text");
  await page.evaluate(() => {
    for (const [node, value] of window.__optionalSizes) if (node.isConnected)
      node.style.fontSize = value;
    delete window.__optionalSizes;
  });
}

export async function protectionPreferences(page, qa, scene) {
  await page.setViewportSize({ width: 320, height: 844 }); await palette(page, THEMES[0]);
  await doubleText(page, qa, scene);
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await layout(page, qa, scene + " forced colors");
  await qa.capture(page, scene + "-forced-colors");
  qa.check(await page.evaluate(() => matchMedia("(prefers-reduced-motion:reduce)").matches
    && !document.getAnimations().some((animation) => animation.playState === "running")),
  scene + " reduced motion keeps security guidance static");
  await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
}

export async function acknowledge(page, qa) {
  await button(page, SKIP).click();
  await page.getByRole("heading", { name: WARNING, exact: true }).waitFor();
  await button(page, CONTINUE).click(); await settled(page);
  const facts = await protectionFacts(page);
  qa.check(facts.ready && !facts.protected && !facts.sealed,
    "only explicit confirmation enables an honestly unprotected new entry");
  qa.check(await page.locator(".device-protection[data-motion-value=verified]").count() === 0,
    "unprotected entry never renders the verified passkey status mark");
}

async function beforeCreation(page, qa) {
  qa.check(await button(page, NEXT).isDisabled(), "default create continuation is blocked");
  await button(page, SKIP).click();
  await page.getByRole("heading", { name: WARNING, exact: true }).waitFor();
  const safe = button(page, RETURN);
  qa.check(await safe.evaluate((node) => node === document.activeElement),
    "confirmation initially focuses the safer protection action");
  qa.check(await page.locator("[data-skip-protection]").innerText()
    .then((text) => /saved.*without Zigs’ passkey encryption/s.test(text)),
    "confirmation explains unencrypted signing-share storage");
  qa.check(await page.getByText(/approval rule still applies/).isVisible(),
    "confirmation preserves the wallet approval rule explanation");
  const facts = await protectionFacts(page);
  qa.check(!facts.ready && !facts.protected && !facts.sealed && !facts.secrets && !facts.groups,
    "opening the warning creates no wallet, signing share, vault or acknowledgement");
}

export async function confirmationChecks(page, qa) {
  await beforeCreation(page, qa);
  await protectionMatrix(page, qa, "warning");
  await protectionPreferences(page, qa, "warning");
  await page.keyboard.press("Escape"); await settled(page);
  qa.check(await button(page, SKIP).evaluate((node) => node === document.activeElement),
    "Escape cancels the warning and returns focus to Skip");
  qa.check(await button(page, NEXT).isDisabled(), "Escape does not acknowledge unprotected entry");
  await button(page, SKIP).click(); await settled(page);
  await button(page, RETURN).click(); await settled(page);
  qa.check(await button(page, SKIP).evaluate((node) => node === document.activeElement),
    "safer return cancels and restores focus to Skip");
  qa.check(!(await protectionFacts(page)).ready, "safer return does not acknowledge opt-out");
  await acknowledge(page, qa);
  qa.check(await page.getByRole("heading", { name: "Set the approval threshold", exact: true })
    .isVisible(), "explicit creation confirmation advances to threshold selection");
  await page.reload(); await page.locator(".welcome").waitFor();
  await button(page, "Create wallet").click();
  qa.check(await button(page, NEXT).isDisabled() && !(await protectionFacts(page)).ready,
    "reload clears only tab consent and restores protected-first setup");
}

export async function createUnprotected(page, qa) {
  await page.evaluate(async () => {
    const engine = await import("/app-engine.js");
    engine.setZ({ ...engine.Z, latestHeight: async () => 4500000 });
  });
  await acknowledge(page, qa);
  await page.getByRole("heading", { name: "Set the approval threshold", exact: true }).waitFor();
  await page.waitForTimeout(420); await button(page, "Use this arrangement").click();
  await page.getByRole("heading", { name: "Set up this device", exact: true }).waitFor();
  qa.check(await page.locator(".guide-step:not([hidden]) .tutorial-diagram").innerText()
    .then((text) => /These 3 independent shares belong to one wallet/i.test(text)
      && !/Passkey unlock/i.test(text)),
  "unprotected device step shows independent shares without a passkey unlock claim");
  await page.locator("#g-name").fill("Optional protection wallet");
  await page.locator("#my-name").fill("Everyday browser");
  await page.waitForTimeout(420); await button(page, "Continue").click();
  await page.getByRole("heading", { name: "Review your wallet", exact: true }).waitFor();
  qa.check(await page.getByText("Skipped · no passkey encryption", { exact: true }).isVisible(),
    "final review truthfully identifies the skipped browser protection");
  await page.getByText("Network options", { exact: true }).click();
  await page.locator("#g-sol").uncheck();
  await page.waitForTimeout(420);
  await page.getByRole("dialog")
    .getByRole("button", { name: "Create wallet", exact: true }).click();
  await page.getByRole("heading", { name: "Connect your second device", exact: true }).waitFor();
  const facts = await protectionFacts(page);
  qa.check(!facts.protected && !facts.sealed && facts.plain && facts.secrets === 1,
    "actual creation uses the existing unencrypted local path with truthful protection status");
  return page.evaluate(async () => (await import("/app-links.js"))
    .inviteLink((await import("/app-state.js")).state.gid));
}

export async function joinUnprotected(page, qa, invite, seat) {
  await page.goto(invite);
  await page.getByRole("heading", { name: "Join Optional protection wallet", exact: true })
    .waitFor();
  await page.evaluate(async () => {
    const engine = await import("/app-engine.js");
    engine.setZ({ ...engine.Z, latestHeight: async () => 4500000 });
  });
  const action = button(page, "Join as device " + seat);
  qa.check(await action.isDisabled(), "new join is blocked before explicit confirmation");
  await button(page, SKIP).click();
  await page.getByRole("heading", { name: WARNING, exact: true }).waitFor();
  await settled(page); await page.keyboard.press("Escape"); await settled(page);
  qa.check(await action.isDisabled() && !(await protectionFacts(page)).ready,
    "join warning cancellation keeps the join gate closed");
  await acknowledge(page, qa);
  await page.locator("#seat-name").fill(seat === 2 ? "Second browser" : "Reserve browser");
  await action.click();
  const facts = await protectionFacts(page);
  qa.check(!facts.protected && !facts.sealed && facts.plain && facts.secrets === 1,
    "actual join keeps its new share unencrypted without a false protected badge");
}

export async function finishUnprotected(pages, qa) {
  for (const page of pages) await page.getByRole("heading", {
    name: "Check that your devices match", exact: true }).waitFor();
  const digits = await Promise.all(pages.map((page) => page.locator(".safety").innerText()));
  qa.check(new Set(digits).size === 1 && digits[0].replace(/\D/g, "").length === 30,
    "unprotected path retains the complete matching 30-digit ceremony check");
  for (const page of pages) {
    qa.check(await button(page, "Codes match").isDisabled(),
      "each unprotected signer still requires the full-number acknowledgement");
    await page.getByRole("checkbox", {
      name: "I compared all 30 digits on every device.", exact: true }).check();
  }
  for (const page of pages) await button(page, "Codes match").click();
  for (const page of pages) {
    await page.getByRole("heading", { name: /^Your wallet is (?:ready|prepared)$/ })
      .waitFor({ timeout: 90000 });
    await button(page, "Open Overview").click();
    await page.getByRole("heading", { name: "Your assets", exact: true }).waitFor();
  }
  qa.check((await protectionFacts(pages[0])).shares === 1,
    "real unfunded 2-of-3 ceremony completes through the existing signing engine");
  await qa.capture(pages[0], "unprotected-overview");
}

export async function replacementAndReload(page, qa) {
  await page.reload(); await page.getByRole("heading", { name: "Your assets", exact: true })
    .waitFor();
  qa.check(!(await protectionFacts(page)).ready && (await protectionFacts(page)).shares === 1,
    "existing wallet stays accessible after opt-out consent resets on reload");
  await navigation(page, "recovery");
  await page.locator("#security-advanced>summary").click();
  await button(page, "Change devices").click();
  await page.getByRole("heading", { name: "Change devices", exact: true }).waitFor();
  const create = button(page, "Create new wallet");
  qa.check(await create.isDisabled(), "replacement wallet is protected-first after reload");
  await button(page, SKIP).click();
  await page.getByRole("heading", { name: WARNING, exact: true }).waitFor();
  await settled(page); await page.keyboard.press("Escape"); await settled(page);
  qa.check(await create.isDisabled(), "replacement warning cancellation keeps creation blocked");
  await acknowledge(page, qa);
  qa.check(await create.isEnabled(), "explicit acknowledgement applies to replacement entry");
  await qa.capture(page, "replacement-unprotected");
  await button(page, "Cancel").click();
}

export async function laterProtection(page, qa) {
  await installAuthenticator(page); await navigation(page, "settings");
  const before = await protectionFacts(page);
  await button(page, "Lock with a passkey").click();
  await button(page, "Lock now").waitFor(); await settled(page);
  const facts = await protectionFacts(page);
  qa.check(facts.protected && facts.sealed && !facts.plain && facts.shares === before.shares,
    "later verified passkey activation migrates existing shares and removes covered plaintext "
      + JSON.stringify({ before, after: facts }));
  await qa.capture(page, "later-protected-settings");
  await page.reload(); await page.getByRole("heading", { name: "Zigs is locked", exact: true })
    .waitFor();
  await unlockIfNeeded(page, qa.check);
  qa.check((await protectionFacts(page)).protected
    && (await protectionFacts(page)).shares === before.shares,
  "same virtual passkey reopens the migrated share after reload");
}
