// The pages of the personal account and its contacts.
import { memoShown, toZat, zatText } from "./payees.js";
import {
  balanceWarnings, chatTimeline, fundingPayees, fundingWarning, holdsNotes, messagePlan, NAME_MAX,
  otherWhere, removeWarning, salvageBackup, SENT_WORDS, sentNote,
} from "./personal.js";
import { REQUEST_NET } from "./requests.js";
import { state, ui } from "./app-state.js";
import { initials, short, when } from "./app-kit.js";
import { Z } from "./app-engine.js";
import { netOf, NETWORKS } from "./app-chain.js";
import {
  act, copyBtn, el, guard, logBox, money, netBadge, networkPick, noteFor, qrBox, setNote, skeleton,
} from "./app-dom.js";
import { proposeWallets, requestCard, requestOf } from "./app-payreq.js";
import {
  accountInbox, acct, acctAddressWhy, acctBalance, addPersonalContact, addressFor, blockTime,
  contactRows, copyFundingRequest, createPersonal, flightNow, fundFromWallet, messageWhy, NOT_READY,
  openContact, personal, personalDamaged, personalEnv, personalError, personalPending,
  removeAccount, sendOnChain, sentStateOf, splitParts,
} from "./app-account.js";
import { composer } from "./app-thread.js";
import { openAccountBackup } from "./app-backups.js";
import { lobby } from "./app-shell.js";
import { render } from "./app-loop.js";
import { syncLine } from "./app-wallet.js";

export function personalCard(pickRestore) {
  if (personalPending) {
    return el("section", { class: "card card-pad" }, el("h2", {}, "Personal account"),
      el("p", { class: "small faint" }, "Loading the saved account…"));
  }
  if (personalError) return damagedCard();
  return personal ? accountCard() : createCard(pickRestore);
}

// A saved account that does not read. The record stays as it is. If it still holds a seed, the
// person can save a backup of what reads, or remove it and start again.
export function damagedCard() {
  const canSave = !!personalDamaged && !!salvageBackup(personalDamaged, personalEnv());
  return el("section", { class: "card card-pad" }, el("h2", {}, "Personal account"),
    el("div", { class: "callout bad", role: "alert" }, personalError),
    canSave ? el("p", { class: "small muted" }, "Back up account saves the seed and the "
      + "contacts that Zigs can read.") : null,
    personalDamaged ? accountActions(DAMAGED_WARNING, canSave) : null);
}

function createCard(pickRestore) {
  const p = ui.personal;
  return el("section", { class: "card card-pad" },
    el("div", { class: "card-head" }, el("h2", {}, "Personal account"),
      el("span", { class: "badge plain" }, "Optional")),
    el("p", { class: "small muted" }, "Write to anyone who has a shielded Zcash address, also if "
      + "they do not use Zigs. A message is a small payment on chain, and this account pays its "
      + "fee. The account is apart from your wallets, and the group server never sees it."),
    networkPick(p, "account", "p"),
    el("div", { class: "callout" }, "Keep only a few cents here. Whoever controls this browser can "
      + "spend the account. Make a backup file right after you create it."),
    el("div", { class: "dialog-actions" },
      el("button", { class: "btn", type: "button", onclick: pickRestore }, "Restore from backup"),
      el("button", {
        class: "btn primary", type: "button", disabled: !Z,
        onclick: act(() => createPersonal(p.net)),
      }, "Create account")));
}

function accountBalanceBlock(b) {
  const money2 = (zat) => (b ? money(zat) : skeleton());
  return el("div", { style: "display:grid;gap:10px" },
    el("span", { class: "label" }, "Balance"), b ? money(b.total, "xl") : skeleton("xl"),
    el("div", { class: "stats" },
      el("div", {}, el("span", { class: "label" }, "Available"), money2(b && b.spendable)),
      el("div", {}, el("span", { class: "label" }, "Incoming"), money2(b && b.pending))),
    flightNow().length ? el("div", { class: "sending" }, el("span", { class: "dot busy" }),
      "A message is waiting for its block") : null);
}

export function accountCard() {
  const c = acct, b = acctBalance();
  return el("section", { class: "card card-pad" },
    el("div", { class: "card-head" }, el("h2", {}, "Personal account"),
      netBadge({ network: personal.network })),
    el("p", { class: "small muted" }, "This account pays the fee of your messages on chain. It is "
      + "not a wallet and it has no signers. Whoever controls this browser can spend it."),
    personal.backedUp ? null : accountBackupNote(),
    accountBalanceBlock(b),
    b ? balanceWarnings(b.total).map((t) => el("div", { class: "callout warn", role: "status" }, t))
      : null,
    c ? syncLine(c) : el("p", { class: "small faint" }, NOT_READY),
    c ? addressBlock(c) : null,
    c ? fundBlock() : null,
    accountActions(removeWarning(personal)),
    otherMessages());
}

