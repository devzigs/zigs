// Checks the helpers for signed writes. Run: node web/test/signed.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as Z from "../pkg/zec_frost_wasm.js";
import { newSignKey, signMsg, verifyMsg } from "../chat.js";
import {
  docFields, filterWallet, makeMemo, PARTS, partFields, proposalFields, readSession, signPart,
  trustShape, validShape, writerCheck, writerOf,
} from "../signed.js";

Z.initSync({ module: readFileSync(new URL("../pkg/zec_frost_wasm_bg.wasm", import.meta.url)) });

// The text that is signed comes from the engine. A fixed vector: other apps must build this text
// and accept this signature (PROTOCOL.md, section 15).
const GID = "0123456789abcdef0123";
const FIELDS = '{"number":"12345 67890 12345 67890 12345 67890","at":1760000000000}';
const FIXED_TEXT = '["zigs-doc-v1","0123456789abcdef0123","confirm/2",2,{"at":1760000000000,'
  + '"number":"12345 67890 12345 67890 12345 67890"}]';
const FIXED_PK = "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8";
const FIXED_SIG = "HfeBGagkHgfSW/dlhgyAuMGNEUigk6iD3xyUyS0FrO035rvYkbv+qEvQtn/KczG4cpUvbg2vhBrKw2h"
  + "QgWrfDw==";
assert.equal(Z.docPayload(GID, "confirm/2", 2, FIELDS), FIXED_TEXT);
assert.equal(await verifyMsg(FIXED_PK, FIXED_SIG, FIXED_TEXT), true);
const movedText = FIXED_TEXT.replace("confirm/2", "confirm/1");
assert.equal(await verifyMsg(FIXED_PK, FIXED_SIG, movedText), false);

// Key order and spacing of the fields do not change the text. Other values do.
const messy = '{ "number" : "12345 67890 12345 67890 12345 67890",\n  "at" : 1760000000000 }';
assert.equal(Z.docPayload(GID, "confirm/2", 2, messy), FIXED_TEXT);
const nested = { z: { b: [1, { y: 2, x: 1 }], a: null }, a: "é\"\\\n" };
assert.equal(Z.docPayload(GID, "p", 1, JSON.stringify(nested)),
  '["zigs-doc-v1","' + GID + '","p",1,{"a":"é\\"\\\\\\n","z":{"a":null,"b":[1,{"x":1,"y":2}]}}]');
for (const bad of ["[]", "7", "null", '{"a":1.5}', '{"a":1e3}', "{"]) {
  assert.throws(() => Z.docPayload(GID, "p", 1, bad), `${bad} is refused`);
}

// A payload signed by one key verifies, and no change of wallet, path, seat or field does.
const key = await newSignKey(), other = await newSignKey();
const text = Z.docPayload(GID, "sessions/s1/commits/2", 2, '{"commitments":{"a":"b"},"at":5}');
const sig = await signMsg(key.signSk, text);
assert.equal(await verifyMsg(key.signPk, sig, text), true);
assert.equal(await verifyMsg(other.signPk, sig, text), false);
const edits = [
  Z.docPayload("f".repeat(20), "sessions/s1/commits/2", 2, '{"commitments":{"a":"b"},"at":5}'),
  Z.docPayload(GID, "sessions/s2/commits/2", 2, '{"commitments":{"a":"b"},"at":5}'),
  Z.docPayload(GID, "sessions/s1/commits/2", 3, '{"commitments":{"a":"b"},"at":5}'),
  Z.docPayload(GID, "sessions/s1/commits/2", 2, '{"commitments":{"a":"c"},"at":5}'),
  Z.docPayload(GID, "sessions/s1/commits/2", 2, '{"commitments":{"a":"b"}}'),
  Z.docPayload(GID, "sessions/s1/commits/2", 2, '{"commitments":{"a":"b"},"at":5,"x":1}'),
];
for (const changed of edits) assert.equal(await verifyMsg(key.signPk, sig, changed), false);

