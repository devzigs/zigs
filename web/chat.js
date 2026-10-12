// Pure helpers for wallet messages. Checked by web/test/chat.mjs.

export const MAX_TEXT = 2000;
const ROOM_ID = /^[0-9a-f]{20}$/, ROOM_KEY = /^[\w-]{43}$/, PUBKEY = /^[0-9a-f]{64}$/;
const THREAD = /^(wallet|pay:[\w-]{1,64})$/;

const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s) => Uint8Array.from(s.match(/../g), (h) => parseInt(h, 16));
const toB64 = (u8) => btoa(String.fromCharCode(...u8));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const validPk = (x) => typeof x === "string" && PUBKEY.test(x);
export const validId = (x) => typeof x === "string" && ROOM_ID.test(x);
export const validRoom = (r) => !!r && typeof r.id === "string" && typeof r.key === "string"
  && ROOM_ID.test(r.id) && ROOM_KEY.test(r.key);

export function newRoom() {
  const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));
  const key = toB64(rnd(32)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { id: hex(rnd(10)), key };
}

// What to do with the room that wallet `gid` names: "use" it, "changed" (it differs from the room
// pinned first), "missing" (no usable room, but a room is pinned) or "none" (no usable room and no
// pin). `isWallet(id)` tells wallet ids apart. A pinned wallet never gets a new room.
export function pickRoom(gid, room, pins, isWallet) {
  const pinned = Object.hasOwn(pins, gid);
  if (!validRoom(room) || room.id === gid || isWallet(room.id)) return pinned ? "missing" : "none";
  return pinned && pins[gid] !== room.id ? "changed" : "use";
}

// The first value seen for a key is kept. Returns "new", "same" or "changed".
export function pin(pins, key, value) {
  if (!Object.hasOwn(pins, key)) { pins[key] = value; return "new"; }
  return pins[key] === value ? "same" : "changed";
}

export function checkText(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { error: "Write a message first." };
  if (text.length > MAX_TEXT) {
    const error = `A message can have at most ${MAX_TEXT} characters. This one has ${text.length}.`;
    return { error };
  }
  return { text };
}

const showable = (d) => !!d && typeof d.text === "string" && typeof d.thread === "string"
  && Number.isFinite(d.at) && d.text.length <= MAX_TEXT && THREAD.test(d.thread);

// A message document from another signer. Returns null when it cannot be shown at all.
export function parseMsg(id, d) {
  if (!showable(d)) return null;
  return {
    id, text: d.text, thread: d.thread, at: d.at,
    seat: Number.isInteger(d.seat) ? d.seat : 0, sig: typeof d.sig === "string" ? d.sig : "",
  };
}

