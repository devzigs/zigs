// The Help part of Settings: answers that work offline, and diagnostics that the person copies.
// Nothing here asks for the network or sends anything.
import { seatBackedUp } from "./util.js";
import { state } from "./app-state.js";
import { Z } from "./app-engine.js";
import { sec } from "./app-keystore.js";
import { localSeats, seatIds } from "./app-seats.js";
import { curChain, netName, readsMemos } from "./app-chain.js";
import { toApprove } from "./app-groups.js";
import { groupVersion, verifiedCount } from "./app-dkg.js";
import {
  sol, solError, solFile, solNotAdded, solOn, solPending, solSetup, solUnsaved,
} from "./app-sol.js";
import { copyBtn, el } from "./app-dom.js";
import { HELP, diagnosticsText } from "./help-model.js";
import { securityExplanation } from "./app-tutorial.js";
import { settingsDisclosure, settingsGroup } from "./app-settings-ui.js";

const DIAGNOSTICS_NOTE = "These lines are a fixed list of facts about this app in this browser. "
  + "They hold no key, no secret, no invite link, no address, no name, no amount and no message. "
  + "Zigs sends nothing: copy the text and send it yourself if you want help.";

const syncWord = (c) => !c ? "not started" : c.error ? "failed" : c.syncing ? "syncing"
  : c.bal ? "synced to block " + c.bal.height : "waiting";

function browserFacts() {
  return [["Time (UTC)", new Date().toISOString()], ["Browser", navigator.userAgent],
    ["Online", navigator.onLine !== false], ["WebAssembly engine", Z ? "ready" : "not ready"],
    ["Web Locks", !!navigator.locks?.request]];
}

// Zigs counts nothing of the Solana part until it has read it: a count then would say 0. Recovery
// tells a read that is still going from one that failed, and so do these lines.
const solUnread = () => solOn() && (!sol || localSeats().some((i) => solFile(i)?.unknown));
const solUnreadWord = () => (solError ? "could not read" : "not read yet");
const solCount = (count) => (solUnread() ? solUnreadWord() : count());
// The state of the Solana part. A wallet that cannot get one is "unavailable"; a part that is not
// read yet has no state.
const SOL_PART = { "not started": "not added", running: "setting up", ready: "ready",
  stopped: "stopped", differs: "keys differ", unavailable: "unavailable" };
function solStatus() {
  if (!solOn()) return "unavailable";
  return solNotAdded() ? "not started" : solSetup()?.status;
}
// The Solana counts show for a part that exists, and for one that is not read yet.
const solFacts = (facts) => (["not started", "unavailable"].includes(solStatus()) ? [] : facts);

function deviceFacts() {
  const here = localSeats();
  const unsaved = here.filter((i) => {
    const s = sec(state.gid, i);
    return s.keyPackage && !seatBackedUp(s);
  });
  return [["Approval rule", state.g.t + " of " + state.g.n + " devices"],
    ["Devices joined", seatIds().filter((i) => state.seats[i]).length],
    ["Devices in this browser", here.length],
    ["Devices that checked the address", verifiedCount()],
    ["Zcash backup files not saved", unsaved.length],
    ...solFacts([["Solana backup files not saved", solCount(() => solUnsaved().length)]])];
}

function stateFacts() {
  return [["Network", netName(state.g)], ["Wallet version", groupVersion()],
    ["Zcash sync", syncWord(curChain())],
    ["Solana part", SOL_PART[solStatus()] ?? solUnreadWord()],
    ["Zcash payments to approve", toApprove(state.gid).length],
    ...solFacts([["Solana payments to approve", solCount(solPending)]]),
    ["Memo reading", readsMemos(state.gid) ? "on" : "off"]];
}

/** The diagnostics text of the open wallet and this browser. */
export const diagnostics = () =>
  diagnosticsText([...browserFacts(), ...stateFacts(), ...deviceFacts()]);

export function helpView(setupRow = null) {
  return settingsGroup("Help & Support", setupRow,
    settingsDisclosure("Guides & frequently asked questions", "Payments, backups, privacy and troubleshooting. Available offline.",
      securityExplanation("help"),
      el("div", { class: "preferences-faq" }, HELP.map(([question, answer]) =>
        el("section", {}, el("h4", {}, question), el("p", { class: "small" }, answer))))),
    settingsDisclosure("Diagnostics", "Inspect and copy a fixed set of app facts. Nothing is uploaded.",
      state.g ? [
        el("p", { class: "small muted" }, DIAGNOSTICS_NOTE),
        el("div", { class: "log", tabindex: "0", role: "region", "aria-label": "Diagnostics text",
          "data-key": "diagnostics" }, diagnostics()),
        el("div", {}, copyBtn(diagnostics, "Copy diagnostics"))]
        : el("p", { class: "small muted" }, "Open a wallet to view its diagnostics.")));
}
