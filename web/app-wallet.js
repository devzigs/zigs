// The wallet page: its sections (overview, activity, messages, signers, settings, Solana).
import { fmtInt, seatBackedUp, usesV2 } from "./util.js";
import { IGNORED_NOTE } from "./signed.js";
import { log, ready, state, ui } from "./app-state.js";
import { fmtZec, short, when } from "./app-kit.js";
import { gkeys, mySeatSecrets, sec } from "./app-keystore.js";
import { keysDiffer, localSeats, seatIds, seatMine, seatStage, STAGE_LABEL } from "./app-seats.js";
import { inviteLink, senderNote } from "./app-links.js";
import {
  addrHidden, atCap, balanceNow, capText, chain, curChain, curNet, inFlight, netName, readsMemos,
  runSync, setMemoReading, spanMs,
} from "./app-chain.js";
import { canWriteAs, signedMode } from "./app-filter.js";
import { needsMyApproval, openGroup, openSession, toApprove } from "./app-groups.js";
import {
  act, addrGroups, avatar, copyBtn, countBadge, el, groupName, guard, leavesOf, memoTexts, money,
  named, netBadge, payTitle, proposer, ruleText, seatTitle, secretQr, statusChip, unreadable,
} from "./app-dom.js";
import { signing, unreadIn } from "./app-messages.js";
import { groupVersion, rejectedSeats, seatCheck, verifiedCount } from "./app-dkg.js";
import {
  cancelMove, chainReady, ended, expired, heldApprovals, isOpen, landed, proposeMove, sendBlocker,
  signingSeen,
} from "./app-payments.js";
import { finishStep, refusedSend } from "./app-drawer.js";
import { BUCKETS, bucketOf, emptyState, solLine } from "./approvals-model.js";
import { messagesCard, notifyButton } from "./app-thread.js";
import { openBackup, staleRestoreNote } from "./app-backups.js";
import { loadingView } from "./app-shell.js";
import { render } from "./app-loop.js";
import { openSend } from "./app-send.js";
import { setupView, solSetupCard, solUnfinished } from "./app-setup.js";
import { themeChoice } from "./app-theme.js";
import { helpView } from "./app-help.js";
import {
  sol, solActivity, solBackup, solBalance, solError, solFile, solLoad, solLoading,
  solLoadingCount, solOlderCount, solOn, solPending, solPendingRows, solSetup, solSync, solTab,
  solUnsaved,
} from "./app-sol.js";
import { pendingShortcut, solRow, zecInProgress, zecTotal } from "./overview-model.js";
import { protectionRisk, recoveryState } from "./recovery-model.js";
import { icon } from "./app-icons.js";

export function groupView() {
  const g = state.g;
  const back = el("button", {
    class: "btn ghost sm", type: "button", onclick: () => openGroup(null),
  }, "← Wallets");
  if (!g) return el("div", { class: "page" }, back, loadingView());
  if (g.unreadable) {
    return el("div", { class: "page" }, back, el("div", { class: "card" }, unreadable()));
  }
  if (!groupVersion()) {
    return el("div", { class: "page" }, back, el("div", { class: "callout bad", role: "alert" },
      "A newer version of Zigs made this wallet. This version cannot set it up. Reload the page "
      + "to get the newest version."));
  }
  if (signedMode(state.gid) && signing === false) {
    return el("div", { class: "page" }, back, el("div", { class: "callout bad", role: "alert" },
      NO_SIGNING_WALLET));
  }
  const ready = walletReady();
  const why = ready ? sendBlocker() : null;
  const head = [groupHead(g, ready, why), staleRestoreNote(), signedNotes(), networkNote()];
  return ready ? walletView(head, why) : el("div", { class: "page" }, head, setupView());
}

/** True when groupView shows the formed wallet: its sections then appear in the side menu. */
export const walletShown = () => !!state.g && !state.g.unreadable && !!groupVersion()
  && !(signedMode(state.gid) && signing === false) && walletReady();

// A note for any wallet version: the store shows another network than the first this device saw.
const networkNote = () => state.g.networkMoved ? el("div", { class: "callout bad", role: "alert" },
  "The store shows another network than the first this browser saw. Zigs keeps the first. "
  + "Ask the other people who use this wallet.") : null;

const NO_SIGNING_WALLET = "This wallet needs signatures, and this browser cannot check them. "
  + "Use a current Chrome, Edge, Firefox or Safari.";

// Notes for a version 3 wallet: a seat of this browser that cannot sign, and ignored data.
function signedNotes() {
  if (!signedMode(state.gid)) return null;
  const mute = localSeats().filter((i) => !canWriteAs(i));
  const lost = mute.length ? el("div", { class: "callout bad", role: "alert" },
    "This browser has no signing key for device " + mute.join(", ") + ", so it cannot write to "
    + "this wallet. Restore the backup file of that device.") : null;
  const moved = state.g.shapeMoved ? el("div", { class: "callout bad", role: "alert" },
    "The store shows another number of devices or approval rule than the first this browser "
    + "saw. Zigs keeps the first. Ask the other people who use this wallet.") : null;
  const ignored = state.ignored ? el("p", { class: "small faint" }, IGNORED_NOTE) : null;
  return lost || moved || ignored
    ? el("div", { style: "display:grid;gap:8px" }, lost, moved, ignored) : null;
}

// A person's stop keeps the setup page, also when a wallet document came. Another abort (an
// unsigned group document can trigger one) must not take the wallet from a device with a share.
export const walletReady = () => !!(state.wallet && state.wallet.birthday)
  && rejectedSeats().length === 0 && !keysDiffer()
  && !mySeatSecrets(state.gid).some(([, s]) => s.stopped);

/**
 * The sections of the open wallet: [id, label, count] each. The side menu lists them; the Solana
 * section exists only while the Solana part is on.
 */
export function walletSections() {
  const sections = [
    ["overview", "Overview"],
    ["approvals", "Approvals",
      countBadge(toApprove(state.gid).length + solPending(), "to approve", "attn")],
    ["activity", "Activity"],
    ["messages", "Messages", countBadge(unreadIn(state.gid), "unread", "note")],
    ["members", "Devices"], ["recovery", "Recovery"], ["settings", "Settings"],
  ];
  if (solOn()) sections.push(["solana", "Solana", countBadge(solPending(), "to approve", "attn")]);
  return sections;
}

/** The section that the page shows: ui.tab when the wallet has it, else Overview. */
export function currentSection(sections) {
  if (!sections.some(([id]) => id === ui.tab)) ui.tab = "overview";
  return sections.find(([id]) => id === ui.tab);
}

