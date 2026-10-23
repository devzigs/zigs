// Real local page in isolated, unfunded stores. Metadata is synthetic and memory-only.
// Full homepage regression and current logo/motion checks; earlier evidence is preserved.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { entryReady } from "../harness/entry-flow.mjs";
import { settled } from "../harness/premium-visuals.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.ZIGS_HOME_ORIGIN || "http://127.0.0.1:55847";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const output = resolve("docs/ux-redesign/visuals/cinematic-homepage/after");
mkdirSync(output, { recursive: true });
const checks = [], facts = [], errors = [], screenshots = [], notes = [];
const check = (pass, label) => checks.push({ pass: !!pass, label });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });
const context = await fresh();
const page = await context.newPage();
const button = (name, target = page) => target.getByRole("button", { name, exact: true });
page.on("pageerror", (error) => errors.push(error.name + ": " + error.message));

async function fresh(options = {}) {
  const isolated = await browser.newContext({ viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce", colorScheme: "dark", ...options });
  await isolated.addInitScript(() => {
    window.__homeLcp = null;
    try {
      new PerformanceObserver((list) => {
        const item = list.getEntries().at(-1);
        if (!item) return;
        const element = item.element || {};
        window.__homeLcp = { startTime: item.startTime, size: item.size,
          tag: element.tagName || null, id: element.id || null,
          className: element.className || null, url: item.url || null };
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch { /* Unsupported browser metrics do not affect UI behavior. */ }
  });
  await isolated.route("**/*", (route) => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort());
  return isolated;
}

async function run(label, work) {
  try { await work(); }
  catch (error) { errors.push(label + ": " + error.message.split("\n").slice(0, 5).join(" ")); }
}

// Screenshot evidence must not include local paths or metadata.
function stripMetadata(file) {
  const data = readFileSync(file), chunks = [data.subarray(0, 8)];
  for (let at = 8; at + 12 <= data.length;) {
    const end = at + data.readUInt32BE(at) + 12;
    if (["IHDR", "IDAT", "IEND", "PLTE", "tRNS"].includes(data.toString("ascii", at + 4, at + 8)))
      chunks.push(data.subarray(at, end));
    at = end;
  }
  writeFileSync(file, Buffer.concat(chunks));
}

async function artworkReady(target) {
  await target.evaluate(async () => {
    await Promise.all([...document.querySelectorAll(".welcome-brand img")]
      .map((node) => node.decode().catch(() => {})));
  });
}

async function capture(name, target = page) {
  if (!name.includes("focus")) await target.evaluate(() => document.activeElement?.blur());
  await target.evaluate(() => scrollTo(0, 0)); await settled(target); await artworkReady(target);
  const file = resolve(output, name + ".png");
  await target.screenshot({ path: file, fullPage: true, animations: "disabled" });
  stripMetadata(file); screenshots.push(name + ".png");
}

async function paint(count, options = {}, target = page) {
  await target.evaluate(async ({ count, options }) => {
    const { state, ui, ready } = await import("/app-state.js");
    const { balCache } = await import("/app-chain.js");
    (await import("/app-keystore.js")).setSecrets({});
    state.gid = null; state.g = null; state.cid = null; state.contact = null;
    ui.tab = "overview"; ui.joinOpen = false; ui.joinBad = ""; ui.menu = false;
    for (const key of Object.keys(ready)) delete ready[key];
    for (const key of Object.keys(balCache)) delete balCache[key];
    const nameFor = (i) => options.long && i === 0
      ? "Shared expenses with a very long name — " + "LongLabel".repeat(8)
      : ["Everyday wallet", "Shared expenses", "Savings"][i] || "Shared wallet " + (i + 1);
    const flagsFor = (i) => {
      if (i !== 0) return {};
      return { ...(options.unreadable ? { unreadable: true } : {}),
        ...(options.moved ? { movedTo: "f1".repeat(10) } : {}) };
    };
    state.groups = Array.from({ length: count }, (_, i) => ({
      id: ("e" + (i + 1)).repeat(10), name: nameFor(i),
      network: i === 2 ? "mainnet" : "testnet", t: i === 2 ? 3 : 2, n: i === 2 ? 5 : 3,
      ...flagsFor(i),
    }));
    if (options.unfinished) ready[state.groups[0].id] = false;
    if (options.balance !== undefined) balCache[state.groups[0].id] = {
      total: options.balance, at: Date.now(),
    };
    (await import("/app-loop.js")).render();
  }, { count, options });
  await settled(target); await artworkReady(target);
}

async function layout(scene, width, theme) {
  await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce", forcedColors: "none" });
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value; scrollTo(0, 0);
  }, theme);
  await settled(page); await artworkReady(page);
  const result = await page.evaluate(() => {
    const card = document.querySelector(".wallet-vault-card");
    const create = document.querySelector(".welcome-actions button");
    const box = (node) => node ? node.getBoundingClientRect() : { top: null, bottom: null };
    const c = box(card), a = box(create);
    const shown = (node) => node.getClientRects().length && getComputedStyle(
      node).visibility !== "hidden";
    const controls = [...document.querySelectorAll(".welcome button,.welcome summary")].filter(
      shown);
    return { overflow: document.documentElement.scrollWidth > innerWidth + 1,
      h1: document.querySelectorAll("#app h1").length,
      firstVisible: card ? c.top >= 0 && c.bottom <= innerHeight : !!create && a.bottom <=
        innerHeight,
      cardFirst: !card || c.bottom <= a.top && !!(card.compareDocumentPosition(create)
        & Node.DOCUMENT_POSITION_FOLLOWING),
      cardTop: c.top, cardBottom: c.bottom, createBottom: a.bottom,
      thresholdClear: (() => {
        const threshold = document.querySelector(".home-threshold"),
          kicker = document.querySelector(".welcome-kicker");
        if (!threshold?.checkVisibility() || !kicker) return true;
        const t = threshold.getBoundingClientRect(), k = kicker.getBoundingClientRect();
        return t.right <= k.left || t.left >= k.right || t.bottom <= k.top || t.top >= k.bottom;
      })(),
      targets: controls.every((node) => node.getBoundingClientRect().height >= 44),
      targetFailures: controls.filter((node) => node.getBoundingClientRect().height < 44)
        .map((node) => node.textContent.trim()),
      imageIntrinsic: [...document.querySelectorAll(".welcome-brand img")].map((node) =>
        [node.naturalWidth, node.naturalHeight]),
      visibleLogo: [...document.querySelectorAll(".welcome-brand img")]
        .some((node) => shown(node) && node.naturalWidth > 0),
      overlapping: controls.some((node) => {
        const box = node.getBoundingClientRect();
        return box.right > innerWidth + 1 || box.left < -1;
      }),
    };
  });
  facts.push({ scene, width, theme, ...result });
  await revisionLayout(scene,width,theme);
  await tabletEntryGap(scene,width,theme);
  for (const [key, pass] of Object.entries({ fits: !result.overflow,
    h1: result.h1 === 1, firstVisible: result.firstVisible, cardFirst: result.cardFirst,
    targets: result.targets, illustrationClearOfCopy: result.thresholdClear,
      controlBounds: !result.overlapping, canonicalArtworkVisible: result.visibleLogo }))
    check(pass, `${scene} ${width} ${theme} ${key}`);
  if ([320, 390, 768, 1440].includes(width)) await capture(scene + "-" + width + "-" + theme);
}

async function designSemantics(scene) {
  const result = await page.evaluate(() => {
    const threshold = document.querySelector(".home-threshold");
    const artwork = [...document.querySelectorAll(".welcome-brand img")];
    const text = (selector) => document.querySelector(selector)?.textContent || "";
    return { title: text("#welcome-title").replace(/\s+/g, " ").trim(),
      canonical: artwork.length > 0 && artwork.every((node) =>
        node.getAttribute("src")?.split("?")[0] === "/logo.png" && !!node.closest(
          '[aria-hidden="true"]')),
      explanation: text(".home-threshold").replace(/\s+/g, " ").trim(),
      thresholdStatic: !!threshold && !threshold.querySelector(
        '[role="status"],[role="progressbar"],[aria-live],[data-motion-watch],button,input'),
      prototype: new RegExp("visual design reference|sample data|six changes\\. one identity|"
        + "returning user.*new user", "is")
        .test(text(".welcome")),
      essentialNotices: /Beta.*Not audited/i.test(text(".welcome")),
      actualCount: document.querySelectorAll(".wallet-vault-card").length,
    };
  });
  facts.push({ scene, semantics: result });
  check(result.title === (scene === "new" ? "Private by design. Secured together." :
    "Welcome back."),
    scene + " state-specific brand headline");
  check(result.canonical, scene + " original canonical zebra remains decorative and unchanged");
  check(/Illustration.*Any 2 of 3 approvals/i.test(result.explanation),
    scene + " threshold explains an explicit example");
  check(result.thresholdStatic, scene + " illustration has no live transaction status or controls");
  check(!result.prototype, scene + " prototype/sample controls excluded");
  check(result.essentialNotices, scene + " beta and unaudited notices visible in page copy");
}

async function interactions(createLabel) {
  await page.setViewportSize({ width: 390, height: 844 });
  await button("Join a wallet").press("Enter");
  await page.locator("#join-link").waitFor();
  check(await page.locator("#join-link").evaluate((n) => n === document.activeElement),
    createLabel + " Join focuses existing private field");
  await page.locator("#join-link").fill("Synthetic private invitation");
  await page.evaluate(async () => (await import("/app-loop.js")).render());
  await settled(page);
  check(await page.locator("#join-link").inputValue() === "Synthetic private invitation",
    createLabel + " redraw retains typed private invitation");
  check(await page.locator("#join-link").evaluate((n) => n === document.activeElement),
    createLabel + " redraw retains private field focus");
  check(!new URL(page.url()).search && !new URL(page.url()).hash,
    createLabel + " typing never leaks private invitation into URL");
  await page.locator("#join-link").fill("invalid invitation");
  await page.locator(".join form").getByRole("button", { name: "Open wallet" }).click();
  await page.locator("#join-error").waitFor();
  check(await page.locator("#join-error").isVisible(), createLabel +
    " invalid-invite error retained");
  await button("Join a wallet").click();
  await button(createLabel).press("Enter");
  await page.locator(".guided-plan").waitFor(); await settled(page);
  check(await page.locator(".guided-plan").isVisible(), createLabel + " opens existing setup");
  const dialog = page.getByRole("dialog");
  await dialog.evaluate((node) => [...node.querySelectorAll(
    "button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],summary")]
    .filter((control) => control.checkVisibility()).at(-1)?.focus());
  await page.keyboard.press("Tab");
  check(await dialog.evaluate((n) => n.contains(document.activeElement)),
    createLabel + " setup traps forward keyboard focus");
  await page.keyboard.press("Shift+Tab");
  check(await dialog.evaluate((n) => n.contains(document.activeElement)),
    createLabel + " setup traps reverse keyboard focus");
  await page.keyboard.press("Escape");
  await page.locator(".guided-plan").waitFor({ state: "hidden" });
  check(await button(createLabel).evaluate((n) => n === document.activeElement),
    createLabel + " Escape returns focus to originating action");
  const chooser = page.waitForEvent("filechooser");
  await button("Recover access").press("Enter");
  await (await chooser).setFiles([]);
  check(await page.locator("#restore").count() === 1, "one existing local restore input");
  await page.locator(".home-learn").press("Enter");
  const disclosure = page.locator(".welcome-details");
  check(await disclosure.evaluate((node) => node.open
    && node.querySelector("summary") === document.activeElement),
  createLabel + " How Zigs works opens and focuses its explanation");
  check(await disclosure.evaluate((node) => /fee address.*public/s.test(node.textContent)),
    createLabel + " explanation retains Solana public fee-address disclosure");
  await page.evaluate(async () => (await import("/app-loop.js")).render());
  await settled(page);
  check(await disclosure.evaluate((node) => node.open),
    createLabel + " redraw retains opened explanation");
  await disclosure.locator("summary").press("Enter");
}

async function keyboardOrder(count) {
  await paint(count);
  await page.setViewportSize({ width: 390, height: 844 });
  const order = await page.locator(".welcome").evaluate((root) => {
    const selectors = 'button:not(:disabled),a[href],summary,input:not([type="hidden"])';
    return [...root.querySelectorAll(selectors)].filter((node) => node.getClientRects().length)
      .map((node) => ({ key: node.getAttribute("data-key"), text: node.textContent.trim() }));
  });
  facts.push({ keyboardOrder: count, order });
  check(count ? order.slice(0, count).every((node) => node.key?.startsWith("wallet-row-"))
    : order[0].text.includes("Create wallet"), count +
      " wallets DOM focus begins at primary entry");
  const first = count ? page.locator(".wallet-vault-card").first() : button("Create wallet");
  await first.focus();
  await page.evaluate(async () => (await import("/app-loop.js")).render());
  await settled(page);
  check(await first.evaluate((n) => n === document.activeElement), count +
    " wallets redraw preserves focus");
  if (count) {
    for (let i = 1; i < count; i++) await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    check(await button("Create another").evaluate((n) => n === document.activeElement),
      count + " wallets keyboard reaches secondary Create after the real cards");
  } else {
    await page.keyboard.press("Tab");
    check(await button("Join a wallet").evaluate((n) => n === document.activeElement),
      "zero wallets keyboard reaches Join after Create");
  }
}

async function enlargedText(count) {
  const label = count ? "returning long names" : "new homepage";
  await paint(count, count ? { long: true, unfinished: true } : {});
  await page.evaluate(() => {
    const title = document.querySelector("#welcome-title");
    window.homeProbe = [title, parseFloat(getComputedStyle(title).fontSize)];
    window.homeSizes = [...document.querySelectorAll("body *")]
      .map((n) => [n, n.style.fontSize, getComputedStyle(n).fontSize]);
    for (const [n, , size] of window.homeSizes) n.style.fontSize = parseFloat(size) * 2 + "px";
  });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    label + " at 320px and actual 200% text fits");
  check(await page.evaluate(() => parseFloat(getComputedStyle(window.homeProbe[0]).fontSize)
    >= window.homeProbe[1] * 2 - 0.5), label + " text enlargement remains actually 200%");
  check(await page.locator("#welcome-title").evaluate((title) => {
    const hero = title.closest(".home-hero").getBoundingClientRect();
    const text = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = text.nextNode())) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      if ([...range.getClientRects()].some((rect) => rect.left < hero.left - 1 || rect.right >
        hero.right + 1))
        return false;
    }
    return true;
  }), label + " enlarged headline is not clipped by hero overflow");
  check(await button(count ? "Create another" : "Create wallet").isVisible()
    && await button("Recover access").isVisible(), label + " 200% text retains entry and recovery");
  check(await page.evaluate(() => {
    const threshold = document.querySelector(".home-threshold"),
      kicker = document.querySelector(".welcome-kicker");
    if (!threshold?.checkVisibility()) return true;
    const t = threshold.getBoundingClientRect(), k = kicker.getBoundingClientRect();
    return t.right <= k.left || t.left >= k.right || t.bottom <= k.top || t.top >= k.bottom;
  }), label + " 200% threshold never overlaps eyebrow copy");
  await capture(count ? "long-names-200-percent-320" : "new-200-percent-320");
  await page.evaluate(() => {
    for (const [n, size] of window.homeSizes) if (n.isConnected) n.style.fontSize = size;
    delete window.homeProbe; delete window.homeSizes;
  });
}

