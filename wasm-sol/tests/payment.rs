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
use common::{EXPIRY, NOW};
use p3_check::approve::Device;
use p3_check::beta::{approve_message, approve_payment, Signer};
use p3_check::consts::{Key, MULTISIG_DEVNET, SYSTEM_PROGRAM};
use p3_check::fixed::parse_deposit;
use p3_check::intent::{Intent, Program};
use p3_check::pay::{Account, Payment, Seen};
use p3_check::pins::Pins;
use p3_check::plan::{Plan, Proposal, Role};
use p3_check::program::{
    approval_digest, cancellation_address, commitment, proposal_address, Body, KIND_PROPOSAL,
};
use p3_check::rule::Rule;
use p3_check::sign::{self, verify_strict, ApprovalCheck, Check};
use p3_check::template::{body_of, compile};
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

/// The body that the payment of `f` must have, and its account as `create` writes it.
fn want_body(f: &Fixture) -> (Body, Key, u8) {
    let pda = f.pins.for_pda().unwrap();
    let private = f.tx.private_tx_hash;
    let commitment = commitment(&private, &f.tx).unwrap();
    let (address, bump) = proposal_address(&f.pins.multisig, &commitment).unwrap();
    (body_of(&pda, commitment, EXPIRY, PAYER), address, bump)
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

fn pay(f: &Fixture, seen: &Seen) -> Result<Payment, Vec<Rule>> {
    approve_payment(&f.proposal(), &device(f), seen)
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
    let f = payment();
    let (_, address, _) = want_body(&f);
    let banned = [
        pda_wallet().signer,
        MULTISIG_DEVNET,
        SYSTEM_PROGRAM,
        address,
        cancellation_address(&address).unwrap(),
    ];
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
    let group = ceremony::run(ceremony::WALLET, 2, 3);
    let key: Key = ceremony::unhex32(&group.done[0].group_key);
    let f = Fixture::payment_for(&Spec::transfer(), key);
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
        seen: &f[3],
    }
}

fn wires(f: &Fixture, seen: &Seen) -> [Vec<u8>; 4] {
    [
        f.proposal().encode().unwrap(),
        f.pins.wire(),
        f.snapshot.encode().unwrap(),
        seen.encode().unwrap(),
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
    let intent = Intent::Program(Program::Execute {
        expiry: EXPIRY,
        rent_recipient: PAYER,
        signature,
        blockhash: [6; 32],
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
