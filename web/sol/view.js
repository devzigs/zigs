// The Solana tab of a wallet page. It shows the progress of each seat, the owner address and the
// shielded address, the balances of the last sync, the buttons for the sync, the backup and the
// restore, and (payview.js) the funding, the proposals and their approvals.
// `data-sol` marks each value for the headless checks. `host.el` builds the elements, `act` wraps
// a button action (act of app-dom.js).
import { agreement, seatProgress, started, startBlock } from "./ceremony.js";
import { base58 } from "./docs.js";
import { payCards } from "./payview.js";
import { feeMismatch, feeOf } from "./fee.js";
import { holdsShare, remoteStop, solOf, stopOf } from "./secrets.js";

const ADD_TEXT =
  "A Solana program owns the funds of the group at a program address, which is public and links " +
  "to the group key. Each seat also gets a fee address, which appears on chain next to the " +
  "group when the seat pays. A fee address needs a public SOL funding trail. The program and its " +
  "upgrade key are outside the group, and the beta has no audit.";

// What is public and what Helius sees (SOL-12). The tab shows it in each state, also while the
// setup runs: the seats of this browser join the setup with no click.
export const PUBLIC_TEXT =
  "A deposit shows its sender and amount on chain. A withdrawal shows its recipient and amount. " +
  "A private payment hides its amount, but it shows the owner key of the payee. The program " +
  "address, the group key and the fee address of each seat that pays are public too. Helius " +
  "sees that you use Zigs, your IP address and the keys of this wallet, and its hosted prover " +
  "sees each payment. The Zigs server operator can link this wallet to these addresses by timing.";
function statusOf(c, ag) {
  if (startBlock(c.host)) return "unavailable";
  if (stopOf(c)) return "stopped";
  if (!started(c.docs)) return "not started";
  return { agree: "ready", differ: "differs", wait: "running" }[ag.state];
}

/**
 * The Solana part for the setup steps of the page (app-setup.js): the status, how many seats
 * published their key, and the fee addresses of this browser with the balance of the last read
 * ("0.006 SOL", or undefined before the first read). Public values only.
 */
export function setupSummary(c) {
  const { host } = c,
    seats = host.seatIds();
  const mine = host.localSeats().filter((i) => holdsShare(solOf(host, c.gid, i)));
  const feeRow = (i) => {
    const address = base58(feeOf(c, i).key);
    return { seat: i, address, balance: c.chain?.fees?.[i] };
  };
  const fees = mine.filter((i) => !feeMismatch(c, i) && feeOf(c, i)).map(feeRow);
  return {
    status: statusOf(c, agreement(c)),
    keys: seats.filter((i) => c.docs.soldone[i]).length,
    n: seats.length,
    fees,
  };
}

function startCard(c, act, actions) {
  const { el, localSeats } = c.host,
    why = startBlock(c.host);
  if (why) return el("p", { class: "small" }, why);
  const mine = localSeats().includes(1);
  return el(
    "div",
    { style: "display:grid;gap:8px" },
    el("p", { class: "small" }, ADD_TEXT),
    mine
      ? el(
          "button",
          {
            class: "btn primary",
            type: "button",
            "data-sol": "add",
            onclick: act(actions.add),
          },
          "Add Solana",
        )
      : el("p", { class: "small" }, "Seat 1 starts the Solana setup."),
  );
}

function seatList(c) {
  const { el, seatIds } = c.host;
  return el(
    "ul",
    { class: "list" },
    seatIds().map((i) =>
      el(
        "li",
        {
          "data-sol": "seat-" + i,
        },
        seatProgress(c, i),
      ),
    ),
  );
}

const PAY_TO =
  "Pay this group only to its full shielded address. The program address alone is not enough, " +
  "and a payment to another key is not counted.";

// ponytail: read from Devnet on 18 October 2026 (the ProgramData account of the pool and its
// protocol config), not live. Helius can change them; reading both accounts in the Worker
// would show the current ones.
const POOL_UPGRADE_KEY = "2kgbLowvCQuMWxDKbHUZAURycziuRrvmtTuDEYMGMRsj";
const PROTOCOL_AUTHORITY = "263Kgjft9NezaYTspFquMbAhgRf7xfAiyusaweLowdXo";
const CUSTODY_TEXT =
  "Both keys sit outside the group: no seat holds them, no seat can stop them, and Zigs does not " +
  "know who holds them. The upgrade key is a signing key, and it can replace the pool program. " +
  "The protocol authority is an account that needs 2 of its 5 keys to act (a Squads account, by " +
  "the Zolana spec). It can pause the trees, and then no payment can move the funds. It can also " +
  "set the fees of the pool and change its other authorities, but not the upgrade key. Read " +
  "from Devnet on 18 October 2026.";

