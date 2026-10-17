// Drives the Solana wasm (web/sol/wasm, built by wasm-sol/build.sh) the way the page will: a
// dealerless 2-of-3 DKG on three seats, the role keys, a message from the template, two seats
// that sign it in separate calls, the aggregate, and a check of the signature with Node's own
// Ed25519 (independent of the wasm). The PDA identity has the nullifier key that Node's own HKDF
// gives (ZOLANA.md 7.2, option D). Then the refusals: a bad commitment names its seat, a
// different echo ends the seat, a changed message gets no share, one share alone does not
// aggregate, and a key written twice is refused. Then the share check and the program label.
// Run: node web/test/sol-wasm.mjs   (Node 24)
import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, hkdfSync, randomBytes, verify } from "node:crypto";
import fs from "node:fs";
import * as S from "../sol/wasm/sol_wasm.js";

const web = new URL("../", import.meta.url);
S.initSync({ module: fs.readFileSync(new URL("sol/wasm/sol_wasm_bg.wasm", web)) });

const WALLET = "wallet-0001";
const CLUSTER = "devnet";
const SAFETY = "12345 67890 12345 67890 12345 67890";
const NOW = Math.floor(Date.now() / 1000);
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const fromHex = (text) => Uint8Array.from(Buffer.from(text, "hex"));
const json = (text) => JSON.parse(text);

function seatsOf(n, t) {
  return Array.from({ length: n }, (_, i) => {
    const id = i + 1;
    const [r, boxPk] = [hex(randomBytes(32)), hex(randomBytes(32))];
    const round1 = json(S.sol_dkg1(id, n, t));
    const commit = S.sol_commit(WALLET, id, boxPk, CLUSTER, r);
    return { id, r, boxPk, commit, secret1: round1.secret, package: round1.package };
  });
}

const docsOf = (seats) =>
  Object.fromEntries(seats.map((s) => [s.id, { package: s.package, commit: s.commit }]));
const othersOf = (seats, me) =>
  Object.fromEntries(seats.filter((s) => s.id !== me).map((s) => [s.id, s.package]));
const partsOf = (seats) => Object.fromEntries(seats.map((s) => [s.id, { r: s.r, boxPk: s.boxPk }]));

function round2(seats) {
  const inbox = new Map(seats.map((s) => [s.id, {}]));
  const secrets = new Map();
  for (const seat of seats) {
    const others = JSON.stringify(othersOf(seats, seat.id));
    const out = json(S.sol_dkg2(JSON.stringify(seat.secret1), others));
    secrets.set(seat.id, out.secret);
    for (const [to, pkg] of Object.entries(out.outgoing)) inbox.get(Number(to))[seat.id] = pkg;
  }
  return { secrets, inbox };
}

// Round 3 of every seat. The wasm computes the echo from the round-1 documents and requires that
// the saved echo and the echo of every other seat equal it. `tweak` changes the context.
function finish(seats, mid, parts, tweak = () => ({})) {
  const docs = JSON.stringify(docsOf(seats));
  const echo = S.sol_echo(WALLET, SAFETY, CLUSTER, docs);
  return seats.map((s) => {
    const others = seats.filter((o) => o.id !== s.id);
    const peerEchoes = Object.fromEntries(others.map((o) => [o.id, echo]));
    const ctx = { walletId: WALLET, safety: SAFETY, cluster: CLUSTER, seat: s.id };
    const full = { ...ctx, echo, peerEchoes, parts, ...tweak(s.id, echo) };
    const secret = JSON.stringify(mid.secrets.get(s.id));
    const inbox = JSON.stringify(mid.inbox.get(s.id));
    return json(S.sol_dkg3(secret, docs, inbox, JSON.stringify(full)));
  });
}

const seats = seatsOf(3, 2);
const mid = round2(seats);
const done = finish(seats, mid, partsOf(seats));

