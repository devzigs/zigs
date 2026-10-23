// Presentation only. Callers supply verified context; these marks never infer privacy from colour,
// an address prefix, account availability, a balance amount or a transaction's requested status.
const LABELS = Object.freeze({
  shielded: "Shielded", public: "Public", partial: "Partial privacy",
  unknown: "Privacy unknown", unsupported: "Privacy unavailable",
});

export function privacyBadge(el, role, label) {
  const mode = Object.hasOwn(LABELS, role) ? role : "unknown";
  return el("span", { class: "privacy-badge privacy-" + mode },
    el("span", { class: "privacy-motif", "aria-hidden": "true" }),
    el("span", {}, label || LABELS[mode]));
}

export function privacyNotice(el, role, label, text, attrs = {}) {
  // The input describes the whole notice; existing text selectors still identify its paragraph.
  const { id, ...textAttrs } = attrs;
  return el("div", { id, class: "privacy-notice" },
    privacyBadge(el, role, label), el("p", { ...textAttrs, class: "small" }, text));
}

// These balance states come only from a ready Solana part (overview-model.js). A closed motif
// would overstate privacy: amounts are hidden on chain, but owner keys and fee addresses are public.
export function solBalancePrivacy(el, row) {
  if (!row) return privacyBadge(el, "unsupported");
  if (["synced", "saved", "stale", "resync", "unsynced", "syncing"].includes(row.state))
    return privacyBadge(el, "partial", "Amount hidden · payee public");
  if (row.state === "unavailable") return privacyBadge(el, "unsupported");
  return privacyBadge(el, "unknown");
}

export const ZEC_EXPOSURE = "Zcash shields recipient addresses and amounts on chain. The network "
  + "fee and expiry are public; a one-day expiry or priority fee can mark a Zigs payment. "
  + "Wallet devices and invite-link holders can read its balance and history.";
export const SOL_EXPOSURE = "Solana Devnet hides a private payment’s amount on chain, but the "
  + "payee’s owner key and paying fee addresses are public. Deposits and withdrawals expose "
  + "amounts and addresses. Prover and service disclosures apply in Solana details.";
