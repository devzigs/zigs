// Presentational grammar only. No subscriptions, persistence or protocol state.
import { el } from "./app-dom.js";
import { icon } from "./app-icons.js";

// SEMANTICS MAP
// Neutral, separated nodes: supplied device labels, never online/verified/approved status.
// In preview mode only, nodes describe proposed devices, explicitly labelled illustration.
// Dashed boundary: a wallet's configured group, never an enclosure for a complete key.
// Steel relations: conceptual cooperation, never network traffic or signing progress.
// Open ring + t/n: the configured rule, never threshold reached or transaction completion.
// Actual configurations stay static. Explicit setup examples may illustrate possible groups.
// Zcash spending-key copy is scoped explicitly; viewing access is a separate capability.
export function distributedSecurity({ n, t, devices = [], walletName = "This wallet",
  preview = false, illustrate = false }) {
  const valid = Number.isInteger(n) && Number.isInteger(t) && n >= 2 && n <= 7 && t >= 2 && t <= n;
  if (!valid) return el("figure", { class: "distributed-security" },
    el("figcaption", { class: "small muted" }, "The approval arrangement is unavailable."));
  const examples = preview && illustrate;
  return el("figure", { class: "distributed-security", "data-security-mode": preview ? "education" : "configuration" },
    el("figcaption", { class: "security-caption" },
      el("span", { class: "label" }, preview ? "Illustration · proposed arrangement" : "Wallet configuration · Zcash"),
      el("strong", { "data-preview-wallet": preview ? "" : null }, walletName)),
    el("div", { class: "security-group" },
      el("p", { class: "label security-group-label" }, "Independent signing shares"),
      devices.length ? el("ul", { class: "security-nodes", role: "list",
        "data-education": examples ? "approval" : null,
        "data-education-value": examples ? n + ":" + t : null }, devices.map(({ label, detail }, i) =>
        el("li", { class: "security-node" + (examples && i < t ? " example-selected" : ""),
          "data-education-mark": examples ? String(i) : null },
          el("span", { class: "security-node-mark", "aria-hidden": "true" },
            icon(preview && i % 2 === 0 ? "phone" : "devices")),
          el("div", { class: "security-node-copy" },
            el("strong", { "data-preview-device": preview && i === 0 ? "" : null }, label),
            el("span", { class: "small muted" }, detail)))))
        : el("p", { class: "small muted" }, "Device details are not available here. Check the device list below.")),
    el("div", { class: "security-rule" },
      el("span", { class: "security-rule-ring", "aria-hidden": "true" },
        el("strong", {}, String(t)), el("span", {}, "/ " + n)),
      el("div", {}, el("span", { class: "label" }, "Approval rule"),
        el("strong", {}, "Any " + t + " of " + n + " devices together"),
        examples ? null : el("p", { class: "small muted" },
          "A rule for authorizing payments, not a live approval status."))),
    el("div", { class: "security-meaning" },
      el("p", {}, "No single device holds the complete spending key for Zcash."),
      el("p", { class: "small muted" }, "Shares stay separate during signing. They contribute to an authorization, without assembling a complete spending key.")),
    el("p", { class: "security-footnote small muted" }, examples
      ? "Orange outlines are examples, not real approvals. Any " + t
        + " devices could sign together. All " + n + " join setup."
      : preview
      ? "Proposed device labels are examples, not connected devices or payment approvals. All chosen devices take part in setup."
      : "Names identify configured devices; they do not verify identity, availability or approval. Viewing wallet activity is separate from spending authorization."));
}
