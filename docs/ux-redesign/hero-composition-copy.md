# PRD 01 — Hero composition and copy

22 October 2026 · Web only · Baseline `1dc75ca`

Implemented the supplied `01_Hero_Composition_And_Copy.md`. Its referenced
`ZIGS_DESIGN_RULES.md` was not supplied or found locally; the existing design system, repository
instructions and standing web/security boundaries remained authoritative. No replacement rules
or unsupported capabilities were invented.

## Delivered

- New-user hero uses the preferred two-line heading and supporting statement, a 17px desktop/16px phone paragraph, closer copy/art composition and a 272px desktop tile. The original zebra pixels/proportions, themes, materials and existing motion are unchanged.
- Removed the repeated feature-label row and ornamental caption. The same factual information remains in the product statement and expandable security explanation.
- Test-network, beta and unaudited context appears alongside recovery beneath the actions. Create and Join remain prominent and use their original handlers. Solana privacy disclosures remain explicit in the full explanation.
- One saved wallet now exposes its actual name, network, approval rule and direct entry card. Several wallets appear as a scannable collection with actual counts and existing selection/status indicators. Create/Join/Recover remain secondary. No automatic wallet opening or routing changes were introduced.
- Existing wallet rows and handlers are reused: balances remain actual/unknown, and unfinished, view-only, moved, unreadable, approval and message status generation is unchanged. The visible card action says Open wallet, or Continue setup for an existing guided setup.
- The existing loading and locked entry guards remain in their original order. No wallet-state, storage, authentication, signing, API or native code changed. The shared wallet-context switcher is untouched.

## Copy and scope check

Main technical reference: `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.
Main's README and this checkout's protocol documentation describe threshold-controlled shielded
Zcash, independent signing shares, beta/unaudited status and test-network creation.
`MAINNET_ON` remains false. Legacy mainnet wallets still open through existing handlers; returning
entry therefore states that **new wallets** use test networks, alongside each wallet's actual network.
The preferred statement is scoped to Zcash and is not extended to Solana. This source review is
not an independent security audit; the unaudited notice remains visible.

## Visual review and one correction

Matched captures cover zero, one and many wallets at 320×800, 390×844, 1024×768 and 1440×900,
light/dark: **48 before/after captures**. No final capture has horizontal overflow or a tested
landing interaction target below 48px. Creation actions precede decoration on phones; returning
wallet entry leads the create/join flow.

The first screenshot pass exposed an unreadable-wallet notice stretched to the full card row
height. One scoped correction keeps it a compact error surface without changing the error or
its handling. No other speculative layout refinements were made.

| View | Before | After |
| --- | --- | --- |
| zero wallets · 390px · light | [Before](visuals/hero-composition-copy/before/zero-390-light.png) | [After](visuals/hero-composition-copy/after/zero-390-light.png) |
| zero wallets · 390px · dark | [Before](visuals/hero-composition-copy/before/zero-390-dark.png) | [After](visuals/hero-composition-copy/after/zero-390-dark.png) |
| zero wallets · 1440px · light | [Before](visuals/hero-composition-copy/before/zero-1440-light.png) | [After](visuals/hero-composition-copy/after/zero-1440-light.png) |
| zero wallets · 1440px · dark | [Before](visuals/hero-composition-copy/before/zero-1440-dark.png) | [After](visuals/hero-composition-copy/after/zero-1440-dark.png) |
| one wallets · 390px · light | [Before](visuals/hero-composition-copy/before/one-390-light.png) | [After](visuals/hero-composition-copy/after/one-390-light.png) |
| one wallets · 390px · dark | [Before](visuals/hero-composition-copy/before/one-390-dark.png) | [After](visuals/hero-composition-copy/after/one-390-dark.png) |
| one wallets · 1440px · light | [Before](visuals/hero-composition-copy/before/one-1440-light.png) | [After](visuals/hero-composition-copy/after/one-1440-light.png) |
| one wallets · 1440px · dark | [Before](visuals/hero-composition-copy/before/one-1440-dark.png) | [After](visuals/hero-composition-copy/after/one-1440-dark.png) |
| many wallets · 390px · light | [Before](visuals/hero-composition-copy/before/many-390-light.png) | [After](visuals/hero-composition-copy/after/many-390-light.png) |
| many wallets · 390px · dark | [Before](visuals/hero-composition-copy/before/many-390-dark.png) | [After](visuals/hero-composition-copy/after/many-390-dark.png) |
| many wallets · 1440px · light | [Before](visuals/hero-composition-copy/before/many-1440-light.png) | [After](visuals/hero-composition-copy/after/many-1440-light.png) |
| many wallets · 1440px · dark | [Before](visuals/hero-composition-copy/before/many-1440-dark.png) | [After](visuals/hero-composition-copy/after/many-1440-dark.png) |

[All captures and validation](hero-composition-copy-validation.json).
Twelve additional state captures cover stalled-engine loading, an actual passkey-encrypted vault
reload and expanded explanation at 390/1440px in both themes. The loading surface was exercised
with a test-only pending engine import; no production state was changed. The locked test uses the
existing localhost passkey origin and a virtual authenticator. Wallet lists use runtime-only
synthetic metadata in temporary contexts, never fabricated production holdings.

## Checks and limits

- Reused entry harness: **575 checks passed**, including 320/360/390/768/1024/1440/1920px, system-light/system-dark, enlarged text, forced colours, initial primary-action visibility, keyboard focus across redraws and Create/Join/Recover interaction.
- **19 state checks passed**, including no empty hero while loading/locked, retained full disclosures and the direct card invoking the existing wallet-opening handler.
- **42 Node 24 fast suites** and the longer **unified-setup** suite passed. QR regression remains skipped because qrencode is unavailable.
- Page-module and core changed-harness lint/import checks pass. Full repository lint retains existing issues in legacy visual tools and Solana review code. The updated vault-card harness has the same four baseline nesting findings; no new ones were introduced. These are recorded rather than expanding this composition task into unrelated refactoring.
- Worker/web dry-run build passed. No runtime dependencies or new decorative animations were introduced. No merge or deployment.

Expanded explanations, long collections, short viewports and enlarged text may scroll. Physical
phones, Safari, screen readers, software keyboards and funded payment operations were not tested
in this pass. The preview remains available at `http://127.0.0.1:55846/`.
