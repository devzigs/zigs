// Private payments of the program design (ZOLANA.md 7.2) against the fake chain, with the test
// group of sol-group.json, for which the TS SDK built the payments (sol-fixture.mjs):
//  - the snapshot that an approving device reads for itself (web/sol/spend.js), for a payment (the
//    PDA identity, the pair of the first proof) and for the move of the beta funds (the group key,
//    the pair of the message);
//  - one payment through propose (the proposal account is created on chain first), approve by
//    two seats, the approval digest signed with FROST, and the execute with a fresh proof that
//    the fake chain accepts only with the approval signature over the digest of the stored body;
//  - a stale proof at the execute is proved again; an account that another device executed is
//    read back; an expired payment ends;
//  - the move of the beta funds: the last payment with a nonce, signed by the fee key and the
//    group key.
// Run: node web/test/sol-pay.mjs   (Node 24)
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { approve, deviceSeen, reviewOf } from "../sol/approve.js";
import { agreement } from "../sol/ceremony.js";
import { base58, keyOfBase58 } from "../sol/docs.js";
import { EXECUTE_TRIES, executorsOf, forgetBalances, tryAgain } from "../sol/execute.js";
import {
  ZERO_KEY,
  bytesOf,
  decodeIntent,
  intentHex,
  planHex,
  readVerdict,
} from "../sol/intent.js";
import { savedNonces, saveNonces } from "../sol/nonces.js";
import { feeOf } from "../sol/fee.js";
import { putSol } from "../sol/secrets.js";
import { syncSolana } from "../sol/session.js";
import { deviceSpend } from "../sol/spend.js";
import { gateAnswer, provesLocally, UNREAD } from "../sol/localprove.js";
import { LINK_TEXT, PROVER_LOCAL, PROVER_ROW_LOCAL, PROVER_TEXT } from "../sol/payview.js";
import {
  heldLamports,
  heldNotes,
  partFields,
  readSolSession,
  writePart,
} from "../sol/sessions.js";
import { selectInputs } from "../sol/transfer.js";
import { solView } from "../sol/view.js";
import { FRONT_RUN, verifies } from "./sol-chain.mjs";
import { G, preparedOf, transactOf, useTestGroup, utxoOf } from "./sol-fixture.mjs";
import {
  W,
  c,
  chain,
  data,
  feeAddress,
  gid,
  hook,
  notify,
  path,
  proposed,
  solOf,
  ssOf,
  waitFor,
  waitStatus,
} from "./sol-setup.mjs";
import { step } from "./sol-vector.mjs";

const SOL_MINT = "1".repeat(32);
// The tab, as a tree of plain nodes, to read what the screens show.
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
const marked = (name) =>
  findAll(solView({ ...c, host: { ...c.host, el: node } }, (fn) => fn, {}), (n) =>
    n.attrs["data-sol"] === name,
  );
const rowsOf = (id) => {
  const [dl] = marked("review-" + id);
  const out = {};
  for (let i = 0; i < dl.kids.length; i += 2) out[textOf(dl.kids[i])] = textOf(dl.kids[i + 1]);
  return out;
};
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
const dropSessions = async (ids) => {
  for (const key of data.keys()) {
    if (ids.some((id) => key.includes("solsessions/" + id))) data.delete(key);
  }
  notify();
  await waitFor("the sessions go", () => !c.sessions.some((x) => ids.includes(x.id)));
};

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

// ── The test group, and its payment ──
await useTestGroup(c, { gid, data, notify, waitFor, path, W, chain });
for (const i of [1, 2, 3]) chain.balances.set(feeAddress(i), 50_000_000n);
const PAID = G.pay.outputs.find((o) => o.role === "payee");
const done = agreement(c).done;
assert.equal(done.pda, G.group.pda, "the seats agree on the PDA identity");

/** The answer of the Worker to prepare of a payment: it proves what the person typed. */
function preparedPay(args) {
  assert.equal(args.kind, "pay", "a payment spends the PDA identity");
  assert.equal(args.recipient, G.payee.address, "the Worker proves for the typed payee");
  assert.equal(args.amount, PAID.amount, "the Worker proves the typed amount");
  assert.equal(args.payer, feeAddress(1), "the fee key of the proposing seat is the payer");
  return preparedOf(G.pay, args);
}
let reproofs = 0;
chain.utxos = [utxoOf(G.pay)];
chain.prepared = preparedPay;
chain.reproved = (args) => {
  reproofs += 1;
  assert.equal(args.recipient, G.payee.address);
  const expiry = decodeIntent(ssOf(current).intent).expiry;
  const proof = (reproofs % 256).toString(16).padStart(2, "0");
  return { data: transactOf(G.pay, expiry, { proof, root: 200 + reproofs }) };
};
let current = null;
// The fixture has one salt and one input, and a device refuses a pair that another proposal holds
// on the group server or in its own history (rule salt-reused). The fixture has one input for
// every payment too, so an ended payment over it would end the next one (another payment spent
// its inputs). So each payment here starts as a browser with no salt history would, on a server
// where the earlier payments and moves are gone.
const forgetPairs = async () => {
  for (const i of [1, 2, 3]) await putSol(c.host, gid, i, { salts: null });
  const ended = c.sessions.filter((ss) => ["sent", "failed"].includes(ss.status));
  const spends = c.sessions.filter((ss) => ss.transact !== undefined || ss.plan !== undefined);
  await dropSessions([...new Set([...ended, ...spends].map((x) => x.id))]);
};
// The page and the program judge an expiry by the clock: `later` moves the clock of this test.
const realNow = Date.now;
const later = (ms) => (Date.now = () => realNow() + ms);
const DAY = 24 * 3600 * 1000;
// The Ed25519 instruction of the approval of `ss`, as an execute carries it.
const APPROVAL_HEAD = "01003000ffff1000ffff70002000ffff";
const approvalOf = (ss) => APPROVAL_HEAD + G.group.key + ss.signature + ss.digest;
// Two payments of the fixture in one second have one expiry, so one body and one digest, and a
// seat signs a digest once. Each payment here starts in a second of its own.
let lastSecond = 0;
const tick = () => new Promise((go) => setTimeout(go, 50));
const proposedPay = async () => {
  while (Math.floor(Date.now() / 1000) <= lastSecond) await tick();
  const id = await proposed("pay", { recipient: G.payee.address, amount: "0.002" });
  lastSecond = Math.floor(Date.now() / 1000); // the page took the expiry before this
  return id;
};

