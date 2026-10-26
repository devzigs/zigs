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

## Restore steel-blue palette and Geist — 26 October 2026

Restored the original blue-black backgrounds, steel-blue surfaces and borders, silver-blue
secondary text, Geist interface font and Geist Mono technical text. Restored stronger heading
and control weights. The later neutral palette and Manrope overrides were removed; Geist is
preloaded using the existing local asset. Updated the premium panel/icon backgrounds to use
the shared palette tokens. The newer layouts, flow refinements, orange actions, canonical
branding and absence of pointer-following lighting remain intact.

- All 48 Node 26 fast tests passed in 8 seconds. QR decoder remains skipped because
  `qrencode` is unavailable. Lint and diff checks passed.
- Style review: 511 checks and 31 captures passed, including composed palette contrast,
  guide content/interactions and responsive dark/light layouts.
- Full UI review: 1,129 checks across 168 layouts and 50 composer focus variants passed.
- Privacy preview: 218 checks across 26 layouts passed with the restored Geist family.
- [Dark Overview](visuals/gray-ui-restored-blue/overview-dark.png) and
  [light phone](visuals/gray-ui-restored-blue/overview-phone-light.png) show synthetic data.
  Browser fixtures blocked external requests and submitted no wallet operations.
- Recorded the user’s new preference in the PRD and repository instructions so future
  styling passes retain the blue palette and earlier fonts. No engineering or native
  changes, main-branch integration or deployment are included.

## Give Messages the available space — 26 October 2026

Removed the fixed desktop chat-height subtraction and the extra workspace width cap.
Existing headers and toolbars now determine the remaining conversation height. Account
setup grows with the page; its complete form and actions are no longer confined to an
internally scrolling chat frame. Before an account exists, hide the empty conversation
column and let the setup use one full-width column. Preserve the inbox for existing accounts.
An individual network choice also uses the available form width instead of half a row.

The full browser review now explicitly selects Zcash for its setup scenario. It passed
1,141 checks across 168 layouts and 50 composer focus variants, including new checks for
unclipped setup/actions and keyboard reachability at 320, 390 and 1440 pixels in both themes.
All 48 Node 26 fast tests passed in 9 seconds; the QR decoder remains skipped because
`qrencode` is unavailable. Lint and diff checks passed. No account, funding or message was
submitted by the isolated synthetic browser fixtures.

[Desktop setup](visuals/gray-ui-messaging-space/setup-desktop.png) and
[phone setup](visuals/gray-ui-messaging-space/setup-phone.png) record the resulting layout.
The implementation changes presentation only. Account/network choices, safeguards, messages,
drafts, transport and storage behavior are unchanged. Work remains on local `gray-ui`; no
main-branch integration or deployment is included, and remote access remains read-only.

## Return to charcoal and Manrope — 26 October 2026

The user's latest preference supersedes the intervening blue/Geist restoration. Restored
exactly the previous charcoal/silver palette, warm neutral light theme, Manrope interface
font, lighter heading weights and local Manrope preload. Geist Mono remains for technical
text. The expanded messaging layout and removal of pointer-following light remain intact.
Updated the PRD and repository instructions to preserve this latest preference.

- All 48 Node 26 fast tests passed in 9 seconds. The QR decoder remains skipped because
  `qrencode` is unavailable. Lint, anonymous identity and diff checks passed.
- Style review: 511 checks and 31 captures passed, including composed palette contrast,
  guide interactions and responsive layouts in both themes.
- Full UI review: 1,141 checks across 168 layouts and 50 composer focus variants passed,
  including the complete, unclipped messaging account setup and reachable actions.
- Privacy preview: 218 checks across 26 layouts passed with Manrope typography.
- [Dark Overview](visuals/gray-ui-charcoal-manrope/overview-dark.png) and
  [expanded messaging setup](visuals/gray-ui-charcoal-manrope/messages-setup-dark.png)
  use synthetic fixture data. External requests were blocked; no wallet operations were
  submitted. Refreshed and visually checked the actual local preview as well.

The application change restores presentation files only. Messaging behavior, branding,
wallet logic and native code are unchanged. Work remains on local `gray-ui`; no merge or
deployment is included. Remote publication remains blocked by read-only repository access.

## Apply the approved icy-blue accent — 26 October 2026

The user selected Ice blue from six accent mockups and requested it throughout the app.
Applied `#A8C7EA` to the shared accent, primary actions, navigation, form selections, focus,
guides and privacy preview. Hover uses `#B9D4F1`, pressed controls use `#93B4DC`, and filled
accent labels use `#101821`. Light-surface links/focus use the readable darker `#315D89`,
with `#6686AA` primary-control edges. Both explicit and system light-theme tokens agree.

Replaced the separate orange homepage actions, threshold illustration, guide flow/overline,
button shadows, decorative ambient lighting and copper hero illumination. Removed the warm
chat surface tint; chats retain the neutral charcoal hierarchy and expanded layout. Preserved
Manrope, technical monospace text, motion timing, the absence of cursor-following light,
semantic status colours, original artwork/red eye and deterministic wallet identities.
No wallet behavior, account state, native code or assets changed.

- All 48 Node 26 fast tests passed in 9 seconds. The QR decoder remains skipped because
  `qrencode` is unavailable. Contrast coverage additionally checks glass over the actual accent;
  all existing stress backgrounds remain covered. Lint, identity and diff checks passed.
- Style review: 511 checks and 31 captures passed, including composed text/button/field
  contrast, guides and responsive layouts in both themes.
