// Wallet rooms, read marks, notices and direct chats.
import { skey } from "./util.js";
import {
  byTime, canSign, countUnread, dmText, joinBlock, keyState, membersToPin, newRoom, newSignKey,
  parseDm, parseMsg, pickRoom, pin, pinMember, pinnedMembers, signedText, signMsg, validPk,
  validRoom, verifyMsg,
} from "./chat.js";
import { inbox, log, state, ui } from "./app-state.js";
import { oldest, readLocal, S, saveMerged, withTimeout, writeLocal } from "./app-kit.js";
import { Z } from "./app-engine.js";
import {
  chats, gkeys, mySeatSecrets, persist, putSec, sec, secrets, storageOk,
} from "./app-keystore.js";
import { localSeats, seatIds } from "./app-seats.js";
import { BAD_CONTACT_LINK, badChatLink, openChat } from "./app-links.js";
import { refilter, signPins } from "./app-filter.js";
import { pendingChats, roomKeys, sdb, user } from "./app-groups.js";
import { groupName } from "./app-dom.js";
import { once, render, walletReady } from "./app-rest.js";

const roomPins = readLocal("zf-rooms");      // wallet id -> first room id seen
const readMarks = readLocal("zf-read");      // "room id:thread" -> time of the newest message read
export const rooms = {};                            // wallet id -> its room id, while it matches the pin
export const roomWarn = new Map(), roomSubs = new Map(), chat = {}, tried = new Set(), checked = new Map();
export let signing = null;                          // does this browser have Ed25519? null until known
canSign().then((ok) => { signing = ok; refilter(); });

const isWalletId = (id) => !!gkeys[id] || !!chats.list[id];   // ids of chats are taken too
const mineIn = (id) => chats.list[id] ? [chats.list[id].member] : mySeatSecrets(id).map(([i]) => i);
// The id that the read marks of a conversation hang on: the room of a wallet, or the chat itself.
const markId = (id) => chats.list[id] ? id : rooms[id];
const MAX_SKEW = 10 * 60000;   // a message dated further ahead than this is never "unread"
// Messages that can be unread: the wallet thread, and the threads of payments that exist. Without
// the second rule, a thread of no payment would hold a count that no drawer can clear.
function countable(gid, list = chat[gid] || []) {
  const horizon = Date.now() + MAX_SKEW;
  if (chats.list[gid]) return list.filter((m) => m.at <= horizon);
  const sessions = gid === state.gid ? state.sessions : inbox[gid] || [];
  const threads = new Set(["wallet", ...sessions.map((ss) => "pay:" + ss.id)]);
  return list.filter((m) => threads.has(m.thread) && m.at <= horizon);
}
export const unreadIn = (gid, thread) => markId(gid)
  ? countUnread(countable(gid), mineIn(gid), readMarks, markId(gid), thread) : 0;
export const NO_SIGNING = "This browser cannot sign messages. "
  + "Use a current Chrome, Edge, Firefox or Safari.";
const ROOM_CHANGED = "The message room of this wallet changed. Messages are paused. "
  + "Ask your signers.";
const ROOM_MISSING = "The message room of this wallet is missing. Messages are paused. "
  + "Ask your signers.";
const ROOM_WARN = { changed: ROOM_CHANGED, missing: ROOM_MISSING };

// The reactor runs often, and each failed write counts against the server's rate limit.
function throttled(key, fn) {
  if (tried.has(key)) return;
  tried.add(key);
  setTimeout(() => tried.delete(key), 30000);
  once(key, fn);
}

export function syncRooms() {
  if (!sdb || !Z) return;
  recallRooms(); adoptRooms(); watchRooms(); ensureRooms(); watchChats();
}

// Seat secrets keep each room (and backups carry it), so a room field that is later lost or
// damaged in the store cannot take the room with it after a reload.
function recallRooms() {
  for (const [k, s] of Object.entries(secrets)) {
    if (!s || !validRoom(s.room)) continue;
    roomKeys[s.room.id] ||= s.room.key;
    if (pin(roomPins, k.split(":")[0], s.room.id) === "new") saveMerged("zf-rooms", roomPins, oldest);
  }
}

