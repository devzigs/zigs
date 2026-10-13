//! Key ceremony v2: the signers agree on a secret `sk`, and every wallet key follows from it and
//! the FROST group key as ZIP 2005 (Proposed) specifies for `use_qsk = true`.
//!
//! Seats are numbered 1..=n. Every JSON argument keyed by seat is read into an ordered map, so the
//! order is numeric (seat 10 comes after seat 2). All byte strings are hex. `walletId` is hashed
//! as its UTF-8 bytes. Hash domains are BLAKE2b personalizations of exactly 16 bytes.
//!
//! JSON shapes:
//! - `skCommit(walletId, seat, boxPk, rHex)` returns the commitment hex.
//! - `dkgEcho(walletId, round1)`: `round1 = {"1": {"package": {...}, "commit": hex}, ...}`.
//! - `vaultSk(walletId, echoHex, parts)`:
//!   `parts = {"1": {"r": hex, "commit": hex, "boxPk": hex}, ...}`.
//! - `safetyNumber(walletId, t, n, network, seats)`: `seats = {"1": boxPkHex, ...}`; returns 30
//!   digits in six groups of five, "12345 67890 12345 67890 12345 67890".
//! - `walletCreateV2(publicKeyPackage, network, skHex)` returns the `walletCreate` JSON plus
//!   `"version": 2`, and no secret.
//! - `walletVerifyV2(wallet, myPublicKeyPackage, mySkHex)` returns `{"ok": true}` or an error.

use std::collections::BTreeMap;

use blake2b_simd::Params;
use group::ff::{FromUniformBytes, PrimeField};
use orchard::{
    keys::{FullViewingKey, SpendValidatingKey, SpendingKey},
    primitives::redpallas::{self, SpendAuth},
};
use reddsa::frost::redpallas::{keys::dkg, keys::PublicKeyPackage};
use serde::Deserialize;
use serde_json::{json, Value};

use super::{ensure, from_json, from_value, group_vk_bytes, network, wallet_doc, R};

const SK_COMMIT: &[u8; 16] = b"Zigs_SkCommit_v1";
const DKG_ECHO: &[u8; 16] = b"Zigs_DkgEcho__v1";
const VAULT_SK: &[u8; 16] = b"Zigs_VaultSk__v1";
const SAFETY_NO: &[u8; 16] = b"Zigs_SafetyNo_v1";
const QK_CONTEXT: &str = "Zcash ZIP 2005 qk-derivation v1";

fn blake2b_256(personal: &[u8; 16], data: &[u8]) -> [u8; 32] {
    let h = Params::new().hash_length(32).personal(personal).hash(data);
    h.as_bytes().try_into().expect("32-byte hash")
}

fn hex_array<const N: usize>(s: &str, what: &str) -> R<[u8; N]> {
    let raw = hex::decode(s).map_err(|x| format!("bad {what}: {x}"))?;
    raw.try_into()
        .map_err(|_| format!("bad {what}: need {N} bytes"))
}

/// Reads `{"1": X, "2": Y, ...}` in seat order. The seats must be exactly 1..=n with n >= 2.
fn seat_map<T: serde::de::DeserializeOwned>(json: &str, what: &str) -> R<BTreeMap<u16, T>> {
    let v: Value = from_json(json, what)?;
    let obj = v
        .as_object()
        .ok_or_else(|| format!("{what} must be an object"))?;
    let mut seats = BTreeMap::new();
    for (k, x) in obj {
        let seat: u16 = k.parse().map_err(|_| format!("bad seat {k} in {what}"))?;
        ensure(
            seats.insert(seat, from_value(x, what)?).is_none(),
            &format!("seat {k} twice in {what}"),
        )?;
    }
    ensure(seats.len() >= 2, &format!("{what} needs at least 2 seats"))?;
    ensure(
        seats.keys().zip(1u16..).all(|(k, i)| *k == i),
        &format!("{what} must hold seats 1 to n"),
    )?;
    Ok(seats)
}

fn push_len_prefixed(buf: &mut Vec<u8>, bytes: &[u8]) -> R<()> {
    let len = u32::try_from(bytes.len()).map_err(|_| "value too long to hash")?;
    buf.extend_from_slice(&len.to_le_bytes());
    buf.extend_from_slice(bytes);
    Ok(())
}

