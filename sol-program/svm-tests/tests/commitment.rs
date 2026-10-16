//! The commitment: the program recomputes `SHA-256(private_tx_hash || external_data_hash)` from
//! the forwarded `transact` data and refuses any difference from the approved proposal. A fresh
//! proof with new roots keeps the commitment. Only default-ring transfers with inline owner
//! tags pass.

use zigs_min_multisig_svm_tests::{
    approval_ix, code, commitment, execute_ix, refused_with, sample_transact, serialize, Body, Rig,
};
use zolana_interface::instruction::{
    CacheAccess, CircuitId, InterfaceTransfer, MessageData, OwnerTag, TransactIxData,
};

fn proposed() -> (Rig, Body) {
    let mut rig = Rig::new();
    let body = rig.body(&serialize(&sample_transact()));
    rig.create(&body).expect("create");
    (rig, body)
}

/// Executes `transact` under the approval of the sample transfer.
fn execute_other(rig: &mut Rig, body: &Body, transact: &TransactIxData) -> u32 {
    let approval = approval_ix(&rig.group, &body.digest());
    let ix = execute_ix(rig.metas(body, transact), &serialize(transact));
    refused_with(rig.send(&[approval, ix], &[]))
}

#[test]
fn the_pool_receives_the_approved_transact_unchanged() {
    let (mut rig, body) = proposed();
    let transact = serialize(&sample_transact());
    let approval = approval_ix(&rig.group, &body.digest());
    let ix = execute_ix(rig.metas(&body, &sample_transact()), &transact);
    let forwarded: Vec<_> = ix.accounts[6..].iter().map(|meta| meta.pubkey).collect();
    let meta = rig.send(&[approval, ix], &[]).expect("execute");
    let pool_calls: Vec<_> = meta
        .inner_instructions
        .iter()
        .flatten()
        .filter(|inner| inner.instruction.data.first() == Some(&16))
        .collect();
    assert_eq!(pool_calls.len(), 1);
    assert_eq!(pool_calls[0].instruction.data[1..], transact[..]);
    assert_eq!(pool_calls[0].instruction.accounts.len(), forwarded.len());
}

#[test]
fn a_fresh_proof_with_new_roots_keeps_the_approval() {
    let (mut rig, body) = proposed();
    let mut fresh = sample_transact();
    fresh.proof.a = [9; 32];
    fresh.proof.c = [8; 32];
    fresh.tree_contexts[0].utxo_tree_root_index = 300;
    fresh.tree_contexts[0].nullifier_tree_root_index = 301;
    assert_eq!(commitment(&serialize(&fresh)), body.commitment);
    rig.execute(&body, &fresh).expect("a fresh proof settles");
}

/// One change per bound field: payee, amount (output hash), change output, ciphertext, pool
/// expiry, viewing key, salt, an added message, and the private transaction hash.
#[test]
fn refuses_any_change_to_the_approved_payment() {
    let changes: [fn(&mut TransactIxData); 9] = [
        |t| t.outputs[0].owner_tag = OwnerTag::Inline([0xee; 32]),
        |t| t.outputs[0].utxo_hash[31] ^= 1,
        |t| t.outputs[1].utxo_hash[0] ^= 1,
        |t| t.outputs[0].data.as_mut().expect("ciphertext")[0] ^= 1,
        |t| t.expiry_unix_ts += 1,
        |t| t.tx_viewing_pk[1] ^= 1,
        |t| t.salt[0] ^= 1,
        |t| {
            t.messages.push(MessageData {
                view_tag: [1; 32],
                data: vec![1, 2, 3],
            })
        },
        |t| t.private_tx_hash[0] ^= 1,
    ];
    for change in changes {
        let (mut rig, body) = proposed();
        let mut changed = sample_transact();
        change(&mut changed);
        assert_ne!(commitment(&serialize(&changed)), body.commitment);
        assert_eq!(
            execute_other(&mut rig, &body, &changed),
            code::COMMITMENT_MISMATCH
        );
    }
}

/// A proposal approved for another shape still cannot settle it: the shape check comes first.
#[test]
fn refuses_interface_transfers_rings_caches_and_account_tags() {
    let shapes: [fn(&mut TransactIxData); 5] = [
        |t| {
            t.interface_transfers
                .push(InterfaceTransfer::SolWithdrawal { amount: 1 })
        },
        |t| {
            t.interface_transfers
                .push(InterfaceTransfer::SolDeposit { amount: 1 })
        },
        |t| t.circuit = CircuitId::RingEddsa(1, 2, 1),
        |t| {
            let read = CacheAccess {
                read_bitmap: 1,
                write_slots: CacheAccess::NO_WRITES,
            };
            t.circuit = CircuitId::ConfidentialEddsaCached(1, 2, 1, read)
        },
        |t| t.outputs[1].owner_tag = OwnerTag::Account(0),
    ];
    for shape in shapes {
        let mut rig = Rig::new();
        let mut transact = sample_transact();
        shape(&mut transact);
        let body = rig.body_with([0x33; 32]);
        rig.create(&body).expect("create");
        assert_eq!(
            execute_other(&mut rig, &body, &transact),
            code::UNSUPPORTED_TRANSACT
        );
    }
}

#[test]
fn refuses_data_that_does_not_parse() {
    let (mut rig, body) = proposed();
    let approval = approval_ix(&rig.group, &body.digest());
    let mut bytes = serialize(&sample_transact());
    bytes.push(0);
    let ix = execute_ix(rig.metas(&body, &sample_transact()), &bytes);
    assert_eq!(
        refused_with(rig.send(&[approval, ix], &[])),
        code::UNSUPPORTED_TRANSACT
    );
}
