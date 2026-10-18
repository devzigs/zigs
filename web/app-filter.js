// Pins, signature checks, signed writes and the filter from store to state.
import { finite, skey, walletVersion } from "./util.js";
import {
  docFields, filterWallet, makeMemo, readSessions, signPart, validShape, writerCheck,
} from "./signed.js";
import { pin, signMsg, validPk, verifyMsg } from "./chat.js";
import { inbox, log, raw, rawInbox, rawReady, ready, state } from "./app-state.js";
import { oldest, readLocal, S, saveMerged } from "./app-kit.js";
import { Z } from "./app-engine.js";
import { mySeatSecrets, sec } from "./app-keystore.js";
import { localSeats, seatIds } from "./app-seats.js";
import { validNet } from "./app-chain.js";
import { signing } from "./app-messages.js";
import { react, render } from "./app-loop.js";

export const signPins = readLocal("zf-signpins");   // "wallet id:seat" -> first signing key seen

// Pins only keys that came from the store, never one this browser just made. This is for a wallet
// before version 3, whose seat documents have no signature (a version 3 wallet uses pinSeats).
// Only seats of 1 to n count.
function pinSigners() {
  let fresh = false;
  for (const i of seatIds()) {
    const pk = (raw.seats[i] || {}).signPk;
    if (validPk(pk) && pin(signPins, skey(state.gid, i), pk) === "new") fresh = true;
  }
  if (fresh) saveMerged("zf-signpins", signPins, oldest);
}

export const changedSigners = () => seatIds().filter((i) => {
  const pk = signPins[skey(state.gid, i)];
  return validPk(pk) && (state.seats[i] || {}).signPk !== pk;
});

// The store shows what any holder of the invite link wrote. In a version 3 wallet, each document
// that matters carries the signature of the seat that wrote it (PROTOCOL.md section 15). The page
// keeps the stored documents in `raw` and puts into `state` only those whose signature verifies.
// A document without a result yet counts as absent, and the reactor waits until all results are in.
export const NO_SIGNING_SEAT = "This browser cannot sign, so it cannot take part in this wallet. "
  + "Use a current Chrome, Edge, Firefox or Safari.";
export const NO_SEAT_KEY = "This browser has no signing key for a seat of this wallet, "
  + "so it cannot write to this wallet.";

// A device keeps the first version that it saw for a wallet, and the version of its own seats. A
// lower version written into the store later does not turn the checks off.
const hasV3Seat = (gid) => mySeatSecrets(gid).some(([, s]) => s.version === 3);
const versionKey = (gid) => "version:" + gid;   // apart from the "wallet id:seat" keys
export const signedMode = (gid) => !!gid && (hasV3Seat(gid) || signPins[versionKey(gid)] === "3");
export function pinVersion(gid, g) {
  const v = walletVersion(g);
  if (v && pin(signPins, versionKey(gid), String(v)) === "new") {
    saveMerged("zf-signpins", signPins, oldest);
  }
}

// The network that the people of a wallet confirmed with the safety number (confirmedNetwork),
// in `zf-signpins` under "confirmednet:<wallet id>". The store alone never sets it (SOL-34).
const confirmedNetKey = (gid) => "confirmednet:" + gid;
export const netConfirmed = (gid) => signPins[confirmedNetKey(gid)];
export function pinConfirmedNet(gid, net) {
  if (!validNet(net) || pin(signPins, confirmedNetKey(gid), net) !== "new") return false;
  saveMerged("zf-signpins", signPins, oldest);
  return true;
}

// The network of a wallet: the confirmed one, else the first name that this device saw, in
// `zf-signpins` under "network:<wallet id>". A missing or unknown name is not pinned. Returns the
// fields that replace the stored ones: `network`, and `networkMoved` when the store shows another.
export function pinNetwork(gid, d) {
  const key = "network:" + gid;
  if (validNet(d.network) && pin(signPins, key, d.network) === "new") {
    saveMerged("zf-signpins", signPins, oldest);
  }
  const pinned = netConfirmed(gid) || signPins[key];
  return pinned ? { network: pinned, networkMoved: d.network !== pinned } : {};
}

