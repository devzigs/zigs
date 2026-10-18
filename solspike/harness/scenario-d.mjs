// P8d live headless check: the second DKG on three seats, in one Chrome with three in-memory
// contexts and the local dev server (cf/.dev.vars has HELIUS_DEVNET_URL). No landed transaction,
// no fund move.
// 1. Seat 1 makes a 2-of-3 testnet wallet, seats 2 and 3 join by the invite link, all three
//    confirm the safety number, and the Zcash part is ready. Zero Solana requests so far.
// 2. The pages reload. With the tab closed they still fetch no Solana file.
// 3. Seat 1 opens the Solana tab and taps Add Solana. The three pages run the ceremony alone.
// 4. The pages show one group key and one shielded address. Seat 1 starts the Worker with the
//    Helius URL (from /sol/config.json), which syncs an empty wallet, and its SDK
//    address equals the wasm address. The snapshot is sealed. A reload shows it.
// 5. Seat 1 backs up its Solana part, loses it, and restores it from the file.
// 6. The group server holds only sealed documents (the persisted store is scanned).
// Run: node solspike/harness/scenario-d.mjs   (Node 24, with
// SOLSPIKE_PORT=8798 SOLSPIKE_CHROME_PORTS=9390-9399 on this track). The Helius URL and the
// secrets of the ceremony never leave the page: the checks read booleans, hashes and public values.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { base58 } from "../../web/sol/docs.js";
import { sleep, waitFor } from "./chrome.mjs";
import {
  captureDownloads,
  clickText,
  readSol,
  run,
  setInput,
  takeDownloads,
  waitForText,
} from "./page.mjs";
import { redact } from "./redact.mjs";
import { ORIGIN } from "./server.mjs";
import { consoleProblems, isSolana, requests, responses, transfer } from "./sol-facts.mjs";
import { withStack } from "./stack.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE = join(HERE, "../.state");
const OUT = join(HERE, "../logs/scenario-d.json");
const READY = "Crypto engine ready (WebAssembly)";
const WORKER = "worker:/sol/worker.js";
const SELF = new URL(ORIGIN).host;
const WORKER_POLICY =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; " +
  "connect-src 'self' https://devnet.helius-rpc.com " +
  "https://d3gbdb0egjwcw9.cloudfront.net/proving-keys/3a1c88f90f609eb1/; base-uri 'none'";
// A throwaway phrase for a throwaway wallet: the file is checked and then dropped with the context.
const PASS = "p8d-live-check-passphrase-0001";
const facts = {};

const solRequests = (page, from = 0) =>
  page.records.slice(from).filter((r) => r.kind === "request" && isSolana(r));
const cspCount = (page) => page.records.filter((r) => r.kind === "csp").length;
const hasTab = (id) => (page) => run(page, (name) => !!document.getElementById(name), id);
// The [data-sol] values of the tab.
const solValues = (page) => readSol(page);

async function openApp(rig, name, url) {
  const ctx = await rig.newContext(name);
  const page = await ctx.open(url);
  await waitForText(page, READY, 30000);
  return page;
}

async function makeWallet(page) {
  await clickText(page, "Create wallet");
  await waitForText(page, "New shared wallet");
  await setInput(page, "#g-name", "P8d wallet");
  await run(page, () => document.querySelector("form[role=dialog] button[type=submit]").click());
  const shown = () => run(page, () => !!document.querySelector(".addr-box .hex"));
  await waitFor(shown, 30000, () => "the invite link");
  return run(page, () => document.querySelector(".addr-box .hex").textContent.trim());
}

/** Phase 1: the Zcash wallet on three pages. */
async function zcashPhase(rig) {
  const first = await openApp(rig, "seat1", `${ORIGIN}/`);
  const link = await makeWallet(first);
  const pages = [first];
  for (const seat of [2, 3]) {
    const page = await openApp(rig, "seat" + seat, link);
    await clickText(page, "Take seat " + seat, { ms: 40000 });
    pages.push(page);
  }
  for (const page of pages) await clickText(page, "It matches", { ms: 90000 });
  for (const [i, page] of pages.entries()) {
    const gone = () => hasTab("tab-overview")(page);
    await waitFor(gone, 240000, () => `the Zcash wallet of seat ${i + 1}`);
  }
  const gid = await run(first, () => location.hash.slice(1).split(".")[0]);
  return { pages, gid, link };
}

