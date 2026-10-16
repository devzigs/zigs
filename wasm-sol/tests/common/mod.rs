//! Fixtures shared by the integration tests: real vectors, pins, accept vectors and the helpers
//! that build negative vectors by mutating a parsed message.
#![allow(dead_code)]

pub mod fixture;
pub mod real;
pub mod ts;

use std::str::FromStr;

use p3_check::check::{check_all, Report};
use p3_check::consts::Key;
use p3_check::intent::{Intent, Spend};
use p3_check::pins::Pins;
use p3_check::rule::Rule;
use p3_check::template::{arrange, compile, KeyFlags};
use p3_check::transact::{self, OwnerTag, Transact};
use p3_check::v1::{self, Ix, Message};

pub const VECTORS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/vectors");

/// A finite expiry that the accept vectors use (the intent repeats it).
pub const EXPIRY: u64 = 1_800_000_000;

/// The clock of the approving device in the tests: one hour before the expiry.
pub const NOW: u64 = EXPIRY - 3_600;

pub fn read(path: &str) -> Vec<u8> {
    std::fs::read(format!("{VECTORS}/{path}")).unwrap_or_else(|e| panic!("read {path}: {e}"))
}

pub fn b58(text: &str) -> Key {
    solana_address::Address::from_str(text)
        .expect("base58 address")
        .to_bytes()
}

pub fn hex32(text: &str) -> Key {
    let bytes: Vec<u8> = (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).expect("hex"))
        .collect();
    bytes.try_into().expect("32 bytes")
}

pub struct Facts(pub serde_json::Value);

impl Facts {
    pub fn load() -> Self {
        Facts(serde_json::from_slice(&read("facts.json")).expect("facts.json"))
    }

    pub fn text(&self, name: &str) -> &str {
        self.0[name]
            .as_str()
            .unwrap_or_else(|| panic!("fact {name}"))
    }

    pub fn amount(&self, name: &str) -> u64 {
        self.0["amounts"][name]
            .as_u64()
            .unwrap_or_else(|| panic!("amount {name}"))
    }

    pub fn group(&self) -> Key {
        b58(self.text("group"))
    }

    pub fn owner_hash(&self) -> Key {
        hex32(self.text("group_owner_hash"))
    }

    pub fn nullifier_pk(&self) -> Key {
        hex32(self.text("nullifier_pk"))
    }

