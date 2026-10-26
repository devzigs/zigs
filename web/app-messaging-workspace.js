// Presentation-only inbox. Existing wallet, relay and personal-account handlers own all data.
import { state, ui } from "./app-state.js";
import { initials } from "./app-kit.js";
import { engineSettled, Z } from "./app-engine.js";
import { offReason } from "./util.js";
import { chats } from "./app-keystore.js";
import { canWrite, db, openGroup } from "./app-groups.js";
import { openChat } from "./app-links.js";
import { chat, contactName, contactOf, joinLinks, unreadIn } from "./app-messages.js";
import { openContact, personal } from "./app-account.js";
import { contactView, openContactDialog, otherMessages, zcashAccountSetup } from "./app-account-view.js";
import { chatView } from "./app-thread.js";
import { act, el, guard, newBadge } from "./app-dom.js";
import { icon, sculptedIcon } from "./app-icons.js";
import { messagingLearnButton } from "./app-messaging-education.js";
import { focusAfter, render, wantFocus } from "./app-loop.js";
import { restore } from "./app-backups.js";
import { chatJoinCard } from "./app-shell.js";

let transport = "relay", search = "", linkSnapshot = null;
// Connection information comes from the existing relay capability, never from a new queue.
if (typeof zigs !== "undefined") zigs.use("link").then((link) => link?.watch((snapshot) => {
  linkSnapshot = snapshot; render();
})).catch(() => { /* an older host may not expose connection information */ });

export function relayUnavailable(id) {
  if (globalThis.navigator?.onLine === false) return "No network connection. Your draft stays in this tab; send it when you reconnect.";
  const group = linkSnapshot?.groups?.[id];
  if (group && !group.open) return "Reconnecting to the relay. Check the conversation before retrying a send: an earlier message may still arrive.";
  return null;
}

export function relayConnectionNotice(id) {
  const why = relayUnavailable(id);
  return why ? el("div", { class: "messages-offline", role: "status" },
    icon("chat"), el("div", {}, el("strong", {}, "Relay chat is offline"),
      el("p", {}, why + " Zcash messages use a separate network connection."))) : null;
}

export function messagingInboxBack() {
  state.contact = null;
  if (state.cid) openChat(null);
  ui.tab = "chats";
  focusAfter("messages-search", true); render();
}

const pickTransport = (next) => {
  if (state.cid) openChat(null);
  state.contact = null; ui.tab = "chats";
  transport = next; search = "";
  focusAfter("messages-tab-" + next, true); render();
};

function chooseTeam(gid) {
  transport = "relay";
  if (state.gid !== gid || state.cid || state.contact != null) openGroup(gid);
  ui.tab = "messages"; focusAfter("messages-thread-title", true); render();
}

const matches = (text) => String(text).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
const preview = (list) => list?.length ? String(list.at(-1).text || "Message").replace(/\s+/g, " ") : "No messages yet";

function conversationRow({ id, title, sub, selected, unread = 0, open, avatarText }) {
  return el("button", { class: "messages-conversation-row" + (selected ? " active" : ""),
    type: "button", "data-key": id, "aria-current": selected ? "page" : null, onclick: open },
  el("span", { class: "messages-row-avatar", "aria-hidden": "true" }, avatarText || initials(title)),
  el("span", { class: "messages-row-main" }, el("span", { class: "messages-row-title" }, title),
    el("span", { class: "messages-row-preview" }, sub)),
  el("span", { class: "messages-row-meta" }, newBadge(unread)));
}

function relayRows() {
  const teams = state.groups.filter((g) => matches(g.name));
  const direct = Object.keys(chats.list).filter((cid) => matches(contactName(cid)));
  return [
    el("h2", { class: "messages-section-label" }, "Team"),
    teams.length ? teams.map((g) => conversationRow({ id: "messages-team-" + g.id,
      title: g.name || "Wallet team", sub: "Wallet team · Encrypted relay",
      selected: ui.tab === "messages" && state.gid === g.id && !state.cid,
      unread: unreadIn(g.id, "wallet"), open: () => chooseTeam(g.id), avatarText: "↔" }))
      : el("p", { class: "small muted messages-inbox-note" }, search ? "No matching teams." : "Your wallet teams appear here."),
    el("h2", { class: "messages-section-label" }, "Direct"),
    direct.length ? direct.map((cid) => conversationRow({ id: "messages-direct-" + cid,
      title: contactName(cid), sub: contactOf(cid) ? preview(chat[cid]) : "Invite your contact",
      selected: state.cid === cid, unread: unreadIn(cid), open: () => {
        openChat(cid); focusAfter("messages-thread-title", true);
      } })) : el("p", { class: "small muted messages-inbox-note" }, search ? "No matching contacts." : "Start a direct chat with a private link."),
  ].flat();
}

function zcashRows() {
  if (!personal) return el("p", { class: "small muted messages-inbox-note" },
    "Create your messaging account to add Zcash contacts.");
  const contacts = personal.contacts.filter((c) => matches(c.name) || matches(c.address));
  return [el("h2", { class: "messages-section-label" }, "On-chain contacts"),
    contacts.length ? contacts.map((c) => conversationRow({ id: "messages-zcash-" + c.index,
      title: c.name, sub: "Shielded memos · " + personal.network,
      selected: state.contact === c.index, open: () => {
        openContact(c.index); focusAfter("messages-thread-title", true);
      } })) : el("p", { class: "small muted messages-inbox-note" }, search ? "No matching contacts." : "Add a shielded address to start a conversation."),
    el("details", { class: "messages-details messages-account-details",
      "data-disclosure-key": "messages-account-funding",
      open: wantFocus?.key === "messages-account-summary" },
      el("summary", { "data-key": "messages-account-summary" }, "Messaging account & funding"),
      guard(zcashAccountSetup, pickRestore)),
    guard(otherMessages)].flat();
}

