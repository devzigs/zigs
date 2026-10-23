// The setup page: join, invite, safety and progress.
import { numberClash, usesV2 } from "./util.js";
import { showBanner, state, ui } from "./app-state.js";
import { linkView } from "./app-engine.js";
import { mySeatSecrets, requireSetupProtection, sec } from "./app-keystore.js";
import {
  allDone, allSeated, keysDiffer, localSeats, seatIds, seatMine, seatStage, STAGE_LABEL,
} from "./app-seats.js";
import { BROWSER_NOTE, inviteLink, PASSWORD_NOTE, senderNote } from "./app-links.js";
import { signedMode } from "./app-filter.js";
import { act, avatar, copyBtn, el, guard, nameField, qrBox, seatLabel, secretQr } from "./app-dom.js";
import {
  abortedText, confirmedBy, confirmSeats, confirmSeatsOf, groupVersion, holdsAllSeats,
  rejectedSeats, remoteAborts, safetyNo, SAVE_FAILED, saveFailed, stopSetup, takeSeat,
  verifiedCount,
} from "./app-dkg.js";
import { focusAfter, once, react, render } from "./app-loop.js";
import { activityLog } from "./app-wallet.js";
import { deviceProtection, offOf } from "./app-shell.js";
import { newWallet, SOL_DISCLOSURE, sol, solBackup, solError, solLoad, solLoading,
  solOn, solPlanned, solServed, solSetup } from "./app-sol.js";
import { quickCode, SETUP_STAGES, setupStage } from "./setup-model.js";
import { setupHeader, SETUP_FLOW_STAGES } from "./setup-wizard.js";
import { securityExplanation, tutorialDiagram, tutorialProgress } from "./app-tutorial.js";
import { beginGuided, completeGuided, guidedState, pauseGuided,
  retryGuidedReports, reviewGuided } from "./app-guided-setup.js";
import { openGroup } from "./app-groups.js";
import { outcomeSeal } from "./outcome-seal.js";
import { openBackup, openBackupCheck } from "./app-backups.js";
import { icon } from "./app-icons.js";
import { fundingSetupActive, openFundingPreview } from "./app-funding-preview.js";
import { walletMark, walletReveal } from "./app-wallet-art.js";

// Only an open overlay's wallet id is kept in memory; never persist an invitation capability.
let setupQrFor = null;
let setupQrCopy = null;
export const closeSetupQr = () => { setupQrFor = null; setupQrCopy = null; };
const openSetupQr = (copy = null) => {
  setupQrFor = state.gid; setupQrCopy = copy; render();
};
export function setupQrDialog() {
  if (!setupQrFor) return null;
  if (setupQrFor !== state.gid || ui.tab !== "overview" || !state.g) {
    closeSetupQr(); return null;
  }
  const f = guidedState();
  if (f.index !== 1 || f.blocked
    || !localSeats().length || state.sid || ui.backup || ui.restore) {
    closeSetupQr(); return null;
  }
  return el("section", { class: "dialog setup-qr-dialog", role: "dialog", "aria-modal": "true",
    "aria-labelledby": "setup-qr-title", "aria-describedby": "setup-qr-warning" },
    el("div", { class: "card-head" }, el("h2", { id: "setup-qr-title" }, "Private setup invitation"),
      el("button", { class: "icon-btn", type: "button", "aria-label": "Close invitation QR code",
        "data-first-focus": "", onclick: () => { closeSetupQr(); render(); } }, "×")),
    el("p", { class: "small muted", id: "setup-qr-warning" },
      "Scan on your intended device. This QR contains the private invitation: anyone with it can read wallet information and join an open device slot. Keep it out of photos and public screens."),
    qrBox(inviteLink(state.gid), "Private wallet invitation"),
    setupQrCopy ? el("label", { class: "field" },
      setupQrCopy === "message" ? "Select and copy the private invite message" : "Select and copy the private link",
      el("textarea", { class: "input secret-link", rows: setupQrCopy === "message" ? "5" : "2",
        readonly: true, onclick: (ev) => ev.currentTarget.select() },
        setupQrCopy === "message" ? inviteMessage(inviteLink(state.gid)) : inviteLink(state.gid))) : null,
    el("p", { class: "small muted" }, "Open the invitation in your device’s regular browser, then keep both devices connected."));
}

/** Compact presentation of the same seat/check facts used by the existing setup cards. */
function setupDeviceStatus(f, phase = "connect", joining = false) {
  const mine = localSeats(), open = seatIds().find((i) => !state.seats[i]);
  const confirmed = confirmedBy(safetyNo()), complete = f.protocolReady && !f.blocked;
  return el("section", { class: "setup-wallet-status surface-quiet" },
    el("div", { class: "setup-status-wallet" }, walletMark(state.g),
      el("div", {}, el("span", { class: "label" }, "Shared wallet"),
        el("h3", {}, state.g.name), el("p", { class: "small muted" },
          "Any " + state.g.t + " of " + f.n + " devices · Zcash " + (state.g.network || "testnet")
            + (f.solWanted ? " · Solana Devnet" : "")))),
    el("ul", { class: "setup-device-list", "aria-label": "Participating devices" }, seatIds().map((i) => {
      const here = mine.includes(i), target = joining && i === open, seated = !!state.seats[i];
      const pending = !f.blocked && !complete && (target || here && (phase === "connect"
        || phase === "verify" && !confirmed.includes(i) || phase === "prepare" && seatStage(i) < 5));
      const status = !seated ? target ? "This device · Not joined" : "Awaiting connection"
        : phase === "verify" ? confirmed.includes(i) ? "Matching code confirmed" : "Awaiting code comparison"
          : complete ? "Wallet checked" : STAGE_LABEL[seatStage(i)];
      return el("li", { class: "setup-device-row" + (here || target ? " active-device" : "")
        + (pending ? " setup-device-pending" : ""),
      "data-device-seat": String(i), "data-device-role": i === 1 ? "initiator" : "joiner" },
      el("span", { class: "setup-device-mark", "aria-hidden": "true" }, icon(i === 1 ? "laptop" : "phone")),
      el("div", {}, el("strong", {}, "Device " + i + (here ? " · You" : "")),
        el("span", { class: "small muted setup-device-label" }, state.seats[i]?.name || "Independent signing share")),
      el("span", { class: "small setup-device-state" }, status));
    })),
    el("p", { class: "small muted" }, phase === "verify"
      ? "Confirm on each actual device. A device’s reported confirmation does not replace your comparison."
      : complete ? "Preparation checks are complete. Each device keeps its own share; payments still need your approval rule."
        : "Device labels show participation, not identity or live connectivity. Use separate physical devices. Every device must keep Zigs open until setup finishes."
          + (f.solWanted && bothParts() ? " " + BOTH_OPEN : "")));
}

