//! The real messages of P2 and P5: they parse and rewrite byte for byte, and each one that
//! breaks the template is refused with the rules that name the break.

mod common;

use common::*;
use p3_check::check::check_all;
use p3_check::intent::{Intent, Spend};
use p3_check::rule::Rule;
use p3_check::v1;

const V1_FILES: &[&str] = &[
    "real/work-register-0.msg",
    "real/work-shield-0.msg",
    "real/work-transfer-0.msg",
    "real/work-withdraw-0.msg",
    "real/work-stretch-0.msg",
    "real/work-c-orig.v.msg",
    "real/work-c-flip.v.msg",
    "real/chain-register.msg",
    "real/chain-shield.msg",
    "real/chain-transfer.msg",
    "real/chain-withdraw.msg",
    "real/chain-stretch.msg",
    "p2/wire-v1_nonce_send.msg",
    "p2/wire-v1default_nonce_now.msg",
    "p2/wire-v1_blockhash_default_loaded.msg",
    "p2/wire-v1_blockhash_explicit_loaded.msg",
];

const NOT_V1_FILES: &[&str] = &[
    "real/work-report-fund.v.msg",
    "real/work-selfcheck-ok.v.msg",
    "real/work-selfcheck-bad.v.msg",
    "real/work-t.msg",
    "p2/wire-fund.msg",
    "p2/wire-nonce_create.msg",
];

#[test]
fn every_real_v1_message_parses_and_rewrites_byte_for_byte() {
    for path in V1_FILES {
        let bytes = read(path);
        let msg = v1::parse(&bytes).unwrap_or_else(|e| panic!("{path}: {e:?}"));
        assert_eq!(write(&msg), bytes, "{path}");
    }
}

#[test]
fn messages_that_are_not_v1_are_refused_at_the_version_rule() {
    for path in NOT_V1_FILES {
        let bytes = read(path);
        let report = report(&bytes, &Intent::Cancel { nonce: [0; 32] });
        assert_eq!(report.violations.len(), 1, "{path}");
        assert_eq!(report.violations[0].rule, Rule::Version, "{path}");
    }
}

#[test]
fn the_landed_messages_on_devnet_equal_the_messages_in_the_work_folder() {
    for (chain, work) in [
        ("register", "register-0"),
        ("shield", "shield-0"),
        ("transfer", "transfer-0"),
        ("withdraw", "withdraw-0"),
        ("stretch", "stretch-0"),
    ] {
        assert_eq!(
            read(&format!("real/chain-{chain}.msg")),
            read(&format!("real/work-{work}.msg")),
            "{chain}"
        );
    }
}

fn own_lifetime(path: &str) -> [u8; 32] {
    parse(&read(path)).lifetime
}

fn violations(path: &str, intent: &Intent) -> Vec<Rule> {
    report(&read(path), intent)
        .violations
        .iter()
        .map(|v| v.rule)
        .collect()
}

fn transfer(nonce: [u8; 32]) -> Intent {
    let spend = Spend {
        nonce,
        expiry: EXPIRY,
        inputs: 1,
        outputs: 2,
    };
    Intent::Transfer {
        spend,
        payee: Facts::load().payee_address(),
        mint: [0; 32],
        amount: Facts::load().amount("transfer"),
    }
}

use Rule::*;

// Every P5 message but the stretch one breaks the SDK defaults: 450,000 or 200,000 compute units
// (ComputeUnitsOverCap), no AdvanceNonceAccount and a blockhash (InstructionCount and
// InstructionMismatch).

/// The group paid and signed every P5 message alone. The template has the fee key pay, so the
/// first account is not the payer of the proposal. The count of signers breaks too, unless the
/// intent has one signer (Shield).
const GROUP_PAID: [Rule; 2] = [FeePayerNotPayer, SignerSet];

#[test]
fn real_register_breaks_the_template_and_its_keys_fit() {
    let facts = Facts::load();
    let intent = Intent::Register {
        nonce: own_lifetime("real/work-register-0.msg"),
        nullifier_pk: facts.nullifier_pk(),
        viewing_pk: facts.viewing_pk(),
    };
    let mut want = vec![ComputeUnitsOverCap];
    want.extend(GROUP_PAID);
    want.extend([InstructionCount, InstructionMismatch, AccountFlags]);
    want.extend([AccountSet, AccountSet, AccountSet]);
    assert_eq!(violations("real/work-register-0.msg", &intent), want);
}

