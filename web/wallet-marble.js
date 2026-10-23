// Presentation only: the existing public-address sculpture, with one visible studio per page.
import { walletArtEntry, walletArtImage } from "./wallet-art.js";

const controllers = new WeakMap();
const FRAME_MS = 1000 / 30, TURN_MS = 28000;

function controlState(disabled, paused) {
  if (disabled) return { label: "Wallet marble", motion: "static" };
  return paused ? { label: "Play wallet marble animation", motion: "paused" }
    : { label: "Pause wallet marble animation", motion: "playing" };
}

export function walletMarble(facts, { size = 64 } = {}) {
  const node = document.createElement("button");
  node.type = "button"; node.className = "wallet-marble";
  node.setAttribute("data-key", "wallet-marble-motion");
  node.setAttribute("aria-label", "Wallet marble");
  node.disabled = true;
  node.append(walletArtImage(facts, { size: Math.min(size, 96) }));
  const control = document.createElement("span");
  control.className = "wallet-marble-control"; control.setAttribute("aria-hidden", "true");
  node.append(control);
  node._walletMarbleEntry = walletArtEntry(facts);
  node._walletMarbleSize = size;
  return node;
}

/** Called after ordinary DOM replacement; rehomes the canvas without resetting its rotation. */
export function presentWalletMarble(doc = document) {
  let controller = controllers.get(doc);
  if (!controller) {
    if (!doc.querySelector(".wallet-marble")) return;
    controller = createMarbleController(doc); controllers.set(doc, controller);
  }
  controller.present(doc.querySelector(".wallet-marble"));
}

function createMarbleController(doc) {
  const win = doc.defaultView;
  const reduced = win.matchMedia("(prefers-reduced-motion: reduce)");
  const forced = win.matchMedia("(forced-colors: active)");
  let size = 0;
  let host, entry, studio, generation = 0, frame = 0, previous = 0, angle = 0;
  let paused = false, visible = false, failed = false, loading = false;
  const observer = new win.IntersectionObserver((entries) => {
    visible = entries.some((e) => e.target === host && e.isIntersecting);
    refresh();
  });
  const stop = () => { win.cancelAnimationFrame(frame); frame = 0; previous = 0; };
  const canShow = () => host?.isConnected && !doc.hidden && visible && !forced.matches
    && !host.closest("[inert]");
  const canSpin = () => canShow() && !paused && !reduced.matches;
  function label() {
    if (!host) return;
    host.disabled = !studio || failed || reduced.matches || forced.matches;
    const state = controlState(host.disabled, paused);
    host.setAttribute("aria-label", state.label); host.title = state.label;
    host.dataset.motion = state.motion;
  }
  function draw() {
    studio.draw(angle, Math.sin(angle) * .065);
  }
  function fail() {
    stop(); studio?.canvas.remove(); studio?.dispose(); studio = null; failed = true;
    host?.classList.remove("wallet-marble-live"); label();
  }
  function tick(now) {
    frame = 0;
    if (!canSpin()) { previous = 0; label(); return; }
    if (!previous || now - previous >= FRAME_MS - 1) {
      // Do not catch up after sleep, a background tab or a blocked main thread.
      angle = (angle + Math.min(previous ? now - previous : 0, 80)
        * Math.PI * 2 / TURN_MS) % (Math.PI * 2);
      previous = now;
      try { draw(); } catch { fail(); return; }
    }
    frame = win.requestAnimationFrame(tick);
  }
  const usable = (version, current) => version === generation && canShow() && current.descriptor;
  async function prepare() {
    if (loading) return;
    loading = true;
    const version = generation, current = entry;
    try {
      await current.ready;
      if (!usable(version, current)) return;
      const { createStudio } = await import("./dev/metal-orbs/renderer.js");
      if (!usable(version, current)) return;
      studio = createStudio({ size });
      studio.setSculpture(current.descriptor); draw();
      studio.canvas.setAttribute("aria-hidden", "true");
      studio.canvas.addEventListener("webglcontextlost", (event) => {
        if (studio?.canvas === event.target) fail();
      }, { once: true });
      host.append(studio.canvas); host.classList.add("wallet-marble-live");
    } catch { if (version === generation) fail(); }
    finally {
      loading = false;
      if (version !== generation || studio) refresh();
    }
  }
  function refresh() {
    stop(); label();
    if (!canShow() || !entry || failed) return;
    if (!studio) { void prepare(); return; }
    if (canSpin()) frame = win.requestAnimationFrame(tick);
  }
  function present(next) {
    const nextEntry = next?._walletMarbleEntry;
    const displaySize = next?._walletMarbleSize || 64;
    const nextSize = Math.min(displaySize > 96 ? 384 : 192,
      Math.ceil(displaySize * (win.devicePixelRatio || 1)));
    if (host !== next) {
      observer.disconnect(); host = next; visible = false;
      if (host) {
        host.onclick = () => { paused = !paused; refresh(); };
        observer.observe(host);
      }
    }
    if (entry !== nextEntry || size !== nextSize) {
      const changedIdentity = entry !== nextEntry;
      generation++; stop(); studio?.dispose(); studio = null;
      entry = nextEntry; size = nextSize; failed = false;
      if (changedIdentity) angle = 0;
    }
    if (studio && host) {
      host.append(studio.canvas); host.classList.add("wallet-marble-live");
    }
    refresh();
  }
  doc.addEventListener("visibilitychange", refresh);
  reduced.addEventListener("change", refresh);
  forced.addEventListener("change", refresh);
  win.addEventListener("pagehide", () => {
    generation++; stop(); studio?.dispose(); studio = null;
    host?.classList.remove("wallet-marble-live"); label();
  });
  win.addEventListener("pageshow", refresh);
  return { present };
}
