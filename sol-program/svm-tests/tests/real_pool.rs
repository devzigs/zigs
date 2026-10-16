//! The program in front of the shielded pool of the pinned Zolana commit (`build.sh test` builds
//! it). The tests have no trees and no proof, so the pool stops at its tree stage (7001) after it
//! has read the account list: the run of owner signers, the settlement groups and their checks.
//! Where the pool stops shows whether it reads the accounts as the program does.

use solana_instruction::AccountMeta;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use zigs_min_multisig_svm_tests::{
    approval_ix, code, commitment, execute_ix, execute_metas, refused_with, sample_transact,
    serialize, settlements, sol_interface, Rig,
};
use zolana_interface::instruction::{CircuitId, InterfaceTransfer, TransactIxData};

/// Forwarded positions with one tree, one input and one leg: the owner PDA, then the leg.
const OUTPUT_TREE_AT: usize = 1;
const INPUT_TREE_AT: usize = 4;
const NULLIFIER_AT: usize = 5;
const SOL_INTERFACE_AT: usize = 7;
const RECIPIENT_AT: usize = 8;

/// The sample transfer with values that pass the pool's early checks (a canonical field element,
/// a supported shape), and one SOL withdrawal leg per leg.
fn pool_transact(legs: u64) -> TransactIxData {
    let mut transact = sample_transact();
    transact.private_tx_hash = [1; 32];
    transact.circuit = CircuitId::ConfidentialEddsa(1, 2, 3);
    transact.interface_transfers = (0..legs)
        .map(|leg| InterfaceTransfer::SolWithdrawal {
            amount: 1_000_000 + leg,
        })
        .collect();
    transact
}

/// `execute` against the real pool after `change` edits the forwarded accounts and adds signers.
/// The body commits to the settlement addresses of the changed list, so the program's own checks
/// pass and the pool reads the list. Returns the custom error code.
fn execute(legs: u64, change: impl FnOnce(&mut [AccountMeta], &mut Vec<Keypair>)) -> u32 {
    let mut rig = Rig::with_real_pool();
    let transact = pool_transact(legs);
    let placeholder = rig.body_with([0; 32]);
    let legs = settlements(&transact);
    let mut metas = execute_metas(&rig.payer.pubkey(), &placeholder, (1, 1), &legs);
    let mut signers = Vec::new();
    change(&mut metas[6..], &mut signers);
    let tail = metas.len() - 2 * legs.len();
    let pairs: Vec<(Pubkey, Pubkey)> = metas[tail..]
        .chunks(2)
        .map(|pair| (pair[0].pubkey, pair[1].pubkey))
        .collect();
    let body = rig.body_with(commitment(&serialize(&transact), &pairs));
    metas[1].pubkey = body.proposal();
    metas[3].pubkey = body.cancellation();
    rig.create(&body).expect("create");
    let approval = approval_ix(&rig.group, &body.digest());
    let ix = execute_ix(metas, &serialize(&transact));
    let signers: Vec<&Keypair> = signers.iter().collect();
    refused_with(rig.send(&[approval, ix], &signers))
}

/// Puts a new signing account at `at`.
fn sign_at(metas: &mut [AccountMeta], signers: &mut Vec<Keypair>, at: usize) {
    let key = Keypair::new();
    metas[at] = AccountMeta::new(key.pubkey(), true);
    signers.push(key);
}

#[test]
fn the_pool_accepts_the_layout_of_the_program() {
    for legs in [0, 1, 2] {
        assert_eq!(
            execute(legs, |_, _| {}),
            code::POOL_TREE_STAGE,
            "legs {legs}"
        );
    }
}

/// Every subset of signer flags on the positions that an executor can flag without changing the
/// shape. Only a signer in the place of the SOL interface lengthens the pool's run of owner
/// signers; a recipient that signs does not.
#[test]
fn only_the_place_of_the_sol_interface_can_lengthen_the_owner_run() {
    let places = [
        OUTPUT_TREE_AT,
        INPUT_TREE_AT,
        NULLIFIER_AT,
        SOL_INTERFACE_AT,
        RECIPIENT_AT,
    ];
    for mask in 0..(1u32 << places.len()) {
        let code = execute(1, |metas, signers| {
            for (bit, at) in places.iter().enumerate() {
                if mask >> bit & 1 == 1 {
                    sign_at(metas, signers, *at);
                }
            }
        });
        if mask >> 3 & 1 == 1 {
            let refused = [code::POOL_TRANSACT_SHAPE, code::POOL_SETTLEMENT_ACCOUNTS];
            assert!(refused.contains(&code), "mask {mask:05b}: {code}");
        } else {
            assert_eq!(code, code::POOL_TREE_STAGE, "mask {mask:05b}");
        }
    }
}

#[test]
fn signing_recipients_of_two_legs_stay_out_of_the_owner_run() {
    for at in [RECIPIENT_AT, RECIPIENT_AT + 2] {
        let code = execute(2, |metas, signers| sign_at(metas, signers, at));
        assert_eq!(code, code::POOL_TREE_STAGE, "position {at}");
    }
}

#[test]
fn the_pool_refuses_a_bad_settlement_group() {
    let changes: [fn(&mut [AccountMeta], &mut Vec<Keypair>); 3] = [
        |m, _| m[SOL_INTERFACE_AT].pubkey = Pubkey::new_unique(),
        |m, _| m[SOL_INTERFACE_AT].is_writable = false,
        |m, _| m[RECIPIENT_AT].is_writable = false,
    ];
    for change in changes {
        assert_eq!(execute(1, change), code::POOL_SETTLEMENT_ACCOUNTS);
    }
}

/// Neither the program nor the pool refuses these payees: the SOL interface itself (the amount
/// stays in the pool's vault) and a forwarded pool account. Only the seat rule on the payee
/// (ZOLANA.md 7.2) stops a group from approving them.
#[test]
fn the_pool_takes_payees_that_only_a_seat_rule_refuses() {
    let payees: [fn(&[AccountMeta]) -> Pubkey; 2] =
        [|_| sol_interface(), |m| m[INPUT_TREE_AT].pubkey];
    for payee in payees {
        let code = execute(1, |metas, _| metas[RECIPIENT_AT].pubkey = payee(metas));
        assert_eq!(code, code::POOL_TREE_STAGE);
    }
}
