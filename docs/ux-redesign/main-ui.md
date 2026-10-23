# Web interface and guided setup

Technical baseline: `main` at `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.
Work stays on `codex/ux-ui-final`. Main is the source for technical behavior.
The original checkout and its uncommitted recovery work are excluded. No merge or deployment
is part of this work. Every `ios/` path matches main. Earlier native work is preserved locally
on `codex/ux-ui-final-with-native`; the older side-branch snapshot is on
`codex/ux-ui-final-before-main`.

## Result

- Sidebar: Overview, Activity, Address book, Swap, Chats and Settings. Overview contains approvals
  and unfinished payment progress; Activity retains existing history. General chats and chat
  contacts stay in Chats. Payment discussions stay inside payment reviews.
- Setup uses one full-screen journey: Plan, Connect, Verify, Prepare and Back up. It recommends
  two of three independent physical devices, including an ordinary reserve device. Advanced
  approval rules remain available. A passkey protects a share; it is not another signer.
- Creator and joining devices retain main's ceremony, consent, full 30-digit acknowledgement,
  Stop/mismatch handling and address checks. Drawings explain these checks without replacing them.
  Existing wallet-data/signing-key/network warnings remain visible before the guided content.
- Zcash prepares first, followed by the existing automatic Solana flow when local consent and
  capability checks allow it. Missing service preserves the Zcash setup and its backup controls.
  Fee funding remains required by paid operations, not initial formation.
- Backups are optional after verified formation. Downloads count as saved progress; reopening is
  an optional read-only check. Saved and checked reports remain distinct, and a partial count does
  not guarantee threshold recovery. Replay and resume do not repeat formation.
- Asset cards provide Deposit and Send under Shielded ZEC and Shielded SOL using existing handlers
  and eligibility. Shielded USDC is labelled Solana Devnet with disabled actions and no invented
  balance. Swap remains explicitly unavailable.
- Graphite surfaces, orange actions, opaque financial content, visible focus and responsive rows
  follow light/dark/system themes. Narrow rows stack, full addresses remain accessible, and long
  exact amounts stay within their own wells.

## Approved technical extensions

The device-private payment-recipient book is available across wallets in one browser profile.
It stores a local label, literal address, asset, network and destination type with a version and
stable ID. It supports main's existing ZEC destinations and Solana Devnet shielded/public
addresses, separately from chat contacts.

CRUD/search reuse existing device storage, passkey sealing and tab lock/write serialization.
Failed writes preserve the previous book; unknown or damaged records are preserved during
migration. Selecting a recipient fills only the existing Send address field. Existing validation,
ZNS entry, amounts, memos, multiple payees, review invalidation and authorization remain in charge.
The book has no synchronization, import/export or backend API. Unchanged recovery files exclude it.

The guided brief additionally authorizes separate tutorial progress, optional signed device
backup-status reports and read-only saved-file verification. Later feedback permits skipping
backups, a browser-private description, consolidated Solana consent and automatic balance sync
from Overview using the existing guarded scheduler. These never authorize ceremony,
signing or spending. Remote signatures authenticate the reporting device; they do not let another
device independently inspect its file. No file contents, names or passphrases enter these records.
See [guided setup implementation](guided-web-setup.md) for schemas, compatibility and failure modes.

## Validation evidence

[Latest feedback and validation](web-feedback.md) record the current iteration.
[Initial guided results](guided-web-regression-validation.json) and the
[initial guided browser report](guided-web-after-validation.json) are historical evidence from
before backups became optional.
The earlier [main comparison](main-ui-validation.json) provides baseline/foundation evidence;
its after images predate the guided journey. Current after views are under `visuals/guided-web`.
The initial guided run passed 47 Node suites and 182 browser checks; current results are in the
feedback report linked above.

- Node 24 covers existing application, automatic Solana formation, payments, approvals, recovery,
  vault, ZNS and recipient behavior, plus new guided-state/report and read-only backup cases.
  Technical assertions remain intact. A ceremony regression caught a hidden warning; the warning
  was restored and that unchanged suite rerun successfully.
- Browser journeys form unfunded wallets in three separate stores and reopen actual encrypted
  downloads. They check wrong passwords and wrong-device files, unchanged shares, save/exit,
  local completion with remote reports pending, and eventual signed report updates.
- Views cover 320, 390, 768 and 1440px, light/dark/system, actual doubled text, reduced motion,
  reduced transparency and forced colors. Checks include dialog/page overflow, amount bounds,
  48px controls, keyboard containment and recipient persistence/isolation/reuse across wallets.
- Existing contrast tests cover 54 text pairs and four field edges per theme: text at least 4.5:1,
  tested field edges at least 3:1. Final palette borders are `#788697` dark and `#6f7d90` light.
- Backup tests include actual engine-encrypted ZEC/SOL roundtrips, wrong passwords, tampering,
  plaintext rejection and full share/context matching. Browser passkey unsupported/cancelled
  states simulate the platform prompt; they do not prove successful hardware authentication.
- Diff audit checks protected engine/backend/cryptographic/payment/authentication primitives and
  recovery formats against main. The explicitly approved storage/UI integrations are described
  above. Original checkout HEAD/status and all 828 snapshotted file hashes remain intact.

Evidence uses synthetic participants, local servers, synthetic chain height/display balances and
blocked non-local browser requests. It does not demonstrate funded transactions, live RPC/prover
availability, physical-device independence or broadcast. Real authenticators, assistive technology
and software keyboards remain untested locally. No Mac/iPhone implementation or testing is included.

## Review gallery

| Main before | Current web after |
| --- | --- |
| ![Main setup](visuals/main-ui/before/02-tutorial-introduction.png) | ![Guided setup](visuals/guided-web/after/02-tutorial-introduction.png) |
| ![Main narrow Overview](visuals/main-ui/before/06-overview-320-light.png) | ![Narrow Overview](visuals/guided-web/after/06-overview-320-light.png) |
| ![Main Send](visuals/main-ui/before/13-send.png) | ![Send with saved recipients](visuals/guided-web/after/13-send.png) |

![Recovery files](visuals/guided-web/after/17-guided-backups.png)

![Own files checked](visuals/guided-web/after/18-guided-local-ready.png)

## Delivery boundaries

New commits use neutral author/committer placeholders, are unsigned and contain no attribution
trailers. Hooks enforce this for outgoing commits. Added text and PNG metadata are checked for
personal data. Git requires identity fields; placeholders and unsigned commits do not conceal
the GitHub account associated with a PR or erase existing upstream history.

The PR targets main for review only. [Deferred engineering](ux-ui-final-technical-review.md)
requires separate approval. Never merge or deploy in this chat.
