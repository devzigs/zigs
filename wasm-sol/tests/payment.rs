//! The program design of ZOLANA.md 7.2 in the checker: the approval of a payment (the rules of a
//! spend on the first proof, `private_tx_hash`, the commitment, the body and the proposal
//! account, one body per commitment), the `create` and `execute` messages that a fee key signs,
//! the beta policy (the move to the PDA is the one nonce payment), and a FROST group that signs
//! the approval digest and then pays an `execute` of a fresh proof with it.

#[path = "support/ceremony.rs"]
mod ceremony;
mod common;

use std::collections::BTreeMap;

use common::fixture::*;
use common::{flags_of, mutate, rebuild, replace_key, with_flags, with_ix, ATTACKER, EXPIRY, NOW};
use p3_check::approve::Device;
use p3_check::beta::{approve_message, approve_payment, Signer};
use p3_check::consts::{Key, INSTRUCTIONS_SYSVAR, MULTISIG_DEVNET, SYSTEM_PROGRAM};
use p3_check::fixed::parse_deposit;
use p3_check::intent::{Intent, Payee, Program};
use p3_check::pay::{Account, Chain, Payment, Recipient, RecipientAccount, Seen};
use p3_check::pins::Pins;
use p3_check::plan::{Plan, Proposal, Role};
use p3_check::program::{
    approval_digest, cancellation_address, commitment, proposal_address, settlements, Body,
    KIND_PROPOSAL,
};
use p3_check::rule::Rule;
use p3_check::sign::{self, verify_strict, ApprovalCheck, Check};
use p3_check::template::{body_of, compile, limits, LOADED_MIN_PROPOSE};
use p3_check::transact::OwnerTag;
use p3_check::v1;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

// ---- helpers ----------------------------------------------------------------------------------

fn device(f: &Fixture) -> Device<'_> {
    Device {
        pins: &f.pins,
        snapshot: &f.snapshot,
        now: NOW,
    }
}

/// The public recipient of the payment of `f`, none for a private payment.
fn recipient_of(f: &Fixture) -> Option<Key> {
    f.intent.pay().and_then(|pay| pay.recipient())
}

/// The body that the payment of `f` must have, and its account as `create` writes it.
fn want_body(f: &Fixture) -> (Body, Key, u8) {
    let pda = f.pins.for_pda().unwrap();
    let private = f.tx.private_tx_hash;
    let settled = settlements(&pda.sol_interface, recipient_of(f));
    let commitment = commitment(&private, &f.tx, &settled).unwrap();
    let body = body_of(&pda, commitment, EXPIRY, PAYER);
    let bytes = body.write().unwrap();
    let (address, bump) = proposal_address(&f.pins.multisig, &commitment, &bytes).unwrap();
    (body, address, bump)
}

fn account_of(body: &Body, bump: u8) -> Account {
    Account {
        owner: MULTISIG_DEVNET,
        data: [&[KIND_PROPOSAL, bump][..], &body.write().unwrap()].concat(),
    }
}

/// What a device sees once the proposal account of `f` exists.
fn seen(f: &Fixture) -> Seen {
    let (body, _, bump) = want_body(f);
    Seen {
        account: Some(account_of(&body, bump)),
        approved: Vec::new(),
    }
}

/// The rent-exempt minimum of an account with no data in the tests.
const RENT_MIN: u64 = 890_880;

/// What a device reads of the recipient of a withdrawal: an ordinary System account that holds
/// the rent minimum. None for a private payment.
fn read_of(f: &Fixture) -> Option<Recipient> {
    recipient_of(f).map(|_| Recipient {
        account: Some(RecipientAccount {
            owner: SYSTEM_PROGRAM,
            lamports: RENT_MIN,
            executable: false,
        }),
        rent_min: RENT_MIN,
    })
}

fn pay(f: &Fixture, seen: &Seen) -> Result<Payment, Vec<Rule>> {
    pay_read(f, seen, read_of(f).as_ref())
}

fn pay_read(f: &Fixture, seen: &Seen, read: Option<&Recipient>) -> Result<Payment, Vec<Rule>> {
    approve_payment(&f.proposal(), &device(f), seen, read)
        .map_err(|refusal| refusal.violations.iter().map(|v| v.rule).collect())
}

fn rules(f: &Fixture, seen: &Seen) -> Vec<Rule> {
    pay(f, seen).err().unwrap_or_default()
}

/// A stored body with one change.
fn seen_with(f: &Fixture, change: impl FnOnce(&mut Body)) -> Seen {
    let (mut body, _, bump) = want_body(f);
    change(&mut body);
    Seen {
        account: Some(account_of(&body, bump)),
        approved: Vec::new(),
    }
}

fn payment() -> Fixture {
    Fixture::payment(&Spec::transfer())
}

// ---- the approval of a payment ---------------------------------------------------------------

#[test]
fn a_payment_of_the_pda_is_approved_with_its_commitment_proposal_and_digest() {
    let f = payment();
    let (body, address, _) = want_body(&f);
    let got = pay(&f, &seen(&f)).expect("approved");
    assert_eq!(got.commitment, body.commitment);
    assert_eq!(got.body, body.write().unwrap());
    assert_eq!(got.proposal, address);
    assert_eq!(got.digest, approval_digest(&address, &got.body));
    assert_eq!(body.group, GROUP);
    assert_eq!(body.expiry, EXPIRY);
    assert_eq!(
        (body.rent_recipient, body.authorities),
        (PAYER, vec![PAYER])
    );
    assert_eq!(sum(&got.summary.paid), 40);
    assert_eq!(sum(&got.summary.change), 60);
}

fn sum(list: &[p3_check::spend::Amount]) -> u64 {
    list.iter().map(|a| a.amount).sum()
}

#[test]
fn a_payment_of_more_inputs_than_one_execute_carries_is_refused() {
    let wide = |n: usize| {
        let spec = Spec {
            inputs: vec![(SOL, 10); n],
            ..Spec::transfer()
        };
        let f = Fixture::payment(&spec);
        rules(&f, &seen(&f))
    };
    assert_eq!(
        wide(16),
        Vec::<Rule>::new(),
        "16 inputs: one execute carries them"
    );
    assert_eq!(
        wide(24),
        vec![Rule::ExecuteInputs],
        "24 inputs: no execute carries them"
    );
}

#[test]
fn the_wasm_entry_runs_the_chain_rules_once_the_device_read_the_account() {
    let f = payment();
    let entry = |seen: Option<Seen>| {
        let w = wires(&f, &self::seen(&f));
        let chain = Chain {
            seen,
            recipient: None,
        };
        p3_check::wasm::check_payment(&w[0], &w[1], &w[2], &chain.encode().unwrap(), NOW)
    };
    let none = Seen {
        account: None,
        approved: Vec::new(),
    };
    assert!(
        entry(None).starts_with("accepted"),
        "the draft of the proposer: no proposal account yet"
    );
    assert!(entry(Some(seen(&f))).starts_with("accepted"));
    let missing = entry(Some(none));
    assert!(
        missing.starts_with("refused") && missing.contains("account-owner"),
        "{missing}"
    );
}

#[test]
fn a_private_tx_hash_that_is_not_the_recompute_is_refused() {
    let mut f = payment();
    f.tx.private_tx_hash[31] ^= 1;
    assert!(rules(&f, &seen(&f)).contains(&Rule::PrivateTxHash));
    // Another root seed in the plan: the blindings fail, and so does the recompute.
    let mut f = payment();
    f.plan.blinding_seed = common::field(1);
    assert!(rules(&f, &seen(&f)).contains(&Rule::PrivateTxHash));
}

