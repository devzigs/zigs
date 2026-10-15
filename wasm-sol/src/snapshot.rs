//! The device snapshot: what the approving device knows about its own wallet. The Outputs, Legs
//! and Ciphertexts rules (`approve`) read it. The proposer never supplies it.
//!
//! It holds the two role secrets, the UTXOs that the proposal spends, the fee schedule of the
//! tree and the salt history of the device. The asset ids are not here: they are pinned in
//! `assets.rs`. No type here derives `Debug`: nothing prints a secret.

use crate::bytes::{Reader, Short};
use crate::consts::Key;
use crate::hashes::nullifier_pk;
use crate::viewing::ViewingKey;

/// One input UTXO of the group: no ring program, no data, in tree 0. The owner is the group.
#[derive(Clone)]
pub struct InputUtxo {
    pub mint: Key,
    pub amount: u64,
    pub blinding: Key,
}

#[derive(Clone)]
pub struct Snapshot {
    // ponytail: the secrets are plain arrays and are not zeroized. Ceiling: they stay in the
    // wasm memory until the page ends, as the engine's own key package does.
    /// The 31-byte nullifier secret of the group (ZOLANA.md 4.2).
    pub nullifier_secret: [u8; 31],
    /// The P-256 viewing scalar of the group.
    pub viewing_sk: [u8; 32],
    /// The insertion fee per nullifier that tree 0 charges now (`TreeFeeSchedule`). The payer
    /// pays it in public SOL, so it is not a term of the shielded balance.
    pub fee_per_nullifier: u64,
    /// The inputs of the spend, in the order of the instruction.
    pub inputs: Vec<InputUtxo>,
    /// The (first nullifier, salt) of every earlier message of this device. The salt and the first
    /// nullifier fix the keystream of every output slot, so a pair may be used once. The list
    /// holds every earlier message, the earlier proofs of the same session included (a proof
    /// again after a stale root keeps the inputs), and never the bytes that are being checked:
    /// the device checks the same bytes again when it signs (ZOLANA.md 5, step 5). A page that
    /// lists the current pair by mistake gets a refusal, which fails closed.
    pub used_salts: Vec<(Key, [u8; 16])>,
}

impl Snapshot {
    /// The `nullifier_pk` and the `viewing_pk` that the secrets of the device derive.
    pub fn group_keys(&self) -> Result<(Key, [u8; 33]), String> {
        let viewing = ViewingKey::from_bytes(&self.viewing_sk)?;
        Ok((nullifier_pk(&self.nullifier_secret)?, viewing.public()?))
    }

    /// The wire form of the browser entry point: the secrets, the fee, the inputs, then the salt
    /// history.
    pub fn encode(&self) -> Result<Vec<u8>, String> {
        let count = |n: usize| u8::try_from(n).map_err(|_| "more than 255 inputs".to_string());
        let salts = u16::try_from(self.used_salts.len()).map_err(|_| "too many used salts")?;
        let mut out = self.nullifier_secret.to_vec();
        out.extend_from_slice(&self.viewing_sk);
        out.extend_from_slice(&self.fee_per_nullifier.to_le_bytes());
        out.push(count(self.inputs.len())?);
        for input in &self.inputs {
            out.extend_from_slice(&input.mint);
            out.extend_from_slice(&input.amount.to_le_bytes());
            out.extend_from_slice(&input.blinding);
        }
        out.extend_from_slice(&salts.to_le_bytes());
        for (first_nullifier, salt) in &self.used_salts {
            out.extend_from_slice(first_nullifier);
            out.extend_from_slice(salt);
        }
        Ok(out)
    }

    /// Reads the wire form. The whole input must be used.
    pub fn decode(bytes: &[u8]) -> Result<Self, String> {
        let short = |_: Short| "the snapshot ends inside a field".to_string();
        let mut r = Reader::new(bytes);
        let nullifier_secret = r.array().map_err(short)?;
        let viewing_sk = r.array().map_err(short)?;
        let fee_per_nullifier = r.u64().map_err(short)?;
        let mut inputs = Vec::new();
        for _ in 0..r.u8().map_err(short)? {
            inputs.push(InputUtxo {
                mint: r.array().map_err(short)?,
                amount: r.u64().map_err(short)?,
                blinding: r.array().map_err(short)?,
            });
        }
        let mut used_salts = Vec::new();
        for _ in 0..r.u16().map_err(short)? {
            used_salts.push((r.array().map_err(short)?, r.array().map_err(short)?));
        }
        if !r.is_empty() {
            return Err("bytes follow the snapshot".to_string());
        }
        Ok(Self {
            nullifier_secret,
            viewing_sk,
            fee_per_nullifier,
            inputs,
            used_salts,
        })
    }
}
