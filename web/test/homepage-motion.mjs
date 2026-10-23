// Actual scene lifecycle with controllable decoding, viewport, renderer and frame scheduling.
import assert from "node:assert/strict";
import test from "node:test";
import { startHomepageMotion } from "../homepage-motion.js";
import { sceneSample } from "../homepage-scene.js";

function events() {
  const listeners = new Map();
  return {
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    emit(name, event = {}) {
      for (const fn of listeners.get(name) || []) fn({ target: this, ...event });
    },
    count() { return [...listeners.values()].reduce((n, items) => n + items.size, 0); },
  };
}

function hero({ loaded = true, broken = false } = {}) {
  const classes = new Set(), styles = new Map(), children = [];
  let decode, reject;
  const decoded = new Promise((resolve, fail) => { decode = resolve; reject = fail; });
  const art = { ...events(), complete: loaded, naturalWidth: broken ? 0 : 1254, src: "/logo.png",
    decode: () => decoded };
  const host = { ...events(), append: (node) => children.push(node),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 640 }) };
  const node = { ...events(),
    style: { setProperty: (key, value) => styles.set(key, value),
      removeProperty: (key) => styles.delete(key) },
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
    querySelector: (selector) => ({ ".welcome-brand": host,
      ".home-hero-art": art })[selector] };
  return { node, host, art, children, decode, reject,
    live: () => classes.has("home-scene-live") };
}

