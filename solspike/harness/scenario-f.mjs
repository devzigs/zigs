// P8f live check: a private payment from the group to key B, the restore rehearsal, and a second
// payment after the restore. Three seats in three in-memory contexts of one Chrome (the rig) on
// the local dev server (cf/.dev.vars has SOL=1). THIS RUN LANDS SEVEN TRANSACTIONS on Devnet and
// spends at most 0.05 SOL of the funder (the brief of the P8f track allows it; it is the only run
// that does). The P8e group could not be used: its seats lived in memory and nobody saved a
// backup, so no share is left. This run makes a new group and does the setup of P8e again.
//   (a) fund 0.015 SOL, create the nonce account, register, shield 0.008 SOL (seats 1+2, 2+3, 1+3)
//   (b) pay 0.005 SOL to B: seat 1 proposes, seats 1 and 2 approve and sign, seat 3 only reads
//   (c) every seat saves its Zcash backup and its Solana backup; the three contexts are disposed
//   (d) three new blank contexts restore the Zcash seat, then the Solana part, from the files
//   (e) pay 0.002 SOL to B: seat 3 proposes, seats 2 and 3 approve and sign
// It checks outside the app (tools/verify-chain.mjs, tools/key-b.mjs): each first signature under
// the group key, the lifetime (the nonce value), B's shielded balance and the group balance.
// The results go to solspike/logs/p8f-results.json after every step (public values only). The files
// of the backups (encrypted text) go to solspike/.state/p8f, the passphrases stay in memory.
// With --rehearse it moves no fund and lands nothing: it makes the group and its Solana part, then
// runs the backup, the wipe and the restore. The results go to solspike/logs/rehearsal-f.json.
// Run: lockf -k "$SOL/heavy.lock" node solspike/harness/scenario-f.mjs     (Node 24, with
// SOLSPIKE_PORT=8797 SOLSPIKE_CHROME_PORTS=9380-9389 on this track, ONE lockf wrapper).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fund } from "../tools/fund.mjs";
import { interimFile } from "../tools/paths.mjs";
import { addressOfB, balanceOfB } from "../tools/key-b.mjs";
import {
  addressOfKey,
  nonceAccountOf,
  verifyNonceAccount,
  verifyRecord,
  verifyTransaction,
} from "../tools/verify-chain.mjs";
import {
  assertBlank,
  checkFiles,
  restoreSolana,
  restoreZcash,
  solanaBackup,
  zcashBackup,
} from "./backups.mjs";
import { waitFor } from "./chrome.mjs";
import { landStep, noncesGone, privateBalance, publicBalance } from "./flow.mjs";
import { clickText, run, setInput } from "./page.mjs";
import { redact } from "./redact.mjs";
import { openApp, solValues, solanaReady, zcashWallet } from "./seats.mjs";
import { consoleProblems } from "./sol-facts.mjs";
import { withStack } from "./stack.mjs";
import { ORIGIN } from "./server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REHEARSE = process.argv.includes("--rehearse");
const RESULTS = join(HERE, REHEARSE ? "../logs/rehearsal-f.json" : "../logs/p8f-results.json");
const FILES = join(HERE, "../.state/p8f");
// The interim backups (after the shield) let a run that fails before the payment start again from
// a restore, without a second funding. Their passphrases are the only secret that this run writes:
// one file outside the repo (SOLSPIKE_INTERIM), mode 600, for the test group of this run.
const INTERIM = interimFile();
const RESUME = process.argv.includes("--resume");
const HEAD = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: HERE }).trim();
const FUND = 15_000_000n;
const results = { head: HEAD, cluster: "devnet", transactions: [], checks: {}, restore: {} };

function save() {
  mkdirSync(dirname(RESULTS), { recursive: true });
  writeFileSync(RESULTS, redact(JSON.stringify(results, null, 1)) + "\n");
}

const onRetry = (step, error) => {
  results.retries = [...(results.retries ?? []), { step, error }];
  save();
};

