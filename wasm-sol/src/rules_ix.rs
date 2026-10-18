//! The Instructions rule of section 5: the refusal list, the allow lists, and the comparison of
//! the instruction list and the account table with the template. Also the field rules of the
//! `register` and `deposit` data (section 4.2 and the Shield intent).

use crate::bytes::short_hex;
use crate::check::{parse_transact_data, Run};
use crate::consts::{
    COMPUTE_BUDGET_PROGRAM, ED25519_PROGRAM, MS_CANCEL, MS_CLOSE_CANCELLED, MS_CREATE, MS_EXECUTE,
    REG_REGISTER, REG_SET_MERGING_ENABLED, REG_UPDATE_KEYS, SYSTEM_PROGRAM, SYS_ADVANCE_NONCE,
    SYS_AUTHORIZE_NONCE, SYS_CREATE_ACCOUNT, SYS_CREATE_WITH_SEED, SYS_INIT_NONCE, SYS_TRANSFER,
    SYS_TRANSFER_WITH_SEED, SYS_WITHDRAW_NONCE, TAG_DEPOSIT, TAG_MERGE_TRANSACT, TAG_TRANSACT,
};
use crate::fixed::{parse_deposit, parse_register, AssetKind, Deposit, Register};
use crate::intent::{Intent, Program};
use crate::pins::Pins;
use crate::rule::Rule;
use crate::template::{Data, Expected, ExpectedIx};
use crate::transact::Transact;
use crate::v1::Ix;

