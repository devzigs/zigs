//! The fee key of a seat pays (ZOLANA.md 5). The template has two signers: the payer, which is the
//! first account and the fee payer, and the group key, which is a readonly signer. Add SOL
//! (`Shield`) has the payer as its only signer. The group key never pays and no instruction may
//! debit its lamports. Each test names the rule that refuses the message, and the account layout
//! tests pin the order that the SDK sponsor mode and the pool program use.

mod common;

use common::*;
use p3_check::consts::{
    Key, RECENT_BLOCKHASHES, RENT_SYSVAR, SYSTEM_PROGRAM, SYS_CREATE_ACCOUNT, SYS_CREATE_WITH_SEED,
    SYS_TRANSFER, SYS_TRANSFER_WITH_SEED,
};
use p3_check::intent::Intent;
use p3_check::pins::Pins;
use p3_check::rule::Rule;
use p3_check::template::{build, compile, expected, signer_count, template_config};
use p3_check::v1;

fn violations(bytes: &[u8], intent: &Intent) -> Vec<Rule> {
    report(bytes, intent)
        .violations
        .iter()
        .map(|v| v.rule)
        .collect()
}

/// The accounts of the instruction `at` of an accept vector, as (key, signer, writable).
fn layout(name: &str, at: usize) -> Vec<(Key, bool, bool)> {
    let vector = accept(name);
    let exp = expected(&vector.intent, &pins(), tx_of(&vector).as_ref()).expect("expected");
    exp.ixs[at]
        .accounts
        .iter()
        .map(|a| (a.key, a.signer, a.writable))
        .collect()
}

fn tx_of(vector: &Vector) -> Option<p3_check::transact::Transact> {
    let msg = parse(&vector.bytes);
    msg.ixs
        .iter()
        .find(|ix| ix.data.first() == Some(&16))
        .map(|ix| p3_check::transact::parse(&ix.data).expect("transact"))
}

// ---- the payer ---------------------------------------------------------------------------

#[test]
fn the_first_account_of_every_intent_is_the_payer_of_the_proposal() {
    for vector in accept_vectors() {
        let msg = parse(&vector.bytes);
        assert_eq!(msg.keys[0], PAYER, "{}", vector.name);
        assert!(msg.is_signer(0) && msg.is_writable(0), "{}", vector.name);
        assert_ne!(msg.keys[0], pins().group, "{}", vector.name);
    }
}

#[test]
fn a_message_paid_by_another_key_than_the_payer_of_the_proposal_is_refused() {
    let vector = accept("transfer");
    let bytes = replace_key(&vector.bytes, &PAYER, ATTACKER);
    assert_eq!(
        violations(&bytes, &vector.intent)[0],
        Rule::FeePayerNotPayer
    );
}

#[test]
fn a_proposal_that_names_the_group_key_as_its_payer_is_refused() {
    // The message is paid by the group key alone, as the P5 messages were. The compiler refuses
    // the pair, so the message is built from the template without it.
    let vector = accept("cancel");
    let mut group_pays = pins();
    group_pays.payer = group_pays.group;
    let exp = expected(&vector.intent, &group_pays, None).expect("expected");
    let config = template_config(&exp.limits);
    let msg = build(&exp, &group_pays.group, NONCE, config, None).expect("build");
    let bytes = v1::write(&msg).expect("write");
    let got = p3_check::check::check_all(&bytes, &vector.intent, &group_pays, NOW);
    let rules: Vec<Rule> = got.violations.iter().map(|v| v.rule).collect();
    assert_eq!(rules, vec![Rule::PayerIsGroup, Rule::SignerSet]);
}

#[test]
fn the_compiler_refuses_the_group_key_as_payer() {
    let intent = accept("cancel").intent;
    let mut group_pays = pins();
    group_pays.payer = group_pays.group;
    assert!(compile(&intent, &group_pays, None).is_err());
}

#[test]
fn a_payer_that_is_the_group_key_with_the_template_of_two_signers_is_refused_too() {
    // The pins name the group as payer and the message has two signers: the first account is the
    // fee key, so both the payer rule and the group rule fire.
    let vector = accept("cancel");
    let mut group_pays = pins();
    group_pays.payer = group_pays.group;
    let got = p3_check::check::check_all(&vector.bytes, &vector.intent, &group_pays, NOW);
    let rules: Vec<Rule> = got.violations.iter().map(|v| v.rule).collect();
    assert!(rules.contains(&Rule::FeePayerNotPayer), "{rules:?}");
    assert!(rules.contains(&Rule::PayerIsGroup), "{rules:?}");
}

#[test]
fn the_wire_of_the_pins_holds_the_payer_last() {
    let pins = pins();
    let wire = pins.wire();
    assert_eq!(wire.len(), 129);
    assert_eq!(&wire[97..], &PAYER);
    assert_eq!(Pins::decode(&wire).unwrap(), pins);
    assert!(
        Pins::decode(&wire[..97]).is_err(),
        "the payer is not optional"
    );
}

