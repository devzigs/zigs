//! The pinned asset ids. A compact asset id sits in the ciphertext of every output, so the id of a
//! mint must not come from the device or from the proposer. The table is read from the SPL asset
//! registry of the Devnet pool (`tools/fetch_assets.mjs`, `vectors/devnet-assets.json`, finalized
//! slot 510,959,509). A mint that the registry gained after that slot is unknown and fails closed.

use crate::bytes::Reader;
use crate::consts::Key;

/// The compact id of SOL (`SOL_ASSET_ID`, `sdk-libs/transaction/src/asset.rs`). SOL has no
/// registry record, and its mint is the all-zero key.
pub const SOL_ASSET_ID: u64 = 1;
pub const SOL_MINT: Key = [0; 32];

/// The records of `assets_devnet.bin`: 32 mint bytes, then the id as `u64` LE
/// (`tools/gen_assets.py`).
const DEVNET_RECORDS: &[u8] = include_bytes!("assets_devnet.bin");

/// The mint and the compact id of every SPL asset, SOL implicit.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AssetTable(Vec<(Key, u64)>);

/// Why a table entry is refused, or `None` if it is sound next to the entries before it.
fn entry_error(have: &[(Key, u64)], mint: &Key, id: u64) -> Option<String> {
    if *mint == SOL_MINT {
        return Some("the SOL mint has no registry entry".to_string());
    }
    if id == 0 {
        return Some("asset id 0 is not an id".to_string());
    }
    if id == SOL_ASSET_ID {
        return Some(format!("asset id {id} is the id of SOL"));
    }
    if have.iter().any(|(_, known)| *known == id) {
        return Some(format!("asset id {id} is used twice"));
    }
    have.iter()
        .any(|(known, _)| known == mint)
        .then(|| format!("a mint has two ids, the second is {id}"))
}

impl AssetTable {
    /// Builds a table. It refuses the SOL mint, id 0, the id of SOL, and a repeated id or mint.
    pub fn new(entries: impl IntoIterator<Item = (Key, u64)>) -> Result<Self, String> {
        let mut table = Vec::new();
        for (mint, id) in entries {
            if let Some(why) = entry_error(&table, &mint, id) {
                return Err(format!("asset table: {why}"));
            }
            table.push((mint, id));
        }
        Ok(Self(table))
    }

    /// The Devnet table of the wasm.
    pub fn devnet() -> Result<Self, String> {
        let mut reader = Reader::new(DEVNET_RECORDS);
        let mut entries = Vec::new();
        while !reader.is_empty() {
            let short = |_| "asset table: a record is cut short".to_string();
            entries.push((reader.array().map_err(short)?, reader.u64().map_err(short)?));
        }
        Self::new(entries)
    }

    /// The compact id of a mint. SOL has the fixed id; any other mint needs a table entry.
    pub fn asset_id(&self, mint: &Key) -> Option<u64> {
        if *mint == SOL_MINT {
            return Some(SOL_ASSET_ID);
        }
        self.0
            .iter()
            .find(|(known, _)| known == mint)
            .map(|(_, id)| *id)
    }

    pub fn entries(&self) -> &[(Key, u64)] {
        &self.0
    }
}
