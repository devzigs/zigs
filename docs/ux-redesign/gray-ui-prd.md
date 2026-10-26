# Gray UI — UI migration PRD

25 October 2026 · implementation branch `gray-ui` · no merge or deployment.

The migration below was delivered at `825bf96`. The later request to elevate motion,
iconography and fluidity is implemented and specified in the
[page-by-page premium review](gray-ui-premium-review.md), with its own scope and evidence audit.
The subsequent [complete web flow UX audit](gray-ui-ux-audit.md) implements clearer action
language, button order and contextual explanations while preserving the same safeguards.
The subsequent [motion and icon refinement](gray-ui-motion-craft.md) unifies timing,
utility icons, navigation, press feedback and modal framing throughout the web application.
The [follow-up full UI/UX check](gray-ui-full-review.md) covers populated conversations,
accessible names, touch targets, short viewports, long labels and large balances, and fixes
the remaining mobile conversation clipping and icon regressions.

## Goal and authoritative sources

Apply the complete latest web design from the existing local `codex/ux-ui-final` working
copy to a branch based on main. Preserve main’s engineering improvements, authentication,
wallet state, recovery rules, transaction checks, backend integrations and architecture.

| Source | Exact baseline | Use |
| --- | --- | --- |
| Engineering authority | Main `c6860f6fef9351531bd3a9c3a221600c49651035` | Branch base and technical behavior. |
| Committed UI ancestor | `codex/ux-ui-final` at `78345496bb6438e22bfdbfbc484105df84c18c0d` | Earlier redesign already substantially incorporated into main. |
| **Latest design reference** | The uncommitted 24 October web presentation work on that actual local checkout | **Manrope, refined surfaces/controls, fingerprint branding/icons, five guide journeys, illustrations and motion.** |
| Design provenance | `devzigs/zigs-site` main `876e358` | Original artwork, educational illustrations, icon geometry and typography source; retain notices. |

The latest design is **not represented by the remote branch commit alone**. The source
manifest [gray-ui-design-source.json](gray-ui-design-source.json) pins all 24 working-copy
web files by SHA-256: 11 modified tracked files and 13 new files. Preserve that working copy
without committing, reverting or modifying it. The current branch selectively carries its
presentation delta onto main; it does not replace older mixed UI/engineering files.

The previous committed-only comparison omitted this working-copy design. Its conclusion
that no web migration was required is superseded by this specification and validation.

## Required design migration

| ID | Area | Presentation requirement and implementation |
| --- | --- | --- |
| GW-01 | Typography | Locally hosted variable Manrope for interface text, headings and controls; the reference’s lighter editorial heading weights, tracking and line height. Preserve tabular financial figures and Geist Mono for technical text. Include both Latin subsets and `Manrope-OFL.txt`. |
| GW-02 | Color and surfaces | Match the near-black/silver dark palette and warm neutral light palette, border hierarchy, opaque financial surfaces, quiet shadows and refined dialogs. Preserve orange primary actions, focus/selection accents, copper hero lighting and distinct semantic status colors. |
| GW-03 | Branding and icons | Use the supplied white fingerprint zebra for the web logo/emblems, with a dark plate that keeps it legible in either theme. Carry proportional PNG/ICO/touch icons and source-versioned references. Preserve original geometry, direction, transparency and artwork; generate no replacement. |
| GW-04 | Homepage | Carry the reference’s typography, rounded actions, signature/threshold styling and understated hero atmosphere. Retain the original number-textured red-eye zebra separately as `assets/brand/hero-zebra.png`, preserving lighting and composition. |
| GW-05 | Application-wide styling | Apply `site-refinement.css` to navigation, setup, Overview, Approvals, Activity, Address book, Messages, Security, Settings and dialogs. Match control shapes, selected states, font weights and neutral panels while retaining current main layout fixes and all destinations/handlers. |
| GW-06 | Guide overview | Replace the old guide-only entry with five illustrated journeys: Setup, Signers, Zcash & Solana, Secure Messaging and Private Swaps. Each journey has four selectable steps, explanations, previous/next navigation, sculpted illustrations, relief icons and links into the matching reference chapter. |
| GW-07 | Complete guide | Preserve all ten chapters, paragraphs, tables, glossary and source links from **current main’s content module**. Carry grouped desktop chapter navigation, expandable phone picker, editorial reading layout, introduction before illustration, chapter controls and key-idea callouts. |
| GW-08 | Motion and accessibility | Preserve document-local guide/journey selection and Pause/Resume through dismissal and redraws. Pause artwork offscreen, when closed and in hidden tabs; provide reduced-motion and forced-color alternatives. Preserve keyboard selection, focus restoration and reachable dismissal at 200% browser zoom. |
| GW-09 | Resource integration | Add only presentation module imports, local styles/fonts, logo/icon references and hero asset reference. Keep main’s early `theme.js` initialization, CSP, service setup and normal application startup. |

