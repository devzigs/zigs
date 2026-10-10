//! Threshold signing of a PCZT with re-randomized FROST (ZIP 312).
//!
//! Each real Orchard spend in a transaction is authorized by a RedPallas
//! signature under a *randomized* key `rk = ak + [alpha]G`, where `alpha` is
//! a fresh per-spend randomizer chosen by the transaction builder. This
//! keeps spends unlinkable to `ak`. Re-randomized FROST lets t-of-n holders
//! of shares of `ask` produce exactly that signature: each signer adds the
//! randomizer during signing, and the aggregate verifies under `rk`.
//!
//! Flow (one FROST session per spend, all sessions run in parallel):
//!   1. `commit`    participant: verify the PCZT, publish nonce commitments
//!   2. `package`   coordinator: choose signers, build signing packages
//!   3. `share`     participant: re-verify everything, publish shares
//!   4. `aggregate` coordinator: aggregate, attach, extract final tx

use std::collections::BTreeMap;

use eyre::{bail, ensure, eyre, Result};
use group::ff::PrimeField;
use orchard::{
    keys::{FullViewingKey, Scope},
    primitives::redpallas::{self, SpendAuth},
};
use pczt::{
    roles::{
        low_level_signer::{OrchardParseError, Signer as LowLevelSigner},
        spend_finalizer::SpendFinalizer,
        tx_extractor::TransactionExtractor,
        verifier::{OrchardError, Verifier},
    },
    Pczt,
};
use rand::rngs::OsRng;
use reddsa::frost::redpallas::{
    self as frost,
    keys::{KeyPackage, PublicKeyPackage},
    round1::{SigningCommitments, SigningNonces},
    round2::SignatureShare,
    RandomizedParams, Randomizer, SigningPackage,
};
use serde::{Deserialize, Serialize};
use zcash_primitives::transaction::{
    sighash::SignableInput, sighash_v5::v5_signature_hash, sighash_v6::v6_signature_hash,
    txid::TxIdDigester, TxVersion,
};

use crate::{
    dkg::{self, ident},
    store::Store,
    wallet,
};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pool {
    Orchard,
    Ironwood,
}

/// A spend that still needs a spend authorization signature.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct PendingSpend {
    pub pool: Pool,
    pub action_index: usize,
    /// The randomizer alpha, little-endian scalar encoding, hex.
    pub alpha: String,
    /// The randomized key rk that the signature must verify under, hex.
    pub rk: String,
}

#[derive(Serialize, Deserialize)]
pub struct SessionPackage {
    pub sighash: String,
    pub signers: Vec<u16>,
    pub spends: Vec<PendingSpend>,
    pub signing_packages: Vec<SigningPackage>,
}

fn sess(session: &str, rel: &str) -> String {
    format!("sessions/{session}/{rel}")
}

fn load_pczt(store: &Store, session: &str) -> Result<Pczt> {
    let bytes = store.read_bytes(&sess(session, "unsigned.pczt"))?;
    Pczt::parse(&bytes).map_err(|e| eyre!("PCZT parse: {e:?}"))
}

fn pools_for(version: TxVersion) -> &'static [Pool] {
    match version {
        TxVersion::V6 => &[Pool::Orchard, Pool::Ironwood],
        _ => &[Pool::Orchard],
    }
}

/// Compute the shielded sighash every spend authorization signature signs.
pub fn sighash(pczt: &Pczt) -> Result<(TxVersion, [u8; 32])> {
    let tx_data = pczt
        .clone()
        .into_effects()
        .map_err(|e| eyre!("cannot compute transaction effects: {e:?}"))?;
    let parts = tx_data.digest(TxIdDigester);
    let version = tx_data.version();
    let h = match version {
        TxVersion::V6 => v6_signature_hash(&tx_data, &SignableInput::Shielded, &parts),
        TxVersion::V5 => v5_signature_hash(&tx_data, &SignableInput::Shielded, &parts),
        v => bail!("unsupported transaction version {v:?}"),
    };
    let h: [u8; 32] = h.as_ref().try_into().map_err(|_| eyre!("bad sighash len"))?;
    Ok((version, h))
}

