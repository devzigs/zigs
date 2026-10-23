# Zigs homepage — full redesign

23 October 2026 · `codex/homepage` · Web interface only

Historical full-redesign record. Current hero art direction and motion are described in
[the cinematic homepage implementation](cinematic-homepage.md). The original screenshots and
validation below remain evidence of the earlier implementation.

The full homepage brief is implemented. New visitors get one cinematic entry scene, an explicit
Create / Join / Recover hierarchy and concise shared-control education. Returning visitors get
a compact Welcome back scene followed immediately by their actual wallet launchers. Several
wallets remain a choice; the page never invents a selected or last-used wallet.

## Design and behavior

| Workstream | Delivered |
| --- | --- |
| Hero | The original transparent, number-textured zebra and red eye fill an unboxed studio scene. A restrained warm backlight, fine orbital lines and separate copy scrim provide depth. Desktop and phone compositions are separately directed. |
| Typography | Bundled Geist display type, tight white/silver headline, concise contextual copy, consistent metadata and one H1. No new font downloads. |
| Materials | Deep charcoal hero, opaque titanium wallet/content surfaces, quiet navigation, fine edge highlights and one copper primary action. Light, dark and system preferences retain their existing controls. |
| Threshold education | Static numbered nodes with the explicit caption Illustration · Any 2 of 3 approvals. The example never reads live signer or transaction state. On small screens it flows before the copy and expands with enlarged text. |
| Controls and motion | Existing actions with hover, press, disabled and focus states. Decorative pointer motion is bounded to six pixels and a small light shift; one entrance per document; no idle animation loop. Touch, reduced-motion, slow-update and hidden-page cases settle to a static scene. |
| Wallet identity | Larger existing verified-public-address artwork, actual name/network/policy/status/balance and a clear Open action. Unknown artwork keeps its established fallback. Unknown balance stays Open to sync; confirmed zero remains distinguishable. |

The canonical zebra file is byte-for-byte unchanged. The missing metallic concept image was not
needed: scale, cropping, lighting around the artwork and composition establish the new identity
without substituting a different logo. Header, favicon and setup branding keep their sources.

Create, Join, private-invite validation, Recover, Open, unfinished setup, wallet selection and
all sidebar destinations use the existing handlers and data. How Zigs works opens and focuses
the native disclosure. Existing privacy, test-network, beta and unaudited disclosures remain,
including what is public on Solana. The demo link remains local-only and opens the original
read-only sample destination.

## Visual evidence

All wallet data in the captures is synthetic, unfunded and isolated from user profiles. The
public-art examples exercise the existing artwork bridge using synthetic public display facts;
they are not proof of a funded or production wallet's security state.

| View | Desktop | Phone |
| --- | --- | --- |
| New visitor, dark | [1440px](visuals/homepage-full/after/new-1440-dark.png) | [390px](visuals/homepage-full/after/new-390-dark.png) |
| New visitor, light | [1440px](visuals/homepage-full/after/new-1440-light.png) | [390px](visuals/homepage-full/after/new-390-light.png) |
| Returning visitor | [1440px](visuals/homepage-full/after/returning-1440-dark.png) | [390px](visuals/homepage-full/after/returning-390-dark.png) |
| Multiple wallets | [1440px](visuals/homepage-full/after/multiple-1440-dark.png) | [390px](visuals/homepage-full/after/multiple-390-dark.png) |
| Existing public artwork | [1440px](visuals/homepage-full/after/synthetic-public-art-1440.png) | [390px](visuals/homepage-full/after/synthetic-public-art-390.png) |

Original application baseline: [desktop](visuals/homepage-hierarchy/before/new-1440.png),
[phone](visuals/homepage-hierarchy/before/new-390.png). Accessibility evidence includes
[new visitor at 200% text](visuals/homepage-full/after/new-200-percent-320.png),
[long names at 200%](visuals/homepage-full/after/long-names-200-percent-320.png),
[forced colors](visuals/homepage-full/after/forced-colors-focus-320.png), and
[image failure](visuals/homepage-full/after/new-image-failure-390.png).

