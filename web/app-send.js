// Receive and send dialogs.
import { MEMO_BYTES, memoBytes, memoError, parsePayeeList, toZat, zatText } from "./payees.js";
import { payeeRows, requestProblem } from "./requests.js";
import { state, ui } from "./app-state.js";
import { fmtZec } from "./app-kit.js";
import { Z } from "./app-engine.js";
import { gkeys } from "./app-keystore.js";
import { DRAFT_MS, draftLive, draftOf, reviewFresh } from "./payment-model.js";
import { addrHidden, atCap, curChain, curNet, netName } from "./app-chain.js";
import { act, addrGroups, copyBtn, el, money, normalized, onNetwork, qrBox } from "./app-dom.js";
import {
  feeEstimate, inspectOf, newSpend, prepareSpend, PRIORITY_FACTOR, recipientCheck, sendBlocker,
} from "./app-payments.js";
import { requestOf } from "./app-payreq.js";
import { nameOf, recentNote, registry, resolveRecipient, zecName } from "./zns.js";
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

// ── Drafts: the typed Send form, sealed with the wallet key on this device for 24 hours ──
// `at` stays plain next to the sealed box, so an expired draft goes without a key, also while
// the vault is locked. A draft that has not expired stays while its key is locked.
const DRAFTS = "zf-drafts";
const draftAad = (gid) => "draft\n" + gid;
function draftBook() {
  try { return JSON.parse(localStorage.getItem(DRAFTS) || "{}") || {}; } catch { return {}; }
}
const expiredAt = (at, now) => !Number.isSafeInteger(at) || now - at > DRAFT_MS;

/** Deletes the expired drafts of every wallet. */
export function sweepDrafts(now = Date.now()) {
  try {
    const book = draftBook(), old = Object.keys(book).filter((g) => expiredAt(book[g]?.at, now));
    for (const g of old) delete book[g];
    if (old.length) localStorage.setItem(DRAFTS, JSON.stringify(book));
  } catch { /* no storage: nothing to delete */ }
}
export function dropDraft(gid) {
  try {
    const book = draftBook();
    if (!book[gid]) return;
    delete book[gid];
    localStorage.setItem(DRAFTS, JSON.stringify(book));
  } catch { /* no storage: nothing to delete */ }
}
// The draft of wallet `gid`, or null: none, expired (then deleted), locked or unreadable.
function readDraft(gid) {
  sweepDrafts();
  const entry = draftBook()[gid], key = gkeys[gid];
  if (!entry || !key || !Z) return null;
  try {
    const d = JSON.parse(Z.secretOpen(key, draftAad(gid), entry.box));
    return draftLive(d, Date.now()) ? d : null;
  } catch { return null; }
}
// Saves the form as it is now. A form with nothing typed deletes the draft.
export function keepDraft() {
  const gid = state.gid, key = gkeys[gid];
  if (ui.after || !key || !Z) return;
  const d = draftOf({ rows: ui.pay, note: ui.note, priority: ui.priority }, Date.now());
  if (!d) { dropDraft(gid); ui.draftFailed = false; return; }
  try {
    const book = draftBook();
    book[gid] = { at: d.at, box: Z.secretSeal(key, draftAad(gid), JSON.stringify(d)) };
    localStorage.setItem(DRAFTS, JSON.stringify(book));
    ui.draftFailed = false;
  } catch { ui.draftFailed = true; }
}
// A new form: the draft of this wallet when one lives, never for "Propose again".
function freshForm() {
  const d = ui.after ? null : readDraft(state.gid);
  ui.pay = d ? d.rows.map((r) => ({ k: ++ui.payKey, ...r }))
    : [{ k: ++ui.payKey, to: "", amt: "", memo: "" }];
  if (d) Object.assign(ui, { note: d.note, priority: d.priority });
  ui.listError = "";
}
function draftLine() {
  if (ui.after) return null;
  if (ui.draftFailed) return el("p", { class: "small faint" }, "This draft could not be saved on "
    + "this device. The form still works.");
  if (!draftBook()[state.gid]) return null;
  const discard = () => {
    dropDraft(state.gid);
    Object.assign(ui, { pay: null, note: "", priority: false });
    render();
  };
  return el("p", { class: "small faint" }, "Draft saved on this device for 24 hours. ",
    el("button", { class: "btn ghost sm", type: "button", onclick: discard }, "Discard draft"));
}
const closeSend = () => { Object.assign(ui, { send: false, sendReview: null }); render(); };
sweepDrafts();