/// Commits seat `seat` to its secret part `r`:
/// BLAKE2b-256("Zigs_SkCommit_v1", walletId || u16le(seat) || boxPk || r).
pub fn sk_commit(wallet_id: &str, seat: u16, box_pk: &str, r_hex: &str) -> R<String> {
    ensure(seat >= 1, "seat must be 1 or more")?;
    let mut data = wallet_id.as_bytes().to_vec();
    data.extend_from_slice(&seat.to_le_bytes());
    data.extend_from_slice(&hex_array::<32>(box_pk, "boxPk")?);
    data.extend_from_slice(&hex_array::<32>(r_hex, "r")?);
    Ok(hex::encode(blake2b_256(SK_COMMIT, &data)))
}

#[derive(Deserialize)]
struct Round1Doc {
    package: Value,
    commit: String,
}

/// A digest of everything every seat saw in round 1. Seats that hold different round-1 data get
/// different digests. The hash input is: u32le(len) || walletId, then for each seat in order
/// u16le(seat) || u32le(len) || canonical round-1 package || commit. The canonical package is
/// the FROST binary encoding of the parsed package, so JSON key order and spacing do not matter.
pub fn dkg_echo(wallet_id: &str, round1: &str) -> R<String> {
    let docs: BTreeMap<u16, Round1Doc> = seat_map(round1, "round-1 documents")?;
    let mut data = vec![];
    push_len_prefixed(&mut data, wallet_id.as_bytes())?;
    for (seat, doc) in &docs {
        let package: dkg::round1::Package = from_value(&doc.package, "round-1 package")?;
        let canonical = package
            .serialize()
            .map_err(|x| format!("round-1 package of seat {seat}: {x:?}"))?;
        data.extend_from_slice(&seat.to_le_bytes());
        push_len_prefixed(&mut data, &canonical)?;
        data.extend_from_slice(&hex_array::<32>(&doc.commit, "commit")?);
    }
    Ok(hex::encode(blake2b_256(DKG_ECHO, &data)))
}

#[derive(Deserialize)]
struct SkPart {
    r: String,
    commit: String,
    #[serde(rename = "boxPk")]
    box_pk: String,
}

/// The agreed secret: BLAKE2b-256("Zigs_VaultSk__v1", walletId || echo || r_1 || ... || r_n).
/// Every commitment is checked first. The error names the first seat whose `r` does not match.
pub fn vault_sk(wallet_id: &str, echo_hex: &str, parts: &str) -> R<String> {
    let echo: [u8; 32] = hex_array(echo_hex, "echo")?;
    let parts: BTreeMap<u16, SkPart> = seat_map(parts, "secret parts")?;
    let mut data = wallet_id.as_bytes().to_vec();
    data.extend_from_slice(&echo);
    for (seat, part) in &parts {
        let want: [u8; 32] = hex_array(
            &sk_commit(wallet_id, *seat, &part.box_pk, &part.r)?,
            "commit",
        )?;
        let got: [u8; 32] = hex_array(&part.commit, "commit")?;
        ensure(
            want == got,
            &format!("seat {seat}: the secret part does not match its commitment"),
        )?;
        data.extend_from_slice(&hex_array::<32>(&part.r, "r")?);
    }
    Ok(hex::encode(blake2b_256(VAULT_SK, &data)))
}

/// 30 digits (about 100 bits) that all signers compare out of band:
/// BLAKE2b-256("Zigs_SafetyNo_v1", walletId || u8(t) || u8(n) || u32le(len) || network
/// || for each seat in order: u16le(seat) || boxPk),
/// then the first 16 bytes as a little-endian u128, modulo 10^30, in six groups of five digits.
/// `t`, `n` and `network` come from the wallet document, which no key authenticates, so the number
/// covers them. A shorter number lets an attacker who shows two views of the seat list find a
/// collision.
pub fn safety_number(wallet_id: &str, t: u16, n: u16, network: &str, seats: &str) -> R<String> {
    let keys: BTreeMap<u16, String> = seat_map(seats, "seats")?;
    let one_byte = |x: u16, what: &str| u8::try_from(x).map_err(|_| format!("{what} is too big"));
    let mut data = wallet_id.as_bytes().to_vec();
    data.extend_from_slice(&[one_byte(t, "t")?, one_byte(n, "n")?]);
    push_len_prefixed(&mut data, network.as_bytes())?;
    for (seat, box_pk) in &keys {
        data.extend_from_slice(&seat.to_le_bytes());
        data.extend_from_slice(&hex_array::<32>(box_pk, "boxPk")?);
    }
    let h = blake2b_256(SAFETY_NO, &data);
    let digits = u128::from_le_bytes(h[..16].try_into().expect("16 bytes")) % 10u128.pow(30);
    Ok(group_digits(&format!("{digits:030}")))
}

