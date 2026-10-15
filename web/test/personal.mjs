// Checks the rules of the personal account with the real engine. Run: node web/test/personal.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as Z from "../pkg/zigs_engine.js";
import {
  accountBackupName, accountBalance, addContact, backupPayload, balanceWarnings,
  CONTACT_INDEX_MAX, EXPIRY_BLOCKS, feeFor, feeText, fundingPayees, fundingWarning, highestIndex,
  HIGH_TEXT, holdsNotes, LOW_BALANCE, LOW_TEXT, MAX_CONTACTS, messagePlan, MIN_FUND, nameError,
  newPersonal, nextIndex, normPersonal, NOT_PERSONAL, otherWhere, readBackup, receivedItems,
  removeWarning, restoredPersonal, routeItems, salvageBackup, SENT_WORDS, sendGate, sentNote,
  sentState, chatTimeline,
} from "../personal.js";

Z.initSync({ module: readFileSync(new URL("../pkg/zigs_engine_bg.wasm", import.meta.url)) });

const json = (text) => JSON.parse(text);
const refused = (fn, part) => assert.throws(fn, (e) => e.message.includes(part), part);
const normalize = (address) => {
  try { return Z.normalizeAddress(address); } catch { return null; }
};
const acct = json(Z.accountNew("testnet"));
const other = json(Z.accountNew("testnet"));
const main = json(Z.accountNew("mainnet"));
const ctx = (own = [acct.address]) => ({ normalize, prefix: "utest1", label: "testnet", own });
const env = {
  keys: Z.accountKeys, normalize,
  nets: { testnet: { prefix: "utest1", label: "testnet" },
    mainnet: { prefix: "u1", label: "mainnet" } },
};
const addr = (k) => Z.addressAt(other.ufvk, k);

// ── The fee and the text under the composer ──
assert.deepEqual([1, 2, 3, 4, 5].map(feeFor), [10000, 15000, 20000, 25000, 30000]);
assert.equal(feeText(10000), "On chain · fee 0.0001 ZEC");
assert.equal(feeText(feeFor(3)), "On chain · fee 0.0002 ZEC");
const split = (text) => json(Z.splitMessage(text));
let plan = messagePlan("hello", split);
assert.deepEqual([plan.parts, plan.fee, plan.fine, plan.error],
  [1, 10000, "On chain · fee 0.0001 ZEC", ""]);
for (const empty of ["", "   \n", null, undefined]) {
  assert.deepEqual([messagePlan(empty, split).parts, messagePlan(empty, split).error], [1, ""]);
}
plan = messagePlan("x".repeat(512), split);
assert.deepEqual([plan.parts, plan.fee], [1, 10000], "512 bytes is one part");
plan = messagePlan("x".repeat(513), split);
assert.deepEqual([plan.parts, plan.fee, plan.fine], [2, 15000, "On chain · fee 0.00015 ZEC"]);
plan = messagePlan("x".repeat(1200), split);
assert.deepEqual([plan.parts, plan.fee, plan.fine], [3, 20000, "On chain · fee 0.0002 ZEC"]);
plan = messagePlan("x".repeat(2000), split);
assert.deepEqual([plan.parts, plan.fee], [4, 25000]);
assert.equal(messagePlan("é".repeat(1266), split).error.includes("more than 5 parts"), true);
plan = messagePlan("a".repeat(2001), split);
assert.deepEqual([plan.parts, plan.fee, plan.fine, plan.error.includes("2001 characters")],
  [0, 0, "", true], "a split error shows, with no fee");

// ── The balance, the warnings and the gate ──
assert.deepEqual(balanceWarnings(0), [LOW_TEXT]);
assert.deepEqual(balanceWarnings(LOW_BALANCE - 1), [LOW_TEXT]);
assert.deepEqual(balanceWarnings(LOW_BALANCE), [], "3 messages of one part are enough");
assert.deepEqual(balanceWarnings(1000000), [], "0.01 ZEC is the limit and still fine");
assert.deepEqual(balanceWarnings(1000001), [HIGH_TEXT]);
assert.equal(LOW_BALANCE, 30000);
const flight = [{ note_value: 100000, change: 80000 }, { note_value: 5, change: 6 }, {}];
assert.deepEqual(accountBalance({ spendable: 300000, pending: 10 }, flight),
  { spendable: 199995, pending: 80016, total: 280011 }, "the spent notes leave, the change comes");