// The number of signers of a wallet. In a version 3 wallet it is the one this device saw first
// (cleanGroup), so a made-up seat above it never counts.
const seatCount = (gid) => {
  const g = gid === state.gid ? state.g : state.groups.find((x) => x.id === gid);
  return g && validShape(g.n, g.t) ? g.n : 0;
};

// Checks of documents have a memo of their own, apart from the messages. It keeps the signed text
// of each entry and answers only for the same text, and it stays bounded (makeMemo).
export const docMemo = makeMemo();
const SIG_MAX = 128, REL_MAX = 200;   // an Ed25519 signature has 88 characters in base64

// The text that a document signs, from the engine, or null where the engine refuses it.
function payloadOf(gid, rel, by, fieldsText) {
  try { return Z.docPayload(gid, rel, by, fieldsText); } catch { return null; }
}

// A signed part: the document path `rel` below the wallet, the writer `by`, its signature `sig`,
// the signed `fields`, and `need`, the seat that must have written them (null: any seat). `pk`
// names the key to check with, when it is not the pinned one. What a check needs, or its answer
// already: "no", or "wait" while the engine, the signing support or the seat keys are not known.
function partGate(gid, part, known) {
  const { rel, by, sig, need } = part;
  if (!signing || !Z) return "wait";
  if (typeof sig !== "string" || sig.length > SIG_MAX || rel.length > REL_MAX) return "no";
  const pk = part.pk ?? signPins[skey(gid, by)];
  const gate = writerCheck(by, need, seatCount(gid), pk, known);
  return gate === "check" ? { pk } : gate;
}

// At most a few checks run at once, so a flood of large documents cannot fill the memory with
// pending work. The others wait in a queue and start when one ends.
const CHECKS_MAX = 8;
let checking = 0, resultTimer = 0;
const checkQueue = [];
// Results of many documents come one by one. The page filters once for each short wait, not once
// for each result.
function refilterSoon() {
  if (resultTimer) return;
  resultTimer = setTimeout(() => { resultTimer = 0; refilter(); }, 40);
}
function startCheck(entry, gid, part, pk) {
  const run = () => {
    const text = payloadOf(gid, part.rel, part.by, entry.fields);
    const end = (ok) => { entry.ok = ok; checking--; checkQueue.shift()?.(); refilterSoon(); };
    checking++;
    if (text === null) end(false); else verifyMsg(pk, part.sig, text).then(end);
  };
  if (checking < CHECKS_MAX) run(); else checkQueue.push(run);
}

function partVerdict(gid, part, known) {
  const gate = partGate(gid, part, known);
  if (typeof gate === "string") return gate;
  const key = [gid, part.rel, part.by, part.sig].join("|");
  const ok = docMemo.ask(key, S(part.fields), gate.pk,
    (entry) => startCheck(entry, gid, part, gate.pk));
  return ok === null ? "wait" : ok ? "yes" : "no";
}

// The verdict for the stored document `d` at `rel` when the key of this device for seat `i` must
// have signed it, whatever key the device pinned for that seat (SOL-34).
export function signedByMe(gid, i, rel, d) {
  const pk = sec(gid, i).signPk;
  if (!d || !validPk(pk)) return "no";
  return partVerdict(gid, { rel, by: d.by, sig: d.sig, fields: docFields(d), need: i, pk }, true);
}

// The same for a decision that cannot wait for a redraw (it reads the store again).
export async function partNow(gid, part) {
  const gate = partGate(gid, part, gid === state.gid && state.seatsSettled);
  if (typeof gate === "string") return gate;
  const text = payloadOf(gid, part.rel, part.by, S(part.fields));
  return text !== null && (await verifyMsg(gate.pk, part.sig, text)) ? "yes" : "no";
}

