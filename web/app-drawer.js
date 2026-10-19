// The payment drawer.
import { finite, fmtInt } from "./util.js";
import { busy, log, showBanner, state, ui } from "./app-state.js";
import { about, elapsed, fmtZec, J, short, when, zecText } from "./app-kit.js";
import { sec } from "./app-keystore.js";
import { localSeats, seatIds, signersOf } from "./app-seats.js";
import { curChain, curNet, inFlight, netName } from "./app-chain.js";
import { Z } from "./app-engine.js";
import { canWriteAs, mayAct } from "./app-filter.js";
import {
  act, addrGroups, avatar, closeBtn, copyBtn, el, groupName, guard, isPayee, leavesOf, memoRow,
  money, named, payTitle, proposer, statusChip, unreadable,
} from "./app-dom.js";
import { seatCheck } from "./app-dkg.js";
import {
  approvalKept, approve, broadcastTx, cancelPayment, ended, expired, expiryAt, expiryOf, finalizeTx,
  heldApprovals, holdEnd, inspectOf, landed, releaseHold,
  approvalChanged, noApproval, priorityTimes, proofStalled, proposeAgain, recipientCheck, resendTx,
  sendRefusal, signingLost, signingSeen, signingStarted, tooLate, firstApprovers, refusedFinal,
  approvedTxid, chainReady, markOf, sinceOf, verdict,
} from "./app-payments.js";
import { discussion } from "./app-thread.js";
import { nameOf, zecName } from "./zns.js";
import { render } from "./app-loop.js";
import { RESEND_MS, stageHeadline } from "./payment-model.js";
import { icon } from "./app-icons.js";
import { solOn } from "./app-sol.js";

// The expiry of an open payment, or why an expired one ends here. The engine counts from the
// last sync, so the time since that sync comes off. A height from saved state gives no time.
export function expiryLine(ss) {
  if (ss.error || landed(ss)) return null;
  const v = verdict(ss), e = expiryOf(ss);
  if (v && v.state === "expired") return expiredSigned(ss);
  return e ? heightLine(ss, v, e) : lostLine(ss, v);
}

// A browser that approved but no longer has the approved transaction: once nothing that it
// approved can land, it asks the signers to check.
const lostLine = (ss, v) => v && v.bound && expired(ss) ? checkLine(null, v) : null;

// The expiry from the height of the last sync, for a payment that the engine does not call
// expired.
function heightLine(ss, v, e) {
  const c = curChain(), at = "block " + fmtInt(expiryAt(ss));
  if (expired(ss) && signingSeen(ss)) return checkLine(at, v);
  if (expired(ss)) {
    return el("div", { class: "callout bad" }, "This payment expired at " + at + ". No device "
      + "can approve, sign or send it now. Propose it again.");
  }
  if (e.expired) {
    return el("div", { class: "callout" }, "This payment can no longer go to the network: it "
      + "expires at " + at + ". If a device sent it, a block can still hold it.");
  }
  if (ss.broadcastTxid) return null;
  const must = "The approvals, the proof and the send must be done by then.";
  if (!c.balAt) return el("p", { class: "small muted" }, "Expires at " + at + ". " + must);
  const left = e.seconds_left - Math.max(0, (Date.now() - c.balAt) / 1000);
  return el("p", { class: "small muted" }, "Expires at " + at + ", in about "
    + about(Math.max(0, left)) + ". " + must);
}

// The signing started, so only the engine can say that the payment expired, and it does not.
// `at` is null when this browser approved but no longer has the approved transaction.
function checkLine(at, v) {
  const why = v ? el("p", { class: "small" }, "Why: " + v.why + ".") : null;
  const when = at ? "This payment expired at " + at : "The payment that this browser approved "
    + "can no longer go on chain";
  return el("div", { class: "callout bad" }, when + ", and no synced block holds the "
    + "transaction that this page shows. This page cannot prove that the devices signed that "
    + "transaction. Check the wallet's activity and an explorer before anyone proposes it again.",
  why);
}

