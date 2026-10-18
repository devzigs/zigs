// Receive and send dialogs.
import { MEMO_BYTES, memoBytes, memoError, parsePayeeList, toZat, zatText } from "./payees.js";
import { payeeRows, requestProblem } from "./requests.js";
import { state, ui } from "./app-state.js";
import { fmtZec } from "./app-kit.js";
import { Z } from "./app-engine.js";
import { addrHidden, atCap, curChain, curNet } from "./app-chain.js";
import { act, addrGroups, copyBtn, el, money, normalized, onNetwork, qrBox } from "./app-dom.js";
import { feeEstimate, newSpend, PRIORITY_FACTOR, sendBlocker } from "./app-payments.js";
import { requestOf } from "./app-payreq.js";
import { render } from "./app-loop.js";
import { capNote, receiveLimit, receiveWhat } from "./app-wallet.js";

const MAX_PAYEES = 20;
const TOO_MANY = "A payment can have at most " + MAX_PAYEES + " recipients.";

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

// A payment proposed again after an expired one that was signed (TICKETS.md ZEC-13).
const afterNote = () => ui.after ? el("p", { class: "small" }, "This payment also spends every "
  + "note of the expired payment, so that at most one of them can go on chain.") : null;

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
    await newSpend(payees, note, null, ui.priority, ui.after);
    ui.send = false; ui.after = null;
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
    afterNote(),
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
      + "standard fee, for a faster block when the network is busy. The fee is public on chain."));
}
