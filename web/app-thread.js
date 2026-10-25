// The message card, composer and bubbles; the direct chat page.
import { finite } from "./util.js";
import { byTime, chatWarning, checkText } from "./chat.js";
import { busy, state, ui } from "./app-state.js";
import { fmtZec, initials, up, when } from "./app-kit.js";
import { Z } from "./app-engine.js";
import { chats } from "./app-keystore.js";
import { seatMine } from "./app-seats.js";
import { chatLink, chatMessage, openChat, senderNote } from "./app-links.js";
import { curChain, curNet, explorerText, netName, readsMemos, spanMs } from "./app-chain.js";
import { changedSigners } from "./app-filter.js";
import { canWrite, db, openSession } from "./app-groups.js";
import {
  act, avatar, coarse, copyBtn, el, guard, logBox, memoTexts, nameField, newBadge, noteFor,
  payTitle, proposer, secretQr, sender, setNote,
} from "./app-dom.js";
import {
  chat, chatMembers, chatPins, chatWhy, contactName, contactOf, createChat, dmTrust, leaveChat,
  NO_SIGNING, rooms, roomWarn, sendDm, sendMessage, sendSeats, signing, toggleNotify, trust,
  unreadIn,
} from "./app-messages.js";
import { chatRequest, requestCard, requestForm, requestOf, roomRequest } from "./app-payreq.js";
import { chatsWorkspace } from "./app-shell.js";
import { clearMessageDraft, focusAfter, render } from "./app-loop.js";
import { ON_CHAIN } from "./app-wallet.js";
import { messagingInboxBack, relayConnectionNotice, relayUnavailable } from "./app-messaging-workspace.js";
import { icon } from "./app-icons.js";

const FINE = "Every device of this wallet, and anyone else who has the invite link, can read "
  + "these messages. The group server stores them sealed. It sees when each message is sent, how "
  + "many there are, their padded sizes, and the IP addresses that connect.";

// The Messages section has its title in the heading block of the page: it passes `titled` false.
export function messagesCard(titled = true) {
  const changed = changedSigners();
  const head = [titled ? el("h2", {}, "Messages") : null];
  return el("section", { class: "card card-pad chat" },
    head.some(Boolean) ? el("div", { class: "card-head" }, ...head) : null,
    changed.length ? el("div", { class: "callout bad", role: "alert" }, "Signing key changed: "
      + changed.map((i) => "device " + i).join(", ") + ". Their messages are not verified.") : null,
    chat[state.gid] || memoMessages().length ? chatLog("wallet") : null,
    el("div", { class: "messages-composer" }, walletComposer("wallet")));
}

export function teamConversation(notices = []) {
  return el("section", { class: "messages-thread", "aria-label": "Wallet team conversation" },
    conversationHeader((state.g?.name || "Wallet") + " team", "Team · Encrypted relay · "
      + curNet().label + " · " + state.g.t + "-of-" + state.g.n),
    el("div", { class: "messages-thread-tools" }, conversationDetails(FINE,
      "Device signatures show continuity with a key this browser has seen. They do not verify a person’s identity.",
      readsMemos(state.gid) ? null : el("p", { class: "small muted" },
        "Reading payment memos is off. Manage this separately in Settings."))),
    ...notices, relayConnectionNotice(rooms[state.gid]), messagesCard(false));
}

function conversationHeader(title, subtitle) {
  return el("header", { class: "messages-thread-header" },
    el("button", { class: "btn ghost messages-mobile-back", type: "button", "data-key": "messages-back",
      onclick: messagingInboxBack, "aria-label": "Back to conversations" }, "←"),
    el("span", { class: "messages-row-avatar", "aria-hidden": "true" }, icon("chat")),
    el("div", { class: "messages-thread-title" },
      el("h2", { tabindex: "-1", "data-key": "messages-thread-title" }, title),
      el("p", { class: "messages-thread-meta" }, subtitle)));
}