const BODIES = {
  overview: () => overviewTab(), approvals: () => approvalsTab(), activity: () => activityTab(),
  messages: () => messagesCard(false),
  members: () => membersTab(), recovery: () => recoveryTab(), settings: () => settingsTab(),
  solana: () => solTab(),
};

// The small line above the title of a section; the others read "This wallet".
const LEAD = { settings: "Wallet and app preferences", solana: "Solana Devnet" };
const pageHeading = (id, label) => el("div", { class: "page-heading" },
  el("span", { class: "label" }, LEAD[id] ?? "This wallet"), el("h2", {}, label));

export function walletView(head, why) {
  const unsaved = localSeats().filter((i) => {
    const s = sec(state.gid, i);
    return s.keyPackage && !seatBackedUp(s);
  });
  const solSeats = solUnsaved();
  const [id, label] = currentSection(walletSections());
  return el("div", { class: "page" }, head,
    unsaved.length || solSeats.length
      ? backupNote(unsaved, solSeats, !unsaved.length && solUnfinished()) : null,
    el("section", { id: "panel-" + id, "data-key": "panel-" + id, tabindex: "-1",
      "aria-label": label, class: "panel" }, pageHeading(id, label), BODIES[id]()),
    el("div", { class: "action-bar" }, ...walletActions(why)));
}

function groupHead(g, ready, why) {
  const seated = seatIds().filter((i) => state.seats[i]).length;
  const old = state.groups.find((x) => x.id === g.movedFrom);
  return el("header", { class: "page-head" },
    el("div", { class: "ph-left" },
      el("button", { class: "btn ghost sm back", type: "button", onclick: () => openGroup(null) },
        "← Wallets"),
      walletTitle(g),
      el("div", { class: "ph-meta" },
        netBadge(g),
        el("span", { class: "badge plain", title: ruleText(g.t, g.n) },
          "Any " + g.t + " of " + g.n + " devices"),
        el("span", { class: "stack" }, seatIds().map((i) => avatar(i))),
        el("span", {}, seated + " of " + g.n + " devices joined"),
        g.movedFrom
          ? el("span", {}, "Replaces " + ((old || {}).name || "an older wallet")) : null)),
    ready ? el("div", { class: "ph-actions wallet-actions" }, ...walletActions(why)) : null);
}


// With more than one wallet, a select switches between them: a phone needs no trip to the list.
function walletTitle(g) {
  if (state.groups.length < 2) return el("h1", {}, g.name);
  const pick = (ev) => { ui.tab = "overview"; openGroup(ev.target.value); };
  return el("div", { class: "wallet-switcher" }, el("h1", { class: "sr-only" }, g.name),
    el("select", { class: "input wallet-select", "aria-label": "Switch wallet", onchange: pick },
      state.groups.map((x) => el("option", { value: x.id, selected: x.id === g.id }, x.name))));
}

// Private windows, Tor Browser and cleared site data delete the key share with the browser data.
// `solSeats`: the seats whose Solana part has no saved file yet (solUnsaved, app-sol.js).
// A note for the Solana file alone is plain while the Solana part still sets up; the amber one
// comes after the setup. A Zcash file that is not saved is always amber.
export function backupNote(seats, solSeats = [], settling = false) {
  const first = seats.length ? "Back up your key share."
    : "Back up the Solana part of your key share.";
  const text = first + " This browser can forget it: private windows and Tor "
    + "Browser delete it when they close. The file is locked with a passphrase that you choose. "
    + "Keep the file safe, and keep the passphrase apart from it."
    + (solSeats.length ? " " + SOL_FILE : "");
  const many = seats.length + solSeats.length > 1;
  return el("div", { class: settling ? "callout" : "callout warn", role: "status" },
    el("span", { style: "flex:1 1 16rem" }, text),
    seats.map((i) => el("button", {
      class: "btn sm", type: "button", onclick: () => openBackup(i),
    }, many ? "Back up seat " + i : "Back up key share")),
    solSeats.map((i) => el("button", {
      class: "btn sm", type: "button", onclick: act(() => solBackup(i)),
    }, "Back up Solana, seat " + i)));
}
const SOL_FILE = "The Solana part of a seat is a second file, with its own passphrase.";

// `why` is the reason Send is off, shown as text because touch screens have no tooltip.
function walletActions(why) {
  return [
    el("button", {
      class: "btn", type: "button", onclick: () => { ui.receive = true; render(); },
    }, icon("receive"), "Receive"),
    el("button", {
      class: "btn primary", type: "button", disabled: !!why, title: why,
      onclick: () => {
        openSend({ pay: null, note: "", priority: false, sendFor: null, after: null });
        render();
      },
    }, icon("send"), "Send"),
    why ? el("p", { class: "send-why" }, why) : null,
  ];
}

function overviewTab() {
  const c = curChain(), list = activity(), pend = toApprove(state.gid);
  return el("div", { class: "page", style: "gap:16px" },
    state.g.movedTo ? moveCard(c) : null,
    pendingCard(),
    pend.length ? approvalsCard(pend) : null,
    solUnfinished() ? solSetupCard() : null,
    el("div", { class: "assets-grid" }, zecAsset(c), solAsset()),
    el("div", { class: "grid-ov" }, receiveCard(), signersCard()),
    el("section", { class: "card" },
      el("div", { class: "card-head card-pad", style: "padding-bottom:12px" }, el("h3", {}, "Activity"),
        list.length > 6 ? el("button", { class: "btn ghost sm", type: "button", onclick: () => { ui.tab = "activity"; render(); } }, "View all") : null),
      activityRows(list.slice(0, 6))));
}

// The steps of a move, read from the old wallet: new wallet ready, payment proposed, funds gone.
export function moveState(c) {
  const to = state.g.movedTo;
  const ss = state.sessions.find((x) => x.move === to && !x.error && !ended(x));
  const b = c && c.bal ? balanceNow(c.bal) : null;
  if (!gkeys[to]) {
    return { text: "Someone started moving this wallet to a new one. If one of your devices is "
      + "in the new wallet, ask its creator for its invite link." };
  }
  if (!ready[to]) return { text: groupName(to) + " is still setting up. When its address is ready, move the funds here.", open: to };
  if (ss && !ss.broadcastTxid) return { text: "Moving the funds to " + groupName(to) + " is in progress. Open the payment to approve it or take the next step.", session: ss };
  if (ss && inFlight().includes(ss)) return { text: "The funds are on their way to " + groupName(to) + ". They arrive with the next block.", open: to };
  if (ss && b && b.spendable + b.pending === 0) return { text: "All funds moved to " + groupName(to) + ". This wallet is closed.", open: to, done: true };
  return { text: groupName(to) + " is ready. Move all funds to it. Like any payment, this needs " + state.g.t + " approvals.", propose: true };
}

