// Side navigation, lock screen, wallet list and create dialog.
import { busy, ready, state, ui } from "./app-state.js";
import { initials } from "./app-kit.js";
import { offReason } from "./util.js";
import { engineSettled, Z } from "./app-engine.js";
import {
  chats, forgetVault, lockedVault, lockWithPasskey, mySeatSecrets, secrets, storageOk, unlockVault,
  vault,
} from "./app-keystore.js";
import { openChat } from "./app-links.js";
import { balOf, netOf } from "./app-chain.js";
import { canWrite, db, dbReady, openGroup, toApprove } from "./app-groups.js";
import {
  act, el, guard, money, nameField, networkPick, newBadge, ruleText, unreadable, unreadChip,
} from "./app-dom.js";
import { contactName, contactOf, joinChat, joinLinks, unreadIn } from "./app-messages.js";
import { createGroup } from "./app-dkg.js";
import { newWallet, planSolana, SOL_DISCLOSURE, solPending, solServed } from "./app-sol.js";
import { personal } from "./app-account.js";
import { restore } from "./app-backups.js";
import { contactItem, contactsCard, openContactDialog, personalCard } from "./app-account-view.js";
import { focusAfter, once, render } from "./app-loop.js";
import { currentSection, walletSections, walletShown } from "./app-wallet.js";
import { icon } from "./app-icons.js";

/**
 * Why a button is off (S1): `attrs` go on the button, `note` goes next to it. `more` has the
 * checks that only this button needs (db, pending, joining), `id` names the note.
 */
export function offOf(more, id) {
  const why = offReason({ Z, settled: engineSettled, canWrite, ...more });
  return {
    attrs: { disabled: !!why, "aria-describedby": why ? id : null },
    note: why ? el("span", { class: "off-why", id }, why) : null,
  };
}

export function renderSide() {
  const nav = document.getElementById("side-nav");
  nav.replaceChildren(
    el("div", { class: "side-head" }, el("span", { class: "label" }, "Wallets"),
      el("button", { class: "icon-btn", type: "button", title: "New wallet", "aria-label": "New wallet", onclick: newWallet }, "+")),
    ...(state.groups.length ? state.groups.map((g) => guard(sideItem, g))
      : [el("p", { class: "side-empty" }, sideEmpty())]),
    ...(walletShown() ? sectionNav(walletSections()) : []),
    el("div", { class: "side-head" }, el("span", { class: "label" }, "Chats"),
      el("button", { class: "icon-btn", type: "button", title: "New chat", "aria-label": "New chat",
      onclick: newChat }, "+")),
    ...Object.keys(chats.list).map((cid) => guard(chatItem, cid)),
    ...(personal ? [el("div", { class: "side-head" }, el("span", { class: "label" }, "On chain"),
      el("button", { class: "icon-btn", type: "button", title: "Add contact",
        "aria-label": "Add contact", onclick: openContactDialog }, "+")),
    ...personal.contacts.map((c) => guard(contactItem, c))] : []));
  // Any pick in the list closes the phone menu; the button's own action runs first.
  nav.onclick = (ev) => { if (ev.target.closest("button")) ui.menu = false; };
  document.querySelector(".side").classList.toggle("menu-open", !!ui.menu);
  document.getElementById("wallet-menu").setAttribute("aria-expanded", ui.menu ? "true" : "false");
}

const SECTION_ICONS = {
  overview: "home", activity: "activity", messages: "chat", members: "devices",
  details: "settings", solana: "sol",
};

/** The side list of the wallet sections ([id, label, count] each); a pick focuses the section. */
export function sectionNav(sections) {
  const [now] = currentSection(sections);
  const item = ([id, label, count]) => el("button", {
    class: "side-item" + (id === now ? " active" : ""), type: "button", id: "tab-" + id,
    "data-key": "tab-" + id, "aria-current": id === now ? "page" : null,
    onclick: () => { ui.tab = id; focusAfter("panel-" + id, true); render(); },
  }, icon(SECTION_ICONS[id]), el("span", { class: "side-name" }, label),
  el("span", { class: "side-tail" }, count));
  return [el("div", { class: "side-head" }, el("span", { class: "label" }, "This wallet")),
    ...sections.map(item)];
}

