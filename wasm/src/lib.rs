//! Browser build of the zec-frost prototype.
//!
//! Every function takes and returns JSON strings, so the JavaScript side
//! only moves opaque blobs between participants. All cryptography runs here:
//! FROST DKG and re-randomized signing over RedPallas (reddsa), Orchard /
//! Ironwood key assembly (ZIP 312), PCZT construction, verification, Halo2
//! proving, transaction extraction, and the X25519 + ChaCha20-Poly1305 box
//! that protects DKG round-2 messages in transit.

use std::collections::BTreeMap;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chacha20poly1305::{aead::Aead, ChaCha20Poly1305, KeyInit, Nonce};
use group::ff::PrimeField;
use incrementalmerkletree::Retention;
use orchard::{
    keys::{FullViewingKey, Scope, SpendValidatingKey, SpendingKey},
    primitives::redpallas::{self, SpendAuth},
    tree::MerkleHashOrchard,
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
use shardtree::{store::memory::MemoryShardStore, ShardTree};
use wasm_bindgen::prelude::*;
use zcash_keys::{address::UnifiedAddress, keys::UnifiedFullViewingKey};
use zcash_note_encryption::try_note_decryption;
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
    consensus::{BlockHeight, Network},
    local_consensus::LocalNetwork,
    memo::{Memo, MemoBytes},
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

fn address_of(fvk: &FullViewingKey, net: Network) -> R<String> {
    let a = fvk.address_at(0u32, Scope::External);
    Ok(UnifiedAddress::from_receivers(Some(a), None, None, None)
        .ok_or("cannot build unified address")?
        .encode(&net))
}

fn parse_fvk(hex_fvk: &str) -> R<FullViewingKey> {
    let raw: [u8; 96] = hex::decode(hex_fvk)
        .map_err(e("fvk hex"))?
        .try_into()
        .map_err(|_| "fvk must be 96 bytes")?;
    FullViewingKey::from_bytes(&raw).ok_or_else(|| "invalid fvk".into())
}

/// ZIP 312: ak = FROST group key; nk and rivk from a random donor key whose
/// ask is discarded.
pub fn wallet_create(public_key_package: &str, net: &str) -> R<String> {
    let pkp: PublicKeyPackage = from_json(public_key_package, "public key package")?;
    let net = network(net)?;
    let ak_bytes = group_vk_bytes(&pkp)?;
    ensure(ak_bytes[31] & 0x80 == 0, "group key does not have even y")?;
    let ak = SpendValidatingKey::from_bytes(&ak_bytes).ok_or("group key is not a valid ak")?;
    let mut raw = FullViewingKey::from(&random_sk()).to_bytes();
    raw[..32].copy_from_slice(&ak.to_bytes());
    let fvk = FullViewingKey::from_bytes(&raw).ok_or("assembled FVK invalid")?;
    let ufvk = UnifiedFullViewingKey::from_orchard_fvk(fvk.clone()).map_err(e("ufvk"))?;
    Ok(json!({
        "network": if net == Network::MainNetwork { "mainnet" } else { "testnet" },
        "orchard_fvk": hex::encode(fvk.to_bytes()),
        "ufvk": ufvk.encode(&net).map_err(e("ufvk encode"))?,
        "address": address_of(&fvk, net)?,
        "group_verifying_key": hex::encode(ak_bytes),
    })
    .to_string())
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

fn pczt_from_b64(s: &str) -> R<Pczt> {
    let bytes = B64.decode(s).map_err(e("pczt base64"))?;
    Pczt::parse(&bytes).map_err(e("pczt parse"))
}

fn pczt_to_b64(p: Pczt) -> R<String> {
    Ok(B64.encode(p.serialize().map_err(e("pczt serialize"))?))
}

/// Demo only: fabricate an incoming note (no chain access), then build an
/// unsigned, *unproven* PCZT that spends it. Proving happens after signing,
/// in `finalize`, because the spend authorization signatures do not commit
/// to the proof.
pub fn tx_demo_create(fvk_hex: &str, amount: u64, note_value: u64, pool: &str) -> R<String> {
    let fvk = parse_fvk(fvk_hex)?;
    let ironwood = match pool {
        "ironwood" => true,
        "orchard" => false,
        _ => return Err("pool must be ironwood or orchard".into()),
    };
    let version = if ironwood {
        orchard::bundle::BundleVersion::ironwood_v3()
    } else {
        orchard::bundle::BundleVersion::orchard_v2()
    };
    // 1. Someone pays the wallet; the wallet finds the note with its IVK.
    let note = {
        let mut b = orchard::builder::Builder::new(
            orchard::builder::BundleType::DEFAULT,
            version,
            version.default_flags(),
            orchard::Anchor::empty_tree(),
        )
        .map_err(e("builder"))?;
        b.add_output(
            None,
            fvk.address_at(0u32, Scope::External),
            orchard::value::NoteValue::from_raw(note_value),
            Memo::Empty.encode().into_bytes(),
        )
        .map_err(e("output"))?;
        let (bundle, meta) = b.build::<i64>(rng()).map_err(e("build"))?.ok_or("empty")?;
        let action = bundle.actions().get(meta.output_action_index(0).unwrap()).unwrap();
        let ivk = fvk.to_ivk(Scope::External).prepare();
        let found = if ironwood {
            try_note_decryption(
                &orchard::note_encryption::IronwoodDomain::for_action(action),
                &ivk,
                action,
            )
        } else {
            try_note_decryption(
                &orchard::note_encryption::OrchardDomain::for_action(action),
                &ivk,
                action,
            )
        };
        found.ok_or("wallet IVK could not decrypt the incoming note")?.0
    };
    // 2. One-leaf note commitment tree.
    let (anchor, path) = {
        let cmx: orchard::note::ExtractedNoteCommitment = note.commitment().into();
        let leaf = MerkleHashOrchard::from_cmx(&cmx);
        let mut tree =
            ShardTree::<_, 32, 16>::new(MemoryShardStore::<MerkleHashOrchard, u32>::empty(), 100);
        tree.append(leaf, Retention::Marked).map_err(e("tree"))?;
        tree.checkpoint(9_999_999).map_err(e("tree"))?;
        let p = tree
            .witness_at_checkpoint_depth(0.into(), 0)
            .map_err(e("witness"))?
            .ok_or("no witness")?;
        let a = p.root(leaf);
        (orchard::Anchor::from(a), orchard::tree::MerklePath::from(p))
    };
    // 3. Pay a third party, change back to the wallet's internal address.
    let fee = 10_000u64;
    let change = note_value
        .checked_sub(amount + fee)
        .ok_or("note value too small for amount + 10000 zat fee")?;
    let payee = FullViewingKey::from(&random_sk()).address_at(0u32, Scope::External);
    let mut builder = Builder::new(
        regtest(ironwood),
        10_000_000.into(),
        BuildConfig::Standard {
            sapling_anchor: None,
            orchard_anchor: (!ironwood).then_some(anchor),
            ironwood_anchor: ironwood.then_some(anchor),
            orchard_padding: BundlePadding::DEFAULT,
            ironwood_padding: BundlePadding::DEFAULT,
        },
    );
    let az = Zatoshis::from_u64(amount).map_err(e("amount"))?;
    let cz = Zatoshis::from_u64(change).map_err(e("change"))?;
    let eo = Some(fvk.to_ovk(Scope::External));
    let io = Some(fvk.to_ovk(Scope::Internal));
    let ca = fvk.address_at(0u32, Scope::Internal);
    let r = if ironwood {
        builder
            .add_ironwood_spend::<zip317::FeeRule>(fvk.clone(), note, path)
            .and_then(|_| builder.add_ironwood_output::<zip317::FeeRule>(eo, payee, az, MemoBytes::empty()))
            .and_then(|_| builder.add_ironwood_output::<zip317::FeeRule>(io, ca, cz, MemoBytes::empty()))
    } else {
        builder
            .add_orchard_spend::<zip317::FeeRule>(fvk.clone(), note, path)
            .and_then(|_| builder.add_orchard_output::<zip317::FeeRule>(eo, payee, az, MemoBytes::empty()))
            .and_then(|_| builder.add_orchard_output::<zip317::FeeRule>(io, ca, cz, MemoBytes::empty()))
    };
    r.map_err(e("builder"))?;
    let PcztResult { pczt_parts, .. } = builder
        .build_for_pczt(rng(), &zip317::FeeRule::standard())
        .map_err(e("build_for_pczt"))?;
    let pczt = Creator::build_from_parts(pczt_parts).ok_or("creator failed")?;
    let pczt = IoFinalizer::new(pczt).finalize_io(rng()).map_err(e("io finalizer"))?;
    Ok(json!({
        "pczt": pczt_to_b64(pczt)?,
        "pool": pool,
        "amount": amount, "change": change, "fee": fee, "note_value": note_value,
    })
    .to_string())
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
    let change = fvk.address_at(0u32, Scope::Internal);
    let ext = fvk.address_at(0u32, Scope::External);
    let mut pending = vec![];
    let mut lines = vec![];
    for &pool in pools {
        let mut found = vec![];
        let mut ls = vec![];
        let check = |b: &orchard::pczt::Bundle| -> Result<(), OrchardError<Custom>> {
            for (i, a) in b.actions().iter().enumerate() {
                a.verify_cv_net()?;
                let s = a.spend();
                if s.spend_auth_sig().is_none() {
                    let alpha = s
                        .alpha()
                        .ok_or_else(|| OrchardError::Custom(Custom(format!("action {i}: no alpha"))))?;
                    s.verify_rk(Some(fvk))?;
                    s.verify_nullifier(Some(fvk))?;
                    a.output().verify_note_commitment(s)?;
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
                let who = match o.recipient() {
                    Some(x) if *x == change => "change (back to this wallet)".to_string(),
                    Some(x) if *x == ext => "this wallet".to_string(),
                    Some(_) => o.user_address().clone().unwrap_or_else(|| "external recipient".into()),
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
/// if the coordinator's package disagrees with it.
pub fn sign_share(
    pczt: &str,
    fvk: &str,
    package: &str,
    nonces: &str,
    my_commitments: &str,
    key_package: &str,
    id: u16,
) -> R<String> {
    let (spends, _, h, _) = inspect_inner(&pczt_from_b64(pczt)?, &parse_fvk(fvk)?)?;
    let pkg: Value = from_json(package, "package")?;
    ensure(pkg["sighash"].as_str() == Some(&hex::encode(h)), "coordinator's sighash does not match the transaction")?;
    let pkg_spends: Vec<PendingSpend> = from_value(&pkg["spends"], "spends")?;
    ensure(pkg_spends == spends, "coordinator's spends or randomizers do not match the transaction")?;
    let sps: Vec<SigningPackage> = from_value(&pkg["signing_packages"], "signing packages")?;
    ensure(sps.len() == spends.len(), "package count mismatch")?;
    let nonces: Vec<SigningNonces> = from_json(nonces, "nonces")?;
    let mine: Vec<SigningCommitments> = from_json(my_commitments, "commitments")?;
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
#[wasm_bindgen(js_name = walletVerify)]
pub fn js_wallet_verify(wallet: &str, pkp: &str) -> Result<String, JsError> {
    js(wallet_verify(wallet, pkp))
}
#[wasm_bindgen(js_name = txDemoCreate)]
pub fn js_tx_demo_create(fvk: &str, amount: f64, note_value: f64, pool: &str) -> Result<String, JsError> {
    js(tx_demo_create(fvk, amount as u64, note_value as u64, pool))
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
    pczt: &str, fvk: &str, package: &str, nonces: &str, mine: &str, kp: &str, id: u16,
) -> Result<String, JsError> {
    js(sign_share(pczt, fvk, package, nonces, mine, kp, id))
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

// ─────────────────────────── Tests ───────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn v(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }

    /// Full 2-of-3 flow through the exact JSON API the web page uses,
    /// including encrypted round-2 transport.
    fn full_flow(pool: &str, signers: &[u16]) {
        let (n, t) = (3u16, 2u16);
        let boxes: Vec<Value> = (0..n).map(|_| v(&box_keypair())).collect();
        let r1: Vec<Value> = (1..=n).map(|i| v(&dkg_part1(i, n, t).unwrap())).collect();
        let others = |me: u16, f: &dyn Fn(u16) -> Value| -> String {
            let mut m = serde_json::Map::new();
            for j in 1..=n {
                if j != me {
                    m.insert(j.to_string(), f(j));
                }
            }
            Value::Object(m).to_string()
        };
        let r2: Vec<Value> = (1..=n)
            .map(|i| {
                let all = others(i, &|j| r1[j as usize - 1]["package"].clone());
                v(&dkg_part2(&r1[i as usize - 1]["secret"].to_string(), &all).unwrap())
            })
            .collect();
        // sealed transport
        let mut sealed = BTreeMap::new();
        for i in 1..=n {
            for (to, pkg) in r2[i as usize - 1]["outgoing"].as_object().unwrap() {
                let to: u16 = to.parse().unwrap();
                let ctx = format!("g:{i}->{to}");
                let c = box_seal(boxes[i as usize - 1]["sk"].as_str().unwrap(),
                    boxes[to as usize - 1]["pk"].as_str().unwrap(), &ctx, &pkg.to_string()).unwrap();
                sealed.insert((i, to), c);
            }
        }
        let fin: Vec<Value> = (1..=n)
            .map(|i| {
                let all1 = others(i, &|j| r1[j as usize - 1]["package"].clone());
                let all2 = others(i, &|j| {
                    let ctx = format!("g:{j}->{i}");
                    v(&box_open(boxes[i as usize - 1]["sk"].as_str().unwrap(),
                        boxes[j as usize - 1]["pk"].as_str().unwrap(), &ctx, &sealed[&(j, i)]).unwrap())
                });
                v(&dkg_part3(&r2[i as usize - 1]["secret"].to_string(), &all1, &all2).unwrap())
            })
            .collect();
        assert!(fin.iter().all(|f| f["group_key"] == fin[0]["group_key"]));
        let pkp = fin[0]["public_key_package"].to_string();
        let w = v(&wallet_create(&pkp, "testnet").unwrap());
        for f in &fin {
            wallet_verify(&w.to_string(), &f["public_key_package"].to_string()).unwrap();
        }
        let fvk = w["orchard_fvk"].as_str().unwrap();
        let tx = v(&tx_demo_create(fvk, 100_000, 1_000_000, pool).unwrap());
        let pczt = tx["pczt"].as_str().unwrap();
        let ins = v(&inspect(pczt, fvk).unwrap());
        assert_eq!(ins["spends"].as_array().unwrap().len(), 1);

        let mut comm = serde_json::Map::new();
        let mut secrets = BTreeMap::new();
        for &i in signers {
            let c = v(&sign_commit(pczt, fvk, &fin[i as usize - 1]["key_package"].to_string()).unwrap());
            comm.insert(i.to_string(), c["commitments"].clone());
            secrets.insert(i, c);
        }
        let pkg = sign_package(pczt, fvk, &Value::Object(comm).to_string(), t).unwrap();
        let mut shares = serde_json::Map::new();
        for &i in signers {
            let s = sign_share(pczt, fvk, &pkg, &secrets[&i]["nonces"].to_string(),
                &secrets[&i]["commitments"].to_string(),
                &fin[i as usize - 1]["key_package"].to_string(), i).unwrap();
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

    #[test]
    fn ironwood_2_of_3() {
        full_flow("ironwood", &[1, 3]);
    }

    #[test]
    fn orchard_2_of_3() {
        full_flow("orchard", &[2, 3]);
    }

    #[test]
    fn testnet_activates_nu7_with_v6_transactions() {
        use zcash_protocol::consensus::BranchId;
        let branch = BranchId::for_height(&Network::TestNetwork, BlockHeight::from_u32(4_465_026));
        assert_eq!(u32::from(branch), 0x7719_0AD9);
        assert_eq!(TxVersion::suggested_for_branch(branch), TxVersion::V6);
    }

    #[test]
    fn box_rejects_wrong_route() {
        let a = v(&box_keypair());
        let b = v(&box_keypair());
        let c = box_seal(a["sk"].as_str().unwrap(), b["pk"].as_str().unwrap(), "g:1->2", "hi").unwrap();
        assert_eq!(box_open(b["sk"].as_str().unwrap(), a["pk"].as_str().unwrap(), "g:1->2", &c).unwrap(), "hi");
        assert!(box_open(b["sk"].as_str().unwrap(), a["pk"].as_str().unwrap(), "g:1->3", &c).is_err());
    }
}
