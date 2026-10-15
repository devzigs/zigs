//! Program address derivation, as in `solana-address` (`tests/cross.rs` compares them).

use curve25519_dalek::edwards::CompressedEdwardsY;
use sha2::{Digest, Sha256};

use crate::consts::Key;

const PDA_MARKER: &[u8] = b"ProgramDerivedAddress";

/// True if the 32 bytes decompress to an Ed25519 point (so no program can own them).
pub fn is_on_curve(key: &Key) -> bool {
    CompressedEdwardsY(*key).decompress().is_some()
}

/// `Address::create_with_seed`: SHA-256 over base, seed and owner.
pub fn create_with_seed(base: &Key, seed: &[u8], owner: &Key) -> Key {
    Sha256::new()
        .chain_update(base)
        .chain_update(seed)
        .chain_update(owner)
        .finalize()
        .into()
}

/// `Address::find_program_address`: the first bump from 255 down that is off the curve.
pub fn find_program_address(seeds: &[&[u8]], program: &Key) -> Option<(Key, u8)> {
    (0..=u8::MAX).rev().find_map(|bump| {
        let mut hasher = Sha256::new();
        seeds.iter().for_each(|seed| hasher.update(seed));
        hasher.update([bump]);
        hasher.update(program);
        hasher.update(PDA_MARKER);
        let address: Key = hasher.finalize().into();
        (!is_on_curve(&address)).then_some((address, bump))
    })
}
