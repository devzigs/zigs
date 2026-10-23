// Optional guided onboarding. Existing security and payment gates never read this module.
import { actualSafety, deriveGuidedSetup, emptyGuidedRecord, readGuidedRecord,
  readSetupReports } from "./guided-setup-model.js";
import { state } from "./app-state.js";
import { abortedText, confirmedBy, groupVersion, rejectedSeats, remoteAborts, safetyNo,
  seatCheck, verifiedCount } from "./app-dkg.js";
import { canWriteAs, checkIn, signedDoc, signedMode } from "./app-filter.js";
import { gkeys, sec } from "./app-keystore.js";
import { keysDiffer, localSeats, seatIds } from "./app-seats.js";
import { solError, solPlanned, solSetup } from "./app-sol.js";
import { render } from "./app-loop.js";
import { numberClash } from "./util.js";
import { exclusive } from "./app-kit.js";

const PREFIX = "zf-guided-setup:";
const walletId = (id) => typeof id === "string" && /^[0-9a-f]{20}$/.test(id);
const issues = new Map(), reportIssues = new Map();
const ephemeral = new Map();
const STORE_FAILED = "This browser could not save tutorial progress. Your wallet keys are kept. "
  + "Free storage and try again.";
const STORE_UNKNOWN = "This saved tutorial progress could not be read. Its stored copy is kept. "
  + "Your wallet setup and keys are unchanged.";

export function guidedRecord(gid = state.gid) {
  if (!walletId(gid)) return null;
  if (ephemeral.has(gid)) return structuredClone(ephemeral.get(gid));
  try {
    const raw = localStorage.getItem(PREFIX + gid);
    if (raw === null) { issues.delete(gid); return null; }
    const r = readGuidedRecord(JSON.parse(raw));
    if (!r) throw new Error(STORE_UNKNOWN);
    issues.delete(gid);
    return r;
  } catch { issues.set(gid, STORE_UNKNOWN); return null; }
}

function change(gid, update) {
  if (!walletId(gid)) throw new Error("Open a wallet before saving tutorial progress.");
  const before = guidedRecord(gid);
  const next = update(before || emptyGuidedRecord());
  if (!readGuidedRecord(next)) throw new Error("Invalid tutorial progress.");
  if (issues.get(gid) === STORE_UNKNOWN) {
    ephemeral.set(gid, next); throw new Error(STORE_UNKNOWN);
  }
  try {
    const text = JSON.stringify(next);
    localStorage.setItem(PREFIX + gid, text);
    if (localStorage.getItem(PREFIX + gid) !== text) throw new Error(STORE_FAILED);
  } catch {
    ephemeral.set(gid, next); issues.set(gid, STORE_FAILED); throw new Error(STORE_FAILED);
  }
  ephemeral.delete(gid);
  issues.delete(gid);
  return next;
}

export const guidedEnabled = (gid = state.gid) => {
  const r = guidedRecord(gid);
  return !!r && !r.completed;
};
export function beginGuided(gid, { replay = false, solExpected = false } = {}) {
  return change(gid, (r) => ({ ...r, paused: false, completed: false,
    solExpected: r.solExpected || solExpected === true, review: replay ? 0 : r.review }));
}
export const pauseGuided = (gid = state.gid) => change(gid, (r) => ({ ...r, paused: true }));
export const resumeGuided = (gid = state.gid) => change(gid, (r) => ({ ...r, paused: false }));
export function reviewGuided(index, gid = state.gid) {
  const current = guidedState();
  if (gid !== state.gid || !(index === null
    || Number.isInteger(index) && index >= 0 && index <= current.index)) return;
  return change(gid, (r) => ({ ...r, review: index, paused: false }));
}

let reportWallet = null, reportRaw = {}, reportStore = null;
const REPORT_READ_FAILED = "Other devices' backup reports could not be read. "
  + "Their wallet setup is unchanged. Reopen this wallet to retry.";
/** Separate optional watcher: malformed reports cannot add to state.pending or stop a reactor. */
export function watchGuidedReports(gid, store) {
  reportWallet = gid; reportRaw = {}; reportStore = store;
  for (const key of fingerprints.keys()) if (!key.startsWith(gid + ":")) fingerprints.delete(key);
  if (!gid) return () => {};
  let live = true, stop = () => {};
  const failed = () => {
    if (!live || reportWallet !== gid) return;
    reportRaw = {}; reportIssues.set(gid, REPORT_READ_FAILED); render();
  };
  const received = (snap) => {
    if (!live || reportWallet !== gid) return;
    if (reportIssues.get(gid) === REPORT_READ_FAILED) reportIssues.delete(gid);
    reportRaw = {};
    // Ignore unknown ids without loading signature checks or sizing arrays from store input.
    for (const d of snap.docs) if (/^[1-7]$/.test(d.id)) reportRaw[d.id] = d.data();
    render();
  };
  try {
    stop = store.collection("groups/" + gid + "/setupstatus").onSnapshot(received, failed);
  } catch { failed(); }
  return () => { live = false; stop(); };
}

