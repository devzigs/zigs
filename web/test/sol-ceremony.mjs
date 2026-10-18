// The second DKG on three seats, through the real page modules (see sol-rig.mjs): one browser holds
// every seat. It checks the agreement, the gates (the confirmed safety number, a version 3
// testnet wallet), a seat whose secret part does not match its commitment, the save before each
// publish, that the Zcash key and the group server hold no Solana secret, and that a stopped
// wallet stays stopped in the tab and in every action. The agreement is also checked as one seat
// sees it when each seat has a browser of its own (a document of another seat is compared, not
// fitted). The network comes first: a mainnet wallet, a wallet of unknown network, a wallet before
// version 3, and a wallet whose stored network changed after this device saw it, are offered no
// tab. A start document that no seat signed loads nothing. The page loads the module once and
// never unloads it, so these blocks run before the first load.
// Run: node web/test/sol-ceremony.mjs   (Node 24)
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { docFields } from "../signed.js";
import { newSignKey, signMsg } from "../chat.js";
import { agreement, fitsSolana, seatProgress, startBlock } from "../sol/ceremony.js";
import { backupText as solBackupText, backupWords } from "../sol/backup.js";
import { base58 } from "../sol/docs.js";
import { syncSolana } from "../sol/session.js";
import { solView } from "../sol/view.js";
import { config, loadRig, sleep, storage } from "./sol-rig.mjs";

const rig = await loadRig();
const { t, Z, W, data, waitFor } = rig;
// The page modules need the stub page of the rig, so this one loads after it.
const { confirmedNo } = await import("../app-dkg.js");
const sha = (text) => createHash("sha256").update(text).digest("hex");
const path = (gid, rel) => `groups/${gid}/${rel}`;
const dones = (gid) => [1, 2, 3].map((i) => data.get(path(gid, "soldone/" + i)));
const haveDones = (gid) => dones(gid).every(Boolean);
// The PDA identity of a soldone (ZOLANA.md 7.2): the program address and its shielded keys.
const PDA_KEYS = ["pda", "pdaNullifierPk", "pdaOwnerHash", "pdaAddress"];
const solOf = (gid, i) => t.sec(gid, i).sol ?? {};
const zcashOf = (gid, i) => {
  const { sol: _sol, ...rest } = t.sec(gid, i);
  return structuredClone(rest);
};

// Seat 1 adds Solana: the module loads, then the signed start document goes in.
async function addSolana() {
  await t.solLoad();
  await t.sol.add();
}

// The tab, as a tree of plain nodes, with the data-sol marks that it shows.
const el = (tag, attrs = {}, ...kids) => ({
  tag,
  attrs,
  kids: kids.flat(Infinity).filter(Boolean),
});
const marksOf = (node) => {
  if (typeof node !== "object") return [];
  const own = node.attrs["data-sol"] ? [node.attrs["data-sol"]] : [];
  return own.concat(node.kids.flatMap(marksOf));
};
const nodeOf = (node, mark) => {
  if (typeof node !== "object") return null;
  if (node.attrs["data-sol"] === mark) return node;
  for (const kid of node.kids) {
    const found = nodeOf(kid, mark);
    if (found) return found;
  }
  return null;
};
const faucetLink = (view) => {
  const link = nodeOf(view, "faucet");
  assert.ok(link, "the fund card has a faucet link");
  return [link.tag, link.attrs.href, link.attrs.target, link.attrs.rel];
};
const stored = (gid, name) =>
  Object.fromEntries(
    [1, 2, 3]
      .map((i) => [i, data.get(path(gid, name + "/" + i))])
      .filter(([, d]) => d)
      .map(([i, d]) => [i, docFields(d)]),
  );
const tabState = (gid, hostSec) => ({
  host: {
    el,
    W,
    Z,
    state: t.state,
    seatIds: () => [1, 2, 3],
    localSeats: () => [1, 2, 3],
    canWriteAs: () => true,
    sec: hostSec ?? t.sec,
    seatCheck: t.seatCheck,
    safetyNo: t.safetyNo,
    confirmedNo,
    sealAndSave: t.sealAndSave,
    groupVersion: () => 3,
    network: () => "testnet",
    render() {},
  },
  W,
  gid,
  docs: {
    solstart: stored(gid, "solstart"),
    soldkg1: stored(gid, "soldkg1"),
    soldkg2: {},
    soldone: stored(gid, "soldone"),
  },
  sync: {},
  wait: 0,
});
const noActions = { add() {}, sync() {}, backup() {}, restoreFile() {} };
const KEY_MARKS = ["owner", "group-key", "shielded", "sync", "restore", "backup-1"];
const STOP_TEXT = "Solana setup stopped: a test. Do not use the Solana part of this wallet.";
const STOP = /Solana setup stopped: .*Do not use the Solana part of this wallet/;

const nodesOf = (node, pick) =>
  typeof node !== "object"
    ? []
    : [...(pick(node) ? [node] : []), ...node.kids.flatMap((kid) => nodesOf(kid, pick))];

// Each Copy button sits in the dd of its value, has a name for a screen reader and copies that
// value. A dd of its own would take the place of a label in the two-column list (S15).
async function copiesItsValue(view, done) {
  const dds = nodesOf(view, (n) => n.tag === "dd");
  const notes = ["pay-to", "custody-text"];
  const [dl] = nodesOf(view, (n) => n.tag === "dl" && n.attrs.class === "kv");
  dl.kids.forEach((kid, at) => {
    const note = notes.includes(kid.attrs["data-sol"]);
    assert.ok(kid.tag !== "dd" || note || dl.kids[at - 1].tag === "dt", "a dd with no label");
  });
  const expected = [
    ["owner", "copy-program", base58(done.pda), "Copy the program address"],
    ["shielded", "copy-shielded", done.pdaAddress, "Copy the shielded address"],
  ];
  const copied = [];
  const clipboard = { writeText: async (text) => void copied.push(text) };
  const nav = globalThis.navigator;
  Object.defineProperty(nav, "clipboard", { value: clipboard, configurable: true });
  for (const [mark, copy, value, label] of expected) {
    const dd = dds.find((n) => nodeOf(n, mark));
    assert.equal(plain(nodeOf(dd, mark)), value, mark + " shows its value");
    const button = nodeOf(dd, copy);
    assert.ok(button, copy + " sits in the dd of " + mark);
    assert.equal(button.attrs["aria-label"], label);
    const target = { textContent: "Copy" };
    await button.attrs.onclick({ currentTarget: target });
    assert.equal(copied.pop(), value, copy + " copies the value of " + mark);
    assert.equal(target.textContent, "Copied");
  }
}
const plain = (node) => (typeof node === "object" ? node.kids.map(plain).join("") : String(node));

