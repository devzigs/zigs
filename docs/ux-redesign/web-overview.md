# Web portfolio Overview

Technical reference: main `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`, fetched again on
21 October 2026. This iteration changes web presentation only. Native files match main.
No merge or deployment is authorized.

## Interface

- The total-balance panel uses US dollars as its display denomination, with `$—` and an explicit
  unavailable explanation. The user chose this because main has no price source. It never shows
  a fabricated quote, a zero valuation or a sum of different asset units. Test funds carry a
  no-cash-value disclosure.
- Send and Receive first reveal a keyboard-accessible asset choice. ZEC opens the unchanged
  existing dialog. SOL opens the existing private-send fields or receiving details. Existing
  validation, network context, setup, fee, proof and approval gates remain authoritative.
- SOL Receive points to the full verified shielded protocol address, with the existing
  program-address warning and an explicit compatible-wallet disclosure. It does not substitute
  the public program account, group key or a device's fee address.
- ZEC, SOL and USDC retain exact asset-unit balances, unknown states and sync-age warnings.
  Official bundled marks identify each asset; they never load from third-party sites at runtime.
- Shielded/unshielded percentage fields remain unknown: main has no complete same-owner balance
  pair. ZEC Shield/Unshield and every USDC action remain unavailable. SOL Shield opens the
  existing Add SOL form using this device's public fee funds; Unshield opens the existing public
  withdrawal requiring wallet approvals. Opening a form does not execute a transaction.
- Pending is the default transaction view directly below the assets. It reuses the complete
  approval inbox, including attention states and missing-record holds. The Review shortcut
  selects Pending before focusing it. Recent shows the five newest rows from the existing
  combined history, retaining incomplete-history and explorer-privacy notes. View all activity
  opens the full sidebar Activity destination.
- HTML disclosure controls and the existing dialog/focus loop provide keyboard behavior.
  Transaction-view buttons expose their selected state through `aria-pressed`; they require no
  new routing, persistent preference, custom keyboard model or payment state.

## Validation and evidence

| Check | Result |
| --- | --- |
| Node 24 regression | 49 suites passed; no unresolved failures |
| Strict lint | 157 JavaScript and two Python files passed |
| Before browser journey | 180 checks, 43 captures, no uncaught errors |
| Final browser journey | 253 checks, 57 captures, no uncaught errors |
| Scope/privacy | Native paths match main; 232 PNGs have no text or EXIF chunks |
| Original checkout | HEAD, status and all 828 snapshotted file hashes unchanged |

Before captures use a copy of the immediately preceding web interface, including the approved
Zigs logo. After captures use this iteration. The shared journey forms unfunded wallets in three
independent browser stores. Display chain height, balances and any explicitly inserted recent
rows are synthetic. These checks do not demonstrate a funded transfer or live pricing.

- [Before browser report](web-overview-before-validation.json)
- [After browser report](web-overview-after-validation.json)
- [Node regression report](web-overview-regression-validation.json)
- [Separate engineering requirements](ux-ui-final-technical-review.md)
- [Official asset sources and terms](../../web/assets/README.md)

The browser matrix covers 320, 390, 768 and 1440px, light/dark/system appearance, actual doubled
text, reduced motion/transparency and forced colors. It checks overflow, 48px controls, asset
choice focus return, unavailable controls and transaction view navigation. Local evidence does
not claim live Solana RPC/prover operation, hardware passkeys, physical-device independence,
assistive technology or software-keyboard testing.

| Previous Overview | Portfolio Overview |
| --- | --- |
| ![Before, light](visuals/web-overview/before/06-overview-1440-light.png) | ![After, light](visuals/web-overview/after/06-overview-1440-light.png) |

![Receive asset choices](visuals/web-overview/after/22-overview-receive-choices.png)

![Recent transactions with synthetic display data](visuals/web-overview/after/23-overview-recent-populated-full-1440.png)
