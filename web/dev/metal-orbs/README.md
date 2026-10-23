# Metal Orb development preview

A public-address-only artwork library and development preview. The approved web integration on
`codex/ux-ui-final` now reuses the identity, fallback, cache, avatar image service and renderer
through `web/wallet-art.js`. Signer-device avatars retain their initials. The galleries and
simulated walkthrough remain isolated; production never imports their fixtures or controls.
See the [production integration report](../../../docs/ux-redesign/wallet-marble-integration.md).

## Wallet identity walkthrough

Open `http://127.0.0.1:8796/dev/metal-orbs/flow.html` for the interactive reveal, Overview,
wallet switcher and Receive preview. The collection links to it. This is a synthetic
simulation: no setup, recovery, network lookup, wallet mutation or payment operation runs.
The existing pure QR encoder is reused for a non-payment design marker only.

The 96px reveal appears after simulated address verification. “Open Overview” is usable
before hashing, rendering, decoding or animation finish. Recovery information remains optional.
A static image receives a 320ms opacity/scale transition once per identity per document;
revisiting, renaming, switching devices, or adding Solana does not replay it. Reduced motion
suppresses the transition. Nothing is persisted to remember a reveal.

`describeWalletIdentity({ zcash: { address, network, verified } })` is a presentation-only
adapter. It returns a descriptor only for a verified public Zcash address and explicit
mainnet/testnet network. It ignores names, viewing devices and Solana metadata. A missing or
unverified address uses a neutral placeholder. This helper never changes real verification,
readiness or tutorial state. The fixture controls outside the simulated app let reviewers
check these behaviors without invoking the application.

The same orb is shown at 32px in the switcher, 48px beside the wallet name, 64px in Overview
identity details and 96px in setup/Receive. Receive labels Zcash Testnet or Solana Devnet
independently of the primary Zcash-derived orb. Signer devices keep their own initials.

### Subtle rarity

`traits` contains `sculpture`, `metal`, `rare` and nullable `inlay`. The final two SHA-256
bytes, read as an unsigned big-endian integer, select Ember inlay when less than `3277`.
Exactly 3277 of 65536 suffix values qualify (approximately 5.0003%). No counters, random input,
reroll operation or wallet state are involved. The original seed contract is unchanged.

Rare orbs receive two closed, seeded orange metallic ribbons following the distorted surface.
The faceted family projects them onto the actual mesh; smooth families use the shared surface
function. SVG fallback draws two matching seeded seams as a simplified projection. All inlay
resources are disposed with the one-shot render. Cache version `metal-orb-v3` prevents old
PNGs from masking the treatment.

Rare setup displays “Ember inlay · Rare finish” and “A rare find.” Ordinary setup displays
only sculpture/metal labels. The approximately 5% frequency is explained inside “How it’s
made.” Rarity appears in reveal and identity details, not heading/switcher/Receive badges.
The preview includes explicitly selected ordinary and rare public-address fixtures; their
selection is not a population-frequency sample.

## Preview and implementation plan

1. **Review this preview:** 24 synthetic public Solana addresses, six sculptural families,
   all four requested sizes, an address inspector, SVG comparison and fresh-render checks.
2. **Tune after visual feedback:** freeze the approved geometry, finish, lighting and
   canonical identity contract. Changing the appearance requires a cache-version change.
3. **Approved and integrated:** production uses existing verified public Zcash address facts.
   Its reveal follows device verification and key/address preparation, rather than Create wallet,
   because the address does not exist at that earlier point. Existing `app-dom.js` avatars
   still identify signer devices. Missing/unverified addresses use a neutral placeholder.
   Fee/program addresses never substitute for the shared wallet's Zcash identity.
4. **Rollout validation limits:** physical phone browsers, older GPUs and low-memory devices
   remain outside automated certification. The actual served CSP is exercised locally. No native app changes. No rollout,
   merge or deployment is part of this experiment.

## Run

From the repository root:

```sh
python3 -m http.server 8796 --bind 127.0.0.1 --directory web
```

