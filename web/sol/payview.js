// The payment part of the Solana section: the fund card (the fee address of each seat of this
// browser), Add SOL, the forms of a payment, the one-time move of the beta funds to the program
// address, and the signing sessions with their approval screens. An approval screen shows what
// the checker of this device accepted (approve.js reviewOf): the values come from the intent bytes
// and the proof, never from the display fields of the proposer. Each screen of a payment says who
// pays, what it costs and what it makes public (ZOLANA.md 7.2). `data-session` marks a session and
// `data-sol` marks a control, for the headless checks.
import { approvalClosed, reviewOf, reviewWaits, showable } from "./approve.js";
import { agreement } from "./ceremony.js";
import { CLUSTER, base58 } from "./docs.js";
import { EXECUTE_TRIES, endsAt } from "./execute.js";
import { feeMismatch, feeOf, mismatchText } from "./fee.js";
import { readySeat } from "./gate.js";
import {
  BASE_FEE,
  EXECUTE_FEE,
  NONCE_RENT,
  PAYMENT_KINDS,
  bytesOf,
  decodeIntent,
  readVerdict,
} from "./intent.js";
import { provesLocally, switchCard } from "./localprove.js";
import { usedDigest } from "./nonces.js";
import { heldOf, reclaimRent, scanRent } from "./rent.js";
import { privacyBadge, privacyNotice } from "../privacy-language.js";
import { holdsShare, solOf } from "./secrets.js";
import { solText } from "./session.js";
import { beforeFee, heldLamports, heldNotes, isPayment, spentLamports } from "./sessions.js";

export const SHOWN = 12;
const FAUCET = "https://faucet.solana.com/";
// The faucet is not Zigs: it sees the fee address that the person pastes (PRIVACY.md).
const FAUCET_TEXT =
  "Get Devnet SOL opens faucet.solana.com in a new tab. That site is not Zigs: it sees the fee " +
  "address that you paste and your IP address.";
const TITLES = {
  createNonce: "Create the nonce account for the move",
  transfer: "Move the beta funds to the program address",
  approve: "Private SOL payment",
  withdraw: "Public SOL withdrawal",
};
/** The title of a proposal, from its intent bytes. */
export const titleOf = (ss) => TITLES[decodeIntent(ss.intent)?.kind] ?? "Unknown proposal";
const WHAT = {
  createNonce:
    "Creates the account that the move of the beta funds needs. The proposing device pays its " +
    "rent, and the group key owns the account.",
  transfer:
    "Moves private SOL of the group key to the program address of the group, with a nonce. One " +
    "move takes up to 8 notes; the card shows again while the old address holds more.",
  approve:
    "Pays SOL from the shielded balance of the group to the payee. The chain hides the amount, " +
    "but it shows the owner key of the payee. The change stays with the group.",
  withdraw:
    "Pays SOL from the shielded balance of the group to a public Solana address. The chain " +
    "shows the recipient and the amount. The change stays with the group.",
};
const LIFETIME = {
  createNonce: "About 1 to 2 minutes (a recent blockhash). Approve and sign now.",
  other: "Until the nonce account advances. It has no other expiry.",
};
export const STATES = {
  collecting: "Collecting approvals",
  signing: "Signing",
  signed: "Signed, sending",
  sent: "Sent",
  failed: "Failed",
};
export const PAYMENT_STATES = { ...STATES, signed: "Approved, executing", sent: "Executed" };
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
  "address of the group. So anyone can link this device to the group. Its funding transfer links " +
  "the sender of that SOL too.";

/** What the hosted prover of Helius sees of a payment, a withdrawal or the move (ZOLANA.md 7.2). */
export const PROVER_TEXT =
  "Helius makes the proof on its hosted prover. So it sees the owner keys, the payee, the amount " +
  "and the notes that the payment spends. It also sees the secret that links each spend to its " +
  "notes. Local proving keeps the amount and that secret on your devices: see Local proving below.";
export const PROVER_LOCAL =
  "This group makes its proofs on its devices, so they give Helius neither the amount, the " +
  "blindings nor the secret that links each spend to its notes. Each proof that Helius made " +
  "before the switch gave it that secret. Its indexer still sees which notes a payment spends " +
  "and your IP address. The owner key of the payee is public on chain.";
