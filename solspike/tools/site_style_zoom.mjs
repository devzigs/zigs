// Actual Chrome page zoom in disposable profiles; regular browser preferences are untouched.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  overviewFixture,
  settleOverview,
} from "../harness/overview-redesign-fixture.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const out = resolve(process.env.ZIGS_STYLE_OUTPUT || "solspike/.state/site-style-review");
await mkdir(out, { recursive: true });
const results = [];
for (const zoom of [1, 2]) {
  const profile = await mkdtemp(join(tmpdir(), "zigs-wallet-style-zoom-"));
  let context;
  try {
    await mkdir(join(profile, "Default"));
    await writeFile(
      join(profile, "Default", "Preferences"),
      JSON.stringify({
        partition: {
          default_zoom_level: { x: Math.log(zoom) / Math.log(1.2) },
        },
      }),
    );
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      viewport: null,
      executablePath: process.env.CHROME_EXECUTABLE,
      args: ["--window-size=1440,1000"],
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    await overviewFixture(context, page);
    await page.evaluate(async () => {
      const { state, ui } = await import("/app-state.js");
      state.g = null;
      state.gid = null;
      ui.tab = "overview";
      (await import("/app-loop.js")).draw();
    });
    await page
      .getByRole("button", { name: "How Zigs works", exact: true })
      .first()
      .click();
    await page.getByRole("dialog", { name: "How Zigs works" }).waitFor();
    for (const mode of ["Explore the journeys", "Complete guide"]) {
      await page.getByRole("button", { name: mode, exact: true }).click();
      await settleOverview(page);
      const facts = await page.evaluate(() => {
        const content = document.querySelector(".home-how-content");
        const close = document
          .querySelector('[aria-label="Close How Zigs works"]')
          .getBoundingClientRect();
        return {
          innerWidth,
          innerHeight,
          outerWidth,
          overflow: content.scrollWidth > content.clientWidth + 1,
          closeVisible: close.top >= 0 && close.bottom <= innerHeight,
        };
      });
      assert.ok(
        Math.abs(facts.outerWidth / facts.innerWidth - zoom) < 0.05,
        "real browser page zoom changes the CSS viewport",
      );
      assert.ok(!facts.overflow, "zoomed guide has no horizontal overflow");
      assert.ok(facts.closeVisible, "dismissal remains reachable at browser zoom");
      results.push({ zoom, mode, ...facts });
      await page.screenshot({
        path: join(
          out,
          `chrome-${zoom * 100}-${mode === "Complete guide" ? "reference" : "journeys"}.png`,
        ),
        animations: "disabled",
      });
    }
    await page.keyboard.press("Escape");
    await page
      .getByRole("dialog", { name: "How Zigs works" })
      .waitFor({ state: "hidden" });
    assert.ok(
      await page
        .getByRole("button", { name: "How Zigs works", exact: true })
        .first()
        .evaluate((node) => node === document.activeElement),
    );
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
}
await writeFile(join(out, "browser-zoom.json"), JSON.stringify(results, null, 2) + "\n");
console.log("site-style: actual Chrome 100% and 200% page zoom passed");
