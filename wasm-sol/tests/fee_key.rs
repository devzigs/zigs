//! The fee key of a seat (src/fee.rs): an Ed25519 key that the seat derives from its own key
//! share, and that signs the message of its own proposals as their fee payer, after `approve`
//! accepted the exact bytes, and nothing else. `vectors/fee_keys.json` holds what Node's HKDF and
//! Ed25519 give (`solspike/tools/fee_vectors.mjs`): the Rust keys must equal them. The secrets are
//! compared with `assert!(a == b)` or by text of test keys, so no failure prints a live secret.

mod common;

use common::fixture::{Fixture, Spec};
use common::{mutate_tx, unhex, unhex_n, ATTACKER};
use ed25519_dalek::{Signature, SigningKey, VerifyingKey};
use p3_check::bytes::hex;
use p3_check::consts::{DERIVE_PREFIX, OFFCHAIN_MAGIC};
use p3_check::fee;
use p3_check::plan::Proposal;
use p3_check::sign::Check;
use p3_check::transact::OwnerTag;
use p3_check::wasm::sol_fee_verify;
use serde_json::{json, Value};

fn vectors() -> Value {
    let path = format!("{}/vectors/fee_keys.json", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

/// The key package of the vector seat `n` (0 for seat 1), as the text that the wasm takes.
fn package(n: usize) -> Value {
    vectors()["packages"][n]["keyPackage"].clone()
}

fn made(package: &Value) -> Result<(String, String), String> {
    let made: Value = serde_json::from_str(&fee::derive(&package.to_string())?).unwrap();
    let text = |name: &str| made[name].as_str().unwrap().to_string();
    Ok((text("secret"), text("public")))
}

/// The fee key of the vector seat `n`.
fn key_n(n: usize) -> (String, String) {
    made(&package(n)).unwrap()
}

fn key() -> (String, String) {
    key_n(0)
}

/// A transfer whose payer is the fee key `public`: the fixture, its message and its proposal.
struct Paid {
    fixture: Fixture,
    message: Vec<u8>,
    proposal: Vec<u8>,
}

impl Paid {
    fn by(public: &str) -> Self {
        let mut fixture = Fixture::build(&Spec::transfer());
        fixture.pins.payer = unhex_n(public);
        let message = fixture.bytes();
        let plan = fixture.plan.clone();
        let proposal = Proposal {
            intent: fixture.intent.clone(),
            plan,
        };
        Self {
            fixture,
            message,
            proposal: proposal.encode().unwrap(),
        }
    }

    fn sign(&self, message: &[u8], secret: &str) -> Result<String, String> {
        let (pins, snapshot) = (self.fixture.pins.wire(), self.fixture.snapshot.encode());
        let check = Check {
            intent: &self.proposal,
            pins: &pins,
            snapshot: &snapshot.unwrap(),
        };
        let now = common::NOW;
        fee::sign(
            message,
            &check,
            &json!({"now": now, "secret": secret}).to_string(),
        )
    }
}

#[test]
fn a_derived_key_has_a_32_byte_secret_and_the_public_key_of_that_secret() {
    let (secret, public) = key();
    assert_eq!(secret.len(), 64);
    let key = SigningKey::from_bytes(&unhex_n(&secret));
    assert_eq!(VerifyingKey::from(&key).to_bytes().to_vec(), unhex(&public));
}

#[test]
fn the_seed_equals_the_independent_node_derivation_for_every_raw_vector() {
    let all = vectors();
    assert_eq!(all["raw"].as_array().unwrap().len(), 7);
    for v in all["raw"].as_array().unwrap() {
        let text = |name: &str| v[name].as_str().unwrap();
        let seat = u16::try_from(v["seat"].as_u64().unwrap()).unwrap();
        let seed = fee::seed_of(
            &unhex_n(text("signingShare")),
            &unhex_n(text("groupKey")),
            seat,
        );
        assert!(
            seed.unwrap() == unhex_n::<32>(text("secret")),
            "{}",
            v["name"]
        );
    }
}

#[test]
fn the_fee_key_of_a_key_package_equals_the_independent_node_derivation() {
    let all = vectors();
    assert_eq!(all["packages"].as_array().unwrap().len(), 3);
    for (n, v) in all["packages"].as_array().unwrap().iter().enumerate() {
        let (secret, public) = key_n(n);
        assert!(
            secret == v["secret"].as_str().unwrap(),
            "{}: secret",
            v["name"]
        );
        assert_eq!(
            public,
            v["public"].as_str().unwrap(),
            "{}: public",
            v["name"]
        );
    }
}

#[test]
fn every_copy_of_a_key_package_gives_one_key_and_every_seat_gives_another() {
    let first = package(0);
    let reversed: serde_json::Map<String, Value> = first
        .as_object()
        .unwrap()
        .iter()
        .rev()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    let copies = [first.clone(), Value::Object(reversed)];
    for copy in &copies {
        assert!(made(copy).unwrap() == key(), "a copy of seat 1");
    }
    // The text with other spacing is the same package.
    let spaced = serde_json::to_string_pretty(&first).unwrap();
    assert!(fee::derive(&spaced).unwrap() == fee::derive(&first.to_string()).unwrap());
    let keys: Vec<String> = (0..3).map(|n| key_n(n).1).collect();
    let group = package(0)["verifying_key"].as_str().unwrap().to_string();
    for (n, one) in keys.iter().enumerate() {
        assert_ne!(one, &group, "the group key is no fee key");
        for other in &keys[n + 1..] {
            assert_ne!(one, other, "two seats give two keys");
        }
    }
}

#[test]
fn the_share_the_group_key_and_the_seat_each_change_the_key() {
    let (base, other_seat) = (package(0), package(1));
    let changed = |name: &str, value: &Value| {
        let mut edited = base.clone();
        edited[name] = value.clone();
        made(&edited).unwrap().1
    };
    let public = key().1;
    // The checks of the share pass for these two: only the info changes.
    assert_ne!(
        changed("identifier", &other_seat["identifier"]),
        public,
        "the seat"
    );
    assert_ne!(
        changed("verifying_key", &base["verifying_share"]),
        public,
        "the group key"
    );
    // The raw inputs, one at a time.
    let (share, group) = ([0x11u8; 32], [0x22u8; 32]);
    let seed = fee::seed_of(&share, &group, 1).unwrap();
    assert!(
        fee::seed_of(&[0x12u8; 32], &group, 1).unwrap() != seed,
        "the share"
    );
    assert!(
        fee::seed_of(&share, &[0x23u8; 32], 1).unwrap() != seed,
        "the group key"
    );
    assert!(fee::seed_of(&share, &group, 2).unwrap() != seed, "the seat");
}

#[test]
fn a_damaged_share_a_share_of_another_seat_or_junk_gives_no_key() {
    let base = package(0);
    let with_share = |share: &Value| {
        let mut edited = base.clone();
        edited["signing_share"] = share.clone();
        made(&edited)
    };
    let text = base["signing_share"].as_str().unwrap();
    let flipped = format!(
        "{}{}{}",
        &text[..5],
        if &text[5..6] == "a" { "b" } else { "a" },
        &text[6..]
    );
    for share in [
        json!(flipped),
        package(1)["signing_share"].clone(),
        json!("zz".repeat(32)),
    ] {
        assert!(with_share(&share).is_err(), "{share}");
    }
    let why = with_share(&package(1)["signing_share"]).unwrap_err();
    assert!(why.contains("does not fit"), "{why}");
    for junk in ["", "{}", "[]", "zz", "{\"identifier\": 1}"] {
        let why = fee::derive(junk).unwrap_err();
        assert!(why.contains("key package"), "{junk}: {why}");
    }
}

#[test]
fn the_fee_key_signs_the_message_that_approve_accepts_and_the_signature_verifies_strictly() {
    let (secret, public) = key();
    let paid = Paid::by(&public);
    let signature = paid.sign(&paid.message, &secret).unwrap();
    assert_eq!(signature.len(), 128);
    assert!(fee::verify(&public, &paid.message, &signature).is_ok());
    assert!(sol_fee_verify(&public, &paid.message, &signature));
    // The same bytes with the independent library, as the validator reads them.
    let key = VerifyingKey::from_bytes(&unhex_n(&public)).unwrap();
    let sig = Signature::from_bytes(&unhex_n(&signature));
    assert!(key.verify_strict(&paid.message, &sig).is_ok());
}

#[test]
fn a_changed_message_signature_or_key_does_not_verify() {
    let (secret, public) = key();
    let paid = Paid::by(&public);
    let signature = paid.sign(&paid.message, &secret).unwrap();
    let mut other = paid.message.clone();
    other[10] ^= 1;
    assert!(!sol_fee_verify(&public, &other, &signature));
    let mut bad = unhex(&signature);
    bad[5] ^= 1;
    assert!(!sol_fee_verify(&public, &paid.message, &hex(&bad)));
    assert!(!sol_fee_verify(&key_n(1).1, &paid.message, &signature));
    for junk in ["", "zz", &signature[2..]] {
        assert!(!sol_fee_verify(&public, &paid.message, junk), "{junk}");
    }
    assert!(!sol_fee_verify("00", &paid.message, &signature));
}

#[test]
fn a_small_order_key_does_not_verify_even_with_a_signature_that_plain_verify_takes() {
    // The identity point as the key and as R, with S zero: plain verify accepts this for every
    // message, verify_strict refuses it.
    let mut identity = [0u8; 32];
    identity[0] = 1;
    let mut forged = [0u8; 64];
    forged[..32].copy_from_slice(&identity);
    let paid = Paid::by(&key().1);
    assert!(!sol_fee_verify(
        &hex(&identity),
        &paid.message,
        &hex(&forged)
    ));
}

#[test]
fn the_fee_key_signs_nothing_that_approve_refuses() {
    let (secret, public) = key();
    let paid = Paid::by(&public);
    let to_attacker = mutate_tx(&paid.message, |tx| {
        tx.outputs[1].owner_tag = OwnerTag::Inline(ATTACKER)
    });
    let why = paid.sign(&to_attacker, &secret).unwrap_err();
    assert!(
        why.starts_with("refused") && why.contains("output-owner-tag"),
        "{why}"
    );
    let other_payer = common::replace_key(&paid.message, &unhex_n(&public), ATTACKER);
    let why = paid.sign(&other_payer, &secret).unwrap_err();
    assert!(why.contains("fee-payer-not-payer"), "{why}");
}

#[test]
fn a_fee_key_that_is_not_the_payer_of_the_proposal_signs_nothing() {
    let paid = Paid::by(&key_n(1).1);
    let why = paid.sign(&paid.message, &key().0).unwrap_err();
    assert!(why.contains("not the payer of the proposal"), "{why}");
}

#[test]
fn the_fee_key_signs_no_other_bytes() {
    let (secret, public) = key();
    let paid = Paid::by(&public);
    for bytes in [
        [&OFFCHAIN_MAGIC[..], &paid.message].concat(),
        [DERIVE_PREFIX, &paid.message].concat(),
        paid.message[..paid.message.len() - 1].to_vec(),
        [&paid.message[..], &[0]].concat(),
        Vec::new(),
        vec![0x80; 100],
    ] {
        assert!(paid.sign(&bytes, &secret).is_err(), "{} bytes", bytes.len());
    }
}

#[test]
fn a_secret_or_a_round_that_is_not_well_formed_is_an_error() {
    let (_, public) = key();
    let paid = Paid::by(&public);
    for secret in ["", "zz", &"11".repeat(31), &"11".repeat(33)] {
        assert!(paid.sign(&paid.message, secret).is_err(), "{secret}");
    }
    let (pins, snapshot) = (
        paid.fixture.pins.wire(),
        paid.fixture.snapshot.encode().unwrap(),
    );
    let check = Check {
        intent: &paid.proposal,
        pins: &pins,
        snapshot: &snapshot,
    };
    for round in ["", "{}", "{\"secret\": \"11\"}", "{\"now\": 5}", "[]"] {
        assert!(fee::sign(&paid.message, &check, round).is_err(), "{round}");
    }
}
