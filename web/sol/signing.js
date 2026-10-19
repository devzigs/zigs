// The signing steps after the approvals (ZOLANA.md 5, steps 5 and 6, and 7.2). The reactor runs
// them for the seats of this browser without a click:
//  - package: at `t` commitments with one digest, one device publishes the package;
//  - share: a signer checks the package against the commits that it can verify, makes its share
//    (the wasm checks the payment or the message again), deletes its nonces in one save and
//    publishes the share;
//  - aggregate: any device combines the shares (the wasm checks with verify_strict);
//  - execute (a payment, execute.js) or send (the move of the beta funds): one device lands the
//    transaction and writes the sent mark. The nonce rules are in nonces.js.
// The digest of a payment is the approval digest of its proposal account; of a message, the
// digest of its bytes.
import { agreement } from "./ceremony.js";
import { CLUSTER, base58 } from "./docs.js";
import { signingBlock, writerSeats } from "./gate.js";
import { bytesOf, chainHex, decodeIntent, wireBase64 } from "./intent.js";
import {
  approvedBodies,
  clearPending,
  dropNonces,
  pendingShare,
  savedNonces,
  shareOnce,
} from "./nonces.js";
import { BLOCKHASH_MS, REREAD_MS, deviceSeen, inputsOf, showable, stampSeen } from "./approve.js";
import { PAYMENT_EXPIRED, maybeExecute, pastExpiry } from "./execute.js";
import { solOf, stopOf } from "./secrets.js";
import { ensureWorker, stillOpen } from "./session.js";
import { BEFORE_FEE, SESSIONS, beforeFee, isPayment, writePart } from "./sessions.js";
import { deviceSpend } from "./spend.js";

const J = JSON.parse,
  S = JSON.stringify;
const HEXTEXT = /^([0-9a-f]{2})+$/;
const TERMINAL = new Set(["sent", "failed"]);
const EXPIRED = "This proposal expired before it was signed. Propose it again.";
// The pool refuses a proof once its roots left the history (error 7008): the payment must be
// proved and approved again (ZOLANA.md 5, stale roots).
const STALE_ROOT = /\b7008\b/;
const PROOF_EXPIRED = "The proof expired because the pool moved on. Propose the payment again.";
const SEND_TRIES = 3;
const RETRY_MS = 3000;
// Margin over the blockhash life: after this a recent-blockhash proposal that was never signed
// is over, and every seat writes the same failure.
const EXPIRE_MS = BLOCKHASH_MS + 60_000;

const launch = (c, key, run) => c.host.once("sol:" + key, run);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
// One holder for this tab: the server lets the same holder take its lease again. A lease that
// another tab holds makes a step wait a moment, so the reactor does not ask again at once.
const HOLDER = crypto.randomUUID();
const leased = async (ref, ttlMs) => (await ref.acquire({ holder: HOLDER, ttlMs })).acquired;
const sessionRef = (c, ss) => c.host.sdb.doc(c.base + "/" + SESSIONS + "/" + ss.id);
const errorText = (e) => String(e?.message ?? e).slice(0, 300);

// A failed wallet read waits 3 s, then twice as long each time up to 60 s, so a refused or rate
// limited RPC gets fewer calls. Its banner shows once for each text, not on every try.
const BACKOFF_FIRST_MS = 3_000;
const BACKOFF_MAX_MS = 60_000;

/** Records a failed read of step `key`, shows a new text once, and returns the wait in ms. */
export function backOff(c, key, e) {
  const last = c.readFails[key];
  const text = errorText(e);
  const n = (last?.n ?? 0) + 1;
  c.readFails[key] = { n, text };
  c.host.log("✗ " + key + ": " + text);
  if (last?.text !== text) c.host.showBanner("bad", text);
  return Math.min(BACKOFF_FIRST_MS * 2 ** (n - 1), BACKOFF_MAX_MS);
}

async function failSession(c, ss, text) {
  const seat = writerSeats(c)[0];
  if (seat === undefined) return;
  await writePart(c, ss.id, "failure", { error: text }, { seat });
}

const digestOf = (c, ss) =>
  isPayment(ss)
    ? c.W.sol_approval_digest(String(ss.account), String(ss.body))
    : c.W.sol_digest(CLUSTER, bytesOf(ss.message));

// Package

/** The seats whose published commit has this digest and a well formed commitment, lowest first. */
function committed(c, ss, digest) {
  const commits = c.commits[ss.id] ?? {};
  return Object.entries(commits)
    .filter(([, d]) => d.digest === digest && HEXTEXT.test(String(d.commitments)))
    .map(([seat]) => Number(seat))
    .sort((a, b) => a - b);
}