let loads = 0;
/**
 * A fresh load of the wallet page. A new query makes it a document navigation of the same site
 * (a same-URL navigation is no reload), and no about:blank page costs a renderer process.
 */
async function reload(page, gid) {
  loads += 1;
  await page.navigate(`${ORIGIN}/?load=${loads}#${gid}`);
  await waitForText(page, READY, 30000);
}

const DIGESTS = async (gid) => {
  const sha = async (text) => {
    const bytes = new TextEncoder().encode(text);
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
  };
  const all = JSON.parse(localStorage.getItem("zf-secrets") || "{}");
  const out = {};
  for (const [key, s] of Object.entries(all)) {
    if (!key.startsWith(gid + ":")) continue;
    const sol = s.sol ?? {};
    out[key.split(":")[1]] = {
      done: sol.doneSent === true,
      keys: Object.keys(sol).sort().join(),
      seed: sol.solSeed ? await sha(sol.solSeed) : null,
      share: sol.keyPackage ? await sha(JSON.stringify(sol.keyPackage)) : null,
    };
  }
  return out;
};

/** Phase 2: pages reloaded, tab closed. No Solana file may be fetched. */
async function tabClosedPhase(pages, gid) {
  for (const page of pages) {
    const from = page.records.length;
    await reload(page, gid);
    await waitFor(
      () => hasTab("tab-solana")(page),
      60000,
      () => "the Solana tab",
    );
    await sleep(3000);
    assert.equal(solRequests(page, from).length, 0, "the tab is closed");
  }
  facts.tabClosedRequests = 0;
}

const status = (page) => solValues(page).then((v) => v.status);

/** Phase 3: seat 1 opens the tab and adds Solana. Seats 2 and 3 load the module by themselves. */
async function addSolana(pages, gid) {
  const [first, ...others] = pages;
  const from = first.records.length;
  await clickText(first, "Solana", { exact: true });
  await waitFor(
    async () => (await status(first)) === "not started",
    30000,
    () => "the tab",
  );
  facts.tabOpenFiles = transfer(first.records.slice(from), isSolana).files;
  facts.tabOpenBytes = transfer(first.records.slice(from), isSolana).bytes;
  const marks = others.map((p) => p.records.length);
  await clickText(first, "Add Solana");
  for (const page of pages) {
    const finished = async () => {
      const seats = await run(page, DIGESTS, gid);
      return Object.values(seats).some((s) => s.done);
    };
    await waitFor(finished, 120000, () => "a finished Solana key share");
  }
  facts.autoLoadedBytes = others.map((p, i) => transfer(p.records.slice(marks[i]), isSolana).bytes);
  facts.autoLoadedAnyTab = await Promise.all(others.map((p) => hasTab("sol-restore")(p)));
}

/** Phase 4a: every page shows the same keys. */
async function compare(pages, gid) {
  const seen = [];
  for (const page of pages) {
    if (!(await status(page))) await clickText(page, "Solana", { exact: true });
    await waitFor(
      async () => (await status(page)) === "ready",
      60000,
      () => "status ready",
    );
    seen.push({ sol: await solValues(page), digests: await run(page, DIGESTS, gid) });
  }
  const values = (name) => new Set(seen.map((s) => s.sol[name]));
  for (const name of ["owner", "group-key", "shielded"]) assert.equal(values(name).size, 1, name);
  const { owner, "group-key": groupKey, shielded } = seen[0].sol;
  assert.equal(owner, base58(groupKey), "the owner is the base58 text of the group key");
  assert.equal(shielded.length, 198);
  const mine = seen.map((s, i) => s.digests[String(i + 1)]);
  assert.equal(new Set(mine.map((d) => d.seed)).size, 1, "equal solSeed (compared by hash)");
  assert.equal(new Set(mine.map((d) => d.share)).size, 3, "three different key shares");
  const keys = "cluster,doneSent,groupKey,keyPackage,publicKeyPackage,solSeed";
  assert.deepEqual(
    mine.map((d) => d.keys),
    [keys, keys, keys],
    "only key data is left",
  );
  facts.seedHash = mine[0].seed.slice(0, 12);
  return { owner, groupKey, shielded };
}

