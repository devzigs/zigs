//! The four instructions of the spec, with the spike limits of `lib.rs`.

use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::{Allocate, Assign, CreateAccount, Transfer};
use zolana_hasher::{Hasher, Sha256};
use zolana_interface::instruction::{
    instruction_data::transact::{ExternalDataPreimage, OwnerTag, TransactIxDataRef},
    tag::TRANSACT,
};
use zolana_interface::verifying_keys::CircuitId;
use zolana_program::cpi::SppTransactAccounts;

use crate::{
    approval::{approval_digest, check_approval},
    error::MultisigError,
    state::{
        cancellation_expiry, cancellation_record, Proposal, CANCELLED_LEN, HEADER, KIND_CANCELLED,
        KIND_PROPOSAL,
    },
    CANCEL_SEED, OWNER_SEED, PROPOSAL_SEED, SYSTEM_PROGRAM_ID,
};

/// Bounds the account list the transact CPI copies onto the stack.
const MAX_SPP_ACCOUNTS: usize = 24;
/// Accounts of `execute` before the forwarded transact accounts.
const EXECUTE_PREFIX: usize = 6;

/// The Clock timestamp, refused when negative.
fn now() -> Result<u64, ProgramError> {
    let ts = Clock::get()?.unix_timestamp;
    u64::try_from(ts).map_err(|_| MultisigError::NegativeClock.into())
}

fn signer(account: &AccountView) -> ProgramResult {
    if account.is_signer() {
        Ok(())
    } else {
        Err(ProgramError::MissingRequiredSignature)
    }
}

/// Moves every lamport to `to` and closes `account`.
fn close_to(account: &mut AccountView, to: &mut AccountView) -> ProgramResult {
    let total = to
        .lamports()
        .checked_add(account.lamports())
        .ok_or(ProgramError::ArithmeticOverflow)?;
    to.set_lamports(total);
    account.set_lamports(0);
    account.close()
}

fn body_hash(body: &[u8]) -> Result<[u8; 32], ProgramError> {
    Sha256::hash(body).map_err(|_| MultisigError::BadProposalData.into())
}

/// The seeds of a proposal address, without the bump. The body hash gives each body its own
/// address and its own cancellation record, so a body that someone creates first for the same
/// commitment cannot block or cancel the body that the group signed.
fn proposal_seeds<'a>(proposal: &'a Proposal, body_hash: &'a [u8; 32]) -> [&'a [u8]; 4] {
    [
        PROPOSAL_SEED,
        &proposal.multisig_pubkey,
        &proposal.commitment,
        body_hash,
    ]
}

/// A live proposal of this program at its canonical address. Returns the stored data.
fn load_proposal(program_id: &Address, account: &AccountView) -> Result<Vec<u8>, ProgramError> {
    if !account.owned_by(program_id) {
        return Err(MultisigError::NotAProposal.into());
    }
    let data = account.try_borrow()?.to_vec();
    if data.len() < HEADER || data[0] != KIND_PROPOSAL {
        return Err(MultisigError::NotAProposal.into());
    }
    let proposal = Proposal::parse(&data[HEADER..])?;
    let hash = body_hash(proposal.body)?;
    let expected =
        Address::derive_address(&proposal_seeds(&proposal, &hash), Some(data[1]), program_id);
    if account.address() != &expected {
        return Err(MultisigError::BadProposalAddress.into());
    }
    Ok(data)
}

/// Creates a program account at a PDA. An address that someone funded first gets the shortfall,
/// then `Allocate` and `Assign` signed by the PDA, so a deposit cannot block the creation.
fn create_pda(
    payer: &AccountView,
    account: &AccountView,
    space: usize,
    owner: &Address,
    signer: &[Signer],
) -> ProgramResult {
    let rent = Rent::get()?.try_minimum_balance(space)?;
    if account.lamports() == 0 {
        let space = space as u64;
        return CreateAccount {
            from: payer,
            to: account,
            lamports: rent,
            space,
            owner,
        }
        .invoke_signed(signer);
    }
    let shortfall = rent.saturating_sub(account.lamports());
    if shortfall > 0 {
        Transfer {
            from: payer,
            to: account,
            lamports: shortfall,
        }
        .invoke()?;
    }
    Allocate {
        account,
        space: space as u64,
    }
    .invoke_signed(signer)?;
    Assign { account, owner }.invoke_signed(signer)
}

fn cancellation_address(program_id: &Address, proposal: &Address) -> (Address, u8) {
    Address::find_program_address(&[CANCEL_SEED, proposal.as_array()], program_id)
}

fn owner_address(program_id: &Address, group: &[u8; 32]) -> (Address, u8) {
    Address::find_program_address(&[OWNER_SEED, group], program_id)
}

/// The rent recipient of a new body must be an account that can take lamports and spend them:
/// not the owner PDA of the group, this program or the System Program (review R3). The body
/// cannot name its proposal or cancellation address: they derive from the body hash.
fn check_new_rent_recipient(program_id: &Address, proposal: &Proposal) -> ProgramResult {
    let recipient = Address::new_from_array(proposal.rent_recipient);
    let (owner, _) = owner_address(program_id, &proposal.multisig_pubkey);
    if [owner, *program_id, SYSTEM_PROGRAM_ID].contains(&recipient) {
        return Err(MultisigError::RentRecipientNotAllowed.into());
    }
    Ok(())
}