Open `http://127.0.0.1:8796/dev/metal-orbs/`. Use localhost or HTTPS so Web Crypto is
available. The included vendor bundle works without npm or external network requests.
There is no wallet/engine initialization, RPC, account lookup or real wallet fixture.

## Component

This application uses native DOM modules, not React. Introducing React/R3F would add an
unnecessary framework; the preview uses Three.js directly. `WalletAvatar` returns an image
node, preserving the application's existing presentation approach.

```js
import { WalletAvatar } from './avatar.js';
const avatar = WalletAvatar({
  chain: 'solana:devnet',
  address: publicAddress,
  size: 48, // 32 | 48 | 64 | 96
  label: 'Wallet avatar', // use '' beside an equivalent visible name
});
container.append(avatar);
// When removing a view, cancel outstanding component updates:
avatar.dispose();
```

Optional `eager: true` starts immediately. Otherwise intersection visibility triggers
image generation. `svgOnly: true` deliberately skips the PNG cache and renderer. `ready`
is a promise for completion of visible work. No animation loop or mounted canvas exists.
Loading reserves the exact image dimensions. Hash failures/unsupported input keep a neutral
placeholder and unavailable label; they never break surrounding presentation. Web Crypto
is required for unique SHA-256 identities, including SVG fallback identities.

## Modules and deterministic contract

| Module | Responsibility |
| --- | --- |
| `identity.js` | Canonical public identity, Web Crypto SHA-256, immutable descriptor and radial surface function |
| `fallback.js` | Self-contained SVG from the same descriptor and surface family |
| `renderer.js` | Fixed studio, bounded geometry, PBR metal, one-shot 192 × 192 PNG, disposal |
| `cache.js` | Separate IndexedDB public-image store plus bounded memory cache |
| `avatar.js` | Reusable component, lazy loading, deduplication, serialized render queue, failure handling |
| `fixtures.js`, `preview.*`, `index.html` | Removable gallery and public-address inspector |
| `wallet-identity.js` | Verified public Zcash display adapter and document-only reveal memory |
| `flow-fixtures.js`, `flow.*` | Removable synthetic wallet-identity walkthrough |

Seed input is the UTF-8 JSON tuple `[canonicalChain, canonicalPublicAddress]`. Explicit
framing prevents concatenation ambiguity. Seed = SHA-256 of this tuple. No time, device
pixel ratio, viewport, theme, runtime random input or external content affects the avatar.

- Chain identifiers are normalized to lowercase with surrounding whitespace removed.
- `eip155:<decimal>` normalizes the numeric ID and public hex address casing.
- Solana cluster identifiers are explicit; Base58 address casing is preserved.
- Zcash network identifiers are explicit. Known Bech32 address prefixes normalize all-upper
  to lowercase and reject mixed case; transparent Base58 casing is preserved.
- These are **display identity rules, not wallet address validation**. Production validation
  stays authoritative. The EVM inspector is a display demonstration, not new chain support.
- Unknown chains/invalid display shapes fail closed to an unavailable image state.

All 256 digest bits identify the cache entry. Digest bytes select geometry family, lobe
count, amplitude, frequency, phase, twist, orientation, squash, rings, facets, metal finish,
roughness and a restrained accent palette. Geometry varies independently of color. Surface
families are faceted, fluted, hammered, folded, orbital and scalloped. No secret material is
accepted or read, and no protocol cryptographic code is imported or modified.