// The engine says that the transaction that this browser approved expired and that none of its
// notes is spent (TICKETS.md ZEC-13). A new proposal spends the same notes. The list of sent
// transactions comes from the engine, so the signers can check each in an explorer.
function expiredSigned(ss) {
  const since = sinceOf(ss);
  return el("div", { class: "callout bad" }, "The transaction that this browser approved expired, "
    + "and none of its notes is spent. A new proposal spends the same notes, so at most one of "
    + "them can go on chain. Check the transactions of the wallet in an explorer before you "
    + "propose it again.", since ? sentSince(since) : null);
}

function sentSince({ from, txids }) {
  const head = (txids.length === 1 ? "1 transaction" : txids.length + " transactions")
    + " of this wallet went on chain from block " + fmtInt(from) + ".";
  const link = (id) => el("a", { href: curNet().explorer + id, target: "_blank", rel: "noopener" },
    short(id, 10));
  return el("p", { class: "small" }, head, ...txids.slice(0, 8).flatMap((id) => [" ", link(id)]));
}

function checkWarnings(rc) {
  const out = rc.extra.map((l) => "The transaction also pays " + fmtZec(l.value) + " to " + short(l.who, 12) + ", which the proposer did not list. Do not approve it.");
  // Paid with another memo (`got` is set): the address and the amount are right.
  const memoOnly = rc.rows.filter((r) => !r.ok && r.got !== undefined);
  out.push(...memoOnly.map((r) => "The memo in the transaction for " + short(r.to, 12)
    + " is not the memo the proposer listed. Do not approve it."));
  if (!rc.rows.length) out.push("The proposal lists no recipients. Do not approve it.");
  else if (!rc.match && !rc.extra.length && !memoOnly.length) {
    out.push("The transaction does not pay what the proposer listed. Do not approve it.");
  }
  return out.map((t) => el("div", { class: "callout bad" }, t));
}

// The memo lines of one payee row. For a payee paid with another memo, the memo that the
// transaction carries is the decoded one, so it shows as well.
function memoLines(r) {
  const own = r.memo == null ? "" : typeof r.memo === "string" ? r.memo : null;
  if (!r.ok && r.got !== undefined) {
    return [memoRow("Proposed memo", own), memoRow("Memo in the transaction", r.got, true)];
  }
  return own === "" ? [] : [memoRow("Memo", own)];
}

function checkHead(rc) {
  return el("div", { class: "card-head" }, el("span", { class: "label" }, rc.rows.length > 1 ? rc.rows.length + " recipients" : "To"),
    el("span", { class: "badge " + (rc.match ? "ok" : "bad") }, rc.match ? "Matches the transaction" : "Does not match the transaction"));
}

// A payee that was paid by name: the name of the proposal, which is text from the proposer. The
// line shows only a name that is valid. An approving browser looks the name up again.
const nameLine = (r) => typeof r.name === "string" && nameOf(r.name) === r.name
  ? el("p", { class: "small muted" }, el("strong", {}, zecName(r.name)),
    " This browser checks the name again when it approves.") : null;

function recipientBox(ss, rc) {
  // Payments proposed before batch payments have no list; only one still open for approval needs
  // the check.
  if (rc.match === null || (!rc.rows.length && ss.package)) return null;
  return el("div", { class: "to-box" }, checkHead(rc),
    rc.rows.map((r) => el("div", { class: "payee-item" },
      el("div", { class: "payee" }, el("span", { class: "hex" }, addrGroups(r.to)),
        el("span", { class: "payee-end" }, money(r.amount), r.ok ? null
          : el("span", { class: "badge bad" },
            r.got === undefined ? "Not in the transaction" : "Memo differs"))),
      nameLine(r), memoLines(r))),
    rc.rows.some((r) => r.memo) ? el("p", { class: "small faint" },
      "A memo goes on chain with the payment. Its recipient, every device of this wallet and "
      + "anyone else who has the invite link can read it. A device that a later Change devices "
      + "leaves out keeps reading it: it reads the history of this wallet.") : null,
    checkWarnings(rc),
    ss.move ? moveNote(ss, rc) : null);
}

function moveNote(ss, rc) {
  if (rc.intoNew === false) return el("div", { class: "callout bad" }, "This is not the address of " + groupName(ss.move) + ". Do not approve it.");
  if (rc.intoNew) {
    return el("div", { class: "callout" }, "This moves the confirmed Zcash funds to "
      + groupName(ss.move) + ", the wallet that replaces this one. Your browser checked its "
      + "address." + solPart());
  }
  return el("div", { class: "callout" }, "This moves the confirmed Zcash funds to a new wallet "
    + "that replaces this one. Your browser has no checked copy of its address, so it cannot "
    + "check it." + solPart());
}
// The move takes the Zcash funds only (proposeMove). The lead joins this text with SOL_STAYS.
const solPart = () => (solOn() ? " If this wallet has a Solana part, it does not move this way: "
  + "check it in its Solana section." : "");

