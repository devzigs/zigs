// The execute of an approved payment (ZOLANA.md 7.2). Once the approval signature of the group
// exists, a seat of this browser with a ready fee key proves the payment again (the Worker rebuilds
// the same proof inputs and checks the commitment), the wasm compiles the execute message (the
// Ed25519 instruction with the approval, then the program) and checks that the approval verifies
// over the digest of the new proof, and only then does the fee key of that seat sign it. The seat
// pays the fee of the execute; the rent of the proposal account goes back to the proposing seat.
// The proposing seat executes when this browser holds it; any other ready seat may.
//
// A proposal account that is gone before the expiry was executed by another device (the page
// never cancels, and only the fee key of the proposing seat could): the page writes the sent mark
// with the transaction that closed it.
import { agreement } from "./ceremony.js";
import { base58 } from "./docs.js";
import { feeProblem, poorFeeText, readyFee } from "./fee.js";
import { writerSeats } from "./gate.js";
import { bytesOf, decodeIntent, intentHex, pinsHex, snapshotHex, wireBase64 } from "./intent.js";
import { rolesOf, signAsFee } from "./approve.js";
import { ensureWorker } from "./session.js";
import { SESSIONS, writePart } from "./sessions.js";

/** Tries of the execute in this tab before the card asks for a click (actions.execute). */
export const EXECUTE_TRIES = 3;
const STALE_ROOT = /\b7008\b/;
const HOLDER = crypto.randomUUID();
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

/**
 * The account is gone: the newest transaction that succeeded on it, other than its create, closed
 * it. ponytail: the page reads no instruction of that transaction. Ceiling: a cancel by the fee
 * key of the proposing seat before the expiry would read as the execute; the page never cancels.
 * Upgrade path: read the Ed25519 instruction of the transaction and compare the digest.
 */
async function landedElsewhere(c, worker, ss, seat, failSession) {
  const found = await worker.call("history", { account: base58(ss.account) });
  const closed = found.find((x) => !x.failed && x.signature !== ss.createTx);
  if (!closed) {
    await failSession(c, ss, "The proposal account is gone, and no execute of it landed.");
    return;
  }
  const mark = { txId: closed.signature, slot: closed.slot, outcome: "confirmed" };
  await writePart(c, ss.id, "sent", mark, { seat });
}

async function attempt(c, ss, seat, failSession) {
  const worker = await ensureWorker(c);
  const ref = c.host.sdb.doc(c.base + "/" + SESSIONS + "/" + ss.id);
  if (!(await ref.acquire({ holder: HOLDER, ttlMs: 120_000 })).acquired) return sleep(3000);
  const account = await worker.call("account", { account: base58(ss.account) });
  if (!account.exists) return landedElsewhere(c, worker, ss, seat, failSession);
  const { tx, txId } = await signedExecute(c, worker, ss, seat);
  const sim = await worker.call("simulate", { tx });
  if (sim.err !== null) throw new Error(refusalOf(sim, seat));
  await worker.call("send", { tx });
  const seen = await worker.call("confirm", { signature: txId });
  if (seen.status === "unknown") throw new Error("The execute is not confirmed yet.");
  return writePart(c, ss.id, "sent", { txId, slot: seen.slot, outcome: seen.status }, { seat });
}

/**
 * The reactor step of a signed payment. A failed try is counted; after EXECUTE_TRIES the card shows
 * the last error and a button that tries again. The approval stays valid until the expiry.
 */
export function maybeExecute(c, ss, { launch, failSession }) {
  const seat = executorOf(c, ss);
  if (!c.rpcUrl || seat === undefined || (c.tries[ss.id] ?? 0) >= EXECUTE_TRIES) return;
  launch(c, "exec:" + ss.id, async () => {
    try {
      await attempt(c, ss, seat, failSession);
      delete c.execErrors[ss.id];
    } catch (e) {
      c.tries[ss.id] = (c.tries[ss.id] ?? 0) + 1;
      c.execErrors[ss.id] = errorText(e);
      throw e;
    }
  });
}
