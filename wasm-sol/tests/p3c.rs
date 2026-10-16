//! P3c, the Outputs, Legs and Ciphertexts rules of ZOLANA.md section 5, on self-consistent
//! spends (`tests/common/fixture.rs`): the accept vectors, and one named test for each way a
//! message can break a rule. Every negative breaks one thing and expects exactly the rules that
//! name it. Nothing here compares a secret with `assert_eq!`: a failure would print it.

mod common;

use common::field;
use common::fixture::*;
use p3_check::assets::AssetTable;
use p3_check::consts::Key;
use p3_check::hashes::{Utxo, TREE_ID};
use p3_check::plan::{OutPlan, Role};
use p3_check::rule::Rule::{self, *};
use p3_check::transact::{Input, Leg, OwnerTag};
use p3_check::viewing::{plaintext, BLOB_LEN};

fn fixtures() -> Vec<(&'static str, Fixture)> {
    let mut spl = Spec::transfer();
    spl.inputs = vec![(MINT, 100)];
    spl.pay = Some((MINT, 40));
    let mut two_inputs = Spec::transfer();
    two_inputs.inputs = vec![(SOL, 70), (SOL, 30)];
    let mut no_change = Spec::transfer();
    no_change.pay = Some((SOL, 100));
    no_change.dummies = 1;
    let mut padded = Spec::transfer();
    padded.dummies = 1;
    let mut two_assets = Spec::transfer();
    two_assets.inputs = vec![(SOL, 100), (MINT, 50)];
    two_assets.pay = Some((MINT, 20));
    let mut spend_all = Spec::withdrawal();
    spend_all.withdraw = 100;
    vec![
        ("transfer", Fixture::build(&Spec::transfer())),
        ("transfer of an SPL mint", Fixture::build(&spl)),
        ("transfer of two inputs", Fixture::build(&two_inputs)),
        (
            "transfer of everything, one dummy",
            Fixture::build(&no_change),
        ),
        ("transfer with a dummy", Fixture::build(&padded)),
        ("transfer, SOL and SPL inputs", Fixture::build(&two_assets)),
        ("withdrawal", Fixture::build(&Spec::withdrawal())),
        (
            "withdrawal of everything, dummy",
            Fixture::build(&spend_all),
        ),
    ]
}

#[test]
fn every_self_consistent_spend_is_approved_by_every_rule() {
    for (name, fixture) in fixtures() {
        let approved = fixture.approve();
        assert!(approved.is_ok(), "{name}: {:?}", approved.err());
    }
}

#[test]
fn the_summary_shows_the_payee_amount_the_change_the_withdrawal_and_the_fee() {
    let approved = Fixture::build(&Spec::transfer()).approve().unwrap();
    assert_eq!(approved.summary.paid.len(), 1);
    assert_eq!(approved.summary.paid[0].amount, 40);
    assert_eq!(approved.summary.change[0].amount, 60);
    assert_eq!(
        (approved.summary.withdrawn, approved.summary.tree_fee),
        (0, 0)
    );
    let approved = Fixture::build(&Spec::withdrawal()).approve().unwrap();
    assert!(approved.summary.paid.is_empty());
    assert_eq!(approved.summary.change[0].amount, 70);
    assert_eq!(approved.summary.withdrawn, 30);
}

// ---- Outputs: the hash of every slot ---------------------------------------------------------

/// Replaces the hash of one output by the hash of another plaintext, so only the hash is wrong.
fn rehash(slot: usize, change: impl FnOnce(&mut OutPlan)) -> Vec<Rule> {
    let mut fixture = Fixture::build(&Spec::transfer());
    let mut other = fixture.plan.outputs[slot].clone();
    change(&mut other);
    fixture.tx.outputs[slot].utxo_hash = fixture.hash_of(&other);
    fixture.rules()
}

#[test]
fn output_amount_changed() {
    for slot in [0, 1] {
        assert_eq!(
            rehash(slot, |o| o.amount += 1),
            vec![OutputHash],
            "slot {slot}"
        );
    }
}

