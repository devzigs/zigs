// Presentation only. These short-lived observations never authorize or advance wallet work.
import { presentExperience } from "./premium-motion.js";
const BRAND_KEY = "zigs-ui-brand-arrived-v1";
const PASSKEY_ARRIVAL_MS = 1800;
const CLASSES = ["motion-content-enter", "motion-dialog-enter", "motion-complete-enter",
  "motion-feedback-enter", "motion-brand-sweep", "motion-brand-arrive", "motion-passkey-arrival"];
const CONTROLS = "button,a[href],input,select,textarea,summary";
const STATIC = ".qr,.qr-toggle,.secret-link,[data-motion-static]";
const NOTICES = ".callout,[role=alert],[role=status],.review-warnings";

const openApproval = (f) => f.status === "collecting" && !f.packaged && !f.error && !f.checking;
/** With no snapshot-ready fact, the first ZEC approval stays settled rather than guessing. */
export function zecApprovalMotionValue(facts, approved) {
  if (facts.pending || !facts.snapshotKnown || !openApproval(facts)) return "unknown";
  return approved ? "on" : "off";
}

function contextKey(identity, layer) {
  const base = ["wallet", "panel", "chat", "contact", "surface"]
    .map((key) => identity[key] ?? "");
  if (!layer) return JSON.stringify(base);
  const name = layer.getAttribute("aria-labelledby") || layer.getAttribute("aria-label") || "layer";
  return JSON.stringify([...base, identity.session ?? "", name]);
}

const unsafeContent = (node) => node.closest(STATIC + ",[hidden],[inert],details:not([open])")
  || node.closest(CONTROLS) || node.querySelector(CONTROLS + "," + STATIC);
const unsafeNotice = (node) => node.matches(NOTICES) || node.querySelector(NOTICES)
  || !node.hasAttribute("data-motion-mark") && node.closest(NOTICES);
const safeNode = (node, document) => !!node?.isConnected && !node.contains(document.activeElement)
  && !unsafeContent(node) && !unsafeNotice(node);

function titleOf(root) {
  const hidden = (node) => node.closest(".sr-only,[hidden],[aria-hidden=true]");
  const explicit = root.querySelector("[data-motion=content],#welcome-title");
  if (explicit && !hidden(explicit)) return explicit;
  return [...root.querySelectorAll("h1,h2")].find((node) => !hidden(node));
}

function feedbackClass(key, before, value) {
  if (key.startsWith("passkey:")) {
    if (value === "verified" && before !== "verified") return "motion-complete-enter";
    return ["pending", "error"].includes(value) && before !== value
      ? "motion-feedback-enter" : null;
  }
  return before === "off" && value === "on" ? "motion-complete-enter" : null;
}

function observations(root) {
  const nodes = [...root.querySelectorAll("[data-motion-watch]")];
  if (root.hasAttribute("data-motion-watch")) nodes.unshift(root);
  return nodes.map((node) => ({ node, key: node.getAttribute("data-motion-watch"),
    value: node.getAttribute("data-motion-value") }));
}

const ownMark = (node) => [...node.querySelectorAll("[data-motion-mark]")]
  .find((mark) => mark.closest("[data-motion-watch]") === node);
const seenSuccess = (old, value) => old?.seen === true || value === "on" || value === "verified";
const mayAnimate = (old, value) => !!old && !(old.seen && value === "on");

function observe(root, previous, add) {
  const next = new Map();
  for (const { node, key, value } of observations(root)) {
    const old = previous.get(key);
    next.set(key, { value, seen: seenSuccess(old, value) });
    if (!mayAnimate(old, value)) continue;
    const motion = feedbackClass(key, old.value, value), mark = ownMark(node);
    if (motion && mark?.getAttribute("aria-hidden") === "true") add(mark, motion);
  }
  return next;
}

function storageFlag(storage) {
  try { return storage?.getItem(BRAND_KEY) === "1"; } catch { return false; }
}

function browserStorage() {
  try { return globalThis.sessionStorage; } catch { return null; }
}

function browserMedia() {
  try { return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)"); }
  catch { return null; }
}

