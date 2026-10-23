# Final-pass screen and state checklist

23 October 2026 · Current web working tree · Chrome full audit, WebKit smoke checks.

207 state entries; 1558 matrix records. A state entry may repeat across independent suites.
Normal states have 1440/1024/768/390px light/dark coverage. Narrow, forced-color and enlarged-text stress cases keep their stated dimensions.
Full matrix metrics and hashes remain in each results file; matched 1440px light / 390px dark images and stress images are retained.

Visual review used state contact sheets plus full-size inspection of affected screens and critical dialogs; automated geometry/label checks ran on every matrix record.
Fixture captures establish presentation, not funded operations.

## activity_design

[All metrics](visuals/finalpass/after/activity_design/results.json)

| Inspected state | Viewports / themes | Method | Evidence |
| --- | --- | --- | --- |
| ✓ empty | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/activity_design/empty-1440-light.png) · [390 dark](visuals/finalpass/after/activity_design/empty-390-dark.png) |
| ✓ populated | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/activity_design/populated-1440-light.png) · [390 dark](visuals/finalpass/after/activity_design/populated-390-dark.png) |
| ✓ filtered | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/activity_design/filtered-1440-light.png) · [390 dark](visuals/finalpass/after/activity_design/filtered-390-dark.png) |
| ✓ loading | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/activity_design/loading-1440-light.png) · [390 dark](visuals/finalpass/after/activity_design/loading-390-dark.png) |
| ✓ error | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/activity_design/error-1440-light.png) · [390 dark](visuals/finalpass/after/activity_design/error-390-dark.png) |
| ✓ solana | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/activity_design/solana-1440-light.png) · [390 dark](visuals/finalpass/after/activity_design/solana-390-dark.png) |
| ✓ busy | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/activity_design/busy-1440-light.png) · [390 dark](visuals/finalpass/after/activity_design/busy-390-dark.png) |
| ✓ receipt | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/activity_design/receipt-1440-light.png) · [390 dark](visuals/finalpass/after/activity_design/receipt-390-dark.png) |
| ✓ receipt-execution | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/activity_design/receipt-execution-1440-light.png) · [390 dark](visuals/finalpass/after/activity_design/receipt-execution-390-dark.png) |
| ✓ stress-320-forced-colors | 320; dark | inert production-renderer fixture; synthetic data | [320 dark](visuals/finalpass/after/activity_design/stress-320-forced-colors-320-dark.png) |

## approvals_experience

[All metrics](visuals/finalpass/after/approvals_experience/results.json)

| Inspected state | Viewports / themes | Method | Evidence |
| --- | --- | --- | --- |
| ✓ empty | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/approvals_experience/empty-1440-light.png) · [390 dark](visuals/finalpass/after/approvals_experience/empty-390-dark.png) |
| ✓ request | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/approvals_experience/request-1440-light.png) · [390 dark](visuals/finalpass/after/approvals_experience/request-390-dark.png) |
| ✓ waiting | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/approvals_experience/waiting-1440-light.png) · [390 dark](visuals/finalpass/after/approvals_experience/waiting-390-dark.png) |
| ✓ review | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/approvals_experience/review-1440-light.png) · [390 dark](visuals/finalpass/after/approvals_experience/review-390-dark.png) |
| ✓ review-progress | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/approvals_experience/review-progress-1440-light.png) · [390 dark](visuals/finalpass/after/approvals_experience/review-progress-390-dark.png) |
| ✓ completed | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/approvals_experience/completed-1440-light.png) · [390 dark](visuals/finalpass/after/approvals_experience/completed-390-dark.png) |
| ✓ completed-progress | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/approvals_experience/completed-progress-1440-light.png) · [390 dark](visuals/finalpass/after/approvals_experience/completed-progress-390-dark.png) |
| ✓ multiple | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/approvals_experience/multiple-1440-light.png) · [390 dark](visuals/finalpass/after/approvals_experience/multiple-390-dark.png) |
| ✓ loading | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/approvals_experience/loading-1440-light.png) · [390 dark](visuals/finalpass/after/approvals_experience/loading-390-dark.png) |
| ✓ failed | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/approvals_experience/failed-1440-light.png) · [390 dark](visuals/finalpass/after/approvals_experience/failed-390-dark.png) |
| ✓ devices-2 | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/approvals_experience/devices-2-1440-light.png) · [390 dark](visuals/finalpass/after/approvals_experience/devices-2-390-dark.png) |
| ✓ devices-7 | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/approvals_experience/devices-7-1440-light.png) · [390 dark](visuals/finalpass/after/approvals_experience/devices-7-390-dark.png) |
| ✓ text-200-percent | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/approvals_experience/text-200-percent-1440-light.png) · [390 dark](visuals/finalpass/after/approvals_experience/text-200-percent-390-dark.png) |
| ✓ review-failed | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/approvals_experience/review-failed-1440-light.png) · [390 dark](visuals/finalpass/after/approvals_experience/review-failed-390-dark.png) |
| ✓ unknown-progress | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/approvals_experience/unknown-progress-1440-light.png) · [390 dark](visuals/finalpass/after/approvals_experience/unknown-progress-390-dark.png) |
| ✓ forced-colors | 390; dark | inert production-renderer fixture; synthetic data | [390 dark](visuals/finalpass/after/approvals_experience/forced-colors-390-dark.png) |

## messaging_redesign

