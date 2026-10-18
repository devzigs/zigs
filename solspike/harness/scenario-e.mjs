// Live check of the setup of a new group: three seats in three in-memory contexts of one Chrome
// (the rig) make a 2-of-3 wallet and its Solana part. A new group shows no move card and no nonce
// account step. The funder sends 0.003 SOL to the fee address of seat 1, the proposing seat, and
// seat 1 adds 0.002 SOL to the private balance of the group (Add SOL). Checks outside the app: the
// fee address of seat 1 pays the Add SOL transaction, and every seat syncs the private balance.
// THIS RUN LANDS TWO TRANSACTIONS on Devnet (PLAN). Results: solspike/logs/scenario-e.json.
// With --mock (harness/mock.mjs) it makes no Devnet call: every step runs against the fake chain
// of the web tests (harness/mock-chain.mjs), and the results go to solspike/logs/mock-e.json.
// Run: node solspike/harness/scenario-e.mjs [--mock]   (README.md, "Live scenarios")
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fund } from "../tools/fund.mjs";
import { confirmed, payerOf } from "../tools/program-chain.mjs";
import { addSol, feeAddresses, feeFunded, privateBalance, problemsOf } from "./flow.mjs";
import { MOCK, heliusAnswers, withMockUrl } from "./mock.mjs";
import { run } from "./page.mjs";
import { redact } from "./redact.mjs";
import { solanaReady, zcashWallet } from "./seats.mjs";
import { withStack } from "./stack.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, MOCK ? "../logs/mock-e.json" : "../logs/scenario-e.json");
const HEAD = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: HERE }).trim();
const ADD = "0.002";
// Every Devnet transaction of the run: the payer, and the lamports that leave it (fees aside).
const PLAN = [
  { label: "fund-seat1", payer: "funder", to: "fee address of seat 1", lamports: 3_000_000n },
  { label: "add-sol", payer: "fee address of seat 1", to: "the pool", lamports: 2_000_000n },
];
const LIVE_TOOLS = { fund, confirmed, payerOf };
const results = { head: HEAD, cluster: "devnet", mock: MOCK, steps: [] };

function save() {
  mkdirSync(dirname(RESULTS), { recursive: true });
  writeFileSync(RESULTS, redact(JSON.stringify(results, null, 1)) + "\n");
}

const record = (label, facts) => {
  results.steps.push({ label, ...facts });
  save();
};

const has = (page, mark) => run(page, (m) => !!document.querySelector(`[data-sol="${m}"]`), mark);

async function newGroup(rig) {
  const { pages, gid } = await zcashWallet(rig, "Scenario E wallet");
  const keys = await solanaReady(pages, gid);
  for (const page of pages) {
    assert.equal(await has(page, "move"), false, "a new group has no move card");
    assert.equal(await has(page, "create-nonce"), false, "a new group has no nonce account step");
  }
  const fees = await feeAddresses(pages);
  results.group = { owner: keys.owner, groupKey: keys.groupKey, fees };
  record("ready", {});
  return { pages, fees };
}

async function steps(pages, fees, tools) {
  const sent = await tools.fund({ to: fees[1], shown: fees[1], lamports: PLAN[0].lamports });
  record("fund-seat1", { signature: sent.signature, lamports: String(PLAN[0].lamports) });
  await feeFunded(pages[0], 1);
  const signature = await addSol(pages[0], ADD);
  await tools.confirmed(signature);
  assert.equal(await tools.payerOf(signature), fees[1], "the fee address of seat 1 pays Add SOL");
  record("add-sol", { signature });
  for (const page of pages) await privateBalance(page, `${ADD} SOL`);
  results.problems = pages.map((p) => problemsOf(p).length);
  assert.deepEqual(results.problems, [0, 0, 0], "no console problem or CSP violation");
  if (MOCK) assert.equal(heliusAnswers(pages), 0, "no answer from the Helius host");
}

async function scenario(rig) {
  results.plan = PLAN.map((tx) => ({ ...tx, lamports: String(tx.lamports) }));
  const tools = MOCK ? (await import("./mock-chain.mjs")).mockTools(rig) : LIVE_TOOLS;
  const { pages, fees } = await newGroup(rig);
  await steps(pages, fees, tools);
  console.log(redact(JSON.stringify({ mock: MOCK, steps: results.steps.map((s) => s.label) })));
}

withMockUrl(() => withStack("scenario-e", scenario)).catch((err) => {
  results.error = redact(String(err?.message ?? err));
  save();
  console.error(redact(String(err?.stack ?? err)));
  process.exitCode = 1;
});