fn group_digits(digits: &str) -> String {
    let groups: Vec<&str> = digits
        .as_bytes()
        .chunks(5)
        .map(|c| std::str::from_utf8(c).expect("ascii digits"))
        .collect();
    groups.join(" ")
}

// ───────────────────── ZIP 2005 key derivation (use_qsk = true) ─────────────────────

/// PRF^expand_k(t) = BLAKE2b-512("Zcash_ExpandSeed", k || t).
fn prf_expand(k: &[u8; 32], t: &[&[u8]]) -> [u8; 64] {
    let mut h = Params::new()
        .hash_length(64)
        .personal(b"Zcash_ExpandSeed")
        .to_state();
    h.update(k);
    for part in t {
        h.update(part);
    }
    h.finalize().as_bytes().try_into().expect("64-byte hash")
}

/// ToScalar^Orchard: 64 bytes as a little-endian integer, reduced modulo r_P, as 32 bytes.
/// orchard exports no field types. `pin` has the Pallas scalar in its signature, so it fixes `S`.
fn to_scalar<S: FromUniformBytes<64> + PrimeField>(
    _pin: fn(&SpendValidatingKey, &S) -> redpallas::VerificationKey<SpendAuth>,
    x: &[u8; 64],
) -> [u8; 32] {
    S::from_uniform_bytes(x)
        .to_repr()
        .as_ref()
        .try_into()
        .expect("32-byte scalar")
}

fn to_scalar_orchard(x: &[u8; 64]) -> [u8; 32] {
    to_scalar(SpendValidatingKey::randomize, x)
}

/// H^nk(sk) = ToBase^Orchard(PRF^expand_sk([0x07])). It does not depend on `use_qsk`, so this
/// takes the value from orchard's own derivation. The ask that orchard also derives is dropped.
fn h_nk(sk: &[u8; 32]) -> R<[u8; 32]> {
    let key = Option::<SpendingKey>::from(SpendingKey::from_bytes(*sk))
        .ok_or("sk is not a valid spending key")?;
    Ok(FullViewingKey::from(&key).to_bytes()[32..64]
        .try_into()
        .expect("32 bytes"))
}

/// H^qsk(sk) = truncate_32(PRF^expand_sk([0x0C])).
fn h_qsk(sk: &[u8; 32]) -> [u8; 32] {
    prf_expand(sk, &[&[0x0C]])[..32]
        .try_into()
        .expect("32 bytes")
}

/// H^qk(qsk) = BLAKE3.derive_key("Zcash ZIP 2005 qk-derivation v1", qsk, 32).
fn h_qk(qsk: &[u8; 32]) -> [u8; 32] {
    blake3::derive_key(QK_CONTEXT, qsk)
}

/// H^rivk_ext_qk(ak, nk) = ToScalar^Orchard(PRF^expand_qk([0x0D] || ak || nk)).
fn h_rivk_ext(qk: &[u8; 32], ak: &[u8; 32], nk: &[u8; 32]) -> [u8; 32] {
    to_scalar_orchard(&prf_expand(qk, &[&[0x0D], ak, nk]))
}

/// The full viewing key for FROST group key `ak` and agreed `sk`. The internal keys follow from
/// orchard's own ZIP 32 derivation (domain 0x83 keyed by rivk_ext).
fn fvk_v2(ak: [u8; 32], sk: [u8; 32]) -> R<FullViewingKey> {
    ensure(ak[31] & 0x80 == 0, "group key does not have even y")?;
    SpendValidatingKey::from_bytes(&ak).ok_or("group key is not a valid ak")?;
    let nk = h_nk(&sk)?;
    let rivk_ext = h_rivk_ext(&h_qk(&h_qsk(&sk)), &ak, &nk);
    let raw = [ak.as_slice(), &nk, &rivk_ext]
        .concat()
        .try_into()
        .expect("96 bytes");
    FullViewingKey::from_bytes(&raw).ok_or_else(|| "assembled FVK invalid".to_string())
}

