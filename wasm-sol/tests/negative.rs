//! Negative vectors: each test mutates an accept vector in one way and requires that the first
//! violation is the one named rule. The mutation tests (tools/mutate.py) disable one rule at a
//! time and need the matching test here to fail.

mod common;

use common::*;
use p3_check::check::{check, verify_transact_rewrite};
use p3_check::consts::{
    COMPUTE_BUDGET_PROGRAM, OFFCHAIN_MAGIC, RECENT_BLOCKHASHES, SYSTEM_PROGRAM,
};
use p3_check::fixed::{parse_deposit, parse_register};
use p3_check::intent::Intent;
use p3_check::rule::Rule;
use p3_check::template::{limits, LOADED_MAX, PRIORITY_MAX};
use p3_check::transact::{self, Leg, LooseMessage, OwnerTag};
use p3_check::v1::Config;

fn with_config(bytes: &[u8], f: impl FnOnce(&mut Config)) -> Vec<u8> {
    mutate(bytes, |msg| f(&mut msg.config))
}

fn with_spend(intent: &Intent, f: impl FnOnce(&mut p3_check::intent::Spend)) -> Intent {
    let mut intent = intent.clone();
    match &mut intent {
        Intent::Transfer { spend, .. } | Intent::Withdrawal { spend, .. } => f(spend),
        _ => panic!("not a spend"),
    }
    intent
}

fn refuse(name: &str, rule: Rule, mutation: impl FnOnce(&[u8]) -> Vec<u8>) {
    let vector = accept(name);
    let bytes = mutation(&vector.bytes);
    assert_ne!(bytes, vector.bytes, "the mutation changed nothing");
    assert_refused(&bytes, &vector.intent, rule);
}

fn key_of(msg_bytes: &[u8], index: usize) -> p3_check::consts::Key {
    parse(msg_bytes).keys[index]
}

// ---- raw bytes ----------------------------------------------------------------------------

#[test]
fn offchain_prefix() {
    let mut bytes = OFFCHAIN_MAGIC.to_vec();
    bytes.extend_from_slice(&[0; 40]);
    assert_refused(&bytes, &accept("cancel").intent, Rule::OffchainPrefix);
}

#[test]
fn offchain_envelope_around_a_derive_payload_is_refused_at_the_prefix() {
    let mut bytes = OFFCHAIN_MAGIC.to_vec();
    bytes.push(0); // version 0
    bytes.extend_from_slice(&[0x1d; 32]); // application domain
    bytes.extend_from_slice(&[0, 1]); // format, signer count
    bytes.extend_from_slice(&[7; 32]); // signer
    bytes.extend_from_slice(&[14, 0]);
    bytes.extend_from_slice(b"TSPP/derive/v1");
    assert_refused(&bytes, &accept("cancel").intent, Rule::OffchainPrefix);
}

#[test]
fn derive_payload() {
    assert_refused(
        b"TSPP/derive/v1",
        &accept("cancel").intent,
        Rule::DerivePayload,
    );
    assert_refused(
        b"TSPP/derive/",
        &accept("cancel").intent,
        Rule::DerivePayload,
    );
}

// ---- parse --------------------------------------------------------------------------------

#[test]
fn version_byte_of_v0_and_legacy() {
    for first in [0x80u8, 0x01, 0x82, 0x00] {
        let mut bytes = accept("cancel").bytes;
        bytes[0] = first;
        assert_refused(&bytes, &accept("cancel").intent, Rule::Version);
    }
    assert_refused(&[], &accept("cancel").intent, Rule::Truncated);
}

#[test]
fn truncated_message() {
    refuse("transfer", Rule::Truncated, |b| b[..b.len() - 1].to_vec());
    refuse("cancel", Rule::Truncated, |b| b[..20].to_vec());
}

#[test]
fn trailing_bytes() {
    refuse("transfer", Rule::TrailingBytes, |b| [b, &[0]].concat());
}

#[test]
fn unknown_config_bit() {
    for bit in [5u32, 6, 31] {
        refuse("transfer", Rule::ConfigUnknownBits, |b| {
            let mut bytes = b.to_vec();
            let mask = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) | (1 << bit);
            bytes[4..8].copy_from_slice(&mask.to_le_bytes());
            bytes
        });
    }
}

