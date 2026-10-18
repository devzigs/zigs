// Solana host glue: solHost() and the lazy load of web/sol.
import { walletVersion } from "./util.js";
import { docFields } from "./signed.js";
import { banner, clearBadBanner, log, showBanner, state, ui } from "./app-state.js";
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

// Devnet, for version 3 wallets on the testnet that the people of the wallet confirmed (SOL-34).
// web/sol loads from the Solana tab, a signed solstart document, or the unsigned Solana hint
// (solPreload), which any holder of the invite link can write.
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
    // The small body is read to its end: a cancelled request counts as a failed one (S19).
    globalThis.fetch("/sol/config.json", { cache: "no-store" }).then((r) => {
      ui.solServed = r.ok;
      return r.text();
    }).catch(() => { if (ui.solServed === null) ui.solServed = false; }).finally(render);
  }
  return ui.solServed === true;
}
// The Solana choice of the create dialog: the hint for the other seats first, then `solAuto` in
// the secret of seat 1, which starts the ceremony with no button. A failed hint starts nothing.
export async function planSolana(gid) {
  if (!sec(gid, 1)) return;
  await sdb.doc("groups/" + gid).update({ solana: true });
  await putSec(gid, 1, { solAuto: true });
}
// What a person accepts with the Solana part. It holds PUBLIC_TEXT of web/sol/view.js, which loads
// only with the module (unified-setup.mjs keeps the two equal).
export const SOL_DISCLOSURE = "Solana Devnet: a program owns the funds of the group at a public "
  + "program address. A deposit shows its sender and amount on chain. A withdrawal shows its "
  + "recipient and amount. A private payment hides its amount, but it shows the owner key of the "
  + "payee. The program address, the group key and the fee address of each seat that pays are "
  + "public too. Helius sees that you use Zigs, your IP address and the keys of this wallet, and "
  + "its hosted prover sees each payment. The Zigs server operator can link this wallet to these "
  + "addresses by timing. Each seat funds its own fee address, and that funding shows who sent "
  + "the SOL. Every signer sees the whole Solana history of the wallet. The program has no audit, "
  + "and its upgrade key is outside the group.";
// The wallet list with the create dialog open. Inside an open wallet the dialog does not show.
export const newWallet = () => { openGroup(null); ui.create = true; render(); };
// The seats of this browser with a Solana key share whose backup file was not saved. A stopped
// part gets no backup (web/sol/backup.js refuses it), also when another seat stopped it.
const solStopped = () => solSetup()?.status === "stopped";
export const solUnsaved = () => solOn() && !solStopped() ? localSeats().filter((i) => {
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
  newWallet,
});
// A server with SOL off does not serve the module (its config answers 503), and the text says so.
// Any other failure is the connection (SOL-26). view.js is part of the module: it gives the setup
// steps (solSetup). A browser keeps a failed import() for the life of the page, so only a reload
// mends it; Try again (the Solana tab) can mend a failure after the import.
const SOL_DOWN = "Solana did not load. Check your connection, then reload the page.";
let setupSummary = null, pendingCount = null, collections = null, importFailed = false;
const SOL_RETRY = "Solana did not load. Check your connection, then press Try again.";
/** The tab text of a failed load. `retry`: Try again can mend it (a failure after the import). */
export const failText = (error, retry) => (retry ? SOL_RETRY : error);
export async function whyNotLoaded() {
  const status = await globalThis.fetch("/sol/config.json", { cache: "no-store" })
    .then((r) => r.status, () => 0);
  return status === 503 || status === 404 ? SOL_OFF : SOL_DOWN;
}
// main.js imports the wasm glue again in attach: the browser gives it the module of this load.
const solModule = () => Promise.all([import("./sol/main.js"), import("./sol/view.js"),
  import("./sol/docs.js"), import("./sol/wasm/sol_wasm.js")])
  .then(([m, v, d]) => {
    ({ setupSummary, pendingCount } = v);
    collections = d.COLLECTIONS;
    return m;
  })
  .catch(async () => {
    importFailed = true;
    throw new Error(await whyNotLoaded());
  });