// The rows of one payment: the group proves on its devices now, but this payment may have been
// proposed before the switch or from an older page, and then Helius made its first proof.
const HOSTED_SAW =
  "Then it saw the payee, the amount, the blindings and the secret that links each spend to " +
  "its notes. ";
export const PROVER_ROW_LOCAL =
  "The proof of the execute runs on a device of this group. Helius made the first proof only " +
  "if the payment was proposed before the switch or from an older page. " +
  HOSTED_SAW +
  "Its indexer sees which notes the payment spends.";
// The move of the beta funds has one proof, made when it is proposed.
export const PROVER_MOVE_LOCAL =
  "A device of this group makes the proof of the move. Helius made it only if the move was " +
  "proposed before the switch or from an older page. " +
  HOSTED_SAW +
  "Its indexer sees which notes the move spends.";
/** What the prover of a payment of this group sees: hosted, or local with the switch (SOL-4). */
const proverSays = (local) => (local ? PROVER_LOCAL : PROVER_TEXT);
const proverRow = (local) => (local ? PROVER_ROW_LOCAL : PROVER_TEXT);

const FEE_TEXT =
  "It pays the fees and the rents of the proposals that this device makes, and the fee of each " +
  "payment that this device executes. Send Devnet SOL to it. Devices that propose or execute " +
  "need about 0.003 SOL. Devices that only approve need none. " +
  LINK_TEXT +
  " The page asks Helius for the balance of this address with your IP address, with no click. " +
  "It asks when the Solana section opens, after a payment or Add SOL, and again when such a read " +
  "failed. It also asks every 30 s while a signed payment waits for a device that can pay.";

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
    el("strong", {}, "Your fee address (device " + seat + ")"),
    privacyBadge(el, "public", "Public fee funds · Solana Devnet"),
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
    el("p", { class: "small", "data-sol": "faucet-text" }, FAUCET_TEXT),
  );
}

const ADD_TEXT =
  "Moves SOL from the fee address of your device into the shielded balance of the group, at its " +
  "program address. The amount and the sender are public. It needs no approval: it is your own " +
  "SOL. Helius sees your IP address with this deposit.";

/** A line that names the seat of this browser that pays: the first ready one. Null when none. */
function seatLine(c, mark, what) {
  const seat = readySeat(c);
  if (seat === undefined) return null;
  const text = `Device ${seat} of this browser ${what}`;
  return c.host.el("p", { class: "small", "data-sol": mark }, text);
}

// The explorer of the cluster: a transaction (`tx`) or an account (`address`), in a new tab.
const EXPLORER = "https://explorer.solana.com/";
function explorerLink(c, kind, id) {
  const href = EXPLORER + kind + "/" + encodeURIComponent(id) + "?cluster=" + CLUSTER;
  return c.host.el("a", { href, target: "_blank", rel: "noopener" }, id + " ↗");
}

// The explorer is not Zigs: a click shows it the id and the IP address (PRIVACY.md).
const EXPLORER_TEXT =
  "A link with ↗ opens explorer.solana.com in a new tab. That site is not Zigs: it sees the id " +
  "that you open and your IP address.";
const explorerNote = (c) =>
  c.host.el("p", { class: "small", "data-sol": "explorer-text" }, EXPLORER_TEXT);