const setValue = (selector, value) => (page) => setInput(page, selector, value);
const SETUP = [
  { label: "nonce", kind: "createNonce", button: "create-nonce", proposer: 1, approvers: [1, 2] },
  { label: "register", kind: "register", button: "register", proposer: 2, approvers: [2, 3] },
  {
    label: "shield",
    kind: "shield",
    button: "shield",
    proposer: 3,
    approvers: [1, 3],
    before: setValue("#sol-amount", "0.008"),
  },
];

/** The step of a private payment to the payee, proposed by one seat, signed by two. */
function payment(label, { payee, amount, proposer, approvers, observers }) {
  const before = async (page) => {
    await setInput(page, "#sol-send-to", payee);
    await setInput(page, "#sol-send-amount", amount);
  };
  const base = { label, kind: "transfer", button: "send", proposer, approvers, observers };
  return { ...base, before, proposalMs: 300000 };
}

const slotOf = async (page) => {
  const seen = /slot (\d+)/.exec((await solValues(page)).worker ?? "");
  assert.ok(seen, "the page shows the slot of its sync");
  return Number(seen[1]);
};

async function funding(pages, keys) {
  const to = addressOfKey(keys.groupKey);
  assert.equal(keys.owner, to, "the app shows the base58 text of the group key");
  const sent = await fund({ to, shown: keys.owner, lamports: FUND });
  results.transactions.push({ label: "fund", signedBy: "funder", ...sent });
  save();
  await publicBalance(pages[0], "0.015 SOL");
  return sent;
}

/** Checks one landed transaction outside the app and adds its numbers to the record. */
async function verified(tx, keys, lifetime) {
  const check = await verifyTransaction(tx.signature, keys.owner);
  Object.assign(tx, check);
  assert.equal(check.err, null, tx.label + " has no error");
  assert.ok(check.firstSignatureVerifies, tx.label + ": the first signature verifies");
  assert.ok(check.payerIsSigner && check.firstSignatureIsTxId, tx.label + ": payer and id");
  if (lifetime) assert.equal(check.lifetime, lifetime, tx.label + ": the lifetime is the nonce");
  return check;
}

async function setupGroup(pages, keys) {
  const sent = await funding(pages, keys);
  const record = (tx) => results.transactions.push(tx) && save();
  for (const step of SETUP) {
    const done = await landStep(pages, step, onRetry);
    record({ label: step.label, seats: step.approvers, ...done });
  }
  const account = nonceAccountOf(keys.groupKey);
  const nonce = await verifyNonceAccount(account, keys.groupKey);
  const nullifierPk = keys.shielded.slice(68, 132);
  const viewingPk = keys.shielded.slice(132, 198);
  const rec = await verifyRecord(keys.groupKey, { nullifierPk, viewingPk });
  results.checks.setup = { nonceAccount: nonce, registryRecord: rec };
  await verified(results.transactions[0], { owner: sent.funder });
  await privateBalance(pages[0], "0.008 SOL");
  save();
}

const sameScreens = (screens) => {
  const [first, ...rest] = Object.values(screens);
  return rest.every((one) => JSON.stringify(one) === JSON.stringify(first));
};

/** One private payment of `lamports`, landed and checked. `pages` are the three live pages. */
async function pay(pages, keys, spec) {
  const { label, amount, lamports, expectPrivate } = spec;
  const before = await balanceOfB();
  const account = nonceAccountOf(keys.groupKey);
  const nonce = (await verifyNonceAccount(account, keys.groupKey)).nonce;
  const publicBefore = await publicBalance(pages[0]);
  const step = payment(label, spec);
  const done = await landStep(pages, step, onRetry);
  const tx = { label, seats: spec.approvers, proposer: spec.proposer, amount, ...done };
  results.transactions.push(tx);
  save();
  const check = await verified(tx, keys, nonce);
  assert.equal(Object.keys(done.screens).length, 3, "all three seats show the screen");
  assert.ok(sameScreens(done.screens), "the three checkers give the same text");
  const text = done.screens["seat " + spec.approvers[0]].join("\n");
  assert.match(
    text,
    new RegExp(amount.replace(".", "\\.") + " SOL"),
    "the screen shows the amount",
  );
  const after = await balanceOfB(done.slot);
  assert.equal(after - before, lamports, label + ": B rises by the amount");
  const group = await privateBalance(pages[0], expectPrivate);
  const publicAfter = await publicBalance(pages[0]);
  Object.assign(tx, {
    template: check.template,
    nonceBefore: nonce,
    b: { before: String(before), after: String(after), delta: String(after - before) },
    group: { private: group, publicBefore, publicAfter },
  });
  save();
  return tx;
}