[All metrics](visuals/finalpass/after/messaging_redesign/results.json)

| Inspected state | Viewports / themes | Method | Evidence |
| --- | --- | --- | --- |
| ✓ team | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/messaging_redesign/team-1440-light.png) · [390 dark](visuals/finalpass/after/messaging_redesign/team-390-dark.png) |
| ✓ direct | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/messaging_redesign/direct-1440-light.png) · [390 dark](visuals/finalpass/after/messaging_redesign/direct-390-dark.png) |
| ✓ contact | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/messaging_redesign/contact-1440-light.png) · [390 dark](visuals/finalpass/after/messaging_redesign/contact-390-dark.png) |
| ✓ setup | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/messaging_redesign/setup-1440-light.png) · [390 dark](visuals/finalpass/after/messaging_redesign/setup-390-dark.png) |
| ✓ relay-inbox | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/messaging_redesign/relay-inbox-1440-light.png) · [390 dark](visuals/finalpass/after/messaging_redesign/relay-inbox-390-dark.png) |
| ✓ relay-offline | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/messaging_redesign/relay-offline-1440-light.png) · [390 dark](visuals/finalpass/after/messaging_redesign/relay-offline-390-dark.png) |
| ✓ changed-key | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/messaging_redesign/changed-key-1440-light.png) · [390 dark](visuals/finalpass/after/messaging_redesign/changed-key-390-dark.png) |
| ✓ direct-invite | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/messaging_redesign/direct-invite-1440-light.png) · [390 dark](visuals/finalpass/after/messaging_redesign/direct-invite-390-dark.png) |
| ✓ cost-review | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/messaging_redesign/cost-review-1440-light.png) · [390 dark](visuals/finalpass/after/messaging_redesign/cost-review-390-dark.png) |
| ✓ changed-cost-review | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/messaging_redesign/changed-cost-review-1440-light.png) · [390 dark](visuals/finalpass/after/messaging_redesign/changed-cost-review-390-dark.png) |
| ✓ send-failed | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/messaging_redesign/send-failed-1440-light.png) · [390 dark](visuals/finalpass/after/messaging_redesign/send-failed-390-dark.png) |
| ✓ insufficient-funds | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/messaging_redesign/insufficient-funds-1440-light.png) · [390 dark](visuals/finalpass/after/messaging_redesign/insufficient-funds-390-dark.png) |
| ✓ tutorial-1 | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/messaging_redesign/tutorial-1-1440-light.png) · [390 dark](visuals/finalpass/after/messaging_redesign/tutorial-1-390-dark.png) |
| ✓ tutorial-2 | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/messaging_redesign/tutorial-2-1440-light.png) · [390 dark](visuals/finalpass/after/messaging_redesign/tutorial-2-390-dark.png) |
| ✓ tutorial-3 | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/messaging_redesign/tutorial-3-1440-light.png) · [390 dark](visuals/finalpass/after/messaging_redesign/tutorial-3-390-dark.png) |
| ✓ tutorial-4 | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/messaging_redesign/tutorial-4-1440-light.png) · [390 dark](visuals/finalpass/after/messaging_redesign/tutorial-4-390-dark.png) |
| ✓ conversation-actions | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/messaging_redesign/conversation-actions-1440-light.png) · [390 dark](visuals/finalpass/after/messaging_redesign/conversation-actions-390-dark.png) |

## overview_redesign

[All metrics](visuals/finalpass/after/overview_redesign/results.json)

| Inspected state | Viewports / themes | Method | Evidence |
| --- | --- | --- | --- |
| ✓ pending | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/overview_redesign/pending-1440-light.png) · [390 dark](visuals/finalpass/after/overview_redesign/pending-390-dark.png) |
| ✓ recent | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/overview_redesign/recent-1440-light.png) · [390 dark](visuals/finalpass/after/overview_redesign/recent-390-dark.png) |
| ✓ recent-populated | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/overview_redesign/recent-populated-1440-light.png) · [390 dark](visuals/finalpass/after/overview_redesign/recent-populated-390-dark.png) |
| ✓ receive-choices | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/overview_redesign/receive-choices-1440-light.png) · [390 dark](visuals/finalpass/after/overview_redesign/receive-choices-390-dark.png) |
| ✓ known-usd | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/overview_redesign/known-usd-1440-light.png) · [390 dark](visuals/finalpass/after/overview_redesign/known-usd-390-dark.png) |
| ✓ large-balance | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/overview_redesign/large-balance-1440-light.png) · [390 dark](visuals/finalpass/after/overview_redesign/large-balance-390-dark.png) |
| ✓ doubled-text | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/overview_redesign/doubled-text-1440-light.png) · [390 dark](visuals/finalpass/after/overview_redesign/doubled-text-390-dark.png) |
| ✓ forced-colors-320 | 320; dark | inert production-renderer fixture; synthetic data | [320 dark](visuals/finalpass/after/overview_redesign/forced-colors-320-320-dark.png) |

## Real journey + WebKit smoke

[All metrics](visuals/finalpass/after/results.json)

