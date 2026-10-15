// The Solana secrets, backup and restore against the real web/app.js (see sol-rig.mjs): the Zcash
// backup carries no Solana field, the second file backs up and restores the Solana part of a
// seat that settled and fits, and every refusal holds. It also pins what the Zcash restore does
// with a seat that holds a Solana part, and checks the sealed snapshot store.
// Run: node web/test/sol-app.mjs   (Node 24)
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { backupName } from "../util.js";
import { aesKey, open as openVault, parseVault } from "../vault.js";
import { backupText as solBackupText, backupWords, KIND } from "../sol/backup.js";
import { base58 } from "../sol/docs.js";
import { loadSnap, saveSnap } from "../sol/store.js";
import { shareSeat, showSaved, solText, syncSolana } from "../sol/session.js";
import { loadRig, sleep, storage } from "./sol-rig.mjs";

const KEY_NAME = "api-key";

const rig = await loadRig();
const { t, Z, W, data, waitFor } = rig;
const sha = (text) => createHash("sha256").update(text).digest("hex");
const path = (gid, rel) => `groups/${gid}/${rel}`;
const solOf = (gid, i) => t.sec(gid, i).sol ?? {};
const PASS_Z = "correct horse battery staple 1",
  PASS_S = "another long phrase for solana 2";

async function solanaWallet(name) {
  const gid = await rig.wallet({ name });
  await t.solLoad();
  await t.sol.add();
  await waitFor(
    "every soldone",
    () => [1, 2, 3].every((i) => data.has(path(gid, "soldone/" + i))),
    30000,
  );
  return gid;
}
const saved = [];
t.setDownloads({
  save: async (file) => {
    saved.push(file);
  },
});
const words = (gid, i) =>
  backupWords(
    {
      host: { state: t.state, sec: t.sec, localSeats: t.localSeats, sealAndSave: t.sealAndSave },
      gid,
    },
    i,
  );

// ── Small pure pieces of the tab ──
assert.equal(base58("00"), "1");
assert.equal(base58("61"), "2g");
assert.equal(base58("00".repeat(32)), "1".repeat(32));
assert.equal(solText("0"), "0 SOL");
assert.equal(solText("1500000000"), "1.5 SOL");
assert.equal(solText("1"), "0.000000001 SOL");

const mainnet = await rig.wallet({ name: "Main", network: "mainnet" });
const gid = await solanaWallet("Backup");
const original = structuredClone(solOf(gid, 1));
const hashes = [1, 2, 3].map((i) => sha(solOf(gid, i).solSeed));

// ── The Zcash backup has no Solana field ──
{
  await t.putSec(gid, 1, { nonces: { abc: { sighash: "x" } } });
  const text = t.backupText(1),
    file = JSON.parse(text);
  assert.equal(file.kind, "zigs-key-share");
  assert.ok(file.secret.keyPackage, "the Zcash share is in it");
  assert.deepEqual(
    Object.keys(file.secret).filter((k) => /sol|nonce/i.test(k)),
    [],
  );
  const sol = solOf(gid, 1);
  for (const secret of [sol.solSeed, sol.groupKey, sol.keyPackage.signing_share]) {
    assert.ok(!text.includes(secret), "no Solana secret in the Zcash backup text");
  }
  assert.equal(text.includes("solSeed"), false);
  assert.ok(t.sec(gid, 1).sol, "and the seat keeps its Solana part");
}

// ── The passkey lock seals the Solana part with the rest of the secrets ──
{
  const key = await aesKey(new Uint8Array(32).fill(9));
  t.setVault({ rec: { cred: "c", salt: "s" }, key });
  await t.persistSealed();
  const stored = parseVault(storage.get("zf-vault"));
  const got = await openVault(key, stored);
  assert.deepEqual(got.secrets[gid + ":1"].sol, solOf(gid, 1), "the sealed record has sol");
  assert.ok(!JSON.stringify(stored).includes(original.solSeed), "and shows no secret");
  t.setVault(null);
  storage.delete("zf-vault");
}

