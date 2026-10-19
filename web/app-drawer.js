// The payment drawer.
import { finite, fmtInt } from "./util.js";
import { busy, log, showBanner, state, ui } from "./app-state.js";
import { about, elapsed, fmtZec, J, short, when, zecText } from "./app-kit.js";
import { sec } from "./app-keystore.js";
import { localSeats, seatIds, signersOf } from "./app-seats.js";
import { curChain, curNet, explorerText, inFlight, netName } from "./app-chain.js";
import { Z } from "./app-engine.js";
import { canWriteAs, mayAct } from "./app-filter.js";
import {
  act, addrGroups, avatar, closeBtn, copyBtn, el, groupName, guard, isPayee, leavesOf, memoRow,
  money, named, netBadge, payTitle, proposer, statusChip, unreadable,
} from "./app-dom.js";
import { seatCheck } from "./app-dkg.js";
import {
  approvalKept, approve, broadcastTx, cancelPayment, ended, expired, expiryAt, expiryOf, finalizeTx,
  heldApprovals, holdEnd, inspectOf, landed, releaseHold,
  approvalChanged, noApproval, priorityTimes, proofStalled, proposeAgain, recipientCheck, resendTx,
  sendRefusal, signingLost, signingSeen,
  approvedTxid, chainReady, markOf, sinceOf, verdict,
} from "./app-payments.js";
import { discussion } from "./app-thread.js";
import { nameOf, zecName } from "./zns.js";
import { render } from "./app-loop.js";

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
    return el("div", { class: "callout bad" }, "This payment expired at " + at + ". No signer "
      + "can approve, sign or send it now. Propose it again.");
  }
  if (e.expired) {
    return el("div", { class: "callout" }, "This payment can no longer go to the network: it "
      + "expires at " + at + ". If a signer sent it, a block can still hold it.");
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
    + "transaction that this page shows. This page cannot prove that the signers signed that "
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
  return [el("p", { class: "small" }, head, ...txids.slice(0, 8).flatMap((id) => [" ", link(id)])),
    txids.length ? el("p", { class: "small" }, explorerText(curNet(), "Each id")) : null];
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
      "A memo goes on chain with the payment. Its recipient and every signer can read it.") : null,
    checkWarnings(rc),
    ss.move ? moveNote(ss, rc) : null);
}

function moveNote(ss, rc) {
  if (rc.intoNew === false) return el("div", { class: "callout bad" }, "This is not the address of " + groupName(ss.move) + ". Do not approve it.");
  if (rc.intoNew) return el("div", { class: "callout" }, "This moves all funds to " + groupName(ss.move) + ", the wallet that replaces this one. Your browser checked its address.");
  return el("div", { class: "callout" }, "This moves all funds to a new wallet that replaces this one. Your browser has no checked copy of its address, so it cannot check it.");
}

// The seats of this browser that can approve the payment now. None while the wallet's data is
// being checked: an approval written twice would replace its own nonces.
const approvers = (ss) => state.pending || noApproval(ss) ? []
  : localSeats().filter((i) => canWriteAs(i)
  && sec(state.gid, i).keyPackage && seatCheck(i) === true && !state.commits[i] && !ss.package);

const bigButton = (label, onclick, extra = {}) =>
  el("button", { class: "btn primary lg", type: "button", onclick, ...extra }, label);

function approveButtons(ss, myPending) {
  const several = localSeats().length > 1;
  return myPending.map((i) => bigButton(several ? "Approve as seat " + i : "Approve payment",
    act(() => approve(ss, i))));
}

const needsProof = (ss) => ss.signed && !ss.final
  && (ss.status !== "proving" || proofStalled(ss));

// The step after the approvals that a signer here can take: "proof", "send", "resend" or null.
// The proof and the sent mark are signed writes, so they need a seat that can sign. The Approvals
// inbox reads the same step, so the two never disagree.
export function finishStep(ss) {
  if (!mayAct()) return null;
  if (needsProof(ss)) return "proof";
  if (unsendable(ss)) return null;
  if (!ss.broadcastTxid) return "send";
  return lateSend(ss) ? "resend" : null;
}

// No proof yet, a block holds it, or a node refuses it: it expires within EXPIRY_MARGIN blocks
// (see expiryLine).
const unsendable = (ss) => !ss.final || expiryOf(ss)?.expired || landed(ss);

// A send step that this browser refuses (sendRefusal): its button is off, and the inbox lists
// the payment under "Needs attention".
export const refusedSend = (ss, step = finishStep(ss)) => (step === "send" || step === "resend")
  && !!sendRefusal(ss);

export function finishButtons(ss) {
  const step = finishStep(ss);
  if (step === "proof") return [bigButton("Build proof", act(() => finalizeTx(ss)))];
  if (step !== "send" && step !== "resend") return [];
  const why = sendRefusal(ss), note = why ? [el("p", { class: "send-why" }, why)] : [];
  if (step === "resend") {
    return [bigButton("Send again", act(() => resendTx(ss)), { disabled: !!why }), ...note];
  }
  return [bigButton(ss.broadcastError ? "Send again" : "Send to network",
    act(() => broadcastTx(ss)), { disabled: !curChain() || !!why }), ...note];
}

