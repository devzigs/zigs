// Tor demo. Never imports wallet code, routes traffic, stores a choice or changes wallet data.
// Nothing here is a Tor connection: every screen identifies the preview and direct traffic.
import { CAMOUFLAGE_MS, privacyCamouflage } from "./network-privacy-camouflage.js";

export const PILL_TEXT = "Tor · Preview";
export const DEMO_NOTE = "Preview only. No Tor connection is created; traffic stays direct.";
export const TITLES = {
  offer: "Make your connection private.", connecting: "Establishing a private route.",
  camouflage: "Blend into the network.", success: "A little more privacy.",
};
const STEPS = ["Starting Tor", "Loading network state", "Establishing a private circuit",
  "Checking wallet services"];
const STEP_DELAYS = [2200, 3000, 4200, 2600];
const OFFER_LEAD = "Explore how Tor could help keep your direct IP away from wallet services.";
const SUCCESS_LEAD = "You’ve seen how a private route could help you blend in. "
  + "Tor routing isn’t available in this version, so your connection hasn’t changed.";
// Match app-icons.js geometry without importing page modules into this standalone leaf.
const SYMBOLS = Object.freeze({
  browser: "M3 4h18v16H3zM3 9h18M6 6.5h.01M9 6.5h.01",
  wallet: "M4 6h15v14H4zM4 6V4h12v2M15 11h6v5h-6zM17 13.5h.01",
  fingerprint: "M8 3a8 8 0 0 1 12 7v3c0 1.4-.1 2.8-.4 4M4 7a8 8 0 0 0-1 4v2"
    + "M6 17c.7-1.2 1-2.6 1-4v-2a5 5 0 0 1 10 0v3c0 2-.4 4-1.1 6"
    + "M12 11a2 2 0 0 0-2 2v2c0 2-1 4-2 5M14 13v2c0 3-1 5-2 7",
  close: "M6 6l12 12M18 6 6 18", forward: "M3 12h16M12 5l7 7-7 7",
  chevronDown: "m5 9 7 7 7-7", activity: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  approvals: "M9 12l2 2 4-4M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
});
let controller = null;
export const hasPrivacyPopup = () => controller !== null;
export const openPrivacyPopup = (event) => {
  if (!controller) return false;
  controller.open(event?.currentTarget); return true;
};
// Called after app presentation redraws; reuse one control inside the current page's header.
export const presentPrivacyStatus = (root = document) => controller?.mount(root);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) if (child != null && child !== false) {
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
const p = (content, cls = "") => el("p", { class: cls }, content);
const button = (content, action, primary = false, attrs = {}) => el("button", {
  type: "button", class: "pp-button" + (primary ? " pp-primary" : ""), onclick: action, ...attrs,
}, content);
const actions = (...children) => el("div", { class: "pp-actions" }, ...children);

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const attrs = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round",
    focusable: "false" };
  for (const [key, value] of Object.entries(attrs)) svg.setAttribute(key, value);
  for (const cls of ["icon-relief", "icon-body"]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", SYMBOLS[name]); path.setAttribute("class", cls); svg.append(path);
  }
  return el("span", { class: "symbol", "aria-hidden": "true", "data-icon": name }, svg);
}

function limits() {
  return el("details", { class: "pp-limits" },
    el("summary", { tabindex: "0" }, "What Tor would protect", icon("chevronDown")),
    p("Real Tor routing can help conceal your direct IP from supported wallet services. "
      + "Network privacy and transaction privacy protect different information."),
    p("The website host and browser gateway can still see your IP. Tor does not prevent "
      + "browser fingerprinting, account identification or all timing correlation."));
}

const stepState = (step, index) =>
  index < step ? "Previewed" : index === step ? "In progress" : "Up next";

function routeArt() {
  const endpoint = (symbol, label) => el("div", { class: "pp-route-end" },
    el("span", { class: "pp-route-device" }, icon(symbol)), el("span", {}, label));
  return el("div", { class: "pp-route", "aria-hidden": "true" },
    endpoint("browser", "Your browser"), el("i", { class: "pp-route-track" }),
    el("div", { class: "pp-route-core" },
      el("span", { class: "pp-route-orbit" }),
      el("span", { class: "pp-route-medallion" }, icon("fingerprint")),
      el("span", { class: "pp-route-label" }, "Tor network")),
    el("i", { class: "pp-route-track" }), endpoint("wallet", "Wallet services"));
}

function bodyFor(screen, step, go) {
  const bodies = {
    offer: () => [p(OFFER_LEAD, "pp-lead"),
      routeArt(),
      actions(button(["Preview private connection", icon("forward")], go.begin, true),
        button("Not now", go.close)), limits()],
    connecting: () => [p("A private connection, one step at a time. This is a preview.", "pp-lead"),
      el("ol", { class: "pp-steps" }, STEPS.map((name, index) => el("li", {
        class: index < step ? "pp-done" : index === step ? "pp-active" : "",
        "aria-current": index === step ? "step" : null },
      el("span", { class: "pp-step-mark", "aria-hidden": "true" },
        index < step ? icon("approvals") : String(index + 1).padStart(2, "0")),
      el("span", { class: "pp-step-copy" }, el("strong", {}, name),
        el("span", {}, stepState(step, index))),
      index === step ? el("i", { class: "pp-step-pulse", "aria-hidden": "true" }) : null))),
      actions(button(["Continue", icon("forward")], go.reveal))],
    camouflage: () => [privacyCamouflage(),
      p("A little harder to pick out. A little more privacy.", "pp-lead"),
      actions(button("Skip animation", go.complete))],
    success: () => [routeArt(), p(SUCCESS_LEAD, "pp-lead"),
      actions(button(["Continue to Zigs", icon("forward")], go.close, true))],
  };
  return bodies[screen]();
}

