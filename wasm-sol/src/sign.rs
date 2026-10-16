//! Split FROST signing (ZOLANA.md section 5, steps 4 to 6): the nonces and the share are separate
//! calls, because the devices sign hours apart. The page, not this code, stores the nonces and
//! deletes them before it publishes a share.
//!
//! - `digest`: BLAKE2b-256("Zigs_SolMsg___v1", cluster || message bytes). The page stores the
//!   nonces of a seat under this digest, as the sighash is stored for Zcash.
//! - `nonces`: fresh nonces and the commitment of one seat. The nonce bytes the page stores start
//!   with the digest they were made for.
//! - `sign_share`: signs the message bytes and nothing else. It runs `approve` on the exact bytes,
//!   which refuses the off-chain prefix and the `TSPP/derive/` payloads (a group key signs any
//!   text) and every message that breaks a rule of section 5. It requires that the key package is
//!   the pinned group key, and that the nonces were made for the digest of these bytes. It builds
//!   the signing package itself, so no caller can hand it another message.
//! - `aggregate`: combines the shares and checks the signature with `verify_strict`, which the
//!   cofactored frost verify does not do.

use std::collections::BTreeMap;

use ed25519_dalek::{Signature, VerifyingKey};
use frost_ed25519::keys::{KeyPackage, PublicKeyPackage};
use frost_ed25519::round1::{SigningCommitments, SigningNonces};
use frost_ed25519::round2::SignatureShare;
use frost_ed25519::{round1, round2, Identifier, SigningPackage};
use rand_core::OsRng;
use serde_json::{json, Value};

use crate::approve::{approve, Device};
use crate::bytes::hex;
use crate::codec::{blake2b_256, from_json, text_of, unhex, unhex_array};
use crate::frost::{check_cluster, id_map, key_bytes, seat_of};
use crate::pins::Pins;
use crate::plan::Proposal;
use crate::snapshot::Snapshot;
use crate::wasm::refused;

const DIGEST_PERSONAL: &[u8; 16] = b"Zigs_SolMsg___v1";

/// The inputs of `approve`, as the wasm entry takes them (the same bytes as `check_message`).
pub struct Check<'a> {
    pub intent: &'a [u8],
    pub pins: &'a [u8],
    pub snapshot: &'a [u8],
}

/// The digest of the exact bytes that are signed, as 32 bytes.
pub fn digest_of(cluster: &str, message: &[u8]) -> Result<[u8; 32], String> {
    check_cluster(cluster)?;
    Ok(blake2b_256(DIGEST_PERSONAL, &[cluster.as_bytes(), message]))
}

/// `digest_of` as hex.
pub fn digest(cluster: &str, message: &[u8]) -> Result<String, String> {
    Ok(hex(&digest_of(cluster, message)?))
}

/// The nonces and the commitment of a seat for one digest: `{"nonces": hex, "commitments": hex}`.
pub fn nonces(key_package: &str, digest_hex: &str) -> Result<String, String> {
    let digest: [u8; 32] = unhex_array(digest_hex, "digest")?;
    let key_package: KeyPackage = from_json(key_package, "key package")?;
    let (nonces, commitments) = round1::commit(key_package.signing_share(), &mut OsRng);
    let mut saved = digest.to_vec();
    saved.extend(nonces.serialize().map_err(|e| format!("nonces: {e}"))?);
    let commitments = commitments
        .serialize()
        .map_err(|e| format!("commitments: {e}"))?;
    Ok(json!({"nonces": hex(&saved), "commitments": hex(&commitments)}).to_string())
}

/// What `sign_share` reads from the page: the clock, the cluster, the key package of the seat,
/// the saved nonces and the commitments of the signers.
struct Round {
    now: u64,
    cluster: String,
    key_package: KeyPackage,
    digest: [u8; 32],
    nonces: SigningNonces,
    commitments: BTreeMap<Identifier, SigningCommitments>,
}

