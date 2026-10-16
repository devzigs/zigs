//! Unit-level behavior: the rule table, the parsers and writers, the intent codec, and the
//! panic-freedom of the parse path.

mod common;

use common::*;
use p3_check::check::{check, check_all, verify_rewrite};
use p3_check::fixed::{parse_deposit, parse_register};
use p3_check::intent::Intent;
use p3_check::rule::{Rule, INFO};
use p3_check::transact::{self, Leg, OwnerTag};
use p3_check::v1;

#[test]
fn rule_table_matches_enum() {
    for (index, info) in INFO.iter().enumerate() {
        assert_eq!(info.rule as usize, index, "{}", info.id);
        assert!(
            info.id
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'),
            "{}",
            info.id
        );
    }
    let mut ids: Vec<&str> = INFO.iter().map(|i| i.id).collect();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(ids.len(), INFO.len(), "rule ids are unique");
    assert_eq!(Rule::Lifetime.id(), "lifetime");
}

#[test]
fn every_accept_vector_parses_and_rewrites_byte_for_byte() {
    for vector in accept_vectors() {
        let msg = parse(&vector.bytes);
        assert_eq!(write(&msg), vector.bytes, "{}", vector.name);
        assert!(verify_rewrite(&msg, &vector.bytes).is_ok());
    }
}

#[test]
fn verify_rewrite_refuses_a_message_that_does_not_rewrite_to_its_bytes() {
    let vector = accept("transfer");
    let mut msg = parse(&vector.bytes);
    msg.ixs[1].data[3] ^= 1;
    let violation = verify_rewrite(&msg, &vector.bytes).expect_err("must differ");
    assert_eq!(violation.rule, Rule::Rewrite);
}

#[test]
fn every_proper_prefix_is_refused_and_nothing_panics() {
    for vector in accept_vectors() {
        for cut in 0..vector.bytes.len() {
            let report = check_all(&vector.bytes[..cut], &vector.intent, &pins(), NOW);
            assert!(
                !report.violations.is_empty(),
                "{} cut at {cut}",
                vector.name
            );
        }
    }
}

/// Byte ranges of a message that a rule bounds but does not pin to one value: the three config
/// values (a lower limit is allowed) and the `transact` data (P3c reads its hashes and blobs).
fn free_ranges(msg: &v1::Message) -> Vec<std::ops::Range<usize>> {
    let config_at = 42 + 32 * msg.keys.len();
    let mut ranges = Vec::new();
    ranges.push(config_at..config_at + 16);
    let mut at = config_at + 16 + 4 * msg.ixs.len();
    for ix in &msg.ixs {
        at += ix.accounts.len();
        if ix.data.first() == Some(&16) {
            ranges.push(at..at + ix.data.len());
        }
        at += ix.data.len();
    }
    ranges
}

#[test]
fn every_single_byte_flip_is_refused_outside_the_free_ranges() {
    for vector in accept_vectors() {
        let free = free_ranges(&parse(&vector.bytes));
        for at in 0..vector.bytes.len() {
            let mut bytes = vector.bytes.clone();
            bytes[at] ^= 0xFF;
            if let Ok(msg) = v1::parse(&bytes) {
                assert_eq!(write(&msg), bytes, "{} flip at {at}", vector.name);
            }
            let accepted = check(&bytes, &vector.intent, &pins(), NOW).is_ok();
            let in_free_range = free.iter().any(|range| range.contains(&at));
            assert!(
                !accepted || in_free_range,
                "{}: flip at {at} is accepted",
                vector.name
            );
        }
    }
}

#[test]
fn intent_wire_form_round_trips() {
    for vector in accept_vectors() {
        let wire = vector.intent.encode();
        assert_eq!(
            Intent::decode(&wire),
            Ok(vector.intent.clone()),
            "{}",
            vector.name
        );
        assert!(Intent::decode(&wire[..wire.len() - 1]).is_err());
        let mut longer = wire.clone();
        longer.push(0);
        assert!(Intent::decode(&longer).is_err());
    }
    assert!(Intent::decode(&[9]).is_err());
}

#[test]
fn the_real_transact_data_round_trips_and_exposes_its_fields() {
    for path in [
        "real/work-transfer-0.msg",
        "real/work-withdraw-0.msg",
        "real/work-stretch-0.msg",
    ] {
        let msg = parse(&read(path));
        let ix = msg
            .ixs
            .iter()
            .find(|ix| ix.data.first() == Some(&16))
            .expect("transact");
        let tx = transact::parse(&ix.data).expect("parse");
        assert_eq!(tx.write().expect("write"), ix.data, "{path}");
        assert_eq!(tx.nullifiers().len(), 1);
        assert_eq!(tx.output_hashes().len(), 2);
        assert!(tx
            .output_data()
            .iter()
            .all(|d| d.map(<[u8]>::len) == Some(89)));
        assert_eq!(tx.expiry, u64::MAX, "the SDK default");
        assert_eq!(
            (tx.circuit.inputs, tx.circuit.outputs, tx.circuit.slots),
            (1, 2, 3)
        );
        assert_eq!(
            tx.outputs[0].owner_tag,
            OwnerTag::Account(0),
            "change to the payer: in the P5 run the group paid"
        );
    }
    let withdraw = real_tx("real/work-withdraw-0.msg");
    assert_eq!(withdraw.legs, vec![Leg::SolWithdrawal(10_000_000)]);
}

#[test]
fn transact_parse_refuses_trailing_bytes_flags_and_other_circuits() {
    let tx = real_tx("real/work-transfer-0.msg");
    let data = tx.write().expect("write");
    let mut longer = data.clone();
    longer.push(0);
    assert!(transact::parse(&longer).is_err());
    assert!(transact::parse(&data[..data.len() - 1]).is_err());
    let mut bad_tag = data.clone();
    bad_tag[0] = 15;
    assert!(transact::parse(&bad_tag).is_err());
    let mut flag = data.clone();
    let flag_at = 1 + 8 + 33 + 16 + 1; // the data_hash option flag
    flag[flag_at] = 2;
    assert!(transact::parse(&flag).is_err());
}

#[test]
fn deposit_and_register_data_round_trip() {
    let facts = Facts::load();
    let shield = parse(&accept("shield").bytes);
    let deposit = parse_deposit(&shield.ixs[0].data).expect("deposit");
    assert_eq!(deposit.write().expect("write"), shield.ixs[0].data);
    assert_eq!(deposit.entries[0].amount, facts.amount("shield"));
    let register = parse(&accept("register").bytes);
    let data = parse_register(&register.ixs[1].data).expect("register");
    assert_eq!(data.write(), register.ixs[1].data);
    assert_eq!(register.ixs[1].data.len(), 67);
    assert!(parse_register(&register.ixs[1].data[..66]).is_err());
}

#[test]
fn accept_vectors_are_accepted_by_the_structure_rules() {
    for vector in accept_vectors() {
        let facts = check(&vector.bytes, &vector.intent, &pins(), NOW)
            .unwrap_or_else(|r| panic!("{}: {:?}", vector.name, r.violations));
        assert_eq!(
            facts.transact.is_some(),
            vector.intent.is_spend(),
            "{}",
            vector.name
        );
    }
}
