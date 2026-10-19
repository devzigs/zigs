// Payment requests: logic, card and form.
import { memoShown } from "./payees.js";
import { checkText } from "./chat.js";
import {
  cardState, payeeBlocker, payeeRows, quoted, readRequest, REQUEST_NET, requestNote, requestPayees,
  requestProblem, requestUri, WALLET_NET,
} from "./requests.js";
import { busy, ready, state, ui } from "./app-state.js";
import { S, short } from "./app-kit.js";
import { Z } from "./app-engine.js";
import { mySeatSecrets } from "./app-keystore.js";
import {
  balOf, capText, curNet, MAINNET_ON, netName, netOf, NETWORKS, openTotal, underCap,
} from "./app-chain.js";
import { closeSession, openGroup } from "./app-groups.js";
import {
  act, copyBtn, el, groupName, guard, memoRow, money, netBadge, normalized,
} from "./app-dom.js";
import { myVerified } from "./app-dkg.js";
import { moveAddress, sendBlocker } from "./app-payments.js";
import { seatPicker, TRUST } from "./app-thread.js";
import { render } from "./app-loop.js";
import { openSend } from "./app-send.js";

// A message or a memo whose whole text is a ZIP 321 URI shows as a card (web/requests.js). The
// engine reads the URI. "Propose this" fills the Send form and sends nothing.
const parsedRequests = new Map();   // "net\nuri" -> { out } or { err }; bounded

function parseCached(uri, net) {
  const key = net + "\n" + uri;
  let hit = parsedRequests.get(key);
  if (!hit) {
    if (parsedRequests.size >= 500) parsedRequests.clear();
    try { hit = { out: Z.parseRequest(uri, net) }; } catch (e) {
      hit = { err: e.message || String(e) };
    }
    parsedRequests.set(key, hit);
  }
  if (hit.err !== undefined) throw new Error(hit.err);
  return hit.out;
}

// A wallet reads a request for its own network, and so does the personal account (`network`). A
// chat has no wallet, so it tries both; while MAINNET_ON is false it tries testnet only (M1). A
// mainnet wallet or account made before still reads its own requests (owner decision D3).
const chatNets = () => (MAINNET_ON ? ["test", "main"] : ["test"]);
const requestNets = (dm, network) => network ? [REQUEST_NET[network]]
  : dm ? chatNets() : [REQUEST_NET[netName(state.g)]];
const requestEnv = (dm, network) => ({
  nets: requestNets(dm, network),
  parse: parseCached, blocker: (to) => payeeBlocker(to, normalized),
});

// The request in `text`, or null for plain text. Until the engine loads, a request shows as text.
// The page asks for every message on every draw, so plain text must cost no engine call.
export const requestOf = (text, dm, network) =>
  Z && requestUri(text) ? readRequest(text, requestEnv(dm, network)) : null;

// Wallets where this browser holds a key share. A wallet that moved or has no address is left out.
const seatWallets = () => state.groups.filter((g) => !g.unreadable && !g.movedTo && ready[g.id]
  && mySeatSecrets(g.id).some(([, s]) => s.keyPackage));
export const proposeWallets = (net) => seatWallets().filter((g) => netName(g) === WALLET_NET[net]);

function requestTotal(req) {
  if (req.total != null) return money(req.total);
  const all = req.open === req.payees.length;
  const words = all ? "The payer chooses the amount" : "The payer chooses some amounts";
  return el("span", { class: "small muted" }, words);
}

// The name and the message of a payee are text from the sender. The card cuts them and says that
// the app did not check them.
function requestClaims(p) {
  const rows = [["Name", quoted(p.label)], ["Message", quoted(p.message)]].filter((r) => r[1]);
  if (!rows.length) return null;
  return el("div", { class: "req-claims" },
    el("span", { class: "small faint" }, "From the request, not checked"),
    rows.map(([label, text]) => memoRow(label, text)));
}

function requestPayee(p) {
  return el("div", { class: "payee-item" },
    el("div", { class: "payee" }, el("span", { class: "hex" }, short(p.to, 12)),
      el("span", { class: "payee-end" }, p.amount == null
        ? el("span", { class: "small muted" }, "The payer chooses the amount") : money(p.amount))),
    requestClaims(p),
    p.memo ? memoRow("Memo", p.memo) : null);
}

function requestError(req) {
  return el("div", { class: "to-box req-card" },
    el("span", { class: "label" }, "Payment request"),
    el("div", { class: "callout bad" }, requestProblem(req.error)),
    el("p", { class: "msg-text small faint" }, memoShown(req.uri)));
}

