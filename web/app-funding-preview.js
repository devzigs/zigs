// Tab-memory presentation only. Nothing here grants readiness or funding/payment authority.
import { el } from "./app-dom.js";
import { icon } from "./app-icons.js";
import { state, ui } from "./app-state.js";
import { focusAfter, render } from "./app-loop.js";
import { createFundingPreview } from "./funding-preview.js";
import { beginGuided, guidedState, reviewGuided } from "./app-guided-setup.js";
import { openGroup } from "./app-groups.js";

const fundingPreviews = new Map();
let fundingOpenFor = null;
export const fundingSetupActive = (gid) => fundingOpenFor === gid;

function reviewSetup(index) {
  beginGuided(state.gid);
  reviewGuided(index);
  focusAfter("guided-setup", true);
  render();
}

function saveAndExit() {
  fundingOpenFor = null;
  openGroup(null);
  render();
}

function leaveFundingPreview() {
  fundingOpenFor = null;
  ui.tab = "overview";
  focusAfter(fundingPreviews.get(state.gid)?.completed ? "panel-overview" : "funding-resume", true);
  render();
}

function previewFor(gid, name) {
  if (!fundingPreviews.has(gid)) fundingPreviews.set(gid, createFundingPreview({
    el, icon, walletName: name, wallet: state.g, solWanted: guidedState().solWanted,
    onReviewStep: reviewSetup, onSaveExit: saveAndExit,
    onExit: leaveFundingPreview, onComplete: leaveFundingPreview,
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
  const amount = (preview.total / 1_000_000_000).toFixed(3);
  return el("section", { class: "funding-overview-banner surface-quiet",
    "aria-label": "Wallet funding preview" },
    el("div", {}, el("span", { class: "badge plain" }, "Preview"),
      el("strong", {}, "Finish funding your wallet"),
      el("p", { class: "small muted" },
        "Explore the " + amount + " SOL setup allocation. No payment or funding is connected.")),
    el("button", { type: "button", class: "btn", "data-key": "funding-resume",
      onclick: () => { previewFor(gid, name); openFundingPreview(gid); } },
    "Continue funding preview"));
}
