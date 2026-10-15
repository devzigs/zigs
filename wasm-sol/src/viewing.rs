//! The P-256 viewing key, the transaction viewing key and the slot cipher of a confidential
//! output (ZOLANA.md section 5, rule Ciphertexts).
//!
//! References, all under the repo root: docs/spec.md "Derived secrets" 373-381, "Transaction
//! Viewing Key" 383-398, "AES Key derivation" 707-725; sdk-libs/keypair/src/derivation.rs
//! 248-258 (`view_root`), viewing_key.rs 185-196 (`get_transaction_viewing_key`) and
//! encryption.rs 21-33 and 75-100 (the key schedule and `Ctr32BE`);
//! sdk-libs/transaction/src/serialization/confidential.rs 137-145 and mod.rs 111-131 (the blob).
//!
//! The slot cipher is AES-256-CTR with no tag. The spec names no AEAD: integrity comes from the
//! proof-bound `utxo_hash`, which `rules_out` recomputes.

use aes::Aes256;
use ctr::cipher::{KeyIvInit, StreamCipher};
use ctr::Ctr32BE;
use hkdf::Hkdf;
use p256::ecdh::diffie_hellman;
use p256::elliptic_curve::generic_array::GenericArray;
use p256::elliptic_curve::hash2curve::FromOkm;
use p256::elliptic_curve::sec1::ToEncodedPoint;
use p256::{NonZeroScalar, PublicKey, Scalar, SecretKey};
use sha2::Sha256;
use zolana_hasher::p256::P_CONST_SEC1;

use crate::consts::Key;

const INFO_TX_VIEWING: &[u8] = b"TSPP/tx_viewing";
const HPKE_PREFIX: &[u8] = b"TSPP/hpke/";
const ENC_INFO_TRANSFER: &[u8] = b"TSPP/tx";

/// The first byte of the borsh `OutputDataEncoding::Encrypted` (`proofless.rs:97-99`).
const ENCRYPTED_TAG: u8 = 1;
/// The scheme byte of a confidential slot (`EncryptedScheme::Confidential`).
const CONFIDENTIAL_SCHEME: u8 = 3;

/// A confidential slot: the 50 bytes of `ConfidentialOutputPlaintext` with no data record.
pub const PLAINTEXT_LEN: usize = 8 + 8 + 32 + 1 + 1;
/// The bytes of one output `data` field: tag, `u32` length, scheme, recipient key, ciphertext.
pub const BLOB_LEN: usize = 1 + 4 + 1 + 33 + PLAINTEXT_LEN;

/// A P-256 secret key. It has no `Debug` and no `Clone`: nothing prints it.
pub struct ViewingKey {
    secret: SecretKey,
}

fn hkdf_fill(
    salt: Option<&[u8]>,
    ikm: &[u8],
    info: &[&[u8]],
    out: &mut [u8],
) -> Result<(), String> {
    Hkdf::<Sha256>::new(salt, ikm)
        .expand_multi_info(info, out)
        .map_err(|_| "hkdf: output length".to_string())
}

fn point_of(bytes: &[u8; 33]) -> Result<PublicKey, String> {
    PublicKey::from_sec1_bytes(bytes).map_err(|_| "a P-256 key is not a curve point".to_string())
}

impl ViewingKey {
    /// A secret scalar of 32 big-endian bytes, 1 <= k < n.
    pub fn from_bytes(bytes: &[u8; 32]) -> Result<Self, String> {
        let secret = SecretKey::from_slice(bytes).map_err(|_| "viewing key is not a scalar")?;
        Ok(Self { secret })
    }

    /// The SEC1 compressed public key (33 bytes).
    pub fn public(&self) -> Result<[u8; 33], String> {
        let point = self.secret.public_key().to_encoded_point(true);
        point
            .as_bytes()
            .try_into()
            .map_err(|_| "public key is not 33 bytes".to_string())
    }

    /// The x coordinate of `ECDH(self, peer)`.
    fn ecdh_x(&self, peer: &PublicKey) -> Key {
        let shared = diffie_hellman(self.secret.to_nonzero_scalar(), peer.as_affine());
        let mut x = [0; 32];
        x.copy_from_slice(shared.raw_secret_bytes());
        x
    }

    /// `tx_viewing_secret := HKDF-Expand(view_root, "TSPP/tx_viewing", 32)`, where `view_root :=
    /// HKDF-Extract(salt = none, IKM = ECDH(viewing_sk, P_const))`.
    pub fn tx_viewing_secret(&self) -> Result<Key, String> {
        let p_const = point_of(&P_CONST_SEC1)?;
        let (_, view_root) = Hkdf::<Sha256>::extract(None, &self.ecdh_x(&p_const));
        let mut out = [0; 32];
        view_root
            .expand(INFO_TX_VIEWING, &mut out)
            .map_err(|_| "hkdf: tx viewing secret".to_string())?;
        Ok(out)
    }