function maybePackage(c, ss) {
  const digest = digestOf(c, ss),
    ids = committed(c, ss, digest).slice(0, c.host.state.g.t);
  const seat = writerSeats(c)[0];
  if (ids.length < c.host.state.g.t || seat === undefined) return;
  launch(c, "pkg:" + ss.id, () => publishPackage(c, ss, { seat, ids, digest }));
}

// A package that is stored but not valid (an unsigned one) must not block the real one.
async function packageStands(c, ss, doc) {
  if (doc.package === undefined || doc.packageSig === undefined) return false;
  const fields = { package: doc.package, signers: doc.signers, digest: doc.digest };
  const rel = SESSIONS + "/" + ss.id;
  return c.host.checkIn(c.gid)(rel, doc.packageBy, doc.packageSig, fields, null) !== "no";
}

async function publishPackage(c, ss, { seat, ids, digest }) {
  const ref = sessionRef(c, ss);
  if (!(await leased(ref, 10000))) return sleep(1000);
  const cur = await ref.get();
  if (cur.exists && (await packageStands(c, ss, cur.data()))) return sleep(500);
  const commits = c.commits[ss.id];
  const map = Object.fromEntries(ids.map((i) => [i, commits[i].commitments]));
  const fields = { package: S(map), signers: ids, digest };
  await writePart(c, ss.id, "package", fields, { seat });
  c.host.log("Solana signing package sent to devices " + ids.join(", "));
}

// Share

const signersOf = (ss) => (Array.isArray(ss.signers) ? ss.signers : []);

/**
 * The commitments of the signers as this device can verify them, or null while a commit of a
 * signer is not here yet (it comes with the next snapshot). A commit for another digest is an
 * error: the package does not match the approvals.
 */
function verifiedCommits(c, ss, digest) {
  const verified = {};
  for (const j of signersOf(ss)) {
    const commit = c.commits[ss.id]?.[j];
    if (!commit) return null;
    if (commit.digest !== digest) throw new Error("Device " + j + " approved other bytes.");
    verified[j] = commit.commitments;
  }
  return verified;
}

// The signers are `t` distinct seats and include this one; the digest is the one of the message.
function checkSigners(c, ss, i, entry, digest) {
  const t = c.host.state.g.t,
    signers = signersOf(ss);
  if (new Set(signers).size !== t || signers.length !== t || !signers.includes(i)) {
    throw new Error("The devices of the package are wrong.");
  }
  if (ss.digest !== digest || entry.digest !== digest) throw new Error("The digest differs.");
}

/**
 * The round of seat `i`: the package as this device can verify it, or null while it cannot yet.
 * The signers are `t` distinct seats, each with a verified commit for this digest, and the
 * commitment of this seat is the one that it saved. A package that differs gets no share.
 */
function roundOf(c, ss, i, entry) {
  const digest = digestOf(c, ss);
  checkSigners(c, ss, i, entry, digest);
  const verified = verifiedCommits(c, ss, digest);
  if (verified === null) return null;
  if (S(J(ss.package)) !== S(verified)) throw new Error("The package differs from the commits.");
  if (verified[i] !== entry.commitments) throw new Error("The package has another commitment.");
  const keyPackage = solOf(c.host, c.gid, i).keyPackage;
  return {
    now: Math.floor(Date.now() / 1000),
    cluster: CLUSTER,
    keyPackage,
    commitments: verified,
  };
}

async function publishShare(c, ss, i, made) {
  const rel = SESSIONS + "/" + ss.id + "/shares/" + i;
  const doc = await c.host.signedDoc(c.gid, rel, i, { ...made, at: Date.now() });
  await c.host.sdb.doc(c.base + "/" + rel).set(doc);
  await clearPending(c, i, ss.id);
  c.host.log("device " + i + ": Solana signature share sent");
}

/**
 * The share of seat `i`: over the approval digest of a payment, after the wasm checked the payment
 * with the proposal account that this device read again (`seen`), or over the message bytes.
 */
function shareAnswer(c, ss, i, { entry, round, seen }) {
  const wasm = inputsOf(c, ss, i, entry.spend);
  const text = S({ ...round, nonces: entry.nonces });
  if (!isPayment(ss)) {
    return c.W.sol_sign_share(wasm.message, wasm.intent, wasm.pins, wasm.snapshot, text);
  }
  const chain = bytesOf(chainHex(seen, seen.recipient));
  return c.W.sol_approval_share(wasm.intent, wasm.pins, wasm.snapshot, chain, text);
}