// ── No screen and no approval before the device has read its wallet and the account ──
{
  const id = await proposedPay();
  current = id;
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
  const id = current;
  const address = base58(ssOf(id).account);
  const stored = chain.accounts.get(address);
  chain.accounts.delete(address);
  delete c.seen[id];
  delete c.snaps[id];
  // S17: while the device reads, the card shows a wait, not a refusal.
  assert.equal(reviewOf(c, ssOf(id), 2).waiting, true, "reading is a wait");
  const view = solView({ ...c, host: { ...c.host, el: node } }, (fn) => fn, {});
  const card = findAll(view, (n) => n.attrs["data-session"] === id)[0];
  const marks = (name) => findAll(card, (n) => n.attrs["data-sol"] === name).length;
  assert.ok(marks("reading") >= 1, "the card says that the device reads its wallet");
  assert.equal(marks("refusal"), 0, "and shows no alert");
  const buttons = () => marked("approve-" + id + "-2").length;
  assert.equal(buttons(), 0, "and no Approve button before the review shows");
  notify();
  await waitFor("a read with no account", () => c.seen[id]?.account === null);
  assert.equal(reviewOf(c, ssOf(id), 2).ok, false, "no account: no approval yet");
  chain.accounts.set(address, stored);
  await waitFor("the account read again", () => reviewOf(c, ssOf(id), 2).ok, 30000);
  assert.equal(buttons(), 1, "the Approve button comes with the review");
}
step("a device that read no proposal account reads it again, with no click");

// ── A missing account is a wait, a click keeps the re-read, an expired proposal has no button
{
  const id = current;
  const address = base58(ssOf(id).account);
  const stored = chain.accounts.get(address);
  const marks = (name) => {
    const view = solView({ ...c, host: { ...c.host, el: node } }, (fn) => fn, {});
    const card = findAll(view, (n) => n.attrs["data-session"] === id)[0];
    return findAll(card, (n) => String(n.attrs["data-sol"]).startsWith(name)).length;
  };
  chain.accounts.delete(address);
  delete c.seen[id];
  delete c.snaps[id];
  notify();
  await waitFor("a read with no account", () => c.seen[id]?.account === null);
  assert.equal(reviewOf(c, ssOf(id), 2).waiting, true, "a missing account is a wait at first");
  assert.deepEqual([marks("refusal"), marks("approve-")], [0, 0], "no alert and no button");
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
  c.seen[id].missedSince = since;
  chain.accounts.set(address, stored);
  await waitFor("the account read again", () => reviewOf(c, ssOf(id), 2).ok, 30000);
  // After the expiry no seat can approve, also before the page ends the proposal (600 s later).
  const ahead = (Number(ssOf(id).expiry) + 100) * 1000 - Date.now();
  later(ahead);
  const shown = [marks("expired"), marks("approve-"), marks("refusal"), marks("review-")];
  Date.now = realNow;
  assert.deepEqual(shown, [1, 0, 0, 0], "an expired proposal shows one line and no button");
  assert.ok(marks("approve-") > 0, "control: the buttons before the expiry");
}
step("a missing account is a wait, a click keeps the re-read, and an expiry hides Approve");

