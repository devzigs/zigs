//! Replays track "main" of the Devnet spike (vectors/devnet-main.txt): the landed `create`, then
//! the landed approval and `execute` 2 hours later, with the rig's payer as the executor. The
//! group signed this approval with FROST on Devnet; here the precompile verifies it again, and
//! the digest and commitment that this crate computes on its own match the signed values.

use solana_instruction::{AccountMeta, Instruction};
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use zigs_min_multisig_svm_tests::{
    approval_digest, approval_ix, code, commitment, proposal_address, refused_with, Rig,
    ED25519_ID, PROGRAM_ID, SYSTEM_ID,
};

struct Vector {
    create_time: u64,
    execute_time: u64,
    create_data: Vec<u8>,
    ed25519_data: Vec<u8>,
    execute_data: Vec<u8>,
    accounts: Vec<Pubkey>,
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
    Vector {
        create_time: field("create_time").parse().expect("time"),
        execute_time: field("execute_time").parse().expect("time"),
        create_data: hex(field("create_data")),
        ed25519_data: hex(field("ed25519_data")),
        execute_data: hex(field("execute_data")),
        accounts: field("execute_accounts")
            .split(' ')
            .map(|key| key.parse().expect("address"))
            .collect(),
    }
}

/// The landed `execute` with `payer` in place of the Devnet executor. Writable and signer
/// flags as on Devnet.
fn execute(v: &Vector, payer: &Pubkey, data: &[u8]) -> Instruction {
    let writable = [
        true, true, false, false, true, false, true, true, false, false, true, true, false,
    ];
    let metas = v
        .accounts
        .iter()
        .enumerate()
        .map(|(i, key)| match i {
            0 | 6 => AccountMeta::new(*payer, true),
            _ if writable[i] => AccountMeta::new(*key, false),
            _ => AccountMeta::new_readonly(*key, false),
        })
        .collect();
    Instruction::new_with_bytes(PROGRAM_ID, data, metas)
}

/// A rig at the execute time, with the Devnet proposal created at its create time.
fn created(v: &Vector) -> Rig {
    let mut rig = Rig::new();
    rig.set_time(v.create_time);
    let create = Instruction::new_with_bytes(
        PROGRAM_ID,
        &v.create_data,
        vec![
            AccountMeta::new(rig.payer.pubkey(), true),
            AccountMeta::new(v.accounts[1], false),
            AccountMeta::new_readonly(SYSTEM_ID, false),
        ],
    );
    rig.send(&[create], &[]).expect("the landed create");
    rig.set_time(v.execute_time);
    rig
}

#[test]
fn the_signed_values_match_this_crate() {
    let v = vector();
    let body = &v.create_data[1..];
    let group = Pubkey::try_from(&body[32..64]).expect("group");
    let commitment_in_body: [u8; 32] = body[..32].try_into().expect("commitment");
    assert_eq!(
        proposal_address(&group, &commitment_in_body).0,
        v.accounts[1]
    );
    assert_eq!(commitment(&v.execute_data[1..]), commitment_in_body);
    assert_eq!(v.ed25519_data[16..48], group.to_bytes());
    assert_eq!(v.ed25519_data[112..], approval_digest(&v.accounts[1], body));
    let builder = approval_ix(&solana_keypair::Keypair::new(), &[0; 32]);
    assert_eq!(
        v.ed25519_data[..16],
        builder.data[..16],
        "the official builder's head"
    );
}

#[test]
fn the_landed_approval_settles_the_landed_payment() {
    let v = vector();
    let mut rig = created(&v);
    let approval = Instruction::new_with_bytes(ED25519_ID, &v.ed25519_data, vec![]);
    let ix = execute(&v, &rig.payer.pubkey(), &v.execute_data);
    let meta = rig.send(&[approval, ix], &[]).expect("the landed execute");
    let call = meta
        .inner_instructions
        .iter()
        .flatten()
        .next()
        .expect("the pool call");
    assert_eq!(call.instruction.data[0], 16);
    assert_eq!(call.instruction.data[1..], v.execute_data[1..]);
    let rent_recipient = Pubkey::try_from(&v.create_data[1 + 72..1 + 104]).expect("recipient");
    assert_eq!(v.accounts[4], rent_recipient);
    assert!(rig.exists(&rent_recipient));
}

#[test]
fn the_landed_approval_refuses_a_changed_payment() {
    let v = vector();
    let mut rig = created(&v);
    let approval = Instruction::new_with_bytes(ED25519_ID, &v.ed25519_data, vec![]);
    let mut data = v.execute_data.clone();
    data[1 + 8 + 33] ^= 1;
    let ix = execute(&v, &rig.payer.pubkey(), &data);
    assert_eq!(
        refused_with(rig.send(&[approval, ix], &[])),
        code::COMMITMENT_MISMATCH
    );
}
