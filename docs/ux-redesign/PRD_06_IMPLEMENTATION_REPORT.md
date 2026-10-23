# PRD 06 — Signature completion moments

22 October 2026. Web presentation only.

## Branch and reference

`codex/ux-navigation` was already checked out and exactly matched `codex/ux-ui-final`
at `4cd81dffac9c7f3a218ffb3c512ae301d22da164` before edits. The eventual merge target
remains `codex/ux-ui-final`. No merge, push, deployment or main-branch commit was performed.
Latest fetched technical reference: `origin/main` at
`3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.
Concurrent worktree edits and commits were preserved; this feature uses a separate Git index
so its commit includes only its own changes.

## Findings and implementation

Ranked defects: (1) threshold completion lacked a distinct visual outcome;
(2) submission and block inclusion needed clearer labels; (3) setup used a generic green
check; (4) pending and attention states needed equal visual care.

- `web/outcome-seal.js`: shared 44px satin-rim seal with an orange perimeter trace and
  stage-specific glyphs. Waiting/signing uses dots; attention uses an exclamation mark.
- `web/app-drawer.js`, `web/payment-model.js`: payment headline presentation uses the existing
  winning headline rule. Labels distinguish **Approval threshold reached**, **Transaction
  submitted**, and **Transaction in a block**. Existing explanatory copy and all rule precedence
  remain intact, including unsynced, refusal, expiry, uncertain-send and held-payment warnings.
  The added `stage` field is display metadata, not a new session state or authorization fact.
- `web/app-setup.js`: the existing verified prepared-wallet heading reuses the seal.
- `web/app.css`: solid, responsive panels; dark/light tokens; forced-colors fallback;
  visible text supplies meaning and decorative SVGs are hidden from assistive technology.

## Deferred and limitations

- Static final marks are intentional. No animation, timer, replay tracking, persistence or
  lifecycle behavior was added. Reduced motion is immediately meaningful and revisiting a
  completion cannot replay a seal animation.
- Main's existing evidence is synced block inclusion, not a new finality signal. No
  “Transaction confirmed” claim or submitted-to-confirmed conversion was added. A stale stop
  mark cannot override existing verified inclusion precedence.
- Separate Solana, credential/join, lock and recovery completion surfaces were not changed.
  Their exact outcome contracts need a dedicated presentation review before seal reuse.
- Browser evidence covers synthetic components, not a live transaction, full wallet flow,
  screen-reader session or manual touch/keyboard walkthrough. No controls or event handlers
  changed. Application regression tests cover the real drawer rendering and existing actions.

## Evidence and verification

Before/after captures were generated against an isolated copy of `4cd81df` plus this feature
patch, excluding other uncommitted edits. No wallet runtime, accounts, funds, credentials,
addresses or network services were used. PNG metadata was checked.

Screenshot paths (relative to this report):

- `visuals/signature-completion/before/{dark,light}-{1440,390}.png`
- `visuals/signature-completion/after/{dark,light}-{1440,390}.png`
- `visuals/signature-completion/{before,after}/validation.json`

The screenshot matrix uses ten explicit synthetic states. Automated layout checks also cover
320px, 200% text and long strings; after-change checks pass without horizontal overflow.
Forced colors retains the seal outline; reduced and normal motion have no running seal
animation. Dark desktop and light phone images were manually inspected, along with the
before desktop comparison.

Passed: `node web/test/outcome-seal.mjs`, `node web/test/payment-model.mjs`,
`node web/test/approvals.mjs` (3,584 fact combinations), `node web/test/guided-setup.mjs`,
`node web/test/premium-motion.mjs` (15 tests), `node web/test/contrast.mjs`, and the
before/after `solspike/tools/signature_completion_browser.mjs` matrix (six viewport/theme
combinations per phase). Full `node web/test/app.mjs` passed in both the working tree and the isolated feature copy.

Protected cryptography, signing, custody, DKG, recovery, authentication, encryption,
network routing, transaction calculations, recipient checks and business-state transitions
were untouched. Native code was untouched. No external decorative assets or fonts were added.