/** Every seat saves its Zcash and its Solana backup. Returns { zcash: [...], solana: [...] }. */
async function backups(pages, prefix = "") {
  const out = { zcash: [], solana: [] };
  const facts = [];
  mkdirSync(FILES, { recursive: true });
  for (const [i, page] of pages.entries()) {
    const seat = i + 1;
    for (const [kind, make] of [
      ["zcash", () => zcashBackup(page)],
      ["solana", () => solanaBackup(page, seat)],
    ]) {
      const file = await make();
      assert.ok(!/solSeed|keyPackage|signing_share/.test(file.text), "the file shows no secret");
      writeFileSync(join(FILES, `${prefix}seat${seat}-${kind}.zigsbackup`), file.text);
      out[kind].push(file);
    }
    facts.push(checkFiles(out.zcash[i], out.solana[i]));
  }
  results.restore.files = facts;
  return out;
}

async function restored(rig, files, gid) {
  const pages = [];
  for (const i of [1, 2, 3]) {
    const page = await openApp(rig, "restore" + i, `${ORIGIN}/`);
    await assertBlank(page);
    pages.push(page);
  }
  for (const [i, page] of pages.entries()) await restoreZcash(page, files.zcash[i], gid);
  for (const [i, page] of pages.entries()) {
    await waitFor(
      () => run(page, () => !!document.getElementById("tab-solana")),
      60000,
      () => "the Solana tab",
    );
    await clickText(page, "Solana", { exact: true });
    await restoreSolana(page, files.solana[i]);
  }
  return pages;
}

async function afterRestore(pages, keys, before) {
  for (const page of pages) {
    await waitFor(
      async () => (await solValues(page)).status === "ready",
      180000,
      () => "status ready after the restore",
    );
  }
  const seen = await Promise.all(pages.map(solValues));
  for (const name of ["owner", "group-key", "shielded"]) {
    assert.ok(seen.every((v) => v[name] === keys[name === "group-key" ? "groupKey" : name]));
  }
  const balances = [];
  for (const page of pages) balances.push(await privateBalance(page, before.balance));
  const slots = await Promise.all(pages.map(slotOf));
  assert.ok(
    slots.every((s) => s >= before.slot),
    "every sync reads the slot S or a later one",
  );
  return { balances, slots };
}

async function rehearsal(rig, pages, gid, keys, want = "0.003 SOL") {
  const before = { balance: await privateBalance(pages[0], want), slot: 0 };
  before.slot = await slotOf(pages[0]);
  results.noncesBeforeBackup = (await noncesGone(pages, gid)).nonces;
  const files = await backups(pages);
  results.problemsBefore = pages.map((p) => consoleProblems(p.records).length);
  Object.assign(results.restore, { oldBalance: before.balance, slotS: before.slot, wiped: true });
  for (const page of pages) await page.context.dispose();
  save();
  const fresh = await restored(rig, files, gid);
  const after = await afterRestore(fresh, keys, before);
  Object.assign(results.restore, { restoredBalances: after.balances, slots: after.slots });
  save();
  return fresh;
}

async function finish(pages, gid) {
  results.nonces = (await noncesGone(pages, gid)).nonces;
  results.problems = pages.map((p) => consoleProblems(p.records).length);
  assert.ok(
    results.problems.every((n) => n === 0),
    "no console problem or CSP violation",
  );
  save();
}

