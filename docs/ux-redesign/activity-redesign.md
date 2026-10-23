# Activity and transaction history redesign

23 October 2026 · `codex/activity-page` · baseline `ebf236a`.
Isolated checkout; other branches and uncommitted work were preserved. No commit, push,
merge or deployment was performed.

## Source review and scope

Reviewed the rendered baseline, Activity and Approvals row renderers, payment drawer,
`app-chain.js`, `app-payments.js`, `payment-model.js`, `privacy-language.js`, and Solana
`view.js` activity projection. Technical reference: freshly fetched `origin/main` at
`3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`; its activity and Solana projections were checked.
Local premium reports for typography, receipts, privacy, glass, motion, ambient lighting
and brand identity supplied the existing material and semantic rules. The named master
`Zigs_App_Wide_Premium_UI_PRD_v3.md` and `ZIGS_DESIGN_RULES.md` were not available locally.

The model combines received ZEC, Zcash payment proposals and limited Solana records.
Its existing filter is **All / Zcash / Solana**, not direction or status. Received ZEC
has a block height; its sorting time is estimated, so calendar groups would be misleading.
Solana activity includes current proposals and the last local Add SOL attempt; it omits
other people's incoming transfers and may omit older or not-yet-checked proposals.

## Delivered

- One concise heading and subtitle below the existing wallet context/switcher.
- Accessible network filter chips reuse the exact existing predicate and UI state. Active
  filters, shown record count, keyboard focus and a filtered-empty reset are visible.
- A compact, unboxed timeline engraving accompanies honest empty, loading and failed-sync
  states. An unfinished read never claims that the wallet has no activity.
- Opaque graphite rows have aligned, exact amounts, distinct units, clear direction glyphs,
  restrained separators and existing status chips. Desktop and mobile retain the same
  status functions as Approvals. At narrow widths with enlarged text, values can stack.
- Received ZEC retains its verified Shielded cue. Solana deposits use a Public transfer cue;
  other Solana projections link privacy understanding to their existing details, because
  the activity projection does not expose a verified per-operation privacy classification.
- A compact expandable Solana notice preserves the full temporary-deposit, missing-incoming,
  older-proposal and checking disclosures. Stopped, mismatched and loading states retain
  their own explanation. Received-record explorer/privacy disclosure remains visible.
- The existing Zcash receipt prioritizes lifecycle and exact fee-inclusive amount before
  the detailed privacy explanation. Costs, complete recipients, copy buttons, transaction
  identifier, raw transaction, approval stages, discussion and safety warnings remain.
  Glass is confined to the receipt header; financial content is opaque.
- No filter popover was needed after replacing the existing select with direct chips.
  Hover/focus transitions use existing tokens, reduced-motion support and forced colors.

## Critical rendered review

The five largest issues identified in the first implementation review were:

1. An older stacked-list selector overrode the new mobile grid. Fixed its specificity and
   added a rendered assertion that title and amount columns remain readable.
2. The empty-state container still looked like a large placeholder panel. Removed its
   enclosing material and border; the compact timeline now sits in an open composition.
3. Mobile metadata/status text was too small. Increased the sizes and added a stacked
   layout at 320px for enlarged-text readability. Filter reset also restores focus.
4. Received ZEC opens an explorer rather than an internal receipt. Existing behavior is
   preserved; a new detail route needs a separate engineering decision.
5. Mixed records lack reliable settlement timestamps. Existing dates/block heights remain;
   new date groups and a unified chronology are deferred.

The first three were fixed, then one final visual and interaction pass was run. Empty,
filtered, loading, failure, populated, busy, pending/confirmed Solana and Zcash records,
receipt and phone views were inspected. No repeated subjective refinement loop was used.

## Evidence

All captures use production presentation functions with explicitly synthetic, non-authorizing
data in a fresh browser. App boot, full-wallet reactions and external requests are blocked.
No production fixture, wallet record, credential, key or funded transaction is added.

