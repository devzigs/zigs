//! SOL-41, review finding R4 (ZOLANA.md 7.2): after `execute`, the same body can be created again,
//! and the same approval executes again. The approvals program does not stop that; the shielded
//! pool does. This test runs the pool of the pinned Zolana commit with a funded input and real
//! proofs, in the same LiteSVM as the approvals program:
//!
//! 1. A group owner PDA holds a shielded SOL UTXO. An approved `execute` withdraws it to a payee.
//! 2. The proposal account is created again with the same body. The same approval executes again
//!    with a new proof of the same statement.
//! 3. The pool refuses it with `ShieldedPoolError::NullifierAlreadyQueued` (7043). The guard is
//!    `load_unused_nullifier_pda` in the pool: the nullifier PDA of the first execute exists, so it
//!    is not an empty System account. Nothing changes: the transaction rolls back.
//!
//! The case after the nullifier PDA closes needs a forester batch proof (SOL-54), and this test
//! does not cover it.
//!
//! Needs a Zolana prover that serves `transfer_confidential_1_2` at `ZOLANA_PROVER_URL`, and the
//! outputs of `build.sh test`. Run it with `sh sol-program/build.sh proofs`.

use std::path::PathBuf;

use num_bigint::BigUint;
use solana_instruction::AccountMeta;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use zigs_min_multisig_svm_tests::{
    approval_ix, execute_ix, owner_address, program_dir, recipient, refused_with, serialize, Body,
    Rig, TxResult, NOW, POOL_ID, PROGRAM_ID,
};
use zolana_client::{
    PublicInputs, PublicTransfers, TransferInput, TransferInputs, TransferOutput, STATE_TREE_HEIGHT,
};
use zolana_hasher::{primitives::solana_owner_identity, Poseidon};
use zolana_interface::{
    error::ShieldedPoolError,
    instruction::{InterfaceTransfer, TransactIxData, TransactProof},
    pda,
    state::{cache::empty_cached_input_fields, read_tree_id},
    tree_slot::TreeSlot,
    INPUT_TREES, NULLIFIER_PDA_SIZE,
};
use zolana_keypair::{hash::owner_hash, pubkey::PublicKey, NullifierKey};
use zolana_merkle_tree::MerkleTree;
use zolana_program_test::ZolanaProgramTest;
use zolana_test_utils::transact::{
    build_transfer_prover_inputs, change_and_dummy_outputs, derive_test_transfer_output_blindings,
    external_data_hash, inline_outputs, input_utxo, new_transact_ix_data, nullifier_tree,
    output_owner_pk_hashes, prove_and_verify_transfer, public_sol_field, set_output_owner_tags,
    single_tree_slots, sol_leg, sol_public_slots, test_private_tx_blinding, transact_input_flags,
    transfer_input, TransferInputArgs, TransferProverInputsArgs, TEST_BLINDING_SEED,
};
use zolana_transaction::{instructions::transact::PrivateTxHash, Utxo};
use zolana_tree::TreeAccount;

const AMOUNT: u64 = 1_000_000_000;
const POOL_ELF: &str = "target/deploy/shielded_pool_program.so";
/// Positions in the accounts of `execute` for one tree and one input (`execute_metas`).
const OUTPUT_TREE_AT: usize = 7;
const INPUT_TREE_AT: usize = 10;
const NULLIFIER_AT: usize = 11;

/// The pool with its protocol config and one tree.
struct Pool {
    rpc: ZolanaProgramTest,
    tree: Pubkey,
    tree_id: u16,
}

/// The shielded identity of the group owner PDA: a PDA signing key and a fixed nullifier key.
struct Owner {
    address: Pubkey,
    key: PublicKey,
    nullifier_key: NullifierKey,
    nullifier_pk: [u8; 32],
    field: [u8; 32],
    pk_hash: [u8; 32],
}

impl Owner {
    fn new(address: Pubkey) -> Self {
        let key = PublicKey::from_pda(&address);
        let nullifier_key = NullifierKey::from_secret([9u8; 31]);
        let nullifier_pk = nullifier_key.pubkey().expect("nullifier pubkey");
        Self {
            address,
            key,
            field: owner_hash(&key, &nullifier_pk).expect("owner field"),
            pk_hash: key.owner_proof_input_hash().expect("owner pk hash"),
            nullifier_key,
            nullifier_pk,
        }
    }
}

