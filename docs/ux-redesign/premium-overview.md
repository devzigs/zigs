# Premium Wallet Overview

23 October 2026 · `codex/overview-page` · Web presentation only

Base: `ebf236a26d2e2a0dfd8873791d10da9b5e0c7bc8`. Technical reference: fetched
`origin/main` at `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.
The supplied Overview brief and confirmed plan govern this pass. The missing named source PRDs
were replaced, with user agreement, by existing premium design reports, tokens and components.

The Overview now leads with a graphite financial surface, exact asset quantities, a separate
Shared control object and compact activity states. Desktop uses a 1.7:1 composition; tablet and
phone use identity → balance/actions → assets → activity → Shared control. Light, dark and
system themes remain available. The canonical zebra artwork is unchanged.

## Presentation contracts

- `formatUsdBalance(valuation)` formats finite numbers as USD and distinguishes known zero from
  an unknown, labelled `$0.00` placeholder. Negative numeric zero displays `$0.00`. There is no
  USD source in this checkout: production passes unknown. Known USD values in screenshots are
  isolated renderer inputs, never portfolio data, prices, stored values or calculations.
- `sharedControl(...)` receives the existing threshold, configured participants, accepted device
  labels, membership-read state and configuration status. The display separates approvals required,
  participating devices and joined devices. Missing slots say **Not joined**, since invitation
  delivery is not tracked. Unread slots say **Checking**. No presence or payment approval is inferred.
- `walletAvatarFor(wallet, size)` projects the existing metallic-orb geometry from accepted public
  Zcash address/network metadata. All requested wallet contexts share it. The preview re-exports
  the promoted pure modules; no 3D runtime, persistent cache or new request is introduced. Results
  are bounded in document memory; removed image nodes cannot update a different wallet.
- Existing Send/Receive forms, payment reviews, unavailable Swap, precision, privacy scopes,
  freshness, history completeness, full destinations and transaction lifecycle renderers remain.
  USDC's deposit restriction and the ineligible-SOL address warning remain visible when details
  are collapsed. New modules are registered; the existing omitted setup-preview import is also
  registered so the module-graph check passes.

## Five implementation passes

1. **Financial hierarchy:** captured the baseline, simplified the header, introduced the responsive
   grid and financial hero, retained action launchers, and added the explicit USD placeholder.
2. **Assets and activity:** refined row hierarchy and quiet controls, retained exact balances and
   disclosures, added guarded native detail expansion, and replaced large empty rectangles.
3. **Security identity:** introduced membership-only metal nodes and shared public wallet avatars;
   retained actual approval/signature/submission/confirmation distinctions in existing payment views.
4. **Materials and motion:** confined glass to floating choices, retained opaque financial surfaces,
   used existing event-driven completion feedback and checked motion/transparency/system-color fallbacks.
5. **Critical review:** inspected desktop/mobile renders, recorded the five issues below, fixed the
   three largest visual defects, and performed the final verification matrix.

| Critical review issue | Final disposition |
| --- | --- |
| Long amounts broke across a narrow balance column. | Fixed: full-width financial values on phones up to 400px retain exact large amounts without splitting the decimal string. |
| Three primary actions crowded labels at 320px. | Fixed: equal columns and compact vertical icon/label geometry at the narrowest sizes. |
| Shared control carried excess vertical weight and repeated phone icons implied device types. | Fixed: tighter spacing and neutral engraved device numbers, retaining labels, counts and state text. |
| The lightweight metallic projection has less physical depth than the development 3D preview. | Retained deliberately: identical SVG geometry, no heavyweight renderer or new dependency. |
| Live USD valuation and some unopened-wallet avatar metadata are absent. | Explicit placeholder/neutral-avatar fallbacks remain. No prices, metadata persistence or extra networking was added. |

## Before and after

Matched baseline/current renders use synthetic, unfunded display data in fresh browser stores.
These are local renderer captures, not a user-owned wallet or evidence of funded operations.

| View | Before | After |
| --- | --- | --- |
| Desktop, dark, 1440px | [Before](visuals/premium-overview/before/pending-1440-dark.png) | [After](visuals/premium-overview/after/pending-1440-dark.png) |
| Desktop, light, 1440px | [Before](visuals/premium-overview/before/pending-1440-light.png) | [After](visuals/premium-overview/after/pending-1440-light.png) |
| Phone, dark, 390px | [Before](visuals/premium-overview/before/pending-390-dark.png) | [After](visuals/premium-overview/after/pending-390-dark.png) |
| Phone, light, 390px | [Before](visuals/premium-overview/before/pending-390-light.png) | [After](visuals/premium-overview/after/pending-390-light.png) |

Additional captures cover 1280/768/320px in both themes, populated activity, a known test-only USD
input, full-precision large ZEC, doubled text and forced colors. Final representative desktop,
phone, large-value and system-color captures were visually inspected.

## Verification

- **81 browser checks pass**, with no page errors: requested widths and both themes, desktop grid
  alignment, mobile reading order, 48px targets, keyboard selection/focus, real redraw/disclosure
  continuity, Receive's existing dialog, disabled transfers, membership uncertainty/mismatch,
  existing Security & Recovery destination, matching avatars across surfaces, late avatar results,
  exact large balances, stale/syncing SOL, long names, observed membership motion without replay,
  doubled text, reduced motion, reduced transparency and forced colors. A final system-color
  repair prevents the shielded label from disappearing behind Chromium’s text backplate.
- **Node 24 fast suite: 42 executed suites pass.** QR is skipped because `qrencode` is absent.
  The initial sandboxed run had local-server restrictions; the completed final run used the
  required local-server access. The graph check passes in both ordinary and locked-vault modes.
- **Application, Solana application and unified setup regressions pass.** Assertions were updated
  for the approved heading/USD changes and the existing explicit ZEC sync-status text. Existing
  authentication, signing, proposal, privacy and setup behavior remains covered by those suites.
- Page-module lint, strict lint for changed/new test and presentation helpers, and whitespace
  checks pass. The Worker/web **build dry-run passes**; nothing was uploaded or deployed.
- Full repository lint reports **36 existing findings in nine unchanged files**: legacy browser
  tools and `web/sol/payview.js`. Those files were verified byte-for-byte against the branch base;
  they are outside this change. No type-check result is claimed for this plain-JavaScript app.
- The public-address SVG's test fixture retains its pre-promotion byte hash. All screenshot PNGs
  were checked for identifying metadata. Native paths remain unchanged from the branch base.

[Browser assertions and failures](visuals/premium-overview/after/validation.json) ·
[Consolidated verification](premium-overview-validation.json)

Reproduce browser checks with Node 24, a Playwright installation exposed through
`PLAYWRIGHT_MODULE`, and Chrome supplied through `CHROME_EXECUTABLE`, running
`node solspike/tools/overview_redesign_browser.mjs` from the repository root.
The harness intercepts requests, blocks external origins and skips wallet boot; production
source files receive no fixture data or test setters.

Physical devices, Safari, assistive-technology use and funded/network transactions were not
validated in this presentation pass. Future live valuation integration requires a trusted
source and separate engineering approval. Connectivity/invitation delivery remains undisplayed
because no supporting source exists. No other implementation approval is outstanding.

The work remains isolated on `codex/overview-page`, prepared for later review/integration into
`codex/ux-ui-final`. No push, merge or deployment was performed.
