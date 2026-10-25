// Private payments of the program design (ZOLANA.md 7.2) against the fake chain, with the test
// group of sol-group.json, for which the TS SDK built the payments (sol-fixture.mjs). This file
// holds:
//  - the snapshot that an approving device reads for itself (web/sol/spend.js), for a payment (the
//    PDA identity, the pair of the first proof) and for the move of the beta funds (the group key,
//    the pair of the message);
//  - one payment through propose (the proposal account is created on chain first), the screens
//    of the device while it reads, approve by two seats, the approval digest signed with FROST,
//    and the execute with a fresh proof that the fake chain accepts only with the approval
//    signature over the digest of the stored body;
//  - SOL-4: the switch that makes the group prove on its devices.
// The other payment tests are in sol-pay-exec.mjs (stale proofs, the funded seat, withdrawals,
// failed and late executes, open proposals), sol-pay-seats.mjs (balance reads, seats that cannot
// pay), sol-pay-lease.mjs (the lease, the end of a payment, the move of the beta funds),
// sol-pay-look.mjs (account reads of a tab, an execute of another device) and sol-pay-end.mjs
// (the end of a signed payment). They share sol-pay-rig.mjs. The waits for the timers of the
// page make the payment tests long, so they run in six files at the same time.
// Run: node web/test/sol-pay.mjs   (Node 26)
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { approve, deviceSeen, reviewOf } from "../sol/approve.js";
import { base58 } from "../sol/docs.js";
import { executorsOf } from "../sol/execute.js";
import { ZERO_KEY, bytesOf, decodeIntent, planHex, readVerdict } from "../sol/intent.js";
import { savedNonces, saveNonces } from "../sol/nonces.js";
import { feeOf } from "../sol/fee.js";
import { putSol } from "../sol/secrets.js";
import { deviceSpend } from "../sol/spend.js";
import { gateAnswer, provesLocally, UNREAD } from "../sol/localprove.js";
import {
  LINK_TEXT,
  PROVER_LOCAL,
  PROVER_ROW_LOCAL,
  PROVER_TEXT,
  SHOWN,
  approveSeats,
} from "../sol/payview.js";
import { writePart } from "../sol/sessions.js";
import { solView } from "../sol/view.js";
import { POOL_SLOT, verifies } from "./sol-chain.mjs";
import { G, preparedOf, transactOf, utxoOf } from "./sol-fixture.mjs";
import {
  c,
  chain,
  data,
  feeAddress,
  gid,
  hook,
  notify,
  path,
  solOf,
  ssOf,
  waitFor,
  waitStatus,
} from "./sol-setup.mjs";
import { step } from "./sol-vector.mjs";
import {
  cur,
  dropSessions,
  findAll,
  forgetPairs,
  installTestGroup,
  later,
  marked,
  node,
  preparedPay,
  proposedPay,
  realNow,
  rowsOf,
  textOf,
} from "./sol-pay-rig.mjs";

const SOL_MINT = "1".repeat(32);
const input = (hash, tree, mint = SOL_MINT) => ({
  hash,
  mint,
  amount: "5000000",
  blinding: "07".repeat(32),
  tree,
  leaf: "0",
});
const HASH = "aa".repeat(32);
const OTHER = "bb".repeat(32);
const move = { id: "p1", intent: "03" + "00".repeat(181), inputIds: [HASH] };
move.message = "00".repeat(16);

// ── The snapshot of the move is read from the wallet of the group key, matched by id ──
chain.oldUtxos = [input(HASH, "TREE1"), input(OTHER, "TREE2")];
{
  const got = await deviceSpend(c, move);
  assert.deepEqual(got.inputs, [{ mint: ZERO_KEY, amount: "5000000", blinding: "07".repeat(32) }]);
  assert.equal(got.fee, chain.fee, "the insertion fee of the tree");
  const { firstNullifier: first, salt } = chain.inspected;
  assert.deepEqual(got.pair, { first, salt }, "the pair of the message");
  assert.deepEqual(got.salts, [], "no earlier pair");
  const asked = chain.commands.filter((m) => m.cmd === "treeFees").at(-1);
  assert.equal(asked.args.tree, "TREE1", "the fee is read for the tree of the inputs");
  assert.equal(chain.commands.at(-3).cmd, "syncOld", "the move spends the group key");
}
step("the snapshot of the move holds the inputs of the group key, matched by id, and the tree fee");

const refused = (what, spec, pattern) =>
  assert.rejects(() => deviceSpend(c, { ...move, ...spec }), pattern, what);
