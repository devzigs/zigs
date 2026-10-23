// Isolated visual proof of actual decorative lighting. No wallet fixtures or external requests.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { entryReady } from "../harness/entry-flow.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.ZIGS_HOME_ORIGIN || "http://127.0.0.1:55847";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const output = resolve("docs/ux-redesign/visuals/cinematic-homepage/motion");
const temporary = resolve(output, ".temporary-video");
mkdirSync(temporary, { recursive: true });
const report = { checks: [], facts: [], videos: [], errors: [], notes: [
  "Live recordings show entrance, ambient lighting and pointer response without playback controls.",
  "Labelled phase stills seek the actual presenter clock for visual comparison.",
  "Local Chromium observations are not production hardware or network performance claims.",
] };
const check = (pass, name) => report.checks.push({ pass: !!pass, name });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });

async function fresh(width, options = {}) {
  const context = await browser.newContext({ viewport: { width, height: width < 768 ? 844 : 900 },
    colorScheme: "dark", reducedMotion: "no-preference", ...options });
  await context.route("**/*", (r) => new URL(r.request().url()).origin === origin
    ? r.continue() : r.abort());
  await context.addInitScript(() => {
    window.__sceneDraws = 0;
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      const context = original.call(this, type, ...args);
      if (type !== "webgl" || !context || !this.classList.contains("home-hero-lighting"))
        return context;
      const draw = context.drawArrays.bind(context);
      context.drawArrays = (...values) => { window.__sceneDraws++; return draw(...values); };
      return context;
    };
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => report.errors.push(e.name + ": " + e.message));
  return { context, page };
}

async function open(page) {
  await entryReady(page, origin + "/");
  await page.waitForSelector(".home-scene-live");
  await page.evaluate(async () => document.fonts.ready);
}

async function record(width, name) {
  const size = { width, height: width < 768 ? 844 : 900 };
  const { context, page } = await fresh(width, { hasTouch: width < 768,
    recordVideo: { dir: temporary, size } });
  const video = page.video();
  try {
    await open(page); await page.waitForTimeout(16000);
    const box = await page.locator(".welcome-brand").boundingBox();
    if (width >= 768) {
      for (const [x, y] of [[.28,.32],[.82,.26],[.72,.73],[.36,.57]]) {
        await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 24 });
        await page.waitForTimeout(320);
      }
      await page.mouse.move(280, 65); await page.waitForTimeout(400);
    }
    check(await page.locator(".home-motion-toggle").count() === 0,
      name + " has no playback button");
    check(await page.locator(".home-hero-lighting").count() === 1,
      name + " has one lighting canvas");
    report.facts.push({ recording: name, draws: await page.evaluate(() => window.__sceneDraws),
      canvas: await page.locator(".home-hero-lighting").evaluate((c) => [c.width, c.height]),
      size });
  } finally {
    await context.close();
    const file = await video.path(); renameSync(file, resolve(output, name + ".webm"));
    report.videos.push(name + ".webm");
  }
}

function stripMetadata(file) {
  const data = readFileSync(file), parts = [data.subarray(0, 8)];
  for (let at = 8; at + 12 <= data.length;) {
    const end = at + data.readUInt32BE(at) + 12;
    if (["IHDR", "IDAT", "IEND", "PLTE", "tRNS"].includes(data.toString("ascii", at + 4, at + 8)))
      parts.push(data.subarray(at, end));
    at = end;
  }
  writeFileSync(file, Buffer.concat(parts));
}

async function phaseStills() {
  const { context, page } = await fresh(1440);
  try {
    await open(page);
    for (const [name, time, x, y] of [["arrival", 350, 0, 0], ["settled", 1500, 0, 0],
      ["ambient-left", 5000, 0, 0], ["ambient-right", 12000, 0, 0],
      ["pointer-left", 4000, -.85, -.25], ["pointer-right", 4000, .85, .25]]) {
      const geometry = await page.evaluate(async ({ time, x, y }) => {
        const controller = (await import("/homepage-motion.js")).startHomepageMotion(document);
        controller.paused = true; controller.stop(); controller.elapsed = time;
        controller.current.pointer = { x, y }; controller.draw(controller.current);
        return document.querySelector(".home-hero-art").getBoundingClientRect().toJSON();
      }, { time, x, y });
      report.facts.push({ phase: name, time, pointer: { x, y }, geometry });
      const file = resolve(output, name + ".png");
      await page.screenshot({ path: file }); stripMetadata(file);
    }
    const boxes = report.facts.filter((f) => f.phase).map((f) => JSON.stringify(f.geometry));
    check(new Set(boxes).size === 1, "all lighting phases preserve identical portrait geometry");
  } finally { await context.close(); }
}

