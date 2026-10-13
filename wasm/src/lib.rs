//! Browser build of the zec-frost prototype.
//!
//! Every function takes and returns JSON strings, so the JavaScript side
//! only moves opaque blobs between participants. All cryptography runs here:
//! FROST DKG and re-randomized signing over RedPallas (reddsa), Orchard /
//! Ironwood key assembly (ZIP 312), PCZT construction, verification, Halo2
//! proving, transaction extraction, and the X25519 + ChaCha20-Poly1305 box
//! that protects DKG round-2 messages in transit.

use std::collections::BTreeMap;

use base64::{
    engine::general_purpose::{STANDARD as B64, URL_SAFE_NO_PAD as B64URL},
    Engine,
};
use chacha20poly1305::{
    aead::{Aead, Payload},
    ChaCha20Poly1305, KeyInit, Nonce, XChaCha20Poly1305, XNonce,
};
use group::ff::PrimeField;
use orchard::{
    keys::{FullViewingKey, Scope, SpendValidatingKey, SpendingKey},
    primitives::redpallas::{self, SpendAuth},
};
use pczt::{
    roles::{
        creator::Creator,
        io_finalizer::IoFinalizer,
        low_level_signer::{OrchardParseError, Signer as LowLevelSigner},
        prover::Prover,
        spend_finalizer::SpendFinalizer,
        tx_extractor::TransactionExtractor,
        verifier::{OrchardError, Verifier},
    },
    Pczt,
};
use getrandom04::SysRng;
use rand::{rngs::OsRng, RngCore};
use rand_core10::{CryptoRng, UnwrapErr};
use reddsa::frost::redpallas::{
    self as frost,
    keys::{dkg, KeyPackage, PublicKeyPackage},
    round1::{SigningCommitments, SigningNonces},
    round2::SignatureShare,
    Identifier, RandomizedParams, Randomizer, SigningPackage,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

mod backup;
mod ceremony;
mod chain;
mod snapshot;
#[cfg(not(target_arch = "wasm32"))]
mod ffi;
use zcash_keys::{address::UnifiedAddress, keys::UnifiedFullViewingKey};
use zcash_primitives::transaction::{
    builder::{BuildConfig, Builder, BundlePadding, PcztResult},
    fees::zip317,
    sighash::SignableInput,
    sighash_v5::v5_signature_hash,
    sighash_v6::v6_signature_hash,
    txid::TxIdDigester,
    TxVersion,
};
use zcash_protocol::{
    consensus::{BlockHeight, Network, Parameters},
    memo::MemoBytes,
    value::Zatoshis,
};

type R<T> = Result<T, String>;

fn rng() -> impl CryptoRng {
    UnwrapErr(SysRng)
}

macro_rules! err {
    ($($t:tt)*) => { format!($($t)*) };
}

fn e<E: std::fmt::Debug>(ctx: &'static str) -> impl Fn(E) -> String {
    move |x| format!("{ctx}: {x:?}")
}

fn ensure(cond: bool, msg: &str) -> R<()> {
    if cond {
        Ok(())
    } else {
        Err(msg.to_string())
    }
}

fn from_json<T: DeserializeOwned>(s: &str, what: &str) -> R<T> {
    serde_json::from_str(s).map_err(|x| err!("bad {what}: {x}"))
}

fn from_value<T: DeserializeOwned>(v: &Value, what: &str) -> R<T> {
    serde_json::from_value(v.clone()).map_err(|x| err!("bad {what}: {x}"))
}

fn to_value<T: Serialize>(t: &T) -> Value {
    serde_json::to_value(t).expect("serializable")
}

fn ident(id: u16) -> R<Identifier> {
    Identifier::try_from(id).map_err(e("identifier"))
}

fn ident_u16(id: &Identifier) -> R<u16> {
    let b = id.serialize();
    ensure(b[2..].iter().all(|x| *x == 0), "non-u16 identifier")?;
    Ok(u16::from_le_bytes([b[0], b[1]]))
}

/// `{"1": X, "2": Y}` → BTreeMap<Identifier, T>
fn id_map<T: DeserializeOwned>(v: &Value, what: &str) -> R<BTreeMap<Identifier, T>> {
    let obj = v.as_object().ok_or_else(|| err!("{what} must be an object"))?;
    let mut m = BTreeMap::new();
    for (k, x) in obj {
        let id: u16 = k.parse().map_err(|_| err!("bad id {k}"))?;
        m.insert(ident(id)?, from_value(x, what)?);
    }
    Ok(m)
}

// ───────────────────────────── DKG ─────────────────────────────

pub fn dkg_part1(id: u16, n: u16, t: u16) -> R<String> {
    let (secret, package) = dkg::part1(ident(id)?, n, t, OsRng).map_err(e("dkg part1"))?;
    Ok(json!({"secret": secret, "package": package}).to_string())
}

/// `round1`: JSON object id → round-1 package of every *other* participant.
pub fn dkg_part2(secret: &str, round1: &str) -> R<String> {
    let secret: dkg::round1::SecretPackage = from_json(secret, "round-1 secret")?;
    let r1: BTreeMap<Identifier, dkg::round1::Package> =
        id_map(&from_json(round1, "round-1 packages")?, "round-1 package")?;
    let (secret2, out) = dkg::part2(secret, &r1).map_err(e("dkg part2"))?;
    let mut outgoing = serde_json::Map::new();
    for (to, pkg) in out {
        outgoing.insert(ident_u16(&to)?.to_string(), to_value(&pkg));
    }
    Ok(json!({"secret": secret2, "outgoing": outgoing}).to_string())
}

pub fn dkg_part3(secret2: &str, round1: &str, round2: &str) -> R<String> {
    let secret2: dkg::round2::SecretPackage = from_json(secret2, "round-2 secret")?;
    let r1: BTreeMap<Identifier, dkg::round1::Package> =
        id_map(&from_json(round1, "round-1 packages")?, "round-1 package")?;
    let r2: BTreeMap<Identifier, dkg::round2::Package> =
        id_map(&from_json(round2, "round-2 packages")?, "round-2 package")?;
    // reddsa's part3 normalizes to an even-y group key, as Orchard requires.
    let (kp, pkp) = dkg::part3(&secret2, &r1, &r2).map_err(e("dkg part3"))?;
    Ok(json!({
        "key_package": kp,
        "public_key_package": pkp,
        "group_key": hex::encode(group_vk_bytes(&pkp)?),
    })
    .to_string())
}

fn group_vk_bytes(p: &PublicKeyPackage) -> R<[u8; 32]> {
    p.verifying_key()
        .serialize()
        .map_err(e("vk"))?
        .try_into()
        .map_err(|_| "vk not 32 bytes".into())
}

// ─────────────────────────── Wallet ───────────────────────────

fn network(s: &str) -> R<Network> {
    match s {
        "mainnet" => Ok(Network::MainNetwork),
        "testnet" => Ok(Network::TestNetwork),
        _ => Err("network must be mainnet or testnet".into()),
    }
}

fn random_sk() -> SpendingKey {
    loop {
        let mut b = [0u8; 32];
        OsRng.fill_bytes(&mut b);
        let sk = SpendingKey::from_bytes(b);
        if bool::from(sk.is_some()) {
            return sk.unwrap();
        }
    }
}

fn receiver_address(a: orchard::Address, net: Network) -> R<String> {
    Ok(UnifiedAddress::from_receivers(Some(a), None, None, None, None)
        .ok_or("cannot build unified address")?
        .encode(&net))
}

fn address_of(fvk: &FullViewingKey, net: Network) -> R<String> {
    receiver_address(fvk.address_at(0u32, Scope::External), net)
}

fn pczt_network(p: &Pczt) -> R<Network> {
    match *p.global().coin_type() {
        133 => Ok(Network::MainNetwork),
        1 => Ok(Network::TestNetwork),
        other => Err(err!("unknown coin type {other}")),
    }
}

/// The address a payment really goes to: the Orchard receiver of `addr`, re-encoded alone, so
/// two unified addresses that share that receiver compare equal.
/// The canonical form of a mainnet or testnet unified address; the prefix (u1… or utest1…)
/// tells the caller which network it belongs to.
pub fn normalize_address(addr: &str) -> R<String> {
    [Network::MainNetwork, Network::TestNetwork]
        .into_iter()
        .find_map(|net| chain::parse_recipient(addr, net).ok().map(|a| receiver_address(a, net)))
        .ok_or_else(|| "not a unified address with an Orchard receiver".to_string())?
}

fn parse_fvk(hex_fvk: &str) -> R<FullViewingKey> {
    let raw: [u8; 96] = hex::decode(hex_fvk)
        .map_err(e("fvk hex"))?
        .try_into()
        .map_err(|_| "fvk must be 96 bytes")?;
    FullViewingKey::from_bytes(&raw).ok_or_else(|| "invalid fvk".into())
}

/// The wallet document that every signer stores: public keys and the address, no secret.
fn wallet_doc(fvk: &FullViewingKey, net: Network) -> R<Value> {
    let ufvk = UnifiedFullViewingKey::from_orchard_fvk(fvk.clone()).map_err(e("ufvk"))?;
    Ok(json!({
        "network": if net == Network::MainNetwork { "mainnet" } else { "testnet" },
        "orchard_fvk": hex::encode(fvk.to_bytes()),
        "ufvk": ufvk.encode(&net).map_err(e("ufvk encode"))?,
        "address": address_of(fvk, net)?,
        "group_verifying_key": hex::encode(&fvk.to_bytes()[..32]),
    }))
}

/// Version 1 wallets, ZIP 312: ak = FROST group key; nk and rivk from a random donor key whose
/// ask is discarded. Version 2 wallets use `ceremony::wallet_create_v2`.
pub fn wallet_create(public_key_package: &str, net: &str) -> R<String> {
    let pkp: PublicKeyPackage = from_json(public_key_package, "public key package")?;
    let net = network(net)?;
    let ak_bytes = group_vk_bytes(&pkp)?;
    ensure(ak_bytes[31] & 0x80 == 0, "group key does not have even y")?;
    let ak = SpendValidatingKey::from_bytes(&ak_bytes).ok_or("group key is not a valid ak")?;
    let mut raw = FullViewingKey::from(&random_sk()).to_bytes();
    raw[..32].copy_from_slice(&ak.to_bytes());
    let fvk = FullViewingKey::from_bytes(&raw).ok_or("assembled FVK invalid")?;
    Ok(wallet_doc(&fvk, net)?.to_string())
}

/// A participant checks the published wallet against *their own* DKG result.
pub fn wallet_verify(wallet: &str, my_public_key_package: &str) -> R<String> {
    let w: Value = from_json(wallet, "wallet")?;
    let pkp: PublicKeyPackage = from_json(my_public_key_package, "public key package")?;
    let fvk = parse_fvk(w["orchard_fvk"].as_str().ok_or("wallet.orchard_fvk")?)?;
    let mine = group_vk_bytes(&pkp)?;
    ensure(
        fvk.to_bytes()[..32] == mine,
        "the wallet's ak is NOT the group key you computed — do not use this address",
    )?;
    let net = network(w["network"].as_str().unwrap_or("testnet"))?;
    ensure(
        Some(address_of(&fvk, net)?.as_str()) == w["address"].as_str(),
        "the published address does not derive from the published viewing key",
    )?;
    Ok(json!({"ok": true}).to_string())
}

// ───────────────────────── Transactions ─────────────────────────

fn pczt_from_b64(s: &str) -> R<Pczt> {
    let bytes = B64.decode(s).map_err(e("pczt base64"))?;
    Pczt::parse(&bytes).map_err(e("pczt parse"))
}

fn pczt_to_b64(p: Pczt) -> R<String> {
    Ok(B64.encode(p.serialize().map_err(e("pczt serialize"))?))
}

/// Build an unsigned, *unproven* PCZT that spends Ironwood notes and pays
/// each `(payee, amount)` plus `change`. Proving happens after signing, in `finalize`,
/// because the spend authorization signatures do not commit to the proof.
fn build_ironwood_pczt<P: Parameters>(
    params: P,
    target: BlockHeight,
    fvk: &FullViewingKey,
    spends: (Vec<(orchard::Note, orchard::tree::MerklePath)>, orchard::Anchor),
    outs: (&[(orchard::Address, u64)], u64),
) -> R<Pczt> {
    let (notes, anchor) = spends;
    let (payees, change) = outs;
    let mut builder = Builder::new(
        params,
        target,
        BuildConfig::Standard {
            sapling_anchor: None,
            orchard_anchor: None,
            ironwood_anchor: Some(anchor),
            orchard_padding: BundlePadding::DEFAULT,
            ironwood_padding: BundlePadding::DEFAULT,
        },
    );
    for (note, path) in notes {
        builder.add_ironwood_spend::<zip317::FeeRule>(fvk.clone(), note, path).map_err(e("builder"))?;
    }
    let eo = Some(fvk.to_ovk(Scope::External));
    for &(payee, amount) in payees {
        let az = Zatoshis::from_u64(amount).map_err(e("amount"))?;
        builder
            .add_ironwood_output::<zip317::FeeRule>(eo.clone(), payee, az, MemoBytes::empty())
            .map_err(e("builder"))?;
    }
    let cz = Zatoshis::from_u64(change).map_err(e("change"))?;
    let io = Some(fvk.to_ovk(Scope::Internal));
    let ca = fvk.address_at(0u32, Scope::Internal);
    builder
        .add_ironwood_output::<zip317::FeeRule>(io, ca, cz, MemoBytes::empty())
        .map_err(e("builder"))?;
    let PcztResult { pczt_parts, .. } = builder
        .build_for_pczt(rng(), &zip317::FeeRule::standard())
        .map_err(e("build_for_pczt"))?;
    let pczt = Creator::build_from_parts(pczt_parts).ok_or("creator failed")?;
    IoFinalizer::new(pczt).finalize_io(rng()).map_err(e("io finalizer"))
}

// ─────────────────────────── Signing ───────────────────────────

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
enum Pool {
    Orchard,
    Ironwood,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
struct PendingSpend {
    pool: Pool,
    action_index: usize,
    alpha: String,
    rk: String,
}

fn sighash(p: &Pczt) -> R<(TxVersion, [u8; 32])> {
    let tx = p.clone().into_effects().map_err(e("effects"))?;
    let parts = tx.digest(TxIdDigester);
    let v = tx.version();
    let h = match v {
        TxVersion::V6 => v6_signature_hash(&tx, &SignableInput::Shielded, &parts),
        TxVersion::V5 => v5_signature_hash(&tx, &SignableInput::Shielded, &parts),
        _ => return Err("unsupported transaction version".into()),
    };
    Ok((v, h.as_ref().try_into().map_err(|_| "sighash length")?))
}

#[derive(Debug)]
struct Custom(#[allow(dead_code)] String);

/// Full participant-side verification. Returns pending spends and a
/// human-readable list of what the transaction does.
type Inspected = (Vec<PendingSpend>, Vec<Value>, [u8; 32], TxVersion);

fn inspect_inner(p: &Pczt, fvk: &FullViewingKey) -> R<Inspected> {
    let (version, h) = sighash(p)?;
    let pools: &[Pool] = if version == TxVersion::V6 {
        &[Pool::Orchard, Pool::Ironwood]
    } else {
        &[Pool::Orchard]
    };
    let net = pczt_network(p)?;
    let change = fvk.address_at(0u32, Scope::Internal);
    let ext = fvk.address_at(0u32, Scope::External);
    let mut pending = vec![];
    let mut lines = vec![];
    // Value that leaves the shielded pools, and the number of actions that the fee pays for.
    let (mut outflow, mut actions) = (0i128, 0usize);
    for &pool in pools {
        let mut found = vec![];
        let mut ls = vec![];
        let check = |b: &orchard::pczt::Bundle| -> Result<(), OrchardError<Custom>> {
            for (i, a) in b.actions().iter().enumerate() {
                a.verify_cv_net()?;
                let s = a.spend();
                let redacted = || OrchardError::Custom(Custom(format!("action {i}: no value")));
                let (sv, ov) = s.value().zip(*a.output().value()).ok_or_else(redacted)?;
                let (sv, ov) = (sv.inner(), ov.inner());
                outflow += i128::from(sv) - i128::from(ov);
                actions += 1;
                if s.spend_auth_sig().is_none() {
                    let alpha = s
                        .alpha()
                        .ok_or_else(|| OrchardError::Custom(Custom(format!("action {i}: no alpha"))))?;
                    s.verify_rk(Some(fvk))?;
                    s.verify_nullifier(Some(fvk))?;
                    ls.push(json!({"kind": "spend", "action": i, "pool": format!("{pool:?}"),
                        "value": s.value().map(|v| v.inner()), "who": "this wallet"}));
                    found.push(PendingSpend {
                        pool,
                        action_index: i,
                        alpha: hex::encode(alpha.to_repr()),
                        rk: hex::encode(<[u8; 32]>::from(s.rk())),
                    });
                }
                let o = a.output();
                let v = o.value().map(|v| v.inner());
                // Bind every output that carries value to the recipient shown, also next to a dummy
                // spend that the builder already signed. A redacted recipient or value fails here.
                if v != Some(0) {
                    o.verify_note_commitment(s)?;
                }
                let who = match o.recipient() {
                    Some(x) if *x == change => "change (back to this wallet)".to_string(),
                    Some(x) if *x == ext => "this wallet".to_string(),
                    Some(x) => receiver_address(*x, net).map_err(|m| OrchardError::Custom(Custom(m)))?,
                    None => "unknown (redacted)".into(),
                };
                if v != Some(0) {
                    ls.push(json!({"kind": "output", "action": i, "pool": format!("{pool:?}"), "value": v, "who": who}));
                }
            }
            Ok(())
        };
        let ver = Verifier::new(p.clone());
        match pool {
            Pool::Orchard => ver.with_orchard(check),
            Pool::Ironwood => ver.with_ironwood(check),
        }
        .map_err(|x| err!("transaction verification failed ({pool:?}): {x:?}"))?;
        pending.extend(found);
        lines.extend(ls);
    }
    ensure(!pending.is_empty(), "this transaction spends nothing from this wallet")?;
    // Anything beyond the standard fee leaves through a part this check cannot show, such as a
    // transparent output, so refuse it.
    let fee = chain::zip317_fee(actions, 0);
    ensure(outflow == i128::from(fee), &format!(
        "the transaction moves {outflow} zat out of the shielded pool, but the network fee for \
         {actions} actions is {fee} zat"))?;
    Ok((pending, lines, h, version))
}

pub fn inspect(pczt: &str, fvk: &str) -> R<String> {
    let (spends, lines, h, v) = inspect_inner(&pczt_from_b64(pczt)?, &parse_fvk(fvk)?)?;
    Ok(json!({
        "sighash": hex::encode(h),
        "tx_version": format!("{v:?}"),
        "spends": spends,
        "lines": lines,
    })
    .to_string())
}

/// Round 1: one nonce pair per pending spend. Nonces are secret, single-use.
pub fn sign_commit(pczt: &str, fvk: &str, key_package: &str) -> R<String> {
    let (spends, _, _, _) = inspect_inner(&pczt_from_b64(pczt)?, &parse_fvk(fvk)?)?;
    let kp: KeyPackage = from_json(key_package, "key package")?;
    let mut nonces = vec![];
    let mut commitments = vec![];
    for _ in &spends {
        let (n, c) = frost::round1::commit(kp.signing_share(), &mut OsRng);
        nonces.push(n);
        commitments.push(c);
    }
    Ok(json!({"nonces": nonces, "commitments": commitments}).to_string())
}

/// Coordinator: `commitments` is `{id: [SigningCommitments per spend]}`.
pub fn sign_package(pczt: &str, fvk: &str, commitments: &str, min_signers: u16) -> R<String> {
    let (spends, _, h, _) = inspect_inner(&pczt_from_b64(pczt)?, &parse_fvk(fvk)?)?;
    let per: BTreeMap<Identifier, Vec<SigningCommitments>> =
        id_map(&from_json(commitments, "commitments")?, "commitment list")?;
    ensure(per.len() >= min_signers as usize, &format!("need at least {min_signers} signers"))?;
    let mut packages = vec![];
    for k in 0..spends.len() {
        let mut m = BTreeMap::new();
        for (id, cs) in &per {
            ensure(cs.len() == spends.len(), "a signer committed for the wrong number of spends")?;
            m.insert(*id, cs[k]);
        }
        packages.push(SigningPackage::new(m, &h));
    }
    let signers: Vec<u16> = per.keys().map(ident_u16).collect::<R<_>>()?;
    Ok(json!({
        "sighash": hex::encode(h),
        "signers": signers,
        "spends": spends,
        "signing_packages": packages,
    })
    .to_string())
}

fn randomizer(s: &PendingSpend) -> R<Randomizer> {
    Randomizer::deserialize(&hex::decode(&s.alpha).map_err(e("alpha hex"))?).map_err(e("randomizer"))
}

/// Round 2. The participant re-derives everything from the PCZT and refuses
/// if the coordinator's package disagrees with it. `approval` is what this
/// device saved when its user approved: `{nonces, commitments, sighash}`. A
/// share is made only for the transaction that was approved.
pub fn sign_share(
    pczt: &str,
    fvk: &str,
    package: &str,
    approval: &str,
    key_package: &str,
    id: u16,
) -> R<String> {
    let (spends, _, h, _) = inspect_inner(&pczt_from_b64(pczt)?, &parse_fvk(fvk)?)?;
    let approval: Value = from_json(approval, "approval")?;
    ensure(
        approval["sighash"].as_str() == Some(&hex::encode(h)),
        "this transaction is not the one this device approved",
    )?;
    let pkg: Value = from_json(package, "package")?;
    ensure(pkg["sighash"].as_str() == Some(&hex::encode(h)), "coordinator's sighash does not match the transaction")?;
    let pkg_spends: Vec<PendingSpend> = from_value(&pkg["spends"], "spends")?;
    ensure(pkg_spends == spends, "coordinator's spends or randomizers do not match the transaction")?;
    let sps: Vec<SigningPackage> = from_value(&pkg["signing_packages"], "signing packages")?;
    ensure(sps.len() == spends.len(), "package count mismatch")?;
    let nonces: Vec<SigningNonces> = from_value(&approval["nonces"], "nonces")?;
    let mine: Vec<SigningCommitments> = from_value(&approval["commitments"], "commitments")?;
    let kp: KeyPackage = from_json(key_package, "key package")?;
    ensure(nonces.len() == spends.len() && mine.len() == spends.len(), "nonce count mismatch")?;
    let me = ident(id)?;
    let mut shares = vec![];
    for (k, sp) in sps.iter().enumerate() {
        ensure(sp.message() == &h, "a signing package signs the wrong message")?;
        let c = sp.signing_commitment(&me).ok_or("my commitment is missing from the package")?;
        ensure(c == mine[k], "the coordinator replaced my nonce commitment")?;
        shares.push(frost::round2::sign(sp, &nonces[k], &kp, randomizer(&spends[k])?).map_err(e("sign"))?);
    }
    Ok(serde_json::to_string(&shares).unwrap())
}

#[derive(Debug)]
enum SignErr {
    #[allow(dead_code)]
    Parse(OrchardParseError),
    #[allow(dead_code)]
    Apply(orchard::pczt::SignerError),
}
impl From<OrchardParseError> for SignErr {
    fn from(x: OrchardParseError) -> Self {
        SignErr::Parse(x)
    }
}

/// Coordinator: `shares` is `{id: [SignatureShare per spend]}`. Returns the
/// signed (still unproven) PCZT.
pub fn sign_aggregate(pczt: &str, public_key_package: &str, package: &str, shares: &str) -> R<String> {
    let p = pczt_from_b64(pczt)?;
    let (_, h) = sighash(&p)?;
    let pkp: PublicKeyPackage = from_json(public_key_package, "public key package")?;
    let pkg: Value = from_json(package, "package")?;
    let spends: Vec<PendingSpend> = from_value(&pkg["spends"], "spends")?;
    let sps: Vec<SigningPackage> = from_value(&pkg["signing_packages"], "signing packages")?;
    let per: BTreeMap<Identifier, Vec<SignatureShare>> = id_map(&from_json(shares, "shares")?, "share list")?;
    let mut sigs = vec![];
    let mut report = vec![];
    for (k, sp) in spends.iter().enumerate() {
        let mut m = BTreeMap::new();
        for (id, s) in &per {
            m.insert(*id, *s.get(k).ok_or("share list too short")?);
        }
        let params = RandomizedParams::from_randomizer(pkp.verifying_key(), randomizer(sp)?);
        let sig = frost::aggregate(&sps[k], &m, &pkp, &params).map_err(|x| match x {
            frost_rerandomized::frost_core::Error::InvalidSignatureShare { culprit } => {
                err!("invalid signature share from participant {}", ident_u16(&culprit).unwrap_or(0))
            }
            other => err!("aggregation failed: {other:?}"),
        })?;
        let bytes: [u8; 64] = sig.serialize().map_err(e("sig"))?.try_into().map_err(|_| "sig len")?;
        let rk_b: [u8; 32] = hex::decode(&sp.rk).map_err(e("rk"))?.try_into().map_err(|_| "rk len")?;
        let rk = redpallas::VerificationKey::<SpendAuth>::try_from(rk_b).map_err(|_| "bad rk")?;
        rk.verify(&h, &redpallas::Signature::<SpendAuth>::from(bytes))
            .map_err(|_| "aggregate signature does not verify under rk")?;
        report.push(json!({"action": sp.action_index, "pool": format!("{:?}", sp.pool),
            "rk": sp.rk, "signature": hex::encode(bytes)}));
        sigs.push((sp.pool, sp.action_index, bytes));
    }
    let mut signer = LowLevelSigner::new(p);
    for pool in [Pool::Orchard, Pool::Ironwood] {
        let mine: Vec<_> = sigs.iter().filter(|s| s.0 == pool).cloned().collect();
        if mine.is_empty() {
            continue;
        }
        let apply = |_: &Pczt, b: &mut orchard::pczt::Bundle, _: &mut u8| {
            for (_, i, s) in &mine {
                b.actions_mut()[*i]
                    .apply_signature(h, redpallas::Signature::<SpendAuth>::from(*s))
                    .map_err(SignErr::Apply)?;
            }
            Ok::<(), SignErr>(())
        };
        signer = match pool {
            Pool::Orchard => signer.sign_orchard_with(apply),
            Pool::Ironwood => signer.sign_ironwood_with(apply),
        }
        .map_err(e("apply signatures"))?;
    }
    Ok(json!({"signed_pczt": pczt_to_b64(signer.finish())?, "signatures": report}).to_string())
}

/// Coordinator: create the Halo2 proof, then extract and fully verify the
/// transaction (proof, every spend authorization signature, binding sig).
pub fn finalize(signed_pczt: &str) -> R<String> {
    let p = pczt_from_b64(signed_pczt)?;
    let (v, _) = sighash(&p)?;
    let p = if v == TxVersion::V6 {
        let pk = orchard::circuit::ProvingKey::build(orchard::circuit::OrchardCircuitVersion::PostNu6_3);
        Prover::new(p).create_ironwood_proof(rng(), &pk).map_err(e("prover"))?.finish()
    } else {
        let pk = orchard::circuit::ProvingKey::build(orchard::circuit::OrchardCircuitVersion::FixedPostNu6_2);
        Prover::new(p).create_orchard_proof(rng(), &pk).map_err(e("prover"))?.finish()
    };
    let p = SpendFinalizer::new(p).finalize_spends().map_err(e("spend finalizer"))?;
    let tx = TransactionExtractor::new(p).extract(rng()).map_err(e("extract"))?;
    let mut raw = vec![];
    tx.write(&mut raw).map_err(e("write"))?;
    Ok(json!({"tx_hex": hex::encode(&raw), "txid": tx.txid().to_string(),
        "size": raw.len(), "version": format!("{v:?}")})
    .to_string())
}

// ──────────────── Sealed box for DKG round-2 messages ────────────────

pub fn box_keypair() -> String {
    let sk = x25519_dalek::StaticSecret::random_from_rng(OsRng);
    let pk = x25519_dalek::PublicKey::from(&sk);
    json!({"sk": hex::encode(sk.to_bytes()), "pk": hex::encode(pk.as_bytes())}).to_string()
}

fn box_key(my_sk: &str, their_pk: &str, ctx: &str) -> R<ChaCha20Poly1305> {
    let sk: [u8; 32] = hex::decode(my_sk).map_err(e("sk"))?.try_into().map_err(|_| "sk len")?;
    let pk: [u8; 32] = hex::decode(their_pk).map_err(e("pk"))?.try_into().map_err(|_| "pk len")?;
    let shared = x25519_dalek::StaticSecret::from(sk).diffie_hellman(&x25519_dalek::PublicKey::from(pk));
    let k = blake2b_simd::Params::new()
        .hash_length(32)
        .personal(b"zecfrost-dkg-box")
        .to_state()
        .update(shared.as_bytes())
        .update(ctx.as_bytes())
        .finalize();
    ChaCha20Poly1305::new_from_slice(k.as_bytes()).map_err(e("key"))
}

/// `ctx` binds the ciphertext to its route, e.g. "group:3->1".
pub fn box_seal(my_sk: &str, their_pk: &str, ctx: &str, plaintext: &str) -> R<String> {
    let mut n = [0u8; 12];
    OsRng.fill_bytes(&mut n);
    let ct = box_key(my_sk, their_pk, ctx)?
        .encrypt(Nonce::from_slice(&n), plaintext.as_bytes())
        .map_err(e("encrypt"))?;
    Ok(format!("{}.{}", hex::encode(n), B64.encode(ct)))
}

pub fn box_open(my_sk: &str, their_pk: &str, ctx: &str, sealed: &str) -> R<String> {
    let (n, c) = sealed.split_once('.').ok_or("bad sealed message")?;
    let n = hex::decode(n).map_err(e("nonce"))?;
    ensure(n.len() == 12, "bad nonce")?;
    let pt = box_key(my_sk, their_pk, ctx)?
        .decrypt(Nonce::from_slice(&n), B64.decode(c).map_err(e("b64"))?.as_slice())
        .map_err(|_| "cannot decrypt: wrong key or tampered message".to_string())?;
    String::from_utf8(pt).map_err(e("utf8"))
}

// ──────────────── Group-secret sealing for the shared store ────────────────

fn store_key(secret: &str) -> R<XChaCha20Poly1305> {
    let raw = B64URL.decode(secret).map_err(e("group secret"))?;
    ensure(raw.len() == 32, "group secret must be 32 bytes")?;
    let k = blake2b_simd::Params::new().hash_length(32).personal(b"zf-store-v1").hash(&raw);
    XChaCha20Poly1305::new_from_slice(k.as_bytes()).map_err(e("key"))
}

/// Sealed values are padded so the server cannot read lengths: how many digits an amount has,
/// how long a note is, or roughly how many notes a transaction spends.
const SEALED_PADDED: char = '~';

/// Pads to at least 64 bytes and then to the next power of two: 0x80, then zeros.
fn pad(plaintext: &[u8]) -> Vec<u8> {
    let size = (plaintext.len() + 1).next_power_of_two().max(64);
    let mut out = Vec::with_capacity(size);
    out.extend_from_slice(plaintext);
    out.push(0x80);
    out.resize(size, 0);
    out
}

fn unpad(padded: &[u8]) -> R<&[u8]> {
    let end = padded.iter().rposition(|&b| b != 0).ok_or("sealed value has no padding mark")?;
    ensure(padded[end] == 0x80, "sealed value has a bad padding mark")?;
    Ok(&padded[..end])
}

/// `aad` binds the ciphertext to its document path and field name.
pub fn secret_seal(secret: &str, aad: &str, plaintext: &str) -> R<String> {
    let mut n = [0u8; 24];
    OsRng.fill_bytes(&mut n);
    let msg = pad(plaintext.as_bytes());
    let ct = store_key(secret)?
        .encrypt(XNonce::from_slice(&n), Payload { msg: &msg, aad: aad.as_bytes() })
        .map_err(e("encrypt"))?;
    Ok(format!("{SEALED_PADDED}{}", B64URL.encode([n.as_slice(), &ct].concat())))
}

/// Opens padded values and the unpadded ones written before padding existed.
pub fn secret_open(secret: &str, aad: &str, sealed: &str) -> R<String> {
    let (padded, body) = match sealed.strip_prefix(SEALED_PADDED) {
        Some(rest) => (true, rest),
        None => (false, sealed),
    };
    let raw = B64URL.decode(body).map_err(e("b64"))?;
    ensure(raw.len() > 24, "sealed value too short")?;
    let (n, ct) = raw.split_at(24);
    let pt = store_key(secret)?
        .decrypt(XNonce::from_slice(n), Payload { msg: ct, aad: aad.as_bytes() })
        .map_err(|_| "cannot decrypt: wrong key or tampered value".to_string())?;
    let pt = if padded { unpad(&pt)?.to_vec() } else { pt };
    String::from_utf8(pt).map_err(e("utf8"))
}

/// The same value with every object's keys in sorted order, so that its JSON text does not depend
/// on the order of the input. A number must be an integer: a float has no single text form.
fn sorted_json(v: &Value) -> R<Value> {
    match v {
        Value::Object(m) => {
            let mut keys: Vec<&String> = m.keys().collect();
            keys.sort();
            let mut out = serde_json::Map::new();
            for k in keys {
                out.insert(k.clone(), sorted_json(&m[k])?);
            }
            Ok(Value::Object(out))
        }
        Value::Array(a) => a.iter().map(sorted_json).collect::<R<Vec<_>>>().map(Value::Array),
        Value::Number(n) => {
            ensure(n.is_i64() || n.is_u64(), "a signed document can hold whole numbers only")?;
            Ok(v.clone())
        }
        _ => Ok(v.clone()),
    }
}

/// The text that a seat signs for a document of a version 3 wallet: the compact JSON array
/// `["zigs-doc-v1", walletId, path, seat, fields]`. `path` is the document path below the wallet
/// (for example `confirm/1`), and `fields` is a JSON object whose keys are sorted at every level.
/// The signature is Ed25519 over the UTF-8 bytes of this text.
pub fn doc_payload(wallet_id: &str, path: &str, seat: u16, fields: &str) -> R<String> {
    let fields: Value = from_json(fields, "fields")?;
    ensure(fields.is_object(), "fields must be a JSON object")?;
    let payload = json!(["zigs-doc-v1", wallet_id, path, seat, sorted_json(&fields)?]);
    Ok(payload.to_string())
}

// ───────────────────────── JS bindings ─────────────────────────

fn js<T>(r: R<T>) -> Result<T, JsError> {
    r.map_err(|m| JsError::new(&m))
}

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen(js_name = dkgPart1)]
pub fn js_dkg_part1(id: u16, n: u16, t: u16) -> Result<String, JsError> {
    js(dkg_part1(id, n, t))
}
#[wasm_bindgen(js_name = dkgPart2)]
pub fn js_dkg_part2(secret: &str, round1: &str) -> Result<String, JsError> {
    js(dkg_part2(secret, round1))
}
#[wasm_bindgen(js_name = dkgPart3)]
pub fn js_dkg_part3(secret2: &str, round1: &str, round2: &str) -> Result<String, JsError> {
    js(dkg_part3(secret2, round1, round2))
}
#[wasm_bindgen(js_name = walletCreate)]
pub fn js_wallet_create(pkp: &str, net: &str) -> Result<String, JsError> {
    js(wallet_create(pkp, net))
}
#[wasm_bindgen(js_name = skCommit)]
pub fn js_sk_commit(wallet_id: &str, seat: u16, box_pk: &str, r: &str) -> Result<String, JsError> {
    js(ceremony::sk_commit(wallet_id, seat, box_pk, r))
}
#[wasm_bindgen(js_name = dkgEcho)]
pub fn js_dkg_echo(wallet_id: &str, round1: &str) -> Result<String, JsError> {
    js(ceremony::dkg_echo(wallet_id, round1))
}
#[wasm_bindgen(js_name = vaultSk)]
pub fn js_vault_sk(wallet_id: &str, echo: &str, parts: &str) -> Result<String, JsError> {
    js(ceremony::vault_sk(wallet_id, echo, parts))
}
#[wasm_bindgen(js_name = safetyNumber)]
pub fn js_safety_number(
    wallet_id: &str, t: u16, n: u16, network: &str, seats: &str,
) -> Result<String, JsError> {
    js(ceremony::safety_number(wallet_id, t, n, network, seats))
}
#[wasm_bindgen(js_name = walletCreateV2)]
pub fn js_wallet_create_v2(pkp: &str, net: &str, sk: &str) -> Result<String, JsError> {
    js(ceremony::wallet_create_v2(pkp, net, sk))
}
#[wasm_bindgen(js_name = walletVerifyV2)]
pub fn js_wallet_verify_v2(wallet: &str, pkp: &str, sk: &str) -> Result<String, JsError> {
    js(ceremony::wallet_verify_v2(wallet, pkp, sk))
}
#[wasm_bindgen(js_name = normalizeAddress)]
pub fn js_normalize_address(addr: &str) -> Result<String, JsError> {
    js(normalize_address(addr))
}
#[wasm_bindgen(js_name = walletVerify)]
pub fn js_wallet_verify(wallet: &str, pkp: &str) -> Result<String, JsError> {
    js(wallet_verify(wallet, pkp))
}
#[wasm_bindgen(js_name = inspect)]
pub fn js_inspect(pczt: &str, fvk: &str) -> Result<String, JsError> {
    js(inspect(pczt, fvk))
}
#[wasm_bindgen(js_name = signCommit)]
pub fn js_sign_commit(pczt: &str, fvk: &str, kp: &str) -> Result<String, JsError> {
    js(sign_commit(pczt, fvk, kp))
}
#[wasm_bindgen(js_name = signPackage)]
pub fn js_sign_package(pczt: &str, fvk: &str, commitments: &str, min: u16) -> Result<String, JsError> {
    js(sign_package(pczt, fvk, commitments, min))
}
#[wasm_bindgen(js_name = signShare)]
pub fn js_sign_share(
    pczt: &str, fvk: &str, package: &str, approval: &str, kp: &str, id: u16,
) -> Result<String, JsError> {
    js(sign_share(pczt, fvk, package, approval, kp, id))
}
#[wasm_bindgen(js_name = signAggregate)]
pub fn js_sign_aggregate(pczt: &str, pkp: &str, package: &str, shares: &str) -> Result<String, JsError> {
    js(sign_aggregate(pczt, pkp, package, shares))
}
#[wasm_bindgen(js_name = finalize)]
pub fn js_finalize(signed: &str) -> Result<String, JsError> {
    js(finalize(signed))
}
#[wasm_bindgen(js_name = boxKeypair)]
pub fn js_box_keypair() -> String {
    box_keypair()
}
#[wasm_bindgen(js_name = boxSeal)]
pub fn js_box_seal(sk: &str, pk: &str, ctx: &str, pt: &str) -> Result<String, JsError> {
    js(box_seal(sk, pk, ctx, pt))
}
#[wasm_bindgen(js_name = boxOpen)]
pub fn js_box_open(sk: &str, pk: &str, ctx: &str, ct: &str) -> Result<String, JsError> {
    js(box_open(sk, pk, ctx, ct))
}
#[wasm_bindgen(js_name = secretSeal)]
pub fn js_secret_seal(secret: &str, aad: &str, pt: &str) -> Result<String, JsError> {
    js(secret_seal(secret, aad, pt))
}
#[wasm_bindgen(js_name = secretOpen)]
pub fn js_secret_open(secret: &str, aad: &str, ct: &str) -> Result<String, JsError> {
    js(secret_open(secret, aad, ct))
}
#[wasm_bindgen(js_name = docPayload)]
pub fn js_doc_payload(
    wallet_id: &str, path: &str, seat: u16, fields: &str,
) -> Result<String, JsError> {
    js(doc_payload(wallet_id, path, seat, fields))
}
#[wasm_bindgen(js_name = backupSeal)]
pub fn js_backup_seal(passphrase: &str, plaintext: &str) -> Result<String, JsError> {
    js(backup::seal(passphrase, plaintext))
}
#[wasm_bindgen(js_name = backupOpen)]
pub fn js_backup_open(passphrase: &str, sealed: &str) -> Result<String, JsError> {
    js(backup::open(passphrase, sealed))
}

// ─────────────────────────── Tests ───────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use incrementalmerkletree::Retention;
    use orchard::tree::MerkleHashOrchard;
    use shardtree::{store::memory::MemoryShardStore, ShardTree};
    use zcash_note_encryption::try_note_decryption;
    use zcash_protocol::{local_consensus::LocalNetwork, memo::Memo};

    fn regtest(nu6_3: bool) -> LocalNetwork {
        LocalNetwork {
            overwinter: Some(BlockHeight::from_u32(1)),
            sapling: Some(BlockHeight::from_u32(2)),
            blossom: Some(BlockHeight::from_u32(3)),
            heartwood: Some(BlockHeight::from_u32(4)),
            canopy: Some(BlockHeight::from_u32(5)),
            nu5: Some(BlockHeight::from_u32(6)),
            nu6: Some(BlockHeight::from_u32(7)),
            nu6_1: Some(BlockHeight::from_u32(8)),
            nu6_2: Some(BlockHeight::from_u32(9)),
            nu6_3: nu6_3.then(|| BlockHeight::from_u32(10)),
            nu7: None,
        }
    }

    /// Test only: fabricate incoming notes of `values` for the wallet (no chain access), in one
    /// note commitment tree. Returns each note with its Merkle path, and the anchor.
    fn incoming_notes(
        fvk: &FullViewingKey,
        values: &[u64],
        ironwood: bool,
    ) -> R<(Vec<(orchard::Note, orchard::tree::MerklePath)>, orchard::Anchor)> {
        let version = if ironwood {
            orchard::bundle::BundleVersion::ironwood_v3()
        } else {
            orchard::bundle::BundleVersion::orchard_v2()
        };
        // 1. Someone pays the wallet; the wallet finds the notes with its IVK.
        let mut b = orchard::builder::Builder::new(
            orchard::builder::BundleType::DEFAULT,
            version,
            version.default_flags(),
            orchard::Anchor::empty_tree(),
        )
        .map_err(e("builder"))?;
        for &value in values {
            b.add_output(
                None,
                fvk.address_at(0u32, Scope::External),
                orchard::value::NoteValue::from_raw(value),
                Memo::Empty.encode().into_bytes(),
            )
            .map_err(e("output"))?;
        }
        let (bundle, meta) = b.build::<i64>(rng()).map_err(e("build"))?.ok_or("empty")?;
        let ivk = fvk.to_ivk(Scope::External).prepare();
        let mut notes = vec![];
        for k in 0..values.len() {
            let action = bundle.actions().get(meta.output_action_index(k).unwrap()).unwrap();
            let found = if ironwood {
                let domain = orchard::note_encryption::IronwoodDomain::for_action(action);
                try_note_decryption(&domain, &ivk, action)
            } else {
                let domain = orchard::note_encryption::OrchardDomain::for_action(action);
                try_note_decryption(&domain, &ivk, action)
            };
            notes.push(found.ok_or("wallet IVK could not decrypt an incoming note")?.0);
        }
        // 2. A note commitment tree that holds only these notes.
        let leaf = |n: &orchard::Note| {
            let cmx: orchard::note::ExtractedNoteCommitment = n.commitment().into();
            MerkleHashOrchard::from_cmx(&cmx)
        };
        let store = MemoryShardStore::<MerkleHashOrchard, u32>::empty();
        let mut tree = ShardTree::<_, 32, 16>::new(store, 100);
        for n in &notes {
            tree.append(leaf(n), Retention::Marked).map_err(e("tree"))?;
        }
        tree.checkpoint(9_999_999).map_err(e("tree"))?;
        let mut out = vec![];
        let mut root = None;
        for (i, n) in notes.into_iter().enumerate() {
            let p = tree
                .witness_at_checkpoint_depth((i as u64).into(), 0)
                .map_err(e("witness"))?
                .ok_or("no witness")?;
            root = Some(p.root(leaf(&n)));
            out.push((n, orchard::tree::MerklePath::from(p)));
        }
        Ok((out, orchard::Anchor::from(root.ok_or("no notes")?)))
    }

    /// Test only: fabricate an incoming note (no chain access), then build a
    /// PCZT that spends it on a regtest chain.
    fn tx_demo_create(fvk_hex: &str, amount: u64, note_value: u64, pool: &str) -> R<String> {
        let fvk = parse_fvk(fvk_hex)?;
        let ironwood = match pool {
            "ironwood" => true,
            "orchard" => false,
            _ => return Err("pool must be ironwood or orchard".into()),
        };
        let (mut spends, anchor) = incoming_notes(&fvk, &[note_value], ironwood)?;
        let (note, path) = spends.remove(0);
        // 3. Pay third parties (four in one Ironwood batch), change back to the wallet's internal
        // address. The builder rejects the PCZT if this fee differs from ZIP 317.
        let count = if ironwood { 4 } else { 1 };
        let fee = 5_000 * (count as u64 + 1).max(2);
        let change = note_value
            .checked_sub(amount * count as u64 + fee)
            .ok_or("note value too small for the amounts and the fee")?;
        let payees: Vec<_> = (0..count)
            .map(|_| (FullViewingKey::from(&random_sk()).address_at(0u32, Scope::External), amount))
            .collect();
        let payee = payees[0].0;
        let pczt = if ironwood {
            let spends = (vec![(note, path)], anchor);
            build_ironwood_pczt(regtest(true), 10_000_000.into(), &fvk, spends, (&payees, change))?
        } else {
            let mut builder = Builder::new(
                regtest(false),
                10_000_000.into(),
                BuildConfig::Standard {
                    sapling_anchor: None,
                    orchard_anchor: Some(anchor),
                    ironwood_anchor: None,
                    orchard_padding: BundlePadding::DEFAULT,
                    ironwood_padding: BundlePadding::DEFAULT,
                },
            );
            let az = Zatoshis::from_u64(amount).map_err(e("amount"))?;
            let cz = Zatoshis::from_u64(change).map_err(e("change"))?;
            let eo = Some(fvk.to_ovk(Scope::External));
            let io = Some(fvk.to_ovk(Scope::Internal));
            let ca = fvk.address_at(0u32, Scope::Internal);
            builder
                .add_orchard_spend::<zip317::FeeRule>(fvk.clone(), note, path)
                .and_then(|_| builder.add_orchard_output::<zip317::FeeRule>(eo, payee, az, MemoBytes::empty()))
                .and_then(|_| builder.add_orchard_output::<zip317::FeeRule>(io, ca, cz, MemoBytes::empty()))
                .map_err(e("builder"))?;
            let PcztResult { pczt_parts, .. } = builder
                .build_for_pczt(rng(), &zip317::FeeRule::standard())
                .map_err(e("build_for_pczt"))?;
            let pczt = Creator::build_from_parts(pczt_parts).ok_or("creator failed")?;
            IoFinalizer::new(pczt).finalize_io(rng()).map_err(e("io finalizer"))?
        };
        Ok(json!({
            "pczt": pczt_to_b64(pczt)?,
            "pool": pool,
            "amount": amount, "change": change, "fee": fee, "note_value": note_value,
        })
        .to_string())
    }


    fn v(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }

    /// `{"j": f(j)}` for every seat `j` in `1..=n` except `me`.
    fn others(n: u16, me: u16, f: &dyn Fn(u16) -> Value) -> String {
        let map: serde_json::Map<String, Value> =
            (1..=n).filter(|j| *j != me).map(|j| (j.to_string(), f(j))).collect();
        Value::Object(map).to_string()
    }

    /// A 2-of-3 DKG through the exact JSON API the web page uses, including encrypted round-2
    /// transport. With `v2`, the seats also run the sk agreement: commitments in round 1, the echo,
    /// and each secret part `r` inside the sealed round-2 payload. Returns every seat's DKG result
    /// and, with `v2`, the sk that each seat computed from its own view.
    fn run_dkg(v2: bool) -> (Vec<Value>, Vec<String>) {
        let (n, t) = (3u16, 2u16);
        let boxes: Vec<Value> = (0..n).map(|_| v(&box_keypair())).collect();
        let pk = |i: u16| boxes[i as usize - 1]["pk"].as_str().unwrap().to_string();
        let sk = |i: u16| boxes[i as usize - 1]["sk"].as_str().unwrap().to_string();
        let r1: Vec<Value> = (1..=n).map(|i| v(&dkg_part1(i, n, t).unwrap())).collect();
        let rs: Vec<String> = (0..n).map(|_| hex::encode(random_sk().to_bytes())).collect();
        let commits: Vec<String> = (1..=n)
            .map(|i| ceremony::sk_commit("g", i, &pk(i), &rs[i as usize - 1]).unwrap())
            .collect();
        let r2: Vec<Value> = (1..=n)
            .map(|i| {
                let all = others(n, i, &|j| r1[j as usize - 1]["package"].clone());
                v(&dkg_part2(&r1[i as usize - 1]["secret"].to_string(), &all).unwrap())
            })
            .collect();
        // sealed transport
        let mut sealed = BTreeMap::new();
        for i in 1..=n {
            for (to, pkg) in r2[i as usize - 1]["outgoing"].as_object().unwrap() {
                let to: u16 = to.parse().unwrap();
                let payload = if v2 {
                    json!({"package": pkg, "r": rs[i as usize - 1]}).to_string()
                } else {
                    pkg.to_string()
                };
                let c = box_seal(&sk(i), &pk(to), &format!("g:{i}->{to}"), &payload).unwrap();
                sealed.insert((i, to), c);
            }
        }
        let open = |me: u16, from: u16| {
            let ctx = format!("g:{from}->{me}");
            v(&box_open(&sk(me), &pk(from), &ctx, &sealed[&(from, me)]).unwrap())
        };
        let fin: Vec<Value> = (1..=n)
            .map(|i| {
                let all1 = others(n, i, &|j| r1[j as usize - 1]["package"].clone());
                let all2 = others(n, i, &|j| {
                    let opened = open(i, j);
                    if v2 { opened["package"].clone() } else { opened }
                });
                v(&dkg_part3(&r2[i as usize - 1]["secret"].to_string(), &all1, &all2).unwrap())
            })
            .collect();
        assert!(fin.iter().all(|f| f["group_key"] == fin[0]["group_key"]));
        if !v2 {
            return (fin, vec![]);
        }
        let round1: serde_json::Map<String, Value> = (1..=n)
            .map(|i| {
                let doc = json!({"package": r1[i as usize - 1]["package"],
                                 "commit": commits[i as usize - 1]});
                (i.to_string(), doc)
            })
            .collect();
        let echo = ceremony::dkg_echo("g", &Value::Object(round1).to_string()).unwrap();
        let sks = (1..=n)
            .map(|i| {
                let parts: serde_json::Map<String, Value> = (1..=n)
                    .map(|j| {
                        let r = if j == i {
                            rs[j as usize - 1].clone()
                        } else {
                            open(i, j)["r"].as_str().unwrap().to_string()
                        };
                        let commit = &commits[j as usize - 1];
                        (j.to_string(), json!({"r": r, "commit": commit, "boxPk": pk(j)}))
                    })
                    .collect();
                ceremony::vault_sk("g", &echo, &Value::Object(parts).to_string()).unwrap()
            })
            .collect();
        (fin, sks)
    }

    /// The wallet that seat 1 creates. Every seat checks it against its own data first. Version 2
    /// applies when the seats computed an sk.
    fn make_wallet(fin: &[Value], sks: &[String]) -> Value {
        let pkp = fin[0]["public_key_package"].to_string();
        if sks.is_empty() {
            let w = v(&wallet_create(&pkp, "testnet").unwrap());
            for f in fin {
                wallet_verify(&w.to_string(), &f["public_key_package"].to_string()).unwrap();
            }
            assert_eq!(w["version"], Value::Null);
            return w;
        }
        assert!(sks.iter().all(|k| *k == sks[0]), "every seat computes the same sk");
        let w = v(&ceremony::wallet_create_v2(&pkp, "testnet", &sks[0]).unwrap());
        for (f, sk) in fin.iter().zip(sks) {
            let mine = f["public_key_package"].to_string();
            ceremony::wallet_verify_v2(&w.to_string(), &mine, sk).unwrap();
            let own = v(&ceremony::wallet_create_v2(&mine, "testnet", sk).unwrap());
            assert_eq!(own, w, "every seat derives the same wallet from its own data");
        }
        assert_eq!(w["version"], 2);
        w
    }

    /// Full 2-of-3 flow: DKG, wallet, then a payment that is inspected, signed, aggregated and
    /// finalized with a Halo2 proof. Version 2 wallets must pass every step that version 1 passes.
    fn full_flow(pool: &str, signers: &[u16], v2: bool) {
        let t = 2u16;
        let (fin, sks) = run_dkg(v2);
        let pkp = fin[0]["public_key_package"].to_string();
        let w = make_wallet(&fin, &sks);
        let fvk = w["orchard_fvk"].as_str().unwrap();
        let tx = v(&tx_demo_create(fvk, 100_000, 1_000_000, pool).unwrap());
        let pczt = tx["pczt"].as_str().unwrap();
        let ins = v(&inspect(pczt, fvk).unwrap());
        assert_eq!(ins["spends"].as_array().unwrap().len(), 1);
        let paid: Vec<&str> = ins["lines"].as_array().unwrap().iter()
            .filter(|l| l["kind"] == "output" && l["value"] == 100_000)
            .filter_map(|l| l["who"].as_str().filter(|w| w.starts_with("utest1")))
            .collect();
        let count = if pool == "ironwood" { 4 } else { 1 };
        assert_eq!(paid.len(), count, "inspect names each recipient by address, with its amount");
        assert_eq!(paid.iter().collect::<std::collections::BTreeSet<_>>().len(), count);
        assert_eq!(normalize_address(paid[0]).unwrap(), paid[0]);
        assert!(normalize_address("not an address").is_err());

        let mut comm = serde_json::Map::new();
        let mut secrets = BTreeMap::new();
        for &i in signers {
            let c = v(&sign_commit(pczt, fvk, &fin[i as usize - 1]["key_package"].to_string()).unwrap());
            comm.insert(i.to_string(), c["commitments"].clone());
            secrets.insert(i, c);
        }
        let pkg = sign_package(pczt, fvk, &Value::Object(comm).to_string(), t).unwrap();
        let approval = |i: u16, sighash: &str| {
            json!({"nonces": secrets[&i]["nonces"], "commitments": secrets[&i]["commitments"],
                   "sighash": sighash}).to_string()
        };
        let kp = |i: u16| fin[i as usize - 1]["key_package"].to_string();
        let first = signers[0];
        let other = hex::encode([7u8; 32]);
        let refused = sign_share(pczt, fvk, &pkg, &approval(first, &other), &kp(first), first);
        assert!(refused.unwrap_err().contains("not the one this device approved"));
        let mut shares = serde_json::Map::new();
        for &i in signers {
            let s = sign_share(pczt, fvk, &pkg, &approval(i, ins["sighash"].as_str().unwrap()), &kp(i), i)
                .unwrap();
            shares.insert(i.to_string(), v(&s));
        }
        let agg = v(&sign_aggregate(pczt, &pkp, &pkg, &Value::Object(shares.clone()).to_string()).unwrap());
        let out = v(&finalize(agg["signed_pczt"].as_str().unwrap()).unwrap());
        assert!(out["size"].as_u64().unwrap() > 9000);

        // wrong share is attributed
        let mut bad = shares.clone();
        let a = signers[0].to_string();
        let b = signers[1].to_string();
        bad.insert(b.clone(), shares[&a].clone());
        let r = sign_aggregate(pczt, &pkp, &pkg, &Value::Object(bad).to_string());
        assert!(r.unwrap_err().contains(&format!("participant {b}")));
    }

    /// The builder signs dummy spends early, so most payee outputs sit next to a spend that is not
    /// ours. Each one must still be bound to the recipient that `inspect` shows.
    #[test]
    fn inspect_binds_every_output_to_its_recipient() {
        let fvk = hex::encode(FullViewingKey::from(&random_sk()).to_bytes());
        let tx = v(&tx_demo_create(&fvk, 100_000, 1_000_000, "ironwood").unwrap());
        let pczt = tx["pczt"].as_str().unwrap();
        let raw = B64.decode(pczt).unwrap();
        let lines = v(&inspect(pczt, &fvk).unwrap())["lines"].as_array().unwrap().clone();
        let payees: Vec<[u8; 43]> = lines.iter()
            .filter_map(|l| l["who"].as_str().filter(|w| w.starts_with("utest1")))
            .map(|ua| match zcash_keys::address::Address::decode(&Network::TestNetwork, ua) {
                Some(zcash_keys::address::Address::Unified(u)) => {
                    u.orchard().unwrap().to_raw_address_bytes()
                }
                _ => panic!("payee is not a unified address"),
            })
            .collect();
        assert_eq!(payees.len(), 4);
        let thief = FullViewingKey::from(&random_sk())
            .address_at(0u32, Scope::External)
            .to_raw_address_bytes();
        for p in payees {
            let at = raw.windows(43).position(|w| w == p).expect("recipient bytes in the PCZT");
            let mut bad = raw.clone();
            bad[at..at + 43].copy_from_slice(&thief);
            let r = inspect(&B64.encode(&bad), &fvk);
            assert!(r.is_err(), "a payee output with a swapped recipient was accepted");
        }
    }

    /// More notes than outputs: the fee follows the spends, and `inspect` accepts the result.
    #[test]
    fn ironwood_spends_three_notes_for_one_payee() {
        let fvk = FullViewingKey::from(&random_sk());
        let (spends, anchor) = incoming_notes(&fvk, &[40_000, 50_000, 60_000], true).unwrap();
        let payee = FullViewingKey::from(&random_sk()).address_at(0u32, Scope::External);
        let fee = chain::zip317_fee(3, 2);
        assert_eq!(fee, 15_000);
        let outs = (&[(payee, 100_000)][..], 150_000 - 100_000 - fee);
        let pczt = build_ironwood_pczt(regtest(true), 10_000_000.into(), &fvk, (spends, anchor), outs)
            .unwrap();
        let ins = v(&inspect(&pczt_to_b64(pczt).unwrap(), &hex::encode(fvk.to_bytes())).unwrap());
        assert_eq!(ins["spends"].as_array().unwrap().len(), 3);
        let paid = ins["lines"].as_array().unwrap().iter().filter(|l| l["value"] == 100_000).count();
        assert_eq!(paid, 1);
    }

    #[test]
    fn ironwood_2_of_3() {
        full_flow("ironwood", &[1, 3], false);
    }

    #[test]
    fn orchard_2_of_3() {
        full_flow("orchard", &[2, 3], false);
    }

    #[test]
    fn ironwood_2_of_3_with_version_2_wallet() {
        full_flow("ironwood", &[2, 3], true);
    }

    #[test]
    fn testnet_activates_nu7_with_v6_transactions() {
        use zcash_protocol::consensus::BranchId;
        let branch = BranchId::for_height(&Network::TestNetwork, BlockHeight::from_u32(4_465_026));
        assert_eq!(u32::from(branch), 0x7719_0AD9);
        assert_eq!(TxVersion::suggested_for_branch(branch), TxVersion::V6);
    }

    #[test]
    fn mainnet_uses_ironwood_v6_since_nu6_3() {
        use zcash_protocol::consensus::{BranchId, NetworkUpgrade, Parameters};
        assert_eq!(Network::MainNetwork.activation_height(NetworkUpgrade::Nu6_3), Some(BlockHeight::from_u32(3_428_143)));
        let branch = BranchId::for_height(&Network::MainNetwork, BlockHeight::from_u32(3_514_200));
        assert_eq!(branch, BranchId::Nu6_3);
        assert_eq!(TxVersion::suggested_for_branch(branch), TxVersion::V6);
    }

    #[test]
    fn store_seal_binds_key_and_aad() {
        let mut raw = [0u8; 32];
        OsRng.fill_bytes(&mut raw);
        let key = B64URL.encode(raw);
        let other = B64URL.encode([7u8; 32]);
        let ct = secret_seal(&key, "groups/g\nname", "\"Treasury\"").unwrap();
        assert_eq!(secret_open(&key, "groups/g\nname", &ct).unwrap(), "\"Treasury\"");
        assert!(secret_open(&key, "groups/g\nn", &ct).is_err());
        assert!(secret_open(&other, "groups/g\nname", &ct).is_err());
        assert!(secret_seal("short", "a", "b").is_err());
    }

    #[test]
    fn sealed_values_hide_their_length() {
        let key = B64URL.encode([9u8; 32]);
        let small = secret_seal(&key, "p\nf", "5000").unwrap();
        let large = secret_seal(&key, "p\nf", "123456789012").unwrap();
        assert_eq!(small.len(), large.len(), "amounts of different sizes look the same");
        assert_eq!(secret_open(&key, "p\nf", &large).unwrap(), "123456789012");
        assert_eq!(secret_open(&key, "p\nf", &secret_seal(&key, "p\nf", "").unwrap()).unwrap(), "");
        let long = "x".repeat(100);
        assert_eq!(secret_open(&key, "p\nf", &secret_seal(&key, "p\nf", &long).unwrap()).unwrap(), long);
        assert!(secret_open(&key, "other", &small).is_err());
    }

    #[test]
    fn unpadded_values_from_before_still_open() {
        let key = B64URL.encode([9u8; 32]);
        let n = [3u8; 24];
        let ct = store_key(&key).unwrap()
            .encrypt(XNonce::from_slice(&n), Payload { msg: b"\"old\"", aad: b"p\nf" }).unwrap();
        let old = B64URL.encode([n.as_slice(), &ct].concat());
        assert_eq!(secret_open(&key, "p\nf", &old).unwrap(), "\"old\"");
    }

    #[test]
    fn box_rejects_wrong_route() {
        let a = v(&box_keypair());
        let b = v(&box_keypair());
        let c = box_seal(a["sk"].as_str().unwrap(), b["pk"].as_str().unwrap(), "g:1->2", "hi").unwrap();
        assert_eq!(box_open(b["sk"].as_str().unwrap(), a["pk"].as_str().unwrap(), "g:1->2", &c).unwrap(), "hi");
        assert!(box_open(b["sk"].as_str().unwrap(), a["pk"].as_str().unwrap(), "g:1->3", &c).is_err());
    }

    #[test]
    fn doc_payload_ignores_key_order_and_spacing() {
        let a = r#"{"b": 1, "a": {"d": [3, {"z": 1, "y": 2}], "c": null}}"#;
        let b = r#"{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}"#;
        let (x, y) = (doc_payload("w", "p", 1, a).unwrap(), doc_payload("w", "p", 1, b).unwrap());
        assert_eq!(x, y);
        assert_eq!(x, r#"["zigs-doc-v1","w","p",1,{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}]"#);
    }

    #[test]
    fn doc_payload_known_answer() {
        let fields = r#"{"z": "a\"b\\c\né", "a": [1, -2, null, true], "m": {"y": 2, "x": 1}}"#;
        let got = doc_payload("0123456789abcdef0123", "sessions/s1/commits/2", 2, fields).unwrap();
        let want = concat!(
            r#"["zigs-doc-v1","0123456789abcdef0123","sessions/s1/commits/2",2,"#,
            r#"{"a":[1,-2,null,true],"m":{"x":1,"y":2},"z":"a\"b\\c\né"}]"#,
        );
        assert_eq!(got, want);
    }

    #[test]
    fn doc_payload_refuses_what_has_no_single_text() {
        let floats = [r#"{"a": 1.5}"#, r#"{"a": 1e3}"#, r#"{"a": [2.0]}"#];
        for bad in ["[1]", "\"x\"", "null", "{"].into_iter().chain(floats) {
            assert!(doc_payload("w", "p", 1, bad).is_err(), "{bad} is refused");
        }
        assert!(doc_payload("w", "p", 1, "{}").is_ok());
    }

    #[test]
    fn doc_payload_binds_wallet_path_and_seat() {
        let base = doc_payload("w", "confirm/1", 1, r#"{"n":"1"}"#).unwrap();
        for other in [("x", "confirm/1", 1), ("w", "confirm/2", 1), ("w", "confirm/1", 2)] {
            assert_ne!(base, doc_payload(other.0, other.1, other.2, r#"{"n":"1"}"#).unwrap());
        }
    }
}
