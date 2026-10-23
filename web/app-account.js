// The personal account: store, sync, send and contacts; startUp.
import { toZat } from "./payees.js";
import { open as openVault, parseVault, seal } from "./vault.js";
import { fmtInt } from "./util.js";
import { newRoom } from "./chat.js";
import {
  accountBalance, addContact, chatTimeline, feeFor, fundingPayees, highestIndex, holdsNotes,
  messagePlan, newPersonal, normPersonal, readBackup, receivedItems, restoredPersonal, routeItems,
  sendGate, sentState,
} from "./personal.js";
import { REQUEST_NET, requestProblem } from "./requests.js";
import { log, showBanner, state, ui } from "./app-state.js";
import { exclusive, J, release, S, said, track } from "./app-kit.js";
import { engineOffThread, Z } from "./app-engine.js";
import { idb, LOCKED_ELSEWHERE, lockedVault, persist, vault } from "./app-keystore.js";
import {
  capText, dropStalled, NETWORKS, runSync, serverHeight, spanMs, syncAgain,
} from "./app-chain.js";
import { boot, openGroup } from "./app-groups.js";
import { normalized } from "./app-dom.js";
import { broadcastAnywhere } from "./app-payments.js";
import { proposeRequest, requestOf } from "./app-payreq.js";
import { render } from "./app-loop.js";

export let personal = null;          // the personal account (web/personal.js), with its seed
export function setPersonal(v) { personal = v; }
export let personalError = "";       // why a saved account cannot be read
export let personalDamaged = null;   // the saved value that failed to read, kept so that no save erases it
export let personalPending = false;  // the start-up read of the saved account has not ended
// With the passkey lock on, the account is a field of the sealed record. With the lock off, local
// storage never holds the seed: it is sealed with an AES key that this browser cannot export, and
// both sit in IndexedDB. Code on this site can still use that key, so the lock stays the safer way.
const DEVICE_REC = { cred: "device", salt: "device" };   // seal() wants a record; no passkey

async function deviceKey() {
  const have = await idb("readonly", (st) => st.get("personal:key"));
  if (have) return have;
  const fresh = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false,
    ["encrypt", "decrypt"]);
  // add() fails when another tab saved a key first. That key is then the one to use.
  try { await idb("readwrite", (st) => st.add(fresh, "personal:key")); return fresh; } catch {
    return idb("readonly", (st) => st.get("personal:key"));
  }
}

// The saved account, or null for none. Throws when IndexedDB fails. A throw with `stored` means
// that a record is there but does not open: it is damaged, and no new account may replace it.
export async function deviceRead() {
  const [key, rec] = await Promise.all(["personal:key", "personal:rec"]
    .map((name) => idb("readonly", (st) => st.get(name))));
  if (!rec) return null;
  const damaged = (e) => Object.assign(new Error(said(e)), { stored: true });
  if (!key) throw damaged(new Error("its key is missing"));
  try { return await openVault(key, rec); } catch (e) { throw damaged(e); }
}

// `fresh` is the first write of a new account: add() refuses it when another tab saved an
// account first, so two tabs cannot both make one.
async function deviceWrite(fresh = false) {
  const rec = await seal(await deviceKey(), DEVICE_REC, personal || personalDamaged);
  const write = (st) => (fresh ? st.add(rec, "personal:rec") : st.put(rec, "personal:rec"));
  await idb("readwrite", write);
}

function deviceClear() {
  return idb("readwrite", (st) => { st.delete("personal:rec"); return st.delete("personal:key"); });
}

// The account is in the sealed record now (a damaged one as it is), so the device copy goes.
export function dropDeviceCopy(strict = false) {
  if (!personal && !personalDamaged) return strict ? Promise.resolve() : undefined;
  if (strict) return clearDeviceCopy();
  deviceClear().catch((e) => log("could not delete the account copy: " + (e.message || e)));
}
async function clearDeviceCopy() {
  await deviceClear();
  const left = await Promise.all(["personal:key", "personal:rec"]
    .map((name) => idb("readonly", (st) => st.get(name))));
  if (left.some((value) => value != null)) throw new Error("The device account copy could not "
    + "be removed. Keep this tab open and save recovery files; passkey protection is incomplete.");
}