const guideAct = (fn) => () => { try { fn(); } catch (e) { showBanner("bad", e.message); } render(); };
function walletDiagram(kind, extra = {}) {
  return tutorialDiagram(kind, { walletName: state.g?.name || "Your shared wallet", rule: state.g,
    devices: seatIds().map((i) => state.seats[i] ? seatLabel(i) : "Device " + i), ...extra });
}


/** One presentation shell from joining through local backup checks. No readiness value here
 * is an input to the ceremony or any payment authorization. */
export function guidedSetupView(notices = []) {
  const facts = guidedState();
  const no = safetyNo();
  const localCheckNeeded = safetyOpen() && confirmSeatsOf().some((i) => sec(state.gid, i).confirmed !== no);
  const current = localCheckNeeded ? { ...facts, index: 2, stage: "Verify" } : facts;
  const f = { ...current, review: current.review > current.index ? null : current.review };
  const at = f.review ?? f.index;
  const reveal = f.complete && f.review === null
    ? walletReveal(state.g, () => { focusAfter("setup-completion-title", true); render(); }) : null;
  const exit = () => {
    try { pauseGuided(); } catch (e) { showBanner("bad", e.message); }
    openGroup(null); render();
  };
  const funding = f.complete && fundingSetupActive(state.gid);
  const review = (i) => guideAct(() => i === 5 ? finishSetupPresentation()
    : reviewGuided(i === f.index ? null : i))();
  if (reveal) return el("div", { class: "page guided-setup wallet-reveal-page" }, ...notices,
    el("header", { class: "wallet-reveal-nav" }, el("span", { class: "small muted" }, state.g.name),
      el("button", { class: "btn ghost", type: "button", onclick: exit }, "Save and exit")),
    f.storageIssue ? el("div", { class: "callout bad", role: "alert" }, f.storageIssue) : null,
    saveFailedCard(), reveal);
  const body = f.review !== null && f.review < f.index ? guidedExplanation(at, f)
    : f.complete ? guidedReady(f)
    : at === 1 ? guidedConnect(f) : at === 2 ? guidedVerify(f)
      : at === 3 ? guidedPrepare(f) : at === 4 ? guidedBackups(f) : guidedExplanation(0, f);
  return el("div", { class: "page guided-setup", "data-key": "guided-setup",
    "data-motion-watch": "setup", "data-motion-value": f.protocolReady ? "on" : "off" },
    ...notices,
    setupHeader(el, state.g, f.solWanted, exit),
    tutorialProgress(funding ? 5 : f.index, funding ? at : f.review, review, SETUP_FLOW_STAGES),
    f.index === 1 || f.index === 2 ? linkLine() : null,
    f.storageIssue ? el("div", { class: "callout bad", role: "alert" }, f.storageIssue) : null,
    f.blocked ? el("div", { class: "callout bad", role: "alert", tabindex: "-1",
      "data-key": "stop-setup" },
      "Setup stopped at " + f.stage + ". " + f.blocked,
      el("p", { class: "small" }, "Stop here. Do not send funds or continue with mismatched devices. "
      + "After checking the cause with all devices, create a new wallet if the safety number or address differs."),
      newWalletButton()) : null,
    saveFailedCard(),
    body,
    f.complete && f.review === null ? null
      : el("p", { class: "small faint guided-footnote" }, "Device names help recognition. Compare the actual safety number to verify the devices."));
}

function guidedExplanation(index, f) {
  if (index === 2 && safetyOpen()) return el("section", { class: "guided-card" },
    safetyCard(), el("button", { class: "btn primary", type: "button",
      onclick: guideAct(() => reviewGuided(null)) }, "Return to current step"));
  const explanations = [
    ["Your wallet, protected together", "shares", "All " + f.n + " devices take part in initial setup. "
      + "Afterwards, any " + state.g.t + " can authorize a payment. The reserve is a normal Zigs device that must connect when needed."],
    ["Connect independent devices", "connect", "Open the private setup link on separate physical devices. Browser windows on one device are not independent signing devices."],
    ["Check the same safety number", "verify", "Compare all 30 digits on every device. A device label is not proof of who holds it. A mismatch must stop setup."],
    ["Prepare the wallet together", "prepare", "The existing wallet checks prepare Zcash first, then the requested Solana part. Revisiting this explanation never repeats a completed operation."],
    ["Keep each device recoverable", "backup", "Each file copies this device’s share. It needs its passphrase, and copying it does not create another independent device."],
  ];
  const [title, diagram, copy] = explanations[index];
  return el("section", { class: "card card-pad guided-card" }, el("h2", {}, title),
    securityExplanation(["device", "connect", "verify", "prepare", "backup"][index]),
    walletDiagram(diagram), el("p", {}, copy),
    el("button", { class: "btn primary", type: "button",
      onclick: guideAct(() => reviewGuided(null)) }, "Return to current step"));
}

function guidedConnect(f) {
  const open = seatIds().filter((i) => !state.seats[i]), joining = !localSeats().length;
  const reserve = !joining && f.seated >= 2 && f.n === 3;
  const title = joining ? "Connect this device" : reserve
    ? "Connect your reserve device" : "Connect your second device";
  return el("section", { class: "guided-card setup-connect" },
    el("h2", {}, title),
    el("div", { class: "setup-two-columns" },
      el("div", { class: "setup-status-column" }, setupDeviceStatus(f, "connect", joining),
        demoDevices(open)),
      el("div", { class: "setup-action-column" },
        joining && open.length ? joinCard(open[0], true) : open.length ? inviteCard(open.length, true) : null)),
    f.solWanted && solError ? el("p", { class: "small muted", role: "status" },
      "Solana setup is waiting for service availability. Your Zcash progress is saved.") : null);
}

function guidedVerify(f) {
  return el("section", { class: "guided-card setup-verification" },
    el("div", { class: "setup-two-columns" }, setupDeviceStatus(f, "verify"),
      el("div", { class: "setup-action-column" }, safetyCard(true),
        f.blocked ? null : el("p", { class: "small muted", role: "status" }, verificationWaiting()))));
}

function verificationWaiting() {
  const no = safetyNo();
  const local = confirmSeatsOf().filter((i) => sec(state.gid, i).confirmed !== no);
  if (local.length) return "This browser still needs you to compare and confirm the actual number on every device. "
    + "A remote report cannot replace your confirmation here.";
  const waiting = seatIds().filter((i) => !confirmedBy(no).includes(i));
  return waiting.length ? "Waiting for " + waiting.map(seatLabel).join(", ")
    + " to confirm. Every device must confirm before wallet preparation starts."
    : "Every device reported a matching number. Preparation continues automatically after the existing local checks.";
}

