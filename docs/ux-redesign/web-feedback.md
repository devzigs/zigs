# Web wallet feedback iteration

Baseline: main `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.
This iteration follows the initial guided UI commit `eb34ae7`. No native file is changed.

## Implemented

- A private optional wallet description can be entered during creation and edited in Settings.
  It is a 280-character browser-local presentation note, outside the encrypted vault and existing
  recovery files. It is never sent to other signers. Unknown/damaged records are preserved;
  failed saves do not change keys or prevent automatic chain setup.
- Diagrams put signer devices inside a named wallet and explain the account/address/balance,
  independent share and approval-rule relationship. Overview lists signers inside their wallet.
- Final review visually summarizes device count, approval threshold and networks before creation.
  It explains that formation submits no deployment transaction; later paid operations retain
  their existing fee/review gates.
- Solana is included by default in the final creation confirmation for new testnet wallets.
  Complete privacy/service disclosures stay visible, with an advanced Zcash-only opt-out.
  The existing local intent is saved by the actual final action. Unavailable service preserves
  Zcash progress; a later reload can resume automatically without another consent step.
- Overview starts the existing Solana automatic sync after current-wallet, visibility, session,
  share and agreement checks. It uses the existing event-driven cadence and retry backoff, adds
  no periodic polling and does not open the local-prover selftest gate. Manual retry appears only
  after failure under technical details.
- Backups are optional. No download/reupload/passphrase check is required to finish setup.
  Downloads count as saved progress, independently from optional file verification. One of three
  saved signer files is partial progress; it does not imply a 2-of-3 wallet is fully recoverable.
  Strict v2 signed reports preserve saved versus checked states; v1 reports remain readable.
- Activity and Settings remain in the sidebar. Chats opens the selected wallet's conversation,
  is unavailable without an open wallet, and shows no holdings or funding UI. Existing direct-chat
  data and link handlers are preserved. There is no Actions destination.
- Shielded USDC remains the third asset with a Solana Devnet label and explicit disabled controls.
  Main has no USDC payment support; no balance or functionality is invented.

## Deferred or unsupported

- **Eight digits:** the user requested a separate [security review](eight-digit-safety-review.md).
  Thirty-digit verification and its actual acknowledgement remain unchanged.
- **1-of-1 and 1-of-2 shared wallets:** both current engines reject threshold one. These require
  custody/engine/compatibility engineering, not relaxed form validation. They remain unavailable.
- **Seed phrases:** shared-wallet recovery supports encrypted share files plus passphrases.
  A passphrase alone is not a recovery seed. Mnemonic-only recovery needs separate design.

## Validation

Current machine-readable browser and regression results accompany this file.
The final browser run passes 180 checks with 39 captures and zero uncaught errors. Earlier guided
reports/images are historical evidence before this feedback changed backup completion policy.
Synthetic browser tests cover zero-backup continuation, a single saved file without reupload,
saved-only remote reports, optional wrong-password/device checks, private-description persistence
and signer isolation, wallet-only Chats, visual review and the existing responsive/accessibility
matrix. Node fixtures exercise automatic Solana intent/service recovery and Overview sync guards.

Local checks do not demonstrate funded payments, live RPC/prover availability, successful hardware
passkeys, assistive technology or software-keyboard behavior. The user preview is a separate store
from QA. Nothing is merged or deployed; the original checkout remains untouched.

[Node results](web-feedback-regression-validation.json) ·
[Browser results](web-feedback-after-validation.json)

The final Node set passes all 49 suites. Lint passes for 156 JavaScript and two Python files;
the registered fast subset passes all 39 tests. The initial routine-sync control assertion was
updated for its intentional removal, with stronger failure/busy/stopped retry checks.

## Current views

![Wallet review with Solana included by default](visuals/web-feedback/after/04-review-default-networks.png)

![One saved file is partial progress and reopening remains optional](visuals/web-feedback/after/18-guided-local-ready.png)

![Sidebar and three assets](visuals/web-feedback/after/06-overview-1440-light.png)

![Private wallet description](visuals/web-feedback/after/11-settings.png)