function adoptRooms() {
  for (const g of state.groups) {
    let pick = pickRoom(g.id, g.room, roomPins, isWalletId);
    const known = pick === "use" && roomKeys[g.room.id];
    if (known && known !== g.room.key) pick = "changed";   // the key is pinned with the id
    if (pick === "use") learnRoom(g.id, g.room);
    const id = roomOf(g, pick);
    if (id) rooms[g.id] = id; else delete rooms[g.id];
    const warn = id ? null : ROOM_WARN[pick];
    if (warn) roomWarn.set(g.id, warn); else roomWarn.delete(g.id);
  }
}

function learnRoom(gid, room) {
  roomKeys[room.id] ||= room.key;   // the first key seen for a room id wins
  if (pin(roomPins, gid, room.id) === "new") saveMerged("zf-rooms", roomPins, oldest);
  for (const [i, s] of mySeatSecrets(gid)) if (!validRoom(s.room)) putSec(gid, i, { room });
}

// A wallet document that lost its room field keeps the pinned room, while this page holds its key.
function roomOf(g, pick) {
  const id = pick === "use" ? g.room.id : pick === "missing" ? roomPins[g.id] : null;
  return roomKeys[id] ? id : null;
}

// Reads the rooms of every wallet where this browser holds a seat, open or not.
function watchRooms() {
  for (const [gid, w] of roomSubs) {
    if (rooms[gid] === w.id) continue;
    w.off(); roomSubs.delete(gid); delete chat[gid];
  }
  for (const [gid, id] of Object.entries(rooms)) {
    if (roomSubs.has(gid) || !mySeatSecrets(gid).length) continue;
    const off = sdb.collection("groups/" + id + "/messages").onSnapshot((snap) => {
      const list = snap.docs.map((d) => parseMsg(d.id, d.data())).filter(Boolean);
      onMessages(gid, list.sort(byTime));
      render();
    }, (e) => log("message room error: " + e.code));
    roomSubs.set(gid, { id, off });
  }
}

function ensureRooms() {
  for (const g of state.groups) {
    if (g.unreadable || !mySeatSecrets(g.id).length) continue;
    const pick = pickRoom(g.id, g.room, roomPins, isWalletId);
    if (pick === "none" || pick === "missing") throttled("room:" + g.id, () => publishRoom(g.id));
  }
}

// Writes the room field of a wallet that names none. A wallet with a pinned room gets that room
// again, and never a new one: a new room would split the signers.
async function publishRoom(gid) {
  const pinned = roomPins[gid], room = pinned ? { id: pinned, key: roomKeys[pinned] } : newRoom();
  if (!room.key) return;   // the pinned room's key is not in this page: another signer can help
  const ref = sdb.doc("groups/" + gid);
  if (!(await ref.acquire({ holder: crypto.randomUUID(), ttlMs: 10000 })).acquired) return;
  const cur = await ref.get();
  const pick = cur.exists && pickRoom(gid, cur.data().room, roomPins, isWalletId);
  if (pick !== "none" && pick !== "missing") return;
  await ref.update({ room });
  log("message room written");
}

// A seat made before messages gets its signing key once. The seat document keeps the first key.
// The lease comes first, so two tabs of one browser cannot make two keys. The key is published
// only after this browser saved it. An older backup file lacks the key, so a new key on a
// backed-up seat clears `backupSaved` and the page asks for a new backup.
export function ensureSignKey(gid, i) {
  if (!signing || validPk(state.seats[i].signPk)) return;
  throttled("sign:" + gid + ":" + i, async () => {
    const ref = sdb.doc("groups/" + gid + "/seats/" + i);
    if (!(await ref.acquire({ holder: crypto.randomUUID(), ttlMs: 10000 })).acquired) return;
    const s = sec(gid, i), made = s.signPk ? null : await newSignKey();   // read after the lease
    const unsaved = made && s.keyPackage ? { backupSaved: false } : {};
    if (!(await putSec(gid, i, { ...made, ...unsaved }))) return;
    const cur = await ref.get();
    if (cur.exists && !validPk(cur.data().signPk)) await ref.update({ signPk: sec(gid, i).signPk });
  });
}

// Seats of this browser that hold the signing key their seat document names.
export const sendSeats = () => localSeats().filter((i) => {
  const s = sec(state.gid, i);
  return s.signSk && s.signPk === state.seats[i].signPk;
});

