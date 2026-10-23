// Funding checkout demo. Uses local QR rendering and name validation only. It asks for no
// payment and no step of the wallet setup depends on it.
import { qrSvg } from "./qr.js";
import { nameOf, zecName } from "./zns.js";

export const FUNDING_DEMO_LABEL = "Demo, no payment";
export const FUNDING_DEMO_NOTE = "No funds move and no balance changes. These amounts are "
  + "examples: Zigs asks for no setup payment.";
export const FUNDING_ALLOCATION = Object.freeze([
  { id: "activation", label: "Zigs activation", lamports: 50_000_000,
    note: "Example only: Zigs charges no such fee", kind: "service" },
  { id: "privacy", label: "Privacy routing", lamports: 30_000_000,
    note: "Privacy pool entry and payouts", kind: "processing" },
  { id: "fee", label: "SOL & USDC fees and setup", lamports: 10_000_000,
    note: "Operating balance for the primary fee-paying device", kind: "balance" },
  { id: "messaging", label: "Zcash messaging", lamports: 13_000_000,
    note: "Initial ZEC balance for approximately 10 short messages", kind: "balance" },
  { id: "bridge", label: "Bridge & funding costs", lamports: 10_000_000,
    note: "SOL-to-ZEC conversion and funding transactions", kind: "processing" },
  { id: "buffer", label: "Operating buffer", lamports: 37_000_000,
    note: "Reserve for variable processing and setup costs", kind: "reserve" },
].map(Object.freeze));
export const FUNDING_TOTAL = FUNDING_ALLOCATION.reduce((sum, row) => sum + row.lamports, 0);
export const FUNDING_NAME_ALLOCATION = Object.freeze({ id: "name", label: "Zcash name",
  lamports: 20_000_000, note: "Mock name budget only · not the registrar price · no registration", kind: "service" });
// Published ZcashMe ZNS schedule, checked 23 October 2026. No conversion or quote service.
const NAME_FEES = [["1", 10_000], ["2", 2_500], ["3", 800], ["4", 400], ["5", 100], ["6+", 20]];
const usd = (amount) => "$" + amount.toLocaleString("en-US");
const solAmount = (amount) => (amount / 1_000_000_000).toFixed(3);
export function fundingDemoQrPayload(amount = FUNDING_TOTAL, zcashName = null) {
  return "ZIGS FUNDING DEMO - NOT A PAYMENT\nExample amount: " + solAmount(amount)
    + " SOL\nNo recipient address. Do not send funds."
    + (zcashName ? "\nOptional name: " + zecName(zcashName) + "\nNo name is registered." : "");
}
export const FUNDING_DEMO_QR_PAYLOAD = fundingDemoQrPayload();
const FUNDING_STEPS = [
  ["Payment confirmed", "Recognize the setup payment"],
  ["Privacy routing", "Process pool entry and funding payouts"],
  ["SOL fee account", "Allocate SOL for fees and account setup"],
  ["Zcash messaging", "Allocate the starting messaging balance"],
];