#[test]
fn real_shield_breaks_the_template_and_its_fields_fit() {
    let intent = Intent::Shield {
        blockhash: own_lifetime("real/work-shield-0.msg"),
        amount: Facts::load().amount("shield"),
    };
    let mut want = vec![ComputeUnitsOverCap, FeePayerNotPayer, AccountAddress];
    want.extend([AccountSet, AccountSet]);
    assert_eq!(violations("real/work-shield-0.msg", &intent), want);
}

#[test]
fn real_transfer_withdraw_and_unlanded_transfers_break_the_template() {
    let facts = Facts::load();
    let withdrawal = |nonce| Intent::Withdrawal {
        spend: Spend {
            nonce,
            expiry: EXPIRY,
            inputs: 1,
            outputs: 2,
        },
        recipient: facts.recipient(),
        amount: facts.amount("withdraw"),
    };
    let mut want = vec![ComputeUnitsOverCap];
    want.extend(GROUP_PAID);
    want.extend([
        InstructionCount,
        InstructionMismatch,
        ExpiryMax,
        AccountFlags,
    ]);
    want.extend([AccountSet, AccountSet, AccountSet]);
    for path in [
        "real/work-transfer-0.msg",
        "real/work-c-orig.v.msg",
        "real/work-c-flip.v.msg",
    ] {
        assert_eq!(
            violations(path, &transfer(own_lifetime(path))),
            want,
            "{path}"
        );
    }
    let path = "real/work-withdraw-0.msg";
    assert_eq!(
        violations(path, &withdrawal(own_lifetime(path))),
        want,
        "{path}"
    );
}

#[test]
fn the_stretch_transfer_paid_by_the_group_breaks_the_payer_rules_and_the_old_limits() {
    // It fitted the template of the group as payer, except its compute limit and its expiry.
    // The fee key pays now: the payer, the signers, the owner signer account and the flags break
    // as well.
    let path = "real/work-stretch-0.msg";
    let got = violations(path, &transfer(Facts::load().stretch_nonce()));
    let mut want = vec![ComputeUnitsOverCap];
    want.extend(GROUP_PAID);
    want.extend([AccountCount, ExpiryMax, AccountFlags, AccountSet]);
    assert_eq!(got, want);
}

#[test]
fn p2_nonce_transfer_is_refused_for_its_system_transfer_and_limits() {
    let cancel = Intent::Cancel { nonce: [0; 32] };
    let got = violations("p2/wire-v1_nonce_send.msg", &cancel);
    assert!(
        got.contains(&SystemTransfer) && got.contains(&InstructionCount),
        "{got:?}"
    );
    let got = violations("p2/wire-v1default_nonce_now.msg", &cancel);
    assert_eq!(got.first(), Some(&ConfigLoadedBit), "{got:?}");
    let got = violations("p2/wire-v1_blockhash_default_loaded.msg", &cancel);
    assert_eq!(got.first(), Some(&ConfigLoadedBit), "{got:?}");
    let got = violations("p2/wire-v1_blockhash_explicit_loaded.msg", &cancel);
    assert!(got.contains(&SystemTransfer), "{got:?}");
}

#[test]
fn each_real_message_that_breaks_the_template_is_refused_by_check() {
    let cancel = Intent::Cancel { nonce: [0; 32] };
    for path in V1_FILES.iter().filter(|p| p.starts_with("p2/")) {
        let outcome = p3_check::check::check(&read(path), &cancel, &pins(), NOW);
        assert!(outcome.is_err(), "{path}");
    }
    // The only real P5 message that nearly fits is the stretch transfer. It is still refused.
    let intent = transfer(Facts::load().stretch_nonce());
    let outcome = p3_check::check::check(&read("real/work-stretch-0.msg"), &intent, &pins(), NOW);
    assert_eq!(outcome.expect_err("refused").rule(), ComputeUnitsOverCap);
    assert!(
        check_all(&read("real/work-stretch-0.msg"), &intent, &pins(), NOW)
            .facts
            .transact
            .is_some()
    );
}
