//! A self-consistent spend: synthetic wallet keys, a snapshot, the plaintext plan, and a
//! message whose blindings, hashes and ciphertexts are built the way the SDK builds them (outputs
//! in the order change, payee, dummies, padded to a supported shape; the blinding of each slot
//! derived from the first nullifier and a root seed; a dummy naming the owner of the first real
//! output; one confidential slot per output; the group as fee payer). The proof is zeros: the
//! checker never reads it. Each test breaks one thing and names the rule that must catch it.
#![allow(dead_code)]

use p3_check::address::Address;
use p3_check::approve::{approve, Approved, Device};
use p3_check::consts::{Key, SUPPORTED_SHAPES};
use p3_check::hashes::{
    dummy_hash, nullifier_pk, output_blinding, output_seed, owner_hash, Utxo, TREE_ID,
};
use p3_check::intent::{Intent, Spend};
use p3_check::pins::Pins;
use p3_check::plan::{OutPlan, Plan, Role};
use p3_check::rule::Rule;
use p3_check::snapshot::{InputUtxo, Snapshot};
use p3_check::template::compile;
use p3_check::transact::{Circuit, Input, Leg, Output, OwnerTag, Transact, TreeContext};
use p3_check::v1;
use p3_check::viewing::{plaintext, ViewingKey, BLOB_LEN};

use super::{field, EXPIRY, NONCE, NOW};

pub const SOL: Key = [0; 32];
/// A real SPL mint of Devnet, `ETzu3EpvF7Jqz5ZWng4QANZDvogjgcveRmztm2mb8Xss`, and its asset id in
/// the pinned table (`tests/asset_pins.rs` compares both with the registry).
pub const MINT: Key = [
    0xc8, 0x12, 0x7e, 0xe4, 0x45, 0x3d, 0x5a, 0x6b, 0x38, 0x05, 0x0f, 0x91, 0xba, 0x86, 0xec, 0xcf,
    0x47, 0xdd, 0x0a, 0x0f, 0x2a, 0x19, 0x82, 0x9a, 0xfc, 0xcd, 0xa9, 0xab, 0xef, 0xb2, 0xf1, 0xb6,
];
pub const MINT_ID: u64 = 2;

pub const GROUP: Key = [0x11; 32];
pub const PAYEE: Key = [0x22; 32];
pub const ATTACKER: Key = [0xAA; 32];

pub struct Wallet {
    pub signer: Key,
    pub nullifier_secret: [u8; 31],
    pub viewing_sk: [u8; 32],
}

impl Wallet {
    pub fn new(signer: Key, seed: u8) -> Self {
        Self {
            signer,
            nullifier_secret: [seed; 31],
            viewing_sk: field(0x1000_0000 + u64::from(seed)),
        }
    }

    pub fn owner_hash(&self) -> Key {
        owner_hash(&self.signer, &nullifier_pk(&self.nullifier_secret).unwrap()).unwrap()
    }

    pub fn viewing_pk(&self) -> [u8; 33] {
        ViewingKey::from_bytes(&self.viewing_sk)
            .unwrap()
            .public()
            .unwrap()
    }

    pub fn keys(&self) -> (Key, [u8; 33]) {
        (
            nullifier_pk(&self.nullifier_secret).unwrap(),
            self.viewing_pk(),
        )
    }

    pub fn address(&self) -> Address {
        let mut signing = [0; 34];
        signing[0] = 1;
        signing[1..33].copy_from_slice(&self.signer);
        Address {
            signing,
            nullifier_pk: nullifier_pk(&self.nullifier_secret).unwrap(),
            viewing_pk: self.viewing_pk(),
        }
    }
}

pub fn group() -> Wallet {
    Wallet::new(GROUP, 0x42)
}

pub fn payee() -> Wallet {
    Wallet::new(PAYEE, 0x43)
}

pub fn attacker() -> Wallet {
    Wallet::new(ATTACKER, 0x44)
}

/// What the spend does.
pub struct Spec {
    /// The inputs, in order: mint and amount.
    pub inputs: Vec<(Key, u64)>,
    /// A Transfer pays this (mint, amount) to the payee. `None` is a Withdrawal.
    pub pay: Option<(Key, u64)>,
    /// The SOL that a Withdrawal moves to the public recipient.
    pub withdraw: u64,
    /// Padding outputs after the real ones.
    pub dummies: usize,
    /// Added to the change of the first asset: a spend that does not balance.
    pub change_delta: i64,
    /// The private root seed of the proof, as a small number (a re-proof has another seed).
    pub seed: u64,
    /// Every byte of the ciphertext salt (a re-proof may keep it, which is a reuse).
    pub salt: u8,
}