// The answer for the seat document of seat `i` when no key is pinned for it yet: the document is
// checked with the key that it names. "" when there is nothing to pin.
function seatPin(gid, i) {
  const d = raw.seats[i];
  if (!d || Object.hasOwn(signPins, skey(gid, i))) return "";
  const part = {
    rel: "seats/" + i, by: d.by, sig: d.sig, fields: docFields(d), need: i, pk: d.signPk,
  };
  return partVerdict(gid, part, true);
}

// Pins the first key of each seat of 1 to n, but only a key that signed its own seat document, so
// a made-up document pins nothing. Returns how many seat documents wait for their result.
function pinSeats(gid) {
  let wait = state.seatsLoaded ? 0 : 1, fresh = false;
  for (const i of seatIds()) {
    const verdict = seatPin(gid, i);
    if (verdict === "wait") wait++;
    if (verdict === "yes") { signPins[skey(gid, i)] = raw.seats[i].signPk; fresh = true; }
  }
  if (fresh) saveMerged("zf-signpins", signPins, oldest);
  return wait;
}

// The device logs a document that it ignores once for each time a wallet opens, however often the
// page checks again. A signature is no part of the key, and the set has a limit.
const LOG_MAX = 200;
export const loggedIgnored = new Map();   // wallet id -> the documents already logged
function logIgnored(gid, what) {
  const path = what.slice(0, 120);
  if (!loggedIgnored.has(gid)) loggedIgnored.set(gid, new Set());
  const seen = loggedIgnored.get(gid);
  if (seen.has(path) || seen.size >= LOG_MAX) return;
  seen.add(path);
  log("ignored data without a valid signature (wallet " + gid.slice(0, 6) + "): " + path);
}

const newest = (a, b) => finite(b.createdAt) - finite(a.createdAt);
const asSessions = (map) => Object.entries(map).map(([id, v]) => ({ id, ...v })).sort(newest);
const seatUid = (gid, seat) => gid === state.gid ? (state.seats[seat] || {}).uid : undefined;
export const checkIn = (gid) => (rel, by, sig, fields, need) =>
  partVerdict(gid, { rel, by, sig, fields, need }, gid === state.gid && state.seatsSettled);

// A proposal comes from a seat. Its identity is the one in that seat's document, not a field.
const withProposer = (gid) => (ss) => ({ ...ss, createdBy: seatUid(gid, ss.by) });

function filterOpen(gid) {
  const wait = pinSeats(gid);
  state.seatsSettled = wait === 0;
  const f = filterWallet(raw, state.sid, checkIn(gid), (what) => logIgnored(gid, what));
  Object.assign(state, f.docs, {
    sessions: f.sessions.map(withProposer(gid)).sort(newest), ignored: f.bad,
    pending: f.wait > 0 || wait > 0,
  });
}

function readyOf(gid, d) {
  if (!d || !signedMode(gid)) return d;
  const verdict = checkIn(gid)("meta/wallet", d.by, d.sig, docFields(d), 1);
  if (verdict === "no") logIgnored(gid, "meta/wallet");
  return verdict === "yes" ? docFields(d) : verdict === "wait" ? undefined : false;
}

function inboxOf(gid, list) {
  if (!signedMode(gid)) return list;
  const t = { bad: 0, wait: 0, onBad: (what) => logIgnored(gid, what) };
  return readSessions(list.map((d) => [d.id, d]), checkIn(gid), t);
}

// The approvals and shares of session `sid` of the open wallet, from the raw maps of its watch,
// checked as the open payment's are. A wallet before version 3 signs none.
const NO_DOCS = { seats: {}, dkg1: {}, dkg2: {}, confirm: {}, abort: {}, done: {}, verify: {},
  wallet: null, sessions: {} };
export function sessionParts(sid, parts) {
  const gid = state.gid;
  if (!signedMode(gid)) return parts;
  const onBad = (what) => logIgnored(gid, what);
  const f = filterWallet({ ...NO_DOCS, ...parts }, sid, checkIn(gid), onBad);
  return { commits: f.docs.commits, shares: f.docs.shares };
}

