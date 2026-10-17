// Wallet creation, the key ceremony, safety number, address check and seat join.
import {
  abortText, checkNetwork, confirmGate, conflictReason, skey, usesV2, walletVersion,
} from "./util.js";
import { docFields } from "./signed.js";
import { canSign, newSignKey, signMsg } from "./chat.js";
import { log, showBanner, state } from "./app-state.js";
import { isStr, J, randomHex32, S } from "./app-kit.js";
import { Z } from "./app-engine.js";
import { mySeatSecrets, putKey, putSec, sec } from "./app-keystore.js";
import { allR1, allSeated, isCreator, keysAgree, localSeats, r2For, seatIds } from "./app-seats.js";
import { netName, netOf, pickServer } from "./app-chain.js";
import { canWriteAs, NO_SIGNING_SEAT, partNow, signedDoc, signedMode } from "./app-filter.js";
import { me, openGroup, sdb, user } from "./app-groups.js";
import { ensureSignKey } from "./app-messages.js";
import { once, react } from "./app-loop.js";

// Version 1 wallets: the creator picks nk and rivk. Version 2 wallets (ZIP 2005): the signers
// agree on a secret sk together, and nk, qsk and rivk follow from it (PROTOCOL.md section 4).
export const groupVersion = () => walletVersion(state.g);
// A seat keeps the version that its wallet had when it took the seat ("version"), so a change of
// the wallet document later cannot move the seat to another ceremony. A seat from before that
// follows its own progress; before it began, the wallet's version decides.
function seatMode(s) {
  if (s.version) return s.version;
  if (s.skPart || s.vaultSk) return 2;
  return s.r1secret || s.r2secret || s.keyPackage ? 1 : groupVersion();
}
const launch = (key, fn) => { once(key, fn); return true; };

export function reactSeat(i) {
  const gid = state.gid, s = sec(gid, i);
  // Seats taken before secrets kept their identity: record it while this browser still knows it.
  if (!s.uid) putSec(gid, i, { uid: state.seats[i].uid });
  ensureSignKey(gid, i);
  // A seat that cannot sign writes nothing in a version 3 wallet (signedNotes tells the person).
  if (!canWriteAs(i)) return;
  if (s.aborted || (!s.keyPackage && remoteAborts().length)) return;
  const started = usesV2(seatMode(s)) ? stepV2(i, s) : stepV1(i, s);
  if (!started) verifyStep(i, s);
}

// The store can show another wallet version, another seat key, or data of the other ceremony
// than the one a seat took. Each ends the setup of that seat for good (conflictReason).
const sawV2Data = () => Object.keys(state.confirm).length > 0
  || Object.values(state.dkg1).some((d) => d.commit !== undefined);
const conflictOf = (i, s, number) => conflictReason(s, state.seats[i], groupVersion(), seatMode(s),
  { sawV2: sawV2Data(), number });

// Runs over every seat that this browser holds a secret for, also a seat that the store now
// shows under another identity. A stopped seat tells the other seats until the store holds its
// abort document with a reason.
export function reactStops() {
  const number = safetyNo();
  for (const [i, s] of mySeatSecrets(state.gid)) {
    const reason = s.aborted ? null : conflictOf(i, s, number);
    if (reason) putSec(state.gid, i, { aborted: abortText(reason) });
    const text = sec(state.gid, i).aborted;
    if (mustAbort(i, text)) launch("abort:" + i, () => publishAbort(i, text));
  }
}
// A stopped seat tells the others, if it may write as that seat. In version 3 that needs the
// signing key that readers pinned, so a replaced seat document cannot stop the abort.
const mustAbort = (i, text) => text && canWriteAs(i) && !abortSent(i);
// A published abort document is one that exists and holds a reason.
const abortSent = (i) => !!state.abort[i] && isStr(state.abort[i].reason);
// A seat that stopped its setup also stops the seats that hold no key share yet.
export const remoteAborts = () => seatIds().filter(abortSent);
async function publishAbort(i, text) {
  const gid = state.gid;
  await sdb.doc("groups/" + gid + "/abort/" + i)
    .set(await signedDoc(gid, "abort/" + i, i, { reason: text }));
}

