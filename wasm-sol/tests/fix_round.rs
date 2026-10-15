//! The fix round after the independent verifier of P3c (`p3c-verify/tests/v_attacks.rs`). One
//! section per finding. Each test builds a message that is consistent in every way but one, and
//! names the exact rules that must refuse it. The tests of the verifier that stated a gap
//! (`gap_*`, which passed because the checker accepted) are ported here as refusals.
//! Nothing here compares a secret with `assert_eq!`: a failure would print it.

mod common;

use common::fixture::*;
use common::{field, with_spend, EXPIRY, NONCE, NOW};
use p3_check::approve::{approve, Device};
use p3_check::check::Facts;
use p3_check::consts::{is_supported_shape, Key, SUPPORTED_SHAPES};
use p3_check::hashes::{dummy_hash, nullifier_pk, owner_hash, TREE_ID};
use p3_check::intent::Intent;
use p3_check::pins::Pins;
use p3_check::plan::{OutPlan, Plan, Proposal, Role};
use p3_check::rule::Rule::{self, *};
use p3_check::snapshot::Snapshot;
use p3_check::spend::{spend_violations, Group, SpendInput};
use p3_check::template::compile;
use p3_check::transact::{Output, OwnerTag};
use p3_check::v1;
use p3_check::wasm::check_message;

fn shield(f: &Fixture, pins: &Pins) -> (Intent, Vec<u8>) {
    let intent = Intent::Shield {
        nonce: NONCE,
        amount: 1_000,
    };
    let bytes = v1::write(&compile(&intent, pins, None).unwrap()).unwrap();
    let _ = f;
    (intent, bytes)
}

/// The rules and details that refuse a message of an intent without a plan.
fn refusal_of(intent: &Intent, bytes: &[u8], pins: &Pins, snapshot: &Snapshot) -> Vec<Rule> {
    refusal_details(intent, bytes, pins, snapshot)
        .into_iter()
        .map(|(rule, _)| rule)
        .collect()
}

fn refusal_details(
    intent: &Intent,
    bytes: &[u8],
    pins: &Pins,
    snapshot: &Snapshot,
) -> Vec<(Rule, String)> {
    let device = Device {
        pins,
        snapshot,
        now: NOW,
    };
    match approve(bytes, intent, &Plan::default(), &device) {
        Ok(_) => Vec::new(),
        Err(refusal) => refusal
            .violations
            .into_iter()
            .map(|v| (v.rule, v.detail))
            .collect(),
    }
}

// ---- 1. fail closed: every rule that lacks its data refuses --------------------------------

/// The spend of the verifier (`gap_a_spend_with_no_inputs_skips_the_ciphertext_rules`): no
/// input, so no first nullifier, a payee slot of 0 and a junk transaction key and blob.
fn zero_input_spend() -> (Fixture, Vec<u8>) {
    let mut f = Fixture::build(&Spec::transfer());
    f.snapshot.inputs.clear();
    f.tx.inputs.clear();
    f.tx.circuit.inputs = 0;
    let slot = OutPlan {
        role: Role::Payee,
        mint: SOL,
        amount: 0,
        blinding: field(2001),
    };
    f.tx.outputs = vec![Output {
        utxo_hash: f.hash_of(&slot),
        owner_tag: OwnerTag::Inline(PAYEE),
        data: Some(vec![7; 3]),
    }];
    f.plan.outputs = vec![slot];
    f.tx.circuit.outputs = 1;
    f.tx.tx_viewing_pk = [2; 33];
    f.intent = match f.intent.clone() {
        Intent::Transfer { payee, mint, .. } => Intent::Transfer {
            spend: common::spend(0, 1),
            payee,
            mint,
            amount: 0,
        },
        other => other,
    };
    let bytes = v1::write(&compile(&f.intent, &f.pins, Some(&f.tx)).unwrap()).unwrap();
    (f, bytes)
}

