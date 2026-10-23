# Premium web visual and motion delivery

Implements the revised Visual Design Master Guide over visual baseline
`c5a78762030a67a17889fe437e32b0c839445296`. Main remains the technical reference at
`3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`, fetched again during final validation.
This iteration changes presentation only. Earlier explicitly approved technical additions are
documented in the [existing delivery](web-prd.md) and [technical review](ux-ui-final-technical-review.md).
No native files, wallet models, payment calculations, protocols, authentication handlers,
backend services, wallet storage or recovery formats change in this iteration.

## Visual system

`web/design-system.css` supplies shared semantic colours, material, spacing, typography, geometry
and timing tokens. `web/app.css` applies them to existing components and preference fallbacks.
The latest guide's graphite palette supersedes the retained v1 dark palette. Light and system
themes retain the same preference handler and storage; Appearance is only in Settings.

The shell uses a 240px sidebar, 1120px content limit and 48/32/20px responsive gutters, with
16px permitted at 320px. Body text is 16/24px; essential notices are at least 14/20px. Welcome
and total typography is 44/50px on desktop, 34/40px and 36/42px on narrow screens. Asset values
use 32/40px and 28/36px. Exact formatting remains owned by existing calculations. All existing
48px control targets are retained, with static focus outlines and shared rest/hover/press,
disabled, pending and error treatments.

Welcome now has one heading and a roughly 60/40 desktop composition. Actions immediately
follow the introduction; test-network and audit context remain adjacent. The quiet explanation
row and full privacy disclosures follow. The decorative graphite plate is 220px on desktop,
128px in stacked layouts, and follows actions and essential notices on mobile. It uses the
unchanged supplied zebra PNG, including the red eye and number texture. No replacement artwork,
remote fonts, runtime dependencies or 3D library were added.

Balances, forms, payment reviews, recovery content and warnings are opaque. Existing floating
navigation uses a stronger tint and one blur layer, with opaque reduced-transparency,
unsupported-filter and forced-colour fallbacks. Metal edging belongs to the welcome plate.

## Motion and state integrity

`web/app-motion.js` observes primitive existing screen, wallet and dialog identities after the
existing renderer restores form values and focus. It never advances an operation. New contexts
can animate safe incoming headings; ordinary redraws settle immediately. Old wallet content is
never cloned or retained for an exit. Actions, focused controls, QR codes and their ancestors,
and material notices stay static. No animation callback invokes a wallet handler.

Timing tokens are 80ms press, 140ms hover, 160ms release, 180ms selection, 200ms dialog,
220ms content, 240ms completion and a 700ms brand highlight. The highlight runs once per tab
using only `zigs-ui-brand-arrived-v1` in session storage, with an in-memory fallback. There is
no decorative render loop or timer. Visibility and live reduced-motion changes immediately
settle effects without deferred replay.

Small hidden-from-accessibility marks observe actual device approvals, thresholds, passkey
pending/error/verified states, prepared wallets and ZEC on-chain transitions. First observation,
historical results, reopened reviews and unknown states stay settled. Solana nodes use actual
observed commitments; an inferred threshold never invents individual approvals. No new SOL
finality or continuous connection claim is animated.

ZEC has no explicit initial approval-snapshot-ready fact. Its first approval therefore stays
settled; later arrivals can animate only after a verified nonempty baseline. Completed,
packaged, checking and stopped sessions never produce approval-arrival effects. SOL markers
also wait for their existing snapshot and signature-verification state. This conservative
omission avoids celebrating historical data while retaining every status label and count.

## Screen coverage

| Existing surface | Presentation and evidence |
| --- | --- |
| Welcome, shell, menus | Single focal surface, canonical plate, quiet navigation, initial-viewport actions, desktop/mobile and all theme variants. |
| Create/join and guided setup | Shared fields, device diagrams, actual rule/status labels, optional backup summary, passkey pending/error/disabled states and all thirty comparison digits. |
| Overview and assets | Total/action hierarchy, exact opaque amounts, asset icons, Pending/Recent, existing queue and unavailable USD/USDC/Swap/privacy ratios. |
| Approvals and payment review | Existing warning-first hierarchy, device approval marks, lifecycle distinctions, costs, recipient/memo details, opaque review surfaces and long-amount wrapping. |
| Send/Receive | Existing asset selection, labelled controls, full destinations, privacy/cost guidance and static QR backing. |
| Activity, Address book, Chats | Shared rows, inputs, headings, empty/disabled states and existing sidebar destinations. |
| Security & Recovery, Settings | Device and file scope, optional recovery, replacement warnings, controls and dark/light/system preferences. |
| Help, locks, backup/restore and utility dialogs | Shared opaque surfaces, notices, controls, focus and existing dismissal/validation behavior; covered by the actual renderer journey and Node fixtures. |

P0 foundations and critical screens and applicable P1 utility surfaces use the same components.
No unavailable product capability was added to fill the coverage matrix.

## Validation and evidence

Both phases use fresh synthetic stores and isolated servers. The frozen baseline is an archive
of C5, not the original dirty checkout. Actual unfunded ceremonies and virtual authenticators
exercise setup and navigation. Blocked/expired payment review fixtures use real renderers but
are inert; accepted-review, signing, fees and safeguards are tested by existing Node rigs.

