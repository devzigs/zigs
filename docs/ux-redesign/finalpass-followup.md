# Final-pass remaining issues — follow-up and publication checks

The original follow-up resolved validation failures on the combined local `codex/finalpass` working tree. Its full audit results and screenshots below describe that saved tree, including separately pending header work. The publication checks describe the isolated fixes applied on the newer UX/UI branch.

## Publication checks — 23 October 2026

Applied the isolated follow-up on UX/UI commit `22d7fa777127c189b17f9f829c96675d4f626efe`, preserving the newer compact privacy popup and zebra animation. Pending wallet-header implementation, naming, marble and concurrent payment changes are excluded. The header CSS is scoped preparation for that separate feature; its 663-case result below is local audit evidence, not verification of an enabled feature on the publication branch. The archived patch also retains that feature's local test adjustments for attribution.

Current publication checks pass: Node 24 fast suite (48 suites; QR decoding skipped without `qrencode`), application suite, longer unified setup suite, full lint (229 JavaScript / 2 Python files), 18 motion tests and snapshot-boundary tests. The current compact privacy popup passes 167 checks in Chrome and 167 in Playwright WebKit; Settings passes 52 checks across 14 viewport/theme cases. The full 1,566-cell matrix was not repeated on the newer publication base.

Integration fixes preserve the existing module graph contract by explicitly listing the already imported popup/camouflage modules in `app.js`, retain the current Security & Recovery label in setup assertions, and keep the newer theme bootstrap in the inert Settings fixture. Popup QA lint fixes retain the new demo entry, disclosures and animation checks.

[Publication measurements and screenshots](visuals/finalpass/followup-publication/) contain only synthetic data. WebKit remains a separate engine check, not physical Safari validation. No merge or deployment is included.

## Fixes and causes

- **Major presentation issue:** the newly integrated privacy control squeezed the selected wallet’s name into a vertical column at tablet widths. The persistent header now uses two rows below 1100px, gives the identity a full row, and wraps the connection controls within their available space. A readability assertion now accompanies the overflow checks. The shared header passes 663 route/theme/viewport checks, including 1024, 768, 390 and 320px.
- **Send-review test:** the test document’s generic stub returned an element for an absent Privacy & Network panel. Escape therefore dismissed a phantom panel instead of closing Send. The fake document now reports that panel as absent. The existing asynchronous close/reopen assertions pass with no changes to wallet/payment logic. Actual privacy-panel dismissal and focus restoration pass in Chrome and WebKit.
- **Longer setup test:** the Messages workspace and grouped Settings presentation had superseded its old heading, theme-option, Security-link and technical-disclosure assumptions. The recorder now supports the DOM methods used by those controls. Assertions retain the setup, recovery and payment safeguards and check the current named focus targets and actual option values.
- **Lint:** qualified the demo’s browser `MutationObserver`, corrected browser-fixture globals, separated complex presentation/test helpers, and wrapped long lines without changing the generated strings. The Python lint helper now supports the system Python’s older AST. No lint rule was disabled or relaxed.
- **Supplementary QA tooling:** updated old Join, Return home, sidebar switching, artwork, focus, touch-color and dialog-close selectors. Replaced assumptions about obsolete engraving, mandatory animation and background-page height with checks of the current presentation. Regenerated ten inert snapshots from a real unfunded local formation journey; aligned the snapshot checker with the sanitizer’s existing fixed local artwork whitelist. Its boundary checks still reject executable markup, live controls and external/data/blob image sources.

## Original combined-working-tree verification

| Check | Actual result |
| --- | --- |
| Node 24 `sh scripts/test-fast.sh` | 48 suites pass; QR decoding skipped because `qrencode` is unavailable. |
| `node web/test/app.mjs` | `app ok`. |
| `node web/test/unified-setup.mjs` | `unified-setup: ok`. |
| `bash solspike/lint.sh` | 228 JavaScript files and 2 Python files pass, including line length. |
| Snapshot export boundaries | Pass: fixed artwork accepted; external/executable inputs rejected. |
| Fresh browser matrix | 1,566 viewport/theme records across 208 suite/state entries; no detected overflow, unlabelled fields, undersized enabled controls or squeezed wallet names. |
| Real local journey | Unfunded three-device formation, optional protection, full safety-number checks, encrypted backup/read-only verification, recovery and navigation; zero uncaught browser errors. |
| Existing renderer suites | Activity 161; Approvals 51; Settings 52; Messages 145; receipts 108; Overview 70 checks pass. Updated persistent-header suite: 663 checks pass. |
| Privacy & Network | 201 checks in Chrome and 201 in Playwright WebKit, at 1440/1024/768/390px in light/dark themes. |
| Accessibility | 78 checks pass, including modal keyboard traversal, real Chrome 200% zoom, enlarged setup text, reduced motion and forced colors. |
| Additional presentation suites | Signature completion, security diagrams, branding, wallet navigation/cards, typography, compact completion, microinteractions, onboarding refinement and the isolated privacy preview pass. The longer onboarding presentation run passes 375 checks. |
| Type checking | No separate dedicated type-check command was found; existing import/static checks pass. |

The matrix was rerun after the header fix against the combined current working tree. WebKit results are separate engine smoke checks; they are not actual Safari or physical-device certification. Populated/funded outcomes remain clearly labelled renderer fixtures, not live transaction verification.

## Evidence and attribution

- [Current coverage](finalpass-followup-coverage.md) and [machine-readable measurements, source hashes and test results](finalpass-followup-validation.json).
- Matched phone Settings captures: [before](visuals/finalpass/followup-before/settings-390-dark.png) / [after](visuals/finalpass/followup/journey/settings-390-dark.png). Tablet reproduction: [before](visuals/finalpass/followup-before/settings-768-light.png); [current header renderer](visuals/finalpass/followup/header/settings-768-light.png).
- [Current Chrome privacy panel](visuals/finalpass/followup/privacy-chrome/panel-welcome-390-dark.png); [WebKit privacy panel](visuals/finalpass/followup/privacy-webkit/panel-welcome-390-dark.png).
- [Isolated follow-up source patch](finalpass-followup-changes.patch). It is relative to the preserved starting working files plus the published UX/UI base, rather than treating other pending work as part of this fix. Commit IDs alone do not describe that dirty baseline.

During the original local follow-up, the subbranch was fast-forwarded from `139d6eaa` to the published `ba65a44` base before this work, then the pending edits were reapplied without a merge commit. The complete original working-file archive, tracked patch and retained Git stash remain private/ignored. Earlier header, marble, naming and other concurrent edits remain preserved. Screenshots use synthetic or disposable unfunded data, mask sensitive regions where applicable, and have metadata stripped. Representative images are retained; measurements and SHA-256 hashes cover every matrix cell.

## Remaining issues

- **Blocker:** none observed in the audited, accessible web UI after these fixes; the previously reported lint/application/setup gates now pass.
- **Major:** none currently observed within this presentation-only scope.
- **Minor / validation limits:** QR decoding needs `qrencode`. Funded execution/finality, live Solana/prover services, real passkey providers, physical Safari/phones, software keyboards and assistive technology remain unverified. These results do not constitute unconditional release or wallet-engine certification.