#[test]
fn a_spend_with_no_inputs_is_refused_by_every_rule_that_needs_the_first_nullifier() {
    let (f, bytes) = zero_input_spend();
    // The shape rule of P3a, then each P3c rule that reads the first nullifier: the blinding
    // rule, the salt rule and the transaction key rule. None of them may skip without a word.
    let got = f.approve_bytes(&bytes).unwrap_err();
    assert_eq!(
        got,
        vec![UnsupportedShape, OutputBlinding, SaltReused, TxViewingPk]
    );
}

#[test]
fn a_spend_whose_transact_data_was_not_read_is_refused_and_not_skipped() {
    let f = Fixture::build(&Spec::transfer());
    let group = Group::of(&f.pins);
    let msg = v1::parse(&f.bytes()).unwrap();
    let facts = Facts::default();
    let input = SpendInput {
        msg: &msg,
        facts: &facts,
        intent: &f.intent,
        plan: &f.plan,
        snapshot: &f.snapshot,
        group: &group,
        assets: &f.pins.assets,
    };
    let (found, _) = spend_violations(&input);
    let rules: Vec<Rule> = found.iter().map(|v| v.rule).collect();
    assert_eq!(rules, vec![SpendUnread]);
}

#[test]
fn a_spend_message_that_does_not_parse_has_no_p3c_run_and_says_so() {
    let f = Fixture::build(&Spec::transfer());
    let device = f.device();
    let refusal = approve(&[0xff; 5], &f.intent, &f.plan, &device).unwrap_err();
    let rules: Vec<Rule> = refusal.violations.iter().map(|v| v.rule).collect();
    assert_eq!(rules.last(), Some(&SpendUnread), "{rules:?}");
    assert!(
        rules.len() >= 2,
        "the P3a rule that read the bytes comes first: {rules:?}"
    );
}

// ---- 1. the supported shapes ----------------------------------------------------------------

#[test]
fn a_shape_that_the_prover_has_no_key_for_is_refused() {
    // 1 input and 3 outputs: the SDK pads to 4. Everything else of the spend is consistent.
    let mut f = Fixture::build(&Spec::transfer());
    f.push_dummy();
    assert_eq!((f.tx.inputs.len(), f.tx.outputs.len()), (1, 3));
    assert_eq!(f.rules(), vec![UnsupportedShape]);
}

#[test]
fn every_supported_shape_passes_the_shape_rule_and_its_neighbours_do_not() {
    assert_eq!(SUPPORTED_SHAPES.len(), 38);
    for &(inputs, outputs) in &SUPPORTED_SHAPES {
        assert!(is_supported_shape(
            usize::from(inputs),
            usize::from(outputs)
        ));
    }
    for (inputs, outputs) in [
        (0, 2),
        (1, 1),
        (1, 3),
        (2, 3),
        (3, 16),
        (50, 2),
        (49, 4),
        (256, 2),
    ] {
        assert!(
            !is_supported_shape(inputs, outputs),
            "({inputs}, {outputs})"
        );
    }
}

// ---- 2. the pins of the group ---------------------------------------------------------------

fn proposal_bytes(intent: &Intent) -> Vec<u8> {
    Proposal {
        intent: intent.clone(),
        plan: Plan::default(),
    }
    .encode()
    .unwrap()
}

/// The ids of the rules of a `refused` answer, in order.
fn answer_ids(answer: &str) -> Vec<&str> {
    assert!(answer.starts_with("refused"), "{answer}");
    answer
        .lines()
        .skip(1)
        .map(|line| line.split('\t').next().unwrap())
        .collect()
}

#[test]
fn a_snapshot_whose_nullifier_secret_derives_another_key_is_refused_at_the_wasm_entry() {
    // The gap of the verifier (`gap_through_the_wasm_entry_the_owner_hash_pin_is_derived...`): a
    // snapshot with another nullifier secret was self-consistent. The pins now come from the
    // `soldone` document, so the secret must derive the pinned key.
    let f = Fixture::build(&Spec::transfer());
    let (intent, bytes) = shield(&f, &f.pins);
    let mut snapshot = f.snapshot.clone();
    snapshot.inputs.clear();
    snapshot.nullifier_secret = [0x99; 31];
    let answer = check_message(
        &bytes,
        &proposal_bytes(&intent),
        &f.pins.wire(),
        &snapshot.encode().unwrap(),
        NOW,
    );
    assert_eq!(answer_ids(&answer), vec!["group-nullifier-pk"]);
}