impl Spec {
    /// 1 input of 100 lamports, pay 40 to the payee, change 60.
    pub fn transfer() -> Self {
        Self {
            inputs: vec![(SOL, 100)],
            pay: Some((SOL, 40)),
            withdraw: 0,
            dummies: 0,
            change_delta: 0,
            seed: 7000,
            salt: 5,
        }
    }

    /// 1 input of 100 lamports, withdraw 30, change 70 and one dummy.
    pub fn withdrawal() -> Self {
        Self {
            inputs: vec![(SOL, 100)],
            pay: None,
            withdraw: 30,
            dummies: 1,
            change_delta: 0,
            seed: 7000,
            salt: 5,
        }
    }
}

pub struct Fixture {
    pub pins: Pins,
    pub intent: Intent,
    pub plan: Plan,
    pub snapshot: Snapshot,
    pub tx: Transact,
}

pub fn input_blinding(index: usize) -> Key {
    field(1000 + index as u64)
}

/// The private root seed of the proof of a fixture.
pub fn blinding_seed(spec: &Spec) -> Key {
    field(spec.seed)
}

/// The blinding that the circuit forces on output `slot` of a spend with this first nullifier
/// and this root seed.
pub fn slot_blinding(first_nullifier: &Key, root: &Key, slot: usize) -> Key {
    let seed = output_seed(first_nullifier, root).unwrap();
    output_blinding(first_nullifier, &seed, slot as u32).unwrap()
}

/// The output count of the cheapest circuit that fits (the SDK pads to it with dummies). With
/// no circuit for the input count, the count itself.
fn shape_outputs(inputs: usize, outputs: usize) -> usize {
    SUPPORTED_SHAPES
        .iter()
        .find(|&&(i, o)| usize::from(i) == inputs && usize::from(o) >= outputs)
        .map_or(outputs, |&(_, o)| usize::from(o))
}

fn snapshot_of(spec: &Spec) -> Snapshot {
    let wallet = group();
    Snapshot {
        nullifier_secret: wallet.nullifier_secret,
        viewing_sk: wallet.viewing_sk,
        fee_per_nullifier: 0,
        used_salts: Vec::new(),
        inputs: spec
            .inputs
            .iter()
            .enumerate()
            .map(|(i, (mint, amount))| InputUtxo {
                mint: *mint,
                amount: *amount,
                blinding: input_blinding(i),
            })
            .collect(),
    }
}

/// What stays of one asset after the payment and the withdrawal. `first` adds `change_delta`.
fn left_of(spec: &Spec, mint: &Key, first: bool) -> i128 {
    let have: i128 = spec
        .inputs
        .iter()
        .filter(|(m, _)| m == mint)
        .map(|(_, a)| i128::from(*a))
        .sum();
    let paid = spec
        .pay
        .filter(|(m, _)| m == mint)
        .map_or(0, |(_, a)| i128::from(a));
    let out_of = if *mint == SOL {
        i128::from(spec.withdraw)
    } else {
        0
    };
    let delta = if first {
        i128::from(spec.change_delta)
    } else {
        0
    };
    have - paid - out_of + delta
}

/// The change of each asset, in order of first appearance among the inputs.
fn changes(spec: &Spec) -> Vec<(Key, u64)> {
    let mut mints: Vec<Key> = Vec::new();
    for (mint, _) in &spec.inputs {
        if !mints.contains(mint) {
            mints.push(*mint);
        }
    }
    let mut out = Vec::new();
    for (index, mint) in mints.iter().enumerate() {
        let left = left_of(spec, mint, index == 0);
        if left > 0 {
            out.push((*mint, u64::try_from(left).unwrap()));
        }
    }
    // A spend that pays no one and keeps nothing keeps a real change of 0: a dummy needs an
    // owner to name (`prepare` in transact.ts, `hasSolChange`).
    if out.is_empty() && spec.pay.is_none() {
        out.push((SOL, 0));
    }
    out
}