The camera is fixed at `(0, .12, 4.85)` with 32° field of view. A procedural five-softbox
studio supplies reflections through Three.js PMREM; no HDR downloads or texture assets are
needed. Standard metallic materials use sRGB output and ACES tone mapping.
See the upstream [material](https://threejs.org/docs/pages/MeshStandardMaterial.html) and
[PMREM](https://threejs.org/docs/pages/PMREMGenerator.html) documentation for that pipeline.

## Mobile and cache behavior

- One 192px PNG serves 32/48/64/96 CSS pixels; resolution never depends on device DPR.
- One serialized studio is created only after an uncached visible request. Same-identity
  concurrent requests share a promise. Three.js is dynamically imported only on cache miss.
- Idle scheduling yields between identities; no `requestAnimationFrame` render loop.
- The studio releases geometry/materials per render and the context after 1.2 seconds idle.
- Cache key: `metal-orb-v3:<full SHA-256 hex>`. The version freezes this rendering contract.
- Cache namespace: `zigs-metal-orb-preview-v1`, object store `images`. Only digest-based keys
  and PNG data are stored; no raw addresses, wallet documents or private material.
- Memory and persistent caches each hold at most 96 images. Individual stored images are
  capped below 180 KB. Memory uses LRU; persistent eviction uses deterministic key order.
- Storage errors fall back to memory. WebGL2 failure, a major performance caveat, context
  loss or PNG export failure uses SVG. Cached PNGs remain usable without WebGL.
- SVG remains a simplified representation, not a pixel match for the 3D PNG.

## Dependency and removal

Only Three.js `0.180.0` was added, scoped to this directory with a lockfile and MIT license.
The tree-shaken local bundle is about 492 KB / 124 KB gzip. The approved production integration
loads it lazily on an uncached artwork request; warm images do not need it. Existing esbuild
from `solspike` builds the vendor module; no new build tool.

To rebuild, run from this directory (after installing the repository's existing solspike
dev dependencies if needed):

```sh
npm ci --ignore-scripts
npm run build
npm test
```

The gallery (`index.html`, `preview.*`, `fixtures.js`) and simulated walkthrough (`flow.*`,
`flow-fixtures.js`) can be removed independently. Keep the shared `identity.js`,
`wallet-identity.js`, `fallback.js`, `avatar.js`, `cache.js`, `renderer.js` and `vendor/` files:
production now depends on them. Development pages are not linked from production UI.
No deployment is authorized here.

## Browser verification

`npm test` checks the independent hash contract, case/network separation, malformed inputs,
24 unique SVGs and geometric signatures, all six families, bounded radii and repeatability.
It also exhaustively checks the rarity boundary across all 65536 suffixes, the paired SVG
inlay, ordinary/rare fixture metadata, public-Zcash-only identity derivation and reveal memory.

`test/browser.mjs` runs against an already available Playwright and pngjs installation.
These are QA tools, not preview dependencies. Set `ORB_PLAYWRIGHT_MODULE` and
`ORB_PNG_MODULE` to their module paths if they are not resolvable, and optionally
`ORB_FIREFOX_EXECUTABLE` to include Firefox. `ORB_PREVIEW_URL` selects the running preview;
`ORB_ARTIFACT_DIR` selects output, defaulting to `/tmp/zigs-metal-orb-qa`.

`test/flow-browser.mjs` uses the same QA environment variables and tests the interactive
walkthrough across the available engines. It checks every avatar placement/size, genuine
rendered inlay pixels, rare-copy placement, identity consistency, once-per-document reveal,
reduced motion, mobile layout, unavailable WebGL/storage, and usable navigation during a
delayed renderer request. It writes `flow-report.json` and screenshots to the selected
artifact directory (default `/tmp/zigs-orb-reveal-qa`).

The gallery harness checks fresh studios, all four sizes sharing an image, transparent nonempty
192px output, warm cache with no renderer download, no-WebGL plus blocked storage, context
loss, cache eviction, malformed inspector input, and 1440/390/320px layouts. It also compares
seed descriptors, quantized surfaces, SVG source and decoded PNGs across engines.

Repeatable parameters and SVG source are exact across tested engines. PNGs repeat exactly
within each tested browser on this machine. GPU rasterization can differ across engines,
drivers and hardware: **universal byte-identical PNGs are not guaranteed**. If that becomes
an acceptance requirement, a canonical rasterization path must be designed before production
integration. The current preview verifies visual consistency with bounded pixel differences;
it does not silently substitute a different seed to conceal those differences.
