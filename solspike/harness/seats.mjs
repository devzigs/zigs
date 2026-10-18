// Three seats in three in-memory contexts of one Chrome (the rig), up to a Solana part that every
// page shows as ready: a 2-of-3 testnet wallet, the second DKG of web/sol, one group key. Used by
// scenario-e.mjs. scenario-d.mjs keeps its own copy of the first steps (it is the verified P8d
// check and stays as it is). Nothing here reads a secret: the pages show public values only.
import { sleep, waitFor } from "./chrome.mjs";
import { clickText, run, setInput, waitForText } from "./page.mjs";
import { ORIGIN } from "./server.mjs";

const READY = "Crypto engine ready (WebAssembly)";

/** A new in-memory context with one page on `url`, ready. `page.context` can dispose it. */
export async function openApp(rig, name, url) {
  const ctx = await rig.newContext(name);
  const page = await ctx.open(url);
  page.context = ctx;
  await waitForText(page, READY, 30000);
  return page;
}

// `solana`: the box "Also set up Solana Devnet" of the dialog. The page shows it once the server
// answered /sol/config.json, so the run waits for it before it sets it.
async function makeWallet(page, name, { solana = false } = {}) {
  await clickText(page, "Create wallet");
  await waitForText(page, "New shared wallet");
  await setInput(page, "#g-name", name);
  const box = () => run(page, () => !!document.getElementById("g-sol"));
  if (solana) await waitFor(box, 20000, () => "the Solana box of the dialog");
  await run(page, (on) => {
    const el = document.getElementById("g-sol");
    if (el) el.checked = on;
  }, solana);
  await run(page, () => document.querySelector("form[role=dialog] button[type=submit]").click());
  const shown = () => run(page, () => !!document.querySelector(".addr-box .hex"));
  await waitFor(shown, 30000, () => "the invite link");
  return run(page, () => document.querySelector(".addr-box .hex").textContent.trim());
}

const hasTab = (page, id) => run(page, (name) => !!document.getElementById(name), id);

/**
 * The Zcash wallet on three pages: seat 1 creates it, seats 2 and 3 join, all confirm. With
 * `{ solana: true }` the dialog also chooses the Solana part, which then starts by itself.
 */
export async function zcashWallet(rig, name, opts = {}) {
  const first = await openApp(rig, "seat1", `${ORIGIN}/`);
  const link = await makeWallet(first, name, opts);
  const pages = [first];
  for (const seat of [2, 3]) {
    const page = await openApp(rig, "seat" + seat, link);
    await clickText(page, "Take seat " + seat, { ms: 40000 });
    pages.push(page);
  }
  for (const page of pages) await clickText(page, "It matches", { ms: 90000 });
  for (const [i, page] of pages.entries()) {
    await waitFor(
      () => hasTab(page, "tab-overview"),
      240000,
      () => `the Zcash wallet of seat ${i + 1}`,
    );
  }
  const gid = await run(first, () => location.hash.slice(1).split(".")[0]);
  return { pages, gid };
}

let loads = 0;
/** A fresh load of the wallet page (a new query makes it a document navigation). */
export async function reload(page, gid) {
  loads += 1;
  await page.navigate(`${ORIGIN}/?load=${loads}#${gid}`);
  await waitForText(page, READY, 30000);
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

/** Seat 1 opens the Solana tab and taps Add Solana, unless the part starts by itself. */
async function startSolana(page, auto) {
  await clickText(page, "Solana", { exact: true });
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
    await waitFor(
      () => hasTab(page, "tab-solana"),
      60000,
      () => "the Solana tab",
    );
  }
  await startSolana(pages[0], auto);
  for (const page of pages) {
    if (!(await status(page))) await clickText(page, "Solana", { exact: true });
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
  await sleep(500);
  return { owner, groupKey, shielded };
}
