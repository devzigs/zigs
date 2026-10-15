//! The Rust checker against the TS SDK at the pinned commit. `tools/ts_vectors.mjs` builds
//! confidential transfers offline from known keys and a fixed salt (a non-zero amount, an SPL
//! mint, change to the group, a dummy, two assets). The checker must reproduce every hash and
//! every ciphertext byte for byte, and `approve` must accept the message built from each one.

mod common;

use common::ts::*;
use common::*;
use p3_check::approve::{approve, Device};
use p3_check::bytes::hex;
use p3_check::consts::Key;
use p3_check::hashes::{dummy_hash, Utxo, TREE_ID};
use p3_check::plan::Role;
use p3_check::template::compile;
use p3_check::v1;
use p3_check::viewing::{plaintext, ViewingKey, BLOB_LEN};

#[test]
fn the_vectors_cover_a_non_zero_amount_an_spl_mint_change_and_a_dummy() {
    let all = vectors();
    assert!(all.len() >= 5);
    let roles: Vec<String> = all
        .iter()
        .flat_map(|v| v.json["outputs"].as_array().unwrap().iter())
        .map(|o| {
            format!(
                "{}:{}",
                text(o, "role"),
                if text(o, "mint") == "11111111111111111111111111111111" {
                    "sol"
                } else {
                    "spl"
                }
            )
        })
        .collect();
    for want in [
        "change:sol",
        "change:spl",
        "payee:sol",
        "payee:spl",
        "dummy:sol",
    ] {
        assert!(roles.iter().any(|r| r == want), "no vector has {want}");
    }
}

#[test]
fn the_rust_code_reproduces_every_ts_hash_and_nullifier() {
    for v in vectors() {
        let (snapshot, pins) = secrets(&v);
        let own = pins.group_owner_hash;
        assert!(own == ts_owner_hash(&v), "{}: group owner_hash", v.name);
        let keys = snapshot.group_keys().unwrap();
        assert!(
            keys == (pins.nullifier_pk, pins.viewing_pk),
            "{}: group keys",
            v.name
        );
        let payee = payee_address(&v);
        let tag = payee.tag().unwrap();
        let payee_owner = p3_check::hashes::owner_hash(&tag, &payee.nullifier_pk).unwrap();
        assert!(
            payee_owner == unhex_n::<32>(&text(&v.json["payee"], "ownerHash")),
            "{}: payee",
            v.name
        );
        for (i, input) in v.json["inputs"].as_array().unwrap().iter().enumerate() {
            let utxo = Utxo {
                owner_hash: own,
                mint: mint_of(&text(input, "mint")),
                amount: u64_of(input, "amount"),
                blinding: unhex_n(&text(input, "blinding")),
            };
            let hash: Key = unhex_n(&text(input, "utxoHash"));
            assert!(
                utxo.hash(TREE_ID).unwrap() == hash,
                "{} input {i}: hash",
                v.name
            );
            let nullifier: Key = unhex_n(&text(input, "nullifier"));
            let got = utxo.nullifier(TREE_ID, &snapshot.nullifier_secret).unwrap();
            assert!(got == nullifier, "{} input {i}: nullifier", v.name);
        }
        for (i, out) in v.json["outputs"].as_array().unwrap().iter().enumerate() {
            let want: Key = unhex_n(&text(out, "utxoHash"));
            let blinding: Key = unhex_n(&text(out, "blinding"));
            let got = match role_of(out) {
                Role::Dummy => dummy_hash(&blinding, TREE_ID).unwrap(),
                role => Utxo {
                    owner_hash: if role == Role::Change {
                        own
                    } else {
                        payee_owner
                    },
                    mint: mint_of(&text(out, "mint")),
                    amount: u64_of(out, "amount"),
                    blinding,
                }
                .hash(TREE_ID)
                .unwrap(),
            };
            assert!(
                got == want,
                "{} output {i} ({}): hash",
                v.name,
                text(out, "role")
            );
        }
    }
}

