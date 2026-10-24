// Reactor, render loop, focus, layers and page listeners.
import { busy, clearBadBanner, log, showBanner, state, ui } from "./app-state.js";
import { Z } from "./app-engine.js";
import { chats, lockedVault } from "./app-keystore.js";
import { curSession, keysDiffer, localSeats } from "./app-seats.js";
import { ensureChain } from "./app-chain.js";
import { sessionParts, signedHold } from "./app-filter.js";
import {
  closeSession, db, dbReady, learnNetwork, openGroup, toApprove, watched, watchOnly,
} from "./app-groups.js";
import { el } from "./app-dom.js";
import { presentMotion } from "./app-motion.js";
import { presentWalletMarble } from "./wallet-marble.js";
import { presentWalletReveal } from "./app-wallet-art.js";
import { announceApprovalProgress } from "./app-approval-visualization.js";
import { markRead, syncRooms, unreadIn } from "./app-messages.js";
import {
  canCreateWallet, createWallet, groupVersion, myVerified, reactConfirm, reactSeat, reactStops,
} from "./app-dkg.js";
import { noteSessions, reactSession, toWatch } from "./app-payments.js";
import { acct, personal } from "./app-account.js";
import { newChatDialog } from "./app-thread.js";
import { backupDialog, closeBackup, restoreDialog, settleRestore } from "./app-backups.js";
import {
  clearMessagingCostReview, closeMessagingCostReview, contactDialog,
  hasMessagingCostReview, messagingCostReviewDialog,
} from "./app-account-view.js";
import {
  closeMessagingTutorial, hasMessagingTutorial, messagingTutorialDialog,
} from "./app-messaging-education.js";
import {
  activityWorkspace, approvalsWorkspace, chatsWorkspace, createDialog, endCreate, loadingView,
  lobby, lockView, recoveryWorkspace, renderSide, settingsWorkspace, swapWorkspace,
} from "./app-shell.js";
import { recipientsView } from "./app-recipients.js";
import { sessionLayer } from "./app-drawer.js";
import { solPending, solReact } from "./app-sol.js";
import { groupView, walletHeader, walletShown } from "./app-wallet.js";
import { closeSetupQr, setupQrDialog } from "./app-setup.js";
import { endSend, receiveDialog, sendDialog } from "./app-send.js";
import { closeNetworkPrivacy, hasNetworkPrivacy, networkPrivacyPanel } from "./app-network-privacy.js";
import { presentPrivacyStatus } from "./network-privacy-popup.js";

import { closeHowZigsWorks, hasHowZigsWorks, howZigsWorksDialog } from "./app-how-zigs-works.js";

// Each browser advances the steps it can do for its own seats. Steps that
// need a human decision (approving a spend) wait for a click.
const RETRY_MS = 3000;
// The text of the bad banner that each step showed. A later success of the same step hides it,
// unless the banner shows another text by then. ponytail: two steps that fail with the same text
// share the banner, so the success of one hides it until the next try of the other (3 s).
const failedWith = new Map();
export async function once(key, fn) {
  if (busy.has(key)) return; busy.add(key);
  let wait = 0;
  try {
    await fn();
    if (failedWith.has(key)) { clearBadBanner(failedWith.get(key)); failedWith.delete(key); }
  } catch (e) {
    wait = RETRY_MS;
    const text = e && e.message ? e.message : String(e);
    log("✗ " + key + ": " + text); showBanner("bad", text); failedWith.set(key, text);
  }
  finally { busy.delete(key); render(); setTimeout(react, wait); }
}

export function react() {
  try {
    settleRestore();
    syncRooms();
    reactNow();
  } catch (e) { log("✗ react: " + (e && e.message ? e.message : e)); }
}

const canReact = () => !!(Z && db && state.g && !state.g.unreadable && groupVersion());
const chainReady = () => state.wallet && state.wallet.birthday && myVerified() && !keysDiffer();

function reactNow() {
  if (!canReact() || signedHold()) return;
  learnNetwork();
  reactStops();
  reactConfirm();
  for (const i of localSeats()) reactSeat(i);
  if (chainReady()) { ensureChain(); noteSessions(); }
  // Group creator builds the shared wallet once all group keys agree.
  if (canCreateWallet()) once("wallet", createWallet);
  // Signing: the open payment, and in the background each other one that waits for this browser.
  const ss = curSession();
  if (ss && state.wallet) reactSession(ss);
  reactWatched();
  solReact();
}

