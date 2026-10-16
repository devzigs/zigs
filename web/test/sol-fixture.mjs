// The test group of sol-group.json (solspike/tools/sol_group_fixture.mjs) in a wallet of the rig,
// and what the fake Worker (sol-chain.mjs) answers for its two payments: `pay`, a payment of the
// PDA identity (ZOLANA.md 7.2), and `migrate`, the move of the beta funds of the group key to the
// PDA address. The TS SDK built both offline, so the real wasm accepts them. Shared by sol-pay.mjs
// and sol-sessions.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";
import { agreement } from "../sol/ceremony.js";
import { CLUSTER } from "../sol/docs.js";
import { ZERO_KEY } from "../sol/intent.js";
import { feeOf } from "../sol/fee.js";
import { putSol, solOf } from "../sol/secrets.js";
import { chainGroup } from "./sol-chain.mjs";
import { transactHex } from "./sol-vector.mjs";

export const G = JSON.parse(fs.readFileSync(new URL("./sol-group.json", import.meta.url)));
const SOL_MINT = "1".repeat(32);
const PDA_FIELDS = ["pda", "pdaNullifierPk", "pdaOwnerHash", "pdaAddress"];

/** A payment of the fixture as a vector of sol-vector.mjs: the group keys and the payment. */
const vectorOf = (payment) => ({ ...payment, group: G.group, payee: G.payee });

/** The `transact` data of a payment with `expiry`; another proof with `proof` and `root`. */
export const transactOf = (payment, expiry, proof) =>
  transactHex(vectorOf(payment), BigInt(expiry), proof);

/** The synced UTXO of the input of a payment, as the Worker sync gives it. */
export function utxoOf(payment, tree = "TREE1") {
  const [u] = payment.inputs;
  const { amount, blinding } = u;
  return { hash: u.utxoHash, mint: SOL_MINT, amount, blinding, tree, leaf: "0" };
}

/** The answer of the Worker to prepare: the SDK payment, with the expiry of the request. */
export function preparedOf(payment, args) {
  const slot = ({ amount, blinding }) => ({ mint: ZERO_KEY, amount, blinding });
  return {
    data: transactOf(payment, args.expiry),
    expiry: args.expiry,
    salt: payment.salt,
    blindingSeed: payment.blindingSeed,
    outputs: payment.outputs.map((o) => ({ role: o.role, ...slot(o) })),
    inputs: payment.inputs.map((u) => ({ id: u.utxoHash, tree: "TREE1", ...slot(u) })),
  };
}

/**
 * The wallet of `c` holds the test group: each seat its key share, each soldone the group keys and
 * its PDA identity. The fee keys follow from the shares, so their documents are written again.
 * `rig` is { gid, data, notify, waitFor, path, W, chain }. Resolves when the seats agree.
 */
export async function useTestGroup(c, rig) {
  const { gid, data, notify, waitFor, path, W, chain } = rig;
  const { key, nullifierPk, viewingPk, address } = G.group;
  // A key share that does not fit its own soldone stops the seats for good (agreement in
  // ceremony.js). So the old documents go first, then the shares, then the new documents at once.
  for (const i of [1, 2, 3]) data.delete(path(gid, "soldone/" + i));
  notify();
  await waitFor("no soldone", () => agreement(c).state === "wait");
  for (const i of [1, 2, 3]) {
    const { keyPackage, publicKeyPackage } = G.seats[i];
    const share = { solSeed: G.solSeed, groupKey: key, keyPackage, publicKeyPackage };
    await putSol(c.host, gid, i, share);
  }
  const fields = { groupKey: key, publicKeyPackage: JSON.stringify(G.seats[1].publicKeyPackage) };
  Object.assign(fields, { nullifierPk, viewingPk, address, cluster: CLUSTER });
  Object.assign(fields, { program: W.sol_program_label(), at: Date.now() });
  for (const k of PDA_FIELDS) fields[k] = G.group[k];
  for (const i of [1, 2, 3]) {
    data.set(path(gid, "soldone/" + i), await c.host.signedDoc(gid, "soldone/" + i, i, fields));
  }
  notify();
  await waitFor("the test group", () => agreement(c).done?.groupKey === key);
  assert.ok([1, 2, 3].every((i) => !solOf(c.host, gid, i).aborted), "no seat stopped");
  for (const i of [1, 2, 3]) data.delete(path(gid, "solfee/" + i));
  notify();
  const published = () => [1, 2, 3].every((i) => c.docs.solfee[i]?.key === feeOf(c, i).key);
  await waitFor("the fee keys of the test group", published);
  chain.group = await chainGroup(W, { groupKey: key }, G.solSeed);
  c.inited = null; // the Worker starts again for the new keys and checks their addresses
}
