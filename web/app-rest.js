// The part of the old app.js that has not moved to a module yet. Step E1 deletes it.
import {
  MEMO_BYTES, memoBytes, memoError, memoShown, parsePayeeList, toZat, zatText,
} from "./payees.js";
import {
  backupName, boxPairMatches, finite, fmtInt, heldRefusal, keysOf, lateFields, makePassphrase,
  numberClash, passIssue, restoredSecret, seatBackedUp, settledFields, shareShape, skey,
  staleRestore, takenKeys, undoPlan, usesV2, walletVersion,
} from "./util.js";
import { docFields, IGNORED_NOTE } from "./signed.js";
import { signPairMatches, validId, validRoom } from "./chat.js";
import {
  accountBackupName, backupPayload, balanceWarnings, chatTimeline, fundingWarning, holdsNotes,
  messagePlan, NAME_MAX, otherWhere, KIND as PERSONAL_KIND, removeWarning, salvageBackup,
  SENT_WORDS, sentNote,
} from "./personal.js";
import { payeeRows, REQUEST_NET, requestProblem } from "./requests.js";
import { busy, log, ready, showBanner, state, ui } from "./app-state.js";
import {
  about, elapsed, fmtZec, initials, isObj, J, S, said, short, when, zecText,
} from "./app-kit.js";
import { engineOffThread, engineSettled, Z } from "./app-engine.js";
import {
  chats, forgetVault, gkeys, lockedVault, lockWithPasskey, mySeatSecrets, persist, putKey, putSec,
  sec, secrets, storageOk, unlockVault, vault,
} from "./app-keystore.js";
import {
  allDone, allSeated, curSession, fitState, keysDiffer, localSeats, seatIds, seatMine, seatStage,
  signersOf, STAGE_LABEL,
} from "./app-seats.js";
import { inviteLink, isChatId, openChat } from "./app-links.js";
import {
  addrHidden, atCap, balanceNow, balOf, capText, chain, curChain, curNet, ensureChain, inFlight,
  netName, netOf, NETWORKS, readsMemos, runSync, setMemoReading, spanMs,
} from "./app-chain.js";
import {
  canWriteAs, checkIn, mayAct, refilter, signedDoc, signedHold, signedMode,
} from "./app-filter.js";
import {
  canWrite, closeSession, db, dbReady, downloads, needsMyApproval, openGroup, openSession, sdb,
  toApprove, unsubGroup,
} from "./app-groups.js";
import {
  act, addrGroups, avatar, closeBtn, copyBtn, countBadge, el, groupName, guard, isPayee, leavesOf,
  logBox, memoRow, memoTexts, money, named, nameField, netBadge, networkPick, newBadge, normalized,
  onNetwork, payTitle, proposer, qrBox, ruleText, seatLabel, seatTitle, secretQr, skeleton,
  statusChip, unreadable, unreadChip,
} from "./app-dom.js";
import {
  contactName, contactOf, joinChat, joinLinks, markRead, signing, syncRooms, unreadIn,
} from "./app-messages.js";
import {
  abortedText, canCreateWallet, confirmedBy, confirmSeats, confirmSeatsOf, createGroup,
  createWallet, groupVersion, holdsAllSeats, myVerified, reactConfirm, reactSeat, reactStops,
  rejectedSeats, remoteAborts, safetyNo, SAVE_FAILED, saveFailed, seatCheck, takeSeat,
  verifiedCount,
} from "./app-dkg.js";
import {
  approve, broadcastTx, cancelMove, cancelPayment, expired, expiryOf, feeEstimate, finalizeTx,
  inspectOf, newSpend, onChain, PRIORITY_FACTOR, priorityTimes, proofStalled, proposeAgain,
  proposeMove, reactSession, recipientCheck, resendTx, sendBlocker, signingStarted, txidOf,
} from "./app-payments.js";
import { proposeWallets, requestCard, requestOf } from "./app-payreq.js";
import {
  accountInbox, acct, acctAddressWhy, acctBalance, addPersonalContact, addressFor, blockTime,
  changePersonal, contactRows, copyFundingRequest, createPersonal, flightNow, fundFromWallet,
  messageWhy, NOT_READY, openContact, personal, personalDamaged, personalEnv, personalError,
  personalPending, removeAccount, restoreAccount, sendOnChain, sentStateOf, splitParts,
} from "./app-account.js";
import { chatView, composer, discussion, messagesCard, newChatDialog } from "./app-thread.js";

// ───────────────────────── Reactor ─────────────────────────
// Each browser advances the steps it can do for its own seats. Steps that
// need a human decision (approving a spend) wait for a click.
const RETRY_MS = 3000;
export async function once(key, fn) {
  if (busy.has(key)) return; busy.add(key);
  let wait = 0;
  try { await fn(); } catch (e) {
    wait = RETRY_MS;
    const text = e && e.message ? e.message : String(e);
    log("✗ " + key + ": " + text); showBanner("bad", text);
  }
  finally { busy.delete(key); render(); setTimeout(react, wait); }
}

export function react() {
  try {
    settleRestore();
    syncRooms();
    reactNow();
  } catch (e) { log("✗ react: " + (e && e.message ? e.message : e)); }
}

const canReact = () => !!(Z && db && state.g && !state.g.unreadable && groupVersion());
const chainReady = () => state.wallet && state.wallet.birthday && myVerified() && !keysDiffer();

function reactNow() {
  if (!canReact() || signedHold()) return;
  reactStops();
  reactConfirm();
  for (const i of localSeats()) reactSeat(i);
  if (chainReady()) ensureChain();
  // Group creator builds the shared wallet once all group keys agree.
  if (canCreateWallet()) once("wallet", createWallet);
  // Signing.
  const ss = curSession();
  if (ss && state.wallet) reactSession(ss);
  solReact();
}

// ── Solana beta (web/sol, ZOLANA.md) ──
// Devnet, for version 3 wallets on testnet only. The network is the first one that this device
// saw (pinNetwork). web/sol loads when the Solana tab opens, or when a seat signed the wallet's
// solstart document. Any other wallet, and a wallet that is not loaded yet, never fetches any of
// it.
const solGroup = (gid) =>
  (gid === state.gid && state.g) || state.groups.find((x) => x.id === gid);
export const solOn = (gid = state.gid) => {
  const g = solGroup(gid);
  return g?.network === "testnet" && walletVersion(g) === 3 && signedMode(gid);
};
const SOL_BACKUP_KIND = "zigs-sol-backup";
const SOL_OFF = "Solana is not available on this server";
export let sol = null, solLoading = null, solError = "";
let solStartDoc = null;   // the stored solstart/1 of the open wallet, whoever wrote it
export function resetSolStart() { solStartDoc = null; }
const solHost = () => ({
  Z, sdb, state, el, act, log, once, render, refilter, showBanner, sec, putSec, signedDoc,
  canWriteAs, localSeats, seatIds, checkIn, safetyNo, seatCheck, openGroup, restore,
  groupVersion, sealAndSave, network: () => netName(state.g),
  askBackup: (words) => { ui.backup = { words, made: false, busy: false }; render(); },
});
// A server with SOL off does not serve the module, and the text says so.
const solModule = () => import("./sol/main.js").catch(() => { throw new Error(SOL_OFF); });
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
function solReact() {
  if (!solOn()) return;
  if (sol) sol.react();
  else if (!solLoading && solStartSigned()) solLoad();
}
export const solTab = () => sol ? guard(sol.view)
  : solError ? el("p", { class: "small" }, solError)
  : (solLoad(), el("p", { class: "small" }, "Loading Solana…"));
async function solRestore(b, encrypted) {
  if (solGroup(b.group) && !solOn(b.group)) {
    throw new Error("Solana runs on version 3 testnet wallets only.");
  }
  await solLoad();
  if (!sol) throw new Error(solError || "Solana did not load.");
  return sol.restore(b, encrypted);
}

// ───────────────────────── Backups ─────────────────────────
// A backup file is the key share, sealed with a passphrase (PROTOCOL.md section 9). The engine
// does the Argon2id and the cipher. The passphrase lives only in the dialog's input and in the
// worker call, never in `ui`.
const BACKUP_KIND = "zigs-key-share";   // what the sealed text holds, also in a plain file
// The key share files changed on this date (PROTOCOL.md section 9). Account and Solana files did
// not, so only the seat backup screens and these two texts say it.
const BACKUP_CHANGED = "The backup format changed on 16 October 2026. Older backup files no longer "
  + "open. Save a new backup now. iPhone and Mac apps need their next version to open new files.";
const NOT_A_BACKUP = "This file is not a Zigs backup, or an older version of Zigs made it. "
  + "The backup format changed on 16 October 2026, and older files no longer open. "
  + "Make a new backup on a device that still holds the seat.";
const NOT_ENCRYPTED = "This backup file is not encrypted. Make a new encrypted backup now.";
const MAX_BACKUP_BYTES = 1000000;
const ACCOUNT_PASS_NOTE = "This passphrase opens the backup of your personal account. Zigs cannot "
  + "recover it. Write it down and keep it apart from the file.";
const ACCOUNT_FILE_NOTE = "The file holds the seed of the account and your contacts. Anyone who "
  + "has the file and the passphrase can spend the account and read the contacts. It holds no "
  + "messages.";
const PASS_NOTE = "This passphrase opens your key share. Zigs cannot recover it. Write it down and "
  + "keep it apart from the file.";

// Nonces stay out: a restored copy must never sign with a nonce this browser may also use.
export function backupText(i) {
  const {
    nonces: _nonces, backupSaved: _saved, backedUp: _oldFlag, sol: _sol, ...s
  } = sec(state.gid, i);
  s.uid = s.uid || state.seats[i].uid;
  return S({
    kind: BACKUP_KIND, group: state.gid, groupName: state.g.name, seat: i,
    threshold: state.g.t, of: state.g.n, key: gkeys[state.gid], wallet: state.wallet, secret: s,
  });
}

function openBackup(i) {
  if (!downloads) { showBanner("bad", "Downloads are not available in this view."); return; }
  ui.backup = { seat: i, made: false, busy: false };
  render();
}

function closeBackup() {
  if ((ui.backup || ui.restore || {}).busy) return;
  ui.backup = null; ui.restore = null;
  render();
}

// Seals `plain`, opens the file again in memory to prove it holds the same text, and only then
// offers the download. Returns false when the person declined to save.
export async function sealAndSave(pass, plain, filename) {
  const sealed = await engineOffThread("backupSeal", pass, plain);
  if (await engineOffThread("backupOpen", pass, sealed) !== plain) {
    throw new Error("The backup did not open to the same data, so it was not saved. Try again.");
  }
  try {
    await downloads.save({ filename, data: sealed });
  } catch (e) {
    if (e && e.code === "declined") return false;
    throw new Error("Backup not saved: " + (e.message || e.code));
  }
  return true;
}

export async function saveBackup(i, pass) {
  // The wallet that is open can change while the engine works (the Back button).
  const gid = state.gid, wallet = state.g.name;
  if (!(await sealAndSave(pass, backupText(i), backupName(wallet, i)))) return false;
  await putSec(gid, i, { backupSaved: true });
  return true;
}

// The backup of the personal account: the seed, the network, the birthday and the contacts. An
// account that does not read gives what can be read of it.
export async function saveAccountBackup(pass) {
  const payload = personal ? backupPayload(personal)
    : salvageBackup(personalDamaged, personalEnv());
  if (!payload) {
    throw new Error("This page cannot read the seed of the saved account, so it cannot make a "
      + "backup.");
  }
  if (!(await sealAndSave(pass, S(payload), accountBackupName(payload.network)))) return false;
  if (personal) await changePersonal((p) => { p.backedUp = true; p.everBackedUp = true; });
  return true;
}

function openAccountBackup() {
  if (!downloads) { showBanner("bad", "Downloads are not available in this view."); return; }
  ui.backup = { personal: true, made: false, busy: false };
  render();
}

// The words of the backup dialog and the call that saves, for a seat and for the account.
const seatBackup = (i) => ({
  title: "Back up seat " + i, pass: PASS_NOTE, save: (pass) => saveBackup(i, pass),
  changed: BACKUP_CHANGED,
  file: "The file holds your key share. Anyone who has the file and the passphrase can sign as "
    + "this seat.",
});
const ACCOUNT_BACKUP = {
  title: "Back up the personal account", pass: ACCOUNT_PASS_NOTE, file: ACCOUNT_FILE_NOTE,
  save: (pass) => saveAccountBackup(pass),
};

export function backupDialog() {
  const b = ui.backup, words = b.words ?? (b.personal ? ACCOUNT_BACKUP : seatBackup(b.seat));
  const pass = el("input", {
    class: "input mono", id: "bk-pass", type: b.made ? "text" : "password", autocomplete: "off",
    spellcheck: "false", autocapitalize: "off", disabled: b.busy, "aria-describedby": "bk-hint",
  });
  const again = el("input", {
    class: "input mono", id: "bk-again", type: "password", autocomplete: "off",
    spellcheck: "false", autocapitalize: "off", disabled: b.busy, "aria-describedby": "bk-hint",
  });
  const hint = el("span", { class: "hint", id: "bk-hint" });
  const go = el("button", { class: "btn primary", type: "submit" },
    b.busy ? "Encrypting…" : "Encrypt and save");
  const update = () => {
    const issue = passIssue(pass.value, again.value);
    hint.textContent = issue || "The passphrases match.";
    hint.className = "hint " + (issue ? "" : "ok");
    go.disabled = !!issue || b.busy || !Z;
  };
  // The new values are set on the inputs, because a redraw keeps what the inputs hold.
  const make = () => {
    pass.value = makePassphrase(crypto.getRandomValues(new Uint8Array(30)));
    again.value = "";
    b.made = true;
    render();
  };
  const submit = act(async () => {
    const p = pass.value;
    if (passIssue(p, again.value)) return;
    b.busy = true; render();
    try {
      if (!(await words.save(p))) return;
      if (ui.backup === b) ui.backup = null;
      showBanner("ok", "Backup saved. Keep the passphrase apart from the file.");
    } finally { b.busy = false; }
  });
  const form = el("form", {
    class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "backup-title",
    oninput: update, onsubmit: submit,
  },
  el("div", { class: "card-head" }, el("h2", { id: "backup-title" }, words.title),
    el("button", {
      class: "icon-btn", type: "button", "aria-label": "Close", onclick: closeBackup,
    }, "×")),
  el("p", { class: "small" }, words.pass),
  words.changed ? el("p", { class: "small" }, words.changed) : null,
  el("label", { class: "field" }, el("span", {}, "Passphrase"), pass),
  el("div", { class: "row-actions" },
    el("button", { class: "btn sm", type: "button", disabled: b.busy, onclick: make },
      "Make a passphrase for me"),
    b.made ? copyBtn(() => pass.value, "Copy passphrase") : null),
  b.made ? el("p", { class: "small" }, "Copy keeps the passphrase on the clipboard until you copy "
    + "something else. Write it down, then clear the clipboard.") : null,
  el("label", { class: "field" }, el("span", {}, "Type it again"), again, hint),
  el("div", { class: "callout" }, words.file),
  el("div", { class: "dialog-actions" },
    el("button", {
      class: "btn", type: "button", disabled: b.busy, onclick: closeBackup,
    }, "Cancel"),
    go));
  update();
  return form;
}