// The open payment is watched too: closing its drawer reacts on nothing, and the approvals that
// come later must still reach this browser. The shared once() keys stop a second run.
function reactWatched() {
  if (!state.wallet) return;
  const want = toWatch(state.sessions);
  watchOnly(want.map((x) => x.id));
  for (const x of want) {
    const w = watched.get(x.id);
    if (w) reactSession(x, sessionParts(x.id, w.raw));
  }
}

let openLayer = "", tickTimer = null;
export let opener = "", lastTrigger = "", wantFocus = null;   // focus bookkeeping, see draw()
export function focusAfter(key, force) { wantFocus = key ? { key, force } : null; }

// Draws once per frame, however many changes arrive together. A hidden tab gets no frames, so a
// timer backs it up and the tab title still shows the approvals.
let drawPending = false, composing = false, holdUntil = 0;
// A redraw replaces the text box and ends an IME composition, so it waits until the end. It also
// replaces every button: one between a press and its click takes the click away (the first press
// of a page focuses the window, which redraws). So it waits for the click, at most 1 s.
function flush() {
  if (!drawPending || composing) return;
  const left = holdUntil - performance.now();
  if (left > 0) { setTimeout(flush, left); return; }
  drawPending = false; draw();
}
export function render() {
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(flush);
  setTimeout(flush, 120);
}
const endHold = () => { holdUntil = 0; setTimeout(flush); };
document.addEventListener("pointerdown", () => { holdUntil = performance.now() + 1000; }, true);
// A touch fires its click in a later task than pointerup, so the hold ends 100 ms after it.
document.addEventListener("pointerup", () => {
  holdUntil = Math.min(holdUntil, performance.now() + 100);
}, true);
document.addEventListener("pointercancel", endHold, true);
document.addEventListener("click", endHold, true);

const FOCUSABLE = "button, a[href], input, select, textarea, summary";
// A rebuilt control is a new element. A key from its label (or an explicit data-key) lets focus
// find it again; equal labels get a number.
function keyControls(root) {
  const seen = new Map();
  for (const n of root.querySelectorAll(FOCUSABLE)) {
    if (n.dataset.key) continue;
    const base = n.tagName + ":" + controlLabel(n), count = seen.get(base) || 0;
    seen.set(base, count + 1);
    n.dataset.key = base + ":" + count;
  }
}

function controlLabel(n) {
  const text = n.textContent.trim().slice(0, 40);
  return n.id || n.getAttribute("aria-label") || n.name || text || n.type;
}
const controlByKey = (root, key) =>
  [...root.querySelectorAll("[data-key]")].find((n) => n.dataset.key === key);

function focusSnapshot(root) {
  const a = document.activeElement;
  if (!a || !root.contains(a) || !a.dataset.key) return null;
  const snap = { key: a.dataset.key, inLayer: !!a.closest(".dialog, .drawer") };
  try {
    snap.sel = [a.selectionStart, a.selectionEnd, a.selectionDirection];
  } catch { /* not a text control */ }
  return snap;
}

// `wantFocus.force` wins over the old focus (a pick in the side list, the opener of a closed
// layer).
function focusKey(snap) {
  const want = wantFocus; wantFocus = null;
  return want && (want.force || !snap) ? want.key : snap && snap.key;
}
// A control of the open drawer that went away (a step that another device took) leaves the focus
// in the drawer. A dialog keeps it where the page put it: its first field would scroll the dialog
// and open a phone keyboard.
export function restoreFocus(root, snap, layer) {
  const key = focusKey(snap), n = key && controlByKey(root, key);
  if (!n) {
    if (inDrawer(snap, layer)) focusLayer(layer);
    return;
  }
  n.focus({ preventScroll: true });
  if (snap && snap.key === key) restoreSelection(n, snap.sel);
}

const inDrawer = (snap, layer) => !!snap?.inLayer && !!layer?.classList.contains("drawer");