## Validation

- [440 focused browser checks](visuals/homepage-full/after/validation.json) pass, with 27 final
  screenshots and no runtime exceptions. New, returning and multiple-wallet layouts cover
  320, 375, 390, 768, 1024 and 1440px in dark and light themes. Primary Create and real wallet
  access stay in the initial viewport at normal text sizes.
- Checked actual Create / Create another / Join / Recover / Open actions, invalid invite
  feedback, private-field focus and redraw preservation, modal keyboard trapping, mobile Menu,
  all existing sidebar destinations, disclosure focus/open state, native file chooser and the
  local-only Test wallet link.
- Checked correct wallet selection, distinct network/approval-policy values, known nonzero,
  confirmed-zero and unknown balances, unfinished setup, unreadable metadata and the existing
  public identity artwork bridge. Test selection subscriptions are inert; no signing or funded
  transaction was performed.
- Actual 200% text, long names, forced colors, image failure, disabled controls, reduced/normal
  motion, redraw, delayed engine, locked/damaged vault, restricted service and unavailable
  storage cases pass. Forced colors removes the decorative hero image so it cannot interfere
  with text. Enlarged policy text pushes copy in normal flow rather than overlapping it.
- The local preview serves actual web files and inserts the unchanged shim as the Worker does.
  External browser requests are blocked. Fixtures use fresh contexts and memory-only synthetic
  wallet facts; restricted capability is injected only into the test shim.
- All 47 executed Node 24 fast-suite scripts pass. The optional qrencode comparison is skipped
  because qrencode is unavailable. The broader unified-setup suite stops at the same pre-existing
  `messages: no duplicate Overview heading` assertion as unchanged `be093fd`; it fails before
  reaching the homepage section. The homepage copy/label/order expectations were updated and
  the focused browser checks independently exercise those paths.
- Page-module import/global lint, homepage motion/helper lint, syntax and whitespace checks pass.
  Worker/web dry-run packaging passes with 270 assets; no deployment was performed.
- Browser evidence uses Node 24.19.0 and Chromium 155.0.8059.85. The local unthrottled LCP samples
  identify the hero image; measured values and resource inventories are in the JSON report.
  They are local development measurements, not a production network-performance claim. The
  only HTTP image source is the existing canonical logo, reused by the page; no new illustration
  payload, font, 3D engine, video or runtime dependency was added.

## Exact implementation files

- `web/app-shell.js`: homepage markup/copy, labelled static teaching figure, larger existing
  wallet image, existing-action presentation and on-demand education.
- `web/homepage.css`: scoped responsive layout, studio scene, materials, card/control states,
  navigation polish and accessibility preferences.
- `web/homepage-motion.js`: isolated decorative observation/pointer behavior. No wallet imports.
- `web/index.html`: load the scoped stylesheet and independent motion module.
- `web/test/unified-setup.mjs`: current headline, returning label and wallet-first order expectations.
- `solspike/tools/homepage_hierarchy_browser.mjs`: repeatable full browser verification and evidence.

This report and `visuals/homepage-full/` contain review evidence. Earlier hierarchy-only notes
are historical and are superseded by this full redesign. Integration is tracked separately in
Git; these results describe the isolated homepage implementation before integration.

## Boundaries and remaining limits

The technical reference remains the latest successfully fetched `origin/main`, `3a6c08e`
(Merge port-send-form). A subsequent remote recheck encountered a DNS failure. No technical
implementation was imported, replaced or proposed in this redesign. Wallet data and safeguards
remain authoritative; no architecture, cryptography, transaction, authentication, permissions,
recovery, storage schema, routing, backend, provider or native code changed.

Requires Engineering Approval: none introduced. No new identity derivation, remembered-wallet
storage, pricing source, live signing visualization or network capability is needed.

Remaining verification limits: Chromium automation and visual inspection do not certify Safari,
physical devices, assistive technology or live backend behavior. Existing artwork intentionally
uses its truthful fallback until verified public display facts are available. Enlarged text,
many wallets and expanded education scroll vertically as needed.
