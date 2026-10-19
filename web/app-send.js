// Receive and send dialogs.
import { MEMO_BYTES, memoBytes, memoError, parsePayeeList, toZat, zatText } from "./payees.js";
import { payeeRows, requestProblem } from "./requests.js";
import { showBanner, state, ui } from "./app-state.js";
import { fmtZec } from "./app-kit.js";
import { Z } from "./app-engine.js";
import { addrHidden, atCap, curChain, curNet, netName } from "./app-chain.js";
import { act, addrGroups, copyBtn, el, money, normalized, onNetwork, qrBox } from "./app-dom.js";
import { feeEstimate, newSpend, PRIORITY_FACTOR, sendBlocker } from "./app-payments.js";
import { requestOf } from "./app-payreq.js";
import { nameOf, recentNote, registry, resolveRecipient, zecName } from "./zns.js";
import { render } from "./app-loop.js";
import { capNote, movedNote, receiveLimit, receiveWhat } from "./app-wallet.js";

const MAX_PAYEES = 20;
const TOO_MANY = "A payment can have at most " + MAX_PAYEES + " recipients.";

// The network name comes from the open wallet, so a mainnet wallet still reads Mainnet (D3).
export function receiveDialog() {
  const w = state.wallet, hidden = addrHidden(), net = "Zcash " + curNet().label;
  const close = el("button", {
    class: "icon-btn", type: "button", "aria-label": "Close",
    onclick: () => { ui.receive = false; render(); },
  }, "×");
  const title = el("div", { style: "display:grid;gap:6px;justify-items:start" },
    el("h2", { id: "recv-title" }, "Receive ZEC"), el("span", { class: "badge plain" }, net));
  const copy = copyBtn(w.address, "Copy address", "btn primary");
  copy.setAttribute("data-first-focus", "");
  // A moved wallet leads with its moved note: senders must use the address of the new wallet.
  const moved = !!state.g.movedTo;
  const address = hidden ? [] : [moved ? null : sendOnly(net),
    qrBox(w.address, "Wallet address"), el("div", { class: "addr-full" }, addrGroups(w.address))];
  return el("div", {
    class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "recv-title",
  }, el("div", { class: "card-head" }, title, close), receiveLead(hidden, moved), ...address,
  hidden ? null : el("div", { class: "dialog-actions" }, moved ? null : shareBtn(w.address), copy));
}

// What the dialog says above the address: the move, the cap, why the address is not shown yet,
// or what the address does.
function receiveLead(hidden, moved) {
  if (moved) return movedNote();
  if (atCap()) return capNote();
  if (hidden) {
    return el("p", { class: "small muted" }, "The address shows here after your seat checks it "
      + "against its own key.");
  }
  return el("p", { class: "small muted" }, "Use this shielded address to receive "
    + receiveWhat() + ". Senders and the network cannot see the balance or who controls it. "
    + "The signers of this wallet can see its balance and history." + receiveLimit());
}

function sendOnly(net) {
  const faucet = curNet().faucet ? [" Get free testnet ZEC from a ", el("a", {
    href: curNet().faucet, target: "_blank", rel: "noopener", style: "white-space:nowrap",
  }, "faucet ↗"), "."] : [];
  return el("div", { class: "callout" }, el("span", {}, "Send only ZEC on " + net + " to this "
    + "address. A payment that arrives becomes spendable after 3 confirmations.", ...faucet));
}

// Web Share sends the address alone. A sheet that the person closes is no error.
function shareBtn(address) {
  if (!navigator.share) return null;
  const failed = (e) => {
    if (e?.name !== "AbortError") showBanner("bad", SHARE_FAILED);
  };
  return el("button", {
    class: "btn", type: "button",
    onclick: () => navigator.share({ text: address }).catch(failed),
  }, "Share address");
}
const SHARE_FAILED = "This device could not share the address. Use Copy address.";

