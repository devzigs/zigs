//! The cluster of this build (SOL-42). The genesis hash binds every approval to the cluster, and
//! the pool id is the target of the `transact` CPI. A build names exactly one cluster:
//! `--features devnet` or `--features mainnet`. A mainnet build takes the pool id from
//! `ZIGS_MAINNET_POOL_ID` at build time, and it fails when the genesis hash or the pool id is the
//! Devnet one.

use pinocchio::Address;

#[cfg(not(any(feature = "devnet", feature = "mainnet")))]
compile_error!("choose the cluster: --features devnet or --features mainnet (SOL-42)");
#[cfg(all(feature = "devnet", feature = "mainnet"))]
compile_error!("choose one cluster, not both (SOL-42)");

const DEVNET_GENESIS: Address =
    Address::from_str_const("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
/// The pool id of `zolana-interface` at the pinned commit, which calls it the development id.
const DEVELOPMENT_POOL: Address =
    Address::from_str_const("sppU489D7A4U1exNo1oeMGZtLEofq3a6o2fR7UeoWB6");

#[cfg(feature = "devnet")]
pub const GENESIS: Address = DEVNET_GENESIS;
#[cfg(feature = "devnet")]
pub const POOL_ID: Address = DEVELOPMENT_POOL;

#[cfg(feature = "mainnet")]
pub const GENESIS: Address =
    Address::from_str_const("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d");
#[cfg(feature = "mainnet")]
pub const POOL_ID: Address = Address::from_str_const(env!("ZIGS_MAINNET_POOL_ID"));

#[cfg(feature = "mainnet")]
const _: () = {
    assert!(
        !same(&GENESIS, &DEVNET_GENESIS),
        "a mainnet build carries the Devnet genesis hash"
    );
    assert!(
        !same(&POOL_ID, &DEVELOPMENT_POOL),
        "a mainnet build carries the development pool id"
    );
};

#[cfg(feature = "mainnet")]
const fn same(a: &Address, b: &Address) -> bool {
    let (a, b) = (a.to_bytes(), b.to_bytes());
    let mut at = 0;
    while at < a.len() {
        if a[at] != b[at] {
            return false;
        }
        at += 1;
    }
    true
}

#[cfg(all(test, feature = "devnet"))]
mod tests {
    use super::*;

    #[test]
    fn the_devnet_pool_is_the_pool_of_the_pinned_interface() {
        assert_eq!(POOL_ID, zolana_interface::PROGRAM_ID_PUBKEY);
    }
}
