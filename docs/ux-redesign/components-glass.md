# PRD 03 — Controls, glass and micro-interactions

22 October 2026 · Web only · Baseline `9521037`

Reviewed `03_Components_Glass_And_Microinteractions.md`, the approved hero/emblem requirements
and existing component sources before editing. The referenced `ZIGS_DESIGN_RULES.md` remains
unavailable. Existing repository rules, themes and shared tokens remain authoritative.
Technical reference: fetched `origin/main` at `3a6c08e`; no technical behavior was imported or changed.

## Wallet navigation follow-up

The later wallet-screen feedback supersedes the header switcher shown in the historical
captures below. The current header keeps a plain wallet name and its artwork, removes
the duplicate “Wallets” link, and places “Return home” at the top right. Wallet switching
remains in the sidebar. Home uses the existing navigation, preserves saved wallets and
focuses the first page; network, device and approval facts retain their existing sources.

The updated `liquid_glass_browser.mjs` passes 241 assertions across production navigation
and the reusable glass component's isolated tests. Header checks cover five widths from
320px to 1440px, light/dark themes, forced colors, doubled text, home destination/focus and
sidebar wallet selection. The Node 24 fast suite passes all 42 executed scripts; its optional
external qrencode comparison remains skipped. No API, persistence or security behavior changed.
Fresh evidence is separate from the historical glass captures:
[desktop header](visuals/wallet-navigation/after/header-1366-dark.png),
[320px header](visuals/wallet-navigation/after/header-320-light.png),
[validation report](visuals/wallet-navigation/after/validation.json).

## Five component improvements

| Component | Observed issue | Delivered |
| --- | --- | --- |
| Buttons | Landing material overrides differed from shell controls; inset primary focus blended into orange. | Removed redundant landing variants, softened the shared primary satin edge, kept solid orange and raised secondary surfaces. Focus sits outside button fills; recovery uses the shared 14px supporting scale. Overview controls that were 36/44px now use the existing 48px target. |
| Sidebar | The current wallet inherited the same warm selection marker as the active page. | A thin inset warm marker belongs to the actual page only. Wallet context uses a quiet neutral boundary. Existing icon family, routes, badges and disabled states remain. |
| Wallet switcher | Transparent rows depended on the scene behind them; CSS entrances replayed when an open menu was rebuilt. | One 82% smoke/porcelain floating surface with 16px blur, rim lighting and opaque text rows. Current wallet retains checkmark and text. A 200ms, four-pixel entrance starts only from user input; restored open menus settle immediately. |
| Disclosures | Bare expanders lacked a coherent affordance; explanation expansion was abrupt. | Shared quiet 28px glyph surfaces inside 48px triggers. The welcome explanation uses a guarded 240ms native size reveal; unsupported browsers, reduced motion and hidden documents remain static. No height limit clips the final content. |
| Browser status | Engine errors had the same quiet summary geometry as healthy diagnostics. | Actual failure receives a bounded attention surface and exclamation mark. Existing status nodes, loading/ready conditions and actionable error banner are untouched. Healthy status remains quiet; its green dot makes no wallet-security claim. |

The original zebra and PRD 02 materials are unchanged. Forms, balances, unavailable assets,
wallet selection callbacks, native disclosure semantics, keyboard navigation, authentication,
cryptography, persistence, APIs and native applications are unchanged. No new control, capability
or runtime dependency was added. Glass is confined to the existing floating switcher pilot;
financial information, forms, warnings and menu text remain on opaque surfaces.

## Visual review and single refinement

32 matched before/after screenshots cover welcome, expanded explanation, unfunded Overview and
the switcher at 1440×900 and 390×844, dark/light. Phone captures use touch/mobile browser emulation.
Additional checks cover 320, 768 and 1024px, system palettes, enlarged text and forced colors.

| View | Before | After |
| --- | --- | --- |
| Welcome · desktop · dark | [Before](visuals/components-glass/before/welcome-1440-dark.png) | [After](visuals/components-glass/after/welcome-1440-dark.png) |
| Switcher · desktop · dark | [Before](visuals/components-glass/before/switcher-1440-dark.png) | [After](visuals/components-glass/after/switcher-1440-dark.png) |
| Switcher · phone · light | [Before](visuals/components-glass/before/switcher-390-light.png) | [After](visuals/components-glass/after/switcher-390-light.png) |
| Explanation · phone · dark | [Before](visuals/components-glass/before/explanation-390-dark.png) | [After](visuals/components-glass/after/explanation-390-dark.png) |

The one refinement addressed a visible positioning flash: the native toggle event could arrive
after the menu's initial paint. User input now also requests a guarded measurement before that
paint, using the same existing positioning function. Rapid dismissal remains immediate.

[Short interaction recording](visuals/components-glass/switcher-interactions.webm): open the
existing switcher, navigate Down/Up, Escape, reopen and select the current wallet. Recorded frames
were inspected alongside the screenshots. The Overview host uses synthetic unfunded metadata and
real components in an inert temporary fixture; it performs no signing, networking or wallet boot.
This fixture is not installed into the normal preview or a user-owned browser profile.

## Verification

- **124 targeted browser checks pass:** pointer press/hover bounds, keyboard focus and return,
  native explanation/open-state preservation, menu arrows/typeahead/Tab/Escape, rapid toggles,
  no entrance replay on restored open menus, long names, internal scrolling, viewport clamping,
  one callback per pick, unchanged disabled states, actual failed-engine behavior and pending-engine
  presentation. Pending engine uses a test-only unresolved initialization; no success is fabricated.
- **575 checks** from the existing entry journey harness pass, including Create/Join/Recover,
  saved-wallet entry, ordinary redraw focus, system themes, enlarged text and forced colors.
- Glass was inspected over actual Overview content. Independent reduced-transparency emulation
  and a test stylesheet without the backdrop-support branch both produce an opaque, readable menu.
  Reduced motion also removes the menu entrance and welcome reveal. Hidden-state CSS stops effects.
- Existing **16 motion tests**, contrast suite, unified-setup regression and page-module lint pass.
  Both light-palette definitions remain identical; existing text, control-border and transient-state
  contrast checks pass. Menu labels use already-tested opaque panel/raised colors.
- The Node 24 fast run passes **41 of 42 executed suites**. The baseline `graph` failure remains:
  `app-setup.js` imports `zns-setup-preview.js`, absent from `app.js`'s module list. QR is skipped
  because `qrencode` is unavailable. Full repository lint retains unrelated legacy visual-tool
  and Solana review findings. These files were not changed.
- Worker/web dry-run build passes. No deployment was performed. Canonical logo bytes are unchanged.

Same isolated Chrome 155.0.8059.85 fixture on macOS, DPR 1, three 900ms timing samples per version
at 1440/390px: p95 frame intervals remain **16.7–16.8ms**, with zero observed long tasks, layout
shifts or continuing menu animations. This measures the prepared-page interaction, not page boot,
network speed or GPU paint cost. Changed JS/CSS adds approximately **0.5 KiB compressed** and no
new runtime asset. [Checks, screenshot facts and timing samples](components-glass-validation.json).

Physical phones, Safari, assistive technology and funded wallet operations remain untested.
Expanded content and enlarged text may scroll. Preview stays available at
`http://127.0.0.1:55846/`. Neutral unsigned commit; no push, merge or deployment.
