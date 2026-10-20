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
import { readFileSync } from "node:fs";
import { config, loadRig, sleep, storage } from "./sol-rig.mjs";

const rig = await loadRig();
// The page modules need the stub page of the rig, so they load after it.
const { SOL_DISCLOSURE, solPlanned, solServed } = await import("../app-sol.js");
const { inviteMessage, joinText, onLink } = await import("../app-setup.js");
const { chatLink, chatMessage, inviteLink } = await import("../app-links.js");
const { diagnostics } = await import("../app-help.js");
const { chatInviteCard } = await import("../app-thread.js");
const { chats } = await import("../app-keystore.js");
const { chat: roomChat } = await import("../app-messages.js");
const { backupWords } = await import("../sol/backup.js");
const { loadingCount, olderCount, pendingCount, pendingRows } = await import("../sol/view.js");
const { SHOWN } = await import("../sol/payview.js");
const { createDialog, endCreate, lobby, marginText, renderSide } = await import("../app-shell.js");
const { receiveDialog } = await import("../app-send.js");
const { offReason } = await import("../util.js");
const { quickCode } = await import("../setup-model.js");
const { intentHex } = await import("../sol/intent.js");
const { ui } = await import("../app-state.js");
const appState = await import("../app-state.js");
const { planSolana, solFile, solOn, solSetup, solUnsaved } = await import("../app-sol.js");
const { backupNote, walletReady, walletShown } = await import("../app-wallet.js");
const { PUBLIC_TEXT } = await import("../sol/view.js");
const { reactCeremony } = await import("../sol/ceremony.js");
const { netName, spanMs } = await import("../app-chain.js");
const { t, data, waitFor } = rig;
const groupPath = (gid) => `groups/${gid}`;
const BOTH_OPEN = /Every device keeps this wallet open until the Zcash and the Solana parts/;