async function preferences() {
  await page.setViewportSize({ width: 320, height: 844 });
  await enlargedText(0); await enlargedText(3);
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.locator(".wallet-vault-card").first().focus();
  check(await page.locator(".wallet-vault-card").first().evaluate((n) => {
    const style = getComputedStyle(n);
    return style.outlineStyle === "solid" && parseFloat(style.outlineWidth) >= 2;
  }), "forced-colors wallet focus visible");
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "forced-colors layout fits 320px");
  check(await page.locator(".home-hero-art").evaluate((node) => {
    const style = getComputedStyle(node);
    return !node.checkVisibility() || Number(style.opacity) === 0;
  }), "forced-colors decoration cannot obscure system text");
  await capture("forced-colors-focus-320");
  await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
  await paint(0); await settled(page);
  const activeMotion = () => page.locator(".welcome").evaluate((node) =>
    node.getAnimations({ subtree: true }).filter((animation) =>
      animation.playState === "running" && animation.effect.getTiming().duration > 1).length);
  check(await activeMotion() === 0, "reduced motion leaves no running homepage animations");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await paint(0); await settled(page);
  check(await page.evaluate(() => matchMedia("(prefers-reduced-motion:no-preference)").matches),
    "normal motion preference is actually active");
  check(await button("Create wallet").isVisible(),
    "normal motion retains immediately usable Create");
  await capture("new-motion-enabled-320");
  await page.emulateMedia({ reducedMotion: "reduce" });
}