// ---- the signers -------------------------------------------------------------------------

#[test]
fn two_keys_sign_every_intent_but_shield_and_the_payer_signs_first() {
    for vector in accept_vectors() {
        let msg = parse(&vector.bytes);
        let want = if vector.name == "shield" { 1 } else { 2 };
        assert_eq!(signer_count(&vector.intent), want, "{}", vector.name);
        assert_eq!(msg.header[0], want, "{}", vector.name);
        if want == 2 {
            assert_eq!(
                msg.keys[1],
                pins().group,
                "{}: the group signs second",
                vector.name
            );
            assert!(
                msg.is_signer(1) && !msg.is_writable(1),
                "{}: readonly",
                vector.name
            );
        }
    }
}

#[test]
fn a_third_signer_is_refused_with_the_signer_set_rule() {
    let vector = accept("transfer");
    let third = parse(&vector.bytes).keys[2];
    let bytes = with_flags(&vector.bytes, &third, true, true);
    assert_eq!(violations(&bytes, &vector.intent)[0], Rule::SignerSet);
}

#[test]
fn the_group_key_that_does_not_sign_is_refused_with_the_signer_set_rule() {
    // A message with the payer as its only signer would not carry the group signature.
    let vector = accept("transfer");
    let bytes = with_flags(&vector.bytes, &pins().group, false, false);
    assert_eq!(violations(&bytes, &vector.intent)[0], Rule::SignerSet);
}

#[test]
fn a_shield_with_a_second_signer_is_refused_with_the_signer_set_rule() {
    let vector = accept("shield");
    let third = parse(&vector.bytes).keys[1];
    let bytes = with_flags(&vector.bytes, &third, true, true);
    assert_eq!(violations(&bytes, &vector.intent)[0], Rule::SignerSet);
}

#[test]
fn the_group_key_is_a_readonly_signer_so_no_instruction_can_debit_it() {
    let vector = accept("transfer");
    let bytes = with_flags(&vector.bytes, &pins().group, true, true);
    assert!(violations(&bytes, &vector.intent).contains(&Rule::AccountFlags));
}

// ---- no debit of the group key -----------------------------------------------------------

fn system_ix(tag: u32, funder: Key) -> Vec<u8> {
    let vector = accept("cancel");
    let data = [&tag.to_le_bytes()[..], &[0; 8]].concat();
    with_ix(&vector.bytes, SYSTEM_PROGRAM, &[funder, ATTACKER], data)
}

#[test]
fn a_system_transfer_from_the_group_key_is_refused() {
    let intent = accept("cancel").intent;
    let got = violations(&system_ix(SYS_TRANSFER, pins().group), &intent);
    assert!(
        got.contains(&Rule::SystemTransfer) && got.contains(&Rule::GroupDebit),
        "{got:?}"
    );
}

#[test]
fn a_create_account_from_the_group_key_is_refused() {
    let intent = accept("cancel").intent;
    let got = violations(&system_ix(SYS_CREATE_ACCOUNT, pins().group), &intent);
    assert!(
        got.contains(&Rule::InstructionNotAllowed) && got.contains(&Rule::GroupDebit),
        "{got:?}"
    );
}

#[test]
fn a_create_account_with_seed_funded_by_the_group_key_is_refused() {
    // The tag is on the allow list, because the nonce account is made with it. The funder is
    // the first account: the payer for the nonce account, never the group key.
    let intent = accept("cancel").intent;
    let got = violations(&system_ix(SYS_CREATE_WITH_SEED, pins().group), &intent);
    assert_eq!(got[0], Rule::GroupDebit, "{got:?}");
    assert!(!got.contains(&Rule::SystemTransfer), "{got:?}");
}

#[test]
fn a_transfer_with_seed_from_the_group_key_is_refused() {
    let intent = accept("cancel").intent;
    let got = violations(&system_ix(SYS_TRANSFER_WITH_SEED, pins().group), &intent);
    assert!(got.contains(&Rule::GroupDebit), "{got:?}");
}

#[test]
fn the_payer_may_fund_a_create_account_with_seed_and_no_rule_fires() {
    // The accept vector of the nonce account has the payer as the funder.
    let vector = accept("create-nonce");
    assert!(violations(&vector.bytes, &vector.intent).is_empty());
    let message = parse(&vector.bytes);
    let create = &message.ixs[0];
    assert_eq!(message.account_key(create, 0), Some(&PAYER));
}

#[test]
fn a_funder_that_is_not_the_group_key_does_not_fire_the_group_rule() {
    let intent = accept("cancel").intent;
    let got = violations(&system_ix(SYS_CREATE_WITH_SEED, ATTACKER), &intent);
    assert!(!got.contains(&Rule::GroupDebit), "{got:?}");
}

// ---- the layouts of the instructions -----------------------------------------------------

