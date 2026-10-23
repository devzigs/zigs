# Remaining web surfaces: audit and polish

Baseline: `205322b`. Technical reference: main `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.
Reviewed the supplied v3 PRD's utility-screen, component, material and state requirements
(CMP-03/04/12/16/18–24; SCR-12–14/17/19–21), the [reference mapping](art-direction.md),
and the existing renderer/overlay inventory. The v3 porcelain/graphite direction takes precedence
over the historical colours in that mapping. No new inspection of third-party artwork is claimed.

Dashboard/assets, onboarding/security/recovery and payments retain the preceding rounds' work:
[dashboard](dashboard-polish.md), [onboarding](onboarding-polish.md), [payments](payment-polish.md).
This pass addresses the remaining utility seams rather than reworking those compositions.

## Targeted changes

| Inconsistency | Improvement using existing tokens/components |
| --- | --- |
| Settings had a tall browser-preferences column beside a mostly empty Advanced panel. | Browser preferences use three content-sized desktop columns; Advanced has its own disclosure row. Access and optional personal-account sections share the existing two-column layout. Ordinary actions size to their content. Reading and tab order stay unchanged. |
| Address book nested a panel, tinted card and address box around each entry. | Flat divided recipient rows, one opaque address well, readable address typography and a quieter editor. Empty/no-results states have a deliberate supporting surface. Names, destination types and full addresses remain available. |
| Conversation content and composers were visually loose. | Existing message bodies use neutral opaque wells and the shared spacing/type roles. Composers have a clear divider, wrapping controls and balanced mobile actions. Trust labels and request-versus-message semantics are unchanged. |
| Help answers and diagnostics looked like dense technical footnotes. | Shared control typography, generous disclosure hit areas, open-state material, bounded answer measure and readable wrapping diagnostics. Native disclosure/keyboard behavior is preserved. |
| Unreadable-item failures resembled routine muted metadata. | The existing failure component now uses the established error text/border on an opaque surface, with wrapping. No warning is removed, hidden or converted to transient-only feedback. |

One refinement follows comparison: let mobile chat actions share the available width. Relevant
recipient/request rules are consolidated instead of adding another parallel component. Existing
glass menus, orange primary controls, porcelain/graphite themes and guarded motion are retained;
no new animation, backdrop layer, preference, capability or dependency is introduced.

## Remaining-surface reconciliation

**Rendered** means exercised in an isolated browser and captured; **source** means reviewed in
its actual renderer, with applicable existing regression coverage, without claiming a new
screenshot for every branch. Shared styling alone is not visual verification of every state.

| Existing surface / entry | Source | States reviewed and evidence |
| --- | --- | --- |
| Wallet Settings, private description and browser preferences | `web/app-wallet.js` | Rendered: initial, Advanced open/closed, appearance changes. Existing description persistence/validation unchanged. |
| Browser Settings outside a selected wallet | `web/app-shell.js` | Rendered through existing contact-to-Settings navigation. Appearance/access/account use the same primitives; no wallet-only controls invented. |
| Address book | `web/app-recipients.js` | Rendered: empty, saved long name/address, add/edit, invalid-address error, removal warning/cancel, search/no results. Existing format/storage/blocked-store behavior reviewed in source and regressions. |
| Address/destination/native selects | `web/app-recipients.js`, `web/app-theme.js`, `web/app-payreq.js`, `web/app-dom.js` | Appearance handler exercised; destination/request selectors captured in their forms. Wallet/sender/funding selection contracts reviewed. Browser-owned popup chrome is not a custom Zigs menu and is not newly visually certified. |
| Chats workspace / wallet conversation | `web/app-shell.js`, `web/app-thread.js` | Rendered: empty workspace, wallet entry, empty and actual synthetic signed local message, request composer, retained unsent draft. No payment/request submitted. |
| New direct chat / waiting / leave | `web/app-thread.js` | Rendered: new-chat dialog/cancel, created local chat waiting for contact, private invite disclosure closed/masked, Leave warning/cancel. Join-link/busy/error/trust distinctions reviewed in source; not every variant newly rendered. |
| Personal account / message-fee funding | `web/app-account-view.js` | Rendered: optional create panel, unfunded fixture account with synthetic display-chain balance, existing funding/backup warnings, funding controls, removal warning/cancel. No funding transaction or on-chain message sent. Loading/damaged/legacy salvage cases source/regression only. |
| Messaging contact / personal backup | `web/app-account-view.js`, `web/app-backups.js` | Add-contact dialog, contact address/composer and personal-account backup dialog captured. Secrets, invite payloads and file/password controls masked when visible. No backup export, restore or protected reveal performed. |
| Payment request cards and forms | `web/app-payreq.js` | Request composer rendered; invalid request, unverified source, same-wallet restrictions and unavailable payer states reviewed in source/regression. Financial proposal/review functionality remains under the prior payment audit. |
| Help / diagnostics | `web/app-help.js` | Rendered: collapsed/open FAQ and diagnostics. Diagnostics evidence replaces the visible diagnostic text with a fixed synthetic fact list; real diagnostic generation/redaction unchanged. |
| Swap | `web/app-shell.js` | Rendered existing unavailable workspace and disabled action; no quote or swap functionality added. |
| Mobile menu / utility glass | `web/app-shell.js` | Rendered open menu, 48px controls and Escape dismissal. Existing diffusion, opaque reduced-transparency/unsupported-effects fallbacks and focus handlers retained. No new stacking system. |
| Locked / forget confirmation | `web/app-shell.js` | Actual protected fixture reloaded via Lock now; locked view and Lost-passkey warning/cancel rendered. Damaged-vault variant source/regression only. No deletion or authentication change. |
| Startup and unreadable item | `web/app-shell.js`, `web/app-dom.js` | Original renderers captured as a labelled read-only composition; not a real server outage or corruption. Root unreadable-page recovery, engine failure and offline notice reviewed in `web/app-loop.js` / `web/app-engine.js`. |
| Banners, loading, permission and sync errors | `web/app-state.js`, `web/app-loop.js`, `web/app-thread.js`, `web/app-chain.js` | Existing synthetic error banner captured; persistent callouts/disabled reasons and shared status styles reviewed. Actual permission denial, every network failure and every async intermediate state are not newly induced. |
| Tooltips, overflow actions and remaining confirmations | existing native `title`, `details`, inline confirmation and layer entries | Reconciled with `app-loop.js` layers and shell/thread/account actions. No additional custom tooltip/menu/dialog renderer found. Earlier payment/backup/restore/create layers retain their prior evidence; OS-owned UI is outside app styling. |
| Solana status/settings details | `web/sol/view.js`, `web/sol/payview.js` | Source/style and existing Solana regression coverage retained; live service/legacy/capability combinations remain prerequisite-dependent. No new functional or visual capability implied. |

Dedicated offline-signing screens, Swap execution and usable USDC holdings remain unimplemented;
no build required. There are no newly deferred technical changes from this CSS-only pass.

## Before / after evidence

Matching viewport/theme captures use the existing unfunded browser journey in independent
stores, virtual authenticators and blocked non-local requests. Account/wallet addresses naturally
differ between fresh runs. Screenshots demonstrate presentation, not custody or network safety.

| Representative surface | Before | After |
| --- | --- | --- |
| Settings, desktop light | [Before](visuals/remaining-polish/before/settings-1440-light.png) | [After](visuals/remaining-polish/after/settings-1440-light.png) |
| Saved recipient, phone light | [Before](visuals/remaining-polish/before/recipient-saved-390-light.png) | [After](visuals/remaining-polish/after/recipient-saved-390-light.png) |
| Invalid recipient, phone dark | [Before](visuals/remaining-polish/before/recipient-error-390-dark.png) | [After](visuals/remaining-polish/after/recipient-error-390-dark.png) |
| Wallet conversation, phone dark | [Before](visuals/remaining-polish/before/wallet-conversation-390-dark.png) | [After](visuals/remaining-polish/after/wallet-conversation-390-dark.png) |
| Direct chat, desktop light | [Before](visuals/remaining-polish/before/direct-chat-1440-light.png) | [After](visuals/remaining-polish/after/direct-chat-1440-light.png) |
| Help, desktop light | [Before](visuals/remaining-polish/before/help-1440-light.png) | [After](visuals/remaining-polish/after/help-1440-light.png) |

The evidence also retains representative menus, unavailable/empty/loading states, personal
account, contact, backup and destructive confirmations, plus enlarged-text/forced-colors captures.
See [machine-readable results](remaining-polish-validation.json) for exact coverage and counts.

Only `web/app.css` changes production code. All JavaScript, wallet logic, cryptography, fees,
addresses, authentication, storage, APIs and architecture remain byte-identical. No native edits,
merge, deployment, new runtime asset or dependency. Existing no-motion/opaque fallback behavior
is retained. No new performance, QR-decoding, physical-device, Safari or assistive-technology
verification is claimed. Live funded operations, provider/OS dialogs, and the source-only states
listed above remain outside this rendered validation.