function restoreDialog() {
  const r = ui.restore;
  const pass = el("input", {
    class: "input mono", id: "rs-pass", type: "password", autocomplete: "off",
    spellcheck: "false", autocapitalize: "off", disabled: r.busy,
  });
  const submit = act(async () => {
    const p = pass.value;
    if (!p) throw new Error("Enter the passphrase of this backup.");
    r.busy = true; render();
    try {
      const plain = await engineOffThread("backupOpen", p, r.text);
      await applyBackup(parseBackup(plain), true);
      ui.restore = null;
    } finally { r.busy = false; }
  });
  return el("form", {
    class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "restore-title",
    onsubmit: submit,
  },
  el("div", { class: "card-head" }, el("h2", { id: "restore-title" }, "Open a backup"),
    el("button", {
      class: "icon-btn", type: "button", "aria-label": "Close", onclick: closeBackup,
    }, "×")),
  el("p", { class: "small" }, "Enter the passphrase you chose when you made " + r.name + "."),
  el("label", { class: "field" }, el("span", {}, "Passphrase"), pass),
  el("div", { class: "dialog-actions" },
    el("button", {
      class: "btn", type: "button", disabled: r.busy, onclick: closeBackup,
    }, "Cancel"),
    el("button", { class: "btn primary", type: "submit", disabled: r.busy || !Z },
      r.busy ? "Opening…" : "Open backup")));
}

function parseBackup(text) {
  try { return J(text); } catch { throw new Error(NOT_A_BACKUP); }
}

// An encrypted file asks for its passphrase. A plain file of the current kind restores at once and
// leaves the backup note up, so the person makes an encrypted file. A plain file of an older
// version has another kind: checkShape refuses it.
export async function restore(file) {
  try {
    if (file.size > MAX_BACKUP_BYTES) throw new Error(NOT_A_BACKUP);
    const text = await file.text();
    const b = parseBackup(text);
    if (b && b.kind === "zigs-backup") {
      ui.restore = { text, name: file.name, busy: false };
      render();
      return;
    }
    await applyBackup(b, false);
  } catch (e) { showBanner("bad", e.message); }
}
const BACKUP_SEAT_MAX = 7;
const wellFormed = (b) => isObj(b) && b.kind === BACKUP_KIND && isObj(b.secret);
const validSeatRef = (b) => validId(b.group) && Number.isInteger(b.seat) && b.seat >= 1
  && b.seat <= BACKUP_SEAT_MAX;
const validKey = (b) => b.key === undefined || validRoom({ id: b.group, key: b.key });
const NO_FIT = "This backup does not fit this wallet. It was not used.";
const RESTORE_PENDING = "A restore of this seat is still being checked. Open the wallet and "
  + "wait, then try again.";

export function checkShape(b) {
  if (!(wellFormed(b) && validSeatRef(b) && validKey(b))) throw new Error(NOT_A_BACKUP);
  if (!shareShape(b.secret.keyPackage)) throw new Error("This backup holds no key share.");
}

// A restore must not replace what this browser holds: not the wallet secret (the rule for invite
// links, too), not a seat that is still in setup, not the key share of the seat, and not a chat
// that has the id of the wallet.
function checkClash({ group, seat, key, secret }) {
  const held = heldRefusal(sec(group, seat), secret.keyPackage, seat);
  const found = [
    [key && gkeys[group] && gkeys[group] !== key, "This backup has a different wallet secret for "
      + "a wallet you already have, so it was not restored."],
    [isChatId(group), "A chat that you have uses the id of this wallet, so the backup was not "
      + "restored."],
    [held, held],
    [restoreWatch.has(skey(group, seat)), RESTORE_PENDING],
  ].find(([clash]) => clash);
  if (found) throw new Error(found[1]);
}

// Throws unless the page can store `b`. A wallet that is open already shows if the backup fits.
// While a document that decides it has not loaded, settleRestore decides later.
function checkBackup(b) {
  checkShape(b);
  checkClash(b);
  if (state.gid === b.group && fitState(b.seat, b.secret) === false) throw new Error(NO_FIT);
}

// A restore waits here until the documents of its seat have loaded (settleRestore), by wallet and
// seat. `keys` holds the key pairs of the file, and `late` its version and room. They are not
// stored before the published keys of the seat and the wallet document check them.
export const restoreWatch = new Map();

// What a restore stores now: the allowed fields of the file without its key pairs, version and
// room, which wait for the check of settleRestore. Older backups hold nonces: a restored nonce
// could sign a second, different package, so the nonces of this browser stay. A seat that held a
// key share stays what it was: the flag `restored` would put the seat of this browser under the
// fit rule of seatOwned.
export function restoredFor(b, held) {
  const nonces = (held || {}).nonces || {};
  return { ...restoredSecret(b.secret, held), nonces, ...(held ? {} : { restored: true }),
    backupSaved: false };
}

// The files that are no key share of a seat. A Map, because the kind comes from a file: a plain
// object would answer for "constructor".
const OTHER_BACKUPS = new Map([[PERSONAL_KIND, restoreAccount], [SOL_BACKUP_KIND, solRestore]]);

// Stores the key share of a backup, from the fields that restoredFields allows. `encrypted` says
// the file was sealed: only then does the seat count as backed up, and only when the backup fits
// the wallet.
export async function applyBackup(b, encrypted) {
  const other = isObj(b) ? OTHER_BACKUPS.get(b.kind) : undefined;
  if (other) return other(b, encrypted);
  checkBackup(b);
  const { group, seat, key } = b;
  const held = secrets[skey(group, seat)];
  const before = held && structuredClone(held);
  const addedKey = !!key && !gkeys[group];
  if (key) putKey(group, key);
  if (!(await putSec(group, seat, restoredFor(b, held)))) {
    throw new Error("This browser could not save the restored key share.");
  }
  const where = "seat " + seat + " of " + (b.groupName || "wallet");
  restoreWatch.set(skey(group, seat), {
    gid: group, seat, encrypted, before, addedKey, where, keys: keysOf(b.secret),
    late: lateFields(b.secret, held),
  });
  announceRestore(where, encrypted);
  openGroup(group);
}

function announceRestore(where, encrypted) {
  const text = "Restored " + where + ". It counts as your seat once it matches the wallet.";
  if (encrypted) showBanner("ok", text);
  else showBanner("bad", text + " " + NOT_ENCRYPTED);
}

// Removes the seat secret that the restore made (undoPlan). Returns false when it leaves the seat
// alone, else true when the wallet went away too.
export function undoRestore(w) {
  if (undoPlan(w.before) === "keep") return false;
  delete secrets[skey(w.gid, w.seat)];
  const dropped = releaseKey(w);
  persist();
  return dropped;
}

// The restore that added the wallet secret removes it again, unless a seat of the wallet remains.
// A restore of the same wallet that still waits takes over the duty to remove it.
function releaseKey({ gid, addedKey }) {
  const heir = [...restoreWatch.values()].find((o) => o.gid === gid);
  if (heir) heir.addedKey = heir.addedKey || addedKey;
  const drop = addedKey && !mySeatSecrets(gid).length;
  if (drop) delete gkeys[gid];
  return drop;
}

// A restored key share counts when the key data of the seat equals what the wallet published
// for it, which is known when the documents of the seat have loaded. Else the restore is undone.
// Each restore settles alone, and the first one may close the wallet.
export function settleRestore() {
  let settled = false;
  for (const [key, w] of [...restoreWatch]) settled = settleOne(key, w) || settled;
  if (settled) render();
}

function settleOne(key, w) {
  if (w.gid !== state.gid || !state.seats[w.seat]) return false;
  const fit = fitState(w.seat, sec(w.gid, w.seat) || {});
  if (fit === null) return false;
  restoreWatch.delete(key);
  if (fit) acceptRestore(w, state.seats[w.seat]);
  else rejectRestore(w);
  return true;
}

function rejectRestore(w) {
  if (undoRestore(w)) openGroup(null);
  showBanner("bad", NO_FIT);
}

// A restored seat that does not fit is no seat of this browser (seatOwned). The watch of a restore
// is in memory, so after a reload no restore settles it: the note stays.
// Removing it deletes only this browser's copy. The wallet's verdict can come from a document that
// any holder of the invite link can rewrite, so removal asks first.
const STALE_RESTORE = "This restored seat does not match the wallet, so this browser does not use "
  + "it. Remove it from this browser, then restore the right backup.";
function staleRestoreNote() {
  const gid = state.gid, stale = mySeatSecrets(gid).filter(([i, s]) =>
    staleRestore(s, () => fitState(i, s), restoreWatch.has(skey(gid, i)))).map(([i]) => i);
  if (!stale.length) return null;
  const sure = ui.dropStale === gid;
  const drop = () => {
    for (const i of stale) delete secrets[skey(gid, i)];
    ui.dropStale = null; persist(); render();
  };
  const keep = () => { ui.dropStale = null; render(); };
  return el("div", { class: "callout bad", role: "alert" }, STALE_RESTORE,
    el("div", { class: "dialog-actions" },
      sure ? el("button", { class: "btn", type: "button", onclick: keep }, "Keep it") : null,
      el("button", {
        class: "btn", type: "button", onclick: sure ? drop : () => { ui.dropStale = gid; render(); },
      }, sure ? "Remove seat " + stale.join(", ") + " from this browser" : "Remove from this browser")));
}

// The version and room of the file join the seat only when they equal the wallet's own.
function acceptRestore(w, published) {
  once("restore-keys:" + skey(w.gid, w.seat), () => takeRestoredKeys(w, published));
  const later = settledFields(w.late, groupVersion(), state.g.room);
  if (Object.keys(later).length) putSec(w.gid, w.seat, later);
  if (!w.encrypted) return;
  putSec(w.gid, w.seat, { backupSaved: true });
  showBanner("ok", "Restored " + w.where + ". It matches the wallet.");
}

// A pair checks out when the secret key of the file makes the public key that the seat published.
const PAIR_CHECKS = {
  box: async (f, p) => boxPairMatches(Z, f.boxSk, p.boxPk),
  sign: async (f, p) => signPairMatches(f.signSk, p.signPk),
};

// Adds the key pairs of a restored file to the seat once each is the pair that the seat published.
// A pair that does not check out is dropped.
async function takeRestoredKeys({ gid, seat, keys }, published) {
  const good = [];
  for (const [name, check] of Object.entries(PAIR_CHECKS)) {
    if (await check(keys, published)) good.push(name);
  }
  const held = sec(gid, seat);
  if (held) await putSec(gid, seat, takenKeys(keys, held, good, published));
}

let openLayer = "", tickTimer = null;
export let opener = "", lastTrigger = "", wantFocus = null;   // focus bookkeeping, see draw()
export function focusAfter(key, force) { wantFocus = key ? { key, force } : null; }
const MAX_PAYEES = 20;
const TOO_MANY = "A payment can have at most " + MAX_PAYEES + " recipients.";

// Draws once per frame, however many changes arrive together. A hidden tab gets no frames, so a
// timer backs it up and the tab title still shows the approvals.
let drawPending = false, composing = false;
export function render() {
  if (drawPending) return;
  drawPending = true;
  // A redraw replaces the text box and ends an IME composition, so it waits until the end.
  const run = () => { if (drawPending && !composing) { drawPending = false; draw(); } };
  requestAnimationFrame(run);
  setTimeout(run, 120);
}

const FOCUSABLE = "button, a[href], input, select, textarea, summary";
// A rebuilt control is a new element. A key from its label (or an explicit data-key) lets focus
// find it again; equal labels get a number.
function keyControls(root) {
  const seen = new Map();
  for (const n of root.querySelectorAll(FOCUSABLE)) {
    if (n.dataset.key) continue;
    const base = n.tagName + ":" + controlLabel(n), count = seen.get(base) || 0;
    seen.set(base, count + 1);
    n.dataset.key = base + ":" + count;
  }
}

function controlLabel(n) {
  const text = n.textContent.trim().slice(0, 40);
  return n.id || n.getAttribute("aria-label") || n.name || text || n.type;
}
const controlByKey = (root, key) =>
  [...root.querySelectorAll("[data-key]")].find((n) => n.dataset.key === key);

function focusSnapshot(root) {
  const a = document.activeElement;
  if (!a || !root.contains(a) || !a.dataset.key) return null;
  const snap = { key: a.dataset.key };
  try {
    snap.sel = [a.selectionStart, a.selectionEnd, a.selectionDirection];
  } catch { /* not a text control */ }
  return snap;
}

// `wantFocus.force` wins over the old focus (arrow keys in tabs, the opener of a closed layer).
function restoreFocus(root, snap) {
  const want = wantFocus; wantFocus = null;
  const key = want && (want.force || !snap) ? want.key : snap && snap.key;
  const n = key && controlByKey(root, key);
  if (!n) return;
  n.focus({ preventScroll: true });
  if (snap && snap.key === key) restoreSelection(n, snap.sel);
}

function restoreSelection(n, sel) {
  if (!sel || sel[0] == null) return;
  try { n.setSelectionRange(...sel); } catch { /* not a text control */ }
}

function focusLayer(layer) {
  layer.tabIndex = -1;
  const pick = layer.classList.contains("drawer") ? ".icon-btn" : "input, button.btn";
  (layer.querySelector(pick) || layer).focus();
}

// The page behind a dialog or the drawer cannot take focus or clicks while the layer is open.
function setModal(view, on) {
  view.toggleAttribute("inert", on);
  document.querySelector(".side").toggleAttribute("inert", on);
}

const appFoot = () => el("footer", { class: "app-foot" }, "Beta · not audited · ",
  el("a", { href: "https://zigs.app", target: "_blank", rel: "noopener" }, "About Zigs"));

// The page when no wallet is open: a direct chat, a contact on chain, or the wallet list.
export const mainView = () => (state.cid ? chatView() : state.contact != null ? contactView() : lobby());

function pageView() {
  try {
    if (lockedVault) return lockView();
    if (!dbReady) return loadingView();
    return state.gid ? groupView() : mainView();
  } catch (e) {
    log("unreadable page: " + (e && e.message ? e.message : e));
    const back = el("button", {
      class: "btn ghost sm", type: "button", onclick: () => openGroup(null),
    }, "← Wallets");
    return el("div", { class: "page" }, back,
      el("div", { class: "card empty" }, el("h3", {}, "This wallet has data this app cannot read"),
        el("p", { class: "small" }, "Another signer may use a newer version of Zigs. "
          + "Reload the page, or ask them.")));
  }
}

export function draw() {
  const shell = document.querySelector(".shell"), app = document.getElementById("app");
  const snap = focusSnapshot(shell);
  markRead();
  renderSide();
  const pending = state.groups.reduce((n, g) => n + toApprove(g.id).length + unreadIn(g.id), 0)
    + Object.keys(chats.list).reduce((n, cid) => n + unreadIn(cid), 0);
  document.title = pending ? "(" + pending + ") Zigs" : "Zigs";
  const form = saveFormState(app);
  const view = pageView(), top = lockedVault ? [] : layers();
  if (typingMessage(app, [view, ...top])) return;
  app.replaceChildren(view, ...top, appFoot());
  keyControls(shell);
  setModal(view, top.length > 0);
  const entered = trackLayer(top);
  clearTimeout(tickTimer);
  const ss = curSession();
  if (ss && ss.status === "proving") tickTimer = setTimeout(render, 1000);
  restoreFormState(app, form);
  if (entered) focusLayer(top[1]); else restoreFocus(shell, snap);
}