/// The slots of the plan, in the order of the SDK: change, payee, dummies, and dummies up to the
/// output count of the circuit.
pub fn plan_slots(spec: &Spec, first_nullifier: &Key) -> Vec<OutPlan> {
    let mut slots: Vec<(Role, Key, u64)> = changes(spec)
        .into_iter()
        .map(|(mint, amount)| (Role::Change, mint, amount))
        .collect();
    slots.extend(spec.pay.map(|(mint, amount)| (Role::Payee, mint, amount)));
    slots.extend((0..spec.dummies).map(|_| (Role::Dummy, SOL, 0)));
    let total = shape_outputs(spec.inputs.len(), slots.len());
    slots.resize(total, (Role::Dummy, SOL, 0));
    slots
        .into_iter()
        .enumerate()
        .map(|(slot, (role, mint, amount))| OutPlan {
            role,
            mint,
            amount,
            blinding: slot_blinding(first_nullifier, &blinding_seed(spec), slot),
        })
        .collect()
}

impl Fixture {
    pub fn build(spec: &Spec) -> Self {
        let wallet = group();
        let (nullifier_pk, viewing_pk) = wallet.keys();
        let pins = Pins::devnet(GROUP, nullifier_pk, viewing_pk).expect("pins");
        let snapshot = snapshot_of(spec);
        let nullifiers: Vec<Key> = snapshot
            .inputs
            .iter()
            .map(|i| {
                Utxo {
                    owner_hash: wallet.owner_hash(),
                    mint: i.mint,
                    amount: i.amount,
                    blinding: i.blinding,
                }
                .nullifier(TREE_ID, &snapshot.nullifier_secret)
                .unwrap()
            })
            .collect();
        let tx_key = ViewingKey::from_bytes(&wallet.viewing_sk)
            .unwrap()
            .tx_key(&nullifiers[0])
            .unwrap();
        let plan = Plan {
            blinding_seed: blinding_seed(spec),
            outputs: plan_slots(spec, &nullifiers[0]),
        };
        let salt = [spec.salt; 16];
        let mut fixture = Self {
            pins,
            intent: Intent::Cancel { nonce: NONCE },
            plan,
            snapshot,
            tx: Transact {
                expiry: EXPIRY,
                tx_viewing_pk: tx_key.public().unwrap(),
                salt,
                legs: if spec.withdraw > 0 {
                    vec![Leg::SolWithdrawal(spec.withdraw)]
                } else {
                    Vec::new()
                },
                data_hash: None,
                ring_data_hash: None,
                outputs: Vec::new(),
                messages: Vec::new(),
                private_tx_hash: field(77),
                circuit: Circuit {
                    inputs: spec.inputs.len() as u8,
                    outputs: 0,
                    slots: 3,
                },
                proof: [0; 192],
                inputs: nullifiers
                    .iter()
                    .map(|n| Input {
                        nullifier: *n,
                        tree_index: 0,
                    })
                    .collect(),
                tree_contexts: vec![TreeContext {
                    utxo_root_index: 0,
                    nullifier_root_index: 0,
                }],
            },
        };
        fixture.tx.outputs = fixture
            .plan
            .outputs
            .iter()
            .enumerate()
            .map(|(slot, out)| fixture.output_of(out, slot, &tx_key))
            .collect();
        fixture.tx.circuit.outputs = fixture.tx.outputs.len() as u8;
        fixture.intent = fixture.intent_of(spec);
        fixture
    }

    fn intent_of(&self, spec: &Spec) -> Intent {
        let spend = Spend {
            nonce: NONCE,
            expiry: EXPIRY,
            inputs: self.tx.inputs.len() as u8,
            outputs: self.tx.outputs.len() as u8,
        };
        match spec.pay {
            Some((mint, amount)) => Intent::Transfer {
                spend,
                payee: payee().address(),
                mint,
                amount,
            },
            None => Intent::Withdrawal {
                spend,
                recipient: [0x33; 32],
                amount: spec.withdraw,
            },
        }
    }

    /// The owner hash of a role.
    pub fn owner_of(&self, role: Role) -> Option<Key> {
        match role {
            Role::Change => Some(group().owner_hash()),
            Role::Payee => Some(payee().owner_hash()),
            Role::Dummy => None,
        }
    }

    /// The hash that a slot of this plaintext has.
    pub fn hash_of(&self, out: &OutPlan) -> Key {
        match self.owner_of(out.role) {
            None => dummy_hash(&out.blinding, TREE_ID).unwrap(),
            Some(owner_hash) => Utxo {
                owner_hash,
                mint: out.mint,
                amount: out.amount,
                blinding: out.blinding,
            }
            .hash(TREE_ID)
            .unwrap(),
        }
    }

