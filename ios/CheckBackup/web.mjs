// Web side of ios/check-backup.sh. `make <dir>` seals a web-shaped backup, and makes a wallet with
// documents that the web code signed. `verify <dir>` opens the backup file that the Swift side
// made, with the same passphrase, and checks the documents that the Swift code signed.
import fs from "node:fs";
import assert from "node:assert/strict";
import {
  backupOpen, backupSeal, boxKeypair, docPayload, initSync,
} from "../../web/pkg/zec_frost_wasm.js";
import {
  dmText, keyState, newSignKey, parseDm, parseMsg, signMsg, signPairMatches, signedText, verifyMsg,
} from "../../web/chat.js";
import { allPaid, memoShown, pairPayees } from "../../web/payees.js";
import { filterWallet, PARTS, writerCheck } from "../../web/signed.js";
import { slowCall } from "../../web/util.js";

const wasm = new URL("../../web/pkg/zec_frost_wasm_bg.wasm", import.meta.url);
initSync({ module: fs.readFileSync(wasm) });
const Z = { backupSeal, backupOpen };
const [mode, dir] = process.argv.slice(2);
// Not ASCII, and typed with split letters (NFD): both apps must normalize it to the same bytes.
const pass = "correct horse é \u{1F600} battery";

// Signed writes (PROTOCOL.md section 15). Both sides use the engine text of docPayload.
const GID = "0123456789abcdef0123", SID = "ab12cd34ef56ab12cd34";
const sidOf = (last) => SID.slice(0, -1) + last;
const proposalOf = (note) => ({
  payees: [{ to: "utest1x", amount: 5 }], note, pool: "ironwood", amount: 5, change: 1, fee: 10000,
  noteValue: 20, pczt: "AAA", move: null, createdAt: 1760000000000,
});

// A wallet with honest documents of the seats 1 and 2, and false ones (an unsigned document, a
// signature of another seat, a document at the path of another seat, an unsigned cancel, a
// proposal with a made-up signature, made-up results of a payment, a seat document of a stranger).
async function webWallet() {
  const keys = { 1: await newSignKey(), 2: await newSignKey(), 3: await newSignKey() };
  const stranger = await newSignKey();
  const sign = async (rel, seat, fields, key = keys[seat], names = ["by", "sig"]) => ({
    ...fields,
    [names[0]]: seat,
    [names[1]]: await signMsg(key.signSk, docPayload(GID, rel, seat, JSON.stringify(fields))),
  });
  const seatDoc = (i, key) => ({ uid: "u" + i, name: i === 2 ? "Bob" : "S" + i, boxPk: "b" + i,
    signPk: key.signPk, at: i });
  const head = { createdBy: "x", status: "collecting" };
  const base = "sessions/" + SID;
  const chain = async () => ({
    ...(await sign(base, 2, { package: "PKG", signers: [1, 2] }, undefined,
      ["packageBy", "packageSig"])),
    ...(await sign(base, 3, { signed: "S", signatures: [{ action: 0, rk: "r" }] }, undefined,
      ["signedBy", "signedSig"])),
    ...(await sign(base, 1, { final: { txid: "T1", tx_hex: "00", size: 1, ms: 5 } }, undefined,
      ["finalBy", "finalSig"])),
    ...(await sign(base, 2, { broadcastTxid: "T1", broadcastAt: 7 }, undefined,
      ["sentBy", "sentSig"])),
  });
  const raw = {
    seats: {
      1: await sign("seats/1", 1, seatDoc(1, keys[1])),
      2: await sign("seats/2", 2, seatDoc(2, keys[2])),
      3: await sign("seats/3", 3, seatDoc(3, stranger), stranger),
    },
    confirm: {
      1: await sign("confirm/1", 1, { number: "1" }),
      2: await sign("confirm/2", 2, { number: "1" }),
      3: { number: "2" },
    },
    dkg2: { "1-2": await sign("dkg2/1-2", 1, { sealed: "x", echo: "e", at: 3 }) },
    verify: { 1: await sign("verify/1", 1, { ok: true, error: null, at: 2 }) },
    done: { 3: await sign("done/3", 3, { groupKey: "g", at: 1 }, keys[2]) },
    wallet: await sign("meta/wallet", 1,
      { network: "testnet", address: "utest1x", version: 2, birthday: 9, at: 1 }),
    sessions: {
      [SID]: {
        ...head, ...(await sign(base, 1, proposalOf("one"))), ...(await chain()),
        status: "broadcast",
      },
      [sidOf(5)]: {
        ...head, ...(await sign("sessions/" + sidOf(5), 2, proposalOf("two"))),
        error: "Cancelled by Ana.", cancelBy: 1, cancelSig: "AAAA", status: "cancelled",
      },
      [sidOf(6)]: { ...head, ...proposalOf("three"), by: 1, sig: "AAAA" },
      [sidOf(8)]: {
        ...head, ...(await sign("sessions/" + sidOf(8), 2, proposalOf("four"))),
        signed: "x", signatures: [], final: { txid: "t" }, broadcastTxid: "t", broadcastAt: 1,
        status: "broadcast",
      },
    },
    commits: {
      1: { commitments: { a: 9 }, at: 5, by: 1, sig: "AAAA" },
      2: await sign(base + "/commits/2", 2, { commitments: { a: 1 }, at: 4 }),
    },
    shares: {
      1: await sign(base + "/shares/1", 2, { shares: "SH", at: 5 }),
      2: await sign(base + "/shares/2", 2, { shares: "SH", at: 5 }),
    },
  };
  const pins = Object.fromEntries(Object.entries(keys).map(([i, k]) => [i, k.signPk]));
  return { gid: GID, n: 3, sid: SID, pins, raw };
}

