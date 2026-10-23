# PRD 07 — Ambient lighting and depth

Feature branch: `codex/ux-navigation`. Confirmed its starting HEAD and intended merge target
`codex/ux-ui-final` were both `4cd81dffac9c7f3a218ffb3c512ae301d22da164`.
Technical reference: freshly fetched `origin/main`, `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.
No merge, deployment or push was performed.

## Focus and implementation

Ranked findings: (1) flat balance focal plane; (2) structural card outlines doing too much of the
separation; (3) almost invisible welcome lighting; (4) inconsistent light-theme edge intensity.

Only `web/design-system.css` and `web/app.css` change application presentation:

- Shared lighting, structural rim and raised-shadow tokens cover explicit dark/light and system appearance.
- Welcome has a static, bounded warm radial field behind the existing zebra. Mobile limits it to 112px.
- The opaque graphite balance surface has mild upper-left variation and a small neutral rim.
- Assets, guided cards and Settings sections receive quiet material differentiation and short shadows.
- Dialogs/drawers share the light direction; utility chrome retains existing glass and opaque fallbacks.
- Forced colours remove the new gradients and shadows. Existing control/focus/status borders remain intact.

No new animation, filter, blur, external asset, dependency, event handler or layout measurement was
introduced. The supplied zebra artwork is unchanged. Protected crypto, custody, DKG, signing,
recovery, authentication, routing, state, amounts, fee calculations and transaction logic are untouched
by this change. Unrelated existing and concurrently edited work is excluded from this commit.

## Evidence and checks

Before/after images use the same frozen local presentation inputs, with only this lighting slice
removed for the before phase. Welcome runs in an empty isolated browser profile; Overview and Send
use existing inert synthetic Test wallet snapshots. No personal wallet/profile or real funds were used.
Concurrent UI work visible in these inputs is not attributed to this feature.

| Evidence | Paths |
| --- | --- |
| Welcome, Overview, Send; 1440px and 390px; dark/light | `visuals/ambient-lighting/{before,after}/{welcome,overview,send}-{1440,390}-{dark,light}.png` |
| Forced colours, 390px | `visuals/ambient-lighting/after/{welcome,overview,send}-390-forced-colors.png` |
| Matrix checks | [Before](visuals/ambient-lighting/before/validation.json), [after](visuals/ambient-lighting/after/validation.json) |
| Preferences, contrast, keyboard and idle metrics | [Additional validation](visuals/ambient-lighting/after/additional-validation.json) |

- All 24 regular captures: no horizontal page overflow; no running animations with reduced motion.
- 200% root text size: no horizontal overflow on the three affected views at 390px.
- Forced-colour checks: new background images and shadows resolve to `none` on affected surfaces.
- Both system palettes: worst sampled text contrast across gradient endpoints is 6.83:1 dark,
  5.08:1 light. Existing contrast checks also pass, including field/control edges.
- Keyboard Create entry, visible focus, Escape dismissal and Join expansion checked in the empty app.
- Settled welcome with normal motion: zero running animations; a one-second browser performance
  sample recorded zero layouts, style recalculations and script duration. This is a bounded desktop
  observation, not a physical-device GPU or cryptographic-load benchmark.
- Passed: `node web/test/contrast.mjs`, `node web/test/premium-motion.mjs` (16 checks),
  `node web/test/overview.mjs`, `git diff --check`, anonymous Git identity check.
- PNG evidence contains no identifying text or EXIF metadata.

## Limits and deferred work

No new product features or engineering changes were needed. The linked master PRD and reference
screenshots were not present locally; the supplied feature brief and current component/token
architecture governed this slice. Physical touch devices, assistive technology, budget-device GPU
profiling, cryptographic-load responsiveness and live payment/failure journeys remain unverified.
The inert sample already covers unavailable valuation, missing SOL and unavailable USDC, but it
cannot exercise transactions. Mobile amounts may wrap under the independently changing typography
styles; this slice does not alter number formatting or financial layout.
