# zec-frost

A prototype t-of-n multisignature wallet for Zcash shielded funds. It uses re-randomized FROST threshold signatures (ZIP 312). It supports the Ironwood pool (NU6.3, v6 transactions) and the legacy Orchard pool (v5 transactions).

The status is **prototype**. Do not use it with real funds.

## What it does

1. A group of n people runs a distributed key generation (DKG). No dealer exists. No person ever holds the full spend key.
2. The group gets one shared shielded address and one shared viewing key. Every member verifies that the address really belongs to the group key.
3. Any t members co-sign a spend. The result is a normal Zcash transaction. On chain, it looks the same as a single-signer transaction.

## Quick start

```bash
cargo build --release
./target/release/zec-frost --dir /tmp/zf demo                      # 2-of-3, alice/bob/carol
./target/release/zec-frost --dir /tmp/zf2 demo --names a,b,c,d,e --threshold 3
bash tests/e2e.sh                                                   # 31 checks, ~25 s
```

The demo prints the shared `utest1…` address and the UFVK. Then it builds, signs and extracts one Ironwood (v6) transaction and one Orchard (v5) transaction.

## Step-by-step CLI (one command per person)

Each command is a separate process. A process reads public files and the secrets of one participant only. The `--dir` folder stands in for the network relay.

```bash
Z="./target/release/zec-frost --dir shared"

# Coordinator defines the group
$Z init --names alice,bob,carol --threshold 2

# Each participant, three rounds
$Z dkg-round1 --id 1     # and --id 2, --id 3
$Z dkg-round2 --id 1     # ...
$Z dkg-finish --id 1     # ...

# Coordinator builds the wallet; each participant verifies it
$Z wallet-create --network testnet
$Z wallet-verify --id 1  # ...

# Get an unsigned transaction (PCZT)
$Z tx-demo-create --session s1 --amount 100000           # fabricated funds, see limits
$Z tx-import      --session s1 --pczt unsigned.pczt      # or: a PCZT from a real wallet

# Signing: any 2 of 3
$Z sign-commit    --session s1 --id 1
$Z sign-commit    --session s1 --id 3
$Z sign-package   --session s1 --signers 1,3
$Z sign-share     --session s1 --id 1
$Z sign-share     --session s1 --id 3
$Z sign-aggregate --session s1      # writes sessions/s1/tx.hex
```

## How it works

### Keys

An Orchard or Ironwood full viewing key (FVK) has three parts: `ak`, `nk` and `rivk`.

- `ak` (spend validating key) controls spending. The prototype sets `ak` to the FROST group public key. Each person holds only a share of the matching secret `ask`.
- `nk` and `rivk` control viewing only. One party samples them from a random spending key. That party discards the spending key's `ask`. Everybody receives the FVK.

Orchard requires the y-coordinate sign bit of `ak` to be 0. The `reddsa` DKG normalizes the group key to "even y". It negates every share when necessary.

`wallet-verify` is an important check. The coordinator assembles the FVK, so a malicious coordinator could insert its own `ak`. Each participant compares the `ak` in the published FVK with the group key from their own DKG output. Each participant also re-derives the address.

### Signing

Each real spend has a signature under a randomized key `rk = ak + [alpha]G`. The transaction builder selects a fresh `alpha` for each spend. This makes spends unlinkable to the wallet. Re-randomized FROST adds `alpha` during signing. Thus the aggregate signature verifies under `rk`.

The prototype runs one FROST session for each spend. All sessions sign the same shielded sighash (ZIP 244).

Participants do not trust the coordinator. Before they publish a share, each participant does these steps:

- Parses the PCZT independently. It runs the PCZT Verifier role: `cv_net`, `rk` against the wallet FVK, nullifier and note commitment.
- Recomputes the sighash. Rejects the package if the sighash or a randomizer differs.
- Checks that the coordinator did not replace the participant's own nonce commitment.
- Shows each output, with its value and recipient (change or external).
- Deletes the nonces after use. This prevents nonce reuse.

