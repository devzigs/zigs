// Live check of payments through the approvals program (ZOLANA.md 7.2), the restore, and a
// withdrawal. Three seats in three in-memory contexts of one Chrome (the rig) make a new group, with
// the unified setup (release item M3): the create dialog chooses Solana too, and the Solana part
// starts by itself after the Zcash part:
//   (a) every seat saves its Zcash and its Solana backup: the restore source of (d) and --resume
//   (b) the funder sends SOL to the fee address of each seat; seat 1 adds 0.003 SOL (Add SOL)
//   (c) pay-a: seat 1 proposes 0.001 SOL to key B, seats 1 and 2 approve, a seat executes
//   (d) the three contexts close; three blank contexts restore every seat from the files of (a)
//   (e) pay-b: seat 3 proposes 0.001 SOL to key B and its page closes, seats 1 and 2 approve
//   (f) withdraw: seat 2 proposes 0.0005 SOL to the fee address of seat 3, seats 2 and 1 approve.
//       The page of seat 3 is closed, so that address pays no fee in this step.
// The run checks the version 5 ELF before it sends anything and before each payment. Each payment
// is checked on the chain, not with the code of the app (tools/program-chain.mjs): the proposal
// address of version 5, the group signature over the approval digest, the closed account, the
// seats that pay, the settlement accounts of the withdrawal, and that B (a sync of
// tools/key-b.mjs) or the recipient got the amount. THIS RUN LANDS TEN TRANSACTIONS on Devnet
// (PLAN). Results: solspike/logs/scenario-f.json after every step (public values only); the
// encrypted backup files go to solspike/.state/scenario-f, their passphrases to SOLSPIKE_INTERIM
// (mode 600). A new live run refuses to replace them. --resume starts again from those backups and
// skips the steps that are done; it stops at a step that an earlier run started and did not end.
// With --mock (harness/mock.mjs) it makes no Devnet call and writes no passphrase: every step runs
// against the fake chain of the web tests (harness/mock-chain.mjs), but a payment is live only:
// the model has no SDK payment for a new group, so the tap of each payment must be refused at
// prepare. The results go to solspike/logs/mock-f.json.
// Run: node solspike/harness/scenario-f.mjs [--mock | --resume]   (README.md, "Live scenarios")
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fund } from "../tools/fund.mjs";
import { addressOfB, balanceOfB } from "../tools/key-b.mjs";
import { interimFile } from "../tools/paths.mjs";
import * as chain from "../tools/program-chain.mjs";
import { balanceOf, rpcCall } from "../tools/rpc.mjs";
import * as bk from "./backups.mjs";
import { waitFor } from "./chrome.mjs";
import * as flow from "./flow.mjs";
import { MOCK, heliusAnswers, withMockUrl } from "./mock.mjs";
import { clickText, run } from "./page.mjs";
import { redact } from "./redact.mjs";
import { openApp, solValues, solanaReady, zcashWallet } from "./seats.mjs";
import { ORIGIN } from "./server.mjs";
import { withStack } from "./stack.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, MOCK ? "../logs/mock-f.json" : "../logs/scenario-f.json");
const FILES = join(HERE, "../.state/scenario-f");
const RESUME = process.argv.includes("--resume");
const HEAD = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: HERE }).trim();
const FUNDS = { 1: 6_000_000n, 2: 2_500_000n, 3: 2_500_000n };
const ADD = { text: "0.003", lamports: 3_000_000n };
// The page of seat 3 is the last one, so the pages of seats 1 and 2 keep their places after
// pay-b closes it.
const PAYMENTS = [
  { label: "pay-a", amount: "0.001", lamports: 1_000_000n, proposer: 1, approvers: [1, 2] },
  {
    label: "pay-b",
    amount: "0.001",
    lamports: 1_000_000n,
    proposer: 3,
    approvers: [1, 2],
    dropProposer: true,
  },
  { label: "withdraw", amount: "0.0005", lamports: 500_000n, proposer: 2, approvers: [2, 1] },
];
// Every Devnet transaction of the run: the payer, and the lamports that leave it (fees aside).
// The create pays the rent of the proposal, and the execute gives it back to the proposer. Any
// open page may execute, so the payer of an execute is a seat with an open page.
const RENT = 1_356_360n;
const PLAN = [
  ...[1, 2, 3].map((n) => ({ label: `fund-seat${n}`, payer: "funder", lamports: FUNDS[n] })),
  { label: "add-sol", payer: "fee address of seat 1", lamports: ADD.lamports },
  ...PAYMENTS.flatMap((p) => [
    { label: `${p.label} create`, payer: `fee address of seat ${p.proposer}`, lamports: RENT },
    { label: `${p.label} execute`, payer: "fee address of a seat with an open page", lamports: 0n },
  ]),
];
const LIVE_TOOLS = {
  fund,
  confirmed: chain.confirmed,
  payerOf: chain.payerOf,
  elf: chain.deployedElf,
};
const fresh = { head: HEAD, cluster: "devnet", mock: MOCK, steps: [], checks: {} };
const results = RESUME ? JSON.parse(readFileSync(RESULTS, "utf8")) : fresh;
results.runs = [...(results.runs ?? []), { head: HEAD, resume: RESUME }];
delete results.error;
const did = (label) => results.steps.some((s) => s.label === label);

