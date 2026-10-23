# Security & Recovery dashboard

## Initial audit (23 October 2026, before implementation)

Branch: `codex/security-page`, based on `codex/ux-ui-final` at `31e9c20`.
Fetched main reference: `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.
The supplied brief ends mid-sentence in section 5.3. This pass implements the supplied
objectives and requirements; no unseen requirements are assumed.

| Existing implementation / authoritative fact | New location |
| --- | --- |
| `app-wallet.js`: `securityRecoveryTab`, `membersTab`, `recoveryTab` duplicate configuration, signer and backup surfaces. `distributedSecurity` is shared with setup. | One summary, one signer list, three Recovery & Access disclosures. Remove the diagram from this page only; preserve setup illustrations. |
| `app-seats.js`: `localSeats`, `seatIds`; `app-keystore.js`: `sec`, `mySeatSecrets`. A numbered seat is a logical signer; multiple seats can belong to one browser. No reliable remote hardware/location or presence data exists. | Always append the actual signer number. Say “This browser” only for owned seats; remote location and signing availability remain unknown. |
| `app-dkg.js`: `seatCheck`, rejected addresses, key disagreement and guided blocked reasons. Joined signers are not available approvals. | Real address-check/setup status in details; actual blockers retain priority. No live signer-availability claim. |
| `app-backups.js`: `openBackup`, `saveBackup`, `sealAndSave`. Existing Argon2id/authenticated encryption, save/read-back and separate passphrases. | Per-signer Zcash export in details; summary leads to the first outstanding local file. No batch backup format or new secret handling. |
| `app-sol.js`: `solFile`, `solSetup`, `solBackup`; `sol/backup.js`: independent Solana file and restore. Ceremony uses the same configured seats/threshold. `solOn` indicates capability, not completed setup. | Separate chain rows. Total chain-file counts only after chain scope is known; loading, missing local share, stopped and unavailable remain distinct. |
| `app-guided-setup.js`: `guidedState` checks fingerprints of the current share. `guided-setup-model.js` separates saved, checked and remote reported flags. | Count only local current-file checks as checked here; signed remote reports shown separately. Saved/restored copies never become checked automatically. |
| `recovery-model.js`: threshold margin and browser concentration. Main already provides these recovery facts. | Concise concentration warning persists even when files are checked; explanatory threshold text behind disclosure. |
| `beginGuided` opens the existing optional recovery guide; local `openBackupCheck` is read-only and never invokes restore. Both are inherited UI-branch extensions, absent from main. | Guide and file checks reuse those exact existing handlers. This pass adds no verification protocol or persistence. |
| `app-backups.js`: `restore` checks clashes, current versions, key fit and existing data; Solana restore requires the Zcash signer first. | Restore instructions and existing file picker behind Restore an existing signer. Preserve every restore safeguard. |
| `app-links.js`: `inviteLink` contains wallet id and wallet secret in the fragment, not a new signing share. `secretQr` discloses the secret link explicitly. | Private invite controls nested under Restore, with existing sensitivity and sender/browser guidance. Do not display or copy without an explicit user action. |
| `changeSignersCard` / move flow: configured signers cannot change in place. Creates a replacement wallet and moves Zcash only; Solana shares/authorizations remain. | Advanced wallet management, invoking the existing move dialog and disclosures. |
| `browserSettings` already holds passkey lock, restore and personal-account backup controls. Passkey is local unlock, not signer recovery. | Contextual Settings link; authentication stays in Settings. |
| `app-engine.js` shows relay connection state; `app-groups.js` retains connection failures in existing banners. `guidedState` supplies storage/report errors; Solana exposes load errors. | Retain existing global connection warnings, surface progress-specific failures. Never equate absent reports or an offline signer with lost material. |
| `app-loop.js` preserves open native details and keyboard focus on redraw; dialogs have existing focus/inert behavior. `el`, `icon`, `copyBtn`, design tokens are shared. | Reuse native disclosures, stable control keys, existing dialogs, icons and themes. No global renderer/auth changes. |

## Limits and follow-ups

- There is no proof of physical-device independence, continued backup accessibility or remote
  recovery success. No security score, online status or guaranteed-recovery language is added.
- A wallet-wide required-file denominator cannot be established while the Solana scope is
  unread or unfinished. Show known checks by chain and disclose the unknown scope.
- Remote signed progress is a report by that signer, never a local saved-file check. No new
  telemetry, account synchronisation, key storage or background recovery operation is added.
- In-place signer rotation, unified cross-chain backups, independent-device attestation and
  remote file verification would require engineering approval; they are outside this redesign.
- Main contains export, restore and migration mechanisms. The UI branch additionally contains
  optional guided progress and local file verification; these are reused, not imported into main.

## Validation

All browser fixtures use synthetic metadata in a fresh profile, with protocol execution and
external networking disabled. See [browser results](security-dashboard-validation.json) and
the reproducible [browser check](security-dashboard-check.mjs).

- 70 browser assertions pass, with 35 captures across desktop/tablet/mobile layouts, light/dark
  themes, seven signers with long labels, doubled text at 320 px and forced colors. No horizontal
  overflow, uncaught browser error or external network request was observed.
- The real wallet renderer and its existing Zcash export/check, optional guide, Settings,
  encrypted-file restore entry and replacement-wallet handlers are exercised. Dual-chain actions
  are checked against signer/chain callback bindings. Existing cryptography/restore tests provide
  the underlying operation coverage; the UI matrix never signs or transmits a payment.
- Unsaved, exported-but-unchecked, checked, remote reported, missing local share, unfinished
  setup, unread signer records, unread/stopped/unavailable Solana and progress-storage/report
  failures are covered. Local file checking retains the same-browser concentration warning.
- The registered Node 24 fast suite passes all 43 executed suites. The QR test was skipped
  because `qrencode` is not installed. The full `app.mjs` and `unified-setup.mjs` regressions pass.
- Page import-graph checks pass with both unlocked and locked vaults. Changed application files
  pass the page lint rules; changed pure modules, tests and browser harnesses pass strict lint.
- Repository-wide lint still fails on existing complexity/depth findings in unrelated browser
  tools and `web/sol/payview.js`, plus undefined `glassPicks` references in
  `solspike/tools/liquid_glass_browser.mjs`. None of those files was changed in this pass.
- The typical two-signer capture falls from 3,133 to 1,501 px at 1440 px wide, and from 4,691 to
  2,080 px at 390 px wide, before opening details. Dynamic information is not clipped.
- No native, engine, chain, backend, authentication, storage-format or signing implementation
  was changed. Anonymous Git identity and whitespace checks pass. No merge or deployment.

Preview: [desktop](visuals/security-dashboard/after/needed-1440-dark.png),
[mobile](visuals/security-dashboard/after/needed-390-light.png),
[expanded signer](visuals/security-dashboard/after/signer-details-390-light.png),
[checked files with concentration warning](visuals/security-dashboard/after/checked-1440-dark.png).
