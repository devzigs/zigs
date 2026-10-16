//! The fee key of a seat (ZOLANA.md 5): an Ed25519 key that the seat derives from its own key
//! share. It pays the fees and the rents of the proposals of its seat, so the group key never
//! pays. Every copy of the seat (a second tab, a second browser, any restored backup) derives the
//! same key, and no other seat can: the other seats hold other shares. The Worker gets the
//! address only.
//!
//! - `derive`: HKDF-SHA256 with an empty salt. The input key material is the 32-byte signing
//!   share of the key package, and the info is `zigs-sol/fee-key/v1 || group key || seat` (the
//!   seat as 2 bytes, little endian). The group key and the seat come from the key package. The
//!   32-byte output is the Ed25519 seed. A key package whose share does not fit its public share
//!   gives no key.
//! - `sign`: runs `approve` on the exact bytes, as `sign::sign_share` does for the group key, and
//!   signs only if every rule holds and this key is the payer of the proposal. So the fee key
//!   never signs a message that moves its SOL in another way than the template, an off-chain
//!   message, or a payload that derives the shielded keys.
//! - `verify`: `verify_strict`, as for the signature of the group key (`sign::verify_strict`).

use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use frost_ed25519::keys::KeyPackage;
use hkdf::Hkdf;
use serde_json::{json, Value};
use sha2::Sha256;

use crate::beta;
use crate::bytes::hex;
use crate::codec::{from_json, text_of, unhex_array};
use crate::consts::Key;
use crate::frost::{key_bytes, seat_of, share_fits};
use crate::sign::{approved, verify_strict, Check};

const INFO_FEE: &[u8] = b"zigs-sol/fee-key/v1";

fn signing_key(secret: &str) -> Result<SigningKey, String> {
    Ok(SigningKey::from_bytes(&unhex_array(secret, "fee secret")?))
}

fn public_bytes(key: &SigningKey) -> [u8; 32] {
    VerifyingKey::from(key).to_bytes()
}

/// The seed of the fee key of seat `seat`: HKDF-SHA256 of its signing share under the group key.
pub fn seed_of(share: &[u8; 32], group: &Key, seat: u16) -> Result<[u8; 32], String> {
    let mut info = INFO_FEE.to_vec();
    info.extend_from_slice(group);
    info.extend_from_slice(&seat.to_le_bytes());
    let mut seed = [0u8; 32];
    Hkdf::<Sha256>::new(None, share)
        .expand(&info, &mut seed)
        .map_err(|_| "hkdf: output length".to_string())?;
    Ok(seed)
}

/// The fee key of the seat that holds `key_package` (JSON): `{"secret", "public"}`, both as hex.
pub fn derive(key_package: &str) -> Result<String, String> {
    let package: KeyPackage = from_json(key_package, "key package")?;
    if !share_fits(key_package) {
        return Err("the key share does not fit its public share: no fee key".to_string());
    }
    let share: [u8; 32] = package
        .signing_share()
        .serialize()
        .try_into()
        .map_err(|_| "the signing share is not 32 bytes".to_string())?;
    let seed = seed_of(
        &share,
        &key_bytes(package.verifying_key())?,
        seat_of(package.identifier())?,
    )?;
    let key = SigningKey::from_bytes(&seed);
    Ok(json!({ "secret": hex(&seed), "public": hex(&public_bytes(&key)) }).to_string())
}

/// The signature (hex) of `message` by the fee key of `round`, `{"now", "secret"}`. `check` holds
/// the proposal, the pins and the snapshot that `check_message` takes. It throws the refusal of
/// `approve`, and refuses a key that is not the payer that the pins name.
pub fn sign(message: &[u8], check: &Check, round: &str) -> Result<String, String> {
    let round: Value = from_json(round, "fee round")?;
    let now = round.get("now").and_then(Value::as_u64);
    let key = signing_key(text_of(&round, "secret", "the fee round")?)?;
    let now = now.ok_or("the fee round has no clock")?;
    let pins = approved(message, check, now, beta::Signer::Fee)?;
    if pins.payer != public_bytes(&key) {
        return Err("this fee key is not the payer of the proposal".to_string());
    }
    Ok(hex(&key.sign(message).to_bytes()))
}

/// Ok when `signature` (hex) is the `verify_strict` signature of `message` under `public` (hex).
pub fn verify(public: &str, message: &[u8], signature: &str) -> Result<(), String> {
    let signature: [u8; 64] = unhex_array(signature, "fee signature")?;
    let public: [u8; 32] = unhex_array(public, "fee key")?;
    verify_strict(&public, message, &signature)
}
