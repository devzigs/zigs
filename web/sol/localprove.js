// The group switch of local proving (SOL-4, ZOLANA.md 3.7). One valid signed document
// `solprove/<i>` of any seat turns it on for the group, for good: no document turns it off. A
// browser that sees it on pins it in the Solana part of each of its seats (the Solana backup
// carries the pin) and writes the document of each of its seats, so a server that drops documents
// cannot turn it off. Before each prove call the Worker asks the page (gateAnswer). The page makes
// one round trip to the group server, then answers "hosted" only when the server shows no switch
// and no seat of this browser holds the pin. With the switch on, a seat that cannot prove fails
// with a text: it never falls back to the hosted prover.
import { CLUSTER, readDocs } from "./docs.js";
import { holdsShare, putSol, solOf, stopOf } from "./secrets.js";

export const COLLECTION = "solprove";
const LOCAL = { mode: "local" };
const HOSTED = { mode: "hosted" };
export const UNREAD =
  "Could not read the proving setting of the group from the group server. Nothing was sent to " +
  "Helius. Try again.";
// A new document is checked in the background: the gate waits up to 5 s for that check.
const CHECK_TRIES = 20;
const CHECK_MS = 250;
const HOLDER = "gate-" + Math.random().toString(36).slice(2);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const valid = (d) => d?.local === true && d?.cluster === CLUSTER;
const shareSeats = (c) => c.host.localSeats().filter((i) => holdsShare(solOf(c.host, c.gid, i)));

/** True when a seat of this browser holds the pin: it saw the switch on, or a restore gave it. */
export const pinned = (c) =>
  c.host.localSeats().some((i) => solOf(c.host, c.gid, i).proveLocal === true);

/** True when the group proves on its devices: the pin, or a valid signed switch document. */
export const provesLocally = (c) =>
  pinned(c) || Object.values(c.docs[COLLECTION] ?? {}).some(valid);

/** Pins the switch in the Solana part of each seat of this browser that holds a key share. */
async function pinSeats(c) {
  for (const i of shareSeats(c)) {
    if (solOf(c.host, c.gid, i).proveLocal !== true) {
      await putSol(c.host, c.gid, i, { proveLocal: true });
    }
  }
}

/**
 * One round trip to the group server. It handles the messages of a socket one at a time and sends
 * each stored write to every socket before it answers the next message, so when this reply comes
 * the local copy holds every document that the server stored before it. The lease is a no-op.
 */
const barrier = (c, seat) =>
  c.host.sdb.doc(c.base + "/solgate/" + seat).acquire({ holder: HOLDER, ttlMs: 1000 });

/** The switch as the group server shows it now: "on", "off" or "wait" (a check still runs). */
function serverSwitch(c) {
  if (!c.loaded[COLLECTION]) return "wait";
  const found = readDocs(COLLECTION, c.raw[COLLECTION], c.host.checkIn(c.gid), () => {});
  if (Object.values(found.docs).some(valid)) return "on";
  return found.wait > 0 ? "wait" : "off";
}

/**
 * How the Worker proves now, asked right before each prove call: { mode: "local" } with the pin
 * or a valid switch document after the barrier, { mode: "hosted" } when the server shows neither,
 * and { refuse } when the server cannot be read or a document is still being checked.
 */
export async function gateAnswer(c) {
  if (pinned(c)) return LOCAL;
  const seat = shareSeats(c)[0];
  if (seat === undefined) return { refuse: UNREAD };
  try {
    await barrier(c, seat);
  } catch {
    return { refuse: UNREAD };
  }
  for (let i = 0; i < CHECK_TRIES; i += 1) {
    const now = serverSwitch(c);
    if (now === "on") {
      await pinSeats(c);
      return LOCAL;
    }
    if (now === "off") return HOSTED;
    await sleep(CHECK_MS);
  }
  return { refuse: UNREAD };
}

/** The signed switch document of `seat`. */
async function publishSwitch(c, seat) {
  const rel = COLLECTION + "/" + seat;
  const fields = { local: true, cluster: CLUSTER, at: Date.now() };
  const doc = await c.host.signedDoc(c.gid, rel, seat, fields);
  await c.host.sdb.doc(c.base + "/" + rel).set(doc);
  c.host.log("seat " + seat + ": local proving is on for the group");
}

const secs = (ms) => (ms / 1000).toFixed(1) + " s";
const POOL_MOVED =
  "Helius changed the Solana pool after this version of Zigs was tested with it. Local proving " +
  "cannot be turned on until Zigs is tested with the new pool.";
const NOT_ON = " Local proving was not turned on.";
export const turnOnAsk = (ms) =>
  "This device made a test proof in " +
  secs(ms) +
  ". Turn on local proving for every device of this group? It cannot be turned off.";

/** Keeps the result of the device check in the Solana part of each seat of this browser. */
async function keepCheck(c, check) {
  for (const i of shareSeats(c)) await putSol(c.host, c.gid, i, { proveCheck: check });
}

/**
 * The switch (SOL-4). The pool must be the one that the prover was tested against, and this
 * device must make a test proof. Only then, and after a confirm, the seat signs the document.
 * A failed check writes nothing and says why.
 */
