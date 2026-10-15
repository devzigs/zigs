// Checks the message helpers. Run: node web/test/chat.mjs
import assert from "node:assert/strict";
import {
  byTime, chatWarning, checkText, countUnread, dmText, joinBlock, keyState, newRoom, newSignKey,
  membersToPin, normChats, parseDm, parseHash, parseMsg, pickRoom, pin, pinMember, pinnedMembers,
  signMsg,
  signPairMatches, signedText, validRoom, verifyMsg,
} from "../chat.js";

const GID = "a".repeat(20), ROOM = "b".repeat(20);
const msg = { id: "c".repeat(20), seat: 2, thread: "wallet", at: 1760000000000, text: "Hi\nthere" };
const key = await newSignKey(), other = await newSignKey();
const text = signedText(GID, ROOM, msg);
const sig = await signMsg(key.signSk, text);

// A fixed vector: other apps must build this text and accept this signature (PROTOCOL.md, 14).
const FIXED_TEXT = '["zigs-msg-v1","aaaaaaaaaaaaaaaaaaaa","bbbbbbbbbbbbbbbbbbbb",'
  + '"cccccccccccccccccccc",2,"wallet",1760000000000,"Hi\\nthere"]';
const FIXED_PK = "79b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664";
const FIXED_SIG = "P0GlJCn7yLzM8fGipMaSacCPlvVfBLO+aL5hPszFsVVQKfX/tOsLlG11DNuUnD0XytaZCtodaCPdXmc2"
  + "iSwvAg==";
assert.equal(text, FIXED_TEXT);
assert.equal(await verifyMsg(FIXED_PK, FIXED_SIG, FIXED_TEXT), true);
assert.equal(await verifyMsg(FIXED_PK, FIXED_SIG, FIXED_TEXT.replace("Hi", "Ho")), false);

assert.equal(await verifyMsg(key.signPk, sig, text), true);
const changes = {
  text: signedText(GID, ROOM, { ...msg, text: "Hi there" }),
  thread: signedText(GID, ROOM, { ...msg, thread: "pay:" + "d".repeat(20) }),
  seat: signedText(GID, ROOM, { ...msg, seat: 3 }),
  at: signedText(GID, ROOM, { ...msg, at: msg.at + 1 }),
  id: signedText(GID, ROOM, { ...msg, id: "e".repeat(20) }),
  roomId: signedText(GID, "f".repeat(20), msg),
  walletGid: signedText("f".repeat(20), ROOM, msg),
};
for (const [name, changed] of Object.entries(changes)) {
  assert.equal(await verifyMsg(key.signPk, sig, changed), false, name + " breaks the signature");
}
assert.equal(await verifyMsg(other.signPk, sig, text), false, "wrong key");

for (const badSig of ["", "!!!", "AAAA", sig.slice(2), null, 5]) {
  assert.equal(await verifyMsg(key.signPk, badSig, text), false);
}
for (const badKey of ["", "zz", "ab".repeat(31), null, 7, {}]) {
  assert.equal(await verifyMsg(badKey, sig, text), false);
}
assert.equal(await verifyMsg(FIXED_PK.toUpperCase(), FIXED_SIG, FIXED_TEXT), false,
  "a key in capital letters");

assert.equal(checkText("").error, "Write a message first.");
assert.equal(checkText(" \n\t ").error, "Write a message first.");
assert.equal(checkText(null).error, "Write a message first.");
assert.equal(checkText("x".repeat(2000)).text.length, 2000);
assert.match(checkText("x".repeat(2001)).error, /at most 2000 characters/);
assert.equal(checkText("  hi\nthere  ").text, "hi\nthere");
assert.equal(checkText("x".repeat(2000) + "   ").text.length, 2000);

const room = newRoom();
assert.equal(validRoom(room), true);
assert.notEqual(newRoom().id, room.id);
const badRooms = [
  null, {}, { ...room, id: "A".repeat(20) }, { ...room, id: room.id.slice(1) },
  { ...room, key: room.key + "a" }, { ...room, key: "+".repeat(43) },
  { id: [room.id], key: room.key },
];
for (const bad of badRooms) {
  assert.equal(validRoom(bad), false);
}

