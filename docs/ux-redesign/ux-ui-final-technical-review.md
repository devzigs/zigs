

# Gray UI — deferred technical dependencies

Reviewed on 25 October 2026 against main
`c6860f6fef9351531bd3a9c3a221600c49651035` and UI reference
`78345496bb6438e22bfdbfbc484105df84c18c0d`.

The [Gray UI PRD](gray-ui-prd.md) governs this continuation. Historical approvals below
do not authorize engineering changes in this UI-only request.

## Latest web design working-copy migration — 25 October 2026

The actual local `codex/ux-ui-final` checkout contains a later uncommitted design pass not
present in remote commit `78345496`: Manrope, new web branding/icons, neutral surfaces,
refined controls and the five illustrated guide journeys. The Gray UI migration imports
those 24 presentation files; its source hashes are pinned in
[gray-ui-design-source.json](gray-ui-design-source.json). The source checkout remains intact.

The new guide consumes main’s existing complete-guide content. Its fixed educational
examples, mode/chapter/step selection and animation lifecycle are document-local presentation;
they do not read or mutate wallet records, browser wallet storage, URL fragments, setup
readiness, authentication or spending authority. Preserve current main’s disclosures,
known-versus-unknown facts and technical behavior. Branding updates apply to web only;
the old native artwork remains unchanged. This web migration needs no deferred runtime below.

## Native funding and Swap previews — GUI-D01 / GUI-D02

The remaining native demo experience depends on new runtime infrastructure in the reference:

- `ios/Zigs/NativePreviews.swift` adds an observable session store, `WKWebView`, custom
  asset-scheme handling, script messages, navigation/link handling, zoom synchronization
  and teardown when the app locks.
- `ios/NativePreviews/**` contains generated HTML, JavaScript, styles, fonts and assets.
- `ios/project.yml` adds resource packaging and a generation-check build step, supported
  by `scripts/build-native-previews.py` and `ios/check-previews.sh`.
- Funding cards, Help entry, full-area Swap workspace and Overview Swap shortcuts depend
  on those runtime types and resources.

Do not import the bridge, store, asset loader, resource/build changes or dependent wiring
under this request. The independent SwiftUI messaging walkthrough and post-formation card
do not require them. Keep native Swap unavailable. A future separately scoped review must
assess asset/network isolation, script messages, wallet-context disclosure, lock teardown,
external navigation and build/resource lifecycle. No live Swap, native Solana or native
personal-account implementation is implied by the visual reference.

## Funding as a wallet-setup stage — GUI-D03

The reference adds Funding to `SETUP_FLOW_STAGES`, invokes it automatically for the creator,
lets its controls revisit guided setup, and describes a setup/activation payment. Keep
main's explicitly optional separate demo, Zcash-only continuation when Solana is unfinished,
existing disclosures and gates. No payment, activation fee, name registration or provider
connection is implemented in this pass.

## Preserved main improvements

Do not reverse main's protection/storage fixes, WebAuthn availability, loaded-approval state,
redraw/click scheduling, Solana key cache, recovery reminders, theme startup or test-runner
restructuring. Preserve current beta/test-network, USD/USDC demo, Tor/direct-network,
transparent-Zcash swap, memo-viewing and faucet-outage disclosures.

No merge, automatic merge or deployment is authorized in this chat.

---

# Deferred engineering review

## Landing-page privacy popup — 23 October 2026

The user's latest correction replaces the full-page synthetic experience with a compact popup
over the existing landing page. The [popup report](network-privacy-popup.md) records the mock
connection, explicit dismissal warning and compact **Tor Protected · Preview** status in existing
headers, with direct-traffic disclosure in the tooltip and popup. Settings opens the same popup.
The original app starts normally; the modal does not gate or route any wallet requests. Only an isolated demo choice is saved,
without wallet data or transport authorization. Tor, real startup gating and protocol-safe
switching remain separate engineering work under the [network audit](network-privacy.md).
The latest visual follow-up removes the failure-simulation control and adds a local SVG zebra
walking into a stripe field before the ready message. Reduced motion uses a still transition.
A minimal Preview qualifier and direct-traffic notice remain because animation cannot prove
protection. The canonical logo and actual transport behavior are unchanged.