#[test]
fn a_snapshot_whose_viewing_scalar_derives_another_key_is_refused_at_the_wasm_entry() {
    let f = Fixture::build(&Spec::transfer());
    let (intent, bytes) = shield(&f, &f.pins);
    let mut snapshot = f.snapshot.clone();
    snapshot.viewing_sk = field(0x2222);
    let answer = check_message(
        &bytes,
        &proposal_bytes(&intent),
        &f.pins.wire(),
        &snapshot.encode().unwrap(),
        NOW,
    );
    assert_eq!(answer_ids(&answer), vec!["group-viewing-pk"]);
}

#[test]
fn a_rogue_owner_hash_cannot_come_from_the_snapshot() {
    // The rogue wallet shields to the owner hash of its own secret. The pins hold the group
    // keys of the `soldone` document, so the message is refused on the owner, and the snapshot
    // on its key.
    let f = Fixture::build(&Spec::transfer());
    let rogue = owner_hash(&GROUP, &nullifier_pk(&[0x99; 31]).unwrap()).unwrap();
    let mut other = f.pins.clone();
    other.group_owner_hash = rogue;
    let (intent, bytes) = shield(&f, &other);
    let mut snapshot = f.snapshot.clone();
    snapshot.nullifier_secret = [0x99; 31];
    let rules = refusal_of(&intent, &bytes, &f.pins, &snapshot);
    assert_eq!(rules, vec![GroupNullifierPk, ShieldOwner]);
}

#[test]
fn the_pins_are_refused_when_a_key_is_not_a_field_element() {
    let f = Fixture::build(&Spec::transfer());
    let mut wire = f.pins.wire();
    wire[32..64].fill(0xff);
    let (intent, bytes) = shield(&f, &f.pins);
    let snapshot = f.snapshot.encode().unwrap();
    let answer = check_message(&bytes, &proposal_bytes(&intent), &wire, &snapshot, NOW);
    assert!(answer.starts_with("error"), "{answer}");
}

#[test]
fn the_owner_hash_of_the_pins_is_computed_from_the_pins() {
    let f = Fixture::build(&Spec::transfer());
    let (nullifier_pk, viewing_pk) = group().keys();
    let pins = Pins::decode(&f.pins.wire()).unwrap();
    assert!(pins.group_owner_hash == owner_hash(&GROUP, &nullifier_pk).unwrap());
    assert!(pins.nullifier_pk == nullifier_pk && pins.viewing_pk == viewing_pk);
}

#[test]
fn the_structure_rules_see_the_owner_hash_that_approve_computes_from_the_pins() {
    // The stored pin is wrong, the message pays the right owner hash. P3a must read the
    // computed value: with the stored one it would add a `shield-owner` refusal.
    let f = Fixture::build(&Spec::transfer());
    let (intent, bytes) = shield(&f, &f.pins);
    let mut pins = f.pins.clone();
    pins.group_owner_hash[31] ^= 1;
    let mut snapshot = f.snapshot.clone();
    snapshot.inputs.clear();
    assert_eq!(
        refusal_of(&intent, &bytes, &pins, &snapshot),
        vec![GroupOwnerHash]
    );
}

// ---- 3. the asset ids ------------------------------------------------------------------------

#[test]
fn a_mint_that_the_pinned_table_does_not_know_is_refused() {
    let mut spec = Spec::transfer();
    spec.inputs = vec![(MINT, 100)];
    spec.pay = Some((MINT, 40));
    let mut f = Fixture::build(&spec);
    f.pins.assets = p3_check::assets::AssetTable::new([]).unwrap();
    let got = f.rules();
    assert!(got.contains(&AssetUnknown), "{got:?}");
}

