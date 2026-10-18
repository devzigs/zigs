// The rent of proposal accounts that expired (SOL-52, ZOLANA.md 5.1). A proposal holds the rent of
// its proposing seat until an execute or a cancel closes it. An expired proposal can no longer be
// executed, so the fee key of that seat cancels it and gets the rent back. The cancel message
// carries no abort authority, so the program refuses it before the expiry: what the RPC answers
// can cost a fee at most, never a live payment. The checker lets a fee key sign this cancel only
// for a body that names it alone (wasm-sol, SOL-52).
import { rolesOf, signAsFee } from "./approve.js";
import { agreement } from "./ceremony.js";
import { base58 } from "./docs.js";
import { feeOf, readyFee } from "./fee.js";
import { settledBlock } from "./gate.js";
import { bytesOf, intentHex, pinsHex, snapshotHex, wireBase64 } from "./intent.js";
import { ensureWorker } from "./session.js";

const CLOCK = "SysvarC1ock11111111111111111111111111111111";

const le64 = (hex) =>
  (hex.match(/../g) ?? []).reduceRight((n, byte) => n * 256n + BigInt("0x" + byte), 0n);

/** A proposal account (data: kind 1, bump, body) as the fields of its body. */
export function proposalOf({ address, lamports, data }) {
  const body = data.slice(4);
  return {
    address,
    lamports: BigInt(lamports),
    commitment: body.slice(0, 64),
    group: body.slice(64, 128),
    expiry: le64(body.slice(128, 144)),
    rentRecipient: body.slice(144, 208),
    authorities: body.slice(208),
  };
}

/**
 * The proposals that the fee key `fee` (hex) can cancel at the chain time `now`: those of `group`
 * that name it as rent recipient and only abort authority, after their expiry.
 */
export function reclaimable(proposals, { group, fee, now }) {
  const own = (p) => p.group === group && p.rentRecipient === fee && p.authorities === "01" + fee;
  return proposals.filter((p) => own(p) && now > p.expiry);
}

/** The Unix time of the chain: `unix_timestamp` of the Clock sysvar, at byte 32. */
async function chainNow(worker) {
  const clock = await worker.call("account", { account: CLOCK });
  if (!clock.exists) throw new Error("The clock of the chain cannot be read.");
  return le64(clock.data.slice(64, 80));
}

/** Reads the expired proposals of each fee key of this browser into `c.rent`, by seat. */
export async function scanRent(c) {
  const worker = await ensureWorker(c);
  const group = agreement(c).done.groupKey;
  const now = await chainNow(worker);
  const found = {};
  for (const seat of c.host.localSeats().filter((i) => feeOf(c, i) !== null)) {
    const fee = feeOf(c, seat).key;
    const got = await worker.call("owned", { fee, group });
    found[seat] = reclaimable(got.map(proposalOf), { group, fee, now });
  }
  c.rent = { now, found };
  c.host.render();
  return c.rent;
}

/** Signs the cancel of proposal `p` with the fee key of `seat`, sends it and waits for it. */
async function cancel(c, worker, seat, p) {
  const fee = readyFee(c, seat);
  const { blockhashHex } = await worker.call("blockhash");
  const fields = { commitment: p.commitment, expiry: p.expiry, blockhash: blockhashHex };
  const intent = bytesOf(intentHex("cancelProposal", fields));
  const inputs = {
    pins: bytesOf(pinsHex(agreement(c).done, fee.key)),
    snapshot: bytesOf(snapshotHex(rolesOf(c, seat, "cancelProposal"))),
  };
  const message = c.W.compile_message(intent, inputs.pins, new Uint8Array(0));
  const signature = signAsFee(c, seat, message, intent, inputs);
  const tx = wireBase64(message, bytesOf(signature));
  const sim = await worker.call("simulate", { tx });
  if (sim.err !== null) throw new Error("The network refused the cancel: " + sim.err);
  await worker.call("send", { tx });
  const seen = await worker.call("confirm", { signature: base58(signature) });
  if (seen.status === "failed") throw new Error("The cancel failed: " + base58(signature));
  return base58(signature);
}

/**
 * Cancels the expired proposals of seat `seat`, keeps their transaction ids in `c.rentDone` for
 * the card, then reads the accounts again.
 */
export async function reclaimRent(c, seat) {
  const block = await settledBlock(c);
  if (block) throw new Error(block);
  const worker = await ensureWorker(c);
  c.rentDone = { seat, txIds: [] };
  for (const p of (await scanRent(c)).found[seat] ?? []) {
    c.rentDone.txIds.push(await cancel(c, worker, seat, p));
  }
  return scanRent(c);
}

/** The lamports that seat `seat` can get back, by the last read. */
export const heldOf = (c, seat) =>
  (c.rent?.found?.[seat] ?? []).reduce((sum, p) => sum + p.lamports, 0n);
