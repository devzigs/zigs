// Display-only interpretation of existing wallet facts. Never used by a security/payment gate.
// A remote report is not a local file check or evidence of device independence.
const validRule = (n, t) => Number.isInteger(n) && Number.isInteger(t)
  && n >= 2 && n <= 7 && t >= 2 && t <= n;
const knownScope = (f) => f.formed && f.rosterKnown !== false
  && ["none", "ready"].includes(f.solScope);
const localChecked = (p) => p.local && p.has && p.checked === true;
const localSaved = (p) => p.local && p.has && p.saved === true;
const reportedChecked = (p) => !p.local && p.reported && p.checked === true;
const needsSave = (p) => p.local && p.has && !p.saved && !p.checked;
const needsCheck = (p) => p.local && p.has && !p.checked && p.checkable;

function recoveryCounts(f, valid, files, chains) {
  const total = valid && knownScope(f) ? f.n * chains.length : null;
  const checked = files.filter(localChecked).length;
  const allChecked = total !== null && checked === total && !f.storageIssue;
  return { total, checked, allChecked, saved: files.filter(localSaved).length,
    reported: files.filter(reportedChecked).length,
    unavailable: total === null || !!f.storageIssue,
    readiness: allChecked ? "Files checked" : "Not established",
    chainCounts: chains.map((chain) => ({ chain,
      checked: files.filter((p) => p.chain === chain && localChecked(p)).length,
      total: valid && f.formed ? f.n : null })),
  };
}

const missingMaterial = (f) => f.rosterKnown !== false && f.signers.find((s) => s.local
  && (f.formed && !s.zec.has || s.sol?.missing));
const missingText = (s) => s ? "Signer " + s.id
  + " has signing material missing from this browser. Restore its matching recovery file; "
  + "joining alone does not make a signer available." : "";

function securityStatus(critical, unavailable, allChecked, concentrated) {
  if (critical) return { label: "Action needed", tone: "bad" };
  if (unavailable) return { label: "Status unavailable", tone: "neutral" };
  if (allChecked && !concentrated) return { label: "Recovery checked", tone: "ok" };
  return { label: "Attention recommended", tone: "warn" };
}

function nextAction(critical, missing, files, allChecked) {
  if (critical) return missing ? { kind: "restore", label: "Restore a signer" }
    : { kind: "setup", label: "Review wallet setup" };
  const save = files.find(needsSave);
  if (save) return { ...save, kind: "backup", label: "Back up wallet" };
  const check = files.find(needsCheck);
  if (check) return { ...check, kind: "check", label: "Verify a recovery file" };
  return { kind: "files", label: allChecked ? "Review recovery files" : "Review backup progress" };
}

function concentrationText(f, held, valid) {
  if (held <= 1) return null;
  const all = held === 2 ? "Both signing shares are held in this browser."
    : "All " + held + " signing shares are held in this browser.";
  return {
    title: held === f.n ? all : held + " signing shares are held in this browser.",
    detail: (valid && held > f.n - f.t
      ? "Losing access to this browser could prevent payments. "
      : "These shares share one storage environment. ")
      + "Keep independent recovery copies of each share and protect their separate passphrases.",
  };
}

export function deriveSecurityDashboard(f) {
  const valid = validRule(f.n, f.t);
  const chains = f.solScope === "ready" ? ["zec", "sol"] : ["zec"];
  const files = f.signers.flatMap((s) => chains.map((chain) => ({ ...s[chain],
    id: s.id, chain, local: s.local })));
  const counts = recoveryCounts(f, valid, files, chains);
  const held = f.signers.filter((s) => s.local && s.zec.has).length;
  const concentrated = held > 1, missing = missingMaterial(f);
  const critical = f.blocked || missingText(missing);
  return { valid, ...counts, held, concentrated, critical,
    ...securityStatus(critical, counts.unavailable, counts.allChecked, concentrated),
    concentration: concentrationText(f, held, valid),
    next: nextAction(critical, missing, files, counts.allChecked),
    rule: valid ? f.t + " of " + f.n + " required" : "Rule unavailable" };
}

function remoteFileStatus(file) {
  if (!file?.reported) return "Not reported";
  if (file.checked) return "Reported checked";
  return file.saved ? "Reported saved · not checked" : "No file reported saved";
}

function localFileStatus(file) {
  if (!file?.has) return "Share not ready";
  if (file.checked) return "Checked in this browser";
  if (!file.saved) return "Not saved or checked";
  return file.restored ? "Restored · not checked" : "Saved · not checked";
}

export function recoveryFileStatus(file, local) {
  if (file?.unknown) return file.failed ? "Status unavailable" : "Reading status…";
  if (file?.missing) return "Share missing here";
  return local ? localFileStatus(file) : remoteFileStatus(file);
}

function localSignerStatus(files) {
  if (files.some((f) => f.unknown)) return ["Status unavailable", "neutral"];
  if (files.some((f) => !f.has)) return ["Share not ready", "neutral"];
  if (files.every((f) => f.checked)) return ["Files checked", "ok"];
  return files.some((f) => !f.saved) ? ["Backup needed", "warn"]
    : ["File check available", "neutral"];
}

function remoteSignerStatus(files) {
  if (files.every((f) => f.reported && f.checked)) return ["Reported checked", "neutral"];
  return [files.some((f) => f.reported) ? "Progress reported" : "Status not reported", "neutral"];
}

export function signerRecoveryStatus(s) {
  const files = [s.zec, s.sol].filter(Boolean);
  if (s.rosterUnknown) return ["Reading signer…", "neutral"];
  if (files.some((f) => f.missing)) return ["Share missing", "bad"];
  return s.local ? localSignerStatus(files) : remoteSignerStatus(files);
}
