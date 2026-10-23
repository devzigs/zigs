# Zigs logo and motion refinement

23 October 2026 · `codex/homepage` · Web presentation only

Historical refinement record. The static hero and brief reveal below are superseded by
[the cinematic homepage implementation](cinematic-homepage.md).

Implemented the approved precision-engraving direction. The canonical number-textured zebra,
red eye and transparency remain byte-for-byte unchanged. Its SHA-256 remains
`e2a70c42c37744f787b3dc098808782ce996747b6da5e6e2eafb84190c2567bb`.

## Presentation

- Header: 40px artwork, 24px wordmark and 12px gap on desktop; 36px artwork and 22px wordmark
  with the same gap on phones. The header shine sweep has been removed everywhere.
- Hero: an unboxed charcoal composition with complete artwork, calmer display tracking and
  solid copper primary action. No orbit, hotspot, scrim, pointer translation or simulated
  surface lighting. New-visitor artwork is 400px on desktop, 320px on tablet and 240px on phones.
- Returning visitors retain their compact wallet-first layout: artwork is 240px on desktop,
  200px on tablet and 112px on phones, fully contained beside the copy. This preserves immediate
  access to saved wallets without clipping the eye, ears or muzzle.
- The explicitly labelled static approval illustration now lives inside How Zigs works for
  both new and returning visitors. Its meaning and the existing privacy disclosures are intact.
- Hover feedback is 120ms; press feedback is 80ms. Keyboard focus remains immediate and stable.
  Tablet wallet labels and arrows stay grouped together.

## Motion lifecycle

Only artwork opacity animates, from 0.3 to 1 over 480ms with `cubic-bezier(.2,0,0,1)`.
The image and its ancestors never translate, rotate or scale. Text and controls stay available.

The independent presenter waits for a decoded image, a visible hero and a visible document.
It reveals once per document and releases its observers/listeners after completion. Redraws,
theme changes, navigation returns and BFCache restoration cannot replay it. Reduced motion,
slow updates, image failure, navigation or interrupted visibility settle to the finished still.
There is no pointer tracking, animation frame loop, new storage or dependency.

## Verification

- [725 browser checks](visuals/logo-motion/after/validation.json) pass with 42 captures and no
  runtime errors. Coverage includes new/returning/multiple wallets, dark/light themes at
  320, 375, 390, 768, 1024 and 1440px, plus enlarged text, forced colors, failed images,
  disabled controls, keyboard focus and existing Create/Join/Recover/Open/navigation behavior.
- Ten focused lifecycle tests in `web/test/homepage-motion.mjs` pass and are registered in both
  existing suite manifests. All 48 executed fast-suite scripts pass on Node 24; the optional
  qrencode comparison is skipped because qrencode is unavailable. The local stub test requires
  permission to open its loopback servers and passes with that permission.
- Page-module/global and focused presenter/test/browser-helper lint pass, as do syntax and
  whitespace checks.
- [First](visuals/logo-motion/animation/first.png),
  [middle](visuals/logo-motion/animation/middle.png) and
  [final](visuals/logo-motion/animation/final.png) frames have identical artwork geometry.
  After verifying normal completion, the CSS animation was deliberately reattached and sought
  in the isolated test page to inspect each frame; application replay is checked separately.
- [Local responsiveness observations](visuals/logo-motion/animation/verification.json) compare
  three fresh contexts before and after. No image-attributed layout shifts were observed.
  Recorded input dispatch delays stayed between 0 and 1.3ms, comparable with the previous
  implementation. Whole-page CLS ranged from 0.004–0.024 before and 0.030 after; it is not zero.
  These are unthrottled development measurements, not production performance claims.

All browser fixtures use isolated profiles, synthetic unfunded wallet facts and blocked external
requests. Screenshots contain no real wallet data or identifying metadata. Chromium automation
does not certify physical devices, Safari or assistive technology.

## Review images

| View | Desktop | Phone |
| --- | --- | --- |
| New visitor, dark | [1440px](visuals/logo-motion/after/new-1440-dark.png) | [390px](visuals/logo-motion/after/new-390-dark.png) |
| New visitor, light | [1440px](visuals/logo-motion/after/fresh-new-1440-light.png) | [390px](visuals/logo-motion/after/new-390-light.png) |
| Returning visitor | [1440px](visuals/logo-motion/after/returning-1440-dark.png) | [390px](visuals/logo-motion/after/fresh-returning-390-light.png) |

No backend, API, cryptographic, authorization, wallet-state, routing, schema or native changes.
The technical reference remains the last successfully fetched `origin/main`, `3a6c08e`.
No technical implementation was imported. No merge, push or deployment was performed.