/** What the last Add SOL did, as a line of text, and what its link shows to the explorer. */
function addedLine(c) {
  const a = c.added;
  if (!a) return null;
  const words = { unknown: "Sent, not confirmed yet", failed: "Failed on chain" };
  const word = words[a.status] ?? "Added " + solText(a.amount);
  const said = `${word}, device ${a.seat}: `;
  const link = explorerLink(c, "tx", a.txId);
  return [c.host.el("p", { class: "small", "data-sol": "added" }, said, link), explorerNote(c)];
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
    { class: "sol-send-fields" },
    el("h3", {}, "Add SOL"),
    privacyNotice(el, "public", "Public deposit · Solana Devnet",
      (
        "The chain shows the sender and deposit amount, linking "
        + "this device’s fee address to the group."
      )),
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
  "The proposing device pays " +
  solText(BASE_FEE) +
  " to create the proposal account and holds " +
  solText(rentOf(c)) +
  " in it as rent until it closes. The device that executes pays " +
  solText(EXECUTE_FEE) +
  " and the tree fee. The rent goes back to the proposing device at the execute. The rent of a " +
  "proposal that expires comes back with the card \"Rent of old proposals\".";

const button = (c, act, mark, text, run) =>
  c.host.el(
    "button",
    { class: "btn", type: "button", "data-sol": mark, onclick: act(run) },
    text,
  );

// S4: an open payment holds its notes until it executes or ends, so a new payment cannot spend
// them. The line says what a new payment can spend, or which proposal holds all of it.
function availableLine(c) {
  const { notes, lamports } = c.sync ?? {};
  if (!notes || lamports === undefined) return null;
  const held = heldLamports(c.sessions, notes);
  if (held === 0n) return null;
  const free = BigInt(lamports) - held - spentLamports(c.sessions, notes);
  const text =
    free > 0n
      ? `Available for a new payment: ${solText(free)}. Open proposals hold ${solText(held)} ` +
        "until they execute or end."
      : holderText(heldNotes(c.sessions, notes));
  return c.host.el("p", { class: "small", "data-sol": "available" }, text);
}

/** Who holds all the notes: the open proposal that ends first, and when the page ends it. */
function holderText(holders) {
  const [first] = holders;
  const end = utc(endsAt(first.expiry)) + " UTC";
  const name = `of device ${first.by} (${first.id})`;
  const who =
    holders.length === 1
      ? `an open proposal ${name}. It ends at ${end}.`
      : `${holders.length} open proposals. The one that ends first, ${name}, ends at ${end}.`;
  return `All your notes are held by ${who} Add SOL or wait.`;
}

function intentCard(c, act, actions) {
  const { el } = c.host;
  return el(
    "div",
    { style: "display:grid;gap:8px" },
    el("h3", {}, "Send SOL"),
    availableLine(c),
    seatLine(c, "propose-seat", "proposes and pays the fees."),
    el(
      "p",
      { class: "small", "data-sol": "pay-prover" },
      proverSays(provesLocally(c)),
    ),
    el(
      "details",
      { class: "small" },
      el("summary", {}, "Fees and rent"),
      el("p", { class: "small", "data-sol": "pay-cost" }, costLine(c)),
    ),
    sendForm(c, act, actions),
    withdrawForm(c, act, actions),
  );
}

const input = (c, mark, id, value, attrs = {}) =>
  c.host.el("input", {
    class: "input mono",
    id,
    "data-sol": mark,
    autocomplete: "off",
    value,
    ...attrs,
  });

// The screen text of a withdrawal in ZOLANA.md section 2.
const WITHDRAW_PUBLIC = "Recipient, asset and amount are public.";

/**
 * The form of a withdrawal: a public Solana address and an amount. The recipient and the amount
 * become public at the execute (ZOLANA.md 2).
 */
function withdrawForm(c, act, actions) {
  const { el } = c.host;
  const to = input(c, "withdraw-to", "sol-withdraw-to", "", {
    spellcheck: "false", "aria-describedby": "sol-withdraw-privacy",
  });
  const amount = input(c, "withdraw-amount", "sol-withdraw-amount", "0.005", {
    inputmode: "decimal",
  });
  const run = () => actions.propose("withdraw", { recipient: to.value, amount: amount.value });
  return el(
    "div",
    { class: "sol-send-fields" },
    el("h4", {}, "Public withdrawal"),
    privacyNotice(el, "public", "Public withdrawal · Solana Devnet", WITHDRAW_PUBLIC,
      { "data-sol": "withdraw-public", id: "sol-withdraw-privacy" }),
    el("label", { class: "field" }, el("span", {}, "Recipient (Solana address)"), to),
    c.host.recipientSelect?.({ asset: "SOL", network: CLUSTER, type: "public",
      id: "sol-withdraw-saved", onSelect: (address) => {
        to.value = address;
        to.dispatchEvent(new Event("input", { bubbles: true }));
        to.focus();
      } }),
    el(
      "div",
      { class: "row-actions" },
      el("label", { class: "field" }, el("span", {}, "Amount (SOL)"), amount),
      button(c, act, "withdraw", "Withdraw", run),
    ),
  );
}

const SEND_PUBLIC =
  "Send privately: the chain hides the amount, but it shows the owner key of the payee. It also " +
  "shows the proposal account and the fee addresses that pay.";

/** The form of a private payment: the full shielded address of the payee and an amount. */
function sendForm(c, act, actions) {
  const { el } = c.host;
  const to = input(c, "send-to", "sol-send-to", "", {
    spellcheck: "false", "aria-describedby": "sol-send-privacy",
  });
  const amount = input(c, "send-amount", "sol-send-amount", "0.005", { inputmode: "decimal" });
  const send = () => actions.propose("pay", { recipient: to.value, amount: amount.value });
  return el(
    "div",
    { class: "sol-send-fields" },
    el("h4", {}, "Private payment"),
    privacyNotice(el, "partial", "Amount hidden · payee public", SEND_PUBLIC,
      { "data-sol": "send-public", id: "sol-send-privacy" }),
    el("label", { class: "field" }, el("span", {}, "Payee (full shielded address)"), to),
    c.host.recipientSelect?.({ asset: "SOL", network: CLUSTER, type: "shielded",
      id: "sol-send-saved", onSelect: (address) => {
        to.value = address;
        to.dispatchEvent(new Event("input", { bubbles: true }));
        to.focus();
      } }),
    el(
      "div",
      { class: "row-actions" },
      el("label", { class: "field" }, el("span", {}, "Amount (SOL)"), amount),
      button(c, act, "send", "Send privately", send),
    ),
  );
}

const MOVE_PUBLIC =
  "The move links the old address of the group key and the program address in public.";

const MOVE_TEXT =
  "This wallet holds private SOL at the old address of the group key. Move it to the program " +
  "address of the group. A move uses the nonce account: the devices approve and sign it as " +
  "before. One move takes up to 8 notes, so many small notes need more than one move. The card " +
  "shows again if a payer sends SOL to the old address.";

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
    el(
      "p",
      { class: "small", "data-sol": "move-public" },
      MOVE_PUBLIC + " " + proverSays(provesLocally(c)),
    ),
    el("p", { class: "small", "data-sol": "move-held" }, "Old address: " + solText(held)),
    el("p", { class: "small", "data-sol": "nonce-state" }, "Nonce account: " + nonce),
    el("div", { class: "row-actions" }, steps),
  );
}

