# PRD 04 — Financial typography

Web presentation only. `codex/ux-navigation` was already checked out at `4cd81df`, exactly equal
to `codex/ux-ui-final`, before editing. The eventual target remains `codex/ux-ui-final`.
Technical reference: fetched `origin/main` at `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.
No merge, deployment or push was performed; main was never checked out or committed to.

## Ranked defects and changes

| Priority | Finding | Implementation |
| --- | --- | --- |
| 1 | Tight tracking compressed precise numbers; font shorthands could reset tabular digits. | Neutral numeric tracking and lining/tabular numerals across balances, amounts, fees, fields and counters. Existing local Geist fonts remain. |
| 2 | The native balance competed with secondary metadata. | Available ZEC uses a 44px desktop / 36px mobile role; supporting assets retain the asset role; review amounts use 36px / 32px. USD valuation stays explicitly unavailable. |
| 3 | Small units and costs reduced readability. | Separate 14px units, 16px supporting amounts, 15px cost rows, and a subordinate SOL review unit with the unchanged exact accessible phrase. |
| 4 | Mobile columns squeezed ordinary balances; loading dimensions differed from loaded values. | Full-width mobile balance blocks and reserved metric height for loading, zero and unavailable values. Long exact values wrap without rounding, ellipsis or hidden digits. |
| 5 | Fixed leading could crowd enlarged transaction/list text. | Unitless leading for financial labels, review headings and activity text; numeric figures are isolated left-to-right in RTL layouts. |

Affected components: shared asset Overview, personal-account balance via `.money`, Send fields,
ZEC/SOL review amounts, fee/details rows, Activity/approval amounts, pending amounts and counters.
Implementation is confined to `web/design-system.css`, the financial block in `web/app.css`,
and SOL review amount markup in `web/sol/payview.js`. No new prices, totals, percentages or states
are calculated. Existing pending, stale, unavailable and error disclosures remain authoritative.

## Evidence and verification

Concurrent unrelated changes were present and continued during the task. To avoid committing or
evaluating those changes as typography, the comparison freezes `4cd81df` assets and adds only this
feature's patch. Both phases use the same inert synthetic render captures; their hashes and CSS
hashes are recorded in the validation JSON. No user wallet/profile or external service was opened.

- [Before validation](docs/ux-redesign/typography-before-validation.json) and
  [after validation](docs/ux-redesign/typography-after-validation.json): Chromium, dark/light,
  390px/1440px; Overview, Activity, Approvals and Send; large/dust values, 200% actual text sizes,
  RTL, zero/loading/unavailable geometry and keyboard editing: **178 final checks passed**.
  Review/fee/row specimens use
  production selectors with explicitly labelled synthetic markup.
- Screenshots: 68 metadata-free synthetic PNGs in
  `docs/ux-redesign/visuals/typography/{before,after}/`. Useful comparisons:
  `overview-1440-dark.png`, `overview-390-light.png`, `large-dust-200pct-390-dark.png`,
  `review-specimens-390-light.png` and `review-specimens-200pct-390-dark.png`.
- Required fast suite: **41 tests passed** on the isolated diff with Node 24. QR test skipped
  because `qrencode` is unavailable. Contrast checks passed in both palettes.
- `node web/test/sol-pay.mjs`: **passed**, including exact review amounts, private payments,
  withdrawals, stale proofs, retries, nonce safeguards and local proving.

## Limits and deferred requirements

The Activity/Approvals captures contain empty states; populated numeric rows are checked as
labelled specimens. This is presentation QA, not a live transaction, signing, sync or wallet-switch
test. Physical touch devices, screen readers and WebKit were not tested. Amounts may occupy more
lines at 200% text size; exact digits and units are preserved. Existing locale and zero-formatting
conventions remain unchanged. True decimal-column alignment would require splitting formatted
values into new DOM contracts and is deferred; existing columns remain end-aligned and tabular.
No new state policy, price feed, privacy denominator or localization architecture was added.

Protected crypto/transaction logic was untouched: no signing, DKG, custody, recovery,
authentication, encryption, routing, recipient checks, fee calculations or transaction semantics
changed. SOL uses the existing `solText()` result unchanged and separates only its visible unit.
Native paths were not edited. Pre-existing and concurrent unrelated work is excluded from this
feature commit.