// Rebuilding a focused text box closes a phone's keyboard. While a message box or a field of the
// request form has focus, only the message logs update; the whole page redraws when it loses focus.
// A field of the request form counts only while its form is open: after a send, the form must go.
const typingIn = (box) => !!box && (box.id.startsWith("chat-text-") || box.id === "fund-amt"
  || (!!ui.request && /^req-(amt|memo)-/.test(box.id)));
export function typingMessage(app, parts) {
  const box = document.activeElement;
  if (!typingIn(box) || !app.contains(box)) return false;
  const logs = saveLogs(app);
  for (const old of app.querySelectorAll(".chat-log")) {
    const fresh = parts.map((p) => p && p.querySelector("#" + old.id)).find(Boolean);
    if (!fresh) continue;
    old.replaceWith(fresh);
    fresh.scrollTop = logs[fresh.id] ?? fresh.scrollHeight;
  }
  if (!box.dataset.redraw) {
    box.dataset.redraw = "1";
    box.addEventListener("focusout", () => render(), { once: true });
  }
  return true;
}

// Keep what the viewer is typing, open <details>, and the drawer scroll across live updates.
function saveFormState(app) {
  const values = {};
  for (const i of app.querySelectorAll("input[id], select[id], textarea[id]")) {
    if (i.type !== "file") values[i.id] = i.value;
  }
  const open = new Set([...app.querySelectorAll("details[open] > summary")].map((x) => x.textContent));
  const scroll = app.querySelector(".drawer-body")?.scrollTop || 0;
  const tabs = app.querySelector(".tabs")?.scrollLeft || 0;
  return { values, open, logs: saveLogs(app), scroll, tabs };
}

// A message log that was at its end stays at its end; otherwise it keeps its place.
function saveLogs(app) {
  const logs = {};
  for (const l of app.querySelectorAll(".chat-log")) {
    logs[l.id] = l.scrollHeight - l.scrollTop - l.clientHeight < 24 ? null : l.scrollTop;
  }
  return logs;
}

function restoreFormState(app, form) {
  for (const [id, v] of Object.entries(form.values)) {
    const i = document.getElementById(id);
    if (!i) continue;
    i.value = v;
    i.dispatchEvent(new Event("input", { bubbles: true }));
  }
  for (const x of app.querySelectorAll("details > summary")) {
    if (form.open.has(x.textContent)) x.parentElement.open = true;
  }
  restoreScroll(app, form);
}

function restoreScroll(app, form) {
  const body = app.querySelector(".drawer-body"), tabs = app.querySelector(".tabs");
  if (body) body.scrollTop = form.scroll;
  if (tabs) tabs.scrollLeft = form.tabs;
  for (const l of app.querySelectorAll(".chat-log")) {
    l.scrollTop = form.logs[l.id] ?? l.scrollHeight;
  }
}

// Remembers which control opened a layer, and asks for it back when the layer closes. Returns true
// when a new layer just opened.
function trackLayer(top) {
  const layer = top[1];
  const key = layer ? layer.getAttribute("aria-labelledby") || layer.getAttribute("aria-label") : "";
  if (key && !openLayer) { opener = lastTrigger; lastTrigger = ""; }
  if (!key && openLayer && opener) { wantFocus = { key: opener, force: true }; opener = ""; }
  const entered = !!key && key !== openLayer;
  openLayer = key;
  return entered;
}

// The control that opened a layer gets focus back when the layer closes.
document.addEventListener("click", (ev) => {
  const n = ev.target.closest && ev.target.closest(FOCUSABLE);
  if (n && n.dataset.key && !n.closest(".dialog, .drawer")) lastTrigger = n.dataset.key;
}, true);

export function layers() {
  try { return ui.newChat ? [scrim(() => ui.newChat = false), newChatDialog()] : buildLayers(); }
  catch (e) { log("unreadable layer: " + (e && e.message ? e.message : e)); return []; }
}

const scrim = (close) => el("div", { class: "scrim", onclick: () => { close(); render(); } });

// The dialogs, in the order that they take the screen: [is shown, close, build]. `open` is true in
// an open wallet that has its wallet document. A restore starts in the wallet list.
const DIALOGS = [
  [() => ui.restore, closeBackup, () => restoreDialog()],
  [(open) => ui.backup && (open || ui.backup.personal), closeBackup, () => backupDialog()],
  [(open) => ui.send && open, () => ui.send = false, () => sendDialog()],
  [(open) => ui.receive && open, () => ui.receive = false, () => receiveDialog()],
  [() => ui.create && !state.gid, () => ui.create = false, () => createDialog()],
  [() => ui.contactAdd && !!personal, () => ui.contactAdd = false, () => contactDialog()],
  [(open) => ui.move && open, () => ui.move = false, () => createDialog(state.g)],
];

function buildLayers() {
  const ss = state.gid && state.wallet ? curSession() : null;
  if (ss) return [scrim(closeSession), sessionLayer(ss)];
  const open = state.gid && state.wallet;
  const dialog = DIALOGS.find(([shown]) => shown(open));
  return dialog ? [scrim(dialog[1]), dialog[2]()] : [];
}

function renderSide() {
  const nav = document.getElementById("side-nav");
  const newWallet = () => { openGroup(null); ui.create = true; render(); };
  nav.replaceChildren(
    el("div", { class: "side-head" }, el("span", { class: "label" }, "Wallets"),
      el("button", { class: "icon-btn", type: "button", title: "New wallet", "aria-label": "New wallet", onclick: newWallet }, "+")),
    ...(state.groups.length ? state.groups.map((g) => guard(sideItem, g))
      : [el("p", { class: "side-empty" }, sideEmpty())]),
    el("div", { class: "side-head" }, el("span", { class: "label" }, "Chats"),
      el("button", { class: "icon-btn", type: "button", title: "New chat", "aria-label": "New chat",
      onclick: newChat }, "+")),
    ...Object.keys(chats.list).map((cid) => guard(chatItem, cid)),
    ...(personal ? [el("div", { class: "side-head" }, el("span", { class: "label" }, "On chain"),
      el("button", { class: "icon-btn", type: "button", title: "Add contact",
        "aria-label": "Add contact", onclick: openContactDialog }, "+")),
    ...personal.contacts.map((c) => guard(contactItem, c))] : []));
}

const newChat = () => { ui.newChat = true; render(); };

function chatItem(cid) {
  const here = cid === state.cid, name = contactName(cid);
  return el("button", {
    class: "side-item" + (here ? " active" : ""), type: "button",
    "aria-current": here ? "page" : null, "data-key": "chat-" + cid, onclick: () => openChat(cid),
  }, el("span", { class: "av" }, initials(contactOf(cid) ? name : "")),
  el("span", { class: "side-name" }, name),
  el("span", { class: "side-tail" }, unreadChip(unreadIn(cid))));
}

const sideEmpty = () => lockedVault ? "Locked." : dbReady ? "No wallets yet." : "Connecting…";

function sideItem(g) {
  const n = toApprove(g.id).length, u = unreadIn(g.id), here = g.id === state.gid;
  const tail = n
    ? el("span", { class: "side-count", role: "img", title: n + " to approve",
      "aria-label": n + " to approve" }, String(n))
    : el("span", { class: "side-meta", title: ruleText(g.t, g.n) },
      g.movedTo ? "Moved" : g.t + " of " + g.n);
  const unread = unreadChip(u);
  return el("button", {
    class: "side-item" + (here ? " active" : ""), type: "button",
    "aria-current": here ? "page" : null, "data-key": "wallet-" + g.id,
    onclick: () => { ui.tab = "overview"; openGroup(g.id); },
  }, el("span", { class: "av" }, initials(g.name)),
  el("span", { class: "side-name" }, g.name), el("span", { class: "side-tail" }, unread, tail));
}

export function forgetBox() {
  const cancel = () => { ui.forget = false; render(); };
  return el("div", { class: "callout bad" },
    el("p", {}, "Without the passkey, the key shares in this browser cannot be opened. Delete "
      + "them, then restore each seat from its backup file. A seat with no backup is lost, but "
      + "the wallet still works while enough other signers remain. Direct chats in this browser "
      + "are deleted too. They are not in backup files, and a chat with two people cannot be "
      + "joined again. The personal account is deleted as well. Only its backup file brings it "
      + "back, and without one its money is lost."),
    el("div", { class: "dialog-actions" },
      el("button", { class: "btn", type: "button", onclick: cancel }, "Cancel"),
      el("button", { class: "btn", type: "button", onclick: forgetVault },
        "Delete the locked keys")));
}

function lockView() {
  const ask = () => { ui.forget = true; render(); };
  const text = lockedVault.damaged
    ? "The locked keys in this browser are damaged and cannot be opened."
    : "The key shares in this browser are encrypted with your passkey. "
      + "Unlock with Face ID, Touch ID or your security key.";
  return el("div", { class: "card empty" }, el("h3", {}, "Zigs is locked"),
    el("p", { class: "small" }, text),
    lockedVault.damaged ? null
      : el("button", {
        class: "btn primary", type: "button", disabled: !engineSettled, onclick: act(unlockVault),
      }, "Unlock"),
    ui.forget ? forgetBox()
      : el("button", { class: "btn ghost sm", type: "button", onclick: ask }, "Lost the passkey?"));
}

function lockButton() {
  if (vault) {
    return el("button", { class: "btn", type: "button", onclick: () => location.reload(),
      title: "Encrypted with your passkey. Reload to lock the page." }, "Lock now");
  }
  const can = storageOk && !!window.PublicKeyCredential;
  return el("button", { class: "btn", type: "button", disabled: !can, onclick: act(lockWithPasskey),
    title: can ? "Encrypt the key shares and the personal account in this browser with a passkey"
      : "This browser has no passkey support" }, "Lock with a passkey");
}

function loadingView() {
  return el("div", { class: "card empty" }, el("span", { class: "dot busy" }),
    el("h3", {}, Z ? "Connecting to the group server" : "Loading the crypto engine"),
    el("p", { class: "small" }, "Your wallets appear in a moment."));
}

// ── Lobby ──
export function lobby() {
  const restoreInput = el("input", {
    id: "restore", type: "file", accept: ".zigsbackup,.json,application/json", hidden: true,
    onchange: (ev) => {
      const file = ev.target.files[0];
      ev.target.value = "";
      if (file) restore(file);
    },
  });
  const restoreBtn = (cls) => el("button", {
    class: cls, type: "button", onclick: () => restoreInput.click(),
  }, "Restore from backup");
  const canCreate = Z && db && canWrite !== false;
  const actions = lobbyActions(canCreate, restoreBtn("btn"));
  const head = el("header", { class: "page-head" },
    el("div", { class: "ph-left" }, el("h1", {}, "Wallets"),
      el("p", { class: "muted" }, "Each wallet is a separate shared account, with its own address, "
        + "signers and approval rule.")),
    actions.length ? el("div", { class: "ph-actions" }, ...actions) : null);
  const rows = state.groups.map((g) => guard(walletRow, g));
  const body = state.groups.length
    ? el("section", { class: "card" }, el("div", { class: "list" }, rows))
    : welcome(canCreate, restoreBtn("btn ghost sm"));
  const joins = [...joinLinks.keys()].map((cid) => guard(chatJoinCard, cid));
  return el("div", { class: "page" }, ...joins, head, body, chatsCard(),
    guard(personalCard, () => restoreInput.click()), guard(contactsCard), restoreInput);
}

// A contact link waits here until the person clicks Join. The link is kept after a failure.
function chatJoinCard(cid) {
  const key = "chatjoin:" + cid, joining = busy.has(key);
  const join = (ev) => {
    ev.preventDefault();
    once(key, () => joinChat(cid, joinLinks.get(cid)));
    render();
  };
  return el("form", { class: "card card-pad hero-card", onsubmit: join },
    el("div", { class: "card-head" }, el("h2", {}, "Join a chat")),
    el("p", { class: "small muted" }, "Someone sent you a contact link. A chat holds two people. "
      + "Your contact sees the name below."),
    nameField("chat-join-" + cid, "your contact"),
    el("div", { class: "dialog-actions" },
      el("button", { class: "btn", type: "button", disabled: joining,
        onclick: () => { joinLinks.delete(cid); render(); } }, "Cancel"),
      el("button", { class: "btn primary", type: "submit",
        disabled: joining || !Z || !db || canWrite === false },
      joining ? "Joining the chat…" : "Join chat")));
}

// The sidebar is hidden on a phone, so the chats are listed here too.
function chatsCard() {
  const ids = Object.keys(chats.list);
  return el("section", { class: "card" },
    el("div", { class: "card-head card-pad", style: "padding-bottom:12px" }, el("h2", {}, "Chats"),
      el("button", { class: "btn sm", type: "button", disabled: !Z || !db || canWrite === false,
        onclick: newChat }, "New chat")),
    ids.length ? el("div", { class: "list", style: "border-top:1px solid var(--line)" },
      ids.map((cid) => guard(chatRow, cid)))
      : el("p", { class: "small muted card-pad" }, "Write to one person who uses Zigs."));
}

function chatRow(cid) {
  const name = contactName(cid);
  return el("button", {
    class: "row-item", type: "button", "data-key": "chat-row-" + cid, onclick: () => openChat(cid),
  },
  el("span", { class: "av lg" }, initials(contactOf(cid) ? name : "")),
  el("span", { class: "ri-main" }, el("span", { class: "ri-title" }, name),
    el("span", { class: "ri-sub" }, "Direct chat · group server")),
  el("span", { class: "ri-end" }, newBadge(unreadIn(cid))),
  el("span", { class: "chev" }, "›"));
}

// With no wallet yet, the welcome card has the only actions. Locking waits until there is a wallet
// or a key share to lock.
function lobbyActions(canCreate, restoreBtn) {
  const newBtn = el("button", {
    class: "btn primary", type: "button", disabled: !canCreate,
    onclick: () => { ui.create = true; render(); },
  }, "New wallet");
  if (state.groups.length) return [lockButton(), restoreBtn, newBtn];
  return Object.keys(secrets).length || vault ? [lockButton()] : [];
}

function walletRow(g) {
  if (g.unreadable) return unreadable();
  const seats = mySeatSecrets(g.id).length, n = toApprove(g.id).length, bal = balOf(g.id);
  const unread = newBadge(unreadIn(g.id));
  const status = g.movedTo ? el("span", { class: "badge plain" }, "Moved")
    : ready[g.id] === false ? el("span", { class: "badge info" }, "Setting up")
    : bal ? money(bal.total) : el("span", { class: "small faint" }, "Open to sync");
  return el("button", {
    class: "row-item", type: "button", "data-key": "wallet-row-" + g.id,
    onclick: () => { ui.tab = "overview"; openGroup(g.id); },
  },
  el("span", { class: "av lg" }, initials(g.name)),
  el("span", { class: "ri-main" }, el("span", { class: "ri-title" }, g.name),
    el("span", { class: "ri-sub" }, netOf(g).label + " · " + g.t + " of " + g.n
      + " signers must approve" + (seats ? "" : " · view only"))),
  el("span", { class: "ri-end" }, status,
    n ? el("span", { class: "badge warn" }, n + " to approve") : null, unread),
  el("span", { class: "chev" }, "›"));
}

