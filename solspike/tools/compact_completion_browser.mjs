import { forEachCase } from "../harness/ui-matrix.mjs";
// Production view/CSS with real, unfunded in-memory ZEC/SOL ceremonies from the existing rig.
// Only rendered UI is served to the browser; key material and wallet runtime never leave Node.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, extname } from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { t, gid } = await import("../../web/test/sol-setup.mjs");
const { guidedSetupView } = await import("../../web/app-setup.js");
const { beginGuided, markBackupChecked } = await import("../../web/app-guided-setup.js");
const { walletArtFacts } = await import("../../web/app-wallet-art.js");
const { walletArtEntry } = await import("../../web/wallet-art.js");
const { closeBackup } = await import("../../web/app-backups.js");
const web = resolve("web"), output = resolve("docs/ux-redesign/visuals/compact-completion");
mkdirSync(output, { recursive: true });
const checks = [], facts = [];
const check = (pass, label) => { checks.push({ pass: !!pass, label }); assert.ok(pass, label); };

class Rec extends Node {
  constructor(tag) { super(); Object.assign(this, { tag, kids: [], attrs: {}, style: {},
    on: {}, isConnected: false }); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  addEventListener(type, fn) { this.on[type] = fn; }
  append(...kids) { this.kids.push(...kids); }
}
const text = (node) => node.text ?? node.kids.map(text).join("");
const find = (node, test) => test(node) ? node : (node.kids || []).map((kid) => find(kid,
  test)).find(Boolean);
const all = (node, test) => [...(test(node) ? [node] : []), ...(node.kids || []).flatMap(
  (kid) => all(kid, test))];
const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
function html(node) {
  if (node.text !== undefined) return escape(node.text);
  const attrs = { ...node.attrs, ...(node.className ? { class: node.className } : {}) };
  if (node.tag === "img") Object.assign(attrs, { src: node.src, width: node.width,
    height: node.height, alt: node.alt });
  const head = "<" + node.tag + Object.entries(attrs).map(([k, v]) => " " + k + '="' + escape(
    v) + '"').join("") + ">";
  return head + (node.tag === "img" ? "" : node.kids.map(html).join("") + "</" + node.tag + ">");
}
function tree() {
  const original = globalThis.document;
  globalThis.document = { createElement: (tag) => new Rec(tag),
    createElementNS: (_ns, tag) => new Rec(tag),
    createTextNode: (value) => ({ text: value }), documentElement: { dataset: {} } };
  try { return guidedSetupView(); } finally { globalThis.document = original; }
}
t.state.g.name = "Treasury wallet";
await forEachCase(Object.entries(t.state.seats), async ([i, seat]) => { seat.name =
  "Device " + i; });
t.ui.tab = "overview"; t.setDownloads({ save: async () => false });
beginGuided(gid, { solExpected: true });
await walletArtEntry(walletArtFacts()).ready;
const first = tree();
find(first, (node) => node.attrs?.["data-key"] === "wallet-reveal-continue")?.on.click();
const ready = tree();
check(all(ready, (node) => node.className === "compact-backup-device").length === 6,
  "all three local shares have save rows and optional check rows");
const originalShares = JSON.stringify([1, 2, 3].map((seat) => t.sec(gid, seat)));
await forEachCase([1, 2, 3], async (seat) => {
  const rows = all(ready, (node) => node.attrs?.["data-backup-seat"] === String(seat));
  await forEachCase(["ZEC", "SOL"], async (chain) => {
    const save = find(rows[0], (node) => node.attrs?.["aria-label"] === "Save " + chain +
      " backup");
    await save.on.click({ preventDefault() {}, currentTarget: null });
    check(chain === "ZEC" ? t.ui.backup?.seat === seat
      : t.ui.backup?.words?.title === "Back up the Solana part of device " + seat,
    "Save " + chain + " opens the existing dialog for device " + seat);
    closeBackup();
    find(rows[1], (node) => node.tag === "button" && text(node) === "Check saved " + chain +
      " file").on.click();
    check(t.ui.backup?.check === true && t.ui.backup.seat === seat && t.ui.backup.chain ===
      chain.toLowerCase(),
      "Check " + chain + " opens the existing read-only check for device " + seat);
    closeBackup();
  });
});
check(originalShares === JSON.stringify([1, 2, 3].map((seat) => t.sec(gid, seat))),
  "opening every compact save/check control leaves all key shares unchanged");
const snapshots = { unsaved: html(tree()) };
await t.putSec(gid, 1, { backupSaved: true });
await markBackupChecked(gid, 2, "zec");
await markBackupChecked(gid, 2, "sol");
snapshots.progress = html(tree());
const styles = ["design-system.css", "app.css", "onboarding-refinement.css", "wallet-art.css"];
const resources = new Map(styles.map((file) => ["/" + file, file]));
await forEachCase(["geist-latin", "geist-latin-ext", "geist-mono-latin",
  "geist-mono-latin-ext"], async (name) => { resources.set("/fonts/" + name + ".woff2",
    "fonts/" + name + ".woff2"); });
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const scene = url.pathname.slice(1);
  res.setHeader("Cache-Control", "no-store");
  if (snapshots[scene]) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end((
      "<!doctype html><html lang=\"en\"><meta "
      + "charset=\"utf-8\"><meta name=\"viewport\" "
      + "content=\"width=device-width,initial-scale=1\">"
    )
      + styles.map((file) => '<link rel="stylesheet" href="/' + file + '">').join("")
      + '<body><div class="shell"><aside class="side"></aside><main class="main">' +
      snapshots[scene] + '</main></div></body></html>');
  } else if (resources.has(url.pathname)) {
    res.setHeader("Content-Type", extname(url.pathname) === ".css" ? "text/css" : "font/woff2");
    res.end(readFileSync(resolve(web, resources.get(url.pathname))));
  } else { res.statusCode = 404; res.end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });
