// Private, inert presentation frames for comparison recordings. Never a wallet data export.
import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { assertInertSnapshot, sanitizedSnapshot, SAMPLE_PAGES }
  from "./test-wallet-snapshots.mjs";

const SCENES = new Map([["01-welcome", "welcome"],
  ["06-overview-1440-dark", "overview"], ["premium-review", "review"]]);

async function knownMaterial(page) {
  return page.evaluate(async () => {
    const k = await import("/app-keystore.js"), { state } = await import("/app-state.js");
    const strings = (v) => typeof v === "string" ? [v]
      : v && typeof v === "object" ? Object.values(v).flatMap(strings) : [];
    return [...new Set(strings([k.secrets, k.gkeys, k.vault, state.wallet]))]
      .filter((v) => v.length >= 8);
  });
}

export async function premiumFrame(page, name, sensitive = null) {
  const directory = process.env.ZIGS_PREMIUM_FRAMES_DIR, scene = SCENES.get(name);
  if (!directory || !scene) return;
  if (!isAbsolute(directory)) throw Error("Absolute private frame directory required");
  const material = sensitive || await knownMaterial(page);
  const screen = scene === "welcome" ? "overview" : scene === "review" ? "approvals" : scene;
  const html = await page.evaluate(sanitizedSnapshot, { screen,
    pages: SAMPLE_PAGES, banner: "Synthetic presentation fixture · No funds or signing",
    sensitive: material });
  assertInertSnapshot(html);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, scene + ".html"), html);
}

export async function premiumReview(page, fixture) {
  const sensitive = await knownMaterial(page), preview = await page.context().newPage();
  try {
    await preview.setContent('<!doctype html><html><head><base href="' + page.url()
      + '">' + fixture.styles + '</head><body>' + fixture.html + '</body></html>');
    await premiumFrame(preview, "premium-review", sensitive);
  } finally { await preview.close(); }
}
