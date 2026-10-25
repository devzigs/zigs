import { forEachCase } from "../harness/ui-matrix.mjs";
// Fresh, unfunded browser stores only. Real Zcash formation; no external network calls.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { installAuthenticator } from "../harness/passkey-ui.mjs";
import { entryReady } from "../harness/entry-flow.mjs";
import { settled } from "../harness/premium-visuals.mjs";

const phase = process.env.ZIGS_UI_PHASE || "after";
if (!["before", "after"].includes(phase)) throw Error("Choose before or after");
const origin = process.env.ZIGS_ONBOARDING_ORIGIN || "http://localhost:8794";
const output = resolve("docs/ux-redesign/visuals/onboarding-refinement", phase);
mkdirSync(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME_EXECUTABLE });
const checks = [], errors = [], screens = [], contexts = [], layoutFacts = [];
const artDigests = [];
const check = (pass, label) => { checks.push({ label, pass: !!pass }); if (!pass) errors.push(
  label); };
const button = (p, name) => p.getByRole("button", { name, exact: true });
const viewports = [[1366, 768], [1440, 900], [768, 1024], [390, 844], [320, 800]];

async function page({ artFailures = false } = {}) {
  const c = await browser.newContext({ viewport: { width: 1366, height: 768 },
    httpCredentials: { username: "Synthetic", password: "synthetic-onboarding-only" },
    reducedMotion: "reduce" });
  contexts.push(c);
  if (artFailures) await c.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      return type === "webgl2" ? null : getContext.call(this, type, ...args);
    };
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (name, ...args) => {
      if (name === "zigs-metal-orb-preview-v1") throw new DOMException(
        "Synthetic image-cache refusal", "SecurityError");
      return open(name, ...args);
    };
  });
  await c.route("**/*", (r) => new URL(r.request().url()).origin === origin
    ? r.continue() : r.abort());
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push("Browser error: " + e.name));
  await entryReady(p, origin);
  await p.evaluate(async () => {
    const engine = await import("/app-engine.js");
    engine.setZ({ ...engine.Z, latestHeight: async () => 4500000 });
  });
  return p;
}

async function capture(p, name, animations = "disabled") {
  await settled(p);
  const file = name + ".png";
  await p.screenshot({ path: join(output, file), animations,
    mask: [p.locator((
      ".safety,.safety-quick,.qr,.secret-link,.addr-full,input"
      + "[type=password],input[type=file]"
    ))] });
  screens.push("visuals/onboarding-refinement/" + phase + "/" + file);
}

async function matrixAssertions(p, { scene, width, theme, allowScroll, facts }) {
      if (phase === "after" && width >= 1366 && !allowScroll) {
        check(facts.action, scene + " primary action in viewport " + width + " " + theme);
        // Scrolling is supported; the background landing page's height is not a dialog gate.
      }
      if (phase === "after" && scene.includes("completion")) {
        check(await p.locator(".setup-completion").evaluate((root) => {
          const actions = root.querySelector(".setup-completion-actions");
          const last = actions.lastElementChild;
          const buttons = [...last.querySelectorAll("button")];
          const status = root.querySelector(".setup-wallet-status");
          const ordered = () => !!status && (innerWidth >= 900
            || status.getBoundingClientRect().bottom <= actions.getBoundingClientRect().top + 1);
          return last.classList.contains("row-actions") && buttons.length <= 2
            && buttons[0].textContent === "Open Overview"
            && buttons.slice(1).every((b) => b.textContent === "See the funding demo (no payment)")
            && !!actions.querySelector(".setup-recovery-details")
            && !document.querySelector(".guided-footnote")
            && ordered();
        }), scene + " continuation follows backup details " + width + " " + theme);
      }
}