#[test]
fn the_commitment_binds_the_inputs_of_the_snapshot() {
    // An input of the snapshot with another amount: the nullifiers differ, and the recompute of
    // private_tx_hash, which the commitment holds, differs too.
    let mut f = payment();
    f.snapshot.inputs[0].amount += 1;
    let got = rules(&f, &seen(&f));
    assert!(got.contains(&Rule::NullifierMismatch), "{got:?}");
    assert!(got.contains(&Rule::PrivateTxHash), "{got:?}");
}

#[test]
fn the_change_of_a_payment_must_use_the_derived_pda_key() {
    // The change slot committed to the PDA with the zero nullifier key: the device recomputes
    // the slot with the derived key and refuses the hash.
    let mut f = payment();
    let at = f
        .plan
        .outputs
        .iter()
        .position(|o| o.role == Role::Change)
        .unwrap();
    let zero_key = p3_check::hashes::nullifier_pk(&[0; 31]).unwrap();
    let slot = &f.plan.outputs[at];
    f.tx.outputs[at].utxo_hash = p3_check::hashes::Utxo {
        owner_hash: p3_check::hashes::owner_hash(&pda_wallet().signer, &zero_key).unwrap(),
        mint: slot.mint,
        amount: slot.amount,
        blinding: slot.blinding,
    }
    .hash(p3_check::hashes::TREE_ID)
    .unwrap();
    f.reprove();
    assert!(rules(&f, &seen(&f)).contains(&Rule::OutputHash));
}

#[test]
fn a_device_with_the_group_key_secret_does_not_derive_the_pda_key() {
    let mut f = payment();
    f.snapshot.nullifier_secret = group().nullifier_secret;
    assert!(rules(&f, &seen(&f)).contains(&Rule::GroupNullifierPk));
}

#[test]
fn an_output_that_names_an_account_index_is_refused() {
    // The program requires inline owner tags; the payment has no account to index.
    let mut f = payment();
    f.tx.outputs[0].owner_tag = OwnerTag::Account(0);
    assert!(rules(&f, &seen(&f)).contains(&Rule::OutputOwnerTag));
}

#[test]
fn the_pool_expiry_must_be_the_expiry_of_the_payment() {
    let mut f = payment();
    f.tx.expiry -= 1;
    assert!(rules(&f, &seen(&f)).contains(&Rule::ExpiryNotIntent));
}

#[test]
fn a_missing_or_foreign_proposal_account_is_refused() {
    let f = payment();
    let none = Seen::default();
    assert_eq!(rules(&f, &none), vec![Rule::AccountOwner]);
    let mut foreign = seen(&f);
    foreign.account.as_mut().unwrap().owner = SYSTEM_PROGRAM;
    assert_eq!(rules(&f, &foreign), vec![Rule::AccountOwner]);
}

#[test]
fn an_account_of_another_kind_bump_or_length_is_refused() {
    let f = payment();
    for change in [
        |data: &mut Vec<u8>| data[0] = 2,
        |data: &mut Vec<u8>| data[1] ^= 1,
        |data: &mut Vec<u8>| data.truncate(100),
        |data: &mut Vec<u8>| data.push(0),
    ] {
        let mut s = seen(&f);
        change(&mut s.account.as_mut().unwrap().data);
        assert_eq!(rules(&f, &s), vec![Rule::AccountData]);
    }
}

#[test]
fn each_field_of_the_stored_body_must_be_the_body_of_the_payment() {
    let f = payment();
    type Change = fn(&mut Body);
    let cases: [(Change, Rule); 6] = [
        (|b| b.commitment[0] ^= 1, Rule::BodyCommitment),
        (|b| b.group[0] ^= 1, Rule::BodyGroup),
        (|b| b.expiry += 1, Rule::BodyExpiry),
        (|b| b.rent_recipient = ATTACKER, Rule::RentRecipient),
        (
            |b| b.authorities = vec![PAYER, ATTACKER],
            Rule::AbortAuthorities,
        ),
        (|b| b.authorities = Vec::new(), Rule::AbortAuthorities),
    ];
    for (change, rule) in cases {
        assert_eq!(rules(&f, &seen_with(&f, change)), vec![rule], "{rule:?}");
    }
}

#[test]
fn a_rent_recipient_that_is_an_address_of_the_program_is_refused() {
    // The addresses of error 6021. A body cannot name its own proposal or record address: the
    // address binds the body hash.
    let banned = [pda_wallet().signer, MULTISIG_DEVNET, SYSTEM_PROGRAM];
    for key in banned {
        let mut g = payment();
        g.pins.payer = key;
        let got = rules(&g, &seen_with(&g, |b| b.rent_recipient = key));
        assert!(got.contains(&Rule::RentRecipient), "{got:?}");
    }
}

#[test]
fn a_second_body_for_an_approved_commitment_is_refused() {
    let f = payment();
    let (body, _, _) = want_body(&f);
    let hash: Key = Sha256::digest(body.write().unwrap()).into();
    let mut same = seen(&f);
    same.approved = vec![(body.commitment, hash)];
    assert!(pay(&f, &same).is_ok(), "the same body again");
    let mut other = seen(&f);
    other.approved = vec![(body.commitment, [7; 32]), ([1; 32], [2; 32])];
    assert_eq!(rules(&f, &other), vec![Rule::BodyOnce]);
}

#[test]
fn the_seen_wire_reads_back_and_refuses_trailing_bytes() {
    let mut s = seen(&payment());
    s.approved = vec![([3; 32], [4; 32])];
    let wire = s.encode().unwrap();
    assert_eq!(Seen::decode(&wire).unwrap(), s);
    assert!(Seen::decode(&[wire.as_slice(), &[0]].concat()).is_err());
    assert!(Seen::decode(&[2, 0, 0]).is_err(), "a flag of 2");
    assert_eq!(Seen::decode(&[0, 0, 0]).unwrap(), Seen::default());
}

#[test]
fn the_proposal_wire_carries_the_transact_data_of_a_payment() {
    let f = payment();
    let bytes = f.proposal().encode().unwrap();
    let back = Proposal::decode(&bytes).unwrap();
    assert_eq!(back.intent, f.intent);
    assert_eq!(back.transact, f.tx.write().unwrap());
    assert!(Proposal::decode(&bytes[..bytes.len() - 1]).is_err());
}

// ---- the create message ----------------------------------------------------------------------

fn propose_of(f: &Fixture, commitment: Key) -> (Proposal, Vec<u8>) {
    let Intent::Program(Program::Approve { pay }) = f.intent.clone() else {
        panic!("a payment");
    };
    let intent = Intent::Program(Program::Propose {
        pay,
        commitment,
        blockhash: [5; 32],
    });
    let pda = f.pins.for_pda().unwrap();
    let message = v1::write(&compile(&intent, &pda, None).unwrap()).unwrap();
    let proposal = Proposal {
        intent,
        ..f.proposal()
    };
    (proposal, message)
}

