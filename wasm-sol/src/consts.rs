//! Pinned constants. `tests/repo_pins.rs` compares each one with the Zolana repo at commit
//! 89640630 and with the base58 text of the repo.

/// A 32-byte account address.
pub type Key = [u8; 32];

/// The System program (`1111...`).
pub const SYSTEM_PROGRAM: Key = [0; 32];

/// `sppU489D7A4U1exNo1oeMGZtLEofq3a6o2fR7UeoWB6`, the shielded pool on Devnet.
pub const POOL_DEVNET: Key = [
    0x0d, 0x05, 0x1b, 0xdf, 0x51, 0x2e, 0xee, 0x26, 0x0b, 0x15, 0x4b, 0x75, 0x81, 0x2a, 0xad, 0xeb,
    0x80, 0xcf, 0xba, 0x36, 0x64, 0xd6, 0x39, 0x37, 0x58, 0xa6, 0x5c, 0x33, 0xf2, 0x35, 0xef, 0x3d,
];

/// `regyS5rkAcw2YzDJCmTwCTHs2s246FXxbmuRZ42u2PD`, the user registry on Devnet.
pub const REGISTRY_DEVNET: Key = [
    0x0c, 0xb8, 0x13, 0x2f, 0xb6, 0x1f, 0xb3, 0xdc, 0xb3, 0x6f, 0x32, 0x47, 0x19, 0x81, 0x3a, 0x6b,
    0x14, 0x28, 0x61, 0x7b, 0x1f, 0x6d, 0x61, 0x97, 0x3c, 0x28, 0x64, 0x6d, 0x69, 0xdb, 0x60, 0x3c,
];

/// `ComputeBudget111111111111111111111111111111`.
pub const COMPUTE_BUDGET_PROGRAM: Key = [
    0x03, 0x06, 0x46, 0x6f, 0xe5, 0x21, 0x17, 0x32, 0xff, 0xec, 0xad, 0xba, 0x72, 0xc3, 0x9b, 0xe7,
    0xbc, 0x8c, 0xe5, 0xbb, 0xc5, 0xf7, 0x12, 0x6b, 0x2c, 0x43, 0x9b, 0x3a, 0x40, 0x00, 0x00, 0x00,
];

/// `SysvarRecentB1ockHashes11111111111111111111`, listed by the nonce instructions.
pub const RECENT_BLOCKHASHES: Key = [
    0x06, 0xa7, 0xd5, 0x17, 0x19, 0x2c, 0x56, 0x8e, 0xe0, 0x8a, 0x84, 0x5f, 0x73, 0xd2, 0x97, 0x88,
    0xcf, 0x03, 0x5c, 0x31, 0x45, 0xb2, 0x1a, 0xb3, 0x44, 0xd8, 0x06, 0x2e, 0xa9, 0x40, 0x00, 0x00,
];

/// `SysvarRent111111111111111111111111111111111`, listed by `InitializeNonceAccount`.
pub const RENT_SYSVAR: Key = [
    0x06, 0xa7, 0xd5, 0x17, 0x19, 0x2c, 0x5c, 0x51, 0x21, 0x8c, 0xc9, 0x4c, 0x3d, 0x4a, 0xf1, 0x7f,
    0x58, 0xda, 0xee, 0x08, 0x9b, 0xa1, 0xfd, 0x44, 0xe3, 0xdb, 0xd9, 0x8a, 0x00, 0x00, 0x00, 0x00,
];

/// Pool instruction tags (`program-libs/event/src/tag.rs`).
pub const TAG_DEPOSIT: u8 = 15;
pub const TAG_TRANSACT: u8 = 16;
pub const TAG_MERGE_TRANSACT: u8 = 17;

/// Registry instruction discriminators (`program-libs/user-registry-interface`).
pub const REG_REGISTER: u8 = 0;
pub const REG_SET_MERGING_ENABLED: u8 = 1;
pub const REG_UPDATE_KEYS: u8 = 2;

/// System instruction tags: the variant order of `SystemInstruction` in
/// `solana-system-interface` 3.3.0, written as a `u32`.
pub const SYS_CREATE_ACCOUNT: u32 = 0;
pub const SYS_TRANSFER: u32 = 2;
pub const SYS_CREATE_WITH_SEED: u32 = 3;
pub const SYS_ADVANCE_NONCE: u32 = 4;
pub const SYS_WITHDRAW_NONCE: u32 = 5;
pub const SYS_INIT_NONCE: u32 = 6;
pub const SYS_AUTHORIZE_NONCE: u32 = 7;
pub const SYS_TRANSFER_WITH_SEED: u32 = 11;

/// Seed of the group's nonce account (the P2 spike value) and its size in bytes.
pub const NONCE_SEED: &[u8] = b"zigs-nonce-1";
pub const NONCE_SPACE: u64 = 80;

/// Program address seeds (`program-libs/interface/src/lib.rs`, `state/nullifier_pda.rs`,
/// `user-registry-interface/src/lib.rs`).
pub const SEED_TREE: &[u8] = b"tree";
pub const SEED_SOL_INTERFACE: &[u8] = b"sol_interface";
pub const SEED_SOL_INTERFACE_INDEX: &[u8] = &[0];
pub const SEED_NULLIFIER: &[u8] = b"nullifier";
pub const SEED_CPI_AUTHORITY: &[u8] = b"cpi_authority";
pub const SEED_USER_RECORD: &[u8] = b"zolana/registry/v0";

