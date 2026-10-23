// Empty live UI and inert sample comparisons. Never opens a user-owned browser profile or tab.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { layout, SAMPLE_ROUTES, sampleMatrix, settled, welcomeInteraction, welcomeMatrix,
  welcomePreferences, WIDTHS } from "../harness/premium-visuals.mjs";
import { securitySample } from "../harness/security-explainers.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const phase = process.env.ZIGS_PREMIUM_PHASE || "after";
const part = process.env.ZIGS_PREMIUM_PART || "all";
const evidence = process.env.ZIGS_PREMIUM_EVIDENCE || "web-premium";
const engine = process.env.ZIGS_VISUAL_ENGINE || "chromium";
if (!["chromium", "webkit"].includes(engine)) throw Error("Choose chromium or webkit");
const variant = engine === "webkit" ? "/webkit" : "";
if (!["before", "after"].includes(phase) || !["welcome", "samples", "all"].includes(part))
  throw Error("Choose before/after and welcome/samples/all.");
if (!["web-premium", "web-art-direction", "web-compact-overview", "web-entry-flow",
  "web-security-explainers", "web-optional-passkey", "web-v3"]
  .includes(evidence))
  throw Error("Unknown evidence set");
const origin = "http://localhost:" + (phase === "before" ? "8795" : "8794");
const samples = process.env.ZIGS_PREMIUM_SAMPLE_DIR || (phase === "before"
  ? "/private/tmp/zigs-premium-sample-before" : join(ROOT, "solspike/.state/test-wallet-preview"));
if (!isAbsolute(samples)) throw Error("Sample source directory must be absolute.");
const output = join(ROOT, "docs/ux-redesign/visuals", evidence, phase + variant);
const reportFile = join(ROOT, "docs/ux-redesign/" + evidence + "-" + phase
  + (engine === "webkit" ? "-webkit" : "") + "-visual-validation.json");
mkdirSync(output, { recursive: true });
const engines = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await engines[engine].launch({ headless: true,
  executablePath: engine === "chromium" ? process.env.CHROME_EXECUTABLE : undefined });
const checks = [], notes = [], screens = [], errors = [];

function pngHasNoMetadata(file) {
  const bytes = readFileSync(file), denied = new Set(["tEXt", "zTXt", "iTXt", "eXIf"]);
  let at = 8;
  while (at + 12 <= bytes.length) {
    if (denied.has(bytes.toString("ascii", at + 4, at + 8))) return false;
    at += bytes.readUInt32BE(at) + 12;
  }
  return at === bytes.length;
}

function stripPngMetadata(file) {
  const bytes = readFileSync(file), chunks = [bytes.subarray(0, 8)];
  const allowed = new Set(["IHDR", "IDAT", "IEND", "PLTE", "tRNS"]);
  let at = 8;
  while (at + 12 <= bytes.length) {
    const end = at + bytes.readUInt32BE(at) + 12;
    if (allowed.has(bytes.toString("ascii", at + 4, at + 8)))
      chunks.push(bytes.subarray(at, end));
    at = end;
  }
  writeFileSync(file, Buffer.concat(chunks));
}

const qa = {
  after: phase === "after",
  v3: evidence === "web-v3",
  webkit: engine === "webkit",
  notes,
  art: evidence === "web-art-direction",
  compact: evidence === "web-compact-overview",
  entry: evidence === "web-entry-flow" && phase === "after"
    || evidence === "web-security-explainers" || evidence === "web-optional-passkey"
    || evidence === "web-v3",
  check(ok, label) {
    checks.push({ label, pass: !!ok });
    if (ok) return;
    if (phase === "before") notes.push(label);
    else errors.push(label);
  },
  async capture(page, name) {
    await page.evaluate(() => scrollTo(0, 0)); await settled(page);
    const file = "45-" + name + ".png";
    await page.screenshot({ path: join(output, file), fullPage: true, animations: "disabled",
      mask: [page.locator(".safety,.qr,.secret-link,input[type=password],input[type=file]")] });
    stripPngMetadata(join(output, file));
    qa.check(pngHasNoMetadata(join(output, file)), file + " contains no personal PNG metadata");
    screens.push("visuals/" + evidence + "/" + phase + variant + "/" + file);
  },
  async captureViewport(page, name) {
    await page.evaluate(() => scrollTo(0, 0)); await settled(page);
    const file = "48-" + name + ".png";
    await page.screenshot({ path: join(output, file), animations: "disabled" });
    stripPngMetadata(join(output, file));
    qa.check(pngHasNoMetadata(join(output, file)), file + " contains no personal PNG metadata");
    screens.push("visuals/" + evidence + "/" + phase + variant + "/" + file);
  },
};