## Network privacy audit and isolated preview — 23 October 2026

The user selected a web audit and design pass on `codex/privacy`. The
[network privacy report](network-privacy.md) inventories current requests, records dependency
versions and startup gaps, and links the standalone interactive preview. Tor adapters, gateway
infrastructure, production preference persistence, live status and safe transport switching
remain unimplemented and require separate engineering approval. The preview's manually selected
states never establish protection, operate a wallet or access wallet storage. Native work,
production networking, cryptography and recovery formats are outside this pass.

The subsequent [menu integration](network-privacy-menus.md) adds a shared informational panel
from Welcome, the wallet header and Settings on `codex/privacy`. It describes current Standard
networking, marks Tor unavailable and links the isolated flow in a separate tab. The actual
first-launch choice and transport controls remain deferred; no preference or routing is changed.

## Wallet marble reveal — 22 October 2026

The user approved production artwork integration and clarified the reveal timing after learning
that the verified public address does not exist at Create wallet. The [integration report](wallet-marble-integration.md)
records the implementation and evidence. The code-to-marble scene follows the existing
verification and preparation gates; it never advances a ceremony or claims readiness from
animation completion. No new engineering capability or deferral was needed. Immediate final
address-derived artwork before the ceremony remains unavailable; the later timing resolves it.

## Wallet creation and onboarding refinement — 22 October 2026

Remote main was rechecked at `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.
The [onboarding refinement report](onboarding-refinement.md) records the presentation pass.
No new engineering capability was needed or enabled. The approved safe interpretations remain:
keep all thirty comparison digits and per-device acknowledgements; retain optional passkey
Skip and optional recovery; retain the complete Solana service disclosure and opt-out; expose
backups only after the existing chain-preparation checks; use Save and optional Check rather
than inventing an inline restore workflow. Mainnet remains unavailable for creation.
Shortened codes, changed signing/recovery policy, stronger remote presence or recovery claims,
and modified consent/authorization mechanisms remain outside this UI-only pass.

The approved rough-notes follow-up adds only a transient arrival effect, completion ordering
and educational walkthroughs. Browser protection copy distinguishes registration, PRF key
derivation, verified local saving and cleanup from later unlocking; signing copy distinguishes
formation, Zcash transaction signing/proving and Solana proposal approval/execution. These
diagrams do not observe progress, grant protection or authorize a payment. No new engineering
deferral is needed. This follow-up's remote-main retry failed DNS; the last successfully checked
reference above remains the comparison point, and no technical changes were merged.

Reference: main at `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.
This web-only PR improves presentation and implements the separately approved device-private
recipient book, tutorial progress, optional signed backup reports and read-only file checks.
The items below remain unimplemented.

| Item | Existing behavior | Separate work requiring approval |
| --- | --- | --- |
| Swaps | No execution or quotes; UI is explicitly unavailable. | Supported networks/pairs, provider integration, quote validity, slippage, costs and security gates. |
| Shielded USDC | No balance/payment support; Solana Devnet label and disabled actions. | Token identity, privacy semantics, deposits, accounting, proofs, fees and withdrawals before enabling actions. |
| USD portfolio valuation | No price feed or conversion data exists. The user chose an unavailable dollar value for this UI-only pass. | Separately approve a provider, price freshness/failure policy, network coverage and privacy before adding valuation. Test funds have no cash value. |
| Shielded/unshielded percentages | ZEC tracks shielded notes only. SOL shielded holdings, legacy public group funds and individual device fee funds have different scopes and observation times. Percentages and the compact Overview's unfilled bar remain unknown; there is no default 100% or 50/50 split. | Define a complete same-owner denominator, freshness and zero-balance behavior before calculating ratios or proportional coloured bar segments. Never include device fee funds in shared holdings or mistake legacy private SOL for public SOL. |
| ZEC Shield/Unshield | No transparent balance, recipient or transfer support in the current shared-wallet engine. Controls remain unavailable. | Transparent inputs/outputs, address handling, fee calculation, privacy and engine validation need a separate engineering design and approval. |
| Recipient recovery/transfer | Local book is excluded from unchanged recovery files. | Backup formats, import/export, synchronization or sharing need privacy, migration and compatibility review. |
| Reported Solana server error | User asked to ignore investigation of the earlier environment. Guided setup explains unavailable service and preserves Zcash. | Diagnose a specific deployment only if requested; never bypass availability, nonce, funding or proof requirements. |
| Compulsory Solana setup | Testnet creation includes Solana by default and retains the existing final-review opt-out and service/privacy consent. The user chose to defer compulsory setup. | Review removal of the opt-out separately, including consent, saved plans and capability/outage behavior. Do not force Solana or enable Mainnet in this presentation pass. |
| Independent remote file verification | Signed status reports authenticate the reporting device; another device cannot inspect the backup itself. | Any stronger verification protocol needs separate security and privacy design. Reports remain informational. |