/** Only local demo state changes. Callbacks navigate the host presentation. */
export function createFundingPreview({ el, icon, walletName = "Your wallet",
  onExit = () => {}, onComplete = () => {}, stepDelay = 800 }) {
  let stage = "allocation", pane = "costs", progress = 0, timer = null, name = walletName;
  let includeName = false, nameDraft = "";
  const setupTotal = () => FUNDING_TOTAL + (includeName ? FUNDING_NAME_ALLOCATION.lamports : 0);
  const nameNeeded = () => includeName && !nameOf(nameDraft);
  const root = el("section", { class: "funding-preview", "data-funding-preview": "",
    "aria-label": "Funding demo" });
  const mark = (id) => icon ? icon(id) : null;
  const source = (label, href) => el("a", { href, target: "_blank", rel: "noopener noreferrer",
    referrerpolicy: "no-referrer" }, label, el("span", { "aria-hidden": "true" }, " ↗"));
  const button = (label, fn, primary = false, key = "") => el("button", {
    type: "button", class: "btn" + (primary ? " primary" : " ghost"),
    "data-key": key || null, onclick: fn,
  }, label);
  function stop() { clearTimeout(timer); timer = null; }
  function show(next, nextPane = "costs") {
    stop(); stage = next;
    if (next === "allocation") pane = nextPane;
    paint();
    root.querySelector("[data-funding-heading]")?.focus({ preventScroll: true });
  }
  function exit() { stop(); onExit(); }
  function resume() {
    if (stage !== "progress" || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      if (!root.isConnected || stage !== "progress") return;
      progress++;
      if (progress === FUNDING_STEPS.length) show("complete");
      else { paint(); resume(); }
    }, stepDelay);
  }
  function beginDemo() { progress = 0; show("progress"); resume(); }
  function heading(title, copy) {
    return el("div", { class: "funding-heading" },
      el("h2", { tabindex: "-1", "data-funding-heading": "",
        "data-key": "funding-heading" }, title),
      el("p", { class: "muted" }, copy));
  }
  function frame(title, copy, body, actions, variant = "") {
    return el("div", { class: "funding-stage card " + variant },
      heading(title, copy), body, actions);
  }
  function total() {
    return el("div", { class: "funding-total surface-quiet" },
      el("span", { class: "small" }, "Example setup amount (demo)"),
      el("div", {}, el("strong", { "data-funding-total": "" }, solAmount(setupTotal())), el("span", {}, "SOL")));
  }
  function fundingTabs() {
    const select = (next) => {
      pane = next; paint();
      root.querySelector('[data-key="funding-pane-' + next + '"]')?.focus({ preventScroll: true });
    };
    return el("div", { class: "funding-mobile-tabs", role: "tablist", "aria-label": "Funding information" },
      [["costs", "Costs"], ["name", "Zcash name"], ["privacy", "Private funding"]].map(([id, label], index, tabs) =>
        el("button", { type: "button", role: "tab", "aria-selected": String(pane === id),
          "aria-controls": "funding-panel-" + id, id: "funding-tab-" + id,
          tabindex: pane === id ? "0" : "-1", "data-key": "funding-pane-" + id,
          onclick: () => select(id), onkeydown: (event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            select(event.key === "Home" ? "costs" : event.key === "End" ? "privacy"
              : tabs[(index + (event.key === "ArrowLeft" ? -1 : 1) + tabs.length) % tabs.length][0]);
          } }, label)));
  }
  function syncNameForm() {
    const input = root.querySelector("#funding-zcash-name"), hint = root.querySelector("#funding-name-hint");
    if (!input || !hint) return;
    const invalid = !!nameNeeded();
    input.setAttribute("aria-invalid", String(invalid));
    hint.className = "funding-name-hint " + (invalid ? "bad" : "muted");
    hint.textContent = invalid ? nameDraft.trim()
      ? "Use 1–63 letters or numbers, or leave the name out."
      : "Enter a name, or untick to leave it out."
      : "Availability unchecked. Registration is simulated.";
    const length = nameOf(nameDraft)?.length;
    for (const card of root.querySelectorAll("[data-name-length]")) {
      card.dataset.selected = String(card.dataset.nameLength === (length >= 6 ? "6+" : String(length)));
    }
    for (const b of root.querySelectorAll(".funding-payment-methods>.btn")) b.disabled = invalid;
  }
  function nameOption() {
    const input = el("input", { id: "funding-zcash-name", type: "text", value: nameDraft,
      placeholder: "yourwallet", autocomplete: "off", autocapitalize: "none", spellcheck: "false",
      maxlength: 69, "aria-describedby": "funding-name-hint", "data-key": "funding-zcash-name",
      oninput: (event) => { nameDraft = event.currentTarget.value; syncNameForm(); },
      onblur: (event) => {
        const normalized = nameOf(nameDraft);
        if (normalized) { nameDraft = normalized; event.currentTarget.value = normalized; }
      } });
    return el("section", { class: "funding-name-panel", id: "funding-panel-name", role: "tabpanel",
      "aria-labelledby": "funding-name-title" },
      el("header", {}, el("h2", { id: "funding-name-title" }, "Zcash name"),
        el("span", { class: "badge plain" }, "Optional")),
      el("p", { class: "funding-name-intro muted" }, "Share a memorable .zec name that points to your Zcash address. Demo: no name is registered."),
      el("p", { class: "funding-name-provider" },
        source("Zcash Names (ZNS)", "https://www.zcashnames.com/"), " · by ZcashMe"),
      el("dl", { class: "funding-name-fees", "aria-label": "Zcash Names annual registration prices in USD (demo)" },
        NAME_FEES.slice(3).map(([length, amount]) => el("div", { "data-name-length": length },
          el("dt", {}, length + " characters"), el("dd", {}, usd(amount), el("span", {}, " / year"))))),
      el("p", { class: "funding-name-term muted" }, "USD prices · “Forever” costs 3× the yearly fee."),
      el("label", { class: "funding-name-field", for: "funding-zcash-name" }, "Choose your name",
        el("span", { class: "funding-name-input" }, input, el("span", { "aria-hidden": "true" }, ".zec"))),
      el("p", { class: "funding-name-hint muted", id: "funding-name-hint" }),
      el("label", { class: "funding-name-choice" },
        el("input", { id: "funding-include-name", type: "checkbox", checked: includeName,
          "data-key": "funding-include-name", onchange: (event) => {
            includeName = event.currentTarget.checked; paint();
            root.querySelector("#funding-include-name")?.focus({ preventScroll: true });
          } }),
        el("span", {}, el("strong", {}, "Include with setup"),
          el("span", { class: "small muted" }, "+" + solAmount(FUNDING_NAME_ALLOCATION.lamports) + " SOL · Mock budget, not registrar fee"))),
      el("p", { class: "funding-name-summary small", role: "status" },
        includeName ? "Included · Total " + solAmount(setupTotal()) + " SOL" : "No name added · Total 0.150 SOL"),
      el("div", { class: "funding-name-links" },
        button("All name fees", () => show("name-fees")),
        button("Name ownership & privacy", () => show("name-info"))));
  }
  function nameFees() {
    return frame("Zcash name fees.", "Zcash Names by ZcashMe · published USD pricing",
      el("div", { class: "funding-body funding-name-fee-guide" },
        el("p", { class: "muted" }, "ZNS links a .zec or .zcash name to your Zcash address. Shorter names cost more; the suffix is not counted."),
        el("table", { class: "funding-name-fee-table" },
          el("caption", { class: "sr-only" }, "Published name registration fees in US dollars"),
          el("thead", {}, el("tr", {}, ["Characters", "1 year", "Forever"].map((text) => el("th", { scope: "col" }, text)))),
          el("tbody", {}, NAME_FEES.map(([length, amount]) => el("tr", {},
            el("th", { scope: "row" }, length), el("td", {}, usd(amount)), el("td", {}, usd(amount * 3)))))),
        el("p", { class: "muted" }, "ZNS converts USD to ZEC at its rate. Network fees are extra. The mock’s 0.020 SOL budget is not a registration quote."),
        el("nav", { class: "funding-sources", "aria-label": "Zcash Names references" },
          source("Provider & terms", "https://www.zcashnames.com/"),
          source("Pricing docs", "https://www.zcashnames.com/docs/protocol/pricing"))),
      footer("Back to funding", () => show("allocation", "name"), "Finish later", exit));
  }
  function nameInfo() {
    return frame("About your Zcash name.", "Optional · demo only.",
      el("div", { class: "funding-body funding-name-info" },
        el("p", {}, "The name points to a Zcash address and makes it easier to share. Adding it can make the address more recognizable."),
        el("p", {}, "ZNS currently lets any device that can read the wallet memos control the name. Name changes do not follow this wallet’s approval rule. The name registry is public: anyone can read the name and its address."),
        el("p", { class: "muted" }, "The 0.020 SOL mock budget is not the Zcash Names registrar price. Availability is unchecked. This demo registers no name.")),
      footer("Back to funding", () => show("allocation", "name"), "Finish later", exit));
  }
  function privateFunding() {
    return el("section", { class: "funding-private-panel", id: "funding-panel-privacy", role: "tabpanel",
      "aria-labelledby": "funding-private-title" },
      el("h2", { id: "funding-private-title" }, mark("lock"), "How private funding could work (demo)"),
      el("ol", { class: "funding-private-steps", "aria-label": "Private funding flow (demo)" },
        el("li", {}, el("strong", {}, "Pool deposit. "),
          "SOL joins Privacy Cash’s shared pool instead of funding accounts directly."),
        el("li", {}, el("strong", {}, "Private payouts. "),
          "A relayer uses zero-knowledge proofs to pay new addresses without exposing the matching deposit."),
        el("li", {}, el("strong", {}, "Account funding. "),
          "Zigs funds SOL fees and bridges messaging funds to shielded ZEC.")),
      el("p", { class: "funding-privacy-limits" },
        "Deposits, public payouts and timing stay visible; patterns can suggest links. "
        + "Zigs knows your payment and destinations; providers see metadata. No anonymity guarantee. "
        + "Demo only: this funding flow is not available in this version and no provider is connected."),
      el("nav", { class: "funding-sources", "aria-label": "Privacy Cash protocol references" },
        source("Privacy Cash", "https://www.privacycash.org/"),
        source("Docs", "https://privacycash.mintlify.app/"),
        source("GitHub", "https://github.com/Privacy-Cash/privacy-cash-sdk")));
  }
  function allocations() {
    return el("dl", { class: "funding-allocations", "aria-label": "Setup allocation" },
      [...FUNDING_ALLOCATION, ...(includeName ? [FUNDING_NAME_ALLOCATION] : [])].map((row) =>
        el("div", { "data-funding-allocation": row.id },
          el("dt", {}, row.label),
          el("dd", {}, solAmount(row.lamports), el("span", {}, " SOL")))));
  }
  function costDetails(page) {
    return frame("What each cost covers.", "Fixed planning allocations · " + (page + 1) + " of 2",
      el("dl", { class: "funding-body funding-cost-details" },
        FUNDING_ALLOCATION.slice(page * 3, page * 3 + 3).map((row) =>
          el("div", {}, el("dt", {}, el("strong", {}, row.label),
            el("span", {}, solAmount(row.lamports) + " SOL")),
          el("dd", {}, row.note)))),
      page === 0 ? footer("Next", () => show("costs2"),
        "Back to breakdown", () => show("allocation"))
        : footer("Done", () => show("allocation"), "Previous", () => show("costs1")));
  }
  function footer(primary, action, secondary = "Finish later", back = exit) {
    return el("footer", { class: "funding-actions" },
      button(primary, action, true, "funding-next"),
      button(secondary, back, false, "funding-back"));
  }
  function allocationView() {
    return frame("Funding checkout demo.",
      "Demo, no payment. Try how a funding checkout could look; nothing is charged.",
      el("div", { class: "funding-body funding-checkout-body" }, fundingTabs(),
        el("section", { class: "funding-budget", id: "funding-panel-costs", role: "tabpanel",
          "aria-labelledby": "funding-tab-costs" },
          total(), allocations(),
          el("div", { class: "funding-detail-links" }, button("Cost details", () => show("costs1")),
            el("span", { class: "small muted" }, "Fixed allocation"))), nameOption(), privateFunding()),
      el("footer", { class: "funding-payment-footer" },
        el("div", { class: "funding-payment-methods" },
          button("Try wallet approval (demo)", () => show("wallet"), true, "funding-connect"),
          button("Show demo QR code", () => show("qr"), false, "funding-qr")),
        el("div", { class: "funding-payment-meta" },
          el("p", { class: "small muted" }, "Links open other websites, which see your IP address."),
          button("Finish later", exit, false, "funding-back"))),
      "funding-allocation-stage funding-checkout-stage");
  }
  function walletView() {
    return frame("Wallet approval demo.", "A simulated screen. No wallet is connected and nothing is requested.",
      el("section", { class: "funding-body funding-wallet surface-quiet" },
        el("div", { class: "funding-wallet-mark" }, mark("wallet")),
        el("h2", {}, "Zigs funding demo"),
        el("strong", { class: "funding-wallet-amount" }, "Example · " + solAmount(setupTotal()) + " SOL"),
        el("dl", { class: "funding-review-lines" },
          el("div", {}, el("dt", {}, "For"), el("dd", {}, name)),
          includeName ? el("div", {}, el("dt", {}, "Zcash name"), el("dd", {}, zecName(nameOf(nameDraft)))) : null,
          el("div", {}, el("dt", {}, "Recipient"), el("dd", {}, "Demo · no payment address"))),
        el("p", { class: "small muted" },
          "This demo makes no wallet connection or signing request.")),
      footer("Simulate approval", beginDemo, "Cancel", () => show("allocation")));
  }
  function qrView() {
    const qr = el("div", { class: "funding-demo-qr" });
    qr.innerHTML = qrSvg(fundingDemoQrPayload(setupTotal(), includeName ? nameOf(nameDraft) : null),
      "Funding demo QR. Demo text only, not a payment request.");
    return frame("QR code demo.", "Demo, no payment. Do not scan this code with a wallet.",
      el("div", { class: "funding-body funding-qr-body" },
        el("figure", {}, qr, el("figcaption", {}, "Demo QR · no recipient or payment request")),
        el("strong", { class: "funding-wallet-amount" }, "Example · " + solAmount(setupTotal()) + " SOL"),
        el("p", { class: "small muted" }, includeName
          ? "Includes " + zecName(nameOf(nameDraft)) + " · demo" : "Demo amount, not a payment request"),
        el("p", { class: "small muted" }, "Scanning shows demo details. No funds can be sent.")),
      footer("Simulate payment", beginDemo, "Back", () => show("allocation")));
  }
  function progressView() {
    return frame("Funding demo in progress.", "Every status below is simulated.",
      el("ol", { class: "funding-body funding-progress", "aria-live": "polite" },
        FUNDING_STEPS.map(([title, copy], i) => el("li", {
          class: i < progress ? "is-complete" : i === progress ? "is-current" : "",
          "aria-current": i === progress ? "step" : null,
        }, el("span", { class: "funding-progress-mark", "aria-hidden": "true" },
          i < progress ? "✓" : String(i + 1)),
        el("div", {}, el("strong", {}, title), el("span", { class: "small muted" }, copy)),
        el("span", { class: "small funding-step-state" },
          i < progress ? "Simulated" : i === progress ? "Simulating…" : "Waiting")))),
      el("footer", { class: "funding-actions" },
        button("Pause and finish later", exit, false, "funding-pause")));
  }
  function completeView() {
    return frame("Funding demo complete.", "Your actual balances are unchanged.",
      el("div", { class: "funding-body funding-complete" },
        el("div", { class: "funding-complete-mark", "aria-hidden": "true" }, mark("approvals")),
        total(),
        el("p", { class: "small muted" }, "Primary fee account · approximately 10 short Zcash messages"),
        includeName ? el("p", { class: "small muted" }, "Name request included: " + zecName(nameOf(nameDraft)) + " · demo only") : null,
        el("p", { class: "small muted" }, "No payment was made, and none is needed to use your wallet.")),
      footer("Open Overview", () => { stop(); onComplete(); },
        "Replay demo", () => { progress = 0; show("allocation"); }));
  }
  function paint() {
    root.dataset.fundingStage = stage;
    root.dataset.fundingPane = pane;
    const views = { allocation: allocationView, wallet: walletView, qr: qrView, "name-info": nameInfo,
      "name-fees": nameFees,
      costs1: () => costDetails(0), costs2: () => costDetails(1),
      progress: progressView, complete: completeView };
    root.replaceChildren(
      el("header", { class: "guided-header" },
        el("div", {}, el("span", { class: "label" }, "Zigs · funding demo"), el("h1", {}, name),
          el("p", { class: "small muted" }, "Your wallet is set up. This demo is optional."))),
      el("p", { class: "funding-preview-note small", role: "note" },
        el("strong", {}, FUNDING_DEMO_LABEL + ". "), FUNDING_DEMO_NOTE),
      views[stage]());
    if (stage === "allocation") syncNameForm();
  }
  paint();
  return { element: root, resume,
    get completed() { return stage === "complete"; },
    setName(value) { if (value !== name) { name = value; paint(); } },
  };
}
