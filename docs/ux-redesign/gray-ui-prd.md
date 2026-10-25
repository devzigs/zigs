# Gray UI — presentation parity PRD

Date: 25 October 2026. Branch: `gray-ui`.

## Purpose and outcome

Bring the current application closer to the presentation on `codex/ux-ui-final`, while
retaining the engineering improvements already on main. Start from main and selectively
reapply presentation changes. Do not replace files wholesale, merge the reference branch,
or treat older source-branch behavior as a requirement.

Main already contains the substantial redesign, including its native adaptation. The
remaining web differences predominantly reverse subsequent fixes and clearer capability
disclosures. Keep those fixes. The remaining native differences include two standalone
SwiftUI presentation improvements and a larger offline-demo runtime. Port the standalone
views; defer the runtime because it introduces architecture outside this request.

No merge into main, merge commit, automatic merge, or deployment is permitted in this chat.
Review and delivery take place on `gray-ui` only.

## Exact comparison baseline

| Role | Ref | Reviewed commit |
| --- | --- | --- |
| Engineering and behavior authority; branch starting point | `origin/main` | `c6860f6fef9351531bd3a9c3a221600c49651035` |
| Visual and interaction reference | `origin/codex/ux-ui-final` | `78345496bb6438e22bfdbfbc484105df84c18c0d` |

Both refs were fetched from `https://github.com/devzigs/zigs.git` for this comparison.
Main includes `9021eb8c` (the earlier UI redesign squash) and subsequent UI ports, security
and wording reviews, rendering fixes, test improvements, and the faucet guidance.
Compare the current trees directly: a common-ancestor diff would incorrectly count
already-ported work as missing. Of 177 web runtime/asset files (excluding tests, generated
engine bindings and development harnesses), 148 are byte-identical and 29 differ. The native
comparison has 43 changed paths, including generated preview resources. Historical UI reports describe their own baselines and
are not current acceptance evidence.

## UI inventory: retain the work already on main

These requirements describe the reference design's user-facing changes. They do not
authorize importing the implementation of a capability. Existing main handlers and data
remain authoritative.

| Area | Reference UI requirements | Current disposition and evidence paths |
| --- | --- | --- |
| Branding and design system | Canonical side-profile zebra, graphite surfaces, consistent type, spacing, borders, restrained depth, semantic colors, dark/light/system themes. | Present on main. Retain `web/logo.png`, `web/design-system.css`, `web/brand-identity.css`, `web/app.css`, fonts, and native design components. Do not replace logo artwork. |
| Welcome | Cinematic zebra hero, Create/Join/Recover entry paths, saved-wallet cards, education and compact disclosures. | Present on main in `web/app-shell.js`, `web/homepage.css`, `web/homepage-motion.js` and `ios/Zigs/NativeDesign.swift`. Keep main's consistent sidebar sizing and beta/test-network disclosures. |
| Shell and navigation | Dedicated Overview, Approvals, Activity, Address book, Swap demo, Messages, Security, Settings and Help; responsive navigation and wallet identity/header. | Present on main in `web/app-shell.js`, `web/app-wallet-switcher.js`, `web/wallet-switcher.css`, `web/wallet-marble.css`, and native navigation. Keep main's Swap Demo badge and whole-word labels. |
| Setup | Guided steps, clear approval-rule education, complete thirty-digit verification, real preparation status, optional recovery, address-derived wallet artwork. | Present on main in `web/app-setup.js`, `web/app-tutorial.js`, `web/setup-wizard.js`, `web/onboarding-refinement.css`, wallet-art modules and native creation/setup views. Keep Continue with Zcash when Solana is unfinished and the optional funding demo separate. |
| Device protection | Clear recommended protection, explicit Skip confirmation, honest protection completion and failure states. | Present on main. Preserve `web/app-keystore.js` and existing native authentication; importing reference code would reverse newer safeguards. |
| Overview | Portfolio hierarchy, exact asset balances, distinct wallet/device funds, Send/Receive entry points, Pending and Recent summaries, readable empty states. | Present on main in `web/app-wallet.js`, `web/overview-model.js`, `web/overview-rows.css`, native Overview. Preserve demo-price/USDC labels, unknown values, backup reminders, and narrow-width action-label fixes. |
| Send and Receive | Clear network/address context, recipient rows, batch/memo inputs, existing fee explanations, accessible copy/QR controls. | Existing main views retained; `web/app-send.js`, `web/app-recipients.js`, `web/app-drawer.js` and native forms. Preserve latest faucet privacy and outage guidance. |
| Approvals and payment reviews | Dedicated inbox, actual approval counts, transaction inspection, separate signing/proving/submission stages, discussions inside review. | Present on main in `web/approvals-model.js`, `web/app-drawer.js`, `web/approval-visualization.css`, native approval/review views. Keep verified zero distinct from loading. |
| Activity | Full ledger, network filters, transaction receipts, explicit sync and incomplete-history states. | Present on main in `web/activity.css`, `web/transaction-receipts.css` and existing Activity views. No backport needed. |
| Address book | Device-private recipient presentation, search/edit/select flows, distinction from chat contacts and verified identities. | Present on main in `web/app-recipients.js`, `web/recipients.js`, `ios/Zigs/RecipientViews.swift`. Preserve current persistence and recovery boundaries. |
| Messages | Separate messaging workspace, relay conversations, wallet discussions, distinct web personal-account education and cost reviews. | Web present on main in `web/app-messaging-workspace.js`, `web/app-account-view.js`, messaging styles and education. Native relay remains operational; add the read-only native account walkthrough below. |
| Security and recovery | Device/share cards, recovery facts, saved vs checked vs remote reports, loss guidance, technical disclosures. | Present on main in `web/app-security-dashboard.js`, `web/security-dashboard.css`, native security/recovery views. Preserve main's device vocabulary and actual available evidence. |
| Settings | Compact groups, appearance, existing device/connection/recovery controls and clear privacy status. | Present on main in `web/app-settings-ui.js`, `web/settings-experience.css`, native settings. Preserve the current Standard connection and separate Tor demo. |
| Help | Illustrated setup/payment/security explanations and detailed capability/privacy education. | Present on main in `web/app-how-zigs-works.js`, `web/how-zigs-works-content.js`, native help. Retain updated invite/memo/privacy explanations. |
| Funding and ZNS demo | Allocation, optional name, illustrative wallet/QR/progress/result screens. | Web design exists on main. Keep it optional and labelled Demo, no payment; no mandatory activation payment, actual funding, registration or setup gate. Native runtime-dependent version is deferred. |
| Swap and post-quantum demo | Composer, asset selection, illustrative review, progress/outcome and privacy details. | Web design exists on main. Keep demo labels and transparent-Zcash/provider limitations. Native runtime-dependent version is deferred; live Swap remains unavailable. |
| Tor demo | Compact dialog, step illustration and zebra camouflage animation with reduced-motion fallback. | Web design exists on main. Keep explicit opt-in demo and direct-network status; never show a mock completion as actual Tor protection. |
| Responsive/accessibility | Keyboard access, visible focus, readable financial digits, motion preferences, mobile layouts and native adaptive rows/type. | Retain current main fixes and existing design-system behavior. Validate new native screens at narrow/wide sizes and in both themes. |

