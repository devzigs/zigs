//! Split FROST signing (ZOLANA.md 5, steps 4 to 6): the nonces, the share and the aggregate are
//! separate calls. Ideas from the P6 tests (`p6-window/signer/tests/split.rs`). Every message is
//! a Cancel intent compiled from the template, because `sign_share` runs `approve` first.
//! Nothing here prints a secret.

#[path = "support/ceremony.rs"]
mod ceremony;

use std::collections::BTreeMap;

use ceremony::*;
use p3_check::consts::{DERIVE_PREFIX, OFFCHAIN_MAGIC};
use p3_check::sign::{self, Check};
use rand_core::{OsRng, RngCore};
use serde_json::Value;

const SUBSETS: [[u16; 2]; 3] = [[1, 2], [1, 3], [2, 3]];

fn nonce(n: u8) -> [u8; 32] {
    [n; 32]
}

fn solana_accepts(group_key: &str, signature: &str, message: &[u8]) -> bool {
    let sig: [u8; 64] = hex::decode(signature).unwrap().try_into().unwrap();
    solana_signature::Signature::from(sig).verify(&hex::decode(group_key).unwrap(), message)
}

fn dalek_strict(group_key: &str, signature: &str, message: &[u8]) -> bool {
    let key = ed25519_dalek::VerifyingKey::from_bytes(&unhex32(group_key)).unwrap();
    let sig: [u8; 64] = hex::decode(signature).unwrap().try_into().unwrap();
    key.verify_strict(message, &ed25519_dalek::Signature::from_bytes(&sig))
        .is_ok()
}

// ---- the happy path --------------------------------------------------------------------------

#[test]
fn a_hundred_sessions_pass_verify_strict_and_the_solana_verify() {
    let group = run(WALLET, 2, 3);
    let key = group.done[0].group_key.clone();
    for session_no in 0..100u8 {
        let mut n = [0u8; 32];
        OsRng.fill_bytes(&mut n);
        n[0] = session_no;
        let (proposal, message) = cancel(&group, n);
        let signers = SUBSETS[usize::from(session_no) % 3];
        let signature = session(&group, &signers, &message, &proposal).expect("session");
        assert!(
            dalek_strict(&key, &signature, &message),
            "verify_strict, session {session_no}"
        );
        assert!(
            solana_accepts(&key, &signature, &message),
            "Solana verify, session {session_no}"
        );
    }
}

#[test]
fn the_signature_does_not_verify_for_another_message_or_another_key() {
    let group = run(WALLET, 2, 3);
    let (proposal, message) = cancel(&group, nonce(1));
    let signature = session(&group, &[1, 2], &message, &proposal).unwrap();
    let key = &group.done[0].group_key;
    let mut other = message.clone();
    other[10] ^= 1;
    assert!(!dalek_strict(key, &signature, &other));
    assert!(!solana_accepts(key, &signature, &other));
    let stranger = run(WALLET, 2, 3);
    assert!(!dalek_strict(
        &stranger.done[0].group_key,
        &signature,
        &message
    ));
}

#[test]
fn a_3_of_5_group_signs_with_three_seats_and_not_with_two() {
    let group = run(WALLET, 3, 5);
    let (proposal, message) = cancel(&group, nonce(2));
    for signers in [[1u16, 2, 3], [2, 4, 5], [1, 3, 5]] {
        let signature = session(&group, &signers, &message, &proposal).unwrap();
        assert!(dalek_strict(&group.done[0].group_key, &signature, &message));
    }
    assert!(
        session(&group, &[1, 2], &message, &proposal).is_err(),
        "two of 3-of-5"
    );
}

#[test]
fn nonces_are_fresh_each_call_and_two_sessions_over_one_message_both_verify() {
    let group = run(WALLET, 2, 3);
    let (proposal, message) = cancel(&group, nonce(3));
    let (first, _) = commit_all(&group, &[1], &message);
    let (second, _) = commit_all(&group, &[1], &message);
    assert!(first[&1] != second[&1]);
    let a = session(&group, &[1, 2], &message, &proposal).unwrap();
    let b = session(&group, &[1, 2], &message, &proposal).unwrap();
    assert!(a != b, "other nonces give another signature");
    assert!(dalek_strict(&group.done[0].group_key, &a, &message));
    assert!(dalek_strict(&group.done[0].group_key, &b, &message));
}

