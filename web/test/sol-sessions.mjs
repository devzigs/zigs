// The Solana signing sessions against the real web/app.js (see sol-rig.mjs): one browser holds
// the three seats of a 2-of-3 wallet, the real wasm checks and signs, and a fake Worker answers
// from a model of Devnet (sol-chain.mjs). It runs the intents that move no private funds (create
// the nonce account, register, and a second register: the fake chain keeps no registry) to a
// landed transaction that two keys sign, the fee key of the proposing seat first and the group
// key second, and that Node's own Ed25519 verifies under both keys. It pins the rules around
// them: every approver refuses a bad message and writes nothing, a nonce signs once (save before
// the commit, delete before the share, a crash keeps or republishes, never reuses), a share under
// another seat is ignored, and a signed abort document of any seat stops every seat and survives a
// restore.
// Run: node web/test/sol-sessions.mjs   (Node 24)
import assert from "node:assert/strict";
import { approve, feeSignature, reviewOf } from "../sol/approve.js";
import { backupWords } from "../sol/backup.js";
import { agreement } from "../sol/ceremony.js";
import { base58 } from "../sol/docs.js";
import { feeOf } from "../sol/fee.js";
import {
  bytesOf,
  decodeIntent,
  describeMessage,
  hexOf,
  intentHex,
  lamportsOf,
  nonceAccountHex,
  pinsHex,
  wireBase64,
} from "../sol/intent.js";
import { clearPending, pendingShare, savedNonces, spendNonces, usedDigest } from "../sol/nonces.js";
import { propose } from "../sol/propose.js";
import { putSol, remoteStop, stopOf } from "../sol/secrets.js";
import { refreshChain } from "../sol/session.js";
import { writePart } from "../sol/sessions.js";
import { solView } from "../sol/view.js";
import { createPrivateKey, sign as nodeSign } from "node:crypto";
import { RPC, makeChain, verifies } from "./sol-chain.mjs";
import { loadRig, sleep } from "./sol-rig.mjs";

const rig = await loadRig();
const { t, Z, W, data, hook, notify, waitFor } = rig;
const path = (gid, rel) => `groups/${gid}/${rel}`;
const solOf = (gid, i) => t.sec(gid, i).sol ?? {};
const J = JSON.parse;
const PASS = "a long phrase for the solana test 7";
const step = (name) => console.log("ok  " + name);

// ── A wallet with a Solana part, and the fake chain behind the Worker ──
const gid = await rig.wallet({ name: "Pay" });
await t.solLoad();
await t.sol.add();
const ready = () => [1, 2, 3].every((i) => data.has(path(gid, "soldone/" + i)));
await waitFor("every soldone", ready, 30000);
const c = t.sol.ctl;
await waitFor("agreement", () => agreement(c).state === "agree");
const done = agreement(c).done;
const roles = J(W.sol_roles(solOf(gid, 1).solSeed, done.groupKey));
const chain = makeChain();
chain.group = {
  key: done.groupKey,
  owner: base58(done.groupKey),
  shielded: roles.address,
  nonceAccount: base58(await nonceAccountHex(done.groupKey)),
};
chain.balances.set(chain.group.owner, 50_000_000n);
await waitFor("every fee key published", () =>
  [1, 2, 3].every((i) => feeOf(c, i) && c.docs.solfee[i]?.key === feeOf(c, i).key),
);
const feeAddress = (i) => base58(feeOf(c, i).key);
for (const i of [1, 2, 3]) chain.balances.set(feeAddress(i), 50_000_000n);
chain.install();

// An attacker who holds the fee key of seat `seat` signs bytes that the wasm would not sign: the
// approvers must still refuse them (the wasm never signs them, so Node's Ed25519 does).
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const feeSign = (seat, message) => {
  const der = Buffer.concat([PKCS8, Buffer.from(feeOf(c, seat).secret, "hex")]);
  const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  return nodeSign(null, Buffer.from(message), key).toString("hex");
};

// Every nonce that is ever saved is noted here, to look for it in the Worker and the store.
const seenNonces = new Set();
const putSec = c.host.putSec;
c.host.putSec = (g, seat, patch) => {
  for (const entry of Object.values(patch.sol?.nonces ?? {})) seenNonces.add(entry.nonces);
  return putSec(g, seat, patch);
};

const ssOf = (id) => c.sessions.find((ss) => ss.id === id);
const waitSession = (id, status, ms = 30000) =>
  waitFor(`session ${status}`, () => ssOf(id)?.status === status, ms);
