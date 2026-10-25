// Local presentation QA. Real renderers, disposable synthetic state, no external requests.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  overviewFixture,
  settleOverview,
} from "../harness/overview-redesign-fixture.mjs";
import { chapters } from "../../web/how-zigs-works-content.js";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const out = resolve(process.env.ZIGS_STYLE_OUTPUT || "solspike/.state/site-style-review");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_EXECUTABLE,
});
const context = await browser.newContext({
  reducedMotion: "reduce",
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
page.setDefaultTimeout(5000);
const checks = [],
  errors = [],
  screens = [];
page.on("pageerror", (error) => errors.push(error.message));
const check = (pass, label) => {
  assert.ok(pass, label);
  checks.push(label);
};
const top = () =>
  page.locator(".home-how-content").evaluate((node) => {
    node.scrollTop = 0;
  });
const capture = async (name) => {
  await settleOverview(page);
  await page.screenshot({ path: resolve(out, name + ".png"), animations: "disabled" });
  screens.push(name + ".png");
};
const walletSnapshot = () =>
  page.evaluate(async () => {
    const { state } = await import("/app-state.js");
    return JSON.stringify({
      groups: state.groups,
      wallet: state.wallet,
      seats: state.seats,
      sessions: state.sessions,
      storage: Object.fromEntries(
        Object.keys(localStorage)
          .sort()
          .map((key) => [key, localStorage.getItem(key)]),
      ),
      hash: location.hash,
    });
  });
const palette = async (theme) => {
  const failures = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const rgb = (token) => {
      const span = document.createElement("span");
      span.style.color = style.getPropertyValue("--" + token).trim();
      document.body.append(span);
      const value = getComputedStyle(span)
        .color.match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number);
      span.remove();
      return value;
    };
    const lum = (color) =>
      color
        .map((v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        })
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a, b) => {
      const values = [lum(rgb(a)), lum(rgb(b))].sort((x, y) => y - x);
      return (values[0] + 0.05) / (values[1] + 0.05);
    };
    const failed = [];
    for (const foreground of [
      "text",
      "muted",
      "faint",
      "accent-text",
      "ok",
      "bad",
      "info",
      "warning",
    ])
      for (const surface of ["bg", "side", "panel", "raised", "sunk", "sheet"])
        if (ratio(foreground, surface) < 4.5) failed.push(foreground + " on " + surface);
    if (ratio("on-accent", "accent") < 4.5) failed.push("primary button");
    for (const surface of ["panel", "raised", "sunk"])
      if (ratio("line-field", surface) < 3) failed.push("field edge on " + surface);
    return failed;
  });
  check(
    !failures.length,
    theme + ": composed text/button/field palette contrast " + failures.join(", "),
  );
};
const layout = async (label) => {
  const result = await page.evaluate(() => {
    const root = document.querySelector(".hw-experience"),
      content = root.closest(".home-how-content");
    const visible = (node) =>
      node.getClientRects().length && getComputedStyle(node).visibility !== "hidden";
    const wide = [...root.querySelectorAll("h3,h4,p,table,.hw-journey-figure,.hw-figure")]
      .filter(visible)
      .filter(
        (node) =>
          node.getBoundingClientRect().right > innerWidth + 1 ||
          node.getBoundingClientRect().left < -1,
      )
      .map((node) => node.className || node.tagName);
    const ids = [...root.querySelectorAll("[id]")].map((node) => node.id);
    return {
      overflow: content.scrollWidth > content.clientWidth + 1,
      wide,
      duplicateIds: ids.length !== new Set(ids).size,
    };
  });
  check(
    !result.overflow && !result.wide.length,
    label + ": no overflow or out-of-bounds text " + result.wide.join(","),
  );
  check(!result.duplicateIds, label + ": distinct SVG and control identifiers");
};
function checkReferencePart(part, text, index) {
  const values = [
    part.title,
    ...(part.paragraphs || []),
    ...(part.items || []),
    ...(part.rows || []).flat(),
    ...(part.terms || []).flat(),
  ];
  for (const value of values)
    check(
      text.replaceAll(/\s+/g, " ").includes(value.replaceAll(/\s+/g, " ")),
      `chapter ${index + 1}: preserved reference text`,
    );
}
async function guideViewport(width, theme) {
  await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
  await top();
  await page.getByRole("button", { name: "Explore the journeys", exact: true }).click();
  await layout(`${width} ${theme} overview`);
  if ([390, 1440].includes(width)) {
    await capture(`journeys-${width}-${theme}`);
    await page.locator(".hw-journey-figure").scrollIntoViewIfNeeded();
    await capture(`journey-illustration-${width}-${theme}`);
  }
  await page.getByRole("button", { name: "Complete guide", exact: true }).click();
  if (width <= 900) {
    await page.locator(".hw-chapters summary").click();
    await page.getByRole("tab").nth(5).click();
    check(
      (await page.locator(".hw-chapters").getAttribute("open")) === null,
      `${width} ${theme}: mobile chapter picker closes after selection`,
    );
  }
  await layout(`${width} ${theme} reference`);
  if ([390, 1440].includes(width)) await capture(`reference-${width}-${theme}`);
  if (width < 600)
    check(
      await page.evaluate(
        () =>
          document.querySelector(".hw-chapter-heading").getBoundingClientRect().top <
          document.querySelector(".hw-figure").getBoundingClientRect().top,
      ),
      `${width} ${theme}: introduction precedes illustration`,
    );
}
async function functionalVariant({ theme, width, tab }) {
  await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
  await page.evaluate(
    async ({ tab, theme }) => {
      document.documentElement.dataset.theme = theme;
      (await import("/app-state.js")).ui.tab = tab;
      (await import("/app-loop.js")).draw();
    },
    { tab, theme },
  );
  await settleOverview(page);
  check(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    `${tab} ${width} ${theme}: functional page does not overflow`,
  );
  const expected = {
    approvals: "Approvals",
    activity: "Activity",
    recipients: "Address book",
    chats: "Messages",
    recovery: "Security",
    settings: "Settings",
  }[tab];
  if (expected)
    check(
      (await page.getByRole("heading").allTextContents()).some((text) =>
        text.includes(expected),
      ),
      `${tab} ${width} ${theme}: correct destination renders`,
    );
  if (
    [390, 1440].includes(width) &&
    ["overview", "approvals", "recovery", "settings"].includes(tab)
  )
    await capture(`${tab}-${width}-${theme}`);
}

