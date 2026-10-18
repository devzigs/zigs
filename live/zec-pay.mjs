// A live run (VEL-3): one 2-of-2 testnet payment from the permanent test wallet, made through
// the page on a local server and checked on chain. Run: node live/zec-pay.mjs [--priority]
// The test wallet is a folder outside the repo (WALLET below). README.md, Tests, has the cost.
import { spawn } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sleep, waitFor } from "../solspike/harness/chrome.mjs";
import { clickText, run, setInput } from "../solspike/harness/page.mjs";
import { redact } from "../solspike/harness/redact.mjs";
import { startRig } from "../solspike/harness/rig.mjs";
import { ownProcesses, trackPeak } from "../solspike/tools/procs.mjs";
import * as Z from "../web/pkg/zigs_engine.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WALLET = join(homedir(), ".config", "zigs", "testwallets", "zec-testnet");
const WALLET_SHOWN = "~/.config/zigs/testwallets/zec-testnet";
const PUBLIC_LWD = "https://zcash-testnet.chainsafe.dev";
const PRIORITY = process.argv.includes("--priority");
const FACTOR = PRIORITY ? 10 : 1;
const PAY_ZAT = 100_000;
const BASE_FEE = 5000;
const EXPIRY_BLOCKS = 3456;
const BRANCH_ID = 0x77190ad9;
const SEND_MS = 300_000;
const APPROVE_MS = 180_000;
const PROOF_MS = 600_000;
const MINED_MS = 600_000;
const POLL_MS = 15_000;
const CALL_MS = 30_000;
const SYNC_MS = 300_000;
const CHIP_MS = 240_000;

const log = (text) => console.error(redact(`zec-pay: ${text}`));

// ── Pure rules (checked by zec-pay.check.mjs) ──

/** The version, the consensus branch id and the expiry height of a v6 transaction header. */
export function parseHeader(raw) {
  if (raw.length < 20) throw new Error(`a transaction of ${raw.length} bytes has no header`);
  return {
    version: raw.readUInt32LE(0) & 0x7fffffff,
    branchId: raw.readUInt32LE(8),
    expiry: raw.readUInt32LE(16),
  };
}

/** The zatoshi of an amount as the page shows it, for example "0.0001" or "1,234.5". */
export function zatOfText(text) {
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,8}))?$/.exec(text.trim());
  if (!m) throw new Error(`cannot read the amount "${text}"`);
  return Number(m[1].replaceAll(",", "")) * 1e8 + Number((m[2] ?? "").padEnd(8, "0"));
}

// The page reads the chain height from its own server (our node through /lwd, or ChainSafe), and
// this script from ours: two servers can be a block or two apart.
const SKEW = 2;

/**
 * The fee and the list of failed checks. `tips` are the chain heights read before Propose and
 * after the payment showed: the engine read its own height between them.
 */
export function verify(facts) {
  const { header, tips, totalBefore, totalAfter, pageFee, pagePriority, priority } = facts;
  const fee = totalBefore - totalAfter - PAY_ZAT;
  const unit = BASE_FEE * (priority ? 10 : 1);
  const tip = header.expiry - EXPIRY_BLOCKS - 1;
  const checks = [
    [
      tip >= tips[0] - SKEW && tip <= tips[1] + SKEW,
      `expiry ${header.expiry} is not ${tips[0]}..${tips[1]} (± ${SKEW}) + 1 + ${EXPIRY_BLOCKS}`,
    ],
    [fee % unit === 0 && fee / unit >= 2, `fee ${fee} is not ${unit} x k with k >= 2`],
    [fee === pageFee, `fee ${fee} differs from the fee of the page, ${pageFee}`],
    [pagePriority === priority, `the page shows a ${pagePriority ? "priority" : "network"} fee`],
    [header.version === 6, `transaction version ${header.version}, not 6`],
    [header.branchId === BRANCH_ID, `branch id ${header.branchId.toString(16)}`],
  ];
  return { fee, problems: checks.filter(([ok]) => !ok).map(([, why]) => why) };
}

// ── Resources: each is released once, also on a failure or a signal ──

const held = new Map();
const releasing = new Set();
let stopped = false;

