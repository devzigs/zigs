// The wallet page: its sections (overview, activity, messages, signers, settings, Solana).
import { fmtInt, seatBackedUp, usesV2 } from "./util.js";
import { IGNORED_NOTE } from "./signed.js";
import { inbox, log, ready, showBanner, state, ui } from "./app-state.js";
import { fmtZec, short, when } from "./app-kit.js";
import { gkeys, mySeatSecrets, sec } from "./app-keystore.js";
import { keysDiffer, localSeats, seatIds, seatMine, seatStage, STAGE_LABEL } from "./app-seats.js";
import { inviteLink, senderNote } from "./app-links.js";
import {
  addrHidden, atCap, balanceNow, balOf, capText, chain, curChain, curNet, explorerText, inFlight,
  netName, readsMemos, runSync, setMemoReading, spanMs,
} from "./app-chain.js";
import { canWriteAs, signedMode } from "./app-filter.js";
import {
  approvalsDone, needsMyApproval, openGroup, openSession, toApprove,
} from "./app-groups.js";
import {
  act, addrGroups, avatar, copyBtn, countBadge, el, groupName, guard, leavesOf, memoTexts, money,
  named, netBadge, payTitle, proposer, ruleText, seatLabel, seatTitle, secretQr, statusChip, unreadable,
} from "./app-dom.js";
import { signing, unreadIn } from "./app-messages.js";
import { groupVersion, rejectedSeats, seatCheck, verifiedCount } from "./app-dkg.js";
import {
  cancelMove, chainReady, ended, expired, heldApprovals, isOpen, landed, proposeMove, sendBlocker,
  signingSeen,
} from "./app-payments.js";
import { finishStep, refusedSend } from "./app-drawer.js";
import { BUCKETS, bucketOf, emptyState, solLine } from "./approvals-model.js";
import { teamConversation } from "./app-thread.js";
import { messagingWorkspace } from "./app-messaging-workspace.js";
import { openBackup, openBackupCheck, restore, staleRestoreNote } from "./app-backups.js";
import { browserSettings, loadingView } from "./app-shell.js";
import { focusAfter, render } from "./app-loop.js";
import { openSend } from "./app-send.js";
import { guidedSetupView, setupView, solSetupCard, solUnfinished } from "./app-setup.js";
import { generalSettings, settingsDisclosure, settingsGroup, settingsLabel, settingsRow } from "./app-settings-ui.js";
import { networkPrivacySettings } from "./app-network-privacy.js";
import { helpView } from "./app-help.js";
import {
  sol, solActivity, solBackup, solBalance, solError, solFile, solLoad, solLoading,
  solActivityWaits, solLoadingCount, solOlderCount, solOn, solPending, solPendingRows, solSetup,
  solNotAdded, solObserveOverview, solSync, solTab,
} from "./app-sol.js";
import { formatUsdBalance, pendingShortcut, solRow, zecInProgress, zecTotal } from "./overview-model.js";
import { icon } from "./app-icons.js";
import { beginGuided, guidedEnabled, guidedState } from "./app-guided-setup.js";
import { descriptionOf, setWalletDescription } from "./wallet-description.js";
import { securityExplanation } from "./app-tutorial.js";
import { privacyBadge, solBalancePrivacy, SOL_EXPOSURE } from "./privacy-language.js";
import { securityDashboard } from "./app-security-dashboard.js";
import { SharedControlVisual } from "./app-approval-visualization.js";
import { sharedControl } from "./app-shared-control.js";
import { walletMark } from "./app-wallet-art.js";
import { walletHeadingMarble } from "./app-wallet-marble.js";
import { fundingOverviewCard, fundingSetupView } from "./app-funding-preview.js";

export function groupView({ showHeader = true } = {}) {
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
  if (ui.tab === "messages") return messagingWorkspace(teamConversation([
    staleRestoreNote(), signedNotes(), networkNote(),
    !ready ? el("button", { class: "btn ghost sm", type: "button",
      onclick: () => { ui.tab = "overview"; render(); } }, "Return to wallet setup") : null,
  ]));
  const destination = ui.tab === "approvals" || ui.tab === "recovery";
  if (!destination && ui.tab !== "settings" && ui.tab !== "messages" && (guidedEnabled()
    || !ready && !state.g.movedFrom && groupVersion() >= 2)) {
    return guidedSetupView([staleRestoreNote(), signedNotes(), networkNote()]);
  }
  const funding = ready && ui.tab === "overview" && localSeats().includes(1)
    ? fundingSetupView(state.gid, g.name) : null;
  if (funding) return el("div", { class: "page guided-setup funding-setup-page" },
    staleRestoreNote(), signedNotes(), networkNote(), funding);
  const why = ready ? sendBlocker() : null;
  const head = [showHeader ? groupHead(g, ready, why) : null,
    staleRestoreNote(), signedNotes(), networkNote()];
  if (!ready && destination) return unfinishedDestination(head, ui.tab);
  return ready ? walletView(head, why) : el("div", { class: "page" }, head, setupView());
}

const openWalletSection = (id) => () => {
  ui.tab = id; focusAfter("panel-" + id, true); render();
};

function unfinishedDestination(head, id) {
  const recovery = id === "recovery", label = recovery ? "Security" : "Approvals";
  return el("div", { class: "page wallet-page" }, head,
    el("section", { class: "panel page", id: "panel-" + id, "data-key": "panel-" + id,
      tabindex: "-1", "aria-label": label }, pageHeading(id, label),
    el("section", { class: "card card-pad" }, el("h3", {}, "Wallet setup is unfinished"),
      el("p", { class: "small muted" }, recovery
        ? "Review the devices and recovery information below, or return to the existing setup checks. Recovery files and file checks are optional."
        : "Payment approvals become available after this wallet’s existing setup checks finish. This is not an empty approval queue."),
      el("button", { class: "btn", type: "button", onclick: openWalletSection("overview") }, "Resume wallet setup")),
    recovery ? securityRecoveryTab(false) : null));
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
// An aborted seat with no key share is not in the wallet that formed: it keeps its reason.
export const walletReady = () => !!(state.wallet && state.wallet.birthday)
  && rejectedSeats().length === 0 && !keysDiffer()
  && !mySeatSecrets(state.gid).some(([, s]) => s.stopped || (s.aborted && !s.keyPackage));

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
    ["members", "Devices"], ["recovery", "Security"], ["settings", "Settings"],
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
  messages: () => teamConversation(),
  members: () => membersTab(), recovery: () => securityRecoveryTab(), settings: () => settingsTab(),
  solana: () => el("div", { class: "sol-wallet-presentation" },
    el("div", { class: "wallet-sol-identity" }, walletMark(state.g, 96),
      el("span", { class: "small muted" }, "Shared wallet · Solana Devnet")), solTab()),
};

// The small line above the title of a section; the others read "This wallet".
const LEAD = { settings: "Wallet and app preferences", solana: "Solana Devnet" };
const EXPLANATION = { members: "device", messages: "chats", solana: "overview" };
const pageHeading = (id, label) => id === "settings"
  ? el("header", { class: "preferences-heading" }, el("h2", {}, label),
    el("p", { class: "muted" }, "Manage your wallet and preferences."))
  : id === "approvals"
  ? el("div", { class: "page-heading approvals-heading" },
    el("div", {}, el("h2", {}, label),
      el("p", { class: "small muted" }, "Review together. Authorise with confidence.")))
  : id === "activity"
  ? el("div", { class: "page-heading activity-heading" }, el("h2", {}, label),
    el("p", { class: "muted" }, "Your wallet’s transactions and payment proposals."))
  : id === "recovery" ? el("div", { class: "page-heading security-page-heading" },
    el("h2", {}, label),
    el("p", { class: "muted" }, "Manage how your wallet is secured, approved and recovered."))
  : el("div", { class: "page-heading" },
  el("span", { class: "label" }, LEAD[id] ?? "This wallet"), el("h2", {}, label),
  securityExplanation(EXPLANATION[id] ?? id));

