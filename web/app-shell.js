// Side navigation, lock screen, wallet list and create dialog.
import {
  busy, clearBadBanner, openCreate, ready, resetCreate, showBanner, state, ui,
} from "./app-state.js";
import { initials } from "./app-kit.js";
import { offReason } from "./util.js";
import { engineSettled, Z } from "./app-engine.js";
import {
  acknowledgeUnprotectedSetup, canSkipPasskeyProtection, chats, forgetVault, lockedVault,
  lockWithPasskey, mySeatSecrets, passkeyProtected, protectionUnverified, requireSetupProtection,
  setupProtectionReady, storageOk, unlockVault, vault,
} from "./app-keystore.js";
import { joinWalletLink, openChat } from "./app-links.js";
import { balOf, MAINNET_ON, netOf } from "./app-chain.js";
import { canWrite, closeSession, db, dbReady, openGroup, toApprove } from "./app-groups.js";
import {
  act, countBadge, el, guard, money, nameField, networkPick, newBadge, ruleText, unreadable, unreadChip,
} from "./app-dom.js";
import { contactName, contactOf, joinChat, joinLinks, unreadIn } from "./app-messages.js";
import { createGroup } from "./app-dkg.js";
import {
  newWallet, planSolana, solPending, solServed,
} from "./app-sol.js";
import { personal, personalError, personalPending } from "./app-account.js";
import { restore } from "./app-backups.js";
import { personalCard } from "./app-account-view.js";
import { messagingWorkspace } from "./app-messaging-workspace.js";
import { helpView } from "./app-help.js";
import {
  browserProtectionExplanation, passkeyIllustration, securityExplanation, setupArrangement, thresholdExplanation, tutorialDiagram,
  updateSetupIllustrations,
} from "./app-tutorial.js";
import { beginGuided, guidedEnabled, resumeGuided } from "./app-guided-setup.js";
import { setWalletDescription } from "./wallet-description.js";
import { focusAfter, once, render } from "./app-loop.js";
import { currentSection, moveWord, solStays, walletShown } from "./app-wallet.js";
import { icon } from "./app-icons.js";
import { createSwapPreview } from "./app-swap-preview.js";
import { generalSettings, settingsDisclosure, settingsGroup, settingsRow } from "./app-settings-ui.js";
import { walletMark } from "./app-wallet-art.js";
import { networkPrivacySettings } from "./app-network-privacy.js";
import { openHowZigsWorks } from "./app-how-zigs-works.js";

/**
 * Why a button is off (S1): `attrs` go on the button, `note` goes next to it. `more` has the
 * checks that only this button needs (db, pending, joining, newSigner), `id` names the note.
 */
export function offOf(more, id) {
  const why = offReason({ Z, settled: engineSettled, canWrite, ...more })
    || (more.newSigner && !setupProtectionReady() ? PASSKEY_REQUIRED : "");
  return {
    attrs: { disabled: !!why, "aria-describedby": why ? id : null },
    note: why ? el("span", { class: "off-why", id }, why) : null,
  };
}
const PASSKEY_REQUIRED = "Protect this browser with a passkey, or choose Skip for now and confirm "
  + "unprotected storage if it is available, before creating or joining a signing device.";

export function renderSide() {
  const nav = document.getElementById("side-nav");
  const pending = state.groups.reduce((n, g) => n + toApprove(g.id).length + solPending(g.id), 0);
  const sections = [
    ["overview", "Overview"],
    ["approvals", "Approvals", countBadge(pending, "to approve across wallets", "attn")],
    ["activity", "Activity"], ["recipients", "Address book"], ["swap", "Swap"],
    ["chats", "Messages", newBadge(state.groups.reduce((n, g) => n + unreadIn(g.id), 0)
      + Object.keys(chats.list).reduce((n, cid) => n + unreadIn(cid), 0))],
    ["recovery", "Security"],
    ["settings", "Settings"],
  ];
  const selected = ["recipients", "swap", "settings", "chats", "approvals", "recovery"].includes(ui.tab) ? ui.tab
    : state.cid || state.contact != null || ui.tab === "messages" ? "chats"
    : ui.tab === "members" ? "recovery"
    : ui.tab === "solana" ? "overview" : ui.tab;
  nav.replaceChildren(
    ...sectionNav(sections, selected),
    el("div", { class: "side-head" }, el("span", { class: "label" }, "Wallets"),
      el("button", { class: "icon-btn", type: "button", title: "New wallet", "aria-label": "New wallet", onclick: () => { ui.tab = "overview"; newWallet(); } }, "+")),
    ...testWalletEntry("sidebar"),
    ...(state.groups.length ? state.groups.map((g) => guard(sideItem, g))
      : [el("p", { class: "side-empty" }, sideEmpty())]),
    el("p", { class: "side-note", "data-key": "release-note" }, BETA_NOTE));
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
  members: "devices", recovery: "security",
  settings: "settings", solana: "sol", recipients: "addressBook", swap: "swap", chats: "chat",
};