/** Keeps `release` for the cleanup. After a signal, the run stops at its next resource. */
function hold(name, release) {
  held.set(name, release);
  if (stopped) throw new Error("stopped by a signal");
}

async function release(name) {
  const fn = held.get(name);
  held.delete(name);
  if (!fn) return;
  const done = fn().catch((err) => log(`release of ${name} failed: ${err.message}`));
  releasing.add(done);
  await done;
  releasing.delete(done);
}

/** Releases every resource, newest first, and waits for the releases that already run. */
async function releaseAll() {
  while (held.size) await release([...held.keys()].at(-1));
  await Promise.all(releasing);
}

const pidAlive = (pid) => {
  if (!(pid > 0)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
};

function lockOwner(file) {
  try {
    return Number(readFileSync(file, "utf8"));
  } catch {
    return 0;
  }
}

/** One run at a time: a lock file in the wallet folder. A dead run's file is taken over. */
function takeLock() {
  const file = join(WALLET, "live.lock");
  for (let i = 0; i < 2; i += 1) {
    try {
      writeFileSync(file, String(process.pid), { flag: "wx", mode: 0o600 });
      return hold("lock", async () => rmSync(file, { force: true }));
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      const owner = lockOwner(file);
      if (pidAlive(owner)) throw new Error(`${WALLET_SHOWN}/live.lock is held by pid ${owner}`);
      rmSync(file, { force: true });
    }
  }
  throw new Error(`cannot take ${WALLET_SHOWN}/live.lock`);
}

const freePort = () =>
  new Promise((ok, bad) => {
    const probe = net.createServer();
    probe.once("error", bad);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => ok(port));
    });
  });

const answers = (port) =>
  fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(2000) }).then(
    (res) => res.status === 200,
    () => false,
  );

function serverEnv(tmp) {
  return {
    ...process.env,
    WRANGLER_SEND_METRICS: "false",
    CI: "1",
    XDG_CONFIG_HOME: join(tmp, "xdg"),
    WRANGLER_LOG_PATH: join(tmp, "logs"),
    WRANGLER_REGISTRY_PATH: join(tmp, "registry"),
  };
}

/** SIGTERM to the server and to every process below it, then SIGKILL to the survivors. */
async function stopServer(proc, tmp) {
  const family = [...ownProcesses([proc.pid]).keys()];
  proc.kill("SIGTERM");
  const gone = () => family.every((pid) => !pidAlive(pid));
  const kill = (pid) => {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // It ended after the check.
    }
  };
  await waitFor(gone, 20_000, () => "the server to stop").catch(() => {
    family.filter(pidAlive).forEach(kill);
  });
  rmSync(tmp, { recursive: true, force: true });
}

/** Starts the local server on the persisted state of the test wallet (the group documents). */
async function startServer(port) {
  const tmp = mkdtempSync(join(tmpdir(), "zec-pay-"));
  for (const name of ["xdg", "logs"]) mkdirSync(join(tmp, name));
  const out = openSync(join(tmp, "server.log"), "a");
  const cli = join(ROOT, "cf", "node_modules", "wrangler", "wrangler-dist", "cli.js");
  const args = ["--no-warnings", cli, "dev", "--local", "--port", String(port)];
  args.push("--inspector-port", "0", "--show-interactive-dev-session=false");
  args.push("--persist-to", join(WALLET, "server-state"), "--var", "DEV_NO_AUTH:1");
  const opts = { cwd: join(ROOT, "cf"), env: serverEnv(tmp), stdio: ["ignore", out, out] };
  const proc = spawn(process.execPath, args, opts);
  closeSync(out);
  hold("server", () => stopServer(proc, tmp));
  const ready = async () => {
    if (proc.exitCode !== null) {
      const tail = readFileSync(join(tmp, "server.log"), "utf8").trim().split("\n").slice(-5);
      throw new Error(`the server exited: ${tail.join(" / ")}`);
    }
    return answers(port);
  };
  await waitFor(ready, 90_000, () => "the local server");
}

// ── The test wallet ──