function addressHint(hint, to) {
  const v = to.trim(), ok = v ? onNetwork(v) : null, net = curNet().label.toLowerCase();
  hint.textContent = !v ? "" : ok ? "Valid " + net + " address"
    : "Not a shielded Zcash " + net + " address. It starts with " + curNet().prefix + ".";
  hint.className = "hint " + (!v ? "" : ok ? "ok" : "bad");
}

// A recipient field holds an address or, in a testnet wallet, a ZNS name. Text that is an address
// on this network is never a name. A mainnet wallet looks no name up.
const znsOn = () => netName(state.g) === "testnet";
const nameIn = (to) => (znsOn() && !onNetwork(to.trim()) ? nameOf(to) : null);
const toLabel = () => (znsOn() ? "Recipient address or ZNS name" : "Recipient address");
const toPlaceholder = () => curNet().prefix + (znsOn() ? "… or alice.zec" : "…");

const showHint = (hint, text, cls = "") => {
  hint.textContent = text;
  hint.className = "hint " + cls;
};

// What the form shows for a name: its address, with the note of a recent change. The row keeps it
// as `r.shown`, so that a submit pays only what the form showed. `seen` is false until a hint
// draws it: an address that no hint drew yet is not shown to the person.
function shownOf(typed, hit, tip) {
  const note = recentNote(hit.record, tip);
  return { typed, name: hit.name, address: hit.address, seen: false,
    text: zecName(hit.name) + " gives this address: " + hit.address + (note ? " " + note : "") };
}

// The answer for a typed name from the registry of this moment: `{ shown }` or `{ error }`.
async function nameAnswer(typed) {
  try {
    const reg = await registry.get(), tip = curChain()?.bal?.height;
    return { shown: shownOf(typed, resolveRecipient(typed, "test", reg, tip), tip) };
  } catch (e) { return { error: e.message }; }
}

// Draws the address of a name in a hint: from now on the person has seen it.
function showShown(hint, shown) {
  shown.seen = true;
  showHint(hint, shown.text, "ok");
}

// An address that "Propose again" kept with the name of the first proposal (a testnet wallet).
const keptName = (r, typed) => znsOn() && r.name && onNetwork(typed.trim());
const keptHint = (hint, name) => showHint(hint, "Kept from the first proposal: " + zecName(name)
  + ". Each approver in the web app checks the name again.", "ok");

// The hint of a recipient field. The answer for a name comes later, and only the newest text of
// the field may show it. A row keeps the address that its hint showed (`r.shown`), and a redraw
// shows it again without a new lookup.
function recipientHint(hint, r) {
  const typed = r.to, name = nameIn(typed);
  if (name === null) {
    r.shown = null;
    return keptName(r, typed) ? keptHint(hint, r.name) : addressHint(hint, typed);
  }
  if (r.shown?.typed === typed) return showShown(hint, r.shown);
  r.shown = null;
  showHint(hint, "Looking up " + zecName(name) + "…");
  return nameAnswer(typed).then(({ shown, error }) => {
    if (r.to !== typed) return;
    r.shown = shown ?? null;
    if (shown) showShown(hint, shown);
    else showHint(hint, error, "bad");
  });
}