function welcome(canCreate, restoreLink) {
  const steps = [
    ["Pick a rule", "For example, any 2 of 3 signers must approve each payment."],
    ["Invite your signers", "Send one private invite link. Each device creates its own key share."],
    ["Approve together", "A payment goes out only after enough signers approve. On chain it looks "
      + "like a shielded payment from a standard wallet."],
  ];
  const create = el("button", {
    class: "btn primary lg", type: "button", disabled: !canCreate,
    onclick: () => { ui.create = true; render(); },
  }, "Create wallet");
  return el("section", { class: "card card-pad welcome" },
    el("div", { style: "display:grid;gap:6px" }, el("h2", {}, "Create your first shared wallet"),
      el("p", { class: "muted" }, "Nobody ever holds the whole key, and nobody outside your team "
        + "can read the wallet.")),
    el("ol", { class: "how" }, steps.map(([t, d], i) => el("li", {},
      el("span", { class: "how-no" }, String(i + 1)),
      el("div", { style: "display:grid;gap:2px" }, el("h3", {}, t), el("p", { class: "small muted" }, d))))),
    el("div", { style: "display:flex;align-items:center;gap:12px;flex-wrap:wrap" },
      create, restoreLink));
}

// With `from`, the dialog creates the wallet that replaces `from`, with new signers or a new rule.
function createDialog(from = null) {
  const close = () => { ui.create = false; ui.move = false; render(); };
  const n0 = from ? from.n : 3, t0 = from ? from.t : 2;
  const rule = el("p", { class: "rule", id: "rule-text" }, ruleText(t0, n0));
  const update = () => {
    const n = Number(document.getElementById("g-n")?.value), t = Number(document.getElementById("g-t")?.value);
    const ok = n >= 2 && n <= 7 && t >= 2 && t <= n;
    rule.textContent = ok ? ruleText(t, n) : "Choose 2 to 7 signers, and at least 2 approvals but no more than the signers.";
    rule.classList.toggle("bad", !ok);
  };
  const f = el("form", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "create-title", oninput: update, onsubmit: act(async (ev) => {
    const fd = new FormData(ev.target); const n = Number(fd.get("n")), t = Number(fd.get("t"));
    if (!(n >= 2 && n <= 7)) throw new Error("A wallet needs between 2 and 7 signers.");
    if (t < 2 || t > n) throw new Error("Approvals needed must be at least 2 and at most the number of signers.");
    // A replacement wallet stays on its predecessor's network: funds cannot move between networks.
    const network = from ? from.network || "testnet" : ui.net;
    if (network === "mainnet" && !ui.ack) throw new Error("Confirm that you understand Zigs is not audited before you create a mainnet wallet.");
    ui.create = false; ui.move = false; ui.net = "testnet"; ui.ack = false;
    await createGroup(String(fd.get("name") || "").trim() || (from ? from.name : "Treasury"), n, t, from && from.id, network);
  }) },
    el("div", { class: "card-head" }, el("h2", { id: "create-title" }, from ? "Change signers" : "New shared wallet"), el("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: close }, "×")),
    from ? el("ol", { class: "small muted move-steps" },
      el("li", {}, "You create a new wallet with the signers and rule you want."),
      el("li", {}, "The new signers join it with an invite link."),
      el("li", {}, "This wallet sends all its funds to the new one. Like any payment, this needs " + from.t + " approvals.")) : null,
    nameField("my-name"),
    el("label", { class: "field" }, el("span", {}, from ? "New wallet name" : "Wallet name"), el("input", { class: "input", id: "g-name", name: "name", placeholder: from ? from.name : "Team treasury", maxlength: "40", autocomplete: "off" })),
    el("div", { class: "two" },
      el("label", { class: "field" }, el("span", {}, "Signers"), el("input", { class: "input", id: "g-n", name: "n", type: "number", min: "2", max: "7", value: String(n0) })),
      el("label", { class: "field" }, el("span", {}, "Approvals needed"), el("input", { class: "input", id: "g-t", name: "t", type: "number", min: "2", max: "7", value: String(t0) }))),
    rule,
    from ? null : networkPick(),
    el("div", { class: "callout" }, from
      ? "The new wallet gets a new address. Signers you leave out can still see this old wallet's payments, but not the new wallet's."
      : "You take seat 1. Then share the invite link with your signers. When every seat is taken, your devices create the wallet key together."),
    el("div", { class: "dialog-actions" },
      el("button", { class: "btn", type: "button", onclick: close }, "Cancel"),
      el("button", { class: "btn primary", type: "submit", disabled: !Z || !db || canWrite === false }, from ? "Create new wallet" : "Create wallet")));
  return f;
}

// ── Wallet ──
export function groupView() {
  const g = state.g;
  const back = el("button", {
    class: "btn ghost sm", type: "button", onclick: () => openGroup(null),
  }, "← Wallets");
  if (!g) return el("div", { class: "page" }, back, loadingView());
  if (g.unreadable) {
    return el("div", { class: "page" }, back, el("div", { class: "card" }, unreadable()));
  }
  if (!groupVersion()) {
    return el("div", { class: "page" }, back, el("div", { class: "callout bad", role: "alert" },
      "A newer version of Zigs made this wallet. This version cannot set it up. Reload the page "
      + "to get the newest version."));
  }
  if (signedMode(state.gid) && signing === false) {
    return el("div", { class: "page" }, back, el("div", { class: "callout bad", role: "alert" },
      NO_SIGNING_WALLET));
  }
  const ready = walletReady();
  const why = ready ? sendBlocker() : null;
  const head = [groupHead(g, ready, why), staleRestoreNote(), signedNotes(), networkNote()];
  return ready ? walletView(head, why) : el("div", { class: "page" }, head, setupView());
}

// A note for any wallet version: the store shows another network than the first this device saw.
const networkNote = () => state.g.networkMoved ? el("div", { class: "callout bad", role: "alert" },
  "The store shows another network than the first this browser saw. Zigs keeps the first. "
  + "Ask your signers.") : null;

const NO_SIGNING_WALLET = "This wallet needs signatures, and this browser cannot check them. "
  + "Use a current Chrome, Edge, Firefox or Safari.";

// Notes for a version 3 wallet: a seat of this browser that cannot sign, and ignored data.
function signedNotes() {
  if (!signedMode(state.gid)) return null;
  const mute = localSeats().filter((i) => !canWriteAs(i));
  const lost = mute.length ? el("div", { class: "callout bad", role: "alert" },
    "This browser has no signing key for seat " + mute.join(", ") + ", so it cannot write to "
    + "this wallet. Restore a backup of the seat.") : null;
  const moved = state.g.shapeMoved ? el("div", { class: "callout bad", role: "alert" },
    "The store shows another number of signers or approval rule than the first this browser saw. "
    + "Zigs keeps the first. Ask your signers.") : null;
  const ignored = state.ignored ? el("p", { class: "small faint" }, IGNORED_NOTE) : null;
  return lost || moved || ignored
    ? el("div", { style: "display:grid;gap:8px" }, lost, moved, ignored) : null;
}

export const walletReady = () => !!(state.wallet && state.wallet.birthday)
  && rejectedSeats().length === 0 && !keysDiffer();

export function walletView(head, why) {
  const unsaved = localSeats().filter((i) => {
    const s = sec(state.gid, i);
    return s.keyPackage && !seatBackedUp(s);
  });
  const tabs = [
    ["overview", "Overview"],
    ["activity", "Activity", countBadge(toApprove(state.gid).length, "to approve", "attn")],
    ["messages", "Messages", countBadge(unreadIn(state.gid), "unread", "note")],
    ["members", "Signers"], ["details", "Details"],
  ];
  const bodies = {
    overview: overviewTab, activity: activityTab, messages: messagesCard, members: membersTab,
    details: detailsTab,
  };
  if (solOn()) { tabs.push(["solana", "Solana"]); bodies.solana = solTab; }
  if (!Object.hasOwn(bodies, ui.tab)) ui.tab = "overview";
  return el("div", { class: "page" }, head, tabBar(tabs),
    unsaved.length ? backupNote(unsaved) : null,
    el("div", { role: "tabpanel", id: "panel-" + ui.tab, "aria-labelledby": "tab-" + ui.tab },
      bodies[ui.tab]()),
    el("div", { class: "action-bar" }, ...walletActions(why)));
}

function groupHead(g, ready, why) {
  const seated = seatIds().filter((i) => state.seats[i]).length;
  const old = state.groups.find((x) => x.id === g.movedFrom);
  return el("header", { class: "page-head" },
    el("div", { class: "ph-left" },
      el("button", { class: "btn ghost sm back", type: "button", onclick: () => openGroup(null) },
        "← Wallets"),
      el("h1", {}, g.name),
      el("div", { class: "ph-meta" },
        netBadge(g),
        el("span", { class: "badge plain", title: ruleText(g.t, g.n) },
          g.t + " of " + g.n + " signers must approve"),
        el("span", { class: "stack" }, seatIds().map((i) => avatar(i))),
        el("span", {}, seated + " of " + g.n + " signers joined"),
        g.movedFrom
          ? el("span", {}, "Replaces " + ((old || {}).name || "an older wallet")) : null)),
    ready ? el("div", { class: "ph-actions wallet-actions" }, ...walletActions(why)) : null);
}

// Arrow keys, Home and End move between tabs. Only the selected tab is in the Tab order.
export function tabBar(tabs) {
  const ids = tabs.map(([id]) => id), last = ids.length - 1, at = ids.indexOf(ui.tab);
  const target = {
    ArrowRight: at >= last ? 0 : at + 1, ArrowLeft: at <= 0 ? last : at - 1, Home: 0, End: last,
  };
  const onkeydown = (ev) => {
    if (!(ev.key in target)) return;
    ev.preventDefault();
    ui.tab = ids[target[ev.key]];
    focusAfter("tab-" + ui.tab, true);
    render();
  };
  const tab = ([id, label, badge]) => el("button", {
    class: "tab", type: "button", role: "tab", id: "tab-" + id, "data-key": "tab-" + id,
    "aria-selected": ui.tab === id ? "true" : "false",
    "aria-controls": ui.tab === id ? "panel-" + id : null,
    tabindex: ui.tab === id ? "0" : "-1", onclick: () => { ui.tab = id; render(); },
  }, label, badge);
  return el("div", { class: "tabs", role: "tablist", "aria-label": "Wallet sections", onkeydown },
    tabs.map(tab));
}
export function setTabBar(f) { tabBar = f; }

// Private windows, Tor Browser and cleared site data delete the key share with the browser data.
export function backupNote(seats) {
  const text = "Back up your key share. This browser can forget it: private windows and Tor "
    + "Browser delete it when they close. The file is locked with a passphrase that you choose. "
    + "Keep the file safe, and keep the passphrase apart from it. " + BACKUP_CHANGED;
  return el("div", { class: "callout warn", role: "status" },
    el("span", { style: "flex:1 1 16rem" }, text),
    seats.map((i) => el("button", {
      class: "btn sm", type: "button", onclick: () => openBackup(i),
    }, seats.length > 1 ? "Back up seat " + i : "Back up key share")));
}

// `why` is the reason Send is off, shown as text because touch screens have no tooltip.
function walletActions(why) {
  return [
    el("button", { class: "btn", type: "button", onclick: () => { ui.receive = true; render(); } }, "Receive"),
    el("button", {
      class: "btn primary", type: "button", disabled: !!why, title: why,
      onclick: () => {
        Object.assign(ui, { send: true, pay: null, note: "", priority: false, sendFor: null });
        render();
      },
    }, "Send"),
    why ? el("p", { class: "send-why" }, why) : null,
  ];
}

// ── Setup (key ceremony) ──
function setupView() {
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
      + "\"It matches\". Create a new wallet."),
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

function joinCard(seat) {
  const take = el("button", {
    class: "btn primary lg", type: "button", disabled: !Z || canWrite === false || state.pending,
    onclick: act(() => (usesV2(groupVersion()) || confirm(NOT_ZIP2005)) && takeSeat(seat)),
  }, "Take seat " + seat);
  return el("section", { class: "card card-pad hero-card" },
    el("div", { style: "display:grid;gap:4px" }, el("h2", {}, "Join " + state.g.name),
      el("p", { class: "small muted" }, "Zigs is a shared wallet for shielded Zcash. Any "
        + state.g.t + " of the " + state.g.n + " signers approve each payment. Take a seat to "
        + "become a signer. Your device creates its own key share. It never leaves this browser "
        + "unless you save a backup. Keep this page open until the wallet is ready.")),
    nameField("seat-name"),
    el("div", {}, take));
}

// The message carries the link, so it is as secret as the link.
const inviteMessage = (link) => "I made a shared wallet \"" + state.g.name + "\" on Zigs, a "
  + "private shared wallet for shielded Zcash. You are one of " + state.g.n + " signers, and "
  + state.g.t + " must approve each payment.\n\n1. Open this link on your phone or computer: "
  + link + "\n2. Take a seat.\n3. Keep the page open until the wallet is ready.\n\nThis link is "
  + "a secret. Do not post it in a public place. About Zigs: https://zigs.app";

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
    addrStage === "done" ? null : el("p", { class: "small muted" }, "Every signer must keep Zigs "
      + "open until setup finishes."),
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

// ── Overview ──
function overviewTab() {
  const c = curChain(), list = activity(), pend = toApprove(state.gid);
  return el("div", { class: "page", style: "gap:16px" },
    state.g.movedTo ? moveCard(c) : null,
    pend.length ? approvalsCard(pend) : null,
    el("div", { class: "grid-ov" }, balanceCard(c), receiveCard()),
    signersCard(),
    el("section", { class: "card" },
      el("div", { class: "card-head card-pad", style: "padding-bottom:12px" }, el("h2", {}, "Activity"),
        list.length > 6 ? el("button", { class: "btn ghost sm", type: "button", onclick: () => { ui.tab = "activity"; render(); } }, "View all") : null),
      activityRows(list.slice(0, 6))));
}

// The steps of a move, read from the old wallet: new wallet ready, payment proposed, funds gone.
export function moveState(c) {
  const to = state.g.movedTo;
  const ss = state.sessions.find((x) => x.move === to && !x.error && !expired(x));
  const b = c && c.bal ? balanceNow(c.bal) : null;
  if (!gkeys[to]) return { text: "A signer started moving this wallet to a new one. If you are one of its signers, ask them for its invite link." };
  if (!ready[to]) return { text: groupName(to) + " is still setting up. When its address is ready, move the funds here.", open: to };
  if (ss && !ss.broadcastTxid) return { text: "Moving the funds to " + groupName(to) + " is in progress. Open the payment to approve it or take the next step.", session: ss };
  if (ss && inFlight().includes(ss)) return { text: "The funds are on their way to " + groupName(to) + ". They arrive with the next block.", open: to };
  if (ss && b && b.spendable + b.pending === 0) return { text: "All funds moved to " + groupName(to) + ". This wallet is closed.", open: to, done: true };
  return { text: groupName(to) + " is ready. Move all funds to it. Like any payment, this needs " + state.g.t + " approvals.", propose: true };
}

function moveCard(c) {
  const m = moveState(c), why = m.propose ? sendBlocker() : null;
  const started = state.sessions.some((x) => x.move === state.g.movedTo && !x.error && !expired(x));
  return el("section", { class: "card card-pad " + (m.done ? "" : "attention") },
    el("div", { class: "card-head" }, el("h2", {}, m.done ? "This wallet moved" : "Changing signers"),
      m.done ? el("span", { class: "badge plain" }, "Closed") : null),
    el("p", { class: "small muted" }, m.text),
    el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" },
      m.propose ? el("button", { class: "btn primary", type: "button", disabled: !!why, title: why, onclick: act(proposeMove) }, "Move " + fmtZec(c && c.bal ? c.bal.max_send : 0)) : null,
      m.session ? el("button", { class: "btn primary", type: "button", onclick: () => openSession(m.session.id) }, "Open the payment") : null,
      m.open ? el("button", { class: "btn", type: "button", onclick: () => { ui.tab = "overview"; openGroup(m.open); } }, "Open " + groupName(m.open)) : null,
      !started ? el("button", { class: "btn ghost", type: "button", onclick: act(cancelMove) }, "Cancel move") : null),
    why ? el("p", { class: "small faint" }, why) : null);
}