export const byTime = (a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Messages from other seats that are newer than the read mark of their thread.
export function countUnread(msgs, mine, marks, roomId, thread) {
  return msgs.filter((m) => (!thread || m.thread === thread) && !mine.includes(m.seat)
    && m.at > (marks[roomId + ":" + m.thread] || 0)).length;
}

// Whether a message can be checked: "no" (not a seat of the wallet, or no pinned key), "changed"
// (the seat document names another key than the pin) or "check" (verify with the pinned key).
export function keyState(isSeat, seatPk, pinnedPk) {
  if (!isSeat || !validPk(pinnedPk)) return "no";
  return seatPk === pinnedPk ? "check" : "changed";
}

// The text that a seat signs. Other apps must build exactly this JSON text.
export const signedText = (walletGid, roomId, m) =>
  JSON.stringify(["zigs-msg-v1", walletGid, roomId, m.id, m.seat, m.thread, m.at, m.text]);

// The text that a member of a direct chat signs. Other apps must build exactly this JSON text.
export const dmText = (cid, m) => JSON.stringify(["zigs-dm-v1", cid, m.id, m.from, m.at, m.text]);

// A message document of a direct chat, or null when it cannot be shown at all. The member id also
// goes in `seat`, so the sort and the unread count of wallet messages work on it.
export function parseDm(id, d) {
  const ok = !!d && typeof d.text === "string" && d.text.length <= MAX_TEXT && validId(d.from)
    && Number.isFinite(d.at);
  if (!ok) return null;
  const sig = typeof d.sig === "string" ? d.sig : "";
  return { id, from: d.from, seat: d.from, thread: "dm", text: d.text, at: d.at, sig };
}

// The parts of the page fragment: "#<wallet id>.<secret>" or "#c.<chat id>.<secret>". Parts after
// the secret are ignored. An id that is not 20 hex characters comes back as "", so a name such as
// "__proto__" never reaches a lookup.
export function parseHash(hash) {
  const [a, b, c] = hash.replace(/^#/, "").split(".");
  const chat = a === "c", id = chat ? b : a;
  return { chat, id: validId(id) ? id : "", key: (chat ? c : b) || "" };
}

export const pinnedMembers = (pins, cid) => Object.keys(pins)
  .filter((k) => k.startsWith(cid + ":")).map((k) => k.slice(cid.length + 1));

// The first two members seen in a chat are pinned, each with the first signing key seen for it.
// Returns "new", "same", "changed", or "unknown" for a third member.
export function pinMember(pins, cid, member, pk) {
  const key = cid + ":" + member;
  return !Object.hasOwn(pins, key) && pinnedMembers(pins, cid).length >= 2
    ? "unknown" : pin(pins, key, pk);
}

// Why a browser cannot join a chat that has `count` members now, or null. A full chat wins over a
// join lease that someone else holds.
export function joinBlock(count, leased) {
  if (count > 1) return "This chat already has two people. Ask for a new contact link.";
  if (!leased) return "Someone else is joining this chat. Try again in a moment.";
  return count ? null : "This contact link does not open a chat. Ask for a new one.";
}

// The warning that a chat page shows, or null. `members` maps member ids to { signPk }, `messages`
// are the parsed messages. Nothing is hidden: the messages stay in the log.
export function chatWarning(pins, cid, members, messages) {
  if (!members) return null;
  const pinned = pinnedMembers(pins, cid);
  if (pinned.some((id) => !members[id] || members[id].signPk !== pins[cid + ":" + id])) {
    return "A signing key in this chat changed or is missing. Its messages are not verified.";
  }
  const third = Object.keys(members).some((id) => !pinned.includes(id))
    || messages.some((m) => !pinned.includes(m.from));
  return third ? "A third person wrote in this chat. Their messages are not verified." : null;
}

// The saved direct chats. A vault record from before chats has none. Bad entries are dropped.
export function normChats(x) {
  const list = {}, p = x?.profile;
  for (const [id, c] of Object.entries(x?.list ?? {})) {
    if (validRoom({ id, key: c?.key }) && validId(c.member)) {
      list[id] = { key: c.key, member: c.member, at: Number.isFinite(c.at) ? c.at : 0 };
    }
  }
  const ok = p && typeof p.signSk === "string" && validPk(p.signPk);
  return { profile: ok ? { signSk: p.signSk, signPk: p.signPk } : null, list };
}

let probe = null;
export const canSign = () => (probe ||= (async () => {
  try {
    await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
    return true;
  } catch { return false; }
})());

export async function newSignKey() {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const sk = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  const pk = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  return { signSk: toB64(sk), signPk: hex(pk) };
}

export async function signMsg(signSk, text) {
  const key = await crypto.subtle.importKey("pkcs8", fromB64(signSk), "Ed25519", false, ["sign"]);
  const sig = await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(text));
  return toB64(new Uint8Array(sig));
}

// False for a wrong key, a changed text, or a malformed key or signature. Never throws.
export async function verifyMsg(signPk, sig, text) {
  try {
    if (!validPk(signPk)) return false;
    const key = await crypto.subtle.importKey("raw", unhex(signPk), "Ed25519", false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, fromB64(sig), new TextEncoder().encode(text));
  } catch { return false; }
}
