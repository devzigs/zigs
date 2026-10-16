// The fee key of a seat (web/sol/fee.js, addsol.js) against the real web/app.js and the real wasm,
// with the fake chain behind the Worker (sol-chain.mjs): each seat makes its fee key when its
// Solana setup finishes and publishes the address in a signed document, a group from before the
// fee key gets a key at its first run without touching its nonces, the fund card shows the fee
// address of each seat of this browser, a proposal fails with a clear text when its payer has no
// SOL, and Add SOL puts the SOL of one member into the shielded balance of the group with that
// member's signature alone.
// Run: node web/test/sol-fee.mjs   (Node 24)
import assert from "node:assert/strict";
import { addSol } from "../sol/addsol.js";
import { feeSignature, reviewOf } from "../sol/approve.js";
import { base58 } from "../sol/docs.js";
import { feeOf, newFeePatch } from "../sol/fee.js";
import { bytesOf, describeMessage, hexOf, intentHex, pinsHex } from "../sol/intent.js";
import { dropNonces, savedNonces, saveNonces } from "../sol/nonces.js";
import { propose } from "../sol/propose.js";
import { putSol } from "../sol/secrets.js";
import { refreshChain } from "../sol/session.js";
import { readSolSession, writePart } from "../sol/sessions.js";
import { solView } from "../sol/view.js";
import { verifies } from "./sol-chain.mjs";
import { sleep } from "./sol-rig.mjs";
import {
  W,
  c,
  chain,
  data,
  done,
  feeAddress,
  gid,
  hook,
  notify,
  path,
  solOf,
  ssOf,
  t,
  waitFor,
  waitStatus,
  withNonceAccount,
} from "./sol-setup.mjs";

const step = (name) => console.log("ok  " + name);
const FEE = 5000n;
const J = JSON.parse;

// ── Each seat made a fee key, and its document says so ──
{
  const keys = [1, 2, 3].map((i) => feeOf(c, i).key);
  assert.equal(new Set(keys).size, 3, "a fee key for each seat");
  for (const [n, key] of keys.entries()) {
    const seat = n + 1;
    const doc = data.get(path(gid, "solfee/" + seat));
    assert.equal(doc.by, seat, "the seat signed its own document");
    assert.equal(typeof doc.sig, "string");
    assert.deepEqual([doc.key, doc.cluster], [key, "devnet"]);
    assert.equal(c.docs.solfee[seat].key, key, "the page reads the document as valid");
    assert.notEqual(key, done.groupKey, "the group key is no fee key");
    assert.equal(W.sol_fee_public(solOf(seat).feeSecret), key);
  }
  const wire = JSON.stringify(chain.commands);
  for (const i of [1, 2, 3]) assert.equal(wire.includes(solOf(i).feeSecret), false, "no secret");
  const store = JSON.stringify([...data.values()]);
  for (const i of [1, 2, 3]) assert.equal(store.includes(solOf(i).feeSecret), false, "no secret");
}
step("each seat holds its fee key and published its address in a signed document");

// ── A group from before the fee key: the key comes at the first run, nonces stay ──
{
  const entry = { digest: "d".repeat(64), nonces: "aa".repeat(40), commitments: "bb".repeat(40) };
  await saveNonces(c, 2, "older-session", entry);
  const before = structuredClone(solOf(2));
  await putSol(c.host, gid, 2, { feeSecret: null, feePublic: null });
  data.delete(path(gid, "solfee/2"));
  notify();
  await waitFor("a new fee key", () => feeOf(c, 2) !== null);
  await waitFor("its document", () => c.docs.solfee[2]?.key === feeOf(c, 2).key);
  const after = solOf(2);
  assert.notEqual(after.feePublic, before.feePublic, "a new key");
  for (const name of ["keyPackage", "publicKeyPackage", "groupKey", "solSeed", "doneSent"]) {
    assert.deepEqual(after[name], before[name], name + " is as it was");
  }
  assert.deepEqual(savedNonces(c, 2, "older-session"), entry, "the saved nonces are untouched");
  await dropNonces(c, 2, "older-session");
  chain.balances.set(feeAddress(2), 50_000_000n);
}
step("a seat from before the fee key makes one, and its saved nonces stay");