const proposed = async (kind, args) => {
  const id = await propose(c, kind, args);
  await waitFor("the proposal", () => ssOf(id));
  return id;
};
const secretsOfSeats = () => JSON.stringify([1, 2, 3].map((i) => solOf(gid, i)));
const storeText = () => JSON.stringify([...data.entries()]);
const landedOf = (id) => chain.landed.find((x) => x.signature === ssOf(id).txId);
const digestOf = (id) => W.sol_digest("devnet", bytesOf(ssOf(id).message));

// The tab, as a tree of plain nodes, to read what an approval screen shows.
const node = (tag, attrs = {}, ...kids) => ({
  tag,
  attrs,
  kids: kids.flat(Infinity).filter(Boolean),
});
const textOf = (n) => (typeof n === "object" ? n.kids.map(textOf).join(" ") : String(n));
const findAll = (n, pick) =>
  typeof n !== "object"
    ? []
    : [...(pick(n) ? [n] : []), ...n.kids.flatMap((kid) => findAll(kid, pick))];
const tabOf = () => solView({ ...c, host: { ...c.host, el: node } }, (fn) => fn, {});
const cardOf = (id) => findAll(tabOf(), (n) => n.attrs["data-session"] === id)[0];
const screenOf = (id) => findAll(cardOf(id), (n) => n.tag === "dl")[0];
const rowsOf = (id) => {
  const dl = screenOf(id),
    out = {};
  for (let i = 0; i < dl.kids.length; i += 2) out[textOf(dl.kids[i])] = textOf(dl.kids[i + 1]);
  return out;
};

// ── The intents, the amounts and the pins that the page writes ──
{
  const nonce = "ab".repeat(32);
  const wire = "02" + nonce + "002d310100000000";
  assert.equal(intentHex("shield", { blockhash: nonce, amount: 20_000_000n }), wire);
  assert.deepEqual(decodeIntent(wire), { kind: "shield", blockhash: nonce, amount: 20_000_000n });
  for (const bad of ["05" + nonce, "02" + nonce, "zz", "", 7]) {
    assert.equal(decodeIntent(bad), null, "no screen for " + bad);
  }
  assert.equal(lamportsOf("0.02"), 20_000_000n);
  assert.equal(lamportsOf("1"), 1_000_000_000n);
  for (const bad of ["0", "0.0", "-1", "1e3", "0.0000000001", "", "x"]) {
    assert.equal(lamportsOf(bad), null, bad);
  }
  assert.throws(() => pinsHex({ groupKey: "00" }, "11".repeat(32)), /not well formed/);
  assert.throws(() => pinsHex(done, "00"), /fee key of the payer/);
  assert.equal(pinsHex(done, "11".repeat(32)).length, 129 * 2, "the payer is the last pin");
}

step("a wallet with a Solana part");
// The nonce account that the page derives is the one that P2 created on Devnet for the group
// B1o5q9s... (public values, as in solspike/test/worker.test.mjs).
{
  const P5 = "B1o5q9sWLRVY2uk43bd1GLLPcNmhqJQ53CfKKxKzeShD";
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const ch of P5) n = n * 58n + BigInt(ALPHABET.indexOf(ch));
  const key = n.toString(16).padStart(64, "0");
  assert.equal(base58(key), P5);
  const derived = base58(await nonceAccountHex(key));
  assert.equal(derived, "4kf6Z6LTZC7E7PRvUAoADayFXQfDGppBx8m1AuUvUndE", "the P2 nonce account");
}

// ── The fund card reads the chain through the Worker ──
await refreshChain(c);
assert.deepEqual([c.chain.balance, c.chain.nonce], ["0.05 SOL", "missing"]);
assert.deepEqual(
  c.chain.fees,
  { 1: "0.05 SOL", 2: "0.05 SOL", 3: "0.05 SOL" },
  "the fee addresses",
);
step("the fund card reads the balances of the fee addresses");

