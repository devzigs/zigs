// P8e live check: the three intents that move no private funds, landed on Devnet from the app by
// three seats in three in-memory contexts of one Chrome (the rig) on the local dev server
// (cf/.dev.vars has SOL=1). THIS RUN LANDS FOUR TRANSACTIONS and spends about 0.05 SOL of the
// Devnet funder (the brief of the P8e track allows it; it is the only run that does):
//   (a) fund    0.05 SOL from the funder key to the new group address (tools/fund.mjs, in this
//               process; the address must equal the one that the app shows)
//   (b) nonce   seat 1 proposes, seats 1 and 2 approve and sign (a recent blockhash lifetime)
//   (c) register  seat 2 proposes, seats 2 and 3 approve and sign (the durable nonce)
//   (d) shield  seat 3 proposes 0.02 SOL, seats 1 and 3 approve and sign
// Then it checks, outside the app code (tools/verify-chain.mjs): each first signature under the
// group key (the funding one under the funder), the registry record against the soldone keys,
// the nonce account, and the shielded balance that the Solana Worker reads after the shield.
// The results go to solspike/logs/p8e-results.json after every step (public values only).
// Run: lockf -k "$SOL/heavy.lock" node solspike/harness/scenario-e.mjs     (Node 24, with
// SOLSPIKE_PORT=8797 SOLSPIKE_CHROME_PORTS=9380-9389 on this track, ONE lockf wrapper).
// With --rehearse it moves no fund and lands nothing: it runs the same steps up to the funding,
// then taps "Create nonce account" on the unfunded address, where the network must refuse the
// test run of the message (nothing is proposed). The results go to solspike/logs/rehearsal-e.json.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fund } from "../tools/fund.mjs";
import {
  addressOfKey,
  nonceAccountOf,
  verifyNonceAccount,
  verifyRecord,
  verifyTransaction,
} from "../tools/verify-chain.mjs";
import { waitFor } from "./chrome.mjs";
import { banner, clickMark, landStep, privateBalance, publicBalance, sessions } from "./flow.mjs";
import { redact } from "./redact.mjs";
import { consoleProblems } from "./sol-facts.mjs";
import { solanaReady, zcashWallet } from "./seats.mjs";
import { withStack } from "./stack.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REHEARSE = process.argv.includes("--rehearse");
const RESULTS = join(HERE, REHEARSE ? "../logs/rehearsal-e.json" : "../logs/p8e-results.json");
const HEAD = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: HERE }).trim();
const FUND = 50_000_000n;
const results = { head: HEAD, cluster: "devnet", transactions: [], checks: {} };

// The read-only dry run (dryrun.mjs), if it ran: the answers of the network for the template.
function dryRunReport() {
  try {
    return JSON.parse(readFileSync(join(HERE, "../logs/dryrun.json"), "utf8"));
  } catch {
    return null;
  }
}

// What the run cost: the funder paid the transfer and its fee, the group paid three fees and
// the two rents, and the shield stays in the pool.
function spend(sent) {
  const fees = results.transactions.filter((t) => t.label !== "fund").map((t) => BigInt(t.fee));
  const groupFees = fees.reduce((sum, fee) => sum + fee, 0n);
  return {
    funderOutflow: String(FUND + BigInt(sent.fee)),
    groupFees: String(groupFees),
    rents: String(1_056_640n + 1_330_960n),
    shielded: "20000000",
  };
}

const onRetry = (step, error) => {
  results.retries = [...(results.retries ?? []), { step, error }];
  save();
};

function save() {
  mkdirSync(dirname(RESULTS), { recursive: true });
  writeFileSync(RESULTS, redact(JSON.stringify(results, null, 1)) + "\n");
}

const STEPS = [
  { label: "nonce", kind: "createNonce", button: "create-nonce", proposer: 1, approvers: [1, 2] },
  { label: "register", kind: "register", button: "register", proposer: 2, approvers: [2, 3] },
  { label: "shield", kind: "shield", button: "shield", proposer: 3, approvers: [1, 3] },
];

async function funding(pages, keys) {
  const to = addressOfKey(keys.groupKey);
  assert.equal(keys.owner, to, "the app shows the base58 text of the group key");
  const sent = await fund({ to, shown: keys.owner, lamports: FUND });
  results.transactions.push({ label: "fund", signedBy: "funder", ...sent });
  save();
  assert.equal(await publicBalance(pages[0], "0.05 SOL"), "0.05 SOL", "the app reads the funding");
  return sent;
}