#[test]
fn a_table_that_maps_an_spl_mint_to_the_sol_id_cannot_exist() {
    // The gap of the verifier (`gap_the_asset_id_table_is_the_device_s_word...`): the device
    // table said "mint -> 1". There is no device table now, and the pinned one cannot be built.
    assert!(p3_check::assets::AssetTable::new([(MINT, 1)]).is_err());
}

// ---- 4. the output blindings ----------------------------------------------------------------

#[test]
fn an_output_with_the_hash_of_an_input_is_refused() {
    // The gap of the verifier: the change takes the blinding of input A, so its hash is the
    // hash of input A. Hash, blob and plan agree, and no proof can exist.
    let mut spec = Spec::transfer();
    spec.inputs = vec![(SOL, 70), (SOL, 30)];
    spec.pay = Some((SOL, 30));
    let mut f = Fixture::build(&spec);
    f.plan.outputs[0].blinding = input_blinding(0);
    f.resync();
    assert_eq!(f.rules(), vec![OutputBlinding]);
}

#[test]
fn two_outputs_with_one_hash_are_refused() {
    let mut spec = Spec::transfer();
    spec.dummies = 0;
    let mut f = Fixture::build(&spec);
    f.plan.outputs[0].amount = 30;
    let mut twin = f.plan.outputs[0].clone();
    twin.blinding = f.plan.outputs[0].blinding;
    f.plan.outputs.push(twin);
    f.tx.outputs.push(f.tx.outputs[0].clone());
    f.tx.circuit.outputs = 3;
    f.intent = with_spend(&f.intent, |spend| spend.outputs = 3);
    f.resync();
    f.tx.outputs[2].owner_tag = OwnerTag::Account(0);
    assert_eq!(f.tx.outputs[0].utxo_hash, f.tx.outputs[2].utxo_hash);
    let got = f.rules();
    assert!(got.contains(&OutputBlinding), "{got:?}");
}

#[test]
fn the_blinding_of_a_dummy_is_derived_too() {
    let mut f = Fixture::build(&Spec::withdrawal());
    assert_eq!(f.plan.outputs[1].role, Role::Dummy);
    f.plan.outputs[1].blinding = field(31337);
    f.tx.outputs[1].utxo_hash = dummy_hash(&field(31337), TREE_ID).unwrap();
    assert_eq!(f.rules(), vec![OutputBlinding]);
}

#[test]
fn the_slot_of_an_output_is_part_of_its_blinding() {
    // Two slots swap their blindings. Each blinding is a derived one, but of the other slot, so
    // both slots are refused. A check that derives every slot with one index would pass one.
    let mut f = Fixture::build(&Spec::transfer());
    let (first, second) = (f.plan.outputs[0].blinding, f.plan.outputs[1].blinding);
    f.plan.outputs[0].blinding = second;
    f.plan.outputs[1].blinding = first;
    f.resync();
    assert_eq!(f.rules(), vec![OutputBlinding, OutputBlinding]);
}

#[test]
fn a_blinding_seed_that_is_not_the_root_seed_is_refused_on_every_slot() {
    let mut f = Fixture::build(&Spec::transfer());
    f.plan.blinding_seed = field(7001);
    assert_eq!(f.rules(), vec![OutputBlinding, OutputBlinding]);
}

#[test]
fn the_derived_output_seed_is_not_accepted_in_place_of_the_root_seed() {
    // The circuit derives the output seed from a root seed. A seed that no root gives has no
    // proof, so the plan holds the root and the checker computes both steps.
    let mut f = Fixture::build(&Spec::transfer());
    let first = f.tx.inputs[0].nullifier;
    let derived = p3_check::hashes::output_seed(&first, &f.plan.blinding_seed).unwrap();
    f.plan.blinding_seed = derived;
    assert_eq!(f.rules(), vec![OutputBlinding, OutputBlinding]);
}

#[test]
fn a_blinding_seed_that_is_not_a_field_element_is_a_plan_error() {
    let mut f = Fixture::build(&Spec::transfer());
    f.plan.blinding_seed = [0xff; 32];
    assert_eq!(f.rules(), vec![PlanInvalid]);
}