type Verdict = Option<(Rule, &'static str)>;
pub(crate) type Fault = Option<(Rule, String)>;

/// System instructions: `None` means allowed, `Some(rule)` names the refusal.
const SYSTEM_TAGS: &[(u32, Option<Rule>)] = &[
    (SYS_TRANSFER, Some(Rule::SystemTransfer)),
    (SYS_CREATE_WITH_SEED, None),
    (SYS_ADVANCE_NONCE, None),
    (SYS_WITHDRAW_NONCE, Some(Rule::WithdrawNonceAccount)),
    (SYS_INIT_NONCE, None),
    (SYS_AUTHORIZE_NONCE, Some(Rule::AuthorizeNonceAccount)),
];

/// The System instructions that take lamports from their first account.
const FUNDING_TAGS: [u32; 4] = [
    SYS_CREATE_ACCOUNT,
    SYS_TRANSFER,
    SYS_CREATE_WITH_SEED,
    SYS_TRANSFER_WITH_SEED,
];

const NOT_ALLOWED: &str = "the instruction tag is not on the allow list";

fn system_tag(data: &[u8]) -> Option<u32> {
    Some(u32::from_le_bytes(data.get(..4)?.try_into().ok()?))
}

fn system_verdict(data: &[u8]) -> Verdict {
    let tag = system_tag(data)?;
    match SYSTEM_TAGS.iter().find(|(known, _)| *known == tag) {
        Some((_, None)) => None,
        Some((_, Some(rule))) => Some((*rule, "refused System instruction")),
        None => Some((Rule::InstructionNotAllowed, NOT_ALLOWED)),
    }
}

fn pool_verdict(data: &[u8], in_shield: bool) -> Verdict {
    match data.first() {
        Some(&TAG_TRANSACT) => None,
        Some(&TAG_DEPOSIT) if in_shield => None,
        Some(&TAG_DEPOSIT) => Some((Rule::DepositOutsideShield, "pool deposit outside Shield")),
        Some(&TAG_MERGE_TRANSACT) => Some((Rule::MergeTransact, "pool merge_transact")),
        _ => Some((Rule::InstructionNotAllowed, NOT_ALLOWED)),
    }
}

fn registry_verdict(data: &[u8]) -> Verdict {
    match data.first() {
        Some(&REG_REGISTER) => None,
        Some(&REG_UPDATE_KEYS) => Some((Rule::UpdateKeys, "registry update_keys")),
        Some(&REG_SET_MERGING_ENABLED) => {
            Some((Rule::SetMergingEnabled, "registry set_merging_enabled"))
        }
        _ => Some((Rule::InstructionNotAllowed, NOT_ALLOWED)),
    }
}

/// The approvals program: `create` only in Propose, `execute` only in Execute, `cancel` only in
/// Cancel and `close_cancelled` only in CloseCancelled.
fn program_verdict(data: &[u8], intent: &Intent) -> Verdict {
    let allowed = match intent {
        Intent::Program(Program::Propose { .. }) => MS_CREATE,
        Intent::Program(Program::Execute { .. }) => MS_EXECUTE,
        Intent::Program(Program::Cancel { .. }) => MS_CANCEL,
        Intent::Program(Program::CloseCancelled { .. }) => MS_CLOSE_CANCELLED,
        _ => {
            return Some((
                Rule::ProgramNotAllowed,
                "the approvals program outside its intents",
            ))
        }
    };
    (data.first() != Some(&allowed)).then_some((Rule::InstructionNotAllowed, NOT_ALLOWED))
}

/// The first check that fails, in the order given.
fn first_fault<const N: usize>(checks: [(bool, Rule, String); N]) -> Fault {
    checks
        .into_iter()
        .find(|(bad, _, _)| *bad)
        .map(|(_, rule, why)| (rule, why))
}

/// The faults of a `register` instruction against the keys of one source: `source` names whose
/// keys they are (the intent, the pins or the device secrets) in the detail.
pub(crate) fn register_fault(
    r: &Register,
    nullifier_pk: &[u8; 32],
    viewing_pk: &[u8; 33],
    source: &str,
) -> Fault {
    first_fault([
        (
            r.owner_p256.is_some(),
            Rule::RegisterOwnerP256,
            "owner_p256 is not None".to_string(),
        ),
        (
            r.nullifier_pk != *nullifier_pk,
            Rule::RegisterNullifierPk,
            format!(
                "nullifier_pk {} is not {source}",
                short_hex(&r.nullifier_pk)
            ),
        ),
        (
            r.viewing_pk != *viewing_pk,
            Rule::RegisterViewingPk,
            format!("viewing_pk {} is not {source}", short_hex(&r.viewing_pk)),
        ),
    ])
}

fn shield_fault(deposit: &Deposit, pins: &Pins, amount: u64) -> Fault {
    let ([AssetKind::Sol], [entry]) = (deposit.assets.as_slice(), deposit.entries.as_slice())
    else {
        return Some((
            Rule::ShieldShape,
            "not one SOL asset with one entry".to_string(),
        ));
    };
    first_fault([
        (
            entry.asset_index != 0 || entry.memo.is_some(),
            Rule::ShieldShape,
            "asset index is not 0, or the entry has a memo".to_string(),
        ),
        (
            entry.owner != pins.group_owner_hash,
            Rule::ShieldOwner,
            format!("owner {}", short_hex(&entry.owner)),
        ),
        (
            entry.view_tag != pins.group,
            Rule::ShieldViewTag,
            format!("view tag {}", short_hex(&entry.view_tag)),
        ),
        (
            entry.amount != amount,
            Rule::ShieldAmount,
            format!("amount {}, intent {amount}", entry.amount),
        ),
    ])
}

impl Run<'_> {
    fn verdict(&self, ix: &Ix) -> Verdict {
        let program = self.msg.program_key(ix)?;
        if *program == COMPUTE_BUDGET_PROGRAM {
            return Some((Rule::ComputeBudget, "ComputeBudget instruction"));
        }
        if *program == SYSTEM_PROGRAM {
            return system_verdict(&ix.data);
        }
        if *program == self.pins.pool {
            return pool_verdict(&ix.data, matches!(self.intent, Intent::Shield { .. }));
        }
        if *program == self.pins.registry {
            return registry_verdict(&ix.data);
        }
        if *program == self.pins.program {
            return program_verdict(&ix.data, self.intent);
        }
        if *program == ED25519_PROGRAM
            && matches!(self.intent, Intent::Program(Program::Execute { .. }))
        {
            return None;
        }
        Some((
            Rule::ProgramNotAllowed,
            "the program is not the System program, pool, registry or approvals program",
        ))
    }

    /// True if a System instruction takes its lamports from the group key: the funder (account
    /// 0) of a transfer or of an account creation. The group key only signs.
    fn debits_group(&self, ix: &Ix) -> bool {
        let funds = system_tag(&ix.data).is_some_and(|tag| FUNDING_TAGS.contains(&tag));
        self.msg.program_key(ix) == Some(&SYSTEM_PROGRAM)
            && funds
            && self.msg.account_key(ix, 0) == Some(&self.pins.group)
    }

    /// The refusal list and the allow lists, applied to every instruction.
    pub fn scan(&mut self) {
        let msg = self.msg;
        for (pos, ix) in msg.ixs.iter().enumerate() {
            if let Some((rule, why)) = self.verdict(ix) {
                self.fail(rule, format!("instruction {pos}: {why}"));
            }
            if self.debits_group(ix) {
                let why = "the funder is the group key";
                self.fail(Rule::GroupDebit, format!("instruction {pos}: {why}"));
            }
        }
    }

    /// The `transact` data of an Execute: inside the first `execute` of the approvals program.
    fn find_execute(&mut self) -> Option<(usize, Transact)> {
        let msg = self.msg;
        let is_execute = |ix: &Ix| {
            msg.program_key(ix) == Some(&self.pins.program) && ix.data.first() == Some(&MS_EXECUTE)
        };
        let Some((pos, ix)) = msg.ixs.iter().enumerate().find(|(_, ix)| is_execute(ix)) else {
            self.fail(
                Rule::InstructionMismatch,
                "the message has no execute instruction",
            );
            return None;
        };
        let data = [&[TAG_TRANSACT][..], ix.data.get(1..).unwrap_or_default()].concat();
        match parse_transact_data(&data) {
            Ok(tx) => Some((pos, tx)),
            Err(violation) => {
                self.out.push(violation);
                None
            }
        }
    }

    /// The `transact` instruction of a spend: the first pool instruction with tag 16.
    pub fn find_transact(&mut self) -> Option<(usize, Transact)> {
        if matches!(self.intent, Intent::Program(Program::Execute { .. })) {
            return self.find_execute();
        }
        if !self.intent.is_spend() {
            return None;
        }
        let msg = self.msg;
        let is_transact = |ix: &Ix| {
            msg.program_key(ix) == Some(&self.pins.pool) && ix.data.first() == Some(&TAG_TRANSACT)
        };
        let Some((pos, ix)) = msg.ixs.iter().enumerate().find(|(_, ix)| is_transact(ix)) else {
            self.fail(
                Rule::InstructionMismatch,
                "the message has no pool transact instruction",
            );
            return None;
        };
        match parse_transact_data(&ix.data) {
            Ok(tx) => Some((pos, tx)),
            Err(violation) => {
                self.out.push(violation);
                None
            }
        }
    }

    /// The instruction count, then program, accounts and fixed data of each position, then the
    /// `transact` rules.
    pub fn instruction_rules(&mut self, exp: &Expected, found: Option<&(usize, Transact)>) {
        let msg = self.msg;
        let (have, want) = (msg.ixs.len(), exp.ixs.len());
        if have != want {
            self.fail(
                Rule::InstructionCount,
                format!("{have} instructions, template has {want}"),
            );
        }
        for (pos, (ix, template)) in msg.ixs.iter().zip(&exp.ixs).enumerate() {
            self.compare_ix(pos, ix, template);
        }
        if let Some((pos, tx)) = found.filter(|_| self.intent.is_spend()) {
            self.transact_rules(*pos, tx);
        }
    }

    fn compare_ix(&mut self, pos: usize, ix: &Ix, want: &ExpectedIx) {
        if self.msg.program_key(ix) != Some(&want.program) {
            self.fail(
                Rule::InstructionMismatch,
                format!("instruction {pos}: wrong program"),
            );
            return;
        }
        self.compare_accounts(pos, ix, want);
        let differs = match &want.data {
            Data::Exact(bytes) => *bytes != ix.data,
            Data::Fields(bytes) => bytes.first() != ix.data.first(),
            Data::Variable => ix.data.first() != Some(&TAG_TRANSACT),
            Data::Execute => ix.data.first() != Some(&MS_EXECUTE),
        };
        if differs {
            self.fail(
                Rule::InstructionData,
                format!("instruction {pos}: data differs"),
            );
        }
    }

    fn compare_accounts(&mut self, pos: usize, ix: &Ix, want: &ExpectedIx) {
        let (msg, pins) = (self.msg, self.pins);
        if ix.accounts.len() != want.accounts.len() {
            let (have, need) = (ix.accounts.len(), want.accounts.len());
            self.fail(
                Rule::AccountCount,
                format!("instruction {pos}: {have} accounts, need {need}"),
            );
            return;
        }
        for (at, expect) in want.accounts.iter().enumerate() {
            let have = msg.account_key(ix, at);
            if have != Some(&expect.key) {
                let got = have.map_or("none".to_string(), |key| pins.label(key));
                let need = pins.label(&expect.key);
                let detail = format!("instruction {pos} account {at}: {got}, template {need}");
                self.fail(Rule::AccountAddress, detail);
            }
        }
    }

    /// The account table holds exactly the template accounts with the template flags.
    pub fn account_rules(&mut self, exp: &Expected) {
        let (msg, pins) = (self.msg, self.pins);
        let want = exp.key_flags(&pins.payer);
        for (index, key) in msg.keys.iter().enumerate() {
            let have = (msg.is_signer(index), msg.is_writable(index));
            match want.get(key) {
                None => self.fail(
                    Rule::AccountSet,
                    format!("unexpected account {}", pins.label(key)),
                ),
                Some(flags) if *flags != have => {
                    let name = pins.label(key);
                    let detail = format!("{name}: signer/writable {have:?}, template {flags:?}");
                    self.fail(Rule::AccountFlags, detail);
                }
                Some(_) => {}
            }
        }
        for key in want.keys().filter(|key| !msg.keys.contains(key)) {
            self.fail(
                Rule::AccountSet,
                format!("missing account {}", pins.label(key)),
            );
        }
    }

    /// The field rules of the `register` and `deposit` data, wherever the instruction sits.
    pub fn field_rules(&mut self) {
        let msg = self.msg;
        for (pos, ix) in msg.ixs.iter().enumerate() {
            let program = msg.program_key(ix);
            let tag = ix.data.first();
            let fault = match self.intent {
                Intent::Register { .. } if program == Some(&self.pins.registry) => {
                    self.register_fault(tag, &ix.data)
                }
                Intent::Shield { .. } if program == Some(&self.pins.pool) => {
                    self.shield_fault(tag, &ix.data)
                }
                _ => None,
            };
            if let Some((rule, why)) = fault {
                self.fail(rule, format!("instruction {pos}: {why}"));
            }
        }
    }

    fn register_fault(&self, tag: Option<&u8>, data: &[u8]) -> Fault {
        let Intent::Register {
            nullifier_pk,
            viewing_pk,
            ..
        } = self.intent
        else {
            return None;
        };
        if tag != Some(&REG_REGISTER) {
            return None;
        }
        let pins = self.pins;
        match parse_register(data) {
            Ok(r) => register_fault(&r, nullifier_pk, viewing_pk, "the intent").or_else(|| {
                register_fault(&r, &pins.nullifier_pk, &pins.viewing_pk, "the pinned key")
            }),
            Err(why) => Some((Rule::RegisterLength, why.to_string())),
        }
    }

    fn shield_fault(&self, tag: Option<&u8>, data: &[u8]) -> Fault {
        let Intent::Shield { amount, .. } = self.intent else {
            return None;
        };
        if tag != Some(&TAG_DEPOSIT) {
            return None;
        }
        match parse_deposit(data) {
            Ok(d) => shield_fault(&d, self.pins, *amount),
            Err(why) => Some((Rule::ShieldShape, why.to_string())),
        }
    }
}
