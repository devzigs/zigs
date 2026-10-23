# Shared design refinement — one pass

Baseline: `b398aae4391250d3bb857955e314ad6af1a73b50`. Main remains
`3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`, confirmed against the remote without importing code.

Read the supplied `Zigs_App_Wide_Premium_UI_PRD_v3.md`, especially sections 6–8, the original
Visual Design Master Guide and the [six-reference design mapping](art-direction.md). Reopened
all six original reference pages. Their page descriptions were available; this session could
inspect Xpend's rendered artwork, while other artwork requests were blank or rate-limited.
This is not a claim of fresh visual inspection of all six reference artworks. The v3 porcelain,
graphite and restrained orange direction takes precedence over the older palette.

Only `web/design-system.css` and `web/app.css` change production presentation. Existing classes
remain the reusable component layer. No new dependencies, assets, JavaScript, wallet logic,
cryptography, authentication, APIs, persistence, routing or architecture changes. No native
changes, merge or deployment.

## Three issues corrected

1. **Type roles drifted into tiny metadata.** Balance, approval-rule, wallet-context and rail
   labels had shrunk to 10–11px; buttons overrode their shared role with an unrelated size.
   Labels now use a 12px relative-unit role with quieter tracking; asset/network and list
   captions use a 13px role, controls use the shared 15px role. The existing body, heading and
   financial scales now use rem units. Exact amounts and financial formatting are unchanged.
2. **Related surfaces had unrelated geometry.** Insets, notices, cards, recipients, setup
   diagrams, review details and transaction tabs used independent 10/14/18/20px corners.
   These consumers now reuse the existing 8/12/18/24px hierarchy and shared 24/20px panel
   padding roles. Buttons retain 48px minimum targets and forms keep their existing heights.
   Metal brand-object geometry remains a separate intentional exception.
3. **Utility depth lacked a single material recipe.** Fields/addresses had recessed shadows,
   utility glass used separate blur recipes, and the floating-menu shadow was too broad.
   Fields and addresses are flat and opaque. Controls, selected tabs and floating utilities
   now have distinct shared shadow roles; the menu has a short soft shadow, narrow rim and
   centrally defined 16px/110% diffusion. Glass starts opaque, enhances only with support,
   and retains reduced-transparency/forced-color fallbacks. Hover uses an explicit neutral
   surface token in each theme. Primary actions stay flat; quiet/destructive/disabled
   treatments retain their existing semantics.

The semantic palette and required field/control borders already passed contrast; they were
retained. Warning text is not dimmed. No financial, QR, recovery or address content receives glass.

## Verification

[Machine-readable results](web-v3-refinement-validation.json) include all evidence paths.

- **950 existing browser assertions pass**, covering seven widths (320–1920px), explicit and
  system themes, actual doubled text, forced colors, reduced transparency, 48px targets,
  page/panel overflow, Settings theme handling and menu Escape/focus return.
- The 41-suite Node 24 fast run passed 40 suites; `demo-check` timed out in the sandbox.
  Its isolated retry with localhost access passed all 19 subtests. All 41 executed suites
  therefore passed across these runs. `qrencode` remains unavailable and that suite is skipped.
- Contrast passes in both palettes: 68 text pairs, four field edges, six transient heading
  pairs and 36 transient mark pairs each. Lint passes 184 JavaScript and two Python files.
- The existing inert Test wallet rebuild passes 32 checks. It remains a synthetic, unfunded
  2-of-3 sample with all wallet actions disabled.
- **42 screenshots** captured: matching 1440px desktop and 390px phone-browser views for
  Overview, Settings, Send, welcome and mobile menu in light/dark, plus six narrow enlarged-text
  and forced-color views. PNGs contain only IHDR/IDAT/IEND chunks. No personal browser stores used.

Screenshot review included both desktop Overview themes, phone Overview, Send, Settings,
welcome and both menu themes, plus the forced-color Send layout. Automated layout checks across
other sample routes are not a claim that every state received fresh human visual review.
Actual Safari, physical phones, screen readers, physical authenticators and funded actions were
not tested. No new motion or performance claim is made in this refinement.

| View | Before | After |
| --- | --- | --- |
| Desktop light Overview | [Before](visuals/web-v3-refinement/before/overview-1440-light.png) | [After](visuals/web-v3-refinement/after/overview-1440-light.png) |
| Desktop dark Overview | [Before](visuals/web-v3-refinement/before/overview-1440-dark.png) | [After](visuals/web-v3-refinement/after/overview-1440-dark.png) |
| Phone dark Overview | [Before](visuals/web-v3-refinement/before/overview-390-dark.png) | [After](visuals/web-v3-refinement/after/overview-390-dark.png) |
| Phone Send | [Before](visuals/web-v3-refinement/before/send-390-light.png) | [After](visuals/web-v3-refinement/after/send-390-light.png) |
| Phone light menu | [Before](visuals/web-v3-refinement/before/menu-390-light.png) | [After](visuals/web-v3-refinement/after/menu-390-light.png) |
| Phone dark menu | [Before](visuals/web-v3-refinement/before/menu-390-dark.png) | [After](visuals/web-v3-refinement/after/menu-390-dark.png) |
