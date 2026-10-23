# Wallet funding preview

The funding presentation follows wallet preparation directly. Optional Zcash naming is
part of this checkout; there is no preceding standalone name-payment step.
Only a browser holding creator seat 1 receives the automatic entry. Other joining devices
continue to Overview. The creator can finish later and reopen the preview from Overview.
The resume card appears only for a started, unfinished preview in the current tab. Completing
the preview removes the card; Overview shows no demo-completion or review-preview banner.

The agreed fixed allocation is 0.150 SOL: activation 0.050, privacy routing 0.030,
SOL fee account/setup 0.010, messaging 0.013 (approximately ten short messages),
bridge/funding 0.010, operating buffer 0.037. These are planning allocations, not live prices.
An unchecked-by-default name option adds an illustrative 0.020 SOL registration budget,
reusing the previous name preview's SOL example price. Checking it adds a separate Zcash
name line immediately after Operating buffer and changes the total to 0.170 SOL. Unchecking
it removes the line and restores 0.150 SOL without changing any base allocation.
The name, checkbox and total remain in tab memory only. Reuse the existing name validator;
no availability or registry request is made. A selected name needs valid syntax before
either mock payment path opens. Name-control limits remain available beside the option.

The name panel identifies Zcash Names (ZNS) by ZcashMe at `zcashnames.com`, the provider
used by the existing resolver. It is separate from `zcashnames.co`. Published annual USD
tiers are shown for four characters ($400), five ($100), and six or more ($20), highlighting
the matching tier as the user types. All name fees opens an in-step guide with all six
length tiers and the forever prices (three times the annual price). The guide explains
that ZNS converts USD to ZEC and network fees are additional, and links to the provider
and its [pricing policy](https://www.zcashnames.com/docs/protocol/pricing), verified on
23 October 2026 (page updated 18 October). No live quote or provider request is added.
The 0.020 SOL checkbox addition is explicitly labelled a mock budget, not a registrar fee;
no USD/ZEC/SOL conversion or real registration is represented as implemented.

The allocation screen offers browser-wallet and QR payment choices directly, with no
separate payment-review step. Both lead to explicitly simulated confirmation/funding,
four simulated funding stages and a preview completion screen. The privacy explanation
describes the shared pool, proofs, relayer, public deposit/payout visibility, correlations
and Zigs/provider visibility. No anonymity guarantee is made.

Funding is a demo, not a step of the wizard. The wizard keeps its five steps, and its last
screen leads to the wallet with the primary button Open Overview. The creator device also sees
the optional button "See the funding demo (no payment)" there, which opens Overview and then the
demo. The Overview banner "Funding checkout demo" returns to the same tab-memory checkout with
its name choice and total intact. Finish later opens Overview.
Its desktop content width is 1240px, with wider name and privacy columns and more space
between them. The wallet sidebar and contextual Overview header remain absent. Every funding view
uses the same card dimensions, adapting its height to the viewport. The full six-line cost
breakdown stays on the first screen. Cost explanations use two short pages. Desktop has
three columns: costs, optional Zcash name, and the private funding explanation with protocol
links. Narrow or short screens use Costs / Zcash name / Private funding tabs within that
same step, keeping both payment choices visible. Content is not
clipped or placed inside a scrolling panel. The ordinary mobile app footer is absent here.

`funding-preview.js` is presentation-only: it uses the existing QR encoder and pure name
validation helpers, without invoking registry, wallet, signing or quote services.
`app-funding-preview.js` keeps preview instances in tab memory only.
Simulated progress never updates balances, funding records, actual payment history, wallet
readiness, tutorial protocol facts, recovery files or any authorization gate. A page reload
resets the demo. It cannot collect payments or enable USDC, bridging or Privacy Cash.

The isolated `/dev/funding/` page renders the same component with the normal app themes,
logo and a synthetic Overview. Its CSP disables all connections. It contains no real keys,
addresses or payable requests. The QR is generated locally with the existing encoder and
contains only text marked NOT A PAYMENT, the selected sample total and optional name, and
no recipient or payment URI. Wallet confirmation, QR text, completion and the resume banner
all use the same current total. No name is actually registered or reserved.
Run from a local static web server rooted at `web/`.

Verified protocol references (23 October 2026): [Privacy Cash](https://www.privacycash.org/),
[user documentation](https://privacycash.mintlify.app/) and the
[SDK source](https://github.com/Privacy-Cash/privacy-cash-sdk). These explain the proposed
pool/proof/relayer route; the links do not imply endorsement, partnership or an implemented
Zigs integration. The text retains public-visibility, correlation and operator-visibility limits.

Technical reference: local `origin/main` at `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.
Real funding needs a separate engineering implementation for payment verification,
idempotency, ledger ownership, quotes/fee handling, treasury key management, routing,
destination validation, reconciliation and service/network capability checks. No mainnet
funding or privacy-routing capability is introduced here.

Validation on the UI branch:
- Module graph passes with 83 modules, including the locked-vault check; focused lint passes.
- The full real-module unified setup regression passes.
- Worker/asset deployment dry run passes. No deployment was performed.
- Fast suite: 47 checks pass in the sandbox; the localhost-based demo check passes separately
  with local-server permission (19 subtests). QR generation is skipped without `qrencode`.
- Real page-module handoff exercise passes: the creator enters funding directly with
  the name option in checkout; finish-later/resume works; a joining device goes to Overview. Wallet documents and
  verified wallet state are unchanged by the handoff.
- Browser exercise covers light/dark layouts, inline privacy information, both payment choices,
  back/cancel, simulated approval/payment, pause/resume, completion and replay. Views fit 320×568, 390×844,
  768×720, 1280×720 and 1440×900 viewports without page or panel scrolling. The short
  1366×600 laptop layout is also checked. All action buttons remain visible and unobstructed.
  Browser errors and external requests are absent; demo balances and
  browser storage remain unchanged.

Combined-name validation: toggling the option adds/removes exactly one 0.020 SOL line below
the buffer; totals remain consistent across checkout, browser-wallet confirmation, QR,
completion and resume. Case and .zec/.zcash suffixes normalize through the existing validator.
Empty or invalid selected names prompt for a valid name or opt-out. Normal and 63-character
names fit phone/desktop layouts without page or panel overflow. The setup regression, module
graph and focused lint pass; the mock sends no requests or browser-storage writes.

Shared-wizard validation: the real-module handoff also checks Back up and Plan review,
return to Funding, and preservation of the selected name/total. The focused browser run
passes 117 layout and interaction checks across seven viewport sizes in both themes,
including 320×568, long names, simulated progress and completion, with no page/panel
overflow, browser errors or external requests.

The wider layout and fee guide pass 145 focused browser layout/interaction checks, including
the name pane, all fee tiers, existing checkout paths and long names. Both themes fit the
same seven viewports without page or panel scrolling; the real-module handoff and lint pass.
