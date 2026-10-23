// The limits of a wallet that signs many times (the two defects of the P8e verifier):
//  D1  The page watched the commits and shares of at most 50 session documents and never let one
//      go, so the 51st proposal of a wallet (junk documents of a link holder count too) never
//      progressed. Now only the valid sessions that did not end are watched, at most 50, and a
//      session that ended gives its watches back.
//  D2  After a transaction landed, every other session on the same nonce can never land, but it
//      stayed "collecting" with an Approve button that fails. Now every device ends it, from the
//      signed documents alone (no RPC read, so a node that lags cannot kill a live session). The
//      nonce payments left are the moves of the beta funds (sol-fixture.mjs), and the register
//      sessions of the beta that a wallet may still hold.
// Run: node web/test/sol-limits.mjs   (Node 26)
import assert from "node:assert/strict";
import { approve } from "../sol/approve.js";
import { base58 } from "../sol/docs.js";
import { savedNonces } from "../sol/nonces.js";
import { filterSessions, writePart } from "../sol/sessions.js";
import { solView } from "../sol/view.js";
import { G, preparedOf, useTestGroup, utxoOf } from "./sol-fixture.mjs";
import { sleep } from "./sol-rig.mjs";
import {
  W,
  c,
  chain,
  data,
  done,
  feeAddress,
  gid,
  landedSession,
  notify,
  path,
  proposed,
  rig,
  ssOf,
  t,
  waitFor,
  waitStatus,
  withNonceAccount,
} from "./sol-setup.mjs";

const step = (name) => console.log("ok  " + name);
const watches = (rel) => rig.live(path(gid, rel));
const noWatches = (rel, what) => waitFor(what, () => watches(rel) === 0, 10000);

// ── D1: more than 50 sessions that all landed ──
await withNonceAccount();
const SESSIONS = 52;
for (let k = 0; k < SESSIONS; k++) await landedSession();
assert.equal(chain.landed.length, SESSIONS + 1, "every proposal landed, the last ones too");
await noWatches("solsessions/", "a session that ended gives its watches back");
step("52 sessions land one after the other and release their watches");

// ── D1: junk documents of a link holder take no slot ──
for (let k = 0; k < 60; k++) data.set(path(gid, `solsessions/junk-${k}`), { x: k });
notify();
await sleep(300);
await landedSession();
assert.equal(watches("solsessions/junk"), 0, "a document with no valid proposal is not watched");
await noWatches("solsessions/", "no watch is left");
step("60 junk documents take no watch");

// ── D1 and D2: many open sessions on one nonce, then one lands ──
const nonce = chain.nonce;
// The register intent of the beta (01): the page no longer builds it, so the bytes are written
// here. The lifetime of the message (bytes 8 to 40) is the nonce.
const register = "01" + nonce + done.nullifierPk + done.viewingPk;
const message = "00".repeat(8) + nonce + "00".repeat(120);
const OPEN = 55;
for (let k = 0; k < OPEN; k++) {
  const fields = { intent: register, message, feeSig: "33".repeat(64) };
  await writePart(
    c,
    `open-${k}`,
    "proposal",
    { ...fields, createdAt: Date.now() + k },
    {
      seat: 1,
      create: true,
    },
  );
}
await waitFor("the open sessions", () => ssOf(`open-${OPEN - 1}`), 30000);
await sleep(300);
assert.ok(watches("solsessions/") <= 100, "at most 50 sessions, two watches each");
assert.ok(watches("solsessions/") >= 2, "the open sessions are watched");
step("55 open sessions are watched within the cap");

// Two moves on one nonce: the landing of one ends the other, and the open register sessions of
// the beta on that nonce too.
await useTestGroup(c, { gid, data, notify, waitFor, path, W, chain });
for (const i of [1, 2, 3]) chain.balances.set(feeAddress(i), 50_000_000n);
chain.oldUtxos = [utxoOf(G.migrate)];
const moves = [G.migrate, G.migrate2];
chain.prepared = (args) => preparedOf(moves.shift(), args);
chain.inspected = ({ tx }) => {
  const payment = Buffer.from(tx, "base64").toString("hex").includes(G.migrate2.salt)
    ? G.migrate2
    : G.migrate;
  return { salt: payment.salt, firstNullifier: payment.inputs[0].nullifier };
};
const first = await proposed("migrate");
const second = await proposed("migrate");
await approve(c, ssOf(second), 3);
assert.ok(savedNonces(c, 3, second), "seat 3 holds nonces for the second proposal");
await approve(c, ssOf(first), 1);
await approve(c, ssOf(first), 2);
await waitStatus(first, "sent");
await waitStatus(second, "failed", 15000);
{
  assert.match(ssOf(second).error, /another proposal.*landed first/i);
  await waitFor("the nonces of the second go", () => !savedNonces(c, 3, second));
  await assert.rejects(() => approve(c, ssOf(second), 1), /not collecting/);
  const lands = chain.landed.length;
  await sleep(500);
  assert.equal(chain.landed.length, lands, "the second proposal was never sent");
  await waitFor("every open session ended", () =>
    c.sessions.every((s) => s.status !== "collecting"),
  );
  await noWatches("solsessions/", "the ended sessions give their watches back");
}
step("a landed session ends every other session on its nonce");