#[test]
fn the_create_message_carries_the_body_of_the_payment_and_the_fee_key_signs_it_alone() {
    let f = payment();
    let (body, address, _) = want_body(&f);
    let (proposal, message) = propose_of(&f, body.commitment);
    approve_message(&message, &proposal, &device(&f), Signer::Fee).expect("approved");
    let msg = v1::parse(&message).unwrap();
    assert_eq!(msg.header[0], 1, "one signature: the payer");
    assert_eq!(msg.ixs.len(), 1);
    let ix = &msg.ixs[0];
    assert_eq!(msg.program_key(ix), Some(&MULTISIG_DEVNET));
    assert_eq!(ix.data, [&[0u8][..], &body.write().unwrap()].concat());
    let keys: Vec<Key> = (0..3).map(|at| *msg.account_key(ix, at).unwrap()).collect();
    assert_eq!(keys, vec![PAYER, address, SYSTEM_PROGRAM]);
    let writable = |k: Key| msg.is_writable(msg.keys.iter().position(|x| *x == k).unwrap());
    assert_eq!(
        keys.iter().map(|k| writable(*k)).collect::<Vec<_>>(),
        vec![true, true, false],
        "the payer funds the proposal account, which the program writes"
    );
    let why = approve_message(&message, &proposal, &device(&f), Signer::Group).unwrap_err();
    assert_eq!(why.violations[0].rule, Rule::IntentRetired);
}

#[test]
fn a_create_message_for_another_commitment_is_refused() {
    let f = payment();
    let (proposal, message) = propose_of(&f, [9; 32]);
    let why = approve_message(&message, &proposal, &device(&f), Signer::Fee).unwrap_err();
    let got: Vec<Rule> = why.violations.iter().map(|v| v.rule).collect();
    assert_eq!(got, vec![Rule::BodyCommitment]);
}

#[test]
fn a_create_message_of_a_payment_that_breaks_a_rule_is_refused() {
    let mut f = payment();
    let (body, _, _) = want_body(&f);
    f.tx.private_tx_hash[0] ^= 1;
    let (proposal, message) = propose_of(&f, body.commitment);
    let why = approve_message(&message, &proposal, &device(&f), Signer::Fee).unwrap_err();
    assert!(why.violations.iter().any(|v| v.rule == Rule::PrivateTxHash));
}

// ---- Add SOL and the beta policy -------------------------------------------------------------

fn shield_message(pins: &Pins) -> (Proposal, Vec<u8>) {
    let intent = Intent::Shield {
        blockhash: [5; 32],
        amount: 1_000,
    };
    let message = v1::write(&compile(&intent, pins, None).unwrap()).unwrap();
    let proposal = Proposal {
        intent,
        plan: Plan::default(),
        transact: Vec::new(),
    };
    (proposal, message)
}

#[test]
fn add_sol_deposits_to_the_pda_identity_and_not_to_the_group_key() {
    let f = payment();
    let pda = f.pins.for_pda().unwrap();
    let (proposal, message) = shield_message(&pda);
    let mut snapshot = f.snapshot.clone();
    snapshot.inputs.clear();
    let device = Device {
        pins: &f.pins,
        snapshot: &snapshot,
        now: NOW,
    };
    approve_message(&message, &proposal, &device, Signer::Fee).expect("approved");
    let msg = v1::parse(&message).unwrap();
    let entry = &parse_deposit(&msg.ixs[0].data).unwrap().entries[0];
    assert_eq!(entry.owner, pda_wallet().owner_hash());
    assert_eq!(entry.view_tag, pda_wallet().signer);
    // A deposit to the group key, as the beta made it, is refused.
    let (old, old_message) = shield_message(&f.pins);
    let why = approve_message(&old_message, &old, &device, Signer::Fee).unwrap_err();
    let got: Vec<Rule> = why.violations.iter().map(|v| v.rule).collect();
    // The field rules name the first field that differs: the owner.
    assert_eq!(got, vec![Rule::ShieldOwner]);
}

fn migration_check(f: &Fixture, signer: Signer) -> Vec<Rule> {
    let proposal = Proposal {
        intent: f.intent.clone(),
        plan: f.plan.clone(),
        transact: Vec::new(),
    };
    approve_message(&f.bytes(), &proposal, &device(f), signer)
        .err()
        .map(|r| r.violations.iter().map(|v| v.rule).collect())
        .unwrap_or_default()
}

#[test]
fn the_move_to_the_pda_is_the_one_nonce_payment_that_both_keys_sign() {
    let f = Fixture::migration();
    assert_eq!(migration_check(&f, Signer::Group), Vec::<Rule>::new());
    assert_eq!(migration_check(&f, Signer::Fee), Vec::<Rule>::new());
}

#[test]
fn a_nonce_payment_to_another_payee_or_with_change_is_refused() {
    let to_payee = Fixture::build(&Spec::transfer());
    assert_eq!(
        migration_check(&to_payee, Signer::Group),
        vec![Rule::MigrationPayee]
    );
    let with_change = Fixture::build_for(&Spec::transfer(), GROUP, group(), pda_wallet());
    assert_eq!(
        migration_check(&with_change, Signer::Fee),
        vec![Rule::MigrationPayee]
    );
    // The PDA address with another nullifier key, or the Ed25519 tag on the PDA bytes.
    let mut other = pda_wallet();
    other.nullifier_secret = [0x4e; 31];
    let f = Fixture::build_for(&Spec::migration(), GROUP, group(), other);
    assert_eq!(
        migration_check(&f, Signer::Group),
        vec![Rule::MigrationPayee]
    );
    let mut tagged = pda_wallet();
    tagged.tag = 1;
    let f = Fixture::build_for(&Spec::migration(), GROUP, group(), tagged);
    assert_eq!(
        migration_check(&f, Signer::Group),
        vec![Rule::MigrationPayee]
    );
}

#[test]
fn nothing_signs_a_withdrawal_a_register_or_a_cancel_and_the_group_key_signs_no_program_message() {
    let f = Fixture::build(&Spec::withdrawal());
    for signer in [Signer::Group, Signer::Fee] {
        assert!(migration_check(&f, signer).starts_with(&[Rule::IntentRetired]));
    }
    let (nk, vk) = group().keys();
    let plain = [
        Intent::Register {
            nonce: [9; 32],
            nullifier_pk: nk,
            viewing_pk: vk,
        },
        Intent::Cancel { nonce: [9; 32] },
    ];
    for intent in plain {
        let message = v1::write(&compile(&intent, &f.pins, None).unwrap()).unwrap();
        let proposal = Proposal {
            intent,
            plan: Plan::default(),
            transact: Vec::new(),
        };
        for signer in [Signer::Group, Signer::Fee] {
            let why = approve_message(&message, &proposal, &device(&f), signer).unwrap_err();
            assert_eq!(why.violations[0].rule, Rule::IntentRetired);
        }
    }
    let (proposal, message) = shield_message(&f.pins.for_pda().unwrap());
    let why = approve_message(&message, &proposal, &device(&f), Signer::Group).unwrap_err();
    assert_eq!(why.violations[0].rule, Rule::IntentRetired);
}

// ---- the approval of a FROST group, then the execute -----------------------------------------

/// A 2-of-3 group of the real ceremony and a payment of its PDA.
fn signed_payment() -> (ceremony::Group, Fixture, Payment, [u8; 64]) {
    signed(&Spec::transfer())
}

/// A payment of `spec` that seats 1 and 3 of a real 2-of-3 group approved.
fn signed(spec: &Spec) -> (ceremony::Group, Fixture, Payment, [u8; 64]) {
    let group = ceremony::run(ceremony::WALLET, 2, 3);
    let key: Key = ceremony::unhex32(&group.done[0].group_key);
    let f = Fixture::payment_for(spec, key);
    let s = seen(&f);
    let got = pay(&f, &s).expect("approved");
    let signature = approve_with(&group, &f, &s, &got, &[1, 3]).expect("signed");
    (group, f, got, signature)
}

