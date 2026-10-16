//! The approval: exactly one Ed25519 precompile verification, with all its data in its own
//! instruction, directly before `execute`, by the group key, over the digest of 7.2.

use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction_error::TransactionError;
use zigs_min_multisig_svm_tests::{
    approval_ix, code, digest_with, execute_ix, refused_with, sample_transact, serialize, Body,
    Rig, DOMAIN, ED25519_ID, INSTRUCTIONS_SYSVAR, PROGRAM_ID, SYSTEM_ID,
};

/// A rig with a created proposal of the sample transfer.
fn proposed() -> (Rig, Body, Vec<u8>) {
    let mut rig = Rig::new();
    let transact = serialize(&sample_transact());
    let body = rig.body(&transact);
    rig.create(&body).expect("create");
    (rig, body, transact)
}

fn execute(rig: &Rig, body: &Body, transact: &[u8]) -> Instruction {
    execute_ix(rig.metas(body, &sample_transact()), transact)
}

fn self_transfer(rig: &Rig) -> Instruction {
    let payer = rig.payer.pubkey();
    let mut data = 2u32.to_le_bytes().to_vec();
    data.extend(1u64.to_le_bytes());
    Instruction::new_with_bytes(
        SYSTEM_ID,
        &data,
        vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(payer, false),
        ],
    )
}

#[test]
fn group_approval_settles() {
    let (mut rig, body, transact) = proposed();
    let ix = execute(&rig, &body, &transact);
    let approval = approval_ix(&rig.group, &body.digest());
    rig.send(&[approval, ix], &[]).expect("execute");
    assert!(!rig.exists(&body.proposal()), "execute closes the proposal");
}

#[test]
fn precompile_checks_the_signature() {
    let (mut rig, body, transact) = proposed();
    let mut approval = approval_ix(&rig.group, &body.digest());
    approval.data[48] ^= 1;
    let result = rig.send(&[approval, execute(&rig, &body, &transact)], &[]);
    let failure = result.expect_err("a changed signature byte fails");
    assert!(
        matches!(failure.err, TransactionError::InstructionError(0, _)),
        "the precompile itself must refuse: {:?}",
        failure.err
    );
}

#[test]
fn refuses_execute_without_an_approval() {
    let (mut rig, body, transact) = proposed();
    let ix = execute(&rig, &body, &transact);
    assert_eq!(refused_with(rig.send(&[ix], &[])), code::MISSING_APPROVAL);
}

#[test]
fn refuses_another_instruction_before_execute() {
    let (mut rig, body, transact) = proposed();
    let ixs = [self_transfer(&rig), execute(&rig, &body, &transact)];
    assert_eq!(refused_with(rig.send(&ixs, &[])), code::MISSING_APPROVAL);
}

#[test]
fn refuses_an_approval_that_is_not_directly_before_execute() {
    let (mut rig, body, transact) = proposed();
    let approval = approval_ix(&rig.group, &body.digest());
    let ixs = [
        approval,
        self_transfer(&rig),
        execute(&rig, &body, &transact),
    ];
    assert_eq!(refused_with(rig.send(&ixs, &[])), code::MISSING_APPROVAL);
}

#[test]
fn refuses_an_approval_with_accounts() {
    let (mut rig, body, transact) = proposed();
    let mut approval = approval_ix(&rig.group, &body.digest());
    approval
        .accounts
        .push(AccountMeta::new_readonly(rig.payer.pubkey(), false));
    let ixs = [approval, execute(&rig, &body, &transact)];
    assert_eq!(refused_with(rig.send(&ixs, &[])), code::MISSING_APPROVAL);
}

#[test]
fn refuses_a_forged_instructions_sysvar() {
    let (mut rig, body, transact) = proposed();
    let approval = approval_ix(&rig.group, &body.digest());
    let mut ix = execute(&rig, &body, &transact);
    assert_eq!(ix.accounts[5].pubkey, INSTRUCTIONS_SYSVAR);
    ix.accounts[5] = AccountMeta::new_readonly(Pubkey::new_unique(), false);
    assert_eq!(
        refused_with(rig.send(&[approval, ix], &[])),
        code::MISSING_APPROVAL
    );
}

#[test]
fn refuses_another_signer() {
    let (mut rig, body, transact) = proposed();
    let approval = approval_ix(&Keypair::new(), &body.digest());
    let ixs = [approval, execute(&rig, &body, &transact)];
    assert_eq!(refused_with(rig.send(&ixs, &[])), code::BAD_APPROVAL);
}

