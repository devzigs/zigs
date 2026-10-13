// Payment requests (ZIP 321) in messages and memos. The engine reads the URI (parseRequest and
// makeRequest). These helpers decide what a message shows and what the Send form gets. Checked by
// web/test/requests.mjs.
import { memoError, memoShown, toZat, zatText } from "./payees.js";

// A message is a payment request when its whole text, trimmed, is one ZIP 321 URI. A URI has no
// white space, so a URI inside other text is plain text.
export function requestUri(text) {
  const t = String(text ?? "").trim();
  return /^zcash:\S+$/.test(t) ? t : null;
}

// The network names of the engine's request calls, for the network names of the wallets.
export const REQUEST_NET = { testnet: "test", mainnet: "main" };
export const WALLET_NET = { test: "testnet", main: "mainnet" };

// The words for a request that the engine refuses. The engine's sentence starts in lower case.
export function requestProblem(error) {
  const text = String(error ?? "");
  return "This request cannot be used. " + text.charAt(0).toUpperCase()
    + text.slice(1).replace(/\.?$/, ".");
}

// The engine's error for an address of the other network. In a chat with no open wallet, the card
// asks for each network. This error then says nothing about why the request is bad.
const WRONG_NET = /^payee \d+: the address is not a (main|test)net address$/;

// What a message that holds a request shows. `env.nets` are the networks to try (engine names),
// `env.parse(uri, net)` is the engine call that gives JSON or throws, and `env.blocker(address)`
// is why Zigs cannot propose a payee, or "". Returns null for plain text, `{ uri, error }` when the
// engine refuses the request, and else `{ uri, net, payees, total, open, blocker }`. `total` is the
// sum when every payee has an amount, else null. `open` counts the payees without an amount.
export function readRequest(text, env) {
  const uri = requestUri(text);
  if (!uri) return null;
  const errors = [];
  for (const net of env.nets) {
    const got = attempt(env, uri, net);
    if (got.error) errors.push(got.error);
    else return summary(uri, net, got.payees, env);
  }
  return { uri, error: errors.find((m) => !WRONG_NET.test(m)) ?? errors[0] };
}

function attempt(env, uri, net) {
  try { return { payees: JSON.parse(env.parse(uri, net)).payees }; } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}

function summary(uri, net, payees, env) {
  const open = payees.filter((p) => p.amount == null).length;
  const total = open ? null : payees.reduce((n, p) => n + p.amount, 0);
  const blocker = payees.map((p) => env.blocker(p.to)).find(Boolean) || "";
  return { uri, net, payees, total, open, blocker };
}

const NOT_SHIELDED = "Zigs pays shielded unified addresses only.";

// Why Zigs cannot propose a payee, or "". `normalize(address)` is the engine's normalizeAddress,
// which gives the canonical form of a unified address with an Orchard receiver, else null.
export const payeeBlocker = (address, normalize) => normalize(address) ? "" : NOT_SHIELDED;

// Text for a one-line field: a line break becomes a space, and the characters that hide or
// reorder text become U+FFFD. So the field, the state of the form and the proposal agree.
const LINE_BREAKS = /[\r\n\u2028\u2029]+/g;
export const oneLine = (text) => memoShown(String(text ?? "").replace(LINE_BREAKS, " "));

// The rows of the Send form for payees `{ to, amount, memo? }`. An amount of null leaves the field
// empty for the person to fill. `key()` gives a new row key.
export const payeeRows = (payees, key) => payees.map((p) => ({
  k: key(), to: p.to, amt: p.amount == null ? "" : zatText(p.amount), memo: oneLine(p.memo),
}));

// The note of a proposal that starts from a request. The field holds at most 80 characters. The
// note goes to every approver. Only a verified sender is named: a message of a sender that is not
// verified can carry any name. The approvers do not read the name as this browser does: `mine`
// (a message from this browser, shown as "You") names the proposer, and `room` is the wallet of
// the room when the proposal goes to another wallet, where the seat numbers differ.
const NOTE_MAX = 80;
const UNVERIFIED_NOTE = { memo: "Request from a memo" };
export function requestNote(name, verdict, { mine = false, room = "" } = {}) {
  if (verdict !== "yes") return UNVERIFIED_NOTE[verdict] ?? "Request from an unverified sender";
  if (mine) return "Request from the proposer";
  let note = "Request from ";
  for (const ch of oneLine(room ? name + " in " + room : name)) {
    if (note.length + ch.length > NOTE_MAX) break;
    note += ch;
  }
  return note.trimEnd();
}

// Text that the sender of a request wrote (a name or a message), cut so that it cannot fill the
// card: at most 3 lines and 120 characters. A cut shows "…".
const QUOTE_LINES = 3, QUOTE_CHARS = 120;
export function quoted(text) {
  const lines = String(text ?? "").split(LINE_BREAKS).map((l) => l.trim()).filter(Boolean);
  const chars = [...lines.slice(0, QUOTE_LINES).join("\n")];
  const cut = lines.length > QUOTE_LINES || chars.length > QUOTE_CHARS;
  return memoShown(chars.slice(0, QUOTE_CHARS).join("")) + (cut ? "…" : "");
}

const WARNING = {
  no: "The sender is not verified. Check this request with the sender before you pay.",
  changed: "The signing key of the sender changed. Check this request with the sender "
    + "before you pay.",
  unknown: "The sender is unknown. Check this request with the sender before you pay.",
  memo: "A memo has no sender. Anyone who pays this wallet can write it. Check this request "
    + "with the sender before you pay.",
};

// What the card of a request shows besides the request. `verdict` is the check of the sender:
// "yes", "wait", "no", "changed", "unknown", or "memo" for a memo, which has no sender. `sendWhy`
// is why this app cannot send now, or "". `warning` is the text for a sender that is not verified.
// `why` is why "Propose this" is off, or "".
export function cardState(req, verdict, sendWhy = "") {
  const wait = verdict === "wait" ? "Wait until the app has checked the sender." : "";
  return { warning: WARNING[verdict] || "", why: req.blocker || wait || sendWhy };
}

const trimmed = (v) => String(v ?? "").trim();

// The payee list for makeRequest from the fields of the request form: an address, an amount in ZEC
// ("" for none) and a memo ("" for none). Returns `{ payees }` or `{ error }`.
export function requestPayees(address, amount, memo) {
  const amountText = trimmed(amount), memoText = trimmed(memo);
  const zat = amountText ? toZat(amountText) : undefined;
  if (zat === null) {
    return { error: "Enter an amount above zero with at most 8 decimals, or leave it empty." };
  }
  if (memoError(memoText)) return { error: memoError(memoText) };
  const payee = { to: address };
  if (zat) payee.amount = zat;
  if (memoText) payee.memo = memoText;
  return { payees: [payee] };
}
