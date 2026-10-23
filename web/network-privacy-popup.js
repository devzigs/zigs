// Presentation-only Tor setup. Never imports wallet code, routes traffic or changes wallet data.
import { CAMOUFLAGE_MS, privacyCamouflage } from "./network-privacy-camouflage.js";
const KEY = "zigs-privacy-popup-demo:v1";
const STEPS = ["Starting Tor", "Loading network state", "Establishing a private circuit", "Checking wallet services"];
const STEP_DELAYS = [2200, 3000, 4200, 2600];
let controller = null;
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
  for (const child of children.flat()) if (child != null && child !== false)
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
const p = (content, cls = "") => el("p", { class: cls }, content);
const button = (content, action, primary = false, attrs = {}) => el("button", {
  type: "button", class: "pp-button" + (primary ? " pp-primary" : ""), onclick: action, ...attrs,
}, content);

export function installPrivacyPopup({ autoOpen = true } = {}) {
  if (controller) return controller;
  let mode = "off", screen = "offer", beforeWarning = "offer", step = 0, timer = null, epoch = 0;
  let origin = null, storageNote = "";
  try {
    const record = JSON.parse(localStorage.getItem(KEY));
    if (record?.version === 1 && ["enabled", "standard"].includes(record.choice)) mode = record.choice === "enabled" ? "enabled" : "standard";
  } catch { storageNote = "This browser could not read your saved connection choice."; }
  const statusText = el("span", { class: "pp-status-text" });
  const status = button("", () => open(status), false, { id: "privacy-demo-status", class: "pp-status", "aria-haspopup": "dialog" });
  status.append(el("span", { class: "pp-status-symbol", "aria-hidden": "true" }), statusText);
  const dock = el("div", { class: "pp-header-status", "aria-label": "Connection privacy preview" }, status);
  const dialog = el("dialog", { id: "privacy-demo-popup", class: "privacy-demo-popup", "aria-labelledby": "pp-title", "aria-describedby": "pp-demo-note" });
  const announcement = el("div", { class: "pp-sr", role: "status", "aria-live": "polite", "aria-atomic": "true" });
  document.body.append(dialog, announcement);

  function mount(root) {
    const app = root.querySelector("#app");
    if (!app) return;
    const host = app.querySelector(".home-masthead") || app.querySelector(".wallet-topbar")
      || app.querySelector(".preferences-heading, .workspace-heading, .messages-heading, .swap-heading, .section-heading")
      || app.querySelector("header, .page-head, .launch-card, .lock-card");
    if (host && dock.parentElement !== host) host.append(dock);
  }

  function persist(choice) {
    try { localStorage.setItem(KEY, JSON.stringify({ version: 1, choice })); }
    catch { storageNote = "This browser cannot save the connection choice. You may be asked again next visit."; }
  }
  function stop() { epoch++; clearTimeout(timer); timer = null; }
  function updateStatus() {
    const label = mode === "enabled" ? "Tor Protected · Preview" : mode === "connecting" ? "Connecting · Preview" : "Tor routing off";
    statusText.textContent = label;
    status.dataset.mode = mode;
    status.setAttribute("aria-label", `${label}. Preview only; traffic stays direct. Open privacy controls`);
    status.title = "Preview only · traffic stays direct. Open privacy controls";
    announcement.textContent = label + ". Preview only. Wallet traffic stays direct.";
  }
  function show() {
    draw();
    if (!dialog.open) dialog.showModal();
    dialog.querySelector("h2")?.focus();
  }
  function open(opener) {
    origin = opener instanceof HTMLElement ? opener : document.activeElement;
    screen = mode === "enabled" ? "manage" : "offer";
    show();
  }
  function close() { if (dialog.open) dialog.close(); }
  function requestClose() {
    if (screen === "success" || screen === "manage") { close(); return; }
    if (screen === "warning") return;
    beforeWarning = screen; stop(); screen = "warning"; show();
  }
  function decline() {
    stop(); mode = "standard"; persist("standard"); updateStatus(); close();
  }
  function resume() {
    if (beforeWarning === "connecting") { begin(); return; }
    if (beforeWarning === "camouflage") { reveal(); return; }
    screen = beforeWarning; show();
  }
  function begin() {
    stop(); screen = "connecting"; mode = "connecting"; step = 0; updateStatus(); show();
    const token = epoch;
    const next = () => {
      if (epoch !== token || screen !== "connecting") return;
      if (step < STEPS.length - 1) { step++; draw(); timer = setTimeout(next, STEP_DELAYS[step]); }
      else reveal();
    };
    timer = setTimeout(next, STEP_DELAYS[0]);
  }
  function reveal() {
    stop(); mode = "connecting"; screen = "camouflage"; updateStatus(); show();
    const token = epoch;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    timer = setTimeout(() => { if (epoch === token && screen === "camouflage") complete(); }, reduced ? 900 : CAMOUFLAGE_MS);
  }
  function complete() {
    stop(); mode = "enabled"; persist("enabled"); screen = "success"; updateStatus(); show();
  }
  function details() {
    return el("details", { class: "pp-limits" }, el("summary", { tabindex: "0" }, "What this would protect"),
      p("Real Tor routing can help conceal your direct IP from supported wallet services. Network privacy and transaction privacy protect different information."),
      p("The website host and browser gateway can still see your IP. Tor does not prevent browser fingerprinting, account identification or all timing correlation."));
  }
  function actions(...children) { return el("div", { class: "pp-actions" }, ...children); }
  function draw() {
    const focused = dialog.contains(document.activeElement)
      ? document.activeElement.getAttribute("aria-label") || document.activeElement.textContent : null;
    const titles = { offer: "Make your connection private.", connecting: "Establishing private connection", camouflage: "Blend into the network.",
      success: "Your private route is ready.", warning: "Continue without Tor?", manage: "Privacy & Network" };
    const body = [];
    if (screen === "offer") body.push(
      p("Add Tor routing to help keep your direct IP away from wallet services. You can change your connection anytime.", "pp-lead"),
      el("div", { class: "pp-route", "aria-hidden": "true" }, el("span", {}, "Your browser"), el("i"), el("strong", {}, "Tor"), el("i"), el("span", {}, "Wallet services")),
      actions(button("Turn on private connection", begin, true), button("Use Standard connection", requestClose)),
      details());
    if (screen === "connecting") body.push(p("Preparing your private route.", "pp-lead"),
      el("ol", { class: "pp-steps" }, ...STEPS.map((name, index) => el("li", { class: index < step ? "pp-done" : index === step ? "pp-active" : "",
        "aria-current": index === step ? "step" : null }, el("span", { "aria-hidden": "true" }, index < step ? "✓" : String(index + 1)), name))),
      actions(button("Continue", reveal)));
    if (screen === "camouflage") body.push(privacyCamouflage(),
      p("A little harder to pick out. A little more privacy.", "pp-lead"),
      actions(button("Skip animation", complete)));
    if (screen === "success") body.push(el("div", { class: "pp-success-mark", "aria-hidden": "true" }, "✓"),
      p("Manage your connection anytime from the header or Privacy & Network settings.", "pp-lead"),
      p("Tor Protected · Preview", "pp-success-label"), actions(button("Continue to Zigs", close, true)));
    if (screen === "warning") body.push(
      p("Closing this window means there is no additional privacy routing through Tor. Wallet services may see your IP address.", "pp-warning-copy"),
      p("You can reopen privacy setup from the top-right connection control anytime.", "pp-lead"),
      actions(button("Keep setting up", resume, true), button("Continue without Tor", decline)));
    if (screen === "manage") body.push(p("Tor Protected · Preview", "pp-success-label"),
      p("Your private-connection walkthrough is complete. Actual wallet requests still use the existing direct connection.", "pp-lead"),
      actions(button("Replay private setup", begin, true), button("Use Standard connection", () => { beforeWarning = "manage"; screen = "warning"; show(); })), details());
    dialog.replaceChildren(
      el("div", { class: "pp-popup-top" }, el("span", { class: "pp-eyebrow" }, "NETWORK PRIVACY"),
        button("×", requestClose, false, { class: "pp-close", "aria-label": "Close privacy setup" })),
      el("h2", { id: "pp-title", tabindex: "-1" }, titles[screen]),
      ...body,
      p("Preview only. No Tor connection is created; traffic stays direct.", "pp-demo-note"));
    dialog.querySelector(".pp-demo-note").id = "pp-demo-note";
    if (storageNote) dialog.append(p(storageNote, "pp-storage-note"));
    if (focused) [...dialog.querySelectorAll("button, summary")]
      .find((node) => (node.getAttribute("aria-label") || node.textContent) === focused)?.focus();
    announcement.textContent = screen === "connecting" ? STEPS[step] + ". Connection preview." : titles[screen];
  }
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); requestClose(); });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) requestClose();
  });
  dialog.addEventListener("close", () => { if (origin?.isConnected) origin.focus(); else status.focus(); });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); requestClose(); return;
    }
    if (event.key !== "Tab") return;
    const stops = [...dialog.querySelectorAll("button:not(:disabled), a[href], summary")].filter((n) => n.checkVisibility?.() ?? n.getClientRects().length);
    if (!stops.length) return;
    const index = stops.indexOf(document.activeElement);
    event.preventDefault(); event.stopPropagation(); stops[(index + (event.shiftKey ? -1 : 1) + stops.length) % stops.length].focus();
  });
  // Keep the global entry from competing with existing wallet dialogs, drawers or mobile menus.
  new MutationObserver(() => {
    status.disabled = !!document.querySelector(".dialog, .drawer, .side.menu-open");
  }).observe(document.querySelector(".shell") || document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  controller = { open, status: () => mode, mount };
  mount(document);
  updateStatus();
  if (autoOpen && mode === "off") { origin = status; show(); }
  return controller;
}
