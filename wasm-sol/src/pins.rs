//! The pinned constants of one wallet on one cluster: program ids, trees, the nonce account,
//! the registry record, the asset table and the three public values of the group: its key,
//! `nullifier_pk` and `viewing_pk` (the `soldone` document, ZOLANA.md 4.1). Derived addresses
//! and the group `owner_hash` are computed here from those pins, never taken from the device.

use crate::assets::AssetTable;
use crate::bytes::{short_hex, Reader};
use crate::consts::{
    Key, COMPUTE_BUDGET_PROGRAM, NONCE_SEED, POOL_DEVNET, RECENT_BLOCKHASHES, REGISTRY_DEVNET,
    RENT_SYSVAR, SEED_NULLIFIER, SEED_SOL_INTERFACE, SEED_SOL_INTERFACE_INDEX, SEED_TREE,
    SEED_USER_RECORD, SYSTEM_PROGRAM,
};
use crate::hashes::owner_hash;
use crate::pda::{create_with_seed, find_program_address};

/// Rent of the nonce account on Devnet (P2 result, ZOLANA.md 6.3).
pub const NONCE_RENT_DEVNET: u64 = 1_056_640;

/// The wire form of the pins at the wasm entry: group key, `nullifier_pk`, `viewing_pk`.
pub const WIRE_LEN: usize = 32 + 32 + 33;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pins {
    pub group: Key,
    pub nullifier_pk: Key,
    pub viewing_pk: [u8; 33],
    /// The `owner_hash` of the group: Poseidon over the group key and the pinned `nullifier_pk`.
    /// `devnet` computes it. `approve` computes it again from the two pins and refuses a pin that
    /// differs, so the value never comes from the device snapshot.
    pub group_owner_hash: Key,
    pub pool: Key,
    pub registry: Key,
    pub input_tree: Key,
    pub output_tree: Key,
    pub sol_interface: Key,
    pub nonce_account: Key,
    pub user_record: Key,
    pub nonce_rent: u64,
    /// The compact asset id of every SPL mint that the wasm knows.
    pub assets: AssetTable,
}

fn derive(seeds: &[&[u8]], program: &Key, what: &str) -> Result<Key, String> {
    find_program_address(seeds, program)
        .map(|(address, _)| address)
        .ok_or_else(|| format!("no program address for {what}"))
}

impl Pins {
    /// The Devnet pins of a wallet. Tree 0 is the only tree that the spike uses.
    pub fn devnet(group: Key, nullifier_pk: Key, viewing_pk: [u8; 33]) -> Result<Self, String> {
        let tree = derive(&[SEED_TREE, &0u16.to_le_bytes()], &POOL_DEVNET, "tree 0")?;
        let sol_interface = derive(
            &[SEED_SOL_INTERFACE, SEED_SOL_INTERFACE_INDEX],
            &POOL_DEVNET,
            "the SOL interface",
        )?;
        Ok(Self {
            group,
            nullifier_pk,
            viewing_pk,
            group_owner_hash: owner_hash(&group, &nullifier_pk)?,
            pool: POOL_DEVNET,
            registry: REGISTRY_DEVNET,
            input_tree: tree,
            output_tree: tree,
            sol_interface,
            nonce_account: create_with_seed(&group, NONCE_SEED, &SYSTEM_PROGRAM),
            user_record: derive(&[SEED_USER_RECORD, &group], &REGISTRY_DEVNET, "the record")?,
            nonce_rent: NONCE_RENT_DEVNET,
            assets: AssetTable::devnet()?,
        })
    }

    /// Reads the wire form of the wasm entry. The whole input must be used.
    pub fn decode(bytes: &[u8]) -> Result<Self, String> {
        let short = |_| format!("pins: need {WIRE_LEN} bytes: group key, nullifier_pk, viewing_pk");
        let mut r = Reader::new(bytes);
        let (group, nullifier_pk, viewing_pk) = (
            r.array().map_err(short)?,
            r.array().map_err(short)?,
            r.array().map_err(short)?,
        );
        if !r.is_empty() {
            return Err(format!("pins: {} bytes, need {WIRE_LEN}", bytes.len()));
        }
        Self::devnet(group, nullifier_pk, viewing_pk)
    }

    /// The wire form of the wasm entry.
    pub fn wire(&self) -> Vec<u8> {
        [
            &self.group[..],
            &self.nullifier_pk[..],
            &self.viewing_pk[..],
        ]
        .concat()
    }

    /// The nullifier PDA of one input: `["nullifier", tree, nullifier]` under the pool.
    pub fn nullifier_pda(&self, tree: &Key, nullifier: &Key) -> Result<Key, String> {
        derive(
            &[SEED_NULLIFIER, tree, nullifier],
            &self.pool,
            "a nullifier",
        )
    }

    /// A short name of a key for messages: its role if it is pinned, else its first bytes.
    pub fn label(&self, key: &Key) -> String {
        let named = [
            (&self.group, "group"),
            (&self.nonce_account, "nonce account"),
            (&self.pool, "pool program"),
            (&self.registry, "registry program"),
            (&self.input_tree, "tree"),
            (&self.sol_interface, "SOL interface"),
            (&self.user_record, "registry record"),
            (&SYSTEM_PROGRAM, "System program"),
            (&RECENT_BLOCKHASHES, "RecentBlockhashes sysvar"),
            (&RENT_SYSVAR, "Rent sysvar"),
            (&COMPUTE_BUDGET_PROGRAM, "ComputeBudget program"),
        ];
        match named.iter().find(|(known, _)| *known == key) {
            Some((_, name)) => (*name).to_string(),
            None => short_hex(key),
        }
    }
}
