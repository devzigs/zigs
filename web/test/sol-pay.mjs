// The device side of a private payment against the fake chain: the snapshot that an approving
// device reads for itself (web/sol/spend.js), the gate before the checker runs (approve.js) and
// the end of a session whose proof went stale (signing.js, error 7008), and one private payment
// through propose, approve, share, aggregate and send: the wallet takes the test group of
// sol-group.json, for which the TS SDK built the payment (solspike/tools/sol_group_fixture.mjs).
// The wire forms and the checker are tested in sol-transfer.mjs.
// Run: node web/test/sol-pay.mjs   (Node 24)
import assert from "node:assert/strict";
import fs from "node:fs";
import { approve, reviewOf } from "../sol/approve.js";
import { agreement } from "../sol/ceremony.js";
import { CLUSTER, base58 } from "../sol/docs.js";
import { ZERO_KEY, nonceAccountHex } from "../sol/intent.js";
import { savedNonces, saveNonces } from "../sol/nonces.js";
import { putSol } from "../sol/secrets.js";
import { deviceSpend } from "../sol/spend.js";
import { verifies } from "./sol-chain.mjs";
import {
  W,
  c,
  chain,
  gid,
  proposed,
  solOf,
  ssOf,
  waitFor,
  waitStatus,
  withNonceAccount,
} from "./sol-setup.mjs";
import { pageSide, step, transactHex, vector } from "./sol-vector.mjs";

const SOL_MINT = "1".repeat(32);
const input = (hash, tree, mint = SOL_MINT) => ({
  hash,
  mint,
  amount: "5000000",
  blinding: "07".repeat(32),
  tree,
  leaf: "0",
});
const HASH = "aa".repeat(32);
const OTHER = "bb".repeat(32);
const ss = { id: "p1", inputIds: [HASH], message: "00".repeat(16) };

// ── The snapshot is read from the wallet of this device and matched by the ids ──
chain.utxos = [input(HASH, "TREE1"), input(OTHER, "TREE2")];
{
  const got = await deviceSpend(c, ss);
  assert.deepEqual(got.inputs, [{ mint: ZERO_KEY, amount: "5000000", blinding: "07".repeat(32) }]);
  assert.equal(got.fee, chain.fee, "the insertion fee of the tree");
  const { firstNullifier: first, salt } = chain.inspected;
  assert.deepEqual(got.pair, { first, salt }, "the pair of the message");
  assert.deepEqual(got.salts, [], "no earlier pair");
  const asked = chain.commands.filter((m) => m.cmd === "treeFees").at(-1);
  assert.equal(asked.args.tree, "TREE1", "the fee is read for the tree of the inputs");
}
step("the snapshot holds the inputs of this device, matched by id, and the tree fee");

const refused = (what, spec, pattern) =>
  assert.rejects(() => deviceSpend(c, { ...ss, ...spec }), pattern, what);
await refused("an input that is not in the wallet", { inputIds: ["cc".repeat(32)] }, /every input/);
await refused("no input id", { inputIds: [] }, /every input/);
await refused("one input missing", { inputIds: [HASH, "cc".repeat(32)] }, /every input/);
await refused("inputs of two trees", { inputIds: [HASH, OTHER] }, /different trees/);
chain.utxos = [input(HASH, "TREE1", "2".repeat(32))];
await refused("an input that is not SOL", {}, /Only SOL/);
chain.utxos = [input(HASH, "TREE1")];
step("a missing input, inputs of two trees and another mint are refused");

// ── The pairs of the other sessions that this browser approved ──
{
  const pair = { first: "01".repeat(32), salt: "02".repeat(16) };
  const entry = { digest: "d", nonces: {}, commitments: {}, spend: { pair } };
  await saveNonces(c, 1, "other-session", entry);
  const later = await deviceSpend(c, ss);
  assert.deepEqual(later.salts, [pair], "the pair of another session");
  const own = await deviceSpend(c, { ...ss, id: "other-session" });
  assert.deepEqual(own.salts, [], "the pair of the session itself is not an earlier pair");
}
step("the earlier pairs come from the other sessions only");

// ── No screen and no approval before the device has read its wallet ──
{
  const side = pageSide(vector("transfer-sol")).ss;
  const waiting = { id: "w", status: "collecting", ...side, message: "00".repeat(40) };
  const review = reviewOf(c, waiting, 1);
  assert.equal(review.ok, false);
  assert.match(review.why, /reading your wallet/);
}
step("a payment waits for the snapshot of the device before any screen");