const needR1 = (i, s) => !state.dkg1[i] && !s.keyPackage;
// Round 2 needs every seat taken (for their encryption keys) and every round-1 package.
const needR2 = (s) => s.r1secret && !s.r2secret && !s.keyPackage && allSeated() && allR1();
// Round 3 (local): decrypt the shares sent to me, compute my key share.
const needR3 = (i, s) => s.r2secret && !s.keyPackage && allR1() && r2For(i);
// The done document is the only proof to the other seats that this seat holds its key share. A
// failed write is retried until it succeeds.
const needDone = (i, s) => s.keyPackage && !s.doneSent && !state.done[i];

function stepV1(i, s) {
  if (needR1(i, s)) return launch("r1:" + i, () => round1V1(i));
  if (needR2(s)) return launch("r2:" + i, () => round2V1(i));
  if (needR3(i, s)) return launch("r3:" + i, () => round3V1(i));
  if (needDone(i, s)) return launch("done:" + i, () => publishDone(i));
  return false;
}

async function publishDone(i) {
  const gid = state.gid, s = sec(gid, i);
  const fields = { groupKey: s.groupKey, publicKeyPackage: S(s.publicKeyPackage), at: Date.now() };
  await sdb.doc("groups/" + gid + "/done/" + i).set(await signedDoc(gid, "done/" + i, i, fields));
  await putSec(gid, i, { doneSent: true });
  log("seat " + i + ": key share ready, wallet key " + s.groupKey.slice(0, 12) + "…");
}

async function round1V1(i) {
  const g = state.g, gid = state.gid, s = sec(gid, i);
  let secret = s.r1secret, pkg = s.r1package;
  if (!secret) { const r = J(Z.dkgPart1(i, g.n, g.t)); secret = r.secret; pkg = r.package; putSec(gid, i, { r1secret: secret, r1package: pkg }); }
  await sdb.doc("groups/" + gid + "/dkg1/" + i).set({ package: pkg, at: Date.now() });
  log("seat " + i + ": round 1 commitment published");
}

async function round2V1(i) {
  const gid = state.gid, s = sec(gid, i);
  const r1 = {}; for (const j of seatIds()) if (j !== i) r1[j] = state.dkg1[j].package;
  const r = J(Z.dkgPart2(S(s.r1secret), S(r1)));
  for (const [to, pkg] of Object.entries(r.outgoing)) {
    const sealed = Z.boxSeal(s.boxSk, state.seats[to].boxPk, gid + ":" + i + "->" + to, S(pkg));
    await sdb.doc("groups/" + gid + "/dkg2/" + i + "-" + to).set({ sealed, at: Date.now() });
  }
  putSec(gid, i, { r2secret: r.secret, r1secret: null });
  log("seat " + i + ": " + Object.keys(r.outgoing).length + " encrypted shares sent");
}

// Opens the box that seat j sent to seat i. A box that does not open comes from another version
// of Zigs: a version before 16 October 2026 made its box key with another label.
function openBox(j, i, s, sealed) {
  const context = state.gid + ":" + j + "->" + i;
  let text;
  try { text = Z.boxOpen(s.boxSk, state.seats[j].boxPk, context, sealed); }
  catch { throw new Error("The message of seat " + j + " was made by another version of Zigs"); }
  try { return J(text); } catch { throw new Error("Seat " + j + " sent an unreadable message"); }
}