/** Both seats, in seat order: { seat, name, pass, text }. Every secret goes to the redactor. */
function loadWallet() {
  // A parse error quotes the text near the fault, which can be a secret.
  const read = (name) => {
    const text = readFileSync(join(WALLET, name), "utf8");
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${WALLET_SHOWN}/${name} is not valid JSON`);
    }
  };
  const payee = read("payee.json");
  redact.add(payee.seed, payee.ufvk);
  const files = read("secrets.json").seats.map(({ seat, file, pass }) => ({
    seat,
    name: file,
    pass,
    text: readFileSync(join(WALLET, file), "utf8"),
  }));
  for (const { pass, text } of files) redact.add(pass, text);
  return { files: files.sort((a, b) => a.seat - b.seat), address: payee.address };
}

function leaves(value) {
  if (typeof value === "string") return value.length >= 16 ? [value] : [];
  if (value && typeof value === "object") return Object.values(value).flatMap(leaves);
  return [];
}

function openBackup(file) {
  const open = JSON.parse(Z.backupOpen(file.pass, file.text));
  redact.add(open.key, open.wallet.ufvk, open.wallet.orchard_fvk, ...leaves(open.secret));
  return open;
}

function checkSeats(opened) {
  const [one, two] = opened;
  const ok = opened.length === 2 && one.group === two.group && one.seat === 1 && two.seat === 2;
  if (!ok || one.threshold !== 2 || one.of !== 2) {
    throw new Error(`${WALLET_SHOWN} must hold seats 1 and 2 of one 2-of-2 wallet`);
  }
}

/** `promise`, or a failure after `ms`: a server that hangs must not hold the run. */
function within(ms, what, promise) {
  let timer;
  const late = new Promise((_, bad) => {
    timer = setTimeout(() => bad(new Error(`${what} gave no answer in ${ms / 1000} s`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

let lwd = PUBLIC_LWD;

/**
 * The light-wallet servers for the chain reads in Node, in order: ZIGS_LWD, the server in lwd.txt
 * of the wallet folder (our testnet node; lwd.zigs.app answers only the app), then the public
 * fallback of the page.
 */
function lwdServers() {
  let local = "";
  try {
    local = readFileSync(join(WALLET, "lwd.txt"), "utf8").trim();
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  return [process.env.ZIGS_LWD, local, PUBLIC_LWD].filter(Boolean);
}

/** Takes the first server that gives the chain height, as the page does. */
async function pickServer() {
  const why = [];
  for (const url of lwdServers()) {
    try {
      await within(CALL_MS, url, Z.latestHeight(url));
      lwd = url;
      return;
    } catch (err) {
      why.push(err.message);
    }
  }
  throw new Error(`no light-wallet server answers: ${why.join("; ")}`);
}

const tipNow = () => within(CALL_MS, "the chain height", Z.latestHeight(lwd));
const syncOf = async (cw) => JSON.parse(await within(SYNC_MS, "the sync", cw.sync(() => {})));

async function readChain(open) {
  const cw = new Z.ChainWallet(open.wallet.ufvk, open.wallet.birthday, lwd);
  hold("chain wallet", async () => cw.free());
  const bal = await syncOf(cw);
  return { cw, bal, sent: new Set(JSON.parse(cw.sent())) };
}

// ── The page ──

const pageWhy = (page) =>
  run(page, () => {
    const texts = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim());
    return [...texts("#banner-text"), ...texts(".send-why"), ...texts(".callout.bad")]
      .filter(Boolean)
      .join(" | ");
  })
    .catch(() => "")
    .then(redact);

async function until(page, what, fn, ms) {
  try {
    return await waitFor(fn, ms, () => what);
  } catch (err) {
    throw new Error(`${err.message}. The page says: ${(await pageWhy(page)) || "nothing"}`);
  }
}

async function press(page, text, ms = 20_000) {
  try {
    await clickText(page, text, { exact: true, ms });
  } catch (err) {
    throw new Error(`${err.message}. The page says: ${(await pageWhy(page)) || "nothing"}`);
  }
}

const hasForm = (page) => run(page, () => !!document.querySelector('[id^="s-to-"]'));

const sessionId = (page) =>
  run(page, () => {
    const row = document.querySelector('[data-key^="pay-"][aria-current="true"]');
    return row ? row.dataset.key.slice("pay-".length) : null;
  });

const shownFee = (page) =>
  run(page, () => {
    const rows = [...document.querySelectorAll(".lines > div")];
    const row = rows.find((r) => /^(Network|Priority) fee/.test(r.children[0]?.textContent ?? ""));
    if (!row) return null;
    return { label: row.children[0].textContent.trim(), text: row.children[1].textContent.trim() };
  });

const explorerTxid = (page) =>
  run(page, () => {
    const link = [...document.querySelectorAll("a[href]")].find((a) =>
      a.textContent.startsWith("View in explorer"),
    );
    return link ? (/[0-9a-f]{64}/.exec(link.href)?.[0] ?? null) : null;
  });

const openRequest = (page, id) =>
  run(
    page,
    (sid) => {
      const row = document.querySelector(`[data-key="pay-approve-${sid}"]`);
      if (row) row.click();
      return !!row;
    },
    id,
  );

/** Fills the Send form and proposes. Returns the chain height read just before the click. */
async function propose(page, address) {
  await press(page, "Send", SEND_MS);
  await until(page, "the Send form", () => hasForm(page), 20_000);
  await setInput(page, '[id^="s-to-"]', address);
  await setInput(page, '[id^="s-amt-"]', "0.001");
  if (PRIORITY) await setInput(page, "#s-priority", true);
  const tipBefore = await tipNow();
  await press(page, "Propose payment");
  return tipBefore;
}

/** Proposal, both approvals, proof and broadcast. Returns the txid and what the page showed. */
async function payInPages([first, second], address) {
  const tipBefore = await propose(first, address);
  const id = await until(first, "the payment", () => sessionId(first), 60_000);
  const tips = [tipBefore, await tipNow()];
  const shown = await until(first, "the fee of the payment", () => shownFee(first), 120_000);
  const pageFee = zatOfText(shown.text);
  const pagePriority = shown.label.startsWith("Priority");
  log(`proposed; the page shows "${shown.label}: ${shown.text}"`);
  await press(first, "Approve payment", APPROVE_MS);
  await until(second, "the approval request", () => openRequest(second, id), APPROVE_MS);
  await press(second, "Approve payment", APPROVE_MS);
  log("both seats approved; building the proof");
  await press(first, "Build proof", APPROVE_MS);
  await press(first, "Send to network", PROOF_MS);
  log("sent to the network; without a link, see the history of the wallet before a new run");
  const txid = await until(first, "the explorer link", () => explorerTxid(first), 120_000);
  return { txid, tips, pageFee, pagePriority };
}

async function openSeats(harness, rig, files, group) {
  return Promise.all(
    files.map(async (file) => {
      const page = await harness.openApp(rig, `seat${file.seat}`, `${harness.origin}/`);
      await harness.restoreZcash(page, file, group);
      return page;
    }),
  );
}

// The harness reads the port of the server when it loads, so it loads after the port is set.
async function loadHarness(port) {
  process.env.SOLSPIKE_PORT = String(port);
  const { openApp } = await import("../solspike/harness/seats.mjs");
  const { restoreZcash } = await import("../solspike/harness/backups.mjs");
  const { ORIGIN } = await import("../solspike/harness/server.mjs");
  return { openApp, restoreZcash, origin: ORIGIN };
}

async function paymentInBrowser(wallet, group) {
  const port = await freePort();
  const harness = await loadHarness(port);
  await startServer(port);
  log(`server on port ${port}; starting Chrome and restoring both seats`);
  const rig = await startRig("zec-pay");
  hold("browser", () => rig.close());
  const pages = await openSeats(harness, rig, wallet.files, group);
  const made = await payInPages(pages, wallet.address);
  return { ...made, pages };
}

// The chip of the open payment. A click on Refresh, at most every 20 s, syncs the page; the
// drawer covers the button, so the click goes through the page.
const chipNow = (page) =>
  run(page, () => {
    const now = Date.now();
    const refresh = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "Refresh",
    );
    if (refresh && !refresh.disabled && now - (window.zecPayRefresh || 0) > 20_000) {
      window.zecPayRefresh = now;
      refresh.click();
    }
    return document.querySelector(".drawer-head .badge")?.textContent.trim() ?? null;
  });

/** After the block, both seats show "Sent": the engine's session state of each (ZEC-13). */
async function bothSent(pages) {
  for (const [i, page] of pages.entries()) {
    const sent = async () => (await chipNow(page)) === "Sent";
    await until(page, `"Sent" on the page of seat ${i + 1}`, sent, CHIP_MS);
  }
}

// ── The chain ──

// A failed sync is tried again at the next poll: the coins are spent, so only the deadline ends it.
async function waitMined(cw, txid) {
  const end = Date.now() + MINED_MS;
  for (;;) {
    const bal = await syncOf(cw).catch((err) => {
      if (stopped || Date.now() > end) throw err;
      log(`a sync failed, trying again: ${err.message}`);
      return null;
    });
    if (bal && JSON.parse(cw.sent()).includes(txid)) {
      const entry = JSON.parse(cw.snapshot()).sent.find((s) => s.txid === txid);
      return { block: entry.h, total: bal.spendable + bal.pending };
    }
    if (Date.now() > end) throw new Error(`transaction ${txid} is not mined after 10 minutes`);
    await sleep(POLL_MS);
  }
}

async function headerOf(txid) {
  const hash = Buffer.from(txid, "hex").reverse().toString("hex");
  const raw = await within(CALL_MS, "the transaction", Z.fetchTransaction(lwd, hash));
  return parseHeader(Buffer.from(raw, "base64"));
}

function enoughFunds(bal) {
  const need = PAY_ZAT + BASE_FEE * 4 * FACTOR;
  if (bal.spendable >= need) return;
  const have = `${bal.spendable} zat spendable and ${bal.pending} zat pending`;
  throw new Error(`the test wallet needs ${need} zat spendable; it has ${have}. Wait or refill`);
}

async function live() {
  const wallet = loadWallet();
  const opened = wallet.files.map(openBackup);
  checkSeats(opened);
  await pickServer();
  const { cw, bal, sent } = await readChain(opened[0]);
  enoughFunds(bal);
  const made = await paymentInBrowser(wallet, opened[0].group);
  if (sent.has(made.txid)) throw new Error(`transaction ${made.txid} was in the wallet before`);
  log(`sent ${made.txid}; waiting for a block`);
  const mined = await waitMined(cw, made.txid);
  await bothSent(made.pages);
  log("both pages show the payment as sent");
  await release("browser");
  await release("server");
  const header = await headerOf(made.txid);
  const totals = { totalBefore: bal.spendable + bal.pending, totalAfter: mined.total };
  const { fee, problems } = verify({ ...made, ...totals, header, priority: PRIORITY });
  if (problems.length) throw new Error(`${made.txid} fails: ${problems.join("; ")}`);
  const line = `txid=${made.txid} block=${mined.block} expiry=${header.expiry} fee=${fee}`;
  return `zec-pay ok ${line}${PRIORITY ? " priority" : ""}`;
}

// ── Start and end ──

// An open handle can keep Node alive after the cleanup. It ends the run with the code so far.
function armBackstop(ms = 12_000) {
  setTimeout(() => {
    console.error("zec-pay: still running after the cleanup; ending it");
    process.exit(process.exitCode ?? 0);
  }, ms).unref();
}

/** A signal stops the server and Chrome at once; `main` then fails at its next step. */
function stopOnSignal(signal, running) {
  stopped = true;
  process.exitCode = 1;
  log(`${signal}: stopping`);
  void releaseAll();
  const settled = Promise.race([running, sleep(30_000)]);
  void settled.then(releaseAll).finally(() => process.exit(1));
}

async function main() {
  const unknown = process.argv.slice(2).filter((arg) => arg !== "--priority");
  if (unknown.length) throw new Error(`unknown argument ${unknown.join(" ")}; only --priority`);
  const peak = trackPeak(() => [process.pid]);
  Z.initSync({ module: readFileSync(new URL("../web/pkg/zigs_engine_bg.wasm", import.meta.url)) });
  try {
    takeLock();
    console.log(redact(await live()));
  } finally {
    await releaseAll();
    log(`peak of ${peak.stop().peak} processes`);
  }
}

const isMain = realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const running = main()
    .catch((err) => {
      console.error(redact(`zec-pay failed: ${err.message}`));
      process.exitCode = 1;
    })
    .finally(() => armBackstop());
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => stopOnSignal(signal, running));
  }
}
