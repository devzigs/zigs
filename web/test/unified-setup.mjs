// The unified setup (release item M3) against the real page modules (see sol-rig.mjs): one setup
// for Zcash testnet and Solana Devnet. The group document carries `solana: true` as a hint only.
// It changes the texts: the join card, the invite message, the safety card and the progress note
// say that the wallet has a Zcash part and a Solana part, and that every signer keeps the page
// open through both key ceremonies. A seat of such a wallet loads web/sol at the start of setup,
// and opens no Solana watch before the confirmed network. The setup card and, after the Zcash part,
// the Overview card show the Solana key and the fee address as steps. The backup note of the wallet
// asks for the Solana file of each seat too, until that file is saved. The create dialog offers the
// Solana part for a testnet wallet on a server that serves it. The choice puts solAuto into the
// secret of seat 1, whose reactor starts the Solana ceremony after the Zcash address check. The
// hint of the group document alone starts nothing.
// Run: node web/test/unified-setup.mjs   (Node 24)
import assert from "node:assert/strict";
import { config, loadRig, sleep } from "./sol-rig.mjs";

const rig = await loadRig();
// The page modules need the stub page of the rig, so they load after it.
const { SOL_DISCLOSURE, solPlanned } = await import("../app-sol.js");
const { inviteMessage, joinText } = await import("../app-setup.js");
const { backupWords } = await import("../sol/backup.js");
const { createDialog } = await import("../app-shell.js");
const { ui } = await import("../app-state.js");
const { planSolana, solSetup } = await import("../app-sol.js");
const { walletReady } = await import("../app-wallet.js");
const { PUBLIC_TEXT } = await import("../sol/view.js");
const { reactCeremony } = await import("../sol/ceremony.js");
const { t, data, waitFor } = rig;
const groupPath = (gid) => `groups/${gid}`;
const BOTH_OPEN = /Every signer keeps this wallet open until the Zcash and the Solana parts/;