// All seats hold one group key and one solSeed, and their own share.
assert.ok(
  done.every((d) => d.group_key === done[0].group_key),
  "one group key",
);
assert.ok(
  done.every((d) => d.sol_seed === done[0].sol_seed),
  "one solSeed",
);
assert.notEqual(JSON.stringify(done[0].key_package), JSON.stringify(done[1].key_package));
assert.equal(done[0].group_key.length, 64);

// The role keys, and the pins: the keys of the group and the fee key of the proposing seat.
const roles = json(S.sol_roles(done[0].sol_seed, done[0].group_key));
assert.equal(roles.pins, undefined, "the roles hold no pins: the payer is a pin of the proposal");
assert.equal(roles.address.length, 99 * 2);
// The fee key of a seat comes from its own key share, and Node's HKDF and Ed25519 give the same
// key (info: the label, the group key and the seat as 2 bytes, little endian).
const PKCS8 = fromHex("302e020100300506032b657004220420");
function nodeFee(kp) {
  const seat = Buffer.alloc(2);
  seat.writeUInt16LE(Buffer.from(kp.identifier, "hex").readUInt16LE(0));
  const label = Buffer.from("zigs-sol/fee-key/v1");
  const info = Buffer.concat([label, fromHex(kp.verifying_key), seat]);
  const share = fromHex(kp.signing_share);
  const secret = Buffer.from(hkdfSync("sha256", share, Buffer.alloc(0), info, 32));
  const der = Buffer.concat([PKCS8, secret]);
  const seed = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  const spki = createPublicKey(seed).export({ format: "der", type: "spki" });
  return { secret: hex(secret), public: hex(spki.subarray(-32)) };
}
const feeOfSeat = (n, change = {}) =>
  json(S.sol_fee_key(JSON.stringify({ ...done[n].key_package, ...change })));
const fees = [0, 1, 2].map((n) => feeOfSeat(n));
fees.forEach((made, n) => assert.deepEqual(made, nodeFee(done[n].key_package), "seat " + (n + 1)));
const fee = fees[0];
assert.equal(new Set(fees.map((f) => f.public)).size, 3, "a key for each seat");
assert.notEqual(fee.public, done[0].group_key, "the group key is no fee key");
assert.deepEqual(feeOfSeat(0), fee, "any later call gives the same key");
const shuffled = JSON.stringify(Object.fromEntries(Object.entries(done[0].key_package).reverse()));
assert.deepEqual(json(S.sol_fee_key(shuffled)), fee, "a copy with its fields in another order");
// The seat and the group key are in the info: a share that still fits its public share gives
// another key when only the identifier or the group key changes.
const seatTwo = { identifier: done[1].key_package.identifier };
assert.notEqual(feeOfSeat(0, seatTwo).public, fee.public, "the seat is in the info");
const groupOther = { verifying_key: done[0].key_package.verifying_share };
assert.notEqual(feeOfSeat(0, groupOther).public, fee.public, "the group key is in the info");
// A damaged share, a share of another seat and a text that is no key package give no key.
const flip = (text) => text.slice(0, 5) + (text[5] === "a" ? "b" : "a") + text.slice(6);
const damaged = { signing_share: flip(done[0].key_package.signing_share) };
assert.throws(() => feeOfSeat(0, damaged), /does not fit/);
assert.throws(() => feeOfSeat(0, { signing_share: done[1].key_package.signing_share }), /fit/);
for (const junk of ["", "{}", "zz"]) {
  assert.throws(() => S.sol_fee_key(junk), /key package/, junk);
}
// The PDA identity: its nullifier secret is HKDF-SHA256 over solSeed with the label and the PDA
// as info, 31 bytes, so it is a field element and only the seats can make it.
const pdaRoles = json(S.sol_pda_roles(done[0].sol_seed, done[0].group_key));
{
  const info = Buffer.concat([
    Buffer.from("zigs-sol/pda-nullifier-secret/v1"),
    fromHex(pdaRoles.pda),
  ]);
  const secret = hkdfSync("sha256", fromHex(done[0].sol_seed), Buffer.alloc(0), info, 31);
  assert.equal(pdaRoles.nullifier_secret, hex(Buffer.from(secret)), "Node's HKDF gives the key");
  assert.notEqual(pdaRoles.nullifier_pk, roles.nullifier_pk, "another key than the group key's");
  assert.notEqual(pdaRoles.address, roles.address, "and another address");
  assert.equal(pdaRoles.address.length, 99 * 2);
  const seat2 = json(S.sol_pda_roles(done[1].sol_seed, done[1].group_key));
  assert.deepEqual(seat2, pdaRoles, "every seat derives the same PDA identity");
}
const pinsOf = (payer) =>
  fromHex(
    done[0].group_key + roles.nullifier_pk + roles.viewing_pk + payer + pdaRoles.nullifier_pk,
  );
