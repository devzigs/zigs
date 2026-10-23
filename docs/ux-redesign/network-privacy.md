# Network privacy: web audit and design preview

Date: 23 October 2026. Branch: `codex/privacy`.

**This is a static source audit and a synthetic UX preview. Tor is not implemented.**
The newest [landing-page popup](network-privacy-popup.md) opens automatically over the original
app and completes the mocked connection inside a compact dialog, with a zebra camouflage sequence
before the ready message. A global **Tor Protected · Preview** status keeps Preview visible,
with direct-traffic disclosure in its tooltip and popup. Closing before
completion requires an explicit no-Tor warning confirmation. This supersedes the earlier full-page
demo and menu-only presentation.
Existing app startup and direct networking continue unchanged behind the popup.

The user selected web audit + design and an isolated interactive preview for the supplied
*Integrated Network Privacy* PRD v1.0. Production networking, wallet behavior, cryptographic
protocols and recovery formats remain unchanged. Native implementation and planning, gateway
deployment, merging and release are outside this pass.

## Review references and method

- Privacy branch base: `be093fdc028f441c8d4d3791baf577e3985c38c9`.
- Latest locally fetched main reviewed: `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`
  (20 October 2026). No remote refresh was performed; this is not a claim about current remote HEAD.
  Main has the same immediate `loadEngine()` → `startUp()` sequence and Zcash transport dependency
  described below. UI-branch features are not proof of main capabilities.
- Compared with that main reference, the relay shim, chain transport, ZNS resolver, server
  routing/CSP, Solana worker, local prover and SDK/prover build pins are unchanged. The branch
  adds UI imports, guided-status watchers, recipient-selection glue, stricter local account-copy
  cleanup and Overview-triggered Solana balance observation. These are not private transports;
  the Overview sync trigger is an additional background entry point to gate.
- Source inspection covered the web entry/import graph, request constructors, WASM networking,
  relay shim, worker adapters, server routing/CSP, asset URLs and pinned SDK build declarations.
  No live RPC, wallet, registry, Tor gateway or transaction request was made. No dependency was installed.
- `wasm/Cargo.lock`: `tonic-web-wasm-client` **0.9.2**, `tonic` **0.14.6**,
  `wasm-bindgen` **0.2.129**, `web-sys` **0.3.106**.
- Solana SDK source pin in `solspike/build.mjs`:
  `c232da1bd6748628b56bb8c277bcffbaaf2b0774`.
  Prover source pin in `solspike/build-prover.mjs`:
  `25b694a92a2c3250724e95ec405bc86bc05bfa83`.
  These identify intended source versions; a reproducible rebuild and verification of every
  shipped binary were not performed in this audit.

## Outbound dependency inventory

Source paths are repository-relative. Same-origin requests expose the connecting IP to the
website operator. Relay encryption does not hide group URLs, connection lifetime, size or timing.
Do not assume that viewing keys or signing shares are transmitted merely because a service syncs notes.

