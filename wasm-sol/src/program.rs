//! The approvals program of the group (ZOLANA.md 7.2), as the seats see it: the addresses that
//! it derives, the proposal body, the approval digest, the Ed25519 instruction that carries the
//! approval, and the commitment that it recomputes from the `transact` data.
//!
//! The program is version 2 on Devnet (`MULTISIG_DEVNET`). Its proposal address is
//! `["proposed_transaction", group key, commitment]`; `proposal_address` is the one place that
//! names those seeds.

use sha2::{Digest, Sha256};
use zolana_hasher::primitives::right_align;

use crate::bytes::Reader;
use crate::consts::{
    Key, APPROVAL_DOMAIN, DEVNET_GENESIS, MULTISIG_DEVNET, SEED_CANCEL, SEED_OWNER, SEED_PROPOSAL,
};
use crate::hashes::poseidon;
use crate::pda::find_program_address;
use crate::transact::Transact;

/// The kind byte of a stored proposal: the account data is `[1, bump] || body`.
pub const KIND_PROPOSAL: u8 = 1;
/// The program accepts at most this many abort authorities.
pub const MAX_AUTHORITIES: usize = 4;
/// The most inputs of one `execute` with one input tree: the program forwards at most 24 accounts
/// to the pool (ZOLANA.md 7.2, review R7).
pub const MAX_EXECUTE_INPUTS: usize = 18;
const BODY_FIXED: usize = 32 + 32 + 8 + 32 + 1;

/// The length of the canonical Ed25519 instruction data: head, key, signature, digest.
pub const APPROVAL_IX_LEN: usize = 16 + 32 + 64 + 32;

/// ASCII `"TXPB"`: the private transaction blinding (`DOMAIN_PRIVATE_TX_BLINDING_V1` of the SDK).
const DOMAIN_PRIVATE_TX_BLINDING: u32 = 0x5458_5042;

fn derive(seeds: &[&[u8]], what: &str) -> Result<(Key, u8), String> {
    find_program_address(seeds, &MULTISIG_DEVNET).ok_or_else(|| format!("no address for {what}"))
}

/// The PDA that owns the shielded funds of the group: `["multisig", group key]`.
pub fn owner_pda(group: &Key) -> Result<Key, String> {
    derive(&[SEED_OWNER, group], "the owner").map(|(key, _)| key)
}

/// The proposal account of a commitment and its bump (version 2 seeds).
pub fn proposal_address(group: &Key, commitment: &Key) -> Result<(Key, u8), String> {
    derive(&[SEED_PROPOSAL, group, commitment], "the proposal")
}

/// The record that a cancel of `proposal` leaves: `["cancelled_transaction", proposal]`.
pub fn cancellation_address(proposal: &Key) -> Result<Key, String> {
    derive(&[SEED_CANCEL, proposal], "the cancellation").map(|(key, _)| key)
}

/// The body of a proposal: the `create` data and the bytes that the approval signs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Body {
    pub commitment: Key,
    pub group: Key,
    pub expiry: u64,
    pub rent_recipient: Key,
    pub authorities: Vec<Key>,
}

impl Body {
    /// `commitment || group || expiry (u64 LE) || rent recipient || count || authorities`.
    pub fn write(&self) -> Result<Vec<u8>, String> {
        if self.authorities.len() > MAX_AUTHORITIES {
            return Err(format!("more than {MAX_AUTHORITIES} abort authorities"));
        }
        let mut out = self.commitment.to_vec();
        out.extend_from_slice(&self.group);
        out.extend_from_slice(&self.expiry.to_le_bytes());
        out.extend_from_slice(&self.rent_recipient);
        out.push(u8::try_from(self.authorities.len()).map_err(|_| "too many authorities")?);
        self.authorities
            .iter()
            .for_each(|key| out.extend_from_slice(key));
        Ok(out)
    }

    /// Reads a body with the length rule of the program: the whole input is the body.
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        let short = |_| "the body ends inside a field".to_string();
        let mut r = Reader::new(bytes);
        let (commitment, group) = (r.array().map_err(short)?, r.array().map_err(short)?);
        let expiry = r.u64().map_err(short)?;
        let rent_recipient = r.array().map_err(short)?;
        let count = usize::from(r.u8().map_err(short)?);
        if count > MAX_AUTHORITIES || bytes.len() != BODY_FIXED + 32 * count {
            return Err(format!(
                "a body of {} bytes with {count} authorities",
                bytes.len()
            ));
        }
        let authorities = (0..count)
            .map(|_| r.array().map_err(short))
            .collect::<Result<_, _>>()?;
        Ok(Self {
            commitment,
            group,
            expiry,
            rent_recipient,
            authorities,
        })
    }
}

