// The device's payment-recipient book. General chat contacts have their own workspace.
import { el, copyBtn } from "./app-dom.js";
import { showBanner } from "./app-state.js";
import { Z } from "./app-engine.js";
import {
  recipients, recipientsBlocked, saveRecipient, deleteRecipient, vault,
} from "./app-keystore.js";
import { checkedRecipient, matchingRecipients } from "./recipients.js";
import { focusAfter, render } from "./app-loop.js";
import { securityExplanation } from "./app-tutorial.js";
import { sculptedIcon } from "./app-icons.js";

const destinations = [
  ["ZEC:testnet:shielded", "Shielded ZEC · Zcash Testnet"],
  ["ZEC:mainnet:shielded", "Shielded ZEC · Zcash Mainnet"],
  ["SOL:devnet:shielded", "Shielded SOL · Solana Devnet"],
  ["SOL:devnet:public", "Public SOL withdrawal · Solana Devnet"],
];
const kindKey = (r) => [r.asset, r.network, r.type].join(":");
const kindText = (r) => destinations.find(([key]) => key === kindKey(r))?.[1] || "Unavailable destination";
let query = "", editor = null, editRun = 0, deleting = null;
const beginEdit = (entry = null) => {
  editor = { previous: entry ? { ...entry } : null, run: ++editRun,
    name: entry?.name || "", address: entry?.address || "", kind: entry ? kindKey(entry) : "ZEC:testnet:shielded" };
  deleting = null;
  focusAfter("recipient-name-" + editor.run, true);
  render();
};

export function recipientsView() {
  const why = recipientsBlocked();
  const list = el("div", { class: "recipient-list", "aria-live": "polite" });
  const fillList = () => list.replaceChildren(...recipientRows(query, why));
  const search = el("input", {
    class: "input recipient-search", id: "recipient-search", "data-key": "recipient-search", type: "search",
    placeholder: "Search names, addresses or networks", "aria-label": "Search payment recipients",
    autocomplete: "off", value: query, disabled: !!why,
    oninput: (ev) => { query = ev.target.value; fillList(); },
  });
  fillList();
  return el("div", { class: "recipients-page", "data-page": "recipients", id: "panel-recipients",
    "data-key": "panel-recipients", tabindex: "-1", "aria-label": "Address book" },
    el("div", { class: "section-heading" }, el("p", { class: "label" }, "Private to this device"),
      el("h1", {}, "Address book"), el("p", { class: "small muted" },
        "Save payment recipients for all wallets on this device. Chat contacts stay in Chats."),
      securityExplanation("recipients")),
    el("section", { class: "card surface-financial" },
      el("div", { class: "card-head" }, el("h2", {}, "Payment recipients"),
        el("button", { class: "btn primary", type: "button", disabled: !!why || !Z,
          onclick: () => beginEdit() }, "Add recipient")),
      el("p", { class: "small muted" }, "Saved names are your labels, not proof of identity. "
        + "Choose a wallet and open Send to use one, then check the full address in the review."),
      el("p", { class: "small faint" }, vault
        ? "Protected by this browser's existing passkey lock. Not shared with wallet participants or included in recovery files."
        : "Saved in this browser. Turn on the passkey lock in Settings to protect the saved book. "
          + "Not shared with wallet participants or included in recovery files."),
      why ? el("div", { class: "callout bad", role: "alert" }, why) : null,
      editor && !why ? editorForm() : null, search, list));
}

function recipientRows(search, why) {
  if (why) return [];
  const found = matchingRecipients(recipients, {}, search);
  if (!found.length) return [el("div", { class: "empty" },
    el("span", { class: "recipient-empty-art", "aria-hidden": "true" }, sculptedIcon("addressBook")),
    el("h3", {}, search ? "No matching recipients" : "Your recipients, in one place"),
    el("p", { class: "small muted" }, search ? "Try a different name, address or network."
      : "Add a payment address to find it easily from Send in any of your wallets."))];
  return found.map((entry) => el("article", { class: "recipient-card surface-quiet", "data-recipient": entry.id },
    el("div", { class: "card-head" }, el("h3", {}, entry.name), el("span", { class: "badge plain" }, kindText(entry))),
    el("div", { class: "addr-full" }, entry.address),
    deleting?.id === entry.id ? el("div", { class: "callout warn" },
      el("p", {}, "Remove “" + entry.name + "” from this device? Existing payments and drafts stay as they are."),
      el("div", { class: "row-actions" }, el("button", { class: "btn", type: "button",
        onclick: () => { deleting = null; render(); } }, "Keep recipient"),
      el("button", { class: "btn danger", type: "button", onclick: async (ev) => {
        const button = ev.currentTarget, previous = deleting;
        button.disabled = true;
        try {
          await deleteRecipient(previous); deleting = null;
          focusAfter("recipient-search", true);
        } catch (e) { showBanner("bad", e.message); }
        finally { button.disabled = false; render(); }
      } }, "Remove recipient"))) : el("div", { class: "row-actions" },
      copyBtn(entry.address, "Copy address"),
      el("button", { class: "btn sm", type: "button", "aria-label": "Edit " + entry.name,
        onclick: () => beginEdit(entry) }, "Edit"),
      el("button", { class: "btn ghost sm", type: "button", "aria-label": "Delete " + entry.name,
        onclick: () => { deleting = { ...entry }; render(); } }, "Delete"))));
}

