# Privacy popup on the existing landing page

## Current Gray UI refinement — 26 October 2026

The historical prototype described below predates main’s simplified, on-demand preview.
Current behavior follows main: the header opens the preview, closing takes one action, and
the controller stores no connection choice or protected state. It never opens on arrival.
The current four stages and their original timing are preserved.

This refinement restores the earlier “Make your connection private” headline and calmer
benefit-led language. A visible Preview label and direct-connection disclosure accompany
every screen. The primary action reads “Preview private connection”; completion explains
that Tor routing is unavailable here and the connection has not changed. The header stays
“Tor · Preview” throughout. Existing Settings still explains actual connection capabilities.

The entire sequence now uses the application’s warm neutral surfaces, Manrope typography,
relief icon geometry, rounded controls and restrained motion. The route illustration has
separate browser, Tor and wallet-service nodes. Progress cards distinguish the active and
upcoming illustrative steps. Decorative movement is disabled for reduced motion, while
forced colors and short viewports retain readable content and reachable actions.

The standalone popup duplicates only the small fixed icon paths it uses from `app-icons.js`;
it does not import page modules across main’s enforced module boundary. No network, storage,
wallet operation, authorization gate or underlying controller transition was changed.

## Historical prototype

23 October 2026 · `codex/privacy` · revision of `819486f`.

The user requested a small popup immediately over the existing landing page, a mocked
private-connection flow inside it, and a top-right status across every app page. This replaces
the earlier full-page synthetic wallet experience. The original landing, wallet and navigation
remain available after the popup closes.

## Experience

- Arrival opens **Make your connection private.** in a compact dialog. Turn on private
  connection advances illustrative milestones inside the popup. Continue moves directly to
  the camouflage sequence. The failure-simulation control is removed. The four stages last 2.2, 3, 4.2 and 2.6 seconds
  (about 12 seconds total), with the circuit stage taking longest. No percentages or real
  endpoint checks are shown.
- After those stages, a separate zebra illustration walks in front of a stripe field. The
  stripes brighten and align as the zebra disappears over 5.6 seconds. Only then does
  **Your private route is ready.** appear. Skip animation is available. Reduced motion uses
  a still stripe field for 900ms, without walking or fading. Closing mid-sequence cancels its
  pending completion; Keep setting up replays it.
- Completion shows **Tor Protected · Preview** at the top right across Welcome, wallet and
  Settings pages. It is a discreet single-line pill matching the test-network badge's type,
  border, padding and small dot. **Preview** remains visible; **Preview only · traffic stays direct**
  appears in the tooltip and accessible label, with the full disclosure inside every popup screen.
  The control sits inside the existing page header, beside the test-network badge on the
  landing page. There is no additional bar above the application.
- Closing with X, Escape or the backdrop before completion shows **Continue without Tor?**:
  “Closing this window means there is no additional privacy routing through Tor. Wallet
  services may see your IP address.” Keep setting up resumes setup. Continue without Tor
  confirms dismissal and leaves **Tor routing off** visible. Repeated Escape cannot bypass it.
- Closing after completion retains the completed preview status. Disabling that status requires the same confirmation, with cancellation
  retaining the previous choice.
- The top-right control and **Settings → Privacy & Network** open the same popup. Existing
  wallet dialogs retain priority. Modal focus stays inside the popup and returns to its opener.
- A completed or declined mock choice is remembered separately under
  `zigs-privacy-popup-demo:v1`, containing only a version and `enabled`/`standard` choice.
  Unreadable/corrupt storage prompts again. The controller never reads wallet storage, stores
  wallet data, or modifies wallet state. A remembered completed demo is not verified connectivity.

Every popup screen states **Preview only. No Tor connection is created; traffic stays direct.**
The word Demo and the extra simulation commentary have been removed from user-facing popup copy;
a minimal Preview qualifier remains because this UI provides no real protection. The disclosure
also distinguishes network privacy from transaction privacy and covers
website/gateway IP exposure, browser fingerprinting and identification limits.

## Implementation boundary

`network-privacy-demo-entry.js` loads theme, installs the popup, then loads the existing app and
homepage motion. Original engine preloads are restored. The popup module has no wallet imports.
It owns only its DOM, focus, illustrative progress and isolated demo preference. After each
app presentation redraw, the same status control mounts inside the current page's existing
header. Responsive headers wrap their controls when needed. The popup remains outside the
page renderer. The previous replacement demo's JavaScript and stylesheet are removed.

`network-privacy-camouflage.js` creates a local SVG with an articulated zebra, a shared stripe
pattern and CSS walking/camouflage motion. It loads no external assets, libraries or workers.
This is a decorative illustration, not a replacement for the unchanged canonical `web/logo.png`.
Its animation is never interpreted as transport evidence or transaction readiness.

**The existing app still starts and uses direct networking behind this popup.** The dialog
does not gate startup, intercept requests or confer privacy. This is a UI prototype, not leakage
prevention. Real circuits, transport readiness, worker/WASM routing, safe transaction switching
and security approval remain deferred to the [network audit's engineering gates](network-privacy.md).
The earlier isolated scenario preview at `/dev/network-privacy/` remains available for detailed
status/deferred-switch review. Native code, wallet schemas and protocol behavior are unchanged.

## Local review and validation

```sh
node solspike/tools/network_privacy_demo_server.mjs
```

Open [the landing-page popup preview](http://127.0.0.1:4194/). This review server uses actual app
renderers with synthetic wallet state and an inert reactor. Its Preview app screen selector
demonstrates the persistent status on Welcome, Wallet, Wallet Settings and App Settings without
loading wallet services. That fixture selector is not included in the branch app.

`network_privacy_menu_browser.mjs` passed **167 checks in Chromium and 167 in WebKit**. These cover
automatic arrival, X/Escape/backdrop warnings, cancellation, Standard confirmation, automatic and
manual completion, return visits, unchanged wallet/other storage,
placement inside existing headers, the slower automatic walkthrough, shared Settings entry,
existing-dialog priority and keyboard containment. Normal-motion checks verify the walking
sequence, disappearance before the ready message, cancellation without a stale completion and
Skip animation. Reduced-motion checks verify a still transition, and no failure control exists.
Light/dark layouts at 320px, 390px and 1440px have no horizontal overflow. Text contrast, reduced
motion, live announcements, 200% CSS magnification and half-width desktop zoom reflow are checked.
The actual HTML entry is separately checked with wallet-entry stubs. The existing Settings
regression suite passed **52 checks and 14 layout cases**.

Screenshots and machine-readable results: [popup evidence](https://github.com/devzigs/zigs/blob/a3257fb22a3c64ad8b32533dbd212ffa47bcc2ba/docs/ux-redesign/visuals/network-privacy-popup/).
The fixture rejects service, WASM/JSON, socket and worker activity; none was attempted. These
checks verify the isolated UI, not the networking of a live wallet. The compatibility command
`network_privacy_demo_browser.mjs` runs this same popup suite. Runtime overrides are
`PLAYWRIGHT_MODULE`, `CHROME_EXECUTABLE`, `PRIVACY_BROWSER` and `PRIVACY_POPUP_QA_DIR`.

## Approved UI/UX integration

The user subsequently authorized merging and pushing this experience into `codex/ux-ui-final`.
Privacy source: `17fde7ff`; current UI/UX baseline: `ba65a44a`. The merge preserves the latest
UI/UX accessibility and homepage changes. On the combined tree, the privacy suite passed
167 checks in Chromium and 167 in WebKit, and Settings passed 52 checks across 14 layouts.
Web-only scope and anonymous Git attribution checks passed. No deployment is included.
