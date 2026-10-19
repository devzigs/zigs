// el, act, widgets, wording and labels.
import { qrSvg } from "./qr.js";
import { memoShown } from "./payees.js";
import { chunks, finite } from "./util.js";
import { clearBadBanner, log, showBanner, state, ui } from "./app-state.js";
import { initials, short, ZEC_FMT } from "./app-kit.js";
import { Z } from "./app-engine.js";
import { isMe, localSeats, seatMine, seatNameOf } from "./app-seats.js";
import { capText, curNet, MAINNET_ON, netOf, NETWORKS } from "./app-chain.js";
import { signedMode } from "./app-filter.js";
import { closeSession } from "./app-groups.js";
import {
  approvedHold, ended, expired, landed, payeesOf, sendRefusal, signingSeen,
} from "./app-payments.js";
import { focusAfter, react, render } from "./app-loop.js";

export const netBadge = (g) => netOf(g).cap
  ? el("span", { class: "badge bad", title: "Real ZEC. Not audited. At " + capText(netOf(g).cap)
    + " the app warns and hides the address. It cannot block deposits." }, "Mainnet")
  : el("span", { class: "badge plain" }, "Testnet");

export const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "class") n.className = v;
    // Through the CSSOM, which the style-src policy allows; a style attribute it refuses.
    else if (k === "style") n.style.cssText = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return n;
};
// The field of each note under a field. A red note marks its field as invalid.
const fieldOf = new WeakMap();
/** Ties the note `hint` to its field `input`, for setNote. */
export const noteFor = (hint, input) => fieldOf.set(hint, input);
/** Writes the note under a field. `cls` is the whole class: with "bad" and a text, the field of
 * the note gets aria-invalid="true". */
export function setNote(hint, text, cls) {
  hint.textContent = text;
  hint.className = cls;
  fieldOf.get(hint)?.setAttribute("aria-invalid", String(text !== "" && /\bbad\b/.test(cls)));
}
// A success makes an earlier error message obsolete, so it is cleared.
// A disabled button loses focus, so the key of the focused control is kept to give it back.
export const act = (fn) => async (ev) => {
  ev.preventDefault();
  const b = ev.currentTarget, key = document.activeElement.dataset.key;
  if (b) b.disabled = true;
  try {
    await fn(ev);
    clearBadBanner();
  } catch (e) { showBanner("bad", e.message || String(e)); }
  finally {
    if (b) b.disabled = false;
    focusAfter(key, false);
    render(); react();
  }
};
export function copyBtn(text, label = "Copy", cls = "btn sm") {
  const copy = async (ev) => {
    const b = ev.currentTarget;
    try {
      await navigator.clipboard.writeText(typeof text === "function" ? text() : text);
      b.textContent = "Copied";
    } catch { b.textContent = "Select and copy"; }
    setTimeout(() => b.textContent = label, 1500);
  };
  return el("button", { class: cls, type: "button", onclick: copy }, label);
}

// One bad document from another signer must not break the page: the item it feeds shows as a
// small unreadable card instead.
export const unreadable = () =>
  el("div", { class: "bad-card" }, "This item has data this app cannot read.");
export function guard(build, ...args) {
  try { return build(...args); }
  catch (e) { log("unreadable item: " + (e && e.message ? e.message : e)); return unreadable(); }
}

// `sign` is "out" or "in" for money leaving or entering the wallet.
export function money(zat, size = "md", sign = "") {
  if (!Number.isFinite(zat)) return el("span", { class: "money " + size }, "unknown");
  const [i, d] = ZEC_FMT.format(zat / 1e8).split(".");
  const pre = sign === "out" ? "−" : sign === "in" ? "+" : "";
  const text = pre + i + "." + (d || "00");
  // Screen readers get "12.50 ZEC" as one phrase; the visible unit is a separate, smaller span.
  const cls = "money " + size + (sign ? " " + sign : "");
  return el("span", { class: cls, role: "img", "aria-label": text + " ZEC" },
    text, el("span", { class: "cur", "aria-hidden": "true" }, "ZEC"));
}
export function seatLabel(i) {
  const s = state.seats[i];
  if (!s) return "Open seat";
  if (!seatMine(i)) return s.name || "Signer " + i;
  return localSeats().length > 1 ? "You (seat " + i + ")" : "You";
}
// In a version 3 wallet a name comes with its seat number, because two seats can use one name.
// A member picks the name, so a name can carry a false seat number: the real one goes after it.
export function named(i) {
  const label = seatLabel(i);
  const tag = " (seat " + i + ")";
  return signedMode(state.gid) && !label.endsWith(tag) ? label + tag : label;
}
export function avatar(i, cls = "") {
  const s = state.seats[i], mine = s && seatMine(i);
  return el("span", { class: "av round " + cls + (mine ? " me" : ""), title: seatLabel(i) }, s ? initials(mine ? (s.name || "You") : s.name || "M " + i) : "+");
}

