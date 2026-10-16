//! Loads the vectors that `tools/ts_vectors.mjs` and `tools/ts_vectors_edge.mjs` wrote (the TS
//! SDK at the pinned commit) and turns each one into the inputs of the checker: the snapshot, the
//! pins, the plan, the `transact` data and the intent. Shared by `tests/ts_vectors.rs`,
//! `tests/ts_edge.rs` and `examples/gen_vectors.rs`.
#![allow(dead_code)]

use std::path::PathBuf;

use p3_check::address::Address;
use p3_check::consts::Key;
use p3_check::intent::{Intent, Spend};
use p3_check::pins::Pins;
use p3_check::plan::{OutPlan, Plan, Role};
use p3_check::snapshot::{InputUtxo, Snapshot};
use p3_check::transact::{Circuit, Input, Leg, Output, OwnerTag, Transact, TreeContext};
use serde_json::Value;

use super::{b58, field, unhex, unhex_n, EXPIRY, NONCE};

/// The JSON files of `vectors/<sub>`: `ts` (fixed keys) or `ts2` (edge amounts, random salts).
pub fn files(sub: &str) -> Vec<PathBuf> {
    let dir = format!("{}/vectors/{sub}", env!("CARGO_MANIFEST_DIR"));
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("vectors/{sub}: run the tools/ts_vectors*.mjs script: {e}"))
        .map(|e| e.expect("entry").path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .collect();
    files.sort();
    files
}

pub fn text(v: &Value, key: &str) -> String {
    v[key]
        .as_str()
        .unwrap_or_else(|| panic!("{key}"))
        .to_string()
}

/// A mint as 32 bytes: the SDK writes the base58 text, which the Rust tests read back with
/// `solana_address`.
pub fn mint_of(text: &str) -> Key {
    if text == "11111111111111111111111111111111" {
        return [0; 32];
    }
    b58(text)
}

pub struct Vector {
    pub name: String,
    pub json: Value,
}

pub fn vectors() -> Vec<Vector> {
    vectors_in("ts")
}

pub fn vectors_in(sub: &str) -> Vec<Vector> {
    files(sub)
        .into_iter()
        .map(|path| {
            let json: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
            Vector {
                name: text(&json, "name"),
                json,
            }
        })
        .collect()
}

pub fn u64_of(v: &Value, key: &str) -> u64 {
    text(v, key).parse().unwrap_or_else(|_| panic!("{key}"))
}

/// The snapshot of the group and its pins. The pin keys are the ones that the TS SDK derived, and
/// the payer is the sponsor that built the vector: the owner tag of the change is inline.
pub fn secrets(v: &Vector) -> (Snapshot, Pins) {
    let g = &v.json["group"];
    let snapshot = Snapshot {
        nullifier_secret: unhex_n(&text(g, "nullifierSecret")),
        viewing_sk: unhex_n(&text(g, "viewingSk")),
        fee_per_nullifier: 0,
        used_salts: Vec::new(),
        inputs: v.json["inputs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|i| InputUtxo {
                mint: mint_of(&text(i, "mint")),
                amount: u64_of(i, "amount"),
                blinding: unhex_n(&text(i, "blinding")),
            })
            .collect(),
    };
    let pins = Pins::devnet(
        unhex_n(&text(g, "key")),
        unhex_n(&text(g, "nullifierPk")),
        unhex_n(&text(g, "viewingPk")),
        unhex_n(&text(g, "payer")),
    );
    (snapshot, pins.expect("pins"))
}

/// The `owner_hash` of the group that the TS SDK computed.
pub fn ts_owner_hash(v: &Vector) -> Key {
    unhex_n(&text(&v.json["group"], "ownerHash"))
}

pub fn tag_of(v: &Value) -> OwnerTag {
    let tag = &v["ownerTag"];
    match tag["kind"].as_str().unwrap() {
        "account" => OwnerTag::Account(tag["index"].as_u64().unwrap() as u8),
        _ => OwnerTag::Inline(unhex_n(&text(tag, "value"))),
    }
}

