// Presentation-only QA: fresh browser, synthetic display data, no wallet boot or service access.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const phase = process.env.ZIGS_PRIVACY_PHASE || "after";
const baseline = process.env.ZIGS_PRIVACY_BASELINE;
assert.ok(["before", "after"].includes(phase));
const output = join(root, "docs/ux-redesign/visuals/privacy", phase);
mkdirSync(output, { recursive: true });
const extra = {
  "/app-wallet.js": "zecAsset,solAsset,usdcAsset,receivedRow",
  "/app-send.js": "reviewDialog",
  "/sol/payview.js": "withdrawForm,sendForm,reviewHero,addSolCard",
  "/sol/view.js": "keyBlock",
};
const types = { js: "text/javascript", css: "text/css", html: "text/html",
  svg: "image/svg+xml", png: "image/png", woff2: "font/woff2" };
function servedFile(relative) {
  const old = baseline && join(baseline, "web", relative);
  return old && existsSync(old) ? old : join(root, "web", relative);
}
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  const relative = path === "/" ? "index.html" : path.slice(1);
  if (relative.includes("..")) { response.writeHead(404).end(); return; }
  const file = servedFile(relative);
  if (!existsSync(file)) { response.writeHead(404).end(); return; }
  let body = readFileSync(file);
  if (relative === "index.html") body = body.toString()
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
    .replace(/<link[^>]+rel="(?:modulepreload|preload)"[^>]*>/g, "");
  // A static fixture must not be replaced by the wallet's scheduled full-page renderer.
  if (relative === "app-loop.js") body = body.toString()
    .replace("export function render() {", "export function render() { return;");
  if (extra[path]) body = body.toString() + "\nexport { " + extra[path] + " };\n";
  response.writeHead(200, { "Content-Type": types[relative.split(".").pop()] || "text/plain",
    "Cache-Control": "no-store" }).end(body);
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = "http://127.0.0.1:" + server.address().port;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE,
  headless: true });
const context = await browser.newContext({ reducedMotion: "reduce" });
const checks = [], screens = [], errors = [];
await context.route("**/*", (route) => new URL(route.request().url()).origin === origin
  ? route.continue() : route.abort());
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));

