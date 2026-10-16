//! Writes the vectors of the wasm smoke test to `vectors/smoke/`: for each case the message, the
//! proposal (intent and plaintext), the snapshot, the pins and the answer of the native
//! `check_message`. `tools/smoke.cjs` must get the same answers from the wasm build.
//! `cargo run --example gen_vectors`. The wallets are synthetic or come from the TS vectors, so
//! the files hold no key of the P5 group. Run it again after a change of the rules or of the pins.
//!
//! The answer of a case lists the rules of the beta policy first (`intent-retired` for an
//! intent that nothing signs, `migration-payee` for a nonce payment to another payee than the
//! PDA address of the group), then the rules of the checker. `policy_of` names the policy rules
//! that a case must get, and the first other rule must be the rule of the case.

#[path = "../tests/common/mod.rs"]
mod common;

use common::fixture::*;
use common::ts;
use common::{mutate, replace_key, with_flags, with_ix, NOW};
use p3_check::address::Address;
use p3_check::consts::{OFFCHAIN_MAGIC, RECENT_BLOCKHASHES, SYSTEM_PROGRAM};
use p3_check::intent::Intent;
use p3_check::pins::Pins;
use p3_check::plan::{Plan, Proposal};
use p3_check::template::{build, compile, expected, template_config};
use p3_check::transact::OwnerTag;
use p3_check::v1;
use p3_check::wasm::check_message;

struct Case {
    name: String,
    bytes: Vec<u8>,
    proposal: Vec<u8>,
    snapshot: Vec<u8>,
    pins: Vec<u8>,
    /// The first rule of a refusal, or `None` for an accept.
    refused: Option<&'static str>,
}

fn proposal(intent: &Intent, plan: &Plan) -> Vec<u8> {
    Proposal {
        intent: intent.clone(),
        plan: plan.clone(),
        transact: Vec::new(),
    }
    .encode()
    .expect("proposal")
}

/// A case from a fixture whose message is `bytes`.
fn from_fixture(name: &str, f: &Fixture, bytes: Vec<u8>, refused: Option<&'static str>) -> Case {
    Case {
        name: name.to_string(),
        bytes,
        proposal: proposal(&f.intent, &f.plan),
        snapshot: f.snapshot.encode().expect("snapshot"),
        pins: f.pins.wire(),
        refused,
    }
}

/// The accepted cases of the intents that carry no plan, on the synthetic wallet.
fn plain_cases() -> Vec<Case> {
    let f = Fixture::build(&Spec::transfer());
    let mut snapshot = f.snapshot.clone();
    snapshot.inputs.clear();
    let wallet = group();
    let intents = [
        (
            "create-nonce",
            Intent::CreateNonce {
                blockhash: common::NONCE,
            },
        ),
        (
            "register",
            Intent::Register {
                nonce: common::NONCE,
                nullifier_pk: p3_check::hashes::nullifier_pk(&wallet.nullifier_secret).unwrap(),
                viewing_pk: wallet.viewing_pk(),
            },
        ),
        (
            "shield",
            Intent::Shield {
                blockhash: common::NONCE,
                amount: 50_000_000,
            },
        ),
        (
            "cancel",
            Intent::Cancel {
                nonce: common::NONCE,
            },
        ),
    ];
    intents
        .into_iter()
        .map(|(name, intent)| {
            // Add SOL pays to the PDA identity: its pins and the PDA secret of the device.
            let (pins, mut snap) = (f.pins.clone(), snapshot.clone());
            let compiled_with = if intent.uses_pda() {
                snap.nullifier_secret = pda_wallet().nullifier_secret;
                pins.for_pda().expect("PDA pins")
            } else {
                pins.clone()
            };
            let msg = compile(&intent, &compiled_with, None).expect("compile");
            Case {
                name: name.to_string(),
                bytes: v1::write(&msg).unwrap(),
                proposal: proposal(&intent, &Plan::default()),
                snapshot: snap.encode().unwrap(),
                pins: pins.wire(),
                refused: None,
            }
        })
        .collect()
}

