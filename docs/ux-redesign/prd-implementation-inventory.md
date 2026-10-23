# Consumer-wallet PRD implementation inventory

Source: *Zigs — World-Class Consumer Wallet UX/UI Redesign*, version 1.0, 18 October 2026.
The supplied 1,492-line specification ends after section 15/J4. Its recording observations and
illustrative interfaces are discovery inputs, not proof of present defects or capabilities.

Technical reference: main `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`. Branch source-inspection
baseline: `2a8b173928c2f9bc3fc4dd4a852e1bf83a15e2a5`, before this UI iteration. Main remains
authoritative for protocol, custody, transaction and recovery behavior. Previously approved
branch additions are identified separately below.

## Governing decisions

- Web interface only, including responsive phone-browser layouts. No native implementation or
  native planning. No merge or deployment.
- UI-first delivery preserves existing technical systems. Listing a requirement or proposal
  here grants no engineering approval.
- Recovery downloads and optional read-only file checks stay optional. Show saved, checked,
  missing and reported progress separately. One file is partial progress, not 2-of-3 recovery.
- Required passkey protection for new signer UI entry is retained. Existing-wallet access,
  payments, backup exports and recovery imports keep their existing behavior.
- Keep the full thirty-digit comparison and its acknowledgements. Single-approval wallets,
  shortened safety comparison and mnemonic-only share recovery remain separate reviews.
- Approved navigation: Overview, dedicated Approvals, Activity, Address book, unavailable Swap,
  Chats, dedicated Security & Recovery, and Settings; retain existing Help access. Payment
  discussions stay inside reviews; general Chats stay separate from holdings.
- USD valuation, shielding percentages and unavailable assets/actions must not acquire invented
  data or working behavior. Keep exact balances, network, cost, privacy and freshness context.

## Existing capability map

Code paths identify implementation areas, not named individual owners. These are inspected
capabilities, not claims that every PRD acceptance criterion or platform behavior has passed.

| Capability | Main reference | Previously approved branch addition or current UI scope |
| --- | --- | --- |
| Wallet setup and verification | `web/app-dkg.js`, `web/app-seats.js`, `web/signed.js`; signed device records, thirty-digit comparison, persisted ceremony material and local address checks. | `web/app-setup.js`, `web/app-tutorial.js`, `web/guided-setup-model.js`, `web/app-guided-setup.js`: diagrams, separate tutorial checkpoints and derived presentation facts. No new protocol authority. |
| Local passkey storage | `web/vault.js`, `web/app-keystore.js`, `web/app-account.js`: WebAuthn/PRF and local encrypted vault. | Required new-signer UI entry and confirmed activation completion in `web/app-shell.js`/`web/app-setup.js`; preserve recovery/legacy access. See [scope and limits](passkey-first-setup.md). |
| Recovery | `web/app-backups.js`, `web/sol/backup.js`, `web/personal.js`: separate file types, passphrases, binding/clash checks and existing restore rules. | `web/backup-check.js` and guided setup: optional read-only encrypted-file checks; local checked status bound to the current share; optional signed peer reports remain informational. |
| Payment recipients | Main Send forms validate destinations; general payment-recipient persistence is not a main capability. | `web/recipients.js`, `web/app-recipients.js`, recipient fields in the existing local store: device-private book across wallets, separate from chat contacts and unchanged recovery files. |
| Send, review and approvals | `web/app-send.js`, `web/app-drawer.js`, `web/app-payments.js`, `web/app-filter.js`, `web/sol/`: existing eligibility, parsed transaction checks, signature rounds and lifecycle. | Presentation models and layouts regroup existing facts. Dedicated Approvals navigation is approved for this iteration; no new consent, signature or backend-authentication model. |
| Overview and history | `web/app-chain.js`, existing wallet and SOL balance/history observations. | `web/app-wallet.js`, `web/overview-model.js`, `web/approvals-model.js`: portfolio presentation, unknown USD/ratios, Pending/Recent summaries and complete existing Activity access. |
| Chats and personal account | `web/app-messages.js`, `web/app-thread.js`, `web/app-account.js`, `web/chat.js`, `web/personal.js`: existing chat and separate single-signer messaging account. | General Chats are visually separate; payment discussions remain in review. This does not create person roles, identity verification or threshold-one portfolio mode. |
| Device replacement | Existing Change devices path makes a replacement wallet/address and an approved ZEC transfer. | Clarify consequences and reuse the same controls. SOL stays with the old wallet and its existing signers; no all-asset replacement or in-place revocation is implied. |
| Appearance, help and diagnostics | Existing DOM/CSS presentation and scoped wallet/account behavior. | `web/app.css`, `web/theme.js`, `web/app-theme.js`, `web/app-help.js`, `web/help-model.js`: shared presentation, theme preferences and local redacted diagnostics. New delivery channels or schemas are deferred. |

