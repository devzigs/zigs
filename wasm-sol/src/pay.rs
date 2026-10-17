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
use crate::intent::{Intent, Pay, Payee, Spend};
use crate::pins::Pins;
use crate::plan::{Plan, Role};
use crate::program::{
    approval_digest, commitment, max_execute_inputs, private_tx_hash, proposal_address,
    settlements, Body, KIND_PROPOSAL,
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
        let mut r = Reader::new(bytes);
        let seen = Self::read(&mut r)?;
        if !r.is_empty() {
            return Err("bytes follow the seen data".to_string());
        }
        Ok(seen)
    }

    fn read(r: &mut Reader) -> Result<Self, String> {
        let short = |_| "seen: the input ends inside a field".to_string();
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
        Ok(Self { account, approved })
    }
}

/// A flag byte of a wire form: 0 or 1.
fn flag(byte: u8, what: &str) -> Result<bool, String> {
    match byte {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(format!("{what}: a flag is not 0 or 1")),
    }
}

/// What the device read of the public recipient of a withdrawal: its account (none when it does
/// not exist) and the rent-exempt minimum of an account with no data (the Worker `rent`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Recipient {
    pub account: Option<RecipientAccount>,
    pub rent_min: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RecipientAccount {
    pub owner: Key,
    pub lamports: u64,
    pub executable: bool,
}

impl Recipient {
    /// The wire form: a flag, then the owner, the lamports (u64 LE) and the executable flag of
    /// the account, then the rent minimum (u64 LE).
    pub fn encode(&self) -> Vec<u8> {
        let mut out = vec![u8::from(self.account.is_some())];
        if let Some(account) = &self.account {
            out.extend_from_slice(&account.owner);
            out.extend_from_slice(&account.lamports.to_le_bytes());
            out.push(u8::from(account.executable));
        }
        out.extend_from_slice(&self.rent_min.to_le_bytes());
        out
    }

    fn read(r: &mut Reader) -> Result<Self, String> {
        let short = |_| "recipient: the input ends inside a field".to_string();
        let account = if flag(r.u8().map_err(short)?, "recipient")? {
            Some(RecipientAccount {
                owner: r.array().map_err(short)?,
                lamports: r.u64().map_err(short)?,
                executable: flag(r.u8().map_err(short)?, "recipient")?,
            })
        } else {
            None
        };
        let rent_min = r.u64().map_err(short)?;
        Ok(Self { account, rent_min })
    }
}

/// What the device read from the chain for a payment: the proposal account and the approvals of
/// its seats (`seen`; none before the account exists, for the proposer), and the recipient account
/// of a withdrawal (none for a private payment). It is the input `chain` of `check_payment`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Chain {
    pub seen: Option<Seen>,
    pub recipient: Option<Recipient>,
}

impl Chain {
    /// The wire form: a flag and the `Seen` wire, then a flag and the `Recipient` wire.
    pub fn encode(&self) -> Result<Vec<u8>, String> {
        let mut out = vec![u8::from(self.seen.is_some())];
        if let Some(seen) = &self.seen {
            out.extend(seen.encode()?);
        }
        out.push(u8::from(self.recipient.is_some()));
        if let Some(recipient) = &self.recipient {
            out.extend(recipient.encode());
        }
        Ok(out)
    }