export function walletView(head, why) {
  const [id, label] = currentSection(walletSections());
  return el("div", { class: "page wallet-page" }, head,
    el("section", { id: "panel-" + id, "data-key": "panel-" + id, tabindex: "-1",
      "aria-label": label, class: "panel" }, id === "overview" ? null : pageHeading(id, label), BODIES[id]()));
}

export const walletHeader = (g = state.g) => groupHead(g, true, null, true);

function groupHead(g, ready, why, persistent = false) {
  const seated = seatIds().filter((i) => state.seats[i]).length;
  const old = state.groups.find((x) => x.id === g.movedFrom);
  const approvals = ui.tab === "approvals", overview = ready && ui.tab === "overview";
  const recovery = ui.tab === "recovery", compact = persistent || approvals || overview || recovery;
  return el("header", { class: "page-head wallet-topbar"
    + (persistent ? " wallet-context-header" : approvals ? " approvals-topbar" : overview ? " overview-topbar"
      : recovery ? " security-topbar" : ""),
    ...(persistent ? { "data-wallet-context": g.id, "aria-label": "Selected wallet" } : {}) },
    el("div", { class: "ph-left wallet-identity" },
      walletHeadingMarble(g),
      el("div", { class: "wallet-name-block" }, el("h1", {}, g.name),
        descriptionOf(g.id).text
          ? el("p", { class: "small wallet-description" }, descriptionOf(g.id).text) : null)),
      el("div", { class: "ph-meta wallet-meta" },
        netBadge(g),
        !compact ? el("span", { class: "badge plain", title: ruleText(g.t, g.n) },
          "Any " + g.t + " of " + g.n + " devices") : null,
        !compact ? el("span", { class: "stack" }, seatIds().map((i) => avatar(i))) : null,
        !compact ? el("span", {}, seated + " of " + g.n + " devices joined") : null,
        g.movedFrom
          ? el("span", {}, "Replaces " + ((old || {}).name || "an older wallet")) : null),
      el("button", { class: "btn ghost wallet-home", type: "button", "data-key": "wallet-home",
        onclick: () => { ui.tab = "overview"; focusAfter("home-page", true); openGroup(null); } },
        icon("home"), "Return home"));
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
    }, many ? "Back up device " + i : "Back up key share")),
    solSeats.map((i) => el("button", {
      class: "btn sm", type: "button", onclick: act(() => solBackup(i)),
    }, "Back up Solana, device " + i)));
}
const SOL_FILE = "The Solana part of a device is a second file, with its own passphrase.";

function overviewTab() {
  solObserveOverview();
  const c = curChain();
  return el("div", { class: "page overview-page" },
    state.g.movedTo ? moveCard(c) : null,
    localSeats().includes(1) && !state.g.movedTo
      ? fundingOverviewCard(state.gid, state.g.name) : null,
    pendingCard(),
    solUnfinished() ? solSetupCard() : null,
    el("div", { class: "overview-layout premium-overview-grid" },
      balanceOverview(),
      el("section", { class: "asset-section", "aria-labelledby": "assets-title" },
        el("div", { class: "section-heading" },
          el("h2", { id: "assets-title" }, "Your assets")),
        el("div", { class: "assets-grid asset-rows" }, zecAsset(c), solAsset(), usdcAsset())),
      el("aside", { class: "overview-rail", "aria-label": "Wallet status and transactions" },
        overviewTransactions(), sharedControl({ required: state.g.t, total: state.g.n, context: state.gid,
        status: state.g.shapeMoved ? "Configuration mismatch" : "Wallet formed",
        attention: !!state.g.shapeMoved,
        participants: seatIds().map((i) => ({ id: i, name: seatLabel(i),
          joined: state.seats[i] ? true : state.seatsLoaded && state.seatsSettled ? false : null })),
        openSecurity: openWalletSection("recovery") }))));
}

function balanceOverview(valuation = null) {
  // This branch has no valuation source. The fallback never enters wallet or pricing state.
  const value = formatUsdBalance(valuation);
  return el("section", { class: "overview-hero", "aria-labelledby": "total-balance-title" },
    el("div", { class: "overview-wallet-summary" }, walletMark(state.g, 64),
    el("div", { class: "portfolio-summary" }, el("div", { class: "balance-heading" },
      el("h2", { id: "total-balance-title", class: "label" }, "Portfolio balance"),
      el("span", { class: "portfolio-currency" }, "USD")),
    el("p", { class: "portfolio-value", role: "img", "aria-label": value.text,
      "data-valuation-state": value.known ? "known" : "unknown",
      "aria-describedby": value.known ? null : "usd-placeholder" },
    el("span", { "aria-hidden": "true" }, value.whole),
    el("span", { class: "portfolio-decimals", "aria-hidden": "true" }, value.fraction)),
    !value.known ? el("p", { class: "portfolio-placeholder", id: "usd-placeholder" },
      el("span", { class: "placeholder-indicator" }, "Placeholder"),
      el("span", { class: "sr-only" }, "USD valuation is unknown. The displayed $0.00 is not a confirmed balance.")) : null,
    state.g.network === "testnet" ? el("p", { class: "portfolio-network-note" }, "Test funds have no cash value.") : null)),
    el("div", { class: "overview-actions" }, assetActionPicker("send"), assetActionPicker("receive"),
      el("button", { class: "btn", type: "button", disabled: true,
        title: "Swap unavailable", "aria-describedby": "overview-swap-unavailable" },
        icon("swap"), "Swap")),
    el("p", { class: "sr-only", id: "overview-swap-unavailable" }, "Swap is unavailable in this version."));
}

// HTML disclosures keep their own keyboard and dismissal behavior. Asset choices open the
// existing forms, with the same validation, blockers and payment handlers as the asset cards.
function assetActionPicker(action) {
  const sending = action === "send", label = sending ? "Send" : "Receive", why = sending ? sendBlocker() : null;
  const zec = () => {
    if (sending) openSend({ pay: null, note: "", priority: false, sendFor: null, after: null });
    else ui.receive = true;
    render();
  };
  const choose = (id, title, detail, disabled, onclick) => el("button", {
    class: "asset-choice", type: "button", disabled, onclick,
    "aria-describedby": "choose-" + action + "-" + id,
  }, el("span", { class: "coin-mark" }, icon(id)),
  el("span", { class: "asset-choice-copy" }, el("strong", {}, title),
    el("span", { class: "small muted", id: "choose-" + action + "-" + id }, detail)),
  el("span", { class: "chev", "aria-hidden": "true" }, "›"));
  return el("details", { class: "overview-action-picker" },
    el("summary", { class: "btn" + (sending ? " primary" : "") }, icon(action), label),
    el("div", { class: "asset-choices" }, el("p", { class: "label" }, label + " · choose an asset"),
      choose("zec", "ZEC", why || "Zcash " + netName(state.g) + " · shielded", !!why, zec),
      choose("sol", "SOL", solOn() ? "Solana Devnet · opens this wallet’s Solana tools"
        : "Unavailable for this wallet", !solOn(),
      () => sending ? openSolanaControl("sol-send-to") : openSolanaReceive()),
      choose("usdc", "USDC", "Solana Devnet · unavailable; do not deposit", true, null)));
}

