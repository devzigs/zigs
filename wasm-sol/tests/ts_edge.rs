//! Ported from the verifier of P3c (`p3c-verify/tests/v_ts2.rs`). The vectors of
//! `tools/ts_vectors_edge.mjs` come from the TS SDK with other keys than `tools/ts_vectors.mjs`,
//! random salts, u64 edge amounts and three inputs. `approve` is built from the TS fields (hash,
//! nullifier, blob, transaction key, blinding), so an accept means that the Rust code reproduces
//! them. The same inputs go through the wasm entry.

mod common;

use common::ts::{self, vectors_in};
use common::NOW;
use p3_check::approve::{approve, Device};
use p3_check::plan::Proposal;
use p3_check::template::compile;
use p3_check::v1;
use p3_check::wasm::check_message;

#[test]
fn the_edge_vectors_are_approved_by_the_rust_api_and_the_wasm_entry() {
    let all = vectors_in("ts2");
    assert!(all.len() >= 5);
    for v in all {
        let (snapshot, pins) = ts::secrets(&v);
        let tx = ts::transact_of(&v);
        let intent = ts::intent_of(&v, &tx);
        let plan = ts::plan_of(&v);
        let bytes = v1::write(&compile(&intent, &pins, Some(&tx)).unwrap()).unwrap();
        let device = Device {
            pins: &pins,
            snapshot: &snapshot,
            now: NOW,
        };
        let rust = approve(&bytes, &intent, &plan, &device);
        let rules = rust.as_ref().err().map(|r| r.violations.clone());
        assert!(rust.is_ok(), "{}: {rules:?}", v.name);
        let proposal = Proposal {
            intent,
            plan,
            transact: Vec::new(),
        };
        let answer = check_message(
            &bytes,
            &proposal.encode().unwrap(),
            &pins.wire(),
            &snapshot.encode().unwrap(),
            NOW,
        );
        assert!(common::only_policy(&answer), "{}: {answer}", v.name);
    }
}

#[test]
fn the_rust_code_reproduces_every_edge_blinding_from_the_root_seed() {
    let all = vectors_in("ts2");
    assert!(all.len() >= 5);
    all.iter().for_each(ts::assert_blindings_are_derived);
}

#[test]
fn the_asset_ids_of_the_edge_vectors_are_the_pinned_ones() {
    for v in vectors_in("ts2") {
        let mint: p3_check::consts::Key = common::unhex_n(&ts::text(&v.json["mint"], "address"));
        let id = ts::u64_of(&v.json["mint"], "assetId");
        let table = p3_check::assets::AssetTable::devnet().unwrap();
        assert_eq!(table.asset_id(&mint), Some(id), "{}", v.name);
    }
}