async function contrast(theme, count) {
  await paint(count); await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate((value) => document.documentElement.dataset.theme = value, theme);
  await page.keyboard.press("Tab");
  await (count ? page.locator(".wallet-vault-card").first() : button("Create wallet")).focus();
  const result = await page.evaluate(() => {
    const rgb = (value) => (value.match(/[\d.]+/g) || []).map(Number);
    function background(node) {
      if (!node) return [255, 255, 255];
      const rgba = rgb(getComputedStyle(node).backgroundColor), alpha = rgba[3] ?? 1;
      if (alpha === 1) return rgba;
      const back = background(node.parentElement);
      return rgba.slice(0, 3).map((v, i) => v * alpha + back[i] * (1 - alpha));
    }
    const luminance = (channels) => channels.slice(0, 3).map((v) => v / 255)
      .map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
      .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05)
      / (Math.min(luminance(a), luminance(b)) + .05);
    const shown = (node) => node.getClientRects().length && getComputedStyle(
      node).visibility !== "hidden";
    const measure = (node, type) => {
      const style = getComputedStyle(node), base = background(node);
      const stops = [...style.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map((match) => rgb(
        match[0]));
      const backdrops = stops.length ? stops.map((stop) => {
        const alpha = stop[3] ?? 1;
        return stop.slice(0, 3).map((value, i) => value * alpha + base[i] * (1 - alpha));
      }) : [base];
      return { type, label: (node.getAttribute("aria-label") || node.textContent).trim().slice(
        0, 80),
        contrast: Math.min(...backdrops.map((back) => ratio(rgb(style.color), back))),
      };
    };
    const text = [...document.querySelectorAll(
      ".welcome button,.welcome summary,#side-nav .side-item")]
      .filter(shown).map((node) => measure(node, "control text"));
    const icons = [...document.querySelectorAll(
      ".welcome button svg,.welcome summary svg,#side-nav .side-item svg")]
      .filter(shown).map((node) => measure(node, "icon"));
    const samples = [...document.querySelectorAll(
      ".welcome p,.welcome figcaption,.welcome h1,.welcome h2,.welcome h3,"
      + (
        ".welcome-title-accent,.welcome .ri-title,.welcome "
        + ".vault-network,.welcome .vault-rule,.welcome "
        + ".ri-end>.small"
      ))]
      .filter((node) => shown(node) && node.checkVisibility() && !node.closest(
        '[aria-hidden="true"]'))
      .map((node) => {
        const style = getComputedStyle(node), size = parseFloat(style.fontSize);
        return { ...measure(node, "homepage text"),
          minimum: size >= 24 || size >= 18.66 && Number(style.fontWeight) >= 700 ? 3 : 4.5 };
      });
    const focused = document.querySelector(".wallet-vault-card,.welcome-actions button"),
      style = getComputedStyle(focused);
    return { text, icons, samples, focus: { width: parseFloat(style.outlineWidth),
      contrast: ratio(rgb(style.outlineColor), background(focused.parentElement)) } };
  });
  facts.push({ theme, count, contrast: result });
  check(result.text.every((item) => item.contrast >= 4.5), theme + " " + count +
    " wallets control/nav text contrast at least 4.5:1");
  check(result.icons.every((item) => item.contrast >= 3), theme + " " + count +
    " wallets control/nav icon contrast at least 3:1");
  check(result.samples.every((item) => item.contrast >= item.minimum),
    theme + " " + count + " wallets readable homepage text contrast");
  check(result.focus.width >= 2 && result.focus.contrast >= 3,
    theme + " " + count + " wallets entry focus indicator at least 2px and 3:1");
  if (count) for (const action of await page.locator(".welcome-actions>.btn").all()) {
    await action.hover(); await settled(page);
    const hover = await action.evaluate((node) => {
      const style = getComputedStyle(node);
      const rgb = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number);
      const lum = (color) => rgb(color).map((v) => v / 255)
        .map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
        .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      const a = lum(style.color), b = lum(style.backgroundColor);
      return { label: node.textContent.trim(), contrast: (Math.max(a, b) + .05) / (Math.min(a,
        b) + .05) };
    });
    facts.push({ theme, hover });
    check(hover.contrast >= 4.5, theme + " returning " + hover.label +
      " hover text contrast at least 4.5:1");
  }
}