await refused("an input that is not in the wallet", { inputIds: ["cc".repeat(32)] }, /every input/);
await refused("no input id", { inputIds: [] }, /every input/);
await refused("one input missing", { inputIds: [HASH, "cc".repeat(32)] }, /every input/);
await refused("inputs of two trees", { inputIds: [HASH, OTHER] }, /different trees/);
chain.oldUtxos = [input(HASH, "TREE1", "2".repeat(32))];
await refused("an input that is not SOL", {}, /Only SOL/);
chain.oldUtxos = [];
step("a missing input, inputs of two trees and another mint are refused");

// ── The pairs of the other sessions that this browser approved ──
{
  chain.oldUtxos = [input(HASH, "TREE1")];
  const pair = { first: "01".repeat(32), salt: "02".repeat(16) };
  const entry = { digest: "d", nonces: {}, commitments: {}, spend: { pair } };
  await saveNonces(c, 1, "other-session", entry);
  const later = await deviceSpend(c, move);
  assert.deepEqual(later.salts, [pair], "the pair of another session");
  const own = await deviceSpend(c, { ...move, id: "other-session" });
  assert.deepEqual(own.salts, [], "the pair of the session itself is not an earlier pair");
  chain.oldUtxos = [];
}
step("the earlier pairs come from the other sessions only");

// ── The pairs of the proposals on the group server count, also after a restore ──
{
  chain.oldUtxos = [input(HASH, "TREE1")];
  const own = chain.inspected;
  const theirs = { first: "03".repeat(32), salt: "04".repeat(16) };
  const asked = [];
  chain.inspected = ({ tx }) => {
    const hex = Buffer.from(tx, "base64").toString("hex");
    asked.push(hex);
    if (hex === "11".repeat(16)) return { firstNullifier: theirs.first, salt: theirs.salt };
    if (hex === "22".repeat(16)) throw new Error("the message has 0 pool instructions");
    return own;
  };
  // A payment and a withdrawal hold the plan and the first proof. One with no input, or with a
  // byte after its plan (the checker would read another proof), has no pair that the page reads.
  const proof = (payment, more = {}) => ({
    plan: planHex(preparedOf(payment, { expiry: "1" })),
    transact: transactOf({ ...payment, ...more }, 1),
  });
  const pay = { intent: "08" + "00".repeat(149), ...proof(G.pay) };
  const written = {
    "server-move": { intent: move.intent, message: "11".repeat(16) },
    "server-bad": { intent: move.intent, message: "22".repeat(16) },
    "server-nonce": { intent: "00" + "00".repeat(32), message: "33".repeat(16) },
    "server-withdraw": { intent: "0a" + "00".repeat(50), ...proof(G.withdraw) },
    "server-empty": { ...pay, ...proof(G.pay, { inputs: [] }) },
    "server-plan": { ...pay, plan: pay.plan + "00" },
  };
  const withdrawn = { first: G.withdraw.inputs[0].nullifier, salt: G.withdraw.salt };
  const key = (p) => p.first + p.salt;
  const sorted = (list) => [...list].sort((a, b) => key(a).localeCompare(key(b)));
  for (const [id, fields] of Object.entries(written)) {
    await writePart(c, id, "proposal", { ...fields, createdAt: 1 }, { seat: 1, create: true });
  }
  await waitFor("the server sessions", () => Object.keys(written).every((id) => ssOf(id)));
  // An ended session counts too: a failed proposal can still have published its data.
  await writePart(c, "server-move", "failure", { error: "refused" }, { seat: 1 });
  await waitFor("the failed move", () => ssOf("server-move")?.status === "failed");
  const both = await deviceSpend(c, move);
  const local = { first: "01".repeat(32), salt: "02".repeat(16) };
  const want = sorted([local, theirs, withdrawn]);
  assert.deepEqual(sorted(both.salts), want, "the pair of this browser and of the server");
  for (const i of [1, 2, 3]) await putSol(c.host, gid, i, { salts: null });
  const restored = await deviceSpend(c, move);
  const server = sorted([theirs, withdrawn]);
  assert.deepEqual(sorted(restored.salts), server, "a restored seat reads the pairs of the server");
  const mine = await deviceSpend(c, { ...move, id: "server-move" });
  assert.deepEqual(mine.salts, [withdrawn], "the session itself is no other proposal");
  // A session whose signature check waits is not in the list yet: no list until it is checked.
  c.sessWait = 1;
  const waiting = "a list read while a signature check waits is refused";
  await assert.rejects(() => deviceSpend(c, move), /still checking/, waiting);
  c.sessWait = 0;
  assert.ok(!asked.includes("33".repeat(16)), "the message of the nonce account has no pair");
  await dropSessions(Object.keys(written));
  chain.inspected = own;
  chain.oldUtxos = [];
}
step("the pairs of the group server count after a restore; the nonce account has none");