// The Menu button of a phone opens the side list over the page. Escape or a click outside the
// list closes it.
function closeMenu(refocus) {
  ui.menu = false;
  if (refocus) focusAfter("menu", true);
  render();
}
/** Escape closes the open Menu and gives the focus back to the Menu button. */
export function menuKey(ev) {
  if (ev.key === "Escape" && ui.menu) closeMenu(true);
}
/** A click outside the side list closes the open Menu. */
export function menuOutside(ev) {
  if (ui.menu && !ev.target.closest?.(".side")) closeMenu(false);
}
/** The skip link moves the focus to the page. It changes no fragment: that names a wallet. */
export function skipToPage(ev) {
  ev.preventDefault();
  document.getElementById("app").focus();
}
document.getElementById("wallet-menu")?.addEventListener("click", () => {
  ui.menu = !ui.menu;
  render();
});
document.addEventListener("keydown", menuKey);
document.addEventListener("click", menuOutside);
document.querySelector(".skip-link")?.addEventListener("click", skipToPage);

const newChat = () => { ui.newChat = true; render(); };

function chatItem(cid) {
  const here = cid === state.cid, name = contactName(cid);
  return el("button", {
    class: "side-item" + (here ? " active" : ""), type: "button",
    "aria-current": here ? "page" : null, "data-key": "chat-" + cid, onclick: () => openChat(cid),
  }, el("span", { class: "av" }, initials(contactOf(cid) ? name : "")),
  el("span", { class: "side-name" }, name),
  el("span", { class: "side-tail" }, unreadChip(unreadIn(cid))));
}

const sideEmpty = () => lockedVault ? "Locked." : dbReady ? "No wallets yet." : "Connecting…";

function sideItem(g) {
  const n = toApprove(g.id).length + solPending(g.id);
  const u = unreadIn(g.id), here = g.id === state.gid;
  const tail = n
    ? el("span", { class: "side-count", role: "img", title: n + " to approve",
      "aria-label": n + " to approve" }, String(n))
    : el("span", { class: "side-meta", title: ruleText(g.t, g.n) },
      g.movedTo ? "Moved" : g.t + " of " + g.n);
  const unread = unreadChip(u);
  return el("button", {
    class: "side-item" + (here ? " active" : ""), type: "button",
    // With its sections in the list, the section is the page and the wallet the current item.
    "aria-current": here ? (walletShown() ? "true" : "page") : null, "data-key": "wallet-" + g.id,
    onclick: () => { ui.tab = "overview"; openGroup(g.id); },
  }, el("span", { class: "av" }, initials(g.name)),
  el("span", { class: "side-name" }, g.name), el("span", { class: "side-tail" }, unread, tail));
}

export function forgetBox() {
  const cancel = () => { ui.forget = false; render(); };
  return el("div", { class: "callout bad" },
    el("p", {}, "Without the passkey, the key shares in this browser cannot be opened. Delete "
      + "them, then restore each seat from its backup file. A seat with no backup is lost, but "
      + "the wallet still works while enough other signers remain. Direct chats in this browser "
      + "are deleted too. They are not in backup files, and a chat with two people cannot be "
      + "joined again. The personal account is deleted as well. Only its backup file brings it "
      + "back, and without one its money is lost."),
    el("div", { class: "dialog-actions" },
      el("button", { class: "btn", type: "button", onclick: cancel }, "Cancel"),
      el("button", { class: "btn", type: "button", onclick: forgetVault },
        "Delete the locked keys")));
}

export function lockView() {
  const ask = () => { ui.forget = true; render(); };
  const text = lockedVault.damaged
    ? "The locked keys in this browser are damaged and cannot be opened."
    : "The key shares in this browser are encrypted with your passkey. "
      + "Unlock with Face ID, Touch ID or your security key.";
  return el("div", { class: "card empty" }, el("h3", {}, "Zigs is locked"),
    el("p", { class: "small" }, text),
    lockedVault.damaged ? null
      : el("button", {
        class: "btn primary", type: "button", disabled: !engineSettled, onclick: act(unlockVault),
      }, "Unlock"),
    ui.forget ? forgetBox()
      : el("button", { class: "btn ghost sm", type: "button", onclick: ask }, "Lost the passkey?"));
}

