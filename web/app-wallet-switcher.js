// Wallet context presentation only. Selection delegates to the existing application action.
import { el, netBadge, ruleText } from "./app-dom.js";
import { walletMark } from "./app-wallet-art.js";

const OPEN = ".wallet-picker[open]";
const bound = new WeakSet();
const options = (picker) => [...picker.querySelectorAll('[role="menuitemradio"]')];
const trigger = (picker) => picker.querySelector("summary");

function close(picker, focus = true) {
  picker.open = false;
  picker.querySelector(".wallet-picker-panel").classList.remove("wallet-picker-enter");
  if (focus) trigger(picker).focus({ preventScroll: true });
}

// Only user input starts the decorative entrance. Restored open disclosures stay settled.
function incoming(picker) {
  if (!picker.open)
    picker.querySelector(".wallet-picker-panel").classList.add("wallet-picker-enter");
}

function position(picker) {
  const win = picker.ownerDocument.defaultView, box = trigger(picker).getBoundingClientRect();
  if (box.bottom < 0 || box.top > win.innerHeight) { close(picker, false); return; }
  const panel = picker.querySelector(".wallet-picker-panel");
  const width = Math.min(Math.max(box.width, 340), win.innerWidth - 32);
  const below = win.innerHeight - box.bottom - 24, above = box.top - 24;
  const flip = below < 200 && above > below;
  const height = Math.max(48, Math.min(420, flip ? above : below));
  panel.style.width = width + "px";
  panel.style.maxHeight = height + "px";
  panel.style.left = Math.max(16, Math.min(box.left, win.innerWidth - width - 16)) + "px";
  panel.style.top = Math.max(16, flip ? box.top - 8 - Math.min(panel.scrollHeight, height)
    : box.bottom + 8) + "px";
}

function observe(doc) {
  if (bound.has(doc)) return;
  bound.add(doc);
  const current = () => doc.querySelector(OPEN);
  const measure = () => { const picker = current(); if (picker) position(picker); };
  doc.addEventListener("click", (event) => {
    const picker = current();
    if (picker && !picker.contains(event.target)) close(picker);
  });
  doc.addEventListener("focusin", (event) => {
    const picker = current();
    if (picker && !picker.contains(event.target)) close(picker, false);
  });
  doc.defaultView.addEventListener("resize", measure);
  doc.defaultView.addEventListener("scroll", measure, true);
}

function navigate(event, picker, typing) {
  const rows = options(picker), at = rows.indexOf(picker.ownerDocument.activeElement);
  if (event.key === "Escape" && picker.open) {
    event.preventDefault(); event.stopPropagation(); close(picker); return;
  }
  if (event.key === "Tab") { close(picker); return; }
  let next;
  if (event.key === "ArrowDown") next = (at + 1) % rows.length;
  else if (event.key === "ArrowUp") next = (at <= 0 ? rows.length : at) - 1;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = rows.length - 1;
  else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey
    && event.key !== " ") {
    const now = Date.now(), letter = event.key.toLocaleLowerCase();
    typing.value = now - typing.at < 700 ? typing.value + letter : letter;
    typing.at = now;
    const prefix = [...typing.value].every((key) => key === letter) ? letter : typing.value;
    const start = prefix.length > 1 ? Math.max(0, at) : at + 1;
    next = rows.findIndex((_, i) => rows[(start + i) % rows.length].dataset.name
      .toLocaleLowerCase().startsWith(prefix));
    next = next < 0 ? undefined : (start + next) % rows.length;
  }
  if (next === undefined) return;
  event.preventDefault();
  incoming(picker);
  picker.open = true; position(picker);
  rows[next].focus({ preventScroll: true });
  rows[next].scrollIntoView({ block: "nearest" });
}

export function walletSwitcher(wallets, current, pick) {
  const typing = { value: "", at: 0 };
  const picker = el("details", { class: "wallet-picker", "data-key": "wallet-picker-" + current.id });
  const summary = el("summary", { class: "wallet-picker-trigger", "aria-label": "Switch wallet",
    "aria-haspopup": "menu", "aria-describedby": "wallet-switch-name", "data-key": "wallet-switch-trigger" },
  walletMark(current, 32), el("span", { class: "wallet-picker-name", id: "wallet-switch-name" }, current.name),
  el("span", { class: "wallet-picker-chevron", "aria-hidden": "true" }, "⌄"));
  summary.addEventListener("click", () => {
    incoming(picker);
    // Native toggle events may arrive after the first paint. Position before that paint too.
    requestAnimationFrame(() => {
      if (picker.open && picker.isConnected) position(picker);
    });
  });
  const panel = el("div", { class: "wallet-picker-panel", role: "menu",
    "aria-label": "Your wallets" }, el("p", { class: "wallet-picker-label", role: "presentation" }, "Your wallets"),
  wallets.map((wallet) => {
    const selected = wallet.id === current.id;
    const rule = Number.isInteger(wallet.t) && Number.isInteger(wallet.n)
      ? wallet.t + " of " + wallet.n + " approvals" : "Approval rule unavailable";
    return el("button", { class: "wallet-picker-row", type: "button", role: "menuitemradio",
      "aria-checked": String(selected), tabindex: "-1", "data-name": wallet.name,
      "data-key": "wallet-option-" + wallet.id, onclick: () => {
        close(picker);
        if (!selected) pick(wallet.id);
      } }, walletMark(wallet, 32), el("span", { class: "wallet-picker-copy" },
    el("span", { class: "wallet-picker-title" }, wallet.name),
    el("span", { class: "wallet-picker-meta" }, netBadge(wallet),
      el("span", { title: rule === "Approval rule unavailable" ? null : ruleText(wallet.t, wallet.n) }, rule))),
    selected ? el("span", { class: "wallet-picker-selected" },
      el("span", { "aria-hidden": "true" }, "✓ "), "Current") : null);
  }));
  picker.append(summary, panel);
  picker.addEventListener("keydown", (event) => navigate(event, picker, typing));
  picker.addEventListener("toggle", () => {
    typing.value = ""; typing.at = 0;
    if (!picker.open || !picker.isConnected) return;
    observe(picker.ownerDocument); position(picker);
    if (!panel.contains(picker.ownerDocument.activeElement))
      (options(picker).find((row) => row.getAttribute("aria-checked") === "true")
        || options(picker)[0]).focus({ preventScroll: true });
  });
  return el("div", { class: "wallet-switcher" }, el("h1", { class: "sr-only" }, current.name), picker);
}
