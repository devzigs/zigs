// Tab-memory presentation only. Nothing here grants readiness or funding/payment authority.
import { el } from "./app-dom.js";
import { icon } from "./app-icons.js";
import { state, ui } from "./app-state.js";
import { focusAfter, render } from "./app-loop.js";
import { createFundingPreview, FUNDING_DEMO_LABEL } from "./funding-preview.js";

const fundingPreviews = new Map();
let fundingOpenFor = null;
export const fundingSetupActive = (gid) => fundingOpenFor === gid;

function leaveFundingPreview() {
  fundingOpenFor = null;
  ui.tab = "overview";
  focusAfter(fundingPreviews.get(state.gid)?.completed ? "panel-overview" : "funding-resume", true);
  render();
}

function previewFor(gid, name) {
  if (!fundingPreviews.has(gid)) fundingPreviews.set(gid, createFundingPreview({
    el, icon, walletName: name, onExit: leaveFundingPreview, onComplete: leaveFundingPreview,
  }));
  const preview = fundingPreviews.get(gid);
  preview.setName(name);
  return preview;
}

export function openFundingPreview(gid = state.gid) {
  if (!gid || gid !== state.gid) return;
  fundingOpenFor = gid;
  ui.tab = "overview";
  focusAfter("funding-heading", true);
  render();
}

export function fundingSetupView(gid, name) {
  if (fundingOpenFor !== gid) return null;
  const preview = previewFor(gid, name);
  // The app will attach this element during the current render.
  queueMicrotask(preview.resume);
  return preview.element;
}

export function fundingOverviewCard(gid, name) {
  const preview = fundingPreviews.get(gid);
  if (!preview || preview.completed) return null;
  return el("section", { class: "funding-overview-banner surface-quiet",
    "aria-label": "Funding demo" },
    el("div", {}, el("span", { class: "badge plain" }, FUNDING_DEMO_LABEL),
      el("strong", {}, "Funding checkout demo"),
      el("p", { class: "small muted" },
        "Try a funding checkout with example amounts. No payment is taken, and your wallet "
        + "works without it.")),
    el("button", { type: "button", class: "btn", "data-key": "funding-resume",
      onclick: () => { previewFor(gid, name); openFundingPreview(gid); } },
    "Open the funding demo"));
}
