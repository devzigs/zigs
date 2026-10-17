// Facts derived from state: the seats of this browser and their keys.
import { fitsPublished, samePackages, seatOwned, skey, usesV2 } from "./util.js";
import { state } from "./app-state.js";
import { isStr, S } from "./app-kit.js";
import { Z } from "./app-engine.js";
import { mySeatSecrets, sec } from "./app-keystore.js";
import { groupVersion, me, seatCheck, signedMode } from "./app-rest.js";

// The seats of the open wallet. A group document with no valid n and t has none, so a made-up n
// never sizes an array.
export const seatIds = () => state.g && !state.g.unreadable
  ? Array.from({ length: state.g.n }, (_, i) => i + 1) : [];
export const allSeated = () => seatIds().every((i) => {
  const s = state.seats[i];
  return s && s.uid && isStr(s.boxPk);
});
export const allR1 = () => seatIds().every((i) => state.dkg1[i]);
export const r2For = (to) => seatIds().filter((i) => i !== to).every((i) => state.dkg2[i + "-" + to]);
export const allDone = () => seatIds().every((i) => state.done[i]);
// Every seat's published key package must be identical, and so must the ones this browser made
// itself. Equal group keys alone are not enough: seats with different packages cannot sign
// together.
function keysMatch() {
  const dones = seatIds().map((i) => state.done[i]);
  if (!dones.every((d) => isStr(d.publicKeyPackage))) return false;
  if (new Set(dones.map((d) => d.groupKey)).size !== 1) return false;
  const mine = localSeats().map((i) => sec(state.gid, i).publicKeyPackage).filter(Boolean);
  return samePackages([...dones.map((d) => d.publicKeyPackage), ...mine]);
}
export const keysAgree = () => allDone() && keysMatch();
export const keysDiffer = () => allDone() && !keysAgree();
// Does the key data in the seat secret `s` equal what the wallet published for seat `i`? true or
// false, or null while the documents that decide it have not loaded.
export function fitState(i, s) {
  const done = state.done[i];
  if (!done || !state.g) return null;
  return fitsPublished(i, s, done) ? setupFit(i, s, done) : false;
}

// A seat of a version 2 or 3 wallet must hold the setup secret that, with the seat's published
// data, gives the full viewing key of the wallet. A seat of another version holds none.
function setupFit(i, s, done) {
  if (!s.vaultSk) return !usesV2(groupVersion());
  if (!state.wallet || !Z) return null;
  const inputs = [state.wallet, done.publicKeyPackage, s.vaultSk];
  return cached(skey(state.gid, i), inputs, () => walletMatches(...inputs));
}
function walletMatches(wallet, publishedPackage, sk) {
  try { Z.walletVerifyV2(S(wallet), publishedPackage, sk); return true; } catch { return false; }
}
// The engine call is slow and a redraw asks again and again: reuse the last answer for the same
// inputs.
const lastAnswer = new Map();
function cached(key, inputs, ask) {
  const last = lastAnswer.get(key);
  if (last && last.inputs.every((x, n) => x === inputs[n])) return last.value;
  const value = ask();
  lastAnswer.set(key, { inputs, value });
  return value;
}
// A seat is this browser's when it took the seat (its identity then, or now), or restored the
// seat's key share and the share fits the wallet. Tor Browser gets a new identity each session, so
// identity alone is not enough.
const ownsSeat = (i, s) => seatOwned(state.seats[i], s, me, () => fitState(i, s));
export const localSeats = () => !state.gid ? []
  : mySeatSecrets(state.gid).filter(([i, s]) => ownsSeat(i, s)).map(([i]) => i);
// Is seat i this browser's? In a version 3 wallet it is a seat whose key this browser holds,
// because a made-up seat document can copy any identity. Before, it is the identity in the seat
// document.
export const seatMine = (i) => signedMode(state.gid) ? localSeats().includes(i)
  : isMe((state.seats[i] || {}).uid);
// This browser, or a seat it holds in the open wallet.
export const isMe = (uid) => !!uid && (uid === me || localSeats().some((i) => state.seats[i].uid === uid));
// The identity other signers know: the first local seat's, which outlives a Tor session.
export const myUid = () => { const i = localSeats()[0]; return i ? state.seats[i].uid : me; };
export const isCreator = () => state.g && isMe(state.g.createdBy);
export const seatNameOf = (uid) => (Object.values(state.seats).find((s) => s.uid === uid) || {}).name || "someone";
export const curSession = () => state.sessions.find((s) => s.id === state.sid) || null;
export const signersOf = (ss) => Array.isArray(ss.signers) ? ss.signers : [];

export function seatStage(i) {
  if (!state.seats[i]) return 0;
  if (seatCheck(i) === true) return 5;
  if (state.done[i]) return 4;
  if (seatIds().filter((j) => j !== i).some((j) => state.dkg2[i + "-" + j])) return 3;
  if (state.dkg1[i]) return 2;
  return 1;
}
// A seat publishes its first key message right after joining, so stage 2 still reads as joined.
export const STAGE_LABEL = ["Open", "Joined", "Joined", "Creating key", "Key ready", "Address checked"];