    /// Reads the wire form. The whole input must be used.
    pub fn decode(bytes: &[u8]) -> Result<Self, String> {
        let short = |_| "chain: the input ends inside a field".to_string();
        let mut r = Reader::new(bytes);
        let seen = if flag(r.u8().map_err(short)?, "chain")? {
            Some(Seen::read(&mut r)?)
        } else {
            None
        };
        let recipient = if flag(r.u8().map_err(short)?, "chain")? {
            Some(Recipient::read(&mut r)?)
        } else {
            None
        };
        if !r.is_empty() {
            return Err("bytes follow the chain data".to_string());
        }
        Ok(Self { seen, recipient })
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

/// The rules of section 5 read a spend through a `Transfer` (or a `Withdrawal`) and a message.
/// The payment has neither, so it gets both: the terms of the payment with no nonce, and a message
/// whose only instruction is the pool `transact` with no account. An output that names an account
/// index then names nothing, so only inline owner tags pass, as the program requires.
fn as_spend(pay: &Pay) -> Intent {
    let spend = Spend {
        nonce: [0; 32],
        expiry: pay.expiry,
        inputs: pay.inputs,
        outputs: pay.outputs,
    };
    match &pay.payee {
        Payee::Shielded(payee) => Intent::Transfer {
            spend,
            payee: payee.clone(),
            mint: pay.mint,
            amount: pay.amount,
        },
        Payee::Public(recipient) => Intent::Withdrawal {
            spend,
            recipient: *recipient,
            amount: pay.amount,
        },
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
    let (intent, msg) = (as_spend(pay), as_message(pins, data));
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

/// The addresses that a rent recipient may never be (error 6021 of the program): they could
/// never take the rent back. A body cannot name its own proposal or record address: the address
/// binds the body hash.
fn program_addresses(pins: &Pins) -> [Key; 3] {
    [pins.pda, pins.program, SYSTEM_PROGRAM]
}

/// The read of the recipient account of a withdrawal that a check has.
#[derive(Clone, Copy, Debug)]
pub enum Read<'a> {
    /// What the device read (`Chain::recipient`). None is refused: the device must read it.
    Device(Option<&'a Recipient>),
    /// The `create` message of the proposer: its `check_payment` checked the read before.
    Checked,
}

/// The accounts that a withdrawal never pays: the SOL there is out of reach of the group (the beta
/// signs no plain transfer from the group key, the PDA or the nonce account; the CPI authority of
/// the pool signs only SPL transfers; the nullifier PDAs of the inputs become pool accounts in the
/// same `transact`, before the pool pays the leg), or the pool and the program refuse it.
fn banned_recipients(pins: &Pins, tx: &Transact) -> Result<Vec<Key>, String> {
    let mut banned = vec![
        pins.pda,
        pins.group,
        pins.multisig,
        pins.nonce_account,
        pins.sol_interface,
        pins.pool,
        pins.registry,
        pins.user_record,
        pins.input_tree,
        pins.output_tree,
        pins.program,
        SYSTEM_PROGRAM,
        pins.cpi_authority()?,
    ];
    for input in &tx.inputs {
        banned.push(pins.nullifier_pda(&pins.input_tree, &input.nullifier)?);
    }
    Ok(banned)
}

/// The recipient account after the withdrawal: an ordinary System account (or a new one) that
/// holds at least the rent-exempt minimum. SOL in an account of a program is out of reach of the
/// person, and a new account below the minimum makes every `execute` fail until the expiry, with
/// the proposal rent locked (no cancel, SOL-52). The rule holds when the device checks.
fn recipient_account_violation(read: &Recipient, amount: u64) -> Option<Violation> {
    let (ordinary, lamports) = match read.account {
        Some(account) => (
            account.owner == SYSTEM_PROGRAM && !account.executable,
            account.lamports,
        ),
        None => (true, 0),
    };
    let why = if !ordinary {
        "the recipient account is not an ordinary System account"
    } else if lamports.saturating_add(amount) < read.rent_min {
        "after the withdrawal the recipient holds less than the rent-exempt minimum"
    } else {
        return None;
    };
    Some(Violation::new(Rule::RecipientAccount, why))
}

/// The public recipient of a withdrawal: never one of `banned`, and its account as the device
/// read it.
fn recipient_violations(pins: &Pins, to: (Key, u64), banned: &[Key], read: Read) -> Vec<Violation> {
    let (recipient, amount) = to;
    let mut out = Vec::new();
    if banned.contains(&recipient) {
        let why = format!("the recipient is the {}", pins.label(&recipient));
        out.push(Violation::new(Rule::WithdrawalRecipient, why));
    }
    match read {
        Read::Device(Some(read)) => out.extend(recipient_account_violation(read, amount)),
        Read::Device(None) => out.push(Violation::new(
            Rule::RecipientAccount,
            "the device did not read the recipient account",
        )),
        Read::Checked => {}
    }
    out
}

/// One `execute` carries at most 18 inputs, two fewer per withdrawal leg.
fn input_violation(inputs: usize, legs: usize) -> Option<Violation> {
    let cap = max_execute_inputs(legs);
    let why = format!("{inputs} inputs, and one execute carries {cap}");
    (inputs > cap).then(|| Violation::new(Rule::ExecuteInputs, why))
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

/// One body per commitment: two bodies for one commitment, both signed, are two approvals of one
/// payment with other rent recipients or abort authorities, and the program cannot tell them apart
/// (ZOLANA.md 7.2, N3). So a second body for an approved commitment is refused.
// ponytail: the list lives in the seat secret of this browser, so a restored seat or another
// browser of the seat starts with none (as the salts, SOL-8). Upgrade path: a signed list (SOL-53).
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

/// The payment `pay` (a private payment or a withdrawal) with its plan and its `transact` data,
/// on the device with the pins of the PDA identity. `seen` is the chain and approval state; `None`
/// before the account exists (the proposer, when it signs the `create` message). `read` is what
/// the device read of the public recipient of a withdrawal.
pub fn approve_pay(
    proposal: (&Pay, &Plan, &[u8]),
    device: &Device,
    seen: Option<&Seen>,
    read: Read,
) -> Result<Payment, Refusal> {
    let (pay, plan, data) = proposal;
    let pins = device.pins;
    let refuse = |violations| Refusal { violations };
    let plain = |why: String| refuse(vec![Violation::new(Rule::PlanInvalid, why)]);
    let owner = owner_hash(&pins.group, &pins.nullifier_pk)
        .map_err(|why| refuse(vec![Violation::new(Rule::PlanInvalid, why)]))?;
    let mut out = pin_violations(pins, owner, &device.snapshot.group_keys());
    let tx = parse_transact_data(data).map_err(|v| refuse(vec![v]))?;
    let mut run = spend_rules((pay, plan), &tx, data, device);
    out.extend(run.out);
    let settled = settlements(&pins.sol_interface, pay.recipient());
    out.extend(input_violation(tx.inputs.len(), settled.len()));
    if let Some(to) = pay.recipient() {
        let banned = banned_recipients(pins, &tx).map_err(plain)?;
        out.extend(recipient_violations(pins, (to, pay.amount), &banned, read));
        // The screen shows the recipient that the commitment binds, from the intent.
        run.summary.recipient = Some(to);
    }
    let private = recompute(pins, plan, &tx, device)
        .map_err(|why| refuse(vec![Violation::new(Rule::PlanInvalid, why)]))?;
    if private != tx.private_tx_hash {
        let why = "the private_tx_hash of the data is not the recompute of the plan";
        out.push(Violation::new(Rule::PrivateTxHash, why));
    }
    let commitment = commitment(&private, &tx, &settled).map_err(plain)?;
    let want = body_of(pins, commitment, pay.expiry, pins.payer);
    let body = want.write().map_err(plain)?;
    let (address, bump) = proposal_address(&pins.multisig, &commitment, &body).map_err(plain)?;
    let banned = program_addresses(pins);
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