function editorForm() {
  const draft = editor, key = "recipient-" + draft.run;
  const field = (label, input) => el("label", { class: "field" }, el("span", {}, label), input);
  const name = el("input", { class: "input", id: "recipient-name-" + draft.run,
    "data-key": "recipient-name-" + draft.run, required: true, maxlength: "80", value: draft.name,
    autocomplete: "off", disabled: draft.saving, oninput: (ev) => { draft.name = ev.target.value; } });
  const kind = el("select", { class: "input", id: key + "-kind", value: draft.kind, disabled: draft.saving,
    oninput: (ev) => { draft.kind = ev.target.value; } },
  destinations.map(([value, label]) => el("option", { value, selected: draft.kind === value }, label)));
  const address = el("textarea", { class: "input mono", id: key + "-address", required: true,
    rows: "3", maxlength: "2048", spellcheck: "false", autocomplete: "off", disabled: draft.saving,
    "aria-describedby": key + "-help", oninput: (ev) => { draft.address = ev.target.value; } }, draft.address);
  return el("form", { class: "recipient-editor surface-quiet", "aria-busy": !!draft.saving,
    onsubmit: async (ev) => {
      ev.preventDefault();
      if (draft.saving) return;
      draft.saving = true; draft.error = ""; render();
      try {
        const [asset, network, type] = draft.kind.split(":");
        await saveRecipient({ name: draft.name, address: draft.address, asset, network, type }, draft.previous);
        editor = null;
        focusAfter("recipient-search", true);
      } catch (e) { draft.error = e.message; }
      finally { draft.saving = false; render(); }
    } }, el("h3", {}, draft.previous ? "Edit recipient" : "New recipient"),
  field("Name on this device", name), field("Asset, network and destination type", kind),
  field("Full payment address", address), el("p", { class: "small muted", id: key + "-help" },
    "Paste the complete address, not a ZNS name or payment request. For Solana, shielded addresses "
      + "and public withdrawal addresses are different. Saving checks the format; Send still validates and reviews every payment."),
  draft.error ? el("p", { class: "callout bad", role: "alert" }, draft.error) : null,
  el("div", { class: "row-actions" }, el("button", { class: "btn primary", type: "submit", disabled: draft.saving },
    draft.saving ? "Saving…" : "Save recipient"),
    el("button", { class: "btn", type: "button", disabled: draft.saving,
      onclick: () => { editor = null; focusAfter("recipient-search", true); render(); } }, "Cancel")));
}

/** Inline picker for the existing Send field. It never chooses a wallet or submits a payment. */
export function recipientSelect({ asset, network, type, onSelect, id = "saved-recipient" }) {
  const filter = { asset, network, type }, why = recipientsBlocked();
  const entries = why ? [] : matchingRecipients(recipients, filter);
  const status = el("span", { class: "hint", id: id + "-hint", role: "status" }, why
    || (entries.length ? "Fills only the recipient address. Check the full address before approving."
      : "Add a matching recipient in Address book, or enter an address manually."));
  const select = el("select", { class: "input", id, "aria-label": "Saved " + kindText(filter) + " recipient",
    "aria-describedby": id + "-hint", disabled: !!why || !entries.length,
    onchange: (ev) => {
      const shown = entries.find((r) => r.id === ev.target.value);
      if (!shown) return;
      const current = matchingRecipients(recipients, filter).find((r) => r.id === shown.id);
      try {
        if (recipientsBlocked()) throw new Error(recipientsBlocked());
        if (JSON.stringify(current) !== JSON.stringify(shown)) {
          throw new Error("This recipient changed. Reopen Send to see the latest saved address.");
        }
        const checked = checkedRecipient(current, (address) => Z.normalizeAddress(address));
        onSelect(checked.address);
        status.textContent = "Selected “" + current.name + "”. Check the full address in the payment review.";
      } catch (e) { status.textContent = e.message; }
      select.value = "";
    } }, el("option", { value: "" }, entries.length ? "Choose a saved recipient…" : "No matching saved recipients"),
  entries.map((r) => el("option", { value: r.id }, r.name + " · " + r.network)));
  return el("div", { class: "recipient-picker" }, el("label", { class: "field" },
    el("span", {}, "From Address book"), select), status);
}
