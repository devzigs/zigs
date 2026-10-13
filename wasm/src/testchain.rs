//! Test only: compact blocks for a wallet, so that scanning, spends, memos and reorganisations
//! run offline. A block holds transactions with Ironwood actions that pay real addresses.

use orchard::{
    keys::{FullViewingKey, Scope, SpendingKey},
    note::{Nullifier, RandomSeed, Rho},
    note_encryption::{IronwoodDomain, IronwoodNoteEncryption, COMPACT_NOTE_SIZE},
    value::NoteValue,
    Note, NoteVersion,
};
use rand::{rngs::OsRng, RngCore};
use zcash_client_backend::proto::compact_formats::{
    ChainMetadata, CompactBlock, CompactOrchardAction, CompactTx,
};
use zcash_note_encryption::Domain;
use zcash_primitives::transaction::Transaction;

pub(crate) fn fvk(seed: u8) -> FullViewingKey {
    let sk = Option::<SpendingKey>::from(SpendingKey::from_bytes([seed; 32])).expect("valid key");
    FullViewingKey::from(&sk)
}

/// A memo field that holds `text`.
pub(crate) fn memo_of(text: &str) -> [u8; 512] {
    let mut field = [0u8; 512];
    field[..text.len()].copy_from_slice(text.as_bytes());
    field
}

/// The field of "no memo".
pub(crate) fn no_memo() -> [u8; 512] {
    let mut field = [0u8; 512];
    field[0] = 0xF6;
    field
}

/// A fresh nullifier: 31 random bytes below the field size.
fn fresh_nullifier() -> Nullifier {
    let mut b = [0u8; 32];
    OsRng.fill_bytes(&mut b[..31]);
    Option::from(Nullifier::from_bytes(&b)).expect("below the field size")
}

/// A transaction with one Ironwood action. It reveals `nf` (a fresh one if None) and pays `value`
/// to `to` with `memo`. Returns the transaction and the note.
pub(crate) fn pays(
    to: orchard::Address,
    value: u64,
    memo: [u8; 512],
    nf: Option<Nullifier>,
) -> (CompactTx, Note) {
    let nf = nf.unwrap_or_else(fresh_nullifier);
    let rho = Option::from(Rho::from_bytes(&nf.to_bytes())).expect("rho from a nullifier");
    let rseed = loop {
        let mut bytes = [0u8; 32];
        OsRng.fill_bytes(&mut bytes);
        if let Some(r) = Option::from(RandomSeed::from_bytes(bytes, &rho)) {
            break r;
        }
    };
    let note = Option::from(Note::from_parts(
        to,
        NoteValue::from_raw(value),
        rho,
        rseed,
        NoteVersion::V3,
    ))
    .expect("a valid note");
    let enc = IronwoodNoteEncryption::new(None, note, memo);
    let action = CompactOrchardAction {
        nullifier: nf.to_bytes().to_vec(),
        cmx: super::memo::commitment_bytes(&note).to_vec(),
        ephemeral_key: IronwoodDomain::epk_bytes(enc.epk()).0.to_vec(),
        ciphertext: enc.encrypt_note_plaintext().0[..COMPACT_NOTE_SIZE].to_vec(),
    };
    let mut txid = vec![0u8; 32];
    OsRng.fill_bytes(&mut txid);
    let tx = CompactTx { txid, ironwood_actions: vec![action], ..Default::default() };
    (tx, note)
}

/// The compact form of every Ironwood action of a full transaction.
pub(crate) fn compact_of(tx: &Transaction) -> CompactTx {
    let bundle = tx.ironwood_bundle().expect("an Ironwood bundle");
    let actions = bundle.actions().iter().map(|a| CompactOrchardAction {
        nullifier: a.nullifier().to_bytes().to_vec(),
        cmx: a.cmx().to_bytes().to_vec(),
        ephemeral_key: a.encrypted_note().epk_bytes.to_vec(),
        ciphertext: a.encrypted_note().enc_ciphertext.0[..COMPACT_NOTE_SIZE].to_vec(),
    });
    CompactTx {
        txid: <[u8; 32]>::from(tx.txid()).to_vec(),
        ironwood_actions: actions.collect(),
        ..Default::default()
    }
}

/// A chain of compact blocks from height `first`, with consistent hashes and tree sizes.
#[derive(Clone)]
pub(crate) struct Chain {
    pub(crate) first: u32,
    pub(crate) blocks: Vec<CompactBlock>,
}

impl Chain {
    pub(crate) fn new(first: u32) -> Chain {
        Chain { first, blocks: vec![] }
    }

    pub(crate) fn last_height(&self) -> u32 {
        self.first + self.blocks.len() as u32 - 1
    }

    pub(crate) fn at(&self, height: u32) -> Option<&CompactBlock> {
        self.blocks.get(height.checked_sub(self.first)? as usize)
    }

    /// Adds a block. `salt` gives blocks of another branch other hashes.
    pub(crate) fn push(&mut self, txs: Vec<CompactTx>, salt: u8) {
        let height = self.first + self.blocks.len() as u32;
        let prev = self.blocks.last();
        let prev_hash = prev.map_or(vec![0u8; 32], |b| b.hash.clone());
        let meta = prev.and_then(|b| b.chain_metadata.as_ref());
        let size = meta.map_or(0, |m| m.ironwood_commitment_tree_size);
        let added: usize = txs.iter().map(|t| t.ironwood_actions.len()).sum();
        let hash = blake2b_simd::Params::new()
            .hash_length(32)
            .to_state()
            .update(&height.to_le_bytes())
            .update(&[salt])
            .update(&prev_hash)
            .finalize();
        self.blocks.push(CompactBlock {
            height: u64::from(height),
            hash: hash.as_bytes().to_vec(),
            prev_hash,
            vtx: txs,
            chain_metadata: Some(ChainMetadata {
                sapling_commitment_tree_size: 0,
                orchard_commitment_tree_size: 0,
                ironwood_commitment_tree_size: size + added as u32,
            }),
            ..Default::default()
        });
    }

    /// The same chain up to and including `height`.
    pub(crate) fn fork(&self, height: u32) -> Chain {
        let keep = (height - self.first + 1) as usize;
        Chain { first: self.first, blocks: self.blocks[..keep].to_vec() }
    }

    /// `n` empty blocks.
    pub(crate) fn grow(&mut self, n: usize, salt: u8) {
        for _ in 0..n {
            self.push(vec![], salt);
        }
    }
}

/// The external address of a key.
pub(crate) fn external(fvk: &FullViewingKey) -> orchard::Address {
    fvk.address_at(0u32, Scope::External)
}