const sum = (list) => list.reduce((total, one) => total + one.amount, 0n);
const utc = (secs) => new Date(Number(secs) * 1000).toISOString().slice(0, 16).replace("T", " ");

/** The rows of a withdrawal: the recipient and the leg that the commitment binds (the checker). */
function recipientRows(said) {
  return [
    ["Recipient (public)", base58(said.recipient)],
    ["Amount (public)", solText(said.withdrawn)],
    ["Change", solText(sum(said.change)) + " stays with the group."],
  ];
}

// The Payee is the first part of the shielded address only: a typo in the rest still matches.
const COMPARE =
  "Compare the Payee with the program address in the Solana section of the payee group. " +
  "This checks only the first part of the shielded address.";

/** The payee rows of a private spend, from the fingerprint that the checker answered. */
function payeeRows(said) {
  return [
    ["Payee", base58(said.payee.tag)],
    ["Check the payee", COMPARE],
    ["Payee keys", short(said.payee.ownerHash) + " " + short(said.payee.viewingPk)],
    ["Amount", solText(sum(said.paid))],
    ["Change", solText(sum(said.change)) + " stays with the group."],
  ];
}

/**
 * The rows of the move of the beta funds, from the fingerprint, the amounts and the expiry that
 * the checker answered: the payee is the key that the payee output commits to.
 */
export function transferRows(groupKey, review, fee, local = false) {
  const said = readVerdict(review.verdict);
  return [
    ["What it does", WHAT.transfer],
    ["Group address", base58(groupKey)],
    ...payeeRows(said),
    ["Network fee", solText(fee + said.treeFee)],
    ["Lasts", "Until " + utc(said.expiry) + " UTC, or until the nonce account advances."],
    ["Public", MOVE_PUBLIC + " " + LINK_TEXT],
    ["Helius", local ? PROVER_MOVE_LOCAL : PROVER_TEXT],
  ];
}

/** The network fees of a payment: the create of its account, then the execute. */
const feesText = (said) =>
  solText(BASE_FEE) +
  " at the proposal, " +
  solText(EXECUTE_FEE + said.treeFee) +
  " at the execute.";

const PUBLIC_WITHDRAWAL = WITHDRAW_PUBLIC + " The execute transaction shows them. ";
const PAYEE_PUBLIC = "The owner key of the payee becomes public. ";

/**
 * The rows of a payment or a withdrawal of the program design: what the checker of this device
 * answered, who pays, the rent of the proposal account and what becomes public.
 */