export async function round3V1(i) {
  const gid = state.gid, s = sec(gid, i);
  const r1 = {}, r2 = {};
  for (const j of seatIds()) if (j !== i) {
    r1[j] = state.dkg1[j].package;
    const sealed = state.dkg2[j + "-" + i].sealed;
    if (!isStr(sealed)) throw new Error("Seat " + j + " sent an unreadable message.");
    // A box that does not open ends this seat's setup, as in version 2: a retry cannot fix it.
    r2[j] = await ceremonyStep(i, () => openBox(j, i, s, sealed));
  }
  const r = J(Z.dkgPart3(S(s.r2secret), S(r1), S(r2)));
  putSec(gid, i, { keyPackage: r.key_package, publicKeyPackage: r.public_key_package, groupKey: r.group_key, r2secret: null, r1package: null });
}

// Verify the published wallet against my own DKG output.
// The store's verify documents are claims anyone with the wallet key can write, so each seat
// keeps its own result, tied to the exact wallet document, and checks again when it changes.
function verifyStep(i, s) {
  const wk = walletKey();
  if (!s.keyPackage || !state.wallet || s.checkedWallet === wk || s.rejectedWallet === wk) return;
  once("verify:" + i, async () => {
    const gid = state.gid, { ok, error } = verifyOutcome(s);
    // Sign first: this browser keeps its result only for a seat that can tell the others.
    const doc = await signedDoc(gid, "verify/" + i, i, { ok, error, at: Date.now() });
    await putSec(gid, i, ok ? { checkedWallet: wk, rejectedWallet: null } : { rejectedWallet: wk });
    await sdb.doc("groups/" + gid + "/verify/" + i).set(doc);
    log("seat " + i + (ok ? ": wallet verified, ak equals my wallet key" : ": WALLET REJECTED: " + error));
  });
}

function verifyOutcome(s) {
  try { verifyWallet(s); return { ok: true, error: null }; }
  catch (e) { return { ok: false, error: e.message || String(e) }; }
}

// The wallet must name its group's network. A seat that holds sk checks every part of the wallet,
// so only version 2 verification applies to it, whatever the stored documents say. A seat without
// sk never accepts a version 2 or 3 wallet.
function verifyWallet(s) {
  checkNetwork(state.wallet, netName(state.g));
  if (s.vaultSk) return Z.walletVerifyV2(S(state.wallet), S(s.publicKeyPackage), s.vaultSk);
  if (usesV2(groupVersion())) {
    throw new Error("This seat holds no setup secret for a version 2 or 3 wallet. "
      + "Do not use this wallet.");
  }
  return Z.walletVerify(S(state.wallet), S(s.publicKeyPackage));
}

const v2Secret = () => localSeats().map((i) => sec(state.gid, i))
  .find((s) => s.vaultSk && s.publicKeyPackage);
export const canCreateWallet = () => isCreator() && !state.wallet && keysAgree()
  && (!usesV2(groupVersion()) || !!v2Secret())
  && canWriteAs(1);

async function walletStands(gid) {
  const cur = await sdb.doc("groups/" + gid + "/meta/wallet").get();
  if (!cur.exists) return false;
  if (!signedMode(gid)) return true;
  const d = cur.data();
  const part = { rel: "meta/wallet", by: d.by, sig: d.sig, fields: docFields(d), need: 1 };
  return (await partNow(gid, part)) !== "no";
}

export async function createWallet() {
  const g = state.g, gid = state.gid, base = "groups/" + gid;
  // The wallet snapshot can arrive after the DKG ones; never replace a published wallet. In a
  // version 3 wallet, a stored document that is not signed by seat 1 is no wallet.
  if (await walletStands(gid)) return;
  const birthday = await Z.latestHeight(await pickServer(netOf(g)));
  if (state.gid !== gid) return;   // the person opened another wallet while the server answered
  const net = g.network || "testnet", mine = usesV2(groupVersion()) ? v2Secret() : null;
  const w = J(mine ? Z.walletCreateV2(S(mine.publicKeyPackage), net, mine.vaultSk)
    : Z.walletCreate(state.done[1].publicKeyPackage, net));
  const doc = await signedDoc(gid, "meta/wallet", 1, { ...w, birthday, at: Date.now() });
  await sdb.doc(base + "/meta/wallet").set(doc);
  log("wallet created: " + w.address.slice(0, 24) + "…");
}