// ── D2: no Approve button on a session that ended ──
{
  const node = (tag, attrs = {}, ...kids) => ({
    tag,
    attrs,
    kids: kids.flat(Infinity).filter(Boolean),
  });
  const textOf = (n) => (typeof n === "object" ? n.kids.map(textOf).join(" ") : String(n));
  const findAll = (n, pick) =>
    typeof n !== "object"
      ? []
      : [...(pick(n) ? [n] : []), ...n.kids.flatMap((kid) => findAll(kid, pick))];
  const tab = solView({ ...c, host: { ...c.host, el: node } }, (fn) => fn, {});
  const buttons = findAll(tab, (n) => String(n.attrs["data-sol"] ?? "").startsWith("approve-"));
  assert.deepEqual(
    buttons.map((b) => b.attrs["data-sol"]),
    [],
    "no Approve button is left",
  );
  const card = findAll(tab, (n) => n.attrs["data-session"] === second)[0];
  if (card) assert.match(textOf(card), /another proposal/i, "the card says why");
}
step("an ended session has no Approve button and says why");

// ── D2: the rule on documents alone: sent ends the other sessions on its nonce ──
{
  const lifetime = "ab".repeat(32);
  const message = "00".repeat(8) + lifetime + "ff".repeat(12);
  const other = "00".repeat(8) + "cd".repeat(32) + "ff".repeat(12);
  const signature = "11".repeat(64);
  const feeSig = "33".repeat(64); // the payer signs first: its signature is the id
  const base = { by: 1, sig: "s", feeSig, createdAt: 1 };
  const spend = "01" + lifetime + "0100000000000000";
  const all = {
    sent: {
      ...base,
      intent: spend,
      message,
      signature,
      signedBy: 1,
      signedSig: "s",
      package: "{}",
      signers: [1, 2],
      digest: "d",
      packageBy: 1,
      packageSig: "s",
      txId: base58(feeSig),
      slot: "5",
      outcome: "failed",
      sentBy: 1,
      sentSig: "s",
    },
    collecting: { ...base, intent: spend, message },
    signed: {
      ...base,
      intent: spend,
      message,
      signature: "22".repeat(64),
      signedBy: 1,
      signedSig: "s",
      package: "{}",
      signers: [1, 2],
      digest: "d",
      packageBy: 1,
      packageSig: "s",
    },
    elsewhere: { ...base, intent: "01" + "cd".repeat(32) + "0100000000000000", message: other },
    blockhash: { ...base, intent: "00" + lifetime, message },
    // Add SOL (the intent 02) also has a blockhash for its lifetime. A member can write it as a
    // session, and the landed session on that value does not end it.
    addsol: { ...base, intent: "02" + lifetime + "00".repeat(8), message },
  };
  const check = () => "yes";
  const read = (raw) =>
    Object.fromEntries(
      filterSessions({ solsessions: raw }, check, () => {}).sessions.map((s) => [s.id, s]),
    );
  const seen = read(all);
  assert.equal(seen.sent.status, "sent", "a landed session stays landed");
  for (const id of ["collecting", "signed"]) {
    assert.equal(seen[id].status, "failed", id + " ends");
    assert.match(seen[id].error, /another proposal.*landed first/i);
  }
  assert.equal(seen.elsewhere.status, "collecting", "another nonce is not touched");
  assert.equal(seen.blockhash.status, "collecting", "a blockhash lifetime is not a nonce");
  assert.equal(seen.addsol.status, "collecting", "an Add SOL message is no nonce session");
  const { sent: _gone, ...without } = all;
  assert.equal(read(without).collecting.status, "collecting", "nothing landed, nothing ends");
}
step("the rule needs no chain read");

// ── D1: closing the wallet stops the watches of its open sessions too ──
{
  chain.nonce = null;
  const open = await proposed("createNonce");
  await waitFor("the open session is watched", () => c.watching.has(open));
  assert.ok(watches("solsessions/") >= 2, "the commits and shares of the open session");
  t.sol.close();
  assert.equal(watches("solsessions/"), 0, "no session watch outlives the wallet");
  // app-sol.js keeps its own solstart watch until it opens another wallet.
  assert.equal(watches("solstart"), 1, "only the solstart watch of app-sol.js");
  assert.equal(watches("sol"), 1, "no other Solana watch outlives the wallet");
}
step("closing the wallet stops every Solana watch");
console.log("sol-limits: ok");
process.exit(0);
