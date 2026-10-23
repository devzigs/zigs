// Shared presentation only. Progress never grants wallet readiness or payment authority.
import { SETUP_STAGES } from "./setup-model.js";

export function setupHeader(el, wallet, solWanted, onExit) {
  return el("header", { class: "guided-header" },
    el("div", {}, el("span", { class: "label" }, "Zigs · guided wallet setup"),
      el("h1", {}, wallet.name),
      el("p", { class: "small muted" }, "Zcash " + (wallet.network || "testnet")
        + (solWanted ? " · Solana Devnet" : "") + " · Any " + wallet.t + " of " + wallet.n + " devices")),
    el("button", { class: "btn ghost", type: "button", onclick: onExit }, "Save and exit"));
}

export function setupProgress(el, index, review, onReview, stages = SETUP_STAGES) {
  const shown = review ?? index;
  return el("nav", { class: "guided-progress", "aria-label": "Wallet setup progress" },
    el("p", { class: "guided-mobile-stage sr-only", role: "status" },
      "Step " + (shown + 1) + " of " + stages.length + ": " + stages[shown] + "."
        + (shown === 1 ? " Every device joins with the invite link." : "")),
    el("ol", {}, stages.map((name, i) => el("li", {
      class: i === shown ? "current" : i < index ? "done" : "",
      "aria-current": i === shown ? "step" : null },
    onReview && i <= index ? el("button", { type: "button", class: "guided-stage-button",
      onclick: () => onReview(i) }, el("span", { "aria-hidden": "true" }, i < index ? "✓" : String(i + 1)), name)
      : el("span", {}, el("span", { "aria-hidden": "true" }, i < index ? "✓" : String(i + 1)), name)))));
}
