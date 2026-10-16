//! LiteSVM rig for the Zigs approvals program (ZOLANA.md 7.2).
//!
//! The rig runs the SBF build of the program (`../target/deploy`, made by `../build.sh`) and a
//! stub pool at the pool's program id. It does not link the program crate: the approval digest,
//! the commitment and the addresses come from the layouts of 7.2, so a test fails when the
//! program and the design disagree. Every successful transaction goes through
//! [`check_cpis`]: the program may call only the System Program and the pool's `transact`.

use std::path::PathBuf;

use litesvm::{
    types::{FailedTransactionMetadata, TransactionMetadata},
    LiteSVM,
};
use sha2::{Digest, Sha256};
use solana_clock::Clock;
use solana_ed25519_program::new_ed25519_instruction_with_signature;
use solana_instruction::{error::InstructionError, AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction::Transaction;
use solana_transaction_error::TransactionError;
use zolana_interface::instruction::{
    CircuitId, InputUtxo, OwnerTag, TransactIxData, TransactOutput, TransactProof, TreeContext,
};

/// The Devnet program id, so that the approval of the Devnet vector verifies.
pub const PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("5PHZEHBMaYbFL9SFmMyP8kUayh3TFEyq2dvEYY3UGjkL");
pub const POOL_ID: Pubkey = Pubkey::from_str_const("sppU489D7A4U1exNo1oeMGZtLEofq3a6o2fR7UeoWB6");
pub const SYSTEM_ID: Pubkey = Pubkey::from_str_const("11111111111111111111111111111111");
pub const ED25519_ID: Pubkey =
    Pubkey::from_str_const("Ed25519SigVerify111111111111111111111111111");
pub const INSTRUCTIONS_SYSVAR: Pubkey =
    Pubkey::from_str_const("Sysvar1nstructions1111111111111111111111111");
const DEVNET_GENESIS: Pubkey =
    Pubkey::from_str_const("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
pub const DOMAIN: &[u8] = b"Zigs_SolApproval_v1";
pub const TRANSACT: u8 = 16;
/// The clock of a new rig, in Unix seconds.
pub const NOW: u64 = 1_800_000_000;
pub const DAY: u64 = 86_400;
/// The `private_tx_hash` of [`sample_transact`]. No other field holds these bytes.
pub const PRIVATE_TX_HASH: [u8; 32] = [0x5a; 32];
const STUB: &str = "target/deploy/stub_pool.so";
pub const OUTPUT_TREE: Pubkey = Pubkey::new_from_array([0x70; 32]);

/// The pool's SOL interface PDA, `["sol_interface", 0]`: the first account of each SOL withdrawal's
/// settlement group.
pub fn sol_interface() -> Pubkey {
    Pubkey::find_program_address(&[b"sol_interface", &[0]], &POOL_ID).0
}

/// The public recipient of withdrawal leg `leg` in the tests.
pub fn recipient(leg: usize) -> Pubkey {
    Pubkey::new_from_array([0xa0 + u8::try_from(leg).expect("leg"); 32])
}

/// The settlement accounts that the pool hashes for each leg: (SOL interface, recipient).
pub fn settlements(transact: &TransactIxData) -> Vec<(Pubkey, Pubkey)> {
    (0..transact.interface_transfers.len())
        .map(|leg| (sol_interface(), recipient(leg)))
        .collect()
}

/// The custom error codes of the program (`src/error.rs`) and of the pool CPI helper.
pub mod code {
    pub const BAD_PROPOSAL_DATA: u32 = 6000;
    pub const DUPLICATE_ABORT_AUTHORITY: u32 = 6001;
    pub const TOO_MANY_ABORT_AUTHORITIES: u32 = 6002;
    pub const EXPIRY_NOT_IN_FUTURE: u32 = 6003;
    pub const BAD_PROPOSAL_ADDRESS: u32 = 6005;
    pub const NOT_A_PROPOSAL: u32 = 6006;
    pub const BAD_CANCELLATION_ADDRESS: u32 = 6007;
    pub const CANCELLED: u32 = 6008;
    pub const EXPIRED: u32 = 6009;
    pub const RENT_RECIPIENT_MISMATCH: u32 = 6010;
    pub const MISSING_APPROVAL: u32 = 6011;
    pub const BAD_APPROVAL: u32 = 6012;
    pub const UNSUPPORTED_TRANSACT: u32 = 6013;
    pub const COMMITMENT_MISMATCH: u32 = 6014;
    pub const BAD_OWNER_ADDRESS: u32 = 6015;
    pub const BAD_SPP_ACCOUNTS: u32 = 6016;
    pub const NOT_ABORT_AUTHORITY: u32 = 6017;
    pub const NOT_EXPIRED: u32 = 6019;
    pub const NOT_A_CANCELLATION: u32 = 6020;
    pub const RENT_RECIPIENT_NOT_ALLOWED: u32 = 6021;
    pub const INVALID_SPP_PROGRAM: u32 = 14101;
}

pub type TxResult = Result<TransactionMetadata, Box<FailedTransactionMetadata>>;

/// A proposal body: `commitment || group key || expiry (u64 LE) || rent recipient || count ||
/// abort authorities`.
#[derive(Clone, Debug)]
pub struct Body {
    pub commitment: [u8; 32],
    pub group: Pubkey,
    pub expiry: u64,
    pub rent_recipient: Pubkey,
    pub authorities: Vec<Pubkey>,
}

impl Body {
    pub fn bytes(&self) -> Vec<u8> {
        let mut out = self.commitment.to_vec();
        out.extend(self.group.to_bytes());
        out.extend(self.expiry.to_le_bytes());
        out.extend(self.rent_recipient.to_bytes());
        out.push(u8::try_from(self.authorities.len()).expect("authority count"));
        self.authorities
            .iter()
            .for_each(|key| out.extend(key.to_bytes()));
        out
    }

    pub fn proposal(&self) -> Pubkey {
        self.proposal_and_bump().0
    }

    /// `["proposed_transaction", group key, commitment, SHA-256(body)]`.
    pub fn proposal_and_bump(&self) -> (Pubkey, u8) {
        let body_hash: [u8; 32] = Sha256::digest(self.bytes()).into();
        Pubkey::find_program_address(
            &[
                b"proposed_transaction",
                self.group.as_ref(),
                &self.commitment,
                &body_hash,
            ],
            &PROGRAM_ID,
        )
    }

    pub fn owner(&self) -> Pubkey {
        owner_address(&self.group)
    }

    pub fn cancellation(&self) -> Pubkey {
        cancellation_address(&self.proposal())
    }

    pub fn digest(&self) -> [u8; 32] {
        approval_digest(&self.proposal(), &self.bytes())
    }
}

pub fn owner_address(group: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"multisig", group.as_ref()], &PROGRAM_ID).0
}