function restoreSelection(n, sel) {
  if (!sel || sel[0] == null) return;
  try { n.setSelectionRange(...sel); } catch { /* not a text control */ }
}

// A layer can name its first field with data-first-focus; else the first input or button.
function focusLayer(layer) {
  layer.tabIndex = -1;
  const pick = layer.classList.contains("drawer") ? ".icon-btn" : "input, button.btn";
  (layer.querySelector("[data-first-focus]") || layer.querySelector(pick) || layer).focus();
}

// The page behind a dialog or the drawer cannot take focus or clicks while the layer is open. The
// footer is part of the page: on a phone its link would take Tab out of the loop of the layer.
export function setModal(view, on) {
  view.toggleAttribute("inert", on);
  for (const part of [".side", ".app-foot", ".wallet-context-header"]) {
    document.querySelector(part)?.toggleAttribute("inert", on);
  }
}

const appFoot = () => el("footer", { class: "app-foot" },
  el("a", { href: "https://zigs.app", target: "_blank", rel: "noopener" }, "About Zigs"));

// The page when no wallet is open: a direct chat, a contact on chain, or the wallet list.
export const mainView = () => (state.cid || state.contact != null ? chatsWorkspace()
  : ui.tab === "chats" ? chatsWorkspace() : lobby());

function pageView() {
  try {
    if (lockedVault) {
      clearMessagingCostReview();
      clearMessagingPresentation();
      if (hasMessagingTutorial()) closeMessagingTutorial();
      return lockView();
    }
    if (!dbReady) return loadingView();
    if (state.cid || state.contact != null) return chatsWorkspace();
    if (ui.tab === "recipients") return recipientsView();
    if (ui.tab === "swap") return swapWorkspace();
    if (ui.tab === "chats") return chatsWorkspace();
    if (ui.tab === "settings" && !walletShown()) return settingsWorkspace();
    if (ui.tab === "activity" && !state.gid) return activityWorkspace();
    if (ui.tab === "approvals" && !state.gid) return approvalsWorkspace();
    if (ui.tab === "recovery" && !state.gid) return recoveryWorkspace();
    return state.gid ? groupView({ showHeader: !walletShown() }) : mainView();
  } catch (e) {
    log("unreadable page: " + (e && e.message ? e.message : e));
    const back = el("button", {
      class: "btn ghost sm", type: "button", onclick: () => openGroup(null),
    }, "← Wallets");
    return el("div", { class: "page" }, back,
      el("div", { class: "card empty" }, el("h3", {}, "This wallet has data this app cannot read"),
        el("p", { class: "small" }, "A device of this wallet may run a newer version of Zigs. "
          + "Reload the page, or ask the other people who use this wallet.")));
  }
}

// The global privacy status mounts independently and must not invalidate the wallet identity.
const walletHeaderText = (header) => Array.from(
  header.querySelectorAll(".wallet-identity,.wallet-meta,.wallet-home"),
  (part) => part.textContent).join("\n");

// A header is navigation context only. Direct chats keep their existing independent lifecycle.
function selectedWalletHeader(app, view) {
  if (lockedVault || !dbReady || view.classList.contains("guided-setup")) return null;
  const previous = app.querySelector(".wallet-context-header");
  const home = !state.gid && !state.cid && state.contact == null && ui.tab === "overview";
  const g = walletShown() ? state.g : !state.gid && !home
    ? state.groups.find((group) => group.id === previous?.dataset.walletContext) : null;
  if (!g || g.unreadable) return null;
  const next = walletHeader(g);
  if (previous?.dataset.walletContext === g.id && walletHeaderText(previous) === walletHeaderText(next)
    && previous.querySelector(".wallet-marble")?._walletMarbleEntry
      === next.querySelector(".wallet-marble")?._walletMarbleEntry) return previous;
  return next;
}

function placeWalletHeader(app, header) {
  const previous = app.querySelector(".wallet-context-header");
  if (previous === header) return;
  previous?.remove();
  if (header) app.prepend(header);
}

