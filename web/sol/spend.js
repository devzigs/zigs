// What a device knows about its own wallet when it checks a private payment (ZOLANA.md 5, step 3).
// The checker takes a snapshot that the proposer never supplies: the inputs that the proposal
// spends, read from the Worker sync of this device and matched by their ids, the insertion fee of
// the tree, and the (first nullifier, salt) pairs of the other proposals: those of the group
// server and those that the seats of this browser approved. The checker refuses a pair that it
// sees again (rule SaltReused), because both fix the keystream of every output slot. A restored
// seat or a new browser reads the same group server, so it refuses the same pairs (SOL-8).
// ponytail: the list has no order. A later proposal that copies the pair of an open one also
// stops the open one, which fails closed, but only for the seats that did not commit yet: a share
// uses the list of its approval. Ceiling: any holder of the wallet link can overwrite a session on
// the group server, and a seat can rewrite its own proposal, so that pair stays only in the
// history of the browsers that approved it. Upgrade path: a signed list that fails closed when it
// is missing.
import { settledBlock } from "./gate.js";
import { ZERO_KEY, bytesOf, decodeIntent, wireBase64 } from "./intent.js";
import { hex, parsePlan, parseTransact } from "./prepare.js";
import { solOf } from "./secrets.js";
import { ensureWorker } from "./session.js";
import { isPayment } from "./sessions.js";

/** The mint of SOL as the SDK writes it: the 32 byte all-zero key in base58. */
const SOL_MINT = "1".repeat(32);

/** The 32 byte mint (hex) of an input, or an error: only SOL is spent. */
export function mintKey(mint) {
  if (mint !== SOL_MINT && mint !== ZERO_KEY) throw new Error("Only SOL can be spent.");
  return ZERO_KEY;
}

const same = (list) => list.every((u) => u.tree === list[0].tree);

/** The inputs of the proposal as this device sees them. Throws when one is not in its sync. */
function inputsFound(sync, ids) {
  const found = ids.map((id) => sync.utxos.find((u) => u.hash === id));
  if (found.length === 0 || found.some((u) => u === undefined)) {
    throw new Error("This browser does not see every input of this payment in its own wallet yet.");
  }
  if (!same(found)) throw new Error("The inputs of this payment are in different trees.");
  return found;
}

/** The bytes of a payment that the checker reads: the plan and the first proof. */
function paymentPair(ss) {
  // The wasm cuts the proof after the plan, so only a plan that ends where its text ends gives
  // the checker the same proof as the page.
  parsePlan(ss.plan);
  const parsed = parseTransact(bytesOf(String(ss.transact)));
  return { salt: hex(parsed.salt), firstNullifier: parsed.firstNullifier };
}

const FIRST = /^[0-9a-f]{64}$/;
const SALT = /^[0-9a-f]{32}$/;

/**
 * The (first nullifier, salt) pair of a spend: of the first proof of a payment, else of its
 * message. Throws for a spend with no input: it has no first nullifier.
 */
async function pairOf(worker, ss) {
  const tx = isPayment(ss) ? null : wireBase64(bytesOf(ss.message), new Uint8Array(0));
  const seen = tx === null ? paymentPair(ss) : await worker.call("inspect", { tx });
  if (!FIRST.test(seen.firstNullifier) || !SALT.test(seen.salt)) {
    throw new Error("The spend has no first nullifier and salt.");
  }
  return { first: seen.firstNullifier, salt: seen.salt };
}

/** The pairs of the other sessions that the seats of this browser approved. */
function localPairs(c, sid) {
  const out = [];
  for (const seat of c.host.localSeats()) {
    for (const [other, pair] of Object.entries(solOf(c.host, c.gid, seat).salts ?? {})) {
      if (other !== sid) out.push(pair);
    }
  }
  return out;
}

// The intents that spend: a payment, a withdrawal and the move of the beta funds. The others
// (the nonce account, the retired intents of the beta) have no pair that this page reads.
const SPENDS = new Set(["approve", "withdraw", "transfer"]);

/**
 * The pairs of the other spend sessions on the group server, ended ones too: a failed proposal can
 * still have published its data. The pair comes from the bytes that the checker reads, never from
 * the `salt` field. A session whose data does not parse is logged and has no pair: this page never
 * approves it, because deviceSpend reads its pair with the same parser and throws.
 */
async function serverPairs(c, worker, sid) {
  // The list is complete only when every session is loaded and its signature checked.
  const block = await settledBlock(c);
  if (block) throw new Error(block);
  const out = [];
  for (const ss of c.sessions) {
    if (ss.id === sid || !SPENDS.has(decodeIntent(ss.intent)?.kind)) continue;
    try {
      out.push(await pairOf(worker, ss));
    } catch (e) {
      c.host.log("no salt read from Solana session " + ss.id + ": " + e.message);
    }
  }
  return out;
}

/**
 * The (first nullifier, salt) pairs of every proposal but session `sid`, each once: of the group
 * server and of the history of this browser. The proposer passes "new" for its draft.
 */
export async function pairsBefore(c, worker, sid) {
  const seen = new Map();
  for (const pair of [...localPairs(c, sid), ...(await serverPairs(c, worker, sid))]) {
    seen.set(pair.first + pair.salt, pair);
  }
  return [...seen.values()];
}

/**
 * Reads the snapshot of this device for the spend `ss`: a fresh sync of the identity that it spends
 * (the PDA for a payment, the group key for the move of the beta funds), the fee of the tree of
 * the inputs, the salt and first nullifier of the proof, and the pairs of the other proposals.
 * The proposal supplies only the ids.
 */
export async function deviceSpend(c, ss) {
  const worker = await ensureWorker(c);
  const ids = Array.isArray(ss.inputIds) ? ss.inputIds : [];
  const synced = await worker.call(isPayment(ss) ? "sync" : "syncOld");
  const found = inputsFound(synced, ids);
  const fees = await worker.call("treeFees", { tree: found[0].tree });
  return {
    fee: fees.feePerNullifier,
    inputs: found.map((u) => ({ mint: mintKey(u.mint), amount: u.amount, blinding: u.blinding })),
    pair: await pairOf(worker, ss),
    salts: await pairsBefore(c, worker, ss.id),
  };
}