// The writer of a document that a seat signs as a whole.
const writers = {
  "confirm/3": 3, "abort/1": 1, "dkg1/2": 2, "dkg2/2-3": 2, "dkg2/10-1": 10, "done/4": 4,
  "verify/5": 5, "meta/wallet": 1, "sessions/ab12-cd/commits/2": 2, "sessions/ab12/shares/7": 7,
  "seats/2": 2,
};
for (const [rel, seat] of Object.entries(writers)) assert.equal(writerOf(rel), seat, rel);
for (const rel of ["confirm/0", "confirm/01", "confirm/x", "confirm/1/2", "dkg2/1", "dkg2/1-",
  "commits/1", "sessions/s1", "sessions/s1/commits/", "sessions//commits/1", "meta/other",
  "seats/0", "seats/x", "seats", "messages/1", "", "__proto__", "confirm/1\n",
  "sessions/a/b/commits/1"]) {
  assert.equal(writerOf(rel), undefined, JSON.stringify(rel));
}

assert.deepEqual(docFields({ number: "1", by: 2, sig: "x", at: 3 }), { number: "1", at: 3 });
assert.deepEqual(docFields({ by: 1, sig: "x" }), {});

// Who may have written a document: a seat of the wallet, and the seat that its path names.
const pk = key.signPk;
assert.equal(writerCheck(2, 2, 3, pk, true), "check");
assert.equal(writerCheck(3, 2, 3, pk, true), "no");           // commits/2 signed by seat 3
assert.equal(writerCheck(2, null, 3, pk, true), "check");     // a part: any seat
assert.equal(writerCheck(4, null, 3, pk, true), "no");        // not a seat of this wallet
for (const by of [0, -1, 1.5, "2", null, undefined, NaN]) {
  assert.equal(writerCheck(by, null, 3, pk, true), "no", String(by));
}
assert.equal(writerCheck(2, 2, 3, undefined, true), "no");    // no key pinned for the seat
assert.equal(writerCheck(2, 2, 3, "zz", true), "no");
assert.equal(writerCheck(2, 2, 3, undefined, false), "wait"); // the seats may still load

// Session parts.
const proposal = {
  payees: [{ to: "utest1x", amount: 5 }], note: null, pool: "ironwood", amount: 5, change: 1,
  fee: 10000, noteValue: 20, pczt: "AAA", move: null, createdAt: 1760000000000,
};
assert.deepEqual(Object.keys(proposal), PARTS.proposal.fields);
const stamp = (d, by = 2) => ({ ...d, by, sig: "s", createdBy: "uid", status: "collecting" });
const base = stamp(proposal);
const asks = [];
const allow = (...yes) => (name, by, sig, fields) => {
  asks.push({ name, by, sig, fields });
  return yes.includes(name) ? "yes" : "no";
};

let r = readSession("s1", base, allow("proposal"));
assert.equal(r.ss.id, "s1");
assert.equal(r.ss.status, "collecting");
assert.deepEqual(r.bad, []);
assert.deepEqual(asks, [{ name: "proposal", by: 2, sig: "s", fields: proposal }]);
assert.equal(r.ss.by, 2);

// No valid proposal: no session. A part that is not asked about does not count.
asks.length = 0;
r = readSession("s1", { ...base, package: "P", packageBy: 1, packageSig: "x" }, allow());
assert.equal(r.ss, null);
assert.deepEqual(r.bad, ["proposal"]);
assert.equal(asks.length, 1);
r = readSession("s1", base, () => "wait");
assert.deepEqual([r.ss, r.bad, r.wait], [null, [], 1]);
r = readSession("s1", { ...base, pczt: undefined }, allow("proposal"));
assert.equal(asks.at(-1).fields.pczt, undefined, "a missing field is not signed");

// The package part: kept when it verifies, taken out when not.
const withPackage = { ...base, package: "PKG", signers: [1, 2], packageBy: 1, packageSig: "p",
  status: "signing" };
r = readSession("s1", withPackage, allow("proposal", "package"));
assert.deepEqual([r.ss.package, r.ss.signers, r.ss.status], ["PKG", [1, 2], "signing"]);
assert.deepEqual(asks.at(-1),
  { name: "package", by: 1, sig: "p", fields: { package: "PKG", signers: [1, 2] } });
r = readSession("s1", withPackage, allow("proposal"));
assert.deepEqual(r.bad, ["package"]);
for (const k of ["package", "signers", "packageBy", "packageSig"]) {
  assert.equal(k in r.ss, false, k);
}
assert.equal(r.ss.status, "collecting", "the stored status does not count");
r = readSession("s1", { ...base, package: "PKG" }, allow("proposal"));   // no writer, no signature
assert.deepEqual(r.bad, ["package"]);
assert.equal(r.ss.package, undefined);

