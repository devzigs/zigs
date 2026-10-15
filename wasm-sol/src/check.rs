//! `check(message, intent, pins)`: the rule tables of ZOLANA.md section 5 that need no Poseidon
//! and no ciphertext. `check_all` runs every rule and lists every failure in evaluation order.
//! `check` reports the first one, so each refusal names one rule.

use crate::consts::{DERIVE_PREFIX, OFFCHAIN_MAGIC};
use crate::fixed::{parse_deposit, parse_register, Deposit, Register};
use crate::intent::Intent;
use crate::pins::Pins;
use crate::rule::{Rule, Violation};
use crate::template::{expected, limits, LOADED_MAX, TEMPLATE_MASK_NO_FEE, TEMPLATE_MASK_WITH_FEE};
use crate::transact::{self, Transact};
use crate::v1::{self, Message, BIT_LOADED};

/// The values that the P3c rules read, parsed from the message.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Facts {
    pub transact: Option<Transact>,
    /// The position of the `transact` instruction in the message.
    pub transact_at: Option<usize>,
    pub deposit: Option<Deposit>,
    pub register: Option<Register>,
}

/// Every failed rule of one message, in evaluation order, with the parsed facts.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Report {
    pub violations: Vec<Violation>,
    pub facts: Facts,
}

/// A refused message: every failed rule, the first one first.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Refusal {
    pub violations: Vec<Violation>,
}

impl Refusal {
    /// The rule that refuses the message.
    pub fn rule(&self) -> Rule {
        self.violations.first().map_or(Rule::Structure, |v| v.rule)
    }
}

/// The state of one check run.
pub(crate) struct Run<'a> {
    pub msg: &'a Message,
    pub intent: &'a Intent,
    pub pins: &'a Pins,
    /// Unix time on the approving device.
    pub now: u64,
    pub out: Vec<Violation>,
}

impl Run<'_> {
    pub fn fail(&mut self, rule: Rule, detail: impl Into<String>) {
        self.out.push(Violation::new(rule, detail));
    }
}

/// The rules that read raw bytes before any parse.
pub fn prefix_violation(bytes: &[u8]) -> Option<Violation> {
    if bytes.starts_with(&OFFCHAIN_MAGIC) {
        return Some(Violation::new(
            Rule::OffchainPrefix,
            "bytes start with 0xFF solana offchain",
        ));
    }
    if bytes.starts_with(DERIVE_PREFIX) {
        return Some(Violation::new(
            Rule::DerivePayload,
            "bytes start with TSPP/derive/",
        ));
    }
    None
}

/// The rewrite rule: writing the parsed message must give the input bytes.
pub fn verify_rewrite(msg: &Message, bytes: &[u8]) -> Result<(), Violation> {
    let again = v1::write(msg).map_err(|why| Violation::new(Rule::Rewrite, why))?;
    if again != bytes {
        return Err(Violation::new(
            Rule::Rewrite,
            "the rewritten message differs from the input",
        ));
    }
    Ok(())
}

/// The rewrite rule for `transact` data: writing the parsed data must give its bytes.
pub fn verify_transact_rewrite(tx: &Transact, data: &[u8]) -> Result<(), Violation> {
    let again = tx
        .write()
        .map_err(|why| Violation::new(Rule::TransactRewrite, why))?;
    if again != data {
        let detail = "the rewritten transact data differs from the instruction data";
        return Err(Violation::new(Rule::TransactRewrite, detail));
    }
    Ok(())
}

fn parse_message(bytes: &[u8]) -> Result<Message, Violation> {
    let msg = v1::parse(bytes).map_err(|e| Violation::new(e.rule, e.detail))?;
    verify_rewrite(&msg, bytes)?;
    v1::validate(&msg, bytes.len()).map_err(|why| Violation::new(Rule::Structure, why))?;
    Ok(msg)
}

/// Parses `transact` data. A parse error names its rule.
pub(crate) fn parse_transact_data(data: &[u8]) -> Result<Transact, Violation> {
    transact::parse(data).map_err(|error| match error {
        transact::Error::Malformed(why) => Violation::new(Rule::TransactParse, why),
        transact::Error::Circuit(tag) => Violation::new(
            Rule::CircuitNotDefault,
            format!("circuit tag {tag} is not 0"),
        ),
    })
}