#[test]
fn partial_priority_bits() {
    for clear in [0b01u8, 0b10] {
        refuse("transfer", Rule::ConfigPriorityBits, |b| {
            let mut bytes = with_config(b, |c| c.priority_fee = Some(0));
            bytes[4] &= !clear;
            bytes
        });
    }
}

#[test]
fn structure_duplicate_account() {
    refuse("transfer", Rule::Structure, |b| {
        mutate(b, |m| m.keys[2] = m.keys[1])
    });
}

#[test]
fn structure_program_is_the_fee_payer() {
    refuse("cancel", Rule::Structure, |b| {
        mutate(b, |m| m.ixs[0].program = 0)
    });
}

#[test]
fn structure_account_index_out_of_range() {
    refuse("cancel", Rule::Structure, |b| {
        mutate(b, |m| m.ixs[0].accounts[0] = 200)
    });
}

#[test]
fn structure_no_writable_signer() {
    refuse("cancel", Rule::Structure, |b| {
        mutate(b, |m| m.header[1] = m.header[0])
    });
}

#[test]
fn structure_transaction_too_large() {
    refuse("cancel", Rule::Structure, |b| {
        with_ix(b, SYSTEM_PROGRAM, &[], vec![0; 4000])
    });
}

// ---- config and limits --------------------------------------------------------------------

#[test]
fn missing_loaded_limit_bit() {
    for name in ["transfer", "register", "cancel"] {
        refuse(name, Rule::ConfigLoadedBit, |b| {
            with_config(b, |c| c.loaded_limit = None)
        });
    }
}

#[test]
fn heap_config_is_not_in_the_template() {
    refuse("transfer", Rule::ConfigNotTemplate, |b| {
        with_config(b, |c| c.heap_size = Some(65_536))
    });
}

#[test]
fn priority_fee_absent_is_the_template_form_and_the_compiler_writes_it() {
    for vector in accept_vectors() {
        let msg = parse(&vector.bytes);
        assert_eq!(msg.config.priority_fee, None, "{}", vector.name);
        assert_eq!(msg.config.mask(), 0b1100, "{}", vector.name);
        assert!(check(&vector.bytes, &vector.intent, &pins(), NOW).is_ok());
    }
}

#[test]
fn priority_fee_present_at_or_under_the_maximum_is_the_other_template_form() {
    for vector in accept_vectors() {
        for fee in [0, 1, PRIORITY_MAX] {
            let bytes = with_config(&vector.bytes, |c| c.priority_fee = Some(fee));
            assert_eq!(parse(&bytes).config.mask(), 0b1111, "{}", vector.name);
            assert!(
                check(&bytes, &vector.intent, &pins(), NOW).is_ok(),
                "{} with fee {fee}",
                vector.name
            );
        }
    }
}

#[test]
fn compute_units_absent_is_not_the_template() {
    refuse("transfer", Rule::ConfigNotTemplate, |b| {
        with_config(b, |c| c.compute_units = None)
    });
}

#[test]
fn priority_fee_over_the_maximum() {
    refuse("transfer", Rule::PriorityFeeOverMax, |b| {
        with_config(b, |c| c.priority_fee = Some(PRIORITY_MAX + 1))
    });
    refuse("cancel", Rule::PriorityFeeOverMax, |b| {
        with_config(b, |c| c.priority_fee = Some(u64::MAX))
    });
}

#[test]
fn priority_fee_at_the_maximum_is_accepted() {
    let vector = accept("cancel");
    let bytes = with_config(&vector.bytes, |c| c.priority_fee = Some(PRIORITY_MAX));
    assert!(check(&bytes, &vector.intent, &pins(), NOW).is_ok());
}

#[test]
fn compute_limit_over_the_cap() {
    for vector in accept_vectors() {
        let cap = limits(&vector.intent).cu_cap;
        let over = with_config(&vector.bytes, |c| c.compute_units = Some(cap + 1));
        assert_refused(&over, &vector.intent, Rule::ComputeUnitsOverCap);
        let at = with_config(&vector.bytes, |c| c.compute_units = Some(cap));
        assert!(
            check(&at, &vector.intent, &pins(), NOW).is_ok(),
            "{} at the cap",
            vector.name
        );
    }
}

