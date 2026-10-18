// The execute of an approved payment (ZOLANA.md 7.2). Once the approval signature of the group
// exists, a seat of this browser with a ready fee key proves the payment again (the Worker rebuilds
// the same proof inputs and checks the commitment), the wasm compiles the execute message (the
// Ed25519 instruction with the approval, then the program) and checks that the approval verifies
// over the digest of the new proof, and only then does the fee key of that seat sign it. The seat
// pays the fee of the execute; the rent of the proposal account goes back to the proposing seat.
// The proposing seat executes when this browser holds it; any other ready seat may. A seat
// executes only when its fee address can pay. A browser with no funded seat sends nothing and
// counts no try: it reads the proposal account (a mark to write when another device executed it)
// and waits for a funded seat. Its card says why: a failed read, or no seat that can pay.
//
// An execute that this tab sent and that may still land is checked before any other send: a
// blockhash lives about 60 to 90 s, so a second execute waits until the first one landed, failed
// or ran out of time. Only a confirmed execute is a sent mark; a failed one is a counted try.
// A proposal account that is gone (or holds no body any more) was executed by another device: the
// page writes the sent mark with the transaction that holds the approval of this payment.
import { agreement } from "./ceremony.js";
import { base58 } from "./docs.js";
import { feeOf, feeProblem, poorFeeText, readyFee } from "./fee.js";
import { writerSeats } from "./gate.js";
import {
  bytesOf,
  bytesOfBase64,
  decodeIntent,
  hexOf,
  intentHex,
  pinsHex,
  snapshotHex,
  wireBase64,
} from "./intent.js";
import { rolesOf, signAsFee } from "./approve.js";
import { ensureWorker, solText } from "./session.js";
import { SESSIONS, writePart } from "./sessions.js";

/** Tries of the execute in this tab before the card asks for a click (actions.execute). */
export const EXECUTE_TRIES = 3;
const STALE_ROOT = /\b7008\b/;
const HOLDER = crypto.randomUUID();
// A blockhash lives 150 slots; a sent execute is past it well before this.
const SEND_WINDOW_MS = 150_000;
// The server keeps a lease 60 s at most (cf/src/index.js), so a try takes it again before send.
const LEASE_MS = 60_000;
// The fee address of the executor keeps the rent-exempt minimum of a System account (890,880
// lamports) after the fee of the execute and the tree fee.
const EXECUTE_MIN = 1_000_000n;
// A browser with no funded seat, and the end check of a payment whose tries ran out, look again
// after this time. A balance read holds BALANCE_MS.
const LOOK_AGAIN_MS = 15_000;
const BALANCE_MS = 30_000;
// The lamports of each fee address (base58) and when they were read: { lamports, at }.
const balances = new Map();
// A tab with no funded seat reads the proposal account of a payment at most once a minute: a
// funded device usually executes in seconds, and each read is a Helius call. { at, error }.
const LOOK_MS = 60_000;
const looks = new Map();
/** Forgets the balances and the account reads so far: the next pass reads them again. */
export function forgetBalances() {
  balances.clear();
  looks.clear();
}
const CONFIRMED = new Set(["confirmed", "finalized"]);
const FAILED = "The execute failed on chain. The approval is still valid.";
const UNREAD = "The history of the proposal account is not complete yet.";
export const PAYMENT_EXPIRED = "This payment expired before it was executed. Propose it again.";
const GONE = "The proposal account is gone, and no execute of it landed.";
const NO_FUNDED_SEAT =
  "No seat of this browser can pay the execute. A fee address needs " +
  solText(EXECUTE_MIN) +
  ": the fees of the execute, and the minimum balance that the address must keep. A browser " +
  "with a funded seat can execute this payment. To execute it in this browser, send Devnet SOL " +
  'to a fee address in "Fund the fee address".';
// A margin for the clock of this device: the program judges the expiry by the chain clock.
const CLOCK_MARGIN_S = 600;

/** True when the expiry of the body of `ss` passed, with the clock margin. */
export const pastExpiry = (ss) =>
  !(Math.floor(Date.now() / 1000) < Number(ss.expiry) + CLOCK_MARGIN_S);
