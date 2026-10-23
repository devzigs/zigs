# Overview cleanup and transaction null states

22 October 2026 · Web only · Baseline `74b5393`

- Removed the duplicate Devices & Recovery section from Overview. Device management and recovery
  controls already exist in Security & Recovery, which Settings already links to. The optional
  backup-progress notice now appears alongside recovery files there.
- Fully read, empty approvals use a static blank list with the muted label **No pending approvals**,
  on Overview and the dedicated Approvals page. A confirmed empty recent list says
  **No recent transactions**. No invented transactions, skeleton animation or placeholder amounts.
- Existing populated rows, handlers, held approvals, loading/error notices, unread Solana states
  and history-coverage disclosures remain. An unknown or incomplete list does not receive the
  confirmed-empty label. Wallet logic, APIs, security and native applications are unchanged.

| View | Before | After |
| --- | --- | --- |
| Pending · desktop · dark | [Before](visuals/overview-empty/before/pending-1440-dark.png) | [After](visuals/overview-empty/after/pending-1440-dark.png) |
| Recent · phone · light | [Before](visuals/overview-empty/before/recent-390-light.png) | [After](visuals/overview-empty/after/recent-390-light.png) |

16 matched desktop/phone captures in dark/light were saved; representative rendered views were
visually inspected. [40 browser checks](overview-empty-validation.json) pass across 320/390/1440px,
including populated history, unknown/failed reads and retained security/settings destinations.
Captures use temporary unfunded fixtures and actual page components, never a user-owned store.

Updated unified-setup regression, page lint, changed-test strict lint and build dry-run pass.
The Node 24 fast run passes 41/42 executed suites, retaining the previously documented `graph`
module-list mismatch. QR remains skipped without `qrencode`. No new dependency, push, merge or
deployment. Preview remains at `http://127.0.0.1:55846/`.
