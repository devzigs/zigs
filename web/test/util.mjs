// Checks the pure helpers. Run: node web/test/util.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as Z from "../pkg/zec_frost_wasm.js";
import {
  abortText, backupName, boxPairMatches, canonical, checkNetwork, chunks, confirmGate,
  conflictReason, finite, fitsPublished, fmtInt, frostId, heldRefusal, keysOf, lateFields,
  LINK_CHAT_ID, LINK_NEW_SECRET, linkRefusal, makePassphrase, numberClash, passIssue, passLength,
  passNormal, restoredFields, restoredSecret, sameShare, samePackages, seatOwned, settledFields,
  SETUP_HELD, shareShape, skey, slowCall, staleRestore, takenKeys, undoPlan, walletVersion,
  withoutKeys,
} from "../util.js";

Z.initSync({ module: readFileSync(new URL("../pkg/zec_frost_wasm_bg.wasm", import.meta.url)) });

assert.deepEqual(chunks("abcdefghij"), ["abcde", "fghij"]);
assert.deepEqual(chunks("abcdefg"), ["abcde", "fg"]);
assert.deepEqual(chunks(""), []);
assert.deepEqual(chunks(null), []);
assert.equal(chunks("u1abcdefghijklmnopqrstuvwxyz").join(""), "u1abcdefghijklmnopqrstuvwxyz");

assert.equal(fmtInt(1234567), "1,234,567");
for (const bad of ["12", null, undefined, NaN, Infinity, {}, [], "abc"]) assert.equal(fmtInt(bad), "unknown");
assert.equal(finite(5), 5);
for (const bad of ["5", null, undefined, NaN, Infinity]) assert.equal(finite(bad), 0);

assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
const a = { verifying_shares: { x: "1", y: "2" }, verifying_key: "k" };
const sameButReordered = { verifying_key: "k", verifying_shares: { y: "2", x: "1" } };
assert.equal(samePackages([a, JSON.stringify(sameButReordered), JSON.stringify(a)]), true);
assert.equal(samePackages([a, { ...a, verifying_shares: { x: "1", y: "3" } }]), false);
assert.equal(samePackages([a, { ...a, extra: 1 }]), false);
assert.equal(samePackages([a, null]), false);
assert.equal(samePackages([a, "{not json"]), false);
assert.equal(samePackages([]), false);

assert.equal(walletVersion({}), 1);
assert.equal(walletVersion({ version: 1 }), 1);
assert.equal(walletVersion({ version: 2 }), 2);
for (const bad of [0, 3, "2", null, NaN, {}]) assert.equal(walletVersion({ version: bad }), 0);

const ids = [1, 2, 3], no = "1234 5678 9012", other = "1234 5678 9013";
const docs = (...nums) => Object.fromEntries(nums.map((n, k) => [k + 1, n === null ? undefined : { number: n }]));
assert.equal(confirmGate(no, no, docs(no, no, no), ids), "ok");
assert.equal(confirmGate(no, no, docs(no, no, null), ids), "wait");          // a seat has not confirmed
assert.equal(confirmGate(no, null, docs(no, no, no), ids), "wait");          // documents alone are claims
assert.equal(confirmGate(no, other, docs(no, no, no), ids), "wait");         // confirmed another number
assert.equal(confirmGate(no, no, docs(no, other, no), ids), "mismatch");
assert.equal(confirmGate(no, no, docs(no, other, null), ids), "mismatch");   // a clash beats a gap
assert.equal(confirmGate(no, no, docs(no, 7, no), ids), "wait");             // a bad number is a gap
assert.equal(confirmGate(null, no, docs(no, no, no), ids), "wait");
assert.deepEqual(numberClash(no, docs(no, other, other), ids), [2, 3]);
assert.deepEqual(numberClash(no, docs(no, null, no), ids), []);
assert.equal(abortText("Signers saw different setup data."),
  "Signers saw different setup data. Do not use this wallet. Create a new wallet.");
assert.equal(abortText("seat 2: the secret part does not match its commitment"),
  "Seat 2: the secret part does not match its commitment. Do not use this wallet. Create a new wallet.");
assert.equal(abortText(""), "Setup failed. Do not use this wallet. Create a new wallet.");
assert.doesNotThrow(() => checkNetwork({ network: "testnet" }, "testnet"));
assert.throws(() => checkNetwork({ network: "mainnet" }, "testnet"), /another network/);
assert.throws(() => checkNetwork({}, "testnet"), /another network/);