async function navigation() {
  await paint(1); await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.locator("#wallet-menu");
  await menu.press("Enter"); await settled(page);
  check(await menu.getAttribute("aria-expanded") === "true", "mobile Menu opens with keyboard");
  check(await page.locator(".main").evaluate((node) => node.inert),
    "open mobile Menu makes homepage inert");
  const last = page.locator("#side-nav button:not(:disabled),#side-nav a[href]").last();
  await last.focus(); await page.keyboard.press("Tab");
  check(await menu.evaluate((node) => node === document.activeElement),
    "mobile Menu forward focus wraps");
  await page.keyboard.press("Shift+Tab");
  check(await last.evaluate((node) => node === document.activeElement),
    "mobile Menu reverse focus wraps");
  await page.keyboard.press("Escape"); await settled(page);
  check(await menu.getAttribute("aria-expanded") === "false"
    && !await page.locator(".main").evaluate((node) => node.inert),
      "Escape restores homepage access");
  for (const id of ["approvals", "activity", "recipients", "swap", "chats", "recovery",
    "settings", "overview"]) {
    await menu.click(); await settled(page);
    await page.locator("#tab-" + id).press("Enter"); await settled(page);
    check(await page.locator("#tab-" + id).getAttribute("aria-current") === "page", id +
      " existing sidebar destination remains selected");
    check(await menu.getAttribute("aria-expanded") === "false", id +
      " selection closes mobile Menu");
    check(await page.locator("#app h1").count() === 1, id +
      " destination retains one page heading");
  }
  await menu.click(); await settled(page);
  await page.setViewportSize({ width: 1024, height: 900 }); await settled(page);
  check(await menu.getAttribute("aria-expanded") === "false"
    && !await page.locator(".main").evaluate((node) => node.inert),
      "desktop resize closes Menu and restores page");
}

