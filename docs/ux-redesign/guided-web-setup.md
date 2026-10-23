# Guided web wallet setup

Technical reference: `main` at `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`.
This implementation applies to the web app only. It adds tutorial progress, optional signed
backup-status reports and saved-file verification around the existing wallet implementation.
There are no iPhone or Mac changes in this PR. No merge or deployment is authorized.

## Journey and readiness

The full-screen guide uses **Plan → Connect → Verify → Prepare → Back up**. The recommended
arrangement is any two of three independent devices. Advanced existing approval rules remain
available before creation. The reserve is a normal Zigs signing device: it connects for setup
and whenever needed for signing. A passkey unlocks a browser's shares; it adds no signing device.

`guided-setup-model.js` derives the current stage from existing filtered wallet facts. The host
reads joined devices, the actual safety number and confirmations, address verification, existing
stops/rejections/key disagreement, and the existing Solana setup summary. Reviewing an explanation
does not rerun a ceremony. Tutorial completion never feeds formation, signing or payment gates.

New wallets enter the guide. Joining devices see its companion flow. Established wallets keep
their keys and configuration and can reopen the explanations. Save and exit returns to the
wallet list with unfinished setup indicated; reopening derives the next step from current facts.
An uncreated plan is kept only in the open tab's memory, not in a new persistent draft record.

Open Overview requires the existing safety/address and requested-chain checks. Backups are now
optional: no download, reupload or password check is required to continue. A saved file counts
as partial progress. Reopening it remains an optional local check; remote saved/checked states
are signed reports, not independent inspection. A 2-of-3 wallet needs two usable independent
shares to recover without its devices; a single saved file is never labelled fully recoverable.

## Local tutorial record

The browser stores one JSON record in `localStorage` under `zf-guided-setup:<wallet-id>`.
The wallet ID must be 20 lowercase hexadecimal characters. The version-one shape is:

```text
{
  v: 1,
  review: null | integer 0..4,
  paused: boolean,
  completed: boolean,
  safety: null | the actual six groups of five safety-number digits,
  checked: {
    "<seat 1..7>": {
      zec: boolean,
      sol: boolean,
      zecFor: null | 64 lowercase hexadecimal SHA-256 characters,
      solFor: null | 64 lowercase hexadecimal SHA-256 characters
    }
  },
  solExpected: boolean
}
```

This is separate browser-local tutorial metadata, outside the existing passkey-sealed vault and
existing recovery files. It contains no labels, backup contents, filenames or passphrases.
Clearing site data can remove it. It is never a substitute for the existing encrypted backups.

A checked flag is displayed only when its stored hash matches the current share and its safety
binding still matches. The hash input is canonical JSON containing wallet ID, seat, chain and
stable local share fields. For ZEC it includes the key/public packages, group key, held setup
and identity secrets, version and room, plus wallet secret, approval rule, address and network.
For SOL it includes the key/public packages, group key, `solSeed`, cluster and local-proving pin.
Only the hash is stored in the tutorial record. Neither its input nor its hash is reported to
other devices. Hashing completion also rechecks the current wallet, safety number, local seat
ownership and existing address-check result before marking a file checked.

Unknown versions, extra fields and damaged records are not overwritten. Storage failures keep
an educational fallback in memory and show a specific error; they do not change wallet keys or
skip main's existing storage safeguards. A later successful write can persist the in-memory
progress. An unreadable existing record remains preserved.

## Optional device reports

Version-three wallets may publish one optional report at `groups/<wallet-id>/setupstatus/<seat>` through
the existing encrypted document store. The exact decrypted document shape is:

```text
{ v: 2, safety: "<actual safety number>", zecSaved: boolean, solSaved: boolean,
  zecChecked: boolean, solChecked: boolean, by: integer, sig: string }
```

The existing `signedDoc`/`docPayload` implementation signs the version, safety number and four status fields and binds the
wallet ID, `setupstatus/<seat>` path and writing seat. The reader requires an in-range seat,
the same seat in `by`, an accepted versioned shape, booleans, the current full safety number
and a valid signature from that seat's pinned signing key. Missing, unknown, malformed, stale,
wrong-writer and unverified reports are ignored. Older version-one checked-only reports remain readable; newer readers never infer checked
status from a saved-only flag. A checked flag must imply saved in version two. Local states
take precedence over reports for shares held here. Version-one/two wallets do not publish or accept unauthenticated reports;
legacy local file checks remain possible using their existing address/share state.