// A sent payment that no block holds after this long may be lost: offer to send it again.
const RESEND_MS = 10 * 60 * 1000;
const lateSend = (ss) => Date.now() - finite(ss.broadcastAt) > RESEND_MS
  && inFlight().includes(ss);

export function nextAction(ss, ins, rc) {
  if (ended(ss)) {
    return mayAct() && localSeats().length
      ? [bigButton("Propose again", act(() => proposeAgain(ss)))] : [];
  }
  if (expired(ss)) return [];   // signing started, and the engine cannot say that it expired
  const myPending = approvers(ss);
  const canApprove = myPending.length && rc.match === true && rc.intoNew !== false;
  return canApprove ? approveButtons(ss, myPending) : finishButtons(ss);
}

const CANCEL_ASK = "Cancel this payment? No signer can approve it after this. Anyone can propose it again.";
// Until the signatures are combined, any signer can withdraw a payment, for example one that lost
// an approval. A signature share alone cannot move funds.
// A document that lost the signing parts that this browser saw gets no Cancel: one seat reset it.
export const cancelAction = (ss) => ss.signed || signingLost(ss) || approvalChanged(ss)
  || expired(ss) || !localSeats().length || !mayAct() ? [] : [
  el("button", { class: "btn lg", type: "button", onclick: act(() => confirm(CANCEL_ASK) && cancelPayment(ss)) }, "Cancel payment"),
];

// An approval is a published commitment plus nonces kept here. Without the nonces the seat cannot
// sign, and the payment waits forever: say so instead of stalling. A made share that did not go
// out yet still counts.
function lostApproval(ss) {
  if (ss.signed || ss.error) return null;
  const chosen = (i) => !ss.package || signersOf(ss).includes(i);
  const lost = localSeats().filter((i) => state.commits[i] && !state.shares[i] && chosen(i)
    && !approvalKept(sec(state.gid, i), ss.id) && !busy.has("share:" + ss.id + ":" + i));
  if (!lost.length) return null;
  return el("div", { class: "callout bad" }, "This browser does not hold its approval for this "
    + "payment any more: the browser data that held it was deleted. The payment cannot finish "
    + "with this approval. Cancel it, then propose it again.");
}

// One seat rewrote the proposal after a seat of this browser approved it.
const changedNote = (ss) => approvalChanged(ss) ? el("div", { class: "callout bad" },
  "The proposal changed after a seat of this browser approved it. The details below come from the "
  + "changed proposal, not from what you approved.") : null;

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
    el("p", {}, "This browser approved this payment, and the other signers can still sign and "
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
  // A cancelled or failed payment takes no more steps.
  const actions = ss.error ? [] : [...nextAction(ss, ins, rc), ...cancelAction(ss)];
  return el("aside", { class: "drawer", role: "dialog", "aria-modal": "true", "aria-label": "Payment details" },
    el("div", { class: "drawer-head" }, el("div", { style: "display:flex;align-items:center;gap:10px;min-width:0" }, el("h2", { class: "nowrap", style: "font-size:15px" }, payTitle(ss)), statusChip(ss)),
      closeBtn()),
    el("div", { class: "drawer-body" },
      leavesHead(ss, ins && !refused ? ins : null),
      refused ? el("div", { class: "callout bad" }, "Your browser refuses this payment: " + ins.error) : null,
      guard(expiryLine, ss),
      guard(recipientBox, ss, rc),
      lostApproval(ss),
      holdCard(ss),
      changedNote(ss),
      ins && !refused ? guard(breakdown, ins) : null,
      guard(timeline, ss, refused),
      guard(discussion, ss),
      ss.final ? guard(txDetails, ss) : null,
      ss.broadcastTxid ? chainSees() : null,
      ins && !refused ? el("details", { class: "small faint" }, el("summary", {}, "Technical details"),
        el("p", {}, "Signed message " + short(ins.sighash, 12) + " · " + ins.tx_version)) : null),
    actions.length ? el("div", { class: "drawer-foot" }, ...actions) : null);
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
    el("div", { style: "display:flex;align-items:center;gap:8px;flex-wrap:wrap" },
      el("span", { class: "label" }, ins ? "Leaves the wallet" : "Proposed to leave the wallet"),
      netBadge(state.g)),
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

function breakdown(ins) {
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
      + "not from the proposer's description."));
}

// Each seat with its name and seat number, and a check mark when it approved.
const approverChips = () => el("div", {
  style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap",
}, seatIds().map((i) => el("span", { class: "approver" + (state.commits[i] ? " yes" : "") },
  avatar(i), el("span", { class: "small" }, named(i) + (state.commits[i] ? " ✓" : "")))));

