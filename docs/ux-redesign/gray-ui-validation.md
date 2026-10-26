# Gray UI — design migration validation

25 October 2026 · `gray-ui` · main baseline
`c6860f6fef9351531bd3a9c3a221600c49651035`.

This records the migration snapshot at `825bf96`. The subsequent motion and interaction
refinement has a separate [page-by-page review and validation](gray-ui-premium-review.md).
Its deliberate icon and resource additions extend that snapshot; the original source hashes
remain provenance records rather than a claim of current byte-for-byte parity.

## Delivered web design

Migrated the later **uncommitted design working copy** of `codex/ux-ui-final`, based on
`78345496bb6438e22bfdbfbc484105df84c18c0d`. Comparing only its remote commit omitted this work.
The [source manifest](gray-ui-design-source.json) pins all 24 web design files and the
[PRD](gray-ui-prd.md) describes their acceptance criteria.

- Locally hosted Manrope, editorial heading weights/tracking, tabular amounts and preserved
  Geist Mono technical text.
- Neutral dark/light surfaces, refined borders/shadows, controls and dialogs, with the
  original warm orange actions, selections and copper hero atmosphere.
- White fingerprint zebra web branding, header plate, PNG/ICO/touch icons and versioned
  references; original number-textured hero zebra retained as its own unchanged asset.
- Application-wide styling across navigation, setup, Overview, Approvals, Activity,
  Address book, Messages, Security, Settings and dialogs.
- Five illustrated educational journeys, twenty selectable steps, relief icons, sculpted
  artwork, complete ten-chapter reference, responsive chapter picker and reading layout.
- Document-local guide reading/motion state, keyboard selection, pause/resume, reduced
  motion, offscreen/hidden pausing and focus restoration.

Twenty design files match the source byte for byte; the font license and guide-icon module
only normalize whitespace (license wording and JavaScript unchanged). `app-shell.js` receives only the
hero-image reference change over main. `index.html` combines the reference's presentation
resources with main's early theme initialization. Source working-copy hashes remain unchanged.

The source's two visual QA scripts are retained under `solspike/tools/`, with formatting
and helper extraction to meet main's existing lint rules. All assertions remain enabled.
No existing test, lint configuration, test-runner list or dependency lockfile was changed.

## Checks actually run

| Check | Result |
| --- | --- |
| Original design browser harness on original working copy | **511 checks passed**, 31 captures. All requests confined to isolated fixture origin; outputs only in temporary review storage. |
| Same harness on migrated Gray UI | **511 checks passed**, 31 captures, including a repeat after adapting only the QA script to main's lint rules. [Report](visuals/gray-ui-web/browser-report.json). |
| Actual Chrome page zoom | **100% and 200% passed**, disposable profiles; measured CSS viewport ratio, guide overflow, reachable close control and focus return. [Measurements](visuals/gray-ui-web/browser-zoom.json). |
| Existing main fast suite, Node 26.12.1 | **48 tests passed in 10 seconds.** QR test skipped because `qrencode` is not installed. |
| Existing `bash solspike/lint.sh` | **Passed: 238 JavaScript files and 2 Python files.** No lint exemptions or rule changes. |
| Paired functional render captures | **32 before + 32 migrated + 32 original-reference variants**, same synthetic fixtures, dark/light themes, 390/1440 widths, Home and all seven functional destinations. Runtime Manrope/background/no-overflow facts match the design reference for all 32 variants. [Metrics](visuals/gray-ui-web/functional-metrics.json). |
| Responsive browser matrix | Seven functional destinations at 320/390/768/1440 in both themes; guide at 320/390/768/1024/1440, plus short-window and forced-color checks. No horizontal overflow in the tested variants. |
| Guide interactions and content | Five journeys, twenty steps, all ten current-main chapters, preserved paragraphs/tables/glossary, keyboard navigation, selected chapter/step across redraw, pause/reduced motion, Escape dismissal and opener focus return passed. Wallet data, local storage and URL fragments unchanged by guide interactions. |
| Composed runtime palette | Tested normal text/status/button combinations meet 4.5:1; tested field edges meet 3:1. Both themes checked after the refinement sheet is applied. |
| Actual local application | Browser loads Manrope; stylesheet, both fonts, logo, PNG/ICO/touch icon and retained hero return HTTP 200. No browser console/page errors observed. |
| Artwork/provenance | Web logo 1000×1000, PNG favicon 32×32, touch icon 180×180, source hashes match; no EXIF/text metadata in these PNGs. Hero byte-identical to main's former logo. Font license retained. |
| Source/scope/attribution | 24 source files accounted for and preserved; main engineering and full guide content unchanged; native initial port unchanged. `git diff --check` and anonymous identity check pass. [Scope audit](gray-ui-scope-audit.json). |

Visual inspection covered the before/after homepage, new guide and phone reference, and
representative Overview, Approvals, Activity, Address book, Messages, Security and Settings
screens. Font weights, neutral surfaces, orange selection, branding and responsive reading
layout follow the actual design working copy. Main's independent disclosures/layout fixes
are intentionally retained; these are not pixel-equality claims for older copy or behavior.

## Selected visual evidence

