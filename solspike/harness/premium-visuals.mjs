// Read-only presentation checks. These helpers receive only fresh local QA pages.
import { compactOverview, compactPreferences } from "./compact-overview.mjs";
import { v3Overview, v3Text } from "./v3-visuals.mjs";
export const WIDTHS = [320, 360, 390, 768, 1024, 1440, 1920];
const v3Height = (width) => ({ 320: 800, 360: 800, 390: 844, 768: 1024,
  1024: 768, 1440: 900, 1920: 1080 })[width];
function sampleHeight(qa, id, width) {
  if (qa.v3) return v3Height(width);
  return qa.compact && id === "overview" && width >= 1440 ? 900 : 1000;
}
export const THEMES = [
  { name: "dark", choice: "dark", scheme: "dark" },
  { name: "light", choice: "light", scheme: "light" },
  { name: "system-dark", choice: "device", scheme: "dark" },
  { name: "system-light", choice: "device", scheme: "light" },
];
export const SAMPLE_ROUTES = ["overview", "approvals", "activity", "recipients", "swap",
  "chats", "recovery", "settings", "send", "receive"];
const role = (page, name) => page.getByRole("button", { name, exact: true });

export async function settled(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
}

export async function palette(page, theme) {
  await page.emulateMedia({ colorScheme: theme.scheme, reducedMotion: "reduce",
    forcedColors: "none" });
  await page.evaluate((choice) => {
    if (choice === "device") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = choice;
  }, theme.choice);
  await settled(page);
}

export async function layout(page, qa, label) {
  await settled(page);
  const result = await page.evaluate(() => {
    const shown = (n) => !!n.getClientRects().length && getComputedStyle(n).visibility !== "hidden";
    const parts = [...document.querySelectorAll(".dialog,.drawer,.recipient-editor,.sample-banner")]
      .filter(shown).map((n) => ({ width: n.clientWidth, scroll: n.scrollWidth }));
    const small = [...document.querySelectorAll("button.btn:not(:disabled),a.btn,"
      + "button.icon-btn:not(:disabled),.side-item:not(:disabled),summary,.input:not(:disabled)")]
      .filter(shown).map((n) => n.getBoundingClientRect())
      .filter((r) => r.width < 47 || r.height < 47).length;
    return { width: innerWidth, scroll: document.documentElement.scrollWidth, parts, small };
  });
  qa.check(result.scroll <= result.width + 1
    && result.parts.every((n) => n.scroll <= n.width + 1), label + " page and panel overflow");
  qa.check(result.small === 0, label + " 48px visible controls");
}

async function entryFacts(page) {
  return page.locator(".welcome").evaluate((n) => {
    const create = [...n.querySelectorAll("button")]
      .find((b) => b.textContent === "Create wallet").getBoundingClientRect();
    const plate = n.querySelector(".welcome-brand-plate");
    const notice = n.querySelector(".welcome-network-note");
    const actions = n.querySelector(".welcome-actions").getBoundingClientRect();
    const brand = () => {
      if (!plate) return { plate: false };
      const style = getComputedStyle(plate), rect = plate.getBoundingClientRect();
      return { plate: !!rect.width && !!rect.height, width: parseFloat(style.width),
        height: parseFloat(style.height), decorative: !!plate.closest("[aria-hidden=true]"),
        source: plate.querySelector("img")?.getAttribute("src") };
    };
    const follows = () => {
      if (!plate) return false;
      return plate.getBoundingClientRect().top >= Math.max(actions.bottom,
        notice?.getBoundingClientRect().bottom || actions.bottom) - 1;
    };
    return { entry: create.top >= 0 && create.bottom <= innerHeight, ...brand(), after: follows(),
      notice: notice ? notice.textContent : "", copy: n.textContent,
      appearances: [...n.querySelectorAll("select")].filter((s) =>
        s.closest("label")?.textContent.includes("Appearance")).length };
  });
}

function welcomeFacts(f, qa, width, theme) {
  if (qa.entry) return currentEntryFacts(f, qa, width, theme);
  const size = width < 1100 ? 128 : 220;
  qa.check(f.plate && f.decorative && f.width === size && f.height === size,
    "welcome decorative plate " + size + "px at " + width + " " + theme.name);
  qa.check(width > 760 || f.after, "mobile plate follows actions and notices " + width);
  qa.check(f.source === "/logo.png?v=e2a70c42", "welcome uses canonical zebra " + width);
  qa.check(/test networks only.*not audited/s.test(f.notice), "entry retains essential notice");
  qa.check(f.appearances === 0, "welcome appearance controls live only in Settings");
}