#[test]
fn output_owner_changed() {
    // The payee slot keeps its payee tag, but its hash now has the owner of the group.
    let mut fixture = Fixture::build(&Spec::transfer());
    let mut other = fixture.plan.outputs[1].clone();
    other.role = Role::Change;
    fixture.tx.outputs[1].utxo_hash = fixture.hash_of(&other);
    assert_eq!(fixture.rules(), vec![OutputHash]);
}

#[test]
fn output_blinding_changed() {
    for slot in [0, 1] {
        assert_eq!(
            rehash(slot, |o| o.blinding[31] ^= 1),
            vec![OutputHash],
            "slot {slot}"
        );
    }
}

#[test]
fn output_asset_changed() {
    for slot in [0, 1] {
        assert_eq!(
            rehash(slot, |o| o.mint = MINT),
            vec![OutputHash],
            "slot {slot}"
        );
    }
}

#[test]
fn an_output_to_a_third_party() {
    // The payee slot is paid to the attacker: his owner hash, his tag, his viewing key.
    let mut fixture = Fixture::build(&Spec::transfer());
    let attacker = attacker();
    let out = fixture.plan.outputs[1].clone();
    let hash = Utxo {
        owner_hash: attacker.owner_hash(),
        mint: out.mint,
        amount: out.amount,
        blinding: out.blinding,
    }
    .hash(TREE_ID)
    .unwrap();
    let body = plaintext(1, out.amount, &out.blinding);
    let data = fixture
        .tx_key()
        .slot_data(&attacker.viewing_pk(), &body, &fixture.tx.salt, 1)
        .unwrap();
    fixture.tx.outputs[1].utxo_hash = hash;
    fixture.tx.outputs[1].owner_tag = OwnerTag::Inline(ATTACKER);
    fixture.tx.outputs[1].data = Some(data);
    // P3a refuses the tag. P3c refuses the hash, the tag of the slot and the blob.
    assert_eq!(
        fixture.rules(),
        vec![OutputOwnerTag, OutputHash, OutputTagRole, Ciphertext]
    );
}

#[test]
fn a_dummy_with_a_non_zero_amount() {
    // In the plan: a dummy that carries an amount.
    let mut fixture = Fixture::build(&Spec::withdrawal());
    fixture.plan.outputs[1].amount = 5;
    let got = fixture.rules();
    assert!(got.contains(&DummyNotEmpty), "{got:?}");
    // In the message: the slot hash is that of an output with owner 0 and amount 5.
    let mut fixture = Fixture::build(&Spec::withdrawal());
    let blinding = fixture.plan.outputs[1].blinding;
    fixture.tx.outputs[1].utxo_hash = Utxo {
        owner_hash: [0; 32],
        mint: [0; 32],
        amount: 5,
        blinding,
    }
    .hash(TREE_ID)
    .unwrap();
    assert_eq!(fixture.rules(), vec![OutputHash]);
}

#[test]
fn a_dummy_with_another_blinding_has_another_hash() {
    // The message holds the hash of a dummy with another blinding than the plan (the plan keeps
    // the derived one, so the blinding rule has nothing to say).
    let mut fixture = Fixture::build(&Spec::withdrawal());
    let mut blinding = fixture.plan.outputs[1].blinding;
    blinding[31] ^= 1;
    fixture.tx.outputs[1].utxo_hash = p3_check::hashes::dummy_hash(&blinding, TREE_ID).unwrap();
    assert_eq!(fixture.rules(), vec![OutputHash]);
}

// ---- plan and intent -------------------------------------------------------------------------

#[test]
fn the_plan_has_one_entry_per_output() {
    let mut fixture = Fixture::build(&Spec::transfer());
    fixture.plan.outputs.pop();
    let got = fixture.rules();
    assert!(got.contains(&PlanOutputCount), "{got:?}");
}

/// The payee address, the asset and the amount of a Transfer come from the intent: the
/// approvers confirm its fingerprint. These tests change the message or the intent and keep the
/// rest of a consistent spend.
fn set_payment(
    fixture: &mut Fixture,
    change: impl FnOnce(&mut p3_check::address::Address, &mut u64),
) {
    use p3_check::intent::Intent;
    match &mut fixture.intent {
        Intent::Transfer { payee, amount, .. } => change(payee, amount),
        _ => panic!("not a transfer"),
    }
}

