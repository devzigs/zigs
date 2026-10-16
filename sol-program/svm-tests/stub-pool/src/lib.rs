//! A stand-in for the shielded pool at its program id. There it accepts only `transact` (tag 16)
//! and returns one signer flag per account as its return data, so the tests see which accounts
//! the program signed for. At any other address it accepts every instruction: it stands for a
//! program that an attacker deploys.

use pinocchio::{cpi::set_return_data, error::ProgramError, AccountView, Address, ProgramResult};

pinocchio::entrypoint!(process_instruction);

/// sppU489D7A4U1exNo1oeMGZtLEofq3a6o2fR7UeoWB6
const POOL_ID: Address = Address::new_from_array([
    13, 5, 27, 223, 81, 46, 238, 38, 11, 21, 75, 117, 129, 42, 173, 235, 128, 207, 186, 54, 100,
    214, 57, 55, 88, 166, 92, 51, 242, 53, 239, 61,
]);
const TRANSACT: u8 = 16;
/// The CPI of the program copies at most 24 accounts.
const MAX_ACCOUNTS: usize = 24;

pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    if program_id != &POOL_ID {
        return Ok(());
    }
    if data.first() != Some(&TRANSACT) || accounts.len() > MAX_ACCOUNTS {
        return Err(ProgramError::InvalidInstructionData);
    }
    let mut flags = [0u8; MAX_ACCOUNTS];
    for (flag, account) in flags.iter_mut().zip(accounts.iter()) {
        *flag = u8::from(account.is_signer());
    }
    set_return_data(&flags[..accounts.len()]);
    Ok(())
}