    pub fn viewing_pk(&self) -> [u8; 33] {
        let text = self.text("viewing_pk");
        let bytes: Vec<u8> = (0..text.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
            .collect();
        bytes.try_into().expect("33 bytes")
    }

    pub fn payee(&self) -> Key {
        b58(self.text("payee_b"))
    }

    /// The full shielded address of key B (public keys: the P6 run saved it).
    pub fn payee_address(&self) -> p3_check::address::Address {
        let bytes = unhex(self.text("payee_b_address"));
        assert_eq!(bytes.len(), 99);
        p3_check::address::Address {
            signing: bytes[..34].try_into().unwrap(),
            nullifier_pk: bytes[34..66].try_into().unwrap(),
            viewing_pk: bytes[66..].try_into().unwrap(),
        }
    }

    pub fn recipient(&self) -> Key {
        b58(self.text("withdraw_recipient"))
    }

    pub fn stretch_nonce(&self) -> Key {
        b58(self.text("stretch_nonce"))
    }
}

/// The fee payer of the test messages: the fee key of the proposing seat. It is not the group.
pub const PAYER: Key = [0x42; 32];

/// The rules of the beta policy (src/beta.rs). An answer that only they refuse passed every rule
/// of the checker.
pub const POLICY: [&str; 2] = ["intent-retired", "migration-payee"];

/// The refusal line of a nonce payment to another payee than the PDA address of the group.
pub const MIGRATION_LINE: &str = concat!(
    "migration-payee\ta nonce payment must pay its inputs whole to the program address of this ",
    "group"
);

/// True when the answer is a refusal by the beta policy alone.
pub fn only_policy(answer: &str) -> bool {
    let mut lines = answer.lines();
    lines.next() == Some("refused")
        && lines.all(|line| {
            POLICY
                .iter()
                .any(|rule| line.starts_with(&format!("{rule}\t")))
        })
}

/// The `nullifier_pk` of the PDA identity in the pins of the tests of the group-key identity.
/// Those tests never pay to the PDA, so any field element serves.
pub const PDA_NULLIFIER_PK: Key = [0x0d; 32];

pub fn pins() -> Pins {
    let facts = Facts::load();
    Pins::devnet(
        facts.group(),
        facts.nullifier_pk(),
        facts.viewing_pk(),
        PAYER,
        PDA_NULLIFIER_PK,
    )
    .expect("pins")
}

pub const NONCE: Key = [9; 32];

pub fn parse(bytes: &[u8]) -> Message {
    v1::parse(bytes).expect("parse")
}

pub fn write(msg: &Message) -> Vec<u8> {
    v1::write(msg).expect("write")
}

/// The `transact` data of a real v1 message (the first pool instruction with tag 16).
pub fn real_tx(path: &str) -> Transact {
    let msg = parse(&read(path));
    let ix = msg
        .ixs
        .iter()
        .find(|ix| ix.data.first() == Some(&16))
        .expect("a transact ix");
    transact::parse(&ix.data).expect("transact data")
}

pub fn spend(inputs: u8, outputs: u8) -> Spend {
    Spend {
        nonce: NONCE,
        expiry: EXPIRY,
        inputs,
        outputs,
    }
}

/// The accept vector of each intent: the bytes and the intent.
pub struct Vector {
    pub name: &'static str,
    pub bytes: Vec<u8>,
    pub intent: Intent,
}

/// The `transact` data of a P5 run with a finite expiry. The group paid the P5 transactions, so
/// its change tag is account 0. With a sponsor the SDK writes the group key inline, as here.
fn finite(mut tx: Transact, group: Key) -> Transact {
    tx.expiry = EXPIRY;
    for output in &mut tx.outputs {
        if output.owner_tag == OwnerTag::Account(0) {
            output.owner_tag = OwnerTag::Inline(group);
        }
    }
    tx
}

pub fn accept_vectors() -> Vec<Vector> {
    let (pins, facts) = (pins(), Facts::load());
    let transfer = Intent::Transfer {
        spend: spend(1, 2),
        payee: facts.payee_address(),
        mint: [0; 32],
        amount: facts.amount("transfer"),
    };
    let withdrawal = Intent::Withdrawal {
        spend: spend(1, 2),
        recipient: facts.recipient(),
        amount: facts.amount("withdraw"),
    };
    let tx_transfer = finite(real_tx("real/work-transfer-0.msg"), pins.group);
    let tx_withdraw = finite(real_tx("real/work-withdraw-0.msg"), pins.group);
    let create = Intent::CreateNonce { blockhash: NONCE };
    let register = Intent::Register {
        nonce: NONCE,
        nullifier_pk: facts.nullifier_pk(),
        viewing_pk: facts.viewing_pk(),
    };
    let shield = Intent::Shield {
        blockhash: NONCE,
        amount: facts.amount("shield"),
    };
    let cancel = Intent::Cancel { nonce: NONCE };
    let cases: Vec<(&'static str, Intent, Option<&Transact>)> = vec![
        ("create-nonce", create, None),
        ("register", register, None),
        ("shield", shield, None),
        ("transfer", transfer, Some(&tx_transfer)),
        ("withdrawal", withdrawal, Some(&tx_withdraw)),
        ("cancel", cancel, None),
    ];
    cases
        .into_iter()
        .map(|(name, intent, tx)| {
            let msg = compile(&intent, &pins, tx).unwrap_or_else(|e| panic!("compile {name}: {e}"));
            Vector {
                name,
                bytes: write(&msg),
                intent,
            }
        })
        .collect()
}

pub fn accept(name: &str) -> Vector {
    accept_vectors()
        .into_iter()
        .find(|v| v.name == name)
        .expect("accept vector")
}

pub fn report(bytes: &[u8], intent: &Intent) -> Report {
    check_all(bytes, intent, &pins(), NOW)
}

/// The rule that refuses the bytes first. Panics if the bytes are accepted.
pub fn first_rule(bytes: &[u8], intent: &Intent) -> Rule {
    let report = report(bytes, intent);
    report
        .violations
        .first()
        .map(|v| v.rule)
        .unwrap_or_else(|| panic!("accepted, expected a refusal"))
}

/// Asserts that the first violation is `rule`.
pub fn assert_refused(bytes: &[u8], intent: &Intent, rule: Rule) {
    let report = report(bytes, intent);
    let got: Vec<Rule> = report.violations.iter().map(|v| v.rule).collect();
    assert_eq!(
        got.first(),
        Some(&rule),
        "all violations: {:?}",
        report.violations
    );
}

// ---- mutation helpers ---------------------------------------------------------------------

pub fn mutate(bytes: &[u8], f: impl FnOnce(&mut Message)) -> Vec<u8> {
    let mut msg = parse(bytes);
    f(&mut msg);
    write(&msg)
}

pub fn tx_position(msg: &Message) -> usize {
    msg.ixs
        .iter()
        .position(|ix| ix.data.first() == Some(&16))
        .expect("a transact ix")
}

pub fn mutate_tx(bytes: &[u8], f: impl FnOnce(&mut Transact)) -> Vec<u8> {
    mutate(bytes, |msg| {
        let at = tx_position(msg);
        let mut tx = transact::parse(&msg.ixs[at].data).expect("transact");
        f(&mut tx);
        msg.ixs[at].data = tx.write().expect("write tx");
    })
}

pub fn flags_of(msg: &Message) -> KeyFlags {
    (0..msg.keys.len())
        .map(|i| (msg.keys[i], (msg.is_signer(i), msg.is_writable(i))))
        .collect()
}

/// Rebuilds the key table from `flags` and maps every instruction index to the new table.
pub fn rebuild(msg: &mut Message, flags: &KeyFlags) {
    let payer = msg.keys[0];
    let old = msg.keys.clone();
    let (keys, header) = arrange(flags, &payer).expect("arrange");
    let at = |key: &Key| keys.iter().position(|k| k == key).expect("key in table") as u8;
    for ix in &mut msg.ixs {
        ix.program = at(&old[usize::from(ix.program)]);
        ix.accounts = ix
            .accounts
            .iter()
            .map(|a| at(&old[usize::from(*a)]))
            .collect();
    }
    msg.keys = keys;
    msg.header = header;
}

pub fn with_flags(bytes: &[u8], key: &Key, signer: bool, writable: bool) -> Vec<u8> {
    mutate(bytes, |msg| {
        let mut flags = flags_of(msg);
        flags.insert(*key, (signer, writable));
        rebuild(msg, &flags);
    })
}

/// Appends an instruction. A key that the table lacks joins as a readonly non-signer.
pub fn with_ix(bytes: &[u8], program: Key, accounts: &[Key], data: Vec<u8>) -> Vec<u8> {
    mutate(bytes, |msg| {
        let mut flags = flags_of(msg);
        for key in std::iter::once(&program).chain(accounts) {
            flags.entry(*key).or_insert((false, false));
        }
        rebuild(msg, &flags);
        let at = |key: &Key| msg.keys.iter().position(|k| k == key).expect("key") as u8;
        let ix = Ix {
            program: at(&program),
            accounts: accounts.iter().map(at).collect(),
            data,
        };
        msg.ixs.push(ix);
    })
}

/// Replaces one key of the table in place, so every instruction now names the new key.
pub fn replace_key(bytes: &[u8], old: &Key, new: Key) -> Vec<u8> {
    mutate(bytes, |msg| {
        let at = msg
            .keys
            .iter()
            .position(|k| k == old)
            .expect("key to replace");
        msg.keys[at] = new;
    })
}

pub const ATTACKER: Key = [0xAA; 32];

// ---- repo vectors -------------------------------------------------------------------------

pub fn unhex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).expect("hex"))
        .collect()
}

pub fn unhex_n<const N: usize>(text: &str) -> [u8; N] {
    unhex(text)
        .try_into()
        .unwrap_or_else(|_| panic!("{N} bytes"))
}

/// A field element from a small integer (big endian, right aligned).
pub fn field(n: u64) -> Key {
    let mut out = [0; 32];
    out[24..].copy_from_slice(&n.to_be_bytes());
    out
}

/// The intent of a spend with its `Spend` changed.
pub fn with_spend(intent: &Intent, f: impl FnOnce(&mut Spend)) -> Intent {
    let mut intent = intent.clone();
    match &mut intent {
        Intent::Transfer { spend, .. } | Intent::Withdrawal { spend, .. } => f(spend),
        _ => panic!("not a spend"),
    }
    intent
}