#[test]
fn the_payee_nullifier_key_is_the_one_of_the_intent() {
    // The message pays the tag of B with another nullifier key: the owner is Poseidon over the
    // same identity and a key that B does not hold, so nobody can spend the output. The blob
    // does not carry the owner, so it stays the same. Only the hash tells.
    let mut fixture = Fixture::build(&Spec::transfer());
    let other_npk = attacker().address().nullifier_pk;
    let owner = p3_check::hashes::owner_hash(&PAYEE, &other_npk).unwrap();
    let out = fixture.plan.outputs[1].clone();
    fixture.tx.outputs[1].utxo_hash = Utxo {
        owner_hash: owner,
        mint: out.mint,
        amount: out.amount,
        blinding: out.blinding,
    }
    .hash(TREE_ID)
    .unwrap();
    assert_eq!(fixture.rules(), vec![OutputHash]);
}

#[test]
fn the_payee_viewing_key_is_the_one_of_the_intent() {
    // The blob is encrypted to a viewing key that is a valid point but not the one of B: B cannot
    // decrypt the output, so it is hidden from him and from every seat.
    let mut fixture = Fixture::build(&Spec::transfer());
    let out = fixture.plan.outputs[1].clone();
    let body = plaintext(1, out.amount, &out.blinding);
    let data = fixture
        .tx_key()
        .slot_data(&attacker().viewing_pk(), &body, &fixture.tx.salt, 1)
        .unwrap();
    fixture.tx.outputs[1].data = Some(data);
    assert_eq!(fixture.rules(), vec![Ciphertext]);
}

#[test]
fn the_payee_output_is_not_encrypted_to_the_group_key() {
    // The payee slot is encrypted to the viewing key of the group: B cannot read it.
    let mut fixture = Fixture::build(&Spec::transfer());
    let out = fixture.plan.outputs[1].clone();
    let body = plaintext(1, out.amount, &out.blinding);
    let data = fixture
        .tx_key()
        .slot_data(&group().viewing_pk(), &body, &fixture.tx.salt, 1)
        .unwrap();
    fixture.tx.outputs[1].data = Some(data);
    assert_eq!(fixture.rules(), vec![Ciphertext]);
}

#[test]
fn the_payee_address_of_the_intent_is_what_the_message_commits_to() {
    // The same message under an intent that names another nullifier key, another viewing key,
    // or another signing key for the payee: each is a refusal, not an accept.
    for change in [0, 1, 2] {
        let mut fixture = Fixture::build(&Spec::transfer());
        set_payment(&mut fixture, |address, _| match change {
            0 => address.nullifier_pk[31] ^= 1,
            1 => address.viewing_pk = attacker().viewing_pk(),
            _ => address.signing[1] ^= 1,
        });
        let got = fixture.rules();
        assert!(!got.is_empty(), "change {change} was accepted");
        assert!(
            got.contains(&OutputHash) || got.contains(&Ciphertext),
            "{change}: {got:?}"
        );
    }
}

#[test]
fn the_payee_address_has_a_signing_key_that_a_tag_can_name() {
    let mut fixture = Fixture::build(&Spec::transfer());
    set_payment(&mut fixture, |address, _| address.signing[0] = 0);
    let got = fixture.rules();
    assert!(
        got.contains(&PayeeAddress),
        "a P-256 payee is not accepted: {got:?}"
    );
}

#[test]
fn a_transfer_has_one_payee_output_of_the_asset_and_the_amount_of_the_intent() {
    let mut fixture = Fixture::build(&Spec::transfer());
    set_payment(&mut fixture, |_, amount| *amount += 1);
    assert_eq!(fixture.rules(), vec![PayeeOutputs]);
    let mut fixture = Fixture::build(&Spec::transfer());
    fixture.plan.outputs[0].role = Role::Payee;
    let got = fixture.rules();
    assert!(got.contains(&PayeeOutputs), "{got:?}");
    let mut fixture = Fixture::build(&Spec::transfer());
    fixture.plan.outputs.push(fixture.plan.outputs[1].clone());
    let got = fixture.rules();
    assert!(got.contains(&PayeeOutputs), "two payee outputs: {got:?}");
}

