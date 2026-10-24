// Payments against the fake chain, part 2 of sol-pay.mjs: a reused salt, a stale proof at the
// execute, the seat that can pay and the lease that it renews, the withdrawal to a public
// address, an execute that fails on chain or lands late, a create that meets the same body, and
// two payments over one input.
// Run: node web/test/sol-pay-exec.mjs   (Node 26)
import assert from "node:assert/strict";
import { approve, reviewOf } from "../sol/approve.js";
import { base58, keyOfBase58 } from "../sol/docs.js";
import { EXECUTE_TRIES, endsAt, forgetBalances } from "../sol/execute.js";
import { bytesOf, decodeIntent, intentHex } from "../sol/intent.js";
import { feeOf } from "../sol/fee.js";
import { putSol } from "../sol/secrets.js";
import { solText } from "../sol/session.js";
import { deviceSpend } from "../sol/spend.js";
import { PROVER_TEXT, stepStates } from "../sol/payview.js";
import { heldLamports, heldNotes, partFields, writePart } from "../sol/sessions.js";
import { selectInputs } from "../sol/transfer.js";
import { solView } from "../sol/view.js";
import { FRONT_RUN, verifies } from "./sol-chain.mjs";
import { G, preparedOf, transactOf, utxoOf } from "./sol-fixture.mjs";
import {
  c,
  chain,
  feeAddress,
  gid,
  proposed,
  ssOf,
  waitFor,
  waitStatus,
} from "./sol-setup.mjs";
import { step } from "./sol-vector.mjs";
import {
  TO,
  count,
  cur,
  dropSessions,
  findAll,
  forgetPairs,
  installTestGroup,
  marked,
  node,
  pause,
  preparedPay,
  proposedPay,
  proposedWithdrawal,
  rowsOf,
  textOf,
} from "./sol-pay-rig.mjs";

await installTestGroup();

// ── A reused salt of another proposal on the group server: refused, after a restore too ──
{
  await forgetPairs();
  const id = await proposedPay();
  cur.id = id;
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
  cur.id = id;
  await approve(c, ssOf(id), 1);
  chain.refuse = JSON.stringify({ InstructionError: [1, { Custom: 7008 }] });
  const tries = cur.reproofs;
  await approve(c, ssOf(id), 3);
  await waitFor("a stale try", () => (c.tries[id] ?? 0) >= 1);
  assert.match(c.execErrors[id], /went stale/);
  chain.refuse = null;
  await waitStatus(id, "sent");
  assert.ok(cur.reproofs >= tries + 2, "proved again after the stale root");
  assert.equal(ssOf(id).signature.length, 128, "with the one approval of the group");
}
step("a stale root at the execute is proved again, and the one approval still holds");

// ── Only a seat whose fee address can pay executes (S3); the lease is renewed ──
{
  await forgetPairs();
  const id = await proposedPay();
  cur.id = id;
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
    const expiry = decodeIntent(ssOf(cur.id).intent).expiry;
    return { data: transactOf(G.withdraw, expiry, { proof: "05", root: 300 }) };
  };
  // The typed address may have spaces around it.
  const id = await proposedWithdrawal(" " + base58(TO) + " ");
  cur.id = id;
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
  assert.equal(rows["Create paid by device 1"], feeAddress(1));
  assert.equal(rows.Change, "0.003 SOL stays with the group.", "the change of the withdrawal");
  // The forms of the tab: each button proposes its kind with the typed address and amount.
  const asked = [];
  const view = solView({ ...c, host: { ...c.host, el: node } }, (fn) => fn, {
    propose: (kind, args) => asked.push([kind, args]),
  });
  const one = (mark) => findAll(view, (n) => n.attrs["data-sol"] === mark)[0];
  const card = findAll(view, (n) => n.attrs["data-session"] === id)[0];
  assert.match(textOf(card), /Public SOL withdrawal/, "the card of the session");
  const stepsOf = (n) => findAll(n, (x) => x.attrs["data-sol"] === "steps-" + id)[0]
    .kids.map((x) => x.attrs.class);
  assert.deepEqual(stepsOf(card), ["step done", "step now", "step ", "step "], "the steps");
  assert.match(textOf(findAll(card, (n) => n.attrs["data-sol"] === "amount-" + id)[0]),
    /^Public withdrawal 0\.002 SOL /,
    "the amount that the checker bound, above the rows");
  // The steps come from the parts of the session; a failure marks the step where it stopped.
  const states = (patch, n = 0) => stepStates({ ...ssOf(id), ...patch }, n, 2);
  const parts = { package: "P", signature: "S" };
  assert.deepEqual(states({ status: "collecting" }, 1), ["now", "", ""]);
  assert.deepEqual(states({ status: "collecting", expiry: 1 }), ["bad", "", ""], "expired");
  assert.deepEqual(states({ status: "signing", package: "P" }, 2), ["done", "now", ""]);
  assert.deepEqual(states({ status: "signed", ...parts }, 2), ["done", "done", "now"]);
  assert.deepEqual(states({ status: "sent", ...parts, outcome: "failed" }, 2),
    ["done", "done", "bad"], "failed on chain");
  assert.deepEqual(states({ status: "failed" }), ["bad", "", ""], "failed before the package");
  assert.deepEqual(states({ status: "failed", package: "P" }, 2), ["done", "bad", ""]);
  assert.deepEqual(states({ status: "failed", ...parts }, 2), ["done", "done", "bad"]);
  assert.deepEqual(states({ status: "failed" }, 2), ["done", "bad", ""],
    "t approvals and no package: the signing stopped");
  assert.deepEqual(states({ status: "collecting", expiry: 1 }, 2), ["done", "bad", ""]);
  assert.deepEqual(stepStates({ ...ssOf(id), status: "signed", ...parts }, 2, 2, true),
    ["done", "done", "bad"], "the automatic execute stopped after its tries");
  const outView = solView({ ...c, sessions: [{ ...ssOf(id), status: "signed", ...parts }],
    tries: { [id]: EXECUTE_TRIES }, host: { ...c.host, el: node } }, (fn) => fn, {});
  assert.deepEqual(stepsOf(outView), ["step done", "step done", "step done", "step bad"],
    "the card: a person must press Try the execute again");
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
  // No approval record here: the package alone gives t approvals.
  const sentCard = findAll(solView({ ...c, commits: {}, host: { ...c.host, el: node } },
    (fn) => fn, {}),
    (n) => n.attrs["data-session"] === id)[0];
  assert.deepEqual(stepsOf(sentCard), ["step done", "step done", "step done", "step done"]);
  const sentSteps = findAll(sentCard, (x) => x.attrs["data-sol"] === "steps-" + id)[0];
  assert.match(textOf(sentSteps), /Approvals · 2 of 2/, "a package counts t approvals");
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
  cur.id = id;
  // Then the recipient account becomes an account of a program: no seat approves the payment.
  chain.accounts.set(base58(TO), { owner: "11".repeat(32), data: "" });
  await assert.rejects(() => approve(c, ssOf(id), 2), /ordinary System account/);
  chain.accounts.delete(base58(TO));
  chain.utxos = [utxoOf(G.pay)];
  chain.prepared = preparedPay;
}
step("a withdrawal to an account of the group or of a program is refused by every device");

