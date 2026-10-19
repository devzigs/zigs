// The second DKG of a wallet (ZOLANA.md 4.1): FROST(Ed25519) on the same seats, after the wallet
// exists. Each step writes a signed document (docs.js). The reactor runs the steps of the seats
// that this browser holds. It never touches the Zcash key: the secret parts (`rSol`) are fresh,
// and the boxes carry a curve label, so a Zcash box cannot open here.
import { fitsPublished, samePackages } from "../util.js";
import { CLUSTER } from "./docs.js";
import { feeUnpublished, publishFee } from "./fee.js";
import { holdsShare, putSol, refuseStopped, solOf, stopOf } from "./secrets.js";

const J = JSON.parse,
  S = JSON.stringify;
const SAVE_FAILED = "This browser could not save your Solana setup secret, so setup did not start.";
const HEX = (bytes) => (v) =>
  typeof v === "string" && new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(v);

const randomHex32 = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
const boxContext = (gid, from, to) => gid + ":sol:" + from + "->" + to;
// The longest lease of the group server. The server keeps leases in memory and forgets them when
// it sleeps, so the lease and a second look at the documents narrow the race of two copies of a
// seat; they do not close it.
const LEASE_MS = 60000;
// One lease holder per page, so a retry is not blocked by itself. A copy that cannot save its
// secret takes a new one, so it cannot renew the lease for ever.
let holder = randomHex32();
const pause = () => new Promise((ok) => setTimeout(ok, 3000));
const stopText = (e) =>
  "Solana setup stopped: " +
  String(e?.message ?? e).replace(/\.+$/, "") +
  ". Do not use the Solana part of this wallet.";

/** Why this wallet cannot get a Solana part, or null. Version 3 and testnet only. */
export function startBlock(host) {
  if (host.groupVersion() !== 3) return "Solana needs a version 3 wallet.";
  if (host.network() !== "testnet")
    return "Solana runs on Devnet only. A mainnet wallet gets none.";
  return null;
}

/** The start document of seat 1 names the cluster of this build. */
export const started = (docs) => docs.solstart[1]?.cluster === CLUSTER;

const numberMoved = (host, i) => {
  const kept = host.confirmedNo(i),
    no = host.safetyNo();
  return kept !== undefined && kept !== null && !!no && kept !== no;
};
// Why seat i of this browser cannot start yet, or null: its Zcash part is settled and its person
// confirmed the safety number it has now (also a restored seat, by its own confirm document).
const WAITS = [
  [(i) => "Device " + i + " waits: open its wallet.", (h, g) => g !== h.state.gid],
  [
    (i) => "Device " + i + " has no Zcash key share in this browser.",
    (h, g, i) => !h.sec(g, i).keyPackage,
  ],
  [(i) => "Device " + i + " waits for Address checked.", (h, g, i) => h.seatCheck(i) !== true],
  [
    (i) => "Device " + i + " waits: the safety number changed after this browser confirmed it.",
    (h, g, i) => numberMoved(h, i),
  ],
  [
    (i) => "Device " + i + " waits: this browser has not confirmed the safety number.",
    (h, g, i) => !h.safetyNo() || h.confirmedNo(i) !== h.safetyNo(),
  ],
];
const waitOf = (host, gid, i) => {
  const wait = WAITS.find(([, waits]) => waits(host, gid, i));
  return wait ? wait[0](i) : null;
};
const seatReady = (host, gid, i) => waitOf(host, gid, i) === null;

const allR1 = (c) =>
  c.host.seatIds().every((i) => {
    const d = c.docs.soldkg1[i];
    return !!d && !!d.package && typeof d.package === "object" && HEX(32)(d.commit);
  });
const r2For = (c, to) =>
  c.host
    .seatIds()
    .filter((i) => i !== to)
    .every((i) => !!c.docs.soldkg2[i + "-" + to]);