function pickRestore() {
  const input = document.getElementById("messages-restore");
  input?.click();
}

function newConversation() {
  if (transport === "zcash") { if (personal) openContactDialog(); else pickTransport("zcash"); }
  else { ui.newChat = true; render(); }
}

function inbox() {
  return el("aside", { class: "messages-inbox", "aria-label": "Conversations" },
    el("label", { class: "messages-search" }, icon("search"),
      el("input", { class: "input", type: "search", id: "messages-search", "data-key": "messages-search",
        "aria-label": "Search conversations", placeholder: "Search conversations", value: search,
        oninput: (ev) => { if (ev.target.value !== search) { search = ev.target.value; render(); } } })),
    el("div", { class: "messages-inbox-list" }, transport === "relay" ? relayRows() : zcashRows()));
}

function emptyConversation(newChatWhy) {
  if (transport === "zcash" && (!personal || !personal.contacts.length)) return el("section", {
    class: "messages-thread messages-setup-thread", "aria-label": "Set up Zcash messages",
  }, guard(zcashAccountSetup, pickRestore));
  return el("section", { class: "messages-thread messages-empty", "aria-label": "Choose a conversation" },
    el("div", { class: "messages-empty-art", "aria-hidden": "true" }, sculptedIcon("chat")),
    el("span", { class: "label" }, transport === "relay" ? "Private coordination" : "Messages on Zcash"),
    el("h2", {}, "A little closer. A little more private."),
    el("p", {}, transport === "relay"
      ? "Open a wallet team or a direct chat. Text messages use the encrypted relay and have no blockchain fee."
      : "Choose a contact to send shielded memos. Your separate messaging account pays the network fee."),
    el("div", { class: "messages-empty-actions" },
      el("button", { class: "btn primary", type: "button", onclick: newConversation,
        disabled: transport === "relay" && (!Z || !db || canWrite === false),
        "aria-describedby": newChatWhy ? "why-new-chat" : null },
      transport === "relay" ? "New direct chat" : "Add Zcash contact"),
      messagingLearnButton()),
    el("p", { class: "small faint" }, "Messages and payment approvals stay separate."));
}

// teamContent is supplied by groupView after its existing safety/version checks.
export function messagingWorkspace(teamContent = null) {
  // Removing/replacing an account or leaving a chat must return to the inbox, not recursively
  // ask its missing conversation renderer to build the same workspace again.
  if (state.cid && !chats.list[state.cid]
    || state.contact != null && !personal?.contacts.some((c) => c.index === state.contact)) {
    messagingInboxBack();
  }
  if (state.contact != null) transport = "zcash";
  else if (state.cid || ui.tab === "messages") transport = "relay";
  const newChatWhy = transport === "relay"
    ? offReason({ Z, settled: engineSettled, db: !!db, canWrite })
    : !personal ? "Create your messaging account to add a Zcash contact." : "";
  const selected = !!state.cid || state.contact != null || !!teamContent;
  const count = state.groups.reduce((n, g) => n + unreadIn(g.id), 0)
    + Object.keys(chats.list).reduce((n, cid) => n + unreadIn(cid), 0);
  const joins = [...joinLinks.keys()];
  const tab = (id, label) => el("button", { class: transport === id ? "active" : "", type: "button",
    id: "messages-tab-" + id, "data-key": "messages-tab-" + id, role: "tab",
    "aria-selected": String(transport === id), "aria-controls": "messages-layout",
    tabindex: transport === id ? "0" : "-1",
    onkeydown: (ev) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(ev.key)) {
      ev.preventDefault(); pickTransport(ev.key === "Home" ? "relay" : ev.key === "End" ? "zcash"
        : id === "relay" ? "zcash" : "relay");
    } }, onclick: () => pickTransport(id) }, icon(id === "relay" ? "chat" : "security"), label,
  id === "relay" ? newBadge(count) : null);
  return el("div", { class: "page chat-workspace messages-workspace transport-" + transport
    + (selected ? " has-conversation" : ""), id: "panel-messages", "data-key": "panel-messages", tabindex: "-1",
    "aria-labelledby": "messages-page-title" },
  el("header", { class: "messages-heading" },
    el("div", {}, el("span", { class: "label" }, "Stay connected"), el("h1", { id: "messages-page-title" }, "Messages")),
    el("div", { class: "messages-toolbar" }, messagingLearnButton(),
      el("button", { class: "btn primary", type: "button", "data-key": "messages-new",
        disabled: transport === "relay" && (!Z || !db || canWrite === false)
          || transport === "zcash" && !personal,
        "aria-describedby": newChatWhy ? "why-new-chat" : null,
        onclick: newConversation }, icon("plus"), "New chat"))),
  newChatWhy ? el("p", { id: "why-new-chat", class: "small muted", role: "status" }, newChatWhy) : null,
  el("div", { class: "messages-tabs", role: "tablist", "aria-label": "Message transport" },
    tab("relay", "Relay"), tab("zcash", "Zcash")),
  ...joins.map((cid) => guard(chatJoinCard, cid)),
  el("div", { class: "messages-layout"
    + (transport === "zcash" && !personal ? " messages-onboarding" : ""),
    id: "messages-layout", role: "tabpanel",
    "aria-labelledby": "messages-tab-" + transport }, inbox(),
  teamContent || (state.cid ? guard(chatView) : state.contact != null ? guard(contactView) : emptyConversation(newChatWhy))),
  el("input", { id: "messages-restore", type: "file", hidden: true, accept: ".zigsbackup,.json,application/json",
    onchange: act(async (ev) => { const file = ev.target.files[0]; ev.target.value = "";
      if (file) await restore(file); }) }));
}
