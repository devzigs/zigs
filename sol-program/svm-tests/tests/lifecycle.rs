//! Create, expiry, cancel by an abort authority, close of a cancellation record, and the
//! version 2 fix: an address that someone funded first does not block `create` or `cancel`.

use solana_instruction::AccountMeta;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use zigs_min_multisig_svm_tests::{
    approval_ix, cancel_ix, close_cancelled_ix, code, create_ix, execute_ix, refused_with,
    sample_transact, serialize, Body, Rig, TxResult, DAY, NOW, PROGRAM_ID,
};

fn rig_and_body() -> (Rig, Body) {
    let rig = Rig::new();
    let body = rig.body(&serialize(&sample_transact()));
    (rig, body)
}

fn authority(rig: &Rig) -> Option<AccountMeta> {
    Some(AccountMeta::new_readonly(rig.authority.pubkey(), true))
}

fn cancel(rig: &mut Rig, body: &Body) -> TxResult {
    let ix = cancel_ix(&rig.payer.pubkey(), body, authority(rig));
    let signer = rig.authority.insecure_clone();
    rig.send(&[ix], &[&signer])
}

#[test]
fn create_stores_the_header_and_the_body_only() {
    let (mut rig, body) = rig_and_body();
    rig.create(&body).expect("create");
    let account = rig.svm.get_account(&body.proposal()).expect("proposal");
    let (_, bump) = body.proposal_and_bump();
    let mut expected = vec![1, bump];
    expected.extend(body.bytes());
    assert_eq!(account.owner, PROGRAM_ID);
    assert_eq!(account.data, expected);
    assert_eq!(
        account.lamports,
        rig.svm.minimum_balance_for_rent_exemption(expected.len())
    );
}

#[test]
fn create_refuses_an_expiry_that_is_not_in_the_future() {
    let (mut rig, mut body) = rig_and_body();
    body.expiry = NOW;
    assert_eq!(refused_with(rig.create(&body)), code::EXPIRY_NOT_IN_FUTURE);
    body.expiry = NOW + 1;
    rig.create(&body)
        .expect("one second ahead is in the future");
}

#[test]
fn create_refuses_bad_bodies() {
    let (mut rig, body) = rig_and_body();
    let mut duplicate = body.clone();
    duplicate.authorities = vec![rig.authority.pubkey(); 2];
    assert_eq!(
        refused_with(rig.create(&duplicate)),
        code::DUPLICATE_ABORT_AUTHORITY
    );
    let mut five = body.clone();
    five.authorities = (0..5).map(|_| Pubkey::new_unique()).collect();
    assert_eq!(
        refused_with(rig.create(&five)),
        code::TOO_MANY_ABORT_AUTHORITIES
    );
    let mut short = create_ix(&rig.payer.pubkey(), &body);
    short.data.pop();
    assert_eq!(
        refused_with(rig.send(&[short], &[])),
        code::BAD_PROPOSAL_DATA
    );
    let mut four = body.clone();
    four.authorities = (0..4).map(|_| Pubkey::new_unique()).collect();
    rig.create(&four).expect("four authorities");
}

#[test]
fn create_refuses_another_address_or_system_program() {
    let (mut rig, body) = rig_and_body();
    let mut moved = create_ix(&rig.payer.pubkey(), &body);
    moved.accounts[1].pubkey = Pubkey::new_unique();
    assert_eq!(
        refused_with(rig.send(&[moved], &[])),
        code::BAD_PROPOSAL_ADDRESS
    );
    let mut system = create_ix(&rig.payer.pubkey(), &body);
    system.accounts[2].pubkey = Pubkey::new_unique();
    let failure = rig
        .send(&[system], &[])
        .expect_err("another system program");
    assert!(format!("{:?}", failure.err).contains("IncorrectProgramId"));
}

#[test]
fn create_refuses_the_same_body_at_a_live_address() {
    let (mut rig, body) = rig_and_body();
    rig.create(&body).expect("create");
    assert!(
        rig.create(&body).is_err(),
        "the address holds a live proposal"
    );
}