#[test]
fn a_transfer_of_another_asset_than_the_intent_names() {
    let mut fixture = Fixture::build(&Spec::transfer());
    let intent = fixture.intent.clone();
    fixture.intent = match intent {
        p3_check::intent::Intent::Transfer {
            spend,
            payee,
            amount,
            ..
        } => p3_check::intent::Intent::Transfer {
            spend,
            payee,
            mint: MINT,
            amount,
        },
        other => other,
    };
    let got = fixture.rules();
    assert!(got.contains(&PayeeOutputs), "{got:?}");
}

#[test]
fn a_withdrawal_has_no_payee_output() {
    let mut fixture = Fixture::build(&Spec::withdrawal());
    fixture.plan.outputs[0].role = Role::Payee;
    let got = fixture.rules();
    assert!(got.contains(&PayeeOutputs), "{got:?}");
}

#[test]
fn a_value_that_is_not_a_field_element_is_a_plan_error_and_not_a_panic() {
    let mut fixture = Fixture::build(&Spec::transfer());
    fixture.plan.outputs[0].blinding = [0xff; 32];
    let got = fixture.rules();
    assert!(got.contains(&PlanInvalid), "{got:?}");
    let mut fixture = Fixture::build(&Spec::transfer());
    set_payment(&mut fixture, |address, _| address.viewing_pk = [7; 33]);
    let got = fixture.rules();
    assert!(got.contains(&PlanInvalid), "{got:?}");
}

// ---- Legs: conservation, the snapshot and the fee --------------------------------------------

#[test]
fn a_missing_withdrawal_leg() {
    let mut fixture = Fixture::build(&Spec::withdrawal());
    fixture.tx.legs.clear();
    // P3a: the legs differ from the intent. P3c: 100 in, 70 out, 30 are missing.
    assert_eq!(fixture.rules(), vec![LegMismatch, Conservation]);
}

#[test]
fn an_extra_withdrawal_leg() {
    let mut fixture = Fixture::build(&Spec::withdrawal());
    fixture.tx.legs.push(Leg::SolWithdrawal(1));
    assert_eq!(fixture.rules(), vec![LegMismatch, Conservation]);
}

#[test]
fn a_relayer_fee_leg_on_a_transfer() {
    // The pool treats a relayer fee as a withdrawal leg to any recipient.
    let mut fixture = Fixture::build(&Spec::transfer());
    fixture.tx.legs.push(Leg::SolWithdrawal(1));
    assert_eq!(fixture.rules(), vec![LegMismatch, Conservation]);
}

#[test]
fn a_deposit_leg_on_a_transfer() {
    let mut fixture = Fixture::build(&Spec::transfer());
    fixture.tx.legs.push(Leg::SolDeposit(1));
    assert_eq!(fixture.rules(), vec![LegMismatch, Conservation]);
}

#[test]
fn an_spl_leg_names_no_mint() {
    let mut fixture = Fixture::build(&Spec::transfer());
    fixture.tx.legs.push(Leg::Spl {
        withdrawal: true,
        amount: 1,
        bump: 255,
    });
    assert_eq!(fixture.rules(), vec![LegMismatch, LegAsset]);
}

#[test]
fn conservation_off_by_one_lamport() {
    for delta in [1, -1] {
        let mut spec = Spec::transfer();
        spec.change_delta = delta;
        // The change of the plan and of the message both carry the extra lamport, so the hash
        // and the ciphertext rules hold and only the balance is wrong.
        assert_eq!(
            Fixture::build(&spec).rules(),
            vec![Conservation],
            "delta {delta}"
        );
    }
}

#[test]
fn conservation_holds_per_asset() {
    let mut spec = Spec::transfer();
    spec.inputs = vec![(SOL, 100), (MINT, 50)];
    spec.pay = Some((MINT, 20));
    let mut fixture = Fixture::build(&spec);
    // Move one lamport of SOL change into the SPL change: the totals match, the assets do not.
    fixture.plan.outputs[0].amount -= 1;
    fixture.plan.outputs[1].amount += 1;
    let got = fixture.rules();
    assert!(got.contains(&Conservation), "{got:?}");
}

