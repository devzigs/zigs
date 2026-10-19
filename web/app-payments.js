// Propose, approve, sign, cancel and broadcast; the payment check and expiry.
import { allPaid, pairPayees } from "./payees.js";
import { partFields, proposalFields } from "./signed.js";
import { EXPIRY_MARGIN } from "./personal.js";
import { payeeRows } from "./requests.js";
import { busy, log, ready, showBanner, state, ui } from "./app-state.js";
import { exclusive, fmtZec, isStr, J, release, S, said, track, withTimeout } from "./app-kit.js";
import { engineOffThread, Z } from "./app-engine.js";
import { loadKept, mySeatSecrets, putSec, saveKept, sec, takeStored } from "./app-keystore.js";
import { isMe, keysDiffer, localSeats, myUid, signersOf } from "./app-seats.js";
import {
  balanceNow, chain, curChain, curNet, dropStalled, inFlight, netName, preferredServers, runSync,
  SERVER_TIMEOUT_MS, serverWait, syncAgain,
} from "./app-chain.js";
import {
  canWriteAs, mayAct, NO_SEAT_KEY, partNow, signedDoc, signedMode, sigPart, writer,
} from "./app-filter.js";
import { closeSession, openSession, sdb } from "./app-groups.js";
import { groupName, isPayee, normalized, payTitle } from "./app-dom.js";
import { myVerified, seatCheck } from "./app-dkg.js";
import { once, react, render } from "./app-loop.js";
import { openSend } from "./app-send.js";
import { nameRefusal, registry } from "./zns.js";

const inspectCache = new Map();

// The signing steps of payment `ss`, with its approvals and shares (`parts`): those of the open
// drawer, or of a watched payment (needsWork).
export function reactSession(ss, parts = { commits: state.commits, shares: state.shares }) {
  const fvk = state.wallet.orchard_fvk;
  if (!signable(ss, fvk)) return;
  if (!ss.package && isProposer(ss)) buildPackage(ss, fvk, parts.commits);
  if (ss.package) signMyShares(ss, fvk, parts.shares);
  if (ss.package && !ss.signed) aggregateShares(ss, parts.shares);
}

// The engine takes only strings. A document with another type would crash it.
const readable = (ss, fvk) => isStr(ss.pczt) && isStr(fvk)
  && (ss.package == null || isStr(ss.package));
const signable = (ss, fvk) => readable(ss, fvk) && !ss.error && !expired(ss);

// A payment of the open wallet that this browser must act on also when its drawer is closed: a
// proposal of a seat here that waits for its package, or a package that a seat here proposed or
// approved and that is not signed yet (a seat here signs, or this browser combines the shares).
// The cheap tests come first: `expired` asks the engine.
export function needsWork(ss) {
  if (ss.error || ss.signed || !isStr(ss.pczt)) return false;
  const mine = ss.package ? isProposer(ss) || approvedHere(ss) : isProposer(ss);
  return mine && !expired(ss);
}
// ponytail: at most WATCH_MAX payments at once, those with a package first, then the newest.
// More wait until the older ones end or expire.
const WATCH_MAX = 8;
/** The payments of `list` that this browser watches (M5). */
export const toWatch = (list) => list.filter(needsWork)
  .sort((a, b) => Number(!!b.package) - Number(!!a.package)).slice(0, WATCH_MAX);

// An approval of a seat here: its mark, or what approvalKept says.
const approvedHere = (ss) => !!markOf(state.gid, ss.id).approved
  || mySeatSecrets(state.gid).some(([, s]) => approvalKept(s, ss.id));
/** Seat secret `s` holds the nonces of payment `sid`, or a share of it that did not go out yet. */
export const approvalKept = (s, sid) => !!(s?.nonces || {})[sid] || !!(s?.unsent || {})[sid];

// Every change of the nonces of this browser (an approval, a share, a cancel) runs under one
// lock, and first takes what storage holds now. The secrets are saved as one record, so two tabs
// that change it at once would undo each other's change and could bring a burned nonce back.
// ponytail: the other writes of the record (a backup, a room, the account, Solana) take no lock,
// so one of them can still bring a nonce back; ZEC-12 writes only `nonces[<payment>]`.
const withSecrets = (fn) => exclusive("secrets", async () => { await takeStored(); return fn(); });
// A cancel of this tab that is not in the store yet: no approval or share of this tab goes out for
// it. A payment that this browser knows as cancelled or failed is stopped too.
const cancelling = new Set();
const stopped = (ss) => cancelling.has(ss.id)
  || !!state.sessions.find((x) => x.id === ss.id)?.error;

// Saves `patch` for seat i. When the save fails, memory gets the old values back, so that a try
// again starts from what storage holds, and the step fails with `failure`.
async function saveOrUndo(gid, i, patch, s, failure) {
  const before = Object.fromEntries(Object.keys(patch).map((k) => [k, s[k]]));
  if (await putSec(gid, i, patch)) return;
  await putSec(gid, i, before);
  throw new Error(failure ?? "This browser could not save the change of seat " + i + ".");
}

const sessionPath = (ss, gid = state.gid) => "groups/" + gid + "/sessions/" + ss.id;
// In a version 3 wallet the proposer is the seat in `by`. Before, it is the identity in
// `createdBy`.
const isProposer = (ss) => Number.isInteger(ss.by)
  ? localSeats().includes(ss.by) && canWriteAs(ss.by) : isMe(ss.createdBy);

// Does the stored session document hold a package that may be used? In a version 3 wallet an
// unsigned package must not block the real one.
async function packageStands(gid, sid, d) {
  if (!d.package) return false;
  if (!signedMode(gid)) return true;
  const part = {
    rel: "sessions/" + sid, by: d.packageBy, sig: d.packageSig, fields: partFields("package", d),
    need: null,
  };
  return (await partNow(gid, part)) !== "no";
}

// A step of a payment whose drawer is not open names that payment in its error. The title is the
// proposer's text, so it is quoted, on one line and short.
const step = (key, ss, fn) => once(key, () => fn().catch((e) => {
  if (ss.id === state.sid) throw e;
  const title = payTitle(ss).replace(/\p{Cc}+/gu, " ").slice(0, 40);
  throw new Error("\"" + title + "\": " + said(e));
}));

// Coordinator: once t approvals are in, build the signing package.
function buildPackage(ss, fvk, commits) {
  const gid = state.gid, t = state.g.t;
  const ids = Object.keys(commits).map(Number).sort((a, b) => a - b).slice(0, t);
  if (ids.length < t) return;
  step("pkg:" + ss.id, ss, async () => {
    const c = {}; for (const i of ids) c[i] = commits[i].commitments;
    const pkg = Z.signPackage(ss.pczt, fvk, S(c), t);
    // Two browsers can hold the same seat (a restored copy): only one writes the package.
    const ref = sdb.doc(sessionPath(ss, gid));
    if (!(await ref.acquire({ holder: crypto.randomUUID(), ttlMs: 10000 })).acquired) return;
    const cur = await ref.get();
    if (cur.exists && (await packageStands(gid, ss.id, cur.data()))) return;
    const fields = { package: pkg, signers: ids };
    const sig = await sigPart(gid, ss.id, "package", fields, ss.by);
    await ref.update({ ...fields, status: "signing", ...sig });
    log("signing package sent to signers " + ids.join(", "));
  });
}