// ── The second file ──
const dialog = words(gid, 1);
assert.match(dialog.title, /Solana part of seat 1/);
assert.equal(await dialog.save(PASS_S), true);
const solFile = saved.at(-1);
assert.equal(solFile.filename, backupName("Backup solana", 1));
assert.match(solFile.filename, /^zigs-Backup-solana-seat-1\.zigsbackup$/);
{
  const shell = JSON.parse(solFile.data);
  assert.equal(shell.kind, "zigs-backup", "the outer file is the one of the Zcash engine");
  for (const secret of [original.solSeed, original.keyPackage.signing_share]) {
    assert.ok(!solFile.data.includes(secret), "the file shows no secret");
  }
  const plain = JSON.parse(Z.backupOpen(PASS_S, solFile.data));
  assert.deepEqual(Object.keys(plain).sort(), [
    "cluster",
    "group",
    "groupKey",
    "groupName",
    "keyPackage",
    "kind",
    "publicKeyPackage",
    "seat",
    "solSeed",
  ]);
  assert.deepEqual(
    [plain.kind, plain.group, plain.seat, plain.cluster, plain.groupName],
    [KIND, gid, 1, "devnet", "Backup"],
  );
  assert.equal(plain.solSeed, original.solSeed);
  // Refusals of the engine: a wrong passphrase, a changed file.
  assert.throws(() => Z.backupOpen("wrong passphrase of 20 chars", solFile.data));
  const flipped = { ...shell, ct: (shell.ct[0] === "A" ? "B" : "A") + shell.ct.slice(1) };
  assert.throws(() => Z.backupOpen(PASS_S, JSON.stringify(flipped)));
  // A seat with no Solana part has nothing to back up.
  await assert.rejects(() => words(gid, 4).save(PASS_S), /no Solana part/);
}
await t.sealAndSave(PASS_Z, t.backupText(1), "zcash.zigsbackup");
const zcashFile = saved.at(-1);

// ── Wipe the seat, restore the Zcash seat, then its Solana part ──
{
  delete t.secrets[gid + ":1"];
  t.refilter();
  await sleep(200);
  assert.equal(t.localSeats().includes(1), false, "the seat is gone");
  const plainSol = JSON.parse(Z.backupOpen(PASS_S, solFile.data));
  // No seat yet: the Solana file has nothing to join.
  await assert.rejects(() => t.applyBackup(plainSol, true), /holds no seat 1/);
  await t.applyBackup(JSON.parse(Z.backupOpen(PASS_Z, zcashFile.data)), true);
  await waitFor(
    "the seat fits and its address is checked",
    () => t.localSeats().includes(1) && t.seatCheck(1) === true,
    40000,
  );
  assert.equal(solOf(gid, 1).keyPackage, undefined, "the Zcash restore brings no Solana part");
  await t.applyBackup(plainSol, true);
  assert.deepEqual(solOf(gid, 1), original, "the Solana part is back, as it was");
  assert.equal(sha(solOf(gid, 1).solSeed), hashes[0]);
  assert.match(t.banner.text, /Restored the Solana part of seat 1/);
  // Twice: the seat holds Solana data now.
  await assert.rejects(() => t.applyBackup(plainSol, true), /already has Solana data/);
}