/** The sealed snapshot of the sync: its own database, no plain text, version 1 of zigs kept. */
const SEALED = () =>
  new Promise((ok, bad) => {
    const open = indexedDB.open("zigs-sol", 1);
    open.onerror = () => bad(open.error);
    open.onsuccess = () => {
      const store = open.result.transaction("snap").objectStore("snap");
      const all = store.getAll(),
        keys = store.getAllKeys();
      all.onsuccess = () => {
        indexedDB.databases().then((dbs) => ok({ values: all.result, keys: keys.result, dbs }));
      };
    };
  });

/** Phase 4b: the Worker starts, gets the role secrets, syncs an empty wallet. */
async function workerPhase(pages, gid) {
  const [first] = pages;
  const from = first.records.length;
  await clickText(first, "Sync Solana");
  const done = async () => ((await solValues(first)).worker ?? "").startsWith("synced at slot");
  await waitFor(done, 120000, () => "the first sync");
  const shown = await solValues(first);
  assert.equal(shown["balance-private"], "0 SOL");
  assert.match(shown.worker, /the SDK address equals the wasm address/);
  const part = first.records.slice(from);
  const calls = requests(part).filter((r) => r.who === WORKER && r.host !== SELF);
  assert.ok(calls.length > 0 && calls.every((r) => r.blocked === null), "the Worker was heard");
  assert.deepEqual([...new Set(calls.map((r) => r.host))], ["devnet.helius-rpc.com"]);
  const sockets = first.records.filter((r) => r.kind === "websocket" && /helius/.test(r.url));
  assert.equal(sockets.length, 0, "no WebSocket to Helius");
  const [script] = responses(first.records, "/sol/worker.js");
  assert.equal(script.headers["content-security-policy"], WORKER_POLICY);
  assert.equal(script.headers["referrer-policy"], "no-referrer");
  facts.workerCalls = calls.length;
  const sealed = await run(first, SEALED);
  assert.equal(sealed.keys.length, 1);
  assert.ok(typeof sealed.values[0] === "string" && !/balance|slot|utxos/.test(sealed.values[0]));
  const dbs = Object.fromEntries(sealed.dbs.map((d) => [d.name, d.version]));
  assert.deepEqual([dbs.zigs, dbs["zigs-sol"]], [1, 1], "the Zcash database is not upgraded");
  await reload(first, gid);
  await clickText(first, "Solana", { exact: true });
  const saved = async () =>
    ((await solValues(first)).worker ?? "").startsWith("saved sync of slot");
  await waitFor(saved, 60000, () => "the saved snapshot");
  assert.equal((await solValues(first))["balance-private"], "0 SOL");
}

async function dialogPass(page, id) {
  await waitFor(
    () => run(page, (sel) => !!document.querySelector(sel), id),
    15000,
    () => id,
  );
  await setInput(page, id, PASS);
}

/** Phase 5: back up the Solana part of seat 1, lose it, restore it. */
async function backupPhase(first, gid) {
  await captureDownloads(first);
  const before = (await run(first, DIGESTS, gid))["1"];
  await clickText(first, "Back up Solana part, seat 1");
  await waitForText(first, "Back up the Solana part of seat 1");
  await dialogPass(first, "#bk-pass");
  await setInput(first, "#bk-again", PASS);
  await run(first, () => document.querySelector("form[role=dialog] button[type=submit]").click());
  await waitFor(
    async () => (await run(first, () => window.__zsDownloads.length)) > 0,
    120000,
    () => "the backup file",
  );
  const [file] = await takeDownloads(first);
  assert.match(file.name, /^zigs-.*-solana-seat-1\.zigsbackup$/);
  assert.equal(JSON.parse(file.text).kind, "zigs-backup");
  assert.ok(!/solSeed|signing_share/.test(file.text), "the file shows no secret");
  // Lose the Solana part of seat 1 (the Zcash seat stays) and reload.
  await run(
    first,
    (id) => {
      const all = JSON.parse(localStorage.getItem("zf-secrets"));
      delete all[id + ":1"].sol;
      localStorage.setItem("zf-secrets", JSON.stringify(all));
    },
    gid,
  );
  await reload(first, gid);
  await clickText(first, "Solana", { exact: true });
  await waitFor(
    () => hasTab("sol-restore")(first),
    30000,
    () => "the Solana tab",
  );
  assert.equal((await run(first, DIGESTS, gid))["1"].seed, null, "the Solana part is gone");
  const give = (name, text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], name));
    const input = document.getElementById("sol-restore");
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  await run(first, give, file.name, file.text);
  await dialogPass(first, "#rs-pass");
  await run(first, () => document.querySelector("form[role=dialog] button[type=submit]").click());
  const back = async () => (await run(first, DIGESTS, gid))["1"].seed !== null;
  await waitFor(back, 120000, () => "the restored Solana part");
  const after = (await run(first, DIGESTS, gid))["1"];
  assert.deepEqual([after.seed, after.share, after.keys], [before.seed, before.share, before.keys]);
  facts.restored = true;
}