/// A spend of the funded UTXO: the instruction data without its proof, and the proof inputs.
struct Spend {
    data: TransactIxData,
    inputs: TransferInputs,
    public_input_hash: [u8; 32],
    nullifier: [u8; 32],
}

/// The real input of a spend: its witness, its nullifier and the roots it is proven against.
struct Input {
    witness: TransferInput,
    nullifier: [u8; 32],
    utxo_hash: [u8; 32],
    root_index: u16,
    slots: [TreeSlot; INPUT_TREES],
}

/// The change output (zero amount, owned by the owner PDA) and one dummy output.
struct Outputs {
    witness: Vec<TransferOutput>,
    hashes: Vec<[u8; 32]>,
    change_pk: [u8; 32],
}

fn open_pool() -> Pool {
    let elf = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(POOL_ELF);
    let mut rpc = ZolanaProgramTest::with_program_path(&elf)
        .expect("load the pool; run `sh sol-program/build.sh test` first");
    assert_eq!(
        rpc.program_id, POOL_ID,
        "the pool is at the pool id of the program"
    );
    let authority = Keypair::new();
    rpc.create_protocol_config(&authority)
        .expect("protocol config");
    let tree = rpc.create_tree(&authority).expect("tree");
    let tree_id = rpc
        .account_data(&tree)
        .as_deref()
        .and_then(read_tree_id)
        .expect("tree id");
    Pool { rpc, tree, tree_id }
}

/// The UTXO that a proofless SOL deposit puts in the pool for the owner PDA.
fn shield(pool: &mut Pool, owner: &Owner) -> Utxo {
    let depositor = pool.rpc.payer.insecure_clone();
    let event = pool
        .rpc
        .deposit_sol(&pool.tree, &depositor, AMOUNT, owner.field)
        .expect("deposit");
    pool.rpc
        .indexed_deposit_utxo(&event, owner.key)
        .expect("indexed deposit UTXO")
}

/// The latest UTXO root with its history index, and the nullifier root.
fn current_tree_roots(pool: &Pool) -> (u16, [u8; 32], [u8; 32]) {
    let mut data = pool.rpc.account_data(&pool.tree).expect("tree account");
    let mut account = TreeAccount::from_bytes(&mut data, pool.tree.to_bytes()).expect("load tree");
    let index = account.utxo_tree().current_root_index();
    let utxo_root = account.get_utxo_tree_root(index).expect("utxo root");
    (
        index,
        utxo_root,
        account.get_nullifier_tree_root(0).expect("nullifier root"),
    )
}

fn input_witness(pool: &Pool, owner: &Owner, utxo: &Utxo) -> Input {
    let zero = [0u8; 32];
    let utxo_hash = utxo
        .hash(&owner.nullifier_pk, &zero, &zero, pool.tree_id)
        .expect("utxo hash");
    let (root_index, utxo_root, nullifier_root) = current_tree_roots(pool);
    let mut state_tree = MerkleTree::<Poseidon>::new(STATE_TREE_HEIGHT, 0);
    state_tree.append(&utxo_hash).expect("append state leaf");
    assert_eq!(state_tree.root(), utxo_root, "state root gate");
    let state_path = state_tree
        .get_proof_of_leaf(0, true)
        .expect("state proof")
        .to_vec();
    let nf_tree = nullifier_tree().expect("nullifier tree");
    assert_eq!(nf_tree.root(), nullifier_root, "nullifier root gate");
    let nullifier = owner
        .nullifier_key
        .nullifier(&utxo_hash, &utxo.blinding)
        .expect("nullifier");
    let non_inclusion = nf_tree
        .get_non_inclusion_proof(&BigUint::from_bytes_be(&nullifier))
        .expect("non-inclusion proof");
    let witness = transfer_input(TransferInputArgs {
        utxo,
        owner_field: &owner.field,
        state_path: &state_path,
        state_path_index: 0,
        non_inclusion: &non_inclusion,
        tree_id: pool.tree_id,
        nullifier: &nullifier,
        owner_pk_hash: &owner.pk_hash,
        nullifier_key: &owner.nullifier_key,
    })
    .expect("real input");
    Input {
        witness,
        nullifier,
        utxo_hash,
        root_index,
        slots: single_tree_slots(pool.tree_id, utxo_root, nullifier_root),
    }
}