async function fixture(scene) {
  await page.goto(origin);
  await page.evaluate(async (scene) => {
    const { state, ui } = await import("/app-state.js");
    const { el } = await import("/app-dom.js");
    const wallet = await import("/app-wallet.js");
    const pay = await import("/sol/payview.js");
    const g = { id: "privacy-display-fixture", name: "Synthetic wallet", n: 3, t: 2,
      version: 2, network: "testnet" };
    Object.assign(state, { g, gid: g.id, groups: [g], wallet: {
      address: "Sample address", orchard_fvk: "synthetic-viewing-key",
    } });
    const app = document.querySelector("#app");
    document.querySelector(".side").style.display = "none";
    document.querySelector(".shell").style.gridTemplateColumns = "minmax(0,1fr)";
    app.replaceChildren(el("p", { class: "small muted" },
      "Synthetic presentation fixture · No funds or signing"));
    const c = { host: { el, state, localSeats: () => [] }, sync: {}, chain: {} };
    const act = () => () => {};
    const actions = { propose() {} };
    const zecReview = async () => {
      const mismatch = scene.endsWith("mismatch");
      const payees = [{ to: "utest1synthetic", amount: 500000, memo: "" }];
      (await import("/app-engine.js")).setZ({ normalizeAddress: (a) => a,
        inspect: () => JSON.stringify({ fee: 10000, standard_fee: 10000,
          lines: [{ kind: "output", who: mismatch ? "utest1different" : payees[0].to,
            value: 500000, memo_status: "empty" }] }),
      });
      ui.sendReview = { prep: { gid: g.id, payees, t: { amount: 500000,
        pczt: "synthetic-" + scene } }, note: "" };
      app.append((await import("/app-send.js")).reviewDialog());
    };
    const scenes = { "zec-review": zecReview, "zec-review-mismatch": zecReview,
      assets() {
      const balance = { spendable: 123456789, pending: 2345678, sending: 0,
        height: 4500000, tip: 4500000 };
      app.append(el("h1", {}, "Wallet privacy"), el("div", { class: "assets-grid" },
        wallet.zecAsset({ bal: balance }), wallet.solAsset(), wallet.usdcAsset()));
      app.querySelectorAll(".asset-note").forEach((n) => { n.open = true; });
    }, async receive() {
      app.append((await import("/app-send.js")).receiveDialog());
      app.querySelectorAll(".qr,.addr-full").forEach((n) => n.remove());
    }, solana() {
      app.append(el("h1", {}, "Solana Devnet"), el("div", { class: "card card-pad" },
        pay.sendForm(c, act, actions), pay.withdrawForm(c, act, actions)));
    }, deposit() {
      app.append(el("h1", {}, "Add SOL · Solana Devnet"),
        el("div", { class: "card card-pad" }, pay.addSolCard(c, act, actions)));
    }, async "receive-sol"() {
      app.append(el("h1", {}, "Receive SOL · Solana Devnet"),
        el("section", { class: "card card-pad" },
          (await import("/sol/view.js")).keyBlock(c, { pda: "00".repeat(32),
            groupKey: "Synthetic group key",
              pdaAddress: "Synthetic destination · do not deposit" })));
    }, review() {
      app.append(el("h1", {}, "Review SOL payments"), ...["approve", "withdraw"].map((kind) =>
        el("section", { class: "card card-pad" }, pay.reviewHero(c, { id: kind }, {
          intent: { kind }, said: { paid: [{ amount: 5000000n }], withdrawn: 5000000n },
        }))));
    }, activity() {
      app.append(el("h1", {}, "Activity"), el("div", { class: "card" }, wallet.receivedRow({
        height: 4500000, txid: "a".repeat(64), value: 123456789, confirmed: true, memos: [],
      })));
    }, async states() {
      const { privacyBadge, solBalancePrivacy } = await import("/privacy-language.js");
      app.append(el("h1", {}, "Privacy states"), el("div", { class: "card card-pad" },
        ...["shielded", "public", "partial", "unknown", "unsupported"].map((role) =>
          privacyBadge(el, role))));
      for (const state of ["none", "setup", "loading", "failed", "differs", "stopped",
        "unknown", "unavailable", "unsynced", "syncing", "synced", "saved", "stale", "resync"])
        app.append(el("p", { "data-state": state }, state + ": ", solBalancePrivacy(el, {
          state })));
    } };
    await scenes[scene]();
    app.querySelectorAll("button,input").forEach((n) => { n.disabled = true; });
  }, scene);
}

async function frames(scene) {
  for (const width of [390, 1440]) for (const theme of ["dark", "light"])
    await frame(scene, width, theme);
}

async function privacyChecks(scene) {
  if (phase === "before") return;
  if (scene === "states") {
    assert.equal(await page.locator("[data-state] .privacy-shielded").count(), 0,
      "no Solana balance state implies Zcash-style shielding");
    for (const state of ["none", "setup", "loading", "failed", "differs", "stopped", "unknown"])
      assert.equal(await page.locator('[data-state="' + state + '"] .privacy-unknown').count(), 1,
        state + " is explicitly unknown, never private or public");
  }
  if (scene === "zec-review-mismatch") {
    assert.equal(await page.locator(".privacy-shielded").count(), 0);
    assert.equal(await page.getByRole("button", { name: "Propose payment",
      exact: true }).count(), 0);
  }
  if (scene === "zec-review") assert.equal(await page.locator(".privacy-shielded").count(), 1);
  if (scene === "assets") {
    assert.equal(await page.locator("[aria-labelledby=asset-usdc] .privacy-shielded").count(), 0,
      "USDC has no verified shielding");
    assert.equal(await page.locator("[aria-labelledby=asset-sol] .privacy-unsupported").count(), 1,
      "SOL unavailable fixture: " + await page.locator("#app").innerText());
  }
  checks.push({ scene, privacySemantics: "pass" });
}

