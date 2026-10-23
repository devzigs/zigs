// Three seats in three in-memory contexts of one Chrome (the rig), up to a Solana part that every
// page shows as ready: a 2-of-3 testnet wallet, the second DKG of web/sol, one group key. Used by
// scenario-e.mjs. scenario-d.mjs keeps its own copy of the other first steps (it is the verified
// P8d check), and takes makeWallet from here. Every seat takes the path of a person: the Tor
// popup is turned down, the passkey step is skipped and confirmed, and the guided setup runs to
// the end with Open Overview. The invite link, which holds the wallet
// secret, is read from the app module that builds it (the guided card shows the link only in a
// dialog that depends on the clipboard). No other function here reads a secret: the pages show
// public values only.
import { sleep, waitFor } from "./chrome.mjs";
import {
  clickAnyText,
  clickSelector,
  clickText,
  closePrivacyPopup,
  run,
  setInput,
  waitForEngine,
  waitForText,
} from "./page.mjs";
import { ORIGIN } from "./server.mjs";

/** A new in-memory context with one page on `url`, ready. `page.context` can dispose it. */
export async function openApp(rig, name, url) {
  const ctx = await rig.newContext(name);
  const page = await ctx.open(url);
  page.context = ctx;
  await waitForEngine(page);
  await closePrivacyPopup(page);
  return page;
}

/** The passkey step of the create dialog and of the join card: Skip for now, then confirm. */
export async function skipProtection(page) {
  await clickText(page, "Skip for now", { exact: true, ms: 40000 });
  await clickText(page, "Continue without protection", { exact: true });
}

// The create dialog draws its four steps at once and hides three: a step shows when its section
// is not hidden. A click before the redraw would reach a stale form, which ignores it.
const stepShown = (n) => document.querySelector(`[aria-labelledby="create-step-${n}"]`)?.hidden
  === false;
const atStep = (page, n) =>
  waitFor(() => run(page, stepShown, n), 15000, () => `step ${n} of the create dialog`);

// The Solana box of the review step sits in a hidden block of the form: the app keeps the choice
// there and offers no visible control. A click fires the change handler, so the page keeps the
// choice through a redraw.
async function chooseSolana(page, on) {
  const box = () => run(page, () => !!document.getElementById("g-sol"));
  await waitFor(box, 20000, () => "the Solana box of the dialog");
  await run(page, (want) => {
    const el = document.getElementById("g-sol");
    if (el.checked !== want) el.click();
  }, on);
}

// The submit button of the review step reads "Create wallet" too, like the button of the welcome
// card under the dialog: the run takes the one in the dialog form, when it is enabled.
const submitCreate = () => {
  const btn = document.querySelector("form[role=dialog] button[type=submit]");
  if (!btn || btn.disabled || btn.textContent.trim() !== "Create wallet") return false;
  btn.click();
  return true;
};

const inviteOf = async () => {
  const { state } = await import("/app-state.js");
  return (await import("/app-links.js")).inviteLink(state.gid);
};

/**
 * Seat 1 creates the wallet through the dialog (Skip for now at the passkey step) and returns the
 * invite link. `solana`: the Solana box of the review step.
 */
export async function makeWallet(page, name, { solana = false } = {}) {
  await clickText(page, "Create wallet");
  await atStep(page, 0);
  await skipProtection(page);
  await atStep(page, 1);
  await clickText(page, "Use this arrangement", { exact: true });
  await atStep(page, 2);
  await setInput(page, "#g-name", name);
  await clickText(page, "Continue", { exact: true });
  await atStep(page, 3);
  await chooseSolana(page, solana);
  await waitFor(() => run(page, submitCreate), 20000, () => "the Create wallet button");
  await waitForText(page, "Private setup invitation", 60000);
  return run(page, inviteOf);
}

/** A joiner skips the passkey step, then takes the next open seat. */
export async function joinSeat(page, seat) {
  await skipProtection(page);
  await clickText(page, "Join as device " + seat, { ms: 40000 });
}

// The person compares all 30 digits of the safety number, ticks the box, then confirms. The box
// shows once every seat has joined.
export async function confirmNumber(page) {
  const box = () => run(page, () => !!document.getElementById("safety-full"));
  await waitFor(box, 90000, () => "the box of the safety number");
  await run(page, () => {
    const el = document.getElementById("safety-full");
    if (!el.checked) el.click();
  });
  await clickText(page, "Codes match", { exact: true, ms: 90000 });
}

// The wallet page: its Overview panel. The side list is on every page, also on the welcome page.
const walletPage = (page) => run(page, () => !!document.getElementById("panel-overview"));

const REVEAL = "Continue to backup options";
const OPEN = "Open Overview";
const SETUP_MS = 400000; // the Zcash ceremony, and the Solana one when the wallet asks for it

