# Dashboard and asset polish

Baseline: `d8d4f1d`. Technical reference: main `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`,
confirmed against the remote. Scope: Overview and its three asset displays only.

Reviewed the supplied `Zigs_App_Wide_Premium_UI_PRD_v3.md`, particularly financial hierarchy,
state-aware assets, component materials and accurate privacy presentation (sections 6–10),
plus the [original six-reference mapping](art-direction.md). Applied Xpend's financial hierarchy,
Shopeers' neutral contrast, Stakent's amount/unit clarity and Outcrowd's quieter action grouping.
No reference artwork or fictional product capabilities were imported; reference access limits
from the preceding audit still apply.

| Highest-impact weakness | Fix |
| --- | --- |
| The missing USD value competed with real native balances. | Reduce the unavailable-state weight/size while keeping it explicit on graphite. Known asset quantities use the established page type scale; units and incoming values are easier to read. No valuation is invented. |
| Active, not-added and unavailable assets had similar visual weight. | Known balances retain a solid surface and clearer edge; not-added assets recede into the canvas; unavailable assets have a dashed boundary and a readable warning inset. Desktop gives the primary holding modestly more room. |
| Repeated orange Send buttons competed with the global action. | Keep orange for the dashboard's primary Send. Asset Send is a neutral secondary control, Deposit is quiet and privacy actions have no raised shadows. Existing enabled/disabled states remain exact, including Solana's existing tool-opening actions. |
| A checked shield beside unknown privacy data suggested verification. | Replace only that decorative mark with a neutral question marker. Keep the unavailable label, all associations and full disclosures; no bar or percentage is invented. |
| Repeated dividers and loose internal spacing made cards tall. | Remove the redundant privacy-action divider, use shared spacing/padding and retain the existing details divider. Preserve 48px targets, full precision, warnings and expanded content. |

One refinement followed the first screenshot comparison: reduce internal gaps and preserve
fluid tablet columns. No further design iteration or unrelated screen changes.

## Before / after

Actual application renderers, fresh isolated browser stores and the existing unfunded synthetic
wallet fixture. This is not the inert preview with all controls disabled. Balances/states come
from the established harness, not newly invented production data. Transient backup feedback was
dismissed and scroll/focus reset consistently before capture.

| View | Before | After |
| --- | --- | --- |
| Desktop light | [Before](visuals/dashboard-polish/before/overview-1440-light.png) | [After](visuals/dashboard-polish/after/overview-1440-light.png) |
| Desktop dark | [Before](visuals/dashboard-polish/before/overview-1440-dark.png) | [After](visuals/dashboard-polish/after/overview-1440-dark.png) |
| Phone light | [Before](visuals/dashboard-polish/before/overview-390-light.png) | [After](visuals/dashboard-polish/after/overview-390-light.png) |
| Phone dark | [Before](visuals/dashboard-polish/before/overview-390-dark.png) | [After](visuals/dashboard-polish/after/overview-390-dark.png) |
| Expanded asset details | [Before](visuals/dashboard-polish/before/details-390-light.png) | [After](visuals/dashboard-polish/after/details-390-light.png) |

All three expanded asset disclosures were also captured at both sizes/themes. Additional
screenshots cover narrow doubled text, forced colors and the existing asset picker.

## Checks and boundaries

[Validation report](dashboard-polish-validation.json): 240 dashboard browser assertions pass
across seven widths (320–1920px), explicit/system themes, doubled text, forced colors, overflow,
48px targets, actual action states and keyboard disclosures. The actual fixture journey passes
31 checks in each phase. Overview and Solana application regression suites pass; both palette
contrast checks and lint (184 JavaScript / two Python files) pass. Nineteen PNGs contain only
IHDR/IDAT/IEND chunks. Dashboard text matches before/after apart from decorative question marks.

The exact JavaScript diff is one decorative glyph replacement. All action handlers, balances,
formatting, eligibility, wallet logic, cryptography, APIs and architecture are unchanged. No
new dependency or runtime asset. Original checkout and native apps untouched; no merge/deployment.

Desktop and responsive phone-browser Chrome screenshots were reviewed. Safari, physical phones,
screen readers, live pricing and funded transfers were not tested. Additional SOL lifecycle states
retain model/regression coverage but do not receive new screenshot coverage here. Performance
benchmarks were not rerun. The existing inert Test wallet is regenerated from the final sources.