#[test]
fn a_nullifier_that_is_not_from_the_snapshot() {
    let mut fixture = Fixture::build(&Spec::transfer());
    fixture.tx.inputs[0].nullifier[31] ^= 1;
    assert_eq!(fixture.rules(), vec![NullifierMismatch]);
}

#[test]
fn the_message_spends_an_input_that_the_snapshot_does_not_have() {
    let mut fixture = Fixture::build(&Spec::transfer());
    fixture.tx.inputs.push(Input {
        nullifier: field(99),
        tree_index: 0,
    });
    fixture.tx.circuit.inputs = 2;
    set_inputs(&mut fixture, 2);
    assert_eq!(fixture.rules(), vec![SnapshotInputs]);
}

#[test]
fn the_message_leaves_an_input_of_the_snapshot_unspent() {
    let mut spec = Spec::transfer();
    spec.inputs = vec![(SOL, 70), (SOL, 30)];
    let mut fixture = Fixture::build(&spec);
    fixture.tx.inputs.pop();
    fixture.tx.circuit.inputs = 1;
    set_inputs(&mut fixture, 1);
    assert_eq!(fixture.rules(), vec![SnapshotInputs]);
}

fn set_inputs(fixture: &mut Fixture, count: u8) {
    use p3_check::intent::Intent;
    match &mut fixture.intent {
        Intent::Transfer { spend, .. } | Intent::Withdrawal { spend, .. } => spend.inputs = count,
        _ => panic!("not a spend"),
    }
}

#[test]
fn two_snapshot_inputs_with_one_nullifier() {
    let mut spec = Spec::transfer();
    spec.inputs = vec![(SOL, 50), (SOL, 50)];
    let mut fixture = Fixture::build(&spec);
    fixture.snapshot.inputs[1] = fixture.snapshot.inputs[0].clone();
    let got = fixture.rules();
    assert!(got.contains(&SnapshotDuplicate), "{got:?}");
}

#[test]
fn the_tree_fee_is_read_capped_and_reported() {
    let mut fixture = Fixture::build(&Spec::transfer());
    fixture.snapshot.fee_per_nullifier = p3_check::template::TREE_FEE_CAP;
    let approved = fixture.approve().expect("at the cap");
    assert_eq!(approved.summary.tree_fee, p3_check::template::TREE_FEE_CAP);
    fixture.snapshot.fee_per_nullifier += 1;
    assert_eq!(fixture.rules(), vec![TreeFeeOverCap]);
    let mut spec = Spec::transfer();
    spec.inputs = vec![(SOL, 70), (SOL, 30)];
    let mut fixture = Fixture::build(&spec);
    fixture.snapshot.fee_per_nullifier = 100;
    assert_eq!(fixture.approve().unwrap().summary.tree_fee, 200);
}

#[test]
fn the_group_owner_hash_of_the_pin_is_recomputed() {
    let mut fixture = Fixture::build(&Spec::transfer());
    fixture.pins.group_owner_hash[31] ^= 1;
    // The P3a rules run with the recomputed value, so only the pin is refused.
    assert_eq!(fixture.rules(), vec![GroupOwnerHash]);
}

// ---- Ciphertexts -----------------------------------------------------------------------------

#[test]
fn a_wrong_tx_viewing_pk() {
    let mut fixture = Fixture::build(&Spec::transfer());
    // A valid P-256 key that is not the derived one: the viewing key of the payee.
    fixture.tx.tx_viewing_pk = payee().viewing_pk();
    assert_eq!(fixture.rules(), vec![TxViewingPk]);
}

#[test]
fn a_bad_ciphertext_one_byte_flipped_in_the_ephemeral_key() {
    for byte in [0, 1, 17, 32] {
        let mut fixture = Fixture::build(&Spec::transfer());
        fixture.tx.tx_viewing_pk[byte] ^= 1;
        assert_eq!(fixture.rules(), vec![TxViewingPk], "byte {byte}");
    }
}

