// The refusals of the restore (P8f plan, test 7), driven through the page on a new local wallet:
// three seats in three in-memory contexts of one Chrome on the local dev server. The server
// serves a dummy Helius URL (the Solana tab needs one), and no request goes to it: no Worker, no
// Devnet request, no landed transaction.
// 1. The seats make a 2-of-3 wallet and its Solana part. Seat 1 backs up both of its files and
//    seat 2 its Solana file. The context of seat 1 is wiped (disposed); a new one is blank.
// 2. On the blank page, each of these is refused and stores nothing: the Solana file before the
//    Zcash seat, the Solana file with a wrong passphrase, and a Solana file with one changed byte.
// 3. The Zcash seat is restored and settles. The Solana file of seat 2 is refused there. With
//    seat 1 marked as not settled, its own Solana file waits and is refused.
// 4. The Solana file of seat 1 then restores, and the tab shows the group key again.
// Run: node solspike/harness/restore-neg.mjs   (Node 24; set
// SOLSPIKE_PORT and SOLSPIKE_CHROME_PORTS to the ports of the track).
import assert from "node:assert/strict";
import * as B from "./backups.mjs";
import { sleep, waitFor } from "./chrome.mjs";
import { banner } from "./flow.mjs";
import { clickText, run, waitForText } from "./page.mjs";
import { redact } from "./redact.mjs";
import { openApp, reload, solanaReady, solValues, zcashWallet } from "./seats.mjs";
import { ORIGIN, setDevVar } from "./server.mjs";
import { consoleProblems } from "./sol-facts.mjs";
import { withStack } from "./stack.mjs";

const READY = "Crypto engine ready (WebAssembly)";
const DUMMY_URL = "https://devnet.helius-rpc.com/?api-key=restore-check";
const seen = {};

/** The keys of the Solana part that this page holds for the seat (an empty list when none). */
const solKeys = (page, gid, seat) => {
  const read = (id, i) => {
    const all = JSON.parse(localStorage.getItem("zf-secrets") ?? "{}");
    return Object.keys(all[id + ":" + i]?.sol ?? {});
  };
  return run(page, read, gid, seat);
};

/** The file with one character of its longest field changed: the sealed text. */
function changed(file) {
  const outer = JSON.parse(file.text);
  const [name, value] = Object.entries(outer)
    .filter(([, v]) => typeof v === "string")
    .sort(([, a], [, b]) => b.length - a.length)[0];
  const at = Math.floor(value.length / 2);
  const swapped = value[at] === "A" ? "B" : "A";
  const sealed = value.slice(0, at) + swapped + value.slice(at + 1);
  return { ...file, text: JSON.stringify({ ...outer, [name]: sealed }) };
}

let fresh = 0;
/** A fresh load of the start page: no dialog and no banner of the case before. */
async function startPage(page) {
  fresh += 1;
  await page.navigate(`${ORIGIN}/?fresh=${fresh}`);
  await waitForText(page, READY, 30000);
}

/** Opens `file` with `pass` through the input `input`; returns the banner that refuses it. */
async function refusal(page, input, file, pass = file.pass) {
  await B.openWithPass(page, input, { ...file, pass });
  await waitFor(async () => (await banner(page)) !== "", 60000, () => "a banner");
  return redact(await banner(page));
}

/** Phase 2: the refusals on a blank page. */
async function blankRefusals(page, gid, files) {
  const { pass } = files.sol1;
  const unopened = /^Wrong passphrase, or the file is damaged\.$/;
  const cases = [
    ["beforeZcash", files.sol1, pass, /holds no seat 1 of this wallet\. Restore the seat first/],
    ["wrongPass", files.sol1, pass + "x", unopened],
    ["changedFile", changed(files.sol1), pass, unopened],
  ];
  for (const [name, file, typed, want] of cases) {
    await startPage(page);
    seen[name] = await refusal(page, "restore", file, typed);
    assert.match(seen[name], want, name);
    assert.deepEqual(await solKeys(page, gid, 1), [], name + ": nothing of Solana is stored");
  }
}

