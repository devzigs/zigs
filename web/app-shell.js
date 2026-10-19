// Side navigation, lock screen, wallet list and create dialog.
import {
  busy, clearBadBanner, openCreate, ready, resetCreate, state, ui,
} from "./app-state.js";
import { initials } from "./app-kit.js";
import { offReason } from "./util.js";
import { engineSettled, Z } from "./app-engine.js";
import {
  chats, forgetVault, lockedVault, lockWithPasskey, mySeatSecrets, secrets, storageOk, unlockVault,
  vault,
} from "./app-keystore.js";
import { openChat } from "./app-links.js";
import { balOf, netOf } from "./app-chain.js";
import { canWrite, closeSession, db, dbReady, openGroup, toApprove } from "./app-groups.js";
import {
  act, el, guard, money, nameField, networkPick, newBadge, ruleText, unreadable, unreadChip,
} from "./app-dom.js";
import { contactName, contactOf, joinChat, joinLinks, unreadIn } from "./app-messages.js";
import { createGroup } from "./app-dkg.js";
import {
  newWallet, planSolana, SOL_DISCLOSURE, solOn, solPending, solServed,
} from "./app-sol.js";
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
  lockPage(!!ui.menu && phone());
}
// The open Menu of a phone keeps the page, the skip link and the logo out of reach.
function lockPage(on) {
  for (const s of [".main", ".skip-link", ".logo"]) document.querySelector(s).inert = on;
}

const SECTION_ICONS = {
  overview: "home", approvals: "approvals", activity: "activity", messages: "chat",
  members: "devices", recovery: "key",
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

// The Menu button of a phone opens the side list over the page, and the page takes no focus or
// tap while it is open. Escape or a tap outside the list closes it.
const PHONE = "(max-width: 760px)";
const phone = () => matchMedia(PHONE).matches;
function closeMenu(refocus) {
  ui.menu = false;
  if (refocus) focusAfter("menu", true);
  render();
}
/** Escape closes the open Menu and gives the focus back to Menu; Tab stays in the Menu. */
export function menuKey(ev) {
  if (!ui.menu) return;
  if (ev.key === "Escape") closeMenu(true);
  else if (ev.key === "Tab" && phone()) tabRound(ev);
}
// Tab on the last item of the open Menu goes to Menu, and Shift+Tab on Menu to the last item.
function tabRound(ev) {
  const menu = document.getElementById("wallet-menu");
  const items = document.getElementById("side-nav").querySelectorAll("button:not(:disabled)");
  const last = items[items.length - 1];
  const [from, to] = ev.shiftKey ? [menu, last] : [last, menu];
  if (!to || document.activeElement !== from) return;
  ev.preventDefault();
  to.focus();
}
/** A window that grows past the phone width closes the open Menu: its button is gone there. */
export function menuWidth(ev) {
  if (!ev.matches && ui.menu) closeMenu(false);
}
// The query stays referenced, so its listener stays too.
const phoneQuery = matchMedia(PHONE);
phoneQuery.onchange = menuWidth;
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
  const count = n
    ? el("span", { class: "side-count", role: "img", title: n + " to approve",
      "aria-label": n + " to approve" }, String(n))
    : null;
  const rule = n ? null : el("span", { class: "side-meta", title: ruleText(g.t, g.n) },
    g.movedTo ? "Moved" : g.t + " of " + g.n);
  return el("button", {
    class: "side-item" + (here ? " active" : ""), type: "button",
    // With its sections in the list, the section is the page and the wallet the current item.
    "aria-current": here ? (walletShown() ? "true" : "page") : null, "data-key": "wallet-" + g.id,
    onclick: () => {
      ui.tab = "overview";
      // The open wallet keeps its chain: openGroup would start a second one beside its sync.
      if (g.id === state.gid) { closeSession(); render(); return; }
      openGroup(g.id);
    },
  }, el("span", { class: "av" }, initials(g.name)),
  el("span", { class: "side-label" }, el("span", { class: "side-name" }, g.name), rule),
  el("span", { class: "side-tail" }, unreadChip(u), count));
}

