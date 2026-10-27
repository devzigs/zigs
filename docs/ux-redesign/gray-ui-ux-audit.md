# Gray UI — complete web flow UX audit

25 October 2026 · implemented on `gray-ui` · no merge or deployment.

Reviewed the web product for clear language, action placement, explanations, recovery paths
and honest expectations. This continues the visual pass at
`ee64572e4d429667de5974aba346009b0388e914`. Main was fetched and reviewed at
`c6860f6fef9351531bd3a9c3a221600c49651035`; its technical behavior remains authoritative.

The largest opportunities were verbs that obscured what happens next, temporary plans that
appeared durably saved, duplicated recovery explanations, and inconsistent action order.
The changes below are implemented. This is a web audit; native presentation is unchanged.

## Findings and resolutions

| ID | Priority | Finding | Implemented resolution |
| --- | --- | --- | --- |
| UX-01 | High | “Propose payment” required users to understand an internal lifecycle term. | **Request approvals** names the next step. The review explicitly says that this shares the payment with the wallet's devices and does not sign or send it. The repeat-proposal path keeps its existing behavior. |
| UX-02 | High | A request card said “Propose this” although it only opened the Send form. | **Review in Send**, with **Wallet for this payment** on the wallet selector. Request composition explicitly distinguishes sending a request from making a payment. |
| UX-03 | Medium | “Note for the devices” and “Memo” were easy to confuse. | **Wallet note** and **Recipient memo**, with the separate note's audience and encryption stated at its field. Review uses the same Wallet note term. Invite-link holders remain included in the disclosure. |
| UX-04 | High | Pre-creation “Save and exit” implied durable storage, although the unfinished plan only lives in tab memory. | **Pause plan**. The sticky action area says closing or reloading clears the plan, and Pause directly references that explanation for assistive technology. Post-creation saved setup progress retains its existing wording. |
| UX-05 | High | “Are you sure?” did not name the consequence of skipping protection. | **Continue without passkey protection?**, with **Back to protection** as the safe primary action. Existing unprotected-storage warning, explicit acknowledgement and all eligibility checks remain intact. |
| UX-06 | Medium | “Lock with a passkey” suggested immediate locking, while the action enables encryption. | **Enable passkey protection**. The passkey explanation distinguishes local unlocking from adding a signing device or replacing a recovery file. |
| UX-07 | High | “Delete the locked keys” understated the other data held in the encrypted copy. | **Delete locked Zigs data?** names the scope. Four separate consequences cover signing shares, direct chats, the personal account and saved recipients. **Keep locked data** precedes **Delete locked data**. |
| UX-08 | Medium | Backup labels were vague and repeated the same explanation in several blocks. | **Encrypt and save file** and **Confirm passphrase**. Consolidated guidance retains the file-plus-passphrase requirement, separation, inability to recover the passphrase, distinction from a seed phrase and the fact that copied shares are not extra approvals. |
| UX-09 | Medium | Optional saved-file checking repeated its read-only explanation. | Kept the complete instruction beside the fields and removed the duplicate educational box. Checking still does not restore or replace a share; filename/content/passphrase privacy wording remains. |
| UX-10 | High | “Open a backup” / “Open backup” did not communicate that the operation restores local material. | **Restore a backup** / **Restore backup**, with the selected file shown, its required passphrase explained and the effect described before the field. Distinguishes a restored share from a new independent device. |
| UX-11 | Medium | Recipient editing put Save before Cancel, opposite the surrounding form pattern. | **Cancel → Save recipient** in both DOM and visual order. Address guidance is programmatically associated with the full-address field. Removal language is consistently **Remove**. |
| UX-12 | Medium | Name/device guidance disappeared once a placeholder was replaced by typing. | Persistent field hints clarify who sees a nickname and that a device label does not verify identity. Existing label persistence remains unchanged. |
| UX-13 | Medium | “Create” in New chat did not say what was created or why it was disabled. | **New direct chat → Create invite link**. Private sharing and the unclaimed-link risk are explained before the action. Engine, relay and access conditions have visible guidance. |
| UX-14 | Medium | “Copy link” and “Copy message” did not distinguish direct-chat invitation formats. | **Copy chat link** and **Copy invitation**. Leaving a chat offers **Keep chat** beside the destructive action, while retaining the local-removal/server-retention and rejoin warnings. |
| UX-15 | Medium | A contact's shielded-address field did not show the required network beside the input. | **Contact’s shielded address** plus visible Zcash network/type guidance linked to the field. Existing format checks and reply-address explanation remain. |
| UX-16 | High | Mismatch instructions quoted an outdated button label and placed Stop before the safe return. | Instructions now say **Codes don’t match**. **Keep checking → Stop setup**, matching reading and keyboard order. Initial focus and all thirty-digit checks, acknowledgements and stop behavior are preserved. |
| UX-17 | Medium | Long dialogs and equal-weight buttons made the next action harder to find. | Compact desktop actions aligned at the end; usable phone targets; a full-width primary when setup has three actions. Close stays visible while scrolling. Long form actions stay reachable; short windows release sticky chrome. No CSS reversal of keyboard order. Payment reviews keep their existing document-flow placement. |
| UX-18 | Medium | Advanced Solana actions used “Try the execute again”, “Get it back” and “Look for rent”. | **Retry execution**, **Reclaim rent**, **Find reclaimable rent**. Rent is defined beside the action. Existing public-transaction, fee-address, Helius/IP, expiry and reclaim restrictions remain. The Zcash move now says **Request move approvals**, with an explicit statement that funds have not moved yet. |