// ── S5: a failed wallet read waits 3 s, then 6 s, shows one banner; a success clears it ──
{
  const id = current;
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

// ── One payment: two approvals, the digest signed, the execute with a fresh proof ──
{
  const id = current;
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
  const fees = "0.000005 SOL at the proposal, 0.000010162 SOL at the execute.";
  assert.equal(rows["Network fees"], fees, "two signatures and the tree fee at the execute");
  const rent =
    "0.00135636 SOL, back to seat 1 at the execute, or after the expiry with the card " +
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
  assert.ok(rows.Public.includes(LINK_TEXT), "the screen says that the fee address links");
  assert.equal(rows["Create paid by seat 1"], feeAddress(1), "the proposer paid the create only");
  assert.match(textOf(marked("pay-cost")[0]), /pays 0\.000005 SOL .* holds 0\.00135636 SOL/);
  assert.ok(textOf(marked("fee-text")[0]).includes(LINK_TEXT), "the fund card says it too");
  // Each screen says what is public and what Helius sees (SOL-12), and the details name the
  // keys of the pool that sit outside the group (SOL-11).
  assert.equal(rows.Helius, PROVER_TEXT, "the screen of a payment names the hosted prover");
  assert.match(rows.Public, /^The owner key of the payee becomes public\. /, "the payee is public");
  const shown = (mark) => textOf(marked(mark)[0]);
  const PUBLIC = [/A deposit shows its sender and amount on chain\. A withdrawal shows its/,
    /A private payment hides its amount, but it shows the owner key of the payee\./,
    /fee address of each seat that pays/, /Helius sees that you use Zigs, your IP address/,
    /link this wallet to these addresses by timing/];
  for (const re of PUBLIC) assert.match(shown("public-text"), re);
  assert.match(shown("sync-text"), /and the group key\. So Helius sees these keys with your IP/);
  assert.equal(shown("pay-prover"), PROVER_TEXT, "the pay card");
  assert.match(PROVER_TEXT, /the payee, the amount and the notes that the payment spends\./);
  assert.match(PROVER_TEXT, /the secret that links each spend to its notes/);
  assert.match(shown("send-public"), /hides the amount, but it shows the owner key of the payee/);
  assert.match(shown("fee-text"), /asks Helius for the balance of this address with your IP/);
  assert.match(shown("rent"), /The cancel is public.*"Look for rent" asks Helius .* your IP/);
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
  assert.equal(reproofs, 1, "one fresh proof");
  const [result] = marked("result").filter((n) => textOf(n).includes(ss.txId));
  const tx = findAll(result, (n) => n.tag === "a")[0].attrs.href;
  assert.equal(tx, "https://explorer.solana.com/tx/" + ss.txId + "?cluster=devnet");
  c.added = { status: "confirmed", amount: 10_000_000n, seat: 1, txId: ss.txId };
  const [added] = marked("added");
  assert.equal(findAll(added, (n) => n.tag === "a")[0].attrs.href, tx, "Add SOL links its id");
  c.added = null;
}
step("two seats approve the digest once, and the proposing seat executes a fresh proof");

// ── A reused salt of another proposal on the group server: refused, after a restore too ──
{
  await forgetPairs();
  const id = await proposedPay();
  current = id;
  // A copy of the payment under another id holds the same first nullifier and salt.
  const copy = { ...partFields("proposal", ssOf(id)), createdAt: Date.now() };
  await writePart(c, "reused", "proposal", copy, { seat: 1, create: true });
  await waitFor("the copy", () => ssOf("reused"));
  // A restore: no seat of this browser has a salt history or an approved body.
  for (const i of [1, 2, 3]) await putSol(c.host, gid, i, { salts: null, bodies: null });
  const pair = { first: G.pay.inputs[0].nullifier, salt: G.pay.salt };
  const spend = await deviceSpend(c, ssOf("reused"));
  assert.deepEqual(spend.salts, [pair], "the pair of the other proposal on the group server");
  const REUSED = /same first nullifier and salt/;
  await assert.rejects(() => approve(c, ssOf("reused"), 2), REUSED, "a restored seat refuses it");
  await assert.rejects(() => approve(c, ssOf(id), 3), REUSED, "the copy stops the open one too");
  await assert.rejects(() => proposedPay(), REUSED, "the proposer refuses its own draft too");
  // With the copy gone, no other proposal holds the pair: it passes, and the payment executes.
  await dropSessions(["reused"]);
  const own = await deviceSpend(c, ssOf(id));
  assert.deepEqual(own.salts, [], "the pair of the session itself is no other proposal");
  await approve(c, ssOf(id), 2);
  await approve(c, ssOf(id), 3);
  await waitStatus(id, "sent");
}
step("a seat refuses a salt of another proposal on the group server, also after a restore");

// ── A stale proof at the execute is proved again, with the same approval ──
{
  chain.prepared = preparedPay;
  await forgetPairs();
  const id = await proposedPay();
  current = id;
  await approve(c, ssOf(id), 1);
  chain.refuse = JSON.stringify({ InstructionError: [1, { Custom: 7008 }] });
  const tries = reproofs;
  await approve(c, ssOf(id), 3);
  await waitFor("a stale try", () => (c.tries[id] ?? 0) >= 1);
  assert.match(c.execErrors[id], /went stale/);
  chain.refuse = null;
  await waitStatus(id, "sent");
  assert.ok(reproofs >= tries + 2, "proved again after the stale root");
  assert.equal(ssOf(id).signature.length, 128, "with the one approval of the group");
}
step("a stale root at the execute is proved again, and the one approval still holds");

// ── Only a seat whose fee address can pay executes (S3); the lease is renewed ──
{
  await forgetPairs();
  const id = await proposedPay();
  current = id;
  const kept = [1, 2, 3].map((i) => chain.balances.get(feeAddress(i)));
  const start = chain.commands.length;
  const cmds = () => chain.commands.slice(start).map((m) => m.cmd);
  // Every execute lease of this session (60 s; the publish of a FROST package takes 10 s), with
  // the number of Worker commands before it. The second one (the renewal before the send of the
  // funded try) is refused once.
  const doc = c.host.sdb.doc;
  const leases = [];
  c.host.sdb.doc = (path) => {
    const ref = doc(path);
    if (!path.endsWith("/" + id)) return ref;
    const spy = Object.create(ref);
    spy.acquire = async (o) => {
      if (o.ttlMs !== 60000) return ref.acquire(o);
      leases.push({ at: cmds().length });
      return leases.length === 2 ? { acquired: false } : ref.acquire(o);
    };
    return spy;
  };
  for (const i of [1, 2, 3]) chain.balances.set(feeAddress(i), 999_999n);
  forgetBalances(); // the earlier payments read these addresses funded
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitFor("the balance reads", () => cmds().includes("balance"));
  await new Promise((go) => setTimeout(go, 1000));
  assert.equal(ssOf(id).status, "signed", "no seat of this browser can pay: no execute");
  assert.equal(c.tries[id] ?? 0, 0, "no try is counted");
  assert.equal(c.execErrors[id], undefined, "and no banner shows");
  assert.equal(leases.length, 0, "a tab with no funded seat takes no lease");
  const reads = cmds().filter((x) => x === "balance").length;
  assert.ok(reads <= 3, reads + " balance reads: one for each seat, then a wait");
  chain.balances.set(feeAddress(3), 1_000_000n);
  await waitStatus(id, "sent", 90000);
  c.host.sdb.doc = doc;
  const landed = chain.landed.find((x) => x.signature === ssOf(id).txId);
  assert.ok(verifies(feeOf(c, 3).key, bytesOf(landed.message), bytesOf(landed.sigs[0])));
  const all = cmds();
  assert.equal(all.filter((x) => x === "send").length, 1, "one send");
  const sendAt = all.indexOf("send");
  const tests = all.flatMap((x, n) => (x === "simulate" ? [n] : []));
  assert.ok(tests.length >= 2 && sendAt > tests[1], "the refused renewal sent nothing");
  const renewed = leases.slice(2).filter((l) => l.at > tests.at(-1) && l.at <= sendAt);
  assert.equal(renewed.length, 1, "the lease is taken again after the test run, before send");
  assert.ok(leases.some((l) => l.at > sendAt), "and again after the send, for the confirm");
  [1, 2, 3].forEach((i, n) => chain.balances.set(feeAddress(i), kept[n]));
}
step("only a funded seat executes: the others skip with no banner, and the lease is renewed");

// ── A withdrawal to a public address (SOL-32): the leg goes back into every proof, the screen
// shows the recipient and the amount that the checker bound, and the execute pays through the SOL
// interface (the fake program checks the settlement accounts and the commitment) ──
const TO = G.withdraw.withdraw.recipient;
const proposedWithdrawal = async (recipient = base58(TO)) => {
  while (Math.floor(Date.now() / 1000) <= lastSecond) await tick();
  const id = await proposed("withdraw", { recipient, amount: "0.002" });
  lastSecond = Math.floor(Date.now() / 1000);
  return id;
};
{
  await forgetPairs();
  chain.utxos = [utxoOf(G.withdraw)];
  chain.prepared = (args) => {
    assert.equal(args.kind, "withdraw", "a withdrawal spends the PDA identity");
    assert.equal(args.recipient, TO, "the Worker proves for the typed recipient");
    assert.equal(args.amount, G.withdraw.withdraw.amount, "and the typed amount");
    return preparedOf(G.withdraw, args);
  };
  const reprovedPay = chain.reproved;
  chain.reproved = (args) => {
    const leg = [args.recipient, args.withdraw];
    assert.deepEqual(leg, [TO, G.withdraw.withdraw.amount], "the leg goes back into the proof");
    const expiry = decodeIntent(ssOf(current).intent).expiry;
    return { data: transactOf(G.withdraw, expiry, { proof: "05", root: 300 }) };
  };
  // The typed address may have spaces around it.
  const id = await proposedWithdrawal(" " + base58(TO) + " ");
  current = id;
  const intent = decodeIntent(ssOf(id).intent);
  assert.deepEqual([intent.kind, intent.recipient, intent.amount], ["withdraw", TO, 2_000_000n]);
  // The device reads its wallet, the account and the recipient for the review, with no click.
  await waitFor("the screen of seat 2", () => reviewOf(c, ssOf(id), 2).ok);
  const rows = rowsOf(id);
  assert.equal(rows["Recipient (public)"], base58(TO), "the recipient that the checker bound");
  assert.equal(rows["Amount (public)"], "0.002 SOL", "the leg that the checker bound");
  assert.match(rows["What it does"], /to a public Solana address/);
  assert.match(rows.Public, /^Recipient, asset and amount are public\. /, "the text of section 2");
  assert.equal(rows.Helius, PROVER_TEXT, "the screen of a withdrawal names the hosted prover");
  assert.equal(rows["Create paid by seat 1"], feeAddress(1));
  assert.equal(rows.Change, "0.003 SOL stays with the group.", "the change of the withdrawal");
  // The forms of the tab: each button proposes its kind with the typed address and amount.
  const asked = [];
  const view = solView({ ...c, host: { ...c.host, el: node } }, (fn) => fn, {
    propose: (kind, args) => asked.push([kind, args]),
  });
  const one = (mark) => findAll(view, (n) => n.attrs["data-sol"] === mark)[0];
  const card = findAll(view, (n) => n.attrs["data-session"] === id)[0];
  assert.match(textOf(card), /Withdraw to a public address/, "the card of the session");
  const said = "Recipient, asset and amount are public.";
  assert.equal(textOf(one("withdraw-public")), said, "the text of ZOLANA.md section 2");
  Object.assign(one("withdraw-to"), { value: base58(TO) });
  Object.assign(one("withdraw-amount"), { value: "0.002" });
  one("withdraw").attrs.onclick();
  Object.assign(one("send-to"), { value: G.payee.address });
  Object.assign(one("send-amount"), { value: "0.001" });
  one("send").attrs.onclick();
  assert.deepEqual(asked, [
    ["withdraw", { recipient: base58(TO), amount: "0.002" }],
    ["pay", { recipient: G.payee.address, amount: "0.001" }],
  ]);
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitStatus(id, "sent");
  const landed = chain.landed.find((x) => x.signature === ssOf(id).txId);
  assert.ok(landed, "the execute of the withdrawal landed");
  assert.ok(landed.message.includes(TO), "the execute names the recipient");
  assert.equal(chain.accounts.has(base58(ssOf(id).account)), false, "and closed the account");
  chain.reproved = reprovedPay;
}
step("a withdrawal shows its public recipient and amount, and its execute pays via the pool");

// ── A recipient that could never take the SOL: the proposer and the approvers refuse it ──
{
  await forgetPairs();
  // The Worker proves for any typed key: the checker of the device is what refuses.
  chain.prepared = (args) => preparedOf(G.withdraw, args);
  await assert.rejects(() => proposedWithdrawal(base58(G.group.pda)), /no account of the pool/);
  await assert.rejects(() => proposedWithdrawal("not an address"), /Solana address of the/);
  assert.equal(keyOfBase58(base58(TO)), TO, "an address reads back as its key");
  assert.equal(keyOfBase58("1".repeat(33)), null, "33 zero bytes are no key");
  assert.equal(keyOfBase58("1".repeat(31)), null, "31 zero bytes are no key");
  const odd = "0f" + "11".repeat(31); // an odd number of hex digits before the pad
  assert.equal(keyOfBase58(base58(odd)), odd, "a key with a small first byte reads back");
  const zero = { recipient: base58(TO), amount: "0" };
  await assert.rejects(() => proposed("withdraw", zero), /Enter an amount of SOL/);
  // The proposer reads the recipient account too, and refuses one of a program.
  chain.accounts.set(base58(TO), { owner: "11".repeat(32), data: "" });
  await assert.rejects(() => proposedWithdrawal(), /ordinary System account/);
  // The checker gets the lamports, the executable flag and the rent minimum that the page read.
  const system = (lamports, executable = false) => ({
    owner: "00".repeat(32),
    lamports,
    executable,
  });
  chain.accounts.set(base58(TO), system("3000000", true));
  await assert.rejects(() => proposedWithdrawal(), /ordinary System account/);
  chain.rentFor = (space) => (space === "0" ? "3000000" : undefined);
  chain.accounts.delete(base58(TO));
  await assert.rejects(() => proposedWithdrawal(), /rent-exempt minimum/);
  // 1,000,000 lamports and the 2,000,000 of the leg reach the minimum of 3,000,000.
  chain.accounts.set(base58(TO), system("1000000"));
  const id = await proposedWithdrawal();
  chain.rentFor = undefined;
  chain.accounts.delete(base58(TO));
  current = id;
  // Then the recipient account becomes an account of a program: no seat approves the payment.
  chain.accounts.set(base58(TO), { owner: "11".repeat(32), data: "" });
  await assert.rejects(() => approve(c, ssOf(id), 2), /ordinary System account/);
  chain.accounts.delete(base58(TO));
  chain.utxos = [utxoOf(G.pay)];
  chain.prepared = preparedPay;
}
step("a withdrawal to an account of the group or of a program is refused by every device");

const pause = (ms) => new Promise((go) => setTimeout(go, ms));
const count = (cmd) => chain.commands.filter((m) => m.cmd === cmd).length;

// ── An execute that fails on chain is a counted try, not a sent mark ──
{
  await forgetPairs();
  const id = await proposedPay();
  current = id;
  chain.sendMode = "fail";
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitFor("a failed execute", () => /failed on chain/.test(c.execErrors[id] ?? ""));
  assert.equal(ssOf(id).status, "signed", "a failed execute is no sent mark");
  assert.ok(chain.accounts.has(base58(ssOf(id).account)), "the account and the approval stay");
  chain.sendMode = null;
  await waitStatus(id, "sent");
  const landed = chain.landed.some((x) => x.signature === ssOf(id).txId);
  assert.ok(landed, "the mark names the execute that landed");
}
step("an execute that fails on chain is tried again, and only a landed execute is marked");

// ── An execute that lands late: no second send while it may land, and the mark names it ──
{
  await forgetPairs();
  const id = await proposedPay();
  current = id;
  chain.sendMode = "late";
  const sent = count("send");
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitFor("the late execute", () => chain.late.length === 1);
  await pause(7000);
  assert.equal(count("send"), sent + 1, "no second execute while the first one may land");
  assert.equal(c.tries[id] ?? 0, 0, "an execute that may land is no counted try");
  chain.sendMode = null;
  chain.release();
  await waitStatus(id, "sent");
  assert.equal(ssOf(id).txId, chain.landed.at(-1).signature, "the execute that landed late");
  assert.equal(count("send"), sent + 1, "one execute in all");
}
step("an execute that lands late is not sent twice, and the mark names it");

// The fee addresses of the seats: all at `lamports`, or one amount for each seat.
const fund = (amounts) => {
  amounts.forEach((lamports, n) => chain.balances.set(feeAddress(n + 1), lamports));
  forgetBalances();
};
const FUNDED = [50_000_000n, 50_000_000n, 50_000_000n];

// ── A refused balance read is no empty seat: the card shows its text, and no try counts ──
{
  await forgetPairs();
  const id = await proposedPay();
  current = id;
  const refused = "Too many Helius calls. Wait a minute.";
  const card = () => textOf(solView({ ...c, host: { ...c.host, el: node } }, (fn) => fn, {}));
  chain.balances.get = () => {
    throw new Error(refused);
  };
  forgetBalances();
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitFor("the text of the refused reads", () => c.execErrors[id] === refused);
  assert.equal(ssOf(id).status, "signed", "no execute without a read of the balance");
  assert.equal(c.tries[id] ?? 0, 0, "a refused read counts no try");
  assert.ok(card().includes(refused), "the card shows the text of the Worker");
  delete chain.balances.get; // the reads work again
  await waitStatus(id, "sent", 90000);
  assert.equal(c.execErrors[id], undefined, "the text goes with the next good read");
  assert.equal(c.tries[id] ?? 0, 0, "and no try was counted");
}
step("a refused balance read shows its text, counts no try, and the next good read executes");

// ── A retry after a dropped send uses the seat that sent, not the first seat ──
{
  await forgetPairs();
  const id = await proposedPay();
  current = id;
  fund([0n, 0n, 5_000_000n]); // only seat 3 can pay
  chain.sendMode = "late";
  const sent = count("send");
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitFor("the send of seat 3", () => c.sending[id] !== undefined, 60000);
  assert.equal(c.sending[id].seat, 3, "the tab keeps the seat that sent");
  const poor = [];
  const watch = setInterval(() => poor.push(c.execErrors[id] ?? ""), 50);
  chain.late.splice(0); // the send is dropped: it never lands
  chain.sendMode = null;
  c.sending[id].at -= 200_000; // past the send window: the retry runs
  await waitStatus(id, "sent", 60000);
  clearInterval(watch);
  assert.ok(!poor.some((text) => /too little Devnet SOL/.test(text)), "no text of an empty seat");
  assert.equal(c.tries[id] ?? 0, 0, "the retry is no counted try");
  assert.equal(count("send"), sent + 2, "the dropped send, then the retry");
  const landed = chain.landed.find((x) => x.signature === ssOf(id).txId);
  assert.ok(verifies(feeOf(c, 3).key, bytesOf(landed.message), bytesOf(landed.sigs[0])));
  fund(FUNDED);
}
step("a retry after a dropped send uses the seat that sent it");

// ── A tab with no funded seat writes the mark of an execute that another device landed ──
{
  await forgetPairs();
  const id = await proposedPay();
  current = id;
  fund([0n, 0n, 0n]);
  const sent = count("send");
  const reads = count("balance");
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitFor("the look of the tab", () => count("balance") >= reads + 3);
  assert.equal(ssOf(id).status, "signed", "the account is open: nothing to mark yet");
  // Another device executed it: the account is a System account, the history holds the execute.
  const address = base58(ssOf(id).account);
  const executed = "3".repeat(88);
  const tx = Buffer.from("aa" + approvalOf(ssOf(id)), "hex").toString("base64");
  chain.accounts.set(address, { owner: "00".repeat(32), data: "" });
  chain.history.set(address, [
    { signature: executed, failed: false, slot: "14" },
    ...(chain.history.get(address) ?? []),
  ]);
  chain.txs.set(executed, { found: true, failed: false, tx });
  forgetBalances(); // the tab looks at the account once a minute: the next pass looks now
  await waitStatus(id, "sent", 60000);
  assert.equal(ssOf(id).txId, executed, "the transaction of the history");
  assert.equal(count("send"), sent, "the tab sent nothing");
  assert.equal(c.tries[id] ?? 0, 0, "and counted no try");
  fund(FUNDED);
}
step("a tab with no funded seat marks an execute that another device landed");

// ── An unfunded tab: a refused account read shows its text, no try, one read a minute ──
{
  await forgetPairs();
  const id = await proposedPay();
  current = id;
  fund([0n, 0n, 0n]);
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitFor("signed", () => ssOf(id).status === "signed");
  const refused = "Helius refused this website. Its key does not allow this domain.";
  const address = base58(ssOf(id).account);
  const get = chain.accounts.get;
  chain.accounts.get = function (key) {
    if (key === address) throw new Error(refused);
    return get.call(this, key);
  };
  forgetBalances();
  await waitFor("the text of the refused read", () => c.execErrors[id] === refused, 30000);
  assert.equal(c.tries[id] ?? 0, 0, "a refused account read counts no try");
  const reads = count("account");
  await new Promise((done) => setTimeout(done, 16_000)); // one more pass of the tab
  assert.equal(count("account"), reads, "no second account read within a minute");
  assert.equal(c.execErrors[id], refused, "the text stays between the reads");
  delete chain.accounts.get;
  fund(FUNDED);
  await waitStatus(id, "sent", 90000);
}
step("a tab with no funded seat shows a refused account read and reads once a minute");

// ── The lease of another device holds the execute back; the last try waits for a click ──
{
  await forgetPairs();
  const id = await proposedPay();
  current = id;
  // Another device holds the lease of the execute (the signing round has its own leases).
  hook.lease = (p) => !(p.endsWith("/" + id) && ssOf(id)?.status === "signed");
  const sims = count("simulate");
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitStatus(id, "signed");
  await pause(5000);
  assert.equal(count("simulate"), sims, "no execute while another device holds the lease");
  hook.lease = () => true;
  chain.refuse = "Custom 9999";
  await waitFor("the tries", () => (c.tries[id] ?? 0) >= EXECUTE_TRIES, 60000);
  const tried = count("simulate");
  await pause(5000);
  assert.equal(count("simulate"), tried, "no try after the last one without a click");
  assert.equal(marked("execute-" + id).length, 1, "the card offers to try again");
  chain.refuse = null;
  tryAgain(c, ssOf(id)); // the button of the card

  await waitStatus(id, "sent");
}
step("an execute waits for the lease of another device, and stops after its tries");

// ── Someone created the same body first: the page reads the account and takes it ──
{
  await forgetPairs();
  chain.frontRun = "other";
  await assert.rejects(() => proposedPay(), /"Custom":0\}/, "another body is no create");
  chain.frontRun = true;
  const id = await proposedPay();
  assert.equal(chain.frontRun, false, "the other create landed first");
  assert.equal(ssOf(id).createTx, FRONT_RUN, "the create of the account is the other one");
  assert.ok(chain.accounts.has(base58(ssOf(id).account)), "the account holds the body");
  // The other create lands after the test run of the page passed: the create of the page fails.
  // The next payment has the one salt of the fixture, so the open one goes first.
  await dropSessions([id]);
  chain.frontRun = "send";
  const raced = await proposedPay();
  assert.equal(chain.frontRun, false, "the other create landed at the send");
  assert.equal(ssOf(raced).createTx, FRONT_RUN, "a create that lost the race takes the other one");
}
step("a create that meets the same body in its account takes it; another body fails it");