export function draw() {
  const shell = document.querySelector(".shell"), app = document.getElementById("app");
  const snap = focusSnapshot(shell);
  markRead();
  renderSide();
  const pending = state.groups.reduce((n, g) => n + toApprove(g.id).length + solPending(g.id)
    + unreadIn(g.id), 0) + Object.keys(chats.list).reduce((n, cid) => n + unreadIn(cid), 0);
  document.title = pending ? "(" + pending + ") Zigs" : "Zigs";
  const form = saveFormState(app);
  if (lockedVault) { closeSetupQr(); closeNetworkPrivacy(); closeHowZigsWorks(); }
  const view = pageView(), top = lockedVault ? [] : layers();
  const header = selectedWalletHeader(app, view);
  if (typingMessage(app, [view, ...top])) {
    placeWalletHeader(app, header); presentWalletMarble(document); return;
  }
  // The Swap preview keeps its input nodes across wallet-status redraws (and phone keyboards).
  const previousView = app.firstElementChild?.classList.contains("wallet-context-header")
    ? app.firstElementChild.nextElementSibling : app.firstElementChild;
  if (view !== previousView || top.length || app.querySelector(".scrim"))
    app.replaceChildren(...(header ? [header] : []), view, ...top, appFoot());
  else placeWalletHeader(app, header);
  presentPrivacyStatus(document);
  announceApprovalProgress(document);
  keyControls(shell);
  setModal(view, top.length > 0);
  presentWalletMarble(document);
  const entered = trackLayer(top);
  clearTimeout(tickTimer);
  const ss = curSession();
  if (ss && ss.status === "proving") tickTimer = setTimeout(render, 1000);
  restoreFormState(app, form);
  if (entered) focusLayer(top[1]); else restoreFocus(shell, snap, top[1]);
  presentMotion({ view, layer: top[1], identity: { wallet: state.gid, panel: ui.tab,
    session: state.sid, chat: state.cid, contact: state.contact,
    surface: view.id || view.className } });
  presentWalletReveal(document);
}

// Rebuilding a focused text box closes a phone's keyboard. While a message box or a field of the
// request form has focus, only the message logs update; the whole page redraws when it loses focus.
// A field of the request form counts only while its form is open: after a send, the form must go.
const typingIn = (box) => !!box && (box.id.startsWith("chat-text-") || box.id === "fund-amt"
  || (!!ui.request && /^req-(amt|memo)-/.test(box.id)));
export function typingMessage(app, parts) {
  const box = document.activeElement;
  if (lockedVault || !typingIn(box) || !app.contains(box) || !accountViewIsCurrent(box)
    || parts.some((p) => p?.matches?.(".dialog, .drawer"))) return false;
  const logs = saveLogs(app);
  for (const old of app.querySelectorAll(".chat-log")) {
    const fresh = parts.map((p) => p && p.querySelector("#" + old.id)).find(Boolean);
    if (!fresh) continue;
    old.replaceWith(fresh);
    fresh.scrollTop = logs[fresh.id] ?? fresh.scrollHeight;
  }
  if (!box.dataset.redraw) {
    box.dataset.redraw = "1";
    box.addEventListener("focusout", () => render(), { once: true });
  }
  return true;
}

// Drafts and scroll positions stay in this tab across conversation navigation. Limit both
// caches; never put message text in local storage or a shared wallet record.
const messageDrafts = new Map(), messageScroll = new Map();
const MAX_MESSAGE_VIEWS = 100, MAX_DRAFT_CHARS = 200000;
let draftAccount = null, accountPresentationId = 0;
const rememberView = (cache, id, value) => {
  cache.delete(id); cache.set(id, value);
  while (cache.size > MAX_MESSAGE_VIEWS) cache.delete(cache.keys().next().value);
};

// A public, opaque DOM scope identifies this live account's lifetime. An old account's DOM
// must not be captured under its replacement, even if both have contact index 1.
export function messagingAccountScope() {
  if (draftAccount !== acct) {
    draftAccount = acct; accountPresentationId++;
    for (const id of messageDrafts.keys()) if (id.startsWith("chat-text-oc-")) messageDrafts.delete(id);
    for (const id of messageScroll.keys()) if (id.startsWith("log-oc-")) messageScroll.delete(id);
  }
  return "account-view-" + accountPresentationId;
}

export function clearMessagingPresentation() {
  messageDrafts.clear(); messageScroll.clear();
  accountPresentationId++;
}

