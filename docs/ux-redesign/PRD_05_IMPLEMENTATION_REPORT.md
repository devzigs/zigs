# PRD 05 — Privacy visual language

22 October 2026. Web presentation only. Feature branch: `codex/ux-navigation`;
eventual merge target: `codex/ux-ui-final`. Both started at `4cd81df` before this task's edits.
No merge, deployment or push was performed. Main was fetched and reviewed at
`3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`; main was not checked out or modified.

## Evidence and priorities

Code and existing safety disclosures take precedence over the supplied design proposal.
Main's `PRIVACY.md`, `wasm/src/lib.rs` and `web/sol/payview.js` were checked alongside this
branch's renderers. The current Zcash payment implementation uses Ironwood v6; the brief's
Orchard description is not used to rename or change the protocol.

| Asset / action | Verified privacy and availability | Evidence / existing labels |
| --- | --- | --- |
| ZEC holdings, receive, send | Shielded notes and payments; transparent transaction parts are rejected. No transparent ZEC balance or Shield/Unshield transfer support. Public fee, expiry and action count still reveal metadata. | `wasm/src/lib.rs` transaction inspection; `PRIVACY.md` On chain; `web/app-wallet.js` `zecAsset`; `web/app-send.js` `receiveLead`, `reviewDialog`. Existing `Shielded ZEC`, `Available`, testnet/mainnet network labels. |
| SOL private balance / private payment | Eligible signed version 3 testnet wallets only, on Solana Devnet. Amount hidden on chain; payee owner key, program/group addresses and paying fee addresses remain public. Hosted/local prover differences remain disclosed by the existing UI. | `web/app-sol.js` `solOn`, `SOL_DISCLOSURE`; `web/sol/payview.js` `SEND_PUBLIC`, prover disclosures; `web/sol/view.js` `PUBLIC_TEXT`, `PUBLIC_LOCAL`. Existing `Private balance`, `Private payment`. |
| SOL deposit / withdrawal / fee funds | Deposits expose sender and amount; withdrawals expose recipient and amount. Device fee funds are public and separate from wallet holdings. | `web/sol/payview.js` `LINK_TEXT`, `WITHDRAW_PUBLIC`, `addSolCard`, `feeRow`; `web/sol/view.js` `keyBlock`. Existing `Public withdrawal`, `Your fee address`, `Public balance of the group key`. |
| SOL absent, loading, stopped, mismatched, failed | Eligibility or availability does not establish a privacy state. No confirmed shielded mark is shown. | `web/overview-model.js` preserves `Not added`, `Loading…`, `Stopped`, `Keys differ`, `Did not load`, `Unknown`, `Not available`; `web/app-wallet.js` retains these balance/status words. |
| USDC | Unavailable; no balance or deposit support. | `web/app-wallet.js` `usdcAsset`; existing unavailable warning and disabled actions retained. Removed the misleading `Shielded USDC` asset heading. |
| Mixed proportions | No complete same-scope denominator exists. No percentages, gauges or inferred mixed balance are added. | `web/overview-model.js`; existing `Privacy breakdown unavailable` and balance explanations retained. Device fee funds and legacy group funds are not combined. |

Ranked defects addressed: (1) unavailable assets implied shielding in their headings;
(2) SOL and ZEC looked equally private; (3) review/receive lacked a consistent, visible exposure
summary; (4) unknown availability could be mistaken for verified privacy.

## Implementation

- `web/privacy-language.js` and `web/privacy-language.css` provide labeled, monochrome motifs:
  closed/solid **Shielded**, open **Public**, split **Partial privacy**, dashed neutral
  **Privacy unknown / unavailable**. The split means different information has different
  exposure, never a measured fraction. The three cuts in the closed motif are a brand engraving,
  not an audit mark, privacy score or proof. Motifs are decorative to assistive technology;
  their adjacent text supplies the meaning.
- Asset summaries distinguish privacy from existing availability and sync states. SOL ready
  states say **Amount hidden · payee public**; absent/error states use a neutral unknown mark.
  SOL and USDC headings no longer assert shielding for unsupported accounts.