#[test]
fn the_digest_is_blake2b_with_the_personalization_over_the_cluster_and_the_bytes() {
    use blake2b_simd::Params;
    let message = vec![0x81, 1, 2, 3];
    let mut state = Params::new()
        .hash_length(32)
        .personal(b"Zigs_SolMsg___v1")
        .to_state();
    state.update(b"devnet").update(&message);
    assert!(sign::digest(CLUSTER, &message).unwrap() == hex::encode(state.finalize().as_bytes()));
    assert!(sign::digest("mainnet", &message).is_err());
    assert!(
        sign::digest(CLUSTER, &[0x81, 1, 2, 4]).unwrap()
            != sign::digest(CLUSTER, &message).unwrap()
    );
}

// ---- what a seat refuses ----------------------------------------------------------------------

#[test]
fn sign_share_refuses_a_message_with_one_changed_byte_at_every_position() {
    let group = run(WALLET, 2, 3);
    let (proposal, message) = cancel(&group, nonce(4));
    let (nonces, commitments) = commit_all(&group, &[1, 2], &message);
    let round = round_of(&group, 1, &nonces[&1], &commitments);
    let ok = sign::sign_share(&message, &check(&group, &proposal), &round);
    assert!(ok.is_ok(), "the unchanged message is signed");
    for at in 0..message.len() {
        let mut changed = message.clone();
        changed[at] ^= 1;
        let got = sign::sign_share(&changed, &check(&group, &proposal), &round);
        assert!(got.is_err(), "byte {at} changed and still signed");
    }
}

#[test]
fn the_nonces_of_one_digest_do_not_sign_another_message_that_passes_approve() {
    let group = run(WALLET, 2, 3);
    let (_, message_a) = cancel(&group, nonce(5));
    let (proposal_b, message_b) = cancel(&group, nonce(6));
    let (nonces_a, commitments_a) = commit_all(&group, &[1, 2], &message_a);
    let round = round_of(&group, 1, &nonces_a[&1], &commitments_a);
    // Message B passes approve with its own proposal, and the nonces are those of message A.
    let (nonces_b, commitments_b) = commit_all(&group, &[1, 2], &message_b);
    let own = round_of(&group, 1, &nonces_b[&1], &commitments_b);
    assert!(sign::sign_share(&message_b, &check(&group, &proposal_b), &own).is_ok());
    let why = sign::sign_share(&message_b, &check(&group, &proposal_b), &round).unwrap_err();
    assert!(why.contains("another message"), "{why}");
    // Message A with the proposal of B is refused by approve (the lifetime differs).
    let why = sign::sign_share(&message_a, &check(&group, &proposal_b), &round).unwrap_err();
    assert!(why.starts_with("refused\n"), "{why}");
}

#[test]
fn the_off_chain_prefix_and_the_derive_payloads_get_no_share() {
    let group = run(WALLET, 2, 3);
    let (proposal, message) = cancel(&group, nonce(7));
    let (nonces, commitments) = commit_all(&group, &[1, 2], &message);
    let round = round_of(&group, 1, &nonces[&1], &commitments);
    let off_chain = [OFFCHAIN_MAGIC.as_slice(), &[0, 1, 2]].concat();
    let derive = [DERIVE_PREFIX, b"ecdh"].concat();
    let why = sign::sign_share(&off_chain, &check(&group, &proposal), &round).unwrap_err();
    assert!(why.starts_with("refused\noffchain-prefix"), "{why}");
    let why = sign::sign_share(&derive, &check(&group, &proposal), &round).unwrap_err();
    assert!(why.starts_with("refused\nderive-payload"), "{why}");
}

