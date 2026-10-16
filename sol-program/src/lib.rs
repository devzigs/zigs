//! Zigs minimal multisig (SOL-35 spike). A FROST-Ed25519 group approves a shielded payment once,
//! as a detached signature over a proposal account. Any executor later proves the payment with
//! fresh roots and settles it through the shielded pool, signing as the group's owner PDA.
//!
//! Limits: private transfers and SOL withdrawals only (no deposit, no SPL leg, no cache, inline
//! owner tags).

pub mod approval;
pub mod cluster;
pub mod error;
pub mod instructions;
pub mod state;

use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};

#[cfg(all(feature = "bpf-entrypoint", not(feature = "no-entrypoint")))]
mod entrypoint {
    pinocchio::entrypoint!(crate::process_instruction);
}

pub mod tag {
    pub const CREATE: u8 = 0;
    pub const EXECUTE: u8 = 1;
    pub const CANCEL: u8 = 2;
    pub const CLOSE_CANCELLED: u8 = 3;
}

pub const PROPOSAL_SEED: &[u8] = b"proposed_transaction";
pub const OWNER_SEED: &[u8] = b"multisig";
pub const CANCEL_SEED: &[u8] = b"cancelled_transaction";

/// Versioned domain of the approval message. The group key signs nothing else under it.
pub const APPROVAL_DOMAIN: &[u8] = b"Zigs_SolApproval_v1";

/// The genesis hash of the cluster of this build (`cluster.rs`): an approval for one cluster never
/// verifies on another.
pub const DEPLOYMENT_ID: [u8; 32] = cluster::GENESIS.to_bytes();

pub const ED25519_PROGRAM_ID: Address =
    Address::from_str_const("Ed25519SigVerify111111111111111111111111111");
pub const SYSTEM_PROGRAM_ID: Address = Address::from_str_const("11111111111111111111111111111111");

pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let (ix_tag, data) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;
    match *ix_tag {
        tag::CREATE => instructions::create(program_id, accounts, data),
        tag::EXECUTE => instructions::execute(program_id, accounts, data),
        tag::CANCEL => instructions::cancel(program_id, accounts, data),
        tag::CLOSE_CANCELLED => instructions::close_cancelled(program_id, accounts, data),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
