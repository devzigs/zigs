//! Distributed key generation (FROST DKG, Pedersen + proof of knowledge)
//! over RedPallas, as used for Orchard spend authorization (ZIP 312).
//!
//! No single party ever learns the spend authorizing key `ask`. Each
//! participant ends with a `KeyPackage` (its secret share) and everyone ends
//! with the same `PublicKeyPackage`, whose group verifying key becomes the
//! Orchard spend validating key `ak`.

use std::collections::BTreeMap;

use eyre::{ensure, eyre, Result};
use rand::rngs::OsRng;
use reddsa::frost::redpallas::{
    self as frost,
    keys::{dkg, KeyPackage, PublicKeyPackage},
    Identifier,
};
use serde::{Deserialize, Serialize};

use crate::store::{parse_id, Store};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GroupConfig {
    pub max_signers: u16,
    pub min_signers: u16,
    /// Human-readable names, index i => participant id i+1.
    pub names: Vec<String>,
}

pub fn ident(id: u16) -> Result<Identifier> {
    Identifier::try_from(id).map_err(|e| eyre!("invalid identifier {id}: {e:?}"))
}

pub fn ident_to_u16(id: &Identifier) -> Result<u16> {
    // Identifiers derived from u16 serialize as little-endian scalars.
    let bytes = id.serialize();
    ensure!(bytes[2..].iter().all(|b| *b == 0), "non-u16 identifier");
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

pub fn init(store: &Store, names: Vec<String>, threshold: u16) -> Result<GroupConfig> {
    let n = names.len() as u16;
    ensure!(n >= 2, "need at least 2 participants");
    ensure!(threshold >= 2 && threshold <= n, "threshold must be in 2..=n");
    let cfg = GroupConfig {
        max_signers: n,
        min_signers: threshold,
        names,
    };
    store.write_json("public/config.json", &cfg)?;
    Ok(cfg)
}

/// Round 1: each participant generates its secret polynomial, commits to it,
/// and broadcasts the commitment with a proof of knowledge.
pub fn round1(store: &Store, id: u16) -> Result<()> {
    let cfg: GroupConfig = store.read_json("public/config.json")?;
    ensure!(id >= 1 && id <= cfg.max_signers, "id out of range");
    let (secret, package) = dkg::part1(ident(id)?, cfg.max_signers, cfg.min_signers, OsRng)?;
    store.write_json(&format!("participants/{id}/dkg_round1_secret.json"), &secret)?;
    store.write_json(&format!("public/dkg/round1/{id}.json"), &package)?;
    Ok(())
}

fn round1_packages_except(
    store: &Store,
    cfg: &GroupConfig,
    me: u16,
) -> Result<BTreeMap<Identifier, dkg::round1::Package>> {
    let mut m = BTreeMap::new();
    for other in 1..=cfg.max_signers {
        if other == me {
            continue;
        }
        let p: dkg::round1::Package = store
            .read_json(&format!("public/dkg/round1/{other}.json"))
            .map_err(|_| eyre!("round 1 package from participant {other} missing"))?;
        m.insert(ident(other)?, p);
    }
    Ok(m)
}

/// Round 2: verify everyone's proofs of knowledge, then send each other
/// participant its secret share of our polynomial (point-to-point).
pub fn round2(store: &Store, id: u16) -> Result<()> {
    let cfg: GroupConfig = store.read_json("public/config.json")?;
    let secret: dkg::round1::SecretPackage =
        store.read_json(&format!("participants/{id}/dkg_round1_secret.json"))?;
    let r1 = round1_packages_except(store, &cfg, id)?;
    let (secret2, outgoing) = dkg::part2(secret, &r1)?;
    store.write_json(&format!("participants/{id}/dkg_round2_secret.json"), &secret2)?;
    for (to, pkg) in outgoing {
        let to = ident_to_u16(&to)?;
        // PROTOTYPE ONLY: this must be encrypted to `to` in a real system.
        store.write_json(&format!("public/dkg/round2/{id}-to-{to}.json"), &pkg)?;
    }
    // The round-1 secret is no longer needed; destroy it.
    store.remove(&format!("participants/{id}/dkg_round1_secret.json"))?;
    Ok(())
}

/// Round 3 (local): verify received shares against the commitments and
/// compute our long-lived signing share plus the group public key.
pub fn finish(store: &Store, id: u16) -> Result<PublicKeyPackage> {
    let cfg: GroupConfig = store.read_json("public/config.json")?;
    let secret2: dkg::round2::SecretPackage =
        store.read_json(&format!("participants/{id}/dkg_round2_secret.json"))?;
    let r1 = round1_packages_except(store, &cfg, id)?;
    let mut r2 = BTreeMap::new();
    for from in 1..=cfg.max_signers {
        if from == id {
            continue;
        }
        let p: dkg::round2::Package = store
            .read_json(&format!("public/dkg/round2/{from}-to-{id}.json"))
            .map_err(|_| eyre!("round 2 package {from}->{id} missing"))?;
        r2.insert(ident(from)?, p);
    }
    // `reddsa`'s part3 also normalizes the key to an even-y group key, which
    // Orchard requires for ak (its encoding has the sign bit cleared).
    let (key_package, pubkeys) = dkg::part3(&secret2, &r1, &r2)?;
    store.write_json(&format!("participants/{id}/key_package.json"), &key_package)?;
    store.write_json(&format!("participants/{id}/public_key_package.json"), &pubkeys)?;
    store.remove(&format!("participants/{id}/dkg_round2_secret.json"))?;
    Ok(pubkeys)
}

/// After everyone finished, check that all participants derived the same
/// group key and publish it.
pub fn publish_group_key(store: &Store) -> Result<PublicKeyPackage> {
    let cfg: GroupConfig = store.read_json("public/config.json")?;
    let mut first: Option<PublicKeyPackage> = None;
    for id in 1..=cfg.max_signers {
        let p: PublicKeyPackage =
            store.read_json(&format!("participants/{id}/public_key_package.json"))?;
        match &first {
            None => first = Some(p),
            Some(f) => ensure!(
                f == &p,
                "participant {id} computed a different public key package: DKG failed"
            ),
        }
    }
    let p = first.ok_or_else(|| eyre!("no participants"))?;
    store.write_json("public/public_key_package.json", &p)?;
    Ok(p)
}

pub fn load_key_package(store: &Store, id: u16) -> Result<KeyPackage> {
    store.read_json(&format!("participants/{id}/key_package.json"))
}

pub fn load_public_key_package(store: &Store) -> Result<PublicKeyPackage> {
    store.read_json("public/public_key_package.json")
}

pub fn group_vk_bytes(pubkeys: &PublicKeyPackage) -> Result<[u8; 32]> {
    let v = pubkeys.verifying_key().serialize()?;
    v.try_into().map_err(|_| eyre!("verifying key is not 32 bytes"))
}

#[allow(dead_code)]
pub fn ids_from_strs(v: &[String]) -> Result<Vec<u16>> {
    v.iter().map(|s| parse_id(s)).collect()
}

#[allow(unused_imports)]
pub use frost::Identifier as FrostIdentifier;
