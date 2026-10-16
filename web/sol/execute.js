// The execute of an approved payment (ZOLANA.md 7.2). Once the approval signature of the group
// exists, a seat of this browser with a ready fee key proves the payment again (the Worker rebuilds
// the same proof inputs and checks the commitment), the wasm compiles the execute message (the
// Ed25519 instruction with the approval, then the program) and checks that the approval verifies
// over the digest of the new proof, and only then does the fee key of that seat sign it. The seat
// pays the fee of the execute; the rent of the proposal account goes back to the proposing seat.
// The proposing seat executes when this browser holds it; any other ready seat may.
//
// An execute that this tab sent and that may still land is checked before any other send: a
// blockhash lives about 60 to 90 s, so a second execute waits until the first one landed, failed
// or ran out of time. Only a confirmed execute is a sent mark; a failed one is a counted try.
// A proposal account that is gone (or holds no body any more) was executed by another device: the
// page writes the sent mark with the transaction that holds the approval of this payment.
import { agreement } from "./ceremony.js";
import { base58 } from "./docs.js";
import { feeProblem, poorFeeText, readyFee } from "./fee.js";
import { writerSeats } from "./gate.js";
import {
  bytesOf,
  decodeIntent,
  hexOf,
  intentHex,
  pinsHex,
  snapshotHex,
  wireBase64,
} from "./intent.js";
import { rolesOf, signAsFee } from "./approve.js";
import { ensureWorker } from "./session.js";
import { SESSIONS, writePart } from "./sessions.js";

/** Tries of the execute in this tab before the card asks for a click (actions.execute). */
export const EXECUTE_TRIES = 3;
const STALE_ROOT = /\b7008\b/;
const HOLDER = crypto.randomUUID();
// A blockhash lives 150 slots; a sent execute is past it well before this.
const SEND_WINDOW_MS = 150_000;
const CONFIRMED = new Set(["confirmed", "finalized"]);
const FAILED = "The execute failed on chain. Zigs proves it again.";
// A sent execute that may still land: no new send, and no counted try.
const PENDING = "The execute is not confirmed yet.";
// The history entries that the page reads to find the execute of a gone account.
const LOOK = 6;
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

/** The seat that executes: the proposing seat when this browser holds it ready, else the first. */
export function executorOf(c, ss) {
  const ready = writerSeats(c).filter((i) => feeProblem(c, i) === null);
  return ready.includes(ss.by) ? ss.by : ready[0];
}

/** The message of the execute with a fresh proof, signed by the fee key of `seat`, as a tx. */
async function signedExecute(c, worker, ss, seat) {
  const body = bodyOf(String(ss.body));
  const fee = readyFee(c, seat);
  const { data } = await worker.call("reprove", {
    recipient: decodeIntent(ss.intent).payee,
    payer: base58(fee.key),
    plan: ss.plan,
    inputIds: ss.inputIds,
    transact: ss.transact,
    commitment: body.commitment,
  });
  const { blockhashHex } = await worker.call("blockhash");
  const fields = { expiry: body.expiry, rentRecipient: body.rentRecipient };
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
    return "The new proof went stale before it was sent. Zigs proves it again.";
  }
  return poorFeeText(sim, seat) ?? "The network refused the execute: " + sim.err;
}

/** True when the account holds the proposal of `ss`: kind 1, a bump, then its body. */
const holdsBody = (account, ss) =>
  account.exists &&
  /^01[0-9a-f]{2}/.test(String(account.data)) &&
  account.data.slice(4) === String(ss.body);

const bytesOfBase64 = (text) => Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));

/**
 * The oldest successful transaction on the account that carries the approval signature of this
 * payment: the execute. No other transaction that names the address carries it.
 */
async function closingExecute(worker, ss, found) {
  const tried = found.filter((x) => !x.failed).slice(0, LOOK);
  for (const x of tried.reverse()) {
    const got = await worker.call("transaction", { signature: x.signature });
    const holds = got.found && hexOf(bytesOfBase64(got.tx)).includes(ss.signature);
    if (holds) return x;
  }
  return null;
}

/** The account is gone: the transaction that executed it, read from its history, is the mark. */
async function landedElsewhere(c, worker, ss, seat, failSession) {
  const found = await worker.call("history", { account: base58(ss.account) });
  const closed = await closingExecute(worker, ss, found);
  if (!closed) {
    await failSession(c, ss, "The proposal account is gone, and no execute of it landed.");
    return;
  }
  const mark = { txId: closed.signature, slot: closed.slot, outcome: "confirmed" };
  await writePart(c, ss.id, "sent", mark, { seat });
}

const markSent = (c, ss, seat, txId, seen) =>
  writePart(c, ss.id, "sent", { txId, slot: seen.slot, outcome: seen.status }, { seat });

/** True when the execute that this tab sent before landed and is marked now. */
async function landedBefore(c, worker, ss, seat) {
  const sent = c.sending[ss.id];
  if (!sent) return false;
  const seen = await worker.call("status", { signature: sent.txId });
  if (CONFIRMED.has(seen.status)) {
    delete c.sending[ss.id];
    await markSent(c, ss, seat, sent.txId, seen);
    return true;
  }
  if (seen.status !== "failed" && Date.now() - sent.at < SEND_WINDOW_MS) throw new Error(PENDING);
  delete c.sending[ss.id];
  return false;
}

/** What the confirm of a sent execute decides: the mark, a counted failure or a later check. */
function afterConfirm(c, ss, seat, txId, seen) {
  if (!CONFIRMED.has(seen.status) && seen.status !== "failed") throw new Error(PENDING);
  delete c.sending[ss.id];
  if (seen.status === "failed") throw new Error(FAILED);
  return markSent(c, ss, seat, txId, seen);
}

async function attempt(c, ss, seat, failSession) {
  const worker = await ensureWorker(c);
  const ref = c.host.sdb.doc(c.base + "/" + SESSIONS + "/" + ss.id);
  if (!(await ref.acquire({ holder: HOLDER, ttlMs: 120_000 })).acquired) return sleep(3000);
  if (await landedBefore(c, worker, ss, seat)) return undefined;
  const account = await worker.call("account", { account: base58(ss.account) });
  if (!holdsBody(account, ss)) return landedElsewhere(c, worker, ss, seat, failSession);
  const { tx, txId } = await signedExecute(c, worker, ss, seat);
  const sim = await worker.call("simulate", { tx });
  if (sim.err !== null) throw new Error(refusalOf(sim, seat));
  await worker.call("send", { tx });
  c.sending[ss.id] = { txId, at: Date.now() };
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
 * The reactor step of a signed payment. A failed try is counted (an execute that may still land is
 * not); after EXECUTE_TRIES the card shows the last error and a button that tries again. The
 * approval stays valid until the expiry.
 */
export function maybeExecute(c, ss, { launch, failSession }) {
  const seat = executorOf(c, ss);
  if (!c.rpcUrl || seat === undefined || (c.tries[ss.id] ?? 0) >= EXECUTE_TRIES) return;
  launch(c, "exec:" + ss.id, async () => {
    try {
      await attempt(c, ss, seat, failSession);
      delete c.execErrors[ss.id];
    } catch (e) {
      if (errorText(e) !== PENDING) c.tries[ss.id] = (c.tries[ss.id] ?? 0) + 1;
      c.execErrors[ss.id] = errorText(e);
      throw e;
    }
  });
}
