//! The v1 parser, the writer, the key order, the program addresses and the System instruction
//! layouts against independent code: `solana-message` 5.1.0 (the encoder that P2 used and
//! landed), `solana-address`, `solana-system-interface` 3.3.0, and the landed Devnet messages.

mod common;

use common::*;
use p3_check::consts::{
    Key, NONCE_SEED, NONCE_SPACE, RECENT_BLOCKHASHES, RENT_SYSVAR, SYSTEM_PROGRAM,
    SYS_ADVANCE_NONCE, SYS_AUTHORIZE_NONCE, SYS_TRANSFER, SYS_WITHDRAW_NONCE,
};
use p3_check::intent::Intent;
use p3_check::pda;
use p3_check::template::{expected, Data, LOADED_MAX};
use p3_check::transact;
use p3_check::v1;
use solana_address::Address;
use solana_hash::Hash;
use solana_instruction::{AccountMeta, Instruction};
use solana_message::v1 as solana_v1;
use solana_system_interface::instruction as system;

fn addr(key: &Key) -> Address {
    Address::from(*key)
}

#[test]
fn program_addresses_match_solana_address() {
    let pins = pins();
    let tx = real_tx("real/work-transfer-0.msg");
    let nullifier = tx.inputs[0].nullifier;
    let cases: Vec<(Vec<Vec<u8>>, Key)> = vec![
        (
            vec![b"tree".to_vec(), 0u16.to_le_bytes().to_vec()],
            pins.pool,
        ),
        (
            vec![b"tree".to_vec(), 7u16.to_le_bytes().to_vec()],
            pins.pool,
        ),
        (vec![b"sol_interface".to_vec(), vec![0]], pins.pool),
        (
            vec![
                b"nullifier".to_vec(),
                pins.input_tree.to_vec(),
                nullifier.to_vec(),
            ],
            pins.pool,
        ),
        (
            vec![b"zolana/registry/v0".to_vec(), pins.group.to_vec()],
            pins.registry,
        ),
    ];
    for (seeds, program) in cases {
        let refs: Vec<&[u8]> = seeds.iter().map(Vec::as_slice).collect();
        let (ours, bump) = pda::find_program_address(&refs, &program).expect("pda");
        let (theirs, their_bump) = Address::find_program_address(&refs, &addr(&program));
        assert_eq!((ours, bump), (theirs.to_bytes(), their_bump), "{seeds:?}");
    }
}

#[test]
fn create_with_seed_and_curve_test_match_solana_address() {
    let pins = pins();
    let theirs =
        Address::create_with_seed(&addr(&pins.group), "zigs-nonce-1", &addr(&SYSTEM_PROGRAM));
    assert_eq!(pins.nonce_account, theirs.expect("seed address").to_bytes());
    for n in 0..300u32 {
        let key = pda::create_with_seed(&[n as u8; 32], &n.to_le_bytes(), &SYSTEM_PROGRAM);
        assert_eq!(pda::is_on_curve(&key), addr(&key).is_on_curve(), "key {n}");
    }
}

#[test]
fn derived_pins_are_the_accounts_of_the_landed_transactions() {
    let pins = pins();
    let table = |path: &str| parse(&read(path)).keys;
    assert!(table("real/chain-register.msg").contains(&pins.user_record));
    assert!(table("real/chain-shield.msg").contains(&pins.sol_interface));
    assert!(table("real/chain-shield.msg").contains(&pins.output_tree));
    assert!(table("real/chain-stretch.msg").contains(&pins.nonce_account));
    let recipient = Facts::load().recipient();
    assert!(table("real/chain-withdraw.msg").contains(&recipient));
    for path in ["transfer", "withdraw", "stretch"] {
        let tx = real_tx(&format!("real/chain-{path}.msg"));
        let pda = pins
            .nullifier_pda(&pins.input_tree, &tx.inputs[0].nullifier)
            .unwrap();
        assert!(
            table(&format!("real/chain-{path}.msg")).contains(&pda),
            "{path}"
        );
    }
}

#[test]
fn the_payee_tag_of_the_real_transfer_is_the_owner_key_of_account_b() {
    let tx = real_tx("real/work-transfer-0.msg");
    assert_eq!(
        tx.outputs[1].owner_tag,
        transact::OwnerTag::Inline(Facts::load().payee())
    );
}

fn solana_instructions(intent: &Intent, bytes: &[u8]) -> Vec<Instruction> {
    let pins = pins();
    let msg = parse(bytes);
    let tx = msg
        .ixs
        .iter()
        .find(|ix| ix.data.first() == Some(&16))
        .map(|ix| transact::parse(&ix.data).expect("transact"));
    let exp = expected(intent, &pins, tx.as_ref()).expect("expected");
    exp.ixs
        .iter()
        .enumerate()
        .map(|(at, ix)| Instruction {
            program_id: addr(&ix.program),
            accounts: ix
                .accounts
                .iter()
                .map(|a| AccountMeta {
                    pubkey: addr(&a.key),
                    is_signer: a.signer,
                    is_writable: a.writable,
                })
                .collect(),
            data: match &ix.data {
                Data::Exact(data) | Data::Fields(data) => data.clone(),
                Data::Variable => msg.ixs[at].data.clone(),
            },
        })
        .collect()
}

