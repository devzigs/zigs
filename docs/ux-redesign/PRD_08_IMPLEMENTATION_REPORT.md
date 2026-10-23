# PRD 08 — Microinteraction craft

Web-only presentation slice on `codex/ux-navigation`. At discovery its HEAD exactly matched
`codex/ux-ui-final`: `4cd81dffac9c7f3a218ffb3c512ae301d22da164`. Eventual merge target remains
`codex/ux-ui-final`. No merge, push or deployment was performed by this pass.
Technical reference reviewed: existing fetched main `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.

## Ranked defects and implementation

1. Navigation, rows and disclosure triggers lacked the shared button press/release grammar.
   They now reuse the existing 80/140ms tokens, with a maximum one-pixel press. Keyboard focus
   stays stationary. Selected navigation has a themed inset edge and 180ms surface transitions.
2. Pointer hover fills could remain after touch. Touch now restores each control's semantic
   resting surface; new hover treatments require a fine pointer. Disclosure targets are at least 44px.
3. Invalid and disabled inputs lacked shared presentation. Existing `aria-invalid` now produces
   a persistent error edge and error-colored focus; disabled fields retain readable theme colors.
4. Existing heading entrances moved six pixels. They now use four pixels at full text opacity.
   Wallet popovers receive a short four-pixel entrance where that existing surface is present.

Affected primitives: `.btn`, `.icon-btn`, `.side-item`, `.row-item`, `.asset-choice`,
`.guided-stage-button`, `.wallet-select`, `.input` and native `summary` controls in `web/app.css`.
Screens include welcome/setup/join, Overview and its asset disclosures, Approvals, Activity,
Address book, Swap, Chats, Security & Recovery and Settings.

Disclosures retain native immediate height changes. Reduced motion removes press movement and
transitions; forced colors retain focus and selection. Existing pending labels and gates remain
authoritative. No new timer, progress animation, status producer, delayed handler or outgoing
wallet surface is introduced. Full pending-label width retention, animated disclosure height,
haptics and transaction-flow redesign are deferred beyond this CSS slice.

## Verification and evidence

- Pinned source comparison: base `4cd81df`, then that same source plus this CSS slice. Identical
  cached synthetic, read-only wallet snapshots were used in both phases; all requests were
  intercepted locally and service requests refused. Browser stores were fresh.
- Chromium: **54/54 checks pass** for the isolated slice; **54/54 pass** against the integrated
  worktree. Covers eight navigation links and two native disclosures, rapid input, interrupted
  press, ARIA-disabled feedback, actual setup-dialog focus/close, invalid join draft/focus, touch, 4× CPU throttling,
  forced colors, reduced motion, no idle animation, and disclosure height at 200% text size.
- Both themes captured at 1440px and 390px. Paths:
  `visuals/microinteractions/{before,after}/{overview,welcome}-{1440,390}-{dark,light}.png`.
  Additional error, expanded-disclosure and forced-color captures are in `after/`.
  PNGs contain no textual or EXIF metadata. No real wallet data was used.
- [Pinned interaction recording](visuals/microinteractions/after/interactions.webm),
  [isolated checks](visuals/microinteractions/after/validation.json), and
  [integrated checks](visuals/microinteractions/integrated/validation.json).
- Node 24: premium-motion, contrast, optional-passkey and guided-create pass (19 reported tests);
  app and unified-setup pass (2 suites). Contrast checks cover both existing theme palettes.
  Browser runner passes oxlint; `git diff --check` and anonymous identity validation pass.
- The fast-suite wrapper initially stopped on a concurrently added, unregistered
  `web/test/outcome-seal.mjs`; the relevant suites above were run directly.

Reproduction: Node 24, installed Playwright (`PLAYWRIGHT_MODULE`), and optionally
`CHROME_EXECUTABLE`; run `node solspike/tools/microinteraction_browser.mjs`. Its optional
`ZIGS_MICRO_WEB`, `ZIGS_MICRO_SAMPLES`, `ZIGS_MICRO_CSS`, `ZIGS_MICRO_PHASE` and
`ZIGS_MICRO_LABEL` select frozen sources and evidence destinations without editing the app.

Manual screen-reader speech, Safari, full browser zoom and real signed-transaction testing were
not performed. Automated checks exercise actual roles, focus and invalid-state semantics;
wallet snapshots cannot establish live payment or wallet-switch coherency.

This change touches no protected crypto/transaction logic, custody, DKG, recovery, authentication,
state management, fee/amount calculations, recipient verification, network routing or native code.
Unrelated concurrent edits are excluded from this feature commit.