#[test]
fn compute_limit_of_the_sdk_default_is_refused() {
    refuse("transfer", Rule::ComputeUnitsOverCap, |b| {
        with_config(b, |c| c.compute_units = Some(450_000))
    });
}

#[test]
fn loaded_limit_below_the_safe_minimum() {
    for vector in accept_vectors() {
        let min = limits(&vector.intent).loaded_min;
        let low = with_config(&vector.bytes, |c| c.loaded_limit = Some(min - 1));
        assert_refused(&low, &vector.intent, Rule::LoadedLimitRange);
        let zero = with_config(&vector.bytes, |c| c.loaded_limit = Some(0));
        assert_refused(&zero, &vector.intent, Rule::LoadedLimitRange);
    }
}

#[test]
fn loaded_limit_above_64_mib() {
    refuse("transfer", Rule::LoadedLimitRange, |b| {
        with_config(b, |c| c.loaded_limit = Some(LOADED_MAX + 1))
    });
}

// ---- signers ------------------------------------------------------------------------------

#[test]
fn fee_payer_other_than_the_group_key() {
    refuse("transfer", Rule::FeePayerNotGroup, |b| {
        replace_key(b, &pins().group, ATTACKER)
    });
}

#[test]
fn second_signer() {
    let vector = accept("transfer");
    let nonce_like = key_of(&vector.bytes, 1);
    let bytes = with_flags(&vector.bytes, &nonce_like, true, true);
    assert_refused(&bytes, &vector.intent, Rule::SignerSet);
}

#[test]
fn signer_flag_on_a_readonly_account() {
    refuse("cancel", Rule::SignerSet, |b| {
        with_flags(b, &RECENT_BLOCKHASHES, true, false)
    });
}

// ---- instruction refusals -----------------------------------------------------------------

#[test]
fn compute_budget_instruction() {
    let set_limit = vec![2, 0x40, 0x0d, 0x03, 0x00]; // SetComputeUnitLimit(200000)
    refuse("transfer", Rule::ComputeBudget, |b| {
        with_ix(b, COMPUTE_BUDGET_PROGRAM, &[], set_limit)
    });
}

#[test]
fn deposit_outside_shield() {
    for name in ["transfer", "withdrawal", "register", "cancel"] {
        refuse(name, Rule::DepositOutsideShield, |b| {
            with_ix(b, pins().pool, &[], vec![15])
        });
    }
}

#[test]
fn merge_transact() {
    refuse("transfer", Rule::MergeTransact, |b| {
        with_ix(b, pins().pool, &[], vec![17, 0, 0])
    });
}

#[test]
fn update_keys() {
    refuse("register", Rule::UpdateKeys, |b| {
        with_ix(b, pins().registry, &[], vec![2, 0])
    });
}

#[test]
fn set_merging_enabled() {
    refuse("register", Rule::SetMergingEnabled, |b| {
        with_ix(b, pins().registry, &[], vec![1, 1])
    });
}

#[test]
fn withdraw_nonce_account() {
    let data = [&5u32.to_le_bytes()[..], &1u64.to_le_bytes()].concat();
    refuse("cancel", Rule::WithdrawNonceAccount, |b| {
        with_ix(b, SYSTEM_PROGRAM, &[], data)
    });
}

#[test]
fn authorize_nonce_account() {
    let data = [&7u32.to_le_bytes()[..], &[1u8; 32]].concat();
    refuse("cancel", Rule::AuthorizeNonceAccount, |b| {
        with_ix(b, SYSTEM_PROGRAM, &[], data)
    });
}

#[test]
fn system_transfer() {
    let data = [&2u32.to_le_bytes()[..], &1u64.to_le_bytes()].concat();
    let group = pins().group;
    refuse("transfer", Rule::SystemTransfer, |b| {
        with_ix(b, SYSTEM_PROGRAM, &[group, ATTACKER], data)
    });
}

#[test]
fn program_that_is_not_allowed() {
    refuse("transfer", Rule::ProgramNotAllowed, |b| {
        with_ix(b, [0x42; 32], &[], vec![1])
    });
}