// A stopped wallet stays stopped when the documents agree again: the tab shows no key, no sync
// and no backup, and the sync, the backup, the restore and a new start all refuse. `lost` is the
// seat that loses its Solana part for the restore: it must not be the one that holds the stop.
async function stoppedEverywhere(gid, lost = 1) {
  const c = tabState(gid);
  assert.equal(agreement(c).state, "agree", "the documents agree again");
  const shown = marksOf(solView(c, (f) => f, noActions));
  assert.ok(shown.includes("status") && shown.includes("stopped"), "the stop is shown");
  assert.ok(shown.includes("public-text"), "a started wallet shows what is public too");
  for (const mark of [...KEY_MARKS, "add", "backup-2", "backup-3", "balance-private"]) {
    assert.ok(!shown.includes(mark), "a stopped wallet shows no " + mark);
  }
  // Control: the same documents and secrets without the stop show them all.
  const free = (g, i) => {
    const { aborted: _aborted, ...rest } = t.sec(g, i).sol ?? {};
    return { ...t.sec(g, i), sol: rest };
  };
  const control = solView(tabState(gid, free), (f) => f, noActions);
  const open = marksOf(control);
  for (const mark of KEY_MARKS) assert.ok(open.includes(mark), "the control shows " + mark);
  assert.deepEqual(
    faucetLink(control),
    ["a", "https://faucet.solana.com/", "_blank", "noopener"],
    "the fund card links to the Devnet faucet in a new tab",
  );
  await copiesItsValue(control, agreement(c).done);
  // The sync refuses before it starts the Worker or makes a request.
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => assert.fail("no request while the wallet is stopped");
  try {
    await assert.rejects(() => syncSolana(c), STOP);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(c.sync, {}, "the sync did not even start");
  assert.throws(() => backupWords(c, 1), STOP);
  // A dialog that was opened before the stop must refuse to save after it.
  let stoppedNow = false;
  const racing = (g, i) => (stoppedNow ? t.sec(g, i) : free(g, i));
  const dialog = backupWords(tabState(gid, racing), 1);
  stoppedNow = true;
  await assert.rejects(() => dialog.save("a passphrase of enough length 1"), STOP);
  await assert.rejects(() => t.sol.add(), STOP);
  // A backup of a seat that lost its Solana part must not restore into a stopped wallet.
  const file = JSON.parse(solBackupText({ state: t.state, sec: t.sec }, gid, lost));
  const kept = structuredClone(solOf(gid, lost));
  delete t.sec(gid, lost).sol;
  await t.putSec(gid, lost, {});
  await assert.rejects(() => t.applyBackup(file, true), STOP);
  assert.deepEqual(solOf(gid, lost), {}, "the refused restore stored nothing");
  t.sec(gid, lost).sol = kept;
  await t.putSec(gid, lost, {});
}

// The Solana part of seat `i` with the stop text, or without it.
function withStop(gid, i, stopped) {
  const { aborted: _aborted, ...rest } = solOf(gid, i);
  return stopped ? { ...rest, aborted: STOP_TEXT } : rest;
}

// The text of the open wallet page, with a recorder in place of the document. The page builds the
// network note into it when the store shows another network: the text is in the page or it is not.
class Rec extends Node {
  constructor() {
    super();
    Object.assign(this, { kids: [], style: {} });
  }
  setAttribute() {}
  addEventListener() {}
  append(...nodes) {
    this.kids.push(...nodes);
  }
}
const textOf = (node) => node.text ?? node.kids.map(textOf).join("");
function pageText() {
  const real = globalThis.document;
  globalThis.document = { createElement: () => new Rec(), createTextNode: (text) => ({ text }) };
  try {
    return textOf(t.groupView());
  } finally {
    globalThis.document = real;
  }
}
const NETWORK_NOTE = /The store shows another network than the first this browser saw/;

// ── Only a testnet wallet gets the tab, and a start document of another loads nothing ──
// The ids of the tabs that the open wallet offers (the page builds them in walletView).
function tabIds() {
  let ids;
  const real = t.tabBar;
  t.tabBar = (tabs) => ((ids = tabs.map(([id]) => id)), real(tabs));
  try {
    t.walletView([], null);
  } catch (e) {
    // The tab bar is built before the tab body, which needs a wallet document that a wallet
    // made by hand does not have. A wallet with a wallet document must build all of it.
    if (!ids || t.state.wallet) throw e;
  } finally {
    t.tabBar = real;
  }
  return ids;
}
{
  const gidMain = await rig.wallet({ name: "Main", network: "mainnet" });
  const fields = { cluster: "devnet", at: Date.now() };
  data.set(path(gidMain, "solstart/1"), await t.signedDoc(gidMain, "solstart/1", 1, fields));
  rig.notify();
  t.openGroup(gidMain);
  await waitFor("the wallet", () => t.state.gid === gidMain && t.state.g);
  await sleep(50);
  const watched = rig.live(`groups/${gidMain}/sol`);
  assert.equal(t.solOn(), false, "a mainnet wallet is off");
  assert.equal(watched, 0, "a mainnet wallet watches no Solana document");
  assert.equal(t.solLoading, null, "a start document does not load Solana");
  assert.ok(!tabIds().includes("solana"), "the Solana tab is hidden");
  // A network that is not exactly "testnet" is not testnet: the value is not trusted by default.
  const loaded = t.state.g;
  for (const network of [undefined, "", "Testnet", "devnet", " testnet", null]) {
    t.state.g = { ...loaded, network };
    assert.equal(t.solOn(), false, "network " + JSON.stringify(network) + " is off");
    assert.ok(!tabIds().includes("solana"), "no tab for network " + JSON.stringify(network));
  }
  t.state.g = loaded;
  // A wallet that is not loaded yet is off too.
  t.state.g = null;
  assert.equal(t.solOn(), false, "a wallet that is not loaded is off");
  t.state.g = loaded;
  // The stored network is no signed fact: a holder of the wallet link writes "testnet" into the
  // group document of the mainnet wallet. The device keeps the first network that it saw.
  const groupPath = `groups/${gidMain}`;
  data.set(groupPath, { ...data.get(groupPath), network: "testnet" });
  rig.notify();
  await sleep(100);
  assert.equal(t.state.g.network, "mainnet", "the page keeps the first network");
  assert.equal(t.state.g.networkMoved, true, "and says that the store shows another");
  assert.match(pageText(), NETWORK_NOTE, "the page of a flipped mainnet wallet says so");
  assert.equal(t.signPins["network:" + gidMain], "mainnet");
  assert.equal(JSON.parse(storage.get("zf-signpins"))["network:" + gidMain], "mainnet");
  assert.equal(t.solOn(), false, "a flipped mainnet wallet is off");
  assert.ok(!tabIds().includes("solana"), "a flipped mainnet wallet gets no tab");
  assert.equal(t.solLoading, null, "a start document does not load Solana for it");
  assert.equal(rig.live(`groups/${gidMain}/sol`), 0, "it opens no Solana watch");
  assert.equal(config.calls, 0, "and the page never asks the server for the Helius URL");
}

// A flip before the first load (SOL-34). A device that never opened the wallet has no pin, as
// every device before the beta, so the first network that it sees is the one a holder of the link
// wrote. The page takes the network from the safety number that the person of a seat of this
// device confirmed, and the Solana tab needs that network.
{
  const groupPath = (gid) => `groups/${gid}`;
  const flip = (gid, network) => {
    data.set(groupPath(gid), { ...data.get(groupPath(gid)), network });
    rig.notify();
  };
  // A device that never opened the wallet since the beta: no network pin, in memory or in
  // storage. With `all`, no pin of the wallet at all: its seat keys, version and shape too.
  const forget = (gid, all = false) => {
    const ours = (k) => all ? k.startsWith(gid + ":") || k.endsWith(":" + gid)
      : k === "network:" + gid || k === "confirmednet:" + gid;
    const stored = JSON.parse(storage.get("zf-signpins"));
    for (const k of Object.keys(t.signPins).filter(ours)) delete t.signPins[k];
    for (const k of Object.keys(stored).filter(ours)) delete stored[k];
    storage.set("zf-signpins", JSON.stringify(stored));
  };
  // `chain` stands for a sync that started on the first network seen.
  const reopen = async (gid, chain) => {
    t.openGroup("");
    await sleep(50);
    t.openGroup(gid);
    if (chain) t.setChain(chain);
    assert.equal(t.solOn(gid), false, "no tab before the wallet document is in");
    await waitFor("the wallet", () => t.state.gid === gid && t.state.g && t.state.wallet);
    const tab = tabIds().includes("solana");
    assert.ok(!tab || t.netConfirmed(gid) === "testnet", "no tab before the network is confirmed");
  };
  const stored = () => JSON.parse(storage.get("zf-signpins"));

  // A mainnet wallet. The device that made it learns its network from the confirmed number.
  const late = await rig.wallet({ name: "Late", network: "mainnet" });
  assert.equal(t.netConfirmed(late), "mainnet", "control: the confirmed network is mainnet");
  t.openGroup("");
  await sleep(50);
  forget(late);
  flip(late, "testnet");
  await sleep(100);
  // The rig has no wallet list: one entry, as the list of the page shows a wallet.
  const list = t.state.groups;
  t.state.groups = [{ id: late, name: "Late", network: "testnet" }];
  const early = { gid: late, syncing: true, cw: null };
  await reopen(late, early);
  await waitFor("the confirmed network", () => t.netConfirmed(late) === "mainnet");
  assert.notEqual(t.chain, early, "the sync on the first network seen stops");
  const firstSeen = (gid) => t.signPins["network:" + gid];
  assert.equal(firstSeen(late), "testnet", "the first network seen is the flipped one");
  assert.equal(stored()["confirmednet:" + late], "mainnet", "the confirmed network is saved");
  assert.deepEqual([t.state.g.network, t.state.g.networkMoved], ["mainnet", true]);
  assert.equal(t.state.groups[0].network, "mainnet", "also in the list");
  t.state.groups = list;
  assert.match(pageText(), NETWORK_NOTE, "the page says that the store shows another network");
  assert.equal(t.solOn(), false, "a mainnet wallet flipped before the first load is off");
  assert.ok(!tabIds().includes("solana"), "and gets no tab");
  assert.equal(rig.live(`groups/${late}/sol`), 0, "and opens no Solana watch");

  // A seat without the number it confirmed, as after a restore: its own signed confirm document
  // gives the network.
  for (const i of [1, 2, 3]) await t.putSec(late, i, { confirmed: null });
  t.openGroup("");
  await sleep(50);
  forget(late);
  await reopen(late);
  await waitFor("the confirmed network", () => t.netConfirmed(late) === "mainnet");
  assert.equal(t.state.g.network, "mainnet", "the signed confirm document names mainnet");

  // A confirm document without a valid signature is no confirmation, even with the number of the
  // flipped network: the device keeps the first network that it saw and gets no tab.
  const real = [1, 2, 3].map((i) => data.get(path(late, "confirm/" + i)));
  const forged = t.safetyNo("testnet");
  assert.ok(forged && forged !== t.safetyNo(), "the testnet number differs");
  for (const i of [1, 2, 3]) data.set(path(late, "confirm/" + i), { number: forged });
  t.openGroup("");
  await sleep(50);
  forget(late);
  await reopen(late);
  await sleep(300);
  assert.equal(t.netConfirmed(late), undefined, "a forged confirm document confirms nothing");
  assert.equal(t.state.g.network, "testnet", "the first network seen stays");
  assert.equal(t.solOn(), false, "a network that nobody confirmed is off");
  assert.ok(!tabIds().includes("solana"), "and gets no tab");
  assert.equal(rig.live(`groups/${late}/sol`), 0, "and opens no Solana watch");
  real.forEach((d, at) => data.set(path(late, "confirm/" + (at + 1)), d));
  rig.notify();
  await waitFor("the confirmed network", () => t.netConfirmed(late) === "mainnet");
  assert.deepEqual([t.state.g.network, t.state.g.networkMoved], ["mainnet", true]);
  assert.equal(t.solOn(), false, "the real documents confirm mainnet");
  assert.equal(config.calls, 0, "the page never asks the server for the Helius URL");
  // A wallet with an empty seat has no safety number yet, and a seat without a number confirms
  // nothing: no number is no match.
  const seats = t.state.seats;
  t.state.seats = { 1: seats[1] };
  assert.equal(t.safetyNo(), null, "no safety number with an empty seat");
  assert.equal(t.confirmedNetwork(), null, "and no confirmed network");
  t.state.seats = seats;
  // Numbers of own seats that name both networks confirm neither.
  await t.putSec(late, 1, { confirmed: t.safetyNo() });
  data.set(path(late, "confirm/1"), await t.signedDoc(late, "confirm/1", 1, { number: forged }));
  rig.notify();
  await waitFor("both networks match", () => t.confirmedNetwork() === null, 5000);
  await t.putSec(late, 1, { confirmed: null });
  data.set(path(late, "confirm/1"), real[0]);
  rig.notify();
  // A holder of the link replaces the document of an own seat before the first load: a new key
  // signs it, and the confirm document of the seat with the testnet number. The device pins the
  // new key, but only the key in the seat secret of this device counts.
  const fresh = await newSignKey();
  const sealed = async (rel, fields) => ({ ...fields, by: 2,
    sig: await signMsg(fresh.signSk, Z.docPayload(late, rel, 2, JSON.stringify(fields))) });
  const { by: _by, sig: _sig, ...seat2 } = data.get(path(late, "seats/2"));
  data.set(path(late, "seats/2"), await sealed("seats/2", { ...seat2, signPk: fresh.signPk }));
  data.set(path(late, "confirm/2"), await sealed("confirm/2", { number: forged }));
  for (const i of [1, 3]) data.delete(path(late, "confirm/" + i));
  t.openGroup("");
  await sleep(50);
  forget(late, true);
  await reopen(late);
  await sleep(500);
  assert.equal(t.signPins[late + ":2"], fresh.signPk, "the device pinned the new key of seat 2");
  assert.equal(t.netConfirmed(late), undefined, "the replaced seat confirms nothing");
  assert.equal(t.solOn(), false, "a mainnet wallet with a replaced seat is off");
  assert.ok(!tabIds().includes("solana"), "and gets no tab");

  // A testnet wallet flipped to mainnet before the first load keeps its tab, and the watch of its
  // start document comes after the network is confirmed.
  const kept = await rig.wallet({ name: "Kept" });
  t.openGroup("");
  await sleep(50);
  forget(kept);
  flip(kept, "mainnet");
  await sleep(100);
  await reopen(kept);
  await waitFor("the confirmed network", () => t.netConfirmed(kept) === "testnet");
  assert.equal(firstSeen(kept), "mainnet", "the first network seen is the flipped one");
  assert.deepEqual([t.state.g.network, t.state.g.networkMoved], ["testnet", true]);
  assert.equal(t.solOn(), true, "the confirmed testnet wallet is on");
  assert.ok(tabIds().includes("solana"), "and keeps its tab");
  await waitFor("the start watch", () => rig.live(`groups/${kept}/solstart`) === 1);
  assert.equal(t.solLoading, null, "no start document, so nothing loads");
  // The first network seen is the confirmed one: a sync that started on it goes on.
  t.openGroup("");
  await sleep(50);
  flip(kept, "testnet");
  forget(kept);
  const same = { gid: kept, syncing: true, cw: null };
  await reopen(kept, same);
  await waitFor("the confirmed network", () => t.netConfirmed(kept) === "testnet");
  assert.equal(t.chain, same, "the sync on the confirmed network goes on");

  // A new device restores a seat. A holder of the link wrote version 2, testnet and unsigned
  // confirm documents with the testnet number before, so the device first reads the documents as
  // a wallet before version 3. The restore then makes the seat version 3: the unsigned documents
  // must not count, and version 3 again does not turn the tab on.
  const down = await rig.wallet({ name: "Down", network: "mainnet" });
  const downTest = t.safetyNo("testnet");
  const file = JSON.parse(t.backupText(2));
  t.openGroup("");
  await sleep(50);
  for (const i of [1, 2, 3]) delete t.secrets[down + ":" + i];
  forget(down, true);
  data.set(groupPath(down), { ...data.get(groupPath(down)), version: 2, network: "testnet" });
  for (const i of [1, 2, 3]) data.set(path(down, "confirm/" + i), { number: downTest });
  rig.notify();
  await t.applyBackup(structuredClone(file), true);
  await sleep(2500);
  data.set(groupPath(down), { ...data.get(groupPath(down)), version: 3 });
  rig.notify();
  await sleep(1500);
  assert.notEqual(t.netConfirmed(down), "testnet", "unsigned documents confirm no network");
  assert.equal(t.solOn(down), false, "the restored mainnet wallet is off");
  if (t.state.gid === down) assert.ok(!tabIds().includes("solana"), "and gets no tab");

  // Seats in setup on a device that opens a flipped mainnet wallet for the first time: no step
  // compares the safety number of the flipped network, so no seat stops or confirms it.
  const setup = await rig.wallet({ name: "Setup", network: "mainnet" });
  const setupNo = t.safetyNo();
  t.openGroup("");
  await sleep(50);
  for (const i of [1, 2, 3]) delete t.secrets[setup + ":" + i].keyPackage;
  forget(setup);
  flip(setup, "testnet");
  await reopen(setup);
  await sleep(1500);
  const seatsOf = (f) => [1, 2, 3].map((i) => f(t.secrets[setup + ":" + i], i));
  assert.deepEqual(seatsOf((s) => s.aborted ?? null), [null, null, null], "no seat stops");
  assert.deepEqual(seatsOf((s) => s.confirmed === setupNo), [true, true, true]);
  assert.deepEqual(seatsOf((_s, i) => data.get(path(setup, "confirm/" + i)).number === setupNo),
    [true, true, true], "no confirm document gets the testnet number");
  assert.equal(t.state.g.network, "mainnet");
  t.openGroup("");
  await sleep(50);
}

// A wallet before version 3 never gets the tab: the Solana ceremony needs signed documents. The
// store can show another version or network, and neither turns it on.
{
  const v2 = "v2walletaaaaaaaaaaaa";
  const made = (network) => ({ name: "Old", n: 3, t: 2, version: 2, network, createdBy: "x" });
  const open = async (id, doc) => {
    data.set(`groups/${id}`, doc);
    rig.notify();
    t.openGroup(id);
    await waitFor("the wallet", () => t.state.gid === id && t.state.g);
    await sleep(50);
  };
  await open(v2, made("mainnet"));
  assert.equal(t.signedMode(v2), false, "a version 2 wallet");
  data.set(`groups/${v2}`, made("testnet"));
  rig.notify();
  await sleep(100);
  assert.deepEqual([t.state.g.network, t.state.g.networkMoved], ["mainnet", true]);
  assert.match(pageText(), NETWORK_NOTE, "the page of a flipped version 2 wallet says so");
  assert.equal(t.solOn(), false, "a flipped version 2 wallet is off");
  assert.ok(!tabIds().includes("solana"), "a flipped version 2 wallet gets no tab");
  // A version 2 wallet on testnet that nobody changed: the version alone keeps it off.
  const v2test = "v2testbbbbbbbbbbbbbb";
  await open(v2test, made("testnet"));
  assert.equal(t.state.g.networkMoved, false, "nothing moved");
  assert.doesNotMatch(pageText(), NETWORK_NOTE, "and the page of a wallet that did not move");
  assert.equal(t.solOn(), false, "a version 2 testnet wallet is off");
  assert.ok(!tabIds().includes("solana"), "a version 2 testnet wallet gets no tab");
  // The version is no signed fact either: raised to 3, the wallet still has no signed writes.
  data.set(`groups/${v2test}`, { ...made("testnet"), version: 3 });
  rig.notify();
  await sleep(100);
  assert.equal(t.state.g.version, 3, "the store shows version 3");
  assert.equal(t.solOn(), false, "a version 2 wallet that shows version 3 is off");
  assert.ok(!tabIds().includes("solana"), "and gets no tab");
  // A network that this device could not read at first sight is no network to keep.
  const odd = "oddnetcccccccccccccc";
  await open(odd, made("devnet"));
  assert.equal(t.signPins["network:" + odd], undefined, "an unknown network is not pinned");
  assert.equal(t.solOn(), false);
  assert.equal(t.solLoading, null, "a version 2 wallet loads nothing");
  assert.equal(config.calls, 0, "and asks the server for nothing");
}

// ── A wallet that never asks for Solana loads none of it ──
const gid = await rig.wallet({ name: "Team" });
assert.ok(tabIds().includes("solana"), "control: a testnet wallet is offered the Solana tab");
assert.doesNotMatch(pageText(), NETWORK_NOTE, "control: no note for a wallet that did not move");
{
  // The stored version of a version 3 wallet can be lowered: the tab goes with it.
  const shown = t.state.g;
  for (const version of [2, 1, undefined, 4]) {
    t.state.g = { ...shown, version };
    assert.equal(t.solOn(), false, "version " + version + " is off");
  }
  t.state.g = shown;
  assert.equal(t.solOn(), true, "control: version 3 is on");
}
// The watch of the start document gets its snapshot, and the snapshot has no document.
rig.notify();
await sleep(50);
assert.equal(t.solLoading, null, "a testnet wallet with no start document: no load");
assert.equal(t.sol, null, "the tab is closed and there is no start document");
const zcash = [1, 2, 3].map((i) => zcashOf(gid, i));
// The start card says what is public and what Helius sees (SOL-12).
{
  const none = { solstart: {}, soldkg1: {}, soldkg2: {}, soldone: {} };
  // The tree holds null children, which textOf does not take: the JSON holds every text.
  const start = JSON.stringify(solView({ ...tabState(gid), docs: none }, (f) => f, noActions));
  assert.match(start, /A deposit shows its sender and amount on chain\. A withdrawal shows/);
  assert.match(start, /A private payment hides its amount, but it shows the owner key of/);
  const running = { ...none, solstart: { 1: { cluster: "devnet" } } };
  const setup = marksOf(solView({ ...tabState(gid), docs: running }, (f) => f, noActions));
  assert.ok(setup.includes("seat-1") && setup.includes("public-text"), "the setup shows it too");
}

// ── A start document that no seat signed loads nothing ──
// Any holder of the wallet link can write one. The page loads the module only when seat 1 signed
// it, so a document without a signature, with a false one, or signed by another seat does not.
{
  const fields = { cluster: "devnet", at: Date.now() };
  const forged = {
    "no signature": fields,
    "a made-up signature": { ...fields, by: 1, sig: "A".repeat(88) },
    "a signature of another seat": await t.signedDoc(gid, "solstart/1", 2, fields),
    "a signature over other fields": {
      ...(await t.signedDoc(gid, "solstart/1", 1, fields)),
      at: fields.at + 1,
    },
  };
  for (const [what, doc] of Object.entries(forged)) {
    data.set(path(gid, "solstart/1"), doc);
    rig.notify();
    await sleep(400);
    assert.equal(t.solLoading, null, what + ": the page does not load Solana");
    assert.equal(config.calls, 0, what + ": the page does not ask for the Helius URL");
    assert.ok(tabIds().includes("solana"), "the tab still shows for the testnet wallet");
  }
  data.delete(path(gid, "solstart/1"));
  rig.notify();
}

// ── Seats 2 and 3 load the module by themselves when the start document appears ──
{
  // Another seat wrote it: this browser did not click anything.
  const fields = { cluster: "devnet", at: Date.now() };
  data.set(path(gid, "solstart/1"), await t.signedDoc(gid, "solstart/1", 1, fields));
  rig.notify();
  await waitFor("the module", () => t.sol, 20000);
  await waitFor("every soldone", () => haveDones(gid), 30000);
}
{
  const gid2 = await rig.wallet({ name: "Second" });
  await addSolana();
  await waitFor("every soldone", () => haveDones(gid2), 30000);
  await sleep(300);
  const docs = dones(gid2);
  const keep = (k) => new Set(docs.map((d) => JSON.stringify(d[k])));
  for (const k of [
    "groupKey",
    "publicKeyPackage",
    "nullifierPk",
    "viewingPk",
    "address",
    "cluster",
    "program",
    ...PDA_KEYS,
  ])
    assert.equal(keep(k).size, 1, k + " is equal on every seat");
  assert.deepEqual(
    docs.map((d) => d.by),
    [1, 2, 3],
    "each soldone names its writer",
  );
  // One group key, one solSeed (compared by hash, never printed), and a key share for each seat.
  const s = [1, 2, 3].map((i) => solOf(gid2, i));
  assert.equal(new Set(s.map((x) => sha(x.solSeed))).size, 1, "equal solSeed");
  assert.equal(new Set(s.map((x) => x.groupKey)).size, 1, "equal group key");
  assert.equal(new Set(s.map((x) => JSON.stringify(x.keyPackage))).size, 3, "key shares differ");
  assert.equal(s[0].groupKey, docs[0].groupKey);
  const roles = JSON.parse(W.sol_roles(s[0].solSeed, s[0].groupKey));
  assert.deepEqual(
    [roles.address, roles.nullifier_pk, roles.viewing_pk],
    [docs[0].address, docs[0].nullifierPk, docs[0].viewingPk],
    "the document has the wasm roles",
  );
  const pda = JSON.parse(W.sol_pda_roles(s[0].solSeed, s[0].groupKey));
  assert.deepEqual(
    PDA_KEYS.map((k) => docs[0][k]),
    [pda.pda, pda.nullifier_pk, pda.owner_hash, pda.address],
    "the document has the PDA identity of the wasm",
  );
  assert.ok(!JSON.stringify(docs).includes(pda.nullifier_secret), "and not its nullifier secret");
  // A restore fits the key share against the soldone, the PDA identity too when it names one.
  const fit = (done) => fitsSolana(W, 1, s[0], docFields(done));
  assert.equal(fit(docs[0]), true, "the control: the share fits its soldone");
  for (const k of PDA_KEYS) {
    const wrong = { ...docs[0], [k]: docs[0][k].replace(/^./, (x) => (x === "a" ? "b" : "a")) };
    assert.equal(fit(wrong), false, "a soldone with another " + k + " does not fit");
  }
  const bare = Object.fromEntries(Object.entries(docs[0]).filter(([k]) => !PDA_KEYS.includes(k)));
  assert.equal(fit(bare), true, "a soldone from before the program design fits");
  // The round secrets are gone, and nothing but key data is left.
  for (const x of s) {
    assert.deepEqual(Object.keys(x).sort(), [
      "cluster",
      "doneSent",
      "groupKey",
      "keyPackage",
      "publicKeyPackage",
      "solSeed",
    ]);
  }
  // Each seat has its own fee key, derived from its key share: three different keys, and the
  // secret part of the seat stores none of them.
  const fees = s.map((x) => JSON.parse(W.sol_fee_key(JSON.stringify(x.keyPackage))));
  assert.equal(new Set(fees.map((f) => f.public)).size, 3, "a fee key for each seat");
  // The documents on the server hold no secret, and the Zcash part is as it was.
  const published = JSON.stringify([...data].filter(([k]) => k.startsWith(path(gid2, "sol"))));
  for (const x of s) {
    assert.ok(!published.includes(x.solSeed), "no solSeed in a document");
    assert.ok(!published.includes(x.keyPackage.signing_share), "no key share in a document");
  }
  for (const f of fees) assert.ok(!published.includes(f.secret), "no fee secret in a document");
  for (const f of fees) assert.ok(published.includes(f.public), "the fee key is published");
  const roleSecrets = [roles.nullifier_secret, roles.viewing_sk, roles.seal_key];
  for (const secret of roleSecrets) assert.ok(!published.includes(secret), "no role secret");
  assert.equal(t.state.ignored, 0, "an honest wallet ignores nothing");
  // The boxes of round 2 carry the curve label: they open in the Solana context, not the Zcash one.
  const box = data.get(path(gid2, "soldkg2/1-2")).sealed;
  const sk = t.sec(gid2, 2).boxSk,
    pk = t.sec(gid2, 1).boxPk;
  const inside = JSON.parse(Z.boxOpen(sk, pk, gid2 + ":sol:1->2", box));
  assert.deepEqual(Object.keys(inside).sort(), ["package", "r"]);
  assert.throws(() => Z.boxOpen(sk, pk, gid2 + ":1->2", box), "a Zcash context does not open it");
  assert.notEqual(inside.r, undefined);
  // The seat secret holds Solana in one sub-object, and the plain store carries it with the rest.
  const stored = JSON.parse(storage.get("zf-secrets"));
  assert.deepEqual(stored[gid2 + ":1"].sol.solSeed, s[0].solSeed);
  // The agreement of every soldone, and what it refuses.
  const host = { seatIds: () => [1, 2, 3], localSeats: () => [1, 2, 3], sec: t.sec };
  const view = (list) => ({
    host,
    W,
    gid: gid2,
    docs: { soldone: Object.fromEntries(list.map((d, i) => [i + 1, d])) },
  });
  const plain = docs.map(docFields);
  assert.equal(agreement(view(plain)).state, "agree");
  // The label is the one of the wasm, which a seat compares with: a seat whose wasm names other
  // program ids does not agree with documents that carry this label.
  assert.equal(docs[0].program, W.sol_program_label(), "the document has the wasm label");
  const otherWasm = { ...W, sol_program_label: () => "zolana-devnet:other" };
  assert.equal(agreement({ ...view(plain), W: otherWasm }).state, "differ", "another label");
  const relabelled = plain.map((d) => ({ ...d, program: "zolana-devnet:other" }));
  assert.equal(
    agreement({ ...view(relabelled), W: otherWasm }).state,
    "agree",
    "same label, other wasm",
  );
  assert.equal(agreement(view(plain.slice(0, 2))).state, "wait");
  const change = {
    groupKey: "1".repeat(64),
    nullifierPk: "2".repeat(64),
    viewingPk: "3".repeat(66),
    address: "4".repeat(198),
    cluster: "mainnet",
    program: "other",
    publicKeyPackage: docs[1].publicKeyPackage.replace("verifying_key", "verifying_kez"),
    pda: "5".repeat(64),
    pdaNullifierPk: "6".repeat(64),
    pdaOwnerHash: "7".repeat(64),
    pdaAddress: "8".repeat(198),
  };
  for (const [k, v] of Object.entries(change)) {
    const one = plain.map((d, i) => (i === 2 ? { ...d, [k]: v } : d));
    assert.equal(agreement(view(one)).state, "differ", "one soldone with another " + k);
  }
  const alike = plain.map((d) => ({ ...d, address: "4".repeat(198) }));
  assert.equal(agreement(view(alike)).state, "differ", "equal documents that this seat cannot fit");
  const alikePda = plain.map((d) => ({ ...d, pdaOwnerHash: "7".repeat(64) }));
  assert.equal(agreement(view(alikePda)).state, "differ", "an equal PDA that this seat cannot fit");
  // A soldone from before the program design names no PDA identity: the seats agree, and the
  // agreed keys carry the PDA identity of the other documents, or of the share of this browser.
  const oldThird = plain.map((d, i) => (i === 2 ? bare : d));
  assert.equal(agreement(view(oldThird)).state, "agree", "one soldone of before");
  assert.equal(agreement(view(oldThird)).done.pdaAddress, pda.address);
  const allOld = plain.map(() => bare);
  assert.equal(agreement(view(allOld)).done.pdaOwnerHash, pda.owner_hash, "from the share");
  const half = plain.map((d, i) => (i === 2 ? { ...bare, pda: d.pda } : d));
  assert.equal(agreement(view(half)).state, "differ", "a soldone with a part of the PDA identity");
  // A browser whose own soldone names no PDA identity checks the one that another seat names.
  const soloOne = { ...view(plain), host: { ...host, localSeats: () => [1] } };
  const named = plain.map((d, i) => (i === 1 ? { ...d, pdaNullifierPk: "6".repeat(64) } : bare));
  const misfit = agreement({ ...soloOne, ...view(named), host: soloOne.host });
  assert.equal(misfit.state, "differ", "a PDA identity that the share here does not give");
  assert.match(misfit.why, /PDA identity of the documents does not fit/);
  const fitting = plain.map((d, i) => (i === 1 ? d : bare));
  assert.equal(agreement({ ...view(fitting), host: soloOne.host }).state, "agree", "the control");
  // A browser with no seat fits no document: equal documents with a malformed PDA still differ.
  const none = { ...view(plain), host: { ...host, localSeats: () => [] } };
  assert.equal(agreement(none).state, "agree", "the control: no seat, honest documents");
  const malformed = plain.map((d) => ({ ...d, pdaAddress: "zz" }));
  const state = agreement({ ...view(malformed), host: none.host }).state;
  assert.equal(state, "differ", "equal documents with a malformed PDA");
  // Each seat in a browser of its own: the browser holds seat `mine` only, so the document of
  // another seat is not fitted against a secret. Only the comparison of the documents can find
  // that seat `other` published something else, in any of the compared fields.
  for (const mine of [1, 2, 3]) {
    const alone = { ...host, localSeats: () => [mine] };
    const solo = (list) => ({ ...view(list), host: alone });
    assert.equal(agreement(solo(plain)).state, "agree", "seat " + mine + " alone, honest");
    for (const other of [1, 2, 3].filter((j) => j !== mine)) {
      for (const [k, v] of Object.entries(change)) {
        const one = plain.map((d, i) => (i === other - 1 ? { ...d, [k]: v } : d));
        const state = agreement(solo(one)).state;
        assert.equal(state, "differ", `seat ${mine} alone: seat ${other} has another ${k}`);
      }
    }
  }
  // A seat that lost its setup secret after it published round 1 tells its person.
  const lost = (sol) => ({
    host: { seatIds: () => [1, 2, 3], localSeats: () => [1], sec: () => ({ sol }) },
    gid: "g",
    docs: { soldone: {}, soldkg1: { 1: {} }, soldkg2: {} },
  });
  assert.match(seatProgress(lost({}), 1), /this browser lost its setup secret/);
  assert.equal(seatProgress(lost({ r1secret: "x" }), 1), "Seat 1: round 1 sent");
  assert.equal(seatProgress(lost({}), 2), "Seat 2 has not started");
  // The seat of a soldone from before the program design publishes it again with the PDA
  // identity, and nothing stops.
  {
    const before = docFields(data.get(path(gid2, "soldone/3")));
    const fields = Object.fromEntries(
      Object.entries(before).filter(([k]) => !PDA_KEYS.includes(k)),
    );
    const signed = await t.signedDoc(gid2, "soldone/3", 3, { ...fields, at: before.at + 1 });
    data.set(path(gid2, "soldone/3"), signed);
    rig.notify();
    const again = () => data.get(path(gid2, "soldone/3"));
    await waitFor("the soldone with the PDA identity", () => again().pda === pda.pda, 20000);
    assert.deepEqual(
      PDA_KEYS.map((k) => again()[k]),
      PDA_KEYS.map((k) => before[k]),
      "the same PDA identity",
    );
    assert.equal(again().groupKey, before.groupKey, "the rest of the document stays");
    assert.ok([1, 2, 3].every((i) => !solOf(gid2, i).aborted), "no seat stopped");
  }
  // A seat that signs its soldone again with another label stops every seat, and it stays so.
  const old = docFields(data.get(path(gid2, "soldone/3")));
  const other = await t.signedDoc(gid2, "soldone/3", 3, {
    ...old,
    program: "other",
    at: old.at + 1,
  });
  data.set(path(gid2, "soldone/3"), other);
  rig.notify();
  await waitFor("every seat stopped", () => [1, 2, 3].every((i) => solOf(gid2, i).aborted), 20000);
  const again = await t.signedDoc(gid2, "soldone/3", 3, { ...old, at: old.at + 2 });
  data.set(path(gid2, "soldone/3"), again);
  rig.notify();
  await sleep(600);
  for (const i of [1, 2, 3]) {
    assert.match(solOf(gid2, i).aborted, /different Solana keys/, "seat " + i + " stays stopped");
  }
  await stoppedEverywhere(gid2);
  // Each seat alone: stopOf reads every seat of this browser, the first one too.
  for (const stopped of [1, 2, 3]) {
    for (const i of [1, 2, 3]) {
      await t.putSec(gid2, i, { sol: withStop(gid2, i, i === stopped) });
    }
    await stoppedEverywhere(gid2, stopped === 1 ? 2 : 1);
  }
}
// ── One stopped seat stops the Solana part of this wallet, whichever seat it is ──
for (const stopped of [1, 2, 3]) {
  const gidW = await rig.wallet({ name: "Wide " + stopped });
  await t.putSec(gidW, stopped, { sol: { aborted: STOP_TEXT } });
  await t.solLoad();
  // Seat 1 signed the start document. The seats do not go on while one seat is stopped.
  const fields = { cluster: "devnet", at: Date.now() };
  data.set(path(gidW, "solstart/1"), await t.signedDoc(gidW, "solstart/1", 1, fields));
  rig.notify();
  await sleep(1500);
  const started = [1, 2, 3].filter((i) => data.has(path(gidW, "soldkg1/" + i)));
  assert.deepEqual(started, [], "stopped seat " + stopped + ": no seat starts");
  for (const i of [1, 2, 3].filter((j) => j !== stopped)) {
    assert.deepEqual(solOf(gidW, i), {}, `stopped seat ${stopped}: seat ${i} made no secret`);
  }
  await assert.rejects(() => t.sol.add(), STOP);
}
// The Zcash part of the first wallet is as it was before the Solana ceremony ran there.
assert.deepEqual(
  [1, 2, 3].map((i) => zcashOf(gid, i)),
  zcash,
  "the Zcash key is not touched",
);
assert.deepEqual(
  zcash.map((z) => Object.keys(z).includes("sol")),
  [false, false, false],
);

// ── A seat refuses to start without the safety number that its person confirmed ──
{
  const gid3 = await rig.wallet({ name: "Third" });
  const confirmed = t.sec(gid3, 2).confirmed;
  assert.match(confirmed, /\d/, "the seat confirmed a number");
  await t.putSec(gid3, 2, { confirmed: "00000 00000 00000" });
  await addSolana();
  await waitFor(
    "seat 1 and 3 start",
    () => data.has(path(gid3, "soldkg1/1")) && data.has(path(gid3, "soldkg1/3")),
    20000,
  );
  await sleep(1200);
  assert.equal(data.has(path(gid3, "soldkg1/2")), false, "seat 2 writes nothing");
  assert.deepEqual(solOf(gid3, 2), {}, "seat 2 made no Solana secret");
  assert.equal(haveDones(gid3), false);
  await t.putSec(gid3, 2, { confirmed });
  t.refilter();
  await waitFor("every soldone", () => haveDones(gid3), 30000);
}

// ── Restored seats join the Solana ceremony ──
// A restore does not take the confirmed number from the file. Seats 1 and 2 restore before the
// Solana part exists, and their own signed confirm documents let them start.
{
  const gidR = await rig.wallet({ name: "Restored" });
  const files = [1, 2].map((i) => JSON.parse(t.backupText(i)));
  for (const i of [1, 2]) delete t.secrets[gidR + ":" + i];
  t.refilter();
  await sleep(200);
  for (const file of files) await t.applyBackup(structuredClone(file), true);
  const restored = (i) => t.localSeats().includes(i) && t.seatCheck(i) === true;
  await waitFor("seats 1 and 2 restored and checked", () => restored(1) && restored(2), 40000);
  for (const i of [1, 2]) {
    assert.equal(t.sec(gidR, i).confirmed, undefined, "a restore takes no confirmed number");
  }
  // With no confirm document of its own, a restored seat says why it waits. A document without a
  // valid signature of its own key confirms nothing: unsigned, or the document of seat 1 laid
  // under seat 2.
  await t.solLoad();
  const doc = data.get(path(gidR, "confirm/2"));
  const why = "Seat 2 waits: this browser has not confirmed the safety number.";
  const unsigned = { number: t.safetyNo() };
  for (const bad of [null, unsigned, data.get(path(gidR, "confirm/1"))]) {
    if (bad) data.set(path(gidR, "confirm/2"), bad);
    else data.delete(path(gidR, "confirm/2"));
    rig.notify();
    await sleep(300);
    const forged = "a forged confirm document starts no Solana seat";
    assert.equal(seatProgress(t.sol.ctl, 2), why, forged);
  }
  data.set(path(gidR, "confirm/2"), doc);
  rig.notify();
  await sleep(300);
  assert.equal(seatProgress(t.sol.ctl, 2), "Seat 2 has not started");
  // A seat that keeps another number: the safety number changed after it confirmed.
  await t.putSec(gidR, 2, { confirmed: "00000 00000 00000" });
  const moved = "Seat 2 waits: the safety number changed after this browser confirmed it.";
  assert.equal(seatProgress(t.sol.ctl, 2), moved);
  await t.putSec(gidR, 2, { confirmed: null });
  // The same for a restored seat whose own confirm document holds an older number.
  const doc2 = data.get(path(gidR, "confirm/2"));
  const old = await t.signedDoc(gidR, "confirm/2", 2, { number: "00000 00000 00000" });
  data.set(path(gidR, "confirm/2"), old);
  rig.notify();
  await sleep(300);
  assert.equal(seatProgress(t.sol.ctl, 2), moved, "an old number of its own document: changed");
  data.set(path(gidR, "confirm/2"), doc2);
  rig.notify();
  await sleep(300);
  // Seat 1 says why it cannot add Solana yet.
  const doc1 = data.get(path(gidR, "confirm/1"));
  data.delete(path(gidR, "confirm/1"));
  rig.notify();
  await sleep(300);
  await assert.rejects(() => t.sol.add(), /^Error: Seat 1 waits: this browser has not confirmed/);
  data.set(path(gidR, "confirm/1"), doc1);
  rig.notify();
  await sleep(300);
  await addSolana();
  await waitFor("every soldone", () => haveDones(gidR), 30000);
}

// ── Two copies of one seat: the lease of round 1 lets only one of them publish ──
{
  const gidL = await rig.wallet({ name: "Lease" });
  rig.hook.lease = (p) => !p.endsWith("/soldkg1/2");
  await addSolana();
  const started = () => data.has(path(gidL, "soldkg1/1")) && data.has(path(gidL, "soldkg1/3"));
  await waitFor("seat 1 and 3 start", started, 20000);
  await sleep(1200);
  assert.equal(data.has(path(gidL, "soldkg1/2")), false, "the other copy holds the lease");
  assert.deepEqual(solOf(gidL, 2), {}, "and seat 2 made no Solana secret");
  rig.hook.lease = () => true;
  t.refilter();
  await waitFor("every soldone", () => haveDones(gidL), 30000);
}

// ── A seat retries round 1 under its own lease ──
// The lease as the group server keeps it: the same holder renews, another one waits for the end.
{
  const gidH = await rig.wallet({ name: "Holder" });
  const leases = new Map();
  rig.hook.lease = (p, o) => {
    const cur = leases.get(p),
      now = Date.now();
    if (cur && cur.until > now && cur.holder !== o.holder) return false;
    leases.set(p, { holder: o.holder, until: now + o.ttlMs });
    return true;
  };
  let failOnce = true;
  rig.hook.before = (p, v) => {
    if (!failOnce || !p.endsWith("/soldkg1/2")) return v;
    failOnce = false;
    throw new Error("the group server did not answer");
  };
  await addSolana();
  const again = () => data.has(path(gidH, "soldkg1/2"));
  await waitFor("its own lease does not block the retry of round 1", again, 20000);
  rig.hook.before = (_p, v) => v;
  rig.hook.lease = () => true;
  await waitFor("every soldone", () => haveDones(gidH), 30000);
}

// ── A round-1 secret that another copy of the seat published differently takes no part ──
{
  const gidS = await rig.wallet({ name: "Stale" });
  rig.hook.lease = (p) => !p.endsWith("/soldkg1/2");
  await addSolana();
  const started = () => data.has(path(gidS, "soldkg1/1")) && data.has(path(gidS, "soldkg1/3"));
  await waitFor("seat 1 and 3 start", started, 20000);
  // The other copy of seat 2 publishes its round 1. This copy holds another, unpublished secret.
  const [n, k] = [t.state.g.n, t.state.g.t];
  const other = JSON.parse(W.sol_dkg1(2, n, k)),
    mine = JSON.parse(W.sol_dkg1(2, n, k));
  const commit = W.sol_commit(gidS, 2, t.state.seats[2].boxPk, "devnet", "ab".repeat(32));
  const fields = { package: other.package, commit, at: Date.now() };
  data.set(path(gidS, "soldkg1/2"), await t.signedDoc(gidS, "soldkg1/2", 2, fields));
  const sol = { r1secret: mine.secret, r1package: mine.package, rSol: "cd".repeat(32) };
  await t.putSec(gidS, 2, { sol: { ...sol, cluster: "devnet" } });
  rig.hook.lease = () => true;
  rig.notify();
  await waitFor("the stale secret goes", () => !solOf(gidS, 2).r1secret, 20000);
  await sleep(1500);
  const wrote = [1, 3].some((j) => data.has(path(gidS, "soldkg2/2-" + j)));
  assert.equal(wrote, false, "a stale round-1 secret takes no part");
  const elsewhere =
    "Seat 2: another device of this seat runs its Solana setup. This browser takes no part.";
  assert.equal(seatProgress(t.sol.ctl, 2), elsewhere);
  // Only the mark stays, so the backup of the finished copy restores into this seat later.
  assert.deepEqual(solOf(gidS, 2), { otherCopy: true }, "the dropped part keeps only its mark");
  assert.equal([1, 2, 3].some((i) => solOf(gidS, i).aborted), false, "and nothing stops");
  // A seat of a wallet that is not the open one waits for it.
  const shut = { ...tabState(gid), docs: { solstart: {}, soldkg1: {}, soldkg2: {}, soldone: {} } };
  assert.notEqual(t.state.gid, gid);
  assert.equal(seatProgress(shut, 1), "Seat 1 waits: open its wallet.");
}

// ── A seat whose Zcash part has not settled does not start ──
{
  const gid3b = await rig.wallet({ name: "Settle" });
  const wk = JSON.stringify(t.state.wallet);
  // This browser holds the verdict of every seat: seat 2 has none that counts yet.
  await t.putSec(gid3b, 2, { checkedWallet: null, rejectedWallet: wk });
  await addSolana();
  await waitFor(
    "seat 1 and 3 start",
    () => data.has(path(gid3b, "soldkg1/1")) && data.has(path(gid3b, "soldkg1/3")),
    20000,
  );
  await sleep(1200);
  assert.equal(data.has(path(gid3b, "soldkg1/2")), false, "seat 2 writes nothing");
  assert.deepEqual(solOf(gid3b, 2), {}, "seat 2 made no Solana secret");
  await t.putSec(gid3b, 2, { checkedWallet: wk, rejectedWallet: null });
  t.refilter();
  await waitFor("every soldone", () => haveDones(gid3b), 30000);
}

// ── A seat whose secret part does not match its commitment ends the others ──
{
  const gid4 = await rig.wallet({ name: "Fourth" });
  // Seat 2 signs a commitment for another part: a signed document, so the readers keep it.
  rig.hook.before = async (p, v) => {
    if (!p.endsWith("/soldkg1/2")) return v;
    return t.signedDoc(gid4, "soldkg1/2", 2, { ...docFields(v), commit: "f".repeat(64) });
  };
  await addSolana();
  const stopped = () => [1, 2, 3].every((i) => solOf(gid4, i).aborted);
  await waitFor("every seat stopped", stopped, 30000);
  rig.hook.before = (_p, v) => v;
  for (const i of [1, 2, 3]) {
    const s = solOf(gid4, i);
    assert.match(s.aborted, /seat 2: the secret part does not match its commitment/);
    assert.match(s.aborted, /Do not use the Solana part/);
    assert.equal(s.keyPackage, undefined, "no key share without the check");
  }
  assert.equal(dones(gid4).some(Boolean), false, "nobody published soldone");
  // The Zcash part of this wallet works on.
  assert.ok(t.sec(gid4, 1).keyPackage);
}

// ── A document that changes after round 2 ends the seats (the echo) ──
{
  const gid4b = await rig.wallet({ name: "Echo" });
  let changed = false;
  rig.hook.before = async (p, v) => {
    if (changed || !p.includes("/soldkg2/")) return v;
    changed = true;
    // Seat 2 signs another round-1 document after the others saw the first one.
    const old = docFields(data.get(path(gid4b, "soldkg1/2")));
    const fields = { ...old, commit: "ab".repeat(32), at: old.at + 1 };
    data.set(path(gid4b, "soldkg1/2"), await t.signedDoc(gid4b, "soldkg1/2", 2, fields));
    rig.notify();
    return v;
  };
  await addSolana();
  await waitFor("every seat stopped", () => [1, 2, 3].every((i) => solOf(gid4b, i).aborted), 30000);
  rig.hook.before = (_p, v) => v;
  for (const i of [1, 2, 3]) {
    assert.match(solOf(gid4b, i).aborted, /different setup data/);
    assert.equal(solOf(gid4b, i).keyPackage, undefined);
  }
}

// ── Another seat signs another echo: the seats that saw the real one stop ──
{
  const gidE = await rig.wallet({ name: "EchoPeer" });
  // Seats 1 and 3 hold a consistent view of their own, so only the echo of seat 2 can stop them.
  rig.hook.before = async (p, v) => {
    const rel = p.split(`groups/${gidE}/`)[1];
    if (!rel?.startsWith("soldkg2/2-")) return v;
    return t.signedDoc(gidE, rel, 2, { ...docFields(v), echo: "00".repeat(32) });
  };
  await addSolana();
  // A seat ends in one of two ways: it stops, or it makes its key share. A seat that did not check
  // the echo of seat 2 makes one, and the assertions below fail at once, not after a long wait.
  const decided = (i) => !!(solOf(gidE, i).aborted || solOf(gidE, i).keyPackage);
  await waitFor("seats 1 and 3 decide", () => [1, 3].every(decided), 40000);
  rig.hook.before = (_p, v) => v;
  for (const i of [1, 3]) {
    assert.equal(solOf(gidE, i).keyPackage, undefined, `seat ${i} made a key share`);
    assert.match(solOf(gidE, i).aborted, /different setup data.*seat 2/, "seat " + i);
  }
}

// ── A browser with seat 1 only: seat 1 stops when the soldone of seat 3 differs ──
{
  const gidA = await rig.wallet({ name: "Alone" });
  await addSolana();
  await waitFor("every soldone", () => haveDones(gidA), 30000);
  await sleep(300);
  const old = docFields(data.get(path(gidA, "soldone/3")));
  const honest = data.get(path(gidA, "soldone/3"));
  const changes = {
    address: "4".repeat(198),
    nullifierPk: "2".repeat(64),
    viewingPk: "3".repeat(66),
    publicKeyPackage: old.publicKeyPackage.replace("verifying_key", "verifying_kez"),
  };
  // Sign every forged document of seat 3 first, then drop the secrets of seats 2 and 3: those
  // seats live in other browsers. Only the documents can tell seat 1 that seat 3 differs.
  const forged = {};
  for (const [k, v] of Object.entries(changes)) {
    forged[k] = await t.signedDoc(gidA, "soldone/3", 3, { ...old, [k]: v, at: old.at + 1 });
  }
  const mine = t.secrets[gidA + ":1"].sol;
  for (const i of [2, 3]) delete t.secrets[gidA + ":" + i];
  t.refilter();
  await sleep(300);
  assert.deepEqual(t.localSeats(), [1], "this browser holds seat 1 only");
  for (const [k, doc] of Object.entries(forged)) {
    data.set(path(gidA, "soldone/3"), doc);
    rig.notify();
    await waitFor("seat 1 stops on " + k, () => solOf(gidA, 1).aborted, 20000);
    assert.match(solOf(gidA, 1).aborted, /different Solana keys/, k);
    // The honest document comes back and the stop is lifted by hand, to try the next field.
    data.set(path(gidA, "soldone/3"), honest);
    await t.putSec(gidA, 1, { sol: structuredClone(mine) });
    rig.notify();
    await sleep(500);
    assert.equal(solOf(gidA, 1).aborted, undefined, "the honest documents do not stop seat 1");
  }
}

// ── A document that another key signed counts as missing: the seats wait, then go on ──
{
  const gid5 = await rig.wallet({ name: "Fifth" });
  let forged = true;
  rig.hook.before = async (p, v) => {
    if (!forged || !p.endsWith("/soldkg1/2")) return v;
    await sleep(200);
    return { ...v, sig: v.sig.slice(0, -4) + "AAAA" };
  };
  await addSolana();
  await waitFor(
    "seats 1 and 3 round 1",
    () => data.has(path(gid5, "soldkg1/1")) && data.has(path(gid5, "soldkg1/3")),
    20000,
  );
  await sleep(800);
  assert.equal(
    [1, 2, 3].some((i) => solOf(gid5, i).aborted),
    false,
    "no seat stops",
  );
  assert.equal(
    [1, 2, 3].some((i) => data.has(path(gid5, "soldkg2/" + i + "-" + ((i % 3) + 1)))),
    false,
    "no seat goes on to round 2 while the document of seat 2 is not signed",
  );
  forged = false;
  await waitFor("every soldone", () => haveDones(gid5), 30000);
}

// ── A Zcash box cannot open in the Solana context ──
{
  const gid6 = await rig.wallet({ name: "Sixth" });
  const [from, to] = [1, 2],
    zbox = t.state.dkg2[from + "-" + to].sealed;
  const sk = t.sec(gid6, to).boxSk,
    pk = t.state.seats[from].boxPk;
  assert.doesNotThrow(
    () => Z.boxOpen(sk, pk, gid6 + ":" + from + "->" + to, zbox),
    "the Zcash box",
  );
  assert.throws(() => Z.boxOpen(sk, pk, gid6 + ":sol:" + from + "->" + to, zbox));
  const sealed = Z.boxSeal(
    t.sec(gid6, from).boxSk,
    t.state.seats[to].boxPk,
    gid6 + ":sol:" + from + "->" + to,
    "{}",
  );
  assert.throws(() => Z.boxOpen(sk, pk, gid6 + ":" + from + "->" + to, sealed));
}

// ── A version 2 wallet and a mainnet wallet get no Solana ──
{
  const host = (version, network) => ({ groupVersion: () => version, network: () => network });
  assert.match(startBlock(host(2, "testnet")), /version 3/);
  assert.match(startBlock(host(1, "testnet")), /version 3/);
  assert.match(startBlock(host(3, "mainnet")), /Devnet only/);
  assert.equal(startBlock(host(3, "testnet")), null);
  const gid7 = await rig.wallet({ name: "Main", network: "mainnet" });
  await t.solLoad();
  await assert.rejects(() => t.sol.add(), /Devnet only/);
  // A start document that seat 1 signed anyway starts nobody.
  const fields = { cluster: "devnet", at: Date.now() };
  data.set(path(gid7, "solstart/1"), await t.signedDoc(gid7, "solstart/1", 1, fields));
  rig.notify();
  await sleep(1500);
  assert.equal(
    [1, 2, 3].some((i) => data.has(path(gid7, "soldkg1/" + i))),
    false,
  );
  assert.equal(
    [1, 2, 3].some((i) => t.sec(gid7, i).sol !== undefined),
    false,
  );
}

// ── Round 1 saves the secret before it publishes ──
{
  const gid8 = await rig.wallet({ name: "Eighth" });
  await t.solLoad();
  const real = localStorage.setItem;
  localStorage.setItem = (k, v) => {
    if (k === "zf-secrets") throw new Error("disk full");
    return real(k, v);
  };
  await t.sol.add();
  await sleep(1500);
  const none = [1, 2, 3].every((i) => !data.has(path(gid8, "soldkg1/" + i)));
  assert.ok(none, "no round 1 document while the secret cannot be saved");
  for (const i of [1, 2, 3]) assert.equal(solOf(gid8, i).r1secret, undefined);
  localStorage.setItem = real;
  await waitFor("the retry finishes the ceremony", () => haveDones(gid8), 40000);
}

console.log("sol-ceremony: ok");
process.exit(0);
