// Presentation checks only, in temporary unfunded browser stores.
import { layout, palette, settled, THEMES, WIDTHS } from "./premium-visuals.mjs";
import { installAuthenticator, protectBeforeSetup } from "./passkey-ui.mjs";

const role = (page, name) => page.getByRole("button", { name, exact: true });
const KINDS = ["passkey", "threshold", "device", "review"];
const TITLES = ["Protect this browser", "Set the approval threshold", "Set up this device",
  "Review your wallet"];

export async function explainerFacts(page, qa, scope, kind, label) {
  const facts = await scope.locator(".security-explanation").evaluateAll((nodes) =>
    nodes.filter((n) => n.getClientRects().length).map((n) => ({
      kind: n.dataset.securityExplanation || "",
      title: n.querySelector("strong")?.textContent.trim() || "",
      copy: n.querySelector("p")?.textContent.trim() || "",
      decorative: n.querySelector(".symbol")?.getAttribute("aria-hidden") === "true",
      icon: !!n.querySelector(".symbol svg path[d]"),
      static: !n.getAnimations({ subtree: true }).some((a) => a.playState === "running"),
    })));
  const expected = facts.filter((f) => !kind || f.kind === kind);
  qa.check(expected.length === 1, label + " has one contextual explainer");
  qa.check(expected.length === 1 && expected.every((f) => f.title.length > 10
    && f.copy.length > 40 && f.decorative && f.icon && f.static),
  label + " has a static decorative icon with visible security meaning");
  if (kind === "passkey") qa.check(expected.some((f) => /fingerprint, face, PIN|fingerprint/i
    .test(f.copy) && /not another signer|not.*recovery backup/i.test(f.copy)),
  "passkey guidance distinguishes local unlock, signers and recovery");
  return facts;
}

export async function securityMatrix(page, qa, label, scope, kind) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    for (const theme of THEMES) {
      await palette(page, theme);
      await layout(page, qa, label + " " + width + " " + theme.name);
      if (qa.after) await explainerFacts(page, qa, scope, kind, label);
      if ([320, 390, 1440].includes(width) && ["dark", "light"].includes(theme.name))
        await qa.capture(page, label + "-" + width + "-" + theme.name);
    }
  }
}

export async function observeSecurity(page, qa, seen, label) {
  const facts = await page.evaluate(() => {
    const visible = (n) => n.getClientRects().length && getComputedStyle(n).visibility !== "hidden";
    const layers = [...document.querySelectorAll(".dialog,.drawer")].filter(visible);
    const scope = layers.at(-1) || document;
    return [...scope.querySelectorAll(".security-explanation")].filter(visible).map((n) => ({
      kind: n.dataset.securityExplanation,
      title: n.querySelector("strong")?.textContent.trim(),
      copy: n.querySelector("p")?.textContent.trim(),
      decorative: n.querySelector(".symbol")?.getAttribute("aria-hidden") === "true",
      icon: !!n.querySelector(".symbol svg path[d]"),
    }));
  });
  if (!facts.length) return;
  qa.check(facts.every((f) => f.kind && f.title?.length > 10 && f.copy?.length > 40
    && f.decorative && f.icon), label + " pairs each security icon with visible meaning");
  for (const fact of facts) seen.add(fact.kind);
}

export async function securityPreferences(page, qa, label, scope, kind) {
  await page.setViewportSize({ width: 320, height: 844 }); await palette(page, THEMES[0]);
  await page.evaluate(() => {
    window.__securitySizes = [...document.querySelectorAll("body *")]
      .map((n) => [n, n.style.fontSize, getComputedStyle(n).fontSize]);
    for (const [n, , size] of window.__securitySizes)
      n.style.fontSize = parseFloat(size) * 2 + "px";
  });
  await layout(page, qa, label + " actual200% text320");
  await qa.capture(page, label + "-320-double-text");
  await page.evaluate(() => {
    for (const [n, size] of window.__securitySizes) if (n.isConnected) n.style.fontSize = size;
    delete window.__securitySizes;
  });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await layout(page, qa, label + " forced colors320");
  if (qa.after && kind !== "unavailable") await explainerFacts(page, qa, scope, kind, label);
  await qa.capture(page, label + "-320-forced-colors");
  await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
}