## Remaining presentation requirements

### GUI-01 — native messaging-account walkthrough

Port `ios/Zigs/NativeMessagingViews.swift` from the reference. In the native Chats workspace,
expose Relay and Zcash demo as presentation choices. Preserve existing chat offers, relay
creation, wallet conversation, unread and payment-discussion behavior.

The demo has Account, Back up, Funding and Contact steps, with Back, Next and Replay
navigation. Explain the web app's separate personal account, backup scope, fees and contact
addresses. Display a persistent Demo label and explicit native-unavailable explanation.
The walkthrough creates no key, account, address, backup, payment or message, and has no
storage, engine or network callbacks. Its step selection is view-local temporary state.

Acceptance:

- Relay remains the default and retains all existing actions and handlers.
- Zcash demo opens the four read-only steps; returning to Relay restores its normal UI.
- Fee text is illustrative and cannot be mistaken for a live quote or funded balance.
- Back/Next/Replay only select another demonstration step.
- Long text wraps at phone widths and larger native type sizes; labels are accessible.

### GUI-02 — native post-formation handoff

Port the standalone `NativePreparedCard` presentation from the reference without importing
its funding runtime. Show it only after the view observes an actual wallet moving from
setup to the existing ready state. Reuse the current Security destination for Save recovery
files; Continue to Overview dismisses the card. Preserve the existing Overview below it.

Track only which wallet's transition was observed and whether its card is dismissed. Clear
this temporary presentation on wallet changes. Never write a completion flag to the model,
change readiness, acknowledge safety checks, initiate backup, or gate Send/Receive.
Omit the reference's sentence pointing to a funding preview that is not part of this port.

Acceptance:

- Opening an already-formed wallet does not manufacture a new setup-completion event.
- An observed genuine setup-to-ready transition offers the card for that wallet.
- The card cannot appear for a different wallet after navigation.
- Save recovery files opens existing Security; Continue dismisses only the card.
- Readiness, recovery optionality, existing warnings and payment blockers remain unchanged.

### GUI-03 — retain main's web parity and corrections

No web backport is needed after inspecting all 29 differing runtime/presentation files.
The following file-level inventory accounts for every remaining web difference. Keep main
unless a separately reviewed presentation change is specified; none is specified here.