fn approval_input<'a>(f: &'a [Vec<u8>; 4]) -> ApprovalCheck<'a> {
    ApprovalCheck {
        check: Check {
            intent: &f[0],
            pins: &f[1],
            snapshot: &f[2],
        },
        chain: &f[3],
    }
}

fn wires(f: &Fixture, seen: &Seen) -> [Vec<u8>; 4] {
    let chain = Chain {
        seen: Some(seen.clone()),
        recipient: read_of(f),
    };
    [
        f.proposal().encode().unwrap(),
        f.pins.wire(),
        f.snapshot.encode().unwrap(),
        chain.encode().unwrap(),
    ]
}

/// The seats make nonces for the digest, sign their shares and combine them.
fn approve_with(
    group: &ceremony::Group,
    f: &Fixture,
    seen: &Seen,
    got: &Payment,
    seats: &[u16],
) -> Result<[u8; 64], String> {
    let digest = p3_check::bytes::hex(&got.digest);
    let (mut nonces, mut commitments) = (BTreeMap::new(), BTreeMap::new());
    for seat in seats {
        let package = &group.done[usize::from(*seat) - 1].key_package;
        let made: Value = serde_json::from_str(&sign::nonces(package, &digest)?).unwrap();
        nonces.insert(*seat, made["nonces"].as_str().unwrap().to_string());
        commitments.insert(*seat, made["commitments"].as_str().unwrap().to_string());
    }
    let w = wires(f, seen);
    let mut shares = BTreeMap::new();
    for seat in seats {
        let round = ceremony::round_of(group, *seat, &nonces[seat], &commitments);
        let made: Value =
            serde_json::from_str(&sign::approval_share(&approval_input(&w), &round)?).unwrap();
        assert_eq!(made["digest"], json!(digest));
        shares.insert(*seat, made["share"].as_str().unwrap().to_string());
    }
    let signature = sign::aggregate(
        &got.digest,
        &group.done[0].public_key_package,
        &ceremony::map_json(&commitments),
        &ceremony::map_json(&shares),
    )?;
    Ok(hex::decode(signature).unwrap().try_into().unwrap())
}

#[test]
fn a_2_of_3_group_signs_the_approval_digest_and_it_verifies_strictly() {
    let (_, f, got, signature) = signed_payment();
    verify_strict(&f.pins.multisig, &got.digest, &signature).expect("verify_strict");
}

#[test]
fn a_share_needs_the_proposal_account_and_nonces_of_the_same_digest() {
    let group = ceremony::run(ceremony::WALLET, 2, 3);
    let key: Key = ceremony::unhex32(&group.done[0].group_key);
    let f = Fixture::payment_for(&Spec::transfer(), key);
    let got = pay(&f, &seen(&f)).unwrap();
    let why = approve_with(&group, &f, &Seen::default(), &got, &[1, 2]).unwrap_err();
    assert!(why.contains("account-owner"), "{why}");
    let mut other = got.clone();
    other.digest[0] ^= 1;
    let why = approve_with(&group, &f, &seen(&f), &other, &[1, 2]).unwrap_err();
    assert!(
        why.contains("nonces were made for another approval"),
        "{why}"
    );
}

#[test]
fn a_key_package_of_another_group_gets_no_share_of_the_payment() {
    let group = ceremony::run(ceremony::WALLET, 2, 3);
    let f = payment();
    let got = pay(&f, &seen(&f)).unwrap();
    let why = approve_with(&group, &f, &seen(&f), &got, &[1, 2]).unwrap_err();
    assert!(why.contains("not the pinned group key"), "{why}");
}

fn execute_of(f: &Fixture, signature: [u8; 64], payer: Key) -> (Proposal, Vec<u8>, Pins) {
    execute_to(f, (signature, payer), recipient_of(f))
}

/// The execute of `f` with `recipient` in its intent (tag 11, or tag 7 when none).
fn execute_to(
    f: &Fixture,
    by: ([u8; 64], Key),
    recipient: Option<Key>,
) -> (Proposal, Vec<u8>, Pins) {
    let (signature, payer) = by;
    let intent = Intent::Program(Program::Execute {
        expiry: EXPIRY,
        rent_recipient: PAYER,
        signature,
        blockhash: [6; 32],
        recipient,
    });
    let mut pins = f.pins.clone();
    pins.payer = payer;
    let message = v1::write(&compile(&intent, &pins.for_pda().unwrap(), Some(&f.tx)).unwrap());
    let proposal = Proposal {
        intent,
        plan: Plan::default(),
        transact: Vec::new(),
    };
    (proposal, message.unwrap(), pins)
}

fn execute_rules(
    f: &Fixture,
    proposal: &Proposal,
    message: &[u8],
    pins: &Pins,
    now: u64,
) -> Vec<Rule> {
    let device = Device {
        pins,
        snapshot: &f.snapshot,
        now,
    };
    approve_message(message, proposal, &device, Signer::Fee)
        .err()
        .map(|r| r.violations.iter().map(|v| v.rule).collect())
        .unwrap_or_default()
}

const EXECUTOR: Key = [0x51; 32];

#[test]
fn any_seat_executes_a_fresh_proof_with_the_approval_and_pays_with_its_own_fee_key() {
    let (_, mut f, got, signature) = signed_payment();
    // A fresh proof: other proof bytes and root indices, the same commitment.
    f.tx.proof = [3; 192];
    f.tx.tree_contexts[0].utxo_root_index = 280;
    let (proposal, message, pins) = execute_of(&f, signature, EXECUTOR);
    assert_eq!(
        execute_rules(&f, &proposal, &message, &pins, NOW),
        Vec::<Rule>::new()
    );
    let msg = v1::parse(&message).unwrap();
    assert_eq!(msg.header[0], 1, "the executor signs alone");
    assert_eq!(msg.keys[0], EXECUTOR);
    let (approval, execute) = (&msg.ixs[0], &msg.ixs[1]);
    assert!(approval.accounts.is_empty());
    assert_eq!(&approval.data[112..], &got.digest);
    let at = |n: usize| *msg.account_key(execute, n).unwrap();
    assert_eq!(
        (at(0), at(1), at(2)),
        (
            EXECUTOR,
            got.proposal,
            pda_wallet_of(&f.pins.multisig).signer
        )
    );
    assert_eq!(at(4), PAYER, "the rent goes back to the proposing seat");
    assert_eq!(
        at(3),
        cancellation_address(&got.proposal).unwrap(),
        "the record"
    );
    assert_eq!(
        at(5),
        INSTRUCTIONS_SYSVAR,
        "the program reads the approval there"
    );
    let writable = |n: usize| msg.is_writable(msg.keys.iter().position(|k| *k == at(n)).unwrap());
    assert_eq!(
        (0..6).map(writable).collect::<Vec<_>>(),
        vec![true, true, false, false, true, false],
        "payer, proposal and rent recipient are writable; owner, record and sysvar are not"
    );
    assert_eq!(
        at(execute.accounts.len() - 1),
        at(2),
        "the owner PDA is the last account"
    );
    assert!(!msg.is_signer(msg.keys.iter().position(|k| *k == at(2)).unwrap()));
}