| Area | Capture |
| --- | --- |
| Homepage before migration | [Before](visuals/gray-ui-web/before-home-dark.png) |
| Homepage after migration | [After](visuals/gray-ui-web/after-home-dark.png) |
| New guide journeys | [Dark desktop](visuals/gray-ui-web/after-journeys-dark.png) |
| Complete guide | [Light phone](visuals/gray-ui-web/after-reference-phone.png) |
| Overview | [Dark phone](visuals/gray-ui-web/after-overview-phone.png) |
| Approvals | [Dark desktop](visuals/gray-ui-web/after-approvals-dark.png) |
| Activity | [Light phone](visuals/gray-ui-web/after-activity-phone.png) |
| Address book | [Dark desktop](visuals/gray-ui-web/after-address-book-dark.png) |
| Messages | [Light desktop](visuals/gray-ui-web/after-messages-light.png) |
| Security | [Light phone](visuals/gray-ui-web/after-security-phone.png) |
| Settings | [Dark desktop](visuals/gray-ui-web/after-settings-dark.png) |

## Existing native changes and limits

The independent native walkthrough/post-formation views from initial Gray UI commit
`d944b745` remain unchanged. Their 200 fixture captures (45 for the added views) and six
selected images remain recorded in [the native manifest](gray-ui-native-captures.json).
Production Swift sources also passed macOS typechecking with complete concurrency checks
and warnings as errors. That is not a linked application, iOS simulator or physical-device
certification. Native funding/Swap runtime remains deferred in the technical review.

All operational screenshots and interaction tests use isolated synthetic fixtures, without
funded wallet actions or external service requests. Live transfers, physical devices,
assistive-technology sessions and the long baseline/mutation suites were not run. The QR
skip remains explicit. The pre-existing native core/build limitations remain.

No merge, automatic merge or deployment is part of this delivery. Work stays on `gray-ui`;
the original design working copy is preserved.

## Recurring backup reminder removal — 25 October 2026

Removed the automatic key-share/Solana backup banner from wallet pages and the funding demo,
and the account-backup reminder above account balances and on-chain conversations. Optional
account setup and conversation details retain concise, neutral recovery guidance. Security,
account actions, backup forms, error states and risky-action confirmations remain available.
No recovery state or underlying wallet operation changed.

- Node 26 fast suite: 48 tests passed; the independent QR decoder check remains skipped
  because `qrencode` is unavailable. The application and unified-setup regressions passed.
- Lint: 242 JavaScript files and 2 Python files passed; `git diff --check` and anonymous
  identity checks passed. The long baseline and mutation suites were not rerun.
- Browser review: 1,129 checks across 168 layouts and 50 composer focus variants passed,
  with no browser errors. A dedicated fixture held two unsaved local shares throughout;
  wallet pages had no automatic backup warning, manual Security exports remained present,
  and rendering/navigation did not mark shares saved. Conversation reminders were absent.
  External requests were blocked and no wallet operations were submitted.
- [Desktop capture](visuals/gray-ui-backup-reminders/overview-desktop.png),
  [phone capture](visuals/gray-ui-backup-reminders/overview-phone.png) and
  [browser results](visuals/gray-ui-backup-reminders/browser-report.json) use synthetic data.
- The existing local preview serves the updated wallet module. Work remains on `gray-ui`;
  no merge or deployment is part of this change.

## Privacy preview craft — 26 October 2026

Refined all four on-demand privacy-preview screens: offer, progress, camouflage and completion.
Restored the earlier headline and calmer tone, with the same explicit direct-connection
disclosure on every screen. The header identifies a preview throughout; it never claims
protected traffic. Main’s controller, optional entry, timing, cancellation and storage
behavior remain unchanged. The existing camouflage artwork and duration are preserved.

- Node 26 fast suite: all 48 tests passed in 9 seconds. The independent QR decoder test
  remains skipped because `qrencode` is unavailable. The first restricted run exposed an
  invalid page-module import; fixed by keeping the small icon renderer within the leaf
  module. Local stub-server checks passed on the subsequent permitted run.
- Focused browser review: 218 checks across 26 layouts passed, covering all four screens
  in both themes at 320, 390 and 1440 pixels; short windows, forced colors, reduced motion,
  keyboard containment, focus return, one-step dismissal, timer cancellation and unchanged
  storage. The normal-motion walkthrough retains the original four-step and camouflage timing.
- Existing premium browser review: 216 checks across 72 page/theme/width variants passed,
  including a single SVG close icon within a stationary 48-pixel target. Removed the former
  duplicate CSS close mark. Lint passed for 243 JavaScript and 2 Python files.
- [Focused results](visuals/gray-ui-privacy-craft/browser-report.json),
  [motion regression](visuals/gray-ui-privacy-craft/premium-regression.json),
  [offer](visuals/gray-ui-privacy-craft/offer-desktop.png),
  [progress](visuals/gray-ui-privacy-craft/progress-desktop.png),
  [camouflage](visuals/gray-ui-privacy-craft/camouflage-desktop.png),
  [completion](visuals/gray-ui-privacy-craft/completion-desktop.png) and
  [light phone](visuals/gray-ui-privacy-craft/offer-phone-light.png) use an isolated renderer
  fixture with synthetic data and external requests blocked. No wallet operations were submitted.
- Confirmed the local application serves the updated module and opened the refined offer
  for review. Anonymous identity and diff checks pass. No merge or deployment is included.

## Remove pointer-following light — 26 October 2026

Removed the panel spotlight handlers and cursor-responsive homepage lighting. Fixed surface
lighting, independent hero motion and ordinary button/icon hover feedback remain. The homepage
controller no longer attaches pointer listeners or samples cursor offsets. The existing
browser hover check now verifies that moving the pointer adds no panel glow or coordinates.

All 48 Node 26 fast tests passed in 9 seconds (QR decoder skipped: `qrencode` unavailable).
The 13 homepage motion checks and 216 browser checks across 72 page/theme/width variants
passed. Lint, anonymous identity and diff checks passed. Refreshed the actual local preview.
Saved on local `gray-ui`; remote publication remains blocked by the repository's read-only
access for the connected account. No main-branch integration or deployment is included.