function currentEntryFacts(f, qa, width, theme) {
  qa.check(f.decorative && f.source === "/logo.png?v=e2a70c42",
    "entry retains decorative canonical zebra " + width + " " + theme.name);
  qa.check(/private by design/i.test(f.copy) && !/New wallets use test networks only/.test(f.copy),
    "entry uses private brand copy without generic test-network banner");
  qa.check(f.appearances === 0, "entry Appearance controls remain in Settings");
}

async function welcomeCase(page, qa, width, theme) {
  await palette(page, theme); await page.evaluate(() => scrollTo(0, 0));
  await layout(page, qa, "welcome " + width + " " + theme.name);
  const f = await entryFacts(page);
  if ([390, 1440].includes(width)) qa.check(f.entry,
    "welcome primary entry visible at " + width + " " + theme.name);
  if (qa.after) welcomeFacts(f, qa, width, theme);
  if ([390, 1440].includes(width) && ["dark", "light"].includes(theme.name))
    await qa.capture(page, "welcome-" + width + "-" + theme.name);
}

export async function welcomeMatrix(page, qa) {
  for (const width of WIDTHS) {
    const height = qa.v3 ? v3Height(width) : width === 390 ? 844 : width === 1440 ? 900 : 1000;
    await page.setViewportSize({ width, height });
    for (const theme of THEMES) await welcomeCase(page, qa, width, theme);
  }
}

export async function navigation(page, id) {
  const menu = role(page, "Menu");
  if (await menu.isVisible() && await menu.getAttribute("aria-expanded") !== "true")
    await menu.click();
  const target = page.locator("#tab-" + id);
  await target.waitFor({ state: "visible" }); await target.press("Enter");
  await page.locator("#tab-" + id + "[aria-current=page]").waitFor({ state: "attached" });
  await settled(page);
}

async function actualDoubleText(page, qa) {
  await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("body *")];
    const title = document.querySelector(".welcome h1,.welcome h2");
    window.__premiumProbe = { title, size: parseFloat(getComputedStyle(title).fontSize) };
    window.__premiumSizes = nodes.map((n) => [n, n.style.fontSize, getComputedStyle(n).fontSize]);
    for (const [n, , size] of window.__premiumSizes) n.style.fontSize = parseFloat(size) * 2 + "px";
  });
  await layout(page, qa, "welcome actual doubled text320");
  qa.check(await page.evaluate(() => window.__premiumProbe.title.isConnected
    && parseFloat(getComputedStyle(window.__premiumProbe.title).fontSize)
      >= window.__premiumProbe.size * 2 - 0.5), "welcome text remains actually doubled");
  await qa.capture(page, "welcome-320-double-text");
  await page.evaluate(() => {
    for (const [n, size] of window.__premiumSizes) if (n.isConnected) n.style.fontSize = size;
    delete window.__premiumSizes;
    delete window.__premiumProbe;
  });
}

export async function welcomePreferences(page, qa) {
  await page.setViewportSize({ width: 320, height: 1000 });
  await palette(page, THEMES[0]); await actualDoubleText(page, qa);
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await layout(page, qa, "welcome forced colors320");
  await qa.capture(page, "welcome-320-forced-colors");
  if (qa.webkit) {
    qa.notes.push("WebKit reduced-transparency emulation unavailable; no CDP support.");
    await page.emulateMedia({ forcedColors: "none" });
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setEmulatedMedia", { features: [
    { name: "prefers-reduced-transparency", value: "reduce" },
    { name: "prefers-reduced-motion", value: "reduce" },
    { name: "prefers-color-scheme", value: "dark" },
  ] });
  qa.check(await page.evaluate(() => matchMedia("(prefers-reduced-transparency:reduce)").matches),
    "welcome reduced transparency emulation active");
  await layout(page, qa, "welcome reduced transparency320");
  await qa.capture(page, "welcome-320-reduced-transparency");
  await cdp.detach();
}

async function joinAndTheme(page, qa) {
  await page.setViewportSize({ width: 390, height: 844 });
  await role(page, "Join a wallet").press("Enter");
  const input = page.locator("#join-link"); await input.waitFor();
  qa.check(await input.evaluate((n) => n === document.activeElement),
    "keyboard Join focuses input");
  await input.fill("Synthetic input preserved during palette changes");
  const before = await input.inputValue();
  for (const theme of THEMES) {
    await palette(page, theme);
    qa.check(await input.inputValue() === before, "live " + theme.name + " preserves typed Join");
    qa.check(await input.evaluate((n) => n === document.activeElement),
      "live " + theme.name + " preserves Join focus");
  }
  await role(page, "Join a wallet").press("Enter");
  await input.waitFor({ state: "detached" });
  qa.check(await input.count() === 0, "keyboard Join toggles the existing form closed");
}

