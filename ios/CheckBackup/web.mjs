// Web side of ios/check-backup.sh. `make <dir>` seals a web-shaped backup, and makes a wallet with
// documents that the web code signed. `verify <dir>` opens the backup file that the Swift side
// made, with the same passphrase, and checks the documents that the Swift code signed.
import fs from "node:fs";
import assert from "node:assert/strict";
import {
  backupOpen, backupSeal, boxKeypair, docPayload, initSync,
} from "../../web/pkg/zec_frost_wasm.js";
import { newSignKey, signMsg, signPairMatches, verifyMsg } from "../../web/chat.js";
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
  const chained = out.sessions.find((ss) => ss.id === f.sid);
  assert.deepEqual([chained.package, chained.signed, chained.final.txid, chained.broadcastTxid],
    ["PKG", "S", "T1", "T1"]);
  // The secret key that the Swift code made is a key for WebCrypto, and makes its public key.
  assert.equal(await signPairMatches(f.key.signSk, f.key.signPk), true);
  console.log("web accepts the documents that Swift signed");
}