/// Each part of the digest matters: a group signature over a digest with one part changed
/// does not approve this proposal.
#[test]
fn refuses_a_digest_with_one_part_changed() {
    let (mut rig, body, transact) = proposed();
    let proposal = body.proposal();
    let genesis = Pubkey::from_str_const("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
    let mainnet = Pubkey::from_str_const("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d");
    let mut later = body.clone();
    later.expiry += 1;
    let digests = [
        digest_with(
            b"Zigs_SolApproval_v2",
            &genesis,
            &PROGRAM_ID,
            &proposal,
            &body.bytes(),
        ),
        digest_with(DOMAIN, &mainnet, &PROGRAM_ID, &proposal, &body.bytes()),
        digest_with(
            DOMAIN,
            &genesis,
            &Pubkey::new_unique(),
            &proposal,
            &body.bytes(),
        ),
        digest_with(
            DOMAIN,
            &genesis,
            &PROGRAM_ID,
            &Pubkey::new_unique(),
            &body.bytes(),
        ),
        digest_with(DOMAIN, &genesis, &PROGRAM_ID, &proposal, &later.bytes()),
    ];
    for digest in digests {
        let ixs = [
            approval_ix(&rig.group, &digest),
            execute(&rig, &body, &transact),
        ];
        assert_eq!(refused_with(rig.send(&ixs, &[])), code::BAD_APPROVAL);
    }
}

/// The head pins one signature with every blob in the Ed25519 instruction itself. Without
/// it, an instruction could let the precompile verify a signature from another instruction
/// (here: a valid signature of an attacker key) while the pinned positions hold the group key
/// and the digest with a signature that nobody checks.
#[test]
fn refuses_an_approval_whose_offsets_point_elsewhere() {
    let (mut rig, body, transact) = proposed();
    let digest = body.digest();
    let attacker = approval_ix(&Keypair::new(), &digest);
    let mut forged = approval_ix(&rig.group, &digest);
    forged.data[48..112].fill(0);
    for index_at in [4, 8, 14] {
        forged.data[index_at..index_at + 2].copy_from_slice(&0u16.to_le_bytes());
    }
    let ixs = [attacker, forged, execute(&rig, &body, &transact)];
    assert_eq!(refused_with(rig.send(&ixs, &[])), code::BAD_APPROVAL);
}

/// Two signatures in one Ed25519 instruction, both valid: the group's over the digest and
/// another key's. The program accepts only the one-signature layout.
#[test]
fn refuses_two_signatures_in_one_instruction() {
    let (mut rig, body, transact) = proposed();
    let digest = body.digest();
    let group = approval_ix(&rig.group, &digest);
    let other = approval_ix(&Keypair::new(), &digest);
    // Count 2, two offset records, then the two blobs (key, signature, digest: 128 bytes each).
    let mut data = vec![2, 0];
    data.extend_from_slice(&group.data[2..16]);
    data.extend_from_slice(&other.data[2..16]);
    let add = |data: &mut Vec<u8>, at: usize, by: u16| {
        let moved = u16::from_le_bytes([data[at], data[at + 1]]) + by;
        data[at..at + 2].copy_from_slice(&moved.to_le_bytes());
    };
    for at in [2, 6, 10] {
        add(&mut data, at, 14);
    }
    for at in [16, 20, 24] {
        add(&mut data, at, 14 + 128);
    }
    data.extend_from_slice(&group.data[16..]);
    data.extend_from_slice(&other.data[16..]);
    let two = Instruction::new_with_bytes(ED25519_ID, &data, vec![]);
    let ixs = [two, execute(&rig, &body, &transact)];
    assert_eq!(refused_with(rig.send(&ixs, &[])), code::BAD_APPROVAL);
}

/// Another program's instruction with the exact approval bytes (group key, digest, and a
/// signature that nobody checks) before `execute`: only the precompile's verification counts.
#[test]
fn refuses_the_approval_layout_from_another_program() {
    let (mut rig, body, transact) = proposed();
    let any = rig.deploy_any_program();
    let mut forged = approval_ix(&rig.group, &body.digest());
    forged.data[48..112].fill(7);
    forged.program_id = any;
    let ixs = [forged, execute(&rig, &body, &transact)];
    assert_eq!(refused_with(rig.send(&ixs, &[])), code::MISSING_APPROVAL);
}
