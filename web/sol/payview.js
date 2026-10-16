// The payment part of the Solana tab: the fund card (the fee address of each seat of this browser),
// Add SOL, the form of a private payment, the one-time move of the beta funds to the program
// address, and the signing sessions with their approval screens. An approval screen shows what
// the checker of this device accepted (approve.js reviewOf): the values come from the intent bytes
// and the proof, never from the display fields of the proposer. Each screen of a payment says who
// pays, what it costs and what it makes public (ZOLANA.md 7.2). `data-session` marks a session and
// `data-sol` marks a control, for the headless checks.
import { reviewOf } from "./approve.js";
import { agreement } from "./ceremony.js";
import { CLUSTER, base58 } from "./docs.js";
import { EXECUTE_TRIES } from "./execute.js";
import { feeMismatch, feeOf, mismatchText } from "./fee.js";
import { readySeat } from "./gate.js";
import { BASE_FEE, EXECUTE_FEE, NONCE_RENT, bytesOf, decodeIntent, readVerdict } from "./intent.js";
import { usedDigest } from "./nonces.js";
import { holdsShare, solOf } from "./secrets.js";
import { solText } from "./session.js";
import { isPayment } from "./sessions.js";

const SHOWN = 12;
const FAUCET = "https://faucet.solana.com/";
const TITLES = {
  createNonce: "Create the nonce account for the move",
  transfer: "Move the beta funds to the program address",
  approve: "Send privately",
};
const WHAT = {
  createNonce:
    "Creates the account that the move of the beta funds needs. The proposing seat pays its " +
    "rent, and the group key owns the account.",
  transfer:
    "Moves all private SOL that the group key holds from the beta to the program address of the " +
    "group. This is the last payment with a nonce. After it, the group pays with approvals.",
  approve:
    "Pays SOL from the shielded balance of the group to the payee. The chain shows neither " +
    "the payee nor the amount. The change stays with the group.",
};
const LIFETIME = {
  createNonce: "About 1 to 2 minutes (a recent blockhash). Approve and sign now.",
  other: "Until the nonce account advances. It has no other expiry.",
};
const STATES = {
  collecting: "Collecting approvals",
  signing: "Signing",
  signed: "Signed, sending",
  sent: "Sent",
  failed: "Failed",
};
const PAYMENT_STATES = { ...STATES, signed: "Approved, executing", sent: "Executed" };
const short = (hex) => hex.slice(0, 8) + "…" + hex.slice(-6);
/** The rent of a proposal account with one abort authority on Devnet (SOL-35, ZOLANA.md 6.10). */
const PROPOSAL_RENT = 1_356_360n;

function copyButton(c, text, mark) {
  const copy = async (ev) => {
    const button = ev.currentTarget;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Select and copy";
    }
  };
  return c.host.el(
    "button",
    { class: "btn sm", type: "button", "data-sol": mark, onclick: copy },
    "Copy",
  );
}

/** What a fee address costs in privacy (ZOLANA.md 7.2, SOL-36 condition 4). */
export const LINK_TEXT =
  "Public link: this fee address pays in public SOL, and the chain shows it next to the program " +
  "address of the group. So anyone can link this seat to the group. Its funding transfer links " +
  "the sender of that SOL too.";

const FEE_TEXT =
  "It pays the fees and the rents of the proposals that this seat makes, and the fee of each " +
  "payment that this seat executes. Send Devnet SOL to it. " +
  LINK_TEXT;