// ── Create the nonce account: the screen, two approvals, a landed transaction ──
const created = await proposed("createNonce");
{
  const ss = ssOf(created);
  assert.equal(ss.status, "collecting");
  assert.equal(decodeIntent(ss.intent).kind, "createNonce");
  const message = bytesOf(ss.message);
  const account = Buffer.from(await nonceAccountHex(done.groupKey), "hex");
  assert.ok(Buffer.from(message).includes(account), "the message holds the derived nonce account");
  const rows = rowsOf(created);
  assert.deepEqual(Object.keys(rows), [
    "What it does",
    "Fees paid by seat 1",
    "Group address",
    "Rent kept by the nonce account",
    "Payee",
    "Change",
    "Network fee",
    "Lasts",
  ]);
  assert.equal(rows["Rent kept by the nonce account"], "0.00105664 SOL");
  assert.equal(rows["Network fee"], "0.00001 SOL", "two signatures");
  assert.equal(rows["Fees paid by seat 1"], feeAddress(1), "the fee address of the proposing seat");
  assert.notEqual(rows["Fees paid by seat 1"], rows["Group address"], "the group never pays");
  assert.equal(rows["Group address"], chain.group.owner);
  assert.match(rows.Lasts, /1 to 2 minutes/);
  assert.match(rows.Payee, /None/);
  assert.equal(describeMessage(message).computeUnits, 450n, "the compute limit of the template");
  assert.equal(describeMessage(message).signatures, 2, "the payer and the group key sign");
  assert.equal(hexOf(message.subarray(42, 74)), feeOf(c, 1).key, "the payer comes first");
  assert.equal(chain.commands.filter((m) => m.cmd === "preflight").length, 1, "one test run");
}
await approve(c, ssOf(created), 1);
await sleep(300);
assert.equal(ssOf(created).status, "collecting", "one approval is not enough");
assert.equal(ssOf(created).package, undefined);
await approve(c, ssOf(created), 2);
await waitSession(created, "sent");
{
  const ss = ssOf(created),
    land = landedOf(created);
  assert.equal(chain.landed.length, 1);
  assert.equal(land.message, ss.message, "the Worker sent the message that was approved");
  assert.deepEqual(land.sigs, [ss.feeSig, ss.signature], "the payer signs first");
  const bytes = bytesOf(land.message);
  assert.ok(verifies(done.groupKey, bytes, bytesOf(land.sig)), "Node verifies the group signature");
  assert.ok(verifies(feeOf(c, 1).key, bytes, bytesOf(land.sigs[0])), "and the payer signature");
  assert.equal(ss.txId, base58(ss.feeSig), "the id is the first signature, the payer's");
  assert.equal(ss.outcome, "confirmed");
  assert.deepEqual(ss.signers, [1, 2]);
  const sent = chain.commands.findLast((m) => m.cmd === "send");
  assert.equal(sent.args.tx, wireBase64(bytes, bytesOf(ss.feeSig + ss.signature)));
  assert.equal(Buffer.from(sent.args.tx, "base64").length, bytes.length + 128, "two signatures");
  assert.equal(findAll(cardOf(created), (n) => n.tag === "dl").length, 0, "no screen once sent");
  await refreshChain(c);
  assert.equal(c.chain.nonce, "created");
}

step("create nonce account landed");
// ── Nonces: saved before the commit, deleted before the share, never made twice ──
{
  for (const seat of [1, 2]) {
    assert.equal(
      savedNonces(c, seat, created),
      undefined,
      "seat " + seat + ": the nonces are gone",
    );
    assert.equal(usedDigest(c, seat, digestOf(created)), true, "seat " + seat + ": digest used");
    assert.equal(pendingShare(c, seat, created), undefined, "the share is published");
    assert.deepEqual(solOf(gid, seat).nonces ?? {}, {});
  }
  await assert.rejects(() => approve(c, ssOf(created), 1), /not collecting/);
  assert.equal(data.has(path(gid, `solsessions/${created}/commits/3`)), false);
}

step("nonces are gone after the share");
// ── Every approver refuses a bad message and writes nothing ──
const pinsFor = (seat) => bytesOf(pinsHex(done, feeOf(c, seat).key));
const compiled = (intent, seat = 1) =>
  W.compile_message(bytesOf(intent), pinsFor(seat), new Uint8Array(0));
