//! The approval of a payment of the program design (ZOLANA.md 7.2). The group signs no message:
//! it signs the 32-byte digest of a proposal account, once, and any seat proves the payment again
//! when it executes. So a seat checks the plan, not message bytes.
//!
//! `approve_pay` takes the payment, the approved plaintext, the `transact` data of the first
//! proof and the device. It runs the `transact` rules and every Outputs, Legs and Ciphertexts
//! rule of section 5 on that data, recomputes `private_tx_hash` from the snapshot inputs and the
//! plan, and computes the commitment, the body, the proposal address and the digest. With `seen`
//! (what the device read and approved before) it also checks the proposal account on chain and
//! the rule of one body per commitment.
//!
//! The pins must be those of the PDA identity (`Pins::for_pda`): the change and the inputs belong
//! to the PDA.

use sha2::{Digest, Sha256};

use crate::approve::{pin_violations, Device};
use crate::bytes::Reader;
use crate::check::{parse_transact_data, Facts, Refusal, Run};
use crate::consts::{Key, SYSTEM_PROGRAM};
use crate::hashes::{owner_hash, Utxo, TREE_ID};
use crate::intent::{Intent, Pay, Spend};
use crate::pins::Pins;
use crate::plan::{Plan, Role};
use crate::program::{
    approval_digest, cancellation_address, commitment, private_tx_hash, proposal_address, Body,
    KIND_PROPOSAL, MAX_EXECUTE_INPUTS,
};
use crate::rule::{Rule, Violation};
use crate::spend::{spend_violations, Group, SpendInput, Summary};
use crate::template::body_of;
use crate::transact::Transact;
use crate::v1::{Config, Ix, Message};

/// A proposal account as the device read it from the chain.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Account {
    pub owner: Key,
    pub data: Vec<u8>,
}

/// What the device saw: the proposal account (none before it is created) and the (commitment,
/// SHA-256 of the body) of every payment that its seats approved before.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Seen {
    pub account: Option<Account>,
    pub approved: Vec<(Key, Key)>,
}

impl Seen {
    /// The wire form: a flag, then the owner, the data length (u16) and the data of the account,
    /// then the count (u16) and the pairs.
    pub fn encode(&self) -> Result<Vec<u8>, String> {
        let mut out = vec![u8::from(self.account.is_some())];
        if let Some(account) = &self.account {
            let len = u16::try_from(account.data.len()).map_err(|_| "the account is long")?;
            out.extend_from_slice(&account.owner);
            out.extend_from_slice(&len.to_le_bytes());
            out.extend_from_slice(&account.data);
        }
        let count = u16::try_from(self.approved.len()).map_err(|_| "too many approvals")?;
        out.extend_from_slice(&count.to_le_bytes());
        for (commitment, body) in &self.approved {
            out.extend_from_slice(commitment);
            out.extend_from_slice(body);
        }
        Ok(out)
    }

    /// Reads the wire form. The whole input must be used.
    pub fn decode(bytes: &[u8]) -> Result<Self, String> {
        let short = |_| "seen: the input ends inside a field".to_string();
        let mut r = Reader::new(bytes);
        let account = match r.u8().map_err(short)? {
            0 => None,
            1 => {
                let owner = r.array().map_err(short)?;
                let len = usize::from(r.u16().map_err(short)?);
                let data = r.take(len).map_err(short)?.to_vec();
                Some(Account { owner, data })
            }
            _ => return Err("seen: the account flag is not 0 or 1".to_string()),
        };
        let mut approved = Vec::new();
        for _ in 0..r.u16().map_err(short)? {
            approved.push((r.array().map_err(short)?, r.array().map_err(short)?));
        }
        if !r.is_empty() {
            return Err("bytes follow the seen data".to_string());
        }
        Ok(Self { account, approved })
    }
}

/// An approved payment: what the group signs and what the screen shows.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Payment {
    pub commitment: Key,
    pub body: Vec<u8>,
    pub proposal: Key,
    pub digest: [u8; 32],
    pub summary: Summary,
}

/// The rules of section 5 read a spend through a `Transfer` and a message. The payment has
/// neither, so it gets both: the terms of the payment with no nonce, and a message whose only
/// instruction is the pool `transact` with no account. An output that names an account index
/// then names nothing, so only inline owner tags pass, as the program requires.
fn as_transfer(pay: &Pay) -> Intent {
    Intent::Transfer {
        spend: Spend {
            nonce: [0; 32],
            expiry: pay.expiry,
            inputs: pay.inputs,
            outputs: pay.outputs,
        },
        payee: pay.payee.clone(),
        mint: pay.mint,
        amount: pay.amount,
    }
}

