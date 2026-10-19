// The wallet page: its sections (overview, activity, messages, signers, details, Solana).
import { fmtInt, seatBackedUp, usesV2 } from "./util.js";
import { IGNORED_NOTE } from "./signed.js";
import { log, ready, state, ui } from "./app-state.js";
import { fmtZec, short, when } from "./app-kit.js";
import { gkeys, sec } from "./app-keystore.js";
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
import { finishStep } from "./app-drawer.js";
import { BUCKETS, bucketOf, emptyState, solLine } from "./approvals-model.js";
import { messagesCard } from "./app-thread.js";
import { openBackup, staleRestoreNote } from "./app-backups.js";
import { loadingView } from "./app-shell.js";
import { render } from "./app-loop.js";
import { setupView, solSetupCard, solUnfinished } from "./app-setup.js";
import { themeChoice } from "./app-theme.js";
import {
  sol, solBackup, solBalance, solError, solLoading, solOn, solPending, solSetup, solSync, solTab,
  solUnsaved,
} from "./app-sol.js";
import { pendingShortcut, solRow, zecInProgress, zecTotal } from "./overview-model.js";
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
    ["members", "Signers"], ["details", "Details"],
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
  messages: () => messagesCard(),
  members: () => membersTab(), details: () => detailsTab(), solana: () => solTab(),
};

export function walletView(head, why) {
  const unsaved = localSeats().filter((i) => {
    const s = sec(state.gid, i);
    return s.keyPackage && !seatBackedUp(s);
  });
  const solSeats = solUnsaved();
  const [id, label] = currentSection(walletSections());
  return el("div", { class: "page" }, head,
    unsaved.length || solSeats.length ? backupNote(unsaved, solSeats) : null,
    el("section", { id: "panel-" + id, "data-key": "panel-" + id, tabindex: "-1",
      "aria-label": label }, BODIES[id]()),
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
          g.t + " of " + g.n + " signers must approve"),
        el("span", { class: "stack" }, seatIds().map((i) => avatar(i))),
        el("span", {}, seated + " of " + g.n + " signers joined"),
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
export function backupNote(seats, solSeats = []) {
  const first = seats.length ? "Back up your key share."
    : "Back up the Solana part of your key share.";
  const text = first + " This browser can forget it: private windows and Tor "
    + "Browser delete it when they close. The file is locked with a passphrase that you choose. "
    + "Keep the file safe, and keep the passphrase apart from it."
    + (solSeats.length ? " " + SOL_FILE : "");
  const many = seats.length + solSeats.length > 1;
  return el("div", { class: "callout warn", role: "status" },
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
    el("button", { class: "btn", type: "button", onclick: () => { ui.receive = true; render(); } }, "Receive"),
    el("button", {
      class: "btn primary", type: "button", disabled: !!why, title: why,
      onclick: () => {
        Object.assign(ui, {
          send: true, pay: null, note: "", priority: false, sendFor: null, after: null,
        });
        render();
      },
    }, "Send"),
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
      el("div", { class: "card-head card-pad", style: "padding-bottom:12px" }, el("h2", {}, "Activity"),
        list.length > 6 ? el("button", { class: "btn ghost sm", type: "button", onclick: () => { ui.tab = "activity"; render(); } }, "View all") : null),
      activityRows(list.slice(0, 6))));
}