async function fresh(sample = false, unsupported = false) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 },
    colorScheme: "dark", reducedMotion: "reduce" });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (sample && url.pathname.startsWith("/__premium_sample__/")) {
      const id = url.pathname.split("/").pop().replace(/\.html$/, "");
      if (!SAMPLE_ROUTES.includes(id)) return route.abort();
      return route.fulfill({ contentType: "text/html", body: readFileSync(join(samples,
        id + ".html")), headers: { "Content-Security-Policy": "default-src 'none'; "
          + "script-src 'none'; connect-src 'none'; style-src 'self' 'unsafe-inline'; "
          + "img-src 'self'; font-src 'self'; form-action 'none'; base-uri 'none'" } });
    }
    if (sample && url.pathname === "/sample.css") return route.fulfill({ contentType: "text/css",
      body: readFileSync(join(samples, "sample.css")) });
    return url.origin === origin ? route.continue() : route.abort();
  });
  if (unsupported) await context.addInitScript(() => {
    Object.defineProperty(window, "PublicKeyCredential", { value: undefined });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push("Uncaught browser error: " + error.name));
  return { context, page };
}

async function emptyReady(page) {
  await page.goto(origin);
  await page.locator(".welcome").waitFor();
  await page.waitForFunction(async () => {
    const engine = await import("/app-engine.js"), groups = await import("/app-groups.js");
    return !!engine.Z && groups.dbReady;
  });
  await settled(page);
}

async function unavailableEntry() {
  const { context, page } = await fresh(false, true);
  try {
    await emptyReady(page);
    await page.getByRole("button", { name: "Create wallet", exact: true }).press("Enter");
    await page.getByRole("dialog").waitFor();
    qa.check(await page.getByRole("button", { name: "Protect this browser", exact: true })
      .isDisabled(), "unsupported browser retains disabled protection control");
    qa.check(await page.getByRole("button", { name: qa.entry
      ? "Continue to approval rule" : "Set up my wallet", exact: true })
      .isDisabled(), "unsupported browser cannot advance into new wallet creation");
    await layout(page, qa, "unsupported browser existing passkey dialog");
  } finally { await context.close(); }
}

async function welcome() {
  const { context, page } = await fresh();
  try {
    await emptyReady(page);
    await welcomeMatrix(page, qa); await welcomePreferences(page, qa);
    await welcomeInteraction(page, qa);
  } finally { await context.close(); }
  await unavailableEntry();
}

async function sampleViews() {
  const { context, page } = await fresh(true);
  try {
    for (const id of SAMPLE_ROUTES) {
      await page.goto(origin + "/__premium_sample__/" + id + ".html");
      await page.locator(".sample-banner").waitFor();
      await sampleMatrix(page, qa, id);
      if (evidence === "web-security-explainers" && phase === "after")
        await securitySample(page, qa, id);
    }
  } finally { await context.close(); }
}

function report() {
  const prior = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, "utf8")) : {};
  return { ...prior, phase, engine, browser: browser.version(), widths: WIDTHS,
    themes: ["dark", "light", "system"],
    systemSchemes: ["dark", "light"], contexts: "Fresh isolated browser contexts only",
    source: "Frozen local assets" + (phase === "before" ? " on8795" : " replaced on8794"),
    sampleRoutes: SAMPLE_ROUTES, limitations: [
      "Sample comparisons are inert captures of real renderers; no live wallet action tested.",
      "No physical device, software keyboard, assistive technology or physical passkey tested.",
      "Live palette checks change CSS theme state; Settings handler/options are tested separately.",
    ], [part]: { checks, notes, screens, errors } };
}

try {
  if (part !== "samples") await welcome();
  if (part !== "welcome") await sampleViews();
} catch (error) {
  console.error(error.stack);
  errors.push(error.message.split("\n")[0].replace(/\/Users\/[^\s]+/g, "[local path]"));
} finally {
  await browser.close();
  writeFileSync(reportFile, JSON.stringify(report(), null, 2) + "\n");
  console.log(JSON.stringify({ phase, part, checks: checks.length, screens: screens.length,
    baselineNotes: notes.length, errors }));
  if (errors.length) process.exitCode = 1;
}