const flip = (hex) => (hex[0] === "a" ? "b" : "a") + hex.slice(1);
let bad = 0;
// `by` proposes the bytes and signs the proposal. `feeSig`: its text, null for none, or by default
// the signature of the fee key of seat `by` on the bytes.
const tamper = async (label, { intent, message, by = 1, feeSig }, why) => {
  const id = "bad-" + bad++;
  const bytes = message ?? compiled(intent);
  const sig = feeSig === undefined ? feeSign(by, bytes) : feeSig;
  const fields = { intent, message: hexOf(bytes), createdAt: Date.now() };
  if (sig !== null) fields.feeSig = sig;
  await writePart(c, id, "proposal", fields, { seat: by, create: true });
  await waitFor(label, () => ssOf(id));
  const before = [storeText(), secretsOfSeats()];
  for (const seat of [1, 2, 3]) {
    const review = reviewOf(c, ssOf(id), seat);
    assert.equal(review.ok, false, `${label}: seat ${seat} accepted`);
    assert.match(review.why, why, label);
    await assert.rejects(() => approve(c, ssOf(id), seat), why, label);
  }
  assert.deepEqual([storeText(), secretsOfSeats()], before, label + ": nothing was written");
};
{
  const nonce = chain.nonce;
  const keys = { nonce, nullifierPk: done.nullifierPk, viewingPk: done.viewingPk };
  const register = intentHex("register", keys);
  const other = { ...keys, nullifierPk: flip(done.nullifierPk) };
  await tamper("wrong keys", { intent: intentHex("register", other) }, /register|nullifier|key/i);
  const dearer = compiled(intentHex("register", other));
  await tamper("other data", { intent: register, message: dearer }, /register|nullifier|data/i);
  const cancel = compiled("05" + nonce);
  await tamper("other instruction", { intent: register, message: cancel }, /instruction|list|ix/i);
  const good = compiled(register);
  const mask = Uint8Array.from(good);
  mask[4] |= 0x10;
  await tamper("heap bit", { intent: register, message: mask }, /config|mask|heap|end|short/i);
  const at = 42 + 32 * good[41];
  for (const [label, units] of [
    ["no compute", 1],
    ["too much", 0xffffffff],
  ]) {
    const wrong = Uint8Array.from(good);
    new DataView(wrong.buffer).setUint32(at, units, true);
    await tamper(label, { intent: register, message: wrong }, /compute|unit|limit/i);
  }
  const later = compiled(intentHex("register", { ...keys, nonce: flip(nonce) }));
  await tamper("other lifetime", { intent: register, message: later }, /lifetime|nonce/i);
  await tamper("not hex", { intent: "zz", message: good }, /not one that this app can show/);
  // The payer. Seat 1 proposes, so the payer is the fee key that seat 1 published. A message that
  // another fee key pays is refused by the checker when seat 1 signs it, and by the signature
  // check when only that other seat signs it.
  const paid2 = compiled(register, 2);
  await tamper(
    "a message that another seat pays, signed by the proposer",
    { intent: register, message: paid2, feeSig: feeSign(1, paid2) },
    /the first account \(the fee payer\)/,
  );
  await tamper(
    "a message that another seat pays and signs",
    { intent: register, message: paid2, feeSig: feeSign(2, paid2) },
    /fee signature/,
  );
  // The payer comes from the document of the proposing seat (the signer of the proposal part),
  // so seat 2 proposing a message that seat 1 pays and signs is refused.
  await tamper(
    "a message that seat 1 pays, proposed by seat 2",
    { intent: register, message: good, by: 2, feeSig: feeSign(1, good) },
    /fee signature/,
  );
  await tamper(
    "a message that seat 1 pays, proposed and signed by seat 2",
    { intent: register, message: good, by: 2, feeSig: feeSign(2, good) },
    /the first account \(the fee payer\)/,
  );
  await tamper(
    "a bad fee signature",
    { intent: register, message: good, feeSig: "00".repeat(64) },
    /fee signature/,
  );
  // A proposal with no fee signature reads as one from before the fee keys: it ends, unapproved.
  {
    const fields = { intent: register, message: hexOf(good), createdAt: Date.now() };
    await writePart(c, "no-fee-signature", "proposal", fields, { seat: 1, create: true });
    await waitSession("no-fee-signature", "failed");
    assert.match(ssOf("no-fee-signature").error, /from before the fee keys.*Propose it again/);
    for (const seat of [1, 2, 3]) {
      await assert.rejects(() => approve(c, ssOf("no-fee-signature"), seat), /not collecting/);
    }
  }
  await tamper(
    "the fee signature of another key",
    { intent: register, message: good, feeSig: feeSign(2, good) },
    /fee signature/,
  );
  await tamper(
    "a fee signature for other bytes",
    { intent: register, message: good, feeSig: feeSign(1, cancel) },
    /fee signature/,
  );
  // A proposing seat that published no fee address has no payer.
  const sheet = { id: "x", status: "collecting", by: 3, intent: register, message: hexOf(good) };
  const published = c.docs.solfee[3];
  delete c.docs.solfee[3];
  const why = reviewOf(c, { ...sheet, feeSig: feeSign(3, good) }, 1).why;
  c.docs.solfee[3] = published;
  assert.match(why, /Seat 3 has not published its fee address/);
}