/** The side list of the wallet sections ([id, label, count] each); a pick focuses the section. */
export function sectionNav(sections, selected) {
  const [now] = selected === undefined ? currentSection(sections) : [selected];
  const item = ([id, label, count]) => el("button", {
    class: "side-item" + (id === now ? " active" : ""), type: "button", id: "tab-" + id,
    "data-key": "tab-" + id, "aria-current": id === now ? "page" : null,
    onclick: () => {
      if (selected !== undefined && (state.cid || state.contact != null)) openGroup(null);
      const destination = id;
      ui.tab = destination; focusAfter("panel-" + (id === "chats" ? "messages" : destination), true); render();
    },
  }, icon(SECTION_ICONS[id]), el("span", { class: "side-name" }, label),
  el("span", { class: "side-tail" }, count));
  return sections.map(item);
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
  const items = document.getElementById("side-nav")
    .querySelectorAll("button:not(:disabled), a[href]");
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

function chatItem(cid) {
  const here = cid === state.cid, name = contactName(cid);
  return el("button", {
    class: "side-item" + (here ? " active" : ""), type: "button",
    "aria-current": here ? "page" : null, "data-key": "chat-" + cid, onclick: () => openChat(cid),
  }, el("span", { class: "av" }, initials(contactOf(cid) ? name : "")),
  el("span", { class: "side-name" }, name),
  el("span", { class: "side-tail" }, unreadChip(unreadIn(cid))));
}

// The release scope, on every page of the shell and on the welcome card.
const BETA_NOTE = "Beta: Zcash testnet and Solana Devnet. Not audited.";
const TEST_ONLY = "New wallets use test networks only: Zcash testnet and Solana Devnet. Zigs is "
  + "not audited.";
const sideEmpty = () => lockedVault ? "Locked." : dbReady ? "No wallets yet." : "Connecting…";

function sideItem(g) {
  const n = toApprove(g.id).length + solPending(g.id);
  const u = unreadIn(g.id), here = g.id === state.gid;
  const count = n
    ? el("span", { class: "side-count", role: "img", title: n + " to approve",
      "aria-label": n + " to approve" }, String(n))
    : null;
  const rule = el("span", { class: "side-meta", title: ruleText(g.t, g.n) },
    g.t + " of " + g.n + " devices");
  return el("button", {
    class: "side-item wallet-context" + (here ? " active" : ""), type: "button",
    // With its sections in the list, the section is the page and the wallet the current item.
    "aria-current": here ? (walletShown() ? "true" : "page") : null, "data-key": "wallet-" + g.id,
    onclick: () => {
      if (guidedEnabled(g.id)) {
        try { resumeGuided(g.id); } catch (e) { showBanner("bad", e.message); }
      }
      ui.tab = "overview";
      // The open wallet keeps its chain: openGroup would start a second one beside its sync.
      if (g.id === state.gid) { closeSession(); render(); return; }
      openGroup(g.id);
    },
  }, walletMark(g, 32),
  el("span", { class: "side-label" }, el("span", { class: "side-name" }, g.name),
    el("span", { class: "side-network" }, "Zcash " + netOf(g).label), rule,
    g.movedTo ? el("span", { class: "side-meta" }, moveWord(g)) : null),
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
      + "back, and without one its money is lost. Saved payment recipients are deleted too; "
      + "they are not included in recovery files."),
    el("div", { class: "dialog-actions" },
      el("button", { class: "btn", type: "button", onclick: cancel }, "Cancel"),
      el("button", { class: "btn danger", type: "button", onclick: forgetVault },
        "Delete the locked keys")));
}

export function lockView() {
  const ask = () => { ui.forget = true; render(); };
  const text = lockedVault.damaged
    ? "The locked keys in this browser are damaged and cannot be opened."
    : "The key shares in this browser are encrypted with your passkey. "
      + "Unlock with Face ID, Touch ID or your security key.";
  return el("div", { class: "card empty lock-card" }, icon("lock"),
    el("h1", {}, "Zigs is locked"), el("p", { class: "small" }, text),
    lockedVault.damaged ? null : securityExplanation("passkey"),
    lockedVault.damaged ? null
      : el("button", {
        class: "btn primary", type: "button", disabled: !engineSettled, onclick: act(unlockVault),
      }, icon("key"), "Unlock"),
    ui.forget ? forgetBox()
      : el("button", { class: "btn ghost sm", type: "button", onclick: ask }, "Lost the passkey?"));
}

function lockButton() {
  if (protectionPending || vault && !passkeyProtected()) {
    return el("button", { class: "btn", type: "button", disabled: true },
      protectionPending ? "Protecting this device…" : "Protection incomplete · save recovery files");
  }
  if (passkeyProtected()) {
    return el("button", { class: "btn", type: "button", onclick: () => location.reload(),
      title: "Encrypted with your passkey. Reload to lock the page." }, "Lock now");
  }
  const can = protectionAvailable();
  return el("button", { class: "btn", type: "button", disabled: !can, onclick: protectThisDevice,
    title: can ? "Encrypt the key shares, personal account and saved recipients in this browser with a passkey"
      : "This browser cannot enable passkey protection" }, "Lock with a passkey");
}

let protectionPending = false, protectionError = "", skipProtectionAsk = null;
const protectionAvailable = () => storageOk && !!window.PublicKeyCredential
  && !!navigator.credentials;
const protectionAttrs = (context, value) => ({ class: "device-protection",
  "data-motion-watch": "passkey:" + context, "data-motion-value": value });
const protectionMark = () => el("span", { class: "protection-status-mark",
  "data-motion-mark": "", "aria-hidden": "true" }, icon("lock"));
export async function protectThisDevice() {
  if (protectionPending) return false;
  if (passkeyProtected()) return true;
  if (vault) return false;
  skipProtectionAsk = null;
  protectionPending = true; protectionError = ""; render();
  try {
    await lockWithPasskey();
    return passkeyProtected();
  }
  catch (e) {
    protectionError = e.name === "NotAllowedError"
      ? "Passkey setup was cancelled or timed out. This browser is not passkey-protected. Try again, or choose Skip for now to review unprotected storage."
      : e.name === "SecurityError"
        ? "This site address cannot create a passkey. Open Zigs directly at its secure site address, or use localhost for a local preview. Wallet data stays at the browser address where it was saved."
      : "Passkey protection was not enabled: " + (e.message || "this browser or authenticator could not complete it.")
        + " Passkey protection has not been confirmed. Try again or save and exit. Keep any existing wallet tabs open.";
    showBanner("bad", protectionError);
    return false;
  } finally { protectionPending = false; render(); }
}
function cancelSkipProtection(context) {
  skipProtectionAsk = null;
  focusAfter("skip-device-" + context, true); render();
}
function skipProtectionConfirmation(context, onReady, allowed) {
  const title = "skip-protection-title-" + context, description = "skip-protection-warning-" + context;
  const accept = (ev) => {
    try {
      acknowledgeUnprotectedSetup();
      skipProtectionAsk = null;
      clearBadBanner(protectionError); protectionError = "";
      if (context === "create-first" && ui.create && ui.createStep === 0) nextStep(ev);
      else { onReady?.(); render(); }
    } catch (e) { protectionError = e.message; render(); }
  };
  return el("div", { class: "device-protection skip-protection-confirmation", role: "group",
    "data-skip-protection": context, "aria-labelledby": title, "aria-describedby": description,
    onkeydown: (ev) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault(); ev.stopPropagation(); cancelSkipProtection(context);
    } },
  el("div", { class: "skip-protection-heading" }, icon("unshield"),
    el("h4", { id: title }, "Are you sure?")),
  el("p", { id: description }, "Without a passkey, new signing shares and other local wallet data "
    + "are saved in this browser without Zigs’ passkey encryption. Someone with access to this "
    + "browser profile or its saved site data may be able to use this device’s share without "
    + "unlocking Zigs."),
  el("p", { class: "small muted" }, "Your wallet’s approval rule still applies. Protecting this "
    + "browser is recommended; you can enable it later in Settings."),
  !allowed ? el("p", { class: "callout bad", role: "alert" },
    "The saved protection or storage state changed. Go back and check it before continuing.") : null,
  protectionError ? el("p", { class: "callout bad", role: "alert" }, protectionError) : null,
  el("div", { class: "row-actions" },
    el("button", { class: "btn primary", type: "button", "data-key": "skip-back-" + context,
      onclick: () => cancelSkipProtection(context) }, "Go back"),
    el("button", { class: "btn", type: "button", disabled: !allowed,
      "data-key": "skip-confirm-" + context, "aria-describedby": description,
      onclick: accept }, "Continue without protection")));
}
const PROTECTION_UNFINISHED = "Protection did not finish. Keep this tab open and save this "
  + "device’s recovery files. Do not repeat locking over an incomplete saved copy; check the "
  + "browser’s storage permissions before reopening Zigs.";