// A seat ends its setup when the store changes what it took: its wallet version, its key, or the
// safety number that its person confirmed.
const mine = { version: 2, boxPk: "aa" };
const conflict = conflictReason;
const none = { sawV2: false }, v2 = { sawV2: true };
assert.equal(conflict(mine, { boxPk: "aa" }, 2, 2, none), null);
assert.equal(conflict(mine, undefined, 2, 2, none), null);                 // seat not loaded yet
assert.match(conflict(mine, { boxPk: "bb" }, 2, 2, none), /seat key was replaced/);
assert.match(conflict(mine, { boxPk: "aa" }, 1, 2, none), /version of this wallet changed/);
assert.equal(conflict({ version: 1 }, { boxPk: "bb" }, 1, 1, none), null);  // version 1: no key check
assert.match(conflict({ version: 1 }, {}, 1, 1, v2), /new setup/);
assert.equal(conflict({ version: 1, keyPackage: {} }, {}, 1, 1, v2), null);
assert.equal(conflict({}, { boxPk: "bb" }, 2, 2, none), null);              // seat from before keys

// The safety number changed after this seat confirmed it: the seat stops, with no new tap.
const confirmed = { ...mine, confirmed: no }, same = { boxPk: "aa" };
const moved = conflict(confirmed, same, 2, 2, { sawV2: true, number: other });
assert.match(moved, /safety number changed after you confirmed/);
assert.equal(abortText(moved), "The safety number changed after you confirmed it. Someone may have "
  + "replaced a seat. Do not use this wallet. Create a new wallet.");
assert.equal(conflict(confirmed, same, 2, 2, { sawV2: true, number: no }), null);   // same number
assert.equal(conflict(mine, same, 2, 2, { sawV2: true, number: other }), null);     // not confirmed
assert.equal(conflict(confirmed, same, 2, 2, { sawV2: true, number: null }), null); // no number now
assert.equal(conflict({ ...confirmed, keyPackage: {} }, same, 2, 2, { number: other }), null);
assert.equal(conflict({ ...confirmed, version: 1 }, same, 1, 1, { number: other }), null);
assert.equal(conflict({ ...confirmed, confirmed: 7 }, same, 2, 2, { number: other }), null);
assert.match(conflict(confirmed, { boxPk: "bb" }, 2, 2, { number: other }), /seat key was replaced/);

// Backup passphrases: normalized to NFC, counted in Unicode scalar values, never trimmed.
const sixteen = "abcdefghijklmnop";
assert.equal(passLength("e\u0301"), 2);                  // passLength itself does not normalize
const faces = Array.from({ length: 8 }, (_, i) => String.fromCodePoint(0x1f600 + i)).join("");
assert.equal(passLength(faces.repeat(2)), 16);            // an astral character is one, not two
assert.equal(passLength(sixteen), 16);
assert.match(passIssue("a".repeat(15), "a".repeat(15)), /at least 16 characters \(15 so far\)/);
assert.match(passIssue(faces.repeat(2).slice(0, -2), ""), /15 so far/);
assert.match(passIssue(sixteen, ""), /again/);
assert.match(passIssue(sixteen, sixteen + " "), /not the same/);   // a trailing space counts
assert.equal(passIssue(faces.repeat(2), faces.repeat(2)), "");
assert.equal(passIssue(sixteen, sixteen), "");

// A passphrase that repeats few characters is refused, with a nudge to make one.
for (const weak of ["a".repeat(16), " ".repeat(16), "ab".repeat(8), "abcdefg".repeat(3)]) {
  assert.match(passIssue(weak, weak), /at least 8 different characters/, weak);
}
assert.match(passIssue("abcdefg".repeat(3), ""), /\(7 so far\).*Make a passphrase for me/);
assert.equal(passIssue("abcdefgh".repeat(2), "abcdefgh".repeat(2)), "");
assert.equal(passIssue("\u{1F600}\u{1F601}\u{1F602}\u{1F603}".repeat(4), ""),
  "Use at least 8 different characters (4 so far), or choose Make a passphrase for me.");

// NFC: "e with acute" typed as one scalar or as two gives one passphrase, in the count, the
// confirm step and the engine call.
const composed = "caf\u00e9 cr\u00e8me br\u00fbl\u00e9e", split = composed.normalize("NFD");
assert.notEqual(composed, split);
assert.equal(passNormal(split), composed);
assert.equal(passIssue(composed, split), "");
assert.equal(passIssue(split, composed), "");
assert.match(passIssue(split.slice(0, 18), ""), /\(15 so far\)/);   // 18 scalars before, 15 after