| Request owner and trigger | Destination / transport today | Exposure | Required private integration |
| --- | --- | --- | --- |
| `web/index.html`, `web/app.js`, CSS imports, module/WASM preloads; initial navigation | Website-origin HTTPS: HTML, JS, CSS, WASM, local fonts, logo/art | Host sees IP, headers, session metadata and timing before embedded Tor could run | Explicit initial-load exception; reviewed first-party assets without wallet URL parameters; module evaluation must not start wallet requests |
| `cf/src/gate.js` preview-deployment access control on every request | HTTPS Basic authentication or HttpOnly session cookie; same-origin gate before asset/service routes | Host sees IP and access session; reusing identity across modes can correlate visits | Tor HTTP must preserve reviewed access-control semantics without exposing credentials to gateways or bypassing authentication; browser cookie/Basic state is not automatically available to WASM HTTP |
| Production server injects `web/shim.js`; `web/app-groups.js:boot()` joins saved wallets/chats and follows invitations | Native WebSocket/WSS to same-origin `/ws?g=<group>`, Cloudflare Durable Object per group | IP, group ID, encrypted document envelopes, size/timing; server uses IP socket tags for limits | Real duplex Tor adapter or separately approved relay protocol adaptation preserving ordering, authentication, snapshots, acknowledgements and group isolation |
| `web/shim.js:probeRefusal()` and socket reconnect timers | Direct HTTP(S) refusal probe on the group URL and repeated WebSocket opens | IP/group ID even during outages | Route probes/retries too; suppress stale reconnect callbacks after switching |
| `web/app-chain.js`, `wasm/src/chain.rs:client()`; height, tree state, block sync, memo/transaction reads and broadcast | WASM `tonic-web-wasm-client` gRPC-web to same-origin `/lwd` and configured ChainSafe testnet/mainnet endpoints | Block/query ranges, requested transaction IDs, transaction bytes and timing; directly contacted service sees IP | Adapt actual WASM transport, streaming/binary framing, status/trailers, aborts and deadlines; page-level fetch replacement is insufficient evidence |
| `cf/src/index.js:lwd()` permitted-method proxy | Server → `https://lwd.zigs.app`, with server credentials | Host sees client requests; upstream sees proxy IP/request content | Audit both legs; client must reach host over Tor. Server proxying alone does not hide client IP from host; preserve method/size limits |
| `web/app-account.js:startAccount()`; saved personal messaging account startup | Same Zcash chain paths, independent of group relay | Account query patterns and transaction submissions | Gate personal-account startup as well as shared-wallet sync |
| `web/app-chain.js` interval/focus/visibility listeners; `web/app-loop.js` reactors and watched sessions | Existing chain and relay paths; automatic sync/protocol work | Background traffic correlated with wallet activity | Gate producers, async re-entry, workers and actual transport; screen hiding is not enforcement |
| `web/app-sol.js:solServed()`, failure probes, `web/sol/session.js:fetchRpcUrl()` | Direct same-origin `/sol/config.json` fetch; returns Helius URL held in memory | IP and capability-query timing; configured URL contains a credential | Include config/discovery probes in policy, not just payments; never log/persist the credential-bearing URL |
| `web/sol/session.js` checks worker-response CSP; `web/sol/client.js` launches worker | Same-origin worker, SDK modules, hasher WASM and Solana WASM | Feature use/asset timing | Classify wallet-triggered assets separately from static shell; retain policy and secret-boundary checks |
| `web/sol/worker.js:guardedFetch()` / `sdkFetch()`; sync, history, account, witness, nonce, simulation, send, confirm, pool checks | SDK-injected fetch to configured `https://devnet.helius-rpc.com`; origin guard and redirect refusal | IP, account/transaction identifiers, transaction bytes, timing; hosted proof inputs when existing consent/gates allow | Inject private transport inside worker; preserve URL/schema checks, redaction and local-proof latch; audit pinned SDK for bypass constructors |
| `web/sol/localprover.js`, nested prover; local-proof self-test and payment proofs | Same-origin prover JS/WASM/self-test; guarded key GETs in CloudFront `/proving-keys/3a1c88f90f609eb1/` | CDN sees IP and circuit/key requests; local proving keeps full witness off hosted prover | Tor-route key/resources or stage verified local copies; preserve digests and proof verification; no circuit/thread changes as shortcuts |
| `web/zns.js` name resolver | Same-origin `/zns`; server retrieves `https://light.zcash.me/zns-testnet` registry | Host sees IP/lookup timing; current whole-registry fetch does not send entered name upstream | Route registry retrieval, account for cache/upstream leg, preserve signature/timeout checks |
| User opens explorer, faucet, About or chat link | Zcash explorer/faucet hosts from `app-chain.js`; Solana explorer/faucet from `sol/payview.js`; `zigs.app` or user-supplied URL | New ordinary tab may expose direct IP and URL identifiers, including transaction IDs | Disclose external-navigation boundary; embedded fetch does not protect another tab. No automatic external previews/images in Private |
| `web/app-messages.js` optional alerts | Browser `Notification` API while app is open | Notification text may appear in OS UI | No remote push subscription found in inspected production modules; OS/remote delivery needs separate review before coverage claims |
| Prices, metadata/images, fonts, avatars, analytics | No portfolio price integration found; local fonts/icons/art and generated SVG/QR; no analytics/service-worker registration found in inspected entry graph | Local initial assets still expose IP; SVG namespace strings are not outbound requests | Keep assets first-party; inventory future price/metadata services. Static absence findings are not independent production leak tests |

### Startup and resume gaps

1. Initial resources and the server-injected shim load before the app runs. `web/app.js` invokes
   `adoptInviteKey()`, `draw()` and `loadEngine()` without a connection preference gate.
2. If the vault is unlocked, engine completion calls `startUp()`. Its `boot()` joins saved groups
   and chats; `rereadPersonal()` followed by `startAccount()` can sync a personal account.
   Keystore unlock also reaches `boot()`. There is no centralized Tor choice/readiness gate.
3. Create-dialog rendering can call `solServed()` before wallet creation. It is a capability
   query, not a wallet-identifier request, but must still have an explicit routing policy.
4. Chain timers, tab focus/visibility, reactors, relay retries and Solana automatic sync can send
   subsequent requests without a new click. Gate these producers and their lower-level transports;
   route ownership must extend across page, WASM and worker boundaries.

