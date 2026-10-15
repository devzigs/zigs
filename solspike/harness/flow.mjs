// The steps that the live scenarios share (scenario-e.mjs, scenario-f.mjs): taps on the controls
// that the Solana tab marks with data-sol, the wait for a session to land, and the balances. The
// pages show public values only, and every error text goes through redact().
import assert from "node:assert/strict";
import { sleep, waitFor } from "./chrome.mjs";
import { run } from "./page.mjs";
import { redact } from "./redact.mjs";
import { solValues } from "./seats.mjs";

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

/**
 * One intent: the proposer taps the button (after `step.before(page)`, which fills a form), the
 * approvers tap Approve in parallel. The `observers` only read their screen.
 */
export async function land(pages, step) {
  const page = pages[step.proposer - 1];
  const known = new Set((await sessions(page)).map((s) => s.id));
  await step.before?.(page);
  await clickMark(page, step.button);
  const found = async () =>
    (await sessions(page)).find((s) => s.kind === step.kind && !known.has(s.id))?.id;
  const id = await withBanner(
    page,
    waitFor(found, step.proposalMs ?? 60000, () => `the proposal of ${step.label}`),
  );
  const screens = {};
  const read = async (seat) => {
    const mine = pages[seat - 1];
    await waitState(mine, id, "collecting", 60000);
    await waitFor(
      () => screenOf(mine, id),
      60000,
      () => "the approval screen",
    );
    screens["seat " + seat] = (await screenOf(mine, id)).split("\n").filter(Boolean);
    return mine;
  };
  const approve = async (seat) => clickMark(await read(seat), `approve-${id}-${seat}`);
  await Promise.all([...step.approvers.map(approve), ...(step.observers ?? []).map(read)]);
  for (const each of pages) await waitState(each, id, "sent", 180000);
  for (const each of pages) assert.ok(await noApprove(each, id), "no Approve control is left");
  const [first] = (await sessions(page)).filter((s) => s.id === id);
  const seen = /^(Landed|Failed on chain) in slot (\d+): (\w+)$/.exec(first.result ?? "");
  assert.ok(seen, `the result line of ${step.label}`);
  assert.equal(seen[1], "Landed", `${step.label} failed on chain`);
  return { id, slot: Number(seen[2]), signature: seen[3], screens };
}

// A session that failed before it landed cost nothing (a refused test run charges no fee, an
// expired blockhash neither), and the SOL is still on the address: one more proposal is free.
// A failure on chain is no such case and is not tried again. `onRetry(label, text)` records it.
export async function landStep(pages, step, onRetry) {
  try {
    return await land(pages, step);
  } catch (err) {
    if (!err.message.startsWith("session failed")) throw err;
    onRetry(step.label, redact(err.message));
    return land(pages, step);
  }
}

/** Taps "Check balance" until the page shows `want`, or (no `want`) until it shows a balance. */
export async function publicBalance(page, want) {
  let seen = "";
  await waitFor(
    async () => {
      await clickMark(page, "refresh");
      await sleep(2500);
      seen = (await solValues(page))["balance-public"];
      return want === undefined ? seen !== "not read yet" : seen === want;
    },
    60000,
    () => `the public balance ${want} (last ${seen})`,
  );
  return seen;
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
