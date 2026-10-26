# Repository instructions

## Branches and merges

- `main` is the default branch. It holds the UI/UX redesign and its iPhone and Mac presentation.
- Make each change on a new branch from the latest `origin/main`. Verify the actual branch before
  editing or committing; folder names are not evidence of the checked-out branch.
- Do not merge on GitHub. Only the owner, or an agent that the owner asks directly, merges a
  reviewed branch into `main` locally and pushes `main` without a force push. Nothing deploys to
  production without the owner's approval.
- Preserve unrelated uncommitted work in other checkouts.

## Native apps

The iPhone and Mac apps share the redesign. Native app work keeps the existing web implementation
and supported native wallet behavior.

- The native apps support Zcash. Do not add native Solana, USDC, live swaps, prices, remote
  backup reports or saved-file rechecking without an approved ticket (native Solana is SOL-14 in
  `TICKETS.md`). Native authentication and recovery retain their existing platform mechanisms
  and safeguards.
- The native address book is the previously approved device-private exception. Its
  reviewed Vault integration is not permission for broader storage or security changes.
- Keep tutorial state non-authorizing and saved exports distinct from checked files.
  Preserve actual address, approval, signing, proof and network evidence.
- No release-ready app binary, Xcode build or physical-device certification is claimed.

## Anonymous contributions

All project changes must use this Git author and committer identity. Every commit of `main` has it:

- Name: `zkzigs`
- Email: `340653707+devzigs@users.noreply.github.com` (the GitHub no-reply address of the
  project account)

Configure it locally, never rely on a personal global Git identity:

```sh
git config --local user.name 'zkzigs'
git config --local user.email '340653707+devzigs@users.noreply.github.com'
git config --local commit.gpgsign false
```

Before you push, list the commits that do not have this author, this committer and a `+0000`
date. Push only if the list is empty:

```sh
git log origin/main..HEAD --format='%h|%an|%ae|%cn|%ce|%ad' --date=iso | awk -F'|' '!($2=="zkzigs" && $3=="340653707+devzigs@users.noreply.github.com" && $4==$2 && $5==$3 && $6 ~ /\+0000$/){print $1}'
```

Commit with `TZ=UTC`, so that commit dates show `+0000`. Use `TZ=UTC` also for `merge`, `rebase`,
`cherry-pick` and `commit --amend`. Do not set `core.hooksPath`, and do not remove the Git hooks
of your checkout. Never use `--no-verify`, on `git commit` or on `git push`. Do not add personal co-author/sign-off
trailers, personal account names, email addresses, home-folder paths or other identifying details
to project files, screenshots, fixtures, diagnostics or build output. Use synthetic test
participants. Preserve third-party licenses and their required attribution. Check generated
binaries for local home paths and use compiler path remapping.

Changing current history does not purge cached GitHub commits or other people's clones. Never
claim permanent removal from those locations without confirmation from the hosting provider.

## Web branding

Use the user-supplied side-profile zebra artwork with the number texture, red eye and original
transparency as the Zigs logo. `web/logo.png` is the canonical asset. Keep its artwork unchanged;
do not substitute the older front-facing zebra or generate a replacement. Header, favicon and
web shortcut references share this asset. The legacy web icon paths contain the same artwork.
Strip identifying file metadata before committing supplied assets. The native apps also use this
canonical artwork.

## UI/UX work scope

For UI/UX work:

- Change how the application looks and feels, not how it works. Limit implementation to visual
  design, layout, styling, navigation presentation, accessibility and usability improvements
  that preserve existing behavior.
- Use the latest fetched `origin/main` as the authoritative reference for technical specifications,
  capabilities and safeguards. Distinguish existing main features from new proposals, and document
  compatibility gaps without changing technical implementation in a UI-only change.
- Never modify technical architecture, business logic, backend integrations, APIs, cryptography,
  authentication, state management or other underlying engineering systems.
- If an improvement requires changing existing logic, skip its implementation and document it in
  `docs/ux-redesign/ux-ui-final-technical-review.md` for review and explicit user approval.
  A design request alone does not authorize the technical change.
- Keep edits isolated; avoid unnecessary refactoring and preserve all existing functionality.
  Check the affected presentation and existing behavior as appropriate to each change.
- Preserve existing uncommitted work without treating it as permission to make additional
  technical changes, and do not include it in new commits by accident.
- Use the anonymous contribution identity above for both author and committer. Keep commit
  signing disabled. Do not add personal attribution, personal co-author trailers or personal
  sign-off trailers.

## Approved scope of the redesign

- The user explicitly approved one technical extension: a device-private payment-recipient address book, available across wallets on that device, including necessary model/persistence and existing Send-form selection integration. Reuse existing encryption, locks and validation; do not change cryptographic primitives, payment calculations, authorization gates, backend services or existing recovery-file formats.
- Agreed navigation: Overview, dedicated Approvals, Activity history, Address book, unavailable Swap, Chats, dedicated Security & Recovery, and Settings. Keep existing capabilities and Help access. Payment discussions stay in reviews. General chats stay independent from wallet holdings.
- Keep Swap and Shielded USDC explicitly unavailable. The native apps have no Solana integration
  yet (SOL-14).

## Guided setup scope

- The guided web setup (`docs/ux-redesign/guided-web-setup.md`) added only these technical features: separate, non-authorizing tutorial progress, optional signed device backup-status reports, and read-only saved-backup verification. Existing wallet keys, ceremonies, cryptographic primitives, spending eligibility, authentication safeguards and recovery formats remain authoritative and unchanged.
- Derive security progress from verified existing wallet state. Tutorial cursors, saved local flags and remote reports never authorize formation, signing or spending. Untrusted optional reports must never block existing wallet operations.
- Verify saved backup files without invoking restore, importing shares, replacing keys or mutating nonces. Never transmit or persist backup contents, filenames or passphrases in tutorial/status records. Remote backup progress is reported by a device, not independently verified by another device.
- Keep the existing automatic web Solana setup and consent/capability gates. Fee-address funding is required only by existing paid-operation gates, not by formation completion. Preserve missing-service, stopped-wallet and cryptographic mismatch distinctions.
- These guided web requirements remain web-specific.

## Web feedback decisions

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
  valuations, with a quiet Placeholder indicator. Keep unknown distinct from confirmed zero;
  never persist or calculate
  with the placeholder, invent prices or aggregate units, and add no pricing connection without
  separate approval.
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
  authentication behavior. All other security boundaries remain in force, and the UI/UX work
  scope applies to UI/UX work.
- Keep existing-wallet access, recovery imports and backup exports available. Do not claim
  retroactive encryption of legacy data or that an invite viewing key was never saved earlier.
- Main rejects threshold-one shared wallets in both actual engines. Do not lower only form or
  shape limits. Use docs/ux-redesign/single-approval-wallet-review.md before enabling them.
