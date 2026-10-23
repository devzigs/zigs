# Independent visual review

Baseline: `cae2234`. Technical reference: main `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.
Judgment is based on rendered Chrome screens, not the intent of previous changes.
The v3 PRD is the visual standard. This remains a web-only presentation pass.

**Verdict:** the interface has a coherent foundation, but it is not yet at an award-level finish.
Controls, instructional text and secondary states still compete too often with the user's task.
The most useful improvement is a clearer composition, not more effects.

## Ten weaknesses, ranked by impact

| Rank | Observed weakness | Evidence / disposition |
| --- | --- | --- |
| 1 | Asset controls and separate containers overpower the actual holding. The phone must traverse three tall panels before reaching transactions. | **Fixed:** one shared holding surface, stronger real amounts and compact phone identity/value rows. Unavailable states and all actions remain distinct. [Before](visuals/award-review/before/overview-390-dark.png) / [after](visuals/award-review/after/overview-390-dark.png). |
| 2 | Mobile orientation has several layers before the task: wallet identity, membership facts, section heading and a separate guidance block. | **Fixed within the current information architecture:** tighter context spacing and inline guidance keep every fact and explanation visible. [Before](visuals/award-review/before/activity-390-light.png) / [after](visuals/award-review/after/activity-390-light.png). |
| 3 | Empty Approvals/Activity pages look like placeholder banners stranded in a large canvas. | **Fixed:** a shared, composed empty-state treatment with a static neutral clock and readable text measure. No invented transaction, completion claim or new action. [Before](visuals/award-review/before/approvals-1440-light.png) / [after](visuals/award-review/after/approvals-1440-light.png). |
| 4 | Send's instructional well competes with its fields; Max occupies the amount input's right edge, reducing visible precision. | **Fixed:** quieter instructional chrome, a wider desktop amount column and a separate Max control. Original input values, warnings and handlers remain intact. [Before](visuals/award-review/before/send-long-amount-1440-light.png) / [after](visuals/award-review/after/send-long-amount-1440-light.png). |
| 5 | The Overview signer/recovery blocks have too much material weight and repeated enclosure for supporting information. | **Fixed:** a quieter signer rail and a divided, unboxed recovery footer on the opaque canvas. Full recovery caveats remain visible; the existing action is content-sized. [Before](visuals/award-review/before/overview-1440-light.png) / [after](visuals/award-review/after/overview-1440-light.png). |
| 6 | Recovery explanation is a dense wall of similarly weighted prose, particularly on phones. | Remains: [rendered recovery](visuals/award-review/before/recovery-390-light.png). A dedicated editorial/hierarchy pass must preserve every consequence and qualification. No copy shortened here. |
| 7 | Settings still reads as a sequence of independent cards; core preferences compete with setup, recovery and account administration. | Remains: [rendered Settings](visuals/award-review/before/settings-1440-light.png). An information-architecture change is not smuggled into this visual pass. |
| 8 | Repeated network, threshold, joined-device and avatar treatments dilute the hierarchy of the wallet context. | Remains in the [wallet header](visuals/award-review/before/overview-1440-light.png). The spacing fix does not pretend to resolve the broader presentation of these distinct facts. |
| 9 | The welcome brand object reads more as a portrait tile than an engraved metal object. | Remains: [welcome](visuals/award-review/before/welcome-1440-light.png). The supplied zebra artwork is unchanged; no decorative asset rewrite in this pass. |
| 10 | Desktop welcome is top-heavy: the headline/object cluster and long empty selector rule do not form a particularly deliberate full-canvas composition. | Remains: [welcome](visuals/award-review/before/welcome-1440-light.png). Its entry actions work; further recomposition was lower priority than the working wallet. |

## Reference comparison

The actual artwork was inspected in an isolated browser for
[Ronas banking](https://dribbble.com/shots/25239343-Banking-Mobile-App-Design-Concept),
[Xpend](https://dribbble.com/shots/25673178-Xpend-Startup-Smart-AI-Financial-Tecnology-Mobile-App-UI-Design),
[Fireart](https://dribbble.com/shots/25241984-Task-Management-Dashboard),
[Stakent](https://dribbble.com/shots/23902428-Stakent-Crypto-Dashboard) and
[Outcrowd](https://dribbble.com/shots/24690997-Dashboard-UI-components-for-the-online-banking-platform).
The comparison uses their visible numerical hierarchy, varied density, tonal separation and
restrained supporting controls. These are design judgments, not claims about their usability.

The [Shopeers page](https://dribbble.com/shots/26628350-Shopeers-AI-Powered-B2B-eCommerce-Analytics-Dashboard)
loaded, but its video produced opening/blank frames during inspection, including a later seek.
Its detailed artwork is not claimed as newly visually reviewed. The historical mapping remains
in [art direction](art-direction.md). No reference artwork or fictional analytics are imported.

## Before/after and one refinement

Independent unfunded stores use the existing real wallet ceremony and display-chain fixture.
Welcome, Overview, Activity, Approvals, Settings, Security & Recovery and Send are real app
surfaces. The blocked review is the existing labelled synthetic renderer fixture; it cannot sign
or submit. The long amount is typed into the actual form and never proposed. Fresh addresses
and timestamps differ across runs. Visible secret/QR/file/password fields are masked.

The first comparison was followed by one refinement: align the shared asset backgrounds, restore
full warning width, keep the large empty illustration out of compact Overview summaries, and
give the amount field more room. Validation then exposed doubled-text overflow at 320px; a narrow
stacked fallback and an internal grid constraint repair it. No second art-direction iteration.

Matched full-page Overview captures decrease from **2,998 to 2,734px** at 390px in dark mode
and **1,521 to 1,415px** at 1440px in light mode. This is a fixture layout measurement, not a claim
that every wallet state is shorter. All actions, disabled conditions, values and critical copy
are retained. No content was removed to obtain the reduction.

[Validation results](award-review-validation.json): 273 final browser checks, 41 executed Node 24
fast suites, lint and both-palette contrast checks pass. The QR suite is skipped because
`qrencode` is unavailable. Rendered checks cover 320/390/768/1024/1440/1920px, light/dark, doubled
text, forced colors, 48px controls, overflow and the existing Max handler. Native theme, focus,
form restoration, motion and authentication handlers are unchanged.

Production changes are CSS plus exactly two empty-state DOM presentation transformations in
`web/app-wallet.js`. State predicates, text constants, calculations, fees, addresses, signing,
authentication, APIs, storage and architecture remain byte-identical. Existing icons/tokens are
reused; no new asset, dependency or motion is added. Glass remains utility-only.

Physical phones, Safari, assistive technology, successful funded signing/finality, every domain
state, QR decoding and motion/performance benchmarks are not newly verified. This is a bounded
visual improvement, not an award certification or a complete product/security audit. No native
changes, merge or deployment.
