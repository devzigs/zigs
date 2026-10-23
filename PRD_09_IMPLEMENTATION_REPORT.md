# PRD 09 — Transaction receipts

## Scope and source

Web only: Zcash payment detail drawer and existing Solana proposal outcomes.
`codex/ux-navigation` already existed and was selected before edits; its starting HEAD exactly
matched `codex/ux-ui-final` at `4cd81dffac9c7f3a218ffb3c512ae301d22da164`.
Fetched and reviewed authoritative `origin/main` at `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.
The supplied receipt brief is design guidance; current data paths and safeguards remain authoritative.

## Ranked defects addressed

1. Status appeared below the financial breakdown instead of orienting the receipt.
2. Amount, destination and costs were fragmented across separate surfaces.
3. Full recipient and transaction identifiers lacked dedicated copy controls.
4. Long execution details overflowed with enlarged text at narrow widths.
5. A failed on-chain Solana result could still carry an Executed/Landed badge.

## Implementation

- `web/app-drawer.js`: one opaque transaction record groups existing wallet/network context,
  lifecycle headline, exact amount, recipient checks and decoded costs. Existing blocking warnings
  precede it; approvals, execution stages, privacy disclosures and technical details remain available.
- Full addresses remain visible and gain the existing clipboard control. The full approved/proposal
  ID retains its mismatch warning and gains the same control; raw transaction access is preserved.
- `web/transaction-receipts.css` and its stylesheet link: theme-token styling, section separators,
  tabular amounts, wrapping identifiers, narrow execution metadata and forced-color support.
  No receipt animation, external asset or font request is added.
- `web/sol/payview.js`: badge uses the same existing failed outcome as its result line.
  Executed/Landed remains the existing label for successful outcomes; no finality is invented.

## Evidence and verification

Synthetic fixtures only; no user wallet, real recipient, recovery data or signing share was captured.
The renderer harness blocks external requests, app boot and automatic redraw/reaction loops. Stub engine answers live only inside
the disposable test page; production modules are not modified by the harness.

- Before: `docs/ux-redesign/visuals/transaction-receipts/before/` (20 PNGs).
- After: `docs/ux-redesign/visuals/transaction-receipts/after/` (21 PNGs).
- Representative files: `confirmed-390-light.png`, `confirmed-1440-dark.png`,
  `submitted-390-light.png`, `failed-390-dark.png`, `sol-failed-390-light.png`.
- `after/submitted-execution-390-light.png`: full ID, copy control, size and existing raw disclosure.
- `after/validation.json`: 108 passing checks, no uncaught browser errors. Ten states, dark/light,
  1440/390/320 px, keyboard copying and visible focus, stale sync, persistent send errors,
  forced colors and 200% text. Amount/address/hash presentation was visually reviewed.
- Fast suite: 40 checks passed; `demo-check` initially timed out under the sandbox, then all
  19 demo checks passed with local stub-listener permission. QR coverage skipped (`qrencode` unavailable).
- Payment-page integration (`web/test/app.mjs`) passes in the working checkout and isolated
  starting-commit-plus-receipt patch. Payment-model, approvals, contrast and smoke checks pass.

Independent work changed this checkout during implementation. Receipt-only sources were separately
assembled from the confirmed starting commit and verified; unrelated edits are excluded from the
receipt commit. Companion outcome/privacy/approval styling visible in the working checkout is not
claimed as receipt implementation. Final browser evidence uses the isolated staged sources, including committed companion UI changes.

## Deferred and limitations

- No PDF export, sharing, permanent receipt storage, explorer integration or new indexer was added.
  Existing explorer links and their privacy disclosures remain authoritative.
- Historical Solana cards do not retain the same decoded review object used during approval;
  amounts/recipient/fee reconstruction and stronger finality tracking need engineering review.
  Current result, slot, signature, failures and existing links remain unchanged.
- Received activity keeps its existing display/explorer path; a new received-payment detail route
  would exceed this focused presentation change.
- Chromium renderer fixtures cover presentation, not live broadcasts, signing, chain confirmation,
  physical devices, Safari or assistive technology certification.
- The referenced app-wide PRD and image assets were not present at their relative brief paths;
  existing theme architecture and the local visual master guide supplied the material direction.

Protected cryptography, custody, signing, DKG, auth/passkeys, recovery, privacy guarantees,
state management, amounts, fees, routing, verification and transaction execution logic are untouched.
No native files, merge, deployment or push is part of this work. No commit, merge or push to `main`.