// Signer: once the package names a seat of this browser, re-verify everything and sign. A share
// that this browser made and did not send yet goes out again.
function signMyShares(ss, fvk, shares) {
  const gid = state.gid;
  for (const i of localSeats()) {
    const ready = approvalKept(sec(gid, i), ss.id) && !waitsForSave(ss.id, i);
    if (canWriteAs(i) && signersOf(ss).includes(i) && ready && !shares[i]) {
      step("share:" + ss.id + ":" + i, ss, () => signShare(ss, fvk, i, gid));
    }
  }
}

// Inside the lock the nonce comes from storage: a nonce that another tab used signs nothing, and
// neither does a payment that was cancelled. The step keeps its wallet: when the person opened
// another one meanwhile, it stops. The network write comes after the lock, so a server that does
// not answer holds no other step.
function signShare(ss, fvk, i, gid) {
  return withSecrets(async () => {
    if (state.gid !== gid || stopped(ss)) return null;
    const s = sec(gid, i) || {}, kept = (s.unsent || {})[ss.id], n = (s.nonces || {})[ss.id];
    if (kept) return kept;
    if (!n) {
      log("seat " + i + ": its nonce for this payment is used or gone, so it signs nothing");
      return null;
    }
    return signShareNow(ss, fvk, i, n, gid);
  }).then((out) => out && sendShare(ss, gid, i, out));
}

// Signs, and saves the burn with what the step made: the share, or `{ changed: true }` when the
// payment changed after the approval. That goes out also after a write that failed or a reload.
// Returns what to send.
async function signShareNow(ss, fvk, i, n, gid) {
  const s = sec(gid, i), ins = inspectOf(ss);
  const nonces = { ...s.nonces }; delete nonces[ss.id];
  let out = { changed: true };
  if (n.sighash && ins && !ins.error && ins.sighash === n.sighash) {
    // The engine checks the approved sighash again before it signs.
    const shares = Z.signShare(ss.pczt, fvk, ss.package, S(n), S(s.keyPackage), i);
    const rel = "sessions/" + ss.id + "/shares/" + i;
    out = { rel, doc: await signedDoc(gid, rel, i, { shares, at: Date.now() }) };
  }
  // Save the burn before the share goes out: a nonce that comes back could sign twice.
  await saveBurn(gid, i, ss, { nonces, unsent: { ...s.unsent, [ss.id]: out } }, s);
  return out;
}

// A share step whose burn does not save waits longer before each new try: 3 s, then 6, 12 and up
// to 60 s. So a browser that cannot save does not sign again and again.
const burnRetry = new Map();   // "<payment>:<seat>" -> { n, at }
const waitsForSave = (sid, i) => (burnRetry.get(sid + ":" + i)?.at ?? 0) > Date.now();
async function saveBurn(gid, i, ss, patch, s) {
  const k = ss.id + ":" + i;
  try {
    await saveOrUndo(gid, i, patch, s,
      "Could not save the used nonce, so the signature share was not sent.");
  } catch (e) {
    const n = (burnRetry.get(k)?.n ?? 0) + 1, wait = Math.min(3000 * 2 ** (n - 1), 60000);
    burnRetry.set(k, { n, at: Date.now() + wait });
    setTimeout(react, wait + 50);
    throw e;
  }
  burnRetry.delete(k);
}

// After the lock: sends the share, or fails the payment that changed. Then the kept copy goes.
async function sendShare(ss, gid, i, out) {
  if (out.changed) await failSession(gid, ss, "The payment changed after a signer approved it.");
  else await sdb.doc("groups/" + gid + "/" + out.rel).set(out.doc);
  await withSecrets(() => dropUnsent(gid, i, ss.id));
  if (out.changed) {
    throw new Error("This payment changed after you approved it, so this browser did not sign it.");
  }
  log("seat " + i + ": signature share sent");
}
// ponytail: a kept copy whose removal does not save stays in the record until a later removal.
async function dropUnsent(gid, i, sid) {
  const s = sec(gid, i);
  if (!(s?.unsent || {})[sid]) return;
  const unsent = { ...s.unsent };
  delete unsent[sid];
  await putSec(gid, i, { unsent });
}

// Any participant: aggregate. The result is deterministic, so a race is harmless.
function aggregateShares(ss, shares) {
  const gid = state.gid;
  if (!localSeats().length || !mayAct() || !signersOf(ss).every((i) => shares[i])) return;
  step("agg:" + ss.id, ss, async () => {
    const sh = {}; for (const i of signersOf(ss)) sh[i] = J(shares[i].shares);
    const ref = sdb.doc(sessionPath(ss, gid));
    let r;
    try { r = J(Z.signAggregate(ss.pczt, state.done[1].publicKeyPackage, ss.package, S(sh))); }
    catch (e) { await failSession(gid, ss, e.message || String(e)); throw e; }
    // A seat signs the result. A seat that cannot sign is no failure of the payment.
    const result = { signed: r.signed_pczt, signatures: r.signatures };
    const sig = await sigPart(gid, ss.id, "signed", result);
    await ref.update({ ...result, status: "signed", ...sig });
    log("signatures aggregated and verified under rk");
  });
}

// `payees` (address, amount and optional memo) and `note` are the proposer's words; approvers
// check `payees` against the transaction.
// One open payment at a time (ZEC-10, S8): the engine picks from all unspent notes, so a second
// proposal would spend the same notes and fail only at the broadcast. A proposal counts until it
// is cancelled, failed, sent or expired. One that this browser cannot read, or that expires more
// than 1 + DAY2_BLOCKS blocks after the synced height, does not count. A payment whose approval
// here changed counts through the hold of that approval, with its own text.
// ponytail: one document stops Send for up to 6912 blocks (2 days at 25 s, 6 at 75 s), and one
// seat can write documents one after another, also with a signed part that removes Cancel.
// ZEC-14 tracks the documents that one seat writes.
export function isOpen(ss) {
  const c = curChain();
  if (!chainReady(c) || ss.error || ss.broadcastTxid || landed(ss) || expired(ss)) return false;
  if (approvalChanged(ss)) return false;
  const at = expiryAt(ss);   // null for a proposal that this browser cannot read
  return at !== null && at <= c.bal.height + 1 + DAY2_BLOCKS;
}

// A double tap on Propose must not make two proposals.
// Every proposal asks the blockers of Send that guard the notes (a proposal that runs, a payment
// in flight, an open payment, a hold), also "Propose again" on a move.
// ponytail: the flag holds in this tab only; two tabs or two seats can still race for seconds. A
// document whose check still waits does not count as open yet, and neither does a proposal that
// this browser sees from a sync far behind the chain.
const PROPOSING = "The proposal of a payment is not complete yet. Wait a moment.";
export const newSpend = (...args) => proposing(() => proposeNow(...args));
/** Proposes the transaction that the Send review showed (prepareSpend), as it is. */
export const proposePrepared = (prep, note) => proposing(() => proposeBuilt(prep, note));
async function proposing(run) {
  const why = holdBlocker();
  if (why) throw new Error(why);
  ui.proposing = true;
  render();
  try { return await run(); }
  finally { ui.proposing = false; }
}