function signersCard() {
  return el("section", { class: "card card-pad" },
    el("div", { class: "card-head" }, el("h2", {}, "Signers"),
      el("button", { class: "btn ghost sm", type: "button", onclick: () => { ui.tab = "members"; render(); } }, "Manage")),
    el("p", { class: "small muted" }, ruleText(state.g.t, state.g.n)),
    el("div", { class: "signer-list" }, seatIds().map((i) => el("span", { class: "signer" },
      avatar(i), el("span", { class: "small" }, named(i))))));
}

function approvalsCard(list) {
  return el("section", { class: "card attention" },
    el("div", { class: "card-head card-pad", style: "padding-bottom:12px" },
      el("h2", {}, list.length === 1 ? "A payment needs your approval" : list.length + " payments need your approval")),
    el("div", { class: "list" }, list.map((ss) => guard(approvalRow, ss))));
}

function approvalRow(ss) {
  return el("button", {
    class: "row-item", type: "button", "data-key": "pay-approve-" + ss.id,
    onclick: () => openSession(ss.id),
  },
  el("span", { class: "tx-ico out", "aria-hidden": "true" }, "↗"),
  el("span", { class: "ri-main" }, el("span", { class: "ri-title" }, payTitle(ss)),
    el("span", { class: "ri-sub" }, "Proposed by " + proposer(ss) + " · " + when(ss.createdAt))),
  el("span", { class: "ri-end" }, money(leavesOf(ss), "md", "out")),
  el("span", { class: "btn sm primary", "aria-hidden": "true" }, "Review"));
}

function balanceCard(c) {
  const b = c && c.bal ? balanceNow(c.bal) : null, empty = b && b.spendable + b.pending + b.sending === 0 && !state.g.movedTo;
  return el("section", { class: "card card-pad balance" },
    el("span", { class: "label" }, "Balance"),
    b ? money(b.spendable + b.pending, "xl")
      : el("span", { class: "skel xl", role: "img", "aria-label": "Loading balance" }),
    el("div", { class: "stats" },
      el("div", {}, el("span", { class: "label" }, "Available"), b ? money(b.spendable) : el("span", { class: "skel" })),
      el("div", {}, el("span", { class: "label" }, "Incoming"), b ? money(b.pending) : el("span", { class: "skel" }))),
    b && b.sending ? el("div", { class: "sending" }, el("span", { class: "dot busy" }), "Sending ", money(b.sending, "md", "out"), el("span", { class: "faint" }, " · waiting for a block")) : null,
    empty ? el("div", { class: "callout" }, curNet().faucet
      ? el("span", {}, "This wallet is empty. Share its address to receive ZEC, or get free testnet ZEC from a ",
        el("a", { href: curNet().faucet, target: "_blank", rel: "noopener" }, "faucet ↗"), ".")
      : el("span", {}, "This wallet is empty. Share its address to receive ZEC. Keep it under "
        + capText(curNet().cap) + ": the app warns at that level. It cannot block deposits."))
      : null,
    atCap() ? capNote() : null,
    syncLine(c));
}
const capNote = () => el("div", { class: "callout bad" },
  "This wallet holds " + capText(curNet().cap) + ", the warning level for unaudited mainnet "
  + "wallets. Do not send more to it. The app cannot block deposits. Payments out still work.");

const receiveWhat = () => curNet().cap ? "ZEC" : "testnet ZEC";
const receiveLimit = () => curNet().cap ? " Keep the total under " + capText(curNet().cap)
  + ". The app warns at that level and cannot block deposits." : "";

function receiveCard() {
  const w = state.wallet;
  return el("section", { class: "card card-pad" },
    el("div", { class: "card-head" }, el("h2", {}, "Receive"), el("span", { class: "badge ok plain" }, "Private address")),
    state.g.movedTo ? el("div", { class: "callout" }, "This wallet moved to " + groupName(state.g.movedTo) + ". Ask senders to use the new wallet's address.")
      : atCap() ? capNote()
      : el("p", { class: "small muted" }, "Share this address to receive " + receiveWhat()
        + ". Payments to it are shielded." + receiveLimit()),
    addrHidden() ? null : el("div", { class: "addr-box" }, el("span", { class: "hex" }, short(w.address, 18)), copyBtn(w.address)),
    el("p", { class: "small faint" }, verifiedCount() + " of " + state.g.n + " signers checked this address against their own key."));
}

function syncLine(c) {
  if (!c) return el("div", { class: "sync" }, el("span", {}, el("span", { class: "dot" }), "Sync starts after your seat checks the address."));
  const p = c.prog || c.bal;
  const span = p ? p.tip - c.birthday : 0;
  const pct = span > 0 ? Math.max(0, Math.min(100, ((p.height - c.birthday) / span) * 100)) : 0;
  const text = c.error ? "Sync failed" : c.syncing ? (c.prog ? "Syncing · " + Math.floor(pct) + "%" : "Connecting to the network…") : p ? "Up to date · block " + p.height.toLocaleString() : "Not synced";
  return el("div", { style: "display:grid;gap:8px" },
    c.syncing && c.prog ? el("div", { class: "progress" }, el("i", { style: "width:" + pct.toFixed(1) + "%" })) : null,
    el("div", { class: "sync" },
      el("span", {}, el("span", { class: "dot " + (c.error ? "bad" : c.syncing ? "busy" : "ok") }), text),
      el("button", { class: "btn ghost sm", type: "button", disabled: c.syncing, onclick: act(() => runSync(c)) }, c.syncing ? "Syncing…" : "Refresh")),
    c.error ? el("div", { class: "callout bad" }, c.error) : null);
}

// Received payments carry only a block height; estimate a time so they sort among proposals.
function activity() {
  const c = curChain(), tip = c && c.bal ? c.bal.height : 0;
  const sent = state.sessions.map((ss) => ({ t: ss.createdAt || 0, ss }));
  const net = netName(state.g);
  const got = (c && c.received || [])
    .map((r) => ({ t: Date.now() - spanMs(net, r.height, tip), r }));
  return [...sent, ...got].sort((a, b) => b.t - a.t);
}

function activityRows(list) {
  const line = "border-top:1px solid var(--line)";
  if (!list.length) {
    return el("div", { class: "empty", style: line }, el("h3", {}, "No activity yet"),
      el("p", { class: "small" },
        "Money you receive and payments your signers propose show up here."));
  }
  const rows = list.map((a) => guard(a.ss ? sentRow : receivedRow, a.ss || a.r));
  return el("div", { class: "list", style: line }, rows);
}

function sentRow(ss) {
  const chip = needsMyApproval(state.gid, ss) ? el("span", { class: "badge warn" }, "Your approval")
    : inFlight().includes(ss) ? el("span", { class: "badge info" }, "Confirming") : statusChip(ss);
  return el("button", {
    class: "row-item", type: "button", "data-key": "pay-" + ss.id,
    "aria-current": ss.id === state.sid ? "true" : "false", onclick: () => openSession(ss.id),
  },
  el("span", { class: "tx-ico out", "aria-hidden": "true" }, "↗"),
  el("span", { class: "ri-main" }, el("span", { class: "ri-title" }, payTitle(ss)),
    el("span", { class: "ri-sub" }, "Proposed by " + proposer(ss) + " · " + when(ss.createdAt))),
  el("span", { class: "ri-end" }, money(leavesOf(ss), "md", "out"), chip),
  el("span", { class: "chev" }, "›"));
}

// The memos of a received payment, for display. A memo that is not text says so.
export const ON_CHAIN = "On chain · shared with all signers";

function receivedRow(r) {
  const memos = memoTexts(r);
  return el("a", { class: "row-item", href: curNet().explorer + r.txid, target: "_blank", rel: "noopener", title: "View in explorer" },
    el("span", { class: "tx-ico in", "aria-hidden": "true" }, "↙"),
    el("span", { class: "ri-main" },
      el("span", { class: "ri-title" }, "Received"),
      el("span", { class: "ri-sub" }, "Block " + r.height.toLocaleString()),
      memos.map((m) => el("span", { class: "ri-memo" + (m === null ? " faint" : "") },
        m === null ? "Memo is not text" : m)),
      memos.length ? el("span", { class: "ri-sub" }, ON_CHAIN) : null,
      r.memo_pending && readsMemos(state.gid)
        ? el("span", { class: "ri-sub" }, "Memo not read yet") : null),
    el("span", { class: "ri-end" }, money(r.value, "md", "in"), el("span", { class: "badge " + (r.confirmed ? "ok" : "info") }, r.confirmed ? "Confirmed" : "Confirming")),
    el("span", { class: "chev" }, "↗"));
}

// ── Activity ──
function activityTab() {
  return el("section", { class: "card" }, el("div", { class: "card-head card-pad", style: "padding-bottom:12px" }, el("h2", {}, "All activity")), activityRows(activity()));
}

// ── Personal account: the home page ──
export function personalCard(pickRestore) {
  if (personalPending) {
    return el("section", { class: "card card-pad" }, el("h2", {}, "Personal account"),
      el("p", { class: "small faint" }, "Loading the saved account…"));
  }
  if (personalError) return damagedCard();
  return personal ? accountCard() : createCard(pickRestore);
}

// A saved account that does not read. The record stays as it is. If it still holds a seed, the
// person can save a backup of what reads, or remove it and start again.
export function damagedCard() {
  const canSave = !!personalDamaged && !!salvageBackup(personalDamaged, personalEnv());
  return el("section", { class: "card card-pad" }, el("h2", {}, "Personal account"),
    el("div", { class: "callout bad", role: "alert" }, personalError),
    canSave ? el("p", { class: "small muted" }, "Back up account saves the seed and the "
      + "contacts that Zigs can read.") : null,
    personalDamaged ? accountActions(DAMAGED_WARNING, canSave) : null);
}

function createCard(pickRestore) {
  const p = ui.personal;
  return el("section", { class: "card card-pad" },
    el("div", { class: "card-head" }, el("h2", {}, "Personal account"),
      el("span", { class: "badge plain" }, "Optional")),
    el("p", { class: "small muted" }, "Write to anyone who has a shielded Zcash address, also if "
      + "they do not use Zigs. A message is a small payment on chain, and this account pays its "
      + "fee. The account is apart from your wallets, and the group server never sees it."),
    networkPick(p, "account", "p"),
    el("div", { class: "callout" }, "Keep only a few cents here. Whoever controls this browser can "
      + "spend the account. Make a backup file right after you create it."),
    el("div", { class: "dialog-actions" },
      el("button", { class: "btn", type: "button", onclick: pickRestore }, "Restore from backup"),
      el("button", {
        class: "btn primary", type: "button", disabled: !Z,
        onclick: act(() => createPersonal(p.net)),
      }, "Create account")));
}

function accountBalanceBlock(b) {
  const money2 = (zat) => (b ? money(zat) : skeleton());
  return el("div", { style: "display:grid;gap:10px" },
    el("span", { class: "label" }, "Balance"), b ? money(b.total, "xl") : skeleton("xl"),
    el("div", { class: "stats" },
      el("div", {}, el("span", { class: "label" }, "Available"), money2(b && b.spendable)),
      el("div", {}, el("span", { class: "label" }, "Incoming"), money2(b && b.pending))),
    flightNow().length ? el("div", { class: "sending" }, el("span", { class: "dot busy" }),
      "A message is waiting for its block") : null);
}

export function accountCard() {
  const c = acct, b = acctBalance();
  return el("section", { class: "card card-pad" },
    el("div", { class: "card-head" }, el("h2", {}, "Personal account"),
      netBadge({ network: personal.network })),
    el("p", { class: "small muted" }, "This account pays the fee of your messages on chain. It is "
      + "not a wallet and it has no signers. Whoever controls this browser can spend it."),
    personal.backedUp ? null : accountBackupNote(),
    accountBalanceBlock(b),
    b ? balanceWarnings(b.total).map((t) => el("div", { class: "callout warn", role: "status" }, t))
      : null,
    c ? syncLine(c) : el("p", { class: "small faint" }, NOT_READY),
    c ? addressBlock(c) : null,
    c ? fundBlock() : null,
    accountActions(removeWarning(personal)),
    otherMessages());
}

function accountBackupNote() {
  return el("div", { class: "callout warn", role: "status" },
    el("span", { style: "flex:1 1 16rem" }, "Back up the account. This browser can forget it: "
      + "private windows and Tor Browser delete it when they close. The file holds the seed and "
      + "your contacts. A passphrase that you choose locks it."),
    el("button", { class: "btn sm", type: "button", onclick: openAccountBackup },
      "Back up account"));
}

export function addressBlock(c) {
  const why = acctAddressWhy();
  if (why) return el("div", { class: "callout" + (acctBalance() ? " bad" : "") }, why);
  return el("div", { style: "display:grid;gap:8px" },
    el("span", { class: "label" }, "Public address"),
    el("div", { class: "addr-box" }, el("span", { class: "hex" }, short(c.address, 18)),
      copyBtn(c.address)),
    el("details", { class: "qr-toggle" }, el("summary", {}, "Show QR code"),
      qrBox(c.address, "Account address")),
    el("p", { class: "small faint" }, "Anyone who has this address can pay it and write to it. "
      + "A message that reaches it shows under Other messages, marked not verified. Give each "
      + "contact their own address instead."));
}

// The request pays 3 notes, so the account can send a message after each block.
export function fundBlock() {
  if (acctAddressWhy()) return null;
  const b = acctBalance();
  const wallets = proposeWallets(REQUEST_NET[personal.network]);
  const pick = wallets.length > 1 ? el("select", {
    class: "input", id: "fund-wallet", "aria-label": "Fund from wallet",
  }, wallets.map((g) => el("option", { value: g.id },
    g.name + " (" + netOf(g).label + ")"))) : null;
  // The warning follows the typing, as the fee line of the composer does.
  const warn = el("span", { class: "hint bad", id: "fund-warn", role: "status" });
  const showWarn = () => {
    warn.textContent = fundingWarning(toZat(ui.personal.fund), b ? b.total : 0);
  };
  const amount = el("input", {
    class: "input", id: "fund-amt", type: "text", inputmode: "decimal", autocomplete: "off",
    value: ui.personal.fund, "aria-describedby": "fund-hint fund-warn",
    oninput: (ev) => { ui.personal.fund = ev.target.value; showWarn(); },
  });
  showWarn();
  return el("div", { class: "to-box", style: "display:grid;gap:10px" },
    el("span", { class: "label" }, "Fund the account"),
    el("label", { class: "field" }, el("span", {}, "Amount in ZEC"), amount,
      el("span", { class: "hint", id: "fund-hint" }, "The request asks for 3 equal notes, so the "
        + "account can send a message after each block. A wallet pays it, and its signers "
        + "approve it as they approve any payment."), warn),
    el("div", { class: "req-actions" }, pick,
      el("button", {
        class: "btn primary sm", type: "button", disabled: !wallets.length,
        onclick: act(() => fundFromWallet(pick ? pick.value : wallets[0].id)),
      }, "Fund from a wallet"),
      el("button", { class: "btn sm", type: "button", onclick: act(copyFundingRequest) },
        "Copy request")),
    wallets.length ? null : el("p", { class: "small faint" }, "You hold no seat in a "
      + personal.network + " wallet. Copy the request and pay it from any wallet."));
}