#[test]
fn a_message_that_is_not_v1_gets_no_share() {
    let group = run(WALLET, 2, 3);
    let (proposal, _) = cancel(&group, nonce(8));
    let text = b"transfer all funds to me".to_vec();
    let (nonces, commitments) = commit_all(&group, &[1, 2], &text);
    let round = round_of(&group, 1, &nonces[&1], &commitments);
    let why = sign::sign_share(&text, &check(&group, &proposal), &round).unwrap_err();
    assert!(
        why.starts_with("refused\n") && why.contains("version-byte"),
        "{why}"
    );
}

#[test]
fn a_key_package_that_is_not_the_pinned_group_gets_no_share() {
    let group = run(WALLET, 2, 3);
    let stranger = run(WALLET, 2, 3);
    let (proposal, message) = cancel(&group, nonce(9));
    let (nonces, commitments) = commit_all(&stranger, &[1, 2], &message);
    let round = round_of(&stranger, 1, &nonces[&1], &commitments);
    let why = sign::sign_share(&message, &check(&group, &proposal), &round).unwrap_err();
    assert!(why.contains("not the pinned group key"), "{why}");
}

#[test]
fn a_seat_whose_snapshot_secrets_do_not_derive_the_pins_gets_no_share() {
    let group = run(WALLET, 2, 3);
    let stranger = run(WALLET, 2, 3);
    let (proposal, message) = cancel(&group, nonce(10));
    let (nonces, commitments) = commit_all(&group, &[1, 2], &message);
    let round = round_of(&group, 1, &nonces[&1], &commitments);
    let swapped = Check {
        snapshot: &stranger.snapshot,
        ..check(&group, &proposal)
    };
    let why = sign::sign_share(&message, &swapped, &round).unwrap_err();
    assert!(
        why.contains("group-nullifier-pk") && why.contains("group-viewing-pk"),
        "{why}"
    );
}

#[test]
fn every_message_that_the_p3_vectors_refuse_gets_no_share_and_the_rest_reach_the_group_check() {
    let group = run(WALLET, 2, 3);
    let dir = format!("{}/vectors/smoke", env!("CARGO_MANIFEST_DIR"));
    let mut names: Vec<String> = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(|e| {
            e.unwrap()
                .file_name()
                .to_str()?
                .strip_suffix(".msg")
                .map(String::from)
        })
        .collect();
    names.sort();
    let (mut refused, mut reached) = (0, 0);
    for name in names {
        let read = |ext: &str| std::fs::read(format!("{dir}/{name}.{ext}")).unwrap();
        let answer = String::from_utf8(read("answer")).unwrap();
        let (message, intent, pins, snapshot) =
            (read("msg"), read("intent"), read("pins"), read("snapshot"));
        let (nonces, commitments) = commit_all(&group, &[1, 2], &message);
        let round = round_of(&group, 1, &nonces[&1], &commitments);
        let check = Check {
            intent: &intent,
            pins: &pins,
            snapshot: &snapshot,
        };
        let why = sign::sign_share(&message, &check, &round).unwrap_err();
        if answer.starts_with("accepted") {
            assert!(why.contains("not the pinned group key"), "{name}: {why}");
            reached += 1;
        } else if answer.starts_with("refused") {
            assert!(
                why == answer,
                "{name}: the refusal differs from the checker answer"
            );
            refused += 1;
        }
    }
    assert!(
        refused >= 20 && reached >= 8,
        "{refused} refused, {reached} accepted"
    );
}

// ---- the aggregate ----------------------------------------------------------------------------

#[test]
fn one_share_alone_does_not_aggregate() {
    let group = run(WALLET, 2, 3);
    let (proposal, message) = cancel(&group, nonce(11));
    let (nonces, commitments) = commit_all(&group, &[1, 2], &message);
    let share = share_of(&group, 1, (&message, &proposal), (&nonces, &commitments)).unwrap();
    let one = BTreeMap::from([(1u16, share)]);
    let got = sign::aggregate(
        &message,
        &group.done[0].public_key_package,
        &map_json(&commitments),
        &map_json(&one),
    );
    assert!(got.is_err());
    let alone = BTreeMap::from([(1u16, commitments[&1].clone())]);
    assert!(sign::aggregate(
        &message,
        &group.done[0].public_key_package,
        &map_json(&alone),
        &map_json(&one)
    )
    .is_err());
}

