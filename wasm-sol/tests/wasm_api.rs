//! The browser entry point `check_message` and the wire forms of the intent with its plaintext
//! (`Proposal`) and of the snapshot. The answer of a spend is `accepted` only when every rule of
//! section 5 holds: there is no answer that stops at the structure rules (the P3a integration
//! hazard: `accepted;pending=outputs,legs,ciphertexts`).

mod common;

use common::fixture::*;
use common::{EXPIRY, NOW};
use p3_check::bytes::hex;
use p3_check::plan::Proposal;
use p3_check::snapshot::Snapshot;
use p3_check::wasm::{check_message, rule_list};

fn call(f: &Fixture, bytes: &[u8]) -> String {
    let proposal = Proposal {
        intent: f.intent.clone(),
        plan: f.plan.clone(),
    };
    check_message(
        bytes,
        &proposal.encode().unwrap(),
        &f.pins.wire(),
        &f.snapshot.encode().unwrap(),
        NOW,
    )
}

#[test]
fn an_accepted_spend_lists_the_payee_fingerprint_and_the_amounts_of_the_approval_screen() {
    let f = Fixture::build(&Spec::transfer());
    let answer = call(&f, &f.bytes());
    let zero = hex(&[0; 32]);
    let payee = payee();
    let want = format!(
        "accepted\npayee {} {} {}\npaid {zero} 40\nchange {zero} 60\nwithdrawn 0\n\
         expiry {EXPIRY}\ntree_fee 0",
        hex(&PAYEE),
        hex(&payee.owner_hash()),
        hex(&payee.viewing_pk())
    );
    assert_eq!(answer, want);
}

#[test]
fn a_refused_spend_lists_every_violated_rule_with_its_detail() {
    let mut f = Fixture::build(&Spec::transfer());
    f.tx.outputs[1].utxo_hash[0] ^= 1;
    f.tx.inputs[0].nullifier[0] ^= 1;
    let answer = call(&f, &f.bytes());
    let mut lines = answer.lines();
    assert_eq!(lines.next(), Some("refused"));
    let ids: Vec<&str> = lines.map(|l| l.split('\t').next().unwrap()).collect();
    assert_eq!(ids, vec!["output-hash", "nullifier-mismatch"]);
    assert!(answer.contains("output 1"), "{answer}");
}

#[test]
fn a_spend_is_never_accepted_without_its_plaintext() {
    // The intent bytes of a spend with no plan behind them do not decode, and a plan with no
    // outputs is refused: neither can reach `accepted`.
    let f = Fixture::build(&Spec::transfer());
    let bytes = f.bytes();
    let intent_only = f.intent.encode();
    let answer = check_message(
        &bytes,
        &intent_only,
        &f.pins.wire(),
        &f.snapshot.encode().unwrap(),
        NOW,
    );
    assert!(answer.starts_with("error"), "{answer}");
    let empty = Proposal {
        intent: f.intent.clone(),
        plan: p3_check::plan::Plan::default(),
    };
    let snapshot = f.snapshot.encode().unwrap();
    let pins = f.pins.wire();
    let answer = check_message(&bytes, &empty.encode().unwrap(), &pins, &snapshot, NOW);
    assert!(answer.starts_with("refused"), "{answer}");
    assert!(answer.contains("plan-output-count"), "{answer}");
}