const PAYS_OWN = "This request pays each wallet that you could propose it from. "
  + "A wallet cannot pay itself.";

// The checked addresses that the payees of a request name. A wallet cannot pay itself.
const paidBy = (req) => new Set(req.payees.map((p) => normalized(p.to)));

// The person picks the wallet to propose from: a wallet of the request's network where this
// browser holds a key share, and that the request does not pay. Returns { select, why }; `select`
// is null when there is none.
function walletPicker(req, id, paid) {
  const held = proposeWallets(req.net);
  if (!held.length) {
    return { select: null, why: "You hold no seat in a " + WALLET_NET[req.net] + " wallet." };
  }
  const wallets = held.filter((g) => !paid.has(normalized(moveAddress(g.id))));
  if (!wallets.length) return { select: null, why: PAYS_OWN };
  const options = wallets.map((g) => el("option", { value: g.id },
    g.name + " (" + netOf(g).label + ")"));
  const select = el("select", {
    class: "input", id: "req-wallet-" + id, "aria-label": "Propose from wallet",
  }, options);
  return { select, why: "" };
}

// Where "Propose this" proposes from. In a room it is the open wallet, unless the request pays that
// wallet. In a chat, and for a request that pays the open wallet, the person picks a wallet.
function proposeSource(req, o) {
  const paid = paidBy(req);
  const paysOpen = !o.dm && !!state.wallet && paid.has(normalized(state.wallet.address));
  if (o.dm || paysOpen) return walletPicker(req, o.id, paid);
  return { select: null, why: sendBlocker() || "" };
}

// `o`: id (of the message), name (of the sender), verdict (the sender check, or "memo"), dm, and
// mine (the message is from this browser).
export function requestCard(req, o) {
  if (req.error) return requestError(req);
  const { select, why: where } = proposeSource(req, o);
  const st = cardState(req, o.verdict, where), [cls, mark] = TRUST[o.verdict];
  return el("div", { class: "to-box req-card" },
    el("div", { class: "card-head" },
      el("span", { class: "req-title" }, el("span", { class: "label" }, "Payment request"),
        o.dm ? netBadge({ network: WALLET_NET[req.net] }) : null),
      requestTotal(req)),
    req.payees.map((p) => guard(requestPayee, p)),
    el("div", { class: "memo-line" }, el("span", { class: "label" }, "From"),
      el("span", { class: "memo-text" }, o.name, " · ",
        el("span", { class: "vmark " + cls }, mark))),
    st.warning ? el("div", { class: "callout bad" }, st.warning) : null,
    el("div", { class: "req-actions" }, select,
      el("button", {
        class: "btn primary sm", type: "button", disabled: !!st.why,
        onclick: () => proposeRequest(req, o, select ? select.value : state.gid),
      }, "Propose this"),
      copyBtn(req.uri, "Copy request")),
    st.why ? el("p", { class: "small faint" }, st.why) : null);
}

// Opens the Send form with the payees of a request. The normal checks and approvals apply. The
// note names the sender only when the sender is verified (see requestNote).
export function proposeRequest(req, o, gid) {
  ui.pay = payeeRows(req.payees, () => ++ui.payKey);
  const room = o.dm || gid === state.gid ? "" : groupName(state.gid);
  ui.note = requestNote(o.name, o.verdict, { mine: o.mine, room });
  ui.listError = ""; ui.priority = false; ui.after = null;
  openSend({ sendFor: gid });
  if (gid === state.gid) { closeSession(); render(); return; }
  ui.tab = "overview";
  openGroup(gid);
}

const NO_BALANCE = "Wait for the first sync to finish. The app offers the address of a mainnet "
  + "wallet only when it knows the balance.";

// What the "Request a payment" form of a composer needs: the wallets that can receive, and why not.
function roomRequestWhy() {
  if (!state.wallet) return "The wallet address is not ready yet.";
  if (state.g.movedTo) {
    return "Change devices replaces this wallet with " + groupName(state.g.movedTo)
      + ". Ask for payments to the new wallet.";
  }
  const total = openTotal();
  if (!underCap(state.g, total)) {
    return total === undefined ? NO_BALANCE : "This wallet holds " + capText(curNet().cap)
      + ", the warning level for unaudited mainnet wallets. Do not ask for more.";
  }
  return myVerified() ? "" : "Your seat is still checking the wallet address.";
}

