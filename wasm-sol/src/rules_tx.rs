//! The `transact` rules that read only the instruction data and the account list: expiry,
//! circuit, legs and counts, trees, and the owner tag of each output.
//!
//! The rules that need Poseidon, the device snapshot or the ciphertext key schedule (the hash of
//! each output, conservation, the ciphertext recompute) are in `spend.rs` and `rules_out.rs`,
//! `rules_legs.rs` and `rules_ct.rs`, and run through `approve`.

use std::collections::BTreeSet;

use crate::bytes::short_hex;
use crate::check::{verify_transact_rewrite, Run};
use crate::consts::{is_supported_shape, Key, PUBLIC_SLOTS};
use crate::intent::{Intent, Spend};
use crate::rule::Rule;
use crate::template::{expected_legs, EXPIRY_SKEW_SECS, EXPIRY_WINDOW_SECS};
use crate::transact::{OwnerTag, Transact};
use crate::v1::Ix;

impl Run<'_> {
    fn spend(&self) -> Option<&Spend> {
        match self.intent {
            Intent::Transfer { spend, .. } | Intent::Withdrawal { spend, .. } => Some(spend),
            _ => None,
        }
    }

    /// The tags that an output of this intent may name: the group, and the payee of a Transfer.
    fn allowed_tags(&self) -> Vec<Key> {
        std::iter::once(self.pins.group)
            .chain(self.intent.payee_tag())
            .collect()
    }

    pub fn transact_rules(&mut self, pos: usize, tx: &Transact) {
        let msg = self.msg;
        let Some(ix) = msg.ixs.get(pos) else { return };
        self.rewrite_rule(ix, tx);
        self.expiry_rules(tx);
        self.shape_rules(tx);
        self.owner_tag_rules(ix, tx);
    }

    fn rewrite_rule(&mut self, ix: &Ix, tx: &Transact) {
        if let Err(violation) = verify_transact_rewrite(tx, &ix.data) {
            self.out.push(violation);
        }
    }

    fn expiry_rules(&mut self, tx: &Transact) {
        let want = self.spend().map(|spend| spend.expiry);
        if tx.expiry == 0 {
            self.fail(Rule::ExpiryZero, "expiry_unix_ts is 0");
        } else if tx.expiry == u64::MAX {
            self.fail(Rule::ExpiryMax, "expiry_unix_ts is u64::MAX (no expiry)");
        } else if Some(tx.expiry) != want {
            self.fail(
                Rule::ExpiryNotIntent,
                format!("expiry {}, intent {want:?}", tx.expiry),
            );
        } else if !self.in_expiry_window(tx.expiry) {
            let detail = format!("expiry {} with the clock at {}", tx.expiry, self.now);
            self.fail(Rule::ExpiryWindow, detail);
        }
    }

    /// The expiry is after the clock and at most the window plus the skew ahead of it.
    fn in_expiry_window(&self, expiry: u64) -> bool {
        let latest = self
            .now
            .saturating_add(EXPIRY_WINDOW_SECS + EXPIRY_SKEW_SECS);
        self.now < expiry && expiry <= latest
    }

    fn shape_rules(&mut self, tx: &Transact) {
        if tx.circuit.slots != PUBLIC_SLOTS {
            self.fail(
                Rule::CircuitNotDefault,
                format!("{} public slots", tx.circuit.slots),
            );
        }
        if tx.data_hash.is_some() || tx.ring_data_hash.is_some() {
            self.fail(Rule::DataHashPresent, "data_hash or ring_data_hash is set");
        }
        if !tx.messages.is_empty() {
            self.fail(
                Rule::MessagesPresent,
                format!("{} loose messages", tx.messages.len()),
            );
        }
        if tx.legs != expected_legs(self.intent) {
            self.fail(Rule::LegMismatch, format!("legs {:?}", tx.legs));
        }
        self.count_rules(tx);
        self.circuit_rules(tx);
    }

    /// The circuit counts equal the counts of the instruction, and no nullifier repeats. The
    /// program accepts a circuit that is larger than the real counts, and a padded circuit is
    /// valid, but the template never pads: ponytail: compact and random padding are refused until
    /// a wallet needs them and the snapshot can name the padding inputs.
    fn circuit_rules(&mut self, tx: &Transact) {
        let (inputs, outputs) = (
            usize::from(tx.circuit.inputs),
            usize::from(tx.circuit.outputs),
        );
        if inputs != tx.inputs.len() || outputs != tx.outputs.len() {
            let detail = format!(
                "circuit {inputs} in {outputs} out, instruction {} in {} out",
                tx.inputs.len(),
                tx.outputs.len()
            );
            self.fail(Rule::CircuitCounts, detail);
        }
        if !is_supported_shape(inputs, outputs) {
            let detail = format!("the circuit shape ({inputs}, {outputs}) has no proving key");
            self.fail(Rule::UnsupportedShape, detail);
        }
        let mut seen = BTreeSet::new();
        if !tx.inputs.iter().all(|input| seen.insert(input.nullifier)) {
            self.fail(
                Rule::DuplicateNullifier,
                "the same nullifier is spent twice",
            );
        }
    }

    fn count_rules(&mut self, tx: &Transact) {
        let Some(spend) = self.spend().copied() else {
            return;
        };
        if tx.inputs.len() != usize::from(spend.inputs) {
            let detail = format!("{} inputs, intent {}", tx.inputs.len(), spend.inputs);
            self.fail(Rule::InputCount, detail);
        }
        if tx.outputs.len() != usize::from(spend.outputs) {
            let detail = format!("{} outputs, intent {}", tx.outputs.len(), spend.outputs);
            self.fail(Rule::OutputCount, detail);
        }
        if tx.tree_contexts.len() != 1 || tx.inputs.iter().any(|input| input.tree_index != 0) {
            self.fail(
                Rule::TreeContext,
                "not one tree context with every input on tree 0",
            );
        }
    }

    fn owner_tag_rules(&mut self, ix: &Ix, tx: &Transact) {
        let msg = self.msg;
        let allowed = self.allowed_tags();
        for (slot, output) in tx.outputs.iter().enumerate() {
            let tag = match output.owner_tag {
                OwnerTag::Inline(tag) => Some(tag),
                OwnerTag::Account(at) => msg.account_key(ix, usize::from(at)).copied(),
            };
            if !tag.is_some_and(|tag| allowed.contains(&tag)) {
                let shown = tag.map_or("none".to_string(), |tag| short_hex(&tag));
                self.fail(Rule::OutputOwnerTag, format!("output {slot} names {shown}"));
            }
        }
    }
}