function conversationDetails(audience, identity, extra = null) {
  const scope = state.cid ? "direct:" + state.cid : "wallet:" + state.gid;
  return el("details", { class: "messages-details", "data-disclosure-key": scope + ":privacy" },
    el("summary", {}, "Privacy & conversation details"),
    el("div", { class: "messages-details-body" },
      el("h3", {}, "Who can read this?"), el("p", { class: "small muted" }, audience),
      el("h3", {}, "Sender identity"), el("p", { class: "small muted" }, identity), extra,
      notifyButton(), el("p", { class: "small faint" },
        "Notifications apply to all relay chats while Zigs is open. Message text is never included.")));
}

// The thread of one payment, under the payment's steps.
export function discussion(ss) {
  const thread = "pay:" + ss.id;
  return el("section", { class: "chat-section" }, el("span", { class: "label" }, "Discussion"),
    chat[state.gid] ? chatLog(thread) : null, walletComposer(thread));
}

export function notifyButton() {
  if (!("Notification" in window)) return null;
  return el("button", {
    class: "btn sm", type: "button", "aria-pressed": ui.notify ? "true" : "false",
    onclick: act(toggleNotify),
  }, ui.notify ? "Notifications on" : "Notify me while Zigs is open");
}

function chatLog(thread) {
  const wallet = thread === "wallet", items = threadItems(thread, rooms[state.gid]);
  const none = wallet
    ? el("div", { class: "empty" }, el("h3", {}, "No messages yet"),
      el("p", { class: "small muted" }, "A shared space to plan, ask and keep everyone in the loop."))
    : el("p", { class: "small faint" }, "No messages about this payment yet.");
  const id = (wallet ? "log-wallet-" + state.gid : "log-pay-" + state.gid + "-" + thread.slice(4));
  return [logBox(id, wallet ? "Messages" : "Discussion", items, none),
    wallet && memoMessages().length ? el("p", { class: "small faint" },
      explorerText(curNet(), "View payment")) : null];
}

// Messages of one thread, with the payment events of the wallet thread, oldest first.
function threadItems(thread, roomId) {
  const msgs = (chat[state.gid] || []).filter((m) => m.thread === thread)
    .map((m) => ({ ...m, kind: "msg" }));
  const events = thread === "wallet"
    ? [...state.sessions.flatMap(payEvents), ...memoMessages()] : [];
  const item = { msg: msgItem, memo: memoItem };
  return [...msgs, ...events].sort(byTime)
    .map((x) => guard(item[x.kind] || eventItem, x, roomId));
}

// Memos of payments that came in to the wallet. They are on chain, so they have no sender and no
// signature: the app shows them as received data, never as a verified message. A block height
// gives only an estimated time.
function memoMessages() {
  const c = curChain(), tip = c && c.bal ? c.bal.height : 0;
  return (c && c.received || []).flatMap((r) => memoTexts(r).map((text, i) => ({
    kind: "memo", id: r.txid + ":" + i, text, value: r.value, txid: r.txid,
    at: Date.now() - spanMs(netName(state.g), r.height, tip),
  })));
}

function memoItem(m) {
  return el("div", { class: "msg memo-msg", "data-key": "memo-" + m.id },
    el("span", { class: "tx-ico in", "aria-hidden": "true" }, "↙"),
    el("div", { class: "msg-body" },
      el("div", { class: "msg-head" }, el("b", {}, "Memo with a payment of " + fmtZec(m.value)),
        el("time", {}, when(m.at)), el("span", { class: "vmark" }, ON_CHAIN)),
      memoBody(m),
      el("a", {
        class: "small", href: curNet().explorer + m.txid, target: "_blank", rel: "noopener",
      }, "View payment ↗")));
}

// A memo that is a payment request shows as a card. It has no sender and no signature.
export function memoBody(m) {
  const req = m.text === null ? null : requestOf(m.text, false);
  if (req) return requestCard(req, { id: m.id, name: "a memo", verdict: "memo", dm: false });
  return el("p", { class: "msg-text" + (m.text === null ? " faint" : "") },
    m.text === null ? "Memo is not text" : m.text);
}

const payEvents = (ss) => [
  ["1", "proposed", finite(ss.createdAt)],
  ...(Number.isFinite(ss.broadcastAt) ? [["2", "sent", ss.broadcastAt]] : []),
  ...(ss.status === "cancelled"
    ? [["3", "cancelled", finite(ss.cancelledAt || ss.createdAt)]] : []),
].map(([n, what, at]) => ({ kind: "event", id: ss.id + ":" + n, at, what, ss }));