/**
 * The guided setup of one page, from the prepared wallet to the wallet page: the reveal, then
 * Open Overview. Seat 1 is also offered the funding demo, which the harness leaves alone. Waits
 * for the ceremonies to end, which enable these buttons.
 */
async function finishSetup(page) {
  const label = await clickAnyText(page, [REVEAL, OPEN], { ms: SETUP_MS });
  if (label === REVEAL) await clickText(page, OPEN, { exact: true, ms: SETUP_MS });
  const done = () =>
    run(page, () => !document.querySelector("[data-key=guided-setup], [data-funding-preview]"));
  await waitFor(done, 30000, () => "the end of the guided setup");
}

/**
 * The Zcash wallet on three pages: seat 1 creates it, seats 2 and 3 join, all confirm and finish
 * the guided setup. With `{ solana: true }` the dialog also chooses the Solana part, which then
 * starts by itself, and the guided setup waits for it.
 */
export async function zcashWallet(rig, name, opts = {}) {
  const first = await openApp(rig, "seat1", `${ORIGIN}/`);
  const link = await makeWallet(first, name, opts);
  const pages = [first];
  for (const seat of [2, 3]) {
    const page = await openApp(rig, "seat" + seat, link);
    await joinSeat(page, seat);
    pages.push(page);
  }
  for (const page of pages) await confirmNumber(page);
  for (const page of pages) await finishSetup(page);
  for (const [i, page] of pages.entries()) {
    await waitFor(() => walletPage(page), 30000, () => `the Zcash wallet of seat ${i + 1}`);
  }
  const gid = await run(first, () => location.hash.slice(1).split(".")[0]);
  return { pages, gid };
}

let loads = 0;
/** A fresh load of the wallet page (a new query makes it a document navigation). */
export async function reload(page, gid) {
  loads += 1;
  await page.navigate(`${ORIGIN}/?load=${loads}#${gid}`);
  await waitForEngine(page);
}

/** The [data-sol] values of the tab, without the field that holds the Helius URL. */
export async function solValues(page) {
  const all = await run(page, () => {
    const out = {};
    for (const el of document.querySelectorAll("[data-sol]")) {
      out[el.dataset.sol] = el.matches("input") ? "" : el.textContent.trim();
    }
    return out;
  });
  return all;
}

const status = async (page) => (await solValues(page)).status;

// Each shown label of a key-value list sits on the row of its value, left of it (the rig page is
// 1280 px wide, so the lists have two columns).
async function labelsAligned(page) {
  const off = await run(page, () =>
    [...document.querySelectorAll(".kv dt")]
      .filter((dt) => dt.offsetParent !== null)
      .filter((dt) => {
        const dd = dt.nextElementSibling;
        if (dd?.tagName !== "DD") return true;
        const a = dt.getBoundingClientRect(),
          b = dd.getBoundingClientRect();
        return Math.abs(a.top - b.top) > 2 || b.left <= a.left;
      })
      .map((dt) => dt.textContent),
  );
  if (off.length) throw new Error("labels off the row of their value: " + off.join(", "));
}

const solShown = (page) => run(page, () => !!document.querySelector('[data-sol="status"]'));

/**
 * Opens the Solana section like a person: Approvals in the side list, then "Open Solana" (the
 * side list has no Solana entry; a wallet of a server that serves Solana offers that button).
 * Does nothing when the section shows already.
 */
export async function openSolana(page) {
  if (await solShown(page)) return;
  await clickSelector(page, "#tab-approvals", { ms: 60000 });
  await clickText(page, "Open Solana", { exact: true, ms: 60000 });
  await waitFor(() => solShown(page), 60000, () => "the Solana section");
}

/** Seat 1 opens the Solana section and taps Add Solana, unless the part starts by itself. */
async function startSolana(page, auto) {
  await openSolana(page);
  if (auto) return;
  await waitFor(async () => (await status(page)) === "not started", 30000, () => "the tab");
  await clickText(page, "Add Solana");
}

/**
 * Pages reloaded, seat 1 adds Solana (or, with `{ auto: true }`, it started by itself), every page
 * shows "ready". Returns the keys.
 */
export async function solanaReady(pages, gid, { auto = false } = {}) {
  for (const page of pages) {
    await reload(page, gid);
    await waitFor(() => walletPage(page), 60000, () => "the wallet page");
  }
  await startSolana(pages[0], auto);
  for (const page of pages) {
    await openSolana(page);
    await waitFor(
      async () => (await status(page)) === "ready",
      180000,
      () => "status ready",
    );
  }
  const seen = await Promise.all(pages.map(solValues));
  for (const name of ["owner", "group-key", "shielded"]) {
    const values = new Set(seen.map((v) => v[name]));
    if (values.size !== 1) throw new Error(`the pages show different ${name} values`);
  }
  const { owner, "group-key": groupKey, shielded } = seen[0];
  await labelsAligned(pages[0]);
  await sleep(500);
  return { owner, groupKey, shielded };
}
