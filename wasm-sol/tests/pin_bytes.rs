//! Every byte of `nullifier_pk` (32) and `viewing_pk` (33) counts in every comparison with a pin.
//! A wrong pin is also refused by other rules (the ciphertext of the change output, the owner
//! hash, the template), so a test that only says "refused" cannot tell a comparison of all bytes
//! from a comparison of 31 of 32 or 32 of 33. These tests change one byte of one key and require
//! the named rule of that comparison in the answer (`mutate.py` cases `pin-*` and `register-*`).
//! Nothing here compares a secret with `assert_eq!`: a failure would print it.

mod common;

use common::fixture::*;
use common::{NONCE, NOW};
use p3_check::approve::{approve, Device};
use p3_check::consts::Key;
use p3_check::hashes::owner_hash;
use p3_check::intent::Intent;
use p3_check::pins::Pins;
use p3_check::plan::Plan;
use p3_check::rule::Rule::{self, *};
use p3_check::snapshot::Snapshot;
use p3_check::template::compile;
use p3_check::v1;

type Keys = (Key, [u8; 33]);

/// The rules, each with its detail, that refuse `bytes` for an intent on this device.
fn faults(intent: &Intent, bytes: &[u8], pins: &Pins, snapshot: &Snapshot) -> Vec<(Rule, String)> {
    let device = Device {
        pins,
        snapshot,
        now: NOW,
    };
    match approve(bytes, intent, &Plan::default(), &device) {
        Ok(_) => Vec::new(),
        Err(refusal) => refusal
            .violations
            .into_iter()
            .map(|v| (v.rule, v.detail))
            .collect(),
    }
}

fn register(keys: &Keys) -> Intent {
    Intent::Register {
        nonce: NONCE,
        nullifier_pk: keys.0,
        viewing_pk: keys.1,
    }
}

/// Whether the answer holds `rule` with a detail that names `source`.
fn names(found: &[(Rule, String)], rule: Rule, source: &str) -> bool {
    found
        .iter()
        .any(|(r, why)| *r == rule && why.contains(source))
}

/// The keys with one bit of `nullifier_pk` byte `at` flipped, or of `viewing_pk` byte `at - 32`.
fn flipped(keys: &Keys, nullifier: bool, at: usize, mask: u8) -> Keys {
    let mut out = *keys;
    if nullifier {
        out.0[at] ^= mask;
    } else {
        out.1[at] ^= mask;
    }
    out
}

/// A mask for byte `at` of `nullifier_pk` that leaves a field element (`approve` refuses
/// another value as `plan-invalid` before it compares the pins).
fn field_mask(keys: &Keys, at: usize) -> u8 {
    (0..8)
        .map(|bit| 1u8 << bit)
        .find(|mask| owner_hash(&GROUP, &flipped(keys, true, at, *mask).0).is_ok())
        .unwrap_or_else(|| panic!("no bit of nullifier_pk byte {at} keeps a field element"))
}

#[test]
fn every_byte_of_the_pinned_viewing_pk_is_compared_with_the_viewing_scalar() {
    let f = Fixture::build(&Spec::transfer());
    for at in 0..33 {
        let mut pins = f.pins.clone();
        pins.viewing_pk = flipped(&(pins.nullifier_pk, pins.viewing_pk), false, at, 1).1;
        let found = faults(&f.intent, &f.bytes(), &pins, &f.snapshot);
        assert!(
            found.iter().any(|(rule, _)| *rule == GroupViewingPk),
            "viewing_pk byte {at}: {found:?}"
        );
    }
}

#[test]
fn every_byte_of_the_pinned_nullifier_pk_is_compared_with_the_nullifier_secret() {
    let f = Fixture::build(&Spec::transfer());
    let keys = (f.pins.nullifier_pk, f.pins.viewing_pk);
    for at in 0..32 {
        let mut pins = f.pins.clone();
        pins.nullifier_pk = flipped(&keys, true, at, field_mask(&keys, at)).0;
        let found = faults(&f.intent, &f.bytes(), &pins, &f.snapshot);
        assert!(
            found.iter().any(|(rule, _)| *rule == GroupNullifierPk),
            "nullifier_pk byte {at}: {found:?}"
        );
    }
}

/// One register case: the keys of the message and the intent, the pins and the device secrets
/// (the snapshot). Returns what refuses it.
fn register_faults(data: &Keys, pins: &Keys, secrets_of: &Fixture) -> Vec<(Rule, String)> {
    let mut f_pins = secrets_of.pins.clone();
    f_pins.nullifier_pk = pins.0;
    f_pins.viewing_pk = pins.1;
    let intent = register(data);
    let bytes = v1::write(&compile(&intent, &secrets_of.pins, None).unwrap()).unwrap();
    faults(&intent, &bytes, &f_pins, &secrets_of.snapshot)
}

#[test]
fn every_byte_of_the_register_keys_is_compared_with_the_intent_the_pins_and_the_secrets() {
    let f = Fixture::build(&Spec::transfer());
    let group = (f.pins.nullifier_pk, f.pins.viewing_pk);
    for (nullifier, size) in [(true, 32), (false, 33)] {
        let rule = if nullifier {
            RegisterNullifierPk
        } else {
            RegisterViewingPk
        };
        for at in 0..size {
            let mask = if nullifier { field_mask(&group, at) } else { 1 };
            let other = flipped(&group, nullifier, at, mask);
            // The message carries other keys than the intent, the pins and the secrets.
            let intent_link = {
                let bytes = v1::write(&compile(&register(&other), &f.pins, None).unwrap());
                faults(&register(&group), &bytes.unwrap(), &f.pins, &f.snapshot)
            };
            assert!(
                names(&intent_link, rule, "the intent"),
                "byte {at}: {intent_link:?}"
            );
            // The message and the intent agree, the pins and the secrets carry the group keys.
            let pin_link = register_faults(&other, &group, &f);
            assert!(
                names(&pin_link, rule, "the pinned key"),
                "byte {at}: {pin_link:?}"
            );
            // The message, the intent and the pins agree, the secrets carry the group keys.
            let secret_link = register_faults(&other, &other, &f);
            assert!(
                names(&secret_link, rule, "the key of the device secrets"),
                "byte {at}: {secret_link:?}"
            );
        }
    }
}

#[test]
fn the_register_keys_of_the_group_are_approved_with_no_byte_changed() {
    let f = Fixture::build(&Spec::transfer());
    let group = (f.pins.nullifier_pk, f.pins.viewing_pk);
    assert!(register_faults(&group, &group, &f).is_empty());
}
