//! The Ciphertexts rule of section 5. `tx_viewing_sk` derives from `tx_viewing_secret` and the
//! first nullifier, and the key schedule is deterministic, so the device recomputes the
//! `tx_viewing_pk` and every output `data` byte for byte. The pool never reads `data`
//! (docs/spec.md 1878), so a wrong blob would land and hide the output from the payee.
//!
//! A dummy slot carries random bytes (`randomBytes(dummyLength)` in the TS SDK, `random_salt`
//! in the Rust SDK), so only its length can be compared: the length of a real slot.

use crate::consts::Key;
use crate::plan::{OutPlan, Role};
use crate::rule::Rule;
use crate::spend::Spend;
use crate::transact::{Output, OwnerTag};
use crate::viewing::{plaintext, ViewingKey, BLOB_LEN};

type Fault = Option<(Rule, String)>;

impl Spend<'_> {
    /// The owner tag of an output, with an account index resolved against the message.
    fn resolved_tag(&self, output: &Output) -> Option<Key> {
        match output.owner_tag {
            OwnerTag::Inline(tag) => Some(tag),
            OwnerTag::Account(at) => self.msg.account_key(self.ix, usize::from(at)).copied(),
        }
    }

    /// Each slot names the owner tag of its role: the group for change, the payee for the
    /// payee output, and either participant for a dummy.
    fn tag_rules(&mut self) {
        let (plan, tx, participants) = (self.plan, self.tx, self.participants());
        for (index, (slot, output)) in plan.outputs.iter().zip(&tx.outputs).enumerate() {
            let tag = self.resolved_tag(output);
            let right = match slot.role {
                Role::Dummy => tag.is_some_and(|tag| participants.contains(&tag)),
                role => tag.is_some() && tag == self.role_tag(role),
            };
            if !right {
                self.fail(
                    Rule::OutputTagRole,
                    format!("output {index} names another owner"),
                );
            }
        }
    }

    /// The viewing key that a slot is encrypted to.
    fn recipient(&self, role: Role) -> Option<[u8; 33]> {
        match role {
            Role::Change => Some(self.group.viewing_pk),
            Role::Payee => self.payee_address().map(|address| address.viewing_pk),
            Role::Dummy => None,
        }
    }

    /// The fault of one slot, if its `data` is not the recompute.
    fn data_fault(&self, key: &ViewingKey, index: usize, slot: &OutPlan) -> Fault {
        let have = self
            .tx
            .outputs
            .get(index)
            .and_then(|output| output.data.as_deref());
        // ponytail: a dummy blob is random bytes, so only its length is compared. Ceiling: a
        // proposer can hide 89 bytes in each dummy slot. They move no funds and no rule reads
        // them. Upgrade path: none without a seed for the dummy data.
        let Some(recipient) = self.recipient(slot.role) else {
            let ok = have.is_some_and(|data| data.len() == BLOB_LEN);
            let why = format!("output {index}: a dummy needs {BLOB_LEN} bytes of data");
            return (!ok).then_some((Rule::Ciphertext, why));
        };
        let Some(asset_id) = self.assets.asset_id(&slot.mint) else {
            let why = format!("output {index}: the pinned table has no id for the mint");
            return Some((Rule::AssetUnknown, why));
        };
        let slot_no = u32::try_from(index).unwrap_or(u32::MAX);
        let body = plaintext(asset_id, slot.amount, &slot.blinding);
        match key.slot_data(&recipient, &body, &self.tx.salt, slot_no) {
            Ok(want) if have == Some(want.as_slice()) => None,
            Ok(_) => Some((
                Rule::Ciphertext,
                format!("output {index}: data is not the recompute"),
            )),
            Err(why) => Some((Rule::PlanInvalid, format!("output {index}: {why}"))),
        }
    }

    /// The transaction viewing key of the group for this spend, from the first nullifier of the
    /// snapshot. `tx_viewing_pk` must be its public key.
    fn tx_key_rule(&mut self) -> Option<ViewingKey> {
        let Some(first) = self.first_nullifier() else {
            self.fail(
                Rule::TxViewingPk,
                "the spend has no input, so no transaction key",
            );
            return None;
        };
        let derived = ViewingKey::from_bytes(&self.snap.viewing_sk).and_then(|k| k.tx_key(&first));
        let key = derived.and_then(|key| key.public().map(|public| (key, public)));
        match key {
            Ok((key, public)) => {
                if public != self.tx.tx_viewing_pk {
                    self.fail(Rule::TxViewingPk, "tx_viewing_pk is not the derived key");
                }
                Some(key)
            }
            Err(why) => {
                self.fail(Rule::PlanInvalid, format!("tx viewing key: {why}"));
                None
            }
        }
    }

    /// The salt is not zero, and no other proposal of the device used the same first nullifier
    /// with it. Both fix the keystream of every slot, and a proposal that fails on chain (a
    /// stale root, for one) still publishes its data.
    fn salt_rules(&mut self) {
        let salt = self.tx.salt;
        if salt == [0; 16] {
            self.fail(Rule::SaltZero, "the salt is all zero");
        }
        let Some(first) = self.first_nullifier() else {
            return self.fail(
                Rule::SaltReused,
                "the spend has no input, so no first nullifier",
            );
        };
        if self.snap.used_salts.contains(&(first, salt)) {
            let why = "another proposal of this device has this first nullifier and salt";
            self.fail(Rule::SaltReused, why);
        }
    }

    /// `tx_viewing_pk` and every output `data` equal the recompute.
    pub fn cipher_rules(&mut self) {
        self.tag_rules();
        self.salt_rules();
        let Some(key) = self.tx_key_rule() else {
            return;
        };
        let plan = self.plan;
        for (index, slot) in plan.outputs.iter().enumerate() {
            if let Some((rule, detail)) = self.data_fault(&key, index, slot) {
                self.fail(rule, detail);
            }
        }
    }
}