// ── Refusals ──
{
  const good = JSON.parse(Z.backupOpen(PASS_S, solFile.data));
  const clean = async (i) => {
    delete t.sec(gid, i).sol;
    await t.putSec(gid, i, {});
  };
  await clean(2);
  assert.deepEqual(solOf(gid, 2), {});
  const refuses = (file, why, encrypted = true) =>
    assert.rejects(() => t.applyBackup(file, encrypted), why);
  // Not encrypted. Not a Solana file. A file of another curve.
  await refuses(good, /not encrypted/, false);
  await refuses({ ...good, kind: "zigs-sol-backups" }, /not a Zigs/);
  await refuses({ ...good, cluster: "mainnet" }, /not a Zigs Solana backup/);
  await refuses({ ...good, solSeed: "zz" }, /not a Zigs Solana backup/);
  await refuses({ ...good, seat: 9 }, /not a Zigs Solana backup/);
  // A file of a wallet this browser does not hold.
  await refuses({ ...good, group: "b".repeat(20) }, /holds no seat 1/);
  // A seat of this wallet that the file does not fit: the key share of seat 1 for seat 2, and the
  // keys of another wallet's ceremony under the id of this one.
  await refuses({ ...good, seat: 2 }, /does not fit this wallet/);
  const other = await solanaWallet("Other");
  const foreign = {
    ...good,
    group: gid,
    seat: 2,
    keyPackage: solOf(other, 2).keyPackage,
    publicKeyPackage: solOf(other, 2).publicKeyPackage,
    groupKey: solOf(other, 2).groupKey,
    solSeed: solOf(other, 2).solSeed,
  };
  t.openGroup(gid);
  await waitFor("wallet", () => t.state.gid === gid && t.state.wallet);
  await refuses(foreign, /does not fit this wallet/);
  // A solSeed that does not give the published address, with the right key share.
  assert.equal(solOf(gid, 2).keyPackage, undefined, "nothing was stored by the refusals");
  await refuses({ ...good, seat: 1, solSeed: "11".repeat(32) }, /already has Solana data/);
  await clean(1);
  await refuses({ ...good, solSeed: "11".repeat(32) }, /does not fit this wallet/);
  await refuses(
    { ...good, solSeed: good.solSeed.replace(/^./, (c) => (c === "a" ? "b" : "a")) },
    /does not fit this wallet/,
  );
  assert.deepEqual(solOf(gid, 1), {}, "no refusal stored anything");
  // A seat that did not settle: the restore waits for its address check, then says why.
  {
    const seat = t.sec(gid, 1),
      wallet = seat.checkedWallet;
    Object.assign(seat, { checkedWallet: null, rejectedWallet: wallet });
    assert.equal(t.seatCheck(1), false, "seat 1 is not settled");
    await refuses(good, /Seat 1 must show Address checked/);
    Object.assign(seat, { checkedWallet: wallet, rejectedWallet: null });
    assert.equal(t.seatCheck(1), true);
    assert.deepEqual(solOf(gid, 1), {}, "a seat that did not settle stores nothing");
  }
  // A damaged key share: the identifier, the group key and the published verifying share all fit,
  // and the seat would fail only at its first signature. A share of another seat is refused too.
  const damaged = (text) => text.slice(0, 5) + (text[5] === "a" ? "b" : "a") + text.slice(6);
  const withShare = (signing_share) => ({
    ...good,
    keyPackage: { ...good.keyPackage, signing_share },
  });
  const damage = /key share in this Solana backup is damaged/;
  await refuses(withShare(damaged(good.keyPackage.signing_share)), damage);
  await refuses(withShare(solOf(gid, 3).keyPackage.signing_share), damage);
  await refuses(withShare("zz".repeat(32)), damage);
  assert.deepEqual(solOf(gid, 1), {}, "no damaged file stored anything");
  // A file for a mainnet wallet is not read. The wallet is known to the page, so nothing loads.
  t.openGroup(mainnet);
  await waitFor("the mainnet wallet", () => t.state.gid === mainnet && t.state.g);
  await refuses({ ...good, group: mainnet }, /testnet wallets only/);
  assert.equal(solOf(mainnet, 1).keyPackage, undefined, "nothing was stored for it");
  t.openGroup(gid);
  await waitFor("wallet", () => t.state.gid === gid && t.state.g && t.state.wallet);
  await t.applyBackup(good, true);
  assert.deepEqual(solOf(gid, 1), original, "and for the testnet wallet it restores");
}

// ── A restore from the wallet list opens the wallet and waits for its documents ──
{
  const file3 = JSON.parse(solBackupText({ state: t.state, sec: t.sec }, gid, 3));
  const kept = structuredClone(solOf(gid, 3));
  delete t.sec(gid, 3).sol;
  await t.putSec(gid, 3, {});
  t.openGroup(null);
  await waitFor("the list", () => t.state.gid === null);
  await t.applyBackup(file3, true);
  assert.equal(t.state.gid, gid, "the restore opened the wallet");
  assert.deepEqual(solOf(gid, 3), kept, "and restored the part of seat 3");
}