/** The fee address of one seat of this browser: the address, Copy and the balance. */
function feeRow(c, seat) {
  const { el } = c.host;
  if (feeMismatch(c, seat)) {
    return el("p", { class: "small bad", "data-sol": "fee-mismatch-" + seat }, mismatchText(seat));
  }
  const address = base58(feeOf(c, seat).key);
  return el(
    "div",
    { style: "display:grid;gap:4px", "data-sol": "fee-" + seat },
    el("strong", {}, "Your fee address (seat " + seat + ")"),
    el(
      "div",
      { class: "row-actions" },
      el("span", { class: "hex", "data-sol": "fee-address-" + seat }, address),
      copyButton(c, address, "copy-fee-" + seat),
    ),
    el(
      "span",
      { class: "small", "data-sol": "fee-balance-" + seat },
      "Balance: " + (c.chain?.fees?.[seat] ?? "not read yet"),
    ),
  );
}

function fundCard(c, act, actions) {
  const { el } = c.host;
  const seats = c.host.localSeats().filter((i) => holdsShare(solOf(c.host, c.gid, i)));
  return el(
    "div",
    { style: "display:grid;gap:8px" },
    el("h3", {}, "Fund the fee address"),
    el("p", { class: "small", "data-sol": "fee-text" }, FEE_TEXT),
    ...seats.map((seat) => feeRow(c, seat)),
    el(
      "div",
      { class: "row-actions" },
      el(
        "a",
        {
          class: "btn sm ghost",
          href: FAUCET,
          target: "_blank",
          rel: "noopener",
          "data-sol": "faucet",
        },
        "Get Devnet SOL ↗",
      ),
      el(
        "button",
        { class: "btn sm", type: "button", "data-sol": "refresh", onclick: act(actions.refresh) },
        "Check balance",
      ),
    ),
  );
}

const ADD_TEXT =
  "Moves SOL from the fee address of your seat into the shielded balance of the group, at its " +
  "program address. The amount and the sender are public. It needs no approval: it is your own " +
  "SOL.";

/** A line that names the seat of this browser that pays: the first ready one. Null when none. */
function seatLine(c, mark, what) {
  const seat = readySeat(c);
  if (seat === undefined) return null;
  const text = `Seat ${seat} of this browser ${what}`;
  return c.host.el("p", { class: "small", "data-sol": mark }, text);
}

/** What the last Add SOL did, as a line of text. */
function addedLine(c) {
  const a = c.added;
  if (!a) return null;
  const words = { unknown: "Sent, not confirmed yet", failed: "Failed on chain" };
  const word = words[a.status] ?? "Added " + solText(a.amount);
  const line = `${word}, seat ${a.seat}: ${a.txId}`;
  return c.host.el("p", { class: "small", "data-sol": "added" }, line);
}

function addSolCard(c, act, actions) {
  const { el } = c.host;
  const amount = el("input", {
    class: "input mono",
    id: "sol-add-amount",
    "data-sol": "add-sol-amount",
    value: "0.02",
    inputmode: "decimal",
    autocomplete: "off",
  });
  const run = () => actions.addSol({ amount: amount.value });
  return el(
    "div",
    { style: "display:grid;gap:8px" },
    el("h3", {}, "Add SOL"),
    el("p", { class: "small", "data-sol": "add-sol-text" }, ADD_TEXT),
    seatLine(c, "add-sol-seat", "adds this SOL, from its fee address."),
    el(
      "div",
      { class: "row-actions" },
      el("label", { class: "field" }, el("span", {}, "Amount (SOL)"), amount),
      el(
        "button",
        { class: "btn", type: "button", "data-sol": "add-sol", onclick: act(run) },
        "Add SOL",
      ),
    ),
    addedLine(c),
  );
}

const rentOf = (c) => BigInt(c.chain?.proposalRent ?? PROPOSAL_RENT);

/** What a payment costs its seats in public SOL, as a line. */
const costLine = (c) =>
  "The proposing seat pays " +
  solText(BASE_FEE) +
  " to create the proposal account and holds " +
  solText(rentOf(c)) +
  " in it as rent until it closes. The seat that executes pays " +
  solText(EXECUTE_FEE) +
  " and the tree fee. The rent goes back to the proposing seat at the execute. A proposal that " +
  "expires keeps its rent: this app cannot cancel it yet.";