#[test]
fn an_execute_of_another_payment_body_or_signature_is_refused() {
    let (_, f, _, signature) = signed_payment();
    // Another payment: one output hash changes, so the commitment and the digest change.
    let mut other = Fixture::payment_for(&Spec::transfer(), f.pins.multisig);
    other.tx.outputs[1].utxo_hash[5] ^= 1;
    let (proposal, message, pins) = execute_of(&other, signature, EXECUTOR);
    let got = execute_rules(&other, &proposal, &message, &pins, NOW);
    assert_eq!(got, vec![Rule::ExecuteApproval]);
    let mut bad = signature;
    bad[40] ^= 1;
    let (proposal, message, pins) = execute_of(&f, bad, EXECUTOR);
    assert_eq!(
        execute_rules(&f, &proposal, &message, &pins, NOW),
        vec![Rule::ExecuteApproval]
    );
    let (mut proposal, _, pins) = execute_of(&f, signature, EXECUTOR);
    if let Intent::Program(Program::Execute { rent_recipient, .. }) = &mut proposal.intent {
        *rent_recipient = EXECUTOR;
    }
    let message =
        v1::write(&compile(&proposal.intent, &pins.for_pda().unwrap(), Some(&f.tx)).unwrap());
    let got = execute_rules(&f, &proposal, &message.unwrap(), &pins, NOW);
    assert_eq!(got, vec![Rule::ExecuteApproval]);
}

#[test]
fn an_execute_after_the_expiry_is_refused() {
    let (_, f, _, signature) = signed_payment();
    let (proposal, message, pins) = execute_of(&f, signature, EXECUTOR);
    let got = execute_rules(&f, &proposal, &message, &pins, EXPIRY);
    assert_eq!(got, vec![Rule::ExpiryNotIntent]);
}

#[test]
fn the_group_key_signs_no_execute_and_the_group_key_never_pays_one() {
    let (_, f, _, signature) = signed_payment();
    let (proposal, message, pins) = execute_of(&f, signature, EXECUTOR);
    let device = Device {
        pins: &pins,
        snapshot: &f.snapshot,
        now: NOW,
    };
    let why = approve_message(&message, &proposal, &device, Signer::Group).unwrap_err();
    assert_eq!(why.violations[0].rule, Rule::IntentRetired);
    let mut group_pays = pins.for_pda().unwrap();
    group_pays.payer = f.pins.multisig;
    assert!(compile(&proposal.intent, &group_pays, Some(&f.tx)).is_err());
}

#[test]
fn the_group_key_signs_no_add_sol_and_a_fee_key_signs_the_create_message_of_its_seat() {
    let group = ceremony::run(ceremony::WALLET, 2, 3);
    let key: Key = ceremony::unhex32(&group.done[0].group_key);
    let mut f = Fixture::payment_for(&Spec::transfer(), key);
    let (shield, message) = shield_message(&f.pins.for_pda().unwrap());
    let (pins, snapshot) = (f.pins.wire(), f.snapshot.encode().unwrap());
    let bytes = shield.encode().unwrap();
    let check = Check {
        intent: &bytes,
        pins: &pins,
        snapshot: &snapshot,
    };
    let (nonces, commitments) = ceremony::commit_all(&group, &[1, 2], &message);
    let round = ceremony::round_of(&group, 1, &nonces[&1], &commitments);
    let why = sign::sign_share(&message, &check, &round).unwrap_err();
    assert!(
        why.contains("intent-retired\tonly a fee key signs"),
        "{why}"
    );
    // The fee key of the proposing seat signs the create message of its payment.
    let fee = ed25519_dalek::SigningKey::from_bytes(&[0x21; 32]);
    f.pins.payer = fee.verifying_key().to_bytes();
    // The commitment does not depend on the payer.
    let (proposal, message) = propose_of(&f, want_body(&f).0.commitment);
    let (pins, bytes) = (f.pins.wire(), proposal.encode().unwrap());
    let check = Check {
        intent: &bytes,
        pins: &pins,
        snapshot: &snapshot,
    };
    let round = json!({"now": NOW, "secret": hex::encode([0x21; 32])}).to_string();
    let signature = p3_check::fee::sign(&message, &check, &round).expect("signed");
    assert!(p3_check::fee::verify(&hex::encode(f.pins.payer), &message, &signature).is_ok());
}

#[test]
fn an_ed25519_instruction_outside_an_execute_is_refused() {
    let f = payment();
    let (body, _, _) = want_body(&f);
    let (proposal, message) = propose_of(&f, body.commitment);
    let ed25519 = p3_check::consts::ED25519_PROGRAM;
    let extra = common::with_ix(&message, ed25519, &[], vec![0]);
    let why = approve_message(&extra, &proposal, &device(&f), Signer::Fee).unwrap_err();
    assert_eq!(why.violations[0].rule, Rule::ProgramNotAllowed, "{why:?}");
    // The approvals program with the execute tag in a create message.
    let execute = common::with_ix(&message, MULTISIG_DEVNET, &[], vec![1]);
    let why = approve_message(&execute, &proposal, &device(&f), Signer::Fee).unwrap_err();
    assert_eq!(
        why.violations[0].rule,
        Rule::InstructionNotAllowed,
        "{why:?}"
    );
}

#[test]
fn the_compile_entry_builds_add_sol_and_the_create_message_for_the_pda_identity() {
    let f = payment();
    let (shield, _) = shield_message(&f.pins);
    let bytes = p3_check::wasm::compile_proposal(&shield.encode().unwrap(), &f.pins.wire(), &[])
        .expect("compile");
    let msg = v1::parse(&bytes).unwrap();
    let entry = &parse_deposit(&msg.ixs[0].data).unwrap().entries[0];
    assert_eq!(
        entry.owner,
        pda_wallet().owner_hash(),
        "the deposit is owned by the PDA"
    );
    let (body, _, _) = want_body(&f);
    let (proposal, message) = propose_of(&f, body.commitment);
    let wire = proposal.encode().unwrap();
    let compiled = p3_check::wasm::compile_proposal(&wire, &f.pins.wire(), &[]).unwrap();
    assert_eq!(
        compiled, message,
        "the create message of the entry is the template's"
    );
}

// ---- withdrawals to a public address (SOL-32) --------------------------------------------------

/// The recipient of the withdrawal fixture.
const TO: Key = [0x33; 32];

fn withdrawal() -> Fixture {
    Fixture::payment(&Spec::withdrawal())
}

/// `f` with another recipient or amount in its approval.
fn with_pay(mut f: Fixture, change: impl FnOnce(&mut p3_check::intent::Pay)) -> Fixture {
    let Intent::Program(Program::Approve { pay }) = &mut f.intent else {
        panic!("an approval");
    };
    change(pay);
    f
}

fn to(f: Fixture, recipient: Key) -> Fixture {
    with_pay(f, |pay| pay.payee = Payee::Public(recipient))
}

#[test]
fn a_withdrawal_pays_its_public_recipient_and_the_screen_shows_the_recipient_and_the_leg() {
    let f = withdrawal();
    let got = pay(&f, &seen(&f)).expect("approved");
    assert_eq!(
        got.summary.recipient,
        Some(TO),
        "the recipient of the intent"
    );
    assert_eq!(got.summary.withdrawn, 30, "the amount of the leg");
    assert_eq!(sum(&got.summary.change), 70);
    assert!(got.summary.paid.is_empty(), "no shielded payee");
    let (body, address, _) = want_body(&f);
    assert_eq!((got.commitment, got.proposal), (body.commitment, address));
}

#[test]
fn the_commitment_of_a_withdrawal_binds_the_sol_interface_and_the_recipient() {
    let f = withdrawal();
    let sol = f.pins.for_pda().unwrap().sol_interface;
    let got = pay(&f, &seen(&f)).unwrap();
    let private = f.tx.private_tx_hash;
    let with = |settled: &[(Key, Key)]| commitment(&private, &f.tx, settled).unwrap();
    assert_eq!(got.commitment, with(&[(sol, TO)]));
    assert_ne!(
        got.commitment,
        with(&[]),
        "the settlement accounts are in the commitment"
    );
    let other = to(withdrawal(), [0x34; 32]);
    let moved = pay(&other, &seen(&other)).unwrap();
    assert_eq!(
        moved.commitment,
        with(&[(sol, [0x34; 32])]),
        "another recipient"
    );
    assert_ne!(moved.proposal, got.proposal, "and another proposal account");
}