fn fvk_from_package(public_key_package: &str, sk_hex: &str) -> R<FullViewingKey> {
    let pkp: PublicKeyPackage = from_json(public_key_package, "public key package")?;
    fvk_v2(group_vk_bytes(&pkp)?, hex_array(sk_hex, "sk")?)
}

/// ZIP 2005 "Usage with FROST": ak is the FROST group key, and nk, qsk, qk and rivk_ext follow
/// from the agreed `sk`. The output holds no secret.
pub fn wallet_create_v2(public_key_package: &str, net: &str, sk_hex: &str) -> R<String> {
    let net = network(net)?;
    let fvk = fvk_from_package(public_key_package, sk_hex)?;
    let mut doc = wallet_doc(&fvk, net)?;
    doc["version"] = json!(2);
    Ok(doc.to_string())
}

/// A signer recomputes the whole wallet from its own group key and its own `sk`, and compares
/// every published part. The error names the first part that differs.
pub fn wallet_verify_v2(wallet: &str, my_public_key_package: &str, my_sk_hex: &str) -> R<String> {
    let w: Value = from_json(wallet, "wallet")?;
    ensure(w["version"] == 2, "this is not a version 2 wallet")?;
    let net = network(w["network"].as_str().ok_or("wallet.network is missing")?)?;
    let mine = fvk_from_package(my_public_key_package, my_sk_hex)?;
    let theirs: [u8; 96] = hex_array(
        w["orchard_fvk"]
            .as_str()
            .ok_or("wallet.orchard_fvk is missing")?,
        "orchard_fvk",
    )?;
    let mine_raw = mine.to_bytes();
    for (name, part) in [("ak", 0..32), ("nk", 32..64), ("rivk", 64..96)] {
        let msg =
            format!("the wallet's {name} is not the {name} you computed. Do not use this wallet");
        ensure(theirs[part.clone()] == mine_raw[part], &msg)?;
    }
    let expected = wallet_doc(&mine, net)?;
    for field in ["group_verifying_key", "ufvk", "address"] {
        let msg =
            format!("the wallet's {field} is not the {field} you computed. Do not use this wallet");
        ensure(w[field] == expected[field], &msg)?;
    }
    Ok(json!({"ok": true}).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{dkg_part1, dkg_part2, dkg_part3, random_sk, wallet_create};
    use zcash_protocol::consensus::Network;

    const WALLET: &str = "wallet-for-tests";
    const PACKAGES: [&str; 3] = [
        r#"{"commitment":["fa998a794654d1e0163e2a5addb8313829b2b1d05a6263e47111b0209993ceb4","a35e2ec754808de65647df3760c3290e52a43ef4f0c6f5acff22cceab9086213"],"header":{"ciphersuite":"FROST(Pallas, BLAKE2b-512)","version":0},"proof_of_knowledge":"72ff5c724961a205352145e6f289a020057d0def599a92e10fdd89828011820a95647b5ff24592dce867403b6e6a71e064d9839f3a93e21f5a8ab3f111600700"}"#,
        r#"{"commitment":["08cc1f5eeaf67733493de6bc2c9af4596f84d5ff9b21943d21d50af910f20e9b","009963d7633ccb8e47bbc4fc97430b480ea00d8ac22626988d84aaf73ceb9f8f"],"header":{"ciphersuite":"FROST(Pallas, BLAKE2b-512)","version":0},"proof_of_knowledge":"24ed31e46a6fff88b549debf94489d0352ad9c6fc11bd5e9f2e0ef80a2c6a619acedca9afe54d25af667ba4a8380d0bc3ce4ab01552064ef0847c4339c612e3f"}"#,
        r#"{"commitment":["be531ef38d16c4cb585791770d56c11e0e339c201a3add3091fa2ac96bd14a20","d82ef44896b16ffd3c110135569a419d1434801711f0bc5e775f26a3a13617a9"],"header":{"ciphersuite":"FROST(Pallas, BLAKE2b-512)","version":0},"proof_of_knowledge":"0ef4b1760774bbf6f16efd299ab6030c0c36423a8ffe4877cc24a845a9bc3526bc5d4ac108596815ff596ad5067f0da80e8742b3c56f0a13247bb08ce3be3236"}"#,
    ];
    const AK: &str = "8aac6d2c0cb0882900541c70b3ebdb859f89e3a586ecbb877f89e3f956aa632e";

    fn v(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }

    fn box_pk(seat: u16) -> String {
        hex::encode([0x10 + seat as u8; 32])
    }

    fn r_hex(seat: u16) -> String {
        hex::encode([0xA0 + seat as u8; 32])
    }

    fn commit(seat: u16) -> String {
        sk_commit(WALLET, seat, &box_pk(seat), &r_hex(seat)).unwrap()
    }

    fn round1() -> Value {
        let docs: Vec<_> = (1..=3u16)
            .map(|i| {
                (
                    i.to_string(),
                    json!({"package": v(PACKAGES[i as usize - 1]), "commit": commit(i)}),
                )
            })
            .collect();
        Value::Object(docs.into_iter().collect())
    }

    fn parts() -> Value {
        let docs: Vec<_> = (1..=3u16)
            .map(|i| {
                (
                    i.to_string(),
                    json!({"r": r_hex(i), "commit": commit(i), "boxPk": box_pk(i)}),
                )
            })
            .collect();
        Value::Object(docs.into_iter().collect())
    }

    fn echo() -> String {
        dkg_echo(WALLET, &round1().to_string()).unwrap()
    }

    fn sk() -> String {
        vault_sk(WALLET, &echo(), &parts().to_string()).unwrap()
    }

    /// Public key package of a fresh 2-of-2 DKG, as seat 1 computes it.
    fn group_package() -> String {
        let r1: Vec<Value> = (1..=2).map(|i| v(&dkg_part1(i, 2, 2).unwrap())).collect();
        let r2: Vec<Value> = (0..2)
            .map(|i| {
                let all = json!({ (2 - i).to_string(): r1[1 - i]["package"] });
                v(&dkg_part2(&r1[i]["secret"].to_string(), &all.to_string()).unwrap())
            })
            .collect();
        let all1 = json!({"2": r1[1]["package"]}).to_string();
        let all2 = json!({"2": r2[1]["outgoing"]["1"]}).to_string();
        v(&dkg_part3(&r2[0]["secret"].to_string(), &all1, &all2).unwrap())["public_key_package"]
            .to_string()
    }

    fn hex_of<const N: usize>(s: &str) -> [u8; N] {
        hex_array(s, "test value").unwrap()
    }

    #[test]
    fn primitives_match_orchard() {
        for _ in 0..16 {
            let sk = random_sk();
            let k = *sk.to_bytes();
            let fvk = FullViewingKey::from(&sk).to_bytes();
            assert_eq!(
                h_nk(&k).unwrap(),
                fvk[32..64],
                "nk is the nk slice of orchard's own FVK"
            );
            assert_eq!(
                to_scalar_orchard(&prf_expand(&k, &[&[0x08]])),
                fvk[64..96],
                "rivk"
            );
            // ZIP 32 internal keys: the same PRF shape as rivk_ext, with domain 0x83 keyed by rivk.
            let rivk_ext: [u8; 32] = fvk[64..].try_into().unwrap();
            let internal =
                to_scalar_orchard(&prf_expand(&rivk_ext, &[&[0x83], &fvk[..32], &fvk[32..64]]));
            let moved = FullViewingKey::from_bytes(
                &[&fvk[..64], &internal[..]].concat().try_into().unwrap(),
            )
            .unwrap();
            let orchard_fvk = FullViewingKey::from_bytes(&fvk).unwrap();
            assert_eq!(
                moved.to_ivk(orchard::keys::Scope::External).to_bytes(),
                orchard_fvk
                    .to_ivk(orchard::keys::Scope::Internal)
                    .to_bytes()
            );
        }
    }

    #[test]
    fn hashes_follow_the_written_formulas() {
        let b2 = |personal: &[u8; 16], parts: &[&[u8]]| {
            let mut h = Params::new().hash_length(32).personal(personal).to_state();
            parts.iter().for_each(|p| {
                h.update(p);
            });
            hex::encode(h.finalize().as_bytes())
        };
        let (pk1, r1) = (hex_of::<32>(&box_pk(1)), hex_of::<32>(&r_hex(1)));
        assert_eq!(
            commit(1),
            b2(
                b"Zigs_SkCommit_v1",
                &[WALLET.as_bytes(), &1u16.to_le_bytes(), &pk1, &r1]
            )
        );

        let mut echo_data = vec![];
        echo_data.extend((WALLET.len() as u32).to_le_bytes());
        echo_data.extend(WALLET.as_bytes());
        for i in 1..=3u16 {
            let package: dkg::round1::Package =
                serde_json::from_str(PACKAGES[i as usize - 1]).unwrap();
            let package = package.serialize().unwrap();
            echo_data.extend(i.to_le_bytes());
            echo_data.extend((package.len() as u32).to_le_bytes());
            echo_data.extend(package);
            echo_data.extend(hex::decode(commit(i)).unwrap());
        }
        assert_eq!(echo(), b2(b"Zigs_DkgEcho__v1", &[&echo_data]));

        let rs: Vec<u8> = (1..=3u16)
            .flat_map(|i| hex::decode(r_hex(i)).unwrap())
            .collect();
        let echo_raw = hex::decode(echo()).unwrap();
        assert_eq!(
            sk(),
            b2(b"Zigs_VaultSk__v1", &[WALLET.as_bytes(), &echo_raw, &rs])
        );
    }

    #[test]
    fn known_answers() {
        assert_eq!(
            commit(1),
            "be5d68cf3ea0ea60ce966558aff173323cffdce1a0adb7bc5a458110d88324ff"
        );
        assert_eq!(
            echo(),
            "7ca35468b0707a3475716af17bf2a79bd85574c62a5f2d3ebe6e8ce1aaa6fa00"
        );
        assert_eq!(
            sk(),
            "fe26e4205e7196425ff2e859c2ad9cbf3127a9a97d1e89b6e14b1e1f7e8869ba"
        );
        let seats: Vec<_> = (1..=3u16).map(|i| (i.to_string(), box_pk(i))).collect();
        let seats = Value::Object(seats.into_iter().map(|(k, x)| (k, json!(x))).collect());
        assert_eq!(
            safety_number(WALLET, 2, 3, "testnet", &seats.to_string()).unwrap(),
            "89874 09867 57953 01750 40326 75355"
        );

        let (ak, sk) = (hex_of::<32>(AK), [0x42u8; 32]);
        let qsk = h_qsk(&sk);
        assert_eq!(
            hex::encode(qsk),
            "d63152fc3096c71b6ee01efe2cc8044b79ad479b2276082669d585c657c44619"
        );
        assert_eq!(
            hex::encode(h_qk(&qsk)),
            "b09bc7ddf5e59524741f2a15e9668faffb3c9f5924249a3a7c7e48297e8e221c"
        );
        let doc = wallet_doc(&fvk_v2(ak, sk).unwrap(), Network::TestNetwork).unwrap();
        assert_eq!(
            doc["orchard_fvk"],
            "8aac6d2c0cb0882900541c70b3ebdb859f89e3a586ecbb877f89e3f956aa632e\
             03077d95667ae380dbb6fd28c3433d80c02201ac3ffedd05aecf92aadf7d630e\
             f076af09e02aa14e802eb3dea65314f43d75e0b6cb7573b3e645e3c7388cb33e"
        );
        assert_eq!(
            doc["address"],
            "utest1f3k8l7zd9xh58vw85jucu6ng6kkw7pp5w648pgz57dqrqjkndqytnfee4n39cv8zcv0nvlg9necw97k29n76qycarp5tanhkec7tzfs7"
        );
    }

    #[test]
    fn safety_number_reads_seats_in_numeric_order() {
        let keys: Vec<(u16, String)> = (1..=10u16).map(|i| (i, box_pk(i))).collect();
        let doc = |order: &[usize]| {
            let mut data = WALLET.as_bytes().to_vec();
            data.extend([2u8, 10]);
            data.extend(7u32.to_le_bytes());
            data.extend(b"testnet");
            for &i in order {
                data.extend(keys[i].0.to_le_bytes());
                data.extend(hex::decode(&keys[i].1).unwrap());
            }
            let n = u128::from_le_bytes(
                blake2b_256(b"Zigs_SafetyNo_v1", &data)[..16]
                    .try_into()
                    .unwrap(),
            );
            format!("{:030}", n % 10u128.pow(30))
        };
        let numeric: Vec<usize> = (0..10).collect();
        let text_order = [0, 9, 1, 2, 3, 4, 5, 6, 7, 8];
        assert_ne!(doc(&numeric), doc(&text_order));
        let seats = Value::Object(
            keys.iter()
                .map(|(i, k)| (i.to_string(), json!(k)))
                .collect(),
        );
        let got = safety_number(WALLET, 2, 10, "testnet", &seats.to_string()).unwrap();
        let digits: String = got.split(' ').collect();
        assert_eq!(got.len(), 35);
        assert_eq!(got.split(' ').map(str::len).collect::<Vec<_>>(), [5; 6]);
        assert_eq!(digits, doc(&numeric));
    }

    #[test]
    fn safety_number_changes_with_any_key_wallet_or_setting() {
        let seats = |keys: [u16; 3]| {
            let docs = keys
                .iter()
                .zip(1u16..)
                .map(|(k, i)| (i.to_string(), json!(box_pk(*k))));
            Value::Object(docs.collect()).to_string()
        };
        let number =
            |id: &str, t, n, net: &str, keys| safety_number(id, t, n, net, &seats(keys)).unwrap();
        let base = number(WALLET, 2, 3, "testnet", [1, 2, 3]);
        assert_eq!(number(WALLET, 2, 3, "testnet", [1, 2, 3]), base);
        assert_ne!(number(WALLET, 2, 3, "testnet", [1, 2, 4]), base);
        assert_ne!(number(WALLET, 2, 3, "testnet", [2, 1, 3]), base);
        assert_ne!(number("other-wallet", 2, 3, "testnet", [1, 2, 3]), base);
        assert_ne!(number(WALLET, 3, 3, "testnet", [1, 2, 3]), base);
        assert_ne!(number(WALLET, 2, 4, "testnet", [1, 2, 3]), base);
        assert_ne!(number(WALLET, 2, 3, "mainnet", [1, 2, 3]), base);
        assert!(safety_number(WALLET, 2, 3, "testnet", r#"{"1": "00", "2": "00"}"#).is_err());
        assert!(safety_number(WALLET, 256, 3, "testnet", &seats([1, 2, 3])).is_err());
        assert!(safety_number(WALLET, 2, 256, "testnet", &seats([1, 2, 3])).is_err());
    }

    #[test]
    fn echo_ignores_json_layout_and_catches_every_difference() {
        let base = echo();
        let spaced = serde_json::to_string_pretty(&round1()).unwrap();
        assert_eq!(dkg_echo(WALLET, &spaced).unwrap(), base);
        assert_ne!(
            dkg_echo("other-wallet", &round1().to_string()).unwrap(),
            base
        );

        let mut other_commit = round1();
        other_commit["2"]["commit"] = json!(commit(3));
        assert_ne!(dkg_echo(WALLET, &other_commit.to_string()).unwrap(), base);

        let mut swapped = round1();
        swapped["1"]["package"] = v(PACKAGES[1]);
        swapped["2"]["package"] = v(PACKAGES[0]);
        assert_ne!(dkg_echo(WALLET, &swapped.to_string()).unwrap(), base);

        let mut gap = round1();
        gap.as_object_mut().unwrap().remove("2");
        assert!(dkg_echo(WALLET, &gap.to_string())
            .unwrap_err()
            .contains("seats 1 to n"));
        let mut broken = round1();
        broken["3"]["package"] = json!({"commitment": []});
        assert!(dkg_echo(WALLET, &broken.to_string()).is_err());
    }

    #[test]
    fn vault_sk_checks_every_commitment() {
        let echo = echo();
        let run = |p: &Value| vault_sk(WALLET, &echo, &p.to_string());
        let good = sk();
        assert_eq!(good.len(), 64);

        let mut wrong_r = parts();
        wrong_r["2"]["r"] = json!(r_hex(3));
        assert!(run(&wrong_r).unwrap_err().contains("seat 2"));
        let mut wrong_commit = parts();
        wrong_commit["3"]["commit"] = json!(commit(1));
        assert!(run(&wrong_commit).unwrap_err().contains("seat 3"));
        let mut wrong_key = parts();
        wrong_key["1"]["boxPk"] = json!(box_pk(2));
        assert!(run(&wrong_key).unwrap_err().contains("seat 1"));
        let mut gap = parts();
        gap.as_object_mut().unwrap().remove("2");
        assert!(run(&gap).unwrap_err().contains("seats 1 to n"));

        assert_ne!(
            vault_sk(WALLET, &hex::encode([9u8; 32]), &parts().to_string()).unwrap(),
            good
        );
        assert!(vault_sk("other-wallet", &echo, &parts().to_string())
            .unwrap_err()
            .contains("seat 1"));
    }

    #[test]
    fn derivation_rejects_a_group_key_with_odd_y() {
        let mut ak = hex_of::<32>(AK);
        ak[31] |= 0x80;
        assert!(fvk_v2(ak, [1u8; 32]).unwrap_err().contains("even y"));
    }

    #[test]
    fn create_v2_publishes_no_secret_and_verify_v2_compares_everything() {
        let pkp = group_package();
        let sk = sk();
        let doc = wallet_create_v2(&pkp, "testnet", &sk).unwrap();
        let w = v(&doc);
        let mut keys: Vec<&str> = w.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "address",
                "group_verifying_key",
                "network",
                "orchard_fvk",
                "ufvk",
                "version"
            ]
        );
        assert_eq!(w["version"], 2);
        let sk_raw: [u8; 32] = hex_of(&sk);
        let secrets = [sk_raw, h_qsk(&sk_raw), h_qk(&h_qsk(&sk_raw))];
        assert!(secrets.iter().all(|s| !doc.contains(&hex::encode(s))));
        assert!(wallet_verify_v2(&doc, &pkp, &sk).is_ok());
        let v1 = wallet_create(&pkp, "testnet").unwrap();
        assert!(wallet_verify_v2(&v1, &pkp, &sk)
            .unwrap_err()
            .contains("version 2"));

        let mine = fvk_v2(
            group_vk_bytes(&from_json(&pkp, "pkp").unwrap()).unwrap(),
            sk_raw,
        )
        .unwrap()
        .to_bytes();
        let other = FullViewingKey::from(&random_sk()).to_bytes();
        let coherent = |raw: [u8; 96]| {
            let fvk = FullViewingKey::from_bytes(&raw).unwrap();
            wallet_doc(&fvk, Network::TestNetwork)
                .unwrap()
                .as_object()
                .unwrap()
                .clone()
        };
        let with_part = |range: std::ops::Range<usize>| {
            let mut raw = mine;
            raw[range.clone()].copy_from_slice(&other[range]);
            let mut w = coherent(raw);
            w.insert("version".into(), json!(2));
            Value::Object(w).to_string()
        };
        let verify = |w: &str| wallet_verify_v2(w, &pkp, &sk).unwrap_err();
        assert!(verify(&with_part(0..32)).contains("wallet's ak"));
        assert!(verify(&with_part(32..64)).contains("wallet's nk"));
        assert!(verify(&with_part(64..96)).contains("wallet's rivk"));

        let tamper = |field: &str, value: Value| {
            let mut t = w.clone();
            t[field] = value;
            verify(&t.to_string())
        };
        assert!(tamper("address", json!("utest1x")).contains("wallet's address"));
        assert!(tamper("ufvk", json!("utestview1x")).contains("wallet's ufvk"));
        assert!(tamper("group_verifying_key", json!(hex::encode([1u8; 32])))
            .contains("group_verifying_key"));
        assert!(tamper("network", json!("mainnet")).contains("wallet's ufvk"));
        assert!(tamper("network", Value::Null).contains("network is missing"));
        assert!(wallet_verify_v2(&doc, &pkp, &hex::encode([7u8; 32]))
            .unwrap_err()
            .contains("wallet's nk"));
        assert!(wallet_verify_v2(&doc, &group_package(), &sk)
            .unwrap_err()
            .contains("wallet's ak"));
    }
}