#[test]
fn the_blinding_of_every_slot_is_the_one_that_the_circuit_derives() {
    let f = Fixture::build(&Spec::transfer());
    let first = f.tx.inputs[0].nullifier;
    for (slot, out) in f.plan.outputs.iter().enumerate() {
        assert!(out.blinding == slot_blinding(&first, &f.plan.blinding_seed, slot));
    }
}

// ---- 5. the owner tag of a dummy -------------------------------------------------------------

#[test]
fn an_all_in_transfer_whose_dummy_names_the_group_is_refused() {
    // The gap of the verifier: the payee gets everything, there is no change, and the dummy
    // names the group. The group is the payer, and no real output pays it.
    let mut spec = Spec::transfer();
    spec.pay = Some((SOL, 100));
    spec.dummies = 1;
    let mut f = Fixture::build(&spec);
    assert!(f.plan.outputs.iter().all(|o| o.role != Role::Change));
    assert_eq!(
        f.tx.outputs[1].owner_tag,
        OwnerTag::Inline(PAYEE),
        "the SDK names the payee"
    );
    f.tx.outputs[1].owner_tag = OwnerTag::Inline(GROUP);
    assert_eq!(f.rules(), vec![OutputTagRole]);
}

#[test]
fn the_dummy_of_an_all_in_transfer_names_the_payee_as_the_sdk_does() {
    let mut spec = Spec::transfer();
    spec.pay = Some((SOL, 100));
    spec.dummies = 1;
    assert!(Fixture::build(&spec).approve().is_ok());
}

#[test]
fn a_dummy_names_the_group_when_a_real_change_pays_it_and_may_name_the_payee_too() {
    let mut f = Fixture::build(&Spec::withdrawal());
    assert_eq!(f.tx.outputs[1].owner_tag, OwnerTag::Inline(GROUP));
    assert!(f.approve().is_ok());
    let mut spec = Spec::transfer();
    spec.dummies = 1;
    f = Fixture::build(&spec);
    assert!(f.approve().is_ok());
    f.tx.outputs[2].owner_tag = OwnerTag::Inline(PAYEE);
    assert!(
        f.approve().is_ok(),
        "the payee is the owner of a real output"
    );
}

#[test]
fn a_withdrawal_that_keeps_nothing_keeps_a_real_change_of_zero_for_the_dummy_to_name() {
    let mut spec = Spec::withdrawal();
    spec.withdraw = 100;
    let f = Fixture::build(&spec);
    assert_eq!(
        (f.plan.outputs[0].role, f.plan.outputs[0].amount),
        (Role::Change, 0)
    );
    assert_eq!(f.plan.outputs[1].role, Role::Dummy);
    assert!(f.approve().is_ok());
}

#[test]
fn a_dummy_that_has_no_real_output_to_name_is_refused() {
    let mut spec = Spec::withdrawal();
    spec.withdraw = 100;
    let mut f = Fixture::build(&spec);
    f.plan.outputs[0].role = Role::Dummy;
    f.resync();
    assert_eq!(f.rules(), vec![OutputTagRole, OutputTagRole]);
}

// ---- 6. the salt -----------------------------------------------------------------------------

#[test]
fn an_all_zero_salt_is_refused() {
    let mut spec = Spec::transfer();
    spec.salt = 0;
    assert_eq!(Fixture::build(&spec).rules(), vec![SaltZero]);
}

#[test]
fn the_first_nullifier_and_salt_of_an_earlier_proposal_are_refused() {
    // The gap of the verifier (`gap_the_same_first_nullifier_and_salt_in_two_sessions...`): two
    // proposals that spend one input with one salt share the keystream of every slot.
    let first = Fixture::build(&Spec::transfer());
    let mut spec = Spec::transfer();
    spec.pay = Some((SOL, 41));
    let mut second = Fixture::build(&spec);
    assert!(first.approve().is_ok() && second.approve().is_ok());
    assert_eq!(first.tx.salt, second.tx.salt);
    second.snapshot.used_salts = vec![(first.tx.inputs[0].nullifier, first.tx.salt)];
    assert_eq!(second.rules(), vec![SaltReused]);
}