#[test]
fn a_withdrawal_to_an_account_of_the_pool_the_program_or_the_group_is_refused() {
    let f = withdrawal();
    let p = f.pins.for_pda().unwrap();
    // `SHIELDED_POOL_CPI_AUTHORITY` of program-libs/interface/src/lib.rs at the pinned commit.
    let cpi: Key = [
        69, 71, 220, 185, 216, 143, 158, 144, 194, 192, 35, 58, 192, 36, 234, 87, 129, 254, 240,
        115, 136, 34, 89, 207, 13, 241, 99, 80, 189, 28, 84, 235,
    ];
    assert_eq!(
        p.cpi_authority().unwrap(),
        cpi,
        "the CPI authority of the pool"
    );
    let nullifier = p
        .nullifier_pda(&p.input_tree, &f.tx.inputs[0].nullifier)
        .unwrap();
    let banned = [
        p.pda,
        p.multisig,
        p.nonce_account,
        p.sol_interface,
        p.pool,
        p.registry,
        p.user_record,
        p.input_tree,
        p.output_tree,
        p.program,
        SYSTEM_PROGRAM,
        cpi,
        nullifier,
    ];
    for key in banned {
        let f = to(withdrawal(), key);
        let label = p.label(&key);
        assert_eq!(
            rules(&f, &seen(&f)),
            vec![Rule::WithdrawalRecipient],
            "{label}"
        );
    }
    // Every input of the transact: the nullifier PDA of the second one too.
    let spec = Spec {
        inputs: vec![(SOL, 50), (SOL, 50)],
        ..Spec::withdrawal()
    };
    let two = Fixture::payment(&spec);
    let second = p
        .nullifier_pda(&p.input_tree, &two.tx.inputs[1].nullifier)
        .unwrap();
    let f = to(Fixture::payment(&spec), second);
    assert_eq!(
        rules(&f, &seen(&f)),
        vec![Rule::WithdrawalRecipient],
        "the second input"
    );
}

#[test]
fn the_recipient_account_must_be_ordinary_and_hold_the_rent_minimum_after_the_withdrawal() {
    let f = withdrawal();
    let account = |owner: Key, lamports: u64, executable: bool| RecipientAccount {
        owner,
        lamports,
        executable,
    };
    let check = |account: Option<RecipientAccount>, rent_min: u64| {
        let read = Recipient { account, rent_min };
        pay_read(&f, &seen(&f), Some(&read))
            .err()
            .unwrap_or_default()
    };
    let (ok, refused) = (Vec::<Rule>::new(), vec![Rule::RecipientAccount]);
    let system = |lamports| Some(account(SYSTEM_PROGRAM, lamports, false));
    assert_eq!(
        check(system(70), 100),
        ok,
        "70 and the 30 of the leg reach 100"
    );
    assert_eq!(check(system(69), 100), refused, "69 and 30 stay below 100");
    assert_eq!(
        check(None, 30),
        ok,
        "a new account that the leg makes rent exempt"
    );
    assert_eq!(check(None, 31), refused, "a new account below the minimum");
    let owned = Some(account([9; 32], RENT_MIN, false));
    assert_eq!(check(owned, 0), refused, "an account of another program");
    let program = Some(account(SYSTEM_PROGRAM, RENT_MIN, true));
    assert_eq!(check(program, 0), refused, "an executable account");
    let none = pay_read(&f, &seen(&f), None).err().unwrap_or_default();
    assert_eq!(
        none, refused,
        "an approving device that read no recipient account"
    );
}

#[test]
fn the_proposer_checks_the_recipient_account_that_it_read() {
    let f = withdrawal();
    let w = wires(&f, &seen(&f));
    let entry = |recipient: Option<Recipient>| {
        let chain = Chain {
            seen: None,
            recipient,
        };
        p3_check::wasm::check_payment(&w[0], &w[1], &w[2], &chain.encode().unwrap(), NOW)
    };
    let accepted = entry(read_of(&f));
    assert!(accepted.starts_with("accepted"), "{accepted}");
    assert!(
        accepted.contains(&format!("\nrecipient {}", "33".repeat(32))),
        "{accepted}"
    );
    assert!(accepted.contains("\nwithdrawn 30\n"), "{accepted}");
    let poor = Recipient {
        account: None,
        rent_min: 31,
    };
    let refused = entry(Some(poor));
    assert!(refused.contains("recipient-account"), "{refused}");
    let unread = entry(None);
    assert!(
        unread.contains("did not read the recipient account"),
        "{unread}"
    );
}

#[test]
fn the_chain_wire_reads_back_and_refuses_bad_flags_and_trailing_bytes() {
    let read = Recipient {
        account: Some(RecipientAccount {
            owner: [1; 32],
            lamports: 5,
            executable: true,
        }),
        rent_min: 9,
    };
    let f = withdrawal();
    let both = Chain {
        seen: Some(seen(&f)),
        recipient: Some(read.clone()),
    };
    let new = Chain {
        seen: None,
        recipient: Some(Recipient {
            account: None,
            rent_min: 9,
        }),
    };
    for chain in [both, new, Chain::default()] {
        assert_eq!(Chain::decode(&chain.encode().unwrap()).unwrap(), chain);
    }
    let only = Chain {
        seen: None,
        recipient: Some(read),
    }
    .encode()
    .unwrap();
    assert_eq!(only.len(), 2 + 1 + 32 + 8 + 1 + 8);
    let bad = |at: usize, why: &str| {
        let mut bytes = only.clone();
        bytes[at] = 2;
        assert!(Chain::decode(&bytes).is_err(), "{why}");
    };
    bad(0, "a seen flag of 2");
    bad(1, "a recipient flag of 2");
    bad(2, "an account flag of 2");
    bad(2 + 1 + 32 + 8, "an executable flag of 2");
    let mut long = only.clone();
    long.push(0);
    assert!(Chain::decode(&long).is_err(), "a trailing byte");
}

#[test]
fn the_create_message_of_a_withdrawal_needs_no_read_and_keeps_the_ban() {
    // Tag 9: the proposer checked the recipient read in `check_payment` before this message.
    let f = withdrawal();
    let (body, _, _) = want_body(&f);
    let (proposal, message) = propose_of(&f, body.commitment);
    assert_eq!(
        proposal.intent.encode()[0],
        9,
        "the create message of a withdrawal"
    );
    approve_message(&message, &proposal, &device(&f), Signer::Fee).expect("approved");
    let banned = to(withdrawal(), f.pins.for_pda().unwrap().sol_interface);
    let (body, _, _) = want_body(&banned);
    let (proposal, message) = propose_of(&banned, body.commitment);
    let why = approve_message(&message, &proposal, &device(&banned), Signer::Fee).unwrap_err();
    let found: Vec<Rule> = why.violations.iter().map(|v| v.rule).collect();
    assert!(found.contains(&Rule::WithdrawalRecipient), "{found:?}");
}