function overviewTransactions() {
  const recent = ui.overviewActivity === "recent";
  const choose = (id, label) => el("button", { class: "btn", type: "button",
    "aria-pressed": String(recent === (id === "recent")),
    onclick: () => { ui.overviewActivity = id; render(); } }, label);
  return el("section", { class: "overview-transactions", "aria-labelledby": "transactions-title" },
    el("div", { class: "section-heading transaction-heading" },
      el("h2", { id: "transactions-title" }, "Transactions"),
      el("div", { class: "transaction-views", role: "group", "aria-label": "Transaction view" },
        choose("pending", "Pending"), choose("recent", "Recent"))),
    recent ? recentTransactions() : el("div", { class: "overview-approvals", id: "overview-approvals",
      "data-key": "overview-approvals", tabindex: "-1", "aria-labelledby": "approvals-title" },
    overviewApprovalSummary()));
}

function overviewApprovalSummary() {
  const rows = inboxRows(), sol = solInbox();
  const shown = BUCKETS.filter(([id]) => rows[id].length);
  const zecPreview = rows.review.slice(0, 3);
  const solPreview = sol?.kind === "review" ? solPendingRows().slice(0, 3 - zecPreview.length) : [];
  if (!shown.length && !rows.lost.length && emptyApprovalsRead(sol))
    return transactionEmpty("No approvals waiting", "approvals-title");
  return el("section", { class: "card card-pad overview-inbox-summary" },
    el("div", { class: "card-head" }, el("h3", { id: "approvals-title" }, "Approvals"),
      el("button", { class: "btn", type: "button", onclick: openWalletSection("approvals") }, "View all approvals")),
    inboxNote(shown.length > 0 || rows.lost.length > 0),
    zecPreview.length || solPreview.length ? el("div", { class: "list stacked approval-preview" },
      zecPreview.map((ss) => guard(approvalRow, ss)),
      solPreview.map((row) => guard(solInboxRow, row))) : null,
    shown.length ? el("dl", { class: "approval-summary-list" }, shown.map(([id, label]) => [
      el("dt", {}, "Zcash · " + label), el("dd", {}, String(rows[id].length)),
    ]).flat()) : null,
    rows.lost.length ? lostNote(rows.lost) : null,
    sol ? el("p", { class: "small muted" }, sol.text) : null,
    el("p", { class: "small muted" }, "Open Approvals to review payments, waiting devices and items needing attention. Chat messages are separate."));
}

function recentTransactions() {
  const list = activity().slice(0, 5);
  if (!list.length && state.sessionsLoaded && !state.sessionsFailed && !state.pending
    && historyState() === "ready" && !solReading("all"))
    return el("div", { class: "recent-transactions" },
      transactionEmpty("No recent transactions"), activityNote("all"));
  return el("section", { class: "card recent-transactions", "aria-labelledby": "recent-title" },
    el("div", { class: "card-head card-pad" }, el("h3", { id: "recent-title" }, "Recent transactions"),
      el("button", { class: "btn ghost sm", type: "button", onclick: () => { ui.tab = "activity"; render(); } }, "View all activity")),
    activityRows(list), receivedNote(list), list.length ? historyNote("all") : null, activityNote("all"));
}

// Decorative blank list, not loading placeholders or invented transactions.
function transactionEmpty(text, id = null) {
  const approvals = /approval/i.test(text);
  return el("section", { class: "card transaction-empty", role: "status" },
    el("span", { class: "transaction-empty-mark", "aria-hidden": "true" }, icon(approvals ? "security" : "activity")),
    el("div", {}, el("p", { class: "transaction-empty-label", id }, text),
      el("p", { class: "transaction-empty-detail" }, approvals
        ? "Transactions requiring your approval will appear here."
        : "Your wallet’s transactions will appear here.")));
}

function emptyApprovalsRead(sol) {
  const why = emptyState({ loaded: state.sessionsLoaded, failed: state.sessionsFailed,
    checking: state.pending, synced: chainReady(curChain()), ignored: state.ignored,
    sol: solOn() });
  return ["empty", "zec"].includes(why) && (!sol || sol.kind === "info"
    && solSetup()?.status === "ready" && !solLoadingCount() && !solOlderCount());
}

// The row of a received payment opens the explorer: the note says what that site sees.
const receivedNote = (list) => list.some((a) => a.r) ? el("p", { class: "small muted card-pad" },
  explorerText(curNet(), "A received payment in this list")) : null;

// A move sends the Zcash funds only (proposeMove). solOn() says only that the wallet can have a
// Solana part, so the text holds with or without one. The Solana key shares stay with the seats.
export const SOL_STAYS = "If this wallet has a Solana part, it does not move this way: check it "
  + "in its Solana section. A device that is left out keeps its key share of that part, so it can "
  + "still read the Solana history and approve Solana payments.";
/**
 * SOL_STAYS after a space, for a wallet that can have a Solana part (solOn) unless its start
 * documents say that it has none (solNotAdded). Before they arrive the sentence shows: it holds
 * with or without a Solana part.
 */
export const solStays = () => (solOn() && !solNotAdded() ? " " + SOL_STAYS : "");
const movePayment = () => state.sessions.find((x) => x.move === state.g.movedTo && !x.error
  && !ended(x));

/**
 * The word of a wallet that a new wallet replaces, for the wallet list and the side list: "ZEC
 * moved" once the move is done as of the last sync, else "Moving". The open wallet reads its move
 * payment (moveState). Another wallet with a seat here reads its checked payments (inbox) and the
 * balance that this browser saved at its last sync (movedHere). Without the payments of the
 * wallet, the word is "Replaced".
 */
export function moveWord(g) {
  if (g.id === state.gid && state.g) return moveState(curChain()).done ? "ZEC moved" : "Moving";
  const list = inbox[g.id];
  if (!list) return "Replaced";
  return movedHere(g, list) ? "ZEC moved" : "Moving";
}

// A move of a listed wallet is done: a move payment to its current new wallet was sent, and the
// balance saved after that send holds no Zcash. A wallet that was empty before its move has no
// move payment, and a balance saved before the send says nothing of the move.
function movedHere(g, list) {
  const sent = list.find((ss) => ss.move === g.movedTo && !!ss.broadcastTxid && !ss.error);
  const bal = balOf(g.id);
  return !!sent && !!bal && bal.total === 0 && bal.at > sent.broadcastAt;
}

// The steps of a move, read from the old wallet: new wallet ready, payment proposed, funds gone.
export function moveState(c) {
  const m = moveStep(c, state.g.movedTo);
  return { ...m, text: m.text + solStays() };
}

function moveStep(c, to) {
  if (!gkeys[to]) {
    return { text: "Someone started moving this wallet to a new one. If one of your devices is "
      + "in the new wallet, ask its creator for its invite link." };
  }
  if (!ready[to]) {
    return { text: groupName(to) + " is still setting up. When its address is ready, move the "
      + "Zcash funds here.", open: to };
  }
  const ss = movePayment();
  return ss ? paymentStep(c, ss, to) : proposeStep(to);
}

