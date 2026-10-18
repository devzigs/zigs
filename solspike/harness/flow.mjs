// The steps that the live scenarios share (scenario-e.mjs, scenario-f.mjs): taps on the controls
// that the Solana tab marks with data-sol, Add SOL, one payment through the approvals program,
// and the balances. The pages show public values only, and every error text goes through redact().
import assert from "node:assert/strict";
import { sleep, waitFor } from "./chrome.mjs";
import { run, setInput } from "./page.mjs";
import { redact } from "./redact.mjs";
import { solValues } from "./seats.mjs";
import { consoleProblems } from "./sol-facts.mjs";

/** Clicks a control that the page marks with data-sol. Waits for it, and for it to be enabled. */
export async function clickMark(page, mark, ms = 30000) {
  const click = (name) => {
    const el = document.querySelector(`[data-sol="${name}"]`);
    if (!el || el.disabled) return false;
    el.click();
    return true;
  };
  await waitFor(
    () => run(page, click, mark),
    ms,
    () => `the control ${mark}`,
  );
}

export const sessions = (page) =>
  run(page, () =>
    [...document.querySelectorAll("[data-session]")].map((el) => ({
      id: el.dataset.session,
      kind: el.dataset.kind,
      state: el.dataset.state,
      result: el.querySelector('[data-sol="result"]')?.textContent ?? null,
      error: el.querySelector(".bad")?.textContent ?? null,
    })),
  );

export const banner = (page) =>
  run(page, () => document.getElementById("banner-text")?.textContent ?? "").catch(() => "");

/** A failed wait says what the banner of the page shows (an action that was refused). */
export async function withBanner(page, waiting) {
  try {
    return await waiting;
  } catch (err) {
    throw new Error(`${err.message}. Banner: ${redact(await banner(page))}`);
  }
}

/** Waits until the session `id` of this page has the state. A failed session stops the wait. */
export async function waitState(page, id, state, ms) {
  await waitFor(
    async () => {
      const mine = (await sessions(page)).find((s) => s.id === id);
      if (mine?.state === "failed") throw new Error(`session failed: ${mine.error}`);
      return mine?.state === state;
    },
    ms,
    () => `session ${id.slice(0, 8)} to be ${state}`,
  );
}

// The text of the approval screen that this page shows for the session: public values only.
export const screenOf = (page, id) =>
  run(page, (name) => document.querySelector(`[data-sol="review-${name}"]`)?.innerText ?? null, id);

// True when the page shows no Approve control for the session (an approval is not offered twice).
export const noApprove = (page, id) =>
  run(page, (name) => !document.querySelector(`[data-sol^="approve-${name}"]`), id);

const rowOf = (lines, name) => {
  const i = lines.indexOf(name);
  return i >= 0 ? lines[i + 1] : null;
};

/** The fee address of each seat, as the pages show them (seat i on page i). */
export async function feeAddresses(pages) {
  const out = {};
  for (const [i, page] of pages.entries()) {
    const mark = `fee-address-${i + 1}`;
    await waitFor(async () => (await solValues(page))[mark], 60000, () => "the mark " + mark);
    out[i + 1] = (await solValues(page))[mark];
  }
  return out;
}

/** Taps "Check balance" until the page shows a balance above 0 for the fee address of `seat`. */
export async function feeFunded(page, seat) {
  let seen = "";
  await waitFor(
    async () => {
      await clickMark(page, "refresh");
      await sleep(2500);
      seen = (await solValues(page))[`fee-balance-${seat}`] ?? "";
      return /^Balance: 0\.\d*[1-9]\d* SOL$/.test(seen);
    },
    90000,
    () => `the fee balance of seat ${seat} (last ${seen})`,
  );
  return seen;
}

/** Types `amount` (text, for example "0.002") in the Add SOL form and taps Add SOL. */
async function tapAddSol(page, amount) {
  await setInput(page, "#sol-add-amount", amount);
  await clickMark(page, "add-sol");
}

/** Add SOL from the fee address of the seat of `page`. Returns the signature that it shows. */
export async function addSol(page, amount) {
  await tapAddSol(page, amount);
  const line = new RegExp(`^Added ${amount.replace(".", "\\.")} SOL, seat \\d: (\\w+)(?: ↗)?$`);
  let seen = "";
  await waitFor(
    async () => line.test((seen = (await solValues(page)).added ?? "")),
    180000,
    () => `the Add SOL line (last ${seen})`,
  );
  return line.exec(seen)[1];
}

/** Fills the send form (or the withdraw form, with `withdrawTo`) and taps it. */
async function tapPay(page, { amount, payee, withdrawTo }) {
  const [form, to] = withdrawTo ? ["withdraw", withdrawTo] : ["send", payee];
  await setInput(page, `#sol-${form}-to`, to);
  await setInput(page, `#sol-${form}-amount`, amount);
  await clickMark(page, form);
}

const sessionIds = async (page) => new Set((await sessions(page)).map((s) => s.id));

/**
 * A tap of a payment that the page must refuse: it shows a new banner that matches `want` and
 * proposes nothing. The default `want` is the refusal of a mock run (harness/mock-chain.mjs): the
 * fake chain has no payment for a new group, so the prepare of the Worker refuses it. Returns the
 * banner text.
 */
