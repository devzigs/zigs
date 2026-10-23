// Membership presentation only. No connectivity, payment approval or signature inference.
import { el } from "./app-dom.js";

export function sharedControl({ required, total, participants, status, context, openSecurity,
  attention = false }) {
  const joined = participants.filter((p) => p.joined === true).length;
  const checking = participants.some((p) => p.joined === null);
  return el("section", { class: "shared-control", "aria-labelledby": "shared-control-title" },
    el("div", { class: "shared-control-heading" },
      el("h2", { id: "shared-control-title" }, "Shared control"),
      el("span", { class: "shared-control-status" + (attention ? " attention" : "") }, status)),
    el("p", { class: "shared-control-rule" }, el("strong", {}, String(required)),
      el("span", {}, "approvals required")),
    el("p", { class: "shared-control-participation" }, total + " participating devices · "
      + (checking ? "Checking membership" : joined + " joined")),
    el("ol", { class: "custody-devices", "aria-label": "Wallet participants" },
      participants.map((p) => el("li", { class: "custody-device "
        + (p.joined === true ? "joined" : "invited"),
        "data-motion-watch": "membership:" + context + ":" + p.id,
        "data-motion-value": p.joined === null ? "unknown" : p.joined ? "on" : "off" },
      el("span", { class: "custody-node", "aria-hidden": "true", "data-motion-mark": "" },
        String(p.id).padStart(2, "0")),
      el("span", { class: "custody-device-name" }, p.name),
      el("span", { class: "custody-device-state" },
        p.joined === null ? "Checking" : p.joined ? "Joined" : "Not joined")))),
    el("div", { class: "shared-control-footer" },
      el("p", {}, "Membership is separate from payment approvals."),
      el("button", { class: "btn ghost sm", type: "button", onclick: openSecurity },
        "Security", el("span", { "aria-hidden": "true" }, "↗"))));
}