/// Review R1: before version 3 the address bound only the group key and the commitment. A
/// front-runner who saw them could create its own body there first (any expiry, itself as abort
/// authority), cancel it, and block the signed body for good. Now each body has its own address.
#[test]
fn a_front_runner_cannot_take_or_block_the_signed_body() {
    let (mut rig, body) = rig_and_body();
    let attacker = Keypair::new();
    rig.svm
        .airdrop(&attacker.pubkey(), 1_000_000_000)
        .expect("fund");
    let mut squat = body.clone();
    squat.expiry = u64::MAX;
    squat.rent_recipient = attacker.pubkey();
    squat.authorities = vec![attacker.pubkey()];
    assert_ne!(squat.proposal(), body.proposal());
    rig.create(&squat).expect("the front-runner's create");
    let authority = AccountMeta::new_readonly(attacker.pubkey(), true);
    let ix = cancel_ix(&rig.payer.pubkey(), &squat, Some(authority));
    rig.send(&[ix], &[&attacker])
        .expect("the front-runner cancels its own body");
    rig.create(&body).expect("the signed body");
    rig.execute(&body, &sample_transact())
        .expect("the approval settles");
}

#[test]
fn execute_accepts_until_the_expiry_second() {
    let (mut rig, body) = rig_and_body();
    rig.create(&body).expect("create");
    rig.set_time(body.expiry);
    rig.execute(&body, &sample_transact())
        .expect("execute at the expiry second");
}

#[test]
fn execute_refuses_after_the_expiry() {
    let (mut rig, body) = rig_and_body();
    rig.create(&body).expect("create");
    rig.set_time(body.expiry + 1);
    assert_eq!(
        refused_with(rig.execute(&body, &sample_transact())),
        code::EXPIRED
    );
}

#[test]
fn execute_pays_the_rent_to_the_rent_recipient_and_cannot_repeat() {
    let (mut rig, body) = rig_and_body();
    rig.create(&body).expect("create");
    let rent = rig.lamports(&body.proposal());
    rig.execute(&body, &sample_transact()).expect("execute");
    assert_eq!(rig.lamports(&body.rent_recipient), rent);
    assert_eq!(
        refused_with(rig.execute(&body, &sample_transact())),
        code::NOT_A_PROPOSAL
    );
}

#[test]
fn cancel_needs_a_signing_abort_authority_before_the_expiry() {
    let (mut rig, body) = rig_and_body();
    rig.create(&body).expect("create");
    let payer = rig.payer.pubkey();
    let none = cancel_ix(&payer, &body, None);
    assert_eq!(
        refused_with(rig.send(&[none], &[])),
        code::NOT_ABORT_AUTHORITY
    );
    let stranger = Keypair::new();
    let other = cancel_ix(
        &payer,
        &body,
        Some(AccountMeta::new_readonly(stranger.pubkey(), true)),
    );
    assert_eq!(
        refused_with(rig.send(&[other], &[&stranger])),
        code::NOT_ABORT_AUTHORITY
    );
    let unsigned = AccountMeta::new_readonly(rig.authority.pubkey(), false);
    let unsigned = cancel_ix(&payer, &body, Some(unsigned));
    assert_eq!(
        refused_with(rig.send(&[unsigned], &[])),
        code::NOT_ABORT_AUTHORITY
    );
    assert!(rig.exists(&body.proposal()), "the proposal stays");
}

#[test]
fn cancel_records_the_cancellation_and_ends_the_approval() {
    let (mut rig, body) = rig_and_body();
    rig.create(&body).expect("create");
    let rent = rig.lamports(&body.proposal());
    cancel(&mut rig, &body).expect("cancel");
    assert!(!rig.exists(&body.proposal()));
    assert_eq!(rig.lamports(&body.rent_recipient), rent);
    let record = rig.svm.get_account(&body.cancellation()).expect("record");
    assert_eq!(record.owner, PROGRAM_ID);
    assert_eq!(record.data[0], 2);
    assert_eq!(record.data[2..10], body.expiry.to_le_bytes());
    assert_eq!(record.data[10..], body.rent_recipient.to_bytes());
    // The same body again at the same address: the old approval stays refused, and a second
    // cancel keeps the record.
    rig.create(&body).expect("create again");
    cancel(&mut rig, &body).expect("cancel again");
    rig.create(&body).expect("create a third time");
    assert_eq!(
        refused_with(rig.execute(&body, &sample_transact())),
        code::CANCELLED
    );
}

/// Review R2: each body has its own record, so a second body for the same commitment can be
/// cancelled while the record of the first one exists, and its record keeps its own expiry.
#[test]
fn each_body_has_its_own_cancellation_record() {
    let (mut rig, body) = rig_and_body();
    rig.create(&body).expect("create");
    cancel(&mut rig, &body).expect("cancel");
    let mut longer = body.clone();
    longer.expiry += DAY;
    rig.create(&longer).expect("create with a later expiry");
    cancel(&mut rig, &longer).expect("cancel the second body");
    let record = rig.svm.get_account(&longer.cancellation()).expect("record");
    assert_eq!(record.data[2..10], longer.expiry.to_le_bytes());
    rig.set_time(body.expiry + 1);
    rig.create(&longer).expect("create the second body again");
    assert_eq!(
        refused_with(rig.execute(&longer, &sample_transact())),
        code::CANCELLED
    );
}