async function matrix(p, scene, allowScroll = false) {
  await forEachCase(viewports, async ([width, height]) => {
    await p.setViewportSize({ width, height });
    await forEachCase(["dark", "light"], async (theme) => {
      await p.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      await p.evaluate(() => { scrollTo(0, 0); const d = document.querySelector(
        ".dialog"); if (d) d.scrollTop = 0; });
      await settled(p);
      const facts = await p.evaluate(() => {
        const visible = (n) => n.getClientRects().length && getComputedStyle(n).visibility !==
          "hidden";
        const panels = [...document.querySelectorAll(".dialog,.guided-setup")].filter(visible);
        const action = [...document.querySelectorAll("button")].filter(visible).find((n) =>
          n.dataset.key === "create-continue" ||
            new RegExp("^(Copy link|Join as device|Open Overview|"
              + "Continue to backup options|Codes match)$").test(n.textContent));
        const r = action?.getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth > innerWidth + 1
          || panels.some((n) => n.scrollWidth > n.clientWidth + 1),
          action: !r || r.top >= 0 && r.bottom <= innerHeight,
          pageScroll: document.documentElement.scrollHeight > innerHeight + 2,
          dialogScroll: panels.some((n) => n.scrollHeight > n.clientHeight + 2),
          docHeight: document.documentElement.scrollHeight,
          panels: panels.map((n) => [n.className, n.clientHeight, n.scrollHeight]) };
      });
      layoutFacts.push({ scene, width, theme, ...facts });
      check(!facts.overflow, scene + " no horizontal overflow " + width + " " + theme);
      await matrixAssertions(p, { scene, width, theme, allowScroll, facts });
      await capture(p, scene + "-" + width + "-" + theme);
      if (phase === "after" && scene.includes("completion") && width <= 390) {
        await button(p, "Open Overview").scrollIntoViewIfNeeded();
        await capture(p, scene + "-end-" + width + "-" + theme);
      }
    });
  });
  await p.setViewportSize({ width: 1366, height: 768 });
}

async function next(p, label) { await p.waitForTimeout(430); await button(p, label).click(); }

async function arrivalChecks(p) {
  const fingerprint = p.locator(".passkey-fingerprint");
  check(await fingerprint.evaluate((n) => n.getAnimations().some((a) =>
    a.animationName === "setup-arrival-pulse" && a.effect.getTiming().iterations === 1)),
  "protection arrival plays one finite fingerprint pulse");
  check(await p.locator("[data-protection-art=unprotected]").count() === 1
    && await button(p, "Continue to approval rule").isDisabled(),
  "arrival pulse leaves the browser unlocked and continuation gated");
  const restingColor = await fingerprint.evaluate((n) => getComputedStyle(n).color);
  await p.waitForTimeout(750);
  check(await fingerprint.evaluate((n, resting) => {
    const pulse = n.getAnimations().find((a) => a.animationName === "setup-arrival-pulse");
    return pulse?.playState === "running" && getComputedStyle(n).color !== resting;
  }, restingColor), "arrival remains visible through background redraws");
  await capture(p, "01-protection-arrival", "allow");
  const before = await fingerprint.evaluate((n) => n.getAnimations()[0]?.currentTime
    - parseFloat(getComputedStyle(n).animationDelay) * 1000);
  await p.evaluate(async () => (await import("/app-loop.js")).render());
  await settled(p);
  check(await fingerprint.evaluate((n, previous) => {
    const pulse = n.getAnimations().find((a) => a.animationName === "setup-arrival-pulse");
    const elapsed = pulse?.currentTime - parseFloat(getComputedStyle(n).animationDelay) * 1000;
    return elapsed >= previous && elapsed < previous + 300;
  }, before), "ordinary redraw continues the same arrival clock without replay");
  await p.waitForTimeout(1900);
  await p.evaluate(async () => (await import("/app-loop.js")).render()); await settled(p);
  check(await fingerprint.evaluate((n) => !n.classList.contains("motion-passkey-arrival")),
    "finished arrival never replays on a later redraw");
  await p.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await button(p, "Create wallet").click();
  check(await fingerprint.evaluate((n) => n.classList.contains("motion-passkey-arrival")),
    "a newly opened creation dialog has its own single arrival");
  await p.emulateMedia({ reducedMotion: "reduce" });
  await p.waitForFunction(() => !document.querySelector(".motion-passkey-arrival"));
  check(await fingerprint.evaluate((n) => n.getAnimations().length === 0),
    "reduced motion stops the arrival pulse");
  await p.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await button(p, "Create wallet").click();
  check(await fingerprint.evaluate((n) => n.getAnimations().length === 0),
    "reduced-motion arrival stays still from first appearance");
  await p.emulateMedia({ reducedMotion: "no-preference" });
  await p.evaluate(async () => (await import("/app-loop.js")).render());
  check(await fingerprint.evaluate((n) => !n.classList.contains("motion-passkey-arrival")),
    "changing motion preference does not defer and replay arrival");
  await p.emulateMedia({ reducedMotion: "reduce" });
}