function moveCard(c) {
  const m = moveState(c), why = m.propose ? sendBlocker() : null;
  const started = state.sessions.some((x) => x.move === state.g.movedTo && !x.error && !ended(x));
  return el("section", { class: "card card-pad " + (m.done ? "" : "attention") },
    el("div", { class: "card-head" }, el("h3", {}, m.done ? "This wallet moved" : "Changing devices"),
      m.done ? el("span", { class: "badge plain" }, "Closed") : null),
    el("p", { class: "small muted" }, m.text),
    el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" },
      m.propose ? el("button", { class: "btn primary", type: "button", disabled: !!why, title: why, onclick: act(() => proposeMove()) }, "Move " + fmtZec(c && c.bal ? c.bal.max_send : 0)) : null,
      m.session ? el("button", { class: "btn primary", type: "button", onclick: () => openSession(m.session.id) }, "Open the payment") : null,
      m.open ? el("button", { class: "btn", type: "button", onclick: () => { ui.tab = "overview"; openGroup(m.open); } }, "Open " + groupName(m.open)) : null,
      !started ? el("button", { class: "btn ghost", type: "button", onclick: act(cancelMove) }, "Cancel move") : null),
    why ? el("p", { class: "small faint" }, why) : null);
}

function signersCard() {
  return el("section", { class: "card card-pad" },
    el("div", { class: "card-head" }, el("h3", {}, "Devices"),
      el("button", { class: "btn ghost sm", type: "button", onclick: () => { ui.tab = "members"; render(); } }, "Manage")),
    el("p", { class: "small muted" }, ruleText(state.g.t, state.g.n)),
    el("div", { class: "signer-list" }, seatIds().map((i) => el("span", { class: "signer" },
      avatar(i), el("span", { class: "small" }, named(i))))));
}

function approvalsCard(list) {
  return el("section", { class: "card attention" },
    el("div", { class: "card-head card-pad", style: "padding-bottom:12px" },
      el("h3", {}, list.length === 1 ? "A payment needs your approval" : list.length + " payments need your approval")),
    el("div", { class: "list stacked" }, list.map((ss) => guard(approvalRow, ss))));
}

function approvalRow(ss) {
  return el("button", {
    class: "row-item", type: "button", "data-key": "pay-approve-" + ss.id,
    onclick: () => openSession(ss.id),
  },
  el("span", { class: "tx-ico out", "aria-hidden": "true" }, "↗"),
  el("span", { class: "ri-main" }, el("span", { class: "ri-title" }, payTitle(ss)),
    el("span", { class: "ri-sub" }, "Zcash " + curNet().label + " · Proposed by " + proposer(ss)
      + " · " + when(ss.createdAt))),
  el("span", { class: "ri-end" }, money(leavesOf(ss), "md", "out")),
  el("span", { class: "btn sm primary", "aria-hidden": "true" }, "Review"));
}

// The shortcut to the payments in progress. It counts each ZEC payment once: open, waiting for
// its block, or held by an approval here (S7). For Solana it counts the proposals that a seat of
// this browser can approve.
function pendingCard() {
  const zec = zecInProgress(state.sessions.filter(isOpen).map((ss) => ss.id),
    inFlight().map((ss) => ss.id), heldApprovals());
  const p = pendingShortcut({ zec, sol: solOn() ? solPending() : 0 });
  if (!p) return null;
  return el("section", { class: "callout pending-shortcut", role: "status" }, icon("activity"),
    el("span", {}, p.text),
    el("button", { class: "btn sm", type: "button",
      onclick: () => { ui.tab = "approvals"; render(); } }, "Review"));
}

const assetHead = (id, symbol, network) => el("div", { class: "asset-title" },
  el("span", { class: "coin-mark" }, icon(id)),
  el("div", {}, el("h3", { id: "asset-" + id }, symbol), el("p", {}, network)));

function zecAsset(c) {
  const b = c && c.bal ? balanceNow(c.bal) : null;
  const part = (label, zat) => el("div", {}, el("span", { class: "label" }, label),
    b ? money(zat) : el("span", { class: "skel" }));
  return el("section", { class: "card card-pad asset-card", "aria-labelledby": "asset-zec" },
    assetHead("zec", "ZEC", "Zcash " + netName(state.g)),
    b ? money(zecTotal(b), "xl")
      : el("span", { class: "skel xl", role: "img", "aria-label": "Loading balance" }),
    el("div", { class: "stats" }, part("Available", b?.spendable), part("Incoming", b?.pending)),
    b?.sending ? sendingLine(b.sending) : null, emptyNote(b), atCap() ? capNote() : null,
    syncLine(c));
}

const sendingLine = (zat) => el("div", { class: "sending" }, el("span", { class: "dot busy" }),
  "Sending ", money(zat, "md", "out"), el("span", { class: "faint" }, " · waiting for a block"));

function emptyNote(b) {
  if (!b || b.spendable + b.pending + b.sending !== 0 || state.g.movedTo) return null;
  return el("div", { class: "callout" }, curNet().faucet
    ? el("span", {}, "This wallet is empty. Share its address to receive ZEC, or get free "
      + "testnet ZEC from a ", el("a", { href: curNet().faucet, target: "_blank",
      rel: "noopener" }, "faucet ↗"), ".")
    : el("span", {}, "This wallet is empty. Share its address to receive ZEC. Keep it under "
      + capText(curNet().cap) + ": the app warns at that level. It cannot block deposits."));
}
const SOL_NOTE = {
  synced: "The private balance of the group at the last sync. Open Solana for payments, deposits "
    + "and the fee addresses.",
  saved: "The private balance of the group at the last saved sync. Open Solana to sync again.",
  stale: "The last sync failed. This balance comes from an earlier sync. Open Solana to sync "
    + "again.",
  syncing: "The private balance of the group is syncing.",
  resync: "A sync runs. This balance comes from an earlier sync.",
  unsynced: "Open Solana to sync the private balance.",
  setup: "The Solana part of this wallet is still setting up.",
  stopped: "The Solana part stopped. The Zcash part still works.",
  loading: "The Solana part loads.",
  idle: "Open Solana to load the Solana part of this wallet.",
  none: "This wallet has no Solana part yet. Open Solana to add it.",
  unavailable: "This wallet cannot have a Solana part. Open Solana to see why.",
  differs: "The devices do not agree on one Solana key. Do not use the Solana part. Open Solana for "
    + "the details.",
  unknown: "Open Solana to see the state of its part.",
};

