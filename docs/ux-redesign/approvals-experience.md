# Premium Approvals experience

Implemented on `codex/approvals`, branched from `codex/ux-navigation` at `a0dbfbb`.
Technical reference: fetched `origin/main` at
`3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`. Web presentation only.

## Result

- A compact Approvals header retains the active wallet, network and wallet switcher. The
  configured rule and joined-device facts move into a dedicated shared-control surface.
- The empty queue uses a neutral device motif and a compact graphite surface. Loading,
  failed reads, sync, ignored records and the Zcash-only scope retain separate explanations.
  This queue includes other participants and network waits, so its supporting copy says so.
- Existing review, ready, waiting and attention buckets remain authoritative. Zcash request
  cards emphasize the actual proposed amount, recipient summary, network, proposer and age.
  Review transaction opens the existing drawer; there is no condensed-card signing action.
  Existing payment status labels and lost-approval holds remain visible.
- `SignerNode`, `SignerConnection`, `ThresholdIndicator` and `SharedControlVisual` reuse a
  restrained hardware-like visual grammar. Configuration nodes remain neutral. Joined records
  do not imply online presence or transaction approval. Two-, three- and seven-device examples
  were checked. Longer participant sets can use a textual fallback.
- The existing `ApprovalVisualization` displays checked approval records separately from
  combined signatures, proof, submission and block inclusion. It uses individual nodes only
  when its supplied count and device records agree; otherwise it keeps its aggregate fallback.
  An empty map cannot establish a verified zero before the first snapshot, so that case now
  says count unavailable without changing any signing predicate.
- The transaction review puts the exact wallet outflow and full recipient before longer cost
  and privacy disclosures. All existing material warnings, recipient checks, fee calculations,
  cancellation, authentication and authorisation controls remain. Verify before signing is
  shown in the review itself. Existing outcome stages retain distinct visual treatment.
- Solana requests receive matching review-card styling using the adapter's real title and
  proposer. Review in Solana opens the existing Solana proposal flow. Missing structured
  amounts, per-device progress and historical outcomes are not inferred.
- Opaque financial surfaces, satin device edges, restrained orange and glass header chrome
  use existing tokens. Hover/press transitions are short; contribution effects continue to
  use the existing event guards. No idle pulses, fake timers or new motion state are introduced.

The module list now registers the existing approval, outcome and setup-preview modules so the
module-graph check passes. The existing outcome-seal regression is registered in both test
lists. Two existing application assertions were updated for the new copy and count element.
Pre-existing stylesheet and import-order edits were preserved.

## Five-pass log and design review

1. Captured the production renderers before editing; rebuilt the page hierarchy and empty state.
2. Added shared-control composition using the actual rule and existing device records.
3. Added request cards and refined the full transaction-review information order.
4. Reused real outcome/motion evidence and added reduced-motion/forced-color treatments.
5. Reviewed rendered desktop/mobile, dark/light and stress states. The five largest findings
   were an empty-state icon resembling success, an over-tall mobile header, history preceding
   shared control, the review amount buried below explanatory text, and an unknown initial
   approval count appearing as zero. The first three were fixed in the final visual refinement;
   the review order and unknown-count treatment were also corrected for readability/accuracy.
   Final captures were reviewed after those changes; no open-ended refinement loop followed.

## Evidence

All screens use production presentation modules with clearly labelled synthetic data in fresh
Chromium contexts. App boot and scheduled redraw are suppressed; external requests are blocked.
No funded wallet, real key material, live signing or transaction broadcast is involved.