const DAMAGED_WARNING = "This account does not read. Make a backup first if you want to keep it.";

// The backup and remove buttons. `warning` adds a sentence to the question before a removal.
function accountActions(warning, canSave = true) {
  const ask = (on) => () => { ui.personal.drop = on; render(); };
  const sure = ui.personal.drop;
  return el("div", { style: "display:grid;gap:10px" },
    el("div", { class: "row-actions" },
      canSave ? el("button", { class: "btn sm", type: "button", onclick: openAccountBackup },
        "Back up account") : null,
      sure ? null : el("button", { class: "btn ghost sm", type: "button", onclick: ask(true) },
        "Remove from this browser")),
    sure ? el("div", { class: "callout bad", role: "alert" },
      el("p", {}, "Remove the account from this browser? The seed is deleted. Only a backup file "
        + "brings the account back." + (warning ? " " + warning : "")),
      el("div", { class: "dialog-actions" },
        el("button", { class: "btn", type: "button", onclick: ask(false) }, "Cancel"),
        el("button", { class: "btn", type: "button", onclick: act(removeAccount) },
          "Remove the account"))) : null);
}

// Messages to the public address, or to an address that no contact has. Nobody can say who wrote
// them, so the page marks them not verified.
export function otherMessages() {
  const items = accountInbox().other;
  if (!items.length) return null;
  const rows = chatTimeline(items, [], blockTime).slice(-50);
  return el("details", {}, el("summary", {}, "Other messages (not verified)"),
    el("p", { class: "small muted" }, items.length + " in all. Anyone who knows an address of "
      + "this account can write to it."),
    el("div", { class: "chat-log" }, rows.map((r) =>
      guard(receivedBubble, r, "Unknown sender", "Not verified", otherWhere(r.index)))));
}

// ── Personal account: contacts ──
export function contactsCard() {
  if (!personal) return null;
  const list = personal.contacts;
  return el("section", { class: "card" },
    el("div", { class: "card-head card-pad", style: "padding-bottom:12px" },
      el("h2", {}, "Contacts on chain"),
      el("button", { class: "btn sm", type: "button", onclick: openContactDialog }, "Add contact")),
    list.length ? el("div", { class: "list", style: "border-top:1px solid var(--line)" },
      list.map((c) => guard(contactRow, c)))
      : el("p", { class: "small muted card-pad" }, "Add the address of a person. You can then "
        + "write to them on chain, also if they do not use Zigs."));
}

export function openContactDialog() {
  ui.contactAdd = true;
  render();
}

function contactRow(c) {
  const name = memoShown(c.name), n = (accountInbox().chats.get(c.index) || []).length;
  return el("button", {
    class: "row-item", type: "button", "data-key": "contact-row-" + c.index,
    onclick: () => openContact(c.index),
  },
  el("span", { class: "av lg" }, initials(name)),
  el("span", { class: "ri-main" }, el("span", { class: "ri-title" }, name),
    el("span", { class: "ri-sub" }, "On chain · " + (n === 1 ? "1 message" : n + " messages"))),
  el("span", { class: "ri-end" }), el("span", { class: "chev" }, "›"));
}

function contactItem(c) {
  const here = state.contact === c.index, name = memoShown(c.name);
  return el("button", {
    class: "side-item" + (here ? " active" : ""), type: "button",
    "aria-current": here ? "page" : null, "data-key": "contact-" + c.index,
    onclick: () => openContact(c.index),
  }, el("span", { class: "av" }, initials(name)), el("span", { class: "side-name" }, name));
}

export function contactDialog() {
  const close = () => { ui.contactAdd = false; render(); };
  const net = NETWORKS[personal.network];
  return el("form", {
    class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "contact-title",
    onsubmit: act(async (ev) => {
      const fd = new FormData(ev.target);
      const made = await addPersonalContact(String(fd.get("name") || ""),
        String(fd.get("address") || ""));
      ui.contactAdd = false;
      openContact(made.index);
    }),
  },
  el("div", { class: "card-head" }, el("h2", { id: "contact-title" }, "Add a contact"),
    el("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: close },
      "×")),
  el("label", { class: "field" }, el("span", {}, "Name"), el("input", {
    class: "input", id: "oc-name", name: "name", maxlength: String(NAME_MAX), autocomplete: "off",
    required: true,
  }), el("span", { class: "hint" }, "Only you see this name.")),
  el("label", { class: "field" }, el("span", {}, "Shielded address"), el("input", {
    class: "input mono", id: "oc-addr", name: "address", placeholder: net.prefix + "…",
    autocomplete: "off", spellcheck: "false", required: true,
  })),
  el("div", { class: "callout" }, "Next, Zigs shows an address for this contact. Give it to them. "
    + "A message to that address shows in this chat."),
  el("div", { class: "dialog-actions" },
    el("button", { class: "btn", type: "button", onclick: close }, "Cancel"),
    el("button", { class: "btn primary", type: "submit", disabled: !Z || !acct }, "Add contact")));
}

// ── Personal account: a chat with a contact ──
const ON_CHAIN_FINE = "The message is a payment of no value, and your text is its memo. It is "
  + "permanent, and only the memo encryption of Zcash protects its text. Sending takes about a "
  + "minute, because this browser builds a proof. A wallet that hides payments of no value does "
  + "not show it.";
const ON_CHAIN_LIMITS = "This browser keeps the text of the messages that you sent. It is not in "
  + "the backup file. Private windows and Tor Browser forget it when they close.";

export function contactView() {
  const contact = personal && personal.contacts.find((c) => c.index === state.contact);
  if (!contact) return lobby();
  const name = memoShown(contact.name);
  return el("div", { class: "page" },
    el("header", { class: "page-head" }, el("div", { class: "ph-left" },
      el("button", {
        class: "btn ghost sm back", type: "button",
        onclick: () => { state.contact = null; render(); },
      }, "← Wallets"),
      el("h1", {}, name),
      el("div", { class: "ph-meta" },
        el("span", { class: "badge plain" }, "On chain · Zcash memos")))),
    contactAddress(contact, name),
    contactMessages(contact, name));
}

function contactAddress(contact, name) {
  const why = acct ? acctAddressWhy() : NOT_READY;
  if (why) return el("div", { class: "callout" }, why);
  const address = addressFor(contact.index);
  return el("section", { class: "card card-pad hero-card" },
    el("div", { class: "card-head" }, el("h2", {}, "Your address for " + name)),
    el("p", { class: "small muted" }, "Give this address to " + name + ". A message that reaches "
      + "it shows in this chat, marked as sent to the address you gave " + name + ". Anyone who "
      + "knows the address can write here."),
    el("div", { class: "addr-box" }, el("span", { class: "hex nowrap" }, address),
      copyBtn(address, "Copy address", "btn sm primary")),
    el("details", { class: "qr-toggle" }, el("summary", {}, "Show QR code"),
      qrBox(address, "Address for " + name)));
}

function contactMessages(contact, name) {
  const items = contactRows(contact).map((r) => guard(onChainRow, r, name));
  const none = el("p", { class: "small faint" }, "No messages yet. A message to the address above "
    + "shows here after the next block.");
  return el("section", { class: "card card-pad chat" },
    el("div", { class: "card-head" }, el("h2", {}, "Messages")),
    logBox("log-oc-" + contact.index, "Messages with " + name, items, none),
    composer({
      kind: "oc-" + contact.index, why: messageWhy(), seats: [], to: "Message to " + name,
      fine: ON_CHAIN_FINE, label: "Send on chain", key: "chat:personal:" + contact.index,
      send: (text) => sendOnChain(contact, text), plan: (text) => messagePlan(text, splitParts),
      progress: acct ? acct.progress : "",
    }),
    el("p", { class: "small faint" }, ON_CHAIN_LIMITS));
}

function onChainRow(row, name) {
  if (row.dir === "out") return sentBubble(row);
  return receivedBubble(row, name, "On chain · sent to the address you gave " + name, "");
}

// The text of a message from the chain, already through memoShown. A whole text that is a payment
// request shows as a card with the verdict "memo".
function memoBodyOf(key, text) {
  const req = requestOf(text, true, personal.network);
  if (!req) return el("p", { class: "msg-text" }, text);
  return requestCard(req, { id: key, name: "a memo", verdict: "memo", dm: true });
}

// A message from the chain, as the contact's chat and the other messages show it.
function receivedBubble(row, name, label, where) {
  const body = row.text === null ? el("p", { class: "msg-text faint" }, "Memo is not text")
    : memoBodyOf(row.key, memoShown(row.text));
  return el("div", { class: "msg" },
    el("span", { class: "av round", title: name }, initials(name)),
    el("div", { class: "msg-body" },
      el("div", { class: "msg-head" }, el("b", {}, name), el("time", {}, when(row.at)),
        el("span", { class: "vmark" + (label === "Not verified" ? " bad" : "") }, label)),
      body, where ? el("span", { class: "small faint" }, where) : null,
      row.parts > 1 ? el("span", { class: "small faint" }, "Joined from " + row.parts + " parts")
        : null,
      el("a", {
        class: "small", href: NETWORKS[personal.network].explorer + row.txid, target: "_blank",
        rel: "noopener",
      }, "View transaction ↗")));
}

function sentBubble(rec) {
  const st = sentStateOf(rec), note = sentNote(rec, st);
  const cls = st === "chain" ? " ok" : holdsNotes(st) ? "" : " bad";
  return el("div", { class: "msg" },
    el("span", { class: "av round me", title: "You" }, "Y"),
    el("div", { class: "msg-body" },
      el("div", { class: "msg-head" }, el("b", {}, "You"), el("time", {}, when(rec.at)),
        el("span", { class: "vmark" + cls }, SENT_WORDS[st])),
      el("p", { class: "msg-text" }, memoShown(rec.text)),
      el("span", { class: "small faint" }, "Fee " + zatText(rec.fee) + " ZEC"
        + (rec.parts > 1 ? " · " + rec.parts + " parts" : "")),
      note ? el("span", { class: "small faint" }, note) : null,
      st === "chain" ? el("a", {
        class: "small", href: NETWORKS[personal.network].explorer + rec.txid, target: "_blank",
        rel: "noopener",
      }, "View transaction ↗") : null));
}

// ── Members ──
function membersTab() {
  return el("div", { class: "page", style: "gap:16px" },
    el("section", { class: "card" },
      el("div", { class: "card-pad", style: "padding-bottom:14px" }, el("div", { class: "card-head" }, el("h2", {}, "Signers"), el("span", { class: "small muted" }, ruleText(state.g.t, state.g.n)))),
      el("div", { style: "border-top:1px solid var(--line)" },
        seatIds().map((i) => guard(memberRow, i)))),
    changeSignersCard(),
    el("section", { class: "card card-pad" },
      el("h2", { style: "font-size:15px" }, "Invite link"),
      el("p", { class: "small muted" }, "Signers open this wallet on another device with this "
        + "invite link and their key share backup. The link contains the wallet secret, so share "
        + "it only with signers."),
      el("div", { class: "addr-box" }, el("span", { class: "hex nowrap" }, inviteLink(state.gid)), copyBtn(inviteLink(state.gid), "Copy link")),
      secretQr(inviteLink(state.gid))));
}

// FROST fixes the signers when the key is made, so a change means a new wallet and one payment.
function changeSignersCard() {
  const moving = !!state.g.movedTo;
  return el("section", { class: "card card-pad" },
    el("h2", { style: "font-size:15px" }, "Add or remove signers"),
    el("p", { class: "small muted" }, "The signers and the approval rule are part of the wallet key, so they cannot change in place. "
      + "To change them, create a new wallet with the signers you want, then move the funds to it."),
    el("div", {}, moving
      ? el("button", { class: "btn", type: "button", onclick: () => { ui.tab = "overview"; render(); } }, "See the move")
      : el("button", { class: "btn", type: "button", disabled: !localSeats().length, onclick: () => { ui.move = true; render(); } }, "Change signers")));
}

function seatBadge(i) {
  const v = seatCheck(i);
  if (v === null) return el("span", { class: "badge" }, STAGE_LABEL[seatStage(i)]);
  const text = v ? "Address checked" : "Rejected address";
  return el("span", { class: "badge " + (v ? "ok" : "bad") }, text);
}

const keyBackupButton = (i) => el("button", {
  class: "btn sm", type: "button", onclick: () => openBackup(i),
}, "Back up key share");

function memberRow(i) {
  const s = state.seats[i], mine = s && seatMine(i) && sec(state.gid, i);
  const title = el("span", { class: "ri-title" }, seatTitle(i, s),
    mine ? el("span", { class: "you" }, "You") : null);
  const sub = el("span", { class: "ri-sub" }, "Seat " + i + (s ? " · joined " + when(s.at) : ""));
  const backup = mine && sec(state.gid, i).keyPackage ? keyBackupButton(i) : null;
  return el("div", { class: "member" }, avatar(i, "lg"), el("div", { class: "ri-main" }, title, sub),
    el("div", { class: "m-actions" }, seatBadge(i), backup));
}

// ── Details ──
function detailsTab() {
  return el("div", { class: "page", style: "gap:16px" }, walletFacts(), privacyCard());
}

function checkedBadge() {
  const rejected = rejectedSeats(), ver = verifiedCount(), n = state.g.n;
  if (rejected.length) {
    const text = "Seat " + rejected.join(", ") + " rejected this wallet";
    return el("span", { class: "badge bad" }, text);
  }
  return el("span", { class: "badge " + (ver === n ? "ok" : "") }, ver + " of " + n + " signers");
}

function walletFacts() {
  const w = state.wallet, net = curNet();
  const address = addrHidden()
    ? el("dd", {}, "Shown after your seat checks it against your key share.")
    : el("dd", {}, el("div", { class: "addr-full" }, addrGroups(w.address)),
      el("div", { style: "margin-top:8px" }, copyBtn(w.address, "Copy address")));
  return el("section", { class: "card card-pad" },
    el("h2", { style: "font-size:15px" }, "Wallet"),
    el("dl", { class: "kv" },
      el("dt", {}, "Address"), address,
      el("dt", {}, "Approval rule"),
      el("dd", {}, "Any " + state.g.t + " of " + state.g.n + " signers"),
      el("dt", {}, "Checked by"), el("dd", {}, checkedBadge()),
      el("dt", {}, "Network"), el("dd", {}, "Zcash " + net.label.toLowerCase()
        + (net.cap ? " · warning at " + capText(net.cap) : "")),
      el("dt", {}, "Created at block"), el("dd", { class: "mono" }, fmtInt(w.birthday)),
      el("dt", {}, "Wallet key"), el("dd", { class: "hex" }, w.group_verifying_key),
      usesV2(groupVersion()) ? [el("dt", {}, "Key setup"),
        el("dd", {}, "Built to ZIP 2005 (Proposed) so that funds can be recovered if quantum "
          + "computers break today's keys.")] : null,
      signedMode(state.gid) ? [el("dt", {}, "Signed writes"), el("dd", {}, "Each signer signs the "
        + "data it writes to this wallet. Zigs ignores data without a valid signature.")] : null),
    groupVersion() === 1 ? el("p", { class: "small muted", style: "margin-top:12px" },
      "This wallet was made before quantum recoverability (ZIP 2005). To get it, move the funds "
      + "to a new wallet with Change signers.") : null);
}

