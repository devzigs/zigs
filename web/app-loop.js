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
import { markRead, syncRooms, unreadIn } from "./app-messages.js";
import {
  canCreateWallet, createWallet, groupVersion, myVerified, reactConfirm, reactSeat, reactStops,
} from "./app-dkg.js";
import { noteSessions, reactSession, toWatch } from "./app-payments.js";
import { personal } from "./app-account.js";
import { chatView, newChatDialog } from "./app-thread.js";
import { backupDialog, closeBackup, restoreDialog, settleRestore } from "./app-backups.js";
import { contactDialog, contactView } from "./app-account-view.js";
import { createDialog, endCreate, loadingView, lobby, lockView, renderSide } from "./app-shell.js";
import { sessionLayer } from "./app-drawer.js";
import { solPending, solReact } from "./app-sol.js";
import { groupView } from "./app-wallet.js";
import { endSend, receiveDialog, sendDialog } from "./app-send.js";

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
let drawPending = false, composing = false;
export function render() {
  if (drawPending) return;
  drawPending = true;
  // A redraw replaces the text box and ends an IME composition, so it waits until the end.
  const run = () => { if (drawPending && !composing) { drawPending = false; draw(); } };
  requestAnimationFrame(run);
  setTimeout(run, 120);
}

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
  const snap = { key: a.dataset.key };
  try {
    snap.sel = [a.selectionStart, a.selectionEnd, a.selectionDirection];
  } catch { /* not a text control */ }
  return snap;
}

// `wantFocus.force` wins over the old focus (a pick in the side list, the opener of a closed
// layer).
function restoreFocus(root, snap) {
  const want = wantFocus; wantFocus = null;
  const key = want && (want.force || !snap) ? want.key : snap && snap.key;
  const n = key && controlByKey(root, key);
  if (!n) return;
  n.focus({ preventScroll: true });
  if (snap && snap.key === key) restoreSelection(n, snap.sel);
}

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
  for (const part of [".side", ".app-foot"]) {
    document.querySelector(part)?.toggleAttribute("inert", on);
  }
}

const appFoot = () => el("footer", { class: "app-foot" }, "Beta · not audited · ",
  el("a", { href: "https://zigs.app", target: "_blank", rel: "noopener" }, "About Zigs"));

// The page when no wallet is open: a direct chat, a contact on chain, or the wallet list.
export const mainView = () => (state.cid ? chatView() : state.contact != null ? contactView() : lobby());

