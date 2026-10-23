# Persistent wallet header

23 October 2026 · `codex/ux-ui-final` · web presentation only.

The selected-wallet header now sits above page content across Overview, Approvals, Activity,
Address book, Swap, Messages, Security and Settings. Its opaque surface stays visible while
scrolling in both themes. Wallet identity, network and Return home retain the same placement.
The same header DOM and spinning canvas survive navigation and ordinary redraws, preserving
rotation and pause state. Wallet switches replace the identity; long names wrap within the screen.

Independent messaging keeps its existing wallet-close lifecycle. Its header retains only the
previous public wallet navigation context from the current document, with the existing verified
artwork checks. It does not reopen a wallet, change subscriptions or imply spending authority.
Return home, locking and removal of the referenced wallet clear the header. Incomplete guided
setup retains its existing header/reveal, avoiding duplicate marbles or competing timelines.

The shared header becomes inert behind existing dialogs and drawers. The Swap input retains
its actual DOM node, value and focus on routine redraws. Page renderers, payment gates, keys,
recovery operations, APIs and persistence formats remain unchanged.

Swap's compact outer padding now applies only without a shared wallet header. Its previous
page-container override moved the logged-in header upward on entry. Header bounds now match
Overview across every destination; standalone Swap keeps its compact spacing.

The destination is now named **Security** in the sidebar, page headings, Settings links, Shared
control and Help references. Internal `recovery` routes and the recovery features keep their
existing behavior. Corresponding browser fixtures and label assertions use the new wording.

## Verification on the publication tree

The remaining uncommitted presentation changes were recovered onto `codex/ux-ui-final`
from the original final-pass checkout. The original checkout is unchanged. Technical
reference main remains `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.
The separate recovery/device-replacement implementation and active funding-preview work
are excluded. Validation uses an isolated snapshot containing exactly the audited UI changes.

- All 663 focused browser assertions pass across eight destinations at 1440, 1024, 768,
  390 and 320px, in dark/light themes. They cover stable header bounds, one header per page,
  DOM/canvas continuity, readable wallet names, sticky scrolling, Swap input focus, wallet
  switching, lock/unlock, modal focus, independent message context, Return home, long names,
  doubled text, forced colors and 48px header actions. The runner completes the newer privacy
  popup using its ordinary dismissal controls. Its independently mounted status badge no
  longer causes the wallet header to be rebuilt during navigation.
- All 48 Node 24 fast regression suites pass. QR decoding is explicitly skipped because
  `qrencode` is unavailable. The application and longer unified setup suites pass.
- The setup suite now checks the existing full guide dialog, close action and ten chapters
  separately from the compact landing entry, and expects the removed beta footer to be absent.
- Focused production-module and changed harness/test lint and whitespace checks pass.

Run `node solspike/tools/wallet_header_browser.mjs` with the existing Playwright and Chrome
executable overrides. It writes isolated synthetic screenshots and results to
`/tmp/zigs-wallet-header` by default; `ZIGS_HEADER_OUTPUT` selects another output directory.
No live messages, payments, wallet creation, recovery import or external service requests
occur during this run. This is presentation verification, not funded-payment certification.
