//! The slot order of the circuit. `AssertDummiesLast` (prover/server/circuits/spp_transaction/
//! shared/slot_order.go) forbids a real output after a dummy output. A spend with such an order
//! has no proof, so it would burn the fee and the nonce and move no funds. The checker refuses it
//! with the rule `dummies-last` (`mutate.py` cases `dummies-last*`). The dummy outputs of every
//! other test come last, as the SDK writes them.

mod common;

use common::fixture::*;
use common::NOW;
use p3_check::hashes::{output_blinding, output_seed};
use p3_check::plan::{OutPlan, Proposal, Role};
use p3_check::rule::Rule::*;
use p3_check::transact::{Output, OwnerTag};
use p3_check::wasm::check_message;

/// The plan of a transfer with two dummies: change, payee, dummy, dummy.
fn with_two_dummies() -> Fixture {
    let mut f = Fixture::build(&Spec::transfer());
    f.push_dummy();
    f.push_dummy();
    f
}

/// The same slots in another order. The blinding of a slot depends on its position, and the
/// owner tag of a dummy on the first real slot, so the hashes and the data are built again.
fn reorder(f: &mut Fixture, order: &[usize]) {
    let first = f.tx.inputs[0].nullifier;
    let seed = output_seed(&first, &f.plan.blinding_seed).unwrap();
    let old = f.plan.outputs.clone();
    f.plan.outputs = order
        .iter()
        .enumerate()
        .map(|(slot, &from)| OutPlan {
            blinding: output_blinding(&first, &seed, slot as u32).unwrap(),
            ..old[from].clone()
        })
        .collect();
    let key = f.tx_key();
    let plan = f.plan.clone();
    f.tx.outputs = plan
        .outputs
        .iter()
        .enumerate()
        .map(|(slot, out)| Output {
            utxo_hash: f.hash_of(out),
            owner_tag: match out.role {
                Role::Change => OwnerTag::Account(0),
                Role::Payee => OwnerTag::Inline(PAYEE),
                Role::Dummy => OwnerTag::Inline(f.dummy_tag()),
            },
            data: Some(f.data_of(out, slot, &key)),
        })
        .collect();
}

fn roles(f: &Fixture) -> Vec<Role> {
    f.plan.outputs.iter().map(|o| o.role).collect()
}

/// The answer of the wasm entry point for the compiled message of a fixture.
fn answer_of(f: &Fixture) -> String {
    let proposal = Proposal {
        intent: f.intent.clone(),
        plan: f.plan.clone(),
    };
    let snapshot = f.snapshot.encode().unwrap();
    let intent = proposal.encode().unwrap();
    check_message(&f.bytes(), &intent, &f.pins.wire(), &snapshot, NOW)
}

#[test]
fn a_dummy_before_a_real_output_is_refused() {
    // dummy, change, payee, dummy: the plan of the verifier gap
    // `gap_a_dummy_before_a_real_output_is_approved_although_the_circuit_has_no_proof`.
    let mut f = with_two_dummies();
    reorder(&mut f, &[2, 0, 1, 3]);
    assert_eq!(roles(&f)[0], Role::Dummy);
    assert_eq!(f.rules(), vec![DummiesLast]);
}

#[test]
fn a_real_output_between_two_dummies_is_refused() {
    let mut f = with_two_dummies();
    reorder(&mut f, &[0, 2, 1, 3]);
    assert_eq!(
        roles(&f),
        [Role::Change, Role::Dummy, Role::Payee, Role::Dummy]
    );
    assert_eq!(f.rules(), vec![DummiesLast]);
}

#[test]
fn a_real_output_in_the_last_slot_after_dummies_is_refused() {
    // The late slot is the last one. A rule that never judges the last slot lets these pass.
    for order in [[0, 2, 3, 1], [1, 2, 3, 0]] {
        let mut f = with_two_dummies();
        reorder(&mut f, &order);
        assert_ne!(roles(&f)[3], Role::Dummy, "{order:?}");
        assert_eq!(f.rules(), vec![DummiesLast], "{order:?}");
        assert_eq!(
            answer_of(&f),
            "refused\ndummies-last\toutput 3 is a real output after a dummy",
            "{order:?}"
        );
    }
}

#[test]
fn two_dummies_before_the_real_outputs_are_refused_once() {
    let mut f = with_two_dummies();
    reorder(&mut f, &[2, 3, 0, 1]);
    assert_eq!(f.rules(), vec![DummiesLast]);
}

#[test]
fn the_dummies_of_the_sdk_order_come_after_every_real_output_and_pass() {
    let f = with_two_dummies();
    assert_eq!(
        roles(&f),
        [Role::Change, Role::Payee, Role::Dummy, Role::Dummy]
    );
    assert!(f.approve().is_ok());
    let w = Fixture::build(&Spec::withdrawal());
    assert_eq!(roles(&w), [Role::Change, Role::Dummy]);
    assert!(w.approve().is_ok());
}

#[test]
fn the_payee_may_come_before_the_change_when_no_dummy_comes_first() {
    // The circuit fixes no order among the real outputs.
    let mut f = Fixture::build(&Spec::transfer());
    reorder(&mut f, &[1, 0]);
    assert_eq!(roles(&f), [Role::Payee, Role::Change]);
    assert!(f.approve().is_ok());
}

#[test]
fn the_refusal_names_the_first_real_output_after_a_dummy_at_the_wasm_entry() {
    let mut f = with_two_dummies();
    reorder(&mut f, &[0, 2, 1, 3]);
    let answer = answer_of(&f);
    assert_eq!(
        answer,
        "refused\ndummies-last\toutput 2 is a real output after a dummy"
    );
}