// The Solana part of the open wallet for the setup steps and the approval count. The Zcash pages
// call them, so a throw gives a log line, not a broken wallet page.
const solOpenHere = (gid = state.gid) => !!sol && solOn(gid) && sol.ctl.gid === gid;
function fromSol(what, read, none) {
  try {
    return read(sol.ctl);
  } catch (e) {
    log("Solana " + what + ": " + said(e));
    return none;
  }
}
// Null until the Solana documents of the wallet arrived: before, a ready part reads as not
// started.
export const solSetup = () => solOpenHere() && setupSummary
  ? fromSol("setup steps", (c) => (collections.every((n) => c.loaded[n]) ? setupSummary(c) : null),
    null) : null;
// The Solana proposals that this browser can still approve, for wallet `gid`. The module follows
// the open wallet only, so any other wallet counts 0.
export const solPending = (gid = state.gid) =>
  solOpenHere(gid) && pendingCount ? fromSol("approval count", pendingCount, 0) : 0;
// The private balance text of the last sync (or of the saved sync) of wallet `gid`, or null,
// and the state of that sync: {text, busy}.
export const solBalance = (gid = state.gid) =>
  solOpenHere(gid) ? fromSol("balance", (c) => c.sync?.balance ?? null, null) : null;
export const solSync = (gid = state.gid) => solOpenHere(gid)
  ? fromSol("sync", (c) => ({ text: String(c.sync?.text ?? ""), busy: !!c.sync?.busy }), null)
  : null;
// A failed load waits for Try again (solRetry): a retry on every redraw would loop.
export function solRetry() {
  if (!solError) return;   // a second tap while the retry loads
  solLoading = null;
  solError = "";
  solLoad();
  render();
}
let failBanner = "";   // the text of the banner that the last failed load showed
export function solLoad() {
  solLoading ||= solModule().then((m) => m.attach(solHost())).then((m) => {
    sol = m;
    if (failBanner && banner?.text === failBanner) clearBadBanner();
    failBanner = "";
    if (solOn()) sol.open(state.gid, "groups/" + state.gid);
    render(); react();
  }, (e) => {
    solError = said(e);
    failBanner = solError === SOL_DOWN ? SOL_DOWN : "Solana did not load: " + solError;
    showBanner("bad", failBanner);
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
// write one, so solReact loads the module from it only when a seat signed it.
export function solAttach(gid, base) {
  if (sol) { sol.open(gid, base); return; }
  unsubGroup.push(sdb.collection(base + "/solstart").onSnapshot((snap) => {
    solStartDoc = snap.docs.find((d) => d.id === "1")?.data() ?? null;
    refilter();
  }));
}
const solStartSigned = () => !!solStartDoc && checkIn(state.gid)("solstart/1", solStartDoc.by,
  solStartDoc.sig, docFields(solStartDoc), 1) === "yes";
// A seat of a wallet with the Solana hint loads the module at the start of setup, so the key
// ceremony does not wait for it. The watch still opens only for a confirmed testnet wallet.
function solPreload() {
  const auto = sec(state.gid, 1)?.solAuto === true;
  if (!sol && !solLoading && (solPlanned() || auto) && localSeats().length) solLoad();
}
export function solReact() {
  solPreload();
  if (!solOn()) return;
  solWatch();
  if (sol) sol.react();
  else if (!solLoading && solStartSigned()) solLoad();
}
const retryButton = () => el("button", { class: "btn sm", type: "button", "data-sol": "retry-load",
  onclick: solRetry }, "Try again");
/** The Solana tab after a failed load: its text, and Try again only where a retry can mend it. */
export const loadFail = (error, retry) => el("div", { style: "display:grid;gap:8px" },
  el("p", { class: "small" }, failText(error, retry)), retry ? el("div", {}, retryButton()) : null);
export const solTab = () => sol ? guard(sol.view)
  : solError ? loadFail(solError, !importFailed)
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