#[test]
fn instruction_tags_that_are_not_on_the_allow_lists() {
    let create_account = 0u32.to_le_bytes().to_vec();
    refuse("cancel", Rule::InstructionNotAllowed, |b| {
        with_ix(b, SYSTEM_PROGRAM, &[], create_account)
    });
    refuse("cancel", Rule::InstructionNotAllowed, |b| {
        with_ix(b, pins().pool, &[], vec![3])
    });
    refuse("cancel", Rule::InstructionNotAllowed, |b| {
        with_ix(b, pins().registry, &[], vec![9])
    });
    refuse("cancel", Rule::InstructionNotAllowed, |b| {
        with_ix(b, pins().pool, &[], vec![])
    });
}

// ---- instruction list ---------------------------------------------------------------------

#[test]
fn extra_instruction() {
    let nonce = pins().nonce_account;
    let group = pins().group;
    let advance = vec![4, 0, 0, 0];
    refuse("transfer", Rule::InstructionCount, |b| {
        with_ix(
            b,
            SYSTEM_PROGRAM,
            &[nonce, RECENT_BLOCKHASHES, group],
            advance,
        )
    });
}

#[test]
fn missing_advance_nonce_instruction() {
    refuse("transfer", Rule::InstructionCount, |b| {
        mutate(b, |m| drop(m.ixs.remove(0)))
    });
}

#[test]
fn spend_without_a_transact_instruction() {
    refuse("transfer", Rule::InstructionMismatch, |b| {
        mutate(b, |m| m.ixs.truncate(1))
    });
}

#[test]
fn instructions_in_the_wrong_order() {
    refuse("transfer", Rule::InstructionMismatch, |b| {
        mutate(b, |m| m.ixs.swap(0, 1))
    });
}

#[test]
fn advance_nonce_data_with_an_extra_byte() {
    refuse("cancel", Rule::InstructionData, |b| {
        mutate(b, |m| m.ixs[0].data.push(1))
    });
}

#[test]
fn create_nonce_data_changed() {
    refuse("create-nonce", Rule::InstructionData, |b| {
        mutate(b, |m| {
            let last = m.ixs[0].data.len() - 1;
            m.ixs[0].data[last] ^= 1;
        })
    });
}

// ---- accounts -----------------------------------------------------------------------------

#[test]
fn changed_recipient_account() {
    let recipient = Facts::load().recipient();
    refuse("withdrawal", Rule::AccountAddress, |b| {
        replace_key(b, &recipient, ATTACKER)
    });
}

#[test]
fn changed_tree_account() {
    let tree = pins().input_tree;
    refuse("transfer", Rule::AccountAddress, |b| {
        replace_key(b, &tree, ATTACKER)
    });
}

#[test]
fn changed_nonce_account() {
    let nonce = pins().nonce_account;
    refuse("transfer", Rule::AccountAddress, |b| {
        replace_key(b, &nonce, ATTACKER)
    });
}

#[test]
fn changed_sol_interface_account() {
    let sol = pins().sol_interface;
    refuse("withdrawal", Rule::AccountAddress, |b| {
        replace_key(b, &sol, ATTACKER)
    });
}

#[test]
fn changed_nullifier_pda_account() {
    let vector = accept("transfer");
    let tx = real_tx("real/work-transfer-0.msg");
    let pda = pins()
        .nullifier_pda(&pins().input_tree, &tx.inputs[0].nullifier)
        .unwrap();
    assert_refused(
        &replace_key(&vector.bytes, &pda, ATTACKER),
        &vector.intent,
        Rule::AccountAddress,
    );
}

#[test]
fn changed_registry_record_account() {
    let record = pins().user_record;
    refuse("register", Rule::AccountAddress, |b| {
        replace_key(b, &record, ATTACKER)
    });
}

#[test]
fn extra_account_in_an_instruction() {
    refuse("cancel", Rule::AccountCount, |b| {
        mutate(b, |m| m.ixs[0].accounts.push(0))
    });
}

#[test]
fn account_in_the_table_that_no_instruction_uses() {
    refuse("transfer", Rule::AccountSet, |b| {
        mutate(b, |m| {
            let mut flags = flags_of(m);
            flags.insert(ATTACKER, (false, false));
            rebuild(m, &flags);
        })
    });
}

