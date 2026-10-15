//! The fixes for the findings of the independent P3a verifier. Each test names the finding that
//! it covers. The fixes of the mask and of the pending rules have their tests in `negative.rs`
//! (`priority_fee_*`), `real_data.rs` (the P6 message with mask 0b1100) and `p3c.rs`.

mod common;

use common::*;
use p3_check::check::check_all;
use p3_check::intent::Intent;
use p3_check::rule::Rule;
use p3_check::template::{
    compile, limits, CU_CAP_REGISTER, CU_CAP_SHIELD, CU_CAP_SYSTEM, CU_CAP_TRANSACT,
    CU_FLOOR_CANCEL, CU_FLOOR_CREATE_NONCE, CU_FLOOR_REGISTER, CU_FLOOR_SHIELD, CU_FLOOR_TRANSACT,
};
use p3_check::transact::Input;
use p3_check::v1::Config;

fn with_units(bytes: &[u8], units: u32) -> Vec<u8> {
    mutate(bytes, |msg| {
        let Config { compute_units, .. } = &mut msg.config;
        *compute_units = Some(units);
    })
}

/// Finding `gap_compute_units_have_no_floor`: units 0, 1 and 100 were accepted for every intent.
#[test]
fn compute_units_have_a_floor_for_every_intent() {
    for vector in accept_vectors() {
        let limit = limits(&vector.intent);
        for units in [0, 1, 100, limit.cu_floor - 1] {
            if units >= limit.cu_floor {
                continue;
            }
            let bytes = with_units(&vector.bytes, units);
            assert_refused(&bytes, &vector.intent, Rule::ComputeUnitsUnderFloor);
        }
        for units in [limit.cu_floor, limit.cu_cap] {
            let bytes = with_units(&vector.bytes, units);
            assert!(
                check_all(&bytes, &vector.intent, &pins(), NOW)
                    .violations
                    .is_empty(),
                "{} with {units}",
                vector.name
            );
        }
    }
}

/// The floor of an intent is the largest recorded consumption, and the cap adds 50 percent.
#[test]
fn the_floors_are_the_recorded_consumption_and_the_caps_are_50_percent_above() {
    for (floor, cap) in [
        (CU_FLOOR_TRANSACT, CU_CAP_TRANSACT),
        (CU_FLOOR_SHIELD, CU_CAP_SHIELD),
        (CU_FLOOR_REGISTER, CU_CAP_REGISTER),
        (CU_FLOOR_CREATE_NONCE, CU_CAP_SYSTEM),
    ] {
        let base = floor * 3 / 2;
        assert!(cap >= base && cap - base < 200, "floor {floor}, cap {cap}");
    }
    const { assert!(CU_FLOOR_CANCEL < CU_FLOOR_CREATE_NONCE) };
    assert_eq!(CU_FLOOR_TRANSACT, 144_591, "P5 transfer, ZOLANA.md 6.5");
    assert_eq!(CU_FLOOR_SHIELD, 37_918, "P4 deposit, ZOLANA.md 6.4");
}

/// Finding `gap_circuit_input_and_output_counts_are_not_compared`: (2,4,3), (1,2,3) with
/// another message, (8,8,3), (0,0,3) and (0,4,3) were accepted.
#[test]
fn the_circuit_counts_equal_the_counts_of_the_instruction() {
    for name in ["transfer", "withdrawal"] {
        let vector = accept(name);
        for (inputs, outputs) in [(2, 4), (8, 8), (0, 0), (0, 4), (1, 4), (2, 2), (1, 16)] {
            let bytes = mutate_tx(&vector.bytes, |tx| {
                tx.circuit.inputs = inputs;
                tx.circuit.outputs = outputs;
            });
            assert_refused(&bytes, &vector.intent, Rule::CircuitCounts);
        }
        let same = mutate_tx(&vector.bytes, |tx| {
            tx.circuit.inputs = 1;
            tx.circuit.outputs = 2;
        });
        assert_eq!(same, vector.bytes, "(1,2,3) is the circuit of the vector");
    }
}

/// Finding `gap_duplicate_nullifier_is_accepted_and_the_template_compiles_it`.
#[test]
fn a_duplicate_nullifier_is_refused_and_the_template_does_not_compile_it() {
    let vector = accept("transfer");
    let intent = common::with_spend(&vector.intent, |s| s.inputs = 2);
    let bytes = mutate(&vector.bytes, |msg| {
        let at = tx_position(msg);
        let mut tx = p3_check::transact::parse(&msg.ixs[at].data).expect("transact");
        let first = tx.inputs[0];
        tx.inputs.push(Input { ..first });
        tx.circuit.inputs = 2;
        msg.ixs[at].data = tx.write().expect("write");
        let pda_index = msg.ixs[at].accounts[5];
        msg.ixs[at].accounts.push(pda_index);
    });
    let report = check_all(&bytes, &intent, &pins(), NOW);
    let rules: Vec<Rule> = report.violations.iter().map(|v| v.rule).collect();
    assert!(rules.contains(&Rule::DuplicateNullifier), "{rules:?}");
    let tx = report.facts.transact.expect("parsed");
    let refused = compile(&intent, &pins(), Some(&tx));
    assert!(
        refused.is_err(),
        "the template must not compile a repeated nullifier"
    );
}

/// Finding `gap_a_true_dummy_owner_tag_is_refused`: the published tag of a dummy output is the
/// tag of a participant, never zero (`finalizeTransfer` in transact.ts and `owner_tags` in
/// encryption.rs both write `padTag`). The spec's "owner 0" is the owner field of the hash.
/// The refusal stays; `a_dummy_names_the_group_or_the_payee_and_nobody_else` in `p3c.rs` covers
/// the tags, and `the_p5_withdrawal_*` in `real_data.rs` shows a landed dummy with the group tag.
#[test]
fn a_zero_owner_tag_is_still_refused_on_a_dummy_slot() {
    let vector = accept("withdrawal");
    let bytes = mutate_tx(&vector.bytes, |tx| {
        tx.outputs[1].owner_tag = p3_check::transact::OwnerTag::Inline([0; 32]);
    });
    assert_refused(&bytes, &vector.intent, Rule::OutputOwnerTag);
}

/// The two forms of the priority fee: absent (the compiler writes it), or present at or under
/// the maximum. A present fee over the maximum is refused.
#[test]
fn priority_fee_forms() {
    let intent = Intent::Cancel { nonce: NONCE };
    let base = accept("cancel").bytes;
    assert_eq!(parse(&base).config.mask(), 0b1100);
    let ok = |bytes: &[u8]| {
        check_all(bytes, &intent, &pins(), NOW)
            .violations
            .is_empty()
    };
    assert!(ok(&base), "absent");
    for fee in [0, 2_000, p3_check::template::PRIORITY_MAX] {
        let with = mutate(&base, |m| m.config.priority_fee = Some(fee));
        assert!(ok(&with), "present {fee}");
    }
    let over = mutate(&base, |m| {
        m.config.priority_fee = Some(p3_check::template::PRIORITY_MAX + 1)
    });
    assert_refused(&over, &intent, Rule::PriorityFeeOverMax);
}