const isWallet = (id) => id === "9".repeat(20);
assert.equal(pickRoom(GID, room, {}, isWallet), "use");
assert.equal(pickRoom(GID, room, { [GID]: room.id }, isWallet), "use");
assert.equal(pickRoom(GID, room, { [GID]: ROOM }, isWallet), "changed");
assert.equal(pickRoom(GID, undefined, {}, isWallet), "none");
assert.equal(pickRoom(GID, undefined, { [GID]: room.id }, isWallet), "missing");
assert.equal(pickRoom(GID, { id: room.id, key: "x" }, { [GID]: room.id }, isWallet), "missing");
assert.equal(pickRoom(GID, { ...room, id: GID }, { [GID]: room.id }, isWallet), "missing");
assert.equal(pickRoom(GID, undefined, { other: room.id }, isWallet), "none");
assert.equal(pickRoom(GID, { ...room, id: GID }, {}, isWallet), "none");
assert.equal(pickRoom(GID, { ...room, id: "9".repeat(20) }, {}, isWallet), "none");

assert.equal(keyState(false, key.signPk, key.signPk), "no", "not a seat of the wallet");
assert.equal(keyState(true, key.signPk, undefined), "no", "no pinned key");
assert.equal(keyState(true, key.signPk, "zz"), "no", "malformed pin");
assert.equal(keyState(true, other.signPk, key.signPk), "changed");
assert.equal(keyState(true, undefined, key.signPk), "changed");
assert.equal(keyState(true, key.signPk, key.signPk), "check");

const pins = {};
assert.equal(pin(pins, "g:1", "k1"), "new");
assert.equal(pin(pins, "g:1", "k1"), "same");
assert.equal(pin(pins, "g:1", "k2"), "changed");
assert.equal(pins["g:1"], "k1");

assert.deepEqual(parseMsg("m1", { ...msg, sig }), { ...msg, id: "m1", sig });
assert.equal(parseMsg("m1", { ...msg, text: 5 }), null);
assert.equal(parseMsg("m1", { ...msg, text: "x".repeat(2001) }), null);
assert.equal(parseMsg("m1", { ...msg, thread: "other" }), null);
assert.equal(parseMsg("m1", { ...msg, at: "now" }), null);
assert.equal(parseMsg("m1", null), null);
assert.equal(parseMsg("m1", { ...msg, seat: "2" }).seat, 0);
assert.equal(parseMsg("m1", msg).sig, "");

const list = [{ id: "b", at: 2 }, { id: "a", at: 2 }, { id: "z", at: 1 }];
assert.deepEqual(list.sort(byTime).map((m) => m.id), ["z", "a", "b"]);

const inbox = [
  { id: "1", seat: 1, thread: "wallet", at: 10 }, { id: "2", seat: 2, thread: "wallet", at: 20 },
  { id: "3", seat: 2, thread: "pay:x", at: 30 }, { id: "4", seat: 3, thread: "wallet", at: 40 },
];
assert.equal(countUnread(inbox, [1], {}, ROOM), 3);
assert.equal(countUnread(inbox, [1, 2], {}, ROOM), 1);
assert.equal(countUnread(inbox, [1], { [ROOM + ":wallet"]: 20 }, ROOM), 2);
assert.equal(countUnread(inbox, [1], { [ROOM + ":wallet"]: 40 }, ROOM, "wallet"), 0);
assert.equal(countUnread(inbox, [1], {}, ROOM, "pay:x"), 1);
assert.equal(countUnread([], [1], {}, ROOM), 0);

// Direct chats. A fixed vector: other apps must build this text and accept this signature.
const dm = { id: "c".repeat(20), from: "d".repeat(20), at: 1760000000000, text: "Hi\nthere" };
const DM_TEXT = '["zigs-dm-v1","aaaaaaaaaaaaaaaaaaaa","cccccccccccccccccccc",'
  + '"dddddddddddddddddddd",1760000000000,"Hi\\nthere"]';
const DM_PK = "ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c";
const DM_SIG = "IhrJPY9aKgcBD94Yl7F50opizISwAIZbtLzA/j3+uv0nOnXKE21dN8CVUOGBnztcDXQobrZoKTeMajHE"
  + "G67DDw==";
assert.equal(dmText(GID, dm), DM_TEXT);
assert.equal(await verifyMsg(DM_PK, DM_SIG, DM_TEXT), true);
assert.equal(await verifyMsg(DM_PK, DM_SIG, DM_TEXT.replace("Hi", "Ho")), false);