// The regular files below a directory. A symlink is not followed (Chrome keeps dangling ones).
const files = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n),
      info = lstatSync(p);
    if (info.isDirectory()) return files(p);
    return info.isFile() ? [p] : [];
  });

const sqlite = (file, sql) =>
  execFileSync("sqlite3", ["-readonly", file, sql], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
    stdio: ["ignore", "pipe", "ignore"],
  });

/** The Solana documents of wallet `gid` in the persisted store: { "soldone/1": "<json>" }. */
function storedDocs(gid) {
  const found = new Map();
  for (const f of files(join(STATE, "v3/do")).filter((n) => n.endsWith(".sqlite"))) {
    let rows;
    try {
      rows = sqlite(f, `select path, data from docs where path like 'groups/${gid}/sol%'`);
    } catch {
      continue;
    }
    for (const line of rows.split("\n").filter(Boolean)) {
      const bar = line.indexOf("|");
      found.set(line.slice(0, bar).replace(`groups/${gid}/`, ""), line.slice(bar + 1));
    }
  }
  return found;
}

/** How many files of .state hold each public value in plain (the Chrome profile counts too). */
function plainHits(pub) {
  const hits = pub.map(() => 0);
  for (const f of files(STATE).filter((n) => !n.includes("baseline-logs"))) {
    const bytes = readFileSync(f);
    for (const [i, needle] of pub.entries()) if (bytes.includes(needle)) hits[i] += 1;
  }
  return hits;
}

const WANTED = [
  "solstart/1",
  ..."123".split("").flatMap((i) => [`soldkg1/${i}`, `soldone/${i}`]),
  ...["1-2", "1-3", "2-1", "2-3", "3-1", "3-2"].map((p) => `soldkg2/${p}`),
].sort();

/** Phase 6: the persisted store has the Solana documents, sealed, and no public value in plain. */
function storeCheck(gid, pub) {
  const found = storedDocs(gid);
  assert.deepEqual([...found.keys()].sort(), WANTED, "every Solana document is in the store");
  for (const [rel, data] of found) {
    const doc = JSON.parse(data);
    const sealed = Object.values(doc).every((v) => typeof v === "string" && v.length > 20);
    assert.ok(sealed, rel + " holds a field that is not sealed");
    for (const needle of pub) assert.ok(!data.includes(needle), rel + " shows a public value");
  }
  assert.deepEqual(plainHits(pub), [0, 0, 0], "no public value in plain in .state");
  facts.sealedDocuments = found.size;
}

async function scenario(rig) {
  const { pages, gid } = await zcashPhase(rig);
  for (const page of pages) assert.equal(solRequests(page).length, 0, "the tab is closed");
  facts.tabClosedRequestsBeforeReload = 0;
  await tabClosedPhase(pages, gid);
  await addSolana(pages, gid);
  const pub = await compare(pages, gid);
  await workerPhase(pages, gid);
  await backupPhase(pages[0], gid);
  storeCheck(gid, [pub.groupKey, pub.shielded, pub.owner]);
  facts.csp = pages.map(cspCount);
  facts.problems = pages.map((p) => consoleProblems(p.records).length);
  assert.deepEqual(facts.csp, [0, 0, 0], "no CSP violation");
  assert.deepEqual(facts.problems, [0, 0, 0], "no console error, warning or exception");
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, redact(JSON.stringify(facts, null, 1)));
  console.log(redact(JSON.stringify(facts)));
}

withStack("scenario-d", scenario).catch((err) => {
  console.error(redact(String(err?.stack ?? err)));
  process.exitCode = 1;
});