await installTestGroup();

// ── No screen and no approval before the device has read its wallet and the account ──
{
  const id = await proposedPay();
  cur.id = id;
  const ss = ssOf(id);
  assert.equal(decodeIntent(ss.intent).kind, "approve", "a payment is approved once");
  assert.equal(ss.message, undefined, "a payment has no message");
  assert.ok(chain.accounts.has(base58(ss.account)), "the proposal account exists on chain");
  const stored = chain.accounts.get(base58(ss.account));
  assert.equal(stored.data.slice(4), ss.body, "the account holds the body of the session");
  const created = chain.landed.find((x) => x.signature === ss.createTx);
  assert.ok(created, "the create landed with the id that the session names");
  assert.equal(created.sigs.length, 1, "the fee key of seat 1 creates it alone");
  assert.ok(verifies(feeOf(c, 1).key, bytesOf(created.message), bytesOf(created.sigs[0])));
  const before = { ...ss, id: "w" };
  const whyOf = (spend, seen) => {
    try {
      return reviewOf(c, before, 2, spend, seen).why;
    } catch (e) {
      return String(e);
    }
  };
  const spend = { fee: "0", inputs: [], salts: [] };
  assert.match(whyOf(undefined, undefined), /reading your wallet/);
  const seen = { account: null, approved: [] };
  assert.match(whyOf(undefined, seen), /reading your wallet/, "no review before the wallet read");
  assert.match(whyOf(spend, undefined), /reading your wallet/, "no review before the account read");
}
step("propose creates the proposal account first; no screen before the reads of the device");

// ── A node that shows the new account late: the device reads it again ──
{
  const id = cur.id;
  const address = base58(ssOf(id).account);
  const stored = chain.accounts.get(address);
  chain.accounts.delete(address);
  delete c.seen[id];
  delete c.snaps[id];
  // S17: while the device reads, the card shows a wait, not a refusal.
  assert.equal(reviewOf(c, ssOf(id), 2).waiting, true, "reading is a wait");
  const marks = (name) => {
    const view = solView({ ...c, host: { ...c.host, el: node } }, (fn) => fn, {});
    const card = findAll(view, (n) => n.attrs["data-session"] === id)[0];
    return findAll(card, (n) => n.attrs["data-sol"] === name).length;
  };
  assert.ok(marks("wait") >= 1, "the card says that the device loads its data");
  assert.equal(marks("refusal"), 0, "and shows no alert");
  const buttons = () => marks("approve-" + id + "-2");
  assert.equal(buttons(), 0, "and no Approve button before the review shows");
  notify();
  await waitFor("a read with no account", () => c.seen[id]?.account === null);
  assert.equal(reviewOf(c, ssOf(id), 2).ok, false, "no account: no approval yet");
  chain.accounts.set(address, stored);
  await waitFor("the account read again", () => reviewOf(c, ssOf(id), 2).ok, 30000);
  assert.equal(buttons(), 1, "the Approve button comes with the review");
  // A seat with a share but no signing key here gets no button, and the card says why.
  const noKey = solView({ ...c, host: { ...c.host, el: node, canWriteAs: () => false } },
    (fn) => fn, {});
  const keyless = findAll(noKey, (n) => n.attrs["data-session"] === id)[0];
  assert.equal(findAll(keyless, (n) => String(n.attrs["data-sol"]).startsWith("approve-")).length,
    0, "a seat with no signing key gets no Approve button");
  assert.match(textOf(keyless), /cannot sign for device 2\./, "and the card says why");
  // A document that waits for its signature check is a wait too: no alert and no button.
  c.sessWait += 1;
  assert.equal(reviewOf(c, ssOf(id), 2).waiting, true, "a check of the documents is a wait");
  assert.deepEqual([marks("wait"), marks("refusal"), buttons()], [1, 0, 0]);
  c.sessWait -= 1;
  assert.deepEqual([marks("wait"), buttons()], [0, 1], "the button comes back after the check");
  // A collection that is not loaded yet is a wait too.
  c.loaded.solsessions = false;
  assert.equal(reviewOf(c, ssOf(id), 2).waiting, true, "a load of the documents is a wait");
  assert.deepEqual([marks("wait"), marks("refusal"), buttons()], [1, 0, 0]);
  c.loaded.solsessions = true;
}
step("a device that read no proposal account reads it again, with no click");