// The safety number covers the wallet id, t, n, the network and every seat's encryption key. The
// signers compare it out of band. A confirm document is only a claim, so a seat also keeps the
// number its person confirmed ("confirmed"), and the ceremony runs only when both agree with the
// local number.
export function safetyNo() {
  if (!state.g || !allSeated()) return null;
  const keys = {}; for (const i of seatIds()) keys[i] = state.seats[i].boxPk;
  try { return Z.safetyNumber(state.gid, state.g.t, state.g.n, netName(state.g), S(keys)); }
  catch { return null; }
}
const gateOf = (s) => confirmGate(safetyNo(), s.confirmed, state.confirm, seatIds());
const canConfirm = (s) => !s.keyPackage && !s.aborted && usesV2(seatMode(s));
export const confirmSeatsOf = () => localSeats()
  .filter((i) => canWriteAs(i) && canConfirm(sec(state.gid, i)));
// A browser that holds every seat has nobody else to compare with.
export const holdsAllSeats = () => localSeats().length === state.g.n;
export const confirmedBy = (no) => seatIds().filter((i) => state.confirm[i] && state.confirm[i].number === no);

// The reason a seat of this browser ended its setup, or null. This counts every seat that the
// browser holds a secret for, also a seat that the store shows under another identity.
export const abortedText = () => mySeatSecrets(state.gid).map(([, s]) => s.aborted).find(Boolean) || null;

// Writes the confirm document of a seat whose person confirmed but whose document is missing, and
// confirms for itself when this browser holds every seat.
export function reactConfirm() {
  const no = usesV2(groupVersion()) ? safetyNo() : null;
  if (!no) return;
  const auto = holdsAllSeats();
  const todo = confirmSeatsOf().filter((i) => {
    const same = sec(state.gid, i).confirmed === no;
    return same ? !state.confirm[i] : auto;
  });
  if (todo.length) once("confirm", () => confirmSeats(todo, no));
}

export async function confirmSeats(ids, no) {
  const gid = state.gid;
  for (const i of ids) {
    // Sign first: a seat that cannot sign must not keep a number that nobody saw.
    const doc = await signedDoc(gid, "confirm/" + i, i, { number: no });
    await putSec(gid, i, { confirmed: no });
    await sdb.doc("groups/" + gid + "/confirm/" + i).set(doc);
  }
  log("safety number confirmed for seat " + ids.join(", "));
}

const DIFFERENT = "Signers saw different setup data";
// A failed check ends this seat's setup for good. The reason stays in the seat, so the reactor
// does not retry it.
async function abortSeat(i, text) {
  await putSec(state.gid, i, { aborted: text });
  setTimeout(react, 0);
  throw new Error(text);
}
async function ceremonyStep(i, compute) {
  try { return compute(); } catch (e) { return abortSeat(i, abortText(e && e.message ? e.message : e)); }
}

// Seats whose setup secret this browser could not save. Another try waits for the person.
export const saveFailed = new Set();
const needR1V2 = (i, s) => needR1(i, s) && !saveFailed.has(skey(state.gid, i));

function stepV2(i, s) {
  const open = gateOf(s) === "ok";
  if (open && needR1V2(i, s)) return launch("r1:" + i, () => round1V2(i));
  if (open && needR2(s)) return launch("r2:" + i, () => round2V2(i));
  if (needR3(i, s)) return launch("r3:" + i, () => round3V2(i));
  if (needDone(i, s)) return launch("done:" + i, () => publishDone(i));
  return false;
}

export const SAVE_FAILED = "This browser could not save your setup secret, so setup did not start.";

