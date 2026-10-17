// The part of the old app.js that has not moved to a module yet. Step E1 deletes it.
import { MEMO_BYTES, memoBytes, memoError, parsePayeeList, toZat, zatText } from "./payees.js";
import { fmtInt, seatBackedUp, usesV2 } from "./util.js";
import { IGNORED_NOTE } from "./signed.js";
import { payeeRows, requestProblem } from "./requests.js";
import { ready, state, ui } from "./app-state.js";
import { fmtZec, short, when } from "./app-kit.js";
import { Z } from "./app-engine.js";
import { gkeys, sec } from "./app-keystore.js";
import { keysDiffer, localSeats, seatIds, seatMine, seatStage, STAGE_LABEL } from "./app-seats.js";
import { inviteLink } from "./app-links.js";
import {
  addrHidden, atCap, balanceNow, capText, chain, curChain, curNet, inFlight, netName, readsMemos,
  runSync, setMemoReading, spanMs,
} from "./app-chain.js";
import { canWriteAs, signedMode } from "./app-filter.js";
import { needsMyApproval, openGroup, openSession, toApprove } from "./app-groups.js";
import {
  act, addrGroups, avatar, copyBtn, countBadge, el, groupName, guard, leavesOf, memoTexts, money,
  named, netBadge, normalized, onNetwork, payTitle, proposer, qrBox, ruleText, seatTitle, secretQr,
  statusChip, unreadable,
} from "./app-dom.js";
import { signing, unreadIn } from "./app-messages.js";
import { groupVersion, rejectedSeats, seatCheck, verifiedCount } from "./app-dkg.js";
import {
  cancelMove, expired, feeEstimate, newSpend, PRIORITY_FACTOR, proposeMove, sendBlocker,
} from "./app-payments.js";
import { requestOf } from "./app-payreq.js";
import { messagesCard } from "./app-thread.js";
import { BACKUP_CHANGED, openBackup, staleRestoreNote } from "./app-backups.js";
import { loadingView } from "./app-shell.js";
import { focusAfter, render } from "./app-loop.js";
import { setupView } from "./app-setup.js";
import { solOn, solTab } from "./app-sol.js";

const MAX_PAYEES = 20;
const TOO_MANY = "A payment can have at most " + MAX_PAYEES + " recipients.";

// ── Wallet ──
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

// A note for any wallet version: the store shows another network than the first this device saw.
const networkNote = () => state.g.networkMoved ? el("div", { class: "callout bad", role: "alert" },
  "The store shows another network than the first this browser saw. Zigs keeps the first. "
  + "Ask your signers.") : null;

const NO_SIGNING_WALLET = "This wallet needs signatures, and this browser cannot check them. "
  + "Use a current Chrome, Edge, Firefox or Safari.";

// Notes for a version 3 wallet: a seat of this browser that cannot sign, and ignored data.
function signedNotes() {
  if (!signedMode(state.gid)) return null;
  const mute = localSeats().filter((i) => !canWriteAs(i));
  const lost = mute.length ? el("div", { class: "callout bad", role: "alert" },
    "This browser has no signing key for seat " + mute.join(", ") + ", so it cannot write to "
    + "this wallet. Restore a backup of the seat.") : null;
  const moved = state.g.shapeMoved ? el("div", { class: "callout bad", role: "alert" },
    "The store shows another number of signers or approval rule than the first this browser saw. "
    + "Zigs keeps the first. Ask your signers.") : null;
  const ignored = state.ignored ? el("p", { class: "small faint" }, IGNORED_NOTE) : null;
  return lost || moved || ignored
    ? el("div", { style: "display:grid;gap:8px" }, lost, moved, ignored) : null;
}

export const walletReady = () => !!(state.wallet && state.wallet.birthday)
  && rejectedSeats().length === 0 && !keysDiffer();

export function walletView(head, why) {
  const unsaved = localSeats().filter((i) => {
    const s = sec(state.gid, i);
    return s.keyPackage && !seatBackedUp(s);
  });
  const tabs = [
    ["overview", "Overview"],
    ["activity", "Activity", countBadge(toApprove(state.gid).length, "to approve", "attn")],
    ["messages", "Messages", countBadge(unreadIn(state.gid), "unread", "note")],
    ["members", "Signers"], ["details", "Details"],
  ];
  const bodies = {
    overview: overviewTab, activity: activityTab, messages: messagesCard, members: membersTab,
    details: detailsTab,
  };
  if (solOn()) { tabs.push(["solana", "Solana"]); bodies.solana = solTab; }
  if (!Object.hasOwn(bodies, ui.tab)) ui.tab = "overview";
  return el("div", { class: "page" }, head, tabBar(tabs),
    unsaved.length ? backupNote(unsaved) : null,
    el("div", { role: "tabpanel", id: "panel-" + ui.tab, "aria-labelledby": "tab-" + ui.tab },
      bodies[ui.tab]()),
    el("div", { class: "action-bar" }, ...walletActions(why)));
}

