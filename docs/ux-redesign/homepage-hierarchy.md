# Homepage hierarchy — review pass 1

Historical checkpoint. Superseded by the [completed full homepage redesign](homepage-redesign.md).

23 October 2026 · `codex/homepage` · Web presentation only

Returning users now reach their existing wallet cards before Create another, Join a wallet and
Recover access. The returning header and canonical zebra are compact, so wallet access appears
in the initial desktop and mobile viewport. The DOM follows the same order as the visual layout.
Users with several wallets choose from the actual list; no wallet is selected on their behalf.

The zero-wallet experience keeps its current hero and primary Create wallet action. Existing
sidebar destinations, menu, unfinished-setup notice, education disclosure and local Test wallet
entry remain available. The hero artwork, headline redesign, materials, new wallet-card design
and threshold illustration belong to later review passes.

## Before and after

| State | Before | After |
| --- | --- | --- |
| Returning desktop | [1440px](visuals/homepage-hierarchy/before/returning-1440.png) | [1440px](visuals/homepage-hierarchy/after/returning-1440-dark.png) |
| Returning mobile | [390px](visuals/homepage-hierarchy/before/returning-390.png) | [390px](visuals/homepage-hierarchy/after/returning-390-dark.png) |
| New desktop | [1440px](visuals/homepage-hierarchy/before/new-1440.png) | [1440px](visuals/homepage-hierarchy/after/new-1440-dark.png) |
| New mobile | [390px](visuals/homepage-hierarchy/before/new-390.png) | [390px](visuals/homepage-hierarchy/after/new-390-dark.png) |

Captures use isolated, unfunded browser stores. Returning names and wallet metadata are synthetic
and held only in browser memory. They are test evidence, not production data or demo app routes.
Unavailable wallet artwork keeps its existing fallback; unknown balances remain Open to sync.

## Validation

- [200 browser checks and 15 final captures](visuals/homepage-hierarchy/after/validation.json)
  pass. New, returning and multiple-wallet layouts cover 320, 375, 390, 768, 1024 and 1440px in
  dark and light themes, with reduced motion. Each has one H1, no horizontal overflow and controls
  at least 44px high. Primary entry remains in the initial viewport.
- Create, Create another, Join, invalid-invite feedback, Recover and Open retain their existing
  actions. Keyboard Join focuses the private input. Open selects the corresponding wallet using
  inert test subscriptions. Historical Mainnet and Testnet labels, different approval policies
  and unknown balances stay distinct. Long names, multiple cards, actual 200% text and forced-color
  keyboard focus pass. Delayed engine loading never renders an empty-wallet launcher. The local
  Test wallet link retains its exact destination and new-tab/noopener attributes.
- The local preview serves the actual web files and inserts the unchanged shim at the same place
  as the Worker. External browser requests are blocked. This validates presentation and handlers;
  it does not certify live backend services, physical devices, Safari or assistive technology.
- All 47 executed Node 24 fast-suite scripts pass across the main run and the isolated rerun of
  demo-check. The sandbox prevented that test's local listeners during the first run; all 19 of
  its subtests pass with loopback listeners allowed. Optional qrencode comparison was skipped
  because qrencode is unavailable.
- Page-module named-import/global lint, focused browser-helper lint and `git diff --check` pass.
- The broader unified-setup suite still stops at its existing messaging assertion,
  `messages: no duplicate Overview heading`, before reaching the homepage tests. The same failure
  was reproduced from unchanged branch HEAD under Node 24. Its returning creation-label
  expectation now matches Create another and also checks that cards precede secondary actions.

## Exact source changes

- `web/app-shell.js`: move the existing returning wallet collection above setup actions; label
  returning creation Create another. Preserve all handlers and wallet-row rendering.
- `web/homepage.css`: scoped spacing, compact returning header, proportional original artwork,
  and layout for the existing join form.
- `web/index.html`: load the homepage stylesheet.
- `web/test/unified-setup.mjs`: update the returning label and assert wallet-first DOM order.
- `solspike/tools/homepage_hierarchy_browser.mjs`: repeatable isolated browser verification.

This note, four baseline captures, fifteen final captures and the JSON validation report provide
review evidence. No commit, push, merge or deployment was performed.

## Technical reference and engineering approval

`origin/main` was fetched successfully and remains at `3a6c08e` (Merge port-send-form). No technical
behavior was imported or changed. Wallet collection, network, balance, status, setup eligibility,
loading, lock and error semantics remain the existing application's source of truth.

No new engineering approval is required for this pass. The missing metallic concept illustration
was not introduced; the existing canonical logo remains unchanged. This pass does not create a
new identity derivation, select a default wallet, persist UI state, or change cryptography,
authentication, permissions, recovery, routes, backend services or native files.
