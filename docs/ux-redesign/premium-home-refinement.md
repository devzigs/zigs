# Premium home refinement

23 October 2026 · `codex/home-page-refinement` · Web presentation only

Refined the existing welcome page against the supplied final landing-page brief. The original
headline, canonical zebra image and red eye remain unchanged. Existing uncommitted onboarding
and wallet work was preserved. No merge, push or deployment was performed.

## Four passes

| Pass | Result | Fresh rendered evidence |
| --- | --- | --- |
| Baseline | Captured this checkout before changes. | [Desktop](visuals/premium-home/before/welcome-1440-dark.png), [mobile](visuals/premium-home/before/welcome-390-dark.png) |
| A — Composition | Centred the hero within the main canvas, moved its desktop top from 28px to 81px, balanced the two columns and applied the exact requested paragraph and Join a wallet label. | [Desktop](visuals/premium-home/composition/welcome-1440-dark.png), [mobile](visuals/premium-home/composition/welcome-390-dark.png) |
| B — Materials | Satin directional bevel, fine graphite texture, contact shadow, restrained warm/cool ambient fields and quieter shared button materials. No shader or animation dependency. | [Desktop](visuals/premium-home/materials/welcome-1440-dark.png), [mobile](visuals/premium-home/materials/welcome-390-dark.png) |
| C — Interaction | Aligned security icon/title/subtitle/chevron in one native disclosure, softened sidebar selection, retained the 420ms entrance and 700ms single edge reflection, and bounded total perspective to three degrees. | [Review capture](visuals/premium-home/review/welcome-1440-dark.png), [expanded disclosure](visuals/premium-home/review/expanded-1440-light.png) |
| D — One final review | Brought the zebra closer to the copy, reduced visible horizontal texture and softened its light-theme shadow. No further subjective polishing. | [Final desktop](visuals/premium-home/after/welcome-1440-dark.png), [light](visuals/premium-home/after/welcome-1440-light.png), [tablet](visuals/premium-home/after/welcome-768-dark.png), [mobile](visuals/premium-home/after/welcome-390-dark.png) |

The original release notice and full network/privacy information are inside the security
disclosure, separate from marketing copy. Create, Join and Recover retain their existing
handlers, as do sidebar navigation, browser diagnostics and all wallet safeguards. Native
disclosure semantics, keyboard focus and open-state restoration remain intact.

Shared control tokens provide the button finish; the landing page changes only button sizing
and layout. Existing motion helpers retain visibility and reduced-motion handling. The brand
object remains a CSS material around the original image, rather than a new 3D asset.

## Validation

- [63 browser checks and 23 final captures](visuals/premium-home/after/validation.json) pass in
  the actual running app with isolated, unfunded browser stores. New and returning layouts cover
  1440, 1280, 768, 390 and 320px in dark/light themes. Checks include centred desktop geometry,
  readable text, comfortable controls, no horizontal clipping, keyboard entry actions, optional
  recovery-file chooser, disclosure restoration, forced colors and actual 200% text.
- The zebra's completed entrance, bounded pointer tilt, redraw behavior and reduced motion were
  exercised in a separate browser context. The existing motion regressions also pass.
- All 42 executed Node 24 fast-suite scripts pass. The optional external qrencode comparison is
  skipped because qrencode is unavailable. The full unified setup regression passes; its stale
  expectation of the previously removed header wallet switcher was updated to the approved
  sidebar-only switching and Return home presentation.
- Page-module named-import/global lint and focused lint for the changed browser helpers pass.
  Repository-wide lint still fails on existing complexity/depth/global findings in prior visual
  tools, `app-motion.js` and `web/sol/payview.js`; this pass does not broaden into those fixes.
- Worker/web dry-run build passes, reading 241 assets. No backend or native source changed.
  There is no separate TypeScript configuration for this JavaScript page; the graph and named
  import checks validate its module interfaces.

Technical reference remains local `origin/main` at `3a6c08e`. Rechecking the authoritative
remote failed because GitHub DNS was unavailable. This pass imports no technical behavior and
introduces no new technical deferrals.

Limits: Chromium visual/interaction verification; physical devices, Safari and assistive
technology were not independently certified. Expanded education, longer wallet lists and
enlarged text may scroll vertically. CSS materials approximate hardware lighting; the original
raster artwork and its resolution are intentionally preserved.