step("every bad message is refused");
// ── Register: the screen, and a crash between the nonce save and the commit ──
const registered = await proposed("register");
{
  const rows = rowsOf(registered);
  assert.equal(rows["Rent kept by the record"], "0.00133096 SOL");
  assert.match(rows["Keys that become public"], /…/);
  assert.match(rows["What it does"], /permanent/);
}
await approve(c, ssOf(registered), 1);
{
  let armed = true;
  hook.before = (p, value) => {
    if (armed && p.endsWith(`${registered}/commits/2`)) {
      armed = false;
      throw new Error("crash before the commit");
    }
    return value;
  };
  await assert.rejects(() => approve(c, ssOf(registered), 2), /crash before the commit/);
  hook.before = (_p, value) => value;
  const kept = savedNonces(c, 2, registered);
  assert.ok(kept, "the nonces are kept");
  assert.equal(data.has(path(gid, `solsessions/${registered}/commits/2`)), false);
  await approve(c, ssOf(registered), 2);
  const commit = data.get(path(gid, `solsessions/${registered}/commits/2`));
  assert.equal(commit.commitments, kept.commitments, "the retry publishes the saved commitment");
}
await waitSession(registered, "sent");
{
  const ss = ssOf(registered),
    intent = decodeIntent(ss.intent);
  assert.deepEqual(ss.signers, [1, 2]);
  assert.equal(intent.nullifierPk, done.nullifierPk);
  assert.equal(intent.viewingPk, done.viewingPk);
  assert.ok(verifies(done.groupKey, bytesOf(landedOf(registered).message), bytesOf(ss.signature)));
  assert.equal(describeMessage(bytesOf(ss.message)).computeUnits, 24048n);
}

step("register landed after a crash and a retry");
// ── A second register (the fake chain keeps no registry): a crash between the share and its
// publish. The proposer is seat 1 again, so seat 1 pays again. ──
const again = await proposed("register");
{
  const rows = rowsOf(again);
  assert.equal(rows["Fees paid by seat 1"], feeAddress(1));
  assert.equal(rows["Network fee"], "0.00001 SOL");
  assert.match(rows.Lasts, /nonce account advances/);
  assert.equal(decodeIntent(ssOf(again).intent).kind, "register");
}
await approve(c, ssOf(again), 1);
// The first share write is held, so the state between "the share is made" and "it is published"
// can be looked at. Then the write fails, as in a crash, and the reactor publishes the share again.
let held = null;
let crash;
const stuck = new Promise((_ok, bad) => {
  crash = bad;
});
stuck.catch(() => {});
hook.before = async (p, value) => {
  const share = new RegExp(`${again}/shares/(\\d+)$`).exec(p);
  if (share && held === null) {
    held = Number(share[1]);
    await stuck;
  }
  return value;
};
await approve(c, ssOf(again), 3);
await waitFor("a made share that waits", () => held !== null && pendingShare(c, held, again));
{
  const seat = held,
    share = pendingShare(c, seat, again).share;
  assert.equal(savedNonces(c, seat, again), undefined, "the nonces went before the publish");
  assert.equal(usedDigest(c, seat, digestOf(again)), true);
  assert.equal(data.has(path(gid, `solsessions/${again}/shares/${seat}`)), false);
  crash(new Error("crash before the share"));
  await waitSession(again, "sent", 40000);
  assert.equal(data.get(path(gid, `solsessions/${again}/shares/${seat}`)).share, share);
  assert.equal(pendingShare(c, seat, again), undefined, "the pending share is cleared");
}
hook.before = (_p, value) => value;
assert.equal(chain.landed.length, 3);
const every = chain.landed.every((l) =>
  verifies(done.groupKey, bytesOf(l.message), bytesOf(l.sig)),
);
assert.ok(every, "every landed transaction verifies under the group key");