function preparationWaiting(c, f) {
  const stage = c.d < c.n ? 4 : c.ver < c.n ? 5 : null;
  if (stage) return "Waiting for " + seatIds().filter((i) => seatStage(i) < stage)
    .map(seatLabel).join(", ") + (stage === 4 ? " to finish Zcash preparation." : " to check the Zcash address.");
  if (f.solWanted && f.solStatus === "running" && sol) {
    const waiting = seatIds().filter((i) => !sol.ctl.docs?.soldone?.[i]);
    if (waiting.length) return "Waiting for " + waiting.map(seatLabel).join(", ") + " to finish Solana preparation.";
  }
  return "Keep all devices connected until their requested chain checks are complete.";
}

function guidedPrepare(f) {
  if (f.solWanted && !sol) solServed();
  const c = setupCounts(), [keyStage, keyText] = keyStep(c), [addressStage, addressText] = addrStep(c);
  const unavailable = f.solWanted && (f.solStatus === "unavailable"
    || !sol && ui.solServed === false);
  const summary = solSetup(), solText = unavailable
    ? "Solana setup is waiting for service availability. Your Zcash setup is saved."
    : f.solWanted && f.zecReady && !f.solReady ? "Zcash is checked. The same devices now prepare Solana automatically when the existing local consent and service checks allow it."
      : "Keep Zigs open on every device while they exchange encrypted setup messages and check the shared address.";
  return el("section", { class: "card card-pad guided-card" },
    el("h2", {}, "Prepare your wallet"), securityExplanation("prepare"),
    walletDiagram("prepare"), el("p", {}, solText),
    f.blocked ? null : el("p", { class: "small muted", role: "status" }, preparationWaiting(c, f)),
    linkLine(),
    el("div", { class: "steps" },
      setupStep(keyStage, 1, "Zcash preparation", keyText),
      setupStep(addressStage, 2, "Zcash address checks", addressText),
      f.solWanted ? setupStep(f.solReady ? "done" : ["stopped", "differs"].includes(f.solStatus) ? "bad" : "now", 3,
        "Solana preparation", unavailable ? solText : solKeyStep(summary)[1]) : null),
    f.solWanted ? el("details", { class: "small muted" }, el("summary", {}, "Solana service and privacy details"),
      el("p", {}, SOL_DISCLOSURE)) : null,
    unavailable ? el("p", { class: "small muted" }, "Keep this wallet and its existing keys. Retry when the service is available; do not recreate the wallet or reset its keys.") : null,
    unavailable ? el("button", { class: "btn", type: "button", onclick: () => location.reload() }, "Reload to retry connection") : null,
    continueWithZcash(f),
    guidedSolConsent(f),
    earlyZcashBackups(f),
    el("p", { class: "small muted" }, "No fee funding is required to finish initial preparation. A public SOL fee address needs funds only when this device first performs a paid Solana operation."),
    el("details", { class: "card card-pad" }, el("summary", {}, "Technical setup details"),
      safetyCard(), progressCard(), seatsCard([])));
}

// Overview holds Send and Receive. A wallet whose Zcash part is checked must not wait for a
// Solana part that is slow, stopped or out of service: Overview shows that part as it sets up.
function continueWithZcash(f) {
  if (f.blocked || !f.zecReady || !f.solWanted || f.solReady) return null;
  return el("section", { class: "surface-quiet guided-zcash-only" },
    el("h3", {}, "Use Zcash while Solana sets up"),
    el("p", { class: "small muted" }, "Send and Receive for Zcash work now. Overview shows the Solana "
      + "part while it sets up. " + BOTH_OPEN),
    el("button", { class: "btn primary", type: "button", "data-key": "guided-zcash-only",
      onclick: guideAct(() => finishSetupPresentation(true)) }, "Continue with Zcash"));
}

function earlyZcashBackups(f) {
  if (!f.zecReady || !f.solWanted || f.solReady) return null;
  return el("section", { class: "surface-quiet guided-backup-device" },
    el("h3", {}, "Keep your Zcash progress recoverable"),
    el("p", { class: "small muted" }, "Your Zcash setup is saved. Saving a separate ZEC recovery file is optional while Solana waits. The file copies this share and needs its separate passphrase. Reopening it is an optional check."),
    f.backups.filter((b) => b.local).map((b) => guidedBackupRow({ ...b, solRequired: false })));
}

function guidedSolConsent(f) {
  if (f.blocked || !f.solWanted || !f.zecReady || f.solReady || f.solStatus !== "not started") return null;
  if (sec(state.gid, 1)?.solAuto === true) return null;
  if (!localSeats().includes(1)) return el("p", { class: "small muted" },
    "Waiting for " + seatLabel(1) + " to review the Solana service disclosure and start its existing setup.");
  const off = offOf({ pending: state.pending }, "why-guided-sol");
  return el("section", { class: "surface-quiet guided-sol-consent" },
    el("h3", {}, "Prepare Solana Devnet in this wallet"),
    el("p", { class: "small" }, SOL_DISCLOSURE),
    el("p", { class: "small muted" }, "Your Zcash setup is saved. This action uses the existing Solana setup checks and keeps your wallet keys. No public fee funding is needed during preparation."),
    el("button", { class: "btn primary", type: "button", ...off.attrs,
      disabled: !!off.attrs.disabled || !!solLoading && !sol,
      onclick: act(async () => {
        if (!sol) { await solLoad(); return; }
        await sol.add();
      }) }, sol ? "Accept and prepare Solana" : solLoading ? "Checking service…" : "Check Solana service availability"),
    off.note);
}

function guidedBackups(f) {
  return el("section", { class: "card card-pad guided-card" },
    el("h2", {}, "Recovery files are optional"), securityExplanation("backup"), walletDiagram("backup"),
    recoveryExplanation(), recoveryProgress(f),
    el("div", { class: "guided-backup-list" }, f.backups.map(guidedBackupRow)),
    reportIssueCard(f), overviewAfterSetup(f));
}

const savedFor = (b, chain) => b[chain + "Saved"] === true || b[chain + "Checked"] === true;
const checkedFor = (b, chain) => b[chain + "Checked"] === true;
function backupWords(b, chain) {
  if (checkedFor(b, chain)) return b.local ? "Saved and checked here"
    : "Saved and checked · reported by this device";
  if (savedFor(b, chain)) return b.local ? "Saved, not checked"
    : "Saved, not checked · reported by this device";
  return b.local ? "Not saved yet" : "No saved-file report from this device";
}