/** The wallet page, on the Solana tab with its restore input. */
async function solanaTab(page, gid) {
  await reload(page, gid);
  await clickText(page, "Solana", { exact: true });
  const input = () => run(page, () => !!document.getElementById("sol-restore"));
  await waitFor(input, 60000, () => "the Solana restore input");
}

// Seat 1 as if its address check had not settled: the stored seat names the wallet as rejected,
// so the page does not check it again. `back` undoes it.
const unsettle = (id, back) => {
  const all = JSON.parse(localStorage.getItem("zf-secrets"));
  const seat = all[id + ":1"];
  const names = ["checkedWallet", "rejectedWallet"];
  const [from, to] = back ? names.reverse() : names;
  Object.assign(seat, { [to]: seat[from], [from]: null });
  localStorage.setItem("zf-secrets", JSON.stringify(all));
};

/** Phase 3b: the Solana file of a seat that did not settle opens its wallet, waits, is refused. */
async function unsettledRefusal(page, gid, file) {
  await run(page, unsettle, gid, false);
  await startPage(page); // such a seat has no Solana tab: the file goes in from the wallet list
  await B.openWithPass(page, "restore", file);
  const want = /Seat 1 must show Address checked before its Solana part can be restored/;
  await waitFor(async () => want.test(await banner(page)), 60000, () => "the settle refusal");
  seen.unsettled = redact(await banner(page));
  assert.deepEqual(await solKeys(page, gid, 1), [], "a seat that did not settle stores nothing");
  await run(page, unsettle, gid, true);
}

/** Phase 3: the Zcash seat returns and settles, then the Solana file of seat 2 is refused. */
async function zcashThenOtherSeat(page, gid, files) {
  await startPage(page);
  await B.openWithPass(page, "restore", files.zcash1);
  const matches = async () => /It matches the wallet/.test(await banner(page));
  await waitFor(matches, 240000, () => "the restored seat to match the wallet");
  await sleep(3000); // the restored key pairs are checked and stored after the banner
  await solanaTab(page, gid);
  seen.otherSeat = await refusal(page, "sol-restore", files.sol2);
  assert.match(seen.otherSeat, /holds no seat 2 of this wallet/, "the file of seat 2");
  for (const seat of [1, 2]) {
    assert.deepEqual(await solKeys(page, gid, seat), [], "the file of seat 2 stored nothing");
  }
}

async function scenario(rig) {
  const { pages, gid } = await zcashWallet(rig, "Restore checks");
  const keys = await solanaReady(pages, gid);
  const [first, second] = pages;
  const files = {
    zcash1: await B.zcashBackup(first),
    sol1: await B.solanaBackup(first, 1),
    sol2: await B.solanaBackup(second, 2),
  };
  await first.context.dispose();
  const page = await openApp(rig, "wiped", `${ORIGIN}/`);
  await B.assertBlank(page);
  await blankRefusals(page, gid, files);
  await zcashThenOtherSeat(page, gid, files);
  await unsettledRefusal(page, gid, files.sol1);
  await startPage(page);
  await reload(page, gid);
  await clickText(page, "Solana", { exact: true });
  await B.restoreSolana(page, files.sol1);
  const restored = async () => /Restored the Solana part of seat 1/.test(await banner(page));
  await waitFor(restored, 60000, () => "the good file to restore");
  await waitFor(async () => (await solValues(page)).status === "ready", 120000, () => "ready");
  assert.equal((await solValues(page))["group-key"], keys.groupKey, "the same group key");
  seen.problems = [page, ...pages.slice(1)].map((p) => consoleProblems(p.records).length);
  console.log("RESULT " + redact(JSON.stringify(seen)));
  console.log("restore-neg: ok");
}

const before = setDevVar("HELIUS_DEVNET_URL", DUMMY_URL);
withStack("restore-neg", scenario)
  .catch((err) => {
    console.error(redact(String(err?.stack ?? err)));
    process.exitCode = 1;
  })
  .finally(() => setDevVar("HELIUS_DEVNET_URL", before));
