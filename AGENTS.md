# Repository instructions

## Default working branch

- The user designated `codex/ux-ui-final` as the default for ongoing work and commits on
  22 October 2026. Use its existing checkout and verify the actual branch before editing
  or committing; folder names are not evidence of the checked-out branch.
- Create or use a subbranch only when the user explicitly requests it. Do not continue
  committing to older feature branches by default.
- Preserve unrelated uncommitted work in other checkouts. The explicit native-publication
  request below authorizes that push only; it does not authorize merges or deployment.

## Authorized Mac/iOS publication — 23 October 2026

The user explicitly requested pushing the completed Mac/iOS adaptation from
`codex/mobile-and-mac` into `codex/ux-ui-final`. This supersedes the former web-only
branch boundary for this reviewed native work. The branch now contains web, Mac and
iPhone/iPad presentation. Keep the existing web implementation and supported native
wallet behavior; no merge command, main-branch integration or deployment is authorized.

- Preserve the web-only snapshot `codex/ux-ui-final-web-only-20261023-3a56c39d`
  and the separate native implementation branch.
- The commit/push scope check now permits the exact reviewed native tree. It still rejects
  additional native paths or changes beyond that snapshot. Update the audited tree only
  after separately authorized native changes are reviewed and validated; never skip hooks.
- Native main supports Zcash. Do not invent native Solana, USDC, live swaps, prices,
  remote backup reports or saved-file rechecking. Native authentication and recovery
  retain their existing platform mechanisms and safeguards.
- The native address book is the previously approved device-private exception. Its
  reviewed Vault integration is not permission for broader storage or security changes.
- Keep tutorial state non-authorizing and saved exports distinct from checked files.
  Preserve actual address, approval, signing, proof and network evidence.
- The existing local native core has documented build/path-metadata limitations. No
  release-ready app binary, Xcode build or physical-device certification is claimed.

## Anonymous contributions

All project changes must use this Git author and committer identity:

- Name: `Zigs Contributor`
- Email: `noreply@zigs.invalid` (a non-deliverable placeholder)

Configure it locally, never rely on a personal global Git identity:

```sh
git config --local user.name 'Zigs Contributor'
git config --local user.email 'noreply@zigs.invalid'
git config --local commit.gpgsign false
git config --local core.hooksPath .githooks
```

Run `python3 scripts/check-git-identity.py --current` before committing. The hooks check current
attribution and outgoing commit metadata without logging rejected names/emails. Do not add
personal co-author/sign-off trailers, personal account names, email addresses, home-folder paths
or other identifying details to project files, screenshots, fixtures, diagnostics or build output.
Use synthetic test participants. Preserve third-party licenses and their required attribution.
Check generated binaries for local home paths and use compiler path remapping.

Changing current history does not purge cached GitHub commits or other people's clones. Never
claim permanent removal from those locations without confirmation from the hosting provider.

## Web branding

The user explicitly replaced the web branding on 24 October 2026 with the supplied
Fingerprint Zebra Emblem: the right-facing white fingerprint zebra with original transparency.
`web/logo.png` is the canonical web artwork. Preserve its geometry, direction and colours;
do not restore the older number-textured zebra or generate a replacement. Header and decorative emblem references use this asset. The user separately requested
keeping the previous number-textured, red-eye zebra in the main homepage hero, now stored
in `web/assets/brand/hero-zebra.png`. Preserve that hero artwork and its existing lighting
and composition when updating the smaller fingerprint brand marks. `web/favicon.png`, `web/favicon.ico` and
`web/apple-touch-icon.png` are proportional small-size variants on a dark square for contrast.
Their source is the exact supplied artwork, also present in `devzigs/zigs-site` at main
`876e358`. Strip identifying metadata from supplied assets. This request updates web branding
only; preserve the existing native assets and code.


## Web presentation palette