## Traceable requirement disposition

**Supported** means the narrower behavior described exists in the inspected code. **Partial**
means the cluster mixes existing behavior, approved UI work and proposals. **Deferred** means
the requirement needs separate engineering or security approval. These are scope classifications,
not release sign-off. Ranges include every numbered requirement in that cluster.

| PRD requirements | Disposition | Existing basis, UI work and boundary |
| --- | --- | --- |
| `ZIG-AUD-01..06` | Partial | This inventory maps source capabilities and gaps. Historical recovery, threat-model and release investigations remain distinct work; recording evidence is not a reproduced defect. New iteration validation is pending evidence. |
| `ZIG-LNG-01..05` | Partial | Standardize visible language and actual lifecycle labels. Existing device/address checks do not prove a person's identity, physical independence or safe backup storage. New person/role entities and centrally versioned i18n architecture are deferred. |
| `ZIG-IA-01..06` | Partial | Implement the approved dedicated destinations over existing views. Keep Address book, unavailable Swap and Chats despite their absence from the sample PRD navigation. Responsive web navigation is in scope; a new durable draft or routing architecture is not. |
| `ZIG-RDY-01..07` | Partial | Existing pure presentation evaluators use verified formation facts. Keep formation, local protection and recovery progress distinct. Do not adopt the illustrative recovery-gated funding predicate or make peer backup reports authorizing. |
| `ZIG-SET-01..09` | Partial | Preserve existing persisted ceremony material, tutorial resume and clear waiting/error states. Pre-creation Save and exit is open-tab continuity. New cross-device draft/session storage, invitation expiry and restart policy are deferred. |
| `ZIG-ONB-01..02` | Partial | Create/Join/Recover and setup education exist; refine hierarchy and copy. Personal/shared wording templates must not imply implemented member roles, viewer permissions or verified people. |
| `ZIG-THR-01..05` | Partial | Existing 2-of-3 default, custom supported range, loss consequences and full-threshold acknowledgement remain. Actual engines reject 1-of-1 and 1-of-2; new custody modes and live threshold modification are deferred. |
| `ZIG-AUTH-01..04` | Partial | Existing vault plus approved required new-signer setup distinguishes passkey, signer and recovery; failed completion blocks new setup. No claim of permanently device-bound credentials. Fresh auth for every approval/export/security action is deferred. |
| `ZIG-WIZ-01..08` | Partial | Improve the current guided web journey and factual handoff/status presentation. Optional recovery supersedes mandatory W10/W11 completion. Managed person-targeted invites, organizer control, recovery-capacity proofs and new session services are deferred. |
| `ZIG-INV-01..09` | Deferred | Current private links and signed seat joins are supported, not the proposed invitation object/lifecycle. Expiry, atomic one-time redemption, revocation and organizer authority need backend/protocol work. Retain truthful capability and exposure warnings. |
| `ZIG-VRF-01..04` | Partial | Retain actual thirty-digit comparison, mismatch/stop controls and locally verified address evidence. Short safety words, new peer identity attestations and last-verified/online timestamps cannot be invented by presentation. |
| `ZIG-DKG-01..05` | Partial | Existing ceremony, signed parsing, encrypted transport and address verification remain authoritative. Improve human-stage copy and error placement; no fake percent or new replay/restart mechanism. This inventory does not certify a cryptographic audit. |
| `ZIG-REC-01..05` | Partial | Preserve real file/passphrase meanings, separate chain/account files and saved-versus-checked status. New formats, historical readers, mandatory fresh authentication and stronger remote/storage evidence are deferred. |
| `ZIG-REC-06..11` | Partial | Optional local non-destructive file checking is supported in the branch; it neither restores nor proves independent external storage. Keep existing recovery escape paths. Historical compatibility, independent reconstruction and reminder services need separate review. |
| `ZIG-SEC-01..05` | Partial | Dedicated Security & Recovery reuses existing device, loss-margin and local backup facts. Improve lost-versus-compromised guidance without an overall health guarantee. New capacity proofs, people metadata and notifications are deferred. |
| `ZIG-HOM-01..08` | Partial | Refine Overview hierarchy and known/unknown/stale financial states. Preserve actionable approval summaries and exact amounts. No fiat feed, invented privacy ratio or recovery-based Receive block is authorized. |
| `ZIG-RCV-01..07` | Partial | Reuse guarded ZEC Receive and the full verified SOL shielded destination with compatible-wallet disclosures. Preserve copy/QR/network behavior. New request formats, scanners, address types or deposit support require separate approval. |
| `ZIG-SND-01..10` | Partial | Regroup existing recipient, amount, memo, fee/privacy and lifecycle facts without changing handlers or calculations. Saved recipients are not verified identities. New risk detection, fee logic, consent or cancellation capabilities are deferred. |
| `ZIG-SOL-01..07` | Partial | Improve wording and hierarchy while preserving exact costs, refundable/retained deposits, public fee-account funding, proof-service disclosures and eligibility. New cost aggregation, quote freshness rules or funding automation are deferred. |
| `ZIG-PRV-01..07` | Partial | Explain actual chain/operation exposure and shared viewing access. Preserve unknown privacy states and public-versus-shielded distinctions. No universal private-wallet, unlinkability or intra-group privacy promise. New classifiers are deferred. |
| `ZIG-APR-01..13` | Partial | Dedicated Approvals reuses current action buckets, counts, review and verification. Keep chat unread counts separate and scope peer/status claims. New shared decline, persistent authorization, person authentication and notification delivery are deferred. |
| `ZIG-SIG-01..05` | Partial | Translate existing rounds and verifiable payment stages without equating a click with a final signature or broadcast with confirmation. Preserve uncertainty and nonce safeguards. Offline/hardware transport and revised signing sessions are deferred. |
| `ZIG-ACT-01..04` | Partial | Existing history remains distinct from the approvals work queue, with partial/sync/privacy context. New security-event persistence or audit schemas are deferred; do not fabricate historical events. |
| `ZIG-MIG-01..11` | Partial | Current new-wallet/address and old-policy ZEC transfer are supported. Improve consequence/help copy. Independent-capacity assessment, automatic multi-asset reconciliation, in-place refresh and archival semantics are separate engineering. |
| `ZIG-HLP-01..06` | Partial | Reuse contextual help and local redacted diagnostics; clarify safe next actions and data-preservation advice. New structured error schemas or support transport are deferred. Never include secret examples or promise unknown broadcast outcomes. |
| `ZIG-COL-01..07` | Partial | Keep general Chats separate, discussions in reviews and messaging distinct from payment approval. Scope local leave effects accurately. Managed contact invitations, new roles and new identity authority are deferred. |
| `ZIG-ADV-01..08` | Partial | Regroup existing technical fields and settings with exact sensitivity/scope labels. A public program address, viewing capability and recovery secret are different. New sensitive reveal/export authentication, preference persistence or authority is deferred. |
| `ZIG-WRN-01..03` | Partial | Apply semantic warning hierarchy, text/icon cues and decision-local disclosures. Preserve required beta/network/privacy/cost warnings; cosmetic deduplication cannot remove a material disclosure. |
| `ZIG-ASY-01..05` | Partial | Present existing loading, waiting, interruption, error, unknown and terminal facts with context. No fake progress, invented background delivery or retry that alters existing idempotency rules. |
| `ZIG-DS-01..09` | Partial | Extend existing tokens, opaque financial surfaces, restrained navigation/sheets, typography and responsive controls. Preserve dark/light/system, keyboard focus, 48px web targets and motion/transparency/forced-color preferences. New framework architecture is deferred. |
| `ZIG-MTN-01..04` | Partial | Use modest presentation feedback and existing reduced-motion behavior. Do not animate security assertions ahead of evidence. New performance or physical-device validation remains unclaimed until measured. |