pub fn role_of(v: &Value) -> Role {
    match v["role"].as_str().unwrap() {
        "change" => Role::Change,
        "payee" => Role::Payee,
        _ => Role::Dummy,
    }
}

pub fn payee_address(v: &Vector) -> Address {
    let bytes = unhex(&text(&v.json["payee"], "address"));
    super::real::address_of(&bytes)
}

pub fn plan_of(v: &Vector) -> Plan {
    let outputs: Vec<OutPlan> = v.json["outputs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| OutPlan {
            role: role_of(o),
            mint: if role_of(o) == Role::Dummy {
                [0; 32]
            } else {
                mint_of(&text(o, "mint"))
            },
            amount: u64_of(o, "amount"),
            blinding: unhex_n(&text(o, "blinding")),
        })
        .collect();
    Plan {
        blinding_seed: unhex_n(&text(&v.json, "blindingSeed")),
        outputs,
    }
}

pub fn transact_of(v: &Vector) -> Transact {
    let outputs: Vec<Output> = v.json["outputs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| Output {
            utxo_hash: unhex_n(&text(o, "utxoHash")),
            owner_tag: tag_of(o),
            data: Some(unhex(&text(o, "data"))),
        })
        .collect();
    let inputs: Vec<Input> = v.json["inputs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| Input {
            nullifier: unhex_n(&text(i, "nullifier")),
            tree_index: 0,
        })
        .collect();
    let withdraw = v.json["withdraw"]
        .as_str()
        .map(|a| a.parse::<u64>().unwrap());
    Transact {
        expiry: EXPIRY,
        tx_viewing_pk: unhex_n(&text(&v.json, "txViewingPk")),
        salt: unhex_n(&text(&v.json, "salt")),
        legs: withdraw.map(Leg::SolWithdrawal).into_iter().collect(),
        data_hash: None,
        ring_data_hash: None,
        circuit: Circuit {
            inputs: inputs.len() as u8,
            outputs: outputs.len() as u8,
            slots: 3,
        },
        outputs,
        messages: Vec::new(),
        private_tx_hash: field(77),
        proof: [0; 192],
        inputs,
        tree_contexts: vec![TreeContext {
            utxo_root_index: 0,
            nullifier_root_index: 0,
        }],
    }
}

pub fn intent_of(v: &Vector, tx: &Transact) -> Intent {
    let spend = Spend {
        nonce: NONCE,
        expiry: EXPIRY,
        inputs: tx.inputs.len() as u8,
        outputs: tx.outputs.len() as u8,
    };
    match v.json["withdraw"].as_str() {
        Some(amount) => Intent::Withdrawal {
            spend,
            recipient: [0x33; 32],
            amount: amount.parse().unwrap(),
        },
        None => {
            let paid = v.json["outputs"]
                .as_array()
                .unwrap()
                .iter()
                .find(|o| role_of(o) == Role::Payee)
                .expect("a transfer has a payee output");
            Intent::Transfer {
                spend,
                payee: payee_address(v),
                mint: mint_of(&text(paid, "mint")),
                amount: u64_of(paid, "amount"),
            }
        }
    }
}

/// Asserts that every output blinding of the vector is the one that the circuit derives from the
/// first nullifier and the root seed that the TS SDK recorded (`prepared.blindingSeed`).
pub fn assert_blindings_are_derived(v: &Vector) {
    use p3_check::hashes::{output_blinding, output_seed};
    let first: Key = unhex_n(&text(&v.json["inputs"][0], "nullifier"));
    let root: Key = unhex_n(&text(&v.json, "blindingSeed"));
    let seed = output_seed(&first, &root).expect("TXOS");
    for (slot, out) in v.json["outputs"].as_array().unwrap().iter().enumerate() {
        let want: Key = unhex_n(&text(out, "blinding"));
        let got = output_blinding(&first, &seed, slot as u32).expect("TXOB");
        assert!(got == want, "{} output {slot}: blinding", v.name);
    }
}