// The read of the chain comes before the lock of shareOnce, and the network writes after it, so a
// slow server holds no other step of the secrets.
async function makeShare(c, ss, i) {
  // A read that fails is tried again by the reactor; only a refusal ends the session.
  const seen = isPayment(ss) ? await deviceSeen(c, ss) : null;
  const made = await shareOnce(c, i, ss.id, (entry) => {
    const round = roundOf(c, ss, i, entry);
    // The approved bodies come from what storage holds now, inside the lock.
    const now = seen && { ...seen, approved: approvedBodies(c) };
    return round === null ? null : J(shareAnswer(c, ss, i, { entry, round, seen: now }));
  });
  if (made && "refused" in made) {
    await failSession(c, ss, "A device did not sign: " + errorText(made.refused));
    throw made.refused;
  }
  if (made) await publishShare(c, ss, i, { share: made.share, digest: made.digest });
}

async function shareOf(c, ss, i) {
  const pending = pendingShare(c, i, ss.id);
  if (pending) return publishShare(c, ss, i, pending);
  return makeShare(c, ss, i);
}

// A signer waits until the commits of the package are here. An inconsistent package is not waited
// for: the share step refuses it and ends the session.
function commitsHere(c, ss) {
  try {
    return verifiedCommits(c, ss, digestOf(c, ss)) !== null;
  } catch {
    return true;
  }
}

// What seat `i` does next for this session: forget a share that is published, publish a made share,
// or make its share. null: nothing to do now.
function shareStep(c, ss, i) {
  const published = !!c.shares[ss.id]?.[i],
    pending = pendingShare(c, i, ss.id);
  if (published) return pending ? ["clear", () => clearPending(c, i, ss.id)] : null;
  const ready = pending || (savedNonces(c, i, ss.id) && commitsHere(c, ss));
  return ready ? ["share", () => shareOf(c, ss, i)] : null;
}

function signMine(c, ss) {
  for (const i of c.host.localSeats()) {
    if (!signersOf(ss).includes(i) || !c.host.canWriteAs(i)) continue;
    const step = shareStep(c, ss, i);
    if (step) launch(c, `${step[0]}:${ss.id}:${i}`, step[1]);
  }
}

// Aggregate and send

function maybeAggregate(c, ss) {
  const shares = c.shares[ss.id] ?? {};
  const whole = signersOf(ss).every(
    (i) => shares[i]?.digest === ss.digest && HEXTEXT.test(String(shares[i].share)),
  );
  const seat = writerSeats(c)[0];
  if (!whole || seat === undefined) return;
  launch(c, "agg:" + ss.id, () => aggregate(c, ss, seat));
}

async function aggregate(c, ss, seat) {
  const shares = Object.fromEntries(signersOf(ss).map((i) => [i, c.shares[ss.id][i].share]));
  let signature;
  try {
    const key = agreement(c).done.publicKeyPackage;
    const signed = isPayment(ss) ? bytesOf(digestOf(c, ss)) : bytesOf(ss.message);
    signature = c.W.sol_aggregate(signed, key, ss.package, S(shares));
  } catch (e) {
    await failSession(c, ss, "The signature shares did not combine: " + errorText(e));
    throw e;
  }
  await writePart(c, ss.id, "signed", { signature }, { seat });
  c.host.log("Solana signature combined and checked with verify_strict");
}

function maybeSend(c, ss) {
  const seat = writerSeats(c)[0];
  if (!c.rpcUrl || seat === undefined) return;
  launch(c, "send:" + ss.id, () => sendSigned(c, ss, seat));
}

const STILL_THERE = /already.*processed|has already been/i;

/** Checks the status first, so a seat that is late does not call a landed transaction failed. */
async function sendSigned(c, ss, seat) {
  try {
    await attemptSend(c, ss, seat);
  } catch (e) {
    c.tries[ss.id] = (c.tries[ss.id] ?? 0) + 1;
    if (c.tries[ss.id] >= SEND_TRIES) await failSession(c, ss, "Not sent: " + errorText(e));
    throw e;
  }
}

// A proposal from before the fee keys has the group signature only, and that is its id. It may
// have landed with no sent mark: the status is read first, and the mark is written. A proposal
// that did not land is never sent (its payer is the group key): `land` ends it.
async function attemptSend(c, ss, seat) {
  const worker = await ensureWorker(c),
    txId = base58(ss.feeSig ?? ss.signature);
  const ref = sessionRef(c, ss);
  if (!(await leased(ref, 60000))) return sleep(RETRY_MS);
  let result = await worker.call("status", { signature: txId });
  if (result.status === "pending") result = await waitFor(worker, txId);
  if (result.status === "none") result = await land(c, ss, worker, txId);
  if (!result) return;
  await writePart(c, ss.id, "sent", { txId, slot: result.slot, outcome: result.status }, { seat });
}