## Undefined references and acceptance limits

The supplied PRD references `ZIG-UI-06` in F-04 and `ZIG-A11Y-*` / `ZIG-MOB-*` in F-20, but
provides no corresponding numbered definitions. They are specification gaps, not completed
requirements. The WCAG 2.2 AA target, keyboard/screen-reader intent and visual acceptance prose
are present elsewhere; they do not supply a full missing test matrix or establish conformance.

Responsive web and browser accessibility stay in scope. The branch's 48px web target takes
precedence over the illustrative 44px touch target. Native applications, native assistive
technology and native platform delivery remain outside this branch, including in planning.
Long text, contrast, focus, keyboard, forced colors, reduced motion/transparency and financial
overflow require actual rendered review; browser emulation is not physical-device evidence.

Do not claim that a label proves identity, a passkey adds a signer, a saved file was externally
stored, a peer report independently verifies a file, an approval is a final signature, an empty
list proves complete history, or a ZEC move migrates SOL. Do not label an address-book entry a
verified contact without a supported verification source.

Current backup-format warnings support investigation of historical compatibility, not a claim
that every historical file is unrecoverable. Keep source files and fixtures intact; format or
restore changes are not authorized by the UI kickoff.

## Delivery boundary and evidence

Implement presentation over existing capabilities first. Record technical dependencies in the
[separate review](ux-ui-final-technical-review.md); roadmap entries require explicit approval
and their own protocol/security design before implementation. Existing reviews cover
[single-approval modes](single-approval-wallet-review.md) and a
[shortened safety comparison](eight-digit-safety-review.md); neither enables a control.

This inventory records source inspection and approved scope only. It records no new test,
screenshot, accessibility, transaction, device or release-validation result for this iteration.
Attach that evidence only after the corresponding work and checks actually complete.
