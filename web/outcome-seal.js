// Presentation only. Callers supply the selected existing headline stage, never raw session
// status or a decorative completion flag. Static marks cannot replay on rerender/navigation.
const KINDS = {
  approved: "threshold", sent: "submitted", sentUnsynced: "submitted", landed: "included",
  ended: "attention", endedSigned: "attention", check: "attention", held: "attention",
  sentStopped: "attention", stopped: "attention", error: "attention", rejected: "attention",
  refused: "attention", signingLost: "attention", approvalLost: "attention",
  approvalChanged: "attention", mismatch: "attention", wrongMove: "attention",
  resend: "attention", late: "attention", sendFailed: "attention",
};
const GLYPHS = {
  threshold: "M7 8h10M7 12h10M7 16h6",
  submitted: "M6 18 18 6M7 6h11v11",
  included: "m6 12 4 4 8-8",
  setup: "m6 12 4 4 8-8",
  attention: "M12 6v7M12 17h.01",
  pending: "M7 12h.01M12 12h.01M17 12h.01",
};
const node = (tag, cls, text) => {
  const n = document.createElement(tag);
  n.className = cls;
  if (text !== undefined) n.append(document.createTextNode(text));
  return n;
};

/** A decorative 44px mark. Meaning always lives in adjacent visible text. */
export function outcomeSeal(kind) {
  const safe = Object.hasOwn(GLYPHS, kind) ? kind : "pending";
  const seal = node("span", "outcome-seal outcome-seal--" + safe);
  seal.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round",
    "stroke-linejoin": "round", focusable: "false" })) svg.setAttribute(key, value);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", GLYPHS[safe]);
  svg.append(path); seal.append(svg);
  return seal;
}

/** Use stageHeadline's winning stage so errors/expiry/refusals keep their existing precedence. */
export function outcomePanel({ stage, title, detail }) {
  const kind = Object.hasOwn(KINDS, stage) ? KINDS[stage] : "pending";
  const panel = node("div", "pay-status");
  panel.setAttribute("data-outcome-kind", kind);
  const copy = node("div", "outcome-copy");
  copy.append(node("h3", "", title), node("p", "small muted", detail));
  panel.append(outcomeSeal(kind), copy);
  return panel;
}