const EVENT_TEXT = {
  proposed: (ss) => up(proposer(ss)) + " proposed " + payTitle(ss),
  sent: (ss) => "Sent: " + payTitle(ss),
  cancelled: (ss) => "Cancelled: " + payTitle(ss),
};

function eventItem(e) {
  const n = e.what === "proposed" ? unreadIn(state.gid, "pay:" + e.ss.id) : 0;
  return el("button", {
    class: "msg-event", type: "button", "data-key": "event-" + e.id,
    onclick: () => openSession(e.ss.id),
  }, el("span", {}, EVENT_TEXT[e.what](e.ss), newBadge(n)), el("time", {}, when(e.at)));
}

export const TRUST = {
  yes: ["ok", "✓ Device signature matches"], wait: ["", "Checking…"], no: ["bad", "Not verified"],
  changed: ["bad", "Key changed. Not verified."], unknown: ["bad", "Unknown sender. Not verified."],
  memo: ["bad", "Not verified"],
};

function msgItem(m, roomId) {
  return bubble(m, avatar(m.seat), sender(m.seat), trust(m, roomId), seatMine(m.seat));
}

function bubble(m, av, name, verdictKey, mine) {
  const [cls, label] = TRUST[verdictKey];
  const req = requestOf(m.text, m.thread === "dm");
  return el("div", { class: "msg " + (mine ? "outgoing" : "incoming") }, av,
    el("div", { class: "msg-body" },
      el("div", { class: "msg-head" }, el("b", {}, name), el("time", {}, when(m.at)),
        el("span", { class: "vmark " + cls }, label)),
      req ? requestCard(req, { id: m.id, name, verdict: verdictKey, dm: m.thread === "dm", mine })
        : el("p", { class: "msg-text" }, m.text)));
}

// Enter sends and Shift+Enter adds a line. A touch screen has no Shift key, so there Enter adds a
// line and the Send button sends.
function sendOnEnter(ev) {
  const newLine = ev.shiftKey || ev.isComposing || ev.keyCode === 229 || coarse();
  if (ev.key !== "Enter" || newLine) return;
  ev.preventDefault();
  ev.target.form.requestSubmit();
}

// The line under a message box that follows the text as it changes: `plan(text)` gives { fine,
// error }. A redraw gives the text back to the new box and fires an input event, which shows it.
function planLine(plan, box, id) {
  const line = el("p", { class: "hint", id, "aria-live": "polite" });
  const show = () => {
    const got = plan(box.value);
    const fine = got.fine + (got.parts ? " · " + got.parts + (got.parts === 1 ? " memo part" : " memo parts") : "");
    setNote(line, got.error || fine, "hint" + (got.error ? " bad" : ""));
  };
  box.setAttribute("aria-describedby", id);
  noteFor(line, box);
  box.addEventListener("input", show);
  show();
  return line;
}

const sendButton = (o, sending) => el("button", {
  class: "btn primary", type: "submit", disabled: !!o.why || sending,
}, sending ? "Sending…" : o.label || "Send message");

// The message box. A message on chain is permanent and costs a fee, so only the button sends it.
function messageBox(o) {
  const quick = !o.plan && !coarse();
  return el("textarea", {
    class: "input", id: "chat-text-" + o.kind, name: "text", rows: "2", disabled: !!o.why,
    "data-account-scope": o.accountScope,
    onkeydown: o.plan ? null : sendOnEnter, "aria-label": o.to,
    placeholder: o.to + (quick ? ". Enter sends, Shift+Enter adds a line" : ""),
  });
}

// `o`: kind (names the ids, so a draft stays with its own wallet or chat; no ":" in it), why (why
// it is off), warn, seats (the senders to choose from), to (the label), fine, key (the busy key),
// send(text, seat) and request (roomRequest or chatRequest, or none: it adds the form that sends a
// payment request). A message on chain also has label (the button), plan(text) (the fee line) and
// progress (the words of the step that is running).
export function composer(o) {
  const sending = busy.has(o.key);
  const box = messageBox(o);
  const form = el("form", { class: "composer", onsubmit: act((ev) => submitMessage(ev.target, o)) },
    o.why ? el("p", { class: "hint" + (o.warn ? " bad" : "") }, o.why) : null,
    o.progress ? el("p", { class: "hint", role: "status" }, o.progress) : null,
    box, o.plan ? planLine(o.plan, box, "chat-plan-" + o.kind) : null,
    el("div", { class: "composer-row" }, seatPicker(o, "chat-as-" + o.kind), requestToggle(o),
      sendButton(o, sending)),
    el("p", { class: "small faint" }, o.fine));
  return asking(o) ? el("div", { class: "composer-wrap" }, form, requestForm(o)) : form;
}