    /// The transaction viewing key: `HKDF-SHA256(salt = first_nullifier, IKM =
    /// tx_viewing_secret, info = "TSPP/tx_viewing", 48 bytes)` reduced modulo the curve order.
    pub fn tx_key(&self, first_nullifier: &Key) -> Result<Self, String> {
        let mut okm = [0; 48];
        let secret = self.tx_viewing_secret()?;
        hkdf_fill(Some(first_nullifier), &secret, &[INFO_TX_VIEWING], &mut okm)?;
        #[allow(deprecated)] // `FromOkm` still takes generic-array 0.14, as the repo does
        let scalar = Scalar::from_okm(GenericArray::from_slice(&okm));
        let nonzero = Option::<NonZeroScalar>::from(NonZeroScalar::new(scalar))
            .ok_or("the transaction viewing scalar is zero")?;
        Ok(Self {
            secret: SecretKey::from(nonzero),
        })
    }

    /// The key and the CTR nonce of one slot: `okm = HKDF-SHA256(salt = none, IKM =
    /// ECDH_x || tx_viewing_pk || recipient_viewing_pk, info = "TSPP/hpke/" || "TSPP/tx" ||
    /// salt || u32_be(slot), 44 bytes)`.
    fn slot_key(
        &self,
        recipient: &[u8; 33],
        salt: &[u8; 16],
        slot: u32,
    ) -> Result<([u8; 32], [u8; 12]), String> {
        let mut ikm = Vec::with_capacity(32 + 33 + 33);
        ikm.extend_from_slice(&self.ecdh_x(&point_of(recipient)?));
        ikm.extend_from_slice(&self.public()?);
        ikm.extend_from_slice(recipient);
        let mut okm = [0; 44];
        let info: [&[u8]; 4] = [HPKE_PREFIX, ENC_INFO_TRANSFER, salt, &slot.to_be_bytes()];
        hkdf_fill(None, &ikm, &info, &mut okm)?;
        let (key, nonce) = okm.split_at(32);
        Ok((
            key.try_into().map_err(|_| "slot key length")?,
            nonce.try_into().map_err(|_| "slot nonce length")?,
        ))
    }

    /// AES-256-CTR of `plaintext` for the slot at output position `slot`, with the key and nonce
    /// of `slot_key`. Encryption and decryption are the same operation.
    pub fn slot_cipher(
        &self,
        recipient: &[u8; 33],
        plaintext: &[u8],
        salt: &[u8; 16],
        slot: u32,
    ) -> Result<Vec<u8>, String> {
        let (key, nonce) = self.slot_key(recipient, salt, slot)?;
        // J0 = nonce || 00000001, and the counter moves once before the first block.
        let mut iv = [0; 16];
        let (head, tail) = iv.split_at_mut(12);
        head.copy_from_slice(&nonce);
        tail.copy_from_slice(&[0, 0, 0, 2]);
        let mut body = plaintext.to_vec();
        Ctr32BE::<Aes256>::new(&key.into(), &iv.into()).apply_keystream(&mut body);
        Ok(body)
    }

    /// The `data` field of one output encrypted to `recipient` at output position `slot`: the
    /// borsh `OutputDataEncoding::Encrypted(blob)` with `blob = scheme || recipient || body`.
    pub fn slot_data(
        &self,
        recipient: &[u8; 33],
        plaintext: &[u8],
        salt: &[u8; 16],
        slot: u32,
    ) -> Result<Vec<u8>, String> {
        let body = self.slot_cipher(recipient, plaintext, salt, slot)?;
        let mut blob = vec![CONFIDENTIAL_SCHEME];
        blob.extend_from_slice(recipient);
        blob.extend_from_slice(&body);
        let len = u32::try_from(blob.len()).map_err(|_| "the blob is too long")?;
        let mut data = vec![ENCRYPTED_TAG];
        data.extend_from_slice(&len.to_le_bytes());
        data.extend_from_slice(&blob);
        Ok(data)
    }
}

/// `ConfidentialOutputPlaintext` with no ring program and an empty `data` field:
/// `asset_id u64 || amount u64 || blinding || 0 || 0` (all little endian).
pub fn plaintext(asset_id: u64, amount: u64, blinding: &Key) -> Vec<u8> {
    let mut out = Vec::with_capacity(PLAINTEXT_LEN);
    out.extend_from_slice(&asset_id.to_le_bytes());
    out.extend_from_slice(&amount.to_le_bytes());
    out.extend_from_slice(blinding);
    out.extend_from_slice(&[0, 0]);
    out
}