## Flow-by-flow coverage

“Rendered” means the actual view was inspected with synthetic facts in isolated Chrome.
“Regression” means existing automated behavior checks were run. A source review does not
claim that a live funded or authenticated journey was completed.

| Flow | UX review result | Evidence |
| --- | --- | --- |
| New and returning Home; choose a wallet; join/recover entry | Entry actions already name their destinations; wallet/network context remains visible. Kept current hierarchy and existing test-network disclosures. | Source, existing functional browser matrix, setup regression. |
| Unlock; unavailable or damaged passkey data; lost-passkey deletion | Preserved honest locked/damaged distinctions. Improved protection verb and deletion scope/consequences. | Settings/deletion rendered; passkey and full-page regression. No real credential reset or deletion. |
| Optional protection; cancelled/failed protection; explicit Skip | Specific consequence, safe return, visible explanations and retained explicit confirmation. Never presents skipped protection as verified. | Skip opened/cancelled at 320, 390 and 1440; optional-passkey/setup regressions. |
| Create plan: protection → rule → labels → review | Consistent labels, persistent field hints, review facts before Create and accurate tab-lifetime disclosure. | All four stages rendered in six theme/width variants; full setup regression. |
| Pause and resume an uncreated plan | Language matches tab-memory lifetime. No new persistence policy. | Rendered action guidance; existing pause/resume assertions. |
| Invite devices; copy/share invitation; QR; join a slot | Preserved private-link warning, independent-device guidance, browser guidance and explicit Join action. No invite secret exposed outside the existing disclosure. | Source; full setup regression, including actual secret-copy/disclosure assertions. |
| Compare safety number; confirm; mismatch; stop setup | All thirty digits and the acknowledgement remain. Correct current button name and safe-return-first confirmation order. | Source; full setup regression plus explicit safe-action order assertion. |
| Shared key/address preparation; Solana service pending; setup completion | Existing current-step, blocked, pending and ready distinctions remain. Revisiting education does not repeat operations. | Source, setup/guided-model regression and existing browser checks. |
| Optional recovery: save, generate passphrase, confirm and download | Fewer repeated explanations; precise save-file action and confirmation label. One copied share remains one signing device. | Save dialog rendered; backup and full-page regression. No real backup file generated by visual QA. |
| Reopen/check a saved recovery file | Clearly a separate optional read-only check; retained file/passphrase and privacy instructions. | Check dialog rendered; backup-check regression. |
| Restore a share or messaging account | Explicit restore verb, selected file, passphrase requirement and same-share explanation. | Restore dialog rendered; restore/full-page/setup regression. No real file imported. |
| Overview; balances; unavailable valuations; asset actions | Wallet, asset and network remain clear; unknown/demo values and unavailable actions keep their disclosures. | Source, functional/motion browser regressions. |
| Zcash Send: one/multiple recipients, Max, list/ZNS, memo, note, priority fee | Kept complete destination, cost, audience, priority-fee and expiry guidance. Distinguished recipient memo from wallet note. | Entry rendered; full-page request/batch/ZNS/payment regression. |
| Zcash review: matching, mismatched, stale and repeat proposal | Request approvals accurately describes the next action. Mismatch still removes the proposal action. No guard or prepared transaction is replaced by form contents. | Matching/mismatch views rendered using read-only decoder facts; engine-backed full-page regression covers actual guards. |
| Approve → sign → prove → broadcast; cancel; expired proposal; release Send hold | These are materially different actions. Kept their current step-specific buttons and warnings rather than collapsing them into “Send”. | Source and full-page regression, including stale/changed/held-payment cases. No funded payment executed by visual QA. |
| Activity filters; details; incomplete history; confirmation | Preserved status and completeness language; an entry is not relabeled as confirmation. | Source, functional browser and payment regressions. |
| Receive; address/QR; copy/share; faucet; moved/capped/hidden destination | Kept verified destination, network warning and all exposure/faucet disclosures. Previous Close-first entry preserves initial phone QR visibility. | Receive rendered; 194-check motion regression; full setup/page regression. |
| Address book: search, add, edit, remove and pick from Send | Consistent Cancel/Save order, persistent address guidance and accurate local-book/identity warnings. Removing a recipient does not imply deleting a payment. | Empty/editor rendered; recipient and full-page regression. No recipient saved. |
| Team messages; relay transport; direct chat invitation/join | Specific invite creation verb, audience hint, private-link risk and readable disabled reason. Existing message/payment separation remains. | Create/invite states rendered; chat/request/setup regression. |
| Relay composition; drafts; reconnect; leave chat | Kept existing draft/focus behavior, offline guidance, local leave scope and server-retention warning. Safe exit reads Keep chat. | Leave state rendered; full-page and motion regression. No messages sent. |
| Personal messaging account: create, backup, fund, remove | Retained separate-account ownership, recovery and fee responsibility. No wallet approval is implied. | Source, settings render, messaging/full-page regression. No account created. |
| Add contact; share reply address; review on-chain message cost | Address guidance names the network; current reply-address next step is preserved. Existing fee-specific Send action and permanent-on-chain/zero-value recipient disclosure remain. | Contact form rendered; messaging-cost and full-page regression. |
| Solana fee funding, pool deposit, private payment and public withdrawal | Preserved distinctions between device fee funds and wallet holdings, exposure, exact costs and unsupported states. | Source and existing Solana payment regression. |
| Solana approval/execution, retry, expiry and rent reclaim | Clearer advanced verbs and local definition without changing retries, proofs, leases, fee payer, public reclaim or expiry gates. | `sol-pay` and `sol-pay-exec` regressions, plus fast rent checks. No live Solana operation. |
| Replace devices/rule; create replacement wallet; move Zcash | New wallet/address and transfer remain separate operations. Move requests approvals; Solana funds do not move through this Zcash action. | Replacement form rendered; full-page/setup regression retains complete Solana warning. |
| Swap and post-quantum previews: configure, review, expiry, sample approvals, result/refund | Existing “demo”, illustrative/unquoted fees, manual simulation and unavailable-live-route language are already explicit. Kept those qualifiers and actions. | Source and swap-preview regression. |
| Funding/name checkout preview | Existing example amount, optional name, no-registration/no-payment and no-required-activation wording remain. Real setup is not gated by the demo. | Source, existing funding/setup regression coverage. |
| Privacy/Network and Tor demo | Current connection and unavailable integrated Tor are distinguished from the demonstration. No animation is presented as real network protection. | Informational panel rendered; source and existing preview checks. |
| Settings: appearance, notifications, memo reading, description and protection | Preferences already describe scope. Improved enabling-protection label; retained browser permission and private-description storage disclosures. | Settings rendered; theme, description, passkey and full-page regression. No notification permission requested. |
| Help, FAQs, diagnostics and How Zigs works | Current manual copy/share boundary, offline help, manual journey selection and Pause remain clear. No new help gate or automatic sharing. | Source, 511-check style/guide regression and existing model tests. |