// ── A fee key that its seat did not sign is no fee key ──
{
  const stranger = J(W.sol_fee_key()).public;
  const real = data.get(path(gid, "solfee/3"));
  data.set(path(gid, "solfee/3"), { ...real, key: stranger });
  notify();
  // The seat sees that its document does not show its key, and signs it again. In between, the
  // page never reads the changed document as the fee key of seat 3.
  for (let k = 0; k < 20; k++) {
    assert.notEqual(c.docs.solfee[3]?.key, stranger, "the changed document is never read");
    await sleep(25);
  }
  await waitFor("seat 3 publishes its key again", () => c.docs.solfee[3]?.key === feeOf(c, 3).key);
  assert.equal(data.get(path(gid, "solfee/3")).key, feeOf(c, 3).key);
}
step("a document that another party changed is ignored and the seat publishes again");

// ── The fund card: the fee address of each seat of this browser ──
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
const mark = (name) => findAll(tabOf(), (n) => n.attrs["data-sol"] === name);
{
  await refreshChain(c);
  for (const i of [1, 2, 3]) {
    const [address] = mark("fee-address-" + i);
    assert.equal(textOf(address), feeAddress(i), "the fee address of seat " + i);
    assert.equal(mark("copy-fee-" + i).length, 1, "a Copy button for seat " + i);
    assert.equal(textOf(mark("fee-balance-" + i)[0]), "Balance: 0.05 SOL");
  }
  assert.equal(mark("copy-owner").length, 0, "the group address is no funding address any more");
  const [faucet] = mark("faucet");
  assert.match(faucet.attrs.href, /^https:\/\/faucet\.solana\.com\//);
  const [fund] = findAll(tabOf(), (n) => n.tag === "div" && /Fund the fee address/.test(textOf(n)));
  assert.match(textOf(fund), /Your fee address \(seat 1\)/);
  assert.match(textOf(fund), /pays the fees and the rents of the proposals that this seat makes/);
  assert.match(textOf(fund), /appears on chain next to the group/);
  // Add SOL says that the amount and the sender are public and that it needs no approval.
  assert.match(textOf(mark("add-sol-text")[0]), /amount and the sender are public.*no approval/);
  assert.equal(
    mark("shield").length + mark("shield-amount").length,
    0,
    "the Shield button is gone",
  );
  assert.equal(mark("add-sol").length, 1);
  const owner = base58(done.groupKey);
  assert.equal(textOf(mark("owner")[0]), owner, "the owner address is still shown");
  assert.match(textOf(mark("balance-public")[0]), /^0\.05 SOL$/, "and its old public SOL");
}
step("the fund card shows the fee address of each seat with Copy, the faucet and the balance");

await withNonceAccount();

// ── Another fee key in the document: no proposal, no Add SOL, and no rewrite ──
const ANOTHER = /Seat 1 has another fee key in another browser/;
{
  const held = { feeSecret: solOf(1).feeSecret, feePublic: solOf(1).feePublic };
  await putSol(c.host, gid, 1, newFeePatch(W));
  await assert.rejects(() => propose(c, "register"), ANOTHER);
  await assert.rejects(() => addSol(c, { amount: "0.01" }), ANOTHER);
  await putSol(c.host, gid, 1, held);
  assert.equal(feeOf(c, 1).key, held.feePublic, "the key of the seat is back");
}
step("a proposal and Add SOL stop when the document shows another fee key of the seat");

// ── One seat in two browsers with two fee keys: the page does not answer with its own ──
const rewrites = [];
const saved = hook.before;
hook.before = (p, value) => {
  if (p.endsWith("/solfee/1")) rewrites.push(value);
  return value;
};
const doc1 = (key, cluster = "devnet") =>
  c.host.signedDoc(gid, "solfee/1", 1, { key, cluster, at: Date.now() });
{
  const mine = feeOf(c, 1).key,
    other = J(W.sol_fee_key()).public;
  // The other browser (an older page that republishes when the document is not its key) answers.
  data.set(path(gid, "solfee/1"), await doc1(other));
  notify();
  await sleep(2000);
  assert.equal(rewrites.length, 0, "this page never writes while another valid key stands");
  assert.equal(data.get(path(gid, "solfee/1")).key, other, "the document is the other key");
  assert.equal(c.docs.solfee[1].key, other);
  assert.equal(mark("fee-address-1").length, 0, "no address to fund: this browser cannot pay");
  assert.match(textOf(mark("fee-conflict-1")[0]), ANOTHER);
  assert.equal(mark("fee-address-2").length, 1, "the other seats show their address");
  data.set(path(gid, "solfee/1"), await doc1(mine));
  notify();
  await sleep(200);
  assert.equal(mark("fee-address-1").length, 1, "the key of this browser stands again");
  assert.equal(mark("fee-conflict-1").length, 0);
  assert.equal(rewrites.length, 0, "and still no write");
}
step("a seat whose document shows another key writes nothing and says so");

// ── No valid document: the seat publishes once. Another cluster is no document ──
{
  const mine = feeOf(c, 1).key;
  for (const [label, doc] of [
    ["none", null],
    ["another cluster", await doc1(mine, "mainnet")],
    ["another cluster and key", await doc1(J(W.sol_fee_key()).public, "mainnet")],
  ]) {
    rewrites.length = 0;
    if (doc === null) data.delete(path(gid, "solfee/1"));
    else data.set(path(gid, "solfee/1"), doc);
    notify();
    await waitFor("the document of " + label, () => c.docs.solfee[1]?.cluster === "devnet");
    await sleep(500);
    assert.equal(rewrites.length, 1, label + ": one write, then it stops");
    assert.deepEqual([rewrites[0].key, rewrites[0].cluster], [mine, "devnet"]);
  }
}
step("a seat with no valid document publishes once");

// ── A key that is held but not published yet: a proposal and Add SOL wait ──
{
  let release;
  const gate = new Promise((go) => (release = go));
  hook.before = async (p, value) => {
    if (p.endsWith("/solfee/1")) await gate;
    return value;
  };
  data.delete(path(gid, "solfee/1"));
  notify();
  await waitFor("no document", () => c.docs.solfee[1] === undefined);
  await assert.rejects(() => propose(c, "register"), /fee address of seat 1 is not published yet/);
  await assert.rejects(() => addSol(c, { amount: "0.01" }), /not published yet/);
  release();
  hook.before = saved;
  await waitFor("its document", () => c.docs.solfee[1]?.key === feeOf(c, 1).key);
}
step("a proposal and Add SOL wait until the document shows the fee key of the seat");
hook.before = saved;

// ── A proposal by seat 2 is paid by seat 2, as its document says ──
{
  const register = intentHex("register", { nonce: chain.nonce, ...done });
  const fee2 = bytesOf(pinsHex(done, feeOf(c, 2).key));
  const message = W.compile_message(bytesOf(register), fee2, new Uint8Array(0));
  const ss = { id: "by-2", status: "collecting", by: 2, intent: register, message: hexOf(message) };
  ss.feeSig = feeSignature(c, ss, 2);
  const review = reviewOf(c, ss, 1);
  assert.equal(review.ok, true, review.why);
  assert.equal(review.payer, feeOf(c, 2).key, "the payer is the fee key of seat 2");
  assert.equal(review.by, 2);
}
step("a proposal of seat 2 is paid by the fee key of seat 2");

// ── The payer pays: fees come out of the fee address, never out of the group address ──
{
  assert.equal(
    chain.balances.get(feeAddress(1)),
    50_000_000n - 2n * FEE,
    "seat 1 paid two signatures",
  );
  assert.equal(chain.balances.get(feeAddress(2)), 50_000_000n, "seat 2 paid nothing");
  assert.equal(chain.balances.get(chain.group.owner), 50_000_000n, "the group paid nothing");
}
step("a landed proposal costs the fee address of the proposing seat");

// ── A payer without SOL: a clear text, and nothing is written ──
{
  const before = [...data.keys()].filter((k) => k.includes("solsessions/")).length;
  for (const [held, label] of [
    [0n, "no account"],
    [FEE, "less than the fee"],
  ]) {
    chain.balances.set(feeAddress(1), held);
    await assert.rejects(
      () => propose(c, "register"),
      /fee address of seat 1 has too little Devnet SOL.*Fund it/,
      label,
    );
  }
  assert.equal([...data.keys()].filter((k) => k.includes("solsessions/")).length, before);
  chain.balances.set(feeAddress(1), 50_000_000n);
}
step("a proposal whose payer has no SOL fails with a clear text and writes nothing");

// ── Add SOL: the SOL of one member, signed by that member alone ──
const sessions = () => [...data.keys()].filter((k) => k.includes("solsessions/")).length;
const roles = J(W.sol_roles(solOf(1).solSeed, done.groupKey));
{
  const nonce = chain.nonce,
    before = { sessions: sessions(), landed: chain.landed.length };
  const got = await addSol(c, { amount: "0.01" });
  assert.deepEqual([got.seat, got.amount, got.status], [1, 10_000_000n, "confirmed"]);
  assert.equal(chain.landed.length, before.landed + 1);
  const landed = chain.landed.at(-1),
    message = bytesOf(landed.message);
  assert.equal(landed.sigs.length, 1, "one signature: no group signature");
  assert.ok(verifies(feeOf(c, 1).key, message, bytesOf(landed.sigs[0])), "the fee key signed");
  assert.equal(got.txId, base58(landed.sigs[0]), "the id is the signature of the payer");
  assert.equal(describeMessage(message).signatures, 1);
  assert.equal(describeMessage(message).computeUnits, 56877n, "the template limit of a deposit");
  // The accounts of the message: the group key is in the data of the deposit (its view tag), and
  // in no account: it does not sign, and its nonce account is not used.
  const accounts = Array.from({ length: message[41] }, (_, n) =>
    hexOf(message.subarray(42 + 32 * n, 74 + 32 * n)),
  );
  assert.equal(accounts[0], feeOf(c, 1).key, "the payer is the first account");
  assert.equal(accounts.includes(done.groupKey), false, "the group key is no account");
  assert.equal(
    accounts.includes(base58hex(chain.group.nonceAccount)),
    false,
    "nor its nonce account",
  );
  const key = (hex) => Buffer.from(message).includes(Buffer.from(hex, "hex"));
  assert.equal(key(done.groupKey), true, "it is the view tag of the deposit, in the data");
  assert.equal(key("8096980000000000"), true, "the amount is in the deposit");
  assert.equal(key(roles.owner_hash), true, "the deposit goes to the owner hash of the group");
  assert.equal(chain.nonce, nonce, "the nonce account did not move");
  assert.equal(sessions(), before.sessions, "no approval round, no session");
  assert.equal(chain.balances.get(feeAddress(1)), 50_000_000n - FEE, "the fee came from seat 1");
  const sent = chain.commands.findLast((m) => m.cmd === "send");
  assert.equal(Buffer.from(sent.args.tx, "base64").length, message.length + 64);
}
step("Add SOL lands with the signature of one member and touches nothing of the group");

/** A base58 address as hex (the fake chain keeps addresses as base58). */
function base58hex(text) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const ch of text) n = n * 58n + BigInt(alphabet.indexOf(ch));
  return n.toString(16).padStart(64, "0");
}