// The SOL row: the private balance of the last sync, or the state of the Solana part.
function solAsset() {
  const row = solRow({ on: solOn(), error: solError, loading: !!(sol || solLoading),
    setup: solSetup(), balance: solBalance(), sync: solSync() });
  if (!row) return null;
  const amount = /^[\d.]+ SOL$/.test(row.text) ? solAmount(row.text)
    : el("p", { class: "asset-balance unknown" }, row.text);
  return el("section", { class: "card card-pad asset-card", "aria-labelledby": "asset-sol" },
    assetHead("sol", "SOL", "Solana Devnet"), amount,
    el("p", { class: "small muted" }, row.state === "failed" ? solError : SOL_NOTE[row.state]),
    el("div", { class: "row-actions" }, el("button", { class: "btn", type: "button",
      onclick: () => { ui.tab = "solana"; render(); } }, "Open Solana")));
}

// An exact SOL text ("0.0025 SOL") in the size of the ZEC amount, with the unit and the sign as
// money() shows them.
const SIGNS = { out: "−", in: "+" };
function solAmount(text, size = "xl", sign = "") {
  const shown = (SIGNS[sign] ?? "") + text.slice(0, -4);
  return el("span", { class: "money " + size + (sign ? " " + sign : ""), role: "img",
    "aria-label": shown + " SOL" }, shown, el("span", { class: "cur" }, "SOL"));
}

export const capNote = () => el("div", { class: "callout bad" },
  "This wallet holds " + capText(curNet().cap) + ", the warning level for unaudited mainnet "
  + "wallets. Do not send more to it. The app cannot block deposits. Payments out still work.");

export const receiveWhat = () => curNet().cap ? "ZEC" : "testnet ZEC";
export const receiveLimit = () => curNet().cap ? " Keep the total under " + capText(curNet().cap)
  + ". The app warns at that level and cannot block deposits." : "";

/** The note of a wallet that moved: its senders must use the address of the new wallet. */
export const movedNote = () => el("div", { class: "callout" }, "This wallet moved to "
  + groupName(state.g.movedTo) + ". Ask senders to use the new wallet's address.");

function receiveCard() {
  const w = state.wallet;
  return el("section", { class: "card card-pad" },
    el("div", { class: "card-head" }, el("h3", {}, "Receive"), el("span", { class: "badge ok plain" }, "Private address")),
    state.g.movedTo ? movedNote()
      : atCap() ? capNote()
      : el("p", { class: "small muted" }, "Share this address to receive " + receiveWhat()
        + ". Payments to it are shielded." + receiveLimit()),
    addrHidden() ? null : el("div", { class: "addr-box" }, el("span", { class: "hex" }, short(w.address, 18)), copyBtn(w.address)),
    el("p", { class: "small faint" }, verifiedCount() + " of " + state.g.n + " devices checked "
      + "this address against their own key."));
}

export function syncLine(c) {
  if (!c) return el("div", { class: "sync" }, el("span", {}, el("span", { class: "dot" }), "Sync starts after this device checks the address."));
  const p = c.prog || c.bal;
  const span = p ? p.tip - c.birthday : 0;
  const pct = span > 0 ? Math.max(0, Math.min(100, ((p.height - c.birthday) / span) * 100)) : 0;
  const text = c.error ? "Sync failed" : c.syncing ? (c.prog ? "Syncing · " + Math.floor(pct) + "%" : "Connecting to the network…") : p ? "Up to date · block " + p.height.toLocaleString() : "Not synced";
  return el("div", { style: "display:grid;gap:8px" },
    c.syncing && c.prog ? el("div", { class: "progress" }, el("i", { style: "width:" + pct.toFixed(1) + "%" })) : null,
    el("div", { class: "sync" },
      el("span", {}, el("span", { class: "dot " + (c.error ? "bad" : c.syncing ? "busy" : "ok") }), text),
      el("button", { class: "btn ghost sm", type: "button", disabled: c.syncing, onclick: act(() => runSync(c)) }, c.syncing ? "Syncing…" : "Refresh")),
    c.error ? el("div", { class: "callout bad" }, c.error) : null);
}

// Zcash and Solana rows in one list, newest first. Received ZEC carries only a block height;
// estimate a time so it sorts among proposals.
function activity() {
  const c = curChain(), tip = c && c.bal ? c.bal.height : 0;
  const sent = state.sessions.map((ss) => ({ t: ss.createdAt || 0, ss }));
  const net = netName(state.g);
  const got = (c && c.received || [])
    .map((r) => ({ t: Date.now() - spanMs(net, r.height, tip), r }));
  const onSol = (solPart() ? solActivity() ?? [] : []).map((r) => ({ t: r.t, sol: r }));
  return [...sent, ...got, ...onSol].sort((a, b) => b.t - a.t);
}

// The empty text of each choice: "none" is a wallet with no Solana part.
const DEVICES = "payments that the devices of this wallet propose";
const EMPTY = {
  none: "Money you receive and " + DEVICES + " show up here.",
  all: "ZEC you receive and " + DEVICES + " show up here.",
  zec: "ZEC you receive and Zcash " + DEVICES + " show up here.",
  sol: "Solana " + DEVICES + " show up here.",
};

// The history of the Zcash side: "failed" after a failed sync, "syncing" before a sync finished.
function historyState() {
  const c = curChain();
  if (c?.error) return "failed";
  return chainReady(c) ? "ready" : "syncing";
}
const HISTORY = {
  syncing: ["Reading the chain", "Payments you received show after the first sync."],
  failed: ["The sync failed", "This list can be incomplete. Use Refresh in the ZEC card on the "
    + "Overview."],
};
const SOL_READING = ["Reading the Solana transactions",
  "Solana payments of this wallet show after the first read."];
// The Solana rows of a wallet with a Solana part are not read yet.
const solReading = (pick) => pick !== "zec" && solPart() && solActivity() === null;
// The heading and the text of an empty list. Only a finished read can say that nothing is there.
function emptyText(pick) {
  const state = pick === "sol" ? "ready" : historyState();
  if (state !== "ready") return HISTORY[state];
  if (solReading(pick)) return SOL_READING;
  return ["No activity yet", EMPTY[pick === "all" && !solPart() ? "none" : pick]];
}
// Rows next to a history that is not read or not complete: the list may lack received payments.
const historyNote = (pick) => {
  const state = pick === "sol" ? "ready" : historyState();
  return state === "ready" ? null : noteRow(HISTORY[state].join(". "));
};