/** When the page ends a payment that did not execute (Unix seconds): its expiry and the margin. */
export const endsAt = (expiry) => BigInt(expiry) + BigInt(CLOCK_MARGIN_S);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const errorText = (e) => String(e?.message ?? e).slice(0, 300);

const le64Of = (hex) => BigInt("0x" + (hex.match(/../g) ?? []).reverse().join(""));

/** The fields of a proposal body (hex, wasm-sol/src/program.rs): what the execute repeats. */
export function bodyOf(hex) {
  return {
    commitment: hex.slice(0, 64),
    group: hex.slice(64, 128),
    expiry: le64Of(hex.slice(128, 144)),
    rentRecipient: hex.slice(144, 208),
  };
}

/** The seats of this browser that may execute `ss`, with a ready fee key: the proposer first. */
export function executorsOf(c, ss) {
  const ready = writerSeats(c).filter((i) => feeProblem(c, i) === null);
  return ready.includes(ss.by) ? [ss.by, ...ready.filter((i) => i !== ss.by)] : ready;
}

/** The lamports of a fee address, read at most once in BALANCE_MS. A failed read throws. */
async function feeBalance(worker, account) {
  const held = balances.get(account);
  if (held && Date.now() - held.at < BALANCE_MS) return held.lamports;
  const lamports = BigInt((await worker.call("balance", { account })).lamports);
  balances.set(account, { lamports, at: Date.now() });
  return lamports;
}

/**
 * The first seat of `seats` whose fee address can pay an execute: { seat }. With none, { failed }
 * holds the text of a failed balance read, which is no empty seat.
 */
async function fundedSeat(c, worker, seats) {
  let failed;
  for (const seat of seats) {
    try {
      if ((await feeBalance(worker, base58(feeOf(c, seat).key))) >= EXECUTE_MIN) return { seat };
    } catch (e) {
      failed = errorText(e);
    }
  }
  return { failed };
}

/**
 * The seat that tries the execute now: { seat }, or { failed } as fundedSeat gives it. A tab that
 * sent an execute checks it with the seat that sent it, and a payment past its expiry ends:
 * neither pays a fee, so the funding check does not hold them up.
 */
async function executor(c, worker, ss, seats) {
  const sent = c.sending[ss.id];
  if (sent) return { seat: sent.seat };
  if (pastExpiry(ss)) return { seat: seats[0] };
  return fundedSeat(c, worker, seats);
}

/**
 * The payee of the session intent as the Worker `reprove` takes it: the shielded payee of a
 * payment ("0" withdrawn), or the public recipient and the amount of a withdrawal.
 */
function payeeOf(ss) {
  const intent = decodeIntent(ss.intent);
  if (intent.kind !== "withdraw") return { recipient: intent.payee, withdraw: "0" };
  return { recipient: intent.recipient, withdraw: String(intent.amount), to: intent.recipient };
}

/** The message of the execute with a fresh proof, signed by the fee key of `seat`, as a tx. */
async function signedExecute(c, worker, ss, seat) {
  const body = bodyOf(String(ss.body));
  const fee = readyFee(c, seat);
  const { to, ...payee } = payeeOf(ss);
  const { data } = await worker.call("reprove", {
    ...payee,
    payer: base58(fee.key),
    plan: ss.plan,
    inputIds: ss.inputIds,
    transact: ss.transact,
    commitment: body.commitment,
  });
  const { blockhashHex } = await worker.call("blockhash");
  const fields = { expiry: body.expiry, rentRecipient: body.rentRecipient, recipient: to };
  const intent = bytesOf(
    intentHex("execute", { ...fields, signature: ss.signature, blockhash: blockhashHex }),
  );
  const inputs = {
    pins: bytesOf(pinsHex(agreement(c).done, fee.key)),
    snapshot: bytesOf(snapshotHex(rolesOf(c, seat, "execute"))),
  };
  const message = c.W.compile_message(intent, inputs.pins, bytesOf(data));
  const signature = signAsFee(c, seat, message, intent, inputs);
  return { tx: wireBase64(message, bytesOf(signature)), txId: base58(signature) };
}