const STATUS = {
  collecting: ["Needs approval", "warn"], signing: ["Signing", "info"], signed: ["Ready to prove", "info"],
  proving: ["Building proof", "info"], complete: ["Ready to send", "ok"], broadcast: ["Confirming", "info"], failed: ["Failed", "bad"],
  cancelled: ["Cancelled", ""],
};
// After signing, only the engine can say that it expired (TICKETS.md ZEC-13). A finished
// transaction that the send step refuses is not ready to send either (sendRefusal).
const asksCheck = (s) => (signingSeen(s) && expired(s))
  || (s.status === "complete" && !!sendRefusal(s));
export function statusChip(s) {
  if (s.checking) return el("span", { class: "badge" }, "Checking");
  if (landed(s)) return el("span", { class: "badge ok" }, "Sent");
  if (ended(s)) return el("span", { class: "badge" }, "Expired");
  if (asksCheck(s)) return el("span", { class: "badge warn" }, "Check");
  // An error part that one seat wrote does not end a payment that this browser approved and sent.
  if (approvedHold(s)) return el("span", { class: "badge info" }, "Confirming");
  const [t, c] = Object.hasOwn(STATUS, s.status) ? STATUS[s.status] : [String(s.status), ""];
  return el("span", { class: "badge " + c }, t);
}

// Payment wording. `who` comes from the engine: an address for the recipient, or a fixed phrase.
const OWN_OUTPUT = new Set(["this wallet", "change (back to this wallet)"]);
export const isPayee = (l) => l.kind === "output" && !OWN_OUTPUT.has(l.who);
export function payTitle(ss) {
  const p = payeesOf(ss);
  if (typeof ss.note === "string" && ss.note) return ss.note;
  if (p.length === 1) return "Payment to " + short(p[0].to, 8);
  return p.length ? "Payment to " + p.length + " recipients" : "Payment";
}
// What the proposer says leaves the wallet: the payees plus the fee.
export const leavesOf = (ss) => Number.isFinite(ss.amount) ? ss.amount + finite(ss.fee) : NaN;
export const ruleText = (t, n) => "Any " + t + " of " + n + " signers must approve each payment.";
export const groupName = (gid) => (state.groups.find((x) => x.id === gid) || {}).name || "the new wallet";
// In a version 3 wallet the proposer is the seat in `by`. Before, it is the identity in
// `createdBy`.
export const proposer = (ss) => Number.isInteger(ss.by)
  ? (localSeats().includes(ss.by) ? "you" : named(ss.by))
  : isMe(ss.createdBy) ? "you" : seatNameOf(ss.createdBy);
export function normalized(addr) { try { return Z.normalizeAddress(addr); } catch { return null; } }
export const onNetwork = (addr) => (normalized(addr) || "").startsWith(curNet().prefix);

export const unreadChip = (u) => u ? el("span", { class: "side-unread", role: "img", title: u + " unread",
  "aria-label": u + " unread" }, String(u)) : null;

// The name that `to` sees (your signers, or your contact); saved in this browser and read when you
// take a seat or join a chat.
export function nameField(id, to = "your signers") {
  let saved = ""; try { saved = localStorage.getItem("zf-name") || ""; } catch {}
  const save = (ev) => { try { localStorage.setItem("zf-name", ev.target.value.trim()); } catch {} };
  return el("label", { class: "field" }, el("span", {}, "Your name"),
    el("input", { class: "input", id, value: saved, maxlength: "40", autocomplete: "nickname", placeholder: "Any nickname · shown to " + to, oninput: save }));
}

