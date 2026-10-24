// What sol-pay.mjs and its siblings (sol-pay-exec, -seats, -lease, -look and -end) share: the tree
// of plain nodes that reads the screens, the test group with its payment, and the helpers of the
// payment tests. A file imports this one, calls installTestGroup() and runs its sections.
// Importing it runs the ceremony of sol-setup.mjs.
import assert from "node:assert/strict";
import { agreement } from "../sol/ceremony.js";
import { base58 } from "../sol/docs.js";
import { forgetBalances } from "../sol/execute.js";
import { decodeIntent } from "../sol/intent.js";
import { putSol } from "../sol/secrets.js";
import { solView } from "../sol/view.js";
import { G, preparedOf, transactOf, useTestGroup, utxoOf } from "./sol-fixture.mjs";
import {
  W,
  c,
  chain,
  data,
  feeAddress,
  gid,
  notify,
  path,
  proposed,
  ssOf,
  waitFor,
} from "./sol-setup.mjs";

const PAID = G.pay.outputs.find((o) => o.role === "payee");
// The tab, as a tree of plain nodes, to read what the screens show.
export const node = (tag, attrs = {}, ...kids) => ({
  tag,
  attrs,
  kids: kids.flat(Infinity).filter(Boolean),
});
export const textOf = (n) => (typeof n === "object" ? n.kids.map(textOf).join(" ") : String(n));
export const findAll = (n, pick) =>
  typeof n !== "object"
    ? []
    : [...(pick(n) ? [n] : []), ...n.kids.flatMap((kid) => findAll(kid, pick))];
export const marked = (name) =>
  findAll(solView({ ...c, host: { ...c.host, el: node } }, (fn) => fn, {}), (n) =>
    n.attrs["data-sol"] === name,
  );
export const rowsOf = (id) => {
  const [review] = marked("review-" + id);
  const out = {};
  for (const dl of findAll(review, (n) => n.tag === "dl")) {
    for (let i = 0; i < dl.kids.length; i += 2) out[textOf(dl.kids[i])] = textOf(dl.kids[i + 1]);
  }
  return out;
};
export const dropSessions = async (ids) => {
  for (const key of data.keys()) {
    if (ids.some((id) => key.includes("solsessions/" + id))) data.delete(key);
  }
  notify();
  await waitFor("the sessions go", () => !c.sessions.some((x) => ids.includes(x.id)));
};
// The payment that the sections work on, and the fresh proofs that the fake prover made.
export const cur = { id: null, reproofs: 0 };

/** The answer of the Worker to prepare of a payment: it proves what the person typed. */
export function preparedPay(args) {
  assert.equal(args.kind, "pay", "a payment spends the PDA identity");
  assert.equal(args.recipient, G.payee.address, "the Worker proves for the typed payee");
  assert.equal(args.amount, PAID.amount, "the Worker proves the typed amount");
  assert.equal(args.payer, feeAddress(1), "the fee key of the proposing seat is the payer");
  return preparedOf(G.pay, args);
}

/** The test group in the wallet, and the answers of the fake Worker for its payment. */
export async function installTestGroup() {
  await useTestGroup(c, { gid, data, notify, waitFor, path, W, chain });
  for (const i of [1, 2, 3]) chain.balances.set(feeAddress(i), 50_000_000n);
  const done = agreement(c).done;
  assert.equal(done.pda, G.group.pda, "the seats agree on the PDA identity");
  chain.utxos = [utxoOf(G.pay)];
  chain.prepared = preparedPay;
  chain.reproved = (args) => {
    cur.reproofs += 1;
    assert.equal(args.recipient, G.payee.address);
    const expiry = decodeIntent(ssOf(cur.id).intent).expiry;
    const proof = (cur.reproofs % 256).toString(16).padStart(2, "0");
    return { data: transactOf(G.pay, expiry, { proof, root: 200 + cur.reproofs }) };
  };
}

// The fixture has one salt and one input, and a device refuses a pair that another proposal holds
// on the group server or in its own history (rule salt-reused). The fixture has one input for
// every payment too, so an ended payment over it would end the next one (another payment spent
// its inputs). So each payment here starts as a browser with no salt history would, on a server
// where the earlier payments and moves are gone.
export const forgetPairs = async () => {
  for (const i of [1, 2, 3]) await putSol(c.host, gid, i, { salts: null });
  const ended = c.sessions.filter((ss) => ["sent", "failed"].includes(ss.status));
  const spends = c.sessions.filter((ss) => ss.transact !== undefined || ss.plan !== undefined);
  await dropSessions([...new Set([...ended, ...spends].map((x) => x.id))]);
};
// The page and the program judge an expiry by the clock: `later` moves the clock of this test.
export const realNow = Date.now;
export const later = (ms) => (Date.now = () => realNow() + ms);
export const DAY = 24 * 3600 * 1000;
// The Ed25519 instruction of the approval of `ss`, as an execute carries it.
const APPROVAL_HEAD = "01003000ffff1000ffff70002000ffff";
export const approvalOf = (ss) => APPROVAL_HEAD + G.group.key + ss.signature + ss.digest;
// Two payments of the fixture in one second have one expiry, so one body and one digest, and a
// seat signs a digest once. Each payment here starts in a second of its own.
let lastSecond = 0;
const tick = () => new Promise((go) => setTimeout(go, 50));
export const proposedPay = async () => {
  while (Math.floor(Date.now() / 1000) <= lastSecond) await tick();
  const id = await proposed("pay", { recipient: G.payee.address, amount: "0.002" });
  lastSecond = Math.floor(Date.now() / 1000); // the page took the expiry before this
  return id;
};

export const TO = G.withdraw.withdraw.recipient;
export const proposedWithdrawal = async (recipient = base58(TO)) => {
  while (Math.floor(Date.now() / 1000) <= lastSecond) await tick();
  const id = await proposed("withdraw", { recipient, amount: "0.002" });
  lastSecond = Math.floor(Date.now() / 1000);
  return id;
};

export const pause = (ms) => new Promise((go) => setTimeout(go, ms));
export const count = (cmd) => chain.commands.filter((m) => m.cmd === cmd).length;

// The fee addresses of the seats: all at `lamports`, or one amount for each seat.
export const fund = (amounts) => {
  amounts.forEach((lamports, n) => chain.balances.set(feeAddress(n + 1), lamports));
  forgetBalances();
};
export const FUNDED = [50_000_000n, 50_000_000n, 50_000_000n];