/// `SHA-256("Zigs_SolApproval_v1" || Devnet genesis || program id || proposal || body)`: the
/// 32 bytes that the group key signs. They can never parse as a Solana message.
pub fn approval_digest(proposal: &Key, body: &[u8]) -> [u8; 32] {
    Sha256::new()
        .chain_update(APPROVAL_DOMAIN)
        .chain_update(DEVNET_GENESIS)
        .chain_update(MULTISIG_DEVNET)
        .chain_update(proposal)
        .chain_update(body)
        .finalize()
        .into()
}

/// The data of the Ed25519 instruction that `execute` requires: one signature, every blob in
/// this instruction (index `u16::MAX`), at the offsets 48 (signature), 16 (key) and 112 (digest).
pub fn approval_ix_data(group: &Key, signature: &[u8; 64], digest: &[u8; 32]) -> Vec<u8> {
    let offsets: [u16; 7] = [48, u16::MAX, 16, u16::MAX, 112, 32, u16::MAX];
    let mut out = vec![1, 0];
    offsets
        .iter()
        .for_each(|o| out.extend_from_slice(&o.to_le_bytes()));
    out.extend_from_slice(group);
    out.extend_from_slice(signature);
    out.extend_from_slice(digest);
    out
}

/// The bytes of the `transact` data before `private_tx_hash`: the tag and the external-data
/// prefix that the pool hashes.
fn external_prefix(tx: &Transact) -> Result<Vec<u8>, String> {
    let mut all = tx.write()?;
    let tail = 32 + 5 + 192 + 1 + 33 * tx.inputs.len() + 1 + 4 * tx.tree_contexts.len();
    let cut = all
        .len()
        .checked_sub(tail)
        .ok_or("the transact data is too short")?;
    all.truncate(cut);
    Ok(all)
}

/// `SHA256BE` of the pool: SHA-256 with the first byte cleared, so the value is a BN254 field.
pub fn external_data_hash(tx: &Transact) -> Result<Key, String> {
    let mut hash: Key = Sha256::digest(external_prefix(tx)?).into();
    if let Some(first) = hash.first_mut() {
        *first = 0;
    }
    Ok(hash)
}

/// `SHA-256(private_tx_hash || external_data_hash)`: the commitment of a payment (the SDK
/// `messageHash`). `private_tx_hash` is the caller's value, never read from `tx` by `approve`.
pub fn commitment(private_tx_hash: &Key, tx: &Transact) -> Result<Key, String> {
    let external = external_data_hash(tx)?;
    Ok(Sha256::new()
        .chain_update(private_tx_hash)
        .chain_update(external)
        .finalize()
        .into())
}

/// `nonZeroHashChain` of the SDK: zero values are skipped, the first non-zero value starts the
/// chain, and each later one is folded in with a Poseidon of two.
fn non_zero_chain(values: &[Key]) -> Result<Key, String> {
    let mut hash = [0u8; 32];
    for value in values.iter().filter(|value| **value != [0; 32]) {
        hash = if hash == [0; 32] {
            *value
        } else {
            poseidon(&[&hash, value])?
        };
    }
    Ok(hash)
}

/// `Poseidon(nz(inputs), nz(outputs), nz(no address nullifier), blinding)` with the blinding
/// `Poseidon("TXPB", first nullifier, blinding seed)`. A dummy slot hashes as zero.
pub fn private_tx_hash(
    inputs: &[Key],
    outputs: &[Key],
    first_nullifier: &Key,
    blinding_seed: &Key,
) -> Result<Key, String> {
    let blinding = poseidon(&[
        &right_align(&DOMAIN_PRIVATE_TX_BLINDING.to_be_bytes()),
        first_nullifier,
        &right_align(blinding_seed),
    ])?;
    poseidon(&[
        &non_zero_chain(inputs)?,
        &non_zero_chain(outputs)?,
        &[0; 32],
        &blinding,
    ])
}
