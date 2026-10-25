// Security presentation. All operations are supplied existing application handlers.
import { el } from "./app-dom.js";
import { icon, sculptedIcon } from "./app-icons.js";
import { deriveSecurityDashboard, recoveryFileStatus, signerRecoveryStatus } from "./security-dashboard-model.js";

const CHAIN = { zec: "Zcash", sol: "Solana" };
const badge = (text, tone = "neutral", attrs = {}) =>
  el("span", { class: "security-status security-status--" + tone, ...attrs }, text);
const button = (label, onclick, attrs = {}) => el("button", {
  class: "btn sm", type: "button", onclick, ...attrs,
}, label);
const paragraph = (text, cls = "") => el("p", { class: cls }, text);

function reveal(id) {
  const details = document.getElementById(id);
  if (!details) return;
  details.open = true;
  details.querySelector("summary").focus();
  details.scrollIntoView({ block: "nearest" });
}

export function securityDashboard(f, actions, advanced) {
  const m = deriveSecurityDashboard(f);
  const primary = (ev) => {
    const next = m.next;
    if (next.kind === "backup") actions.backup(next.id, next.chain, ev);
    else if (next.kind === "check") actions.check(next.id, next.chain);
    else if (next.kind === "setup") actions.setup();
    else reveal(next.kind === "restore" ? "security-restore" : "security-files");
  };
  return el("div", { class: "security-recovery-page security-dashboard" },
    securityOverview(f, m, primary),
    el("section", { class: "security-signers", "aria-labelledby": "security-signers-title" },
      el("div", { class: "security-section-head" },
        el("div", {}, el("h3", { id: "security-signers-title" }, "Signing devices"),
          paragraph(m.valid ? f.t === f.n ? "All " + f.n + " devices must approve each transaction."
            : "Any " + f.t + " of " + f.n + " devices must approve each transaction."
            : "The signing rule is unavailable.")),
        m.valid ? badge(f.t + "-of-" + f.n) : null),
      el("div", { class: "security-signer-list" }, f.signers.map((s) => signerRow(s, f, actions))),
      el("details", { class: "security-explainer" },
        el("summary", {}, "What is a signing share?"),
        paragraph("Each device holds a separate part of the wallet’s signing authority. "
          + "The configured approval rule determines how many distinct shares must work together. "
          + "Two copies of the same share still count as one device. A label does not prove a person’s identity or a separate physical device."),
        paragraph(m.valid ? (f.n === f.t ? "Every share is required. If one is lost, restore it from its file before the wallet can pay."
          : "The Zcash wallet can tolerate losing " + (f.n - f.t) + " distinct shares while the remaining " + f.t + " can still approve.") : "Check the wallet’s configuration before relying on its recovery arrangement."),
        paragraph("Viewing access is separate from spending authority. Devices with viewing access can see this wallet’s balances and history."))),
    recoveryAccess(f, m, actions, advanced),
    el("div", { class: "security-browser-link" }, icon("lock"),
      paragraph("Browser protection is managed in Settings. A passkey unlocks local data; it does not replace a recovery file."),
      button("Browser access", actions.settings, { class: "btn ghost sm" })));
}