// ── Leaving a wallet closes its Solana part: no watch of its documents stays open ──
{
  const watched = (id) => rig.live(`groups/${id}/sol`);
  const ids = [...data.keys()].filter((k) => /^groups\/[^/]+$/.test(k)).map((k) => k.slice(7));
  const other = ids.find((id) => id !== gid && id !== mainnet);
  assert.ok(other, "the store holds a second wallet");
  t.openGroup(gid);
  await waitFor("the watches", () => watched(gid) > 0);
  t.openGroup(null);
  assert.equal(watched(gid), 0, "the wallet list watches no Solana document");
  t.openGroup(gid);
  t.openGroup(other);
  assert.equal(watched(gid), 0, "the next wallet does not keep the watches of the last");
  // A mainnet wallet opens no Solana watch, and leaving a testnet wallet for it ends its watches.
  t.openGroup(gid);
  await waitFor("the watches again", () => watched(gid) > 0);
  t.openGroup(mainnet);
  await waitFor("the mainnet wallet", () => t.state.gid === mainnet && t.state.g);
  await sleep(50);
  assert.equal(watched(gid), 0, "a mainnet wallet leaves no watch of the last wallet");
  assert.equal(watched(mainnet), 0, "and opens none of its own");
  t.openGroup(gid);
  await waitFor("wallet", () => t.state.gid === gid && t.state.wallet);
}

// ── What the Zcash restore does with a seat that holds a Solana part ──
{
  const z = JSON.parse(t.backupText(1));
  // A held seat keeps its Solana part when its Zcash backup is restored again: the restore is a
  // patch of allowed fields, and `sol` is no allowed field.
  const before = structuredClone(solOf(gid, 1));
  await t.applyBackup(structuredClone(z), true);
  await waitFor("the restore settles", () => !t.restoreWatch.has(gid + ":1"), 20000);
  assert.deepEqual(solOf(gid, 1), before, "a second Zcash restore leaves sol as it is");
  // A Zcash file that carries a `sol` field cannot give a seat a Solana part.
  const evil = structuredClone(z);
  evil.secret.sol = { solSeed: "22".repeat(32), keyPackage: {}, groupKey: "33".repeat(32) };
  await t.applyBackup(evil, true);
  await waitFor("the restore settles", () => !t.restoreWatch.has(gid + ":1"), 20000);
  assert.deepEqual(solOf(gid, 1), before, "the allowed fields leave sol out");
  // A restore that has to be undone, on a seat that held nothing, takes the whole secret with it,
  // also a Solana part that was added while the restore waited (undoRestore). The other seat
  // holds a Solana part, so undoPlan keeps its secret.
  const A = gid,
    key = A + ":3";
  const kept = structuredClone(t.secrets[key]);
  delete t.secrets[key];
  t.secrets[key] = {
    restored: true,
    keyPackage: { identifier: "x", verifying_share: "y" },
    sol: structuredClone(kept.sol),
  };
  t.restoreWatch.set(key, {
    gid: A,
    seat: 3,
    encrypted: true,
    before: undefined,
    addedKey: false,
    where: "seat 3 of Backup",
    keys: {},
    late: {},
  });
  t.openGroup(A);
  await waitFor("the restore settles", () => !t.restoreWatch.has(key), 20000);
  assert.equal(t.secrets[key], undefined, "the whole seat secret is gone, Solana part included");
  // A seat that held a secret keeps it: undoPlan says keep.
  const held = A + ":2";
  const now = structuredClone(t.secrets[held]);
  t.restoreWatch.set(held, {
    gid: A,
    seat: 2,
    encrypted: true,
    before: now,
    addedKey: false,
    where: "seat 2 of Backup",
    keys: {},
    late: {},
  });
  assert.equal(t.undoRestore(t.restoreWatch.get(held)), false);
  assert.deepEqual(t.secrets[held], now, "a held seat stays, with its Solana part");
  t.restoreWatch.delete(held);
  t.secrets[key] = kept;
  await t.putSec(A, 3, {});
}