assert.equal(Buffer.from(roles.seal_key, "base64url").length, 32, "a 32 byte base64url secret");
assert.throws(() => S.sol_roles("zz", done[0].group_key), /solSeed/);

// The nonce account: tag 0 and a recent blockhash, the one intent that the group key signs alone
// in the beta. The message is compiled from the fixed template.
const blockhash = randomBytes(32);
const proposal = Uint8Array.from([0, ...blockhash]);
const pins = pinsOf(fee.public);
const message = S.compile_message(proposal, pins, new Uint8Array(0));
assert.equal(message[0], 0x81, "a v1 message");
// The snapshot of a device with no input: the two secrets, the fee, no input, no used salt.
const snapshot = Buffer.concat([
  fromHex(roles.nullifier_secret),
  fromHex(roles.viewing_sk),
  Buffer.alloc(8),
  Buffer.from([0]),
  Buffer.alloc(2),
]);
assert.equal(snapshot.length, 74);
const verdict = S.check_message(message, proposal, pins, snapshot, BigInt(NOW));
assert.ok(verdict.startsWith("accepted"), verdict);
assert.equal(S.rule_list().split("\n").length, 101);

// Seats 1 and 2 sign in separate calls. The page keeps the nonces under the digest.
const digest = S.sol_digest(CLUSTER, message);
assert.equal(digest.length, 64);
const keyOf = (seat) => done[seat - 1].key_package;
const nonceOf = (seat) => json(S.sol_nonces(JSON.stringify(keyOf(seat)), digest));
const nonces = new Map([1, 2].map((s) => [s, nonceOf(s)]));
const commitments = Object.fromEntries([...nonces].map(([s, n]) => [s, n.commitments]));

function shareOf(seat, bytes, saved) {
  const round = { now: NOW, cluster: CLUSTER, keyPackage: keyOf(seat), nonces: saved, commitments };
  return json(S.sol_sign_share(bytes, proposal, pins, snapshot, JSON.stringify(round)));
}

const signed = (seat) => shareOf(seat, message, nonces.get(seat).nonces).share;
const shares = Object.fromEntries([1, 2].map((s) => [s, signed(s)]));
const signature = S.sol_aggregate(
  message,
  JSON.stringify(done[0].public_key_package),
  JSON.stringify(commitments),
  JSON.stringify(shares),
);
assert.equal(signature.length, 128);

// Node's Ed25519 checks the signature under the group key. It does not use the wasm.
const spkiHead = Buffer.from("302a300506032b6570032100", "hex");
const spki = Buffer.concat([spkiHead, fromHex(done[0].group_key)]);
const key = createPublicKey({ key: spki, format: "der", type: "spki" });
assert.ok(verify(null, message, key, fromHex(signature)), "Node verifies the signature");
const other = Buffer.from(message);
other[40] ^= 1;
assert.ok(!verify(null, other, key, fromHex(signature)), "another message does not verify");

