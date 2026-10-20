// The setup page: join, invite, safety and progress.
import { numberClash, usesV2 } from "./util.js";
import { state, ui } from "./app-state.js";
import { linkView } from "./app-engine.js";
import { mySeatSecrets, sec } from "./app-keystore.js";
import {
  allDone, allSeated, keysDiffer, localSeats, seatIds, seatMine, seatStage, STAGE_LABEL,
} from "./app-seats.js";
import { BROWSER_NOTE, inviteLink, PASSWORD_NOTE, senderNote } from "./app-links.js";
import { signedMode } from "./app-filter.js";
import { act, avatar, copyBtn, el, guard, nameField, seatLabel, secretQr } from "./app-dom.js";
import {
  abortedText, confirmedBy, confirmSeats, confirmSeatsOf, groupVersion, holdsAllSeats,
  rejectedSeats, remoteAborts, safetyNo, SAVE_FAILED, saveFailed, stopSetup, takeSeat,
  verifiedCount,
} from "./app-dkg.js";
import { messagesCard } from "./app-thread.js";
import { focusAfter, once, react, render } from "./app-loop.js";
import { activityLog } from "./app-wallet.js";
import { offOf } from "./app-shell.js";
import { newWallet, SOL_DISCLOSURE, solError, solOn, solPlanned, solSetup } from "./app-sol.js";
import { quickCode, SETUP_STAGES, setupStage } from "./setup-model.js";

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
    saveFailedCard(), top, safetyCard(),
    el("div", { class: "setup" }, progressCard(), seatsCard(open)),
    localSeats().length ? messagesCard() : null);
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

function safetyCard() {
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
    el("p", { class: "small" }, "Compare this safety number on every device, on a call or in "
      + "person. If every device shows it, only your devices joined this wallet."),
    el("div", { class: "safety" }, no),
    ...safetyHelp(no, seated),
    clash.length ? el("div", { class: "callout bad", role: "alert" }, "Device " + clash.join(", ")
      + " confirmed another number. Someone else may have joined. Do not continue. "
      + "Create a new wallet.") : null,
    ...(seated ? safetyActions(no) : []));
}
// The quick code is an aid only. A browser without a seat is not told to tap a button.
function safetyHelp(no, seated) {
  const quick = quickCode(no);
  return [quick ? el("p", { class: "small muted" }, "The first digits, " + quick + ", help you "
    + "find the number. They are not enough: compare all 30 digits.") : null,
  el("p", { class: "small muted" }, "If one device shows a different number, someone else may "
    + "have joined." + (seated ? " Then tap \"They don't match\"." : "")
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
  }, "It matches"), off.note,
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
      "data-key": "they-differ", onclick: ask(true) }, "They don't match"));
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

function joinCard(seat) {
  const off = offOf({ pending: state.pending }, "why-take");
  const take = el("button", {
    class: "btn primary lg", type: "button", ...off.attrs,
    onclick: act(() => (usesV2(groupVersion()) || confirm(NOT_ZIP2005)) && takeSeat(seat)),
  }, "Join as device " + seat);
  return el("section", { class: "card card-pad hero-card" },
    el("div", { style: "display:grid;gap:4px" }, el("h2", {}, "Join " + state.g.name),
      el("p", { class: "small muted" }, joinText()),
      el("p", { class: "small muted" }, OPEN_HERE),
      solPlanned() ? el("p", { class: "small muted" }, SOL_DISCLOSURE) : null),
    nameField("seat-name"),
    el("div", { style: "display:grid;gap:6px;justify-items:start" }, take, off.note));
}

// The message carries the link, so it is as secret as the link.
export const inviteMessage = (link) => "I made a shared wallet \"" + state.g.name + "\" on Zigs, a "
  + (solPlanned() ? "shared wallet for Zcash testnet and Solana Devnet"
    : "private shared wallet for shielded Zcash")
  + ". It has " + state.g.n + " devices. Any " + state.g.t + " of them must approve each "
  + "payment. Your device will be one of them."
  + "\n\n1. Open this link on your phone or computer: " + link + "\n" + BROWSER_NOTE + "\n2. "
  + PASSWORD_NOTE + "\n3. Tap \"Join as device\".\n4. Keep the page open until the "
  + (solPlanned() ? "Zcash and the Solana parts are" : "wallet is") + " ready.\n\nThis link is a "
  + "secret. Do not post it in a public place. About Zigs: https://zigs.app";

