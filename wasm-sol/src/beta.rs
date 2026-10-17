//! What the Devnet beta signs (ZOLANA.md 5 and 7.2). `approve` checks a message against an intent;
//! this file decides which intents each key may sign at all, and adds the rules of the program
//! design.
//!
//! - The group key signs a v1 message only for the move of the beta funds to the PDA (SOL-36
//!   condition 3): the nonce account it needs and one nonce payment that pays its inputs whole to
//!   the group's own PDA address. Every payment after that is an approval digest
//!   (`approve_payment`), which signs no message.
//! - The fee key of a seat signs those two messages as their payer, Add SOL, and the `create`
//!   and `execute` messages of the approvals program.
//! - Nothing signs `register`, a nonce withdrawal (tag 4) or a nonce cancel: the group is never
//!   registered. A withdrawal goes through the program (tags 9 to 11, SOL-32).
//!
//! The rules of the PDA identity (Shield and the program messages) run with `Pins::for_pda`.

use crate::approve::{approve, Approved, Device};
use crate::check::{parse_transact_data, Refusal};
use crate::consts::MS_EXECUTE;
use crate::intent::{Intent, Program};
use crate::pay::{approve_pay, Payment, Recipient, Seen};
use crate::pins::Pins;
use crate::plan::{Proposal, Role};
use crate::program::{approval_digest, commitment, proposal_address, settlements};
use crate::roles::pda_address;
use crate::rule::{Rule, Violation};
use crate::sign::verify_strict;
use crate::template::body_of;
use crate::v1;

/// The key that would sign the message.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Signer {
    Group,
    Fee,
}

/// Why `signer` may not sign a message of this intent, or `None`.
fn retired(intent: &Intent, signer: Signer) -> Option<String> {
    let name = intent.name();
    match intent {
        Intent::CreateNonce { .. } | Intent::Transfer { .. } => None,
        Intent::Shield { .. }
        | Intent::Program(Program::Propose { .. })
        | Intent::Program(Program::Execute { .. }) => {
            (signer == Signer::Group).then(|| format!("only a fee key signs the intent {name}"))
        }
        _ => Some(format!("nothing signs the intent {name}")),
    }
}

fn refusal(rule: Rule, detail: impl Into<String>) -> Refusal {
    Refusal {
        violations: vec![Violation::new(rule, detail)],
    }
}

/// The move to the PDA: the payee of a nonce payment is the group's own PDA address, and no slot
/// is change, so the whole of the inputs moves.
fn migration_violations(proposal: &Proposal, pins: &Pins) -> Vec<Violation> {
    let Intent::Transfer { payee, .. } = &proposal.intent else {
        return Vec::new();
    };
    let own = pda_address(&pins.pda, &pins.pda_nullifier_pk, &pins.viewing_pk);
    let mut payee_bytes = Vec::new();
    payee.write(&mut payee_bytes);
    let change = proposal
        .plan
        .outputs
        .iter()
        .any(|slot| slot.role == Role::Change);
    if payee_bytes == own && !change {
        return Vec::new();
    }
    let why = "a nonce payment must pay its inputs whole to the program address of this group";
    vec![Violation::new(Rule::MigrationPayee, why)]
}

/// The `transact` data inside the `execute` of a message, if the message has one that parses.
fn execute_transact(bytes: &[u8], pins: &Pins) -> Option<crate::transact::Transact> {
    let msg = v1::parse(bytes).ok()?;
    let ix = msg
        .ixs
        .iter()
        .find(|ix| msg.program_key(ix) == Some(&pins.program))?;
    let rest = ix.data.strip_prefix(&[MS_EXECUTE])?;
    parse_transact_data(&[&[crate::consts::TAG_TRANSACT][..], rest].concat()).ok()
}