fn check_rent_recipient(proposal: &Proposal, account: &AccountView) -> ProgramResult {
    if account.address().as_array() != &proposal.rent_recipient {
        return Err(MultisigError::RentRecipientMismatch.into());
    }
    Ok(())
}

/// Accounts: payer (signer, writable), proposal (writable), system program.
/// Data: the proposal body (see `state.rs`).
pub fn create(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [payer, proposal_account, system] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    signer(payer)?;
    if system.address() != &SYSTEM_PROGRAM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    let proposal = Proposal::parse(data)?;
    if proposal.expiry_unix_ts <= now()? {
        return Err(MultisigError::ExpiryNotInFuture.into());
    }
    check_new_rent_recipient(program_id, &proposal)?;
    let hash = body_hash(data)?;
    let [prefix, group, commitment, hash] = proposal_seeds(&proposal, &hash);
    let (address, bump) =
        Address::find_program_address(&[prefix, group, commitment, hash], program_id);
    if proposal_account.address() != &address {
        return Err(MultisigError::BadProposalAddress.into());
    }
    let bump_seed = [bump];
    let seeds = [
        Seed::from(prefix),
        Seed::from(group),
        Seed::from(commitment),
        Seed::from(hash),
        Seed::from(&bump_seed),
    ];
    let space = HEADER + data.len();
    create_pda(
        payer,
        proposal_account,
        space,
        program_id,
        &[Signer::from(&seeds)],
    )?;
    let mut stored = proposal_account.try_borrow_mut()?;
    stored[0] = KIND_PROPOSAL;
    stored[1] = bump;
    stored[HEADER..].copy_from_slice(data);
    Ok(())
}

/// The transact must be a default-ring private transfer with inline owner tags.
fn check_transact_shape(ix: &TransactIxDataRef) -> ProgramResult {
    let default_ring = matches!(ix.circuit, CircuitId::ConfidentialEddsa(..));
    let inline_tags = ix
        .outputs
        .iter()
        .all(|output| matches!(output.owner_tag, OwnerTag::Inline(_)));
    if !default_ring || !ix.interface_transfers.is_empty() || !inline_tags {
        return Err(MultisigError::UnsupportedTransact.into());
    }
    Ok(())
}

/// `SHA-256(private_tx_hash || external_data_hash)`, the external-data hash computed as the pool
/// computes it. With no interface transfer and only inline tags, its preimage is the transact tag
/// and the serialized external-data prefix.
pub fn authorization_commitment(
    ix: &TransactIxDataRef,
    prefix: &[u8],
) -> Result<[u8; 32], ProgramError> {
    check_transact_shape(ix)?;
    let tag = [TRANSACT];
    let external = ExternalDataPreimage::new(&tag, prefix)
        .finish()
        .map_err(|_| MultisigError::UnsupportedTransact)?;
    let commitment = Sha256::hashv(&[ix.private_tx_hash, &external])
        .map_err(|_| MultisigError::UnsupportedTransact)?;
    Ok(commitment)
}

/// The forwarded accounts must be exactly the pool's layout for this transact: payer, output
/// tree, pool, system, one tree per context, one nullifier PDA per input, then the owner PDA as
/// the only owner signer and nothing after it. So the pool and this program read one layout.
fn check_spp_accounts(
    spp: &[AccountView],
    ix: &TransactIxDataRef,
    payer: &Address,
    owner: &Address,
) -> ProgramResult {
    let expected = 4 + ix.tree_contexts.len() + ix.inputs.len() + 1;
    let fits = spp.len() == expected && expected <= MAX_SPP_ACCOUNTS;
    let (last, rest) = spp.split_last().ok_or(MultisigError::BadSppAccounts)?;
    let owner_only_last = last.address() == owner && rest.iter().all(|a| a.address() != owner);
    if !fits || !owner_only_last || rest[0].address() != payer {
        return Err(MultisigError::BadSppAccounts.into());
    }
    Ok(())
}

