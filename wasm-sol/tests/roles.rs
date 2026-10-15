//! The role keys of the group (ZOLANA.md 4.2) and the text forms of the entry points.
//! `vectors/roles.json` holds what the TS SDK gives for the role secrets of throwaway seeds
//! (`solspike/tools/role_vectors.mjs`): the Rust public keys must equal them. The secrets are
//! compared with `assert!(a == b)`, so a failure prints nothing of them.

use blake2b_simd::Params;
use p3_check::codec::{base64url, unhex, unhex_array};
use p3_check::consts::{POOL_DEVNET, REGISTRY_DEVNET};
use p3_check::frost::{CLUSTER, PROGRAM_LABEL};
use p3_check::hashes::owner_hash;
use p3_check::roles::{derive, roles, secrets, shielded_address};
use serde_json::Value;
use solana_address::Address;
use std::str::FromStr;

fn vectors() -> Vec<Value> {
    let path = format!("{}/vectors/roles.json", env!("CARGO_MANIFEST_DIR"));
    let all: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    all["vectors"].as_array().unwrap().clone()
}

fn field<const N: usize>(v: &Value, key: &str) -> [u8; N] {
    unhex_array(v[key].as_str().unwrap(), key).unwrap()
}

fn facts() -> Value {
    let path = format!("{}/vectors/facts.json", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

// ---- the keys ---------------------------------------------------------------------------------

#[test]
fn the_role_secrets_of_a_seed_equal_the_independent_javascript_derivation() {
    assert_eq!(vectors().len(), 4);
    for v in vectors() {
        let (nullifier_secret, viewing_sk) = secrets(&field(&v, "solSeed")).unwrap();
        assert!(
            nullifier_secret == field::<31>(&v, "nullifierSecret"),
            "{}",
            v["name"]
        );
        assert!(viewing_sk == field::<32>(&v, "viewingSk"), "{}", v["name"]);
    }
}

#[test]
fn the_wasm_public_keys_equal_the_sdk_public_keys_for_the_same_secrets() {
    for v in vectors() {
        let name = v["name"].as_str().unwrap();
        let roles = derive(&field(&v, "solSeed"), &field(&v, "groupKey")).unwrap();
        assert!(
            roles.nullifier_pk == field::<32>(&v, "nullifierPk"),
            "{name}: nullifier_pk"
        );
        assert!(
            roles.viewing_pk == field::<33>(&v, "viewingPk"),
            "{name}: viewing_pk"
        );
        assert!(
            roles.owner_hash == field::<32>(&v, "ownerHash"),
            "{name}: owner_hash"
        );
        assert!(
            roles.address == field::<99>(&v, "address"),
            "{name}: address"
        );
        let want = [
            field::<32>(&v, "groupKey").to_vec(),
            roles.nullifier_pk.to_vec(),
        ]
        .concat()
        .into_iter()
        .chain(roles.viewing_pk)
        .collect::<Vec<u8>>();
        assert!(
            roles.pins == want,
            "{name}: pins are group key, nullifier_pk, viewing_pk"
        );
    }
}

#[test]
fn the_seeds_of_the_vectors_include_the_edges() {
    let names: Vec<String> = vectors()
        .iter()
        .map(|v| v["name"].as_str().unwrap().into())
        .collect();
    assert!(names.contains(&"seed-zero".to_string()) && names.contains(&"seed-ff".to_string()));
}

#[test]
fn the_owner_hash_and_the_address_layout_equal_the_values_of_the_p5_and_p6_runs() {
    let facts = facts();
    let text = |k: &str| facts[k].as_str().unwrap().to_string();
    // The owner hash of the P5 group, from its public keys.
    let group = p3_check_b58(&text("group"));
    let nullifier_pk: [u8; 32] = unhex_array(&text("nullifier_pk"), "nullifier_pk").unwrap();
    let want: [u8; 32] = unhex_array(&text("group_owner_hash"), "owner_hash").unwrap();
    assert!(owner_hash(&group, &nullifier_pk).unwrap() == want);
    // The address of key B, which the P6 run saved: the layout of `shielded_address`.
    let saved = unhex(&text("payee_b_address"), "address").unwrap();
    let signer = p3_check_b58(&text("payee_b"));
    let (nk, vk): ([u8; 32], [u8; 33]) = (
        saved[34..66].try_into().unwrap(),
        saved[66..].try_into().unwrap(),
    );
    assert!(shielded_address(&signer, &nk, &vk) == saved);
}

fn p3_check_b58(text: &str) -> [u8; 32] {
    use std::str::FromStr;
    solana_address::Address::from_str(text).unwrap().to_bytes()
}

#[test]
fn the_seed_decides_the_secrets_and_the_group_key_decides_the_rest() {
    let (seed_a, seed_b) = ([1u8; 32], [2u8; 32]);
    let (group_a, group_b) = ([3u8; 32], [4u8; 32]);
    let base = derive(&seed_a, &group_a).unwrap();
    let other_group = derive(&seed_a, &group_b).unwrap();
    assert!(base.nullifier_secret == other_group.nullifier_secret);
    assert!(base.viewing_sk == other_group.viewing_sk);
    assert!(base.seal_key == other_group.seal_key);
    assert!(base.owner_hash != other_group.owner_hash && base.address != other_group.address);
    let other_seed = derive(&seed_b, &group_a).unwrap();
    assert!(base.nullifier_secret != other_seed.nullifier_secret);
    assert!(base.viewing_sk != other_seed.viewing_sk);
    assert!(base.seal_key != other_seed.seal_key);
}

#[test]
fn the_snapshot_seal_key_is_blake2b_of_the_seed_as_a_32_byte_base64url_secret() {
    let seed = [9u8; 32];
    let derived = derive(&seed, &[3u8; 32]).unwrap();
    let hash = Params::new()
        .hash_length(32)
        .personal(b"Zigs_SolSnap__v1")
        .hash(&seed);
    assert!(derived.seal_key == base64url(hash.as_bytes()));
    assert_eq!(derived.seal_key.len(), 43, "32 bytes without padding");
    assert!(derived
        .seal_key
        .bytes()
        .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_'));
}

#[test]
fn the_entry_point_gives_every_value_as_text_and_refuses_bad_input() {
    let v = &vectors()[0];
    let answer: Value = serde_json::from_str(
        &roles(
            v["solSeed"].as_str().unwrap(),
            v["groupKey"].as_str().unwrap(),
        )
        .unwrap(),
    )
    .unwrap();
    let names = [
        ("nullifier_secret", "nullifierSecret"),
        ("viewing_sk", "viewingSk"),
        ("nullifier_pk", "nullifierPk"),
        ("viewing_pk", "viewingPk"),
        ("owner_hash", "ownerHash"),
        ("address", "address"),
    ];
    for (key, sdk_key) in names {
        assert!(answer[key] == v[sdk_key], "{key}");
    }
    assert_eq!(answer["pins"].as_str().unwrap().len(), 97 * 2);
    let seed = v["solSeed"].as_str().unwrap();
    let group = v["groupKey"].as_str().unwrap();
    assert!(roles("zz", group).is_err());
    assert!(roles(&seed[2..], group).is_err(), "31 bytes");
    assert!(roles(seed, &group[2..]).is_err(), "31 bytes");
    assert!(roles(seed, &format!("{group}00")).is_err(), "33 bytes");
}

// ---- the text forms ---------------------------------------------------------------------------

#[test]
fn base64url_equals_the_rfc_4648_vectors_without_padding_and_uses_the_url_alphabet() {
    for (plain, coded) in [
        ("", ""),
        ("f", "Zg"),
        ("fo", "Zm8"),
        ("foo", "Zm9v"),
        ("foob", "Zm9vYg"),
        ("fooba", "Zm9vYmE"),
        ("foobar", "Zm9vYmFy"),
    ] {
        assert_eq!(base64url(plain.as_bytes()), coded);
    }
    assert_eq!(base64url(&[0xfb, 0xff]), "-_8");
    assert_eq!(base64url(&[0xff; 32]).len(), 43);
}

#[test]
fn hex_reads_both_cases_and_refuses_odd_length_and_bad_digits_without_a_panic() {
    assert_eq!(unhex("00ffA0", "x").unwrap(), vec![0, 255, 160]);
    assert!(unhex("0", "x").unwrap_err().contains("even number"));
    assert!(unhex("zz", "x").is_err());
    assert!(unhex("0g", "x").is_err());
    assert!(unhex("é", "x").is_err(), "a multi-byte character");
    assert!(unhex("é1", "x").is_err());
    assert!(unhex("+1", "x").is_err(), "a sign is not a digit");
    assert!(unhex_array::<4>("00112233", "x").is_ok());
    assert!(unhex_array::<4>("001122", "x").is_err());
}

// ---- the program label ------------------------------------------------------------------------

#[test]
fn the_program_label_names_the_cluster_the_pool_and_the_registry() {
    // A soldone document carries this text, and a seat whose text differs ends. It is a constant
    // of the wasm, so it must be the base58 text of the two addresses that the pins hold.
    let parts: Vec<&str> = PROGRAM_LABEL.split(':').collect();
    assert_eq!(parts.len(), 3, "{PROGRAM_LABEL}");
    assert_eq!(parts[0], format!("zolana-{CLUSTER}"));
    let address = |text: &str| Address::from_str(text).expect("base58").to_bytes();
    assert!(address(parts[1]) == POOL_DEVNET, "the pool");
    assert!(address(parts[2]) == REGISTRY_DEVNET, "the registry");
    assert_eq!(p3_check::wasm::sol_program_label(), PROGRAM_LABEL);
}