export function clearMessageDraft(id, text, scope = null) {
  if (scope && scope !== messagingAccountScope()) return;
  const kept = messageDrafts.get(id);
  if (typeof kept === "string" && kept.trim() === text.trim()) messageDrafts.delete(id);
}

const accountViewIsCurrent = (node) => !/^(chat-text-oc-|log-oc-)/.test(node.id)
  || node.getAttribute?.("data-account-scope") === messagingAccountScope();

function rememberDraft(node) {
  messageDrafts.delete(node.id);
  if (!node.value) return;
  rememberView(messageDrafts, node.id, node.value);
  let chars = [...messageDrafts.values()].reduce((n, value) => n + value.length, 0);
  while (chars > MAX_DRAFT_CHARS && messageDrafts.size) {
    const id = messageDrafts.keys().next().value;
    chars -= messageDrafts.get(id).length; messageDrafts.delete(id);
  }
}

// Keep what the viewer is typing, open <details>, and the drawer scroll across live updates. A
// disclosure of a secret link counts by its link, never by its summary, so a redraw never opens
// the secret of another card.
const openKey = (summary) => (summary.parentElement.dataset.disclosureKey
  ? "view:" + summary.parentElement.dataset.disclosureKey : summary.parentElement.dataset.link
    ? "link:" + summary.parentElement.dataset.link : summary.textContent);
export function saveFormState(app) {
  messagingAccountScope();
  if (lockedVault) clearMessagingPresentation();
  const values = {};
  for (const i of app.querySelectorAll("input[id], select[id], textarea[id]")) {
    if (i.type === "file" || !accountViewIsCurrent(i)) continue;
    if (i.id.startsWith("chat-text-")) {
      if (lockedVault) continue;
      rememberDraft(i);
    }
    values[i.id] = i.value;
  }
  const open = new Set([...app.querySelectorAll("details[open] > summary")].map(openKey));
  const scroll = app.querySelector(".drawer-body")?.scrollTop || 0;
  return { values, open, logs: saveLogs(app), scroll, accountScope: messagingAccountScope() };
}

// A message log that was at its end stays at its end; otherwise it keeps its place.
function saveLogs(app) {
  const logs = {};
  for (const l of app.querySelectorAll(".chat-log")) {
    if (lockedVault || !accountViewIsCurrent(l)) continue;
    logs[l.id] = l.scrollHeight - l.scrollTop - l.clientHeight < 24 ? null : l.scrollTop;
    rememberView(messageScroll, l.id, logs[l.id]);
  }
  return logs;
}

export function restoreFormState(app, form) {
  const oldValues = { ...form.values };
  if (form.accountScope && form.accountScope !== messagingAccountScope()) {
    for (const id of Object.keys(oldValues)) if (id.startsWith("chat-text-oc-")) delete oldValues[id];
  }
  const values = { ...Object.fromEntries(messageDrafts), ...oldValues };
  for (const [id, v] of Object.entries(values)) {
    const i = document.getElementById(id);
    if (!i || !accountViewIsCurrent(i)) continue;
    i.value = v;
    i.dispatchEvent(new Event("input", { bubbles: true }));
  }
  for (const x of app.querySelectorAll("details > summary")) {
    if (form.open.has(openKey(x))) x.parentElement.open = true;
  }
  restoreScroll(app, form);
}

function restoreScroll(app, form) {
  const body = app.querySelector(".drawer-body");
  if (body) body.scrollTop = form.scroll;
  for (const l of app.querySelectorAll(".chat-log")) {
    if (!accountViewIsCurrent(l)) continue;
    const sameAccount = !l.id.startsWith("log-oc-") || !form.accountScope
      || form.accountScope === messagingAccountScope();
    const at = sameAccount && Object.hasOwn(form.logs, l.id) ? form.logs[l.id] : messageScroll.get(l.id);
    l.scrollTop = at ?? l.scrollHeight;
  }
}

// Remembers which control opened a layer, and asks for it back when the layer closes. Returns true
// when a new layer just opened.
function trackLayer(top) {
  const layer = top[1];
  const key = layer ? layer.getAttribute("aria-labelledby") || layer.getAttribute("aria-label") : "";
  if (key && !openLayer) { opener = lastTrigger; lastTrigger = ""; }
  if (!key && openLayer && opener) {
    if (!wantFocus?.force) wantFocus = { key: opener, force: true };
    opener = "";
  }
  const entered = !!key && key !== openLayer;
  openLayer = key;
  return entered;
}

