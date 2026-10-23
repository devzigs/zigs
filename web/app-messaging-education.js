// Optional, tab-local education. This module never creates accounts or changes message security.
import { el } from "./app-dom.js";
import { icon } from "./app-icons.js";
import { focusAfter, render } from "./app-loop.js";

const PAGES = Object.freeze([
  {
    eyebrow: "Choose your route",
    title: "One inbox. Two ways to talk.",
    copy: "Relay chat sends encrypted messages through the group server, without a blockchain fee. Zcash chat carries your text inside a shielded transaction memo.",
    note: "Keep chat links private. People with a valid link may be able to read the relay conversation.",
    graphic: "routes",
  },
  {
    eyebrow: "Understand the cost",
    title: "A small account for on-chain messages.",
    copy: "Zcash chat uses a separately funded personal account. Each send pays a network fee and waits for a block. Check the cost before sending.",
    note: "Funding it from a shared wallet follows that wallet’s approval rule. Control of this browser gives access to the personal account.",
    graphic: "memo",
  },
  {
    eyebrow: "Make replies find their way",
    title: "Give each contact their reply address.",
    copy: "Zigs gives each contact a receiving address for replies. Share that address with the right person so incoming memos can appear in their conversation.",
    note: "A contact name or reply address helps organize messages. It does not verify the person’s identity.",
    graphic: "reply",
  },
  {
    eyebrow: "Know the protection",
    title: "Another layer. A future step.",
    copy: "Today, on-chain text is protected by Zcash memo encryption. Advanced application encryption could add separate chat keys and hybrid post-quantum protection in a future release.",
    note: "Advanced encryption is unavailable. It requires protocol development and independent security review before release.",
    graphic: "layers",
  },
]);

let open = false, step = 0;

export const hasMessagingTutorial = () => open;

export function closeMessagingTutorial() {
  open = false;
  render();
}

export function messagingLearnButton() {
  return el("button", {
    class: "btn ghost sm messages-learn", type: "button",
    "data-key": "messages-learn", "aria-haspopup": "dialog",
    onclick: () => { open = true; step = 0; render(); },
  }, icon("chat"), "How it works");
}

function node(mark, label, detail, extra = "") {
  return el("div", { class: "messages-art-node " + extra },
    el("span", { class: "messages-art-symbol" }, icon(mark)),
    el("strong", {}, label), detail ? el("span", {}, detail) : null);
}

function route(kind, title, from, to, note) {
  return el("div", { class: "messages-art-route messages-art-route--" + kind },
    el("span", { class: "messages-art-route-label" }, title),
    el("div", { class: "messages-art-route-track" }, node(from, "You"),
      el("span", { class: "messages-art-rail" }, el("span", { class: "messages-art-packet" })),
      node(to, kind === "relay" ? "Your contact" : "Their address")),
    el("span", { class: "messages-art-caption" }, note));
}