const button = (c, act, mark, text, run) =>
  c.host.el(
    "button",
    { class: "btn", type: "button", "data-sol": mark, onclick: act(run) },
    text,
  );

function intentCard(c, act, actions) {
  const { el } = c.host;
  return el(
    "div",
    { style: "display:grid;gap:8px" },
    el("h3", {}, "Send privately"),
    seatLine(c, "propose-seat", "proposes and pays the fees."),
    el("p", { class: "small", "data-sol": "pay-cost" }, costLine(c)),
    sendForm(c, act, actions),
  );
}

/** The form of a private payment: the full shielded address of the payee and an amount. */
function sendForm(c, act, actions) {
  const { el } = c.host;
  const field = (mark, id, value, attrs = {}) =>
    el("input", {
      class: "input mono",
      id,
      "data-sol": mark,
      autocomplete: "off",
      value,
      ...attrs,
    });
  const to = field("send-to", "sol-send-to", "", { spellcheck: "false" });
  const amount = field("send-amount", "sol-send-amount", "0.005", { inputmode: "decimal" });
  const send = () => actions.propose("pay", { recipient: to.value, amount: amount.value });
  return el(
    "div",
    { style: "display:grid;gap:8px" },
    el("label", { class: "field" }, el("span", {}, "Payee (full shielded address)"), to),
    el(
      "div",
      { class: "row-actions" },
      el("label", { class: "field" }, el("span", {}, "Amount (SOL)"), amount),
      button(c, act, "send", "Send privately", send),
    ),
  );
}

const MOVE_TEXT =
  "This wallet holds private SOL at the old address of the group key. Move it to the program " +
  "address of the group. A move uses the nonce account: the seats approve and sign it as before. " +
  "One move takes up to 16 notes, so many small notes need more than one move. The card shows " +
  "again if a payer sends SOL to the old address.";

/** The one-time move of the beta funds (SOL-36 condition 3). Null when the group key holds none. */
function moveCard(c, act, actions) {
  const { el } = c.host;
  const held = BigInt(c.sync?.oldBalance ?? "0");
  if (held <= 0n) return null;
  const missing = c.chain?.nonce === "missing";
  const nonce = { created: "created", missing: "not created yet" }[c.chain?.nonce] ?? "?";
  const steps = missing
    ? [
        button(c, act, "create-nonce", "Create the nonce account", () =>
          actions.propose("createNonce"),
        ),
      ]
    : [button(c, act, "move-funds", "Move to the program address", () =>
        actions.propose("migrate"),
      )];
  return el(
    "div",
    { class: "callout", style: "display:grid;gap:8px", "data-sol": "move" },
    el("h3", {}, "Move the beta funds (one time)"),
    el("p", { class: "small" }, MOVE_TEXT),
    el("p", { class: "small", "data-sol": "move-held" }, "Old address: " + solText(held)),
    el("p", { class: "small", "data-sol": "nonce-state" }, "Nonce account: " + nonce),
    el("div", { class: "row-actions" }, steps),
  );
}

const sum = (list) => list.reduce((total, one) => total + one.amount, 0n);
const utc = (secs) => new Date(Number(secs) * 1000).toISOString().slice(0, 16).replace("T", " ");

/** The payee rows of a private spend, from the fingerprint that the checker answered. */
function payeeRows(said) {
  return [
    ["Payee", base58(said.payee.tag)],
    ["Payee keys", short(said.payee.ownerHash) + " " + short(said.payee.viewingPk)],
    ["Amount", solText(sum(said.paid))],
    ["Change", solText(sum(said.change)) + " stays with the group."],
  ];
}

/**
 * The rows of the move of the beta funds, from the fingerprint, the amounts and the expiry that
 * the checker answered: the payee is the key that the payee output commits to.
 */