async function walletTruth() {
  await page.setViewportSize({ width: 1024, height: 900 });
  await paint(3);
  const cards = await page.locator(".wallet-vault-card").allTextContents();
  check(cards[0].includes("Zcash Testnet") && cards[2].includes("Zcash Mainnet"),
    "per-wallet networks preserved, including historical mainnet");
  check(cards[0].includes("Any 2 of 3 devices") && cards[2].includes("Any 3 of 5 devices"),
    "per-wallet approval rules preserved");
  check(cards.every((text) => text.includes("Open to sync") && !text.includes("0.00")),
    "unknown balances stay unknown");
  await paint(1, { balance: 0 });
  check((await page.locator(".wallet-vault-card").textContent()).includes("0.00"),
    "confirmed zero balance remains distinct from unknown");
  await paint(1, { balance: 125000000 });
  check((await page.locator(".wallet-vault-card").textContent()).includes("1.25"),
    "actual cached balance retains its real amount");
  await paint(1, { unfinished: true });
  check((await page.locator(".wallet-vault-card").textContent()).includes("Setup unfinished"),
    "unfinished formation remains explicit");
  await capture("setup-unfinished-1024");
  await paint(3, { unreadable: true });
  check(await page.locator("#welcome-wallets .bad-card").count() === 1
    && await page.locator(".wallet-vault-card").count() === 2,
  "unreadable metadata retains its error and leaves other real wallets available");
  check(await button("Create another").count() === 1 && await button("Create wallet").count() === 0,
    "unreadable existing wallet is never mistaken for a zero-wallet browser");
  await capture("unreadable-wallet-1024");
}

async function knownArtwork() {
  await paint(1);
  await page.evaluate(async () => {
    const { state, ready } = await import("/app-state.js");
    const { FLOW_FIXTURES } = await import("/dev/metal-orbs/flow-fixtures.js");
    const wallet = { birthday: 1, network: "testnet", address: FLOW_FIXTURES.everyday.zcash.address,
      orchard_fvk: "synthetic-non-signing-display-fixture" };
    ready[state.groups[0].id] = wallet;
    (await import("/app-keystore.js")).setSecrets({ [state.groups[0].id + ":1"]: {
      keyPackage: "synthetic-non-signing-display-fixture", checkedWallet: JSON.stringify(wallet),
    } });
    (await import("/app-loop.js")).render();
  });
  await page.waitForFunction(() => {
    const image = document.querySelector(".wallet-vault-card .wallet-art");
    return image?.dataset.artDigest && !["loading", "unavailable"].includes(image.dataset.artState);
  });
  const result = await page.locator(".wallet-vault-card .wallet-art").evaluate((node) => ({
    width: node.width, height: node.height, mode: node.dataset.artState,
    digest: node.dataset.artDigest, local: /^(data:|blob:)/.test(node.src),
  }));
  facts.push({ syntheticVerifiedPublicArtwork: result });
  check(result.width === 64 && result.height === 64 && result.local && !!result.digest,
    "verified synthetic public-address fixture uses existing local 64px identity bridge");
  await page.setViewportSize({ width: 1440, height: 900 }); await capture(
    "synthetic-public-art-1440");
  await page.setViewportSize({ width: 390, height: 844 }); await capture(
    "synthetic-public-art-390");
}

async function performanceEvidence() {
  for (const width of [390, 1440]) {
    const measured = await fresh({ viewport: { width, height: width === 390 ? 844 : 900 },
      reducedMotion: "no-preference" });
    try {
      const target = await measured.newPage(); await entryReady(target,
        origin); await artworkReady(target);
      await target.waitForTimeout(150);
      const result = await target.evaluate(() => {
        const resources = performance.getEntriesByType("resource");
        const images = resources.filter((item) => item.initiatorType === "img")
          .filter((item) => new URL(item.name).origin === location.origin)
          .map((item) => new URL(item.name).pathname);
        return { lcp: window.__homeLcp, resources: resources.length, images,
          transferBytes: resources.reduce((sum, item) => sum + (item.transferSize || 0), 0) };
      });
      facts.push({ localPerformance: width, ...result });
      check(result.images.length > 0 && result.images.every((path) => path === "/logo.png"),
        width + " new homepage uses only the existing canonical logo for HTTP image resources");
      check(!!result.lcp, width + " local buffered LCP observed");
    } finally { await measured.close(); }
  }
}