export function setupReports() {
  if (reportWallet !== state.gid || !signedMode(state.gid)) return {};
  return readSetupReports(Object.entries(reportRaw), {
    n: state.g?.n, safety: safetyNo(), check: checkIn(state.gid),
  });
}

const sameSafetyChecks = (r, no) => r?.safety === no ? r.checked : {};
const checkedSafety = () => actualSafety(safetyNo()) ? safetyNo() : null;
const fingerprints = new Map();
const ordered = (v) => {
  if (Array.isArray(v)) return v.map(ordered);
  if (!v || typeof v !== "object") return v;
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordered(v[k])]));
};
function shareText(gid, seat, chain) {
  const s = sec(gid, seat), part = chain === "sol" ? s?.sol : s;
  if (!part?.keyPackage) return null;
  const fields = chain === "sol"
    ? ["keyPackage", "publicKeyPackage", "groupKey", "solSeed", "cluster", "proveLocal"]
    : ["keyPackage", "publicKeyPackage", "groupKey", "vaultSk", "boxSk", "signSk", "version",
      "room"];
  const context = chain === "zec" ? { key: gkeys[gid], n: state.g?.n, t: state.g?.t,
    address: state.wallet?.address, network: state.wallet?.network ?? null } : {};
  return JSON.stringify(ordered({ gid, seat, chain, context,
    share: Object.fromEntries(fields.filter((k) => part[k] !== undefined)
      .map((k) => [k, part[k]])) }));
}
// Only a local hash is kept in storage. It binds checked education to the exact current share;
// neither the secret input nor its hash is included in a remote progress report.
function fingerprint(gid, seat, chain) {
  const text = shareText(gid, seat, chain);
  if (!text) return null;
  const key = gid + ":" + seat + ":" + chain, old = fingerprints.get(key);
  if (old?.text === text) return old;
  const next = { text, hash: null, promise: null };
  next.promise = crypto.subtle.digest("SHA-256", new globalThis.TextEncoder().encode(text))
    .then((bytes) => {
    next.hash = Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
    render();
    return next.hash;
  }).catch(() => {
    issues.set(gid, "This browser could not check the local share identity. "
      + "The saved file and wallet keys are unchanged.");
    return null;
  });
  fingerprints.set(key, next);
  return next;
}
function currentChecks(r, no) {
  const checked = sameSafetyChecks(r, no), out = {};
  for (const [id, flags] of Object.entries(checked)) {
    out[id] = { zec: false, sol: false };
    for (const chain of ["zec", "sol"]) {
      const hash = fingerprint(state.gid, Number(id), chain)?.hash;
      out[id][chain] = !!hash && flags[chain] === true && flags[chain + "For"] === hash;
    }
  }
  return out;
}
function blockedText() {
  if (keysDiffer()) return "The devices made different wallet keys. Do not use this wallet.";
  const stopped = abortedText();
  if (stopped) return stopped;
  const remote = remoteAborts();
  if (remote.length) return "Device " + remote[0] + " stopped setup.";
  if (rejectedSeats().length) return "A device rejected the wallet address. Do not use it.";
  if (state.wallet && !state.wallet.birthday) {
    return "An older version of Zigs made this wallet. Create a new wallet.";
  }
  const no = safetyNo();
  if (no && numberClash(no, state.confirm, seatIds()).length) {
    return "The devices confirmed different safety numbers. Do not continue.";
  }
  return null;
}

function localBackup(seat, checked) {
  const s = sec(state.gid, seat), zecChecked = checked?.zec === true;
  const solChecked = checked?.sol === true;
  return { zecChecked, solChecked, zecSaved: !!s?.keyPackage
    && (s.backupSaved === true || zecChecked),
  solSaved: !!s?.sol?.keyPackage && (s.sol.backupSaved === true || solChecked) };
}

