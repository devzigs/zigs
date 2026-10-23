// Isolated production-renderer fixtures.
// All participants, addresses and account data are synthetic.
// No boot, chain service, transaction proof or network submission is performed.
async function seedRelayFixture() {
const { state, ui, busy, ready } = await import("/app-state.js");
const keys = await import("/app-keystore.js");
const account = await import("/app-account.js");
const messages = await import("/app-messages.js");
const { setMe, setDb, setDownloads } = await import("/app-groups.js");
const { setZ } = await import("/app-engine.js");
const { signPins } = await import("/app-filter.js");
const { setChain, NETWORKS } = await import("/app-chain.js");
const { el } = await import("/app-dom.js");
const shell = await import("/app-shell.js");
const thread = await import("/app-thread.js");
const accountView = await import("/app-account-view.js");
const chatHelpers = await import("/chat.js");
const loop = await import("/app-loop.js");
const gid = "messaging-wallet-fixture", cid = "a".repeat(20), room = "b".repeat(20);
const member = "c".repeat(20), other = "d".repeat(20);
const address = "utest1" + "syntheticrecipient".repeat(7);
const newKey = await chatHelpers.newSignKey();
const otherKey = await chatHelpers.newSignKey();
const now = 1792742400000;
const g = { id: gid, name: "Studio wallet", n: 3, t: 2, version: 1, network: "testnet" };
const seat = { uid: "fixture-browser", signPk: newKey.signPk, name: "This browser" };
Object.assign(state, { groups: [g], g, gid, cid: null, contact: null, seats: {
  1: seat, 2: { uid: "fixture-other", signPk: otherKey.signPk, name: "Studio laptop" },
  3: { ...seat, name: "Recovery browser" } }, seatsLoaded: true, seatsSettled: true,
  sessionsLoaded: true, sessionsFailed: false, sessions: [], sid: null,
  wallet: { birthday: 1, orchard_fvk: "synthetic-viewing-key" }, pending: false,
  commits: {}, shares: {}, log: [] });
busy.clear();
Object.assign(ui, { tab: "chats", request: null, leave: false, newChat: false,
  contactAdd: false, personal: { net: "testnet", fund: "0.003", drop: false } });
setMe("fixture-browser");
setDownloads({});
setDb({ doc: () => ({ set: async () => { throw Error(
  "Synthetic relay unavailable; retry manually."); } }),
  collection: () => ({ doc: () => ({ id: "fixture-send", set: async () => {
    throw Error("Synthetic relay unavailable; retry manually."); } }) }) });
keys.setSecrets({ [gid + ":1"]: { signPk: newKey.signPk, signSk: newKey.signSk,
  keyPackage: "synthetic-non-signing-fixture" },
  [gid + ":3"]: { signPk: newKey.signPk, signSk: newKey.signSk,
    keyPackage: "synthetic-non-signing-fixture" } });
ready[gid] = true;
keys.setGkeys({ [gid]: "e".repeat(43) });
keys.chats.profile = newKey;
keys.chats.list[cid] = { key: "f".repeat(43), member, at: now };
messages.rooms[gid] = room;
messages.roomWarn.clear();
for (const i of [1, 2, 3]) signPins[gid + ":" + i] = state.seats[i].signPk;
messages.chatPins[cid + ":" + member] = newKey.signPk;
messages.chatPins[cid + ":" + other] = otherKey.signPk;
messages.chatMembers[cid] = { [member]: { name: "This browser", signPk: newKey.signPk },
  [other]: { name: "Morgan", signPk: otherKey.signPk } };
  globalThis.__messagingFixture = { state, ui, messages, account, keys, loop, shell, thread,
    accountView,
    chatHelpers, el, setZ, setChain, NETWORKS, gid, cid, room, member, other, address, newKey,
      otherKey, now };
}

async function signFixtureMessages() {
  const { messages, state, chatHelpers, newKey, otherKey, now, gid, room, cid,
    other } = globalThis.__messagingFixture;
const team = [{ id: "team-one", seat: 2, thread: "wallet", at: now - 120000,
  text: "The studio payment is ready for a separate review." },
{ id: "team-two", seat: 1, thread: "wallet", at: now - 60000,
  text: "Thanks. We can keep the discussion here." }];
for (const m of team) {
  m.sig = await chatHelpers.signMsg(m.seat === 2 ? otherKey.signSk : newKey.signSk,
    chatHelpers.signedText(gid, room, m));
  messages.checked.set(JSON.stringify([state.seats[m.seat].signPk, m.sig,
    chatHelpers.signedText(gid, room, m)]), true);
}
messages.chat[gid] = team;
const dm = { id: "direct-one", from: other, seat: other, thread: "dm", at: now - 40000,
  text: "I have the contact link. This is our direct relay chat." };
dm.sig = await chatHelpers.signMsg(otherKey.signSk, chatHelpers.dmText(cid, dm));
messages.checked.set(JSON.stringify([otherKey.signPk, dm.sig, chatHelpers.dmText(cid, dm)]), true);
messages.chat[cid] = [dm];
}