const needR1 = (c, i, s) => !c.docs.soldkg1[i] && !s.keyPackage;
// The verified round 1 of seat i holds the package of this secret. Another copy of the seat can
// publish its own: then this secret is stale, takes no part and goes (staleR1).
const ownR1 = (c, i, s) => samePackages([c.docs.soldkg1[i]?.package, s.r1package]);
const staleR1 = (c, i, s) =>
  !!s.r1secret && !s.keyPackage && !!c.docs.soldkg1[i] && !ownR1(c, i, s);
const needR2 = (c, i, s) =>
  !!s.r1secret && !s.r2secret && !s.keyPackage && allR1(c) && ownR1(c, i, s);
const needR3 = (c, i, s) => !!s.r2secret && !s.keyPackage && allR1(c) && r2For(c, i);
const needDone = (c, i, s) => !!s.keyPackage && !s.doneSent && !c.docs.soldone[i];
// A seat that published its soldone before the program design publishes it again with the PDA
// identity, once the seats agree on the rest.
const needPdaDoc = (c, i, s) => {
  const doc = c.docs.soldone[i];
  return holdsShare(s) && !!doc && !hasPda(doc) && agreement(c).state === "agree";
};

/** Seals the failure into the seat: the reactor does not retry a seat that stopped. */
async function abortSeat(c, i, e) {
  const text = stopText(e);
  await putSol(c.host, c.gid, i, { aborted: text });
  throw new Error(text);
}
async function guarded(c, i, compute) {
  try {
    return compute();
  } catch (e) {
    return abortSeat(c, i, e);
  }
}

/** The round-1 documents of every seat, as the wasm reads them for the echo and for round 3. */
function round1Docs(c) {
  const r1 = {};
  for (const j of c.host.seatIds()) {
    const d = c.docs.soldkg1[j];
    r1[j] = { package: d.package, commit: d.commit };
  }
  return r1;
}

/** The echo: one digest of every round-1 document, so a seat that saw other data is found. */
const echoNow = (c) => c.W.sol_echo(c.gid, c.host.safetyNo(), CLUSTER, S(round1Docs(c)));

async function round1(c, i) {
  const { host, W, gid, base } = c,
    g = host.state.g,
    boxPk = host.state.seats[i].boxPk; // read before the first await: another wallet may open
  // Two copies of one seat (a device and a restored copy) must not both publish round 1. A document
  // that fails its signature check does not count, so a seat still publishes one again.
  const ref = host.sdb.doc(base + "/soldkg1/" + i);
  if (!(await ref.acquire({ holder, ttlMs: LEASE_MS })).acquired) return pause();
  if (c.docs.soldkg1[i]) return pause();
  let s = solOf(host, gid, i);
  if (!s.r1secret) {
    const r = J(W.sol_dkg1(i, g.n, g.t));
    const made = {
      r1secret: r.secret,
      r1package: r.package,
      rSol: randomHex32(),
      cluster: CLUSTER,
    };
    if (!(await putSol(host, gid, i, made))) {
      await putSol(host, gid, i, { r1secret: null, r1package: null, rSol: null, cluster: null });
      holder = randomHex32();
      throw new Error(SAVE_FAILED);
    }
    s = solOf(host, gid, i);
  }
  const commit = W.sol_commit(gid, i, boxPk, CLUSTER, s.rSol);
  const fields = { package: s.r1package, commit, at: Date.now() };
  const doc = await host.signedDoc(gid, "soldkg1/" + i, i, fields);
  if (c.docs.soldkg1[i]) return pause();
  await ref.set(doc);
  host.log("device " + i + ": Solana round 1 commitment published");
}

/** A round-1 secret whose package another copy of the seat did not publish goes. */
async function dropR1(c, i) {
  const gone = { r1secret: null, r1package: null, rSol: null, r2secret: null, cluster: null };
  Object.assign(gone, { otherCopy: true });
  await putSol(c.host, c.gid, i, gone);
  c.host.log("device " + i + ": another copy of this device published its Solana round 1");
}