step("a second register landed after a lost share publish");
// ── A digest that made a share is used: no second approval of the same bytes ──
{
  const old = ssOf(again),
    seat = old.signers[0];
  // The proposer of the old bytes writes them again: its fee key is the payer of the message.
  const fields = { intent: old.intent, message: old.message, feeSig: old.feeSig };
  await writePart(
    c,
    "same-bytes",
    "proposal",
    { ...fields, createdAt: Date.now() },
    { seat: old.by, create: true },
  );
  await waitFor("the proposal", () => ssOf("same-bytes"));
  const kept = chain.nonce;
  chain.nonce = decodeIntent(old.intent).nonce; // as if the nonce had not moved
  // A landed session ends every other session on its nonce (sol-limits.mjs), so this one reads as
  // failed. Each check below shows it as collecting, as on a device that has not read the sent
  // part yet: the rule about used bytes holds on its own.
  const collecting = () =>
    Object.assign(ssOf("same-bytes"), { status: "collecting", error: undefined });
  assert.equal(reviewOf(c, ssOf("same-bytes"), seat).ok, true, "the checker accepts the bytes");
  await assert.rejects(() => approve(c, collecting(), seat), /signed these bytes before/);
  assert.equal(savedNonces(c, seat, "same-bytes"), undefined, "no nonces were made");
  assert.equal(data.has(path(gid, `solsessions/same-bytes/commits/${seat}`)), false);
  // The seats that signed these bytes get no screen and no button for them, only the reason.
  collecting();
  const card = cardOf("same-bytes");
  const mark = (name) => findAll(card, (n) => n.attrs["data-sol"] === name).length;
  for (const used of old.signers) {
    assert.equal(mark(`approve-same-bytes-${used}`), 0, `no button for seat ${used}`);
    assert.match(textOf(card), new RegExp(`Seat ${used} signed these bytes before`));
  }
  const open = [1, 2, 3].find((i) => !old.signers.includes(i));
  assert.equal(
    mark(`approve-same-bytes-${open}`),
    1,
    `seat ${open} signed nothing: it may approve`,
  );
  assert.equal(findAll(card, (n) => n.tag === "dl").length, 1, "its screen is shown once");
  chain.nonce = kept;
}

// ── A share under another seat is ignored; a failed save publishes nothing ──
{
  const second = await proposed("register");
  await approve(c, ssOf(second), 1);
  await assert.rejects(() => approve(c, ssOf(second), 1), /approved this already/);
  const signer = ssOf(again).signers[0];
  const real = data.get(path(gid, `solsessions/${again}/shares/${signer}`));
  const where = (seat) => path(gid, `solsessions/${second}/shares/${seat}`);
  const other = signer === 1 ? 2 : 1;
  data.set(where(other), structuredClone(real));
  data.set(where(3), { ...structuredClone(real), by: 3 });
  notify();
  await sleep(300);
  assert.deepEqual(Object.keys(c.shares[second] ?? {}), [], "a copied share counts for nobody");
  assert.equal(ssOf(second).status, "collecting", "one approval, no package");
  assert.equal(ssOf(second).package, undefined);
  data.delete(where(other));
  data.delete(where(3));
  notify();
  const third = await proposed("register");
  const setItem = localStorage.setItem;
  localStorage.setItem = () => {
    throw new Error("disk full");
  };
  await assert.rejects(() => approve(c, ssOf(third), 2), /Could not save the approval/);
  const share = () => spendNonces(c, 2, third, { digest: "d".repeat(64) }, "s");
  await assert.rejects(share, /Could not save the used nonce/);
  localStorage.setItem = setItem;
  assert.equal(data.has(path(gid, `solsessions/${third}/commits/2`)), false, "nothing went out");
  await clearPending(c, 2, third);
}