## Browser Tor feasibility and proposed engineering responsibilities

The web app is ES modules plus Rust/WASM and isolated workers, not one framework HTTP client.
An ESM/WASM candidate is structurally plausible; compatibility remains unproven. The upstream
[tor-js manifest](https://raw.githubusercontent.com/ethereum/tor-js/main/package.json) reported
**0.4.3** during review. This mutable upstream reference is not a selected or installed dependency.
Pin and review an exact source commit, lockfile and reproducible artifacts before a POC.

The [candidate README](https://github.com/ethereum/tor-js) labels it experimental and describes
an Arti/WASM HTTP interface, browser gateways, self-hosted WASM loading, cached state and gateway
redundancy. Its default entry uses a CDN; that loading choice is not approved here. Upstream
capabilities do not establish Zigs compatibility or release readiness.

Tor Project's [Arti FAQ](https://arti.torproject.org/FAQs/) describes embeddable Rust client
support, but does not certify this wrapper. Review the candidate and its
[gateway protocol](https://github.com/ethereum/tor-js/blob/main/PROTOCOL.md) at the same pinned
revision; evolving examples must not be assumed to share one stable wire contract.

| Concern | Required engineering evidence |
| --- | --- |
| Relay duplex transport | HTTP fetch support is not native WebSocket support. Prove bidirectional semantics or obtain approval for a protocol adaptation; never silently use direct sockets |
| gRPC-web/WASM | Prove framing, streamed response/backpressure, status/trailers, cancellation and deadlines at the pinned client version; adapter changes require separate engineering scope |
| Solana/proving | Prove SDK fetch/abort/Response compatibility with no bypasses; preserve consent, origin validation, worker schema and the one-way local-proving latch |
| Worker/CSP | Page, Solana and nested prover policies differ. Review a narrow gateway/Tor-worker policy; do not broaden all origins or remove exact worker-policy checks. Existing local prover uses `threads: 0`; isolation/thread compatibility is unproven |
| Authentication/rate limits | Current preview gate uses Basic/HttpOnly cookies and the relay limits by connecting IP. Prove authenticated Tor HTTP/duplex access without copying inaccessible cookies or weakening gates; test shared Tor exit-IP rate limits and identity correlation |
| Gateway operations | Reviewed operators, redundant endpoints, identity pinning, rotation overlap/revocation, bootstrap verification and outage behavior. Assess independent operators; demo gateways are not approved |
| WebRTC and DNS | Audit actual gateway bootstrap, ICE/STUN/TURN and name resolution across browsers, IPv4/IPv6 and failures. Explicitly bound bootstrap exceptions. Private wallet destinations must not use direct browser DNS; static inspection cannot prove this |
| Status accuracy | Bootstrap readiness alone does not prove all required wallet services work. Connected needs verified transport events and supported-service checks, retaining meaningful outage distinctions |

**Proposed `zigs-network` responsibilities — no public API is implemented here:**

- Load per-browser preference before constructing wallet clients. Missing/unreadable preferences
  ask again; selected mode is not readiness. Keep cached non-sensitive display separate from network access.
- Own mode, observed transport state, pending switch, endpoint capability checks and status
  subscriptions. Production presentation consumes verified events rather than time/animation.
- Provide request/stream routing across page, WASM and workers. Classify initial static assets,
  gateway bootstrap, sensitive wallet requests and explicit external navigation; unsupported
  Private paths are blocked, with useful recovery actions.
- Pause new operations; drain/cancel only where safe; retire old transport; validate the replacement
  before resuming. Suppress stale reconnects/callbacks. Never automatically downgrade or resubmit
  an ambiguously broadcast transaction.
- Defer switching during DKG, signing and broadcast to reviewed protocol boundaries. The fixture's
  “Show safe point” is not such a mechanism. Engineering must prove nonce, lease and submission safety.
- Redact connection diagnostics without shares, keys, passphrases, witnesses, wallet identifiers
  or credential-bearing URLs. No wallet/backup schema migration is proposed; eventual preference
  storage and corruption handling need their own reviewed design.

## Interactive preview

From the repository root:

```sh
node solspike/tools/network_privacy_preview.mjs
```

Open [the local preview](http://127.0.0.1:4178/dev/network-privacy/).
Set `PRIVACY_PREVIEW_PORT` to change the port. The loopback-only static server accepts only an
explicit asset allowlist, rejects wallet/service paths and does not boot the production server.

- Welcome → choice → establishment → illustrative dashboard. Private is initially selected;
  Standard proceeds directly. No network transport is initialized.
- Scenario controls cover every PRD status, Private/Standard returning preferences, unreadable
  preference, and unavailable transport. Milestones advance only through explicit review controls.
- Header and Settings → Privacy & Network share one panel. Standard requires a second explicit
  confirmation; cancel/Escape retains the mode. Failure offers retry without automatic fallback.
- Formation/signing/broadcast scenarios defer switches and preserve current mode. “Show safe
  point” manually starts the illustrative switch without aborting, resuming or submitting anything.
- No wallet imports, storage access, workers or service calls. Choices/themes stay in tab memory
  and reset on reload. Persistent page and modal notices identify every state as design-only.
- Disclosures explain website/gateway IP exposure, browser fingerprinting, identity/accounts,
  compromised devices, public chain data and timing correlation; network and transaction privacy
  are separate. No Tor Browser-equivalence claim is made.
- Existing design tokens, local Geist and unchanged canonical logo are reused in light/dark
  responsive layouts. No remote images, generated artwork or new runtime dependency is included.

## PRD coverage and release gates

“Represented” means a design scenario, not functioning wallet networking.

| PRD | Delivered in this pass | Deferred to separately approved engineering |
| --- | --- | --- |
| §§1–2: mode choice/onboarding | Represented: welcome, recommended Private, accessible Standard and supplied copy | Working transports and actual pre-network gate |
| §3: establishment/failure | Represented: milestones, retry and downgrade confirmation | Real circuits, service checks and recovery |
| §4: returning users | Represented: both saved-mode scenarios and missing preference | Durable preference loading and safe startup |
| §§5–6: indicator/settings/switching | Represented: all statuses, shared controls, confirmation/deferred switch | Live observed state, transport draining and proven transaction-safe switching |
| §§7–8: architecture/web | Audited: request owners, versions, gateway/transport gaps, manager responsibilities | POC, selected dependencies, central manager, gateway deployment |
| §9: native | Outside this web-only pass | Separate authorization; no native planning performed |
| §§10–11: coverage/security | Audited: direct paths and exposure; preview isolation checked | Independent production leakage/DNS/WebRTC verification and fail-closed enforcement |
| §12: acceptance | Preview usability/isolation tested as described below | Both functional modes, persistence, circuits, full routing, protocol/regression tests and security approval |
| §§13–14: phases/definition of done | Audit/design increment for review | POC → engineering design → migration → independent verification → controlled rollout |

Production release requires approved engineering scope; pinned/reviewed artifacts and gateways;
proven WebSocket, streaming gRPC-web and SDK compatibility; full routing with independent
direct-traffic/DNS/WebRTC tests; failure/reconnect coverage; DKG/FROST/broadcast safety;
creation/import/recovery/passkey regression checks; browser performance/accessibility validation;
and security engineering approval. Advertise only passing platforms. This preview establishes
no circuit, anonymity, production leakage-prevention or transaction-safety claim.

## Validation evidence

Run `node solspike/tools/network_privacy_browser.mjs` with Playwright available. Existing tool
conventions accept `PLAYWRIGHT_MODULE` and `CHROME_EXECUTABLE`. `PRIVACY_BROWSER` selects
`chromium`, `firefox` or `webkit` when installed. The script installs nothing.

Checks reject every request outside the exact static asset allowlist. Before preview code,
instrumentation records fetch, socket/XHR, WebRTC, worker/service-worker, beacon, storage,
cookie and cache attempts. CSP violations and browser errors fail the run. Attempts count even
when their exception is caught; blocking traffic alone is not considered absence of an attempt.

Behavior checks cover both onboarding choices, all statuses, returns, retry, cancelled/confirmed
switches, deferred safe points, radio arrow keys, modal focus containment/restoration and live
regions. Layout/text contrast cover light/dark at 390px/1440px, reduced motion, 200% CSS zoom
and desktop half-width reflow. CSS zoom is a reproducible enlargement check, not a claim of
testing every browser's native zoom or completing a screen-reader audit.

Results and representative screenshots are in [`visuals/network-privacy/`](visuals/network-privacy/).
`qa-chromium.json` records exact passed assertions and asset paths. Additional engine reports
are recorded separately when available. All evidence uses synthetic state only.
Screenshots are captured in Chromium. WebKit runs the same behavior/isolation checks without
screenshots because Playwright's WebKit capture shim injects an inline style that violates this
preview's CSP; the test does not relax CSP or discard those violations.

Verified results: **134 checks passed in Chromium and 134 in WebKit**, with no attempted
service networking, wallet-storage access, worker/WebRTC construction, CSP violations or
browser errors. Both requested only the seven first-party static assets listed in their reports.
Firefox is not installed in the available runtime and was not tested.