// The signed PCZT, the proof and the sent mark are signed parts. Each needs the part before it.
const aggPart = { signed: "SIGNED", signatures: [{ action: 0 }], signedBy: 2, signedSig: "a" };
const finPart = { final: { txid: "t", tx_hex: "00" }, finalBy: 2, finalSig: "f" };
const sentPart = { broadcastTxid: "t", broadcastAt: 9, sentBy: 1, sentSig: "s" };
const chain = { ...withPackage, ...aggPart, ...finPart, ...sentPart, status: "broadcast" };
const everything = allow("proposal", "package", "signed", "final", "sent");
r = readSession("s1", chain, everything);
assert.deepEqual([r.ss.status, r.ss.final.txid, r.ss.broadcastTxid, r.bad],
  ["broadcast", "t", "t", []]);
assert.deepEqual(asks.slice(-3).map((a) => [a.name, a.by]),
  [["signed", 2], ["final", 2], ["sent", 1]]);
assert.deepEqual(asks.at(-3).fields, { signed: "SIGNED", signatures: [{ action: 0 }] });
assert.deepEqual(asks.at(-1).fields, { broadcastTxid: "t", broadcastAt: 9 });
const upTo = (...names) => ({ ...withPackage, ...(names.includes("signed") ? aggPart : {}),
  ...(names.includes("final") ? finPart : {}), ...(names.includes("sent") ? sentPart : {}) });
assert.equal(readSession("s1", upTo("signed"), everything).ss.status, "signed");
assert.equal(readSession("s1", upTo("signed", "final"), everything).ss.status, "complete");
r = readSession("s1", { ...upTo("signed"), status: "proving" }, everything);
assert.equal(r.ss.status, "proving", "the progress mark counts for a signed payment");
r = readSession("s1", { ...base, status: "proving" }, everything);
assert.equal(r.ss.status, "collecting", "and for nothing else");
const onlyProposal = allow("proposal");
for (const stored of ["proving", "complete"]) {   // a stored status counts for nothing here
  const shown = readSession("s1", { ...base, status: stored }, onlyProposal);
  assert.equal(shown.ss.status, "collecting");
}

// A holder of the link writes the results himself. Nothing of it counts without a signature.
const forgedTail = { signed: "x", final: { txid: "t" }, broadcastTxid: "t", broadcastAt: 1 };
r = readSession("s1", { ...base, ...forgedTail, status: "broadcast" }, allow("proposal"));
assert.deepEqual(r.bad, ["signed", "final", "sent"]);
assert.deepEqual([r.ss.status, r.ss.signed, r.ss.final, r.ss.broadcastTxid],
  ["collecting", undefined, undefined, undefined]);
asks.length = 0;
readSession("s1", { ...base, ...forgedTail }, allow("proposal"));
assert.deepEqual(asks.map((a) => a.name), ["proposal"], "a part with no valid base is not asked");
r = readSession("s1", { ...withPackage, ...forgedTail }, allow("proposal", "package"));
assert.deepEqual([r.ss.status, r.ss.package, r.ss.signed, r.ss.final, r.ss.broadcastTxid],
  ["signing", "PKG", undefined, undefined, undefined]);
// A signed mark with a made-up proof and a txid that is not the one of the proof stays out.
r = readSession("s1", { ...chain, broadcastTxid: "other" }, everything);
assert.deepEqual([r.bad, r.ss.status, r.ss.broadcastTxid], [["sent"], "complete", undefined]);
r = readSession("s1", { ...chain, final: undefined, finalBy: undefined, finalSig: undefined },
  everything);
assert.deepEqual([r.bad, r.ss.status], [["sent"], "signed"]);
r = readSession("s1", chain, (name) => name === "proposal" || name === "package" ? "yes" : "wait");
assert.deepEqual([r.ss.status, r.wait, r.bad], ["signing", 3, []], "a part waits for its base");

// Cancel: the signed fields are the status "cancelled" and the error text.
const cancelled = {
  ...base, error: "Cancelled by Ana.", cancelBy: 3, cancelSig: "c", status: "cancelled",
};
r = readSession("s1", cancelled, allow("proposal", "cancel"));
assert.deepEqual([r.ss.status, r.ss.error, r.bad], ["cancelled", "Cancelled by Ana.", []]);
assert.deepEqual(asks.at(-1),
  { name: "cancel", by: 3, sig: "c", fields: { error: "Cancelled by Ana.", status: "cancelled" } });
