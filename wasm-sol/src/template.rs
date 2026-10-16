//! The template compiler: from an intent and the pins to the expected instruction list, the
//! limits, and (with the `transact` data from the Worker) the v1 message itself.
//!
//! The checker reuses `expected`, so the proposer and every approver read one template.
//!
//! Two keys sign: the payer (the fee key of the proposing seat, the first account and the fee
//! payer) and the group key. The payer funds every rent and fee, and the group key is a readonly
//! signer in every instruction: the nonce authority, the base of the nonce account, the owner of
//! the registry record and the owner signer of `transact`. Add SOL (`Shield`) has the payer as
//! its only signer.

use std::collections::{BTreeMap, BTreeSet};

use crate::consts::{
    Key, NONCE_SEED, NONCE_SPACE, RECENT_BLOCKHASHES, RENT_SYSVAR, SYSTEM_PROGRAM,
    SYS_ADVANCE_NONCE, SYS_CREATE_WITH_SEED, SYS_INIT_NONCE,
};
use crate::fixed::{AssetKind, Deposit, Entry, Register};
use crate::intent::Intent;
use crate::pins::Pins;
use crate::transact::{Leg, Transact};
use crate::v1::{Config, Ix, Message};

/// The config masks that the template accepts: bits 2 (compute units) and 3 (loaded accounts
/// limit), with the priority fee absent (fee 0, the form that the compiler writes), or with bits 0
/// and 1 set and a fee at or under `PRIORITY_MAX`. The heap bit is always clear.
pub const TEMPLATE_MASK_NO_FEE: u32 = 0b1100;
pub const TEMPLATE_MASK_WITH_FEE: u32 = 0b1111;

/// The expiry window of a proposal (ZOLANA.md section 5: 24 hours) and the clock skew that an
/// approving device accepts between its clock and the clock of the proposer.
pub const EXPIRY_WINDOW_SECS: u64 = 24 * 60 * 60;
pub const EXPIRY_SKEW_SECS: u64 = 60 * 60;

/// The largest priority fee in lamports that a message may carry. The recorded values are 0
/// (P4 and P5) and 2,000 (the P2 test value). The cap is the largest value plus 50 percent.
pub const PRIORITY_MAX: u64 = 3_000;

/// The largest insertion fee per nullifier in lamports that a tree may charge. The payer pays it
/// in public SOL (`collect_forester_fee`, programs/shielded-pool/src/
/// instructions/nullifier_pda/create.rs:106-116). Tree 0 charges 0 today. The fee that an
/// operator can set at cost is 108 lamports per nullifier (`default_tree_fees` and
/// `AT_COST_CLOSE_REIMBURSEMENT_LAMPORTS`, program-libs/interface/src/state/tree.rs), and the cap
/// is that value plus 50 percent.
pub const TREE_FEE_CAP: u64 = 162;

/// The largest loaded accounts limit: 64 MiB, the protocol maximum and the SDK default. Every
/// P5 transaction used it and landed. The compiler writes this value.
pub const LOADED_MAX: u32 = 64 * 1024 * 1024;

/// Compute unit caps: the largest recorded value plus 50 percent (ZOLANA.md section 5).
/// `transact`: 144,591 (P5 transfer) gives 216,886, and the brief fixes 217,000.
pub const CU_CAP_TRANSACT: u32 = 217_000;
/// `deposit`: 37,918 (P4) times 1.5.
pub const CU_CAP_SHIELD: u32 = 56_877;
/// `register`: 16,032 (P4 record B, the largest of 5,532, 8,532 and 16,032) times 1.5.
pub const CU_CAP_REGISTER: u32 = 24_048;
/// Nonce instructions: 300 (P2, two System instructions) times 1.5.
pub const CU_CAP_SYSTEM: u32 = 450;

/// Compute unit floors: the largest recorded consumption of the intent, the value that the cap
/// adds 50 percent to. A limit under it can fail at run time (the fee is charged and the nonce
/// advances, ZOLANA.md 6.3), so every approval would be lost. The compiler writes the cap.
pub const CU_FLOOR_TRANSACT: u32 = 144_591;
pub const CU_FLOOR_SHIELD: u32 = 37_918;
pub const CU_FLOOR_REGISTER: u32 = 16_032;
/// `CreateAccountWithSeed` and `InitializeNonceAccount`: 300 (P2). One System instruction costs
/// 150, so `Cancel` (`AdvanceNonceAccount` only) has the floor 150.
pub const CU_FLOOR_CREATE_NONCE: u32 = 300;
pub const CU_FLOOR_CANCEL: u32 = 150;

