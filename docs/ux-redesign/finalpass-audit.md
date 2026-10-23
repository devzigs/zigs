# Final pre-beta UI/UX audit

The remaining gates were resolved in the [follow-up](finalpass-followup.md). See its publication note for the exact scope carried onto the newer UX/UI branch.

23 October 2026 · `codex/finalpass` · Web only

The finishing pass fixes reproducible accessibility and consistency defects across six presentation files. It preserves the current design, canonical zebra artwork, optional protection/backups, approved USD placeholder and unavailable/demo boundaries. No wallet, signing, network, recovery-format, dependency or native implementation changed.

**Result:** 207 state entries and 1558 recorded viewport/theme cases reviewed; no horizontal page/dialog overflow, missing field labels or undersized enabled controls in the completed matrix. Chrome real local journeys and WebKit smoke checks passed. **Unconditional beta sign-off remains withheld:** repository-wide lint and the longer setup suite have outstanding validation failures described below.

[Detailed screen checklist](finalpass-coverage.md) · [Validation summary and source hashes](finalpass-validation.json) · [Isolated polish patch](finalpass-changes.patch)

## Starting state and attribution

- Starting commit: `139d6eaa5d74d74dcd73a9583345d4b49c6bd8d5`; fetched technical reference main: `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.
- The initial working tree already contained UI work. Its binary diff, manifest and 52 working files were saved under ignored `solspike/.state/finalpass-baseline/` before implementation. No reset, stash, commit, merge, push or deployment was performed.
- The isolated patch compares against that working tree, rather than attributing inherited edits to this pass. New audit tools, this report and evidence sit alongside it.
- Concurrent edits appeared in `web/app-swap-preview.js`, `web/app-postquantum-swap-preview.js` and `web/swap-preview.css`. They were preserved and excluded from the polish patch. Their latest presentation received a separate current-source synthetic audit in `swap-current`; earlier journey captures are retained as earlier observations, not the latest Swap layout.

## Issues fixed

| Severity | Reproduction | Correction / verification |
| --- | --- | --- |
| Major | WebKit: Tab from the recovery passphrase field skipped Cancel and left the modal. | Explicit modal Tab progression, including visible banner dismissal; checked radio groups retain one Tab stop and native arrow keys. Chrome/WebKit repeated forward/reverse traversal and existing application regressions pass. |
| Major | WebKit: Appearance, saved-recipient and preview-destination selects rendered 21–26px tall. | Font-aware explicit height restores the existing 48px target while preserving native arrows and keyboard behavior. WebKit matrix and enlarged text verified. |
| Major | Text-only enlargement made setup headings overlap progress and let the sticky footer cover content. | Intrinsic grid rows, scalable heading/helper leading and a bounded, scrollable action bar. Ten width/theme regressions confirm heading separation and reachable protection controls. |
| Moderate | Very long/enlarged wallet names overlapped lines or let the pinned header dominate the viewport. | Scalable header/description leading and a scrollable header capped at half the viewport. Persistent identity/navigation and 469 existing header checks pass. |
| Moderate | Enlarged Overview action labels collided in a fixed three-column row. | Existing actions wrap according to available width and text size; normal desktop/mobile appearance is retained. Large-value, enlarged-text and real zoom checks pass. |
| Minor | Landing secondary actions and sidebar rows were 44–46px; Activity filters and optional file-check disclosure were 44px. | Reused the existing control-height token. The completed matrix has no sub-48px enabled controls. |

Before/after examples: [landing before](visuals/finalpass/before/empty-overview-390-dark.png) / [after](visuals/finalpass/after/empty-overview-390-dark.png); [Activity before](visuals/finalpass/before/activity_design/populated-390-dark.png) / [after](visuals/finalpass/after/activity_design/populated-390-dark.png); [WebKit Settings before](visuals/finalpass/before/webkit-settings-390-dark.png) / [after](visuals/finalpass/after/webkit-settings-390-dark.png).

[Enlarged setup verification](visuals/finalpass/after/accessibility/setup-text-200-320-dark.png) · [Real 200% browser zoom](visuals/finalpass/after/accessibility/zoom-200-overview.png).

## Screens and journeys inspected

Landing/new and returning wallet collections; switching/header/navigation/mobile menu; optional passkey warning, pending, cancellation, unsupported/refused and protected states; all create/join/30-digit verification/reveal/optional backup/naming steps; Overview and native asset precision; Send/Receive and short dialogs; Approvals, Activity, recipients, Messages, Security, Settings, Help and diagnostics; Swap preview and post-quantum demo stages; startup/loading, unreadable, locked/damaged, offline, feedback, validation and failure states.

The real local journey formed an unfunded wallet in three isolated stores, saved an encrypted signer backup, rejected a wrong file-check passphrase, verified the saved file read-only, imported it into a fourth disposable store, rejected a wrong import passphrase, verified the restored signer, kept a message draft across navigation, and exercised lock/unlock with virtual WebAuthn. No actual payment was prepared or broadcast. Chain display data is synthetic.

Populated histories, approval progress, refused/expired/submitted/confirmed/failed outcomes, system failures and some dialogs use labelled production-renderer fixtures. These establish UI behavior only. No simulated confirmation is counted as a live chain test.

## Verification

| Check | Result |
| --- | --- |
| Node 24 fast runner | 48 suites pass; QR suite explicitly skipped because `qrencode` is unavailable. |
| Existing application suite | `app ok`; keyboard expectations updated for explicit cross-browser progression, with radio-group regressions added. |
| Current real local journey | 37 inherited ceremony/protection checks plus successful final-pass action groups; zero uncaught browser errors. |
| Existing presentation suites | Activity 161; Approvals 51; Settings 52; Messages 145; receipts 108; Overview 70; persistent header 469 checks pass. Old avatar/switcher and top-alignment assumptions are adapted only in ignored generated runners to the current header/masonry presentation; the source suites are preserved. |
| Accessibility | 78 explicit checks pass: repeated Chrome/WebKit keyboard loops, real 200% Chrome zoom, and enlarged setup text at five widths in both themes. |
| Focused static checks | Changed production module and all new audit tools pass their applicable oxlint configurations. No separate dedicated type-check command exists in this JavaScript project. |
| Full repository lint | Fails. The original strict pass had 30 distinct normalized findings; rerunning that pass separately yields the same set, with no additions from these changes. The full script now stops earlier on an unqualified `MutationObserver` in the concurrently edited post-quantum demo. |
| Longer unified setup suite | Fails at `messages: no duplicate Overview heading` (expected 1, actual 0). Reproduced identically in a separate copy of the saved baseline. The pre-existing modified test was preserved. |

Chrome 155.0.8059.85, Playwright 1.62.1, Node 24.19.0. WebKit is the installed Playwright engine, not an actual Safari/device certification. Four required widths (1440/1024/768/390px), light/dark themes, plus 320px/enlargement/forced-color/short-height cases were inspected. Screenshots omit private QR/code/file/passphrase regions; hashes and all matrix measurements are retained even where only representative images are kept.

## Remaining issues and engineering review

- **Release/validation gates:** resolve existing strict-lint findings, the concurrent demo’s page-module lint failure, and the baseline unified-setup assertion before treating all required checks as green. These were not hidden, disabled or attributed to this polish.
- **Validation limits:** funded payment execution/finality, live Solana/prover/network failures, physical Safari/phones, real biometrics/passkey synchronization, software keyboards, assistive technology and QR decoding remain unverified. No readiness claim covers them.
- **Minor intentional states:** disabled Max controls in the preview remain compact and are excluded from enabled-target acceptance. USD remains a disclosed placeholder; Swap and naming remain explicitly simulated; unsupported USDC remains unavailable.
- **Engineering proposals:** no new capability is proposed. Implementing live swaps, pricing, new protection/recovery semantics or changing transaction handling requires separate approval; see the [technical-review backlog](ux-ui-final-technical-review.md).

## Reproduce locally

Use Node 24, an installed Playwright module and Chrome executable. Start an isolated local Worker at `http://localhost:8872` serving this checkout, with disposable local storage, local no-auth testing and the synthetic Solana endpoint; no production credentials. The generated local configuration remains in ignored `solspike/.state/finalpass/wrangler.json`.