/// The approval in an `execute`: the group signature verifies over the digest of the body that
/// the fresh `transact` data gives, and the pool expiry is the expiry of that body. So the fee
/// key pays only for the payment that the group approved, and never after it expired.
fn execute_violations(bytes: &[u8], intent: &Intent, device: &Device) -> Vec<Violation> {
    let Intent::Program(Program::Execute {
        expiry,
        rent_recipient,
        signature,
        recipient,
        ..
    }) = intent
    else {
        return Vec::new();
    };
    let pins = device.pins;
    let fail = |why: &str| vec![Violation::new(Rule::ExecuteApproval, why)];
    let Some(tx) = execute_transact(bytes, pins) else {
        return fail("the execute data does not parse");
    };
    let mut out = Vec::new();
    if tx.expiry != *expiry || device.now >= *expiry {
        out.push(Violation::new(
            Rule::ExpiryNotIntent,
            "the payment expired or has another expiry",
        ));
    }
    let settled = settlements(&pins.sol_interface, *recipient);
    let digest = commitment(&tx.private_tx_hash, &tx, &settled).and_then(|commitment| {
        let body = body_of(pins, commitment, *expiry, *rent_recipient).write()?;
        let (proposal, _) = proposal_address(&pins.multisig, &commitment, &body)?;
        Ok(approval_digest(&proposal, &body))
    });
    match digest.map(|digest| verify_strict(&pins.multisig, &digest, signature)) {
        Ok(Ok(())) => {}
        Ok(Err(why)) | Err(why) => out.extend(fail(&why)),
    }
    out
}

/// The `create` message: the commitment of the intent is the one that the device computes from
/// the plan and the `transact` data of the first proof, with every rule of a payment.
fn propose_violations(proposal: &Proposal, device: &Device) -> Vec<Violation> {
    let Intent::Program(Program::Propose {
        pay, commitment, ..
    }) = &proposal.intent
    else {
        return Vec::new();
    };
    // The proposer read the recipient of a withdrawal in `check_payment` before this message.
    match approve_pay(
        (pay, &proposal.plan, &proposal.transact),
        device,
        None,
        None,
    ) {
        Ok(payment) if payment.commitment == *commitment => Vec::new(),
        Ok(_) => vec![Violation::new(
            Rule::BodyCommitment,
            "the commitment of the intent is not the commitment of the payment",
        )],
        Err(refusal) => refusal.violations,
    }
}

/// The pins of the identity that an intent spends or pays to: the PDA for the program design,
/// the group key for the move of the beta funds.
pub(crate) fn identity(intent: &Intent, pins: &Pins) -> Result<Pins, Refusal> {
    if intent.uses_pda() {
        return pins
            .for_pda()
            .map_err(|why| refusal(Rule::PlanInvalid, format!("the PDA identity: {why}")));
    }
    Ok(pins.clone())
}

/// Every rule for a message that `signer` would sign. `Ok` is the only answer that a signature
/// may follow. The rules of the beta come first in a refusal, then those of `approve`.
pub fn approve_message(
    bytes: &[u8],
    proposal: &Proposal,
    device: &Device,
    signer: Signer,
) -> Result<Approved, Refusal> {
    let intent = &proposal.intent;
    let mut out = Vec::new();
    if let Some(why) = retired(intent, signer) {
        out.push(Violation::new(Rule::IntentRetired, why));
    }
    let pins = identity(intent, device.pins)?;
    let device = Device {
        pins: &pins,
        ..*device
    };
    out.extend(migration_violations(proposal, &pins));
    out.extend(propose_violations(proposal, &device));
    out.extend(execute_violations(bytes, intent, &device));
    let approved = approve(bytes, intent, &proposal.plan, &device);
    match approved {
        Ok(approved) if out.is_empty() => Ok(approved),
        Ok(_) => Err(Refusal { violations: out }),
        Err(refused) => {
            out.extend(refused.violations);
            Err(Refusal { violations: out })
        }
    }
}

/// The approval of a payment (`Program::Approve`) with its proposal account on chain, and for a
/// withdrawal the recipient account. `Ok` holds the digest that the group key signs.
pub fn approve_payment(
    proposal: &Proposal,
    device: &Device,
    seen: &Seen,
    recipient: Option<&Recipient>,
) -> Result<Payment, Refusal> {
    let Intent::Program(Program::Approve { pay }) = &proposal.intent else {
        let why = "only the approval of a payment has a digest";
        return Err(refusal(Rule::IntentRetired, why));
    };
    let pins = identity(&proposal.intent, device.pins)?;
    let device = Device {
        pins: &pins,
        ..*device
    };
    approve_pay(
        (pay, &proposal.plan, &proposal.transact),
        &device,
        Some(seen),
        recipient,
    )
}