impl Run<'_> {
    fn config_rules(&mut self) {
        self.mask_rules();
        self.value_rules();
    }

    /// The mask has the loaded limit bit, and is one of the two template masks.
    fn mask_rules(&mut self) {
        let mask = self.msg.config.mask();
        if mask & BIT_LOADED == 0 {
            self.fail(
                Rule::ConfigLoadedBit,
                "config bit 3 (loaded accounts limit) is clear",
            );
        }
        if mask != TEMPLATE_MASK_NO_FEE && mask != TEMPLATE_MASK_WITH_FEE {
            let detail = format!(
                "mask {mask:#07b}, template {TEMPLATE_MASK_NO_FEE:#07b} or \
                 {TEMPLATE_MASK_WITH_FEE:#07b}"
            );
            self.fail(Rule::ConfigNotTemplate, detail);
        }
    }

    /// The priority fee, the compute units and the loaded limit are inside their ranges.
    fn value_rules(&mut self) {
        let config = &self.msg.config;
        let limit = limits(self.intent);
        if let Some(fee) = config.priority_fee.filter(|fee| *fee > limit.priority_max) {
            self.fail(
                Rule::PriorityFeeOverMax,
                format!("{fee} over {}", limit.priority_max),
            );
        }
        if let Some(units) = config.compute_units.filter(|units| *units > limit.cu_cap) {
            self.fail(
                Rule::ComputeUnitsOverCap,
                format!("{units} over {}", limit.cu_cap),
            );
        }
        if let Some(units) = config.compute_units.filter(|units| *units < limit.cu_floor) {
            self.fail(
                Rule::ComputeUnitsUnderFloor,
                format!("{units} under {}", limit.cu_floor),
            );
        }
        let outside = |size: &u32| *size < limit.loaded_min || *size > LOADED_MAX;
        if let Some(size) = config.loaded_limit.filter(outside) {
            let detail = format!("{size} outside {} to {LOADED_MAX}", limit.loaded_min);
            self.fail(Rule::LoadedLimitRange, detail);
        }
    }

    fn signer_rules(&mut self) {
        if self.msg.keys.first() != Some(&self.pins.group) {
            self.fail(
                Rule::FeePayerNotGroup,
                "the first account is not the group key",
            );
        }
        let signers = self.msg.header[0];
        if signers != 1 {
            let detail =
                format!("{signers} required signatures, the group key must be the only one");
            self.fail(Rule::SignerSet, detail);
        }
    }

    fn lifetime_rule(&mut self) {
        if self.msg.lifetime != self.intent.lifetime() {
            let detail = "the lifetime is not the nonce value or blockhash of the intent";
            self.fail(Rule::Lifetime, detail);
        }
    }

    fn template_rules(&mut self, found: Option<&(usize, Transact)>) {
        if self.intent.is_spend() && found.is_none() {
            return;
        }
        match expected(self.intent, self.pins, found.map(|(_, tx)| tx)) {
            Ok(exp) => {
                self.instruction_rules(&exp, found);
                self.account_rules(&exp);
            }
            Err(why) => {
                self.fail(Rule::InstructionMismatch, why);
                if let Some((pos, tx)) = found {
                    self.transact_rules(*pos, tx);
                }
            }
        }
    }
}

fn facts_of(msg: &Message, found: Option<(usize, Transact)>) -> Facts {
    let last = msg.ixs.last().map(|ix| ix.data.as_slice());
    let (transact_at, transact) = found.unzip();
    Facts {
        transact,
        transact_at,
        deposit: last.and_then(|data| parse_deposit(data).ok()),
        register: last.and_then(|data| parse_register(data).ok()),
    }
}

/// Runs every rule and lists every failure. `now` is the Unix time on the approving device.
pub fn check_all(bytes: &[u8], intent: &Intent, pins: &Pins, now: u64) -> Report {
    let refused = |violation| Report {
        violations: vec![violation],
        facts: Facts::default(),
    };
    if let Some(violation) = prefix_violation(bytes) {
        return refused(violation);
    }
    let msg = match parse_message(bytes) {
        Ok(msg) => msg,
        Err(violation) => return refused(violation),
    };
    let mut run = Run {
        msg: &msg,
        intent,
        pins,
        now,
        out: Vec::new(),
    };
    run.config_rules();
    run.signer_rules();
    run.scan();
    let found = run.find_transact();
    run.template_rules(found.as_ref());
    run.field_rules();
    run.lifetime_rule();
    let facts = facts_of(&msg, found);
    Report {
        violations: run.out,
        facts,
    }
}

/// The structure rules only (P3a): the instruction list, the limits, the signers, the lifetime,
/// the expiry and the shape of `transact`. `Ok` is not an approval. A spend needs `approve`,
/// which adds the Outputs, Legs and Ciphertexts rules and the device snapshot.
pub fn check(bytes: &[u8], intent: &Intent, pins: &Pins, now: u64) -> Result<Facts, Refusal> {
    let report = check_all(bytes, intent, pins, now);
    if report.violations.is_empty() {
        Ok(report.facts)
    } else {
        Err(Refusal {
            violations: report.violations,
        })
    }
}
