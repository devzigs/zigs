// The backup and restore steps of the live restore rehearsal (scenario-f.mjs), driven through the
// page: the app makes each passphrase, the harness keeps it in memory only and adds it to the
// redactor, and the encrypted file text is the only thing that is ever written to disk.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sleep, waitFor } from "./chrome.mjs";
import { banner } from "./flow.mjs";
import {
  captureDownloads,
  clickText,
  run,
  setInput,
  takeDownloads,
} from "./page.mjs";
import { redact } from "./redact.mjs";
import { reload } from "./seats.mjs";
import * as Z from "../../web/pkg/zigs_engine.js";

const WASM = new URL("../../web/pkg/zigs_engine_bg.wasm", import.meta.url);

const SUBMIT = () => document.querySelector("form[role=dialog] button[type=submit]").click();

/**
 * Makes one backup file: `open()` taps the control that opens the dialog. The app makes the
 * passphrase ("Make a passphrase for me"), the harness reads it from the field and types it again.
 * Returns { name, text, pass }.
 */
export async function makeBackup(page, open) {
  await captureDownloads(page);
  await takeDownloads(page);
  await open();
  const shown = () => run(page, () => !!document.querySelector("#bk-pass"));
  await waitFor(shown, 20000, () => "the backup dialog");
  await clickText(page, "Make a passphrase for me");
  const pass = await run(page, () => document.querySelector("#bk-pass").value);
  assert.ok(pass.length >= 20, "the app made a passphrase");
  redact.add(pass);
  await setInput(page, "#bk-again", pass);
  await run(page, SUBMIT);
  const files = async () => (await run(page, () => window.__zsDownloads.length)) > 0;
  await waitFor(files, 120000, () => "the backup file");
  const [file] = await takeDownloads(page);
  return { name: file.name, text: file.text, pass };
}

/** The Zcash backup of the seat that this page holds (the button is on the Signers tab). */
export const zcashBackup = (page) =>
  makeBackup(page, async () => {
    await clickText(page, "Devices", { exact: true });
    await clickText(page, "Back up key share", { exact: true });
  });

/** The Solana backup of seat `seat`: a second file, with its own passphrase. */
export const solanaBackup = (page, seat) =>
  makeBackup(page, async () => {
    await clickText(page, "Solana", { exact: true });
    await clickText(page, "Back up Solana part, seat " + seat);
  });

/** Puts a file in the hidden file input `id`, as a person picks it. */
function give(page, id, name, text) {
  const put = (inputId, fileName, body) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([body], fileName));
    const input = document.getElementById(inputId);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  return run(page, put, id, name, text);
}

/** Opens `file` through the file input `input` and types `file.pass` in the restore dialog. */
export async function openWithPass(page, input, file) {
  await waitFor(
    () => run(page, (id) => !!document.getElementById(id), input),
    60000,
    () => "the file input " + input,
  );
  await give(page, input, file.name, file.text);
  await setInput(page, "#rs-pass", file.pass, 20000);
  await run(page, SUBMIT);
}

// What the page itself writes when it starts on an empty context: an identity and a balance cache.
const OWN_KEYS = new Set(["zf-uid", "zf-bal"]);

// The local storage keys and the record count of every store of every IndexedDB database.
const holdings = async () => {
  const counts = [];
  for (const { name } of await indexedDB.databases()) {
    const db = await new Promise((done, fail) => {
      const open = indexedDB.open(name);
      open.onsuccess = () => done(open.result);
      open.onerror = () => fail(open.error);
    });
    for (const store of db.objectStoreNames) {
      const request = db.transaction(store).objectStore(store).count();
      counts.push(await new Promise((done) => (request.onsuccess = () => done(request.result))));
    }
    db.close();
  }
  return { keys: Object.keys(localStorage), records: counts };
};

/**
 * Asserts that a new context holds no wallet: no local storage key but the two that the page
 * writes at its start (no seat secret, no wallet key), and no record in IndexedDB.
 */
export async function assertBlank(page) {
  const seen = await run(page, holdings);
  assert.deepEqual(
    seen.keys.filter((key) => !OWN_KEYS.has(key)),
    [],
    "the new context holds no wallet key",
  );
  assert.ok(
    seen.records.every((n) => n === 0),
    "the new context has no IndexedDB record",
  );
}

const matches = (page) => async () => /It matches the wallet/.test(await banner(page));

/**
 * Restores the Zcash seat from its file on a blank page, then waits until the seat fits the
 * wallet (the banner says so), and loads the wallet page.
 */
export async function restoreZcash(page, file, gid) {
  await openWithPass(page, "restore", file);
  await waitFor(matches(page), 240000, () => "the restored seat to match the wallet");
  await sleep(3000); // the restored key pairs are checked and stored after the banner
  await reload(page, gid);
}

/** Restores the Solana part from its file, on a seat that is settled and fits. */
export async function restoreSolana(page, file) {
  await openWithPass(page, "sol-restore", file);
}

/**
 * Opens the two files of one seat in Node (web/pkg backupOpen), as a reader that has the
 * passphrases: the Zcash file holds no Solana field, the Solana file holds the Solana part.
 * Returns public facts only.
 */
export function checkFiles(zcash, solana) {
  Z.initSync({ module: readFileSync(WASM) });
  const z = JSON.parse(Z.backupOpen(zcash.pass, zcash.text));
  const sol = JSON.parse(Z.backupOpen(solana.pass, solana.text));
  assert.equal(z.kind, "zigs-key-share");
  assert.ok(!("sol" in z.secret), "the Zcash file has no sol field");
  assert.ok(!/solSeed|solana/i.test(JSON.stringify(z)), "the Zcash file holds nothing of Solana");
  assert.equal(sol.kind, "zigs-sol-backup");
  assert.notEqual(zcash.pass, solana.pass, "each file has its own passphrase");
  return { zcash: zcash.name, solana: solana.name, group: z.group, seat: z.seat };
}
