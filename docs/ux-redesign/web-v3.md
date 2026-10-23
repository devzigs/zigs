# Application-wide premium web UI v3

Visual baseline: `3ef16800707c2bab7dc5338b15deaeb0062043e6`.
Technical reference: main `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`, confirmed against the remote
before implementation. No technical code is imported from another branch.

The approved v3 brief replaces conflicting older visual prescriptions. This pass stays on
`codex/ux-ui-final`, changes the web interface only, and includes no merge or deployment.

## Agreed design

- Cool porcelain foundations, graphite financial emphasis and restrained warm orange. Both
  themes share semantic tokens; the graphite panel has its own foreground and control roles.
- Compact Overview with three content-sized asset cards. The unavailable USD state is visible
  and concise. Native balances remain exact; no prices or privacy allocations are invented.
- Active holdings have the strongest information hierarchy. Not-added and unavailable assets
  use quieter surfaces, while deposit warnings retain full reading contrast. Money actions and
  privacy actions use distinct emphasis without changing their handlers or availability.
- Unknown privacy allocations have a short explanation instead of an empty track and dash
  percentages. Existing balance/privacy disclosures remain accessible.
- Route selection has one orange marker. Current-wallet context has a separate quiet treatment.
- Shared type, geometry, controls, notices, rows and compact education apply to working views,
  setup, preferences, help, chats, recovery and overlays. QR and sensitive content remain opaque.
- The supplied zebra image is unchanged. Only its surrounding graphite/silver presentation,
  perspective, size and shadow change. Mobile actions and recovery access precede the artwork.
- Existing motion observation, reduced-motion handling and one-time highlight are retained.
  Timing and easing are centralized; no operation depends on an animation callback.

## Functional boundaries

No public API, schema, persistence format, authentication policy, crypto, transaction calculation,
backend integration or routing/state architecture changes. Optional passkey Skip and backups,
thirty-digit safety comparison, supported thresholds and existing unavailable states remain.
Previously approved branch extensions are preserved, not expanded by this visual brief.

The desktop wallet switcher remains a native select. Its popup cannot be made into custom glass
without replacing keyboard, selection, positioning and dismissal behavior. The approved safe
glass implementation refines the existing phone-browser navigation menu. No custom picker or
new interaction framework is introduced.

The light tertiary token is slightly darker than the PRD starting value, and its dark counterpart
slightly brighter, so muted labels retain contrast when translucent navigation crosses contrasting
backdrops. The palette is tested over opaque surfaces and glass over white, black, orange and graphite.

## Evidence and limitations

The [coverage register](web-v3-coverage.md) distinguishes actual browser journeys, inert sample
views, source review and blocked verification. Validation reports are generated beside this file.
Screenshots and recordings use synthetic unfunded fixtures, never a user-owned browser profile.

Chrome is the automated/performance benchmark. Playwright WebKit is a separate engine-compatibility
check; it is not installed Safari. Actual Safari UI control was unavailable because Computer Use
permission was not granted. Safari appearance/keyboard sign-off remains unverified; do not call
the WebKit result a Safari pass. Physical phones, software keyboards, screen readers, physical
authenticators and funded transfers are outside the evidence collected locally.

The missing `qrencode` regression dependency is reported as a skip. Separate safe rendered QR
decoding, where run, is recorded independently. Hosted CI results must also be reported separately
from local checks.

No new runtime dependencies, remote assets or replacement logo are introduced. Commits use the
neutral project identity, unsigned, without attribution trailers. The original checkout and native
paths remain protected.

## Final local results

See the [machine-readable validation](web-v3-final-validation.json) for exact counts and limits.

- 51 executed Node checks pass: 41 registered fast tests, all nine long tests and worker limits.
  The separate `qrencode` suite is skipped; four safe browser-rendered QR fixtures decode correctly.
- Lint passes for 184 JavaScript and two Python files. Text, control, transient-state and glass
  contrast checks pass in both palettes. Genuine 200% browser zoom passes across ten sample pages.
- Both actual before/after journeys pass 1,160 checks with 215 captures. The optional-protection
  journey passes 206 checks. Final Chrome/WebKit matrices pass 1,013/1,009 checks respectively.
- Six presentation-gallery trials have all measured frames within 20ms. Three real-menu trials
  have at least 96.6% within 20ms, feedback within 20ms, no tasks above 50ms, no layout shift and
  no continuous decorative loop. These are local desktop measurements, not phone guarantees.
- The final evidence contains 752 metadata-free PNGs and ten recordings. The four changed
  production files together compress 137 bytes smaller using identical compression settings.
- All 19 protected binary hashes and policy source/outputs match the recorded baseline. The
  recorded-gate comparison reports its missing QR tool and localhost CSP WebSocket host; the
  other recorded headers match. The baseline manifest is unchanged.
- The exact presentation-only JavaScript delta is audited; all existing action handlers and
  calculations remain unchanged. Native paths, the original checkout's 828 file hashes and the
  canonical zebra asset are preserved. Both local preview origins serve the final asset bytes.

The browser harness now waits for existing post-unlock store readiness before navigating. This
fixes a test-only boot race found during baseline comparisons; it changes no application behavior.

| Representative view | Before | After |
| --- | --- | --- |
| Light Overview | [Before](visuals/web-v3/before/06-overview-1440-light.png) | [After](visuals/web-v3/after/06-overview-1440-light.png) |
| Dark Overview | [Before](visuals/web-v3/before/06-overview-1440-dark.png) | [After](visuals/web-v3/after/06-overview-1440-dark.png) |
| Payment review | [Before](visuals/web-v3/before/31-prd-zec-blocked-review-1440-light.png) | [After](visuals/web-v3/after/31-prd-zec-blocked-review-1440-light.png) |
| Narrow backup dialog | [Before](visuals/web-v3/before/53-backup-390-dark.png) | [After](visuals/web-v3/after/53-backup-390-dark.png) |
| Welcome | [Before](visuals/web-v3/before/45-welcome-1440-light.png) | [After](visuals/web-v3/after/45-welcome-1440-light.png) |

Recordings: [working-product slice](visuals/web-v3/after/46-presentation-1440.webm),
[real menu and scrolling](visuals/web-v3/after/52-shell-interactions-0.webm).
