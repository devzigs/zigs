// Checks the message helpers. Run: node web/test/chat.mjs
import assert from "node:assert/strict";
import {
  byTime, checkText, countUnread, keyState, newRoom, newSignKey, parseMsg, pickRoom, pin, signMsg,
  signedText, validRoom, verifyMsg,
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
for (const badKey of ["", "zz", "ab".repeat(31), key.signPk.toUpperCase(), null, 7, {}]) {
  assert.equal(await verifyMsg(badKey, sig, text), false);
}

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
  null, {}, { ...room, id: room.id.toUpperCase() }, { ...room, id: room.id.slice(1) },
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
console.log("chat ok");
