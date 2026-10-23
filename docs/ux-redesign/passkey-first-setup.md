# Required passkey protection for new web signers (historical delivery)

The user subsequently approved an explicit Skip confirmation on 21 October 2026. The current
[optional-protection delivery](optional-passkey-review.md) supersedes the required-entry policy
below while preserving verified vault completion and migration safeguards. Results here describe
the earlier required-passkey implementation and are historical.

Reference: main `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`. The user requested a required,
default passkey step during browser setup. This is a narrow, deliberate setup-policy change;
it reuses the existing vault and does not redesign wallet cryptography or backend authentication.
Native applications remain outside this branch. No merge or deployment is authorized.

## Flow and limits

- Creating a wallet starts by protecting this browser with the existing passkey vault. Joining
  a new signer likewise requires successful protection before its Join action can proceed.
  The normal, legacy and demonstration join controls share this requirement, as does creating
  a replacement wallet through Change devices.
- A browser that already unlocked its verified vault proceeds without registering another
  passkey. Readiness comes from confirmed vault completion, never a tutorial flag or the mere
  presence of browser passkey APIs.
- Creation performs the existing passkey registration and separate PRF assertion. A protected
  state is exposed only after the encrypted record is saved, read back, opened successfully
  and its plaintext migration completes. Pending, cancelled, unsupported or incomplete attempts
  leave new-signer continuation blocked. Back, Save and exit, retry and recovery remain available.
  One exception: an unlocked vault that holds every plain copy in storage, where only the
  removal of those copies failed, seals each new share, so setup goes on and the page says that
  the passkey copy is not fully checked. A plain copy with data outside the vault keeps setup shut.
- Existing wallets, payments, backup exports and recovery imports retain main's existing
  behavior. This change does not silently migrate, delete or block access to older unprotected
  wallets or retroactively stop their existing setup reactors.
- An invite can still save its existing viewing/room key before a browser becomes a signer.
  This flow requires protection before creating or joining a signing share; it does not claim
  that every non-signing record was always encrypted or that injected same-origin code cannot
  bypass a client interface.
- The passkey unlocks encrypted data stored for this site/browser. It is not a wallet recovery
  phrase, an additional signer or a replacement for the required approval rule. A passkey alone
  in an empty browser cannot reconstruct missing share files.

## Activation safeguards

The existing encryption, WebAuthn options and vault serialization remain unchanged. Activation
uses the existing Web Locks coordination facility and refuses to replace a vault created by
another tab. Source-storage reads are checked again after the credential prompt, before a new
sealed record can replace readable data. Failed or partially completed activation preserves
recovery/export access rather than treating a temporary in-memory vault value as success.
Known personal-account copies in IndexedDB must also be removed and their absence checked.
Unlock never deletes a leftover plaintext share, key, chat or recipient record unless its data
is covered by the verified encrypted copy. Extra or unreadable records remain untouched and
keep only new setup blocked until reviewed.

PRF support must be confirmed from the actual credential operations. A successful generic
passkey registration alone is not proof that this vault can be unlocked. This follows the
[W3C PRF extension design](https://github.com/w3c/webauthn/blob/main/explainers/prf-extension.md).

## Single-approval configurations

The separately requested 1-of-1 and 1-of-2 configurations require different custody/signing
support. Actual main binaries reject both. The [concrete engineering review](single-approval-wallet-review.md)
records the required decisions; the UI does not enable broken configurations.

## Validation

| Check | Result |
| --- | --- |
| Node 24 regression | 50 suites passed, including 24 passkey failure/completion cases |
| Registered fast suite | 40 tests passed |
| Strict lint | 160 JavaScript and two Python files passed |
| Before browser journey | 180 checks, 43 captures, no uncaught errors |
| Final browser journey | 314 checks, 74 captures, no uncaught errors |
| Web-only scope/privacy | Native paths match main; 349 PNGs have no text/EXIF chunks |

The full browser journey uses actual WebAuthn registration and PRF assertions with Chrome virtual
authenticators in three independent stores. It checks cancellation, unsupported PRF, pending
protection, no unprotected continuation, access to recovery, and reload/unlock with the same
credential. Views cover 320/390/768/1440px, light/dark/system, actual doubled text, reduced
motion/transparency and forced colors, including keyboard access above the sticky dialog footer.
Physical biometrics, security keys and passkey-provider synchronization remain unverified.

Chrome rejects passkey creation for the numeric loopback host in the local preview. Successful
journeys therefore use `localhost`; the numeric-host failure is tested explicitly and explains
the alternative. `localhost` and `127.0.0.1` keep separate browser data. No wallet data is silently
moved between those origins. The user's original preview remains available at its original URL.

The earlier interface is captured as the before state. Final evidence uses unfunded wallets and
synthetic chain display data. No funded transaction or live RPC/prover operation is claimed.
The welcome's final one-line orientation update was captured separately after the full journey.

- [Browser results](web-passkey-after-validation.json)
- [Node results](web-passkey-regression-validation.json)
- [Before results](web-passkey-before-validation.json)

| Required first step | Confirmed protection |
| --- | --- |
| ![Passkey required](visuals/web-passkey/after/26-passkey-first-390-light.png) | ![Protected browser](visuals/web-passkey/after/29-passkey-protected.png) |
