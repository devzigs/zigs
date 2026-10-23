// Independent decorative scene: no wallet, signer, security or persistence imports.
import { sceneSample } from "./homepage-scene.js";

const documents = new WeakMap();
const HERO = ".lobby-home [data-home-hero]";
const loadScene = async () => (await import("./homepage-scene.js")).createHeroScene;
const clamp = (n) => Math.max(-1, Math.min(1, n));

function watchImage(image, done, failed) {
  let cancelled = false, decoding = false;
  const remove = () => {
    image.removeEventListener("load", decode); image.removeEventListener("error", fail);
  };
  const fail = () => { remove(); if (!cancelled) failed(); };
  const decode = () => {
    if (decoding) return;
    decoding = true; remove();
    Promise.resolve().then(() => image.decode?.()).then(() => {
      if (!cancelled) { if (image.naturalWidth > 0) done(); else fail(); }
    }, fail);
  };
  image.addEventListener("load", decode); image.addEventListener("error", fail);
  if (image.complete) { if (image.naturalWidth > 0) decode(); else fail(); }
  return () => { cancelled = true; remove(); };
}

function observeScene(owner, hero) {
  const host = hero.querySelector(".welcome-brand"), art = hero.querySelector(".home-hero-art");
  if (!host || !art) return null;
  const current = { hero, host, art,
    visible: false, ready: false, failed: false, loading: false, scene: null,
    pointer: { x: 0, y: 0 }, target: { x: 0, y: 0 }, listeners: [] };
  current.intersection = new owner.win.IntersectionObserver((entries) => {
    const entry = entries.find((item) => item.target === host);
    if (owner.current !== current || !entry) return;
    current.visible = entry.isIntersecting && entry.intersectionRatio >= .01;
    if (!current.visible) current.target = { x: 0, y: 0 };
    owner.refresh();
  }, { threshold: .01 });
  current.resize = new owner.win.ResizeObserver(() => owner.resize(current));
  return current;
}

class HomepageMotion {
  constructor(doc, loader) {
    this.doc = doc; this.win = doc.defaultView; this.loader = loader;
    this.current = null; this.elapsed = 0; this.last = 0; this.painted = 0;
    this.frame = 0; this.destroyed = false; this.suspended = false;
    this.media = ["(prefers-reduced-motion: reduce)", "(update: slow)", "(forced-colors: active)"]
      .map((query) => this.win.matchMedia(query));
    this.fine = this.win.matchMedia("(hover: hover) and (pointer: fine)");
    this.mutations = new this.win.MutationObserver(() => this.discover());
    this.preference = () => {
      this.elapsed = Math.max(1500, this.elapsed); this.refresh();
    };
    this.visibility = () => this.refresh();
    this.hide = () => {
      this.suspended = true; this.elapsed = Math.max(1500, this.elapsed);
      this.mutations.disconnect(); this.release();
    };
    this.show = () => {
      if (this.destroyed) return;
      this.suspended = false;
      this.mutations.observe(doc.body, { childList: true, subtree: true }); this.discover();
    };
    this.media.forEach((media) => media.addEventListener("change", this.preference));
    this.win.navigator?.connection?.addEventListener?.("change", this.preference);
    doc.addEventListener("visibilitychange", this.visibility);
    this.win.addEventListener("pagehide", this.hide);
    this.win.addEventListener("pageshow", this.show);
    this.show();
  }

  staticPreference() {
    return this.media.some((media) => media.matches) || this.win.navigator?.connection?.saveData;
  }

  permitsMotion() {
    return !this.destroyed && !this.suspended && !this.doc.hidden && !this.staticPreference();
  }

  watching() { return !this.destroyed && !this.suspended; }

  discover() {
    if (!this.watching()) return;
    const hero = this.doc.querySelector(HERO);
    if (this.current?.hero === hero) return;
    const current = hero ? observeScene(this, hero) : null;
    const retained = current ? this.takeScene(current.art) : null;
    this.release();
    this.current = current;
    if (!current) return;
    if (retained) this.adopt(current, retained);
    const listen = (target, name, fn) => {
      target?.addEventListener(name, fn, { passive: true });
      current.listeners.push(() => target?.removeEventListener(name, fn));
    };
    listen(current.host, "pointermove", (event) => this.pointer(current, event));
    listen(current.host, "pointerleave", () => { current.target = { x: 0, y: 0 }; });
    listen(current.host, "pointercancel", () => { current.target = { x: 0, y: 0 }; });
    current.intersection.observe(current.host); current.resize.observe(current.host);
    current.cancelImage = watchImage(current.art, () => {
      if (this.current !== current) return;
      current.ready = true; this.refresh();
    }, () => this.fail(current));
  }

  reusable(previous, art) {
    return !!previous?.scene && !!art.src && art.src === previous.art.src
      && !previous.failed && !this.staticPreference();
  }

  takeScene(art) {
    const previous = this.current;
    if (!this.reusable(previous, art)) return null;
    const retained = { scene: previous.scene, pointer: previous.pointer, target: previous.target };
    retained.scene.canvas.removeEventListener("webglcontextlost", previous.lost);
    previous.scene = null;
    return retained;
  }

  adopt(current, retained) {
    Object.assign(current, retained); current.ready = true;
    this.mount(current);
  }

