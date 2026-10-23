// Matching security-education captures, without loading any user-owned browser profile.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { entryReady } from "../harness/entry-flow.mjs";
import { securityPlan } from "../harness/security-explainers.mjs";
import { settled } from "../harness/premium-visuals.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const phase = process.env.ZIGS_UI_PHASE || "after";
if (!["before", "after"].includes(phase)) throw Error("Choose before or after");
const origin = "http://localhost:" + (phase === "before" ? "8795" : "8794");
const evidence = "web-security-explainers";
const output = join(ROOT, "docs/ux-redesign/visuals", evidence, phase);
mkdirSync(output, { recursive: true });
const checks = [], errors = [], notes = [], screens = [];
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });
const qa = { after: phase === "after", check(ok, label) {
  checks.push({ label, pass: !!ok });
  if (!ok) (qa.after ? errors : notes).push(label);
}, async capture(page, name) {
  await page.evaluate(() => scrollTo(0, 0)); await settled(page);
  const file = "50-" + name + ".png";
  await page.screenshot({ path: join(output, file), animations: "disabled",
    mask: [page.locator(".safety,.qr,.secret-link,input[type=password],input[type=file]")] });
  qa.check(noMetadata(join(output, file)), file + " has no personal PNG metadata");
  screens.push("visuals/" + evidence + "/" + phase + "/" + file);
} };

function noMetadata(file) {
  const bytes = readFileSync(file), denied = new Set(["tEXt", "zTXt", "iTXt", "eXIf"]);
  let at = 8;
  while (at + 12 <= bytes.length) {
    if (denied.has(bytes.toString("ascii", at + 4, at + 8))) return false;
    at += bytes.readUInt32BE(at) + 12;
  }
  return at === bytes.length;
}

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 },
    colorScheme: "dark", reducedMotion: "reduce" });
  try {
    await context.route("**/*", (route) => new URL(route.request().url()).origin === origin
      ? route.continue() : route.abort());
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push("Browser error: " + error.name));
    await entryReady(page, origin); await securityPlan(page, qa);
  } finally { await context.close(); }
} catch (error) {
  errors.push(error.message.split("\n")[0].replace(/\/Users\/[^\s]+/g, "[local path]"));
  console.error(error.stack);
} finally {
  const version = browser.version(); await browser.close();
  const report = { phase, source: phase === "before" ? "8791498 frozen assets" : "local web assets",
    browser: "Chromium " + version, contexts: "Isolated temporary stores; no user profile or funds",
    widths: [320, 390, 768, 1024, 1440, 1920],
    palettes: ["dark", "light", "system dark", "system light"], checks, notes, screens, errors,
    limitations: ["Virtual passkey; no physical authenticator or assistive technology tested.",
      "200% text can scroll vertically; no interaction is tied to decoration."] };
  writeFileSync(join(ROOT, "docs/ux-redesign/" + evidence + "-" + phase
    + "-plan-validation.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ phase, checks: checks.length, screenshots: screens.length,
    baselineNotes: notes.length, errors }));
  if (errors.length) process.exitCode = 1;
}