fn flip(slot: usize, at: usize) -> Vec<Rule> {
    let mut fixture = Fixture::build(&Spec::transfer());
    fixture.tx.outputs[slot].data.as_mut().unwrap()[at] ^= 1;
    fixture.rules()
}

#[test]
fn a_bad_ciphertext_one_byte_flipped_in_the_tag() {
    // Byte 0 is the `Encrypted` tag, bytes 1 to 4 the length, byte 5 the scheme.
    for slot in [0, 1] {
        for at in [0, 1, 4, 5] {
            assert_eq!(flip(slot, at), vec![Ciphertext], "slot {slot} byte {at}");
        }
    }
}

#[test]
fn a_bad_ciphertext_one_byte_flipped_in_the_recipient_key() {
    for slot in [0, 1] {
        for at in [6, 20, 38] {
            assert_eq!(flip(slot, at), vec![Ciphertext], "slot {slot} byte {at}");
        }
    }
}

#[test]
fn a_bad_ciphertext_one_byte_flipped_in_the_body() {
    for slot in [0, 1] {
        for at in [39, 40, 60, BLOB_LEN - 1] {
            assert_eq!(flip(slot, at), vec![Ciphertext], "slot {slot} byte {at}");
        }
    }
}

#[test]
fn a_bad_ciphertext_of_the_wrong_length_or_no_data() {
    let mut fixture = Fixture::build(&Spec::transfer());
    fixture.tx.outputs[1].data.as_mut().unwrap().push(0);
    assert_eq!(fixture.rules(), vec![Ciphertext]);
    let mut fixture = Fixture::build(&Spec::transfer());
    fixture.tx.outputs[0].data = None;
    assert_eq!(fixture.rules(), vec![Ciphertext]);
}

#[test]
fn a_ciphertext_for_another_salt_or_slot_is_not_the_recompute() {
    let mut fixture = Fixture::build(&Spec::transfer());
    fixture.tx.salt[0] ^= 1;
    // The salt is in the message and keys every slot: both blobs are wrong under it.
    assert_eq!(fixture.rules(), vec![Ciphertext, Ciphertext]);
    let mut fixture = Fixture::build(&Spec::transfer());
    let first = fixture.tx.outputs[0].data.clone();
    fixture.tx.outputs[1].data = first;
    assert_eq!(fixture.rules(), vec![Ciphertext]);
}

#[test]
fn a_dummy_needs_the_data_of_a_real_slot() {
    let mut fixture = Fixture::build(&Spec::withdrawal());
    fixture.tx.outputs[1].data.as_mut().unwrap().pop();
    assert_eq!(fixture.rules(), vec![Ciphertext]);
    let mut fixture = Fixture::build(&Spec::withdrawal());
    fixture.tx.outputs[1].data = None;
    assert_eq!(fixture.rules(), vec![Ciphertext]);
}

#[test]
fn an_asset_that_the_table_does_not_know() {
    let mut spec = Spec::transfer();
    spec.inputs = vec![(MINT, 100)];
    spec.pay = Some((MINT, 40));
    let mut fixture = Fixture::build(&spec);
    fixture.pins.assets = AssetTable::new([]).unwrap();
    let got = fixture.rules();
    assert!(got.contains(&AssetUnknown), "{got:?}");
    // The asset id is pinned: another id for the mint is another ciphertext.
    let mut fixture = Fixture::build(&spec);
    fixture.pins.assets = AssetTable::new([(MINT, MINT_ID + 1)]).unwrap();
    assert_eq!(fixture.rules(), vec![Ciphertext, Ciphertext]);
}

// ---- owner tags ------------------------------------------------------------------------------

#[test]
fn an_owner_tag_swapped() {
    let mut fixture = Fixture::build(&Spec::transfer());
    // Change names the payee, the payee slot names the group: both tags pass the P3a set rule.
    fixture.tx.outputs[0].owner_tag = OwnerTag::Inline(PAYEE);
    fixture.tx.outputs[1].owner_tag = OwnerTag::Inline(GROUP);
    assert_eq!(fixture.rules(), vec![OutputTagRole, OutputTagRole]);
}

