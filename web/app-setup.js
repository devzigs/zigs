// The setup page: join, invite, safety and progress.
import { numberClash, usesV2 } from "./util.js";
import { state } from "./app-state.js";
import { Z } from "./app-engine.js";
import { sec } from "./app-keystore.js";
import {
  allDone, allSeated, keysDiffer, localSeats, seatIds, seatMine, seatStage, STAGE_LABEL,
} from "./app-seats.js";
import { inviteLink } from "./app-links.js";
import { signedMode } from "./app-filter.js";
import { canWrite } from "./app-groups.js";
import { act, avatar, copyBtn, el, guard, nameField, seatLabel, secretQr } from "./app-dom.js";
import {
  abortedText, confirmedBy, confirmSeats, confirmSeatsOf, groupVersion, holdsAllSeats,
  rejectedSeats, remoteAborts, safetyNo, SAVE_FAILED, saveFailed, takeSeat, verifiedCount,
} from "./app-dkg.js";
import { messagesCard } from "./app-thread.js";
import { react, render } from "./app-loop.js";
import { activityLog } from "./app-wallet.js";
import { SOL_DISCLOSURE, solPlanned } from "./app-sol.js";

export function setupView() {
  const open = seatIds().filter((i) => !state.seats[i]);
  const top = !localSeats().length && open.length ? joinCard(open[0])
    : open.length ? inviteCard(open.length) : null;
  const split = keysDiffer() ? el("div", { class: "callout bad", role: "alert" },
    "The signers made different wallet keys, so this wallet is not safe to use. "
    + "Do not send funds to it. Create a new wallet.") : null;
  const stopped = abortedText();
  return el("div", { class: "page", style: "gap:16px" }, split,
    stopped ? el("div", { class: "callout bad", role: "alert" }, stopped) : null,
    saveFailedCard(), top, safetyCard(),
    el("div", { class: "setup" }, progressCard(), seatsCard(open)),
    localSeats().length ? messagesCard() : null);
}

// Version 2 wallets: the signers compare one number before the key ceremony starts. It stays
// visible until every seat holds its key share.
const safetyOpen = () => usesV2(groupVersion()) && allSeated() && !allDone() && !holdsAllSeats();

// The person fixes the cause, then tries again. The reactor does not retry a failed save.
function saveFailedCard() {
  if (![...saveFailed].some((k) => k.startsWith(state.gid + ":"))) return null;
  const again = () => { saveFailed.clear(); render(); react(); };
  return el("div", { class: "callout bad", role: "alert" },
    el("span", { style: "flex:1 1 16rem" }, SAVE_FAILED),
    el("button", { class: "btn sm", type: "button", onclick: again }, "Try again"));
}

function safetyCard() {
  if (!safetyOpen() || abortedText()) return null;
  const no = safetyNo(), n = state.g.n;
  if (!no) {
    return el("div", { class: "callout bad", role: "alert" },
      "A seat holds a key that this app cannot read. Do not use this wallet. Create a new wallet.");
  }
  const yes = confirmedBy(no).length, clash = numberClash(no, state.confirm, seatIds());
  const todo = confirmSeatsOf().filter((i) => sec(state.gid, i).confirmed !== no);
  return el("section", { class: "card card-pad hero-card" },
    el("div", { class: "card-head" }, el("h2", {}, "Check the safety number"),
      el("span", { class: "badge " + (yes === n ? "ok" : "warn") }, yes + " of " + n + " confirmed")),
    el("div", { class: "safety" }, no),
    el("p", { class: "small muted" }, "Compare this number with every signer, on a call or in "
      + "person. If it is different, someone else took a seat. In that case, do not tap "
      + "\"It matches\". Create a new wallet." + (solPlanned() ? " " + BOTH_OPEN : "")),
    clash.length ? el("div", { class: "callout bad", role: "alert" }, "Seat " + clash.join(", ")
      + " confirmed another number. Someone else may have taken a seat. Do not continue. "
      + "Create a new wallet.") : null,
    todo.length ? confirmButton(todo, no) : null);
}

const confirmButton = (todo, no) => el("div", {}, el("button", {
  class: "btn primary", type: "button", disabled: !Z || canWrite === false,
  onclick: act(() => confirmSeats(todo, no)),
}, "It matches"));

