# Compact Swap assets page

23 October 2026 · Web CSS only · Baseline `1385b7b` plus preserved local work

Reduced composer spacing, title size, route tiles and card padding. Receive-to label and
selector share a desktop row. On phones, title and Preview mode share a row; the decorative
Exchange eyebrow is omitted. The reverse control keeps its 48px hit area with a smaller
visible circle so it does not cover labels. No new disclosure is hidden and no runtime code,
quote arithmetic, provider, persistence or execution capability is changed.

With the actual shared wallet header included, idle and populated quote pages now fit without
page scrolling at 1440×728, 1503×728, 1440×900, 1280×720, 1024×768, 390×844 and 320×800,
in both themes. Desktop page content decreases from 680px to 571px. At 1440×728 the document
decreases from 841px to the 728px viewport. Expanded dialogs, longer errors, enlarged text or
longer wallet names can still require scrolling; content is never clipped to force a fit.

| View | Before | After |
| --- | --- | --- |
| Desktop · dark | [Before](visuals/compact-swap/before/1440-728-dark.png) | [After](visuals/compact-swap/after/1440-728-dark.png) |
| Phone · light | [Before](visuals/compact-swap/before/320-800-light.png) | [After](visuals/compact-swap/after/320-800-light.png) |

[Populated desktop quote](visuals/compact-swap/after-quote/1440-728-dark.png).
[Measured checks](compact-swap-validation.json): 28 final viewport/state/theme cases have no
page scrolling, horizontal overflow, sub-48px tested enabled buttons or runtime errors.
Inspected actual desktop and phone screenshots. The existing isolated Swap browser suite
passes **123/123 checks**, including asset search, slippage, quote invalidation, disabled states,
focus restoration, modal keyboard handling, reduced motion, forced colors and unchanged local
simulation. No requests reach external quote/status/transfer endpoints. Existing Swap unit
tests, contrast checks and CSS parsing/minification pass. Tests use fresh synthetic browser
contexts; physical devices and assistive technology are untested.

Existing local edits remain separate. Neutral unsigned commit; no push, merge or deployment.
Preview remains at `http://127.0.0.1:55846/`.