function wireDialog(dialog, close) {
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    const inside = event.clientX >= box.left && event.clientX <= box.right
      && event.clientY >= box.top && event.clientY <= box.bottom;
    if (!inside) close();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); close(); return;
    }
    if (event.key !== "Tab") return;
    const stops = [...dialog.querySelectorAll("button:not(:disabled), a[href], summary")]
      .filter((n) => n.checkVisibility?.() ?? n.getClientRects().length);
    if (!stops.length) return;
    const index = stops.indexOf(document.activeElement);
    event.preventDefault(); event.stopPropagation();
    stops[(index + (event.shiftKey ? -1 : 1) + stops.length) % stops.length].focus();
  });
}

export function installPrivacyPopup() {
  if (controller) return controller;
  let screen = "offer", step = 0, timer = null, epoch = 0, origin = null;
  const status = button("", () => open(status), false, {
    id: "privacy-demo-status", class: "pp-status", "aria-haspopup": "dialog",
    title: DEMO_NOTE + " Open the preview.",
    "aria-label": PILL_TEXT + ". " + DEMO_NOTE + " Open the preview." });
  status.append(el("span", { class: "pp-status-symbol", "aria-hidden": "true" }),
    el("span", { class: "pp-status-text" }, PILL_TEXT));
  const dock = el("div", { class: "pp-header-status", "aria-label": "Connection privacy preview" }, status);
  const dialog = el("dialog", { id: "privacy-demo-popup", class: "privacy-demo-popup",
    "aria-labelledby": "pp-title", "aria-describedby": "pp-demo-note" });
  const announcement = el("div", { class: "pp-sr", role: "status", "aria-live": "polite",
    "aria-atomic": "true" });
  document.body.append(dialog, announcement);

  function mount(root) {
    const app = root.querySelector("#app");
    if (!app) return;
    const host = app.querySelector(".home-masthead") || app.querySelector(".wallet-topbar")
      || app.querySelector(".preferences-heading, .workspace-heading, .messages-heading, "
        + ".swap-heading, .section-heading")
      || app.querySelector("header, .page-head, .launch-card, .lock-card");
    if (host && dock.parentElement !== host) host.append(dock);
  }
  function stop() { epoch++; clearTimeout(timer); timer = null; }
  function show() {
    draw();
    if (!dialog.open) dialog.showModal();
    dialog.querySelector("h2")?.focus();
  }
  function open(opener) {
    origin = opener instanceof HTMLElement ? opener : document.activeElement;
    stop(); screen = "offer"; show();
  }
  function close() { stop(); if (dialog.open) dialog.close(); }
  function begin() {
    stop(); screen = "connecting"; step = 0; show();
    const token = epoch;
    const next = () => {
      if (epoch !== token || screen !== "connecting") return;
      if (step < STEPS.length - 1) { step++; draw(); timer = setTimeout(next, STEP_DELAYS[step]); }
      else reveal();
    };
    timer = setTimeout(next, STEP_DELAYS[0]);
  }
  function reveal() {
    stop(); screen = "camouflage"; show();
    const token = epoch;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    timer = setTimeout(() => {
      if (epoch === token && screen === "camouflage") complete();
    }, reduced ? 900 : CAMOUFLAGE_MS);
  }
  function complete() { stop(); screen = "success"; show(); }
  function draw() {
    const focused = dialog.contains(document.activeElement)
      ? document.activeElement.getAttribute("aria-label") || document.activeElement.textContent
      : null;
    const entering = dialog.getAttribute("data-screen") !== screen;
    dialog.setAttribute("data-screen", screen);
    dialog.replaceChildren(
      el("div", { class: "pp-popup-top" },
        el("div", { class: "pp-kicker" }, el("span", { class: "pp-eyebrow" }, "PRIVACY & NETWORK"),
          el("span", { class: "pp-preview-label" }, "Preview")),
        button(icon("close"), close, false,
          { class: "pp-close", "aria-label": "Close privacy preview" })),
      el("div", { class: "pp-content" + (entering ? " pp-content-enter" : "") },
        el("h2", { id: "pp-title", tabindex: "-1" }, TITLES[screen]),
        ...bodyFor(screen, step, { begin, reveal, complete, close })),
      el("p", { class: "pp-demo-note", id: "pp-demo-note" }, icon("activity"),
        el("span", {}, DEMO_NOTE)));
    if (focused) [...dialog.querySelectorAll("button, summary")]
      .find((node) => (node.getAttribute("aria-label") || node.textContent) === focused)?.focus();
    announcement.textContent = screen === "connecting"
      ? STEPS[step] + ". Preview step." : TITLES[screen];
  }
  dialog.addEventListener("close", () => {
    stop(); screen = "offer";
    if (origin?.isConnected) origin.focus(); else status.focus();
  });
  wireDialog(dialog, close);
  // Keep the global entry from competing with existing wallet dialogs, drawers or mobile menus.
  new MutationObserver(() => {
    status.disabled = !!document.querySelector(".dialog, .drawer, .side.menu-open");
  }).observe(document.querySelector(".shell") || document.body,
    { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  controller = { open, mount };
  mount(document);
  return controller;
}