// A payee has a memo only when it has text, and a name only when it was paid by name. A payee
// without them stays {to, amount}.
function keptPayee({ to, amount, memo, name }) {
  const p = { to, amount };
  if (memo) p.memo = memo;
  if (isStr(name) && name) p.name = name;
  return p;
}

async function proposeNow(payees, note, move = null, priority = false, after) {
  const at = { gid: state.gid, approvals: state.g.t };
  readyToSpend(at.gid);
  payees = payees.map(keptPayee);
  // `after`: the approved PCZT of an expired payment. The engine spends all of its notes too.
  await publishSpend(at, payees, note, J(await spendOrStall(chain, payees, priority, after)), move);
}
async function proposeBuilt(prep, note) {
  const at = { gid: state.gid, approvals: state.g.t };
  readyToSpend(at.gid);
  if (prep.gid !== at.gid) throw new Error("The review belongs to another wallet.");
  await publishSpend(at, prep.payees, note, prep.t, null);
}
// The proposal document of transaction `t`, signed by a seat of this browser, in wallet `at.gid`.
async function publishSpend(at, payees, note, t, move) {
  const ref = sdb.collection("groups/" + at.gid + "/sessions").doc();
  const fields = proposalFields(payees, note, t, move, Date.now());
  const sig = await sigPart(at.gid, ref.id, "proposal", fields);
  await ref.set({ createdBy: myUid(), status: "collecting", ...fields, ...sig });
  log("new spend: " + fmtZec(t.amount));
  showBanner("ok", "Payment proposed. It needs " + at.approvals + " approvals.");
  if (state.gid === at.gid) openSession(ref.id);
}

function readyToSpend(gid) {
  if (!chain || chain.gid !== gid || !chain.bal) {
    throw new Error("The wallet has not finished its first sync.");
  }
  if (!mayAct()) throw new Error(NO_SEAT_KEY);
}

/**
 * Builds the transaction of a new payment without proposing it, for the Send review: the same
 * guards as a proposal (the Send holds, the first sync, a seat that can sign) and the same engine
 * call. The review decodes `t.pczt`, and proposing it later needs no new build.
 * @returns {Promise<{gid: string, payees: object[], t: object, at: number}>}
 */
export async function prepareSpend(payees, priority) {
  const why = holdBlocker();
  if (why) throw new Error(why);
  const gid = state.gid;
  readyToSpend(gid);
  ui.proposing = true;
  render();
  try {
    const kept = payees.map(keptPayee);
    return { gid, payees: kept, t: J(await spendOrStall(chain, kept, priority)), at: Date.now() };
  } finally { ui.proposing = false; }
}

// Only a PCZT text goes to the engine: a click event that a handler passes on is none.
const pcztOrNone = (p) => (isStr(p) ? p : undefined);

// A proposal with no answer in SPEND_TIMEOUT_MS stops (S9). The engine may still use the wallet
// object, so it counts as stalled, and a sync starts at once on the next server: Propose waits for
// it (RECONNECT), so it does not wait on the same server again.
// ponytail: the late answer of the engine is dropped; nothing stops the engine call.
const SPEND_TIMEOUT_MS = 60000;
const WHEN_SYNCED = "Propose again when the wallet is up to date.";
function spendOrStall(c, payees, priority, after) {
  const cw = c.cw;
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (c.cw === cw) {
        dropStalled(c);
        if (c === chain) syncAgain(c);   // not the chain of a wallet that closed meanwhile
      }
      reject(new Error("The proposal got no answer in 60 s, so it stopped. " + WHEN_SYNCED));
    }, SPEND_TIMEOUT_MS);
  });
  return Promise.race([track(cw, cw.createSpend(S(payees), priority, pcztOrNone(after))), late])
    .finally(() => clearTimeout(timer));
}

// Sends every confirmed note to the wallet that replaces this one.
export async function proposeMove(after = null) {
  const to = state.g.movedTo, tw = ready[to], c = curChain();
  if (!tw) throw new Error("The new wallet has no address yet.");
  const amount = c && c.bal ? c.bal.max_send : 0;
  if (!(amount > 0)) throw new Error("No confirmed funds to move yet.");
  await newSpend([{ to: tw.address, amount }], "Move to " + groupName(to), to, false, after);
}

export async function cancelMove() {
  await sdb.doc("groups/" + state.gid).update({ movedTo: null, movedAt: null });
  showBanner("ok", "Move cancelled. This wallet stays as it is.");
}

// The id that the finished transaction must have: of the PCZT whose sighash a seat of this
// browser approved (afterOf), else of the proposal. Null when it cannot be read.
export const approvedTxid = (ss) => markOf(state.gid, ss.id).approved
  ? txidOf({ pczt: afterOf(ss) }) : txidOf(ss);

// Null when the finished transaction has the approved id, else why it does not go out. Nothing
// that cannot be read goes out.
// ponytail: compares the `final.txid` that one seat wrote, not the bytes of `tx_hex`. The full
// check needs an engine call that computes the id of a finished transaction from its bytes.
export function sendRefusal(ss) {
  if (!isStr(ss.final?.txid)) return "The finished transaction cannot be read.";
  const bound = !!markOf(state.gid, ss.id).approved, want = approvedTxid(ss);
  if (!want) return unread(bound ? "the approved transaction" : "the proposal");
  if (ss.final.txid === want) return null;
  return bound ? SEND_OTHER : SEND_NOT_PROPOSED;
}
const unread = (what) => "This browser cannot read " + what + ", so it does not send the "
  + "finished one.";
const SEND_OTHER = "The finished transaction has another id than the approved one, so this "
  + "browser does not send it. Check the payment with the other signers.";
const SEND_NOT_PROPOSED = "The finished transaction has another id than the proposal, so this "
  + "browser does not send it. Check the payment with the other signers.";

export async function broadcastTx(ss) {
  // Before the try: a refusal writes no error into the payment.
  const why = sendRefusal(ss);
  if (why) throw new Error(why);
  const gid = state.gid, ref = sdb.doc(sessionPath(ss, gid));
  try {
    if (!isStr(ss.final.tx_hex) || !isStr(ss.final.txid)) {
      throw new Error("The finished transaction cannot be read.");
    }
    // The sent mark names the txid of the final transaction, and a seat signs it. A seat that
    // cannot sign fails here, before the transaction goes out.
    const sent = { broadcastTxid: ss.final.txid, broadcastAt: Date.now() };
    const sig = await sigPart(gid, ss.id, "sent", sent);
    await broadcastAnywhere(ss.final.tx_hex);
    await ref.update({ ...sent, ...sig, broadcastError: null, status: "broadcast" });
    log("transaction broadcast: " + ss.final.txid);
    showBanner("ok", "Sent to the network. It confirms with the next block.");
    // The person may have opened the lobby or another wallet while the transaction went out.
    const c = curChain();
    if (c?.gid === gid) runSync(c);
  } catch (e) {
    await ref.update({ broadcastError: e.message || String(e) });
  }
}

