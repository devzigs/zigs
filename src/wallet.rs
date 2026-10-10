//! Turning a FROST group key into a Zcash Orchard wallet (ZIP 312).
//!
//! An Orchard full viewing key is the triple (ak, nk, rivk):
//! - `ak`   — spend validating key. Here: the FROST group verifying key.
//! - `nk`   — nullifier deriving key.
//! - `rivk` — commitment randomness for the incoming viewing key.
//!
//! Only `ak` is tied to spending authority, so only `ak` is threshold-shared.
//! `nk` and `rivk` are ordinary secrets that every participant (and any
//! auditor you choose) needs to *see* the wallet. Following ZIP 312 and ZF's
//! `zcash-sign generate`, one party samples a random Orchard spending key,
//! takes its (nk, rivk), discards its `ask`, and substitutes the group `ak`.
//! The resulting FVK can view everything but can authorize nothing on its own.

use eyre::{ensure, eyre, Result};
use orchard::keys::{FullViewingKey, Scope, SpendValidatingKey, SpendingKey};
use rand::{rngs::OsRng, RngCore};
use reddsa::frost::redpallas::keys::PublicKeyPackage;
use serde::{Deserialize, Serialize};
use zcash_keys::{address::UnifiedAddress, keys::UnifiedFullViewingKey};
use zcash_protocol::consensus::Network;

use crate::{dkg, store::Store};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WalletInfo {
    pub network: String,
    /// Raw 96-byte Orchard FVK (ak || nk || rivk), hex.
    pub orchard_fvk: String,
    /// Unified full viewing key (Orchard-only), ZIP 316 encoding.
    pub ufvk: String,
    /// Unified address (Orchard receiver, diversifier index 0).
    pub address: String,
    /// The FROST group key, hex. Must equal the `ak` in `orchard_fvk`.
    pub group_verifying_key: String,
}

pub fn network_from_str(s: &str) -> Result<Network> {
    match s {
        "main" | "mainnet" => Ok(Network::MainNetwork),
        "test" | "testnet" => Ok(Network::TestNetwork),
        _ => Err(eyre!("network must be mainnet or testnet")),
    }
}

pub fn network_name(n: Network) -> &'static str {
    match n {
        Network::MainNetwork => "mainnet",
        Network::TestNetwork => "testnet",
    }
}

/// Build an Orchard FVK whose `ak` is the FROST group key.
pub fn fvk_from_group_key(pubkeys: &PublicKeyPackage) -> Result<FullViewingKey> {
    let ak_bytes = dkg::group_vk_bytes(pubkeys)?;
    // Orchard requires ỹ(ak) = 0. reddsa's DKG already normalized this.
    ensure!(ak_bytes[31] & 0x80 == 0, "group key does not have even y");
    let ak = SpendValidatingKey::from_bytes(&ak_bytes)
        .ok_or_else(|| eyre!("group key is not a valid Orchard ak"))?;

    let sk = loop {
        let mut b = [0u8; 32];
        OsRng.fill_bytes(&mut b);
        let sk = SpendingKey::from_bytes(b);
        if bool::from(sk.is_some()) {
            break sk.unwrap();
        }
    };
    let donor = FullViewingKey::from(&sk);
    let mut raw = donor.to_bytes();
    // Replace the donor's ak with the group ak. The donor's ask is dropped
    // when `sk` goes out of scope; nobody holds the matching spend key.
    raw[..32].copy_from_slice(&ak.to_bytes());
    let fvk = FullViewingKey::from_bytes(&raw)
        .ok_or_else(|| eyre!("assembled FVK is invalid"))?;
    ensure!(
        fvk.to_bytes()[..32] == ak_bytes,
        "FVK ak does not match group key"
    );
    Ok(fvk)
}

pub fn address_of(fvk: &FullViewingKey, network: Network) -> Result<String> {
    let addr = fvk.address_at(0u32, Scope::External);
    let ua = UnifiedAddress::from_receivers(Some(addr), None)
        .ok_or_else(|| eyre!("cannot build unified address"))?;
    Ok(ua.encode(&network))
}

pub fn create(store: &Store, network: Network) -> Result<WalletInfo> {
    let pubkeys = dkg::load_public_key_package(store)?;
    let fvk = fvk_from_group_key(&pubkeys)?;
    let ufvk = UnifiedFullViewingKey::from_orchard_fvk(fvk.clone())
        .map_err(|e| eyre!("ufvk: {e:?}"))?;
    let info = WalletInfo {
        network: network_name(network).into(),
        orchard_fvk: hex::encode(fvk.to_bytes()),
        ufvk: ufvk.encode(&network),
        address: address_of(&fvk, network)?,
        group_verifying_key: hex::encode(dkg::group_vk_bytes(&pubkeys)?),
    };
    store.write_json("public/wallet.json", &info)?;
    Ok(info)
}

pub fn load(store: &Store) -> Result<(WalletInfo, FullViewingKey)> {
    let info: WalletInfo = store.read_json("public/wallet.json")?;
    let raw: [u8; 96] = hex::decode(&info.orchard_fvk)?
        .try_into()
        .map_err(|_| eyre!("fvk must be 96 bytes"))?;
    let fvk = FullViewingKey::from_bytes(&raw).ok_or_else(|| eyre!("bad fvk"))?;
    Ok((info, fvk))
}

/// Every participant runs this before trusting the published wallet: the
/// `ak` inside the shared viewing key must be the group key that *they*
/// computed in the DKG. Otherwise the coordinator could have substituted a
/// key it controls alone, and funds sent to the address would be its own.
pub fn verify_as_participant(store: &Store, id: u16) -> Result<()> {
    let (info, fvk) = load(store)?;
    let mine: PublicKeyPackage =
        store.read_json(&format!("participants/{id}/public_key_package.json"))?;
    let mine_ak = dkg::group_vk_bytes(&mine)?;
    ensure!(
        fvk.to_bytes()[..32] == mine_ak,
        "wallet ak does not match the group key participant {id} computed"
    );
    let network = network_from_str(&info.network)?;
    ensure!(
        address_of(&fvk, network)? == info.address,
        "published address does not derive from the published FVK"
    );
    Ok(())
}
