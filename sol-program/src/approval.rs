//! The approval message and the check of the Ed25519 precompile instruction that carries it.

use pinocchio::{sysvars::instructions::Instructions, AccountView};
use zolana_hasher::{Hasher, Sha256};

use crate::{error::MultisigError, APPROVAL_DOMAIN, DEPLOYMENT_ID, ED25519_PROGRAM_ID};

// Ed25519 precompile layout: u8 count, u8 padding, one 14-byte offsets record, then the blobs.
const OFFSETS_START: usize = 2;
const DATA_START: usize = OFFSETS_START + 14;
const PUBKEY_OFFSET: usize = DATA_START;
const SIGNATURE_OFFSET: usize = PUBKEY_OFFSET + 32;
const MESSAGE_OFFSET: usize = SIGNATURE_OFFSET + 64;
pub const ED25519_DATA_LEN: usize = MESSAGE_OFFSET + 32;

/// One signature, every blob in this instruction (`u16::MAX`), fixed offsets. Pinning the head
/// stops the precompile from reading the key, signature or message from another instruction.
pub const CANONICAL_HEAD: [u8; DATA_START] = {
    let offsets = [
        SIGNATURE_OFFSET as u16,
        u16::MAX,
        PUBKEY_OFFSET as u16,
        u16::MAX,
        MESSAGE_OFFSET as u16,
        32,
        u16::MAX,
    ];
    let mut head = [0u8; DATA_START];
    head[0] = 1;
    let mut i = 0;
    while i < offsets.len() {
        let le = offsets[i].to_le_bytes();
        head[OFFSETS_START + i * 2] = le[0];
        head[OFFSETS_START + i * 2 + 1] = le[1];
        i += 1;
    }
    head
};

/// `SHA-256(APPROVAL_DOMAIN || DEPLOYMENT_ID || program_id || proposal_address || body)`.
pub fn approval_digest(
    program_id: &[u8; 32],
    proposal: &[u8; 32],
    body: &[u8],
) -> Result<[u8; 32], MultisigError> {
    Sha256::hashv(&[APPROVAL_DOMAIN, &DEPLOYMENT_ID, program_id, proposal, body])
        .map_err(|_| MultisigError::BadApproval)
}

/// The instruction right before the current one must be the canonical Ed25519 verification of
/// `digest` under `multisig_pubkey`. The precompile itself has verified the signature.
pub fn check_approval(
    instructions_sysvar: &AccountView,
    multisig_pubkey: &[u8; 32],
    digest: &[u8; 32],
) -> Result<(), MultisigError> {
    let instructions =
        Instructions::try_from(instructions_sysvar).map_err(|_| MultisigError::MissingApproval)?;
    let approval = instructions
        .get_instruction_relative(-1)
        .map_err(|_| MultisigError::MissingApproval)?;
    if approval.get_program_id() != &ED25519_PROGRAM_ID || approval.num_account_metas() != 0 {
        return Err(MultisigError::MissingApproval);
    }
    if !is_canonical_approval(approval.get_instruction_data(), multisig_pubkey, digest) {
        return Err(MultisigError::BadApproval);
    }
    Ok(())
}

pub fn is_canonical_approval(data: &[u8], multisig_pubkey: &[u8; 32], digest: &[u8; 32]) -> bool {
    data.len() == ED25519_DATA_LEN
        && data[..DATA_START] == CANONICAL_HEAD
        && data[PUBKEY_OFFSET..SIGNATURE_OFFSET] == multisig_pubkey[..]
        && data[MESSAGE_OFFSET..] == digest[..]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex32(text: &str) -> [u8; 32] {
        core::array::from_fn(|i| u8::from_str_radix(&text[2 * i..2 * i + 2], 16).unwrap())
    }

    #[test]
    fn digest_matches_an_outside_sha256() {
        // Computed with an outside SHA-256 over the same concatenation, for each cluster.
        let (expected, genesis) = if cfg!(feature = "devnet") {
            (
                "a8df9883be45a5ec3b3909bf0b142b4a1a79e57eb855ed109bbcbb6e1120b939",
                "ce59db5080fc2c6d3bcf7ca90712d3c2e5e6c28f27f0dfbb9953bdb0894c03ab",
            )
        } else {
            (
                "f5f63b43477a643a321ba5edece824ca5f15038423dd104416a3d48015bf035e",
                "45296998a6f8e2a784db5d9f95e18fc23f70441a1039446801089879b08c7ef0",
            )
        };
        assert_eq!(
            approval_digest(&[1; 32], &[2; 32], &[3, 4, 5]).unwrap(),
            hex32(expected)
        );
        assert_eq!(DEPLOYMENT_ID, hex32(genesis));
    }

    fn canonical(key: &[u8; 32], digest: &[u8; 32]) -> Vec<u8> {
        let mut data = CANONICAL_HEAD.to_vec();
        data.extend(key);
        data.extend([9u8; 64]);
        data.extend(digest);
        data
    }

    #[test]
    fn approval_layout_is_pinned() {
        let (key, digest) = ([5u8; 32], [6u8; 32]);
        let good = canonical(&key, &digest);
        assert!(is_canonical_approval(&good, &key, &digest));
        assert!(!is_canonical_approval(&good, &[7; 32], &digest));
        assert!(!is_canonical_approval(&good, &key, &[7; 32]));
        assert!(!is_canonical_approval(
            &good[..good.len() - 1],
            &key,
            &digest
        ));
        for byte in 0..DATA_START {
            let mut bad = good.clone();
            bad[byte] ^= 1;
            assert!(
                !is_canonical_approval(&bad, &key, &digest),
                "head byte {byte}"
            );
        }
    }
}