/** Marks a step that sends as started. A step that an earlier run started and did not end stops
 * the run: its transaction may have landed, and a second tap would send it twice. */
function once(label) {
  if (MOCK) return;
  if (results.started?.includes(label)) {
    throw new Error(`${label} started in an earlier run and did not end: check it on the chain`);
  }
  results.started = [...(results.started ?? []), label];
  save();
}

function save() {
  mkdirSync(dirname(RESULTS), { recursive: true });
  writeFileSync(RESULTS, redact(JSON.stringify(results, null, 1)) + "\n");
}

const record = (label, facts) => {
  results.steps.push({ label, ...facts });
  save();
  console.log(redact(`${label} ${JSON.stringify(facts).slice(0, 240)}`));
};

/** The private balance of the group after the steps that are done, as the page shows it. */
function privateNow() {
  const paid = PAYMENTS.filter((p) => did(p.label)).reduce((sum, p) => sum + p.lamports, 0n);
  const lamports = did("add-sol") ? ADD.lamports - paid : 0n;
  return `${Number(lamports) / 1e9} SOL`;
}

/** The backup files of the seats are written, and their passphrases go to SOLSPIKE_INTERIM. */
function keepBackups(saved) {
  mkdirSync(FILES, { recursive: true });
  for (const kind of ["zcash", "solana"]) {
    for (const [i, file] of saved[kind].entries()) {
      writeFileSync(join(FILES, `seat${i + 1}-${kind}.zigsbackup`), file.text);
    }
  }
  const list = (kind) => saved[kind].map(({ name, pass }) => ({ name, pass }));
  const passes = { gid: saved.gid, keys: saved.keys, zcash: list("zcash"), solana: list("solana") };
  mkdirSync(dirname(interimFile()), { recursive: true });
  writeFileSync(interimFile(), JSON.stringify(passes), { mode: 0o600 });
  chmodSync(interimFile(), 0o600);
}

/** Every seat makes its Zcash and its Solana backup. A live run keeps them (keepBackups). */
async function backups(pages, gid, keys) {
  const saved = { gid, keys, zcash: [], solana: [] };
  for (const [i, page] of pages.entries()) {
    const zcash = await bk.zcashBackup(page);
    const solana = await bk.solanaBackup(page, i + 1);
    bk.checkFiles(zcash, solana);
    saved.zcash.push(zcash);
    saved.solana.push(solana);
  }
  if (!MOCK) keepBackups(saved);
  record("backups", { files: 6 });
  return saved;
}