function securityOverview(f, m, primary) {
  const scopeText = f.solScope === "ready" ? "Zcash + Solana · same approval rule"
    : f.solScope === "none" ? "Zcash" : "Zcash · Solana status separate";
  const scopeUnknown = !["ready", "none"].includes(f.solScope);
  return el("section", { class: "security-overview", "aria-labelledby": "wallet-security-title" },
    el("div", { class: "security-overview-head" },
      el("div", { class: "security-overview-title" },
        el("span", { class: "security-emblem", "aria-hidden": "true" }, sculptedIcon("security")),
        el("h3", { id: "wallet-security-title" }, "Wallet security")),
      badge(m.label, m.tone)),
    el("dl", { class: "security-metrics" },
      metric("Signing rule", m.rule, scopeText),
      metric("Recovery files", m.total === null ? m.checked + " checked here" : m.checked + " of " + m.total + " checked",
        m.saved + " saved here" + (m.reported ? " · " + m.reported + " reported checked elsewhere" : "")),
      metric("Recovery readiness", m.readiness,
        m.allChecked ? "Accessibility is not guaranteed" : "Saved files alone do not establish recovery")),
    f.rosterKnown === false ? paragraph("Device records are still loading or awaiting checks. Signing availability and recovery status are not established yet.", "security-scope-note") : null,
    scopeUnknown ? el("div", { class: "security-scope-note" },
      paragraph("Solana · " + ({ pending: "Status is still being read or setup is unfinished.",
        stopped: "Setup stopped. Do not use the Solana part.",
        unavailable: "Status could not be read. Reload to retry." }[f.solScope] || "Status unavailable.")),
      paragraph("Zcash checks: " + m.chainCounts[0].checked + (f.formed ? " of " + f.n : "")
        + ". The total recovery-file requirement is not established yet."),
      actionsSolana(f)) : null,
    el("div", { class: "security-overview-footer" },
      el("div", { class: "security-overview-message" },
        m.critical ? el("div", { class: "security-notice security-notice--bad", role: "alert" },
          el("strong", {}, "Signing material needs attention"), paragraph(m.critical)) : null,
        m.allChecked ? el("div", { class: "security-checked-copy" },
          el("strong", {}, "Recovery files checked"),
          paragraph("All required recovery files have been checked using the available verification process. This does not prove that they remain accessible or guarantee recovery.")) : null,
        m.concentration ? el("div", { class: "security-notice" },
          el("strong", {}, m.concentration.title), paragraph(m.concentration.detail)) : null,
        !m.critical && !m.concentration && !m.allChecked ? el("div", {},
          el("strong", {}, m.held ? "Keep recovery within reach." : "Review each device’s recovery progress."),
          paragraph(f.rosterKnown === false ? "Wait for the existing device checks before reviewing recovery progress."
            : m.held ? "Save each share’s recovery file and keep its passphrase separately. Reopen saved files to check them."
            : "This browser holds no completed Zcash share. Other devices’ locations and file accessibility cannot be verified here.")) : null),
      button(m.next.label, primary, { class: "btn primary security-primary", "data-key": "security-primary" })),
    f.storageIssue || f.reportIssue ? el("div", { class: "security-progress-issue", role: "status" },
      f.storageIssue ? paragraph(f.storageIssue) : null,
      f.reportIssue ? paragraph(f.reportIssue) : null) : null);
}

// The caller includes only the existing navigation action, never a background chain operation.
const actionsSolana = (f) => f.openSolana ? button("Review Solana status", f.openSolana, { class: "btn ghost sm" }) : null;
const metric = (label, value, detail) => el("div", {}, el("dt", {}, label),
  el("dd", {}, value), paragraph(detail));

function signerRow(s, f, actions) {
  const id = "security-signer-" + s.id, [status, tone] = signerRecoveryStatus(s);
  const file = (chain) => recoveryFileRow(s, chain, actions);
  return el("article", { class: "security-signer" },
    badge(status, tone, { class: "security-status security-status--" + tone + " security-signer-status", id: id + "-status" }),
    el("details", { id },
      el("summary", { "aria-describedby": id + "-status", "data-key": id + "-summary" },
        el("span", { class: "security-device-avatar", "aria-hidden": "true" }, icon(s.local ? "browser" : "key")),
        el("span", { class: "security-signer-name" },
          el("strong", {}, (s.label || "Device") + " · " + s.id),
          el("span", {}, "Device " + s.id + " · " + (s.rosterUnknown ? "Reading device details…"
            : s.local ? "This browser" : s.joined ? "Location unknown" : "Not joined")),
          el("span", { class: "security-signer-chains" }, "Zcash" + (s.sol ? " · Solana" : ""))),
        el("span", { class: "security-details-link" }, el("span", { class: "security-details-closed" }, "View details"),
          el("span", { class: "security-details-open" }, "Hide details"), el("span", { "aria-hidden": "true" }, "⌄"))),
      el("div", { class: "security-signer-body" },
        el("dl", { class: "security-signer-facts" },
          fact("Device label", s.label || "No label supplied"),
          fact("Storage location", s.local ? "This browser" : "Not known by this browser"),
          s.joinedAt ? fact("Joined", s.joinedAt) : null,
          fact("Zcash address", s.address)),
        el("h4", {}, "Recovery files"), file("zec"), s.sol ? file("sol") : null,
        !s.local ? paragraph("Other devices’ progress is self-reported. This browser has not opened their files. Save or verify a file in the browser holding that share.", "security-file-help") : null)));
}