function makeBoxes(c, i, s) {
  const { host, W, gid } = c,
    seats = host.state.seats;
  const others = {};
  for (const j of host.seatIds()) if (j !== i) others[j] = c.docs.soldkg1[j].package;
  const r = J(W.sol_dkg2(S(s.r1secret), S(others)));
  const boxes = {};
  for (const [to, pkg] of Object.entries(r.outgoing)) {
    const body = S({ package: pkg, r: s.rSol });
    boxes[to] = host.Z.boxSeal(
      host.sec(gid, i).boxSk,
      seats[to].boxPk,
      boxContext(gid, i, to),
      body,
    );
  }
  return { boxes, secret: r.secret };
}

async function round2(c, i) {
  const { host, gid, base } = c,
    s = solOf(host, gid, i);
  const { echo, made } = await guarded(c, i, () => ({
    echo: s.echo ?? echoNow(c),
    made: makeBoxes(c, i, s),
  }));
  await putSol(host, gid, i, { echo });
  // Sign every document first, write them, and only then drop the round-1 secret.
  const docs = [];
  for (const [to, sealed] of Object.entries(made.boxes)) {
    const rel = "soldkg2/" + i + "-" + to;
    docs.push([rel, await host.signedDoc(gid, rel, i, { sealed, echo, at: Date.now() })]);
  }
  for (const [rel, doc] of docs) await host.sdb.doc(base + "/" + rel).set(doc);
  await putSol(host, gid, i, { r2secret: made.secret, r1secret: null });
  host.log("device " + i + ": " + docs.length + " Solana key shares sent, sealed");
}

/** Opens the box that seat j sent to seat i: its round-2 package and its secret part. */
function unboxFrom(c, j, i) {
  const { host, gid } = c,
    d = c.docs.soldkg2[j + "-" + i];
  if (typeof d.sealed !== "string") throw new Error("Device " + j + " sent an unreadable message");
  let box;
  const ctx = boxContext(gid, j, i);
  try {
    box = J(host.Z.boxOpen(host.sec(gid, i).boxSk, host.state.seats[j].boxPk, ctx, d.sealed));
  } catch {
    throw new Error("Device " + j + " sent a message that cannot be opened");
  }
  if (!box || !HEX(32)(box.r) || !box.package || typeof box.package !== "object") {
    throw new Error("Device " + j + " sent an unreadable message");
  }
  return box;
}

// The wasm runs every check of round 3 before it makes the key share. It computes the echo from
// the round-1 documents and requires that it equals the echo that this seat saved and the echo
// that each other seat signed in its round-2 documents. Then it checks every commitment (and
// names the first seat that does not match), and only then it runs the key share.
function openRound3(c, i, s) {
  const { host, W, gid } = c,
    seats = host.state.seats,
    r2 = {},
    peerEchoes = {};
  const parts = { [i]: { r: s.rSol, boxPk: seats[i].boxPk } };
  for (const j of host.seatIds().filter((x) => x !== i)) {
    const box = unboxFrom(c, j, i);
    r2[j] = box.package;
    peerEchoes[j] = c.docs.soldkg2[j + "-" + i].echo;
    parts[j] = { r: box.r, boxPk: seats[j].boxPk };
  }
  const safety = host.safetyNo();
  const echo = s.echo;
  const ctx = S({ walletId: gid, safety, cluster: CLUSTER, seat: i, echo, peerEchoes, parts });
  const r = J(W.sol_dkg3(S(s.r2secret), S(round1Docs(c)), S(r2), ctx));
  W.sol_roles(r.sol_seed, r.group_key);
  return r;
}