- Full UI review: 1,141 checks across 168 layouts and 50 composer focus variants passed,
  including expanded account setup, unclipped actions and keyboard reachability.
- Privacy review: 218 checks across 26 layouts passed, including all four screens,
  short windows, reduced motion, forced colours, focus, cancellation and unchanged storage.
- Premium review: 216 checks across 72 page/theme/width variants passed, including hover,
  fixed hit areas, relief icons and the absence of pointer-following portfolio light.
- [Live homepage](visuals/gray-ui-icy-blue/home-dark.png) and
  [live Messages](visuals/gray-ui-icy-blue/messages-dark.png) show the refreshed local app
  with no wallets or messaging account created. The
  [light setup](visuals/gray-ui-icy-blue/messages-light.png) and
  [privacy preview](visuals/gray-ui-icy-blue/privacy-dark.png) use isolated synthetic fixtures;
  external requests were blocked and no wallet operations were submitted.

Updated the PRD and repository instructions to record this approved accent. Saved on local
`gray-ui`; remote publication remains blocked by read-only repository access. No merge,
main-branch integration or deployment is included.

## Simplify the homepage — 26 October 2026

Removed the “How shared control works” box from the homepage hero and the leading shield
icon from its “How Zigs works” guide entry. The entry now uses a two-column text/arrow
layout. Its label, explanatory text, dialog action, keyboard focus and trailing arrow remain.
The original artwork, icy-blue accents and approval-rule education inside setup/the guide
are unchanged.

All 48 Node 26 fast tests passed in 9 seconds (independent QR decoder skipped because
`qrencode` is unavailable). The existing style review passed 511 checks with 31 captures;
lint, identity and diff checks passed. Refreshed the actual local application, opened and
closed the guide from the simplified entry, and confirmed focus returned to that entry.
[Live homepage](visuals/gray-ui-home-cleanup/home-dark.png) shows both removals.

Saved locally on `gray-ui`. No main-branch integration, merge or deployment is included.

## Remove recurring release notices — 26 October 2026

Removed the quoted “New wallets use test networks only”/“Zigs is not audited” homepage
footer and its repeated homepage badge, sidebar notice and guide-overview environment line.
The networks FAQ now gives the same network identities in neutral factual language.
The remaining privacy-preview pill uses the available masthead space without the former
release badge. Network labels and choices, supported networks, mainnet acknowledgements,
transaction/recovery errors and other underlying safeguards remain unchanged.

Updated the existing UI-copy expectations to verify that both empty and returning homepages,
and the shared sidebar, omit these recurring notices. All 48 Node 26 fast tests passed in
9 seconds; the independent QR decoder remains skipped because `qrencode` is unavailable.
The full UI review passed 1,141 checks across 168 layouts and 50 composer focus variants.
The style/guide review passed 511 checks with 31 captures. Lint, identity and diff checks
passed. Fixtures used synthetic state, blocked external requests and submitted no operations.

Refreshed the actual local app and confirmed the notices are absent from the homepage,
sidebar and guide header. The guide still opens and returns focus to its entry when closed.
[Live homepage](visuals/gray-ui-release-notices/home-dark.png) shows the resulting interface.
Updated the PRD and repository instructions so future UI passes retain this preference.
Saved on local `gray-ui`; no main-branch integration, merge or deployment is included.

## Remove Pause plan and the setup footer — 26 October 2026

Removed Pause plan, its unfinished-plan reminder, the corresponding Resume setup banner
and the optional in-tab paused-draft presentation. Header Close retains its existing reset
behavior. Back/Continue and current-step errors now sit inside the active setup panel.
The initial protection screen shows its existing protection/Skip choices; its duplicate
disabled Continue and repeated protection reminder are absent. Continuation still requires
the same confirmed protection choice, including explicit Skip confirmation when available.

Removed sticky/nested-scroll footer styling and its reserved reminder row. Kept field
heights and type sizes, aligned label/name inputs to the top, shortened duplicate network
copy, reduced oversized network cards and added compact spacing for short desktop windows.
The proposed-rule explanation now calls its blue outlines “highlighted” rather than orange.
No wallet creation, protection, approval, persistence, network choice or service-retry gate
was relaxed. Existing stale-submit, cancellation and actual formation regressions remain.

- All 48 Node 26 fast tests passed in 9 seconds; the independent QR decoder remains skipped
  because `qrencode` is unavailable. Updated only the existing UI expectations for absent
  pause/disabled-continuation controls; safeguard and real submission checks still pass.
- The UX browser review passed 572 checks across 156 state variants. The added measurements
  cover all four setup steps in both themes at 1366×768 and 1440×900: zero extra page/dialog
  scroll height in all 16 desktop cases. At 320/390 phone widths, the initial protection
  screen also fits; longer forms and expanded explanations retain accessible scrolling.
  No setup navigation introduces a separate scrolling footer or nested scroll area.
- Lint, identity and diff checks passed. Browser fixtures use synthetic data and block
  external requests; no operations were submitted by the visual review.
- [Live first screen](visuals/gray-ui-setup-no-pause/protection-live.png),
  [device details at 1366×768](visuals/gray-ui-setup-no-pause/device-desktop.png) and
  [phone first screen](visuals/gray-ui-setup-no-pause/protection-phone.png) show the cleanup.

Refreshed the actual local preview without creating an account or changing protection.
Updated repository instructions and the PRD to preserve the requested removal. Saved locally
on `gray-ui`; no main-branch integration, merge or deployment is included.