export function guidedState() {
  const r = guidedRecord(), no = checkedSafety(), mine = localSeats(), reports = setupReports();
  const checks = currentChecks(r, no), sol = solSetup();
  const facts = deriveGuidedSetup({ created: !!state.g, n: state.g?.n, t: state.g?.t,
    seated: seatIds().filter((i) => state.seats[i]).length,
    verifyRequired: groupVersion() >= 2, confirmed: no ? confirmedBy(no).length : 0,
    zecReady: !!state.wallet?.birthday, zecVerified: verifiedCount(),
    solWanted: solPlanned() || r?.solExpected === true,
    solStatus: sol?.status || (solError ? "unavailable" : "not started"),
    blocked: blockedText(), backups: seatIds().map((seat) => {
      const local = mine.includes(seat), b = local ? checks[seat] : reports[seat];
      return { seat, local, ...(local ? localBackup(seat, b) : b),
        reported: !local && b?.reported === true };
    }),
  });
  return { ...facts, localSeats: mine, review: r?.review ?? null, paused: r?.paused === true,
    completed: r?.completed === true, storageIssue: issues.get(state.gid) || "",
    reportIssue: reportIssues.get(state.gid) || "" };
}

const REPORT_WRITE_FAILED = "This device’s backup progress report was not sent. "
  + "Keep any saved files and retry the progress report.";
async function reportWrite(gid, pending) {
  const warning = setTimeout(() => {
    reportIssues.set(gid, REPORT_WRITE_FAILED); render();
  }, 10000);
  // A warning does not release the queue: the actual write must finish before a newer report
  // can be sent, otherwise a late older write could replace the current check booleans.
  try { await pending; } finally { clearTimeout(warning); }
}
async function sendReport(gid, seat) {
  const no = checkedSafety();
  if (gid !== state.gid || reportWallet !== gid || !reportStore || !signedMode(gid)
    || !canWriteAs(seat) || !actualSafety(no)) return;
  try {
    await Promise.all(["zec", "sol"].map((chain) => fingerprint(gid, seat, chain)?.promise));
    if (gid !== state.gid || no !== checkedSafety()) return;
    const b = localBackup(seat, currentChecks(guidedRecord(gid), no)[seat]);
    const fields = { v: 2, safety: no, zecSaved: b.zecSaved, solSaved: b.solSaved,
      zecChecked: b.zecChecked, solChecked: b.solChecked };
    const rel = "setupstatus/" + seat;
    const doc = await signedDoc(gid, rel, seat, fields);
    await reportWrite(gid, reportStore.doc("groups/" + gid + "/" + rel).set(doc));
    reportIssues.delete(gid);
  } catch {
    reportIssues.set(gid, REPORT_WRITE_FAILED);
  }
}
const publishReport = (gid, seat) => exclusive("guided-report:" + gid + ":" + seat,
  () => sendReport(gid, seat)).catch(() => { reportIssues.set(gid, REPORT_WRITE_FAILED); });

/** Existing successful Save handlers call this after their own backupSaved write. */
export function reportBackupSaved(gid, seat) {
  if (gid !== state.gid || !localSeats().includes(seat)) return;
  void publishReport(gid, seat).then(render);
  render();
}

/** Explicit retry sends saved/optional checked booleans, never file data. */
export async function retryGuidedReports() {
  const gid = state.gid;
  if (!actualSafety(checkedSafety())) return;
  for (const seat of localSeats()) await publishReport(gid, seat);
  render();
}

/** Called only after the separate read-only verifier successfully reopens the selected file. */
export async function markBackupChecked(gid, seat, chain) {
  if (gid !== state.gid || !localSeats().includes(seat) || !["zec", "sol"].includes(chain)) {
    throw new Error("Open this device's wallet before checking its backup.");
  }
  if (seatCheck(seat) !== true || !sec(gid, seat)?.keyPackage
    || chain === "sol" && !sec(gid, seat)?.sol?.keyPackage) {
    throw new Error("Wait for this device's wallet preparation before checking its backup.");
  }
  const no = checkedSafety();
  if (!no && groupVersion() !== 1) throw new Error("Wait for the wallet's safety number.");
  const beforeFingerprint = fingerprint(gid, seat, chain);
  const hash = await beforeFingerprint?.promise;
  if (!hash || gid !== state.gid || shareText(gid, seat, chain) !== beforeFingerprint.text
    || no !== checkedSafety() || !localSeats().includes(seat) || seatCheck(seat) !== true) {
    throw new Error("This device's share changed. Check the file again.");
  }
  change(gid, (before) => {
    const checked = { ...sameSafetyChecks(before, no) };
    checked[seat] = { zec: false, sol: false, zecFor: null, solFor: null,
      ...checked[seat], [chain]: true, [chain + "For"]: hash };
    return { ...before, safety: no, checked };
  });
  // Reporting is optional: a disconnected server must not hold the local file-check dialog.
  void publishReport(gid, seat).then(render);
  render();
}

export function completeGuided(gid = state.gid) {
  if (gid !== state.gid || !guidedState().protocolReady) {
    throw new Error("Complete the remaining setup steps before opening Overview.");
  }
  return change(gid, (r) => ({ ...r, completed: true, paused: false, review: null }));
}