// Whether the request form of a composer is open.
const asking = (o) => !!o.request && !o.why && ui.request === o.kind;

function requestToggle(o) {
  if (!o.request) return null;
  const open = asking(o);
  const button = el("button", {
    class: "btn", type: "button", disabled: !!o.why, "aria-expanded": String(open),
    onclick: () => { ui.request = open ? null : o.kind; render(); },
  }, "Request a payment");
  return el("details", { class: "messages-actions", "data-disclosure-key": "actions:" + o.kind },
    el("summary", { "aria-label": "Conversation actions", title: "Conversation actions" }, "+"), button);
}

export function seatPicker(o, id) {
  return o.seats.length > 1 ? el("label", { class: "composer-as small muted" }, "Send as",
    el("select", { class: "input", id, name: "as" },
      o.seats.map((i) => el("option", { value: String(i) }, "Device " + i))))
    : o.seats.length === 1 ? el("span", { class: "small muted composer-as" }, "Sending from: This device") : null;
}

function walletComposer(thread) {
  return composer({
    kind: thread === "wallet" ? "wallet-" + state.gid : "pay-" + state.gid + "-" + thread.slice(4),
    why: chatWhy(),
    warn: roomWarn.has(state.gid),
    seats: sendSeats(), to: "Message to this wallet",
    fine: "No blockchain fee · Messages do not approve payments.",
    key: "chat:" + rooms[state.gid] + ":" + thread,
    send: (text, seat) => {
      const why = relayUnavailable(rooms[state.gid]);
      if (why) throw new Error(why);
      return sendMessage(thread, text, seat);
    },
    request: thread === "wallet" ? roomRequest() : null,
  });
}

export async function submitMessage(form, o) {
  const box = form.elements.text, draft = box.value, r = checkText(draft);
  if (r.error) throw new Error(r.error);
  if (busy.has(o.key)) return;
  // A box with focus keeps the page from drawing (typingMessage): let go, so that the steps show.
  if (o.plan && box.blur) box.blur();
  busy.add(o.key); render();
  try {
    const sent = await o.send(r.text, form.elements.as ? Number(form.elements.as.value) : o.seats[0]);
    if (sent === false) return;   // a cost review opened; the draft has not been sent
    clearMessageDraft(box.id, draft, o.accountScope);
    // A redraw during the send replaced the form: clear the live box, but not new typing.
    const live = document.getElementById(box.id);
    if (live && live.value === draft
      && (!o.accountScope || live.getAttribute?.("data-account-scope") === o.accountScope)) live.value = "";
  } finally { busy.delete(o.key); }
}

const DM_FINE = "Your contact, and anyone else who has the contact link, can read these messages. "
  + "Keep the link private. The group server stores them sealed. It sees when each message is "
  + "sent, how many there are, their padded sizes, the IP addresses that connect, and that you "
  + "and your contact use this chat.";

export function chatView() {
  const cid = state.cid;
  if (!chats.list[cid]) return chatsWorkspace();
  return el("section", { class: "messages-thread", "aria-label": "Direct relay conversation" },
    conversationHeader(contactName(cid), "Direct · Encrypted relay"),
    el("div", { class: "messages-thread-tools" }, conversationDetails(DM_FINE,
      "A matching signature belongs to the pinned device key. Contact names are self-chosen; verify the person through a separate trusted channel.",
      [el("p", { class: "small faint" }, "This chat lives in this browser. Private windows and Tor "
        + "Browser forget it when they close."), leaveBox(cid)])),
    relayConnectionNotice(cid),
    chatMembers[cid] && !contactOf(cid) ? chatInviteCard(cid) : null,
    chatCard(cid));
}