// Reads a saved account. A record that does not read stays as it is, and no new account is made
// over it.
export function adoptPersonal(x) {
  personal = null; personalError = ""; personalDamaged = null;
  if (x == null) return;
  try { personal = normPersonal(x, personalEnv()); } catch (e) {
    personalDamaged = x;
    personalError = "The personal account in this browser cannot be read: " + (e.message || e);
  }
}

// The engine calls and the words of each network, for the rules in web/personal.js.
export const personalEnv = () => ({
  keys: (seed, net) => Z.accountKeys(seed, net), normalize: normalized,
  nets: Object.fromEntries(Object.entries(NETWORKS)
    .map(([name, n]) => [name, { prefix: n.prefix, label: n.label.toLowerCase() }])),
});

// The saved account is the truth: another tab may have made it, changed it or removed it. This
// reads it again, at start and before each change: the sealed record with the lock on, else the
// device copy. A failed read of IndexedDB as a whole shows nothing. A record that is there but does
// not open blocks a new account. A store that lost the account never erases the memory copy. The
// sync follows the account that it reads.
export async function rereadPersonal() {
  if (vault) return rereadVault();
  if (typeof indexedDB === "undefined") return;
  try {
    const stored = await deviceRead();
    if (stored) {
      adoptPersonal(stored);
      followAccount();
    }
  } catch (e) {
    log("saved account not read: " + said(e));
    if (e.stored && !personal) {
      personalError = "Zigs could not read the saved personal account (" + said(e)
        + "). Reload the page. Do not make a new account yet.";
    }
  }
}

// With the lock on, a storage event of another tab can come late or not at all. So the account in
// the sealed record is read again.
// Only the account is taken: the secrets, keys and chats of this tab can hold a change that is not
// saved yet, and the storage event brings those.
async function rereadVault() {
  let value = null;
  try { value = localStorage.getItem("zf-vault"); } catch { return; }
  if (!value) return;
  try {
    const got = await openVault(vault.key, parseVault(value));
    if (!("personal" in got)) return;   // a page from before the accounts; see takeVault
    adoptPersonal(got.personal);
    followAccount();
  } catch (e) { log("sealed record not read: " + said(e)); }
}

// Before the lock turns on: the account moves into the sealed record. A record that is there but
// does not open stops the lock, because the account would be left out. A store that fails as a
// whole holds no account that this page ever saw.
export async function takeDeviceAccount() {
  if (typeof indexedDB === "undefined") return;
  let stored;
  try { stored = await deviceRead(); } catch (e) {
    if (!e.stored && !personal && !personalDamaged) {
      log("saved account not read: " + said(e));
      return;
    }
    throw new Error("This browser could not read the personal account, so it did not lock ("
      + said(e) + "). Try again.");
  }
  if (stored) adoptPersonal(stored);
}

let personalWrite = Promise.resolve(true);
export function persistPersonal(fresh = false) {
  if (lockedVault) return Promise.resolve(false);
  if (vault) return persist();
  try {
    // Another tab turned the lock on: a write here would put the seed beside the sealed record.
    if (localStorage.getItem("zf-vault")) {
      showBanner("bad", LOCKED_ELSEWHERE);
      return Promise.resolve(false);
    }
  } catch { /* no local storage: IndexedDB may still work */ }
  const save = () => (personal || personalDamaged ? deviceWrite(fresh) : deviceClear());
  personalWrite = personalWrite.then(save).then(() => true, (e) => {
    showBanner("bad", "Could not save the personal account (" + said(e) + ").");
    return false;
  });
  return personalWrite;
}

// Changes the account and saves it. The change is undone when the save fails. The step reads the
// saved account first and runs alone, so two changes never overwrite each other.
export function changePersonal(change) {
  return exclusive("account", async () => {
    await rereadPersonal();
    if (!personal) throw new Error("There is no personal account.");
    const before = structuredClone(personal);
    try { change(personal); } catch (e) { personal = before; throw e; }
    if (await persistPersonal()) return;
    personal = before;
    throw new Error("Could not save this change in the browser, so it was not made.");
  });
}
export let acct = null;    // the same for the personal account, with account: true (see startAccount)
export function setAcct(v) { acct = v; }

// A single-signer account that pays the fee of messages on chain (CHAT.md section 5). It syncs by
// its viewing key like a wallet, always reads memos, and never touches the group server. The seed
// stays in `personal`. It never goes into `ui`, a log line or an error message.
const FUND_NOTE = "Fund the proposer's personal account";
export const NOT_READY = "Wait for the account to load.";
export const splitParts = (text) => {
  if (!Z) throw new Error("The crypto engine is not ready.");
  return J(Z.splitMessage(text));
};
const joinTexts = (texts) => J(Z.joinMessage(S(texts))).text;

