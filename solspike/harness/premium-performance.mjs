// Browser-only probes in an inert gallery: no engine, account, service or wallet handlers.
export async function installGallery({ origin, frames, after }) {
  const styles = [...document.styleSheets].length;
  if (!styles) throw Error("Gallery styles have not loaded");
  const module = after ? await import(origin + "/app-motion.js") : null;
  const makeController = () => {
    const memory = new Map();
    return module?.createMotionController({ document,
      storage: { getItem: (k) => memory.get(k), setItem: (k, v) => memory.set(k, v) },
      media: matchMedia("(prefers-reduced-motion: reduce)") });
  };
  let controller = makeController();
  const show = (scene) => {
    document.body.innerHTML = frames[scene];
    document.querySelector(".welcome-brand-plate")?.setAttribute("data-motion", "brand");
    const view = document.querySelector(".shell") || document.body;
    controller?.present({ view, layer: document.querySelector(".drawer"),
      identity: { wallet: "synthetic-fixture", panel: scene, session: scene } });
  };
  const entries = { long: [], shifts: [] };
  const long = new PerformanceObserver((list) => entries.long.push(...list.getEntries()
    .map((e) => ({ start: e.startTime, duration: e.duration }))));
  const shift = new PerformanceObserver((list) => entries.shifts.push(...list.getEntries()
    .map((e) => ({ start: e.startTime, value: e.value }))));
  long.observe({ type: "longtask", buffered: false });
  shift.observe({ type: "layout-shift", buffered: false });
  const ready = async () => {
    // A newly inserted font is requested only after layout; an earlier ready promise can be stale.
    document.body.getBoundingClientRect();
    await new Promise((done) => requestAnimationFrame(done));
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  };
  const coldStart = performance.now();
  show("welcome"); await ready();
  const welcomeReadyMs = performance.now() - coldStart;
  for (const scene of ["overview", "review"]) { show(scene); await ready(); }
  const firstLoad = { welcomeReadyMs, allViewsReadyMs: performance.now() - coldStart,
    layoutShift: entries.shifts.reduce((sum, entry) => sum + entry.value, 0),
    fonts: performance.getEntriesByType("resource")
      .filter((entry) => new URL(entry.name).pathname.startsWith("/fonts/"))
      .map((entry) => ({ path: new URL(entry.name).pathname, duration: entry.duration,
        bytes: entry.decodedBodySize })) };
  controller?.destroy(); controller = makeController();
  show("welcome"); await ready();
  long.takeRecords(); shift.takeRecords();
  entries.long.length = 0; entries.shifts.length = 0;
  window.premiumGallery = { show, controller, entries, firstLoad };
}

export async function measureGallery() {
  const gallery = window.premiumGallery, gaps = [];
  const start = performance.now(); let last;
  const switches = new Map([[15, "overview"], [65, "review"], [120, "welcome"]]);
  for (let index = 0; index < 180; index++) {
    const now = await new Promise((done) => requestAnimationFrame(done));
    if (last !== undefined) gaps.push(now - last);
    last = now;
    if (switches.has(index)) gallery.show(switches.get(index));
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  return { firstLoad: gallery.firstLoad,
    frames: gaps.length, within20ms: gaps.filter((n) => n <= 20).length / gaps.length,
    p95ms: sorted[Math.floor(sorted.length * .95)], maxMs: Math.max(...gaps),
    longTasks: gallery.entries.long.filter((e) => e.start >= start),
    layoutShift: gallery.entries.shifts.filter((e) => e.start >= start)
      .reduce((sum, e) => sum + e.value, 0),
    decorativeLoops: document.getAnimations().filter((a) =>
      a.effect?.getTiming().iterations === Infinity).length };
}

export async function verifyMotion() {
  const gallery = window.premiumGallery;
  gallery.show("welcome");
  const plate = document.querySelector("[data-motion=brand]");
  const noReplay = !plate?.classList.contains("motion-brand-sweep");
  const root = document.createElement("section");
  root.innerHTML = '<h1>Presentation controls</h1><section data-motion-watch="threshold" '
    + 'data-motion-value="off"><span data-motion-mark aria-hidden="true">✓</span>'
    + '<strong>Approvals received</strong></section><div class="qr"><h2>QR stays static</h2></div>'
    + '<input value="Retained synthetic text"><button>Local test action</button>';
  document.body.replaceChildren(root);
  const identity = { wallet: "fixture", panel: "controls", session: "payment" };
  gallery.controller.present({ view: root, identity });
  root.querySelector("[data-motion-watch]").setAttribute("data-motion-value", "on");
  gallery.controller.present({ view: root, identity });
  const changed = root.querySelector("[data-motion-mark]")
    .classList.contains("motion-complete-enter");
  let clicks = 0; const button = root.querySelector("button");
  button.addEventListener("click", () => clicks++); button.click();
  const input = root.querySelector("input"); input.focus();
  gallery.controller.present({ view: root, identity });
  return { noReplay, changed, localActionOnce: clicks === 1,
    sameViewSettled: !root.querySelector("[class*=motion-]"),
    retainedInput: input.value === "Retained synthetic text" && document.activeElement === input,
    qrStatic: !root.querySelector(".qr [class*=motion-]") };
}
