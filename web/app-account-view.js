// The pages of the personal account and its contacts.
import { memoShown, toZat, zatText } from "./payees.js";
import {
  balanceWarnings, chatTimeline, fundingPayees, fundingWarning, holdsNotes, messagePlan, NAME_MAX,
  otherWhere, removeWarning, salvageBackup, SENT_WORDS, sentNote,
} from "./personal.js";
import { REQUEST_NET } from "./requests.js";
import { busy, state, ui } from "./app-state.js";
import { initials, short, when } from "./app-kit.js";
import { Z } from "./app-engine.js";
import { explorerText, netOf, NETWORKS } from "./app-chain.js";
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
import { chatsWorkspace } from "./app-shell.js";
import { clearMessageDraft, focusAfter, messagingAccountScope, render } from "./app-loop.js";
import { syncLine } from "./app-wallet.js";
import { messagingCostReview } from "./messaging-cost-review.js";

export function personalCard(pickRestore) {
  if (personalPending) {
    return el("section", { class: "card card-pad" }, el("h2", {}, "Personal account"),
      el("p", { class: "small faint" }, "Loading the saved account…"));
  }
  if (personalError) return damagedCard();
  return personal ? accountCard() : createCard(pickRestore);
}

// Setup lives beside Zcash conversations. These steps describe actual account state; they do
// not add a spending gate or create a separate copy of account/backup progress.
export function zcashAccountSetup(pickRestore) {
  if (personalPending || personalError || !personal) return el("section", {
    class: "messages-account-setup",
  }, el("div", { class: "messages-setup-intro" },
    el("span", { class: "label" }, "Zcash chat"),
    el("h2", {}, "A small account for your messages"),
    el("p", { class: "small muted" }, "Send text in shielded Zcash memos. Your separate personal "
      + "account pays the network fee; your shared wallets keep their normal approval rules.")),
  personalCard(pickRestore));
  const c = acct, b = acctBalance(), funded = !!b && b.spendable > 0;
  return el("section", { class: "messages-account-setup" },
    el("div", { class: "messages-setup-intro" },
      el("div", { class: "card-head" }, el("h2", {}, "Your messaging account"),
        netBadge({ network: personal.network })),
      el("p", { class: "small muted" }, "Separate from your shared wallets. Each message spends "
        + "this account’s network fee without team approval. Whoever controls this browser can "
        + "spend it.")),
    accountBalanceBlock(b),
    b ? balanceWarnings(b.total).map((text) =>
      el("p", { class: "hint", role: "status" }, text)) : null,
    el("ol", { class: "messages-setup-steps" },
      el("li", {}, el("h3", {}, "Account created"),
        el("p", { class: "small muted" }, "Your account stays in this browser. The group server "
          + "does not hold its seed or messages.")),
      el("li", {}, el("h3", {}, personal.backedUp ? "Backup saved" : "Back up your account"),
        personal.backedUp
          ? el("p", { class: "small muted" }, "The backup holds the account seed and contacts, "
            + "not your sent-message history. Back up again after adding contacts.")
          : accountBackupNote()),
      el("li", {}, el("h3", {}, funded ? "Funds available" : "Add a little ZEC"),
        el("p", { class: "small muted" }, b?.pending && !funded
          ? "Incoming funds need 3 confirmations before they can pay a message fee."
          : "A one-part message costs 0.0001 ZEC. Longer messages can cost more."),
        c ? el("details", { class: "messages-account-funding", open: !funded,
          "data-disclosure-key": messagingAccountScope() + ":funding" },
          el("summary", {}, "Fund the account"), fundBlock()) : null),
      el("li", {}, el("h3", {}, "Choose a contact"),
        el("p", { class: "small muted" }, "Add their shielded address, then share the separate "
          + "reply address Zigs makes for them. An address does not verify a person’s identity."),
        el("button", { class: "btn primary", type: "button", disabled: !c || !c.bal,
          onclick: openContactDialog }, "Add contact"))),
    el("details", { class: "messages-account-details",
      "data-disclosure-key": messagingAccountScope() + ":account-details" }, el("summary", {}, "Account details"),
      c ? syncLine(c) : el("p", { class: "small faint" }, NOT_READY),
      c ? addressBlock(c) : null, accountActions(removeWarning(personal))));
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
    el("div", { class: "callout" }, "Whoever controls this browser can "
      + "spend the account. Make a backup file right after you create it."),
    el("div", { class: "dialog-actions" },
      el("button", { class: "btn", type: "button", onclick: pickRestore }, "Recover access"),
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
      + "not a wallet, and its payments need no approval. Whoever controls this browser can "
      + "spend it."),
    personal.backedUp ? null : accountBackupNote(),
    accountBalanceBlock(b),
    b ? balanceWarnings(b.total).map((t) => el("div", { class: "callout warn", role: "status" }, t))
      : null,
    c ? syncLine(c) : el("p", { class: "small faint" }, NOT_READY),
    c ? addressBlock(c) : null,
    c ? fundBlock() : null,
    accountActions(removeWarning(personal)));
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
    el("details", { class: "qr-toggle", "data-disclosure-key": messagingAccountScope() + ":public-qr" },
      el("summary", {}, "Show QR code"),
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
        + "account can send a message after each block. A wallet pays it, and its devices "
        + "approve it as they approve any payment."), warn, refusal),
    el("div", { class: "req-actions" }, pick,
      el("button", {
        class: "btn primary sm", type: "button", disabled: !wallets.length,
        onclick: act(() => fundFromWallet(pick ? pick.value : wallets[0].id)),
      }, "Fund from a wallet"),
      el("button", { class: "btn sm", type: "button", onclick: act(copyFundingRequest) },
        "Copy request")),
    wallets.length ? null : el("p", { class: "small faint" }, "This browser holds no device of a "
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
      guard(receivedBubble, r, "Unknown sender", "Not verified", otherWhere(r.index)))),
    el("p", { class: "small faint" },
      explorerText(NETWORKS[personal.network], "View transaction")));
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

