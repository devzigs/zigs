//! Track "main" of the Devnet spike (vectors/devnet-main.txt). The group signed this approval with
//! FROST over the version 2 proposal address, so the full replay of the landed `create` and
//! `execute` ran only against version 2 (commit cc92a9c). Since version 3 the address binds the
//! body hash. These tests keep what still applies: the precompile accepts the landed approval,
//! its signed values match the formulas of this crate, and the program's commitment check
//! accepts the landed `transact` bytes and refuses a changed byte.

use solana_instruction::Instruction;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use zigs_min_multisig_svm_tests::{
    approval_digest, approval_ix, code, commitment, execute_ix, execute_metas, refused_with, Body,
    Rig, TxResult, ED25519_ID, PROGRAM_ID,
};

struct Vector {
    create_time: u64,
    execute_time: u64,
    create_data: Vec<u8>,
    ed25519_data: Vec<u8>,
    execute_data: Vec<u8>,
    proposal: Pubkey,
}

fn hex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).expect("hex"))
        .collect()
}

fn vector() -> Vector {
    let text = include_str!("../vectors/devnet-main.txt");
    let field = |name: &str| {
        text.lines()
            .find_map(|line| {
                line.strip_prefix(name)
                    .and_then(|rest| rest.strip_prefix(' '))
            })
            .unwrap_or_else(|| panic!("field {name}"))
    };
    assert_eq!(field("program_id"), PROGRAM_ID.to_string());
    let accounts: Vec<&str> = field("execute_accounts").split(' ').collect();
    Vector {
        create_time: field("create_time").parse().expect("time"),
        execute_time: field("execute_time").parse().expect("time"),
        create_data: hex(field("create_data")),
        ed25519_data: hex(field("ed25519_data")),
        execute_data: hex(field("execute_data")),
        proposal: accounts[1].parse().expect("proposal address"),
    }
}

/// The landed body with `group` in place of the FROST group key.
fn landed_body(v: &Vector, group: Pubkey) -> Body {
    let body = &v.create_data[1..];
    let key = |at: usize| Pubkey::try_from(&body[at..at + 32]).expect("key");
    let count = usize::from(body[104]);
    Body {
        commitment: body[..32].try_into().expect("commitment"),
        group,
        expiry: u64::from_le_bytes(body[64..72].try_into().expect("expiry")),
        rent_recipient: key(72),
        authorities: (0..count).map(|i| key(105 + 32 * i)).collect(),
    }
}

/// The landed `transact` bytes under a body that the rig's group key approves.
fn execute_landed(transact: &[u8]) -> TxResult {
    let v = vector();
    let mut rig = Rig::new();
    let body = landed_body(&v, rig.group.pubkey());
    rig.set_time(v.create_time);
    rig.create(&body).expect("create the landed body");
    rig.set_time(v.execute_time);
    let approval = approval_ix(&rig.group, &body.digest());
    let metas = execute_metas(&rig.payer.pubkey(), &body, 1, 1);
    rig.send(&[approval, execute_ix(metas, transact)], &[])
}

#[test]
fn the_signed_values_match_this_crate() {
    let v = vector();
    let body = &v.create_data[1..];
    let group = Pubkey::try_from(&body[32..64]).expect("group");
    assert_eq!(landed_body(&v, group).bytes(), body);
    let version_2_address = Pubkey::find_program_address(
        &[b"proposed_transaction", group.as_ref(), &body[..32]],
        &PROGRAM_ID,
    );
    assert_eq!(version_2_address.0, v.proposal);
    assert_eq!(commitment(&v.execute_data[1..]), body[..32]);
    assert_eq!(v.ed25519_data[16..48], group.to_bytes());
    assert_eq!(v.ed25519_data[112..], approval_digest(&v.proposal, body));
    let builder = approval_ix(&solana_keypair::Keypair::new(), &[0; 32]);
    assert_eq!(
        v.ed25519_data[..16],
        builder.data[..16],
        "the official builder's head"
    );
}

#[test]
fn the_precompile_accepts_the_landed_approval() {
    let v = vector();
    let mut rig = Rig::new();
    let approval = Instruction::new_with_bytes(ED25519_ID, &v.ed25519_data, vec![]);
    rig.send(std::slice::from_ref(&approval), &[])
        .expect("the landed FROST signature");
    let mut changed = approval;
    changed.data[48] ^= 1;
    rig.send(&[changed], &[])
        .expect_err("a changed signature byte");
}

#[test]
fn the_program_accepts_the_landed_payment() {
    let v = vector();
    let meta = execute_landed(&v.execute_data[1..]).expect("the landed transact");
    let call = meta
        .inner_instructions
        .iter()
        .flatten()
        .next()
        .expect("the pool call");
    assert_eq!(call.instruction.data[0], 16);
    assert_eq!(call.instruction.data[1..], v.execute_data[1..]);
}

#[test]
fn the_program_refuses_a_changed_landed_payment() {
    let v = vector();
    let mut transact = v.execute_data[1..].to_vec();
    transact[8 + 33] ^= 1;
    assert_eq!(
        refused_with(execute_landed(&transact)),
        code::COMMITMENT_MISMATCH
    );
}
