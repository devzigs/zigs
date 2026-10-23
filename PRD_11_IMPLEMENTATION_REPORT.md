# Distributed security visual system

## Branch and scope

- Work is on `codex/ux-navigation`, initially identical to `codex/ux-ui-final` at `4cd81dffac9c7f3a218ffb3c512ae301d22da164`. The requested branch already existed and was selected before editing.
- Eventual target: `codex/ux-ui-final`. No merge, deployment or push was performed. Main was not modified.
- Reviewed fetched `origin/main` at `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`: README creation/signing model, `wasm/src/lib.rs` DKG and signature aggregation, and the existing wallet rule/roster presentation.
- Presentation only. Existing concurrent work and staging are excluded from this change using a separate Git index.

## Focused defects addressed

1. Highlighted example devices could resemble active approvals. The replacement is static and explicitly labelled as an illustration or wallet configuration.
2. The shared-wallet container did not explain the distinction between independent shares and an authorization outcome. Separate nodes now lead to a labelled rule, without a central key or reconstruction step.
3. Setup and Security & Recovery lacked the same visual explanation. Both now use one presentational component and semantics map.
4. Compact device cards crowded labels on small screens. Mobile uses a vertical sequence; text scaling can wrap the rule below its ring.

## Affected screens and components

- `web/app-security.js`: shared `distributedSecurity` figure and its colour/glyph/copy semantics map. It has no store, subscription, protocol actions or timers.
- `web/security-visuals.css`: theme-token styling, neutral machined nodes, dashed group boundary, rule ring, responsive sequence and forced-colour fallback. No animation or glass dependency.
- `web/app-tutorial.js`: approval-rule and device-name previews reuse the figure. Existing preview replacement, edited labels and invalid-input handling remain in place.
- `web/app-wallet.js`: formed-wallet Security & Recovery reads `state.g.n`, `state.g.t` and existing roster labels. Missing roster entries are not invented; no presence, identity or approval status is asserted. Incomplete formation keeps its existing roster view.
- `web/app.js` and `web/app.css`: register the module and stylesheet.
- `solspike/harness/test-wallet-snapshots.mjs`: preserve semantic figure/caption tags in sanitized presentation exports.
- `solspike/tools/distributed_security_browser.mjs`: isolated synthetic presentation checks and screenshots.

## Implemented and deferred

Implemented: shared grammar in two existing screens, visible text equivalents, explicitly non-operational examples, real configuration inputs, missing-data fallback, mobile/light/dark/forced-colour layouts and a static reduced-motion experience. Spending-key copy explicitly refers to Zcash; viewing access remains separate.

Deferred: event-lit contributions, authorization-completion seals, broadcast/confirmation feedback and adoption by other tutorial sequences. These require their own exact stage evidence and are not implied by this configuration diagram. Independent technical/security review remains pending. Referenced master PRD and screenshot files were not present beside the supplied brief, so implementation follows the running component/token architecture.

Protected cryptography, signing, DKG, recovery formats, passkeys, authorization gates, transaction amounts/fees, network routing and state management were untouched by this change. No additional privacy or Solana capability claims were added.

## Verification and evidence

- 64 isolated Chromium presentation checks passed: 390px and 1440px, both themes; 320px with seven devices, long labels and doubled text; missing roster data; forced colours; reduced and ordinary motion; existing preview count/rule/name updates; focus retention; unsupported-rule fallback.
- `guided-create`, `contrast`, `premium-motion` (16 cases) and `unified-setup` passed. Changed JavaScript parses; whitespace checks pass.
- Registered fast tests were also run individually with Node 24 because the suite wrapper rejects a concurrently added, unregistered `outcome-seal.mjs` test. 40 passed, including `demo-check` (19 cases) rerun with local-listener access; `qr` skipped because `qrencode` is unavailable. This change registers its own new module; remaining `graph` errors concern concurrent outcome/approval module registrations.
- Before evidence: `docs/ux-redesign/visuals/distributed-security/before/` (eight captures). Initial working-tree presentation sources were saved before edits. The recovery baseline records its previous text-only introduction.
- After evidence: `docs/ux-redesign/visuals/distributed-security/after/` (twelve captures). Key files: `setup-1440-dark.png`, `setup-390-light.png`, `recovery-390-dark.png`, `setup-320-light-stress.png`, `recovery-320-light-stress.png`, `setup-390-dark-forced-colors.png`.
- Machine-readable results: `docs/ux-redesign/distributed-security-before-validation.json` and `docs/ux-redesign/distributed-security-after-validation.json`.
- All 20 PNGs contain no text/EXIF metadata. Captures contain synthetic device/wallet labels only, with no keys, addresses, balances or live wallet data.

Visual QA covers isolated production presentation components, not full live wallet journeys. Physical touch devices, screen-reader speech, live multi-device signing and independent security review were not tested. The new figure adds no focusable controls; existing form behavior is covered by the setup tests and preview focus check.

## Authorized merge follow-up · 22 October 2026

The user subsequently authorized merging into `codex/ux-ui-final`. The merge uses the feature snapshot `3554c7355336f8b049ed77e28808c877e700d4de`, which includes security commit `9c9db1c`, and preserves the target's existing documentation and landing changes. Newer commits made concurrently on the feature branch are outside this merge snapshot; uncommitted feature work is preserved.

Integration fixes register the existing approval/outcome modules, name the DOM-dependent approval module `app-approval-visualization.js` to satisfy the repository's page-module boundary, update its imports/browser harness, and register the outcome-seal test in both suite lists. No approval, signing or payment behavior changes.

Merge validation: all 42 fast suites passed with Node 24 (`qr` skipped: `qrencode` unavailable), the module graph passed for 54 modules including a locked vault, the app and unified-setup suites passed, and all 64 distributed-security browser checks passed again. Web-only scope and whitespace checks passed. No push or deployment was performed; `main` remains unchanged.