const ON_CHAIN_FINE = "On-chain text is permanent. This personal account pays the network fee; "
  + "the recipient receives 0 ZEC. Only Zcash memo encryption protects the text.";
const ON_CHAIN_LIMITS = "This browser keeps the text of the messages that you sent. It is not in "
  + "the backup file. Private windows and Tor Browser forget it when they close.";

export function contactView() {
  const contact = personal && personal.contacts.find((c) => c.index === state.contact);
  if (!contact) return chatsWorkspace();
  const name = memoShown(contact.name);
  return el("section", { class: "messages-thread messages-zcash-thread", "aria-label": "Zcash chat with " + name },
    el("header", { class: "messages-thread-header messages-conversation-head" },
      el("button", {
        class: "btn ghost sm messages-mobile-back", type: "button", "data-key": "contact-back",
        onclick: () => { state.contact = null; ui.tab = "chats"; render(); },
      }, "← Messages"),
      el("span", { class: "av round", "aria-hidden": "true" }, initials(name)),
      el("div", { class: "messages-thread-title messages-conversation-title" }, el("h2", { tabindex: "-1",
        "data-key": "messages-thread-title" }, name),
        el("p", { class: "messages-thread-meta" }, "On-chain · Shielded memo")),
      el("span", { class: "badge plain" }, "Unverified contact"),
      el("button", { class: "btn ghost sm", type: "button", onclick: () => {
        state.contact = null; ui.tab = "chats"; focusAfter("messages-account-summary", true); render();
      } }, "Account & funding")),
    el("details", { class: "messages-details messages-conversation-details",
      "data-disclosure-key": messagingAccountScope() + ":contact-" + contact.index + ":details" },
      el("summary", {}, "Conversation details"),
      el("p", { class: "small muted" }, "This label is your private contact name. A received memo "
        + "has no sender address; anyone who knows your reply address can write here."),
      el("div", { class: "messages-detail-row" }, el("span", { class: "label" }, "Send to"),
        el("span", { class: "hex" }, contact.address), copyBtn(contact.address, "Copy contact address")),
      contactAddress(contact, name),
      el("p", { class: "small muted" }, "A message is a payment of no value. A wallet that hides "
        + "payments of no value does not show it. Building the proof can take about a minute; "
        + "incoming messages appear after a block is scanned."),
      el("p", { class: "small muted" }, "The group server does not carry these messages. "
        + "Network services can observe connections and transaction retrieval. There are no "
        + "read receipts or advanced post-quantum encryption."),
      el("p", { class: "small faint" }, ON_CHAIN_LIMITS),
      personal.backedUp ? null : accountBackupNote()),
    personal.backedUp ? null : el("div", { class: "messages-backup-reminder" },
      el("span", { class: "small muted" }, "Keep a separate account backup."),
      el("button", { class: "btn sm", type: "button", onclick: openAccountBackup }, "Back up account")),
    contactMessages(contact, name));
}

