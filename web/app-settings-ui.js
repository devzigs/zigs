// Shared Settings presentation. Preferences still use their existing owners and persistence.
import { icon } from "./app-icons.js";
import { el } from "./app-dom.js";
import { ui } from "./app-state.js";
import { toggleNotify } from "./app-messages.js";
import { render } from "./app-loop.js";
import { themeChoice } from "./app-theme.js";

export const settingsGroup = (title, ...rows) => el("section", { class: "preferences-group",
  "aria-label": title }, el("h3", {}, title), el("div", { class: "preferences-surface" }, ...rows));

export const settingsLabel = (title, description) => el("span", { class: "preference-label" },
  el("span", { class: "preference-title" }, title),
  description ? el("span", { class: "preference-description" }, description) : null);

export const settingsRow = (title, description, control) => el("div", { class: "preference-row" },
  settingsLabel(title, description), el("div", { class: "preference-control" }, control));

export const settingsDisclosure = (title, description, ...content) => el("details", {
  class: "preference-disclosure" }, el("summary", { class: "preference-row" },
  settingsLabel(title, description), el("span", { class: "preference-chevron", "aria-hidden": "true" }, icon("chevronRight"))),
el("div", { class: "preference-detail" }, ...content));

let notificationPending = false, notificationError = "";
function notificationSetting() {
  const supported = "Notification" in window;
  const permission = supported ? Notification.permission : "unsupported";
  const enabled = ui.notify && permission === "granted";
  const status = !supported ? "Unavailable in this browser" : permission === "denied"
    ? "Blocked by browser" : enabled ? "Enabled" : permission === "granted"
      ? "Disabled in Zigs · browser permission granted" : "Browser permission needed";
  const description = "Receive message alerts while Zigs is open. " + (permission === "denied"
    ? "Allow notifications in your browser’s site settings to enable them here." : "Applies to this browser.");
  const toggle = async () => {
    if (notificationPending) return;
    notificationPending = true; notificationError = ""; render();
    try { await toggleNotify(); }
    catch { notificationError = "Notifications could not be enabled. Check your browser’s site permissions and try again."; }
    finally { notificationPending = false; render(); }
  };
  return settingsRow("Notifications", description,
    el("div", { class: "preference-notifications" },
      el("span", { class: "preference-state", role: "status" }, status),
      supported ? el("button", { class: "btn sm", type: "button", onclick: toggle,
        disabled: notificationPending || permission === "denied" && !ui.notify,
        "aria-label": ui.notify ? "Turn off notifications in Zigs" : "Enable notifications",
        "aria-describedby": notificationError ? "settings-notification-error" : null,
      }, notificationPending ? "Updating…" : ui.notify ? "Turn off" : "Enable") : null,
      notificationError ? el("p", { class: "preference-error", id: "settings-notification-error",
        role: "alert" }, notificationError) : null));
}

export function generalSettings(...extra) {
  return settingsGroup("General",
    settingsRow("Appearance", "Choose how Zigs looks on this browser.", themeChoice()),
    notificationSetting(), ...extra);
}