impl Round {
    /// `{"now", "cluster", "keyPackage", "nonces", "commitments": {"1": hex, ...}}`.
    fn parse(json: &str) -> Result<Self, String> {
        let round: Value = from_json(json, "signing round")?;
        let field = |key: &str| {
            round
                .get(key)
                .ok_or_else(|| format!("the round has no {key}"))
        };
        let saved = unhex(text_of(&round, "nonces", "the round")?, "nonces")?;
        let (digest, nonces) = saved
            .split_first_chunk::<32>()
            .ok_or("the saved nonces are too short")?;
        Ok(Self {
            now: field("now")?
                .as_u64()
                .ok_or("the round clock is not a number")?,
            cluster: text_of(&round, "cluster", "the round")?.to_string(),
            key_package: from_json(&field("keyPackage")?.to_string(), "key package")?,
            digest: *digest,
            nonces: SigningNonces::deserialize(nonces).map_err(|e| format!("nonces: {e}"))?,
            commitments: commitments_of(&field("commitments")?.to_string())?,
        })
    }
}

fn commitments_of(json: &str) -> Result<BTreeMap<Identifier, SigningCommitments>, String> {
    let mut map = BTreeMap::new();
    for (id, text) in id_map::<String>(json, "commitments")? {
        let bytes = unhex(&text, "commitment")?;
        let item =
            SigningCommitments::deserialize(&bytes).map_err(|e| format!("commitment: {e}"))?;
        map.insert(id, item);
    }
    Ok(map)
}

/// Runs `approve` on the bytes. Returns the pins, or the text of the refusal.
pub(crate) fn approved(message: &[u8], check: &Check, now: u64) -> Result<Pins, String> {
    let proposal = Proposal::decode(check.intent)?;
    let snapshot = Snapshot::decode(check.snapshot)?;
    let pins = Pins::decode(check.pins)?;
    let device = Device {
        pins: &pins,
        snapshot: &snapshot,
        now,
    };
    approve(message, &proposal.intent, &proposal.plan, &device).map_err(|r| refused(&r))?;
    Ok(pins)
}

/// The signature share of one seat for `message`: `{"seat", "digest", "share"}`. See the module
/// text for what it refuses.
pub fn sign_share(message: &[u8], check: &Check, round: &str) -> Result<String, String> {
    let round = Round::parse(round)?;
    let pins = approved(message, check, round.now)?;
    let digest = digest_of(&round.cluster, message)?;
    if round.digest != digest {
        return Err("the nonces were made for another message".to_string());
    }
    let group = key_bytes(round.key_package.verifying_key())?;
    if group != pins.group {
        return Err("the key package is not the pinned group key".to_string());
    }
    let package = SigningPackage::new(round.commitments, message);
    let share = round2::sign(&package, &round.nonces, &round.key_package)
        .map_err(|e| format!("round 2: {e}"))?;
    Ok(json!({
        "seat": seat_of(round.key_package.identifier())?,
        "digest": hex(&digest),
        "share": hex(&share.serialize()),
    })
    .to_string())
}

fn shares_of(json: &str) -> Result<BTreeMap<Identifier, SignatureShare>, String> {
    let mut map = BTreeMap::new();
    for (id, text) in id_map::<String>(json, "shares")? {
        let share = SignatureShare::deserialize(&unhex(&text, "share")?)
            .map_err(|e| format!("share: {e}"))?;
        map.insert(id, share);
    }
    Ok(map)
}

/// `verify_strict` of the signature under the key. It also refuses a small-order key or R, which a
/// plain `verify` of ed25519-dalek accepts, so a test can pin the difference on this function.
/// frost refuses those points when it reads them, so a group of this DKG never reaches it.
pub fn verify_strict(key: &[u8; 32], message: &[u8], signature: &[u8; 64]) -> Result<(), String> {
    let key = VerifyingKey::from_bytes(key).map_err(|e| format!("group key: {e}"))?;
    key.verify_strict(message, &Signature::from_bytes(signature))
        .map_err(|e| format!("verify_strict: {e}"))
}

/// Combines the shares into the 64-byte signature (hex) and checks it with `verify_strict`.
pub fn aggregate(
    message: &[u8],
    public_key_package: &str,
    commitments: &str,
    shares: &str,
) -> Result<String, String> {
    let public: PublicKeyPackage = from_json(public_key_package, "public key package")?;
    let package = SigningPackage::new(commitments_of(commitments)?, message);
    let signature = frost_ed25519::aggregate(&package, &shares_of(shares)?, &public)
        .map_err(|e| format!("aggregate: {e}"))?;
    let bytes: [u8; 64] = signature
        .serialize()
        .map_err(|e| format!("signature: {e}"))?
        .try_into()
        .map_err(|_| "the signature is not 64 bytes".to_string())?;
    verify_strict(&key_bytes(public.verifying_key())?, message, &bytes)?;
    Ok(hex(&bytes))
}