function recoveryExplanation() {
  return el("div", { class: "guided-recovery-copy" },
    el("p", {}, "Save encrypted recovery files if you want a separate copy of this device’s share. Saving and reopening files is optional; you can use Overview after the wallet is prepared."),
    el("p", { class: "small muted" }, "Each file needs its passphrase. Keep the file and passphrase separately. Copying one share does not create another independent device. Recovery still needs "
      + state.g.t + " usable independent shares. Saved payment recipients, general chats and private descriptions are not included in these files."));
}

function recoveryProgress(f) {
  const any = f.backups.filter((b) => savedFor(b, "zec") || savedFor(b, "sol")).length;
  const count = (chain) => f.backups.filter((b) => savedFor(b, chain)).length;
  return el("div", { class: "surface-quiet guided-recovery-progress", role: "status" },
    el("strong", {}, "Saved-file progress · " + any + " of " + f.n + " devices"),
    el("p", { class: "small" }, "ZEC: " + count("zec") + " of " + f.n + " devices saved or reported a file."
      + (f.solWanted ? " SOL: " + count("sol") + " of " + f.n + " devices saved or reported a file." : "")),
    el("p", { class: "small muted" }, any > 0 && any < f.n
      ? "This is partial backup progress. A file count is not a guarantee of recoverability; recovery needs " + state.g.t + " usable independent shares and their passphrases."
      : "Saved-file counts describe progress, not a guarantee of recoverability. Only reopening a file checks that copy; remote checks are reports from the other device."));
}

function guidedBackupRow(b) {
  const chains = b.solRequired ? ["zec", "sol"] : ["zec"];
  const one = (chain) => {
    const upper = chain.toUpperCase();
    return el("div", { class: "guided-backup-chain" },
      el("span", { class: "small" }, upper + " · " + backupWords(b, chain)),
      b.local ? backupSaveButton(b, chain) : null);
  };
  return el("section", { class: "guided-backup-device surface-quiet" },
    el("h3", {}, seatLabel(b.seat) + (b.local ? " · This browser" : " · Another device")),
    ...chains.map(one),
    b.local ? el("details", { class: "optional-backup-check" },
      el("summary", {}, "Optional: check saved files"),
      el("p", { class: "small muted" }, "Reopen a saved file with its passphrase to check this copy without restoring or replacing any key shares."),
      el("div", { class: "row-actions" }, backupCheckButtons(b))) : null);
}

const backupChains = (b) => b.solRequired ? ["zec", "sol"] : ["zec"];
function backupSaveButton(b, chain, compact = false) {
  const label = "Save " + chain.toUpperCase() + " backup";
  const statusId = "backup-status-" + b.seat + "-" + chain;
  return el("button", { class: "btn" + (compact ? " compact-backup-save" : ""), type: "button",
    "aria-label": compact ? label : null, "aria-describedby": compact ? statusId : null,
    onclick: chain === "zec" ? () => openBackup(b.seat) : act(() => solBackup(b.seat)) },
    compact ? [el("span", {}, label), el("span", { class: "small muted", id: statusId }, backupWords(b, chain))] : label);
}
const backupCheckButtons = (b) => backupChains(b).map((chain) => el("button", {
  class: "btn", type: "button", onclick: () => openBackupCheck(b.seat, chain),
}, "Check saved " + chain.toUpperCase() + " file"));
function compactBackupRow(b, check = false) {
  return el("section", { class: "compact-backup-device", "data-backup-seat": String(b.seat) },
    el("h4", {}, "Device " + b.seat),
    el("div", { class: "compact-backup-chains", "data-chains": String(backupChains(b).length) },
      check ? backupCheckButtons(b) : backupChains(b).map((chain) => backupSaveButton(b, chain, true))));
}

function finishSetupPresentation(zcashOnly = false) {
  // Only the creator is offered the one-time mock funding step. No protocol gate reads it.
  completeGuided(state.gid, { zcashOnly });
  ui.tab = "overview";
  if (localSeats().includes(1)) openFundingPreview(state.gid);
}

function overviewAfterSetup(f) {
  return el("div", { class: "row-actions" },
    el("button", { class: "btn primary", type: "button", disabled: !f.protocolReady,
      onclick: guideAct(finishSetupPresentation) },
    localSeats().includes(1) ? "Continue to funding" : "Open Overview"));
}

function guidedReady(f) {
  const local = f.backups.filter((b) => b.local);
  return el("section", { class: "guided-card setup-completion" },
    el("h2", { class: "outcome-heading", "data-key": "setup-completion-title", tabindex: "-1" }, outcomeSeal("setup"),
      el("span", {}, "Your wallet is prepared")),
    el("div", { class: "setup-two-columns" },
      setupDeviceStatus(f, "complete"),
      el("section", { class: "setup-action-column setup-completion-actions surface-quiet" },
        el("h3", {}, "Backup & recovery"),
        el("p", { class: "small muted" }, "Optional · Keep encrypted files and passphrases apart. Recovery needs " + state.g.t + " usable independent shares."),
        el("div", { class: "compact-backup-list", "aria-label": "Backup shares on this browser" }, local.map((b) => compactBackupRow(b))),
        el("div", { class: "setup-completion-details" },
          el("details", { class: "optional-backup-check setup-completion-checks" },
            el("summary", {}, "Optional: check saved files"),
            el("p", { class: "small muted" }, "Reopen a saved file with its passphrase to check this copy without restoring or replacing any key shares."),
            local.map((b) => compactBackupRow(b, true))),
          el("details", { class: "setup-recovery-details" }, el("summary", {}, "Recovery progress and limits"),
            recoveryExplanation(), recoveryProgress(f),
            el("div", { class: "guided-backup-list" }, f.backups.filter((b) => !b.local).map(guidedBackupRow)),
            reportIssueCard(f))),
        overviewAfterSetup(f))));
}

function reportIssueCard(f) {
  return f.reportIssue ? el("div", { class: "callout warn", role: "status" },
    el("span", {}, f.reportIssue),
    el("button", { class: "btn", type: "button", onclick: act(retryGuidedReports) }, "Retry progress report")) : null;
}