// The seats of this browser that can approve the payment now. None while the wallet's data is
// being checked: an approval written twice would replace its own nonces.
const approvers = (ss) => state.pending || noApproval(ss) ? []
  : localSeats().filter((i) => canWriteAs(i)
  && sec(state.gid, i).keyPackage && seatCheck(i) === true && !state.commits[i] && !ss.package);

const bigButton = (label, onclick, extra = {}, symbol = null) =>
  el("button", { class: "btn primary lg", type: "button", onclick, ...extra },
    symbol && icon(symbol), label);

function approveButtons(ss, myPending) {
  const several = localSeats().length > 1;
  return myPending.map((i) => bigButton(several ? "Approve as device " + i : "Approve payment",
    act(() => approve(ss, i)), {}, "approvals"));
}

const needsProof = (ss) => ss.signed && !ss.final
  && (ss.status !== "proving" || proofStalled(ss));

// The step after the approvals that a signer here can take: "proof", "send", "resend" or null.
// The proof and the sent mark are signed writes, so they need a seat that can sign. The Approvals
// inbox reads the same step, so the two never disagree. A block holds it: no step.
export function finishStep(ss) {
  if (!mayAct() || landed(ss)) return null;
  if (needsProof(ss)) return "proof";
  if (unsendable(ss)) return null;
  if (!ss.broadcastTxid) return "send";
  return lateSend(ss) ? "resend" : null;
}

// No proof yet, or a node refuses it: it expires within EXPIRY_MARGIN blocks (see expiryLine).
const unsendable = (ss) => !ss.final || expiryOf(ss)?.expired;

// A send step that this browser refuses (sendRefusal): its button is off, and the inbox lists
// the payment under "Needs attention".
export const refusedSend = (ss, step = finishStep(ss)) => (step === "send" || step === "resend")
  && !!sendRefusal(ss);
// A refused send counts also for a browser that has no seat (the chip says Check then too).
const sendRefused = (ss) => refusedSend(ss) || refusedFinal(ss);

export function finishButtons(ss) {
  const step = finishStep(ss);
  if (step === "proof") return [bigButton("Build proof", act(() => finalizeTx(ss)))];
  if (step !== "send" && step !== "resend") return [];
  const why = sendRefusal(ss), note = why ? [el("p", { class: "send-why" }, why)] : [];
  if (step === "resend") {
    return [bigButton("Send again", act(() => resendTx(ss)), { disabled: !!why }, "send"), ...note];
  }
  return [bigButton(ss.broadcastError ? "Send again" : "Send to network",
    act(() => broadcastTx(ss)), { disabled: !curChain() || !!why }, "send"), ...note];
}

const lateSend = (ss) => Date.now() - finite(ss.broadcastAt) > RESEND_MS
  && inFlight().includes(ss);

export function nextAction(ss, ins, rc) {
  if (ended(ss)) {
    return mayAct() && localSeats().length
      ? [bigButton("Propose again", act(() => proposeAgain(ss)))] : [];
  }
  if (expired(ss)) return [];   // signing started, and the engine cannot say that it expired
  return canApprove(ss, rc) ? approveButtons(ss, approvers(ss)) : finishButtons(ss);
}
// A seat here can approve, and the transaction pays what the proposer listed: the Approve buttons
// and the headline "Your approval is needed" follow this one rule. The inbox cannot count the
// approvals of each payment, so a seat here can still approve after t approvals.
const canApprove = (ss, rc) => approvers(ss).length > 0 && rc.match === true
  && rc.intoNew !== false && !enoughApprovals();
const enoughApprovals = () => Object.keys(state.commits).length >= state.g.t;

const CANCEL_ASK = "Cancel this payment? No device can approve it after this. Anyone can propose "
  + "it again.";
