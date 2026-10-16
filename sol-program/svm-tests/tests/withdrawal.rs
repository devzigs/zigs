//! SOL withdrawals through the program (SOL-36 condition 1). The pool reads one settlement group
//! per leg after the owner signers, `[SOL interface, recipient]`, and hashes both addresses into
//! the external data after the prefix. So the commitment binds the amount (in the prefix), the SOL
//! interface and the recipient, and the program must read them where the pool reads them.

use solana_instruction::AccountMeta;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use zigs_min_multisig_svm_tests::{
    approval_ix, code, commitment, execute_ix, execute_metas, pool_signers, recipient,
    refused_with, sample_transact, serialize, sol_interface, Body, Rig, TxResult,
};
use zolana_interface::instruction::{InterfaceTransfer, TransactIxData};

/// The sample transfer with one SOL withdrawal leg per amount.
fn withdrawal(amounts: &[u64]) -> TransactIxData {
    let mut transact = sample_transact();
    for amount in amounts {
        let leg = InterfaceTransfer::SolWithdrawal { amount: *amount };
        transact.interface_transfers.push(leg);
    }
    transact
}

fn proposed(transact: &TransactIxData) -> (Rig, Body) {
    let mut rig = Rig::new();
    let body = rig.body(transact);
    rig.create(&body).expect("create");
    (rig, body)
}

/// `execute` of `transact` with the approval of `body`, after `change` edits the account list.
fn execute_with(
    rig: &mut Rig,
    body: &Body,
    transact: &TransactIxData,
    change: impl FnOnce(&mut Vec<AccountMeta>),
) -> TxResult {
    let mut metas = rig.metas(body, transact);
    change(&mut metas);
    let approval = approval_ix(&rig.group, &body.digest());
    rig.send(&[approval, execute_ix(metas, &serialize(transact))], &[])
}

#[test]
fn a_withdrawal_settles_with_its_settlement_accounts_after_the_owner() {
    let transact = withdrawal(&[1_000]);
    let (mut rig, body) = proposed(&transact);
    let metas = rig.metas(&body, &transact);
    let forwarded: Vec<Pubkey> = metas[6..].iter().map(|meta| meta.pubkey).collect();
    let tail = &forwarded[forwarded.len() - 3..];
    assert_eq!(tail, [body.owner(), sol_interface(), recipient(0)]);
    let meta = rig
        .execute(&body, &transact)
        .expect("the withdrawal settles");
    let call = meta
        .inner_instructions
        .iter()
        .flatten()
        .next()
        .expect("the pool call");
    assert_eq!(call.instruction.data[1..], serialize(&transact)[..]);
    // Only the payer and the owner PDA sign, so the pool's run of owner signers is the owner.
    let owner_at = forwarded.len() - 3;
    let expected: Vec<bool> = (0..forwarded.len())
        .map(|at| at == 0 || at == owner_at)
        .collect();
    assert_eq!(pool_signers(&meta), expected);
}

#[test]
fn the_commitment_binds_the_recipient_and_the_sol_interface() {
    let transact = withdrawal(&[1_000]);
    for slot in [1, 2] {
        let (mut rig, body) = proposed(&transact);
        let result = execute_with(&mut rig, &body, &transact, |m| {
            let at = m.len() - slot;
            m[at].pubkey = Pubkey::new_unique();
        });
        assert_eq!(
            refused_with(result),
            code::COMMITMENT_MISMATCH,
            "slot {slot}"
        );
    }
}

#[test]
fn the_commitment_binds_the_amount_and_the_legs() {
    let approved = withdrawal(&[1_000]);
    for changed in [
        withdrawal(&[1_001]),
        withdrawal(&[]),
        withdrawal(&[1_000, 1]),
    ] {
        let (mut rig, body) = proposed(&approved);
        let result = execute_with(&mut rig, &body, &changed, |_| {});
        assert_eq!(refused_with(result), code::COMMITMENT_MISMATCH);
    }
}

#[test]
fn two_withdrawals_bind_their_recipients_in_order() {
    let transact = withdrawal(&[1_000, 2_000]);
    let (mut rig, body) = proposed(&transact);
    let swapped = execute_with(&mut rig, &body, &transact, |m| {
        let last = m.len() - 1;
        m.swap(last, last - 2);
    });
    assert_eq!(refused_with(swapped), code::COMMITMENT_MISMATCH);
    rig.execute(&body, &transact).expect("both legs in order");
}

/// The owner PDA stays the only owner signer at its place: not as the recipient, not after the
/// settlement accounts, and the settlement groups are complete with nothing after them.
#[test]
fn the_owner_stays_the_only_owner_signer_with_a_withdrawal() {
    let changes: [fn(&mut Vec<AccountMeta>); 4] = [
        |m| {
            let owner = m[m.len() - 3].pubkey;
            let last = m.len() - 1;
            m[last].pubkey = owner;
        },
        |m| {
            let owner = m.remove(m.len() - 3);
            m.push(owner);
        },
        |m| m.truncate(m.len() - 2),
        |m| m.push(AccountMeta::new(Pubkey::new_unique(), false)),
    ];
    let transact = withdrawal(&[1_000]);
    for change in changes {
        let (mut rig, body) = proposed(&transact);
        let result = execute_with(&mut rig, &body, &transact, change);
        assert_eq!(refused_with(result), code::BAD_SPP_ACCOUNTS);
    }
}

/// With one leg the CPI bound of 24 accounts leaves room for 16 inputs.
#[test]
fn the_cpi_bound_counts_the_settlement_accounts() {
    for (inputs, fits) in [(16, true), (17, false)] {
        let mut transact = withdrawal(&[1_000]);
        transact.inputs = vec![transact.inputs[0]; inputs];
        let (mut rig, body) = proposed(&transact);
        let result = rig.execute(&body, &transact);
        if fits {
            result.expect("16 inputs and one leg");
        } else {
            assert_eq!(refused_with(result), code::BAD_SPP_ACCOUNTS);
        }
    }
}

/// A recipient that signs the outer transaction (here the payer) sits after the SOL interface,
/// which never signs, so it does not join the pool's run of owner signers.
#[test]
fn a_recipient_that_signs_stays_out_of_the_owner_signers() {
    let transact = withdrawal(&[1_000]);
    let mut rig = Rig::new();
    let legs = [(sol_interface(), rig.payer.pubkey())];
    let body = rig.body_with(commitment(&serialize(&transact), &legs));
    rig.create(&body).expect("create");
    let metas = execute_metas(&rig.payer.pubkey(), &body, (1, 1), &legs);
    let count = metas.len() - 6;
    let approval = approval_ix(&rig.group, &body.digest());
    let ix = execute_ix(metas, &serialize(&transact));
    let meta = rig.send(&[approval, ix], &[]).expect("settles");
    let expected: Vec<bool> = (0..count)
        .map(|at| at == 0 || at == count - 3 || at == count - 1)
        .collect();
    assert_eq!(pool_signers(&meta), expected);
}
