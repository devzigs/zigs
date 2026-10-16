//! The role keys of the group (ZOLANA.md 4.2), derived from `solSeed` with Zigs labels, not the
//! `TSPP/*` labels of the SDK.
//!
//! Both secrets come from one HKDF-SHA256 with the seed as input key material and an empty salt:
//!
//! - nullifier secret: info `zigs-sol/nullifier-secret/v1`, 31 bytes. `nullifier_pk` is its
//!   Poseidon hash.
//! - viewing scalar: info `zigs-sol/viewing-scalar/v1`, 48 bytes, read as a big-endian integer and
//!   reduced modulo the P-256 order (`FromOkm`, as the SDK reduces its viewing key). A zero scalar
//!   is an error. `viewing_pk` is its compressed public key.
//!
//! The snapshot seal key is `BLAKE2b-256("Zigs_SolSnap__v1", solSeed)` as base64url without
//! padding: the 32-byte secret that `secretSeal` of the Zcash engine takes.

use hkdf::Hkdf;
use p256::elliptic_curve::generic_array::GenericArray;
use p256::elliptic_curve::hash2curve::FromOkm;
use p256::{NonZeroScalar, Scalar, SecretKey};
use serde_json::json;
use sha2::Sha256;

use crate::address::Address;
use crate::bytes::hex;
use crate::codec::{base64url, blake2b_256, unhex_array};
use crate::consts::Key;
use crate::hashes::{nullifier_pk, owner_hash};
use crate::viewing::ViewingKey;

const INFO_NULLIFIER: &[u8] = b"zigs-sol/nullifier-secret/v1";
const INFO_VIEWING: &[u8] = b"zigs-sol/viewing-scalar/v1";
const SNAPSHOT_PERSONAL: &[u8; 16] = b"Zigs_SolSnap__v1";

/// Everything that follows from `solSeed` and the group key. The two secrets are for the seats
/// and the Worker of this wallet only.
pub struct Roles {
    pub nullifier_secret: [u8; 31],
    pub viewing_sk: [u8; 32],
    pub nullifier_pk: Key,
    pub viewing_pk: [u8; 33],
    pub owner_hash: Key,
    /// The full shielded address of the group (99 bytes).
    pub address: Vec<u8>,
    pub seal_key: String,
}

/// The nullifier secret and the viewing scalar of a seed.
pub fn secrets(seed: &[u8; 32]) -> Result<([u8; 31], [u8; 32]), String> {
    let hkdf = Hkdf::<Sha256>::new(None, seed);
    let expand = |_| "hkdf: output length".to_string();
    let mut nullifier_secret = [0u8; 31];
    hkdf.expand(INFO_NULLIFIER, &mut nullifier_secret)
        .map_err(expand)?;
    let mut okm = [0u8; 48];
    hkdf.expand(INFO_VIEWING, &mut okm).map_err(expand)?;
    #[allow(deprecated)] // `FromOkm` still takes generic-array 0.14, as in viewing.rs
    let scalar = Scalar::from_okm(GenericArray::from_slice(&okm));
    let nonzero = Option::<NonZeroScalar>::from(NonZeroScalar::new(scalar))
        .ok_or("the viewing scalar of this seed is zero")?;
    let viewing_sk = SecretKey::from(nonzero)
        .to_bytes()
        .as_slice()
        .try_into()
        .map_err(|_| "the viewing scalar is not 32 bytes")?;
    Ok((nullifier_secret, viewing_sk))
}

/// The full shielded address of an Ed25519 owner: the signing key (tag 1, the key, a zero byte),
/// `nullifier_pk` and `viewing_pk`, 99 bytes.
pub fn shielded_address(signer: &Key, nullifier_pk: &Key, viewing_pk: &[u8; 33]) -> Vec<u8> {
    let mut signing = [0u8; 34];
    for (slot, byte) in signing.iter_mut().skip(1).zip(signer) {
        *slot = *byte;
    }
    if let Some(tag) = signing.first_mut() {
        *tag = 1;
    }
    let address = Address {
        signing,
        nullifier_pk: *nullifier_pk,
        viewing_pk: *viewing_pk,
    };
    let mut out = Vec::new();
    address.write(&mut out);
    out
}

/// The roles of a seed under a group key.
pub fn derive(seed: &[u8; 32], group: &Key) -> Result<Roles, String> {
    let (nullifier_secret, viewing_sk) = secrets(seed)?;
    let nullifier_pk = nullifier_pk(&nullifier_secret)?;
    let viewing_pk = ViewingKey::from_bytes(&viewing_sk)?.public()?;
    Ok(Roles {
        nullifier_secret,
        viewing_sk,
        nullifier_pk,
        viewing_pk,
        owner_hash: owner_hash(group, &nullifier_pk)?,
        address: shielded_address(group, &nullifier_pk, &viewing_pk),
        seal_key: base64url(&blake2b_256(SNAPSHOT_PERSONAL, &[seed])),
    })
}

/// `derive` for the entry point: the seed and the group key as hex, the answer as JSON with every
/// value as hex (the seal key as base64url).
pub fn roles(sol_seed: &str, group_key: &str) -> Result<String, String> {
    let roles = derive(
        &unhex_array(sol_seed, "solSeed")?,
        &unhex_array(group_key, "group key")?,
    )?;
    Ok(json!({
        "nullifier_secret": hex(&roles.nullifier_secret),
        "viewing_sk": hex(&roles.viewing_sk),
        "nullifier_pk": hex(&roles.nullifier_pk),
        "viewing_pk": hex(&roles.viewing_pk),
        "owner_hash": hex(&roles.owner_hash),
        "address": hex(&roles.address),
        "seal_key": roles.seal_key,
    })
    .to_string())
}