// The control that opened a layer gets focus back when the layer closes.
document.addEventListener("click", (ev) => {
  const n = ev.target.closest && ev.target.closest(FOCUSABLE);
  if (n && n.dataset.key && !n.closest(".dialog, .drawer")) lastTrigger = n.dataset.key;
}, true);

export function layers() {
  try {
    const qr = setupQrDialog();
    if (qr) return [scrim(closeSetupQr), qr];
    return ui.newChat ? [scrim(() => ui.newChat = false), newChatDialog()] : buildLayers();
  }
  catch (e) { log("unreadable layer: " + (e && e.message ? e.message : e)); return []; }
}

// The second click of a double click on a button that moved can land on the scrim: it closes
// nothing.
const scrim = (close) => el("div", { class: "scrim", onclick: (ev) => {
  if (ev?.detail > 1) return;
  close(); render();
} });

// The dialogs, in the order that they take the screen: [is shown, close, build]. `open` is true in
// an open wallet that has its wallet document. A restore starts in the wallet list.
const DIALOGS = [
  [hasMessagingCostReview, closeMessagingCostReview, messagingCostReviewDialog],
  [hasMessagingTutorial, closeMessagingTutorial, messagingTutorialDialog],
  [() => ui.restore, closeBackup, () => restoreDialog()],
  [(open) => ui.backup && (open || ui.backup.personal), closeBackup, () => backupDialog()],
  [(open) => ui.send && open, endSend, () => sendDialog()],
  [(open) => ui.receive && open, () => ui.receive = false, () => receiveDialog()],
  [() => ui.create && !state.gid, endCreate, () => createDialog()],
  [() => ui.contactAdd && !!personal, () => ui.contactAdd = false, () => contactDialog()],
  [(open) => ui.move && open, endCreate, () => createDialog(state.g)],
  [hasNetworkPrivacy, closeNetworkPrivacy, networkPrivacyPanel],
  [hasHowZigsWorks, closeHowZigsWorks, howZigsWorksDialog],
];

function buildLayers() {
  const ss = state.gid && state.wallet ? curSession() : null;
  if (ss) return [scrim(closeSession), sessionLayer(ss)];
  const open = state.gid && state.wallet;
  const dialog = DIALOGS.find(([shown]) => shown(open));
  return dialog ? [scrim(dialog[1]), dialog[2]()] : [];
}

document.addEventListener("visibilitychange", render);
window.addEventListener("focus", render);

const OFFLINE = "No network connection. Network actions need a connection. "
  + "The data on this page can be old.";
/** The status line at the top of the page shows while the browser is offline. */
export function showOffline() {
  const box = document.getElementById("offline");
  if (!box) return;
  const offline = globalThis.navigator?.onLine === false;
  box.replaceChildren(...(offline ? [el("div", { class: "callout warn" }, OFFLINE)] : []));
}
window.addEventListener("online", showOffline);
window.addEventListener("offline", showOffline);
showOffline();

// A phone keyboard covers the lower part of the window. A dialog and the drawer end above it
// (app.css reads the two values). A pinch zoom also shrinks the visual viewport, so only a scale
// near 1 counts as a keyboard.
const keyboardOf = (visual, height) => Math.abs(visual.scale - 1) < 0.01
  ? { inset: Math.max(0, height - visual.height - visual.offsetTop), visible: visual.height + "px" }
  : { inset: 0, visible: "100dvh" };