// A later write of another status does not undo it.
r = readSession("s1", { ...cancelled, status: "signing" }, allow("proposal", "cancel"));
assert.equal(r.ss.status, "cancelled");
r = readSession("s1", cancelled, allow("proposal"));
assert.deepEqual([r.ss.status, r.ss.error, r.bad], ["collecting", undefined, ["cancel"]]);
assert.equal("cancelBy" in r.ss, false);

// Failure: the signed field is the error text. A lone error text has no writer.
const failed = { ...base, error: "Bad share.", errorBy: 1, errorSig: "e", status: "failed" };
r = readSession("s1", failed, allow("proposal", "failure"));
assert.deepEqual([r.ss.status, r.ss.error, r.bad], ["failed", "Bad share.", []]);
assert.deepEqual(asks.at(-1),
  { name: "failure", by: 1, sig: "e", fields: { error: "Bad share." } });
r = readSession("s1", { ...base, error: "Fake.", status: "failed" }, allow("proposal"));
assert.deepEqual([r.ss.status, r.ss.error, r.bad], ["collecting", undefined, ["failure"]]);
r = readSession("s1", failed, allow("proposal"));
assert.deepEqual([r.ss.status, r.ss.error, r.bad], ["collecting", undefined, ["failure"]]);
// A cancel and a failure share the error text. A valid cancel keeps it, a false failure goes.
r = readSession("s1", { ...cancelled, errorBy: 1, errorSig: "e" }, allow("proposal", "cancel"));
assert.deepEqual([r.ss.status, r.ss.error, r.bad], ["cancelled", "Cancelled by Ana.", ["failure"]]);
assert.equal("errorBy" in r.ss, false);
// A part that waits is neither used nor counted as bad.
r = readSession("s1", failed, (name) => name === "proposal" ? "yes" : "wait");
assert.deepEqual([r.ss.status, r.ss.error, r.bad, r.wait], ["collecting", undefined, [], 1]);

// The unsigned fields stay, and the input document is not changed.
const input = { ...upTo("signed"), provingAt: 4, broadcastError: "x" };
const copy = JSON.stringify(input);
r = readSession("s1", input, everything);
assert.equal(r.ss.provingAt, 4);
assert.equal(r.ss.broadcastError, "x");
assert.equal(JSON.stringify(input), copy);
assert.deepEqual(partFields("proposal", { ...proposal, extra: 1 }), proposal);



// A whole wallet with real keys and the real engine text: the page keeps what the store holds
// (`raw`), and filterWallet gives the part it may use. The first pass shows how a check that is
// not finished makes a document wait. Then the results come in, and the second pass decides.
const seatKeys = { 1: await newSignKey(), 2: await newSignKey(), 3: await newSignKey() };
const attacker = await newSignKey();
const pins = Object.fromEntries(Object.entries(seatKeys).map(([i, k]) => [i, k.signPk]));
const N = 3, SID = "ab12cd34ef56ab12cd34";
const sign = async (rel, seat, fields, key = seatKeys[seat], names = ["by", "sig"]) => ({
  ...fields,
  [names[0]]: seat,
  [names[1]]: await signMsg(key.signSk, Z.docPayload(GID, rel, seat, JSON.stringify(fields))),
});
const emptyRaw = () => ({
  seats: {}, dkg1: {}, dkg2: {}, confirm: {}, abort: {}, done: {}, verify: {}, wallet: null,
  sessions: {}, commits: {}, shares: {},
});
let pinsNow = pins;   // the keys that the device pinned
const answers = new Map();
const verdictOf = (rel, by, sig, fields, need) => {
  const gate = writerCheck(by, need, N, pinsNow[by], true);
  if (gate !== "check") return gate;
  const text = Z.docPayload(GID, rel, by, JSON.stringify(fields));
  const id = JSON.stringify([by, sig, text]);
  return answers.has(id) ? (answers.get(id) ? "yes" : "no") : (answers.set(id, null), "wait");
};
const settleAnswers = async () => {
  for (const id of [...answers.keys()]) {
    const [by, sig, text] = JSON.parse(id);
    answers.set(id, await verifyMsg(pinsNow[by], sig, text));
  }
};
// A session asks about its other parts only after its proposal is known, so a pass can leave
// more to ask. The page filters again after each result, as this loop does.
const show = async (raw, sid = null) => {
  const bad = [];
  const first = filterWallet(raw, sid, verdictOf, (what) => bad.push(what));
  let done = first;
  for (let pass = 0; pass < 5 && done.wait; pass++) {
    await settleAnswers();
    bad.length = 0;
    done = filterWallet(raw, sid, verdictOf, (what) => bad.push(what));
  }
  return { first, done, bad };
};
const walletDoc = { network: "testnet", address: "utest1x", version: 2, birthday: 9, at: 1 };
const goodProposal = await sign("sessions/" + SID, 1, proposal);

