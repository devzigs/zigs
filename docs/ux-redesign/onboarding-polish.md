# Onboarding, devices and recovery polish

Baseline: `bf88186`. Authoritative main: `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`,
confirmed against the remote. Only `web/app.css` changes production code.

Reviewed the supplied `Zigs_App_Wide_Premium_UI_PRD_v3.md`, particularly creation/join,
security/device, recovery, sensitive overlay and shared component requirements, and the
[original reference mapping](art-direction.md). Applied the references' restrained neutral
surfaces, deliberate hierarchy, varied desktop composition and consistent control geometry.
No reference art or product capability is copied; this pass does not claim new inspection of
previously rate-limited reference artwork.

## Five issues corrected

| Issue | Presentation improvement |
| --- | --- |
| Setup framing competed with the current task. | One opaque task surface, a quieter wallet-context heading, consistent step typography and a restrained current-step well. Existing progress stages and their meaning are unchanged. |
| Diagrams accumulated multiple nested bordered panels. | Remove the outer decorative enclosure; retain one neutral wallet group with clear device wells. Phone-browser diagrams keep devices together in three wrapping columns rather than a long stack. |
| Creation review used three competing oversized tiles. | One compact, divided fact summary. Device count and threshold stay prominent; network names use the section type role. Every value and disclosure remains intact. |
| Security/device/recovery information became a long series of broad cards. | Content-sized desktop groups, aligned device rows, readable text measure and a quiet lost-device disclosure. Phone layouts retain their existing reading and action order. |
| Instructional and sensitive surfaces had inconsistent finishing. | Shared opaque icon wells, readable supporting type and consistent backup/check/restore spacing. Step controls reuse the existing short hover timing; verification numbers, secrets and QR content receive no new motion. |

One refinement followed the first comparison: reduce mobile stepper padding, quiet the mobile
wallet-context heading and flatten the remaining nested browser-protection border. No further
art-direction pass or unrelated screen edits.

## Evidence

Fresh isolated browser stores, the existing unfunded three-device test journey and virtual
authenticators. No user-owned browser profile or real funds. Sensitive numbers, invitation/QR
payloads, passphrases and file controls are masked. Masked payloads are not claimed as visually
verified content. Actual thirty-digit comparison and existing gates remain covered by the journey.

| Representative view | Before | After |
| --- | --- | --- |
| Browser protection, desktop | [Before](visuals/onboarding-polish/before/protect-1440-light.png) | [After](visuals/onboarding-polish/after/protect-1440-light.png) |
| Approval rule, phone dark | [Before](visuals/onboarding-polish/before/03-tutorial-rule-390-dark.png) | [After](visuals/onboarding-polish/after/03-tutorial-rule-390-dark.png) |
| Creation review, desktop | [Before](visuals/onboarding-polish/before/04-tutorial-review-1440-light.png) | [After](visuals/onboarding-polish/after/04-tutorial-review-1440-light.png) |
| Join, phone | [Before](visuals/onboarding-polish/before/join-390-light.png) | [After](visuals/onboarding-polish/after/join-390-light.png) |
| Security, desktop | [Before](visuals/onboarding-polish/before/security-1440-light.png) | [After](visuals/onboarding-polish/after/security-1440-light.png) |
| Backup, phone dark | [Before](visuals/onboarding-polish/before/backup-390-dark.png) | [After](visuals/onboarding-polish/after/backup-390-dark.png) |
| Device management, desktop dark | [Before](visuals/onboarding-polish/before/devices-1440-dark.png) | [After](visuals/onboarding-polish/after/devices-1440-dark.png) |

The evidence folder also contains connect, verification, guided backup/ready, optional saved-file
check, restore and replacement confirmation views in both themes at 1440px and 390px. Additional
after screenshots cover Skip-warning cancellation, doubled text and forced colors.

## Verification boundaries

See [validation results](onboarding-polish-validation.json). The existing Node 24 fast suite
passes all 41 executed suites; `qrencode` is unavailable and that suite is skipped. Lint and
both-palette contrast checks pass. Actual browser checks cover formation/join gates, full-number
acknowledgement, optional recovery, overflow, 48px controls, modal focus and Escape dismissal.

Desktop and responsive phone-browser screenshots were reviewed. Physical phones, Safari,
VoiceOver, software keyboards, real passkey-provider synchronization and funded operations were
not tested. Error/legacy/Solana-specific recovery variants are not all newly captured. No new
performance benchmark is claimed.

All JavaScript, signing, key generation, authentication, recovery logic, public APIs and wallet
architecture remain byte-identical to the baseline. No new dependency, raster asset, native
change, merge or deployment. Security copy is unchanged; no warning is hidden or removed.
