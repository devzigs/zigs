# Settings redesign

## Behavior inventory (before implementation)

Task baseline: `31e9c20`. Technical reference: latest fetched `origin/main`,
`3a6c08e`. This pass changes web presentation only.

| Existing control | Existing owner and behavior | Destination |
| --- | --- | --- |
| Appearance | `app-theme.js`: `zf-theme` in this browser, CSS follows system for `device` | General |
| Notifications | `toggleNotify` in `app-messages.js`: foreground message notifications, explicit browser permission, `zf-notify` | General, effective permission state |
| Incoming memos | `readsMemos` / `setMemoReading`: `zf-memos`, per wallet in this browser; opt-in fetches full transactions, cached memos remain | General, disclosure before enable |
| Description | `wallet-description.js`: explicit checked local save, 280 characters, outside vault and backups | Current wallet, collapsed inline editor |
| Address | `state.wallet.address`, existing `addrHidden` checks and cap gate, `copyBtn` copies canonical value | Current wallet, full address disclosure |
| Approval rule | `state.g.t/n`; enrolled seats and address checks are distinct from connectivity | Current wallet, separate accurate rows |
| Network | `curNet`, read-only; existing mainnet cap disclosure | Current wallet |
| Security management | Existing `recovery` destination | Security & Device, one navigation row |
| Browser lock/protection | `lockButton`: reload to lock verified vault, protect existing data otherwise, incomplete-vault refusal | Security & Device, existing control |
| Recovery import | `restore` in `app-backups.js` validates wallet-share or separate personal-account files | Security & Device, one file picker |
| Messaging account | `personalCard` preserves creation, network, funding, backup, removal and damaged/pending states | Compact Settings fallback |
| Replay guide | `beginGuided(gid, { replay: true })` changes separate tutorial progress; existing guide includes optional file checks | Help & Support, preserve existing flow |
| FAQs | `HELP` in `help-model.js`, entirely local | Help & Support, collapsed, every answer preserved |
| Diagnostics | `app-help.js`, fixed safe facts, explicit copy, no upload | Help & Support, separate disclosure |
| Technical facts | Birthday, group verifying key, ZIP 2005/version explanation, signed-write caveats, opt-in viewing key, local activity | Advanced, collapsed by default |
| Storage/network explanation | Existing privacy copy; actual testnet `/lwd` proxy and fallback in `app-chain.js` | Advanced, accurate provider explanation |

Expected implementation files: `web/app-wallet.js`, `web/app-shell.js`,
`web/app-settings-ui.js`, `web/app-theme.js`, `web/app-help.js`,
`web/help-model.js`, `web/app.js`, `web/settings-experience.css`, `web/index.html`.
Browser regression harness and evidence live alongside this report. No storage,
authentication, cryptography, account, recovery, signing or network implementation changes.

## Decisions

- Use native, keyboard-accessible inline disclosures for focused editing and memo
  consent. No new modal or routing system is needed.
- Keep the messaging account in a compact Settings disclosure. Chats currently
  delegates funding/backup here; moving its lifecycle would broaden this task.
- Keep the existing replay guide and label its actual scope; a purely read-only
  tutorial would require a separate reviewed workflow.
- Preserve the address visibility gate and all mainnet warnings.
- The testnet data provider normally sees the Zigs Worker IP; the Worker sees the
  browser IP. Direct/fallback providers see the browser IP. Describe both paths.

## Validation

- 52 browser interaction checks pass. Coverage includes explicit save/cancel, save and
  clipboard errors, per-wallet descriptions and addresses, theme persistence/System,
  denied/granted/unsupported/pending notifications, memo enable/cancel/disable, original
  FAQs and diagnostic copy, security routing, malformed recovery input, guide replay,
  mainnet address cap, unverified-signer address gate, and locked-state editor removal.
- Reviewed dark and light layouts at 320, 375, 390, 430, 768, 1280 and 1440px. No horizontal
  overflow. Desktop content is capped at 960px. Reduced motion and forced colors checked.
- At 390px the synthetic default page height falls from 4,712px to 2,449px. At 1440px it
  falls from 2,800px to 2,032px. All original functionality remains reachable.
- Page lint, harness lint, the 58-module import graph (including locked-vault startup), and
  Wrangler's build dry run pass. The fast suite passes 41 tests; its socket-based demo check
  timed out in the sandbox and passes all 19 subtests when rerun with localhost allowed.
  QR tests are skipped because `qrencode` is unavailable.
- A declaration/source audit confirms that only the listed Settings presentation
  declarations changed. Nineteen technical source modules, the existing lock control,
  diagnostic generators, recovery/account handlers and address gates are unchanged.
  Native paths remain identical to fetched main.

Evidence: [validation results](settings-validation.json), [source audit](settings-source-audit.json),
[desktop preview](visuals/settings-redesign/after/wallet-1440-dark.png),
[phone preview](visuals/settings-redesign/after/wallet-390-dark.png),
[memo consent](visuals/settings-redesign/after/memo-consent-390.png).

Run `node solspike/tools/settings_design_browser.mjs after` from the repository root;
`before` serves the original presentation from the baseline commit. The harness accepts
`PLAYWRIGHT_MODULE`, `CHROME_EXECUTABLE` and `SETTINGS_QA_DIR`. It uses a fresh browser
context, synthetic unfunded wallet data, blocks external requests and disables the wallet
reactor in the served test fixture. No production source is patched on disk. OS permission
outcomes are simulated. This does not replace real-device, assistive-technology or funded
wallet testing; no such tests or real credential/recovery operations were performed.

See the [technical follow-ups](ux-ui-final-technical-review.md) for the existing guide mode,
messaging placement and persistence limitations. No merge, push or deployment was performed.