async function openWallet() {
  await paint(3);
  await page.evaluate(async () => {
    const subscription = { onSnapshot: () => () => {} };
    (await import("/app-groups.js")).setDb({ doc: () => subscription,
      collection: () => subscription });
  });
  await page.locator(".wallet-vault-card").last().press("Enter");
  check(await page.evaluate(async () => (await import("/app-state.js")).state.gid
    === "e3".repeat(10)), "Open selects corresponding wallet through existing handler");
}

async function matrix(scene, count) {
  await paint(count);
  for (const width of [320, 375, 390, 768, 1024, 1440])
    for (const theme of ["dark", "light"]) await layout(scene, width, theme);
  check(await page.locator(".wallet-vault-card").count() === count, scene +
    " accurate real card count");
  await designSemantics(scene);
  if (count < 2) await interactions(count ? "Create another" : "Create wallet");
}

async function loadingBoundary() {
  const loading = await fresh({ viewport: { width: 390, height: 844 } });
  let release;
  const gate = new Promise((done) => { release = done; });
  await loading.route("**/*zigs_engine_bg.wasm*", async (route) => {
     await gate; return route.continue(); });
  try {
    const target = await loading.newPage();
    await target.goto(origin, { waitUntil: "domcontentloaded" });
    await target.locator(".launch-card").waitFor();
    check(await target.locator(".welcome").count() === 0,
      "unresolved loading never flashes zero-wallet homepage");
    await capture("loading-390", target); release();
    await target.waitForFunction(async () => (await import("/app-groups.js")).dbReady);
  } finally { release(); await loading.close(); }
}

async function vaultBoundary(damaged) {
  const locked = await fresh({ viewport: { width: 390, height: 844 } });
  try {
    const target = await locked.newPage(); await entryReady(target, origin);
    await target.evaluate(async (damaged) => {
      (await import("/app-keystore.js")).setLocked(damaged ? { damaged: true } : { cred: "YQ",
        salt: "YQ" });
      (await import("/app-loop.js")).render();
    }, damaged);
    await target.locator(".lock-card").waitFor();
    check(await target.locator(".welcome").count() === 0
      && await button("Create wallet", target).count() === 0, (damaged ? "damaged" :
        "locked") + " vault never exposes zero-wallet setup");
    check(damaged ? await button("Unlock", target).count() === 0
      : await button("Unlock", target).isVisible(), (damaged ? "damaged" : "locked") +
        " vault retains correct Unlock state");
    await capture((damaged ? "damaged-vault" : "locked-vault") + "-390", target);
  } finally { await locked.close(); }
}

async function restrictedBoundary() {
  const restricted = await fresh({ viewport: { width: 390, height: 844 } });
  await restricted.route("**/shim.js", async (route) => {
    const response = await route.fetch(), source = await response.text();
    assert.ok(source.includes("can: async () => true"));
    await route.fulfill({ response, body: source.replace("can: async () => true",
      "can: async () => false") });
  });
  try {
    const target = await restricted.newPage(); await entryReady(target, origin);
    check(await button("Create wallet", target).isDisabled(),
      "read-only service keeps creation disabled");
    check((await target.locator("#banner-text").textContent()).includes("read-only"),
      "read-only service preserves existing reason");
    await button("Join a wallet", target).click();
    check(await target.locator(".join form").getByRole("button", {
      name: "Open wallet" }).isDisabled(),
      "read-only service keeps invitation submission disabled");
    check(await button("Recover access", target).isEnabled(),
      "read-only service retains existing recovery entry");
    await capture("restricted-service-390", target);
  } finally { await restricted.close(); }
}

async function memoryBoundary() {
  const memory = await fresh({ viewport: { width: 390, height: 844 } });
  await memory.addInitScript(() => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key === "zf-secrets") throw new DOMException("Synthetic unreadable store",
        "SecurityError");
      return original.call(this, key);
    };
  });
  try {
    const target = await memory.newPage(); await entryReady(target, origin);
    check((await target.locator("#banner-text").textContent()).includes(
      "does not let the page save"),
      "unreadable storage retains existing persistence warning");
    await button("Create wallet", target).click(); await target.locator(".guided-plan").waitFor();
    check(await button("Protect this browser", target).isDisabled()
      && await button("Skip for now", target).count() === 0,
    "memory-only setup never bypasses existing protection eligibility");
    await capture("unreadable-storage-390", target);
  } finally { await memory.close(); }
}

async function brokenArtworkBoundary() {
  const brokenArt = await fresh({ viewport: { width: 390, height: 844 } });
  await brokenArt.route("**/logo.png*", (route) => route.abort());
  try {
    const target = await brokenArt.newPage(); await entryReady(target, origin);
    const art = target.locator(".welcome-brand img");
    check(await art.count() > 0 && await art.first().evaluate((node) => node.complete &&
      !node.naturalWidth),
      "canonical artwork request is actually failed");
    check(await button("Create wallet", target).isVisible()
      && await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "artwork failure retains usable homepage and responsive layout");
    await capture("new-image-failure-390", target);
    await paint(1, {}, target);
    check(await target.locator(".wallet-vault-card").isVisible(),
      "artwork failure retains real wallet access");
    await capture("returning-image-failure-390", target);
  } finally { await brokenArt.close(); }
}

async function sampleBoundary() {
  // Fully intercepted virtual preview origin; never touches another running checkout.
  const sample = await browser.newContext();
  await sample.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://localhost:8792") return route.abort();
    const response = await route.fetch({ url: origin + url.pathname + url.search });
    return route.fulfill({ response });
  });
  try {
    const target = await sample.newPage(); await entryReady(target, "http://localhost:8792");
    const link = target.locator('[data-key="test-wallet-welcome"]');
    check(await link.getAttribute("href") === "http://localhost:8793/"
      && await link.getAttribute("target") === "_blank"
      && await link.getAttribute("rel") === "noopener", "local Test wallet destination retained");
  } finally { await sample.close(); }
}