const honest = emptyRaw();
const seatDoc = (i, name, key = seatKeys[i]) =>
  ({ uid: "u" + i, name, boxPk: "b" + i, signPk: key.signPk, at: i });
honest.seats[1] = await sign("seats/1", 1, seatDoc(1, "Ana"));
honest.seats[2] = await sign("seats/2", 2, seatDoc(2, "Bob"));
honest.confirm[1] = await sign("confirm/1", 1, { number: "1" });
honest.confirm[2] = await sign("confirm/2", 2, { number: "1" });
honest.dkg2["1-2"] = await sign("dkg2/1-2", 1, { sealed: "x", echo: "e", at: 3 });
honest.wallet = await sign("meta/wallet", 1, walletDoc);
honest.sessions[SID] = { ...goodProposal, createdBy: "x", status: "collecting" };
const commit2 = { commitments: { a: 1 }, at: 4 };
honest.commits[2] = await sign("sessions/" + SID + "/commits/2", 2, commit2);
let run = await show(honest, SID);
assert.equal(run.first.wait > 0, true, "nothing is used before the results are in");
const early = run.first;
assert.deepEqual([early.docs.confirm, early.docs.wallet, early.sessions], [{}, null, []]);
assert.deepEqual([run.done.bad, run.done.wait, run.bad], [0, 0, []]);
assert.deepEqual(run.done.docs.confirm, { 1: { number: "1" }, 2: { number: "1" } });
assert.deepEqual(run.done.docs.seats, { 1: seatDoc(1, "Ana"), 2: seatDoc(2, "Bob") });
assert.deepEqual(run.done.docs.wallet, walletDoc);
assert.deepEqual(run.done.docs.commits, { 2: { commitments: { a: 1 }, at: 4 } });
assert.deepEqual(run.done.docs.dkg2, { "1-2": { sealed: "x", echo: "e", at: 3 } });
assert.equal(run.done.sessions.length, 1);
assert.equal(run.done.sessions[0].by, 1);
assert.equal(run.done.docs.commits[2].by, undefined, "the writer is no field of the document");

// What a holder of the invite link without a seat can write: every try is ignored.
const attack = structuredClone(honest);
attack.commits[1] = { commitments: { a: 9 }, at: 5, by: 1, sig: "AAAA" };          // Ana "approved"
attack.confirm[3] = { number: "2" };                                                // no signature
attack.confirm[2] = await sign("confirm/2", 2, { number: "2" }, attacker);          // wrong key
attack.done[3] = await sign("done/3", 3, { groupKey: "g", at: 1 }, seatKeys[3]);
attack.done[2] = { ...attack.done[3] };                                    // moved to seat 2
attack.commits[3] = await sign("sessions/" + SID + "/commits/3", 2, { at: 6 });     // seat 2 for 3
attack.verify[1] = { ...honest.confirm[1], number: "7" };                           // changed field
attack.abort[1] = await sign("abort/1", 5, { reason: "x" }, attacker);              // not a seat
attack.shares[2] = await sign("sessions/" + SID + "/commits/2", 2, { shares: "s", at: 7 });
attack.wallet = await sign("meta/wallet", 2, walletDoc);                            // not seat 1
attack.seats[2] = { ...honest.seats[2], name: "Ana" };                              // relabelled
attack.seats[3] = await sign("seats/3", 3, seatDoc(3, "Cy"), attacker);              // wrong key
run = await show(attack, SID);
assert.deepEqual(run.done.docs.seats, { 1: seatDoc(1, "Ana") }, "a relabelled seat is ignored");
assert.deepEqual(run.done.docs.confirm, { 1: { number: "1" } });
assert.deepEqual(Object.keys(run.done.docs.done), ["3"]);
assert.deepEqual(run.done.docs.commits, { 2: commit2 });
for (const k of ["verify", "abort", "shares"]) assert.deepEqual(run.done.docs[k], {}, k);
assert.equal(run.done.docs.wallet, null);
assert.equal(run.done.bad, 11);
assert.equal(run.bad.length, 11);
assert.equal(run.done.sessions.length, 1, "the real proposal stays");
// A seat of another session, or of the wallet root, never fills another place.
const stray = { ...emptyRaw(), commits: honest.commits };
const noSession = filterWallet(stray, null, verdictOf, () => {});
assert.deepEqual(noSession.docs.commits, {});

