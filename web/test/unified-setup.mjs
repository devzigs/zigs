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
import { config, loadRig, sleep } from "./sol-rig.mjs";

const rig = await loadRig();
// The page modules need the stub page of the rig, so they load after it.
const { SOL_DISCLOSURE, solPlanned, solServed } = await import("../app-sol.js");
const { inviteMessage, joinText, onLink } = await import("../app-setup.js");
const { chatMessage } = await import("../app-links.js");
const { chatInviteCard } = await import("../app-thread.js");
const { chats } = await import("../app-keystore.js");
const { backupWords } = await import("../sol/backup.js");
const { pendingCount } = await import("../sol/view.js");
const { createDialog, lobby, marginText, renderSide } = await import("../app-shell.js");
const { offReason } = await import("../util.js");
const { intentHex } = await import("../sol/intent.js");
const { ui } = await import("../app-state.js");
const { planSolana, solSetup } = await import("../app-sol.js");
const { walletReady, walletShown } = await import("../app-wallet.js");
const { PUBLIC_TEXT } = await import("../sol/view.js");
const { reactCeremony } = await import("../sol/ceremony.js");
const { t, data, waitFor } = rig;
const groupPath = (gid) => `groups/${gid}`;
const BOTH_OPEN = /Every device keeps this wallet open until the Zcash and the Solana parts/;

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
  globalThis.document = { createElement: () => new Rec(), createElementNS: () => new Rec(),
    createTextNode: (text) => ({ text }) };
  try {
    return t.groupView();
  } finally {
    globalThis.document = real;
  }
}
const pageText = () => textOf(pageTree());
const findNode = (node, pred) => pred(node) ? node
  : (node.kids ?? []).map((k) => findNode(k, pred)).find(Boolean) ?? null;
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
  message: "ab".repeat(8),
  feeSig: "00".repeat(64),
  ...change,
});
const labelled = (node, label) =>
  node.attrs?.["aria-label"] === label ||
  (node.kids ?? []).some((kid) => labelled(kid, label));