// ── An execute that fails on chain is a counted try, not a sent mark ──
{
  await forgetPairs();
  const id = await proposedPay();
  cur.id = id;
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
  cur.id = id;
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
  // The pay card says what a new payment can spend, or which proposals hold all of it.
  const kept = { sync: c.sync, sessions: c.sessions };
  const notes = chain.utxos.map(({ hash, amount }) => ({ hash, amount }));
  const line = () => marked("available").map(textOf);
  // The page ends a payment 600 s after its expiry (the clock margin of execute.js).
  const at = new Date((Number(held[0].expiry) + 600) * 1000).toISOString().slice(0, 16);
  const end = at.replace("T", " ") + " UTC";
  assert.equal(endsAt(held[0].expiry), held[0].expiry + 600n, "the margin of the end");
  const name = `of device ${ssOf(held[0].id).by} (${held[0].id})`;
  c.sync = { ...kept.sync, lamports: String(note), notes };
  const two = `All your notes are held by 2 open proposals. The one that ends first, ${name}, ends`;
  assert.deepEqual(line(), [`${two} at ${end}. Add SOL or wait.`], "two holders");
  c.sessions = kept.sessions.filter((ss) => ss.id !== held[1].id);
  const one = `All your notes are held by an open proposal ${name}. It ends at ${end}.`;
  assert.deepEqual(line(), [one + " Add SOL or wait."], "one holder");
  c.sessions = kept.sessions;
  const extra = { hash: "ee".repeat(32), amount: "1000" };
  c.sync = { ...c.sync, lamports: String(note + 1000n), notes: [...notes, extra] };
  const free = `Available for a new payment: ${solText(1000n)}. Open proposals hold `;
  assert.deepEqual(line(), [free + solText(note) + " until they execute or end."]);
  // A sent payment spent its notes: they are not available, also before the next sync.
  const sentFields = { expiry: 1n, inputs: 1, outputs: 2, recipient: "11".repeat(32), amount: 1n };
  const intent = intentHex("withdraw", sentFields);
  const spent = { id: "spent-s4", by: 1, status: "sent", intent, inputIds: [extra.hash] };
  c.sessions = [...kept.sessions, spent];
  assert.deepEqual(line(), [`${two} at ${end}. Add SOL or wait.`], "the spent note is gone");
  c.sessions = kept.sessions;
  c.sync = { ...c.sync, notes: [] };
  assert.deepEqual(line(), [], "no line while no open proposal holds a synced note");
  c.sync = kept.sync;
  cur.id = id;
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
  // A held note of 70 would pay alone, but the seven free notes of 10 need a proof of 7 inputs.
  const mixed = { utxos: () => [note(70n, 1), ...[2, 3, 4, 5, 6, 7, 8].map((n) => note(10n, n))] };
  const seventy = () => selectInputs({ SOL_MINT: "SOL" }, mixed, "T", 70n, new Set(["01"]));
  assert.throws(seventy, /held by an open proposal: wait until it ends or add SOL/);
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
console.log("sol-pay-exec: ok");
process.exit(0);