// What the signature step waits for. Each browser does its step while this wallet is open there,
// with the payment open or not.
const WHERE = " while this wallet is open there.";
function signatureText(ss, approvals, shared) {
  const t = state.g.t, signers = signersOf(ss);
  if (ss.error) return ss.error;
  if (ss.signed) return "All signatures combined and verified.";
  if (!ss.package) {
    return approvals < t ? "Starts after " + t + " approvals."
      : "Waiting for the proposer's browser to build the signing package. It does this" + WHERE;
  }
  const waiting = signers.filter((i) => !state.shares[i]).map(named);
  const next = waiting.length ? "Waiting for " + waiting.join(", ") + ": each browser signs"
    : "A signer's browser combines the shares";
  return "Signing · " + shared + " of " + signers.length + " shares. " + next + WHERE;
}

function timeline(ss, refused) {
  const g = state.g, approvals = Object.keys(state.commits).length;
  const signers = signersOf(ss), shared = signers.filter((i) => state.shares[i]).length;
  const tl = (cls, title, body) => el("div", { class: "step " + cls }, el("span", { class: "tick" }, cls === "done" ? "✓" : cls === "bad" ? "!" : "•"), el("div", { style: "display:grid;gap:6px;min-width:0" }, el("h3", {}, title), body));
  return el("div", { class: "steps" },
    tl("done", "Proposed", el("p", {}, when(ss.createdAt))),
    tl(approvals >= g.t ? "done" : refused ? "bad" : "now", "Approvals · " + Math.min(approvals, g.t) + " of " + g.t + " needed",
      approverChips()),
    tl(ss.error ? "bad" : ss.signed ? "done" : ss.package ? "now" : "", "Combined signature",
      el("p", {}, signatureText(ss, approvals, shared))),
    tl(ss.final ? "done" : ss.status === "proving" ? "now" : "", "Proof",
      el("p", {}, ss.final ? "Proof built and the whole transaction checked." : ss.status === "proving" && !proofStalled(ss) ? "A signer's browser is building the proof · " + elapsed(ss.provingAt) + " of about a minute." : "Any signer can build the zero-knowledge proof once the payment is signed.")),
    tl(ss.broadcastTxid ? "done" : ss.broadcastError ? "bad" : ss.final ? "now" : "", "Sent to the network",
      el("div", { style: "display:grid;gap:8px" },
        ss.broadcastTxid ? sentLine(ss)
          : el("p", {}, ss.final ? "Any signer can send the finished transaction." : "Available after the proof."),
        ss.broadcastError && !ss.broadcastTxid
          ? el("div", { class: "callout bad" }, ss.broadcastError) : null)),
    tl(blockStep(ss), "In a block", el("p", {}, blockText(ss))));
}

// The time of the send and its explorer link, with what that site sees.
const sentLine = (ss) => [el("p", {}, when(ss.broadcastAt) + " · ", el("a", {
  href: curNet().explorer + ss.broadcastTxid, target: "_blank", rel: "noopener",
}, "View in explorer ↗")),
el("p", { class: "small" }, explorerText(curNet(), "View in explorer"))];

// The last step, from this browser's synced blocks only: a sent mark does not say that a block
// holds the payment, and before a sync the page does not know.
const blockStep = (ss) => landed(ss) ? "done" : ss.broadcastTxid ? "now" : "";
function blockText(ss) {
  if (landed(ss)) return "A synced block holds the payment.";
  if (!ss.broadcastTxid) return "After the send.";
  if (!chainReady(curChain())) return "This browser has not checked the blocks since the send yet.";
  return expiryOf(ss)?.expired ? "No synced block holds it." : "No synced block holds it yet.";
}

export function txDetails(ss) {
  const size = Number.isFinite(ss.final.size) ? fmtInt(ss.final.size) + " bytes" : "unknown";
  // The id that the send step checks (sendRefusal), so a false id never sits next to a Send.
  const id = approvedTxid(ss);
  const source = markOf(state.gid, ss.id).approved ? "the approved proposal" : "the proposal";
  const falseId = id && id !== ss.final.txid ? el("div", { class: "callout bad" }, "The finished "
    + "transaction names the id " + short(String(ss.final.txid), 12) + ", but " + source
    + " gives the id " + short(id, 12) + ". One signer's device wrote one of them alone. "
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
  const sees = el("div", { style: "display:grid;gap:10px" },
    el("span", { class: "label" }, "What the chain sees"),
    el("p", { class: "small" }, "One shielded transaction."),
    el("dl", { class: "kv", style: "grid-template-columns:110px minmax(0,1fr)" },
      ["Recipients", "Amounts", "Signers", "Approval rule"].flatMap(row)),
    el("p", { class: "small faint" }, "The number of actions is public. So is the fee."));
  sees.append(el("p", { class: "small faint" }, EXPIRY_PUBLIC));
  return sees;
}
// The expiry window of the engine (wasm/src/expiry.rs) against the 40 blocks of the standard
// wallet library (PRIVACY.md, On chain).
const EXPIRY_PUBLIC = "The expiry height is public too. Zigs sets it up to one day after the "
  + "proposal, and a standard wallet sets it 40 blocks ahead. So the expiry height can show that "
  + "Zigs made this payment. Few wallets pay a priority fee, so a priority fee can mark a payment "
  + "too.";