| Inspected state | Viewports / themes | Method | Evidence |
| --- | --- | --- | --- |
| ✓ 30-passkey-invalid-rp | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/30-passkey-invalid-rp-1440-light.png) · [390 dark](visuals/finalpass/after/30-passkey-invalid-rp-390-dark.png) |
| ✓ empty-overview | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/empty-overview-1440-light.png) · [390 dark](visuals/finalpass/after/empty-overview-390-dark.png) |
| ✓ empty-approvals | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/empty-approvals-1440-light.png) · [390 dark](visuals/finalpass/after/empty-approvals-390-dark.png) |
| ✓ empty-activity | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/empty-activity-1440-light.png) · [390 dark](visuals/finalpass/after/empty-activity-390-dark.png) |
| ✓ empty-recovery | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/empty-recovery-1440-light.png) · [390 dark](visuals/finalpass/after/empty-recovery-390-dark.png) |
| ✓ empty-settings | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/empty-settings-1440-light.png) · [390 dark](visuals/finalpass/after/empty-settings-390-dark.png) |
| ✓ skip-warning | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/skip-warning-1440-light.png) · [390 dark](visuals/finalpass/after/skip-warning-390-dark.png) |
| ✓ 01-welcome | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/01-welcome-1440-light.png) · [390 dark](visuals/finalpass/after/01-welcome-390-dark.png) |
| ✓ 26-passkey-required | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/26-passkey-required-1440-light.png) · [390 dark](visuals/finalpass/after/26-passkey-required-390-dark.png) |
| ✓ 26-passkey-first | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/26-passkey-first-1440-light.png) · [390 dark](visuals/finalpass/after/26-passkey-first-390-dark.png) |
| ✓ 26-passkey-first-forced-colors | 390; dark | isolated real web flow | [390 dark](visuals/finalpass/after/26-passkey-first-forced-colors-390-dark.png) |
| ✓ 27-passkey-pending | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/27-passkey-pending-1440-light.png) · [390 dark](visuals/finalpass/after/27-passkey-pending-390-dark.png) |
| ✓ 27-passkey-cancelled | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/27-passkey-cancelled-1440-light.png) · [390 dark](visuals/finalpass/after/27-passkey-cancelled-390-dark.png) |
| ✓ 28-passkey-prf-unavailable | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/28-passkey-prf-unavailable-1440-light.png) · [390 dark](visuals/finalpass/after/28-passkey-prf-unavailable-390-dark.png) |
| ✓ 29-passkey-protected | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/29-passkey-protected-1440-light.png) · [390 dark](visuals/finalpass/after/29-passkey-protected-390-dark.png) |
| ✓ 02-tutorial-introduction | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/02-tutorial-introduction-1440-light.png) · [390 dark](visuals/finalpass/after/02-tutorial-introduction-390-dark.png) |
| ✓ 03-tutorial-rule | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/03-tutorial-rule-1440-light.png) · [390 dark](visuals/finalpass/after/03-tutorial-rule-390-dark.png) |
| ✓ device-naming | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/device-naming-1440-light.png) · [390 dark](visuals/finalpass/after/device-naming-390-dark.png) |
| ✓ 04-review-default-networks | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/04-review-default-networks-1440-light.png) · [390 dark](visuals/finalpass/after/04-review-default-networks-390-dark.png) |
| ✓ 04-tutorial-review | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/04-tutorial-review-1440-light.png) · [390 dark](visuals/finalpass/after/04-tutorial-review-390-dark.png) |
| ✓ 04-guided-connect | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/04-guided-connect-1440-light.png) · [390 dark](visuals/finalpass/after/04-guided-connect-390-dark.png) |
| ✓ join-device | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/join-device-1440-light.png) · [390 dark](visuals/finalpass/after/join-device-390-dark.png) |
| ✓ 05-device-verification | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/05-device-verification-1440-light.png) · [390 dark](visuals/finalpass/after/05-device-verification-390-dark.png) |
| ✓ wallet-marble-reveal | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/wallet-marble-reveal-1440-light.png) · [390 dark](visuals/finalpass/after/wallet-marble-reveal-390-dark.png) |
| ✓ prepared-optional-backups | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/prepared-optional-backups-1440-light.png) · [390 dark](visuals/finalpass/after/prepared-optional-backups-390-dark.png) |
| ✓ backup-encryption-form | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/backup-encryption-form-1440-light.png) · [390 dark](visuals/finalpass/after/backup-encryption-form-390-dark.png) |
| ✓ backup-file-check | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/backup-file-check-1440-light.png) · [390 dark](visuals/finalpass/after/backup-file-check-390-dark.png) |
| ✓ backup-file-check-error | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/backup-file-check-error-1440-light.png) · [390 dark](visuals/finalpass/after/backup-file-check-error-390-dark.png) |
| ✓ backup-file-checked | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/backup-file-checked-1440-light.png) · [390 dark](visuals/finalpass/after/backup-file-checked-390-dark.png) |
| ✓ import-passphrase | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/import-passphrase-1440-light.png) · [390 dark](visuals/finalpass/after/import-passphrase-390-dark.png) |
| ✓ import-wrong-passphrase | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/import-wrong-passphrase-1440-light.png) · [390 dark](visuals/finalpass/after/import-wrong-passphrase-390-dark.png) |
| ✓ import-verified | 390/768/1024/1440; dark/light | actual recovery of isolated unfunded test signer | [1440 light](visuals/finalpass/after/import-verified-1440-light.png) · [390 dark](visuals/finalpass/after/import-verified-390-dark.png) |
| ✓ wallet-name-demo | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/wallet-name-demo-1440-light.png) · [390 dark](visuals/finalpass/after/wallet-name-demo-390-dark.png) |
| ✓ wallet-name-invalid | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/wallet-name-invalid-1440-light.png) · [390 dark](visuals/finalpass/after/wallet-name-invalid-390-dark.png) |
| ✓ wallet-name-checkout-zec | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/wallet-name-checkout-zec-1440-light.png) · [390 dark](visuals/finalpass/after/wallet-name-checkout-zec-390-dark.png) |
| ✓ wallet-name-checkout-sol | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/wallet-name-checkout-sol-1440-light.png) · [390 dark](visuals/finalpass/after/wallet-name-checkout-sol-390-dark.png) |
| ✓ returning-wallet-collection | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/returning-wallet-collection-1440-light.png) · [390 dark](visuals/finalpass/after/returning-wallet-collection-390-dark.png) |
| ✓ approvals | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/approvals-1440-light.png) · [390 dark](visuals/finalpass/after/approvals-390-dark.png) |
| ✓ activity | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/activity-1440-light.png) · [390 dark](visuals/finalpass/after/activity-390-dark.png) |
| ✓ recipients | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/recipients-1440-light.png) · [390 dark](visuals/finalpass/after/recipients-390-dark.png) |
| ✓ swap | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-1440-light.png) · [390 dark](visuals/finalpass/after/swap-390-dark.png) |
| ✓ chats | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/chats-1440-light.png) · [390 dark](visuals/finalpass/after/chats-390-dark.png) |
| ✓ recovery | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/recovery-1440-light.png) · [390 dark](visuals/finalpass/after/recovery-390-dark.png) |
| ✓ settings | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/settings-1440-light.png) · [390 dark](visuals/finalpass/after/settings-390-dark.png) |
| ✓ recipient-editor | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/recipient-editor-1440-light.png) · [390 dark](visuals/finalpass/after/recipient-editor-390-dark.png) |
| ✓ recipient-error | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/recipient-error-1440-light.png) · [390 dark](visuals/finalpass/after/recipient-error-390-dark.png) |
| ✓ recipient-saved | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/recipient-saved-1440-light.png) · [390 dark](visuals/finalpass/after/recipient-saved-390-dark.png) |
| ✓ recipient-delete-warning | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/recipient-delete-warning-1440-light.png) · [390 dark](visuals/finalpass/after/recipient-delete-warning-390-dark.png) |
| ✓ recipients-no-results | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/recipients-no-results-1440-light.png) · [390 dark](visuals/finalpass/after/recipients-no-results-390-dark.png) |
| ✓ send | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/send-1440-light.png) · [390 dark](visuals/finalpass/after/send-390-dark.png) |
| ✓ send-short-viewport | 390; dark | isolated real web flow | [390 dark](visuals/finalpass/after/send-short-viewport-390-dark.png) |
| ✓ receive | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/receive-1440-light.png) · [390 dark](visuals/finalpass/after/receive-390-dark.png) |
| ✓ receive-short-viewport | 390; dark | isolated real web flow | [390 dark](visuals/finalpass/after/receive-short-viewport-390-dark.png) |
| ✓ settings-guides-frequently-asked-questions | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/settings-guides-frequently-asked-questions-1440-light.png) · [390 dark](visuals/finalpass/after/settings-guides-frequently-asked-questions-390-dark.png) |
| ✓ settings-diagnostics | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/settings-diagnostics-1440-light.png) · [390 dark](visuals/finalpass/after/settings-diagnostics-390-dark.png) |
| ✓ settings-technical-wallet-details | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/settings-technical-wallet-details-1440-light.png) · [390 dark](visuals/finalpass/after/settings-technical-wallet-details-390-dark.png) |
| ✓ settings-network-privacy | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/settings-network-privacy-1440-light.png) · [390 dark](visuals/finalpass/after/settings-network-privacy-390-dark.png) |
| ✓ backup | 390/768/1024/1440; dark/light | existing dialog entry on isolated real wallet | [1440 light](visuals/finalpass/after/backup-1440-light.png) · [390 dark](visuals/finalpass/after/backup-390-dark.png) |
| ✓ backup-check | 390/768/1024/1440; dark/light | existing dialog entry on isolated real wallet | [1440 light](visuals/finalpass/after/backup-check-1440-light.png) · [390 dark](visuals/finalpass/after/backup-check-390-dark.png) |
| ✓ restore | 390/768/1024/1440; dark/light | staged recovery dialog; no import | [1440 light](visuals/finalpass/after/restore-1440-light.png) · [390 dark](visuals/finalpass/after/restore-390-dark.png) |
| ✓ replace | 390/768/1024/1440; dark/light | existing dialog entry on isolated real wallet | [1440 light](visuals/finalpass/after/replace-1440-light.png) · [390 dark](visuals/finalpass/after/replace-390-dark.png) |
| ✓ chat-draft | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/chat-draft-1440-light.png) · [390 dark](visuals/finalpass/after/chat-draft-390-dark.png) |
| ✓ chat-privacy-details | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/chat-privacy-details-1440-light.png) · [390 dark](visuals/finalpass/after/chat-privacy-details-390-dark.png) |
| ✓ swap-private-quote | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-private-quote-1440-light.png) · [390 dark](visuals/finalpass/after/swap-private-quote-390-dark.png) |
| ✓ swap-asset-picker | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-asset-picker-1440-light.png) · [390 dark](visuals/finalpass/after/swap-asset-picker-390-dark.png) |
| ✓ swap-asset-no-results | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-asset-no-results-1440-light.png) · [390 dark](visuals/finalpass/after/swap-asset-no-results-390-dark.png) |
| ✓ swap-private-review | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-private-review-1440-light.png) · [390 dark](visuals/finalpass/after/swap-private-review-390-dark.png) |
| ✓ swap-quantum-introduction | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-quantum-introduction-1440-light.png) · [390 dark](visuals/finalpass/after/swap-quantum-introduction-390-dark.png) |
| ✓ swap-configure | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-configure-1440-light.png) · [390 dark](visuals/finalpass/after/swap-configure-390-dark.png) |
| ✓ swap-quantum-invalid | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-quantum-invalid-1440-light.png) · [390 dark](visuals/finalpass/after/swap-quantum-invalid-390-dark.png) |
| ✓ swap-review | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-review-1440-light.png) · [390 dark](visuals/finalpass/after/swap-review-390-dark.png) |
| ✓ swap-expired | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-expired-1440-light.png) · [390 dark](visuals/finalpass/after/swap-expired-390-dark.png) |
| ✓ swap-approvals-zero | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-approvals-zero-1440-light.png) · [390 dark](visuals/finalpass/after/swap-approvals-zero-390-dark.png) |
| ✓ swap-approvals-one | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-approvals-one-1440-light.png) · [390 dark](visuals/finalpass/after/swap-approvals-one-390-dark.png) |
| ✓ swap-approvals-complete | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-approvals-complete-1440-light.png) · [390 dark](visuals/finalpass/after/swap-approvals-complete-390-dark.png) |
| ✓ swap-deposit-waiting | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-deposit-waiting-1440-light.png) · [390 dark](visuals/finalpass/after/swap-deposit-waiting-390-dark.png) |
| ✓ swap-route-waiting | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-route-waiting-1440-light.png) · [390 dark](visuals/finalpass/after/swap-route-waiting-390-dark.png) |
| ✓ swap-delivery-waiting | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-delivery-waiting-1440-light.png) · [390 dark](visuals/finalpass/after/swap-delivery-waiting-390-dark.png) |
| ✓ swap-delivered | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-delivered-1440-light.png) · [390 dark](visuals/finalpass/after/swap-delivered-390-dark.png) |
| ✓ swap-refund | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-refund-1440-light.png) · [390 dark](visuals/finalpass/after/swap-refund-390-dark.png) |
| ✓ offline | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/offline-1440-light.png) · [390 dark](visuals/finalpass/after/offline-390-dark.png) |
| ✓ feedback-error | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/feedback-error-1440-light.png) · [390 dark](visuals/finalpass/after/feedback-error-390-dark.png) |
| ✓ forced-colors | 390; dark | isolated real web flow | [390 dark](visuals/finalpass/after/forced-colors-390-dark.png) |
| ✓ enlarged-text-settings | 390; dark | isolated real web flow | [390 dark](visuals/finalpass/after/enlarged-text-settings-390-dark.png) |
| ✓ locked | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/locked-1440-light.png) · [390 dark](visuals/finalpass/after/locked-390-dark.png) |
| ✓ blocked-zec-review | 390/768/1024/1440; dark/light | inert production renderer; synthetic refused review | [1440 light](visuals/finalpass/after/blocked-zec-review-1440-light.png) · [390 dark](visuals/finalpass/after/blocked-zec-review-390-dark.png) |
| ✓ webkit-overview | 390/768/1024/1440; dark/light | WebKit production renderer; synthetic state | [1440 light](visuals/finalpass/after/webkit-overview-1440-light.png) · [390 dark](visuals/finalpass/after/webkit-overview-390-dark.png) |
| ✓ webkit-approvals | 390/768/1024/1440; dark/light | WebKit production renderer; synthetic state | [1440 light](visuals/finalpass/after/webkit-approvals-1440-light.png) · [390 dark](visuals/finalpass/after/webkit-approvals-390-dark.png) |
| ✓ webkit-activity | 390/768/1024/1440; dark/light | WebKit production renderer; synthetic state | [1440 light](visuals/finalpass/after/webkit-activity-1440-light.png) · [390 dark](visuals/finalpass/after/webkit-activity-390-dark.png) |
| ✓ webkit-recipients | 390/768/1024/1440; dark/light | WebKit production renderer; synthetic state | [1440 light](visuals/finalpass/after/webkit-recipients-1440-light.png) · [390 dark](visuals/finalpass/after/webkit-recipients-390-dark.png) |
| ✓ webkit-swap | 390/768/1024/1440; dark/light | WebKit production renderer; synthetic state | [1440 light](visuals/finalpass/after/webkit-swap-1440-light.png) · [390 dark](visuals/finalpass/after/webkit-swap-390-dark.png) |
| ✓ webkit-chats | 390/768/1024/1440; dark/light | WebKit production renderer; synthetic state | [1440 light](visuals/finalpass/after/webkit-chats-1440-light.png) · [390 dark](visuals/finalpass/after/webkit-chats-390-dark.png) |
| ✓ webkit-recovery | 390/768/1024/1440; dark/light | WebKit production renderer; synthetic state | [1440 light](visuals/finalpass/after/webkit-recovery-1440-light.png) · [390 dark](visuals/finalpass/after/webkit-recovery-390-dark.png) |
| ✓ webkit-settings | 390/768/1024/1440; dark/light | WebKit production renderer; synthetic state | [1440 light](visuals/finalpass/after/webkit-settings-1440-light.png) · [390 dark](visuals/finalpass/after/webkit-settings-390-dark.png) |
| ✓ webkit-send | 390/768/1024/1440; dark/light | WebKit production dialog; synthetic state | [1440 light](visuals/finalpass/after/webkit-send-1440-light.png) · [390 dark](visuals/finalpass/after/webkit-send-390-dark.png) |
| ✓ webkit-receive | 390/768/1024/1440; dark/light | WebKit production dialog; synthetic state | [1440 light](visuals/finalpass/after/webkit-receive-1440-light.png) · [390 dark](visuals/finalpass/after/webkit-receive-390-dark.png) |
| ✓ webkit-restore | 390/768/1024/1440; dark/light | WebKit production dialog; synthetic state | [1440 light](visuals/finalpass/after/webkit-restore-1440-light.png) · [390 dark](visuals/finalpass/after/webkit-restore-390-dark.png) |
| ✓ webkit-protection | 390/768/1024/1440; dark/light | WebKit real local entry; no wallet creation | [1440 light](visuals/finalpass/after/webkit-protection-1440-light.png) · [390 dark](visuals/finalpass/after/webkit-protection-390-dark.png) |
| ✓ webkit-skip-warning | 390/768/1024/1440; dark/light | WebKit real local opt-out warning | [1440 light](visuals/finalpass/after/webkit-skip-warning-1440-light.png) · [390 dark](visuals/finalpass/after/webkit-skip-warning-390-dark.png) |
| ✓ webkit-approval-rule | 390/768/1024/1440; dark/light | WebKit real setup form; no wallet creation | [1440 light](visuals/finalpass/after/webkit-approval-rule-1440-light.png) · [390 dark](visuals/finalpass/after/webkit-approval-rule-390-dark.png) |
| ✓ webkit-device-naming | 390/768/1024/1440; dark/light | WebKit real setup form; no wallet creation | [1440 light](visuals/finalpass/after/webkit-device-naming-1440-light.png) · [390 dark](visuals/finalpass/after/webkit-device-naming-390-dark.png) |
| ✓ 26-passkey-first-2x320 | 320; dark | isolated real web flow | [320 dark](visuals/finalpass/after/26-passkey-first-2x320-320-dark.png) |
| ✓ 26-passkey-first-2x320-action | 320; dark | isolated real web flow | [320 dark](visuals/finalpass/after/26-passkey-first-2x320-action-320-dark.png) |
| ✓ 02-tutorial-2x-320 | 320; dark | isolated real web flow | [320 dark](visuals/finalpass/after/02-tutorial-2x-320-320-dark.png) |
| ✓ overview | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/overview-1440-light.png) · [390 dark](visuals/finalpass/after/overview-390-dark.png) |
| ✓ mobile-menu | 390; dark | isolated real web flow | [390 dark](visuals/finalpass/after/mobile-menu-390-dark.png) |
| ✓ enlarged-text-overview | 390; dark | isolated real web flow | [390 dark](visuals/finalpass/after/enlarged-text-overview-390-dark.png) |