function paymentRows(c, review) {
  const { said, intent } = review;
  const pda = agreement(c).done.pda;
  const withdraw = intent.kind === "withdraw";
  const lead = withdraw ? PUBLIC_WITHDRAWAL : PAYEE_PUBLIC;
  return [
    ["What it does", WHAT[intent.kind]],
    ["Program address of the group", pda ? base58(pda) : "?"],
    ...(withdraw ? recipientRows(said) : payeeRows(said)),
    ["Network fees", feesText(said)],
    ["Proposal rent", solText(rentOf(c)) + ", back to device " + review.by + " at the execute, " +
      "or after the expiry with the card \"Rent of old proposals\"."],
    ["Proposal account", explorerLink(c, "address", base58(said.proposal))],
    ["Lasts", "Until " + utc(said.expiry) + " UTC. A new proof is made at the execute."],
    ["Public", lead + "The proposal account (the group key, the " +
      "expiry, the fee address of device " + review.by + ") is public, and the create " +
      "transaction keeps it in the chain history. " + LINK_TEXT],
    ["Helius", proverRow(provesLocally(c))],
  ];
}

const NONCE_PUBLIC =
  "The nonce account, its rent and the group key that owns it are public. " + LINK_TEXT;

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
    ["Public", NONCE_PUBLIC],
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
  const payment = PAYMENT_KINDS.has(intent.kind);
  if (payment) rows = paymentRows(c, review);
  else {
    const fee = BASE_FEE * BigInt(info.signatures) + info.priorityFee;
    rows =
      intent.kind === "transfer"
        ? transferRows(groupKey, review, fee, provesLocally(c))
        : plainRows(intent, groupKey, fee);
  }
  // A payment: the proposing seat paid the create; the seat that executes pays the execute.
  const label = payment ? "Create paid by device " : "Fees paid by device ";
  rows.splice(1, 0, [label + review.by, base58(review.payer)]);
  return rows;
}

// The wallet read, the account read, and the load and the check of the documents (S17).
const WAIT_TEXT =
  "Zigs loads and checks the data of this proposal. The Approve button appears when it is done.";

// A wallet read that failed twice says why on the card: such a wait may not end by itself (P6).
function waitLine(c, ss) {
  const fail = c.readFails?.["snap:" + ss.id];
  if (!fail || fail.n < 2) {
    return c.host.el("p", { class: "small", role: "status", "data-sol": "wait" }, WAIT_TEXT);
  }
  const text = `Zigs could not read your wallet: ${fail.text} It tries again by itself.`;
  return c.host.el("p", { class: "small bad", role: "status", "data-sol": "read-failed" }, text);
}

function reviewBlock(c, ss, review) {
  const { el } = c.host;
  if (review.waiting) return waitLine(c, ss);
  if (!review.ok) {
    return el("div", { class: "callout bad", role: "alert", "data-sol": "refusal" }, review.why);
  }
  const rows = rowsOf(c, review);
  if (PAYMENT_KINDS.has(review.intent.kind)) return paymentReview(c, ss, review, rows);
  return reviewList(c, rows, { "data-sol": "review-" + ss.id });
}

// Keep every checked value; separate account plumbing from the payment decision.
function reviewList(c, rows, attrs = {}) {
  const { el } = c.host;
  return el("dl", { class: "kv review-values", ...attrs }, rows.flatMap(([label, value]) => [
    el("dt", {}, label),
    el("dd", { "data-sol": "review" }, value),
  ]));
}

function paymentReview(c, ss, review, rows) {
  const { el } = c.host;
  const technical = ([label]) => label === "Program address of the group"
    || label === "Proposal account" || label.startsWith("Create paid by device ");
  return [reviewHero(c, ss, review),
    el("div", { class: "review-details", "data-sol": "review-" + ss.id },
      reviewList(c, rows.filter((row) => !technical(row))),
      el("details", { class: "review-technical" },
        el("summary", {}, "Technical account details"),
        reviewList(c, rows.filter(technical))))];
}