export async function turnOnLocal(c, worker) {
  if (provesLocally(c)) return;
  const seat = shareSeats(c).find((i) => c.host.canWriteAs(i));
  if (seat === undefined) throw new Error("This browser holds no Solana key share of this wallet.");
  const pool = await worker.call("poolSlot");
  if (pool.slot !== pool.pinned) throw new Error(POOL_MOVED);
  const test = await worker.call("selftest").catch((e) => {
    throw new Error("This device could not make a test proof: " + e.message + NOT_ON);
  });
  await keepCheck(c, { ok: true, ms: test.ms, at: Date.now() });
  if (!globalThis.confirm(turnOnAsk(test.ms))) return;
  await publishSwitch(c, seat);
  await pinSeats(c);
}

/** The device check of a browser that sees the switch on: once, in the background, no write. */
async function checkDevice(c, ensure) {
  let check;
  try {
    const worker = await ensure();
    check = { ok: true, ms: (await worker.call("selftest")).ms, at: Date.now() };
  } catch (e) {
    check = { ok: false, why: String(e?.message ?? e).slice(0, 300), at: Date.now() };
  }
  await keepCheck(c, check);
}

const needsDoc = (c, i) =>
  c.loaded[COLLECTION] && c.wait === 0 && c.host.canWriteAs(i) && !valid(c.docs[COLLECTION]?.[i]);

/**
 * The reactor step: once the switch is on, pin it, write the switch document of each seat of
 * this browser, and run the device check once. `ensure()` gives the Worker.
 */
export function reactProve(c, ensure) {
  if (!provesLocally(c) || stopOf(c)) return;
  const seats = shareSeats(c);
  if (seats.some((i) => solOf(c.host, c.gid, i).proveLocal !== true)) {
    c.host.once("sol:provepin:" + c.opened, () => pinSeats(c));
  }
  for (const i of seats.filter((i) => needsDoc(c, i))) {
    c.host.once("sol:provedoc:" + i, () => publishSwitch(c, i));
  }
  maybeCheck(c, seats, ensure);
}

/** One device check per open wallet, also when it fails. It calls Helius (the Worker init), so
 * it waits until the tab shows this wallet. */
function maybeCheck(c, seats, ensure) {
  const unchecked = seats.some((i) => !solOf(c.host, c.gid, i).proveCheck);
  if (!unchecked || !c.viewed || !c.rpcUrl || c.proveChecked) return;
  c.proveChecked = true;
  c.host.once("sol:provecheck:" + c.opened, () => checkDevice(c, ensure));
}

/** The device check of a seat of this browser, as a line of its tile, or null. */
export function checkLine(c, seat) {
  const check = solOf(c.host, c.gid, seat).proveCheck;
  if (!provesLocally(c) || !check) return null;
  if (check.ok) return "Local proving: this device made a test proof in " + secs(check.ms) + ".";
  return (
    "Local proving: this device could not make a test proof, so it cannot pay for this group. " +
    check.why
  );
}

/** A failed test run of a group that proves locally: the pool upgrade text first, if any. */
export async function poolNote(c, worker, text) {
  if (!provesLocally(c)) return text;
  const pool = await worker.call("poolSlot").catch(() => null);
  return pool?.text ? pool.text + " " + text : text;
}

export const SWITCH_TEXT = [
  "Local proving makes the proofs of this group on its own devices, in place of the hosted " +
    "prover of Helius. Helius then no longer sees the payments: not the amounts, the payees and " +
    "the notes that a payment spends, and not the secret that links each spend to its notes " +
    "(the nullifier secret). Its indexer still sees the queries of this wallet (the tags and " +
    "nullifiers that it looks up) and your IP address. The key server of Helius sees your IP " +
    "address and that the request comes from Zigs when it sends a proving key.",
  "Proofs are slower: from about 3 s for one input to about 15 s for eight, on a fast laptop. " +
    "The first use downloads about 5 MB, plus 9 to 59 MB for each payment size. A phone may be " +
    "too slow, or may run out of memory: local proving is not tested on phones.",
  "Every hosted proof that this group made before gave Helius its nullifier secret, so the " +
    "setting helps most when it is on before the first payment. Once on, it is on for every " +
    "device of the group and cannot be turned off. If a change of Helius breaks the local " +
    "prover, the group cannot pay until a Zigs update.",
];
const ON_TEXT =
  "Local proving is on: every device of this group makes its proofs itself, and none uses the " +
  "hosted prover.";

/** The card of the switch, among the payment cards. `actions.proveOn` turns it on. */
export function switchCard(c, act, actions) {
  const { el } = c.host;
  const on = provesLocally(c);
  return el(
    "div",
    { class: "card card-pad", style: "display:grid;gap:8px", "data-sol": "prove-card" },
    el("h3", {}, "Local proving"),
    on ? el("p", { class: "small", "data-sol": "prove-on" }, ON_TEXT) : null,
    ...SWITCH_TEXT.map((text) => el("p", { class: "small" }, text)),
    on || !shareSeats(c).length
      ? null
      : el(
          "button",
          {
            class: "btn",
            type: "button",
            "data-sol": "prove-switch",
            onclick: act(actions.proveOn),
          },
          "Test this device, then prove on our devices",
        ),
  );
}