// `line` is the rule above the rows: the card of the Activity section has no head to separate.
function activityRows(list, pick = "all", line = "border-top:1px solid var(--line)") {
  if (!list.length) {
    const [head, text] = emptyText(pick);
    return el("div", { class: "empty", style: line }, el("h3", {}, head),
      el("p", { class: "small" }, text));
  }
  // One list of sent payments for the whole draw: a row does not walk all sessions again.
  const flying = new Set(inFlight());
  return el("div", { class: "list stacked", style: line }, list.map((a) => rowOf(a, flying)));
}

function rowOf(a, flying) {
  if (a.ss) return guard(sentRow, a.ss, flying);
  return a.sol ? guard(solActivityRow, a.sol) : guard(receivedRow, a.r);
}

// The Solana part is there while it sets up or is ready. A stopped part, or one with keys that
// differ, shows no rows and no select (activityNote says why).
const solPart = () => ["running", "ready"].includes(solSetup()?.status);
const CHAIN_FILTERS = [["all", "All"], ["zec", "Zcash"], ["sol", "Solana"]];
const KEEP = { all: () => true, zec: (a) => !a.sol, sol: (a) => !!a.sol };
// A wallet with no Solana part shows its Zcash rows, whatever ui.chainFilter says.
const chainPick = () => (solPart() && KEEP[ui.chainFilter] ? ui.chainFilter : "all");

const chooseChain = (ev) => { ui.chainFilter = ev.target.value; render(); };
const chainSelect = (pick) => el("label", { class: "field activity-filter" },
  el("span", {}, "Show activity for"),
  el("select", { class: "input", onchange: chooseChain },
    CHAIN_FILTERS.map(([value, label]) =>
      el("option", { value, selected: pick === value }, label))));

const SOL_ACTIVITY_NOTE = "The Solana rows show the payments of this wallet. They also show the "
  + "last SOL that you added, until you leave this wallet or reload the page. SOL that other "
  + "people send to the wallet does not show here.";
// The page knows two causes for keys that differ: the devices published other keys, or the key
// share or PDA identity of this device does not fit the published ones.
const SOL_LOST = {
  stopped: "The Solana part stopped, so its payments do not show here.",
  differs: "The Solana keys of this wallet differ, or do not fit this browser, so its payments "
    + "do not show here. Open Solana to see why.",
  running: "The Solana part is not ready yet, so its payments do not show here.",
};
const noteRow = (text) => el("p", { class: "row-note" }, text);
// What the list cannot show: Solana that did not load, stopped or is not read yet, and Solana that
// this page never knows (a deposit by another person).
function solNoteText() {
  if (solOn() && solError) return "Solana did not load, so its transactions are not shown here.";
  const status = solSetup()?.status;
  if (!solPart() || status === "running") return SOL_LOST[status];
  if (solActivity() === null) return "Reading the Solana transactions…";
  return SOL_ACTIVITY_NOTE
    + (solOlderCount() > 0 ? " Older Solana proposals are not listed." : "");
}
function activityNote(pick) {
  const text = pick === "zec" ? null : solNoteText();
  return text ? noteRow(text) : null;
}

function sentRow(ss, flying) {
  const chip = needsMyApproval(state.gid, ss) ? el("span", { class: "badge warn" }, "Your approval")
    : flying.has(ss) ? el("span", { class: "badge info" }, "Confirming") : statusChip(ss);
  return el("button", {
    class: "row-item", type: "button", "data-key": "pay-" + ss.id,
    "aria-current": ss.id === state.sid ? "true" : "false", onclick: () => openSession(ss.id),
  },
  el("span", { class: "tx-ico out", "aria-hidden": "true" }, "↗"),
  el("span", { class: "ri-main" }, el("span", { class: "ri-title" }, payTitle(ss)),
    el("span", { class: "ri-sub" }, "Zcash " + curNet().label + " · Proposed by " + proposer(ss)
      + " · " + when(ss.createdAt))),
  el("span", { class: "ri-end" }, money(leavesOf(ss), "md", "out"), chip),
  el("span", { class: "chev" }, "›"));
}

const SOL_ICONS = { out: "↗", in: "↙", "": "↔" };
// A Solana row opens the Solana section, which holds its proposal, as solInboxRow does. An Add
// SOL row reads like a received ZEC row: the chain and the slot, then who added it.
function solActivityRow(r) {
  const time = r.t ? " · " + when(r.t) : "", who = proposer({ by: r.by });
  const slot = r.slot ? " · slot\u00a0" + Number(r.slot).toLocaleString() : "";
  const subs = r.added ? ["Solana Devnet" + slot, r.added + " by " + who + time]
    : ["Solana Devnet · Proposed by " + who + time];
  return el("button", {
    class: "row-item", type: "button", "data-key": "sol-act-" + r.id, onclick: openSolana,
  },
  el("span", { class: "tx-ico " + (r.sign || "out"), "aria-hidden": "true" }, SOL_ICONS[r.sign]),
  el("span", { class: "ri-main" }, el("span", { class: "ri-title" }, r.title),
    subs.map((text) => el("span", { class: "ri-sub" }, text))),
  el("span", { class: "ri-end" }, r.amount ? solAmount(r.amount, "md", r.sign) : null,
    el("span", { class: "badge " + r.tone }, r.word)),
  el("span", { class: "chev" }, "›"));
}

// The memos of a received payment, for display. A memo that is not text says so.
export const ON_CHAIN = "On chain · shared with all devices";

function receivedRow(r) {
  const memos = memoTexts(r);
  return el("a", { class: "row-item", href: curNet().explorer + r.txid, target: "_blank", rel: "noopener", title: "View in explorer" },
    el("span", { class: "tx-ico in", "aria-hidden": "true" }, "↙"),
    el("span", { class: "ri-main" },
      el("span", { class: "ri-title" }, "Received ZEC"),
      el("span", { class: "ri-sub" }, "Zcash " + curNet().label + " · block\u00a0"
        + r.height.toLocaleString()),
      memos.map((m) => el("span", { class: "ri-memo" + (m === null ? " faint" : "") },
        m === null ? "Memo is not text" : m)),
      memos.length ? el("span", { class: "ri-sub" }, ON_CHAIN) : null,
      r.memo_pending && readsMemos(state.gid)
        ? el("span", { class: "ri-sub" }, "Memo not read yet") : null),
    el("span", { class: "ri-end" }, money(r.value, "md", "in"), el("span", { class: "badge " + (r.confirmed ? "ok" : "info") }, r.confirmed ? "Confirmed" : "Confirming")),
    el("span", { class: "chev" }, "↗"));
}