const fact = (title, value) => el("div", {}, el("dt", {}, title), el("dd", {}, value));
function recoveryFileRow(s, chain, actions) {
  const f = s[chain], local = s.local, label = CHAIN[chain] + " key share";
  return el("div", { class: "security-file-row" },
    el("span", { class: "security-file-mark", "aria-hidden": "true" }, icon(chain)),
    el("div", { class: "security-file-copy" }, el("strong", {}, label),
      el("span", {}, recoveryFileStatus(f, local))),
    el("div", { class: "security-file-actions" },
      local && f.has && !f.unknown && !f.missing ? [
        button("Back up", (ev) => actions.backup(s.id, chain, ev), {
          "aria-label": "Back up " + CHAIN[chain] + " share for device " + s.id,
          "data-key": "security-backup-" + s.id + "-" + chain }),
        button("Verify file", () => actions.check(s.id, chain), { disabled: !f.checkable,
          title: f.checkable ? "Open a saved file without restoring it" : "Wait for the existing address and setup checks",
          "aria-label": "Verify " + CHAIN[chain] + " file for device " + s.id,
          "data-key": "security-check-" + s.id + "-" + chain }),
      ] : local && f.missing ? button("Restore file", () => reveal("security-restore")) : null));
}

function recoveryAccess(f, m, actions, advanced) {
  const disclosure = (id, symbol, title, copy, ...body) => el("details", { class: "security-access-entry", id },
    el("summary", { "data-key": id + "-summary" },
      el("span", { class: "security-access-icon", "aria-hidden": "true" }, icon(symbol)),
      el("span", {}, el("strong", {}, title), el("span", {}, copy)),
      el("span", { class: "security-access-chevron", "aria-hidden": "true" }, "+")),
    el("div", { class: "security-access-body" }, ...body));
  return el("section", { class: "security-access", "aria-labelledby": "security-access-title" },
    el("div", { class: "security-section-head" }, el("h3", { id: "security-access-title" }, "Recovery & Access"),
      el("span", { class: "security-optional" }, "At your own pace")),
    el("div", { class: "security-access-list" },
      disclosure("security-files", "receive", "Back up & verify", "Save your shares. Check the files you keep.",
        paragraph("Backups and file checks are optional. A saved download is not a checked file. For recovery without the original browsers, keep files for at least "
          + f.t + " distinct devices for each chain, together with their separate passphrases. Extra copies of one share do not add another device."),
        el("div", { class: "security-chain-progress" }, m.chainCounts.map((c) => paragraph(CHAIN[c.chain] + " · " + c.checked
          + (c.total === null ? " checked here" : " of " + c.total + " checked here")))),
        paragraph("Choose View details on a device above to save or verify its individual chain files. Verification reopens a file without restoring shares or changing wallet keys."),
        button("Open recovery guide", actions.guide, { "data-key": "security-guide" }),
        el("details", { class: "security-explainer" }, el("summary", {}, "What the progress can tell you"),
          paragraph("Saved labels record copies exported or restored in this browser. Checked labels apply to files matched to this browser’s current share. Other devices’ signed reports are reported progress, not file checks performed here. No label proves that a file or passphrase remains accessible."),
          paragraph("Store each file and its passphrase safely and separately. The personal account has its own backup in Settings. Other wallets need their own files, and direct chats are not included in recovery files."))),
      disclosure("security-restore", "key", "Restore an existing device", "Recover a share in another browser or device.",
        paragraph("Use the encrypted recovery file and the passphrase chosen when it was saved. Restore the Zcash file first, then its separate Solana file when applicable. A passkey or backup passphrase alone cannot restore a share."),
        paragraph("A restored copy represents the same device; it does not add another approval. Keep working copies intact and avoid using two copies of the same device at once."),
        actions.restoreInput,
        button("Choose recovery file", actions.restore, { "data-key": "security-restore-file" }),
        advanced.invite,
        el("details", { class: "security-explainer" }, el("summary", {}, "If a device is lost"),
          paragraph(advanced.lost))),
      disclosure("security-advanced", "settings", "Advanced wallet management", "Change devices or review the wallet configuration.",
        paragraph("Changing devices or the approval rule requires a replacement wallet. Read the chain-specific limits before continuing."),
        advanced.management,
        button("Open wallet settings", actions.settings, { class: "btn ghost sm" }))));
}