// Tries each server in turn, first those that did not fail lately (S9); a temporary wallet is
// enough because broadcasting needs no sync.
// `where` names the network, viewing key and birthday of the sender: the open wallet or account.
// The error has `refused` when every server answered with a refusal. Any other failure (a timeout,
// a lost connection) leaves open whether a server took the transaction.
export async function broadcastAnywhere(txHex, where = {
  net: curNet(), ufvk: state.wallet.ufvk, birthday: state.wallet.birthday,
}) {
  const errors = [];
  let refused = true;
  for (const url of preferredServers(where.net)) {
    const cw = new Z.ChainWallet(where.ufvk, where.birthday, url);
    try {
      const sent = track(cw, cw.broadcast(txHex));   // the glue throws at once on a bad argument
      return J(await withTimeout(sent, SERVER_TIMEOUT_MS * 2, new URL(url).host));
    }
    catch (e) {
      refused = refused && Z.isNodeRefusal(said(e));
      errors.push(new URL(url).host + ": " + said(e));
    }
    finally { release(cw); }
  }
  throw Object.assign(new Error(errors.join("; ")), { refused });
}

// Why seat i cannot approve the payment now, or null.
function approveRefusal(ss, i, ins) {
  if (ss.error) return "This payment was cancelled or failed, so it was not approved.";
  if (expired(ss)) return "This payment expired, so it was not approved. Propose it again.";
  if (state.pending) return "Zigs is still checking this wallet's data. Try again in a moment.";
  if (!ins || ins.error) return "This browser could not check the payment, so it did not approve.";
  if (seatCheck(i) !== true) {
    return "Seat " + i + " has not checked this wallet against its key share, so it did not "
      + "approve.";
  }
  return markRefusal(ss, i, ins);
}

// A session that this browser saw sign, or that a seat of it approved, never gets an approval
// again: one seat can reset a signed session to a fresh proposal (TICKETS.md ZEC-9).
function markRefusal(ss, i, ins) {
  const gid = state.gid, m = markOf(gid, ss.id);
  if (seenSigning(ss.id, true)) {
    return "The signing of this payment started before, so this browser does not approve it again.";
  }
  if ((sec(gid, i).marks || {})[ss.id]?.approved) return "This seat already approved this payment.";
  if (m.approved && m.approved !== ins.sighash) {
    return "This payment changed after this browser approved it, so it was not approved again.";
  }
  return null;
}

// One approval at a time for each payment and seat: a second click during the waits below would
// make other nonces.
export async function approve(ss, i) {
  const key = "approve:" + ss.id + ":" + i;
  if (busy.has(key)) return;
  busy.add(key);
  try { await approveNow(ss, i); } finally { busy.delete(key); }
}

async function approveNow(ss, i) {
  const gid = state.gid, ins = inspectOf(ss);
  const why = approveRefusal(ss, i, ins);
  if (why) throw new Error(why);
  // The engine refuses an expired payment. It checks against the chain height now, because the
  // last sync can be minutes old.
  const tip = await freshTip();
  await checkNames(ss, tip);
  // Under the lock of the secrets: a write here neither brings back a burned nonce nor drops a
  // new one of another tab.
  const doc = await withSecrets(() => commitNow(ss, i, ins, tip, gid));
  const rel = "sessions/" + ss.id + "/commits/" + i;
  await keep(gid, ss.id, ss.pczt);
  await sdb.doc("groups/" + gid + "/" + rel).set(doc);
  log("seat " + i + ": approved the spend, nonce commitment published");
  showBanner("ok", "Approved" + (localSeats().length > 1 ? " as seat " + i : "") + ".");
}

// A payee with a ZNS name (testnet only): this browser looks the name up again, in its own copy of
// the registry, and approves only the address that the name gives now. A proposal without names
// asks no registry.
async function checkNames(ss, tip) {
  const payees = payeesOf(ss);
  if (!payees.some((p) => Object.hasOwn(p, "name"))) return;
  if (netName(state.g) !== "testnet") {
    throw new Error("ZNS names work on testnet only, so this browser did not approve.");
  }
  const why = nameRefusal(payees, await registry.get(), tip);
  if (why) throw new Error(why);
}

// Makes and saves the nonces of the approval of seat `i`. Returns the commitment document.
async function commitNow(ss, i, ins, tip, gid) {
  if (state.gid !== gid) throw new Error("Another wallet is open now. Open this one and approve.");
  if (stopped(ss)) throw new Error("This payment was cancelled or failed, so it was not approved.");
  if ((sec(gid, i).nonces || {})[ss.id]) throw new Error("This seat already approved this payment.");
  const late = markRefusal(ss, i, ins);
  if (late) throw new Error(late);
  const r = J(Z.signCommit(ss.pczt, state.wallet.orchard_fvk, S(sec(gid, i).keyPackage), tip));
  // The approval covers this exact transaction: a share is signed later only for the same sighash.
  const mine = { nonces: r.nonces, commitments: r.commitments, sighash: ins.sighash };
  const rel = "sessions/" + ss.id + "/commits/" + i;
  // A seat that cannot sign fails here, before the approval is saved.
  const doc = await signedDoc(gid, rel, i, { commitments: r.commitments, at: Date.now() });
  const nonces = { ...(sec(gid, i).nonces || {}), [ss.id]: mine };
  // The approved sighash stays after the nonce burn: the session state needs it (ZEC-13).
  const marks = withMark(sec(gid, i).marks, ss.id, { approved: ins.sighash, tip });
  await saveOrUndo(gid, i, { nonces, marks }, sec(gid, i),
    "Could not save the approval in this browser, so it was not sent.");
  return doc;
}

// The chain height now, from the server of the last sync, else from the other servers of the
// network in the order of preferredServers. After a server stopped answering, the wallet has no
// server until the next sync, and the others still answer.
async function freshTip() {
  const c = curChain();
  if (!c || !c.bal) throw new Error("Wait for the first sync to finish, then approve.");
  const net = curNet(), order = preferredServers(net), errors = [];
  const urls = c.url ? [c.url, ...order.filter((u) => u !== c.url)] : order;
  for (const [at, url] of urls.entries()) {
    const host = new URL(url).host;
    try { return await withTimeout(Z.latestHeight(url), serverWait(net, at, url), host); }
    catch (e) { errors.push(host + ": " + said(e)); }
  }
  throw new Error("No light-wallet server gave the chain height, so this browser did not "
    + "approve. " + errors.join("; "));
}