// A made passphrase: 6 groups of 5 from the 32 symbols, one symbol per 5 bits.
const bytes = Uint8Array.from({ length: 30 }, (_, i) => i);
assert.equal(makePassphrase(bytes), "01234-56789-abcde-fghjk-mnpqr-stvwx");
assert.equal(makePassphrase(new Uint8Array(30).fill(255)), "zzzzz-".repeat(5) + "zzzzz");
assert.equal(makePassphrase(new Uint8Array(30).fill(32)), "00000-".repeat(5) + "00000");
assert.throws(() => makePassphrase(new Uint8Array(29)), /30 random bytes/);
const made = makePassphrase(crypto.getRandomValues(new Uint8Array(30)));
assert.match(made, /^([0-9a-hjkmnp-tv-z]{5}-){5}[0-9a-hjkmnp-tv-z]{5}$/);
assert.equal(passIssue(made, made), "");

assert.equal(backupName("Team treasury", 2), "zigs-Team-treasury-seat-2.zigsbackup");
assert.equal(backupName("  Ops / 2026!  ", 1), "zigs-Ops-2026-seat-1.zigsbackup");
assert.equal(backupName("\u65e5\u672c", 3), "zigs-wallet-seat-3.zigsbackup");
assert.equal(backupName("", 1), "zigs-wallet-seat-1.zigsbackup");

// A restore takes only the allowed fields of a seat secret. Wallet checks, setup state, `uid` and
// `nonces` of a file are dropped, and so is a name that could reach the prototype.
const fromFile = JSON.parse(`{"keyPackage":{"identifier":"01","verifying_share":"aa"},
  "vaultSk":"v","boxSk":"b","version":2,"checkedWallet":"w","rejectedWallet":null,"aborted":"x",
  "confirmed":"9","doneSent":true,"r1secret":"r","skPart":"s","echo":"e","uid":"u","nonces":{"a":1},
  "backedUp":true,"restored":true,"__proto__":{"polluted":true},"extra":1}`);
assert.deepEqual(Object.keys(restoredFields(fromFile)).sort(), ["boxSk", "keyPackage", "vaultSk",
  "version"]);
assert.equal(restoredFields(fromFile).version, 2);
assert.equal(({}).polluted, undefined);
assert.equal(Object.assign({}, restoredFields(fromFile)).polluted, undefined);
assert.deepEqual(restoredFields({}), {});
const kept = { room: { id: "r" }, signPk: null };
assert.deepEqual(restoredFields(kept), kept);

// A key share is named by its identifier and verifying share.
const share = { identifier: "02", verifying_share: "ab", signing_share: "cd" };
assert.ok(shareShape(share));
const notShares = [null, undefined, "x", {}, { identifier: "02" },
  { identifier: 2, verifying_share: "ab" }];
for (const bad of notShares) {
  assert.ok(!shareShape(bad), JSON.stringify(bad));
}
assert.ok(sameShare(share, { identifier: "02", verifying_share: "ab", signing_share: "other" }));
assert.ok(!sameShare(share, { identifier: "03", verifying_share: "ab" }));
assert.ok(!sameShare(share, { identifier: "02", verifying_share: "ac" }));
assert.ok(!sameShare(share, {}) && !sameShare({}, {}) && !sameShare(null, share));

// A file that copies the public values of a share cannot replace or add secret values on a device
// that holds a key share for the seat: the device keeps exactly what it holds.
const live = { keyPackage: { identifier: "02", verifying_share: "ab", signing_share: "live" },
  publicKeyPackage: "live-pkp", vaultSk: "live-v", checkedWallet: "live-check", nonces: { a: 1 } };
const forged = { keyPackage: { identifier: "02", verifying_share: "ab", signing_share: "forged" },
  publicKeyPackage: "forged-pkp", vaultSk: "forged-v", signPk: "file-sign", checkedWallet: "evil",
  version: 2, room: { id: "forged-room", key: "forged-key" }, groupKey: "forged-gk" };
const merged = restoredSecret(forged, live);
assert.equal(merged.keyPackage.signing_share, "live");
assert.equal(merged.publicKeyPackage, "live-pkp");
assert.equal(merged.vaultSk, "live-v");
assert.deepEqual(Object.keys(merged).sort(), ["keyPackage", "publicKeyPackage", "vaultSk"]);
assert.deepEqual(lateFields(forged, live), {});     // no late field either
// A held share without a version, a setup secret or a room: nothing comes from the file.
const noExtras = { keyPackage: live.keyPackage, publicKeyPackage: "live-pkp",
  groupKey: "live-gk" };