#[test]
fn a_proof_again_after_a_stale_root_with_the_same_salt_is_refused() {
    // P6: the root went stale, the proposer proves again with the same inputs, in the same
    // session (`solsessions/<id>`). The old message may still be sent: it fails on chain and
    // publishes its data. A new root seed gives new blindings, so the new message is another
    // plaintext under the same keystream. The history holds the old proof of this session: the
    // page leaves out only the bytes that are being checked, not the earlier proofs.
    let old = Fixture::build(&Spec::transfer());
    let mut again = Spec::transfer();
    again.seed = 7001;
    let mut same_salt = Fixture::build(&again);
    same_salt.snapshot.used_salts = vec![(old.tx.inputs[0].nullifier, old.tx.salt)];
    assert_eq!(same_salt.rules(), vec![SaltReused]);
    again.salt = 6;
    let mut fresh = Fixture::build(&again);
    fresh.snapshot.used_salts = vec![(old.tx.inputs[0].nullifier, old.tx.salt)];
    assert!(fresh.approve().is_ok());
}

#[test]
fn a_pair_of_another_first_nullifier_or_another_salt_is_no_reuse() {
    let mut f = Fixture::build(&Spec::transfer());
    f.snapshot.used_salts = vec![([9; 32], f.tx.salt), (f.tx.inputs[0].nullifier, [6; 16])];
    assert!(f.approve().is_ok());
}

#[test]
fn the_salt_history_is_part_of_the_wire_form_of_the_snapshot() {
    let mut f = Fixture::build(&Spec::transfer());
    f.snapshot.used_salts = vec![([9; 32], [1; 16]), ([8; 32], [2; 16])];
    let wire = f.snapshot.encode().unwrap();
    let again = Snapshot::decode(&wire).unwrap();
    assert!(again.used_salts == f.snapshot.used_salts);
    assert!(Snapshot::decode(&wire[..wire.len() - 1]).is_err());
}

// ---- 7. the keys of a registration -----------------------------------------------------------

fn register(nullifier_pk: Key, viewing_pk: [u8; 33]) -> Intent {
    Intent::Register {
        nonce: NONCE,
        nullifier_pk,
        viewing_pk,
    }
}

fn register_bytes(intent: &Intent, pins: &Pins) -> Vec<u8> {
    v1::write(&compile(intent, pins, None).unwrap()).unwrap()
}

fn rule_and_source(details: &[(Rule, String)]) -> Vec<(Rule, bool, bool)> {
    details
        .iter()
        .map(|(rule, why)| {
            (
                *rule,
                why.contains("is not the pinned key"),
                why.contains("is not the key of the device"),
            )
        })
        .collect()
}

#[test]
fn a_register_with_the_keys_of_another_wallet_is_refused_by_the_pins_and_by_the_secrets() {
    // The gap of the verifier (`gap_register_keys_are_not_compared_with_the_snapshot`): the
    // intent and the instruction carry attacker keys, pins and snapshot hold the group keys.
    let f = Fixture::build(&Spec::transfer());
    let att = attacker();
    let (att_nk, att_vk) = att.keys();
    let intent = register(att_nk, att_vk);
    let bytes = register_bytes(&intent, &f.pins);
    let details = refusal_details(&intent, &bytes, &f.pins, &f.snapshot);
    assert_eq!(
        rule_and_source(&details),
        vec![
            (RegisterNullifierPk, true, false),
            (RegisterNullifierPk, false, true)
        ]
    );
}