async function round3(c, i) {
  const { host, gid } = c,
    s = solOf(host, gid, i);
  const r = await guarded(c, i, () => openRound3(c, i, s));
  const saved = await putSol(host, gid, i, {
    keyPackage: r.key_package,
    publicKeyPackage: r.public_key_package,
    groupKey: r.group_key,
    solSeed: r.sol_seed,
    r2secret: null,
    r1package: null,
    rSol: null,
    echo: null,
  });
  if (!saved)
    host.showBanner(
      "bad",
      "This browser could not save your Solana key share. " +
        "Keep this tab open, and use Back up.",
    );
}

/** The PDA identity that a key share and solSeed give (ZOLANA.md 7.2), as soldone names it. */
export function pdaFields(W, s) {
  const pda = J(W.sol_pda_roles(s.solSeed, s.groupKey));
  return {
    pda: pda.pda,
    pdaNullifierPk: pda.nullifier_pk,
    pdaOwnerHash: pda.owner_hash,
    pdaAddress: pda.address,
  };
}

/**
 * The soldone fields of a seat: the group key, the public keys, the address of the group key,
 * cluster, label, and the PDA identity that owns the funds of the program design.
 */
function doneFields(W, s) {
  const roles = J(W.sol_roles(s.solSeed, s.groupKey));
  return {
    groupKey: s.groupKey,
    publicKeyPackage: S(s.publicKeyPackage),
    nullifierPk: roles.nullifier_pk,
    viewingPk: roles.viewing_pk,
    address: roles.address,
    cluster: CLUSTER,
    program: W.sol_program_label(),
    ...pdaFields(W, s),
    at: Date.now(),
  };
}

async function publishDone(c, i) {
  const { host, W, gid, base } = c,
    s = solOf(host, gid, i);
  const doc = await host.signedDoc(gid, "soldone/" + i, i, doneFields(W, s));
  await host.sdb.doc(base + "/soldone/" + i).set(doc);
  await putSol(host, gid, i, { doneSent: true });
  const key = s.groupKey.slice(0, 12);
  host.log("device " + i + ": Solana key share ready, group key " + key + "…");
}

const launch = (c, key, run) => {
  c.host.once("sol:" + key, run);
  return true;
};

// The steps of a seat in order: the first one that is due runs. `open` is true when the Zcash part
// of the seat is settled. The fee step needs the Solana key share only: a seat that finished its
// setup before the fee key existed publishes its fee document here.
const STEPS = [
  ["r1", (c, i, s, open) => open && needR1(c, i, s), round1],
  ["stale", (c, i, s) => staleR1(c, i, s), dropR1],
  ["r2", (c, i, s, open) => open && needR2(c, i, s), round2],
  ["r3", (c, i, s) => needR3(c, i, s), round3],
  ["done", (c, i, s) => needDone(c, i, s), publishDone],
  ["pdadoc", (c, i, s) => needPdaDoc(c, i, s), publishDone],
  ["feedoc", (c, i) => c.loaded.solfee && feeUnpublished(c, i), publishFee],
];

function stepSeat(c, i) {
  const s = solOf(c.host, c.gid, i);
  if (s.aborted) return false;
  const open = seatReady(c.host, c.gid, i);
  const step = STEPS.find(([, due]) => due(c, i, s, open));
  return step ? launch(c, step[0] + ":" + i, () => step[2](c, i)) : false;
}

/**
 * When what the seats published does not agree (or a key share of this browser does not fit its
 * own document), every seat of this browser that holds a share stops for good. The stop is
 * written into the seat secret, so a seat that signs its document again does not undo it.
 */
function stopOnDiffer(c) {
  const ag = agreement(c);
  if (ag.state !== "differ") return false;
  for (const i of c.host.localSeats()) {
    const s = solOf(c.host, c.gid, i);
    if (holdsShare(s) && !s.aborted) {
      launch(c, "differ:" + i, () => abortSeat(c, i, new Error(ag.why)));
    }
  }
  return true;
}