function fixture({ current = hero(), hidden = false, reduced = false,
  saveData = false, loader = null } = {}) {
  const mutations = [], intersections = [], resizes = [], frames = new Map(), scenes = [];
  const media = new Map(); let next = 1, created = 0;
  function fakeCreate() {
    created++;
    const scene = { canvas: { ...events(), remove() {} }, samples: [], disposed: false,
      resize(width, dpr) { this.size = [width, dpr]; },
      draw(sample) { this.samples.push(sample); }, dispose() { this.disposed = true; } };
    scenes.push(scene); return scene;
  }
  const win = { ...events(), devicePixelRatio: 2, navigator: { connection: { saveData } },
    matchMedia(query) {
      if (!media.has(query)) media.set(query, { ...events(), matches: query.includes("hover")
        || query.includes("reduced") && reduced });
      return media.get(query);
    },
    requestAnimationFrame(fn) { const id = next++; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    MutationObserver: class {
      constructor(fn) { this.fn = fn; mutations.push(this); }
      observe() { this.connected = true; } disconnect() { this.connected = false; }
    },
    IntersectionObserver: class {
      constructor(fn) { this.fn = fn; intersections.push(this); }
      observe(target) { this.target = target; this.connected = true; }
      disconnect() { this.connected = false; }
    },
    ResizeObserver: class {
      constructor(fn) { this.fn = fn; resizes.push(this); }
      observe() { this.connected = true; } disconnect() { this.connected = false; }
    },
  };
  const doc = { ...events(), body: {}, defaultView: win, hidden,
    querySelector: () => current?.node || null };
  const controller = startHomepageMotion(doc, loader || (async () => fakeCreate));
  return { doc, win, controller, frames, scenes, media, created: () => created, fakeCreate,
    visible(value = true) {
      intersections.filter((o) => o.connected).forEach((o) =>
        o.fn([{ target: o.target, isIntersecting: value, intersectionRatio: value ? 1 : 0 }]));
    },
    draw(nextHero) {
      current = nextHero; mutations.filter((o) => o.connected).forEach((o) => o.fn([]));
    },
    frame(time) {
      const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn(time));
    },
    preference(name, value) {
      const item = [...media].find(([key]) => key.includes(name))[1];
      item.matches = value; item.emit("change");
    },
    clean(...heroes) {
      assert.equal(frames.size, 0);
      assert.ok([...mutations, ...intersections, ...resizes].every((o) => !o.connected));
      assert.ok(scenes.every((s) => s.disposed));
      const mediaListeners = [...media.values()].reduce((n, m) => n + m.count(), 0);
      assert.equal(doc.count() + win.count() + mediaListeners, 0);
      for (const item of heroes)
        assert.equal(item.host.count() + item.art.count(), 0);
    } };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const ready = async (f, item) => { item.decode(); f.visible(); await flush(); };

test("decoded, visible artwork initializes one renderer", async () => {
  const item = hero(), f = fixture({ current: item });
  f.visible(); await flush(); assert.equal(f.created(), 0); assert.equal(item.live(), false);
  item.decode(); await flush();
  assert.equal(f.created(), 1); assert.ok(item.live()); assert.equal(f.frames.size, 1);
  assert.deepEqual(f.scenes[0].size, [640, 2]);
  assert.equal(startHomepageMotion(f.doc), f.controller);
  f.controller.destroy(); f.clean(item);
});

test("hidden and offscreen loading does no GPU work, then resumes only when visible", async () => {
  const item = hero(), f = fixture({ current: item, hidden: true });
  item.decode(); f.visible(); await flush(); assert.equal(f.created(), 0);
  f.doc.hidden = false; f.doc.emit("visibilitychange"); await flush(); assert.equal(f.created(), 1);
  f.frame(10); f.frame(60); const elapsed = f.controller.elapsed;
  f.visible(false); assert.equal(f.frames.size, 0); f.frame(5000);
  assert.equal(f.controller.elapsed, elapsed);
  f.visible(); f.frame(6000); assert.equal(f.controller.elapsed, elapsed);
  f.controller.destroy(); f.clean(item);
});

test("the entrance advances into a continuing fourteen-second light cycle", async () => {
  const item = hero(), f = fixture({ current: item }); await ready(f, item);
  for (let t = 16; t < 3600; t += 40) f.frame(t);
  assert.ok(f.controller.elapsed > 1500); assert.equal(f.frames.size, 1);
  const samples = f.scenes[0].samples;
  assert.ok(samples.some((s) => s.seconds < 1.5)); assert.ok(samples.at(-1).seconds > 1.5);
  assert.notEqual(samples.at(-1).atmosphere, samples[0].atmosphere);
  f.controller.destroy(); f.clean(item);
});

test("only a mouse over the artwork redirects bounded light", async () => {
  const item = hero(), f = fixture({ current: item }); await ready(f, item);
  item.node.emit("pointermove", { pointerType: "mouse", clientX: 640, clientY: 640 });
  item.host.emit("pointermove", { pointerType: "touch", clientX: 640, clientY: 640 });
  assert.deepEqual(f.controller.current.target, { x: 0, y: 0 });
  item.host.emit("pointermove", { pointerType: "mouse", clientX: 900, clientY: -100 });
  assert.deepEqual(f.controller.current.target, { x: 1, y: -1 });
  for (let t = 10; t < 600; t += 17) f.frame(t);
  assert.ok(f.scenes[0].samples.at(-1).x > .9); assert.ok(f.scenes[0].samples.at(-1).y < -.9);
  item.host.emit("pointerleave");
  for (let t = 600; t < 1400; t += 17) f.frame(t);
  assert.ok(Math.abs(f.scenes[0].samples.at(-1).x) < .01);
  f.controller.destroy(); f.clean(item);
});

test("redraw reuses the renderer and continues without replaying the entrance", async () => {
  const item = hero(), f = fixture({ current: item }); await ready(f, item);
  for (let t = 10; t < 2000; t += 40) f.frame(t);
  const elapsed = f.controller.elapsed;
  const second = hero(); f.draw(second); await ready(f, second);
  assert.equal(f.created(), 1, "redraw reuses the same texture and context");
  assert.equal(f.scenes[0].disposed, false);
  assert.equal(f.frames.size, 1); assert.equal(f.controller.elapsed, elapsed);
  f.frame(9000); assert.equal(f.controller.elapsed, elapsed);
  f.frame(9040); assert.ok(f.controller.elapsed > elapsed);
  f.controller.destroy(); f.clean(item, second);
});

test("motion, color and data preferences retain the original still", async () => {
  for (const preference of ["reduced", "slow", "forced", "saveData"]) {
    const item = hero(), f = fixture({ current: item, saveData: preference === "saveData" });
    if (preference !== "saveData") f.preference(preference, true);
    await ready(f, item);
    assert.equal(f.created(), 0); assert.equal(f.frames.size, 0); assert.equal(item.live(), false);
    f.controller.destroy(); f.clean(item);
  }
});

test("preference changes dispose the renderer without replaying intro", async () => {
  const item = hero(), f = fixture({ current: item }); await ready(f, item); f.frame(10);
  f.preference("reduced", true);
  assert.equal(f.scenes[0].disposed, true); assert.equal(item.live(), false);
  assert.equal(f.frames.size, 0);
  f.preference("reduced", false); await flush();
  assert.equal(f.created(), 2); assert.ok(f.controller.elapsed >= 1500);
  f.controller.destroy(); f.clean(item);
});

test("late preparation cannot mount into a replaced or departed homepage", async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const first = hero(), f = fixture({ current: first, loader: () => pending });
  await ready(f, first); const second = hero(); f.draw(second); await ready(f, second);
  resolve(f.fakeCreate); await flush(); assert.equal(f.created(), 1);
  assert.equal(first.live(), false); assert.ok(second.live());
  f.draw(null); assert.equal(f.frames.size, 0); assert.ok(f.scenes[0].disposed);
  f.controller.destroy(); f.clean(first, second);
});

