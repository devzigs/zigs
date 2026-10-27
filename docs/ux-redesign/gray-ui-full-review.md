# Gray UI — follow-up full UI/UX check

25 October 2026 · `gray-ui` · reviewed baseline `d82390c8`.

This review checks the current web application after the motion pass. Four presentation
issues were found and fixed. The existing technical baseline remains main `c6860f6f`.
Main and the original UI branch were verified unchanged; no merge or deployment is authorized.

## Findings and fixes

| Finding | Before | Delivered fix |
| --- | --- | --- |
| Mobile conversation composer can be clipped | The fixed-height conversation pane cannot accommodate an invite card, warnings and the composer. At 320 × 360, the focused field extends from y=312 to y=382, beyond the viewport and with an obscured center. | Let mobile conversation forms grow in document flow, bound only the history area and remove the nested sticky composer. The same focused field now sits at y=156–226 and is unobscured. No message, draft, submit, trust or transport logic changes. |
| Two Back arrows in on-chain chat | The new SVG coexists with an older CSS-generated arrow. The accessible name is simply “Messages.” | Remove the duplicate CSS glyph and name the existing action “Back to conversations.” Preserve its current handler. |
| Small Swap amount fields on phones | Text-driven height falls to about 38 px at 320 px width, or 41 px at 390 px. | Give both amount fields a 48 px minimum height without changing their font size, values, demo status or calculation. The intentionally disabled Max control stays unavailable. |
| Compact demo badge has a narrow tap area | Its visible 28 px phone pill has an expanded pointer area of about 40 px after accounting for its border. | Expand the transparent hit area to 50 px on phones while retaining the visible pill size. Check real hit-testing near both edges rather than treating its small visible rectangle as its entire target. |

The [matching comparison](https://github.com/devzigs/zigs/blob/a3257fb22a3c64ad8b32533dbd212ffa47bcc2ba/docs/ux-redesign/visuals/gray-ui-full-review/comparison.json) reads the four old
presentation files directly from `d82390c8`; it does not modify the checkout or use an older
engine. Compare the [old Back button](https://github.com/devzigs/zigs/blob/a3257fb22a3c64ad8b32533dbd212ffa47bcc2ba/docs/ux-redesign/visuals/gray-ui-full-review/contact-before.png) and
[corrected Back button](https://github.com/devzigs/zigs/blob/a3257fb22a3c64ad8b32533dbd212ffa47bcc2ba/docs/ux-redesign/visuals/gray-ui-full-review/contact-after.png), and the
[clipped short-viewport composer](https://github.com/devzigs/zigs/blob/a3257fb22a3c64ad8b32533dbd212ffa47bcc2ba/docs/ux-redesign/visuals/gray-ui-full-review/invite-short-before.png) with
the [corrected composer](https://github.com/devzigs/zigs/blob/a3257fb22a3c64ad8b32533dbd212ffa47bcc2ba/docs/ux-redesign/visuals/gray-ui-full-review/invite-short-after.png).

## Review coverage

| Area | Checked |
| --- | --- |
| Main destinations | Home, Overview, Approvals, Activity, Address book, Swap demo, Messages, Security and Settings at 320, 390, 768 and 1440 px, in dark/light themes. |
| Form flows | Setup protection/rule/device/review and explicit Skip, replacement wallet, backup export/check/restore, direct chat creation/invite/leave, contact creation, locked-data deletion, Send, payment review/mismatch, Receive, recipient editing and network privacy. |
| Populated messaging | Team, direct relay, on-chain contact, changed-key warning, unclaimed invite and messaging account setup. Fresh pages isolate scenarios; no messages or transactions are submitted. |
| Focus and navigation | Actual browser accessibility-tree control names, persistent field labels, ARIA references, unique IDs, mobile Menu/Tab/Escape and restored focus. Focused composers tested at normal and 360 px-tall phone sizes. Exploratory form focus checks also included links and disclosure summaries. |
| Content stress | Long unbroken wallet/device names, an international device name, large synthetic balances, complete addresses, warnings and recovery consequences. |
| Readability and motion | Both themes, source palette/guide regressions, rendered solid-background text inspection, actual 100%/200% Chrome zoom, reduced motion, forced colors, hidden documents, hover, press and dialog focus. Gradients are not certified by the solid-background contrast heuristic. |

## Results and reproducibility

- [Expanded UI/accessibility review](https://github.com/devzigs/zigs/blob/a3257fb22a3c64ad8b32533dbd212ffa47bcc2ba/docs/ux-redesign/visuals/gray-ui-full-review/full-ui-report.json):
  **947 checks passed**, **148 layouts**, **50 composer-focus variants**, no browser errors.
  This includes 72 page variants, 40 long-content variants and 36 populated messaging variants.
- [Flow regression](https://github.com/devzigs/zigs/blob/a3257fb22a3c64ad8b32533dbd212ffa47bcc2ba/docs/ux-redesign/visuals/gray-ui-full-review/flows-report.json):
  **523 checks / 124 rendered states passed**.
- [Motion regression](https://github.com/devzigs/zigs/blob/a3257fb22a3c64ad8b32533dbd212ffa47bcc2ba/docs/ux-redesign/visuals/gray-ui-full-review/motion-report.json):
  **216 checks / 72 page variants passed**.
- [Visual/guide regression](https://github.com/devzigs/zigs/blob/a3257fb22a3c64ad8b32533dbd212ffa47bcc2ba/docs/ux-redesign/visuals/gray-ui-full-review/style-report.json):
  **511 checks / 31 captures passed**, including all five journeys and ten reference chapters.
- [Actual browser zoom](https://github.com/devzigs/zigs/blob/a3257fb22a3c64ad8b32533dbd212ffa47bcc2ba/docs/ux-redesign/visuals/gray-ui-full-review/zoom-report.json):
  100% and 200% passed, including reachable dismissal and focus restoration.
- Node 26 required fast suite: **48 tests passed**. The separate QR decoder test remains
  skipped because `qrencode` is absent; browser QR visibility and stability checks run.
- Lint: **242 JavaScript and 2 Python files passed**. Whitespace checks pass.
- [Scope audit](gray-ui-full-review-audit.json) records hashes and the unchanged direct DOM
  event-handler expressions. No wallet model, authentication, payment, API, storage, engine,
  native implementation, logo, font or asset changed.

The new reproducible check is `solspike/tools/full_ui_review_browser.mjs`. It accepts
`PLAYWRIGHT_MODULE`, `CHROME_EXECUTABLE` and `ZIGS_FULL_UI_OUTPUT`. The existing fixture's
optional messaging mode reuses the existing synthetic conversation renderer and suppresses
background engine/relay work only inside the test context; normal fixture behavior is retained.
The review blocks external requests and uses disposable synthetic data throughout.

This is a web UI/UX review, not a funded transaction or native-device certification.
Physical mobile keyboards, assistive technology and Safari require their own device testing.