```sh
ZIGS_AUDIT_PHASE=after node solspike/tools/finalpass_browser.mjs
ZIGS_AUDIT_PHASE=after node solspike/tools/finalpass_browser.mjs --system
ZIGS_AUDIT_PHASE=after node solspike/tools/finalpass_browser.mjs --swap
ZIGS_AUDIT_PHASE=after node solspike/tools/finalpass_fixture.mjs activity_design
node solspike/tools/finalpass_accessibility.mjs
sh scripts/test-fast.sh
node web/test/app.mjs
node web/test/unified-setup.mjs
bash solspike/lint.sh
```

The fixture adapter also accepts `approvals_experience`, `settings_design`, `messaging_redesign`, `transaction_receipts`, `overview_redesign` and `wallet_header`. Set `PLAYWRIGHT_MODULE` and `CHROME_EXECUTABLE` to the installed runtime paths. Test-only CSS is served from the same local origin; the application’s CSP is not weakened.

## Publication onto the current UX/UI branch

The final-pass changes were applied separately onto UX/UI commit `bdd7403` for publication. Newer homepage and privacy-menu work is preserved. Earlier uncommitted header, marble, naming, harness and concurrent Swap work remains in the original checkout and is excluded from this commit. Header sizing rules are retained as scoped CSS; they become active when that separate header work is published. The matrix evidence above records the original audited working tree, not the newer publication tree. Publication checks are recorded below; they do not replace the audit or establish full coverage of the combined branch.

