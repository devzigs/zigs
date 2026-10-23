// Presentation-only probes for fresh, inert samples. No wallet state or action is modified.

export async function compactDetails(page, qa) {
  const ids = ["zec-asset-details", "sol-asset-details", "usdc-asset-details"];
  for (const id of ids) {
    const summary = page.locator("#" + id + ">summary");
    await summary.press("Enter");
    await page.evaluate(async () => (await import("/app-loop.js")).render());
    await qa.stable(page);
    const opened = await page.locator(".asset-note[open]").evaluateAll((nodes) => nodes
      .map((node) => node.id));
    qa.check(opened.length === 1 && opened[0] === id,
      "Only " + id + " remains expanded after ordinary redraw");
    await summary.press("Enter");
  }
}

export async function compactOverview(page, qa, width, theme) {
  const facts = await page.evaluate(() => {
    const rect = (node) => node.getBoundingClientRect();
    const shown = (node) => !!node.getClientRects().length
      && getComputedStyle(node).visibility === "visible";
    const hero = document.querySelector(".overview-hero"), side = document.querySelector(".side");
    const assets = [...document.querySelectorAll(".asset-card")];
    const color = (node) => getComputedStyle(node).backgroundColor.match(/[\d.]+/g).map(Number);
    const heroColor = color(hero), sideColor = color(side);
    const bounds = assets.map((node) => rect(node));
    const buttons = [...document.querySelectorAll(".asset-card button,.overview-hero button,"
      + ".overview-hero summary")].filter(shown).map(rect);
    const amounts = [...document.querySelectorAll(".asset-balance-block .money")].filter(shown);
    const zec = document.querySelector("[aria-labelledby=asset-zec]");
    return { heroColor, sideColor, height: rect(hero).height, cards: bounds.length,
      sameRow: bounds.length === 3 && bounds.every((box) => Math.abs(box.top - bounds[0].top) < 1),
      visible: bounds.every((box) => box.top >= 0 && box.bottom <= innerHeight + 1),
      controls: buttons.every((box) => box.width >= 47.5 && box.height >= 47.5),
      exact: amounts.length > 0 && amounts.every((node) =>
        node.scrollWidth <= node.clientWidth + 1),
      available: zec.querySelector(".asset-balance-block")?.textContent,
      details: zec.querySelector(".asset-note")?.textContent,
      tracks: assets.every((node) => {
        const track = node.querySelector(".shielding-track.is-unknown");
        const values = [...node.querySelectorAll(".shielding-breakdown dd")];
        return track?.getAttribute("aria-hidden") === "true" && values.length === 2
          && values.every((value) => value.textContent === "—%");
      }),
      noFakeRatios: !/[0-9][\d,.]*\s*%/.test(assets.map((node) => node.textContent).join(" ")),
      unshield: assets.every((node) => {
        const buttons = [...node.querySelectorAll(".shielding-actions button")];
        const path = (button) => button?.querySelector("svg path")?.getAttribute("d");
        return buttons.length === 2 && path(buttons[0]) && path(buttons[1])
          && path(buttons[0]) !== path(buttons[1]);
      }) };
  });
  const label = width + " " + theme.name;
  compactValues(facts, qa, label);
  compactPalette(facts, qa, label, theme.scheme === "dark");
  compactDesktop(facts, qa, label, width);
}

function compactValues(facts, qa, label) {
  qa.check(facts.cards === 3 && facts.controls && facts.exact,
    "Compact Overview keeps three assets, exact amounts and 48px controls " + label);
  qa.check(facts.tracks && facts.noFakeRatios && facts.unshield,
    "Compact Overview has honest unknown bars and distinct Shield/Unshield icons " + label);
  qa.check(/1\.23456789.*0\.02345678/s.test(facts.available || "")
    && /1\.25802467/.test(facts.details || ""),
  "Compact Overview preserves exact available/incoming/total ZEC values " + label);
}

function compactPalette(facts, qa, label, dark) {
  qa.check(dark ? facts.heroColor.slice(0, 3).every((n) => n < 95)
    && facts.sideColor.slice(0, 3).every((n) => n < 95)
    : facts.heroColor.slice(0, 3).every((n) => n > 180)
      && facts.sideColor.slice(0, 3).every((n) => n > 180),
  "Compact Overview hero and sidebar follow the selected theme " + label);
}

function compactDesktop(facts, qa, label, width) {
  if ([1440, 1920].includes(width)) {
    qa.check(facts.sameRow && facts.visible && facts.height <= 260,
      "Desktop compact balance and all three assets fit the first viewport " + label
      + " " + JSON.stringify({ heroHeight: facts.height, sameRow: facts.sameRow,
        visible: facts.visible }));
  }
}

async function doubleText(page, settled) {
  await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("body *")];
    window.__compactText = nodes.map((node) => [node, node.style.fontSize,
      getComputedStyle(node).fontSize]);
    for (const [node, , size] of window.__compactText)
      node.style.fontSize = parseFloat(size) * 2 + "px";
  });
  await settled(page);
}

async function restoreText(page, settled) {
  await page.evaluate(() => {
    for (const [node, size] of window.__compactText)
      if (node.isConnected) node.style.fontSize = size;
    delete window.__compactText;
  });
  await settled(page);
}

async function doubledMatrix(page, qa, { layout, palette, settled, THEMES, WIDTHS }) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of THEMES.slice(0, 2)) {
      await palette(page, theme); await doubleText(page, settled);
      await layout(page, qa, "Compact Overview doubled text " + width + " " + theme.name);
      if ([320, 1440].includes(width))
        await qa.capture(page, "compact-overview-2x-" + width + "-" + theme.name);
      await restoreText(page, settled);
    }
  }
}

async function expandedDetails(page, qa, { layout, palette, THEMES, WIDTHS }) {
    await page.setViewportSize({ width: 320, height: 1000 });
    await palette(page, THEMES[0]);
    for (const summary of await page.locator(".asset-note>summary").all()) {
      await summary.focus(); await summary.press("Enter");
      qa.check(await summary.evaluate((node) => node.parentElement.open
        && node === document.activeElement), "Asset details expand by keyboard and retain focus");
    }
    qa.check(await page.locator("#zec-shielding-note").isVisible()
      && await page.locator("#sol-shielding-note").isVisible()
      && await page.locator("#usdc-shielding-note").isVisible(),
    "Expanded asset details retain privacy and unsupported-transfer explanations");
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 1000 });
      await layout(page, qa, "Compact Overview expanded asset details " + width);
    }
    await qa.capture(page, "compact-overview-expanded-1920-dark");
    await page.locator(".asset-note").evaluateAll((nodes) => {
      for (const node of nodes) node.open = false;
    });
}

async function forcedMatrix(page, qa, { layout }) {
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await layout(page, qa, "Compact Overview forced colors " + width);
    await qa.capture(page, "compact-overview-forced-colors-" + width);
  }
  await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
}

export async function compactPreferences(page, qa, helpers) {
  await doubledMatrix(page, qa, helpers);
  if (qa.after) await expandedDetails(page, qa, helpers);
  await forcedMatrix(page, qa, helpers);
}