// ── Two payments over one input: the second avoids it, an executed one ends the other ──
{
  await forgetPairs();
  const open = await proposedPay();
  // Two real payments over one input have two salts. The fixture has one, so the open payment
  // gets another one here (no seat approves it: its ciphertexts do not fit that salt).
  const other = transactOf({ ...G.pay, salt: "5a".repeat(16) }, ssOf(open).expiry);
  const moved = { ...partFields("proposal", ssOf(open)), transact: other };
  await writePart(c, open, "proposal", moved, { seat: 1 });
  await waitFor("the other salt", () => ssOf(open)?.transact === other);
  const id = await proposedPay();
  const asked = chain.commands.filter((m) => m.cmd === "prepare").at(-1).args;
  assert.deepEqual(asked.avoid, ssOf(open).inputIds, "the Worker avoids the open inputs");
  // S4: the page can name the open payments that hold the notes, and the end of each.
  const held = heldNotes(c.sessions, chain.utxos);
  assert.deepEqual(held.map((h) => h.id).sort(), [open, id].sort(), "both hold the one note");
  const note = BigInt(chain.utxos[0].amount);
  assert.deepEqual(held.map((h) => h.lamports), [note, note], "the amount of the held note");
  assert.equal(held[0].expiry, decodeIntent(ssOf(held[0].id).intent).expiry);
  assert.equal(heldLamports(c.sessions, chain.utxos), note, "but the note is held once");
  current = id;
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitStatus(id, "sent");
  await waitStatus(open, "failed");
  assert.match(ssOf(open).error, /Another payment spent the inputs of this one/);
}
step("a payment avoids the inputs of an open one, and an executed one ends the other");