// The text of the open wallet page, with a recorder in place of the document.
class Rec extends Node {
  constructor(tag) {
    super();
    Object.assign(this, { tag, kids: [], style: {}, attrs: {}, on: {} });
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  removeAttribute(k) {
    delete this.attrs[k];
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
  globalThis.document = { createElement: (tag) => new Rec(tag), createElementNS: () => new Rec(),
    createTextNode: (text) => ({ text }), documentElement: { dataset: {} } };
  try {
    return t.groupView();
  } finally {
    globalThis.document = real;
  }
}
const pageText = () => textOf(pageTree());
const h3Texts = (node) => [...(node.tag === "h3" ? [textOf(node)] : []),
  ...(node.kids ?? []).flatMap(h3Texts)];
const findNode = (node, pred) => pred(node) ? node
  : (node.kids ?? []).map((k) => findNode(k, pred)).find(Boolean) ?? null;
const findAll = (node, pred) =>
  [...(pred(node) ? [node] : []), ...(node.kids ?? []).flatMap((k) => findAll(k, pred))];
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

// ── S6: the Solana proposals that a seat of this browser can still approve ──
// The count follows the Approve button of the tab: it needs agreeing documents, a part that
// did not stop, a proposal that the app can show and sign, and a seat that holds a share and a
// signing key and gave no approval yet. The side item and the Solana tab show it.
const proposal = (id, change = {}) => ({
  id,
  status: "collecting",
  by: 1,
  intent: intentHex("createNonce", { blockhash: "11".repeat(32) }),
  createdAt: Date.now(),
  message: "ab".repeat(8),
  feeSig: "00".repeat(64),
  ...change,
});
const labelled = (node, label) =>
  node.attrs?.["aria-label"] === label ||
  (node.kids ?? []).some((kid) => labelled(kid, label));
const shellParts = { ".main": {}, ".skip-link": {}, ".logo": {} };
function sideTree() {
  const real = globalThis.document;
  const nav = new Rec();
  nav.replaceChildren = (...nodes) => void (nav.kids = nodes);
  const fake = { createElement: () => new Rec(), createElementNS: () => new Rec(),
    createTextNode: (text) => ({ text }) };
  const side = { classList: { toggle() {} } };
  globalThis.document = { ...fake, getElementById: () => nav,
    querySelector: (sel) => shellParts[sel] ?? side };
  try {
    renderSide();
    return nav;
  } finally {
    globalThis.document = real;
  }
}
// The Overview reads the Solana part of the open wallet: its balance, the age of its sync, and
// the proposals to approve (two here).
function overviewWiring(ctl) {
  const { tab } = t.ui, sync = ctl.sync;
  t.ui.tab = "overview";
  try {
    ctl.sync = { balance: "1.25 SOL", text: "synced at slot 7, x", busy: false };
    assert.match(pageText(), /1\.25\s*SOL.*at the last sync\./, "the SOL row shows the balance");
    assert.match(pageText(), /2 Solana proposals wait for your approval\./, "the shortcut");
    byText(pageTree(), "Review").on.click();
    assert.equal(t.ui.tab, "approvals", "Review opens the Approvals inbox");
    t.ui.tab = "overview";
    ctl.sync = { ...ctl.sync, text: "failed: offline" };
    assert.match(pageText(), /The last sync failed/, "an old balance says so");
    ctl.sync = { balance: null, text: "", busy: false };
    assert.match(pageText(), /Not synced yet/);
    const loaded = ctl.loaded;
    ctl.loaded = {};
    assert.match(pageText(), /SOL.*Loading…/, "no state before the Solana documents arrive");
    ctl.loaded = loaded;
  } finally {
    Object.assign(ctl, { sync });
    t.ui.tab = tab;
  }
}
// The Approvals inbox of the open wallet: the Solana line counts the two proposals, and the empty
// card never says that nothing waits while the payments are unknown.
function inboxWiring() {
  const { tab } = t.ui, kept = { ...t.state };
  t.ui.tab = "approvals";
  try {
    const review = findNode(pageTree(), (n) => n.attrs?.["aria-label"] === "Needs your approval");
    const rowOf = (id) => findNode(review, (n) => n.attrs?.["data-key"] === "sol-" + id);
    const rows = ["a", "b"].map(rowOf);
    assert.ok(rows.every(Boolean), "one row for each Solana proposal that waits here");
    assert.match(textOf(rows[0]), /^↗Create the nonce account for the moveSolana Devnet/);
    assert.match(textOf(rows[0]), /Proposed by you/, "a seat of this browser reads you");
    assert.equal(textOf(findNode(review, (n) => n.className === "badge plain")), "2",
      "the review bucket counts each proposal");
    assert.equal(t.solPendingRows().length, t.solPending(), "the rule of the count");
    rows[0].on.click();
    assert.equal(t.ui.tab, "solana", "a row opens the Solana section");
    t.ui.tab = "approvals";
    assert.match(pageText(), /The wallet syncs\. .*Needs your approval/,
      "before the first sync of the chain, the note shows next to the rows");
    Object.assign(t.state, { sessions: [], sessionsFailed: true });
    assert.match(pageText(), /could not be read/, "a failed read");
    Object.assign(t.state, { sessionsFailed: false, sessionsLoaded: false });
    assert.match(pageText(), /Checking the payments of this wallet/, "not arrived yet");
    Object.assign(t.state, { sessionsLoaded: true, pending: true });
    assert.match(pageText(), /Checking the payments of this wallet/, "a check is open");
    Object.assign(t.state, { pending: false });
    assert.doesNotMatch(pageText(), /Checking the payments|could not be read/);
  } finally {
    Object.assign(t.state, { sessions: kept.sessions, sessionsFailed: kept.sessionsFailed,
      sessionsLoaded: kept.sessionsLoaded, pending: kept.pending });
    t.ui.tab = tab;
  }
}
// The Recovery section reads the saved flag of each seat, and the Solana file of a stopped share
// is no file; a note for the Solana file alone is plain while the part sets up.
function recoveryFacts() {
  const real = t.secrets;
  const k = Object.keys(real)
    .find((key) => key.startsWith(t.state.gid + ":") && real[key].keyPackage);
  const seat = Number(k.split(":").pop());
  const with_ = (patch) => ({ ...real, [k]: { ...real[k], ...patch } });
  // The row of the seat: its files, and the two buttons with their full names.
  const row = () => findNode(pageTree(), (n) => n.className === "member recovery-row");
  const labels = (n) => (n.kids ?? []).flatMap(labels)
    .concat(n.attrs?.["aria-label"] ? [n.attrs["aria-label"]] : []);
  try {
    t.secrets = with_({ backupSaved: false });
    assert.match(textOf(row()), new RegExp("Device " + seat + "Zcash file not saved"));
    t.secrets = with_({ backupSaved: true });
    assert.match(textOf(row()), new RegExp("Device " + seat + "Zcash file saved here"));
    assert.ok(labels(row()).includes("Back up the Zcash part of device " + seat));
    t.secrets = with_({ backupSaved: true, restored: true });
    assert.match(textOf(row()), /Zcash restored from its file/, "a seat opened from its file");
    assert.ok(real[k].sol, "the seat holds a Solana part, so the checks below run");
    {
      t.secrets = with_({ sol: { ...real[k].sol, backupSaved: false } });
      assert.match(textOf(row()), /Solana file not saved/);
      assert.ok(solUnsaved().includes(seat), "an unsaved Solana file is in the backup note");
      t.secrets = with_({ sol: { ...real[k].sol, backupSaved: true } });
      assert.match(textOf(row()), /Solana file saved here/);
      assert.ok(labels(row()).includes("Back up the Solana part of device " + seat));
      t.secrets = with_({ sol: { ...real[k].sol, backupSaved: true, restored: true } });
      assert.match(textOf(row()), /Solana restored from its file/, "a part opened from its file");
      t.secrets = with_({ sol: { ...real[k].sol, aborted: "A test stop." } });
      assert.equal(solFile(seat), null, "a stopped share has no file to save");
      // Restored from its Zcash file alone: the Solana part counts the seat, this browser holds
      // no share of it.
      t.secrets = with_({ sol: undefined });
      assert.deepEqual(solFile(seat), { saved: false, missing: true });
      assert.match(textOf(row()), /Solana part missing.*Restore it from its Solana file/);
      assert.doesNotMatch(pageText(), /are saved/, "the page does not say saved");
      assert.ok(!solUnsaved().includes(seat), "a missing part has no file to save");
      // While the Solana documents load, this browser does not know yet.
      const loaded = t.sol.ctl.loaded;
      t.sol.ctl.loaded = { ...loaded, soldone: false };
      try {
        assert.deepEqual(solFile(seat), { unknown: true, failed: false });
        assert.match(textOf(row()), /Solana part not read yet/);
        assert.doesNotMatch(pageText(), /are saved/, "not read yet is not saved");
      } finally {
        t.sol.ctl.loaded = loaded;
      }
    }
  } finally {
    t.secrets = real;
  }
  // The lost-device text names the Solana part only for a wallet that has one.
  assert.match(pageText(), /\(Devices, Change devices\); a Solana part does not move this way\./);
  const { g } = t.state;
  t.state.g = { ...g, network: "mainnet" };
  try {
    assert.match(pageText(), /\(Devices, Change devices\)\. With fewer/, "no Solana part");
  } finally {
    t.state.g = g;
  }
  const doc = globalThis.document;
  globalThis.document = { createElement: () => new Rec(), createElementNS: () => new Rec(),
    createTextNode: (text) => ({ text }) };
  try {
    assert.equal(backupNote([], [1], true).className, "callout", "plain while Solana sets up");
    assert.equal(backupNote([], [1], false).className, "callout warn");
  } finally {
    globalThis.document = doc;
  }
}
// Each section starts with one heading block, and its panel keeps its focus target and name.
const LEADS = { settings: "Wallet and app preferences", solana: "Solana Devnet" };
function headingBlocks() {
  const blocks = (node) => (node.className === "page-heading" ? 1 : 0)
    + (node.kids ?? []).reduce((sum, kid) => sum + blocks(kid), 0);
  const h2s = (node) => (node.tag === "h2" ? 1 : 0)
    + (node.kids ?? []).reduce((sum, kid) => sum + h2s(kid), 0);
  const ids = t.walletSections().map(([id]) => id);
  assert.deepEqual(ids.slice(-3), ["recovery", "settings", "solana"], "Details is now Settings");
  for (const [id, label] of t.walletSections()) {
    t.ui.tab = id;
    const tree = pageTree();
    assert.equal(blocks(tree), 1, id + ": one heading block");
    const panel = findNode(tree, (n) => n.attrs?.id === "panel-" + id);
    assert.equal(panel.attrs.tabindex, "-1", id + ": the panel keeps tabindex -1");
    assert.equal(panel.attrs["aria-label"], label, id + ": and its name");
    assert.equal(textOf(panel.kids[0]), (LEADS[id] ?? "This wallet") + label,
      id + ": the heading comes first");
    assert.equal(h2s(panel), 1, id + ": the title is the only h2, the cards have h3");
  }
}
// Technical details builds its content only while it is open, and a redraw keeps it open.
const TECHNICAL = "Technical details of this wallet";
async function technicalBox(w, gid) {
  const box = () => findNode(pageTree(), (n) => n.kids?.[0]?.kids?.[0]?.text === TECHNICAL);
  const facts = [w.group_verifying_key, w.ufvk, "Created at block"];
  t.ui.technical = null;
  assert.ok(box(), "Settings has the Technical details box");
  assert.equal(box().attrs.open, undefined, "closed by default");
  for (const hidden of facts) {
    assert.ok(!pageText().includes(hidden), "the closed Technical details builds nothing");
  }
  box().on.toggle({ currentTarget: { open: true } });
  assert.equal(t.ui.technical, gid, "a toggle opens Technical details");
  assert.equal(box().attrs.open, "", "a redraw keeps it open");
  for (const shown of facts) {
    assert.ok(pageText().includes(shown), "the open box shows " + shown.slice(0, 12));
  }
  t.ui.technical = "another-wallet";
  assert.equal(box().attrs.open, undefined, "the box of another wallet stays closed");
  t.ui.technical = gid;
  box().on.toggle({ currentTarget: { open: false } });
  assert.equal(t.ui.technical, null, "a second toggle closes it");
  assert.ok(!pageText().includes(w.ufvk), "and its content goes");
  await redrawGuard(box, gid);
}
// A redraw makes a new open box, which fires a toggle of its own. A toggle that matches the flag
// must ask for no redraw, or the page redraws at every frame. The test counts the frames that
// render() asks for, after the redraws above have ended.
async function redrawGuard(box, gid) {
  await sleep(250);
  const frames = [], raf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (fn) => frames.push(fn);
  try {
    t.ui.technical = gid;
    box().on.toggle({ currentTarget: { open: true } });
    assert.deepEqual([frames.length, t.ui.technical], [0, gid],
      "a toggle that matches the flag asks for no redraw");
    t.ui.technical = null;
    box().on.toggle({ currentTarget: { open: true } });
    assert.equal(frames.length, 1, "a toggle that changes the flag asks for one redraw");
  } finally {
    globalThis.requestAnimationFrame = raf;
  }
  await sleep(250);
}
// The page builds Settings and Help with no network request. The background work of the page
// runs while a test waits, so the trap covers a synchronous build only.
function offline(build) {
  const asked = [], real = globalThis.fetch;
  globalThis.fetch = (...args) => { asked.push(args); throw new Error("no network"); };
  try {
    const out = build();
    assert.deepEqual(asked, [], "Settings and Help ask for no network");
    return out;
  } finally {
    globalThis.fetch = real;
  }
}
// Settings: the parts, the wallet facts, Technical details, and the diagnostics.
async function settingsSection() {
  const { tab, technical } = t.ui, { gid, wallet: w, g } = t.state;
  try {
    const { page, cards } = offline(() => {
      headingBlocks();
      t.ui.tab = "settings";
      const heads = h3Texts(pageTree());
      return { page: pageText(), cards: heads };
    });
    for (const part of ["This wallet", "This browser", "Advanced", "Help"]) {
      assert.ok(cards.includes(part), "Settings has the card " + part);
    }
    assert.ok(!page.includes("This app on this device"), "the card is the browser, not a device");
    assert.ok(page.includes("Any " + g.t + " of " + g.n + " devices"), "the rule says devices");
    await technicalBox(w, gid);
    await diagnosticsFacts(w, gid);
  } finally {
    Object.assign(t.ui, { tab, technical });
  }
}
// What "Copy diagnostics" copies: the click handler of the button, with a recording clipboard.
async function copiedText() {
  const button = findNode(pageTree(), (n) => n.on?.click && textOf(n) === "Copy diagnostics");
  assert.ok(button, "the page has a Copy diagnostics button");
  const copied = [], real = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const { userAgent, onLine, locks } = globalThis.navigator;
  const clipboard = { writeText: async (text) => { copied.push(text); } };
  Object.defineProperty(globalThis, "navigator",
    { configurable: true, value: { userAgent, onLine, locks, clipboard } });
  try {
    await button.on.click({ currentTarget: button });
  } finally {
    Object.defineProperty(globalThis, "navigator", real);
  }
  assert.equal(copied.length, 1, "the button copies once");
  return copied[0];
}
// The Solana lines say "not read yet" while this browser has not read the Solana part.
function solanaUnread(gid) {
  const real = t.secrets, loaded = t.sol.ctl.loaded;
  const k = Object.keys(real).find((key) => key.startsWith(gid + ":") && real[key].keyPackage);
  assert.equal(t.solError, "", "no Solana load failed here");
  assert.match(diagnostics(), /^Solana backup files not saved: \d+$/m);
  assert.match(diagnostics(), /^Solana payments to approve: \d+$/m);
  t.secrets = { ...real, [k]: { ...real[k], sol: undefined } };
  t.sol.ctl.loaded = { ...loaded, soldone: false };
  try {
    const text = diagnostics();
    assert.match(text, /^Solana part: not read yet$/m, "the Solana part says not read yet");
    assert.match(text, /^Solana backup files not saved: not read yet$/m,
      "the Solana files say not read yet");
    assert.match(text, /^Solana payments to approve: not read yet$/m);
  } finally {
    t.secrets = real;
    t.sol.ctl.loaded = loaded;
  }
}
// The Solana part line is one word of the setup state. The Solana counts show only for a part.
function solanaPart() {
  const ctl = t.sol.ctl, docs = ctl.docs, done = docs.soldone, g = t.state.g;
  const COUNTS = /^Solana (backup files not saved|payments to approve): /m;
  const facts = (change) => {
    ctl.docs = { ...docs, ...change };
    return diagnostics();
  };
  try {
    assert.match(facts({}), /^Solana part: ready$/m, "a ready Solana part says ready");
    for (const [what, change, word] of [
      ["a part that stopped", { solabort: { 2: { reason: "A test stop." } } }, "stopped"],
      ["keys that differ", { soldone: { ...done, 2: { ...done[2], groupKey: "00".repeat(32) } } },
        "keys differ"],
      ["a part that sets up", { soldone: { 1: done[1], 2: done[2] } }, "setting up"],
    ]) {
      const text = facts(change);
      assert.match(text, new RegExp("^Solana part: " + word + "$", "m"), "the word of " + what);
      assert.match(text, COUNTS, "the Solana counts of " + what);
    }
    const none = facts({ solstart: {} });
    assert.match(none, /^Solana part: not added$/m, "a part that never started says not added");
    assert.doesNotMatch(none, COUNTS, "a wallet with no Solana part counts nothing of it");
    ctl.docs = docs;
    t.state.g = { ...g, network: "mainnet" };
    const main = diagnostics();
    assert.match(main, /^Solana part: unavailable$/m, "a mainnet wallet gets no Solana part");
    assert.doesNotMatch(main, COUNTS, "and counts nothing of it");
  } finally {
    ctl.docs = docs;
    t.state.g = g;
  }
}
// The sync line is one word of a fixed list, or the height of the last block. The error text of
// a failed sync, which can hold any text, never shows.
function syncWords(gid) {
  const real = t.chain, error = "Maria Keller sent utest1qx7zk and the server said 9f3c2a7b";
  const word = (chain) => {
    t.setChain(chain);
    return /^Zcash sync: (.*)$/m.exec(diagnostics())[1];
  };
  const bal = { height: 4500100 };
  try {
    for (const [what, chain, want] of [
      ["no chain", null, "not started"],
      ["another wallet", { gid: "other", bal }, "not started"],
      ["a failed sync", { gid, error, syncing: false }, "failed"],
      ["a failed sync that retries", { gid, error, syncing: true, bal }, "failed"],
      ["a running sync", { gid, syncing: true, bal }, "syncing"],
      ["a sync that ended", { gid, bal }, "synced to block 4500100"],
      ["a chain with no balance", { gid }, "waiting"],
    ]) assert.equal(word(chain), want, "the sync word of " + what);
    t.setChain({ gid, error });
    assert.ok(!diagnostics().includes("Maria Keller"), "the sync error text never shows");
  } finally {
    t.setChain(real);
  }
}
// The diagnostics hold the facts and no line of the log: real log lines carry notes, short ids,
// short addresses and balances. The page shows the text, and the button copies the same text.
async function diagnosticsFacts(w, gid) {
  const part = JSON.stringify(Object.values(t.secrets).find((s) => s.keyPackage).keyPackage);
  const solana = "EvHCyEZUDBzWuuUDwSmXWrJ2vdtgVSr8ikduQfUAVr3r";
  const seen = { address: w.address, "viewing key": w.ufvk, "wallet key": w.group_verifying_key,
    "invite link": inviteLink(gid), "wallet secret": t.gkeys[gid], "key share": part,
    "Solana address": solana, "wallet id": gid, "wallet name": "Maria's Treasury",
    "device name": "Keller Laptop", "payment note": "Rent for Maria Keller",
    "short transaction id": "9f3c2a7b", "short payee address": "q6r7s8",
    balance: "12.3456 ZEC" };
  const lines = [
    "wallet created: " + w.address.slice(0, 24) + "…",
    "seat 1: key share ready, wallet key " + w.group_verifying_key.slice(0, 12) + "…",
    "✗ react: " + inviteLink(gid) + " " + t.gkeys[gid] + " " + solana,
    "bad data " + w.address + " " + w.ufvk + " " + part,
    "ignored data without a valid signature (wallet " + gid.slice(0, 6) + "): groups/" + gid,
    '✗ step: "Rent for Maria Keller, flat 4B": write failed',
    "could not read the memo of 9f3c2a7b…5c4b3a: server failed",
    "Payment to utest1qx…q6r7s8 failed",
    "synced to 4518757, spendable 12.3456 ZEC",
  ];
  const { log, g, seats } = t.state;
  t.state.log = [...lines, ...log];
  t.state.g = { ...g, name: seen["wallet name"] };
  t.state.seats = Object.fromEntries(Object.entries(seats)
    .map(([i, seat]) => [i, { ...seat, name: seen["device name"] }]));
  try {
    const box = offline(() => findNode(pageTree(),
      (n) => n.attrs?.["aria-label"] === "Diagnostics text"));
    const shown = offline(() => textOf(box));
    const copied = await copiedText();
    const noTime = (text) => text.replace(/^Time \(UTC\): .*\n/m, "");
    assert.equal(noTime(copied), noTime(shown), "the copy button copies the shown text");
    for (const [what, text] of [["the text", offline(diagnostics)], ["the page", shown],
      ["the copy", copied]]) {
      assert.ok(!lines.some((line) => text.includes(line)),
        "the diagnostics of " + what + " hold no line of the log");
      for (const [name, value] of Object.entries(seen)) {
        assert.ok(!text.includes(value) && !text.includes(value.slice(0, 20)),
          "the diagnostics of " + what + " hide the " + name);
      }
      assert.match(text, /Approval rule: 2 of 3 devices/, "but they keep the facts");
    }
    assert.equal(box.attrs["data-key"], "diagnostics", "the box keeps its focus through a redraw");
    solanaUnread(gid);
    solanaPart();
    syncWords(gid);
  } finally {
    Object.assign(t.state, { log, g, seats });
  }
}
// With nothing to list after the sync, the inbox speaks for Zcash alone: the Solana line below it
// speaks for Solana.
function emptyInbox() {
  const { tab } = t.ui, chain = t.chain, sessions = t.state.sessions;
  t.ui.tab = "approvals";
  t.state.sessions = [];
  t.setChain({ gid: t.state.gid, cw: {}, bal: { spendable: 0, pending: 0 }, sent: new Set(),
    received: [] });
  try {
    assert.match(pageText(), /No Zcash payment waits for this browser.*No Solana proposal waits/,
      "the empty inbox of a wallet with a Solana part");
  } finally {
    t.setChain(chain);
    t.state.sessions = sessions;
    t.ui.tab = tab;
  }
}
// Receive names the network of the open wallet (D3); a received row says what and where.
function receiveTexts() {
  const real = globalThis.document, { g } = t.state, chain = t.chain, { tab } = t.ui;
  const share = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const rec = { createElement: () => new Rec(), createElementNS: () => new Rec(),
    createTextNode: (text) => ({ text }) };
  // A click shows its banner on the page of the rig.
  const click = (button) => {
    globalThis.document = real;
    try { button.on.click(); } finally { globalThis.document = rec; }
  };
  globalThis.document = rec;
  try {
    const box = receiveDialog();
    assert.ok(byText(box, "Zcash Testnet"), "the badge names the network of the wallet");
    assert.match(textOf(box), /Send only ZEC on Zcash Testnet to this address\./);
    assert.match(textOf(box), /becomes spendable after 3 confirmations\. Get free testnet ZEC/);
    assert.match(textOf(box), /faucet ↗\. That site is not Zigs: it sees the address that you/,
      "the faucet note says what the faucet sees");
    assert.match(textOf(box), /Its public status lists each payout with a short form of the/,
      "and that the faucet publishes each payout");
    assert.ok(!byText(box, "Share address"), "no Share button without Web Share");
    const first = findNode(box, (n) => n.attrs?.["data-first-focus"] !== undefined);
    assert.equal(first && textOf(first), "Copy address", "the dialog opens on Copy address");
    // Web Share gets the address alone. A closed sheet is no error; a failure says so.
    let shared = null, refusal = null;
    const answer = { catch: (fn) => (refusal ? fn(refusal) : undefined) };
    Object.defineProperty(globalThis, "navigator", { configurable: true,
      value: { share: (d) => { shared = d; return answer; } } });
    const shareButton = () => byText(receiveDialog(), "Share address");
    assert.ok(shareButton(), "Web Share adds a Share button");
    click(shareButton());
    assert.deepEqual(shared, { text: t.state.wallet.address }, "it shares the address alone");
    const before = t.banner;
    refusal = { name: "AbortError" };
    click(shareButton());
    assert.equal(t.banner, before, "a closed share sheet shows nothing");
    refusal = { name: "NotAllowedError" };
    click(shareButton());
    assert.match(t.banner?.text ?? "", /could not share the address\. Use Copy address\./);
    t.state.g = { ...g, movedTo: "elsewhere" };
    const moved = textOf(receiveDialog());
    assert.match(moved, /Change devices replaces this wallet with/, "a moved wallet says so");
    assert.doesNotMatch(moved, /Send only|Use this shielded address|Share address/,
      "and asks for no payment to the old address");
    t.state.g = g;
    // A browser whose seats did not check the address yet: the dialog says why, and shows none.
    const secretsWere = t.secrets;
    t.secrets = Object.fromEntries(Object.entries(secretsWere).map(([k, v]) =>
      [k, k.startsWith(t.state.gid + ":") ? { ...v, checkedWallet: "another" } : v]));
    try {
      const hidden = textOf(receiveDialog());
      assert.match(hidden,
        /The address shows here after your device checks it against its own key\./,
        "the dialog says why the address is not shown");
      assert.doesNotMatch(hidden, /Copy address|Share address|Send only/, "and shows no address");
    } finally {
      t.secrets = secretsWere;
    }
    t.state.g = { ...g, network: "mainnet" };
    const main = receiveDialog();
    assert.ok(byText(main, "Zcash Mainnet"), "a mainnet wallet reads Mainnet");
    assert.doesNotMatch(textOf(main), /testnet|faucet/i, "and claims no testnet");
    assert.match(textOf(main), /Send only ZEC on Zcash Mainnet to this address\./);
    assert.match(textOf(main), new RegExp("The devices of this wallet and anyone who has the "
      + "invite link can see its balance and history\\. A device that Change devices leaves out "
      + "later can still see them\\."));
    // At the cap of a mainnet wallet the dialog shows the cap note and no address.
    t.setChain({ gid: t.state.gid, cw: {}, bal: { spendable: 60000000, pending: 0,
      height: 4500100 }, sent: new Set(), received: [] });
    const full = textOf(receiveDialog());
    assert.doesNotMatch(full, /Copy address|Send only/, "no address at the cap");
  } finally {
    globalThis.document = real;
    Object.defineProperty(globalThis, "navigator", share);
    t.state.g = g;
    t.setChain(chain);
  }
  t.ui.tab = "activity";
  t.setChain({ gid: t.state.gid, cw: {}, bal: { spendable: 0, pending: 0, height: 4500100 },
    sent: new Set(), received: [{ txid: "ab", height: 4500000, value: 100000, confirmed: true }] });
  try {
    assert.match(pageText(), /Received ZECZcash Testnet · block\u00a04\D?500\D?000/,
      "a received row names the coin and the network");
    explorerTexts(chain);
  } finally {
    t.setChain(chain);
    t.ui.tab = tab;
  }
}
// A received row opens the explorer, and the faucet link opens the faucet: the notes say what
// these sites see. The Overview, the Activity section and the Messages of the wallet.
const EXPLORER_NOTE = "A received payment in this list opens testnet.zecblock.com in a new tab. "
  + "That site is not Zigs: it sees the transaction id that you open and your IP address.";
function explorerTexts(chain) {
  assert.ok(pageText().includes(EXPLORER_NOTE), "the Activity list says what the explorer sees");
  t.ui.tab = "overview";
  assert.ok(pageText().includes(EXPLORER_NOTE), "so does the Activity card of the Overview");
  assert.match(pageText(), /faucet ↗\. That site is not Zigs: it sees the address that you paste/,
    "the empty ZEC card says what the faucet sees");
  // Six newer payments push the received row out of the 6 rows of the Overview.
  const sessions = t.state.sessions;
  t.state.sessions = [1, 2, 3, 4, 5, 6].map((i) => ({ id: "x" + i, pczt: "x", amount: 1,
    status: "cancelled", error: "Cancelled.", createdAt: Date.now() - i,
    payees: [{ to: "utest1x", amount: 1 }] }));
  try {
    assert.ok(!pageText().includes(EXPLORER_NOTE), "the Overview note follows its 6 rows");
  } finally {
    t.state.sessions = sessions;
  }
  const row = t.chain.received[0];
  t.setChain({ ...t.chain, received: [] });
  assert.ok(!pageText().includes(EXPLORER_NOTE), "no note without a received payment");
  t.ui.tab = "messages";
  t.setChain({ ...t.chain, received: [{ ...row, memos: [{ status: "text", text: "Rent" }] }] });
  assert.match(pageText(), /View payment opens testnet\.zecblock\.com in a new tab\. That site/,
    "a memo of a received payment says what the explorer sees");
  // A message of the room shows the thread with no memo: no note then.
  const room = roomChat[t.state.gid];
  roomChat[t.state.gid] = [{ id: "m1", thread: "wallet", seat: 1, text: "Hello room", at: 1 }];
  try {
    t.setChain({ ...t.chain, received: [row] });
    assert.match(pageText(), /Hello room/, "the room thread shows");
    assert.doesNotMatch(pageText(), /View payment opens/, "no memo, no note");
  } finally {
    if (room) roomChat[t.state.gid] = room;
    else delete roomChat[t.state.gid];
    t.setChain(chain);
  }
}
// A link with a secret sits in the disclosure of its QR code, which starts closed. While it is
// closed, neither its summary nor any attribute shows the secret. Copy link stays outside the
// disclosure and copies the whole link. `where` names the card in the messages.
function hiddenLink(page, link, where) {
  const secret = link.split("#")[1], say = (m) => where + ": " + m;
  const nav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const box = findNode(page, (n) => n.className === "qr-toggle");
  assert.ok(!("open" in box.attrs) && !box.open, say("the disclosure is closed by default"));
  assert.equal(textOf(box.kids[0]), "Show link and QR code", say("the summary shows no link"));
  assert.ok(textOf(box).includes(link), say("the link text sits inside the disclosure"));
  const outside = (n) => (n === box ? "" : n.text ?? n.kids.map(outside).join(""));
  assert.ok(!outside(page).includes(link), say("no link text outside the disclosure"));
  const leaks = (n) => [n.className, n.innerHTML, ...Object.values(n.attrs ?? {})]
    .some((v) => String(v ?? "").includes(secret)) || (n.kids ?? []).some(leaks);
  assert.ok(!leaks(page), say("no attribute holds the wallet secret"));
  const copy = findNode(page, (n) => !!n.on?.click && textOf(n) === "Copy link");
  assert.ok(copy && !byText(box, "Copy link"),
    say("Copy link stays on the page, outside the disclosure"));
  const copied = [];
  try {
    Object.defineProperty(globalThis, "navigator", { configurable: true,
      value: { clipboard: { writeText: async (x) => { copied.push(x); } } } });
    copy.on.click({ currentTarget: copy });   // the copy runs before the first await
  } finally {
    if (nav) Object.defineProperty(globalThis, "navigator", nav);
    else delete globalThis.navigator;
  }
  assert.deepEqual(copied, [link], say("Copy link copies the full invite link"));
}
// A wallet that a new wallet replaces reads "Moving" in the wallet list and in the side list,
// until no Zcash is left there at its last sync in this browser: then "Zcash funds moved".
function moveWords() {
  const groups = t.state.groups, gid = "ab".repeat(10);
  const old = { id: gid, name: "Old", t: 2, n: 3, network: "testnet", movedTo: "cd".repeat(10) };
  const lobbyTree = () => {
    const real = globalThis.document;
    globalThis.document = { createElement: () => new Rec(), createElementNS: () => new Rec(),
      createTextNode: (text) => ({ text }) };
    try {
      return lobby();
    } finally {
      globalThis.document = real;
    }
  };
  const item = (tree, key) => textOf(findNode(tree, (n) => n.attrs?.["data-key"] === key));
  const side = () => item(sideTree(), "wallet-" + gid);
  const row = () => item(lobbyTree(), "wallet-row-" + gid);
  t.state.groups = [...groups, old];
  try {
    assert.match(side(), /Moving/, "the side list says Moving");
    assert.match(row(), /Moving/, "the wallet list says Moving");
    t.balCache[gid] = { total: 0, at: 1 };
    assert.match(side(), /Zcash funds moved/,
      "a list wallet with no Zcash left reads Zcash funds moved");
    assert.match(row(), /Zcash funds moved/, "in the wallet list too");
    t.balCache[gid] = { total: 5, at: 1 };
    assert.match(row(), /Moving/, "a wallet with Zcash left is still moving");
  } finally {
    t.state.groups = groups;
    delete t.balCache[gid];
  }
}
// The Devices section shows the invite link that way.
function inviteTexts() {
  const tab = t.ui.tab;
  t.ui.tab = "members";
  try {
    hiddenLink(pageTree(), inviteLink(t.state.gid), "Devices");
  } finally {
    t.ui.tab = tab;
  }
}
// The Activity list holds Zcash and Solana rows in one list, newest first. A wallet with a started
// Solana part gets a "Show activity for" select; any other wallet shows its Zcash rows.
const TITLES = ["Public SOL withdrawal", "Office rent", "Move the beta funds", "Received ZEC",
  "Received SOL"];
const order = (text, titles) => titles.map((title) => text.indexOf(title));
const sorted = (list) => list.every((n, i) => n >= 0 && (i === 0 || n > list[i - 1]));
const gone = (text, titles) => order(text, titles).every((n) => n < 0);
const select = () => findNode(pageTree(), (n) => typeof n.on?.change === "function");
const picked = () => textOf(findNode(select(), (n) => n.attrs?.selected !== undefined));
// Five rows, newest first: a Solana payment, a Zcash payment, a Solana move that failed, the
// received ZEC and the SOL that was added. `at(m)` is m minutes after the received ZEC.
function activityRowsFor(ctl, state) {
  const born = Date.now() - spanMs(netName(state.g), 4500000, 4500100);
  const at = (minutes) => born + minutes * 60000;
  const out = intentHex("withdraw", { expiry: 9999999999n, inputs: 1, outputs: 1,
    recipient: "11".repeat(32), amount: 2_000_000n });
  const move = intentHex("transfer", { nonce: "11".repeat(32), expiry: 9999999999n, inputs: 1,
    outputs: 1, payee: "ab".repeat(99), amount: 3_000_000n });
  const solRows = [
    proposal("sa", { createdAt: at(30), intent: out, status: "sent", outcome: "confirmed" }),
    proposal("sb", { createdAt: at(10), intent: move, status: "sent", outcome: "failed" }),
  ];
  state.sessions = [{ id: "za", pczt: "PA", status: "collecting", amount: 25000000,
    createdAt: at(20), payees: [{ to: "utest1x", amount: 25000000 }], note: "Office rent" }];
  t.setChain({ gid: state.gid, cw: {}, bal: { spendable: 0, pending: 0, height: 4500100 },
    sent: new Set(), received: [{ txid: "ab", height: 4500000, value: 100000, confirmed: true }] });
  Object.assign(ctl, { sessions: solRows, commits: {},
    added: { seat: 1, amount: 20_000_000n, txId: "tx", status: "confirmed", slot: "4500123",
      at: at(-10) } });
  return { at, solRows };
}
function activityList(ctl) {
  const { tab, chainFilter } = t.ui, { chain, state } = t, { g, sessions } = state;
  const kept = { sessions: ctl.sessions, added: ctl.added, docs: ctl.docs, loaded: ctl.loaded };
  const draw = (filter) => { t.ui.chainFilter = filter; return pageText(); };
  t.ui.tab = "activity";
  try {
    const { at, solRows } = activityRowsFor(ctl, state);
    const all = draw("all");
    assert.ok(sorted(order(all, TITLES)), "Zcash and Solana rows merge newest first, by time");
    assert.match(all, /Public SOL withdrawalSolana Devnet · Proposed by .*−0\.002SOL/,
      "a Solana payment row names the coin, the chain and the amount");
    assert.match(all, /Executed/, "a payment that executed says so");
    assert.match(all, /Move the beta funds.*Failed on chain/, "a transaction that failed on chain");
    assert.match(all, /Received SOLSolana Devnet · slot\u00a04\D?500\D?123Added by .*\+0\.02SOL/,
      "a received Solana row says what arrived and on which chain");
    assert.match(all, /Office rentZcash Testnet · Proposed by /, "a Zcash row names its chain");
    assert.match(all, /SOL that other people send to the wallet does not show here/);
    assert.equal(select().kids.length, 3, "the select offers All, Zcash and Solana");
    assert.equal(picked(), "All");
    select().on.change({ target: { value: "sol" } });
    assert.equal(t.ui.chainFilter, "sol", "the choice stays in ui");
    const onlySol = pageText();
    assert.ok(sorted(order(onlySol, [TITLES[0], TITLES[2], TITLES[4]])), "Solana rows only");
    assert.ok(all.includes(EXPLORER_NOTE), "the list of both chains has a received ZEC row");
    assert.ok(!onlySol.includes(EXPLORER_NOTE), "a Solana-only list has no Zcash explorer note");
    assert.ok(gone(onlySol, [TITLES[1], TITLES[3]]), "no Zcash row");
    assert.equal(picked(), "Solana");
    const onlyZec = draw("zec");
    assert.ok(sorted(order(onlyZec, [TITLES[1], TITLES[3]])), "Zcash rows only");
    assert.ok(gone(onlyZec, [TITLES[0], TITLES[2], TITLES[4]]), "no Solana row");
    assert.ok(onlyZec.includes(EXPLORER_NOTE), "the Zcash-only list has the explorer note");
    activityOverview(ctl, at, solRows);
    activityStates(ctl, kept);
    activityBadges(ctl);
    t.ui.tab = "activity";
    activityRowsFor(ctl, state);
    activityChecks(ctl, draw);
    activityOlder(ctl, draw);
  } finally {
    state.g = g;
    Object.assign(ctl, kept);
    Object.assign(t.ui, { tab, chainFilter });
    state.sessions = sessions;
    t.setChain(chain);
  }
}
// The Overview lists the newest six rows of both chains, whatever the choice.
function activityOverview(ctl, at, solRows) {
  t.ui.tab = "overview";
  assert.match(pageText(), /Public SOL withdrawal.*Office rent.*Move the beta funds/,
    "the recent rows of the Overview have the Solana rows");
  ctl.sessions = [...solRows, ...["sc", "sd", "se"].map((id, i) =>
    proposal(id, { createdAt: at(40 + i) }))];
  const recent = pageText();
  assert.match(recent, /View all/, "the Solana rows count toward the list that View all opens");
  assert.doesNotMatch(recent, /Received ZEC|Received SOL/, "the Overview shows six rows");
  ctl.sessions = solRows;
  t.ui.tab = "activity";
}
// The states with fewer rows: unread proposals, a part that never started, a mainnet wallet.
function activityStates(ctl, kept) {
  const { state } = t, { g } = state;
  const draw = (filter) => { t.ui.chainFilter = filter; return pageText(); };
  const added = ctl.added;
  ctl.added = { ...added, status: "failed" };
  assert.match(draw("all"), /Add SOLSolana Devnet.*Tried by .*Failed on chain/,
    "an Add SOL that failed is no received SOL");
  ctl.added = added;
  ctl.loaded = { ...ctl.loaded, solsessions: false };
  const reading = draw("all");
  assert.match(reading, /Reading the Solana transactions/);
  assert.ok(select(), "the select shows while the rows load");
  assert.ok(gone(reading, [TITLES[0], TITLES[4]]), "no Solana row yet");
  ctl.loaded = kept.loaded;
  ctl.docs = { ...ctl.docs, solstart: {} };
  const idle = draw("sol");
  assert.equal(select(), null, "no select before the Solana part starts");
  assert.ok(sorted(order(idle, [TITLES[1], TITLES[3]])),
    "a wallet with no Solana part shows its Zcash rows, whatever the choice");
  assert.doesNotMatch(idle, /Solana rows show|Public SOL withdrawal/);
  ctl.docs = { ...kept.docs, solabort: { 2: { reason: "A test stop." } } };
  const stopped = draw("sol");
  assert.equal(select(), null, "no select for a Solana part that stopped");
  assert.match(stopped, /The Solana part stopped, so its payments do not show here/);
  assert.doesNotMatch(stopped, /The Solana rows show/, "no note that says the rows show");
  assert.ok(sorted(order(stopped, [TITLES[1], TITLES[3]])), "the Zcash rows of a stopped part");
  assert.ok(gone(stopped, [TITLES[0], TITLES[2], TITLES[4]]), "no Solana row of a stopped part");
  const done = kept.docs.soldone;
  ctl.docs = { ...kept.docs, soldone: { ...done, 2: { ...done[2], groupKey: "00".repeat(32) } } };
  const differs = draw("sol");
  assert.match(differs, /differ, or do not fit this browser, so its payments do not show here/);
  assert.equal(select(), null, "no select for keys that differ");
  ctl.docs = { ...kept.docs, soldone: { 1: done[1], 2: done[2] } };
  const running = draw("all");
  assert.match(running, /The Solana part is not ready yet, so its payments do not show here/,
    "a Solana part that is not ready yet says so");
  assert.doesNotMatch(running, /The Solana rows show/, "and no note that says the rows show");
  ctl.docs = kept.docs;
  state.g = { ...g, network: "mainnet" };
  const main = draw("sol");
  assert.equal(select(), null, "no select without a Solana part");
  assert.ok(sorted(order(main, [TITLES[1], TITLES[3]])),
    "a mainnet wallet shows its Zcash rows, whatever the choice");
  assert.match(main, /Office rentZcash Mainnet · Proposed by /, "and name their network");
  assert.doesNotMatch(main, /Public SOL withdrawal|does not show here/);
  state.sessions = [];
  t.setChain({ ...t.chain, received: [] });
  assert.match(pageText(),
    /Money you receive and payments that the devices of this wallet propose show up here/);
  state.g = g;
  Object.assign(ctl, { sessions: [], added: null });
  assert.match(draw("all"),
    /ZEC you receive and payments that the devices of this wallet propose show up here/);
  assert.match(draw("zec"), /ZEC you receive and Zcash payments that the devices of this wallet/);
  assert.match(draw("sol"), /Solana payments that the devices of this wallet propose show up/);
  assert.doesNotMatch(pageText(), /ZEC you receive/, "no ZEC under the Solana choice");
  activityHistory(ctl, state, draw);
}
// Proposals that wait for their signature check: the rows that are read show, and the note says
// that more can come. An empty list waits for the check.
function activityChecks(ctl, draw) {
  const { sessions, added } = ctl;
  ctl.sessWait = 1;
  try {
    const checking = draw("all");
    assert.ok(sorted(order(checking, TITLES)), "the rows that are read show while others wait");
    assert.match(checking, /Zigs still reads some Solana proposals, so more rows can show\./,
      "the note says that more rows can come");
    Object.assign(ctl, { sessions: [], added: null });
    const empty = draw("sol");
    assert.match(empty, /Reading the Solana transactions/,
      "an empty Solana list waits for the check");
    assert.doesNotMatch(empty, /No activity yet/, "and does not say that nothing is there");
  } finally {
    Object.assign(ctl, { sessWait: 0, sessions, added });
  }
  assert.doesNotMatch(draw("all"), /Zigs still reads some Solana/, "no such note after the check");
}
// More proposals than the Solana section shows: the list has the newest SHOWN and says so.
function activityOlder(ctl, draw) {
  const { sessions, added } = ctl;
  const solRows = () => findAll(pageTree(), (n) => n.attrs?.["data-key"]?.startsWith("sol-act-m"));
  const older = / Older Solana proposals are not listed\./;
  try {
    ctl.added = null;
    ctl.sessions = Array.from({ length: SHOWN }, (_, i) => proposal("m" + i));
    assert.equal(solRows().length, SHOWN, "the list shows each proposal that the section shows");
    assert.doesNotMatch(draw("sol"), older, "and claims no older proposal");
    ctl.sessions = Array.from({ length: SHOWN + 1 }, (_, i) => proposal("m" + i));
    assert.equal(solRows().length, SHOWN, "the list shows the newest proposals only");
    assert.match(draw("sol"), older, "a list with more proposals than the section says so");
  } finally {
    Object.assign(ctl, { sessions, added });
  }
}
// The empty list says what the chain read is: finished (nothing there), not finished, or failed.
function activityHistory(ctl, state, draw) {
  const ready = t.chain, loaded = ctl.loaded;
  assert.match(draw("all"), /No activity yet/, "a finished sync with nothing: the empty list");
  t.setChain({ gid: state.gid, cw: null, bal: null, sent: null, received: [], syncing: true });
  const syncing = draw("all");
  assert.match(syncing, /Reading the chain.*Payments you received show after the first sync\./,
    "a sync that did not finish says that it reads the chain");
  assert.doesNotMatch(syncing, /No activity yet/,
    "a sync that did not finish says nothing is there");
  t.setChain({ ...ready, error: "The server did not answer." });
  const failed = draw("all");
  assert.match(failed, /The sync failed.*This list can be incomplete\. Use Refresh/,
    "a failed sync says that the list can be incomplete");
  assert.doesNotMatch(failed, /No activity yet/, "a failed sync says nothing is there");
  const solana = draw("sol");
  assert.doesNotMatch(solana, /Reading the chain|The sync failed/, "the Solana choice");
  state.sessions = [{ id: "zb", pczt: "PA", status: "collecting", amount: 5000000,
    createdAt: Date.now(), payees: [{ to: "utest1x", amount: 5000000 }], note: "Late rent" }];
  assert.match(draw("all"), /Late rent.*The sync failed\. This list can be incomplete/,
    "rows next to a failed sync: the list can lack received payments");
  t.setChain(null);
  assert.match(draw("all"), /Late rent.*Not synced yet\. Sync starts after this device checks/,
    "rows before the sync starts: the note says when it starts");
  state.sessions = [];
  const none = draw("all");
  assert.match(none, /Not synced yet.*Sync starts after this device checks the address\./,
    "an empty list before the sync starts says when it starts");
  assert.doesNotMatch(none, /Reading the chain|No activity yet/,
    "a sync that has not started is no sync in progress");
  t.setChain({ gid: state.gid, cw: null, bal: null, sent: null, received: [],
    error: "The server did not answer." });
  const first = draw("all");
  assert.match(first, /The sync failed/, "a first sync that fails says that it failed");
  assert.doesNotMatch(first, /Reading the chain/, "a first sync that fails is no sync in progress");
  t.setChain(ready);
  ctl.loaded = { ...loaded, solsessions: false };
  for (const pick of ["sol", "all"]) {
    const unread = draw(pick);
    assert.match(unread, /Reading the Solana transactions.*show after Zigs reads them/,
      "an unread Solana list says that it reads: " + pick);
    assert.doesNotMatch(unread, /No activity yet/,
      "an unread Solana list does not say that nothing is there: " + pick);
  }
  assert.match(draw("zec"), /No activity yet/, "the Zcash choice does not wait for Solana");
  ctl.loaded = loaded;
}
const rowText = (id) => {
  const row = findNode(pageTree(), (n) => n.attrs?.["data-key"] === "sol-act-" + id);
  return row ? textOf(row) : "";
};
// The money and the state of each kind of Solana row, and the text of its proposer.
function activityBadges(ctl) {
  const now = Date.now(), min = 60000;
  const out = intentHex("withdraw", { expiry: 9999999999n, inputs: 1, outputs: 1,
    recipient: "11".repeat(32), amount: 2_000_000n });
  const move = intentHex("transfer", { nonce: "11".repeat(32), expiry: 9999999999n, inputs: 1,
    outputs: 1, payee: "ab".repeat(99), amount: 3_000_000n });
  const expiry = String(Math.floor(now / 1000) + 3600);
  const pay = (id, change) =>
    proposal(id, { intent: out, expiry, createdAt: now - min, ...change });
  t.ui.tab = "activity";
  t.ui.chainFilter = "all";
  ctl.added = null;
  ctl.commits = { pc: { 1: {}, 2: {}, 3: {} } };
  ctl.sessions = [
    proposal("pm", { createdAt: now }),
    pay("ps", { status: "signed" }), pay("px", { status: "sent", outcome: "confirmed" }),
    pay("pc", {}), pay("pe", { expiry: "1" }), pay("pd", { status: "failed" }),
    proposal("pn", { createdAt: now - 10 * min }),
    proposal("pv", { intent: move, status: "sent", outcome: "failed", createdAt: now - 2 * min }),
    proposal("pg", { intent: move, status: "signed", createdAt: now - 3 * min }),
  ];
  const [mine, signed, done, open, late, failed] =
    ["pm", "ps", "px", "pc", "pe", "pd"].map(rowText);
  assert.match(mine, /Create the nonce account for the move.*Your approval›$/,
    "a proposal that a seat here can approve says so");
  assert.match(signed, /Approved, executing›$/, "a signed payment is not executed yet");
  assert.match(done, /−0\.002SOLExecuted›$/, "an executed payment");
  assert.match(open, /Collecting approvals›$/, "a payment that waits for approvals");
  assert.match(late, /−0\.002SOLExpired›$/, "a payment past its expiry reads Expired");
  assert.match(rowText("pn"), /Expired›$/, "so does a nonce proposal past its window");
  assert.match(failed, /Failed›$/);
  assert.match(rowText("pv"), /Move the beta funds.*0\.003SOLFailed on chain›$/);
  assert.doesNotMatch(rowText("pv") + rowText("pg"), /[−+]/, "the move of the funds has no sign");
  assert.match(rowText("pg"), /Signed, sending›$/);
  // An Add SOL is SOL that arrived only when it is confirmed.
  const added = (status, slot) => {
    ctl.added = { seat: 1, amount: 20_000_000n, txId: "tx", status, slot, at: now };
    return rowText("added");
  };
  for (const status of ["confirmed", "finalized"]) {
    assert.match(added(status, "4500123"),
      /^↙Received SOLSolana Devnet · slot.*Added by .*\+0\.02SOLConfirmed›$/, status);
  }
  for (const status of ["unknown", "pending"]) {
    const text = added(status, "");
    assert.match(text, /^↔Add SOLSolana Devnet.*Sent by .*0\.02SOLNot confirmed yet›$/,
      "an Add SOL that is not confirmed reads Sent: " + status);
    assert.doesNotMatch(text, /Received|\+|slot/, status + " is no money that arrived");
  }
  const failedAdd = added("failed", "4500124");
  assert.match(failedAdd, /^↔Add SOLSolana Devnet.*Tried by .*0\.02SOLFailed on chain›$/);
  assert.doesNotMatch(failedAdd, /Received|\+/);
  // One proposal has one proposer text, in the Approvals row and in the Activity row.
  ctl.added = null;
  ctl.sessions = [proposal("pq", { by: 7, createdAt: now })];
  const who = "Proposed by " + t.proposer({ by: 7 });
  assert.match(rowText("pq"), new RegExp("Solana Devnet · " + who.replace(/[()]/g, "\\$&")));
  t.ui.tab = "approvals";
  assert.ok(pageText().includes("Solana Devnet · " + who), "the Approvals row says it too");
}
// The phone Menu closes on a pick; the sections show for the formed wallet only; the switcher
// shows with two or more wallets.
function sideMenu() {
  t.ui.menu = true;
  const wide = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true });
  try { sideTree(); } finally { globalThis.matchMedia = wide; }
  const out = () => [".main", ".skip-link", ".logo"].map((sel) => shellParts[sel].inert);
  assert.deepEqual(out(), [true, true, true],
    "the open Menu of a phone keeps the page out of reach");
  const tree = sideTree();
  assert.deepEqual(out(), [false, false, false], "wider than a phone, the page stays in reach");
  tree.onclick({ target: { closest: () => ({}) } });
  assert.equal(t.ui.menu, false, "a pick in the side list closes the phone Menu");
  assert.ok(walletShown(), "the formed wallet shows its sections");
  assert.equal(t.state.sessionsLoaded, true, "the payments of the open wallet arrived");
  assert.equal(t.state.sessionsFailed, false);
  const { g, wallet } = t.state;
  try {
    t.state.g = { ...g, unreadable: true };
    assert.equal(walletShown(), false, "an unreadable wallet shows no sections");
    t.state.g = g;
    t.state.wallet = null;
    assert.equal(walletShown(), false, "a wallet in setup shows no sections");
  } finally {
    Object.assign(t.state, { g, wallet });
  }
  const tab = t.ui.tab;
  t.ui.tab = "recovery";
  assert.match(pageText(), /This wallet's devices in this browser.*file (saved here|not saved)/,
    "the Recovery section shows the file state of each seat of this browser");
  assert.match(pageText(), /cannot see the files of the other devices/);
  assert.match(pageText(),
    /covers the devices of this wallet in this browser only: each other wallet has its own/);
  assert.match(pageText(), /the personal account has its own backup file, and direct chats are/);
  recoveryFacts();
  t.ui.tab = tab;
  assert.ok(!labelled(pageTree(), "Switch wallet"), "one wallet: its name, no switcher");
  t.state.groups = [t.state.g, { id: "other", name: "Other" }];
  assert.ok(labelled(pageTree(), "Switch wallet"), "two wallets: a switcher");
}
async function approvalCount(ctl) {
  // The count follows approveSeats: the documents are checked (wait 0), so the cards show buttons.
  const count = (sessions, commits = {}, change = {}) =>
    pendingCount({ ...ctl, wait: 0, sessWait: 0, ...change, sessions, commits });
  const docs = (change) => ({ docs: { ...ctl.docs, ...change } });
  const two = [proposal("a"), proposal("b"), proposal("c", { status: "sent" })];
  assert.equal(count(two), 2, "two open proposals, a sent one does not count");
  const rows = pendingRows({ ...ctl, wait: 0, sessWait: 0, sessions: two, commits: {} });
  assert.deepEqual(rows.map((r) => r.id), ["a", "b"], "the inbox lists the same proposals");
  assert.equal(count(two, {}, { wait: 1 }), 0, "while a document is checked: no button, no count");
  const loading = (sessions, change = {}) =>
    loadingCount({ ...ctl, wait: 0, sessWait: 0, ...change, sessions, commits: {} });
  assert.equal(loading(two, { wait: 1 }), 2, "a proposal that waits for the read is loading");
  assert.equal(loading(two), 0, "a proposal with its Approve button is not loading");
  const many = Array.from({ length: SHOWN + 1 }, (_, i) => proposal("m" + i));
  assert.equal(count(many), SHOWN, "only the cards that the section shows count");
  const mixed = [proposal("s0", { status: "sent" }), ...many];
  assert.equal(count(mixed), SHOWN - 1, "a proposal behind the shown cards does not count");
  assert.deepEqual([olderCount({ ...ctl, sessions: two }), olderCount({ ...ctl, sessions: mixed })],
    [0, 2], "the proposals older than the shown cards");
  assert.equal(count(two, { a: { 1: {} } }), 2, "seats 2 and 3 can still approve a");
  assert.equal(count(two, { a: { 1: {}, 2: {}, 3: {} } }), 1, "every seat approved a");
  assert.equal(count([proposal("d", { intent: "zz" })]), 0, "a proposal the app cannot show");
  assert.equal(count([proposal("x", { createdAt: 1 })]), 0, "an expired proposal: no Approve");
  const old = proposal("e", { feeSig: undefined });
  assert.equal(count([old]), 0, "a proposal from before the fee keys");
  const only3 = { host: { ...ctl.host, canWriteAs: (i) => i === 3 } };
  assert.equal(count(two, {}, only3), 2, "seat 3 can sign");
  assert.equal(count(two, { a: { 3: {} }, b: { 3: {} } }, only3), 0, "seat 3 approved both");
  const none = { host: { ...ctl.host, canWriteAs: () => false } };
  assert.equal(count(two, {}, none), 0, "no seat of this browser has a signing key");
  const noShare = { host: { ...ctl.host, sec: () => ({ sol: {} }) } };
  assert.equal(count(two, {}, noShare), 0, "no seat holds a Solana key share");
  const stop = docs({ solabort: { 2: { reason: "A test stop." } } });
  assert.equal(count(two, {}, stop), 0, "a stopped part has no proposal to approve");
  assert.equal(count(two, {}, docs({ soldone: {} })), 0, "the seats do not agree on one key");
  // The side item of the wallet and its Solana section show the count of the open wallet.
  const kept = [ctl.sessions, ctl.commits, t.state.groups];
  Object.assign(ctl, { sessions: two, commits: {} });
  t.state.groups = [t.state.g];
  try {
    const side = sideTree().kids;
    const wallet = side.find((n) => n.attrs?.["data-key"] === "wallet-" + t.state.gid);
    assert.ok(labelled(wallet, "2 to approve"), "the side item shows the count");
    const section = side.find((n) => n.attrs?.id === "tab-solana");
    assert.ok(section && labelled(section, "2 to approve"), "the Solana section shows the count");
    const inbox = side.find((n) => n.attrs?.id === "tab-approvals");
    assert.ok(inbox && labelled(inbox, "2 to approve"), "the Approvals section counts them too");
    overviewWiring(ctl);
    // A click on the open wallet shows its overview and keeps its chain: no second sync starts.
    const open = { gid: t.state.gid, syncing: true };
    t.setChain(open);
    Object.assign(ui, { tab: "solana" });
    t.state.sid = "zz";
    wallet.on.click();
    assert.deepEqual([t.chain, ui.tab, t.state.sid, t.state.gid],
      [open, "overview", null, open.gid], "the same wallet, on its overview, with no payment open");
    t.setChain(null);
    inboxWiring();
    Object.assign(ctl, { sessions: [], commits: {} });
    assert.ok(!labelled(sideTree(), "2 to approve"), "no count without a proposal");
    emptyInbox();
    receiveTexts();
    inviteTexts();
    moveWords();
    activityList(ctl);
    sideMenu();
    await settingsSection();
  } finally {
    [ctl.sessions, ctl.commits, t.state.groups] = kept;
  }
}