#[test]
fn cancel_after_the_expiry_needs_no_authority_and_leaves_no_record() {
    let (mut rig, body) = rig_and_body();
    rig.create(&body).expect("create");
    rig.set_time(body.expiry + 1);
    let ix = cancel_ix(&rig.payer.pubkey(), &body, None);
    rig.send(&[ix], &[])
        .expect("anyone closes an expired proposal");
    assert!(!rig.exists(&body.proposal()));
    assert!(!rig.exists(&body.cancellation()));
}

#[test]
fn cancel_and_execute_refuse_another_rent_recipient() {
    let (mut rig, body) = rig_and_body();
    rig.create(&body).expect("create");
    let mut cancel = cancel_ix(&rig.payer.pubkey(), &body, authority(&rig));
    cancel.accounts[3].pubkey = Pubkey::new_unique();
    let signer = rig.authority.insecure_clone();
    assert_eq!(
        refused_with(rig.send(&[cancel], &[&signer])),
        code::RENT_RECIPIENT_MISMATCH
    );
    let mut metas = rig.metas(&body, &sample_transact());
    metas[4].pubkey = Pubkey::new_unique();
    let approval = approval_ix(&rig.group, &body.digest());
    let execute = execute_ix(metas, &serialize(&sample_transact()));
    assert_eq!(
        refused_with(rig.send(&[approval, execute], &[])),
        code::RENT_RECIPIENT_MISMATCH
    );
}

#[test]
fn close_cancelled_waits_for_the_expiry_and_pays_the_rent_recipient() {
    let (mut rig, body) = rig_and_body();
    rig.create(&body).expect("create");
    cancel(&mut rig, &body).expect("cancel");
    let rent = rig.lamports(&body.cancellation());
    let before = rig.lamports(&body.rent_recipient);
    let close = close_cancelled_ix(&rig.payer.pubkey(), &body);
    rig.set_time(body.expiry);
    assert_eq!(
        refused_with(rig.send(std::slice::from_ref(&close), &[])),
        code::NOT_EXPIRED
    );
    rig.set_time(body.expiry + 1);
    let mut wrong = close.clone();
    wrong.accounts[3].pubkey = Pubkey::new_unique();
    assert_eq!(
        refused_with(rig.send(&[wrong], &[])),
        code::RENT_RECIPIENT_MISMATCH
    );
    rig.send(&[close], &[]).expect("close");
    assert!(!rig.exists(&body.cancellation()));
    assert_eq!(rig.lamports(&body.rent_recipient), before + rent);
}

/// Version 1 used `CreateAccount`, which fails on an address that holds lamports. A SOL
/// transfer to the public address blocked `create` (proposal) or `cancel` (record).
#[test]
fn a_funded_address_does_not_block_create_or_cancel() {
    let (rig, _) = rig_and_body();
    let empty = rig.svm.minimum_balance_for_rent_exemption(0);
    let record = rig.svm.minimum_balance_for_rent_exemption(42);
    for gift in [empty, record + 1, 10_000_000_000] {
        let (mut rig, body) = rig_and_body();
        rig.svm
            .airdrop(&body.proposal(), gift)
            .expect("fund the proposal address");
        rig.create(&body).expect("create on a funded address");
        assert_eq!(
            rig.svm
                .get_account(&body.proposal())
                .expect("proposal")
                .owner,
            PROGRAM_ID
        );
        rig.svm
            .airdrop(&body.cancellation(), gift)
            .expect("fund the record address");
        cancel(&mut rig, &body).expect("cancel on a funded address");
        let record = rig.svm.get_account(&body.cancellation()).expect("record");
        assert_eq!((record.owner, record.data.len()), (PROGRAM_ID, 42));
    }
}

#[test]
fn close_cancelled_refuses_an_account_that_is_not_a_record() {
    let (mut rig, body) = rig_and_body();
    rig.create(&body).expect("create");
    rig.set_time(NOW + 2 * DAY);
    let mut close = close_cancelled_ix(&rig.payer.pubkey(), &body);
    close.accounts[2].pubkey = body.proposal();
    assert_eq!(
        refused_with(rig.send(&[close], &[])),
        code::NOT_A_CANCELLATION
    );
}