/** Illustrative combinations only. This helper never reads payment or signer state. */
export function approvalExamples(n, t) {
  if (!Number.isInteger(n) || !Number.isInteger(t) || n < 2 || n > 7 || t < 2 || t > n)
    return [];
  const examples = Array.from({ length: Math.min(n, 4) }, (_, start) =>
    Array.from({ length: t }, (_, i) => (start + i) % n));
  return [...examples, examples[0]];
}

function educationFrames(node, mark) {
  if (node.getAttribute("data-education") === "passkey") {
    const fingerprint = mark.getAttribute("data-education-mark") === "fingerprint";
    return fingerprint ? [{ opacity: 0, transform: "translateY(6px)" },
      { opacity: 1, transform: "none", offset: .4 }, { opacity: 1, transform: "none" }]
      : [{ opacity: 0 }, { opacity: 0, offset: .65 }, { opacity: 1 }];
  }
  const [n, t] = node.getAttribute("data-education-value").split(":").map(Number);
  const style = globalThis.getComputedStyle(node);
  const color = style.getPropertyValue("--accent-text").trim();
  const glow = style.getPropertyValue("--accent-edge").trim();
  const selected = Number(mark.getAttribute("data-education-mark"));
  return approvalExamples(n, t).map((group) => ({
    easing: "steps(1, end)",
    boxShadow: group.includes(selected) ? "inset 0 0 0 2px " + color + ",0 0 16px " + glow
      : "inset 0 0 0 2px transparent",
  }));
}

function educationValues(root, previous, animate) {
  const values = new Map();
  for (const node of root.querySelectorAll("[data-education]")) {
    if (node.closest("[hidden]")) continue;
    const key = node.getAttribute("data-education");
    const value = node.getAttribute("data-education-value");
    values.set(key, value);
    if (previous.get(key) !== value) animate(node);
  }
  return values;
}

function animateEducation(node, animations) {
  const approval = node.getAttribute("data-education") === "approval";
  for (const mark of node.querySelectorAll("[data-education-mark]")) {
    if (!mark.animate) continue;
    const frames = educationFrames(node, mark);
    if (!frames.length) continue;
    const animation = mark.animate(frames, {
      duration: approval ? (frames.length - 1) * 1000 : 1800,
      easing: approval ? "linear" : "ease-out", iterations: 1,
    });
    animations.add(animation);
    animation.finished.then(() => animations.delete(animation), () => animations.delete(animation));
  }
}

/** Decorative angles only. They never describe wallet, device or security state. */
export function brandTilt(x, y, width, height) {
  const unit = (value, size) => Math.max(-1, Math.min(1, value / Math.max(1, size) * 2 - 1));
  return { x: -unit(y, height) * 2, y: unit(x, width) * 2 };
}

function bindBrandTilt(plate, allowed) {
  if (!plate?.addEventListener) return null;
  let frame = 0;
  const reset = () => {
    globalThis.cancelAnimationFrame(frame); frame = 0;
    plate.style.removeProperty("--brand-rx"); plate.style.removeProperty("--brand-ry");
  };
  const move = (event) => {
    if (event.pointerType !== "mouse" || !allowed()) return;
    if (!globalThis.matchMedia("(hover:hover) and (pointer:fine)").matches) return;
    if (globalThis.matchMedia("(update:slow)").matches) return;
    globalThis.cancelAnimationFrame(frame);
    frame = globalThis.requestAnimationFrame(() => {
      frame = 0;
      if (!allowed() || !plate.isConnected) return;
      const r = plate.getBoundingClientRect(), angle = brandTilt(event.clientX - r.left,
        event.clientY - r.top, r.width, r.height);
      plate.style.setProperty("--brand-rx", angle.x + "deg");
      plate.style.setProperty("--brand-ry", angle.y + "deg");
    });
  };
  plate.addEventListener("pointermove", move); plate.addEventListener("pointerleave", reset);
  return { reset, destroy: () => {
    reset(); plate.removeEventListener("pointermove", move);
    plate.removeEventListener("pointerleave", reset);
  } };
}