// ── A missing account is a wait, a click keeps the re-read, an expired proposal has no button
{
  const id = cur.id;
  const address = base58(ssOf(id).account);
  const stored = chain.accounts.get(address);
  const marks = (name) => {
    const view = solView({ ...c, host: { ...c.host, el: node } }, (fn) => fn, {});
    const card = findAll(view, (n) => n.attrs["data-session"] === id)[0];
    return findAll(card, (n) => String(n.attrs["data-sol"]).startsWith(name)).length;
  };
  // The S6 count of the proposals that wait for this browser uses approveSeats: it must name the
  // proposals whose cards show an Approve button, in every state below.
  const agree = (what) => {
    const view = solView({ ...c, host: { ...c.host, el: node } }, (fn) => fn, {});
    const shown = c.sessions.slice(0, SHOWN);
    const button = (ss) => (n) => String(n.attrs["data-sol"]).startsWith(`approve-${ss.id}-`);
    const withButton = shown.filter((ss) => findAll(view, button(ss)).length > 0);
    const counted = shown.filter((ss) => approveSeats(c, ss).length > 0);
    assert.deepEqual(counted.map((ss) => ss.id), withButton.map((ss) => ss.id), what);
  };
  agree("the count and the buttons agree before the read");
  chain.accounts.delete(address);
  delete c.seen[id];
  delete c.snaps[id];
  notify();
  await waitFor("a read with no account", () => c.seen[id]?.account === null);
  assert.equal(reviewOf(c, ssOf(id), 2).waiting, true, "a missing account is a wait at first");
  assert.deepEqual([marks("refusal"), marks("approve-")], [0, 0], "no alert and no button");
  agree("the count and the buttons agree while the account is missing");
  // A click reads the account itself and keeps the time of that read: the re-read goes on, with
  // a pass of the reactor after 5 s also on an idle page. The click comes a while after the read.
  const firstMiss = c.seen[id].missedSince;
  await new Promise((done) => setTimeout(done, 1500));
  const passes = [];
  const refilter = c.host.refilter;
  c.host.refilter = () => (passes.push(Date.now()), refilter());
  const clicked = Date.now();
  await assert.rejects(approve(c, ssOf(id), 2), /reading your wallet/);
  assert.ok(c.seen[id].at > firstMiss, "the click keeps the time of its read");
  assert.equal(c.seen[id].missedSince, firstMiss, "and the time of the first miss");
  await new Promise((done) => setTimeout(done, 5300));
  c.host.refilter = refilter;
  assert.ok(passes.some((at) => at - clicked >= 5000), "a pass of the reactor after the click");
  await waitFor("an automatic re-read", () => c.seen[id].at > clicked + 5000, 15000);
  assert.equal(c.seen[id].missedSince, firstMiss, "an automatic re-read keeps the first miss");
  // A wallet read that fails right after a miss still reads the account again, on an idle page.
  const accountReads = () => chain.commands.filter((m) => m.cmd === "account").length;
  const [kept, reads] = [chain.utxos, accountReads()];
  chain.utxos = []; // the snapshot of the device fails after each account read
  await waitFor("two more account reads", () => accountReads() >= reads + 2, 40000);
  chain.utxos = kept;
  // A miss that lasts 30 s is a refusal: the checker says why.
  const since = c.seen[id].missedSince;
  c.seen[id].missedSince = Date.now() - 31_000;
  assert.equal(marks("refusal"), 1, "a long miss shows the refusal");
  agree("the count and the buttons agree after a long miss");
  c.seen[id].missedSince = since;
  chain.accounts.set(address, stored);
  await waitFor("the account read again", () => reviewOf(c, ssOf(id), 2).ok, 30000);
  // After the expiry no seat can approve, also before the page ends the proposal (600 s later).
  const ahead = (Number(ssOf(id).expiry) + 100) * 1000 - Date.now();
  later(ahead);
  const shown = [marks("expired"), marks("approve-"), marks("refusal"), marks("review-")];
  agree("the count and the buttons agree after the expiry");
  Date.now = realNow;
  assert.deepEqual(shown, [1, 0, 0, 0], "an expired proposal shows one line and no button");
  assert.ok(marks("approve-") > 0, "control: the buttons before the expiry");
}
step("a missing account is a wait, a click keeps the re-read, and an expiry hides Approve");

