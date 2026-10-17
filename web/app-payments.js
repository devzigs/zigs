// Propose, approve, sign, cancel and broadcast; the payment check and expiry.
import { allPaid, pairPayees } from "./payees.js";
import { partFields, proposalFields } from "./signed.js";
import { EXPIRY_MARGIN } from "./personal.js";
import { payeeRows } from "./requests.js";
import { busy, log, ready, showBanner, state, ui } from "./app-state.js";
import { fmtZec, isStr, J, S, said, withTimeout } from "./app-kit.js";
import { engineOffThread, Z } from "./app-engine.js";
import { mySeatSecrets, putSec, sec } from "./app-keystore.js";
import { isMe, keysDiffer, localSeats, myUid, signersOf } from "./app-seats.js";
import {
  balanceNow, chain, curChain, curNet, inFlight, netName, runSync, SERVER_TIMEOUT_MS,
} from "./app-chain.js";
import {
  canWriteAs, mayAct, NO_SEAT_KEY, partNow, signedDoc, signedMode, sigPart, writer,
} from "./app-filter.js";
import { closeSession, openSession, sdb } from "./app-groups.js";
import { groupName, isPayee, normalized } from "./app-dom.js";
import { myVerified, seatCheck } from "./app-dkg.js";
import { once, render } from "./app-loop.js";

const inspectCache = new Map();

