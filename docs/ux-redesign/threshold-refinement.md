# Approval threshold controls and orange examples

22 October 2026 · Web only · Baseline `4abcbb4`

The shared static security diagram had replaced the animated setup preview without its education
hooks. This pass restores the orange example groups only on the proposed-threshold screen.
Wallet configuration, recovery and live approval views retain their existing semantics.

## Changes

- Desktop now pairs the enclosing wallet and device illustration on the left with two clear numeric counters on the right. The existing number fields keep their IDs, names, keyboard editing, draft handling and validation.
- Each counter has 48px minus/plus buttons and a large value. Button limits reflect the supported 2–7 devices and approvals no higher than the chosen device count. Typed invalid values still receive the existing errors; device counts never silently change the approval rule.
- Every chosen device appears in the diagram, using recognizable phone/laptop illustrations. Exactly the required count has orange outlines and restrained glow. The existing finite animation cycles possible groups, then settles; it reruns when the proposed configuration changes. Labels explicitly say these are examples, not real approvals.
- Reduced motion retains a static highlighted group. Existing hidden-page and redraw guards still stop effects. No perpetual animations or animation callbacks affect setup.
- One spacing refinement reduces diagram height and compacts phone counters. At 1440×900 the default arrangement, collapsed education and action bar are visible together. Phone sizes, shorter viewports, larger arrangements, expanded education and enlarged text retain vertical scrolling rather than clipping content or shrinking targets.

## Evidence and checks

Eight matching before/after views cover 320×800, 390×844, 1024×768 and 1440×900 in light/dark.
No captured view has horizontal page overflow. The live rendering checks pass all 21 supported
arrangements, including exact highlighted counts throughout their actual Web Animations keyframes.

**74 browser checks passed:** preserved inputs/focus, counter limits, keyboard activation, n-of-n
warning, recommended reset, invalid input, reduced motion, forced colours, enlarged text,
48px targets, Next/Back values and Escape focus return. Natural-time screenshots show different
2-of-4 groups; the recording includes the actual setup and interactions, using isolated unfunded
browser stores. No user profile was modified.

| View | Before | After |
| --- | --- | --- |
| 320px · light | [Before](visuals/threshold-refinement/before/threshold-320-light.png) | [After](visuals/threshold-refinement/after/threshold-320-light.png) |
| 320px · dark | [Before](visuals/threshold-refinement/before/threshold-320-dark.png) | [After](visuals/threshold-refinement/after/threshold-320-dark.png) |
| 390px · light | [Before](visuals/threshold-refinement/before/threshold-390-light.png) | [After](visuals/threshold-refinement/after/threshold-390-light.png) |
| 390px · dark | [Before](visuals/threshold-refinement/before/threshold-390-dark.png) | [After](visuals/threshold-refinement/after/threshold-390-dark.png) |
| 1024px · light | [Before](visuals/threshold-refinement/before/threshold-1024-light.png) | [After](visuals/threshold-refinement/after/threshold-1024-light.png) |
| 1024px · dark | [Before](visuals/threshold-refinement/before/threshold-1024-dark.png) | [After](visuals/threshold-refinement/after/threshold-1024-dark.png) |
| 1440px · light | [Before](visuals/threshold-refinement/before/threshold-1440-light.png) | [After](visuals/threshold-refinement/after/threshold-1440-light.png) |
| 1440px · dark | [Before](visuals/threshold-refinement/before/threshold-1440-dark.png) | [After](visuals/threshold-refinement/after/threshold-1440-dark.png) |

[Animation recording](visuals/threshold-refinement/threshold-interactions.webm) ·
[First group](visuals/threshold-refinement/interactions/glow-4-2-first.png) ·
[Next group](visuals/threshold-refinement/interactions/glow-4-2-next.png) ·
[Detailed validation](threshold-refinement-validation.json).

All **42 Node 24 fast suites**, the long **unified-setup** suite and **16 motion tests** pass.
Changed-file lint and import checks pass. Full repository lint fails in existing, unchanged
browser harnesses and Solana review code; those findings are listed in the validation JSON and
were not expanded into this targeted change. QR regression remains skipped because qrencode
is unavailable. The Worker/web dry-run succeeds; no deployment occurred.

Physical phones, Safari, screen readers and software keyboards were not tested. Existing
cryptography, authentication, formation/signing rules, recovery, storage, APIs, network restrictions
and native applications are unchanged. No merge or deployment.