export function transferRows(groupKey, review, fee) {
  const said = readVerdict(review.verdict);
  return [
    ["What it does", WHAT.transfer],
    ["Group address", base58(groupKey)],
    ...payeeRows(said),
    ["Network fee", solText(fee + said.treeFee)],
    ["Lasts", "Until " + utc(said.expiry) + " UTC, or until the nonce account advances."],
  ];
}

/** The network fees of a payment: the create of its account, then the execute. */
const feesText = (said) =>
  solText(BASE_FEE) +
  " at the proposal, " +
  solText(EXECUTE_FEE + said.treeFee) +
  " at the execute.";

/**
 * The rows of a payment of the program design: what the checker of this device answered, who
 * pays, the rent of the proposal account and what becomes public.
 */
function paymentRows(c, review) {
  const { said } = review;
  const pda = agreement(c).done.pda;
  return [
    ["What it does", WHAT.approve],
    ["Program address of the group", pda ? base58(pda) : "?"],
    ...payeeRows(said),
    ["Network fees", feesText(said)],
    ["Proposal rent", solText(rentOf(c)) + ", back to seat " + review.by + " at the execute " +
      "(kept if the proposal expires)."],
    ["Proposal account", base58(said.proposal)],
    ["Lasts", "Until " + utc(said.expiry) + " UTC. A new proof is made at the execute."],
    ["Public", "The proposal account (the group key, the expiry, the fee address of seat " +
      review.by + ") is public until the execute. " + LINK_TEXT],
  ];
}

/** The rows of the nonce account of the move. */
function plainRows(intent, groupKey, fee) {
  return [
    ["What it does", WHAT[intent.kind]],
    ["Group address", base58(groupKey)],
    ["Rent kept by the nonce account", solText(NONCE_RENT)],
    ["Payee", "None. The funds stay with the group."],
    ["Change", "None."],
    ["Network fee", solText(fee)],
    ["Lasts", LIFETIME[intent.kind] ?? LIFETIME.other],
  ];
}

/**
 * The labelled values of an approval screen, from what the checker accepted. The second row says
 * which seat pays and its address: the payer, as that seat published it.
 */
function rowsOf(c, review) {
  const { intent, info } = review,
    { groupKey } = agreement(c).done;
  let rows;
  if (intent.kind === "approve") rows = paymentRows(c, review);
  else {
    const fee = BASE_FEE * BigInt(info.signatures) + info.priorityFee;
    rows =
      intent.kind === "transfer"
        ? transferRows(groupKey, review, fee)
        : plainRows(intent, groupKey, fee);
  }
  rows.splice(1, 0, ["Fees paid by seat " + review.by, base58(review.payer)]);
  return rows;
}

function reviewBlock(c, ss, seat) {
  const { el } = c.host,
    review = reviewOf(c, ss, seat);
  if (!review.ok) {
    return el("div", { class: "callout bad", role: "alert", "data-sol": "refusal" }, review.why);
  }
  const rows = rowsOf(c, review).flatMap(([label, value]) => [
    el("dt", {}, label),
    el("dd", { "data-sol": "review" }, value),
  ]);
  return el("dl", { class: "kv", "data-sol": "review-" + ss.id }, rows);
}

// The digest of the proposal, or null when it cannot be read.
function digestOf(c, ss) {
  try {
    if (isPayment(ss)) return c.W.sol_approval_digest(String(ss.account), String(ss.body));
    return c.W.sol_digest(CLUSTER, bytesOf(ss.message));
  } catch {
    return null;
  }
}

/** The seats of this browser that hold a share, each with what it may do with this proposal. */
function seatsOf(c, ss) {
  const digest = digestOf(c, ss);
  return c.host
    .localSeats()
    .filter((i) => holdsShare(solOf(c.host, c.gid, i)))
    .map((seat) => {
      if (c.commits[ss.id]?.[seat]) return { seat, state: "approved" };
      return { seat, state: digest && usedDigest(c, seat, digest) ? "used" : "open" };
    });
}

