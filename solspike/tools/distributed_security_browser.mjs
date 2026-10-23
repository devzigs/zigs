import { forEachCase } from "../harness/ui-matrix.mjs";
// Isolated presentation QA. No wallet store, keys, funds or protocol operations.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const phase = process.argv[2] || "after";
assert.ok(["before", "after"].includes(phase));
const baseline = process.env.ZIGS_SECURITY_BASELINE;
if (phase === "before") assert.ok(baseline,
  "Set ZIGS_SECURITY_BASELINE to the saved initial presentation sources");
const output = join(root, "docs/ux-redesign/visuals/distributed-security", phase);
mkdirSync(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });
const context = await browser.newContext({ reducedMotion: "reduce" });
const errors = [], checks = [], screenshots = [];
const check = (ok, label) => checks.push({ pass: !!ok, label });
function presentationFile(path) {
  const saved = ["/app-tutorial.js", "/app-wallet.js", "/app.css"].includes(path)
    && baseline ? join(baseline, path) : "";
  return phase === "before" && saved && existsSync(saved) ? saved : join(root, "web", path);
}
await context.route("**/*", async route => {
  const url = new URL(route.request().url());
  if (url.origin !== "http://security.invalid") return route.abort();
  const path = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = presentationFile(path);
  if (!existsSync(file)) return route.abort();
  let body = readFileSync(file);
  if (path === "/index.html") body = body.toString().replace(
    /<script[^>]*>[\s\S]*?<\/script>/g, "");
  const contentType = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
    ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml",
      ".wasm": "application/wasm" }[extname(file)];
  return route.fulfill({ body, contentType });
});
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.stack));
async function render(screen, width, theme, stress = false, suffix = "") {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto("http://security.invalid/");
  await page.evaluate(async ({ screen, theme, after, stress }) => {
    document.documentElement.dataset.theme = theme;
    const { setupArrangement } = await import("/app-tutorial.js");
    const { el } = await import("/app-dom.js");
    document.querySelector(".shell").style.display = "none";
    const host = el("main", { id: "security-qa" });
    document.body.append(host);
    host.style.padding = "24px 16px";
    const labels = { name: "Sample shared wallet", label: stress ?
      "Everyday device with a very long recognizable label" : "Everyday device" };
    let diagram = setupArrangement(stress ? 7 : 3, stress ? 4 : 2, "rule", labels);
    async function recoveryDiagram() {
      if (after) {
        const { distributedSecurity } = await import("/app-security.js");
        return distributedSecurity({ n: stress ? 7 : 3, t: stress ? 4 : 2,
          devices: stress ? [] : ["Everyday device", "Second device", "Reserve device"].map(
            (label, i) => ({ label, detail: "Device " + (i + 1) })),
          walletName: labels.name });
      } else return el("p", { class: "small muted" }, (
        "Device names are labels. Address checks and the "
        + "existing approval rule remain authoritative."
      ));
    }
    if (screen === "recovery") diagram = await recoveryDiagram();
    host.className = "page " + (screen === "setup" ? "guided-plan" : "security-recovery-page");
    host.style.maxWidth = "1000px";
    host.style.marginInline = "auto";
    host.replaceChildren(el("p", { class: "label" }, "Presentation sample · no funds or signing"),
      el("h1", {}, screen === "setup" ? "Set the approval threshold" : "Security"),
        diagram);
    host.querySelector("h1").style.lineHeight = "1.2";
    host.firstChild.style.lineHeight = "1.6";
    if (stress) {
      const sizes = [...host.querySelectorAll("*")].map(n => [n, parseFloat(getComputedStyle(
        n).fontSize)]);
      sizes.forEach(([n, size]) => n.style.fontSize = size * 2 + "px");
    }
    await document.fonts.ready;
  }, { screen, theme, after: phase === "after", stress });
  await page.evaluate(() => new Promise(done => requestAnimationFrame(
    () => requestAnimationFrame(done))));
  const facts = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth >
    innerWidth + 1,
    moving: document.querySelector("#security-qa").getAnimations({ subtree: true }).some(
      a => a.playState === "running"),
    text: document.querySelector("#security-qa").textContent,
    nodes: document.querySelectorAll(".security-node").length }));
  check(!facts.overflow, `${screen} ${width} ${theme}${stress ? " stress" : ""}: no page overflow`);
  check(!facts.moving, `${screen} ${width} ${theme}: static diagram`);
  if (phase === "after") {
    const nonOperational = new RegExp("not.*payment approval|not.*live approval|"
      + "examples, not real approvals", "i");
    check(nonOperational.test(facts.text), screen +
      ": explicit non-operational meaning");
    check(/complete spending key/.test(facts.text), screen + ": spending-key explanation");
    check(facts.nodes === (stress ? screen === "setup" ? 7 : 0 : 3), screen +
      ": actual supplied node count");
  }
  const name = `${screen}-${width}-${theme}${stress ? "-stress" : ""}${suffix}.png`;
  await page.screenshot({ path: join(output, name), fullPage: true, animations: "disabled" });
  screenshots.push("visuals/distributed-security/" + phase + "/" + name);
}
try {
  await forEachCase(["setup", "recovery"], async (screen) => { await forEachCase([390, 1440],
    async (width) => { await forEachCase(["dark", "light"], async (theme) => { await render(
      screen, width, theme); }); }); });
  if (phase === "after") {
    await forEachCase(["setup", "recovery"], async (screen) => { await render(screen, 320,
      "light", true); });
    await page.emulateMedia({ forcedColors: "active" });
    await render("setup", 390, "dark", false, "-forced-colors");
    await page.emulateMedia({ forcedColors: "none", reducedMotion: "no-preference" });
    await render("recovery", 390, "dark", false, "-standard-motion");
    const updates = await page.evaluate(async () => {
      const { setupArrangement, updateSetupIllustrations } = await import("/app-tutorial.js");
      const { distributedSecurity } = await import("/app-security.js");
      const { el } = await import("/app-dom.js");
      const form = el("form", {}, el("input", { id: "g-name", value: "Sample wallet renamed" }),
        el("input", { id: "my-name", value: "Sample device renamed" }), setupArrangement(3, 2));
      const host = document.querySelector("#security-qa"); host.replaceChildren(form);
      const field = form.querySelector("#my-name"); field.focus();
      updateSetupIllustrations(form, 4, 3, true);
      const updated = form.querySelector(".setup-arrangement");
      const facts = { count: updated.querySelectorAll(".security-node").length,
        rule: updated.textContent.includes("Any 3 of 4"),
        labels: updated.querySelector("[data-preview-wallet]").textContent ===
          "Sample wallet renamed"
          && updated.querySelector("[data-preview-device]").textContent === "Sample device renamed",
        focus: document.activeElement === field,
        inert: !updated.querySelector("button,input,[role=status],[role=alert]"),
        invalid: !distributedSecurity({ n: 3, t: 1 }).querySelector(".security-rule"),
      };
      updateSetupIllustrations(form, 3, 1, false);
      facts.invalidPreview = form.querySelector(".setup-arrangement").getAttribute(
        "data-rule") === "invalid";
      return facts;
    });
    check(updates.count === 4 && updates.rule && updates.labels,
      "existing preview updates preserve device count, rule and edited labels");
    check(updates.focus && updates.inert,
      "diagram updates preserve input focus and add no controls or live status");
    check(updates.invalid && updates.invalidPreview,
      "unsupported rules retain the existing unavailable preview");
  }
  check(!errors.length, "no uncaught browser errors");
  writeFileSync(join(root, "docs/ux-redesign/distributed-security-" + phase + "-validation.json"),
    JSON.stringify({ phase, checks, screenshots, errors, limitations: [(
      "Isolated real presentation components with synthetic "
      + "labels; no live protocol operations."
    )] }, null, 2) + "\n");
  assert.ok(checks.every(c => c.pass), JSON.stringify(checks.filter(c => !c.pass)));
  console.log(`${checks.length} presentation checks passed`);
} finally { await browser.close(); }