export function setupView() {
  const open = seatIds().filter((i) => !state.seats[i]);
  const top = !localSeats().length && open.length ? joinCard(open[0])
    : open.length ? inviteCard(open.length) : null;
  const split = keysDiffer() ? el("div", { class: "callout bad", role: "alert" },
    "The devices made different wallet keys, so this wallet is not safe to use. "
    + "Do not send funds to it. Create a new wallet.") : null;
  const stopped = abortedText();
  return el("div", { class: "page", style: "gap:16px" }, stageBar(), split,
    // The key of the Stop setup button: after a stop, the focus stays here.
    stopped ? el("div", { class: "callout bad", role: "alert", tabindex: "-1",
      "data-key": "stop-setup" }, stopped, newWalletButton()) : null,
    saveFailedCard(), top,
    !top && !safetyOpen() ? securityExplanation("prepare") : null,
    el("details", { class: "card card-pad setup-education" }, el("summary", {}, "Why these setup steps matter"),
      walletDiagram("shares"),
      el("p", { class: "small muted" }, "First the devices join, then you compare their safety number. They create the wallet key together and each checks the shared address. Save a separate encrypted backup for every device when setup finishes."),
      bothParts() ? el("p", { class: "small muted" }, "Solana follows the Zcash address check automatically for this wallet. It uses a separate key share and backup file, plus public fee addresses. The existing funding and privacy warnings still apply.") : null),
    safetyCard(),
    el("div", { class: "setup" }, progressCard(), seatsCard(open)),
    localSeats().length ? el("div", { class: "row-actions" },
      el("button", { class: "btn", type: "button", onclick: () => { ui.tab = "messages"; render(); } },
        "Open wallet conversation in Chats")) : null);
}

// The stage of the setup, from the counts of the progress card. A stop shows its own text: the
// stepper never shows a stopped setup as a stage on track. The files come on the wallet page.
function stageBar() {
  const c = setupCounts();
  const { index, blocked } = setupStage({ seated: c.seated, n: c.n, verify: c.v2,
    confirmed: c.conf, blocked: blockText(c) });
  return el("nav", { class: "stage-bar", "aria-label": "Setup stages" },
    el("ol", {}, SETUP_STAGES.map((name, i) => el("li", {
      class: i < index ? "done" : i === index && blocked ? "stopped" : null,
      "aria-current": i === index ? "step" : null }, name))),
    el("p", { class: "small " + (blocked ? "bad" : "muted"), role: "status" }, blocked
      ? "Setup stopped at " + SETUP_STAGES[index] + ". " + blocked
      : "Step " + (index + 1) + " of " + SETUP_STAGES.length + ": " + SETUP_STAGES[index]
        + ". " + STAGE_NOTE[index]));
}
const STAGE_NOTE = ["", "Every device joins with the invite link.",
  "Compare the safety number on every device, then confirm it.",
  "The devices create the key together and check the address. Keep Zigs open."];
// A wallet document with no birthday comes from an older version of Zigs: a stop too.
function blockText(c) {
  const key = keyBlock(c);
  if (key && key[0] === "bad") return key[1];
  return c.rejected.length || (c.w && !c.w.birthday) ? addrStep(c)[1] : null;
}

// Version 2 wallets: the signers compare one number before the key ceremony starts. It stays
// visible until every seat holds its key share.
// A seat that checked the address ended its setup: hidden documents bring no stop back.
const checkedHere = () => mySeatSecrets(state.gid).some(([, s]) => s.checkedWallet);
const safetyOpen = () => usesV2(groupVersion()) && allSeated() && !allDone() && !holdsAllSeats()
  && !checkedHere();

// The person fixes the cause, then tries again. The reactor does not retry a failed save.
function saveFailedCard() {
  if (![...saveFailed].some((k) => k.startsWith(state.gid + ":"))) return null;
  const again = () => { saveFailed.clear(); render(); react(); };
  return el("div", { class: "callout bad", role: "alert" },
    el("span", { style: "flex:1 1 16rem" }, SAVE_FAILED),
    el("button", { class: "btn sm", type: "button", onclick: again }, "Try again"));
}

function safetyCard(compact = false) {
  if (!safetyOpen() || abortedText() || remoteAborts().length) return null;
  const no = safetyNo(), n = state.g.n;
  if (!no) {
    return el("div", { class: "callout bad", role: "alert" },
      "A device holds a key that this app cannot read. Do not use this wallet. Create a new "
      + "wallet.");
  }
  const yes = confirmedBy(no).length, clash = numberClash(no, state.confirm, seatIds());
  const seated = mySeatSecrets(state.gid).length > 0;
  return el("section", { class: "card card-pad hero-card" },
    el("div", { class: "card-head" }, el("h2", {}, "Check that your devices match"),
      el("span", { class: "badge " + (yes === n ? "ok" : "warn") }, yes + " of " + n + " confirmed")),
    compact ? null : securityExplanation("verify"),
    el("p", { class: "small" }, "Compare this safety number on every device, on a call or in "
      + "person. If every device shows it, only your devices joined this wallet."),
    compact ? null : walletDiagram("verify", { number: no, devices: seatIds().map(seatLabel) }),
    el("div", { class: "safety", "aria-label": "30-digit verification code" },
      no.split(" ").map((digits, i) => el("span", { class: "safety-group" }, digits + (i < 5 ? " " : "")))),
    ...(compact ? [el("details", { class: "safety-details" },
      el("summary", {}, "About the verification code"), ...safetyHelp(no, seated))] : safetyHelp(no, seated)),
    clash.length ? el("div", { class: "callout bad", role: "alert" }, "Device " + clash.join(", ")
      + " confirmed another number. Someone else may have joined. Do not continue. "
      + "Create a new wallet.") : null,
    seated ? el("div", { class: compact ? "verification-actions" : "" }, ...safetyActions(no)) : null);
}
// The quick code is an aid only. A browser without a seat is not told to tap a button.
function safetyHelp(no, seated) {
  const quick = quickCode(no);
  return [quick ? el("p", { class: "small muted safety-quick" }, "The first digits, " + quick + ", help you "
    + "find the number. They are not enough: compare all 30 digits.") : null,
  el("p", { class: "small muted" }, "If one device shows a different number, someone else may "
    + "have joined." + (seated ? " Then tap \"Codes don’t match\"." : "")
    + (bothParts() ? " " + BOTH_OPEN : ""))];
}
function safetyActions(no) {
  const todo = confirmSeatsOf().filter((i) => sec(state.gid, i).confirmed !== no);
  return [todo.length ? confirmPart(todo, no) : doneHere(no), mismatchPart()];
}
const doneHere = (no) => {
  const mine = mySeatSecrets(state.gid);
  const done = mine.length > 0 && mine.every(([, s]) => s.confirmed === no);
  // The key of the It matches button: after the confirm, the focus stays here.
  return done ? el("p", { class: "small muted", tabindex: "-1", "data-key": "confirm-number" },
    "Confirmed on this device. Waiting for the other devices.") : null;
};