Mac/iPhone implementation and planning are outside this pass. Every native source path matches main.

Replacing signers still creates a new wallet/address followed by the existing approved transfer
process. Existing Solana funds are not implied to move with Zcash funds.

No cryptographic primitive, payment calculation, backend service, authorization gate or existing
recovery format is redesigned. No merge or deployment is authorized in this chat.

## New feedback requiring separate engineering

- **ZNS purchase during setup (mock requested 22 October 2026):** an optional sixth web setup
  step previews a name, ZEC or SOL selection, an illustrative amount and a non-payable QR.
  The existing five-stage readiness model and completion checks are unchanged. Drafts stay in
  tab memory and never attach a name to a wallet, query availability or create payment proposals.
  Latest fetched main reviewed: `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`; it supports testnet
  recipient-name lookup, not a registration checkout. A real purchase needs registrar eligibility
  and availability, authoritative price/expiry, confirmation and refund handling, supported
  payment rails (including a SOL settlement provider), and a reviewed shared-wallet ownership
  policy: ZNS memo access currently gives each signer individual name control
  ([existing spike, section 3.3](../zns-spike.md)). The demo QR contains a warning, name and
  example amount as plain text, with no payment URI or recipient. Nothing is purchased.
- **Optional passkey protection (approved 21 October 2026):** the user explicitly approved Skip
  after reviewing unencrypted local signing-share storage. The [implemented warning, tab-only
  acknowledgement and safeguards](optional-passkey-review.md) describe this narrow setup-policy
  exception. Other authentication, cryptography, recovery and payment changes remain separate.
- **1-of-1 and 1-of-2 shared wallets:** current main requires 2–7 devices and at least two approvals
  in both the signed wallet shape and actual Zcash/Solana engines. Both engines reject threshold
  one. Supporting these modes requires a key/custody design, client compatibility, creation and
  signing tests, and honest single-device risk warnings. The existing personal account is a
  separate single-signer capability, not a drop-in replacement for shared wallet mode. This UI
  does not enable choices the engines cannot create.
  [The concrete single-approval review](single-approval-wallet-review.md) records actual main
  binary refusals and the custody/signing, compatibility and recovery decisions needed first.
- **Eight-digit comparison:** the user chose preparation for security review. See
  [the concrete proposal](eight-digit-safety-review.md). The full thirty-digit check is retained.
- **Mnemonic-only shared-wallet recovery:** no seed-phrase recovery exists for these share files.
  A file passphrase is not a recovery seed. A new design must cover each independent share, wallet
  context and identity/room keys, separate Zcash/Solana secrets, encryption and restore compatibility.
  It must not imply one phrase restores a threshold wallet without enough independent shares.

## Consumer-wallet PRD discovery

The supplied *World-Class Consumer Wallet UX/UI Redesign* PRD, version 1.0 of 18 October 2026,
is a discovery specification based on a recording, not evidence of current defects or implemented
capabilities. The user approved a UI-first iteration and separate engineering review. The
[implementation inventory](prd-implementation-inventory.md) maps its requirement clusters to
main and the current web branch. None of the proposals below is approved for implementation by
being listed here.