#[test]
fn the_rust_code_reproduces_every_ts_ciphertext_byte_for_byte() {
    for v in vectors() {
        let (snapshot, _) = secrets(&v);
        let first: Key = unhex_n(&text(&v.json["inputs"][0], "nullifier"));
        let tx_key = ViewingKey::from_bytes(&snapshot.viewing_sk)
            .unwrap()
            .tx_key(&first)
            .unwrap();
        let want_pk: [u8; 33] = unhex_n(&text(&v.json, "txViewingPk"));
        assert!(
            tx_key.public().unwrap() == want_pk,
            "{}: tx_viewing_pk",
            v.name
        );
        let salt: [u8; 16] = unhex_n(&text(&v.json, "salt"));
        let group_pk = ViewingKey::from_bytes(&snapshot.viewing_sk)
            .unwrap()
            .public()
            .unwrap();
        for (i, out) in v.json["outputs"].as_array().unwrap().iter().enumerate() {
            let data = unhex(&text(out, "data"));
            assert_eq!(data.len(), BLOB_LEN, "{} output {i}: length", v.name);
            if role_of(out) == Role::Dummy {
                continue;
            }
            let recipient = if role_of(out) == Role::Change {
                group_pk
            } else {
                payee_address(&v).viewing_pk
            };
            let body = plaintext(
                u64_of(out, "assetId"),
                u64_of(out, "amount"),
                &unhex_n(&text(out, "blinding")),
            );
            let got = tx_key
                .slot_data(&recipient, &body, &salt, i as u32)
                .unwrap();
            assert!(
                got == data,
                "{} output {i} ({}): ciphertext",
                v.name,
                text(out, "role")
            );
        }
    }
}

#[test]
fn approve_accepts_the_message_of_every_ts_vector() {
    for v in vectors() {
        let (snapshot, pins) = secrets(&v);
        let tx = transact_of(&v);
        let intent = intent_of(&v, &tx);
        let plan = plan_of(&v);
        let msg = compile(&intent, &pins, Some(&tx)).unwrap_or_else(|e| panic!("{}: {e}", v.name));
        let bytes = v1::write(&msg).unwrap();
        let device = Device {
            pins: &pins,
            snapshot: &snapshot,
            now: NOW,
        };
        let approved = approve(&bytes, &intent, &plan, &device);
        let rules: Vec<_> = approved
            .as_ref()
            .err()
            .map(|r| r.violations.iter().map(|v| v.rule).collect())
            .unwrap_or_default();
        assert!(approved.is_ok(), "{}: {rules:?}", v.name);
    }
}

#[test]
fn a_changed_byte_in_any_ts_blob_or_hash_is_refused() {
    for v in vectors() {
        let (snapshot, pins) = secrets(&v);
        let plan = plan_of(&v);
        let device = Device {
            pins: &pins,
            snapshot: &snapshot,
            now: NOW,
        };
        let base = transact_of(&v);
        let intent = intent_of(&v, &base);
        for slot in 0..base.outputs.len() {
            let mut tx = base.clone();
            tx.outputs[slot].utxo_hash[31] ^= 1;
            let bytes = v1::write(&compile(&intent, &pins, Some(&tx)).unwrap()).unwrap();
            assert!(
                approve(&bytes, &intent, &plan, &device).is_err(),
                "{} hash {slot}",
                v.name
            );
            let mut tx = base.clone();
            tx.outputs[slot].data.as_mut().unwrap()[60] ^= 1;
            let bytes = v1::write(&compile(&intent, &pins, Some(&tx)).unwrap()).unwrap();
            let refused = approve(&bytes, &intent, &plan, &device).is_err();
            let dummy = plan.outputs[slot].role == Role::Dummy;
            assert!(
                refused != dummy,
                "{} blob {slot}: a dummy blob is random, a real one is not",
                v.name
            );
        }
    }
}

#[test]
fn the_rust_code_reproduces_every_ts_output_blinding_from_the_root_seed() {
    let all = vectors();
    assert!(all.len() >= 6);
    all.iter().for_each(assert_blindings_are_derived);
}

#[test]
fn a_wrong_root_seed_gives_other_blindings_for_every_ts_vector() {
    for mut v in vectors() {
        let mut seed: Key = unhex_n(&text(&v.json, "blindingSeed"));
        seed[31] ^= 1;
        v.json["blindingSeed"] = serde_json::Value::String(hex(&seed));
        let panicked = std::panic::catch_unwind(|| assert_blindings_are_derived(&v));
        assert!(panicked.is_err(), "{}: the seed is not checked", v.name);
    }
}