// The person confirms only after a tick for this number of this wallet: a new number or another
// wallet needs a new tick. The click checks the tick again.
const fullKey = (no) => state.gid + ":" + no;
const FULL_FIRST = "Compare all 30 digits on every device, then tick the box.";
function confirmPart(todo, no) {
  const ticked = ui.safetyFull === fullKey(no), off = offOf({}, "why-match");
  const wait = !off.note && !ticked;
  // A tick of this wallet for another number: the number changed since the tick.
  const moved = typeof ui.safetyFull === "string" && ui.safetyFull.startsWith(state.gid + ":")
    && !ticked;
  const attrs = wait ? { disabled: true, "aria-describedby": "why-match-full" } : off.attrs;
  const confirm = () => {
    if (ui.safetyFull !== fullKey(no)) throw new Error(FULL_FIRST);
    return confirmSeats(todo, no);
  };
  return [el("label", { class: "ack" },
    el("input", { type: "checkbox", id: "safety-full", checked: ticked,
      onchange: (ev) => { ui.safetyFull = ev.target.checked ? fullKey(no) : null; render(); } }),
    el("span", {}, "I compared all 30 digits on every device.")),
  moved ? el("p", { class: "small bad", role: "status" }, "The safety number changed. Compare "
    + "all 30 digits again.") : null,
  el("div", { class: "row-actions" }, el("button", {
    class: "btn primary", type: "button", ...attrs, "data-key": "confirm-number",
    onclick: act(confirm),
  }, "Codes match"), off.note,
  wait ? el("span", { class: "off-why", id: "why-match-full" }, FULL_FIRST) : null)];
}

// "They don't match" asks once more, then stops the setup of every seat of this browser through
// the path of every other stop. The question takes the focus on Keep checking, so a second Enter
// stops nothing.
function mismatchPart() {
  const gid = state.gid;
  const ask = (on) => () => {
    ui.mismatchAsk = on ? gid : null;
    focusAfter(on ? "keep-checking" : "they-differ", true);
    render();
  };
  if (ui.mismatchAsk !== gid) {
    return el("div", { class: "row-actions" }, el("button", { class: "btn", type: "button",
      "data-key": "they-differ", onclick: ask(true) }, "Codes don’t match"));
  }
  return el("div", { class: "callout bad", role: "alert" },
    el("p", {}, "Stop the setup on this device? Then ask the other people to tap \"They don't "
      + "match\" on their own devices too, and create a new wallet."),
    el("div", { class: "row-actions" },
      el("button", { class: "btn danger", type: "button", "data-key": "stop-setup",
        onclick: () => once("stop:" + gid, stopSetup) }, "Stop setup"),
      el("button", { class: "btn", type: "button", "data-key": "keep-checking",
        onclick: ask(false) }, "Keep checking")));
}

const NOT_ZIP2005 = "This wallet is not built to ZIP 2005. Funds cannot be recovered if quantum "
  + "computers break today's keys. Do you want to join with this device?";

// The joiner passed the password already. A chat app browser or a private window can still lose
// the key share, so the card says where to open the link before the seat is taken.
const OPEN_HERE = "Is this page in the browser of a chat app or in a private window? Then open the "
  + "link in Safari or Chrome first. A chat app browser or a private window can delete your key "
  + "share.";
// A wallet with a Solana part has two key ceremonies, one after the other.
const BOTH_OPEN = "Every device keeps this wallet open until the Zcash and the Solana parts are "
  + "ready.";
const bothParts = () => solPlanned() && !solError;
export const joinText = () => solPlanned()
  ? "Zigs is a shared wallet for Zcash testnet and Solana Devnet. The Zcash part is shielded. Any "
    + state.g.t
    + " of the " + state.g.n + " devices approve each payment. Join to add this device to it. "
    + "This device creates its own key shares, one for Zcash and one for Solana. They never leave "
    + "this browser unless you save a backup. " + BOTH_OPEN
  : "Zigs is a shared wallet for shielded Zcash. Any " + state.g.t + " of the " + state.g.n
    + " devices approve each payment. Join to add this device to it. This device creates its own "
    + "key share. It never leaves this browser unless you save a backup. Keep this page open until "
    + "the wallet is ready.";

function joinCard(seat, compact = false) {
  const off = offOf({ pending: state.pending, newSigner: true }, "why-take");
  if (compact && off.note) off.note.className += " sr-only";
  const take = el("button", {
    class: "btn primary lg", type: "button", "data-key": "join-device-" + seat, ...off.attrs,
    onclick: act(() => {
      requireSetupProtection();
      if (!(usesV2(groupVersion()) || confirm(NOT_ZIP2005))) return;
      try { beginGuided(state.gid); } catch (e) { showBanner("bad", e.message); }
      return takeSeat(seat);
    }),
  }, "Join as device " + seat);
  return el("section", { class: "card card-pad hero-card" },
    el("div", { style: "display:grid;gap:4px" }, el("h2", {}, "Join " + state.g.name),
      compact ? null : securityExplanation("connect"),
      compact ? el("p", { class: "small muted" }, "Protect this browser, then join as an independent device. Keep it open through code comparison and key preparation.")
        : el("p", { class: "small muted" }, joinText()),
      el("p", { class: "small muted" }, compact ? "Use a regular browser. Chat-app browsers and private windows may delete your signing share." : OPEN_HERE),
      solPlanned() ? el("p", { class: "small muted" }, SOL_DISCLOSURE) : null),
    nameField("seat-name"),
    deviceProtection("join:" + state.gid,
      () => { focusAfter("join-device-" + seat, true); render(); }),
    compact ? null : el("p", { class: "small muted" }, "A passkey unlocks the encrypted wallet data in this browser. It is not another signer and cannot restore a missing share. Recovery uses this device’s backup file and passphrase."),
    el("div", { style: "display:grid;gap:6px;justify-items:start" }, take, off.note));
}

// The message carries the link, so it is as secret as the link.
export const inviteMessage = (link) => "I made a shared wallet \"" + state.g.name + "\" on Zigs, a "
  + (solPlanned() ? "shared wallet for Zcash testnet and Solana Devnet"
    : "private shared wallet for shielded Zcash")
  + ". It has " + state.g.n + " devices. Any " + state.g.t + " of them must approve each "
  + "payment. Your device will be one of them."
  + "\n\n1. Open this link on your phone or computer: " + link + "\n" + BROWSER_NOTE + "\n2. "
  + PASSWORD_NOTE + "\n3. Protect this browser with a passkey (recommended), or choose Skip for now and confirm the warning. Then tap \"Join as device\".\n4. Keep the page open until the "
  + (solPlanned() ? "Zcash and the Solana parts are" : "wallet is") + " ready.\n\nThis link is a "
  + "secret. Do not post it in a public place. About Zigs: https://zigs.app";