/** Why a test run of the execute failed, as a text for the page. */
function refusalOf(sim, seat) {
  if (STALE_ROOT.test(sim.err)) {
    return "The new proof went stale before it was sent. The approval is still valid.";
  }
  return poorFeeText(sim, seat) ?? "The network refused the execute: " + sim.err;
}

/** True when the account holds the proposal of `ss`: kind 1, a bump, then its body. */
const holdsBody = (account, ss) =>
  account.exists &&
  /^01[0-9a-f]{2}/.test(String(account.data)) &&
  account.data.slice(4) === String(ss.body);


// The head of the canonical Ed25519 instruction (wasm-sol program.rs): one signature, offsets
// 48, 16 and 112 in this instruction, a 32-byte message.
const APPROVAL_HEAD = "01003000ffff1000ffff70002000ffff";

/**
 * The execute of a gone account: the oldest successful transaction in its history that carries
 * the Ed25519 instruction of this approval (head, group key, signature, digest), or null.
 * `complete` is true only when the history reaches back to the create and every transaction was
 * read.
 */
async function closingExecute(c, worker, ss, found) {
  const approval = APPROVAL_HEAD + agreement(c).done.groupKey + ss.signature + ss.digest;
  let complete = found.some((x) => x.signature === ss.createTx);
  for (const x of found.filter((y) => !y.failed).reverse()) {
    const got = await worker.call("transaction", { signature: x.signature });
    if (!got.found) complete = false;
    else if (hexOf(bytesOfBase64(got.tx)).includes(approval)) return { closed: x };
  }
  return { closed: null, complete };
}

/**
 * The account is gone: the transaction that executed it, read from its history, is the mark.
 * Before the expiry a node may lag, so the page reads the history again later. After the expiry
 * the session fails on a complete history with no execute.
 */
async function landedElsewhere(c, worker, ss, seat, failSession) {
  const found = await worker.call("history", { account: base58(ss.account) });
  const { closed, complete } = await closingExecute(c, worker, ss, found);
  if (closed) {
    const mark = { txId: closed.signature, slot: closed.slot, outcome: "confirmed" };
    return writePart(c, ss.id, "sent", mark, { seat });
  }
  if (!pastExpiry(ss)) return sleep(30_000);
  if (!complete) throw new Error(UNREAD);
  return failSession(c, ss, GONE);
}

const markSent = (c, ss, seat, txId, seen) =>
  writePart(c, ss.id, "sent", { txId, slot: seen.slot, outcome: seen.status }, { seat });

/** The execute that this tab sent before: "done" (it landed and is marked), "wait" or "go". */
async function sentState(c, worker, ss, seat) {
  const sent = c.sending[ss.id];
  if (!sent) return "go";
  const seen = await worker.call("status", { signature: sent.txId });
  if (CONFIRMED.has(seen.status)) {
    delete c.sending[ss.id];
    await markSent(c, ss, seat, sent.txId, seen);
    return "done";
  }
  if (seen.status !== "failed" && Date.now() - sent.at < SEND_WINDOW_MS) return "wait";
  delete c.sending[ss.id];
  return "go";
}

/** What the confirm of a sent execute decides: the mark, a counted failure or a later check. */
function afterConfirm(c, ss, seat, txId, seen) {
  // Not settled yet: the next pass of the reactor asks for its status (sentState).
  if (!CONFIRMED.has(seen.status) && seen.status !== "failed") return undefined;
  delete c.sending[ss.id];
  if (seen.status === "failed") throw new Error(FAILED);
  return markSent(c, ss, seat, txId, seen);
}

const leased = async (ref) => (await ref.acquire({ holder: HOLDER, ttlMs: LEASE_MS })).acquired;

