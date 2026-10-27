// Presentation only. No wallet imports, storage, requests, timers or operation callbacks.
const experiences = new WeakMap();
const SURFACES = ".card,.overview-hero,.shared-control,.security-overview,.security-signer,"
  + ".preferences-surface,.wallet-vault-card,.swap-composer,.swap-detail-card,.messages-layout";
const SENSITIVE = ".safety,.qr,.qr-toggle,.addr-full,.secret-link,.money,.portfolio-value,"
  + "[role=alert],[role=status],.callout,.review-warnings,[data-motion-static],"
  + ".security-metrics,.security-status,.badge,.balance,.amount,.memo-text";
const EASE = "cubic-bezier(.18,.8,.22,1)";
// Only fixed editorial copy may join a heading entrance. Never select operational rows.
const EDITORIAL = ".workspace-heading .ph-left>p,.preferences-heading>p,"
  + ".section-heading>p.small,.swap-subtitle";
const layerIdentity = (layer, session) => (layer?.getAttribute("aria-labelledby") || "")
  + (layer?.querySelector("h1,h2")?.textContent || "") + (session || "");

class SurfaceExperience {
  constructor(doc) {
    this.doc = doc; this.win = doc.defaultView; this.scopes = new Map();
    this.animations = new Set(); this.art = new Set(); this.navKey = null;
    this.reduced = this.win.matchMedia("(prefers-reduced-motion:reduce),(update:slow)");
    this.forced = this.win.matchMedia("(forced-colors:active)");
    this.visibility = () => this.sync();
    this.hide = (event) => { if (!event.persisted) this.destroy(); };
    this.observer = this.win.IntersectionObserver ? new this.win.IntersectionObserver(
      (entries) => entries.forEach(({ target, isIntersecting }) => {
        target.setAttribute("data-premium-visible", String(isIntersecting));
        if (isIntersecting && this.allowed()) target.classList.add("premium-art-enter");
      }), { threshold: .05 }) : null;
    doc.addEventListener("visibilitychange", this.visibility);
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
    this.animations.clear();
    this.art.forEach((node) => node.classList.add("premium-art-settled"));
    this.doc.querySelectorAll(".premium-surface-enter,.premium-layer-enter,.premium-nav-enter")
      .forEach((node) => node.classList.remove("premium-surface-enter", "premium-layer-enter",
        "premium-nav-enter"));
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
    headings.slice(0, 2).forEach((node, index) => {
      // Replace the older CSS entrance rather than playing two animations on the same title.
      if (node.animate) node.classList.add("premium-title");
      this.animate(node, [{ transform: "translateY(6px)" }, { transform: "none" }],
        480, index * 40);
    });
    root.querySelectorAll(EDITORIAL).forEach((node, index) => this.animate(node,
      [{ transform: "translateY(4px)" }, { transform: "none" }], 420, 45 + index * 25));
    if (name === "layer") root.classList.add("premium-layer-enter");
    root.querySelectorAll("[data-premium-surface]").forEach((node, index) => {
      node.style.setProperty("--premium-order", Math.min(index, 4));
      node.classList.add("premium-surface-enter");
    });
  }

  present({ view, layer, identity = {} }) {
    this.sync();
    for (const animation of this.animations) if (!animation.effect?.target?.isConnected) {
      animation.cancel(); this.animations.delete(animation);
    }
    const opening = layer && !this.scopes.has("layer");
    const key = JSON.stringify([identity.wallet, identity.panel, identity.chat, identity.contact,
      identity.surface]);
    this.scope("page", view, key);
    this.scope("layer", layer, key + layerIdentity(layer, identity.session));
    this.navigation(identity.panel);
    if (opening) this.animate(this.doc.querySelector(".scrim"),
      [{ opacity: 0 }, { opacity: 1 }], 240);
  }

  navigation(key) {
    if (this.navKey === key) return;
    this.navKey = key;
    const mark = this.doc.querySelector("#side-nav .side-item[aria-current=page]>.symbol");
    if (this.allowed()) mark?.parentElement.classList.add("premium-nav-enter");
    this.animate(mark, [{ transform: "translateX(-2px) scale(.96)" },
      { transform: "none" }], 360);
  }

  destroy() {
    this.animations.forEach((animation) => animation.cancel());
    this.observer?.disconnect(); this.art.clear(); this.scopes.clear();
    this.doc.removeEventListener("visibilitychange", this.visibility);
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