step("a copied share is ignored, a failed save sends nothing");
// ── A part needs the part before it; a sent mark must name the signature ──
{
  const old = ssOf(again);
  const parts = {
    proposal: {
      intent: old.intent,
      message: old.message,
      feeSig: old.feeSig,
      createdAt: old.createdAt,
    },
    package: { package: old.package, signers: old.signers, digest: old.digest },
    signed: { signature: old.signature },
  };
  const sent = { txId: old.txId, slot: old.slot, outcome: "confirmed" };
  // With no Helius URL this browser sends nothing: the reactor would write a right sent mark
  // over the wrong one (it finds the landed signature), and that is not what is looked at here.
  c.rpcUrl = "";
  const write = (id, name, fields) =>
    writePart(c, id, name, fields, { seat: 1, create: name === "proposal" });
  await write("lonely-sent", "proposal", parts.proposal);
  await write("lonely-sent", "sent", sent);
  await write("lonely-signed", "proposal", parts.proposal);
  await write("lonely-signed", "signed", parts.signed);
  await write("wrong-sent", "proposal", parts.proposal);
  await write("wrong-sent", "package", parts.package);
  await write("wrong-sent", "signed", parts.signed);
  await write("wrong-sent", "sent", { ...sent, txId: base58("11".repeat(64)) });
  await write("right-sent", "proposal", parts.proposal);
  await write("right-sent", "package", parts.package);
  await write("right-sent", "signed", parts.signed);
  await write("right-sent", "sent", sent);
  // The signature checks take a moment: look when every answer is in.
  await waitSession("right-sent", "sent");
  await waitFor("every check", () => c.sessWait === 0 && ssOf("wrong-sent"));
  await sleep(200);
  // These sessions share the nonce of the landed one, so each ends as failed (sol-limits.mjs).
  // None of them counts as sent.
  assert.notEqual(ssOf("lonely-sent").status, "sent", "a sent mark with no signed part");
  assert.notEqual(ssOf("lonely-signed").status, "sent", "a signed part with no package");
  assert.notEqual(ssOf("wrong-sent").status, "sent", "a sent mark with another id");
  assert.equal(ssOf("right-sent").status, "sent");
  c.rpcUrl = RPC;
}

// ── A package that differs from the commits gets no share, and the nonces go ──
{
  const evil = await proposed("register");
  const commit = (seat) => data.get(path(gid, `solsessions/${evil}/commits/${seat}`))?.commitments;
  // The honest packager is held back, as if a bad packager had been faster.
  hook.before = (p, value) => {
    const honest = JSON.stringify({ 1: commit(1), 2: commit(2) });
    if (p.endsWith(`solsessions/${evil}`) && value.package === honest) {
      throw new Error("the honest package is held back");
    }
    return value;
  };
  await approve(c, ssOf(evil), 1);
  await approve(c, ssOf(evil), 2);
  const forged = { 1: commit(1), 2: flip(commit(2)) };
  const fields = { package: JSON.stringify(forged), signers: [1, 2], digest: digestOf(evil) };
  await writePart(c, evil, "package", fields, { seat: 3 });
  await waitSession(evil, "failed");
  hook.before = (_p, value) => value;
  assert.match(ssOf(evil).error, /did not sign: .*package differs from the commits/);
  for (const seat of [1, 2]) {
    assert.equal(savedNonces(c, seat, evil), undefined, "seat " + seat + ": the nonces went");
    assert.equal(usedDigest(c, seat, digestOf(evil)), false, "and no share was made");
    assert.equal(data.has(path(gid, `solsessions/${evil}/shares/${seat}`)), false, "no share");
  }
}

// ── The Worker never gets a key share, solSeed or nonce; the store holds none either ──
{
  const wire = JSON.stringify(chain.commands),
    all = JSON.stringify([...data.values()]);
  const own = [1, 2, 3].flatMap((i) => [
    solOf(gid, i).solSeed,
    solOf(gid, i).keyPackage.signing_share,
    solOf(gid, i).feeSecret,
  ]);
  assert.ok(seenNonces.size >= 6, "the nonces were noted");
  for (const secret of [...own, ...seenNonces]) {
    assert.ok(secret.length >= 32);
    assert.equal(wire.includes(secret), false, "no secret reaches the Worker");
    assert.equal(all.includes(secret), false, "no secret reaches the group server");
  }
  const init = chain.commands.find((m) => m.cmd === "init");
  const fields = ["groupKey", "nullifierSecret", "rpcUrl", "viewingSecret"];
  assert.deepEqual(Object.keys(init.args).sort(), fields);
}

step("no secret reaches the Worker or the store");
// ── A stale nonce at approval time ──
{
  const fresh = await proposed("register");
  const kept = chain.nonce;
  chain.nonce = "cd".repeat(32);
  await assert.rejects(() => approve(c, ssOf(fresh), 1), /nonce changed/);
  assert.equal(savedNonces(c, 1, fresh), undefined, "no nonces for a stale proposal");
  chain.nonce = kept;
}

