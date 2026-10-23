# Web v3 surface and state coverage register

This register covers implemented web surfaces rather than treating the PRD's seed list as new
feature scope. Shared styling applies to every listed renderer. Verification status is finalized
against generated reports; source review alone is not a browser or security certification.

Evidence keys: **J** = actual isolated wallet journey; **S** = inert real-renderer sample matrix;
**X** = additional real-renderer dialog/device matrix; **P** = presentation-only financial fixture;
**U** = existing Node regression; **R** = source/style review. All data is synthetic and unfunded.

| View / entry | Applicable existing states | Shared presentation / evidence | Verification status |
| --- | --- | --- | --- |
| Startup / engine loading | loading, unavailable engine | shell, status, controls; R/U/J | browser journey |
| Welcome / empty wallet collection | zero wallets, ready, unsupported protection | shell, typography, brand, disclosures; J/S | browser matrix |
| All your wallets disclosure | zero, multiple, long names, open/closed | native disclosure and rows; R/J/U | existing behavior retained |
| Inline Join | blank, invalid input, joining/error | controls, notice, spacing; J/U | browser journey |
| Create: Protect browser | recommended, unavailable, cancelled/error | education, controls, notices; J/U | browser journey |
| Create: Skip confirmation | safe return, explicit consent, ineligible storage | warning and buttons; U/J | policy regression and 206-check dedicated browser journey |
| Create: Approval rule | default/custom supported, invalid/unavailable | type, selection, controls; J/U | browser journey |
| Create: Device and wallet details | names, description, helper/validation | labels, inputs, association; J/U | browser journey |
| Create: Final review | policy, member count, chain consent | solid review and warnings; J/U | browser journey |
| Replace-wallet creation | consequence warning, review/back | shared create dialog; X/U | additional matrix verified |
| Guided Connect | invitation, participants joined, waiting | diagrams, member rows, controls; J/U | browser journey |
| Guided Verify | full safety digits, waiting, mismatch/stop | static values, notices, acknowledgement; J/U | browser journey / regression |
| Guided Prepare | ceremony, address checks, waiting/error | status, opaque detail, education; J/U | browser journey |
| Guided Backups | optional, saved, checked, reported/missing | recovery rows and truthful notices; J/U | browser journey |
| Guided Ready | prepared, local recovery progress, peer pending | status and controls; J/U | browser journey |
| Legacy/stopped/unreadable setup | actual unsupported/failed distinctions | shared setup primitives; R/U | source/regression; not every branch captured |
| Overview | populated, native zero/loading, unavailable fiat | graphite, cards, transaction/security groups; J/S/U | browser matrix |
| ZEC asset / details | exact available/incoming, cap, freshness | amount, actions, disclosure; J/S/U | browser / regression |
| SOL asset / details | synced/saved, not-added, stopped/error, unavailable | state-specific card, existing routes; S/U/R | sample + regression; live services unavailable |
| USDC asset / details | unavailable, disabled, deposit warning | opaque surface, warning, quiet actions; J/S/U | browser matrix |
| Overview Send/Receive asset choice | open/closed, blocked ZEC, SOL/USDC eligibility | native details and existing actions; J/U | browser journey |
| Pending / Recent summary | empty, pending, received, partial history | tabs, aligned rows, disclosure; J/S/U | browser / regression |
| Approvals workspace | no-wallet, unfinished, empty, action buckets | shared shell/list/status; J/S/U | browser matrix |
| ZEC payment detail drawer | blockers, full address/memo, amounts/costs, lifecycle | opaque review, warnings first; P/U | fixture matrix + regression |
| SOL proposal review | expiry/error, existing payment-stage distinctions | opaque review, warnings first; P/U | fixture matrix + regression |
| Activity workspace / records | no wallet, empty, populated, partial/freshness | financial rows, exact amounts and labels; J/S/U | browser / regression |
| Address book list/search | empty, saved, no results, long values | rows, search, asset/network context; J/S/U | browser journey |
| Address book add/edit | labels, validation, stored selection | shared form/editor; J/U | browser journey / regression |
| Address book deletion | existing named confirmation/cancel | destructive controls; J/U | browser journey |
| Send form | destinations, saved recipient, amount/memo, Max, draft | shared controls, precise summary; J/S/U | browser matrix |
| Send local decoded review | exact output match/refusal, back/confirm gates | review primitives; U/R | regression; live funded execution excluded |
| Replacement transfer form | old/new-wallet context, amount, blockers | form/review primitives; U/R | regression; no live transfer |
| Receive dialog | verified address, QR, copy/share, network/cap warning | plain QR/address, controls; J/S/U | browser matrix / QR fixture |
| ZEC file backup | initial, passphrase controls, error/busy/result | solid dialog, opaque inputs, warning; X/U | initial dialog matrix verified; other states regression |
| Saved-file check | initial, file/password required, failure/result | solid dialog, static fields; X/U | initial dialog matrix verified; other states regression |
| Restore dialog | initial, passphrase, busy/failure, stale restore | solid dialog, warning and controls; X/U | initial dialog matrix verified; other states regression |
| SOL backup / recovery variants | current chain-specific prerequisites and errors | shared backup primitives; U/R | regression/source; live SOL prerequisite blocked |
| Personal-account backup / restore | current account prerequisites and errors | shared backup primitives; U/R | regression/source; complete visual path not captured |
| Chats workspace | wallet-only access, empty/list, unread | shell, rows, static message surfaces; J/S/U | browser journey |
| Direct chat / composer | received/sending/failure, invite/leave | text, composer, controls; J/U/R | browser journey / regression |
| New-chat dialog | name/devices and existing validation | shared dialog and controls; X/U | additional matrix verified |
| Payment discussion | existing review context and message states | static messages and controls; U/R | regression/source |
| Personal contacts / add/detail | actual messaging-account prerequisites | shared rows/forms; U/R | regression/source; full visual path not captured |
| Security & Recovery workspace | no wallet, unfinished, policy, backup reports | summary, device/recovery rows; J/S/U | browser matrix |
| Device membership/details | current device, membership/verification, invite | compact rows, static status; X/U | additional matrix verified |
| Wallet Settings | description, network, technical disclosures | section hierarchy, controls; J/S/U | browser matrix |
| Browser Settings / Appearance | dark/light/system, reload, local protection | shared controls, solid surfaces; J/S/U | browser matrix |
| Personal-account settings / fee funding | empty/account, public funding notices | shared sections, QR and warnings; U/R | source/regression; no funded operations |
| Help / diagnostics | ready, failures, existing redaction | shared sections and detail; J/U/R | included Settings / regression |
| Locked / damaged browser / forget | locked, cancellation, damaged vault, confirmation | solid lock/error/confirmation; J/U/R | protection/reload browser checks; damaged/forget source and regression only |
| Phone-browser navigation | open/close, Escape, focus containment/return | selective glass, opaque fallback; J/S | real-interaction measurements |
| Native desktop wallet selector | multiple wallets, accurate selection | styled native frame; J/U/R | existing behavior retained |
| Banners, empty states, skeletons | actual info/warning/blocker/error/status | shared semantic tokens and components; J/S/U/R | consuming-screen evidence |
| Swap workspace | unavailable | composed unavailable state; J/S | browser matrix; no quote engine |
| Dedicated offline QR signing | not implemented in current entry points | no build required | not implemented |
| Swap quotes / execution and USDC balances | unavailable capabilities | no build required | not implemented |