function accountBackupNote() {
  return el("div", { class: "callout warn", role: "status" },
    el("span", { style: "flex:1 1 16rem" }, "Back up the account. This browser can forget it: "
      + "private windows and Tor Browser delete it when they close. The file holds the seed and "
      + "your contacts. A passphrase that you choose locks it."),
    el("button", { class: "btn sm", type: "button", onclick: openAccountBackup },
      "Back up account"));
}

export function addressBlock(c) {
  const why = acctAddressWhy();
  if (why) return el("div", { class: "callout" + (acctBalance() ? " bad" : "") }, why);
  return el("div", { style: "display:grid;gap:8px" },
    el("span", { class: "label" }, "Public address"),
    el("div", { class: "addr-box" }, el("span", { class: "hex" }, short(c.address, 18)),
      copyBtn(c.address)),
    el("details", { class: "qr-toggle" }, el("summary", {}, "Show QR code"),
      qrBox(c.address, "Account address")),
    el("p", { class: "small faint" }, "Anyone who has this address can pay it and write to it. "
      + "A message that reaches it shows under Other messages, marked not verified. Give each "
      + "contact their own address instead."));
}

// The request pays 3 notes, so the account can send a message after each block.
export function fundBlock() {
  if (acctAddressWhy()) return null;
  const b = acctBalance();
  const wallets = proposeWallets(REQUEST_NET[personal.network]);
  const pick = wallets.length > 1 ? el("select", {
    class: "input", id: "fund-wallet", "aria-label": "Fund from wallet",
  }, wallets.map((g) => el("option", { value: g.id },
    g.name + " (" + netOf(g).label + ")"))) : null;
  // Both notes follow the typing, as the fee line of the composer does. The warning is advice for
  // an amount that the request takes. Only the refusal marks the field as invalid.
  const warn = el("span", { class: "hint bad", id: "fund-warn", role: "status" });
  const refusal = el("span", { class: "hint bad", id: "fund-error", role: "status" });
  const showWarn = () => {
    const zat = toZat(ui.personal.fund);
    warn.textContent = fundingWarning(zat, b ? b.total : 0);
    setNote(refusal, fundingPayees("", zat).error ?? "", "hint bad");
  };
  const amount = el("input", {
    class: "input", id: "fund-amt", type: "text", inputmode: "decimal", autocomplete: "off",
    value: ui.personal.fund, "aria-describedby": "fund-hint fund-warn fund-error",
    oninput: (ev) => { ui.personal.fund = ev.target.value; showWarn(); },
  });
  noteFor(refusal, amount);
  showWarn();
  return el("div", { class: "to-box", style: "display:grid;gap:10px" },
    el("span", { class: "label" }, "Fund the account"),
    // The notes stay out of the label, so that they are no part of the name of the field.
    el("div", { class: "field" },
      el("label", { class: "field" }, el("span", {}, "Amount in ZEC"), amount),
      el("span", { class: "hint", id: "fund-hint" }, "The request asks for 3 equal notes, so the "
        + "account can send a message after each block. A wallet pays it, and its signers "
        + "approve it as they approve any payment."), warn, refusal),
    el("div", { class: "req-actions" }, pick,
      el("button", {
        class: "btn primary sm", type: "button", disabled: !wallets.length,
        onclick: act(() => fundFromWallet(pick ? pick.value : wallets[0].id)),
      }, "Fund from a wallet"),
      el("button", { class: "btn sm", type: "button", onclick: act(copyFundingRequest) },
        "Copy request")),
    wallets.length ? null : el("p", { class: "small faint" }, "You hold no seat in a "
      + personal.network + " wallet. Copy the request and pay it from any wallet."));
}

const DAMAGED_WARNING = "This account does not read. Make a backup first if you want to keep it.";

// The backup and remove buttons. `warning` adds a sentence to the question before a removal.
function accountActions(warning, canSave = true) {
  const ask = (on) => () => { ui.personal.drop = on; render(); };
  const sure = ui.personal.drop;
  return el("div", { style: "display:grid;gap:10px" },
    el("div", { class: "row-actions" },
      canSave ? el("button", { class: "btn sm", type: "button", onclick: openAccountBackup },
        "Back up account") : null,
      sure ? null : el("button", { class: "btn ghost sm", type: "button", onclick: ask(true) },
        "Remove from this browser")),
    sure ? el("div", { class: "callout bad", role: "alert" },
      el("p", {}, "Remove the account from this browser? The seed is deleted. Only a backup file "
        + "brings the account back." + (warning ? " " + warning : "")),
      el("div", { class: "dialog-actions" },
        el("button", { class: "btn", type: "button", onclick: ask(false) }, "Cancel"),
        el("button", { class: "btn danger", type: "button", onclick: act(removeAccount) },
          "Remove the account"))) : null);
}