// ── S4: a payment that only held notes cover says so (transfer.js runs in the Worker) ──
{
  const note = (amount, n) => ({
    spent: false,
    utxo: { asset: "SOL", amount, data: { isEmpty: () => true } },
    outputContext: { hash: Uint8Array.of(n), tree: "T" },
  });
  const wallet = { utxos: () => [note(70n, 1), note(30n, 2)] };
  const pick = (amount, held) => () =>
    selectInputs({ SOL_MINT: "SOL" }, wallet, "T", amount, new Set(held));
  assert.throws(pick(80n, ["01"]), /held by an open proposal: wait until it ends or add SOL/);
  assert.throws(pick(101n, ["01"]), /the synced balance does not cover the amount/);
  assert.throws(pick(101n, []), /the synced balance does not cover the amount/);
  assert.equal(pick(30n, ["01"])()[0].utxo.amount, 30n, "a free note still pays");
  assert.throws(pick(100n, ["01"]), /held by an open proposal/, "all notes, to the lamport");
  // Seven notes of 1: no proof takes 7, so a release would not help. The text says why.
  const small = { utxos: () => [1, 2, 3, 4, 5, 6, 7].map((n) => note(1n, n)) };
  const seven = () => selectInputs({ SOL_MINT: "SOL" }, small, "T", 7n, new Set(["01"]));
  assert.throws(seven, /needs 7 UTXOs, and no proof takes that many/);
  // heldNotes: the open payments only, each note once, synced notes only, the first to end first.
  const utxos = [{ hash: "aa", amount: "100" }, { hash: "bb", amount: "40" }];
  const pay = (id, status, expiry, inputIds) => {
    const fields = { expiry, inputs: 1, outputs: 2, recipient: "11".repeat(32), amount: 1n };
    return { id, status, intent: intentHex("withdraw", fields), inputIds };
  };
  const sessions = [
    pay("late", "collecting", 20n, ["aa", "aa"]),
    pay("early", "signed", 10n, ["bb", "cc"]),
    pay("sent", "sent", 5n, ["aa"]),
    pay("failed", "failed", 5n, ["bb"]),
    pay("unsynced", "signing", 5n, ["cc"]),
  ];
  const list = heldNotes(sessions, utxos).map((h) => [h.id, h.expiry, h.lamports]);
  assert.deepEqual(list, [["early", 10n, 40n], ["late", 20n, 100n]]);
  assert.equal(heldLamports(sessions, utxos), 140n);
}
step("a payment that only held notes cover names the open proposal as the cause");