#[test]
fn a_changed_share_a_changed_message_or_other_commitments_do_not_aggregate() {
    let group = run(WALLET, 2, 3);
    let (proposal, message) = cancel(&group, nonce(12));
    let (nonces, commitments) = commit_all(&group, &[1, 2], &message);
    let mut shares = BTreeMap::new();
    for seat in [1u16, 2] {
        shares.insert(
            seat,
            share_of(&group, seat, (&message, &proposal), (&nonces, &commitments)).unwrap(),
        );
    }
    let public = &group.done[0].public_key_package;
    let good = sign::aggregate(
        &message,
        public,
        &map_json(&commitments),
        &map_json(&shares),
    );
    assert!(good.is_ok());
    let mut changed_share = shares.clone();
    let text = changed_share.get_mut(&2).unwrap();
    let flipped = if text.starts_with('0') { '1' } else { '0' };
    text.replace_range(0..1, &flipped.to_string());
    assert!(sign::aggregate(
        &message,
        public,
        &map_json(&commitments),
        &map_json(&changed_share)
    )
    .is_err());
    let mut other_message = message.clone();
    other_message[3] ^= 1;
    assert!(sign::aggregate(
        &other_message,
        public,
        &map_json(&commitments),
        &map_json(&shares)
    )
    .is_err());
    let (_, other_commitments) = commit_all(&group, &[1, 2], &message);
    assert!(sign::aggregate(
        &message,
        public,
        &map_json(&other_commitments),
        &map_json(&shares)
    )
    .is_err());
}

#[test]
fn the_public_key_package_of_another_group_does_not_aggregate() {
    let group = run(WALLET, 2, 3);
    let stranger = run(WALLET, 2, 3);
    let (proposal, message) = cancel(&group, nonce(13));
    let (nonces, commitments) = commit_all(&group, &[1, 2], &message);
    let mut shares = BTreeMap::new();
    for seat in [1u16, 2] {
        shares.insert(
            seat,
            share_of(&group, seat, (&message, &proposal), (&nonces, &commitments)).unwrap(),
        );
    }
    let got = sign::aggregate(
        &message,
        &stranger.done[0].public_key_package,
        &map_json(&commitments),
        &map_json(&shares),
    );
    assert!(got.is_err());
}

#[test]
fn a_share_needs_the_commitment_of_its_own_seat_and_enough_signers() {
    let group = run(WALLET, 2, 3);
    let (proposal, message) = cancel(&group, nonce(14));
    let (nonces, commitments) = commit_all(&group, &[1, 2], &message);
    let mut without_me = commitments.clone();
    without_me.remove(&1);
    let round = round_of(&group, 1, &nonces[&1], &without_me);
    assert!(sign::sign_share(&message, &check(&group, &proposal), &round).is_err());
    let alone = BTreeMap::from([(1u16, commitments[&1].clone())]);
    let round = round_of(&group, 1, &nonces[&1], &alone);
    assert!(
        sign::sign_share(&message, &check(&group, &proposal), &round).is_err(),
        "1 of 2"
    );
}

#[test]
fn bad_round_input_is_an_error_and_not_a_panic() {
    let group = run(WALLET, 2, 3);
    let (proposal, message) = cancel(&group, nonce(15));
    let (nonces, commitments) = commit_all(&group, &[1, 2], &message);
    let good: Value = json_of(&round_of(&group, 1, &nonces[&1], &commitments));
    for key in ["now", "cluster", "keyPackage", "nonces", "commitments"] {
        let mut broken = good.clone();
        broken.as_object_mut().unwrap().remove(key);
        assert!(
            sign::sign_share(&message, &check(&group, &proposal), &broken.to_string()).is_err(),
            "{key}"
        );
    }
    let mut mainnet = good.clone();
    mainnet["cluster"] = Value::from("mainnet");
    assert!(sign::sign_share(&message, &check(&group, &proposal), &mainnet.to_string()).is_err());
    let mut short = good.clone();
    short["nonces"] = Value::from("abcd");
    assert!(sign::sign_share(&message, &check(&group, &proposal), &short.to_string()).is_err());
    assert!(sign::sign_share(&message, &check(&group, &proposal), "not json").is_err());
    assert!(sign::nonces("{}", &"00".repeat(32)).is_err());
    assert!(sign::nonces(&group.done[0].key_package, "00").is_err());
}