/// The smallest loaded accounts limit that does not fail at load (a failure still charges the
/// fee and advances the nonce, ZOLANA.md 6.3). The estimate is the sum of the account data
/// sizes plus 64 bytes per account, which reproduces the P2 value of 6,422 bytes exactly.
/// Pool intents: about 645,000 bytes (tree 40,080, pool program data 598,229) times 1.5.
pub const LOADED_MIN_POOL: u32 = 1_000_000;
/// Register: about 61,600 bytes (registry program data 61,141) times 1.5.
pub const LOADED_MIN_REGISTER: u32 = 100_000;
/// Nonce instructions: about 6,400 bytes (RecentBlockhashes 6,008) times 1.5.
pub const LOADED_MIN_SYSTEM: u32 = 10_000;

/// An account of an instruction, with the flags that it needs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Acct {
    pub key: Key,
    pub signer: bool,
    pub writable: bool,
}

fn acct(key: Key, signer: bool, writable: bool) -> Acct {
    Acct {
        key,
        signer,
        writable,
    }
}

/// The data of a template instruction.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Data {
    /// The bytes are fixed: the checker compares them whole.
    Exact(Vec<u8>),
    /// The bytes follow from the intent and the checker compares them field by field, so that
    /// a refusal names the field (the `register` and `deposit` data).
    Fields(Vec<u8>),
    /// The `transact` data from the Worker: the `transact` rules check it.
    Variable,
}

/// One instruction of the template.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExpectedIx {
    pub program: Key,
    pub accounts: Vec<Acct>,
    pub data: Data,
}

/// The limits that the template fixes for one intent.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    pub cu_cap: u32,
    pub cu_floor: u32,
    pub loaded_min: u32,
    pub priority_max: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Expected {
    pub ixs: Vec<ExpectedIx>,
    pub limits: Limits,
}

/// Signer and writable flags per address: the union over every use in the template, with the
/// payer forced to a writable signer. The message table can hold only this union.
pub type KeyFlags = BTreeMap<Key, (bool, bool)>;

impl Expected {
    pub fn key_flags(&self, payer: &Key) -> KeyFlags {
        let mut flags = KeyFlags::new();
        for ix in &self.ixs {
            flags.entry(ix.program).or_default();
            for a in &ix.accounts {
                let entry = flags.entry(a.key).or_default();
                entry.0 |= a.signer;
                entry.1 |= a.writable;
            }
        }
        flags.insert(*payer, (true, true));
        flags
    }
}

/// The limits that the template fixes for an intent.
pub fn limits(intent: &Intent) -> Limits {
    let (cu_cap, cu_floor, loaded_min) = match intent {
        Intent::CreateNonce { .. } => (CU_CAP_SYSTEM, CU_FLOOR_CREATE_NONCE, LOADED_MIN_SYSTEM),
        Intent::Cancel { .. } => (CU_CAP_SYSTEM, CU_FLOOR_CANCEL, LOADED_MIN_SYSTEM),
        Intent::Register { .. } => (CU_CAP_REGISTER, CU_FLOOR_REGISTER, LOADED_MIN_REGISTER),
        Intent::Shield { .. } => (CU_CAP_SHIELD, CU_FLOOR_SHIELD, LOADED_MIN_POOL),
        Intent::Transfer { .. } | Intent::Withdrawal { .. } => {
            (CU_CAP_TRANSACT, CU_FLOOR_TRANSACT, LOADED_MIN_POOL)
        }
    };
    Limits {
        cu_cap,
        cu_floor,
        loaded_min,
        priority_max: PRIORITY_MAX,
    }
}

fn system_data(tag: u32, rest: &[&[u8]]) -> Vec<u8> {
    let mut data = tag.to_le_bytes().to_vec();
    rest.iter().for_each(|part| data.extend_from_slice(part));
    data
}

fn ix(program: Key, accounts: Vec<Acct>, data: Data) -> ExpectedIx {
    ExpectedIx {
        program,
        accounts,
        data,
    }
}

