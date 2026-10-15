//! The hashes of ZOLANA.md section 5, through `zolana-hasher`: the Poseidon, `hash_bytes` and
//! owner identity that the program and the circuit compute (Zolana commit 89640630).
//!
//! References, all under the repo root: docs/spec.md "Owner Hash" 304-315, "UTXO Hash" 603-616,
//! "Nullifier" 617-626, "Empty UTXO" 664-687; sdk-libs/transaction/src/utxo/hash.rs 34-49,
//! utxo/note.rs 40-61 and utxo/output.rs 132-154; sdk-libs/keypair/src/nullifier_key.rs 35-47.

use zolana_hasher::primitives::{hash_bytes, right_align, solana_owner_identity};
use zolana_hasher::{Hasher, Poseidon};

use crate::consts::Key;

/// `UtxoDomain` and `DummyDomain` (`program-libs/interface/src/lib.rs:25-27`).
pub const UTXO_DOMAIN: u16 = 3;
pub const DUMMY_DOMAIN: u16 = 1;

/// The id of the one tree that the spike uses (tree 0). Every UTXO of the group is hashed under
/// it: `tests/repo_pins.rs` ties the tree address to this id.
pub const TREE_ID: u16 = 0;

/// Poseidon over `N` 32-byte field elements. An input at or above the BN254 modulus is an error.
///
/// The count is a const generic, not a slice length: with a length known at compile time the
/// linker keeps the round constants of that width only. A slice of runtime length keeps the
/// tables of every width and adds 1.4 MB to the wasm (`logs/wasm-size.txt`).
pub fn poseidon<const N: usize>(inputs: &[&[u8]; N]) -> Result<Key, String> {
    Poseidon::hashv(inputs).map_err(|why| format!("poseidon: {why}"))
}

/// ASCII `"TXOS"` and `"TXOB"`: the output blinding seed and the output blinding
/// (`sdk-libs/program/src/derivation.rs`, `prover/.../spp_transaction/shared/derivation.go`).
const DOMAIN_OUTPUT_SEED: u32 = 0x5458_4f53;
const DOMAIN_OUTPUT_BLINDING: u32 = 0x5458_4f42;

/// `Poseidon(TXOS, first_nullifier, blinding_seed)`: the seed that every output blinding of one
/// transaction comes from. The circuit derives it from its private root `blinding_seed`
/// (`transaction.go:193`), so an arbitrary seed of this kind may have no root and no proof.
pub fn output_seed(first_nullifier: &Key, blinding_seed: &Key) -> Result<Key, String> {
    poseidon(&[
        &right_align(&DOMAIN_OUTPUT_SEED.to_be_bytes()),
        first_nullifier,
        &right_align(blinding_seed),
    ])
}

/// `Poseidon(TXOB, first_nullifier, output_seed, slot)`: the blinding that the circuit forces on
/// the output at the final position `slot` (`transaction.go:196`), padding slots included.
pub fn output_blinding(first_nullifier: &Key, output_seed: &Key, slot: u32) -> Result<Key, String> {
    poseidon(&[
        &right_align(&DOMAIN_OUTPUT_BLINDING.to_be_bytes()),
        first_nullifier,
        &right_align(output_seed),
        &right_align(&slot.to_be_bytes()),
    ])
}

/// The field element of a raw `u16` tree id (`tree_slot.rs:70`).
fn tree_field(tree_id: u16) -> Key {
    right_align(&tree_id.to_be_bytes())
}

/// `nullifier_pk := Poseidon(nullifier_secret)` (spec "Nullifier Key", line 361).
pub fn nullifier_pk(secret: &[u8; 31]) -> Result<Key, String> {
    poseidon(&[&right_align(secret)])
}

/// `owner_hash := Poseidon(owner_proof_input_hash(signing_pk), nullifier_pk)`. A Solana owner (an
/// Ed25519 key or a PDA) hashes as `hash_bytes_33(0x53 || key)`.
pub fn owner_hash(signer: &Key, nullifier_pk: &Key) -> Result<Key, String> {
    poseidon(&[&owner_identity(signer)?, nullifier_pk])
}

/// `owner_proof_input_hash` of a Solana key: `hash_bytes_33(0x53 || key)`.
pub fn owner_identity(signer: &Key) -> Result<Key, String> {
    solana_owner_identity(signer).map_err(|why| format!("owner identity: {why}"))
}

/// `hash_bytes_32(mint)`, the asset field of a UTXO hash.
pub fn asset_field(mint: &Key) -> Result<Key, String> {
    hash_bytes(mint).map_err(|why| format!("asset: {why}"))
}

/// A default-ring UTXO without ring or application data.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Utxo {
    pub owner_hash: Key,
    pub mint: Key,
    pub amount: u64,
    pub blinding: Key,
}

impl Utxo {
    /// `Poseidon(domain, tree_id, asset, amount, data_hash, ring_hash, owner_utxo_hash)` with
    /// `data_hash = 0` and `ring_hash = Poseidon(0, 0)` (no data, no ring program).
    pub fn hash(&self, tree_id: u16) -> Result<Key, String> {
        let ring = poseidon(&[&[0; 32], &[0; 32]])?;
        let owner = poseidon(&[&self.owner_hash, &self.blinding])?;
        poseidon(&[
            &right_align(&UTXO_DOMAIN.to_be_bytes()),
            &tree_field(tree_id),
            &asset_field(&self.mint)?,
            &right_align(&self.amount.to_be_bytes()),
            &[0; 32],
            &ring,
            &owner,
        ])
    }

    /// `Poseidon(utxo_hash, blinding, nullifier_secret)` (spec "Nullifier").
    pub fn nullifier(&self, tree_id: u16, secret: &[u8; 31]) -> Result<Key, String> {
        poseidon(&[&self.hash(tree_id)?, &self.blinding, &right_align(secret)])
    }
}

/// The hash of an empty output: `DummyDomain`, owner 0, asset 0, amount 0 and only the blinding
/// set (spec "Empty UTXO"). Its owner is 0, so no key can ever spend it.
pub fn dummy_hash(blinding: &Key, tree_id: u16) -> Result<Key, String> {
    let ring = poseidon(&[&[0; 32], &[0; 32]])?;
    let owner = poseidon(&[&[0; 32], blinding])?;
    poseidon(&[
        &right_align(&DUMMY_DOMAIN.to_be_bytes()),
        &tree_field(tree_id),
        &[0; 32],
        &[0; 32],
        &[0; 32],
        &ring,
        &owner,
    ])
}
