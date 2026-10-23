// Tutorial progress and remote backup reports describe the journey only. No caller may use
// these values to authorize formation, signing, or spending.
export const GUIDED_STAGES = ["Plan", "Connect", "Verify", "Prepare", "Back up"];
const own = (v, k) => Object.hasOwn(v, k);
const object = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const only = (v, keys) => object(v) && Object.keys(v).every((k) => keys.includes(k));
const seat = (v) => /^[1-7]$/.test(v);
export const actualSafety = (v) => typeof v === "string"
  && /^\d{5}(?: \d{5}){5}$/.test(v);
const recordKeys = ["v", "review", "paused", "completed", "safety", "checked", "solExpected"];
const validReview = (v) => v === null || Number.isInteger(v) && v >= 0 && v < 5;
const validHash = (v) => v === null || typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const validCount = (v) => Number.isInteger(v) && v >= 2 && v <= 7;
const count = (v, n) => Number.isInteger(v) && v > 0 ? Math.min(n, v) : 0;
function recordHeader(v) {
  return only(v, recordKeys) && v.v === 1 && own(v, "review") && validReview(v.review);
}
function recordFlags(v) {
  return typeof v.paused === "boolean" && typeof v.completed === "boolean"
    && typeof v.solExpected === "boolean" && (v.safety === null || actualSafety(v.safety));
}
function checkedFlags([id, flags]) {
  return seat(id) && only(flags, ["zec", "sol", "zecFor", "solFor"])
    && typeof flags.zec === "boolean" && typeof flags.sol === "boolean"
    && validHash(flags.zecFor) && validHash(flags.solFor);
}

/** Strict, non-authorizing local tutorial record. Unknown versions are kept by the host. */
export function readGuidedRecord(v) {
  if (!recordHeader(v) || !recordFlags(v) || !object(v.checked)) return null;
  if (!Object.entries(v.checked).every(checkedFlags)) return null;
  return structuredClone(v);
}

export const emptyGuidedRecord = () => ({
  v: 1, review: null, paused: false, completed: false, safety: null, checked: {},
  solExpected: false,
});

const reportVersions = new Map([[1, ["zec", "sol"]],
  [2, ["zecSaved", "solSaved", "zecChecked", "solChecked"]]]);
function reportShape(id, d, n) {
  const flags = reportVersions.get(d?.v);
  return seat(id) && Number(id) <= n
    && !!flags && only(d, ["v", "safety", ...flags, "by", "sig"])
    && d.by === Number(id) && typeof d.sig === "string" && d.sig.length <= 128;
}
function reportFlags(d, safety) {
  if (d.safety !== safety || !reportVersions.get(d.v).every((k) => typeof d[k] === "boolean")) {
    return false;
  }
  return d.v === 1 || (!d.zecChecked || d.zecSaved) && (!d.solChecked || d.solSaved);
}
const reportFields = (d) => ({ v: d.v, safety: d.safety,
  ...Object.fromEntries(reportVersions.get(d.v).map((k) => [k, d[k]])) });
function reportedBackup(d) {
  const checked = d.v === 1 ? { zec: d.zec, sol: d.sol }
    : { zec: d.zecChecked, sol: d.solChecked };
  return { zec: checked.zec, sol: checked.sol, zecChecked: checked.zec,
    solChecked: checked.sol, zecSaved: d.v === 1 ? d.zec : d.zecSaved,
    solSaved: d.v === 1 ? d.sol : d.solSaved, reported: true };
}
function reportAccepted(check, args) {
  try { return check(...args) === "yes"; } catch { return false; }
}

/** A signed report is one device's claim, never proof that a remote file can be opened. */
export function readSetupReports(entries, { n, safety, check }) {
  const reports = {};
  if (!validCount(n) || !actualSafety(safety)) return reports;
  for (const [id, d] of entries) {
    if (!reportShape(id, d, n) || !reportFlags(d, safety)) continue;
    const fields = reportFields(d);
    if (reportAccepted(check, ["setupstatus/" + id, d.by, d.sig, fields, Number(id)])) {
      reports[id] = reportedBackup(d);
    }
  }
  return reports;
}

const missingBackup = (b) => !b.zecSaved || b.solRequired && !b.solSaved;
const uncheckedBackup = (b) => !b.zecChecked || b.solRequired && !b.solChecked;
const checkedFor = (b, chain) => b?.[chain + "Checked"] === true || b?.[chain] === true;
function backupRow(given, id, solWanted) {
  const zecChecked = checkedFor(given, "zec"), solChecked = checkedFor(given, "sol");
  return { seat: id, local: given?.local === true, zec: zecChecked, sol: solChecked,
    zecChecked, solChecked, zecSaved: given?.zecSaved === true || zecChecked,
    solSaved: given?.solSaved === true || solChecked, solRequired: solWanted,
    reported: given?.reported === true };
}
function backupRows(f, n, solWanted) {
  return Array.from({ length: n }, (_, i) => {
    const id = i + 1, given = (f.backups || []).find((b) => b.seat === id);
    return backupRow(given, id, solWanted);
  });
}
function currentStage(f, p) {
  if (!f.created) return 0;
  if (p.seated < p.n) return 1;
  if (f.verifyRequired !== false && p.confirmed < p.n) return 2;
  return !p.zecReady || !p.solReady ? 3 : 4;
}
const protocolComplete = (f, p) => !!f.created && p.seated === p.n
  && (f.verifyRequired === false || p.confirmed === p.n) && p.zecReady && p.solReady;
const blockedText = (value) => typeof value === "string" && value ? value : null;
function backupCounts(backups, t, n) {
  const perChain = Object.fromEntries(["zecSaved", "solSaved", "zecChecked", "solChecked"]
    .map((name) => [name + "Count", backups.filter((b) => b[name]).length]));
  return { ...perChain, backupSavedCount: backups.filter((b) => b.zecSaved || b.solSaved).length,
    backupCheckedCount: backups.filter((b) => b.zecChecked || b.solChecked).length,
    backupThreshold: Number.isInteger(t) && t >= 2 && t <= n ? t : 2 };
}

/** Derive presentation readiness exclusively from existing, verified wallet facts. */
export function deriveGuidedSetup(f) {
  const n = validCount(f.n) ? f.n : 3;
  const seated = count(f.seated, n), confirmed = count(f.confirmed, n);
  const zecVerified = count(f.zecVerified, n);
  const zecReady = f.zecReady === true && zecVerified === n;
  const solWanted = f.solWanted === true;
  const solStatus = f.solStatus || "not started";
  const solReady = !solWanted || solStatus === "ready";
  const p = { n, seated, confirmed, zecReady, solReady };
  const backups = backupRows(f, n, solWanted);
  const backupWaiting = backups.filter(missingBackup).map((b) => b.seat);
  const backupCheckWaiting = backups.filter(uncheckedBackup).map((b) => b.seat);
  const index = currentStage(f, p);
  const blocked = blockedText(f.blocked);
  const protocolReady = protocolComplete(f, p) && !blocked;
  return { index, stage: GUIDED_STAGES[index], stages: GUIDED_STAGES, n, seated, confirmed,
    zecReady, zecVerified, solWanted, solStatus, solReady, backups, backupWaiting,
    backupCheckWaiting, blocked, ...backupCounts(backups, f.t, n), protocolReady,
    complete: protocolReady };
}