pub fn cancellation_address(proposal: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"cancelled_transaction", proposal.as_ref()], &PROGRAM_ID).0
}

/// `SHA-256(domain || Devnet genesis hash || program id || proposal address || body)`.
pub fn approval_digest(proposal: &Pubkey, body: &[u8]) -> [u8; 32] {
    digest_with(DOMAIN, &DEVNET_GENESIS, &PROGRAM_ID, proposal, body)
}

/// The digest with every part given, to sign digests that differ in one part.
pub fn digest_with(
    domain: &[u8],
    cluster: &Pubkey,
    program: &Pubkey,
    proposal: &Pubkey,
    body: &[u8],
) -> [u8; 32] {
    Sha256::new()
        .chain_update(domain)
        .chain_update(cluster)
        .chain_update(program)
        .chain_update(proposal)
        .chain_update(body)
        .finalize()
        .into()
}

/// The Ed25519 precompile instruction of the official builder, signed by `signer`.
pub fn approval_ix(signer: &Keypair, digest: &[u8; 32]) -> Instruction {
    let signature: [u8; 64] = signer.sign_message(digest).into();
    new_ed25519_instruction_with_signature(digest, &signature, &signer.pubkey().to_bytes())
}

/// A default-ring private transfer with one input, a payee and a change output.
pub fn sample_transact() -> TransactIxData {
    let output = |hash: u8, owner: u8| TransactOutput {
        utxo_hash: [hash; 32],
        owner_tag: OwnerTag::Inline([owner; 32]),
        data: Some(vec![hash; 89]),
    };
    TransactIxData {
        expiry_unix_ts: NOW + 3_600,
        tx_viewing_pk: [2; 33],
        salt: [3; 16],
        interface_transfers: Vec::new(),
        data_hash: None,
        ring_data_hash: None,
        outputs: vec![output(4, 5), output(6, 7)],
        messages: Vec::new(),
        private_tx_hash: PRIVATE_TX_HASH,
        circuit: CircuitId::ConfidentialEddsa(1, 2, 1),
        proof: TransactProof::zeroed(),
        inputs: vec![InputUtxo {
            nullifier_hash: [0x11; 32],
            tree_index: 0,
        }],
        tree_contexts: vec![TreeContext {
            utxo_tree_root_index: 7,
            nullifier_tree_root_index: 8,
        }],
    }
}