// The amount of a payment as the checker of this device answered it, above its rows.
function reviewHero(c, ss, review) {
  const { el } = c.host,
    { said } = review,
    withdraw = review.intent.kind === "withdraw";
  const amount = withdraw ? said.withdrawn : sum(said.paid);
  const shown = solText(amount);
  return el(
    "div",
    { class: "sol-hero review-amount", "data-sol": "amount-" + ss.id },
    el("span", { class: "label" }, withdraw ? "Public withdrawal" : "Private payment"),
    el("strong", { class: "sol-amount money", role: "img", "aria-label": shown },
      shown.slice(0, -4), el("span", { class: "cur", "aria-hidden": "true" }, "SOL")),
    privacyNotice(el, withdraw ? "public" : "partial",
      withdraw ? "Public · Solana Devnet" : "Amount hidden · payee public",
      withdraw ? WITHDRAW_PUBLIC : SEND_PUBLIC),
    el("span", { class: "small muted" }, "Solana Devnet: test SOL only. The fees are below."),
  );
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
export function seatsOf(c, ss) {
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
  approved: (seat) => "Device " + seat + " approved",
  used: (seat) => "Device " + seat + " signed these bytes before",
  nokey: (seat) => "This browser cannot sign for device " + seat + ".",
};

// A seat that approved, that signed these exact bytes, or that has no signing key here gets no
// button. The other seats get a button when approveSeats names them.
function approveRow(c, ss, act, actions, seats) {
  const { el } = c.host;
  return seatsOf(c, ss).map(({ seat, state }) => {
    if (state !== "open") return el("span", { class: "small" }, SEAT_TEXT[state](seat));
    if (!c.host.canWriteAs(seat)) return el("span", { class: "small" }, SEAT_TEXT.nokey(seat));
    if (!seats.includes(seat)) return null;
    const attrs = {
      class: "btn primary",
      type: "button",
      "data-sol": "approve-" + ss.id + "-" + seat,
      onclick: act(() => actions.approve(ss, seat)),
    };
    return el("button", attrs, "Approve as device " + seat);
  });
}

/** Why no seat of this browser executes the payment (execute.js unfunded), or null. */
function execWaitLine(c, ss) {
  const text = c.execWait?.[ss.id];
  if (!text) return null;
  return c.host.el("p", { class: "small", "data-sol": "exec-wait-" + ss.id }, text);
}

/**
 * The last error of the execute in this tab, and a button once its tries ran out. With no error,
 * the line that says why no seat of this browser executes, if any.
 */
function executeLine(c, ss, act, actions) {
  const { el } = c.host;
  const error = c.execErrors?.[ss.id];
  if (ss.status !== "signed") return null;
  if (!error) return execWaitLine(c, ss);
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
      `${word} in slot ${ss.slot}: `,
      explorerLink(c, "tx", ss.txId),
    );
  }
  if (ss.status === "failed") return el("p", { class: "small bad" }, String(ss.error));
  return null;
}

// After the expiry no seat can approve: the card says so until the page ends the proposal, a few
// minutes later (the end waits for the clock margin of execute.js).
const EXPIRED_TEXT = "This proposal expired, so no device can approve it. The page closes it soon.";
const approvable = (ss) => ss.status === "collecting" && !approvalClosed(ss);

/**
 * The seats of this browser that show an Approve button for `ss` now: a seat with a share and a
 * signing key that gave no approval yet. A proposal that expired, that the app cannot show, that
 * is from before the fee keys, or whose review still waits for a read, shows none. The buttons,
 * the S6 count and the Approvals inbox all use it, so they agree.
 */
export function approveSeats(c, ss, block) {
  const open = openSeats(c, ss);
  if (!open.length || reviewWaits(c, ss, open[0], block)) return [];
  return open;
}
/** True when a seat of this browser can approve `ss` as soon as its review stops waiting. */
export function approveLater(c, ss, block) {
  const open = openSeats(c, ss);
  return open.length > 0 && reviewWaits(c, ss, open[0], block);
}
// The seats that may approve `ss` before its review: a proposal that is collecting, that the app
// can show and that is not from before the fee keys; a seat with a share and a signing key here.
function openSeats(c, ss) {
  if (!approvable(ss) || !showable(ss) || beforeFee(ss)) return [];
  return seatsOf(c, ss).filter((s) => s.state === "open" && c.host.canWriteAs(s.seat))
    .map((s) => s.seat);
}

function expiredLine(c, ss) {
  if (ss.status !== "collecting" || !approvalClosed(ss)) return null;
  return c.host.el("p", { class: "small", "data-sol": "expired" }, EXPIRED_TEXT);
}