function keyBlock(c, done) {
  const { el } = c.host,
    row = (name, label, value) => [
      el("dt", {}, label),
      el("dd", { class: "hex", "data-sol": name }, value),
    ];
  return el(
    "dl",
    { class: "kv" },
    row("owner", "Program address of the group (Devnet)", done.pda ? base58(done.pda) : "?"),
    row("group-key", "Group key", done.groupKey),
    row("shielded", "Shielded address", done.pdaAddress ?? "?"),
    el("dd", { class: "small", "data-sol": "pay-to" }, PAY_TO),
    row("balance-private", "Private balance", c.sync.balance ?? "not synced"),
    row(
      "balance-public",
      "Public balance of the group key",
      c.chain?.balance ?? "not read yet",
    ),
    row("pool-upgrade", "Upgrade key of the pool (Devnet)", POOL_UPGRADE_KEY),
    row("pool-protocol", "Protocol authority of the pool (Devnet)", PROTOCOL_AUTHORITY),
    el("dd", { class: "small", "data-sol": "custody-text" }, CUSTODY_TEXT),
  );
}

const SYNC_TEXT =
  "A sync asks Helius for the notes of the program address and the group key. So Helius sees " +
  "these keys with your IP address, and it can list every note of the wallet.";

function syncCard(c, act, actions) {
  const { el } = c.host;
  return el(
    "div",
    { style: "display:grid;gap:8px" },
    el(
      "div",
      { class: "row-actions" },
      el(
        "button",
        {
          class: "btn",
          type: "button",
          "data-sol": "sync",
          disabled: c.sync.busy,
          onclick: act(actions.sync),
        },
        c.sync.busy ? "Syncing…" : "Sync Solana",
      ),
      el("span", { class: "small", "data-sol": "worker" }, c.sync.text ?? "not started"),
    ),
    el("p", { class: "small", "data-sol": "sync-text" }, SYNC_TEXT),
  );
}

function backupCard(c, act, actions) {
  const { el, localSeats } = c.host;
  const seats = localSeats().filter((i) => holdsShare(solOf(c.host, c.gid, i)));
  const input = el("input", {
    id: "sol-restore",
    type: "file",
    accept: ".zigsbackup,.json,application/json",
    hidden: true,
    onchange: (ev) => {
      const file = ev.target.files[0];
      ev.target.value = "";
      if (file) actions.restoreFile(file);
    },
  });
  return el(
    "div",
    { class: "row-actions" },
    seats.map((i) =>
      el(
        "button",
        {
          class: "btn sm",
          type: "button",
          "data-sol": "backup-" + i,
          onclick: act(() => actions.backup(i)),
        },
        "Back up Solana part, seat " + i,
      ),
    ),
    el(
      "button",
      {
        class: "btn sm",
        type: "button",
        "data-sol": "restore",
        onclick: () => input.click(),
      },
      "Restore Solana part from a backup",
    ),
    input,
  );
}

// A stop is final for the Solana part only. The next step for Solana is a new wallet.
export const STOP_NEXT =
  "The Zcash part of this wallet still works. To use Solana, create a new wallet.";

function stopCards(c) {
  const { el, localSeats } = c.host;
  const own = localSeats()
    .map((i) => solOf(c.host, c.gid, i).aborted)
    .filter(Boolean);
  const texts = own.length ? own : [remoteStop(c.docs)].filter(Boolean);
  const next = () =>
    el(
      "button",
      { class: "btn sm", type: "button", "data-sol": "new-wallet", onclick: c.host.newWallet },
      "Create a new wallet",
    );
  const card = (text) =>
    el("div", { class: "callout bad", role: "alert", "data-sol": "stopped" }, text, " ", STOP_NEXT);
  return texts.map((text) => [card(text), next()]);
}

// The keys and the sync need agreeing documents. A stopped wallet shows neither.
function readyCards(c, act, actions, ag) {
  if (ag.state !== "agree" || stopOf(c)) return [];
  const share = c.host.localSeats().some((i) => holdsShare(solOf(c.host, c.gid, i)));
  if (!share) return [keyBlock(c, ag.done)];
  return [keyBlock(c, ag.done), syncCard(c, act, actions), ...payCards(c, act, actions)];
}

/**
 * The tab. `actions` has add, sync, backup(seat), restoreFile(file), refresh, propose(kind, args),
 * approve(session, seat) and addSol(args).
 */
export function solView(c, act, actions) {
  const { el } = c.host,
    ag = agreement(c),
    status = statusOf(c, ag);
  const stopped = !!stopOf(c);
  return el(
    "section",
    { class: "card card-pad", style: "display:grid;gap:12px" },
    el(
      "div",
      { class: "card-head" },
      el("h2", {}, "Solana"),
      el("span", { class: "badge plain" }, "Devnet only · beta"),
    ),
    el("p", { class: "small", "data-sol": "status" }, status),
    el("p", { class: "small", "data-sol": "public-text" }, PUBLIC_TEXT),
    ...stopCards(c),
    started(c.docs) ? seatList(c) : stopped ? null : startCard(c, act, actions),
    ag.state === "differ" ? el("div", { class: "callout bad", role: "alert" }, ag.why) : null,
    ...readyCards(c, act, actions, ag),
    stopped ? null : backupCard(c, act, actions),
  );
}
