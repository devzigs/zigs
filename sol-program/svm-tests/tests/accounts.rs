//! Account checks of `execute`: the proposal (owner, kind, address), the cancellation address,
//! the owner PDA, and the forwarded pool layout with the owner PDA as its last and only owner.

use solana_instruction::AccountMeta;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use zigs_min_multisig_svm_tests::{
    approval_ix, code, execute_ix, refused_with, sample_transact, serialize, Body, Rig, TxResult,
    SYSTEM_ID,
};

fn proposed() -> (Rig, Body) {
    let mut rig = Rig::new();
    let body = rig.body(&serialize(&sample_transact()));
    rig.create(&body).expect("create");
    (rig, body)
}

/// `execute` of the sample transfer with the approval of `body`, after `change` edits the
/// account list.
fn execute_with(
    rig: &mut Rig,
    body: &Body,
    change: impl FnOnce(&mut Vec<AccountMeta>),
) -> TxResult {
    let mut metas = rig.metas(body, &sample_transact());
    change(&mut metas);
    let approval = approval_ix(&rig.group, &body.digest());
    let ix = execute_ix(metas, &serialize(&sample_transact()));
    rig.send(&[approval, ix], &[])
}

#[test]
fn refuses_another_owner_pda() {
    let (mut rig, body) = proposed();
    let other = Pubkey::new_unique();
    let result = execute_with(&mut rig, &body, |m| {
        m[2].pubkey = other;
        m.last_mut().expect("owner").pubkey = other;
    });
    assert_eq!(refused_with(result), code::BAD_OWNER_ADDRESS);
}

#[test]
fn refuses_another_cancellation_address() {
    let (mut rig, body) = proposed();
    let result = execute_with(&mut rig, &body, |m| m[3].pubkey = Pubkey::new_unique());
    assert_eq!(refused_with(result), code::BAD_CANCELLATION_ADDRESS);
}

fn owner_of(metas: &[AccountMeta]) -> Pubkey {
    metas.last().expect("owner").pubkey
}

/// An extra account (after or before the owner), no owner, the owner twice (in place of the
/// tree or as an extra), another payer in the layout, and the owner before the last place.
#[test]
fn refuses_a_pool_layout_that_differs_from_transact() {
    let changes: [fn(&mut Vec<AccountMeta>); 7] = [
        |m| m.push(AccountMeta::new_readonly(Pubkey::new_unique(), false)),
        |m| m.insert(m.len() - 1, AccountMeta::new(Pubkey::new_unique(), false)),
        |m| {
            m.pop();
        },
        |m| m[7] = AccountMeta::new_readonly(owner_of(m), false),
        |m| m.insert(10, AccountMeta::new_readonly(owner_of(m), false)),
        |m| m[6] = AccountMeta::new(Pubkey::new_unique(), false),
        |m| {
            let last = m.len() - 1;
            m.swap(last, last - 1);
        },
    ];
    for change in changes {
        let (mut rig, body) = proposed();
        let result = execute_with(&mut rig, &body, change);
        assert_eq!(refused_with(result), code::BAD_SPP_ACCOUNTS);
    }
}

#[test]
fn refuses_a_call_to_another_pool_program() {
    let (mut rig, body) = proposed();
    let result = execute_with(&mut rig, &body, |m| m[8].pubkey = SYSTEM_ID);
    assert_eq!(refused_with(result), code::INVALID_SPP_PROGRAM);
}

#[test]
fn refuses_a_proposal_that_the_program_does_not_own() {
    let (mut rig, body) = proposed();
    let mut account = rig.svm.get_account(&body.proposal()).expect("proposal");
    account.owner = SYSTEM_ID;
    rig.svm.set_account(body.proposal(), account).expect("set");
    assert_eq!(
        refused_with(rig.execute(&body, &sample_transact())),
        code::NOT_A_PROPOSAL
    );
}

/// A program account with a valid proposal at another address, as a later program version
/// could leave behind. The address must derive from the stored body and bump.
#[test]
fn refuses_a_proposal_at_another_address() {
    let (mut rig, body) = proposed();
    let account = rig.svm.get_account(&body.proposal()).expect("proposal");
    let elsewhere = Pubkey::new_unique();
    rig.svm.set_account(elsewhere, account).expect("set");
    let result = execute_with(&mut rig, &body, |m| m[1].pubkey = elsewhere);
    assert_eq!(refused_with(result), code::BAD_PROPOSAL_ADDRESS);
}

#[test]
fn refuses_a_proposal_with_another_bump() {
    let (mut rig, body) = proposed();
    let (_, bump) = body.proposal_and_bump();
    let mut account = rig.svm.get_account(&body.proposal()).expect("proposal");
    account.data[1] = bump.wrapping_sub(1);
    rig.svm.set_account(body.proposal(), account).expect("set");
    assert_eq!(
        refused_with(rig.execute(&body, &sample_transact())),
        code::BAD_PROPOSAL_ADDRESS
    );
}

#[test]
fn refuses_a_cancellation_record_as_a_proposal() {
    let (mut rig, body) = proposed();
    let mut account = rig.svm.get_account(&body.proposal()).expect("proposal");
    account.data[0] = 2;
    rig.svm.set_account(body.proposal(), account).expect("set");
    assert_eq!(
        refused_with(rig.execute(&body, &sample_transact())),
        code::NOT_A_PROPOSAL
    );
}

/// Any holder of the approval can execute: the digest does not bind the payer.
#[test]
fn the_approval_does_not_bind_the_executor() {
    let (mut rig, body) = proposed();
    let executor = Keypair::new();
    rig.svm
        .airdrop(&executor.pubkey(), 1_000_000_000)
        .expect("fund");
    let approval = approval_ix(&rig.group, &body.digest());
    let mut metas = rig.metas(&body, &sample_transact());
    metas[0] = AccountMeta::new(executor.pubkey(), true);
    metas[6] = AccountMeta::new(executor.pubkey(), true);
    let ix = execute_ix(metas, &serialize(&sample_transact()));
    rig.send(&[approval, ix], &[&executor])
        .expect("another executor settles");
    assert!(!rig.exists(&body.proposal()));
}

/// The CPI copies at most 24 accounts: with one tree, 18 inputs fit and 19 are refused.
#[test]
fn the_pool_layout_fits_the_cpi_bound() {
    for (inputs, fits) in [(18, true), (19, false)] {
        let mut rig = Rig::new();
        let mut transact = sample_transact();
        transact.inputs = vec![transact.inputs[0]; inputs];
        let body = rig.body(&serialize(&transact));
        rig.create(&body).expect("create");
        let result = rig.execute(&body, &transact);
        if fits {
            result.expect("18 inputs");
        } else {
            assert_eq!(refused_with(result), code::BAD_SPP_ACCOUNTS);
        }
    }
}