assert.equal(accountBalance({ spendable: 1, pending: 0 }, flight).spendable, 0, "never below zero");
assert.deepEqual(accountBalance({ spendable: 7, pending: 0 }, []),
  { spendable: 7, pending: 0, total: 7 });
const bal = (spendable, pending = 0) => ({ spendable, pending, total: spendable + pending });
assert.equal(sendGate(null, [], 10000), "Wait for the first sync to finish.");
assert.match(sendGate(bal(1e6), [{}], 10000), /waiting for its block/, "one message at a time");
assert.equal(sendGate(bal(10000), [], 10000), "", "exactly the fee is enough");
assert.match(sendGate(bal(9999), [], 10000), /does not cover the network fee/);
assert.match(sendGate(bal(9999, 5), [], 10000), /3 confirmations/);
assert.match(sendGate(bal(0), [], 10000), /no funds yet/);
assert.equal(sendGate(bal(10000), [], 15000).length > 0, true, "a longer message needs more");

// ── The funding request: 3 payees ──
const total = 100000;
let got = fundingPayees(acct.address, total);
assert.deepEqual(got.payees.map((p) => p.amount), [33334, 33333, 33333]);
assert.equal(got.payees.every((p) => p.to === acct.address), true);
for (const t of [MIN_FUND, MIN_FUND + 1, MIN_FUND + 2, 300000, 1000000, 123456789]) {
  const amounts = fundingPayees(acct.address, t).payees.map((p) => p.amount);
  assert.equal(amounts.length, 3);
  assert.equal(amounts.reduce((n, x) => n + x, 0), t, "the payees add up to the amount");
  assert.equal(Math.max(...amounts) - Math.min(...amounts) <= 1, true, "3 equal notes");
}
for (const bad of [0, -1, 1.5, NaN, null, undefined, "5", MIN_FUND - 1]) {
  assert.equal(typeof fundingPayees(acct.address, bad).error, "string", String(bad));
}
// The warning comes before the money moves: the balance that the request would give.
assert.equal(fundingWarning(1000000, 0), "", "0.01 ZEC is the limit and still fine");
assert.equal(fundingWarning(1000001, 0), HIGH_TEXT);
assert.equal(fundingWarning(600000, 400001), HIGH_TEXT, "the amount and the balance together");
assert.equal(fundingWarning(600000, 400000), "");
for (const odd of [null, 0, -5, 1.5, NaN, "5"]) {
  assert.equal(fundingWarning(odd, 2e6), "", String(odd));
}
const uri = Z.makeRequest(JSON.stringify(got.payees), "test");
const read = json(Z.parseRequest(uri, "test")).payees;
assert.deepEqual(read.map((p) => [p.to, p.amount]), got.payees.map((p) => [p.to, p.amount]),
  "the engine reads back 3 payees");

// ── Contacts ──
const add = (list, name, address, c = ctx()) => addContact(list, name, address, c);
let first = add([], "  Ana ", addr(0));
assert.deepEqual(first.contact, { name: "Ana", address: normalize(addr(0)), index: 1 });
const list = [first.contact];
const second = add(list, "Ben", addr(1));
assert.equal(second.contact.index, 2);
assert.equal(nextIndex([]), 1);
assert.equal(nextIndex([{ index: 1 }, { index: 5 }, { index: 2 }]), 6,
  "the highest index plus one");
assert.equal(nextIndex([{ index: 1 }, { index: 3 }]), 4, "a gap is never filled");
assert.equal(nextIndex([{ index: 1 }, { index: 2 }], 3), 4, "an address that got a payment counts");
assert.equal(nextIndex([{ index: 1 }, { index: 5 }], 3), 6, "the contacts can be higher");
assert.equal(nextIndex([], 7), 8);
list.push(second.contact);
assert.match(add(list, "Cy", addr(0)).error, /already a contact: Ana\./);
assert.match(add(list, "Cy", ` ${addr(1)} \n`).error, /already a contact: Ben\./, "white space");
assert.match(add(list, "ana", addr(2)).error, /name already/, "names compare without case");
assert.match(add(list, "Cy", acct.address).error, /address of your own account/);
const mine = [acct.address, Z.addressAt(acct.ufvk, 1)];
assert.match(add(list, "Cy", Z.addressAt(acct.ufvk, 1), ctx(mine)).error, /your own account/);
assert.match(add(list, "Cy", main.address).error,
  /Enter a shielded Zcash testnet address\. It starts with utest1\./);