| View | Before | After |
| --- | --- | --- |
| Desktop empty | [Before](visuals/activity-redesign/before/empty-1440-dark.png) | [After](visuals/activity-redesign/after/empty-1440-dark.png) |
| Phone populated | [Before](visuals/activity-redesign/before/populated-390-dark.png) | [After](visuals/activity-redesign/after/populated-390-dark.png) |
| Desktop populated | [Before](visuals/activity-redesign/before/populated-1440-dark.png) | [After](visuals/activity-redesign/after/populated-1440-dark.png) |
| Receipt | [Before](visuals/activity-redesign/before/receipt-1440-dark.png) | [After](visuals/activity-redesign/after/receipt-1440-dark.png) |
| Phone receipt | [Before](visuals/activity-redesign/before/receipt-390-dark.png) | [After](visuals/activity-redesign/after/receipt-390-dark.png) |
| Filtered empty | [Before](visuals/activity-redesign/before/filtered-1440-dark.png) | [After](visuals/activity-redesign/after/filtered-1440-dark.png) |

Additional captures cover light-mode empty states, 106 records, Solana failures,
loading/error views, receipt execution/ID controls and enlarged text in forced colors.
The 38 PNGs contain only image chunks, with no text or identifying metadata.

## Validation

- [Before browser matrix](visuals/activity-redesign/before/validation.json): 65 checks,
  18 screenshots, zero uncaught errors. Sources are read from the fixed `ebf236a` baseline.
- [Final browser matrix](visuals/activity-redesign/after/validation.json): 161 checks,
  20 screenshots, zero uncaught errors. Covers 1440/1280/768/390px, both themes, 320px
  enlarged text, forced colors, no continuous/reduced-motion animation, keyboard filtering,
  reset, exact explorer destination, retained disclosures and exact recipient/ID copying.
  Additional checks cover module-level Solana loading/failure and simultaneous chain failures.
- The fixture invokes existing filter handlers and the real save/restore disclosure helpers.
  Full application scheduling and live backend subscriptions are not exercised by it.
- Fast suite: 40 of 42 suites initially passed, one skipped (`qrencode` unavailable).
  `demo-check` passed all 19 checks when rerun with local-listener access, leaving 41 of
  42 fast suites passing. `graph` fails identically on the baseline: `app-setup.js`
  imports `zns-setup-preview.js`, which is absent from the `app.js` module registry.
- `web/test/app.mjs`: passed (`app ok`, exit 0).
- Full `web/test/sol-pay.mjs`: passed (`sol-pay: ok`, exit 0), including withdrawal, retry,
  expiry, late execution and local-proving scenarios.
- `web/test/sol-app.mjs`: fails identically on baseline and candidate at line 129. Its
  Overview assertion expects no existing “Up to date” text. No Activity assertion failed.
- Frontend esbuild bundle smoke check passed; output is temporary and not deployed.
- Scoped strict Oxlint, JavaScript syntax and `git diff --check` passed.
- [Source audit](activity-source-audit.json): all 209 declarations outside the six edited
  presentation declarations are unchanged; native/backend/transaction/model paths are
  unchanged from baseline. Native paths also match fetched main.

Chromium only. No physical device, screen-reader speech, live signing, funded broadcast,
indexer/prover, chain-confirmation or cross-browser integration claim is made.

## Dependencies requiring a separate implementation scope

See the Activity section of [the technical review](ux-ui-final-technical-review.md).
This pass adds no received-payment route, indexing/persistence changes, new filtering
criteria, date reconstruction, pagination architecture or stronger privacy/finality claim.

## Authorized UI/UX merge · 23 October 2026

The user explicitly authorized merging into `codex/ux-ui-final`. Activity source commit
`708400f` is integrated with target `31e9c20`, including its newer Approvals work.
Header conflicts retain both destination-specific headings. The shared receipt preserves
Approvals' financial/verification hierarchy; Activity retains its early lifecycle headline.
Both stylesheets and both sets of technical-review notes remain.

Integration verification: 161 Activity and 51 Approvals browser checks pass with zero
uncaught errors. All 42 fast regression suites pass (QR skipped: `qrencode` unavailable).
Scoped strict lint, frontend bundle smoke check and whitespace checks pass. No protected
transaction/backend/native paths change. Integration screenshots are temporary QA captures;
original feature evidence is preserved. No push or deployment is authorized or performed.

The target's pre-existing uncommitted work is kept outside the merge commit, with a separate
file/hash backup and Git stash retained during restoration.