assert.deepEqual(restoredSecret(forged, noExtras), noExtras);
assert.deepEqual(lateFields(forged, noExtras), {});
assert.equal(undoPlan(noExtras), "keep");
// A fresh device takes the allowed fields now, but not the key pairs, the version or the room.
for (const none of [undefined, {}, { boxSk: "x" }, { keyPackage: { identifier: "02" } }]) {
  const now = restoredSecret(forged, none);
  assert.deepEqual(Object.keys(now).sort(),
    ["groupKey", "keyPackage", "publicKeyPackage", "vaultSk"]);
  assert.equal(now.vaultSk, "forged-v");              // nothing held: the file
  assert.deepEqual(lateFields(forged, none), { version: 2, room: forged.room });
}
assert.deepEqual(lateFields({ keyPackage: live.keyPackage }, undefined), {});   // none in the file

// The late fields join the seat only when they equal the wallet's own values, and the stored
// values are the wallet's.
const room = { id: "a".repeat(20), key: "k".repeat(43), extra: "wallet" };
const late = { version: 2, room: { id: room.id, key: room.key } };
const walletRoom = { id: room.id, key: room.key };
assert.deepEqual(settledFields(late, 2, room), { version: 2, room: walletRoom });
assert.deepEqual(settledFields(late, 1, room), { room: walletRoom });
assert.deepEqual(settledFields(late, 2, { ...room, key: "other" }), { version: 2 });
assert.deepEqual(settledFields(late, 2, { ...room, id: "other" }), { version: 2 });
assert.deepEqual(settledFields(late, 2, undefined), { version: 2 });
assert.deepEqual(settledFields(late, 0, null), {});               // a version this app lacks
assert.deepEqual(settledFields({ version: "2", room: "x" }, 2, room), {});   // not the same type
assert.deepEqual(settledFields({ version: true }, 1, room), {});
assert.deepEqual(settledFields({ room: { id: 5, key: 6 } }, 2, { id: 5, key: 6 }), {});
assert.deepEqual(settledFields({}, 2, room), {});
// The wallet value is stored, not an object of the file.
assert.notEqual(settledFields(late, 2, room).room, late.room);

// A restore that waits is kept by wallet and seat: seats of one wallet differ, and so do wallets.
assert.equal(skey("g1", 2), "g1:2");
assert.notEqual(skey("g1", 1), skey("g1", 2));
assert.notEqual(skey("g1", 1), skey("g2", 1));
assert.equal(new Set([skey("g1", 1), skey("g1", 2), skey("g2", 1), skey("g1", 1)]).size, 3);

// A restored seat fits when its share, its public key package and its group key are the ones that
// the wallet published for the seat. A package that holds the same values in another order fits.
assert.equal(frostId(2), "02" + "0".repeat(62));
assert.equal(frostId(11), "0b" + "0".repeat(62));
const id2 = frostId(2);
const pkp = { verifying_key: "gk", verifying_shares: { [id2]: "ab", [frostId(1)]: "cc" } };
const pub = { groupKey: "gk", publicKeyPackage: JSON.stringify(pkp) };
const mineKey = { keyPackage: { identifier: id2, verifying_share: "ab", signing_share: "cd" },
  publicKeyPackage: { verifying_shares: { [frostId(1)]: "cc", [id2]: "ab" }, verifying_key: "gk" },
  groupKey: "gk" };