// ── A stale proof ends the session and says so ──
{
  await withNonceAccount();
  const id = await proposed("shield", { amount: "0.001" });
  await approve(c, ssOf(id), 1);
  chain.refuse = JSON.stringify({ InstructionError: [1, { Custom: 7008 }] });
  await approve(c, ssOf(id), 2);
  await waitStatus(id, "failed");
  assert.match(ssOf(id).error, /proof expired because the pool moved on/i);
  chain.refuse = null;
}
step("error 7008 ends the session with proof expired, propose again");

// ── One private payment of the test group, from the proposal to the landing ──
const G = JSON.parse(fs.readFileSync(new URL("./sol-group.json", import.meta.url)));
const PAID = G.outputs.find((o) => o.role === "payee");

/** The wallet holds the test group: each seat its key share, each soldone the group keys. */
async function useTestGroup() {
  const { key, nullifierPk, viewingPk, address } = G.group;
  for (const i of [1, 2, 3]) {
    const { keyPackage, publicKeyPackage } = G.seats[i];
    const share = { solSeed: G.solSeed, groupKey: key, keyPackage, publicKeyPackage };
    await putSol(c.host, gid, i, share);
    const fields = { groupKey: key, publicKeyPackage: JSON.stringify(publicKeyPackage) };
    Object.assign(fields, { nullifierPk, viewingPk, address, cluster: CLUSTER });
    Object.assign(fields, { program: W.sol_program_label(), at: Date.now() });
    const doc = await c.host.signedDoc(gid, "soldone/" + i, i, fields);
    await c.host.sdb.doc(c.base + "/soldone/" + i).set(doc);
  }
  await waitFor("the test group", () => agreement(c).done?.groupKey === key);
  const owner = base58(key);
  chain.group = { key, owner, shielded: address, nonceAccount: base58(await nonceAccountHex(key)) };
  chain.balances.set(owner, 50_000_000n);
  c.inited = null; // the Worker starts again for the new keys and checks their address
}

/** The answer of the Worker to prepare: the SDK payment, with the expiry of the request. */
function prepared(args) {
  assert.equal(args.recipient, G.payee.address, "the Worker proves for the typed payee");
  assert.equal(args.amount, PAID.amount, "the Worker proves the typed amount");
  const slot = ({ amount, blinding }) => ({ mint: ZERO_KEY, amount, blinding });
  return {
    data: transactHex(G, BigInt(args.expiry)),
    expiry: args.expiry,
    salt: G.salt,
    blindingSeed: G.blindingSeed,
    outputs: G.outputs.map((o) => ({ role: o.role, ...slot(o) })),
    inputs: G.inputs.map((u) => ({ id: u.utxoHash, tree: "TREE1", ...slot(u) })),
  };
}

{
  await useTestGroup();
  const [u] = G.inputs;
  chain.utxos = [{ ...input(u.utxoHash, "TREE1"), amount: u.amount, blinding: u.blinding }];
  chain.inspected = { salt: G.salt, firstNullifier: u.nullifier };
  chain.prepared = prepared;
  const id = await proposed("transfer", { recipient: G.payee.address, amount: "0.002" });
  await approve(c, ssOf(id), 1);
  const pair = { first: u.nullifier, salt: G.salt };
  const entry = savedNonces(c, 1, id);
  assert.ok(entry.spend, "the saved approval keeps the snapshot of the device");
  assert.deepEqual(entry.spend.pair, pair, "with the pair of the message");
  assert.equal(entry.spend.fee, chain.fee, "and the tree fee");
  assert.deepEqual(solOf(1).salts?.[id], pair, "the pair is kept for later proposals");
  await approve(c, ssOf(id), 2);
  await waitStatus(id, "sent");
  const landed = chain.landed.at(-1);
  assert.equal(landed.message, ssOf(id).message, "the proposed message landed");
  const sig = Buffer.from(landed.sig, "hex");
  assert.ok(verifies(G.group.key, Buffer.from(landed.message, "hex"), sig), "the group signed");
  const data = prepared({ ...ssOf(id), recipient: G.payee.address, amount: PAID.amount }).data;
  assert.ok(landed.message.includes(data), "the message holds the transact data");
}
step("a private payment is proposed, approved by two seats, signed and sent");
console.log("sol-pay: ok");
process.exit(0);