// A sent payment that no block holds yet keeps the wallet's notes until it expires. A node can
// drop it, so any signer can send the same transaction again. The sent mark stays as it is.
export async function resendTx(ss) {
  const why = sendRefusal(ss);
  if (why) throw new Error(why);
  // A seat writes the final part: a value that is not text would trap in the engine.
  if (!isStr(ss.final?.tx_hex)) throw new Error("The finished transaction cannot be read.");
  await broadcastAnywhere(ss.final.tx_hex);
  showBanner("ok", "Sent again. It confirms with the next block.");
}

export async function cancelPayment(ss) {
  if (ss.signed || ss.error) throw new Error("This payment is already signed or closed, so it cannot be cancelled.");
  // From the click on, no step of this tab approves or signs it (stopped).
  cancelling.add(ss.id);
  try { await cancelNow(ss); }
  catch (e) {
    if (!e.cancelled) cancelling.delete(ss.id);
    throw e;
  }
  showBanner("ok", "Payment cancelled.");
}
async function cancelNow(ss) {
  const gid = state.gid, seat = writer(undefined, gid) ?? localSeats()[0];
  const who = ((state.seats[seat] || {}).name || "a signer") + " (seat " + seat + ")";
  const fields = { error: "Cancelled by " + who + "." };
  const sig = await sigPart(gid, ss.id, "cancel", fields);
  // The nonces go first, under the lock: a step of any tab that waits for the lock then signs
  // nothing. When their save fails, the cancel still goes out, and the approval stays here.
  const unsaved = await withSecrets(async () => {
    for (const [i] of mySeatSecrets(gid)) await burnUnsigned(gid, i, ss);
  }).then(() => null, (e) => e);
  try {
    await sdb.doc(sessionPath(ss, gid)).update({
      ...fields, status: "cancelled", cancelledAt: Date.now(), ...sig,
    });
  } catch (e) {
    if (unsaved) throw e;
    throw new Error("This browser no longer signs this payment, but the cancel did not reach the "
      + "store. Cancel again. " + said(e));
  }
  if (unsaved) {
    throw Object.assign(new Error("The payment is cancelled, but this browser could not change its "
      + "saved keys, so its approval stays here. " + said(unsaved) + " To end the hold, release it "
      + "in the payment."), { cancelled: true });
  }
}

// Cancel burns the nonce of each seat here (S7). The mark says `burned` only when the seat surely
// made no share: under the lock of the secrets storage still holds the nonce (signShare saves its
// burn before the share goes out), the open payment shows no share of the seat, and its approval
// shows the commitments of this nonce, so no restored copy of the seat elsewhere approved for it.
// The approvals and shares of the drawer belong to the open payment only, so another payment
// never matches. A made share that did not go out goes too. It runs under the lock of the secrets.
async function burnUnsigned(gid, i, ss) {
  const s = sec(gid, i);
  if (!approvalKept(s, ss.id)) return;
  const nonces = { ...s.nonces }, unsent = { ...s.unsent };
  delete nonces[ss.id];
  delete unsent[ss.id];
  const patch = { nonces, unsent };
  if (surelyUnsigned(s, i, ss.id)) patch.marks = withMark(s.marks, ss.id, { burned: true });
  await saveOrUndo(gid, i, patch, s);
}
function surelyUnsigned(s, i, sid) {
  const kept = (s.nonces || {})[sid];
  return !!kept && !!(s.marks || {})[sid] && unsignedHere(i, kept);
}
const unsignedHere = (i, nonce) => !state.shares[i]
  && S(state.commits[i]?.commitments) === S(nonce.commitments);

export async function finalizeTx(ss) {
  const gid = state.gid, ref = sdb.doc(sessionPath(ss, gid));
  if (!mayAct()) throw new Error(NO_SEAT_KEY);   // checked before a minute of work
  await ref.update({ status: "proving", provingAt: Date.now() });
  log("building Halo2 proof (about a minute)…");
  let out;
  try { out = await engineOffThread("finalize", ss.signed); }
  catch (e) { await ref.update({ status: "signed" }); throw e; }
  // A seat signs the proof and the finished transaction.
  const sig = await sigPart(gid, ss.id, "final", { final: out });
  await ref.update({ status: "complete", final: out, ...sig });
  log("transaction complete: " + out.txid);
  showBanner("ok", "Proof ready. Send the payment to the network.");
}

export async function failSession(gid, ss, error) {
  const sig = await sigPart(gid, ss.id, "failure", { error });
  await sdb.doc(sessionPath(ss, gid)).update({ error, status: "failed", ...sig });
}
// ZIP 317 for a payment from up to `outputs` notes: one action per output, change included. A
// priority payment pays PRIORITY_FACTOR times as much (the engine's cap).
export const PRIORITY_FACTOR = 10;
export const feeEstimate = (payees, priority = false) =>
  5000 * Math.max(2, payees + 1) * (priority ? PRIORITY_FACTOR : 1);

export const sendBlocker = () => setupBlocker() || holdBlocker() || fundsBlocker(curChain().bal);

function setupBlocker() {
  const c = curChain();
  if (keysDiffer()) return "The signers hold different wallet keys. Do not use this wallet.";
  if (!localSeats().length) return "You hold no seat in this wallet.";
  if (!myVerified()) return "Your seat is still checking the wallet address.";
  return !c || !c.bal ? "Wait for the first sync to finish." : null;
}

const OPEN_TEXT = "Finish or cancel the open payment, or wait until it expires.";
// After a server stopped answering a proposal or a sync, the wallet keeps the stalled object until
// a sync connects to the next server. A proposal on it would wait on the same server.
const RECONNECT = "The light-wallet server stopped answering. " + WHEN_SYNCED;
function holdBlocker() {
  if (ui.proposing) return PROPOSING;
  if (curChain()?.stalled) return RECONNECT;
  // ponytail: the engine does not know about unmined spends and would pick the same notes again.
  if (inFlight().length) return "A payment is waiting for its block. Send again in a minute.";
  if (state.sessions.some(isOpen)) return OPEN_TEXT;
  return heldApprovals().length ? "A payment that you approved can still go on chain. Send "
    + "again when a block holds it or it expires. After a cancel, open that payment to release "
    + "it." : null;
}

function fundsBlocker(bal) {
  const b = balanceNow(bal);
  if (b.spendable > feeEstimate(1)) return null;
  if (b.pending) return "Incoming funds need 3 confirmations first.";
  return b.spendable ? "The balance does not cover the network fee." : "This wallet has no funds yet.";
}
// A prover that closed its tab leaves status "proving"; let someone else take over.
export const proofStalled = (ss) => Date.now() - (ss.provingAt || 0) > 180000;

// Keyed by the transaction itself: a session whose transaction is replaced is decoded again.
export const inspectOf = (ss) => inspectPczt(ss.pczt);
function inspectPczt(key) {
  const fvk = state.wallet.orchard_fvk;
  let ins = inspectCache.get(key);
  if (!ins && Z && key) {
    // The engine takes only strings. A document with another type would crash it.
    if (!isStr(key) || !isStr(fvk)) ins = { error: "This payment has no readable transaction." };
    else {
      try { ins = J(Z.inspect(key, fvk)); }
      catch (e) { ins = { error: e.message || String(e) }; }
    }
    inspectCache.set(key, ins);
  }
  return ins;
}