function pageView() {
  try {
    if (lockedVault) return lockView();
    if (!dbReady) return loadingView();
    return state.gid ? groupView() : mainView();
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

export function draw() {
  const shell = document.querySelector(".shell"), app = document.getElementById("app");
  const snap = focusSnapshot(shell);
  markRead();
  renderSide();
  const pending = state.groups.reduce((n, g) => n + toApprove(g.id).length + solPending(g.id)
    + unreadIn(g.id), 0) + Object.keys(chats.list).reduce((n, cid) => n + unreadIn(cid), 0);
  document.title = pending ? "(" + pending + ") Zigs" : "Zigs";
  const form = saveFormState(app);
  const view = pageView(), top = lockedVault ? [] : layers();
  if (typingMessage(app, [view, ...top])) return;
  app.replaceChildren(view, ...top, appFoot());
  keyControls(shell);
  setModal(view, top.length > 0);
  const entered = trackLayer(top);
  clearTimeout(tickTimer);
  const ss = curSession();
  if (ss && ss.status === "proving") tickTimer = setTimeout(render, 1000);
  restoreFormState(app, form);
  if (entered) focusLayer(top[1]); else restoreFocus(shell, snap);
}

// Rebuilding a focused text box closes a phone's keyboard. While a message box or a field of the
// request form has focus, only the message logs update; the whole page redraws when it loses focus.
// A field of the request form counts only while its form is open: after a send, the form must go.
const typingIn = (box) => !!box && (box.id.startsWith("chat-text-") || box.id === "fund-amt"
  || (!!ui.request && /^req-(amt|memo)-/.test(box.id)));
export function typingMessage(app, parts) {
  const box = document.activeElement;
  if (!typingIn(box) || !app.contains(box)) return false;
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

// Keep what the viewer is typing, open <details>, and the drawer scroll across live updates.
function saveFormState(app) {
  const values = {};
  for (const i of app.querySelectorAll("input[id], select[id], textarea[id]")) {
    if (i.type !== "file") values[i.id] = i.value;
  }
  const open = new Set([...app.querySelectorAll("details[open] > summary")].map((x) => x.textContent));
  const scroll = app.querySelector(".drawer-body")?.scrollTop || 0;
  return { values, open, logs: saveLogs(app), scroll };
}

// A message log that was at its end stays at its end; otherwise it keeps its place.
function saveLogs(app) {
  const logs = {};
  for (const l of app.querySelectorAll(".chat-log")) {
    logs[l.id] = l.scrollHeight - l.scrollTop - l.clientHeight < 24 ? null : l.scrollTop;
  }
  return logs;
}

function restoreFormState(app, form) {
  for (const [id, v] of Object.entries(form.values)) {
    const i = document.getElementById(id);
    if (!i) continue;
    i.value = v;
    i.dispatchEvent(new Event("input", { bubbles: true }));
  }
  for (const x of app.querySelectorAll("details > summary")) {
    if (form.open.has(x.textContent)) x.parentElement.open = true;
  }
  restoreScroll(app, form);
}

function restoreScroll(app, form) {
  const body = app.querySelector(".drawer-body");
  if (body) body.scrollTop = form.scroll;
  for (const l of app.querySelectorAll(".chat-log")) {
    l.scrollTop = form.logs[l.id] ?? l.scrollHeight;
  }
}

// Remembers which control opened a layer, and asks for it back when the layer closes. Returns true
// when a new layer just opened.
function trackLayer(top) {
  const layer = top[1];
  const key = layer ? layer.getAttribute("aria-labelledby") || layer.getAttribute("aria-label") : "";
  if (key && !openLayer) { opener = lastTrigger; lastTrigger = ""; }
  if (!key && openLayer && opener) { wantFocus = { key: opener, force: true }; opener = ""; }
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
  try { return ui.newChat ? [scrim(() => ui.newChat = false), newChatDialog()] : buildLayers(); }
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
  [() => ui.restore, closeBackup, () => restoreDialog()],
  [(open) => ui.backup && (open || ui.backup.personal), closeBackup, () => backupDialog()],
  [(open) => ui.send && open, endSend, () => sendDialog()],
  [(open) => ui.receive && open, () => ui.receive = false, () => receiveDialog()],
  [() => ui.create && !state.gid, endCreate, () => createDialog()],
  [() => ui.contactAdd && !!personal, () => ui.contactAdd = false, () => contactDialog()],
  [(open) => ui.move && open, endCreate, () => createDialog(state.g)],
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
// ponytail: an unchecked radio counts as a stop. That is wrong only when a radio group is the
// last control of a layer.
const STOPS = FOCUSABLE + ", [tabindex]";
// A control in a closed <details> has client rects in Chrome, so checkVisibility decides.
const shown = (n) => n.getClientRects().length > 0 && (n.checkVisibility?.() ?? true);
const isStop = (n) => !n.disabled && n.tabIndex >= 0 && shown(n);
const tabStops = (root) => [...root.querySelectorAll(STOPS)].filter(isStop);
// The stops of the layer, then the Close button of an open banner, which shows above the layer.
function loopStops(layer) {
  const banner = document.getElementById("banner");
  return [...tabStops(layer), ...(banner ? tabStops(banner) : [])];
}
// The stops of the layer before the focus, when the focus is on no stop. A focus outside the
// layer, or on the layer itself, has none before it.
function stopsBefore(layer) {
  const all = [...layer.querySelectorAll(STOPS)], at = all.indexOf(document.activeElement);
  return at < 0 ? 0 : all.slice(0, at).filter(isStop).length;
}
// Where Tab goes when the browser must not move the focus: round from an edge stop (`at`), or on
// from a focus that is no stop (`at` -1). `back` is Shift+Tab.
function loopTarget(layer, stops, at, back) {
  const last = stops.length - 1;
  if (at >= 0) return stops[back ? last : 0];
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
  if (at >= 0 && (ev.shiftKey ? at > 0 : at < stops.length - 1)) return;
  ev.preventDefault();
  loopTarget(layer, stops, at, ev.shiftKey).focus();
}
document.addEventListener("keydown", layerTab);
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  if (state.sid) closeSession();
  else {
    endSend(); endCreate(); ui.receive = false; ui.newChat = false;
    ui.contactAdd = false;
    closeBackup();
  }
  render();
});