const NOT_ZIP2005 = "This wallet is not built to ZIP 2005. Funds cannot be recovered if quantum "
  + "computers break today's keys. Do you want to take a seat?";

// A wallet with a Solana part has two key ceremonies, one after the other.
const BOTH_OPEN = "Every signer keeps this wallet open until the Zcash and the Solana parts are "
  + "ready.";
export const joinText = () => solPlanned()
  ? "Zigs is a shared wallet for shielded Zcash testnet and for Solana Devnet. Any " + state.g.t
    + " of the " + state.g.n + " signers approve each payment. Take a seat to become a signer. "
    + "Your device creates its own key shares, one for Zcash and one for Solana. They never leave "
    + "this browser unless you save a backup. " + BOTH_OPEN
  : "Zigs is a shared wallet for shielded Zcash. Any " + state.g.t + " of the " + state.g.n
    + " signers approve each payment. Take a seat to become a signer. Your device creates its own "
    + "key share. It never leaves this browser unless you save a backup. Keep this page open until "
    + "the wallet is ready.";

function joinCard(seat) {
  const take = el("button", {
    class: "btn primary lg", type: "button", disabled: !Z || canWrite === false || state.pending,
    onclick: act(() => (usesV2(groupVersion()) || confirm(NOT_ZIP2005)) && takeSeat(seat)),
  }, "Take seat " + seat);
  return el("section", { class: "card card-pad hero-card" },
    el("div", { style: "display:grid;gap:4px" }, el("h2", {}, "Join " + state.g.name),
      el("p", { class: "small muted" }, joinText()),
      solPlanned() ? el("p", { class: "small muted" }, SOL_DISCLOSURE) : null),
    nameField("seat-name"),
    el("div", {}, take));
}

// The message carries the link, so it is as secret as the link.
export const inviteMessage = (link) => "I made a shared wallet \"" + state.g.name + "\" on Zigs, a "
  + "private shared wallet for shielded Zcash" + (solPlanned() ? " testnet and Solana Devnet" : "")
  + ". You are one of " + state.g.n + " signers, and " + state.g.t + " must approve each payment."
  + "\n\n1. Open this link on your phone or computer: " + link + "\n2. Take a seat.\n3. Keep the "
  + "page open until the " + (solPlanned() ? "Zcash and the Solana parts are" : "wallet is")
  + " ready.\n\nThis link is a secret. Do not post it in a public place. About Zigs: "
  + "https://zigs.app";

function inviteCard(openCount) {
  const link = inviteLink(state.gid), message = inviteMessage(link);
  const share = navigator.share ? el("button", {
    class: "btn sm", type: "button",
    onclick: () => navigator.share({ title: "Join " + state.g.name + " on Zigs", text: message })
      .catch(() => {}),
  }, "Share") : null;
  return el("section", { class: "card card-pad hero-card" },
    el("div", { class: "card-head" }, el("h2", {}, "Invite your signers"),
      el("span", { class: "badge plain" },
        openCount === 1 ? "1 seat open" : openCount + " seats open")),
    el("p", { class: "small muted" }, "Send this invite link to each signer through a private "
      + "channel. It contains the wallet secret: anyone who has it can take an open seat."),
    el("div", { class: "addr-box" }, el("span", { class: "hex nowrap" }, link),
      copyBtn(link, "Copy link", "btn sm primary"), copyBtn(message, "Copy invite message", "btn sm"),
      share),
    secretQr(link));
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
  (c) => c.aborts.length && ["bad", "Seat " + c.aborts[0] + " stopped setup. "
    + state.abort[c.aborts[0]].reason.slice(0, 200)],
  (c) => c.mismatch && ["bad", "The signers made different wallet keys. Do not use this wallet. "
    + "Create a new wallet."],
  (c) => c.v2 && c.old.length && ["bad", "Seat " + c.old.join(", ") + " uses an old version of "
    + "Zigs and cannot join this wallet. Update it, or create a new wallet."],
  (c) => c.v2 && allSeated() && !c.no && ["bad", "A seat holds a key that this app cannot read. "
    + "Do not use this wallet. Create a new wallet."],
  (c) => c.clash.length && c.d < c.n && ["bad", "Seat " + c.clash.join(", ") + " confirmed "
    + "another safety number. Do not continue. Create a new wallet."],
  (c) => c.v2 && allSeated() && c.r1 < c.n && c.conf < c.n && ["", "Starts when every signer "
    + "confirmed the safety number (" + c.conf + " of " + c.n + ")."],
];
const keyBlock = (c) => KEY_BLOCKS.map((check) => check(c)).find(Boolean) || null;

