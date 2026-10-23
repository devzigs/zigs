# Wallet marble integration

Implemented on `codex/ux-ui-final`, 22 October 2026. The user approved connecting the existing
artwork preview to the web application and chose to reveal it after device setup, once the
verified address exists. Main reference remains `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`;
the remote retry failed DNS. No technical implementation was merged.

## Experience

Create wallet still opens the private device invitation. Every device joins, compares all
30 digits, acknowledges the match and completes the existing key/address preparation.
After the existing requested-chain preparation checks finish, a six-second sequence writes
illustrative artwork code, draws it inward and reveals the wallet's metallic marble with
**Meet your new wallet**. The scene is CSS over one static rendered image, with no 3D loop.

Continue to backup options is usable immediately. It opens the existing
optional backup screen; animation, hashing, image decoding and GPU availability never grant
or hold readiness. Save and exit remains available. Backups, optional file checks, naming
and Overview continuation keep their existing actions and safeguards. Partial Zcash recovery
access during a Solana outage stays in the existing preparation flow.

The latest reveal refinement removes the redundant Skip animation action and slows both
the typed-code cadence and code-to-marble transformation. Continue remains the sole scene
action and retains its existing callback.

The reveal resumes its original elapsed time across live redraws. Reduced motion shows the
settled artwork immediately. Hiding the document settles the effect, and returning does not
replay it. Dismissal is remembered only in the current document; no seen flag is persisted.
Reopening the same completed guide in that document does not reintroduce the scene.

## Artwork placement

| Location | Presentation |
| --- | --- |
| Completion reveal | 192px scene using the same 192px image; shape/metal and applicable Ember inlay label |
| Guided wallet/device status | 48px image after existing local address verification; neutral placeholder earlier |
| Sidebar, collection and wallet switcher | Compact 32px images; switching selects the corresponding wallet's artwork |
| Wallet heading | 48px image, or the switcher's 32px image |
| Overview | 64px identity image beside the existing balance summary |
| Zcash Receive | 96px image; the actual address, encoder, copy/share controls and warnings are unchanged |
| Solana tools / Receive destination | The same Zcash-derived 96px wallet image with explicit Solana Devnet labeling; existing shielded destination and fee/program address distinctions remain |

Signer devices keep their existing initials and device marks. Wallet art does not replace
their identities or act as an address/safety-code check. Names, device labels and Solana
metadata do not affect the seed. Two wallets with identical names still have different
artwork when their verified public addresses differ.

## Boundaries and implementation

`app-wallet-art.js` reads existing local verification results and passes only the public Zcash
address, explicit network and verified display fact to `wallet-art.js`. Inactive wallet images
require the existing saved local check to match their current wallet document. Missing,
unverified, changed or unsupported inputs retain a neutral placeholder.

The original SHA-256 identity contract, renderer, six sculpture families, metal finishes and
approximately 5% Ember inlay classification are reused. Shared library files remain under
`web/dev/metal-orbs`; production imports none of the development fixtures or walkthrough controls.
No new dependency is added. The existing versioned public-image cache stores only digest keys
and PNG data, independently of wallet/key storage. The wrapper bounds its in-memory entries
to 96 and prepares deterministic SVG before requesting a PNG. Disconnected image consumers
do not start rendering. WebGL/cache failure keeps SVG; hashing failure leaves a neutral image.

No backend, wallet schema, key handling, authentication, consent, ceremony, signing, backup
format or native application changed. No new technical deferral was necessary. Producing the
same final address-derived marble immediately at Create wallet remains impossible before the
existing multi-device ceremony produces that address; the approved later timing resolves it.

## Validation and evidence

The extended `solspike/tools/onboarding_refinement_browser.mjs` uses the actual local app and
served CSP with isolated unfunded browser stores. It repeats real 2-of-2 and 2-of-3 Zcash
formation, verifies identical images across participating devices, and creates two real wallets
with the same name to exercise the actual switcher and collection. It confirms no distinct
artwork/reveal before verification; redraw continuity; live reduced-motion and hidden-page
settling; working backup access with blocked image caching, unavailable WebGL and a deliberately
delayed renderer; and preservation of optional encrypted backup checks and naming continuation.

The responsive matrix includes 1366 × 768, 1440 × 900, 768 × 1024, 390 × 844 and 320 × 800
in both themes, plus forced colors and 200% text. Ordinary collapsed reveal and completion
screens retain visible desktop actions. Expanded details, long warnings and mobile content scroll.

Evidence is in [the browser report](onboarding-refinement-after-validation.json) and
`visuals/onboarding-refinement/after/`:

- [Code arriving](visuals/onboarding-refinement/after/13-marble-code.png)
- [Code becoming the marble](visuals/onboarding-refinement/after/13-marble-forming.png)
- [Meet your new wallet](visuals/onboarding-refinement/after/13-marble-revealed.png)
- [An actual rare-finish reveal from an isolated unfunded run](visuals/onboarding-refinement/after/13-marble-rare-revealed.png)
- [320px reveal](visuals/onboarding-refinement/after/13-wallet-marble-320-dark.png)
- [Actual wallet switcher](visuals/onboarding-refinement/after/15-marble-switcher.png)
- [Overview](visuals/onboarding-refinement/after/14-marble-overview.png)

Commands: `sh scripts/test-fast.sh`, `node web/test/app.mjs`,
`node web/test/unified-setup.mjs`, the focused browser runner, and
`node --test web/dev/metal-orbs/test/identity.test.mjs web/dev/metal-orbs/test/reveal.test.mjs`,
under Node 24.19.0. The independent qrencode comparison is skipped when that executable is
absent; the existing QR encoder/payload check still runs in the browser suite.

Passed: 423 focused browser assertions with 252 captures, 42 fast-suite scripts, the full
application and unified setup regressions, and 8 artwork identity/rarity/production-adapter tests.

Validation limits: automated production flow checks use Chromium and a virtual authenticator,
not physical devices. Existing cross-engine artwork-preview evidence remains identified as
preview coverage. GPU pixels may vary with rasterization; seeded geometry and SVG are
deterministic. No live Solana transactions were run. No merge, push or deployment was performed.