// Sessions: a false proposal drops the session. A false part leaves the rest.
const forged = emptyRaw();
forged.sessions.s1 = { ...proposal, createdBy: "ana", status: "collecting", by: 1, sig: "AAAA" };
forged.sessions.s2 = { ...(await sign("sessions/s2", 2, proposal)), amount: 6 };   // changed amount
forged.sessions.s3 = { ...(await sign("sessions/s3", 2, proposal)),   // a false cancel
  error: "Cancelled by Ana.", cancelBy: 1, cancelSig: "AAAA", status: "cancelled" };
forged.sessions.s4 = { ...(await sign("sessions/s4", 2, proposal)),   // an unsigned package
  package: "P", signers: [1, 2], status: "signing" };
forged.sessions.s5 = { ...(await sign("sessions/s5", 3, proposal)),   // an unsigned failure
  error: "Out of money.", status: "failed" };
const okCancel = await sign("sessions/s6", 1, { status: "cancelled", error: "Stop." }, seatKeys[1],
  ["cancelBy", "cancelSig"]);
const s6 = await sign("sessions/s6", 2, proposal);
forged.sessions.s6 = { ...s6, ...okCancel, status: "cancelled" };
run = await show(forged);
assert.deepEqual(run.done.sessions.map((x) => x.id).sort(), ["s3", "s4", "s5", "s6"]);
const byId = Object.fromEntries(run.done.sessions.map((x) => [x.id, x]));
assert.equal(byId.s3.status, "collecting");
assert.equal(byId.s3.error, undefined);
assert.equal(byId.s4.status, "collecting");
assert.equal(byId.s4.package, undefined);
assert.equal(byId.s5.status, "collecting");
assert.equal(byId.s6.status, "cancelled");
assert.equal(byId.s6.error, "Stop.");
assert.equal(run.done.bad, 5);   // s1, s2, and the false cancel, package and failure

// A session in another wallet or with another id never verifies here.
const moved = emptyRaw();
moved.sessions.other = { ...goodProposal };
assert.deepEqual((await show(moved)).done.sessions, []);

// A holder of the link raises n and adds a fake seat 4 with a key of its own. The device keeps the
// first n and t, so seat 4 is no seat, with a pinned key or without one.
const shapePins = {};
const first = trustShape(shapePins, GID, { n: 3, t: 2, name: "W" });
assert.deepEqual([first.fresh, first.g.n, first.g.t, first.g.shapeMoved], [true, 3, 2, false]);
const raised = trustShape(shapePins, GID, { n: 7, t: 2, name: "W" });
assert.deepEqual([raised.fresh, raised.g.n, raised.g.t, raised.g.shapeMoved], [false, 3, 2, true]);
const junk = trustShape(shapePins, GID, { n: 65540, t: 1 });
assert.deepEqual([junk.g.n, junk.g.t, junk.g.unreadable, junk.g.shapeMoved], [3, 2, false, true]);
const blank = {};
const unseen = trustShape(blank, GID, { n: 65540, t: 2 });
assert.deepEqual([unseen.fresh, blank, unseen.g.n], [false, {}, 65540], "junk is not pinned");
assert.equal(validShape(2, 2) && validShape(7, 7) && validShape(7, 2), true);
for (const [n, t] of [[1, 1], [8, 2], [3, 4], [3, 1], [3.5, 2], ["3", 2], [65540, 2]]) {
  assert.equal(validShape(n, t), false, `${n}/${t}`);
}