// Messages to the public address, or to an address that no contact has. Nobody can say who wrote
// them, so the page marks them not verified.
export function otherMessages() {
  const items = accountInbox().other;
  if (!items.length) return null;
  const rows = chatTimeline(items, [], blockTime).slice(-50);
  return el("details", {}, el("summary", {}, "Other messages (not verified)"),
    el("p", { class: "small muted" }, items.length + " in all. Anyone who knows an address of "
      + "this account can write to it."),
    el("div", { class: "chat-log" }, rows.map((r) =>
      guard(receivedBubble, r, "Unknown sender", "Not verified", otherWhere(r.index)))));
}

export function contactsCard() {
  if (!personal) return null;
  const list = personal.contacts;
  return el("section", { class: "card" },
    el("div", { class: "card-head card-pad", style: "padding-bottom:12px" },
      el("h2", {}, "Contacts on chain"),
      el("button", { class: "btn sm", type: "button", onclick: openContactDialog }, "Add contact")),
    list.length ? el("div", { class: "list", style: "border-top:1px solid var(--line)" },
      list.map((c) => guard(contactRow, c)))
      : el("p", { class: "small muted card-pad" }, "Add the address of a person. You can then "
        + "write to them on chain, also if they do not use Zigs."));
}

export function openContactDialog() {
  ui.contactAdd = true;
  render();
}

function contactRow(c) {
  const name = memoShown(c.name), n = (accountInbox().chats.get(c.index) || []).length;
  return el("button", {
    class: "row-item", type: "button", "data-key": "contact-row-" + c.index,
    onclick: () => openContact(c.index),
  },
  el("span", { class: "av lg" }, initials(name)),
  el("span", { class: "ri-main" }, el("span", { class: "ri-title" }, name),
    el("span", { class: "ri-sub" }, "On chain · " + (n === 1 ? "1 message" : n + " messages"))),
  el("span", { class: "ri-end" }), el("span", { class: "chev" }, "›"));
}

export function contactItem(c) {
  const here = state.contact === c.index, name = memoShown(c.name);
  return el("button", {
    class: "side-item" + (here ? " active" : ""), type: "button",
    "aria-current": here ? "page" : null, "data-key": "contact-" + c.index,
    onclick: () => openContact(c.index),
  }, el("span", { class: "av" }, initials(name)), el("span", { class: "side-name" }, name));
}

export function contactDialog() {
  const close = () => { ui.contactAdd = false; render(); };
  const net = NETWORKS[personal.network];
  return el("form", {
    class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "contact-title",
    onsubmit: act(async (ev) => {
      const fd = new FormData(ev.target);
      const made = await addPersonalContact(String(fd.get("name") || ""),
        String(fd.get("address") || ""));
      ui.contactAdd = false;
      openContact(made.index);
    }),
  },
  el("div", { class: "card-head" }, el("h2", { id: "contact-title" }, "Add a contact"),
    el("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: close },
      "×")),
  el("label", { class: "field" }, el("span", {}, "Name"), el("input", {
    class: "input", id: "oc-name", name: "name", maxlength: String(NAME_MAX), autocomplete: "off",
    required: true,
  }), el("span", { class: "hint" }, "Only you see this name.")),
  el("label", { class: "field" }, el("span", {}, "Shielded address"), el("input", {
    class: "input mono", id: "oc-addr", name: "address", placeholder: net.prefix + "…",
    autocomplete: "off", spellcheck: "false", required: true,
  })),
  el("div", { class: "callout" }, "Next, Zigs shows an address for this contact. Give it to them. "
    + "A message to that address shows in this chat."),
  el("div", { class: "dialog-actions" },
    el("button", { class: "btn", type: "button", onclick: close }, "Cancel"),
    el("button", { class: "btn primary", type: "submit", disabled: !Z || !acct }, "Add contact")));
}

const ON_CHAIN_FINE = "The message is a payment of no value, and your text is its memo. It is "
  + "permanent, and only the memo encryption of Zcash protects its text. Sending takes about a "
  + "minute, because this browser builds a proof. A wallet that hides payments of no value does "
  + "not show it.";
const ON_CHAIN_LIMITS = "This browser keeps the text of the messages that you sent. It is not in "
  + "the backup file. Private windows and Tor Browser forget it when they close.";

