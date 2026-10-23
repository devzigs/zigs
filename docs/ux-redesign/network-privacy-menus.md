# Privacy & Network: app menu integration

**Historical integration report.** The current [landing-page popup](network-privacy-popup.md)
supersedes the information-only panel described below. The original app now opens normally,
with an automatic compact privacy popup and one global top-right demo status. Settings and
Welcome open that same popup; the earlier wallet-only Standard control was removed.
Current verification commands run the popup suite and write to `visuals/network-privacy-popup/`.

23 October 2026 · `codex/privacy` · review before a future UX/UI merge.

This follow-up adds presentation entry points to the real web app. It starts from the committed
UX/UI baseline `b74dd79` (the previous standalone privacy preview merge). The UX/UI checkout and
its unrelated uncommitted work were not edited. Latest locally fetched main remains
`3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`; the [network audit](network-privacy.md)
documents existing direct networking and the engineering needed for Tor.

## Where it appears

- **Welcome:** Privacy & Network beneath the setup/returning-wallet content. It is optional
  connection education; Create, Join and Recover retain their existing actions.
- **Wallet header:** Standard connection opens the panel. It describes the app's direct request
  paths without claiming Connected, successful endpoint checks, or verified Tor protection.
- **Settings → Privacy & Network:** available both with an open wallet and without one, immediately
  after General. It opens exactly the same panel as the header and Welcome.

The shared panel explains Standard as current app networking, marks integrated Tor unavailable,
and distinguishes transaction privacy from connection privacy. Further disclosure explains
website/gateway IP exposure, browser fingerprinting, accounts, compromised devices and timing.
The existing advanced provider/storage disclosures remain accessible.

**Open design preview** opens the original interactive flow in a separate tab, with no wallet
identifiers or query parameters and no opener access. Its notice explicitly states that it makes
no Tor connection and performs no wallet activity. It does not change the original wallet connection.

## Boundaries

This is a truthful information panel, not a working transport selector. No mode preference is
saved. No circuit/service test, request routing, reconnect logic, startup gate, wallet model,
cryptography, recovery format or backend service is changed. First-launch Private/Standard
selection and transport progress remain in the isolated preview until separately approved
engineering can make them functional before wallet networking starts.

The panel uses the existing app dialog/layer system, focus restoration and Escape handling.
Explicit disclosure/link tab stops support WebKit keyboard navigation. Locking the wallet closes
the panel; it never bypasses the locked view. Existing transaction/backup/setup dialogs retain
their higher priority. The small module-local open/closed flag is presentation state only.

## Review locally

```sh
node solspike/tools/network_privacy_menu_preview.mjs
```

Open [the app menu integration preview](http://127.0.0.1:4190/). Use **Preview app screen** to
choose Welcome, Wallet header, Wallet Settings or App Settings, then open Privacy & Network.
`PRIVACY_MENU_PORT` changes the port.

This local server uses actual app renderers with synthetic state and an inert reactor; it does
not boot a wallet or serve wallet endpoints. The fixture label stays outside the app so it cannot
be confused with real account data. This fixture code is not imported by the production app.

## Verification

- `network_privacy_menu_browser.mjs`: **129 checks in Chromium and 129 in WebKit**, covering all
  entry points, truthful copy, shared panel, keyboard containment/focus return, disclosure,
  separate preview tab with no opener access, unchanged context/storage and lock behavior.
- Light/dark layouts at 390px and 1440px have no horizontal overflow. The mobile panel follows
  the app's full-width bottom-sheet layout. Screenshots and reports are in
  [`visuals/network-privacy-menus/`](visuals/network-privacy-menus/).
- The existing `settings_design_browser.mjs` suite passes **52 checks and 14 layout cases**
  (320–1440px, light/dark), retaining address safeguards, descriptions, memo consent, notification
  permissions, theme persistence, recovery error handling, Help and Security & Recovery.
- Browser fixtures block external requests and reject wallet-service requests, sockets and
  workers. No wallet service requests were attempted during the menu checks. This is evidence
  about these information interactions, not a production Tor leak test.

Run the menu checks with Playwright available:

```sh
node solspike/tools/network_privacy_menu_browser.mjs
```

Existing environment conventions support `PLAYWRIGHT_MODULE`, `CHROME_EXECUTABLE`,
`PRIVACY_BROWSER=webkit` and `PRIVACY_MENU_QA_DIR`. Nothing is installed by the script.
Screenshot capture is Chromium-only; WebKit runs the interaction checks without the screenshot
shim, as described in the original audit. No merge, push or deployment is included in this follow-up.
