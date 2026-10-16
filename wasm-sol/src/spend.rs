//! The P3c rules of a spend (Transfer and Withdrawal): Outputs, Legs and Ciphertexts of ZOLANA.md
//! section 5. They bind the `transact` data of the message to the approved plaintext (`Plan`)
//! and to the device snapshot. `rules_out`, `rules_legs` and `rules_ct` hold one rule group
//! each; this file holds the context, the plan checks and the group key of the wallet.

use crate::address::Address;
use crate::assets::AssetTable;
use crate::check::Facts;
use crate::consts::Key;
use crate::intent::Intent;
use crate::pins::Pins;
use crate::plan::{OutPlan, Plan, Role};
use crate::rule::{Rule, Violation};
use crate::snapshot::Snapshot;
use crate::transact::Transact;
use crate::v1::{Ix, Message};

/// An amount of one asset.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Amount {
    pub mint: Key,
    pub amount: u64,
}

/// The payee as the checker bound it: the three values that the payee output commits to. The
/// approval screen shows its fingerprint, so the approvers confirm what the message pays.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Fingerprint {
    pub tag: Key,
    pub owner_hash: Key,
    pub viewing_pk: [u8; 33],
}

/// What the approval screen shows, after every rule holds (ZOLANA.md 5, step 3).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Summary {
    /// The payee of a Transfer.
    pub payee: Option<Fingerprint>,
    /// The outputs that go to the payee.
    pub paid: Vec<Amount>,
    /// The change that stays with the group.
    pub change: Vec<Amount>,
    /// The SOL that the withdrawal leg moves to the public recipient.
    pub withdrawn: u64,
    /// The insertion fee in lamports that the tree takes from the public SOL of the payer.
    pub tree_fee: u64,
    /// The public recipient of a Withdrawal, as the account list of the message names it.
    pub recipient: Option<Key>,
    /// The `expiry_unix_ts` that the message carries.
    pub expiry: Option<u64>,
}

/// The identity of the wallet, from the pins: the three values that a Solana output commits to.
/// The secrets of the device are checked against the pins (`approve`), never the other way.
pub struct Group {
    pub key: Key,
    pub owner_hash: Key,
    pub viewing_pk: [u8; 33],
}

impl Group {
    /// The group of the pins. `pins.group_owner_hash` must be the recomputed value (`approve`).
    pub fn of(pins: &Pins) -> Self {
        Self {
            key: pins.group,
            owner_hash: pins.group_owner_hash,
            viewing_pk: pins.viewing_pk,
        }
    }
}

/// The values that the P3c rules of one spend read.
pub struct SpendInput<'a> {
    pub msg: &'a Message,
    /// The facts of the P3a check: the parsed `transact` data and its position.
    pub facts: &'a Facts,
    pub intent: &'a Intent,
    pub plan: &'a Plan,
    pub snapshot: &'a Snapshot,
    pub group: &'a Group,
    pub assets: &'a AssetTable,
}

/// The state of one P3c run.
pub(crate) struct Spend<'a> {
    pub msg: &'a Message,
    pub ix: &'a Ix,
    pub tx: &'a Transact,
    pub intent: &'a Intent,
    pub plan: &'a Plan,
    pub snap: &'a Snapshot,
    pub group: &'a Group,
    pub assets: &'a AssetTable,
    /// The nullifiers that the snapshot computes for its inputs. `input_rules` fills it.
    pub snap_nullifiers: Vec<Key>,
    pub out: Vec<Violation>,
    pub summary: Summary,
}

impl<'a> Spend<'a> {
    pub fn new(input: &SpendInput<'a>) -> Option<Self> {
        let at = input.facts.transact_at?;
        Some(Self {
            msg: input.msg,
            ix: input.msg.ixs.get(at)?,
            tx: input.facts.transact.as_ref()?,
            intent: input.intent,
            plan: input.plan,
            snap: input.snapshot,
            group: input.group,
            assets: input.assets,
            snap_nullifiers: Vec::new(),
            out: Vec::new(),
            summary: Summary::default(),
        })
    }

    pub fn fail(&mut self, rule: Rule, detail: impl Into<String>) {
        self.out.push(Violation::new(rule, detail));
    }

    /// The payee address of the intent (Transfer only).
    pub fn payee_address(&self) -> Option<&Address> {
        match self.intent {
            Intent::Transfer { payee, .. } => Some(payee),
            _ => None,
        }
    }

    /// The owner tag that a real slot of this role names. A dummy has none: it names a
    /// participant, so the caller tests it against `participants`.
    pub fn role_tag(&self, role: Role) -> Option<Key> {
        match role {
            Role::Change => Some(self.group.key),
            Role::Payee => self.payee_address().and_then(Address::tag),
            Role::Dummy => None,
        }
    }