## settings_design

[All metrics](visuals/finalpass/after/settings_design/results.json)

| Inspected state | Viewports / themes | Method | Evidence |
| --- | --- | --- | --- |
| ✓ wallet | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/settings_design/wallet-1440-light.png) · [390 dark](visuals/finalpass/after/settings_design/wallet-390-dark.png) |
| ✓ wallet-375-dark | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/settings_design/wallet-375-dark-1440-light.png) · [390 dark](visuals/finalpass/after/settings_design/wallet-375-dark-390-dark.png) |
| ✓ wallet-375-light | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/settings_design/wallet-375-light-1440-light.png) · [390 dark](visuals/finalpass/after/settings_design/wallet-375-light-390-dark.png) |
| ✓ wallet-430-dark | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/settings_design/wallet-430-dark-1440-light.png) · [390 dark](visuals/finalpass/after/settings_design/wallet-430-dark-390-dark.png) |
| ✓ wallet-430-light | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/settings_design/wallet-430-light-1440-light.png) · [390 dark](visuals/finalpass/after/settings_design/wallet-430-light-390-dark.png) |
| ✓ wallet-1440-dark-bottom | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/settings_design/wallet-1440-dark-bottom-1440-light.png) · [390 dark](visuals/finalpass/after/settings_design/wallet-1440-dark-bottom-390-dark.png) |
| ✓ wallet-1440-light-bottom | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/settings_design/wallet-1440-light-bottom-1440-light.png) · [390 dark](visuals/finalpass/after/settings_design/wallet-1440-light-bottom-390-dark.png) |
| ✓ expanded-390 | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/settings_design/expanded-390-1440-light.png) · [390 dark](visuals/finalpass/after/settings_design/expanded-390-390-dark.png) |
| ✓ forced-colors-320 | 320; dark | inert production-renderer fixture; synthetic data | [320 dark](visuals/finalpass/after/settings_design/forced-colors-320-320-dark.png) |
| ✓ no-wallet-390 | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/settings_design/no-wallet-390-1440-light.png) · [390 dark](visuals/finalpass/after/settings_design/no-wallet-390-390-dark.png) |

