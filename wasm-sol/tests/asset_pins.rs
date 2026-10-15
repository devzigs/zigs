//! The pinned asset table (`src/assets_devnet.bin`) against the registry that
//! `tools/fetch_assets.mjs` read from the Devnet pool (`vectors/devnet-assets.json`), and the
//! refusals of `AssetTable::new`: id 0, the id of SOL, a repeated id, a repeated mint and the SOL
//! mint. The compact id sits in the ciphertext of every output, so no id may come from the
//! device or from the proposer.

mod common;

use common::b58;
use common::fixture::{MINT, MINT_ID};
use p3_check::assets::{AssetTable, SOL_ASSET_ID, SOL_MINT};
use p3_check::consts::Key;

fn registry() -> serde_json::Value {
    let path = format!("{}/vectors/devnet-assets.json", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_slice(&std::fs::read(path).expect("run tools/fetch_assets.mjs")).unwrap()
}

fn entries(json: &serde_json::Value) -> Vec<(Key, u64)> {
    json["registry"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            let id = e["assetId"].as_str().unwrap().parse().unwrap();
            (b58(e["mint"].as_str().unwrap()), id)
        })
        .collect()
}

#[test]
fn the_devnet_table_is_the_registry_of_the_pool() {
    let json = registry();
    assert_eq!(json["pool"], "sppU489D7A4U1exNo1oeMGZtLEofq3a6o2fR7UeoWB6");
    let want = entries(&json);
    assert_eq!(
        want.len(),
        84,
        "84 mints at finalized slot {}",
        json["slot"]
    );
    let table = AssetTable::devnet().unwrap();
    assert!(
        table.entries() == want.as_slice(),
        "assets_devnet.bin is not the registry"
    );
    // The counter names the next free id: the ids are 2 up to the one before it.
    let next: u64 = json["nextAssetId"][0].as_str().unwrap().parse().unwrap();
    let ids: Vec<u64> = want.iter().map(|(_, id)| *id).collect();
    assert_eq!(ids, (2..next).collect::<Vec<u64>>());
}

#[test]
fn sol_has_the_fixed_id_and_a_pinned_mint_has_its_registry_id() {
    let table = AssetTable::devnet().unwrap();
    assert_eq!(table.asset_id(&SOL_MINT), Some(SOL_ASSET_ID));
    assert_eq!(SOL_ASSET_ID, 1);
    assert_eq!(
        table.asset_id(&MINT),
        Some(MINT_ID),
        "the mint of the fixtures"
    );
    assert!(
        MINT == b58("ETzu3EpvF7Jqz5ZWng4QANZDvogjgcveRmztm2mb8Xss"),
        "fixture mint"
    );
    let seven = b58("5d2KjyaU2mfRuUqiJWV8MzCzzfkSt2fg81zS9QTdXjQj");
    assert_eq!(
        table.asset_id(&seven),
        Some(7),
        "the mint of tools/ts_vectors_edge.mjs"
    );
}

#[test]
fn a_mint_that_is_not_in_the_table_has_no_id() {
    let table = AssetTable::devnet().unwrap();
    assert_eq!(table.asset_id(&[0x5b; 32]), None);
    assert_eq!(table.asset_id(&[1; 32]), None);
}

#[test]
fn the_table_refuses_asset_id_zero() {
    assert!(AssetTable::new([([7; 32], 0)]).is_err());
}

#[test]
fn the_table_refuses_the_id_of_sol_for_a_mint() {
    assert!(AssetTable::new([([7; 32], SOL_ASSET_ID)]).is_err());
}

#[test]
fn the_table_refuses_a_repeated_id() {
    assert!(AssetTable::new([([7; 32], 2), ([8; 32], 2)]).is_err());
}

#[test]
fn the_table_refuses_a_mint_with_two_ids() {
    assert!(AssetTable::new([([7; 32], 2), ([7; 32], 3)]).is_err());
}

#[test]
fn the_table_refuses_the_sol_mint() {
    assert!(AssetTable::new([(SOL_MINT, 2)]).is_err());
}

#[test]
fn a_sound_table_is_built_and_keeps_its_order() {
    let table = AssetTable::new([([7; 32], 2), ([8; 32], 5)]).unwrap();
    assert_eq!(table.entries(), [([7; 32], 2), ([8; 32], 5)]);
    assert_eq!(table.asset_id(&[8; 32]), Some(5));
}