export async function refusedTap(page, spec, want = /no payment is prepared/) {
  const known = await sessionIds(page);
  const before = await banner(page);
  await tapPay(page, spec);
  let last = before;
  const refused = async () => {
    last = await banner(page);
    return last !== before && want.test(last) ? last : "";
  };
  const text = await waitFor(refused, 120000, () => `the refusal (last ${redact(last)})`);
  const added = [...(await sessionIds(page))].filter((id) => !known.has(id));
  assert.deepEqual(added, [], "the refused tap proposed nothing");
  return redact(text);
}

/** The approval screen of session `id` on each page but `skip`, as lines, keyed by "seat N". */
export async function screensOf(pages, id, skip) {
  const out = {};
  for (const [i, each] of pages.entries()) {
    if (i === skip) continue;
    await waitState(each, id, "collecting", 120000);
    await waitFor(() => screenOf(each, id), 120000, () => "the screen of seat " + (i + 1));
    out["seat " + (i + 1)] = (await screenOf(each, id)).split("\n").filter(Boolean);
  }
  return out;
}

/** The proposer taps the form. Resolves the id of its new session. */
export async function proposed(page, spec) {
  const known = await sessionIds(page);
  await tapPay(page, spec);
  const kind = spec.withdrawTo ? "withdraw" : "approve";
  const found = async () =>
    (await sessions(page)).find((s) => s.kind === kind && !known.has(s.id))?.id;
  return withBanner(page, waitFor(found, 400000, () => "the proposal of " + spec.label));
}

/** The approvers tap Approve one by one. After the first, `stillOpen()` must hold for 30 s. */
export async function approveAll(pages, id, approvers, stillOpen) {
  for (const [n, seat] of approvers.entries()) {
    await clickMark(pages[seat - 1], `approve-${id}-${seat}`);
    if (n > 0) continue;
    await sleep(30000);
    assert.ok(await stillOpen(), "one approval: the account waits and nothing executes");
  }
}

/** The screen names the proposal account, the amount, the public link, and the recipient. */
export function screenProposal(lines, { amount, withdrawTo }) {
  const text = lines.join("\n");
  const proposal = rowOf(lines, "Proposal account")?.replace(/ ↗$/, ""); // the explorer link
  assert.ok(proposal, "the screen names the proposal account");
  assert.ok(text.includes(`${amount} SOL`) && text.includes("Public link"), "the screen");
  if (withdrawTo) assert.ok(text.includes(withdrawTo), "the screen names the recipient");
  return proposal;
}

/**
 * One payment, or a withdrawal with `spec.withdrawTo`: seat `proposer` taps the form, every page
 * shows the screen, the approvers tap Approve, and every page shows the session as sent. With
 * `dropProposer` the page of the proposer closes before the approvals. `proposalOpen(address)`
 * reads the proposal account on the chain. Returns { id, proposal, signature, screens, alive }.
 */
export async function pay(pages, spec, proposalOpen) {
  const { proposer, approvers, dropProposer } = spec;
  const page = pages[proposer - 1];
  const id = await proposed(page, spec);
  const screens = await screensOf(pages, id, dropProposer ? proposer - 1 : -1);
  const proposal = screenProposal(screens["seat " + approvers[0]], spec);
  assert.ok(await proposalOpen(proposal), "the proposal account exists before any approval");
  const alive = dropProposer ? pages.filter((p) => p !== page) : pages;
  if (dropProposer) await page.context.dispose();
  await approveAll(pages, id, approvers, () => proposalOpen(proposal));
  for (const each of alive) await waitState(each, id, "sent", 400000);
  for (const each of alive) assert.ok(await noApprove(each, id), "no Approve control is left");
  const [mine] = (await sessions(alive[0])).filter((s) => s.id === id);
  const seen = /^(Executed|Failed on chain) in slot (\d+): (\w+)(?: ↗)?$/.exec(mine.result ?? "");
  assert.ok(seen && seen[1] === "Executed", `the result line of ${spec.label}: ${mine.result}`);
  return { id, proposal, signature: seen[3], screens, alive };
}

/** Taps "Sync Solana" until the shielded balance is `want`: the indexer may need a moment. */
export async function privateBalance(page, want) {
  let seen = "";
  await waitFor(
    async () => {
      await clickMark(page, "sync");
      await sleep(4000);
      seen = (await solValues(page))["balance-private"];
      return seen === want;
    },
    180000,
    () => `the private balance ${want} (last ${seen})`,
  );
  return seen;
}

/**
 * The console problems of a page and its Workers, without a 503 of /lwd: the dev server has no
 * light-wallet key (README.md, "The local server"), so the Zcash part uses another server. Any
 * other 503 response counts.
 */
export function problemsOf(page) {
  const others = consoleProblems(page.records).filter((p) => !/status of 503/.test(p.text));
  const down = page.records.filter((r) => r.kind === "response" && r.status === 503);
  return [...others, ...down.filter((r) => !new URL(r.url).pathname.startsWith("/lwd/"))];
}

// After the last session, no page holds a nonce or a made share: they are spent or dropped.
export async function noncesGone(pages, gid) {
  const residue = (page) =>
    run(
      page,
      (g) => {
        const all = JSON.parse(localStorage.getItem("zf-secrets") || "{}");
        return Object.entries(all)
          .filter(([key]) => key.startsWith(g + ":"))
          .map(
            ([, s]) =>
              Object.keys(s.sol?.nonces ?? {}).length + Object.keys(s.sol?.pending ?? {}).length,
          );
      },
      gid,
    );
  const counts = async () => (await Promise.all(pages.map(residue))).flat();
  await waitFor(
    async () => (await counts()).every((n) => n === 0),
    30000,
    () => "no nonce left",
  );
  return { nonces: await counts() };
}