// Only `solAuto` in the own secret of seat 1 starts Solana with no button (planSolana). The
// unsigned hint must still be there, so the joiners saw the Solana texts. A moved wallet starts
// nothing.
const AUTO = [
  (c) => c.host.sec(c.gid, 1)?.solAuto === true,
  (c) => c.host.state.g?.solana === true && !c.host.state.g.movedTo,
  (c) => !!c.loaded.solstart && !c.docs.solstart[1] && c.wait === 0,
  (c) => !stopOf(c) && !startBlock(c.host),
  (c) => c.host.localSeats().includes(1) && c.host.canWriteAs(1),
  (c) => seatReady(c.host, c.gid, 1),
];
const autoStart = (c) => AUTO.every((due) => due(c)) && launch(c, "solstart", () => addSolana(c));

/** Advances the ceremony of every seat that this browser holds. It acts only on verified data. */
export function reactCeremony(c) {
  const { host } = c;
  autoStart(c);
  if (startBlock(host) || !started(c.docs) || c.wait > 0 || stopOnDiffer(c)) return;
  if (stopOf(c)) return;
  for (const i of host.localSeats()) if (host.canWriteAs(i)) stepSeat(c, i);
}

/** Seat 1 starts the ceremony with the signed start document. */
export async function addSolana(c) {
  const { host, gid, base } = c;
  refuseStopped(c);
  const why = startBlock(host) ?? (c.docs.solstart[1] ? "Solana was added already." : null);
  if (why) throw new Error(why);
  if (!host.localSeats().includes(1) || !host.canWriteAs(1)) {
    throw new Error("Only device 1 can add Solana to this wallet.");
  }
  const wait = waitOf(host, gid, 1);
  if (wait) throw new Error(wait);
  const doc = await host.signedDoc(gid, "solstart/1", 1, { cluster: CLUSTER, at: Date.now() });
  await host.sdb.doc(base + "/solstart/1").set(doc);
}

/** This browser holds seat i but no Solana secret, though the seat published its round 1. */
function lostSecret(c, i) {
  const s = solOf(c.host, c.gid, i);
  return (
    c.host.localSeats().includes(i) && !s.r1secret && !s.r2secret && !s.keyPackage && !s.aborted
  );
}

const OTHER_COPY = ": another copy of this device runs its Solana setup. This browser takes no "
  + "part.";
const LOST = ": this browser lost its setup secret. If another copy of this device does not "
  + "finish the Solana setup, create a new wallet to use Solana.";

// No stop goes out for a seat with no secret: a restored copy of the seat looks the same while the
// other copy finishes the ceremony.
/** Seat i of this browser published round 1 but holds no secret now: why, or null. */
function noSecretText(c, i) {
  if (solOf(c.host, c.gid, i).otherCopy) return "Device " + i + OTHER_COPY;
  return lostSecret(c, i) ? "Device " + i + LOST : null;
}

/** The text of the progress of seat i, from the documents in the store. */
export function seatProgress(c, i) {
  const { docs } = c,
    others = c.host.seatIds().filter((j) => j !== i);
  if (docs.soldone[i]) return "Device " + i + ": key ready";
  const gone = docs.soldkg1[i] ? noSecretText(c, i) : null;
  if (gone) return gone;
  if (others.some((j) => docs.soldkg2[i + "-" + j])) return "Device " + i + ": sharing keys";
  if (docs.soldkg1[i]) return "Device " + i + ": round 1 sent";
  const wait = c.host.localSeats().includes(i) ? waitOf(c.host, c.gid, i) : null;
  return wait ?? "Device " + i + " has not started";
}

const PDA_SHAPES = {
  pda: HEX(32),
  pdaNullifierPk: HEX(32),
  pdaOwnerHash: HEX(32),
  pdaAddress: HEX(99),
};
const PDA_FIELDS = Object.keys(PDA_SHAPES);
/** A soldone from before the program design has no PDA field. */
const hasPda = (d) => PDA_FIELDS.some((k) => d[k] !== undefined);
const pdaShaped = (d) => Object.entries(PDA_SHAPES).every(([k, ok]) => ok(d[k]));