pub fn serialize(transact: &TransactIxData) -> Vec<u8> {
    transact.serialize().expect("serialize transact")
}

fn u16_at(data: &[u8], at: usize) -> usize {
    usize::from(u16::from_le_bytes([data[at], data[at + 1]]))
}

/// Length of one serialized output: hash, owner tag (u8 tag, then 32 bytes inline or a u8
/// index), ciphertext (u8 option tag, then u16 length and bytes).
fn output_len(data: &[u8], start: usize) -> usize {
    let mut at = start + 32;
    at += if data[at] == 0 { 33 } else { 2 };
    at += if data[at] == 1 {
        3 + u16_at(data, at + 1)
    } else {
        1
    };
    at - start
}

/// Length of one serialized interface transfer: a u8 tag, the u64 amount, and for an SPL leg
/// (tags 2 and 3) the u8 bump of the interface PDA.
fn leg_len(data: &[u8], start: usize) -> usize {
    if data[start] >= 2 {
        10
    } else {
        9
    }
}

/// The length of the external-data prefix: the bytes before `private_tx_hash`, read with the
/// field layout of the pool's `TransactIxData`.
pub fn external_data_prefix_len(data: &[u8]) -> usize {
    let mut at = 8 + 33 + 16;
    let legs = data[at];
    at += 1;
    for _ in 0..legs {
        at += leg_len(data, at);
    }
    for _option in 0..2 {
        at += if data[at] == 1 { 33 } else { 1 };
    }
    let outputs = data[at];
    at += 1;
    for _ in 0..outputs {
        at += output_len(data, at);
    }
    let messages = data[at];
    at += 1;
    for _ in 0..messages {
        at += 32 + 2 + u16_at(data, at + 32);
    }
    at
}

/// `SHA-256(private_tx_hash || external_data_hash)`, with the external-data hash of the pool:
/// SHA-256 of the `transact` tag, the prefix and the two settlement addresses of each leg, with
/// the first byte cleared (Sha256BE). Only inline owner tags.
pub fn commitment(data: &[u8], settlements: &[(Pubkey, Pubkey)]) -> [u8; 32] {
    let at = external_data_prefix_len(data);
    let mut hasher = Sha256::new()
        .chain_update([TRANSACT])
        .chain_update(&data[..at]);
    for (asset, user) in settlements {
        hasher.update(asset);
        hasher.update(user);
    }
    let mut external: [u8; 32] = hasher.finalize().into();
    external[0] = 0;
    Sha256::new()
        .chain_update(&data[at..at + 32])
        .chain_update(external)
        .finalize()
        .into()
}

pub fn create_ix(payer: &Pubkey, body: &Body) -> Instruction {
    let mut data = vec![0];
    data.extend(body.bytes());
    Instruction::new_with_bytes(
        PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(body.proposal(), false),
            AccountMeta::new_readonly(SYSTEM_ID, false),
        ],
    )
}

/// The accounts of `execute`: its six own accounts, then the pool's `transact` layout (payer,
/// output tree, pool, system, one tree per context, one nullifier PDA per input, the owner, then
/// the SOL interface and the recipient of each withdrawal, both writable).
pub fn execute_metas(
    payer: &Pubkey,
    body: &Body,
    (trees, inputs): (u8, u8),
    settlements: &[(Pubkey, Pubkey)],
) -> Vec<AccountMeta> {
    let mut metas = vec![
        AccountMeta::new(*payer, true),
        AccountMeta::new(body.proposal(), false),
        AccountMeta::new_readonly(body.owner(), false),
        AccountMeta::new_readonly(body.cancellation(), false),
        AccountMeta::new(body.rent_recipient, false),
        AccountMeta::new_readonly(INSTRUCTIONS_SYSVAR, false),
        AccountMeta::new(*payer, true),
        AccountMeta::new(OUTPUT_TREE, false),
        AccountMeta::new_readonly(POOL_ID, false),
        AccountMeta::new_readonly(SYSTEM_ID, false),
    ];
    metas.extend(
        (0..trees).map(|i| AccountMeta::new(Pubkey::new_from_array([0x80 + i; 32]), false)),
    );
    metas.extend(
        (0..inputs).map(|i| AccountMeta::new(Pubkey::new_from_array([0x90 + i; 32]), false)),
    );
    metas.push(AccountMeta::new_readonly(body.owner(), false));
    for (sol_interface, recipient) in settlements {
        metas.push(AccountMeta::new(*sol_interface, false));
        metas.push(AccountMeta::new(*recipient, false));
    }
    metas
}