// ── A wallet that does not load: the restore refuses after its wait, with a clear text ──
{
  const ghost = "d".repeat(20),
    file = JSON.parse(Z.backupOpen(PASS_S, solFile.data));
  t.secrets[ghost + ":1"] = { keyPackage: { identifier: "a", verifying_share: "b" } };
  const t0 = Date.now();
  await assert.rejects(
    () => t.applyBackup({ ...file, group: ghost }, true),
    /did not load in time/,
  );
  assert.ok(Date.now() - t0 >= 19000, "it waited for the documents first");
  delete t.secrets[ghost + ":1"];
  t.openGroup(gid);
}

// ── The Worker starts only when its script carries the policy of its own ──
const POLICY =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; " +
  "connect-src 'self' https://devnet.helius-rpc.com; base-uri 'none'";
const RPC = `https://devnet.helius-rpc.com/?${KEY_NAME}=not-a-real-key`;
const realFetch = globalThis.fetch;
const serve = (policy) => async (url) => {
  assert.equal(String(url), "/sol/worker.js");
  const headers = policy ? { "content-security-policy": policy } : {};
  return new Response("export {}", { headers });
};
const syncState = (rpcUrl = RPC) => ({
  host: { localSeats: () => [1], sec: t.sec, render() {}, Z },
  W,
  gid,
  rpcUrl,
  sync: {},
});
{
  const c = syncState();
  for (const policy of [null, "default-src 'none'", POLICY.replace("'none'", "*")]) {
    globalThis.fetch = serve(policy);
    await assert.rejects(() => syncSolana(c), /did not send the policy of the Solana worker/);
    assert.match(c.sync.text, /failed: The server did not send the policy/);
  }
  globalThis.fetch = realFetch;
  // No URL from the server: the sync says so, before it asks for the Worker.
  await assert.rejects(() => syncSolana(syncState("")), /Solana is not available on this server/);
  assert.equal(JSON.stringify(c.sync).includes("not-a-real-key"), false, "no key in the state");
}

// ── The Worker gets the role secrets only, and its address must equal the wasm address ──
{
  const s1 = solOf(gid, 1),
    roles = JSON.parse(W.sol_roles(s1.solSeed, s1.groupKey));
  const right = { owner: base58(s1.groupKey), shielded: roles.address };
  const flip = (hex) => hex.replace(/^./, (ch) => (ch === "a" ? "b" : "a"));
  const sent = [];
  let init = right;
  globalThis.Worker = class {
    postMessage(msg) {
      sent.push(msg);
      const result =
        msg.cmd === "init"
          ? { hasherMs: 1, ownerHash: "00", ...init }
          : { slot: "9", balance: "0", utxos: [], storedUtxos: 0, undecryptable: 0 };
      queueMicrotask(() => this.onmessage({ data: { id: msg.id, ok: true, result } }));
    }
    terminate() {}
  };
  globalThis.fetch = serve(POLICY);
  const c = syncState();
  await syncSolana(c);
  assert.deepEqual(
    sent.map((m) => m.cmd),
    ["init", "sync"],
  );
  assert.deepEqual(
    Object.keys(sent[0].args).sort(),
    ["groupKey", "nullifierSecret", "rpcUrl", "viewingSecret"],
    "the Worker gets four fields",
  );
  assert.deepEqual(sent[0].args, {
    rpcUrl: RPC,
    nullifierSecret: roles.nullifier_secret,
    viewingSecret: roles.viewing_sk,
    groupKey: s1.groupKey,
  });
  const wire = JSON.stringify(sent);
  for (const secret of [s1.solSeed, s1.keyPackage.signing_share, "nonces"]) {
    assert.equal(wire.includes(secret), false, "no share, solSeed or nonce reaches the Worker");
  }
  assert.equal(c.sync.balance, "0 SOL");
  assert.match(c.sync.text, /synced at slot 9, the SDK address equals the wasm address/);
  await syncSolana(c);
  assert.deepEqual(
    sent.map((m) => m.cmd),
    ["init", "sync", "sync"],
    "one init for one Worker",
  );
  // A Worker that makes another shielded address, or another owner, is not used.
  for (const wrong of [
    { ...right, shielded: flip(right.shielded) },
    { ...right, owner: base58("11".repeat(32)) },
  ]) {
    init = wrong;
    sent.length = 0;
    const bad = syncState();
    await assert.rejects(() => syncSolana(bad), /another address than the wasm/);
    assert.deepEqual(
      sent.map((m) => m.cmd),
      ["init"],
      "no sync after a wrong address",
    );
    assert.match(bad.sync.text, /failed: The Solana worker made another address/);
  }
  delete globalThis.Worker;
  globalThis.fetch = realFetch;
}

