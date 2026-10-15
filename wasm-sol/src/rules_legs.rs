//! The Legs rule of section 5: the inputs of the device snapshot plus the deposit legs equal the
//! outputs plus the withdrawal legs, and the nullifiers of the message equal the nullifiers that
//! the snapshot computes. Also the fee schedule of the tree.
//!
//! The circuit has no fee term: inputs plus public amounts equal outputs exactly (ZOLANA.md 6.4).
//! The insertion fee of the tree comes out of the public SOL of the payer, not out of the
//! shielded balance, so `fee_rule` caps it and reports it instead of changing the balance.

use std::collections::{BTreeMap, BTreeSet};

use crate::consts::Key;
use crate::hashes::{Utxo, TREE_ID};
use crate::plan::Role;
use crate::rule::Rule;
use crate::spend::{Amount, Spend};
use crate::template::TREE_FEE_CAP;
use crate::transact::Leg;

const SOL: Key = [0; 32];

type Net = BTreeMap<Key, i128>;

fn add(net: &mut Net, mint: Key, amount: i128) {
    *net.entry(mint).or_default() += amount;
}

impl Spend<'_> {
    /// The nullifier that the snapshot computes for each input, in order.
    fn snapshot_nullifiers(&self) -> Result<Vec<Key>, String> {
        let owner_hash = self.group.owner_hash;
        self.snap
            .inputs
            .iter()
            .map(|input| {
                Utxo {
                    owner_hash,
                    mint: input.mint,
                    amount: input.amount,
                    blinding: input.blinding,
                }
                .nullifier(TREE_ID, &self.snap.nullifier_secret)
            })
            .collect()
    }

    /// The message spends the inputs of the snapshot, in order, each once.
    pub fn input_rules(&mut self) {
        let nullifiers = match self.snapshot_nullifiers() {
            Ok(nullifiers) => nullifiers,
            Err(why) => return self.fail(Rule::PlanInvalid, format!("snapshot input: {why}")),
        };
        let mut seen = BTreeSet::new();
        if !nullifiers.iter().all(|nullifier| seen.insert(*nullifier)) {
            self.fail(
                Rule::SnapshotDuplicate,
                "two snapshot inputs share a nullifier",
            );
        }
        let tx = self.tx;
        if nullifiers.len() != tx.inputs.len() {
            let detail = format!(
                "{} snapshot inputs, {} in the message",
                nullifiers.len(),
                tx.inputs.len()
            );
            self.fail(Rule::SnapshotInputs, detail);
        }
        for (index, (want, have)) in nullifiers.iter().zip(&tx.inputs).enumerate() {
            if *want != have.nullifier {
                self.fail(Rule::NullifierMismatch, format!("input {index}"));
            }
        }
        self.snap_nullifiers = nullifiers;
    }

    /// Adds the public legs to the balance: a deposit brings SOL in, a withdrawal takes it out.
    fn leg_net(&mut self, net: &mut Net) {
        let tx = self.tx;
        for leg in &tx.legs {
            match *leg {
                Leg::SolDeposit(amount) => add(net, SOL, i128::from(amount)),
                Leg::SolWithdrawal(amount) => {
                    add(net, SOL, -i128::from(amount));
                    self.summary.withdrawn = self.summary.withdrawn.saturating_add(amount);
                }
                Leg::Spl { .. } => self.fail(Rule::LegAsset, "an SPL leg does not name its mint"),
            }
        }
    }

    /// Per asset: inputs plus deposit legs minus outputs minus withdrawal legs is 0.
    pub fn balance_rules(&mut self) {
        let mut net = Net::new();
        for input in &self.snap.inputs {
            add(&mut net, input.mint, i128::from(input.amount));
        }
        let plan = self.plan;
        for slot in &plan.outputs {
            add(&mut net, slot.mint, -i128::from(slot.amount));
            let amount = Amount {
                mint: slot.mint,
                amount: slot.amount,
            };
            match slot.role {
                Role::Payee => self.summary.paid.push(amount),
                Role::Change => self.summary.change.push(amount),
                Role::Dummy => {}
            }
        }
        self.leg_net(&mut net);
        for (mint, left) in net.into_iter().filter(|(_, left)| *left != 0) {
            let detail = format!(
                "asset {} is off by {left} (inputs plus legs minus outputs)",
                crate::bytes::short_hex(&mint)
            );
            self.fail(Rule::Conservation, detail);
        }
    }

    /// The insertion fee per nullifier of the tree is at most the cap.
    pub fn fee_rule(&mut self) {
        let fee = self.snap.fee_per_nullifier;
        if fee > TREE_FEE_CAP {
            self.fail(
                Rule::TreeFeeOverCap,
                format!("{fee} lamports over {TREE_FEE_CAP}"),
            );
        }
        let inputs = u64::try_from(self.tx.inputs.len()).unwrap_or(u64::MAX);
        self.summary.tree_fee = fee.saturating_mul(inputs);
    }
}