async function boundaries() {
  await loadingBoundary();
  for (const damaged of [false, true]) await vaultBoundary(damaged);
  await restrictedBoundary(); await memoryBoundary();
  await brokenArtworkBoundary(); await sampleBoundary();
}

async function revisionLayout(scene, width, theme) {
  const result = await page.evaluate(() => {
    const hero = document.querySelector('.home-hero').getBoundingClientRect();
    const art = document.querySelector('.home-hero-art');
    const image = art.getBoundingClientRect();
    const logo = document.querySelector('.side .logo'), style = getComputedStyle(logo);
    const brand = document.querySelector('.side .logo img'), mark = brand.getBoundingClientRect();
    const figure = document.querySelector('.home-threshold');
    const artStyle = getComputedStyle(art);
    return {
      artwork: { left:image.left,top:image.top,right:image.right,bottom:image.bottom,
        width:image.width,height:image.height,
        hero:{left:hero.left,top:hero.top,right:hero.right,bottom:hero.bottom},
        objectFit:artStyle.objectFit,opacity:artStyle.opacity,filter:artStyle.filter,
          clipPath:artStyle.clipPath,
        identityClear:[[.39,.39],[.29,.10],[.45,.04],[.12,.66]].every(([x,y])=>{
          const px=image.left+image.width*x,py=image.top+image.height*y;
          return px>=hero.left && px<=hero.right && py>=hero.top && py<=hero.bottom;
        }) },
      header:{fontSize:parseFloat(style.fontSize),gap:parseFloat(style.columnGap),
        imageWidth:mark.width,imageHeight:mark.height,wordmark:logo.textContent.trim()},
      diagramInside: !!figure?.closest('.home-hero') && figure.checkVisibility()
        && !figure.closest('[aria-hidden="true"]'),
      heroDiagram: document.querySelectorAll('.home-hero>.home-threshold').length,
      diagramCount: document.querySelectorAll('.home-threshold').length,
      diagramClosed: !document.querySelector('.welcome-details').open,
    };
  });
  facts.push({ scene,width,theme,revision:result });
  const mobile=width<=760,label=`${scene} ${width} ${theme}`;
  check(result.artwork.identityClear,label+' eye, ears and muzzle remain in the scene');
  check(result.artwork.objectFit==='contain',label+
    ' source artwork retains its aspect and contain fit');
  check(result.header.fontSize===(mobile?22:24),label+' approved wordmark font size');
  check(result.header.imageWidth===(mobile?36:40) && result.header.imageHeight===(mobile?36:40),
    label+' approved header image dimensions');
  check(result.header.gap===12,label+' header gap is 12px');
  check(result.diagramInside && result.heroDiagram===1 && result.diagramCount===1,
    label+' single labelled policy example is visible in the hero');
  check(result.diagramClosed,label+' education starts collapsed');
}


async function tabletEntryGap(scene,width,theme) {
  if(scene==='new' || ![768,1024].includes(width)) return;
  const gaps=await page.locator('.wallet-vault-card>.vault-card-entry').evaluateAll(
    (entries)=>entries.map((node)=>{
    const label=node.querySelector('.vault-entry-label').getBoundingClientRect();
    const arrow=node.querySelector('[aria-hidden="true"]').getBoundingClientRect();
    return {gap:arrow.left-label.right,labelWidth:label.width,arrowWidth:arrow.width};
  }));
  facts.push({scene,width,theme,tabletEntryGaps:gaps});
  check(gaps.every((value)=>value.labelWidth>1 && value.gap>=0 && value.gap<=16),
    `${scene} ${width} ${theme} Open wallet label/arrow stay within16px`);
}

async function staticCursorAndHeader(count) {
  await page.setViewportSize({width:1440,height:900});
  await page.emulateMedia({reducedMotion:'no-preference',forcedColors:'none'});
  await paint(count); await page.waitForTimeout(1200);
  const image=page.locator('.home-hero-art');
  const before=await image.boundingBox();
  const hero=await page.locator('.home-hero').boundingBox();
  await page.mouse.move(hero.x+20,hero.y+20); await settled(page);
  await page.mouse.move(hero.x+hero.width-20,hero.y+hero.height-20); await page.waitForTimeout(750);
  const after=await image.boundingBox();
  const pointer=await page.locator('.home-hero').evaluate((node)=>({
    x:node.style.getPropertyValue('--home-pointer-x'),y:node.style.getPropertyValue(
      '--home-pointer-y'),
    light:node.style.getPropertyValue('--home-light-x'),
  }));
  facts.push({count,pointerShift:{before,after,pointer}});
  check(Math.abs(before.x-after.x)<.25 && Math.abs(before.y-after.y)<.25,
    count+' wallets artwork position never follows pointer');
  check(!pointer.x && !pointer.y && !pointer.light,count+
    ' wallets no image-translation CSS variables');
  const logo=page.locator('.side .logo');
  await logo.hover(); await settled(page);
  const shine=()=>page.locator('.side .nav-zebra').evaluate((node)=>({
    animation:getComputedStyle(node,'::after').animationName,
    display:getComputedStyle(node,'::after').display,opacity:getComputedStyle(node,
      '::after').opacity,
  }));
  const hover=await shine(); await logo.focus(); await settled(page); const focus=await shine();
  facts.push({count,headerShine:{hover,focus}});
  check(hover.animation==='none' && focus.animation==='none',count+
    ' wallets header has no hover/focus shine');
}