The governing decisions remain: backups and read-only file checks are optional; new signer
setup recommends passkey protection with the subsequently approved explicit Skip confirmation;
existing access, exports and restore remain available; all thirty safety digits remain mandatory; single-approval modes remain
deferred. Dedicated Approvals and Security & Recovery destinations are presentation work over
existing capabilities. Native implementation and planning remain excluded.

| PRD requirements | Existing facts and limits | Separate decision or engineering review |
| --- | --- | --- |
| `ZIG-LNG-01..05`, `ZIG-ONB-02`, `ZIG-WIZ-05..08`, `ZIG-SEC-02` | Device labels, signed seat records and cryptographic address checks do not establish a person's identity, physical independence, organizer role or verified contact. | Define person/device relationships, roles, viewing rights and trustworthy attestations before introducing those entities or claims. Copy templates can improve without granting new authority. |
| `ZIG-RDY-01..07`, `ZIG-WIZ-04`, `ZIG-HOM-05` | The branch derives presentation progress from existing verified formation facts. Saved files, local checks and signed peer reports are separate facts; none authorizes spending. | The illustrative recovery-gated readiness evaluator is not adopted. Keep optional recovery with factual status. Any future change to funding or spending eligibility needs explicit policy approval, trustworthy evidence and emergency-access review. |
| `ZIG-SET-01..09`, `ZIG-WIZ-03`, `ZIG-IA-05` | Existing ceremony material and tutorial checkpoints persist. The pre-creation plan's Save and exit keeps it in the open tab; it is not a durable cross-device setup-session service. | New durable drafts, session identities, expiry, conflict resolution and restart semantics require persistence and protocol review. Do not reuse commitments or nonces to make a resume animation work. |
| `ZIG-INV-01..09`, `ZIG-WIZ-02/08`, `ZIG-COL-03` | Current private links carry reusable wallet or chat capabilities. Seat leases and signed joins do not implement organizer-controlled, expiring, revocable one-time invitations. | Define issuance authority, atomic consumption, trusted expiry, replay protection, rotation and compromise handling. Revocation cannot erase a secret already learned; new UI controls cannot enforce these guarantees alone. |
| `ZIG-AUTH-03`, `ZIG-APR-10`, `ZIG-ADV-03`, `ZIG-REC-04` | The existing vault protects local data and unlocks the browser. The separately approved required-passkey change applies to new signer UI entry, not every payment, export or recovery import. | Fresh authentication at sensitive operations needs a bounded consent/session policy tied to unchanged transaction or export context, cancellation behavior and an emergency recovery path. Do not silently restrict existing users' surviving signing or export access. |
| `ZIG-AUD-04`, `ZIG-REC-01..02/08..11` | Main explicitly warns that pre-16-October share-file formats no longer open. Current ZEC, SOL and personal-account files have distinct formats and restore rules. The full historical blast radius is not established by that warning or the recording. | Investigate historical fixtures first. Backward readers, reversible migration, a new envelope, mnemonic recovery or service-independent reconstruction need separate format, custody and compatibility work. Do not hide existing compatibility guidance or promise unsupported recovery. |
| `ZIG-REC-05..07`, `ZIG-SEC-01..04` | A saved download is not proof of separate safe storage. Optional local checks validate a particular file against the current share; remote checks remain signed reports. | Stronger remote recoverability proofs, authoritative freshness/last-tested dates and periodic reminders need an evidence, storage and privacy design. Do not manufacture timestamps or treat reported progress as verified independent recovery capacity. |
| `ZIG-MIG-01..11`, `ZIG-THR-05`, `ZIG-ADV-05` | Change devices creates a new wallet/address and uses the old wallet's approvals to move ZEC. SOL does not move through that process; excluded devices retain their old SOL shares and authority. | Incident-specific capacity assessment, multi-chain transfers, restart/idempotency, final reconciliation and archival need a separate workflow design. In-place signer refresh/revocation and an all-assets-complete claim are unsupported. |
| `ZIG-SND-05..10`, `ZIG-APR-02/05/09..13`, `ZIG-SIG-01..05` | Existing transaction verification, signature rounds, nonce protection, cancellation and broadcast uncertainty remain authoritative. A human approval is not automatically a final group signature or confirmation. | New persistent authorizations, shared decline, changed signing sessions, offline/hardware transport and background delivery require protocol/backend review. Preserve each chain's actual lifecycle and refusal behavior. |
| `ZIG-SOL-01..07`, `ZIG-SND-03/08`, `ZIG-HOM-03..05` | Wallet holdings, device fee funds, refundable deposits and protocol costs have different meanings and eligibility conditions. Unknown USD values and percentages remain unknown. | New quotes, aggregation, fee funding automation, price integration or privacy classifiers require data/calculation review. Presentation can regroup existing values without inventing totals or changing costs. Existing Swap/USDC/ZEC transparent-flow deferrals above still apply. |
| `ZIG-LNG-02`, `ZIG-HLP-04`, `ZIG-ADV-07`, `ZIG-SEC-04`, `ZIG-APR-13` | Existing strings, errors, local redacted diagnostics and in-app updates can be presented more clearly. Saved recipients and chat contacts have different scopes. | A new i18n architecture, durable error/event schema, delivery channel, notification preference store or shared identity system is separate work. Do not imply a notification or security check was delivered/performed when it was not. |

