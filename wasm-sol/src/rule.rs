//! The rule that refuses a message. Every refusal names exactly one rule. The order of the
//! enum is the order in which the checker evaluates the rules.

/// The part of the message that a rule guards. Used by the template-fit table.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Group {
    Bytes,
    Parse,
    Config,
    Signers,
    Instructions,
    Accounts,
    Lifetime,
    Register,
    Shield,
    Expiry,
    Transact,
    Pins,
    Plan,
    Outputs,
    Legs,
    Ciphertexts,
    Program,
    Policy,
}

/// The identifier, the guarded group and a one-line statement of a rule.
#[derive(Clone, Copy, Debug)]
pub struct Info {
    pub rule: Rule,
    pub id: &'static str,
    pub group: Group,
    pub text: &'static str,
}

macro_rules! rules {
    ($($name:ident, $id:literal, $group:ident, $text:literal;)*) => {
        /// A rule of the message check (ZOLANA.md section 5).
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
        pub enum Rule { $($name),* }

        /// Every rule, in evaluation order. The position equals `Rule as usize`.
        pub const INFO: &[Info] = &[
            $(Info { rule: Rule::$name, id: $id, group: Group::$group, text: $text }),*
        ];
    };
}

rules! {
    OffchainPrefix, "offchain-prefix", Bytes,
        "bytes start with 0xFF \"solana offchain\": an off-chain message is never signed";
    DerivePayload, "derive-payload", Bytes,
        "bytes start with \"TSPP/derive/\": signing them would derive the shielded keys";
    Version, "version-byte", Parse, "the first byte is 0x81 (v1)";
    Truncated, "truncated", Parse, "the message ends inside a field";
    TrailingBytes, "trailing-bytes", Parse, "no byte follows the last instruction";
    ConfigUnknownBits, "config-unknown-bits", Parse, "config mask bits 5 to 31 are clear";
    ConfigPriorityBits, "config-priority-bits", Parse,
        "priority bits 0 and 1 are both set or both clear";
    Structure, "structure", Parse, "counts, indices, header and size follow SIMD-0385";
    Rewrite, "rewrite-mismatch", Parse, "writing the parsed message gives the input bytes";
    ConfigLoadedBit, "config-loaded-bit", Config, "config bit 3 (loaded accounts limit) is set";
    ConfigNotTemplate, "config-not-template", Config,
        "the config mask is 0b1100 (no priority fee) or 0b1111 (a priority fee)";
    PriorityFeeOverMax, "priority-fee-over-max", Config, "the priority fee is at most the maximum";
    ComputeUnitsOverCap, "compute-units-over-cap", Config,
        "the compute unit limit is at most the cap of the intent";
    ComputeUnitsUnderFloor, "compute-units-under-floor", Config,
        "the compute unit limit is at least the largest recorded consumption of the intent";
    LoadedLimitRange, "loaded-limit-range", Config,
        "the loaded accounts limit is between the safe minimum and 64 MiB";
    FeePayerNotPayer, "fee-payer-not-payer", Signers,
        "the first account (the fee payer) is the payer of the proposal";
    PayerIsGroup, "payer-is-group", Signers, "the group key is never the fee payer";
    SignerSet, "signer-set", Signers,
        "the signers are the payer and the group key, and the payer alone for Shield";
    ComputeBudget, "compute-budget", Instructions, "no ComputeBudget instruction";
    DepositOutsideShield, "deposit-outside-shield", Instructions,
        "a pool deposit (tag 15) appears only in the Shield intent";
    MergeTransact, "merge-transact", Instructions, "no pool merge_transact (tag 17)";
    UpdateKeys, "update-keys", Instructions, "no registry update_keys";
    SetMergingEnabled, "set-merging-enabled", Instructions, "no registry set_merging_enabled";
    WithdrawNonceAccount, "withdraw-nonce-account", Instructions, "no WithdrawNonceAccount";
    AuthorizeNonceAccount, "authorize-nonce-account", Instructions, "no AuthorizeNonceAccount";
    SystemTransfer, "system-transfer", Instructions, "no System Transfer";
    GroupDebit, "group-debit", Instructions,
        "no System instruction takes lamports from the group key: it never funds a Transfer, \
         CreateAccount, CreateAccountWithSeed or TransferWithSeed";
    ProgramNotAllowed, "program-not-allowed", Instructions,
        "every program is the System program, the pool, the registry, the approvals program \
         (create in Propose, execute in Execute) or the Ed25519 program (in Execute)";
    InstructionNotAllowed, "instruction-not-allowed", Instructions,
        "every instruction tag is on the allow list of its program";
    TransactParse, "transact-parse", Transact, "the transact data parses";
    CircuitNotDefault, "circuit-not-default", Transact,
        "the circuit is the default ring, no cache, three public slots";
    InstructionCount, "instruction-count", Instructions,
        "the instruction count equals the template of the intent";
    InstructionMismatch, "instruction-mismatch", Instructions,
        "the program of each instruction equals the template at that position";
    InstructionData, "instruction-data", Instructions,
        "the data of each fixed instruction equals the template";
    AccountCount, "account-count", Accounts,
        "each instruction has the number of accounts of the template";
    AccountAddress, "account-address", Accounts,
        "each instruction account is the pinned or derived address of the template";
    TransactRewrite, "transact-rewrite", Transact, "writing the parsed transact gives its bytes";
    ExpiryZero, "expiry-zero", Expiry, "expiry_unix_ts is not 0";
    ExpiryMax, "expiry-max", Expiry, "expiry_unix_ts is not u64::MAX";
    ExpiryNotIntent, "expiry-not-intent", Expiry, "expiry_unix_ts equals the intent expiry";
    ExpiryWindow, "expiry-window", Expiry,
        "the expiry is after the clock time and at most 24 h plus 1 h of skew ahead";
    DataHashPresent, "data-hash-present", Transact, "data_hash and ring_data_hash are None";
    MessagesPresent, "messages-present", Transact, "the transact carries no loose messages";
    LegMismatch, "leg-mismatch", Transact, "the legs equal the legs of the intent";
    InputCount, "input-count", Transact, "the input count equals the intent";
    OutputCount, "output-count", Transact, "the output count equals the intent";
    TreeContext, "tree-context", Transact, "one tree context, and every input uses tree 0";
    DuplicateNullifier, "duplicate-nullifier", Transact, "no nullifier appears twice";
    CircuitCounts, "circuit-counts", Transact,
        "the circuit input and output counts equal the counts of the instruction";
    UnsupportedShape, "unsupported-shape", Transact,
        "the (inputs, outputs) of the circuit is in SPP_SUPPORTED_SHAPES";
    OutputOwnerTag, "output-owner-tag", Transact,
        "each output owner tag is the group key or the payee tag of the intent";
    AccountSet, "account-set", Accounts, "the account table holds exactly the template accounts";
    AccountFlags, "account-flags", Accounts, "signer and writable flags equal the template";
    RegisterLength, "register-length", Register, "register data is 67 bytes with tag 0";
    RegisterOwnerP256, "register-owner-p256", Register, "owner_p256 is None";
    RegisterNullifierPk, "register-nullifier-pk", Register,
        "nullifier_pk equals the intent, the pinned key and the key of the device secret";
    RegisterViewingPk, "register-viewing-pk", Register,
        "viewing_pk equals the intent, the pinned key and the key of the device secret";
    ShieldShape, "shield-shape", Shield,
        "one SOL asset, one entry, asset index 0, no memo";
    ShieldOwner, "shield-owner", Shield, "the deposit owner is the group owner_hash";
    ShieldViewTag, "shield-view-tag", Shield, "the deposit view tag is the group key";
    ShieldAmount, "shield-amount", Shield, "the deposit amount equals the intent";
    Lifetime, "lifetime", Lifetime,
        "the lifetime equals the nonce value (or the blockhash) of the intent";
    GroupOwnerHash, "group-owner-hash", Pins,
        "the owner_hash of the pins equals Poseidon over the pinned group key and nullifier_pk";
    GroupNullifierPk, "group-nullifier-pk", Pins,
        "the nullifier secret of the device derives the pinned nullifier_pk";
    GroupViewingPk, "group-viewing-pk", Pins,
        "the viewing scalar of the device derives the pinned viewing_pk";
    SpendUnread, "spend-unread", Plan,
        "a spend whose transact data was not read is refused, never skipped";
    PlanInvalid, "plan-invalid", Plan,
        "every key and field of the plan and the snapshot is a valid point or field element";
    PayeeAddress, "payee-address", Plan,
        "the payee address of a Transfer has an Ed25519 or PDA signing key";
    PlanOutputCount, "plan-output-count", Plan, "the plan has one entry per output";
    PayeeOutputs, "payee-outputs", Plan,
        "a Transfer has one payee output with the asset and amount of the intent; \
         a Withdrawal has none";
    DummyNotEmpty, "dummy-not-empty", Plan, "a dummy output has asset 0 and amount 0";
    DummiesLast, "dummies-last", Plan,
        "no real output follows a dummy output (AssertDummiesLast, slot_order.go)";
    OutputHash, "output-hash", Outputs,
        "each utxo_hash equals Poseidon over the approved plaintext of its slot";
    OutputBlinding, "output-blinding", Outputs,
        "each blinding, dummies too, is TXOB over the first nullifier, TXOS of the root seed \
         and the slot";
    SnapshotInputs, "snapshot-inputs", Legs,
        "the instruction spends exactly the inputs of the device snapshot";
    SnapshotDuplicate, "snapshot-duplicate", Legs, "the snapshot inputs have distinct nullifiers";
    NullifierMismatch, "nullifier-mismatch", Legs,
        "each nullifier equals the nullifier that the snapshot computes for its input";
    Conservation, "conservation", Legs,
        "per asset, inputs plus deposit legs equal outputs plus withdrawal legs";
    LegAsset, "leg-asset", Legs, "every leg is a SOL leg: the asset of an SPL leg is unknown";
    TreeFeeOverCap, "tree-fee-over-cap", Legs,
        "the insertion fee per nullifier of the tree is at most the cap";
    TxViewingPk, "tx-viewing-pk", Ciphertexts,
        "tx_viewing_pk equals the key derived from tx_viewing_secret and the first nullifier";
    AssetUnknown, "asset-unknown", Ciphertexts, "the pinned table has the asset id of every mint";
    OutputTagRole, "output-tag-role", Ciphertexts,
        "each owner tag is the group key or the payee tag of its slot; a dummy names the group \
         key (the owner signer) or the owner of a real output";
    Ciphertext, "ciphertext", Ciphertexts,
        "each output data equals the recompute; a dummy has the length of a real slot";
    SaltZero, "salt-zero", Ciphertexts, "the ciphertext salt is not all zero";
    SaltReused, "salt-reused", Ciphertexts,
        "no earlier proposal of the device has the same first nullifier and salt";
    PrivateTxHash, "private-tx-hash", Program,
        "private_tx_hash equals the recompute from the snapshot inputs, the plan outputs and the \
         blinding seed";
    BodyCommitment, "body-commitment", Program,
        "the commitment of the proposal is the commitment that the device computes";
    BodyGroup, "body-group", Program, "the proposal body names the group key";
    BodyExpiry, "body-expiry", Program, "the body expiry equals the pool expiry of the payment";
    RentRecipient, "rent-recipient", Program,
        "the rent recipient is the fee key of the proposing seat, never an address of the program";
    AbortAuthorities, "abort-authorities", Program,
        "the only abort authority is the fee key of the proposing seat";
    AccountOwner, "account-owner", Program,
        "the proposal account exists and the approvals program owns it";
    AccountData, "account-data", Program,
        "the proposal account holds kind 1, the canonical bump and the body of the payment";
    BodyOnce, "body-once", Program,
        "no earlier approval of the device has this commitment with another body";
    ExecuteInputs, "execute-inputs", Program,
        "a payment spends at most 18 inputs: one execute of the program carries no more";
    ExecuteApproval, "execute-approval", Program,
        "the approval verifies under the group key over the digest of the body of the transact \
         data";
    MigrationPayee, "migration-payee", Policy,
        "a nonce payment pays its inputs whole to the program address of the group, no change";
    IntentRetired, "intent-retired", Policy,
        "no register, withdrawal or nonce cancel, and the group key signs no program message";
}

impl Rule {
    #[allow(clippy::indexing_slicing)] // `rule_table_matches_enum` pins the alignment
    pub fn info(self) -> &'static Info {
        &INFO[self as usize]
    }

    pub fn id(self) -> &'static str {
        self.info().id
    }
}

/// One failed rule with the facts that failed it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Violation {
    pub rule: Rule,
    pub detail: String,
}

impl Violation {
    pub fn new(rule: Rule, detail: impl Into<String>) -> Self {
        Self {
            rule,
            detail: detail.into(),
        }
    }
}
