# Swap preview implementation

Implemented on `codex/swap-page`, based on `codex/ux-ui-final` at `27a81b1`.
Inputs: **ZIGS_SWAP_NEAR_INTENTS_PRD.md**, version 1.0 (23 October 2026), and
**ZIGS_SWAP_INTERACTIVE_MOCK.html**. The accidentally supplied Approvals brief was excluded.

## Delivered

- Compact pay/receive composer, metal direction control, searchable picker with exactly ZEC,
  SOL and USDC on Solana, slippage presets and a preview-only destination selector.
- Official token SVG artwork from the existing asset library, unchanged and displayed at a
  minimum of 32px. Secondary details open in a dialog on compact screens, keeping the main page
  within one viewport at the tested desktop, tablet and phone sizes.
- Exact decimal validation and integer mock-quote arithmetic. Missing destination, identical
  pairs, zero/negative/malformed amounts, excess precision and tiny outputs cannot open review.
- Illustrative rate and minimum receive; unknown fees, timing and price impact stay unknown.
- Native review dialog with explicit focus containment, Escape, focus restoration, full detail
  wrapping and a readable opaque financial surface. The page behind it cannot scroll.
- Manually advanced simulation with distinct illustrative steps. The terminal state is
  **Demo complete. No assets were moved.** Closing a simulation returns to an actionable preview.
- Reduced motion, forced colors, light/dark appearance and 48px interactive targets.
- Stale response suppression; input or selected-wallet changes clear conflicting reviews.
  Amount fields retain their nodes during application status redraws to preserve phone keyboards.

## Isolation and future integration

`web/swap-preview-model.js` has no wallet, browser-storage, signer or network imports. Its
deterministic asset identifiers are explicitly prefixed `demo:`. Recipient/refund identifiers
are non-address preview markers. No deposit address, transaction hash or explorer link is created.
Simulation events are user actions, never timed signing or settlement claims. The UI does not
read a real spendable balance and Max is disabled.