async function checks(keys, sent) {
  const verified = [];
  const funding = await verifyTransaction(sent.signature, sent.funder);
  Object.assign(results.transactions[0], funding);
  assert.ok(funding.firstSignatureVerifies && funding.err === null, "the funding transaction");
  verified.push(funding);
  for (const tx of results.transactions.filter((t) => t.label !== "fund")) {
    const check = await verifyTransaction(tx.signature, keys.owner);
    Object.assign(tx, check);
    assert.equal(check.err, null, tx.label + " has no error");
    assert.ok(check.firstSignatureVerifies, tx.label + ": the first signature verifies");
    assert.ok(check.payerIsSigner && check.firstSignatureIsTxId, tx.label + ": payer and id");
    verified.push(check);
  }
  return verified;
}

async function chainState(keys) {
  const account = nonceAccountOf(keys.groupKey);
  const nullifierPk = keys.shielded.slice(68, 132),
    viewingPk = keys.shielded.slice(132, 198);
  const nonce = (results.checks.nonceAccount = await verifyNonceAccount(account, keys.groupKey));
  const record = (results.checks.registryRecord = await verifyRecord(keys.groupKey, {
    nullifierPk,
    viewingPk,
  }));
  assert.ok(nonce.systemOwned && nonce.initialised && nonce.authorityIsGroup, "the nonce account");
  const same = record.ownerIsGroup && record.nullifierEqualsSoldone && record.viewingEqualsSoldone;
  assert.ok(same && record.ownerP256Absent && record.registryOwned, "the registry record");
}

// The unfunded address: the proposal is refused by the test run, and no session is made.
async function rehearsal(pages) {
  await clickMark(pages[0], "create-nonce");
  const refused = async () => {
    const text = await banner(pages[0]);
    return /refused this message in a test run/.test(text) ? text : "";
  };
  const text = await waitFor(refused, 60000, () => "the refusal of the test run");
  assert.deepEqual(await sessions(pages[0]), [], "nothing was proposed");
  results.rehearsal = { refusal: redact(text).slice(0, 240) };
}

async function scenario(rig) {
  const { pages, gid } = await zcashWallet(rig, "P8e wallet");
  const keys = await solanaReady(pages, gid);
  results.group = { owner: keys.owner, groupKey: keys.groupKey };
  // Warm the Worker of every page (and read the empty balance) before anything is proposed.
  const before = await Promise.all(pages.map((page) => publicBalance(page, "0 SOL")));
  assert.deepEqual(before, ["0 SOL", "0 SOL", "0 SOL"], "every seat reads the empty address");
  save();
  if (REHEARSE) {
    await rehearsal(pages);
    results.problems = pages.map((p) => consoleProblems(p.records).length);
    save();
    return;
  }
  const sent = await funding(pages, keys);
  for (const step of STEPS) {
    const done = await landStep(pages, step, onRetry);
    results.transactions.push({ label: step.label, seats: step.approvers, ...done });
    save();
  }
  await afterwards(pages, gid, keys, sent);
}

// Every check that can still be made is made and saved, and only then does an assertion stop the
// run: a failed check must not cost the evidence of the others, which cannot be had again.
async function afterwards(pages, gid, keys, sent) {
  const failures = (results.failures = []);
  const attempt = async (label, run) => {
    try {
      return await run();
    } catch (err) {
      failures.push(`${label}: ${redact(String(err?.message ?? err))}`);
      return null;
    }
  };
  await attempt("transactions", () => checks(keys, sent));
  await attempt("chain state", () => chainState(keys));
  results.balances = { public: await attempt("public balance", () => publicBalance(pages[0])) };
  const small = Number.parseFloat(results.balances.public) < 0.0276;
  if (!small) failures.push("the public balance: the rents and the shield did not leave");
  results.balances.private = await attempt("private balance", () =>
    privateBalance(pages[0], "0.02 SOL"),
  );
  results.nonces = await attempt("nonces", () => noncesGone(pages, gid));
  results.problems = pages.map((p) => consoleProblems(p.records).length);
  if (results.problems.some(Boolean)) failures.push("console problems: " + results.problems);
  results.spend = spend(sent);
  results.dryRun = dryRunReport();
  save();
  assert.deepEqual(failures, [], "every check of the landing holds");
  console.log(
    redact(JSON.stringify({ transactions: results.transactions.length, ...results.balances })),
  );
}

withStack("scenario-e", scenario).catch((err) => {
  results.error = redact(String(err?.message ?? err));
  save();
  console.error(redact(String(err?.stack ?? err)));
  process.exitCode = 1;
});