// The steps of a proposal, from what this page tracks: the parts of the session (a package comes
// after t approvals), its status and the outcome of the sent transaction (resultLine gives its
// slot). A session that stopped (failed, failed on chain, or expired before its approvals) shows
// "!" on the first step that is not done. No finality is tracked.
function approvalsStep(ss, count, t) {
  if (count >= t || ss.package) return "done";
  return ss.status === "collecting" ? "now" : "";
}
function signedStep(ss) {
  if (ss.signature) return "done";
  return ss.status === "signing" ? "now" : "";
}
function lastStep(ss) {
  if (ss.status === "sent" && ss.outcome !== "failed") return "done";
  return ss.status === "signed" ? "now" : "";
}
const stopped = (ss) =>
  ss.status === "failed" ||
  (ss.status === "sent" && ss.outcome === "failed") ||
  (ss.status === "collecting" && approvalClosed(ss));

/**
 * The states of the steps after "Proposed": the approvals, the signature, the execute. `out`:
 * the automatic execute stopped after its tries, so the execute waits for a person.
 */
export function stepStates(ss, count, t, out = false) {
  const states = [approvalsStep(ss, count, t), signedStep(ss), lastStep(ss)];
  const at = out || stopped(ss) ? states.findIndex((s) => s !== "done") : -1;
  return states.map((s, i) => (i === at ? "bad" : s));
}

/** Loading a historical approval is not a new approval arrival. Display labels are unchanged. */
export function approvalMotionValue(c, ss, approved) {
  const snapshots = c.raw?.solcommits || {};
  if (c.wait > 0 || c.sessWait > 0 || !Object.hasOwn(snapshots, ss.id)) return "unknown";
  return approved ? "on" : "off";
}

function approvalNodes(c, ss) {
  const { el } = c.host;
  return el("div", { class: "approval-nodes" }, c.host.seatIds().map((seat) => {
    const approved = !!c.commits[ss.id]?.[seat];
    return el("span", { class: "approver" + (approved ? " yes" : ""),
      "data-motion-watch": "approval:sol:" + ss.id + ":" + seat,
      "data-motion-value": approvalMotionValue(c, ss, approved) },
    el("span", { class: "av round", "data-motion-mark": "", "aria-hidden": "true" }, seat),
    el("span", { class: "small" }, "Device " + seat
      + (approved ? " · Approved" : " · Approval not shown")));
  }));
}

function solStep(c, cls, title, body = null, attrs = {}) {
  const { el } = c.host;
  return el("div", { class: "step " + cls, ...attrs },
    el("span", { class: "tick", "aria-hidden": "true", "data-motion-mark": "" },
      { done: "✓", bad: "!" }[cls] ?? "•"),
    el("div", { class: "step-text" }, el("strong", {}, title),
      typeof body === "string" ? el("span", { class: "small" }, body) : body));
}

const thresholdMotion = (c, ss, ready) => ({
  "data-motion-watch": "threshold:sol:" + ss.id,
  "data-motion-value": approvalMotionValue(c, ss, ready),
});

function stepsOf(c, ss) {
  const { el } = c.host,
    t = c.host.state.g.t;
  // A package is made from t approvals, also when this page holds none of their records.
  const count = ss.package ? t : Math.min(Object.keys(c.commits[ss.id] ?? {}).length, t);
  const out = ss.status === "signed" && (c.tries?.[ss.id] ?? 0) >= EXECUTE_TRIES;
  const [approvals, signed, last] = stepStates(ss, count, t, out);
  return el(
    "div",
    { class: "steps sol-steps", "data-sol": "steps-" + ss.id },
    solStep(c, "done", "Proposed", "By device " + ss.by + "."),
    solStep(c, approvals, `Approvals · ${count} of ${t}`, approvalNodes(c, ss),
      thresholdMotion(c, ss, count >= t)),
    solStep(c, signed, "Signed"),
    solStep(c, last, isPayment(ss) ? "Executed" : "Landed"),
  );
}

function sessionBody(c, ss, act, actions) {
  const { el } = c.host,
    open = seatsOf(c, ss).find((s) => s.state === "open");
  const collecting = approvable(ss);
  const review = collecting && open ? reviewOf(c, ss, open.seat) : null;
  const buttons = collecting ? approveRow(c, ss, act, actions, approveSeats(c, ss)) : null;
  return [
    expiredLine(c, ss),
    executeLine(c, ss, act, actions),
    ...reviewLayout(c, ss, review),
    buttons ? el("div", { class: "row-actions" }, buttons) : null,
    stepsOf(c, ss),
    resultLine(c, ss),
  ];
}