assert.match(add(list, "Cy", "").error, /Enter a shielded/);
assert.match(add(list, "Cy", "utest1notanaddress").error, /Enter a shielded/);
assert.match(add(list, "Cy", "t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs").error, /Enter a shielded/,
  "a transparent address has no Orchard receiver");
assert.match(add(list, "", addr(2)).error, /Enter a name/);
assert.match(add(list, "   ", addr(2)).error, /Enter a name/);
assert.match(add(list, "x".repeat(41), addr(2)).error, /at most 40 characters/);
assert.equal(add(list, "x".repeat(40), addr(2)).contact.index, 3);
assert.equal(add(list, "😀".repeat(40), addr(2)).contact.name.length, 80,
  "40 characters, not 40 units");
assert.equal(nameError("Zoë"), "");
for (const name of [5, null, undefined, {}, ["Ana"], true]) {
  assert.match(nameError(name), /Enter a name/, String(name));
  assert.match(add([], name, addr(2)).error, /Enter a name/, "no TypeError: " + String(name));
}
for (const name of ["a\nb", "a‮b", "a\0b", "a b", "a\rb"]) {
  assert.match(nameError(name), /not valid text/, JSON.stringify(name));
}
// A restore from an old file lacks the contacts of its later days. The chain still shows that their
// addresses got a payment, so a new contact never takes one of them.
const received = [
  { txid: "a", memos: [{ status: "text", text: "x", index: 1 }], indexes: [1] },
  { txid: "b", memos: [], indexes: [3, null] },            // an empty memo or a memo not read yet
  { txid: "c", memos: [{ status: "text", text: "y", index: 99 }], indexes: [99] },
  { txid: "d", memos: "no", indexes: "no" },
];
assert.equal(highestIndex(received), 99, "the other messages count too");
assert.equal(highestIndex(received.slice(0, 2)), 3, "a note without a memo counts");
assert.deepEqual([highestIndex([]), highestIndex(null),
  highestIndex([{ indexes: [null, 1.5, -1] }])], [0, 0, 0]);
const old = [first.contact, second.contact];            // the file has indexes 1 and 2
assert.equal(add(old, "Zed", addr(2), { ...ctx(), seen: highestIndex(received.slice(0, 2)) })
  .contact.index, 4, "index 3 got a payment, so the next contact gets 4");
assert.equal(add(old, "Zed", addr(2)).contact.index, 3, "without the chain the index repeats");
// An index stays below the end of the u32 range, so that a file cannot lock the account.
const high = { name: "Hi", address: normalize(addr(3)), index: CONTACT_INDEX_MAX };
assert.match(add([high], "Zed", addr(2)).error, /no free address left/);
assert.match(add([], "Zed", addr(2), { ...ctx(), seen: CONTACT_INDEX_MAX }).error,
  /no free address left/, "an index seen on chain counts");
assert.equal(add([{ ...high, index: CONTACT_INDEX_MAX - 1 }], "Zed", addr(2)).contact.index,
  CONTACT_INDEX_MAX);
const full = Array.from({ length: MAX_CONTACTS }, (_, i) =>
  ({ name: "c" + i, address: "a" + i, index: i + 1 }));
assert.match(add(full, "More", addr(2)).error, /at most 200 contacts/);

// ── Backup ──
const mineAcct = { ...newPersonal({ seed: acct.seed, network: "testnet", birthday: 4500000 },
  "k".repeat(43)), contacts: list, sent: [{ txid: "t" }] };
const payload = backupPayload(mineAcct);
assert.deepEqual(Object.keys(payload).sort(),
  ["birthday", "contacts", "kind", "network", "seed", "version"], "no message, no sync key");
assert.deepEqual([payload.kind, payload.version], ["personal", 1]);
assert.deepEqual(Object.keys(payload.contacts[0]).sort(), ["address", "index", "name"]);
const sealed = Z.backupSeal("correct horse battery staple", JSON.stringify(payload));
assert.notEqual(sealed.includes(acct.seed), true, "the file does not show the seed");
const opened = json(Z.backupOpen("correct horse battery staple", sealed));
assert.deepEqual(opened, payload, "the payload round trips through the encrypted file");
refused(() => Z.backupOpen("wrong passphrase wrong", sealed), "");
const back = readBackup(opened, env);
assert.deepEqual([back.seed, back.network, back.birthday, back.contacts],
  [acct.seed, "testnet", 4500000, list]);