async function expandedExplanation(p, kind, diagrams) {
  const detail = p.locator(".setup-" + kind + "-details");
  await detail.locator("summary").click();
  await forEachCase(diagrams, async ([id, count]) => {
    const diagram = detail.locator('[data-explainer-flow="' + id + '"]');
    check(await diagram.locator("ol > li").count() === count
      && (await diagram.locator("figcaption").textContent()).includes(
        "Educational diagram · not live progress")
      && await diagram.locator("[data-motion-watch]").count() === 0,
    id + " has numbered implementation-based educational stages, not live progress");
  });
  if (kind === "threshold") {
    const initial = await p.locator("#g-n").inputValue();
    await forEachCase([2, 3, 7], async (n) => {
      await p.locator("#g-n").fill(String(n));
      check(await detail.locator(".threshold-example-devices > span").count() === n,
        "expanded threshold example follows " + n + " chosen devices");
    });
    await p.locator("#g-n").fill(initial);
  }
  await matrix(p, "expanded-" + kind, true);
  await preferences(p, "expanded-" + kind);
  await forEachCase([1366, 390], async (width) => {
    await p.setViewportSize({ width, height: width === 1366 ? 768 : 844 });
    await p.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    await forEachCase(diagrams, async ([id]) => {
      const diagram = detail.locator('[data-explainer-flow="' + id + '"]');
      await diagram.locator("figcaption").evaluate((n) => n.scrollIntoView({ block: "start" }));
      await capture(p, "expanded-" + id + "-" + width);
      await diagram.locator("li").last().evaluate((n) => n.scrollIntoView({ block: "center" }));
      check(await diagram.locator("li").last().evaluate((n) => {
        const box = n.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= document.querySelector(
          ".dialog-actions").getBoundingClientRect().top + 1;
      }), id + " final stage reachable above sticky actions at " + width);
      if (width === 390) await capture(p, "expanded-" + id + "-end-" + width);
    });
  });
  await detail.locator("summary").click();
  await p.setViewportSize({ width: 1366, height: 768 });
  await p.locator(".dialog").evaluate((n) => { n.scrollTop = 0; });
}

async function protectionStates(p) {
  await p.emulateMedia({ reducedMotion: "no-preference" });
  await p.evaluate(() => {
    window.__qaCreate = navigator.credentials.create;
    navigator.credentials.create = () => new Promise((_resolve, reject) => {
       window.__qaReject = reject; });
  });
  await button(p, "Protect this browser").click();
  await p.locator("[data-protection-art=pending]").waitFor();
  check(await p.locator(".passkey-art-caption").innerText().then((t) => !t.includes("secured")),
    "pending authentication does not claim protection");
  await capture(p, "02-passkey-pending");
  await p.evaluate(() => window.__qaReject(new DOMException("Synthetic cancellation",
    "NotAllowedError")));
  await button(p, "Protect this browser").waitFor();
  check(await p.locator("[data-protection-art=unprotected]").count() === 1,
    "cancelled authentication leaves the visual unlocked");
  check(await button(p, "Continue to approval rule").isDisabled(),
    "cancellation never enables continuation");
  check(await p.locator(".motion-passkey-arrival").count() === 0,
    "cancellation never replays the arrival pulse");
  await capture(p, "02-passkey-cancelled");
  await p.evaluate(() => { navigator.credentials.create = window.__qaCreate; });
  await p.locator("#banner-close").click();
}