/// The signer flags of the accounts that the stub pool received, one per account: the stub
/// returns them as its return data.
pub fn pool_signers(meta: &TransactionMetadata) -> Vec<bool> {
    assert_eq!(
        meta.return_data.program_id, POOL_ID,
        "the stub pool's return data"
    );
    meta.return_data
        .data
        .iter()
        .map(|flag| *flag == 1)
        .collect()
}

pub fn execute_ix(metas: Vec<AccountMeta>, transact: &[u8]) -> Instruction {
    let mut data = vec![1];
    data.extend_from_slice(transact);
    Instruction::new_with_bytes(PROGRAM_ID, &data, metas)
}

/// `cancel`: payer, proposal, cancellation, rent recipient, system, then the authority if any.
pub fn cancel_ix(payer: &Pubkey, body: &Body, authority: Option<AccountMeta>) -> Instruction {
    let mut metas = vec![
        AccountMeta::new(*payer, true),
        AccountMeta::new(body.proposal(), false),
        AccountMeta::new(body.cancellation(), false),
        AccountMeta::new(body.rent_recipient, false),
        AccountMeta::new_readonly(SYSTEM_ID, false),
    ];
    metas.extend(authority);
    Instruction::new_with_bytes(PROGRAM_ID, &[2], metas)
}

pub fn close_cancelled_ix(payer: &Pubkey, body: &Body) -> Instruction {
    Instruction::new_with_bytes(
        PROGRAM_ID,
        &[3],
        vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new_readonly(body.proposal(), false),
            AccountMeta::new(body.cancellation(), false),
            AccountMeta::new(body.rent_recipient, false),
        ],
    )
}

/// The program's folder: `..`, or `ZIGS_PROGRAM_DIR` (the mutation check of `mutants.sh`
/// points it at a changed copy). The tests read its ELF, its source and its lock file.
pub fn program_dir() -> PathBuf {
    std::env::var_os("ZIGS_PROGRAM_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."))
}

fn build_output(path: PathBuf) -> PathBuf {
    assert!(
        path.exists(),
        "missing {}; run `sh sol-program/build.sh test`",
        path.display()
    );
    path
}

/// System Program instructions that the program may call: CreateAccount, Assign, Transfer,
/// Allocate.
const ALLOWED_SYSTEM: [u32; 4] = [0, 1, 2, 8];

/// ZOLANA.md 7.2: the program calls only the System Program (account creation) and the pool's
/// `transact`; never `register`, `update_keys`, `set_merging_enabled`, `merge_transact` or
/// `deposit`.
pub fn allowed_call(program: &Pubkey, data: &[u8]) -> bool {
    let system_kind = data
        .first_chunk::<4>()
        .map(|kind| u32::from_le_bytes(*kind));
    let system = *program == SYSTEM_ID && system_kind.is_some_and(|k| ALLOWED_SYSTEM.contains(&k));
    let transact = *program == POOL_ID && data.first() == Some(&TRANSACT);
    system || transact
}

/// Checks every inner instruction of a transaction with [`allowed_call`]. The stub pool makes
/// no call, so every inner instruction is the program's.
pub fn check_cpis(keys: &[Pubkey], meta: &TransactionMetadata) {
    for inner in meta.inner_instructions.iter().flatten() {
        let program = keys[usize::from(inner.instruction.program_id_index)];
        let data = &inner.instruction.data;
        assert!(
            allowed_call(&program, data),
            "CPI outside the rules: {program} {data:?}"
        );
    }
}

/// The custom error code of a refused transaction.
#[track_caller]
pub fn refused_with(result: TxResult) -> u32 {
    let failure = result.expect_err("the transaction must fail");
    match failure.err {
        TransactionError::InstructionError(_, InstructionError::Custom(code)) => code,
        other => panic!("{other:?}; logs:\n{}", failure.meta.pretty_logs()),
    }
}

pub struct Rig {
    pub svm: LiteSVM,
    pub payer: Keypair,
    /// Stands for the FROST group key: the precompile sees one Ed25519 key.
    pub group: Keypair,
    pub authority: Keypair,
    pub rent_recipient: Pubkey,
}