// Why this browser cannot send in the open wallet, or null.
export function chatWhy() {
  const gid = state.gid;
  if (roomWarn.has(gid)) return roomWarn.get(gid);
  if (!localSeats().length) return "Take a seat to read and send messages.";
  if (!rooms[gid]) return "The message room is being set up.";
  if (signing === false) return NO_SIGNING;
  if (sendSeats().length) return null;
  const making = localSeats().some((i) => !validPk(state.seats[i].signPk));
  return making ? "Your seat key is being created."
    : "This browser has no signing key for your seat, so it cannot send messages. "
      + "A backup file from before messages does not hold this key.";
}

export async function sendMessage(thread, text, seat) {
  const gid = state.gid, room = rooms[gid];
  const ref = sdb.collection("groups/" + room + "/messages").doc();
  const m = { id: ref.id, seat, thread, text, at: Date.now() };
  const sig = await signMsg(sec(gid, seat).signSk, signedText(gid, room, m));
  // A send with no answer fails after 10 s. It can still arrive later, so a retry can repeat it.
  await withTimeout(ref.set({ seat, thread, text, at: m.at, sig }), 10000, "The group server");
}

// "yes", "no", "changed" or "wait" for a message of the open wallet.
export function trust(m, roomId) {
  const gid = state.gid, seat = state.seats[m.seat], pk = signPins[skey(gid, m.seat)];
  const isSeat = !!seat && seatIds().includes(m.seat);
  return verdict(m, signedText(gid, roomId, m), isSeat, seat && seat.signPk, pk);
}

// `isMember` and `memberPk` come from the store, `pinnedPk` from this browser.
function verdict(m, text, isMember, memberPk, pinnedPk) {
  const gate = keyState(isMember, memberPk, pinnedPk);
  if (gate !== "check") return gate;
  const ok = cachedCheck(pinnedPk, m.sig, text);
  return ok === null ? "wait" : ok ? "yes" : "no";
}

// The key holds everything the result depends on, so no two messages can share an entry.
// null while the check runs. A miss clears a full cache; results that arrive later still fill it.
function cachedCheck(pk, sig, text, done = render, cache = checked) {
  const id = S([pk, sig, text]);
  if (cache.has(id)) return cache.get(id);
  if (cache.size >= 5000) cache.clear();
  cache.set(id, null);
  verifyMsg(pk, sig, text).then((ok) => { cache.set(id, ok); done(); });
  return null;
}

// The threads this browser shows right now: a chat, or in a wallet the wallet thread (tab or setup
// page) and a payment.
function openThreads() {
  const cid = state.cid;
  return cid ? (chats.list[cid] ? [[cid, "dm"]] : []) : walletThreads();
}

function walletThreads() {
  const gid = state.gid;
  if (!rooms[gid] || !state.g || state.g.unreadable) return [];
  const out = [];
  if (!walletReady() || ui.tab === "messages") out.push([gid, "wallet"]);
  if (state.sid && state.wallet) out.push([gid, "pay:" + state.sid]);
  return out;
}

// A window that is visible but has no focus (open beside another app) is not being read.
const watching = () => document.visibilityState === "visible" && document.hasFocus();
const viewing = (gid, thread) => watching()
  && openThreads().some(([g, t]) => g === gid && t === thread);

// ponytail: the read mark is the time of the newest message from another seat that this browser
// showed. A sender clock behind another sender's clock can make its new messages count as read.
// A message dated more than MAX_SKEW ahead is shown but never counted. Upgrade path: seen ids.
export function markRead() {
  if (!watching()) return;
  let changed = false;
  for (const [gid, thread] of openThreads()) {
    const mine = mineIn(gid);
    const theirs = countable(gid).filter((m) => m.thread === thread && !mine.includes(m.seat));
    const top = Math.max(0, ...theirs.map((m) => m.at));
    const k = markId(gid) + ":" + thread;
    if (top > (readMarks[k] || 0)) { readMarks[k] = top; changed = true; }
  }
  if (changed) saveMerged("zf-read", readMarks, Math.max);
}

