// Rules of the personal account (CHAT.md section 5). The page calls the engine and draws. This
// module decides what is allowed and what each state shows. Checked by web/test/personal.mjs.
import { memoShown, zatText } from "./payees.js";

export const KIND = "personal";
export const NETWORKS = ["testnet", "mainnet"];
export const NAME_MAX = 40, MAX_CONTACTS = 200;
const INDEX_MAX = 4294967295;   // block heights and address indexes are u32
// A contact index stays far below the end of the u32 range, so that no saved file and no received
// index can leave an account without a free index.
export const CONTACT_INDEX_MAX = 2 ** 31;
const SEED = /^[0-9a-fA-F]{64}$/, SNAP_KEY = /^[\w-]{43}$/, LINE_BREAK = /[\r\n\u2028\u2029]/;
const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const fail = (text) => { throw new Error(text); };

// ── Fee and balance ──
// ZIP 317: 5000 zatoshis for each action, at least 2. A message has one output for each part, and
// one for the change.
export const feeFor = (parts) => 5000 * Math.max(2, parts + 1);
export const feeText = (fee) => "On chain · fee " + zatText(fee) + " ZEC";
export const LOW_BALANCE = 3 * feeFor(1);   // pays fewer than 3 messages of one part
const HIGH_BALANCE = 1000000;               // 0.01 ZEC
export const LOW_TEXT = "The balance pays fewer than 3 messages. Fund the account to keep sending.";
export const HIGH_TEXT = "The account holds more than 0.01 ZEC. Whoever controls this device can "
  + "spend it. Do not add more.";

// The warnings for a balance in zatoshis, in the order that the card shows them.
export function balanceWarnings(total) {
  if (total > HIGH_BALANCE) return [HIGH_TEXT];
  return total < LOW_BALANCE ? [LOW_TEXT] : [];
}

// The warning for a funding amount, before the money is sent: the balance that it would give is
// above the level that the account should hold. `balance` is 0 before the first sync.
export const fundingWarning = (amount, balance) =>
  Number.isInteger(amount) && amount > 0 && amount + balance > HIGH_BALANCE ? HIGH_TEXT : "";

const sumOf = (list, key) => list.reduce((n, r) => n + (Number.isFinite(r[key]) ? r[key] : 0), 0);

// The balance of the engine, less the messages that wait for their block. Until a block holds the
// message, the engine still counts the spent notes. `flight` are the records in state "sending".
export function accountBalance(bal, flight) {
  const spendable = Math.max(0, bal.spendable - sumOf(flight, "note_value"));
  const pending = bal.pending + sumOf(flight, "change");
  return { spendable, pending, total: spendable + pending };
}

// Why the composer is off, or "". `bal` is accountBalance() or null before the first sync.
export function sendGate(bal, flight, fee) {
  if (!bal) return "Wait for the first sync to finish.";
  if (flight.length) return "A message is waiting for its block. Send the next one after it.";
  if (bal.spendable >= fee) return "";
  if (bal.pending) return "Incoming funds need 3 confirmations first.";
  return bal.spendable ? "The balance does not cover the network fee."
    : "The account has no funds yet. Fund it first.";
}

// The parts and the fee of `text`. `split(text)` is the engine call: it gives the list of parts or
// throws a sentence. An empty text shows the fee of one part.
export function messagePlan(text, split) {
  const t = String(text ?? "").trim();
  if (!t) return { parts: 1, fee: feeFor(1), fine: feeText(feeFor(1)), error: "" };
  try {
    const parts = split(t).length, fee = feeFor(parts);
    return { parts, fee, fine: feeText(fee), error: "" };
  } catch (e) {
    return { parts: 0, fee: 0, fine: "", error: String(e?.message ?? e) };
  }
}

// ── Funding ──
const FUND_PAYEES = 3;
export const MIN_FUND = FUND_PAYEES * feeFor(1);

// The payees of the funding request: the amount in zatoshis over 3 notes that differ by at most
// one zatoshi, so that each note pays a message and the account can send after each block.
export function fundingPayees(address, total) {
  if (!Number.isInteger(total) || total <= 0) {
    return { error: "Enter an amount above zero with at most 8 decimals." };
  }
  if (total < MIN_FUND) {
    return { error: "Fund at least " + zatText(MIN_FUND) + " ZEC, so that each of the 3 notes "
      + "pays one message." };
  }
  const base = Math.floor(total / FUND_PAYEES), extra = total - base * FUND_PAYEES;
  return { payees: Array.from({ length: FUND_PAYEES }, (_, i) =>
    ({ to: address, amount: base + (i < extra ? 1 : 0) })) };
}