fn as_message(pins: &Pins, transact: &[u8]) -> Message {
    Message {
        header: [1, 0, 1],
        config: Config::default(),
        lifetime: [0; 32],
        keys: vec![pins.pool],
        ixs: vec![Ix {
            program: 0,
            accounts: Vec::new(),
            data: transact.to_vec(),
        }],
    }
}

/// The input hashes that the snapshot gives, the output hashes of the data (a dummy slot is 0)
/// and the first nullifier of the snapshot: the recompute of `private_tx_hash`.
fn recompute(pins: &Pins, plan: &Plan, tx: &Transact, device: &Device) -> Result<Key, String> {
    let utxo = |input: &crate::snapshot::InputUtxo| Utxo {
        owner_hash: pins.group_owner_hash,
        mint: input.mint,
        amount: input.amount,
        blinding: input.blinding,
    };
    let inputs = &device.snapshot.inputs;
    let hashes = inputs
        .iter()
        .map(|input| utxo(input).hash(TREE_ID))
        .collect::<Result<Vec<_>, _>>()?;
    let first = inputs.first().ok_or("the snapshot has no input")?;
    let first = utxo(first).nullifier(TREE_ID, &device.snapshot.nullifier_secret)?;
    let outputs: Vec<Key> = plan
        .outputs
        .iter()
        .zip(&tx.outputs)
        .map(|(slot, out)| {
            if slot.role == Role::Dummy {
                [0; 32]
            } else {
                out.utxo_hash
            }
        })
        .collect();
    private_tx_hash(&hashes, &outputs, &first, &plan.blinding_seed)
}

/// The `transact` and spend rules of section 5 on the data of the first proof.
fn spend_rules(input: (&Pay, &Plan), tx: &Transact, data: &[u8], device: &Device) -> Checked {
    let (pay, plan) = input;
    let pins = device.pins;
    let (intent, msg) = (as_transfer(pay), as_message(pins, data));
    let mut run = Run {
        msg: &msg,
        intent: &intent,
        pins,
        now: device.now,
        out: Vec::new(),
    };
    run.transact_rules(0, tx);
    let facts = Facts {
        transact: Some(tx.clone()),
        transact_at: Some(0),
        ..Facts::default()
    };
    let (found, summary) = spend_violations(&SpendInput {
        msg: &msg,
        facts: &facts,
        intent: &intent,
        plan,
        snapshot: device.snapshot,
        group: &Group::of(pins),
        assets: &pins.assets,
    });
    let mut out = run.out;
    out.extend(found);
    Checked { out, summary }
}

struct Checked {
    out: Vec<Violation>,
    summary: Summary,
}

/// The addresses that a rent recipient may never be: they could never take the rent back.
fn program_addresses(pins: &Pins, proposal: &Key) -> Result<Vec<Key>, String> {
    Ok(vec![
        pins.pda,
        pins.program,
        SYSTEM_PROGRAM,
        *proposal,
        cancellation_address(proposal)?,
    ])
}

/// The fields of a body against the payment that the device computed.
/// The fee key of the proposing seat is never an address of the program (`approve_pay`), so a
/// stored rent recipient that equals it is never one either.
fn body_violations(have: &Body, want: &Body) -> Vec<Violation> {
    let checks = [
        (
            have.commitment != want.commitment,
            Rule::BodyCommitment,
            "another commitment",
        ),
        (
            have.group != want.group,
            Rule::BodyGroup,
            "another group key",
        ),
        (
            have.expiry != want.expiry,
            Rule::BodyExpiry,
            "another expiry",
        ),
        (
            have.rent_recipient != want.rent_recipient,
            Rule::RentRecipient,
            "the rent recipient is not the fee key of the proposing seat",
        ),
        (
            have.authorities != want.authorities,
            Rule::AbortAuthorities,
            "the abort authorities are not the fee key of the proposing seat",
        ),
    ];
    checks
        .into_iter()
        .filter(|(bad, _, _)| *bad)
        .map(|(_, rule, why)| Violation::new(rule, why))
        .collect()
}