// The choice lives in `sel` (`ui`, or `ui.personal`), so a redraw keeps it. `what` names the thing
// that holds the funds, and `idp` prefixes the ids.
// While MAINNET_ON is false, the picker shows Testnet only and no tick (M1).
export function networkPick(sel = ui, what = "wallet", idp = "g") {
  if (!MAINNET_ON) sel.net = "testnet";
  const on = (value) => (sel.net === value ? " on" : "");
  const opt = (value, title, text) => el("label", { class: "net-opt" + on(value) },
    el("input", { type: "radio", name: idp + "-network", value, id: idp + "-net-" + value,
      checked: sel.net === value, onchange: () => { sel.net = value; render(); } }),
    el("span", { class: "net-text" }, el("b", {}, title), el("span", { class: "small muted" }, text)));
  return el("fieldset", { class: "net-pick" },
    el("legend", { class: "label" }, "Network"),
    el("div", { class: "two" },
      opt("testnet", "Testnet", "Free test coins, for trying Zigs."),
      MAINNET_ON ? opt("mainnet", "Mainnet", "Real ZEC. At " + capText(NETWORKS.mainnet.cap)
        + " the app warns and hides the address. It cannot block deposits.") : null),
    sel.net === "mainnet" ? el("label", { class: "ack" },
      el("input", { type: "checkbox", id: idp + "-ack", checked: sel.ack,
        onchange: (ev) => { sel.ack = ev.target.checked; } }),
      el("span", { class: "small" }, "I understand that Zigs is not audited and that I can lose "
        + "the funds in this " + what + ".")) : null);
}

export const countBadge = (n, what, cls) => n
  ? el("span", { class: "count " + cls, role: "img", "aria-label": n + " " + what }, n) : null;
export const memoTexts = (r) => (Array.isArray(r.memos) ? r.memos : [])
  .map((m) => m && m.status === "text" && typeof m.text === "string" ? memoShown(m.text) : null);
export const sender = (i) => state.seats[i] ? named(i) : "Unknown sender";

export const logBox = (id, label, items, none) => el("div", {
  class: "chat-log", id, role: "log", tabindex: "0", "data-key": id, "aria-label": label,
}, items.length ? items : none);

export const newBadge = (n) => n
  ? el("span", { class: "badge info plain", role: "img", "aria-label": n + " unread" }, n + " new")
  : null;

export const coarse = () => matchMedia("(pointer: coarse)").matches;

export const skeleton = (cls = "") => el("span", { class: "skel " + cls, role: "img",
  "aria-label": "Loading balance" });

export const seatTitle = (i, s) =>
  s ? (seatMine(i) ? (s.name || "You") : s.name || "Signer " + i) : "Open seat";

// Groups of 5 characters help people compare an address by eye. Each group is its own span, so
// the spaces are only layout and a copied address has none.
export const addrGroups = (addr) =>
  el("span", {}, chunks(addr).map((c) => el("span", { class: "addr-g" }, c)));

// The SVG comes from our own encoder and holds only path data, so innerHTML is safe here.
export function qrBox(text, label) {
  const box = el("div", { class: "qr" });
  box.innerHTML = qrSvg(text, label);
  return box;
}
// A link with the wallet secret stays hidden until asked for: cameras and people can read screens.
export function secretQr(link, what = "wallet") {
  return el("details", { class: "qr-toggle" }, el("summary", {}, "Show QR code"),
    qrBox(link, what === "chat" ? "Contact link" : "Invite link"),
    el("p", { class: "small faint" }, "Scan with a phone camera to open the " + what + " there."));
}

// A memo for display: "" is no memo and null is one that the engine could not read as text.
const memoWords = (m) => m === null ? "Memo is not text" : m ? memoShown(m) : "No memo";
export const memoRow = (label, m, bad = false) => el("div", { class: "memo-line" + (bad ? " bad" : "") },
  el("span", { class: "label" }, label),
  el("span", { class: "memo-text" + (m ? "" : " faint") }, memoWords(m)));

export const closeBtn = () => el("button", {
  class: "icon-btn", type: "button", "aria-label": "Close",
  onclick: () => { closeSession(); render(); },
}, "×");