// The move payment exists. An empty balance counts as of the last sync only, and before a sync
// the page knows only that a device sent the payment.
function paymentStep(c, ss, to) {
  if (!ss.broadcastTxid) {
    return { text: "Moving the Zcash funds to " + groupName(to) + " is in progress. Open the "
      + "payment to approve it or take the next step.", session: ss };
  }
  if (inFlight().includes(ss)) {
    return { text: "The Zcash funds are on their way to " + groupName(to) + ". They arrive with "
      + "the next block.", open: to };
  }
  const b = c && c.bal ? balanceNow(c.bal) : null;
  if (!b) return sentStep(to);
  if (b.spendable + b.pending !== 0) return proposeStep(to);
  return { text: "The Zcash funds moved to " + groupName(to) + ", as of the last sync.", open: to,
    done: true };
}

const sentStep = (to) => ({ text: "A device sent the Zcash funds to " + groupName(to) + ". This "
  + "browser has not synced yet, so it cannot show if they arrived.", open: to });
const proposeStep = (to) => ({ text: groupName(to) + " is ready. Move the Zcash funds to it. "
  + "Like any payment, this needs " + state.g.t + " approvals.", propose: true });

function moveCard(c) {
  const m = moveState(c), why = m.propose ? sendBlocker() : null;
  return el("section", { class: "card card-pad " + (m.done ? "" : "attention") },
    el("div", { class: "card-head" },
      el("h3", {}, m.done ? "The Zcash funds moved" : "Changing devices")),
    el("p", { class: "small muted" }, m.text),
    el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, moveButtons(m, c, why)),
    why ? el("p", { class: "small faint" }, why) : null);
}

// Cancel stays until the move payment exists.
function moveButtons(m, c, why) {
  const amount = c && c.bal ? c.bal.max_send : 0;
  const openNew = () => { ui.tab = "overview"; openGroup(m.open); };
  return [
    m.propose ? el("button", { class: "btn primary", type: "button", disabled: !!why, title: why,
      onclick: act(() => proposeMove()) }, "Move " + fmtZec(amount)) : null,
    m.session ? el("button", { class: "btn primary", type: "button",
      onclick: () => openSession(m.session.id) }, "Open the payment") : null,
    m.open ? el("button", { class: "btn", type: "button", onclick: openNew },
      "Open " + groupName(m.open)) : null,
    movePayment() ? null : el("button", { class: "btn ghost", type: "button",
      onclick: act(cancelMove) }, "Cancel move"),
  ];
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
      onclick: openWalletSection("approvals") }, "Review"));
}

const assetHead = (id, symbol, network) => el("div", { class: "asset-title" },
  el("span", { class: "coin-mark" }, icon(id)),
  el("div", {}, el("h3", { id: "asset-" + id }, symbol), el("p", {}, network)));

function zecAsset(c) {
  const b = c && c.bal ? balanceNow(c.bal) : null;
  const amount = (zat, size = "md") => b ? money(zat, size)
    : el("span", { class: "skel", role: "img", "aria-label": "Loading balance" });
  const status = c?.error ? (b ? "Sync failed · saved balance" : "Sync failed") : c?.syncing ? "Syncing…"
    : c?.bal ? "Up to date" : "Not synced yet";
  return el("section", { class: "card card-pad asset-card asset-row", "aria-labelledby": "asset-zec" },
    el("div", { class: "asset-row-main" },
    el("div", { class: "asset-position" },
      assetHead("zec", "Shielded ZEC", "Zcash " + netName(state.g)),
      privacyBadge(el, "shielded")),
    el("div", { class: "asset-balance-block" }, el("span", { class: "label" }, "Available"),
      amount(b?.spendable, "xl"),
      el("p", { class: "asset-row-status small muted", role: "status" }, status),
      b?.pending ? el("p", { class: "asset-incoming small muted" }, "Incoming ", amount(b.pending)) : null),
    shieldingActions("zec", false)),
    b?.sending ? sendingLine(b.sending) : null, atCap() ? capNote() : null,
    assetNote("zec", "Balance details", [
      emptyNote(b), syncLine(c), shieldingBreakdown("zec"),
      el("p", { class: "asset-total" }, "Total shielded balance ", amount(zecTotal(b))),
      el("p", {}, "Includes available and incoming ZEC."),
      el("p", { id: "zec-shielding-note" }, "Percentages unavailable: this wallet tracks shielded ZEC only. Unshielded ZEC balances and shield/unshield transfers are not supported."),
    ]));
}

// Main has no complete, same-scope shielded/unshielded balance pair for these assets. Unknown
// percentages stay unknown, including empty wallets; fee-account SOL is not wallet holdings.
function shieldingBreakdown(id) {
  return el("p", { class: "asset-shielding small muted", "aria-describedby": id + "-shielding-note" },
    el("span", { class: "privacy-unknown-mark", "aria-hidden": "true" }, "?"), "Privacy breakdown unavailable");
}

const assetNote = (id, title, content) => el("details", { class: "asset-note", id: id + "-asset-details" },
  el("summary", { "aria-label": id.toUpperCase() + " · " + title },
    el("span", { class: "asset-details-label" }, title)),
  el("div", { class: "asset-note-body small muted" }, content));

function shieldingActions(id, available) {
  const note = id + "-shielding-note";
  return el("div", { class: "row-actions shielding-actions" },
    el("button", { class: "btn", type: "button", disabled: !available, "aria-describedby": note,
      onclick: available ? () => openSolanaControl("sol-add-amount") : null }, icon("security"), "Shield"),
    el("button", { class: "btn", type: "button", disabled: !available, "aria-describedby": note,
      onclick: available ? () => openSolanaControl("sol-withdraw-to") : null }, icon("unshield"), "Unshield"));
}

const sendingLine = (zat) => el("div", { class: "sending" }, el("span", { class: "dot busy" }),
  "Sending ", money(zat, "md", "out"), el("span", { class: "faint" }, " · waiting for a block"));

// The faucet is a site that is not Zigs (PRIVACY.md).
export const FAUCET_TEXT = "That site is not Zigs: it sees the address that you paste and your "
  + "IP address. Its public status lists each payout with a short form of the address, the "
  + "transaction id, the amount and the time.";