/** Simulates the signed transaction, sends it and waits for it. null when it did not go. */
async function land(c, ss, worker, txId) {
  if (beforeFee(ss)) {
    await failSession(c, ss, BEFORE_FEE);
    return null;
  }
  const tx = wireBase64(bytesOf(ss.message), bytesOf(ss.feeSig + ss.signature));
  const sim = await worker.call("simulate", { tx });
  if (sim.err !== null) {
    const refused = "The network refused the signed transaction: " + sim.err;
    await failSession(c, ss, STALE_ROOT.test(sim.err) ? PROOF_EXPIRED : refused);
    return null;
  }
  try {
    await worker.call("send", { tx });
  } catch (e) {
    // The simulation passed, so this is Helius or the network (a 429, a 5xx): a counted try. The
    // next try reads the status first, and SEND_TRIES ends the session.
    if (!STILL_THERE.test(String(e.message))) throw e;
  }
  return waitFor(worker, txId);
}

async function waitFor(worker, txId) {
  const seen = await worker.call("confirm", { signature: txId });
  if (seen.status === "unknown") throw new Error("The transaction is not confirmed yet.");
  return seen;
}

// The reactor

const expired = (ss) =>
  decodeIntent(ss.intent)?.kind === "createNonce" &&
  !ss.package &&
  !(Date.now() - Number(ss.createdAt) <= EXPIRE_MS);
// A payment with no approval ends at the expiry of its body: nobody can execute it. A signed one
// may have landed, so its execute step reads the chain first (execute.js).
const paymentExpired = (ss) => isPayment(ss) && !ss.signature && pastExpiry(ss);

// A node may show a new proposal account a moment after the create: a device that read none
// reads it again after REREAD_MS (approve.js), so its screen does not keep a refusal.
const accountMissing = (c, ss) =>
  isPayment(ss) && c.seen[ss.id]?.account === null && Date.now() - c.seen[ss.id].at > REREAD_MS;

// A private spend needs the snapshot of this device, and a payment its proposal account, before
// its approval screen can show.
function maybeReadWallet(c, ss) {
  const unread = c.snaps[ss.id] === undefined || accountMissing(c, ss);
  const waiting = ss.status === "collecting" && unread;
  const kind = decodeIntent(ss.intent)?.kind;
  if (!waiting || !["transfer", "approve", "withdraw"].includes(kind)) return;
  if (!c.rpcUrl || writerSeats(c)[0] === undefined) return;
  const key = "snap:" + ss.id;
  const { opened } = c;
  launch(c, key, async () => {
    try {
      await readWallet(c, ss);
      delete c.readFails[key];
    } catch (e) {
      if (stillOpen(c, opened)) await sleep(backOff(c, key, e)); // else: no text on the next wallet
    }
  });
}

async function readWallet(c, ss) {
  if (isPayment(ss)) c.seen[ss.id] = stampSeen(c.seen[ss.id], await deviceSeen(c, ss));
  try {
    c.snaps[ss.id] = await deviceSpend(c, ss);
  } finally {
    // The pass of the reactor after this step reads a missing account again, also after a
    // failed wallet read: a shorter wait would end before the re-read is due.
    if (isPayment(ss) && c.seen[ss.id].account === null) await sleep(REREAD_MS + 100);
  }
}

/** Why a session ends before it is sent, or null. */
function endOf(ss) {
  if (beforeFee(ss) && !ss.signature) return BEFORE_FEE;
  if (expired(ss)) return EXPIRED;
  return paymentExpired(ss) ? PAYMENT_EXPIRED : null;
}

function stepSession(c, ss) {
  if (!showable(ss)) return null;
  const end = endOf(ss);
  if (end) return launch(c, "end:" + ss.id, () => failSession(c, ss, end));
  maybeReadWallet(c, ss);
  if (!ss.package) return maybePackage(c, ss);
  signMine(c, ss);
  if (!ss.signature) return maybeAggregate(c, ss);
  return isPayment(ss) ? maybeExecute(c, ss, { launch, failSession }) : maybeSend(c, ss);
}

/** Nonces that no signature can use any more: the session ended, or the wallet stopped. */
function dropDead(c, ended) {
  for (const i of c.host.localSeats()) {
    const saved = solOf(c.host, c.gid, i).nonces ?? {};
    for (const sid of Object.keys(saved)) {
      if (ended(sid)) launch(c, "drop:" + sid + ":" + i, () => dropNonces(c, i, sid));
    }
  }
}

/** Advances every Solana session for the seats of this browser. */
export function reactSessions(c) {
  if (stopOf(c)) return dropDead(c, () => true);
  const over = new Set(c.sessions.filter((ss) => TERMINAL.has(ss.status)).map((ss) => ss.id));
  dropDead(c, (sid) => over.has(sid));
  if (signingBlock(c)) return;
  for (const ss of c.sessions) if (!TERMINAL.has(ss.status)) stepSession(c, ss);
}