// Messages (PROTOCOL.md section 14). Each side signs messages of a room and of a direct chat with
// its own code. The other side reads them with its own code: the same text, the same verdict.
// HARD holds every kind of character that JSON.stringify escapes or leaves alone.
const HARD = "quote \" backslash \\ slash / tab \t cr \r nl \n bell \u0007 bs \b ff \f "
  + "del \u007f ls \u2028 ps \u2029 emoji \u{1F600} cjk \u65e5\u672c\u8a9e e \u00e9 "
  + "low \u0001\u001f";
const CHAT = {
  gid: "0123456789abcdef0123", rid: "fedcba9876543210fedc", cid: "aabbccddeeff00112233",
  sid: "ab12cd34ef56ab12cd34", memA: "1111aaaa1111aaaa1111", memB: "2222bbbb2222bbbb2222",
  at: 1760000000000,
};

// What the page decides about a message: trust() and dmTrust() in web/app.js, without the cache.
async function chatVerdict(c) {
  const m = c.kind === "room" ? parseMsg(c.id, c.doc) : parseDm(c.id, c.doc);
  if (!m) return "drop";
  const pinned = c.pinnedPk ?? undefined;
  if (c.kind === "dm" && pinned === undefined) return "unknown";
  const text = c.kind === "room" ? signedText(c.ns, c.room, m) : dmText(c.ns, m);
  const gate = keyState(c.isMember, c.memberPk ?? undefined, pinned);
  if (gate !== "check") return gate;
  return (await verifyMsg(pinned, m.sig, text)) ? "yes" : "no";
}