// Until the signatures are combined, any signer can withdraw a payment, for example one that lost
// an approval. A signature share alone cannot move funds.
// A document that lost the signing parts that this browser saw gets no Cancel: one seat reset it.
const noCancel = (ss) => ss.signed || signingLost(ss) || approvalChanged(ss) || expired(ss)
  || landed(ss);
export const cancelAction = (ss) => noCancel(ss) || !localSeats().length || !mayAct() ? [] : [
  el("button", {
    class: "btn lg danger", type: "button",
    onclick: act(() => confirm(CANCEL_ASK) && cancelPayment(ss)),
  }, "Cancel payment"),
];

// The devices that sign: those that the package names, else the first t approvals by device
// number (buildPackage takes those). Null while fewer than t approvals are in.
function signingSeats(ss) {
  if (ss.package) return signersOf(ss);
  const first = firstApprovers(state.commits, state.g.t);
  return first.length >= state.g.t ? first : null;
}
// The devices of this browser that lost their approval of the payment, among those that sign or
// may still sign. An approval is a published commitment plus nonces kept here. Without the nonces
// the device cannot sign, and the payment waits forever: say so instead of stalling. A made share
// that did not go out yet still counts.
function lostSeats(ss) {
  if (ss.signed || ss.error) return [];
  const sign = signingSeats(ss), chosen = (i) => !sign || sign.includes(i);
  return localSeats().filter((i) => state.commits[i] && !state.shares[i] && chosen(i)
    && !approvalKept(sec(state.gid, i), ss.id) && !busy.has("share:" + ss.id + ":" + i));
}
const approvalLost = (ss) => lostSeats(ss).length > 0;
// It names the devices: another device of this browser can still have its approval. While fewer
// than t approvals are in, the page cannot tell which devices sign.
function lostApproval(ss) {
  const lost = lostSeats(ss), one = lost.length === 1;
  if (!lost.length) return null;
  const them = one ? "it" : "them", what = one ? "approval" : "approvals";
  const end = signingSeats(ss) ? "The payment cannot finish with " + them + ". Cancel the "
    + "payment, then propose it again." : "If the signing package names " + (one ? "that device"
    : "those devices") + ", the payment cannot finish. Then cancel it, and propose it again.";
  return el("div", { class: "callout bad" }, "This browser lost the " + what + " of "
    + lost.map((i) => "device " + i).join(", ") + " for this payment: the browser data "
    + "that held " + them + " was deleted. " + end);
}

// The document lost the signing parts that this browser saw (signingLost).
const resetNote = (ss) => signingLost(ss) ? el("div", { class: "callout bad" }, "This browser saw "
  + "the signing of this payment start, but the payment does not show it now: a device or the "
  + "server reset it. The devices may have signed it before the reset.") : null;

// One seat rewrote the proposal after a seat of this browser approved it.
const changedNote = (ss) => approvalChanged(ss) ? el("div", { class: "callout bad" },
  "The proposal changed after this browser approved it. The details below come from the changed "
  + "proposal, not from what you approved.") : null;

// After a cancel or a failure, the approval of this browser can still hold Send (ZEC-13). The
// person can release it by hand, after a check and a second click (S7, the owner's decision D2).
function holdCard(ss) {
  if (!ss.error || !heldApprovals().includes(ss.id)) return null;
  const sure = ui.release === ss.id, end = holdEnd(ss.id);
  const set = (v) => () => { ui.release = v; ui.releaseAt = Date.now(); render(); };
  // A double click must not reach the second step: it counts only 400 ms after the first.
  const release = act(async () => {
    if (Date.now() - (ui.releaseAt || 0) < 400) return;
    await releaseHold(ss.id);
    ui.release = null;
    showBanner("ok", "This payment does not hold Send now.");
  });
  const button = (label, onclick) => el("button", { class: "btn", type: "button", onclick }, label);
  // "Keep the hold" takes the place of the first button, so a double click releases nothing.
  const actions = sure ? [button("Release Send now", release), button("Keep the hold", set(null))]
    : [button("I checked, release", set(ss.id))];
  return el("div", { class: "callout", "data-key": "hold-" + ss.id },
    el("p", {}, "This browser approved this payment, and the other devices can still sign and "
      + "send it. Send stays off until block " + fmtInt(end) + holdLeft(end) + ". Release Send "
      + "only if you are sure that nobody will send it."),
    el("div", { class: "dialog-actions" }, actions));
}

