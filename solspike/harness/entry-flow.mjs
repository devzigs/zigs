// Entry presentation checks in fresh, unfunded browser stores. Never a user-owned profile.
import { layout, palette, settled, THEMES, WIDTHS } from "./premium-visuals.mjs";
import { installAuthenticator, protectBeforeSetup } from "./passkey-ui.mjs";

const role = (page, name) => page.getByRole("button", { name, exact: true });
const collection = (page) => page.locator("#welcome-wallets");

export async function entryReady(page, origin) {
  await page.goto(origin);
  await page.waitForFunction(async () => {
    const engine = await import("/app-engine.js"), groups = await import("/app-groups.js");
    return !!engine.Z && groups.dbReady;
  });
  await settled(page);
}

export async function syntheticList(page) {
  await page.evaluate(async () => {
    const { state } = await import("/app-state.js");
    state.groups = [
      { id: "e1".repeat(10), name: "Everyday wallet", n: 3, t: 2, network: "testnet" },
      { id: "e2".repeat(10), name: "Travel and shared expenses wallet with a long name",
        n: 3, t: 2, network: "testnet" },
    ];
    (await import("/app-loop.js")).render();
  });
  await settled(page);
}

async function viewportFacts(page) {
  return page.evaluate(() => {
    const rect = (n) => n?.getBoundingClientRect();
    const inside = (node) => {
      const box = rect(node);
      return !!box && box.top >= 0 && box.bottom <= innerHeight;
    };
    const actions = [...document.querySelectorAll(".welcome-actions button")].slice(0, 2);
    const wallets = document.getElementById("welcome-wallets");
    const first = wallets?.querySelector("button[data-key^=wallet-row]");
    return { height: innerHeight, scroll: document.documentElement.scrollHeight,
      actions: actions.length === 2 && actions.every((n) => rect(n).top >= 0
        && rect(n).bottom <= innerHeight),
      returning: !!document.querySelector(".welcome-returning"), collection: !!wallets,
      first: inside(first),
      secondary: first && rect(first).top > rect(actions[0]).bottom,
      hero: !!document.querySelector(".welcome-brand-plate")?.checkVisibility(),
      branding: /private by design/i.test(document.querySelector(".welcome")?.textContent || ""),
      notice: /Beta · Not audited/.test(
        document.querySelector(".welcome-release-note")?.textContent),
      disclosures: /fee address.*public/s.test(document.body.textContent) };
  });
}

async function entryCase(page, qa, scene, width, theme) {
  await palette(page, theme); await page.evaluate(() => scrollTo(0, 0));
  await layout(page, qa, scene + " " + width + " " + theme.name);
  const facts = await viewportFacts(page);
  if (qa.after && !scene.includes("step")) {
    qa.check(facts.returning ? facts.first : facts.actions,
      scene + " primary entry action visible initially " + width);
    qa.check(facts.hero, scene + " zebra hero remains visible");
    qa.check(facts.returning ? facts.collection && facts.secondary : !facts.collection,
      scene + " compact wallet entries follow the hero without an intermediate selector");
    qa.check(facts.branding && facts.notice, scene + " private brand and release notice");
    qa.check(facts.disclosures, scene + " operational Solana privacy disclosure retained");
  }
  if (["dark", "light"].includes(theme.name))
    await qa.capture(page, scene + "-" + width + "-" + theme.name);
}

export async function entryMatrix(page, qa, scene) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    for (const theme of THEMES) await entryCase(page, qa, scene, width, theme);
  }
}

export async function walletsCollection(page, qa) {
  const wallets = collection(page);
  if (!qa.after) return;
  qa.check(await wallets.count() === 1 && await wallets.locator(".row-item").count() === 2,
    "the saved-wallet collection exposes both synthetic rows directly");
  qa.check(await wallets.locator("summary").count() === 0,
    "opening a wallet requires no intermediate disclosure");
  qa.check(await wallets.locator(".ri-sub").evaluateAll((nodes) => nodes.length === 2
    && nodes.every((n) => /Zcash Testnet.*Any 2 of 3 devices/.test(n.textContent))),
    "wallet rows retain actual network identification");
  await wallets.locator(".row-item").first().focus();
  await page.evaluate(async () => (await import("/app-loop.js")).render());
  await settled(page);
  qa.check(await wallets.locator(".row-item").first().evaluate((n) => n === document.activeElement),
    "ordinary redraw preserves keyboard focus on the actual wallet action");
  await entryMatrix(page, qa, "wallets-collection");
}

export async function entryPreferences(page, qa) {
  await page.setViewportSize({ width: 320, height: 844 }); await palette(page, THEMES[0]);
  await page.evaluate(() => {
    window.__entrySizes = [...document.querySelectorAll("body *")]
      .map((n) => [n, n.style.fontSize, getComputedStyle(n).fontSize]);
    for (const [n, , size] of window.__entrySizes) n.style.fontSize = parseFloat(size) * 2 + "px";
  });
  await layout(page, qa, "entry actual 200% text");
  qa.check(await role(page, "Create wallet").isVisible(), "200% text retains Create");
  await qa.capture(page, "entry-320-double-text");
  await page.evaluate(() => {
    for (const [n, size] of window.__entrySizes) if (n.isConnected) n.style.fontSize = size;
    delete window.__entrySizes;
  });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await layout(page, qa, "entry forced colors"); await qa.capture(page, "entry-forced-colors");
  await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
}

export async function entrySetup(page, qa) {
  const next = qa.after ? "Continue to approval rule" : "Set up my wallet";
  const threshold = qa.after ? "Set the approval threshold" : "Choose your protection";
  await installAuthenticator(page);
  await role(page, "Create wallet").click();
  await page.getByRole("heading", { name: "Protect this browser", exact: true }).waitFor();
  if (qa.after) qa.check(await page.locator(".setup-plan-progress [aria-current=step]")
    .textContent().then((text) => /1.*Protect this browser/s.test(text)),
  "creation presents browser protection as step one");
  qa.check(await role(page, next).isDisabled(),
    "step two remains blocked before confirmed passkey protection");
  await entryMatrix(page, qa, "step-1-protect");
  await protectBeforeSetup(page, qa);
  await page.waitForTimeout(420); // Preserve the existing accidental double-tap guard.
  await role(page, next).click();
  await page.getByRole("heading", { name: threshold, exact: true }).waitFor();
  if (qa.after) qa.check(await page.locator(".setup-plan-progress [aria-current=step]")
    .innerText().then((text) => /2.*Set the approval threshold/s.test(text)),
  "creation presents the approval threshold as step two");
  await entryMatrix(page, qa, "step-2-threshold");
  await role(page, "Back").click();
  await page.getByRole("heading", { name: "Protect this browser", exact: true }).waitFor();
  qa.check(await page.getByText("This browser’s shares are protected by its passkey.",
    { exact: true }).first().isVisible(), "Back retains confirmed browser protection");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  qa.check(await role(page, "Create wallet").evaluate((n) => n === document.activeElement),
    "closing setup returns focus to its entry action");
}