function positionWalletPicker(picker, win) {
  if (!picker) return;
  const box = picker.querySelector("summary").getBoundingClientRect();
  if (box.bottom < 0 || box.top > win.innerHeight) { picker.open = false; return; }
  const panel = picker.querySelector(".wallet-popover");
  const width = Math.min(box.width, win.innerWidth - 32);
  panel.style.setProperty("--picker-width", width + "px");
  const below = win.innerHeight - box.bottom - 24, above = box.top - 24;
  const flip = below < 180 && above > below, space = flip ? above : below;
  const limit = Math.max(48, Math.min(360, space));
  const top = flip ? box.top - 8 - Math.min(panel.scrollHeight, limit) : box.bottom + 8;
  panel.style.setProperty("--picker-left", Math.max(16,
    Math.min(box.left, win.innerWidth - width - 16)) + "px");
  panel.style.setProperty("--picker-top", Math.max(16, top) + "px");
  panel.style.setProperty("--picker-height", limit + "px");
}

/** Native disclosure and existing row handlers; only floating geometry and dismissal are added. */
export function observeWalletPicker(doc) {
  const win = doc?.defaultView;
  if (!win?.addEventListener) return null;
  const current = () => doc.querySelector("#welcome-wallets[open]");
  const measure = () => positionWalletPicker(current(), win);
  const outside = (event) => {
    const picker = current();
    if (picker && !picker.contains(event.target)) picker.open = false;
  };
  const escape = (event) => {
    if (event.key !== "Escape" || doc.querySelector(".dialog,.drawer")) return;
    const picker = current();
    if (!picker) return;
    event.preventDefault(); event.stopPropagation(); picker.open = false;
    picker.querySelector("summary").focus({ preventScroll: true });
  };
  const toggle = (event) => { if (event.target.id === "welcome-wallets") measure(); };
  const resize = win.ResizeObserver ? new win.ResizeObserver(measure) : null;
  const root = doc.getElementById("app");
  if (root) resize?.observe(root);
  doc.addEventListener("toggle", toggle, true);
  doc.addEventListener("pointerdown", outside); doc.addEventListener("focusin", outside);
  doc.addEventListener("keydown", escape);
  win.addEventListener("resize", measure); win.addEventListener("scroll", measure, true);
  return { measure, destroy: () => {
    resize?.disconnect();
    doc.removeEventListener("toggle", toggle, true);
    doc.removeEventListener("pointerdown", outside); doc.removeEventListener("focusin", outside);
    doc.removeEventListener("keydown", escape);
    win.removeEventListener("resize", measure); win.removeEventListener("scroll", measure, true);
  } };
}

/** Isolated galleries can supply their own document, media query and UI-only memory storage. */
export function createMotionController({ document, storage = null, media = null,
  now = () => globalThis.performance.now() }) {
  const active = new Set(), scopes = new Map(), animations = new Set();
  let brandSeen = storageFlag(storage), plateNow = null, tilt = null;
  const stop = (settleArrival = true) => {
    if (settleArrival) for (const scope of scopes.values()) scope.arrivalStarted = null;
    for (const node of active) node.classList.remove(...CLASSES);
    active.clear();
    for (const animation of animations) animation.cancel();
    animations.clear();
    tilt?.reset();
  };
  const allowed = () => !document.hidden && media?.matches !== true;
  const add = (node, name) => {
    if (!allowed() || !safeNode(node, document)) return;
    node.classList.add(name); active.add(node);
  };
  const visibility = () => {
    document.documentElement?.classList.toggle("motion-document-hidden", !!document.hidden);
    if (!allowed()) stop();
  };
  const preference = () => { if (!allowed()) stop(); };
  document.addEventListener("visibilitychange", visibility);
  media?.addEventListener?.("change", preference);
  visibility();
  const education = (node) => {
    if (!allowed() || !node.isConnected || node.closest("[hidden]")) return;
    for (const animation of animations) animation.cancel();
    animations.clear();
    animateEducation(node, animations);
  };
  const brand = (view) => {
    const plate = view.querySelector("[data-motion=brand]");
    if (plate !== plateNow) {
      tilt?.destroy(); plateNow = plate; tilt = bindBrandTilt(plate, allowed);
    }
    if (!plate || brandSeen) return;
    brandSeen = true;
    try { storage?.setItem(BRAND_KEY, "1"); } catch { /* In-memory once-only fallback. */ }
    add(plate, "motion-brand-sweep");
    add(plate, "motion-brand-arrive");
  };
  const part = (root, identity, name) => {
    if (!root) { scopes.delete(name); return; }
    const key = contextKey(identity, name === "layer" ? root : null);
    const { old, changed, previous, illustrations } = scopeHistory(scopes.get(name), key);
    if (changed) add(titleOf(root), name === "layer"
      ? "motion-dialog-enter" : "motion-content-enter");
    const arrival = arrivalState(root, old, changed);
    if (arrival.shown && !arrival.seen && allowed()) arrival.started = now();
    scopes.set(name, { key, values: observe(root, previous, add),
      ...resumeArrival(arrival, now, add),
      illustrations: educationValues(root, illustrations, education) });
  };
  const present = ({ view, layer = null, identity = {} }) => {
    stop(false);
    part(view, identity, "view"); part(layer, identity, "layer");
    if (view) brand(view);
  };
  const liveEducation = (node) => {
    const key = node.getAttribute("data-education");
    const value = node.getAttribute("data-education-value");
    for (const scope of scopes.values()) scope.illustrations.set(key, value);
    education(node);
  };
  const destroy = () => {
    stop(); scopes.clear();
    tilt?.destroy();
    document.removeEventListener("visibilitychange", visibility);
    media?.removeEventListener?.("change", preference);
    document.documentElement?.classList.remove("motion-document-hidden");
  };
  return { present, stop, destroy, education: liveEducation };
}