/**
 * True when a Solana key share and solSeed give the keys and the address that `done` publishes,
 * and the PDA identity too when `done` names one.
 */
export function fitsSolana(W, seat, s, done) {
  if (!done || !fitsPublished(seat, s, done)) return false;
  try {
    const r = J(W.sol_roles(s.solSeed, s.groupKey));
    const same =
      r.nullifier_pk === done.nullifierPk &&
      r.viewing_pk === done.viewingPk &&
      r.address === done.address;
    const pda = pdaFields(W, s);
    return same && (!hasPda(done) || PDA_FIELDS.every((k) => pda[k] === done[k]));
  } catch {
    return false;
  }
}

const SAME = ["groupKey", "nullifierPk", "viewingPk", "address", "cluster", "program"];
const SHAPES = { groupKey: HEX(32), nullifierPk: HEX(32), viewingPk: HEX(33), address: HEX(99) };
const shaped = (W, d) =>
  Object.entries(SHAPES).every(([k, ok]) => ok(d[k])) &&
  d.cluster === CLUSTER &&
  d.program === W.sol_program_label();

/** The documents that name a PDA identity name the same one, with every field well formed. */
function samePda(dones) {
  const named = dones.filter(hasPda);
  return (
    named.every(pdaShaped) && named.every((d) => PDA_FIELDS.every((k) => d[k] === named[0][k]))
  );
}

/**
 * The PDA identity of the agreed group: from the documents that name it, or from a key share of
 * this browser (it fits the published keys, so its seed is the seed of the group). Empty when
 * neither has it.
 */
function pdaOf(c, dones) {
  const named = dones.find(hasPda);
  if (named) return Object.fromEntries(PDA_FIELDS.map((k) => [k, named[k]]));
  const seat = c.host.localSeats().find((i) => holdsShare(solOf(c.host, c.gid, i)));
  return seat === undefined ? {} : pdaFields(c.W, solOf(c.host, c.gid, seat));
}

/**
 * Why a key share of this browser does not fit the documents, or null: its own soldone, and the
 * PDA identity that a soldone of another seat names (its own may be from before the PDA).
 */
function localMisfit(c, dones) {
  const { host, W, docs } = c;
  const mine = host.localSeats().filter((i) => solOf(host, c.gid, i).keyPackage);
  const bad = mine.find((i) => !fitsSolana(W, i, solOf(host, c.gid, i), docs.soldone[i]));
  if (bad) return "The Solana key share of device " + bad + " does not fit.";
  const named = dones.find(hasPda);
  const seat = mine.find((i) => holdsShare(solOf(host, c.gid, i)));
  if (!named || seat === undefined) return null;
  const own = pdaFields(W, solOf(host, c.gid, seat));
  const fits = PDA_FIELDS.every((k) => own[k] === named[k]);
  return fits ? null : "The PDA identity of the documents does not fit the key share here.";
}

/**
 * What the seats published. "wait": a seat has not finished. "agree": every soldone is equal and
 * well formed and each key share of this browser fits its own. Else "differ", with a reason.
 * `done` is the common document when they agree.
 */
export function agreement(c) {
  const { host, docs, W } = c,
    dones = host.seatIds().map((i) => docs.soldone[i]);
  if (!dones.length || !dones.every(Boolean)) return { state: "wait" };
  const same =
    SAME.every((k) => dones.every((d) => d[k] === dones[0][k])) &&
    samePackages(dones.map((d) => d.publicKeyPackage));
  if (!same || !shaped(W, dones[0]) || !samePda(dones))
    return { state: "differ", why: "The devices published different Solana keys." };
  const why = localMisfit(c, dones);
  if (why) return { state: "differ", why };
  return { state: "agree", done: { ...dones[0], ...pdaOf(c, dones) } };
}