export function contactView() {
  const contact = personal && personal.contacts.find((c) => c.index === state.contact);
  if (!contact) return lobby();
  const name = memoShown(contact.name);
  return el("div", { class: "page" },
    el("header", { class: "page-head" }, el("div", { class: "ph-left" },
      el("button", {
        class: "btn ghost sm back", type: "button",
        onclick: () => { state.contact = null; render(); },
      }, "← Wallets"),
      el("h1", {}, name),
      el("div", { class: "ph-meta" },
        el("span", { class: "badge plain" }, "On chain · Zcash memos")))),
    contactAddress(contact, name),
    contactMessages(contact, name));
}

function contactAddress(contact, name) {
  const why = acct ? acctAddressWhy() : NOT_READY;
  if (why) return el("div", { class: "callout" }, why);
  const address = addressFor(contact.index);
  return el("section", { class: "card card-pad hero-card" },
    el("div", { class: "card-head" }, el("h2", {}, "Your address for " + name)),
    el("p", { class: "small muted" }, "Give this address to " + name + ". A message that reaches "
      + "it shows in this chat, marked as sent to the address you gave " + name + ". Anyone who "
      + "knows the address can write here."),
    el("div", { class: "addr-box" }, el("span", { class: "hex nowrap" }, address),
      copyBtn(address, "Copy address", "btn sm primary")),
    el("details", { class: "qr-toggle" }, el("summary", {}, "Show QR code"),
      qrBox(address, "Address for " + name)));
}

function contactMessages(contact, name) {
  const items = contactRows(contact).map((r) => guard(onChainRow, r, name));
  const none = el("p", { class: "small faint" }, "No messages yet. A message to the address above "
    + "shows here after the next block.");
  return el("section", { class: "card card-pad chat" },
    el("div", { class: "card-head" }, el("h2", {}, "Messages")),
    logBox("log-oc-" + contact.index, "Messages with " + name, items, none),
    composer({
      kind: "oc-" + contact.index, why: messageWhy(), seats: [], to: "Message to " + name,
      fine: ON_CHAIN_FINE, label: "Send on chain", key: "chat:personal:" + contact.index,
      send: (text) => sendOnChain(contact, text), plan: (text) => messagePlan(text, splitParts),
      progress: acct ? acct.progress : "",
    }),
    el("p", { class: "small faint" }, ON_CHAIN_LIMITS));
}

function onChainRow(row, name) {
  if (row.dir === "out") return sentBubble(row);
  return receivedBubble(row, name, "On chain · sent to the address you gave " + name, "");
}

// The text of a message from the chain, already through memoShown. A whole text that is a payment
// request shows as a card with the verdict "memo".
function memoBodyOf(key, text) {
  const req = requestOf(text, true, personal.network);
  if (!req) return el("p", { class: "msg-text" }, text);
  return requestCard(req, { id: key, name: "a memo", verdict: "memo", dm: true });
}

// A message from the chain, as the contact's chat and the other messages show it.
function receivedBubble(row, name, label, where) {
  const body = row.text === null ? el("p", { class: "msg-text faint" }, "Memo is not text")
    : memoBodyOf(row.key, memoShown(row.text));
  return el("div", { class: "msg" },
    el("span", { class: "av round", title: name }, initials(name)),
    el("div", { class: "msg-body" },
      el("div", { class: "msg-head" }, el("b", {}, name), el("time", {}, when(row.at)),
        el("span", { class: "vmark" + (label === "Not verified" ? " bad" : "") }, label)),
      body, where ? el("span", { class: "small faint" }, where) : null,
      row.parts > 1 ? el("span", { class: "small faint" }, "Joined from " + row.parts + " parts")
        : null,
      el("a", {
        class: "small", href: NETWORKS[personal.network].explorer + row.txid, target: "_blank",
        rel: "noopener",
      }, "View transaction ↗")));
}

function sentBubble(rec) {
  const st = sentStateOf(rec), note = sentNote(rec, st);
  const cls = st === "chain" ? " ok" : holdsNotes(st) ? "" : " bad";
  return el("div", { class: "msg" },
    el("span", { class: "av round me", title: "You" }, "Y"),
    el("div", { class: "msg-body" },
      el("div", { class: "msg-head" }, el("b", {}, "You"), el("time", {}, when(rec.at)),
        el("span", { class: "vmark" + cls }, SENT_WORDS[st])),
      el("p", { class: "msg-text" }, memoShown(rec.text)),
      el("span", { class: "small faint" }, "Fee " + zatText(rec.fee) + " ZEC"
        + (rec.parts > 1 ? " · " + rec.parts + " parts" : "")),
      note ? el("span", { class: "small faint" }, note) : null,
      st === "chain" ? el("a", {
        class: "small", href: NETWORKS[personal.network].explorer + rec.txid, target: "_blank",
        rel: "noopener",
      }, "View transaction ↗") : null));
}