/** The kept backups of keepBackups, each file with its text. */
function loadBackups() {
  const saved = JSON.parse(readFileSync(interimFile(), "utf8"));
  const withText = (kind) =>
    saved[kind].map((f, i) => {
      redact.add(f.pass);
      return { ...f, text: readFileSync(join(FILES, `seat${i + 1}-${kind}.zigsbackup`), "utf8") };
    });
  return { ...saved, zcash: withText("zcash"), solana: withText("solana") };
}

/** Three blank contexts restore every seat from the backups and show the Solana part ready. */
async function restored(rig, saved) {
  const pages = [];
  for (const i of [1, 2, 3]) {
    const page = await openApp(rig, "restore" + i, `${ORIGIN}/`);
    await bk.assertBlank(page);
    pages.push(page);
  }
  for (const [i, page] of pages.entries()) await bk.restoreZcash(page, saved.zcash[i], saved.gid);
  for (const [i, page] of pages.entries()) {
    const tab = () => run(page, () => !!document.getElementById("tab-solana"));
    await waitFor(tab, 60000, () => "the Solana tab");
    await clickText(page, "Solana", { exact: true });
    await bk.restoreSolana(page, saved.solana[i]);
  }
  for (const page of pages) {
    const ready = async () => (await solValues(page)).status === "ready";
    await waitFor(ready, 180000, () => "status ready after the restore");
    const seen = await solValues(page);
    assert.equal(seen["group-key"], saved.keys.groupKey, "the restored group key");
  }
  return pages;
}

async function created(rig) {
  if (!MOCK && existsSync(interimFile())) {
    throw new Error("SOLSPIKE_INTERIM holds the backups of an earlier group: --resume, or move it");
  }
  const { pages, gid } = await zcashWallet(rig, "Scenario F wallet", { solana: true });
  const keys = await solanaReady(pages, gid, { auto: true });
  results.group = { owner: keys.owner, groupKey: keys.groupKey };
  record("ready", {});
  return { pages, keys, saved: await backups(pages, gid, keys) };
}

/** A run of --resume: the seats of the earlier run, restored from its kept backups. */
async function resumed(rig) {
  const saved = loadBackups();
  return { pages: await restored(rig, saved), keys: saved.keys, saved };
}

async function fundSeats(pages, fees, tools) {
  for (const seat of [1, 2, 3]) {
    if (did(`fund-seat${seat}`)) continue;
    const sent = await tools.fund({ to: fees[seat], shown: fees[seat], lamports: FUNDS[seat] });
    record(`fund-seat${seat}`, { signature: sent.signature, lamports: String(FUNDS[seat]) });
  }
  for (const [i, page] of pages.entries()) await flow.feeFunded(page, i + 1);
}

async function addSol(page, fees, tools) {
  once("add-sol");
  const signature = await flow.addSol(page, ADD.text);
  await tools.confirmed(signature);
  assert.equal(await tools.payerOf(signature), fees[1], "the fee address of seat 1 pays Add SOL");
  record("add-sol", { signature });
}

/** The recipient of the withdrawal: the fee address of seat 3, whose page pay-b closed. */
const recipientOf = (spec, fees) => (spec.label === "withdraw" ? fees[3] : undefined);

/** The balance of the payee: the public recipient, or key B by a sync that reads `slot`. */
async function payeeBalance(withdrawTo, slot) {
  if (withdrawTo) return BigInt(await balanceOf(withdrawTo));
  const at = slot ?? (await rpcCall("getSlot", [{ commitment: "confirmed" }]));
  return BigInt(await balanceOfB(at));
}

/** The proposer pays the create and gets its rent back, and a seat pays the execute. */
function checkSeats(facts, { label, proposer }) {
  assert.equal(facts.create.payerSeat, String(proposer), `${label}: the proposer pays the create`);
  assert.equal(facts.rentRecipientSeat, String(proposer), `${label}: the rent goes back to it`);
  assert.notEqual(facts.execute.payerSeat, "none", `${label}: a seat pays the execute`);
}