function emptyNote(b) {
  if (!b || b.spendable + b.pending + b.sending !== 0 || state.g.movedTo) return null;
  return el("div", { class: "callout" }, curNet().faucet
    ? el("span", {}, "This wallet is empty. Share its address to receive ZEC, or get free "
      + "testnet ZEC from a ", el("a", { href: curNet().faucet, target: "_blank",
      rel: "noopener" }, "faucet ↗"), ". " + FAUCET_TEXT)
    : el("span", {}, "This wallet is empty. Share its address to receive ZEC. Keep it under "
      + capText(curNet().cap) + ": the app warns at that level. It cannot block deposits."));
}
const SOL_NOTE = {
  synced: "The private balance of the group at the last sync. Open Solana for payments, deposits "
    + "and the fee addresses.",
  saved: "The private balance at the last saved sync. It updates automatically when the wallet is ready.",
  stale: "The last sync failed. This balance comes from an earlier sync. Automatic retries follow the existing backoff; technical details include a manual retry.",
  syncing: "The private balance of the group is syncing.",
  resync: "A sync runs. This balance comes from an earlier sync.",
  unsynced: "The private balance syncs automatically when this wallet’s required checks finish.",
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
  if (!row) return el("section", { class: "card card-pad asset-card asset-row asset-unavailable", "aria-labelledby": "asset-sol" },
    el("div", { class: "asset-row-main" },
    el("div", { class: "asset-position" }, assetHead("sol", "SOL", "Solana Devnet"),
      solBalancePrivacy(el, row)),
    el("div", { class: "asset-balance-block" }, el("span", { class: "label" }, "Wallet balance"),
      el("p", { class: "asset-balance unknown" }, "Unavailable"),
      el("p", { class: "asset-row-status small asset-row-warning" }, "Do not send SOL to the Zcash address.")),
    shieldingActions("sol", false)),
    assetNote("sol", "Solana details", [
      shieldingBreakdown("sol"),
      el("p", { id: "sol-unavailable" }, "Solana is available only for eligible version 3 testnet wallets. Do not send SOL to the Zcash address."),
      el("p", { id: "sol-shielding-note" }, "Shielded and unshielded percentages are unavailable for this wallet."),
    ]));
  const amount = /^[\d.]+ SOL$/.test(row.text) ? solAmount(row.text)
    : el("p", { class: "asset-balance unknown" }, row.text);
  const status = { synced: "At last sync", saved: "Saved balance", stale: "Sync failed · saved balance",
    resync: "Syncing · saved balance" }[row.state];
  return el("section", { class: "card card-pad asset-card asset-row asset-state-" + row.state, "aria-labelledby": "asset-sol" },
    el("div", { class: "asset-row-main" },
    el("div", { class: "asset-position" }, assetHead("sol", "SOL", "Solana Devnet"),
      solBalancePrivacy(el, row)),
    el("div", { class: "asset-balance-block" }, el("span", { class: "label" }, "Wallet balance"), amount,
      status ? el("p", { class: "asset-row-status small muted", role: "status" }, status) : null),
    shieldingActions("sol", true)),
    assetNote("sol", "Balance & privacy details", [
      el("p", {}, row.state === "failed" ? solError : SOL_NOTE[row.state]),
      el("p", {}, SOL_EXPOSURE), shieldingBreakdown("sol"),
      el("p", { id: "sol-shielding-note" }, "Percentages unavailable. Device fee funds are separate from wallet holdings. "
        + "Shield uses this device’s public fee funds. Unshield opens a public withdrawal requiring wallet approvals."),
      el("p", {}, "Shield and Unshield open the existing Solana forms. Setup and fee-address requirements still apply. Solana privacy differs from Zcash; review the disclosures there."),
    ]));
}

function usdcAsset() {
  return el("section", { class: "card card-pad asset-card asset-row asset-unavailable", "aria-labelledby": "asset-usdc" },
    el("div", { class: "asset-row-main" },
    el("div", { class: "asset-position" }, assetHead("usdc", "USDC", "Solana Devnet"),
      privacyBadge(el, "unsupported")),
    el("div", { class: "asset-balance-block" }, el("span", { class: "label" }, "Wallet balance"),
      el("p", { class: "asset-balance unknown" }, "Unavailable"),
      el("p", { class: "asset-row-status small asset-row-warning" }, "Do not deposit USDC to this wallet.")),
    shieldingActions("usdc", false)),
    assetNote("usdc", "USDC details", [
      shieldingBreakdown("usdc"),
      el("p", { id: "usdc-unavailable" }, "Shielded USDC is unavailable in this version. No balance is available. Do not deposit USDC to this wallet."),
      el("p", { id: "usdc-shielding-note" }, "No shielded or unshielded USDC balance is available. Shield and Unshield are unavailable."),
    ]));
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

/** The note of a wallet that a new wallet replaces: its senders must use the new address. */
export const movedNote = () => el("div", { class: "callout" }, "Change devices replaces this "
  + "wallet with " + groupName(state.g.movedTo) + ". Ask senders to use the new wallet's address.");

function receiveCard() {
  const w = state.wallet;
  return el("section", { class: "card card-pad" },
    el("div", { class: "card-head" }, el("h3", {}, "Receive"),
      privacyBadge(el, addrHidden() ? "unknown" : "shielded")),
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

// The history of the Zcash side: "waiting" before the sync of this wallet starts, "failed" after a
// failed sync, "syncing" before a sync finished.
function historyState() {
  const c = curChain();
  if (!c) return "waiting";
  if (c.error) return "failed";
  return chainReady(c) ? "ready" : "syncing";
}
const HISTORY = {
  waiting: ["Not synced yet", "Sync starts after this device checks the address."],
  syncing: ["Reading the chain", "Payments you received show after the first sync."],
  failed: ["The sync failed", "This list can be incomplete. Use Refresh in the ZEC card on the "
    + "Overview."],
};
const SOL_READING = ["Reading the Solana transactions",
  "Solana payments of this wallet show after Zigs reads them."];
// The Solana rows of a wallet with a Solana part are not read yet, or not all checked yet.
const solReading = (pick) => pick !== "zec" && solPart()
  && (solActivity() === null || solActivityWaits());
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
    return el("div", { class: "empty workflow-empty", style: line },
      el("span", { class: "empty-illustration", "aria-hidden": "true" }, icon("activity")), el("h3", {}, head),
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

const chooseChain = (value) => { ui.chainFilter = value; render(); };
const chainSelect = (pick) => el("div", { class: "activity-filters", role: "group", "aria-label": "Filter activity by network" },
    CHAIN_FILTERS.map(([value, label]) =>
      el("button", { type: "button", class: "activity-filter-chip", "data-key": "activity-filter-" + value,
        "aria-pressed": String(pick === value), onclick: () => chooseChain(value) },
      value === "all" ? "All activity" : label)));

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
  return SOL_ACTIVITY_NOTE + solLacks();
}
// The Solana rows that the list lacks: older proposals, and proposals that wait for their check.
const solLacks = () => (solOlderCount() > 0 ? " Older Solana proposals are not listed." : "")
  + (solActivityWaits() ? " Zigs still reads some Solana proposals, so more rows can show." : "");
function activityNote(pick) {
  const text = pick === "zec" ? null : solNoteText();
  return text ? noteRow(text) : null;
}

function sentRow(ss, flying) {
  const chip = needsMyApproval(state.gid, ss) ? el("span", { class: "badge warn" }, "Your approval")
    : flying.has(ss) ? el("span", { class: "badge info" }, "Confirming")
      : statusChip(ss, approvalsDone(ss) === true);
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
    subs.map((text) => el("span", { class: "ri-sub" }, text)),
    privacyBadge(el, r.added ? "public" : "unknown", r.added ? "Public transfer" : "Privacy in details")),
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
      privacyBadge(el, "shielded"),
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
    return el("section", { class: "approval-section approval-section--" + id, "aria-label": label },
      el("div", { class: "approval-section-head" }, el("h3", {}, label),
        el("span", { class: "approval-section-count" }, String(count))),
      el("div", { class: "approval-requests" }, list.map((ss) => guard(approvalRequest, ss, id, flying)), extra,
        lost));
  }).filter(Boolean);
  const other = sol && !["review", "attention"].includes(sol.kind)
    ? el("p", { class: "small muted row-actions" }, sol.text, " ", openSolanaButton()) : null;
  return el("div", { class: "approvals-layout" },
    el("div", { class: "approvals-queue" }, inboxNote(sections.length > 0), ...sections, other),
    el("aside", { class: "approvals-support", "aria-label": "Wallet shared control" },
      SharedControlVisual({ required: state.g.t, total: state.g.n, loaded: state.seatsLoaded,
        participants: seatIds().map((i) => ({ id: i, name: state.seats[i] ? named(i) : "Device " + i,
          joined: !!state.seats[i] })) })),
    el("div", { class: "approval-history-link" },
      el("div", {}, el("h3", {}, "Previous payments"),
        el("p", { class: "small muted" }, "Review recorded payments and their outcomes in Activity.")),
      el("button", { class: "btn ghost sm", type: "button", onclick: openWalletSection("activity") }, "View activity", icon("activity"))));
}