// ── Contacts ──
// The highest address index in use: a contact has it, or the chain shows a payment to it. `seen`
// is highestIndex(). A restore from an old file lacks the contacts of its later days, but the
// chain still knows the addresses that got a payment.
export const nextIndex = (contacts, seen = 0) =>
  contacts.reduce((n, c) => Math.max(n, c.index), seen) + 1;

// The highest index of any note in the received list of the engine (`indexes` of each
// transaction), also a note with an empty memo or a memo not read yet, and the other messages.
export const highestIndex = (received) => (Array.isArray(received) ? received : [])
  .flatMap((tx) => (Array.isArray(tx?.indexes) ? tx.indexes : []))
  .reduce((n, i) => (Number.isInteger(i) && i > n ? i : n), 0);

export function nameError(name) {
  if (typeof name !== "string") return "Enter a name for this contact.";
  const text = name.trim(), n = [...text].length;
  if (!n) return "Enter a name for this contact.";
  if (n > NAME_MAX) return "The name can have at most " + NAME_MAX + " characters.";
  const bad = memoShown(text) !== text || LINE_BREAK.test(text);
  return bad ? "The name has a character that is not valid text." : "";
}

// `ctx`: normalize(address) (the engine's canonical form, or null), prefix, label (the network in
// words) and own (the addresses of this account). Returns { canon } or { error }.
function checkAddress(address, ctx) {
  const canon = typeof address === "string" ? ctx.normalize(address.trim()) : null;
  if (!canon || !canon.startsWith(ctx.prefix)) {
    return { error: "Enter a shielded Zcash " + ctx.label + " address. It starts with "
      + ctx.prefix + "." };
  }
  if (ctx.own.includes(canon)) {
    return { error: "This is an address of your own account. Enter the address of someone else." };
  }
  return { canon };
}

// A new contact gets the next free index. An index is never used twice, so a message to an old
// address never shows under a new name. `ctx.seen` is highestIndex() of the received list.
// Returns { contact } or { error }.
export function addContact(contacts, name, address, ctx) {
  const bad = nameError(name);
  if (bad) return { error: bad };
  const got = checkAddress(address, ctx), text = name.trim();
  if (got.error) return got;
  const same = contacts.find((c) => c.address === got.canon);
  if (contacts.length >= MAX_CONTACTS) {
    return { error: "You can have at most " + MAX_CONTACTS + " contacts." };
  }
  const index = nextIndex(contacts, ctx.seen);
  if (index > CONTACT_INDEX_MAX) return { error: "The account has no free address left." };
  if (same) return { error: "This address is already a contact: " + memoShown(same.name) + "." };
  if (contacts.some((c) => c.name.toLowerCase() === text.toLowerCase())) {
    return { error: "A contact has this name already. Use another name." };
  }
  return { contact: { name: text, address: got.canon, index } };
}

// ── Backup and saved record ──
export const NOT_PERSONAL = "This file is not a backup of a personal account.";
export const accountBackupName = (network) => "zigs-personal-" + network + ".zigsbackup";

// The payload of the encrypted backup file. It holds no sent message and no sync secret.
export const backupPayload = (p) => ({
  kind: KIND, version: 1, network: p.network, seed: p.seed, birthday: p.birthday,
  contacts: p.contacts.map(({ name, address, index }) => ({ name, address, index })),
});

const positive32 = (n) => Number.isInteger(n) && n >= 1 && n <= INDEX_MAX;
const contactIndex = (n) => Number.isInteger(n) && n >= 1 && n <= CONTACT_INDEX_MAX;

// One contact of a backup: { contact } or { error }. `seen` holds the indexes and addresses of the
// contacts before it.
function readContact(c, ctx, seen) {
  if (!isObj(c)) return { error: "is not valid." };
  const bad = nameError(c.name);
  const got = bad ? { error: bad } : checkAddress(c.address, { ...ctx, own: [] });
  if (got.error) return got;
  if (!contactIndex(c.index) || seen.has(c.index) || seen.has(got.canon)) {
    return { error: "has a bad index, or an index or address that another contact has." };
  }
  seen.add(c.index).add(got.canon);
  return { contact: { name: c.name.trim(), address: got.canon, index: c.index } };
}