#[test]
fn writable_flag_cleared_on_a_writable_account() {
    let tx = real_tx("real/work-transfer-0.msg");
    let pda = pins()
        .nullifier_pda(&pins().input_tree, &tx.inputs[0].nullifier)
        .unwrap();
    refuse("transfer", Rule::AccountFlags, |b| {
        with_flags(b, &pda, false, false)
    });
    let tree = pins().input_tree;
    refuse("withdrawal", Rule::AccountFlags, |b| {
        with_flags(b, &tree, false, false)
    });
}

#[test]
fn writable_flag_set_on_a_readonly_account() {
    refuse("transfer", Rule::AccountFlags, |b| {
        with_flags(b, &SYSTEM_PROGRAM, false, true)
    });
    let pool = pins().pool;
    refuse("transfer", Rule::AccountFlags, |b| {
        with_flags(b, &pool, false, true)
    });
    refuse("cancel", Rule::AccountFlags, |b| {
        with_flags(b, &RECENT_BLOCKHASHES, false, true)
    });
}

#[test]
fn lifetime_changed() {
    for vector in accept_vectors() {
        let bytes = mutate(&vector.bytes, |m| m.lifetime[0] ^= 1);
        assert_refused(&bytes, &vector.intent, Rule::Lifetime);
    }
}

// ---- register -----------------------------------------------------------------------------

fn with_register(bytes: &[u8], f: impl FnOnce(&mut p3_check::fixed::Register)) -> Vec<u8> {
    mutate(bytes, |m| {
        let mut data = parse_register(&m.ixs[1].data).unwrap();
        f(&mut data);
        m.ixs[1].data = data.write();
    })
}

#[test]
fn register_nullifier_pk_changed() {
    refuse("register", Rule::RegisterNullifierPk, |b| {
        with_register(b, |r| r.nullifier_pk[0] ^= 1)
    });
}

#[test]
fn register_viewing_pk_changed() {
    refuse("register", Rule::RegisterViewingPk, |b| {
        with_register(b, |r| r.viewing_pk[32] ^= 1)
    });
}

#[test]
fn register_owner_p256_present() {
    refuse("register", Rule::RegisterOwnerP256, |b| {
        with_register(b, |r| r.owner_p256 = Some([2; 33]))
    });
}

#[test]
fn register_data_of_the_wrong_length() {
    refuse("register", Rule::RegisterLength, |b| {
        mutate(b, |m| m.ixs[1].data.truncate(66))
    });
    refuse("register", Rule::RegisterLength, |b| {
        mutate(b, |m| m.ixs[1].data.push(0))
    });
}

// ---- shield -------------------------------------------------------------------------------

fn with_deposit(bytes: &[u8], f: impl FnOnce(&mut p3_check::fixed::Deposit)) -> Vec<u8> {
    mutate(bytes, |m| {
        let mut data = parse_deposit(&m.ixs[1].data).unwrap();
        f(&mut data);
        m.ixs[1].data = data.write().unwrap();
    })
}

#[test]
fn shield_amount_changed() {
    refuse("shield", Rule::ShieldAmount, |b| {
        with_deposit(b, |d| d.entries[0].amount += 1)
    });
}

#[test]
fn shield_owner_changed() {
    refuse("shield", Rule::ShieldOwner, |b| {
        with_deposit(b, |d| d.entries[0].owner[0] ^= 1)
    });
}

#[test]
fn shield_view_tag_changed() {
    refuse("shield", Rule::ShieldViewTag, |b| {
        with_deposit(b, |d| d.entries[0].view_tag[0] ^= 1)
    });
}

#[test]
fn shield_with_a_memo_or_two_entries_or_an_spl_asset() {
    refuse("shield", Rule::ShieldShape, |b| {
        with_deposit(b, |d| d.entries[0].memo = Some(vec![1]))
    });
    refuse("shield", Rule::ShieldShape, |b| {
        with_deposit(b, |d| {
            let again = d.entries[0].clone();
            d.entries.push(again);
        })
    });
    refuse("shield", Rule::ShieldShape, |b| {
        with_deposit(b, |d| {
            d.assets = vec![p3_check::fixed::AssetKind::Spl { bump: 255 }]
        })
    });
}