#[test]
fn the_pins_are_the_group_key_with_its_nullifier_pk_and_viewing_pk() {
    let f = Fixture::build(&Spec::transfer());
    let bytes = f.bytes();
    let proposal = Proposal {
        intent: f.intent.clone(),
        plan: f.plan.clone(),
    }
    .encode()
    .unwrap();
    let snapshot = f.snapshot.encode().unwrap();
    let wire = f.pins.wire();
    assert_eq!(wire.len(), 129, "32 + 32 + 33 + 32 bytes");
    assert!(check_message(&bytes, &proposal, &wire, &snapshot, NOW).starts_with("accepted"));
    // The old forms (the group key alone, the three keys without the payer) are not pins.
    for old in [
        &GROUP[..],
        &wire[..64],
        &wire[..97],
        &[wire.as_slice(), &[0]].concat(),
    ] {
        let answer = check_message(&bytes, &proposal, old, &snapshot, NOW);
        assert!(
            answer.starts_with("error"),
            "{} bytes of pins: {answer}",
            old.len()
        );
    }
    // Another payer in the pins: the message names the fee payer of the proposal.
    let (nullifier_pk, viewing_pk) = group().keys();
    let other = p3_check::pins::Pins::devnet(GROUP, nullifier_pk, viewing_pk, [0x77; 32]).unwrap();
    let answer = check_message(&bytes, &proposal, &other.wire(), &snapshot, NOW);
    assert!(
        answer.starts_with("refused") && answer.contains("fee-payer-not-payer"),
        "{answer}"
    );
}

#[test]
fn malformed_inputs_are_error_answers_and_never_a_panic() {
    let f = Fixture::build(&Spec::transfer());
    let bytes = f.bytes();
    let snapshot = f.snapshot.encode().unwrap();
    let proposal = Proposal {
        intent: f.intent.clone(),
        plan: f.plan.clone(),
    }
    .encode()
    .unwrap();
    for cut in [0, 1, 20, proposal.len() - 1] {
        let answer = check_message(&bytes, &proposal[..cut], &GROUP, &snapshot, NOW);
        assert!(
            answer.starts_with("error"),
            "proposal cut at {cut}: {answer}"
        );
    }
    for cut in [0, 30, snapshot.len() - 1] {
        let answer = check_message(&bytes, &proposal, &GROUP, &snapshot[..cut], NOW);
        assert!(
            answer.starts_with("error"),
            "snapshot cut at {cut}: {answer}"
        );
    }
    let mut longer = snapshot.clone();
    longer.push(0);
    assert!(check_message(&bytes, &proposal, &GROUP, &longer, NOW).starts_with("error"));
    let mut longer = proposal.clone();
    longer.push(0);
    assert!(check_message(&bytes, &longer, &GROUP, &snapshot, NOW).starts_with("error"));
    for garbage in [&[][..], &[0xff; 5][..], &bytes[..bytes.len() - 1]] {
        let answer = check_message(garbage, &proposal, &GROUP, &snapshot, NOW);
        assert!(
            answer.starts_with("refused") || answer.starts_with("error"),
            "{answer}"
        );
    }
    let mut zero_key = f.snapshot.clone();
    zero_key.viewing_sk = [0; 32];
    let answer = check_message(&bytes, &proposal, &GROUP, &zero_key.encode().unwrap(), NOW);
    assert!(answer.starts_with("error"), "{answer}");
}

#[test]
fn the_wire_forms_round_trip() {
    for (_, f) in [
        ("transfer", Fixture::build(&Spec::transfer())),
        ("withdrawal", Fixture::build(&Spec::withdrawal())),
    ] {
        let proposal = Proposal {
            intent: f.intent.clone(),
            plan: f.plan.clone(),
        };
        let bytes = proposal.encode().unwrap();
        let again = Proposal::decode(&bytes).unwrap();
        assert_eq!(again.intent, f.intent);
        assert_eq!(again.plan.encode().unwrap(), f.plan.encode().unwrap());
        let snapshot = f.snapshot.encode().unwrap();
        assert_eq!(
            Snapshot::decode(&snapshot).unwrap().encode().unwrap(),
            snapshot
        );
    }
}

#[test]
fn the_rule_list_has_every_rule_once() {
    let list = rule_list();
    let ids: Vec<&str> = list
        .lines()
        .map(|l| l.split('\t').next().unwrap())
        .collect();
    assert_eq!(ids.len(), p3_check::rule::INFO.len());
    for id in [
        "group-owner-hash",
        "output-hash",
        "conservation",
        "tx-viewing-pk",
        "ciphertext",
    ] {
        assert!(ids.contains(&id), "{id}");
    }
}
