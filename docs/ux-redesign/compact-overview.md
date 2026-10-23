# Compact Overview and complete theme matching

Visual baseline: `55a8f19bae1d6847d90cbd0a5dffa2e283963d01`.
Technical reference: main `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`, fetched again for this pass.

Overview now uses the available desktop width and starts at the left of the workspace. The
balance and Send/Receive/Swap controls form a compact row above three asset cards. Transactions,
devices and optional recovery information follow underneath. Other screens retain their
existing reading widths. Narrow screens and enlarged text stack the content naturally.

The balance panel uses graphite in dark mode and retains warm ivory in light mode. The sidebar,
its menu, text, focus states and selected items follow dark, light or system appearance. The
previous permanent dark sidebar and the pale panel in dark mode are removed.

Each asset groups its icon/network, primary balance, shielding track and two rows of actions.
ZEC shows the existing exact Available amount once, with exact Incoming beneath it. The unchanged
sum of available and incoming remains explicitly labelled Total shielded balance in the native
Balance details disclosure. SOL keeps its existing last-sync amount and age/error distinctions;
device fee funds and legacy holdings are not combined with it. USDC remains unavailable, with
its deposit warning visible. Shield and Unshield have distinct icons.

The shielding visualization is one neutral, unfilled track with a two-colour legend. Ratios
remain unknown because main has no complete same-owner shielded/unshielded balance pair. The
track never defaults to 100%, 50/50 or zero. Calculated segments remain in the existing
[separate engineering review](ux-ui-final-technical-review.md).

Repeated USD and Swap explanatory paragraphs are removed from the visible Overview as requested.
The unavailable USD amount and disabled Swap state remain, with accessible explanations and a
Swap tooltip. Secondary balance, privacy and capability explanations use native disclosures.
Actual payment blockers, cap warnings, sync failures, required setup states and deposit warnings
remain outside those disclosures. Existing action handlers, calculations, eligibility and focus
management are unchanged. Each new disclosure has a distinct summary so the existing renderer
can preserve its open state independently.

The local Test wallet banner is also more compact, retaining every sample/read-only/no-funds
notice and its existing navigation. It remains an inert sample with all wallet actions disabled.

## Validation

The [final validation summary](web-compact-overview-final-validation.json) records:

- Seven affected Node 24 tests pass: app, Solana app, unified setup, contrast, motion,
  Overview model and module graph. Strict lint passes for 173 JavaScript and two Python files.
  The earlier full 51-test result remains historical at the visual baseline.
- Fresh actual browser journey: 852 checks, 179 captures and zero browser errors. Each new
  asset disclosure stays independently open after ordinary redraws.
- Before visual sweep: 677 checks and 63 captures. After: 922 checks and 64 captures, with
  zero errors. Coverage includes all ten sample screens, six widths, four theme settings,
  doubled text, forced colours, keyboard use, exact values and unchanged disabled states.
- All three asset cards fit the initial 1440×900 and 1920×900 viewports, including the sample
  banner. Other states, opened details and enlarged text may naturally need vertical scrolling.
- Rendered hero/sidebar text, focus and status contrast pass in both themes. Token contrast
  and the existing 12 motion cases pass; no new motion behavior is introduced.
- All 306 PNGs contain only IHDR/IDAT/IEND chunks. The ten-page sample build passes 32 checks
  and its fingerprint matches the final source. Production JavaScript/CSS adds 497 bytes gzip.
- All 19 protected files and the policy match baseline. Original checkout HEAD/status and all
  828 file hashes are preserved. Native paths and the canonical supplied logo are unchanged.

Prior art-direction and premium evidence is preserved as historical validation of those
iterations. This pass uses browser emulation, virtual authenticators and unfunded fixtures;
physical devices, screen readers, software keyboards and live funded transfers remain untested.

| View | Before | After |
| --- | --- | --- |
| Dark Overview | [Before](visuals/web-compact-overview/before/48-test-wallet-desktop-dark.png) | [After](visuals/web-compact-overview/after/48-test-wallet-desktop-dark.png) |
| Light Overview | [Before](visuals/web-compact-overview/before/48-test-wallet-desktop-light.png) | [After](visuals/web-compact-overview/after/48-test-wallet-desktop-light.png) |
| Narrow Overview | [Before](visuals/web-compact-overview/before/45-sample-overview-390-dark.png) | [After](visuals/web-compact-overview/after/45-sample-overview-390-dark.png) |

No APIs, models, persistence, authentication, cryptography, backend integrations, payment
calculations, wallet gates or native files change. The original checkout is preserved. Commits
use neutral author/committer placeholders without signatures or attribution trailers.
No merge or deployment.
