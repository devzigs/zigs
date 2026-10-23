// Overview presentation checks against the actual dialogs of an unfunded synthetic wallet.
const asset = (p, ticker) => p.locator("[aria-labelledby=asset-" + ticker + "]");
const button = (p, name) => p.getByRole("button", { name, exact: true });

function chooser(p, action) {
  return p.locator(".overview-hero details").filter({
    has: p.locator("summary").filter({ hasText: new RegExp("^" + action + "$") }),
  });
}

async function focusReturned(p, qa, action) {
  const focus = await p.evaluate(() => {
    const n = document.activeElement;
    return { hero: !!n?.closest(".overview-hero"), shown: !!n?.getClientRects().length,
      tag: n?.tagName, text: n?.textContent.trim() };
  });
  qa.check(focus.hero && focus.shown && ["BUTTON", "SUMMARY"].includes(focus.tag),
    action + " dialog returns focus to a visible hero launcher " + JSON.stringify(focus));
}

async function assetChooser(p, qa, action) {
  const picker = chooser(p, action), summary = picker.locator("summary");
  await summary.focus();
  await summary.press("Enter");
  qa.check(await picker.getAttribute("open") !== null, action + " asset choices open by keyboard");
  const zec = picker.getByRole("button", { name: /ZEC/ });
  const usdc = picker.getByRole("button", { name: /USDC/ });
  qa.check(await usdc.isDisabled(), action + " does not enable unavailable USDC");
  await qa.layout(p, "Overview " + action.toLowerCase() + " choices");
  await qa.capture(p, "22-overview-" + action.toLowerCase() + "-choices");
  await zec.press("Enter");
  const dialog = p.getByRole("dialog");
  await dialog.waitFor();
  qa.check(await dialog.getByRole("heading", {
    name: action === "Send" ? "Send ZEC" : "Receive ZEC", exact: true,
  }).isVisible(), action + " choice opens the existing ZEC dialog");
  qa.check(await p.evaluate(async () => !(await import("/app-state.js")).state.sid),
    action + " choice creates no payment proposal");
  await qa.layout(p, "Overview " + action.toLowerCase() + " choice dialog");
  await p.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await qa.stable(p);
  await focusReturned(p, qa, action);
  if (await picker.getAttribute("open") !== null) await summary.press("Enter");
}

async function transactionViews(p, qa) {
  const panel = p.locator(".overview-transactions");
  const group = panel.getByRole("group", { name: "Transaction view", exact: true });
  const pending = button(group, "Pending"), recent = button(group, "Recent");
  qa.check(await pending.getAttribute("aria-pressed") === "true",
    "Pending is the default Overview transaction view");
  await recent.press("Enter");
  await panel.locator(".recent-transactions").waitFor();
  qa.check(await recent.getAttribute("aria-pressed") === "true"
    && await pending.getAttribute("aria-pressed") === "false",
  "Recent selection has accessible pressed states");
  qa.check(!await p.locator(".overview-approvals").isVisible(),
    "Recent replaces the pending view without duplicate approval controls");
  await qa.layout(p, "Overview Recent transactions");
  await qa.capture(p, "20-overview-recent");
  await pending.press("Enter");
  await p.locator(".overview-approvals").waitFor();
  qa.check(await pending.getAttribute("aria-pressed") === "true"
    && await recent.getAttribute("aria-pressed") === "false",
  "Pending restores the existing approval view and accessible pressed states");
  await qa.capture(p, "21-overview-pending");
}

async function fullOverview(p, qa, view) {
  for (const width of [390, 1440]) {
    await p.setViewportSize({ width, height: 1000 });
    await qa.layout(p, "Overview " + view + " full page " + width);
    await qa.capture(p, "23-overview-" + view + "-full-" + width, true);
  }
}

