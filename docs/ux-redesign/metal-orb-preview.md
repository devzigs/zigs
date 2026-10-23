# Metal Orb and wallet identity reveal preview

Original development preview, 22 October 2026, created while the checkout used
`codex/ux-navigation`. The user subsequently approved production integration on
`codex/ux-ui-final`; see the [current implementation and evidence](wallet-marble-integration.md).
The walkthrough described below remains a synthetic preview. No native changes, merge or
deployment is included.
Main reference inspected: `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`; the preview imports no
wallet state, protocol or signing behavior.

## Review the experience

Open `http://127.0.0.1:8796/dev/metal-orbs/flow.html` while the local static server runs.
The [module contract and run instructions](../../web/dev/metal-orbs/README.md) describe the
implementation, cache behavior and removal. The original [24-address collection](../../web/dev/metal-orbs/index.html)
remains available and links to the walkthrough.

The walkthrough simulates the existing prepared-wallet outcome: a 96px orb, “Meet your
wallet,” its name and a short public-address explanation. “Open Overview” remains available
while hashing/rendering/decoding/animation is pending. Optional recovery details stay below
that action. An expandable “How it’s made” explains public SHA-256 derivation, local
rendering and the approximate rarity frequency.

The reveal uses a 320ms opacity/scale transition once per identity per document. It never
animates a 3D scene, persists a seen flag or changes any readiness state. Reduced motion
suppresses the transition. Reopening setup, renaming the wallet, changing the viewing device,
or adding/removing Solana preserves the identity and does not replay the reveal.

The same orb appears at 32px in the mock switcher, 48px in the wallet heading, 64px in the
Overview identity card, and 96px in Receive. Receive explicitly labels the asset and network;
Zcash Testnet and Solana Devnet reuse the primary Zcash-derived orb. Signer devices retain
initials. The reused pure QR encoder encodes a non-payment design marker, not an address or
payment URI. All fixtures are synthetic and non-payable.

“Preview controls,” outside the simulated app, demonstrate rename, a second viewing device,
Solana inclusion and address verification. No controls initialize an engine, connect an RPC,
run a ceremony, export a backup or access real wallets.

## Identity and rare finish

The presentation adapter accepts an explicit verified public Zcash address and mainnet/testnet
network. Names, device labels and Solana do not enter the seed. Unverified/missing addresses
show a neutral placeholder. This adapter does not modify real address verification.

Seed = SHA-256 of the canonical UTF-8 `[chain, publicAddress]` JSON tuple, unchanged from the
first preview. The final two digest bytes, interpreted as an unsigned big-endian integer,
select a rare finish when below `3277`. Exactly 3277 of 65536 suffixes qualify: approximately
5.0003%, described as approximately 5% or one in twenty generated identities.

Rare orbs get two seeded orange metallic seams following the distorted surface. The faceted
family projects seams onto the actual mesh. SVG fallback includes two simplified matching
seams. The renderer disposes all extra geometry/materials with each static image. Cache
version `metal-orb-v3` avoids stale images from before the inlay treatment.

Rare setup displays “Ember inlay · Rare finish” and “A rare find.” Other orbs show sculpture
and metal names without a common/low-tier label. Rarity remains in reveal and identity
details rather than switcher, header or Receive badges. There is no reroll, score, minting,
global-scarcity claim, random input or new persisted wallet state.

## Verification

Seven pure tests passed, including an exhaustive classification check across all 65536
suffixes, the threshold boundary, paired SVG seams, fixture authenticity, Zcash-only identity
selection and document-local reveal memory. Authored-source lint and whitespace checks passed.

| Engine | Version | Gallery fresh repeats | Flow fresh repeats | Interactive / mobile / failure checks |
| --- | --- | --- | --- | --- |
| Chromium / Chrome | 155.0.8059.85 | 24/24 exact | 3/3 exact | Passed |
| WebKit | 26.5 | 24/24 exact | 3/3 exact | Passed |
| Firefox | 153.0 | 24/24 exact | 3/3 exact | Passed |

The [walkthrough report](visuals/metal-orbs/flow-report.json) covers every size/placement,
rename/device/Solana consistency, switching wallets, no orb before verified state, genuine
inlay pixel changes, truthful/contextual rarity copy, a non-repeating reveal, reduced motion,
320/390px web layouts, WebGL plus storage failure, and usable navigation with a deliberately
delayed renderer. It observed zero external requests and page errors. Comparing the same
rare sculpture with/without inlay changed 956 pixels in Chromium/WebKit and 1002 in Firefox.

The [gallery report](visuals/metal-orbs/browser-report.json) confirms all 24 identities remain
distinct, all four sizes share one image, warm cache loads use zero renders/no renderer
download, context loss uses SVG, eviction holds the store at 96 images and studio disposal
leaves zero active contexts. It covers 1440/390/320px layouts and blocked-storage/no-WebGL
fallback to 24 unique SVGs.

Cross-engine descriptors and SVG source matched exactly. Surface samples rounded to six
decimals matched for all gallery fixtures. Chromium/WebKit PNG pixels matched on this
machine. Firefox's mean absolute RGBA-channel difference for the gallery was 0.2373 / 255;
the three walkthrough fixture means were 0.0876, 0.0006 and 0.5244 / 255. Edge-pixel differences
can be larger due to antialiasing.

**Universal byte-identical GPU PNGs are not guaranteed.** GPU, driver and browser rasterization
can vary. WebKit automation is engine coverage, not Safari application or physical-phone
certification. Physical mobile browser and older/low-memory GPU checks remain pre-rollout
work, after explicit production approval.

## Visual evidence

- [Ordinary setup reveal](visuals/metal-orbs/reveal-standard.png)
- [Ember inlay reveal](visuals/metal-orbs/reveal-rare.png)
- [Overview with identity details](visuals/metal-orbs/identity-overview.png)
- [Wallet switcher](visuals/metal-orbs/wallet-switcher.png)
- [Zcash Receive](visuals/metal-orbs/receive-zec.png) / [Solana Receive](visuals/metal-orbs/receive-sol.png)
- [320px reveal](visuals/metal-orbs/reveal-mobile-320.png) / [390px Receive](visuals/metal-orbs/receive-mobile-390.png)
- [SVG reveal](visuals/metal-orbs/reveal-svg.png)
- [Original 24-orb collection](visuals/metal-orbs/collection.png)

## Approval boundary

The original preview was isolated. Production integration is now explicitly approved and uses
the shared artwork modules with existing verified public Zcash addresses. The code-to-marble
reveal occurs after actual device/key/address preparation, as clarified by the user. Existing
`app-dom.js` signer-device avatars remain untouched. The original cross-engine results above
describe the preview, not a production or physical-device certification.