/** Only the verified vault reports protection. Explicit Skip grants setup entry, not encryption. */
export function deviceProtection(context = "setup", onReady = null) {
  if (protectionPending) return el("div", protectionAttrs(context, "pending"),
    el("p", { class: "small", role: "status" }, protectionMark(), "Protecting this device… Wait while the encrypted copy is checked."));
  if (vault && !passkeyProtected()) return el("div", protectionAttrs(context, "error"),
    el("p", { class: "callout bad", role: "alert" }, protectionMark(), protectionError || "Passkey protection has not finished."),
    el("p", { class: "small muted" }, PROTECTION_UNFINISHED + (protectionUnverified()
      ? " You can go on: new key shares are saved in the passkey-protected copy."
      : " Do not set up another wallet until you have reviewed the unprotected copy.")));
  if (passkeyProtected()) return el("div", protectionAttrs(context, "verified"),
    el("p", { class: "small ok", role: "status" }, protectionMark(), "This browser’s shares are protected by its passkey."),
    el("p", { class: "small muted" }, "Unlocking this browser is separate from authorizing a payment with another device."));
  const supported = protectionAvailable(), skippable = canSkipPasskeyProtection();
  if (skipProtectionAsk === context) return skipProtectionConfirmation(context, onReady, skippable);
  const skipped = setupProtectionReady();
  return el("div", protectionAttrs(context, skipped ? "unprotected" : protectionError ? "error" : "idle"),
    skipped ? el("p", { class: "small warn", role: "status" }, icon("unshield"),
      "Passkey protection skipped in this tab.") : null,
    skipped ? el("p", { class: "small muted" }, "New signing shares are saved without passkey encryption. You can protect this browser later in Settings.") : null,
    el("div", { class: "row-actions" },
      el("button", { class: "btn primary", type: "button", disabled: !supported,
        "data-key": "protect-device-" + context,
        "data-first-focus": context === "create-first" && supported,
        onclick: async () => { if (await protectThisDevice()) onReady?.(); } },
      protectionMark(), "Protect this browser"),
      !skipped && skippable ? el("button", { class: "btn ghost", type: "button",
        "data-key": "skip-device-" + context,
        onclick: () => {
          skipProtectionAsk = context;
          clearBadBanner(protectionError); protectionError = "";
          focusAfter("skip-back-" + context, true); render();
        } }, "Skip for now") : null),
    !skipped ? el("p", { class: "small muted" }, supported
      ? "Recommended: encrypt this browser’s signing shares with a passkey. A passkey is not an additional signing device."
      : !storageOk ? "Storage is unavailable. Keep this tab open, enable persistent browser storage, and retry before relying on it as a signing device."
        : "This browser cannot enable passkey protection. Use a supported browser or authenticator."
          + (skippable ? " Or choose Skip for now to review unprotected storage." : " You can save and exit, or restore an existing device from its recovery file.")) : null,
    protectionError ? el("p", { class: "callout bad", role: "alert" }, protectionError) : null);
}

export function loadingView() {
  return el("div", { class: "card empty launch-card" }, icon("security"),
    el("span", { class: "dot busy" }),
    el("h1", {}, Z ? "Connecting to the group server" : "Loading the crypto engine"),
    el("p", { class: "small" }, "Your wallets appear in a moment."));
}

// This separate local-only sample never opens or creates a wallet in this browser's store.
function testWalletEntry(place) {
  let page;
  try { page = new URL(location.href); } catch { return []; }
  const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(page.hostname);
  if (!local || page.port !== "8792") return [];
  return [el("a", {
    class: "btn ghost" + (place === "welcome" ? " lg" : ""),
    href: "http://localhost:8793/", target: "_blank", rel: "noopener",
    "data-key": "test-wallet-" + place,
    style: "justify-self:start;text-align:start;white-space:normal",
  }, el("span", { style: "display:grid;gap:3px" }, el("span", {}, "Test wallet"),
    el("span", { class: "small muted" }, "Read-only sample · 2 of 3 · opens in a new tab")))];
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
  }, "Recover access");
  const listed = state.groups.length > 0;
  const joins = joinLinks.size ? [el("div", { class: "callout", role: "status" },
    el("span", {}, "A chat invitation is waiting in Chats."),
    el("button", { class: "btn sm", type: "button", disabled: !state.gid,
      title: "Select a wallet to open its Chats", onclick: () => { ui.tab = "chats"; render(); } }, "Open Chats"))] : [];
  return el("div", { class: "page lobby-page lobby-home" + (listed ? "" : " lobby-empty"),
    "data-key": "home-page", tabindex: "-1" }, ...joins,
    savedPlan ? el("section", { class: "callout", role: "status" },
      el("span", {}, "Setup unfinished · your plan is kept in this open tab."),
      el("button", { class: "btn", type: "button", onclick: resumePlan }, "Resume setup")) : null,
    welcome(offOf({ db: !!db }, "why-create"), restoreBtn("btn ghost")), restoreInput);
}