const dmSig = await signMsg(key.signSk, dmText(GID, dm));
assert.equal(await verifyMsg(key.signPk, dmSig, dmText(GID, dm)), true);
const dmChanges = {
  text: dmText(GID, { ...dm, text: "Hi there" }),
  from: dmText(GID, { ...dm, from: "e".repeat(20) }),
  at: dmText(GID, { ...dm, at: dm.at + 1 }),
  id: dmText(GID, { ...dm, id: "e".repeat(20) }),
  cid: dmText("f".repeat(20), dm),
};
for (const [name, changed] of Object.entries(dmChanges)) {
  assert.equal(await verifyMsg(key.signPk, dmSig, changed), false, name + " breaks the signature");
}
assert.equal(await verifyMsg(other.signPk, dmSig, dmText(GID, dm)), false, "wrong key");
// Same fields, same key: a wallet signature is no direct signature, and the reverse.
const same = { ...dm, seat: 2, thread: "wallet" };
const walletSig = await signMsg(key.signSk, signedText(GID, GID, same));
assert.equal(await verifyMsg(key.signPk, walletSig, dmText(GID, dm)), false);
assert.equal(await verifyMsg(key.signPk, dmSig, signedText(GID, GID, same)), false);

assert.deepEqual(parseDm("m1", { ...dm, sig: "s" }),
  { id: "m1", from: dm.from, seat: dm.from, thread: "dm", text: dm.text, at: dm.at, sig: "s" });
assert.equal(parseDm("m1", dm).sig, "");
for (const bad of [null, { ...dm, text: 5 }, { ...dm, text: "x".repeat(2001) },
  { ...dm, at: "now" }, { ...dm, from: "zz" }, { ...dm, from: undefined },
  { ...dm, from: dm.from.toUpperCase() }]) {
  assert.equal(parseDm("m1", bad), null);
}
const dmInbox = [parseDm("1", dm), parseDm("2", { ...dm, from: "e".repeat(20), at: 5 })];
assert.equal(countUnread(dmInbox, [dm.from], {}, GID), 1);
assert.equal(countUnread(dmInbox, [dm.from], { [GID + ":dm"]: 5 }, GID), 0);

const chatPins = {}, M1 = "1".repeat(20), M2 = "2".repeat(20), M3 = "3".repeat(20);
assert.equal(pinMember(chatPins, GID, M1, "k1"), "new");
assert.equal(pinMember(chatPins, GID, M1, "k1"), "same");
assert.equal(pinMember(chatPins, GID, M1, "k2"), "changed");
assert.equal(pinMember(chatPins, GID, M2, "k2"), "new");
assert.equal(pinMember(chatPins, GID, M3, "k3"), "unknown", "a third member is not pinned");
assert.equal(pinMember(chatPins, GID, M2, "k2"), "same");
assert.equal(pinMember(chatPins, ROOM, M3, "k3"), "new", "chats are counted apart");
assert.equal(chatPins[GID + ":" + M3], undefined);

assert.deepEqual(pinnedMembers(chatPins, GID).sort(), [M1, M2]);

// Which members to pin: the own one at once, another only when it is the one new valid member.
// The same cases as ios/CheckBackup/main.swift, so both apps pin the same members.
const [k1, k2, k3] = (await Promise.all([1, 2, 3].map(() => newSignKey()))).map((k) => k.signPk);
const mem = (pk) => ({ signPk: pk });
const toPin = (members, pinned = [], mine) => membersToPin(members, pinned, mine).sort();
assert.deepEqual(toPin({ [M1]: mem(k1) }), [M1], "a joiner pins the first member");
assert.deepEqual(toPin({ [M1]: mem(k1), [M2]: mem(k2) }, [], M1), [M1, M2], "own and one other");
assert.deepEqual(toPin({ [M1]: mem(k1), [M2]: mem(k2) }, [], M3), [], "two new, none mine");
assert.deepEqual(toPin({ [M1]: mem(k1), [M2]: mem(k2), [M3]: mem(k3) }, [], M1), [M1],
  "two other new members arrive together: only the own member is pinned");
assert.deepEqual(toPin({ [M2]: mem(k2), [M3]: mem(k3) }, [M1], M1), [], "two new next to a pin");
assert.deepEqual(toPin({ [M1]: mem(k1), [M2]: mem(k2) }, [M1], M1), [M2], "one new next to own");
assert.deepEqual(toPin({ [M1]: mem(k1), [M2]: mem(k2) }, [M1, M2], M1), [], "nothing new");
assert.deepEqual(toPin({ [M1]: mem(k1), [M2]: mem("zz"), [M3]: mem(undefined) }, [], M1), [M1],
  "a member without a valid key does not count");
assert.deepEqual(toPin({ [M1]: mem(k1), zz: mem(k2) }, [], M1), [M1], "a bad id does not count");
assert.deepEqual(toPin({ [M2]: mem(k2) }, [], M1), [M2], "the own member may still be missing");
assert.deepEqual(pinnedMembers(chatPins, "9".repeat(20)), []);

