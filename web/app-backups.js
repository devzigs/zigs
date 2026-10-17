// Backup and restore: logic and dialogs.
import {
  backupName, boxPairMatches, heldRefusal, keysOf, lateFields, makePassphrase, passIssue,
  restoredSecret, settledFields, shareShape, skey, staleRestore, takenKeys, undoPlan,
} from "./util.js";
import { signPairMatches, validId, validRoom } from "./chat.js";
import {
  accountBackupName, backupPayload, KIND as PERSONAL_KIND, salvageBackup,
} from "./personal.js";
import { showBanner, state, ui } from "./app-state.js";
import { isObj, J, S } from "./app-kit.js";
import { engineOffThread, Z } from "./app-engine.js";
import { gkeys, mySeatSecrets, persist, putKey, putSec, sec, secrets } from "./app-keystore.js";
import { fitState } from "./app-seats.js";
import { isChatId } from "./app-links.js";
import { downloads, openGroup } from "./app-groups.js";
import { act, copyBtn, el } from "./app-dom.js";
import { groupVersion } from "./app-dkg.js";
import {
  changePersonal, personal, personalDamaged, personalEnv, restoreAccount,
} from "./app-account.js";
import { once, render } from "./app-loop.js";
import { solRestore } from "./app-rest.js";

const SOL_BACKUP_KIND = "zigs-sol-backup";

// A backup file is the key share, sealed with a passphrase (PROTOCOL.md section 9). The engine
// does the Argon2id and the cipher. The passphrase lives only in the dialog's input and in the
// worker call, never in `ui`.
const BACKUP_KIND = "zigs-key-share";   // what the sealed text holds, also in a plain file
// The key share files changed on this date (PROTOCOL.md section 9). Account and Solana files did
// not, so only the seat backup screens and these two texts say it.
export const BACKUP_CHANGED = "The backup format changed on 16 October 2026. Older backup files no longer "
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

export function openBackup(i) {
  if (!downloads) { showBanner("bad", "Downloads are not available in this view."); return; }
  ui.backup = { seat: i, made: false, busy: false };
  render();
}

export function closeBackup() {
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

export function openAccountBackup() {
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

export function restoreDialog() {
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
export function staleRestoreNote() {
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
