# Compact default web layout

23 October 2026 · Baseline `be093fd` plus preserved local work · Technical reference `origin/main` at `3a6c08e`

The default 100% layout now uses 15px desktop body text, a 216px sidebar, 24px outer gutters,
16–20px section spacing and 16–20px panels. Shared headings are 26px, welcome copy is 44px,
and the portfolio balance is 40px. Phones retain 16px body text and stack controls where needed.
Existing smaller supporting text remains readable at its previous size. Controls remain at
least 48px; this pass also corrects existing smaller Settings, Security and Messages controls.

Applied shared tokens to existing screen rules across welcome, setup, assets, approvals,
activity, transaction forms/receipts, recovery, settings and messaging. The zebra artwork,
palette, motion and all runtime handlers are unchanged. The asset picker is layered above
the denser contained asset rows so its choices remain clickable. No CSS zoom, root-font
scaling, whole-page transform, dependency or native change.

## Rendered comparisons

| View | Before at 100% | After at 100% |
| --- | --- | --- |
| Overview · desktop · light | [Before](visuals/compact-default/before/overview-1440-light.png) | [After](visuals/compact-default/after/overview-1440-light.png) |
| Welcome · desktop · dark | [Before](visuals/compact-default/before/welcome-1440-dark.png) | [After](visuals/compact-default/after/welcome-1440-dark.png) |
| Threshold · phone · light | [Before](visuals/compact-default/before/threshold-390-light.png) | [After](visuals/compact-default/after/threshold-390-light.png) |
| Review · 1024px · dark | [Before](visuals/compact-default/before/review-1024-dark.png) | [After](visuals/compact-default/after/review-1024-dark.png) |
| Settings · phone · light | [Before](visuals/compact-default/before/settings-390-light.png) | [After](visuals/compact-default/after/settings-390-light.png) |

Also retained [the previous Overview at an 80% layout equivalent](visuals/compact-default/before/overview-1800-light-80percent.png).
That reference uses a 1800×1125 CSS viewport at DPR 0.8, producing the same 1440×900 pixel
frame. Browser chrome zoom was not automated; the application contains no zoom workaround.

At 1440×900, the fixture Overview decreases from 955px to one viewport, with all three assets
and the pending summary visible. The Messages workspace also fits one viewport rather than
1057px. Settings decreases from 2064px to 1827px; Security decreases from 1587px to 1475px.
Those longer pages, expanded disclosures, short viewports and enlarged text still scroll.

## Validation

[Measured results](compact-default-validation.json): 96 final cases across 12 representative
screens at 1440×900, 1024×768, 390×844 and 320×800, in light/dark themes. No page/dialog
horizontal overflow, sub-48px tested controls or browser errors. Checked representative actual
desktop/phone screenshots, including the zoom-equivalent comparison, then made one refinement
pass to remaining spacing, picker layering and phone controls. Fixtures use isolated synthetic
metadata, never user keys or funds; artwork may show its existing unavailable fallback there.

- Node 24 fast suite: **47/47 pass** with loopback access; QR skipped without `qrencode`.
- Existing entry journey: **659 checks pass**, including system themes, forced colors,
  reduced preferences, enlarged text, keyboard navigation and redraws.
- Existing Settings browser suite: **52 checks pass**, including editor values, cancellation,
  focus return, address safeguards and offline themes.
- Focused existing Overview suite: **56 checks pass** for layout, asset disclosures, Receive,
  unavailable actions, large values and preferences. Its obsolete identity-image assertions
  and unrelated motion cases were omitted in a temporary runner, leaving repository tests intact.
- Page lint, bundling/parsing all 10 affected stylesheets and Worker dry-run build pass.
- Full `unified-setup` still fails `messages: no duplicate Overview heading` (`0 !== 1`).
  The same failure reproduces with pre-change CSS and existing local JavaScript. The original
  Overview browser runner likewise expects superseded `.wallet-avatar` elements. Neither
  unrelated issue is changed in this CSS pass.

Chrome 155 on desktop macOS; phone sizes are emulated. Physical phones and assistive technology
were not tested. No animation or authentication policy changed. The local preview uses the
existing loopback development flag, without a repository configuration change, and remains at
`http://127.0.0.1:55846/`. Existing local work is preserved separately from the commit.
No push, merge or deployment.