#[test]
fn a_register_that_matches_the_pins_but_not_the_secrets_of_the_device_is_refused() {
    let f = Fixture::build(&Spec::transfer());
    let (att_nk, att_vk) = attacker().keys();
    let pins = Pins::devnet(GROUP, att_nk, att_vk).unwrap();
    let intent = register(att_nk, att_vk);
    let bytes = register_bytes(&intent, &pins);
    let details = refusal_details(&intent, &bytes, &pins, &f.snapshot);
    assert_eq!(
        rule_and_source(&details),
        vec![
            (GroupNullifierPk, false, false),
            (GroupViewingPk, false, false),
            (RegisterNullifierPk, false, true),
        ]
    );
}

#[test]
fn a_register_that_matches_the_secrets_of_the_device_but_not_the_pins_is_refused() {
    let f = Fixture::build(&Spec::transfer());
    let (att_nk, att_vk) = attacker().keys();
    let pins = Pins::devnet(GROUP, att_nk, att_vk).unwrap();
    let (nk, vk) = group().keys();
    let intent = register(nk, vk);
    let bytes = register_bytes(&intent, &pins);
    let details = refusal_details(&intent, &bytes, &pins, &f.snapshot);
    assert_eq!(
        rule_and_source(&details),
        vec![
            (GroupNullifierPk, false, false),
            (GroupViewingPk, false, false),
            (RegisterNullifierPk, true, false),
        ]
    );
}

#[test]
fn a_register_with_the_viewing_key_of_another_wallet_is_refused() {
    let f = Fixture::build(&Spec::transfer());
    let (nk, _) = group().keys();
    let intent = register(nk, attacker().viewing_pk());
    let bytes = register_bytes(&intent, &f.pins);
    let rules = refusal_of(&intent, &bytes, &f.pins, &f.snapshot);
    assert_eq!(rules, vec![RegisterViewingPk, RegisterViewingPk]);
}

#[test]
fn a_register_message_whose_last_instruction_is_not_the_register_data_says_so() {
    // `Facts` reads the `register` data from the last instruction. With another instruction
    // behind it there is nothing to compare with the device secrets, and that is a refusal.
    let f = Fixture::build(&Spec::transfer());
    let (nk, vk) = group().keys();
    let intent = register(nk, vk);
    let bytes = common::with_ix(
        &register_bytes(&intent, &f.pins),
        p3_check::consts::SYSTEM_PROGRAM,
        &[GROUP],
        vec![0; 4],
    );
    let rules = refusal_of(&intent, &bytes, &f.pins, &f.snapshot);
    assert_eq!(rules.last(), Some(&RegisterLength), "{rules:?}");
}

#[test]
fn a_register_with_the_keys_of_the_group_is_approved() {
    let f = Fixture::build(&Spec::transfer());
    let (nk, vk) = group().keys();
    let intent = register(nk, vk);
    let bytes = register_bytes(&intent, &f.pins);
    assert!(refusal_of(&intent, &bytes, &f.pins, &f.snapshot).is_empty());
}

// ---- 8. the answer echoes the recipient and the expiry ---------------------------------------

fn answer_of(f: &Fixture) -> String {
    let proposal = Proposal {
        intent: f.intent.clone(),
        plan: f.plan.clone(),
    };
    let snapshot = f.snapshot.encode().unwrap();
    check_message(
        &f.bytes(),
        &proposal.encode().unwrap(),
        &f.pins.wire(),
        &snapshot,
        NOW,
    )
}

#[test]
fn the_accepted_answer_of_a_withdrawal_echoes_the_recipient_and_the_expiry() {
    let answer = answer_of(&Fixture::build(&Spec::withdrawal()));
    assert!(answer.starts_with("accepted"), "{answer}");
    let recipient = format!("\nrecipient {}", p3_check::bytes::hex(&[0x33; 32]));
    assert!(answer.contains(&recipient), "{answer}");
    assert!(answer.contains(&format!("\nexpiry {EXPIRY}\n")), "{answer}");
}

#[test]
fn the_accepted_answer_of_a_transfer_echoes_the_expiry_and_no_recipient() {
    let answer = answer_of(&Fixture::build(&Spec::transfer()));
    assert!(answer.contains(&format!("\nexpiry {EXPIRY}\n")), "{answer}");
    assert!(!answer.contains("recipient"), "{answer}");
}