// The Approvals inbox: the payments that wait for this browser, for the other signers or for the
// network, and those that need attention, then one line for the Solana part. A row opens its
// payment; the drawer keeps every action. Empty buckets do not show.
function approvalsTab() {
  const rows = inboxRows(), sol = solInbox(), flying = new Set(inFlight());
  const sections = BUCKETS.map(([id, label]) => {
    const list = rows[id], extra = solExtra(sol, id);
    const lost = id === "attention" ? lostNote(rows.lost) : null;
    if (!list.length && !extra && !lost) return null;
    const count = list.length + (Array.isArray(extra) ? extra.length : extra ? 1 : 0)
      + (lost ? rows.lost.length : 0);
    return el("section", { class: "card inbox", "aria-label": label },
      el("div", { class: "card-head card-pad" }, el("h3", {}, label),
        el("span", { class: "badge plain" }, String(count))),
      el("div", { class: "list stacked" }, list.map((ss) => guard(sentRow, ss, flying)), extra,
        lost));
  }).filter(Boolean);
  const other = sol && !["review", "attention"].includes(sol.kind)
    ? el("p", { class: "small muted row-actions" }, sol.text, " ", openSolanaButton()) : null;
  return el("div", { class: "page", style: "gap:16px" },
    el("p", { class: "small muted" }, "Open a payment to approve, sign or send it. A payment "
      + "needs " + state.g.t + " of " + state.g.n + " signers."),
    inboxNote(sections.length > 0), ...sections, other);
}

// Approvals that hold Send although the list has no record of their payment: the Overview counts
// them, so the inbox names them.
const lostNote = (ids) => ids.length ? el("p", { class: "row-note" }, ids.length === 1
  ? "A payment that you approved has no record here any more. Send stays held until it can no "
    + "longer go on chain."
  : ids.length + " payments that you approved have no record here any more. Send stays held "
    + "until they can no longer go on chain.") : null;

const openSolana = () => { ui.tab = "solana"; render(); };
const openSolanaButton = () => el("button", { class: "btn sm", type: "button",
  onclick: openSolana }, "Open Solana");

// The Solana part of a bucket: in review, one row for each proposal that waits for this browser
// (the rule of the count); else, or while the list is empty, the one line of solLine. A row opens
// the Solana section, which holds the Approve buttons, as a Zcash row opens its drawer.
function solExtra(line, id) {
  if (!line || line.kind !== id) return null;
  const list = id === "review" ? solPendingRows() : [];
  return list.length ? list.map(solInboxRow)
    : el("p", { class: "row-note" }, line.text, " ", openSolanaButton());
}
const solInboxRow = (r) => el("button", {
  class: "row-item", type: "button", "data-key": "sol-" + r.id, onclick: openSolana,
},
el("span", { class: "tx-ico out", "aria-hidden": "true" }, "↗"),
el("span", { class: "ri-main" }, el("span", { class: "ri-title" }, r.title),
  el("span", { class: "ri-sub" }, "Solana Devnet · Proposed by " + proposer({ by: r.by }))),
el("span", { class: "ri-end" }, el("span", { class: "badge warn" }, "Your approval")),
el("span", { class: "chev" }, "›"));

// The payments of the open wallet by bucket. A payment whose facts cannot be read lands in
// "attention", never out of the list. `lost`: the ids of approvals here that still hold Send
// while the list has no record of their payment (dropped or rewritten). Only a list that arrived
// and passed its checks can lack a record.
export function inboxRows() {
  const held = new Set(heldApprovals());
  const rows = Object.fromEntries(BUCKETS.map(([id]) => [id, []]));
  for (const ss of state.sessions) {
    const b = inboxBucket(ss, held);
    if (b) rows[b].push(ss);
  }
  const listed = new Set(state.sessions.map((ss) => ss.id));
  const known = state.sessionsLoaded && !state.sessionsFailed && !state.pending;
  return { ...rows, lost: known ? [...held].filter((id) => !listed.has(id)) : [] };
}

function inboxBucket(ss, held) {
  try {
    const end = ended(ss), step = finishStep(ss);
    return bucketOf({
      // In the Check state the drawer offers no step (nextAction): no row either.
      sendRefused: !end && !ss.error && !expired(ss) && refusedSend(ss, step),
      landed: landed(ss), held: held.has(ss.id),
      check: !end && signingSeen(ss) && expired(ss),
      review: needsMyApproval(state.gid, ss), step, ended: end,
      error: !!ss.error, status: ss.status,
    });
  } catch (e) {
    log("inbox: payment " + ss.id + " not sorted: " + (e && e.message ? e.message : e));
    return "attention";
  }
}

const solInbox = () => solLine({ on: solOn(), error: solError, loading: !!(sol || solLoading),
  setup: solSetup(), toApprove: solPending(), reading: solLoadingCount(),
  older: solOlderCount() });

const INBOX_EMPTY = {
  failed: "The payments of this wallet could not be read. Reload the page.",
  loading: "Checking the payments of this wallet…",
  syncing: "The wallet syncs. A payment that you approved and that someone cancelled shows after "
    + "the sync.",
  ignored: "No payment shows here. " + IGNORED_NOTE,
  zec: "No Zcash payment waits for this browser, the other signers or the network.",
  empty: "No payment waits for this browser, the other signers or the network.",
};
// What the inbox says about its own state. A failed read, a check that runs and a chain that
// syncs show also next to rows: the list may lack payments then. The rest shows only when no row
// does.
function inboxNote(rows) {
  const why = emptyState({ loaded: state.sessionsLoaded, failed: state.sessionsFailed,
    checking: state.pending, synced: chainReady(curChain()), ignored: state.ignored,
    sol: solOn() });
  if (why === "failed") return el("div", { class: "callout bad", role: "alert" }, INBOX_EMPTY[why]);
  const partial = ["loading", "syncing"].includes(why);
  if (rows && !partial) return null;
  return el(rows ? "p" : "div", { class: rows ? "small muted" : "card empty", role: "status" },
    INBOX_EMPTY[why]);
}

function activityTab() {
  const pick = chainPick(), list = activity().filter(KEEP[pick]);
  return el("section", { class: "card", style: "overflow:hidden" },
    solPart() ? el("div", { class: "card-head card-pad", style: "padding-bottom:12px" },
      chainSelect(pick)) : null,
    activityRows(list, pick, solPart() ? undefined : ""),
    list.length ? historyNote(pick) : null, activityNote(pick));
}