    /// The `data` that the SDK writes for a slot: a confidential blob, or random bytes (here a
    /// fixed pattern of the same length) for a dummy.
    pub fn data_of(&self, out: &OutPlan, slot: usize, tx_key: &ViewingKey) -> Vec<u8> {
        let recipient = match out.role {
            Role::Change => group().viewing_pk(),
            Role::Payee => payee().viewing_pk(),
            Role::Dummy => return (0..BLOB_LEN).map(|i| (i * 7 + slot) as u8).collect(),
        };
        let id = if out.mint == SOL { 1 } else { MINT_ID };
        let body = plaintext(id, out.amount, &out.blinding);
        tx_key
            .slot_data(&recipient, &body, &self.tx.salt, slot as u32)
            .unwrap()
    }

    /// The tag that a dummy names: the owner of the first real output, as the SDK does
    /// (`dummyOwnerTag`). The group is the payer, so it is named only through a real output.
    pub fn dummy_tag(&self) -> Key {
        let first = self.plan.outputs.iter().find(|o| o.role != Role::Dummy);
        first.map_or(
            GROUP,
            |o| if o.role == Role::Change { GROUP } else { PAYEE },
        )
    }

    fn output_of(&self, out: &OutPlan, slot: usize, tx_key: &ViewingKey) -> Output {
        let owner_tag = match out.role {
            Role::Change => OwnerTag::Account(0),
            Role::Payee => OwnerTag::Inline(PAYEE),
            Role::Dummy => OwnerTag::Inline(self.dummy_tag()),
        };
        Output {
            utxo_hash: self.hash_of(out),
            owner_tag,
            data: Some(self.data_of(out, slot, tx_key)),
        }
    }

    /// Rebuilds the hash and the data of every slot from the plan, so only the plan has changed.
    pub fn resync(&mut self) {
        let key = self.tx_key();
        for (slot, out) in self.plan.outputs.clone().iter().enumerate() {
            self.tx.outputs[slot].utxo_hash = self.hash_of(out);
            self.tx.outputs[slot].data = Some(self.data_of(out, slot, &key));
        }
    }

    /// Appends one dummy slot: the plan, the output, and the counts of the circuit and the
    /// intent. The shape of the spend is then the one that the SDK would have padded.
    pub fn push_dummy(&mut self) {
        let slot = self.plan.outputs.len();
        let first = self.tx.inputs[0].nullifier;
        let out = OutPlan {
            role: Role::Dummy,
            mint: SOL,
            amount: 0,
            blinding: slot_blinding(&first, &self.plan.blinding_seed, slot),
        };
        let tag = OwnerTag::Inline(self.dummy_tag());
        let data = Some(self.data_of(&out, slot, &self.tx_key()));
        self.tx.outputs.push(Output {
            utxo_hash: self.hash_of(&out),
            owner_tag: tag,
            data,
        });
        self.plan.outputs.push(out);
        self.tx.circuit.outputs += 1;
        self.intent = super::with_spend(&self.intent, |spend| spend.outputs += 1);
    }

    /// The transaction viewing key of the group for this spend.
    pub fn tx_key(&self) -> ViewingKey {
        ViewingKey::from_bytes(&group().viewing_sk)
            .unwrap()
            .tx_key(&self.tx.inputs[0].nullifier)
            .unwrap()
    }

    /// The message of `tx`, compiled by the template: the accounts follow the inputs.
    pub fn bytes(&self) -> Vec<u8> {
        let msg = compile(&self.intent, &self.pins, Some(&self.tx)).expect("compile");
        v1::write(&msg).expect("write")
    }

    pub fn device(&self) -> Device<'_> {
        Device {
            pins: &self.pins,
            snapshot: &self.snapshot,
            now: NOW,
        }
    }

    pub fn approve_bytes(&self, bytes: &[u8]) -> Result<Approved, Vec<Rule>> {
        approve(bytes, &self.intent, &self.plan, &self.device())
            .map_err(|refusal| refusal.violations.iter().map(|v| v.rule).collect())
    }

    /// `approve` on the compiled message of `tx`.
    pub fn approve(&self) -> Result<Approved, Vec<Rule>> {
        self.approve_bytes(&self.bytes())
    }

    /// The rules that refuse, or an empty list if the message is approved.
    pub fn rules(&self) -> Vec<Rule> {
        self.approve().err().unwrap_or_default()
    }
}