// Links: an id that is not 20 hex characters never comes back, so it cannot reach a lookup.
const K = room.key, NONE = { chat: false, id: "", key: "" };
assert.deepEqual(parseHash(""), NONE);
assert.deepEqual(parseHash("#"), NONE);
assert.deepEqual(parseHash("#" + GID), { chat: false, id: GID, key: "" });
assert.deepEqual(parseHash("#" + GID + "." + K), { chat: false, id: GID, key: K });
const stop = parseHash("#" + GID + "." + K + ".");
assert.deepEqual(stop, { chat: false, id: GID, key: K }, "a full stop after the link");
assert.deepEqual(parseHash("#c." + GID), { chat: true, id: GID, key: "" });
assert.deepEqual(parseHash("#c." + GID + "." + K + ".x"), { chat: true, id: GID, key: K });
for (const bad of ["__proto__", "constructor", "toString", "hasOwnProperty", "A".repeat(20)]) {
  assert.deepEqual(parseHash("#" + bad), NONE, bad);
  assert.deepEqual(parseHash("#" + bad + "." + K), { chat: false, id: "", key: K }, bad);
  assert.deepEqual(parseHash("#c." + bad), { chat: true, id: "", key: "" }, bad);
  assert.equal(parseHash("#c." + bad + "." + K).id, "", bad);
}
assert.deepEqual(parseHash("#c"), { chat: true, id: "", key: "" });

// Joining: a full chat wins over a lease that someone else holds.
const FULL = "This chat already has two people. Ask for a new contact link.";
assert.equal(joinBlock(1, true), null);
assert.equal(joinBlock(2, true), FULL);
assert.equal(joinBlock(2, false), FULL);
assert.equal(joinBlock(3, true), FULL);
assert.match(joinBlock(1, false), /Someone else is joining/);
assert.match(joinBlock(0, true), /does not open a chat/);

// Warnings: a changed or missing key first, then a third member or sender. Nothing before members.
const warn = { [GID + ":" + M1]: "k1", [GID + ":" + M2]: "k2" };
const both = { [M1]: { signPk: "k1" }, [M2]: { signPk: "k2" } };
assert.equal(chatWarning(warn, GID, undefined, []), null);
assert.equal(chatWarning(warn, GID, both, [{ from: M1 }, { from: M2 }]), null);
const swapped = { ...both, [M2]: { signPk: "x" } };
assert.match(chatWarning(warn, GID, swapped, []), /changed or is missing/);
assert.match(chatWarning(warn, GID, { [M1]: both[M1] }, []), /changed or is missing/);
assert.match(chatWarning(warn, GID, { ...both, [M3]: { signPk: "k3" } }, []), /third person/);
assert.match(chatWarning(warn, GID, both, [{ from: M3 }]), /third person/);
assert.equal(chatWarning({}, GID, {}, []), null);

const saved = { key: room.key, member: M1, at: 7 };
assert.deepEqual(normChats(undefined), { profile: null, list: {} });
assert.deepEqual(normChats({}), { profile: null, list: {} });
assert.deepEqual(normChats({ profile: key, list: { [GID]: { ...saved, extra: 1 } } }),
  { profile: { signSk: key.signSk, signPk: key.signPk }, list: { [GID]: saved } });
assert.equal(normChats({ list: { [GID]: { ...saved, at: "x" } } }).list[GID].at, 0);
for (const bad of [null, 5, "x", { list: "abc" }, { list: { short: saved } },
  { list: { [GID]: { ...saved, key: "k" } } }, { list: { [GID]: { ...saved, member: "m" } } },
  { list: { [GID]: null } }, { profile: { signSk: 1, signPk: key.signPk } },
  { profile: { signSk: "s", signPk: "zz" } }]) {
  const got = normChats(bad);
  assert.deepEqual(got, { profile: null, list: {} }, JSON.stringify(bad));
}
// A signing key pair: the private key must make the public key.
assert.equal(await signPairMatches(key.signSk, key.signPk), true);
assert.equal(await signPairMatches(other.signSk, key.signPk), false);
assert.equal(await signPairMatches(key.signSk, other.signPk), false);
for (const bad of [undefined, null, "", "AAAA", 5, "not base64!"]) {
  assert.equal(await signPairMatches(bad, key.signPk), false, String(bad));
}
for (const bad of [undefined, null, "", "zz", "0".repeat(64), 5]) {
  assert.equal(await signPairMatches(key.signSk, bad), false, String(bad));
}
console.log("chat ok");
