// These assertions protect the meaning of recovery labels, not just their markup.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chapters } from "../how-zigs-works-content.js";
import { deriveSecurityDashboard as derive, recoveryFileStatus, signerRecoveryStatus }
  from "../security-dashboard-model.js";

const share = (extra = {}) => ({
  has: true, saved: false, checked: false, checkable: true, ...extra,
});
const signer = (id, extra = {}) => ({ id, local: true, joined: true,
  zec: share(), sol: share(), ...extra });
const facts = (extra = {}) => ({ n: 2, t: 2, formed: true, solScope: "ready",
  signers: [signer(1), signer(2)], ...extra });
let m = derive(facts());
assert.equal(m.total, 4);
assert.equal(m.checked, 0);
assert.equal(m.readiness, "Not established");
assert.equal(m.label, "Attention recommended");
assert.match(m.concentration.title, /Both signing shares/);
assert.equal(m.next.kind, "backup");
assert.equal(m.next.id, 1);
assert.equal(m.next.chain, "zec");

const saved = facts({ signers: [1, 2].map((id) => signer(id, {
  zec: share({ saved: true }), sol: share({ saved: true }),
})) });
m = derive(saved);
assert.equal(m.saved, 4);
assert.equal(m.checked, 0, "export is never promoted to a file check");
assert.equal(m.allChecked, false);
assert.equal(m.next.kind, "check");
assert.equal(recoveryFileStatus(saved.signers[0].zec, true), "Saved · not checked");
assert.equal(recoveryFileStatus(share({ saved: true, restored: true }), true),
  "Restored · not checked");

const checked = facts({ signers: [1, 2].map((id) => signer(id, {
  zec: share({ saved: true, checked: true }), sol: share({ saved: true, checked: true }),
})) });
m = derive(checked);
assert.equal(m.checked, 4);
assert.equal(m.allChecked, true);
assert.equal(m.readiness, "Files checked");
assert.equal(m.label, "Attention recommended", "browser concentration survives completed checks");
assert.ok(m.concentration);
assert.equal(m.next.kind, "files");
assert.equal(recoveryFileStatus(checked.signers[0].zec, true), "Checked in this browser");

const remote = signer(2, { local: false,
  zec: share({ saved: true, checked: true, reported: true }),
  sol: share({ saved: true, checked: true, reported: true }),
});
m = derive(facts({ signers: [checked.signers[0], remote] }));
assert.equal(m.checked, 2);
assert.equal(m.reported, 2);
assert.equal(m.saved, 2);
assert.equal(m.allChecked, false, "remote reports cannot establish local recovery checks");
assert.equal(m.concentrated, false);
assert.equal(recoveryFileStatus(remote.zec, false), "Reported checked");
assert.deepEqual(signerRecoveryStatus(remote), ["Reported checked", "neutral"]);
assert.equal(derive(facts({ signers: [signer(1), signer(2, { local: false })] })).critical, "",
  "a remote location or report being unknown does not mean a lost signer");

for (const solScope of ["pending", "unavailable", "stopped"]) {
  m = derive({ ...checked, solScope });
  assert.equal(m.total, null, solScope + ": no invented denominator");
  assert.equal(m.allChecked, false);
  assert.equal(m.checked, 2, "known Zcash checks remain visible");
  assert.equal(m.label, "Status unavailable");
}
assert.equal(derive({ ...checked, storageIssue: "Progress unreadable" }).allChecked, false);
assert.equal(derive({ ...checked, storageIssue: "Progress unreadable" }).label,
  "Status unavailable");
assert.equal(derive(facts({ formed: false })).total, null);
assert.equal(derive(facts({ rosterKnown: false })).label, "Status unavailable");
assert.equal(derive(facts({ rosterKnown: false })).total, null);
assert.equal(derive(facts({ n: 0, t: 0 })).total, null);
assert.equal(derive(facts({ n: 2, t: 1 })).rule, "Rule unavailable");

m = derive(facts({ signers: [
  signer(1, { sol: share({ has: false, missing: true }) }), signer(2),
] }));
assert.equal(m.label, "Action needed");
assert.equal(m.next.kind, "restore");
assert.match(m.critical, /^Device 1 has signing material missing/, "the lost device is a device");
assert.equal(m.next.label, "Restore a device", "the restore action says device");
assert.match(m.critical, /does not make a device available/);
assert.deepEqual(signerRecoveryStatus({ ...signer(1), rosterUnknown: true }),
  ["Reading device…", "neutral"], "the roster status says device");
assert.equal(recoveryFileStatus({ missing: true }, true), "Share missing here");
assert.equal(recoveryFileStatus({ unknown: true }, true), "Reading status…");
assert.equal(recoveryFileStatus({ unknown: true, failed: true }, true), "Status unavailable");
m = derive(facts({ blocked: "Devices made different keys" }));
assert.equal(m.label, "Action needed");
assert.equal(m.next.kind, "setup");

m = derive(facts({ n: 3, t: 2, solScope: "none",
  signers: [signer(1), signer(2), signer(3, { local: false })],
}));
assert.equal(m.total, 3);
assert.equal(m.rule, "2 of 3 required");
assert.match(m.concentration.title, /2 signing shares/);
assert.match(m.concentration.detail, /could prevent payments/);
for (let n = 2; n <= 7; n++) for (let t = 2; t <= n; t++) {
  const signers = Array.from({ length: n }, (_, i) => signer(i + 1));
  m = derive(facts({ n, t, signers }));
  assert.equal(m.total, n * 2);
  assert.equal(m.rule, t + " of " + n + " required");
  assert.equal(m.held, n);
}
const frozen = facts();
const before = JSON.stringify(frozen);
Object.freeze(frozen); frozen.signers.forEach(Object.freeze);
derive(frozen);
assert.equal(JSON.stringify(frozen), before, "presentation derivation does not mutate input facts");

// Visible text says "device", never "signer" or "seat". A quoted string of prose in these modules
// is visible text; a class name, a path or a key has no space. The guide may explain seats, so it
// and its diagrams are held to "signer" only.
const VISIBLE = ["app-security-dashboard.js", "security-dashboard-model.js", "app-tutorial.js",
  "zns-setup-preview.js", "funding-preview.js", "app-funding-preview.js", "app-swap-preview.js",
  "app-postquantum-swap-preview.js", "app-network-privacy.js", "network-privacy-popup.js"];
const QUOTED = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const SEAT_OR_SIGNER = /(?<![\w-])(signers?|seats?)(?![\w-])/i;
const SIGNER = /(?<![\w-])signers?(?![\w-])/i;
const prose = (file) => readFileSync(new URL("../" + file, import.meta.url), "utf8").split("\n")
  .filter((line) => !line.trimStart().startsWith("//"))
  .flatMap((line) => line.match(QUOTED) ?? []).filter((text) => text.includes(" "));
for (const file of VISIBLE) {
  const hits = prose(file).filter((text) => SEAT_OR_SIGNER.test(text));
  assert.deepEqual(hits, [], file + ": visible text says device, not signer or seat");
}
const guide = prose("how-zigs-works-diagrams.js").concat(JSON.stringify(chapters));
assert.deepEqual(guide.filter((text) => SIGNER.test(text)), [],
  "the guide says device, not signer (it may explain seats)");
assert.match(JSON.stringify(chapters), /"Seat"/, "the guide explains what a seat is");
assert.match(JSON.stringify(chapters), /recipients, amounts, memos and notes, and access/,
  "the guide says what a holder of the invite link reads");
console.log("security-dashboard: recovery labels, counts, risks, thresholds, device wording ok");
