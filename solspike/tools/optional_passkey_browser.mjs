// No user browser profile or wallet store is opened by this optional-protection matrix.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { entryReady } from "../harness/entry-flow.mjs";
import { acknowledge, button, confirmationChecks, createUnprotected, finishUnprotected,
  joinUnprotected, laterProtection, NEXT, protectionFacts, protectionMatrix,
  protectionPreferences, replacementAndReload } from "../harness/optional-passkey.mjs";
import { settled, WIDTHS } from "../harness/premium-visuals.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const phase = process.env.ZIGS_UI_PHASE || "after";
if (!["before", "after"].includes(phase)) throw Error("Choose before or after");
const origin = "http://localhost:" + (phase === "before" ? "8795" : "8794");
const evidence = process.env.ZIGS_UI_V3 === "1" ? "web-v3" : "web-optional-passkey";
const output = join(ROOT, "docs/ux-redesign/visuals", evidence, phase);
mkdirSync(output, { recursive: true });
const checks = [], errors = [], notes = [], screens = [];
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });
const contexts = [], pages = [];
const qa = { after: phase === "after", check(ok, label) {
  checks.push({ label, pass: !!ok });
  if (!ok) errors.push(label);
}, async capture(page, name) {
  await settled(page);
  const file = "51-" + name + ".png";
  await page.screenshot({ path: join(output, file), animations: "disabled",
    mask: [page.locator(".safety,.qr,.secret-link,input[type=password],input[type=file]")] });
  qa.check(noMetadata(join(output, file)), file + " has no identifying PNG metadata");
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

async function page(unsupported = false) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 },
    colorScheme: "dark", reducedMotion: "reduce" });
  contexts.push(context);
  await context.route("**/*", (route) => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort());
  if (unsupported) await context.addInitScript(() => {
    Object.defineProperty(window, "PublicKeyCredential", { value: undefined });
  });
  const current = await context.newPage();
  current.on("pageerror", (error) => errors.push("Browser error: " + error.name));
  return current;
}

async function unsupportedChoice() {
  const current = await page(true); await entryReady(current, origin);
  await button(current, "Create wallet").click();
  qa.check(await button(current, "Protect this browser").isDisabled()
    && await button(current, NEXT).isDisabled(),
  "unsupported provider neither creates protection nor acknowledges automatically");
  await acknowledge(current, qa);
  qa.check(await current.getByRole("heading", {
    name: "Set the approval threshold", exact: true }).isVisible()
    && !(await protectionFacts(current)).protected,
    "unsupported but healthy browser can explicitly choose the confirmed unprotected path");
  await qa.capture(current, "unsupported-explicit-choice");
}

try {
  const first = await page(); pages.push(first); await entryReady(first, origin);
  await button(first, "Create wallet").click();
  await first.getByRole("heading", { name: "Protect this browser", exact: true }).waitFor();
  await protectionMatrix(first, qa, "protect-step");
  await protectionPreferences(first, qa, "protect-step");
  if (qa.after) {
    await confirmationChecks(first, qa);
    const invite = await createUnprotected(first, qa);
    for (let seat = 2; seat <= 3; seat++) {
      const current = await page(); pages.push(current);
      await joinUnprotected(current, qa, invite, seat);
    }
    await finishUnprotected(pages, qa);
    await replacementAndReload(first, qa);
    await laterProtection(first, qa);
    await unsupportedChoice();
  }
} catch (error) {
  errors.push(error.name + ": " + error.message.split("\n")[0]
    .replace(/\/Users\/[^\s]+/g, "[local path]"));
  console.error(error.stack);
} finally {
  const version = browser.version();
  await Promise.all(contexts.map((context) => context.close())); await browser.close();
  const report = { phase, source: phase === "before" ? "d50e3a4 frozen web assets"
    : "current web assets", browser: "Chromium " + version,
  contexts: "Fresh isolated temporary stores; no user profile or funds", checks, errors, notes,
  screens, widths: WIDTHS,
  themes: ["dark", "light", "system dark", "system light"],
  limitations: ["Virtual WebAuthn provider only; no physical biometrics, device or screen reader.",
    "Real unfunded Zcash ceremony; no funded transaction, live RPC or live Solana proving.",
    "200% text and expanded explanations can scroll internally; content is never clipped."] };
  writeFileSync(join(ROOT, "docs/ux-redesign/" + evidence + "-" + phase
    + "-entry-validation.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ phase, checks: checks.length,
    screenshots: screens.length, errors }));
  if (errors.length) process.exitCode = 1;
}