const fake = emptyRaw();
const sidFake = "ff12cd34ef56ab12cd34", fakeKey = attacker;
const fakeSeat = (i) => sign("seats/" + i, i, seatDoc(i, "Ana", fakeKey), fakeKey);
fake.seats[4] = await fakeSeat(4);
fake.seats["65537"] = await fakeSeat(65537);
fake.sessions[sidFake] = {
  ...(await sign("sessions/" + sidFake, 4, proposal, fakeKey)), createdBy: "x",
  status: "collecting",
};
fake.sessions[SID] = {
  ...honest.sessions[SID],
  ...(await sign("sessions/" + SID, 4, { status: "cancelled", error: "Stop." }, fakeKey,
    ["cancelBy", "cancelSig"])),
  ...(await sign("sessions/" + SID, 4, { error: "Fail." }, fakeKey, ["errorBy", "errorSig"])),
  ...(await sign("sessions/" + SID, 4, { package: "P", signers: [4] }, fakeKey,
    ["packageBy", "packageSig"])),
};
fake.commits[4] = await sign("sessions/" + SID + "/commits/4", 4, commit2, fakeKey);
fake.commits[2] = honest.commits[2];
fake.shares[4] = await sign("sessions/" + SID + "/shares/4", 4, { shares: "s", at: 1 }, fakeKey);
for (const pinsFor of [pins, { ...pins, 4: fakeKey.signPk, 65537: fakeKey.signPk }]) {
  pinsNow = pinsFor;
  run = await show(fake, SID);
  assert.deepEqual(Object.keys(run.done.docs.seats), [], "no seat 4");
  assert.deepEqual(run.done.docs.commits, { 2: commit2 }, "no approval of seat 4, seat 2 stays");
  assert.deepEqual(run.done.docs.shares, {});
  assert.deepEqual(run.done.sessions.map((x) => x.id), [SID], "no proposal of seat 4");
  const kept = run.done.sessions[0];
  assert.equal(kept.status, "collecting");
  assert.deepEqual([kept.error, kept.package, kept.signers], [undefined, undefined, undefined]);
}
pinsNow = pins;

// A session whose results were all written by a holder of the link, with no signed part.
const claimed = emptyRaw();
claimed.sessions[SID] = {
  ...honest.sessions[SID], signed: "x", signatures: [], final: { txid: "t" }, broadcastTxid: "t",
  broadcastAt: 1, status: "broadcast",
};
run = await show(claimed);
assert.equal(run.done.sessions[0].status, "collecting");
assert.deepEqual(run.done.sessions[0].final, undefined);
assert.equal(run.done.bad, 3, "the three false parts");

// Every writer of a session part goes through signPart, with the real engine and Ed25519. What
// it writes is what the reader accepts, in a chain from the proposal to the sent mark.
const SID2 = "cd12cd34ef56ab12cd34", rel2 = "sessions/" + SID2;
const signAs = (seat, key = seatKeys[seat]) => async (fields) =>
  signMsg(key.signSk, Z.docPayload(GID, rel2, seat, JSON.stringify(fields)));
const spend = { pool: "ironwood", amount: 5, change: 1, fee: 10000, note_value: 20, pczt: "AAA" };
const payee = [{ to: "utest1x", amount: 5 }];
const made = proposalFields(payee, "", spend, null, 1760000000000);
assert.deepEqual(Object.keys(made).sort(), [...PARTS.proposal.fields].sort(),
  "every field is signed");
assert.equal(made.note, null);
const writes = [
  ["proposal", made, 1], ["package", { package: "PKG", signers: [1, 2] }, 2],
  ["signed", { signed: "S", signatures: [{ action: 0, rk: "r" }] }, 3],
  ["final", { final: { txid: "t", tx_hex: "00", size: 1, ms: 5 } }, 1],
  ["sent", { broadcastTxid: "t", broadcastAt: 7 }, 2],
];
let doc2 = { createdBy: "x", status: "broadcast", provingAt: 3, broadcastError: null };
for (const [name, fields, seat] of writes) {
  Object.assign(doc2, fields, await signPart(name, fields, seat, signAs(seat)));
}
const readAll = async (d, pinMap = pins) => {
  const memo = new Map();
  for (let pass = 0; pass < 8; pass++) {
    let more = false;
    const res = readSession(SID2, d, (name, by, sig, fields) => {
      const gate = writerCheck(by, null, N, pinMap[by], true);
      if (gate !== "check") return gate;
      const text = Z.docPayload(GID, rel2, by, JSON.stringify(fields));
      const id = JSON.stringify([by, sig, text]);
      if (!memo.has(id)) { memo.set(id, null); more = true; }
      return memo.get(id) === null ? "wait" : memo.get(id) ? "yes" : "no";
    });
    if (!res.wait && !more) return res;
    for (const id of [...memo.keys()]) {
      const [by, sig, text] = JSON.parse(id);
      memo.set(id, await verifyMsg(pinMap[by], sig, text));
    }
  }
  throw new Error("the reader did not settle");
};
r = await readAll(doc2);
assert.deepEqual([r.ss.status, r.bad, r.wait], ["broadcast", [], 0]);
assert.deepEqual([r.ss.by, r.ss.packageBy, r.ss.signedBy, r.ss.finalBy, r.ss.sentBy],
  [1, 2, 3, 1, 2]);