fn advance(pins: &Pins) -> ExpectedIx {
    let accounts = vec![
        acct(pins.nonce_account, false, true),
        acct(RECENT_BLOCKHASHES, false, false),
        acct(pins.group, true, false),
    ];
    let data = Data::Exact(system_data(SYS_ADVANCE_NONCE, &[]));
    ix(SYSTEM_PROGRAM, accounts, data)
}

/// The number of signatures of an intent: the payer and the group key, or the payer alone for
/// Shield (Add SOL), which the group does not sign.
pub fn signer_count(intent: &Intent) -> u8 {
    match intent {
        Intent::Shield { .. } => 1,
        _ => 2,
    }
}

fn create_nonce(pins: &Pins) -> Vec<ExpectedIx> {
    let seed_len = (NONCE_SEED.len() as u64).to_le_bytes();
    let create = system_data(
        SYS_CREATE_WITH_SEED,
        &[
            &pins.group,
            &seed_len,
            NONCE_SEED,
            &pins.nonce_rent.to_le_bytes(),
            &NONCE_SPACE.to_le_bytes(),
            &SYSTEM_PROGRAM,
        ],
    );
    let init = system_data(SYS_INIT_NONCE, &[&pins.group]);
    vec![
        ix(
            SYSTEM_PROGRAM,
            // The payer funds the account, and the group key signs as the base of its seed.
            vec![
                acct(pins.payer, true, true),
                acct(pins.nonce_account, false, true),
                acct(pins.group, true, false),
            ],
            Data::Exact(create),
        ),
        ix(
            SYSTEM_PROGRAM,
            vec![
                acct(pins.nonce_account, false, true),
                acct(RECENT_BLOCKHASHES, false, false),
                acct(RENT_SYSVAR, false, false),
            ],
            Data::Exact(init),
        ),
    ]
}

fn register(pins: &Pins, nullifier_pk: Key, viewing_pk: [u8; 33]) -> ExpectedIx {
    let accounts = vec![
        acct(pins.user_record, false, true),
        acct(pins.group, true, false),
        acct(pins.payer, true, true),
        acct(SYSTEM_PROGRAM, false, false),
    ];
    let data = Register {
        owner_p256: None,
        nullifier_pk,
        viewing_pk,
    }
    .write();
    ix(pins.registry, accounts, Data::Fields(data))
}

fn shield(pins: &Pins, amount: u64) -> Result<ExpectedIx, String> {
    let accounts = vec![
        acct(pins.output_tree, false, true),
        acct(pins.payer, true, true),
        acct(pins.pool, false, false),
        acct(SYSTEM_PROGRAM, false, false),
        acct(pins.sol_interface, false, true),
    ];
    let entry = Entry {
        asset_index: 0,
        view_tag: pins.group,
        owner: pins.group_owner_hash,
        amount,
        memo: None,
    };
    let data = Deposit {
        assets: vec![AssetKind::Sol],
        entries: vec![entry],
    }
    .write()?;
    Ok(ix(pins.pool, accounts, Data::Fields(data)))
}

fn transact(intent: &Intent, pins: &Pins, tx: &Transact) -> Result<ExpectedIx, String> {
    let mut accounts = vec![
        acct(pins.payer, true, true),
        acct(pins.output_tree, false, true),
        acct(pins.pool, false, false),
        acct(SYSTEM_PROGRAM, false, false),
        acct(pins.input_tree, false, true),
    ];
    let mut seen = BTreeSet::new();
    for input in &tx.inputs {
        if !seen.insert(input.nullifier) {
            return Err("the same nullifier is spent twice".to_string());
        }
        accounts.push(acct(
            pins.nullifier_pda(&pins.input_tree, &input.nullifier)?,
            false,
            true,
        ));
    }
    // The owner signer sits after the nullifier accounts and before the settlement accounts
    // (programs/shielded-pool/src/instructions/transact/account.rs). The proof binds it.
    accounts.push(acct(pins.group, true, false));
    if let Intent::Withdrawal { recipient, .. } = intent {
        accounts.push(acct(pins.sol_interface, false, true));
        accounts.push(acct(*recipient, false, true));
    }
    Ok(ix(pins.pool, accounts, Data::Variable))
}

/// The legs that the intent requires.
pub fn expected_legs(intent: &Intent) -> Vec<Leg> {
    match intent {
        Intent::Withdrawal { amount, .. } => vec![Leg::SolWithdrawal(*amount)],
        _ => Vec::new(),
    }
}