| Check | Result |
| --- | --- |
| Before actual browser journey | 830 checks, 179 captures, zero browser errors. |
| After actual browser journey | 830 checks, 179 captures, zero browser errors. |
| Before additional visual matrix | 603 checks, 17 captures, zero errors; four baseline notes record mobile entry below the fold. |
| After additional visual matrix | 723 checks, 17 captures, zero errors: 213 welcome checks and 510 sample checks across ten screens. |
| Node 24 regressions | All 50 registered commands pass; isolated worker limits also pass. Final baseline checker: 51 tests, 19 protected files, zero problems. Affected app and SOL app retests pass after final motion guards. |
| Strict lint | 172 JavaScript and 2 Python files pass. |
| Sample preservation | Five server/sanitizer tests pass. Final synthetic build checks pass and snapshots are regenerated. |
| Rendered matrix | 320, 390, 768, 1024, 1440, 1920px; dark/light/system, both system schemes, enlarged text, forced colours and reduced preferences. |
| Keyboard and state | Join focus/typed values, Settings handler, dialog focus containment/return, navigation and unchanged disabled actions pass. |
| Motion checks | Twelve focused unit cases plus actual-browser redraw, interruption, preference, input, local action and static-QR probes pass. |
| Static notices | Twelve real error-toast cases across both themes and six widths pass static text, 14px notices, overflow, 48px targets and keyboard close. |
| Contrast | 54 static text pairs, four essential-control combinations, six transient heading pairs and 36 transient mark pairs pass in each theme. The new regression checks read actual CSS opacity. |
| QR scan fixture | Existing encoder renders 220px codes with white backing/quiet zone; dark/light before/after PNGs decode the exact safe payload with ZXing-C++ 3.1.1. |

Final results and the isolation audit are recorded in
[the final report](web-premium-final-validation.json). The original checkout's HEAD, status and
828 file hashes are preserved; native paths match main. All 392 PNG captures have no identifying
metadata, and four recordings have only generic encoder/duration tags. Screenshots mask QR,
secrets, comparison numbers and password/file
fields. The sample is an inert **2-of-3 Test wallet**, not a real funded account.

Reports: [before journey](web-premium-before-validation.json),
[after journey](web-premium-after-validation.json),
[before visual matrix](web-premium-before-visual-validation.json),
[after visual matrix](web-premium-after-visual-validation.json),
[before performance](web-premium-before-performance.json),
[after performance](web-premium-after-performance.json).

### Matching representative captures

| View | Before | After |
| --- | --- | --- |
| Desktop welcome | [Before](visuals/web-premium/before/45-welcome-1440-dark.png) | [After](visuals/web-premium/after/45-welcome-1440-dark.png) |
| Mobile welcome | [Before](visuals/web-premium/before/45-welcome-390-dark.png) | [After](visuals/web-premium/after/45-welcome-390-dark.png) |
| Populated Overview | [Before](visuals/web-premium/before/06-overview-1440-dark.png) | [After](visuals/web-premium/after/06-overview-1440-dark.png) |
| Blocked ZEC review | [Before](visuals/web-premium/before/31-prd-zec-blocked-review-320-dark.png) | [After](visuals/web-premium/after/31-prd-zec-blocked-review-320-dark.png) |
| Desktop recording | [Before](visuals/web-premium/before/46-presentation-1440.webm) | [After](visuals/web-premium/after/46-presentation-1440.webm) |
| Mobile recording | [Before](visuals/web-premium/before/46-presentation-390.webm) | [After](visuals/web-premium/after/46-presentation-390.webm) |

Recordings replay sanitized actual welcome, populated Overview and blocked-review markup with
the actual presentation controller/styles. They demonstrate UI transitions, not live signing.

### Performance and calibration

Measured on Apple M3 Max (Mac15,8), headless Chrome 155.0.8059.85, at 390x900 and 1440x900.
Three trials per width/phase use the same isolated sanitized sequence, 179 frame gaps each.
Before: 99.4–100% within 20ms. Final after: 100%, p95 16.7–16.8ms, in all six trials.
Both phases record zero presentation long tasks, zero layout shift and no perpetual decorative
loop. The baseline video trial's 166.7ms gap is included in its reported distribution.
Initial JavaScript gzip increases from 275,792 to 278,980 bytes: **3,188 bytes**, below 50KiB.
Production JavaScript and CSS gzip increases by 5,523 bytes in total.
The existing logo bytes are unchanged and no new vector asset is needed.

Documented calibration choices: muted dark text is #9298A2 rather than #858B95 to preserve
contrast on raised surfaces; glass is 94% tinted rather than the illustrative 74%; the supplied
raster remains a flat mark on the plate; incoming motion targets safe headings/marks rather
than entire finance/dialog surfaces. No outgoing content effect is used. All retain the visual
intent while keeping critical content static. The earlier local test's detached-element race
was fixed by measuring visibility and dimensions atomically; no layout requirement was relaxed.
Entrance opacity starts at .75 for headings and .80 for marks to preserve contrast throughout
the transition: measured minima are 6.88:1/7.96:1 for light/dark headings and 3.58:1/4.36:1 for
status marks across the six opaque token surfaces. Amounts, QR codes, warnings and controls
stay static.

Acceptance V1–V6, M1–M5, R1–R3, B1–B2 and P1 is supported by these source, renderer, browser,
contrast and timing checks within their stated limits. Representative rendered inspection is
not a claim of independent human judgment of every capture or a full accessibility audit.

## Limits and deferred work

Physical phone performance, software keyboards, VoiceOver/screen readers, hardware passkeys,
provider sync and low-end devices remain untested. Mobile coverage is browser emulation.
No funded payment, live RPC/prover, new service reliability claim or native result is asserted.
Hosted web/lint status is reported separately on the PR. No merge or deployment is authorized.

Continuous trusted connection indicators, new identity/invitation lifecycles, recovery formats,
authentication policy, funding gates, pricing, swaps, USDC, threshold-one wallets and shorter
safety comparisons remain separate [engineering review](ux-ui-final-technical-review.md).
