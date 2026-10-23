# Zigs UI polish report

23 October 2026 · Latest pass: Compact default layout · Baseline `be093fd` plus existing local work

## Compact default layout

Swap follow-up: [composer and route cards](docs/ux-redesign/compact-swap.md) now fit alongside
the wallet header across all seven tested viewport sizes, in idle and populated quote states.
All 123 Swap browser checks, unit tests, contrast and CSS build checks pass. Preview notices,
privacy boundaries, action handlers and the 48px reverse-button target are preserved.

Follow-up: the [portfolio panel](docs/ux-redesign/smaller-portfolio.md) is now 175px rather than
298px, and assets no longer wait for the taller right column. All three assets fit at both
1440×728 and 1503×728. Fourteen responsive comparisons, 56 Overview checks, contrast and CSS
build checks pass. Balances, disclosures and handlers are unchanged.

Applied a coordinated compact scale through shared tokens and existing screen styles: 15px
desktop body text, 216px sidebar, smaller headings, 16–20px panels and tighter spacing. Phones
retain 16px body text and all tested controls meet 48px targets. Overview and Messages fit the
1440×900 viewport; longer settings/recovery content remains scrollable.

[Before/after screenshots, measurements and limitations](docs/ux-redesign/compact-default.md).
96 responsive cases, 659 entry checks, 52 Settings checks, 56 focused Overview checks and all
47 fast suites pass. CSS bundling, page lint and build dry-run pass. The separate unified-setup
Messages-heading assertion also fails with pre-change CSS; obsolete avatar tests are documented.
CSS only; existing local edits preserved. Neutral unsigned commit; no push, merge or deployment.

## Previous saved-wallet pass

## Compact saved-wallet entries

Replaced large saved-wallet cards with compact rows below the heading and zebra hero. The
unchanged zebra is present for both new and returning users. Status, balances, badges and
existing opening/setup handlers remain. Theme-aware surfaces and wrapping labels fit phones.

[Before/after screenshots and validation](docs/ux-redesign/compact-wallet-entry.md).
659 browser checks, unified-setup, changed-file lint and build dry-run pass. Fast tests retain
the baseline graph failure (41/42 pass). Web presentation only; no push, merge or deployment.

## Previous Overview pass

## Overview cleanup

Removed duplicate Devices & Recovery from Overview, moved its optional backup-progress notice
to Security & Recovery, and added quiet blank-list null states for pending approvals and recent
transactions. Settings retains its existing security destination. Unknown/error states and actual
payment rows remain unchanged.

[Before/after views and validation](docs/ux-redesign/overview-empty.md).
40 browser checks, unified-setup, changed-file lint and build dry-run pass. The fast suite retains
the baseline graph failure (41/42 executed suites pass). No wallet/security or native changes.

## Previous component pass

## Controls, glass and micro-interactions

Unified shared button finishes and focus rings, separated page selection from wallet context,
refined the existing glass switcher with opaque rows and genuine-input entrances, added a guarded
native explanation reveal, and strengthened actual Browser status errors. A single refinement
positions the switcher before its first paint. Wallet/security behavior is preserved.

[Before/after views, interaction recording and verification](docs/ux-redesign/components-glass.md).
124 targeted browser checks and 575 existing journey checks pass, alongside motion, contrast,
unified-setup, page lint and build dry-run. The fast suite retains the baseline graph failure
(41/42 executed suites pass); repository lint has unrelated existing findings. Web only;
no native changes, push, merge or deployment.

## Previous emblem pass

## Metallic identity and lighting

Added a reusable decorative emblem with layered satin edging, recessed graphite, restrained
ambient lighting and unchanged zebra artwork. Preserved hero composition and wallet behavior.
One refinement tightened the phone shadow and corrected hidden-tab transition interruption.

[Natural-size comparisons and validation](docs/ux-redesign/metallic-identity.md).
44 browser checks, 16 motion tests, contrast, unified-setup, changed-file lint and build dry-run pass.
The fast suite passes 41/42 executed suites; the baseline graph import-list mismatch remains.
Full repository lint has unrelated existing failures. No native changes, merge or deployment.

## Previous hero pass

## Hero composition and copy

Applied the preferred copy and closer hero grid, removed repeated labels/caption, placed release
context beside recovery, and exposed one/many saved wallets as direct entry cards. Existing wallet
handlers, loading/locked guards and security behavior remain unchanged.

[Before/after views, copy review and validation](docs/ux-redesign/hero-composition-copy.md).
575 entry checks, 19 state checks, 42 Node 24 suites, unified-setup and the dry-run pass.
Page/core harness lint passes; existing repository lint failures remain documented. No merge,
deployment or native changes. The referenced design-rules file was unavailable; established rules
and tokens were retained.

## Previous threshold pass

## Threshold refinement

Restored the orange illustrative signer groups, added large minus/plus counters and paired them
with the diagram in a compact left/right desktop layout. Phones stack compactly. All 21 supported
arrangements preserve exact device/approval counts and existing validation.

[Before/after views, animation and validation](docs/ux-redesign/threshold-refinement.md).
74 browser checks, 42 Node 24 fast suites, unified-setup, 16 motion tests, changed-file lint and
the dry-run pass. Full repository lint has existing failures in unrelated files; QR remains skipped.
Wallet/security logic and native apps are unchanged. No merge or deployment.

## Previous landing pass

## Completed

Distinct new/returning landing layouts, the approved copy and secondary entry utilities, an anchored
glass wallet dropdown, refined unchanged-zebra object, scoped satin controls, quieter shared sidebar
and Browser status disclosure. Existing wallet actions, security gates and warning behavior remain.
One refinement fixed tablet overflow and enlarged-text overlap.

[Before/after screenshots and detailed validation](docs/ux-redesign/landing-refinement.md)

## Validation

120 matched landing captures plus 16 matched shared-sidebar views; 782 existing journey checks,
32 targeted browser checks and engine-failure assertions passed. All 41 Node 24 fast suites,
unified-setup, 16 motion tests, contrast, strict lint and the tracked-assets-only dry-run passed.
The refreshed Test wallet build passed 32 checks. Existing previews remain on ports 8792 and 8793.
An isolated preview of this exact commit is available on port 55846.

## Limits

QR regression skipped because qrencode is unavailable. Physical phones, Safari, assistive technology,
software keyboards and live funded payments remain untested. Enlarged/expanded content may scroll.
Ordinary redraws settle decorative motion and can interrupt the initial brand effect. Performance
results are from isolated local Chrome fixtures. No new runtime dependencies were introduced.

Wallet logic, cryptography, signing, authentication, APIs, persistence and native apps are unchanged.
Unrelated working-tree changes were excluded. No merge or deployment.

Earlier coverage: [welcome/setup pass](docs/ux-redesign/welcome-setup-refinement.md) and
[application quality register](docs/ux-redesign/final-quality-coverage.md).
