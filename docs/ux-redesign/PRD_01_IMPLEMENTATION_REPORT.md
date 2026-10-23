# PRD 01 — Premium Wallet Vault Cards

Implemented on `codex/ux-navigation`, created from `codex/ux-ui-final` at
`4cd81dffac9c7f3a218ffb3c512ae301d22da164`. Eventual merge target:
`codex/ux-ui-final`. No merge, deployment or push is part of this change.
Technical reference reviewed: fetched `origin/main` at
`3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`; no technical implementation imported.

## Findings and implementation

The existing collection uses native disclosure semantics and wallet-selection buttons.
The three ranked presentation defects were plain list-row treatment, competing name/rule/status
hierarchy, and missing network context in the compact sidebar.

- Collection/picker buttons now have a matte graphite chassis in both themes, an inset satin rim,
  restrained engraving and a landscape footprint at ordinary desktop sizes. Long names, narrow
  screens and enlarged text can increase the height rather than clipping content.
- Wallet name leads; the existing Zcash network and actual approval rule are separate lines.
  View-only access, unfinished setup, moved-wallet status, existing cached balances and unread or
  approval counts retain their existing meanings. No fabricated balances or device counts.
- Sidebar entries show name, network and approval rule even when a payment count is present.
  Wallet navigation scrolls without compressing or overlapping these labels.
- Native buttons, disclosure, data keys and selection callbacks remain. The card renderer supports
  selected text plus a persistent accent; the sidebar retains its existing current-wallet state.
  Hover lifts 2px in 160ms; press compresses 1px. Reduced motion removes both movements.
  Keyboard focus has an external outline; forced colors retain explicit boundaries and text.
- Engraving is the same generic wallet mark for every wallet. No secret, wallet identifier, hash,
  new persisted property, customization setting, runtime dependency or remote asset is used.

Affected production components: `web/app-shell.js` (`walletRow`, `sideItem`) and the bounded
PRD 01 section of `web/app.css`. Other workspace wallet lists retain compact rows. Current-wallet
header/switcher behavior is outside this feature's changes.

## Verification

Browser evidence uses actual presentation modules, synthetic in-memory wallets and inert
subscriptions in fresh Chrome profiles. Boot and cryptography are disabled in the fixture;
its readiness flag permits rendering without a server. It is not a funded wallet journey.

- The current worktree and a clean feature-only snapshot each pass **216 browser checks**:
  1/3/12 wallets; 320/390/768/1440px; both themes; independent rules; overflow and scroll access;
  200% text with a long unbroken name; keyboard and touch selection; native disclosure/redraw;
  setup/unreadable states; reduced motion; forced colors; idle animation and rendered contrast.
- Card text passes 4.5:1 against the matte face and the strongest point of the satin highlight.
  Final screenshots were visually inspected. Each PNG has identifying metadata removed.
- The isolated snapshot is based on `274317de201b7321870094cc258380be18d9471d` plus this
  feature's production patch. Its 40 other registered fast checks pass; `demo-check` passes
  separately after restoring its original tracked fixtures. The application regression passes.
  `qrencode` is unavailable, so the QR-specific check is skipped.
- Changed-file lint and whitespace checks pass, with the existing unused `chatItem` warning.
  The shared-worktree fast run initially encountered an incomplete module graph while other
  changes were being edited; the isolated graph check passes. Unrelated work was not repaired,
  reset or included in this feature's commit.

Reproduce visual checks with `node solspike/tools/vault_cards_browser.mjs`; set
`PLAYWRIGHT_MODULE` and `CHROME_EXECUTABLE` when using an external local runtime.
`ZIGS_VAULT_SOURCE` can select a clean source snapshot and `ZIGS_VAULT_OUTPUT` its evidence folder.

| Evidence | Before | After (isolated feature patch) |
| --- | --- | --- |
| Desktop dark | [Before](visuals/vault-cards/before/wallets-1440-dark.png) | [After](visuals/vault-cards/isolated/wallets-1440-dark.png) |
| Desktop light | [Before](visuals/vault-cards/before/wallets-1440-light.png) | [After](visuals/vault-cards/isolated/wallets-1440-light.png) |
| Mobile dark | [Before](visuals/vault-cards/before/wallets-390-dark.png) | [After](visuals/vault-cards/isolated/wallets-390-dark.png) |
| Mobile light | [Before](visuals/vault-cards/before/wallets-390-light.png) | [After](visuals/vault-cards/isolated/wallets-390-light.png) |

[Integrated worktree checks](visuals/vault-cards/after/validation.json),
[isolated checks](visuals/vault-cards/isolated/validation.json),
[200% name](visuals/vault-cards/isolated/long-name-200-percent.png),
[200% rule scrolled into view](visuals/vault-cards/isolated/long-name-200-percent-rule.png),
[forced-color focus](visuals/vault-cards/isolated/forced-colors-focus.png).
Integrated captures include other independently developed visual changes in the shared worktree.

## Deferred requirements and limits

- The picker has an existing Zcash network label but no verified per-wallet Solana-availability
  adapter. No Solana network label is inferred from global capability or another wallet's state.
- Existing engines do not support threshold-one shared wallets. No single-device configuration
  is enabled. Joined/online/approved counts are not invented from the approval threshold.
- Locked wallets retain the existing vault lock screen; no new locked-card state or loading
  workflow is invented. Unreadable metadata keeps the existing fallback.
- Selection retains existing setup resumption, sync and form-cleanup behavior. This visual change
  introduces no cryptographic calls, delayed selection, new navigation safeguard or state machine.
- Relative master-PRD, technical-specification and screenshot files referenced by the supplied PRD
  were unavailable beside it. Current repository tokens and code remain authoritative.
- No physical device, screen reader, live backend, funded transfer or physical authenticator was
  tested. Extreme text enlargement requires scrolling the existing picker to reach all metadata.

Signing, custody, DKG, recovery, authentication/passkeys, encryption, networking, amount/fee
calculations, recipient checks, transaction semantics and native application files are untouched
by this feature. No on-chain metadata or new wallet statistics are introduced.
