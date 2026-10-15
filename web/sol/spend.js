// What a device knows about its own wallet when it checks a private payment (ZOLANA.md 5, step 3).
// The checker takes a snapshot that the proposer never supplies: the inputs that the proposal
// spends, read from the Worker sync of this device and matched by their ids, the insertion fee of
// the tree, and the (first nullifier, salt) pairs of the earlier proposals that this browser
// approved. The checker refuses a pair that it sees again (rule SaltReused), because both fix the
// keystream of every output slot.
// ponytail: the pairs live in this browser only and a restore starts with none. Ceiling: a seat
// that never approved the earlier proposal cannot see a reused salt. Upgrade path: none without
// a signed list of pairs in the group store.
import { ZERO_KEY, bytesOf, wireBase64 } from "./intent.js";
import { solOf } from "./secrets.js";
import { ensureWorker } from "./session.js";

/** The mint of SOL as the SDK writes it: the 32 byte all-zero key in base58. */
const SOL_MINT = "1".repeat(32);

/** The 32 byte mint (hex) of an input, or an error: only SOL is spent. */
export function mintKey(mint) {
  if (mint !== SOL_MINT && mint !== ZERO_KEY) throw new Error("Only SOL can be spent.");
  return ZERO_KEY;
}

/** The pairs of the other sessions that the seats of this browser approved, each once. */
export function pairsBefore(c, sid) {
  const seen = new Map();
  for (const seat of c.host.localSeats()) {
    for (const [other, pair] of Object.entries(solOf(c.host, c.gid, seat).salts ?? {})) {
      if (other !== sid) seen.set(pair.first + pair.salt, pair);
    }
  }
  return [...seen.values()];
}

const same = (list) => list.every((u) => u.tree === list[0].tree);

/** The inputs of the proposal as this device sees them. Throws when one is not in its sync. */
function inputsFound(sync, ids) {
  const found = ids.map((id) => sync.utxos.find((u) => u.hash === id));
  if (found.length === 0 || found.some((u) => u === undefined)) {
    throw new Error("This device does not see every input of this payment in its own wallet yet.");
  }
  if (!same(found)) throw new Error("The inputs of this payment are in different trees.");
  return found;
}

/**
 * Reads the snapshot of this device for the transfer `ss`: a fresh sync, the fee of the tree of
 * the inputs, and the salt and first nullifier of the message. The proposal supplies only the ids.
 */
export async function deviceSpend(c, ss) {
  const worker = await ensureWorker(c);
  const ids = Array.isArray(ss.inputIds) ? ss.inputIds : [];
  const found = inputsFound(await worker.call("sync"), ids);
  const fees = await worker.call("treeFees", { tree: found[0].tree });
  const tx = wireBase64(bytesOf(ss.message), new Uint8Array(0));
  const seen = await worker.call("inspect", { tx });
  return {
    fee: fees.feePerNullifier,
    inputs: found.map((u) => ({ mint: mintKey(u.mint), amount: u.amount, blinding: u.blinding })),
    pair: { first: seen.firstNullifier, salt: seen.salt },
    salts: pairsBefore(c, ss.id),
  };
}