// A contact link waits here until the person clicks Join. The link is kept after a failure.
export function chatJoinCard(cid) {
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

// All existing transports share a presentation shell; their handlers stay independent.
export function chatsWorkspace() {
  return messagingWorkspace();
}

const WORKSPACE_EXPLANATIONS = { Chats: "chats", Activity: "activity", Approvals: "approvals",
  "Security": "recovery", Settings: "settings" };
const workspaceHeading = (title, eyebrow, text) => el("header", { class: "page-head workspace-heading" },
  el("div", { class: "ph-left" }, el("span", { class: "label" }, eyebrow),
    el("h1", {}, title), el("p", { class: "muted" }, text)),
  WORKSPACE_EXPLANATIONS[title] ? securityExplanation(WORKSPACE_EXPLANATIONS[title]) : null);

export function activityWorkspace() {
  return el("div", { class: "page", id: "panel-activity", "data-key": "panel-activity", tabindex: "-1" },
    workspaceHeading("Activity", "Wallet history", "Choose a wallet to view its transaction history."),
    state.groups.length ? el("section", { class: "card" }, el("div", { class: "list" },
      state.groups.map((g) => guard(walletRow, g, "activity"))))
      : el("section", { class: "card card-pad empty" }, el("h2", {}, "No wallets yet"),
        el("p", { class: "small muted" }, "Set up or join a wallet from Overview to see its activity.")));
}

export function approvalsWorkspace() {
  return el("div", { class: "page", id: "panel-approvals", "data-key": "panel-approvals", tabindex: "-1" },
    workspaceHeading("Approvals", "Payment requests", "Choose a wallet to review its payments. Counts show requests needing this browser’s approval; chat messages have a separate count."),
    state.groups.length ? el("section", { class: "card" }, el("div", { class: "list" },
      state.groups.map((g) => guard(walletRow, g, "approvals"))))
      : el("section", { class: "card card-pad empty" }, el("h2", {}, "No wallets yet"),
        el("p", { class: "small muted" }, "Set up or join a wallet from Overview. Its payment requests will appear in Approvals.")));
}

export function recoveryWorkspace() {
  return el("div", { class: "page", id: "panel-recovery", "data-key": "panel-recovery", tabindex: "-1" },
    workspaceHeading("Security", "Devices and local access", "Choose a wallet to review its devices and optional recovery files. A passkey unlocks browser data; recovery files restore a device’s share."),
    state.groups.length ? el("section", { class: "card" }, el("div", { class: "list" },
      state.groups.map((g) => guard(walletRow, g, "recovery"))))
      : el("section", { class: "card card-pad" }, el("h2", {}, "No wallet selected"),
        el("p", { class: "small muted" }, "Set up or join a wallet from Overview. You can restore an existing device from its recovery file in Settings.")),
    el("section", { class: "card card-pad" }, el("h2", {}, "Access in this browser"),
      el("p", { class: "small muted" }, "Manage the browser passkey lock or restore a saved file using the existing access controls."),
      el("button", { class: "btn", type: "button", onclick: () => {
        ui.tab = "settings"; focusAfter("panel-settings", true); render();
      } }, "Manage browser access in Settings")));
}

let swapPreview;
export function swapWorkspace() {
  const context = { id: state.g?.id, name: state.g?.name,
    networks: 'Zcash ' + (state.g ? netOf(state.g).label : 'Testnet') + ' · Solana Devnet',
    threshold: state.g ? state.g.t + " of " + state.g.n + " device approvals per payment." : "" };
  swapPreview ??= createSwapPreview(context);
  swapPreview.setContext(context);
  return swapPreview.element;
}

// The existing account, passkey and restore controls stay outside conversation screens.
export function browserSettings() {
  const restoreInput = el("input", {
    id: "restore-account-settings", type: "file", accept: ".zigsbackup,.json,application/json", hidden: true,
    onchange: (ev) => { const file = ev.target.files[0]; ev.target.value = ""; if (file) restore(file); },
  });
  const security = el("button", { class: "preference-row preference-link", type: "button",
    onclick: () => { ui.tab = "recovery"; focusAfter("panel-recovery", true); render(); } },
  el("span", { class: "preference-label" }, el("span", { class: "preference-title" }, "Security"),
    el("span", { class: "preference-description" }, "Manage devices, approvals and wallet backups.")),
  el("span", { class: "preference-chevron", "aria-hidden": "true" }, "›"));
  const accountNote = personalPending ? "Loading the saved messaging account…" : personalError
    ? "Account needs attention. Review its saved data and recovery options." : personal
      ? (personal.backedUp ? "Account set up · separate funds and backup for message fees."
        : "Save an account backup · separate from your shared wallets.")
      : "Optional · separate funds, access and backup for message fees.";
  return [settingsGroup("Security & Device", security,
    settingsRow(passkeyProtected() ? "Lock this browser" : "Browser protection",
      passkeyProtected() ? "Use your passkey to unlock again."
        : "Protect wallet data saved in this browser with a passkey.", lockButton()),
    settingsRow("Recover access", "Restore a device’s share or a separate messaging-account backup. Each file restores only its own contents.",
      el("button", { class: "btn sm", type: "button", onclick: () => restoreInput.click() }, "Choose file")),
    restoreInput),
  settingsGroup("Messaging account", settingsDisclosure("On-chain messaging account",
    accountNote,
    guard(personalCard, () => restoreInput.click())))];
}

export function settingsWorkspace() {
  return el("div", { class: "page preferences-page", id: "panel-settings", "data-key": "panel-settings", tabindex: "-1" },
    el("header", { class: "preferences-heading" }, el("h1", {}, "Settings"),
      el("p", { class: "muted" }, "Manage your wallet and preferences.")),
    generalSettings(),
    networkPrivacySettings(),
    settingsGroup("Current wallet", settingsRow(state.g ? "Wallet details unavailable" : "No wallet selected",
      state.g ? "Return to this wallet to review its setup or access status."
        : "Open a wallet to see its description, address and approval requirements.",
      el("button", { class: "btn sm", type: "button", onclick: () => { ui.tab = "overview"; render(); } },
        state.g ? "Return to wallet" : "Choose wallet"))),
    browserSettings(), helpView());
}

function walletRow(g, tab = "overview") {
  if (g.unreadable) return unreadable();
  const seats = mySeatSecrets(g.id).length, bal = balOf(g.id);
  const n = solPending(g.id) + toApprove(g.id).length;
  const unread = newBadge(unreadIn(g.id));
  const status = g.movedTo ? el("span", { class: "badge plain" }, moveWord(g))
    : guidedEnabled(g.id) || ready[g.id] === false ? el("span", { class: "badge info" }, "Setup unfinished")
    : bal ? money(bal.total) : el("span", { class: "small faint" }, "Open to sync");
  return el("button", {
    class: "row-item" + (tab === "overview" ? " wallet-vault-card" : ""),
    type: "button", "data-key": "wallet-row-" + g.id,
    "aria-current": g.id === state.gid ? "true" : null,
    onclick: () => {
      if (guidedEnabled(g.id)) {
        try { resumeGuided(g.id); } catch (e) { showBanner("bad", e.message); }
      }
      openGroup(g.id); ui.tab = tab; render();
    },
  },
  tab === "overview" ? el("span", { class: "vault-card-top", "aria-hidden": "true" }, walletMark(g, 64))
    : walletMark(g),
  el("span", { class: "ri-main" }, el("span", { class: "ri-title" }, g.name),
    el("span", { class: "ri-sub" },
      el("span", { class: "vault-network" }, "Zcash " + netOf(g).label),
      el("span", { class: tab === "overview" ? "sr-only" : "" }, " · "),
      el("span", { class: "vault-rule" }, "Any " + g.t + " of " + g.n + " devices"),
      seats || tab === "overview" ? null : el("span", { class: "vault-view-only" }, " · view only"))),
  el("span", { class: "ri-end" }, status,
    !seats && tab === "overview" ? el("span", { class: "small faint vault-view-only" }, "· view only") : null,
    tab === "overview" && g.id === state.gid ? el("span", { class: "badge plain" }, "Selected") : null,
    n ? el("span", { class: "badge warn" }, n + " to approve") : null, unread),
  tab === "overview" ? el("span", { class: "vault-card-entry" },
    el("span", { class: "vault-entry-label" }, guidedEnabled(g.id) ? "Continue setup" : "Open wallet"),
    el("span", { "aria-hidden": "true" }, "↗")) : null,
  el("span", { class: "chev" }, "›"));
}

// This is an explicitly labelled policy example, never collected transaction authorizations.
function homeThreshold() {
  return el("figure", { class: "home-threshold" },
    el("p", { class: "home-threshold-title" }, "How shared control works"),
    el("div", { class: "home-threshold-nodes", "aria-hidden": "true" },
      [1, 2, 3].map((number) => el("span", {
        class: "home-threshold-node" + (number < 3 ? " home-threshold-example" : ""),
      }, String(number)))),
    el("figcaption", {}, "Illustration · Any 2 of 3 approvals"));
}

function homeExplanation() {
  return el("button", { class: "welcome-details home-how-trigger", id: "home-how",
    "data-key": "home-how", type: "button", "aria-haspopup": "dialog",
    onclick: openHowZigsWorks },
    icon("security"),
    el("span", { class: "welcome-security-copy" },
      el("strong", {}, "How Zigs works"),
      el("span", { class: "small muted" }, "Keys, payments, messaging and privacy. The complete guide.")),
    el("span", { class: "home-how-arrow", "aria-hidden": "true" }, "↗"));
}

function welcome(off, restoreLink) {
  const wallets = state.groups.length, explanation = homeExplanation();
  const learn = el("button", { class: "btn ghost home-learn", type: "button",
    "aria-haspopup": "dialog", onclick: openHowZigsWorks }, "How Zigs works");
  const create = el("button", {
    class: "btn" + (wallets ? "" : " primary") + " lg", type: "button", ...off.attrs,
    onclick: () => { openCreate(); render(); },
  }, wallets ? "Create another" : "Create wallet",
  el("span", { class: "home-action-arrow", "aria-hidden": "true" }));
  const join = el("button", {
    class: "btn lg", type: "button", "aria-expanded": ui.joinOpen ? "true" : "false",
    onclick: toggleJoin,
  }, "Join a wallet", el("span", { class: "home-action-arrow home-arrow-forward", "aria-hidden": "true" }));
  const walletList = wallets ? el("section", { class: "welcome-collection", id: "welcome-wallets",
    "aria-label": "Saved wallets" },
    el("div", { class: "welcome-collection-heading" }, el("h2", {}, "Your wallets"),
      el("span", { class: "small muted" }, (wallets === 1 ? "1 wallet" : wallets + " wallets")
        + " in this browser")),
    el("div", { class: "list welcome-wallet-list" },
      state.groups.map((g) => guard(walletRow, g)))) : null;
  const actions = el("div", { class: "welcome-actions" }, create, join, off.note);
  const entryPaths = el("div", { class: "welcome-entry-paths" }, actions,
    el("div", { class: "welcome-entry-meta" },
      el("div", { class: "welcome-secondary-actions" }, restoreLink, learn),
      ...testWalletEntry("welcome")),
    ui.joinOpen ? joinWallet() : null);
  return el("section", { class: "card card-pad welcome" + (wallets
    ? " welcome-returning" + (wallets === 1 ? " welcome-single" : " welcome-many") : " welcome-new"),
    "aria-labelledby": "welcome-title" },
    el("header", { class: "home-masthead" },
      el("span", { class: "label" }, "ZIGS · PRIVATE BY DESIGN"),
      el("span", { class: "home-environment" }, "Beta · Not audited · Test networks")),
    el("div", { class: "welcome-main home-hero", "data-home-hero": "" },
      el("div", { class: "welcome-brand", "aria-hidden": "true" },
        el("img", { class: "home-hero-art", src: "/logo.png?v=e2a70c42", alt: "",
          width: "1254", height: "1254", decoding: "async", draggable: "false" })),
      el("div", { class: "welcome-intro" },
        el("p", { class: "label welcome-kicker" }, "SHIELDED SELF-CUSTODY / ZIGS"),
        el("h1", { id: "welcome-title" }, wallets ? "Welcome " : "Private by design. ",
          el("span", { class: "welcome-title-accent" }, wallets ? "back." : "Secured together.")),
        el("p", { class: "muted welcome-summary" }, wallets
          ? "Your assets. Your approval rules. One private place to return to."
          : "Hold your assets privately. Protect them with the people and devices you trust."),
        wallets ? null : entryPaths,
        !wallets ? el("p", { class: "home-signature" },
          el("span", { "aria-hidden": "true" }), "Distributed ownership. ",
          el("span", {}, "Designed for peace of mind.")) : null),
      homeThreshold()),
    wallets ? el("div", { class: "home-wallet-launcher" + (wallets === 1 ? " home-launcher-single" : "") },
      walletList,
      wallets === 1 ? el("aside", { class: "home-wallet-note" },
        el("p", { class: "label" }, "BUILT FOR SHARED CONTROL"),
        el("h3", {}, "Separate shares. ", el("span", {}, "Shared confidence.")),
        el("p", {}, "Each device holds a separate key share. Payments need the approvals set by your wallet’s rule.")) : null) : null,
    wallets ? entryPaths : null,
    explanation,
    el("p", { class: "small faint home-release-note" }, TEST_ONLY));
}

// The form that opens a wallet from a pasted invite link. The field has no name and the handler
// stops the submit first: the secret of the link never reaches a query string. The field has an
// id, so a redraw keeps its text (saveFormState).
function joinWallet(heading = "h3") {
  const bad = ui.joinBad, off = offOf({ db: !!db }, "why-join-wallet");
  const input = el("input", {
    class: "input", id: "join-link", "data-key": "join-link", type: "text", inputmode: "url",
    autocomplete: "off", autocapitalize: "off", spellcheck: "false",
    "aria-invalid": bad ? "true" : null,
    "aria-describedby": "join-help" + (bad ? " join-error" : ""),
    oninput: joinTyped,
  });
  const submit = (ev) => {
    ev.preventDefault();
    const error = joinWalletLink(input.value);
    ui.joinBad = error ?? "";
    if (!error) { input.value = ""; return; }
    focusAfter("join-link", true);
    render();
  };
  return el("section", { class: "join" }, el(heading, {}, "Join a shared wallet"),
    el("p", { class: "small muted", id: "join-help" },
      "Did someone send you an invite link? Paste it here to open the wallet."),
    el("form", { class: "join-row", onsubmit: submit },
      el("label", { class: "field" }, el("span", {}, "Invite link"), input),
      el("button", { class: "btn", type: "submit", ...off.attrs }, "Open wallet"),
      bad ? el("p", { class: "small bad", id: "join-error", role: "alert" }, bad) : null,
      off.note));
}

// The choice to join shows the form, and a second press hides it with its error.
function toggleJoin() {
  ui.joinOpen = !ui.joinOpen;
  ui.joinBad = "";
  if (ui.joinOpen) focusAfter("join-link", true);
  render();
}

// A person who types ends the error. A redraw puts the text back with an input event that nobody
// typed: that one does not.
function joinTyped(ev) {
  if (!ev.isTrusted || !ui.joinBad) return;
  ui.joinBad = "";
  ev.target.removeAttribute("aria-invalid");
  ev.target.setAttribute("aria-describedby", "join-help");
  document.getElementById("join-error")?.remove();
}


// A new testnet wallet can get its Solana Devnet part in the same setup, on a server that serves
// Solana. Keep the existing setup choice in the form even when the review omits network details;
// only the current final-review checkbox reaches planSolana.
const solChosen = (from, network, sol) => !from && network === "testnet" && sol === true;
const reviewSolIncluded = (draft = ui.createDraft) => ui.net === "testnet"
  && (typeof ui.sol === "boolean" ? ui.sol : draft?.sol !== false);
function solChoice() {
  if (ui.net !== "testnet") return null;
  return el("label", { class: "ack" },
    el("input", { type: "checkbox", id: "g-sol", name: "sol", checked: reviewSolIncluded(),
      onchange: (ev) => {
        ui.sol = ev.target.checked;
        if (ui.createDraft) {
          ui.createDraft.sol = ev.target.checked;
          ui.createDraft.solExpected = ev.target.checked;
        }
        render();
      } }),
    el("span", {}, el("b", {}, "Set up Solana Devnet with this wallet. "),
      el("span", { class: "small muted" }, "Included after the Zcash address checks, when service is available. Clear this option for a Zcash-only wallet.")));
}

function planningNetworks() {
  if (ui.net !== "testnet") return null;
  const served = solServed();
  return el("p", { class: "small muted" }, served
    ? "One guided setup prepares Zcash first and then Solana Devnet with these same devices. Review the network and service disclosures before creating the wallet."
    : ui.solServed === null ? "Checking Solana service availability. The review will show which networks can start now."
      : "Zcash can start now. Solana setup is waiting for service availability; the same guide keeps your Zcash progress saved and resumes the existing setup when service returns.");
}

// The parts of the dialog. The ids are the ones that the tests and the harness fill.
const names = (from) => [nameField("my-name", "", from ? undefined : ui.createDraft?.label),
  el("label", { class: "field" }, el("span", {}, from ? "New wallet name" : "Wallet name"),
    el("input", { class: "input", id: "g-name", name: "name", maxlength: "40",
      placeholder: from ? from.name : "Team treasury", value: from ? "" : ui.createDraft?.name ?? "",
      autocomplete: "off" }))];
// `note`: the id of the line that says what the numbers mean, for a screen reader.
const number = (label, id, name, value, note) => el("label", { class: "field" },
  el("span", {}, label), el("input", { class: "input", id, name, type: "number", min: "2",
    max: "7", value: String(value), "aria-describedby": note ?? null }));
const counts = (n0, t0, note) => el("div", { class: "two" },
  number("Devices", "g-n", "n", n0, note), number("Approvals needed", "g-t", "t", t0, note));
// Presentation controls for the same numeric fields; the form keeps its existing validation.
function ruleCounter(label, id, name, value, help) {
  const input = el("input", { class: "input", id, name, type: "number", min: "2", max: "7",
    value: String(value), "aria-describedby": id + "-help margin-text" });
  const adjust = (amount) => () => {
    input.stepUp(amount);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const less = el("button", { class: "btn rule-adjust", type: "button",
    id: id + "-less",
    "aria-label": "Fewer " + label.toLowerCase(), "aria-controls": id,
    disabled: value <= 2, onclick: adjust(-1) }, el("span", { "aria-hidden": "true" }, "−"));
  const more = el("button", { class: "btn rule-adjust", type: "button",
    id: id + "-more",
    "aria-label": "More " + label.toLowerCase(), "aria-controls": id,
    disabled: value >= (name === "t" ? ui.createDraft?.n ?? 3 : 7),
    onclick: adjust(1) }, el("span", { "aria-hidden": "true" }, "+"));
  return el("div", { class: "rule-counter" }, el("label", { for: id }, label),
    el("div", { class: "rule-counter-control" }, less, input, more),
    el("p", { class: "small muted", id: id + "-help" }, help));
}
const moveParts = (from, nameParts, ruleParts) => [el("ol", { class: "small muted move-steps" },
  el("li", {}, "You create a new wallet with the devices and rule you want."),
  el("li", {}, "The new devices join it with an invite link."),
  el("li", {}, moveFundsText(from))),
...nameParts, ...ruleParts];
// The funds that move: Change devices moves the Zcash funds only, so a wallet with a Solana part
// is told to check that part on its own.
const moveFundsText = (from) => "This wallet sends all its Zcash funds to the new one. Like any "
  + "payment, this needs " + from.t + " approvals." + solStays();
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
function ruleLines(n0, t0, preview = () => {}) {
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
    for (const [id, value] of [["g-n", n], ["g-t", t]]) {
      const less = document.getElementById(id + "-less"), more = document.getElementById(id + "-more");
      if (less) less.disabled = value <= 2;
      if (more) more.disabled = value >= (id === "g-t" ? n : 7);
    }
    preview(n, t, ok);
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

export function endCreate() {
  skipProtectionAsk = null; ui.create = false; ui.move = false; resetCreate();
}
const closeCreate = () => { endCreate(); render(); };

// A replacement wallet stays on its predecessor's network: funds cannot move between networks.
async function submitWallet({ name, n, t, sol, solExpected = false, description = "" }, from) {
  requireSetupProtection();
  checkRule(n, t);
  const network = from ? from.network || "testnet" : ui.net;
  if (network === "mainnet" && !ui.ack) throw new Error("Confirm that you understand Zigs is "
    + "not audited before you create a mainnet wallet.");
  const withSol = solChosen(from, network, sol);
  endCreate(); ui.net = "testnet"; ui.ack = false;
  const gid = await createGroup(name, n, t, from && from.id, network);
  if (!from && description) {
    try { setWalletDescription(gid, description); } catch (e) { showBanner("bad", e.message); }
  }
  if (!from) {
    savedPlan = null;
    try { beginGuided(gid, { solExpected: network === "testnet" && solExpected }); }
    catch (e) { showBanner("bad", e.message); }
  }
  if (withSol) await planSolana(gid);
}
const MOVED_ALREADY = "This wallet moved already. Open the wallet that it moved to.";
// The first submit closes the dialog before it waits: a second submit of the same form is stale
// and does nothing, not even through act. A wallet that moved already moves no more.
function moveSubmit(from) {
  const send = act(async (ev) => {
    requireSetupProtection();
    if (state.g?.movedTo) throw new Error(MOVED_ALREADY);
    const fd = new FormData(ev.target), n = Number(fd.get("n")), t = Number(fd.get("t"));
    if (t === n && !ui.marginAck) throw new Error(ACK_FIRST);
    await submitWallet({ name: String(fd.get("name") || "").trim() || from.name, n, t,
      sol: fd.get("sol") === "on" }, from);
  });
  return (ev) => (ui.move ? send(ev) : ev.preventDefault());
}

// The steps of a new wallet: what it is, its rule, its names, the review. Enter submits the form
// at every step. Each Next keeps the values of its step in `ui.createDraft`; the review shows
// them, and the last submit creates the wallet from them.
const STEPS = ["Protect this browser", "Set the approval threshold", "Set up this device",
  "Review your wallet"];
const NEXT = ["Continue to approval rule", "Use this arrangement", "Continue", "Create wallet"];
// An uncreated plan has no custody state to save. Keep this optional draft in the open tab;
// names and Solana consent are never copied into a new plaintext persistence record.
let savedPlan = null;
function savePlanAndExit() {
  if (ui.createStep === 1) { try { takeRule(); } catch { /* invalid fields remain educational */ } }
  if (ui.createStep === 2) takeNames();
  savedPlan = { draft: ui.createDraft ? structuredClone(ui.createDraft) : null,
    step: ui.createStep, marginAck: ui.marginAck, net: ui.net, ack: ui.ack };
  endCreate(); render();
}
function resumePlan() {
  if (!savedPlan) return;
  openCreate();
  ui.createDraft = savedPlan.draft; ui.createStep = savedPlan.step;
  ui.marginAck = savedPlan.marginAck; ui.net = savedPlan.net; ui.ack = savedPlan.ack;
  ui.sol = savedPlan.draft?.sol;
  focusAfter("create-step-" + ui.createStep, true); render();
}
function takeRule() {
  const n = Number(fieldValue("g-n")), t = Number(fieldValue("g-t"));
  checkRule(n, t);
  if (t === n && !ui.marginAck) throw new Error(ACK_FIRST);
  ui.createDraft = { ...ui.createDraft, n, t };
}
function takeNames() {
  // The explicit consent control is on the final review. Naming keeps the current opt-out
  // or the default included intent; an absent review control cannot silently opt out here.
  const sol = ui.net === "testnet" && ui.sol !== false;
  const field = document.getElementById("g-description");
  const description = typeof field?.value === "string" ? field.value.trim() : "";
  ui.createDraft = { ...ui.createDraft, name: fieldValue("g-name").trim(),
    label: fieldValue("my-name").trim(), description, sol, solExpected: sol };
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
  try {
    requireSetupProtection();
    TAKE[ui.createStep]();
  } catch (e) { ui.createError = e.message; render(); return; }
  goStep(ui.createStep + 1);
}
// The seat takes its label from what this browser keeps: the label that the review showed, also
// when another tab typed another one since.
async function createFromDraft() {
  requireSetupProtection();
  const d = ui.createDraft;
  if (d.t === d.n && !ui.marginAck) throw new Error(ACK_FIRST);
  const box = document.getElementById("g-sol");
  const sol = !!box && box.checked;
  const solExpected = ui.net === "testnet" && (box ? box.checked : ui.sol !== false);
  try { localStorage.setItem("zf-name", d.label ?? ""); } catch { /* no storage: as typed */ }
  await submitWallet({ ...d, name: d.name || "Treasury", sol, solExpected }, null);
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
el("h3", { id: "create-step-" + i, tabindex: "-1", "data-key": "create-step-" + i,
  "data-first-focus": i === 0 && ui.createStep === 0 && !passkeyProtected() }, STEPS[i]),
i < 3 ? null
  : securityExplanation(["passkey", "threshold", "device", "review"][i]),
...kids);
const introStep = () => step(0,
  el("div", { class: "setup-protection-layout" },
    skipProtectionAsk === "create-first" ? null : el("div", { class: "setup-protection-intro" },
      passkeyIllustration(protectionPending ? "pending" : passkeyProtected() ? "verified" : "unprotected"),
      el("p", {}, "A passkey protects the signing share saved in this browser.")),
    deviceProtection("create-first", () => {
      ui.createError = null; focusAfter("create-continue", true); render();
    })),
  skipProtectionAsk === "create-first" ? null : el("details", { class: "setup-protection-details" },
    el("summary", {}, "How browser protection works"),
    browserProtectionExplanation()));
const ruleStep = (lines) => step(1,
  el("div", { class: "threshold-layout" },
    setupArrangement(ui.createDraft?.n ?? 3, ui.createDraft?.t ?? 2, "rule", ui.createDraft ?? {}),
    el("div", { class: "threshold-controls" },
      el("div", { class: "threshold-counter-pair" }, ruleCounter("Devices", "g-n", "n", ui.createDraft?.n ?? 3,
        "Independent devices that share control."),
      ruleCounter("Approvals needed", "g-t", "t", ui.createDraft?.t ?? 2,
        "Devices required to approve each payment.")),
      el("div", { class: "threshold-result" }, lines.rule, lines.margin, lines.ack))),
  el("details", { class: "setup-threshold-details" }, el("summary", {}, "How the approval threshold works"),
    thresholdExplanation(ui.createDraft?.n ?? 3, ui.createDraft?.t ?? 2)));
const namesStep = () => step(2,
  el("div", { class: "setup-device-layout" },
    el("div", { class: "setup-device-visual" },
      setupArrangement(ui.createDraft?.n ?? 3, ui.createDraft?.t ?? 2, "names", ui.createDraft ?? {}),
      el("p", { class: "small muted" }, "This device creates and keeps its own signing share. Give it a label you’ll recognize; a label is not proof of identity or physical independence.")),
    el("div", { class: "setup-device-fields" },
  ...names(null),
  el("label", { class: "field" }, el("span", {}, "Description (optional, private to this browser)"),
    el("textarea", { class: "input", id: "g-description", name: "description", rows: "2", maxlength: "280",
      autocomplete: "off", "aria-describedby": "g-description-help" }, ui.createDraft?.description || ""),
    el("span", { class: "small muted", id: "g-description-help" }, "Stored only in this browser, outside the passkey vault and recovery files. Do not put secrets here.")),
  el("div", { class: "setup-network-choice" }, networkPick(), !MAINNET_ON
    ? el("div", { class: "net-opt setup-network-unavailable", "aria-disabled": "true" },
      el("strong", {}, "Mainnet"), el("span", { class: "small muted" }, "Unavailable in this release")) : null),
  planningNetworks(),
  el("p", { class: "small muted" }, "Solana Devnet is included by default. Unavailable services wait while your Zcash progress is saved."))));
function reviewStep() {
  const d = ui.createDraft ?? { n: 3, t: 2 };
  const includeSol = reviewSolIncluded(d);
  const row = (k, v) => [el("dt", {}, k), el("dd", {}, v)];
  const full = d.t === d.n;
  return step(3,
    el("div", { class: "setup-review-columns" },
      el("section", { class: "setup-review-details" },
        el("section", { class: "setup-review-devices surface-quiet", "aria-label": "Proposed participating devices" },
          el("span", { class: "label" }, "Devices at setup · proposed arrangement"),
          el("div", { class: "setup-review-device-list" }, Array.from({ length: d.n }, (_, i) =>
            el("div", {}, icon(i === 0 ? "laptop" : "phone"),
              el("span", {}, i === 0 ? d.label || "This device" : "Device " + (i + 1)))))),
        el("dl", { class: "kv" }, row("Wallet name", d.name || "Treasury"),
          d.description ? row("Private description", d.description) : null,
          row("This device's label", d.label || "None. The other devices show Device 1."),
          row("Browser protection", protectionLabel())),
        full ? el("p", { class: "callout warn" }, marginText(d.t, d.n))
          : el("p", { class: "small muted" }, marginText(d.t, d.n))),
      el("section", { class: "setup-review-configuration" },
        el("div", { class: "setup-review-summary", "aria-label": "Wallet setup summary" },
          el("div", {}, el("strong", {}, String(d.n)), el("span", {}, "devices at setup")),
          el("div", {}, el("strong", {}, String(d.t) + " of " + d.n), el("span", {}, "approvals per payment")),
          el("div", {}, el("strong", {}, "Zcash " + curNetLabel()),
            el("span", {}, includeSol ? solServed() ? "+ Solana Devnet" : "Solana Devnet · waiting for service"
              : "Zcash only"))),
        el("p", { class: "small muted" }, "All " + d.n + " devices join and check the wallet before use. Initial formation needs no fee funding or on-chain deployment. Later Deposit and Send operations show their own costs."),
        el("p", { class: "small muted" }, "Recovery files are recommended and optional. Each copies one device’s share and needs its separate passphrase. You can save or check files later."))),
    // Preserve the existing setup submission value without displaying the network section.
    ui.net === "testnet" ? el("div", { hidden: true }, solChoice()) : null);
}
const curNetLabel = () => (ui.net === "mainnet" ? "mainnet" : "testnet");
const protectionLabel = () => passkeyProtected() ? "Passkey protected"
  : protectionUnverified() ? "Passkey copy not fully checked"
  : setupProtectionReady() ? "Skipped · no passkey encryption" : "Protection choice needed";
// Above the buttons, not in their bar: on a phone the bar stays at the bottom of the sheet.
const stepError = () => (ui.createError ? el("p", { class: "callout bad", role: "alert",
  id: "create-error" }, ui.createError) : null);
function stepActions() {
  const s = ui.createStep, last = s === STEPS.length - 1;
  if (s === 0 && skipProtectionAsk === "create-first") return null;
  const off = offOf({ db: !!db, newSigner: true }, "why-create-submit");
  const entryReady = setupProtectionReady();
  return el("div", { class: "dialog-actions" },
    el("button", { class: "btn", type: "button", onclick: savePlanAndExit }, "Save and exit"),
    s > 0 ? el("button", { class: "btn", type: "button", onclick: backClick(s) }, "Back") : null,
    el("button", { class: "btn primary", type: "submit", "data-key": "create-continue",
      "data-first-focus": s === 0 && entryReady,
      onclick: firstClick,
      ...(last ? off.attrs : {}),
      "aria-describedby": !entryReady || last ? off.attrs["aria-describedby"] : null,
      disabled: protectionPending || !entryReady || last && !!off.attrs.disabled }, NEXT[s]),
    last || !entryReady ? off.note : null);
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
  const lines = ruleLines(ui.createDraft?.n ?? 3, ui.createDraft?.t ?? 2,
    (n, t, valid) => updateSetupIllustrations(form, n, t, valid)), at = ui.createStep;
  const submit = (ev) => (at === ui.createStep ? stepSubmit(ev) : ev.preventDefault());
  const form = frame("Set up your wallet", { class: "dialog guided-plan", oninput: lines.update, onsubmit: submit },
    el("nav", { class: "setup-plan-progress", "aria-label": "Wallet setup plan" },
      el("p", { class: "sr-only", role: "status" }, "Step " + (at + 1) + " of " + STEPS.length
        + ": " + STEPS[at]),
      el("ol", {}, STEPS.map((label, i) => el("li", {
        class: i < at ? "done" : i === at ? "current" : "",
        "aria-current": i === at ? "step" : null,
      }, el("span", { "aria-hidden": "true" }, String(i + 1)), el("span", {}, label))))),
    introStep(), ruleStep(lines), namesStep(), reviewStep(), stepError(), stepActions());
  return form;
}
// Change devices keeps one form: its steps first, then the names and the rule.
function moveDialog(from) {
  const lines = ruleLines(from.n, from.t);
  const off = offOf({ db: !!db, newSigner: true }, "why-create-submit");
  return frame("Change devices", { oninput: lines.update, onsubmit: moveSubmit(from) },
    deviceProtection("move"),
    ...moveParts(from, names(from), [counts(from.n, from.t, "margin-text"), lines.rule,
      lines.margin, lines.ack]),
    el("div", { class: "callout" }, "The new wallet gets a new address. Devices that you leave "
      + "out cannot read the new wallet. They can still read each payment of this old wallet, "
      + "later ones too, and the move payment: the new address, the amount, the note and the id "
      + "of the new wallet. With that id, they can get the sealed documents of the new wallet from "
      + "the group server, and it takes their writes, so they can stop it with false documents."),
    el("div", { class: "dialog-actions" },
      el("button", { class: "btn", type: "button", onclick: closeCreate }, "Cancel"),
      el("button", { class: "btn primary", type: "submit", ...off.attrs }, "Create new wallet"),
      off.note));
}
// With `from`, the dialog creates the wallet that replaces `from`, with new signers or a new rule.
export const createDialog = (from = null) => (from ? moveDialog(from) : newDialog());