// Proposal amounts and recipients are labelled as such. No per-payment approval count is
// available in the inbox; the existing drawer reads and verifies those records when opened.
function approvalRequest(ss, bucket, flying) {
  return el("button", { class: "approval-request approval-request--" + bucket, type: "button",
    "data-key": "pay-" + ss.id, "aria-current": ss.id === state.sid ? "true" : "false",
    onclick: () => openSession(ss.id) },
    el("span", { class: "approval-request-top" },
      el("span", { class: "approval-request-type" }, icon("send"), "Outgoing payment"),
      el("span", { class: "small muted" }, when(ss.createdAt))),
    el("span", { class: "approval-request-amount" }, money(ss.amount, "lg")),
    el("span", { class: "approval-request-recipient" }, payTitle(ss)),
    el("span", { class: "approval-request-meta" }, "Zcash " + curNet().label
      + " · Proposed by " + proposer(ss)),
    el("span", { class: "approval-request-bottom" },
      el("span", { class: "approval-request-status" }, flying.has(ss) ? "Waiting for a block"
        : bucket === "review" ? "Awaiting your approval" : [bucket === "waiting" ? "Waiting · " : "",
          statusChip(ss, approvalsDone(ss) === true)]),
      el("span", { class: "approval-request-action" }, "Review transaction", el("span", { "aria-hidden": "true" }, "↗"))),
    el("span", { class: "approval-request-disclosure" }, "Proposed amount · verify recipient and total cost in review"));
}

// Approvals that hold Send although the list has no record of their payment: the Overview counts
// them, so the inbox names them.
const lostNote = (ids) => ids.length ? el("p", { class: "row-note" }, ids.length === 1
  ? "A payment that you approved has no record here any more. Send stays held until it can no "
    + "longer go on chain."
  : ids.length + " payments that you approved have no record here any more. Send stays held "
    + "until they can no longer go on chain.") : null;

const openSolana = () => { ui.tab = "solana"; render(); };
const openSolanaReceive = () => {
  ui.tab = "solana";
  if (sol) focusAfter("sol-receive", true);
  render();
};
// Form controls already present in the loaded Solana view use the render loop’s normal keys.
// Loading and setup screens keep their own focus when no payment form exists yet.
const openSolanaControl = (id) => {
  ui.tab = "solana";
  if (sol) focusAfter("INPUT:" + id + ":0", true);
  render();
};
const openSolanaButton = () => el("button", { class: "btn sm", type: "button",
  onclick: openSolana }, "Open Solana");

// The Solana part of a bucket: in review, one row for each proposal that waits for this browser
// (the rule of the count); else, or while the list is empty, the one line of solLine. A row opens
// the Solana section, which holds the Approve buttons, as a Zcash row opens its drawer.
function solExtra(line, id) {
  if (!line || line.kind !== id) return null;
  const list = id === "review" ? solPendingRows() : [];
  return list.length ? list.map(solApprovalRequest)
    : el("p", { class: "row-note" }, line.text, " ", openSolanaButton());
}
// The existing Solana adapter supplies a title and proposer, not structured amounts or counts.
// Keep that summary intact and open the existing Solana review; do not infer missing facts.
function solApprovalRequest(r) {
  return el("button", { class: "approval-request approval-request--review", type: "button",
    "data-key": "sol-" + r.id, onclick: openSolana },
    el("span", { class: "approval-request-type" }, icon("send"), "Solana proposal"),
    el("span", { class: "approval-request-recipient" }, r.title),
    el("span", { class: "approval-request-meta" }, "Solana Devnet · Proposed by " + proposer({ by: r.by })),
    el("span", { class: "approval-request-bottom" },
      el("span", { class: "approval-request-status" }, "Awaiting your approval"),
      el("span", { class: "approval-request-action" }, "Review in Solana", el("span", { "aria-hidden": "true" }, "↗"))),
    el("span", { class: "approval-request-disclosure" }, "Open Solana to inspect the complete proposal before approving."));
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
  zec: "No Zcash payment waits for this browser, the other devices or the network.",
  empty: "No payment waits for this browser, the other devices or the network.",
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
  if (rows) return el("p", { class: "small muted", role: "status" }, INBOX_EMPTY[why]);
  const empty = why === "empty" || why === "zec";
  return el("section", { class: "approval-empty", role: "status" },
    el("span", { class: "approval-empty-mark", "aria-hidden": "true" }, icon("devices")),
    el("div", {}, el("h3", {}, empty ? (why === "zec" ? "No Zcash approvals waiting" : "No approvals waiting")
      : why === "loading" ? "Checking payments" : why === "syncing" ? "Syncing this wallet" : "Some records could not be verified"),
    el("p", {}, empty ? "Payment requests and transactions in progress will appear here." : INBOX_EMPTY[why]),
    empty ? el("p", { class: "approval-empty-detail" }, INBOX_EMPTY[why]) : null));
}

function activityTab() {
  const pick = chainPick(), all = activity(), list = all.filter(KEEP[pick]);
  return el("section", { class: "activity-workspace", "aria-label": "Recorded wallet activity" },
    el("div", { class: "activity-toolbar" },
      solPart() ? chainSelect(pick) : el("span", { class: "activity-network small muted" }, "Zcash activity"),
      el("span", { class: "activity-record-count small muted", role: "status" },
        (!list.length && (solModuleUnread(pick) || solReading(pick) || (pick !== "sol" && historyState() !== "ready"))
          ? "History not fully read" : list.length + (list.length === 1 ? " record" : " records"))
          + (pick === "all" ? "" : " · " + (pick === "sol" ? "Solana" : "Zcash")))),
    activityLimit(pick),
    el("div", { class: "activity-ledger" },
      list.length ? activityRows(list, pick, "") : activityEmpty(pick, all.length > 0),
      list.length ? historyNote(pick) : null),
    receivedNote(list),
    el("details", { class: "activity-history-help" },
      el("summary", {}, "About this history"),
      securityExplanation("activity")));
}

// Decorative ledger engraving, not sample transactions or a transaction-status indicator.
const activityTimeline = () => el("span", { class: "activity-timeline", "aria-hidden": "true" },
  [0, 1, 2].map((i) => el("span", { class: "activity-timeline-track track-" + i },
    el("i", {}), el("span", {}), el("b", {}))));

function activityEmpty(pick, filtered) {
  const [head, text] = solModuleUnread(pick) && (pick === "sol" || historyState() === "ready")
    ? [solError ? "Solana history unavailable" : "Loading Solana activity", solModuleNote()]
    : emptyText(pick);
  const complete = head === "No activity yet";
  return el("div", { class: "activity-empty" + (complete ? "" : " activity-unavailable"), role: "status" },
    activityTimeline(),
    el("h3", {}, complete ? filtered ? "No matching activity" : "Your activity starts here" : head),
    el("p", { class: "small muted" }, complete && filtered
      ? "No recorded activity matches this network. Choose All activity to see the other records." : text),
    complete && filtered ? el("button", { class: "btn ghost sm", type: "button",
      "data-key": "activity-reset", onclick: () => {
        focusAfter("activity-filter-all", true); chooseChain("all");
      } }, "Show all activity") : null);
}