async function entryKeyboard(page, qa) {
  const start = role(page, "Create wallet"); await start.press("Enter");
  const dialog = page.getByRole("dialog"); await dialog.waitFor();
  const next = qa.entry ? "Continue to approval rule" : "Set up my wallet";
  qa.check(await role(page, next).isDisabled(),
    "new wallet continuation stays disabled before confirmed passkey protection");
  await dialog.locator("button:not(:disabled)").last().focus(); await page.keyboard.press("Tab");
  const forward = await dialogFocus(page);
  qa.check(forward.contained, "setup dialog keeps forward keyboard focus "
    + JSON.stringify(forward));
  await page.keyboard.press("Shift+Tab");
  const reverse = await dialogFocus(page);
  qa.check(reverse.contained, "setup dialog keeps reverse keyboard focus "
    + JSON.stringify(reverse));
  await page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
  qa.check(await start.evaluate((n) => n === document.activeElement),
    "Escape returns focus to the existing creation entry");
  await role(page, "Menu").press("Enter"); await settled(page);
  await page.keyboard.press("Escape"); await settled(page);
  qa.check(await role(page, "Menu").getAttribute("aria-expanded") === "false",
    "Escape closes the mobile navigation menu");
}

async function dialogFocus(page) {
  return page.evaluate(() => {
    const layer = document.querySelector(".dialog"), active = document.activeElement;
    return { connected: !!layer?.isConnected, contained: !!layer?.contains(active),
      activeTag: active.tagName, activeId: active.id };
  });
}

export async function welcomeInteraction(page, qa) {
  await joinAndTheme(page, qa); await entryKeyboard(page, qa);
  await navigation(page, "settings");
  const choice = page.locator("label").filter({ hasText: "Appearance" }).locator("select").first();
  for (const value of ["dark", "light", "device"]) {
    await choice.selectOption(value);
    qa.check(await page.evaluate((v) => localStorage.getItem("zf-theme") === v, value),
      "Settings retains existing " + value + " preference handler");
  }
  await navigation(page, "overview");
}

export async function sampleMatrix(page, qa, id) {
  qa.check(await page.locator("script").count() === 0, id + " sample has no wallet runtime");
  qa.check(await page.locator("button:not(:disabled),input:not(:disabled),"
    + "select:not(:disabled),textarea:not(:disabled)").count() === 0,
  id + " sample wallet actions remain inert");
  for (const width of WIDTHS) {
    const height = sampleHeight(qa, id, width);
    await page.setViewportSize({ width, height });
    for (const theme of THEMES) {
      await sampleCase(page, qa, id, width, theme);
    }
  }
  if (qa.compact && id === "overview") await compactPreferences(page, qa,
    { layout, palette, settled, THEMES, WIDTHS });
  if (qa.v3) await v3Text(page, qa, id, { layout });
}

async function sampleCase(page, qa, id, width, theme) {
  await palette(page, theme);
  await layout(page, qa, "sample " + id + " " + width + " " + theme.name);
  if (qa.art && qa.after && id === "overview") await artOverview(page, qa, width, theme);
  if (qa.compact && qa.after && id === "overview") await compactCase(page, qa, width, theme);
  if (qa.v3) await v3Case(page, qa, id, width, theme);
  await sampleScreens(page, qa, id, width, theme);
}

async function v3Case(page, qa, id, width, theme) {
  if (qa.after && id === "overview") await v3Overview(page, qa, width, theme);
}

async function compactCase(page, qa, width, theme) {
  await compactOverview(page, qa, width, theme);
  if (width === 1440 && ["dark", "light"].includes(theme.name))
    await artContrast(page, qa, theme);
}

async function sampleScreens(page, qa, id, width, theme) {
  if (sampleCapture(qa, width, theme, id))
    await qa.capture(page, "sample-" + id + "-" + width + "-" + theme.name);
  if (qa.compact && id === "overview" && width === 1440
    && ["dark", "light"].includes(theme.name))
    await qa.captureViewport(page, "test-wallet-desktop-" + theme.name);
}

function sampleCapture(qa, width, theme, id) {
  if (qa.v3) return [390, 1440].includes(width) && ["dark", "light"].includes(theme.name);
  return legacySampleCapture(qa, width, theme, id);
}