/** One payment of PAYMENTS from the live pages, checked on the chain. Returns the live pages. */
async function payStep(pages, spec, { keys, fees, payee, tools }) {
  results.checks[`elf-${spec.label}`] = await tools.elf();
  await flow.privateBalance(pages[0], privateNow());
  const withdrawTo = recipientOf(spec, fees);
  const before = await payeeBalance(withdrawTo);
  once(spec.label);
  const done = await flow.pay(pages, { ...spec, payee, withdrawTo }, chain.proposalOpen);
  const facts = await chain.paymentFacts(done.proposal, done.signature, keys.groupKey, fees);
  checkSeats(facts, spec);
  if (withdrawTo) facts.settlement = await chain.settlementFacts(done.signature, withdrawTo);
  const received = (await payeeBalance(withdrawTo, facts.execute.slot)) - before;
  assert.equal(received, spec.lamports, `${spec.label}: the payee got the amount`);
  const { id, proposal } = done;
  record(spec.label, { id, proposal, ...facts, received: String(received) });
  return done.alive;
}

/** A payment: live, or in a mock run a tap that the fake chain must refuse (live only). */
async function payment(pages, spec, ctx) {
  if (!MOCK) return payStep(pages, spec, ctx);
  const tap = { ...spec, payee: ctx.payee, withdrawTo: recipientOf(spec, ctx.fees) };
  const refused = await flow.refusedTap(pages[spec.proposer - 1], tap);
  record(`${spec.label} (live only)`, { refused });
  return pages;
}

/** (d): the pages close, and blank pages restore the seats. A resumed run is a restore already. */
async function restoreStep(rig, pages, saved, fees) {
  if (did("restore") || RESUME) return pages;
  for (const page of pages) await page.context.dispose();
  const fresh = await restored(rig, MOCK ? saved : loadBackups());
  assert.deepEqual(await flow.feeAddresses(fresh), fees, "the restored seats keep their fee keys");
  record("restore", {});
  return fresh;
}

/** The problems of every page of the run, also of the pages that closed. */
function finish(seen) {
  results.problems = seen.map((p) => flow.problemsOf(p).length);
  save();
  assert.ok(results.problems.every((n) => n === 0), "no console problem or CSP violation");
  if (MOCK) assert.equal(heliusAnswers(seen), 0, "no answer from the Helius host");
}

async function steps(rig, start, fees, tools) {
  let { pages } = start;
  const seen = [...pages];
  const ctx = { keys: start.keys, fees, payee: await addressOfB(), tools };
  results.checks.elf = await tools.elf();
  await fundSeats(pages, fees, tools);
  if (!did("add-sol")) await addSol(pages[0], fees, tools);
  if (!did("pay-a")) pages = await payment(pages, PAYMENTS[0], ctx);
  pages = await restoreStep(rig, pages, start.saved, fees);
  seen.push(...pages.filter((page) => !seen.includes(page)));
  for (const spec of PAYMENTS.slice(1)) {
    if (!did(spec.label)) pages = await payment(pages, spec, ctx);
  }
  await flow.privateBalance(pages[0], privateNow());
  finish(seen);
}

async function scenario(rig) {
  results.plan = PLAN.map((tx) => ({ ...tx, lamports: String(tx.lamports) }));
  const tools = MOCK ? (await import("./mock-chain.mjs")).mockTools(rig) : LIVE_TOOLS;
  const start = RESUME ? await resumed(rig) : await created(rig);
  const fees = await flow.feeAddresses(start.pages);
  if (results.fees) assert.deepEqual(fees, results.fees, "the same fee addresses");
  results.fees = fees;
  await steps(rig, start, fees, tools);
  console.log(redact(JSON.stringify({ mock: MOCK, steps: results.steps.map((s) => s.label) })));
}

withMockUrl(() => withStack("scenario-f", scenario)).catch((err) => {
  results.error = redact(String(err?.message ?? err));
  save();
  console.error(redact(String(err?.stack ?? err)));
  process.exitCode = 1;
});