fn output_witness(owner: &Owner, input: &Input, tree_id: u16) -> Outputs {
    let change_pk = NullifierKey::from_secret([11u8; 31])
        .pubkey()
        .expect("change nullifier pubkey");
    let mut witness =
        change_and_dummy_outputs(owner.key, change_pk, [1u8; 31], &[[2u8; 31]], tree_id)
            .expect("change and dummy outputs");
    let hashes = derive_test_transfer_output_blindings(&input.nullifier, &mut witness)
        .expect("output blindings");
    Outputs {
        witness,
        hashes,
        change_pk,
    }
}

/// A full withdrawal of the UTXO to the payee `recipient(0)`, proven for the payer and the owner
/// PDA as the signers. The outputs name the owner PDA, the one signer that is not the payer.
fn spend(pool: &Pool, owner: &Owner, utxo: &Utxo, payer: &Pubkey) -> Spend {
    let zero = [0u8; 32];
    let input = input_witness(pool, owner, utxo);
    let mut outputs = output_witness(owner, &input, pool.tree_id);
    let leg = InterfaceTransfer::SolWithdrawal { amount: AMOUNT };
    let tags = inline_outputs(&outputs.hashes, &[owner.address.to_bytes(); 2]);
    let mut data = new_transact_ix_data(
        vec![input_utxo(input.nullifier)],
        input.root_index,
        vec![leg],
        tags,
    );
    data.expiry_unix_ts = NOW + 3_600;
    let tag_hashes = output_owner_pk_hashes(&data.outputs).expect("output owner pk hashes");
    set_output_owner_tags(
        &mut outputs.witness,
        &tag_hashes,
        &[outputs.change_pk, zero],
    );
    let external = external_data_hash(&data, &[sol_leg(&recipient(0))]).expect("external data");
    let blinding = test_private_tx_blinding(&input.nullifier).expect("private tx blinding");
    let private_tx = PrivateTxHash::new(&[input.utxo_hash], &[outputs.hashes[0], zero], &blinding)
        .hash()
        .expect("private tx hash");
    let signers = [
        solana_owner_identity(&payer.to_bytes()).expect("payer identity"),
        owner.pk_hash,
    ];
    let flags = transact_input_flags(std::slice::from_ref(&input.witness));
    let withdrawn = i64::try_from(AMOUNT).expect("amount");
    let (assets, amounts) = sol_public_slots(public_sol_field(Some(-withdrawn)));
    let public_input_hash = PublicInputs {
        nullifiers: &[input.nullifier],
        output_hashes: &outputs.hashes,
        tree_slots: &input.slots,
        output_tree_id: pool.tree_id,
        private_tx: &private_tx,
        external_data_hash: &external,
        public_transfers: &PublicTransfers { assets, amounts },
        ring_program_id: &zero,
        input_flags: &flags,
        signer_pk_hashes: &signers,
        output_owner_pk_hashes: Some(&tag_hashes),
        cached_inputs: empty_cached_input_fields(1).expect("cache selection"),
    }
    .hash()
    .expect("public input hash");
    let inputs = build_transfer_prover_inputs(TransferProverInputsArgs {
        inputs: vec![input.witness],
        outputs: outputs.witness,
        tree_slots: input.slots,
        output_tree_id: pool.tree_id,
        blinding_seed: TEST_BLINDING_SEED,
        external_data_hash: external,
        private_tx_hash: private_tx,
        public_slot_assets: assets,
        public_slot_amounts: amounts,
        signer_pk_hashes: signers.to_vec(),
        public_input_hash,
    });
    data.private_tx_hash = private_tx;
    Spend {
        data,
        inputs,
        public_input_hash,
        nullifier: input.nullifier,
    }
}

/// A new proof of the statement of `spend`. The prover randomizes each proof.
fn prove(spend: &Spend) -> TransactProof {
    prove_and_verify_transfer(&spend.inputs, spend.public_input_hash, "replay")
        .expect("prove: is a prover running at ZOLANA_PROVER_URL?")
}