- Zcash receive, transaction review and payment details expose network, public metadata and
  who can read wallet history. Mismatched/unreadable reviews remain **Privacy not verified**.
  Received ZEC activity carries a shielded label beside its existing confirmation state.
- Solana receive, public fee funds, Add SOL, private-send and public-withdrawal forms, and checked
  payment reviews carry explicit exposure notices. Existing prover, service, funding, explorer,
  address-copy and safety disclosures remain in place, with existing text selectors preserved.
- Small-screen asset amounts receive a full-width row. All styles use current palette tokens,
  work without transparency, and add no motion or network requests.

## Verification

Tests run on an isolated copy of `4cd81df` plus only this task's privacy changes, because other
UI tasks edited and committed files in the same worktree during this task. Their source edits,
staging and screenshots are excluded from the privacy commit.

- Passed: `web/test/app.mjs`, `web/test/unified-setup.mjs`, `web/test/graph.mjs`,
  `web/test/overview.mjs`, `web/test/contrast.mjs`. The graph also loads a locked vault;
  theme checks cover dark/light text and control-edge contrast.
- Passed on the shared working copy: `web/test/sol-app.mjs` (Solana overview, secret storage,
  backup/restore and sync behavior).
- Passed: the full isolated `web/test/sol-pay.mjs` payment suite. Browser QA passed 36 baseline
  and 54 after checks (43 after screenshots); minimum privacy-text contrast was 13.91:1.
  PNG metadata was checked. Details: `privacy-tests.json` and the screenshot manifests.
- Source audit: 439 existing declarations outside 15 edited presentation functions are byte-for-byte
  unchanged; see `privacy-source-audit.json`.
- Scoped JavaScript lint passed for the privacy helper, touched presentation files and browser
  harness. Anonymous Git identity was checked before committing.

`solspike/tools/privacy_visual_browser.mjs` renders real presentation functions in fresh Chromium
contexts with synthetic data, blocks external requests, suppresses scheduled whole-wallet redraws
and disables wallet action buttons. Review data is an explicitly synthetic inspection fixture.
It does not create, approve, sign or send a payment. Before/after captures cover asset summaries,
ZEC receive, matched/mismatched ZEC review, SOL receive/deposit/send/withdrawal/review, and activity
at 390 and 1440 px in both themes. Additional checks cover unknown/error states, no fabricated
percentages, disclosure text contrast, keyboard recipient preservation, forced colours, 320 px,
200% privacy text and no privacy animation under reduced motion. All displayed addresses and
names are synthetic; no actual wallet, key, invite link or personal browser profile is captured.

Screenshot manifests: `privacy-before-validation.json`, `privacy-after-validation.json`.
Images: `visuals/privacy/before/` and `visuals/privacy/after/`. Representative comparisons:

- `visuals/privacy/{before,after}/assets-390-dark.png`
- `visuals/privacy/{before,after}/receive-390-light.png`
- `visuals/privacy/{before,after}/solana-1440-dark.png`
- `visuals/privacy/{before,after}/zec-review-mismatch-390-light.png`
- `visuals/privacy/after/privacy-text-200-percent-320-light.png`

## Limits / deferred work

No transparent ZEC support, USDC implementation, ratio analytics or new privacy guarantee was
added. See the existing deferred engineering review for those dependencies. A real live payment,
physical touch device, screen reader and live network/prover were not exercised by the visual
fixtures. The privacy browser checks also passed against the then-current combined UI candidate, as did
contrast and scoped lint. Full integration QA remains separate. Both the combined candidate and
its committed baseline fail module-list validation because `app.js` does not list existing
`outcome-seal.js` and `approval-visualization.js` imports; these unrelated declarations are
not added by this privacy commit. Existing sent-activity titles and state contracts remain authoritative;
this pass does not infer additional per-row privacy from unverified proposal display data.

Protected signing, custody, DKG, recovery, passkeys/authentication, encryption, routing, address
verification, amount/fee calculations and transaction semantics were untouched. No native paths,
backend, dependencies or wallet-state models were changed.