test("WebGL context loss and renderer errors restore the still without retrying", async () => {
  const item = hero(), f = fixture({ current: item }); await ready(f, item);
  f.scenes[0].canvas.emit("webglcontextlost");
  assert.equal(item.live(), false);
  assert.equal(f.frames.size, 0);
  f.visible(false); f.visible(true); await flush(); assert.equal(f.created(), 1);
  f.controller.destroy(); f.clean(item);
  const other = hero(), broken = fixture({ current: other,
    loader: async () => () => { throw new Error("Unavailable GPU"); } });
  await ready(broken, other); assert.equal(other.live(), false);
  assert.equal(broken.frames.size, 0);
  broken.controller.destroy(); broken.clean(other);
});

test("pagehide releases resources; restored pages skip a second entrance", async () => {
  const item = hero(), f = fixture({ current: item }); await ready(f, item);
  f.win.emit("pagehide", { persisted: true }); assert.ok(f.scenes[0].disposed);
  assert.equal(f.frames.size, 0); f.win.emit("pageshow", { persisted: true }); await ready(f, item);
  assert.equal(f.created(), 2); assert.ok(f.controller.elapsed >= 1500);
  f.controller.destroy(); f.clean(item);
});

test("normal image load, failed images and absent browser capabilities stay safe", async () => {
  const item = hero({ loaded: false }), f = fixture({ current: item });
  f.visible(); await flush(); assert.equal(f.created(), 0);
  item.art.emit("load"); item.decode(); await flush(); assert.equal(f.created(), 1);
  f.controller.destroy(); f.clean(item);
  const broken = hero({ broken: true }), other = fixture({ current: broken });
  await ready(other, broken); assert.equal(other.created(), 0); assert.equal(other.frames.size, 0);
  other.controller.destroy(); other.clean(broken);
  assert.equal(startHomepageMotion({ body: {}, defaultView: {} }), null);
});

test("light samples remain finite, bounded and periodic even in long-running tabs", () => {
  for (const time of [-10, 0, 1500, 15500, 1e14, NaN, Infinity]) {
    const s = sceneSample(time, { x: 99, y: -99 });
    assert.ok(Object.values(s).every(Number.isFinite));
    assert.ok(s.seconds >= 0 && s.seconds < 15.5);
    assert.equal(s.x, 1); assert.equal(s.y, -1);
    assert.ok(s.atmosphere >= .46 - 1e-12 && s.atmosphere <= .74 + 1e-12);
  }
  assert.deepEqual(sceneSample(4500), sceneSample(18500));
});

test("frame guard releases resources even before the media change event arrives", async () => {
  const item = hero(), f = fixture({ current: item }); await ready(f, item);
  f.frame(10);
  [...f.media].find(([key]) => key.includes("reduced"))[1].matches = true;
  f.frame(30);
  assert.equal(f.frames.size, 0); assert.ok(f.scenes[0].disposed); assert.equal(item.live(), false);
  f.controller.destroy(); f.clean(item);
});
