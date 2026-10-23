// Optional setup presentation only. No registrar calls, payment addresses, wallet writes or
// purchase authority. Keep the draft in tab memory; a QR carries explicitly non-payable text.
import { nameOf, zecName } from "./zns.js";
import { qrSvg } from "./qr.js";

const CURRENCIES = [
  { id: "zec", name: "Zcash", unit: "ZEC", amount: "0.10", icon: "zcash" },
  { id: "sol", name: "Solana", unit: "SOL", amount: "0.02", icon: "solana" },
];
export const newNamePreview = () => ({ open: false, name: "", currency: "zec", checkout: false });

/** `el` is the app's existing DOM helper. Callbacks only navigate the tutorial. */
export function znsSetupPreview({ el, draft, onContinue, onBack,
  continueLabel = "Skip for now · Open Overview" }) {
  const root = el("section", { class: "card card-pad guided-card zns-setup", "aria-labelledby": "zns-title" });
  function paint() {
    const name = nameOf(draft.name), currency = CURRENCIES.find((c) => c.id === draft.currency) || CURRENCIES[0];
    const hint = el("p", { id: "zns-name-hint", class: "small muted", role: "status" });
    const input = el("input", { id: "zns-name", type: "text", value: draft.name,
      placeholder: "yourwallet", autocomplete: "off", autocapitalize: "none", spellcheck: "false",
      maxlength: 69, "aria-describedby": "zns-name-hint zns-demo-note", "data-key": "zns-name" });
    const next = el("button", { type: "submit", class: "btn primary", disabled: !name }, "Preview payment");
    function validate() {
      const valid = nameOf(input.value);
      const invalid = input.value.trim() !== "" && !valid;
      input.setAttribute("aria-invalid", String(invalid));
      hint.className = "small " + (invalid ? "bad" : "muted");
      hint.textContent = valid ? zecName(valid) + " · Availability has not been checked."
        : invalid ? "Use 1–63 letters or numbers. You can also enter a .zec or .zcash name."
          : "Choose 1–63 letters or numbers. Availability is not checked in this demo.";
      next.disabled = !valid;
    }
    input.addEventListener("input", () => { draft.name = input.value; draft.checkout = false; validate(); });
    validate();
    const choices = el("fieldset", { class: "zns-currencies" }, el("legend", {}, "Pay with"),
      ...CURRENCIES.map((c) => {
        const radio = el("input", { type: "radio", name: "zns-currency", value: c.id,
          checked: c.id === currency.id, "data-key": "zns-currency-" + c.id,
          onchange: () => { draft.currency = c.id; draft.checkout = false; } });
        return el("label", { class: "zns-currency" }, radio,
          el("img", { src: "/assets/" + c.icon + ".svg", alt: "", width: 28, height: 28 }),
          el("span", {}, el("strong", {}, c.unit), el("span", { class: "small muted" }, c.name)));
      }));
    const form = el("form", { class: "zns-name-form", onsubmit: (event) => {
      event.preventDefault();
      if (!nameOf(draft.name)) return;
      draft.checkout = true; paint();
      root.querySelector(".zns-checkout")?.focus();
    } }, el("label", { class: "field", for: "zns-name" }, "Choose your wallet name",
      el("span", { class: "zns-name-input" }, input, el("span", { "aria-hidden": "true" }, ".zec"))),
    hint, choices, next);
    const actions = el("div", { class: "row-actions zns-actions" },
      el("button", { class: "btn ghost", type: "button", onclick: onBack }, "Back"),
      el("button", { class: "btn", type: "button", onclick: onContinue }, continueLabel));
    root.replaceChildren(
      el("div", { class: "zns-heading" }, el("div", { class: "zns-title" },
        el("span", { class: "label" }, "Make it yours"),
        el("h2", { id: "zns-title" }, draft.checkout && name ? "Name payment preview" : "A name for your wallet")),
        el("span", { class: "badge plain" }, "Optional · Demo")),
      ...(draft.checkout && name ? [] : [el("p", { class: "muted zns-intro" },
        "Try a name for sharing your Zcash address, then preview the checkout.")]),
      el("p", { id: "zns-demo-note", class: "callout warn" },
        "Demo only. No name is reserved or registered. No payment can be made. Amounts are illustrative."),
      draft.checkout && name ? checkout(name, currency) : form,
      el("footer", { class: "zns-footer" },
      el("details", { class: "zns-details" }, el("summary", {}, "About names for shared wallets"),
        el("p", { class: "small muted" }, "ZNS currently lets any device that can read the wallet’s memos control its name. Name changes do not follow this wallet’s approval rule. Registration for shared wallets is not connected in this demo.")),
      actions));
  }
  function checkout(name, currency) {
    const payload = "ZIGS DEMO ONLY — NOT A PAYMENT\nName: " + zecName(name)
      + "\nExample amount: " + currency.amount + " " + currency.unit
      + "\nNo recipient. No registration. Do not send funds.";
    const qr = el("div", { class: "qr zns-demo-qr" });
    qr.innerHTML = qrSvg(payload, "Demo QR for " + zecName(name) + ", example amount "
      + currency.amount + " " + currency.unit + ". Not a payment request.");
    return el("section", { class: "zns-checkout surface-quiet", tabindex: "-1", "aria-label": "Demo payment preview" },
      el("div", { class: "zns-order" }, el("span", { class: "label" }, "Your selected name"),
        el("h3", { class: "zns-selected-name" }, zecName(name)),
        el("span", { class: "small muted" }, "Availability unverified · Registration not connected")),
      el("figure", { class: "zns-qr-figure" }, qr,
        el("figcaption", { class: "small muted" }, "Demo QR · contains a preview, not a payment address")),
      el("div", { class: "zns-payment-details" },
      el("p", { class: "zns-amount" }, currency.amount + " " + currency.unit),
      el("p", { class: "small muted" }, "Illustrative amount · " + currency.name + " · No live quote"),
      el("p", { class: "small" }, "Scanning shows demo details only. No funds are sent and no name is assigned."),
      el("button", { class: "btn", type: "button", onclick: () => {
        draft.checkout = false; paint(); root.querySelector("#zns-name")?.focus();
      } }, "Edit name or payment currency")));
  }
  paint();
  return root;
}
