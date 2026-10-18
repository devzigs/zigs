// Solana host glue: solHost() and the lazy load of web/sol.
import { walletVersion } from "./util.js";
import { docFields } from "./signed.js";
import { log, showBanner, state, ui } from "./app-state.js";
import { said } from "./app-kit.js";
import { Z } from "./app-engine.js";
import { putSec, sec } from "./app-keystore.js";
import { localSeats, seatIds } from "./app-seats.js";
import { netName } from "./app-chain.js";
import {
  canWriteAs, checkIn, netConfirmed, refilter, signedDoc, signedMode,
} from "./app-filter.js";
import { openGroup, sdb, unsubGroup } from "./app-groups.js";
import { act, el, guard } from "./app-dom.js";
import { confirmedNo, groupVersion, safetyNo, seatCheck } from "./app-dkg.js";
import { restore, sealAndSave } from "./app-backups.js";
import { once, react, render } from "./app-loop.js";

// Devnet, for version 3 wallets on testnet only. The network must be the one that the people of
// the wallet confirmed with the safety number (netConfirmed, SOL-34), not only the first one that
// this device saw. web/sol loads when the Solana tab opens, or when a seat signed the wallet's
// solstart document. Any other wallet, and a wallet that is not loaded yet, never fetches any of
// it.
const solGroup = (gid) =>
  (gid === state.gid && state.g) || state.groups.find((x) => x.id === gid);
export const solOn = (gid = state.gid) => {
  const g = solGroup(gid);
  const testnet = g?.network === "testnet" && netConfirmed(gid) === "testnet";
  return testnet && walletVersion(g) === 3 && signedMode(gid);
};
// The group document asks for a Solana part (createGroup). It is a hint only: any holder of the
// link can write it, so it changes the texts and the preload, and it never starts the ceremony.
export const solPlanned = (g = state.g) =>
  g?.solana === true && (g.network || "testnet") === "testnet" && walletVersion(g) === 3;
// Does this server serve Solana? undefined: not asked yet, null: asked, then true or false. The
// create dialog offers the Solana part only on a server that answers.
export function solServed() {
  if (ui.solServed === undefined) {
    ui.solServed = null;
    globalThis.fetch("/sol/config.json", { cache: "no-store" }).then((r) => {
      ui.solServed = r.ok;
      r.body?.cancel();
    }, () => { ui.solServed = false; }).finally(render);
  }
  return ui.solServed === true;
}
// The person who makes a wallet chose its Solana part. Seat 1 of this browser keeps `solAuto`, so
// its reactor starts the Solana ceremony with no button (web/sol/ceremony.js). The group document
// gets the hint for the other seats.
export async function planSolana() {
  const gid = state.gid;
  if (!sec(gid, 1)) return;
  await putSec(gid, 1, { solAuto: true });
  await sdb.doc("groups/" + gid).update({ solana: true });
}
// What a person accepts with the Solana part (the Add Solana card of web/sol/view.js says more).
export const SOL_DISCLOSURE = "Solana Devnet: a program owns the funds of the group at a public "
  + "program address. Each seat gets a fee address, which appears on chain next to the group. "
  + "Helius sees that you use Zigs. The program has no audit.";
