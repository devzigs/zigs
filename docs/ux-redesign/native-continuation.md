# Mac and mobile UI/UX continuation

23 October 2026 · `codex/mobile-and-mac`

The user requested that the completed web design be adapted to **Mac and mobile only**.
This isolated branch starts at web revision `33645815acfacef4ba5381e512381f6bd6e60c00`.
The technical reference is freshly fetched `origin/main` at
`3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`; the starting native sources match it.
During the initial native pass, the web application and the original checkouts were not edited.

## Publication follow-up

The user subsequently requested publication into `codex/ux-ui-final`. The reviewed native
adaptation is applied on top of web revision `3a56c39de6340216880aa49e68a7d3a87b5712e1`,
retaining its newer funding/naming work. Its web-only predecessor is preserved locally as
`codex/ux-ui-final-web-only-20261023-3a56c39d`. The original implementation remains on
`codex/mobile-and-mac` at `5a44d943`.

The former web-only branch instruction is explicitly superseded for this integration.
The scope hook now admits the audited native tree and rejects unreviewed native changes,
including new native roots. Native application sources/assets match the reviewed adaptation;
only the scope test's web comparison reference is updated to the newer web parent.
No web application source is changed by this publication. Existing build/device limitations
below still apply. Publication is a normal push to the UX/UI review branch, with no force
push, merge into main or deployment.

## Native implementation

| Area | Mac and iPhone/iPad adaptation |
| --- | --- |
| Design system | Graphite/porcelain surfaces, restrained orange actions, readable desktop typography, native Dynamic Type, opaque financial surfaces, 48-point main controls, reduced-motion and reduced-transparency handling. |
| Branding | Byte-identical canonical zebra inside the app. Deterministic icon export retains that artwork for all existing Mac/iOS app-icon slots; the iOS icon is opaque RGB. |
| Navigation | Native split-view sidebar with Overview, Approvals, Activity, Address book, Swap, Chats, Security, Settings and How Zigs works. Sidebar adapts to native compact navigation; saved wallets remain directly accessible. |
| Wallet context | Persistent wallet header with public-address-derived metallic artwork, network, rule and Return to wallets. Payment reviews and direct-chat views preserve selected-wallet context. Artwork is a static native adaptation, not a verification or ownership signal. |
| Entry | Persistent zebra hierarchy, Create/Join/Recover actions and compact saved-wallet rows with exact balances, setup/view-only states and notifications already available from the model. |
| Creation | Four transient form steps: name, signer rule, network, review. Existing 2–7 signer and minimum-two-approval controls, network acknowledgement and creation handler remain. iPhone protection is recommended using the existing optional device-lock action; the Mac limitation is explicit. |
| Formation | Existing invitation, full safety-number comparison, key creation and address checks, with clearer education and progress. Setup errors and mismatches remain visible. Backups never gate an already formed wallet. |
| Overview | Full-width portfolio/actions panel, explicitly labelled unknown-USD placeholder, exact shielded ZEC balance, pending/recent summaries, expandable balance/privacy details and compact unsupported-asset rows. Wide screens use two columns; narrow layouts stack. |
| Approvals and activity | Dedicated request/progress page, honest empty states, readable exact amounts, original review routes and transaction status distinctions. Received transactions retain their explorer link, now with privacy disclosure. No synthetic presence or settlement dates. |
| Payment review | Wallet context, focal amount/fee surface, complete recipients/memos, decoded breakdown, approval/signing/proof/submission steps and payment discussion. Existing inspection, mismatch refusal, approvals, proving and broadcast handlers remain. |
| Security | Rule, joined/address-checked counts, local-seat concentration warning, actual device protection and local file-export counts. Existing signer list, backups, guarded restore, replacement-wallet flow, privacy and viewing-key disclosures remain accessible. Saved files are not described as rechecked. |
| Address book | Reused the previously approved, preserved native implementation: device-private, cross-wallet recipients, search/add/edit/delete, normalized network-specific shielded addresses and Send-form selection. Vault integration and failure/migration handling retain its tested implementation. Recipients stay outside recovery files. |
| Chats | Separate direct-chat workspace with existing trust warnings, drafts and contact invites. The existing wallet conversation is an explicit disclosure. Payment discussion stays inside its review. Contacts do not gain signing or payment authority. |
| Settings and help | System/light/dark choice, existing profile/server/device settings and recovery entry. Ten educational chapters and shared-control diagrams. Tutorial state is transient and never authorizes operations. iOS no longer forces the Dark appearance in generated app configuration. |

The native address-book code is reused from the preserved `codex/ux-ui-final-with-native`
branch. No other historical native technical behavior was imported. `GroupModel` differs from
the reference only by that recipient extension; engine, chain, store, signing, chat protocols,
backup validation and recovery operations remain identical.

## Platform boundaries

- Native main supports Zcash. Solana, shielded USDC and swaps remain explicitly unavailable,
  including visible no-deposit copy. The web's demo Swap/provider surface is not represented
  as native execution. No chain integration, price feed or new transaction capability was added.