// Cases signed by this side. `msg` is the message as the document shows it, `signed` the text that
// the signature covers, and `who` what the store and the pins say about the sender.
async function chatCases() {
  const k1 = await newSignKey(), k2 = await newSignKey(), other = await newSignKey();
  const { gid, rid, cid, sid, memA, memB, at } = CHAT;
  const roomMsg = { id: "c".repeat(20), seat: 2, thread: "wallet", at, text: HARD };
  const dmMsg = { id: "d".repeat(20), from: memA, at, text: HARD };
  const roomText = (m) => signedText(gid, rid, m);
  const same = (k) => ({ memberPk: k.signPk, pinnedPk: k.signPk });
  const moved = (k) => ({ memberPk: other.signPk, pinnedPk: k.signPk });
  const dmOfRoom = dmText(gid, { ...dmMsg, id: roomMsg.id });
  const roomOfDm = signedText(cid, cid, { ...roomMsg, id: dmMsg.id });
  const make = async (kind, name, expect, o) => {
    const m = o.msg ?? (kind === "room" ? roomMsg : dmMsg);
    const text = o.text ?? (kind === "room" ? roomText(m) : dmText(cid, m));
    const sig = await signMsg(o.signer.signSk, text);
    const doc = kind === "room" ? { seat: m.seat, thread: m.thread, text: m.text, at: m.at, sig }
      : { from: m.from, text: m.text, at: m.at, sig };
    return { name, kind, ns: kind === "room" ? gid : cid, room: rid, id: m.id, expect,
      doc: { ...doc, ...o.doc }, isMember: o.isMember ?? true, ...(o.who ?? same(o.signer)) };
  };
  const room = (name, expect, o) => make("room", name, expect, o);
  const dm = (name, expect, o) => make("dm", name, expect, o);
  const pay = { ...roomMsg, thread: "pay:" + sid };
  return [
    await room("room: honest", "yes", { signer: k2 }),
    await room("room: payment thread", "yes", { signer: k2, msg: pay }),
    await room("room: wrong key", "no", { signer: other, who: same(k2) }),
    await room("room: wrong seat", "no", { signer: k2, doc: { seat: 1 }, who: same(k1) }),
    await room("room: changed text", "no", { signer: k2, doc: { text: HARD + "!" } }),
    await room("room: changed thread", "no", { signer: k2, doc: { thread: "pay:" + sid } }),
    await room("room: changed time", "no", { signer: k2, doc: { at: at + 1 } }),
    await room("room: key changed", "changed", { signer: k2, who: moved(k2) }),
    await room("room: not a seat", "no", { signer: k2, isMember: false }),
    await room("room: no pinned key", "no", { signer: k2, who: { memberPk: k2.signPk } }),
    await room("room: direct signature", "no", { signer: k2, text: dmOfRoom }),
    await room("room: text too long", "drop", { signer: k2, doc: { text: "x".repeat(2001) } }),
    await room("room: bad thread", "drop", { signer: k2, doc: { thread: "other" } }),
    await room("room: time as text", "drop", { signer: k2, doc: { at: "now" } }),
    await dm("dm: honest", "yes", { signer: k1 }),
    await dm("dm: wrong key", "no", { signer: other, who: same(k1) }),
    await dm("dm: other member", "no", { signer: k1, doc: { from: memB }, who: same(k2) }),
    await dm("dm: changed text", "no", { signer: k1, doc: { text: HARD + "!" } }),
    await dm("dm: key changed", "changed", { signer: k1, who: moved(k1) }),
    await dm("dm: unknown sender", "unknown", { signer: k1, who: { memberPk: k1.signPk } }),
    await dm("dm: room signature", "no", { signer: k1, text: roomOfDm }),
    await dm("dm: bad member id", "drop", { signer: k1, doc: { from: memA.toUpperCase() } }),
    await dm("dm: text as number", "drop", { signer: k1, doc: { text: 5 } }),
  ];
}

// Checks every case against its expected verdict. Returns the names that differ.
async function chatMisses(cases) {
  const miss = [];
  for (const c of cases) if ((await chatVerdict(c)) !== c.expect) miss.push(c.name);
  return miss;
}