function groupHead(g, ready, why) {
  const seated = seatIds().filter((i) => state.seats[i]).length;
  const old = state.groups.find((x) => x.id === g.movedFrom);
  return el("header", { class: "page-head" },
    el("div", { class: "ph-left" },
      el("button", { class: "btn ghost sm back", type: "button", onclick: () => openGroup(null) },
        "← Wallets"),
      el("h1", {}, g.name),
      el("div", { class: "ph-meta" },
        netBadge(g),
        el("span", { class: "badge plain", title: ruleText(g.t, g.n) },
          g.t + " of " + g.n + " signers must approve"),
        el("span", { class: "stack" }, seatIds().map((i) => avatar(i))),
        el("span", {}, seated + " of " + g.n + " signers joined"),
        g.movedFrom
          ? el("span", {}, "Replaces " + ((old || {}).name || "an older wallet")) : null)),
    ready ? el("div", { class: "ph-actions wallet-actions" }, ...walletActions(why)) : null);
}

// Arrow keys, Home and End move between tabs. Only the selected tab is in the Tab order.
export function tabBar(tabs) {
  const ids = tabs.map(([id]) => id), last = ids.length - 1, at = ids.indexOf(ui.tab);
  const target = {
    ArrowRight: at >= last ? 0 : at + 1, ArrowLeft: at <= 0 ? last : at - 1, Home: 0, End: last,
  };
  const onkeydown = (ev) => {
    if (!(ev.key in target)) return;
    ev.preventDefault();
    ui.tab = ids[target[ev.key]];
    focusAfter("tab-" + ui.tab, true);
    render();
  };
  const tab = ([id, label, badge]) => el("button", {
    class: "tab", type: "button", role: "tab", id: "tab-" + id, "data-key": "tab-" + id,
    "aria-selected": ui.tab === id ? "true" : "false",
    "aria-controls": ui.tab === id ? "panel-" + id : null,
    tabindex: ui.tab === id ? "0" : "-1", onclick: () => { ui.tab = id; render(); },
  }, label, badge);
  return el("div", { class: "tabs", role: "tablist", "aria-label": "Wallet sections", onkeydown },
    tabs.map(tab));
}
export function setTabBar(f) { tabBar = f; }

// Private windows, Tor Browser and cleared site data delete the key share with the browser data.
export function backupNote(seats) {
  const text = "Back up your key share. This browser can forget it: private windows and Tor "
    + "Browser delete it when they close. The file is locked with a passphrase that you choose. "
    + "Keep the file safe, and keep the passphrase apart from it. " + BACKUP_CHANGED;
  return el("div", { class: "callout warn", role: "status" },
    el("span", { style: "flex:1 1 16rem" }, text),
    seats.map((i) => el("button", {
      class: "btn sm", type: "button", onclick: () => openBackup(i),
    }, seats.length > 1 ? "Back up seat " + i : "Back up key share")));
}

// `why` is the reason Send is off, shown as text because touch screens have no tooltip.
function walletActions(why) {
  return [
    el("button", { class: "btn", type: "button", onclick: () => { ui.receive = true; render(); } }, "Receive"),
    el("button", {
      class: "btn primary", type: "button", disabled: !!why, title: why,
      onclick: () => {
        Object.assign(ui, { send: true, pay: null, note: "", priority: false, sendFor: null });
        render();
      },
    }, "Send"),
    why ? el("p", { class: "send-why" }, why) : null,
  ];
}

// ── Overview ──
function overviewTab() {
  const c = curChain(), list = activity(), pend = toApprove(state.gid);
  return el("div", { class: "page", style: "gap:16px" },
    state.g.movedTo ? moveCard(c) : null,
    pend.length ? approvalsCard(pend) : null,
    el("div", { class: "grid-ov" }, balanceCard(c), receiveCard()),
    signersCard(),
    el("section", { class: "card" },
      el("div", { class: "card-head card-pad", style: "padding-bottom:12px" }, el("h2", {}, "Activity"),
        list.length > 6 ? el("button", { class: "btn ghost sm", type: "button", onclick: () => { ui.tab = "activity"; render(); } }, "View all") : null),
      activityRows(list.slice(0, 6))));
}