| State | Before desktop | After desktop | Mobile |
| --- | --- | --- | --- |
| Empty | [1440 dark](visuals/approvals-experience/before/empty-1440-dark.png) | [1440 dark](visuals/approvals-experience/after/empty-1440-dark.png) | [390 dark](visuals/approvals-experience/after/empty-390-dark.png) |
| Needs your approval | [1440 dark](visuals/approvals-experience/before/request-1440-dark.png) | [1440 dark](visuals/approvals-experience/after/request-1440-dark.png) | [390 dark](visuals/approvals-experience/after/request-390-dark.png) |
| Waiting | [1440 dark](visuals/approvals-experience/before/waiting-1440-dark.png) | [1440 dark](visuals/approvals-experience/after/waiting-1440-dark.png) | [390 dark](visuals/approvals-experience/after/waiting-390-dark.png) |
| Transaction review | [1440 dark](visuals/approvals-experience/before/review-1440-dark.png) | [1440 dark](visuals/approvals-experience/after/review-1440-dark.png) | [390 dark](visuals/approvals-experience/after/review-390-dark.png) |
| Recorded approvals | [1440 dark](visuals/approvals-experience/before/review-progress-1440-dark.png) | [1440 dark](visuals/approvals-experience/after/review-progress-1440-dark.png) | [390 dark](visuals/approvals-experience/after/review-progress-390-dark.png) |
| In a block | [1440 dark](visuals/approvals-experience/before/completed-1440-dark.png) | [1440 dark](visuals/approvals-experience/after/completed-1440-dark.png) | [390 dark](visuals/approvals-experience/after/completed-390-dark.png) |

Additional evidence: [light theme](visuals/approvals-experience/after/request-1440-light.png),
[1280 desktop](visuals/approvals-experience/after/multiple-1280-dark.png),
[768 tablet](visuals/approvals-experience/after/multiple-768-dark.png),
[mobile shared control](visuals/approvals-experience/after/request-shared-control-390-dark.png),
[seven devices](visuals/approvals-experience/after/devices-7-390-dark.png),
[failed read](visuals/approvals-experience/after/failed-390-dark.png),
[stopped payment](visuals/approvals-experience/after/review-failed-390-dark.png),
[forced colors](visuals/approvals-experience/after/forced-colors-390-dark.png).
The progress images require scrolling within the existing drawer; its footer remains accessible.

## Verification

- Full application regression: `web/test/app.mjs` passed on Node 24.
- Repository fast suite: **42 tests passed**; QR-specific check skipped because `qrencode` is
  unavailable. Includes approval bucket combinations, payment model, outcome precedence,
  motion, contrast, overview, storage, setup and module graph, including locked-vault loading.
- Browser harness: **51 checks passed**, 36 after screenshots and 14 matching before captures.
  Covers 1440/1280/768/390/320px, both themes, 200% text, long names, two/seven devices,
  exact recipient visibility, waiting/attention/unknown states, keyboard access, reduced motion,
  forced colors, no horizontal overflow and no uncaught errors.
- Changed production JavaScript and the browser harness pass their respective lint configs;
  whitespace checks pass. An esbuild browser bundle smoke check passes with the existing
  separately built WASM/Solana modules kept external. No native rebuild is applicable.
- [Source audit](approvals-experience-source-audit.json): 207 existing declarations outside the
  changed presentation functions and 1,269 other web source files remain byte-identical to the
  task baseline. Signing, custody, state models, persistence, API and authentication modules
  are unchanged.
- Browser results: [before](visuals/approvals-experience/before/validation.json),
  [after](visuals/approvals-experience/after/validation.json).

Reproduce the browser run with `node solspike/tools/approvals_experience_browser.mjs`.
`PLAYWRIGHT_MODULE` and `CHROME_EXECUTABLE` can select installed local tooling;
`ZIGS_APPROVALS_PHASE=before` and `ZIGS_APPROVALS_SOURCE` select a saved source baseline.

## Remaining dependencies

There is no durable per-device approval/refusal history or online-presence telemetry in this
UI contract. Activity remains the destination for stored payment outcomes. The inbox does not
load a verified approval snapshot for every payment; counts are shown only in the existing
payment review. A snapshot-ready signal would be needed to distinguish a verified zero from
an empty map before the first snapshot. Solana's inbox adapter supplies only id/title/proposer;
its existing full proposal review remains separate. These capabilities require engineering
review before adding new data, persistence or event semantics.

Live multi-device ceremonies, physical touch devices, screen-reader speech and funded chain
transactions were not exercised. No merge, push or deployment was performed.