// Refusals.
assert.throws(() => shareOf(1, other, nonces.get(1).nonces), /refused|another message/);
const prefixed = Uint8Array.from([0xff, ...Buffer.from("solana offchain"), 0]);
assert.throws(() => shareOf(1, prefixed, nonces.get(1).nonces), /offchain-prefix/);
assert.throws(
  () =>
    S.sol_aggregate(
      message,
      JSON.stringify(done[0].public_key_package),
      JSON.stringify(commitments),
      JSON.stringify({ 1: shares[1] }),
    ),
  /aggregate|signers|commitments/i,
);
assert.throws(() => S.sol_digest("mainnet", message), /devnet/);
assert.throws(() => S.compile_message(proposal, pins, Uint8Array.from([16, 1, 2])), /transact/);
assert.throws(
  () => S.compile_message(proposal, pinsOf(done[0].group_key), new Uint8Array(0)),
  /fee payer is the group key/,
);

// The fee key of the proposing seat signs the message once the checker accepted it, and Node's
// own Ed25519 verifies the signature. The wasm refuses a key that is not the payer, a message with
// another payer and a payer that is the group key.
{
  const roundOf = (secret) => JSON.stringify({ now: NOW, secret });
  const sign = (bytes, key = pins, secret = fee.secret) =>
    S.sol_fee_sign(bytes, proposal, key, snapshot, roundOf(secret));
  const feeSig = sign(message);
  const feeKey = createPublicKey({
    key: Buffer.concat([spkiHead, fromHex(fee.public)]),
    format: "der",
    type: "spki",
  });
  assert.ok(verify(null, message, feeKey, fromHex(feeSig)), "Node verifies the fee signature");
  assert.ok(S.sol_fee_verify(fee.public, message, feeSig));
  assert.ok(!S.sol_fee_verify(fee.public, other, feeSig), "another message");
  assert.ok(!S.sol_fee_verify(fees[1].public, message, feeSig), "another key");
  assert.ok(!S.sol_fee_verify("zz", message, feeSig), "bad text is false and no throw");
  const stranger = fees[1];
  assert.throws(() => sign(message, pins, stranger.secret), /not the payer/);
  assert.throws(() => sign(message, pinsOf(stranger.public)), /fee-payer-not-payer/);
  assert.throws(() => sign(other), /refused/);
  assert.throws(() => sign(message, pinsOf(done[0].group_key)), /payer-is-group/);
}

// A part that does not match its commitment names its seat.
const parts = partsOf(seats);
parts[2].r = hex(randomBytes(32));
assert.throws(() => finish(seats, mid, parts), /seat 2/);
assert.throws(() => S.sol_dkg1(1, 8, 2), /n must be/);
assert.throws(() => S.sol_dkg1(1, 3, 1), /t must be/);

// A different echo ends the seat, in the wasm: the saved echo, the echo of a peer, and documents
// that changed after the echo was saved. The peer is named.
const wrongEcho = hex(randomBytes(32));
assert.throws(
  () => finish(seats, mid, partsOf(seats), () => ({ echo: wrongEcho })),
  /different setup data/,
);
const peers = (me, echo) =>
  Object.fromEntries(
    seats.filter((o) => o.id !== me).map((o) => [o.id, o.id === 3 ? wrongEcho : echo]),
  );
assert.throws(
  () => finish(seats, mid, partsOf(seats), (me, echo) => ({ peerEchoes: peers(me, echo) })),
  /seat 3.*differs/,
);
assert.throws(
  () => finish(seats, mid, partsOf(seats), () => ({ safety: "00000 00000" })),
  /different setup data/,
);
assert.throws(
  () => finish(seats, mid, partsOf(seats), () => ({ seat: 4 })),
  /not a seat of round 1/,
);
assert.equal(finish(seats, mid, partsOf(seats)).length, 3, "the control");

