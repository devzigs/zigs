# Full first-launch experience demo

**Superseded by the [landing-page popup](network-privacy-popup.md).** This historical report
describes commit `819486f`, which the user replaced with a small popup over the original app.
Its replacement-page JavaScript and CSS are removed. The normal entry now loads the original
app, and `network_privacy_demo_server.mjs` serves the popup fixture on port 4194. The browser
command now runs the popup suite. The old screenshots below remain historical evidence only.

23 October 2026 · `codex/privacy` · based on UX/UI merge `0fc7d0f`.

The user explicitly requested the whole mocked experience and chose **Open automatically in
the branch build, clearly labeled Demo, using synthetic wallet data**. This supersedes the
earlier information-panel-only presentation for the normal branch entry. No Tor functionality
is implemented, and this change is not a production network privacy release.

## Normal entry journey

Open the normal app URL in this branch build:

1. Welcome → Get started.
2. Choose Private (recommended and preselected) or Standard.
3. Watch automatically advancing **simulated** connection milestones. A Continue demo now
   control allows a faster walkthrough. Neither path opens a real transport or tests endpoints.
4. Choose Create, Import or Unlock before the sample dashboard.
5. In the sample wallet, open connection controls from the header or Settings. Switch either
   mode; Standard requires explicit confirmation. Cancellation retains the current demo mode.

Create includes a made-up wallet name, illustrative 2-of-3 or 3-of-5 approval rule, simulated
passkey protection or Skip, review and a sample balance/dashboard. Import uses a supplied
illustrative backup without reading files or passphrases. Unlock never calls WebAuthn or reads
credentials. Sample amounts, rules and protection marks are labeled synthetic or simulated.

The persistent top banner identifies Demo mode, simulated connectivity and synthetic wallets.
The same notice appears in connection dialogs, so the private Connected label cannot be
mistaken for real protection while reviewing this build.

## Returning, switching and failures

- The only record read/written by the demo is `zigs-network-demo:v1`: a version, mock mode,
  optional made-up sample name and illustrative approval rule. It contains no keys, identifiers,
  addresses, backup contents or passphrases. Use made-up names as the UI requests.
- Reload reuses the saved mock mode, reconnects in simulation, and then offers sample Unlock
  when a demo wallet exists. It does not show the connection choice again. No Connected status
  is persisted; every visit performs the simulated establishment step anew.
- Start demo over removes only this record. An unreadable/corrupt preference starts a fresh
  journey; unavailable storage produces a notice without blocking the walkthrough.
- Simulate return visit and Lock demo wallet let reviewers explore returning behavior without
  changing real credentials, locks or wallet state.
- Demo scenario controls cover interrupted, offline and unavailable outcomes. Retry retains
  the selected mode. There is no automatic direct fallback.
- Formation/signing/broadcast scenarios defer mode changes until an explicit Simulate safe
  point action. These are illustrative states; no protocol, nonce or transaction is operated.

## Bootstrap isolation and current app access

`web/index.html` loads `network-privacy-demo-entry.js` as its only module entry. The default
path imports the self-contained demo rather than the wallet application. Engine module/WASM
preloads and the independent homepage-motion entry were removed from the default HTML to
avoid accidentally initializing or loading wallet infrastructure before the demo.

The website's existing injected relay shim remains idle until its API is used; the demo never
uses it. No backend, transport routing, engine implementation, wallet authentication, recovery
format or native code is changed. A demo-load failure displays an error, never starts the real app.

The footer's **Open current wallet app · Direct connection** is an explicit escape to
`?wallet=live`. Only that explicit URL loads the existing theme, wallet app and homepage-motion
modules against the original HTML shell. That app never consumes the saved mock connection
choice: its networking remains the existing direct transport. The demo is not a Tor gate in
front of real funds. This real-app path is separate from the synthetic walkthrough.

## Local review

```sh
node solspike/tools/network_privacy_demo_server.mjs
```

Open [the complete experience](http://127.0.0.1:4192/) and click Get started. It opens automatically
at the root rather than through a small menu link. Use Start demo over if the browser has a saved
demo preference. `PRIVACY_DEMO_PORT` changes the local port.

The local static server serves the actual branch HTML and includes the deployed page's idle
relay shim for verification. It has no wallet services. The original isolated state-review
preview and the information-panel integration fixture remain available for design comparison.

## Verification

`solspike/tools/network_privacy_demo_browser.mjs` exercises the normal HTML entry, all three
wallet paths, automatic milestones, explicit switching and cancellation, return/reload behavior,
corrupt preferences, failures/retry, keyboard radio choice, modal focus, and light/dark layouts
at 390px and 1440px. Reports and Chromium screenshots are in
[`visuals/network-privacy-experience/`](visuals/network-privacy-experience/).

Verified: **86 complete-experience checks in Chromium and 86 in WebKit**, with no default-path
wallet modules, service calls, engine loads or credential access. The updated current-app menu
checks pass **129 assertions**, including opening the full demo without changing wallet context.
The preserved current-app Settings suite passes **52 checks and 14 light/dark layout cases**;
its synthetic fixture explicitly reproduces the legacy bootstrap's theme load. The explicit
current-app entry is also checked with module stubs, without booting a real wallet in that test.

The browser guard rejects wallet module scripts, engine/WASM/JSON requests and wallet service
paths; instruments fetch, sockets, workers, WebRTC, credentials, cookies and storage; permits
only the single demo preference key; and records CSP violations. Both creation and import can
therefore be tested without accessing wallet data or initiating real networking. The server
uses `connect-src 'none'` and `worker-src 'none'` for these demo checks.

Existing environment conventions support `PLAYWRIGHT_MODULE`, `CHROME_EXECUTABLE`,
`PRIVACY_BROWSER=webkit` and `PRIVACY_DEMO_QA_DIR`. Nothing is installed. WebKit skips screenshots
to avoid Playwright's CSP-incompatible screenshot shim while running the interaction checks.

This pass provides no real Tor circuit, production network protection, cryptographic ceremony,
passkey credential or wallet. Real engineering and release gates remain in the original audit.
No merge, push or deployment is included in this follow-up.