// ── The sealed snapshot store ──
{
  const records = new Map();
  const fake = (result) => {
    const tx = {};
    tx.objectStore = () => ({
      put(value, key) {
        records.set(key, value);
        queueMicrotask(() => tx.oncomplete());
        return {};
      },
      get(key) {
        queueMicrotask(() => tx.oncomplete());
        return result(key);
      },
    });
    return tx;
  };
  const world = { stores: 0, name: null };
  globalThis.indexedDB = {
    open(name) {
      world.name = name;
      const req = {};
      queueMicrotask(() => {
        req.result = {
          createObjectStore() {
            world.stores++;
          },
          transaction: () =>
            fake((key) => ({
              get result() {
                return records.get(key);
              },
            })),
        };
        req.onupgradeneeded();
        req.onsuccess();
      });
      return req;
    },
  };
  const roles = JSON.parse(W.sol_roles(original.solSeed, original.groupKey));
  const snap = { slot: "123", balance: "123456789", utxos: [{ hash: "ab".repeat(32) }] };
  assert.equal(await saveSnap(Z, roles.seal_key, gid, snap), true);
  assert.deepEqual([world.name, world.stores], ["zigs-sol", 1], "its own database");
  const sealed = records.get(gid);
  assert.ok(
    typeof sealed === "string" && !sealed.includes("123456789") && !sealed.includes("abab"),
  );
  assert.deepEqual(await loadSnap(Z, roles.seal_key, gid), snap);
  // The saved snapshot is shown for a wallet that runs, and not for a stopped one.
  const shown = (stopped) => {
    const sec = (g, i) => ({ ...t.sec(g, i), sol: { ...solOf(g, i), aborted: stopped } });
    const host = { localSeats: () => [1], sec, render() {}, Z };
    return { host, W, gid, sync: {}, savedShown: false };
  };
  const free = shown(undefined),
    stopped = shown("Solana setup stopped: a test. Do not use the Solana part of this wallet.");
  assert.equal(shareSeat(free), 1, "a wallet that runs has a seat to sync");
  assert.equal(shareSeat(stopped), undefined, "a stopped wallet has none");
  await showSaved(free);
  assert.equal(free.sync.balance, "0.123456789 SOL", "control: a saved sync is shown");
  await showSaved(stopped);
  assert.deepEqual([stopped.sync, stopped.savedShown], [{}, false], "a stopped wallet shows none");
  const other = JSON.parse(W.sol_roles("44".repeat(32), original.groupKey)).seal_key;
  assert.equal(await loadSnap(Z, other, gid), null, "another seed does not open it");
  assert.equal(
    await loadSnap(Z, roles.seal_key, "e".repeat(20)),
    null,
    "no snapshot of another wallet",
  );
  records.set(gid, sealed.slice(0, -3) + "AAA");
  assert.equal(await loadSnap(Z, roles.seal_key, gid), null, "a damaged record is no snapshot");
  // A browser without IndexedDB: a fresh copy of the module has no open handle.
  delete globalThis.indexedDB;
  const bare = await import("../sol/store.js?no-indexeddb");
  assert.equal(await bare.saveSnap(Z, roles.seal_key, gid, snap), false, "no snapshot is saved");
  assert.equal(await bare.loadSnap(Z, roles.seal_key, gid), null);
}

console.log("sol-app: ok");
process.exit(0);
