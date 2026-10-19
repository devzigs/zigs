// Two tabs of one seat and its Solana nonces (web/sol/nonces.js). The secrets are one record in
// storage that each tab writes whole from its own memory, and the storage event of another tab
// comes late. A nonce must make one share across the tabs: under the lock of the secrets each step
// first takes what storage holds now. Without that, two tabs could sign two signing packages with
// one nonce, which breaks the once-only rule of FROST.
// Run: node web/test/sol-nonce-tabs.mjs   (Node 24)
import assert from "node:assert/strict";
import { pendingShare, saveNonces, savedNonces, shareOnce } from "../sol/nonces.js";
import { putSol } from "../sol/secrets.js";

const tick = () => new Promise((done) => setTimeout(done, 1));
const copy = (v) => structuredClone(v);

// One lock for the browser: each run waits for the one before it (navigator.locks in a page).
let turn = Promise.resolve();
function exclusive(_name, fn) {
  const next = turn.then(fn);
  turn = next.catch(() => {});
  return next;
}

// The stored record of seat 1, and its tabs: each has its own copy, writes it whole after a tick,
// and takes the stored copy only when asked.
function browser(sol) {
  const store = { sol: copy(sol) };
  const tab = () => {
    let mem = copy(store.sol);
    const host = {
      sec: () => ({ sol: mem }),
      async putSec(_gid, _seat, patch) {
        mem = patch.sol;
        await tick();
        store.sol = copy(mem);
        return true;
      },
      async takeStored() {
        mem = copy(store.sol);
      },
      exclusive,
    };
    return { host, gid: "G" };
  };
  return { store, tab };
}
const entry = { digest: "d1", nonces: "n1", commitments: "c1" };
// A share step that records the package that it signed.
const signer = (made, pkg) => (e) => {
  made.push({ pkg, nonces: e.nonces });
  return { share: "share-" + pkg, digest: e.digest };
};

// ── Two tabs at once, each with another package: one share ──
{
  const { store, tab } = browser({ nonces: { s1: entry } });
  const [a, b] = [tab(), tab()];
  const made = [];
  const outs = await Promise.all([
    shareOnce(a, 1, "s1", signer(made, "P1")),
    shareOnce(b, 1, "s1", signer(made, "P2")),
  ]);
  assert.equal(made.length, 1, "one nonce makes one share across the tabs");
  assert.equal(outs.filter(Boolean).length, 1, "and one tab publishes it");
  assert.equal(store.sol.nonces.s1, undefined, "the nonces are gone");
  assert.equal(store.sol.pending.s1.share, "share-" + made[0].pkg, "the made share is kept");
}

// ── A tab that saw the nonces before the other tab spent them signs nothing later ──
{
  const { store, tab } = browser({ nonces: { s1: entry } });
  const [a, b] = [tab(), tab()];
  const made = [];
  assert.ok(await shareOnce(a, 1, "s1", signer(made, "P1")));
  assert.ok(savedNonces(b, 1, "s1"), "the late tab still holds the nonces");
  assert.equal(await shareOnce(b, 1, "s1", signer(made, "P2")), null, "a used nonce signs nothing");
  assert.deepEqual(made.map((m) => m.pkg), ["P1"]);
  // A save of another session in the late tab keeps the spend of the first tab.
  await saveNonces(b, 1, "s2", { ...entry, digest: "d2" });
  assert.equal(store.sol.nonces.s1, undefined, "a late save does not bring the nonces back");
  assert.ok(store.sol.pending.s1 && store.sol.used.d1, "and keeps the made share and its mark");
  assert.ok(store.sol.nonces.s2, "and saves its own nonces");
}

// ── A late tab writes another Solana record after the other tab spent a nonce ──
{
  const { store, tab } = browser({ nonces: { s1: entry } });
  const [a, b] = [tab(), tab()];
  assert.ok(await shareOnce(a, 1, "s1", signer([], "P1")));
  assert.equal(await putSol(b.host, "G", 1, { backupSaved: true }), true);
  assert.equal(store.sol.nonces.s1, undefined, "a late write keeps the nonce spent");
  assert.ok(store.sol.used.d1 && store.sol.pending.s1, "and keeps the used mark and the share");
  assert.equal(store.sol.backupSaved, true, "and saves its own record");
}

// ── A share that waits, a share that is not ready, a refused share, a failed save ──
{
  // s0: a made share waits, and a stale write brought its nonces back.
  const kept = { s0: { share: "x", digest: "d0" } };
  const { store, tab } = browser({ nonces: { s1: entry, s0: entry }, pending: kept });
  const a = tab();
  const made = [];
  assert.equal(await shareOnce(a, 1, "s0", signer(made, "P0")), null, "a kept share is not made");
  assert.equal(made.length, 0, "and its nonces sign nothing");
  assert.equal(await shareOnce(a, 1, "s1", () => null), null, "not ready: nothing is made");
  assert.ok(store.sol.nonces.s1, "and the nonces stay");
  const out = await shareOnce(a, 1, "s1", () => {
    throw new Error("the package differs");
  });
  assert.match(String(out.refused), /the package differs/, "a refusal comes back");
  assert.equal(store.sol.nonces.s1, undefined, "and deletes the nonces");
  await saveNonces(a, 1, "s3", entry);
  const full = tab();
  full.host.putSec = async () => false;
  await assert.rejects(() => shareOnce(full, 1, "s3", signer(made, "P3")), /used nonce/);
  assert.ok(store.sol.nonces.s3, "a failed save keeps the nonces");
  assert.equal(pendingShare(a, 1, "s3"), undefined, "and keeps no share to send");
}

console.log("sol-nonce-tabs: ok");