function payRow(r, i, rows, sumUp) {
  const c = curChain(), n = rows.length > 1 ? " " + (i + 1) : "";
  const hint = el("span", { class: "hint", role: "status", style: "overflow-wrap:anywhere" });
  const amt = el("input", { class: "input", id: "s-amt-" + r.k, type: "text", inputmode: "decimal", placeholder: "0.00", required: true, autocomplete: "off", "aria-label": "Amount" + n, value: r.amt, oninput: (ev) => { r.amt = ev.target.value.trim(); sumUp(); } });
  const max = () => { r.amt = zatText(Math.max(0, c && c.bal ? c.bal.max_send : 0)); amt.value = r.amt; sumUp(); };
  recipientHint(hint, r);
  return el("div", { class: "pay-row" },
    el("input", {
      class: "input mono", id: "s-to-" + r.k, type: "text", placeholder: toPlaceholder(),
      required: true, autocomplete: "off", spellcheck: "false",
      "aria-label": toLabel() + n, value: r.to,
      oninput: (ev) => {
        r.to = ev.target.value;
        r.name = null;   // text that the person typed has no name from an earlier proposal
        fillFromRequest(r, rows, hint) || recipientHint(hint, r);
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

const whoOf = (rows, i) => (rows.length > 1 ? "Recipient " + (i + 1) + ": " : "");

// The fresh answer of the registry for a name row. The row pays it only when it is the address
// that the form showed. A name that moved since is kept as not seen yet: the next hint draws it,
// and until then no submit pays it. The person proposes again after that.
function freshHit(r, reg, tip) {
  const hit = resolveRecipient(r.to, "test", reg, tip), name = zecName(hit.name);
  if (r.shown?.typed !== r.to || !r.shown.seen) {
    throw new Error(`Wait until the form shows the address of ${name}.`);
  }
  if (r.shown.address === hit.address) return hit;
  r.shown = shownOf(r.to, hit, tip);
  render();
  throw new Error(`The name ${name} now gives another address. Check it, then propose again.`);
}

// The name rows, looked up in the registry as of now: a Map of row to `{name, address, record}`.
// Rows with an address take no lookup. Every name row is checked, so that each moved name shows.
async function resolveNames(rows) {
  const found = new Map();
  if (!rows.some((r) => nameIn(r.to) !== null)) return found;
  const bal = curChain()?.bal;
  if (!bal) throw new Error("The wallet has not finished its first sync.");
  const reg = await registry.get();
  let first = null;
  rows.forEach((r, i) => {
    if (nameIn(r.to) === null) return;
    try { found.set(r, freshHit(r, reg, bal.height)); }
    catch (e) { first ??= new Error(whoOf(rows, i) + e.message, { cause: e }); }
  });
  if (first) throw first;
  return found;
}

const addressError = (net, hit) => (hit
  ? `The name ${zecName(hit.name)} gives an address that Zigs cannot pay.`
  : "Enter a shielded Zcash " + net.label.toLowerCase() + " address. It starts with "
    + net.prefix + ".");

// A payee has a memo only when it has text, and a name only when it is paid by name: the name of
// a name row, or the name that "Propose again" kept with an address (a testnet wallet only).
function payeeOf(to, amount, memo, name) {
  const p = { to, amount };
  if (memo) p.memo = memo;
  if (name) p.name = name;
  return p;
}
const nameOfRow = (r, hit) => (hit ? hit.name : znsOn() && r.name);

// Checks each row and returns the payees in zatoshis, or throws with the row number. `found` has
// the registry answer of each name row: that row pays the address of the registry.
function readPayees(rows, found) {
  const net = curNet(), own = normalized(state.wallet.address);
  return rows.map((r, i) => {
    const hit = found.get(r), to = hit ? hit.address : r.to.trim(), amount = toZat(r.amt);
    const who = whoOf(rows, i), memo = String(r.memo || "").trim();
    if (!onNetwork(to)) throw new Error(who + addressError(net, hit));
    if (normalized(to) === own) {
      throw new Error(who + "This is the address of this wallet. Enter the address of someone "
        + "else.");
    }
    if (!amount) {
      throw new Error(who + "Enter an amount greater than zero, with at most 8 decimals.");
    }
    if (memoError(memo)) throw new Error(who + memoError(memo));
    return payeeOf(to, amount, memo, nameOfRow(r, hit));
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
      "One " + (znsOn() ? "address or ZNS name" : "address") + " and amount per line, then an "
      + "optional memo. A spreadsheet copy works. A payment request (zcash:) works too."),
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
    const payees = readPayees(rows, await resolveNames(rows));
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
