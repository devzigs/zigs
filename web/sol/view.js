// The Solana tab of a wallet page. It shows the progress of each seat, the owner address and the
// shielded address, the balances of the last sync, the buttons for the sync, the backup and the
// restore, and (payview.js) the funding, the proposals and their approvals.
// `data-sol` marks each value for the headless checks. `host.el` builds the elements, `act` wraps
// a button action (app.js).
import { agreement, seatProgress, started, startBlock } from "./ceremony.js";
import { base58 } from "./docs.js";
import { payCards } from "./payview.js";
import { holdsShare, remoteStop, solOf, stopOf } from "./secrets.js";

const ADD_TEXT =
  "A Solana program owns the funds of the group at a program address, which is public and links " +
  "to the group key. Each seat also gets a fee address, which appears on chain next to the " +
  "group. The Zigs server operator can link this wallet to these addresses by timing. Helius " +
  "sees that you use Zigs. A fee address needs a public SOL funding trail. The program and its " +
  "upgrade key are outside the group, and the beta has no audit.";
function statusOf(c, ag) {
  if (startBlock(c.host)) return "unavailable";
  if (!started(c.docs)) return "not started";
  if (stopOf(c)) return "stopped";
  return { agree: "ready", differ: "differs", wait: "running" }[ag.state];
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
  );
}

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

function stopCards(c) {
  const { el, localSeats } = c.host;
  const own = localSeats()
    .map((i) => solOf(c.host, c.gid, i).aborted)
    .filter(Boolean);
  const texts = own.length ? own : [remoteStop(c.docs)].filter(Boolean);
  return texts.map((text) =>
    el("div", { class: "callout bad", role: "alert", "data-sol": "stopped" }, text),
  );
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
    ...stopCards(c),
    started(c.docs) ? seatList(c) : startCard(c, act, actions),
    ag.state === "differ" ? el("div", { class: "callout bad", role: "alert" }, ag.why) : null,
    ...readyCards(c, act, actions, ag),
    stopped ? null : backupCard(c, act, actions),
  );
}