impl Rig {
    pub fn new() -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program_from_file(
            PROGRAM_ID,
            build_output(program_dir().join("target/deploy/zigs_min_multisig.so")),
        )
        .expect("load the program");
        svm.add_program_from_file(
            POOL_ID,
            build_output(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(STUB)),
        )
        .expect("load the stub pool");
        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), 100_000_000_000)
            .expect("fund the payer");
        let mut rig = Self {
            svm,
            payer,
            group: Keypair::new(),
            authority: Keypair::new(),
            rent_recipient: Pubkey::new_unique(),
        };
        rig.set_time(NOW);
        rig
    }

    /// Deploys the stub at another address, where it accepts every instruction.
    pub fn deploy_any_program(&mut self) -> Pubkey {
        let id = Pubkey::new_unique();
        self.svm
            .add_program_from_file(
                id,
                build_output(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(STUB)),
            )
            .expect("load the stub");
        id
    }

    pub fn set_time(&mut self, unix: u64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp = i64::try_from(unix).expect("time");
        self.svm.set_sysvar(&clock);
    }

    /// A body for `transact` (with the recipients of [`settlements`]), expiring in one day, with
    /// one abort authority.
    pub fn body(&self, transact: &TransactIxData) -> Body {
        self.body_with(commitment(&serialize(transact), &settlements(transact)))
    }

    pub fn body_with(&self, commitment: [u8; 32]) -> Body {
        Body {
            commitment,
            group: self.group.pubkey(),
            expiry: NOW + DAY,
            rent_recipient: self.rent_recipient,
            authorities: vec![self.authority.pubkey()],
        }
    }

    pub fn send(&mut self, instructions: &[Instruction], signers: &[&Keypair]) -> TxResult {
        self.svm.expire_blockhash();
        let mut all: Vec<&Keypair> = vec![&self.payer];
        all.extend_from_slice(signers);
        let tx = Transaction::new_signed_with_payer(
            instructions,
            Some(&self.payer.pubkey()),
            &all,
            self.svm.latest_blockhash(),
        );
        let keys = tx.message.account_keys.clone();
        let meta = self.svm.send_transaction(tx).map_err(Box::new)?;
        check_cpis(&keys, &meta);
        Ok(meta)
    }

    pub fn create(&mut self, body: &Body) -> TxResult {
        let ix = create_ix(&self.payer.pubkey(), body);
        self.send(&[ix], &[])
    }

    /// `execute` of `transact` with the group's approval right before it.
    pub fn execute(&mut self, body: &Body, transact: &TransactIxData) -> TxResult {
        let metas = self.metas(body, transact);
        let approval = approval_ix(&self.group, &body.digest());
        self.send(&[approval, execute_ix(metas, &serialize(transact))], &[])
    }

    pub fn metas(&self, body: &Body, transact: &TransactIxData) -> Vec<AccountMeta> {
        let trees = u8::try_from(transact.tree_contexts.len()).expect("trees");
        let inputs = u8::try_from(transact.inputs.len()).expect("inputs");
        let legs = settlements(transact);
        execute_metas(&self.payer.pubkey(), body, (trees, inputs), &legs)
    }

    pub fn lamports(&self, address: &Pubkey) -> u64 {
        self.svm
            .get_account(address)
            .map_or(0, |account| account.lamports)
    }

    pub fn exists(&self, address: &Pubkey) -> bool {
        self.lamports(address) > 0
    }
}

impl Default for Rig {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_sol_interface_is_the_pool_constant() {
        let constant = Pubkey::new_from_array(zolana_interface::SOL_INTERFACE);
        assert_eq!(sol_interface(), constant);
    }

    #[test]
    fn allowed_calls_are_transact_and_account_creation_only() {
        assert!(allowed_call(&POOL_ID, &[TRANSACT, 1, 2]));
        for kind in ALLOWED_SYSTEM {
            assert!(allowed_call(&SYSTEM_ID, &kind.to_le_bytes()));
        }
        for tag in (0..=u8::MAX).filter(|tag| *tag != TRANSACT) {
            assert!(!allowed_call(&POOL_ID, &[tag]), "pool tag {tag}");
        }
        for kind in (0..16).filter(|kind| !ALLOWED_SYSTEM.contains(kind)) {
            assert!(
                !allowed_call(&SYSTEM_ID, &u32::to_le_bytes(kind)),
                "system {kind}"
            );
        }
        assert!(!allowed_call(&Pubkey::new_unique(), &[TRANSACT]));
        assert!(!allowed_call(&POOL_ID, &[]));
    }
}