async function qrChecks(p, link) {
  check(await p.locator(".qr,.secret-link").count() === 0,
    "invitation secret stays hidden until requested");
  await p.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await button(p, "Copy link").click();
  check(await p.evaluate(async (expected) => await navigator.clipboard.readText() ===
    expected, link),
    "Copy link copies the actual complete invitation");
  await button(p, "Copy invite message").click();
  check(await p.evaluate(async (expected) => (await navigator.clipboard.readText()).includes(
    expected), link),
    "Copy invite message includes the real invitation");
  const geometry = () => p.locator(".setup-two-columns").boundingBox();
  const before = await geometry(), scroll = await p.evaluate(() => scrollY);
  await button(p, "Show QR code").click();
  const dialog = p.locator(".setup-qr-dialog"); await dialog.waitFor();
  const after = await geometry();
  check(Object.keys(before).every((k) => Math.abs(before[k] - after[k]) <= 1)
    && scroll === await p.evaluate(() => scrollY),
      "QR modal preserves layout geometry and page scroll");
  check(await p.locator(".guided-setup").getAttribute("inert") !== null,
    "QR modal makes the background inert");
  check(await p.evaluate(async (expected) => {
    const { qrSvg } = await import("/qr.js");
    const fixture = document.createElement("div"); fixture.innerHTML = qrSvg(expected, "Expected");
    return fixture.querySelector("path").getAttribute("d")
      === document.querySelector(".setup-qr-dialog .qr path").getAttribute("d");
  }, link), "QR encodes the actual invitation using the existing encoder");
  await p.keyboard.press("Tab");
  check(await p.evaluate(() => !!document.activeElement.closest(".setup-qr-dialog")),
    "Tab stays in the modal");
  await p.keyboard.press("Shift+Tab");
  check(await p.evaluate(() => !!document.activeElement.closest(".setup-qr-dialog")),
    "Shift+Tab stays in the modal");
  await capture(p, "06-invitation-qr");
  for (const width of [320, 390, 768]) {
    await p.setViewportSize({ width, height: 844 });
    check(await dialog.evaluate((n) => n.scrollWidth <= n.clientWidth + 1
      && n.getBoundingClientRect().left >= 0 && n.getBoundingClientRect().right <= innerWidth),
    "QR modal stays within viewport at " + width);
    await capture(p, "06-invitation-qr-" + width);
  }
  await p.setViewportSize({ width: 1366, height: 768 });
  await p.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
  check(await button(p, "Show QR code").evaluate((n) => n === document.activeElement),
    "Escape restores the QR trigger focus");
  await p.evaluate(() => {
    window.__qaClipboard = navigator.clipboard.writeText;
    navigator.clipboard.writeText = async () => { throw Error("Synthetic denial"); };
  });
  await button(p, "Copy link").click(); await dialog.waitFor();
  check(await dialog.locator("textarea").inputValue() === link,
    "clipboard failure opens a selectable private-link fallback");
  await button(p, "Close invitation QR code").click();
  await button(p, "Copy invite message").click(); await dialog.waitFor();
  check((await dialog.locator("textarea").inputValue()).includes(link),
    "invite-message fallback preserves the actual message");
  await p.keyboard.press("Escape");
  await p.evaluate(() => { navigator.clipboard.writeText = window.__qaClipboard; });
  await button(p, "Show QR code").click();
  await p.evaluate(async () => (await import("/app-groups.js")).openGroup(null));
  await dialog.waitFor({ state: "hidden" });
  await p.locator("[data-key^=wallet-row-]").first().click();
  await button(p, "Show QR code").waitFor();
  check(await dialog.count() === 0,
    "leaving and reopening setup does not reopen a stale secret overlay");
}

async function preferences(p, scene) {
  await p.setViewportSize({ width: 320, height: 800 });
  await p.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  check(await p.evaluate(() => !document.getAnimations().some((a) => a.playState === "running")),
    scene + " reduced motion has no running animations");
  await capture(p, scene + "-forced-colors");
  await p.emulateMedia({ forcedColors: "none" });
  await p.evaluate(() => {
    window.__qaText = [...document.querySelectorAll("body *")]
      .map((n) => [n, n.style.fontSize, getComputedStyle(n).fontSize]);
    for (const [n, , size] of window.__qaText) n.style.fontSize = parseFloat(size) * 2 + "px";
  });
  check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1
    && [...document.querySelectorAll(".dialog")].every((n) => n.scrollWidth <= n.clientWidth + 1)),
  scene + " 200% text has no horizontal overflow");
  await capture(p, scene + "-double-text");
  await p.evaluate(() => { for (const [n, value] of window.__qaText) if (n.isConnected)
    n.style.fontSize = value; });
  await p.setViewportSize({ width: 1366, height: 768 });
}

async function createProtection(p) {
  if (phase === "after") {
    await p.emulateMedia({ reducedMotion: "no-preference" });
    await p.locator(".logo").hover(); await settled(p);
    check(await p.locator(".nav-zebra").evaluate((node) =>
      new URL(node.querySelector("img").src).pathname === "/logo.png"
      && node.getAnimations({ subtree: true }).every((a) =>
        a.effect.getTiming().iterations !== Infinity)),
    "navigation keeps the canonical zebra and has no looping decorative animation");
  }
  await button(p, "Create wallet").click();
  if (phase === "after") await arrivalChecks(p);
  await matrix(p, "01-protection");
  if (phase === "after") {
    await preferences(p, "01-protection");
    await expandedExplanation(p, "protection", [["protect", 6], ["unlock", 4]]);
    await protectionStates(p);
  }
  await installAuthenticator(p);
  await button(p, "Protect this browser").click();
  await p.waitForFunction(async () => (await import("/app-keystore.js")).passkeyProtected());
  await capture(p, "02-passkey-secured");
  await p.locator("#banner-close").click();
  await next(p, "Continue to approval rule");
  if (phase === "after") {
    await p.locator("#g-n").fill("7");
    await matrix(p, "03-seven-devices", true);
    check(await p.locator(".threshold-layout .security-node").count() === 7,
      "seven-device illustration matches the real form value");
  }
}

