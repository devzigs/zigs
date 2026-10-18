// Invite links and hash routing.
import { LINK_CHAT_ID, linkRefusal } from "./util.js";
import { parseHash, validRoom } from "./chat.js";
import { showBanner, state, ui } from "./app-state.js";
import { chats, gkeys, lockedVault, putKey } from "./app-keystore.js";
import { openGroup, roomKeys } from "./app-groups.js";
import { joinLinks } from "./app-messages.js";
import { render } from "./app-loop.js";

const MISSING_SECRET = "This link is missing the wallet secret. Ask for the full invite link.";
export const setHash = (h) => { try { history.replaceState(null, "", h); } catch {} };
export function adoptInviteKey() {
  if (lockedVault) return;
  const { chat, id, key } = parseHash(location.hash);
  if (chat) adoptChatLink(id, key); else adoptWalletLink(id, key);
}

function adoptWalletLink(gid, key) {
  if (!key) return;
  const refusal = linkRefusal(gkeys[gid], key, isChatId(gid));
  if (refusal) showBanner("bad", refusal);
  else if (validRoom({ id: gid, key })) putKey(gid, key);
  // The id of a chat opens no wallet: clear it, or the missing-secret banner hides the reason.
  setHash(refusal === LINK_CHAT_ID ? "#" : "#" + gid);
}

// A chat and a wallet never share an id: a wallet key must not be stored under a chat id.
export const isChatId = (id) => !!chats.list[id] || !!roomKeys[id];
export const badChatLink = (cid, key) => !validRoom({ id: cid, key }) || !!gkeys[cid] || !!roomKeys[cid];
// The secret leaves the fragment at once. A new chat waits in joinLinks until the person clicks
// "Join chat": a page that only loads the link, such as a link scanner, must not take the place.
function adoptChatLink(cid, key) {
  if (!key) return;
  const known = chats.list[cid], bad = badChatLink(cid, key);
  if (bad) showBanner("bad", BAD_CONTACT_LINK);
  else if (known && known.key !== key) {
    showBanner("bad", "This contact link has a different secret for a chat you already have, so "
      + "it was ignored.");
  }
  else if (!known) joinLinks.set(cid, key);
  setHash(bad ? "#" : "#c." + cid);
}
export const inviteLink = (gid) => location.origin + location.pathname + "#" + gid + "." + gkeys[gid];
export const BAD_CONTACT_LINK = "This contact link is not valid. Ask for a new one.";
const MISSING_CHAT_SECRET = "This link is missing the chat secret. Ask your contact for the full "
  + "contact link.";

export function openChat(cid) {
  if (cid) openGroup(null);
  state.cid = cid; state.contact = null; ui.leave = false;
  setHash(cid ? "#c." + cid : "#");
  render();
}

export function followHash() {
  const { chat: isChat, id } = parseHash(location.hash);
  if (isChat) { followChat(id); return; }
  const gid = id || null;
  if (gid === state.gid && !state.cid) return;
  if (gid && !gkeys[gid]) { showBanner("bad", MISSING_SECRET); return; }
  ui.tab = "overview";
  openGroup(gid);
}

// `cid` comes from parseHash: "" or 20 hex characters, so it cannot name a property of Object.
function followChat(cid) {
  if (state.cid === cid) return;
  if (joinLinks.has(cid)) openGroup(null);   // the lobby shows the join card
  else if (chats.list[cid]) openChat(cid);
  else showBanner("bad", MISSING_CHAT_SECRET);
}
export const chatLink = (cid) => location.origin + location.pathname + "#c." + cid + "."
  + chats.list[cid].key;
// Owner decision D1: the page keeps its password, so every invite text says who gives it. A chat
// app browser or a private window can delete the browser data, with the key share in it.
export const PASSWORD_NOTE = "The browser asks for a password before Zigs opens. I send it to you "
  + "apart from this link.";
export const BROWSER_NOTE = "Open the link in Safari or Chrome, not in the browser of a chat app "
  + "and not in a private window: those can delete your key.";
export const chatMessage = (link) => "I started a private chat with you on Zigs. Open this link: " + link
  + ". " + BROWSER_NOTE + " " + PASSWORD_NOTE + " This link is a secret. Do not post it in a public "
  + "place. About Zigs: https://zigs.app";

// Back, forward and pasted invite links change only the fragment; follow them.
window.addEventListener("hashchange", () => {
  adoptInviteKey();
  if (!lockedVault) followHash();
});