function lockButton() {
  if (vault) {
    return el("button", { class: "btn", type: "button", onclick: () => location.reload(),
      title: "Encrypted with your passkey. Reload to lock the page." }, "Lock now");
  }
  const can = storageOk && !!window.PublicKeyCredential;
  return el("button", { class: "btn", type: "button", disabled: !can, onclick: act(lockWithPasskey),
    title: can ? "Encrypt the key shares and the personal account in this browser with a passkey"
      : "This browser has no passkey support" }, "Lock with a passkey");
}

export function loadingView() {
  return el("div", { class: "card empty" }, el("span", { class: "dot busy" }),
    el("h3", {}, Z ? "Connecting to the group server" : "Loading the crypto engine"),
    el("p", { class: "small" }, "Your wallets appear in a moment."));
}

export function lobby() {
  const restoreInput = el("input", {
    id: "restore", type: "file", accept: ".zigsbackup,.json,application/json", hidden: true,
    onchange: (ev) => {
      const file = ev.target.files[0];
      ev.target.value = "";
      if (file) restore(file);
    },
  });
  const restoreBtn = (cls) => el("button", {
    class: cls, type: "button", onclick: () => restoreInput.click(),
  }, "Restore from backup");
  const off = offOf({ db: !!db }, "why-new-wallet");
  const actions = lobbyActions(off, restoreBtn("btn"));
  const head = el("header", { class: "page-head" },
    el("div", { class: "ph-left" }, el("h1", {}, "Wallets"),
      el("p", { class: "muted" }, "Each wallet is a separate shared account, with its own address, "
        + "signers and approval rule.")),
    actions.length ? el("div", { class: "ph-actions" }, ...actions) : null);
  const rows = state.groups.map((g) => guard(walletRow, g));
  const body = state.groups.length
    ? el("section", { class: "card" }, el("div", { class: "list" }, rows))
    : welcome(offOf({ db: !!db }, "why-create"), restoreBtn("btn ghost sm"));
  const joins = [...joinLinks.keys()].map((cid) => guard(chatJoinCard, cid));
  return el("div", { class: "page" }, ...joins, head, body, chatsCard(),
    guard(personalCard, () => restoreInput.click()), guard(contactsCard), restoreInput);
}

// A contact link waits here until the person clicks Join. The link is kept after a failure.
function chatJoinCard(cid) {
  const key = "chatjoin:" + cid, joining = busy.has(key);
  const off = offOf({ db: !!db, joining }, "why-chat-join-" + cid);
  const join = (ev) => {
    ev.preventDefault();
    once(key, () => joinChat(cid, joinLinks.get(cid)));
    render();
  };
  return el("form", { class: "card card-pad hero-card", onsubmit: join },
    el("div", { class: "card-head" }, el("h2", {}, "Join a chat")),
    el("p", { class: "small muted" }, "Someone sent you a contact link. A chat holds two people. "
      + "Your contact sees the name below. Is this page in the browser of a chat app or in a "
      + "private window? Then open the link in Safari or Chrome first. A chat app browser or a "
      + "private window can delete your chat key."),
    nameField("chat-join-" + cid, "your contact"),
    el("div", { class: "dialog-actions" },
      el("button", { class: "btn", type: "button", disabled: joining,
        onclick: () => { joinLinks.delete(cid); render(); } }, "Cancel"),
      el("button", { class: "btn primary", type: "submit", ...off.attrs },
        joining ? "Joining the chat…" : "Join chat"),
      off.note));
}

// The sidebar is hidden on a phone, so the chats are listed here too.
function chatsCard() {
  const ids = Object.keys(chats.list), off = offOf({ db: !!db }, "why-new-chat");
  return el("section", { class: "card" },
    el("div", { class: "card-head card-pad", style: "padding-bottom:12px" }, el("h2", {}, "Chats"),
      el("button", { class: "btn sm", type: "button", ...off.attrs, onclick: newChat },
        "New chat")),
    off.note ? el("p", { class: "small muted card-pad", style: "padding-top:0" }, off.note) : null,
    ids.length ? el("div", { class: "list", style: "border-top:1px solid var(--line)" },
      ids.map((cid) => guard(chatRow, cid)))
      : el("p", { class: "small muted card-pad" }, "Write to one person who uses Zigs."));
}

