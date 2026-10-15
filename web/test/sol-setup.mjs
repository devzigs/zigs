// The setup that sol-limits.mjs shares: a 2-of-3 wallet with a Solana part and the fake chain
// behind the Worker (sol-chain.mjs), as sol-sessions.mjs makes them. Importing this file runs
// the ceremony, so a test file imports it once and uses what it exports.
import { approve } from "../sol/approve.js";
import { agreement } from "../sol/ceremony.js";
import { base58 } from "../sol/docs.js";
import { nonceAccountHex } from "../sol/intent.js";
import { propose } from "../sol/propose.js";
import { makeChain } from "./sol-chain.mjs";
import { loadRig } from "./sol-rig.mjs";

export const rig = await loadRig();
export const { t, W, data, hook, notify, waitFor } = rig;
export const J = JSON.parse;
export const path = (gid, rel) => `groups/${gid}/${rel}`;
export const gid = await rig.wallet({ name: "Limits" });
export const solOf = (i) => t.sec(gid, i).sol ?? {};
await t.solLoad();
await t.sol.add();
const ready = () => [1, 2, 3].every((i) => data.has(path(gid, "soldone/" + i)));
await waitFor("every soldone", ready, 30000);
export const c = t.sol.ctl;
await waitFor("agreement", () => agreement(c).state === "agree");
export const done = agreement(c).done;
const roles = J(W.sol_roles(solOf(1).solSeed, done.groupKey));
export const chain = makeChain();
chain.group = {
  key: done.groupKey,
  owner: base58(done.groupKey),
  shielded: roles.address,
  nonceAccount: base58(await nonceAccountHex(done.groupKey)),
};
chain.balances.set(chain.group.owner, 50_000_000n);
chain.install();

export const ssOf = (id) => c.sessions.find((ss) => ss.id === id);
export const waitStatus = (id, status, ms = 30000) =>
  waitFor(`session ${id} ${status}`, () => ssOf(id)?.status === status, ms);
export const proposed = async (kind, args) => {
  const id = await propose(c, kind, args);
  await waitFor("the proposal", () => ssOf(id));
  return id;
};

/** Creates the nonce account: seats 1 and 2 approve and the transaction lands. */
export async function withNonceAccount() {
  const id = await proposed("createNonce");
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitStatus(id, "sent");
  return id;
}

/** One shield that seats 1 and 2 approve, and that lands. */
export async function landedShield(amount = "0.001") {
  const id = await proposed("shield", { amount });
  await approve(c, ssOf(id), 1);
  await approve(c, ssOf(id), 2);
  await waitStatus(id, "sent", 30000);
  return id;
}