assert.equal("sent" in back || "snapKey" in back, false);
assert.equal(readBackup({ ...payload, seed: acct.seed.toUpperCase() }, env).seed, acct.seed,
  "capital letters are the same seed");
assert.equal(readBackup({ ...payload, extra: 1 }, env).extra, undefined, "unknown fields drop");
const bad = (patch, part) => refused(() => readBackup({ ...payload, ...patch }, env), part);
for (const kind of ["zigs-key-share", "zigs-backup", undefined]) bad({ kind }, NOT_PERSONAL);
bad({ network: "regtest" }, NOT_PERSONAL);
bad({ version: 2 }, "version");
bad({ seed: "ab" }, "valid seed");
bad({ seed: 5 }, "valid seed");
for (const birthday of [0, -1, 1.5, 2 ** 32, "5", null]) bad({ birthday }, "birthday");
bad({ contacts: "x" }, "no valid contacts");
bad({ contacts: Array(MAX_CONTACTS + 1).fill(list[0]) }, "no valid contacts");
bad({ contacts: [{ ...list[0], address: main.address }] }, "Contact 1: Enter a shielded");
bad({ contacts: [list[0], { ...list[1], index: 1 }] }, "Contact 2: has a bad index");
bad({ contacts: [list[0], { ...list[1], address: list[0].address }] }, "Contact 2");
bad({ contacts: [{ ...list[0], index: 0 }] }, "Contact 1");
bad({ contacts: [{ ...list[0], index: 1.5 }] }, "Contact 1");
bad({ contacts: [{ ...list[0], name: "" }] }, "Contact 1: Enter a name");
bad({ contacts: [null] }, "Contact 1: is not valid");
// A name or an address that is not text is an error in words, and never a TypeError.
for (const name of [5, {}, ["Ana"], null, true]) {
  bad({ contacts: [{ ...list[0], name }] }, "Contact 1: Enter a name");
}
for (const address of [5, {}, [list[0].address], null]) {
  bad({ contacts: [{ ...list[0], address }] }, "Contact 1: Enter a shielded");
}
// An index above the cap would end the free indexes of the account. 2^32 - 1 is a valid address
// index, but a file with it is refused.
bad({ contacts: [{ ...list[0], index: CONTACT_INDEX_MAX + 1 }] }, "Contact 1: has a bad index");
bad({ contacts: [{ ...list[0], index: 4294967295 }] }, "Contact 1: has a bad index");
assert.equal(readBackup({ ...payload, contacts: [{ ...list[0], index: CONTACT_INDEX_MAX }] }, env)
  .contacts[0].index, CONTACT_INDEX_MAX);
refused(() => readBackup(null, env), NOT_PERSONAL);
refused(() => readBackup({ ...payload, network: "mainnet" }, env), "Contact 1");
assert.equal(accountBackupName("testnet"), "zigs-personal-testnet.zigsbackup");

// ── The saved record ──
const saved = JSON.parse(JSON.stringify({ ...mineAcct, backedUp: true, sent: [
  { txid: "t1", to: 1, text: "hi", at: 5, tip: 9, fee: 10000, parts: 1, note_value: 3, change: 2,
    broadcast: true },
  { txid: 5, to: 1, text: "bad", at: 5, tip: 9 }, null,
  { txid: "t2", to: "x", text: "bad", at: 1, tip: 1 },
] }));
const norm = normPersonal(saved, env);
assert.equal(norm.sent.length, 1, "a bad entry of the history is dropped");
assert.deepEqual(norm.sent[0], { txid: "t1", to: 1, text: "hi", at: 5, tip: 9, fee: 10000, parts: 1,
  note_value: 3, change: 2, broadcast: true, failed: "" });
assert.deepEqual([norm.seed, norm.backedUp, norm.snapKey, norm.contacts],
  [acct.seed, true, "k".repeat(43), list]);