// The seats of this browser with a Solana key share whose backup file was not saved. A stopped
// part gets no backup (web/sol/backup.js refuses it).
export const solUnsaved = () => solOn() ? localSeats().filter((i) => {
  const s = sec(state.gid, i)?.sol;
  return !!(s?.keyPackage && s.solSeed && s.groupKey) && !s.aborted && s.backupSaved !== true;
}) : [];
// The backup dialog of the Solana part of seat i, from the backup note of the wallet.
export async function solBackup(i) {
  await solLoad();
  if (!sol) throw new Error(solError || "Solana did not load.");
  const { backupWords } = await import("./sol/backup.js");
  ui.backup = { words: backupWords(sol.ctl, i), made: false, busy: false };
  render();
}
const SOL_OFF = "Solana is not available on this server";
export let sol = null, solLoading = null, solError = "";
let solStartDoc = null;   // the stored solstart/1 of the open wallet, whoever wrote it
let solWatched = null;    // the wallet whose start document is watched
export function resetSolStart() { solStartDoc = null; solWatched = null; }
const solHost = () => ({
  Z, sdb, state, el, act, log, once, render, refilter, showBanner, sec, putSec, signedDoc,
  canWriteAs, localSeats, seatIds, checkIn, safetyNo, seatCheck, confirmedNo, openGroup, restore,
  groupVersion, sealAndSave, network: () => netName(state.g),
  askBackup: (words) => { ui.backup = { words, made: false, busy: false }; render(); },
});
// A server with SOL off does not serve the module, and the text says so. view.js is part of the
// module: it gives the setup steps (solSetup).
let setupSummary = null;
const solModule = () => Promise.all([import("./sol/main.js"), import("./sol/view.js")])
  .then(([m, v]) => { setupSummary = v.setupSummary; return m; })
  .catch(() => { throw new Error(SOL_OFF); });
// The Solana part of the open wallet for the setup steps, or null while it is not open here.
export const solSetup = () => sol && setupSummary && solOn() && sol.ctl.gid === state.gid
  ? setupSummary(sol.ctl) : null;
// A failed load is final until the page reloads: a retry on every redraw would loop.
export function solLoad() {
  solLoading ||= solModule().then((m) => m.attach(solHost())).then((m) => {
    sol = m;
    if (solOn()) sol.open(state.gid, "groups/" + state.gid);
    render(); react();
  }, (e) => {
    solError = said(e);
    showBanner("bad", "Solana did not load: " + solError);
    render();
  });
  return solLoading;
}
// The open wallet gets its watch once it is a Solana wallet. The confirmed network can come after
// the wallet opened, so the reactor asks again.
export function solWatch() {
  const gid = state.gid;
  if (!gid || solWatched === gid || !solOn(gid)) return;
  solWatched = gid;
  solAttach(gid, "groups/" + gid);
}
// Before the module loads, one watch keeps the start document. Any holder of the invite link can
// write one, so solReact loads the module only when a seat signed it.
export function solAttach(gid, base) {
  if (sol) { sol.open(gid, base); return; }
  unsubGroup.push(sdb.collection(base + "/solstart").onSnapshot((snap) => {
    solStartDoc = snap.docs.find((d) => d.id === "1")?.data() ?? null;
    refilter();
  }));
}
const solStartSigned = () => !!solStartDoc && checkIn(state.gid)("solstart/1", solStartDoc.by,
  solStartDoc.sig, docFields(solStartDoc), 1) === "yes";
export function solReact() {
  // A seat of a wallet with the Solana hint loads the module at the start of setup, so the key
  // ceremony does not wait for it. The watch still opens only for a confirmed testnet wallet.
  const auto = sec(state.gid, 1)?.solAuto === true;
  if (!sol && !solLoading && (solPlanned() || auto) && localSeats().length) solLoad();
  if (!solOn()) return;
  solWatch();
  if (sol) sol.react();
  else if (!solLoading && solStartSigned()) solLoad();
}
export const solTab = () => sol ? guard(sol.view)
  : solError ? el("p", { class: "small" }, solError)
  : (solLoad(), el("p", { class: "small" }, "Loading Solana…"));
const NET_UNCONFIRMED = "This device does not know yet which network the people of this wallet "
  + "confirmed. Open the wallet, wait until its seat shows Address checked, then try again.";
export async function solRestore(b, encrypted) {
  if (solGroup(b.group) && !solOn(b.group)) {
    throw new Error(netConfirmed(b.group) ? "Solana runs on version 3 testnet wallets only."
      : NET_UNCONFIRMED);
  }
  await solLoad();
  if (!sol) throw new Error(solError || "Solana did not load.");
  return sol.restore(b, encrypted);
}
