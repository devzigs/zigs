// Tor demo. Never imports wallet code, routes traffic, stores a choice or changes wallet data.
// Nothing here is a Tor connection: every text must say demo and must not say protected.
import { CAMOUFLAGE_MS, privacyCamouflage } from "./network-privacy-camouflage.js";

export const PILL_TEXT = "Tor · Demo";
export const DEMO_NOTE = "Demo only: your connection is unchanged. No Tor connection is made.";
export const TITLES = {
  offer: "Try the Tor demo.", connecting: "Demo: starting a private route",
  camouflage: "Demo: blending in.", success: "Demo finished.",
};
const STEPS = ["Starting Tor", "Loading network state", "Establishing a private circuit",
  "Checking wallet services"];
const STEP_DELAYS = [2200, 3000, 4200, 2600];
const OFFER_LEAD = "See how a private connection could look. Tor is not available in this "
  + "version, so this is a demo.";
const SUCCESS_LEAD = "No Tor connection was made. Wallet services can still see your IP address.";
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

function limits() {
  return el("details", { class: "pp-limits" },
    el("summary", { tabindex: "0" }, "What real Tor would protect"),
    p("Real Tor routing can help conceal your direct IP from supported wallet services. "
      + "Network privacy and transaction privacy protect different information."),
    p("The website host and browser gateway can still see your IP. Tor does not prevent "
      + "browser fingerprinting, account identification or all timing correlation."));
}

const stepState = (step, index) =>
  index < step ? "Simulated" : index === step ? "Simulating…" : "Waiting";

function bodyFor(screen, step, go) {
  const bodies = {
    offer: () => [p(OFFER_LEAD, "pp-lead"),
      el("div", { class: "pp-route", "aria-hidden": "true" }, el("span", {}, "Your browser"),
        el("i"), el("strong", {}, "Tor demo"), el("i"), el("span", {}, "Wallet services")),
      actions(button("Start the demo", go.begin, true), button("Close", go.close)), limits()],
    connecting: () => [p("Simulated steps. Nothing is connected.", "pp-lead"),
      el("ol", { class: "pp-steps" }, STEPS.map((name, index) => el("li", {
        class: index < step ? "pp-done" : index === step ? "pp-active" : "",
        "aria-current": index === step ? "step" : null },
      el("span", { "aria-hidden": "true" }, index < step ? "✓" : String(index + 1)),
      name + " · " + stepState(step, index)))),
      actions(button("Continue", go.reveal))],
    camouflage: () => [privacyCamouflage(),
      p("A real Tor connection would help you look like other users. This is only an "
        + "illustration.", "pp-lead"),
      actions(button("Skip animation", go.complete))],
    success: () => [p(SUCCESS_LEAD, "pp-lead"),
      actions(button("Back to Zigs", go.close, true))],
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
    title: DEMO_NOTE + " Open the demo.",
    "aria-label": PILL_TEXT + ". " + DEMO_NOTE + " Open the demo." });
  status.append(el("span", { class: "pp-status-symbol", "aria-hidden": "true" }),
    el("span", { class: "pp-status-text" }, PILL_TEXT));
  const dock = el("div", { class: "pp-header-status", "aria-label": "Tor demo" }, status);
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
    dialog.replaceChildren(
      el("div", { class: "pp-popup-top" }, el("span", { class: "pp-eyebrow" }, "TOR DEMO"),
        button("×", close, false, { class: "pp-close", "aria-label": "Close the Tor demo" })),
      el("h2", { id: "pp-title", tabindex: "-1" }, TITLES[screen]),
      ...bodyFor(screen, step, { begin, reveal, complete, close }),
      el("p", { class: "pp-demo-note", id: "pp-demo-note" }, DEMO_NOTE));
    if (focused) [...dialog.querySelectorAll("button, summary")]
      .find((node) => (node.getAttribute("aria-label") || node.textContent) === focused)?.focus();
    announcement.textContent = screen === "connecting"
      ? STEPS[step] + ". Demo step." : TITLES[screen];
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