assert.equal(normPersonal(null, env), null);
assert.equal(normPersonal(undefined, env), null);
refused(() => normPersonal({ ...saved, snapKey: "short" }, env), "sync key");
refused(() => normPersonal({ ...saved, seed: "00" }, env), "valid seed");
refused(() => normPersonal({ kind: "personal" }, env), "");
assert.equal(normPersonal({ ...saved, backedUp: "yes" }, env).backedUp, false);
// A file that was made once stays made, when a new contact makes it out of date.
const flags = (patch) => {
  const got = normPersonal({ ...saved, ...patch }, env);
  return [got.backedUp, got.everBackedUp];
};
assert.deepEqual(flags({ backedUp: true }), [true, true]);
assert.deepEqual(flags({ backedUp: false, everBackedUp: true }), [false, true]);
assert.deepEqual(flags({ backedUp: false }), [false, false]);
assert.deepEqual(flags({ backedUp: false, everBackedUp: "yes" }), [false, false]);
assert.deepEqual(flags({ backedUp: true, everBackedUp: false }), [true, true], "a current file");
const fresh = newPersonal({ seed: acct.seed, network: "testnet", birthday: 5 }, "k".repeat(43));
assert.deepEqual([fresh.backedUp, fresh.everBackedUp], [false, false]);
const restored = restoredPersonal(back, "z".repeat(43));
assert.deepEqual([restored.sent, restored.backedUp, restored.everBackedUp, restored.snapKey],
  [[], true, true, "z".repeat(43)]);
// The remove button names the loss that is real.
assert.match(removeWarning(fresh), /no backup file, so the money in the account is lost/);
assert.match(removeWarning({ backedUp: false, everBackedUp: true }), /seed but not your newest/);
assert.equal(removeWarning(restored), "");

// A record that does not read still gives a backup of what reads: the seed, and the contacts
// that are valid. Without a valid seed there is nothing to save.
const damaged = { ...saved, contacts: [list[0], { ...list[1], index: 4294967295 }, 5,
  { ...list[1], address: list[0].address }, { ...list[1], name: 5 }] };
refused(() => normPersonal(damaged, env), "Contact 2");
const rescued = salvageBackup(damaged, env);
assert.deepEqual(rescued, { ...payload, contacts: [list[0]] }, "the contact that reads stays");
assert.deepEqual(readBackup(rescued, env).contacts, [list[0]], "a restore accepts the file");
assert.deepEqual(Object.keys(rescued).sort(), Object.keys(payload).sort());
assert.deepEqual(salvageBackup({ ...damaged, contacts: "x" }, env).contacts, []);
assert.equal(salvageBackup({ ...damaged, seed: acct.seed.toUpperCase() }, env).seed, acct.seed);
for (const noSeed of [null, 5, {}, { ...damaged, seed: "00" }, { ...damaged, network: "x" },
  { ...damaged, birthday: 0 }, { ...damaged, version: 2 }]) {
  assert.equal(salvageBackup(noSeed, env), null, JSON.stringify(noSeed)?.slice(0, 40));
}

// ── The state of a sent message ──
const rec = { txid: "t1", tip: 100, broadcast: true, failed: "" };
const at = (height, sent = [], extra = {}) =>
  sentState({ ...rec, ...extra }, { sent: new Set(sent), height, live: false });
assert.equal(at(100), "sending");
assert.equal(at(100, ["t1"]), "chain");
assert.equal(at(1000, ["t1"]), "chain", "a block that holds it wins over a late height");
assert.equal(at(100, ["t1"], { failed: "no" }), "chain", "it was sent after all");
assert.equal(at(100, [], { failed: "refused" }), "failed", "a node answered and refused it");
// No answer, or a page that closed, leaves open if the network has the message. It holds its
// notes until a block holds it or it expires, like a message that a server took.
assert.equal(at(100, [], { broadcast: false }), "unsure", "the page closed before it sent");
assert.equal(sentState({ ...rec, broadcast: false }, { sent: new Set(), height: 100, live: true }),
  "sending", "the page is sending it now");
const last = rec.tip + 1 + EXPIRY_BLOCKS + 3;
assert.equal(at(last - 1), "sending");
assert.equal(at(last), "expired");
assert.equal(at(last - 1, [], { broadcast: false }), "unsure");
assert.equal(at(last, [], { broadcast: false }), "expired", "it frees the notes at the end");
assert.equal(at(last, ["t1"], { broadcast: false }), "chain", "a block that holds it wins");
assert.equal(at(undefined), "sending", "no height: wait");
assert.equal(at(undefined, [], { broadcast: false }), "unsure");
assert.deepEqual(["sending", "unsure", "chain", "failed", "expired"].map(holdsNotes),
  [true, true, false, false, false]);
assert.equal(SENT_WORDS.unsure, "May not be sent");
assert.equal(sentNote({ failed: "boom" }, "failed"), "The network refused it: boom");
assert.match(sentNote({ failed: "" }, "unsure"), /cannot tell if the network took the message/);
assert.match(sentNote({}, "expired"), /No block held it/);
assert.equal(sentNote({}, "chain"), "");
assert.equal(sentNote({}, "sending"), "");