| Differing files | Decision and reason |
| --- | --- |
| `web/app.css`, `web/homepage.css`, `web/overview-rows.css` | Keep main's whole words, money overflow handling, consistent sidebar and responsive action-button fixes. |
| `web/app-shell.js` | Keep beta/network and Swap demo labels, protection checks and existing failure guidance. |
| `web/app-drawer.js`, `web/app-groups.js`, `web/app-state.js` | Keep loaded-snapshot tracking and a known zero approval count; do not replace underlying state handling. |
| `web/app-keystore.js`, `web/app-loop.js`, `web/sol/ceremony.js` | Exclude authentication/storage, redraw/click scheduling and ceremony/cache implementation differences. |
| `web/app-guided-setup.js`, `web/app-setup.js`, `web/setup-wizard.js` | Keep main's Zcash-only continuation and funding demo separated from actual setup. |
| `web/app-funding-preview.js`, `web/funding-preview.js` | Keep optional demo entry, unambiguous no-payment copy and disclosures; do not restore a mandatory-looking funding stage or invented activation fee. |
| `web/app-wallet.js` | Keep actual recovery reminders, demo valuations/USDC labels, device terminology and latest faucet outage notice. |
| `web/app-security-dashboard.js`, `web/security-dashboard-model.js`, `web/app-tutorial.js`, `web/how-zigs-works-content.js`, `web/zns-setup-preview.js` | Keep main's reviewed device language and privacy/identity/capability explanations. |
| `web/app-network-privacy.js`, `web/network-privacy-demo-entry.js`, `web/network-privacy-popup.js`, `web/network-privacy-popup.css`, `web/index.html` | Keep Standard/direct networking, explicit Tor-demo entry, truthful simulated completion, startup resilience and early theme setup. |
| `web/app-swap-preview.js`, `web/app-postquantum-swap-preview.js`, `web/swap-preview.css` | Keep main's demo/quote/provider/privacy clarity and current Max-button layout. |

## Deferred UI dependencies

Record the details in [the technical review](ux-ui-final-technical-review.md). Their presence
on the old UI branch does not authorize them in this UI-only continuation.

| ID | Desired reference experience | Dependency and disposition |
| --- | --- | --- |
| GUI-D01 | Native offline funding/name checkout, optional card/resume and Help entry. | Reference adds `NativePreviewStore`, a custom WebKit asset scheme, message/navigation bridge, resource bundling, build generation and lifecycle handling. Defer that runtime and its dependent view wiring. |
| GUI-D02 | Native interactive Swap/post-quantum preview, full-area workspace and Overview shortcut. | Shares GUI-D01's runtime. Keep main's unavailable native Swap until the runtime has a separate review. Do not add live swaps or providers. |
| GUI-D03 | The reference's integrated Funding setup step. | Changes navigation/tutorial state and makes an optional mocked payment look necessary. Preserve main's separate optional web demo; do not restore the old flow. |

`ios/NativePreviews/**`, `ios/PreviewSource/**`, `ios/Zigs/NativePreviews.swift`,
`ios/project.yml` changes and dependent resource/build scripts are excluded. Keep existing
native capture scenes, including unavailable Swap; extend capture coverage only for GUI-01
and GUI-02. Do not copy the reference's replacement of the Swap capture.

## Engineering and scope boundaries

Do not import Rust/WASM artifacts, backend/API changes, Solana protocol/ceremony work,
cryptography, authentication, persistence, wallet models, recovery formats, deployment
configuration, build architecture or test-suite restructuring. Preserve main's versions.
Keep existing Zcash/Solana capability distinctions; native has no Solana or personal
on-chain messaging account. No new live operation or protocol guarantee follows from a UI.

Old branch-specific approvals in historical documents are not new engineering approval.
Keep unrelated uncommitted work and the source reference branch intact. Use the repository's
anonymous contribution identity and existing hooks for any new commit.

## Verification and delivery

1. Record the base/ref commit IDs and a complete source/main runtime-path comparison.
2. Verify that the new diff contains only the documented native views, their capture
   coverage and this PRD/review/evidence. All web and engineering paths must equal main.
3. Run main's existing fast web suite using its required Node version and check actual
   results. Do not edit tests to make the old source implementation pass.
4. Compile/render the native layouts with synthetic fixtures; inspect the new views in
   light/dark and narrow/wide layouts. Identify fixture rendering separately from live
   wallet, Xcode/iOS and physical-device validation.
5. Report checks and limitations in `gray-ui-validation.md`. Commit the isolated result
   on `gray-ui`; never merge, deploy or enable automatic merging.

Success means existing main engineering is preserved, both independent native presentation
improvements are reviewable, all existing UI work is accounted for, and deferred runtime
work is explicit. It does not mean pixel-identical reproduction of superseded disclosures
or completion of the deferred native funding/Swap experiences.