async function pixelProof() {
  const { context, page } = await fresh(1440);
  try {
    await open(page);
    const stats = await page.evaluate(async () => {
      const { createHeroScene, sceneSample } = await import("/homepage-scene.js");
      const scene = createHeroScene(document.querySelector(".home-hero-art")); scene.resize(320, 1);
      const gl = scene.canvas.getContext("webgl"), samples = [];
      for (const [time, x] of [[1500,0],[5000,0],[12000,0],[4000,-1],[4000,1]]) {
        scene.draw(sceneSample(time, { x, y: 0 }));
        const pixels = new Uint8Array(320 * 320 * 4);
        gl.readPixels(0, 0, 320, 320, gl.RGBA, gl.UNSIGNED_BYTE, pixels); samples.push(pixels);
      }
      let moving = 0, alphaChanges = 0, eyeChanges = 0, eyePixels = 0, maxDifference = 0;
      for (let i = 0; i < samples[0].length; i += 4) {
        const first = samples[0];
        const eye = Number(first[i] > 75 && first[i] > first[i + 1] * 2.5);
        eyePixels += eye;
        for (const next of samples.slice(1)) {
          const difference = Math.max(...[0,1,2].map((k) => Math.abs(first[i+k] - next[i+k])));
          maxDifference = Math.max(maxDifference, difference);
          moving += Number(difference > 8);
          alphaChanges += Number(first[i+3] !== next[i+3]);
          eyeChanges += eye * Number(difference > 2);
        }
      }
      scene.dispose();
      return { moving, alphaChanges, eyeChanges, eyePixels, maxDifference };
    });
    report.facts.push({ pixelProof: stats });
    check(stats.moving > 1000 && stats.maxDifference > 25,
      "lighting changes pixels visibly over time");
    check(stats.alphaChanges === 0, "all phases preserve the source silhouette/transparency");
    check(stats.eyePixels > 0 && stats.eyeChanges === 0, "red eye remains unlit and stable");
  } finally { await context.close(); }
}

async function lifecycle() {
  const { context, page } = await fresh(390);
  try {
    await open(page); await page.waitForTimeout(300);
    const before = await page.evaluate(() => window.__sceneDraws);
    await page.evaluate(async () => (await import("/app-loop.js")).render());
    await page.waitForSelector(".home-scene-live"); await page.waitForTimeout(350);
    check(await page.evaluate(() => window.__sceneDraws) > before,
      "lighting continues across routine redraws");
    check(await page.locator(".home-motion-toggle").count() === 0,
      "homepage has no pause or resume control");
    await page.evaluate(() => {
      const spacer = document.createElement("div"); spacer.id = "scene-test-spacer";
      spacer.style.height = "1800px"; document.body.append(spacer); scrollTo(0, 1700);
    });
    await page.waitForTimeout(160);
    const offscreen = await page.evaluate(() => window.__sceneDraws);
    await page.waitForTimeout(400);
    check(await page.evaluate(() => window.__sceneDraws) === offscreen,
      "offscreen scene stops rendering");
    await page.evaluate(() => {
      scrollTo(0, 0); document.getElementById("scene-test-spacer").remove();
    });
    await page.waitForTimeout(300);
    check(await page.evaluate(() => window.__sceneDraws) > offscreen,
      "visible scene resumes lighting");
    await page.emulateMedia({ reducedMotion: "reduce" });
    try {
      await page.waitForFunction(() => !document.querySelector(".home-hero-lighting"),
        null, { polling: 100, timeout: 3000 });
    } catch (error) {
      report.facts.push({ reducedCleanup: await page.evaluate(async () => {
        const c = (await import("/homepage-motion.js")).startHomepageMotion(document);
        return { media: c.media.map((m) => m.matches), hidden: document.hidden,
          scene: !!c.current?.scene, canvases:
            document.querySelectorAll(".home-hero-lighting").length };
      }) });
      throw error;
    }
    check(await page.locator(".home-hero-lighting").count() === 0,
      "reduced motion releases the renderer");
    check(await page.locator(".home-hero-art").evaluate((n) => getComputedStyle(n).opacity === "1"),
      "reduced motion shows the original static poster");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForSelector(".home-scene-live");
    await page.locator(".home-hero-lighting").evaluate((c) =>
      c.getContext("webgl").getExtension("WEBGL_lose_context").loseContext());
    await page.waitForTimeout(150);
    check(await page.locator(".home-hero-lighting").count() === 0
      && await page.locator(".home-motion-toggle").count() === 0,
    "context loss restores a usable still");
    check(await page.getByRole("button", { name: "Create wallet", exact: true }).isEnabled(),
      "renderer failure never disables wallet entry");
  } finally { await context.close(); }
}

async function unavailable() {
  const { context, page } = await fresh(1440);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      return type === "webgl" ? null : original.call(this, type, ...args);
    };
  });
  try {
    await page.goto(origin + "/"); await page.waitForSelector(".home-hero-art");
    await page.waitForTimeout(300);
    check(await page.locator(".home-hero-lighting").count() === 0,
      "unavailable WebGL creates no canvas");
    check(await page.locator(".home-motion-toggle").count() === 0,
      "unavailable motion exposes no dead control");
    check(await page.getByRole("button", { name: "Create wallet", exact: true }).isEnabled(),
      "unavailable WebGL preserves existing actions");
    const file = resolve(output, "webgl-unavailable.png"); await page.screenshot({ path: file });
    stripMetadata(file);
  } finally { await context.close(); }
}

try {
  if (process.env.ZIGS_SCENE_RECORD !== "0") {
    await record(1440, "desktop-motion"); console.log("Desktop live recording complete");
    await record(390, "mobile-motion"); console.log("Mobile live recording complete");
  }
  await phaseStills(); await pixelProof(); await lifecycle(); await unavailable();
  check(report.errors.length === 0, "no runtime exceptions");
} catch (error) { report.errors.push(error.message.split("\n").slice(0, 4).join(" ")); }
finally {
  await browser.close(); rmdirSync(temporary);
  writeFileSync(resolve(output, "validation.json"), JSON.stringify(report, null, 2) + "\n");
}
const failures = report.checks.filter((c) => !c.pass);
console.log(JSON.stringify({ checks: report.checks.length, failed: failures,
  errors: report.errors, videos: report.videos }, null, 2));
assert.equal(report.errors.length, 0); assert.ok(report.checks.every((c) => c.pass));