Technical field classification (`ZIG-ADV-01..04`) also needs exact-field review: public program
addresses, viewing capabilities and spending/recovery material are not interchangeable. Moving
existing safe fields into technical disclosures is UI work; introducing sensitive reveal/export
or authentication behavior is not automatically authorized by a layout requirement.

The PRD references `ZIG-A11Y-*`, `ZIG-MOB-*` and `ZIG-UI-06` without defining their individual
requirements. Its provided text ends after section 15/J4. Do not invent acceptance criteria or
mark these references complete. Existing web accessibility requirements still apply; native
requirements are outside this branch. New validation results belong in the iteration's evidence
only after the checks actually run.

## Application-wide visual v3 dependencies

The v3 visual brief does not authorize new capability or interaction architecture. Its approved
safe interpretation preserves the existing optional passkey policy and all earlier technical
deferrals. Main remains the technical reference.

| Proposal | Existing dependency | Safe implementation in this pass | Status |
| --- | --- | --- | --- |
| Custom glass desktop wallet switcher | The existing control is a native select. A custom popup needs new keyboard, selection, focus, positioning and dismissal behavior. | Preserve the native picker and refine its frame; use the existing floating phone-browser navigation for selective glass. | Deferred; separate interaction review required. |
| Complete privacy allocation bars | Main has no complete same-scope shielded/unshielded balance pairs. Fee funds are not wallet holdings. | Show a concise unknown explanation instead of an empty track. | Data/calculation work remains deferred. |
| Live dollar portfolio total | No pricing integration or valuation policy exists. | Show a concise visible USD-unavailable state and preserve exact native balances. | Pricing work remains deferred. |
| Offline signing / working Swap / USDC suggested by seed screens | Those capabilities are not supplied by current implemented entry points. | Style actual unavailable states; do not create an execution engine or protocol. | Not implemented; no visual build of nonexistent flows. |

Safari UI review is a validation limitation, not an engineering change: Computer Use permission
was unavailable. Isolated Playwright WebKit checks are identified as engine checks rather than
Safari application certification.


## PRD 06 — Completion seal boundaries