## Migration acceptance criteria (snapshot at `825bf96`)

1. All 24 design-source files are accounted for. Twenty match the source byte for byte;
   the license and guide-icon module only normalize whitespace for Git hygiene.
   `app-shell.js` and `index.html` retain main’s independent changes and receive only
   the appropriate presentation edits. Record hashes and adaptations in the audit.
2. Interface text resolves to Manrope in rendered functional screens. Financial figures
   remain tabular; code/addresses retain their monospace treatment. Both font subsets load
   locally, with the original license retained.
3. Web header/emblems, PNG favicon, ICO and touch icon use the new fingerprint artwork.
   The large homepage hero still uses the original zebra, byte-identical to main’s prior
   logo. Native logo/assets are unchanged by this web pass.
4. Seven functional destinations render without horizontal page overflow at 320, 390, 768
   and 1440 widths in dark/light themes. Inspect paired before/after captures for typography,
   palette, selected navigation, panels and controls; use synthetic wallet data only.
5. All five journeys and twenty steps work. Every current-main reference chapter remains
   available. The guide preserves local reading position, keyboard behavior and focus after
   dismissal, and does not alter wallet data, browser wallet storage or URL fragments.
6. Compose/read actual runtime palette tokens when checking text, status, button and field
   contrast. Check real browser 100%/200% zoom, reduced motion, forced colors and short windows.
7. Main’s existing regression suite passes with its required Node 26. Report any skipped
   checks explicitly. No tests are weakened or rewritten to accept a technical regression.
8. The diff outside documented UI paths, review tools, branding instructions and evidence is
   empty. Preserve anonymous attribution and hooks. Publish to `gray-ui` only.

## Main behavior and corrections to preserve

Keep the actual readiness/protection/approval facts and current labels: beta and test-network
warnings; explicit no-funds Swap/Tor/funding demos; unknown/demo USD and unavailable USDC;
backup reminders; known-zero versus loading approval counts; full thirty-digit comparisons;
Zcash-only continuation while Solana is unfinished; browser protection and recovery failure
states; direct-network/privacy notices; current faucet guidance; and main’s click/render,
sidebar, action-label and money-overflow fixes. Styling is not authority to remove them.

The new guide consumes the existing main content and uses only fixed educational examples.
Its in-memory reading selection is presentation state, never setup, recovery or payment
state. No price feed, live swap, Tor routing, account, chain integration, new authentication,
protocol, backend, storage schema or wallet model is introduced.

## Existing native UI work retained

The initial Gray UI commit `d944b745` also added two independent native presentation pieces:

- GUI-01: four-step read-only messaging-account walkthrough in native Chats, with Relay
  as the default; no account, key, backup, funds, network or persistence operation.
- GUI-02: a post-formation card shown only following an observed real ready transition,
  with existing Security navigation and view-local dismissal, cleared on wallet changes.

Those views and the native capture coverage remain unchanged by the web migration.
Native WebKit funding/Swap runtime, generated resource packaging and a mandatory-looking
funding stage remain outside the UI-only scope, as recorded in the
[technical review](ux-ui-final-technical-review.md). The web design migration does not
require those dependencies and is not deferred with them.

## Review and delivery

The [validation record](gray-ui-validation.md) and [scope audit](gray-ui-scope-audit.json)
record current checks, source hashes and screenshots. Keep code, PRD and evidence aligned
with the final implementation. No merge command, merge commit, PR merge, automatic merging
or deployment is authorized in this chat, including after tests pass.