function chatRow(cid) {
  const name = contactName(cid);
  return el("button", {
    class: "row-item", type: "button", "data-key": "chat-row-" + cid, onclick: () => openChat(cid),
  },
  el("span", { class: "av lg" }, initials(contactOf(cid) ? name : "")),
  el("span", { class: "ri-main" }, el("span", { class: "ri-title" }, name),
    el("span", { class: "ri-sub" }, "Direct chat · group server")),
  el("span", { class: "ri-end" }, newBadge(unreadIn(cid))),
  el("span", { class: "chev" }, "›"));
}

// With no wallet yet, the welcome card has the only actions. Locking waits until there is a wallet
// or a key share to lock.
function lobbyActions(off, restoreBtn) {
  const newBtn = el("button", {
    class: "btn primary", type: "button", ...off.attrs,
    onclick: () => { ui.create = true; render(); },
  }, "New wallet");
  if (state.groups.length) return [lockButton(), restoreBtn, newBtn, off.note];
  return Object.keys(secrets).length || vault ? [lockButton()] : [];
}

function walletRow(g) {
  if (g.unreadable) return unreadable();
  const seats = mySeatSecrets(g.id).length, n = toApprove(g.id).length, bal = balOf(g.id);
  const unread = newBadge(unreadIn(g.id));
  const status = g.movedTo ? el("span", { class: "badge plain" }, "Moved")
    : ready[g.id] === false ? el("span", { class: "badge info" }, "Setting up")
    : bal ? money(bal.total) : el("span", { class: "small faint" }, "Open to sync");
  return el("button", {
    class: "row-item", type: "button", "data-key": "wallet-row-" + g.id,
    onclick: () => { ui.tab = "overview"; openGroup(g.id); },
  },
  el("span", { class: "av lg" }, initials(g.name)),
  el("span", { class: "ri-main" }, el("span", { class: "ri-title" }, g.name),
    el("span", { class: "ri-sub" }, netOf(g).label + " · " + g.t + " of " + g.n
      + " signers must approve" + (seats ? "" : " · view only"))),
  el("span", { class: "ri-end" }, status,
    n ? el("span", { class: "badge warn" }, n + " to approve") : null, unread),
  el("span", { class: "chev" }, "›"));
}

function welcome(off, restoreLink) {
  const steps = [
    ["Pick a rule", "For example, any 2 of 3 signers must approve each payment."],
    ["Invite your signers", "Send one private invite link. Each device creates its own key share."],
    ["Approve together", "A payment goes out only after enough signers approve. On chain it looks "
      + "like a shielded payment from a standard wallet."],
  ];
  const create = el("button", {
    class: "btn primary lg", type: "button", ...off.attrs,
    onclick: () => { ui.create = true; render(); },
  }, "Create wallet");
  return el("section", { class: "card card-pad welcome" },
    el("div", { style: "display:grid;gap:6px" }, el("h2", {}, "Create your first shared wallet"),
      el("p", { class: "muted" }, "Nobody ever holds the whole key, and nobody outside your team "
        + "can read the wallet.")),
    el("ol", { class: "how" }, steps.map(([t, d], i) => el("li", {},
      el("span", { class: "how-no" }, String(i + 1)),
      el("div", { style: "display:grid;gap:2px" }, el("h3", {}, t), el("p", { class: "small muted" }, d))))),
    el("div", { style: "display:flex;align-items:center;gap:12px;flex-wrap:wrap" },
      create, restoreLink, off.note));
}

