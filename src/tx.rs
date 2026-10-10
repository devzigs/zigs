//! Transaction construction.
//!
//! The FROST group never needs to build transactions itself: any wallet that
//! knows the group's UFVK can create a PCZT (Partially Created Zcash
//! Transaction, the PSBT equivalent) and hand it to the group to sign. That is
//! the path `tx-import` supports.
//!
//! `tx-demo-create` exists only because this sandbox has no access to a
//! Zcash node. It fabricates a note owned by the wallet, places it in a
//! one-leaf note commitment tree, and builds a fully proven spend on a local
//! regtest network (Ironwood/NU6.3 v6 transaction by default, or legacy
//! Orchard v5 with `--pool orchard`). Everything about it is
//! real (Halo2 proof, value balance, note encryption, sighash) except that
//! the anchor does not exist on any public chain.

use eyre::{eyre, Result};
use incrementalmerkletree::Retention;
use orchard::{
    keys::{FullViewingKey, Scope, SpendingKey},
    tree::MerkleHashOrchard,
};
use pczt::{
    roles::{creator::Creator, io_finalizer::IoFinalizer, prover::Prover},
    Pczt,
};
use rand::rngs::OsRng;
use shardtree::{store::memory::MemoryShardStore, ShardTree};
use zcash_note_encryption::try_note_decryption;
use zcash_primitives::transaction::{
    builder::{BuildConfig, Builder, PcztResult},
    fees::zip317,
};
use zcash_protocol::{
    consensus::BlockHeight,
    local_consensus::LocalNetwork,
    memo::{Memo, MemoBytes},
    value::Zatoshis,
};

use crate::{store::Store, wallet};

#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum DemoPool {
    /// Ironwood (NU6.3+, v6 transaction). The only pool that accepts new funds on mainnet today.
    Ironwood,
    /// Legacy Orchard (NU5..NU6.2, v5 transaction). Mainnet Orchard is withdraw-only since NU6.3.
    Orchard,
}

/// Local regtest parameters. With `nu6_3` the builder produces a v6
/// transaction with an Ironwood bundle; without it, v5 with Orchard.
pub fn regtest(nu6_3: bool) -> LocalNetwork {
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
    }
}

/// Create a note paying `value` to the wallet, the way a sender would, and
/// recover it with the wallet's incoming viewing key. This also demonstrates
/// that the group's shared viewing key detects incoming funds.
fn fabricate_incoming_note(fvk: &FullViewingKey, value: u64, pool: DemoPool) -> Result<orchard::Note> {
    let version = match pool {
        DemoPool::Ironwood => orchard::bundle::BundleVersion::ironwood_v3(),
        DemoPool::Orchard => orchard::bundle::BundleVersion::orchard_v2(),
    };
    let recipient = fvk.address_at(0u32, Scope::External);
    let mut b = orchard::builder::Builder::new(
        orchard::builder::BundleType::DEFAULT,
        version,
        version.default_flags(),
        orchard::Anchor::empty_tree(),
    )
    .map_err(|e| eyre!("{e:?}"))?;
    b.add_output(
        None,
        recipient,
        orchard::value::NoteValue::from_raw(value),
        Memo::Empty.encode().into_bytes(),
    )
    .map_err(|e| eyre!("{e:?}"))?;
    let (bundle, meta) = b
        .build::<i64>(&mut OsRng)
        .map_err(|e| eyre!("{e:?}"))?
        .ok_or_else(|| eyre!("empty bundle"))?;
    let action = bundle
        .actions()
        .get(meta.output_action_index(0).unwrap())
        .unwrap();
    let ivk = fvk.to_ivk(Scope::External).prepare();
    let found = match pool {
        DemoPool::Ironwood => try_note_decryption(
            &orchard::note_encryption::IronwoodDomain::for_action(action),
            &ivk,
            action,
        ),
        DemoPool::Orchard => try_note_decryption(
            &orchard::note_encryption::OrchardDomain::for_action(action),
            &ivk,
            action,
        ),
    };
    let (note, _, _) =
        found.ok_or_else(|| eyre!("wallet IVK failed to decrypt the incoming note"))?;
    Ok(note)
}