// ", in about …" until block `end`, from the last sync, or "" without a sync time.
function holdLeft(end) {
  const c = curChain();
  if (!c || !c.bal || !c.balAt) return "";
  try {
    const e = J(Z.expiryState(netName(state.g), end, c.bal.height));
    const since = Math.max(0, (Date.now() - c.balAt) / 1000);
    return ", in about " + about(Math.max(0, e.seconds_left - since));
  } catch { return ""; }
}

function sessionDrawer(ss) {
  const ins = inspectOf(ss), refused = ins && ins.error, rc = recipientCheck(ss, ins);
  const read = refused ? null : ins;
  return el("aside", { class: "drawer", role: "dialog", "aria-modal": "true", "aria-label": "Payment details" },
    el("div", { class: "drawer-head" }, el("div", {
      style: "display:flex;align-items:center;gap:10px;min-width:0",
    }, el("h2", { class: "nowrap", style: "font-size:15px" }, payTitle(ss)),
    statusChip(ss, enoughApprovals())),
      closeBtn()),
    el("div", { class: "drawer-body" },
      leavesHead(ss, read),
      guard(headline, ss, refused, rc),
      ...notes(ss, refused, rc),
      guard(timeline, ss, refused, rc),
      read ? guard(breakdown, read, ss) : null,
      guard(discussion, ss),
      ss.final ? guard(txDetails, ss) : null,
      ss.broadcastTxid ? chainSees() : null,
      read ? technical(read) : null),
    drawerFoot(ss, ins, rc));
}

// What the headline points to sits right under it, before the steps.
const notes = (ss, refused, rc) => [
  refused ? el("div", { class: "callout bad" }, "Your browser refuses this payment: " + refused)
    : null,
  guard(expiryLine, ss),
  guard(recipientBox, ss, rc),
  lostApproval(ss),
  holdCard(ss),
  resetNote(ss),
  changedNote(ss),
];

const technical = (ins) => el("details", { class: "small faint" },
  el("summary", {}, "Technical details"),
  el("p", {}, "Signed message " + short(ins.sighash, 12) + " · " + ins.tx_version));

// A cancelled or failed payment takes no more steps.
function drawerFoot(ss, ins, rc) {
  const actions = ss.error ? [] : [...nextAction(ss, ins, rc), ...cancelAction(ss)];
  return actions.length ? el("div", { class: "drawer-foot" }, ...actions) : null;
}

// If the payment's document cannot be shown, the drawer still opens and closes.
export function sessionLayer(ss) {
  try { return sessionDrawer(ss); }
  catch (e) { log("unreadable payment: " + (e && e.message ? e.message : e)); }
  return el("aside", {
    class: "drawer", role: "dialog", "aria-modal": "true", "aria-label": "Payment details",
  },
  el("div", { class: "drawer-head" }, el("h2", { style: "font-size:15px" }, "Payment"), closeBtn()),
  el("div", { class: "drawer-body" }, unreadable()));
}

// The decoded transaction is the truth. Spent notes minus change is what leaves the wallet: the
// payees and the fee.
function decodedTotals(ins) {
  const sum = (keep) => ins.lines.filter(keep).reduce((n, l) => n + finite(l.value), 0);
  const spent = sum((l) => l.kind === "spend"), paid = sum(isPayee);
  const back = sum((l) => l.kind !== "spend" && !isPayee(l));
  return { spent, paid, back, fee: spent - paid - back, leaves: spent - back };
}

function leavesHead(ss, ins) {
  const t = ins ? decodedTotals(ins) : { leaves: leavesOf(ss), fee: finite(ss.fee) };
  return el("div", { class: "leaves" },
    el("span", { class: "label" }, ins ? "Leaves the wallet" : "Proposed to leave the wallet"),
    money(t.leaves, "lg"),
    el("span", { class: "small muted" }, "includes " + zecText(t.fee)
      + (priorityTimes(ins) ? " priority fee" : " fee")),
    el("span", { class: "small muted" },
      "Proposed by " + proposer(ss) + " · " + when(ss.createdAt)));
}

function feeLabel(ins) {
  const times = priorityTimes(ins);
  return times ? "Priority fee (" + times + " times the standard fee)" : "Network fee";
}