async function seedAccountFixture({ scene }) {
  const { account, NETWORKS, address, now, setZ, setChain, gid } = globalThis.__messagingFixture;
const sent = { id: "synthetic-sent", to: 1, text: "A message received in a block.",
  at: now - 240000, parts: 1, fee: 10000, txid: "12".repeat(32), state: "sent", height: 5000000 };
account.setPersonal(scene === "setup" ? null : { kind: "personal", network: "testnet",
  seed: "0".repeat(64), snapKey: "s".repeat(43), birthday: 1, backedUp: false,
  contacts: [{ index: 1, name: "Morgan", address }], sent: [sent] });
account.setAcct(scene === "setup" ? null : { account: true, gid: "personal", id: "personal",
  secret: "s".repeat(43), net: NETWORKS.testnet, address, ufvk: "synthetic-viewing-key",
  addrs: new Map([[1, "utest1" + "syntheticreplyaddress".repeat(7)]]), cw: {
    createMessage: async () => { globalThis.__messagingAttempts =
      (globalThis.__messagingAttempts || 0) + 1;
      throw Error("Synthetic message build failed; draft retained."); },
  },
  bal: { height: 5000010, spendable: 300000, pending: 0 }, balAt: now,
  received: [], sent: new Set([sent.txid]), progress: "", live: "", ms: now });
let requestPayees = [];
setZ({ normalizeAddress: (a) => a, splitMessage: (text) => JSON.stringify(
  Array.from({ length: Math.max(1, Math.ceil(new TextEncoder().encode(text).length / 400)) },
    (_, i) => text.slice(i * 400, (i + 1) * 400))),
joinMessage: (texts) => JSON.stringify({ text: JSON.parse(texts).join("") }),
addressAt: () => address,
makeRequest: (payees) => { requestPayees = JSON.parse(payees); return "zcash:" + address +
  "?amount=0.003"; },
parseRequest: () => JSON.stringify({ payees: requestPayees }) });
  setChain({ gid, cw: { free: () => {} }, bal: { height: 5000010 }, sent: new Set(),
    received: [], balAt: now });
}

function selectFixtureScene({ scene }) {
  const { state, ui, messages, cid, other } = globalThis.__messagingFixture;
if (scene === "team") ui.tab = "messages";
if (["direct", "changed-key", "invite"].includes(scene)) { state.gid = null; state.g =
  null; state.cid = cid; }
if (scene === "contact") { state.gid = null; state.g = null; state.contact = 1; }
if (scene === "changed-key") messages.chatMembers[cid][other].signPk = "9".repeat(64);
if (scene === "invite") {
   delete messages.chatMembers[cid][other]; delete messages.chatPins[cid + ":" +
     other]; messages.chat[cid] = []; }
if (scene === "setup") { state.gid = null; state.g = null; }
}

async function prepareLegacyView({ scene }) {
  const f = globalThis.__messagingFixture;
  const { el, thread, accountView, shell, state } = f;
  f.paint = () => {
    let view;
    if (scene === "team") view = el("div", { class: "page" },
      el("header", { class: "page-head" }, el("h1", {}, "Studio wallet · Messages")),
        thread.messagesCard(false));
    else if (state.cid) view = thread.chatView();
    else if (scene === "contact") view = accountView.contactView();
    else if (scene === "setup") view = el("div", { class: "page" },
      el("header", { class: "page-head" }, el("h1", {}, "Personal messaging account")),
      accountView.personalCard(() => {}));
    else view = shell.chatsWorkspace();
    document.getElementById("app").replaceChildren(view);
    shell.renderSide();
  };
}

async function prepareWorkspaceView() {
  const f = globalThis.__messagingFixture;
  const { ui, state, thread, loop } = f;
  const workspace = await import("/app-messaging-workspace.js");
  globalThis.__messagingView = () => workspace.messagingWorkspace(
    ui.tab === "messages" && state.gid && !state.cid && state.contact == null
      ? thread.teamConversation() : null);
  f.paint = () => loop.draw();
}

export async function installMessagingFixture(page, scene, phase) {
  await page.evaluate(seedRelayFixture);
  await page.evaluate(signFixtureMessages);
  await page.evaluate(seedAccountFixture, { scene });
  await page.evaluate(selectFixtureScene, { scene });
  if (phase === "before") await page.evaluate(prepareLegacyView, { scene });
  else await page.evaluate(prepareWorkspaceView);
  return page.evaluate(() => {
    const f = globalThis.__messagingFixture;
    f.paint();
    return { address: f.address, log: f.state.log };
  });
}