const paidA = () => results.transactions.some((t) => t.label === "pay-a");

function saveInterim(files, gid, keys) {
  mkdirSync(dirname(INTERIM), { recursive: true });
  const list = (kind) => files[kind].map(({ name, pass }) => ({ name, pass }));
  const saved = { gid, keys, zcash: list("zcash"), solana: list("solana") };
  writeFileSync(INTERIM, JSON.stringify(saved), { mode: 0o600 });
  chmodSync(INTERIM, 0o600);
}

function loadInterim() {
  const saved = JSON.parse(readFileSync(INTERIM, "utf8"));
  const withText = (kind) =>
    saved[kind].map((f, i) => ({
      ...f,
      text: readFileSync(join(FILES, `interim-seat${i + 1}-${kind}.zigsbackup`), "utf8"),
    }));
  const files = { zcash: withText("zcash"), solana: withText("solana") };
  for (const one of [...files.zcash, ...files.solana]) redact.add(one.pass);
  return { gid: saved.gid, keys: saved.keys, files };
}

/** A new group on three pages: Zcash wallet, Solana part, funding, nonce, register, shield. */
async function created(rig) {
  const { pages, gid } = await zcashWallet(rig, "P8f wallet");
  const keys = await solanaReady(pages, gid);
  results.group = { owner: keys.owner, groupKey: keys.groupKey };
  await Promise.all(pages.map((page) => publicBalance(page, "0 SOL")));
  save();
  if (REHEARSE) return { pages, gid, keys };
  await setupGroup(pages, keys);
  saveInterim(await backups(pages, "interim-"), gid, keys);
  return { pages, gid, keys };
}

/** The pages of an earlier run of this scenario, restored from its interim backups. */
async function resumed(rig) {
  const { gid, keys, files } = loadInterim();
  const pages = await restored(rig, files, gid);
  // The payment (a) may have landed in the run that stopped: the balance is then the change.
  const balance = paidA() ? "0.003 SOL" : "0.008 SOL";
  await afterRestore(pages, keys, { balance, slot: 0 });
  results.resumed = (results.resumed ?? 0) + 1;
  return { pages, gid, keys };
}

async function scenario(rig) {
  const payee = await addressOfB();
  if (RESUME) {
    Object.assign(results, JSON.parse(readFileSync(RESULTS, "utf8")));
    delete results.error; // the run that stopped left its error here
  }
  // Each run adds its head: a resumed run can have code that the first run did not have.
  results.runs = [...(results.runs ?? []), { head: HEAD, resume: RESUME }];
  results.head = HEAD;
  const { pages, gid, keys } = await (RESUME ? resumed(rig) : created(rig));
  if (REHEARSE) {
    // No fund moves and nothing lands: the backup, the wipe and the restore of an empty group.
    await rehearsal(rig, pages, gid, keys, "0 SOL");
    return;
  }
  if (!paidA()) {
    const first = { amount: "0.005", lamports: 5_000_000n, expectPrivate: "0.003 SOL" };
    const seatsA = { proposer: 1, approvers: [1, 2], observers: [3], payee };
    await pay(pages, keys, { label: "pay-a", ...first, ...seatsA });
  }
  const fresh = await rehearsal(rig, pages, gid, keys);
  const second = { amount: "0.002", lamports: 2_000_000n, expectPrivate: "0.001 SOL" };
  const seatsC = { proposer: 3, approvers: [2, 3], observers: [1], payee };
  await pay(fresh, keys, { label: "pay-c", ...second, ...seatsC });
  await finish(fresh, gid);
  console.log(redact(JSON.stringify({ transactions: results.transactions.length })));
}

withStack("scenario-f", scenario).catch((err) => {
  results.error = redact(String(err?.message ?? err));
  save();
  console.error(redact(String(err?.stack ?? err)));
  process.exitCode = 1;
});