The user requested retaining the original orange highlights and warm undertones after the
main-site styling pass. Preserve warm orange primary actions, focus/selection accents,
quiet copper hero lighting and educational highlights in both themes. Keep the new Manrope
typography, layouts, guide and neutral surfaces. Semantic status colours remain distinct.

## UI/UX final branch scope

On `codex/ux-ui-final` and branches continuing this UI/UX effort:

- Change how the application looks and feels, not how it works. Limit implementation to visual
  design, layout, styling, navigation presentation, accessibility and usability improvements
  that preserve existing behavior.
- Use the latest fetched `origin/main` as the authoritative reference for technical specifications,
  capabilities, safeguards and proposed engineering improvements. Keep the UI work on this branch;
  its inherited side-branch behavior is not evidence of what main supports or lacks. Record the
  main commit reviewed, distinguish existing main features from new proposals, and document
  compatibility gaps without importing or changing technical implementation in this UI-only pass.
- Never modify technical architecture, business logic, backend integrations, APIs, cryptography,
  authentication, state management or other underlying engineering systems.
- If an improvement requires changing existing logic, skip its implementation and document it in
  `docs/ux-redesign/ux-ui-final-technical-review.md` for review and explicit user approval.
  A design request alone does not authorize the technical change.
- Keep edits isolated; avoid unnecessary refactoring and preserve all existing functionality.
  Check the affected presentation and existing behavior as appropriate to each change.
- Existing uncommitted work predates this branch. Preserve it without treating it as permission
  to make additional technical changes, and do not include it in new commits by accident.
- Use the anonymous contribution identity above for both author and committer. Keep commit
  signing disabled; do not add personal attribution, co-author or sign-off trailers.

## Approved implementation scope for this pass

- The user authorized rebuilding this isolated UI branch on latest main and reapplying presentation changes. Preserve the original branch snapshot. Main technical behavior is authoritative.
- The user explicitly approved one technical extension: a device-private payment-recipient address book, available across wallets on that device, including necessary model/persistence and existing Send-form selection integration. Reuse existing encryption, locks and validation; do not change cryptographic primitives, payment calculations, authorization gates, backend services or existing recovery-file formats.
- Agreed navigation: Overview, dedicated Approvals, Activity history, Address book, unavailable Swap, Chats, dedicated Security & Recovery, and Settings. Keep existing capabilities and Help access. Payment discussions stay in reviews. General chats stay independent from wallet holdings. This supersedes the earlier placement of the full Approvals inbox inside Overview.
- Refine setup education/diagrams and existing automatic Solana setup presentation. Do not investigate the reported Solana server error. Keep Swap and Shielded USDC explicitly unavailable. Main native apps have no Solana integration; do not import it from the old side branch.
- Never merge in this chat: no git merge commands, merge commits, pull-request merges or deployment, even when validation passes. Update the PR for review only.

## Current guided setup scope

- The original guided-setup pass was web-only. The later explicit Mac/iOS publication request above supersedes that branch exclusion for the reviewed native adaptation. The older native backup remains preserved separately in `codex/ux-ui-final-with-native`.
- Implement the supplied guided web setup brief. Its explicitly requested technical additions are limited to separate, non-authorizing tutorial progress, optional signed device backup-status reports, and read-only saved-backup verification. Existing wallet keys, ceremonies, cryptographic primitives, spending eligibility, authentication safeguards and recovery formats remain authoritative and unchanged.
- Derive security progress from verified existing wallet state. Tutorial cursors, saved local flags and remote reports never authorize formation, signing or spending. Untrusted optional reports must never block existing wallet operations.
- Verify saved backup files without invoking restore, importing shares, replacing keys or mutating nonces. Never transmit or persist backup contents, filenames or passphrases in tutorial/status records. Remote backup progress is reported by a device, not independently verified by another device.
- Keep the existing automatic web Solana setup and consent/capability gates. Fee-address funding is required only by existing paid-operation gates, not by formation completion. Preserve missing-service, stopped-wallet and cryptographic mismatch distinctions.
- These guided web requirements remain web-specific. The separately reviewed Mac/iOS adaptation is authorized by the later publication request above. No merge or deployment is authorized.

