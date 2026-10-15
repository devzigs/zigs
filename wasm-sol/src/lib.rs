//! The Solana message checker of the Zigs shared wallet, offline (ZOLANA.md section 5).
//!
//! `approve` is the one answer that an approval screen may act on. It takes the bytes of a v1
//! message, the intent, the approved plaintext (`Plan`), the pins and the device snapshot. It runs
//! the structure rules of `check_all` (the instruction list, limits, signers, lifetime, expiry and
//! the shape of `transact`; P3a) with the group `owner_hash` that it computes from the pins,
//! requires that the secrets of the device derive the pinned group keys, and for a spend runs the
//! Outputs, Legs and Ciphertexts rules (P3c): the blinding, the hash and the ciphertext of every
//! output, conservation, and the nullifiers of the snapshot.
//!
//! `check_all` and `check` run the structure rules only. A spend that passes them is not
//! approved.
//!
//! This crate (`wasm-sol`) adds to the checker, which is copied unchanged (CHECKER_PIN): `frost`
//! (the second DKG), `sign` (split FROST signing), `roles` (the role keys of `solSeed`) and
//! `codec` (the text forms). `wasm` holds every entry point of the browser.

#![warn(
    clippy::cognitive_complexity,
    clippy::expect_used,
    clippy::indexing_slicing,
    clippy::too_many_lines,
    clippy::unwrap_used
)]

pub mod address;
pub mod approve;
pub mod assets;
pub mod bytes;
pub mod check;
pub mod codec;
pub mod consts;
pub mod fixed;
pub mod frost;
pub mod hashes;
pub mod intent;
pub mod pda;
pub mod pins;
pub mod plan;
pub mod roles;
pub mod rule;
mod rules_ct;
mod rules_ix;
mod rules_legs;
mod rules_out;
mod rules_tx;
pub mod sign;
pub mod snapshot;
pub mod spend;
pub mod template;
pub mod transact;
pub mod v1;
pub mod viewing;
pub mod wasm;