// The steps of a move, read from the old wallet: new wallet ready, payment proposed, funds gone.
export function moveState(c) {
  const to = state.g.movedTo;
  const ss = state.sessions.find((x) => x.move === to && !x.error && !expired(x));
  const b = c && c.bal ? balanceNow(c.bal) : null;
  if (!gkeys[to]) return { text: "A signer started moving this wallet to a new one. If you are one of its signers, ask them for its invite link." };
  if (!ready[to]) return { text: groupName(to) + " is still setting up. When its address is ready, move the funds here.", open: to };
  if (ss && !ss.broadcastTxid) return { text: "Moving the funds to " + groupName(to) + " is in progress. Open the payment to approve it or take the next step.", session: ss };
  if (ss && inFlight().includes(ss)) return { text: "The funds are on their way to " + groupName(to) + ". They arrive with the next block.", open: to };
  if (ss && b && b.spendable + b.pending === 0) return { text: "All funds moved to " + groupName(to) + ". This wallet is closed.", open: to, done: true };
  return { text: groupName(to) + " is ready. Move all funds to it. Like any payment, this needs " + state.g.t + " approvals.", propose: true };
}

function moveCard(c) {
  const m = moveState(c), why = m.propose ? sendBlocker() : null;
  const started = state.sessions.some((x) => x.move === state.g.movedTo && !x.error && !expired(x));
  return el("section", { class: "card card-pad " + (m.done ? "" : "attention") },
    el("div", { class: "card-head" }, el("h2", {}, m.done ? "This wallet moved" : "Changing signers"),
      m.done ? el("span", { class: "badge plain" }, "Closed") : null),
    el("p", { class: "small muted" }, m.text),
    el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" },
      m.propose ? el("button", { class: "btn primary", type: "button", disabled: !!why, title: why, onclick: act(proposeMove) }, "Move " + fmtZec(c && c.bal ? c.bal.max_send : 0)) : null,
      m.session ? el("button", { class: "btn primary", type: "button", onclick: () => openSession(m.session.id) }, "Open the payment") : null,
      m.open ? el("button", { class: "btn", type: "button", onclick: () => { ui.tab = "overview"; openGroup(m.open); } }, "Open " + groupName(m.open)) : null,
      !started ? el("button", { class: "btn ghost", type: "button", onclick: act(cancelMove) }, "Cancel move") : null),
    why ? el("p", { class: "small faint" }, why) : null);
}

function signersCard() {
  return el("section", { class: "card card-pad" },
    el("div", { class: "card-head" }, el("h2", {}, "Signers"),
      el("button", { class: "btn ghost sm", type: "button", onclick: () => { ui.tab = "members"; render(); } }, "Manage")),
    el("p", { class: "small muted" }, ruleText(state.g.t, state.g.n)),
    el("div", { class: "signer-list" }, seatIds().map((i) => el("span", { class: "signer" },
      avatar(i), el("span", { class: "small" }, named(i))))));
}

function approvalsCard(list) {
  return el("section", { class: "card attention" },
    el("div", { class: "card-head card-pad", style: "padding-bottom:12px" },
      el("h2", {}, list.length === 1 ? "A payment needs your approval" : list.length + " payments need your approval")),
    el("div", { class: "list" }, list.map((ss) => guard(approvalRow, ss))));
}

function approvalRow(ss) {
  return el("button", {
    class: "row-item", type: "button", "data-key": "pay-approve-" + ss.id,
    onclick: () => openSession(ss.id),
  },
  el("span", { class: "tx-ico out", "aria-hidden": "true" }, "↗"),
  el("span", { class: "ri-main" }, el("span", { class: "ri-title" }, payTitle(ss)),
    el("span", { class: "ri-sub" }, "Proposed by " + proposer(ss) + " · " + when(ss.createdAt))),
  el("span", { class: "ri-end" }, money(leavesOf(ss), "md", "out")),
  el("span", { class: "btn sm primary", "aria-hidden": "true" }, "Review"));
}

