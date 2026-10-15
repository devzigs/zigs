//! `approve`: every rule of ZOLANA.md section 5 for one message. It runs the P3a rules
//! (`check_all`) with the owner hash that it computes from the pins, compares the secrets of the
//! device with the pins, and for a spend runs the Outputs, Legs and Ciphertexts rules against the
//! approved plaintext and the device snapshot. `Ok` is the only answer that an approval screen
//! may act on.

use crate::check::{check_all, Facts, Refusal};
use crate::consts::Key;
use crate::hashes::owner_hash;
use crate::intent::Intent;
use crate::pins::Pins;
use crate::plan::Plan;
use crate::rule::{Rule, Violation};
use crate::rules_ix::register_fault;
use crate::snapshot::Snapshot;
use crate::spend::{spend_violations, Group, SpendInput, Summary};
use crate::v1;

/// What the approving device knows: the pinned constants, its own snapshot and its clock.
pub struct Device<'a> {
    pub pins: &'a Pins,
    pub snapshot: &'a Snapshot,
    /// Unix time on the approving device.
    pub now: u64,
}

/// A message that passes every rule.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Approved {
    pub facts: Facts,
    /// The payee amount, the change, the withdrawal, the tree fee, the recipient and the expiry,
    /// for the approval screen.
    pub summary: Summary,
}

/// The keys that the secrets of the device derive, or why they do not.
type DeviceKeys = Result<(Key, [u8; 33]), String>;

fn refusal(rule: Rule, detail: impl Into<String>) -> Refusal {
    Refusal {
        violations: vec![Violation::new(rule, detail)],
    }
}

/// The pins against each other, and the secrets of the device against the pins. A device whose
/// secrets derive other keys than the `soldone` document would build and check a wallet that is
/// not the group.
fn pin_violations(pins: &Pins, owner: Key, keys: &DeviceKeys) -> Vec<Violation> {
    let mut found = Vec::new();
    if owner != pins.group_owner_hash {
        let why =
            "the owner_hash of the pins is not the hash of the pinned group key and nullifier_pk";
        found.push(Violation::new(Rule::GroupOwnerHash, why));
    }
    match keys {
        Ok((nullifier_pk, viewing_pk)) => {
            if *nullifier_pk != pins.nullifier_pk {
                let why = "the nullifier secret of the device does not derive the pinned key";
                found.push(Violation::new(Rule::GroupNullifierPk, why));
            }
            if *viewing_pk != pins.viewing_pk {
                let why = "the viewing scalar of the device does not derive the pinned key";
                found.push(Violation::new(Rule::GroupViewingPk, why));
            }
        }
        Err(why) => found.push(Violation::new(
            Rule::PlanInvalid,
            format!("device keys: {why}"),
        )),
    }
    found
}

/// A registration is permanent, so the keys of the `register` data are also compared with the
/// keys that the secrets of the device derive (the pins were compared in `check_all`).
fn register_violations(intent: &Intent, facts: &Facts, keys: &DeviceKeys) -> Vec<Violation> {
    let (true, Ok((nullifier_pk, viewing_pk))) = (matches!(intent, Intent::Register { .. }), keys)
    else {
        return Vec::new();
    };
    let Some(register) = &facts.register else {
        return vec![Violation::new(
            Rule::RegisterLength,
            "no register data was read",
        )];
    };
    register_fault(
        register,
        nullifier_pk,
        viewing_pk,
        "the key of the device secrets",
    )
    .into_iter()
    .map(|(rule, why)| Violation::new(rule, why))
    .collect()
}

/// The P3c rules of a spend, on the message that `check_all` read.
fn spend_part(
    bytes: &[u8],
    input: (&Intent, &Plan, &Facts),
    device: &Device,
    pins: &Pins,
) -> (Vec<Violation>, Summary) {
    let (intent, plan, facts) = input;
    let Ok(msg) = v1::parse(bytes) else {
        let why = "the message of the spend did not parse, so no P3c rule ran";
        return (
            vec![Violation::new(Rule::SpendUnread, why)],
            Summary::default(),
        );
    };
    let group = Group::of(pins);
    spend_violations(&SpendInput {
        msg: &msg,
        facts,
        intent,
        plan,
        snapshot: device.snapshot,
        group: &group,
        assets: &pins.assets,
    })
}

/// Checks a message against an intent, the approved plaintext and the device. The owner hash is
/// computed from the pinned group key and `nullifier_pk` (the pin that is stored is compared with
/// it), and the P3a rules run with the computed value.
pub fn approve(
    bytes: &[u8],
    intent: &Intent,
    plan: &Plan,
    device: &Device,
) -> Result<Approved, Refusal> {
    let owner = owner_hash(&device.pins.group, &device.pins.nullifier_pk)
        .map_err(|why| refusal(Rule::PlanInvalid, format!("pinned group keys: {why}")))?;
    let keys = device.snapshot.group_keys();
    let mut violations = pin_violations(device.pins, owner, &keys);
    let pins = Pins {
        group_owner_hash: owner,
        ..device.pins.clone()
    };
    let report = check_all(bytes, intent, &pins, device.now);
    violations.extend(report.violations);
    violations.extend(register_violations(intent, &report.facts, &keys));
    let mut summary = Summary::default();
    if intent.is_spend() {
        let (found, paid) = spend_part(bytes, (intent, plan, &report.facts), device, &pins);
        violations.extend(found);
        summary = paid;
    }
    if !violations.is_empty() {
        return Err(Refusal { violations });
    }
    Ok(Approved {
        facts: report.facts,
        summary,
    })
}
