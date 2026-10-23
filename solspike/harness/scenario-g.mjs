// Live check of S3 (only a funded seat executes) and S4 (a held note names the open proposal),
// ZOLANA.md 7.2. Three seats in three in-memory contexts of one Chrome (the rig) make a new group,
// as in scenario-f.mjs. Key B (tools/key-b.mjs) is the private payee:
//   (a) every seat saves its Zcash and its Solana backup: the restore source of --resume
//   (b) only the fee address of seat 1 gets SOL, and seats 2 and 3 must hold less than an execute
//       needs. Seat 1 adds 0.003 SOL (Add SOL)
//   (c) S3, P1 (live only): seat 1 proposes 0.001 SOL to B, and its page closes (its context
//       stays). Seats 2 and 3 approve. For 90 s their pages send no execute, and show no red banner
//       and no execute error. Then a new page of seat 1 opens in the same context and executes P1
//   (d) S4, P2 (live only): seat 1 proposes 0.0015 SOL to B. While P2 holds the only note, a tap of
//       0.0015 SOL must say that an open proposal holds the notes, a tap of 0.003 SOL must say that
//       the synced balance does not cover it, and neither sends anything. The pay card names P2
//       and its end. Seats 1 and 2 approve P2, and seat 1 executes it
// The run checks the version 5 ELF before it sends anything and before each payment. Each payment
// is checked on the chain, not with the code of the app (tools/program-chain.mjs): the fee address
// of seat 1 pays the create and the execute, the account is closed and its rent goes back to seat
// 1, and B (a sync of tools/key-b.mjs) got the amount. THIS RUN LANDS SIX TRANSACTIONS on Devnet
// (PLAN). Results: solspike/logs/scenario-g.json after every step (public values only). The
// encrypted backup files go to solspike/.state/scenario-g, their passphrases to SOLSPIKE_INTERIM
// (mode 600): name another file than the one of scenario-f. A new live run refuses to replace
// them. --resume starts again from those backups and skips the steps that are done; it stops at a
// step that an earlier run started and did not end.
// With --mock (harness/mock.mjs) it makes no Devnet call and writes no passphrase. The setup, the
// backups, the funding of seat 1, Add SOL, the private balance and the new page of seat 1 run
// against the fake chain of the web tests (harness/mock-chain.mjs). P1 and P2 are live only: the
// tap of each must be refused at prepare. The results go to solspike/logs/mock-g.json.
// Run: node solspike/harness/scenario-g.mjs [--mock | --resume]   (README.md, "Live scenarios")
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
import { sleep, waitFor } from "./chrome.mjs";
import * as flow from "./flow.mjs";
import { MOCK, heliusAnswers, withMockUrl } from "./mock.mjs";
import { run } from "./page.mjs";
import { redact } from "./redact.mjs";
import { openApp, openSolana, reload, solValues, solanaReady, zcashWallet } from "./seats.mjs";
import { ORIGIN } from "./server.mjs";
import { withStack } from "./stack.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, MOCK ? "../logs/mock-g.json" : "../logs/scenario-g.json");
const FILES = join(HERE, "../.state/scenario-g");
const RESUME = process.argv.includes("--resume");
const HEAD = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: HERE }).trim();
// Only the fee address of seat 1 gets SOL. Seats 2 and 3 must hold less than the minimum that a
// page wants before its seat executes (EXECUTE_MIN of web/sol/execute.js).
const FUND = 6_000_000n;
const POOR = 1_000_000n;
const ADD = { text: "0.003", lamports: 3_000_000n };
// The unfunded pages hold an approved P1 this long, and the checks run this often.
const QUIET_MS = 90_000;
const POLL_MS = 5_000;
// After a refused tap, the chain gets this long to show a transaction that must not exist.
const SETTLE_MS = 15_000;
// The page ends an open payment this long after its expiry (CLOCK_MARGIN_S of web/sol/execute.js).
const END_MARGIN_S = 600n;
// A proposal account holds kind 1, a bump, then the body: the commitment, the group key, then the
// expiry (u64 LE). See holdsBody and bodyOf of web/sol/execute.js.
const BODY_AT = 2;
const EXPIRY_AT = BODY_AT + 64;
// The sent mark of a card: an explorer link text can end with " ↗" (web/sol/payview.js).
const RESULT = /^(Executed|Failed on chain) in slot (\d+): (\w+)(?: ↗)?$/;
const P1 = { label: "p1", amount: "0.001", lamports: 1_000_000n, proposer: 1, approvers: [2, 3] };
const P2 = { label: "p2", amount: "0.0015", lamports: 1_500_000n, proposer: 1, approvers: [1, 2] };
// Taps of seat 1 while P2 holds the only note (0.002 SOL): the page must refuse each before a send.
const P3 = { label: "p3", amount: "0.0015", want: /held by an open proposal/ };
const P4 = { label: "p4", amount: "0.003", want: /the synced balance does not cover the amount/ };
// Every Devnet transaction of the run: the payer, and the lamports that leave it (fees aside).
// The create pays the rent of the proposal, and the execute gives it back to seat 1.
const RENT = 1_356_360n;
const SEAT1 = "fee address of seat 1";
const PLAN = [
  { label: "fund-seat1", payer: "funder", lamports: FUND },
  { label: "add-sol", payer: SEAT1, lamports: ADD.lamports },
  ...[P1, P2].flatMap((p) => [
    { label: `${p.label} create`, payer: SEAT1, lamports: RENT, liveOnly: true },
    { label: `${p.label} execute`, payer: SEAT1, lamports: 0n, liveOnly: true },
  ]),
];
const LIVE_TOOLS = {
  fund,
  confirmed: chain.confirmed,
  payerOf: chain.payerOf,
  elf: chain.deployedElf,
  balance: balanceOf,
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
  const paid = [P1, P2].filter((p) => did(p.label)).reduce((sum, p) => sum + p.lamports, 0n);
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
  const { gid, keys } = saved;
  const passes = { scenario: "g", gid, keys, zcash: list("zcash"), solana: list("solana") };
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

/** The kept backups of keepBackups, each file with its text. Those of another scenario stop. */
function loadBackups() {
  const saved = JSON.parse(readFileSync(interimFile(), "utf8"));
  if (saved.scenario !== "g") {
    throw new Error("SOLSPIKE_INTERIM holds the backups of another scenario: name the file of G");
  }
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
    await openSolana(page);
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
  const { pages, gid } = await zcashWallet(rig, "Scenario G wallet");
  const keys = await solanaReady(pages, gid);
  results.group = { owner: keys.owner, groupKey: keys.groupKey };
  record("ready", {});
  return { pages, keys, saved: await backups(pages, gid, keys) };
}

/** A run of --resume: the seats of the earlier run, restored from its kept backups. */
async function resumed(rig) {
  const saved = loadBackups();
  return { pages: await restored(rig, saved), keys: saved.keys, saved };
}

/** On the chain, seats 2 and 3 hold less than an execute needs. Kept as checks[name]. */
async function unfunded(fees, tools, name) {
  const held = {};
  for (const seat of [2, 3]) {
    const lamports = await tools.balance(fees[seat]);
    assert.ok(lamports < POOR, `the fee address of seat ${seat} holds less than ${POOR} lamports`);
    held[seat] = String(lamports);
  }
  results.checks[name] = held;
  save();
}

/** Only the fee address of seat 1 gets SOL, and its page shows it. */
async function fundSeat1(page, fees, tools) {
  if (!did("fund-seat1")) {
    const sent = await tools.fund({ to: fees[1], shown: fees[1], lamports: FUND });
    record("fund-seat1", { signature: sent.signature, lamports: String(FUND) });
  }
  await flow.feeFunded(page, 1);
  await unfunded(fees, tools, "unfunded");
}

async function addSol(page, fees, tools) {
  once("add-sol");
  const signature = await flow.addSol(page, ADD.text);
  await tools.confirmed(signature);
  assert.equal(await tools.payerOf(signature), fees[1], "the fee address of seat 1 pays Add SOL");
  record("add-sol", { signature });
}

/**
 * A new page of seat 1 in the context of its closed page: the context keeps its storage, so no
 * restore is needed. It shows the Solana part ready, with the same group key and fee address.
 */
async function reopen(old, { gid, keys, fees }) {
  const page = await old.context.open();
  page.context = old.context;
  await reload(page, gid);
  await openSolana(page);
  const ready = async () => (await solValues(page)).status === "ready";
  await waitFor(ready, 180000, () => "status ready on the new page of seat 1");
  assert.equal((await solValues(page))["group-key"], keys.groupKey, "the same group key");
  assert.deepEqual(await flow.feeAddresses([page]), { 1: fees[1] }, "seat 1 keeps its fee key");
  return page;
}

/** The text of the banner when it shows as an error (red), else null. */
const redBanner = (page) =>
  run(page, () => {
    const box = document.getElementById("banner");
    return box && !box.hidden && box.classList.contains("bad") ? box.innerText.trim() : null;
  });

/** The data of an account that the approvals program owns, or null. */
async function accountData(proposal) {
  const options = { encoding: "base64", commitment: "confirmed" };
  const { value } = await rpcCall("getAccountInfo", [proposal, options]);
  return value?.owner === chain.PROGRAM ? Buffer.from(value.data[0], "base64") : null;
}

/** True when the proposal account still holds its body: no execute closed it. */
async function holdsBody(proposal) {
  const data = await accountData(proposal);
  return data !== null && data[0] === 1 && data.length > BODY_AT;
}

/** The page shows P1 approved and not executed, with no execute error and no red banner. */
async function calm(page, id) {
  const card = (await flow.sessions(page)).find((s) => s.id === id);
  assert.equal(card?.state, "signed", "P1 stays approved and is not executed");
  assert.equal(card.error, null, `no execute error on the card of P1: ${redact(card.error ?? "")}`);
  const red = await redBanner(page);
  assert.equal(red, null, `no red banner: ${redact(red ?? "")}`);
}

/** For QUIET_MS the unfunded pages hold P1, and the chain shows its account open. */
async function quiet(pages, id, proposal) {
  const end = Date.now() + QUIET_MS;
  for (let polls = 1; ; polls += 1) {
    for (const page of pages) await calm(page, id);
    assert.ok(await holdsBody(proposal), "P1: the proposal account still holds its body");
    if (Date.now() > end) return { ms: QUIET_MS, polls };
    await sleep(POLL_MS);
  }
}

/** The ELF check and the private balance before a payment. Returns the balance of B (lamports). */
async function beforePay(page, spec, tools) {
  results.checks[`elf-${spec.label}`] = await tools.elf();
  await flow.privateBalance(page, privateNow());
  const slot = await rpcCall("getSlot", [{ commitment: "confirmed" }]);
  return BigInt(await balanceOfB(slot));
}

/** Seat 1 taps the form, and every page shows the screen. Returns { id, proposal }. */
async function proposeOn(pages, spec) {
  const id = await flow.proposed(pages[0], spec);
  const screens = await flow.screensOf(pages, id, -1);
  const proposal = flow.screenProposal(screens["seat " + spec.approvers[0]], spec);
  assert.ok(await chain.proposalOpen(proposal), "the proposal account exists before approvals");
  return { id, proposal };
}

/** Every page shows session `id` as executed, with the same sent mark. Returns the signature. */
async function executedOn(pages, id, label) {
  for (const page of pages) await flow.waitState(page, id, "sent", 400000);
  const marks = [];
  for (const page of pages) {
    assert.ok(await flow.noApprove(page, id), "no Approve control is left");
    marks.push((await flow.sessions(page)).find((s) => s.id === id)?.result ?? "");
  }
  const seen = RESULT.exec(marks[0]);
  assert.ok(seen && seen[1] === "Executed", `the result line of ${label}: ${redact(marks[0])}`);
  assert.ok(marks.every((m) => m === marks[0]), `${label}: every page shows the same sent mark`);
  return seen[3];
}

/** The payment on the chain: seat 1 pays the create and the execute, and gets the rent back. */
async function onChain(spec, { id, proposal, signature, before }, { keys, fees }) {
  const { label } = spec;
  const facts = await chain.paymentFacts(proposal, signature, keys.groupKey, fees);
  assert.equal(facts.create.payerSeat, "1", `${label}: seat 1 pays the create`);
  assert.equal(facts.execute.payerSeat, "1", `${label}: seat 1 pays the execute`);
  assert.equal(facts.rentRecipientSeat, "1", `${label}: the rent goes back to seat 1`);
  const received = BigInt(await balanceOfB(facts.execute.slot)) - before;
  assert.equal(received, spec.lamports, `${label}: B got the amount`);
  record(label, { id, proposal, ...facts, received: String(received) });
}

/**
 * S3: seat 1 proposes P1 and its page closes. The unfunded seats 2 and 3 approve and do not
 * execute for QUIET_MS. A new page of seat 1 executes P1. Returns the pages, seat 1 first.
 */
async function s3(pages, ctx) {
  const before = await beforePay(pages[0], P1, ctx.tools);
  once(P1.label);
  const { id, proposal } = await proposeOn(pages, { ...P1, payee: ctx.payee });
  await pages[0].close();
  const others = pages.slice(1);
  await flow.approveAll(pages, id, P1.approvers, () => chain.proposalOpen(proposal));
  for (const page of others) await flow.waitState(page, id, "signed", 400000);
  await unfunded(ctx.fees, ctx.tools, "unfunded-p1");
  results.checks.quiet = await quiet(others, id, proposal);
  const alive = [await reopen(pages[0], ctx), ...others];
  const signature = await executedOn(alive, id, P1.label);
  await onChain(P1, { id, proposal, signature, before }, ctx);
  return alive;
}

const lastSignature = async (address) => {
  const options = { limit: 1, commitment: "confirmed" };
  const [last] = await rpcCall("getSignaturesForAddress", [address, options]);
  return last?.signature ?? null;
};

/** A tap that the page must refuse with `spec.want`: no new session, and seat 1 sends nothing. */
async function refusedLive(page, spec, fee) {
  const mark = await lastSignature(fee);
  const refused = await flow.refusedTap(page, spec, spec.want);
  await sleep(SETTLE_MS);
  assert.equal(await lastSignature(fee), mark, `${spec.label}: seat 1 sent nothing`);
  return { refused };
}

/** The pay card names P2 as the holder of every note, and the time when the page ends it. */
async function holderLine(page, id, proposal) {
  const data = await accountData(proposal);
  assert.ok(data, "P2: the proposal account is open");
  const ends = Number(data.readBigUInt64LE(EXPIRY_AT) + END_MARGIN_S) * 1000;
  const end = new Date(ends).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  let line = "";
  const named = async () => {
    line = (await solValues(page)).available ?? "";
    return line.includes(`(${id})`) && line.includes(`ends at ${end}.`);
  };
  await waitFor(named, 60000, () => `the holder line of P2 (last ${redact(line)})`);
  return line;
}

/**
 * S4: seat 1 proposes P2, which holds the only note. Taps of P3 and P4 are refused, and the pay
 * card names P2. Seats 1 and 2 approve P2, and seat 1 executes it.
 */
async function s4(pages, ctx) {
  const before = await beforePay(pages[0], P2, ctx.tools);
  once(P2.label);
  const { id, proposal } = await proposeOn(pages, { ...P2, payee: ctx.payee });
  for (const tap of [P3, P4]) {
    record(tap.label, await refusedLive(pages[0], { ...tap, payee: ctx.payee }, ctx.fees[1]));
  }
  record("holder", { line: await holderLine(pages[0], id, proposal) });
  await flow.approveAll(pages, id, P2.approvers, () => chain.proposalOpen(proposal));
  const signature = await executedOn(pages, id, P2.label);
  await onChain(P2, { id, proposal, signature, before }, ctx);
}

/**
 * A mock run: the fake chain has no payment, so the tap of P1 and of P2 must be refused at
 * prepare (live only). The page of seat 1 still closes and opens again in its context, as in S3.
 * Each refusal is on its own page: refusedTap wants a banner text that is new on the page.
 */
async function mockPayments(pages, ctx) {
  const tap = (page, spec) => flow.refusedTap(page, { ...spec, payee: ctx.payee });
  record(`${P1.label} (live only)`, { refused: await tap(pages[0], P1) });
  await pages[0].close();
  const alive = [await reopen(pages[0], ctx), ...pages.slice(1)];
  record("reopen-seat1", {});
  record(`${P2.label} (live only)`, { refused: await tap(alive[0], P2) });
  return alive;
}

/** The problems of every page of the run, also of the pages that closed. */
function finish(seen) {
  results.problems = seen.map((p) => flow.problemsOf(p).length);
  save();
  assert.ok(results.problems.every((n) => n === 0), "no console problem or CSP violation");
  if (MOCK) assert.equal(heliusAnswers(seen), 0, "no answer from the Helius host");
}

async function steps(start, fees, tools) {
  let { pages } = start;
  const seen = [...pages];
  const payee = await addressOfB();
  const ctx = { keys: start.keys, gid: start.saved.gid, fees, payee, tools };
  results.checks.elf = await tools.elf();
  await fundSeat1(pages[0], fees, tools);
  if (!did("add-sol")) await addSol(pages[0], fees, tools);
  if (MOCK) pages = await mockPayments(pages, ctx);
  if (!MOCK && !did(P1.label)) pages = await s3(pages, ctx);
  if (!MOCK && !did(P2.label)) await s4(pages, ctx);
  seen.push(...pages.filter((page) => !seen.includes(page)));
  await flow.privateBalance(pages[0], privateNow());
  finish(seen);
}

/** The tools of a mock run: the fake chain, and the fee balances that its funding set. */
async function mockTools(rig) {
  const mock = (await import("./mock-chain.mjs")).mockTools(rig);
  return { ...mock, balance: async (address) => mock.chain.balances.get(address) ?? 0n };
}

async function scenario(rig) {
  results.plan = PLAN.map((tx) => ({ ...tx, lamports: String(tx.lamports) }));
  const tools = MOCK ? await mockTools(rig) : LIVE_TOOLS;
  const start = RESUME ? await resumed(rig) : await created(rig);
  const fees = await flow.feeAddresses(start.pages);
  if (results.fees) assert.deepEqual(fees, results.fees, "the same fee addresses");
  results.fees = fees;
  await steps(start, fees, tools);
  console.log(redact(JSON.stringify({ mock: MOCK, steps: results.steps.map((s) => s.label) })));
}

withMockUrl(() => withStack("scenario-g", scenario)).catch((err) => {
  results.error = redact(String(err?.message ?? err));
  save();
  console.error(redact(String(err?.stack ?? err)));
  process.exitCode = 1;
});