    /// The tags that a dummy slot may name. `AssertDummyTags` (owner_tags.go:101-152) takes the
    /// owner signers without the payer, and the owner of every real output. The fee key is the
    /// payer and the group key is the owner signer, so the group is always a participant, and
    /// so is the payee if a real slot pays it.
    pub fn participants(&self) -> Vec<Key> {
        let roles = self.plan.outputs.iter().map(|slot| slot.role);
        let owners = roles.filter_map(|role| self.role_tag(role));
        std::iter::once(self.group.key).chain(owners).collect()
    }

    /// The first nullifier of the snapshot, the root of every blinding and of the transaction
    /// key. A spend with no input has none, and each rule that needs it then fails.
    pub fn first_nullifier(&self) -> Option<Key> {
        self.snap_nullifiers.first().copied()
    }

    /// The payee address of the intent can be named by a tag, the plan has one entry per output,
    /// one payee output of the asset and amount of the intent, and only empty dummies. Returns
    /// false if the slots do not line up, because every slot rule after this one reads the plan
    /// by position.
    pub fn plan_rules(&mut self) -> bool {
        self.payee_rule();
        self.dummy_rule();
        self.dummy_order_rule();
        self.payee_output_rule();
        if self.plan.outputs.len() != self.tx.outputs.len() {
            let detail = format!(
                "{} plan entries, {} outputs",
                self.plan.outputs.len(),
                self.tx.outputs.len()
            );
            self.fail(Rule::PlanOutputCount, detail);
            return false;
        }
        true
    }

    /// The payee address of a Transfer has a signing key that an output tag can name.
    fn payee_rule(&mut self) {
        if self
            .payee_address()
            .is_some_and(|address| address.tag().is_none())
        {
            self.fail(
                Rule::PayeeAddress,
                "the payee signing key is not an Ed25519 key or a PDA",
            );
        }
    }

    fn dummy_rule(&mut self) {
        let bad = |o: &&OutPlan| o.role == Role::Dummy && (o.amount != 0 || o.mint != [0; 32]);
        if let Some(at) = self.plan.outputs.iter().position(|o| bad(&o)) {
            self.fail(
                Rule::DummyNotEmpty,
                format!("output {at} is a dummy with an asset or an amount"),
            );
        }
    }

    /// Once a slot is a dummy, every later slot is a dummy: `AssertDummiesLast` (slot_order.go)
    /// has no proof otherwise, and the fee and the nonce would burn. The role of a slot is its
    /// domain, because `output-hash` ties the hash of each slot to its role.
    fn dummy_order_rule(&mut self) {
        let mut seen_dummy = false;
        let late = self.plan.outputs.iter().position(|o| {
            let is_dummy = o.role == Role::Dummy;
            let late = seen_dummy && !is_dummy;
            seen_dummy |= is_dummy;
            late
        });
        if let Some(at) = late {
            let why = format!("output {at} is a real output after a dummy");
            self.fail(Rule::DummiesLast, why);
        }
    }

    /// A Transfer has one payee output of the asset and the amount of the intent, a Withdrawal
    /// has none.
    fn payee_output_rule(&mut self) {
        let paid: Vec<&OutPlan> = self
            .plan
            .outputs
            .iter()
            .filter(|o| o.role == Role::Payee)
            .collect();
        let good = match (self.intent, paid.as_slice()) {
            (Intent::Transfer { mint, amount, .. }, [one]) => {
                one.mint == *mint && one.amount == *amount
            }
            (Intent::Withdrawal { .. }, []) => true,
            _ => false,
        };
        if !good {
            self.fail(
                Rule::PayeeOutputs,
                format!("{} payee outputs for the intent", paid.len()),
            );
        }
    }

    /// All P3c rules, in the order of the rule table. A plan whose slots do not line up with
    /// the outputs of the message cannot be read by position, so the rules that need it wait.
    pub fn run(mut self) -> (Vec<Violation>, Summary) {
        let aligned = self.plan_rules();
        if aligned {
            self.output_rules();
        }
        self.input_rules();
        if aligned {
            self.blinding_rules();
            self.balance_rules();
        }
        self.fee_rule();
        if aligned {
            self.cipher_rules();
        }
        self.echo();
        (self.out, self.summary)
    }

    /// What the message commits to and the approval screen must show: the expiry, and the
    /// recipient of a Withdrawal. The recipient is the last account of the `transact`
    /// instruction (the template compares it with the intent).
    fn echo(&mut self) {
        self.summary.expiry = Some(self.tx.expiry);
        if matches!(self.intent, Intent::Withdrawal { .. }) {
            let last = self.ix.accounts.len().checked_sub(1);
            let key = last.and_then(|at| self.msg.account_key(self.ix, at));
            self.summary.recipient = key.copied();
        }
    }
}

/// The P3c rules of a spend. A spend whose `transact` data the P3a rules could not read has no
/// rule to run, and that is a refusal, not a pass.
pub fn spend_violations(input: &SpendInput) -> (Vec<Violation>, Summary) {
    match Spend::new(input) {
        Some(spend) => spend.run(),
        None => {
            let why = "the transact data of the spend was not read, so no P3c rule ran";
            (
                vec![Violation::new(Rule::SpendUnread, why)],
                Summary::default(),
            )
        }
    }
}