Publication verification on the combined tree: Node 24 fast runner passes all 48 suites (QR decoding still skipped); focused static checks and whitespace checks pass. A fresh Chrome/WebKit recovery-dialog smoke check passes 53 keyboard/dismissal assertions with no page errors. The application suite fails at `the review of a closed Send does not open`; this reproduces unchanged on the untouched `bdd7403` target with Node 24. Full lint stops at the existing post-quantum `MutationObserver` finding. No full matrix rerun or unconditional release signoff is claimed for the publication tree.


## Recovery of excluded UI follow-ups — 23 October 2026

The later creation-reveal rotation and compact optional-name checkout were present only in
the uncommitted `codex/finalpass` working tree. The publication described above deliberately
excluded them; the original marble/header integration did not include these follow-ups.

The two presentation fixes are now reapplied to `codex/ux-ui-final`: the creation reveal uses
the existing rotating marble controller at its larger display size, and the optional-name form
and non-payable checkout reuse the preserved compact layout and copy. The source checkout is
unchanged. The fullscreen guide, latest landing-page adjustments and private local Helius
configuration are preserved. Other unpublished header, harness and concurrent work in that
checkout is not represented by this restoration.

Fresh verification on the combined UI/UX tree: all 73 focused marble browser checks pass,
including the creation reveal, pause/resume, redraw continuity, reduced motion, forced colors
and unavailable-WebGL fallback. The restored naming component passes 36 layout views in both
themes, including scroll-free desktop layouts at 1280 × 720, 1366 × 768 and 1440 × 900; invalid
names, normalization, both currencies, edit focus and Skip navigation also pass. All 48 fast
regression suites pass; QR decoding remains skipped because `qrencode` is unavailable.
These checks use synthetic display fixtures and do not claim funded payment execution.


## Remaining header follow-ups published — 23 October 2026

The persistent wallet header, readable tablet wallet names, Swap alignment and consistent
Security labels excluded from the earlier publication are now restored. The newer guide,
landing page and privacy popup are retained. The global privacy status is excluded from the
header's identity comparison so its separate mount does not restart the spinning marble.
See [persistent wallet header](persistent-wallet-header.md) for scope and fresh verification.

An isolated snapshot of this publication passes 663 focused header browser assertions,
all 48 fast suites (QR decoding skipped), the application suite and the longer unified setup
suite. Existing guide and landing assertions now follow the current modal presentation.
The user's excluded recovery/device-replacement implementation and concurrent funding-preview
work remain outside this publication. No merge or deployment is performed.