// ── A create that fails writes no session; a create that lands late is waited for ──
{
  await forgetPairs();
  const stored = () => [...data.keys()].filter((k) => k.includes("solsessions/")).length;
  const before = stored();
  chain.sendMode = "fail";
  await assert.rejects(() => proposedPay(), /not confirmed yet \(failed\)/);
  assert.equal(stored(), before, "no session for a create that failed");
  chain.sendMode = "late";
  setTimeout(() => {
    chain.sendMode = null;
    chain.release();
  }, 5000);
  const id = await proposedPay();
  assert.ok(chain.accounts.has(base58(ssOf(id).account)), "the late create landed first");
}
step("a create that fails on chain writes no session, and a late create is waited for");

// ── An account that another device executed is read back as sent ──
{
  await forgetPairs();
  const id = await proposedPay();
  current = id;
  const ss = ssOf(id);
  const elsewhere = "4".repeat(88);
  const before = chain.refuse;
  chain.refuse = "Custom 9999"; // this device cannot land it
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitFor("a refused try", () => (c.tries[id] ?? 0) >= 1);
  // Someone sent lamports to the open account, then the execute of another device closed it.
  // Later, someone sent lamports to the address again (a System account now) and landed a
  // transaction that names it. Only the execute carries the approval of this payment.
  const address = base58(ss.account);
  chain.accounts.set(address, { owner: "00".repeat(32), data: "" });
  const [early, late] = ["6".repeat(88), "7".repeat(88)];
  chain.history.set(address, [
    { signature: late, failed: false, slot: "14" },
    { signature: elsewhere, failed: false, slot: "12" },
    { signature: "5".repeat(88), failed: true, slot: "11" },
    { signature: early, failed: false, slot: "10" },
    ...(chain.history.get(address) ?? []),
  ]);
  const base64 = (text) => Buffer.from(text, "hex").toString("base64");
  const tx = (text) => ({ found: true, failed: false, tx: base64(text) });
  chain.txs.set(elsewhere, tx("aa" + approvalOf(ssOf(id)) + "bb"));
  // A failed execute of this payment by another device carries the approval too.
  chain.txs.set("5".repeat(88), { ...tx("dd" + approvalOf(ssOf(id))), failed: true });
  // An earlier memo with the approval signature alone, and a later copy of the whole approval.
  chain.txs.set(early, tx("cc" + ssOf(id).signature));
  chain.txs.set(late, tx("ee" + approvalOf(ssOf(id))));
  chain.refuse = before;
  await waitStatus(id, "sent");
  assert.equal(ssOf(id).txId, elsewhere, "the transaction that holds the approval");
}
step("an execute that another device landed is read back from the history of the account");