- Native mainnet remains available behind its existing acknowledgement and warning level;
  copying web-only network controls would have changed native behavior.
- Browser passkeys are not the native authentication mechanism. iPhone retains the existing
  optional Face ID/passcode vault; the current ad-hoc signed Mac build cannot offer that lock.
- Web local wallet descriptions, notification preferences, signed remote backup reports and
  saved-file rechecking have no equivalent native implementation in main. Their persistence,
  permission and security work needs a separate technical review. No false switches, completed
  states or remote-file verification were introduced.
- Native mobile here means the repository's iOS app (iPhone/iPad). There is no Android project.

## Validation

- Complete production Mac Swift sources typecheck for the macOS 14 deployment target with
  Swift 5, complete concurrency checks and warnings treated as errors.
- **45 recipient/Vault checks pass**, using isolated Keychain and normalization adapters.
  They exercise validation, damaged records, duplicates, atomic save rollback and encrypted
  migration. They do not exercise physical Keychain access or biometrics.
- **27 source boundary checks pass**, covering unchanged wallet engine/transport/signing,
  backup/restore rules, transaction matching, proposal validation and creation handler, plus
  an unchanged web/engine tree and the exact reused recipient implementation.
- Existing **native/web interoperability checks pass** with the local native core: encrypted
  backups in both directions, signed wallet documents, transaction/memo rules and messaging.
- A complete Mac executable links with that existing core. Its prebuilt C objects warn that
  they target macOS 26.5 while the app targets 14, and the prebuilt core embeds legacy home
  paths despite current Swift path remapping. The validation executable was deleted. It is
  not an app/release deliverable; rebuild the core with the supported toolchain and path
  remapping before packaging.
- **155 offscreen native layout captures** cover 19 scenes at 320, 390, 768 and 1200 points
  in light/dark themes, plus three enlarged-text layouts. Twelve selected images are retained.
  PNG dimensions/metadata, native logo equality and eight app-icon assets were checked.
- Whitespace validation passes. No merge, push, deployment or release occurred.

The captures render production SwiftUI view sources through macOS `NSHostingView`, including
real Mac text fields, steppers and segmented controls. The temporary harness replaces startup,
Keychain I/O, UserDefaults, networking, the engine bridge, logo resource lookup and navigation
link activation with isolated synthetic adapters. It never opens a real wallet, performs an
operation or accesses the device's Zigs secrets. Synthetic review inputs are not transaction
verification evidence. Layout adapters do not test navigation behavior.

Full Xcode and the iOS SDK/simulator are unavailable on this machine. The narrow captures use
**Mac controls at phone widths**, not iPhone screenshots. Native sheet presentation, compact
sidebar interaction, keyboards, VoiceOver, real Keychain/biometrics, physical devices, funded
transactions and release packaging still need platform testing. Enlarged-text environments
exercise reflow here; they do not establish physical-iPhone Dynamic Type behavior.

## Selected layout evidence

| Screen | Native layout render |
| --- | --- |
| Mac Overview · dark · 1200 | [View](visuals/native-continuation/overview-dark-1200.png) |
| Overview · light · 390 | [View](visuals/native-continuation/overview-light-390.png) |
| Overview · dark · 320 | [View](visuals/native-continuation/overview-dark-320.png) |
| Welcome · dark · 390 | [View](visuals/native-continuation/welcome-dark-390.png) |
| Creation name · light · 390 | [View](visuals/native-continuation/create-name-light-390.png) |
| Creation review · dark · 390 | [View](visuals/native-continuation/create-review-dark-390.png) |
| Formation · light · 320 | [View](visuals/native-continuation/setup-light-320.png) |
| Approvals · light · 390 | [View](visuals/native-continuation/approvals-light-390.png) |
| Empty approvals · light · 390 | [View](visuals/native-continuation/empty-light-390.png) |
| Payment review · light · 320 | [View](visuals/native-continuation/review-light-320.png) |
| Security · dark · 390 | [View](visuals/native-continuation/security-dark-390.png) |
| Exact large amount and long address · dark · 320 | [View](visuals/native-continuation/large-amount-dark-320.png) |

[Machine-readable validation and complete capture manifest](native-continuation-validation.json).

## Reproduction

```sh
swiftc -typecheck -warnings-as-errors -swift-version 5 -enable-bare-slash-regex \
  -strict-concurrency=complete -target arm64-apple-macos14 \
  -I ios/ZigsCore/include -module-cache-path /tmp/zigs-native-module-cache ios/Zigs/*.swift
python3 ios/check-ui-boundaries.py
python3 ios/check-recipients.py
python3 ios/PreviewNative/capture.py /tmp/zigs-native-layouts
# Use ios/ZigsCore.xcframework/macos-arm64 by default, or reuse a local build:
ZIGS_CORE_FRAMEWORK=/path/to/macos-arm64 bash ios/check-backup.sh
swiftc ios/AssetTools/export-icons.swift -o /tmp/zigs-export-icons
/tmp/zigs-export-icons web/logo.png ios/Zigs/Assets.xcassets/AppIcon.appiconset
```