pub fn demo_create(
    store: &Store,
    session: &str,
    amount: u64,
    note_value: u64,
    pool: DemoPool,
) -> Result<()> {
    let ironwood = pool == DemoPool::Ironwood;
    let (_info, fvk) = wallet::load(store)?;

    let note = fabricate_incoming_note(&fvk, note_value, pool)?;
    println!(
        "   wallet received a {} zat {pool:?} note (decrypted with the shared IVK)",
        note.value().inner()
    );

    // One-leaf note commitment tree.
    let (anchor, merkle_path) = {
        let cmx: orchard::note::ExtractedNoteCommitment = note.commitment().into();
        let leaf = MerkleHashOrchard::from_cmx(&cmx);
        let mut tree =
            ShardTree::<_, 32, 16>::new(MemoryShardStore::<MerkleHashOrchard, u32>::empty(), 100);
        tree.append(leaf, Retention::Marked)
            .map_err(|e| eyre!("{e:?}"))?;
        tree.checkpoint(9_999_999).map_err(|e| eyre!("{e:?}"))?;
        let path = tree
            .witness_at_checkpoint_depth(0.into(), 0)
            .map_err(|e| eyre!("{e:?}"))?
            .ok_or_else(|| eyre!("no witness"))?;
        let anchor = path.root(leaf);
        (orchard::Anchor::from(anchor), orchard::tree::MerklePath::from(path))
    };

    // An unrelated third party to pay.
    let payee = {
        let sk = loop {
            let mut b = [0u8; 32];
            rand::RngCore::fill_bytes(&mut OsRng, &mut b);
            let sk = SpendingKey::from_bytes(b);
            if bool::from(sk.is_some()) {
                break sk.unwrap();
            }
        };
        FullViewingKey::from(&sk).address_at(0u32, Scope::External)
    };

    // ZIP 317: 1 spend, 2 outputs => 2 Orchard actions => 2 * 5000 zat.
    let fee = 10_000u64;
    let change = note_value
        .checked_sub(amount + fee)
        .ok_or_else(|| eyre!("note value too small for amount + fee"))?;

    let mut builder = Builder::new(
        regtest(ironwood),
        10_000_000.into(),
        BuildConfig::Standard {
            sapling_anchor: None,
            orchard_anchor: (!ironwood).then_some(anchor),
            ironwood_anchor: ironwood.then_some(anchor),
            orchard_pool_bundle_type: orchard::builder::BundleType::DEFAULT,
        },
    );
    let amount_z = Zatoshis::from_u64(amount).map_err(|e| eyre!("{e:?}"))?;
    let change_z = Zatoshis::from_u64(change).map_err(|e| eyre!("{e:?}"))?;
    let ext_ovk = Some(fvk.to_ovk(Scope::External));
    let int_ovk = Some(fvk.to_ovk(Scope::Internal));
    let change_addr = fvk.address_at(0u32, Scope::Internal);
    let r = if ironwood {
        builder
            .add_ironwood_spend::<zip317::FeeRule>(fvk.clone(), note, merkle_path)
            .and_then(|_| builder.add_ironwood_output::<zip317::FeeRule>(ext_ovk, payee, amount_z, MemoBytes::empty()))
            .and_then(|_| builder.add_ironwood_output::<zip317::FeeRule>(int_ovk, change_addr, change_z, MemoBytes::empty()))
    } else {
        builder
            .add_orchard_spend::<zip317::FeeRule>(fvk.clone(), note, merkle_path)
            .and_then(|_| builder.add_orchard_output::<zip317::FeeRule>(ext_ovk, payee, amount_z, MemoBytes::empty()))
            .and_then(|_| builder.add_orchard_output::<zip317::FeeRule>(int_ovk, change_addr, change_z, MemoBytes::empty()))
    };
    r.map_err(|e| eyre!("{e:?}"))?;
    let PcztResult { pczt_parts, .. } = builder
        .build_for_pczt(OsRng, &zip317::FeeRule::standard())
        .map_err(|e| eyre!("build_for_pczt: {e:?}"))?;

    let pczt = Creator::build_from_parts(pczt_parts).ok_or_else(|| eyre!("creator failed"))?;
    let pczt = IoFinalizer::new(pczt)
        .finalize_io()
        .map_err(|e| eyre!("io finalizer: {e:?}"))?;
    println!("   building Halo2 proving key and proof (takes a few seconds)...");
    let pczt = if ironwood {
        let pk = orchard::circuit::ProvingKey::build(
            orchard::circuit::OrchardCircuitVersion::PostNu6_3,
        );
        Prover::new(pczt)
            .create_ironwood_proof(&pk)
            .map_err(|e| eyre!("prover: {e:?}"))?
            .finish()
    } else {
        let pk = orchard::circuit::ProvingKey::build(
            orchard::circuit::OrchardCircuitVersion::FixedPostNu6_2,
        );
        Prover::new(pczt)
            .create_orchard_proof(&pk)
            .map_err(|e| eyre!("prover: {e:?}"))?
            .finish()
    };

    let bytes = pczt.serialize().map_err(|e| eyre!("{e:?}"))?;
    store.write_bytes(&format!("sessions/{session}/unsigned.pczt"), &bytes)?;
    println!(
        "   unsigned PCZT ({} bytes): pay {amount} zat, change {change} zat, fee {fee} zat",
        bytes.len()
    );
    Ok(())
}

pub fn import(store: &Store, session: &str, path: &str) -> Result<()> {
    let bytes = std::fs::read(path)?;
    Pczt::parse(&bytes).map_err(|e| eyre!("not a valid PCZT: {e:?}"))?;
    store.write_bytes(&format!("sessions/{session}/unsigned.pczt"), &bytes)?;
    println!("imported PCZT into session {session}");
    Ok(())
}