A valid signature authenticates a device's claim that it checked its own file. Another device
does not independently verify that file. There is no timestamp, freshness guarantee or remote
attestation of passkey protection. A device can later lose a file after reporting its check.
The UI therefore labels remote progress as reported. Reports contain no backup data, file names,
passphrases, share hashes, labels or protection claims.

The optional collection has its own watcher and reader. It is excluded from `filterWallet`,
wallet-wide `pending`/ignored counts and all custody/payment eligibility. `signed.js` retains
main's existing core path allowlist. The existing backend store and signature payload primitives
need no change; older clients simply do not subscribe to this additional collection.

Local marking finishes without waiting for a report write. Reports use the existing write
serialization helper per wallet and seat and read the latest locally checked flags before
dispatch. A ten-second warning does not release a pending write's queue; this prevents an older
delayed write from overwriting a newer report. Failure or absence of reports cannot prevent
setup completion or existing wallet operations. Read failures clear stale displayed reports,
and the UI provides a report retry action.

## Reopening a saved recovery file

Saving still uses main's existing encrypted backup format and in-memory encryption round trip.
It retains the existing `backupSaved` meaning: a download was saved. Reopening is a distinct
operation in `backup-check.js`; existing saved flags are never migrated into checked flags.

The file check requires an encrypted `zigs-backup` envelope, a passphrase and a file within the
one-million-byte limit, checking actual UTF-8 length as well as reported file size. It uses the
existing `backupOpen` engine call and compares the decrypted payload with a snapshot of the
already verified local share. ZEC checks kind, wallet, seat, literal key package, public package,
group key, wallet secret, approval rule, address/network and every held setup/identity field.
SOL checks kind, wallet, seat, Devnet cluster, key/public packages, group key, `solSeed` and any
required local-proving pin. The wrapper requires existing local address readiness, and SOL also
requires the existing ready, non-aborted Solana state.

After decryption, the wrapper compares that snapshot with current local state again before
marking it checked. A changed/closed wallet, wrong device, wrong chain, wrong passphrase or
damaged file leaves shares unchanged. The verifier never calls restore, imports keys, changes
nonces, joins a wallet or writes a file's contents into storage. Inputs and worker calls hold
the selected file and passphrase only for this local interaction.

## Existing protection and Solana behavior

The protection action invokes the existing passkey lock. The protected badge follows actual
vault state and successful lock completion. Cancellation, unsupported authenticators, missing
storage and incomplete locking have explicit instructions and never create a protected flag.
No new authentication primitive, platform-protection claim or remote lock attestation is added.

New web testnet wallets include Solana by default in final creation review, with the complete
service disclosure and an advanced opt-out. The final Create action uses the existing planSolana
intent/local consent mechanism. Missing service cannot load or start a ceremony, but the saved
intent can continue through the existing reactor after service returns and the wallet reloads. The local `solExpected` flag only keeps the tutorial waiting
for the intended chain; it cannot write `solAuto`, a group hint or a start document. If service
is unavailable the guide preserves Zcash progress, offers its recovery file controls and says:
“Solana setup is waiting for service availability. Your Zcash setup is saved.” Later preparation
still requires existing local consent and chain-specific checks. Older wallets without that
consent retain an explicit preparation action. Stops and key disagreement keep
their distinct existing instructions.

Initial preparation does not require funding public SOL fee addresses. Existing paid-operation
funding, nonce, proof and signing gates remain unchanged. USDC and swaps remain unavailable.
Overview now starts the existing guarded Solana balance sync, using a separate balance-viewed
flag so it cannot trigger workspace-only local-prover selftests. Session/key/RPC/visibility,
retry/backoff and current-wallet checks remain intact. This keeps the existing event-driven
cadence; it adds no continuous polling or new providers. Routine manual sync is removed, with
a failure-only retry under technical details.

Existing keys, recovery formats, encryption, signing primitives, backend services, payment
calculations and custody protocol are unchanged.

## Review checks

`web/test/guided-setup.mjs` covers derived stages, local completion with remote reports pending,
strict signed-report handling, wallet-gate isolation, opaque-record preservation, storage
failure, current-share hash invalidation, delayed report ordering and legacy local checks.
`web/test/backup-check.mjs` covers exact payload mismatches, the real backup cipher round trip
and checks without restore/storage/network/nonce mutation. The existing browser journey also
exercises a real unfunded three-device formation, separate saved/reopened ZEC files, pause/resume,
wrong passphrases/device files and report propagation. Final run results and visual evidence
are recorded separately in the validation documents; this design note makes no device-test or
funded-transaction claim.