// ── An account that is gone with only its create in the history: the session ends ──
{
  await forgetPairs();
  const id = await proposedPay();
  current = id;
  chain.refuse = "Custom 9999";
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitFor("a refused try", () => (c.tries[id] ?? 0) >= 1);
  chain.accounts.delete(base58(ssOf(id).account));
  chain.refuse = null;
  // Before the expiry a node may lag: the page reads the history again later, and fails nothing.
  await pause(6000);
  assert.equal(ssOf(id).status, "signed", "no failure before the expiry");
  later(DAY);
  await waitStatus(id, "failed", 60000);
  Date.now = realNow;
  assert.match(ssOf(id).error, /no execute of it landed/);
}
step("an account that is gone with no execute in its history ends the session at the expiry");

// ── A signed payment past its expiry with its account still open ends ──
{
  await forgetPairs();
  const id = await proposedPay();
  current = id;
  chain.refuse = "Custom 9999";
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitFor("a refused try", () => (c.tries[id] ?? 0) >= 1);
  chain.refuse = null;
  later(DAY);
  tryAgain(c, ssOf(id));
  await waitStatus(id, "failed");
  Date.now = realNow;
  assert.match(ssOf(id).error, /expired before it was executed/);
  assert.ok(chain.accounts.has(base58(ssOf(id).account)), "it read the open account first");
}
step("a signed payment past its expiry ends only after the page read its open account");

// ── A history that the node does not give in full: the page reads it again, no failure ──
{
  await forgetPairs();
  const id = await proposedPay();
  current = id;
  chain.refuse = "Custom 9999";
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitFor("a refused try", () => (c.tries[id] ?? 0) >= 1);
  const address = base58(ssOf(id).account);
  const [create] = chain.history.get(address);
  chain.accounts.delete(address);
  chain.refuse = null;
  const executed = "8".repeat(88);
  const unread = () => /history of the proposal account is not complete/.test(c.execErrors[id]);
  // Past the expiry the page reports an incomplete history (before it, it waits in silence).
  later(DAY);
  const readAgain = async (history, what) => {
    chain.history.set(address, history);
    delete c.execErrors[id];
    tryAgain(c, ssOf(id));
    await waitFor(what, unread);
    assert.equal(ssOf(id).status, "signed", what + ": no failure");
  };
  // A history that does not reach back to the create, then one whose execute the node lacks.
  const other = "9".repeat(88);
  chain.txs.set(other, { found: true, failed: false, tx: Buffer.from([0xcc]).toString("base64") });
  await readAgain([{ signature: other, failed: false, slot: "13" }], "no create");
  chain.txs.set(executed, { found: false, failed: false, tx: "" });
  const entry = { signature: executed, failed: false, slot: "12" };
  await readAgain([entry, create], "an unread execute");
  const signed = Buffer.from("aa" + approvalOf(ssOf(id)), "hex").toString("base64");
  chain.txs.set(executed, { found: true, failed: false, tx: signed });
  tryAgain(c, ssOf(id));
  await waitStatus(id, "sent");
  Date.now = realNow;
  assert.equal(ssOf(id).txId, executed, "the execute, once the node gives it, past the expiry");
}
step("a history with no create or with an unread transaction is read again, not failed");

// ── The sent mark of a payment needs the approval signature and a transaction id ──
{
  const ss = ssOf(current);
  const PARTS = ["intent", "plan", "inputIds", "salt", "transact", "account", "body", "createTx"];
  const d = Object.fromEntries([...PARTS, "expiry", "createdAt"].map((k) => [k, ss[k]]));
  Object.assign(d, { package: "{}", signers: [1, 2], digest: "d".repeat(64) });
  Object.assign(d, { signature: "55".repeat(64), slot: "1", outcome: "confirmed" });
  const read = (txId) => readSolSession("x", { ...d, txId }, () => "yes").ss?.status;
  assert.equal(read("4".repeat(88)), "sent", "the control");
  assert.equal(read("short"), "signed", "a sent mark with no transaction id does not count");
  const failedMark = { ...d, txId: "4".repeat(88), outcome: "failed" };
  const status = readSolSession("x", failedMark, () => "yes").ss?.status;
  assert.equal(status, "signed", "a failed execute does not count as sent");
}
step("the sent mark of a payment needs a transaction id");