#[test]
fn a_withdrawal_whose_leg_is_not_the_amount_of_the_intent_is_refused() {
    let f = with_pay(withdrawal(), |pay| pay.amount = 31);
    assert!(rules(&f, &seen(&f)).contains(&Rule::LegMismatch));
    let as_withdrawal = to(payment(), TO);
    let found = rules(&as_withdrawal, &seen(&as_withdrawal));
    assert!(
        found.contains(&Rule::LegMismatch),
        "a transfer has no leg: {found:?}"
    );
}

#[test]
fn a_withdrawal_spends_at_most_16_inputs() {
    let wide = |base: Spec, n: usize| {
        let spec = Spec {
            inputs: vec![(SOL, 10); n],
            ..base
        };
        let f = Fixture::payment(&spec);
        rules(&f, &seen(&f))
    };
    let ok = Vec::<Rule>::new();
    assert_eq!(
        wide(Spec::withdrawal(), 16),
        ok,
        "16 inputs and one leg fit the 24 accounts"
    );
    // No circuit takes 17 to 23 inputs, so the cap of the leg shows next to the shape rule.
    let shape = vec![Rule::UnsupportedShape];
    assert_eq!(wide(Spec::transfer(), 17), shape, "a payment of 17 inputs");
    let both = vec![Rule::UnsupportedShape, Rule::ExecuteInputs];
    assert_eq!(
        wide(Spec::withdrawal(), 17),
        both,
        "a withdrawal of 17 inputs"
    );
}

#[test]
fn the_execute_of_a_withdrawal_adds_the_sol_interface_and_the_recipient_after_the_owner_pda() {
    let (_, f, got, signature) = signed(&Spec::withdrawal());
    let (proposal, message, pins) = execute_of(&f, signature, EXECUTOR);
    assert_eq!(
        execute_rules(&f, &proposal, &message, &pins, NOW),
        Vec::<Rule>::new()
    );
    let msg = v1::parse(&message).unwrap();
    let execute = &msg.ixs[1];
    let n = execute.accounts.len();
    let at = |i: usize| *msg.account_key(execute, i).unwrap();
    let owner = pda_wallet_of(&f.pins.multisig).signer;
    let sol = pins.for_pda().unwrap().sol_interface;
    assert_eq!((at(n - 3), at(n - 2), at(n - 1)), (owner, sol, TO));
    let writable = |key: Key| msg.is_writable(msg.keys.iter().position(|k| *k == key).unwrap());
    assert_eq!(
        (writable(owner), writable(sol), writable(TO)),
        (false, true, true),
        "the pool moves the SOL from the interface to the recipient"
    );
    assert_eq!(&msg.ixs[0].data[112..], &got.digest);
}

#[test]
fn an_execute_of_a_withdrawal_to_another_recipient_or_with_no_recipient_is_refused() {
    let (_, f, _, signature) = signed(&Spec::withdrawal());
    let by = (signature, EXECUTOR);
    let (proposal, message, pins) = execute_to(&f, by, Some([0x34; 32]));
    assert_eq!(
        execute_rules(&f, &proposal, &message, &pins, NOW),
        vec![Rule::ExecuteApproval],
        "the approval binds the recipient"
    );
    let (proposal, message, pins) = execute_to(&f, by, None);
    assert_eq!(
        execute_rules(&f, &proposal, &message, &pins, NOW),
        vec![Rule::ExecuteApproval],
        "an execute of tag 7 has no settlement accounts"
    );
}

#[test]
fn the_intents_of_a_withdrawal_have_tags_9_to_11_and_read_back() {
    let Intent::Program(Program::Approve { pay }) = withdrawal().intent else {
        panic!("an approval");
    };
    let approve = Intent::Program(Program::Approve { pay: pay.clone() });
    let propose = Intent::Program(Program::Propose {
        pay,
        commitment: [7; 32],
        blockhash: [8; 32],
    });
    let execute = |recipient| {
        Intent::Program(Program::Execute {
            expiry: EXPIRY,
            rent_recipient: PAYER,
            signature: [5; 64],
            blockhash: [6; 32],
            recipient,
        })
    };
    for (intent, tag, len) in [
        (approve, 10, 51),
        (propose, 9, 115),
        (execute(Some(TO)), 11, 169),
        (execute(None), 7, 137),
    ] {
        let bytes = intent.encode();
        assert_eq!((bytes[0], bytes.len()), (tag, len), "{}", intent.name());
        assert_eq!(Intent::decode(&bytes).unwrap(), intent);
    }
    let private = payment().intent.encode();
    assert_eq!(
        (private[0], private.len()),
        (8, 150),
        "a private payment keeps tag 8"
    );
}

// ---- the messages that give a rent back to the fee key (SOL-52) --------------------------------

const FEE_SECRET: [u8; 32] = [0x21; 32];
const COMMITMENT: Key = [0x77; 32];
/// The floor and the cap of `cancel` and `close_cancelled` (LiteSVM, CHECKER_PIN).
const RECLAIM_CU: (u32, u32) = (21_802, 32_703);

/// The proposal of the fee key of `f`: the body names it as rent recipient and abort authority.
fn proposal_of(f: &Fixture) -> Key {
    let body = body_of(&f.pins.for_pda().unwrap(), COMMITMENT, EXPIRY, f.pins.payer);
    let (key, _) = proposal_address(&f.pins.multisig, &COMMITMENT, &body.write().unwrap()).unwrap();
    key
}

fn record_of(f: &Fixture) -> Key {
    cancellation_address(&proposal_of(f)).unwrap()
}

/// The wire form that the page writes: the tag, then the fields in order, then the blockhash.
fn cancel_wire(commitment: Key, expiry: u64) -> Vec<u8> {
    [&[12][..], &commitment, &expiry.to_le_bytes(), &[5; 32]].concat()
}

fn close_wire(proposal: Key) -> Vec<u8> {
    [&[13][..], &proposal, &[5; 32]].concat()
}

/// `cancel` and `close_cancelled` of the fixture, each with its template message.
fn reclaim_cases(f: &Fixture) -> Vec<(Intent, Vec<u8>)> {
    let pda = f.pins.for_pda().unwrap();
    let wires = [cancel_wire(COMMITMENT, EXPIRY), close_wire(proposal_of(f))];
    let intents = wires.iter().map(|wire| Intent::decode(wire).unwrap());
    let message = |intent: &Intent| v1::write(&compile(intent, &pda, None).unwrap()).unwrap();
    intents
        .map(|intent| (intent.clone(), message(&intent)))
        .collect()
}

/// The rules that refuse `message` for `signer`, none if it is approved.
fn reclaim_rules(f: &Fixture, intent: &Intent, message: &[u8], signer: Signer) -> Vec<Rule> {
    let proposal = Proposal::decode(&intent.encode()).unwrap();
    let refusal = approve_message(message, &proposal, &device(f), signer).err();
    refusal.map_or(vec![], |r| r.violations.iter().map(|v| v.rule).collect())
}

/// The fee key refuses both messages after `change`, each with `rule`.
fn refused_by(rule: Rule, change: impl Fn(&Fixture, &[u8]) -> Vec<u8>) {
    let f = payment();
    for (intent, message) in reclaim_cases(&f) {
        let got = reclaim_rules(&f, &intent, &change(&f, &message), Signer::Fee);
        assert!(got.contains(&rule), "{}: {got:?}", intent.name());
    }
}

/// The message with account `at` of its instruction changed to `key`, a writable non-signer.
fn retarget(message: &[u8], at: usize, key: Key) -> Vec<u8> {
    mutate(message, |msg| {
        let mut flags = flags_of(msg);
        flags.entry(key).or_insert((false, true));
        rebuild(msg, &flags);
        msg.ixs[0].accounts[at] = msg.keys.iter().position(|k| *k == key).unwrap() as u8;
    })
}