// The first snapshot holds old messages; only later ones can notify.
function onMessages(gid, list) {
  const old = chat[gid];
  chat[gid] = list;
  if (!old) { seedMarks(markId(gid), list, chats.list[gid] ? "dm" : "wallet"); return; }
  const known = new Set(old.map((m) => m.id));
  const fresh = list.filter((m) => !known.has(m.id) && !viewing(gid, m.thread)
    && countUnread(countable(gid, [m]), mineIn(gid), readMarks, markId(gid)));
  if (fresh.length) notifyNew(gid, fresh);
}

// A new device, private window or Tor session has no read marks. It treats the history it finds
// as read, so old messages do not all show as unread. An empty first visit leaves a zero mark on
// the main thread, so messages that come before the next visit are unread.
function seedMarks(roomId, list, main) {
  if (!roomId || Object.keys(readMarks).some((k) => k.startsWith(roomId + ":"))) return;
  const now = Date.now();
  readMarks[roomId + ":" + main] = 0;
  for (const m of list) {
    const k = roomId + ":" + m.thread;
    readMarks[k] = Math.max(readMarks[k] || 0, Math.min(m.at, now));
  }
  saveMerged("zf-read", readMarks, Math.max);
}

// A notification cannot wait for the signature check. It names the contact only when every new
// message comes from the member id that this browser pinned for the contact.
function notifyTitle(gid, fresh) {
  if (!chats.list[gid]) return "New message in " + groupName(gid);
  return fresh.every((m) => m.from === contactOf(gid)) ? "New message from " + contactName(gid)
    : "New message in a chat";
}

function notifyNew(gid, fresh) {
  if (!ui.notify || !("Notification" in window) || Notification.permission !== "granted") return;
  try { new Notification(notifyTitle(gid, fresh), { tag: gid }); }
  catch (e) { log("could not show a notification: " + (e.message || e)); }
}

export async function toggleNotify() {
  if (!ui.notify && (await Notification.requestPermission()) !== "granted") {
    throw new Error("This browser did not allow notifications. Change this in the site settings.");
  }
  ui.notify = !ui.notify;
  try { localStorage.setItem("zf-notify", ui.notify ? "1" : ""); } catch { /* no storage */ }
}

// A direct chat is a store namespace of its own with two members (PROTOCOL.md 14). It has no
// wallet document, so it never lists as a wallet. One personal key, chats.profile, signs them all.
export const chatPins = readLocal("zf-chatpins");   // "chat id:member id" -> first signing key seen
export const chatSubs = new Map(), chatMembers = {}, joinLinks = new Map();

export const contactOf = (cid) => pinnedMembers(chatPins, cid).find((id) => id !== chats.list[cid].member);

export function contactName(cid) {
  const members = chatMembers[cid], id = contactOf(cid);
  if (!members) return "Loading…";
  return id ? (members[id] || {}).name || "Your contact" : "Waiting for your contact";
}

function pinChat(cid, member, pk) {
  const r = pinMember(chatPins, cid, member, pk);
  if (r === "new") saveMerged("zf-chatpins", chatPins, oldest);
}

// ponytail: two tabs that make their first chat in the same instant can make two keys. Upgrade
// path: a lease on the store, as for seat keys.
async function ensureProfile() {
  if (!(await canSign())) throw new Error(NO_SIGNING);
  chats.profile ||= await newSignKey();
  return chats.profile;
}

function readMembers(cid) {
  return withTimeout(new Promise((res) => {
    const off = sdb.collection("groups/" + cid + "/members")
      .onSnapshot((snap) => { res(snap.docs); queueMicrotask(() => off()); });
  }), 10000, "The group server");
}

// The chat and the key are saved here before the member document goes to the server, so a failed
// save cannot leave a place taken that this browser does not know about.
async function enterChat(cid, key) {
  if (!storageOk) throw new Error("This browser cannot save data, so it cannot keep a chat.");
  const profile = await ensureProfile(), member = newRoom().id;
  chats.list[cid] = { key, member, at: Date.now() };
  if (!(await persist())) {
    delete chats.list[cid];
    throw new Error("Could not save the chat in this browser, so it was not opened.");
  }
  try {
    const name = user ? (await user.me()).name : "";
    await sdb.doc("groups/" + cid + "/members/" + member)
      .set({ name, signPk: profile.signPk, at: Date.now() });
  } catch (e) {
    delete chats.list[cid];
    await persist();
    throw e;
  }
  pinChat(cid, member, profile.signPk);
  openChat(cid);
}