function privacyCard() {
  const w = state.wallet;
  const host = chain && chain.url ? new URL(chain.url).host : "a light-wallet server";
  return el("section", { class: "card card-pad" },
    el("h2", { style: "font-size:15px" }, "Privacy and keys"),
    el("p", { class: "small muted" }, "Your key share is created and used in this browser. "
      + "It leaves this browser only if you save a backup. The group server stores encrypted "
      + "data it cannot read. This page downloads blocks from " + host
      + ", which sees your IP address but never a key. The wallet syncs again on every load."),
    memoSwitch(host),
    el("details", {}, el("summary", {}, "Viewing key"),
      el("div", { class: "addr-full", style: "margin-top:10px" }, w.ufvk),
      el("div", { style: "margin-top:8px" }, copyBtn(w.ufvk, "Copy viewing key"))),
    el("p", { class: "small faint" }, "The viewing key shows every payment of this wallet. "
      + "Share it only with people who may see your balance."),
    activityLog());
}

// The setting that lets this browser read memos. It names the leak: the light-wallet server learns
// which transactions pay this wallet.
function memoSwitch(host) {
  const gid = state.gid, on = readsMemos(gid);
  return el("div", { class: "memo-switch" },
    el("p", { class: "small muted" }, "A memo is only in the full transaction. To read it, this "
      + "browser asks " + host + " for each transaction that pays this wallet. That server then "
      + "learns which transactions pay this wallet, and it sees your IP address. This setting "
      + "is for this browser and this wallet. It is off until you turn it on. Memos that were "
      + "read stay after you turn it off."),
    el("button", {
      class: "btn sm", type: "button", "aria-pressed": on ? "true" : "false",
      onclick: act(() => setMemoReading(gid, !on)),
    }, on ? "Reading memos: on" : "Read memos of incoming payments"));
}

function activityLog() {
  if (!state.log.length) return null;
  return el("details", {}, el("summary", {}, "Activity in this browser"),
    el("div", { class: "log" }, state.log.join("\n")));
}

// ── Receive ──
function receiveDialog() {
  const w = state.wallet, hidden = addrHidden();
  const close = el("button", {
    class: "icon-btn", type: "button", "aria-label": "Close",
    onclick: () => { ui.receive = false; render(); },
  }, "×");
  const faucet = curNet().faucet
    ? el("a", { class: "btn ghost", href: curNet().faucet, target: "_blank", rel: "noopener" },
      "Get testnet ZEC ↗") : el("span");
  return el("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "recv-title" },
    el("div", { class: "card-head" }, el("h2", { id: "recv-title" }, "Receive ZEC"), close),
    atCap() ? capNote() : el("p", { class: "small muted" }, "Send " + receiveWhat()
      + " to this shielded address. Senders and the network cannot see the balance or who "
      + "controls it." + receiveLimit()),
    hidden ? null : qrBox(w.address, "Wallet address"),
    hidden ? null : el("div", { class: "addr-full" }, addrGroups(w.address)),
    el("div", { class: "dialog-actions", style: "justify-content:space-between" },
      faucet, hidden ? null : copyBtn(w.address, "Copy address", "btn primary")));
}

// ── Send ──
function addressHint(hint, to) {
  const v = to.trim(), ok = v ? onNetwork(v) : null, net = curNet().label.toLowerCase();
  hint.textContent = !v ? "" : ok ? "Valid " + net + " address"
    : "Not a shielded Zcash " + net + " address. It starts with " + curNet().prefix + ".";
  hint.className = "hint " + (!v ? "" : ok ? "ok" : "bad");
}

function payRow(r, i, rows, sumUp) {
  const c = curChain(), hint = el("span", { class: "hint" }), n = rows.length > 1 ? " " + (i + 1) : "";
  const amt = el("input", { class: "input", id: "s-amt-" + r.k, type: "text", inputmode: "decimal", placeholder: "0.00", required: true, autocomplete: "off", "aria-label": "Amount" + n, value: r.amt, oninput: (ev) => { r.amt = ev.target.value.trim(); sumUp(); } });
  const max = () => { r.amt = zatText(Math.max(0, c && c.bal ? c.bal.max_send : 0)); amt.value = r.amt; sumUp(); };
  addressHint(hint, r.to);
  return el("div", { class: "pay-row" },
    el("input", {
      class: "input mono", id: "s-to-" + r.k, type: "text", placeholder: curNet().prefix + "…",
      required: true, autocomplete: "off", spellcheck: "false",
      "aria-label": "Recipient address" + n, value: r.to,
      oninput: (ev) => {
        r.to = ev.target.value;
        fillFromRequest(r, rows, hint) || addressHint(hint, r.to);
      },
    }),
    el("div", { class: "input-wrap" }, amt, rows.length === 1 ? el("button", { class: "btn sm", type: "button", onclick: max }, "Max") : null),
    rows.length > 1 ? el("button", { class: "icon-btn", type: "button", "aria-label": "Remove recipient" + n, onclick: () => { rows.splice(i, 1); render(); } }, "×") : null,
    hint, memoBox(r, n));
}

// Shows the bytes of a memo once it comes near the limit, and says why a memo cannot be sent.
const MEMO_NEAR = 400;
function memoHint(hint, memo) {
  const bad = memoError(memo), bytes = memoBytes(memo);
  hint.textContent = bad || (bytes >= MEMO_NEAR ? bytes + " of " + MEMO_BYTES + " bytes" : "");
  hint.className = "hint" + (bad ? " bad" : "");
}

// The optional memo of one recipient.
function memoBox(r, n) {
  const hint = el("span", { class: "hint" });
  memoHint(hint, r.memo);
  return el("div", { class: "memo-row" },
    el("input", {
      class: "input", id: "s-memo-" + r.k, type: "text", placeholder: "Memo (optional)",
      autocomplete: "off", "aria-label": "Memo" + n + " (optional)", value: r.memo,
      oninput: (ev) => { r.memo = ev.target.value; memoHint(hint, r.memo); },
    }),
    hint);
}

// A whole request pasted in a recipient field replaces that row with the rows of its payees. It
// returns true when the field holds a request. The rows get new keys, so the redraw does not read
// the pasted text again.
export function fillFromRequest(r, rows, hint) {
  const req = requestOf(r.to, false);
  if (!req) return false;
  const fresh = req.payees ? payeeRows(req.payees, () => ++ui.payKey) : [];
  const tooMany = rows.length - 1 + fresh.length > MAX_PAYEES;
  const error = req.error ? requestProblem(req.error) : tooMany ? TOO_MANY : "";
  if (error) { hint.textContent = error; hint.className = "hint bad"; return true; }
  rows.splice(rows.indexOf(r), 1, ...fresh);
  render();
  return true;
}

// The rows and the errors of the "Paste a list" box: a whole request, or lines of address, amount
// and memo.
function pastedList(text) {
  const req = requestOf(text, false);
  if (!req) return parsePayeeList(text);
  if (req.error) return { rows: [], errors: [requestProblem(req.error)] };
  return { rows: req.payees, errors: [] };
}

function listProblem(rows, errors) {
  if (errors[0]) return errors[0];
  if (!rows.length) return "Paste at least one line.";
  return rows.length > MAX_PAYEES ? TOO_MANY : "";
}

function useList() {
  const box = document.getElementById("s-list"), { rows, errors } = pastedList(box.value);
  ui.listError = listProblem(rows, errors);
  if (!ui.listError) {
    ui.pay = payeeRows(rows, () => ++ui.payKey);
    box.value = ""; box.closest("details").open = false;
  }
  render();
}

// Checks each row and returns the payees in zatoshis, or throws with the row number.
function readPayees(rows) {
  const net = curNet(), own = normalized(state.wallet.address);
  return rows.map((r, i) => {
    const to = r.to.trim(), amount = toZat(r.amt), who = rows.length > 1 ? "Recipient " + (i + 1) + ": " : "";
    const memo = String(r.memo || "").trim();
    if (!onNetwork(to)) throw new Error(who + "Enter a shielded Zcash " + net.label.toLowerCase() + " address. It starts with " + net.prefix + ".");
    if (normalized(to) === own) throw new Error(who + "This is the address of this wallet. Enter the address of someone else.");
    if (!amount) throw new Error(who + "Enter an amount greater than zero, with at most 8 decimals.");
    if (memoError(memo)) throw new Error(who + memoError(memo));
    return memo ? { to, amount, memo } : { to, amount };
  });
}

function pasteList(net) {
  return el("details", { class: "paste" }, el("summary", { class: "btn sm" }, "Paste a list"),
    el("textarea", {
      class: "input mono", id: "s-list", rows: "5", spellcheck: "false",
      "aria-label": "Payment list",
      placeholder: net.prefix + "…, 0.5, October rent\n" + net.prefix + "…, 1.25",
    }),
    el("span", { class: "hint" },
      "One address and amount per line, then an optional memo. A spreadsheet copy works. "
      + "A payment request (zcash:) works too."),
    ui.listError ? el("span", { class: "hint bad" }, ui.listError) : null,
    el("button", { class: "btn sm", type: "button", onclick: useList }, "Use this list"));
}