#[derive(Debug)]
struct Custom(#[allow(dead_code)] String);

/// Full verification of the PCZT from the point of view of a participant
/// holding the wallet FVK. Returns the spends we must sign and a summary.
///
/// This is the participant's defence against a malicious coordinator: it
/// re-derives everything from the PCZT bytes instead of trusting the
/// coordinator's description of the transaction.
fn inspect(pczt: &Pczt, fvk: &FullViewingKey) -> Result<(Vec<PendingSpend>, Vec<String>)> {
    let (version, _) = sighash(pczt)?;
    let mut pending = vec![];
    let mut summary = vec![];
    let change_addr = fvk.address_at(0u32, Scope::Internal);
    let ext_addr = fvk.address_at(0u32, Scope::External);

    for &pool in pools_for(version) {
        let mut found = vec![];
        let mut lines = vec![];
        let check = |bundle: &orchard::pczt::Bundle| -> Result<(), OrchardError<Custom>> {
            for (i, action) in bundle.actions().iter().enumerate() {
                action.verify_cv_net()?;
                let spend = action.spend();
                if spend.spend_auth_sig().is_none() {
                    let alpha = spend
                        .alpha()
                        .ok_or_else(|| OrchardError::Custom(Custom(format!("action {i}: no alpha"))))?;
                    // rk must be our ak randomized by alpha, the nullifier and note
                    // commitment must belong to our FVK. Otherwise we would be
                    // co-signing someone else's spend, or a spend that is not what
                    // it claims to be.
                    spend.verify_rk(Some(fvk))?;
                    spend.verify_nullifier(Some(fvk))?;
                    action.output().verify_note_commitment(spend)?;
                    let v = spend.value().map(|v| v.inner()).unwrap_or(0);
                    lines.push(format!("  spend  action {i:>2}: {v:>12} zat from this wallet"));
                    found.push(PendingSpend {
                        pool,
                        action_index: i,
                        alpha: hex::encode(alpha.to_repr()),
                        rk: hex::encode(<[u8; 32]>::from(spend.rk())),
                    });
                }
                let out = action.output();
                let v = out.value().map(|v| v.inner());
                let who = match out.recipient() {
                    Some(a) if *a == change_addr => "change (this wallet)".to_string(),
                    Some(a) if *a == ext_addr => "this wallet".to_string(),
                    Some(_) => out
                        .user_address()
                        .clone()
                        .unwrap_or_else(|| "EXTERNAL recipient".into()),
                    None => "UNKNOWN recipient (redacted)".into(),
                };
                if v != Some(0) {
                    lines.push(format!(
                        "  output action {i:>2}: {:>12} zat to {who}",
                        v.map(|v| v.to_string()).unwrap_or("??".into())
                    ));
                }
            }
            Ok(())
        };
        let v = Verifier::new(pczt.clone());
        let r = match pool {
            Pool::Orchard => v.with_orchard(check),
            Pool::Ironwood => v.with_ironwood(check),
        };
        r.map_err(|e| eyre!("PCZT verification failed ({pool:?}): {e:?}"))?;
        pending.extend(found);
        summary.extend(lines);
    }
    ensure!(!pending.is_empty(), "nothing for this wallet to sign");
    Ok((pending, summary))
}

pub fn commit(store: &Store, session: &str, id: u16) -> Result<()> {
    let (_, fvk) = wallet::load(store)?;
    wallet::verify_as_participant(store, id)?;
    let pczt = load_pczt(store, session)?;
    let (spends, summary) = inspect(&pczt, &fvk)?;
    let (_, h) = sighash(&pczt)?;
    if std::env::var("QUIET").is_err() {
        println!("   participant {id} reviews the transaction (sighash {}):", hex::encode(h));
        for l in &summary {
            println!("   {l}");
        }
    }

    let key = dkg::load_key_package(store, id)?;
    let mut nonces = vec![];
    let mut commitments = vec![];
    for _ in &spends {
        let (n, c) = frost::round1::commit(key.signing_share(), &mut OsRng);
        nonces.push(n);
        commitments.push(c);
    }
    // Nonces are secret and single-use: they stay with the participant.
    store.write_json(
        &format!("participants/{id}/sessions/{session}/nonces.json"),
        &nonces,
    )?;
    store.write_json(&sess(session, &format!("commitments/{id}.json")), &commitments)?;
    println!("   participant {id}: {} nonce commitment(s) published", spends.len());
    Ok(())
}

pub fn package(store: &Store, session: &str, signers: &[u16]) -> Result<()> {
    let cfg: dkg::GroupConfig = store.read_json("public/config.json")?;
    ensure!(
        signers.len() >= cfg.min_signers as usize,
        "need at least {} signers, got {}",
        cfg.min_signers,
        signers.len()
    );
    let (_, fvk) = wallet::load(store)?;
    let pczt = load_pczt(store, session)?;
    let (spends, _) = inspect(&pczt, &fvk)?;
    let (_, h) = sighash(&pczt)?;

    let mut per_signer: BTreeMap<u16, Vec<SigningCommitments>> = BTreeMap::new();
    for id in signers {
        let c: Vec<SigningCommitments> = store
            .read_json(&sess(session, &format!("commitments/{id}.json")))
            .map_err(|_| eyre!("participant {id} has not committed"))?;
        ensure!(c.len() == spends.len(), "participant {id} committed for wrong spend count");
        per_signer.insert(*id, c);
    }

    let mut packages = vec![];
    for k in 0..spends.len() {
        let mut m = BTreeMap::new();
        for (id, cs) in &per_signer {
            m.insert(ident(*id)?, cs[k]);
        }
        // Every spend signs the same message: the transaction's shielded sighash.
        packages.push(SigningPackage::new(m, &h));
    }
    let pkg = SessionPackage {
        sighash: hex::encode(h),
        signers: signers.to_vec(),
        spends,
        signing_packages: packages,
    };
    store.write_json(&sess(session, "package.json"), &pkg)?;
    println!(
        "   coordinator: signing package for {} spend(s), signers {signers:?}",
        pkg.spends.len()
    );
    Ok(())
}

fn randomizer_of(spend: &PendingSpend) -> Result<Randomizer> {
    let bytes = hex::decode(&spend.alpha)?;
    Randomizer::deserialize(&bytes).map_err(|e| eyre!("bad randomizer: {e:?}"))
}

pub fn share(store: &Store, session: &str, id: u16) -> Result<()> {
    let (_, fvk) = wallet::load(store)?;
    let pczt = load_pczt(store, session)?;
    let pkg: SessionPackage = store.read_json(&sess(session, "package.json"))?;
    ensure!(pkg.signers.contains(&id), "participant {id} was not selected to sign");

    // Do not trust the coordinator: recompute everything from the PCZT.
    let (spends, _) = inspect(&pczt, &fvk)?;
    let (_, h) = sighash(&pczt)?;
    ensure!(pkg.sighash == hex::encode(h), "coordinator's sighash does not match the PCZT");
    ensure!(pkg.spends == spends, "coordinator's spend list / randomizers do not match the PCZT");
    ensure!(pkg.signing_packages.len() == spends.len(), "package count mismatch");

    let nonces_path = format!("participants/{id}/sessions/{session}/nonces.json");
    let nonces: Vec<SigningNonces> = store.read_json(&nonces_path)?;
    let my_commitments: Vec<SigningCommitments> =
        store.read_json(&sess(session, &format!("commitments/{id}.json")))?;
    let key: KeyPackage = dkg::load_key_package(store, id)?;

    let mut shares = vec![];
    for (k, sp) in pkg.signing_packages.iter().enumerate() {
        ensure!(sp.message() == &h, "signing package {k} signs the wrong message");
        let mine = sp
            .signing_commitment(&ident(id)?)
            .ok_or_else(|| eyre!("my commitment missing from package {k}"))?;
        ensure!(mine == my_commitments[k], "coordinator swapped my commitment in package {k}");
        let r = randomizer_of(&spends[k])?;
        shares.push(frost::round2::sign(sp, &nonces[k], &key, r)?);
    }
    // Burn nonces immediately: reusing them would leak the key share.
    store.remove(&nonces_path)?;
    store.write_json(&sess(session, &format!("shares/{id}.json")), &shares)?;
    println!("   participant {id}: {} signature share(s) published", shares.len());
    Ok(())
}

#[derive(Debug)]
enum SignErr {
    #[allow(dead_code)]
    Parse(OrchardParseError),
    #[allow(dead_code)]
    Apply(orchard::pczt::SignerError),
}
impl From<OrchardParseError> for SignErr {
    fn from(e: OrchardParseError) -> Self {
        SignErr::Parse(e)
    }
}

pub fn aggregate(store: &Store, session: &str) -> Result<()> {
    let pubkeys: PublicKeyPackage = dkg::load_public_key_package(store)?;
    let pczt = load_pczt(store, session)?;
    let pkg: SessionPackage = store.read_json(&sess(session, "package.json"))?;
    let (_, h) = sighash(&pczt)?;

    let mut per_signer: BTreeMap<u16, Vec<SignatureShare>> = BTreeMap::new();
    for id in &pkg.signers {
        let s: Vec<SignatureShare> = store
            .read_json(&sess(session, &format!("shares/{id}.json")))
            .map_err(|_| eyre!("participant {id} has not sent shares"))?;
        per_signer.insert(*id, s);
    }

    let mut sigs: Vec<(Pool, usize, [u8; 64])> = vec![];
    for (k, spend) in pkg.spends.iter().enumerate() {
        let mut shares = BTreeMap::new();
        for (id, s) in &per_signer {
            shares.insert(ident(*id)?, s[k]);
        }
        let r = randomizer_of(spend)?;
        let params = RandomizedParams::from_randomizer(pubkeys.verifying_key(), r);
        // With cheater detection, a bad share is attributed to its sender.
        let sig = frost::aggregate(&pkg.signing_packages[k], &shares, &pubkeys, &params)
            .map_err(|e| eyre!("aggregation failed for spend {k}: {e:?}"))?;
        let bytes: [u8; 64] = sig
            .serialize()?
            .try_into()
            .map_err(|_| eyre!("signature is not 64 bytes"))?;

        // Independent check with Orchard's own RedPallas implementation.
        let rk_bytes: [u8; 32] = hex::decode(&spend.rk)?.try_into().unwrap();
        let rk = redpallas::VerificationKey::<SpendAuth>::try_from(rk_bytes)
            .map_err(|_| eyre!("bad rk"))?;
        rk.verify(&h, &redpallas::Signature::<SpendAuth>::from(bytes))
            .map_err(|_| eyre!("aggregate signature does not verify under rk"))?;
        println!(
            "   spend {k} (action {}): RedPallas signature verifies under rk {}…",
            spend.action_index,
            &spend.rk[..16]
        );
        sigs.push((spend.pool, spend.action_index, bytes));
    }

    // Attach signatures. `apply_signature` re-verifies each one against rk.
    let mut signer = LowLevelSigner::new(pczt);
    for pool in [Pool::Orchard, Pool::Ironwood] {
        let mine: Vec<_> = sigs.iter().filter(|s| s.0 == pool).cloned().collect();
        if mine.is_empty() {
            continue;
        }
        let apply = |_: &Pczt, bundle: &mut orchard::pczt::Bundle, _: &mut u8| {
            for (_, idx, sig) in &mine {
                bundle.actions_mut()[*idx]
                    .apply_signature(h, redpallas::Signature::<SpendAuth>::from(*sig))
                    .map_err(SignErr::Apply)?;
            }
            Ok::<(), SignErr>(())
        };
        signer = match pool {
            Pool::Orchard => signer.sign_orchard_with(apply),
            Pool::Ironwood => signer.sign_ironwood_with(apply),
        }
        .map_err(|e| eyre!("applying signatures: {e:?}"))?;
    }
    let signed = signer.finish();
    store.write_bytes(&sess(session, "signed.pczt"), &signed.clone().serialize().map_err(|e| eyre!("{e:?}"))?)?;

    let finalized = SpendFinalizer::new(signed)
        .finalize_spends()
        .map_err(|e| eyre!("spend finalizer: {e:?}"))?;
    println!("   extracting transaction (verifies Halo2 proof, all signatures, binding sig)...");
    let tx = TransactionExtractor::new(finalized)
        .extract()
        .map_err(|e| eyre!("transaction extraction failed: {e:?}"))?;
    let mut raw = vec![];
    tx.write(&mut raw)?;
    let txid = tx.txid().to_string();
    store.write_bytes(&sess(session, "tx.hex"), hex::encode(&raw).as_bytes())?;
    println!("   final transaction: {} bytes, txid {txid}", raw.len());
    println!("   written to {}", store.path(&sess(session, "tx.hex")).display());
    Ok(())
}