fn cases() -> Vec<Case> {
    let mut out = plain_cases();
    let migration = Fixture::migration();
    out.push(from_fixture(
        "migration",
        &migration,
        migration.bytes(),
        None,
    ));
    let transfer = Fixture::build(&Spec::transfer());
    out.push(from_fixture("transfer", &transfer, transfer.bytes(), None));
    let withdrawal = Fixture::build(&Spec::withdrawal());
    out.push(from_fixture(
        "withdrawal",
        &withdrawal,
        withdrawal.bytes(),
        None,
    ));
    let mut spl = Spec::transfer();
    spl.inputs = vec![(MINT, 100)];
    spl.pay = Some((MINT, 40));
    let spl = Fixture::build(&spl);
    out.push(from_fixture("transfer-spl", &spl, spl.bytes(), None));
    for vector in ts::vectors() {
        let (snapshot, pins) = ts::secrets(&vector);
        let tx = ts::transact_of(&vector);
        let intent = ts::intent_of(&vector, &tx);
        let msg = compile(&intent, &pins, Some(&tx)).expect("compile");
        out.push(Case {
            name: format!("ts-{}", vector.name),
            bytes: v1::write(&msg).unwrap(),
            proposal: proposal(&intent, &ts::plan_of(&vector)),
            snapshot: snapshot.encode().unwrap(),
            pins: pins.wire(),
            refused: None,
        });
    }
    out.extend(refusals());
    out
}

/// A refused spend: `mutate` breaks one thing of a fresh transfer fixture.
fn refused_spend(name: &str, rule: &'static str, mutation: impl FnOnce(&mut Fixture)) -> Case {
    let mut f = Fixture::build(&Spec::transfer());
    mutation(&mut f);
    let bytes = f.bytes();
    from_fixture(name, &f, bytes, Some(rule))
}

/// One refused transfer for each rule that the message of a spend can break.
fn spend_refusals() -> Vec<Case> {
    vec![
        refused_spend("expiry-max", "expiry-max", |f| f.tx.expiry = u64::MAX),
        refused_spend("output-hash", "output-hash", |f| {
            f.tx.outputs[1].utxo_hash[31] ^= 1
        }),
        refused_spend("ciphertext", "ciphertext", |f| {
            f.tx.outputs[0].data.as_mut().unwrap()[60] ^= 1
        }),
        refused_spend("tx-viewing-pk", "tx-viewing-pk", |f| {
            f.tx.tx_viewing_pk = payee().viewing_pk()
        }),
        refused_spend("nullifier", "nullifier-mismatch", |f| {
            f.tx.inputs[0].nullifier[31] ^= 1
        }),
        refused_spend("tag-swap", "output-tag-role", |f| {
            f.tx.outputs[0].owner_tag = OwnerTag::Inline(PAYEE);
            f.tx.outputs[1].owner_tag = OwnerTag::Inline(GROUP);
        }),
        refused_spend("relayer-fee", "leg-mismatch", |f| {
            f.tx.legs.push(p3_check::transact::Leg::SolWithdrawal(1))
        }),
        refused_spend("payee-tag", "output-owner-tag", |f| {
            f.tx.outputs[1].owner_tag = OwnerTag::Inline(ATTACKER)
        }),
        refused_spend("plan-count", "plan-output-count", |f| {
            f.plan.outputs.remove(0);
        }),
        refused_spend("output-blinding", "output-blinding", |f| {
            f.plan.outputs[0].blinding = input_blinding(0);
            f.resync();
        }),
        refused_spend("salt-zero", "salt-zero", |f| {
            f.tx.salt = [0; 16];
            f.resync();
        }),
        refused_spend("salt-reused", "salt-reused", |f| {
            f.snapshot.used_salts = vec![(f.tx.inputs[0].nullifier, f.tx.salt)];
        }),
        refused_spend("shape", "unsupported-shape", Fixture::push_dummy),
    ]
}