function scopeHistory(scope, key) {
  const old = scope ?? { values: new Map(), illustrations: new Map() };
  const changed = old.key !== key;
  return { old, changed, previous: changed ? new Map() : old.values,
    illustrations: changed ? new Map() : old.illustrations };
}

function arrivalState(root, old, changed) {
  const node = root.querySelector("[data-passkey-arrival]");
  return { node, shown: !!node && !node.closest("[hidden]"),
    seen: !changed && old.arrivalSeen,
    started: changed ? null : old.arrivalStarted ?? null };
}

function resumeArrival({ node, shown, seen, started }, now, add) {
  const elapsed = started === null ? PASSKEY_ARRIVAL_MS : Math.max(0, now() - started);
  if (shown && elapsed < PASSKEY_ARRIVAL_MS) {
    // A redraw replaces this decorative node: resume the same pulse, never restart its clock.
    node.style.setProperty("--passkey-arrival-offset", -elapsed + "ms");
    add(node, "motion-passkey-arrival");
  }
  return { arrivalSeen: seen || shown,
    arrivalStarted: shown && elapsed < PASSKEY_ARRIVAL_MS ? started : null };
}

/** Measure only the persistent feedback surface; no wallet state or handlers are involved. */
export function observeFeedbackSize(doc, Observer = globalThis.ResizeObserver) {
  if (!doc || !Observer) return null;
  const banner = doc.getElementById("banner"), style = doc.documentElement.style;
  if (!banner) return null;
  const observer = new Observer(() => {
    const height = banner.hidden ? 0 : Math.ceil(banner.getBoundingClientRect().height);
    style.setProperty("--feedback-height", height + "px");
  });
  observer.observe(banner);
  return observer;
}

let controller, feedbackObserver, walletPicker;
/** Live draft illustrations use the same reduced-motion and visibility guards as entrances. */
export function presentEducation(node) {
  try { controller?.education(node); }
  catch { /* The static proposed arrangement remains complete without animation support. */ }
}
/** Called after the existing redraw and focus restoration; animation completion has no handler. */
export function presentMotion(parts) {
  try {
    feedbackObserver ??= observeFeedbackSize(globalThis.document);
    walletPicker ??= observeWalletPicker(globalThis.document);
    controller ??= createMotionController({ document: globalThis.document,
      storage: browserStorage(), media: browserMedia() });
    controller.present(parts);
    walletPicker?.measure();
    presentExperience(parts);
  } catch { /* A presentation effect must never interfere with the wallet render or its focus. */ }
}
