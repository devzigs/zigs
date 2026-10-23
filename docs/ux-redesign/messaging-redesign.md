# Messaging redesign

## Reference and scope

Implemented on `codex/messaging` from `codex/ux-ui-final` at `31e9c20`.
Authoritative technical reference: `origin/main` at
`3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`, checked against the remote main ref.
The supplied Messaging PRD v1.0 was reviewed against `CHAT.md` and the actual web/engine call sites
before implementation. This pass changes the responsive web presentation only.

## Agreed experience

- One Messages destination, with Relay and Zcash tabs. Relay preserves wallet teams and independent
  two-member direct chats. Existing private invitation links still work.
- A two-pane desktop inbox becomes a stacked inbox/conversation below the existing 760px phone
  breakpoint. Search filters local conversation labels and Zcash contact addresses.
- The Zcash tab explains and reuses the separate personal messaging account. New users explicitly
  create it, receive backup guidance and fund it through existing controls. Funding from a shared
  wallet opens its normal Send flow and requires wallet approvals. Later message fees come from
  the personal account and do not require team approvals.
- The first on-chain send per contact in a tab and every change of parts or fee opens a cost review.
  It shows network, source account, full destination, zero recipient value, parts, fee and total debit.
  Later sends at that cost use the explicit send button; Enter never sends on-chain text.
- Review acknowledgements live only in tab memory, scoped to the account lifetime, network,
  contact index/address, parts and fee. Lock clears them; account replacement invalidates them.
  Confirmation recalculates the current draft plan and requires reconfirmation after an edit.
  The review never authorizes a transaction or bypasses existing account and send safeguards.
- Unsent drafts and timeline scroll positions survive conversation changes in bounded tab memory
  (100 views, 200,000 draft characters). Lock clears them; replacing the personal account discards
  its old drafts. Conversation details and QR disclosures do not carry across contacts.
- Concise privacy details identify invite/contact-link holders and relay metadata. Matching device
  signatures establish key continuity, not human identity. Changed-key warnings, multi-seat sender
  selection, payment events and payment-request review remain available.
- Notification settings and payment-request actions are contextual. Existing app-open notification
  support is reused. No background push, delivery/read receipt or automatic resend is introduced.
- A skippable four-page guide explains the transports, separate account and fees, sharing a
  contact-specific reply address and identity limits, and advanced encryption as future work.
  Local vector primitives provide decorative motion, with reduced-motion alternatives.

## Corrections to the supplied PRD

Main already implements the personal account, zero-value memo outputs and UTF-8 multipart messages.
The account is browser-controlled, independent of shared-wallet keys and funds. Its encrypted backup
contains seed and contacts, not sent-message plaintext. Current incoming attribution is the receiving
address allocated to a contact; anyone who knows that address can send there.

The engine handles at most five memo parts and 2,000 characters, splitting only at UTF-8 boundaries.
Presentation reuses its existing planner and fee/part count; no new envelope or fragmentation policy
is added. Other wallets may hide zero-value memo outputs. Synthetic construction/scanning tests do
not establish deployed-provider or external-wallet interoperability.

Receiving is block-based. Broadcast, uncertain send, failure, expiry and chain inclusion retain their
existing meanings; none implies recipient delivery or reading. Relay outages show reconnection
information without promising a durable queue. A send whose acknowledgement was lost may still
arrive, so retry wording preserves that uncertainty. Zcash has its own provider connection.

For future application-specific binary memos, current [ZIP 302](https://zips.z.cash/zip-0302)
prefers `0xFF`; `0xF5` has ambiguous legacy use. This documentation correction does not change
the existing text format. Fee guidance follows the applicable [ZIP 317](https://zips.z.cash/zip-0317)
revision, never a promised fixed recipient transfer.

## Deferred architecture and security work

A new versioned request/accept/session protocol; personal identity safety codes; mempool scanning
and reconciliation; authenticated delivery/read receipts; durable queues and idempotent retry;
persistent mute/block/export/report; changed backup semantics; treasury-funded chat transactions;
and PQ handshakes, ratchets, recovery and multi-device keys all require separate engineering review.
The UI exposes no working controls or successful states for these proposed capabilities.

## Validation

Before/after screenshots and browser validation receipts are in `visuals/messaging-redesign/`.
The final Chromium matrix passes 145 checks with zero browser errors, 34 updated screenshots
and 16 baseline screenshots. Captures cover dark/light desktop, 390px phones and 320px layouts.
Fixtures use synthetic participants and a stub transaction builder: they do not fund accounts or
send network transactions. Focused tests exercise cost review, failure/cancel draft retention,
account replacement, signing warnings, request/funding boundaries, responsive layouts and modal
keyboard operation. Existing messaging/account/request and application regressions are retained.

The complete existing application suite passes, as do all three new focused presentation tests,
the module graph check, presentation/test/harness lint, the build dry-run and whitespace checks.
The final fast suite passes 44 of its 45 executed tests. The unchanged `demo-check` test exceeds
its 60-second limit and also stalled on a separate run; it is recorded as unresolved, not a pass.
The suite skips its QR command-line test because `qrencode` is unavailable. Browser fixtures still
exercise the existing in-app QR presentation.

Responsive desktop-browser checks do not substitute for physical-phone, assistive-technology or
deployed Zcash interoperability testing.