export async function securitySample(page, qa, id) {
  const scope = page.locator(".dialog,.drawer,.page-heading,.section-heading,.workspace-heading")
    .filter({ has: page.locator(".security-explanation") }).first();
  if (id === "swap") {
    qa.check(await page.locator(".asset-unavailable .symbol svg path[d]").count() > 0
      && await role(page, "Swap unavailable").isDisabled(),
    "Swap retains its decorative icon and truthful unavailable state");
  } else await explainerFacts(page, qa, scope, null, id + " primary sample context");
  qa.check(await page.locator(".security-explanation").evaluateAll((nodes) => nodes.every((n) =>
    n.querySelector("strong")?.textContent.trim().length > 10
      && n.querySelector("p")?.textContent.trim().length > 40
      && n.querySelector(".symbol")?.getAttribute("aria-hidden") === "true")),
  id + " sample gives every visible security symbol a readable explanation");
  await securityPreferences(page, qa, "sample-" + id, scope,
    id === "swap" ? "unavailable" : null);
  if (id !== "overview") return;
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const theme of THEMES.slice(0, 2)) {
    await palette(page, theme);
    const assets = await page.locator(".asset-card").evaluateAll((nodes) => nodes.map((n) => {
      const r = n.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    }));
    qa.check(assets.length === 3 && assets.every((n) => n.top >= 0 && n.bottom <= 900),
      "Overview keeps all three asset cards in desktop viewport " + theme.name);
    await qa.captureViewport(page, "security-overview-desktop-" + theme.name);
  }
}

async function planStep(page, qa, index) {
  const scope = page.locator(".guide-step:not([hidden])");
  await page.getByRole("heading", { name: TITLES[index], exact: true }).waitFor();
  qa.check(await scope.count() === 1, "plan step" + (index + 1) + " hides other step bodies");
  qa.check(await page.locator(".setup-plan-progress [aria-current=step]").innerText()
    .then((text) => text.includes(TITLES[index])), "step progress matches visible plan step");
  await securityMatrix(page, qa, "plan-" + (index + 1), scope, KINDS[index]);
  await securityPreferences(page, qa, "plan-" + (index + 1), scope, KINDS[index]);
}

async function next(page, title) {
  await page.waitForTimeout(420); // Preserve the existing accidental double-tap guard.
  await role(page, title).press("Enter"); await settled(page);
}

export async function securityPlan(page, qa) {
  await installAuthenticator(page); await role(page, "Create wallet").press("Enter");
  await planStep(page, qa, 0);
  qa.check(await role(page, "Continue to approval rule").isDisabled(),
    "new-signer continuation requires confirmed passkey protection");
  await protectBeforeSetup(page, qa);
  await next(page, "Continue to approval rule"); await planStep(page, qa, 1);
  await next(page, "Use this arrangement"); await planStep(page, qa, 2);
  await page.locator("#g-name").fill("Everyday wallet");
  await page.locator("#my-name").fill("Everyday phone");
  await page.locator("#g-description").fill("Synthetic browser-only note");
  await next(page, "Continue"); await planStep(page, qa, 3);
  qa.check(await page.locator(".guide-step:not([hidden]) dd")
    .filter({ hasText: "Synthetic browser-only note" }).isVisible(),
    "security education retains entered review values");
  await role(page, "Back").press("Enter"); await settled(page);
  qa.check(await page.locator("#g-name").inputValue() === "Everyday wallet"
    && await page.locator("#g-description").inputValue() === "Synthetic browser-only note",
  "Back retains wallet name and browser-private description");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  qa.check(await role(page, "Create wallet").evaluate((n) => n === document.activeElement),
    "closing plan returns keyboard focus to entry");
}