function inviteCard(openCount, guided = false) {
  const link = inviteLink(state.gid), message = inviteMessage(link);
  const share = !guided && navigator.share ? el("button", {
    class: "btn sm", type: "button",
    onclick: () => navigator.share({ title: "Join " + state.g.name + " on Zigs", text: message })
      .catch(() => {}),
  }, "Share") : null;
  const qr = guided ? el("button", { class: "btn", type: "button", "data-key": "setup-show-qr",
    onclick: () => openSetupQr() }, icon("phone"), "Show QR code")
    : secretQr(link, "wallet", true);
  return el("section", { class: "card card-pad hero-card" + (guided ? " guided-invitation" : "") },
    el("div", { class: "card-head" },
      el("h2", {}, guided ? "Private setup invitation" : openCount === 1 ? "Add the other device" : "Add the other devices"),
      el("span", { class: "badge plain" },
        openCount === 1 ? "1 device to join" : openCount + " devices to join")),
    guided ? null : securityExplanation("connect"),
    guided ? el("p", { class: "small muted" }, "Keep this invitation private. Anyone with it can read wallet information, stop setup and join an open slot. Open it on your intended independent device.") : null,
    el(guided ? "details" : "div", { class: "setup-invitation-guidance" },
      guided ? el("summary", {}, "Invitation privacy and browser guidance") : null,
      el("p", { class: "small muted" }, "Send this invite link through a private channel. Open it "
      + "on each device that joins. It holds the wallet secret. Anyone who has it can read the "
      + "wallet, write documents that can stop it, and join as one of the open devices. A backup "
      + "file of a device does not add a new device: it holds the same key share. "
      + senderNote("each person who joins"))),
    guided ? null : qr,
    el("div", { class: "row-actions setup-invite-actions" },
      copyBtn(link, "Copy link", "btn primary", guided ? () => openSetupQr("link") : null),
      copyBtn(message, "Copy invite message", "btn", guided ? () => openSetupQr("message") : null), guided ? qr : null),
    share ? el("div", { class: "row-actions" }, share) : null,
    guided ? null : el("p", { class: "small muted" }, "Share only with your intended independent devices."));
}

// Counts for the three setup steps.
function setupCounts() {
  const n = state.g.n, no = usesV2(groupVersion()) ? safetyNo() : null;
  return {
    n, w: state.wallet, pairs: n * (n - 1),
    r1: Object.keys(state.dkg1).length, r2: Object.keys(state.dkg2).length,
    d: Object.keys(state.done).length, ver: verifiedCount(),
    seated: seatIds().filter((i) => state.seats[i]).length,
    mismatch: keysDiffer(), rejected: rejectedSeats(),
    v2: usesV2(groupVersion()), no, clash: no ? numberClash(no, state.confirm, seatIds()) : [],
    conf: no ? confirmedBy(no).length : 0, stopped: abortedText(),
    aborts: remoteAborts(),
    old: oldSeats(),
  };
}

// Seats whose round-1 document has no commitment: an old app made it.
const HEX64 = /^[0-9a-f]{64}$/;
const oldSeats = () => seatIds().filter((i) => state.dkg1[i] && !HEX64.test(state.dkg1[i].commit));

// The states that stop the key step. The first check that holds decides.
const KEY_BLOCKS = [
  (c) => c.stopped && ["bad", c.stopped],
  (c) => c.aborts.length && ["bad", "Device " + c.aborts[0] + " stopped setup. "
    + state.abort[c.aborts[0]].reason.slice(0, 200)],
  (c) => c.mismatch && ["bad", "The devices made different wallet keys. Do not use this wallet. "
    + "Create a new wallet."],
  (c) => c.v2 && c.old.length && ["bad", "Device " + c.old.join(", ") + " uses an old version of "
    + "Zigs and cannot join this wallet. Update it, or create a new wallet."],
  (c) => c.v2 && allSeated() && !c.no && ["bad", "A device holds a key that this app cannot read. "
    + "Do not use this wallet. Create a new wallet."],
  (c) => c.clash.length && c.d < c.n && ["bad", "Device " + c.clash.join(", ") + " confirmed "
    + "another safety number. Do not continue. Create a new wallet."],
  (c) => c.v2 && allSeated() && c.r1 < c.n && c.conf < c.n && ["", "Starts when every device "
    + "confirmed the safety number (" + c.conf + " of " + c.n + ")."],
];
const keyBlock = (c) => KEY_BLOCKS.map((check) => check(c)).find(Boolean) || null;

function keyStep(c) {
  const blocked = keyBlock(c);
  if (blocked) return blocked;
  if (c.d === c.n) return ["done", "Each device holds one piece. The full key never existed."];
  if (!allSeated()) return ["", "Starts when every device has joined."];
  if (c.r2 === c.pairs) return ["now", "Each device is computing its piece of the key…"];
  if (c.r1 === c.n) {
    return ["now", "Devices are sharing encrypted parts of the key (" + c.r2 + " of " + c.pairs + ")…"];
  }
  return ["now", "Each device is preparing its part of the key (" + c.r1 + " of " + c.n + ")…"];
}

// A stop before the wallet existed leaves no address to build.
const noAddress = (c) => !c.w && (!!c.stopped || c.aborts.length > 0);
function addrStage(c) {
  if (c.rejected.length || noAddress(c)) return "bad";
  if (c.mismatch) return "";
  if (c.w && c.ver === c.n) return "done";
  return c.d === c.n ? "now" : "";
}

// Only the device of seat 1 builds the wallet document. The other seats wait for it (S11).
const buildingText = () => localSeats().includes(1) ? "Building the shared address…"
  : "Device 1 builds the shared address. If this takes more than a minute, open this wallet on "
    + "device 1, or ask the person who has it.";

function addrStep(c) {
  const stage = addrStage(c);
  if (c.rejected.length) {
    const seats = c.rejected.join(", ");
    return [stage, "Device " + seats + " rejected the address. Do not use this wallet."];
  }
  if (!c.w) return [stage, c.stopped || c.aborts.length ? "Stopped: no address."
    : c.d === c.n ? buildingText() : "Comes after the key."];
  if (!c.w.birthday) return [stage, "An older version of Zigs made this wallet. Create a new wallet."];
  const checked = c.ver + " of " + c.n;
  const wait = c.ver < c.n ? " Send funds only after all " + c.n + " checked." : "";
  return [stage, checked + " devices checked the address against their own key share." + wait];
}

function setupStep(cls, no, title, text) {
  return el("div", { class: "step " + cls },
    el("span", { class: "tick" }, cls === "done" ? "✓" : cls === "bad" ? "!" : no),
    el("div", { style: "display:grid;gap:2px" }, el("h3", {}, title), el("p", {}, text)));
}