async function populatedRecent(p, qa) {
  await p.evaluate(async () => {
    const c = await import("/app-chain.js");
    window.__overviewChain = c.chain;
    c.setChain({ ...c.chain, received: [{ height: 4499999,
      txid: "a".repeat(64), confirmed: true, value: 123456712345678,
      memos: [{ status: "text", text: "Synthetic display-only receipt · "
        + "utest1" + "longaddress".repeat(12) }] }] });
    (await import("/app-loop.js")).render();
  });
  try {
    const panel = p.locator(".overview-transactions");
    await button(panel, "Recent").press("Enter");
    const rowTitle = panel.getByText("Received ZEC", { exact: true });
    await rowTitle.waitFor();
    qa.check(await rowTitle.isVisible(),
      "Recent reuses the received-payment row for synthetic chain display data");
    qa.check(await panel.getByRole("img", { name: "+1,234,567.12345678 ZEC",
      exact: true }).isVisible(), "Recent keeps the exact large received amount accessible");
    qa.check(/not Zigs.*transaction id.*IP address/s.test(await panel.innerText()),
      "Recent retains the explorer privacy disclosure");
    const link = panel.getByRole("link", { name: /Received ZEC/ });
    qa.check(await link.getAttribute("target") === "_blank"
      && (await link.getAttribute("href")).endsWith("a".repeat(64)),
    "received row keeps its existing external transaction explorer destination");
    await fullOverview(p, qa, "recent-populated");
    await button(panel, "View all activity").click();
    await p.locator("#tab-activity[aria-current=page]").waitFor({ state: "attached" });
    qa.check(await p.locator("#tab-activity").getAttribute("aria-current") === "page",
      "Recent opens the existing full Activity destination");
    qa.check(await p.getByText("Received ZEC", { exact: true }).isVisible(),
      "Activity preserves the same received row");
    await qa.nav(p, "overview");
  } finally {
    await p.evaluate(async () => {
      (await import("/app-chain.js")).setChain(window.__overviewChain);
      delete window.__overviewChain;
      (await import("/app-loop.js")).render();
    });
  }
  await button(p.locator(".overview-transactions"), "Pending").press("Enter");
  await p.locator(".overview-approvals").waitFor();
}

async function chooserMatrix(p, qa) {
  for (const width of [320, 390, 768, 1440]) {
    await p.setViewportSize({ width, height: 1000 });
    const summary = chooser(p, "Receive").locator("summary");
    await summary.press("Enter");
    await qa.layout(p, "Overview receive choices " + width);
    await qa.capture(p, "24-overview-receive-choices-" + width, true);
    await summary.press("Enter");
  }
  await p.setViewportSize({ width: 320, height: 1000 });
  await chooser(p, "Send").locator("summary").press("Enter");
  try { await qa.doubleText(p, "Overview chooser actual2x320"); }
  finally { await qa.capture(p, "25-overview-choices-2x-320", true); }
  await qa.resetText(p);
  await chooser(p, "Send").locator("summary").press("Enter");
  await p.setViewportSize({ width: 390, height: 1000 });
  await p.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await chooser(p, "Receive").locator("summary").press("Enter");
  await qa.layout(p, "Overview chooser forced colors");
  await qa.capture(p, "26-overview-choices-forced-colors", true);
  await chooser(p, "Receive").locator("summary").press("Enter");
  await p.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
}

/** Called only for the new Overview. Baseline screenshots use the unchanged older interface. */
export async function overviewPresentation(p, qa) {
  const hero = p.locator(".overview-hero");
  await hero.waitFor();
  const title = hero.getByRole("heading", { name: "Portfolio balance", exact: true });
  qa.check(await title.isVisible(),
    "Overview leads with Portfolio balance");
  const words = await hero.innerText();
  qa.check(/\$0\.00/.test(words) && /Placeholder/.test(words)
    && await hero.locator("[data-valuation-state=unknown]").count() === 1,
    "unknown USD valuation has a labelled presentation-only zero");
  const holdings = words + await p.locator(".assets-grid").innerText();
  qa.check(!/[+-]?\d[\d,.]*\s*%/.test(holdings),
    "Overview invents no percentage changes without pricing data");
  qa.check(await hero.getByRole("button", { name: /Swap/ }).isDisabled(),
    "global Swap stays unavailable");
  for (const ticker of ["zec", "usdc"]) {
    for (const action of ["Shield", "Unshield"]) {
      qa.check(await button(asset(p, ticker), action).isDisabled(),
        ticker.toUpperCase() + " " + action + " remains unavailable");
    }
  }
  await assetChooser(p, qa, "Send");
  await assetChooser(p, qa, "Receive");
  await transactionViews(p, qa);
  await fullOverview(p, qa, "pending");
  await populatedRecent(p, qa);
  await chooserMatrix(p, qa);
}