## Current web feedback iteration

- The user approved a browser-private optional wallet description. Keep it outside shared wallet
  documents and existing recovery formats, with explicit local-note storage disclosure.
- The user made backups optional. Verified formation permits Overview without downloading or
  reopening files. Distinguish saved downloads from optional checked files and remote reports.
  One saved signer file counts as partial progress; never claim it alone recovers a 2-of-3 wallet.
- The user requested automatic Solana setup and sync. Consolidate consent in final creation review,
  retain service/privacy disclosures and capability checks, and reuse existing automatic sync
  safeguards when Overview opens. Never bypass payment, proof, fee or key-agreement gates.
- The user chose to prepare an eight-digit safety check for separate security review. Keep all
  current thirty digits and acknowledgements until that change is explicitly reviewed and approved.
- Main engines do not support 1-of-1 or 1-of-2 shared wallets or mnemonic-only share recovery.
  Record those requirements for engineering review rather than enabling broken controls.

## Web portfolio Overview

- On 23 October 2026 the user approved a presentation-only `$0.00` fallback for unknown USD
  valuations, with a quiet Placeholder indicator. This supersedes the older primary
  unavailable-value label. Keep unknown distinct from confirmed zero; never persist or calculate
  with the placeholder, invent prices, aggregate units or add a pricing connection in this pass.
- ZEC has shielded balances only. Do not invent transparent balances or enable unsupported
  Shield/Unshield transfers. SOL device fee funds and legacy group funds remain distinct from
  shielded wallet holdings; show percentages as unknown without a complete same-scope pair.
- Reuse current payment forms and approval gates. SOL Receive uses the full verified shielded
  protocol destination for compatible wallets, never the program account or fee address.
- Keep full Activity, Approvals and Security & Recovery as dedicated sidebar destinations.
  Overview may retain Pending/Recent transaction summaries that lead to the existing full views.
  Preserve all history-completeness, privacy, sync-age and unavailable-feature disclosures.

## Recommended passkey setup and explicit Skip

- The user explicitly approved optional passkey protection on 21 October 2026, superseding the
  earlier required-passkey policy. Keep Protect this browser recommended and prominent for new
  wallet, replacement-wallet and signer-join entry. Reuse the existing WebAuthn/PRF vault.
- Only an explicit Skip for now followed by Continue without protection may allow unprotected
  new-signer entry. Explain that signing shares/local wallet data are stored without Zigs'
  passkey encryption, browser-profile/site-data access can expose a share, the wallet's approval
  rule still applies, and protection remains available later in Settings.
- Opening/cancelling the warning or cancelling/failing a credential operation never acknowledges
  Skip. Keep acknowledgement in tab memory only. Reload, a new protection attempt or an observed
  unsafe storage/vault state revokes it. No persistent consent record or wallet-schema change.
- An existing, locked, damaged, pending or incomplete vault, unreadable/damaged storage or
  memory-only operation cannot be bypassed. Freshly check eligibility at confirmation and every
  new-signer handler; preserve other-tab protection and all migration/read-back/cleanup safeguards.
- Keep passkeyProtected() and requirePasskeyProtection() strict and truthful. A separate setup
  eligibility helper may recognize the explicitly acknowledged unprotected path. Never show a
  verified protection mark for Skip. Preserve later verified protection of existing local data.
- This is a narrow approved setup-policy exception, not permission to change cryptography,
  payment approvals, signing/formation safeguards, recovery formats, backend services or other
  authentication behavior. All other UI-only and security boundaries remain in force.
- Keep existing-wallet access, recovery imports and backup exports available. Do not claim
  retroactive encryption of legacy data or that an invite viewing key was never saved earlier.
- Main rejects threshold-one shared wallets in both actual engines. Do not lower only form or
  shape limits. Use docs/ux-redesign/single-approval-wallet-review.md before enabling them.
