// Presentation only: never selects a transport, stores a preference or gates a wallet.
import { el } from "./app-dom.js";
import { icon } from "./app-icons.js";
import { render } from "./app-loop.js";
import { settingsGroup, settingsRow } from "./app-settings-ui.js";
import { openPrivacyPopup } from "./network-privacy-popup.js";

let panelOpen = false;
export const hasNetworkPrivacy = () => panelOpen;
export const closeNetworkPrivacy = () => { panelOpen = false; };
const openNetworkPrivacy = (event) => {
  if (openPrivacyPopup(event)) return;
  panelOpen = true; render();
};

export function networkPrivacyEntry(place = "header") {
  const header = place === "header";
  return el("button", {
    type: "button", class: header ? "btn ghost sm network-connection-control" : "btn ghost sm",
    "data-key": "network-privacy-" + place,
    "aria-haspopup": "dialog",
    "aria-label": header ? "Standard connection. Open Privacy & Network" : null,
    title: header ? "Direct networking · Integrated Tor is unavailable" : null,
    onclick: openNetworkPrivacy,
  }, header ? icon("browser") : null, header ? "Standard connection" : "Privacy & Network");
}

export function networkPrivacySettings() {
  return settingsGroup("Privacy & Network", settingsRow("Connection privacy preview",
    "Explore the private connection flow. Tor is not connected in this preview; wallet requests stay direct.",
    networkPrivacyEntry("settings")));
}

export function networkPrivacyPanel() {
  return el("section", { id: "network-privacy-panel", class: "dialog network-privacy-panel",
    role: "dialog", "aria-modal": "true", "aria-labelledby": "network-privacy-title",
    "aria-describedby": "network-privacy-summary", tabindex: "-1" },
  el("header", { class: "card-head" },
    el("div", {}, el("p", { class: "label" }, "Your browser connection"),
      el("h2", { id: "network-privacy-title" }, "Privacy & Network")),
    el("button", { class: "icon-btn", type: "button", "data-first-focus": "",
      "aria-label": "Close Privacy & Network", onclick: () => { closeNetworkPrivacy(); render(); } }, "×")),
  el("p", { id: "network-privacy-summary", class: "small muted" },
    "Zigs uses a Standard connection in this version. This panel explains the current connection; it does not change how your wallet connects."),
  el("div", { class: "network-privacy-modes" },
    el("section", { class: "network-privacy-mode", "aria-labelledby": "network-standard-title" },
      el("div", { class: "network-privacy-mode-heading" },
        el("h3", { id: "network-standard-title" }, "Standard connection"),
        el("span", { class: "badge plain" }, "Current app networking")),
      el("p", { class: "small muted" }, "Connect directly for wallet synchronization. Wallet services may see your IP address.")),
    el("section", { class: "network-privacy-mode", "aria-labelledby": "network-private-title" },
      el("div", { class: "network-privacy-mode-heading" },
        el("h3", { id: "network-private-title" }, "Private connection · Tor"),
        el("span", { class: "badge plain" }, "Unavailable")),
      el("p", { class: "small muted" }, "Integrated Tor is not available in this version. Zigs cannot route your wallet traffic through Tor from this panel."))),
  el("details", { class: "network-privacy-limits", "data-key": "network-privacy-limits" },
    el("summary", { tabindex: "0" }, "What network privacy protects"),
    el("div", {},
      el("p", { class: "small muted" }, "Network privacy concerns your connection and IP address. Transaction privacy concerns what your blockchain activity reveals. Shielded transactions do not hide your IP from the services you contact."),
      el("p", { class: "small muted" }, "An integrated browser Tor connection would still expose your IP to the initial website host and browser gateway. Tor does not prevent browser fingerprinting, account identification, compromised devices or every form of timing correlation."))),
  el("section", { class: "network-privacy-preview", "aria-label": "Future connection flow preview" },
    el("h3", {}, "Explore the proposed connection flow"),
    el("p", { class: "small muted", id: "network-privacy-preview-note" },
      "Interactive design preview only · No Tor connection or wallet activity. Opening it leaves this wallet’s connection unchanged."),
    el("a", { class: "btn ghost sm", href: "/?demo=privacy", target: "_blank", rel: "noopener noreferrer", tabindex: "0",
      "aria-describedby": "network-privacy-preview-note" }, "Open design preview ↗")));
}