// The recipient check of web/payees.js on a list of cases. The Swift port must give the same
// verdicts: which payees are paid, and with which other memo, which outputs are left, and whether
// the whole payment matches. `memoShown` is checked on texts that hide or reorder other text.
function payeeCases() {
  const A = "utest1a", B = "utest1b";
  const line = (who, value, status = "empty", memo) => ({
    kind: "output", who, value, memo_status: status, ...(memo === undefined ? {} : { memo }),
  });
  const text = (who, value, memo) => line(who, value, "text", memo);
  const none = [undefined, null, ""].map(
    (memo) => [`no memo (${memo})`, [{ to: A, amount: 5, memo }]]);
  const cases = [
    ["a memo that matches", [{ to: "UTEST1A", amount: 5, memo: "rent" }, { to: B, amount: 7 }],
      [line(B, 7), text(A, 5, "rent")], 12],
    ...none.flatMap(([name, payees]) => [
      [name + ", empty memo", payees, [line(A, 5)], 5],
      [name + ", memo on chain", payees, [text(A, 5, "sneaky")], 5],
      [name + ", unreadable", payees, [line(A, 5, "unknown")], 5],
      [name + ", not text", payees, [line(A, 5, "not_text")], 5]]),
    ["a memo, empty on chain", [{ to: A, amount: 5, memo: "rent" }], [line(A, 5)], 5],
    ["a memo, unknown on chain", [{ to: A, amount: 5, memo: "rent" }], [line(A, 5, "unknown")], 5],
    ["a memo, not text on chain", [{ to: A, amount: 5, memo: "rent" }],
      [line(A, 5, "not_text")], 5],
    ["a text status without text", [{ to: A, amount: 5, memo: "rent" }], [line(A, 5, "text")], 5],
    ["a text status with a number", [{ to: A, amount: 5 }], [line(A, 5, "text", 7)], 5],
    ["no status", [{ to: A, amount: 5 }], [{ kind: "output", who: A, value: 5 }], 5],
    ["an empty text", [{ to: A, amount: 5 }], [text(A, 5, "")], 5],
    ["another case", [{ to: A, amount: 5, memo: "rent" }], [text(A, 5, "Rent")], 5],
    ["a trailing space", [{ to: A, amount: 5, memo: "rent" }], [text(A, 5, "rent ")], 5],
    ["a number as memo", [{ to: A, amount: 5, memo: 7 }], [text(A, 5, "7")], 5],
    ["an object as memo", [{ to: A, amount: 5, memo: {} }], [line(A, 5)], 5],
    ["a list as memo", [{ to: A, amount: 5, memo: ["x"] }], [text(A, 5, "x")], 5],
    ["true as memo", [{ to: A, amount: 5, memo: true }], [text(A, 5, "true")], 5],
    ["lines and emoji", [{ to: A, amount: 5, memo: "a\nb \u{1F600}" }],
      [text(A, 5, "a\nb \u{1F600}")], 5],
    ["a hiding character, equal", [{ to: A, amount: 5, memo: "x\u202ey" }],
      [text(A, 5, "x\u202ey")], 5],
    ["a hiding character, other", [{ to: A, amount: 5, memo: "x\u202ey" }],
      [text(A, 5, "x\ufffdy")], 5],
    ["same payee twice, other memos",
      [{ to: A, amount: 5, memo: "x" }, { to: A, amount: 5, memo: "y" }],
      [text(A, 5, "y"), text(A, 5, "x")], 10],
    ["same payee twice, one memo off",
      [{ to: A, amount: 5, memo: "x" }, { to: A, amount: 5, memo: "x" }],
      [text(A, 5, "x"), text(A, 5, "y")], 10],
    ["an output nobody proposed", [{ to: A, amount: 5 }], [line(A, 5), line(B, 1)], 5],
    ["a payee nothing pays", [{ to: A, amount: 5 }, { to: B, amount: 1 }], [line(A, 5)], 6],
    ["a total that differs", [{ to: A, amount: 5 }], [line(A, 5)], 6],
    ["another amount", [{ to: A, amount: 5 }], [line(A, 6)], 5],
    ["a fraction as amount", [{ to: A, amount: 5.5 }], [line(A, 5)], 5],
    ["text as amount", [{ to: A, amount: "5" }], [line(A, 5)], 5],
    ["a whole float as amount", [{ to: A, amount: 5.0 }], [line(A, 5)], 5],
    ["no payees", [], [], 0],
  ];
  const shown = ["plain", "a\nb", "a\tb", "x\u202ey", "\u0007bell", "\u2066iso\u2069",
    "caf\u00e9 \u{1F600}", "\u061c\u200e\u200f", "del\u007f\u0085\u009f", "\u000b\u001f end",
    "\ufffd stays"];
  return {
    cases: cases.map(([name, payees, outputs, total]) => {
      const { rows, extra } = pairPayees(payees, outputs, (a) => a.toLowerCase());
      const expect = {
        rows: rows.map((r) => ({ ok: r.ok, other: r.got !== undefined, got: r.got ?? null })),
        extra: extra.length, paid: allPaid(rows, extra, total),
      };
      return { name, payees, outputs, total, expect };
    }),
    shown: shown.map((t) => ({ text: t, shown: memoShown(t) })),
  };
}