#[test]
fn every_output_tagged_to_the_payee_or_every_output_tagged_to_the_group() {
    // The finding `gap_output_hash_and_ciphertext_fields_are_not_read_by_p3a`: both are in the
    // P3a allow set, so only the role of each slot can refuse them.
    let mut fixture = Fixture::build(&Spec::transfer());
    fixture.tx.outputs[0].owner_tag = OwnerTag::Inline(PAYEE);
    assert_eq!(fixture.rules(), vec![OutputTagRole]);
    let mut fixture = Fixture::build(&Spec::transfer());
    fixture.tx.outputs[1].owner_tag = OwnerTag::Inline(GROUP);
    assert_eq!(fixture.rules(), vec![OutputTagRole]);
}

/// The position of the owner signer in the accounts of the transfer of the spec.
fn group_slot() -> u8 {
    5 + u8::try_from(Spec::transfer().inputs.len()).unwrap()
}

#[test]
fn the_change_tag_may_be_the_account_of_the_group_or_the_inline_group_key() {
    // An account tag counts the accounts of the instruction: payer, output tree, pool, System
    // program, input tree, one account per nullifier, then the owner signer (the group key).
    for tag in [OwnerTag::Account(group_slot()), OwnerTag::Inline(GROUP)] {
        let mut fixture = Fixture::build(&Spec::transfer());
        fixture.tx.outputs[0].owner_tag = tag;
        assert!(fixture.approve().is_ok(), "{tag:?}");
    }
}

#[test]
fn a_change_tag_that_names_the_account_of_the_payer_is_refused() {
    // Account 0 is the fee key, not the group: a change that it owns would leave the group.
    let mut fixture = Fixture::build(&Spec::transfer());
    fixture.tx.outputs[0].owner_tag = OwnerTag::Account(0);
    assert_eq!(fixture.rules(), vec![OutputOwnerTag, OutputTagRole]);
}

#[test]
fn a_dummy_names_the_group_or_the_payee_and_nobody_else() {
    let mut spec = Spec::transfer();
    spec.dummies = 1;
    for tag in [
        OwnerTag::Inline(GROUP),
        OwnerTag::Account(group_slot()),
        OwnerTag::Inline(PAYEE),
    ] {
        let mut fixture = Fixture::build(&spec);
        fixture.tx.outputs[2].owner_tag = tag;
        assert!(fixture.approve().is_ok(), "{tag:?}");
    }
    // The tag of the spec's "true dummy" is zero in the owner field of the hash, never in the
    // published tag: the SDK writes a participant tag (`dummyOwnerTag`, `owner_tags`).
    for tag in [
        OwnerTag::Inline([0; 32]),
        OwnerTag::Inline(ATTACKER),
        OwnerTag::Account(0),
        OwnerTag::Account(200),
    ] {
        let mut fixture = Fixture::build(&spec);
        fixture.tx.outputs[2].owner_tag = tag;
        let got = fixture.rules();
        assert!(got.contains(&OutputTagRole), "{tag:?}: {got:?}");
    }
}

// ---- the keys of the snapshot ----------------------------------------------------------------

#[test]
fn a_snapshot_of_another_wallet_fails_the_rules_that_read_its_secrets() {
    let mut fixture = Fixture::build(&Spec::transfer());
    fixture.snapshot.nullifier_secret = [0x99; 31];
    let got = fixture.rules();
    assert!(
        got.contains(&GroupNullifierPk) && got.contains(&NullifierMismatch),
        "{got:?}"
    );
    let mut fixture = Fixture::build(&Spec::transfer());
    fixture.snapshot.viewing_sk = field(0x2222);
    let got = fixture.rules();
    assert!(
        got.contains(&GroupViewingPk) && got.contains(&TxViewingPk) && got.contains(&Ciphertext),
        "{got:?}"
    );
}

#[test]
fn a_keyless_snapshot_is_a_refusal_and_not_a_panic() {
    let mut fixture = Fixture::build(&Spec::transfer());
    fixture.snapshot.viewing_sk = [0; 32];
    // One refusal for the device keys, one for the transaction key that the spend derives.
    assert_eq!(fixture.rules(), vec![PlanInvalid, PlanInvalid]);
    let _: Key = [0; 32];
}