// The secret part of sk is saved before its commitment goes out: a seat that loses it cannot finish.
async function round1V2(i) {
  const g = state.g, gid = state.gid;
  if (!sec(gid, i).r1secret) {
    const r = J(Z.dkgPart1(i, g.n, g.t));
    const made = { r1secret: r.secret, r1package: r.package, skPart: randomHex32() };
    if (!(await putSec(gid, i, made))) {
      putSec(gid, i, { r1secret: null, r1package: null, skPart: null });
      saveFailed.add(skey(gid, i));
      throw new Error(SAVE_FAILED);
    }
  }
  const s = sec(gid, i);
  const commit = Z.skCommit(gid, i, state.seats[i].boxPk, s.skPart);
  const fields = { package: s.r1package, commit, at: Date.now() };
  await sdb.doc("groups/" + gid + "/dkg1/" + i).set(await signedDoc(gid, "dkg1/" + i, i, fields));
  log("seat " + i + ": round 1 commitment published");
}

// The echo is one digest of every seat's round-1 document. Each seat puts it in its round-2
// documents, so a seat that saw other data than the rest is found before anyone uses its data.
function echoNow() {
  const r1 = {};
  for (const j of seatIds()) {
    const d = state.dkg1[j];
    if (!isStr(d.commit)) throw new Error("Seat " + j + " sent no commitment, so its app is too old for this wallet");
    r1[j] = { package: d.package, commit: d.commit };
  }
  return Z.dkgEcho(state.gid, S(r1));
}

async function round2V2(i) {
  const gid = state.gid, s = sec(gid, i);
  const { echo, boxes, secret } = await ceremonyStep(i, () => {
    const echo = s.echo || echoNow();
    const r1 = {}; for (const j of seatIds()) if (j !== i) r1[j] = state.dkg1[j].package;
    const r = J(Z.dkgPart2(S(s.r1secret), S(r1)));
    const boxes = {};
    for (const [to, pkg] of Object.entries(r.outgoing)) {
      boxes[to] = Z.boxSeal(s.boxSk, state.seats[to].boxPk, gid + ":" + i + "->" + to, S({ package: pkg, r: s.skPart }));
    }
    return { echo, boxes, secret: r.secret };
  });
  await putSec(gid, i, { echo });
  // Sign every document first, then write them, and only then drop the round-1 secret.
  const docs = [];
  for (const [to, sealed] of Object.entries(boxes)) {
    const rel = "dkg2/" + i + "-" + to;
    docs.push([rel, await signedDoc(gid, rel, i, { sealed, echo, at: Date.now() })]);
  }
  for (const [rel, doc] of docs) await sdb.doc("groups/" + gid + "/" + rel).set(doc);
  await putSec(gid, i, { r2secret: secret, r1secret: null });
  log("seat " + i + ": " + Object.keys(boxes).length + " encrypted shares sent");
}

// Opens the box seat j sent to seat i: its round-2 package and its secret part of sk.
export function unboxFrom(j, i, s) {
  const d = state.dkg2[j + "-" + i];
  if (d.echo !== s.echo) throw new Error(DIFFERENT);
  const bad = new Error("Seat " + j + " sent an unreadable message");
  if (!isStr(d.sealed)) throw bad;
  const box = openBox(j, i, s, d.sealed);
  if (!box || !isStr(box.r) || !box.package || typeof box.package !== "object") throw bad;
  return box;
}

// Every check of round 3 runs before the key share is made: the echo twice (my stored echo, and
// each seat's), every commitment, and then the key share itself.
function openRound3(i, s) {
  const r1 = {}, r2 = {};
  const parts = { [i]: { r: s.skPart, commit: state.dkg1[i].commit, boxPk: state.seats[i].boxPk } };
  if (!s.echo || echoNow() !== s.echo) throw new Error(DIFFERENT);
  for (const j of seatIds()) {
    if (j === i) continue;
    const box = unboxFrom(j, i, s);
    r1[j] = state.dkg1[j].package;
    r2[j] = box.package;
    parts[j] = { r: box.r, commit: state.dkg1[j].commit, boxPk: state.seats[j].boxPk };
  }
  const sk = Z.vaultSk(state.gid, s.echo, S(parts));
  return { ...J(Z.dkgPart3(S(s.r2secret), S(r1), S(r2))), sk };
}