async function attempt(c, worker, ss, seat, failSession) {
  const ref = c.host.sdb.doc(c.base + "/" + SESSIONS + "/" + ss.id);
  if (!(await leased(ref))) return sleep(3000);
  const state = await sentState(c, worker, ss, seat);
  if (state === "wait") return sleep(3000);
  if (state === "done") return undefined;
  const account = await worker.call("account", { account: base58(ss.account) });
  if (!holdsBody(account, ss)) return landedElsewhere(c, worker, ss, seat, failSession);
  if (pastExpiry(ss)) return failSession(c, ss, PAYMENT_EXPIRED);
  const { tx, txId } = await signedExecute(c, worker, ss, seat);
  const sim = await worker.call("simulate", { tx });
  if (sim.err !== null) throw new Error(refusalOf(sim, seat));
  // The re-proof may outlast the lease: take it again, or leave the send to the tab that holds it.
  if (!(await leased(ref))) return sleep(3000);
  await worker.call("send", { tx });
  c.sending[ss.id] = { txId, at: Date.now(), seat };
  // The confirm (45 s at most) ends before this lease, so no other tab sends meanwhile.
  await leased(ref);
  const seen = await worker.call("confirm", { signature: txId });
  return afterConfirm(c, ss, seat, txId, seen);
}

/**
 * The button after the last try: the tries of this tab start again. `once` ends with a pass of
 * the reactor, which runs the execute; a redraw alone would not.
 */
export function tryAgain(c, ss) {
  delete c.tries[ss.id];
  c.host.once("sol:retry:" + ss.id, async () => {});
}

/**
 * Puts `text` in `c[field]` for the card of `ss` (no text clears it), and draws the card now.
 * `execErrors` holds a red error; `execWait` holds the neutral line of a browser that cannot pay.
 */
function showOnCard(c, field, ss, text) {
  if (c[field][ss.id] === text) return;
  if (text === undefined) delete c[field][ss.id];
  else c[field][ss.id] = text;
  c.host.render();
}

/**
 * A tab with no funded seat: it sends nothing and takes no lease. It reads the proposal account;
 * if another device executed it, `seat` (a local writer) writes the mark. A failed read shows its
 * text and counts no try. When every balance read worked, a neutral line says that none can pay.
 */
async function unfunded(c, worker, ss, { seat, failed }, failSession) {
  const last = looks.get(ss.id);
  if (last && Date.now() - last.at < LOOK_MS) {
    showLook(c, ss, failed ?? last.error);
    return sleep(LOOK_AGAIN_MS);
  }
  const look = { at: Date.now(), error: undefined };
  looks.set(ss.id, look);
  try {
    const account = await worker.call("account", { account: base58(ss.account) });
    if (!holdsBody(account, ss)) {
      showOnCard(c, "execWait", ss, undefined);
      return await landedElsewhere(c, worker, ss, seat, failSession);
    }
  } catch (e) {
    look.error = errorText(e);
  }
  showLook(c, ss, failed ?? look.error);
  return sleep(LOOK_AGAIN_MS);
}

/** A failed read shows its red text; with every read good, the neutral line says none can pay. */
function showLook(c, ss, error) {
  showOnCard(c, "execErrors", ss, error);
  showOnCard(c, "execWait", ss, error === undefined ? NO_FUNDED_SEAT : undefined);
}

/**
 * The reactor step of a signed payment. A failed try is counted (a wait for an execute that may
 * still land is no try); after EXECUTE_TRIES the card shows the last error and a button that
 * tries again. The approval stays valid until the expiry.
 */
export function maybeExecute(c, ss, { launch, failSession }) {
  const seats = executorsOf(c, ss);
  // After the expiry, the end check (attempt) runs also when the tries ran out: it sends nothing.
  const out = (c.tries[ss.id] ?? 0) >= EXECUTE_TRIES;
  if (!c.rpcUrl || !seats.length || (out && !pastExpiry(ss))) return;
  launch(c, "exec:" + ss.id, async () => {
    try {
      const worker = await ensureWorker(c);
      const { seat, failed } = await executor(c, worker, ss, seats);
      if (seat === undefined) {
        return await unfunded(c, worker, ss, { seat: seats[0], failed }, failSession);
      }
      showOnCard(c, "execWait", ss, undefined);
      await attempt(c, worker, ss, seat, failSession);
      delete c.execErrors[ss.id];
    } catch (e) {
      // A failed end check shows its text and reads again later, with no try and no banner.
      if (out) {
        showOnCard(c, "execErrors", ss, errorText(e));
        return sleep(LOOK_AGAIN_MS);
      }
      c.tries[ss.id] = (c.tries[ss.id] ?? 0) + 1;
      c.execErrors[ss.id] = errorText(e);
      throw e;
    }
  });
}