function legacySampleCapture(qa, width, theme, id) {
  if (qa.compact && id === "overview") return ["dark", "light"].includes(theme.name);
  if (width === 390 && theme.name === "dark") return true;
  return (qa.art || qa.compact) && [390, 1440].includes(width)
    && ["dark", "light"].includes(theme.name);
}

async function artOverview(page, qa, width, theme) {
  await artComposition(page, qa, width, theme);
  if (width === 1440 && ["dark", "light"].includes(theme.name))
    await artContrast(page, qa, theme);
}

async function artComposition(page, qa, width, theme) {
  if (![390, 1440].includes(width)) return;
  const result = await page.evaluate(() => {
    const find = (name) => document.querySelector(name);
    const primary = find(".overview-primary"), rail = find(".overview-rail");
    const hero = find(".overview-hero"), assets = find(".assets-grid");
    const transactions = find(".overview-transactions");
    if (![primary, rail, hero, assets, transactions].every(Boolean)) return null;
    const p = primary.getBoundingClientRect(), r = rail.getBoundingClientRect();
    const channels = getComputedStyle(hero).backgroundColor.match(/[\d.]+/g) || [];
    const background = channels.map(Number);
    return { grouping: [primary.contains(hero), primary.contains(assets),
      rail.contains(transactions)].every(Boolean), side: p.right <= r.left + 1 && r.width > 200,
      stack: r.top >= p.bottom - 1, pale: background.slice(0, 3).every((n) => n > 180),
      opaque: (background[3] ?? 1) === 1 };
  }) || {};
  qa.check(!!result.grouping, "Overview separates portfolio and transaction groups " + width);
  qa.check(width === 1440 ? !!result.side : !!result.stack,
    "Overview uses " + (width === 1440 ? "two columns" : "stacked groups") + " " + width);
  if (theme.name === "dark") qa.check(!!result.pale && !!result.opaque,
    "Overview pale opaque balance surface contrasts with dark canvas " + width);
}

async function artContrast(page, qa, theme) {
  await page.keyboard.press("Tab");
  const facts = await page.evaluate(() => {
    const rgb = (value) => (value.match(/[\d.]+/g) || []).map(Number);
    const blend = (a, b) => a.slice(0, 3).map((n, i) => n * a[3] + b[i] * (1 - a[3]));
    function background(node) {
      if (!node) return [255, 255, 255];
      const c = rgb(getComputedStyle(node).backgroundColor);
      if ((c[3] ?? 1) === 1) return c;
      return blend(c, background(node.parentElement));
    }
    const channel = (n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
    const luminance = (c) => c.slice(0, 3).map((n) => channel(n / 255))
      .reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
    const colors = (foreground, backdrop) => {
      const a = luminance(foreground), b = luminance(backdrop);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    };
    const ratio = (node) => colors(rgb(getComputedStyle(node).color), background(node));
    const labels = [...document.querySelectorAll(".overview-hero button,.overview-hero summary,"
      + "#side-nav .side-item")].filter((n) => n.getClientRects().length)
      .map((n) => ({ label: (n.getAttribute("aria-label") || n.textContent).trim(),
        ratio: ratio(n), disabled: n.disabled === true }));
    const prior = document.activeElement;
    const focus = (parent, label) => {
      const probe = document.createElement("button"); probe.className = "btn";
      probe.textContent = "Synthetic focus probe"; parent.append(probe); probe.focus();
      const style = getComputedStyle(probe), contrast = colors(rgb(style.outlineColor),
        background(parent)), width = parseFloat(style.outlineWidth);
      probe.remove(); return { label, contrast, width };
    };
    const focusMarks = [focus(document.querySelector(".overview-hero"), "balance focus"),
      focus(document.querySelector(".side"), "sidebar focus")];
    if (prior.isConnected) prior.focus();
    const dot = document.querySelector(".side .dot.ok");
    const status = colors(rgb(getComputedStyle(dot).backgroundColor),
      background(dot.parentElement));
    return { labels: labels.filter((n) => n.ratio < 4.5), minimumText: Math.min(...labels
      .map((n) => n.ratio)), focusMarks, status };
  });
  qa.check(!facts.labels.length, "Scoped balance/nav label contrast " + theme.name
    + " " + JSON.stringify({ minimum: facts.minimumText, failures: facts.labels }));
  qa.check(facts.focusMarks.every((n) => n.contrast >= 3 && n.width >= 2)
    && facts.status >= 3, "Scoped focus/status contrast " + theme.name + " "
    + JSON.stringify({ focus: facts.focusMarks, status: facts.status }));
}
