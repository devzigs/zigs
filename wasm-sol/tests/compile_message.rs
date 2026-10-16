//! `compile_message`: the template compiler as the page calls it. It takes the proposal bytes, the
//! pins and the `transact` data that the Worker cuts out of the SDK message, and gives the v1
//! message. The landed P6 messages compile back to the same message (the same instructions, keys
//! and flags; the template lists three read-only keys in another order than the SDK that built
//! the landed ones), and every message compiled from a TS SDK vector passes `check_message` with
//! `accepted`.
//! The landed P6 messages are not accepted any more: the root blinding seed of their proofs was
//! never recorded (ZOLANA.md 6.7), so the blinding rule has nothing to compare with.

mod common;

use std::collections::BTreeSet;

use common::{pins, read, ts, Facts, NOW};
use p3_check::consts::Key;
use p3_check::intent::{Intent, Spend};
use p3_check::plan::{Plan, Proposal};
use p3_check::transact;
use p3_check::v1;
use p3_check::wasm::{check_message, compile_proposal};

/// The transfer of the P6 runs, built from the landed message itself: its nonce value, the
/// expiry and the counts of its `transact` data, and key B as the payee. Returns the proposal
/// bytes and the `transact` data.
fn p6_inputs(bytes: &[u8]) -> (Vec<u8>, Vec<u8>) {
    let msg = v1::parse(bytes).expect("a v1 message");
    let data = msg
        .ixs
        .last()
        .expect("the transact instruction")
        .data
        .clone();
    let tx = transact::parse(&data).expect("transact data");
    let intent = Intent::Transfer {
        spend: Spend {
            nonce: msg.lifetime,
            expiry: tx.expiry,
            inputs: tx.circuit.inputs,
            outputs: tx.circuit.outputs,
        },
        payee: Facts::load().payee_address(),
        mint: [0; 32],
        amount: 1_000_000,
    };
    let proposal = Proposal {
        intent,
        plan: Plan::default(),
    };
    (proposal.encode().expect("proposal"), data)
}

/// One instruction with every index resolved: the program, the accounts and the data.
type Resolved = (Key, Vec<Key>, Vec<u8>);

fn resolved(msg: &v1::Message) -> Vec<Resolved> {
    let key = |at: u8| msg.keys.get(usize::from(at)).copied().expect("a key");
    msg.ixs
        .iter()
        .map(|ix| {
            (
                key(ix.program),
                ix.accounts.iter().map(|a| key(*a)).collect(),
                ix.data.clone(),
            )
        })
        .collect()
}

/// Every key with its signer and writable flags, in no order.
fn key_flags(msg: &v1::Message) -> BTreeSet<(Key, bool, bool)> {
    (0..msg.keys.len())
        .map(|i| (msg.keys[i], msg.is_signer(i), msg.is_writable(i)))
        .collect()
}

/// A landed P6 message, which the group paid and signed alone, as a sponsor would pay it: the
/// payer is the first account of the `transact` instruction, and the group key follows the
/// nullifier accounts as the owner signer (programs/shielded-pool transact/account.rs).
fn sponsored(landed: &v1::Message, payer: Key) -> Vec<Resolved> {
    let group = landed.keys[0];
    let mut out = resolved(landed);
    let last = out.last_mut().expect("the transact instruction");
    last.1[0] = payer;
    last.1.push(group);
    out
}

#[test]
fn the_landed_p6_transfers_compile_to_the_sponsor_layout_of_the_same_instructions() {
    // The group paid the landed messages. The template now has the fee key pay, so each landed
    // instruction list must come back with the payer in place of the group in the `transact`
    // accounts and the group as the last account (the owner signer). The nonce instruction, the
    // data, the lifetime and the config stay as they landed.
    let pins = pins();
    for name in ["real/chain-p6a.msg", "real/chain-p6b.msg"] {
        let landed = v1::parse(&read(name)).unwrap();
        let (proposal, data) = p6_inputs(&read(name));
        let compiled = compile_proposal(&proposal, &pins.wire(), &data).expect("compile");
        let b = v1::parse(&compiled).unwrap();
        assert!(
            landed.config == b.config && landed.lifetime == b.lifetime,
            "{name}"
        );
        assert!(
            resolved(&b) == sponsored(&landed, pins.payer),
            "{name}: the instructions"
        );
        assert_eq!(b.header[0], 2, "{name}: the payer and the group key sign");
        assert_eq!(b.keys[0], pins.payer, "{name}: the payer is the fee payer");
        let flags = key_flags(&b);
        assert!(
            flags.contains(&(pins.payer, true, true)),
            "{name}: the payer"
        );
        assert!(
            flags.contains(&(pins.group, true, false)),
            "{name}: a readonly signer"
        );
        assert!(
            !landed.keys.contains(&pins.payer),
            "{name}: the landed message has no payer key"
        );
    }
}