// The ids hold the chat id, so a draft or a scroll place stays with its own chat.
function chatCard(cid) {
  const msgs = chat[cid], kind = "dm-" + cid;
  const items = (msgs || []).map((m) => guard(dmItem, m, cid));
  const none = el("p", { class: "small faint" }, msgs ? "No messages yet." : "Loading messages…");
  const alert = chatWarning(chatPins, cid, chatMembers[cid], msgs || []);
  return el("section", { class: "card card-pad chat" },
    alert ? el("div", { class: "callout bad", role: "alert" }, alert) : null,
    logBox("log-" + kind, "Messages", items, none),
    el("div", { class: "messages-composer" }, composer({
      kind, why: signing === false ? NO_SIGNING : null, seats: [], key: "chat:" + cid + ":dm",
      to: "Message to your contact", fine: "No blockchain fee · Keep your contact link private.", send: (text) => {
        const why = relayUnavailable(cid);
        if (why) throw new Error(why);
        return sendDm(cid, text);
      },
      request: chatRequest(),
    })));
}

export function chatInviteCard(cid) {
  const link = chatLink(cid);
  return el("section", { class: "card card-pad hero-card" },
    el("div", { class: "card-head" }, el("h2", {}, "Invite your contact")),
    el("p", { class: "small muted" }, "Send this link to one person through a private channel. "
      + "Until they open it, anyone who has the link can join the chat. "
      + senderNote("your contact")),
    el("div", { class: "row-actions" }, copyBtn(link, "Copy chat link", "btn sm primary"),
      copyBtn(chatMessage(link), "Copy invitation", "btn sm")),
    secretQr(link, "chat", true));
}

function dmItem(m, cid) {
  const mine = m.from === chats.list[cid].member, contact = m.from === contactOf(cid);
  const name = mine ? "You" : contact ? contactName(cid) : "Unknown sender";
  const av = el("span", { class: "av round" + (mine ? " me" : ""), title: name }, initials(name));
  return bubble(m, av, name, dmTrust(cid, m), mine);
}

// The confirm moves focus to Cancel, so a repeated Enter cannot leave the chat.
export function leaveBox(cid) {
  const ask = (on) => () => {
    ui.leave = on; focusAfter(on ? "leave-no" : "leave-ask", true); render();
  };
  const btn = (key, cls, onclick, text) => el("button", {
    class: cls, type: "button", onclick, "data-key": key,
  }, text);
  if (!ui.leave) return el("div", {}, btn("leave-ask", "btn sm", ask(true), "Leave chat"));
  const again = contactOf(cid) ? " You cannot join this chat again." : "";
  return el("div", { class: "callout bad", role: "alert" },
    el("p", {}, "Leave this chat? It is removed from this browser only. The sealed messages stay "
      + "on the group server." + again),
    el("div", { class: "dialog-actions" }, btn("leave-no", "btn", ask(false), "Keep chat"),
      btn("leave-yes", "btn danger", act(() => leaveChat(cid)), "Leave chat")));
}

export function newChatDialog() {
  const close = () => { ui.newChat = false; render(); };
  return el("form", {
    class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "chat-title",
    onsubmit: act(async () => { ui.newChat = false; await createChat(); }),
  },
  el("div", { class: "card-head" }, el("h2", { id: "chat-title" }, "New direct chat"),
    el("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: close },
      "×")),
  nameField("chat-name", "your contact"),
  el("div", { class: "callout", id: "chat-invite-help" },
    "Create an invite link, then share it privately with one person. "
      + "Anyone with the link can join until your contact opens it."),
  el("p", { class: "hint", id: "chat-create-availability" }, !Z
    ? "The crypto engine must be available before Zigs can create a link. Check Browser status."
    : !db ? "The relay connection is unavailable. Wait for it to reconnect before creating a link."
      : canWrite === false ? "This browser cannot create a chat with the current relay access."
        : "Messages use the encrypted relay and have no blockchain fee."),
  el("div", { class: "dialog-actions" },
    el("button", { class: "btn", type: "button", onclick: close }, "Cancel"),
    el("button", { class: "btn primary", type: "submit",
      "aria-describedby": "chat-invite-help chat-create-availability",
      disabled: !Z || !db || canWrite === false }, "Create invite link")));
}