/// Accounts: payer (signer, writable), proposal (writable), owner PDA, cancellation PDA, rent
/// recipient (writable), instructions sysvar, then the transact accounts. Data: the transact
/// instruction data without its tag. The instruction before this one is the Ed25519 approval.
pub fn execute(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    if accounts.len() <= EXECUTE_PREFIX {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    let (head, spp) = accounts.split_at_mut(EXECUTE_PREFIX);
    let [payer, proposal_account, owner, cancellation, rent_recipient, sysvar] = head else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    signer(payer)?;
    let stored = load_proposal(program_id, proposal_account)?;
    let proposal = Proposal::parse(&stored[HEADER..])?;
    let (cancel_address, _) = cancellation_address(program_id, proposal_account.address());
    if cancellation.address() != &cancel_address {
        return Err(MultisigError::BadCancellationAddress.into());
    }
    if cancellation.owned_by(program_id) {
        return Err(MultisigError::Cancelled.into());
    }
    if now()? > proposal.expiry_unix_ts {
        return Err(MultisigError::Expired.into());
    }
    check_rent_recipient(&proposal, rent_recipient)?;
    let digest = approval_digest(
        program_id.as_array(),
        proposal_account.address().as_array(),
        proposal.body,
    )?;
    check_approval(sysvar, &proposal.multisig_pubkey, &digest)?;
    let (ix, prefix) = TransactIxDataRef::parse_with_external_data_prefix(data)
        .map_err(|_| MultisigError::UnsupportedTransact)?;
    if authorization_commitment(&ix, prefix)? != proposal.commitment {
        return Err(MultisigError::CommitmentMismatch.into());
    }
    let (owner_address, bump) = owner_address(program_id, &proposal.multisig_pubkey);
    if owner.address() != &owner_address {
        return Err(MultisigError::BadOwnerAddress.into());
    }
    check_spp_accounts(spp, &ix, payer.address(), &owner_address)?;
    let signer_pdas = [&owner_address];
    let transact = SppTransactAccounts::new(spp, &signer_pdas)?;
    let bump_seed = [bump];
    let seeds = [
        Seed::from(OWNER_SEED),
        Seed::from(&proposal.multisig_pubkey),
        Seed::from(&bump_seed),
    ];
    transact.invoke::<MAX_SPP_ACCOUNTS>(data, &[Signer::from(&seeds)])?;
    close_to(proposal_account, rent_recipient)
}

/// Creates the cancellation record. A record that exists is the record of this body: its address
/// derives from the proposal address, which binds the body. So it stays as it is.
fn record_cancellation(
    program_id: &Address,
    payer: &AccountView,
    cancellation: &mut AccountView,
    proposal_address: &Address,
    proposal: &Proposal,
) -> ProgramResult {
    let (address, bump) = cancellation_address(program_id, proposal_address);
    if cancellation.address() != &address {
        return Err(MultisigError::BadCancellationAddress.into());
    }
    if cancellation.owned_by(program_id) {
        return Ok(());
    }
    let bump_seed = [bump];
    let seeds = [
        Seed::from(CANCEL_SEED),
        Seed::from(proposal_address.as_array()),
        Seed::from(&bump_seed),
    ];
    create_pda(
        payer,
        cancellation,
        CANCELLED_LEN,
        program_id,
        &[Signer::from(&seeds)],
    )?;
    let record = cancellation_record(bump, proposal.expiry_unix_ts, &proposal.rent_recipient);
    cancellation.try_borrow_mut()?.copy_from_slice(&record);
    Ok(())
}

/// Accounts: payer (signer, writable), proposal (writable), cancellation PDA (writable), rent
/// recipient (writable), system program, and an abort authority (signer) before expiry.
pub fn cancel(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    if !data.is_empty() || accounts.len() < 5 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let (head, tail) = accounts.split_at_mut(5);
    let [payer, proposal_account, cancellation, rent_recipient, system] = head else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    signer(payer)?;
    if system.address() != &SYSTEM_PROGRAM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }
    let stored = load_proposal(program_id, proposal_account)?;
    let proposal = Proposal::parse(&stored[HEADER..])?;
    check_rent_recipient(&proposal, rent_recipient)?;
    if now()? <= proposal.expiry_unix_ts {
        let authority = tail.first().ok_or(MultisigError::NotAbortAuthority)?;
        if !authority.is_signer() || !proposal.is_abort_authority(authority.address().as_array()) {
            return Err(MultisigError::NotAbortAuthority.into());
        }
        let proposal_address = *proposal_account.address();
        record_cancellation(
            program_id,
            payer,
            cancellation,
            &proposal_address,
            &proposal,
        )?;
    }
    close_to(proposal_account, rent_recipient)
}

/// Accounts: payer (signer), proposal address, cancellation PDA (writable), rent recipient
/// (writable). Anyone may close a record after its expiry.
pub fn close_cancelled(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    let [payer, proposal_address, cancellation, rent_recipient] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    signer(payer)?;
    if !data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }
    if !cancellation.owned_by(program_id) {
        return Err(MultisigError::NotACancellation.into());
    }
    let record: [u8; CANCELLED_LEN] = cancellation
        .try_borrow()?
        .as_ref()
        .try_into()
        .map_err(|_| MultisigError::NotACancellation)?;
    let expected = Address::derive_address(
        &[CANCEL_SEED, proposal_address.address().as_array()],
        Some(record[1]),
        program_id,
    );
    if record[0] != KIND_CANCELLED || cancellation.address() != &expected {
        return Err(MultisigError::NotACancellation.into());
    }
    let expiry = cancellation_expiry(&record);
    if now()? <= expiry {
        return Err(MultisigError::NotExpired.into());
    }
    if rent_recipient.address().as_array()[..] != record[10..] {
        return Err(MultisigError::RentRecipientMismatch.into());
    }
    close_to(cancellation, rent_recipient)
}
