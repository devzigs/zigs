// Two tabs of one seat and its Solana nonces (web/sol/nonces.js). The secrets are one record in
// storage that each tab writes whole from its own memory, and the storage event of another tab
// comes late. A nonce must make one share across the tabs: under the lock of the secrets each step
// first takes what storage holds now. Without that, two tabs could sign two signing packages with
// one nonce, which breaks the once-only rule of FROST.
// Run: node web/test/sol-nonce-tabs.mjs   (Node 26)
import assert from "node:assert/strict";
import {
  approvalOnce,
  clearPending,
  dropNonces,
  pendingShare,
  saveNonces,
  savedNonces,
  shareOnce,
} from "../sol/nonces.js";
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
      // As the page does: memory changes first, then the save, which fails while `full` is set.
      async putSec(_gid, _seat, patch) {
        mem = patch.sol;
        if (host.full) return false;
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

// ── A late write at the same time as a spend: the lock of putSol orders them ──
{
  const { store, tab } = browser({ nonces: { s1: entry } });
  const [a, b] = [tab(), tab()];
  let took;
  const inside = new Promise((done) => (took = done));
  const takeA = a.host.takeStored;
  a.host.takeStored = async () => {
    await takeA();
    took();
  };
  const spending = shareOnce(a, 1, "s1", signer([], "P1"));
  await inside; // the first tab holds the lock and read storage
  await Promise.all([spending, putSol(b.host, "G", 1, { backupSaved: true })]);
  assert.equal(store.sol.nonces.s1, undefined, "a write during the spend keeps the nonce spent");
  assert.equal(store.sol.backupSaved, true, "and both changes are saved");
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
  full.host.full = true;
  await assert.rejects(() => shareOnce(full, 1, "s3", signer(made, "P3")), /used nonce/);
  assert.ok(store.sol.nonces.s3, "a failed save keeps the nonces in storage");
  assert.equal(pendingShare(full, 1, "s3"), undefined, "and memory keeps no share to send");
  assert.ok(savedNonces(full, 1, "s3"), "and memory keeps the nonces");
}

// ── A late tab that saves, deletes or clears another record keeps the spend ──
for (const [what, late] of [
  ["save", (b) => saveNonces(b, 1, "s2", { ...entry, digest: "d2" })],
  ["drop", (b) => dropNonces(b, 1, "s2")],
  ["clear", (b) => clearPending(b, 1, "s9")],
]) {
  const two = { ...entry, digest: "d2" };
  const kept = { s9: { share: "x", digest: "d9" } };
  const { store, tab } = browser({ nonces: { s1: entry, s2: two }, pending: kept });
  const [a, b] = [tab(), tab()];
  assert.ok(await shareOnce(a, 1, "s1", signer([], "P1")));
  await late(b);
  assert.equal(store.sol.nonces.s1, undefined, "a late " + what + " keeps the nonce spent");
  assert.ok(store.sol.pending.s1 && store.sol.used.d1, "and keeps the share and the mark");
}

// ── After the publish the kept share is gone: a late tab still signs nothing ──
{
  const { store, tab } = browser({ nonces: { s1: entry } });
  const [a, b] = [tab(), tab()];
  assert.ok(await shareOnce(a, 1, "s1", signer([], "P1")));
  await clearPending(a, 1, "s1");
  const made = [];
  assert.equal(await shareOnce(b, 1, "s1", signer(made, "P2")), null, "a published share");
  assert.equal(made.length, 0, "signs nothing again");
  assert.ok(store.sol.used.d1);
}

// ── Storage holds a share that waits, unknown to this tab: nothing is made ──
{
  const { store, tab } = browser({ nonces: { s1: entry } });
  const b = tab();
  store.sol.pending = { s1: { share: "x", digest: "d1" } };
  const made = [];
  assert.equal(await shareOnce(b, 1, "s1", signer(made, "P2")), null, "a kept share of storage");
  assert.equal(made.length, 0);
}

// ── Storage that does not read: putSol is false, a share step throws and makes nothing ──
{
  const { tab } = browser({ nonces: { s1: entry } });
  const b = tab();
  b.host.takeStored = async () => {
    throw new Error("unreadable");
  };
  assert.equal(await putSol(b.host, "G", 1, { backupSaved: true }), false, "putSol is false");
  const made = [];
  await assert.rejects(() => shareOnce(b, 1, "s1", signer(made, "P")), /unreadable/);
  assert.equal(made.length, 0, "and no share is made");
}

// ── Approvals: one set of nonces per session across the tabs, none for a used digest ──
{
  const { store, tab } = browser({});
  const [a, b] = [tab(), tab()];
  let n = 0;
  const make = (tag) => async () => ({ digest: "d1", nonces: "n" + ++n + tag, commitments: "c" });
  const [x, y] = await Promise.all([
    approvalOnce(a, 1, "s1", "d1", make("a")),
    approvalOnce(b, 1, "s1", "d1", make("b")),
  ]);
  assert.equal(n, 1, "two tabs make one set of nonces");
  assert.deepEqual(x, y, "and publish one commitment");
  assert.deepEqual(store.sol.nonces.s1, x, "which storage holds");
  assert.deepEqual(await approvalOnce(a, 1, "s1", "d1", make("c")), x, "a retry gets it again");
  assert.ok(await shareOnce(a, 1, "s1", signer([], "P1")));
  await assert.rejects(() => approvalOnce(b, 1, "s2", "d1", make("d")), /signed these bytes/);
  assert.equal(n, 1, "a late tab approves no digest that made a share");
}

console.log("sol-nonce-tabs: ok");