function balanceCard(c) {
  const b = c && c.bal ? balanceNow(c.bal) : null, empty = b && b.spendable + b.pending + b.sending === 0 && !state.g.movedTo;
  return el("section", { class: "card card-pad balance" },
    el("span", { class: "label" }, "Balance"),
    b ? money(b.spendable + b.pending, "xl")
      : el("span", { class: "skel xl", role: "img", "aria-label": "Loading balance" }),
    el("div", { class: "stats" },
      el("div", {}, el("span", { class: "label" }, "Available"), b ? money(b.spendable) : el("span", { class: "skel" })),
      el("div", {}, el("span", { class: "label" }, "Incoming"), b ? money(b.pending) : el("span", { class: "skel" }))),
    b && b.sending ? el("div", { class: "sending" }, el("span", { class: "dot busy" }), "Sending ", money(b.sending, "md", "out"), el("span", { class: "faint" }, " · waiting for a block")) : null,
    empty ? el("div", { class: "callout" }, curNet().faucet
      ? el("span", {}, "This wallet is empty. Share its address to receive ZEC, or get free testnet ZEC from a ",
        el("a", { href: curNet().faucet, target: "_blank", rel: "noopener" }, "faucet ↗"), ".")
      : el("span", {}, "This wallet is empty. Share its address to receive ZEC. Keep it under "
        + capText(curNet().cap) + ": the app warns at that level. It cannot block deposits."))
      : null,
    atCap() ? capNote() : null,
    syncLine(c));
}
const capNote = () => el("div", { class: "callout bad" },
  "This wallet holds " + capText(curNet().cap) + ", the warning level for unaudited mainnet "
  + "wallets. Do not send more to it. The app cannot block deposits. Payments out still work.");

const receiveWhat = () => curNet().cap ? "ZEC" : "testnet ZEC";
const receiveLimit = () => curNet().cap ? " Keep the total under " + capText(curNet().cap)
  + ". The app warns at that level and cannot block deposits." : "";

function receiveCard() {
  const w = state.wallet;
  return el("section", { class: "card card-pad" },
    el("div", { class: "card-head" }, el("h2", {}, "Receive"), el("span", { class: "badge ok plain" }, "Private address")),
    state.g.movedTo ? el("div", { class: "callout" }, "This wallet moved to " + groupName(state.g.movedTo) + ". Ask senders to use the new wallet's address.")
      : atCap() ? capNote()
      : el("p", { class: "small muted" }, "Share this address to receive " + receiveWhat()
        + ". Payments to it are shielded." + receiveLimit()),
    addrHidden() ? null : el("div", { class: "addr-box" }, el("span", { class: "hex" }, short(w.address, 18)), copyBtn(w.address)),
    el("p", { class: "small faint" }, verifiedCount() + " of " + state.g.n + " signers checked this address against their own key."));
}