/// The rig of the approvals tests over the LiteSVM of the pool, with the approvals program in it.
fn rig_over(pool: Pool, group: Keypair) -> Rig {
    let ZolanaProgramTest { svm, payer, .. } = pool.rpc;
    let mut rig = Rig {
        svm,
        payer,
        group,
        authority: Keypair::new(),
        rent_recipient: Pubkey::new_unique(),
        pool: POOL_ID,
    };
    let elf = program_dir().join("target/deploy/zigs_min_multisig.so");
    rig.svm
        .add_program_from_file(PROGRAM_ID, elf)
        .expect("load the program");
    rig.set_time(NOW);
    rig
}

/// The accounts of `execute` over the real tree and the nullifier PDA of the input.
fn pool_metas(rig: &Rig, body: &Body, spend: &Spend, tree: &Pubkey) -> Vec<AccountMeta> {
    let mut metas = rig.metas(body, &spend.data);
    metas[OUTPUT_TREE_AT].pubkey = *tree;
    metas[INPUT_TREE_AT].pubkey = *tree;
    metas[NULLIFIER_AT].pubkey = pda::nullifier_pda(tree, &spend.nullifier).0;
    metas
}

/// The approval right before `execute`.
fn execute(rig: &mut Rig, body: &Body, metas: &[AccountMeta], data: &TransactIxData) -> TxResult {
    let approval = approval_ix(&rig.group, &body.digest());
    rig.send(
        &[approval, execute_ix(metas.to_vec(), &serialize(data))],
        &[],
    )
}

#[test]
fn the_pool_refuses_a_replay_of_an_approved_payment() {
    // Without it the client uses 127.0.0.1:3001, which can be the prover of another checkout.
    std::env::var("ZOLANA_PROVER_URL").expect("set ZOLANA_PROVER_URL (see build.sh proofs)");
    let group = Keypair::new();
    let owner = Owner::new(owner_address(&group.pubkey()));
    let mut pool = open_pool();
    let utxo = shield(&mut pool, &owner);
    let (tree, payer) = (pool.tree, pool.rpc.payer.pubkey());
    let mut spend = spend(&pool, &owner, &utxo, &payer);
    let first_proof = prove(&spend);
    spend.data.proof = first_proof;
    let mut rig = rig_over(pool, group);
    let body = rig.body(&spend.data);
    let metas = pool_metas(&rig, &body, &spend, &tree);
    let nullifier_pda = metas[NULLIFIER_AT].pubkey;

    rig.create(&body).expect("create");
    execute(&mut rig, &body, &metas, &spend.data).expect("the first execute lands");
    assert!(!rig.exists(&body.proposal()), "execute closes the proposal");
    assert_eq!(
        rig.lamports(&recipient(0)),
        AMOUNT,
        "the payee gets the amount"
    );
    let queued = rig
        .svm
        .get_account(&nullifier_pda)
        .expect("the nullifier PDA exists");
    assert_eq!(
        (queued.owner, queued.data.len()),
        (POOL_ID, NULLIFIER_PDA_SIZE)
    );
    let (tree_after, payee_after) = (rig.svm.get_account(&tree), rig.lamports(&recipient(0)));

    rig.create(&body).expect("the same body is created again");
    assert!(rig.exists(&body.proposal()), "the proposal is back");
    spend.data.proof = prove(&spend);
    assert_ne!(
        spend.data.proof, first_proof,
        "the second proof is a new proof"
    );
    let replay = execute(&mut rig, &body, &metas, &spend.data);
    assert_eq!(
        refused_with(replay),
        ShieldedPoolError::NullifierAlreadyQueued as u32
    );
    assert_eq!(
        rig.svm.get_account(&tree),
        tree_after,
        "the tree is unchanged"
    );
    assert_eq!(
        rig.svm.get_account(&nullifier_pda),
        Some(queued),
        "so is the nullifier PDA"
    );
    assert_eq!(
        rig.lamports(&recipient(0)),
        payee_after,
        "the payee gets nothing more"
    );
    assert!(
        rig.exists(&body.proposal()),
        "the refused execute leaves the proposal"
    );
}