#[test]
fn compiled_messages_equal_the_solana_message_compiler() {
    let pins = pins();
    for vector in accept_vectors() {
        let ixs = solana_instructions(&vector.intent, &vector.bytes);
        let mine = parse(&vector.bytes);
        // The compiler writes no priority fee (mask 0b1100), the form of P5 and P6.
        assert_eq!(mine.config.priority_fee, None, "{}", vector.name);
        let config = solana_v1::TransactionConfig::empty()
            .with_compute_unit_limit(mine.config.compute_units.unwrap())
            .with_loaded_accounts_data_size_limit(LOADED_MAX);
        let lifetime = Hash::new_from_array(vector.intent.lifetime());
        let theirs =
            solana_v1::Message::try_compile_with_config(&addr(&pins.payer), &ixs, lifetime, config)
                .unwrap_or_else(|e| panic!("{}: {e:?}", vector.name));
        assert_eq!(theirs.serialize(), vector.bytes, "{}", vector.name);
    }
}

#[test]
fn the_with_fee_form_equals_the_solana_message_compiler_too() {
    let pins = pins();
    for vector in accept_vectors() {
        for fee in [0, 1, p3_check::template::PRIORITY_MAX] {
            let bytes = mutate(&vector.bytes, |m| m.config.priority_fee = Some(fee));
            let ixs = solana_instructions(&vector.intent, &bytes);
            let mine = parse(&bytes);
            let config = solana_v1::TransactionConfig::empty()
                .with_priority_fee(fee)
                .with_compute_unit_limit(mine.config.compute_units.unwrap())
                .with_loaded_accounts_data_size_limit(LOADED_MAX);
            let lifetime = Hash::new_from_array(vector.intent.lifetime());
            let theirs = solana_v1::Message::try_compile_with_config(
                &addr(&pins.payer),
                &ixs,
                lifetime,
                config,
            )
            .unwrap_or_else(|e| panic!("{}: {e:?}", vector.name));
            assert_eq!(theirs.serialize(), bytes, "{} with fee {fee}", vector.name);
        }
    }
}

fn same_as_solana(bytes: &[u8], name: &str) {
    let mine = parse(bytes);
    // `solana_message::v1::deserialize` reads the message after its version byte.
    let theirs = solana_v1::deserialize(&bytes[1..]).unwrap_or_else(|e| panic!("{name}: {e:?}"));
    let h = theirs.header;
    assert_eq!(
        mine.header,
        [
            h.num_required_signatures,
            h.num_readonly_signed_accounts,
            h.num_readonly_unsigned_accounts
        ],
        "{name}"
    );
    assert_eq!(
        mine.config.priority_fee, theirs.config.priority_fee,
        "{name}"
    );
    assert_eq!(
        mine.config.compute_units, theirs.config.compute_unit_limit,
        "{name}"
    );
    assert_eq!(
        mine.config.loaded_limit, theirs.config.loaded_accounts_data_size_limit,
        "{name}"
    );
    assert_eq!(mine.config.heap_size, theirs.config.heap_size, "{name}");
    assert_eq!(
        mine.lifetime,
        theirs.lifetime_specifier.to_bytes(),
        "{name}"
    );
    let keys: Vec<Key> = theirs.account_keys.iter().map(Address::to_bytes).collect();
    assert_eq!(mine.keys, keys, "{name}");
    assert_eq!(mine.ixs.len(), theirs.instructions.len(), "{name}");
    for (a, b) in mine.ixs.iter().zip(&theirs.instructions) {
        assert_eq!(
            (a.program, &a.accounts, &a.data),
            (b.program_id_index, &b.accounts, &b.data)
        );
    }
    assert_eq!(theirs.serialize(), bytes, "{name}: solana rewrite");
}

#[test]
fn the_parser_equals_solana_message_on_accept_vectors_and_real_messages() {
    for vector in accept_vectors() {
        same_as_solana(&vector.bytes, vector.name);
    }
    for path in [
        "real/chain-register.msg",
        "real/chain-shield.msg",
        "real/chain-transfer.msg",
        "real/chain-withdraw.msg",
        "real/chain-stretch.msg",
        "real/work-c-orig.v.msg",
        "p2/wire-v1_nonce_send.msg",
        "p2/wire-v1default_nonce_now.msg",
        "p2/wire-v1_blockhash_default_loaded.msg",
        "p2/wire-v1_blockhash_explicit_loaded.msg",
    ] {
        same_as_solana(&read(path), path);
    }
}