## Button and explanation rules used

- Name the immediate outcome: Review, Request approvals, Create invite link, Save file,
  Check saved file and Restore backup are different actions.
- Put Cancel or the safe return before the normal confirmation in the DOM. The passkey Skip
  warning retains Back to protection as its safe primary; destructive actions retain their
  danger style. No CSS `order` reversal changes keyboard sequence.
- Keep field guidance visible after typing. Attach meaningful guidance with `aria-describedby`.
- Place the consequential explanation beside the relevant action. Keep costs, network,
  privacy and full-destination information in the actual review.
- Remove repeated explanatory boxes when the same facts are already stated at the fields.
  Preserve facts needed to decide: audience, local scope, irreversible effects, costs and guards.
- Use disabled-action text that describes the actual missing capability. Do not infer successful
  protection, complete history, live connectivity or wallet readiness from presentation state.

## Validation and scope

- **523 UX checks passed across 124 renderer-state variants**: 20 states in both themes at
  320, 390 and 1440 widths, plus Skip warning sizes and a 740×420 short-window case. Checked
  overflow, description targets, touch targets, keyboard/visual order, specific wording,
  Close after scrolling, focused fields clear of sticky controls, short-window fallback and unchanged browser wallet storage.
  [Flow report](https://github.com/devzigs/zigs/blob/a3257fb22a3c64ad8b32533dbd212ffa47bcc2ba/docs/ux-redesign/visuals/gray-ui-ux/flow-report.json).
- **194 motion/interaction checks passed**, 72 functional variants, with stable balance/address
  geometry, focus/Tab/Escape, reduced motion and hidden-document handling retained.
  [Motion regression](https://github.com/devzigs/zigs/blob/a3257fb22a3c64ad8b32533dbd212ffa47bcc2ba/docs/ux-redesign/visuals/gray-ui-ux/motion-regression.json).
- **511 existing style/guide checks passed**.
  [Style regression](https://github.com/devzigs/zigs/blob/a3257fb22a3c64ad8b32533dbd212ffa47bcc2ba/docs/ux-redesign/visuals/gray-ui-ux/style-regression.json).
- **48 required fast tests passed** on Node 26.12.1. The independent QR decoder test is skipped
  because `qrencode` is unavailable; browser QR visibility/stability checks still run.
- Existing broader checks passed: **`app ok`**, **`unified-setup: ok`**, **`sol-pay: ok`** and
  **`sol-pay-exec: ok`**. Headless graphics emitted the existing Three.js/precision warnings.
- Lint passed for **241 JavaScript files and 2 Python files** with the existing rules.
- A source AST comparison against `ee64572e` found **169 direct DOM event-handler expressions
  unchanged**, including their complete function/reference expressions. The broader diff is
  limited to presentation, tests, review tooling and evidence. No backend, authentication,
  cryptography, state model, dependency, operation handler or render scheduling was edited.
  [Scope and hash audit](gray-ui-ux-audit.json).

Test expectations were updated for intentional text changes; the original guard assertions
remain. The setup suite also caught two stale expectations from the prior visual migration:
Receive's approved Close-first focus and the original hero artwork's separate asset path.
Those expectations now match the implemented presentation. Added an explicit safe-action-order
assertion; did not remove secret-link, privacy, mismatch or payment safety assertions.

The visual harness uses synthetic participants and read-only decoded facts for review layouts.
It blocks external requests and wallet boot, holds the real minute-based refresh and seeds the
same synthetic device label used by setup, since existing field restoration can persist that
label. No real passkey, file import, signing share, account, message or funds are created by it.

An unfinished plan still cannot survive tab closure/reload; the UI now says so accurately.
Durable cross-session resume would require separately scoped storage/state changes. No such
engineering extension is needed for the implemented copy and placement improvements.
This audit does not establish physical-device keyboard behavior, native UX parity, empirical
user comprehension or live funded-operation success. Main remains untouched.

Reproduce the browser audit from the repository root:

```sh
node solspike/tools/ux_flow_browser.mjs
```

Use `PLAYWRIGHT_MODULE` and `CHROME_EXECUTABLE` if those tools are not available through the
default runtime. `ZIGS_UX_OUTPUT` sets the output directory. Existing fast, integration, style
and motion test commands remain available unchanged.