// Scrolls the focused field of a layer into view, and the note under it.
function showField(field) {
  field.scrollIntoView?.({ block: "nearest" });
  const note = field.getAttribute?.("aria-describedby")?.split(" ").at(-1);
  document.getElementById(note)?.scrollIntoView?.({ block: "nearest" });
}
// The focused field scrolls into view only when the keyboard opens, so that a scroll of the person
// is not undone.
let lastInset = 0;
export function fitKeyboard() {
  const visual = window.visualViewport;
  if (!visual || !Number.isFinite(visual.height)) return;
  const { inset, visible } = keyboardOf(visual, window.innerHeight);
  const opened = inset > lastInset;
  lastInset = inset;
  const root = document.documentElement.style;
  root.setProperty("--keyboard-inset", inset + "px");
  root.setProperty("--visual-height", visible);
  const field = document.activeElement;
  if (opened && field?.closest?.(".dialog, .drawer")) showField(field);
}
window.visualViewport?.addEventListener("resize", fitKeyboard);
window.visualViewport?.addEventListener("scroll", fitKeyboard);
fitKeyboard();
const endCompose = () => {
  if (!composing) return;
  composing = false; drawPending = false; render();
};
document.addEventListener("compositionstart", () => { composing = true; });
document.addEventListener("compositionend", endCompose);
document.addEventListener("focusout", endCompose);
const STOPS = FOCUSABLE + ", [tabindex]";
// A control in a closed <details> has client rects in Chrome, so checkVisibility decides.
const shown = (n) => n.getClientRects().length > 0 && (n.checkVisibility?.() ?? true);
const isStop = (n) => !n.disabled && n.tabIndex >= 0 && shown(n);
function tabStops(root) {
  const stops = [...root.querySelectorAll(STOPS)].filter(isStop);
  // Native Tab visits one radio per named form group; arrows keep their native behavior.
  return stops.filter((node) => {
    if (node.type !== "radio" || !node.name) return true;
    const group = stops.filter((other) => other.type === "radio"
      && other.name === node.name && other.form === node.form);
    return node === (group.find((other) => other.checked) || group[0]);
  });
}
// The stops of the layer, then the Close button of an open banner, which shows above the layer.
function loopStops(layer) {
  const banner = document.getElementById("banner");
  return [...tabStops(layer), ...(banner ? tabStops(banner) : [])];
}
// The stops of the layer before the focus, when the focus is on no stop. A focus outside the
// layer, or on the layer itself, has none before it.
function stopsBefore(layer) {
  const all = [...layer.querySelectorAll(STOPS)], at = all.indexOf(document.activeElement);
  return at < 0 ? 0 : tabStops(layer).filter((node) => all.indexOf(node) < at).length;
}
// Advance each Tab in DOM order, wrapping at an edge. A focus that is no stop (`at` -1)
// advances from its position in the layer. `back` is Shift+Tab.
function loopTarget(layer, stops, at, back) {
  const last = stops.length - 1;
  if (at >= 0) return stops[(at + (back ? -1 : 1) + stops.length) % stops.length];
  const before = stopsBefore(layer);
  if (back) return stops[before > 0 ? before - 1 : last];
  return stops[before <= last ? before : 0];
}
/** Tab goes round in the open dialog or drawer: from its last control to its first, and Shift+Tab
 * from its first to its last. From a control of the layer that is no stop, Tab goes to the next
 * stop and Shift+Tab to the stop before. Focus on the layer itself or outside it goes in. */
export function layerTab(ev) {
  const layer = document.querySelector(".dialog, .drawer");
  if (ev.key !== "Tab" || !layer) return;
  const stops = loopStops(layer), at = stops.indexOf(document.activeElement);
  if (!stops.length) {
    ev.preventDefault();
    layer.tabIndex = -1;
    layer.focus();
    return;
  }
  // WebKit can skip buttons in its native Tab mode. Own each step so an intermediate input
  // cannot send focus out of the dialog before the edge of our visible-control list.
  ev.preventDefault();
  loopTarget(layer, stops, at, ev.shiftKey).focus();
}
document.addEventListener("keydown", layerTab);
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  closeSetupQr();
  if (hasMessagingCostReview()) { closeMessagingCostReview(); render(); return; }
  if (document.getElementById("network-privacy-panel")) { closeNetworkPrivacy(); render(); return; }
  if (hasMessagingTutorial()) { closeMessagingTutorial(); render(); return; }
  if (hasHowZigsWorks()) { closeHowZigsWorks(); render(); return; }
  if (state.sid) closeSession();
  else {
    endSend(); endCreate(); ui.receive = false; ui.newChat = false;
    ui.contactAdd = false;
    closeBackup();
  }
  render();
});