/// The fee key accepts message `at` of one signature and one instruction. Returns the accounts
/// of the instruction with their (signer, writable) flags, and its data.
fn accepted(f: &Fixture, at: usize) -> (Vec<Key>, Vec<(bool, bool)>, Vec<u8>) {
    let (intent, message) = &reclaim_cases(f)[at];
    let got = reclaim_rules(f, intent, message, Signer::Fee);
    assert_eq!(got, Vec::<Rule>::new());
    let msg = v1::parse(message).unwrap();
    let ix = &msg.ixs[0];
    assert_eq!((msg.header[0], msg.ixs.len()), (1, 1));
    let index = |i: usize| usize::from(ix.accounts[i]);
    let keys = (0..ix.accounts.len()).map(|i| msg.keys[index(i)]).collect();
    let flags = (0..ix.accounts.len())
        .map(|i| (msg.is_signer(index(i)), msg.is_writable(index(i))))
        .collect();
    (keys, flags, ix.data.clone())
}

#[test]
fn the_fee_key_cancels_its_proposal_with_one_signature_and_gets_the_rent_back() {
    let f = payment();
    let (keys, flags, data) = accepted(&f, 0);
    let (prop, rec) = (proposal_of(&f), record_of(&f));
    assert_eq!(keys, [PAYER, prop, rec, PAYER, SYSTEM_PROGRAM, PAYER]);
    let (pay, rw, ro) = ((true, true), (false, true), (false, false));
    assert_eq!(flags, [pay, rw, rw, pay, ro, pay]);
    assert_eq!(data, [2]);
}

#[test]
fn the_fee_key_closes_the_record_that_pays_it_with_one_signature() {
    let f = payment();
    let (keys, flags, data) = accepted(&f, 1);
    assert_eq!(keys, [PAYER, proposal_of(&f), record_of(&f), PAYER]);
    let (pay, rw, ro) = ((true, true), (false, true), (false, false));
    assert_eq!(flags, [pay, ro, rw, pay]);
    assert_eq!(data, [3]);
}

#[test]
fn the_wire_form_of_the_reclaim_intents_reads_back_and_refuses_short_and_long_input() {
    let wires = [cancel_wire(COMMITMENT, EXPIRY), close_wire([0x88; 32])];
    for (wire, name) in wires.iter().zip(["cancel-proposal", "close-cancelled"]) {
        let intent = Intent::decode(wire).unwrap();
        assert_eq!((intent.encode(), intent.name()), (wire.clone(), name));
        assert!(Intent::decode(&wire[..wire.len() - 1]).is_err(), "short");
        assert!(Intent::decode(&[&wire[..], &[0]].concat()).is_err(), "long");
    }
}

#[test]
fn the_wasm_entries_compile_both_messages_with_no_transact_data_and_the_fee_key_signs() {
    let mut f = payment();
    let key = ed25519_dalek::SigningKey::from_bytes(&FEE_SECRET);
    f.pins.payer = key.verifying_key().to_bytes();
    let (pins, snapshot) = (f.pins.wire(), f.snapshot.encode().unwrap());
    let round = json!({"now": NOW, "secret": hex::encode(FEE_SECRET)}).to_string();
    for (intent, message) in reclaim_cases(&f) {
        let wire = intent.encode();
        let compiled = p3_check::wasm::compile_proposal(&wire, &pins, &[]);
        assert_eq!(compiled.unwrap(), message);
        let check = Check {
            intent: &wire,
            pins: &pins,
            snapshot: &snapshot,
        };
        let signature = p3_check::fee::sign(&message, &check, &round).expect("signed");
        assert!(p3_check::fee::verify(&hex::encode(f.pins.payer), &message, &signature).is_ok());
    }
}

#[test]
fn the_group_key_signs_neither_reclaim_message() {
    let f = payment();
    for (intent, message) in reclaim_cases(&f) {
        let got = reclaim_rules(&f, &intent, &message, Signer::Group);
        assert_eq!(got, [Rule::IntentRetired], "{}", intent.name());
    }
}

#[test]
fn a_reclaim_message_to_another_program_id_is_refused() {
    let change = |_: &Fixture, m: &[u8]| replace_key(m, &MULTISIG_DEVNET, ATTACKER);
    refused_by(Rule::ProgramNotAllowed, change);
}

#[test]
fn a_reclaim_message_with_another_instruction_tag_is_refused() {
    let swap = |_: &Fixture, m: &[u8]| mutate(m, |x| x.ixs[0].data[0] = 5 - x.ixs[0].data[0]);
    refused_by(Rule::InstructionNotAllowed, swap);
    let execute = |_: &Fixture, m: &[u8]| mutate(m, |x| x.ixs[0].data[0] = 1);
    refused_by(Rule::InstructionNotAllowed, execute);
}

#[test]
fn a_reclaim_message_with_an_extra_instruction_is_refused() {
    let extra = |_: &Fixture, m: &[u8]| with_ix(m, MULTISIG_DEVNET, &[], vec![2]);
    refused_by(Rule::InstructionCount, extra);
}

#[test]
fn a_cancel_of_a_body_with_another_commitment_expiry_or_group_is_refused() {
    let f = payment();
    let pda = f.pins.for_pda().unwrap();
    let group = Pins {
        multisig: [0x99; 32],
        ..pda.clone()
    };
    let others = [
        (cancel_wire([0x78; 32], EXPIRY), &pda),
        (cancel_wire(COMMITMENT, EXPIRY + 1), &pda),
        (cancel_wire(COMMITMENT, EXPIRY), &group),
    ];
    let (intent, _) = &reclaim_cases(&f)[0];
    for (wire, pins) in others {
        let other = Intent::decode(&wire).unwrap();
        let message = v1::write(&compile(&other, pins, None).unwrap()).unwrap();
        let got = reclaim_rules(&f, intent, &message, Signer::Fee);
        assert!(got.contains(&Rule::AccountAddress), "{got:?}");
    }
}

#[test]
fn a_reclaim_message_with_another_cancellation_address_is_refused() {
    let change = |f: &Fixture, m: &[u8]| replace_key(m, &record_of(f), ATTACKER);
    refused_by(Rule::AccountAddress, change);
}

#[test]
fn a_reclaim_message_with_a_rent_recipient_that_is_not_the_fee_key_is_refused() {
    refused_by(Rule::AccountAddress, |_, m| retarget(m, 3, ATTACKER));
}

#[test]
fn a_reclaim_message_with_a_writable_flag_removed_is_refused() {
    let change = |f: &Fixture, m: &[u8]| with_flags(m, &record_of(f), false, false);
    refused_by(Rule::AccountFlags, change);
}

#[test]
fn a_reclaim_message_with_a_second_signer_is_refused() {
    let change = |f: &Fixture, m: &[u8]| with_flags(m, &record_of(f), true, true);
    refused_by(Rule::SignerSet, change);
}

#[test]
fn the_reclaim_cap_is_the_floor_plus_half_and_the_messages_carry_it() {
    let (floor, cap) = RECLAIM_CU;
    assert_eq!(cap, (floor * 3).div_ceil(2));
    for (intent, message) in reclaim_cases(&payment()) {
        let limit = limits(&intent);
        assert_eq!((limit.cu_floor, limit.cu_cap), RECLAIM_CU);
        assert_eq!(limit.loaded_min, LOADED_MIN_PROPOSE);
        assert_eq!(v1::parse(&message).unwrap().config.compute_units, Some(cap));
    }
}