function readContacts(list, ctx) {
  if (!Array.isArray(list) || list.length > MAX_CONTACTS) {
    fail("The backup holds no valid contacts.");
  }
  const seen = new Set();
  return list.map((c, i) => {
    const got = readContact(c, ctx, seen);
    if (got.error) fail("Contact " + (i + 1) + ": " + got.error);
    return got.contact;
  });
}

// The kind, network, version, seed and birthday of a backup payload. Throws a sentence.
function checkHeader(b) {
  if (!isObj(b) || b.kind !== KIND || !NETWORKS.includes(b.network)) fail(NOT_PERSONAL);
  if (b.version !== 1) fail("This backup has a version that this app cannot read.");
  if (typeof b.seed !== "string" || !SEED.test(b.seed)) fail("The backup holds no valid seed.");
  if (!positive32(b.birthday)) fail("The backup holds no valid birthday.");
}

// Checks a backup payload. `env`: keys(seed, network) is the engine call that throws for a bad
// seed, normalize(address), and the words and prefix of each network (see readNet). Returns the
// account without its sent messages.
export function readBackup(b, env) {
  checkHeader(b);
  const seed = b.seed.toLowerCase();
  env.keys(seed, b.network);
  const ctx = { normalize: env.normalize, ...env.nets[b.network] };
  return { kind: KIND, version: 1, network: b.network, seed, birthday: b.birthday,
    contacts: readContacts(b.contacts, ctx) };
}

const goodSent = (r) => isObj(r) && typeof r.txid === "string" && typeof r.text === "string"
  && Number.isInteger(r.to) && Number.isFinite(r.at) && Number.isFinite(r.tip);

// A sent message, as the browser keeps it. Bad entries are dropped: they are history only.
function readSent(list) {
  const num = (x) => (Number.isFinite(x) ? x : 0);
  return (Array.isArray(list) ? list : []).filter(goodSent).map((r) => ({
    txid: r.txid, to: r.to, text: r.text, at: r.at, tip: r.tip, fee: num(r.fee),
    parts: num(r.parts), note_value: num(r.note_value), change: num(r.change),
    broadcast: r.broadcast === true, failed: typeof r.failed === "string" ? r.failed : "",
  }));
}

// The saved record of the account, or null for none. Throws a sentence for a record that is not
// valid. The caller must then keep the stored value and make no new account over it.
export function normPersonal(x, env) {
  if (x == null) return null;
  const base = readBackup(x, env);
  if (typeof x.snapKey !== "string" || !SNAP_KEY.test(x.snapKey)) fail("The sync key is missing.");
  const backedUp = x.backedUp === true;
  return { ...base, snapKey: x.snapKey, backedUp, everBackedUp: backedUp || x.everBackedUp === true,
    sent: readSent(x.sent) };
}

// `backedUp`: the last backup file holds the account as it is now. `everBackedUp`: a file with the
// seed exists. A new contact ends the first and leaves the second.
export const newPersonal = ({ seed, network, birthday }, snapKey) => ({
  kind: KIND, version: 1, network, seed, birthday, contacts: [], snapKey, backedUp: false,
  everBackedUp: false, sent: [],
});

// A restored account has no sent messages, and a new sync key: the saved sync state of the old
// browser is not here.
export const restoredPersonal = (base, snapKey) =>
  ({ ...base, snapKey, backedUp: true, everBackedUp: true, sent: [] });

// What the remove button says about the money, or "" when the last file is current.
export function removeWarning(p) {
  if (p.backedUp) return "";
  return p.everBackedUp ? "Your last backup file has the seed but not your newest contacts."
    : "You have no backup file, so the money in the account is lost.";
}

// What a damaged record still gives: the seed, the network, the birthday and the contacts that
// read. Returns the payload of a backup, or null when the seed itself does not read.
export function salvageBackup(x, env) {
  try {
    checkHeader(x);
    env.keys(x.seed.toLowerCase(), x.network);
  } catch { return null; }   // nothing to save: the caller offers Remove only
  const ctx = { normalize: env.normalize, ...env.nets[x.network] }, seen = new Set();
  const list = Array.isArray(x.contacts) ? x.contacts.slice(0, MAX_CONTACTS) : [];
  const contacts = list.map((c) => readContact(c, ctx, seen)).flatMap((got) => got.contact || []);
  return backupPayload({ network: x.network, seed: x.seed.toLowerCase(), birthday: x.birthday,
    contacts });
}

