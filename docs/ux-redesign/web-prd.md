# Consumer wallet PRD: web UI delivery

The supplied 18 October 2026 PRD is reconciled with main
`3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`, refreshed before implementation.
The [requirement inventory](prd-implementation-inventory.md) distinguishes existing main
capabilities, previously approved additions and deferred engineering. Recorded observations
are not treated as reproduced defects. The user approved UI-first implementation, dedicated
Approvals and Security & Recovery destinations, and optional recovery downloads/checks.

## Presentation changes

- The sidebar exposes Overview, Approvals, Activity, Address book, unavailable Swap, Chats,
  Security & Recovery, and Settings. Existing internal section identifiers, menu dismissal and
  focus conventions are reused. Chats still requires a selected wallet.
- Overview keeps portfolio actions and exact asset balances, adds a compact queue summary and
  up to three existing actionable payment rows, and links to the full unchanged approval
  buckets. Pending/Recent and complete Activity remain available.
- Security & Recovery groups existing device checks, approval rules, replacement disclosures,
  recovery files and access guidance. Settings links there instead of repeating whole panels.
  Empty and unfinished-wallet views describe their actual state and link back to setup.
- ZEC review places existing refusal, expiry, recipient mismatch and lost-approval warnings
  before wallet context and the proposed/decoded amount. Recipients, memos and exact costs
  precede lifecycle progress and discussion. No new privacy claim accompanies rejected data.
- SOL review places refusal/expiry/execute warnings first. Checked amounts and payment terms
  precede lifecycle progress; program/proposal account details are collapsed. Network fees,
  rent/refund conditions, expiry, partial-recipient verification limits and public/prover
  disclosures stay outside that disclosure. Recipient inputs reference their privacy helper.
- Opaque amount surfaces, shared spacing, wrapping and financial typography use existing
  materials and tokens. Setup uses actual stages/device counts instead of a synthetic percent.
- Completion says the wallet is **prepared**. Saving a file, optionally checking it and receiving
  another device's signed report remain different observations; none proves independent
  recoverability. Tutorial/connection copy explicitly keeps recovery files optional.

## Sensitive-field presentation audit

This is a source-based display inventory, not approval for a new reveal/export security policy.
No classification below authorizes copying or changes an existing guard or handler.

| Field | Meaning and treatment |
| --- | --- |
| ZEC receive address and full SOL shielded destination | Payment destinations; retain full accessible values, correct network and sharing context. A destination can correlate wallet activity; do not claim universal anonymity. |
| Group verification key, program/proposal accounts and fee addresses | Public or correlatable identifiers, not interchangeable payment destinations. Keep technical purpose and public funding/linking disclosures; ordinary Receive must not substitute one of these. |
| ZEC viewing key | Confidential viewing capability for wallet history. Keep its existing explicit viewing disclosure and deliberate Advanced entry. Existing rendering/reveal behavior is unchanged; fresh authentication or stronger concealment needs engineering review. |
| Setup/chat invitation link | Confidential bearer capability, with existing viewing/room and enrollment consequences. Preserve private-link warnings. Do not display expiry/revoke promises unsupported by main. |
| Recovery file and passphrase | Recovery-critical copies of a device's signing share. Existing encrypted export/import rules remain; keep file and passphrase separate. No mnemonic-only option is invented. |
| Safety comparison | All thirty digits and actual-device confirmation remain. Diagrams repeat local information and never verify another physical device. |
| Browser-private wallet description | Local plaintext metadata, outside the passkey vault, shared records and recovery files. Keep the no-secrets disclosure. |
| Diagnostics | Existing redacted local export, with current exclusions and tests. No new telemetry, remote support transmission or universal redaction guarantee. |

Optional file checks stay inside the deliberately opened recovery guide. Adding a direct check
button to an older formed wallet would initialize an unfinished tutorial record through existing
progress behavior; that shortcut was excluded instead of changing persistence in this UI pass.

## Validation and limitations

Before evidence uses an immutable archive of branch commit
`2a8b173928c2f9bc3fc4dd4a852e1bf83a15e2a5`. After evidence uses the changed web sources.
Both use fresh synthetic browser stores and isolated local servers; the user's preview data is
not used. The matrix includes 320, 375, 390, 768, 1024 and 1440px, dark/light/system themes,
actual doubled text, reduced motion/transparency, forced colors and internal overflow checks.

The real browser journey creates an unfunded wallet across separate synthetic browser stores,
performs virtual-authenticator WebAuthn/PRF and optional file-save/check flows, and exercises
existing navigation, dialogs and access. Payment screenshots render the actual blocked ZEC and
expired SOL components as inert synthetic fixtures. They are not evidence of a funded or
accepted payment. Existing Node protocol rigs cover accepted reviews, cost/disclosure retention,
eligibility and signing behavior separately.

Final validation results are recorded in the accompanying `web-prd-*-validation.json` reports.
Screen evidence is in `visuals/web-prd/before/` and `visuals/web-prd/after/`.

| Check | Result |
| --- | --- |
| Existing Node 24 regression suites | 50 passed; accepted-review fee/privacy and signing assertions retained. |
| Registered fast suite | 40 passed in 23 seconds, including temporary localhost stubs. |
| Strict lint | 161 JavaScript and 2 Python files passed. |
| Frozen before browser journey | 641 checks, 179 captures, zero browser errors. |
| Final after browser journey | 830 checks, 179 captures, zero browser errors. |
| Source isolation | Native paths match main; original checkout's HEAD, status and 828 file hashes preserved. |
| Capture metadata | 358 PNG files checked; no identifying text, EXIF or time metadata chunks. |

Rendered inspection sampled desktop Approvals, light 768px Approvals, light 390px Security &
Recovery, and dark 320px blocked payment review at normal and doubled text. The long-amount
sample initially needed internal horizontal scrolling; it now shows all digits with responsive
type and wrapping, covered by a rendered no-horizontal-scroll assertion. All matrix cases
passed automated page/dialog overflow and control-target checks. This is not a claim that all
179 views were independently judged by a human or tested with assistive technology.

| Screen family | Visual acceptance recorded |
| --- | --- |
| Approvals and sidebar | Selected destination, readable hierarchy, retained empty/unknown state and responsive 48px controls passed. |
| Security & Recovery and Settings | Optional recovery language, device/file scope, dedicated links, focus and wrapping passed. |
| ZEC blocked review | Warning precedes context/amount; opaque financial surface and all digits remain readable at 320px/2x text. |
| SOL expired review | Expiry precedes lifecycle; no approval action appears. Accepted cost/privacy terms remain covered by Node renderer checks. |
| Existing setup, portfolio, Activity, Chats and dialogs | Existing browser journey and preferences checks passed; this iteration preserves prior design materials and available actions. |

Browser emulation does not establish physical-device independence, hardware authenticator or
provider-sync support, assistive-technology conformance, software-keyboard behavior or low-end
device performance. No live funded transfer, RPC/prover, native app, merge or deployment is
claimed. Required passkey setup and all earlier approved technical exceptions retain their
existing scope; this iteration adds no schema, payment calculation, authorization or protocol.

New invitation authority, identity roles, recovery formats, funding gates, per-action
authentication, single-approval wallets and other engineering proposals remain
[unimplemented pending review](ux-ui-final-technical-review.md).
