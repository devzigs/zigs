# Compact saved wallets and persistent zebra hierarchy

22 October 2026 · Web only · Baseline `7e2274c` · Technical reference `origin/main` at `3a6c08e`

Saved wallets now use compact theme-aware rows beneath the hero. The supplied zebra remains
present for new and returning users, including narrow screens. Normal wallet rows measure
about 94px rather than the previous 236–280px cards; long names wrap rather than truncate.
Network, approval rule, balance/setup status, view-only indication and notification badges remain.
Existing wallet opening, setup resumption and Create/Join/Recover handlers are unchanged.

One refinement moved the phone view-only label beside status and tightened badge geometry.
No wallet, authentication, storage, API, security, routing or native application changes.

| View | Before | After |
| --- | --- | --- |
| One wallet · desktop · light | [Before](visuals/compact-wallet-entry/before/one-1440-light.png) | [After](visuals/compact-wallet-entry/after/one-1440-light.png) |
| Multiple wallets · phone · dark | [Before](visuals/compact-wallet-entry/before/many-390-dark.png) | [After](visuals/compact-wallet-entry/after/many-390-dark.png) |

Captured 24 matching views per phase: zero/one/multiple wallets at 320, 390, 1024 and 1440px,
in light/dark themes. Inspected representative rendered desktop and phone screenshots; 16
matched returning-user captures are retained here. No horizontal overflow, undersized entry
controls or browser errors were detected. Long collections may scroll vertically. Fixtures use
temporary runtime-only metadata, never user keys, funds or persisted wallet changes.

[Validation](compact-wallet-entry-validation.json): 659 existing browser journey checks pass,
including system themes, reduced preferences, forced colors, enlarged text, entry actions and
retained wallet states. Updated unified-setup regression, page lint, strict changed-test/harness
lint and Worker build dry-run pass. Node 24 fast tests pass 41/42 suites; the documented baseline
graph import-list mismatch remains. QR checks are skipped without `qrencode`.

Headless Chrome 155 on desktop macOS; phone sizes are browser emulation, not physical-device
or assistive-technology testing. Canonical zebra artwork is unchanged. Local preview remains
at `http://127.0.0.1:55846/`. No push, merge or deployment.