// ── The one-time move of the beta funds: the card shows while the group key holds SOL ──
{
  // The card counts only the notes that a move can take.
  const stuck = { ...utxoOf(G.migrate), hash: "ef".repeat(32), movable: false };
  chain.oldUtxos = [utxoOf(G.migrate), stuck];
  await syncSolana(c);
  assert.equal(c.sync.oldBalance, G.migrate.inputs[0].amount, "the movable SOL of the old address");

  chain.oldUtxos = [];
  const kept = { sync: c.sync, chain: c.chain };
  c.sync = { ...c.sync, oldBalance: "5000000" };
  c.chain = { ...c.chain, nonce: "missing" };
  assert.equal(marked("move").length, 1, "the card of the move");
  assert.match(textOf(marked("move")[0]), /links the old address .* in public\. Helius makes/);
  assert.equal(marked("create-nonce").length, 1, "first the nonce account");
  assert.equal(marked("move-funds").length, 0);
  c.chain = { ...c.chain, nonce: "created" };
  assert.equal(textOf(marked("move-funds")[0]), "Move to the program address");
  assert.equal(textOf(marked("move-held")[0]), "Old address: 0.005 SOL", "the balance to move");
  c.sync = { ...c.sync, oldBalance: "0" };
  assert.equal(marked("move").length, 0, "no card once the funds moved");
  Object.assign(c, kept);
}
step("the move of the beta funds shows as a one-time step");

// ── A payment that expired ends, and an Approve gives way to the reason ──
{
  const id = "expired-pay";
  const ss = ssOf(current);
  const PARTS = ["intent", "plan", "inputIds", "salt", "transact", "account", "body", "createTx"];
  const late = Object.fromEntries(PARTS.map((k) => [k, ss[k]]));
  await forgetPairs();
  // Inside the margin for the clock of the device (600 s): no end yet.
  const fields = (secs) => ({ ...late, expiry: String(secs), createdAt: Date.now() });
  const just = fields(Math.floor(Date.now() / 1000) - 100);
  await writePart(c, "just-expired", "proposal", just, { seat: 1, create: true });
  await waitFor("the session", () => ssOf("just-expired"));
  await pause(1500);
  assert.equal(ssOf("just-expired").status, "collecting", "the clock margin of the device");
  late.expiry = String(Math.floor(Date.now() / 1000) - 700); // past the clock margin
  await writePart(c, id, "proposal", { ...late, createdAt: Date.now() }, { seat: 1, create: true });
  await waitStatus(id, "failed");
  assert.match(ssOf(id).error, /expired before it was executed/);
}
step("a payment past its expiry ends with a clear text");

// ── The move of the beta funds: the last payment with a nonce ──
{
  // A second old note that this move does not take: the Worker moves whole UTXOs, as many as one
  // proof takes, and the intent names what it moves, not the old balance.
  const extra = { ...utxoOf(G.migrate), hash: "ee".repeat(32), amount: "1000" };
  chain.oldUtxos = [utxoOf(G.migrate), extra];
  chain.inspected = { salt: G.migrate.salt, firstNullifier: G.migrate.inputs[0].nullifier };
  const moved = BigInt(G.migrate.inputs[0].amount);
  chain.prepared = (args) => {
    assert.equal(args.kind, "migrate", "the move spends the group key");
    assert.equal(args.recipient, G.group.pdaAddress, "to the PDA address of the group");
    assert.equal(args.amount, String(moved + 1000n), "the old balance is the bound of the move");
    return preparedOf(G.migrate, args);
  };
  const nonceRun = await proposed("createNonce");
  await approve(c, ssOf(nonceRun), 1);
  await approve(c, ssOf(nonceRun), 2);
  await waitStatus(nonceRun, "sent");
  const id = await proposed("migrate");
  assert.equal(decodeIntent(ssOf(id).intent).kind, "transfer");
  assert.equal(decodeIntent(ssOf(id).intent).amount, moved, "the intent names the moved amount");
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitStatus(id, "sent");
  const landed = chain.landed.find((x) => x.signature === ssOf(id).txId);
  assert.equal(landed.sigs.length, 2, "the payer first, then the group key");
  const message = Buffer.from(landed.message, "hex");
  const [payerSig, groupSig] = landed.sigs.map((s) => Buffer.from(s, "hex"));
  assert.ok(verifies(feeOf(c, 1).key, message, payerSig), "the fee key of seat 1 paid");
  assert.ok(verifies(G.group.key, message, groupSig), "the group key signed the move");
  assert.equal(ssOf(id).txId, base58(landed.sigs[0]), "the id is the first signature");
  const dataHex = transactOf(G.migrate, decodeIntent(ssOf(id).intent).expiry);
  assert.ok(landed.message.includes(dataHex), "the message holds the transact data of the move");
}
step("the beta funds move to the PDA address with the last nonce payment");

// ── A move on a nonce that changed after the proposal: no approval, no nonces ──
{
  await forgetPairs();
  chain.inspected = { salt: G.migrate2.salt, firstNullifier: G.migrate2.inputs[0].nullifier };
  chain.prepared = (args) => preparedOf(G.migrate2, args);
  const fresh = await proposed("migrate");
  const kept = chain.nonce;
  chain.nonce = "cd".repeat(32);
  await assert.rejects(() => approve(c, ssOf(fresh), 1), /nonce changed/);
  assert.equal(savedNonces(c, 1, fresh), undefined, "no nonces for a stale proposal");
  chain.nonce = kept;
  // The nonce holds again, but the proof of the move went stale before the send (error 7008).
  chain.refuse = JSON.stringify({ InstructionError: [1, { Custom: 7008 }] });
  await approve(c, ssOf(fresh), 1);
  await approve(c, ssOf(fresh), 2);
  await waitStatus(fresh, "failed");
  chain.refuse = null;
  assert.match(ssOf(fresh).error, /proof expired because the pool moved on/);
}
step("a move on a stale nonce is refused, and a stale proof at the send ends the move");
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
  assert.match(shown("prove-check-1"), /this device made a test proof in 3\.1 s/);
  await forgetPairs();
  chain.prepared = preparedPay;
  chain.utxos = [utxoOf(G.pay)];
  chain.gates.length = 0;
  current = await proposedPay();
  await waitFor("the screen of seat 2", () => reviewOf(c, ssOf(current), 2).ok);
  assert.equal(rowsOf(current).Helius, PROVER_ROW_LOCAL, "the screen of the payment says it too");
  await approve(c, ssOf(current), 1);
  await approve(c, ssOf(current), 2);
  await waitStatus(current, "sent");
  assert.deepEqual(chain.gates, ["local", "local"], "the proof and the fresh proof, here");
  assert.ok(chain.landed.some((x) => x.signature === ssOf(current).txId), "the execute landed");
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
console.log("sol-pay: ok");
process.exit(0);
