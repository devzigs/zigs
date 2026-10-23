# PRD 02 — Metallic identity and lighting

22 October 2026 · Web only · Baseline `ed25860`

Implemented `02_Metallic_Identity_And_Lighting.md` after reviewing PRD 01, the actual hero,
canonical logo and existing motion controller. The referenced `ZIGS_DESIGN_RULES.md` remains
unavailable; established repository rules and design tokens were retained.

## Delivered

- A reusable `zigsEmblem()` presentation primitive in the existing icon module: hero and static
  64px sizes, shared material tokens, a layered satin rim and recessed matte graphite face.
- One upper-left light direction, quieter perspective and short contact shadow. Static warm
  copy ambience and cool artwork ambience stay within their columns, with no blur or new bitmap.
- Original raster, proportions, transparency and red eye preserved byte-for-byte. No clean zebra
  engraving mask exists, so sharp optical contrast takes precedence over simulated embossing.
  The former corner ornament is removed. This is a decorative digital emblem, not a device claim.
- Existing once-per-tab event and decorative flag retained: 4px/420ms settling, one narrow
  700ms bevel-only pass, and damped mouse tilt bounded to two degrees per axis. Touch, coarse
  pointers, slow-update media and reduced motion do not tilt. No idle animation or timer loop.
- Solid background/border fallbacks remain without gradients or masks. Forced colors omit
  decorative materials. Hidden pages stop entrance effects and transform transitions.

PRD 01's grid, copy, CTA placement and responsive sizes are unchanged: 272px desktop,
208px tablet and 112px phone. Returning wallets still have no hero object. Sidebar branding,
buttons, navigation, disclosure text and wallet handlers are unchanged. No runtime dependency,
authentication, API, storage, wallet, cryptographic or native change.

## Visual evidence and bounded refinement

The simpler raster-plus-CSS approach was selected; no alternative renderer or replacement asset
was needed. Matched actual landing screenshots cover 1440×900, 1024×768, 390×844 and 320×800,
light/dark. The natural-size crops below preserve screenshot pixels without rescaling.

| View | Before / after |
| --- | --- |
| Desktop · light | [Natural-size comparison](visuals/metallic-identity/comparison-1440-light.png) |
| Desktop · dark | [Natural-size comparison](visuals/metallic-identity/comparison-1440-dark.png) |
| Phone · light | [Natural-size comparison](visuals/metallic-identity/comparison-390-light.png) |
| Phone · dark | [Natural-size comparison](visuals/metallic-identity/comparison-390-dark.png) |

One refinement tightened the phone-scale contact shadow. Verification then exposed an existing
CSS specificity conflict that allowed a transform transition to continue when hidden; the scoped
hidden-state override fixes it. No further visual redesign was attempted.

[Initial bevel](visuals/metallic-identity/after/motion-pass-desktop.png),
[reflection at 150ms](visuals/metallic-identity/after/motion-pass-middle.png) and
[final bevel](visuals/metallic-identity/after/motion-pass-end.png) frames were inspected, along with
[forced colors](visuals/metallic-identity/after/forced-colors.png),
[disabled background effects](visuals/metallic-identity/after/static-fallback.png),
[small size](visuals/metallic-identity/after/small-component.png) and
[enlarged phone text](visuals/metallic-identity/after/enlarged-text-phone.png).
Ordinary application redraws can interrupt the initial effect and settle immediately; it never
replays to compensate. Frame captures use an isolated presentation-controller replay on the real
rendered landing page, with paused CSS timelines and the arrival/headings settled to isolate
the bevel reflection. Running effects and interruption are checked separately in the browser.

## Verification

- **44 browser checks passed:** unchanged copy/action geometry, no horizontal overflow, 48px
  entry targets, usable actions during animation, unchanged raster rendering, bevel mask,
  once-only settling, pointer bounds/reset, touch and slow-update suppression, keyboard focus,
  live reduced-motion changes, hidden interruption and static fallbacks. Hidden-tab and
  slow-update states were simulated in the isolated browser fixture.
- **16 existing motion tests**, contrast suite and unified-setup regression passed. The fast
  Node 24 run passed 41 of 42 executed suites; `graph` fails on the pre-existing import-list
  mismatch (`app-setup.js` imports `zns-setup-preview.js`, absent from `app.js`'s list).
  Both baseline files at `ed25860` contain this mismatch. QR is skipped without `qrencode`.
- Page-module lint and strict lint of changed JavaScript pass. Full repository lint retains
  existing complexity/nesting/unbound-name findings in legacy visual tools and Solana review
  code. These unrelated files were left untouched.
- The web/Worker build dry-run passes; nothing was deployed. Canonical logo SHA-256 remains
  `e2a70c42c37744f787b3dc098808782ce996747b6da5e6e2eafb84190c2567bb`.
- Maximum warm tint retains at least **5.42:1** for the tested copy colors. Existing shared text,
  control-border and transient-state contrast checks pass. Background fields are noninteractive.

Chrome 155.0.8059.85 on macOS, headless, DPR 1. Three 1.1-second presentation samples per size
and version used the same isolated local page at 1440/390px. Both versions show median p95
frame intervals of **16.7ms**, zero observed long tasks and zero layout shifts. This measures
the finite effect after page readiness, not boot/network performance or GPU paint cost.
Incremental combined compressed JS/CSS is under 1 KiB; no additional image bytes are loaded.
[Raw checks, geometry, contrast and timing observations](metallic-identity-validation.json).

Physical phone performance, Safari and assistive-technology testing remain unperformed. Short
viewports and enlarged/expanded content may scroll as before. Preview:
`http://127.0.0.1:55846/`. No merge, push or deployment.