// Shows the stored documents as they are in a wallet before version 3.
function copyRaw() {
  if (signedMode(state.gid)) return;   // its group document has not come yet: show nothing
  Object.assign(state, {
    seats: raw.seats, dkg1: raw.dkg1, dkg2: raw.dkg2, confirm: raw.confirm, abort: raw.abort,
    done: raw.done, verify: raw.verify, wallet: raw.wallet, sessions: asSessions(raw.sessions),
    commits: raw.commits, shares: raw.shares, ignored: 0, pending: false,
  });
  pinSigners();
}

function applyFilter() {
  if (state.gid && state.g && signedMode(state.gid)) filterOpen(state.gid); else copyRaw();
  for (const [gid, d] of Object.entries(rawReady)) ready[gid] = readyOf(gid, d);
  for (const [gid, list] of Object.entries(rawInbox)) inbox[gid] = inboxOf(gid, list);
}

// Every change of a stored document, a pin or a check result ends here: the page filters again,
// draws, and lets the reactor act. Several changes in one turn make one pass.
let refilterQueued = false;
export function refilter() {
  if (refilterQueued) return;
  refilterQueued = true;
  queueMicrotask(() => {
    refilterQueued = false;
    try { applyFilter(); } catch (e) { log("✗ filter: " + (e && e.message ? e.message : e)); }
    render();
    react();
  });
}

// The reactor writes nothing while a check is open, or when this browser cannot check at all.
export const signedHold = () => state.pending || (signedMode(state.gid) && !signing);

// The text of a document that seat `seat` signs, signed with its key.
const signText = (gid, rel, seat, fields) =>
  signMsg(sec(gid, seat).signSk, Z.docPayload(gid, rel, seat, S(fields)));

// The writer and signature to add to `fields` of the document at `rel` that a seat signs as a
// whole. A wallet before version 3 adds none. Every caller names its wallet (`gid`), because the
// person can open another wallet while an earlier step waits.
async function sigFor(gid, rel, seat, fields) {
  if (!signedMode(gid)) return {};
  if (!canWriteAs(seat, gid)) throw new Error(NO_SEAT_KEY);
  return { by: seat, sig: await signText(gid, rel, seat, fields) };
}
export const signedDoc = async (gid, rel, seat, fields) => ({
  ...fields, ...(await sigFor(gid, rel, seat, fields)),
});

// The same for part `name` of the payment `sid`: the writer is `prefer` if this browser can sign
// for it, else another seat. Only the fields of the part are signed (signPart).
export async function sigPart(gid, sid, name, fields, prefer) {
  if (!signedMode(gid)) return {};
  const seat = writer(prefer, gid);
  if (seat == null) throw new Error(NO_SEAT_KEY);
  return signPart(name, fields, seat, (f) => signText(gid, "sessions/" + sid, seat, f));
}

// May this browser write as seat i? Always before version 3. In version 3 the seat needs the
// signing key that readers pinned (the key in the seat document only while nothing is pinned).
export function canWriteAs(i, gid = state.gid) {
  if (!signedMode(gid)) return true;
  const s = sec(gid, i);
  if (!s || !s.signSk) return false;
  const pinned = signPins[skey(gid, i)];
  const shown = gid === state.gid ? (state.seats[i] || {}).signPk : undefined;
  return s.signPk === (validPk(pinned) ? pinned : shown);
}

// The seat that signs a write that has no seat of its own: `prefer` if this browser can sign for
// it, else another seat of this browser.
export function writer(prefer, gid = state.gid) {
  if (!signedMode(gid)) return null;
  const held = gid === state.gid ? localSeats() : mySeatSecrets(gid).map(([i]) => i);
  const own = held.filter((i) => canWriteAs(i, gid));
  return own.includes(prefer) ? prefer : own[0];
}

// May this browser change the open wallet? Always before version 3. In version 3 it needs a seat
// that can sign: the signed PCZT, the proof and the sent mark are signed parts.
export const mayAct = () => !signedMode(state.gid) || writer() != null;
