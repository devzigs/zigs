// Isolated fixture uses the exact application component. No wallet records or service calls.
import { createFundingPreview } from "../../funding-preview.js";
import { icon } from "../../app-icons.js";

const mount = document.getElementById("funding-fixture");
const el = (tag, attrs = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of kids.flat()) if (child != null && child !== false)
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
};
let started = false;
const preview = createFundingPreview({ el, icon, walletName: "Savings wallet",
  onExit: overview, onComplete: overview });
function openFunding(focus = true) {
  started = true;
  mount.className = "page guided-setup funding-setup-page";
  mount.replaceChildren(preview.element);
  preview.resume();
  if (focus) mount.querySelector("[data-funding-heading]")?.focus();
}
function overview() {
  mount.className = "page";
  mount.replaceChildren(el("section", { class: "fixture-overview" },
    el("span", { class: "label" }, "Savings wallet · design preview"),
    el("h1", {}, "Overview"),
    el("p", { class: "muted" }, "No real wallet is loaded. Funding and payment actions are simulated."),
    preview.completed ? null : el("section", { class: "funding-overview-banner surface-quiet" },
      el("div", {}, el("span", { class: "badge plain" }, "Preview"),
        el("strong", {}, "Finish funding your wallet"),
        el("p", { class: "small muted" }, (preview.total / 1_000_000_000).toFixed(3) + " SOL allocation · actual balances unchanged")),
      el("button", { class: "btn", type: "button", onclick: openFunding },
        started ? "Resume funding preview" : "Continue to funding preview")),
    el("div", { class: "fixture-balance card card-pad" },
      el("span", { class: "small muted" }, "Example balances · unchanged by the demo"),
      el("strong", {}, "0 ZEC · 0 SOL"))));
}
document.getElementById("fixture-overview").addEventListener("click", overview);
document.getElementById("fixture-theme").addEventListener("click", (event) => {
  const dark = document.documentElement.dataset.theme !== "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  event.currentTarget.textContent = dark ? "Light appearance" : "Dark appearance";
});
openFunding(false);