function reviewLayout(c, ss, review) {
  const { el } = c.host;
  const blocked = review && (review.waiting || !review.ok);
  return [blocked ? reviewBlock(c, ss, review) : null,
    el("div", { class: "review-context" },
      el("strong", {}, c.host.state.g?.name || "This wallet"),
      el("span", { class: "badge plain" }, "Solana Devnet")),
    review && !blocked ? reviewBlock(c, ss, review) : null];
}

function sessionBadge(c, ss) {
  const { el } = c.host;
  const states = isPayment(ss) ? PAYMENT_STATES : STATES;
  // Reuse the result line's existing outcome; "sent" can also mean failed on chain.
  const failedOnChain = ss.status === "sent" && ss.outcome === "failed";
  return el("span", { class: "badge receipt-stage " + (failedOnChain || ss.status ===
    "failed" ? "bad" : "plain") },
      failedOnChain ? "Failed on chain" : states[ss.status] ?? ss.status);
}

function sessionCard(c, ss, act, actions) {
  const { el } = c.host,
    kind = decodeIntent(ss.intent)?.kind ?? "unknown";
  const attrs = { class: "list-row sol-review", "data-session": ss.id, "data-kind": kind };
  return el(
    "div",
    { ...attrs, "data-state": ss.status },
    el("strong", {}, TITLES[kind] ?? "Unknown proposal"),
    sessionBadge(c, ss),
    ...sessionBody(c, ss, act, actions),
  );
}

function sessionList(c, act, actions) {
  const { el } = c.host;
  const shown = (c.sessions ?? []).slice(0, SHOWN), older = (c.sessions ?? []).length - SHOWN;
  if (!shown.length) return el("p", { class: "small" }, "No Solana proposals yet.");
  const olderNote = older > 0 ? el("p", { class: "small", "data-sol": "older" }, "Zigs shows the "
    + "newest " + SHOWN + " proposals. " + older + " older " + (older === 1 ? "one is" : "ones are")
    + " not shown.") : null;
  const list = el(
    "div",
    { class: "list" },
    shown.map((ss) => sessionCard(c, ss, act, actions)),
  );
  return el("div", {}, explorerNote(c), list, olderNote);
}

const RENT_TEXT =
  "A proposal that expires still holds the rent of the device that created it. The fee key of " +
  "that device cancels it and gets the rent back. The program accepts this cancel only after " +
  "the expiry. The cancel is public: the chain shows the fee address, the proposal account and " +
  "the rent. \"Look for rent\" asks Helius for the proposals of the group key and of the fee " +
  "addresses of this browser, with your IP address.";

/** The rent of expired proposals that each seat of this browser can get back (SOL-52). */
function rentCard(c, act) {
  const { el } = c.host;
  const seats = Object.keys(c.rent?.found ?? {}).map(Number);
  const rows = seats
    .filter((seat) => heldOf(c, seat) > 0n)
    .map((seat) =>
      el(
        "div",
        { class: "row-actions", "data-sol": "rent-" + seat },
        el("span", { class: "small" }, "Device " + seat + ": " + solText(heldOf(c, seat))),
        button(c, act, "reclaim-" + seat, "Get it back", () => reclaimRent(c, seat)),
      ),
    );
  const none = c.rent && !rows.length ? el("p", { class: "small" }, "No rent to get back.") : null;
  const done = c.rentDone?.txIds.length
    ? [
        el(
          "p",
          { class: "small", "data-sol": "rent-done" },
          "Cancel transactions of device " + c.rentDone.seat + ": ",
          c.rentDone.txIds.flatMap((id, n) => [n ? ", " : "", explorerLink(c, "tx", id)]),
        ),
        explorerNote(c),
      ]
    : null;
  return el(
    "div",
    { style: "display:grid;gap:8px", "data-sol": "rent" },
    el("h3", {}, "Rent of old proposals"),
    el("p", { class: "small" }, RENT_TEXT),
    ...rows,
    none,
    done,
    button(c, act, "rent-scan", "Look for rent", () => scanRent(c)),
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
    rentCard(c, act),
    switchCard(c, act, actions),
  ].filter(Boolean);
}
