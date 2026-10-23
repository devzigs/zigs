# Optional browser protection

Approved by the user on 21 October 2026 after reviewing the unencrypted-storage consequence.
This narrow setup-policy exception supersedes the earlier required-passkey rule.
Technical reference: main `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`, fetched again.
Implementation baseline: `d50e3a44d208930226cef610efc4a87483aad74c`.

## Flow

Protect this browser remains the recommended first action. A clean unprotected browser also
shows **Skip for now**. Opening it does not permit setup, create a wallet/share or save consent.
The warning uses the current page/dialog rather than a second modal. Its decorative unshielded
icon and visible title explain the choice. Focus moves to **Go back**, the safe primary action.
Go back or Escape within the warning cancels it and returns focus to Skip. Closing setup never
acknowledges it. Normal first-step actions are replaced by the warning's choices while it is open.

> **Are you sure?**
>
> Without a passkey, new signing shares and other local wallet data are saved in this browser
> without Zigs’ passkey encryption. Someone with access to this browser profile or its saved site
> data may be able to use this device’s share without unlocking Zigs.
>
> Your wallet’s approval rule still applies. Protecting this browser is recommended; you can
> enable it later in Settings.

The secondary **Continue without protection** action explicitly acknowledges the choice. For a
new-wallet first step it advances to the existing threshold step. For joining, demonstration seats
and replacement-wallet creation it enables the existing action, which the person still performs
separately. It never automatically joins a signer or creates a replacement wallet.

Afterwards, the local status says **Passkey protection skipped in this tab**. Review records
**Skipped · no passkey encryption**. The device diagram uses separate shares rather than suggesting
a passkey unlock. The real passkey-protected badge remains false. Settings retains the existing
Lock with a passkey action for later verified protection.

## Policy and boundaries

The four setup helpers are separate from actual protection: canSkipPasskeyProtection(),
acknowledgeUnprotectedSetup(), setupProtectionReady() and requireSetupProtection(). The existing
passkeyProtected() and requirePasskeyProtection() remain strict and unchanged. New-signer UI and
handlers consistently require either verified protection or the explicitly acknowledged path.

Acknowledgement is a private in-memory variable in the loaded tab. It creates no durable consent
record and never enters wallet documents or recovery files. Reload clears it for new signer entry;
existing wallet access retains main's behavior. Starting a protection attempt clears it, so a
cancelled/failed attempt cannot silently fall back to earlier consent. Observing an unsafe storage
or vault state clears it too; removing that conflict does not resurrect the old choice.

Skip is unavailable with an existing/locked/damaged/pending/incomplete vault, unreadable or damaged
local records, known write failure, or memory-only operation. Eligibility rereads the vault record,
including around plaintext readability checks. Confirmation and each actual creation/join handler
check again, preserving a vault created by another tab even before a storage event arrives.

An acknowledged browser uses main's existing plaintext persistence path. Existing vault encryption,
WebAuthn/PRF operations, file formats, schema, key generation, ceremony, nonces, approval thresholds,
payment calculations, backend services, recovery imports and spending authorization are unchanged.
Later protection keeps its complete migration/read-back/decryption/plaintext-cleanup checks. There
is one added revocation call at the start of activation; no failed activation is treated as protected.

The optional policy test is registered in the existing fast, baseline and lint lists; hosted web
CI already discovers new web tests. No workflow or runtime dependency changes are needed.

## Validation

Sixteen affected Node 24 suites pass. The new optional-policy test covers 23 isolated policy and
storage cases plus two fresh-module reload probes, and is included in the successful registered
fast run: 41 tests passed. The QR test was skipped because qrencode is unavailable; QR code is
unchanged. Strict lint passes for 180 JavaScript and two Python files.

The dedicated unprotected browser journey passes 186 checks / 32 captures. It exercises warning
cancellation/focus, explicit creation and joining, the full thirty-digit comparison and actual
unfunded 2-of-3 formation, existing access after reload, new-entry consent reset, replacement
confirmation, truthful device/review status and later verified encryption/cleanup/reload unlock.
The existing protected journey still passes 986 checks / 179 captures. The sample/preferences
sweep passes 675 / 17. Current browser evidence totals 1,847 checks / 228 captures with no errors.

Screens cover 320, 390, 768, 1024, 1440 and 1920px, light/dark/system preferences, doubled text,
forced colors and reduced preferences. All 259 PNGs contain only image chunks. The ten-page inert
Test wallet rebuild passes 32 checks and its fingerprint matches final source. Four production
JS/CSS files add 1,618 individually compressed gzip bytes; no new dependency or raster asset.

Seven existing entry functions differ only by the approved eligibility-helper substitution.
Twenty-five other critical functions and 27 crypto, protocol, state, recovery, persistence and
backend files remain exact. Existing keystore definitions remain exact except one leading
consent-revocation call in activation. Protected binaries, policy and served headers match.
Original HEAD/status and all 828 saved file hashes, native paths and the canonical logo are intact.

Evidence: [explicit-choice journey](web-optional-passkey-after-entry-validation.json),
[protected journey](web-optional-passkey-after-validation.json),
[sample/preferences](web-optional-passkey-after-visual-validation.json),
[final validation](web-optional-passkey-final-validation.json).

| Recommended default | Explicit confirmation |
| --- | --- |
| ![Passkey and Skip](visuals/web-optional-passkey/after/51-protect-step-390-dark.png) | ![Skip warning](visuals/web-optional-passkey/after/51-warning-390-dark.png) |

Checks use isolated unfunded browser stores and synthetic credentials, never user data. Physical
passkeys, provider sync, screen readers, software keyboards and funded transfers remain untested.
No new motion behavior; earlier performance evidence remains historical. Web only. No native work,
merge or deployment.