// Reads the wallet that the Swift code made, as the web page does: a result comes after the check
// of the page asked for it, so the filter runs again until nothing waits.
async function readSwiftWallet(file) {
  const f = JSON.parse(fs.readFileSync(file, "utf8")), answers = new Map(), bad = [];
  const raw = {
    seats: {}, dkg1: {}, dkg2: {}, confirm: {}, abort: {}, done: {}, verify: {}, wallet: null,
    sessions: {}, commits: {}, shares: {}, ...f.raw,
  };
  const verdict = (rel, by, sig, fields, need) => {
    const gate = writerCheck(by, need, f.n, f.pins[by], true);
    if (gate !== "check") return gate;
    const text = docPayload(f.gid, rel, by, JSON.stringify(fields));
    const id = JSON.stringify([by, sig, text]);
    if (!answers.has(id)) answers.set(id, null);
    return answers.get(id) === null ? "wait" : answers.get(id) ? "yes" : "no";
  };
  let out;
  for (let pass = 0; pass < 6 && (!out || out.wait); pass++) {
    for (const id of [...answers.keys()]) {
      const [by, sig, text] = JSON.parse(id);
      answers.set(id, await verifyMsg(f.pins[by], sig, text));
    }
    bad.length = 0;
    out = filterWallet(raw, f.sid, verdict, (what) => bad.push(what));
  }
  return { f, out, bad };
}

