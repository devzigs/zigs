//! The compute units of `create`, which the checker caps (wasm-sol template.rs `CU_FLOOR_PROPOSE`
//! and `CU_CAP_PROPOSE`). `create` derives the owner PDA of the group and the proposal address with
//! `find_program_address`, and each bump try costs 1,500 units. The old cap of 11,748 refused every
//! create of a group whose owner PDA needs 6 or more tries.

use solana_pubkey::Pubkey;
use zigs_min_multisig_svm_tests::{Rig, PROGRAM_ID};

/// A group key whose owner PDA needs 10 bump tries (bump 246): SHA-256 of "sol52 owner tries 341".
const GROUP: Pubkey = Pubkey::from_str_const("2aFnhW8BbkR8256QaxnZ6pwSsBTvPr46opdS5NXWs8D2");
const OLD_CAP: u64 = 11_748;
const FLOOR: u64 = 38_062;

/// The `find_program_address` tries that end at `bump`.
fn tries(bump: u8) -> u64 {
    256 - u64::from(bump)
}

#[test]
fn a_create_for_a_group_with_a_costly_owner_pda_fits_under_the_floor() {
    let (_, owner_bump) = Pubkey::find_program_address(&[b"multisig", GROUP.as_ref()], &PROGRAM_ID);
    assert_eq!(owner_bump, 246, "the owner PDA needs 10 tries");
    let mut rig = Rig::new();
    let mut body = rig.body_with([7; 32]);
    body.group = GROUP;
    let all = tries(owner_bump) + tries(body.proposal_and_bump().1);
    let units = rig.create(&body).expect("create").compute_units_consumed;
    assert_eq!(units, 2_062 + 1_500 * all, "1,500 units for each bump try");
    assert!(
        units > OLD_CAP,
        "{units} units: the old cap refused this create"
    );
    assert!(units <= FLOOR, "{units} units");
}