// ── S5: a failed wallet read waits 3 s, then 6 s, shows one banner; a success clears it ──
{
  const id = cur.id;
  const key = "snap:" + id;
  const address = base58(ssOf(id).account);
  const stamps = [];
  const push = chain.commands.push;
  chain.commands.push = function (msg) {
    if (msg.cmd === "account" && msg.args?.account === address) stamps.push(Date.now());
    return push.call(this, msg);
  };
  const banners = [];
  const banner = c.host.showBanner;
  c.host.showBanner = (kind, text) => banners.push(text);
  const kept = chain.utxos;
  chain.utxos = []; // the device does not see the input of the payment: its read fails
  delete c.snaps[id];
  delete c.seen[id];
  const pump = setInterval(notify, 200); // the reactor runs often: the busy key holds the reads
  await waitFor("three failed reads", () => c.readFails[key]?.n === 3, 30000);
  // After two failures the card says why the read fails, and still shows no Approve button.
  const view = solView({ ...c, host: { ...c.host, el: node } }, (fn) => fn, {});
  const card = findAll(view, (n) => n.attrs["data-session"] === id)[0];
  const inCard = (name) => findAll(card, (n) => n.attrs["data-sol"] === name);
  const [failed] = inCard("read-failed");
  assert.equal(failed.attrs.class, "small bad", "the cause is an error line");
  assert.match(textOf(failed), /^Zigs could not read your wallet: .*does not see every input/);
  assert.deepEqual([inCard("wait").length, inCard("approve-" + id + "-2").length], [0, 0]);
  const gaps = stamps.slice(1).map((at, n) => at - stamps[n]);
  assert.equal(stamps.length, 3, "no read while the step waits");
  assert.ok(gaps[0] >= 2900 && gaps[0] < 4500, "the first wait is 3 s: " + gaps[0]);
  assert.ok(gaps[1] >= 5900 && gaps[1] < 7500, "the second wait is 6 s: " + gaps[1]);
  assert.equal(banners.length, 1, "one banner for three failures with one text");
  chain.utxos = kept;
  await waitFor("the read succeeds", () => c.snaps[id] !== undefined, 30000);
  clearInterval(pump);
  assert.equal(c.readFails[key], undefined, "a success clears the count");
  assert.equal(stamps.length, 4, "one more read");
  chain.commands.push = push;
  c.host.showBanner = banner;
}
step("a failed wallet read waits longer each time, shows one banner, and a success clears it");

// ── A read that fails because the wallet closed writes nothing into the next wallet ──
{
  const id = cur.id;
  const key = "snap:" + id;
  const banners = [];
  const banner = c.host.showBanner;
  c.host.showBanner = (kind, text) => banners.push(text);
  const reads = () => chain.commands.filter((m) => m.cmd === "account").length;
  const before = reads();
  chain.drop = "account"; // the read waits for an answer that does not come
  delete c.snaps[id];
  delete c.seen[id];
  notify();
  await waitFor("a read in flight", () => reads() > before);
  // What a close does to this state: a new number, and the Worker closes with its calls.
  const opened = c.opened;
  c.opened = opened + 1;
  c.worker.close();
  Object.assign(c, { worker: null, inited: null });
  await new Promise((done) => setTimeout(done, 300));
  assert.deepEqual(banners, [], "no banner of the closed wallet");
  assert.equal(c.readFails[key], undefined, "and no count in the next wallet state");
  chain.drop = null;
  c.opened = opened;
  c.worker?.close(); // a read that started meanwhile belongs to the other number
  Object.assign(c, { worker: null, inited: null });
  notify();
  await waitFor("the read again", () => c.snaps[id] !== undefined, 30000);
  c.host.showBanner = banner;
}
step("a read of a wallet that closed shows no banner and writes no count");