// A key written twice is refused at every depth: a seat key of the documents, a field of one
// document, a seat key of the round-3 parts. The honest entry comes last, so a reader that keeps
// the later key would not notice.
{
  const docs = JSON.stringify(docsOf(seats));
  assert.ok(S.sol_echo(WALLET, SAFETY, CLUSTER, docs).length === 64, "the control");
  const twice = (text, opening, extra) => text.replace(opening, opening + extra + ",");
  assert.throws(() => S.sol_echo(WALLET, SAFETY, CLUSTER, twice(docs, "{", '"1":{}')), /twice/);
  const inDoc = twice(docs, '"1":{', '"commit":"00"');
  assert.throws(() => S.sol_echo(WALLET, SAFETY, CLUSTER, inDoc), /twice/);
  const pkg = JSON.stringify(done[0].public_key_package);
  const [commits, shared] = [JSON.stringify(commitments), JSON.stringify(shares)];
  assert.equal(S.sol_aggregate(message, pkg, commits, shared).length, 128, "the control");
  const bad = twice(commits, "{", '"1":"00"');
  assert.throws(() => S.sol_aggregate(message, pkg, bad, shared), /twice/);
}

// The check that a key share makes its public share (the restore uses it). The wasm made these
// packages and Node verified a signature under their group key. The known points are the base
// point and its negative: one and L minus one as scalars.
{
  const L = 2n ** 252n + 27742317777372353535851937790883648493n;
  const littleEndian = (n) => n.toString(16).padStart(64, "0").match(/../g).reverse().join("");
  const kp = done[0].key_package;
  const fits = (pkg) => S.sol_share_fits(JSON.stringify(pkg));
  const withShare = (signing_share, verifying_share = kp.verifying_share) => ({
    ...kp,
    signing_share,
    verifying_share,
  });
  const base = "58" + "66".repeat(31);
  assert.ok(fits(withShare(littleEndian(1n), base)), "one times the base point");
  for (const d of done) assert.ok(fits(d.key_package), "an honest share fits");
  // L minus one is minus the base point: the same y, and the sign bit of x set (the last byte).
  const minusBase = "58" + "66".repeat(30) + "e6";
  assert.ok(fits(withShare(littleEndian(L - 1n), minusBase)), "minus the base point");
  // The wasm makes the shares: many honest ones fit, whatever the sign of their x.
  for (let run = 0; run < 12; run++) {
    const more = seatsOf(3, 2);
    for (const d of finish(more, round2(more), partsOf(more))) {
      assert.ok(fits(d.key_package), "an honest share of DKG " + run + " fits");
    }
  }
  const flip = (text, at) =>
    text.slice(0, at) + (text[at] === "a" ? "b" : "a") + text.slice(at + 1);
  const other = done[1].key_package;
  const wrong = [
    withShare(flip(kp.signing_share, 0)),
    withShare(flip(kp.signing_share, 63)),
    withShare(kp.signing_share, other.verifying_share),
    withShare(kp.signing_share, flip(kp.verifying_share, 10)),
    withShare(other.signing_share),
    // L plus one is the same point as one, but no key package holds it.
    withShare(littleEndian(L + 1n), base),
    withShare("ff".repeat(32), base),
    // Zero is no share, whatever its public share is (the identity is no public share).
    withShare("0".repeat(64)),
    withShare("0".repeat(64), "01" + "00".repeat(31)),
    withShare("zz".repeat(32)),
    withShare(undefined),
    withShare([kp.signing_share]),
  ];
  for (const [i, bad] of wrong.entries()) assert.equal(fits(bad), false, "case " + i);
  for (const text of ["", "{}", "null", "not json"]) {
    assert.equal(S.sol_share_fits(text), false, "text " + text);
  }
}

// The program label is a constant of the wasm: the cluster, the pool and the registry. The Rust
// test ties it to the address bytes that the checker pins.
assert.equal(
  S.sol_program_label(),
  "zolana-devnet:sppU489D7A4U1exNo1oeMGZtLEofq3a6o2fR7UeoWB6:" +
    "regyS5rkAcw2YzDJCmTwCTHs2s246FXxbmuRZ42u2PD",
);

console.log("sol-wasm: ok");