// In a wallet room, the request pays the open wallet. Only the wallet thread offers it.
export const roomRequest = () => ({
  why: roomRequestWhy,
  choices: () => roomRequestWhy() ? []
    : [{ id: state.gid, name: state.g.name, address: state.wallet.address,
      net: netName(state.g) }],
  fine: "Every device of this wallet, and anyone else who has the invite link, can read the "
    + "request.",
});

// In a direct chat, the person picks one of their wallets. The address is the one that this
// browser's own seat checked, never the store's copy.
export const chatRequest = () => ({
  why: () => dmChoices().length ? "" : "You hold no seat in a wallet that can receive a request. "
    + "A wallet needs a checked address" + (MAINNET_ON ? " and, on mainnet, a known balance under "
    + "the cap" : "") + ".",
  choices: dmChoices,
  fine: "Your contact, and anyone else who has the contact link, can read the address, the "
    + "amount and the memo of this request.",
});

export function dmChoices() {
  return seatWallets().flatMap((g) => {
    const address = moveAddress(g.id);
    const ok = address && underCap(g, balOf(g.id)?.total);
    return ok ? [{ id: g.id, name: g.name, address, net: netName(g) }] : [];
  });
}

// The wallet that the request pays: a choice in a chat, the open wallet in a room. The form holds
// the id of the wallet, never a position in the list, because the list can change while the person
// types. A single wallet has a hidden field, so submitRequest checks it in the same way.
function requestTarget(choices, kind, field) {
  const label = (c) => c.name + " (" + NETWORKS[c.net].label + ")";
  if (choices.length > 1) {
    const options = choices.map((c) => el("option", { value: c.id }, label(c)));
    const select = el("select", { class: "input", id: "req-to-" + kind, name: "to" }, options);
    return field("Pay to", select, "");
  }
  if (!choices.length) return el("p", { class: "small muted" });
  return [el("p", { class: "small muted" }, "Pays to " + label(choices[0])),
    el("input", { type: "hidden", name: "to", value: choices[0].id })];
}

export function requestForm(o) {
  const choices = o.request.choices(), why = o.request.why(), sending = busy.has(o.key);
  const field = (label, input, hint) => el("label", { class: "field" }, el("span", {}, label),
    input, el("span", { class: "hint" }, hint));
  const text = (id, extra) => el("input", {
    class: "input", id: id + o.kind, type: "text", autocomplete: "off", ...extra,
  });
  const to = requestTarget(choices, o.kind, field);
  return el("form", {
    class: "composer req-form", onsubmit: act((ev) => submitRequest(ev.target, o)),
  },
  el("h3", {}, "Request a payment"), why ? el("p", { class: "hint bad" }, why) : null, to,
  field("Amount in ZEC (optional)", text("req-amt-", {
    name: "amt", inputmode: "decimal", placeholder: "The payer chooses the amount",
    "aria-label": "Amount",
  }), "Leave it empty to let the payer choose the amount."),
  field("Memo (optional)", text("req-memo-", { name: "memo", "aria-label": "Memo" }),
    "The payer can send this memo with the payment."),
  el("div", { class: "composer-row" }, seatPicker(o, "req-as-" + o.kind),
    el("button", { class: "btn", type: "button", onclick: () => { ui.request = null; render(); } },
      "Cancel"),
    el("button", {
      class: "btn primary", type: "submit", disabled: !Z || !!why || !choices.length || sending,
    }, sending ? "Sending…" : "Send request")),
  el("p", { class: "small faint" }, o.request.fine));
}

// The wallet that the person chose, found by its id in the list as it is now.
function chosenWallet(form, o) {
  const id = form.elements.to ? form.elements.to.value : "";
  const choice = o.request.choices().find((c) => c.id === id);
  if (!choice) throw new Error(o.request.why() || "Choose a wallet again.");
  return choice;
}

export async function submitRequest(form, o) {
  if (busy.has(o.key)) return;
  const choice = chosenWallet(form, o);
  const made = requestPayees(choice.address, form.elements.amt.value, form.elements.memo.value);
  if (made.error) throw new Error(made.error);
  const r = checkText(Z.makeRequest(S(made.payees), REQUEST_NET[choice.net]));
  if (r.error) throw new Error(r.error);
  busy.add(o.key); render();
  try {
    await o.send(r.text, form.elements.as ? Number(form.elements.as.value) : o.seats[0]);
    ui.request = null;
  } finally { busy.delete(o.key); }
}