function sideTree() {
  const real = globalThis.document;
  const nav = new Rec();
  nav.replaceChildren = (...nodes) => void (nav.kids = nodes);
  const fake = { createElement: () => new Rec(), createElementNS: () => new Rec(),
    createTextNode: (text) => ({ text }) };
  const side = { classList: { toggle() {} } };
  globalThis.document = { ...fake, getElementById: () => nav, querySelector: () => side };
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
    assert.match(pageText(), /Needs your approval.*2 Solana proposals wait for your approval/,
      "the Solana line in the review bucket");
    const review = findNode(pageTree(), (n) => n.attrs?.["aria-label"] === "Needs your approval");
    assert.equal(textOf(findNode(review, (n) => n.className === "badge plain")), "2",
      "the review bucket counts each proposal");
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
// The phone Menu closes on a pick; the sections show for the formed wallet only; the switcher
// shows with two or more wallets.
function sideMenu() {
  t.ui.menu = true;
  sideTree().onclick({ target: { closest: () => ({}) } });
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
  assert.ok(!labelled(pageTree(), "Switch wallet"), "one wallet: its name, no switcher");
  t.state.groups = [t.state.g, { id: "other", name: "Other" }];
  assert.ok(labelled(pageTree(), "Switch wallet"), "two wallets: a switcher");
}
function approvalCount(ctl) {
  const count = (sessions, commits = {}, change = {}) =>
    pendingCount({ ...ctl, ...change, sessions, commits });
  const docs = (change) => ({ docs: { ...ctl.docs, ...change } });
  const two = [proposal("a"), proposal("b"), proposal("c", { status: "sent" })];
  assert.equal(count(two), 2, "two open proposals, a sent one does not count");
  assert.equal(count(two, { a: { 1: {} } }), 2, "seats 2 and 3 can still approve a");
  assert.equal(count(two, { a: { 1: {}, 2: {}, 3: {} } }), 1, "every seat approved a");
  assert.equal(count([proposal("d", { intent: "zz" })]), 0, "a proposal the app cannot show");
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
    sideMenu();
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
  + "works\\. Send the password apart from the link\\. Tell (each person who joins|your contact) to open the "
  + "link in Safari or Chrome\\. The browser of a chat app or a private window can delete the key");
assert.match(pageText(), SENDER, "the invite card of a wallet");
{
  const cid = "c0ffee00c0ffee00c0ff";
  chats.list[cid] = { key: "ab".repeat(32), member: "m", at: Date.now() };
  const real = globalThis.document;
  globalThis.document = { createElement: () => new Rec(), createElementNS: () => new Rec(),
    createTextNode: (text) => ({ text }) };
  try {
    const card = chatInviteCard(cid);
    assert.match(textOf(card), SENDER, "the invite card of a chat");
    assert.match(textOf(card), /The browser of your contact asks/);
  } finally {
    globalThis.document = real;
    delete chats.list[cid];
  }
}
assert.match(SOL_DISCLOSURE, /public program address.*fee address.*Helius.*no audit/);
assert.ok(SOL_DISCLOSURE.includes(PUBLIC_TEXT), "the choice says what the Solana tab says");
assert.match(SOL_DISCLOSURE, /Every signer sees the whole Solana history/);
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
      createTextNode: (text) => ({ text }) };
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
    ["Create wallet", "why-create", () => lobby()],
    ["Create wallet", "why-create-submit", () => createDialog()],
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
  const wallet = t.sec(gidW, 1).checkedWallet;
  // Saved, not only in memory: each Solana write first takes what storage holds.
  await t.putSec(gidW, 1, { checkedWallet: null, rejectedWallet: wallet });
  await planSolana(gidW);
  t.refilter();
  assert.match(pageText(), /Setup stopped at Prepare\. /, "a seat that rejected the address");
  await sleep(3500);
  assert.equal(data.has(`groups/${gidW}/solstart/1`), false, "no start before Address checked");
  assert.doesNotMatch(t.banner?.text ?? "", /Seat 1 waits/, "and no refusal before it");
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
  assert.match(pageText(), SENDER, "the invite link of the Signers tab");
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
  approvalCount(t.sol.ctl);
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
  const solButtons = () => pageText().match(/Back up Solana, seat \d/g) ?? [];
  await waitFor("the note", () => solButtons().length === 3);
  assert.match(pageText(), /The Solana part of a seat is a second file, with its own passphrase/);
  // S13: a new wallet has no older file, so the note says nothing about an older format.
  assert.doesNotMatch(pageText(), /backup format changed|iPhone and Mac apps/);
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
  await rig.wallet({ name: "Stages" });
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

// ── The create dialog: numbered sections for a new wallet, the old form for a change ──
assert.match(dialogText(), /1\. Approval rule.*2\. Names.*3\. Networks/s);
assert.doesNotMatch(dialogText(t.state.g), /1\. Approval rule/, "Change signers keeps its form");
assert.equal(marginText(2, 3), "", "a margin: no warning");
assert.match(marginText(3, 3), /Each payment needs every device/);
{
  // The line of t = n is in the dialog, a screen reader hears it change, and a change of the
  // numbers updates it. The first focus goes to the wallet name.
  const dialog = dialogTree();
  const margin = byId(dialog, "margin-text");
  assert.equal(margin?.attrs.role, "status");
  assert.equal(byId(dialog, "g-t").attrs["aria-describedby"], "margin-text");
  assert.equal(byId(dialog, "g-name").attrs["data-first-focus"], "");
  assert.equal(byId(dialogTree(t.state.g), "g-name").attrs["data-first-focus"], undefined);
  byId(dialog, "rule-text").classList = { toggle() {} };
  const real = globalThis.document;
  globalThis.document = { getElementById: (id) => ({ value: { "g-n": "3", "g-t": "3" }[id] }) };
  try {
    dialog.on.input();
  } finally {
    globalThis.document = real;
  }
  assert.match(margin.textContent, /Each payment needs every device/, "update() names the risk");
}

console.log("unified-setup: ok");
process.exit(0);
