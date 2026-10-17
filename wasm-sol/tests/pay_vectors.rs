//! Payments of a PDA identity that the TS SDK built (`vectors/pay`, from
//! `solspike/tools/payment_vectors.mjs`): the Rust recompute of `private_tx_hash` and of the
//! commitment must equal the `privateTxHash` and the `messageHash` of the SDK, and the approval of
//! the payment must hold every rule. A vector with a dummy output pins the zero hash of a dummy.

mod common;

use common::ts::{self, payee_address, plan_of, role_of, text, transact_of, u64_of, Vector};
use common::{unhex_n, EXPIRY, NOW};
use p3_check::approve::Device;
use p3_check::beta::approve_payment;
use p3_check::consts::{Key, MULTISIG_DEVNET};
use p3_check::intent::{Intent, Pay, Program};
use p3_check::pay::{Account, Seen};
use p3_check::pins::Pins;
use p3_check::plan::{Proposal, Role};
use p3_check::program::{commitment, external_data_hash, proposal_address, KIND_PROPOSAL};
use p3_check::snapshot::{InputUtxo, Snapshot};
use p3_check::template::body_of;

fn vectors() -> Vec<Vector> {
    let all = ts::vectors_in("pay");
    assert!(all.len() >= 3, "{} payment vectors", all.len());
    all
}

fn key(v: &Vector, path: &[&str]) -> Key {
    let mut value = &v.json;
    for step in path {
        value = &value[*step];
    }
    unhex_n(value.as_str().unwrap())
}

/// The transact data of the vector with the private_tx_hash of the SDK.
fn transact(v: &Vector) -> p3_check::transact::Transact {
    let mut tx = transact_of(v);
    tx.private_tx_hash = key(v, &["privateTxHash"]);
    tx
}

fn pins(v: &Vector) -> Pins {
    let g = &v.json["group"];
    Pins::devnet(
        key(v, &["groupKey"]),
        [0x0d; 32],
        unhex_n(&text(g, "viewingPk")),
        unhex_n(&text(g, "payer")),
        unhex_n(&text(g, "nullifierPk")),
    )
    .unwrap()
}

fn snapshot(v: &Vector) -> Snapshot {
    let g = &v.json["group"];
    Snapshot {
        nullifier_secret: unhex_n(&text(g, "nullifierSecret")),
        viewing_sk: unhex_n(&text(g, "viewingSk")),
        fee_per_nullifier: 0,
        used_salts: Vec::new(),
        inputs: v.json["inputs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|i| InputUtxo {
                mint: [0; 32],
                amount: u64_of(i, "amount"),
                blinding: unhex_n(&text(i, "blinding")),
            })
            .collect(),
    }
}

fn proposal(v: &Vector) -> Proposal {
    let tx = transact(v);
    let paid = v.json["outputs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|o| role_of(o) == Role::Payee)
        .unwrap();
    let pay = Pay {
        expiry: EXPIRY,
        inputs: tx.inputs.len() as u8,
        outputs: tx.outputs.len() as u8,
        payee: payee_address(v),
        mint: [0; 32],
        amount: u64_of(paid, "amount"),
    };
    Proposal {
        intent: Intent::Program(Program::Approve { pay }),
        plan: plan_of(v),
        transact: tx.write().unwrap(),
    }
}

#[test]
fn the_commitment_of_each_vector_equals_the_message_hash_of_the_sdk() {
    for v in vectors() {
        let tx = transact(&v);
        assert_eq!(u64_of(&v.json, "expiry"), EXPIRY, "{}", v.name);
        let external = external_data_hash(&tx).unwrap();
        assert_eq!(
            external,
            key(&v, &["externalDataHash"]),
            "{}: external",
            v.name
        );
        let got = commitment(&tx.private_tx_hash, &tx).unwrap();
        assert_eq!(got, key(&v, &["messageHash"]), "{}: commitment", v.name);
    }
}

#[test]
fn the_approval_recomputes_the_private_tx_hash_of_the_sdk_and_accepts_the_payment() {
    let mut dummies = 0;
    for v in vectors() {
        let pins = pins(&v);
        let snapshot = snapshot(&v);
        let device = Device {
            pins: &pins,
            snapshot: &snapshot,
            now: NOW,
        };
        let commitment = key(&v, &["messageHash"]);
        let body = body_of(&pins.for_pda().unwrap(), commitment, EXPIRY, pins.payer);
        let (_, bump) =
            proposal_address(&pins.multisig, &commitment, &body.write().unwrap()).unwrap();
        let seen = Seen {
            account: Some(Account {
                owner: MULTISIG_DEVNET,
                data: [&[KIND_PROPOSAL, bump][..], &body.write().unwrap()].concat(),
            }),
            approved: Vec::new(),
        };
        let got = approve_payment(&proposal(&v), &device, &seen);
        let payment = got.unwrap_or_else(|r| panic!("{}: {:?}", v.name, r.violations));
        assert_eq!(payment.commitment, commitment, "{}", v.name);
        dummies += plan_of(&v)
            .outputs
            .iter()
            .filter(|o| o.role == Role::Dummy)
            .count();
    }
    assert!(dummies > 0, "a vector has a dummy output");
}