function keyStep(c) {
  const blocked = keyBlock(c);
  if (blocked) return blocked;
  if (c.d === c.n) return ["done", "Each signer holds one piece. The full key never existed."];
  if (!allSeated()) return ["", "Starts when every seat is taken."];
  if (c.r2 === c.pairs) return ["now", "Each device is computing its piece of the key…"];
  if (c.r1 === c.n) {
    return ["now", "Devices are sharing encrypted parts of the key (" + c.r2 + " of " + c.pairs + ")…"];
  }
  return ["now", "Each device is preparing its part of the key (" + c.r1 + " of " + c.n + ")…"];
}

function addrStage(c) {
  if (c.rejected.length) return "bad";
  if (c.mismatch) return "";
  if (c.w && c.ver === c.n) return "done";
  return c.d === c.n ? "now" : "";
}

function addrStep(c) {
  const stage = addrStage(c);
  if (c.rejected.length) {
    const seats = c.rejected.join(", ");
    return [stage, "Seat " + seats + " rejected the address. Do not use this wallet."];
  }
  if (!c.w) return [stage, c.d === c.n ? "Building the shared address…" : "Comes after the key."];
  if (!c.w.birthday) return [stage, "An older version of Zigs made this wallet. Create a new wallet."];
  const checked = c.ver + " of " + c.n;
  const wait = c.ver < c.n ? " Send funds only after all " + c.n + " checked." : "";
  return [stage, checked + " signers checked the address against their own key share." + wait];
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

function progressCard() {
  const c = setupCounts(), pct = setupProgress(c);
  const [keyStage, keyText] = keyStep(c), [addrStage, addrText] = addrStep(c);
  return el("section", { class: "card card-pad" },
    el("div", { class: "card-head" }, el("h2", {}, "Setting up your wallet"),
      el("span", { class: "mono faint" }, pct + "%")),
    el("div", { class: "progress" }, el("i", { style: "width:" + pct + "%" })),
    el("div", { class: "steps", style: "margin-top:6px" },
      setupStep(allSeated() ? "done" : "now", 1, "Signers join",
        c.seated + " of " + c.n + " seats taken."),
      setupStep(keyStage, 2, "Create the key together", keyText),
      setupStep(addrStage, 3, "Check the address", addrText)),
    addrStage === "done" ? null : el("p", { class: "small muted" }, solPlanned() ? BOTH_OPEN
      : "Every signer must keep Zigs open until setup finishes."),
    activityLog());
}

function seatsCard(open) {
  const testing = localSeats().length && open.length
    ? el("details", { class: "testing" }, el("summary", {}, "Trying Zigs alone? Play the other seats in this browser"),
      el("p", { class: "small faint" }, "For a demo or a review only. In real use, each signer takes a seat on their own device."),
      el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, open.map((i) => el("button", {
        class: "btn sm", type: "button", disabled: !Z || canWrite === false || state.pending,
        onclick: act(() => takeSeat(i)),
      }, "Play seat " + i))))
    : null;
  return el("section", { class: "card card-pad" },
    el("div", { class: "card-head" }, el("h2", {}, "Seats"), el("span", { class: "small muted" }, state.g.t + " of " + state.g.n + " signers must approve")),
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
      el("div", { style: "display:grid;min-width:0" }, el("span", { class: "ri-title nowrap" }, seatLabel(i)), el("span", { class: "ri-sub" }, "Seat " + i))),
    el("span", { class: "badge " + (st === 5 ? "ok" : s ? "info" : "plain") }, STAGE_LABEL[st]),
    elsewhere ? el("span", { class: "small faint" }, "Yours, in another browser") : null);
}