const cancelFields = { error: "Cancelled by Ana (seat 1)." };
const cancelDoc = { ...doc2, ...cancelFields, status: "cancelled",
  ...(await signPart("cancel", cancelFields, 1, signAs(1))) };
r = await readAll(cancelDoc);
assert.deepEqual([r.ss.status, r.ss.error, r.bad], ["cancelled", cancelFields.error, []]);
const failDoc = { ...made, status: "failed", error: "Bad share.",
  ...(await signPart("failure", { error: "Bad share." }, 3, signAs(3))) };
const failed2 = await readAll({ ...made, ...(await signPart("proposal", made, 1, signAs(1))),
  status: "failed", error: "Bad share.",
  ...(await signPart("failure", { error: "Bad share." }, 3, signAs(3))) });
assert.deepEqual([failed2.ss.status, failed2.ss.error, failed2.bad], ["failed", "Bad share.", []]);
assert.equal(Object.keys(failDoc).includes("errorBy"), true);
// One changed byte in a signed field, or a signature of another seat, drops that part and the
// parts that build on it.
r = await readAll({ ...doc2, signers: [1, 3] });
assert.deepEqual([r.ss.status, r.bad], ["collecting", ["package", "signed", "final", "sent"]]);
r = await readAll({ ...doc2, final: { ...doc2.final, txid: "u" }, broadcastTxid: "u" });
assert.deepEqual([r.ss.status, r.bad], ["signed", ["final", "sent"]]);
r = await readAll({ ...doc2, sentBy: 3 });
assert.deepEqual([r.ss.status, r.bad], ["complete", ["sent"]]);
// A field that the part does not list stays unsigned, so the writer refuses it.
await assert.rejects(() => signPart("proposal", { ...made, extra: 1 }, 1, signAs(1)), /extra/);
await assert.rejects(() => signPart("cancel", { error: "x", status: "cancelled" }, 1, signAs(1)));

// The memo answers only for the same text and key. A text of the same length is a new check, and
// a flood of large documents makes it start over.
const memo = makeMemo(3, 100);
const started = [];
const ask = (key, fields, pk = "k", ok = true) =>
  memo.ask(key, fields, pk, (e) => { started.push(fields); e.ok = ok; });
assert.equal(ask("a", "x".repeat(10)), true);
assert.equal(ask("a", "x".repeat(10), "k", false), true, "the same input is not checked again");
assert.equal(ask("a", "y".repeat(10), "k", false), false, "the same length, other text");
assert.equal(ask("a", "y".repeat(10), "other", true), true, "another key");
assert.equal(started.length, 3);
assert.equal(memo.size, 1);
assert.equal(memo.chars, 10);
for (const k of ["b", "c", "d"]) ask(k, "z".repeat(40));
assert.equal(memo.size <= 3 && memo.chars <= 100, true, "the memo stays bounded");
const pending = makeMemo();
assert.equal(pending.ask("p", "t", "k", () => {}), null, "a check that runs gives null");
// A check that still runs is never dropped, so no document is checked twice at once.
const keep = makeMemo(2, 100);
keep.ask("a", "x".repeat(10), "k", () => {});
keep.ask("b", "y".repeat(10), "k", (e) => { e.ok = true; });
keep.ask("c", "z".repeat(10), "k", (e) => { e.ok = true; });
assert.equal(keep.size, 2);
assert.equal(keep.ask("a", "x".repeat(10), "k", () => assert.fail("a is checked once")), null);
assert.equal(keep.ask("b", "y".repeat(10), "k", (e) => { e.ok = false; }), false, "b was dropped");

console.log("signed ok");