export function startAccount() {
  if (!Z || !personal || acct) return;
  let keys;
  try { keys = J(Z.accountKeys(personal.seed, personal.network)); } catch (e) {
    log("account keys: " + (e.message || e));
    return;
  }
  acct = {
    account: true, gid: "personal", id: "personal", secret: personal.snapKey,
    net: NETWORKS[personal.network], ufvk: keys.ufvk, address: keys.address,
    birthday: personal.birthday, addrs: new Map(), cw: null, url: null, prog: null, bal: null,
    received: [], sent: new Set(), ms: 0, error: null, syncing: false, progress: "", live: "",
  };
  runSync(acct);
}

function dropAccount() {
  const c = acct;
  acct = null;
  if (c && !c.syncing) release(c.cw);
}

// Another tab removed or replaced the account: this tab's sync follows (the sync key is new then).
export function followAccount() {
  if (acct && (!personal || acct.secret !== personal.snapKey)) dropAccount();
  startAccount();
}

const heightNow = () => (acct && acct.bal ? acct.bal.height : undefined);
export function sentStateOf(rec) {
  const sent = acct ? acct.sent : new Set();
  return sentState(rec, { sent, height: heightNow(), live: !!acct && acct.live === rec.txid });
}
// The sent messages that hold notes (see holdsNotes): the engine does not know about them yet.
export const flightNow = () => (personal ? personal.sent.filter((r) => holdsNotes(sentStateOf(r))) : []);
export const acctBalance = () => (acct && acct.bal ? accountBalance(acct.bal, flightNow()) : null);

// The address of the account is shown on testnet. On mainnet it is shown while the balance is
// known and under the cap, as for a wallet. Returns why it is not, or "".
export function acctAddressWhy() {
  const cap = NETWORKS[personal.network].cap, b = acctBalance();
  if (!cap) return "";
  if (!b) {
    return "Wait for the first sync to finish. The app shows the address of a mainnet account "
      + "only when it knows the balance.";
  }
  return b.total < cap ? "" : "This account holds " + capText(cap) + ", the warning level for "
    + "unaudited mainnet accounts. Do not send more to it. The app cannot block deposits.";
}

// Why the composer is off, or "".
export function messageWhy(fee = feeFor(1)) {
  if (!acct || !acct.cw) return "Wait for the first sync to finish.";
  if (acct.progress) return "A message is being sent. Wait until it is done.";
  // A message on the stalled object would wait on the same server (messageOrStall).
  if (acct.stalled) {
    return "The light-wallet server stopped answering. Wait until the account is up to date.";
  }
  return sendGate(acctBalance(), flightNow(), fee);
}

// The address of the account at `index`: 0 is the public address, a contact has its own.
export function addressFor(index) {
  if (index === 0) return acct.address;
  if (!acct.addrs.has(index)) acct.addrs.set(index, Z.addressAt(acct.ufvk, index));
  return acct.addrs.get(index);
}

const HAS_ACCOUNT = "This browser has a personal account already. A browser keeps one account.";

// Makes the account that `build` gives the account of this browser. It never replaces a saved
// one: the page reads the saved account again first, and the device store refuses a write over it.
async function claimAccount(build, failure) {
  await rereadPersonal();
  if (personal || personalError) throw new Error(personalError || HAS_ACCOUNT);
  const made = await build();
  // The last read, the check and the save run alone, as a change does. With the lock on, the
  // sealed record has no add() that refuses a second account.
  return exclusive("account", async () => {
    await rereadPersonal();   // another tab may have saved an account while `build` waited
    if (personal || personalError) throw new Error(personalError || HAS_ACCOUNT);
    personal = made;
    if (await persistPersonal(true)) return;
    if (personal === made) personal = null;
    await rereadPersonal();   // another tab may have saved an account in the meantime
    throw new Error(personal ? HAS_ACCOUNT : failure);
  });
}