// The steps of a move, read from the old wallet: new wallet ready, payment proposed, funds gone.
export function moveState(c) {
  const to = state.g.movedTo;
  const ss = state.sessions.find((x) => x.move === to && !x.error && !ended(x));
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
  const started = state.sessions.some((x) => x.move === state.g.movedTo && !x.error && !ended(x));
  return el("section", { class: "card card-pad " + (m.done ? "" : "attention") },
    el("div", { class: "card-head" }, el("h2", {}, m.done ? "This wallet moved" : "Changing signers"),
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
  el("div", {}, el("h2", { id: "asset-" + id }, symbol), el("p", {}, network)));

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
  differs: "The seats do not agree on one Solana key. Do not use the Solana part. Open Solana for "
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

// An exact SOL text ("0.0025 SOL") in the size of the ZEC amount, with the unit as money()
// shows it.
const solAmount = (text) => el("span", { class: "money xl", role: "img", "aria-label": text },
  text.slice(0, -4), el("span", { class: "cur" }, "SOL"));

export const capNote = () => el("div", { class: "callout bad" },
  "This wallet holds " + capText(curNet().cap) + ", the warning level for unaudited mainnet "
  + "wallets. Do not send more to it. The app cannot block deposits. Payments out still work.");

export const receiveWhat = () => curNet().cap ? "ZEC" : "testnet ZEC";
export const receiveLimit = () => curNet().cap ? " Keep the total under " + capText(curNet().cap)
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
  // One list of sent payments for the whole draw: a row does not walk all sessions again.
  const flying = new Set(inFlight());
  const sentOf = (ss) => sentRow(ss, flying);
  const rows = list.map((a) => guard(a.ss ? sentOf : receivedRow, a.ss || a.r));
  return el("div", { class: "list", style: line }, rows);
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

// The Approvals inbox: the payments that wait for this browser, for the other signers or for the
// network, and those that need attention, then one line for the Solana part. A row opens its
// payment; the drawer keeps every action. Empty buckets do not show.
function approvalsTab() {
  const rows = inboxRows(), sol = solInbox(), flying = new Set(inFlight());
  // The Solana line joins a bucket as one row; for review it counts each proposal.
  const solNote = (id) => sol && sol.kind === id ? el("p", { class: "row-note" }, sol.text,
    " ", openSolanaButton()) : null;
  const sections = BUCKETS.map(([id, label]) => {
    const list = rows[id], extra = solNote(id);
    const lost = id === "attention" ? lostNote(rows.lost) : null;
    if (!list.length && !extra && !lost) return null;
    const count = list.length + (extra ? (id === "review" ? solPending() : 1) : 0)
      + (lost ? rows.lost.length : 0);
    return el("section", { class: "card inbox", "aria-label": label },
      el("div", { class: "card-head card-pad" }, el("h2", {}, label),
        el("span", { class: "badge plain" }, String(count))),
      el("div", { class: "list" }, list.map((ss) => guard(sentRow, ss, flying)), extra, lost));
  }).filter(Boolean);
  const other = sol && !["review", "attention"].includes(sol.kind)
    ? el("p", { class: "small muted" }, sol.text, " ", openSolanaButton()) : null;
  return el("div", { class: "page", style: "gap:16px" },
    el("p", { class: "small muted" }, "Open a payment to approve, sign or send it. A payment "
      + "needs " + state.g.t + " of " + state.g.n + " signers."),
    inboxNote(sections.length > 0), ...sections, other);
}

// Approvals that hold Send although the list has no record of their payment: the Overview counts
// them, so the inbox names them.
const lostNote = (ids) => ids.length ? el("p", { class: "row-note" }, (ids.length === 1
  ? "A payment that you approved has" : ids.length + " payments that you approved have")
  + " no record here any more. Send stays held until they can no longer go on chain.") : null;

const openSolanaButton = () => el("button", { class: "btn sm", type: "button",
  onclick: () => { ui.tab = "solana"; render(); } }, "Open Solana");

// The payments of the open wallet by bucket. A payment whose facts cannot be read lands in
// "attention", never out of the list. `lost`: the ids of approvals here that still hold Send
// while the list has no record of their payment (dropped or rewritten).
export function inboxRows() {
  const held = new Set(heldApprovals());
  const rows = Object.fromEntries(BUCKETS.map(([id]) => [id, []]));
  for (const ss of state.sessions) {
    const b = inboxBucket(ss, held);
    if (b) rows[b].push(ss);
  }
  const listed = new Set(state.sessions.map((ss) => ss.id));
  return { ...rows, lost: [...held].filter((id) => !listed.has(id)) };
}

function inboxBucket(ss, held) {
  try {
    const end = ended(ss);
    return bucketOf({
      landed: landed(ss), held: !!ss.error && held.has(ss.id),
      check: !end && signingSeen(ss) && expired(ss),
      review: needsMyApproval(state.gid, ss), step: finishStep(ss), ended: end,
      error: !!ss.error, status: ss.status,
    });
  } catch (e) {
    log("inbox: payment " + ss.id + " not sorted: " + (e && e.message ? e.message : e));
    return "attention";
  }
}

const solInbox = () => solLine({ on: solOn(), error: solError, loading: !!(sol || solLoading),
  setup: solSetup(), toApprove: solPending() });

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
  return el("section", { class: "card" }, el("div", { class: "card-head card-pad", style: "padding-bottom:12px" }, el("h2", {}, "All activity")), activityRows(activity()));
}

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
        + "it only with signers. " + senderNote("each signer")),
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

function detailsTab() {
  return el("div", { class: "page", style: "gap:16px" }, walletFacts(), privacyCard(),
    appearanceCard());
}

function appearanceCard() {
  return el("section", { class: "card card-pad" },
    el("h2", { style: "font-size:15px" }, "This browser"),
    el("p", { class: "small muted" }, "The appearance applies to this browser only. Device "
      + "setting follows the light or dark mode of this device."),
    themeChoice());
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
      + ", which sees your IP address but never a key. On each load, the wallet continues its "
      + "sync from the state that this browser saved."),
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