// ── Add SOL refuses bad input, an unfunded address and a refusal of the network ──
{
  const landed = chain.landed.length;
  for (const bad of ["0", "abc", "", "-1", "1e3"]) {
    await assert.rejects(() => addSol(c, { amount: bad }), /Enter an amount of SOL/, bad);
  }
  chain.balances.set(feeAddress(1), 0n);
  await assert.rejects(() => addSol(c, { amount: "0.01" }), /too little Devnet SOL.*Fund it/);
  chain.balances.set(feeAddress(1), 50_000_000n);
  chain.refuse = "SomeOtherError";
  await assert.rejects(
    () => addSol(c, { amount: "0.01" }),
    /refused this in a test run: SomeOther/,
  );
  chain.refuse = null;
  assert.equal(chain.landed.length, landed, "none of them reached the chain");
}
step("Add SOL refuses a bad amount, an unfunded address and a refusal of the network");

// ── The fee key signs no deposit to another owner, and no message that another key pays ──
{
  const { blockhashHex } = await c.worker.call("blockhash");
  const intent = intentHex("shield", { blockhash: blockhashHex, amount: 10_000_000n });
  const pins = (payer) => bytesOf(pinsHex(done, payer));
  const compile = (payer) => W.compile_message(bytesOf(intent), pins(payer), new Uint8Array(0));
  const ss = (message) => ({ id: "x", by: 1, intent, message: hexOf(message) });
  const good = compile(feeOf(c, 1).key);
  assert.equal(feeSignature(c, ss(good), 1).length, 128, "the control: an honest deposit");
  const at = Buffer.from(good).indexOf(Buffer.from(roles.owner_hash, "hex"));
  assert.ok(at > 0);
  const elsewhere = Uint8Array.from(good);
  elsewhere[at] ^= 1;
  assert.throws(() => feeSignature(c, ss(elsewhere), 1), /shield-owner/, "another owner hash");
  const other = compile(feeOf(c, 2).key);
  assert.throws(() => feeSignature(c, ss(other), 1), /fee-payer-not-payer/, "another payer");
}
step("the fee key signs no deposit to another owner and no message that another key pays");