## swap-current

[All metrics](visuals/finalpass/after/swap-current/results.json)

| Inspected state | Viewports / themes | Method | Evidence |
| --- | --- | --- | --- |
| ✓ swap | 390/768/1024/1440; dark/light | current concurrent Swap source; synthetic renderer | [1440 light](visuals/finalpass/after/swap-current/swap-1440-light.png) · [390 dark](visuals/finalpass/after/swap-current/swap-390-dark.png) |
| ✓ swap-private-quote | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-current/swap-private-quote-1440-light.png) · [390 dark](visuals/finalpass/after/swap-current/swap-private-quote-390-dark.png) |
| ✓ swap-asset-picker | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-current/swap-asset-picker-1440-light.png) · [390 dark](visuals/finalpass/after/swap-current/swap-asset-picker-390-dark.png) |
| ✓ swap-asset-no-results | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-current/swap-asset-no-results-1440-light.png) · [390 dark](visuals/finalpass/after/swap-current/swap-asset-no-results-390-dark.png) |
| ✓ swap-private-review | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-current/swap-private-review-1440-light.png) · [390 dark](visuals/finalpass/after/swap-current/swap-private-review-390-dark.png) |
| ✓ swap-quantum-introduction | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-current/swap-quantum-introduction-1440-light.png) · [390 dark](visuals/finalpass/after/swap-current/swap-quantum-introduction-390-dark.png) |
| ✓ swap-configure | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-current/swap-configure-1440-light.png) · [390 dark](visuals/finalpass/after/swap-current/swap-configure-390-dark.png) |
| ✓ swap-quantum-details | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-current/swap-quantum-details-1440-light.png) · [390 dark](visuals/finalpass/after/swap-current/swap-quantum-details-390-dark.png) |
| ✓ swap-quantum-invalid | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-current/swap-quantum-invalid-1440-light.png) · [390 dark](visuals/finalpass/after/swap-current/swap-quantum-invalid-390-dark.png) |
| ✓ swap-review | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-current/swap-review-1440-light.png) · [390 dark](visuals/finalpass/after/swap-current/swap-review-390-dark.png) |
| ✓ swap-expired | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-current/swap-expired-1440-light.png) · [390 dark](visuals/finalpass/after/swap-current/swap-expired-390-dark.png) |
| ✓ swap-approvals-zero | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-current/swap-approvals-zero-1440-light.png) · [390 dark](visuals/finalpass/after/swap-current/swap-approvals-zero-390-dark.png) |
| ✓ swap-approvals-one | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-current/swap-approvals-one-1440-light.png) · [390 dark](visuals/finalpass/after/swap-current/swap-approvals-one-390-dark.png) |
| ✓ swap-approvals-complete | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-current/swap-approvals-complete-1440-light.png) · [390 dark](visuals/finalpass/after/swap-current/swap-approvals-complete-390-dark.png) |
| ✓ swap-deposit-waiting | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-current/swap-deposit-waiting-1440-light.png) · [390 dark](visuals/finalpass/after/swap-current/swap-deposit-waiting-390-dark.png) |
| ✓ swap-route-waiting | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-current/swap-route-waiting-1440-light.png) · [390 dark](visuals/finalpass/after/swap-current/swap-route-waiting-390-dark.png) |
| ✓ swap-delivery-waiting | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-current/swap-delivery-waiting-1440-light.png) · [390 dark](visuals/finalpass/after/swap-current/swap-delivery-waiting-390-dark.png) |
| ✓ swap-delivered | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-current/swap-delivered-1440-light.png) · [390 dark](visuals/finalpass/after/swap-current/swap-delivered-390-dark.png) |
| ✓ swap-refund | 390/768/1024/1440; dark/light | isolated real web flow | [1440 light](visuals/finalpass/after/swap-current/swap-refund-1440-light.png) · [390 dark](visuals/finalpass/after/swap-current/swap-refund-390-dark.png) |

