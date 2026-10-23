# Final web quality coverage

Baseline `70fa7b1`; technical reference main `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.
Visual standard: supplied v3 PRD and [original reference mapping](art-direction.md).
Ronas/Xpend artwork was reinspected; the earlier Stakent/Outcrowd material review remains relevant.
No new visual inspection of the Shopeers video is claimed. Static artwork is not motion evidence.

All existing screen families below were reconciled with renderers and app-loop layer entries.
**Reviewed** means the listed visual states were inspected; it does not certify every engineering
branch or blocked live-chain outcome. The scope/limits column is part of the result.

## Family reconciliation

| PRD | Family / existing source | Review scope and limits |
| --- | --- | --- |
| SCR-01 | Shell/navigation — [source](../../web/app-shell.js) | Desktop sidebar, responsive menu, context and no-wallet destinations; keyboard/geometry reviewed. |
| SCR-02 | Welcome — [source](../../web/app-shell.js) | Initial wallet collection and recovery entry; both palettes. |
| SCR-03 | Create/join — [source](../../web/app-setup.js) | Protection, optional Skip warning, pending/cancel/unavailable/protected, threshold, device naming, final review, connect, join, verify, prepared and optional backup steps. |
| SCR-04 | Wallet collection — [source](../../web/app-shell.js) | Empty and one selected wallet, context and menu. Cross-wallet slow-loading races are not newly exhausted. |
| SCR-05 | Overview — [source](../../web/app-wallet.js) | Available/incoming ZEC, unavailable USD, pending/recent summary, signer/recovery context, asset chooser. |
| SCR-06 | Asset displays — [source](../../web/app-wallet.js) | Expanded details; ZEC exact amounts, SOL not-added and unavailable USDC. Live synced/legacy/error asset combinations remain service-dependent. |
| SCR-07 | Send/review/outcomes — [source](../../web/app-send.js) | Actual Send; read-only blocked ZEC, expired SOL, decoded-refusal and transaction-detail renderers. Funded execution/finality not tested. |
| SCR-08 | Receive/deposit — [source](../../web/app-send.js) | Actual Receive, network/privacy warnings, address and QR layout. Secret/QR regions masked in evidence; decoding not newly verified. |
| SCR-09 | Shield/unshield — [source](../../web/sol/payview.js) | Existing Add SOL/private-send/public-withdrawal renderers captured inertly. No paid operation or unsupported ZEC action enabled. |
| SCR-10 | Approvals — [source](../../web/app-drawer.js) | No-wallet and empty inbox; existing 0/1/2 approval-node renderers. Threshold is not presented as transaction confirmation. |
| SCR-11 | Activity — [source](../../web/app-wallet.js) | No-wallet/empty history; transaction-detail renderer. Live incoming/outgoing/failure histories retain prior fixtures/regressions, not all newly populated. |
| SCR-12 | Address book — [source](../../web/app-recipients.js) | Empty, editor, saved long recipient, invalid destination, deletion warning and search/no results. |
| SCR-13 | Swap — [source](../../web/app-shell.js) | Unavailable workspace reviewed. Quote/execution/result screens are not implemented; no build required. |
| SCR-14 | Chats — [source](../../web/app-thread.js) | Workspace, wallet conversation, signed synthetic local message, retained draft, request composer, new direct chat, waiting/invite, Leave warning, personal contacts. |
| SCR-15 | Security/devices — [source](../../web/app-setup.js) | Dedicated summary, device rows, verification evidence and replacement warning. No membership or approval rule changed. |
| SCR-16 | Backup/recovery — [source](../../web/app-backups.js) | ZEC/personal backup, optional file check, staged restore dialog and recovery summary. Real file export/import/reconstruction and all chain-specific error variants not exercised. |
| SCR-17 | Settings — [source](../../web/app-wallet.js) | Wallet/browser settings, description, Appearance handler, Advanced disclosures, personal account/funding/removal warning. |
| SCR-18 | Offline/QR signing — [source](../../web/app-loop.js) | Dedicated offline-signing screens not implemented; no build required. Existing offline notice and QR layout are covered separately. |
| SCR-19 | Passkey/lock — [source](../../web/app-shell.js) | Actual app-owned pending/cancel/unavailable/protected, locked and lost-passkey warning/cancel. OS-owned provider UI and destructive deletion excluded. |
| SCR-20 | Overlays/feedback — [source](../../web/app-loop.js) | All inventoried dialog entry families, payment drawer, mobile glass menu, feedback severity/clearance, title/Close alignment, focus/Escape and disabled actions. |
| SCR-21 | Help/system states — [source](../../web/app-help.js) | FAQ, diagnostics, offline, feedback error, locked, existing startup/unreadable renderers. Not every possible server/engine/corruption failure induced. |

## Evidence and checks

An isolated three-device unfunded journey exercises real creation/join/lock and app controls.
Network requests outside loopback are blocked. Display-chain height/balances are existing synthetic
fixtures. Pure/staged renderer cases are explicitly labelled in the index; no funds are signed
or sent. Personal diagnostic text is replaced with a fixed synthetic list. Passwords, file
controls, private links, safety-number payloads and QR regions are masked when visible.

Four screenshots per state were captured (390/1440px, light/dark). A desktop-light/mobile-dark
pair per state is retained below; affected screens also retain opposite-theme comparisons.
Themes are forced for the matrix; Appearance may show the underlying saved choice in these
snapshots. The actual Appearance handler is separately exercised in the journey.
Large pages include full-page captures; long dialogs also received scroll-to-bottom inspection.
The earlier [coverage register](web-v3-coverage.md) supplies preceding-round evidence; its older
passkey policy wording is superseded by the current optional-Skip flow and AGENTS.md.

Layout checks cover 320/768/1024/1920px. Visible controls meet the established 48px target,
fields have accessible labels, and tested containers have no horizontal overflow. Closed native
disclosure contents are excluded from hit-target measurements. Five representative screens also
undergo actual doubled-text and forced-colour checks. Chrome Page zoom is genuinely set to 200%
in a disposable profile for ten sample routes (40 captures, 120 checks), rather than CSS zoom.
Sample routes are inert; they do not establish payment or authentication functionality.

[Feedback geometry/form results](final-quality-feedback.json) · [Drawer clearance](final-quality-drawers.json) · [Real interactions/timing](final-quality-interactions.json) ·
[Glass/preference fallbacks](final-quality-fallbacks.json) · [Zoom](final-quality-zoom.json) ·
[Matrix and test summary](final-quality-validation.json).

No new motion effect is added. Existing context/completion observers, reduced-motion and hidden-tab
guards remain unchanged. Real menu/scroll tests, normal and 4× emulated CPU, have p95 16.7–16.8ms;
at least 98.9% of measured frames fit 20ms, with no recorded long task or CLS. This is a desktop
Chrome measurement, not physical-phone performance or proof of every screen at 60fps.

Production edits are shared CSS plus one ResizeObserver presentation helper that publishes only
feedback height as a CSS variable. It never reads wallet data or changes actions/state. Its
unsupported-browser fallback is tested. No new asset, runtime dependency, remote request or
functional/authentication API. PNG text/EXIF metadata is absent. No native change/merge/deployment.

## Screen/state index

| State | Desktop light | Mobile dark | Method |
| --- | --- | --- | --- |
| 01-welcome | [1440px](visuals/final-quality/after/01-welcome-1440-light.png) | [390px](visuals/final-quality/after/01-welcome-390-dark.png) | isolated real web flow |
| no-wallet-approvals | [1440px](visuals/final-quality/after/no-wallet-approvals-1440-light.png) | [390px](visuals/final-quality/after/no-wallet-approvals-390-dark.png) | isolated real web flow |
| no-wallet-activity | [1440px](visuals/final-quality/after/no-wallet-activity-1440-light.png) | [390px](visuals/final-quality/after/no-wallet-activity-390-dark.png) | isolated real web flow |
| no-wallet-security | [1440px](visuals/final-quality/after/no-wallet-security-1440-light.png) | [390px](visuals/final-quality/after/no-wallet-security-390-dark.png) | isolated real web flow |
| browser-settings | [1440px](visuals/final-quality/after/browser-settings-1440-light.png) | [390px](visuals/final-quality/after/browser-settings-390-dark.png) | isolated real web flow |
| offline | [1440px](visuals/final-quality/after/offline-1440-light.png) | [390px](visuals/final-quality/after/offline-390-dark.png) | isolated real web flow |
| protect | [1440px](visuals/final-quality/after/protect-1440-light.png) | [390px](visuals/final-quality/after/protect-390-dark.png) | isolated real web flow |
| skip-warning | [1440px](visuals/final-quality/after/skip-warning-1440-light.png) | [390px](visuals/final-quality/after/skip-warning-390-dark.png) | isolated real web flow |
| 27-passkey-pending | [1440px](visuals/final-quality/after/27-passkey-pending-1440-light.png) | [390px](visuals/final-quality/after/27-passkey-pending-390-dark.png) | isolated real web flow |
| 27-passkey-cancelled | [1440px](visuals/final-quality/after/27-passkey-cancelled-1440-light.png) | [390px](visuals/final-quality/after/27-passkey-cancelled-390-dark.png) | isolated real web flow |
| 28-passkey-prf-unavailable | [1440px](visuals/final-quality/after/28-passkey-prf-unavailable-1440-light.png) | [390px](visuals/final-quality/after/28-passkey-prf-unavailable-390-dark.png) | isolated real web flow |
| 29-passkey-protected | [1440px](visuals/final-quality/after/29-passkey-protected-1440-light.png) | [390px](visuals/final-quality/after/29-passkey-protected-390-dark.png) | isolated real web flow |
| 02-tutorial-introduction | [1440px](visuals/final-quality/after/02-tutorial-introduction-1440-light.png) | [390px](visuals/final-quality/after/02-tutorial-introduction-390-dark.png) | isolated real web flow |
| 03-tutorial-rule | [1440px](visuals/final-quality/after/03-tutorial-rule-1440-light.png) | [390px](visuals/final-quality/after/03-tutorial-rule-390-dark.png) | isolated real web flow |
| 04-review-default-networks | [1440px](visuals/final-quality/after/04-review-default-networks-1440-light.png) | [390px](visuals/final-quality/after/04-review-default-networks-390-dark.png) | isolated real web flow |
| 04-tutorial-review | [1440px](visuals/final-quality/after/04-tutorial-review-1440-light.png) | [390px](visuals/final-quality/after/04-tutorial-review-390-dark.png) | isolated real web flow |
| 04-guided-connect | [1440px](visuals/final-quality/after/04-guided-connect-1440-light.png) | [390px](visuals/final-quality/after/04-guided-connect-390-dark.png) | isolated real web flow |
| join | [1440px](visuals/final-quality/after/join-1440-light.png) | [390px](visuals/final-quality/after/join-390-dark.png) | isolated real web flow |
| 05-device-verification | [1440px](visuals/final-quality/after/05-device-verification-1440-light.png) | [390px](visuals/final-quality/after/05-device-verification-390-dark.png) | isolated real web flow |
| 17-guided-backups | [1440px](visuals/final-quality/after/17-guided-backups-1440-light.png) | [390px](visuals/final-quality/after/17-guided-backups-390-dark.png) | isolated real web flow |
| 18-guided-local-ready | [1440px](visuals/final-quality/after/18-guided-local-ready-1440-light.png) | [390px](visuals/final-quality/after/18-guided-local-ready-390-dark.png) | isolated real web flow |
| security | [1440px](visuals/final-quality/after/security-1440-light.png) | [390px](visuals/final-quality/after/security-390-dark.png) | isolated real web flow |
| devices | [1440px](visuals/final-quality/after/devices-1440-light.png) | [390px](visuals/final-quality/after/devices-390-dark.png) | isolated real web flow |
| backup | [1440px](visuals/final-quality/after/backup-1440-light.png) | [390px](visuals/final-quality/after/backup-390-dark.png) | isolated real web flow |
| backup-check | [1440px](visuals/final-quality/after/backup-check-1440-light.png) | [390px](visuals/final-quality/after/backup-check-390-dark.png) | isolated real web flow |
| restore | [1440px](visuals/final-quality/after/restore-1440-light.png) | [390px](visuals/final-quality/after/restore-390-dark.png) | actual renderer with staged recovery-dialog state; no file opened |
| replace | [1440px](visuals/final-quality/after/replace-1440-light.png) | [390px](visuals/final-quality/after/replace-390-dark.png) | isolated real web flow |
| overview | [1440px](visuals/final-quality/after/overview-1440-light.png) | [390px](visuals/final-quality/after/overview-390-dark.png) | isolated real web flow |
| asset-details | [1440px](visuals/final-quality/after/asset-details-1440-light.png) | [390px](visuals/final-quality/after/asset-details-390-dark.png) | isolated real web flow |
| asset-picker | [1440px](visuals/final-quality/after/asset-picker-1440-light.png) | [390px](visuals/final-quality/after/asset-picker-390-dark.png) | isolated real web flow |
| send | [1440px](visuals/final-quality/after/send-1440-light.png) | [390px](visuals/final-quality/after/send-390-dark.png) | isolated real web flow |
| receive | [1440px](visuals/final-quality/after/receive-1440-light.png) | [390px](visuals/final-quality/after/receive-390-dark.png) | isolated real web flow |
| approvals | [1440px](visuals/final-quality/after/approvals-1440-light.png) | [390px](visuals/final-quality/after/approvals-390-dark.png) | isolated real web flow |
| activity | [1440px](visuals/final-quality/after/activity-1440-light.png) | [390px](visuals/final-quality/after/activity-390-dark.png) | isolated real web flow |
| zec-blocked-review | [1440px](visuals/final-quality/after/zec-blocked-review-1440-light.png) | [390px](visuals/final-quality/after/zec-blocked-review-390-dark.png) | read-only renderer fixture |
| sol-expired-review | [1440px](visuals/final-quality/after/sol-expired-review-1440-light.png) | [390px](visuals/final-quality/after/sol-expired-review-390-dark.png) | read-only renderer fixture |
| shield | [1440px](visuals/final-quality/after/shield-1440-light.png) | [390px](visuals/final-quality/after/shield-390-dark.png) | read-only renderer fixture |
| private-send | [1440px](visuals/final-quality/after/private-send-1440-light.png) | [390px](visuals/final-quality/after/private-send-390-dark.png) | read-only renderer fixture |
| unshield | [1440px](visuals/final-quality/after/unshield-1440-light.png) | [390px](visuals/final-quality/after/unshield-390-dark.png) | read-only renderer fixture |
| approval-0 | [1440px](visuals/final-quality/after/approval-0-1440-light.png) | [390px](visuals/final-quality/after/approval-0-390-dark.png) | read-only renderer fixture |
| approval-1 | [1440px](visuals/final-quality/after/approval-1-1440-light.png) | [390px](visuals/final-quality/after/approval-1-390-dark.png) | read-only renderer fixture |
| approval-2 | [1440px](visuals/final-quality/after/approval-2-1440-light.png) | [390px](visuals/final-quality/after/approval-2-390-dark.png) | read-only renderer fixture |
| transaction-details | [1440px](visuals/final-quality/after/transaction-details-1440-light.png) | [390px](visuals/final-quality/after/transaction-details-390-dark.png) | read-only renderer fixture |
| local-review-refused | [1440px](visuals/final-quality/after/local-review-refused-1440-light.png) | [390px](visuals/final-quality/after/local-review-refused-390-dark.png) | read-only renderer fixture |
| settings | [1440px](visuals/final-quality/after/settings-1440-light.png) | [390px](visuals/final-quality/after/settings-390-dark.png) | isolated real web flow |
| advanced | [1440px](visuals/final-quality/after/advanced-1440-light.png) | [390px](visuals/final-quality/after/advanced-390-dark.png) | isolated real web flow |
| help | [1440px](visuals/final-quality/after/help-1440-light.png) | [390px](visuals/final-quality/after/help-390-dark.png) | isolated real web flow |
| diagnostics | [1440px](visuals/final-quality/after/diagnostics-1440-light.png) | [390px](visuals/final-quality/after/diagnostics-390-dark.png) | isolated flow with synthetic displayed diagnostic text |
| recipients-empty | [1440px](visuals/final-quality/after/recipients-empty-1440-light.png) | [390px](visuals/final-quality/after/recipients-empty-390-dark.png) | isolated real web flow |
| recipient-editor | [1440px](visuals/final-quality/after/recipient-editor-1440-light.png) | [390px](visuals/final-quality/after/recipient-editor-390-dark.png) | isolated real web flow |
| recipient-saved | [1440px](visuals/final-quality/after/recipient-saved-1440-light.png) | [390px](visuals/final-quality/after/recipient-saved-390-dark.png) | isolated real web flow |
| recipient-error | [1440px](visuals/final-quality/after/recipient-error-1440-light.png) | [390px](visuals/final-quality/after/recipient-error-390-dark.png) | isolated real web flow |
| recipient-delete | [1440px](visuals/final-quality/after/recipient-delete-1440-light.png) | [390px](visuals/final-quality/after/recipient-delete-390-dark.png) | isolated real web flow |
| recipients-no-results | [1440px](visuals/final-quality/after/recipients-no-results-1440-light.png) | [390px](visuals/final-quality/after/recipients-no-results-390-dark.png) | isolated real web flow |
| swap | [1440px](visuals/final-quality/after/swap-1440-light.png) | [390px](visuals/final-quality/after/swap-390-dark.png) | isolated real web flow |
| wallet-messages | [1440px](visuals/final-quality/after/wallet-messages-1440-light.png) | [390px](visuals/final-quality/after/wallet-messages-390-dark.png) | isolated real web flow |
| wallet-conversation | [1440px](visuals/final-quality/after/wallet-conversation-1440-light.png) | [390px](visuals/final-quality/after/wallet-conversation-390-dark.png) | isolated real web flow |
| request-composer | [1440px](visuals/final-quality/after/request-composer-1440-light.png) | [390px](visuals/final-quality/after/request-composer-390-dark.png) | isolated real web flow |
| chats | [1440px](visuals/final-quality/after/chats-1440-light.png) | [390px](visuals/final-quality/after/chats-390-dark.png) | isolated real web flow |
| new-chat | [1440px](visuals/final-quality/after/new-chat-1440-light.png) | [390px](visuals/final-quality/after/new-chat-390-dark.png) | isolated real web flow |
| direct-chat | [1440px](visuals/final-quality/after/direct-chat-1440-light.png) | [390px](visuals/final-quality/after/direct-chat-390-dark.png) | isolated real web flow |
| leave-chat | [1440px](visuals/final-quality/after/leave-chat-1440-light.png) | [390px](visuals/final-quality/after/leave-chat-390-dark.png) | isolated real web flow |
| personal-account | [1440px](visuals/final-quality/after/personal-account-1440-light.png) | [390px](visuals/final-quality/after/personal-account-390-dark.png) | isolated real web flow |
| personal-backup | [1440px](visuals/final-quality/after/personal-backup-1440-light.png) | [390px](visuals/final-quality/after/personal-backup-390-dark.png) | isolated real web flow |
| add-contact | [1440px](visuals/final-quality/after/add-contact-1440-light.png) | [390px](visuals/final-quality/after/add-contact-390-dark.png) | isolated real web flow |
| contact-detail | [1440px](visuals/final-quality/after/contact-detail-1440-light.png) | [390px](visuals/final-quality/after/contact-detail-390-dark.png) | isolated real web flow |
| remove-account | [1440px](visuals/final-quality/after/remove-account-1440-light.png) | [390px](visuals/final-quality/after/remove-account-390-dark.png) | isolated real web flow |
| error-banner | [1440px](visuals/final-quality/after/error-banner-1440-light.png) | [390px](visuals/final-quality/after/error-banner-390-dark.png) | isolated real web flow |
| loading-unreadable | [1440px](visuals/final-quality/after/loading-unreadable-1440-light.png) | [390px](visuals/final-quality/after/loading-unreadable-390-dark.png) | read-only renderer fixture |
| locked | [1440px](visuals/final-quality/after/locked-1440-light.png) | [390px](visuals/final-quality/after/locked-390-dark.png) | isolated real web flow |
| forget-warning | [1440px](visuals/final-quality/after/forget-warning-1440-light.png) | [390px](visuals/final-quality/after/forget-warning-390-dark.png) | isolated real web flow |
| solana-workspace | [1440px](visuals/final-quality/after/solana-workspace-1440-light.png) | [390px](visuals/final-quality/after/solana-workspace-390-dark.png) | isolated real web flow |