#[test]
fn the_parser_refuses_what_solana_message_refuses_and_trailing_bytes_too() {
    let base = accept("transfer").bytes;
    let mut unknown_bit = base.clone();
    unknown_bit[4] |= 0x20;
    let with_fee = mutate(&base, |m| m.config.priority_fee = Some(0));
    let mut partial = with_fee.clone();
    partial[4] &= !0b10;
    for (name, bytes) in [
        ("unknown bit", unknown_bit),
        ("partial priority", partial),
        ("truncated", base[..base.len() - 1].to_vec()),
    ] {
        assert!(v1::parse(&bytes).is_err(), "{name}");
        assert!(solana_v1::deserialize(&bytes[1..]).is_err(), "{name}");
    }
    // `solana_message` reads a message from the front of a longer buffer (the signatures follow
    // it in a transaction) and ignores the rest. The checker takes the message alone, so a
    // trailing byte is an error here and the byte-exact rewrite rule would catch it anyway.
    let longer = [base.clone(), vec![0]].concat();
    assert!(v1::parse(&longer).is_err());
    assert!(solana_v1::deserialize(&longer[1..]).is_ok());
}

#[test]
fn system_data_tags_follow_solana_system_interface() {
    let (a, b) = (addr(&[1; 32]), addr(&[2; 32]));
    let tag = |ix: &Instruction| u32::from_le_bytes(ix.data[..4].try_into().unwrap());
    assert_eq!(tag(&system::transfer(&a, &b, 1)), SYS_TRANSFER);
    assert_eq!(
        tag(&system::advance_nonce_account(&a, &b)),
        SYS_ADVANCE_NONCE
    );
    assert_eq!(
        tag(&system::withdraw_nonce_account(&a, &b, &b, 1)),
        SYS_WITHDRAW_NONCE
    );
    assert_eq!(
        tag(&system::authorize_nonce_account(&a, &b, &b)),
        SYS_AUTHORIZE_NONCE
    );
    assert_eq!(
        tag(&system::create_account(&a, &b, 1, 2, &a)),
        p3_check::consts::SYS_CREATE_ACCOUNT
    );
    let (base, seed) = (addr(&[3; 32]), "x");
    assert_eq!(
        tag(&system::transfer_with_seed(
            &a,
            &base,
            seed.into(),
            &a,
            &b,
            1
        )),
        p3_check::consts::SYS_TRANSFER_WITH_SEED
    );
    let created = system::create_nonce_account_with_seed(&a, &b, &a, "x", &a, 5);
    assert_eq!(tag(&created[0]), p3_check::consts::SYS_CREATE_WITH_SEED);
    assert_eq!(tag(&created[1]), p3_check::consts::SYS_INIT_NONCE);
}

#[test]
fn nonce_instructions_equal_the_system_interface_builders() {
    let pins = pins();
    let (group, nonce) = (addr(&pins.group), addr(&pins.nonce_account));
    let payer = addr(&pins.payer);
    let advance = system::advance_nonce_account(&nonce, &group);
    // The payer funds the account, the group key signs as the base of the seed and is the
    // authority: the builder then lists the base as a third account.
    let create = system::create_nonce_account_with_seed(
        &payer,
        &nonce,
        &group,
        std::str::from_utf8(NONCE_SEED).unwrap(),
        &group,
        pins.nonce_rent,
    );
    let created = expected(&Intent::CreateNonce { blockhash: [0; 32] }, &pins, None).unwrap();
    let advanced = expected(&Intent::Cancel { nonce: [0; 32] }, &pins, None).unwrap();
    let want = [
        (&advanced.ixs[0], &advance),
        (&created.ixs[0], &create[0]),
        (&created.ixs[1], &create[1]),
    ];
    for (ours, theirs) in want {
        let data = match &ours.data {
            Data::Exact(data) => data,
            other => panic!("{other:?}"),
        };
        assert_eq!(data, &theirs.data);
        assert_eq!(addr(&ours.program), theirs.program_id);
        let flags: Vec<_> = ours
            .accounts
            .iter()
            .map(|a| (addr(&a.key), a.signer, a.writable))
            .collect();
        let metas: Vec<_> = theirs
            .accounts
            .iter()
            .map(|m| (m.pubkey, m.is_signer, m.is_writable))
            .collect();
        assert_eq!(flags, metas);
    }
    assert_eq!(NONCE_SPACE, 80);
    assert_eq!(
        addr(&RECENT_BLOCKHASHES).to_string(),
        "SysvarRecentB1ockHashes11111111111111111111"
    );
    assert_eq!(
        addr(&RENT_SYSVAR).to_string(),
        "SysvarRent111111111111111111111111111111111"
    );
}

#[test]
fn the_landed_nonce_creation_contains_the_template_data() {
    let pins = pins();
    let created = expected(&Intent::CreateNonce { blockhash: [0; 32] }, &pins, None).unwrap();
    let landed = read("p2/wire-nonce_create.msg");
    for ix in &created.ixs {
        let Data::Exact(data) = &ix.data else {
            panic!("fixed data")
        };
        assert!(
            landed.windows(data.len()).any(|w| w == data.as_slice()),
            "{} bytes",
            data.len()
        );
    }
    assert!(landed.windows(32).any(|w| w == pins.nonce_account));
}
