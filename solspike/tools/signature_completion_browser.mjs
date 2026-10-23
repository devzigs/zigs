import { forEachCase } from "../harness/ui-matrix.mjs";
// Synthetic component QA only. No wallet runtime, stores, credentials or network services.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const phase = process.env.ZIGS_SIGNATURE_PHASE || "after";
assert.ok(["before", "after"].includes(phase));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });
const output = join(root, "docs/ux-redesign/visuals/signature-completion", phase);
mkdirSync(output, { recursive: true });
const origin = "http://signature-fixture.test";
const checks = [], errors = [];
const fixture = (
  "<!doctype html><html lang=\"en\"><head><meta "
  + "charset=\"utf-8\">\n<meta name=\"viewport\" "
  + "content=\"width=device-width,initial-scale=1\">\n<link "
  + "rel=\"stylesheet\" href=\"/design-system.css\"><link "
  + "rel=\"stylesheet\" href=\"/app.css\">\n<style>main{max-width"
  + ":1280px;margin:auto;padding:32px "
  + "20px}header{margin-bottom:24px}\n.cases{display:grid;gri"
  + "d-template-columns:repeat(3,minmax(0,1fr));gap:16px}\n.c"
  + "ase{display:grid;gap:16px;align-content:start;min-width"
  + ":0;padding:24px;\nbackground:var(--panel);border:1px "
  + "solid var(--line);border-radius:var(--r)}\n.case>.case-l"
  + "abel{font:var(--font-label);color:var(--faint)}\n@media("
  + "max-width:760px){.cases{grid-template-columns:1fr}.case"
  + "{padding:20px}}\n</style></head><body><main><header><p "
  + "class=\"label\">Zigs · Synthetic component "
  + "review</p>\n<h1>Signature completion moments</h1><p "
  + "class=\"small muted\">Presentation fixtures · No funds, "
  + "approvals or signing</p>\n</header><div "
  + "class=\"cases\"></div></main></body></html>"
);

async function routeFixture(context) {
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: fixture });
      if (!/^\/(?:[a-z-]+\.(?:js|css)|fonts\/[a-z-]+\.woff2)$/.test(url.pathname))
        return route.abort();
      const ext = url.pathname.split(".").pop();
      return route.fulfill({ contentType: ext === "js" ? "text/javascript"
        : ext === "css" ? "text/css" : "font/woff2",
      body: readFileSync(join(root, "web", url.pathname.slice(1))) });
    });
}

try {
  await forEachCase(["dark", "light"], async (theme) => { await forEachCase([1440, 390, 320],
    async (width) => {
    const context = await browser.newContext({ viewport: { width, height: 1000 },
      colorScheme: theme, reducedMotion: "reduce" });
    await routeFixture(context);
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin);
    await page.evaluate(async ({ phase, theme }) => {
      document.documentElement.dataset.theme = theme;
      const { stageHeadline } = await import("/payment-model.js");
      const outcomes = phase === "after" ? await import("/outcome-seal.js") : null;
      const node = (tag, cls, text) => {
        const n = document.createElement(tag); n.className = cls;
        if (text) n.textContent = text;
        return n;
      };
      const cases = [
        ["Approvals", { approved: true }], ["Submitted", { sent: true }],
        ["Block inclusion", { landed: true }], ["Waiting", {}],
        ["Signing", { signing: true, approved: true }],
        ["Submission uncertain", { sendFailed: true, approved: true }],
        ["Expired", { ended: true, approved: true }],
        ["Rejected", { rejected: true, approved: true }],
        ["Unsynced submission", { sentUnsynced: true, sent: true }],
      ];
      for (const [label, facts] of cases) {
        const section = node("section", "case");
        section.dataset.case = label;
        section.append(node("h2", "case-label", label));
        const status = stageHeadline(facts);
        if (outcomes) section.append(outcomes.outcomePanel(status));
        else {
          const panel = node("div", "pay-status");
          panel.append(node("h3", "", status.title), node("p", "small muted", status.detail));
          section.append(panel);
        }
        document.querySelector(".cases").append(section);
      }
      const section = node("section", "case");
      section.dataset.case = "Setup";
      section.append(node("h2", "case-label", "Wallet setup"));
      const heading = node("h2", phase === "after" ? "outcome-heading" : "");
      heading.append(outcomes ? outcomes.outcomeSeal("setup")
        : node("span", "completion-mark", "✓"), node("span", "", "Your wallet is prepared"));
      section.append(heading, node("p", "small muted", (
        "All 3 devices verified the wallet. Zcash is prepared. "
        + "Use any 2 independent devices together to authorize a "
        + "payment."
      )));
      document.querySelector(".cases").append(section);
    }, { phase, theme });
    await page.evaluate(() => document.fonts.ready);
    const facts = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      running: document.getAnimations().filter((a) => a.playState === "running").length,
      hidden: [...document.querySelectorAll(".outcome-seal")]
        .every((n) => n.getAttribute("aria-hidden") === "true"),
      text: document.querySelector(".cases").textContent,
      panels: [...document.querySelectorAll(".pay-status")].map((n) => ({
        label: n.closest(".case").dataset.case, kind: n.dataset.outcomeKind,
      })),
    }));
    assert.equal(facts.overflow, false, theme + " " + width + " overflow");
    assert.equal(facts.running, 0, "static reduced-motion state");
    if (phase === "after") {
      assert.ok(facts.hidden);
      const kind = (label) => facts.panels.find((p) => p.label === label).kind;
      assert.equal(kind("Approvals"), "threshold");
      assert.equal(kind("Submitted"), "submitted");
      assert.equal(kind("Block inclusion"), "included");
      await forEachCase(["Expired", "Rejected", "Submission uncertain"], async (label) => {
         assert.equal(kind(label), "attention"); });
      assert.equal(kind("Waiting"), "pending");
      assert.equal(kind("Signing"), "pending");
      assert.doesNotMatch(facts.text, /Transaction confirmed|Success|finality/);
      // Rerendering/back navigation has no decorative animation to restart.
      await page.emulateMedia({ reducedMotion: "no-preference" });
      assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
      await page.emulateMedia({ forcedColors: "active" });
      assert.equal(await page.locator(".outcome-seal").first().evaluate((n) =>
        getComputedStyle(n).borderStyle), "solid");
      await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
    }
    const file = theme + "-" + width + ".png";
    if (width !== 320) await page.screenshot({ path: join(output, file), fullPage: true });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
      document.querySelector(".pay-status p").append(
        " Syntheticwalletwithaverylongunbrokendevicename01234567890123456789");
    });
    const largeTextOverflow = await page.evaluate(() => document.documentElement.scrollWidth >
      innerWidth);
    if (phase === "after") assert.equal(largeTextOverflow, false,
      "200% text and long names at " + width);
    checks.push({ theme, width, overflow: false, reducedMotion: "static",
      textScaling: "200%", largeTextOverflow });
    await context.close();
  }); });
  assert.deepEqual(errors, []);
  writeFileSync(join(output, "validation.json"), JSON.stringify({ phase,
    scope: "Synthetic components, not a live transaction or full wallet flow", checks }, null,
      2) + "\n");
  console.log("signature completion: " + phase + ", " + checks.length + " layout cases passed");
} finally { await browser.close(); }