export function forgetBox() {
  const cancel = () => { ui.forget = false; render(); };
  return el("div", { class: "callout bad" },
    el("p", {}, "Without the passkey, the key shares in this browser cannot be opened. Delete "
      + "them, then restore each device from its backup file. A device with no backup is lost, "
      + "but the wallet still works while enough other devices remain. Direct chats in this "
      + "browser "
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
        + "devices and approval rule.")),
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
    onclick: () => { openCreate(); render(); },
  }, "New wallet");
  if (state.groups.length) return [lockButton(), restoreBtn, newBtn, off.note];
  return Object.keys(secrets).length || vault ? [lockButton()] : [];
}

function walletRow(g) {
  if (g.unreadable) return unreadable();
  const seats = mySeatSecrets(g.id).length, bal = balOf(g.id);
  const n = solPending(g.id) + toApprove(g.id).length;
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
    el("span", { class: "ri-sub" }, netOf(g).label + " · Any " + g.t + " of " + g.n
      + " devices" + (seats ? "" : " · view only"))),
  el("span", { class: "ri-end" }, status,
    n ? el("span", { class: "badge warn" }, n + " to approve") : null, unread),
  el("span", { class: "chev" }, "›"));
}

function welcome(off, restoreLink) {
  const steps = [
    ["Pick a rule", "For example, any 2 of 3 devices must approve each payment."],
    ["Add your devices", "Send one private invite link. Each device creates its own key share."],
    ["Approve together", "A payment goes out only after enough devices approve. On chain it looks "
      + "like a shielded payment from a standard wallet."],
  ];
  const create = el("button", {
    class: "btn primary lg", type: "button", ...off.attrs,
    onclick: () => { openCreate(); render(); },
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
const solChosen = (from, network, sol) => !from && network === "testnet" && sol === true;
function solChoice() {
  if (ui.net !== "testnet" || !solServed()) return null;
  return el("label", { class: "ack" },
    el("input", { type: "checkbox", id: "g-sol", name: "sol", checked: ui.sol !== false,
      onchange: (ev) => { ui.sol = ev.target.checked; } }),
    el("span", {}, el("b", {}, "Also set up Solana Devnet. "),
      el("span", { class: "small muted" }, SOL_DISCLOSURE)));
}

// The parts of the dialog. The ids are the ones that the tests and the harness fill.
const names = (from) => [nameField("my-name"),
  el("label", { class: "field" }, el("span", {}, from ? "New wallet name" : "Wallet name"),
    el("input", { class: "input", id: "g-name", name: "name", maxlength: "40",
      placeholder: from ? from.name : "Team treasury", autocomplete: "off" }))];
// `note`: the id of the line that says what the numbers mean, for a screen reader.
const number = (label, id, name, value, note) => el("label", { class: "field" },
  el("span", {}, label), el("input", { class: "input", id, name, type: "number", min: "2",
    max: "7", value: String(value), "aria-describedby": note ?? null }));
const counts = (n0, t0, note) => el("div", { class: "two" },
  number("Devices", "g-n", "n", n0, note), number("Approvals needed", "g-t", "t", t0, note));
const moveParts = (from, nameParts, ruleParts) => [el("ol", { class: "small muted move-steps" },
  el("li", {}, "You create a new wallet with the devices and rule you want."),
  el("li", {}, "The new devices join it with an invite link."),
  el("li", {}, moveFundsText(from))),
...nameParts, ...ruleParts];
// The funds that move: Change devices moves the Zcash funds only, so a wallet with a Solana part
// is told to check that part on its own.
const moveFundsText = (from) => "This wallet sends all its Zcash funds to the new one. Like any "
  + "payment, this needs " + from.t + " approvals." + (solOn() ? " The Solana part of this wallet "
  + "does not move this way: check it in its Solana section." : "");
// What a rule means when devices are lost: how many can be missing, and how many can spend. With
// every device needed, one lost device stops the wallet.
export const marginText = (t, n) => (t === n ? "Each payment needs every device. When one "
  + "device is lost, the wallet cannot pay until its key share comes back from its backup file."
  : lostText(n - t) + " Any " + t + " devices together can spend the funds, so keep each one "
    + "safe.");
const lostText = (m) => (m === 1 ? "1 device" : m + " devices")
  + " can be lost or offline, and the wallet still pays.";
const BAD_RULE = "Choose 2 to 7 devices, and at least 2 approvals but no more than the devices.";
const ACK_FIRST = "Confirm that one lost device stops all payments, or use the recommended 2 of 3.";
const fieldValue = (id) => document.getElementById(id)?.value ?? "";
// The numbers of a rule that a wallet can have: 2.5 devices is no rule.
const ruleOk = (n, t) => Number.isInteger(n) && Number.isInteger(t) && n >= 2 && n <= 7
  && t >= 2 && t <= n;

function checkRule(n, t) {
  if (!Number.isInteger(n) || n < 2 || n > 7) {
    throw new Error("A wallet needs between 2 and 7 devices.");
  }
  if (!Number.isInteger(t) || t < 2 || t > n) {
    throw new Error("Approvals needed must be at least 2 and at most the number of devices.");
  }
}

// The line of the rule, the line of t = n and its box. `update` redraws them from the fields.
function ruleLines(n0, t0) {
  const rule = el("p", { class: "rule", id: "rule-text" }, ruleText(t0, n0));
  const margin = el("p", { class: "small muted", id: "margin-text", role: "status" },
    marginText(t0, n0));
  const update = () => {
    const n = Number(fieldValue("g-n")), t = Number(fieldValue("g-t"));
    const ok = ruleOk(n, t);
    rule.textContent = ok ? ruleText(t, n) : BAD_RULE;
    rule.classList.toggle("bad", !ok);
    margin.textContent = ok ? marginText(t, n) : "";
    ack.hidden = !(ok && t === n);
  };
  const ack = marginAck(t0 !== n0, update);
  return { rule, margin, ack, update };
}

// A wallet without a margin needs a tick. The reset puts the recommended rule back.
function marginAck(hidden, update) {
  const reset = () => {
    document.getElementById("g-n").value = "3";
    document.getElementById("g-t").value = "2";
    document.getElementById("g-margin-ack").checked = false;
    document.getElementById("create-error")?.remove();
    ui.marginAck = false; ui.createError = null;
    update();
    clearBadBanner(ACK_FIRST);
    // The new-wallet steps have a step heading; Change devices has the number fields only.
    (document.getElementById("create-step-1") ?? document.getElementById("g-n"))?.focus();
  };
  return el("div", { class: "margin-ack", hidden },
    el("label", { class: "ack" },
      el("input", { type: "checkbox", id: "g-margin-ack", checked: ui.marginAck === true,
        onchange: (ev) => { ui.marginAck = ev.target.checked; } }),
      el("span", { class: "small" }, "I understand that one lost device stops all payments "
        + "until I restore its backup file.")),
    el("button", { class: "btn sm", type: "button", onclick: reset }, "Use recommended 2 of 3"));
}

export function endCreate() { ui.create = false; ui.move = false; resetCreate(); }
const closeCreate = () => { endCreate(); render(); };

// A replacement wallet stays on its predecessor's network: funds cannot move between networks.
async function submitWallet({ name, n, t, sol }, from) {
  checkRule(n, t);
  const network = from ? from.network || "testnet" : ui.net;
  if (network === "mainnet" && !ui.ack) throw new Error("Confirm that you understand Zigs is "
    + "not audited before you create a mainnet wallet.");
  const withSol = solChosen(from, network, sol);
  endCreate(); ui.net = "testnet"; ui.ack = false;
  const gid = await createGroup(name, n, t, from && from.id, network);
  if (gid && withSol) await planSolana(gid);
}
// The first submit closes the dialog before it waits: a second submit of the same form is stale.
const moveSubmit = (from) => act(async (ev) => {
  if (!ui.move) return;
  const fd = new FormData(ev.target), n = Number(fd.get("n")), t = Number(fd.get("t"));
  if (t === n && !ui.marginAck) throw new Error(ACK_FIRST);
  await submitWallet({ name: String(fd.get("name") || "").trim() || from.name, n, t,
    sol: fd.get("sol") === "on" }, from);
});

// The steps of a new wallet: what it is, its rule, its names, the review. Enter submits the form
// at every step. Each Next keeps the values of its step in `ui.createDraft`; the review shows
// them, and the last submit creates the wallet from them.
const STEPS = ["Your wallet, protected together", "Choose your protection", "Name your wallet",
  "Review your wallet"];
const NEXT = ["Set up my wallet", "Next", "Review wallet", "Create wallet"];
function takeRule() {
  const n = Number(fieldValue("g-n")), t = Number(fieldValue("g-t"));
  checkRule(n, t);
  if (t === n && !ui.marginAck) throw new Error(ACK_FIRST);
  ui.createDraft = { ...ui.createDraft, n, t };
}
function takeNames() {
  const box = document.getElementById("g-sol");
  ui.createDraft = { ...ui.createDraft, name: fieldValue("g-name").trim(),
    label: fieldValue("my-name").trim(), sol: !!box && box.checked };
}
const TAKE = [() => {}, takeRule, takeNames];
let stepAt = 0;
const goStep = (i) => {
  ui.createStep = i; ui.createError = null; stepAt = Date.now();
  focusAfter("create-step-" + i, true); render();
};
// The error of a step shows in the dialog, next to its buttons, not in the page banner.
function nextStep(ev) {
  ev.preventDefault();
  try { TAKE[ui.createStep](); } catch (e) { ui.createError = e.message; render(); return; }
  goStep(ui.createStep + 1);
}
// The seat takes its label from what this browser keeps: the label that the review showed, also
// when another tab typed another one since.
async function createFromDraft() {
  const d = ui.createDraft;
  if (d.t === d.n && !ui.marginAck) throw new Error(ACK_FIRST);
  try { localStorage.setItem("zf-name", d.label ?? ""); } catch { /* no storage: as typed */ }
  await submitWallet({ ...d, name: d.name || "Treasury" }, null);
}
const stepSubmit = (ev) => (ui.createStep < STEPS.length - 1 ? nextStep(ev)
  : act(createFromDraft)(ev));
// The second click of a double click lands on the button of the next step, which can be Create
// wallet. A phone sends a double tap as two clicks of detail 1, so a click soon after a step
// change does not count either. A click of a script or the Enter key has detail 0.
const freshClick = (ev) => !(ev.detail > 1 || (ev.detail === 1 && Date.now() - stepAt < 400));
const firstClick = (ev) => { if (!freshClick(ev)) ev.preventDefault(); };
const backClick = (s) => (ev) => { if (freshClick(ev)) goStep(s - 1); };

const step = (i, ...kids) => el("section", { class: "guide-step", hidden: ui.createStep !== i,
  "aria-labelledby": "create-step-" + i },
el("h3", { id: "create-step-" + i, tabindex: "-1", "data-key": "create-step-" + i }, STEPS[i]),
...kids);
const introStep = () => step(0,
  el("p", {}, "Each device of the wallet creates its own key share. No device ever holds the "
    + "whole key."),
  el("p", {}, "Every device joins once, during setup. After that, each payment needs the "
    + "approvals of your rule, for example any 2 of 3 devices."));
const ruleStep = (lines) => step(1,
  el("p", {}, "Recommended: any 2 of 3 devices. When one device is lost, the other two can still "
    + "approve payments."),
  lines.rule,
  el("details", {}, el("summary", {}, "Advanced approval rule"), counts(3, 2, "margin-text")),
  lines.margin, lines.ack,
  el("p", { class: "small muted" }, "To change the rule later, use Change devices. It makes a new "
    + "wallet, and a payment with the approvals of this rule moves the funds to it."));
const namesStep = () => step(2, ...names(null), networkPick(), solChoice());
function reviewStep() {
  const d = ui.createDraft ?? { n: 3, t: 2 };
  const row = (k, v) => [el("dt", {}, k), el("dd", {}, v)];
  const full = d.t === d.n;
  return step(3,
    el("dl", { class: "kv" }, row("Wallet name", d.name || "Treasury"),
      row("This device's label", d.label || "None. The other devices show Device 1."),
      row("Approval rule", ruleText(d.t, d.n)),
      full ? null : row("If devices are lost", marginText(d.t, d.n)),
      row("Networks", "Zcash " + curNetLabel() + (d.sol ? " and Solana Devnet" : ""))),
    full ? el("p", { class: "callout warn" }, marginText(d.t, d.n)) : null,
    el("div", { class: "callout" }, "This device joins as device 1. Then share the invite link, "
      + "so that the other devices can join. When every device has joined, they create the "
      + "wallet key together."));
}
const curNetLabel = () => (ui.net === "mainnet" ? "mainnet" : "testnet");
// Above the buttons, not in their bar: on a phone the bar stays at the bottom of the sheet.
const stepError = () => (ui.createError ? el("p", { class: "callout bad", role: "alert",
  id: "create-error" }, ui.createError) : null);
function stepActions() {
  const s = ui.createStep, last = s === STEPS.length - 1;
  const off = offOf({ db: !!db }, "why-create-submit");
  return el("div", { class: "dialog-actions" },
    el("button", { class: "btn", type: "button", onclick: closeCreate }, "Cancel"),
    s > 0 ? el("button", { class: "btn", type: "button", onclick: backClick(s) }, "Back") : null,
    el("button", { class: "btn primary", type: "submit", "data-first-focus": s === 0,
      onclick: firstClick,
      ...(last ? off.attrs : {}) }, NEXT[s]),
    last ? off.note : null);
}

const frame = (title, attrs, ...kids) => el("form", { class: "dialog", role: "dialog",
  "aria-modal": "true", "aria-labelledby": "create-title", novalidate: true, ...attrs },
el("div", { class: "card-head" }, el("h2", { id: "create-title" }, title),
  el("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: closeCreate },
    "×")),
...kids);
// A second Enter can reach the form of a step that the page did not draw again yet: a submit
// counts only for the step that its form shows.
function newDialog() {
  const lines = ruleLines(3, 2), at = ui.createStep;
  const submit = (ev) => (at === ui.createStep ? stepSubmit(ev) : ev.preventDefault());
  return frame("New shared wallet", { oninput: lines.update, onsubmit: submit },
    introStep(), ruleStep(lines), namesStep(), reviewStep(), stepError(), stepActions());
}
// Change devices keeps one form: its steps first, then the names and the rule.
function moveDialog(from) {
  const lines = ruleLines(from.n, from.t);
  const off = offOf({ db: !!db }, "why-create-submit");
  return frame("Change devices", { oninput: lines.update, onsubmit: moveSubmit(from) },
    ...moveParts(from, names(from), [counts(from.n, from.t, "margin-text"), lines.rule,
      lines.margin, lines.ack]),
    el("div", { class: "callout" }, "The new wallet gets a new address. Devices that you leave "
      + "out can still see this old wallet's payments, but not the new wallet's."),
    el("div", { class: "dialog-actions" },
      el("button", { class: "btn", type: "button", onclick: closeCreate }, "Cancel"),
      el("button", { class: "btn primary", type: "submit", ...off.attrs }, "Create new wallet"),
      off.note));
}
// With `from`, the dialog creates the wallet that replaces `from`, with new signers or a new rule.
export const createDialog = (from = null) => (from ? moveDialog(from) : newDialog());