## system

[All metrics](visuals/finalpass/after/system/results.json)

| Inspected state | Viewports / themes | Method | Evidence |
| --- | --- | --- | --- |
| ✓ loading-engine | 390/768/1024/1440; dark/light | inert production renderer; synthetic system state | [1440 light](visuals/finalpass/after/system/loading-engine-1440-light.png) · [390 dark](visuals/finalpass/after/system/loading-engine-390-dark.png) |
| ✓ loading-group | 390/768/1024/1440; dark/light | inert production renderer; synthetic system state | [1440 light](visuals/finalpass/after/system/loading-group-1440-light.png) · [390 dark](visuals/finalpass/after/system/loading-group-390-dark.png) |
| ✓ unreadable-wallet | 390/768/1024/1440; dark/light | inert production renderer; synthetic system state | [1440 light](visuals/finalpass/after/system/unreadable-wallet-1440-light.png) · [390 dark](visuals/finalpass/after/system/unreadable-wallet-390-dark.png) |
| ✓ damaged-vault | 390/768/1024/1440; dark/light | inert production renderer; synthetic system state | [1440 light](visuals/finalpass/after/system/damaged-vault-1440-light.png) · [390 dark](visuals/finalpass/after/system/damaged-vault-390-dark.png) |
| ✓ lost-passkey-warning | 390/768/1024/1440; dark/light | inert production renderer; synthetic system state | [1440 light](visuals/finalpass/after/system/lost-passkey-warning-1440-light.png) · [390 dark](visuals/finalpass/after/system/lost-passkey-warning-390-dark.png) |
| ✓ blocked-zec-review | 390/768/1024/1440; dark/light | inert production renderer; synthetic refused review | [1440 light](visuals/finalpass/after/system/blocked-zec-review-1440-light.png) · [390 dark](visuals/finalpass/after/system/blocked-zec-review-390-dark.png) |