// When the payment expires, counted by the engine from the height of the last sync:
// {expired, blocks_left, seconds_left}. Null while this browser cannot tell.
export function expiryOf(ss) {
  const c = curChain(), at = expiryAt(ss);
  if (!c || !c.bal || at === null) return null;
  try { return J(Z.expiryState(netName(state.g), at, c.bal.height)); }
  catch { return null; }
}

// The expiry height that counts, or null: of the approved transaction on a browser that
// approved (one seat can rewrite the proposal), else of the proposal.
export function expiryAt(ss) {
  if (!state.wallet) return null;
  const own = markOf(state.gid, ss.id).approved ? afterOf(ss) : ss.pczt;
  const ins = own ? inspectPczt(own) : null;
  return ins && !ins.error && Number.isInteger(ins.expiry_height) ? ins.expiry_height : null;
}

// The id that the payment's transaction gets on chain, from the approved PCZT. One seat writes
// `final.txid` alone, so the page never uses it to decide whether a block holds the payment.
export function txidOf(ss) {
  const ins = state.wallet && ss.pczt ? inspectOf(ss) : null;
  return ins && !ins.error && isStr(ins.txid) ? ins.txid : null;
}
// A synced block holds the payment, whatever the session document says.
export function onChain(ss) {
  const c = curChain(), id = txidOf(ss);
  return !!(c && c.sent && id && c.sent.has(id));
}

// A payment that no signer can approve, sign or send any more, and that no block holds: its notes
// are free again. A payment with a finished transaction can be on the network without a sent mark
// (a send that timed out after a server took it, or a mark that was not saved). So it counts as
// gone only EXPIRY_MARGIN blocks after its expiry height, as a message does, because a
// reorganisation of the last blocks can still bring it on chain.
export function expired(ss) {
  // A browser that approved takes the engine's word, also when the proposal does not decode.
  if (boundExpired(ss) || pastCeiling(ss)) return true;
  const e = !ss.error && expiryOf(ss), c = curChain();
  // `landed`: once signing started, a proposal that one seat rewrote does not count.
  if (!e || landed(ss)) return false;
  if (!ss.final) return e.expired;
  return c.bal.height >= expiryAt(ss) + EXPIRY_MARGIN;
}

// Two days of 25-second blocks (more days at 75 seconds, so the bounds below only grow).
export const DAY2_BLOCKS = 2 * 3456;
// A seat approves only a payment that expires at most one day of blocks and one day of slack
// after the next block (`expiry::check` of the engine), so nothing that it approved can land
// after that and the margin, even when this browser lost the PCZT.
function pastCeiling(ss) {
  const tip = markOf(state.gid, ss.id).tip, c = curChain();
  if (!Number.isInteger(tip) || !c || !c.bal) return false;
  return c.bal.height >= tip + 1 + DAY2_BLOCKS + EXPIRY_MARGIN && !landed(ss);
}

// ── What this browser keeps about a session (TICKETS.md ZEC-9, ZEC-13) ──
// `approved`: the sighash that a seat approved, and `tip`, the chain height at that moment, in
// the secrets of the seat next to the nonces, where the burn of a nonce does not reach.
// ponytail: one small entry per approval, never pruned (and one per session in `zf-signing`).
export function markOf(gid, sid) {
  const all = mySeatSecrets(gid).map(([, s]) => (s.marks || {})[sid]).filter(Boolean);
  const m = all.find((x) => isStr(x.approved));
  return { approved: m?.approved ?? null, tip: m?.tip ?? null };
}
const withMark = (marks, sid, patch) => ({ ...marks, [sid]: { ...(marks || {})[sid], ...patch } });

// What this browser saw of a session, in its own local key: that its signing started (a package,
// a signed or final part or a sent mark) under "<gid>:<sid>", and that it was sent under
// "<gid>:<sid>:sent". One seat or the server can drop those parts later. It is no secret.
// A check reads the stored text at most every SEEN_MS (an approval reads it at once), so a mark
// of another tab counts. Only `true` values are taken, and they are merged into the marks of this
// tab, so broken storage drops none. A tab that cannot read the key writes nothing, so it cannot
// drop the marks of another tab. A failed write, or a stored text without a mark of this tab
// (another tab wrote in the same moment), is written again at the next note.
const SEEN_KEY = "zf-signing", SEEN_MS = 250;
let seen = {}, seenText = null, seenAt = 0, seenRead = true, unsaved = false;
function seenNow(fresh = false) {
  if (!fresh && Date.now() - seenAt < SEEN_MS) return seen;
  seenAt = Date.now();
  let text = null;
  try { text = localStorage.getItem(SEEN_KEY); seenRead = true; }
  catch { seenRead = false; return seen; }
  if (text !== seenText) {
    seenText = text;
    const stored = trueOnly(text);
    // Another tab wrote without a mark of this tab: write the merged marks at the next note.
    if (Object.keys(seen).some((k) => !stored[k])) unsaved = true;
    seen = { ...seen, ...stored };
  }
  return seen;
}
function trueOnly(text) {
  try {
    const marks = Object.entries(JSON.parse(text || "{}"));
    return Object.fromEntries(marks.filter(([, v]) => v === true));
  } catch { return {}; }
}
export const sawSigning = (gid, sid, fresh) => seenNow(fresh)[gid + ":" + sid] === true;
const seenSigning = (sid, fresh) => sawSigning(state.gid, sid, fresh);
const sawSent = (sid) => seenNow()[state.gid + ":" + sid + ":sent"] === true;
export function noteSessions() {
  const keys = state.sessions.flatMap((ss) => seenKeys(ss)).filter((k) => seenNow()[k] !== true);
  if (!keys.length && !unsaved) return;
  seen = { ...seenNow(true) };
  for (const k of keys) seen[k] = true;
  unsaved = !seenRead || !saveSeen();   // saved again at the next call
}

function saveSeen() {
  try { localStorage.setItem(SEEN_KEY, S(seen)); } catch { return false; }
  seenText = S(seen);
  return true;
}
const seenKeys = (ss) => [
  ...(signingStarted(ss) ? [state.gid + ":" + ss.id] : []),
  ...(ss.broadcastTxid ? [state.gid + ":" + ss.id + ":sent"] : []),
];

// The PCZT that a seat of this browser approved, kept in its own sealed store. Null until it
// loads (the page draws again then) and when there is none.
const kept = new Map();
function keptPczt(gid, sid) {
  const k = gid + ":" + sid;
  if (!kept.has(k)) {
    kept.set(k, null);
    loadKept(gid, sid).then((p) => {
      if (isStr(p) && kept.get(k) == null) { kept.set(k, p); keptRev += 1; render(); }
    });
  }
  return kept.get(k);
}
async function keep(gid, sid, pczt) {
  kept.set(gid + ":" + sid, pczt);
  keptRev += 1;
  await saveKept(gid, sid, pczt);
}