export function reactSession(ss) {
  const fvk = state.wallet.orchard_fvk;
  // The engine takes only strings. A document with another type would crash it.
  if (!isStr(ss.pczt) || !isStr(fvk) || (ss.package != null && !isStr(ss.package))) return;
  if (ss.error || expired(ss)) return;
  if (!ss.package && isProposer(ss)) buildPackage(ss, fvk);
  if (ss.package) signMyShares(ss, fvk);
  if (ss.package && !ss.signed) aggregateShares(ss);
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

// Coordinator: once t approvals are in, build the signing package.
function buildPackage(ss, fvk) {
  const gid = state.gid, t = state.g.t;
  const ids = Object.keys(state.commits).map(Number).sort((a, b) => a - b).slice(0, t);
  if (ids.length < t) return;
  once("pkg:" + ss.id, async () => {
    const c = {}; for (const i of ids) c[i] = state.commits[i].commitments;
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

// Signer: once the package names a seat of this browser, re-verify everything and sign.
function signMyShares(ss, fvk) {
  for (const i of localSeats()) {
    const n = (sec(state.gid, i).nonces || {})[ss.id];
    if (canWriteAs(i) && signersOf(ss).includes(i) && n && !state.shares[i]) {
      once("share:" + ss.id + ":" + i, () => signShare(ss, fvk, i, n));
    }
  }
}

async function signShare(ss, fvk, i, n) {
  const gid = state.gid, s = sec(gid, i);
  const nonces = { ...(s.nonces || {}) }; delete nonces[ss.id];
  const ins = inspectOf(ss);
  if (!n.sighash || !ins || ins.error || ins.sighash !== n.sighash) {
    await putSec(gid, i, { nonces });
    await failSession(gid, ss, "The payment changed after a signer approved it.");
    throw new Error("This payment changed after you approved it, so this browser did not sign it.");
  }
  // The engine checks the approved sighash again before it signs.
  const shares = Z.signShare(ss.pczt, fvk, ss.package, S(n), S(s.keyPackage), i);
  const rel = "sessions/" + ss.id + "/shares/" + i;
  const doc = await signedDoc(gid, rel, i, { shares, at: Date.now() });
  // Save the burn before the share goes out: a nonce that comes back could sign twice.
  if (!(await putSec(gid, i, { nonces }))) {
    throw new Error("Could not save the used nonce, so the signature share was not sent.");
  }
  await sdb.doc("groups/" + gid + "/" + rel).set(doc);
  log("seat " + i + ": signature share sent");
}

// Any participant: aggregate. The result is deterministic, so a race is harmless.
function aggregateShares(ss) {
  const gid = state.gid;
  if (!localSeats().length || !mayAct() || !signersOf(ss).every((i) => state.shares[i])) return;
  once("agg:" + ss.id, async () => {
    const sh = {}; for (const i of signersOf(ss)) sh[i] = J(state.shares[i].shares);
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
export async function newSpend(payees, note, move = null, priority = false) {
  const gid = state.gid, approvals = state.g.t;
  if (!chain || chain.gid !== gid || !chain.bal) {
    throw new Error("The wallet has not finished its first sync.");
  }
  if (!mayAct()) throw new Error(NO_SEAT_KEY);
  // A payee has a memo only when it has text. A proposal without memos stays {to, amount}.
  payees = payees.map(({ to, amount, memo }) => memo ? { to, amount, memo } : { to, amount });
  const t = J(await chain.cw.createSpend(S(payees), priority));
  const ref = sdb.collection("groups/" + gid + "/sessions").doc();
  const fields = proposalFields(payees, note, t, move, Date.now());
  const sig = await sigPart(gid, ref.id, "proposal", fields);
  await ref.set({ createdBy: myUid(), status: "collecting", ...fields, ...sig });
  log("new spend: " + fmtZec(t.amount));
  showBanner("ok", "Payment proposed. It needs " + approvals + " approvals.");
  if (state.gid === gid) openSession(ref.id);
}

// Sends every confirmed note to the wallet that replaces this one.
export async function proposeMove() {
  const to = state.g.movedTo, tw = ready[to], c = curChain();
  if (!tw) throw new Error("The new wallet has no address yet.");
  const amount = c && c.bal ? c.bal.max_send : 0;
  if (!(amount > 0)) throw new Error("No confirmed funds to move yet.");
  await newSpend([{ to: tw.address, amount }], "Move to " + groupName(to), to);
}

export async function cancelMove() {
  await sdb.doc("groups/" + state.gid).update({ movedTo: null, movedAt: null });
  showBanner("ok", "Move cancelled. This wallet stays as it is.");
}

export async function broadcastTx(ss) {
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
    runSync(chain);
  } catch (e) {
    await ref.update({ broadcastError: e.message || String(e) });
  }
}

// Tries each server in turn; a temporary wallet is enough because broadcasting needs no sync.
// `where` names the network, viewing key and birthday of the sender: the open wallet or account.
// The error has `refused` when every server answered with a refusal. Any other failure (a timeout,
// a lost connection) leaves open whether a server took the transaction.
export async function broadcastAnywhere(txHex, where = {
  net: curNet(), ufvk: state.wallet.ufvk, birthday: state.wallet.birthday,
}) {
  const errors = [];
  let refused = true;
  for (const url of where.net.servers) {
    const cw = new Z.ChainWallet(where.ufvk, where.birthday, url);
    try { return J(await withTimeout(cw.broadcast(txHex), SERVER_TIMEOUT_MS * 2, new URL(url).host)); }
    catch (e) {
      refused = refused && Z.isNodeRefusal(said(e));
      errors.push(new URL(url).host + ": " + said(e));
    }
    finally { cw.free(); }
  }
  throw Object.assign(new Error(errors.join("; ")), { refused });
}

// Why seat i cannot approve the payment now, or null.
function approveRefusal(ss, i, ins) {
  if (ss.error) return "This payment was cancelled or failed, so it was not approved.";
  if (expired(ss)) return "This payment expired, so it was not approved. Propose it again.";
  if (state.pending) return "Zigs is still checking this wallet's data. Try again in a moment.";
  if (!ins || ins.error) return "This browser could not check the payment, so it did not approve.";
  if (seatCheck(i) === true) return null;
  return "Seat " + i + " has not checked this wallet against its key share, so it did not approve.";
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
  // Another tab can save the secrets of this seat during the waits. Read them after each wait, so
  // that a write here neither brings back a burned nonce nor drops a new one.
  if ((sec(gid, i).nonces || {})[ss.id]) throw new Error("This seat already approved this payment.");
  const r = J(Z.signCommit(ss.pczt, state.wallet.orchard_fvk, S(sec(gid, i).keyPackage), tip));
  // The approval covers this exact transaction: a share is signed later only for the same sighash.
  const mine = { nonces: r.nonces, commitments: r.commitments, sighash: ins.sighash };
  const rel = "sessions/" + ss.id + "/commits/" + i;
  // A seat that cannot sign fails here, before the approval is saved.
  const doc = await signedDoc(gid, rel, i, { commitments: r.commitments, at: Date.now() });
  const nonces = { ...(sec(gid, i).nonces || {}), [ss.id]: mine };
  if (!(await putSec(gid, i, { nonces }))) {
    throw new Error("Could not save the approval in this browser, so it was not sent.");
  }
  await sdb.doc("groups/" + gid + "/" + rel).set(doc);
  log("seat " + i + ": approved the spend, nonce commitment published");
  showBanner("ok", "Approved" + (localSeats().length > 1 ? " as seat " + i : "") + ".");
}

// The chain height now, from the open wallet's light-wallet server, else from the other servers
// of its network.
async function freshTip() {
  const c = curChain();
  if (!c || !c.url) throw new Error("Wait for the first sync to finish, then approve.");
  const errors = [];
  for (const url of [c.url, ...curNet().servers.filter((u) => u !== c.url)]) {
    const host = new URL(url).host;
    try { return await withTimeout(Z.latestHeight(url), SERVER_TIMEOUT_MS, host); }
    catch (e) { errors.push(host + ": " + said(e)); }
  }
  throw new Error("No light-wallet server gave the chain height, so this browser did not "
    + "approve. " + errors.join("; "));
}

// A sent payment that no block holds yet keeps the wallet's notes until it expires. A node can
// drop it, so any signer can send the same transaction again. The sent mark stays as it is.
export async function resendTx(ss) {
  await broadcastAnywhere(ss.final.tx_hex);
  showBanner("ok", "Sent again. It confirms with the next block.");
}

export async function cancelPayment(ss) {
  if (ss.signed || ss.error) throw new Error("This payment is already signed or closed, so it cannot be cancelled.");
  const gid = state.gid, seat = writer(undefined, gid) ?? localSeats()[0];
  const who = ((state.seats[seat] || {}).name || "a signer") + " (seat " + seat + ")";
  const fields = { error: "Cancelled by " + who + "." };
  const sig = await sigPart(gid, ss.id, "cancel", fields);
  await sdb.doc(sessionPath(ss, gid)).update({
    ...fields, status: "cancelled", cancelledAt: Date.now(), ...sig,
  });
  for (const [i, s] of mySeatSecrets(gid)) {
    const nonces = { ...(s.nonces || {}) };
    if (!nonces[ss.id]) continue;
    delete nonces[ss.id];
    await putSec(gid, i, { nonces });
  }
  showBanner("ok", "Payment cancelled.");
}

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

export function sendBlocker() {
  const c = curChain();
  if (keysDiffer()) return "The signers hold different wallet keys. Do not use this wallet.";
  if (!localSeats().length) return "You hold no seat in this wallet.";
  if (!myVerified()) return "Your seat is still checking the wallet address.";
  if (!c || !c.bal) return "Wait for the first sync to finish.";
  // ponytail: the engine does not know about unmined spends and would pick the same notes again.
  if (inFlight().length) return "A payment is waiting for its block. Send again in a minute.";
  const b = balanceNow(c.bal);
  if (b.spendable > feeEstimate(1)) return null;
  if (b.pending) return "Incoming funds need 3 confirmations first.";
  return b.spendable ? "The balance does not cover the network fee." : "This wallet has no funds yet.";
}
// A prover that closed its tab leaves status "proving"; let someone else take over.
export const proofStalled = (ss) => Date.now() - (ss.provingAt || 0) > 180000;

// Keyed by the transaction itself: a session whose transaction is replaced is decoded again.
export function inspectOf(ss) {
  const key = ss.pczt, fvk = state.wallet.orchard_fvk;
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
  const c = curChain(), ins = state.wallet && ss.pczt ? inspectOf(ss) : null;
  if (!c || !c.bal || !ins || ins.error || !Number.isInteger(ins.expiry_height)) return null;
  try { return J(Z.expiryState(netName(state.g), ins.expiry_height, c.bal.height)); }
  catch { return null; }
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
  const e = !ss.error && expiryOf(ss), c = curChain();
  if (!e || onChain(ss)) return false;
  if (!ss.final) return e.expired;
  return c.bal.height >= inspectOf(ss).expiry_height + EXPIRY_MARGIN;
}

// A payment that has a signing package may have a signed transaction that a block holds. One seat
// can rewrite the proposal and drop the later parts, so the page cannot tell which transaction
// the signers signed (TICKETS.md, ZEC-9). It offers "Propose again" only before signing starts.
export const signingStarted = (ss) => !!(ss.package || ss.signed || ss.final || ss.broadcastTxid);

// An expired payment ends with a new proposal of the same recipients, amounts, memos, note and
// fee choice, which needs new approvals. A move proposes the move again.
export async function proposeAgain(ss) {
  if (ss.move) { closeSession(); await proposeMove(); return; }
  const payees = payeesOf(ss);
  Object.assign(ui, {
    pay: payees.length ? payeeRows(payees, () => ++ui.payKey) : null, listError: "",
    note: typeof ss.note === "string" ? ss.note : "", priority: priorityTimes(inspectOf(ss)) > 0,
    send: true, sendFor: null,
  });
  closeSession();
  render();
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