function breakdown(ins, ss) {
  const t = decodedTotals(ins);
  const row = (label, zat, cls = "") => el("div", {}, el("span", { class: cls }, label),
    el("span", { class: "mono " + cls }, zecText(zat)));
  const own = (l) => l.kind !== "spend" && !isPayee(l);
  const spent = ins.lines.filter((l) => l.kind === "spend");
  return el("div", { style: "display:grid;gap:8px" },
    el("span", { class: "label" }, "What this payment does"),
    el("div", { class: "lines" },
      ins.lines.filter(isPayee).map((l) => row("To " + short(l.who, 10), l.value)),
      row(feeLabel(ins), t.fee, "neg"),
      el("div", { class: "total" }, el("span", {}, "Leaves the wallet"),
        el("span", { class: "mono" }, zecText(t.leaves))),
      el("div", { class: "group" }, "Funds used"),
      spent.map((l) => row("Spent from this wallet", l.value, "neg")),
      ins.lines.filter(own).map((l) => row("Change back to this wallet", l.value, "neg"))),
    el("p", { class: "small faint" }, "Your browser decoded this from the transaction itself, "
      + "not from the proposer's description."),
    ss.broadcastTxid ? null : el("p", { class: "small faint" }, ON_CHAIN_PUBLIC));
}
// Before the send, so that a device sees it before it approves. The lead joins the second part
// with EXPIRY_PUBLIC, which the chain summary shows after the send.
const ON_CHAIN_PUBLIC = "On chain, the number of actions and the fee are public. The expiry "
  + "height is public too. Zigs sets it up to one day after the proposal, and a standard wallet "
  + "sets it 40 blocks ahead. So the expiry height can show that Zigs made this payment. Few "
  + "wallets pay a priority fee, so a priority fee can mark a payment too.";

// Each seat with its name and seat number, and a check mark when it approved.
const approverChips = () => el("div", {
  style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap",
}, seatIds().map((i) => el("span", { class: "approver" + (state.commits[i] ? " yes" : "") },
  avatar(i), el("span", { class: "small" }, named(i) + (state.commits[i] ? " ✓" : "")))));

// What the signature step waits for. Each device does its step while this wallet is open there,
// with the payment open or not.
const WHERE = " while this wallet is open there.";
// `over`: the payment cannot go on (timeline), so a step that waits says nothing about now.
function signatureText(ss, approvals, shared, over) {
  const t = state.g.t, signers = signersOf(ss);
  if (ss.signed) return "All signatures combined and verified.";
  if (landed(ss)) return ON_CHAIN;
  if (ss.error) return ss.error;
  if (over) return NOT_DONE;
  if (!ss.package) {
    return approvals < t ? "Starts after " + t + " approvals."
      : "Waiting for the proposer's device to build the signing package. It does this" + WHERE;
  }
  const waiting = signers.filter((i) => !state.shares[i]).map(named);
  const next = waiting.length ? "Waiting for " + waiting.join(", ") + ": each device signs"
    : "A device combines the shares";
  return "Signing · " + shared + " of " + signers.length + " shares. " + next + WHERE;
}

// The headline of the payment, from the facts that the notes and the steps below show.
// `rejected`: this browser refuses the transaction itself (its decode). No live region: the page
// draws it anew on each redraw.
function headline(ss, rejected, rc) {
  const { title, detail } = stageHeadline({ ...endFacts(ss, rejected), ...stepFacts(ss, rc) });
  return el("div", { class: "pay-status" }, el("h3", {}, title),
    el("p", { class: "small muted" }, detail));
}
// The facts that end, stop or block a payment. `stopped`: before a sync, or once signing started
// here, the page cannot tell that no device sent it.
const endFacts = (ss, rejected) => ({
  landed: landed(ss),
  ended: ended(ss) && !signingSeen(ss),
  endedSigned: ended(ss) && signingSeen(ss),
  check: signingSeen(ss) && expired(ss),
  held: !!ss.error && heldApprovals().includes(ss.id),
  sentStopped: !!ss.error && !!ss.broadcastTxid,
  stopped: !!ss.error && !signingSeen(ss) && syncedHere(),
  error: !!ss.error,
  rejected: !!rejected,
  refused: sendRefused(ss),
  signingLost: signingLost(ss),
  approvalLost: approvalLost(ss),
  approvalChanged: approvalChanged(ss),
});
// The facts of the steps. `late`: a node refuses the finished transaction now (expiryLine).
// `sendHere`: this browser can send it.
const stepFacts = (ss, rc) => ({
  mismatch: !ss.package && rc.match === false,
  wrongMove: !ss.package && rc.intoNew === false,
  sentUnsynced: !!ss.broadcastTxid && !syncedHere(),
  resend: finishStep(ss) === "resend",
  sent: !!ss.broadcastTxid,
  late: tooLate(ss),
  sendFailed: !!ss.broadcastError,
  sendHere: finishStep(ss) === "send",
  proved: !!ss.final,
  proving: ss.status === "proving" && !proofStalled(ss),
  signed: !!ss.signed,
  signing: !!ss.package,
  approved: enoughApprovals(),
  mine: canApprove(ss, rc),
});
// What a screen reader hears before the title of a step that is done or stopped.
const STEP_STATE = { done: "Done: ", bad: "Stopped: " };
const mark = (cls, n) => (cls === "done" ? "✓" : cls === "bad" ? "!" : String(n));

