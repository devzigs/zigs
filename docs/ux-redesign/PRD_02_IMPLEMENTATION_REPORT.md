# PRD 02 — Multisig approval visualization

Implemented for the web Zcash payment drawer. `codex/ux-navigation` was already checked out and
started at the same commit as `codex/ux-ui-final`: `4cd81dffac9c7f3a218ffb3c512ae301d22da164`.
The eventual merge target remains `codex/ux-ui-final`. No merge, push or deployment performed.
Latest fetched technical reference: `origin/main` at `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.
Its drawer also derives individual approval marks from filtered `state.commits`.

## Focused defects addressed

1. Flat approval chips did not explain the relationship between received approvals and wallet policy.
2. Device membership could be confused with an approval without explicit received/not-received labels.
3. Small screens needed a readable rail, while larger device sets needed a count summary.
4. Rebuilt drawer content needed scoped, deduplicated status announcements.

## Delivered

- `web/app-approval-visualization.js` and `.css`: satin-rimmed approval nodes, an opaque theme plate,
  explicit policy/count/stage, textual state marks, and a topology/finality explanation.
- `web/app-drawer.js`: replaces only approval chips with presentation derived from the existing
  device labels, filtered approval records and `stageHeadline` facts. No membership counts,
  connectivity guesses or cryptographic-share acceptance claims.
- Up to five devices use individual nodes; six or more, missing participant facts or inconsistent
  data use an aggregate. Mobile uses a vertical rail; long labels wrap.
- Errors/expiry/checking suppress orange emphasis. The existing motion observer drives a restrained
  240 ms rim effect, with no timers or simulated approval events. Reduced motion disables it.
- `web/app-loop.js`: updates a persistent polite announcement after rendering. Unchanged redraws
  remain quiet; changing payments resets the announcement baseline. The modal owns the region.
- `web/design-system.css`: imports the component stylesheet; existing theme tokens remain authoritative.

## Verification and evidence

Verified in a temporary copy of `4cd81df` with only this feature overlaid, because other changes
were being edited and staged concurrently in the shared worktree. Those changes are excluded from
this feature's commit. Screenshots contain only synthetic device/payment fixtures.

- `node web/test/app.mjs`: **pass**, full application suite (`app ok`).
- `node web/test/approvals.mjs`: **pass**, including 3,584 bucket combinations.
- `node web/test/payment-model.mjs`: **pass**.
- `node web/test/contrast.mjs`: **pass**, dark/light text and indicator token checks.
- `node web/test/premium-motion.mjs`: **pass**, 15 baseline motion tests.
- `solspike/tools/multisig_visual_browser.mjs`: **pass**, 19 browser checks; 15 after screenshots.
  Covers exact recorded node counts, aggregate/unknown fallback, changed/revoked count announcements,
  repeated redraws, payment switching, blocked actions, long names, 320/390/1440 px, both themes,
  200% base text, reduced motion and forced colours. No uncaught browser errors.
- Before: `visuals/multisig/before/drawer-{1440,390}-{dark,light}.png` and
  `drawer-approvals-{1440,390}-{dark,light}.png` (baseline renderer and styles).
- After: matching files under `visuals/multisig/after/`, plus
  `states-{1440,390,320}-{dark,light}.png` and `forced-colors-390.png`.
- Machine-readable results: `multisig-visual-validation.json`. All 23 PNGs checked for identifying metadata.

Run browser QA with `PLAYWRIGHT_MODULE` pointing to an installed Playwright module and
`CHROME_EXECUTABLE` pointing to an installed Chrome, then
`node solspike/tools/multisig_visual_browser.mjs`. It serves local files and blocks external requests.

## Deferred and limitations

- No new refusal/decline/connectivity telemetry exists in this slice. Errors use the existing
  payment-level state; no device is falsely identified as having refused.
- Solana's separate proposal renderer is unchanged. Its states and verification contract need a
  separate presentation adapter before reusing this component.
- No new snapshot-ready API was introduced. The first Zcash record remains settled under the
  existing motion guard; uncertain first-load/reconnect history never triggers an invented arrival.
- Live multi-device cryptographic ceremonies, physical screen-reader/touch testing and network
  reconnect/out-of-order delivery were not exercised. Existing filtering/state machinery is unchanged;
  browser checks cover presentation fallback and payment-context reset, not protocol behavior.
- The referenced master PRD and its screenshots were not present at the supplied relative paths;
  current code, theme tokens and the supplied feature brief guided this slice.

Protected signing, custody, DKG, recovery, passkeys, encryption, backend/network routing,
amounts/fees, transaction semantics and native code were not modified by this feature.