## Cross-cutting evidence

The visual matrix covers exact v3 viewports, both explicit themes and both system schemes,
enlarged text and forced colors. The actual journey covers form retention, disabled states,
keyboard navigation, real protected/unprotected eligibility tests and financial review fixtures.
Performance recordings and reduced-preference checks are separate from screenshot inspection.

Actual Safari UI review is blocked by unavailable Computer Use permission. Playwright WebKit
engine results are labeled separately. Missing browser APIs or domain prerequisites are recorded
as limitations, never as fabricated passes. Sensitive values stay masked in evidence.

## Final reconciliation

The [final validation report](web-v3-final-validation.json) records 1,160 checks and 215 captures
in each actual before/after journey, 206 optional-protection checks, 1,013 final Chrome matrix
checks and 1,009 WebKit matrix checks. Genuine Chrome browser zoom adds 120 checks per phase.
The ten-page inert sample rebuild passes 32 checks and its source fingerprint matches final code.

Every implemented family above has source/style review and a stated evidence level. This is
**not** a claim of visual verification of every possible domain state. Live SOL prerequisites,
all personal-account recovery/contact variants, damaged-vault/forget states and every legacy
failure branch do not have complete visual captures. Their existing regression/source coverage
is distinguished in the table. Actual Safari, physical-device and assistive-technology sign-off
remain outstanding. None of these limitations grants permission to alter the underlying systems.

## Subsequent utility audit

The [remaining-screen audit](remaining-polish.md) reconciles the utility routes, nested dialogs,
menus, controls and difficult-state branches after the dashboard, onboarding and payment passes.
Its validation report distinguishes newly rendered evidence from retained source/regression-only
coverage; it does not broaden the visual-certification claim above.
