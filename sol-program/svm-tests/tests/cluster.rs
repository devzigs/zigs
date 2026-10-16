//! The cluster of a build (SOL-42). `build.sh test` builds the program for Devnet and, with a test
//! pool id, for mainnet. Each ELF holds the constants of its own cluster only. The mainnet program
//! accepts only approvals over the mainnet genesis hash, and it calls only its own pool.

use std::{fs, path::PathBuf};

use solana_pubkey::Pubkey;
use zigs_min_multisig_svm_tests::{
    approval_ix, code, digest_with, execute_ix, program_dir, refused_with, sample_transact,
    serialize, Rig, DEVNET_GENESIS, DOMAIN, MAINNET_ELF, MAINNET_GENESIS, MAINNET_TEST_POOL,
    POOL_ID, PROGRAM_ID,
};

/// The forwarded position of the pool account, in the account list of `execute`.
const POOL_AT: usize = 6 + 2;

fn holds(elf: &[u8], key: &Pubkey) -> bool {
    elf.windows(32).any(|bytes| bytes == key.as_ref())
}

#[test]
fn each_elf_holds_the_constants_of_its_cluster_only() {
    let devnet = fs::read(program_dir().join("target/deploy/zigs_min_multisig.so")).expect("ELF");
    let mainnet = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(MAINNET_ELF);
    let mainnet = fs::read(mainnet).expect("mainnet ELF; run `sh sol-program/build.sh test`");
    for (elf, own, other) in [
        (
            &devnet,
            [DEVNET_GENESIS, POOL_ID],
            [MAINNET_GENESIS, MAINNET_TEST_POOL],
        ),
        (
            &mainnet,
            [MAINNET_GENESIS, MAINNET_TEST_POOL],
            [DEVNET_GENESIS, POOL_ID],
        ),
    ] {
        assert!(
            own.iter().all(|key| holds(elf, key)),
            "own constants {own:?}"
        );
        assert!(
            !other.iter().any(|key| holds(elf, key)),
            "other constants {other:?}"
        );
    }
}

/// An approval over each genesis hash, with each pool account at the pool's place.
#[test]
fn the_mainnet_program_takes_mainnet_approvals_and_calls_its_pool() {
    let cases = [
        (MAINNET_GENESIS, MAINNET_TEST_POOL, None),
        (DEVNET_GENESIS, MAINNET_TEST_POOL, Some(code::BAD_APPROVAL)),
        (MAINNET_GENESIS, POOL_ID, Some(code::INVALID_SPP_PROGRAM)),
    ];
    let transact = sample_transact();
    for (genesis, pool, refusal) in cases {
        let mut rig = Rig::mainnet();
        let body = rig.body(&transact);
        rig.create(&body).expect("create");
        let mut metas = rig.metas(&body, &transact);
        metas[POOL_AT].pubkey = pool;
        let digest = digest_with(
            DOMAIN,
            &genesis,
            &PROGRAM_ID,
            &body.proposal(),
            &body.bytes(),
        );
        let approval = approval_ix(&rig.group, &digest);
        let result = rig.send(&[approval, execute_ix(metas, &serialize(&transact))], &[]);
        match refusal {
            Some(code) => assert_eq!(refused_with(result), code),
            // `Rig::send` allows a call to the rig's pool only: here the mainnet test pool.
            None => {
                let meta = result.expect("a mainnet approval settles");
                let calls: Vec<_> = meta.inner_instructions.iter().flatten().collect();
                assert_eq!(calls.len(), 1);
                assert_eq!(calls[0].instruction.data[0], 16);
            }
        }
    }
}