async function round3V2(i) {
  const gid = state.gid, s = sec(gid, i);
  const r = await ceremonyStep(i, () => openRound3(i, s));
  const saved = await putSec(gid, i, {
    keyPackage: r.key_package, publicKeyPackage: r.public_key_package, groupKey: r.group_key,
    vaultSk: r.sk, skPart: null, echo: null, r2secret: null, r1package: null,
  });
  if (!saved) showBanner("bad", "This browser could not save your key share. Keep this tab open, and use Back up.");
}

// `from` is the wallet this one replaces. The old wallet gets only the new id, never its key:
// signers left out of the new wallet must not get its viewing key.
export async function createGroup(name, n, t, from = null, network = "testnet") {
  // Signed writes need a signing key for every seat, so check before anything is made.
  if (!(await canSign())) throw new Error(NO_SIGNING_SEAT);
  const ref = sdb.collection("groups").doc();
  const key = new Uint8Array(32); crypto.getRandomValues(key);
  putKey(ref.id, btoa(String.fromCharCode(...key)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
  await ref.set({
    name, n, t, network, version: 3, createdBy: me, createdAt: Date.now(),
    movedFrom: from || undefined,
  });
  if (from) await sdb.doc("groups/" + from).update({ movedTo: ref.id, movedAt: Date.now() });
  openGroup(ref.id);
  await takeSeat(1, 3);
}

// The signing key of a new seat, or null where Ed25519 is missing (a seat then has no messages).
// A version 3 seat needs one.
async function newSeatKey(version) {
  const sign = await newSignKey().catch(() => null);
  if (!sign && version === 3) throw new Error(NO_SIGNING_SEAT);
  return sign;
}

// The seat keeps the version of its wallet and its own box key. The store can show another
// version or key later (reactStops).
export async function takeSeat(i, version = groupVersion()) {
  if (!Z || !version) return;
  const gid = state.gid, sign = await newSeatKey(version);
  const ref = sdb.doc("groups/" + gid + "/seats/" + i);
  const lease = await ref.acquire({ holder: crypto.randomUUID(), ttlMs: 5000 });
  if (!lease.acquired) { showBanner("bad", "Someone else is taking seat " + i + " right now."); return; }
  const cur = await ref.get();
  if (cur.exists && cur.data().uid) { showBanner("bad", "Seat " + i + " is already taken."); return; }
  const kp = J(Z.boxKeypair());
  putSec(gid, i, { boxSk: kp.sk, version, uid: me, ...sign });
  const name = user ? (await user.me()).name : "";
  const doc = { uid: me, name, boxPk: kp.pk, at: Date.now(), signPk: sign?.signPk };
  // In a version 3 wallet the seat signs its own document with the new key. Readers pin the key
  // only when this signature checks out.
  if (version === 3) {
    const text = Z.docPayload(gid, "seats/" + i, i, S(doc));
    Object.assign(doc, { by: i, sig: await signMsg(sign.signSk, text) });
  }
  await ref.set(doc);
  // Saved only after the store holds the seat: a failed take must not look like a replaced key.
  await putSec(gid, i, { boxPk: kp.pk });
  log("you took seat " + i);
}
const walletKey = () => state.wallet ? S(state.wallet) : "";
// This browser's own result for its seats; other seats' results come from the store.
export function seatCheck(i) {
  const s = localSeats().includes(i) ? sec(state.gid, i) : null;
  if (s) return s.checkedWallet === walletKey() ? true : s.rejectedWallet === walletKey() ? false : null;
  return state.verify[i] ? !!state.verify[i].ok : null;
}
export const myVerified = () => localSeats().some((i) => seatCheck(i) === true);
export const verifiedCount = () => seatIds().filter((i) => seatCheck(i) === true).length;
export const rejectedSeats = () => seatIds().filter((i) => seatCheck(i) === false);