async function createIdentity(p) {
  await next(p, "Use this arrangement");
  await p.locator("#g-name").fill("Treasury wallet");
  await p.locator("#my-name").fill("Everyday device");
  await matrix(p, "04-device");
  if (phase === "after") await preferences(p, "04-device");
  if (phase === "after") {
    const testnet = await p.locator(".setup-network-choice label.net-opt").boundingBox();
    const mainnet = await p.locator(".setup-network-unavailable").boundingBox();
    check(Math.abs(testnet.width - mainnet.width) <= 1 && Math.abs(testnet.height -
      mainnet.height) <= 1
      && Math.abs(testnet.y - mainnet.y) <= 1,
        "Testnet and unavailable Mainnet tiles have equal dimensions and alignment");
  }
}

async function create(p, n = 2) {
  await createProtection(p);
  await p.locator("#g-n").fill(String(n));
  if (n === 2) await p.locator("#g-margin-ack").check();
  await matrix(p, "03-threshold");
  if (phase === "after") {
    await preferences(p, "03-threshold");
    await expandedExplanation(p, "threshold", [["formation", 6], ["zec-signing", 6], [
      "sol-signing", 6]]);
  }
  await createIdentity(p);
  await next(p, "Continue");
  await matrix(p, "05-review");
  if (phase === "after") await preferences(p, "05-review");
  await p.locator(".setup-network-review details summary").click();
  await p.locator("#g-sol").uncheck();
  await p.waitForTimeout(430); await p.locator("[data-key=create-continue]").click();
  await p.getByRole("heading", { name: "Connect your second device", exact: true }).waitFor();
  await matrix(p, "06-invitation");
  if (phase === "after") await preferences(p, "06-invitation");
  const link = await p.evaluate(async () => (await import("/app-links.js"))
    .inviteLink((await import("/app-state.js")).state.gid));
  if (phase === "after") await qrChecks(p, link);
  return link;
}

async function joinDevice(p, link, seat) {
  await p.goto(link);
  await p.getByRole("heading", { name: "Join Treasury wallet", exact: true }).waitFor();
  await p.evaluate(async () => {
    const engine = await import("/app-engine.js");
    engine.setZ({ ...engine.Z, latestHeight: async () => 4500000 });
  });
  await matrix(p, "07-join");
  if (phase === "after") await preferences(p, "07-join");
  await button(p, "Skip for now").click();
  await button(p, "Continue without protection").click();
  await p.locator("#seat-name").fill("Device " + seat);
  await button(p, "Join as device " + seat).click();
}

async function savedBackupCheck(p) {
  check(await button(p, "Open Overview").isEnabled(),
    "zero backup files do not block Overview");
  await button(p, "Save ZEC backup").click();
  const passphrase = "synthetic local recovery check 4728 only";
  await p.locator("#bk-pass").fill(passphrase); await p.locator("#bk-again").fill(passphrase);
  const pending = p.waitForEvent("download");
  await button(p, phase === "before" ? "Encrypt and save" : "Encrypt and save file").click();
  const file = await pending, path = await file.path();
  await p.locator(".dialog").waitFor({ state: "hidden" });
  check(await p.locator(".setup-completion-actions").innerText().then((t) => t.includes(
    "Saved, not checked")),
    "a saved download does not claim a checked recovery file");
  await p.getByText("Optional: check saved files", { exact: true }).click();
  await button(p, "Check saved ZEC file").click();
  const fingerprint = () => p.evaluate(async () => {
    const { state } = await import("/app-state.js"), { localSeats } = await import("/app-seats.js");
    const share = (await import("/app-keystore.js")).sec(state.gid, localSeats()[0]);
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(
      share)));
    return Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, "0")).join("");
  });
  const before = await fingerprint();
  await p.locator("#bc-file").setInputFiles(path); await p.locator("#bc-pass").fill(
    "wrong synthetic passphrase");
  await button(p, "Check saved file").click();
  await p.getByRole("alert").filter({ hasText: "could not be opened" }).waitFor();
  check(before === await fingerprint(),
    "wrong backup passphrase leaves the signing share unchanged");
  await p.locator("#bc-file").setInputFiles(path); await p.locator("#bc-pass").fill(passphrase);
  await button(p, "Check saved file").click(); await p.locator(".dialog").waitFor({
    state: "hidden" });
  check(before === await fingerprint(),
    "checking the correct saved file never restores or changes shares");
  check(await p.locator(".setup-completion-actions").innerText().then((t) => t.includes(
    "Saved and checked here")),
    "the completion view distinguishes a locally checked copy");
  await capture(p, "10-backup-checked");
  await button(p, "See the funding demo (no payment)").click();
  await p.getByRole("heading", { name: "Funding checkout demo.", exact: true }).waitFor();
  check(await p.locator("#funding-include-name").count() === 1,
    "optional naming shares the creator's funding checkout");
  await button(p, "Finish later").click();
  await p.getByRole("heading", { name: "Your assets", exact: true }).waitFor();
}