step("a stale nonce is refused");
// ── The stop: documents that are forged, one seat alone, every seat, and a restore ──
const stopOfParts = (sol, docs = {}) =>
  stopOf({
    host: { localSeats: () => [1, 2, 3], sec: (_g, i) => ({ sol: sol[i] ?? {} }) },
    gid,
    docs,
  });
{
  assert.equal(stopOfParts({}), undefined);
  for (const seat of [1, 2, 3]) {
    const text = "stopped " + seat;
    assert.equal(stopOfParts({ [seat]: { aborted: text } }), text, "seat " + seat + " alone stops");
  }
  const docs = { solabort: { 2: { reason: "Bad key." }, 3: { reason: "Other." }, 1: { at: 1 } } };
  assert.match(stopOfParts({}, docs), /^Seat 2 stopped the Solana part of this wallet\. Bad key\./);
  assert.equal(remoteStop({ solabort: { 1: { reason: 7 } } }), undefined);
  assert.equal(remoteStop(undefined), undefined);
}
const backed = [];
t.setDownloads({ save: async (file) => backed.push(file) });
await backupWords(c, 1).save(PASS);
const file = J(Z.backupOpen(PASS, backed.at(-1).data));
{
  // Forged: no signature at all, and a signed document of seat 3 laid under seat 2.
  data.set(path(gid, "solabort/1"), { reason: "Forged stop.", at: 1 });
  data.set(
    path(gid, "solabort/2"),
    await t.signedDoc(gid, "solabort/3", 3, { reason: "x", at: 1 }),
  );
  notify();
  await sleep(400);
  assert.equal(stopOf(c), undefined, "a forged abort document stops nobody");
  assert.deepEqual(Object.keys(c.docs.solabort), [], "and it is not read");
  data.delete(path(gid, "solabort/1"));
  data.delete(path(gid, "solabort/2"));
  notify();
}
{
  const after = await proposedBeforeStop();
  await approve(c, ssOf(after), 1); // seat 1 holds nonces for it when the stop comes
  // Seat 2 stops. Its browser publishes the signed document by itself.
  await putSol(t, gid, 2, { aborted: "Solana setup stopped: a test. Do not use the Solana part." });
  notify(); // abortSeat runs inside a reactor step, which ends with a new pass; here the test asks
  await waitFor("the abort document", () => data.has(path(gid, "solabort/2")));
  const doc = data.get(path(gid, "solabort/2"));
  assert.equal(doc.by, 2);
  assert.match(doc.reason, /a test/);
  assert.equal(typeof doc.sig, "string");
  await waitFor("the document is read", () => c.docs.solabort[2]);
  // A browser that holds seat 1 only reads it and stops too.
  const away = { 2: t.secrets[gid + ":2"], 3: t.secrets[gid + ":3"] };
  delete t.secrets[gid + ":2"];
  delete t.secrets[gid + ":3"];
  notify();
  await sleep(200);
  assert.deepEqual(t.localSeats(), [1]);
  assert.match(stopOf(c), /^Seat 2 stopped the Solana part of this wallet\./);
  assert.equal(solOf(gid, 1).aborted, undefined, "seat 1 itself did not stop");
  await waitFor("the nonces of a stopped wallet go", () => !savedNonces(c, 1, after));
  await assert.rejects(() => propose(c, "register"), /Seat 2 stopped/);
  await assert.rejects(() => approve(c, ssOf(after), 1), /Seat 2 stopped/);
  assert.equal(reviewOf(c, ssOf(after), 1).ok, false);
  assert.match(textOf(tabOf()), /Seat 2 stopped/);
  // A restore of seat 1 is refused while the document stands, though its browser never saw it.
  const sol = t.secrets[gid + ":1"].sol;
  delete t.secrets[gid + ":1"].sol;
  await assert.rejects(() => t.applyBackup(file, true), /Seat 2 stopped/);
  assert.equal(t.secrets[gid + ":1"].sol, undefined, "nothing was restored");
  t.secrets[gid + ":1"].sol = sol;
  Object.assign(t.secrets, { [gid + ":2"]: away[2], [gid + ":3"]: away[3] });
  notify();
}

// A proposal that exists before the stop: written straight, because propose refuses once stopped.
async function proposedBeforeStop() {
  const intent = intentHex("register", { nonce: chain.nonce, ...done });
  const message = hexOf(compiled(intent));
  const feeSig = feeSignature(c, { id: "after-the-stop", by: 1, intent, message }, 1);
  const fields = { intent, message, feeSig, createdAt: Date.now() };
  await writePart(c, "after-the-stop", "proposal", fields, { seat: 1, create: true });
  await waitFor("the proposal", () => ssOf("after-the-stop"));
  return "after-the-stop";
}

step("a signed stop reaches every seat and survives a restore");
console.log("sol-sessions: ok");
process.exit(0);
