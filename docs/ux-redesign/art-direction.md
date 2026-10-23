# Web art direction: ink, ivory and coral

This iteration recomposes Overview, welcome and supporting screens using all six visual
references in the revised Visual Design Master Guide. It introduces an ink workspace,
warm ivory focal surfaces and coral actions, with distinct primary and supporting regions.
Visual baseline: `273cc144cdef78a91e75f571c60e3ac9aece8cdf`. Technical reference remains main
`3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`, fetched again during implementation.

## Reference decisions

The actual artwork was inspected, rather than relying on the page descriptions. No reference
artwork, fictional financial data or new product capability is imported into Zigs.

| Reference | Applied visual lesson |
| --- | --- |
| [Ronas banking](https://dribbble.com/shots/25239343-Banking-Mobile-App-Design-Concept) | Warm focal surface, softer icon wells, generous space and aligned financial facts. |
| [Xpend](https://dribbble.com/shots/25673178-Xpend-Startup-Smart-AI-Financial-Tecnology-Mobile-App-UI-Design) | Quiet ink canvas and navigation, one dominant amount/action group and subdued supporting metadata. |
| [Fireart](https://dribbble.com/shots/25241984-Task-Management-Dashboard) | Asymmetric desktop composition and varied surface sizes instead of a vertical stack of equal panels. |
| [Shopeers](https://dribbble.com/shots/26628350-Shopeers-AI-Powered-B2B-eCommerce-Analytics-Dashboard) | Compact wallet identity/network bar, deliberate alignment and a primary workspace with a supporting rail. |
| [Stakent](https://dribbble.com/shots/23902428-Stakent-Crypto-Dashboard) | Recognizable asset marks, large exact units and clear separation between holdings and supporting controls. |
| [Outcrowd](https://dribbble.com/shots/24690997-Dashboard-UI-components-for-the-online-banking-platform) | Broad colour fields, tactile action tiles and fewer outlines inside outlines. |

## What changed

Overview is recomposed into a wide portfolio/assets column and a narrower transactions,
signers and recovery column on large screens. The wallet identity bar is compact. Existing
pending-work shortcuts remain above the composition when work exists, keeping their Review
action immediate on narrow screens. Pending/Recent controls and full sidebar destinations
retain their existing state, focus targets and handlers.

The solid ivory balance surface contrasts with the ink workspace and contains the existing
Send/Receive asset choices, unavailable Swap and explicit unavailable USD valuation. Its arcs
are decorative, hidden from accessibility and unrelated to prices or percentages. Asset rows
share one broad surface, with exact values, compact Available/Incoming facts, existing actions
and the full shielding/network/privacy guidance. No precision or balance formatting changes.

The signer panel makes the actual threshold prominent and keeps each device separate. It does
not establish a person's identity or physical independence. Recovery continues to distinguish
optional saved files, optional local checks and signed peer reports; no new readiness gate is
introduced.

Welcome becomes an open composition with a larger two-line heading, immediate entry actions
and the supplied zebra plate. The artwork is unchanged. Decorative labels have reserved space
around the plate; mobile actions and essential test-network/audit notices stay above it.

The palette is shared across existing setup, Activity, Approvals, Address book, Chats, Security
& Recovery, Settings, Help, lock screens and dialogs. Light mode uses a warm paper canvas and
retains the dark navigation surface. Settings uses a desktop two-column composition for its
existing description, wallet facts, setup, security, browser and advanced sections. Navigation,
rows, controls, icons, notices and review surfaces share the same geometry and typography.

All financial/recovery content remains opaque. 48px controls, static focus indicators, exact
values, existing validation, dismissal and focus restoration are retained. Previous motion
guards remain unchanged: no outgoing wallet copy, no replay on ordinary redraws or historical
results, and static amounts, QR codes, warnings and focused controls. Reduced preferences and
forced colours remain supported.

## Boundaries

Production changes are limited to shared styles and presentation markup in `app-wallet.js` and
`app-shell.js`. There are no changes to protocols, public APIs, models, persistence, cryptography,
authentication, backend integrations, payment calculations, eligibility or security gates.
Existing UI state identifiers and action handlers are reused. The earlier approved technical
exceptions remain as documented in [the existing delivery](web-prd.md).

USD pricing, percentages without a complete same-owner denominator, Swap, USDC, threshold-one
wallets, shortened comparison codes, recovery formats and other engineering work remain in
[the separate review](ux-ui-final-technical-review.md). No fabricated analytics or performance
chart is added to imitate reference screenshots.

This branch remains web only. Native sources and the original checkout are preserved. Commits
use neutral author/committer placeholders, no signatures and no attribution trailers. There is
no merge or deployment.

## Evidence and validation

The baseline is an immutable archive of `273cc14`, with a separately frozen copy of its inert
sample snapshots. Both phases use fresh synthetic browser stores and isolated local servers.
Actual setup journeys use unfunded ceremonies and virtual authenticators; blocked/expired
reviews use real renderers in inert fixtures. No funded transfer or live RPC/prover is claimed.

Reports and imagery use the `web-art-direction` prefix; prior premium evidence is preserved.
The full actual journey checks behavior and all existing destinations. Every after journey
capture was regenerated with the final styles. Regenerated sample captures show the final
layout across ten screens, six widths and both system schemes. The `45-*` sample captures and
`46-*` recordings provide matching visual comparisons.

| Screen family | Final treatment and checks |
| --- | --- |
| Welcome/shell | Open composition, canonical zebra, entry visibility, single heading, theme handlers and keyboard navigation. |
| Overview/assets | Asymmetric layout, opaque pale hero, broad asset rows, exact amounts, unavailable values and existing Send/Receive choices. |
| Approvals/reviews | Retained warning-first order, actual device/lifecycle states, costs, recipient guidance and long values. |
| Setup/recovery | Existing device diagrams, passkey requirements, all thirty digits and optional file flows with full disclosures. |
| Activity/recipients/chats | Shared rows, forms, selected states and preserved routes/actions. |
| Settings/Help/locks/dialogs | New visual proportions and shared controls while preserving existing state and focus behavior. |

Rendered checks cover 320, 390, 768, 1024, 1440 and 1920px; dark, light and system themes;
enlarged text, forced colours, reduced motion/transparency; page/dialog overflow; 48px targets;
retained forms; keyboard navigation and focus return; and unchanged disabled/action states.
Additional rendered contrast checks cover the locally scoped pale hero and persistent dark
sidebar in both themes, including focus and disabled labels. Global CSS-derived checks cover
static token pairs and transient heading/mark contrast.

Final results are recorded in [the validation summary](web-art-direction-final-validation.json):

- Actual browser journeys: 830 before / 849 after checks, 179 captures each, zero browser errors.
  The after journey adds 19 checks that currency units remain intact, including enlarged text.
- Final visual matrix: 775 checks and 47 captures, plus 22 sample preference checks. Narrow
  balance facts stack instead of overrunning their tracks when text is doubled.
- All 51 regression commands pass. All 19 protected hashes, policy and served headers match
  baseline. Strict lint passes for 172 JavaScript and two Python files.
- Scoped rendered text contrast is at least 4.678:1; hero/sidebar focus is 5.341:1 / 11.920:1.
  Token and transient contrast checks pass in both themes.
- Six matched motion trials per phase: 100% of measured frames within 20ms, p95 16.7–16.8ms,
  zero measured long tasks, decorative layout shifts or continuous loops. These measurements
  isolate settled fonts/assets. Cold font loading is reported separately: after first-load
  CLS is 0.0000903–0.0001043. The production font-loading behavior is unchanged.
- Initial JavaScript adds 325 bytes gzip; the complete production JS/CSS set adds 5,048 bytes
  gzip against this iteration's baseline. No new runtime dependencies or image assets.
- All four safe rendered QR fixtures decode correctly. All 453 PNGs have only IHDR/IDAT/IEND
  chunks; four recordings contain generic encoder/duration tags only.
- The ten-page Test wallet build passes 32 checks and its source fingerprint is current.
  Native paths match main; original checkout HEAD/status and all 828 file hashes are preserved.

Physical phones, software keyboards, assistive technology,
hardware authenticator/provider sync and low-end hardware remain untested. The local Test wallet
is a read-only visual sample; its disabled actions and absent runtime are deliberate.

## Before and after

| View | Before | After |
| --- | --- | --- |
| Desktop Overview | [Before](visuals/web-art-direction/before/45-sample-overview-1440-dark.png) | [After](visuals/web-art-direction/after/45-sample-overview-1440-dark.png) |
| Mobile Overview | [Before](visuals/web-art-direction/before/45-sample-overview-390-dark.png) | [After](visuals/web-art-direction/after/45-sample-overview-390-dark.png) |
| Light Settings | [Before](visuals/web-art-direction/before/45-sample-settings-1440-light.png) | [After](visuals/web-art-direction/after/45-sample-settings-1440-light.png) |
| Desktop welcome | [Before](visuals/web-art-direction/before/45-welcome-1440-dark.png) | [After](visuals/web-art-direction/after/45-welcome-1440-dark.png) |
| Desktop recording | [Before](visuals/web-art-direction/before/46-presentation-1440.webm) | [After](visuals/web-art-direction/after/46-presentation-1440.webm) |
| Mobile recording | [Before](visuals/web-art-direction/before/46-presentation-390.webm) | [After](visuals/web-art-direction/after/46-presentation-390.webm) |