Reviewed against fetched `origin/main` at `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.
The existing ZEC drawer derives its headline from verified local checks and synced block
inclusion. The visual pass changes that headline's presentation and exposes its selected rule
as display metadata only. It does not change precedence, transaction state or authorization.

A new confirmation/finality policy, event journal, persistent celebration/replay store, or
cross-chain completion abstraction needs separate engineering review. None was implemented.
Block inclusion stays explicitly “Transaction in a block”; submitted records keep their
existing sync and uncertainty explanations. Static seals need no event-identity persistence.
Credential/join, recovery/lock and separate Solana completion surfaces remain outside this
focused slice until their existing evidence and warning contracts receive presentation review.

## Transaction receipt data gaps (PRD 09)

Historical Solana proposal cards do not retain the decoded approval review used for amount,
recipient and fee rows. Reconstructing those fields or adding stronger finality tracking needs
separate engineering approval. Keep existing execution outcomes, slots, signatures and explorer
privacy disclosures; do not infer confirmation from a sent mark or substitute proposal display
fields for verified review data. No receipt persistence, indexer, PDF or share service is added.


## Premium Approvals data boundaries — 23 October 2026

The `codex/approvals` presentation pass uses the existing inbox buckets, checked approval
records, signing stages and chain-inclusion evidence. It adds no transaction actions or state.
Fetched main reference: `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.

- A joined device is not an online device or an approved participant. Real-time availability,
  device-level rejection and durable per-device approval history need new verified data;
  no presence indicators or synthetic approval history were implemented.
- The inbox lacks a verified approval snapshot for every request. It shows proposal summaries
  and retains the existing full review for checked counts. An empty approval map is ambiguous
  before its first snapshot; presentation now uses count unavailable. A trustworthy explicit
  zero needs a separately reviewed snapshot-readiness signal, without relaxing authorisation.
- Solana's inbox adapter exposes id/title/proposer rather than structured amount, fee,
  recipient and per-device progress. Matching cards open its existing review. A unified
  cross-chain review needs a separately reviewed presentation adapter and evidence contract.
- Approval commitments, valid signing shares, aggregation, submission and synced block
  inclusion remain distinct. No new confirmation/finality definition or timed success is added.

See [implementation and browser evidence](approvals-experience.md). These are deferred data
capabilities, not implied authorisation to change signing, persistence, networking or APIs.

# Activity redesign dependencies · 23 October 2026

UI implementation and evidence: [Activity redesign](activity-redesign.md).
Reference: fetched main `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.

- Received ZEC currently opens the existing network explorer. An internal received-payment
  receipt would require an additional detail interaction/route and a reviewed contract for
  what local history can actually expose. The existing explorer path and disclosure remain.
- Received ZEC has block heights and estimated sorting times, while proposals have creation
  timestamps. Reliable calendar grouping needs trustworthy timestamps and explicit proposal
  versus settlement semantics; no settlement dates are inferred from sorting estimates.
- Solana omits transfers sent by other people, retains the last local Add SOL only until
  wallet exit/reload, and can omit older/not-yet-checked proposals. Complete durable history
  requires indexing/persistence work. The precise current limitations remain in the UI.
- Solana activity projections do not expose verified privacy, full recipients or decoded
  fees for every historical operation. A uniform historical receipt and richer privacy cues
  require a reviewed data contract; current details and unknown cues remain authoritative.
- New direction/status/date filters and a different list-loading architecture need separate
  behavior work. This presentation pass preserves the current network predicates and list.

None of these dependencies is implemented or implicitly authorized by the design request.

## Premium Overview presentation boundary — 23 October 2026

The approved Overview redesign supersedes the older primary unavailable-USD label: unknown
valuation displays `$0.00` with a quiet Placeholder indicator and an accessible explanation.
This checkout exposes no valuation source. Its production renderer therefore passes unknown;
finite-number formatting is verified with isolated presentation inputs only. No price feed,
portfolio calculation, state field, API or stored value was added. A future live valuation
connection needs a trusted source and separate engineering approval.

Shared control reads existing device membership and the wallet rule. Invitation delivery and
online presence are not tracked, so unjoined slots say Not joined and no connected state is
invented. The shared metallic identity uses accepted public address/network metadata and a
neutral fallback when absent, without new metadata persistence or network access. Detailed
implementation and evidence are in [Premium Wallet Overview](premium-overview.md).

## Security & Recovery presentation boundaries — 23 October 2026

`codex/security-page` uses fetched main `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`
as the technical reference. Main already supports separate chain exports, guarded restore,
threshold-based signing and replacement-wallet migration. The UX/UI branch additionally has
optional guided records, current-share-bound read-only file checks and signed progress reports;
this redesign reuses them without changing their protocol or persistence.

- A logical signer is not evidence of a separate physical device. Known shares held in one
  browser remain a concentration risk even after every file is checked.
- Exported/restored copies, locally checked files and another signer's reported progress remain
  distinct. A report cannot establish that this browser checked a remote recovery file.
- A known chain-file scope is required before displaying a wallet-wide denominator. Loading,
  stopped setup, missing local material and unavailable reports remain separate conditions.
- In-place signer rotation, a unified cross-chain recovery format, continued file accessibility,
  proof of independent storage and remote-file verification require separate engineering review.
  None is implemented or promised by this page.

See [initial audit, functionality mapping and validation](security-dashboard.md).

## Swap preview — 23 October 2026

The supplied Swap NEAR Intents PRD explicitly requests a frontend-only interactive demo,
superseding the earlier unavailable-page presentation. The new module uses a deterministic,
memory-only mock provider. It cannot sign, deposit, broadcast, query live quotes or track a
transaction. The unimplemented live adapter is not loaded by the page; all of its methods fail
with `NotImplemented`. No wallet balances, real addresses or transaction records are fabricated.

Authoritative main reviewed: `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b` (fetched 23 October 2026).
That baseline supplies no live Swap flow. This UI branch's preview adds no technical capability
to main. Existing wallet integrations, authorization and cryptography remain unchanged.

Live integration requires separate approval and review of provider token IDs and network
compatibility, signed/dry/committed quote handling, source-wallet multisig proposals, validated
recipient and refund addresses, deposit transfer, polling/persistence, fees, refunds and failure
handling. Current Zcash Testnet/Solana Devnet must never silently fall back to mainnet.

The [current provider chain documentation](https://docs.near-intents.org/resources/chain-support)
lists transparent-only Zcash addresses. Direct Ironwood routing is unverified and the preview
states this beside ZEC routes and in review. A bridge, unshielding flow or alternative routing
would require a separate privacy and engineering design; none is implemented.

## Settings presentation boundaries — 23 October 2026

Technical reference: fetched main `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.
Implementation inventory and evidence: [Settings redesign](settings-redesign.md).

