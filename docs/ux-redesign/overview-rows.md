# Compact Overview assets

Updated 22 October 2026 on `codex/ux-ui-final`.

The total-balance bar and its existing Send/Receive controls stay full width. Below it,
three compact asset rows occupy two thirds of the desktop content area, with the existing
Pending/Recent transaction panel alongside them. Smaller screens stack the sections.

Shared control and Transactions share an independent right-hand stack on desktop. Transactions
follow Shared control with the normal section gap, without inheriting the asset column's row
height. Expanding asset details no longer pushes Transactions down. Smaller-screen ordering
remains assets, transactions, then shared control.

The spacing adjustment was checked at 320, 390, 768, 1100, 1280 and 1440px in both
themes. Desktop spacing stays at 20px when asset details expand; Pending/Recent selection
and the smaller-screen section order remain functional, with no horizontal overflow.

Rows show the asset, network, privacy status, balance/readiness and existing Shield/Unshield
controls. Incoming ZEC appears when nonzero; stale and syncing balance labels remain visible.
USDC remains unavailable with a visible do-not-deposit warning. Repeated Send and Deposit
buttons are removed from the rows. Their existing launchers remain in the balance bar.

Each row's keyboard-accessible plus disclosure retains detailed privacy explanations,
balance details and existing refresh/faucet controls. Device and recovery information is
folded into a separate disclosure below the assets. Payment handlers, eligibility, balances,
authorization, prices, recovery formats and native applications are unchanged.

Validation: existing Overview and unified setup regressions passed; focused page-module lint
and whitespace checks passed. Fresh isolated browser checks covered 320, 390, 768, 1024,
1440 and 2048px in both themes, keyboard disclosures, transaction selection, exact large
balances and stale/syncing SOL states. Screenshots and the browser report are in
`visuals/overview-rows/`. All browser evidence uses synthetic display data without wallet
boot, funds, signing or external services.