  pointer(current, event) {
    if (this.current !== current || !this.fine.matches || event.pointerType !== "mouse") return;
    if (!this.permitsMotion()) return;
    const box = current.host.getBoundingClientRect();
    if (!box.width || !box.height) return;
    current.target = { x: clamp((event.clientX - box.left) / box.width * 2 - 1),
      y: clamp((event.clientY - box.top) / box.height * 2 - 1) };
  }

  stop() {
    this.win.cancelAnimationFrame(this.frame); this.frame = 0; this.last = 0; this.painted = 0;
  }

  resize(current) {
    if (current !== this.current || !current.scene) return;
    try {
      current.scene.resize(current.host.getBoundingClientRect().width, this.win.devicePixelRatio);
      this.draw(current);
    } catch { this.fail(current); }
  }

  draw(current) {
    const sample = sceneSample(this.elapsed, current.pointer);
    current.scene.draw(sample);
    current.hero.style.setProperty("--home-atmosphere", sample.atmosphere.toFixed(3));
  }

  canRun() {
    const current = this.current;
    return !!current?.scene && current.visible && this.permitsMotion();
  }

  settleRestricted() {
    if (this.current && this.staticPreference()) this.discard(this.current);
  }

  tick(now) {
    this.frame = 0;
    const current = this.current;
    if (!this.canRun()) { this.settleRestricted(); return; }
    const delta = this.last ? Math.min(80, Math.max(0, now - this.last)) : 0;
    this.last = now; this.elapsed += delta;
    const distance = Math.abs(current.target.x - current.pointer.x)
      + Math.abs(current.target.y - current.pointer.y);
    const response = 1 - Math.exp(-delta / 120);
    current.pointer.x += (current.target.x - current.pointer.x) * response;
    current.pointer.y += (current.target.y - current.pointer.y) * response;
    // Thirty draws/second at rest; sixty only while the light responds to a pointer.
    const interval = distance > .002 ? 1000 / 60 : 1000 / 30;
    if (!this.painted || now - this.painted >= interval - 1) {
      try { this.draw(current); } catch { this.fail(current); return; }
      this.painted = now;
    }
    this.frame = this.win.requestAnimationFrame((time) => this.tick(time));
  }

  mount(current) {
    current.lost = () => this.fail(current);
    current.scene.canvas.addEventListener("webglcontextlost", current.lost);
    this.resize(current);
    if (!current.scene) return;
    current.host.append(current.scene.canvas); current.hero.classList.add("home-scene-live");
  }

  install(current, create) { current.scene = create(current.art, this.doc); this.mount(current); }

  canPrepare(current) {
    return this.current === current && current.visible && this.permitsMotion();
  }

  async prepare(current) {
    if (current.loading || current.failed) return;
    current.loading = true;
    try {
      const create = await this.loader();
      if (this.canPrepare(current)) this.install(current, create);
    } catch { this.fail(current); }
    finally {
      current.loading = false;
      if (this.current === current && current.scene) this.refresh();
    }
  }

  ready(current) { return current.ready && current.visible && !current.failed; }

  refresh() {
    this.stop();
    const current = this.current;
    if (!current) return;
    if (!this.permitsMotion()) {
      if (this.staticPreference()) this.discard(current);
      return;
    }
    if (!this.ready(current)) return;
    if (!current.scene) { void this.prepare(current); return; }
    this.frame = this.win.requestAnimationFrame((time) => this.tick(time));
  }

  discard(current) {
    if (current.scene) {
      current.scene.canvas.removeEventListener("webglcontextlost", current.lost);
      current.scene.canvas.remove(); current.scene.dispose(); current.scene = null;
    }
    current.hero.classList.remove("home-scene-live");
    current.hero.style.removeProperty("--home-atmosphere");
  }

  fail(current) {
    if (this.current !== current) return;
    this.stop(); current.failed = true; this.discard(current);
  }

  release() {
    this.stop();
    const current = this.current;
    if (!current) return;
    this.current = null;
    current.intersection.disconnect(); current.resize.disconnect(); current.cancelImage?.();
    current.listeners.forEach((remove) => remove()); this.discard(current);
  }

  destroy() {
    this.destroyed = true; this.mutations.disconnect(); this.release();
    this.media.forEach((media) => media.removeEventListener("change", this.preference));
    this.win.navigator?.connection?.removeEventListener?.("change", this.preference);
    this.doc.removeEventListener("visibilitychange", this.visibility);
    this.win.removeEventListener("pagehide", this.hide);
    this.win.removeEventListener("pageshow", this.show);
  }
}

function supported(doc) {
  const win = doc?.defaultView;
  if (!win) return false;
  const features = [doc.body, win.matchMedia, win.MutationObserver, win.IntersectionObserver,
    win.ResizeObserver, win.requestAnimationFrame].every(Boolean);
  return features && !!win.matchMedia("(prefers-reduced-motion: reduce)").addEventListener;
}

export function startHomepageMotion(doc, loader = loadScene) {
  if (documents.has(doc)) return documents.get(doc);
  if (!supported(doc)) return null;
  const controller = new HomepageMotion(doc, loader);
  documents.set(doc, controller);
  return controller;
}

if (typeof document !== "undefined") {
  if (document.body) startHomepageMotion(document);
  else document.addEventListener("DOMContentLoaded", () => startHomepageMotion(document),
    { once: true });
}