// ── One payment: two approvals, the digest signed, the execute with a fresh proof ──
{
  const id = cur.id;
  await approve(c, ssOf(id), 1);
  const entry = savedNonces(c, 1, id);
  const [u] = G.pay.inputs;
  const pair = { first: u.nullifier, salt: G.pay.salt };
  assert.deepEqual(entry.spend?.pair, pair, "the saved approval keeps the pair of the proof");
  await waitFor("the screen of seat 2", () => reviewOf(c, ssOf(id), 2).ok);
  const review = reviewOf(c, ssOf(id), 2);
  const said = readVerdict(review.verdict);
  assert.equal(said.commitment, ssOf(id).body.slice(0, 64));
  assert.equal(entry.digest, said.digest, "the nonces are saved under the approval digest");
  const bodyHash = createHash("sha256").update(Buffer.from(ssOf(id).body, "hex")).digest("hex");
  assert.equal(solOf(1).bodies?.[said.commitment], bodyHash, "one body per commitment is kept");
  const seen = await deviceSeen(c, ssOf(id));
  assert.deepEqual(seen.approved, [{ commitment: said.commitment, body: bodyHash }], "seen bodies");
  assert.ok(seen.account.data.endsWith(ssOf(id).body), "the device read the proposal account");
  // The proposal names the account and the body that the payment gives, or no seat approves it.
  const flip = (hex) => (hex[0] === "a" ? "b" : "a") + hex.slice(1);
  for (const field of ["account", "body"]) {
    const other = { ...ssOf(id), [field]: flip(ssOf(id)[field]) };
    assert.match(reviewOf(c, other, 2).why ?? "", /another account or body/, "another " + field);
  }
  // The screen of a payment: the costs in public SOL, the proposal account and the public link.
  const rows = rowsOf(id);
  assert.match(rows["What it does"], /^Pays SOL from the shielded balance of the group/);
  assert.match(rows["What it does"], /hides the amount, but it shows the owner key of the payee/);
  assert.equal(rows["Program address of the group"], base58(G.group.pda));
  assert.equal(rows.Amount, "0.002 SOL");
  assert.match(textOf(marked("amount-" + id)[0]), /^Private payment 0\.002 SOL /,
    "the amount that the checker bound, above the rows");
  const fees = "0.000005 SOL at the proposal, 0.000010162 SOL at the execute.";
  assert.equal(rows["Network fees"], fees, "two signatures and the tree fee at the execute");
  assert.ok(rows.Public.includes(LINK_TEXT), "the screen says that the fee address links");
  const card = findAll(solView({ ...c, host: { ...c.host, el: node } }, (fn) => fn, {}),
    (n) => n.attrs["data-session"] === id)[0];
  const order = findAll(card, (n) => n.attrs["data-sol"] === "amount-" + id
    || n.attrs["data-sol"] === "review-" + id || n.attrs["data-sol"] === "steps-" + id)
    .map((n) => n.attrs["data-sol"]);
  assert.deepEqual(order, ["amount-" + id, "review-" + id, "steps-" + id],
    "the verified amount and payment consequences precede lifecycle progress");
  const mainRows = findAll(marked("review-" + id)[0], (n) => n.tag === "dl")[0];
  assert.ok(textOf(mainRows).includes(fees) && textOf(mainRows).includes(LINK_TEXT),
    "network costs and public-link consequences remain outside collapsed technical details");
  const rent =
    "0.00135636 SOL, back to device 1 at the execute, or after the expiry with the card " +
    '"Rent of old proposals".';
  assert.equal(rows["Proposal rent"], rent);
  assert.equal(rows["Proposal account"], base58(ssOf(id).account) + " ↗");
  const links = findAll(marked("review-" + id)[0], (n) => n.tag === "a").map((n) => n.attrs);
  const explorer = "https://explorer.solana.com/address/" + base58(ssOf(id).account);
  const link = { href: explorer + "?cluster=devnet", target: "_blank", rel: "noopener" };
  assert.deepEqual(links, [link], "the proposal account links to the explorer");
  assert.match(rows["Check the payee"], /^Compare the Payee with the program address/);
  const part = /This checks only the first part of the shielded address\.$/;
  assert.match(rows["Check the payee"], part, "the S15 limit is on the screen");
  assert.equal(rows["Create paid by device 1"], feeAddress(1), "the proposer paid the create only");
  assert.match(textOf(marked("pay-cost")[0]), /pays 0\.000005 SOL .* holds 0\.00135636 SOL/);
  assert.ok(textOf(marked("fee-text")[0]).includes(LINK_TEXT), "the fund card says it too");
  // Each screen says what is public and what Helius sees (SOL-12), and the details name the
  // keys of the pool that sit outside the group (SOL-11).
  assert.equal(rows.Helius, PROVER_TEXT, "the screen of a payment names the hosted prover");
  assert.match(rows.Public, /^The owner key of the payee becomes public\. /, "the payee is public");
  const shown = (mark) => textOf(marked(mark)[0]);
  const PUBLIC = [/A deposit shows its sender and amount on chain\. A withdrawal shows its/,
    /A private payment hides its amount, but it shows the owner key of the payee\./,
    /fee address of each device that pays/, /Helius sees that you use Zigs, your IP address/,
    /link this wallet to these addresses by timing/];
  for (const re of PUBLIC) assert.match(shown("public-text"), re);
  assert.match(shown("sync-text"), /and the group key\. So Helius sees these keys with your IP/);
  assert.equal(shown("pay-prover"), PROVER_TEXT, "the pay card");
  assert.match(PROVER_TEXT, /the payee, the amount and the notes that the payment spends\./);
  assert.match(PROVER_TEXT, /the secret that links each spend to its notes/);
  assert.match(shown("send-public"), /hides the amount, but it shows the owner key of the payee/);
  assert.match(shown("fee-text"), /asks Helius for the balance of this address with your IP/);
  assert.match(shown("rent"),
    /The cancel is public.*"Find reclaimable rent" asks Helius .* your IP/);
  assert.match(shown("add-sol-text"), /amount and the sender are public.*IP address/);
  assert.equal(shown("pool-upgrade"), "2kgbLowvCQuMWxDKbHUZAURycziuRrvmtTuDEYMGMRsj");
  assert.equal(shown("pool-protocol"), "263Kgjft9NezaYTspFquMbAhgRf7xfAiyusaweLowdXo");
  const CUSTODY = new RegExp("outside the group.*The upgrade key is a signing key.*replace the " +
    "pool program.*needs 2 of its 5 keys.*pause the trees.*set the fees of the pool and change " +
    "its other authorities, but not the upgrade key");
  assert.match(shown("custody-text"), CUSTODY);
  assert.deepEqual(executorsOf(c, ssOf(id)), [1, 2, 3], "the proposing seat executes first");
  assert.deepEqual(executorsOf(c, { ...ssOf(id), by: 3 }), [3, 1, 2], "whichever seat proposed");
  await approve(c, ssOf(id), 2);
  await waitStatus(id, "sent");
  const ss = ssOf(id);
  assert.ok(/^[0-9a-f]{128}$/.test(ss.signature), "the approval signature");
  assert.ok(verifies(G.group.key, bytesOf(said.digest), bytesOf(ss.signature)));
  const landed = chain.landed.find((x) => x.signature === ss.txId);
  assert.ok(landed, "the execute landed with the id of the sent mark");
  assert.equal(landed.sigs.length, 1, "the executor signs alone: the group signs no message");
  assert.ok(verifies(feeOf(c, 1).key, bytesOf(landed.message), bytesOf(landed.sigs[0])));
  const fresh = transactOf(G.pay, decodeIntent(ss.intent).expiry, { proof: "01", root: 201 });
  assert.ok(landed.message.includes(fresh.slice(2)), "the execute carries the fresh proof");
  assert.equal(chain.accounts.has(base58(ss.account)), false, "the execute closed the account");
  assert.equal(cur.reproofs, 1, "one fresh proof");
  const [result] = marked("result").filter((n) => textOf(n).includes(ss.txId));
  const tx = findAll(result, (n) => n.tag === "a")[0].attrs.href;
  assert.equal(tx, "https://explorer.solana.com/tx/" + ss.txId + "?cluster=devnet");
  const note = /explorer\.solana\.com in a new tab\. That site is not Zigs: it sees the id/;
  assert.match(textOf(marked("explorer-text")[0]), note, "the list says what the link shows");
  c.added = { status: "confirmed", amount: 10_000_000n, seat: 1, txId: ss.txId };
  const notes = () => marked("explorer-text").length;
  const withLine = notes();
  c.added = null;
  assert.equal(notes(), withLine - 1, "the Add SOL line has its explorer note");
  c.added = { status: "confirmed", amount: 10_000_000n, seat: 1, txId: ss.txId };
  const [added] = marked("added");
  assert.equal(findAll(added, (n) => n.tag === "a")[0].attrs.href, tx, "Add SOL links its id");
  c.added = null;
}
step("two seats approve the digest once, and the proposing seat executes a fresh proof");