The coordinator aggregates the shares with cheater detection. A bad share identifies its sender. Then the coordinator checks each signature with Orchard's own RedPallas code. The `pczt` crate attaches the signatures and extracts the transaction. Extraction verifies the Halo2 proof, every spend authorization signature and the binding signature.

## Code layout

| File | Content |
|---|---|
| `src/dkg.rs` | 3-round FROST DKG over RedPallas, group-key consistency check |
| `src/wallet.rs` | FVK and UFVK assembly from the group key, unified address, participant verification |
| `src/tx.rs` | PCZT import; demo PCZT builder for Ironwood and Orchard (fabricated note, one-leaf tree, real Halo2 proof) |
| `src/sign.rs` | PCZT inspection, commit / package / share / aggregate, signature attach and extraction |
| `src/store.rs` | File-based message board (stands in for a relay) |
| `tests/e2e.sh` | 3-of-5 flows and adversarial tests |

## Dependencies

The versions match the Zcash Foundation's `frost-tools` (August 2026):

- `reddsa` at git rev `ed49e9c`, with the `frost` feature. **Note:** `reddsa` 0.6.0 (25 September 2026) removed the `frost` feature. The changelog says the ciphersuites will move to the `ZcashFoundation/frost` repository. On 10 October 2026, that move was not yet published. Pin the git rev until a `frost-redpallas` crate is released.
- `frost-core` / `frost-rerandomized` 2.x
- `orchard` 0.15.5 (`unstable-frost`), `pczt` 0.8.0-rc.1, `zcash_primitives` 0.29, `zcash_keys` 0.15 (`unstable-frost`)

## What the tests cover

`tests/e2e.sh` runs these checks with a 3-of-5 group:

- DKG with separate processes. Round 2 stops if a round-1 package is missing.
- Every participant verifies the wallet. No full spend key is written to disk.
- A coordinator replaces `ak` with a key of another group. Participants reject the wallet.
- A package with fewer than t signers is refused. A participant that was not selected cannot sign.
- A tampered randomizer is rejected. A false sighash is rejected.
- A second share attempt fails because the nonces were deleted.
- A wrong share from signer 4 is detected, and the error names signer 4.
- Different quorums ({2,4,5} and {1,3,5}) produce valid transactions. Both pools are tested.
- The group refuses to sign a spend of notes that belong to another wallet.

## Known limits

- **No chain access.** The sandbox has no route to a Zcash node. `tx-demo-create` fabricates a note in a one-leaf note commitment tree on a local regtest chain. The proof, signatures, value balance and encryption are real. The anchor does not exist on testnet or mainnet. To spend real testnet funds: create a PCZT for the UFVK in a PCZT-capable wallet, then use `tx-import`.
- **Transport is not secure.** DKG round-2 packages are secret point-to-point messages. Here they are plain files. A production system must encrypt and authenticate them. ZF's `frost-client` and `frostd` use Noise channels for this.
- **Randomizer source.** The prototype uses the `alpha` that the transaction builder put in the PCZT, as ZF's `zcash-sign` does. `alpha` is fixed before nonce commitments, but the party that builds the PCZT selects it. Recent revisions of ZIP 312 discuss how to derive the randomizer. Check the final ZIP text before production.
- **No key refresh or repair.** FROST supports share refresh and repairable shares. The prototype does not use them.
- **Single-diversifier address.** The prototype shows only diversifier index 0. It does not scan the chain.
- **Pool status.** Since NU6.3 (28 July 2026), mainnet Orchard is withdraw-only through a turnstile. New funds go to Ironwood. Use the Ironwood path for new wallets.

## Conclusion

Zcash already has the components for shielded multisig. These are the FROST RedPallas ciphersuite, the `unstable-frost` key hooks in `orchard` and `zcash_keys`, and PCZT for signer handoff. The prototype joins these components into one full ceremony: DKG, shared address, verified wallet, threshold signing and a valid transaction. It works for the Ironwood pool and the legacy Orchard pool. To make it a product, these tasks remain: an encrypted relay, a real wallet backend (sync, note selection, PCZT creation), share refresh, and an audit. Also track the `reddsa` ciphersuite move and the final ZIP 312 randomizer rules.
