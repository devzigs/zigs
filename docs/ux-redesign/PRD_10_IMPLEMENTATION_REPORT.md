# PRD 10 — Visual identity

22 October 2026. Web presentation only.

## Branch and scope

`codex/ux-navigation` was already checked out and explicitly selected before editing. Its HEAD
and `codex/ux-ui-final` were both `4cd81dffac9c7f3a218ffb3c512ae301d22da164`.
The eventual review/merge target is `codex/ux-ui-final`. No merge, deployment or push was made.
Fetched main reference: `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.

The supplied PRD was used as a design brief; repository constraints and actual product semantics
remain authoritative. Its linked master PRD and source screenshots were not available at the
referenced relative paths. The canonical zebra must remain unchanged under `AGENTS.md`, so the
requested logo refinement is a presentation treatment, not replacement artwork.

Pre-existing and concurrent edits were excluded from this change. Product changes consist of
one stylesheet link, `web/brand-identity.css`, and four local SVGs (1,107 bytes total).
No application JavaScript, cryptography, custody, signing, authentication, state, routing,
transaction amounts, fee calculations or native files were changed by this pass.

## Implemented

Ranked baseline defects: generic empty-state artwork; no consistent engraving on wallet rows;
setup illustration visually separate from the welcome object; no reusable motif comparison.

- Welcome: fine cuts and a directional silver rim on the existing satin plate. The supplied
  zebra pixels, transparency, eye and header/favicon references remain unchanged.
- Wallet list: small engraving in allocated title space. Also supports the concurrent vault-card
  layout by putting the same engraving beside its ZIGS wordmark. Neither treatment covers data.
- Setup education: three separated, chamfered fragments replace the decorative header shield
  inside the already labelled teaching illustration. Actual device/approval nodes stay intact.
- Activity/approval empty surfaces: neutral engraved plate beside existing guidance, including
  existing loading/error wording. No check mark or implied successful outcome.
- Static assets, existing palette tokens, no animation, no third-party assets or fonts. Forced
  colours and browsers without CSS masks restore the original meaningful interface symbols.

## Usage matrix and tokens

| Motif | Size | Theme | Surface | Meaning |
| --- | --- | --- | --- | --- |
| Canonical zebra | 24/32/64 px studies; existing production sizes | Dark/light | Existing identity slots | Zigs identity only |
| `engraving.svg` | 40×18 plate/card; 32×16 row | Existing metal token | Welcome plate, wallet list | Decorative brand cuts |
| `fragments.svg` | Existing 32–40 px icon slot | Existing metal token | Tutorial wallet header only | Independent forms in an illustration; no live status |
| `empty-plate.svg` | Existing 64 px slot | Existing metal token | Workflow guidance | Neutral brand object |
| `outcome-seal.svg` | 24–32 px | Existing metal token | Comparison board / reserved asset | No product status until a verified outcome integration |

Approved tokens are defined in `web/brand-identity.css`: `--brand-cut` aliases `--metal`;
`--brand-rim` is a decorative silver reflection; `--brand-engraving`, `--brand-fragments`,
`--brand-empty` and `--brand-seal` point to local SVGs. Orange and existing status colours are
unchanged. Do not reuse fragments as a loader or interpret their count as the wallet threshold.
Do not put a seal on pending, signed-only, submitted, unknown or failed payments.

## Verification and evidence

Browser evidence is under `visuals/brand-identity/`:

- `before/` and `after/`: 12 matched Chromium captures each — welcome, wallet list and
  tutorial/empty composition at 1440 and 390 px, in dark and light themes. Long synthetic wallet
  names are included. Text hashes, disabled controls and horizontal-overflow results match.
- `committed/`: 12 additional captures using the committed `4cd81df` app modules/styles plus
  this stylesheet. Confirms the motifs also work without concurrent UI changes.
- `after/education-forced-colors.png`, `after/education-text-200.png`: fallback and text-size
  checks passed. Reduced-motion artwork has no animation. Original symbols return in forced colours.
- `comparison-board.html` and `after/comparison-board.png`: all motifs, both themes, desktop
  and mobile densities. `after/motifs-2x.png` checks high-density rendering. Logo studies include
  original 24/32/64 px versions and a CSS grayscale viewing study; no derived logo is shipped.
- `before/checks.json`, `after/checks.json`, `committed/checks.json`: no uncaught browser errors,
  no horizontal overflow, all requested motif assets returned 200. PNG metadata audit passed.

Screenshots use fresh stores and synthetic view fixtures, with app boot and external traffic
disabled; no real wallet secrets or chain operations were used. Readiness is supplied only in
the test responses. These are presentation checks, not end-to-end security or payment tests.
Keyboard Enter opens the existing wallet disclosure. No event handler or action target changed.
The first review moved the engraving away from the zebra; the board's inherited theme was also
corrected before final review. Decorative marks do not convey essential information; existing
text/status contrast tokens are retained.

Re-run with a local server serving `web/`, then execute
`node solspike/tools/brand_identity_browser.mjs` (supports `PLAYWRIGHT_MODULE`,
`CHROME_EXECUTABLE`, `ZIGS_BRAND_ORIGIN`; `ZIGS_BRAND_PHASE=committed` isolates baseline modules).
The matched comparison used a frozen copy of the incoming presentation files via
`ZIGS_BRAND_FROZEN`. That temporary baseline is not a runtime dependency.

`scripts/test-fast.sh`: 41 tests ran; 39 passed, graph failed, demo-check initially timed out
under socket restrictions; QR skipped because qrencode is absent. The isolated local-server
demo-check rerun passed. Graph diagnostics involve concurrent modules (`app-security.js`,
`wallet-switcher.js`, `outcome-seal.js`, `approval-visualization.js`) and their import registration;
this pass changes none of those files. Broader combined-worktree validation remains incomplete.

## Deferred and limits

The outcome seal is provided as artwork only. Its live receipt integration is deferred to the
actual transaction-outcome presentation, rather than asserting success from a decorative mark.
The selected wallet already has explicit text and state styling; no extra orange status seam was
added. No new 3D scene, key-reconstruction illustration or continuous animation was introduced.
Full touch journeys, live wallet outcomes and cross-engine QA were not repeated for this CSS-only
slice. Concurrent work can change surrounding layouts after these frozen comparisons.