## transaction_receipts

[All metrics](visuals/finalpass/after/transaction_receipts/results.json)

| Inspected state | Viewports / themes | Method | Evidence |
| --- | --- | --- | --- |
| ✓ pending | 390/768/1024/1440; dark/light | inert receipt renderer; synthetic transaction outcome | [1440 light](visuals/finalpass/after/transaction_receipts/pending-1440-light.png) · [390 dark](visuals/finalpass/after/transaction_receipts/pending-390-dark.png) |
| ✓ submitted | 390/768/1024/1440; dark/light | inert receipt renderer; synthetic transaction outcome | [1440 light](visuals/finalpass/after/transaction_receipts/submitted-1440-light.png) · [390 dark](visuals/finalpass/after/transaction_receipts/submitted-390-dark.png) |
| ✓ submitted-execution | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/transaction_receipts/submitted-execution-1440-light.png) · [390 dark](visuals/finalpass/after/transaction_receipts/submitted-execution-390-dark.png) |
| ✓ confirmed | 390/768/1024/1440; dark/light | inert receipt renderer; synthetic transaction outcome | [1440 light](visuals/finalpass/after/transaction_receipts/confirmed-1440-light.png) · [390 dark](visuals/finalpass/after/transaction_receipts/confirmed-390-dark.png) |
| ✓ failed | 390/768/1024/1440; dark/light | inert receipt renderer; synthetic transaction outcome | [1440 light](visuals/finalpass/after/transaction_receipts/failed-1440-light.png) · [390 dark](visuals/finalpass/after/transaction_receipts/failed-390-dark.png) |
| ✓ stale | 390/768/1024/1440; dark/light | inert receipt renderer; synthetic transaction outcome | [1440 light](visuals/finalpass/after/transaction_receipts/stale-1440-light.png) · [390 dark](visuals/finalpass/after/transaction_receipts/stale-390-dark.png) |
| ✓ unreadable | 390/768/1024/1440; dark/light | inert receipt renderer; synthetic transaction outcome | [1440 light](visuals/finalpass/after/transaction_receipts/unreadable-1440-light.png) · [390 dark](visuals/finalpass/after/transaction_receipts/unreadable-390-dark.png) |
| ✓ large | 390/768/1024/1440; dark/light | inert receipt renderer; synthetic transaction outcome | [1440 light](visuals/finalpass/after/transaction_receipts/large-1440-light.png) · [390 dark](visuals/finalpass/after/transaction_receipts/large-390-dark.png) |
| ✓ sol-expired | 390/768/1024/1440; dark/light | inert receipt renderer; synthetic transaction outcome | [1440 light](visuals/finalpass/after/transaction_receipts/sol-expired-1440-light.png) · [390 dark](visuals/finalpass/after/transaction_receipts/sol-expired-390-dark.png) |
| ✓ sol-sent | 390/768/1024/1440; dark/light | inert receipt renderer; synthetic transaction outcome | [1440 light](visuals/finalpass/after/transaction_receipts/sol-sent-1440-light.png) · [390 dark](visuals/finalpass/after/transaction_receipts/sol-sent-390-dark.png) |
| ✓ sol-failed | 390/768/1024/1440; dark/light | inert receipt renderer; synthetic transaction outcome | [1440 light](visuals/finalpass/after/transaction_receipts/sol-failed-1440-light.png) · [390 dark](visuals/finalpass/after/transaction_receipts/sol-failed-390-dark.png) |