if (mode === "make") {
  // Real key pairs: the Swift side must find that each secret key makes its public key.
  const box = JSON.parse(boxKeypair()), sign = await newSignKey();
  const id = "02" + "0".repeat(62);
  const plain = JSON.stringify({
    kind: "zec-frost-key-share", group: "0123456789abcdef0123", groupName: "Team treasury",
    seat: 2, threshold: 2, of: 3, key: "A".repeat(43),
    wallet: { address: "utest1x", birthday: 123 },
    secret: {
      keyPackage: { identifier: id, verifying_share: "abc" },
      publicKeyPackage: { verifying_key: "gk", verifying_shares: { [id]: "abc" } }, groupKey: "gk",
      vaultSk: "vsk", uid: "web-uid", boxSk: box.sk, boxPk: box.pk, ...sign, version: 2,
      room: { id: "fedcba9876543210fedc", key: "B".repeat(43) },
      checkedWallet: "wk", aborted: "x", nonces: { s1: "n" },
    },
  });
  fs.writeFileSync(`${dir}/pass.txt`, pass);
  fs.writeFileSync(`${dir}/signed-web.json`, JSON.stringify(await webWallet()));
  fs.writeFileSync(`${dir}/signed-parts.json`, JSON.stringify(PARTS));
  const cases = await chatCases();
  assert.deepEqual(await chatMisses(cases), [], "the web code agrees with its own cases");
  fs.writeFileSync(`${dir}/chat-web.json`,
    JSON.stringify({ hard: HARD, hardJson: JSON.stringify(HARD), cases }));
  fs.writeFileSync(`${dir}/payees-web.json`, JSON.stringify(payeeCases()));
  fs.writeFileSync(`${dir}/web-made.zigsbackup`, slowCall(Z, "backupSeal", [pass, plain]));
} else {
  const made = fs.readFileSync(`${dir}/swift-made.zigsbackup`, "utf8");
  const opened = JSON.parse(slowCall(Z, "backupOpen", [pass, made]));
  assert.equal(opened.kind, "zec-frost-key-share");
  assert.equal(opened.groupName, "From iPhone");
  assert.equal(opened.secret.checkedWallet, "wk");

  // A wallet that the Swift code signed: the page keeps what is signed by the right seat.
  const { f, out, bad } = await readSwiftWallet(`${dir}/signed-swift.json`);
  assert.equal(out.wait, 0);
  const sidf = (last) => f.sid.slice(0, -1) + last;
  assert.deepEqual(bad.sort(), ["confirm/3", `sessions/${sidf(7)} proposal`, "seats/3"].sort());
  const keysOf = (docs) => Object.keys(docs).sort();
  assert.deepEqual(keysOf(out.docs.seats), ["1", "2"]);
  assert.deepEqual(out.docs.seats[1], { uid: "u1", name: "S1", boxPk: "b1",
    signPk: f.pins[1], at: 1 });
  assert.deepEqual(keysOf(out.docs.confirm), ["1", "2"]);
  assert.deepEqual(keysOf(out.docs.abort), ["1"]);
  assert.deepEqual(out.docs.abort[1], { reason: 'Seat 1 stopped. \u00e9 "quoted" \\ done.' });
  assert.deepEqual(keysOf(out.docs.dkg1), ["2"]);
  assert.deepEqual(keysOf(out.docs.dkg2), ["3-1"]);
  assert.deepEqual(keysOf(out.docs.done), ["1"]);
  assert.deepEqual(out.docs.verify[2], { ok: true, error: null, at: 2 });
  assert.equal(out.docs.wallet.address, "utest1x");
  assert.equal(out.docs.wallet.by, undefined);
  assert.deepEqual(keysOf(out.docs.commits), ["3"]);
  assert.deepEqual(keysOf(out.docs.shares), ["2"]);
  const status = Object.fromEntries(out.sessions.map((ss) => [ss.id, ss.status]));
  assert.deepEqual(status, { [f.sid]: "broadcast", [sidf(5)]: "cancelled", [sidf(6)]: "failed" });
  assert.equal(out.sessions.find((ss) => ss.id === sidf(5)).error, "Cancelled by Cy (seat 3).");
  // The time of the cancel is not signed. The page keeps it for the event in the message log.
  assert.equal(out.sessions.find((ss) => ss.id === sidf(5)).cancelledAt, 1760000000500);
  const chained = out.sessions.find((ss) => ss.id === f.sid);
  assert.deepEqual([chained.package, chained.signed, chained.final.txid, chained.broadcastTxid],
    ["PKG", "S", "T1", "T1"]);
  // The secret key that the Swift code made is a key for WebCrypto, and makes its public key.
  assert.equal(await signPairMatches(f.key.signSk, f.key.signPk), true);
  console.log("web accepts the documents that Swift signed");

  // The messages that the Swift code signed.
  const chat = JSON.parse(fs.readFileSync(`${dir}/chat-swift.json`, "utf8"));
  assert.equal(chat.hardJson, JSON.stringify(HARD), "the Swift escapes equal JSON.stringify");
  assert.deepEqual(await chatMisses(chat.cases), [], "the web code agrees with the Swift cases");
  assert.equal(chat.cases.length, 23);
  console.log("web reads the messages that Swift signed");
}