assert.equal(fitsPublished(2, mineKey, pub), true);
assert.equal(fitsPublished(2, { ...mineKey, publicKeyPackage: JSON.stringify(pkp) }, pub), true);
assert.equal(fitsPublished(3, mineKey, pub), false);                      // another seat
assert.equal(fitsPublished(2, mineKey, undefined), false);                // nothing published
assert.equal(fitsPublished(2, { ...mineKey, keyPackage: undefined }, pub), false);
const otherShare = { ...mineKey.keyPackage, verifying_share: "ac" };
assert.equal(fitsPublished(2, { ...mineKey, keyPackage: otherShare }, pub), false);
const widerPkp = { ...pkp, verifying_shares: { ...pkp.verifying_shares, [frostId(3)]: "ee" } };
assert.equal(fitsPublished(2, { ...mineKey, publicKeyPackage: widerPkp }, pub), false);
assert.equal(fitsPublished(2, { ...mineKey, publicKeyPackage: undefined }, pub), false);
assert.equal(fitsPublished(2, { ...mineKey, publicKeyPackage: "{not json" }, pub), false);
assert.equal(fitsPublished(2, { ...mineKey, groupKey: "other" }, pub), false);
assert.equal(fitsPublished(2, { ...mineKey, groupKey: undefined }, pub), false);
assert.equal(fitsPublished(2, mineKey, { ...pub, groupKey: undefined }), false);
assert.equal(fitsPublished(2, mineKey, { ...pub, publicKeyPackage: undefined }), false);
assert.equal(fitsPublished(2, mineKey, { ...pub, publicKeyPackage: pkp }), false);   // text only
// A published package that names no share for the seat, or names it twice as undefined.
const bare = JSON.stringify({ verifying_key: "gk" });
const noShare = { ...mineKey, publicKeyPackage: bare };
assert.equal(fitsPublished(2, noShare, { ...pub, publicKeyPackage: bare }), false);

// Key pairs: a file's keys join the seat only after they checked out, and the seat's own win.
const file = { keyPackage: mineKey.keyPackage, boxSk: "b", boxPk: "B", signSk: "s", signPk: "S",
  vaultSk: "v" };
assert.deepEqual(Object.keys(withoutKeys(file)).sort(), ["keyPackage", "vaultSk"]);
assert.deepEqual(keysOf(file), { boxSk: "b", boxPk: "B", signSk: "s", signPk: "S" });
assert.deepEqual(withoutKeys({}), {});
assert.deepEqual(keysOf({ vaultSk: "v" }), {});
const published = { boxPk: "B", signPk: "S" };
assert.deepEqual(takenKeys(file, {}, ["box"], published), { boxSk: "b", boxPk: "B" });
assert.deepEqual(takenKeys(file, {}, ["box", "sign"], published),
  { boxSk: "b", boxPk: "B", signSk: "s", signPk: "S" });
assert.deepEqual(takenKeys(file, {}, [], published), {});
assert.deepEqual(takenKeys(file, { boxSk: "mine" }, ["box", "sign"], published),
  { signSk: "s", signPk: "S" });
assert.deepEqual(takenKeys(file, { signPk: "mine" }, ["sign"], published), {});
assert.deepEqual(takenKeys(file, { boxSk: "mine" }, ["box"], published), {});
// The stored public key is the published one, so a file without `boxPk` keeps its secret key.
const skOnly = { boxSk: "b" };
assert.deepEqual(takenKeys(skOnly, {}, ["box"], published), { boxSk: "b", boxPk: "B" });

// An X25519 secret key makes one public key. The engine proves it with a sealed box.
const pair = JSON.parse(Z.boxKeypair()), stranger = JSON.parse(Z.boxKeypair());
assert.equal(boxPairMatches(Z, pair.sk, pair.pk), true);
assert.equal(boxPairMatches(Z, stranger.sk, pair.pk), false);
assert.equal(boxPairMatches(Z, pair.sk, stranger.pk), false);
for (const bad of [undefined, null, "", "zz", "00", 5, "0".repeat(64)]) {
  assert.equal(boxPairMatches(Z, bad, pair.pk), false, String(bad));
  assert.equal(boxPairMatches(Z, pair.sk, bad), false, String(bad));
}
assert.equal(boxPairMatches({}, pair.sk, pair.pk), false);   // no engine

// The undo of a restore removes a seat that held nothing and keeps a seat that held a key share.
// It never writes back an old copy with old nonces.
const heldShare = { keyPackage: mineKey.keyPackage, nonces: { s1: "old" } };
assert.equal(undoPlan(undefined), "remove");
assert.equal(undoPlan(null), "remove");
assert.equal(undoPlan(heldShare), "keep");

// A restore is refused over a seat secret that holds no key share: the seat is in setup on this
// device. The test secrets hold only r1secret and boxSk, or no key package that has a share.
const setupSecrets = [{ r1secret: "r", boxSk: "b" }, { skPart: "p", boxSk: "b" }, { boxSk: "b" },
  { r1secret: "r", boxSk: "b", uid: "me" }, {}, { keyPackage: { identifier: id2 } },
  { keyPackage: "text", boxSk: "b" }, { r2secret: "r2", keyPackage: null }];
