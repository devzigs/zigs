// The payment part of the Solana tab: the fund card, the buttons that propose an intent, and the
// signing sessions with their approval screens. An approval screen shows what the checker of this
// device accepted (approve.js reviewOf): the values come from the intent bytes and the message,
// never from the display fields of the proposer. `data-session` marks a session and `data-sol`
// marks a control, for the headless checks.
import { reviewOf } from "./approve.js";
import { agreement } from "./ceremony.js";
import { CLUSTER, base58 } from "./docs.js";
import { BASE_FEE, NONCE_RENT, RECORD_RENT, bytesOf, decodeIntent, readVerdict } from "./intent.js";
import { usedDigest } from "./nonces.js";
import { holdsShare, solOf } from "./secrets.js";
import { solText } from "./session.js";

const SHOWN = 12;
const TITLES = {
  createNonce: "Create the nonce account",
  register: "Register the group keys",
  shield: "Shield SOL",
  transfer: "Send privately",
};
const WHAT = {
  createNonce:
    "Creates the account that lets the signers approve a transaction now and send it later. " +
    "The group pays its rent.",
  register:
    "Writes the shielded keys of the group on the public registry. This is permanent: " +
    "it cannot be undone or deleted.",
  shield:
    "Moves SOL from the public balance of the group into its own shielded balance. " +
    "Amount and sender are public.",
  transfer:
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
const short = (hex) => hex.slice(0, 8) + "…" + hex.slice(-6);

function copyButton(c, text) {
  const copy = async (ev) => {
    const button = ev.currentTarget;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Select and copy";
    }
  };
  const attrs = { class: "btn sm", type: "button", "data-sol": "copy-owner", onclick: copy };
  return c.host.el("button", attrs, "Copy");
}

function fundCard(c, act, actions) {
  const { el } = c.host,
    owner = base58(agreement(c).done.groupKey);
  const nonce = { created: "created", missing: "not created yet" }[c.chain?.nonce];
  return el(
    "div",
    { style: "display:grid;gap:8px" },
    el("h3", {}, "Fund this address"),
    el(
      "p",
      { class: "small" },
      "Send Devnet SOL to the public owner address. It pays the fees and the rents, and it " +
        "is the SOL that the group can shield.",
    ),
    el("div", { class: "row-actions" }, el("span", { class: "hex" }, owner), copyButton(c, owner)),
    el(
      "div",
      { class: "row-actions" },
      el(
        "button",
        { class: "btn sm", type: "button", "data-sol": "refresh", onclick: act(actions.refresh) },
        "Check balance",
      ),
      el("span", { class: "small", "data-sol": "nonce-state" }, "Nonce account: " + (nonce ?? "?")),
    ),
  );
}

function intentCard(c, act, actions) {
  const { el } = c.host;
  const button = (mark, text, run) =>
    el("button", { class: "btn", type: "button", "data-sol": mark, onclick: act(run) }, text);
  const amount = el("input", {
    class: "input mono",
    id: "sol-amount",
    "data-sol": "shield-amount",
    value: "0.02",
    inputmode: "decimal",
    autocomplete: "off",
  });
  return el(
    "div",
    { style: "display:grid;gap:8px" },
    el("h3", {}, "Propose"),
    el(
      "div",
      { class: "row-actions" },
      button("create-nonce", "Create nonce account", () => actions.propose("createNonce")),
      button("register", "Register", () => actions.propose("register")),
    ),
    el(
      "div",
      { class: "row-actions" },
      el("label", { class: "field" }, el("span", {}, "Amount (SOL)"), amount),
      button("shield", "Shield", () => actions.propose("shield", { amount: amount.value })),
    ),
    sendForm(c, button, actions),
  );
}

/** The form of a private payment: the full shielded address of the payee and an amount. */
function sendForm(c, button, actions) {
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
  const send = () => actions.propose("transfer", { recipient: to.value, amount: amount.value });
  return el(
    "div",
    { style: "display:grid;gap:8px" },
    el("label", { class: "field" }, el("span", {}, "Payee (full shielded address)"), to),
    el(
      "div",
      { class: "row-actions" },
      el("label", { class: "field" }, el("span", {}, "Amount (SOL)"), amount),
      button("send", "Send privately", send),
    ),
  );
}

const sum = (list) => list.reduce((total, one) => total + one.amount, 0n);
const utc = (secs) => new Date(Number(secs) * 1000).toISOString().slice(0, 16).replace("T", " ");

/**
 * The rows of a private payment, from the fingerprint, the amounts and the expiry that the checker
 * answered: the payee is the key that the payee output commits to, never the text of the proposer.
 */
export function transferRows(groupKey, review, fee) {
  const said = readVerdict(review.verdict);
  return [
    ["What it does", WHAT.transfer],
    ["Group address", base58(groupKey)],
    ["Payee", base58(said.payee.tag)],
    ["Payee keys", short(said.payee.ownerHash) + " " + short(said.payee.viewingPk)],
    ["Amount", solText(sum(said.paid))],
    ["Change", solText(sum(said.change)) + " stays with the group."],
    ["Network fee", solText(fee + said.treeFee)],
    ["Lasts", "Until " + utc(said.expiry) + " UTC, or until the nonce account advances."],
  ];
}

/** The labelled values of an approval screen, from what the checker accepted. */
function rowsOf(c, review) {
  const { intent, info } = review,
    { groupKey } = agreement(c).done;
  const fee = BASE_FEE * BigInt(info.signatures) + info.priorityFee;
  if (intent.kind === "transfer") return transferRows(groupKey, review, fee);
  const own = {
    createNonce: () => [["Rent kept by the nonce account", solText(NONCE_RENT)]],
    register: () => [
      ["Rent kept by the record", solText(RECORD_RENT)],
      ["Keys that become public", short(intent.nullifierPk) + " " + short(intent.viewingPk)],
    ],
    shield: () => [["Amount", solText(intent.amount)]],
  }[intent.kind]();
  return [
    ["What it does", WHAT[intent.kind]],
    ["Group address", base58(groupKey)],
    ...own,
    ["Payee", "None. The funds stay with the group."],
    ["Change", "None."],
    ["Network fee", solText(fee)],
    ["Lasts", LIFETIME[intent.kind] ?? LIFETIME.other],
  ];
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

// The digest of the proposal, or null when its message cannot be read.
function digestOf(c, ss) {
  try {
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

function resultLine(c, ss) {
  const { el } = c.host;
  if (ss.status === "sent") {
    const word = ss.outcome === "failed" ? "Failed on chain" : "Landed";
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
    resultLine(c, ss),
  ];
}

function sessionCard(c, ss, act, actions) {
  const { el } = c.host,
    kind = decodeIntent(ss.intent)?.kind ?? "unknown";
  const attrs = { class: "list-row", "data-session": ss.id, "data-kind": kind };
  return el(
    "div",
    { ...attrs, "data-state": ss.status },
    el("strong", {}, TITLES[kind] ?? "Unknown proposal"),
    el("span", { class: "badge plain" }, STATES[ss.status] ?? ss.status),
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

/** The cards of a ready wallet: fund, propose, and the sessions. */
export function payCards(c, act, actions) {
  return [fundCard(c, act, actions), intentCard(c, act, actions), sessionList(c, act, actions)];
}