const SEAT_TEXT = {
  approved: (seat) => "Seat " + seat + " approved",
  used: (seat) => "Seat " + seat + " signed these bytes before",
};

// A seat that approved, or that signed these exact bytes, gets no approval screen and no button.
function approveRow(c, ss, act, actions) {
  const { el } = c.host;
  return seatsOf(c, ss).map(({ seat, state }) => {
    if (state !== "open") return el("span", { class: "small" }, SEAT_TEXT[state](seat));
    const attrs = {
      class: "btn primary",
      type: "button",
      "data-sol": "approve-" + ss.id + "-" + seat,
      onclick: act(() => actions.approve(ss, seat)),
    };
    return el("button", attrs, "Approve as seat " + seat);
  });
}

/** The last error of the execute in this tab, and a button once its tries ran out. */
function executeLine(c, ss, act, actions) {
  const { el } = c.host;
  const error = c.execErrors?.[ss.id];
  if (ss.status !== "signed" || !error) return null;
  const out = (c.tries?.[ss.id] ?? 0) >= EXECUTE_TRIES;
  const again = () => actions.execute(ss);
  const retry = out ? button(c, act, "execute-" + ss.id, "Try the execute again", again) : null;
  return el("div", { class: "row-actions" }, el("span", { class: "small bad" }, error), retry);
}

function resultLine(c, ss) {
  const { el } = c.host;
  if (ss.status === "sent") {
    const done = isPayment(ss) ? "Executed" : "Landed";
    const word = ss.outcome === "failed" ? "Failed on chain" : done;
    return el(
      "p",
      { class: "small", "data-sol": "result" },
      `${word} in slot ${ss.slot}: ${ss.txId}`,
    );
  }
  if (ss.status === "failed") return el("p", { class: "small bad" }, String(ss.error));
  return null;
}

function sessionBody(c, ss, act, actions) {
  const { el } = c.host,
    open = seatsOf(c, ss).find((s) => s.state === "open");
  const count = Object.keys(c.commits[ss.id] ?? {}).length;
  const collecting = ss.status === "collecting";
  const proposer = `Proposed by seat ${ss.by}. Approvals: ${count} of ${c.host.state.g.t}.`;
  return [
    el("p", { class: "small" }, proposer),
    collecting && open ? reviewBlock(c, ss, open.seat) : null,
    collecting ? el("div", { class: "row-actions" }, approveRow(c, ss, act, actions)) : null,
    executeLine(c, ss, act, actions),
    resultLine(c, ss),
  ];
}

function sessionCard(c, ss, act, actions) {
  const { el } = c.host,
    kind = decodeIntent(ss.intent)?.kind ?? "unknown";
  const attrs = { class: "list-row", "data-session": ss.id, "data-kind": kind };
  const states = isPayment(ss) ? PAYMENT_STATES : STATES;
  return el(
    "div",
    { ...attrs, "data-state": ss.status },
    el("strong", {}, TITLES[kind] ?? "Unknown proposal"),
    el("span", { class: "badge plain" }, states[ss.status] ?? ss.status),
    ...sessionBody(c, ss, act, actions),
  );
}

function sessionList(c, act, actions) {
  const { el } = c.host;
  const shown = (c.sessions ?? []).slice(0, SHOWN);
  if (!shown.length) return el("p", { class: "small" }, "No Solana proposals yet.");
  return el(
    "div",
    { class: "list" },
    shown.map((ss) => sessionCard(c, ss, act, actions)),
  );
}

/** The cards of a ready wallet: fund, Add SOL, the move of the beta funds, pay, the sessions. */
export function payCards(c, act, actions) {
  return [
    fundCard(c, act, actions),
    addSolCard(c, act, actions),
    moveCard(c, act, actions),
    intentCard(c, act, actions),
    sessionList(c, act, actions),
  ].filter(Boolean);
}
