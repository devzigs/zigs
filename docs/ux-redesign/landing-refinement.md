# Landing purpose and material refinement

22 October 2026 · Web only · Visual baseline `4cd81df`

Technical reference: main `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.
This pass changes presentation and disclosure interactions. It does not import technical changes from main.

## Delivered

- First-time entry now explains private assets and shared control, with Create, Join and Recover actions. The empty wallet selector is removed; the existing local Test wallet utility remains available.
- Returning entry focuses on the real saved-wallet count and native wallet disclosure. Existing row handlers and unread, approval, view-only, moved, unfinished and unreadable status generation are reused. No hero object competes with the selector.
- The floating glass panel anchors to its trigger, clamps to the viewport and scrolls internally. Wallet balances and status rows remain opaque. Escape returns focus; outside pointer/focus interactions dismiss without stealing focus; ordinary redraws preserve the native open state.
- The supplied zebra is unchanged. Its 240px desktop object has a satin rim, recessed face and contact shadow. Pointer tilt is limited to two degrees and mouse input. Entrance/reflection effects run once per tab, respect hidden/reduced-motion guards and never represent security status.
- Satin controls are scoped to landing entry. Shared navigation has quieter selection, aligned icons and restrained translucent lighting. Chats retains its accessible explanation and wallet-selection requirement.
- Routine engine information is behind Browser status. Connection warnings remain outside it; actual engine failures still raise the existing banner and disable creation. Network, audit and Solana privacy disclosures remain in the expandable explanation and existing setup flow.
- The invitation form submit is labelled Open wallet, distinguishing it from the Join wallet disclosure action. Its validation and handler are unchanged.

## One refinement pass

The representative first implementation exposed horizontal overflow from the tablet ambient light,
and overlapping lines when text was doubled. The refinement bounded that light, stacked the tablet
composition and used unitless leading for landing/sidebar copy. Popup geometry observes size changes;
reduced/hidden effects reset without transition. No unrelated screen layouts were redesigned.

## Visual comparison

All four landing states (zero, one, multiple, multiple/open) were captured before and after at
320×800, 390×844, 768×1024, 1024×768 and 1440×900 in light, dark and system-dark modes.
The final matrix has 60 views with no horizontal page overflow, no undersized tested controls
and primary entry actions within the ordinary viewport. Expanded help, menus with many entries,
short viewports and enlarged text intentionally retain scrolling.

| View | Before | After |
| --- | --- | --- |
| New user · 320px · light | [Before](visuals/landing-refinement/before/zero-320-light.png) | [After](visuals/landing-refinement/after/zero-320-light.png) |
| New user · 320px · dark | [Before](visuals/landing-refinement/before/zero-320-dark.png) | [After](visuals/landing-refinement/after/zero-320-dark.png) |
| New user · 390px · light | [Before](visuals/landing-refinement/before/zero-390-light.png) | [After](visuals/landing-refinement/after/zero-390-light.png) |
| New user · 390px · dark | [Before](visuals/landing-refinement/before/zero-390-dark.png) | [After](visuals/landing-refinement/after/zero-390-dark.png) |
| New user · 768px · light | [Before](visuals/landing-refinement/before/zero-768-light.png) | [After](visuals/landing-refinement/after/zero-768-light.png) |
| New user · 768px · dark | [Before](visuals/landing-refinement/before/zero-768-dark.png) | [After](visuals/landing-refinement/after/zero-768-dark.png) |
| New user · 1024px · light | [Before](visuals/landing-refinement/before/zero-1024-light.png) | [After](visuals/landing-refinement/after/zero-1024-light.png) |
| New user · 1024px · dark | [Before](visuals/landing-refinement/before/zero-1024-dark.png) | [After](visuals/landing-refinement/after/zero-1024-dark.png) |
| New user · 1440px · light | [Before](visuals/landing-refinement/before/zero-1440-light.png) | [After](visuals/landing-refinement/after/zero-1440-light.png) |
| New user · 1440px · dark | [Before](visuals/landing-refinement/before/zero-1440-dark.png) | [After](visuals/landing-refinement/after/zero-1440-dark.png) |
| Returning / open · 320px · light | [Before](visuals/landing-refinement/before/many-open-320-light.png) | [After](visuals/landing-refinement/after/many-open-320-light.png) |
| Returning / open · 320px · dark | [Before](visuals/landing-refinement/before/many-open-320-dark.png) | [After](visuals/landing-refinement/after/many-open-320-dark.png) |
| Returning / open · 390px · light | [Before](visuals/landing-refinement/before/many-open-390-light.png) | [After](visuals/landing-refinement/after/many-open-390-light.png) |
| Returning / open · 390px · dark | [Before](visuals/landing-refinement/before/many-open-390-dark.png) | [After](visuals/landing-refinement/after/many-open-390-dark.png) |
| Returning / open · 768px · light | [Before](visuals/landing-refinement/before/many-open-768-light.png) | [After](visuals/landing-refinement/after/many-open-768-light.png) |
| Returning / open · 768px · dark | [Before](visuals/landing-refinement/before/many-open-768-dark.png) | [After](visuals/landing-refinement/after/many-open-768-dark.png) |
| Returning / open · 1024px · light | [Before](visuals/landing-refinement/before/many-open-1024-light.png) | [After](visuals/landing-refinement/after/many-open-1024-light.png) |
| Returning / open · 1024px · dark | [Before](visuals/landing-refinement/before/many-open-1024-dark.png) | [After](visuals/landing-refinement/after/many-open-1024-dark.png) |
| Returning / open · 1440px · light | [Before](visuals/landing-refinement/before/many-open-1440-light.png) | [After](visuals/landing-refinement/after/many-open-1440-light.png) |
| Returning / open · 1440px · dark | [Before](visuals/landing-refinement/before/many-open-1440-dark.png) | [After](visuals/landing-refinement/after/many-open-1440-dark.png) |

[All captures and detailed checks](landing-refinement-validation.json).
Sixteen matched Overview/Settings captures verify the shared sidebar in both themes at 390/1440px.
These use existing inert renderer snapshots with matching baseline/current sidebar markup and styles;
all actions are disabled, the sample banner is visible, and no real balances or personal data appear.

## Validation

- Existing entry journey: **782 checks, 72 additional temporary captures, zero errors**. Includes system-light/system-dark, keyboard access, form values/focus, expanded explanations, enlarged text and forced colours.
- Targeted live browser interactions: **32 checks passed**, including menu dismissal/redraws, viewport clamping, pointer tilt/reset, reduced preferences and real connection-error presentation. Four additional assertions verify actual engine-load failure banners and disabled creation at 390/1440px.
- Actual motion/pointer behavior inspected in isolated Chrome contexts. Existing completion/hidden/preference regression checks remain green; no outgoing wallet content or animation callbacks control operations.
- Two 150-frame local headless runs at 1440/390px: **100% of samples within 20ms, p95 ≤16.8ms, zero observed long tasks/CLS**. This is a small isolated fixture measurement, not a device-performance guarantee.
- **41 Node 24 fast suites**, the longer unified-setup suite, **16 motion tests**, light/dark contrast checks and strict lint (**184 JS / 2 Python files**) passed.
- Tracked-assets-only Worker/web dry-run: **184 assets**, Worker **26.96 KiB / gzip 9.33 KiB**. No deployment. Untracked prototypes and other concurrent work were excluded from the build and commit.
- Changed production files add **2,866 gzip bytes** measured independently against the baseline. No runtime dependency or artwork changes. Contrast checks include rendered-color composition for sidebar selection and existing control/gradient pairs; forced-colour and opaque fallbacks were captured.
- Test wallet sample refreshed: **32 checks, zero errors**. Real-flow preview remains on port 8792; inert sample on 8793. No user browser profile was reset. An additional clean checkout of this exact UI commit serves the real flow on port 55846; parallel checkout work is preserved.

## Limits and preserved boundaries

Google Chrome 155.0.8059.85 on macOS; phone sizes use browser emulation. Physical phones, Safari,
assistive technology, software keyboards and live funded payments were not tested in this pass.
Synthetic wallet lists exercise presentation without persisted keys; the existing isolated browser
journey separately exercises unfunded creation. Approval/unread status generation is unchanged;
not every possible remote-status combination was reproduced in the visual matrix.

Ordinary redraws deliberately settle decoration immediately. An early metadata redraw can interrupt
the brief brand entrance/reflection; it is never replayed to delay controls or wallet work. Reduced
motion, touch and hidden pages have no pointer tilt. The original logo asset remains byte-identical.

No public API, schema, persistence, routing, authentication, cryptography, signing, wallet logic or
native application changes are included. Other working-tree changes remain unstaged. No merge or
deployment was performed.