// Signing started: the document says so, this browser saw it before, or a seat of it approved.
// Then only the engine says "done" and "expired" for a browser that approved.
export const signingSeen = (ss) => signingStarted(ss) || seenSigning(ss.id)
  || !!markOf(state.gid, ss.id).approved;
// The document lost the signing parts that this browser saw: one seat reset it.
export const signingLost = (ss) => seenSigning(ss.id) && !signingStarted(ss);
// A seat of this browser approved another transaction than the proposal shows now.
export const approvalChanged = (ss) => {
  const bound = markOf(state.gid, ss.id).approved, ins = inspectOf(ss);
  return !!bound && (!ins || ins.error || ins.sighash !== bound);
};
// No seat of this browser approves this session now: one seat reset or rewrote it. For another
// wallet than the open one, only the seen mark counts (its proposals are not decoded here).
export const noApproval = (ss, gid = state.gid) => sawSigning(gid, ss.id)
  || (gid === state.gid && approvalChanged(ss));

// ── The hold of an approval (TICKETS.md ZEC-13; the owner chose it on 18 October 2026) ──
// An approval of a seat of this browser holds Send until the approved transaction can no longer
// land. The hold comes from this browser's own records only (the approval marks and the kept
// PCZT): one seat writes or removes the session documents, also the sent mark, and can send the
// payment without one. It ends when a block holds the approved transaction, the engine says that
// it expired or that another transaction spent a note of it (a payment over the same notes, a
// move), it is 3 blocks past the expiry of the kept PCZT, or at the ceiling of the approval.
let holdCache = null, keptRev = 0, marksCache = null;
export function heldApprovals() {
  const c = curChain();
  if (!chainReady(c)) return [];
  const marks = approvedMarks(state.gid), hit = holdCache;
  const same = hit && hit.marks === marks && hit.rev === keptRev;
  if (same && hit.bal === c.bal && hit.sent === c.sent) return hit.list;
  const list = [...marks].filter(([sid, m]) => stillHolds(sid, m, c)).map(([sid]) => sid);
  holdCache = { marks, rev: keptRev, bal: c.bal, sent: c.sent, list };
  return list;
}

// The approvals of the seats of this browser in wallet `gid`: session id to {approved, tip}. A
// mark without a chain height has no ceiling, so it holds nothing (only `approveNow` writes
// marks, always with one). Each write of marks puts a new object (`withMark`, a read of
// storage), so the same objects hold the same marks.
function approvedMarks(gid) {
  const refs = mySeatSecrets(gid).map(([, s]) => s.marks), hit = marksCache;
  if (hit && hit.gid === gid && sameRefs(hit.refs, refs)) return hit.out;
  marksCache = { gid, refs, out: collectMarks(refs) };
  return marksCache.out;
}
const sameRefs = (a, b) => a.length === b.length && a.every((r, i) => r === b[i]);
const validMark = (m) => !!m && isStr(m.approved) && Number.isInteger(m.tip);
function collectMarks(refs) {
  const out = new Map();
  for (const marks of refs) {
    for (const [sid, m] of Object.entries(marks || {})) {
      if (!out.has(sid) && validMark(m)) out.set(sid, m);
    }
  }
  return out;
}

function stillHolds(sid, m, c) {
  if (releasedHold(sid) || c.bal.height >= m.tip + 1 + DAY2_BLOCKS + EXPIRY_MARGIN) return false;
  const own = keptPczt(state.gid, sid), v = holdState(own, m.approved, c);
  if (v.state === "done" || v.state === "expired" || v.spent === true) return false;
  return !keptExpired(own, m.approved, c.bal.height);
}

// The owner's decision D2 (S7). When t = n every seat must sign, so a seat here that burned its
// nonce without a share ends the hold. Otherwise only a person who checked releases it by hand.
function releasedHold(sid) {
  // t and n count only where the seats signed the wallet's shape (version 3, not moved).
  const g = state.g, all = !!g && signedMode(state.gid) && !g.shapeMoved && g.t === g.n;
  const marks = mySeatSecrets(state.gid).map(([, s]) => (s.marks || {})[sid]);
  return marks.some((m) => !!m && (m.released === true || (all && m.burned === true)));
}

/** The block at which the hold of the approval of session `sid` ends, or null. */
export function holdEnd(sid) {
  const m = approvedMarks(state.gid).get(sid);
  if (!m) return null;
  const ceiling = m.tip + 1 + DAY2_BLOCKS + EXPIRY_MARGIN, own = keptPczt(state.gid, sid);
  const ins = own ? inspectPczt(own) : null;
  const kept = ins && !ins.error && ins.sighash === m.approved;
  return kept ? Math.min(ceiling, ins.expiry_height + EXPIRY_MARGIN) : ceiling;
}

/**
 * Ends the hold of session `sid` by hand (S7). First every seat here that approved it burns its
 * nonce and its kept share, then the marks say `released`: a release never sits next to a live
 * nonce or share, also when a save fails halfway. So this browser never signs or sends a share of
 * that payment after Send opens again.
 */
export function releaseHold(sid) {
  const gid = state.gid;
  return withSecrets(async () => {
    const seats = mySeatSecrets(gid).filter(([, s]) => (s.marks || {})[sid]).map(([i]) => i);
    for (const i of seats) {
      const s = sec(gid, i);
      if (!approvalKept(s, sid)) continue;
      const nonces = { ...s.nonces }, unsent = { ...s.unsent };
      delete nonces[sid];
      delete unsent[sid];
      await saveOrUndo(gid, i, { nonces, unsent }, s);
    }
    for (const i of seats) {
      const s = sec(gid, i);
      await saveOrUndo(gid, i, { marks: withMark(s.marks, sid, { released: true }) }, s);
    }
  });
}

// What the engine says of the approved transaction alone, without any session document.
function holdState(own, bound, c) {
  try { return J(c.cw.sessionState(own || "", "", bound)); }
  catch { return { state: "unknown" }; }
}

function keptExpired(own, bound, height) {
  const ins = own ? inspectPczt(own) : null;
  if (!ins || ins.error || ins.sighash !== bound) return false;
  return height >= ins.expiry_height + EXPIRY_MARGIN;
}

// A payment that a seat of this browser approved and that it saw sent: its chip says
// "Confirming" while the approval holds, whatever the document says later.
export const approvedHold = (ss) => (sawSent(ss.id) || !!ss.broadcastTxid)
  && heldApprovals().includes(ss.id);
// Another transaction spent a note of the transaction that a seat of this browser approved, 3
// blocks deep, so it can no longer land.
export const approvedSpent = (ss) => !!markOf(state.gid, ss.id).approved
  && verdict(ss)?.spent === true;
/** The chain of the open wallet synced: before, no hold of an approval is known. */
export const chainReady = (c) => !!(c && c.cw && c.bal && c.sent);
const verdicts = new Map();