// The text of the open wallet page, with a recorder in place of the document.
class Rec extends Node {
  constructor() {
    super();
    Object.assign(this, { kids: [], style: {}, attrs: {}, on: {} });
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  addEventListener(type, fn) {
    this.on[type] = fn;
  }
  append(...nodes) {
    this.kids.push(...nodes);
  }
}
const textOf = (node) => node.text ?? node.kids.map(textOf).join("");
function pageTree() {
  const real = globalThis.document;
  globalThis.document = { createElement: () => new Rec(), createTextNode: (text) => ({ text }) };
  try {
    return t.groupView();
  } finally {
    globalThis.document = real;
  }
}
const pageText = () => textOf(pageTree());
const byText = (node, text) => node.text === undefined && textOf(node) === text ? node
  : (node.kids ?? []).map((k) => byText(k, text)).find(Boolean) ?? null;

// ── The auto start, on a fake host: each gate alone keeps the start back ──
{
  const auto = (change = {}) => {
    const launched = [];
    const seat1 = { solAuto: true, keyPackage: "k", ...change.seat1 };
    const host = {
      state: { gid: "G", g: { solana: true, movedTo: null, ...change.g } },
      sec: (_gid, i) => (i === 1 ? seat1 : {}),
      localSeats: () => change.local ?? [1],
      canWriteAs: () => change.write ?? true,
      seatIds: () => [1, 2, 3],
      groupVersion: () => 3,
      network: () => change.network ?? "testnet",
      seatCheck: () => change.checked ?? true,
      safetyNo: () => "77",
      confirmedNo: () => "77",
      once: (key) => launched.push(key),
    };
    const docs = { solstart: {}, solabort: {}, ...change.docs };
    const loaded = { solstart: true, ...change.loaded };
    reactCeremony({ host, gid: "G", loaded, docs, wait: change.wait ?? 0 });
    return launched.includes("sol:solstart");
  };
  assert.equal(auto(), true, "every gate open: seat 1 starts");
  const shut = {
    "no choice in the secret of seat 1": { seat1: { solAuto: undefined } },
    "no hint in the group document": { g: { solana: undefined } },
    "a wallet that moved": { g: { movedTo: "H" } },
    "start documents not loaded": { loaded: { solstart: false } },
    "a start document exists": { docs: { solstart: { 1: { cluster: "x" } } } },
    "a start document waits for its check": { wait: 1 },
    "a stopped part": { seat1: { sol: { aborted: "Solana setup stopped: a test." } } },
    "a stop of another seat": { docs: { solabort: { 2: { reason: "A test stop." } } } },
    "a mainnet wallet": { network: "mainnet" },
    "seat 1 is not in this browser": { local: [2] },
    "seat 1 cannot write": { write: false },
    "seat 1 has no Address checked": { checked: false },
  };
  for (const [why, change] of Object.entries(shut)) assert.equal(auto(change), false, why);
}

// ── The hint: version 3 testnet wallets only ──
const g = { solana: true, network: "testnet", version: 3 };
assert.equal(solPlanned(g), true);
assert.equal(solPlanned({ ...g, network: undefined }), true, "a wallet with no network is testnet");
assert.equal(solPlanned({ ...g, network: "mainnet" }), false, "never on mainnet");
assert.equal(solPlanned({ ...g, version: 2 }), false, "version 3 only");
assert.equal(solPlanned({ ...g, solana: "yes" }), false, "only the value true");
assert.equal(solPlanned({ network: "testnet", version: 3 }), false, "no hint, no Solana");
assert.equal(solPlanned(null), false);

// ── The texts of a wallet in setup, with and without the hint ──
await t.createGroup("Both", 3, 2, null, "testnet");
const gid = t.state.gid;
await waitFor("seat 1", () => t.state.seats[1]);
const link = "https://example.test/#" + gid;
const plain = { text: pageText(), join: joinText(), invite: inviteMessage(link) };
assert.equal(t.solLoading, null, "a Zcash-only setup loads no Solana file");
assert.match(plain.text, /Every signer must keep Zigs open until setup finishes/);
assert.doesNotMatch(plain.join + plain.invite, /Solana/, "no hint: Zcash only");
data.set(groupPath(gid), { ...data.get(groupPath(gid)), solana: true });
rig.notify();
await waitFor("the hint", () => t.state.g.solana === true);
assert.equal(solPlanned(), true);
assert.match(pageText(), BOTH_OPEN, "the progress card names both parts");
assert.match(joinText(), /for Zcash testnet and Solana Devnet\. The Zcash part is shielded\./);
assert.match(joinText(), /one for Zcash and one for Solana/);
assert.match(joinText(), BOTH_OPEN);
assert.match(inviteMessage(link), /a shared wallet for Zcash testnet and Solana Devnet\./);
assert.doesNotMatch(inviteMessage(link), /shielded|private shared/, "Solana is not shielded");
assert.match(inviteMessage(link), /until the Zcash and the Solana parts are ready/);
assert.ok(inviteMessage(link).includes(link), "the invite still carries the link");
assert.match(SOL_DISCLOSURE, /public program address.*fee address.*Helius.*no audit/);
assert.ok(SOL_DISCLOSURE.includes(PUBLIC_TEXT), "the choice says what the Solana tab says");
assert.match(SOL_DISCLOSURE, /Every signer sees the whole Solana history/);
// A browser with no seat of the wallet gets the join card, with the disclosure before the seat.
{
  const kept = t.secrets[gid + ":1"];
  delete t.secrets[gid + ":1"];
  const join = pageText();
  t.secrets[gid + ":1"] = kept;
  assert.match(join, /Take seat 2/);
  assert.ok(join.includes(SOL_DISCLOSURE), "the join card says what Solana makes public");
}
// The preload: the module loads at the start of setup, and no Solana watch opens before the
// people of the wallet confirmed the network.
t.refilter();
await waitFor("the preload", () => t.solLoading !== null);
await t.solLoading;
assert.ok(t.sol, "the module loaded");
assert.equal(rig.live(`groups/${gid}/sol`), 0, "and opened no Solana watch");
// The setup card lists the two Solana steps after the three Zcash steps.
const setupText = pageText();
assert.match(setupText, /Create the Solana key.*Starts after the Zcash part\./s);
assert.match(setupText, /Fund your fee address.*Comes after the Solana key\./s);

// ── The create dialog offers Solana for a testnet wallet, on a server that serves it ──
function dialogTree(from = null) {
  const real = globalThis.document;
  globalThis.document = { createElement: () => new Rec(), createTextNode: (text) => ({ text }) };
  try {
    return createDialog(from);
  } finally {
    globalThis.document = real;
  }
}
const dialogText = () => textOf(dialogTree());
const byId = (node, id) =>
  node.attrs?.id === id ? node : (node.kids ?? []).map((k) => byId(k, id)).find(Boolean) ?? null;
{
  const CHOICE = /Also set up Solana Devnet\..*public program address/s;
  ui.net = "testnet";
  delete ui.solServed;
  assert.doesNotMatch(dialogText(), CHOICE, "not before the server answered");
  await waitFor("the answer", () => ui.solServed === true);
  assert.match(dialogText(), CHOICE);
  assert.ok("checked" in byId(dialogTree(), "g-sol").attrs, "the box is on by default");
  byId(dialogTree(), "g-sol").on.change({ target: { checked: false } }); // the person clears it
  assert.equal(ui.sol, false, "the box keeps the person's no");
  assert.ok(!("checked" in byId(dialogTree(), "g-sol").attrs), "a redraw keeps the person's no");
  ui.sol = undefined;
  // The picker offers testnet only (mainnet-off.mjs). A Change signers dialog has no choice.
  assert.doesNotMatch(textOf(dialogTree({ ...g, network: "mainnet" })), CHOICE, "never for `from`");
  config.down = true;
  delete ui.solServed;
  dialogText();
  await waitFor("the refusal", () => ui.solServed === false);
  assert.doesNotMatch(dialogText(), CHOICE, "not on a server without Solana");
  config.down = false;
  delete ui.solServed;
}

// ── The choice starts the Solana ceremony with no button, after the Zcash part ──
{
  await t.createGroup("Chosen", 3, 2, null, "testnet");
  const gidC = t.state.gid;
  await waitFor("seat 1", () => t.state.seats[1]);
  await planSolana(gidC);
  assert.equal(t.sec(gidC, 1).solAuto, true, "seat 1 keeps the choice");
  await sleep(1500);
  assert.equal(data.has(`groups/${gidC}/solstart/1`), false, "the start waits for every seat");
  assert.doesNotMatch(t.banner?.text ?? "", /Seat 1 waits/, "and shows no refusal while it waits");
  assert.equal(data.get(groupPath(gidC)).solana, true, "and the group gets the hint");
  assert.ok(!t.backupText(1).includes("solAuto"), "the Zcash backup file does not carry it");
  for (const i of [2, 3]) await t.takeSeat(i, 3);
  const checked = () => Object.keys(t.state.verify).length === 3 && t.state.wallet;
  await waitFor("wallet checked", checked);
  const done = (i) => data.has(`groups/${gidC}/soldone/${i}`);
  await waitFor("the Solana part, with no button", () => [1, 2, 3].every(done), 60000);
  assert.ok(data.has(`groups/${gidC}/solstart/1`), "seat 1 wrote the start document");
}

// ── The start waits, with no refusal, until seat 1 shows Address checked ──
{
  const gidW = await rig.wallet({ name: "Waits" });
  const seat = t.sec(gidW, 1),
    wallet = seat.checkedWallet;
  Object.assign(seat, { checkedWallet: null, rejectedWallet: wallet });
  await planSolana(gidW);
  t.refilter();
  await sleep(3500);
  assert.equal(data.has(`groups/${gidW}/solstart/1`), false, "no start before Address checked");
  assert.doesNotMatch(t.banner?.text ?? "", /Seat 1 waits/, "and no refusal before it");
  // Who starts the Solana part: seat 1 with the choice, seat 1 of a moved wallet, another seat.
  assert.match(pageText(), /Create the Solana key.*Starts when the Zcash address is checked\./s);
  t.state.g.movedTo = "elsewhere";
  assert.match(pageText(), /Tap Add Solana on the Solana tab to start it\./, "a moved wallet");
  delete t.state.g.movedTo;
  const seat1 = t.secrets[gidW + ":1"];
  delete t.secrets[gidW + ":1"];
  const other = pageText();
  t.secrets[gidW + ":1"] = seat1;
  assert.match(other, /Seat 1 starts it after the Zcash address check\./, "a browser of seat 2");
  Object.assign(seat, { checkedWallet: wallet, rejectedWallet: null });
  t.refilter();
  const done = (i) => data.has(`groups/${gidW}/soldone/${i}`);
  await waitFor("the start after Address checked", () => [1, 2, 3].every(done), 60000);
}

// ── The hint goes first: a failed write of it leaves no choice in seat 1 ──
{
  await t.createGroup("Hint fails", 3, 2, null, "testnet");
  const gidF = t.state.gid;
  await waitFor("seat 1", () => t.state.seats[1]);
  rig.hook.before = (p, v) => {
    if (p === groupPath(gidF)) throw new Error("the group server did not answer");
    return v;
  };
  await assert.rejects(() => planSolana(gidF), /did not answer/);
  assert.equal(t.sec(gidF, 1).solAuto, undefined, "no seat starts by itself");
  rig.hook.before = (_p, v) => v;
}

// ── After the Zcash part, the Overview shows the Solana steps until the fee is funded ──
{
  const gidH = await rig.wallet({ name: "Hinted" });
  data.set(groupPath(gidH), { ...data.get(groupPath(gidH)), solana: true });
  rig.notify();
  await waitFor("the hint", () => t.state.g.solana === true);
  await t.solLoad();
  // Seat 1 has no choice in its own secret (a hint that someone else wrote): it starts by hand.
  const BY_HAND = /Solana is still setting up.*Tap Add Solana on the Solana tab to start/s;
  assert.match(pageText(), BY_HAND);
  await sleep(1500);
  assert.equal(data.has(`groups/${gidH}/solstart/1`), false, "the hint alone starts nothing");
  await t.sol.add();
  // The page sees the key ceremony run, so it keeps the fee step after it (sawSetup).
  await waitFor("the ceremony on screen", () => (pageText(), solSetup()?.status === "running"));
  const done = (i) => data.has(`groups/${gidH}/soldone/${i}`);
  await waitFor("every soldone", () => [1, 2, 3].every(done), 30000);
  await waitFor("the key step", () => /one piece of the Solana key/.test(pageText()));
  // A throw in the Solana steps leaves the Zcash page as it is.
  const docsKept = t.sol.ctl.docs;
  t.sol.ctl.docs = null;
  const broken = pageText();
  t.sol.ctl.docs = docsKept;
  assert.match(broken, /Activity/, "the Overview still shows");
  assert.doesNotMatch(broken, /cannot read/);
  assert.match(pageText(), /Send Devnet SOL to your fee address on the Solana tab/);
  assert.match(pageText(), /Open the Solana tab/);
  assert.match(pageText(), /Each signer funds the fee address of their seat on their own device/);
  // The balances of the last read (refreshChain): every fee address of this browser holds SOL.
  t.sol.ctl.chain = { fees: { 1: "0.006 SOL", 2: "0.0025 SOL", 3: "0.0025 SOL" } };
  assert.doesNotMatch(pageText(), /Solana is still setting up/, "a funded part needs no card");
  t.sol.ctl.chain = { fees: { 1: "0.006 SOL", 2: "0 SOL", 3: "0.0025 SOL" } };
  assert.match(pageText(), /Solana is still setting up/, "one empty fee address keeps the card");
  t.sol.ctl.chain = {};
  // A stopped Solana part: the Zcash part still works, and the next step is a new wallet.
  const kept = t.sec(gidH, 1).sol;
  const aborted = "Solana setup stopped: a test. Do not use the Solana part of this wallet.";
  await t.putSec(gidH, 1, { sol: { ...kept, aborted } });
  const NEXT = /The Zcash part of this wallet still works\. To use Solana, create a new wallet\./;
  assert.match(pageText(), /The Solana part stopped.*The Solana setup stopped/s);
  assert.match(pageText(), NEXT);
  assert.match(pageText(), /Create a new wallet/);
  assert.ok(walletReady(), "the Zcash part is still ready");
  ui.tab = "solana";
  assert.match(pageText(), new RegExp(aborted.replace(/\./g, "\\.") + " " + NEXT.source));
  ui.tab = "overview";
  // The button leaves the wallet for the wallet list, where the create dialog shows.
  byText(pageTree(), "Create a new wallet").on.click();
  assert.equal(t.state.gid, null, "the wallet closed");
  assert.equal(ui.create, true, "the create dialog opens");
  ui.create = false;
  t.openGroup(gidH);
  await waitFor("the wallet again", () => t.state.g?.solana === true && t.state.wallet);
  // The stop card of the Solana tab has the same button.
  ui.tab = "solana";
  await waitFor("the stop card", () => byText(pageTree(), "Create a new wallet"));
  byText(pageTree(), "Create a new wallet").on.click();
  assert.equal(t.state.gid, null, "the Solana tab button closes the wallet too");
  Object.assign(ui, { create: false, tab: "overview" });
  t.openGroup(gidH);
  await waitFor("the wallet again", () => t.state.g?.solana === true && t.state.wallet);
  await t.putSec(gidH, 1, { sol: kept });
}

// ── A page that did not see the ceremony run (a reload): the fee step only on a read ──
{
  const gidR = await rig.wallet({ name: "Reloaded" });
  data.set(groupPath(gidR), { ...data.get(groupPath(gidR)), solana: true });
  rig.notify();
  await waitFor("the hint", () => t.state.g.solana === true);
  await t.solLoad();
  pageText(); // the page while the Solana documents load
  await t.sol.add();
  const done = (i) => data.has(`groups/${gidR}/soldone/${i}`);
  await waitFor("every soldone", () => [1, 2, 3].every(done), 30000);
  await waitFor("the key", () => solSetup()?.status === "ready");
  assert.doesNotMatch(pageText(), /Solana is still setting up/, "balances not read: no card");
  t.sol.ctl.chain = { fees: { 1: "0 SOL" } };
  assert.match(pageText(), /Send Devnet SOL to your fee address/, "an empty fee address: a card");
  t.sol.ctl.chain = {};
}

// ── A signed stop before the start: the Solana part shows as stopped ──
{
  const gidX = await rig.wallet({ name: "Stopped early" });
  data.set(groupPath(gidX), { ...data.get(groupPath(gidX)), solana: true });
  rig.notify();
  await waitFor("the hint", () => t.state.g.solana === true);
  await t.solLoad();
  const stop = await t.signedDoc(gidX, "solabort/2", 2, { reason: "A test stop.", at: Date.now() });
  data.set(`groups/${gidX}/solabort/2`, stop);
  rig.notify();
  await waitFor("the stop", () => solSetup()?.status === "stopped");
  assert.match(pageText(), /The Solana part stopped/);
  assert.ok(walletReady(), "the Zcash part is still ready");
}

// ── The backup note asks for the Solana file of each seat, until it is saved ──
{
  const gidS = await rig.wallet({ name: "Files" });
  await t.solLoad();
  await t.sol.add();
  const done = (i) => data.has(`groups/${gidS}/soldone/${i}`);
  await waitFor("every soldone", () => [1, 2, 3].every(done), 30000);
  const solButtons = () => pageText().match(/Back up Solana, seat \d/g) ?? [];
  await waitFor("the note", () => solButtons().length === 3);
  assert.match(pageText(), /The Solana part of a seat is a second file, with its own passphrase/);
  const saved = [];
  t.setDownloads({ save: async (file) => void saved.push(file) });
  const words = backupWords(t.sol.ctl, 2);
  assert.equal(await words.save("a long passphrase for the solana file"), true);
  assert.equal(saved.length, 1, "one file");
  assert.equal(t.sec(gidS, 2).sol.backupSaved, true);
  assert.deepEqual(solButtons(), ["Back up Solana, seat 1", "Back up Solana, seat 3"]);
  // A stop by another seat stops the Solana backups too.
  const stop = await t.signedDoc(gidS, "solabort/2", 2, { reason: "A test stop.", at: Date.now() });
  data.set(`groups/${gidS}/solabort/2`, stop);
  rig.notify();
  await waitFor("no Solana backup is asked", () => solButtons().length === 0);
}

// ── The submit: the choice reaches seat 1 only for a new wallet with the box on ──
{
  const real = globalThis.FormData;
  const submit = async (from, sol) => {
    globalThis.FormData = class {
      get(k) {
        return { name: "Submitted", n: "3", t: "2", sol }[k] ?? null;
      }
    };
    try {
      ui.net = "testnet";
      await dialogTree(from).on.submit({ preventDefault() {}, currentTarget: null, target: {} });
    } finally {
      globalThis.FormData = real;
    }
    const gidN = t.state.gid;
    return { auto: t.sec(gidN, 1)?.solAuto === true, hint: data.get(groupPath(gidN)).solana };
  };
  assert.deepEqual(await submit(null, "on"), { auto: true, hint: true }, "the box on");
  assert.deepEqual(await submit(null, null), { auto: false, hint: undefined }, "the box off");
  const old = t.state.g;
  assert.deepEqual(await submit(old, "on"), { auto: false, hint: undefined }, "Change signers");
}

console.log("unified-setup: ok");
process.exit(0);