// ── SOL-4: with the switch on, the approvals path proves on the device, and stays so ──
{
  const shown = (mark) => textOf(marked(mark)[0]);
  c.viewed = true; // the tab shows this wallet, so the device check may start
  assert.ok(chain.gates.length > 0, "the earlier proofs asked the page first");
  assert.ok(chain.gates.every((mode) => mode === "hosted"), "a proof with the switch off");
  // Seat 2 turns the switch on: the signed document that turnOnLocal writes.
  const fields = { local: true, cluster: "devnet", at: Date.now() };
  const doc = await c.host.signedDoc(gid, "solprove/2", 2, fields);
  await c.host.sdb.doc(path(gid, "solprove/2")).set(doc);
  await waitFor("the switch is on", () => provesLocally(c));
  assert.equal(shown("pay-prover"), PROVER_LOCAL, "the pay card says that the group proves here");
  const local = /makes its proofs on its devices, so they give Helius neither/;
  assert.match(shown("public-text"), local);
  await waitFor("every seat pins it", () => [1, 2, 3].every((i) => solOf(i).proveLocal === true));
  const docs = () => [1, 2, 3].every((i) => data.has(path(gid, "solprove/" + i)));
  await waitFor("every seat of this browser writes its document", docs);
  await waitFor("the device check", () => [1, 2, 3].every((i) => solOf(i).proveCheck?.ok));
  assert.match(shown("prove-check-1"), /this browser made a test proof in 3\.1 s/);
  await forgetPairs();
  chain.prepared = preparedPay;
  chain.utxos = [utxoOf(G.pay)];
  chain.gates.length = 0;
  cur.id = await proposedPay();
  await waitFor("the screen of seat 2", () => reviewOf(c, ssOf(cur.id), 2).ok);
  assert.equal(rowsOf(cur.id).Helius, PROVER_ROW_LOCAL, "the screen of the payment says it too");
  await approve(c, ssOf(cur.id), 1);
  await approve(c, ssOf(cur.id), 2);
  await waitStatus(cur.id, "sent");
  assert.deepEqual(chain.gates, ["local", "local"], "the proof and the fresh proof, here");
  assert.ok(chain.landed.some((x) => x.signature === ssOf(cur.id).txId), "the execute landed");
}
step("SOL-4 with the switch on, prepare and the fresh proof of the execute run on the device");

