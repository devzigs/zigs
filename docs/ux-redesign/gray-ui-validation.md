# Gray UI — validation and delivery record

25 October 2026. Branch `gray-ui`, based on main
`c6860f6fef9351531bd3a9c3a221600c49651035`; visual reference
`78345496bb6438e22bfdbfbc484105df84c18c0d`.

## Result

The [PRD](gray-ui-prd.md) inventories the existing design, remaining differences and scoped
acceptance criteria. Main already carries the web redesign. Keep its newer behavior,
disclosures and layout corrections. Ported the independent native messaging walkthrough and
post-formation card. Deferred runtime-dependent funding/Swap parity in the
[technical review](ux-ui-final-technical-review.md).

Only four native application view files and the existing capture harness change:

- `ios/Zigs/NativeMessagingViews.swift`: standalone reference walkthrough, unchanged from
  the reference branch; only view-local step selection, no wallet or network dependency.
- `ios/Zigs/RecipientViews.swift`: Relay/Zcash demo selector; the picker is labelled Chats
  view because it does not select a working messaging transport. Existing Relay handlers
  and recipient screens are retained.
- `ios/Zigs/NativePreparedView.swift`: standalone post-formation card, extracted without
  the unimplemented funding-preview reference.
- `ios/Zigs/GroupView.swift`: view-local observed-formation/dismissal state and existing
  Security navigation. Clear the card on wallet changes. No model or readiness writes.
- `ios/PreviewNative/main.swift`: captures for the new card and four walkthrough steps,
  correct Chats selection in their sidebar, and enlarged-type environment captures. All
  previous scenes, including unavailable Swap, are retained.

## Checks actually run

| Check | Result |
| --- | --- |
| Existing `sh scripts/test-fast.sh`, Node 26.12.1 | **48 tests passed in 10 seconds.** `qr.mjs` skipped by the existing runner because `qrencode` is not installed. |
| Existing `python3 ios/PreviewNative/capture.py` | **Compiled and rendered 200 isolated native SwiftUI captures**, including 45 for the new views. Four widths: 320, 390, 768 and 1200; light and dark themes; additional 390-width accessibility-type environment scenes. |
| PNG dimension/hash checks | All 200 PNGs have the expected width and positive height; recorded in [the capture manifest](gray-ui-native-captures.json). Six inspected captures retained below. |
| Visual inspection | Reviewed the Account, Back up, Funding, Contact and Prepared views, plus the default Relay workspace. Sampled narrow, wide, light, dark and accessibility environments: copy wraps, controls remain readable and demo qualification is visible. |
| Full changed-path scope check | Only the five native view/capture paths and `docs/ux-redesign/**` differ from the main baseline. All web, engine, API, cryptography, authentication, persistence, native models, project/build, infrastructure and test-runner files remain identical to main. |
| Existing operation preservation | `GroupView.swift` from `struct Header` onward is byte-identical to main; recipient views before `ChatsWorkspace` are byte-identical. Standalone new views import only SwiftUI and use no wallet model, WebKit, network or persistence API. Existing chat closures and sync/backup/import/payment handlers are unchanged. |
| Historical review preservation | Previous technical-review contents retained beneath the dated Gray UI section. |
| Git hygiene | `git diff --check` and `python3 scripts/check-git-identity.py --current` passed. Existing hooks remain enabled. |
| Remote baseline recheck | Remote main remained `c6860f6f…`; `gray-ui` did not already exist. |

[The scope audit](gray-ui-scope-audit.json) records the 29 differing web files, all 43 native
reference differences, their dispositions and the hashes of the changed native sources.

## Evidence samples

| Scene | Capture |
| --- | --- |
| Account, light, 320 | [Image](visuals/gray-ui/messaging-account-light-320.png) |
| Backup, dark, 390 | [Image](visuals/gray-ui/messaging-backup-dark-390.png) |
| Funding, accessibility environment, 390 | [Image](visuals/gray-ui/messaging-funding-accessibility-390.png) |
| Contact, light, 1200 | [Image](visuals/gray-ui/messaging-contact-light-1200.png) |
| Prepared, accessibility environment, 390 | [Image](visuals/gray-ui/prepared-accessibility-390.png) |
| Relay default, dark, 320 | [Image](visuals/gray-ui/chats-dark-320.png) |

## Limits

Native captures compile actual view sources against isolated synthetic adapters. Engine,
Keychain, server, authentication and real-wallet operations are disabled in the harness.
Narrow captures use macOS controls; they are not iOS simulator or physical-device evidence.
Static captures and source review do not establish live click-through behavior, real
formation transitions, VoiceOver behavior or end-to-end funded payment correctness.

The long baseline/mutation suites, full Xcode/iOS build and physical-device interaction
checks were not run. The existing native build/path limitations remain. No release-ready
native binary or live-wallet certification is claimed. QR validation remains skipped as
reported above; web QR implementation is unchanged.

The native WebKit funding/Swap runtime and the reference's mandatory-looking funding stage
remain deferred under the UI-only scope. No merge, automatic merge or deployment is part
of delivery.