function activityLimit(pick) {
  const text = pick === "zec" ? null : solNoteText() || (solModuleUnread(pick) ? solModuleNote() : null);
  if (!text) return null;
  const status = solSetup()?.status;
  const title = solOn() && solError ? "Solana history unavailable"
    : solModuleUnread(pick) ? "Loading Solana activity"
    : status === "stopped" ? "Solana is stopped"
      : status === "differs" ? "Solana keys differ"
        : status === "running" ? "Solana setup in progress"
          : solActivity() === null ? "Reading Solana activity" : "Solana activity may be incomplete";
  return el("details", { class: "activity-limitation" },
    el("summary", {}, el("span", { class: "activity-info-mark", "aria-hidden": "true" }, "i"),
      el("span", {}, title)),
    el("div", { class: "activity-limitation-body small muted" }, el("p", {}, text)));
}

// Read existing module availability flags without starting or retrying a network operation.
const solModuleUnread = (pick) => pick !== "zec" && solOn() && !sol && !!(solLoading || solError);
const solModuleNote = () => solError
  ? "Solana did not load, so its transactions are not shown here. Open Solana for details."
  : "Solana is still loading. Its activity is not available yet.";

function deviceRoster() {
  return el("section", { class: "card" },
      el("div", { class: "card-pad", style: "padding-bottom:14px" },
        el("div", { class: "card-head" },
          el("span", { class: "small muted" }, ruleText(state.g.t, state.g.n)))),
      el("div", { style: "border-top:1px solid var(--line)" },
        seatIds().map((i) => guard(memberRow, i))));
}

function membersTab() {
  return el("div", { class: "page", style: "gap:16px" }, deviceRoster(),
    changeSignersCard(),
    el("section", { class: "card card-pad" },
      el("h3", { style: "font-size:15px" }, "Invite link"),
      el("p", { class: "small muted" }, "To use a device of this wallet in another browser, open "
        + "this invite link there and restore the backup file of its key share. The link holds "
        + "the wallet secret, so share it only with the people who use this wallet. "
        + senderNote("each person who opens it")),
      el("div", { class: "row-actions" }, copyBtn(inviteLink(state.gid), "Copy link")),
      secretQr(inviteLink(state.gid), "wallet", true)));
}