// A new testnet wallet can get its Solana Devnet part in the same setup, on a server that serves
// Solana. The box is on by default: the demo shows one setup. `ui.sol` keeps a "no" through a
// redraw, and the submit takes the choice only from a box that the person saw.
const solChosen = (from, network, fd) => !from && network === "testnet" && fd.get("sol") === "on";
function solChoice() {
  if (ui.net !== "testnet" || !solServed()) return null;
  return el("label", { class: "ack" },
    el("input", { type: "checkbox", id: "g-sol", name: "sol", checked: ui.sol !== false,
      onchange: (ev) => { ui.sol = ev.target.checked; } }),
    el("span", {}, el("b", {}, "Also set up Solana Devnet. "),
      el("span", { class: "small muted" }, SOL_DISCLOSURE)));
}

// With `from`, the dialog creates the wallet that replaces `from`, with new signers or a new rule.
export function createDialog(from = null) {
  const close = () => { ui.create = false; ui.move = false; ui.sol = undefined; render(); };
  const n0 = from ? from.n : 3, t0 = from ? from.t : 2;
  const rule = el("p", { class: "rule", id: "rule-text" }, ruleText(t0, n0));
  const off = offOf({ db: !!db }, "why-create-submit");
  const update = () => {
    const n = Number(document.getElementById("g-n")?.value), t = Number(document.getElementById("g-t")?.value);
    const ok = n >= 2 && n <= 7 && t >= 2 && t <= n;
    rule.textContent = ok ? ruleText(t, n) : "Choose 2 to 7 signers, and at least 2 approvals but no more than the signers.";
    rule.classList.toggle("bad", !ok);
  };
  const f = el("form", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "create-title", oninput: update, onsubmit: act(async (ev) => {
    const fd = new FormData(ev.target); const n = Number(fd.get("n")), t = Number(fd.get("t"));
    if (!(n >= 2 && n <= 7)) throw new Error("A wallet needs between 2 and 7 signers.");
    if (t < 2 || t > n) throw new Error("Approvals needed must be at least 2 and at most the number of signers.");
    // A replacement wallet stays on its predecessor's network: funds cannot move between networks.
    const network = from ? from.network || "testnet" : ui.net;
    if (network === "mainnet" && !ui.ack) throw new Error("Confirm that you understand Zigs is not audited before you create a mainnet wallet.");
    const withSol = solChosen(from, network, fd);
    ui.create = false; ui.move = false; ui.net = "testnet"; ui.ack = false; ui.sol = undefined;
    const name = String(fd.get("name") || "").trim() || (from ? from.name : "Treasury");
    const gid = await createGroup(name, n, t, from && from.id, network);
    if (withSol) await planSolana(gid);
  }) },
    el("div", { class: "card-head" }, el("h2", { id: "create-title" }, from ? "Change signers" : "New shared wallet"), el("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: close }, "×")),
    from ? el("ol", { class: "small muted move-steps" },
      el("li", {}, "You create a new wallet with the signers and rule you want."),
      el("li", {}, "The new signers join it with an invite link."),
      el("li", {}, "This wallet sends all its funds to the new one. Like any payment, this needs " + from.t + " approvals.")) : null,
    nameField("my-name"),
    el("label", { class: "field" }, el("span", {}, from ? "New wallet name" : "Wallet name"), el("input", { class: "input", id: "g-name", name: "name", placeholder: from ? from.name : "Team treasury", maxlength: "40", autocomplete: "off" })),
    el("div", { class: "two" },
      el("label", { class: "field" }, el("span", {}, "Signers"), el("input", { class: "input", id: "g-n", name: "n", type: "number", min: "2", max: "7", value: String(n0) })),
      el("label", { class: "field" }, el("span", {}, "Approvals needed"), el("input", { class: "input", id: "g-t", name: "t", type: "number", min: "2", max: "7", value: String(t0) }))),
    rule,
    from ? null : networkPick(),
    from ? null : solChoice(),
    el("div", { class: "callout" }, from
      ? "The new wallet gets a new address. Signers you leave out can still see this old wallet's payments, but not the new wallet's."
      : "You take seat 1. Then share the invite link with your signers. When every seat is taken, your devices create the wallet key together."),
    el("div", { class: "dialog-actions" },
      el("button", { class: "btn", type: "button", onclick: close }, "Cancel"),
      el("button", { class: "btn primary", type: "submit", ...off.attrs },
        from ? "Create new wallet" : "Create wallet"),
      off.note));
  return f;
}
