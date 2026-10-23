# Contextual visual explanations

Subsequent update: the user explicitly approved optional passkey Skip on 21 October 2026.
The [current policy and delivery](optional-passkey-review.md) supersede the pending-exception
status recorded for this visual-only iteration. Validation below remains historical to its baseline.

Visual baseline: `879149897342696db958184ec2faf46662103d0e`.
Technical reference: main `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`, fetched again.

Each web planning step now has a static icon, visible title and short explanation of its purpose.
The first step uses a fingerprint illustration to explain that a passkey unlocks encrypted local
wallet data. It describes fingerprint, face, PIN or security-key verification as provider-dependent;
it does not imply biometrics are mandatory or sent to Zigs. It distinguishes browser access from
an independent signer and recovery backup.

The same compact pattern explains approval thresholds, recognizable device labels, final review,
connecting independent devices, the thirty-digit comparison, joint key preparation, optional
recovery files and the prepared state. Existing diagrams and full disclosures remain available.

Wallet pages, Approvals, Activity, Chats, Address book, Security & Recovery, Settings, Help,
lock, Send/Receive, payment review and backup/restore use contextual guidance. Guidance describes
the action or check on that page rather than displaying a universal security badge. Payment and
file-check guidance have separate copy from setup review and safety-number comparison. Personal
account backups have separate copy from threshold-share backups. The unavailable Swap page keeps
its existing icon and truthful capability explanation.

Symbols are decorative and hidden from assistive technology; their visible titles and text carry
the meaning. They use existing theme colors, opaque surfaces and static inline artwork. No new
dependency, image download, motion or animation callback. The supplied zebra remains unchanged.
Overview guidance sits beside the heading on desktop to preserve the compact asset layout.

All existing warnings, financial values, control handlers, state management, vault implementation,
authentication gates, approvals, safety-number confirmation, optional backup behavior, keyboard
and focus management remain unchanged. No API, model, persistence, protocol or backend changes.

The separately requested Skip confirmation is documented in
[optional browser protection review](optional-passkey-review.md). A working opt-out requires the
pending explicit exception to the required-passkey policy. No cosmetic Skip or false protection
status is introduced by this presentation pass.

## Validation

Checks use isolated synthetic browser stores and unfunded wallets, never user browser data.

- Fourteen affected Node 24 suites pass, with an additional unified-setup retest after the final
  static Overview copy refinement. Strict lint passes for 177 JavaScript and two Python files.
  The earlier full 51-suite regression remains historical.
- Actual browser journey: 986 checks, 179 captures, no errors. Planning: 255 checks / 32 captures
  before and 480 / 32 after. The current sample/preferences sweep passes 786 checks / 39 captures.
  Current after evidence totals 2,252 checks / 250 captures with no browser errors.
- Six widths (320, 390, 768, 1024, 1440, 1920px), four theme preferences, doubled text, forced
  colors and reduced preferences. Guidance remains static and readable. Control targets,
  keyboard/focus, retained names/descriptions, existing disabled states and thirty-digit checks
  pass. All three asset cards fit 1440×900 in both themes, including the sample-only banner.
- All 299 PNGs contain only image chunks. The final ten-page Test wallet build passes 32 checks
  and its source fingerprint matches final source. The eleven changed production JS/CSS files
  add 2,602 bytes of individually compressed gzip; no new runtime dependencies or raster assets.
- Ninety-four critical functions match after removing only static guidance child calls. Twelve
  safeguard modules remain byte-identical. Nineteen protected files, three policy responses and
  five served-header sets match. Native paths match main; original HEAD/status and all 828 saved
  file hashes remain unchanged. The canonical logo is preserved.

Evidence: [actual journey](web-security-explainers-after-validation.json),
[planning matrix](web-security-explainers-after-plan-validation.json),
[sample/preferences](web-security-explainers-after-visual-validation.json),
[final validation](web-security-explainers-final-validation.json).

| Browser protection | Approval threshold |
| --- | --- |
| ![Passkey explanation](visuals/web-security-explainers/after/50-plan-1-390-dark.png) | ![Threshold explanation](visuals/web-security-explainers/after/50-plan-2-1440-light.png) |

The full journey preceded a redundant introductory paragraph removal and shorter Overview guidance;
final plan/sample captures and the final-copy unit retest cover those prose refinements. Browser
emulation and virtual authenticators are used; physical devices, screen readers, software keyboards,
hardware passkeys, provider sync and funded live transfers remain untested. Existing motion cases
pass; no new motion behavior or performance claim. No native work, merge or deployment.