#[test]
fn transact_lists_the_payer_first_and_the_owner_signer_after_the_nullifier_accounts() {
    // programs/shielded-pool/src/instructions/transact/account.rs: payer, output tree, pool,
    // System program, input tree, one account per nullifier, the owner signers, then the
    // settlement accounts. sdk-libs/ts interface/instructions/index.ts lists the same order.
    let pins = pins();
    let accounts = layout("transfer", 1);
    let flags: Vec<(bool, bool)> = accounts.iter().map(|a| (a.1, a.2)).collect();
    assert_eq!(accounts[0].0, PAYER);
    assert_eq!(accounts[1].0, pins.output_tree);
    assert_eq!(accounts[2].0, pins.pool);
    assert_eq!(accounts[3].0, SYSTEM_PROGRAM);
    assert_eq!(accounts[4].0, pins.input_tree);
    let last = accounts.last().expect("accounts");
    assert_eq!(
        last.0, pins.group,
        "the owner signer follows the nullifier accounts"
    );
    assert_eq!(
        flags,
        [
            (true, true),
            (false, true),
            (false, false),
            (false, false),
            (false, true),
            (false, true),
            (true, false)
        ]
    );
}

#[test]
fn a_withdrawal_lists_the_owner_signer_before_the_settlement_accounts() {
    let pins = pins();
    let accounts = layout("withdrawal", 1);
    let at = accounts
        .iter()
        .position(|a| a.0 == pins.group)
        .expect("group");
    assert_eq!(
        accounts.len(),
        5 + 1 + 1 + 2,
        "five fixed, a nullifier, the signer, two settlement"
    );
    assert_eq!(at, 6, "after the nullifier account");
    assert_eq!(accounts[7].0, pins.sol_interface);
    assert_eq!(accounts[8].0, Facts::load().recipient());
}

#[test]
fn register_lists_the_owner_then_the_payer() {
    // programs/user-registry register.rs: record, owner (signer), payer (signer, writable).
    let pins = pins();
    let accounts = layout("register", 1);
    assert_eq!(accounts[0], (pins.user_record, false, true));
    assert_eq!(accounts[1], (pins.group, true, false));
    assert_eq!(accounts[2], (PAYER, true, true));
    assert_eq!(accounts[3], (SYSTEM_PROGRAM, false, false));
}

#[test]
fn the_nonce_account_is_funded_by_the_payer_and_the_group_signs_as_its_base() {
    // System create_account_with_seed lists the base as a third account when it is not the
    // funder (solana-system-interface 3.3.0, `create_account_with_seed`).
    let pins = pins();
    let accounts = layout("create-nonce", 0);
    assert_eq!(accounts[0], (PAYER, true, true));
    assert_eq!(accounts[1], (pins.nonce_account, false, true));
    assert_eq!(accounts[2], (pins.group, true, false));
    let init = layout("create-nonce", 1);
    assert_eq!(init[2], (RENT_SYSVAR, false, false));
    assert_eq!(
        layout("cancel", 0)[2],
        (pins.group, true, false),
        "the nonce authority"
    );
    assert_eq!(layout("cancel", 0)[1].0, RECENT_BLOCKHASHES);
}

// ---- Add SOL ------------------------------------------------------------------------------

#[test]
fn add_sol_is_a_deposit_signed_by_the_payer_alone_with_a_blockhash() {
    let vector = accept("shield");
    let msg = parse(&vector.bytes);
    let pins = pins();
    assert_eq!(
        msg.ixs.len(),
        1,
        "no AdvanceNonceAccount: the group does not sign"
    );
    assert_eq!(msg.header[0], 1);
    assert_eq!(msg.lifetime, NONCE, "the blockhash of the intent");
    assert!(!vector.intent.uses_nonce());
    assert!(!msg.keys.contains(&pins.group) && !msg.keys.contains(&pins.nonce_account));
    let accounts = layout("shield", 0);
    assert_eq!(
        accounts[1],
        (PAYER, true, true),
        "the depositor is the payer"
    );
    assert!(violations(&vector.bytes, &vector.intent).is_empty());
}

#[test]
fn add_sol_with_the_group_key_among_its_accounts_is_refused() {
    let vector = accept("shield");
    let bytes = with_ix(
        &vector.bytes,
        SYSTEM_PROGRAM,
        &[pins().group],
        vec![4, 0, 0, 0],
    );
    let got = violations(&bytes, &vector.intent);
    assert!(got.contains(&Rule::InstructionCount), "{got:?}");
}

// ---- the dummy tag --------------------------------------------------------------------------

#[test]
fn a_dummy_may_name_the_group_key_that_signs_as_owner_when_no_real_output_pays_it() {
    // The circuit takes the owner signers without the payer as participants. The fee key pays
    // and the group key is the owner signer, so the group is one. The SDK names it in every
    // dummy (`dummyOwnerTag`), also in a withdrawal of everything that keeps no change.
    use common::fixture::{Fixture, Spec};
    use p3_check::plan::Role;
    let mut spec = Spec::withdrawal();
    spec.withdraw = 100;
    let mut fixture = Fixture::build(&spec);
    fixture.plan.outputs[0].role = Role::Dummy;
    fixture.resync();
    assert!(fixture.rules().is_empty());
}
