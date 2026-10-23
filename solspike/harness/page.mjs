// DOM helpers for a harness page: small scripts run through Runtime.evaluate. The parameters of
// a command are never logged, and an error text goes through redact() before it is thrown.
import { waitFor } from "./chrome.mjs";
import { redact } from "./redact.mjs";

const CLICKABLE =
  "button, a, summary, label, [role=button], [role=tab], input[type=button], input[type=submit]";

/** Runs fn(...args) in the page and returns its value. fn must not use outer variables. */
export async function run(page, fn, ...args) {
  const expression = `(${fn})(...${JSON.stringify(args)})`;
  const res = await page.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) {
    const d = res.exceptionDetails;
    throw new Error(redact(`page script failed: ${d.exception?.description ?? d.text}`));
  }
  return res.result.value;
}

function inPageClick(text, exact, selector) {
  const shown = (e) => e.getClientRects().length > 0;
  const label = (e) => (e.innerText ?? e.value ?? "").trim();
  const items = [...document.querySelectorAll(selector)].filter(shown);
  const hit =
    items.find((e) => label(e) === text) ??
    (exact ? null : items.find((e) => label(e).includes(text)));
  if (!hit) return "missing";
  if (hit.disabled || hit.getAttribute("aria-disabled") === "true") return "disabled";
  hit.scrollIntoView({ block: "center" });
  hit.click();
  return "clicked";
}

/** Clicks the visible button, link or tab with this text (exact match first). Waits for it. */
export async function clickText(page, text, { exact = false, ms = 10000 } = {}) {
  let last = "missing";
  await waitFor(
    async () => (last = await run(page, inPageClick, text, exact, CLICKABLE)) === "clicked",
    ms,
    () => `a clickable "${text}" (${last})`,
  );
}

function inPageSet(selector, value) {
  const el = document.querySelector(selector);
  if (!el) return false;
  if (el.type === "checkbox" || el.type === "radio") el.checked = Boolean(value);
  else el.value = value;
  for (const type of ["input", "change"]) el.dispatchEvent(new Event(type, { bubbles: true }));
  return true;
}

function inPageSelect(selector) {
  const hit = [...document.querySelectorAll(selector)].find((e) => e.getClientRects().length > 0);
  if (!hit) return "missing";
  if (hit.disabled || hit.getAttribute("aria-disabled") === "true") return "disabled";
  hit.scrollIntoView({ block: "center" });
  hit.click();
  return "clicked";
}

/** Clicks the first visible element that matches the CSS selector. Waits for it to be enabled. */
export async function clickSelector(page, selector, { ms = 10000 } = {}) {
  let last = "missing";
  await waitFor(
    async () => (last = await run(page, inPageSelect, selector)) === "clicked",
    ms,
    () => `a clickable ${selector} (${last})`,
  );
}

/**
 * Clicks the first of these visible buttons that is ready (exact text). Waits for one. Returns
 * the text that it clicked.
 */
export async function clickAnyText(page, texts, { ms = 10000 } = {}) {
  let hit = null;
  const tryAll = async () => {
    for (const text of texts) {
      if ((await run(page, inPageClick, text, true, CLICKABLE)) === "clicked") return (hit = text);
    }
    return false;
  };
  await waitFor(tryAll, ms, () => `a clickable ${texts.map((t) => `"${t}"`).join(" or ")}`);
  return hit;
}

/** Sets an input, textarea, select or checkbox and fires input and change. Waits for it. */
export async function setInput(page, selector, value, ms = 10000) {
  await waitFor(() => run(page, inPageSet, selector, value), ms, () => `the field ${selector}`);
}

const hasText = (text) => document.body?.innerText.includes(text) ?? false;

export async function waitForText(page, text, ms = 15000) {
  await waitFor(() => run(page, hasText, text), ms, () => `the text "${text}"`);
}

const ENGINE_READY = "Crypto engine ready (WebAssembly)";
const engineLine = () => document.getElementById("engine-text")?.textContent ?? "";

/**
 * Waits until the engine line says that the engine is ready. The line sits in a closed
 * <details> (Browser status), so innerText does not hold it: this reads its textContent.
 */
export async function waitForEngine(page, ms = 30000) {
  const ready = async () => (await run(page, engineLine)) === ENGINE_READY;
  await waitFor(ready, ms, () => `the engine line "${ENGINE_READY}"`);
}

const popupOpen = () => !!document.querySelector("#privacy-demo-popup[open]");

/**
 * The Tor demo popup opens on the first visit of a page. A person turns it down in two clicks:
 * "Use Standard connection", then "Continue without Tor". Does nothing when it is not open.
 */
export async function closePrivacyPopup(page) {
  if (!(await run(page, popupOpen))) return;
  await clickText(page, "Use Standard connection", { exact: true });
  await clickText(page, "Continue without Tor", { exact: true });
  const closed = async () => !(await run(page, popupOpen));
  await waitFor(closed, 10000, () => "the privacy popup to close");
}

function inPageSol() {
  const out = {};
  for (const el of document.querySelectorAll("[data-sol]")) {
    out[el.dataset.sol] = el.matches("input, textarea, select") ? el.value : el.textContent.trim();
  }
  return out;
}

/** The [data-sol] values of the page: { name: text or input value }. */
export const readSol = (page) => run(page, inPageSol);

// Keeps each blob that the page makes and records an anchor click that has a download name.
// The real click does not run, so no file is written. Blob text is read without fetch(): the
// page policy would block it.
const CAPTURE = `(() => {
  if (window.__zsDownloads) return;
  window.__zsDownloads = [];
  window.__zsPending = [];
  const blobs = new Map();
  const make = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (obj) => { const u = make(obj); blobs.set(u, obj); return u; };
  const real = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (!this.hasAttribute("download")) return real.call(this);
    const blob = blobs.get(this.href);
    const entry = { name: this.getAttribute("download"), type: blob ? blob.type : "", text: null };
    window.__zsDownloads.push(entry);
    window.__zsPending.push(blob ? blob.text().then((t) => { entry.text = t; }) : 0);
  };
})()`;

/** Installs the capture in this document and in every later one. */
export async function captureDownloads(page) {
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: CAPTURE });
  await page.send("Runtime.evaluate", { expression: CAPTURE });
}

/** The captured downloads { name, type, text } since the last call. */
export const takeDownloads = (page) =>
  run(page, () =>
    Promise.all(window.__zsPending.splice(0)).then(() => window.__zsDownloads.splice(0)),
  );
