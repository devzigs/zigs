# Gray UI — motion and icon refinement

25 October 2026 · `gray-ui` · presentation only · no merge or deployment.

This implements the request for a quieter, more premium motion language across the web
application. It continues the previous premium and UX passes at `9437eca0`. Main's technical
baseline remains `c6860f6f`; remote main and the original UI reference were checked unchanged.

## Changes

| Area | Finished treatment |
| --- | --- |
| Shared rhythm | One decelerating curve, `cubic-bezier(.18,.8,.22,1)`. Press 90 ms, hover 180 ms, selection 260 ms, release 280 ms, menus 360 ms, editorial heading 480 ms. Dismissal uses the existing immediate actions. |
| Screen changes | Opaque headings settle 6 px; a short stagger introduces fixed editorial descriptions. Existing title animation is suppressed where the new entrance applies. The navigation icon and its selection rail settle together. Ordinary redraws replay neither. |
| Icons | Five new utility glyphs: Close, right/down chevrons, Forward and External. Replace character marks across navigation, dialogs, recovery, messaging, activity, setup, guide and swap previews. Keep official asset marks and both zebra artworks. |
| Small details | Arrowheads, wallet pocket, clock hands, browser/device details and sliders share an optical weight and restrained gestures. Moving details carry their own undercut, eliminating a stationary shadow behind the moving stroke. Checks, locks and fingerprints retain their geometry. |
| Hover and press | Gentle rim/shadow changes and 1 px icon gestures. Pointer or keyboard press keeps the complete button and focus ring stationary; only the decorative symbol compresses slightly. Disabled controls do not gesture. Primary-action icons retain their button's contrast. |
| Modal entrances | A 440 ms shadow/rim resolve for ordinary dialogs, native swap pickers and the standalone Tor demo. Fields, addresses, QR codes and payment contents do not translate or fade with the panel. Preserve Tab, Escape, initial focus and return focus. |
| Menus and disclosures | Wallet-menu entrances share the easing and timing; the wallet chevron changes direction on opening. Existing native disclosure, selection and dismissal mechanisms remain. |
| Educational objects | Shorten the empty-state arrival from 1200 to 760 ms and reduce displacement. Remove stacked guide-copy movement; reduce illustration perspective. Existing Pause/Resume remains effective. No new idle loops. |
| Lifecycle | Cancel detached animations during rapid navigation. Lighting does not track the pointer. Pause offscreen artwork without restarting it; settle artwork after hidden/reduced-motion cancellation so it does not replay on return. |
| Accessibility | Honor live reduced motion, slow displays, forced colors, Save-Data and document visibility. Keep visible keyboard focus, invalid-field treatment and fixed hit areas. The standalone demo's close and action targets are at least 48 px. |

The standalone Tor demo keeps its existing dependency boundary: its close mark uses two
CSS strokes matching the utility glyph, without importing application modules. No shared
models, handlers, payment gates, network services, storage formats or native files changed.

## Coverage and evidence

The browser walkthrough covers Home, Overview, Approvals, Activity, Address book, Swap demo,
Messages, Security and Settings. Form coverage includes wallet setup and Skip warning,
replacement wallet, backup export/check/restore, direct chat/invite/leave, contacts,
locked-data deletion, Send, safety-code match/mismatch, Receive and network privacy.

- [Motion review](visuals/gray-ui-motion/motion-report.json): **216 checks**, including
  72 page/theme/width variants at 320, 390, 768 and 1440 px. Includes press geometry,
  keyboard outline, disabled hover, rapid navigation, native pickers, immediate close,
  guide pause, QR stability, hidden-document and live reduced-motion cancellation.
- [Recorded browser walkthrough](visuals/gray-ui-motion/motion-review.webm) shows the actual
  transitions and pointer interactions. [Press](visuals/gray-ui-motion/overview-press.png),
  [phone Send](visuals/gray-ui-motion/send-phone.png),
  [light Settings](visuals/gray-ui-motion/settings-light.png) and
  [guide](visuals/gray-ui-motion/guide.png) captures record the visual finish.
- [UX regression](visuals/gray-ui-motion/ux-report.json): **523 checks / 124 rendered states**.
- [Style/guide regression](visuals/gray-ui-motion/style-report.json): **511 checks / 31 captures**.
- Required Node 26 fast suite: **48 tests passed**. The independent QR decoder check remains
  skipped because `qrencode` is unavailable; browser QR visibility/stability checks run.
- Existing full application and unified-setup integration tests pass. Their headless
  environment emits the existing Three.js / graphics precision warnings.
- Lint passes for **241 JavaScript and 2 Python files**; whitespace checks pass.
- Live local Worker Home loads the finished presentation without console errors or overflow.
- [Scope audit](gray-ui-motion-audit.json) records hashes and unchanged direct event-handler
  expressions. Existing text assertions now recognize decorative SVGs instead of arrow
  characters; all status, amount, privacy, protection and capability assertions remain.

Review uses isolated synthetic wallets and blocks external requests. It does not certify
physical iOS/Safari rendering or funded transactions. The preview is a local web build.

Reproduce with `solspike/tools/premium_ui_browser.mjs`, `ux_flow_browser.mjs`,
`site_style_browser.mjs`, `scripts/test-fast.sh`, `web/test/app.mjs`,
`web/test/unified-setup.mjs` and `solspike/lint.sh`. Browser tools accept
`PLAYWRIGHT_MODULE` and `CHROME_EXECUTABLE`; the motion and UX tools also accept
`ZIGS_PREMIUM_OUTPUT` and `ZIGS_UX_OUTPUT` respectively.
