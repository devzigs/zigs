# Welcome and setup entry

Visual baseline: `aed65ace172b00055c946fb21220a3f8f30271bf`.
Technical reference: main `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`, fetched again for this pass.

The front page now uses the same welcome for browsers with and without saved wallets. The
primary actions remain Set up a wallet and Join a shared wallet. An expandable All your
wallets section sits directly underneath, with the real wallet count and the existing wallet
rows. Recover access and the existing browser lock follow as secondary actions. The local
read-only Test wallet remains available in the dropdown and sidebar, separate from real wallets.

The supplied zebra is unchanged and its tagline is now Private by design. The existing welcome
headline and introductory copy are otherwise retained for the later copy review. How your wallet
works contains the existing explanations, diagrams and privacy information in a native disclosure.
The invite-link form remains available through Join a shared wallet, using its existing handler,
validation and focus behavior.

The collapsed front page is compact enough for the initial normal-text viewport, including at
320/390px widths. Its mobile brand object remains 128px; the caption sits alongside it. The
mobile logo and Menu share a row, and secondary access actions remain compact. Expanded wallet
lists, explanations, larger text, errors and in-progress setup notices can naturally extend the
page vertically. No content is clipped or hidden by a fixed page height.

Planning now displays the four steps it actually uses:

1. Protect this browser.
2. Set the approval threshold.
3. Set up this device.
4. Review your wallet.

This replaces the misleading five-stage formation indicator previously reused inside the
four-step planning form. It reads the same existing step identity; it adds no setup state.
The first step focuses on passkey protection. Further share/recovery education remains in How
browser protection works. The existing protection requirement, success/read-back checks,
cancel/unsupported states, draft handling, threshold validation and final creation handlers
are unchanged. The post-creation multi-device formation journey retains its existing stages.

Repeated test-only/beta notices are removed from the welcome, planning intro, shared chrome,
guided-setup footnote and the redundant account-creation preface. The Solana badge now states
its actual network without a beta suffix. Actual network labels, provider/privacy facts,
mainnet acknowledgement, passkey/storage failures, mismatched-device stops, spending blockers,
unavailable capabilities, custody guidance and recovery warnings remain truthful. This is a
production-style entry presentation; it does not enable production networks or change the
technical configuration.

## Validation

Before views use a frozen source archive and synthetic browser state. Actual journeys use
isolated, unfunded wallets and virtual authenticators. User browser stores are not used for QA.

- Eleven affected Node 24 tests pass, with four final-source retests. Strict lint passes for
  175 JavaScript and two Python files. The previous full 51-test regression is historical.
- The actual wallet journey passes 830 checks with 179 captures. Focused entry checks pass
  676 checks with 62 captures. Additional preference and ten-screen sample sweeps pass 165
  and 510 checks respectively. All after checks total 2,181, with no browser errors.
- Matching entry views cover six widths (320, 390, 768, 1024, 1440 and 1920px), dark/light/system
  themes, enlarged text, forced colors and reduced preferences. Closed normal-text welcome
  pages fit the initial 844px mobile / 900px desktop viewport, with or without saved wallets.
  Expanded content and enlarged text can scroll naturally. Invite forms, keyboard/focus return,
  passkey cancellation and unsupported cases, retained state and 48px controls pass.
- All 325 evidence PNGs contain only image chunks. The ten-page inert Test wallet rebuild
  passes 32 checks; its source fingerprint matches final source. Seven production JS/CSS/HTML
  files add 707 bytes of individually compressed gzip against the visual baseline. No new
  runtime dependency or raster asset.
- Ten critical handler sections match the visual baseline byte for byte. Nineteen protected
  files, three policy responses and five served-header sets match their pinned baseline.
  Original checkout HEAD, status and 828 file hashes are preserved. Native paths match main.

Evidence: [actual journey](web-entry-flow-after-validation.json),
[entry matrix](web-entry-flow-after-entry-validation.json),
[preference/sample sweep](web-entry-flow-after-visual-validation.json),
[final validation](web-entry-flow-final-validation.json).

| Before | After |
| --- | --- |
| ![Welcome before](visuals/web-entry-flow/before/49-welcome-390-light.png) | ![Welcome after](visuals/web-entry-flow/after/49-welcome-390-light.png) |
| ![Protection step before](visuals/web-entry-flow/before/49-step-1-protect-390-dark.png) | ![Protection step after](visuals/web-entry-flow/after/49-step-1-protect-390-dark.png) |

Browser emulation only. Physical devices, screen readers, software keyboards, hardware passkeys,
provider sync and funded live transfers remain untested. Existing motion checks pass; no new
motion behavior was added and earlier performance recordings remain historical.

Only web presentation and its checks change. No API, model, persistence, routing/state manager,
authentication implementation, cryptography, backend integration, payment calculation or
security gate changes. The original checkout and native files remain preserved. Commits use
neutral author/committer placeholders, without signatures or attribution trailers.
No merge or deployment.
