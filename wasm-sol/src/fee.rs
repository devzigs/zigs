//! The fee key of a seat (ZOLANA.md 5): a fresh Ed25519 key that the device makes. It pays the
//! fees and the rents of the proposals of its seat, so the group key never pays. Its secret lives
//! in the Solana secret of the seat and never leaves the page: the Worker gets the address only.
//!
//! - `generate`: a fresh secret (32 bytes) and its public key, as hex.
//! - `public_of`: the public key of a secret.
//! - `sign`: runs `approve` on the exact bytes, as `sign::sign_share` does for the group key, and
//!   signs only if every rule holds and this key is the payer of the proposal. So the fee key
//!   never signs a message that moves its SOL in another way than the template, an off-chain
//!   message, or a payload that derives the shielded keys.
//! - `verify`: `verify_strict`, as for the signature of the group key (`sign::verify_strict`).

use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use rand_core::{OsRng, RngCore};
use serde_json::{json, Value};

use crate::bytes::hex;
use crate::codec::{from_json, text_of, unhex_array};
use crate::sign::{approved, verify_strict, Check};

fn signing_key(secret: &str) -> Result<SigningKey, String> {
    Ok(SigningKey::from_bytes(&unhex_array(secret, "fee secret")?))
}

fn public_bytes(key: &SigningKey) -> [u8; 32] {
    VerifyingKey::from(key).to_bytes()
}

/// A fresh fee key: `{"secret", "public"}`, both as hex.
pub fn generate() -> Result<String, String> {
    let mut seed = [0u8; 32];
    OsRng
        .try_fill_bytes(&mut seed)
        .map_err(|e| format!("no random bytes for the fee key: {e}"))?;
    let key = SigningKey::from_bytes(&seed);
    Ok(json!({ "secret": hex(&seed), "public": hex(&public_bytes(&key)) }).to_string())
}

/// The public key (hex) of a fee secret.
pub fn public_of(secret: &str) -> Result<String, String> {
    Ok(hex(&public_bytes(&signing_key(secret)?)))
}

/// The signature (hex) of `message` by the fee key of `round`, `{"now", "secret"}`. `check` holds
/// the proposal, the pins and the snapshot that `check_message` takes. It throws the refusal of
/// `approve`, and refuses a key that is not the payer that the pins name.
pub fn sign(message: &[u8], check: &Check, round: &str) -> Result<String, String> {
    let round: Value = from_json(round, "fee round")?;
    let now = round.get("now").and_then(Value::as_u64);
    let key = signing_key(text_of(&round, "secret", "the fee round")?)?;
    let pins = approved(message, check, now.ok_or("the fee round has no clock")?)?;
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