async function finishPrepared(p) {
  await button(p, "Open Overview").click();
  await p.getByRole("heading", { name: "Your assets", exact: true }).waitFor();
}

async function marbleReveal(pages, scene, full = false) {
  for (const p of pages) await p.getByRole("heading", { name: "Meet your new wallet", exact: true })
    .waitFor({ timeout: 90000 });
  check(await Promise.all(pages.map((p) => p.evaluate(async () => {
    const { guidedState } = await import("/app-guided-setup.js");
    return guidedState().complete && (await import("/app-dkg.js")).myVerified();
  }))).then((values) => values.every(Boolean)),
    "marble reveal follows actual verified preparation on every device");
  const first = pages[0];
  if (!full) {
    await first.emulateMedia({ reducedMotion: "reduce" });
    check(await first.locator(".wallet-reveal").evaluate((n) => !n.classList.contains(
      "wallet-reveal-playing")),
      "live reduced motion settles the new-wallet reveal immediately");
    await first.emulateMedia({ reducedMotion: "no-preference" });
    await first.evaluate(async () => (await import("/app-loop.js")).render()); await settled(first);
    check(await first.locator(".wallet-reveal").evaluate((n) => !n.classList.contains(
      "wallet-reveal-playing")),
      "removing reduced motion does not replay a settled wallet reveal");
    const third = pages[2];
    await third.evaluate(() => {
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    check(await third.locator(".wallet-reveal").evaluate((n) => !n.classList.contains(
      "wallet-reveal-playing")),
      "hidden documents settle the code-to-marble effect");
    await third.evaluate(async () => {
      delete document.hidden; document.dispatchEvent(new Event("visibilitychange"));
      (await import("/app-loop.js")).render();
    }); await settled(third);
    check(await third.locator(".wallet-reveal").evaluate((n) => !n.classList.contains(
      "wallet-reveal-playing")),
      "returning to a visible document does not replay the reveal");
  }
  if (full) {
    await first.waitForTimeout(250); await capture(first, "13-marble-code", "allow");
    const started = await first.locator(".wallet-reveal").evaluate(
      (n) => n._walletRevealVisit.started);
    await first.evaluate(async () => (await import("/app-loop.js")).render()); await settled(first);
    check(await first.locator(".wallet-reveal").evaluate(
      (n, value) => n._walletRevealVisit.started === value
      && parseFloat(n.style.getPropertyValue("--wallet-reveal-offset")) < 0, started),
    "code-to-marble timeline continues across background redraws without restarting");
    const elapsed = await first.locator(".wallet-reveal").evaluate((n) => performance.now() -
      n._walletRevealVisit.started);
    await first.waitForTimeout(Math.max(0, 3400 - elapsed));
    await capture(first, "13-marble-forming", "allow");
    await first.waitForTimeout(2800); await capture(first, "13-marble-revealed", "allow");
  }
  for (const p of pages) await p.waitForFunction(() => !!document.querySelector(
    ".wallet-reveal-orb img")?.dataset.artDigest);
  const digests = await Promise.all(pages.map((p) => p.locator(
    ".wallet-reveal-orb img").getAttribute("data-art-digest")));
  check(new Set(digests).size === 1, "independent devices show the same address-derived marble");
  artDigests.push(digests[0]);
  check(await first.evaluate(async (digest) => {
    const { state } = await import("/app-state.js");
    const { describeWalletIdentity } = await import("/dev/metal-orbs/wallet-identity.js");
    const p = await describeWalletIdentity({ zcash: { address: state.wallet.address,
      network: state.wallet.network, verified: true }, name: "Another name",
        device: "Another device", solana: false });
    return p.digest === digest;
  }, digests[0]), (
    "production art matches the verified-address contract, "
    + "independent of name or Solana"
  ));
  check(await Promise.all(pages.map((p) => button(p, "Continue to backup options").isEnabled()))
    .then((values) => values.every(Boolean)), "backup options never wait for artwork or animation");
  if (full) {
    await first.emulateMedia({ reducedMotion: "reduce" });
    await matrix(first, scene); await preferences(first, scene);
    await first.locator(".wallet-art-explanation summary").click();
    await first.setViewportSize({ width: 320, height: 800 });
    check(await first.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      "expanded marble explanation fits a 320px viewport");
    await capture(first, "13-marble-explanation-320");
    await first.locator(".wallet-art-explanation summary").click();
    await first.setViewportSize({ width: 1366, height: 768 });
  }
  for (const [i, p] of pages.entries()) {
    await button(p, "Continue to backup options").click();
    await p.getByRole("heading", { name: "Your wallet is prepared", exact: true }).waitFor();
    check(await p.locator(".setup-status-wallet img").getAttribute("data-art-digest") ===
      digests[i],
      "completion reuses its marble after dismissing the reveal");
  }
}

async function artworkOverview(p, expected) {
  await p.waitForFunction(() => !!document.querySelector(
    ".overview-wallet-summary img")?.dataset.artDigest);
  check(await p.locator(".overview-wallet-summary img").getAttribute("data-art-digest") ===
    expected,
    "Overview reuses the same wallet marble");
  check(await p.locator(".wallet-topbar img").first().getAttribute("data-art-digest") === expected,
    "wallet header or switcher uses the same marble");
  await p.locator('.overview-action-picker').filter({ has: p.locator('summary', {
    hasText: "Receive" }) }).locator("summary").click();
  await p.locator(".overview-action-picker[open]").getByRole("button", { name: /^ZEC/ }).click();
  await p.getByRole("heading", { name: "Receive ZEC", exact: true }).waitFor();
  check(await p.locator(".wallet-receive-art img").getAttribute("data-art-digest") === expected,
    "Receive uses the wallet marble without changing its actual address");
  await p.locator(".dialog").evaluate((n) => { n.scrollTop = 0; });
  await capture(p, "14-marble-receive");
  await matrix(p, "14-marble-receive", true); await preferences(p, "14-marble-receive");
  await p.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await p.locator(".overview-action-picker[open] summary").click();
  await capture(p, "14-marble-overview");
  await matrix(p, "14-marble-overview", true); await preferences(p, "14-marble-overview");
}

async function openWalletMenu(p) {
  const menu = p.locator("#wallet-menu");
  if (await menu.getAttribute("aria-expanded") !== "true") await menu.click();
}

async function threeDevices(first) {
  const previous = await first.evaluate(async () => (await import("/app-state.js")).state.gid);
  await button(first, "Return home").click(); await button(first, "Create another").click();
  await next(first, "Continue to approval rule");
  await next(first, "Use this arrangement");
  await first.locator("#g-name").fill("Treasury wallet"); await next(first, "Continue");
  await first.locator(".setup-network-review details summary").click(); await first.locator(
    "#g-sol").uncheck();
  await first.waitForTimeout(430); await first.locator("[data-key=create-continue]").click();
  await button(first, "Show QR code").waitFor();
  const link = await first.evaluate(async () => (await import("/app-links.js"))
    .inviteLink((await import("/app-state.js")).state.gid));
  const second = await page({ artFailures: true }); await joinDevice(second, link, 2);
  check(await second.locator("[data-device-seat='2'].setup-device-pending").count() === 1,
    "the actual joining device has a green active marker while the remaining device joins");
  await capture(second, "11-active-second-device");
  const third = await page(); await joinDevice(third, link, 3);
  let releaseRenderer;
  const rendererGate = new Promise((resolve) => { releaseRenderer = resolve; });
  await third.route("**/dev/metal-orbs/renderer.js", async (route) => {
    await rendererGate; await route.continue();
  });
  const pages = [first, second, third];
  for (const p of pages) await p.locator(".safety").waitFor();
  const numbers = await Promise.all(pages.map((p) => p.locator(".safety").textContent()));
  check(new Set(numbers).size === 1 && numbers.every((s) => /^\d{5}(?: \d{5}){5}$/.test(s)),
    "three independent devices retain all six groups of the actual safety number");
  await button(second, "Codes don’t match").click();
  await button(second, "Keep checking").waitFor();
  check(await button(second, "Keep checking").isVisible(),
    "a mismatch requires the existing explicit stop confirmation");
  await button(second, "Keep checking").click();
  check(await button(second, "Codes match").isDisabled(), "cancelling a mismatch confirms no code");
  check(await first.locator(".wallet-reveal").count() === 0,
    "joined devices and matching-code prompts do not reveal an unprepared wallet");
  await first.emulateMedia({ reducedMotion: "no-preference" });
  await third.emulateMedia({ reducedMotion: "no-preference" });
  for (const p of pages) { await p.locator("#safety-full").check(); await button(p,
    "Codes match").click(); }
  await marbleReveal(pages, "15-three-device-marble");
  check(await second.locator(".setup-status-wallet img").getAttribute("data-art-state") === "svg",
    "WebGL and image-cache failure preserve a deterministic marble and backup access");
  check(await third.locator(".setup-status-wallet img").getAttribute("data-art-state") === "svg"
    && await button(third, "Open Overview").isEnabled(),
    (
      "a deliberately delayed renderer never blocks the "
      + "reveal dismissal or existing completion controls"
    ));
  releaseRenderer();
  await matrix(first, "12-three-device-completion");
  check(await first.locator(".setup-device-row").count() === 3
    && await first.locator(".setup-device-pending").count() === 0,
      "completion shows three actual devices and stops active pulses");
  for (const p of pages) await finishPrepared(p);
  check(true, "real unfunded 2-of-3 formation opens Overview with zero backups on every device");
  check(artDigests[0] !== artDigests[1],
    "two actual wallets with the same name have different marbles");
  check(await first.locator(".wallet-context img[data-art-digest]").count() === 2,
    "the actual sidebar wallet choices show both verified wallet marbles");
  await capture(first, "15-marble-sidebar");
  for (const width of [390, 320]) {
    await first.setViewportSize({ width, height: 844 }); await settled(first);
    await openWalletMenu(first);
    check(await first.locator(".side").evaluate((n) => n.scrollWidth <= n.clientWidth + 1
      && n.getBoundingClientRect().right <= innerWidth), "wallet navigation fits at " + width);
    await capture(first, "15-marble-sidebar-" + width);
  }
  await first.setViewportSize({ width: 1366, height: 768 });
  await first.locator('[data-key="wallet-' + previous + '"]').click();
  await first.waitForFunction(async (id) => (await import("/app-state.js")).state.gid === id,
    previous);
  check(await first.locator(".wallet-context-header img").first()
    .getAttribute("data-art-digest") ===
    artDigests[0],
    "switching wallets selects the original marble");
  check(await first.locator(".wallet-reveal").count() === 0,
    "returning to a completed wallet never reopens its reveal");
  await button(first, "Return home").click();
  await first.locator(".wallet-vault-card").first().waitFor();
  check(await first.locator(".wallet-vault-card img[data-art-digest]").count() === 2,
    "the actual wallet collection reuses both verified marbles");
  await matrix(first, "16-wallet-marbles", true);
}

try {
  const first = await page(), link = await create(first);
  const second = await page(); await joinDevice(second, link, 2);
  const pages = [first, second];
  for (const p of pages) await p.locator(".safety").waitFor();
  await matrix(first, "08-verification");
  if (phase === "after") await preferences(first, "08-verification");
  const codes = await Promise.all(pages.map((p) => p.locator(".safety").innerText()));
  check(codes[0] === codes[1] && codes[0].replace(/\D/g, "").length === 30,
    "actual independent devices show the same complete 30-digit number");
  check(await first.locator(".wallet-reveal,[data-art-digest]").count() === 0,
    "unverified setup shows no unique marble or completion reveal");
  await first.emulateMedia({ reducedMotion: "no-preference" });
  for (const p of pages) {
    const action = button(p, phase === "before" ? "It matches" : "Codes match");
    check(await action.isDisabled(), "matching requires acknowledgement on each device");
    await p.locator("#safety-full").check(); await action.click();
  }
  if (phase === "after") await marbleReveal(pages, "13-wallet-marble", true);
  else for (const p of pages) await p.getByRole("heading", { name: "Your wallet is prepared",
    exact: true })
    .waitFor({ timeout: 90000 });
  await matrix(first, "09-completion");
  if (phase === "after") {
    await preferences(first, "09-completion");
    await savedBackupCheck(first); await artworkOverview(first,
      artDigests[0]); await threeDevices(first);
  }
} catch (e) {
  errors.push(e.name + ": " + e.message.split("\n")[0].replace(/\/Users\/[^\s]+/g, "[local path]"));
  console.error(e.message);
} finally {
  await Promise.all(contexts.map((c) => c.close())); await browser.close();
  const report = { phase, browser: "Chromium",
    contexts: "Isolated unfunded stores; real Zcash formation",
    viewports, checks, layoutFacts, screens, errors };
  writeFileSync("docs/ux-redesign/onboarding-refinement-" + phase + "-validation.json",
    JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ phase, checks: checks.length, screenshots: screens.length,
    errors }));
  if (errors.length) process.exitCode = 1;
}