export function syncLine(c) {
  if (!c) return el("div", { class: "sync" }, el("span", {}, el("span", { class: "dot" }), "Sync starts after your seat checks the address."));
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

// Received payments carry only a block height; estimate a time so they sort among proposals.
function activity() {
  const c = curChain(), tip = c && c.bal ? c.bal.height : 0;
  const sent = state.sessions.map((ss) => ({ t: ss.createdAt || 0, ss }));
  const net = netName(state.g);
  const got = (c && c.received || [])
    .map((r) => ({ t: Date.now() - spanMs(net, r.height, tip), r }));
  return [...sent, ...got].sort((a, b) => b.t - a.t);
}

function activityRows(list) {
  const line = "border-top:1px solid var(--line)";
  if (!list.length) {
    return el("div", { class: "empty", style: line }, el("h3", {}, "No activity yet"),
      el("p", { class: "small" },
        "Money you receive and payments your signers propose show up here."));
  }
  const rows = list.map((a) => guard(a.ss ? sentRow : receivedRow, a.ss || a.r));
  return el("div", { class: "list", style: line }, rows);
}

function sentRow(ss) {
  const chip = needsMyApproval(state.gid, ss) ? el("span", { class: "badge warn" }, "Your approval")
    : inFlight().includes(ss) ? el("span", { class: "badge info" }, "Confirming") : statusChip(ss);
  return el("button", {
    class: "row-item", type: "button", "data-key": "pay-" + ss.id,
    "aria-current": ss.id === state.sid ? "true" : "false", onclick: () => openSession(ss.id),
  },
  el("span", { class: "tx-ico out", "aria-hidden": "true" }, "↗"),
  el("span", { class: "ri-main" }, el("span", { class: "ri-title" }, payTitle(ss)),
    el("span", { class: "ri-sub" }, "Proposed by " + proposer(ss) + " · " + when(ss.createdAt))),
  el("span", { class: "ri-end" }, money(leavesOf(ss), "md", "out"), chip),
  el("span", { class: "chev" }, "›"));
}

// The memos of a received payment, for display. A memo that is not text says so.
export const ON_CHAIN = "On chain · shared with all signers";

function receivedRow(r) {
  const memos = memoTexts(r);
  return el("a", { class: "row-item", href: curNet().explorer + r.txid, target: "_blank", rel: "noopener", title: "View in explorer" },
    el("span", { class: "tx-ico in", "aria-hidden": "true" }, "↙"),
    el("span", { class: "ri-main" },
      el("span", { class: "ri-title" }, "Received"),
      el("span", { class: "ri-sub" }, "Block " + r.height.toLocaleString()),
      memos.map((m) => el("span", { class: "ri-memo" + (m === null ? " faint" : "") },
        m === null ? "Memo is not text" : m)),
      memos.length ? el("span", { class: "ri-sub" }, ON_CHAIN) : null,
      r.memo_pending && readsMemos(state.gid)
        ? el("span", { class: "ri-sub" }, "Memo not read yet") : null),
    el("span", { class: "ri-end" }, money(r.value, "md", "in"), el("span", { class: "badge " + (r.confirmed ? "ok" : "info") }, r.confirmed ? "Confirmed" : "Confirming")),
    el("span", { class: "chev" }, "↗"));
}

// ── Activity ──
function activityTab() {
  return el("section", { class: "card" }, el("div", { class: "card-head card-pad", style: "padding-bottom:12px" }, el("h2", {}, "All activity")), activityRows(activity()));
}

// ── Members ──
function membersTab() {
  return el("div", { class: "page", style: "gap:16px" },
    el("section", { class: "card" },
      el("div", { class: "card-pad", style: "padding-bottom:14px" }, el("div", { class: "card-head" }, el("h2", {}, "Signers"), el("span", { class: "small muted" }, ruleText(state.g.t, state.g.n)))),
      el("div", { style: "border-top:1px solid var(--line)" },
        seatIds().map((i) => guard(memberRow, i)))),
    changeSignersCard(),
    el("section", { class: "card card-pad" },
      el("h2", { style: "font-size:15px" }, "Invite link"),
      el("p", { class: "small muted" }, "Signers open this wallet on another device with this "
        + "invite link and their key share backup. The link contains the wallet secret, so share "
        + "it only with signers."),
      el("div", { class: "addr-box" }, el("span", { class: "hex nowrap" }, inviteLink(state.gid)), copyBtn(inviteLink(state.gid), "Copy link")),
      secretQr(inviteLink(state.gid))));
}

// FROST fixes the signers when the key is made, so a change means a new wallet and one payment.
function changeSignersCard() {
  const moving = !!state.g.movedTo;
  return el("section", { class: "card card-pad" },
    el("h2", { style: "font-size:15px" }, "Add or remove signers"),
    el("p", { class: "small muted" }, "The signers and the approval rule are part of the wallet key, so they cannot change in place. "
      + "To change them, create a new wallet with the signers you want, then move the funds to it."),
    el("div", {}, moving
      ? el("button", { class: "btn", type: "button", onclick: () => { ui.tab = "overview"; render(); } }, "See the move")
      : el("button", { class: "btn", type: "button", disabled: !localSeats().length, onclick: () => { ui.move = true; render(); } }, "Change signers")));
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

function memberRow(i) {
  const s = state.seats[i], mine = s && seatMine(i) && sec(state.gid, i);
  const title = el("span", { class: "ri-title" }, seatTitle(i, s),
    mine ? el("span", { class: "you" }, "You") : null);
  const sub = el("span", { class: "ri-sub" }, "Seat " + i + (s ? " · joined " + when(s.at) : ""));
  const backup = mine && sec(state.gid, i).keyPackage ? keyBackupButton(i) : null;
  return el("div", { class: "member" }, avatar(i, "lg"), el("div", { class: "ri-main" }, title, sub),
    el("div", { class: "m-actions" }, seatBadge(i), backup));
}

// ── Details ──
function detailsTab() {
  return el("div", { class: "page", style: "gap:16px" }, walletFacts(), privacyCard());
}

function checkedBadge() {
  const rejected = rejectedSeats(), ver = verifiedCount(), n = state.g.n;
  if (rejected.length) {
    const text = "Seat " + rejected.join(", ") + " rejected this wallet";
    return el("span", { class: "badge bad" }, text);
  }
  return el("span", { class: "badge " + (ver === n ? "ok" : "") }, ver + " of " + n + " signers");
}

function walletFacts() {
  const w = state.wallet, net = curNet();
  const address = addrHidden()
    ? el("dd", {}, "Shown after your seat checks it against your key share.")
    : el("dd", {}, el("div", { class: "addr-full" }, addrGroups(w.address)),
      el("div", { style: "margin-top:8px" }, copyBtn(w.address, "Copy address")));
  return el("section", { class: "card card-pad" },
    el("h2", { style: "font-size:15px" }, "Wallet"),
    el("dl", { class: "kv" },
      el("dt", {}, "Address"), address,
      el("dt", {}, "Approval rule"),
      el("dd", {}, "Any " + state.g.t + " of " + state.g.n + " signers"),
      el("dt", {}, "Checked by"), el("dd", {}, checkedBadge()),
      el("dt", {}, "Network"), el("dd", {}, "Zcash " + net.label.toLowerCase()
        + (net.cap ? " · warning at " + capText(net.cap) : "")),
      el("dt", {}, "Created at block"), el("dd", { class: "mono" }, fmtInt(w.birthday)),
      el("dt", {}, "Wallet key"), el("dd", { class: "hex" }, w.group_verifying_key),
      usesV2(groupVersion()) ? [el("dt", {}, "Key setup"),
        el("dd", {}, "Built to ZIP 2005 (Proposed) so that funds can be recovered if quantum "
          + "computers break today's keys.")] : null,
      signedMode(state.gid) ? [el("dt", {}, "Signed writes"), el("dd", {}, "Each signer signs the "
        + "data it writes to this wallet. Zigs ignores data without a valid signature.")] : null),
    groupVersion() === 1 ? el("p", { class: "small muted", style: "margin-top:12px" },
      "This wallet was made before quantum recoverability (ZIP 2005). To get it, move the funds "
      + "to a new wallet with Change signers.") : null);
}

function privacyCard() {
  const w = state.wallet;
  const host = chain && chain.url ? new URL(chain.url).host : "a light-wallet server";
  return el("section", { class: "card card-pad" },
    el("h2", { style: "font-size:15px" }, "Privacy and keys"),
    el("p", { class: "small muted" }, "Your key share is created and used in this browser. "
      + "It leaves this browser only if you save a backup. The group server stores encrypted "
      + "data it cannot read. This page downloads blocks from " + host
      + ", which sees your IP address but never a key. The wallet syncs again on every load."),
    memoSwitch(host),
    el("details", {}, el("summary", {}, "Viewing key"),
      el("div", { class: "addr-full", style: "margin-top:10px" }, w.ufvk),
      el("div", { style: "margin-top:8px" }, copyBtn(w.ufvk, "Copy viewing key"))),
    el("p", { class: "small faint" }, "The viewing key shows every payment of this wallet. "
      + "Share it only with people who may see your balance."),
    activityLog());
}

// The setting that lets this browser read memos. It names the leak: the light-wallet server learns
// which transactions pay this wallet.
function memoSwitch(host) {
  const gid = state.gid, on = readsMemos(gid);
  return el("div", { class: "memo-switch" },
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

// ── Receive ──
export function receiveDialog() {
  const w = state.wallet, hidden = addrHidden();
  const close = el("button", {
    class: "icon-btn", type: "button", "aria-label": "Close",
    onclick: () => { ui.receive = false; render(); },
  }, "×");
  const faucet = curNet().faucet
    ? el("a", { class: "btn ghost", href: curNet().faucet, target: "_blank", rel: "noopener" },
      "Get testnet ZEC ↗") : el("span");
  return el("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "recv-title" },
    el("div", { class: "card-head" }, el("h2", { id: "recv-title" }, "Receive ZEC"), close),
    atCap() ? capNote() : el("p", { class: "small muted" }, "Send " + receiveWhat()
      + " to this shielded address. Senders and the network cannot see the balance or who "
      + "controls it." + receiveLimit()),
    hidden ? null : qrBox(w.address, "Wallet address"),
    hidden ? null : el("div", { class: "addr-full" }, addrGroups(w.address)),
    el("div", { class: "dialog-actions", style: "justify-content:space-between" },
      faucet, hidden ? null : copyBtn(w.address, "Copy address", "btn primary")));
}

// ── Send ──
function addressHint(hint, to) {
  const v = to.trim(), ok = v ? onNetwork(v) : null, net = curNet().label.toLowerCase();
  hint.textContent = !v ? "" : ok ? "Valid " + net + " address"
    : "Not a shielded Zcash " + net + " address. It starts with " + curNet().prefix + ".";
  hint.className = "hint " + (!v ? "" : ok ? "ok" : "bad");
}

function payRow(r, i, rows, sumUp) {
  const c = curChain(), hint = el("span", { class: "hint" }), n = rows.length > 1 ? " " + (i + 1) : "";
  const amt = el("input", { class: "input", id: "s-amt-" + r.k, type: "text", inputmode: "decimal", placeholder: "0.00", required: true, autocomplete: "off", "aria-label": "Amount" + n, value: r.amt, oninput: (ev) => { r.amt = ev.target.value.trim(); sumUp(); } });
  const max = () => { r.amt = zatText(Math.max(0, c && c.bal ? c.bal.max_send : 0)); amt.value = r.amt; sumUp(); };
  addressHint(hint, r.to);
  return el("div", { class: "pay-row" },
    el("input", {
      class: "input mono", id: "s-to-" + r.k, type: "text", placeholder: curNet().prefix + "…",
      required: true, autocomplete: "off", spellcheck: "false",
      "aria-label": "Recipient address" + n, value: r.to,
      oninput: (ev) => {
        r.to = ev.target.value;
        fillFromRequest(r, rows, hint) || addressHint(hint, r.to);
      },
    }),
    el("div", { class: "input-wrap" }, amt, rows.length === 1 ? el("button", { class: "btn sm", type: "button", onclick: max }, "Max") : null),
    rows.length > 1 ? el("button", { class: "icon-btn", type: "button", "aria-label": "Remove recipient" + n, onclick: () => { rows.splice(i, 1); render(); } }, "×") : null,
    hint, memoBox(r, n));
}

// Shows the bytes of a memo once it comes near the limit, and says why a memo cannot be sent.
const MEMO_NEAR = 400;
function memoHint(hint, memo) {
  const bad = memoError(memo), bytes = memoBytes(memo);
  hint.textContent = bad || (bytes >= MEMO_NEAR ? bytes + " of " + MEMO_BYTES + " bytes" : "");
  hint.className = "hint" + (bad ? " bad" : "");
}

// The optional memo of one recipient.
function memoBox(r, n) {
  const hint = el("span", { class: "hint" });
  memoHint(hint, r.memo);
  return el("div", { class: "memo-row" },
    el("input", {
      class: "input", id: "s-memo-" + r.k, type: "text", placeholder: "Memo (optional)",
      autocomplete: "off", "aria-label": "Memo" + n + " (optional)", value: r.memo,
      oninput: (ev) => { r.memo = ev.target.value; memoHint(hint, r.memo); },
    }),
    hint);
}

// A whole request pasted in a recipient field replaces that row with the rows of its payees. It
// returns true when the field holds a request. The rows get new keys, so the redraw does not read
// the pasted text again.
export function fillFromRequest(r, rows, hint) {
  const req = requestOf(r.to, false);
  if (!req) return false;
  const fresh = req.payees ? payeeRows(req.payees, () => ++ui.payKey) : [];
  const tooMany = rows.length - 1 + fresh.length > MAX_PAYEES;
  const error = req.error ? requestProblem(req.error) : tooMany ? TOO_MANY : "";
  if (error) { hint.textContent = error; hint.className = "hint bad"; return true; }
  rows.splice(rows.indexOf(r), 1, ...fresh);
  render();
  return true;
}

// The rows and the errors of the "Paste a list" box: a whole request, or lines of address, amount
// and memo.
function pastedList(text) {
  const req = requestOf(text, false);
  if (!req) return parsePayeeList(text);
  if (req.error) return { rows: [], errors: [requestProblem(req.error)] };
  return { rows: req.payees, errors: [] };
}

function listProblem(rows, errors) {
  if (errors[0]) return errors[0];
  if (!rows.length) return "Paste at least one line.";
  return rows.length > MAX_PAYEES ? TOO_MANY : "";
}

function useList() {
  const box = document.getElementById("s-list"), { rows, errors } = pastedList(box.value);
  ui.listError = listProblem(rows, errors);
  if (!ui.listError) {
    ui.pay = payeeRows(rows, () => ++ui.payKey);
    box.value = ""; box.closest("details").open = false;
  }
  render();
}

// Checks each row and returns the payees in zatoshis, or throws with the row number.
function readPayees(rows) {
  const net = curNet(), own = normalized(state.wallet.address);
  return rows.map((r, i) => {
    const to = r.to.trim(), amount = toZat(r.amt), who = rows.length > 1 ? "Recipient " + (i + 1) + ": " : "";
    const memo = String(r.memo || "").trim();
    if (!onNetwork(to)) throw new Error(who + "Enter a shielded Zcash " + net.label.toLowerCase() + " address. It starts with " + net.prefix + ".");
    if (normalized(to) === own) throw new Error(who + "This is the address of this wallet. Enter the address of someone else.");
    if (!amount) throw new Error(who + "Enter an amount greater than zero, with at most 8 decimals.");
    if (memoError(memo)) throw new Error(who + memoError(memo));
    return memo ? { to, amount, memo } : { to, amount };
  });
}

function pasteList(net) {
  return el("details", { class: "paste" }, el("summary", { class: "btn sm" }, "Paste a list"),
    el("textarea", {
      class: "input mono", id: "s-list", rows: "5", spellcheck: "false",
      "aria-label": "Payment list",
      placeholder: net.prefix + "…, 0.5, October rent\n" + net.prefix + "…, 1.25",
    }),
    el("span", { class: "hint" },
      "One address and amount per line, then an optional memo. A spreadsheet copy works. "
      + "A payment request (zcash:) works too."),
    ui.listError ? el("span", { class: "hint bad" }, ui.listError) : null,
    el("button", { class: "btn sm", type: "button", onclick: useList }, "Use this list"));
}

export function sendDialog() {
  const c = curChain(), bal = c && c.bal, spendable = bal ? bal.spendable : 0, net = curNet();
  if (!ui.pay) { ui.pay = [{ k: ++ui.payKey, to: "", amt: "", memo: "" }]; ui.listError = ""; }
  const rows = ui.pay;
  const fee = el("span", {}), total = el("span", { id: "s-total" });
  const sumUp = () => {
    const f = feeEstimate(rows.length, ui.priority);
    fee.replaceChildren(money(f));
    total.replaceChildren(money(rows.reduce((n, r) => n + (toZat(r.amt) || 0), 0) + f));
  };
  const why = sendBlocker();
  const f = el("form", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "send-title", onsubmit: act(async (ev) => {
    if (why) throw new Error(why);
    const payees = readPayees(rows);
    const need = payees.reduce((n, p) => n + p.amount, 0) + feeEstimate(payees.length, ui.priority);
    if (need > spendable) throw new Error("Not enough funds: " + fmtZec(spendable) + " available, " + fmtZec(need) + " needed (amounts + fee).");
    const note = String(new FormData(ev.target).get("note") || "").trim();
    await newSpend(payees, note, null, ui.priority);
    ui.send = false;
  }) },
    el("div", { class: "card-head" }, el("h2", { id: "send-title" }, "Send ZEC"), el("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: () => { ui.send = false; render(); } }, "×")),
    el("div", { class: "field" }, el("span", {}, rows.length > 1 ? rows.length + " recipients, one transaction" : "To and amount"),
      rows.map((r, i) => payRow(r, i, rows, sumUp)),
      el("div", { class: "row-actions" },
        el("button", {
          class: "btn sm", type: "button", disabled: rows.length >= MAX_PAYEES,
          onclick: () => { rows.push({ k: ++ui.payKey, to: "", amt: "", memo: "" }); render(); },
        }, "Add recipient"),
        pasteList(net))),
    el("label", { class: "field" }, el("span", {}, "Note for signers (optional)"),
      el("input", {
        class: "input", id: "s-note", name: "note", type: "text", maxlength: "80",
        placeholder: rows.length > 1 ? "October payroll" : "Pay the audit firm",
        autocomplete: "off", value: ui.note, oninput: (ev) => { ui.note = ev.target.value; },
      }),
      el("span", { class: "hint" }, "Encrypted. Only signers of this wallet can read it.")),
    el("p", { class: "small faint" }, "A memo goes on chain with the payment. Its recipient and "
      + "every signer of this wallet can read it."),
    priorityBox(sumUp),
    el("div", { class: "summary" },
      el("div", {}, el("span", { class: "muted" }, "Available"), money(spendable)),
      el("div", {}, el("span", { class: "muted" }, "Network fee (estimate)"), fee),
      el("div", { class: "total" }, el("span", {}, "Total leaving the wallet"), total),
      el("div", {}, el("span", { class: "muted" }, "Approvals needed"), el("span", {}, state.g.t + " of " + state.g.n))),
    el("p", { class: "small faint" }, EXPIRY_NOTE),
    el("div", { class: "dialog-actions" },
      el("button", { class: "btn", type: "button", onclick: () => { ui.send = false; render(); } }, "Cancel"),
      el("button", {
        class: "btn primary", type: "submit", disabled: !Z || !!why,
      }, "Propose payment")),
    why ? el("p", { class: "small faint" }, why) : null);
  sumUp();
  return f;
}

// The expiry window of the engine (wasm/src/expiry.rs), in words.
const EXPIRY_NOTE = "The approvals must finish within about 24 hours. After that the payment "
  + "expires, and a signer proposes it again.";

// The priority fee: 10 times the standard fee, for a faster block when the network is busy. It
// is public on chain, so it marks the payment. Older builds of the apps refuse it.
function priorityBox(sumUp) {
  return el("label", { class: "ack" },
    el("input", {
      type: "checkbox", id: "s-priority", checked: ui.priority,
      onchange: (ev) => { ui.priority = ev.target.checked; sumUp(); },
    }),
    el("span", { class: "small" }, "Pay a priority fee: " + PRIORITY_FACTOR + " times the "
      + "standard fee, for a faster block when the network is busy. The fee is public on chain. "
      + "An iPhone or Mac app built before this version cannot approve it."));
}
