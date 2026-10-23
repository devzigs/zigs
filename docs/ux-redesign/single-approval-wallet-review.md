# Single-approval wallet engineering review

Status: the user chose to keep core engineering separate from this web UI PR. Design decisions
and engineering approval are still required for implementation. No controls are enabled by this
document. Reference: main `3a6c08e58fcf4a5f84016a4f68c088aea1a8195b`, checked 21 October 2026.
This review covers web only. No merge or deployment is authorized.

## Requested behavior

- **1 of 1:** one device sets up and authorizes payments by itself. Losing that device and its
  recovery material loses access. There is no second-device approval or redundancy.
- **1 of 2:** either device can authorize a payment by itself. A second device provides access
  redundancy, but compromise of either device permits spending the entire wallet balance.
  This is different from requiring two independent approvals.
- A passkey protects locally stored material; it does not turn a one-approval rule into a
  two-device spending rule or recreate a lost share from an empty browser.

## Current engine results

Actual calls to the shipped main-compatible WASM binaries gave these results:

| Configuration | Shared shape validator | Zcash DKG | Solana DKG |
| --- | --- | --- | --- |
| 1 of 1 | Rejected | `InvalidMinSigners` | Device count must be 2–7 |
| 1 of 2 | Rejected | `InvalidMinSigners` | Approvals must be at least 2 |
| 2 of 2, control | Accepted | Accepted | Accepted |

The restrictions exist in `web/signed.js`, `wasm/src/ceremony.rs`, the pinned Zcash FROST
implementation invoked by `wasm/src/lib.rs`, and `wasm-sol/src/frost.rs`. The validator and
reviewed engine sources/binaries match main. Lowering only HTML limits or changing labels
would produce wallets the engines cannot form or sign for.

## Decisions before implementation

1. **Choose the single-approval custody mode.** Main's separate personal ZEC account already
   signs with one key. It is not the shared portfolio and does not supply equivalent Solana
   functionality. Decide whether to expose that existing account as a limited ZEC-only mode or
   design a complete single-approval portfolio mode for both chains.
2. **Define authority for 1 of 2.** Both devices need complete spending authority under the
   chosen protocol. Review how that authority is provisioned and checked, how accounts and
   nonces stay consistent, what each device can read, and the consequences of compromise.
   Do not silently repurpose a two-approval FROST share or copy its secrets as a UI shortcut.
3. **Version and compatibility.** Define explicit wallet-mode/shape handling so older web
   clients reject unsupported wallets safely. Preserve every existing 2-or-more-approval
   wallet, signature, safety check and recovery format. Decide whether new-mode recovery needs
   an explicit version rather than reinterpreting an existing threshold-share file.
4. **Recovery and rule changes.** Define the independently sufficient recovery material for
   each mode, its passkey relationship and clear risk warnings. Replacing or removing devices
   must not imply that a previously authorized device has lost authority without the required
   new-wallet/address transfer or a reviewed revocation mechanism.
5. **Acceptance evidence.** Demonstrate creation, receiving, private sending, public withdrawal
   where supported, cancellation, concurrent attempts and recovery on each supported chain.
   Prove either device can spend in 1 of 2; demonstrate safe behavior for the other device
   afterward. Re-run existing threshold, nonce, backup, mismatch and refusal regression cases.

Until those decisions and the resulting engineering changes are reviewed, this UI PR retains
the working minimum of two approvals. The requested configurations remain explicitly unavailable.