#[test]
fn the_two_p6_messages_have_different_bytes_and_the_compiled_ones_keep_the_difference() {
    let (a, b) = (read("real/chain-p6a.msg"), read("real/chain-p6b.msg"));
    assert!(a != b, "run 1 and run 2 landed other messages");
    let (proposal_a, data_a) = p6_inputs(&a);
    let (proposal_b, data_b) = p6_inputs(&b);
    let wire = pins().wire();
    let (ca, cb) = (
        compile_proposal(&proposal_a, &wire, &data_a).unwrap(),
        compile_proposal(&proposal_b, &wire, &data_b).unwrap(),
    );
    assert!(ca != cb);
    // The compile is deterministic.
    assert!(ca == compile_proposal(&proposal_a, &wire, &data_a).unwrap());
}

fn compiled_and_checked(v: &ts::Vector) -> (Vec<u8>, String) {
    let (snapshot, pins) = ts::secrets(v);
    let tx = ts::transact_of(v);
    let proposal = Proposal {
        intent: ts::intent_of(v, &tx),
        plan: ts::plan_of(v),
    };
    let bytes = proposal.encode().expect("proposal");
    let message =
        compile_proposal(&bytes, &pins.wire(), &tx.write().expect("write")).expect("compile");
    let answer = check_message(
        &message,
        &bytes,
        &pins.wire(),
        &snapshot.encode().unwrap(),
        NOW,
    );
    (message, answer)
}

#[test]
fn a_message_compiled_from_each_ts_vector_passes_check_message_with_accepted() {
    let all: Vec<ts::Vector> = ts::vectors()
        .into_iter()
        .chain(ts::vectors_in("ts2"))
        .collect();
    assert!(all.len() >= 11, "{} vectors", all.len());
    for v in &all {
        let (_, answer) = compiled_and_checked(v);
        assert!(answer.starts_with("accepted"), "{}: {answer}", v.name);
    }
}

#[test]
fn the_compiled_message_equals_the_template_compile_of_the_library() {
    for v in &ts::vectors() {
        let (_, pins) = ts::secrets(v);
        let tx = ts::transact_of(v);
        let intent = ts::intent_of(v, &tx);
        let want = v1::write(&p3_check::template::compile(&intent, &pins, Some(&tx)).unwrap());
        let (got, _) = compiled_and_checked(v);
        assert!(got == want.unwrap(), "{}", v.name);
    }
}

#[test]
fn a_cancel_a_register_and_a_shield_compile_without_transact_data() {
    let facts = Facts::load();
    let nonce = [9u8; 32];
    for intent in [
        Intent::Cancel { nonce },
        Intent::Shield {
            blockhash: nonce,
            amount: 1_000,
        },
        Intent::Register {
            nonce,
            nullifier_pk: facts.nullifier_pk(),
            viewing_pk: facts.viewing_pk(),
        },
    ] {
        let proposal = Proposal {
            intent,
            plan: Plan::default(),
        };
        let bytes = proposal.encode().unwrap();
        let message = compile_proposal(&bytes, &pins().wire(), &[]).expect("compile");
        assert!(v1::parse(&message).is_ok());
    }
}

#[test]
fn bad_input_is_an_error_and_not_a_panic() {
    let (proposal, data) = p6_inputs(&read("real/chain-p6a.msg"));
    let wire = pins().wire();
    assert!(
        compile_proposal(&proposal, &wire, &[]).is_err(),
        "a transfer needs transact data"
    );
    assert!(
        compile_proposal(&proposal, &wire, &data[..data.len() - 1]).is_err(),
        "cut data"
    );
    assert!(compile_proposal(&proposal, &wire, &[data.clone(), vec![0]].concat()).is_err());
    assert!(
        compile_proposal(&proposal[..10], &wire, &data).is_err(),
        "cut proposal"
    );
    assert!(
        compile_proposal(&proposal, &wire[..128], &data).is_err(),
        "cut pins"
    );
    assert!(compile_proposal(&[], &wire, &[]).is_err());
    assert!(compile_proposal(&proposal, &wire, &data).is_ok());
}