function contactAddress(contact, name) {
  const why = acct ? acctAddressWhy() : NOT_READY;
  if (why) return el("div", { class: "callout" }, why);
  const address = addressFor(contact.index);
  return el("section", { class: "messages-reply-address" },
    el("h3", {}, "Your address for " + name),
    el("p", { class: "small muted" }, "Give this address to " + name + ". A message that reaches "
      + "it shows in this chat, marked as sent to the address you gave " + name + ". Anyone who "
      + "knows the address can write here."),
    el("div", { class: "addr-box" }, el("span", { class: "hex" }, address),
      copyBtn(address, "Copy address", "btn sm primary")),
    el("details", { class: "qr-toggle",
      "data-disclosure-key": messagingAccountScope() + ":contact-" + contact.index + ":qr" },
      el("summary", {}, "Show QR code"),
      qrBox(address, "Address for " + name)));
}

// A message with an explorer link: each received one, and each sent one that a block holds.
const linked = (rows) => rows.some((r) => r.dir !== "out" || sentStateOf(r) === "chain");

function contactMessages(contact, name) {
  const rows = contactRows(contact), items = rows.map((r) => guard(onChainRow, r, name));
  const accountScope = messagingAccountScope();
  const none = el("div", { class: "messages-empty-thread" }, el("h3", {}, "Start with a message"),
    el("p", { class: "small muted" }, "Share your reply address in Conversation details. A "
      + "message to that address shows here after the next block."));
  const timeline = logBox("log-oc-" + contact.index, "Messages with " + name, items, none);
  timeline.setAttribute("data-account-scope", accountScope);
  return el("section", { class: "chat messages-conversation-body" },
    timeline,
    el("div", { class: "messages-composer" }, composer({
      kind: "oc-" + contact.index, why: messageWhy(), seats: [], to: "Message to " + name,
      accountScope,
      fine: ON_CHAIN_FINE, label: "Send on chain", key: "chat:personal:" + contact.index,
      send: (text) => reviewOrSend(contact, text), plan: (text) => messagePlan(text, splitParts),
      progress: acct ? acct.progress : "",
    })),
    linked(rows) ? el("p", { class: "small faint" },
      explorerText(NETWORKS[personal.network], "View transaction")) : null);
}

const reviewedCosts = messagingCostReview();
let pendingCostReview = null, costReviewEpoch = 0;

export function clearMessagingCostReview() {
  costReviewEpoch++;
  pendingCostReview = null;
  reviewedCosts.clear();
}

export function hasMessagingCostReview() {
  if (pendingCostReview && (pendingCostReview.account !== acct || !personal
    || pendingCostReview.network !== personal.network)) pendingCostReview = null;
  return !!pendingCostReview;
}

export function closeMessagingCostReview() {
  const index = pendingCostReview?.contact.index;
  pendingCostReview = null;
  if (index != null) focusAfter("TEXTAREA:chat-text-oc-" + index + ":0", true);
  render();
}

function reviewOrSend(contact, text) {
  const plan = messagePlan(text, splitParts);
  if (plan.error) throw new Error(plan.error);
  if (!reviewedCosts.needs(acct, contact, personal.network, plan)) return sendOnChain(contact, text);
  pendingCostReview = { account: acct, contact: { ...contact }, network: personal.network,
    text, plan, changed: false, epoch: costReviewEpoch };
  focusAfter("messaging-review-cancel", true);
  render();
  return false;   // The existing composer keeps its draft while the review is open.
}

