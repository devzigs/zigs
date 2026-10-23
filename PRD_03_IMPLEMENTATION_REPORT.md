# PRD 03 — Liquid-glass wallet switcher

Implemented for the responsive web wallet header. The single-wallet heading remains unchanged.

## Branch and scope

- At discovery, `codex/ux-navigation` was already checked out at `4cd81df`, exactly equal to `codex/ux-ui-final`. It was explicitly selected before edits. Other UI tasks subsequently committed on the shared feature branch.
- This feature's commit contains only its picker, stylesheet, renderer/asset registration, browser fixture and evidence. Existing and concurrent work is excluded.
- Eventual target: `codex/ux-ui-final`. No merge, deployment or push was performed; `main` was not changed.
- Cached authoritative main reviewed: `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`. A fresh fetch could not resolve the remote host.

## Defects addressed, in priority order

1. The header's OS-managed select could not express the app's glass material or wallet metadata.
2. Options exposed names alone, without the existing network and approval rule.
3. Long names needed wrapping in the panel and truncation in the compact trigger.
4. Enlarged text needed proportional line spacing and a less crowded selected marker on phones.

## Implemented

- `web/app-wallet-switcher.js`: native disclosure trigger and accessible radio-menu rows; selected wallet is marked by “Current”, a check and an accented rim. Rows derive names, network and rule from the existing wallet list. Missing approval metadata says unavailable.
- `web/wallet-switcher.css`: one smoke-glass panel, specular edge, diffuse shadow, opaque text surfaces, bounded internal scrolling, dark/light palettes and a 200 ms / 3 px entrance. No ongoing animation.
- Existing header renderer and asset lists register the component. Keyboard support includes Enter/Space activation, arrows, Home/End, initial/multi-letter typeahead, Escape and Tab dismissal. Escape and nonfocusable outside clicks return focus; clicks on other controls preserve their destination focus.
- Reduced motion/transparency use an opaque, immediate panel; forced colours retain a selection border. Unsupported blur receives the solid base fill.
- Selection immediately delegates to the existing `openGroup` action and Overview destination. Choosing the current wallet closes without restarting its session. Opening/closing the picker causes no application redraw; normal redraws reuse existing disclosure/form restoration.

Protected cryptography, signing, custody, DKG, authentication, recovery, balances, fees, transaction logic, network routing and application state modules were untouched by this feature. The existing `openGroup` clears old wallet/chain data synchronously before loading another wallet; no decorative transition holds or remaps that data.

## Verification

- Browser fixture: **149 checks, 40 after captures, zero browser errors**. Matched baseline: **17 checks, 12 captures**. Chromium; 390 × 844 and 1440 × 900; dark/light; 1/3/15 wallets; long current and option names; missing rule; keyboard, focus return, outside click, redraw, selection callback, 200% text, forced colours and reduced preferences.
- The fixture renders the actual wallet page with runtime-only synthetic, unfunded records. Other application services and all external browser requests are disabled. Matched captures use an isolated feature snapshot to avoid concurrent worktree styling changes.
- Visual inspection covered desktop and mobile, both palettes and enlarged text. A refinement corrected cramped enlarged-text line spacing. All **52 PNGs** have no identifying metadata chunks.
- Node 24 isolated feature snapshot: **40 fast-suite commands pass**, including graph, contrast, Overview and smoke; `app` and `unified-setup` pass. The remaining `demo-check` command passes separately: **19 tests**, using permitted local stub listeners. QR command skipped because `qrencode` is unavailable.
- Strict Oxlint for the new component and browser harness passes. Syntax and whitespace checks pass.

Evidence: [before validation](docs/ux-redesign/visuals/liquid-glass/before/validation.json), [after validation](docs/ux-redesign/visuals/liquid-glass/after/validation.json).

| Representative view | Before | After |
| --- | --- | --- |
| Desktop dark, 3 wallets | [Closed](docs/ux-redesign/visuals/liquid-glass/before/3-wallets-1440-dark-closed.png) | [Open](docs/ux-redesign/visuals/liquid-glass/after/3-wallets-1440-dark-open.png) |
| Mobile light, 3 wallets | [Closed](docs/ux-redesign/visuals/liquid-glass/before/3-wallets-390-light-closed.png) | [Open](docs/ux-redesign/visuals/liquid-glass/after/3-wallets-390-light-open.png) |
| Mobile dark, 15 wallets | [Closed](docs/ux-redesign/visuals/liquid-glass/before/15-wallets-390-dark-closed.png) | [Open](docs/ux-redesign/visuals/liquid-glass/after/15-wallets-390-dark-open.png) |
| Enlarged text | — | [200% mobile](docs/ux-redesign/visuals/liquid-glass/after/double-text-390-dark.png) |

Reproduce with a local static server for `web/`, then run `node solspike/tools/liquid_glass_browser.mjs`. Configure `PLAYWRIGHT_MODULE`, `CHROME_EXECUTABLE` and `ZIGS_GLASS_ORIGIN` for the local runtime. Baselines accept saved `app-wallet.js` and `app.css` via `ZIGS_GLASS_BASELINE` and `ZIGS_GLASS_PHASE=before`.

## Limits and deferred scope

- Live backend slow-fetch/race testing, physical touch devices, Safari/Firefox, manual screen-reader testing and a browser without backdrop-filter support were not exercised. Selection callback and existing Node setup regressions pass; no new assurance about backend concurrency is claimed.
- At 200% text, the panel scrolls vertically. Financial content beneath remains unchanged and opaque.
- No search, favourites, create/join controls, persistence fields or new wallet capabilities were introduced. The separate welcome picker and sidebar remain outside this feature's scope. The bounded anchored panel fits the tested phone viewport; a new sheet primitive was unnecessary.