export function sendDialog() {
  const c = curChain(), bal = c && c.bal, spendable = bal ? bal.spendable : 0, net = curNet();
  if (!ui.pay) { ui.pay = [{ k: ++ui.payKey, to: "", amt: "", memo: "" }]; ui.listError = ""; }
  const rows = ui.pay;
  const fee = el("span", {}), total = el("span", { id: "s-total" });
  const sumUp = () => {
    const f = feeEstimate(rows.length, ui.priority);
    fee.replaceChildren(money(f));
    total.replaceChildren(money(rows.reduce((n, r) => n + (toZat(r.amt) || 0), 0) + f));
  };
  const why = sendBlocker();
  const f = el("form", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "send-title", onsubmit: act(async (ev) => {
    if (why) throw new Error(why);
    const payees = readPayees(rows);
    const need = payees.reduce((n, p) => n + p.amount, 0) + feeEstimate(payees.length, ui.priority);
    if (need > spendable) throw new Error("Not enough funds: " + fmtZec(spendable) + " available, " + fmtZec(need) + " needed (amounts + fee).");
    const note = String(new FormData(ev.target).get("note") || "").trim();
    await newSpend(payees, note, null, ui.priority);
    ui.send = false;
  }) },
    el("div", { class: "card-head" }, el("h2", { id: "send-title" }, "Send ZEC"), el("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: () => { ui.send = false; render(); } }, "×")),
    el("div", { class: "field" }, el("span", {}, rows.length > 1 ? rows.length + " recipients, one transaction" : "To and amount"),
      rows.map((r, i) => payRow(r, i, rows, sumUp)),
      el("div", { class: "row-actions" },
        el("button", {
          class: "btn sm", type: "button", disabled: rows.length >= MAX_PAYEES,
          onclick: () => { rows.push({ k: ++ui.payKey, to: "", amt: "", memo: "" }); render(); },
        }, "Add recipient"),
        pasteList(net))),
    el("label", { class: "field" }, el("span", {}, "Note for signers (optional)"),
      el("input", {
        class: "input", id: "s-note", name: "note", type: "text", maxlength: "80",
        placeholder: rows.length > 1 ? "October payroll" : "Pay the audit firm",
        autocomplete: "off", value: ui.note, oninput: (ev) => { ui.note = ev.target.value; },
      }),
      el("span", { class: "hint" }, "Encrypted. Only signers of this wallet can read it.")),
    el("p", { class: "small faint" }, "A memo goes on chain with the payment. Its recipient and "
      + "every signer of this wallet can read it."),
    priorityBox(sumUp),
    el("div", { class: "summary" },
      el("div", {}, el("span", { class: "muted" }, "Available"), money(spendable)),
      el("div", {}, el("span", { class: "muted" }, "Network fee (estimate)"), fee),
      el("div", { class: "total" }, el("span", {}, "Total leaving the wallet"), total),
      el("div", {}, el("span", { class: "muted" }, "Approvals needed"), el("span", {}, state.g.t + " of " + state.g.n))),
    el("p", { class: "small faint" }, EXPIRY_NOTE),
    el("div", { class: "dialog-actions" },
      el("button", { class: "btn", type: "button", onclick: () => { ui.send = false; render(); } }, "Cancel"),
      el("button", {
        class: "btn primary", type: "submit", disabled: !Z || !!why,
      }, "Propose payment")),
    why ? el("p", { class: "small faint" }, why) : null);
  sumUp();
  return f;
}

// The expiry window of the engine (wasm/src/expiry.rs), in words.
const EXPIRY_NOTE = "The approvals must finish within about 24 hours. After that the payment "
  + "expires, and a signer proposes it again.";

// The priority fee: 10 times the standard fee, for a faster block when the network is busy. It
// is public on chain, so it marks the payment. Older builds of the apps refuse it.
function priorityBox(sumUp) {
  return el("label", { class: "ack" },
    el("input", {
      type: "checkbox", id: "s-priority", checked: ui.priority,
      onchange: (ev) => { ui.priority = ev.target.checked; sumUp(); },
    }),
    el("span", { class: "small" }, "Pay a priority fee: " + PRIORITY_FACTOR + " times the "
      + "standard fee, for a faster block when the network is busy. The fee is public on chain. "
      + "An iPhone or Mac app built before this version cannot approve it."));
}

// The expiry of an open payment, or why an expired one ends here. The engine counts from the
// last sync, so the time since that sync comes off. A height from saved state gives no time.
export function expiryLine(ss) {
  const e = expiryOf(ss), ins = inspectOf(ss), c = curChain();
  if (!e || ss.error || onChain(ss)) return null;
  const at = "block " + fmtInt(ins.expiry_height);
  if (expired(ss) && signingStarted(ss)) {
    return el("div", { class: "callout bad" }, "This payment expired at " + at + ", and no synced "
      + "block holds the transaction that this page shows. This page cannot prove that the "
      + "signers signed that transaction. Check the wallet's activity and an explorer before "
      + "anyone proposes it again.");
  }
  if (expired(ss)) {
    return el("div", { class: "callout bad" }, "This payment expired at " + at + ". No signer "
      + "can approve, sign or send it now. Propose it again.");
  }
  if (e.expired) {
    return el("div", { class: "callout" }, "This payment can no longer go to the network: it "
      + "expires at " + at + ". If a signer sent it, a block can still hold it.");
  }
  if (ss.broadcastTxid) return null;
  const must = "The approvals, the proof and the send must be done by then.";
  if (!c.balAt) return el("p", { class: "small muted" }, "Expires at " + at + ". " + must);
  const left = e.seconds_left - Math.max(0, (Date.now() - c.balAt) / 1000);
  return el("p", { class: "small muted" }, "Expires at " + at + ", in about "
    + about(Math.max(0, left)) + ". " + must);
}

function checkWarnings(rc) {
  const out = rc.extra.map((l) => "The transaction also pays " + fmtZec(l.value) + " to " + short(l.who, 12) + ", which the proposer did not list. Do not approve it.");
  // Paid with another memo (`got` is set): the address and the amount are right.
  const memoOnly = rc.rows.filter((r) => !r.ok && r.got !== undefined);
  out.push(...memoOnly.map((r) => "The memo in the transaction for " + short(r.to, 12)
    + " is not the memo the proposer listed. Do not approve it."));
  if (!rc.rows.length) out.push("The proposal lists no recipients. Do not approve it.");
  else if (!rc.match && !rc.extra.length && !memoOnly.length) {
    out.push("The transaction does not pay what the proposer listed. Do not approve it.");
  }
  return out.map((t) => el("div", { class: "callout bad" }, t));
}

// The memo lines of one payee row. For a payee paid with another memo, the memo that the
// transaction carries is the decoded one, so it shows as well.
function memoLines(r) {
  const own = r.memo == null ? "" : typeof r.memo === "string" ? r.memo : null;
  if (!r.ok && r.got !== undefined) {
    return [memoRow("Proposed memo", own), memoRow("Memo in the transaction", r.got, true)];
  }
  return own === "" ? [] : [memoRow("Memo", own)];
}

function checkHead(rc) {
  return el("div", { class: "card-head" }, el("span", { class: "label" }, rc.rows.length > 1 ? rc.rows.length + " recipients" : "To"),
    el("span", { class: "badge " + (rc.match ? "ok" : "bad") }, rc.match ? "Matches the transaction" : "Does not match the transaction"));
}

function recipientBox(ss, rc) {
  // Payments proposed before batch payments have no list; only one still open for approval needs
  // the check.
  if (rc.match === null || (!rc.rows.length && ss.package)) return null;
  return el("div", { class: "to-box" }, checkHead(rc),
    rc.rows.map((r) => el("div", { class: "payee-item" },
      el("div", { class: "payee" }, el("span", { class: "hex" }, addrGroups(r.to)),
        el("span", { class: "payee-end" }, money(r.amount), r.ok ? null
          : el("span", { class: "badge bad" },
            r.got === undefined ? "Not in the transaction" : "Memo differs"))),
      memoLines(r))),
    rc.rows.some((r) => r.memo) ? el("p", { class: "small faint" },
      "A memo goes on chain with the payment. Its recipient and every signer can read it.") : null,
    checkWarnings(rc),
    ss.move ? moveNote(ss, rc) : null);
}

function moveNote(ss, rc) {
  if (rc.intoNew === false) return el("div", { class: "callout bad" }, "This is not the address of " + groupName(ss.move) + ". Do not approve it.");
  if (rc.intoNew) return el("div", { class: "callout" }, "This moves all funds to " + groupName(ss.move) + ", the wallet that replaces this one. Your browser checked its address.");
  return el("div", { class: "callout" }, "This moves all funds to a new wallet that replaces this one. Your browser has no checked copy of its address, so it cannot check it.");
}

// The seats of this browser that can approve the payment now. None while the wallet's data is
// being checked: an approval written twice would replace its own nonces.
const approvers = (ss) => state.pending ? [] : localSeats().filter((i) => canWriteAs(i)
  && sec(state.gid, i).keyPackage && seatCheck(i) === true && !state.commits[i] && !ss.package);

const bigButton = (label, onclick, extra = {}) =>
  el("button", { class: "btn primary lg", type: "button", onclick, ...extra }, label);

function approveButtons(ss, myPending) {
  const several = localSeats().length > 1;
  return myPending.map((i) => bigButton(several ? "Approve as seat " + i : "Approve payment",
    act(() => approve(ss, i))));
}

const needsProof = (ss) => ss.signed && !ss.final
  && (ss.status !== "proving" || proofStalled(ss));

// The step after the approvals. The proof and the sent mark are signed writes, so they need a seat
// that can sign.
export function finishButtons(ss) {
  if (!mayAct()) return [];
  if (needsProof(ss)) return [bigButton("Build proof", act(() => finalizeTx(ss)))];
  // A node refuses a payment that expires within EXPIRY_MARGIN blocks (see expiryLine).
  if (!ss.final || expiryOf(ss)?.expired || onChain(ss)) return [];
  if (ss.broadcastTxid) {
    const late = Date.now() - finite(ss.broadcastAt) > RESEND_MS && inFlight().includes(ss);
    return late ? [bigButton("Send again", act(() => resendTx(ss)))] : [];
  }
  return [bigButton(ss.broadcastError ? "Send again" : "Send to network",
    act(() => broadcastTx(ss)), { disabled: !curChain() })];
}

// A sent payment that no block holds after this long may be lost: offer to send it again.
const RESEND_MS = 10 * 60 * 1000;

export function nextAction(ss, ins, rc) {
  if (expired(ss)) {
    return !signingStarted(ss) && mayAct() && localSeats().length
      ? [bigButton("Propose again", act(() => proposeAgain(ss)))] : [];
  }
  const myPending = approvers(ss);
  const canApprove = myPending.length && rc.match === true && rc.intoNew !== false;
  return canApprove ? approveButtons(ss, myPending) : finishButtons(ss);
}

const CANCEL_ASK = "Cancel this payment? No signer can approve it after this. Anyone can propose it again.";
// Until the signatures are combined, any signer can withdraw a payment, for example one that lost
// an approval. A signature share alone cannot move funds.
export const cancelAction = (ss) => ss.signed || expired(ss) || !localSeats().length || !mayAct() ? [] : [
  el("button", { class: "btn lg", type: "button", onclick: act(() => confirm(CANCEL_ASK) && cancelPayment(ss)) }, "Cancel payment"),
];

// An approval is a published commitment plus nonces kept here. Without the nonces the seat cannot
// sign, and the payment waits forever: say so instead of stalling.
function lostApproval(ss) {
  if (ss.signed || ss.error) return null;
  const chosen = (i) => !ss.package || signersOf(ss).includes(i);
  const lost = localSeats().filter((i) => state.commits[i] && !state.shares[i] && chosen(i)
    && !((sec(state.gid, i).nonces || {})[ss.id]) && !busy.has("share:" + ss.id + ":" + i));
  if (!lost.length) return null;
  return el("div", { class: "callout bad" }, "This browser does not hold its approval for this "
    + "payment any more: the browser data that held it was deleted. The payment cannot finish "
    + "with this approval. Cancel it, then propose it again.");
}

function sessionDrawer(ss) {
  const ins = inspectOf(ss), refused = ins && ins.error, rc = recipientCheck(ss, ins);
  // A cancelled or failed payment takes no more steps.
  const actions = ss.error ? [] : [...nextAction(ss, ins, rc), ...cancelAction(ss)];
  return el("aside", { class: "drawer", role: "dialog", "aria-modal": "true", "aria-label": "Payment details" },
    el("div", { class: "drawer-head" }, el("div", { style: "display:flex;align-items:center;gap:10px;min-width:0" }, el("h2", { class: "nowrap", style: "font-size:15px" }, payTitle(ss)), statusChip(ss)),
      closeBtn()),
    el("div", { class: "drawer-body" },
      leavesHead(ss, ins && !refused ? ins : null),
      refused ? el("div", { class: "callout bad" }, "Your browser refuses this payment: " + ins.error) : null,
      guard(expiryLine, ss),
      guard(recipientBox, ss, rc),
      lostApproval(ss),
      ins && !refused ? guard(breakdown, ins) : null,
      guard(timeline, ss, refused),
      guard(discussion, ss),
      ss.final ? guard(txDetails, ss) : null,
      ss.broadcastTxid ? chainSees() : null,
      ins && !refused ? el("details", { class: "small faint" }, el("summary", {}, "Technical details"),
        el("p", {}, "Signed message " + short(ins.sighash, 12) + " · " + ins.tx_version)) : null),
    actions.length ? el("div", { class: "drawer-foot" }, ...actions) : null);
}

// If the payment's document cannot be shown, the drawer still opens and closes.
function sessionLayer(ss) {
  try { return sessionDrawer(ss); }
  catch (e) { log("unreadable payment: " + (e && e.message ? e.message : e)); }
  return el("aside", {
    class: "drawer", role: "dialog", "aria-modal": "true", "aria-label": "Payment details",
  },
  el("div", { class: "drawer-head" }, el("h2", { style: "font-size:15px" }, "Payment"), closeBtn()),
  el("div", { class: "drawer-body" }, unreadable()));
}

// The decoded transaction is the truth. Spent notes minus change is what leaves the wallet: the
// payees and the fee.
function decodedTotals(ins) {
  const sum = (keep) => ins.lines.filter(keep).reduce((n, l) => n + finite(l.value), 0);
  const spent = sum((l) => l.kind === "spend"), paid = sum(isPayee);
  const back = sum((l) => l.kind !== "spend" && !isPayee(l));
  return { spent, paid, back, fee: spent - paid - back, leaves: spent - back };
}

function leavesHead(ss, ins) {
  const t = ins ? decodedTotals(ins) : { leaves: leavesOf(ss), fee: finite(ss.fee) };
  return el("div", { class: "leaves" },
    el("span", { class: "label" }, ins ? "Leaves the wallet" : "Proposed to leave the wallet"),
    money(t.leaves, "lg"),
    el("span", { class: "small muted" }, "includes " + zecText(t.fee)
      + (priorityTimes(ins) ? " priority fee" : " fee")),
    el("span", { class: "small muted" },
      "Proposed by " + proposer(ss) + " · " + when(ss.createdAt)));
}

function feeLabel(ins) {
  const times = priorityTimes(ins);
  return times ? "Priority fee (" + times + " times the standard fee)" : "Network fee";
}

function breakdown(ins) {
  const t = decodedTotals(ins);
  const row = (label, zat, cls = "") => el("div", {}, el("span", { class: cls }, label),
    el("span", { class: "mono " + cls }, zecText(zat)));
  const own = (l) => l.kind !== "spend" && !isPayee(l);
  const spent = ins.lines.filter((l) => l.kind === "spend");
  return el("div", { style: "display:grid;gap:8px" },
    el("span", { class: "label" }, "What this payment does"),
    el("div", { class: "lines" },
      ins.lines.filter(isPayee).map((l) => row("To " + short(l.who, 10), l.value)),
      row(feeLabel(ins), t.fee, "neg"),
      el("div", { class: "total" }, el("span", {}, "Leaves the wallet"),
        el("span", { class: "mono" }, zecText(t.leaves))),
      el("div", { class: "group" }, "Funds used"),
      spent.map((l) => row("Spent from this wallet", l.value, "neg")),
      ins.lines.filter(own).map((l) => row("Change back to this wallet", l.value, "neg"))),
    el("p", { class: "small faint" }, "Your browser decoded this from the transaction itself, "
      + "not from the proposer's description."));
}

// Each seat with its name and seat number, and a check mark when it approved.
const approverChips = () => el("div", {
  style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap",
}, seatIds().map((i) => el("span", { class: "approver" + (state.commits[i] ? " yes" : "") },
  avatar(i), el("span", { class: "small" }, named(i) + (state.commits[i] ? " ✓" : "")))));

function timeline(ss, refused) {
  const g = state.g, approvals = Object.keys(state.commits).length;
  const signers = signersOf(ss), shared = signers.filter((i) => state.shares[i]).length;
  const tl = (cls, title, body) => el("div", { class: "step " + cls }, el("span", { class: "tick" }, cls === "done" ? "✓" : cls === "bad" ? "!" : "•"), el("div", { style: "display:grid;gap:6px;min-width:0" }, el("h3", {}, title), body));
  return el("div", { class: "steps" },
    tl("done", "Proposed", el("p", {}, when(ss.createdAt))),
    tl(approvals >= g.t ? "done" : refused ? "bad" : "now", "Approvals · " + Math.min(approvals, g.t) + " of " + g.t + " needed",
      approverChips()),
    tl(ss.error ? "bad" : ss.signed ? "done" : ss.package ? "now" : "", "Combined signature",
      el("p", {}, ss.error ? ss.error : ss.signed ? "All signatures combined and verified." : ss.package ? "Signing · " + shared + " of " + signers.length + " shares" : "Starts after " + g.t + " approvals.")),
    tl(ss.final ? "done" : ss.status === "proving" ? "now" : "", "Proof",
      el("p", {}, ss.final ? "Proof built and the whole transaction checked." : ss.status === "proving" && !proofStalled(ss) ? "A signer's browser is building the proof · " + elapsed(ss.provingAt) + " of about a minute." : "Any signer can build the zero-knowledge proof once the payment is signed.")),
    tl(ss.broadcastTxid ? "done" : ss.broadcastError ? "bad" : ss.final ? "now" : "", "Sent to the network",
      el("div", { style: "display:grid;gap:8px" },
        ss.broadcastTxid ? el("p", {}, when(ss.broadcastAt) + " · ", el("a", { href: curNet().explorer + ss.broadcastTxid, target: "_blank", rel: "noopener" }, "View in explorer ↗"))
          : el("p", {}, ss.final ? "Any signer can send the finished transaction." : "Available after the proof."),
        ss.broadcastError && !ss.broadcastTxid ? el("div", { class: "callout bad" }, ss.broadcastError) : null)));
}

export function txDetails(ss) {
  const size = Number.isFinite(ss.final.size) ? fmtInt(ss.final.size) + " bytes" : "unknown";
  const id = txidOf(ss);
  const falseId = id && id !== ss.final.txid ? el("div", { class: "callout bad" }, "The finished "
    + "transaction names the id " + short(String(ss.final.txid), 12) + ", but the proposal gives "
    + "the id " + short(id, 12) + ". One signer's device wrote one of them alone. Check the "
    + "payment in an explorer.") : null;
  return el("div", { style: "display:grid;gap:10px" },
    el("span", { class: "label" }, "Transaction"),
    falseId,
    el("dl", { class: "kv", style: "grid-template-columns:110px minmax(0,1fr)" },
      el("dt", {}, "ID"), el("dd", { class: "hex" }, id || ss.final.txid),
      el("dt", {}, "Size"), el("dd", {}, size)),
    el("details", {}, el("summary", {}, "Raw transaction"),
      el("div", { class: "log" }, ss.final.tx_hex),
      el("div", { style: "margin-top:8px" }, copyBtn(ss.final.tx_hex, "Copy hex"))));
}

// What an observer of the chain learns from a sent payment.
function chainSees() {
  const hidden = () => el("span", { class: "redact", role: "img", "aria-label": "Hidden" });
  const row = (name) => [el("dt", {}, name), el("dd", {}, hidden())];
  return el("div", { style: "display:grid;gap:10px" },
    el("span", { class: "label" }, "What the chain sees"),
    el("p", { class: "small" }, "One shielded transaction."),
    el("dl", { class: "kv", style: "grid-template-columns:110px minmax(0,1fr)" },
      ["Recipients", "Amounts", "Signers", "Approval rule"].flatMap(row)),
    el("p", { class: "small faint" }, "The number of actions is public. So is the fee."));
}

document.addEventListener("visibilitychange", render);
window.addEventListener("focus", render);
const endCompose = () => {
  if (!composing) return;
  composing = false; drawPending = false; render();
};
document.addEventListener("compositionstart", () => { composing = true; });
document.addEventListener("compositionend", endCompose);
document.addEventListener("focusout", endCompose);
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  if (state.sid) closeSession();
  else {
    ui.send = false; ui.create = false; ui.receive = false; ui.move = false; ui.newChat = false;
    ui.contactAdd = false;
    closeBackup();
  }
  render();
});