// ── Received messages: join, route, order ──
const join = (texts) => json(Z.joinMessage(JSON.stringify(texts))).text;
const parts = json(Z.splitMessage("long ".repeat(200)));
const txs = [
  { txid: "A", height: 10, confirmed: true, value: 0, memo_pending: false, memos: [
    { status: "text", text: parts[1], index: 1 }, { status: "text", text: parts[0], index: 1 }] },
  { txid: "B", height: 11, confirmed: true, value: 0, memos: [
    { status: "text", text: "(1/2) lone", index: 2 }] },
  { txid: "C", height: 12, confirmed: false, value: 0, memos: [
    { status: "text", text: "x", index: 0 }, { status: "text", text: "y", index: 99 },
    { status: "text", text: "z", index: null }] },
  { txid: "D", height: 13, confirmed: true, value: 0, memos: [
    { status: "text", text: "(1/2) a", index: 1 }, { status: "not_text", index: 1 },
    { status: "text", text: "(2/2) b", index: 1 }] },
  { txid: "E", height: 14, confirmed: true, value: 0, memos: [
    { status: "text", text: "(1/2) a", index: 3 }, { status: "text", text: "(2/2) b", index: 1 }] },
  { txid: "F", height: 15, confirmed: true, value: 5, memos: [] },
  { txid: "G", height: 16, memos: [{ status: "text", text: "q", index: 1 },
    { status: "text", text: "r", index: 1 }] },
];
const items = receivedItems(txs, join);
const by = (txid) => items.filter((i) => i.txid === txid);
assert.deepEqual(by("A").map((i) => [i.text === "long ".repeat(200), i.parts, i.index]),
  [[true, 2, 1]], "two parts of one transaction join in any order");
assert.deepEqual(by("B").map((i) => i.text), ["(1/2) lone"], "a lone marker shows as it is");
assert.deepEqual(by("C").map((i) => [i.text, i.index]), [["x", 0], ["y", 99], ["z", null]]);
assert.deepEqual(by("D").map((i) => i.text), ["(1/2) a", null, "(2/2) b"],
  "a memo that is not text keeps the parts apart");
assert.deepEqual(by("E").map((i) => [i.text, i.index]), [["(1/2) a", 3], ["(2/2) b", 1]],
  "parts that went to two addresses are not joined");
assert.deepEqual(by("F"), [], "a payment with no memo shows nothing");
assert.deepEqual(by("G").map((i) => i.text), ["q", "r"], "unmarked memos stay apart");
assert.equal(by("A")[0].key, "A:1:0");
assert.equal(new Set(items.map((i) => i.key)).size, items.length, "keys are unique");
assert.deepEqual([receivedItems(null, join), receivedItems([{ txid: "x", memos: "no" }], join)],
  [[], []]);

const contacts = [{ name: "Ana", address: "a", index: 1 }, { name: "Ben", address: "b", index: 2 }];
const routed = routeItems(items, contacts);
assert.deepEqual([...routed.chats.keys()], [1, 2]);
assert.deepEqual(routed.chats.get(2).map((i) => i.txid), ["B"]);
assert.deepEqual(routed.chats.get(1).map((i) => i.txid).sort(),
  ["A", "D", "D", "D", "E", "G", "G"]);
assert.deepEqual(routed.other.map((i) => i.text).sort(), ["(1/2) a", "x", "y", "z"],
  "index 0, an unknown index and no index go to other messages");
assert.deepEqual(routeItems(items, []).chats.size, 0);
assert.equal(routeItems(items, []).other.length, items.length, "without contacts, all is other");
assert.match(otherWhere(0), /public address/);
assert.match(otherWhere(7), /no contact/);
assert.match(otherWhere(null), /cannot place/);

const sent = [{ txid: "S2", at: 5000, text: "later" }, { txid: "S1", at: 1000, text: "first" }];
const rows = chatTimeline(routed.chats.get(2), sent, (h) => h * 100);
assert.deepEqual(rows.map((r) => [r.dir, r.id]), [["out", "S1"], ["in", "B:2:0"], ["out", "S2"]],
  "oldest first, received and sent in one list");
assert.deepEqual(chatTimeline([], [], () => 0), []);
assert.deepEqual(chatTimeline([{ key: "b", height: 1 }, { key: "a", height: 1 }], [], () => 7)
  .map((r) => r.id), ["a", "b"], "the same time: by id");

console.log("personal.mjs: ok");
