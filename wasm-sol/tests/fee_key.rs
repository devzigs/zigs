//! The fee key of a seat (src/fee.rs): a fresh Ed25519 key that signs the message of its own
//! proposals as their fee payer, after `approve` accepted the exact bytes, and nothing else.

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

fn key() -> (String, String) {
    let made: Value = serde_json::from_str(&fee::generate().unwrap()).unwrap();
    let text = |name: &str| made[name].as_str().unwrap().to_string();
    (text("secret"), text("public"))
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
fn a_fresh_key_has_a_32_byte_secret_and_the_public_key_of_that_secret() {
    let (secret, public) = key();
    assert_eq!(secret.len(), 64);
    assert_eq!(fee::public_of(&secret).unwrap(), public);
    let key = SigningKey::from_bytes(&unhex_n(&secret));
    assert_eq!(VerifyingKey::from(&key).to_bytes().to_vec(), unhex(&public));
}

#[test]
fn two_fresh_keys_differ() {
    assert_ne!(key().0, key().0);
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
    assert!(!sol_fee_verify(&key().1, &paid.message, &signature));
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
    let paid = Paid::by(&key().1);
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
        assert!(fee::public_of(secret).is_err(), "{secret}");
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