function inviteCard(openCount) {
  const link = inviteLink(state.gid), message = inviteMessage(link);
  const share = navigator.share ? el("button", {
    class: "btn sm", type: "button",
    onclick: () => navigator.share({ title: "Join " + state.g.name + " on Zigs", text: message })
      .catch(() => {}),
  }, "Share") : null;
  return el("section", { class: "card card-pad hero-card" },
    el("div", { class: "card-head" }, el("h2", {}, "Add the other devices"),
      el("span", { class: "badge plain" },
        openCount === 1 ? "1 device to join" : openCount + " devices to join")),
    el("p", { class: "small muted" }, "Send this invite link through a private channel. Open it "
      + "on each device that joins. It holds the wallet secret: anyone who has it can join as one "
      + "of the open devices. " + senderNote("each person who joins")),
    el("div", { class: "row-actions" }, copyBtn(link, "Copy link", "btn sm primary"),
      copyBtn(message, "Copy invite message", "btn sm"), share),
    secretQr(link, "wallet", true));
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

// One third each for seats, key ceremony and address checks.
function setupProgress(c) {
  const key = c.d === c.n ? 1 : (c.r1 / c.n + c.r2 / Math.max(1, c.pairs)) / 2;
  return Math.round((c.seated / c.n + key + (c.w ? c.ver / c.n : 0)) / 3 * 100);
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

const funded = (f) => !!f.balance && f.balance !== "0 SOL";
function solFeeStep(s) {
  if (!s || s.status !== "ready") return ["", "Comes after the Solana key."];
  if (!s.fees.length) return ["", "Each device funds its own fee address."];
  if (s.fees.every(funded)) return ["done", "Your fee address holds " + s.fees[0].balance + "."];
  return ["now", "Send Devnet SOL to your fee address in the Solana section, then check its "
    + "balance."];
}

/** Steps 4 and 5 of a wallet with the Solana hint: the Solana key, then the fee address. */
export function solSteps(first) {
  const s = solSetup(), [keyStage, keyText] = solKeyStep(s), [feeStage, feeText] = solFeeStep(s);
  return [setupStep(keyStage, first, "Create the Solana key", keyText),
    setupStep(feeStage, first + 1, "Fund your fee address", feeText)];
}

// An Overview that showed the key ceremony run keeps the fee step until the fee addresses hold
// SOL. After a reload the balances are unknown until Check balance, so a funded part shows no card.
const sawSetup = new Set();
// The Solana section exists here: a seat of this browser, and a module that loaded.
const solCardHere = () => solPlanned() && solOn() && localSeats().length > 0 && !solError;

/** True while the Solana part of a wallet with the hint is not ready, not funded, or stopped. */
export function solUnfinished() {
  if (!solCardHere()) return false;
  const s = solSetup();
  if (!s) return false;   // the module still loads: no Solana state to show yet
  if (s.status === "running") sawSetup.add(state.gid);
  if (s.status !== "ready") return true;
  if (solFeeStep(s)[0] === "done") return false;
  return sawSetup.has(state.gid) || s.fees.some((f) => f.balance === "0 SOL");
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
      : solSetup()?.status === "ready" ? FUND_TEXT : BOTH_OPEN),
    el("div", { class: "row-actions" }, toTab, stopped ? newWalletButton() : null));
}
const SOL_STOP_NEXT = "The Zcash part of this wallet still works. To use Solana, create a new "
  + "wallet.";
const FUND_TEXT = "Each device funds its own fee address.";

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
  const c = setupCounts(), pct = setupProgress(c);
  const [keyStage, keyText] = keyStep(c), [addrStage, addrText] = addrStep(c);
  return el("section", { class: "card card-pad" },
    el("div", { class: "card-head" }, el("h2", {}, "Setting up your wallet"),
      el("span", { class: "mono faint" }, pct + "%")),
    el("div", { class: "progress" }, el("i", { style: "width:" + pct + "%" })),
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

function seatsCard(open) {
  const off = offOf({ pending: state.pending }, "why-play");
  const testing = localSeats().length && open.length
    ? el("details", { class: "testing" }, el("summary", {}, "Trying Zigs alone? Play the other devices in this browser"),
      el("p", { class: "small faint" }, "For a demo or a review only. In real use, each key share sits on its own device."),
      el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, open.map((i) => el("button", {
        class: "btn sm", type: "button", ...off.attrs, onclick: act(() => takeSeat(i)),
      }, "Play device " + i)), off.note))
    : null;
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
