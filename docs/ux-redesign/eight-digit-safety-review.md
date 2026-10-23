# Eight-digit safety check: security review proposal

Status: requested for review, not implemented. Reference main: `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.
The current thirty-digit comparison and acknowledgement remain unchanged in this PR.

## Current mechanism

`wasm/src/ceremony.rs` binds the wallet, rule, network and all participating device encryption keys
into a thirty-digit safety number. `web/app-setup.js`
requires comparing the actual full number and
acknowledging a match before proceeding. The eight-digit quick code in `web/setup-model.js` is
only a locator for that number, not an authentication check.

Thirty decimal digits carry about 100 bits; eight carry about 27 bits. Simply truncating the
existing number makes accidental matches and deliberate collision searches much easier. A
short code also needs analysis of an attacker presenting different views to different devices;
it cannot be assessed only as a random one-shot guess.

## Proposed engineering review

1. Specify the threat model: compromised server/invite channel, substituted devices or keys,
   repeated setup attempts, different views shown to different devices, and human comparison errors.
2. Compare alternatives: retain the full number with better grouping; compare an authenticated QR
   of the full fingerprint with an accessible manual fallback; or a new short authentication
   protocol with commitment ordering and appropriate attempt limits. An eight-digit display alone
   must not silently replace verification of the full binding.
3. If a short-code protocol is chosen, define its exact authenticated transcript, commitment timing,
   randomness, downgrade protection, version negotiation and failure/stop behavior. Review whether
   meaningful attempt limits can be enforced without trusting the potentially hostile server.
4. Obtain cryptographic/security review and document the accepted security strength before coding.
5. Version the protocol explicitly. Older clients must reject unsupported requirements safely;
   never interpret an old thirty-digit confirmation as approval of a new short-code ceremony.
6. Test malicious transcript substitutions, split views, replay/downgrade attempts, interrupted setup,
   cross-version devices and mismatches, alongside accessibility and human comparison testing.

## Decisions needed before implementation

- Is improved readability sufficient, or is an eight-digit-only check a firm requirement?
- Which attack resistance and attempt model are acceptable for a financial wallet?
- Should full-fingerprint QR comparison be the preferred path with thirty-digit manual fallback?
- Who will approve the protocol and compatibility design before the shorter check is enabled?

No cryptography, acknowledgement, safety binding or signer eligibility was changed by this proposal.