fn refusals() -> Vec<Case> {
    let mut out = spend_refusals();
    out.extend(pin_refusals());
    // A dummy names the group key (the owner signer), the payee, and nobody else.
    let mut all_in = Spec::transfer();
    all_in.pay = Some((SOL, 100));
    all_in.dummies = 1;
    let mut f = Fixture::build(&all_in);
    f.tx.outputs[1].owner_tag = OwnerTag::Inline(ATTACKER);
    let bytes = f.bytes();
    out.push(from_fixture(
        "dummy-tag",
        &f,
        bytes,
        Some("output-owner-tag"),
    ));
    let withdrawal = Fixture::build(&Spec::withdrawal());
    let recipient = [0x33; 32];
    let bytes = replace_key(&withdrawal.bytes(), &recipient, ATTACKER_KEY);
    out.push(from_fixture(
        "recipient",
        &withdrawal,
        bytes,
        Some("account-address"),
    ));
    let cancel = plain_cases().pop().expect("cancel");
    let mut refuse = |name: &str, rule: &'static str, bytes: Vec<u8>| {
        out.push(Case {
            name: name.to_string(),
            bytes,
            refused: Some(rule),
            ..clone_case(&cancel)
        });
    };
    refuse(
        "sysvar-writable",
        "account-flags",
        with_flags(&cancel.bytes, &RECENT_BLOCKHASHES, false, true),
    );
    let data = [&2u32.to_le_bytes()[..], &1u64.to_le_bytes()].concat();
    let group_key = GROUP;
    refuse(
        "system-transfer",
        "system-transfer",
        with_ix(
            &cancel.bytes,
            SYSTEM_PROGRAM,
            &[group_key, ATTACKER_KEY],
            data,
        ),
    );
    let fund = [&3u32.to_le_bytes()[..], &[0; 8]].concat();
    refuse(
        "group-debit",
        "group-debit",
        with_ix(
            &cancel.bytes,
            SYSTEM_PROGRAM,
            &[group_key, ATTACKER_KEY],
            fund,
        ),
    );
    refuse("offchain", "offchain-prefix", OFFCHAIN_MAGIC.to_vec());
    let register = plain_cases().remove(1);
    let bytes = mutate(&register.bytes, |m| m.ixs[1].data[2] ^= 1);
    out.push(Case {
        name: "nullifier-pk".to_string(),
        bytes,
        refused: Some("register-nullifier-pk"),
        ..clone_case(&register)
    });
    out
}

const ATTACKER_KEY: [u8; 32] = [0xAA; 32];

/// The pins of the `soldone` document against the secrets of the device, and the keys of a
/// `register`: one case each. The first rule of the answer is the rule of the case.
fn pin_refusals() -> Vec<Case> {
    let f = Fixture::build(&Spec::transfer());
    let (att_nk, att_vk) = attacker().keys();
    let other = Pins::devnet(GROUP, att_nk, att_vk, PAYER, common::PDA_NULLIFIER_PK).expect("pins");
    let mut wrong_pins = from_fixture("pins-nullifier-pk", &f, f.bytes(), None);
    wrong_pins.pins = other.wire();
    wrong_pins.refused = Some("group-nullifier-pk");
    let register = plain_cases().remove(1);
    let intent = Intent::Register {
        nonce: common::NONCE,
        nullifier_pk: att_nk,
        viewing_pk: att_vk,
    };
    let msg = compile(&intent, &f.pins, None).expect("compile");
    let register_keys = Case {
        name: "register-keys".to_string(),
        bytes: v1::write(&msg).unwrap(),
        proposal: proposal(&intent, &Plan::default()),
        refused: Some("register-nullifier-pk"),
        ..clone_case(&register)
    };
    vec![wrong_pins, register_keys, group_pays(&f)]
}