// ── Sent messages ──
// A message expires 40 blocks after the block that it was built for (ZIP 203). Once the synced
// height is past that, a message that no block holds will never get in.
export const EXPIRY_BLOCKS = 40, EXPIRY_MARGIN = 3;

// "chain" (a block holds it), "failed" (a node answered and refused it), "expired" (the network
// took no block of it in time), "sending" (a server took it, or this page sends it now) or
// "unsure" (the page cannot tell if the network has it: no answer, or the page closed). `sent` is
// the set of txids that spent notes of the account, `height` the synced height, `live` whether
// this page is sending the record now.
export function sentState(rec, { sent, height, live }) {
  if (sent.has(rec.txid)) return "chain";
  if (rec.failed) return "failed";
  const late = Number.isFinite(height) && height >= rec.tip + 1 + EXPIRY_BLOCKS + EXPIRY_MARGIN;
  if (late) return "expired";
  return rec.broadcast || live ? "sending" : "unsure";
}

// A message in these states may still reach a block. The engine does not know about it, so its
// notes stay held until it is on chain or it expired.
export const holdsNotes = (state) => state === "sending" || state === "unsure";

export const SENT_WORDS = {
  sending: "Sending", chain: "On chain", failed: "Not sent", expired: "Not on chain",
  unsure: "May not be sent",
};

const SENT_NOTES = {
  unsure: "This page cannot tell if the network took the message. It may still arrive. Zigs "
    + "holds the notes until a block holds it or it expires.",
  expired: "No block held it in time. The notes are free again.",
};

// The extra line under a sent message that did not arrive.
export const sentNote = (rec, state) =>
  state === "failed" ? "The network refused it: " + rec.failed : SENT_NOTES[state] || "";

// ── Received messages ──
// One item for each message of a transaction that went to one address of the account. `join`
// gives the whole text of a list of memo texts, or null (the engine's joinMessage). A memo that is
// not text is an item of its own with `text: null`, and it keeps the others apart.
function itemsOf(tx, index, group, join) {
  const isText = (m) => m.status === "text" && typeof m.text === "string";
  const texts = group.map((m) => (isText(m) ? m.text : null));
  const whole = texts.every((t) => t !== null) ? join(texts) : null;
  const make = (k, text, parts) => ({
    key: tx.txid + ":" + index + ":" + k, txid: tx.txid, height: tx.height,
    confirmed: !!tx.confirmed, index, text, parts,
  });
  return whole !== null ? [make(0, whole, texts.length)] : texts.map((t, k) => make(k, t, 1));
}

export function receivedItems(received, join) {
  const items = [];
  for (const tx of Array.isArray(received) ? received : []) {
    const byIndex = new Map();
    for (const m of Array.isArray(tx.memos) ? tx.memos : []) {
      const index = Number.isInteger(m?.index) ? m.index : null;
      byIndex.set(index, [...(byIndex.get(index) || []), m]);
    }
    for (const [index, group] of byIndex) items.push(...itemsOf(tx, index, group, join));
  }
  return items;
}

// Splits items between the chats of the contacts and the other messages. Index 0 is the public
// address of the account and no contact has it. An index that no contact has, or none, is other.
export function routeItems(items, contacts) {
  const chats = new Map(contacts.map((c) => [c.index, []])), other = [];
  for (const item of items) (chats.get(item.index) || other).push(item);
  return { chats, other };
}

// Where an "other" message went, in words.
export function otherWhere(index) {
  if (index === 0) return "Sent to your public address";
  if (index === null) return "Sent to an address that this app cannot place";
  return "Sent to an address of this account that no contact has";
}

// The messages of one chat, oldest first: received items and sent records. `at(height)` gives the
// time of a block.
export function chatTimeline(received, sent, at) {
  const rows = [
    ...received.map((r) => ({ ...r, dir: "in", at: at(r.height), id: r.key })),
    ...sent.map((s) => ({ ...s, dir: "out", id: s.txid })),
  ];
  return rows.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