export async function createPersonal(network) {
  if (!Z) throw new Error("The crypto engine is not ready.");
  if (network === "mainnet" && !ui.personal.ack) {
    throw new Error("Confirm that you understand Zigs is not audited before you make a mainnet "
      + "account.");
  }
  await claimAccount(async () => {
    const { height: birthday } = await serverHeight(NETWORKS[network]);
    const made = J(Z.accountNew(network));
    return newPersonal({ seed: made.seed, network, birthday }, newRoom().key);
  }, "This browser could not save the account, so it was not made. Lock Zigs with a passkey, or "
    + "use a browser that keeps site data.");
  ui.personal.ack = false;
  startAccount();
  showBanner("ok", "Account made. Back it up now: the file is the only copy outside this browser.");
}

// The backup file brings the seed, the network, the birthday and the contacts back. The sync
// starts at the birthday. The text of sent messages is not in the file.
export async function restoreAccount(b, encrypted) {
  if (!encrypted) {
    throw new Error("This backup file is not encrypted. Make a new encrypted backup of the "
      + "account.");
  }
  await claimAccount(() => restoredPersonal(readBackup(b, personalEnv()), newRoom().key),
    "This browser could not save the restored account, so it was not used.");
  startAccount();
  showBanner("ok", "Restored the personal account. It syncs from block " + fmtInt(personal.birthday)
    + ". A contact that you added after you made the file is not in it. Messages to the address "
    + "of that contact show under Other messages.");
}

// Removes the account, also one that does not read (`personalDamaged`).
export async function removeAccount() {
  const was = [personal, personalDamaged, personalError];
  personal = personalDamaged = null;
  personalError = "";
  if (!(await persistPersonal())) {
    [personal, personalDamaged, personalError] = was;
    throw new Error("Could not save this change in the browser, so the account stays.");
  }
  dropAccount();
  try { await idb("readwrite", (st) => st.delete("personal")); } catch { /* the state is sealed */ }
  ui.personal.drop = false;
  state.contact = null;
  showBanner("ok", "The personal account is removed from this browser.");
}

function contactCtx(own) {
  const net = NETWORKS[personal.network];
  return { normalize: normalized, prefix: net.prefix, label: net.label.toLowerCase(), own };
}

// A new contact needs an index that no address of the account used. The chain tells which ones got
// a payment, so the first sync must be done.
const NOT_SYNCED = "Wait for the first sync to finish. Zigs then knows which addresses of the "
  + "account already got a payment.";

export async function addPersonalContact(name, address) {
  const c = acct;
  if (!c) throw new Error(NOT_READY);
  if (!c.bal) throw new Error(NOT_SYNCED);
  const own = [c.address, ...personal.contacts.map((x) => addressFor(x.index))];
  let made;
  await changePersonal((p) => {
    const ctx = { ...contactCtx(own), seen: highestIndex(c.received) };
    const got = addContact(p.contacts, name, address, ctx);
    if (got.error) throw new Error(got.error);
    p.contacts.push(got.contact);
    p.backedUp = false;   // the file does not hold this contact yet
    made = got.contact;
  });
  return made;
}

export function openContact(index) {
  openGroup(null);
  state.contact = index;
  render();
}

// The funding request: 3 payees to the public address of the account (web/personal.js).
export function fundingUri() {
  if (!acct) throw new Error(NOT_READY);
  const made = fundingPayees(acct.address, toZat(ui.personal.fund));
  if (made.error) throw new Error(made.error);
  return Z.makeRequest(S(made.payees), REQUEST_NET[personal.network]);
}

// Opens the Send form of a wallet with the request. It sends nothing: the wallet's approvals apply.
export function fundFromWallet(gid) {
  const req = requestOf(fundingUri(), true, personal.network);
  if (!req || req.error) throw new Error(req ? requestProblem(req.error) : NOT_READY);
  proposeRequest(req, { name: "", verdict: "yes", mine: true, dm: true }, gid);
  ui.note = FUND_NOTE;
}

export async function copyFundingRequest() {
  const uri = fundingUri();
  try { await navigator.clipboard.writeText(uri); } catch {
    throw new Error("This browser did not let the page copy. Allow clipboard access for this "
      + "site.");
  }
  showBanner("ok", "Request copied. Pay it from any wallet.");
}

// Builds the message, signs it with the seed, builds the proof, saves the record, and only then
// sends it. A record that is saved but not confirmed as sent holds its notes until a block holds
// it or it expires (sentState). The seed stays on this thread: the worker gets the signed
// transaction only. One message at a time, also across tabs: the next one starts after the
// saved record of this one is there to read.
export const sendOnChain = (contact, text) => exclusive("send", () => sendLocked(contact, text));

