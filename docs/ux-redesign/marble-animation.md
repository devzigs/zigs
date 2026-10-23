# Wallet marble spin

23 October 2026 · `codex/marble-animation`, based on `codex/ux-ui-final` at
`31e9c207d466a393d92eeffb91b03ff5922e687d`.
Latest fetched main reference: `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.
This change adds web presentation only; it introduces no wallet capability or engineering proposal.

## Presentation

The marble beside the wallet name is the existing seeded sculpture rendered in actual 3D.
It completes a slow turn every 28 seconds with a restrained change of tilt. The studio camera,
softboxes and key light remain fixed, so the surface and Ember inlays catch moving reflections.
The canvas occupies a reserved 64px box (52px on small screens); the header does not move.
The balance summary and wallet picker retain static images of the same public-address identity.

Click the marble, or focus it and press Enter/Space, to pause or resume at its current angle.
The small control appears on hover/focus, while paused, and on touch screens. Its accessible
label describes the current action. The pause preference lasts for this document and survives
ordinary redraws and wallet changes without entering wallet storage.

One live studio belongs to the visible wallet header. Its canvas and current rotation survive
ordinary DOM replacement. Rendering is capped at 30fps, stops while hidden, offscreen or behind
a modal, and resumes without catching up elapsed background time. Changing wallets disposes
the previous studio and constructs that wallet's sculpture. Leaving the wallet or page releases
the live GPU resources. Async preparation checks that its requested identity is still current.

Reduced motion keeps a settled image and disables the motion control. Forced colors uses
the static identity. Unsupported WebGL or context loss restores static artwork; unavailable
hashing or unverified wallet inputs keep a neutral placeholder. None of these delays controls.

## Implementation boundaries

`app-wallet-marble.js` reads the existing local address-verification result. It passes only
the verified public Zcash address and network into the artwork wrapper. Wallet names, device
names and Solana metadata do not affect the image. No keys, signatures, address-verification
rules, recovery formats, authentication, balances, payment gates or backend calls were changed.

The branch's committed base did not include the in-progress production artwork wrapper.
`wallet-art.js` reuses that public-input wrapper from the UX/UI checkout, with a small image
binding helper for lint compliance. Other uncommitted UX/UI work remains in its original checkout.
The shared studio now exposes a retained sculpture and frame draw alongside its existing
one-shot PNG render. Identity seeds, geometry, finishes, static cache keys and dependencies stay
the same. Production imports no development fixtures; only the isolated browser harness does.

## Validation

- 42 browser assertions: real changing 3D pixels; pause/resume and redraw continuity; reduced
  motion; visibility, offscreen and modal lifecycles; wallet switching; all six sculpture
  families; Ember identity; context loss and unavailable WebGL; unverified-address placeholders.
- Dark/light captures at 1440, 768, 390 and 320px, with no horizontal overflow and a motion
  target of at least 44px. Evidence: `visuals/marble-animation/validation.json` and its captures.
- 42 existing fast-suite scripts passed using Node 24.19.0. The independent `qrencode` check
  was skipped because its executable is unavailable. The module graph passed in ordinary
  and locked-vault states. The full application regression (`web/test/app.mjs`) passed.
- Seven existing artwork identity/rarity tests passed. Page-module lint and strict lint for
  the new browser harness and public artwork/motion modules passed. `git diff --check` passed.
- The existing unified-setup regression fails its old Solana approval-card text expectation
  at line 227. The identical failure reproduced from an unchanged archive of the branch base
  using Node 24.19.0. Full repository lint also reports existing errors in unchanged browser
  tools and `web/sol/payview.js`; this change does not edit those files.

Browser evidence uses synthetic public display fixtures in Chromium, without live funds,
wallet creation or signing. GPU pixels can vary across drivers. No native paths were changed.
No push or deployment was performed.

## UX/UI integration

The user explicitly authorized merging into `codex/ux-ui-final` on 23 October 2026.
The merge continues the newer Overview and Activity work at `0be360d`, retains their
layout and valuation presentation, and adds the rotating header sculpture. The existing
uncommitted onboarding, navigation and wallet-reveal work is preserved separately from
the merge commit. The small-screen header stays flex-based when the reveal stylesheet
is also present, keeping the marble clear of the wallet name.

## Local review

Run `node solspike/tools/wallet_marble_browser.mjs --preview` and open
`http://127.0.0.1:8798`. This serves the production wallet presentation with three synthetic
wallet identities. Use the wallet picker and the marble's motion control to review the effect.
Run the same script without `--preview` to execute the browser assertions; provide an existing
Playwright installation via `PLAYWRIGHT_MODULE` and Chrome via `CHROME_EXECUTABLE` if needed.