try {
  await overviewFixture(context, page);
  await page.evaluate(async () => {
    const { state, ui } = await import("/app-state.js");
    state.g = null;
    state.gid = null;
    ui.tab = "overview";
    (await import("/app-loop.js")).draw();
  });
  await capture("home-1440-dark");
  const before = await walletSnapshot();
  await page.getByRole("button", { name: "How Zigs works", exact: true }).first().click();
  await page.getByRole("dialog", { name: "How Zigs works" }).waitFor();
  check(await page.locator(".hw-journeys").isVisible(), "journeys are the default view");
  check(
    await page.locator(".hw-guide").isHidden(),
    "reference is available without competing with the overview",
  );
  check(
    (await page.locator(".hw-journey-choice").count()) === 5,
    "five educational journeys",
  );
  await capture("journeys-1440-dark");
  for (let i = 0; i < 5; i++) {
    await top();
    await page.locator(".hw-journey-choice").nth(i).click();
    for (let j = 0; j < 4; j++) {
      await page.locator(".hw-step-choice").nth(j).click();
      check(
        (await page.locator(".hw-journey-figure svg").count()) === 1,
        `journey ${i + 1} step ${j + 1}: illustrated`,
      );
      await layout(`journey ${i + 1} step ${j + 1}`);
    }
    if (i === 4)
      check(
        (await page.locator(".hw-journey-panel").innerText()).includes(
          "Preview · Unavailable",
        ),
        "swap remains explicitly unavailable",
      );
  }
  await top();
  await page.locator(".hw-journey-choice").first().click();
  await page.locator(".hw-step-choice").nth(1).click();
  check(
    (await page.locator(".hw-journey-figure").innerText()).includes("ALL 30 DIGITS"),
    "verification retains the complete safety-number requirement",
  );
  await page.locator(".hw-read-more").click();
  check(
    (await page.getByRole("tab", { selected: true }).getAttribute("id")) ===
      "hw-tab-key-generation",
    "journey link opens the matching chapter in place",
  );
  for (let i = 0; i < chapters.length; i++) {
    await top();
    await page.getByRole("tab").nth(i).click();
    const text = await page.locator("#hw-chapter").innerText();
    check(
      text.includes(chapters[i].title) &&
        text.includes(chapters[i].intro) &&
        text.includes(chapters[i].takeaway),
      `chapter ${i + 1}: preserved introduction and key idea`,
    );
    for (const part of chapters[i].sections) checkReferencePart(part, text, i);
    await layout(`chapter ${i + 1}`);
  }
  await page.getByRole("tab").last().focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  check(
    (await page.getByRole("tab", { selected: true }).getAttribute("id")) ===
      "hw-tab-key-generation",
    "reference keyboard navigation supports Home and ArrowDown",
  );
  await page.evaluate(async () => (await import("/app-loop.js")).draw());
  check(
    (await page.getByRole("tab", { selected: true }).getAttribute("id")) ===
      "hw-tab-key-generation",
    "chapter survives an app redraw",
  );
  await page.getByRole("button", { name: "Explore the journeys", exact: true }).click();
  check(
    (await page.locator(".hw-step-choice").nth(1).getAttribute("aria-pressed")) ===
      "true",
    "journey step survives a reference visit and redraw",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: "Pause illustrations", exact: true }).click();
  check(
    (await page.locator(".hw-experience").getAttribute("data-paused")) === "true",
    "global pause is explicit",
  );
  await page.locator(".hw-journey-figure").scrollIntoViewIfNeeded();
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  check(
    (await page
      .locator(".hw-art .dxa-flow")
      .first()
      .evaluate((node) => getComputedStyle(node).animationPlayState)) === "paused",
    "pause affects sculpted artwork",
  );
  await page.getByRole("button", { name: "Resume illustrations", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  check(
    await page.locator(".hw-toolbar .hw-reduced-label").isVisible(),
    "reduced-motion preference has a visible explanation",
  );
  check(
    (await page
      .locator(".hw-art .dxa-flow")
      .first()
      .evaluate((node) => getComputedStyle(node).animationName)) === "none",
    "reduced motion disables illustration animation",
  );
  for (const theme of ["dark", "light"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await palette(theme);
    for (const width of [320, 390, 768, 1024, 1440]) await guideViewport(width, theme);
  }
  await page.setViewportSize({ width: 720, height: 500 });
  await layout("effective 200% viewport and short window");
  await page.emulateMedia({ forcedColors: "active" });
  await layout("forced colours");
  await capture("reference-forced-colours");
  await page.emulateMedia({ forcedColors: "none" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Close How Zigs works", exact: true }).click();
  await page.getByRole("dialog", { name: "How Zigs works" }).waitFor({ state: "hidden" });
  check(
    await page
      .getByRole("button", { name: "How Zigs works", exact: true })
      .first()
      .evaluate((node) => node === document.activeElement),
    "dismissal restores the opening control",
  );
  check(
    (await walletSnapshot()) === before,
    "guide leaves wallet data, storage and URL fragments unchanged",
  );
  await page.getByRole("button", { name: "How Zigs works", exact: true }).first().click();
  await page.locator(".hw-guide").waitFor({ state: "visible" });
  check(
    await page.locator(".hw-guide").isVisible(),
    "guide mode survives dismissal and reopening",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "How Zigs works" }).waitFor({ state: "hidden" });
  check(
    (await page.getByRole("dialog", { name: "How Zigs works" }).count()) === 0,
    "Escape dismisses the guide",
  );
  await page.evaluate(async () => {
    const { state, ui } = await import("/app-state.js");
    state.g = state.groups[0];
    state.gid = state.g.id;
    ui.tab = "overview";
    (await import("/app-loop.js")).draw();
  });
  const variants = ["dark", "light"].flatMap((theme) =>
    [320, 390, 768, 1440].flatMap((width) =>
      [
        "overview",
        "approvals",
        "activity",
        "recipients",
        "chats",
        "recovery",
        "settings",
      ].map((tab) => ({ theme, width, tab })),
    ),
  );
  for (const variant of variants) await functionalVariant(variant);
  check(!errors.length, "no browser page errors: " + errors.join("; "));
  console.log(`site-style: ${checks.length} checks passed; ${screens.length} captures`);
} finally {
  writeFileSync(
    resolve(out, "report.json"),
    JSON.stringify({ checks, errors, screenshots: screens }, null, 2) + "\n",
  );
  await browser.close();
}