/// Public asset slots of every `transact` circuit (`N_PUBLIC_SLOTS`).
pub const PUBLIC_SLOTS: u8 = 3;

/// `SPP_SUPPORTED_SHAPES` (`program-libs/interface/src/shape.rs`): the (inputs, outputs) of every
/// circuit that the prover has keys for, cheapest first. `tests/repo_pins.rs` reads the repo file.
pub const SUPPORTED_SHAPES: [(u8, u8); 38] = [
    (1, 2),
    (1, 4),
    (1, 8),
    (2, 2),
    (2, 4),
    (1, 16),
    (2, 8),
    (3, 2),
    (3, 4),
    (2, 16),
    (3, 8),
    (4, 2),
    (4, 4),
    (4, 8),
    (5, 2),
    (5, 4),
    (4, 16),
    (5, 8),
    (6, 2),
    (6, 4),
    (5, 16),
    (6, 8),
    (8, 2),
    (8, 4),
    (8, 8),
    (8, 16),
    (12, 2),
    (12, 4),
    (12, 8),
    (16, 2),
    (16, 4),
    (16, 8),
    (24, 2),
    (24, 4),
    (32, 2),
    (40, 2),
    (48, 2),
    (49, 2),
];

/// True if a `transact` of this many inputs and outputs has a circuit.
pub fn is_supported_shape(inputs: usize, outputs: usize) -> bool {
    SUPPORTED_SHAPES
        .iter()
        .any(|&(i, o)| usize::from(i) == inputs && usize::from(o) == outputs)
}

/// The first 16 bytes of a Solana off-chain message: `0xFF "solana offchain"`.
pub const OFFCHAIN_MAGIC: [u8; 16] = [
    0xff, b's', b'o', b'l', b'a', b'n', b'a', b' ', b'o', b'f', b'f', b'c', b'h', b'a', b'i', b'n',
];

/// Payloads that start with this text derive the shielded keys (`derivation.ts`).
pub const DERIVE_PREFIX: &[u8] = b"TSPP/derive/";

/// `5PHZEHBMaYbFL9SFmMyP8kUayh3TFEyq2dvEYY3UGjkL`, the approvals program of the group on Devnet
/// (ZOLANA.md 6.10 and 7.2; this client is of version 5). It owns the shielded funds of every group
/// at its PDA.
pub const MULTISIG_DEVNET: Key = [
    0x41, 0x24, 0x3e, 0xbc, 0x6a, 0xa6, 0x46, 0xb9, 0xdc, 0x5c, 0xd6, 0x42, 0xcc, 0x34, 0x34, 0xfa,
    0x27, 0x45, 0x17, 0x64, 0xad, 0x0a, 0x7c, 0x35, 0x31, 0xa0, 0x02, 0xdb, 0x9a, 0xa4, 0xb4, 0x41,
];

/// `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`, the genesis hash of Devnet: the deployment id
/// of the approval digest, so an approval for one cluster never verifies on another.
pub const DEVNET_GENESIS: Key = [
    0xce, 0x59, 0xdb, 0x50, 0x80, 0xfc, 0x2c, 0x6d, 0x3b, 0xcf, 0x7c, 0xa9, 0x07, 0x12, 0xd3, 0xc2,
    0xe5, 0xe6, 0xc2, 0x8f, 0x27, 0xf0, 0xdf, 0xbb, 0x99, 0x53, 0xbd, 0xb0, 0x89, 0x4c, 0x03, 0xab,
];

/// `Ed25519SigVerify111111111111111111111111111`, the precompile that carries the approval.
pub const ED25519_PROGRAM: Key = [
    0x03, 0x7d, 0x46, 0xd6, 0x7c, 0x93, 0xfb, 0xbe, 0x12, 0xf9, 0x42, 0x8f, 0x83, 0x8d, 0x40, 0xff,
    0x05, 0x70, 0x74, 0x49, 0x27, 0xf4, 0x8a, 0x64, 0xfc, 0xca, 0x70, 0x44, 0x80, 0x00, 0x00, 0x00,
];

/// `Sysvar1nstructions1111111111111111111111111`, which `execute` reads the approval from.
pub const INSTRUCTIONS_SYSVAR: Key = [
    0x06, 0xa7, 0xd5, 0x17, 0x18, 0x7b, 0xd1, 0x66, 0x35, 0xda, 0xd4, 0x04, 0x55, 0xfd, 0xc2, 0xc0,
    0xc1, 0x24, 0xc6, 0x8f, 0x21, 0x56, 0x75, 0xa5, 0xdb, 0xba, 0xcb, 0x5f, 0x08, 0x00, 0x00, 0x00,
];

/// Seeds and tags of the approvals program (`sol-program/src/lib.rs`, version 5).
pub const SEED_OWNER: &[u8] = b"multisig";
pub const SEED_PROPOSAL: &[u8] = b"proposed_transaction";
pub const SEED_CANCEL: &[u8] = b"cancelled_transaction";
pub const MS_CREATE: u8 = 0;
pub const MS_EXECUTE: u8 = 1;

/// The domain of the approval digest. The group key signs nothing else under it.
pub const APPROVAL_DOMAIN: &[u8] = b"Zigs_SolApproval_v1";