async function contrast() {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    const rgb = (value) => {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    const bg = (node) => {
      if (!node) return [255, 255, 255];
      const c = rgb(getComputedStyle(node).backgroundColor), behind = bg(node.parentElement);
      return c.slice(0, 3).map((n, i) => n * c[3] / 255 + behind[i] * (1 - c[3] / 255));
    };
    const luminance = (c) => c.slice(0, 3).map((n) => n / 255)
      .map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
      .reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
    return [...document.querySelectorAll(".privacy-badge,.privacy-notice>p")].map((n) => {
      const a = luminance(rgb(getComputedStyle(n).color)), b = luminance(bg(n));
      return { text: n.textContent, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
  });
}

async function frame(scene, width, theme) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
  await page.evaluate(() => document.fonts.ready);
  const facts = await page.evaluate(() => ({ width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    privacy: [...document.querySelectorAll(".privacy-badge")].map((n) => n.textContent),
  }));
  assert.ok(facts.scroll <= facts.width + 1, scene + " overflow " + width + " " + theme);
  const ratios = await contrast();
  assert.ok(ratios.every((r) => r.ratio >= 4.5), scene + " privacy text contrast");
  checks.push({ scene, width, theme, ...facts, contrast: ratios });
  const file = scene + "-" + width + "-" + theme + ".png";
  await page.screenshot({ path: join(output, file), fullPage: true, animations: "disabled" });
  screens.push("visuals/privacy/" + phase + "/" + file);
}

async function edgeChecks() {
  if (phase === "before") return;
  await fixture("solana");
  await page.setViewportSize({ width: 320, height: 900 });
  const input = page.locator("#sol-send-to");
  await input.evaluate((n) => { n.disabled = false; });
  await input.focus();
  await page.keyboard.type("Synthetic destination " + "long-name-".repeat(12));
  const value = await input.inputValue();
  await frame("keyboard-long-name", 320, "light");
  assert.equal(await input.inputValue(), value, "theme changes preserve the recipient input");
  assert.equal(await input.getAttribute("aria-describedby"), "sol-send-privacy");
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  checks.push({ keyboardRecipientPreserved: true, focusOutline: focus });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await frame("forced-colors", 320, "dark");
  await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
  await page.locator(".privacy-badge,.privacy-notice>p").evaluateAll((nodes) => {
    for (const n of nodes) n.style.fontSize = parseFloat(getComputedStyle(n).fontSize) * 2 + "px";
  });
  await frame("privacy-text-200-percent", 320, "light");
  assert.equal(await page.locator(".privacy-badge").first().evaluate((n) =>
    n.getAnimations({ subtree: true }).length), 0,
      "privacy state never animates ahead of verification");
}

try {
  for (const scene of ["assets", "receive", "solana", "review", "activity", "deposit",
    "receive-sol", "zec-review", "zec-review-mismatch",
    ...(phase === "after" ? ["states"] : [])]) {
    await fixture(scene);
    await privacyChecks(scene);
    await frames(scene);
  }
  await edgeChecks();
} catch (error) { errors.push(error.message); }
finally {
  await browser.close();
  await new Promise((done) => server.close(done));
  writeFileSync(join(root, "docs/ux-redesign/privacy-" + phase + "-validation.json"),
    JSON.stringify({ phase, checks, screens, errors,
      scope: "Real presentation renderers, synthetic state, no wallet boot or service calls." },
    null, 2) + "\n");
  console.log(JSON.stringify({ phase, checks: checks.length, errors }));
  if (errors.length) process.exitCode = 1;
}