async function timingFacts(control) {
  return control.evaluate((node) => {
    const style=getComputedStyle(node);
    return { durations:style.transitionDuration.split(',').map((time)=>time.trim()),
      delays:style.transitionDelay.split(',').map((time)=>time.trim()),
      properties:style.transitionProperty.split(',').map((value)=>value.trim()),
      focusVisible:node.matches(':focus-visible'),outlineWidth:parseFloat(style.outlineWidth),
      outlineStyle:style.outlineStyle };
  });
}

const timingMatches=(result,expected)=>result.durations.every((value)=>
  Math.round(parseFloat(value)*(value.endsWith('ms')?1:1000))===expected);

async function controlTimingCase(label,selector,count) {
  await paint(count); await page.mouse.move(0,0);
  await page.evaluate(()=>document.activeElement?.blur());
  const control=page.locator(selector).first(); await control.scrollIntoViewIfNeeded();
  const initial=await timingFacts(control);
  await control.hover(); const hover=await timingFacts(control);
  await page.mouse.down(); const pressed=await timingFacts(control);
  await page.mouse.move(1,1); await page.mouse.up();
  await page.keyboard.press('Tab'); await control.focus(); const focus=await timingFacts(control);
  facts.push({controlTiming:label,initial,hover,pressed,focus});
  check(timingMatches(initial,120),label+' default transition durations are120ms');
  check(timingMatches(hover,120),label+' hover transition durations are120ms');
  check(timingMatches(pressed,80),label+' pointerdown transition durations are80ms');
  check(focus.focusVisible && focus.outlineWidth>=2 && focus.outlineStyle==='solid'
    && !focus.properties.some((value)=>value==='all' || value.startsWith('outline')),
    label+' keyboard focus outline appears immediately without transition');
}

async function controlTiming() {
  await page.setViewportSize({width:1440,height:900});
  await page.emulateMedia({reducedMotion:'no-preference',forcedColors:'none'});
  for(const [label,selector,count] of [
    ['Create wallet','.welcome-actions>.btn.primary',0],
    ['Recover access','.welcome-secondary-actions>.btn',0],
    ['Wallet card','.wallet-vault-card',1],
    ['How Zigs works summary','.welcome-details>summary',0],
  ]) await controlTimingCase(label,selector,count);
}

async function freshStillCaptures() {
  for(const [scene,count,width,theme] of [['new',0,1440,'light'],
    ['returning',1,390,'dark'],['returning',1,390,'light']]) {
    const isolated=await fresh({viewport:{width,height:width<768?844:900},colorScheme:theme});
    try {
      const target=await isolated.newPage(); await entryReady(target,origin);
      await target.evaluate((value)=>document.documentElement.dataset.theme=value,theme);
      await paint(count,{},target); await settled(target); await artworkReady(target);
      const counts=await target.evaluate(()=>({shell:document.querySelectorAll('.shell').length,
        hero:document.querySelectorAll('.home-hero').length,art:document.querySelectorAll(
          '.home-hero-art').length}));
      facts.push({freshStill:{scene,width,theme,...counts}});
      check(counts.shell===1 && counts.hero===1 && counts.art===1,
        `fresh ${scene} ${width} ${theme} has one shell/hero/art`);
      await capture(`fresh-${scene}-${width}-${theme}`,target);
    } finally { await isolated.close(); }
  }
}

try {
  await entryReady(page, origin);
  for (const [scene, count] of [["new", 0], ["returning", 1], ["multiple", 3]])
    await run(scene + " matrix", () => matrix(scene, count));
  await run("wallet truth", walletTruth);
  for (const count of [0, 1, 3]) await run("keyboard " + count, () => keyboardOrder(count));
  await run("preferences", preferences);
  for (const theme of ["dark", "light"])
    for (const count of [0, 1]) await run(theme + " " + count + " contrast", () => contrast(
      theme, count));
  await run("navigation", navigation);
  await run("synthetic known artwork", knownArtwork);
  await run("local performance", performanceEvidence);
  for (const count of [0,1]) await run("static cursor/header "+count,()=>staticCursorAndHeader(
    count));
  await run("control timings",controlTiming);
  await run("fresh still captures",freshStillCaptures);
  await run("wallet selection", openWallet);
  await run("state boundaries", boundaries);
  check(errors.length === 0, "no browser runtime exceptions or incomplete scenarios");
} catch (error) { errors.push(error.message.split("\n")[0]); }
finally {
  await browser.close();
  notes.push((
    "Computed contrast measures control gradient stops and "
    + "opaque fallback surfaces; screenshots also need visual "
    + "review where artwork or layered gradients overlap."
  ));
  const report = { checks, facts, errors, screenshots, notes,
    versions: { node: process.version, browser: browser.version() },
    scope: (
      "Actual local web page with unchanged Worker-equivalent "
      + "shim insertion. External requests blocked; fresh "
      + "isolated stores. "
    )
      + "Synthetic memory-only wallet metadata/balances; inert subscriptions only for selection. "
      + "Restricted capability is injected into the test shim, never production source. "
      + (
        "Locked/damaged fixtures use existing keystore setter; "
        + "no unlock, import, signing, payment or backend "
        + "certification."
      ) };
  writeFileSync(resolve(output, "validation.json"), JSON.stringify(report, null, 2) + "\n");
  const failed = checks.filter((item) => !item.pass);
  if (errors.length || failed.length) process.exitCode = 1;
  console.log(JSON.stringify({ checks: checks.length, failed, screenshots: screenshots.length,
    errors }));
}
