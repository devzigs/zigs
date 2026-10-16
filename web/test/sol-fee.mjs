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
  notify,
  path,
  solOf,
  waitFor,
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

// ── A fee key that its document does not show yet: no proposal, no Add SOL ──
{
  const held = { feeSecret: solOf(1).feeSecret, feePublic: solOf(1).feePublic };
  await putSol(c.host, gid, 1, newFeePatch(W));
  await assert.rejects(() => propose(c, "register"), /fee address of seat 1 is not published yet/);
  await assert.rejects(() => addSol(c, { amount: "0.01" }), /not published yet/);
  await putSol(c.host, gid, 1, held);
  assert.equal(feeOf(c, 1).key, held.feePublic, "the key of the seat is back");
}
step("a proposal and Add SOL wait until the document shows the fee key of the seat");

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
console.log("sol-fee: ok");
process.exit(0);