const page = await browser.newPage({ reducedMotion: "reduce" });
try {
  await forEachCase(Object.keys(snapshots), async (scene) => {
    await page.goto(origin + "/" + scene);
    check(await page.locator(".guided-header").count() === 1, scene + " renders one setup header");
    await forEachCase([[1366, 768], [1440, 900], [768, 1024], [390, 844], [320, 800]], async ([
      width, height]) => {
      await page.setViewportSize({ width, height });
      await page.reload();
      await forEachCase(["dark", "light"], async (theme) => {
        await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
        await page.evaluate(() => document.fonts.ready);
        const value = await page.evaluate(() => {
          const left = document.querySelector(".setup-wallet-status").getBoundingClientRect();
          const right = document.querySelector(".setup-completion-actions").getBoundingClientRect();
          const actions = [...document.querySelectorAll(".compact-backup-save")].map(
            (node) => node.getBoundingClientRect());
          return { left: left.height, right: right.height,
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
            operable: actions.length === 6 && actions.every((box) => box.width >= 48 &&
              box.height >= 48),
            visible: actions.every((box) => box.bottom <= innerHeight),
            final: document.querySelector(
              ".setup-completion-actions").lastElementChild.lastElementChild.textContent ===
                "Continue to funding" };
        });
        facts.push({ scene, width, theme, ...value });
        check(!value.overflow && value.operable && value.final, scene +
          " accessible compact actions " + width + " " + theme);
        if (width >= 1366) check(value.right <= value.left + 1 && value.visible,
          scene + " all six backups and continuation fit within left-panel height " + width +
            " " + theme);
        if (width < 900) await page.locator(".setup-completion-actions").scrollIntoViewIfNeeded();
        await page.screenshot({ path: resolve(output, scene + "-" + width + "-" + theme +
          ".png") });
        await page.evaluate(() => scrollTo(0, 0));
      });
    });
    await page.getByText("Optional: check saved files", { exact: true }).click();
    check(await page.getByRole("button", { name: "Check saved ZEC file",
      exact: true }).count() === 3
      && await page.getByRole("button", { name: "Check saved SOL file",
        exact: true }).count() === 3,
    scene + " all six optional checks remain available");
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      scene + " expanded checks fit mobile");
    await page.screenshot({ path: resolve(output, scene + "-checks-320.png"), fullPage: true });
    await page.getByText("Optional: check saved files", { exact: true }).click();
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
    await page.evaluate(() => {
      window.qaFonts = [...document.querySelectorAll("body *")]
        .map((node) => [node, node.style.fontSize, getComputedStyle(node).fontSize]);
      for (const [node, , size] of window.qaFonts) node.style.fontSize = parseFloat(size) *
        2 + "px";
    });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      scene + " has no horizontal clipping with forced colors and 200% text");
    await page.locator(".setup-completion-actions").scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, scene + "-preferences-320.png"),
      fullPage: true });
    await page.evaluate(() => { for (const [node,
      size] of window.qaFonts) node.style.fontSize = size; });
    await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
  });
  console.log(JSON.stringify({ checks: checks.length, errors: 0, facts }));
} finally {
  await browser.close(); await new Promise((resolve) => server.close(resolve));
  writeFileSync("docs/ux-redesign/compact-completion-validation.json", JSON.stringify({
    checks, facts }, null, 2) + "\n");
  process.exit(checks.every((item) => item.pass) ? 0 : 1);
}