export const createChat = () => { const { id, key } = newRoom(); return enterChat(id, key); };

// The lease keeps two openers of one link apart. A chat holds two members. The link stays in
// joinLinks after a failure, so the person can try again; its secret is no longer in the URL.
export async function joinChat(cid, key) {
  pendingChats[cid] = key;
  try {
    if (badChatLink(cid, key)) throw new Error(BAD_CONTACT_LINK);
    await ensureProfile();   // a browser without Ed25519 stops before it takes the second place
    const lease = await sdb.doc("groups/" + cid + "/meta/join")
      .acquire({ holder: crypto.randomUUID(), ttlMs: 10000 });
    const docs = await readMembers(cid);
    const blocked = joinBlock(docs.length, lease.acquired);
    if (blocked) throw new Error(blocked);
    onMembers(cid, docs);   // pins the first member before this browser becomes the second
    await enterChat(cid, key);
    joinLinks.delete(cid);
  } finally { delete pendingChats[cid]; }
}

export async function leaveChat(cid) {
  const was = chats.list[cid];
  delete chats.list[cid];
  if (!(await persist())) {
    chats.list[cid] = was;
    throw new Error("Could not save this change in the browser, so the chat stays.");
  }
  for (const k of Object.keys(chatPins)) if (k.startsWith(cid + ":")) delete chatPins[k];
  writeLocal("zf-chatpins", chatPins);
  openChat(null);
}

function watchChats() {
  for (const [cid, off] of chatSubs) {
    if (chats.list[cid]) continue;
    off(); chatSubs.delete(cid); delete chat[cid]; delete chatMembers[cid];
  }
  if (state.cid && !chats.list[state.cid]) openChat(null);
  for (const cid of Object.keys(chats.list)) {
    if (!chatSubs.has(cid)) chatSubs.set(cid, subscribeChat(cid));
  }
}

function subscribeChat(cid) {
  const base = "groups/" + cid, fail = (e) => log("chat error: " + e.code);
  const offs = [
    sdb.collection(base + "/members").onSnapshot((snap) => {
      onMembers(cid, snap.docs); healMember(cid); render();
    }, fail),
    sdb.collection(base + "/messages").onSnapshot((snap) => {
      const list = snap.docs.map((d) => parseDm(d.id, d.data())).filter(Boolean);
      onMessages(cid, list.sort(byTime)); render();
    }, fail),
  ];
  return () => offs.forEach((off) => off());
}

function onMembers(cid, docs) {
  const members = {};
  for (const d of docs) {
    const x = d.data();
    const name = typeof x.name === "string" ? x.name.slice(0, 40) : "";
    members[d.id] = { name, signPk: x.signPk };
  }
  const mine = (chats.list[cid] || {}).member;
  for (const id of membersToPin(members, pinnedMembers(chatPins, cid), mine)) {
    pinChat(cid, id, members[id].signPk);
  }
  chatMembers[cid] = members;
}

// A chat saved while the connection dropped may lack this browser's member document. It is written
// again while the chat has room, so the contact can still join.
function healMember(cid) {
  const c = chats.list[cid], members = chatMembers[cid] || {};
  if (!c || members[c.member] || Object.keys(members).length >= 2) return;
  throttled("member:" + cid, async () => {
    const name = user ? (await user.me()).name : "";
    await sdb.doc("groups/" + cid + "/members/" + c.member)
      .set({ name, signPk: chats.profile.signPk, at: Date.now() });
  });
}

export async function sendDm(cid, text) {
  const ref = sdb.collection("groups/" + cid + "/messages").doc();
  const m = { id: ref.id, from: chats.list[cid].member, at: Date.now(), text };
  const sig = await signMsg(chats.profile.signSk, dmText(cid, m));
  await withTimeout(ref.set({ from: m.from, text, at: m.at, sig }), 10000, "The group server");
}

// Like trust(), for a message of a chat. A sender that is not pinned is "unknown".
export function dmTrust(cid, m) {
  const pk = chatPins[cid + ":" + m.from], member = (chatMembers[cid] || {})[m.from];
  if (pk === undefined) return "unknown";
  return verdict(m, dmText(cid, m), !!member, member && member.signPk, pk);
}
