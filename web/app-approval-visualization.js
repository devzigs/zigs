// Presentation only: callers supply the existing payment facts, never membership/connectivity.
// Standalone DOM builder keeps this display component independent of wallet actions/state.
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false)
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
};

// Neutral hardware geometry denotes a configured participant, never online presence.
export const SignerConnection = () => el("span", { class: "signer-connection", "aria-hidden": "true" });
export function SignerNode({ id, name, detail, received = false, joined = true, motionValue }) {
  return el("li", { class: "signer-node approval-device" + (received ? " received" : "")
    + (joined ? "" : " unjoined"),
    "data-motion-watch": motionValue === undefined ? null : "approval:zec:" + id,
    "data-motion-value": motionValue },
    SignerConnection(),
    el("span", { class: "approval-node signer-hardware", "aria-hidden": "true", "data-motion-mark": "" },
      el("span", { class: "signer-hardware-face" }, received ? "✓" : String(id))),
    el("span", { class: "signer-node-name approval-device-name" }, name),
    el("span", { class: "signer-node-state approval-device-state" }, detail));
}

export const ThresholdIndicator = ({ required, total }) => el("div", { class: "threshold-indicator" },
  el("span", { class: "threshold-numeral", "aria-hidden": "true" }, String(required),
    el("span", {}, " / " + total)),
  el("div", {}, el("strong", {}, required + " approvals required"),
    el("span", {}, "From " + total + " configured devices")));

/** Configuration only. Joined records never stand in for transaction approval or connectivity. */
export function SharedControlVisual({ required, total, participants = [], loaded = false }) {
  const joined = participants.filter((p) => p.joined).length;
  return el("section", { class: "shared-control", "aria-label": "Shared control configuration" },
    el("div", { class: "shared-control-heading" }, el("span", { class: "label" }, "Distributed custody"),
      el("h3", {}, "Shared control")),
    ThresholdIndicator({ required, total }),
    total <= 7 && participants.length === total
      ? el("ol", { class: "shared-control-nodes", "aria-label": "Configured devices" },
        participants.map((p) => SignerNode({ ...p, detail: !loaded ? "Reading record" : p.joined ? "Joined" : "Not joined" })))
      : el("p", { class: "small muted" }, "Individual device records are unavailable."),
    el("div", { class: "shared-control-foot" },
      el("p", { class: "shared-control-joined" }, loaded ? joined + " of " + total + " devices joined" : "Reading joined devices…"),
      el("p", {}, "Devices cooperate to authorise payments. Signing shares stay separate."),
      el("p", { class: "shared-control-disclosure" }, "Joined does not mean online or approved. This is your wallet configuration, not payment progress.")));
}

/** Approval records are distinct from signing shares, submission and network confirmation.
 * `participants` is optional and contains only already-visible device labels and approval facts.
 * Without those facts the component renders an aggregate, never invented device statuses.
 */
export function ApprovalVisualization({ required, total, confirmed, stage, participants,
  error = false, isBusy = false, context = "" }) {
  const known = Number.isInteger(confirmed) && confirmed >= 0 && confirmed <= total;
  const count = known ? confirmed + " of " + required : "Count unavailable";
  const summary = (known ? confirmed + " of " + required + " required approvals received. "
    : "Approval count unavailable. ") + (isBusy ? "Checking approval records. " : "")
    + stage.title + ". " + stage.detail;
  const individual = known && total <= 5 && participants?.length === total
    && participants.every((p) => typeof p.confirmed === "boolean")
    && participants.filter((p) => p.confirmed).length === confirmed;
  const tone = error ? "attention" : isBusy ? "checking" : "active";
  return el("section", { class: "approval-visualization " + tone,
    "aria-label": "Payment approval progress", "data-approval-context": context,
    "data-approval-summary": summary },
  el("div", { class: "approval-policy" },
    el("span", {}, "Approval rule"), el("strong", {}, required + " of " + total + " devices")),
  el("div", { class: "approval-stage" },
    el("div", { class: "approval-count" }, el("strong", {}, count),
      el("span", {}, known ? "required approvals received" : "Approval records not available")),
    el("p", { class: "approval-current" }, stage.title),
    isBusy ? el("p", { class: "small muted" }, "Checking approval records…") : null),
  individual ? el("ol", { class: "approval-constellation", "aria-label": "Device approval records" },
    participants.map((p) => SignerNode({ ...p, received: p.confirmed,
      detail: p.confirmed ? "Approval recorded" : "Not received",
      motionValue: error || isBusy ? "unknown" : p.motionValue })))
    : el("div", { class: "approval-aggregate" },
      el("p", {}, known ? confirmed + " approval records received across " + total + " devices."
        : "Individual approval records are unavailable."),
      el("p", { class: "small muted" }, "Aggregate progress · no individual device status shown")),
  el("p", { class: "approval-legend" },
    (individual ? "✓ Approval received · · Not received. Device positions are illustrative, not network connections. "
      : "Approval records are shown as a count, not individual device status. ")
    + "Approvals do not mean the payment is signed, submitted or in a block."));
}

// The app rebuilds its drawer on redraw. Keep one live region outside that replaced subtree,
// within the persistent modal host. Announce only changed summaries for the same open payment.
let live, previous;
export function announceApprovalProgress(document) {
  const panel = document.querySelector(".approval-visualization");
  if (!panel) { live?.remove(); live = null; previous = null; return; }
  const context = panel.dataset.approvalContext, summary = panel.dataset.approvalSummary;
  if (!live?.isConnected) {
    live = el("div", { class: "sr-only", role: "status", "aria-live": "polite", "aria-atomic": "true" });
    document.getElementById("app").after(live);
  }
  // aria-modal restricts exploration to the dialog; explicitly own the persistent announcement.
  live.id = "payment-approval-announcement";
  panel.closest("[role=dialog]")?.setAttribute("aria-owns", live.id);
  if (previous?.context === context && previous.summary !== summary) live.textContent = summary;
  else if (previous?.context !== context) live.textContent = "";
  previous = { context, summary };
}