// ---- transact -----------------------------------------------------------------------------

#[test]
fn transact_data_truncated_or_with_trailing_bytes() {
    refuse("transfer", Rule::TransactParse, |b| {
        mutate(b, |m| {
            let at = tx_position(m);
            m.ixs[at].data.pop();
        })
    });
    refuse("transfer", Rule::TransactParse, |b| {
        mutate(b, |m| {
            let at = tx_position(m);
            m.ixs[at].data.push(0);
        })
    });
}

#[test]
fn transact_rewrite_mismatch() {
    let tx = real_tx("real/work-transfer-0.msg");
    let data = tx.write().unwrap();
    let mut doctored = tx.clone();
    doctored.salt[0] ^= 1;
    let violation = verify_transact_rewrite(&doctored, &data).expect_err("differs");
    assert_eq!(violation.rule, Rule::TransactRewrite);
    assert!(verify_transact_rewrite(&tx, &data).is_ok());
}

#[test]
fn circuit_that_is_cached_or_ring() {
    for tag in [1u8, 2, 3, 4, 5, 6, 200] {
        refuse("transfer", Rule::CircuitNotDefault, |b| {
            mutate(b, |m| {
                let at = tx_position(m);
                let tx = transact::parse(&m.ixs[at].data).unwrap();
                let data = &mut m.ixs[at].data;
                let tail = 1 + 4 * tx.tree_contexts.len() + 1 + 33 * tx.inputs.len() + 192 + 5;
                let offset = data.len() - tail;
                data[offset] = tag;
            })
        });
    }
}

#[test]
fn circuit_with_other_public_slots() {
    refuse("transfer", Rule::CircuitNotDefault, |b| {
        mutate_tx(b, |tx| tx.circuit.slots = 4)
    });
}

#[test]
fn expiry_zero() {
    refuse("transfer", Rule::ExpiryZero, |b| {
        mutate_tx(b, |tx| tx.expiry = 0)
    });
    refuse("withdrawal", Rule::ExpiryZero, |b| {
        mutate_tx(b, |tx| tx.expiry = 0)
    });
}

#[test]
fn expiry_max() {
    refuse("transfer", Rule::ExpiryMax, |b| {
        mutate_tx(b, |tx| tx.expiry = u64::MAX)
    });
    refuse("withdrawal", Rule::ExpiryMax, |b| {
        mutate_tx(b, |tx| tx.expiry = u64::MAX)
    });
}

#[test]
fn expiry_that_is_not_the_intent() {
    refuse("transfer", Rule::ExpiryNotIntent, |b| {
        mutate_tx(b, |tx| tx.expiry += 1)
    });
    refuse("transfer", Rule::ExpiryNotIntent, |b| {
        mutate_tx(b, |tx| tx.expiry = 1)
    });
}

#[test]
fn expiry_beyond_the_window() {
    let vector = accept("transfer");
    let latest = NOW + 24 * 3600 + 3600;
    for expiry in [latest + 1, NOW + 7 * 24 * 3600, 4_102_444_800] {
        let intent = with_spend(&vector.intent, |spend| spend.expiry = expiry);
        let bytes = mutate_tx(&vector.bytes, |tx| tx.expiry = expiry);
        assert_refused(&bytes, &intent, Rule::ExpiryWindow);
    }
    let intent = with_spend(&vector.intent, |spend| spend.expiry = latest);
    let bytes = mutate_tx(&vector.bytes, |tx| tx.expiry = latest);
    assert!(
        check(&bytes, &intent, &pins(), NOW).is_ok(),
        "the last second of the window"
    );
}

#[test]
fn expiry_in_the_past() {
    let vector = accept("withdrawal");
    for expiry in [NOW, NOW - 1, 1] {
        let intent = with_spend(&vector.intent, |spend| spend.expiry = expiry);
        let bytes = mutate_tx(&vector.bytes, |tx| tx.expiry = expiry);
        assert_refused(&bytes, &intent, Rule::ExpiryWindow);
    }
}

#[test]
fn data_hash_present() {
    refuse("transfer", Rule::DataHashPresent, |b| {
        mutate_tx(b, |tx| tx.data_hash = Some([1; 32]))
    });
    refuse("transfer", Rule::DataHashPresent, |b| {
        mutate_tx(b, |tx| tx.ring_data_hash = Some([1; 32]))
    });
}