// ── SOL-4: the gate fails closed, and the pin outlives the documents of the server ──
{
  hook.lease = (p) => !p.includes("/solgate/");
  for (const i of [1, 2, 3]) await putSol(c.host, gid, i, { proveLocal: null });
  // The documents still stand: a lease that is not free does not matter, the barrier answered.
  assert.deepEqual(await gateAnswer(c), { mode: "local" }, "the documents turn it on again");
  await waitFor("pinned again", () => solOf(1).proveLocal === true);
  // The server loses every document: the pin of this browser keeps the switch on.
  for (const i of [1, 2, 3]) data.delete(path(gid, "solprove/" + i));
  notify();
  assert.deepEqual(await gateAnswer(c), { mode: "local" }, "the pin holds without the server");
  // A browser with no pin that cannot reach the server proves nothing.
  for (const i of [1, 2, 3]) await putSol(c.host, gid, i, { proveLocal: null });
  const acquire = c.host.sdb.doc;
  c.host.sdb.doc = (p) => ({ ...acquire(p), acquire: async () => { throw new Error("offline"); } });
  try {
    assert.deepEqual(await gateAnswer(c), { refuse: UNREAD }, "no server, no proof");
  } finally {
    c.host.sdb.doc = acquire;
    hook.lease = () => true;
  }
}
step("SOL-4 the gate answers local with the pin alone, and refuses when it cannot read the server");

// ── SOL-4 after a pool upgrade: a local group names it first, and proves here ──
{
  for (const i of [1, 2, 3]) await putSol(c.host, gid, i, { proveLocal: true });
  await forgetPairs();
  chain.prepared = preparedPay;
  chain.utxos = [utxoOf(G.pay)];
  chain.gates.length = 0;
  cur.id = await proposedPay();
  // Helius redeployed the pool: its verifier refuses the proof of the old keys.
  chain.poolSlot = "600000000";
  chain.refuse = JSON.stringify({ InstructionError: [1, { Custom: 6000 }] });
  try {
    await approve(c, ssOf(cur.id), 1);
    await approve(c, ssOf(cur.id), 2);
    const said = () => c.execErrors[cur.id] ?? "";
    const moved = () => said().startsWith("Helius changed the pool. ");
    await waitFor("the text of the moved pool", moved);
    assert.match(said(), /The network refused the execute: .*6000/, "the refusal follows");
  } finally {
    chain.refuse = null;
    chain.poolSlot = POOL_SLOT;
  }
  assert.ok(chain.gates.length >= 2, "the proof and the fresh proof asked the page");
  assert.deepEqual(chain.gates.filter((mode) => mode !== "local"), [], "a proof left the device");
}
step("SOL-4 after a pool upgrade the execute of a local group names it first, and proves here");
console.log("sol-pay: ok");
process.exit(0);