- The separate personal account has its own signing authority, funds, backup and recovery.
  Messaging now adds guided account creation, backup and funding using these same handlers.
  The existing account card remains available behind the compact Settings disclosure.
- Replay currently resets separate tutorial progress and opens the existing guide, including
  optional backup checks. It is not a new read-only tutorial. No setup, keys or membership
  are restarted by the Settings action. A dedicated read-only mode needs separate review.
- Descriptions remain explicit local notes outside the vault and recovery files. There is
  no existing navigation-wide unsaved-draft guard. The inline editor supports Cancel and
  retains a failed save in the current page; cross-navigation draft protection is deferred.
- Notification preference persistence still uses the existing best-effort local write.
  Granted permission is not proof that an OS will display a notification. No new delivery
  guarantees, service worker, push system or permission override are introduced.
- Memo opt-in, fetching, snapshot caching and disabling are unchanged. Consent is disclosed
  inline each time retrieval is enabled, without adding a persistent consent record. The
  existing preference writer's storage semantics are preserved. Removing cached memos or
  changing the network privacy properties needs a separately approved technical change.

## Messaging redesign

The messaging presentation retains the existing relay rooms, direct chats and separate personal
on-chain account. A new request/accept protocol, identity safety codes, PQ sessions, mempool
receiving, authenticated receipts, durable offline queues and changed backup semantics remain
separate architecture/security work. UI cost review uses the existing message planner and send
handler; it does not change account signing or authorize a shared-wallet payment.

See [messaging implementation and deferred requirements](messaging-redesign.md).

## Final-pass validation gates — 23 October 2026