// One numbered step. Its class is "done", "bad", "now" (the step that waits now) or "".
function stepItem(cls, n, title, body) {
  return el("li", { class: "step " + cls, "aria-current": cls === "now" ? "step" : null },
    el("span", { class: "tick", "aria-hidden": "true" }, mark(cls, n)),
    el("div", { style: "display:grid;gap:6px;min-width:0" },
      el("h3", {}, STEP_STATE[cls] ? el("span", { class: "sr-only" }, STEP_STATE[cls]) : null,
        title), body));
}

// The numbered steps of a payment, under its headline. The step that waits now is the one of the
// next action. A payment that expired, that is too late to send or that stopped has none; its
// done and stopped marks stay. A block marks each step done (the step functions below).
function timeline(ss, refused, rc) {
  const g = state.g, approvals = Object.keys(state.commits).length;
  const signers = signersOf(ss), shared = signers.filter((i) => state.shares[i]).length;
  const over = expired(ss) || tooLate(ss) || !!ss.error;
  let n = 0;
  const tl = (cls, title, body) => {
    n += 1;
    return stepItem(over && cls === "now" ? "" : cls, n, title, body);
  };
  return el("section", { class: "stage-panel", "aria-label": "Steps of the payment" },
    el("ol", { class: "steps" },
      tl("done", "Proposed", el("p", {}, when(ss.createdAt))),
      tl(approvalsStep(ss, refused, rc), "Approvals · " + Math.min(approvals, g.t) + " of " + g.t
        + " needed", approverChips()),
      tl(signatureStep(ss), "Combined signature",
        el("p", {}, signatureText(ss, approvals, shared, over))),
      tl(proofStep(ss), "Proof", el("p", {}, proofText(ss, over))),
      tl(sendStep(ss), "Sent to the network", sendBody(ss, over)),
      tl(blockStep(ss), "In a block", el("p", {}, blockText(ss, over)))));
}

// The approvals step is done from the count of approvals only. Once signing started, or while a
// reason of this browser (the headline) stops it, it waits no more.
function approvalsStep(ss, refused, rc) {
  if (enoughApprovals() || landed(ss)) return "done";
  if (refused) return "bad";
  return ss.error || signingStarted(ss) || approvalsHeld(ss, rc) ? "" : "now";
}
const approvalsHeld = (ss, rc) => signingLost(ss) || approvalLost(ss) || approvalChanged(ss)
  || rc.match === false || rc.intoNew === false;
// A block holds the payment: each step before it is done, also when its part is missing.
function signatureStep(ss) {
  if (ss.signed || landed(ss)) return "done";
  if (ss.error) return "bad";
  return enoughApprovals() || ss.package ? "now" : "";
}
const proofStep = (ss) => ss.final || landed(ss) ? "done"
  : ss.status === "proving" || ss.signed ? "now" : "";
function sendStep(ss) {
  if (ss.broadcastTxid || landed(ss)) return "done";
  if (ss.broadcastError || sendRefused(ss)) return "bad";
  return ss.final ? "now" : "";
}
const ON_CHAIN = "A synced block holds the payment.";
const NOT_DONE = "Not done.";