// ---- verify_strict, alone --------------------------------------------------------------------

/// The identity point, which is a small-order key and a small-order R.
fn identity() -> [u8; 32] {
    let mut bytes = [0u8; 32];
    bytes[0] = 1;
    bytes
}

#[test]
fn verify_strict_refuses_a_weak_key_that_plain_verify_accepts() {
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    // A and R are the identity and S is 0. The equation S*B = R + k*A holds for every message,
    // so a plain verify accepts the signature. Only the strict check refuses a small-order A or R.
    let mut signature = [0u8; 64];
    signature[..32].copy_from_slice(&identity());
    let message = b"any message at all";
    let weak = VerifyingKey::from_bytes(&identity()).unwrap();
    let plain = weak.verify(message, &Signature::from_bytes(&signature));
    assert!(plain.is_ok(), "plain verify accepts the weak key");
    let why = sign::verify_strict(&identity(), message, &signature).unwrap_err();
    assert!(why.contains("verify_strict"), "{why}");
}

#[test]
fn verify_strict_accepts_the_signature_of_a_group_and_no_other_message() {
    let group = run(WALLET, 2, 3);
    let (proposal, message) = cancel(&group, nonce(7));
    let signature = session(&group, &[1, 2], &message, &proposal).unwrap();
    let key = unhex32(&group.done[0].group_key);
    let bytes: [u8; 64] = hex::decode(signature).unwrap().try_into().unwrap();
    assert!(sign::verify_strict(&key, &message, &bytes).is_ok());
    assert!(sign::verify_strict(&key, b"another message", &bytes).is_err());
    assert!(
        sign::verify_strict(&[2; 32], &message, &bytes).is_err(),
        "not a point"
    );
}

// ---- a key written twice ---------------------------------------------------------------------

#[test]
fn a_key_written_twice_in_a_signing_input_is_refused() {
    let group = run(WALLET, 2, 3);
    let (proposal, message) = cancel(&group, nonce(9));
    let (nonces, commitments) = commit_all(&group, &[1, 2], &message);
    let mut shares = BTreeMap::new();
    for seat in [1u16, 2] {
        let one = share_of(&group, seat, (&message, &proposal), (&nonces, &commitments));
        shares.insert(seat, one.unwrap());
    }
    let (commits, shares) = (map_json(&commitments), map_json(&shares));
    let public = &group.done[0].public_key_package;
    // The extra entry comes first and the honest one last, so the later key would win.
    let twice = |text: &str, opening: &str, extra: &str| {
        assert!(text.contains(opening), "{opening}");
        text.replacen(opening, &format!("{opening}{extra},"), 1)
    };
    assert!(
        sign::aggregate(&message, public, &commits, &shares).is_ok(),
        "the control"
    );
    let why = |result: Result<String, String>| result.expect_err("accepted");
    let bad = twice(&commits, "{", "\"1\":\"00\"");
    assert!(why(sign::aggregate(&message, public, &bad, &shares)).contains("twice"));
    let bad = twice(&shares, "{", "\"2\":\"00\"");
    assert!(why(sign::aggregate(&message, public, &commits, &bad)).contains("twice"));
    // The round of `sign_share`: a field twice.
    let round = round_of(&group, 1, &nonces[&1], &commitments);
    let share = |round: &str| sign::sign_share(&message, &check(&group, &proposal), round);
    assert!(share(&round).is_ok(), "the control");
    let bad = twice(&round, "{", "\"now\":1");
    assert!(share(&bad).unwrap_err().contains("twice"));
}