async function confirmMessagingCost() {
  const review = pendingCostReview;
  if (!review || !hasMessagingCostReview()) return;
  const contact = personal.contacts.find((c) => c.index === review.contact.index);
  if (!contact || contact.address !== review.contact.address || state.contact !== contact.index) {
    closeMessagingCostReview();
    throw new Error("The account or contact changed. Review the message again before sending.");
  }
  const boxId = "chat-text-oc-" + contact.index, box = document.getElementById(boxId);
  const text = typeof box?.value === "string" ? box.value.trim() : review.text;
  const plan = messagePlan(text, splitParts);
  if (plan.error || !text) throw new Error(plan.error || "Write a message first.");
  if (text !== review.text || plan.parts !== review.plan.parts || plan.fee !== review.plan.fee) {
    Object.assign(review, { text, plan, changed: true });
    render();
    return;
  }
  const why = messageWhy(plan.fee);
  if (why) throw new Error(why);
  const key = "chat:personal:" + contact.index;
  if (busy.has(key)) return;
  busy.add(key);
  pendingCostReview = null;
  render();
  try {
    await sendOnChain(contact, text);
    if (acct === review.account && review.epoch === costReviewEpoch) {
      reviewedCosts.remember(acct, contact, review.network, plan);
      clearMessageDraft(boxId, text, messagingAccountScope());
      const live = document.getElementById(boxId);
      if (typeof live?.value === "string" && live.value.trim() === text) live.value = "";
    }
  } finally { busy.delete(key); render(); }
}

export function messagingCostReviewDialog() {
  if (!hasMessagingCostReview()) return null;
  const { contact, network, text, plan, changed } = pendingCostReview;
  const name = memoShown(contact.name), fee = zatText(plan.fee) + " ZEC";
  const row = (label, value) => el("div", { class: "messages-cost-row" },
    el("dt", {}, label), el("dd", {}, value));
  return el("form", { class: "dialog messages-cost-review", role: "dialog", "aria-modal": "true",
    "aria-labelledby": "messaging-cost-title", onsubmit: act(confirmMessagingCost) },
  el("div", { class: "card-head" }, el("h2", { id: "messaging-cost-title", tabindex: "-1",
    "data-key": "messaging-cost-title", "data-first-focus": "" }, "Review message cost"),
    el("button", { class: "icon-btn", type: "button", "aria-label": "Close cost review",
      onclick: closeMessagingCostReview }, "×")),
  changed ? el("p", { class: "callout", role: "status" },
    "The message changed. Check the updated cost before sending.") : null,
  el("p", { class: "small muted" }, "This message is a permanent on-chain transaction. Your "
    + "personal account pays its fee without team approval."),
  el("dl", { class: "messages-cost-summary" },
    row("From", "Personal messaging account · " + NETWORKS[network].label),
    row("To", el("div", {}, name, el("p", { class: "hex" }, contact.address))),
    row("Recipient receives", "0 ZEC"),
    row("Message", plan.parts + (plan.parts === 1 ? " memo part" : " memo parts")),
    row("Network fee", fee), row("Total debit", fee)),
  el("details", {}, el("summary", {}, "Message text"), el("p", { class: "msg-text" }, text)),
  el("p", { class: "small faint" }, "A wallet that hides zero-value payments may not show this "
    + "message. Further messages at this cost use the explicit Send on chain button. A change "
    + "in cost or memo parts needs another review in this tab."),
  el("div", { class: "dialog-actions" },
    el("button", { class: "btn", type: "button", "data-key": "messaging-review-cancel",
      onclick: closeMessagingCostReview }, "Keep editing"),
    el("button", { class: "btn primary", type: "submit" }, "Send for " + fee)));
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
  return el("div", { class: "msg incoming" },
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
  return el("div", { class: "msg outgoing" },
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
