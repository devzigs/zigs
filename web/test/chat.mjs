// Checks the message helpers. Run: node web/test/chat.mjs
import assert from "node:assert/strict";
import {
  byTime, chatWarning, checkText, countUnread, dmText, joinBlock, keyState, newRoom, newSignKey,
  membersToPin, normChats, parseDm, parseHash, parseMsg, PASTE_BAD, PASTE_CONTACT, PASTE_EMPTY,
  PASTE_GLUED, PASTE_MANY, PASTE_OTHER, PASTE_PATH, pageKey, pastedInvite, pickRoom, pin, pinMember,
  pinnedMembers, signMsg,
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

// A pasted invite link: the link, or a message that holds it. The first full wallet link counts,
// whatever comes before or after it. A text with no full wallet link gives a fixed error that never
// repeats the text. A link of another page than `here` opens nothing.
const HERE = "https://app.zigs.app/";
const LINK = HERE + "#" + GID + "." + K;
const wanted = { id: GID, key: K };
const invite = (name) => 'I made a shared wallet "' + name + '" on Zigs, a shared wallet for Zcash '
  + "testnet and Solana Devnet. You are one of 3 signers, and 2 must approve each payment.\n\n"
  + "1. Open this link on your phone or computer: " + LINK + "\nOpen the link in Safari or Chrome. "
  + "Do not open it in a chat app browser or a private window: they can delete your key.\n"
  + "2. The browser asks for a user name and a password. Any user name works.\n3. Take a seat.\n"
  + "4. Keep the page open until the wallet is ready.\n\nThis link is a secret. Do not post it in "
  + "a public place. About Zigs: https://zigs.app";
const joins = {
  "a full link": LINK,
  "space around the link": "  \n" + LINK + "\n ",
  "the fragment alone": "#" + GID + "." + K,
  "a message with a line break after the link": "Open this link: " + LINK + "\nThen take a seat.",
  "a full stop": "Open " + LINK + ". Then take a seat.",
  "a space after the link": "Open " + LINK + " and wait",
  "the invite message of the app": invite("Demo wallet"),
  "the invite message, a # in the wallet name": invite("Team #2"),
  "the invite message, a name that starts with #": invite("#1 wallet"),
  "the invite message, a name with a # and a dot": invite("Team #a.b"),
  "a comma after the link": "Open " + LINK + ", then wait",
  "parentheses": "Open (" + LINK + ") now",
  "angle brackets": "Open <" + LINK + "> now",
  "a name with # before the link": "Wallet #1: <" + LINK + ">",
  "a zero-width space after the link": LINK + "​",
  "a link in a mark": "[Team](" + LINK + ")",
  "a link in stars": "**" + LINK + "**",
  "a link in quotes": '"' + LINK + '"',
  // Marks of other scripts and quotes are marks, not text.
  "corner brackets": "「" + LINK + "」",
  "curly quotes": "“" + LINK + "”",
  "guillemets": "«" + LINK + "»",
  "an em dash before the link": "—" + LINK,
  "a zero-width space before the link": "\u200b" + LINK,
  // A Chinese word, then a space that is no plain space: the word is not glued to the link.
  "a Chinese word and an ideographic space before the link": "钱包链接\u3000" + LINK,
  "a Chinese word and a tab before the link": "钱包链接\t" + LINK,
  "eighty marks before the link": "(".repeat(80) + LINK,
  "a link in square brackets": "[" + LINK + "]",
  "a message with a link in square brackets": "Invite: [" + LINK + "]",
  "a link in brackets in square brackets": "([" + LINK + "])",
  "a label in square brackets": "[[Team](" + LINK + ")]",
  "square brackets that open no label": "[".repeat(5) + LINK,
  "a host without a scheme": "app.zigs.app/#" + GID + "." + K,
  "a host in capitals": "HTTPS://APP.ZIGS.APP/#" + GID + "." + K,
  "a path without a slash": "https://app.zigs.app#" + GID + "." + K,
  "a query before the fragment": HERE + "?from=chat#" + GID + "." + K,
  "the same link twice": LINK + " and again " + LINK,
  "a contact link, then a wallet link": HERE + "#c." + ROOM + "." + K + " and then " + LINK,
  "a wallet link, then a contact link": LINK + " and then " + HERE + "#c." + ROOM + "." + K,
  "a bare link in brackets": "Open (#" + GID + "." + K + ") now",
  "a bare host in angle brackets": "Open <app.zigs.app/#" + GID + "." + K + ">",
  "another address earlier in the message": "See https://zigs.app/about and open " + LINK,
  "a page of this server at /index.html": "https://app.zigs.app/index.html#" + GID + "." + K,
  "a label with a dot in a Markdown link": "[evil.example](" + LINK + ")",
  "stars and a label": "**[Team](" + LINK + ")**",
};
for (const [what, text] of Object.entries(joins)) {
  assert.deepEqual(pastedInvite(text, HERE), wanted, "a link is found: " + what);
}
// Mark blocks before a link, with a letter at the end so that the marks fail: each ends within a
// small time (a busy computer needs a few ms; nested patterns took 2 to 15 seconds here).
const worst = {
  "mark blocks, 17 times": "[[](".repeat(17) + "a",
  "mark blocks, 19 times": "[[](".repeat(19) + "a",
  "mark blocks of 3 brackets, 15 times": "[[[](".repeat(15) + "a",
  "label blocks, 15 times": "[a](".repeat(15) + "a",
  "marks and labels mixed": "([[]()<[".repeat(9) + "a",
  "marks, 80 characters": "[".repeat(79) + "a",
  "only brackets": "[]".repeat(40),
  "stray brackets and marks": "[(".repeat(40) + "a",
  "stray brackets in labels": "[a[a[a(".repeat(11) + "a",
  "letters of another script": "ж".repeat(200000) + "a",
  "full stops of other scripts": "。".repeat(200000) + "a",
  "backslashes": "\\".repeat(200000) + "a",
};
for (const [what, prefix] of Object.entries(worst)) {
  const at = performance.now();
  pastedInvite(prefix + LINK, HERE);
  assert.equal(performance.now() - at < 500, true, "marks end at once: " + what);
}
for (const empty of ["", "   ", "\n\t", undefined, null]) {
  const got = pastedInvite(empty, HERE);
  assert.deepEqual(got, { error: PASTE_EMPTY }, "empty: " + JSON.stringify(empty));
}
const secret = "s".repeat(43);
const bad = {
  "no fragment": HERE,
  "no secret": HERE + "#" + GID,
  "a short secret": HERE + "#" + GID + "." + K.slice(1),
  "a long secret": HERE + "#" + GID + "." + K + "x",
  "a secret with a bad character": HERE + "#" + GID + "." + K.slice(1) + "!",
  "a bad id": HERE + "#" + "z".repeat(20) + "." + K,
  "a word": "hello",
  "a fragment of a word": "see #hello",
  "a secret before a space": HERE + "#" + GID + ". " + K,
  "a name with # and no link": 'I made a shared wallet "Team #2" on Zigs.',
  "capitals in the wallet id": HERE + "#" + GID.toUpperCase() + "." + K,
};
for (const [what, text] of Object.entries(bad)) {
  assert.deepEqual(pastedInvite(text, HERE), { error: PASTE_BAD }, "bad link: " + what);
}
// A link whose origin is another server.
const elsewhere = {
  "another site": "https://evil.example/#" + GID + "." + K,
  "an IDN site": "https://пример.рф/#" + GID + "." + K,
  "a punycode site": "https://xn--e1afmkfd.xn--p1ai/#" + GID + "." + K,
  "an IDN host with a slash": "пример.рф/#" + GID + "." + K,
  "a fullwidth host with a slash": "ｅｖｉｌ。ｃｏｍ/#" + GID + "." + K,
  "a host of circled letters with a slash": "ⓔⓥⓘⓛ。ⓒⓞⓜ/#" + GID + "." + K,
  "another scheme": "http://app.zigs.app/#" + GID + "." + K,
  "another port": "https://app.zigs.app:8443/#" + GID + "." + K,
  "a longer host": "https://app.zigs.app.evil.example/#" + GID + "." + K,
  "a site in a message": "Open https://evil.example/#" + GID + "." + K + " now",
  "a site in brackets": "<https://evil.example/#" + GID + "." + K + ">",
  "a site in square brackets": "[https://evil.example/#" + GID + "." + K + "]",
  "a site that holds this page in its query":
    "https://evil.example/?u=" + HERE + "#" + GID + "." + K,
  "a host with no scheme": "evil.example/#" + GID + "." + K,
  "a host that is the start of this host": "https://app.zigs.ap/#" + GID + "." + K,
};
for (const [what, text] of Object.entries(elsewhere)) {
  assert.deepEqual(pastedInvite(text, HERE), { error: PASTE_OTHER }, "another page: " + what);
}
assert.equal(PASTE_GLUED.includes("another Zigs server"), false, "glued text is no other server");
// Text stands right before the link: no address, a word, marks that are too many, an address that
// holds this page, or an address that has no origin. The text says so, and it never says that the
// link is for another server.
const glued = {
  "a prefix with no scheme": "evil.example/?u=" + LINK,
  "a prefix with a host and a path": "evil.example/" + LINK,
  "a prefix with a user name": "user@evil.example/" + LINK,
  "a prefix with a non-http scheme": "ftp://evil.example/?u=" + LINK,
  "a script before the link": "javascript:alert(1)//" + LINK,
  "a script before the fragment": "javascript:alert(1)//#" + GID + "." + K,
  "a data address before the link": "data:text/html," + LINK,
  "a word and a colon before the link": "Link:" + LINK,
  "a word and a colon before the fragment": "Link:#" + GID + "." + K,
  "a word before the link": "see" + LINK,
  "a number and a dot before the link": "1." + LINK,
  "a word before the fragment": "foo#" + GID + "." + K,
  "a long run of marks before the link": "(".repeat(81) + LINK,
  "text that is no address before the link": "a<b.example/#" + GID + "." + K,
  "a bracket host that does not end": "https://[::1/#" + GID + "." + K,
  "a prefix of another origin in a message": "Open evil.example/?u=" + LINK + " now",
  // A foreign host, or text, in a form that a URL parser reads differently: letters and full stops
  // of other scripts, and a backslash.
  "a fullwidth host glued to the fragment": "ｅｖｉｌ。ｃｏｍ#" + GID + "." + K,
  // Symbols that a URL parser reads as letters, digits and dots of a host.
  "circled letters and an ideographic full stop glued to the fragment":
    "ⓔⓥⓘⓛ。ⓒⓞⓜ#" + GID + "." + K,
  "TM and tel signs glued to the fragment": "™℡。ⓒⓞⓜ#" + GID + "." + K,
  "circled letters before the link": "ⓔⓥⓘⓛ" + LINK,
  "a fullwidth host and a backslash before the link": "ｅｖｉｌ。ｃｏｍ\\" + LINK,
  "text of another script glued to the fragment": "Ссылка:#" + GID + "." + K,
  "text of another script before the link": "Ссылка" + LINK,
  "text of another script and a colon before the link": "Ссылка:" + LINK,
  "a Japanese word before the link": "リンク" + LINK,
  "a letter with an accent before the link": "é" + LINK,
  "a digit of another script before the link": "１" + LINK,
  "a backslash before the link": "\\" + LINK,
  "a backslash before the fragment": "\\#" + GID + "." + K,
  "an ASCII host and a backslash before the link": "evil.example\\" + LINK,
  "an ideographic full stop before the link": "。" + LINK,
  "a fullwidth full stop before the link": "．" + LINK,
  "a halfwidth ideographic full stop before the link": "｡" + LINK,
};
for (const [what, text] of Object.entries(glued)) {
  assert.deepEqual(pastedInvite(text, HERE), { error: PASTE_GLUED }, "text stands before: " + what);
}
// This server, another path: the text says so, and it never says "another server".
const wrongPath = {
  "another path": HERE + "other/#" + GID + "." + K,
  "a path in a message": "Open " + HERE + "other/#" + GID + "." + K + " now",
  "a folder with index.html": HERE + "app/index.html#" + GID + "." + K,
};
for (const [what, text] of Object.entries(wrongPath)) {
  assert.deepEqual(pastedInvite(text, HERE), { error: PASTE_PATH }, "another path: " + what);
}
assert.equal(PASTE_PATH.includes("another Zigs server"), false, "a wrong path is no other server");
// A URL parser reads many symbols as the letters, digits and dots of a host (circled letters, "TM",
// full stops of other scripts). No such code point may pass as a mark before a link or before a
// bare fragment. The list comes from the URL parser of this Node, so a new table is checked too.
const hostRead = (ch) => {
  try { return new URL("https://a" + ch + "b/").hostname; } catch { return ""; }
};
const hostChars = [];
for (let cp = 0x80; cp <= 0x10ffff; cp++) {
  if (cp >= 0xd800 && cp <= 0xdfff) continue;
  const ch = String.fromCodePoint(cp), host = hostRead(ch);
  if (host === "a.b" || /^a[a-z\d]+b$/.test(host)) hostChars.push(ch);
}
assert.equal(hostChars.length > 500, true, "the URL parser reads many code points as host text");
for (const ch of hostChars) {
  for (const text of [ch + LINK, ch + "#" + GID + "." + K]) {
    const refused = "error" in pastedInvite(text, HERE);
    assert.equal(refused, true, "a host character is no mark: U+" + ch.codePointAt(0).toString(16));
  }
}
// A text with two different wallet links names none: the wallet name of an invite message has no
// signature, so a link in it must not win over the link that follows.
const KEY2 = "k".repeat(43), many = {
  "two wallets": LINK + " " + HERE + "#" + ROOM + "." + K,
  "two secrets for one wallet": LINK + " " + HERE + "#" + GID + "." + KEY2,
  "a link in the wallet name of an invite message":
    invite("Team " + HERE + "#" + ROOM + "." + KEY2),
  "a link of another server, then the link":
    "https://staging.example/#" + ROOM + "." + K + " " + LINK,
  "three links, the third differs": LINK + " " + LINK + " " + HERE + "#" + ROOM + "." + K,
};
for (const [what, text] of Object.entries(many)) {
  assert.deepEqual(pastedInvite(text, HERE), { error: PASTE_MANY }, "more than one link: " + what);
}
// The server shows its page at "/" and at "/index.html": the page of a link and the open page
// match.
assert.equal(pageKey(new URL(HERE)), HERE);
assert.equal(pageKey(new URL(HERE + "index.html")), HERE, "index.html is the root page");
assert.equal(pageKey(new URL(HERE + "app/index.html")), HERE + "app/");
assert.equal(pageKey(new URL(HERE + "index.htm")), HERE + "index.htm", "only index.html");
assert.equal(pageKey(new URL(HERE + "xindex.html")), HERE + "xindex.html", "only a whole name");
const atIndex = pageKey(new URL(HERE + "index.html"));
assert.deepEqual(pastedInvite(HERE + "index.html#" + GID + "." + K, atIndex), wanted,
  "a link of /index.html opens on /index.html");
assert.deepEqual(pastedInvite(LINK, atIndex), wanted, "a link of / opens on /index.html");
assert.deepEqual(pastedInvite("http://localhost:8873/#" + GID + "." + K, "http://localhost:8873/"),
  wanted, "the open page can be a test server");
const contact = HERE + "#c." + GID + "." + secret;
assert.deepEqual(pastedInvite(contact, HERE), { error: PASTE_CONTACT },
  "a contact link is no wallet");
assert.deepEqual(pastedInvite("#c." + GID, HERE), { error: PASTE_CONTACT },
  "a contact link without secret");
for (const error of [PASTE_EMPTY, PASTE_BAD, PASTE_CONTACT, PASTE_OTHER, PASTE_PATH, PASTE_GLUED,
  PASTE_MANY]) {
  assert.equal(error.includes(K) || error.includes(secret), false, "an error never holds a secret");
}
// A long paste ends at once: the link is found in one pass.
const began = Date.now();
for (const long of ["x".repeat(2000000), "#".repeat(2000000), "a b ".repeat(500000) + LINK]) {
  pastedInvite(long, HERE);
}
assert.equal(Date.now() - began < 3000, true, "a long paste ends at once");

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