/// The instruction list and limits of an intent. `tx` is required for Transfer and Withdrawal:
/// the nullifier PDAs of the accounts derive from its inputs.
pub fn expected(intent: &Intent, pins: &Pins, tx: Option<&Transact>) -> Result<Expected, String> {
    let mut ixs = Vec::new();
    if intent.uses_nonce() {
        ixs.push(advance(pins));
    }
    match intent {
        Intent::CreateNonce { .. } => ixs.extend(create_nonce(pins)),
        Intent::Register {
            nullifier_pk,
            viewing_pk,
            ..
        } => {
            ixs.push(register(pins, *nullifier_pk, *viewing_pk));
        }
        Intent::Shield { amount, .. } => ixs.push(shield(pins, *amount)?),
        Intent::Transfer { .. } | Intent::Withdrawal { .. } => {
            let tx = tx.ok_or("a spend needs its transact data")?;
            ixs.push(transact(intent, pins, tx)?);
        }
        Intent::Cancel { .. } => {}
    }
    Ok(Expected {
        ixs,
        limits: limits(intent),
    })
}

/// Orders the table: the payer, then writable signers, readonly signers, writable non-signers,
/// readonly non-signers, each group by address bytes (the order of `solana-message`).
pub fn arrange(flags: &KeyFlags, payer: &Key) -> Result<(Vec<Key>, [u8; 3]), String> {
    let pick = |signer: bool, writable: bool| -> Vec<Key> {
        let want = (signer, writable);
        flags
            .iter()
            .filter(|(k, f)| **f == want && *k != payer)
            .map(|(k, _)| *k)
            .collect()
    };
    let (signed_rw, signed_ro) = (pick(true, true), pick(true, false));
    let (plain_rw, plain_ro) = (pick(false, true), pick(false, false));
    let count = |n: usize| u8::try_from(n).map_err(|_| "too many accounts".to_string());
    let header = [
        count(1 + signed_rw.len() + signed_ro.len())?,
        count(signed_ro.len())?,
        count(plain_ro.len())?,
    ];
    let keys = std::iter::once(*payer)
        .chain(signed_rw)
        .chain(signed_ro)
        .chain(plain_rw)
        .chain(plain_ro)
        .collect();
    Ok((keys, header))
}

/// Compiles an expected list into a v1 message. `tx_data` fills the instruction that has no
/// fixed data.
pub fn build(
    exp: &Expected,
    payer: &Key,
    lifetime: Key,
    config: Config,
    tx_data: Option<Vec<u8>>,
) -> Result<Message, String> {
    let (keys, header) = arrange(&exp.key_flags(payer), payer)?;
    let index = |key: &Key| -> Result<u8, String> {
        let at = keys
            .iter()
            .position(|k| k == key)
            .ok_or("compile: key missing")?;
        u8::try_from(at).map_err(|_| "compile: index overflow".to_string())
    };
    let mut ixs = Vec::new();
    for e in &exp.ixs {
        let accounts = e
            .accounts
            .iter()
            .map(|a| index(&a.key))
            .collect::<Result<_, _>>()?;
        let data = match (&e.data, &tx_data) {
            (Data::Exact(data) | Data::Fields(data), _) | (Data::Variable, Some(data)) => {
                data.clone()
            }
            (Data::Variable, None) => return Err("compile: transact data missing".to_string()),
        };
        ixs.push(Ix {
            program: index(&e.program)?,
            accounts,
            data,
        });
    }
    Ok(Message {
        header,
        config,
        lifetime,
        keys,
        ixs,
    })
}

/// The template config of an intent: no priority fee (fee 0), the compute unit cap, the loaded
/// limit maximum. This is the mask 0b1100 that the P5 and P6 transactions used.
pub fn template_config(limits: &Limits) -> Config {
    Config {
        priority_fee: None,
        compute_units: Some(limits.cu_cap),
        loaded_limit: Some(LOADED_MAX),
        heap_size: None,
    }
}

/// Compiles the message of an intent with the template limits. The group key never pays.
pub fn compile(intent: &Intent, pins: &Pins, tx: Option<&Transact>) -> Result<Message, String> {
    if pins.payer == pins.group {
        return Err("the fee payer is the group key".to_string());
    }
    let exp = expected(intent, pins, tx)?;
    let config = template_config(&exp.limits);
    let tx_data = tx.map(Transact::write).transpose()?;
    build(&exp, &pins.payer, intent.lifetime(), config, tx_data)
}
