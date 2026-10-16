//! A stand-in for the shielded pool at its program id. There it accepts only `transact` (tag 16)
//! whose last account, the owner, signs; the tests read what it received from the inner
//! instructions. At any other address it accepts every instruction: it stands for a program
//! that an attacker deploys.

use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};

pinocchio::entrypoint!(process_instruction);

/// sppU489D7A4U1exNo1oeMGZtLEofq3a6o2fR7UeoWB6
const POOL_ID: Address = Address::new_from_array([
    13, 5, 27, 223, 81, 46, 238, 38, 11, 21, 75, 117, 129, 42, 173, 235, 128, 207, 186, 54, 100,
    214, 57, 55, 88, 166, 92, 51, 242, 53, 239, 61,
]);
const TRANSACT: u8 = 16;

pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    if program_id != &POOL_ID {
        return Ok(());
    }
    if data.first() != Some(&TRANSACT) {
        return Err(ProgramError::InvalidInstructionData);
    }
    let owner = accounts.last().ok_or(ProgramError::NotEnoughAccountKeys)?;
    if !owner.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    Ok(())
}