// ── An Add SOL message written as a session: a refusal, and the tab stays up ──
{
  const { blockhashHex } = await c.worker.call("blockhash");
  const intent = intentHex("shield", { blockhash: blockhashHex, amount: 10_000_000n });
  const pins = bytesOf(pinsHex(done, feeOf(c, 2).key));
  const message = hexOf(W.compile_message(bytesOf(intent), pins, new Uint8Array(0)));
  const draft = { id: "shield-session", status: "collecting", by: 2, intent, message };
  const feeSig = feeSignature(c, draft, 2);
  const fields = { intent, message, feeSig, createdAt: Date.now() };
  await writePart(c, draft.id, "proposal", fields, { seat: 2, create: true });
  await waitFor("the Add SOL session", () => ssOf(draft.id));
  const review = reviewOf(c, ssOf(draft.id), 1);
  assert.equal(review.ok, false, "Add SOL is no session: no approval");
  assert.match(review.why, /not one that this app can show/);
  const [card] = findAll(tabOf(), (n) => n.attrs["data-session"] === draft.id);
  assert.match(textOf(card), /not one that this app can show/, "the card says so");
  assert.equal(mark("add-sol").length, 1, "the rest of the tab is there");
}
step("an Add SOL message written as a session gets a refusal and the tab stays readable");
// ── Proposals from before the fee keys: no feeSig, the group signature is the id ──
{
  const BEFORE = /from before the fee keys.*Propose it again/;
  const nonceOf = (n) => String(n).repeat(64).slice(0, 64);
  const signatures = {};
  const intentOf = (n) => intentHex("register", { nonce: nonceOf(n), ...done });
  const pins = bytesOf(pinsHex(done, feeOf(c, 1).key));
  const messageOf = (n) => hexOf(W.compile_message(bytesOf(intentOf(n)), pins, new Uint8Array(0)));
  const part = (id, name, fields) =>
    writePart(c, id, name, fields, { seat: 1, create: name === "proposal" });
  const proposal = (id, n) =>
    part(id, "proposal", { intent: intentOf(n), message: messageOf(n), createdAt: Date.now() });
  const signedBy = async (id, n) => {
    signatures[id] = String(n + 1).repeat(128).slice(0, 128);
    await part(id, "package", { package: "{}", signers: [1, 2], digest: "d".repeat(64) });
    await part(id, "signed", { signature: signatures[id] });
  };
  const watch = chain.commands.length;
  const wire = () => chain.commands.slice(watch).map((m) => m.cmd);
  const landedBefore = chain.landed.length;

  await proposal("old-collecting", 1);
  await proposal("old-signing", 2);
  await part("old-signing", "package", { package: "{}", signers: [1, 2], digest: "d".repeat(64) });
  await proposal("old-landed", 3);
  await signedBy("old-landed", 3);
  chain.landed.push({ signature: base58(signatures["old-landed"]), message: "00", sigs: [] });
  await proposal("old-missed", 4);
  await signedBy("old-missed", 4);
  await proposal("old-sent", 5);
  await signedBy("old-sent", 5);
  const mark = { txId: base58(signatures["old-sent"]), slot: "7", outcome: "confirmed" };
  await part("old-sent", "sent", mark);
  await proposal("old-failed", 6);
  await part("old-failed", "failure", { error: "An older text." });

  for (const id of ["old-collecting", "old-signing", "old-missed", "old-failed"]) {
    await waitStatus(id, "failed", 8000);
  }
  await waitStatus("old-landed", "sent", 8000);
  assert.equal(ssOf("old-sent").status, "sent", "a landed proposal of before reads as sent");
  const stored = (id) => data.get(path(gid, "solsessions/" + id));
  for (const id of ["old-collecting", "old-signing", "old-missed"]) {
    assert.match(stored(id).error, BEFORE, id + " ends with a clear text");
    assert.equal(stored(id).txId, undefined, id + " was not sent");
  }
  assert.equal(stored("old-failed").error, "An older text.", "its own failure text stays");
  assert.equal(stored("old-landed").txId, base58(signatures["old-landed"]), "marked as landed");
  assert.deepEqual(
    [stored("old-sent").txId, stored("old-sent").slot, stored("old-sent").error],
    [mark.txId, "7", undefined],
    "a sent mark of before is left as it is",
  );
  assert.equal(wire().includes("simulate") || wire().includes("send"), false, "nothing was sent");
  assert.equal(chain.landed.length, landedBefore + 1, "nothing landed beyond the one seeded");
  assert.equal(t.banner?.text ?? "", "", "no red banner");
  const draft = { id: "x", status: "collecting", by: 1, intent: intentOf(7) };
  const refusal = reviewOf(c, { ...draft, message: messageOf(7) }, 2);
  assert.match(refusal.why, /fee signature/, "no approval without the signature of the payer");
  // The reader alone: the sent mark of before needs its own rule, the new rule needs feeSig.
  const read = (d) => readSolSession("x", d, () => "yes").ss?.status;
  const old = { intent: intentOf(8), message: messageOf(8), signature: "55".repeat(64) };
  const sent = { slot: "1", outcome: "confirmed", package: "{}", signers: [1, 2], digest: "d" };
  assert.equal(read({ ...old, ...sent, txId: base58(old.signature) }), "sent");
  assert.equal(read({ ...old, ...sent, txId: base58("66".repeat(64)) }), "signed");
  const paid = { ...old, feeSig: "77".repeat(64), ...sent };
  assert.equal(read({ ...paid, txId: base58(paid.signature) }), "signed", "a payer signs first");
  assert.equal(read({ ...paid, txId: base58(paid.feeSig) }), "sent");
}
step("a proposal from before the fee keys is read as it was and is never sent again");
console.log("sol-fee: ok");
process.exit(0);
