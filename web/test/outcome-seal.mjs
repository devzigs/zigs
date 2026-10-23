// Presentation regression cases: later/error stages must not inherit a threshold checkmark.
import assert from "node:assert/strict";
import { headlineFacts, stageHeadline } from "../payment-model.js";
import { outcomePanel, outcomeSeal } from "../outcome-seal.js";

class Element {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; }
  setAttribute(key, value) { this.attrs[key] = value; }
  append(...children) { this.children.push(...children); }
}
const original = globalThis.document;
globalThis.document = { createElement: (tag) => new Element(tag),
  createElementNS: (_, tag) => new Element(tag), createTextNode: (text) => ({ text }) };
try {
  const panel = (facts) => outcomePanel(stageHeadline(facts));
  const kind = (facts) => panel(facts).attrs["data-outcome-kind"];
  assert.equal(kind({ approved: true }), "threshold");
  assert.equal(kind({ sent: true, approved: true }), "submitted");
  assert.equal(kind({ sentUnsynced: true, sent: true }), "submitted");
  assert.equal(kind({ landed: true, sent: true }), "included");
  assert.equal(kind({}), "pending");
  // Approval counts alone never paint later signing/proof work as a completion.
  for (const stage of ["signing", "signed", "proving", "proved", "sendHere"])
    assert.equal(kind({ [stage]: true, approved: true }), "pending", stage);
  for (const stage of ["ended", "endedSigned", "check", "held", "sentStopped", "stopped",
    "error", "rejected", "refused", "signingLost", "approvalLost", "approvalChanged",
    "mismatch", "wrongMove", "resend", "late", "sendFailed"]) {
    assert.equal(kind({ [stage]: true, approved: true, sent: stage !== "late"
      && stage !== "sendFailed" && stage !== "resend" }), "attention", stage);
  }
  // Real synced inclusion keeps the existing model's precedence over a stale stop mark.
  assert.equal(kind({ landed: true, error: true }), "included");
  for (const stage of [...headlineFacts, "waiting"]) {
    const model = stageHeadline({ [stage]: true }), rendered = panel({ [stage]: true });
    assert.equal(rendered.children[1].children[0].children[0].text, model.title);
    assert.equal(rendered.children[1].children[1].children[0].text, model.detail);
    assert.equal(rendered.children[0].attrs["aria-hidden"], "true");
    assert.equal(rendered.attrs.role, undefined, "redraws do not reannounce a live region");
  }
  const invalid = outcomeSeal("confirmed");
  assert.equal(invalid.className, "outcome-seal outcome-seal--pending",
    "unsupported confirmation claims never get a completion mark");
  assert.equal(outcomeSeal("setup").attrs["aria-hidden"], "true");
  assert.equal(stageHeadline({ approved: true }).stage, "approved");
  assert.equal(stageHeadline({ sent: true, rejected: true }).stage, "rejected");
  console.log("outcome-seal: stage precedence, exact copy and accessible static marks passed");
} finally { globalThis.document = original; }