for (const inSetup of setupSecrets) {
  assert.equal(heldRefusal(inSetup, mineKey.keyPackage, 2), SETUP_HELD, JSON.stringify(inSetup));
}
assert.match(SETUP_HELD, /still being set up/);
assert.equal(heldRefusal(undefined, mineKey.keyPackage, 2), null);           // no secret
assert.equal(heldRefusal(null, mineKey.keyPackage, 2), null);
assert.equal(heldRefusal(heldShare, mineKey.keyPackage, 2), null);           // the same share
assert.match(heldRefusal(heldShare, otherShare, 2), /another key share for seat 2/);

// A restored seat counts as a seat of this browser only while it fits the wallet, whatever its
// identity says. Without the flag, the identity decides.
const seatDoc = { uid: "u-seat" };
const fits = (v) => () => v;
const never = () => { throw new Error("fit was asked"); };
for (const secret of [{ restored: true }, { restored: true, uid: "u-seat" }]) {
  for (const me of ["u-seat", "other"]) {
    assert.equal(seatOwned({}, {}, "me", fits(true)), false, "a seat with no uid is nobody's");
    assert.equal(seatOwned(seatDoc, secret, me, fits(true)), true);
    assert.equal(seatOwned(seatDoc, secret, me, fits(false)), false, JSON.stringify([secret, me]));
    assert.equal(seatOwned(seatDoc, secret, me, fits(null)), false, JSON.stringify([secret, me]));
  }
}
const recorded = { restored: true, uid: "u-seat" };    // reactSeat records the identity
assert.equal(seatOwned(seatDoc, recorded, "u-seat", fits(undefined)), false);
assert.equal(seatOwned(seatDoc, { restored: true }, "other", fits(true)), true);   // no identity
assert.equal(seatOwned(seatDoc, { uid: "u-seat" }, "other", never), true);          // taken before
assert.equal(seatOwned(seatDoc, {}, "u-seat", never), true);                        // taken now
assert.equal(seatOwned(seatDoc, { uid: "x" }, "y", never), false);
assert.equal(seatOwned(undefined, { restored: true }, "u-seat", fits(true)), false);   // no seat
assert.equal(seatOwned(undefined, { uid: "u-seat" }, "u-seat", never), false);

// A stale restore is a restored secret that does not fit and that no restore waits for.
const staleChecks = [
  [{ restored: true }, false, false, true],
  [{ restored: true }, false, true, false],        // a restore waits: settleRestore decides
  [{ restored: true }, null, false, false],        // not known yet
  [{ restored: true }, true, false, false],
  [{ keyPackage: mineKey.keyPackage }, false, false, false],   // a seat taken here
  [undefined, false, false, false],
];
for (const [held, fit, waiting, stale] of staleChecks) {
  assert.equal(staleRestore(held, fits(fit), waiting), stale, JSON.stringify([held, fit, waiting]));
}
assert.equal(staleRestore({}, never, false), false);                // the fit is not asked

// An invite link is ignored when it would replace a wallet secret, or when its id belongs to a chat
// or message room. A new id, or the same secret again, is taken.
assert.equal(linkRefusal(undefined, "k", false), null);
assert.equal(linkRefusal("k", "k", false), null);
assert.equal(linkRefusal("old", "k", false), LINK_NEW_SECRET);
assert.equal(linkRefusal(undefined, "k", true), LINK_CHAT_ID);
assert.equal(linkRefusal("k", "k", true), LINK_CHAT_ID);
assert.equal(linkRefusal("old", "k", true), LINK_NEW_SECRET);          // the clash is named first
assert.equal(LINK_CHAT_ID, "This invite link uses the id of a chat or message room that you have, "
  + "so it was ignored.");

// Slow engine calls go through one table. An unknown method is refused.
const fake = { finalize: (p) => JSON.stringify({ txid: p }), backupSeal: (a, b) => a + "|" + b,
  backupOpen: (a, b) => b + "|" + a };
assert.equal(slowCall(fake, "backupSeal", ["pw", "plain"]), "pw|plain");
assert.equal(slowCall(fake, "backupOpen", ["pw", "sealed"]), "sealed|pw");
assert.equal(slowCall(fake, "backupSeal", [split, "plain"]), composed + "|plain");   // NFC
assert.equal(slowCall(fake, "backupOpen", [split, "sealed"]), "sealed|" + composed);
const fin = slowCall(fake, "finalize", ["tx"]);
assert.equal(fin.txid, "tx");
assert.ok(Number.isInteger(fin.ms));
assert.throws(() => slowCall(fake, "constructor", []), /Unknown engine call/);
assert.throws(() => slowCall(fake, "toString", []), /Unknown engine call/);
console.log("util ok");
