// Presentation only. No wallet imports, storage, requests, timers or operation callbacks.
const experiences = new WeakMap();
const SURFACES = ".card,.overview-hero,.shared-control,.security-overview,.security-signer,"
  + ".preferences-surface,.wallet-vault-card,.swap-composer,.swap-detail-card,.messages-layout";
const SENSITIVE = ".safety,.qr,.qr-toggle,.addr-full,.secret-link,.money,.portfolio-value,"
  + "[role=alert],[role=status],.callout,.review-warnings,[data-motion-static]";
const EASE = "cubic-bezier(.18,.8,.22,1)";
const layerIdentity = (layer, session) => (layer?.getAttribute("aria-labelledby") || "")
  + (layer?.querySelector("h1,h2")?.textContent || "") + (session || "");

class SurfaceExperience {
  constructor(doc) {
    this.doc = doc; this.win = doc.defaultView; this.scopes = new Map();
    this.animations = new Set(); this.art = new Set(); this.frame = 0; this.lit = null;
    this.reduced = this.win.matchMedia("(prefers-reduced-motion:reduce),(update:slow)");
    this.forced = this.win.matchMedia("(forced-colors:active)");
    this.fine = this.win.matchMedia("(hover:hover) and (pointer:fine)");
    this.visibility = () => this.sync();
    this.move = (event) => this.pointer(event);
    this.leave = (event) => { if (!event.relatedTarget) this.clearLight(); };
    this.hide = (event) => { if (!event.persisted) this.destroy(); };
    this.observer = this.win.IntersectionObserver ? new this.win.IntersectionObserver(
      (entries) => entries.forEach(({ target, isIntersecting }) => {
        target.setAttribute("data-premium-visible", String(isIntersecting));
      }), { threshold: .05 }) : null;
    doc.addEventListener("visibilitychange", this.visibility);
    doc.addEventListener("pointermove", this.move, { passive: true });
    doc.addEventListener("pointerout", this.leave, { passive: true });
    this.reduced.addEventListener("change", this.visibility);
    this.forced.addEventListener("change", this.visibility);
    this.win.addEventListener("pagehide", this.hide);
    this.sync();
  }

  allowed() {
    return !this.doc.hidden && !this.reduced.matches && !this.forced.matches
      && !this.win.navigator.connection?.saveData;
  }

  sync() {
    this.doc.documentElement.classList.toggle("premium-paused", !this.allowed());
    if (this.allowed()) return;
    this.animations.forEach((animation) => animation.cancel());
    this.animations.clear(); this.clearLight();
  }

  clearLight() {
    this.win.cancelAnimationFrame(this.frame); this.frame = 0;
    this.lit?.classList.remove("premium-lit"); this.lit = null;
  }

  pointer(event) {
    if (event.pointerType !== "mouse" || !this.allowed() || !this.fine.matches) return;
    const surface = event.target.closest?.("[data-premium-surface]");
    if (surface !== this.lit) { this.clearLight(); this.lit = surface; }
    if (!surface || this.frame) return;
    this.frame = this.win.requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.allowed() || !surface.isConnected || surface !== this.lit) return;
      const rect = surface.getBoundingClientRect();
      surface.style.setProperty("--premium-x", event.clientX - rect.left + "px");
      surface.style.setProperty("--premium-y", event.clientY - rect.top + "px");
      surface.classList.add("premium-lit");
    });
  }

  animate(node, frames, duration, delay = 0) {
    if (!node?.animate || !this.allowed() || node.contains(this.doc.activeElement)) return;
    if (node.closest(SENSITIVE) || node.querySelector(SENSITIVE)) return;
    const animation = node.animate(frames, { duration, delay, easing: EASE });
    this.animations.add(animation);
    animation.finished.catch(() => {}).finally(() => this.animations.delete(animation));
  }

  observeArtwork(root, changed) {
    for (const node of this.art) if (!node.isConnected) {
      this.observer?.unobserve(node); this.art.delete(node);
    }
    if (!changed) return;
    root.querySelectorAll(".transaction-empty-mark,.activity-timeline,.messages-empty-art,"
      + ".approval-empty-mark,.recipient-empty-art").forEach((node) => {
      node.classList.add("premium-empty-art");
      if (this.art.has(node)) return;
      this.art.add(node); this.observer?.observe(node);
    });
  }

  scope(name, root, key) {
    if (!root) { this.scopes.delete(name); return; }
    root.querySelectorAll(SURFACES).forEach((node) => {
      node.setAttribute("data-premium-surface", "");
    });
    const changed = this.scopes.get(name) !== key;
    this.scopes.set(name, key);
    this.observeArtwork(root, changed);
    if (!changed || !this.allowed()) return;
    const headings = [...root.querySelectorAll("h1,h2")].filter((node) =>
      !node.closest("[hidden],.sr-only,[aria-hidden=true]," + SENSITIVE)
      && !node.querySelector("button,input,select,textarea"));
    headings.slice(0, 2).forEach((node, index) => this.animate(node,
      [{ transform: "translateY(8px)" }, { transform: "none" }], 440, index * 35));
    root.querySelectorAll("[data-premium-surface]").forEach((node, index) => {
      node.style.setProperty("--premium-order", Math.min(index, 4));
      node.classList.add("premium-surface-enter");
    });
  }

  present({ view, layer, identity = {} }) {
    this.sync();
    const opening = layer && !this.scopes.has("layer");
    const key = JSON.stringify([identity.wallet, identity.panel, identity.chat, identity.contact,
      identity.surface]);
    this.scope("page", view, key);
    this.scope("layer", layer, key + layerIdentity(layer, identity.session));
    if (opening) this.animate(this.doc.querySelector(".scrim"),
      [{ opacity: 0 }, { opacity: 1 }], 240);
  }

  destroy() {
    this.animations.forEach((animation) => animation.cancel());
    this.clearLight(); this.observer?.disconnect(); this.art.clear(); this.scopes.clear();
    this.doc.removeEventListener("visibilitychange", this.visibility);
    this.doc.removeEventListener("pointermove", this.move);
    this.doc.removeEventListener("pointerout", this.leave);
    this.reduced.removeEventListener("change", this.visibility);
    this.forced.removeEventListener("change", this.visibility);
    this.win.removeEventListener("pagehide", this.hide);
    experiences.delete(this.doc);
  }
}

/** Uses the existing render identity; changing a balance never restarts a page entrance. */
export function presentExperience(parts, doc = globalThis.document) {
  if (!doc?.defaultView?.matchMedia || !parts.view) return;
  let experience = experiences.get(doc);
  if (!experience) { experience = new SurfaceExperience(doc); experiences.set(doc, experience); }
  experience.present(parts);
}