function proofText(ss, over) {
  if (ss.final) return "Proof built and the whole transaction checked.";
  if (landed(ss)) return ON_CHAIN;
  if (over) return NOT_DONE;
  if (ss.status === "proving" && !proofStalled(ss)) {
    return "A device is building the proof · " + elapsed(ss.provingAt) + " of about a minute.";
  }
  return ss.signed ? "Any device can build the zero-knowledge proof now."
    : "Any device can build the zero-knowledge proof once the payment is signed.";
}

function sendBody(ss, over) {
  const box = (...kids) => el("div", { style: "display:grid;gap:8px" }, ...kids);
  if (ss.broadcastTxid) {
    return box(el("p", {}, when(ss.broadcastAt) + " · ", el("a", { href: curNet().explorer
      + ss.broadcastTxid, target: "_blank", rel: "noopener" }, "View in explorer ↗")));
  }
  const failed = ss.broadcastError && !landed(ss);
  return box(el("p", {}, sendText(ss, over)),
    failed ? el("div", { class: "callout bad" }, ss.broadcastError) : null);
}
// What the send step says before a sent mark: a block, a refusal (its reason), the expiry or the
// next step.
function sendText(ss, over) {
  if (landed(ss)) return ON_CHAIN;
  if (sendRefused(ss)) return sendRefusal(ss);
  if (tooLate(ss)) return "It can no longer go to the network.";
  if (over) return NOT_DONE;
  return ss.final ? "Any device can send the finished transaction." : "Available after the proof.";
}

// The last step, from this browser's synced blocks only: a sent mark does not say that a block
// holds the payment, and before a sync the page does not know. A state restored from storage is
// ready (chainReady) before this page synced: only a sync of this page counts (balAt).
const syncedHere = () => chainReady(curChain()) && !!curChain().balAt;
const UNSYNCED = "This page has not synced the blocks since you opened this wallet.";
const blockStep = (ss) => landed(ss) ? "done" : ss.broadcastTxid ? "now" : "";
function blockText(ss, over) {
  if (landed(ss)) return ON_CHAIN;
  if (!ss.broadcastTxid) return over ? NOT_DONE : "After the send.";
  if (!syncedHere()) return UNSYNCED;
  return expiryOf(ss)?.expired ? "No synced block holds it." : "No synced block holds it yet.";
}

export function txDetails(ss) {
  const size = Number.isFinite(ss.final.size) ? fmtInt(ss.final.size) + " bytes" : "unknown";
  // The id that the send step checks (sendRefusal), so a false id never sits next to a Send.
  const id = approvedTxid(ss);
  const source = markOf(state.gid, ss.id).approved ? "the approved proposal" : "the proposal";
  const falseId = id && id !== ss.final.txid ? el("div", { class: "callout bad" }, "The finished "
    + "transaction names the id " + short(String(ss.final.txid), 12) + ", but " + source
    + " gives the id " + short(id, 12) + ". One device wrote one of them alone. "
    + "Check the payment in an explorer.") : null;
  return el("div", { style: "display:grid;gap:10px" },
    el("span", { class: "label" }, "Transaction"),
    falseId,
    el("dl", { class: "kv", style: "grid-template-columns:110px minmax(0,1fr)" },
      el("dt", {}, "ID"), el("dd", { class: "hex" }, id || ss.final.txid),
      el("dt", {}, "Size"), el("dd", {}, size)),
    el("details", {}, el("summary", {}, "Raw transaction"),
      el("div", { class: "log" }, ss.final.tx_hex),
      el("div", { style: "margin-top:8px" }, copyBtn(ss.final.tx_hex, "Copy hex"))));
}

// What an observer of the chain learns from a sent payment.
function chainSees() {
  const hidden = () => el("span", { class: "redact", role: "img", "aria-label": "Hidden" });
  const row = (name) => [el("dt", {}, name), el("dd", {}, hidden())];
  return el("div", { style: "display:grid;gap:10px" },
    el("span", { class: "label" }, "What the chain sees"),
    el("p", { class: "small" }, "One shielded transaction."),
    el("dl", { class: "kv", style: "grid-template-columns:110px minmax(0,1fr)" },
      ["Recipients", "Amounts", "Devices", "Approval rule"].flatMap(row)),
    el("p", { class: "small faint" }, "The number of actions is public. So is the fee."));
}