#[test]
fn loose_messages_present() {
    let message = LooseMessage {
        view_tag: [1; 32],
        data: vec![9; 8],
    };
    refuse("transfer", Rule::MessagesPresent, |b| {
        mutate_tx(b, |tx| tx.messages.push(message))
    });
}

#[test]
fn extra_leg() {
    refuse("withdrawal", Rule::LegMismatch, |b| {
        mutate_tx(b, |tx| tx.legs.push(Leg::SolWithdrawal(1)))
    });
    refuse("transfer", Rule::LegMismatch, |b| {
        mutate_tx(b, |tx| tx.legs.push(Leg::SolDeposit(1)))
    });
}

#[test]
fn missing_leg_or_changed_leg() {
    refuse("withdrawal", Rule::LegMismatch, |b| {
        mutate_tx(b, |tx| tx.legs.clear())
    });
    refuse("withdrawal", Rule::LegMismatch, |b| {
        mutate_tx(b, |tx| tx.legs = vec![Leg::SolWithdrawal(10_000_001)])
    });
    refuse("withdrawal", Rule::LegMismatch, |b| {
        mutate_tx(b, |tx| tx.legs = vec![Leg::SolDeposit(10_000_000)])
    });
}

#[test]
fn extra_output() {
    refuse("transfer", Rule::OutputCount, |b| {
        mutate_tx(b, |tx| {
            let again = tx.outputs[1].clone();
            tx.outputs.push(again);
        })
    });
    refuse("withdrawal", Rule::OutputCount, |b| {
        mutate_tx(b, |tx| tx.outputs.truncate(1))
    });
}

#[test]
fn extra_input_against_the_intent() {
    let vector = accept("transfer");
    let intent = with_spend(&vector.intent, |spend| spend.inputs = 2);
    assert_refused(&vector.bytes, &intent, Rule::InputCount);
}

#[test]
fn output_count_against_the_intent() {
    let vector = accept("withdrawal");
    let intent = with_spend(&vector.intent, |spend| spend.outputs = 3);
    assert_refused(&vector.bytes, &intent, Rule::OutputCount);
}

#[test]
fn second_tree_context_or_input_on_another_tree() {
    refuse("transfer", Rule::TreeContext, |b| {
        mutate_tx(b, |tx| {
            let again = tx.tree_contexts[0];
            tx.tree_contexts.push(again);
        })
    });
    refuse("transfer", Rule::TreeContext, |b| {
        mutate_tx(b, |tx| tx.inputs[0].tree_index = 1)
    });
}

#[test]
fn changed_change_owner_account() {
    refuse("transfer", Rule::OutputOwnerTag, |b| {
        mutate_tx(b, |tx| tx.outputs[0].owner_tag = OwnerTag::Account(1))
    });
    refuse("withdrawal", Rule::OutputOwnerTag, |b| {
        mutate_tx(b, |tx| tx.outputs[0].owner_tag = OwnerTag::Account(200))
    });
}

#[test]
fn changed_payee_owner_tag() {
    refuse("transfer", Rule::OutputOwnerTag, |b| {
        mutate_tx(b, |tx| tx.outputs[1].owner_tag = OwnerTag::Inline(ATTACKER))
    });
}

#[test]
fn withdrawal_output_that_names_a_third_party() {
    let payee = Facts::load().payee();
    refuse("withdrawal", Rule::OutputOwnerTag, |b| {
        mutate_tx(b, |tx| tx.outputs[1].owner_tag = OwnerTag::Inline(payee))
    });
}

#[test]
fn transfer_dummy_may_name_the_payee_or_the_group() {
    let vector = accept("transfer");
    let group = pins().group;
    for tag in [
        OwnerTag::Inline(group),
        OwnerTag::Account(0),
        OwnerTag::Inline(Facts::load().payee()),
    ] {
        let bytes = mutate_tx(&vector.bytes, |tx| tx.outputs[1].owner_tag = tag);
        assert!(
            check(&bytes, &vector.intent, &pins(), NOW).is_ok(),
            "{tag:?}"
        );
    }
}