async function sendLocked(contact, text) {
  await rereadPersonal();
  const c = acct, plan = messagePlan(text, splitParts);
  const why = plan.error || messageWhy(plan.fee);
  if (why) throw new Error(why);
  const step = (words) => { c.progress = words; render(); };
  try {
    step("Building the message…");
    const m = J(await messageOrStall(c, contact.address, text));
    const tip = J(c.cw.balance()).tip;
    step("Signing…");
    const signed = J(Z.accountSign(m.pczt, personal.seed, personal.network)).signed_pczt;
    step("Building the proof. This takes about a minute.");
    const out = await engineOffThread("finalize", signed);
    const rec = {
      txid: out.txid, to: contact.index, text, at: Date.now(), tip, fee: m.fee, parts: m.parts,
      note_value: m.note_value, change: m.change, broadcast: false, failed: "",
    };
    await changePersonal((p) => { p.sent.push(rec); });
    c.live = rec.txid;
    step("Sending to the network…");
    await deliver(c, rec, out.tx_hex);
  } finally { c.progress = ""; c.live = ""; render(); }
}

// A message with no answer in MESSAGE_TIMEOUT_MS stops, as a proposal does (spendOrStall), so
// that one silent server does not hold the lock of the send, which the sends of every tab wait for.
// The engine may still use the wallet object, so it counts as stalled until a sync connects to the
// next server.
// ponytail: the late answer of the engine is dropped; nothing stops the engine call.
const MESSAGE_TIMEOUT_MS = 60000;
function messageOrStall(c, address, text) {
  const cw = c.cw;
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (c.cw === cw) {
        dropStalled(c);
        if (c === acct) syncAgain(c);   // not the account that another tab removed meanwhile
      }
      reject(new Error("The message got no answer in 60 s, so it stopped. Send it again when "
        + "the account is up to date."));
    }, MESSAGE_TIMEOUT_MS);
  });
  return Promise.race([track(cw, cw.createMessage(address, text)), late])
    .finally(() => clearTimeout(timer));
}

async function deliver(c, rec, txHex) {
  const mark = (patch) => changePersonal((p) => {
    Object.assign(p.sent.find((r) => r.txid === rec.txid) || {}, patch);
  });
  try {
    await broadcastAnywhere(txHex, { net: c.net, ufvk: c.ufvk, birthday: c.birthday });
  } catch (e) {
    const reason = e.message || String(e);
    if (!e.refused) {
      throw new Error("The message may not have been sent: " + reason + ". Zigs holds its notes "
        + "until a block holds it or it expires.");
    }
    await mark({ failed: reason }).catch((err) => log("could not save: " + err.message));
    throw new Error("The message was not sent: " + reason);
  }
  await mark({ broadcast: true }).catch((err) => log("could not save the send: " + err.message));
  log("message sent: " + rec.txid);
  showBanner("ok", "Sent to the network. It arrives with the next block.");
  if (c === acct) runSync(c);   // not an account that was removed or replaced meanwhile
}

// The received memos of the account, joined and sorted into the chats of the contacts and the other
// messages. The result is kept until the list of memos or the contacts change.
export function accountInbox() {
  const c = acct;
  if (!c || !personal) return { chats: new Map(), other: [] };
  const key = personal.contacts.map((x) => x.index).join(",");
  if (!c.routed || c.routed.received !== c.received || c.routed.key !== key) {
    const items = receivedItems(c.received, joinTexts);
    c.routed = { received: c.received, key, ...routeItems(items, personal.contacts) };
  }
  return c.routed;
}

// A block height as a time. A received message has only its block height.
// The time of a block, counted back from the end of the last sync. The clock goes on between
// syncs and the height does not, so a count from now would move every message later.
export function blockTime(height) {
  const tip = heightNow() ?? height;
  return (acct?.balAt ?? Date.now()) - spanMs(personal.network, height, tip);
}

export const contactRows = (contact) => chatTimeline(accountInbox().chats.get(contact.index) || [],
  personal.sent.filter((r) => r.to === contact.index), blockTime);

// The page does not wait for the saved account: it opens at once, and the account follows.
export function startUp() {
  personalPending = true;
  boot();
  rereadPersonal().finally(() => { personalPending = false; startAccount(); render(); });
}
