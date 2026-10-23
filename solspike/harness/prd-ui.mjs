// PRD presentation evidence. All stores are synthetic; render fixtures have no event handlers.
const WIDTHS = process.env.ZIGS_UI_PREMIUM === "1" || process.env.ZIGS_UI_ART_DIRECTION === "1"
  || process.env.ZIGS_UI_OPTIONAL_PASSKEY === "1"
  || process.env.ZIGS_UI_COMPACT_OVERVIEW === "1" || process.env.ZIGS_UI_ENTRY_FLOW === "1"
  ? [320, 390, 768, 1024, 1440, 1920] : [320, 375, 390, 768, 1024, 1440];
const THEMES = ["dark", "light", "system"];
const button = (p, name) => p.getByRole("button", { name, exact: true });
const mediaSessions = new WeakMap();

async function theme(p, value) {
  await p.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce", forcedColors: "none" });
  await p.evaluate((v) => {
    if (v === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = v;
  }, value);
}

async function matrix(p, qa, name) {
  for (const width of WIDTHS) {
    await p.setViewportSize({ width, height: 1000 });
    for (const value of THEMES) {
      await theme(p, value);
      await qa.layout(p, "PRD " + name + " " + width + " " + value);
      await currencyUnits(p, qa, name);
      await qa.capture(p, "31-prd-" + name + "-" + width + "-" + value);
    }
  }
  await p.setViewportSize({ width: 390, height: 1000 });
  await theme(p, "dark");
}

async function preferences(p, qa, name) {
  await p.setViewportSize({ width: 320, height: 1000 });
  try {
    await qa.doubleText(p, "PRD " + name + " actual2x320");
    await currencyUnits(p, qa, name + " enlarged text");
  }
  finally { await qa.capture(p, "32-prd-" + name + "-2x320"); }
  await qa.resetText(p);
  await p.setViewportSize({ width: 390, height: 1000 });
  await p.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await qa.layout(p, "PRD " + name + " forced colors");
  await qa.capture(p, "33-prd-" + name + "-forced-colors");
  await p.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
  let cdp = mediaSessions.get(p);
  if (!cdp) {
    cdp = await p.context().newCDPSession(p);
    mediaSessions.set(p, cdp);
  }
  await cdp.send("Emulation.setEmulatedMedia", { features: [
    { name: "prefers-reduced-transparency", value: "reduce" },
    { name: "prefers-reduced-motion", value: "reduce" },
    { name: "prefers-color-scheme", value: "dark" },
  ] });
  qa.check(await p.evaluate(() => matchMedia("(prefers-reduced-transparency: reduce)").matches),
    "PRD " + name + " reduced transparency preference is active");
  await qa.layout(p, "PRD " + name + " reduced transparency");
  await qa.capture(p, "34-prd-" + name + "-reduced-transparency");
  // Detaching any CDP session on this target also clears Chrome's virtual authenticator state.
  // Keep this session attached until its page/context closes, as the existing harness does.
}

async function currencyUnits(p, qa, name) {
  if (process.env.ZIGS_UI_ART_DIRECTION !== "1"
    && process.env.ZIGS_UI_COMPACT_OVERVIEW !== "1") return;
  if (!name.startsWith("zec-blocked-review")) return;
  if (process.env.ZIGS_CAPTURE_PHASE === "before") return;
  const units = await p.locator(".drawer .leaves .money .cur").evaluateAll((nodes) => nodes
    .map((node) => {
      const range = document.createRange(); range.selectNodeContents(node);
      return { lines: range.getClientRects().length, width: node.clientWidth,
        scroll: node.scrollWidth };
    }));
  qa.check(units.length > 0 && units.every((unit) => unit.lines === 1
    && unit.scroll <= unit.width + 1), name + " currency units stay intact and fully visible");
}

async function route(p, qa, id, after) {
  if (after || id === "settings") await qa.nav(p, id);
  else {
    // Existing internal tabs already render these views; the old sidebar has no entries.
    await p.evaluate(async (tab) => {
      (await import("/app-state.js")).ui.tab = tab;
      (await import("/app-loop.js")).render();
    }, id);
  }
  await p.locator("#panel-" + id).waitFor();
  await qa.stable(p);
}

async function securityLinks(p, qa) {
  const panel = p.locator("#panel-recovery");
  qa.check(await panel.getByRole("heading", { name: "Security", exact: true })
    .isVisible(), "Security has a dedicated destination");
  await panel.locator("#security-files>summary").click();
  qa.check(await panel.getByText("Backups and file checks are optional.", { exact: false })
    .isVisible(), "security recovery files remain explicitly optional");
  qa.check(/passkey|saved|checked|reported/i.test(await panel.innerText()),
    "security summary describes observed protection and recovery evidence");
  await button(panel, "Browser access").press("Enter");
  await p.locator("#panel-settings").waitFor();
  await qa.stable(p);
  qa.check(await p.locator("#tab-settings").getAttribute("aria-current") === "page",
    "Security access link opens existing Settings");
  await button(p, "Open Security").press("Enter");
  await p.locator("#panel-recovery").waitFor();
  await qa.stable(p);
  qa.check(await p.locator("#tab-recovery").getAttribute("aria-current") === "page",
    "Settings links back to the same Security destination");
}

async function setupFacts(p) {
  return p.evaluate(async () => {
    const { state } = await import("/app-state.js"), k = await import("/app-keystore.js");
    return { gid: state.gid, groups: state.groups.length,
      secrets: Object.keys(k.secrets).length, wallet: !!state.wallet,
      dkg: Object.keys(state.dkg1).length };
  });
}

export async function prdEmptyDestinations(p, qa) {
  const before = await setupFacts(p);
  await qa.nav(p, "approvals");
  qa.check(await p.locator("#panel-approvals").getByRole("heading", {
    name: "No wallets yet", exact: true,
  }).isVisible(), "Approvals without a wallet explains its empty state");
  await qa.nav(p, "recovery");
  qa.check(await p.locator("#panel-recovery").getByRole("heading", {
    name: "No wallet selected", exact: true,
  }).isVisible(), "Security without a wallet explains its missing wallet context");
  await button(p, "Manage browser access in Settings").press("Enter");
  await p.locator("#panel-settings").waitFor();
  qa.check(await button(p.locator("#panel-settings"), "Recover access").first().isEnabled(),
    "existing recovery access remains available before a wallet or new passkey exists");
  await qa.nav(p, "overview");
  qa.check(JSON.stringify(before) === JSON.stringify(await setupFacts(p)),
    "visiting empty destinations creates no wallet, device or key-formation state");
}

export async function prdUnfinishedDestinations(p, qa) {
  const before = await setupFacts(p);
  // The guide intentionally hides the sidebar. Exit through its real control first.
  await button(p, "Save and exit").click();
  await qa.nav(p, "approvals");
  const wallet = p.locator("#panel-approvals [data-key=\"wallet-row-" + before.gid + "\"]");
  await wallet.press("Enter");
  await p.locator("#panel-approvals").getByRole("heading", {
    name: "Wallet setup is unfinished", exact: true,
  }).waitFor();
  for (const id of ["approvals", "recovery"]) {
    await qa.nav(p, id);
    const panel = p.locator("#panel-" + id);
    qa.check(await panel.getByRole("heading", {
      name: "Wallet setup is unfinished", exact: true,
    }).isVisible(), id + " identifies unfinished setup rather than an empty completed wallet");
    qa.check(await panel.getByRole("button", { name: /^Approve payment$/ }).count() === 0,
      id + " offers no payment approval before verified formation");
  }
  await button(p.locator("#panel-recovery"), "Resume wallet setup").press("Enter");
  await p.getByRole("heading", { name: "Connect your second device", exact: true }).waitFor();
  qa.check(JSON.stringify(before) === JSON.stringify(await setupFacts(p)),
    "unfinished destinations resume setup without changing formation facts");
}

async function zecFixture(p) {
  return p.evaluate(async () => {
    const { state } = await import("/app-state.js");
    const { sessionLayer } = await import("/app-drawer.js");
    const ss = { id: "synthetic-prd-review", pczt: "synthetic unreadable transaction",
      status: "collecting", by: 1, amount: 123456712345678, fee: 10000,
      change: 0, noteValue: 123456712355678, createdAt: Date.now(),
      payees: [{ to: "utest1" + "longaddress".repeat(14), amount: 123456712345678,
        memo: "Synthetic display-only memo " + "long memo text ".repeat(16) }],
      error: "Synthetic display-only blocked review; no transaction was created or signed." };
    const html = sessionLayer(ss).outerHTML;
    return { html, gid: state.gid, styles: [...document.querySelectorAll("link[rel=stylesheet]")]
      .map((n) => n.outerHTML).join("") };
  });
}

export const premiumReviewFixture = (page) => zecFixture(page);

async function solFixture(p) {
  return p.evaluate(async () => {
    const { el } = await import("/app-dom.js"), { payCards } = await import("/sol/payview.js");
    const host = { el, localSeats: () => [], seatIds: () => [1, 2, 3], sec: () => ({}),
      canWriteAs: () => false, state: { g: { n: 3, t: 2, network: "testnet",
        name: "Synthetic read-only wallet with a deliberately long display name" },
      gid: "synthetic-prd-sol" } };
    const ss = { id: "synthetic-sol-review", by: 1, status: "collecting",
      intent: "0a" + "00".repeat(50), expiry: "1", createdAt: 1 };
    const c = { host, gid: host.state.gid, W: {}, sessions: [ss], commits: {}, shares: {},
      docs: { solstart: {}, soldone: {}, solfee: {}, solabort: {} }, loaded: {},
      wait: 0, sessWait: 0, chain: null, sync: null, inited: null };
    const root = document.createElement("div");
    root.append(...payCards(c, (fn) => fn, {}));
    const html = root.querySelector("[data-session=synthetic-sol-review]").outerHTML;
    return { html: "<section class=\"card card-pad\">" + html + "</section>" };
  });
}

async function warningFirst(p, qa) {
  const drawer = p.locator(".drawer"), warning = drawer.locator(".callout.bad").first();
  const amount = drawer.locator(".money.lg").first();
  await warning.waitFor();
  qa.check(await warning.evaluate((n) => {
    const value = n.closest(".drawer").querySelector(".money.lg");
    return !!value && !!(n.compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING);
  }), "ZEC blocking warning precedes the financial amount");
  qa.check(await amount.isVisible(), "blocked review retains the proposed financial amount");
  qa.check(await drawer.getByRole("button", { name: /Approve|Send to network|Build proof/ })
    .count() === 0, "read-only refused fixture offers no approval or payment action");
  qa.check(await amount.evaluate((n) => {
    for (let v = n; v && v.tagName !== "BODY"; v = v.parentElement) {
      const s = getComputedStyle(v), color = s.backgroundColor;
      if (Number(s.opacity) !== 1) return false;
      if (color.startsWith("rgb(") || /^rgba\([^,]+,[^,]+,[^,]+,\s*1\)$/.test(color)) return true;
    }
    return false;
  }), "ZEC financial amount has an opaque reading surface");
}

async function solWarningFirst(p, qa) {
  const row = p.locator("[data-session=synthetic-sol-review]");
  qa.check(await row.locator("[data-sol=expired]").evaluate((n) => {
    const context = n.closest("[data-session]").querySelector(".review-context");
    return !!context && !!(n.compareDocumentPosition(context) & Node.DOCUMENT_POSITION_FOLLOWING);
  }), "Solana expired warning precedes wallet/network context and lifecycle progress");
  qa.check(await row.getByRole("button", { name: /Approve|Execute|Send/ }).count() === 0,
    "expired read-only Solana fixture has no approval or paid-operation action");
}

async function renderReview(p, qa, fixture, kind, after) {
  const page = await p.context().newPage();
  try {
    const base = new URL("/", p.url()).href;
    await page.setContent("<!doctype html><html data-theme=dark><head><base href=\"" + base
      + "\">" + fixture.styles + "</head><body><main id=app class=page>" + fixture.html
      + "<h2 class=sr-only>Read-only synthetic presentation fixture</h2></main></body></html>");
    await page.locator("#app").waitFor({ state: "attached" });
    if (after && kind === "zec-blocked-review") await warningFirst(page, qa);
    if (after && kind === "sol-expired-review") await solWarningFirst(page, qa);
    await matrix(page, qa, kind);
    await preferences(page, qa, kind);
  } finally { await page.close(); }
}

async function reviewFixtures(p, qa, after) {
  const zec = await zecFixture(p);
  qa.check(zec.html.includes("money lg"),
    "synthetic blocked review renders its actual amount component rather than a fallback");
  await renderReview(p, qa, zec, "zec-blocked-review", after);
  const sol = await solFixture(p);
  await renderReview(p, qa, { ...sol, styles: zec.styles }, "sol-expired-review", after);
  qa.check(await p.evaluate(async (gid) => {
    const { state } = await import("/app-state.js");
    return state.gid === gid && !state.sid;
  }, zec.gid), "rendering the synthetic reviews never opens a real payment session");
}

/** Same wallet facts and legacy renderer routes before; actual new navigation controls after. */
export async function prdPresentation(p, qa, { after }) {
  for (const id of ["approvals", "recovery", "settings"]) {
    await route(p, qa, id, after);
    if (after && id === "recovery") await securityLinks(p, qa);
    await matrix(p, qa, id);
    await preferences(p, qa, id);
  }
  await route(p, qa, "overview", true);
  await reviewFixtures(p, qa, after);
}