/// The proposal account: owned by the program, kind 1 and the canonical bump, then a body that
/// equals the body of the payment field by field.
fn account_violations(account: Option<&Account>, want: (&Body, u8), pins: &Pins) -> Vec<Violation> {
    let (want, bump) = want;
    let Some(account) = account.filter(|a| a.owner == pins.program) else {
        let why = "the proposal account does not exist or the program does not own it";
        return vec![Violation::new(Rule::AccountOwner, why)];
    };
    let (head, stored) = account.data.split_at_checked(2).unwrap_or_default();
    if head != [KIND_PROPOSAL, bump] {
        let why = "the account is not a proposal with the canonical bump";
        return vec![Violation::new(Rule::AccountData, why)];
    }
    match Body::parse(stored) {
        Ok(have) => body_violations(&have, want),
        Err(why) => vec![Violation::new(Rule::AccountData, why)],
    }
}

/// One body per commitment: the address does not bind the rent recipient or the abort
/// authorities (the commitment binds the pool expiry, and body-expiry ties the body to it), so a
/// second body for an approved commitment is refused.
// ponytail: the list lives in the seat secret of this browser, so a restored seat or another
// browser of the seat starts with none (as the salts, SOL-8, SOL-48). Upgrade path: the body hash
// in the address (program version 4).
fn once_violation(seen: &Seen, commitment: &Key, body: &[u8]) -> Option<Violation> {
    let hash: Key = Sha256::digest(body).into();
    let other = seen
        .approved
        .iter()
        .any(|(approved, body_hash)| approved == commitment && *body_hash != hash);
    other.then(|| {
        Violation::new(
            Rule::BodyOnce,
            "a seat approved another body for this payment",
        )
    })
}

/// The private payment `pay` with its plan and its `transact` data, on the device with the pins
/// of the PDA identity. `seen` is the chain and approval state; `None` before the account exists
/// (the proposer, when it signs the `create` message).
pub fn approve_pay(
    proposal: (&Pay, &Plan, &[u8]),
    device: &Device,
    seen: Option<&Seen>,
) -> Result<Payment, Refusal> {
    let (pay, plan, data) = proposal;
    let pins = device.pins;
    let refuse = |violations| Refusal { violations };
    let owner = owner_hash(&pins.group, &pins.nullifier_pk)
        .map_err(|why| refuse(vec![Violation::new(Rule::PlanInvalid, why)]))?;
    let mut out = pin_violations(pins, owner, &device.snapshot.group_keys());
    let tx = parse_transact_data(data).map_err(|v| refuse(vec![v]))?;
    let run = spend_rules((pay, plan), &tx, data, device);
    out.extend(run.out);
    if tx.inputs.len() > MAX_EXECUTE_INPUTS {
        let why = format!(
            "{} inputs, and one execute carries {MAX_EXECUTE_INPUTS}",
            tx.inputs.len()
        );
        out.push(Violation::new(Rule::ExecuteInputs, why));
    }
    let private = recompute(pins, plan, &tx, device)
        .map_err(|why| refuse(vec![Violation::new(Rule::PlanInvalid, why)]))?;
    if private != tx.private_tx_hash {
        let why = "the private_tx_hash of the data is not the recompute of the plan";
        out.push(Violation::new(Rule::PrivateTxHash, why));
    }
    let plain = |why: String| refuse(vec![Violation::new(Rule::PlanInvalid, why)]);
    let commitment = commitment(&private, &tx).map_err(plain)?;
    let want = body_of(pins, commitment, pay.expiry, pins.payer);
    let body = want.write().map_err(plain)?;
    let (address, bump) = proposal_address(&pins.multisig, &commitment).map_err(plain)?;
    let banned = program_addresses(pins, &address).map_err(plain)?;
    if banned.contains(&pins.payer) {
        let why = "the fee key of the proposing seat is an address of the program";
        out.push(Violation::new(Rule::RentRecipient, why));
    }
    if let Some(seen) = seen {
        out.extend(account_violations(
            seen.account.as_ref(),
            (&want, bump),
            pins,
        ));
        out.extend(once_violation(seen, &commitment, &body));
    }
    if !out.is_empty() {
        return Err(refuse(out));
    }
    Ok(Payment {
        commitment,
        digest: approval_digest(&address, &body),
        body,
        proposal: address,
        summary: run.summary,
    })
}