Technical reference: fetched main `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.
See the [final-pass audit](finalpass-audit.md) for current browser evidence and attribution.

- The longer `unified-setup` suite fails at `messages: no duplicate Overview heading`
  (expected 1, actual 0), identically in the saved starting working tree and the final tree.
  Reconcile its heading expectation with the current Messages presentation. Preserve its
  pre-existing edits; do not change product behavior merely to satisfy a stale assertion.
- The independent strict-lint pass retains the same 30 normalized baseline findings.
  The full lint script also encounters an unqualified `MutationObserver` in concurrently
  edited post-quantum demo code. Coordinate those files with their owner; none of those
  concurrent changes is included in the final-pass polish patch.
- Browser-rendered transaction outcomes remain synthetic. Funded execution/finality, live
  Solana/prover failures, physical Safari/phones and real passkey providers still need separate
  release validation. Their appearance in a fixture does not establish technical support.
- No new wallet capability is proposed by this audit. Live swaps, pricing, altered recovery
  formats or changes to signing/protection gates remain outside this UI-only authorization.

Publication check on newer UX/UI commit `bdd7403`: the application suite also fails at
`the review of a closed Send does not open` (`web/test/app.mjs:1858`). The untouched target
reproduces the same failure with Node 24. This is a separate baseline gate from the original
final-pass working-tree results; review the Send lifecycle independently of this UI polish.

## Final-pass follow-up resolution — 23 October 2026

The previous final-pass lint, application-suite and unified-setup gates are now resolved locally on `codex/finalpass`; see the [follow-up report](finalpass-followup.md). The Send failure came from a phantom privacy panel in the test document, not an asynchronous payment-lifecycle change. Setup expectations now follow the current Messages and Settings presentation. Full lint, the application suite and the longer setup suite pass. A fresh combined-tree UI matrix and separate Chrome/WebKit privacy checks also pass after correcting the responsive header. No wallet engine, API, persistence, authentication or cryptographic behavior was changed.

Publication on the newer `22d7fa77` base independently passes the fast, application, setup and lint gates, 167 compact-popup checks per browser engine and 52 Settings checks. The complete local matrix was not rerun on that base; pending header implementation remains separate.

Funded/live-service and physical-device validation remains outside these results. The successful UI checks do not establish live Swap/Tor/pricing support or authorize release.

## Native continuation — Mac and iOS · 23 October 2026

The user explicitly authorized `codex/mobile-and-mac` to adapt the web design to Mac and
mobile only. Technical reference: freshly fetched main
`3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`. See the
[native implementation and validation report](native-continuation.md).
The original web branch and its native exclusion remain intact.

- Native main has Zcash, not Solana, shielded USDC, live swaps or pricing. Native pages keep
  these capabilities unavailable; browser demo/provider surfaces are not native execution.
- Native support for web local notes, notification settings, signed remote backup progress
  and non-mutating rechecking of stored backup files needs separate persistence, permission
  and security review. A saved export remains distinct from a later successful file check.
- iPhone uses its existing optional Face ID/passcode vault. Browser passkeys do not protect
  the native app; the current ad-hoc signed Mac build does not offer that access-control lock.
- The already approved native recipient book and its Vault integration are reused exactly
  from the preserved native backup. Scope checks and 45 isolated recipient/Vault checks pass.
  No other model, key ceremony, signing, transport or recovery behavior is imported from it.
- The existing local native core links and passes native/web interoperability checks, but
  its prebuilt C objects warn about a newer deployment target and embed legacy home paths.
  The validation app binary was removed. Rebuild with the supported toolchain and path
  remapping before packaging. No release-ready Mac binary or iOS/Xcode build is claimed.

New technical capabilities, Android support, protocol changes, a different approval rule,
authentication changes and release engineering are not implicitly authorized by this UI port.


## Authorized native publication into UX/UI — 23 October 2026

The user explicitly requested publishing the completed native adaptation to
`codex/ux-ui-final`, superseding its earlier web-only exclusion for that reviewed snapshot.
The integration preserves web parent `3a56c39d` and its newer funding/naming implementation.
Native application sources/assets match `codex/mobile-and-mac` at `5a44d943`; only the
boundary-check script's web reference changes. The scope hook accepts the exact audited
native tree while blocking unreviewed native changes. The web-only predecessor and the
separate native branch remain preserved. No main-branch merge or deployment is authorized.
See [publication scope and original validation](native-continuation.md).
