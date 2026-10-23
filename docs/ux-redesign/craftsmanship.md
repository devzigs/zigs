# Visual craftsmanship pass

Baseline: `4e85bf3`. Technical reference: main
`3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`. Web presentation only.

The v3 PRD's material roles and Sections 11–13 govern the finish and timing. The
[original reference mapping](art-direction.md) supplies the composition/material context.
The previously captured Stakent and Outcrowd artwork was inspected again for restrained
edges and shallow control depth. Static reference artwork is not evidence of animation quality;
interaction timing comes from the PRD and the rendered Zigs checks below.

## Five opportunities and fixes

| Priority | Observed weakness | Shared implementation and evidence |
| --- | --- | --- |
| 1 | Icon-button backgrounds snap while ordinary buttons ease; the primary rim disappears on hover, and press feedback is visually flat. | Shared surface/control transitions, a fine raised edge and a recessed press shadow. Pointer press remains 1px/80ms; release and hover use 140ms. Keyboard press keeps its focus ring stationary. [Before](visuals/craftsmanship/before/press-390-light.png) / [after](visuals/craftsmanship/after/press-390-light.png), [keyboard](visuals/craftsmanship/after/keyboard-390.png). |
| 2 | The floating phone menu reads as an undifferentiated slab with a uniform perimeter. | A faint directional surface highlight, narrow rim and shorter layered elevation give the existing 16px/110% glass a clearer floating edge. A 200ms opacity entrance stays between 90–100%; no movement of labels, delayed input or exit retention. Focus within settles immediately. [Before](visuals/craftsmanship/before/menu-light.png) / [after](visuals/craftsmanship/after/menu-light.png). |
| 3 | Navigation foregrounds jump independently of their backgrounds; unavailable Chats also receives a hover treatment. | Shared easing coordinates surface, border and foreground feedback; disabled navigation receives no active hover styling. Existing selected states, destinations, handlers and 48px targets remain. [Dark hover](visuals/craftsmanship/after/hover-1440-dark.png), [desktop context](visuals/craftsmanship/after/overview-1440-light.png). |
| 4 | The zebra plate has a hard bright upper edge and a comparatively harsh light streak. | Softer satin edging, a finer lower rim, a shorter contact shadow and a broader, dimmer highlight. The canonical artwork, geometry and existing once-per-tab 700ms trigger are unchanged. [Before](visuals/craftsmanship/before/welcome-1440-light.png) / [after](visuals/craftsmanship/after/welcome-1440-light.png), [highlight phase](visuals/craftsmanship/after/highlight-1440.png). |
| 5 | The busy dot pulses indefinitely; loading wells are flat and can exceed very narrow containers. | A static unfinished ring accompanies the existing truthful status text. Loading wells gain a quiet static tonal surface and a maximum container width. No shimmer, progress percentage, timer or simulated completion. [Before](visuals/craftsmanship/before/loading-390.png) / [after](visuals/craftsmanship/after/loading-390.png). |

These are intentionally small material and interaction improvements, not a layout redesign or
an assertion that the product now meets an award standard. Shadows and blur are never animated.
Financial content, warnings, addresses, recovery details and QR surfaces remain opaque/static.

## One refinement and accessibility verification

After the first implementation comparison, the single refinement softened the plate's lower
edge and made forced-color loading/menu fallbacks explicit. Validation of that refinement found
that Chromium's forced-color text backplate obscured the selected navigation label even when
settled. The selected state now uses Canvas/CanvasText plus a Highlight outline, preserving user
system colours. Forced-color changes settle immediately; glass is disabled. This repair was
checked in the rendered menu: [system colours](visuals/craftsmanship/after/menu-forced.png).

Reduced transparency produces an opaque menu without blur or gradient:
[opaque fallback](visuals/craftsmanship/after/menu-opaque.png). Dynamic reduced motion stops the
existing effects. The new entrance also stops when the existing hidden-document class applies.
No controller, focus-management, form-restoration or functional handler changes were needed.

## Visual and interaction evidence

Matched screenshots cover welcome, hover/press, the mobile menu, populated Overview and blocked
payment review at 390 and 1440px, in both themes. Actual local entry controls were exercised in
fresh stores; no wallet/payment action was submitted. The inert gallery uses sanitized current
renderer output from the existing real three-device creation journey. Chain values are the
existing labelled synthetic test fixture, never new product data. The blocked review cannot
sign or submit. Gallery controls deliberately remain disabled.

Before/after recordings: [phone before](visuals/craftsmanship/before/interactions-390.webm) /
[phone after](visuals/craftsmanship/after/interactions-390.webm),
[desktop before](visuals/craftsmanship/before/interactions-1440.webm) /
[desktop after](visuals/craftsmanship/after/interactions-1440.webm).
Recorded interaction frames and rendered intermediate/settled states were visually inspected.
Presentation sequences are also recorded at
[390px](visuals/craftsmanship/after/presentation-390.webm) and
[1440px](visuals/craftsmanship/after/presentation-1440.webm).
Capture timestamps differ; compare equivalent states rather than identical video timestamps.

## Performance and validation

Same host/build mode, macOS 26.5.2, headless Chrome **155.0.8059.85**, 900px viewport height.
Both phases reuse the same sanitized frames and existing `premium-performance.mjs` probes,
with current presentation motion enabled in both. Font/image loading is warmed before trials;
cold-load timings are recorded separately. Fixture hashes are included in the reports.

- [Presentation baseline](craftsmanship-before.json) / [final](craftsmanship-after.json):
  three normal trials per width plus one 4× CPU trial per width. Every final measured frame
  stayed within 20ms; p95 was 16.7–16.8ms. No recorded presentation long task or decorative CLS.
  Both phases already passed the budget; this is not evidence of a speed improvement.
- [Real entry/menu/scroll trials](craftsmanship-interactions.json): before/after at both widths,
  normal and 4× emulated CPU. At least 98.9% of frames within 20ms; no recorded long task or CLS.
  Menu feedback began within 1.2ms in this fixture. CPU throttling is not a physical-phone test.
- 37 final presentation assertions, 28 real interaction assertions and
  [5 targeted fallback assertions](craftsmanship-fallbacks.json) pass. Checks include immediate
  menu state, Escape/focus return, stationary keyboard press, reduced motion, opaque glass,
  forced colours, context redraws, historical completion, retained input and static QR treatment.
- The pending-component fixture goes from one perpetual animation to zero. Existing context and
  completion observers remain unchanged; no state is invented or animated early.
- Test wallet snapshots regenerated through the existing builder: **32 checks pass**.
- Node 24 fast suite: **41 suites pass**. Lint passes. Contrast checks pass in both palettes:
  68 text pairs, 4 field edges, 6 transient heading and 36 transient mark pairs per palette.
  The QR regression suite is skipped because `qrencode` is unavailable; QR decoding is not claimed.
- CSS grows by **336 gzip bytes** (28,975 → 29,311); runtime JavaScript and assets add **zero bytes**.
  The final forced-color-only repair follows the regular-theme performance measurement and
  is separately rendered/tested. PNGs contain no identifying text/EXIF metadata.

Chrome startup/screenshot timeouts occurred during capture and were retried; completed reports
are the runs reported here. Physical phone/GPU performance, Safari, assistive-technology use,
funded transactions and production network behaviour are untested in this pass. No native work,
logic, signing, cryptography, authentication, API, dependency, storage or architecture changes.
No merge or deployment.