function membersTab() {
  return el("div", { class: "page", style: "gap:16px" },
    el("section", { class: "card" },
      el("div", { class: "card-pad", style: "padding-bottom:14px" },
        el("div", { class: "card-head" },
          el("span", { class: "small muted" }, ruleText(state.g.t, state.g.n)))),
      el("div", { style: "border-top:1px solid var(--line)" },
        seatIds().map((i) => guard(memberRow, i)))),
    changeSignersCard(),
    el("section", { class: "card card-pad" },
      el("h3", { style: "font-size:15px" }, "Invite link"),
      el("p", { class: "small muted" }, "To use a device of this wallet in another browser, open "
        + "this invite link there and restore the backup file of its key share. The link holds "
        + "the wallet secret, so share it only with the people who use this wallet. "
        + senderNote("each person who opens it")),
      el("div", { class: "addr-box" }, el("span", { class: "hex nowrap" }, inviteLink(state.gid)), copyBtn(inviteLink(state.gid), "Copy link")),
      secretQr(inviteLink(state.gid))));
}

// FROST fixes the signers when the key is made, so a change means a new wallet and one payment.
function changeSignersCard() {
  const moving = !!state.g.movedTo;
  return el("section", { class: "card card-pad" },
    el("h3", { style: "font-size:15px" }, "Add or remove devices"),
    el("p", { class: "small muted" }, "The devices and the approval rule are part of the wallet "
      + "key, so they cannot change in place. To change them, create a new wallet with the devices "
      + "you want, then move the funds to it."),
    el("div", {}, moving
      ? el("button", { class: "btn", type: "button", onclick: () => { ui.tab = "overview"; render(); } }, "See the move")
      : el("button", { class: "btn", type: "button", disabled: !localSeats().length, onclick: () => { ui.move = true; render(); } }, "Change devices")));
}

function seatBadge(i) {
  const v = seatCheck(i);
  if (v === null) return el("span", { class: "badge" }, STAGE_LABEL[seatStage(i)]);
  const text = v ? "Address checked" : "Rejected address";
  return el("span", { class: "badge " + (v ? "ok" : "bad") }, text);
}

const keyBackupButton = (i) => el("button", {
  class: "btn sm", type: "button", onclick: () => openBackup(i),
}, "Back up key share");

// The line under a device: its number, unless its title is "Device N" already, and when it joined.
function memberSub(i, s) {
  const joined = s ? "joined " + when(s.at) : "";
  if (seatTitle(i, s) !== "Device " + i) return "Device " + i + (joined && " · " + joined);
  return joined && "J" + joined.slice(1);
}

function memberRow(i) {
  const s = state.seats[i], mine = s && seatMine(i) && sec(state.gid, i);
  const title = el("span", { class: "ri-title" }, seatTitle(i, s),
    mine ? el("span", { class: "you" }, "You") : null);
  const sub = el("span", { class: "ri-sub" }, memberSub(i, s));
  const backup = mine && sec(state.gid, i).keyPackage ? keyBackupButton(i) : null;
  return el("div", { class: "member" }, avatar(i, "lg"), el("div", { class: "ri-main" }, title, sub),
    el("div", { class: "m-actions" }, seatBadge(i), backup));
}

// The Recovery section: the files of your seats in this wallet, the margin of the wallet, and
// what Zigs cannot know. A button opens the backup dialog of the seat.
function recoveryTab() {
  const seats = localSeats().map((i) => {
    const s = sec(state.gid, i) || {}, sol = solFile(i);
    return { id: i, zec: { has: !!s.keyPackage, saved: seatBackedUp(s), restored: !!s.restored },
      sol: sol && { has: !sol.unknown, ...sol } };
  });
  // The Solana part may not be read yet: the module loads here as in the Solana section.
  if (seats.some((x) => x.sol?.unknown && !x.sol.failed)) solLoad();
  const r = recoveryState(seats);
  const risk = protectionRisk(state.g.t, state.g.n, seats.filter((x) => x.zec.has).length);
  return el("div", { class: "page", style: "gap:16px" },
    el("section", { class: "card card-pad" + (r.state === "missing" ? " attention" : "") },
      el("div", { class: "card-head" }, el("h3", {}, r.label)),
      el("p", { class: "small muted" }, RECOVERY_LIMITS)),
    el("section", { class: "card card-pad" + (risk.here ? " attention" : "") },
      el("div", { class: "card-head" }, el("h3", {}, risk.title)),
      el("p", { class: "small muted" }, risk.detail),
      risk.here ? el("p", { class: "small" }, risk.here) : null),
    seats.some((x) => x.zec.has) ? el("section", { class: "card" },
      el("div", { class: "card-head card-pad" }, el("h3", {}, "Your seats in this wallet")),
      el("div", { class: "recovery-seats" },
        seats.filter((x) => x.zec.has).map((x) => guard(recoveryRow, x)))) : null,
    el("details", { class: "card card-pad recovery-lost" },
      el("summary", {}, "If a device is lost"),
      el("p", { class: "small muted" }, lostText(state.g.t, solOn()))));
}

const RECOVERY_LIMITS = "Zigs knows only the files that this browser saved. It cannot see the "
  + "files of the other devices: ask each signer to back up their seat. Zigs does not open a "
  + "saved file again: keep each file and its passphrase apart, and make sure that you can find "
  + "both. This section covers your seats in this wallet only: each other wallet has its own, "
  + "the personal account has its own backup file, and direct chats are in no backup file.";
const lostText = (t, sol) => "Keep the devices that still work, and do not delete their data. "
  + "While " + t + " devices remain, they can move the Zcash funds to a new wallet (Devices, "
  + "Change devices)" + (sol ? "; a Solana part does not move this way" : "") + ". With fewer, "
  + "first restore seats from their files. Zigs cannot go around the approval rule. A lost "
  + "device can still hold its key share, so move the funds when you can.";

// The badge of one file: saved here, restored from it, not saved, or a Solana part that this
// browser does not hold (a seat restored from its Zcash file alone).
function fileBadge(name, f) {
  if (f.unknown) return el("span", { class: "badge" }, name + (f.failed ? " part could not be read"
    : " part not read yet"));
  if (f.missing) return el("span", { class: "badge warn" }, name + " part missing");
  const said = !f.saved ? " file not saved" : f.restored ? " restored from its file"
    : " file saved here";
  return el("span", { class: "badge " + (f.saved ? "ok" : "warn") }, name + said);
}
const solAction = (x) => (x.sol.unknown ? null : x.sol.missing
  ? el("span", { class: "small" }, "Restore it from its Solana file in the Solana section.")
  : el("button", { class: "btn sm", type: "button", onclick: act(() => solBackup(x.id)),
    "aria-label": "Back up the Solana part of seat " + x.id }, "Back up the Solana part"));