`web/near-intents-swap-provider.js` is an unloaded integration boundary. All methods throw
`NotImplemented`; it is not a live integration. Before implementing it, independently review
the [quote contract](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote),
[status contract](https://docs.near-intents.org/api-reference/oneclick/check-swap-execution-status),
provider token registry, quote verification and authorization. Dry quotes and committed deposits
must remain distinct. The current [chain-support documentation](https://docs.near-intents.org/resources/chain-support)
lists Zcash transparent addresses only; the UI does not claim direct shielded routing support.
The displayed shielded-route terminology follows the requested **Ironwood** wording.

Main reviewed: `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b` (fetched 23 October 2026).
Main has no implemented Swap flow. Testnet/Devnet compatibility, privacy exposure, real source
approval, address validation, refunds, live status and persistence remain engineering dependencies.
See [technical review](ux-ui-final-technical-review.md#swap-preview--23-october-2026).

## Verification and evidence

- `node web/test/swap-preview.mjs`: amount precision, invalid routes, fixture failures and
  balances, stale response races, review/simulation transitions and disabled live methods.
- Fast web suite: **43 tests passed** under Node 24. QR test skipped because `qrencode` is absent.
- Module graph: **59 modules**, including locked-vault loading. A pre-existing missing
  `zns-setup-preview.js` preload-list entry was corrected; that module was already imported
  transitively, so the change does not add behavior.
- Changed files pass the repository Oxlint page and model/harness rules and `git diff --check`.
- This web application serves native JavaScript modules; there is no separate TypeScript build
  configured for this page. The browser and module-graph checks validate module syntax/linkage.
- Current compact pass: **123 browser checks passed**, including no page scrolling at all five
  tested sizes, official icon loading/size, the three-asset picker and Ironwood copy.
  See [browser results](swap-preview-validation.json) for responsive, keyboard, validation,
  cancellation, retries, storage-isolation and zero-external-request checks.

The loopback harness loads the real view and shell modules with synthetic wallet context,
without booting a wallet engine or connecting services. Failure, unsupported-route and
insufficient/stale balance scenarios exist only in this harness. Before images render the
actual original Swap view from `27a81b1`. Screenshots contain no real addresses or personal data.

| State | Evidence |
|---|---|
| Before, desktop / mobile | [1440px](visuals/swap-preview/before/swap-1440.png), [390px](visuals/swap-preview/before/swap-390.png) |
| Empty / illustrative quote | [Idle](visuals/swap-preview/after/idle-1440.png), [quote](visuals/swap-preview/after/quote-1440.png) |
| Responsive quote | [1280px](visuals/swap-preview/after/quote-1280.png), [768px](visuals/swap-preview/after/quote-768.png), [390px](visuals/swap-preview/after/quote-390.png), [320px](visuals/swap-preview/after/quote-320.png) |
| Picker / reversed / settings | [Search](visuals/swap-preview/after/picker-search-1440.png), [reversed](visuals/swap-preview/after/reversed-1440.png), [slippage](visuals/swap-preview/after/slippage-1440.png) |
| Review / mobile actions | [Desktop](visuals/swap-preview/after/review-1440.png), [mobile](visuals/swap-preview/after/review-390.png), [actions](visuals/swap-preview/after/review-actions-390.png) |
| Compact route details | [Mobile details dialog](visuals/swap-preview/after/details-390.png) |
| Simulated progress / complete | [Progress](visuals/swap-preview/after/progress-1440.png), [complete](visuals/swap-preview/after/complete-1440.png) |
| Error / unsupported / balance | [Quote failure](visuals/swap-preview/after/error-1440.png), [route](visuals/swap-preview/after/unsupported-1440.png), [balance](visuals/swap-preview/after/balance-1440.png) |
| Appearance / accessibility | [Light](visuals/swap-preview/after/quote-light-1440.png), [forced colors](visuals/swap-preview/after/forced-colors-390.png) |

Reproduce using `node solspike/tools/swap_preview_server.mjs`, then
`node solspike/tools/swap_preview_browser.mjs` with `PLAYWRIGHT_MODULE` and optional
`CHROME_EXECUTABLE` pointing to an available local installation. The development preview is
served only at `http://127.0.0.1:8856/__swap_preview__`; it is outside the production web directory.

## Bounded design review

Five highest-impact findings, with one refinement pass:

1. The first light-theme composer inherited a dark hero gradient. Fixed using shared themed surfaces.
2. Native modal focus could escape at its final control. Fixed with an explicit Tab/Shift+Tab loop.
3. Repeated composer headings and output caveats made mobile unnecessarily tall. Removed the
   extra heading and repeated output line while keeping preview labels and the privacy warning.
   The subsequent compact pass moves secondary details into a dialog at narrow sizes, with no
   page scrolling at 1440×900, 1280×720, 768×1024, 390×844 and 320×800.
4. Real spendable balances and validated destination/refund addresses are not integrated.
   Intentionally left unavailable; no fake balances, Max action or real addresses were substituted.
5. Live network and shielded-Zcash compatibility remain unverified. Kept contextual warnings
   and a disabled live boundary; these require separately approved engineering work.

No merge, deployment, native changes or live swap operations are part of this delivery.

## Swap privacy tabs · 23 October 2026

On `codex/postquantum-near`, Swap now has two local presentation tabs, each labelled
“Powered by NEAR Intents”. **Private Swaps** is selected by default and retains the existing
illustrative composer, review and manually advanced simulation. **Post-Quantum Privacy** is
marked Planned and explains the proposed per-swap Zcash viewing-key separation, existing
threshold approvals and recovery requirement. Its Continue button now opens an interactive
local mock. The name deliberately avoids claiming that the entire swap is quantum-secure.

Tabs expose their selected state and Preview/Planned status to assistive technology, support
Left/Right and Home/End keys, and close an open preview dialog when switching. The existing
private-swap input is retained when returning. Tab selection stays in memory only.

This is a web presentation change against UI/UX baseline `b74dd79`. The engine, provider stub,
wallet records, recovery formats and cryptographic derivation are unchanged. The main reference
remains the cached `3a6c08e` above; refreshing it was unavailable during this assessment.
Future integration must resolve shielded-route support, ZIP 2005 compatibility, multi-device
address allocation, mixed-key spending, recovery and quote expiry before enabling either route.

Validation: existing Swap unit checks and all 123 existing browser checks pass. Additional local
browser checks cover tab switching, keyboard selection, focus visibility in forced colors, panel
isolation, dialog cancellation, retained input, and both themes at 1440, 1280, 768, 390 and 320px.
No external requests or browser errors were observed. The compact pass below supersedes the
original vertically scrolling phone explainer; the standard composer retains its tested layout.

### Interactive post-quantum swap mock

`web/app-postquantum-swap-preview.js` presents Configure → Review → Approvals → Status.
The memory-only mock uses a synthetic 2-of-3 wallet and illustrative ZEC-to-USDC or ZEC-to-SOL
quotes from the existing deterministic mock provider. The displayed rates are not market prices;
fees are unquoted and are not deducted. No destination address is accepted or generated.

Review freezes the chosen example amount and asset. Editing returns to Configure. Separate
buttons simulate the first and second device approvals; only then does the execution demo become
available. Quote-expiry simulation clears every example approval and requires a refreshed quote
and another review. Deposit confirmation, route execution, delivery and refund are advanced by
explicit user actions, with both delivery and refund result screens. Example references change
between demo runs but are not addresses, viewing keys, transaction hashes or recovery records.
Refund amounts remain unknown instead of inventing fees. Actual recovery is not demonstrated.

Returning to the introduction, switching privacy tabs, or changing the selected wallet context
clears the flow. Ordinary redraws preserve the active mock and its inputs. There are no timers,
live provider calls, key derivations, signer calls, real activity entries or persistent writes.

Validation: the new flow passes 117 browser checks at 1440, 768, 390 and 320px across both themes,
covering amount validation, edits, quote expiry, approval gating, both destination assets, delivery,
refund, fresh references, cancellation, context changes, keyboard access, forced colors, touch
targets and horizontal overflow. Screenshots of every stage were inspected. No external requests,
storage writes or browser errors occurred. All 123 existing Swap browser checks still pass.
The fast suite passed 46 tests; its remaining `demo-check` test initially timed out because the
sandbox prevented its local fixture servers. Rerunning that test with loopback access passed all
19 cases in under seven seconds. The QR test was skipped because `qrencode` is unavailable.
The page module graph passes with 74 modules, including locked-vault loading.

### Compact steps · 23 October 2026

Developed on `codex/postquantum-near`, starting from the merged UI/UX baseline `139d6ea`.
The intro and every demo step now fit without page scrolling at the tested normal text size.
Repeated explanations move to a native “Swap details & privacy” dialog, available from the
step header. It retains the rate, unquoted fees, wallet approval rule, destinations, privacy
boundary and recovery limitations, with Escape, contained keyboard focus, focus restoration
and cleanup when leaving the flow. Amounts, minimum received, fee notice, approval progress
and next actions remain on the relevant main screens. Validation errors replace unavailable
quote/destination summaries; those details remain accessible in the dialog.

The mobile recap becomes that details control; the desktop keeps a concise recap. Smaller
cards and step labels, two required signer rows, shorter labels and removal of a duplicate
result Back button reduce height without changing demo transitions. In the post-quantum
view only, the existing selected-wallet header uses a smaller mark and icon-only home button
(the accessible name remains “Return home”), while preserving the wallet name and network.
No fixed-height clipping or hidden page overflow is used to force the fit. Enlarged text,
unusually long names or an on-screen keyboard can still require accessible scrolling.

The [viewport report](visuals/postquantum-compact/validation.json) records **336/336** passing
states: intro, configure, review, each approval count, each execution stage, delivery, refund
and expiry, in both themes at 1440×900, 1440×728, 1280×720, 1024×768, 768×1024, 390×844 and
320×800, with and without the current UI/UX wallet header. Header integration was checked
using a read-only overlay of the target checkout and subbranch files, preserving its local work.
All visible actions remain within the viewport with at least 48px touch targets (1px measurement
tolerance). Thirty additional validation-error/detail-dialog cases fit without page or dialog
scrolling. Details keyboard behavior, Escape, context change and unmount cleanup also pass.

The 117 flow interaction checks and all 48 fast tests pass; QR is skipped because `qrencode`
is unavailable. No real provider, keys, signing, transfer, recovery or persistence is enabled.

Reviewed captures: [configure](visuals/postquantum-compact/header-320-dark-800-configure.png),
[review](visuals/postquantum-compact/header-320-dark-800-review.png),
[approvals](visuals/postquantum-compact/header-320-dark-800-approvals-2.png),
[outcome](visuals/postquantum-compact/header-320-dark-800-outcome.png),
[refund](visuals/postquantum-compact/header-320-dark-800-refund.png),
[desktop](visuals/postquantum-compact/header-1440-dark-728-outcome.png).
