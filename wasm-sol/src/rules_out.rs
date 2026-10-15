//! The Outputs rule of section 5: each `utxo_hash` equals Poseidon over the approved plaintext
//! of its slot. A slot is the payee, change to the group `owner_hash`, or a true dummy
//! (`DummyDomain`, owner 0, amount 0). The owner hashes come from the group secrets and the
//! payee address, never from the message.

use crate::consts::Key;
use crate::hashes::{dummy_hash, output_blinding, output_seed, owner_hash, Utxo, TREE_ID};
use crate::plan::{OutPlan, Role};
use crate::rule::Rule;
use crate::spend::{Fingerprint, Spend};

impl Spend<'_> {
    /// `owner_hash` of the payee address.
    fn payee_owner(&self) -> Result<Key, String> {
        let address = self
            .payee_address()
            .ok_or("the slot names a payee, the plan has none")?;
        let tag = address
            .tag()
            .ok_or("the payee signing key is not an Ed25519 key or a PDA")?;
        owner_hash(&tag, &address.nullifier_pk)
    }

    /// The owner hash of a slot: the group, the payee, or none for a dummy.
    pub fn slot_owner(&self, role: Role) -> Result<Option<Key>, String> {
        match role {
            Role::Change => Ok(Some(self.group.owner_hash)),
            Role::Payee => self.payee_owner().map(Some),
            Role::Dummy => Ok(None),
        }
    }

    /// The `utxo_hash` that the plaintext of one slot gives.
    fn slot_hash(&self, slot: &OutPlan) -> Result<Key, String> {
        match self.slot_owner(slot.role)? {
            None => dummy_hash(&slot.blinding, TREE_ID),
            Some(owner_hash) => Utxo {
                owner_hash,
                mint: slot.mint,
                amount: slot.amount,
                blinding: slot.blinding,
            }
            .hash(TREE_ID),
        }
    }

    /// The payee as the message commits to it: its tag, owner hash and viewing key.
    fn fingerprint(&self) -> Option<Fingerprint> {
        let address = self.payee_address()?;
        let tag = address.tag()?;
        Some(Fingerprint {
            tag,
            owner_hash: owner_hash(&tag, &address.nullifier_pk).ok()?,
            viewing_pk: address.viewing_pk,
        })
    }

    pub fn output_rules(&mut self) {
        self.summary.payee = self.fingerprint();
        let (plan, tx) = (self.plan, self.tx);
        for (index, (slot, output)) in plan.outputs.iter().zip(&tx.outputs).enumerate() {
            match self.slot_hash(slot) {
                Ok(hash) if hash == output.utxo_hash => {}
                Ok(_) => self.fail(
                    Rule::OutputHash,
                    format!("output {index}: the hash is not the hash of its plaintext"),
                ),
                Err(why) => self.fail(Rule::PlanInvalid, format!("output {index}: {why}")),
            }
        }
    }
}

impl Spend<'_> {
    /// Every blinding, padding slots included, is the one that the circuit forces
    /// (`transaction.go:193-199`). A proposer who copies the hash of an input or of another
    /// output, or who hides data in a blinding, has no proof, so the fee and the nonce would be
    /// lost. The dummy blob is the only part of the outputs that stays free.
    pub fn blinding_rules(&mut self) {
        let Some(first) = self.first_nullifier() else {
            return self.fail(
                Rule::OutputBlinding,
                "the spend has no input, so no first nullifier",
            );
        };
        let seed = match output_seed(&first, &self.plan.blinding_seed) {
            Ok(seed) => seed,
            Err(why) => return self.fail(Rule::PlanInvalid, format!("blinding seed: {why}")),
        };
        let plan = self.plan;
        for (index, slot) in plan.outputs.iter().enumerate() {
            self.slot_blinding_rule(&first, &seed, index, slot);
        }
    }

    fn slot_blinding_rule(&mut self, first: &Key, seed: &Key, index: usize, slot: &OutPlan) {
        let slot_no = u32::try_from(index).unwrap_or(u32::MAX);
        match output_blinding(first, seed, slot_no) {
            Ok(want) if want == slot.blinding => {}
            Ok(_) => {
                let why = format!("output {index}: the blinding is not the derived one");
                self.fail(Rule::OutputBlinding, why);
            }
            Err(why) => self.fail(Rule::PlanInvalid, format!("blinding {index}: {why}")),
        }
    }
}