// FROST fixes the signers when the key is made, so a change means a new wallet and one payment.
function changeSignersCard() {
  const moving = !!state.g.movedTo;
  return el("section", { class: "card card-pad" },
    el("h3", { style: "font-size:15px" }, "Add or remove devices"),
    el("p", { class: "small muted" }, "The devices and the approval rule are part of the wallet "
      + "key, so they cannot change in place. To change them, create a new wallet with the devices "
      + "you want, then move the Zcash funds to it." + solStays()),
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

// Read existing wallet and progress facts for the display-only security dashboard.
// None of these presentation values authorize setup, signing, export, restore or spending.
function securityRecoveryTab(formed = true) {
  const f = guidedState(), mine = localSeats(), setup = solSetup();
  const rosterKnown = state.seatsLoaded && (!signedMode(state.gid) || state.seatsSettled);
  const scope = setup?.status === "ready" ? "ready" : setup?.status === "stopped" ? "stopped"
    : solError ? "unavailable" : !f.solWanted && (!solOn() || solNotAdded()) ? "none" : "pending";
  const signers = seatIds().map((id) => {
    const s = state.seats[id], local = mine.includes(id), held = local ? sec(state.gid, id) : null;
    const progress = f.backups.find((b) => b.seat === id), part = local ? solFile(id) : null;
    const hasSol = !!part && !part.unknown && !part.missing;
    const checked = seatCheck(id);
    return { id, label: s?.name || "Signer", local, joined: !!s, rosterUnknown: !rosterKnown,
      joinedAt: s?.at ? when(s.at) : "",
      address: checked === true ? "Address checked" : checked === false ? "Rejected address"
        : STAGE_LABEL[seatStage(id)],
      zec: { has: !!held?.keyPackage, saved: local ? seatBackedUp(held || {}) || progress?.zecChecked : progress?.zecSaved,
        checked: progress?.zecChecked, reported: progress?.reported, restored: !!held?.restored,
        checkable: local && !!held?.keyPackage && checked === true },
      sol: scope === "none" ? null : { has: hasSol, ...part,
        unknown: local && !part ? true : part?.unknown,
        failed: scope === "unavailable" || part?.failed,
        checked: progress?.solChecked, reported: progress?.reported,
        saved: local ? hasSol && (part.saved || progress?.solChecked) : progress?.solSaved,
        checkable: local && hasSol && checked === true && scope === "ready" },
    };
  });
  // Preserve the existing lazy read. Opening this page never initiates a ceremony.
  if (signers.some((s) => s.sol?.unknown && !s.sol.failed) && solOn()
    && scope !== "stopped") solLoad();
  const restoreInput = el("input", { id: "security-restore-input", type: "file",
    accept: ".zigsbackup,.json,application/json", hidden: true,
    onchange: (ev) => {
      const file = ev.target.files[0]; ev.target.value = "";
      if (file) restore(file);
    } });
  const muted = signedMode(state.gid) && mine.find((i) => !canWriteAs(i));
  const facts = { n: state.g.n, t: state.g.t, formed, signers, solScope: scope, rosterKnown,
    blocked: f.blocked || (muted ? "This browser has no signing key for signer " + muted
      + ". Restore that signer’s recovery file." : ""),
    storageIssue: f.storageIssue, reportIssue: f.reportIssue,
    openSolana: solOn() ? openWalletSection("solana") : null };
  return securityDashboard(facts, {
    backup: (id, chain, ev) => chain === "sol" ? act(() => solBackup(id))(ev) : openBackup(id),
    check: (id, chain) => openBackupCheck(id, chain),
    setup: openWalletSection("overview"),
    guide: act(() => { beginGuided(state.gid); ui.tab = "overview"; render(); }),
    restoreInput, restore: () => restoreInput.click(), settings: openWalletSection("settings"),
  }, {
    invite: el("details", { class: "security-explainer" }, el("summary", {}, "Private wallet invite link"),
      el("section", {}, el("p", {}, "To open this wallet in another browser, use its private invite link there and restore the existing signer’s recovery file. "
        + "The link contains the wallet secret. Share it only with people who use this wallet. It does not create an independent signer. "
        + senderNote("each person who opens it")),
      el("div", { class: "row-actions" }, copyBtn(inviteLink(state.gid), "Copy private invite link")),
      secretQr(inviteLink(state.gid), "wallet", true))),
    management: formed ? changeSignersCard() : el("p", {}, "Finish the existing wallet setup before changing signers."),
    lost: lostText(state.g.t, !!solStays()),
  });
}

const lostText = (t, sol) => "Keep the signers that still work, and do not delete their data. "
  + "While " + t + " distinct shares remain usable, they can move the Zcash funds to a new wallet using Advanced wallet management"
  + (sol ? "; a Solana part does not move this way" : "") + ". With fewer, "
  + "first restore signers from their files. Zigs cannot go around the approval rule. A lost "
  + "device can still hold its key share, so move the funds when you can.";

function settingsTab() {
  const host = chain?.url ? new URL(chain.url).host : new URL(curNet().servers[0]).host;
  return el("div", { class: "page settings-page preferences-page" },
    generalSettings(memoSwitch(host)),
    networkPrivacySettings(),
    settingsGroup("Current wallet", descriptionEditor(), walletFacts()),
    browserSettings(),
    helpView(settingsRow("Replay setup guide", "Review wallet setup and optional recovery-file checks.",
      el("button", { class: "btn sm", type: "button", onclick: act(() => {
        beginGuided(state.gid, { replay: true }); ui.tab = "overview"; render();
      }) }, "Open guide"))),
    settingsGroup("Advanced", technicalDetails(),
      settingsDisclosure("Network & privacy", "Browser storage, data providers and what services can access.", privacyText(host))));
}

function descriptionEditor() {
  const gid = state.gid, saved = descriptionOf(gid), id = "wallet-description-" + gid;
  const input = el("textarea", { id, class: "input", rows: "3",
    maxlength: "280", "aria-label": "Edit wallet description", "aria-describedby": id + "-help" }, saved.text);
  const error = el("p", { class: "preference-error", role: "alert", id: id + "-error" });
  const cancel = () => { input.value = saved.text; error.textContent = "";
    details.open = false; details.querySelector("summary").focus(); };
  const form = el("form", { class: "wallet-description-editor", onsubmit: (ev) => {
    ev.preventDefault();
    try {
      setWalletDescription(gid, input.value);
      details.open = false; showBanner("ok", "Description saved.");
      focusAfter("description-summary-" + gid, true); render();
    } catch {
      error.textContent = "Couldn’t save your description. Your draft is kept. Check browser storage and try again.";
      showBanner("bad", error.textContent);
    }
  } }, el("label", { class: "field", for: id },
  el("span", {}, "Edit wallet description"), input),
  el("p", { class: "small muted", id: id + "-help" },
    "Saved only in this browser’s local notes, outside the encrypted vault. Not included in wallet recovery files or shared with other members. Avoid sensitive information."),
  saved.error ? el("p", { class: "callout warn", role: "alert" }, saved.error) : null,
  error,
  el("div", { class: "row-actions" }, el("button", { class: "btn sm", type: "button", onclick: cancel }, "Cancel"),
    el("button", { class: "btn primary sm", type: "submit", disabled: !!saved.error }, "Save description")));
  const details = el("details", { class: "preference-disclosure description-disclosure", "data-link": "description-" + gid },
    el("summary", { class: "preference-row", "data-key": "description-summary-" + gid },
      settingsLabel("Wallet description", saved.text || "Add a private note to recognize this wallet."),
      el("span", { class: "preference-action", "aria-hidden": "true" }, saved.text ? "Edit" : "Add")),
    el("div", { class: "preference-detail" }, form));
  return details;
}

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
    ? settingsRow("Wallet address", atCap() ? "Hidden at the unaudited mainnet warning level. Deposits cannot be blocked."
      : "Shown after this device checks it against its key share.", el("span", { class: "preference-state" }, "Hidden"))
    : el("div", { class: "preference-address" }, settingsRow("Wallet address", short(w.address, 12), copyBtn(w.address, "Copy address")),
      settingsDisclosure("View full address", null, el("div", { class: "addr-full" }, addrGroups(w.address))));
  return [address,
    settingsRow("Network", net.cap ? "Unaudited · warning at " + capText(net.cap) + ". Deposits cannot be blocked." : "Test coins have no monetary value.",
      el("span", { class: "preference-value" }, "Zcash " + net.label)),
    settingsRow("Required approvals", state.g.t === state.g.n ? "Every device must approve a payment." : "Any " + state.g.t + " devices must approve each payment.",
      el("span", { class: "preference-value" }, state.g.t + " of " + state.g.n + " devices")),
    settingsRow("Devices joined", "Enrolled in this wallet. This does not indicate who is online.",
      el("span", { class: "preference-value" }, seatIds().filter((i) => state.seats[i]).length + " of " + state.g.n)),
    settingsRow("Address checks", "Devices that checked the wallet address, separate from enrollment.", checkedBadge()),
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
      + "documents that matter, such as approvals and results, and Zigs ignores such a document "
      + "without a valid signature. The wallet document has no signature, so anyone who has the "
      + "invite link can change it. This device keeps the first number of devices, approval rule, "
      + "version, network and message room that it saw. Other fields can change, such as the "
      + "name, the move to a new wallet and the Solana hint. Funds move only through a payment "
      + "that the devices approve. Payment status and processing progress marks are unsigned. "
      + "Optional recovery progress reports are signed by the reporting device; they are reports, "
      + "not proof that its recovery files remain safe.")] : null);
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
  return el("details", { class: "preference-disclosure", open: open || null, ontoggle: toggle },
    el("summary", { class: "preference-row" }, settingsLabel("Technical wallet details", "Keys, wallet structure and verification information."),
      el("span", { class: "preference-chevron", "aria-hidden": "true" }, "›")),
    open ? el("div", { class: "preference-detail" }, technicalBody()) : null);
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
  return [el("p", { class: "small muted" }, "Your signing share is created and used in this browser. "
    + "A recovery file exports that device’s share. Clearing site data or closing a private window may remove browser data. "
    + "The group server stores encrypted wallet content, but can see connection IP addresses and timing. "
    + "Other wallet members can read the shared wallet’s balances and payments."),
  el("p", { class: "small muted" }, "The current blockchain data service is " + host + ". "
    + "Sync downloads blocks and resumes from the saved browser state. Direct data providers see your IP address. "
    + "On testnet, requests normally pass through the Zigs Worker: the upstream node sees the Worker IP, "
    + "while the Worker sees your browser IP. A direct fallback provider sees your IP. "
    + "These requests do not send your signing key."),
  el("p", { class: "small muted" }, "Incoming memo retrieval additionally identifies transactions that pay this wallet. "
    + "Its consent and caching details are under General. Wallet descriptions are local notes outside the encrypted vault, "
    + "not shared wallet metadata or recovery-file contents. Full network disclosures, including Solana services, are in Help & Support.")];
}

// The setting that lets this browser read memos. It names the leak: the light-wallet server learns
// which transactions pay this wallet.
function memoSwitch(host) {
  const gid = state.gid, on = readsMemos(gid);
  const details = settingsDisclosure("Incoming payment memos", "Privacy & Data · this wallet on this browser.",
    el("p", { class: "small" }, "To read incoming memos, Zigs requests each paying transaction from a blockchain data provider. "
      + "The service learns which transactions pay this wallet. Direct providers also see your IP address; "
      + "the Zigs Worker sees it when requests are proxied. Memos already downloaded stay after you turn retrieval off."),
    el("p", { class: "small muted" }, "Current service: " + host + ". Testnet normally uses the Zigs Worker proxy, "
      + "with a direct provider as fallback. The upstream node sees the Worker IP on the proxy path. "
      + "This is off by default, and applies only to this wallet in this browser."),
    el("div", { class: "row-actions" }, el("button", { class: "btn sm", type: "button", onclick: () => {
      details.open = false; details.querySelector("summary").focus();
    } }, "Cancel"),
    el("button", { class: "btn sm" + (on ? "" : " primary"), type: "button",
      onclick: act(() => { setMemoReading(gid, !on); details.open = false; }),
    }, on ? "Turn off memo retrieval" : "Enable incoming memos")));
  details.classList.add("memo-switch");
  details.dataset.link = "memo-" + gid;
  details.querySelector("summary").insertBefore(el("span", { class: "preference-state" }, on ? "On" : "Off"),
    details.querySelector(".preference-chevron"));
  return details;
}

export function activityLog() {
  if (!state.log.length) return null;
  return el("details", {}, el("summary", {}, "Activity in this browser"),
    el("div", { class: "log" }, state.log.join("\n")));
}
