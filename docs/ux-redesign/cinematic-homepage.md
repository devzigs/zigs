# Cinematic homepage and portrait lighting

23 October 2026 · `codex/ux-ui-final` · Web presentation only

The homepage again uses a large, integrated portrait inside a charcoal scene. Desktop artwork
is 640px; the upper phone composition uses 340–380px. Returning visitors retain a compact scene
and immediate access to their saved wallets. Eye, ears and muzzle stay visible; the lower neck
blends into the scene. The labelled shared-control illustration sits over the hero. Compact
returning views place it below the copy when needed to keep the text and wallet controls clear.

## Motion to review

- [Desktop recording](visuals/cinematic-homepage/motion/desktop-motion.webm)
- [Phone recording](visuals/cinematic-homepage/motion/mobile-motion.webm)

These historical recordings show the initial lighting pass, ambient cycle, desktop pointer
response and earlier Pause motion / Resume motion interaction. They contain no user wallet data.
Frames extracted from the recordings were also inspected, separately from the sought phase stills.

The first 1.5 seconds carry a broad light across the mane, forehead and muzzle. Afterward, the
light follows a continuous 14-second cycle. A mouse over the portrait redirects it with 120ms
damping; moving over the text does not manipulate the artwork. The silhouette never translates,
rotates or scales. The original red eye is excluded from changing light.

The visible Pause/Resume control was removed at the user’s request. Lighting continues to
respect reduced motion and visibility preferences. The current lighting time survives redraws.
The same canvas and texture are reused when the canonical portrait is remounted, avoiding
context allocation or a second entrance during routine updates.

## Renderer and fallbacks

`web/homepage-scene.js` renders one transparent WebGL quad using the original PNG and broad,
manually authored anatomical lighting fields. It is a layered illustration treatment, not a
new 3D zebra model. No image, font, graphics package or remote media dependency was added.
`web/homepage-motion.js` owns only presentation visibility, playback and resource lifecycles.
It imports no wallet, security, signer or storage module.

- Idle rendering is capped at 30 draws per second; pointer response may use 60.
- Drawing buffers use at most 1.5 device pixels per CSS pixel and never exceed 1024px square.
- Hidden/offscreen scenes stop scheduling frames. Navigation and pagehide release resources;
  a restored document resumes without replaying its entrance.
- Reduced motion, slow updates, forced colors and data saving use the original still. The
  active frame guard also releases resources when a restrictive preference is observed before
  its browser change event arrives.
- Failed images, unavailable WebGL, shader errors and lost graphics contexts never block
  existing controls. No playback control is rendered.

The canonical `web/logo.png`, including numeral texture, eye and transparency, remains byte-for-byte
unchanged: SHA-256 `e2a70c42c37744f787b3dc098808782ce996747b6da5e6e2eafb84190c2567bb`.
Header/favicons retain that same source and the established header proportions.

## Follow-up verification

The restored hero module and removed playback control pass 725 homepage browser checks,
16 motion browser checks, 13 focused lifecycle tests and all 48 executed fast-suite scripts.
The responsive checks cover both themes, new and returning visitors, 320–1440px widths,
200% text, keyboard use, reduced motion and graphics fallbacks. The stacked card reserves its
own height so enlarged text cannot overlap the eyebrow. The original artwork is unchanged.

## Initial validation

- [Full homepage matrix](visuals/cinematic-homepage/after/validation.json): 725 passing checks,
  42 captures, no runtime exceptions. New, returning and multiple wallets cover 320, 375, 390,
  768, 1024 and 1440px in dark and light themes. Existing entry actions, selection, keyboard
  focus, enlarged text, forced colors, privacy disclosures and failure states remain covered.
- [Motion validation](visuals/cinematic-homepage/motion/validation.json): 22 passing checks,
  no runtime exceptions. Real recordings verify playback and pause/resume; lifecycle checks
  cover redraws, offscreen suspension, reduced motion, context loss and unavailable graphics.
  The pause/resume portions describe the earlier UI.
- GPU pixel comparison across fixed lighting phases records visible illumination changes,
  zero alpha changes and zero changes in sampled red-eye pixels. Portrait geometry is identical
  across all phase stills. The sought stills explicitly control the presentation clock; the
  recordings run the actual clock without those overrides.
- Thirteen focused lifecycle tests pass, including late image/module completion, continuous redraws,
  context reuse, preference-event delay, page restoration and bounded long-running shader time.
  They are part of the existing fast suite. Page/global and focused graphics/test/helper lint pass.
- All 48 executed fast-suite scripts pass on Node 24. The optional qrencode comparison is skipped
  because qrencode is unavailable.
- [Retina responsiveness comparison](visuals/cinematic-homepage/motion/responsiveness.json): three
  fresh contexts each with lighting enabled and disabled. After engine/font readiness, observed
  dispatch delays peaked at 1.1–1.7ms for stills and 1.4–1.9ms for animation; neither mode recorded
  a long task or layout shift during the measured interactions. Animated buffers were 960px at
  device pixel ratio 2, confirming the 1.5x cap. These local samples are not production INP claims.

Browser evidence uses isolated fresh Chromium profiles, blocked external requests and synthetic,
unfunded facts where wallet fixtures are needed. The recordings are new-visitor views. Screenshots
have identifying metadata removed. These checks do not certify Safari, physical devices or live
backend behavior; the HTML image remains the fallback on unsupported hardware.

No architecture, API, cryptography, authorization, wallet data, routing, schema, backend or native
changes. The technical reference remains the last successfully fetched `origin/main`, `3a6c08e`.
The current presentation is maintained on the UI/UX branch; linked recordings retain the earlier UI.