#[test]
fn the_summary_reads_the_recipient_and_the_expiry_from_the_message() {
    let f = Fixture::build(&Spec::withdrawal());
    let msg_expiry = f.tx.expiry;
    let approved = f.approve().unwrap();
    assert_eq!(approved.summary.recipient, Some([0x33; 32]));
    assert_eq!(approved.summary.expiry, Some(msg_expiry));
    assert_eq!(
        Fixture::build(&Spec::transfer())
            .approve()
            .unwrap()
            .summary
            .recipient,
        None
    );
}

// ---- 9. the payee is paid exactly the intent ------------------------------------------------

#[test]
fn the_payee_is_paid_more_than_the_intent_with_the_change_cut_by_the_same_amount() {
    // The mutant `one.amount >= *amount` survived the first suite. Plan, hash and blob agree at
    // 41 and 59, and the balance holds, but the intent says 40.
    let mut spec = Spec::transfer();
    spec.pay = Some((SOL, 41));
    let mut f = Fixture::build(&spec);
    f.intent = match f.intent.clone() {
        Intent::Transfer {
            spend, payee, mint, ..
        } => Intent::Transfer {
            spend,
            payee,
            mint,
            amount: 40,
        },
        other => other,
    };
    assert_eq!(f.rules(), vec![PayeeOutputs]);
}

#[test]
fn the_payee_is_paid_less_than_the_intent_with_the_change_raised_by_the_same_amount() {
    let mut spec = Spec::transfer();
    spec.pay = Some((SOL, 39));
    let mut f = Fixture::build(&spec);
    f.intent = match f.intent.clone() {
        Intent::Transfer {
            spend, payee, mint, ..
        } => Intent::Transfer {
            spend,
            payee,
            mint,
            amount: 40,
        },
        other => other,
    };
    assert_eq!(f.rules(), vec![PayeeOutputs]);
}

// ---- the proof that the open items are open --------------------------------------------------

#[test]
fn open_item_the_expiry_may_be_one_second_ahead() {
    // Product decision: the minimum remaining life of an expiry. The checker takes any expiry
    // after the clock and at most 24 h plus 1 h ahead. A change here must flip this test.
    let f = Fixture::build(&Spec::transfer());
    let device = Device {
        pins: &f.pins,
        snapshot: &f.snapshot,
        now: EXPIRY - 1,
    };
    assert!(approve(&f.bytes(), &f.intent, &f.plan, &device).is_ok());
}

#[test]
fn open_item_the_blob_of_a_dummy_is_the_one_free_part_of_the_outputs() {
    // The hash, the tag and the blinding of a dummy are fixed. Its blob is random in the SDK, so
    // the checker compares only its length: a proposer can hide 89 bytes there (a note for
    // another key). They move no funds and no rule reads them. A change here must flip this test.
    let mut f = Fixture::build(&Spec::withdrawal());
    let blinding = f.plan.outputs[1].blinding;
    let note = p3_check::viewing::plaintext(1, 5, &blinding);
    let blob = f
        .tx_key()
        .slot_data(&attacker().viewing_pk(), &note, &f.tx.salt, 1);
    f.tx.outputs[1].data = Some(blob.unwrap());
    assert!(f.approve().is_ok());
    f.tx.outputs[1].data.as_mut().unwrap().pop();
    assert_eq!(f.rules(), vec![Ciphertext], "only its length is checked");
}

#[test]
fn open_item_the_tree_fee_comes_from_the_snapshot_under_a_cap() {
    // Product decision: the insertion fee per nullifier is read from the device snapshot, shown
    // on the screen and capped. It is not pinned. A change here must flip this test.
    let mut f = Fixture::build(&Spec::transfer());
    f.snapshot.fee_per_nullifier = 100;
    assert_eq!(f.approve().unwrap().summary.tree_fee, 100);
    f.snapshot.fee_per_nullifier = 163;
    assert_eq!(f.rules(), vec![TreeFeeOverCap]);
}
