# How Zigs works: complete web guide

Branch: `codex/how-zigs-work`, based on `codex/ux-ui-final` at `bdd7403`.

The homepage's existing **How Zigs works** disclosure now contains ten independently
navigable chapters, approximately 7,400 words including captions and navigation:

1. The basics: wallets, seats, thresholds, components and release status.
2. Key generation: invite secrets, seat keys, safety numbers, FROST DKG, address verification
   and the qualified ZIP 2005 quantum-recovery model.
3. Your device: browser storage, passkey encryption, explicit Skip, compromise and nonces.
4. Receiving: notes, local scanning, confirmations, memos, rescanning and public names.
5. Payments: PCZT inspection, approved digest, signing, proofs, fees, expiry and cancellation.
6. Privacy: visibility by observer, encrypted fields, metadata, leaked links and availability.
7. Solana: fee funds, group PDA, public identifiers, hosted/local proofs and external authorities.
8. Messaging: rooms, payment discussions, direct chats, memos and the personal on-chain account.
9. Recovery: backup contents/encryption, verification, restore and replacement wallets.
10. Trust and terms: assumptions, failure scenarios and a fourteen-term glossary.

## Presentation

- Sticky top chapter navigation, roving tab focus, Left/Right/Home/End keys and previous/next
  controls. Navigation does not use URL fragments, which the wallet already uses for links.
- One topic-specific animated SVG on the left and the explanation on the right on desktop.
  The figure stays alongside the explanation during reading. Narrow screens stack the content.
- A persistent release and chain-privacy note stays available across every chapter.
- Illustrations use synthetic examples; no real keys or transaction state enter the guide.
- Pause/Play affects the illustrations and explanatory stage highlights. Reduced-motion
  preferences disable animations; forced-colors mode preserves the diagrams and selected tab.
- Reading state is held only in the current document. The component retains its DOM subtree
  across unrelated app renders, preserving the chosen chapter, focus and pause state.

## Technical authority and boundaries

Fetched and reviewed `origin/main` at
`3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`. The reviewed sources are `PROTOCOL.md`,
`PRIVACY.md`, `CHAT.md` and `ZOLANA.md`. Every chapter links to relevant sections at that
fixed revision; all source anchors were checked against the local documents.

The text explicitly identifies current UI-branch exceptions: optional passkey Skip,
optional backup verification, the USD placeholder and unavailable swap illustrations.
It does not treat design previews as evidence of engineering support. It distinguishes
the shared DKG-derived secret from FROST spending shares, and quantum recoverability
from quantum resistance.

The component imports its educational copy and static illustration module only. It does not
import wallet state, signing, persistence, network clients or application reactors. `app-shell.js`
mounts it using the existing DOM helper; `app.js` registers the modules in the existing module
list. No native paths, underlying payment rules or cryptographic implementations are changed.

## Verification

- Browser: all ten chapters render with one selected tab and one panel, working illustration
  and source links; no observed page exceptions.
- Forty layout cases: widths 320, 390, 768, 1024 and 1440, dark and light themes, chapters
  2, 6, 8 and 10. No document overflow, out-of-bounds columns or clipped selected tab.
- All ten SVGs checked at 320 pixels: no out-of-bounds text.
- Keyboard wrapping, Home/End, pagination focus and sticky navigation checked.
- Selected chapter, open disclosure and paused animation preserved through an actual app redraw.
- Reduced-motion and forced-colors behavior checked. Controls meet a 44-pixel height.
- Switching among all ten chapters makes no network requests and leaves the empty wallet state
  unchanged. External source links disclose that they open GitHub.
- `sh scripts/test-fast.sh` with Node 24: **48 tests passed**. QR tests skipped because
  `qrencode` is unavailable. The first sandboxed run could not run local stub listeners;
  the successful run used permission for those listeners.
- Import-graph check: **78 modules**, also under a locked vault.
- Homepage-motion tests: **13 passed**.
- `node web/test/unified-setup.mjs` stops at the existing assertion
  `messages: no duplicate Overview heading` before reaching the homepage assertions. An
  isolated archive of unchanged `bdd7403` reproduces the same failure. The assertions for the
  replaced homepage disclosure were updated to the new chapter structure; the broader suite
  does not reach them in this baseline. Actual browser checks cover the new surface.
- JavaScript syntax checks, source-anchor verification and `git diff --check` passed.

Screenshots in `visuals/how-zigs-works/` show desktop light, desktop dark and phone dark.
PNG ancillary metadata was removed. No live chain actions were performed.