// ── S6: every section of the wallet stays in reach at every width ──
// The sections stack in the side list, which a Menu button opens on a phone and which scrolls
// there, so no section sits past the edge. The widths are measured in Chrome (solspike phone
// checks): the rules here are what they need.
{
  const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /^\.tabs? \{/m, "no tab bar comes back");
  assert.match(css, /^#side-nav \{[^}]*display: grid/m, "the sections stack");
  assert.match(css, /\.side\.menu-open #side-nav \{[^}]*overflow: auto/, "the phone menu scrolls");
  assert.match(css, /\.side\.menu-open #side-nav \{[^}]*background: var\(--panel\)/,
    "the phone menu is opaque");
  assert.match(css, /body:has\(\.side\.menu-open\)::after \{[^}]*background: var\(--scrim\)/,
    "and dims the page behind it");
  assert.doesNotMatch(css, /\.btn:disabled[^{]*\{[^}]*opacity/,
    "a disabled button keeps the contrast of its text");
  const disabled = /\.btn:disabled, \.btn\.primary:disabled \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(disabled, /background: var\(--sunk\).*color: var\(--faint\)/s,
    "faint on sunk, the pair that contrast.mjs checks");
  assert.match(css, /\.btn\.ghost:hover:not\(:disabled\)/, "a disabled ghost button keeps still");
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
assert.match(plain.text, /Every device must keep Zigs open until setup finishes/);
assert.match(plain.text, /Step 2 of 5: Connect\. Every device joins with the invite link/,
  "the stepper of the setup page: seats are open");
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
// The password of the site and the browser (S10, owner decision D1), in every invite text. The
// site asks for a user name too, and any user name works (cf/src/index.js).
const PASSWORD = new RegExp("The browser asks for a user name and a password before Zigs opens\\. "
  + "Use any user name\\. I send the password to you apart from this link\\.");
const BROWSER = /Open the link in Safari or Chrome\. Do not open it in a chat app browser or a/;
for (const text of [inviteMessage(link), plain.invite, chatMessage(link)]) {
  assert.match(text, PASSWORD);
  assert.match(text, BROWSER);
}
// The invite cards of a wallet and of a chat say the same to the sender.
const SENDER = new RegExp("asks for a user name and a password before Zigs opens\\. Any user name "
  + "works\\. Send the password apart from the link\\. Tell "
  + "(each person who joins|each person who opens it|your contact) to open the "
  + "link in Safari or Chrome\\. The browser of a chat app or a private window can delete the key");
assert.match(pageText(), SENDER, "the invite card of a wallet");
hiddenLink(pageTree(), inviteLink(gid), "the setup card");
// A failed copy of a secret link opens its disclosure, so the person can select the link there.
{
  const { copyBtn } = await import("../app-dom.js");
  const real = globalThis.document, nav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  globalThis.document = { createElement: () => new Rec(), createElementNS: () => new Rec(),
    createTextNode: (text) => ({ text }) };
  let button;
  try {
    button = copyBtn(inviteLink(gid), "Copy link");
  } finally {
    globalThis.document = real;
  }
  const opened = [], disclosure = { setAttribute: (k) => opened.push(k) };
  const section = { querySelector: (q) => (q === "details[data-link]" ? disclosure : null) };
  const target = { textContent: "Copy link", closest: (q) => (q === "section" ? section : null) };
  Object.defineProperty(globalThis, "navigator", { configurable: true,
    value: { clipboard: { writeText: async () => { throw new Error("denied"); } } } });
  try {
    await button.on.click({ currentTarget: target });
  } finally {
    if (nav) Object.defineProperty(globalThis, "navigator", nav);
    else delete globalThis.navigator;
  }
  assert.deepEqual(opened, ["open"], "a failed copy opens the link to select");
  assert.equal(target.textContent, "Select and copy");
}
{
  const cid = "c0ffee00c0ffee00c0ff";
  chats.list[cid] = { key: "ab".repeat(32), member: "m", at: Date.now() };
  const real = globalThis.document;
  globalThis.document = { createElement: () => new Rec(), createElementNS: () => new Rec(),
    createTextNode: (text) => ({ text }) };
  try {
    const card = chatInviteCard(cid);
    assert.match(textOf(card), SENDER, "the invite card of a chat");
    hiddenLink(card, chatLink(cid), "the chat card");
    assert.match(textOf(card), /The browser of your contact asks/);
  } finally {
    globalThis.document = real;
    delete chats.list[cid];
  }
}
assert.match(SOL_DISCLOSURE, /public program address.*fee address.*Helius.*no audit/);
assert.ok(SOL_DISCLOSURE.includes(PUBLIC_TEXT), "the choice says what the Solana tab says");
assert.match(SOL_DISCLOSURE, /Every device sees the whole Solana history/);
// A browser with no seat of the wallet gets the join card, with the disclosure before the seat.
{
  const kept = t.secrets[gid + ":1"];
  delete t.secrets[gid + ":1"];
  const join = pageText();
  t.secrets[gid + ":1"] = kept;
  assert.match(join, /Join as device 2/);
  assert.ok(join.includes(SOL_DISCLOSURE), "the join card says what Solana makes public");
  assert.match(join, /Then open the link in Safari or Chrome first\./, "where to open the link");
}
// The preload: the module loads at the start of setup, and no Solana watch opens before the
// people of the wallet confirmed the network.
// S12: a failed load says why and waits for Try again. The server first answers 503.
config.down = true;
t.refilter();
await waitFor("the preload", () => t.solLoading !== null);
await t.solLoading;
assert.equal(t.sol, null, "the load failed");
assert.match(t.solError, /not available on this server/);
const solTabText = () => {
  const real = globalThis.document;
  globalThis.document = { createElement: () => new Rec(), createElementNS: () => new Rec(),
    createTextNode: (text) => ({ text }) };
  try {
    return textOf(t.solTab());
  } finally {
    globalThis.document = real;
  }
};
assert.match(solTabText(), /^Solana did not load\. Check your connection, then press Try again/,
  "a config failure says Try again");
const NOT_SERVED = /Solana did not load: Solana is not available on this server/;
assert.match(t.banner.text, NOT_SERVED, "the banner says why");
// The setup step says it once, with no Try again button on this page, and the page asks no one
// to wait for a Solana part that did not load.
assert.doesNotMatch(pageText(), BOTH_OPEN, "no wait for a Solana part that did not load");
assert.match(pageText(), /Create the Solana key.*Solana is not available on this server/s);
assert.doesNotMatch(pageText(), /Solana did not load: Solana is not/);
const { solRetry, whyNotLoaded, loadFail } = await import("../app-sol.js");
solRetry();
await t.solLoading;
assert.match(t.solError, /not available on this server/, "a failed retry fails again");
assert.match(t.banner?.text ?? "", NOT_SERVED, "and the banner stays");
config.down = false;
solRetry();
await waitFor("the load after Try again", () => !!t.sol);
assert.equal(t.solError, "", "and the error is gone");
assert.equal(t.banner, null, "and the banner goes away");
{
  const loaded = t.solLoading;
  solRetry();
  assert.equal(t.solLoading, loaded, "a second tap after a good retry loads nothing");
}
{
  // A failed load that is not a refusal of the server is the connection (SOL-26). A refusal is
  // a 503 (SOL off) or a 404. Only the Solana tab has a Try again button.
  const real = globalThis.fetch;
  const why = async (status) => {
    globalThis.fetch = async () => {
      if (!status) throw new TypeError("Failed to fetch");
      return new Response("x", { status });
    };
    try {
      return await whyNotLoaded();
    } finally {
      globalThis.fetch = real;
    }
  };
  for (const status of [503, 404]) {
    assert.match(await why(status), /^Solana is not available on this server$/, "status " + status);
  }
  for (const status of [500, 200, 0]) {
    const text = await why(status);
    assert.match(text, /^Solana did not load\. Check your connection, then reload the page\.$/);
  }
  // The Solana tab: an import failure says reload (a browser keeps a failed import for the
  // page), and a failure after the import gets Try again.
  const down = await why(0);
  const failTree = (error, retry) => {
    const real = globalThis.document;
    globalThis.document = { createElement: () => new Rec(), createElementNS: () => new Rec(),
      createTextNode: (text) => ({ text }) };
    try {
      return loadFail(error, retry);
    } finally {
      globalThis.document = real;
    }
  };
  const imported = failTree(down, false);
  assert.equal(textOf(imported), down, "an import failure: reload");
  assert.equal(byText(imported, "Try again"), null, "and no Try again button");
  const after = failTree("Failed to fetch", true);
  const RETRY = /^Solana did not load\. Check your connection, then press Try again\./;
  assert.match(textOf(after), RETRY, "a failure after the import says Try again");
  assert.ok(byText(after, "Try again"), "next to the button");
}
assert.equal(rig.live(`groups/${gid}/sol`), 0, "and opened no Solana watch");
// The setup card lists the two Solana steps after the three Zcash steps.
const setupText = pageText();
assert.match(setupText, /Create the Solana key.*Starts after the Zcash part\./s);
assert.match(setupText, /Fund your fee address.*Comes after the Solana key\./s);

// ── The create dialog offers Solana for a testnet wallet, on a server that serves it ──
function dialogTree(from = null) {
  const real = globalThis.document;
  globalThis.document = { createElement: () => new Rec(), createElementNS: () => new Rec(),
    createTextNode: (text) => ({ text }) };
  try {
    return createDialog(from);
  } finally {
    globalThis.document = real;
  }
}
const dialogText = (from = null) => textOf(dialogTree(from));
const byId = (node, id) =>
  node.attrs?.id === id ? node : (node.kids ?? []).map((k) => byId(k, id)).find(Boolean) ?? null;
// The text that shows: a hidden step adds nothing.
const shownText = (node) => node.text
  ?? (node.attrs?.hidden === "" ? "" : node.kids.map(shownText).join(""));
const atStep = (step, fn) => {
  ui.createStep = step;
  try {
    return fn();
  } finally {
    ui.createStep = 0;
  }
};
// `fields`: the elements by id that the dialog reads; other ids go to the stub page.
const withFields = (fields, fn) => {
  const real = globalThis.document;
  const getElementById = (id) =>
    (Object.hasOwn(fields, id) ? fields[id] : real.getElementById(id));
  globalThis.document = new Proxy(real, { get: (o, k) => (k === "getElementById" ? getElementById
    : real[k]) });
  try {
    return fn();
  } finally {
    globalThis.document = real;
  }
};
const EV = { preventDefault() {}, currentTarget: null, target: {} };
const RULE_2_OF_3 = { "g-n": { value: "3" }, "g-t": { value: "2" } };
// Submits the new-wallet dialog `times` times, from the first step unless `fresh` is false.
async function walkSteps(fields, times, fresh = true) {
  if (fresh) ui.createStep = 0;
  for (let i = 0; i < times; i++) {
    const submit = dialogTree().on.submit;
    await withFields(fields, () => submit(EV));
  }
}
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
  // The picker offers testnet only (mainnet-off.mjs). A Change devices dialog has no choice.
  assert.doesNotMatch(textOf(dialogTree({ ...g, network: "mainnet" })), CHOICE, "never for `from`");
  config.down = true;
  delete ui.solServed;
  dialogText();
  await waitFor("the refusal", () => ui.solServed === false);
  assert.doesNotMatch(dialogText(), CHOICE, "not on a server without Solana");
  config.down = false;
  delete ui.solServed;
}

// ── S1: a button that is off shows why, as text next to it ──
// The first reason that holds wins: the engine, the group server, a read-only page, a wallet
// that waits for its check, a join that runs.
{
  const WHY = {
    loading: "Zigs is still loading its crypto engine.",
    failed: "The crypto engine did not load. Reload the page.",
    server: "Zigs is not connected to the group server yet.",
    readOnly: "This page is read-only here.",
    pending: "Zigs is still checking this wallet's data. Try again in a moment.",
    joining: "Zigs is joining the chat. Wait a moment.",
  };
  const on = { Z: {}, settled: true, canWrite: true, db: true, pending: false, joining: false };
  assert.equal(offReason(on), "", "everything ready: no reason");
  assert.equal(offReason({ ...on, Z: null }), WHY.failed);
  assert.equal(offReason({ ...on, Z: null, settled: false }), WHY.loading);
  assert.equal(offReason({ ...on, db: false }), WHY.server);
  assert.equal(offReason({ ...on, canWrite: false }), WHY.readOnly);
  assert.equal(offReason({ ...on, pending: true }), WHY.pending);
  assert.equal(offReason({ ...on, joining: true }), WHY.joining);
  const noDb = { ...on, db: undefined };
  assert.equal(offReason(noDb), "", "a button that does not need the server leaves db out");
  const all = { Z: null, settled: false, canWrite: false, db: false, pending: true, joining: true };
  assert.equal(offReason(all), WHY.loading, "the engine comes first");
  const noZ = { ...all, Z: {} };
  assert.equal(offReason(noZ), WHY.server, "then the group server");
  assert.equal(offReason({ ...noZ, db: true }), WHY.readOnly, "then a read-only page");
  assert.equal(offReason({ ...noZ, db: true, canWrite: true }), WHY.pending, "then the check");

  // The pages: each button is off, with its reason in the text and its id in aria-describedby.
  const swap = (build, change) => {
    const keep = { Z: engine.Z, db: groups.db };
    if ("Z" in change) t.setZ(change.Z);
    if ("db" in change) t.setDb(change.db);
    const real = globalThis.document;
    globalThis.document = { createElement: () => new Rec(), createElementNS: () => new Rec(),
      createTextNode: (text) => ({ text }), documentElement: { dataset: {} } };
    try {
      return build();
    } finally {
      globalThis.document = real;
      t.setZ(keep.Z);
      t.setDb(keep.db);
    }
  };
  // The text of the reason with this id, or "none" when the page shows no such reason.
  const says = (tree, id) => (byId(tree, id) ? textOf(byId(tree, id)) : "none");
  const engine = await import("../app-engine.js"), groups = await import("../app-groups.js");
  const { joinLinks } = await import("../app-messages.js");
  const { busy } = await import("../app-state.js");
  const buttons = [
    ["Set up a wallet", "why-create", () => lobby()],
    ["Create wallet", "why-create-submit", () => atStep(3, () => createDialog())],
    ["Join wallet", "why-join-wallet", () => { ui.joinOpen = true; return lobby(); }],
    ["New chat", "why-new-chat", () => lobby()],
    ["Join chat", "why-chat-join-cc", () => lobby()],
  ];
  const cc = "cc".repeat(10);
  joinLinks.set(cc, "k".repeat(64));
  try {
    for (const [label, id, build] of buttons) {
      const idFor = id.replace("-cc", "-" + cc);
      for (const [change, why] of [[{ Z: null }, WHY.loading], [{ db: null }, WHY.server]]) {
        const tree = swap(build, change);
        const button = byText(tree, label);
        assert.ok(button, label + " is on the page");
        assert.equal(button.attrs.disabled, "", label + " is off: " + why);
        assert.equal(button.attrs["aria-describedby"], idFor, label + " points at its reason");
        const note = byId(tree, idFor);
        assert.ok(note, label + " has a reason next to it");
        assert.equal(textOf(note), why, label + " says why");
      }
      const tree = swap(build, {});
      assert.ok(!("disabled" in byText(tree, label).attrs), label + " is on");
      assert.equal(byId(tree, idFor), null, label + " has no reason");
    }
    // Only the last step of a new wallet writes, so the steps before it stay on.
    const offline = swap(() => createDialog(), { db: null });
    assert.ok(!("disabled" in byText(offline, "Set up my wallet").attrs),
      "the steps before the review stay on");
    // A join that runs also switches Join chat off.
    busy.add("chatjoin:" + cc);
    const tree = swap(() => lobby(), {});
    assert.equal(says(tree, "why-chat-join-" + cc), WHY.joining, "a join that runs");
    busy.delete("chatjoin:" + cc);
  } finally {
    joinLinks.delete(cc);
    busy.delete("chatjoin:" + cc);
  }
  // The setup page: It matches, Join as device and Play device.
  const setup = (change, pending = false) => {
    t.state.pending = pending;
    try {
      return swap(() => t.groupView(), change);
    } finally {
      t.state.pending = false;
    }
  };
  assert.equal(says(setup({ Z: null }), "why-play"), WHY.loading, "Play device");
  assert.equal(says(setup({}, true), "why-play"), WHY.pending, "Play device waits");
  assert.equal(byId(setup({}), "why-play"), null, "Play device is on");
  const kept = t.secrets[gid + ":1"];
  delete t.secrets[gid + ":1"];
  try {
    const join = (change, pending) => setup(change, pending);
    assert.equal(says(join({ Z: null }), "why-take"), WHY.loading, "Join as device");
    assert.equal(says(join({}, true), "why-take"), WHY.pending, "Join as device waits");
    assert.equal(byId(join({}), "why-take"), null, "Join as device is on");
  } finally {
    t.secrets[gid + ":1"] = kept;
  }
}

// ── S1: the setup card shows the state of the link to the group server while not open ──
{
  const states = { state: "retrying", retryAt: Date.now() + 5000, code: 0, groups: {} };
  const SHOWN = /Connecting to the group server…|The group server does not answer[^.]*\./;
  const line = (s) => {
    onLink(s);
    return pageText().match(SHOWN);
  };
  assert.equal(line({ state: "idle", retryAt: 0, code: null, groups: {} }), null, "idle");
  assert.equal(line({ ...states, state: "open", retryAt: 0, code: null }), null, "open");
  assert.equal(line({ ...states, state: "connecting", code: null })?.[0],
    "Connecting to the group server…");
  assert.equal(line(states)?.[0], "The group server does not answer (no network).");
  assert.equal(line({ ...states, code: 401 })?.[0],
    "The group server does not answer (the preview password is missing or wrong).");
  assert.equal(line({ ...states, code: 429 })?.[0],
    "The group server does not answer (too many connections from this network).");
  assert.equal(line({ ...states, code: 404 })?.[0], "The group server does not answer.");
  onLink({ state: "open", retryAt: 0, code: null, groups: {} });
  assert.doesNotMatch(pageText(), /group server does not answer|Connecting to the group server/);
}

// ── The dialog reads the small config body to its end: a cancel is a failed request ──
{
  const real = globalThis.fetch;
  let cancelled = false, read = false;
  globalThis.fetch = async () => new Response(new ReadableStream({
    pull(ctl) {
      ctl.enqueue(new TextEncoder().encode("{}"));
      ctl.close();
      read = true;
    },
    cancel() {
      cancelled = true;
    },
  }), { status: 200 });
  try {
    delete ui.solServed;
    solServed();
    await waitFor("the config answer", () => ui.solServed === true && (read || cancelled));
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(cancelled, false, "the config body is read, not cancelled");
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
  assert.doesNotMatch(t.banner?.text ?? "", /Device 1 waits/,
    "and shows no refusal while it waits");
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
  const wallet = t.sec(gidW, 1).checkedWallet;
  // Saved, not only in memory: each Solana write first takes what storage holds.
  await t.putSec(gidW, 1, { checkedWallet: null, rejectedWallet: wallet });
  await planSolana(gidW);
  t.refilter();
  assert.match(pageText(), /Setup stopped at Prepare\. /, "a seat that rejected the address");
  await sleep(3500);
  assert.equal(data.has(`groups/${gidW}/solstart/1`), false, "no start before Address checked");
  assert.doesNotMatch(t.banner?.text ?? "", /Device 1 waits/, "and no refusal before it");
  // Who starts the Solana part: seat 1 with the choice, seat 1 of a moved wallet, another seat.
  assert.match(pageText(), /Create the Solana key.*Starts when the Zcash address is checked\./s);
  t.state.g.movedTo = "elsewhere";
  assert.match(pageText(), /Tap Add Solana in the Solana section to start it\./, "a moved wallet");
  delete t.state.g.movedTo;
  const seat1 = t.secrets[gidW + ":1"];
  delete t.secrets[gidW + ":1"];
  const other = pageText();
  t.secrets[gidW + ":1"] = seat1;
  assert.match(other, /Device 1 starts it after the Zcash address check\./, "a browser of seat 2");
  await t.putSec(gidW, 1, { checkedWallet: wallet, rejectedWallet: null });
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
  const BY_HAND = /Solana is still setting up.*Tap Add Solana in the Solana section to start/s;
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
  assert.match(pageText(), /Send Devnet SOL to your fee address in the Solana section/);
  assert.match(pageText(), /Open Solana/);
  assert.match(pageText(), /Each device funds its own fee address/);
  // The balances of the last read (refreshChain): every fee address of this browser holds SOL.
  t.sol.ctl.chain = { fees: { 1: "0.006 SOL", 2: "0.0025 SOL", 3: "0.0025 SOL" } };
  assert.doesNotMatch(pageText(), /Solana is still setting up/, "a funded part needs no card");
  t.sol.ctl.chain = { fees: { 1: "0.006 SOL", 2: "0 SOL", 3: "0.0025 SOL" } };
  assert.match(pageText(), /Solana is still setting up/, "one empty fee address keeps the card");
  t.sol.ctl.chain = {};
  ui.tab = "members";
  assert.match(pageText(), SENDER, "the invite link of the Devices tab");
  ui.tab = "overview";
  // A stopped Solana part: the Zcash part still works, and the next step is a new wallet.
  const kept = t.sec(gidH, 1).sol;
  const aborted = "Solana setup stopped: a test. Do not use the Solana part of this wallet.";
  await t.putSec(gidH, 1, { sol: { ...kept, aborted } });
  const NEXT = /The Zcash part of this wallet still works\. To use Solana, create a new wallet\./;
  assert.match(pageText(), /The Solana part stopped.*The Solana setup stopped/s);
  assert.match(pageText(), NEXT);
  assert.match(pageText(), /Create a new wallet/);
  assert.ok(walletReady(), "the Zcash part is still ready");
  assert.ok(solOn(), "this wallet has a Solana part");
  assert.match(dialogText(t.state.g),
    /all its Zcash funds.*If this wallet has a Solana part, it does not /s,
    "Change devices says that the Solana part does not move");
  ui.tab = "solana";
  assert.match(pageText(), new RegExp(aborted.replace(/\./g, "\\.") + " " + NEXT.source));
  ui.tab = "overview";
  // The button leaves the wallet for the wallet list, where the create dialog shows.
  Object.assign(ui, { createStep: 2, createDraft: { n: 3, t: 2 }, marginAck: true });
  byText(pageTree(), "Create a new wallet").on.click();
  assert.equal(t.state.gid, null, "the wallet closed");
  assert.equal(ui.create, true, "the create dialog opens");
  assert.deepEqual([ui.createStep, ui.createDraft, ui.marginAck], [0, null, false],
    "a dialog opens at its first step");
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
  ui.tab = "solana";
  assert.doesNotMatch(pageText(), /Add Solana/, "a stopped part offers no start");
  ui.tab = "overview";
}

// ── The backup note asks for the Solana file of each seat, until it is saved ──
{
  const gidS = await rig.wallet({ name: "Files" });
  await t.solLoad();
  await t.sol.add();
  const done = (i) => data.has(`groups/${gidS}/soldone/${i}`);
  await waitFor("every soldone", () => [1, 2, 3].every(done), 30000);
  // S15: the tab says the status in a sentence.
  ui.tab = "solana";
  await waitFor("the ready tab", () => /The Solana part is ready\./.test(pageText()));
  ui.tab = "overview";
  // The side item and the inbox read the live documents: their checks end first.
  await waitFor("the documents are checked", () => !t.sol.ctl.wait && !t.sol.ctl.sessWait);
  await approvalCount(t.sol.ctl);
  // The first sentence names the file that is unsaved: a Zcash file, or only a Solana file.
  const note = (...args) => {
    const real = globalThis.document;
    globalThis.document = { createElement: () => new Rec(), createElementNS: () => new Rec(),
      createTextNode: (text) => ({ text }) };
    try {
      return textOf(t.backupNote(...args));
    } finally {
      globalThis.document = real;
    }
  };
  assert.match(note([2], [1]), /^Back up your key share\. This browser can forget it/);
  assert.match(note([], [1]), /^Back up the Solana part of your key share\. This browser can/);
  assert.match(note([], [1]), /second file, with its own passphrase/);
  assert.doesNotMatch(note([2], []), /Solana/);
  const solButtons = () => pageText().match(/Back up Solana, device \d/g) ?? [];
  await waitFor("the note", () => solButtons().length === 3);
  assert.match(pageText(), /The Solana part of a device is a second file, with its own passphrase/);
  // S13: a new wallet has no older file, so the note says nothing about an older format.
  assert.doesNotMatch(pageText(), /backup format changed|iPhone and Mac apps/);
  const saved = [];
  t.setDownloads({ save: async (file) => void saved.push(file) });
  const words = backupWords(t.sol.ctl, 2);
  assert.equal(await words.save("a long passphrase for the solana file"), true);
  assert.equal(saved.length, 1, "one file");
  assert.equal(t.sec(gidS, 2).sol.backupSaved, true);
  assert.deepEqual(solButtons(), ["Back up Solana, device 1", "Back up Solana, device 3"]);
  // A stop by another seat stops the Solana backups too.
  const stop = await t.signedDoc(gidS, "solabort/2", 2, { reason: "A test stop.", at: Date.now() });
  data.set(`groups/${gidS}/solabort/2`, stop);
  rig.notify();
  await waitFor("no Solana backup is asked", () => solButtons().length === 0);
}

// ── The steps of a new wallet: Next, Enter, Cancel, and the tick of a rule without margin
{
  // Each Next keeps the values of its step. Enter submits at every step, so a submit before the
  // review only goes on. A rule without margin needs the tick, at Next and at the submit.
  const groups = t.state.groups.length, gid = t.state.gid;
  const fields = { ...RULE_2_OF_3, "g-name": { value: " Steps " }, "my-name": { value: "Ana" },
    "g-sol": { checked: false } };
  await walkSteps(fields, 3);
  assert.equal(t.state.gid, gid, "a submit from the names step creates nothing");
  assert.equal(t.state.groups.length, groups);
  assert.equal(ui.createStep, 3, "the review");
  assert.deepEqual(ui.createDraft, { n: 3, t: 2, name: "Steps", label: "Ana", sol: false },
    "each Next keeps the values of its step");
  let held = 0;
  const click = (detail) => byText(dialogTree(), "Create wallet").on.click({ detail,
    preventDefault: () => held++ });
  click(1);
  assert.equal(held, 1, "a tap soon after the step change does not submit");
  click(0);
  assert.equal(held, 1, "a script or the Enter key submits at once");
  click(2);
  assert.equal(held, 2, "the second click of a double click does not submit");
  await sleep(450);
  click(1);
  assert.equal(held, 2, "a later click submits");
  // Back goes one step back; the second click of a double click does nothing more.
  const back = (detail) => byText(dialogTree(), "Back").on.click({ detail });
  back(0);
  assert.equal(ui.createStep, 2, "Back goes one step back");
  back(2);
  assert.equal(ui.createStep, 2, "a double click on Back goes back once");
  // Two quick Enter presses reach the same form: the second counts for no later step.
  const namesForm = dialogTree();
  await withFields(fields, () => namesForm.on.submit(EV));
  await withFields(fields, () => namesForm.on.submit(EV));
  assert.equal(t.state.gid, gid, "a second Enter on the names step creates nothing");
  assert.equal(ui.createStep, 3, "and leaves the review on screen");
  ui.sol = false;
  byText(dialogTree(), "Cancel").on.click();
  assert.deepEqual([ui.createStep, ui.createDraft], [0, null], "Cancel puts back the first step");
  assert.equal(ui.sol, undefined, "Cancel forgets the Solana choice");
  await walkSteps({ ...fields, "g-n": { value: "9" } }, 2);
  assert.equal(ui.createStep, 1, "Next checks the rule");
  assert.match(ui.createError ?? "", /between 2 and 7 devices/);
  const noMargin = { ...fields, "g-t": { value: "3" } };
  await walkSteps(noMargin, 2);
  assert.equal(ui.createStep, 1, "no tick: the rule step stays");
  assert.match(ui.createError ?? "", /Confirm that one lost device stops all payments/,
    "the error shows in the dialog");
  const tree = dialogTree(), bar = findNode(tree, (n) => n.className === "dialog-actions");
  assert.ok(byId(tree, "create-error"), "the error is in the dialog");
  assert.equal(byId(bar, "create-error"), null, "and not in the button bar");
  byText(dialogTree(), "Back").on.click({ detail: 0 });
  assert.equal(ui.createError, null, "Back clears the error of a step");
  await walkSteps(noMargin, 1, false);
  ui.marginAck = true;
  await walkSteps(noMargin, 1, false);
  assert.equal(ui.createStep, 2, "with the tick, Next goes on");
  assert.equal(ui.createError, null, "and clears the message");
  Object.assign(ui, { createStep: 3, createDraft: { n: 3, t: 3, name: "x" }, marginAck: false });
  await dialogTree().on.submit(EV);
  assert.equal(t.state.gid, gid, "the submit checks the tick too");
  assert.match(appState.banner.text, /Confirm that one lost device stops all payments/);
  endCreate();
  assert.deepEqual([ui.createStep, ui.createDraft, ui.marginAck], [0, null, false]);
  Object.assign(ui, { create: true, createStep: 2, createDraft: { n: 3, t: 2 } });
  t.openGroup(gid);
  assert.deepEqual([ui.create, ui.createStep, ui.createDraft], [false, 0, null],
    "an open wallet closes the create dialog");
  await waitFor("the wallet again", () => t.state.wallet);
}

// ── The submit: the choice reaches seat 1 only for a new wallet with the box on ──
{
  const real = globalThis.FormData;
  const newWallet = async (sol) => {
    const box = sol === null ? null : { checked: sol };
    ui.net = "testnet";
    const fields = { ...RULE_2_OF_3, "g-name": { value: "Submitted" }, "my-name": { value: "" },
      "g-sol": box };
    await walkSteps(fields, 3);
    storage.set("zf-name", "Bob");
    await walkSteps({ ...fields, "g-name": { value: "Live" }, "my-name": { value: "Live label" } },
      1, false);
    const gidN = t.state.gid;
    return { auto: t.sec(gidN, 1)?.solAuto === true, hint: data.get(groupPath(gidN)).solana };
  };
  assert.deepEqual(await newWallet(true), { auto: true, hint: true }, "the box on");
  assert.equal(data.get(groupPath(t.state.gid)).name, "Submitted", "the name of the review");
  assert.equal(storage.get("zf-name"), "", "the seat takes the label of the review");
  assert.deepEqual(await newWallet(false), { auto: false, hint: undefined }, "the box off");
  assert.deepEqual(await newWallet(null), { auto: false, hint: undefined }, "no box");
  assert.equal(ui.createStep, 0, "a created wallet puts the dialog back at its first step");
  globalThis.FormData = class {
    get(k) {
      return { name: "Submitted", n: "3", t: "2", sol: "on" }[k] ?? null;
    }
  };
  const gidOld = t.state.gid;
  ui.move = true;
  try {
    await dialogTree(t.state.g).on.submit(EV);
  } finally {
    globalThis.FormData = real;
  }
  const gidN = t.state.gid;
  assert.notEqual(gidN, gidOld, "Change devices makes the new wallet");
  const made = { auto: t.sec(gidN, 1)?.solAuto === true, hint: data.get(groupPath(gidN)).solana };
  assert.deepEqual(made, { auto: false, hint: undefined }, "Change devices");
  globalThis.FormData = class {
    get(k) {
      return { name: "Full", n: "3", t: "3" }[k] ?? null;
    }
  };
  ui.marginAck = false;
  ui.move = true;
  try {
    await dialogTree(t.state.g).on.submit(EV);
  } finally {
    globalThis.FormData = real;
  }
  assert.equal(t.state.gid, gidN, "Change devices asks for the tick too");
  assert.match(appState.banner?.text ?? "", /Confirm that one lost device stops all payments/);
}

// ── The stepper: a stop shows its own text at its stage, never a stage on track ──
{
  const gidS = t.state.gid;
  assert.match(pageText(), /Step 2 of 5: Connect\./, "a new wallet waits for its seats");
  await t.putSec(gidS, 1, { aborted: "A test stop of this device." });
  assert.match(pageText(), /Setup stopped at Connect\. A test stop of this device\./,
    "the stop and its text");
  assert.doesNotMatch(pageText(), /Step 2 of 5/);
}

// ── The stepper at each stage of a formed wallet; a stop stays at its stage ──
{
  ui.chainFilter = "sol";
  await rig.wallet({ name: "Stages" });
  assert.equal(ui.chainFilter, "all", "another wallet opens with All");
  const keep = { wallet: t.state.wallet, confirm: t.state.confirm, done: t.state.done };
  try {
    Object.assign(t.state, { wallet: null, confirm: {} });
    assert.match(pageText(), /Step 3 of 5: Verify\. /, "every seat taken, no number confirmed");
    Object.assign(t.state, { confirm: keep.confirm, done: {} });
    assert.match(pageText(), /Step 4 of 5: Prepare\. /, "the key ceremony runs");
    Object.assign(t.state, { done: keep.done, wallet: { ...keep.wallet, birthday: undefined } });
    assert.match(pageText(), /Setup stopped at Prepare\. /, "a wallet with no birthday");
    assert.doesNotMatch(pageText(), /stopped at Back up/);
  } finally {
    Object.assign(t.state, keep);
  }
}

// ── The create dialog: one step at a time for a new wallet, one form for a change ──
{
  const shown = (step) => atStep(step, () => shownText(dialogTree()));
  assert.match(shown(0),
    /^New shared wallet×Your wallet, protected together.*CancelSet up my wallet$/s);
  assert.match(shown(1),
    /Choose your protection.*Any 2 of 3 devices must.*Advanced approval rule.*CancelBackNext$/s);
  assert.match(shown(2),
    /Name your wallet.*This device's label.*Wallet name.*Network.*BackReview wallet$/s);
  ui.createDraft = { n: 4, t: 3, name: "Team", label: "Ana's phone", sol: true };
  assert.match(shown(3), new RegExp("Review your wallet.*Wallet nameTeam.*This device's labelAna's "
    + "phone.*Any 3 of 4 devices must approve each payment\\..*If devices are lost1 device can "
    + "be lost or offline.*Zcash testnet and Solana Devnet.*"
    + "BackCreate wallet", "s"));
  ui.createDraft = { n: 3, t: 3, name: "", label: "", sol: false };
  assert.match(shown(3), new RegExp("TreasuryThis device's labelNone\\. The other devices show "
    + "Device 1\\..*NetworksZcash testnet[^ ]*Each payment", "s"),
    "the defaults, and the warning of a rule without margin");
  ui.createDraft = null;
  assert.equal(shown(0).match(/Choose your protection|Name your wallet|Review your wallet/), null,
    "the other steps are hidden");
}
assert.doesNotMatch(dialogText(t.state.g), /protected together/, "Change devices keeps its form");
assert.match(shownText(dialogTree(t.state.g)),
  /New wallet name.*Devices.*Approvals needed.*Create new wallet/s);
assert.equal(marginText(2, 3), "1 device can be lost or offline, and the wallet still pays. Any 2 "
  + "devices together can spend the funds, so keep each one safe.", "the margin of 2 of 3");
assert.match(marginText(3, 5), /^2 devices can be lost or offline.*Any 3 devices together/);
{
  // Change devices makes a wallet too, so it says what a lost device means.
  const move = dialogTree(t.state.g);
  assert.match(shownText(move), /can be lost or offline|Each payment needs every device/,
    "Change devices shows what a lost device means");
  assert.equal(byId(move, "g-t").attrs["aria-describedby"], "margin-text");
}
assert.match(marginText(3, 3), /Each payment needs every device/);
{
  // The line of t = n is in the dialog, a screen reader hears it change, and a change of the
  // numbers updates it and shows the box. The first focus goes to the button of the first step.
  const dialog = dialogTree();
  const margin = byId(dialog, "margin-text");
  assert.equal(margin?.attrs.role, "status");
  assert.equal(byId(dialog, "g-t").attrs["aria-describedby"], "margin-text");
  assert.equal(byText(dialog, "Set up my wallet").attrs["data-first-focus"], "",
    "the first step gives focus to its button");
  assert.equal(atStep(1, () => byText(dialogTree(), "Next")).attrs["data-first-focus"], undefined,
    "only the first step");
  assert.equal(byId(dialog, "g-name").attrs["data-first-focus"], undefined);
  assert.equal(byId(dialogTree(t.state.g), "g-name").attrs["data-first-focus"], undefined);
  byId(dialog, "rule-text").classList = { toggle() {} };
  const ack = findNode(dialog, (n) => n.className === "margin-ack");
  assert.equal(ack.attrs.hidden, "", "2 of 3: no box");
  const fields = { "g-n": { value: "3" }, "g-t": { value: "3" }, "create-step-1": { focus() {
    fields.focused = true;
  } } };
  withFields(fields, () => dialog.on.input());
  assert.match(margin.textContent, /Each payment needs every device/, "update() names the risk");
  assert.equal(ack.hidden, false, "3 of 3: the box shows");
  ui.marginAck = true;
  fields["g-margin-ack"] = { checked: true };
  appState.showBanner("bad", "Confirm that one lost device stops all payments, or use the "
    + "recommended 2 of 3.");
  withFields(fields, () => byText(ack, "Use recommended 2 of 3").on.click());
  assert.equal(appState.banner, null, "the reset clears the message of the tick");
  assert.deepEqual([ui.marginAck, fields["g-margin-ack"].checked], [false, false],
    "the reset clears the tick");
  assert.deepEqual([fields["g-n"].value, fields["g-t"].value], ["3", "2"], "the reset: 2 of 3");
  assert.match(margin.textContent, /^1 device can be lost or offline/,
    "the reset: the 2 of 3 line");
  assert.equal(ack.hidden, true, "and hides the box");
  assert.equal(fields.focused, true, "the focus goes to the heading of the step");
  withFields({ ...fields, "g-t": { value: "2.5" } }, () => dialog.on.input());
  assert.match(byId(dialog, "rule-text").textContent, /^Choose 2 to 7 devices/,
    "2.5 devices is no rule");
}

// ── Device wording: the rows of the Devices tab, the seats of setup and the label field ──
{
  const gidD = t.state.gid, keepSeats = t.state.seats, tab = ui.tab;
  const keepSec = { 2: t.secrets[gidD + ":2"], 3: t.secrets[gidD + ":3"] };
  const keepState = { wallet: t.state.wallet, done: t.state.done };
  delete t.secrets[gidD + ":2"];
  delete t.secrets[gidD + ":3"];
  t.state.seats = { ...keepSeats, 2: { ...keepSeats[2], name: "Bo" },
    3: { ...keepSeats[3], name: "" } };
  try {
    ui.tab = "members";
    const rows = pageText();
    assert.match(rows, /BoDevice 2 · joined /, "a named device shows its number under its name");
    assert.match(rows, /Device 3Joined /, "an unnamed device reads Device N once");
    Object.assign(t.state, { wallet: null, done: {} });
    const seats = pageText();
    assert.match(seats, /BoDevice 2/, "the seat of setup: the name, then the device number");
    assert.doesNotMatch(seats, /Device 3Device 3/, "an unnamed seat reads Device N once");
    t.state.seats = { ...t.state.seats, 3: undefined };
    assert.match(pageText(), /Not joined/, "a free seat reads Not joined");
  } finally {
    Object.assign(t.state, keepState, { seats: keepSeats });
    t.secrets[gidD + ":2"] = keepSec[2];
    t.secrets[gidD + ":3"] = keepSec[3];
    ui.tab = tab;
  }
  const tree = dialogTree(), field = byId(tree, "my-name");
  assert.equal(field.attrs.placeholder, "For example: Ana's phone", "a short hint");
  assert.match(textOf(findNode(tree, (n) => (n.kids ?? []).includes(field))),
    /^This device's label/, "the label of the field");
}

{
  // Change devices: the reset gives the focus to the number field, its only rule control.
  const move = dialogTree(t.state.g);
  const ack = findNode(move, (n) => n.className === "margin-ack");
  const fields = { "g-n": { value: "3", focus() { fields.focused = true; } },
    "g-t": { value: "3" }, "g-margin-ack": { checked: false }, "create-step-1": null };
  byId(move, "rule-text").classList = { toggle() {} };
  withFields(fields, () => byText(ack, "Use recommended 2 of 3").on.click());
  assert.equal(fields.focused, true, "the reset of Change devices keeps the focus in the dialog");
  assert.equal(/If this wallet has a Solana part/.test(dialogText(t.state.g)), solOn(),
    "the Solana sentence only for a wallet with a Solana part");
  const g = t.state.g;
  t.state.g = { ...g, network: "mainnet" };
  try {
    assert.equal(solOn(), false, "a mainnet wallet gets no Solana part");
    assert.doesNotMatch(dialogText(t.state.g), /Solana/,
      "Change devices says nothing of Solana for a wallet with no Solana part");
  } finally {
    t.state.g = g;
  }
}

// ── Two quick submits make one wallet: the review, Change devices and createGroup ──
{
  const wallets = () => [...data.keys()].filter((k) => /^groups\/[^/]+$/.test(k)).length;
  const real = globalThis.FormData;
  let before = wallets();
  await walkSteps({ ...RULE_2_OF_3, "g-name": { value: "Twice" }, "my-name": { value: "" },
    "g-sol": null }, 3);
  const review = dialogTree();
  await Promise.all([review.on.submit(EV), review.on.submit(EV)]);
  assert.equal(wallets(), before + 1, "two submits of the review make one wallet");
  before = wallets();
  globalThis.FormData = class {
    get(k) {
      return { name: "Moved twice", n: "3", t: "2" }[k] ?? null;
    }
  };
  ui.move = true;
  try {
    const move = dialogTree(t.state.g);
    await Promise.all([move.on.submit(EV), move.on.submit(EV)]);
    assert.equal(wallets(), before + 1, "two submits of Change devices make one wallet");
    // A submit of the same form after the first one ended finds the dialog closed.
    await move.on.submit(EV);
  } finally {
    globalThis.FormData = real;
  }
  assert.equal(wallets(), before + 1, "a stale Change devices form makes no second wallet");
  before = wallets();
  const made = await Promise.allSettled([t.createGroup("One", 3, 2), t.createGroup("Two", 3, 2)]);
  assert.equal(wallets(), before + 1, "a second createGroup while one runs makes nothing");
  assert.match(made.find((r) => r.status === "rejected")?.reason?.message ?? "",
    /still creating a wallet/, "and says why");
  // A failed create frees the guard: the next create makes its wallet.
  const keepHook = rig.hook.before;
  let fail = true;
  rig.hook.before = (p, v) => {
    if (fail && /^groups\/[^/]+$/.test(p)) { fail = false; throw new Error("A test failure."); }
    return keepHook(p, v);
  };
  try {
    await assert.rejects(t.createGroup("Fails", 3, 2), /A test failure/);
  } finally {
    rig.hook.before = keepHook;
  }
  before = wallets();
  const after = await t.createGroup("After", 3, 2).catch(() => null);
  assert.ok(after, "a create after a failed one makes a wallet");
  assert.equal(wallets(), before + 1);
  // A wallet that moved already moves no more.
  globalThis.FormData = class {
    get(k) {
      return { name: "Again", n: "3", t: "2" }[k] ?? null;
    }
  };
  const g = t.state.g;
  t.state.g = { ...g, movedTo: "elsewhere" };
  ui.move = true;
  before = wallets();
  try {
    await dialogTree(t.state.g).on.submit(EV);
  } finally {
    globalThis.FormData = real;
    t.state.g = g;
  }
  assert.equal(wallets(), before, "a wallet that moved already moves no more");
  assert.match(appState.banner?.text ?? "", /moved already/);
  ui.move = false;
}

// ── The safety card: all 30 digits, a tick for this number, and They don't match ──
// This browser holds seat 1 only, with no key share yet, so the card asks it to confirm.
{
  await rig.wallet({ name: "Verify" });
  const gidV = t.state.gid, no = t.safetyNo(), k1 = gidV + ":1", k2 = gidV + ":2";
  const keep = { wallet: t.state.wallet, done: t.state.done, abort: t.state.abort };
  const kept = { 1: t.secrets[k1], 2: t.secrets[k2], 3: t.secrets[gidV + ":3"] };
  delete t.secrets[k2];
  delete t.secrets[gidV + ":3"];
  // No key share and no checked address yet: the setup is before the key ceremony.
  t.secrets[k1] = { ...kept[1], keyPackage: undefined, confirmed: undefined,
    checkedWallet: undefined };
  // The store brings the formed wallet back after each write, so each look holds the setup.
  const view = (abort = {}) => {
    Object.assign(t.state, { wallet: null, done: {}, abort });
    return pageTree();
  };
  const seen = (abort) => textOf(view(abort));
  const button = (text) => findNode(view(),
    (n) => n.attrs?.type === "button" && textOf(n) === text);
  const EV = { preventDefault() {}, currentTarget: null };
  const creates = () => {
    Object.assign(t.state, { wallet: null, done: keep.done });
    return t.canCreateWallet();
  };
  try {
    assert.match(seen(), new RegExp("Check that your devices match.*" + no + ".*The first "
      + "digits, \\d{5} \\d{3}, help you find the number\\. They are not enough: compare all 30 "
      + "digits\\.", "s"), "the full number, and the quick code as an aid");
    assert.equal(button("It matches").attrs.disabled, "", "no tick: It matches is off");
    assert.equal(button("It matches").attrs["aria-describedby"], "why-match-full");
    assert.equal(textOf(byId(view(), "why-match-full")),
      "Compare all 30 digits on every device, then tick the box.");
    ui.safetyFull = gidV + ":" + "1".repeat(30);
    assert.equal(button("It matches").attrs.disabled, "",
      "a tick for another number does not count");
    assert.match(seen(), /The safety number changed\. Compare all 30 digits again\./,
      "a tick of an older number says that the number changed");
    await button("It matches").on.click(EV);
    assert.equal(t.secrets[k1].confirmed, undefined, "the click without the tick confirms nothing");
    assert.match(t.banner?.text ?? "", /then tick the box/);
    byId(view(), "safety-full").on.change({ target: { checked: true } });
    assert.equal(ui.safetyFull, gidV + ":" + no, "the tick holds this wallet and this number");
    assert.ok(!("disabled" in button("It matches").attrs), "with the tick, It matches is on");
    byId(view(), "safety-full").on.change({ target: { checked: false } });
    assert.equal(button("It matches").attrs.disabled, "", "no tick again: It matches is off");
    byId(view(), "safety-full").on.change({ target: { checked: true } });
    await button("It matches").on.click(EV);
    assert.equal(t.secrets[k1].confirmed, no, "the tick and the click confirm");
    assert.match(seen(), /Confirmed on this device\. Waiting for the other devices\./);
    assert.equal(findNode(view(), (n) => n.attrs?.["data-key"] === "confirm-number")?.attrs
      .tabindex, "-1", "the focus stays where It matches was");
    // They don't match: a second question, then the stop of every seat of this browser.
    assert.equal(creates(), true, "before a stop, seat 1 may build the wallet");
    button("They don't match").on.click();
    assert.match(seen(), /Stop the setup on this device\? Then ask the other people to tap/);
    assert.equal(button("Keep checking").attrs["data-key"], "keep-checking",
      "the question gives the focus to Keep checking");
    button("Keep checking").on.click();
    assert.doesNotMatch(seen(), /Stop the setup on this device/, "Keep checking goes back");
    t.secrets[k2] = { ...kept[2], keyPackage: undefined, confirmed: undefined,
      checkedWallet: undefined };
    button("They don't match").on.click();
    await button("Stop setup").on.click();
    t.state.abort = {};
    assert.equal(creates(), false,
      "the own stop of seat 1 builds no wallet before any abort document");
    assert.deepEqual([t.secrets[k1].aborted, t.secrets[k2].aborted], [1, 2].map((i) => "The "
      + "person who uses device " + i + " saw a different safety number. Do not use this wallet. "
      + "Create a new wallet."), "every seat of this browser stops");
    assert.doesNotMatch(seen(), /Check that your devices match/, "the card goes");
    const stopNote = findNode(view(), (n) => n.attrs?.["data-key"] === "stop-setup");
    assert.equal(stopNote?.attrs.tabindex, "-1", "the focus stays on the stop");
    assert.match(seen(), /Stopped: no address\./, "the address step says that the setup stopped");
    assert.deepEqual([t.secrets[k1].stopped, t.secrets[k2].stopped], [true, true],
      "the stop marks each seat as stopped by its person");
    await waitFor("the abort document", () => !!data.get(`groups/${gidV}/abort/1`));
    assert.equal(creates(), false, "a stopped seat 1 builds no wallet");
    t.state.wallet = keep.wallet;
    assert.equal(walletReady(), false, "a stopped browser keeps its setup page and its stop");
    // An abort with no stop of a person (a version flip, for example) keeps the wallet page of a
    // device with a key share. An aborted seat with no key share is not in that wallet.
    t.secrets[k1] = { ...t.secrets[k1], stopped: undefined, keyPackage: kept[1].keyPackage };
    assert.equal(walletReady(), false, "a stop of the other seat of this browser keeps the setup");
    t.secrets[k2] = { ...t.secrets[k2], stopped: undefined };
    assert.equal(walletReady(), false, "an aborted seat with no key share keeps the setup page");
    t.secrets[k2] = { ...t.secrets[k2], keyPackage: kept[2].keyPackage };
    assert.equal(walletReady(), true, "an abort without a person's stop keeps the wallet page");
    // A stop of another device: the card goes, and seat 1 builds no wallet either.
    t.secrets[k1] = { ...t.secrets[k1], aborted: undefined, keyPackage: undefined };
    delete t.secrets[k2];
    const other = { 2: { reason: "A test stop." } };
    assert.doesNotMatch(seen(other), /Check that your devices match/,
      "after another device stops, the card goes");
    t.state.abort = other;
    assert.equal(creates(), false, "a stop of another device builds no wallet");
    // A stop that this browser cannot save says so.
    storage.set("zf-vault", "another tab locked the keys");
    try {
      await stopNow(gidV);
    } finally {
      storage.delete("zf-vault");
    }
    assert.match(t.banner?.text ?? "", /This browser could not save the stop\./,
      "a stop that is not saved says so");
    // A seat that checked the address ended its setup: two hidden documents bring no card back.
    t.secrets[k1] = { ...t.secrets[k1], aborted: undefined, stopped: undefined };
    assert.match(seen(), /Check that your devices match/);
    t.secrets[k1] = { ...t.secrets[k1], checkedWallet: kept[1].checkedWallet };
    assert.doesNotMatch(seen(), /Check that your devices match/,
      "a seat that checked the address gets no safety card");
    // A browser without a seat of this wallet only sees the number.
    delete t.secrets[k1];
    ui.mismatchAsk = null;
    assert.match(seen(), /Check that your devices match/);
    assert.deepEqual([button("It matches"), button("They don't match"), button("Stop setup")],
      [null, null, null], "a browser without a seat cannot confirm or stop");
    assert.doesNotMatch(seen(), /Confirmed on this device|tap "They don't match"/,
      "and is not told to");
  } finally {
    Object.assign(t.secrets, { [k1]: kept[1], [k2]: kept[2], [gidV + ":3"]: kept[3] });
    Object.assign(t.state, keep);
    ui.safetyFull = null;
    ui.mismatchAsk = null;
  }
}
async function stopNow(gid) {
  ui.mismatchAsk = gid;
  Object.assign(t.state, { wallet: null, done: {}, abort: {} });
  await findNode(pageTree(), (n) => n.attrs?.type === "button" && textOf(n) === "Stop setup")
    .on.click();
}
// A stop while seat 1 waits for the chain height: createWallet writes no wallet document.
{
  const engine = await import("../app-engine.js"), { stopSetup } = await import("../app-dkg.js");
  const gid = await rig.wallet({ name: "Slow height" }), wpath = groupPath(gid) + "/meta/wallet";
  const keepZ = engine.Z;
  delete t.secrets[gid + ":2"];
  delete t.secrets[gid + ":3"];
  t.setZ({ ...keepZ, latestHeight: async () => { await sleep(600); return 1000; } });
  try {
    t.state.wallet = null;
    data.delete(wpath);
    rig.notify();
    await sleep(150);
    assert.equal(t.canCreateWallet(), true, "seat 1 may build the wallet before the stop");
    await stopSetup();
    rig.notify();
    await sleep(1500);
    assert.equal(data.has(wpath), false, "a stop during the wait writes no wallet document");
  } finally {
    t.setZ(keepZ);
  }
}
assert.equal(quickCode("12345 67890 12345 67890 12345 67890"), "12345 678",
  "the quick code keeps the groups of the number");
assert.equal(quickCode("12345 67890"), null, "a short number has no quick code");
assert.equal(quickCode("12345 6789x 12345 67890 12345 67890"), null, "a number with a letter");
assert.equal(quickCode(null), null);

// ── The wallet list: the welcome card, and the form that joins a wallet with a link ──
// A good link goes the way of a link in the address bar. A bad one opens nothing and leaves its
// text in the field. The secret of the link goes to no log, banner, console, address bar or
// storage. A good link keeps its wallet secret: that is the join. The pasted text stays out of
// the storage.
{
  const lobbyTree = () => {
    const real = globalThis.document;
    globalThis.document = { createElement: () => new Rec(), createElementNS: () => new Rec(),
      createTextNode: (text) => ({ text }), documentElement: { dataset: {} } };
    try {
      return lobby();
    } finally {
      globalThis.document = real;
    }
  };
  const formOf = (tree) => findNode(tree, (n) => !!n.on?.submit && !!byId(n, "join-link"));
  const { PASTE_BAD, PASTE_CONTACT, PASTE_EMPTY, PASTE_GLUED, PASTE_MANY, PASTE_OTHER,
    PASTE_PATH } = await import("../chat.js");
  const { LINK_CHAT_ID, LINK_NEW_SECRET } = await import("../util.js");
  const { openGroup, roomKeys } = await import("../app-groups.js");
  const { joinLinks } = await import("../app-messages.js");
  const { focusAfter } = await import("../app-loop.js");
  const gid = t.state.gid, known = t.gkeys[gid], cid = "c1".repeat(10), rid = "d3".repeat(10);
  const fresh = "f1".repeat(10), other = "o".repeat(43), secret = "s".repeat(43);
  const page = new URL(location.href), base = page.origin + page.pathname;
  const link = (id, key) => base + "#" + id + "." + key;

  const said = [], replaced = [], methods = ["log", "info", "warn", "error", "debug"];
  const real = Object.fromEntries(methods.map((m) => [m, console[m]]));
  const realReplace = history.replaceState;
  let stopped = 0;
  // Pastes `text` into the form of a new page and submits it.
  const paste = (text) => {
    const tree = lobbyTree(), field = byId(tree, "join-link");
    field.value = text;
    formOf(tree).on.submit({ preventDefault() { stopped++; } });
    return field;
  };
  const leaked = (text, { storageToo = true } = {}) => JSON.stringify([t.state.log, t.banner, said,
    replaced, storageToo ? [...storage.values()] : []]).includes(text);
  const opensNothing = (what, keysBefore) => {
    assert.equal(t.state.gid, null, what + ": no wallet opens");
    assert.equal(location.hash, "", what + ": the address bar stays");
    assert.equal(JSON.stringify(t.gkeys), keysBefore, what + ": no secret is kept");
    assert.equal(joinLinks.size, 0, what + ": no chat waits");
  };
  try {
    for (const m of methods) console[m] = (...a) => said.push(a);
    history.replaceState = (...a) => { replaced.push(a); };
    openGroup(null);
    ui.joinBad = "";
    // The welcome card offers three choices. The form waits until the person picks to join.
    ui.joinOpen = false;
    const closed = lobbyTree(), choice = byText(closed, "Join a shared wallet");
    for (const label of ["Set up a wallet", "Join a shared wallet", "Recover access"]) {
      assert.ok(byText(closed, label), "the welcome card offers " + label);
    }
    assert.equal(byId(closed, "join-link"), null, "the form waits for the choice");
    assert.equal(choice.attrs["aria-expanded"], "false", "the choice starts closed");
    byText(closed, "Set up a wallet").on.click();
    assert.equal(ui.create, true, "Set up a wallet opens the create dialog");
    ui.create = false;
    focusAfter(null);
    choice.on.click();
    assert.equal(ui.joinOpen, true, "the choice opens the form");
    assert.equal(t.wantFocus?.key, "join-link", "the choice moves focus to the field");
    assert.equal(byText(lobbyTree(), "Join a shared wallet").attrs["aria-expanded"], "true",
      "the open form shows in the choice");
    // A second press closes the form and its error. It asks for no focus on the field that is gone.
    ui.joinBad = PASTE_BAD;
    focusAfter(null);
    byText(lobbyTree(), "Join a shared wallet").on.click();
    assert.equal(ui.joinOpen, false, "a second press closes the form");
    assert.equal(t.wantFocus, null, "closing the form asks for no focus");
    assert.equal(ui.joinBad, "", "closing the form ends its error");
    const shut = lobbyTree();
    assert.equal(byId(shut, "join-link"), null, "the closed form is gone");
    assert.equal(byText(shut, "Join a shared wallet").attrs["aria-expanded"], "false",
      "the closed form shows in the choice");
    byText(shut, "Join a shared wallet").on.click();
    assert.equal(ui.joinOpen, true, "a third press opens the form again");
    // The form: a field with no name, a label, a hint, and a Join button.
    const first = lobbyTree(), field = byId(first, "join-link"), form = formOf(first);
    assert.ok(field && form, "the wallet list has the join form");
    assert.equal(field.attrs.name, undefined, "the join field has no name");
    assert.equal(form.attrs.action, undefined, "the join form has no action");
    assert.equal(field.attrs.autocomplete, "off", "the join field is not remembered");
    assert.equal(field.attrs["aria-invalid"], undefined, "the field starts valid");
    assert.equal(field.attrs["aria-describedby"], "join-help", "the field starts with its hint");
    assert.match(textOf(byId(first, "join-help")), /invite link/);
    assert.equal(byId(first, "join-error"), null, "no error before a paste");

    // An empty or bad paste shows its error next to the field, and opens nothing.
    const cases = [
      ["an empty paste", "", PASTE_EMPTY],
      ["a paste of spaces", "   ", PASTE_EMPTY],
      ["a link without a secret", base + "#" + fresh, PASTE_BAD],
      ["a short secret", link(fresh, secret.slice(1)), PASTE_BAD],
      ["a bad wallet id", link("z".repeat(20), secret), PASTE_BAD],
      ["a contact link", base + "#c." + fresh + "." + secret, PASTE_CONTACT],
      ["a link of another server", "https://evil.example/#" + fresh + "." + secret, PASTE_OTHER],
      ["text before the link", "Link:" + link(fresh, secret), PASTE_GLUED],
      ["a link of another path", base + "other/#" + fresh + "." + secret, PASTE_PATH],
      ["two different wallet links", link(fresh, secret) + " " + link(rid, other), PASTE_MANY],
      ["a different secret for a wallet you have", link(gid, other), LINK_NEW_SECRET],
      ["the id of a chat you have", link(cid, secret), LINK_CHAT_ID],
      ["the id of a message room", link(rid, secret), LINK_CHAT_ID],
    ];
    t.chats.list[cid] = { key: "k".repeat(43), member: "dd".repeat(10), at: 1 };
    roomKeys[rid] = "r".repeat(43);
    const keysBefore = JSON.stringify(t.gkeys);
    for (const [what, text, error] of cases) {
      focusAfter(null);
      const done = paste(text);
      assert.equal(ui.joinBad, error, what + " gives its error");
      assert.equal(t.wantFocus?.key, "join-link", what + ": the field gets focus back");
      const now = lobbyTree();
      assert.equal(byId(now, "join-link").attrs["aria-invalid"], "true",
        what + ": the field is marked invalid");
      assert.equal(byId(now, "join-link").attrs["aria-describedby"], "join-help join-error",
        what + ": the field points at its error");
      const shown = byId(now, "join-error");
      assert.equal(textOf(shown), error, what + ": the error shows next to the field");
      assert.equal(shown.attrs.role, "alert", what + ": a screen reader hears the error");
      assert.equal(done.value, text, what + ": the text stays in the field");
      opensNothing(what, keysBefore);
    }
    delete t.chats.list[cid];
    delete roomKeys[rid];
    assert.equal(stopped, cases.length, "the submit never leaves the page");
    for (const text of [secret, other, "#" + fresh]) {
      assert.equal(leaked(text), false, "a bad link goes to no log, banner, console or storage");
    }

    // A redraw puts the text back with an input event that nobody typed: the error stays.
    const typed = paste("");
    typed.on.input({ isTrusted: false, target: typed });
    assert.equal(ui.joinBad, PASTE_EMPTY, "a redraw does not end the error");
    typed.setAttribute("aria-invalid", "true");
    typed.on.input({ isTrusted: true, target: typed });
    assert.equal(ui.joinBad, "", "typing ends the error");
    assert.equal(typed.attrs["aria-invalid"], undefined, "typing clears the mark");
    assert.equal(typed.attrs["aria-describedby"], "join-help", "typing clears the pointer");
    ui.joinBad = PASTE_BAD;
    openGroup(null);
    assert.equal(ui.joinBad, "", "an error does not wait for the next visit");

    // A good link opens its wallet by the path of the address bar, and keeps its secret.
    replaced.length = 0;
    ui.tab = "details";
    const joined = paste('I made a shared wallet "Team #2". 1. Open this link: ' + link(gid, known)
      + ", then take a seat.");
    assert.equal(ui.joinBad, "", "a good link has no error");
    assert.equal(t.state.gid, gid, "a good link opens its wallet");
    assert.equal(ui.tab, "overview", "the wallet opens on its first tab");
    assert.equal(t.gkeys[gid], known, "the wallet secret stays");
    assert.equal(joined.value, "", "the field is empty after a join");
    assert.deepEqual(replaced.map((a) => a[2]), ["#" + gid],
      "the address bar never holds a secret");
    assert.equal(leaked(known, { storageToo: false }), false,
      "a good link goes to no log or console");
    for (const text of [link(gid, known), "#" + gid + "." + known, "Open this link"]) {
      assert.equal(leaked(text), false, "the pasted text stays out of the storage");
    }
    openGroup(null);

    // A link to a wallet that this browser does not have: the secret is kept, the wallet opens.
    paste(link(fresh, secret));
    assert.equal(t.state.gid, fresh, "a link to a new wallet opens it");
    assert.equal(t.gkeys[fresh], secret, "the secret of a new wallet is kept");

    delete t.gkeys[fresh];
    openGroup(null);
    // A contact link before a wallet link: the wallet opens, no chat waits.
    paste(base + "#c." + cid + "." + secret + " and then " + link(fresh, secret));
    assert.equal(t.state.gid, fresh, "a contact link and a wallet link open the wallet");
    assert.equal(t.gkeys[fresh], secret, "the secret of that wallet is kept");
    assert.equal(joinLinks.size, 0, "no chat waits after that paste");
    delete t.gkeys[fresh];
    openGroup(null);
    // The server shows one page at / and at /index.html: a link of either opens on either.
    const realHref = location.href;
    try {
      location.href = base + "index.html";
      for (const text of [link(fresh, secret), base + "index.html#" + fresh + "." + secret]) {
        paste(text);
        assert.equal(t.state.gid, fresh, "a link opens on /index.html: " + text.slice(0, 30));
        delete t.gkeys[fresh];
        openGroup(null);
      }
      location.href = base;
      paste(base + "index.html#" + fresh + "." + secret);
      assert.equal(t.state.gid, fresh, "a link of /index.html opens on /");
      delete t.gkeys[fresh];
      openGroup(null);
    } finally {
      location.href = realHref;
    }

    // The welcome card, and the list with wallets.
    const listed = t.state.groups;
    t.state.groups = [];
    const welcome = lobbyTree(), card = findNode(welcome, (n) => /\bwelcome\b/.test(n.className));
    assert.match(textOf(card), /Start with Zigs/);
    assert.ok(textOf(card).includes("Nobody ever holds the whole key. Zcash payments are shielded. "
      + "On Solana Devnet, the group, the payee and the fee address of each device that pays "
      + "are public. A deposit or a withdrawal also shows its amount."),
    "the welcome text of the key");
    assert.doesNotMatch(textOf(card), /outside your team|can read the wallet/,
      "the welcome text claims no secrecy of the wallet");
    assert.match(textOf(card), /any 2 of 3 devices must approve each payment/);
    assert.match(textOf(card), /New wallets use test networks only.*Zigs is not audited/s);
    assert.match(textOf(card), /Appearance/, "the welcome card has the theme choice");
    assert.doesNotMatch(textOf(card), /signer|seat|passkey|USD|Swap/i,
      "device wording, owner scope");
    assert.ok(byId(card, "join-link"), "the welcome card has the join form");
    t.state.groups = [t.cleanGroup(gid, { name: "W", n: 3, t: 2, version: 3 })];
    ui.joinOpen = false;
    const list = lobbyTree();
    assert.ok(byId(list, "join-link"), "a list with wallets has the join form");
    assert.match(textOf(list), /New wallets use test networks only.*Zigs is not audited/s);
    assert.doesNotMatch(textOf(list), /Appearance/, "the theme choice waits for Details");
    t.state.groups = listed;
  } finally {
    for (const m of methods) console[m] = real[m];
    history.replaceState = realReplace;
    delete t.chats.list[cid];
    delete roomKeys[rid];
    delete t.gkeys[fresh];
    ui.joinBad = "";
    ui.joinOpen = false;
    openGroup(null);
  }
}

// ── An invite link in the address bar: the same refusals as the form ──
// The hash path (adoptInviteKey, adoptWalletLink) stores a secret only for a new wallet or the same
// secret again. Another secret for a wallet that this browser holds, and the id of a chat or a
// message room, are refused with a banner. The address bar loses the secret in each case.
{
  const { adoptInviteKey } = await import("../app-links.js");
  const { roomKeys } = await import("../app-groups.js");
  const { LINK_CHAT_ID, LINK_NEW_SECRET } = await import("../util.js");
  const held = "a1".repeat(10), fresh = "b1".repeat(10), chat = "c1".repeat(10);
  const room = "d1".repeat(10), short = "e1".repeat(10);
  const mine = "h".repeat(43), other = "o".repeat(43), secret = "s".repeat(43);
  const replaced = [], realReplace = history.replaceState;
  // Opens `hash` as a link in the address bar. Returns the text of the banner after it.
  const open = (hash) => {
    replaced.length = 0;
    t.showBanner("ok", "RESET");
    location.hash = hash;
    adoptInviteKey();
    location.hash = "";
    return t.banner.text;
  };
  try {
    history.replaceState = (...a) => { replaced.push(a[2]); };
    t.gkeys[held] = mine;
    t.chats.list[chat] = { key: "k".repeat(43), member: "dd".repeat(10), at: 1 };
    roomKeys[room] = "r".repeat(43);
    assert.equal(open("#" + fresh + "." + secret), "RESET", "a new wallet gives no banner");
    assert.equal(t.gkeys[fresh], secret, "an address-bar link keeps the secret of a new wallet");
    assert.deepEqual(replaced, ["#" + fresh], "the address bar loses the secret");
    assert.equal(open("#" + held + "." + mine), "RESET", "the same secret gives no banner");
    assert.equal(t.gkeys[held], mine, "the same secret stays");
    assert.equal(open("#" + held + "." + other), LINK_NEW_SECRET,
      "an address-bar link with another secret is refused");
    assert.equal(t.gkeys[held], mine, "another secret does not replace the stored secret");
    assert.deepEqual(replaced, ["#" + held], "the refused secret leaves the address bar");
    assert.equal(open("#" + chat + "." + secret), LINK_CHAT_ID, "the id of a chat is refused");
    assert.equal(t.gkeys[chat], undefined, "no wallet secret is stored under a chat id");
    assert.deepEqual(replaced, ["#"], "a chat id leaves nothing in the address bar");
    assert.equal(open("#" + room + "." + secret), LINK_CHAT_ID,
      "the id of a message room is refused");
    assert.equal(t.gkeys[room], undefined, "no wallet secret is stored under a room id");
    assert.equal(open("#" + short + "." + secret.slice(1)), "RESET",
      "a short secret gives no banner");
    assert.equal(t.gkeys[short], undefined, "a short secret is not stored");
  } finally {
    history.replaceState = realReplace;
    for (const id of [held, fresh, chat, room, short]) delete t.gkeys[id];
    delete t.chats.list[chat];
    delete roomKeys[room];
    location.hash = "";
  }
}

console.log("unified-setup: ok");
process.exit(0);