export function sendDialog() {
  if (ui.sendReview) return reviewDialog();
  const c = curChain(), bal = c && c.bal, spendable = bal ? bal.spendable : 0, net = curNet();
  if (!ui.pay) freshForm();
  const rows = ui.pay;
  const fee = el("span", {}), total = el("span", { id: "s-total" });
  const sumUp = () => {
    const f = feeEstimate(rows.length, ui.priority);
    fee.replaceChildren(money(f));
    total.replaceChildren(money(rows.reduce((n, r) => n + (toZat(r.amt) || 0), 0) + f));
  };
  const why = sendBlocker();
  const f = el("form", { class: "dialog", role: "dialog", "aria-modal": "true",
    "aria-labelledby": "send-title", oninput: keepDraft, onchange: keepDraft,
    onsubmit: act(async (ev) => {
    if (why) throw new Error(why);
    const payees = readPayees(rows, await resolveNames(rows));
    const need = payees.reduce((n, p) => n + p.amount, 0) + feeEstimate(payees.length, ui.priority);
    if (need > spendable) throw new Error("Not enough funds: " + fmtZec(spendable) + " available, " + fmtZec(need) + " needed (amounts + fee).");
    const note = String(new FormData(ev.target).get("note") || "").trim();
    // "Propose again" keeps its direct path: it spends the notes of the expired payment too.
    if (ui.after) {
      await newSpend(payees, note, null, ui.priority, ui.after);
      ui.send = false; ui.after = null;
      return;
    }
    ui.sendReview = { prep: await prepareSpend(payees, ui.priority), note, priority: ui.priority };
  }) },
    el("div", { class: "card-head" }, el("h2", { id: "send-title" }, "Send ZEC"),
      el("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: closeSend },
        "×")),
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
    afterNote(), draftLine(),
    el("div", { class: "dialog-actions" },
      el("button", { class: "btn", type: "button", onclick: closeSend }, "Cancel"),
      el("button", {
        class: "btn primary", type: "submit", disabled: !Z || !!why,
      }, ui.after ? "Propose payment" : "Review payment")),
    why ? el("p", { class: "small faint" }, why) : null);
  sumUp();
  return f;
}

// ── The review: what the engine decoded from the transaction that this browser built. The
// proposal is that transaction, as it is: the form is not read again. ──
const REVIEW_OK = "This browser decoded the transaction that it built: it pays exactly these "
  + "recipients, amounts and memos.";
const REVIEW_BAD = "The transaction that this browser built does not match the form. Go back and "
  + "check the payment.";

// The engine decoded the transaction of `prep`, and it pays exactly its payees: null when not.
function decodedMatch(prep) {
  const ins = inspectOf({ pczt: prep.t.pczt });
  const ok = !!ins && !ins.error
    && recipientCheck({ payees: prep.payees, amount: prep.t.amount }, ins).match === true;
  return ok ? ins : null;
}

function reviewDialog() {
  const { prep, note, priority } = ui.sendReview, t = prep.t;
  if (prep.gid !== state.gid) { ui.sendReview = null; return sendDialog(); }
  const ins = decodedMatch(prep), ok = !!ins;
  const fee = ok ? ins.fee : t.fee;
  return el("section", { class: "dialog", role: "dialog", "aria-modal": "true",
    "aria-labelledby": "review-title" },
  el("div", { class: "card-head" }, el("h2", { id: "review-title" }, "Review the payment"),
    el("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: closeSend },
      "×")),
  el("div", { class: "review-hero" }, el("span", { class: "label" }, "Leaves the wallet"),
    money(t.amount + fee, "lg"), el("span", { class: "small muted" }, "Zcash "
      + netName(state.g) + ": the amounts and the network fee")),
  ok ? el("p", { class: "callout ok" }, REVIEW_OK)
    : el("p", { class: "callout bad", role: "alert" }, REVIEW_BAD),
  prep.payees.map((p, i) => reviewRow(p, i, prep.payees.length)),
  el("dl", { class: "kv" }, el("dt", {}, priority ? "Network fee (priority)" : "Network fee"),
    el("dd", {}, money(fee)), el("dt", {}, "Approvals needed"),
    el("dd", {}, state.g.t + " of " + state.g.n),
    note ? [el("dt", {}, "Note for signers"), el("dd", {}, note)] : null),
  el("p", { class: "small faint" }, EXPIRY_NOTE + " Proposing asks the signers to approve; it "
    + "does not sign or send the payment."),
  el("div", { class: "dialog-actions" },
    el("button", { class: "btn", type: "button",
      onclick: () => { ui.sendReview = null; render(); } }, "Back to edit"),
    ok ? el("button", { class: "btn primary", type: "button", disabled: !!ui.proposing,
      onclick: act(() => proposeReviewed(ui.sendReview)) }, "Propose payment") : null));
}

function reviewRow(p, i, n) {
  return el("section", { class: "review-row" },
    el("span", { class: "label" }, n > 1 ? "Recipient " + (i + 1) : "Recipient"),
    p.name ? el("p", { class: "small" }, zecName(p.name) + " gives this address:") : null,
    el("div", { class: "addr-full" }, addrGroups(p.to)), money(p.amount),
    el("p", { class: "small muted" }, p.memo ? "Memo: " + p.memo : "No memo"));
}

// Proposes the reviewed transaction after the guards of a new one: Send is not held, the decode
// still matches, and the review is fresh (a stale one is built again).
export async function proposeReviewed(r) {
  const gid = state.gid, why = sendBlocker();
  if (why) throw new Error(why);
  if (!decodedMatch(r.prep)) throw new Error(REVIEW_BAD);
  if (!reviewFresh(r.prep.at, Date.now())) {
    ui.sendReview = null;
    throw new Error("This review is out of date. Review the payment again.");
  }
  await newSpend(r.prep.payees, r.note, null, r.priority, undefined, r.prep);
  dropDraft(gid);
  Object.assign(ui, { send: false, sendReview: null, pay: null, note: "", priority: false });
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