/// The proposal names the group key as its payer, and the group key pays the message alone. The
/// template compiler refuses this pair, so the message is built without it.
fn group_pays(f: &Fixture) -> Case {
    let cancel = plain_cases().pop().expect("cancel");
    let mut pins = f.pins.clone();
    pins.payer = GROUP;
    let intent = Intent::Cancel {
        nonce: common::NONCE,
    };
    let exp = expected(&intent, &pins, None).expect("expected");
    let config = template_config(&exp.limits);
    let msg = build(&exp, &GROUP, common::NONCE, config, None).expect("build");
    Case {
        name: "payer-is-group".to_string(),
        bytes: v1::write(&msg).unwrap(),
        pins: pins.wire(),
        refused: Some("payer-is-group"),
        ..clone_case(&cancel)
    }
}

fn clone_case(c: &Case) -> Case {
    Case {
        name: c.name.clone(),
        bytes: c.bytes.clone(),
        proposal: c.proposal.clone(),
        snapshot: c.snapshot.clone(),
        pins: c.pins.clone(),
        refused: c.refused,
    }
}

const POLICY: [&str; 2] = ["intent-retired", "migration-payee"];

/// The policy rules that the beta adds for the intent of a case.
fn policy_of(case: &Case) -> Vec<&'static str> {
    let proposal = Proposal::decode(&case.proposal).expect("proposal");
    let pins = Pins::decode(&case.pins).expect("pins");
    let mut signing = [0u8; 34];
    signing[0] = 2;
    signing[1..33].copy_from_slice(&pins.pda);
    let own = Address {
        signing,
        nullifier_pk: pins.pda_nullifier_pk,
        viewing_pk: pins.viewing_pk,
    };
    let change = proposal
        .plan
        .outputs
        .iter()
        .any(|slot| slot.role == p3_check::plan::Role::Change);
    match &proposal.intent {
        Intent::Register { .. } | Intent::Withdrawal { .. } | Intent::Cancel { .. } => {
            vec!["intent-retired"]
        }
        Intent::Transfer { payee, .. } if *payee != own || change => vec!["migration-payee"],
        _ => Vec::new(),
    }
}

/// The answer has the policy rules of the case, and the first other rule is the rule of the case
/// (none for an accept).
fn check_case(case: &Case, answer: &str) {
    let policy = policy_of(case);
    if answer.starts_with("accepted") {
        assert!(
            policy.is_empty() && case.refused.is_none(),
            "{}: {answer}",
            case.name
        );
        return;
    }
    assert!(answer.starts_with("refused"), "{}: {answer}", case.name);
    let rules: Vec<&str> = answer
        .lines()
        .skip(1)
        .filter_map(|l| l.split('\t').next())
        .collect();
    let (found, core): (Vec<&str>, Vec<&str>) = rules.iter().partition(|r| POLICY.contains(r));
    assert_eq!(found, policy, "{}: {answer}", case.name);
    assert_eq!(
        core.first().copied(),
        case.refused,
        "{}: {answer}",
        case.name
    );
}

fn main() {
    let dir = format!("{}/smoke", common::VECTORS);
    std::fs::create_dir_all(&dir).expect("create dir");
    for case in cases() {
        let answer = check_message(&case.bytes, &case.proposal, &case.pins, &case.snapshot, NOW);
        check_case(&case, &answer);
        for (ext, bytes) in [
            ("msg", &case.bytes[..]),
            ("intent", &case.proposal),
            ("snapshot", &case.snapshot),
            ("pins", &case.pins),
            ("answer", answer.as_bytes()),
        ] {
            std::fs::write(format!("{dir}/{}.{ext}", case.name), bytes).expect("write");
        }
        println!(
            "{:<30} {}",
            case.name,
            answer.lines().take(2).collect::<Vec<_>>().join(" | ")
        );
    }
}