function recoveryRow(x) {
  return el("div", { class: "member recovery-row" }, avatar(x.id, "lg"),
    el("div", { class: "ri-main" }, el("span", { class: "ri-title" }, seatTitle(x.id,
      state.seats[x.id])), el("span", { class: "ri-sub" }, "Seat " + x.id)),
    el("div", { class: "m-actions" }, fileBadge("Zcash", x.zec),
      x.sol ? fileBadge("Solana", x.sol) : null,
      el("button", { class: "btn sm", type: "button", onclick: () => openBackup(x.id),
        "aria-label": "Back up the Zcash part of seat " + x.id }, "Back up the Zcash part"),
      x.sol ? solAction(x) : null));
}

// A section of Settings: its title, then its controls.
const settingsCard = (title, ...kids) =>
  el("section", { class: "card card-pad settings-section" }, el("h3", {}, title), ...kids);

function settingsTab() {
  return el("div", { class: "page", style: "gap:16px" },
    settingsCard("This wallet", walletFacts()),
    settingsCard("This app on this device", appSettings()),
    settingsCard("Advanced", technicalDetails()),
    helpView());
}

function appSettings() {
  const host = chain && chain.url ? new URL(chain.url).host : "a light-wallet server";
  const notify = notifyButton();
  return [privacyText(host), appearanceChoice(), memoSwitch(host),
    notify ? el("div", { class: "setting" }, el("p", { class: "small muted" }, "A notification "
      + "tells you about a new message while Zigs is open in this browser. The setting is for "
      + "this browser."), notify) : null];
}

const appearanceChoice = () => el("div", { class: "setting" },
  el("p", { class: "small muted" }, "The appearance applies to this browser only. Device "
    + "setting follows the light or dark mode of this device."),
  themeChoice());

function checkedBadge() {
  const rejected = rejectedSeats(), ver = verifiedCount(), n = state.g.n;
  if (rejected.length) {
    const text = "Device " + rejected.join(", ") + " rejected this wallet";
    return el("span", { class: "badge bad" }, text);
  }
  return el("span", { class: "badge " + (ver === n ? "ok" : "") }, ver + " of " + n + " devices");
}

// The facts that a person reads. The ones that only support reads are in technicalFacts.
function walletFacts() {
  const w = state.wallet, net = curNet();
  const address = addrHidden()
    ? el("dd", {}, "Shown after this device checks it against its key share.")
    : el("dd", {}, el("div", { class: "addr-full" }, addrGroups(w.address)),
      el("div", { style: "margin-top:8px" }, copyBtn(w.address, "Copy address")));
  return [el("dl", { class: "kv" },
    el("dt", {}, "Address"), address,
    el("dt", {}, "Approval rule"),
    el("dd", {}, "Any " + state.g.t + " of " + state.g.n + " devices"),
    el("dt", {}, "Checked by"), el("dd", {}, checkedBadge()),
    el("dt", {}, "Network"), el("dd", {}, "Zcash " + net.label.toLowerCase()
      + (net.cap ? " · warning at " + capText(net.cap) : ""))),
  groupVersion() === 1 ? el("p", { class: "small muted" },
    "This wallet was made before quantum recoverability (ZIP 2005). To get it, move the funds "
    + "to a new wallet with Change devices.") : null];
}

function technicalFacts() {
  const w = state.wallet;
  return el("dl", { class: "kv" },
    el("dt", {}, "Created at block"), el("dd", { class: "mono" }, fmtInt(w.birthday)),
    el("dt", {}, "Wallet key"), el("dd", { class: "hex" }, w.group_verifying_key),
    usesV2(groupVersion()) ? [el("dt", {}, "Key setup"),
      el("dd", {}, "Built to ZIP 2005 (Proposed) so that funds can be recovered if quantum "
        + "computers break today's keys.")] : null,
    signedMode(state.gid) ? [el("dt", {}, "Signed writes"), el("dd", {}, "Each device signs the "
      + "data that it writes to this wallet. Zigs ignores data without a valid signature.")] : null);
}

// The box builds its content only while it is open: `ui.technical` holds the wallet that has it
// open, so a redraw keeps it open. A toggle that the flag already says changes nothing.
function technicalDetails() {
  const open = ui.technical === state.gid;
  const toggle = (ev) => {
    if (ev.currentTarget.open === (ui.technical === state.gid)) return;
    ui.technical = ev.currentTarget.open ? state.gid : null;
    render();
  };
  return el("details", { open: open || null, ontoggle: toggle },
    el("summary", {}, "Technical details of this wallet"), open ? technicalBody() : null);
}

function technicalBody() {
  const w = state.wallet;
  return el("div", { class: "technical" },
    el("p", { class: "small muted" }, "These facts are for people who check the wallet. Never "
      + "share a backup file or an invite link."),
    technicalFacts(),
    el("details", {}, el("summary", {}, "Viewing key"),
      el("div", { class: "addr-full", style: "margin-top:10px" }, w.ufvk),
      el("div", { style: "margin-top:8px" }, copyBtn(w.ufvk, "Copy viewing key"))),
    el("p", { class: "small faint" }, "The viewing key shows every payment of this wallet. "
      + "Share it only with people who may see your balance."),
    activityLog());
}

function privacyText(host) {
  return el("p", { class: "small muted" }, "Your key share is created and used in this browser. "
    + "It leaves this browser only if you save a backup. The group server stores encrypted "
    + "data it cannot read. This page downloads blocks from " + host
    + ", which sees your IP address but never a key. On each load, the wallet continues its "
    + "sync from the state that this browser saved.");
}

// The setting that lets this browser read memos. It names the leak: the light-wallet server learns
// which transactions pay this wallet.
function memoSwitch(host) {
  const gid = state.gid, on = readsMemos(gid);
  return el("div", { class: "setting memo-switch" },
    el("p", { class: "small muted" }, "A memo is only in the full transaction. To read it, this "
      + "browser asks " + host + " for each transaction that pays this wallet. That server then "
      + "learns which transactions pay this wallet, and it sees your IP address. This setting "
      + "is for this browser and this wallet. It is off until you turn it on. Memos that were "
      + "read stay after you turn it off."),
    el("button", {
      class: "btn sm", type: "button", "aria-pressed": on ? "true" : "false",
      onclick: act(() => setMemoReading(gid, !on)),
    }, on ? "Reading memos: on" : "Read memos of incoming payments"));
}

export function activityLog() {
  if (!state.log.length) return null;
  return el("details", {}, el("summary", {}, "Activity in this browser"),
    el("div", { class: "log" }, state.log.join("\n")));
}