// The Solana steps of a wallet with the Solana hint, from setupSummary (web/sol/view.js). null
// while the module is not open here: the key ceremony starts after the Zcash address check.
const SOL_KEY = {
  "not started": () => ["", startText()],
  running: (s) => ["now", s.keys + " of " + s.n + " devices hold their Solana key share…"],
  ready: () => ["done", "Each device holds one piece of the Solana key."],
  stopped: () => ["bad", "The Solana setup stopped. The Zcash part still works."],
  differs: () => ["bad", "The devices made different Solana keys. Do not use the Solana part."],
  unavailable: () => ["bad", "This wallet cannot get a Solana part."],
};
// Only seat 1 with the choice in its own secret starts by itself (planSolana). Seat 1 without it
// (a restore, or a hint that someone else wrote) starts with Add Solana.
function startText() {
  if (!localSeats().includes(1)) return "Device 1 starts it after the Zcash address check.";
  if (sec(state.gid, 1)?.solAuto === true && !state.g.movedTo) {
    return "Starts when the Zcash address is checked.";
  }
  return "Tap Add Solana in the Solana section to start it.";
}
// The texts of app-sol.js that start with "Solana" say what failed already.
const loadText = (e) => e.startsWith("Solana") ? e : "Solana did not load: " + e;
const solKeyStep = (s) => s ? SOL_KEY[s.status](s)
  : solError ? ["bad", loadText(solError)]
  : ["", "Starts after the Zcash part."];

/** Solana formation only. Fee funding belongs to the first paid operation, not onboarding. */
export function solSteps(first) {
  const s = solSetup(), [keyStage, keyText] = solKeyStep(s);
  return [setupStep(keyStage, first, "Create the Solana key", keyText)];
}

// The Solana section exists here: a seat of this browser, and a module that loaded.
const solCardHere = () => solPlanned() && solOn() && localSeats().length > 0 && !solError;

/** True while the requested Solana ceremony is incomplete or stopped. */
export function solUnfinished() {
  if (!solCardHere()) return false;
  const s = solSetup();
  if (!s) return false;   // the module still loads: no Solana state to show yet
  return s.status !== "ready";
}

const newWalletButton = () => el("button", { class: "btn sm", type: "button",
  onclick: newWallet }, "Create a new wallet");

/** The Overview card of a wallet whose Solana part is still setting up, or stopped. */
export function solSetupCard() {
  const stopped = solSetup()?.status === "stopped";
  const toTab = el("button", { class: "btn sm", type: "button",
    onclick: () => { ui.tab = "solana"; render(); } }, "Open Solana");
  return el("section", { class: "card card-pad" },
    el("div", { class: "card-head" },
      el("h3", {}, stopped ? "The Solana part stopped" : "Solana is still setting up")),
    el("div", { class: "steps" }, ...solSteps(1)),
    el("p", { class: "small muted" }, stopped ? SOL_STOP_NEXT
      : BOTH_OPEN),
    el("div", { class: "row-actions" }, toTab, stopped ? newWalletButton() : null));
}
const SOL_STOP_NEXT = "The Zcash part of this wallet still works. To use Solana, create a new "
  + "wallet.";

// The state of the link to the group server (web/shim.js, app-engine.js shows it under the engine
// line). The setup card shows it while the link is not open (S1). A change of the wait does not
// redraw the page: only a new state or a new HTTP code does.
let linkNow = null;
export function onLink(s) {
  const same = linkNow?.state === s.state && linkNow?.code === s.code;
  linkNow = s;
  if (!same) render();
}
if (typeof zigs !== "undefined") zigs.use("link").then((link) => link?.watch(onLink));
function linkLine() {
  const v = linkNow ? linkView(linkNow, Date.now()) : { show: false };
  return v.show ? el("p", { class: "small " + (v.dot === "bad" ? "bad" : "muted"), role: "status" },
    v.text) : null;
}

function progressCard() {
  const c = setupCounts();
  const [keyStage, keyText] = keyStep(c), [addrStage, addrText] = addrStep(c);
  return el("section", { class: "card card-pad" },
    el("div", { class: "card-head" }, el("h2", {}, "Setting up your wallet"),
      el("span", { class: "badge plain" }, "Zcash · " + c.n + " devices")),
    linkLine(),
    el("div", { class: "steps", style: "margin-top:6px" },
      setupStep(allSeated() ? "done" : "now", 1, "Devices join",
        c.seated + " of " + c.n + " devices joined."),
      setupStep(keyStage, 2, "Create the key together", keyText),
      setupStep(addrStage, 3, "Check the address", addrText),
      ...(solPlanned() ? solSteps(4) : [])),
    addrStage === "done" ? null : el("p", { class: "small muted" }, bothParts() ? BOTH_OPEN
      : "Every device must keep Zigs open until setup finishes."),
    activityLog());
}

function demoDevices(open) {
  const off = offOf({ pending: state.pending, newSigner: true }, "why-play");
  return localSeats().length && open.length
    ? el("details", { class: "testing" }, el("summary", {}, "Trying Zigs alone? Play the other devices in this browser"),
      el("p", { class: "small faint" }, "For a demo or a review only. In real use, each key share sits on its own device."),
      deviceProtection("demo:" + state.gid),
      el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, open.map((i) => el("button", {
        class: "btn sm", type: "button", ...off.attrs,
        onclick: act(() => { requireSetupProtection(); return takeSeat(i); }),
      }, "Play device " + i)), off.note))
    : null;
}

function seatsCard(open) {
  const testing = demoDevices(open);
  return el("section", { class: "card card-pad" },
    el("div", { class: "card-head" }, el("h2", {}, "Devices"), el("span", { class: "small muted" }, "Any " + state.g.t + " of " + state.g.n + " devices")),
    el("div", { class: "seat-grid" }, seatIds().map((i) => guard(seatTile, i))),
    testing);
}

// Is seat i held by this browser, or by the same person in another browser?
function seatOwner(i) {
  const taken = !!state.seats[i] && seatMine(i), here = !!sec(state.gid, i);
  return { mine: taken && here, elsewhere: taken && !here && !signedMode(state.gid) };
}

function seatTile(i) {
  const s = state.seats[i], { mine, elsewhere } = seatOwner(i);
  const st = seatStage(i);
  return el("div", { class: "seat" + (mine ? " mine" : "") + (s ? "" : " open") },
    el("div", { style: "display:flex;align-items:center;gap:10px;min-width:0" }, avatar(i),
      el("div", { style: "display:grid;min-width:0" },
        el("span", { class: "ri-title nowrap" }, seatLabel(i)),
        // A device with no name reads "Device N" in its title already.
        seatLabel(i) === "Device " + i ? null : el("span", { class: "ri-sub" }, "Device " + i))),
    el("span", { class: "badge " + (st === 5 ? "ok" : s ? "info" : "plain") }, STAGE_LABEL[st]),
    elsewhere ? el("span", { class: "small faint" }, "Yours, in another browser") : null);
}