## wallet_header

[All metrics](visuals/finalpass/after/wallet_header/results.json)

| Inspected state | Viewports / themes | Method | Evidence |
| --- | --- | --- | --- |
| ✓ swap | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/wallet_header/swap-1440-light.png) · [390 dark](visuals/finalpass/after/wallet_header/swap-390-dark.png) |
| ✓ settings | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/wallet_header/settings-1440-light.png) · [390 dark](visuals/finalpass/after/wallet_header/settings-390-dark.png) |
| ✓ header-preferences-320 | 390/768/1024/1440; dark/light | inert production-renderer fixture; synthetic data | [1440 light](visuals/finalpass/after/wallet_header/header-preferences-320-1440-light.png) · [390 dark](visuals/finalpass/after/wallet_header/header-preferences-320-390-dark.png) |

## Additional accessibility checks

[78 explicit checks and measured browser zoom](visuals/finalpass/after/accessibility/validation.json).
Chrome’s own Page zoom was set to 200% in a disposable profile: outer width 1440px, inner width 720 CSS px, DPR 2.
Overview, Activity, Security and Settings reflowed without page overflow.
Doubled setup headings and controls were checked at 320/390/768/1024/1440px in both themes, with persistent test CSS so ordinary redraws cannot reset the text size.

## Coverage limits

Physical Safari, phones, software keyboards, assistive technology and real passkey providers were not tested.
No real funds, network payment, live quote, live prover or live chain confirmation was tested.
Unavailable capabilities remain unavailable; staged failure and transaction outcomes are labelled as synthetic.
