// Presentation-only QA. Fresh stores, synthetic wallets, app boot and external traffic disabled.
// Serve web/ locally; set PLAYWRIGHT_MODULE and CHROME_EXECUTABLE if needed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const origin = process.env.ZIGS_BRAND_ORIGIN || "http://127.0.0.1:8877";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const phase = process.env.ZIGS_BRAND_PHASE || "after";
assert.ok(["before", "after", "committed"].includes(phase));
const output = join(root, "docs/ux-redesign/visuals/brand-identity", phase);
mkdirSync(output, { recursive: true });
const frozen = process.env.ZIGS_BRAND_FROZEN;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce" });
const errors = [], checks = [], requests = [];
const source = (name) => phase === "committed"
  ? execFileSync("git", ["show", "4cd81df:web/" + name], { cwd: root, encoding: "utf8" })
  : readFileSync(join(frozen || join(root, "web"), name), "utf8");

function readinessAsset(path) {
  if (path === "/app-engine.js" || path === "/app-groups.js") {
    const body = (phase === "committed" ? source(path.slice(1))
      : readFileSync(join(root, "web", path.slice(1)), "utf8"))
      .replace("engineSettled = false", "engineSettled = true")
      .replace("dbReady = false", "dbReady = true");
    return { contentType: "text/javascript", body };
  }
  return null;
}
function pageAsset(path) {
  if (["/", "/app.css", "/app-shell.js", "/design-system.css"].includes(path)) {
    let body = source(path === "/" ? "index.html" : path.slice(1));
    if (path === "/" && phase !== "before" && !body.includes('/brand-identity.css'))
      body = body.replace('<link rel="stylesheet" href="/app.css">',
        (
          "<link rel=\"stylesheet\" href=\"/app.css\"><link "
          + "rel=\"stylesheet\" href=\"/brand-identity.css\">"
        ));
    return { contentType: path === "/" ? "text/html"
      : path.endsWith(".js") ? "text/javascript" : "text/css", body };
  }
  return null;
}

await context.route("**/*", (route) => {
  const url = new URL(route.request().url());
  if (url.origin !== origin) return route.abort();
  const path = url.pathname;
  if (path === "/__brand_board__") return route.fulfill({ contentType: "text/html",
    body: readFileSync(join(root, "docs/ux-redesign/visuals/brand-identity/comparison-board.html"),
      "utf8").replaceAll("../../../../web/", "/") });
  if (path === "/app.js") return route.fulfill({ contentType: "text/javascript",
    body: "// Isolated presentation fixture; no application boot." });
  const readiness = readinessAsset(path);
  if (readiness) return route.fulfill(readiness);
  if (phase === "committed" && path.endsWith(".js"))
    return route.fulfill({ contentType: "text/javascript", body: source(path.slice(1)) });
  const presentation = pageAsset(path);
  if (presentation) return route.fulfill(presentation);
  return route.continue();
});
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.name + ": " + e.message));
page.on("response", (r) => { if (r.url().includes("/assets/brand/"))
  requests.push({ asset: new URL(r.url()).pathname, status: r.status() }); });
await page.goto(origin);

async function render(kind) {
  await page.evaluate(async (kind) => {
    const app = document.getElementById("app"), { lobby } = await import("/app-shell.js");
    const { state } = await import("/app-state.js");
    state.groups = []; state.gid = null;
    if (kind === "wallets") state.groups = [
      { id: "sample-brand-1", name: "Family vault", t: 2, n: 3, network: "testnet" },
      { id: "sample-brand-2",
        name: "Shared travel and household expenses with a longer wallet name",
        t: 3, n: 5, network: "testnet" },
    ];
    app.replaceChildren(lobby());
    if (kind === "education") {
      const { tutorialDiagram } = await import("/app-tutorial.js");
      app.replaceChildren(tutorialDiagram("shares"));
      const empty = document.createElement("div"); empty.className = "empty workflow-empty";
      empty.innerHTML = '<span class="empty-illustration" aria-hidden="true">'
        + '<span class="symbol"><svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" '
        + 'd="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg></span></span>'
        + '<h3>No activity yet</h3><p>Payments will appear here after this wallet is used.</p>';
      app.append(empty);
    }
    document.querySelector(".shell").classList.toggle("lobby-home", kind !== "education");
  }, kind);
  if (kind === "wallets") {
    const details = page.locator("#welcome-wallets summary");
    if (await details.count()) {
      await details.press("Enter");
      assert.equal(await page.locator("#welcome-wallets").evaluate((n) => n.open), true);
    }
  }
}
async function settle() {
  await page.evaluate(async () => { await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
}
for (const kind of ["welcome", "wallets", "education"]) {
  await render(kind);
  for (const width of [1440, 390]) for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme);
    await settle();
    const name = `${kind}-${width}-${theme}`;
    const result = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      buttons: [...document.querySelectorAll("#app button")].map((n) =>
        ({ text: n.textContent.trim(), disabled: n.disabled })),
      text: document.getElementById("app").textContent,
    }));
    checks.push({ name, overflow: result.overflow, buttons: result.buttons,
      textHash: createHash("sha256").update(result.text).digest("hex") });
    assert.equal(result.overflow, false, name + " has no horizontal overflow");
    await page.screenshot({ path: join(output, name + ".png"), fullPage: true,
      animations: "disabled" });
  }
}
if (phase !== "before") {
  await page.emulateMedia({ forcedColors: "active" });
  assert.equal(await page.locator(".empty-illustration>.symbol").evaluate((n) =>
    getComputedStyle(n).visibility), "visible", "forced colours restores original icon");
  await page.screenshot({ path: join(output, "education-forced-colors.png"), fullPage: true });
  await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
  assert.equal(await page.locator(".empty-illustration").evaluate((n) =>
    getComputedStyle(n, "::before").animationName), "none");
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  await settle();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
    "education at 200% text size has no horizontal overflow");
  await page.screenshot({ path: join(output, "education-text-200.png"), fullPage: true });
}
if (phase === "after") {
  await page.goto(origin + "/__brand_board__");
  await page.setViewportSize({ width: 1680, height: 1100 }); await settle();
  await page.screenshot({ path: join(output, "comparison-board.png"), fullPage: true });
  const retina = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 390,
    height: 844 } });
  await retina.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/__brand_board__") return route.fulfill({ contentType: "text/html",
      body: readFileSync(join(root,
        "docs/ux-redesign/visuals/brand-identity/comparison-board.html"),
        "utf8").replaceAll("../../../../web/", "/") });
    return route.continue();
  });
  const high = await retina.newPage(); await high.goto(origin + "/__brand_board__");
  await high.evaluate(() => document.fonts.ready);
  await high.locator(".specimen").first().screenshot({ path: join(output, "motifs-2x.png") });
  await retina.close();
}
assert.deepEqual(errors, []); assert.ok(requests.every((r) => r.status === 200));
writeFileSync(join(output, "checks.json"), JSON.stringify({ phase,
  fixture: "synthetic, no app boot",
  errors, requests, checks }, null, 2) + "\n");
console.log(JSON.stringify({ phase, cases: checks.length, errors, overflow: false }));
await browser.close();
