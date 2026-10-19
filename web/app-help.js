// The Help part of Settings: answers that work offline, and diagnostics that the person copies.
// Nothing here asks for the network or sends anything.
import { seatBackedUp } from "./util.js";
import { state } from "./app-state.js";
import { Z } from "./app-engine.js";
import { sec } from "./app-keystore.js";
import { localSeats, seatIds } from "./app-seats.js";
import { curChain, netName, readsMemos } from "./app-chain.js";
import { toApprove } from "./app-groups.js";
import { groupVersion, rejectedSeats, verifiedCount } from "./app-dkg.js";
import { solOn, solPending, solUnsaved } from "./app-sol.js";
import { copyBtn, el } from "./app-dom.js";
import { HELP, diagnosticsText } from "./help-model.js";

const DIAGNOSTICS_NOTE = "These lines show the state of this app in this browser. They hold no "
  + "key, no secret, no invite link and no full address. Zigs sends nothing: copy the text and "
  + "send it yourself if you want help.";

const syncWord = (c) => !c ? "not started" : c.error ? "failed" : c.syncing ? "syncing"
  : c.bal ? "synced to block " + c.bal.height : "waiting";

function browserFacts() {
  return [["Time (UTC)", new Date().toISOString()], ["Browser", navigator.userAgent],
    ["Online", navigator.onLine !== false], ["WebAssembly engine", Z ? "ready" : "not ready"],
    ["Web Locks", !!navigator.locks?.request]];
}

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
    ["Devices that rejected the wallet", rejectedSeats().length],
    ["Zcash backup files not saved", unsaved.length],
    ["Solana backup files not saved", solUnsaved().length]];
}

function stateFacts() {
  return [["Network", netName(state.g)], ["Wallet version", groupVersion()],
    ["Zcash sync", syncWord(curChain())], ["Solana part", solOn() ? "on" : "off"],
    ["Zcash payments to approve", toApprove(state.gid).length],
    ["Solana payments to approve", solPending()],
    ["Memo reading", readsMemos(state.gid) ? "on" : "off"]];
}

/** The diagnostics text of the open wallet and this browser. */
export const diagnostics = () =>
  diagnosticsText([...browserFacts(), ...stateFacts(), ...deviceFacts()], state.log);

export function helpView() {
  return el("section", { class: "card card-pad settings-section" },
    el("h3", {}, "Help"),
    el("p", { class: "small muted" }, "These answers work offline. They ask for no network."),
    el("div", { class: "faq" },
      HELP.map(([question, answer]) =>
        el("details", {}, el("summary", {}, question), el("p", { class: "small" }, answer))),
      el("details", {}, el("summary", {}, "Diagnostics"),
        el("p", { class: "small muted" }, DIAGNOSTICS_NOTE),
        el("div", { class: "log", tabindex: "0", role: "region", "aria-label": "Diagnostics text" },
          diagnostics()),
        el("div", {}, copyBtn(diagnostics, "Copy diagnostics")))));
}