// The state of a payment from the engine once its signing started (TICKETS.md ZEC-13): "done",
// "expired" or "unknown", with `txid` and `why`. `bound`: a seat of this browser approved it.
// Without an approval the engine names only what t seats signed. Null before signing starts and
// before the first sync. A cancel or failure part does not count: one seat writes it.
export function verdict(ss) {
  const c = curChain();
  if (!chainReady(c) || !signingSeen(ss)) return null;
  const at = verdictInputs(ss), id = state.gid + ":" + ss.id, hit = verdicts.get(id);
  if (sameInputs(hit, at) && (sameSync(hit, c) || settled(hit.v, c))) return hit.v;
  let v;
  try { v = J(c.cw.sessionState(at.pczt, at.signed, at.bound)); }
  catch (e) { v = { state: "unknown", txid: null, why: said(e) }; }
  v = { ...v, bound: !!at.bound };
  verdicts.set(id, { ...at, bal: c.bal, sent: c.sent, v });
  return v;
}

// A sync gives the chain a new `bal` and a new `sent`, so they count by identity. A verdict whose
// transaction a block still holds needs no new call after a sync (most of the history).
const sameInputs = (hit, at) => !!hit && hit.bound === at.bound && hit.pczt === at.pczt
  && hit.signed === at.signed;
const sameSync = (hit, c) => hit.bal === c.bal && hit.sent === c.sent;
const settled = (v, c) => (v.state === "done" || !v.bound) && isStr(v.txid) && c.sent.has(v.txid);

// The inputs of `sessionState`: the approved sighash (empty when there is none), the kept PCZT
// (else the proposal) and the signed part.
function verdictInputs(ss) {
  const bound = markOf(state.gid, ss.id).approved || "";
  const own = bound ? keptPczt(state.gid, ss.id) : null;
  const signed = isStr(ss.signed) ? ss.signed : "";
  return { bound, pczt: own || (isStr(ss.pczt) ? ss.pczt : ""), signed };
}

// A block holds the payment: from the engine once signing started, else from the id of the
// proposal. A browser without an approval takes what t seats signed, and the id of the proposal
// as before (one seat can copy an older payment into its session: TICKETS.md ZEC-13).
export function landed(ss) {
  const v = verdict(ss);
  if (!v || !v.bound) return onChain(ss) || (!!v && isStr(v.txid) && curChain().sent.has(v.txid));
  return v.state === "done";
}

// A payment that "Propose again" may follow: by height before its signing starts. After, only
// when the engine says "expired" and this browser knows the notes that the new proposal spends.
export const ended = (ss) => signingSeen(ss)
  ? verdict(ss)?.state === "expired" && !!afterOf(ss) : expired(ss);

// The PCZT whose notes a payment proposed again must spend: of the kept PCZT, the proposal and the
// signed part, the one whose sighash is the approved one. Null when there is none.
function afterOf(ss) {
  const bound = markOf(state.gid, ss.id).approved;
  if (!bound || !state.wallet) return null;
  const list = [keptPczt(state.gid, ss.id), ss.pczt, ss.signed].filter(isStr);
  return list.find((p) => inspectPczt(p)?.sighash === bound) ?? null;
}

// The transactions of this wallet that went on chain from two days of blocks before the expiry
// of the approved transaction, from the engine (`snapshot().sent`, each with its height `h`): the
// signers check them before they propose an expired payment again. One seat writes the session
// documents, so none of them counts here. Null when this browser cannot tell.
let sinceCache = { sent: null, list: new Map() };
export function sinceOf(ss) {
  const c = curChain(), at = expiryAt(ss);
  if (!chainReady(c) || at === null) return null;
  const from = Math.max(0, at - DAY2_BLOCKS);
  if (sinceCache.sent !== c.sent) sinceCache = { sent: c.sent, list: new Map() };
  if (!sinceCache.list.has(from)) {
    let txids = null;
    try { txids = J(c.cw.snapshot()).sent.filter((x) => x.h >= from).map((x) => x.txid); }
    catch (e) { log("could not read the sent transactions: " + said(e)); }
    sinceCache.list.set(from, txids && { from, txids });
  }
  return sinceCache.list.get(from);
}

const boundExpired = (ss) => {
  const v = verdict(ss);
  return !!v && v.bound && v.state === "expired";
};

// A payment that has a signing package may have a signed transaction that a block holds. One seat
// can rewrite the proposal and drop the later parts, so the page cannot tell which transaction
// the signers signed (TICKETS.md, ZEC-9). It offers "Propose again" only before signing starts.
export const signingStarted = (ss) => !!(ss.package || ss.signed || ss.final || ss.broadcastTxid);

// An expired payment ends with a new proposal of the same recipients, amounts, memos, note and
// fee choice, which needs new approvals. A move proposes the move again.
export async function proposeAgain(ss) {
  const after = afterOf(ss);
  if (signingSeen(ss) && !after) {
    throw new Error("This browser cannot tell which notes the expired payment spent, so it does "
      + "not propose it again. Check the activity of the wallet.");
  }
  if (ss.move) { closeSession(); await proposeMove(after); return; }
  const payees = payeesOf(ss), ins = againFrom(ss, after);
  openSend({
    pay: payees.length ? payeeRows(payees, () => ++ui.payKey) : null, listError: "",
    note: typeof ss.note === "string" ? ss.note : "", priority: priorityTimes(ins) > 0,
    sendFor: null, after,
  });
  closeSession();
  render();
}

// After signing, the rows of the document (one seat writes it) must be what the approved
// transaction pays, and the fee is that of the approved transaction.
function againFrom(ss, after) {
  const ins = after ? inspectPczt(after) : inspectOf(ss);
  if (after && recipientCheck(ss, ins).match !== true) {
    throw new Error("The recipients of this payment changed after your approval, so this browser "
      + "does not propose it again. Check the activity of the wallet.");
  }
  return ins;
}

// A fee above the ZIP 317 fee is a priority fee: this many times the standard fee, or 0. The
// engine refuses more than 10 times.
export const priorityTimes = (ins) => ins && !ins.error && ins.fee > ins.standard_fee
  ? Math.round((ins.fee / ins.standard_fee) * 10) / 10 : 0;

// The proposer's list, without entries that have no address text.
export const payeesOf = (ss) => Array.isArray(ss.payees) ? ss.payees.filter((p) => p && typeof p.to === "string") : [];

export function recipientCheck(ss, ins) {
  if (!ins || ins.error) return { rows: [], extra: [], match: null };
  const paid = ins.lines.filter(isPayee);
  const { rows, extra } = pairPayees(payeesOf(ss), paid, normalized);
  const match = allPaid(rows, extra, ss.amount);
  const addr = ss.move ? moveAddress(ss.move) : null;
  const intoNew = addr ? paid.length === 1 && normalized(addr) === paid[0].who : null;
  return { rows, extra, match, intoNew };
}

// Only the copy that this browser's own seat in the new wallet checked counts. The store's copy
// is a claim anyone with the wallet key can write.
export function moveAddress(gid) {
  const mine = mySeatSecrets(gid).find(([, s]) => s.checkedWallet);
  return mine ? J(mine[1].checkedWallet).address : null;
}