function illustration(kind) {
  let content;
  if (kind === "routes") {
    content = [route("relay", "Relay chat", "devices", "devices", "Encrypted relay · no blockchain fee"),
      route("zcash", "Zcash chat", "wallet", "security", "Shielded memo · network fee")];
  } else if (kind === "memo") {
    content = [
      el("div", { class: "messages-art-flow" },
        node("wallet", "Personal account", "Separate funds"),
        el("span", { class: "messages-art-rail" }, el("span", { class: "messages-art-packet" })),
        el("div", { class: "messages-art-memo" }, icon("chat"),
          el("span", { class: "messages-art-memo-line" }),
          el("span", { class: "messages-art-memo-line short" }),
          el("strong", {}, "Shielded memo")),
        el("span", { class: "messages-art-rail" }, el("span", { class: "messages-art-packet" })),
        node("activity", "Zcash block", "Receipt after inclusion")),
      el("div", { class: "messages-art-chips" },
        el("span", {}, "Network fee"), el("span", {}, "Wait for a block")),
    ];
  } else if (kind === "reply") {
    content = [
      el("div", { class: "messages-art-reply-card" },
        el("span", { class: "messages-art-person" }, "A"),
        el("div", {}, el("strong", {}, "A contact"),
          el("span", {}, "Their receiving address")), icon("addressBook")),
      el("div", { class: "messages-art-reply-route" },
        el("span", { class: "messages-art-rail" }, el("span", { class: "messages-art-packet" })),
        el("span", { class: "messages-art-route-label" }, "Replies arrive here")),
      el("div", { class: "messages-art-reply-card messages-art-reply-card--destination" },
        el("span", { class: "messages-art-symbol" }, icon("receive")),
        el("div", {}, el("strong", {}, "Contact-specific address"),
          el("span", { class: "messages-art-address" }, "u1 · · · · · · · · · ·"))),
      el("span", { class: "messages-art-caption" }, "A route for replies · not identity verification"),
    ];
  } else {
    content = [
      el("div", { class: "messages-art-layers" },
        el("div", { class: "messages-art-future-layer" },
          el("span", { class: "messages-art-future-label" }, "Future · separate chat keys"),
          el("span", { class: "messages-art-key messages-art-key--one" }, icon("key")),
          el("span", { class: "messages-art-key messages-art-key--two" }, icon("key")),
          el("div", { class: "messages-art-current-layer" }, icon("security"),
            el("strong", {}, "Zcash memo encryption"),
            el("span", {}, "Available today")))),
      el("span", { class: "messages-art-caption" }, "Advanced encryption · not yet available"),
    ];
  }
  return el("div", { class: "messages-education-art messages-education-art--" + kind,
    "aria-hidden": "true" }, content);
}

function go(next) {
  step = next;
  focusAfter("messages-tutorial-title", true);
  render();
}

/** Render through the app's existing [scrim, dialog] modal layer and focus manager. */
export function messagingTutorialDialog() {
  if (!open) return null;
  const page = PAGES[step];
  return el("section", {
    class: "dialog messages-tutorial", role: "dialog", "aria-modal": "true",
    "aria-labelledby": "messages-tutorial-label",
    "aria-describedby": "messages-tutorial-copy messages-tutorial-note",
    onkeydown: (ev) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault(); ev.stopPropagation(); closeMessagingTutorial();
    },
  },
  el("header", { class: "card-head messages-tutorial-head" },
    el("div", {}, el("span", { class: "label", id: "messages-tutorial-label" }, "How messaging works"),
      el("p", { class: "small muted" }, "A quick guide · " + (step + 1) + " of " + PAGES.length)),
    el("button", { class: "icon-btn", type: "button", "aria-label": "Close messaging guide",
      "data-key": "messages-tutorial-close", onclick: closeMessagingTutorial }, "×")),
  illustration(page.graphic),
  el("div", { class: "messages-tutorial-copy" },
    el("span", { class: "label messages-tutorial-eyebrow" }, page.eyebrow),
    el("h2", { id: "messages-tutorial-title", tabindex: "-1",
      "data-key": "messages-tutorial-title", "data-first-focus": "" }, page.title),
    el("p", { id: "messages-tutorial-copy" }, page.copy),
    el("p", { class: "messages-tutorial-note", id: "messages-tutorial-note" }, page.note)),
  el("footer", { class: "dialog-actions messages-tutorial-actions" },
    el("div", { class: "messages-tutorial-dots", "aria-label": "Page " + (step + 1) + " of 4" },
      PAGES.map((_, i) => el("span", { class: i === step ? "active" : "", "aria-hidden": "true" }))),
    el("button", { class: "btn ghost", type: "button", onclick: closeMessagingTutorial }, "Skip"),
    step > 0 ? el("button", { class: "btn", type: "button", onclick: () => go(step - 1) }, "Back") : null,
    el("button", { class: "btn primary", type: "button", "data-key": "messages-tutorial-next",
      onclick: step === PAGES.length - 1 ? closeMessagingTutorial : () => go(step + 1) },
    step === PAGES.length - 1 ? "Done" : "Next")));
}
