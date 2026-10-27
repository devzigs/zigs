# Gray UI — page-by-page visual and motion review

25 October 2026 · web implementation on `gray-ui` · no merge or deployment.

This is an implemented refinement of the design migration at
`825bf96ec5484b882aa3e953972dc62e965d2f69`. The visual reference is
[zigs-site](https://github.com/devzigs/zigs-site/tree/876e3580a53988b81bf1c91ee4ed8ca6255e95ec),
inspected as source and in its local built preview. Main's engineering baseline remains
`c6860f6fef9351531bd3a9c3a221600c49651035`.

## What the comparison revealed

The migration delivered the site's type, palette, branding and educational guide. Much of the
operational app still expressed these through flat 24-unit symbols, abrupt feedback and similar
panel treatments. The site has a more deliberate physical vocabulary: layered silver objects,
subtle raking light, easing with a long settling phase, and motion attached to an interaction.

The refinement carries that vocabulary into the app through an additive stylesheet, a small
document-local presentation controller and fixed SVG artwork. Operational facts remain readable
immediately. A title can settle into place; a balance, warning or full address does not move,
fade or count up. There are no new wallet capabilities or invented live progress indicators.

## Review and implementation by destination

| Destination | Observed gap | Implemented refinement | Verification and limits |
| --- | --- | --- | --- |
| Navigation and selected-wallet header | Symbols were thin and flat. Selection lacked a physical anchor. The phone header placed the Tor demo label on a third row and wrapped Return home. | Engraved icon undercoats, separate glyph details, inset active icon plates, warmer selected edges, slower surface feedback. Phone header uses two rows while keeping wallet, network, Home and demo labels. | All nine destinations in both themes at 320, 390, 768 and 1440 CSS pixels. Phone selected-wallet header measures 129 px in the fixture, versus roughly 218 px in the baseline phone capture. Menu behavior is unchanged. |
| Home and saved wallets | Wallet cards and guide invitation had little tactile response. The existing hero and explanatory threshold already matched the brand. | Restrained card depth, rim highlights, responsive borders, fuller primary-action lighting and a metal guide-icon plate. Title entrance has a longer settle. Existing zebra artwork and threshold explanation remain intact. | Saved-wallet Home in eight responsive/theme combinations; paired baseline and revised captures. The fixture displays synthetic view-only wallets, not live accounts. |
| Wallet setup and browser protection | Protection artwork was already strong, but frame, focus and action feedback felt disconnected from the rest of the app. | Shared input focus halo, grounded control shadows, dialog depth and safe heading entrances. The four existing setup stages retain their current presentation and actions. | First protection stage reviewed on desktop and phone; Tab and Escape checked. Authentication, Skip acknowledgement, formation and final creation are not performed by the visual harness. Existing regression tests cover those rules. |
| Overview and assets | Portfolio surface felt flat; action symbols behaved as a single drawing. | Layered portfolio lighting, inset asset and shared-control surfaces, restrained row hover, articulated Send/Receive details and pointer light on panel framing. | Hover keeps the action rectangle and exact balance text/coordinates unchanged. Neither the financial value nor any ancestor transforms or fades. Both themes and four widths reviewed. |
| Approvals | The empty-state device mark was too slight beside the threshold diagram. Motion could be confused with actual approval progress if applied broadly. | Original 64-unit metal device relief, one finite decorative entrance, shared-control hardware depth and a deliberate page-title settle. | Empty inbox and current device configuration reviewed. All “Joined”, approval counts, network notices and unavailable-read distinctions still come from existing renderers. No pending payment is fabricated for the captures. |
| Activity | The ledger illustration and filters had little response. Numbers must remain precise and quiet. | One finite entrance on the decorative ledger engraving, consistent filter transitions, row surface/rim response and icon depth. | Empty activity and network-limitation disclosure reviewed at all widths. Financial rows inherit only surface treatment; amounts do not animate. Full funded history is not exercised in the visual fixture. |
| Address book | A text-only empty block lacked the care of the educational pages. Search focus felt abrupt. | Sculpted address-book object on a dark metal plate, gentle entry and isolated physical detail response; clearer search halo and recipient-card hover. | Empty/search presentation reviewed in both themes. Existing identity warning, browser-local storage disclosures, editor handlers and full addresses are unchanged. No real recipients are saved. |
| Messages | A small speech outline in a large empty canvas made the workspace feel unfinished. Transport controls and inbox panels lacked the site's material depth. | Layered front/back conversation relief, responsive physical detail, finite object entrance, deeper workspace framing and consistent transport/search transitions. | Relief layers visibly separate on hover. Transport labels, disabled controls and privacy text remain truthful. Empty inbox is reviewed; sending or receiving real messages is outside this visual run. |
| Security and recovery | The hierarchy was sound, but emblem and device surfaces felt visually separate. Disclosure movement was abrupt. | Nested metal shield relief, coherent device/panel depth, restrained signer-row feedback and a 320 ms disclosure-chevron settle. | Recovery readiness remains “Not established” in the fixture. No new check marks, completion claims or animated security metrics are introduced. Existing recovery and security-model tests remain authoritative. |
| Settings | Preference groups felt flatter than other destinations. Expansion feedback was fast and inconsistent. | Inset preference surfaces, slower row response, consistent focus treatment and smooth existing chevron rotation. | Both themes and all widths, including narrow stacked controls. Appearance and notification persistence retain their original owners. The review does not request notification permission. |
| Send | Dense entry controls had little visual focus or material response. Moving the form would interfere with typing and review. | Shared focus halo, grounded buttons, icon articulation and dialog framing; only safe headings and the backdrop receive entrances. | Desktop/phone form layout, fixed hit areas, initial focus, Tab loop and Escape. No inputs are submitted and no spend is prepared by the browser harness. |
| Receive | A large redundant decorative mark and long privacy explanation preceded the QR. Focusing Copy scrolled a phone directly to the bottom of the dialog. | Removed the redundant large mark. Kept the lead and network warning first; moved QR, full address and share/copy actions ahead of the longer privacy explanation. Initial focus now goes to the visible Close control so opening preserves the top of the dialog. | Full QR is visible in the initial 390×844 viewport. QR and full address remain stationary throughout entry. All destination guards, warning wording, share/copy handlers and privacy guidance are retained. |
| Swap previews | Composer and detail surfaces needed the same material language; selection and focus felt abrupt. | Inset metal composer/details, smoother pair-control and mode-tab response, clearer focus and small icon feedback. | Both themes and four widths. Existing “Demo · no funds”, planned-provider, illustrative-output and privacy-boundary labels remain. No live quote or swap is added. |
| How Zigs works | The migrated journeys already carried the strongest site treatment, but transitions into objects/copy and hover were comparatively abrupt. | 560 ms educational object arrival, 420 ms copy settle and restrained relief-icon hover response. Existing manual steps, Pause, reduced motion and offscreen suspension remain. | Five journeys, twenty steps and all ten reference chapters remain covered by the existing 511-check browser review. Actual 100%/200% browser zoom checked. |
| Payment reviews, recovery dialogs, funding and privacy previews | These have critical facts or existing illustrative lifecycles that should remain independently understandable. | Receive the common control, icon and framing improvements. Existing operation/status presentations and preview labels are preserved. No new animation implies confirmation, protection, successful recovery or network routing. | Shared styling reviewed in source; representative dialogs exercised. A live signing ceremony, funded payment, recovery import or private-network connection is not performed. |

## Motion specification

| Element | Treatment |
| --- | --- |
| Safe page/dialog headings | 8 px vertical settle over 440 ms; up to two headings with a 35 ms stagger. Text stays opaque. |
| Panel framing | Transparent radial reflection, 680 ms finite arrival with at most 140 ms stagger. Pointer light is updated at most once per event-driven animation frame. |
| Controls and focus | 180 ms color response; 320 ms material/shadow settle; fixed hit areas. Existing press and focus semantics remain. |
| Small icon details | Separate arrowheads, clock hands and slider details. The underlying glyph remains coherent while details respond by 1 px or a small rotation. |
| Large decorative objects | Fixed 64-unit SVG geometry with dark undercut and a five-stop silver face. One 1200 ms arrival when visible; no new endless idle loops. |
| Modal backdrop | 240 ms opacity entrance on opening. Dialog contents, inputs, amounts and warnings remain stationary. Closing continues through existing handlers. |
| Educational guide | Expressive motion stays on illustrations and reading copy. Existing Pause and lifecycle controls remain available. |

The presentation controller uses the existing wallet/panel/dialog render identity. Ordinary
wallet redraws do not restart entrances. Its only state is DOM-local observation and animation
bookkeeping: no wallet imports, requests, storage, operation timers or operation callbacks.
It batches pointer reads/writes into an event-driven frame and releases observers/listeners when
the document is discarded. Reduced motion, slow-update displays, forced colors, Save-Data and
hidden documents suppress the ambient treatment. Metal artwork has a system-color fallback.

## Evidence and reproducibility

- [Motion/interaction report](https://github.com/devzigs/zigs/blob/a3257fb22a3c64ad8b32533dbd212ffa47bcc2ba/docs/ux-redesign/visuals/gray-ui-premium/motion-report.json): **194 checks passed**,
  including **72 page/theme/width variants**, title timing, no redraw replay, stable values and
  hit areas, relief response, modal focus/Tab/Escape, phone QR visibility, reduced motion,
  forced colors, hidden-document behavior and unchanged synthetic wallet facts/storage.
- [Recorded browser evidence](https://github.com/devzigs/zigs/blob/a3257fb22a3c64ad8b32533dbd212ffa47bcc2ba/docs/ux-redesign/visuals/gray-ui-premium/motion-review.webm) contains the automated
  review, including moving transitions and rapid responsive/theme changes; it is QA evidence.
- Existing source-design browser review: **511 checks passed**, 31 captures. Real Chrome
  **100% and 200% page zoom passed**. [Style report](https://github.com/devzigs/zigs/blob/a3257fb22a3c64ad8b32533dbd212ffa47bcc2ba/docs/ux-redesign/visuals/gray-ui-premium/style-report.json),
  [zoom measurements](https://github.com/devzigs/zigs/blob/a3257fb22a3c64ad8b32533dbd212ffa47bcc2ba/docs/ux-redesign/visuals/gray-ui-premium/zoom-report.json).
- Main's required fast suite: **48 tests passed** on Node 26.12.1. `qrencode` is absent, so the
  independent QR decoder test is skipped. Browser QR stability/visibility checks still run.
- Existing full page-module integration test: **`app ok`** on Node 26, including the original
  engine-backed guards. Its headless graphics environment emitted Three.js/low-precision warnings.
- Lint: **240 JavaScript files and 2 Python files passed**, with existing rules and assertions
  retained. The new module is explicitly added to the lint file list.
- Live local Worker preview loads Manrope, the new stylesheet and motion module; no horizontal
  overflow or browser console errors were observed on the Home screen.
- [Scope/provenance audit](gray-ui-premium-audit.json) lists the presentation edits and hashes.

Run from the repository root with Playwright and Chrome available:

```sh
node solspike/tools/premium_ui_browser.mjs
node solspike/tools/site_style_browser.mjs
node solspike/tools/site_style_zoom.mjs
sh scripts/test-fast.sh
bash solspike/lint.sh
```

The browser tools accept `PLAYWRIGHT_MODULE` and `CHROME_EXECUTABLE`. The premium tool accepts
`ZIGS_PREMIUM_OUTPUT`; the existing style tools accept `ZIGS_STYLE_OUTPUT` for evidence output.
The synthetic renderer fixture blocks external requests and disables wallet boot. This longer
motion run holds the real minute-based chain refresh because it has no engine; the visibility
test uses a fresh synthetic sync age. Its storage snapshot seeds main's existing empty device
label, since that field persists on blur. No production synchronization or persistence code is
changed to accommodate the visual tests.

These checks establish the reviewed web layouts and interactions. They do not establish
physical-device frame rates, Safari/iOS rendering, real passkey UX, native motion parity or
funded-operation success. The native presentation delivered in the earlier migration is unchanged
by this web refinement. The original source working copy, `main`, and the final UI reference
branch remain untouched.
