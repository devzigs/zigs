# Wallet creation and onboarding refinement

Implemented on `codex/ux-ui-final`, starting from `ebf236a`. Remote main was checked on
22 October 2026 and remains `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.

## Presentation changes

- Compact creation and guided headers retain accessible step announcements and current-step marks.
  Desktop uses a 1040px content width with two columns, stacking below 900px. Ordinary collapsed
  screens fit 1366 × 768; expanded guidance, warnings, large groups and increased text may scroll.
- The canonical navigation zebra receives one hover/focus light sweep. The protection illustration
  follows actual pending/verified results: cancellation and Skip never render a secured state.
  Reduced motion settles the effects; hidden documents pause active pulses.
- Creation pairs the counters, adds implementation-based passkey/threshold diagrams, equalizes
  Testnet/unavailable Mainnet tiles, and balances review details with compact configuration facts.
  The complete Solana disclosure remains visible, with its existing opt-out under Network options.
- Invite, join and verification share a compact device-status panel. Orange/green active markers
  identify the local setup participant, never remote online presence. Duplicate device/progress
  panels are removed from these guided steps. Actual connection errors remain visible.
- Private QR display uses the existing modal layers, focus trap, Escape/backdrop dismissal and
  focus return. The secret stays absent from the page until requested. Clipboard denial opens
  selectable link/message text in that same overlay. Wallet/stage changes and locking close it.
- The full safety number appears once in six groups. Codes match still requires the existing
  checkbox and confirmation on every actual device. Codes don’t match retains its stop confirmation.
- Completion presents local backup actions and optional checks beside verified device status.
  Continue to wallet name and Skip name · Open Overview retain their existing handlers. Remote
  recovery reports and detailed limits remain in a compact disclosure. Naming stays unchanged.

## Rough-notes follow-up

The three approved refinements are implemented:

- Protection introduces the fingerprint with one restrained orange pulse per newly opened
  creation dialog. Ordinary redraws and returning to the step do not replay it. The pulse
  carries no protection result; pending authentication and verified protection remain separate.
  Reduced motion and hidden-document handling stop the effect without a deferred replay.
- Completion puts optional recovery details and Skip name above Continue to wallet name.
  Continue is the final element in the action column and the final completion action on narrow
  screens. The repeated completion footnote is removed. Export warnings, optional saved-file
  checks, remote reports, report retry and the existing callbacks remain available.
- Expanded browser guidance separates credential creation from later unlocking. Numbered
  diagrams show PRF-derived AES-GCM encryption, local storage, saved-copy comparison, cleanup,
  current-record checks and failure boundaries. Expanded threshold guidance separates initial
  all-device formation from payment signing, then shows the distinct Zcash and Solana paths.
  Captions identify these as educational diagrams, never live status. Collapsed views keep
  their compact geometry; expanded explanations remain scrollable.

The explanation was checked against `web/vault.js`, `web/app-keystore.js`, `PROTOCOL.md`,
`web/sol/signing.js` and `web/sol/execute.js`. In particular, Solana's proposal-account digest
and fresh execution proof are not described as the same sequence as Zcash's transaction
signature, Halo2 proof and submission. No technical capability was added or deferred by these
three changes. The existing consent and Save + optional Check decisions are unchanged.

Representative evidence: [arrival screen](visuals/onboarding-refinement/after/01-protection-arrival.png),
[browser walkthrough](visuals/onboarding-refinement/after/expanded-protect-1366.png),
[Solana walkthrough on mobile](visuals/onboarding-refinement/after/expanded-sol-signing-390.png),
[desktop completion ordering](visuals/onboarding-refinement/after/09-completion-1366-dark.png),
and [320px completion actions](visuals/onboarding-refinement/after/09-completion-end-320-dark.png).

## Preserved boundaries

The subsequently approved [wallet marble integration](wallet-marble-integration.md) adds a
code-to-marble reveal after verified preparation and reuses each image across wallet screens.
This supersedes the earlier preview-only artwork boundary. It preserves the consent and
Save + optional Check decisions and all existing security/preparation gates.

No engine, authentication, key storage, ceremony, signing, transaction, service, network,
wallet schema, recovery format or native application implementation changed. The existing
explicit passkey Skip, optional backups, full 30-digit acknowledgements, service consent,
storage refusals and preparation gates remain authoritative. Backups appear after actual
preparation, not immediately after the user confirms matching codes.

The `copyBtn` helper accepts an optional fourth argument for a caller-owned presentation fallback.
The motion controller accepts a monotonic clock for isolated presentation tests. Existing callers
retain their original behavior. Arrival timing and QR visibility stay in ephemeral UI memory;
neither is a persisted capability.

The graph check exposed a pre-existing missing preload for the existing naming preview;
it is now included in the page's module list without changing naming behavior.

## Validation

Fresh baseline and final evidence are recorded in `onboarding-refinement-*-validation.json`
and `visuals/onboarding-refinement/`. The focused runner is
`solspike/tools/onboarding_refinement_browser.mjs`; it requires Node 24, Playwright and an
isolated local app server with the synthetic password named in the runner. It blocks external
browser requests and uses only temporary unfunded browser stores.

The browser matrix covers 1366 × 768, 1440 × 900, 768 × 1024, 390 × 844 and 320 × 800 in
light/dark themes, seven-device layout, real independent 2-of-2 and 2-of-3 Zcash formation,
manual matching, passkey cancellation/success, explicit Skip, modal focus/geometry/lifecycle,
actual QR contents, clipboard success/denial, equal network tiles, optional encrypted backup
download and read-only file checks, wrong passphrase, naming continuation and zero-backup
Overview entry. Forced colors and actual 200% text checks cover all changed screens.

The rough-notes follow-up passed 336 focused browser assertions, 42 fast-suite scripts, the full application test and
the unified setup regression. Node runtime: 24.19.0.
The current JSON report also includes the later wallet-marble integration and its additional checks.

The follow-up extends the same browser runner with arrival/re-render and reduced-motion checks,
expanded diagrams at every viewport in both themes, dynamic 2/3/7-device examples, reachable
final diagram stages, and completion ordering on two- and three-device wallets. It also adds
focused motion-controller regressions for step return, hidden documents and preference changes.

Regression commands: `sh scripts/test-fast.sh`, `node web/test/app.mjs`, and
`node web/test/unified-setup.mjs`, all under Node 24. Presentation assertions were updated for
the approved labels/layout; the underlying acknowledgement, stale-number, stop, consent,
storage and ceremony assertions are retained.

Limits: Chromium with a virtual authenticator, not physical devices or an assistive-technology
certification. Browser formation uses Zcash only; Solana behavior is exercised by the existing
engine/page regression fixtures, without live Devnet operations. The fast runner skips its
independent qrencode comparison because qrencode is not installed; the focused browser test
checks the overlay's QR against the existing encoder and the actual invitation payload.

No merge, push or deployment was performed. No outstanding visual defects are known within
the checked scenarios; warnings, long content and expanded sections intentionally retain scrolling.

## Compact completion backups

The completion panel now gives each local device one row with ZEC and applicable SOL save
actions side by side. Each button retains its saved/checked status. One optional file-check
disclosure contains all local checks; recovery explanations and remote reports remain in
their existing disclosure. Continue is the final action. Export dialogs, passphrase warnings,
read-only file checks and optional-backup behavior use the existing handlers.

The additional three-local-device, two-chain fixture measures the collapsed right panel at
412px against 420px on the left at both 1366 × 768 and 1440 × 900. All six save buttons and
Continue fit within the left panel's height. Expanded details and mobile layouts retain normal
scrolling, without a fixed height or clipping.

`solspike/tools/compact_completion_browser.mjs` uses the existing in-memory ZEC/SOL engine rig
and serves only rendered UI to an isolated local browser. Its 50 checks cover all six Save and
Check routes, unchanged shares after opening dialogs, unsaved and partial-progress states,
five widths in both themes, expanded checks at 320px, forced colors and actual doubled text.
Evidence: [validation report](compact-completion-validation.json),
[desktop](visuals/compact-completion/unsaved-1366-dark.png), and
[mobile progress](visuals/compact-completion/progress-320-light.png).
The 42-script fast suite and unified setup regression also passed under Node 24. The fast
suite continues to skip its optional external qrencode comparison because it is not installed.
No technical deferrals were introduced by this layout adjustment.
