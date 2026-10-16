//! Block times and the expiry window of group payments.
//!
//! NU7 (ZIP 218) cuts the target block time from 75 to 25 seconds. A group payment collects its
//! approvals over hours, so its expiry comes from a window in time, not from the 40 blocks that
//! the transaction builder sets by default.

use pczt::Pczt;
use serde_json::{json, Value};
use zcash_protocol::consensus::{BlockHeight, BranchId, NetworkUpgrade, Parameters};

use super::{ensure, pczt_network, R};

/// How long a group payment stays valid after its proposal. One day gives every signer a full
/// working day in any time zone. It is also the longest time that a signed payment that nobody
/// sent stays valid, and that a payment the network dropped keeps the wallet's notes.
pub(crate) const EXPIRY_SECONDS: u32 = 24 * 3600;
/// An approver also accepts an expiry up to this much after its own window, for a proposer whose
/// view of the chain differs. So it refuses only a payment that stays valid much longer.
const SLACK_SECONDS: u32 = 24 * 3600;
/// A node refuses a transaction that expires within this many blocks after the next block
/// (zcashd's `TX_EXPIRING_SOON_THRESHOLD`; `EXPIRY_MARGIN` in web/personal.js).
const EXPIRING_SOON: u32 = 3;
/// Target block times since Blossom and from NU7 on. A Zigs wallet starts after Blossom, so the
/// 150 seconds before it never apply.
const SLOW: u32 = 75;
const FAST: u32 = 25;

/// The target time between the block before `height` and the block at `height`.
pub(crate) fn block_seconds<P: Parameters>(net: &P, height: BlockHeight) -> u32 {
    if net.is_nu_active(NetworkUpgrade::Nu7, height) { FAST } else { SLOW }
}

/// The expected time from block `from` to block `to`: the target times of blocks `from + 1` to
/// `to`. Zero when `to` is not after `from`.
pub(crate) fn span_seconds<P: Parameters>(net: &P, from: u32, to: u32) -> u64 {
    if to <= from {
        return 0;
    }
    let slow = match net.activation_height(NetworkUpgrade::Nu7) {
        Some(nu7) => to.min(u32::from(nu7).saturating_sub(1)).saturating_sub(from),
        None => to - from,
    };
    u64::from(slow) * u64::from(SLOW) + u64::from(to - from - slow) * u64::from(FAST)
}

/// The expiry height of a group payment built for block `target`: the window of
/// `EXPIRY_SECONDS`, but at most the last block before the next network upgrade. After the
/// upgrade, the consensus branch of the transaction is wrong and no block can hold it.
pub(crate) fn expiry_for<P: Parameters>(net: &P, target: BlockHeight) -> BlockHeight {
    let end = target + EXPIRY_SECONDS / block_seconds(net, target);
    match BranchId::for_height(net, target).height_bounds(net) {
        Some((_, Some(next))) => end.min(next - 1),
        _ => end,
    }
}

/// For a transaction that expires at `expiry`, seen at chain height `tip`: whether it is too
/// late to send it, and the blocks and the expected seconds until it expires.
pub(crate) fn left<P: Parameters>(net: &P, expiry: u32, tip: u32) -> (bool, u32, u64) {
    let expired = tip.saturating_add(1 + EXPIRING_SOON) > expiry;
    (expired, expiry.saturating_sub(tip), span_seconds(net, tip, expiry))
}

/// `left` as JSON for the apps: `{"expired", "blocks_left", "seconds_left"}`.
pub(crate) fn state<P: Parameters>(net: &P, expiry: u32, tip: u32) -> R<String> {
    ensure(expiry != 0, "a transaction with expiry height 0 never expires")?;
    let (expired, blocks, seconds) = left(net, expiry, tip);
    let out: Value = json!({"expired": expired, "blocks_left": blocks, "seconds_left": seconds});
    Ok(out.to_string())
}

/// The check of an approving device. `tip` is the chain height that the device just read. It
/// refuses a payment that a node would refuse at the next block, and one that stays valid much
/// longer than the window.
pub(crate) fn check(p: &Pczt, tip: u32) -> R<()> {
    let net = pczt_network(p)?;
    let expiry = *p.global().expiry_height();
    let (expired, _, _) = left(&net, expiry, tip);
    ensure(!expired, &format!(
        "this payment expired at block {expiry} (the chain is at block {tip}). Propose it again"))?;
    let next = BlockHeight::from_u32(tip.saturating_add(1));
    let slack = SLACK_SECONDS / block_seconds(&net, next);
    let most = u32::from(expiry_for(&net, next)).saturating_add(slack);
    let hours = (EXPIRY_SECONDS + SLACK_SECONDS) / 3600;
    ensure(expiry <= most, &format!(
        "this payment stays valid until block {expiry}, more than {hours} hours from now"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use zcash_protocol::{consensus::Network, local_consensus::LocalNetwork};

    const TEST_NU7: u32 = 4_465_026;

    /// A chain with NU6.3 at block 10 and NU7 at `nu7`, if any.
    fn chain(nu7: Option<u32>) -> LocalNetwork {
        let at = |h: u32| Some(BlockHeight::from_u32(h));
        LocalNetwork {
            overwinter: at(1), sapling: at(2), blossom: at(3), heartwood: at(4), canopy: at(5),
            nu5: at(6), nu6: at(7), nu6_1: at(8), nu6_2: at(9), nu6_3: at(10),
            nu7: nu7.and_then(at),
        }
    }

    #[test]
    fn the_block_time_is_75_seconds_before_nu7_and_25_from_it() {
        let net = Network::TestNetwork;
        assert_eq!(block_seconds(&net, BlockHeight::from_u32(TEST_NU7 - 1)), 75);
        assert_eq!(block_seconds(&net, BlockHeight::from_u32(TEST_NU7)), 25);
        // The pinned crate has no NU7 height for mainnet yet (ZEC-1).
        assert_eq!(block_seconds(&Network::MainNetwork, BlockHeight::from_u32(9_000_000)), 75);
    }

    #[test]
    fn a_span_counts_each_block_at_its_own_block_time() {
        let net = Network::TestNetwork;
        assert_eq!(span_seconds(&net, 100, 110), 750);
        assert_eq!(span_seconds(&net, TEST_NU7, TEST_NU7 + 10), 250);
        // Blocks TEST_NU7 - 2 and TEST_NU7 - 1 are slow, TEST_NU7 to TEST_NU7 + 2 are fast.
        assert_eq!(span_seconds(&net, TEST_NU7 - 3, TEST_NU7 + 2), 2 * 75 + 3 * 25);
        assert_eq!(span_seconds(&net, 50, 50), 0);
        assert_eq!(span_seconds(&net, 50, 40), 0);
        assert_eq!(span_seconds(&chain(None), 0, u32::MAX), u64::from(u32::MAX) * 75);
    }

    #[test]
    fn the_window_is_one_day_of_blocks() {
        let at = |h: u32| BlockHeight::from_u32(h);
        let testnet = expiry_for(&Network::TestNetwork, at(4_500_001));
        assert_eq!(u32::from(testnet), 4_500_001 + 3_456, "24 hours at 25 seconds");
        let mainnet = expiry_for(&Network::MainNetwork, at(3_520_001));
        assert_eq!(u32::from(mainnet), 3_520_001 + 1_152, "24 hours at 75 seconds");
    }

    #[test]
    fn the_window_ends_before_the_next_upgrade() {
        let net = chain(Some(2_000));
        let at = |h: u32| BlockHeight::from_u32(h);
        assert_eq!(expiry_for(&net, at(500)), at(500 + 1_152), "the upgrade is after the window");
        assert_eq!(expiry_for(&net, at(1_500)), at(1_999), "the window would cross it");
        assert_eq!(expiry_for(&net, at(2_000)), at(2_000 + 3_456), "built under the new rules");
        assert_eq!(expiry_for(&chain(None), at(1_500)), at(1_500 + 1_152));
    }

    #[test]
    fn a_payment_expires_three_blocks_before_its_height() {
        let net = Network::TestNetwork;
        let e = 4_500_000;
        assert_eq!(left(&net, e, e - 4), (false, 4, 100));
        assert!(left(&net, e, e - 3).0, "a node refuses it at the next block");
        assert_eq!(left(&net, e, e + 5), (true, 0, 0));
        assert!(left(&net, 10, u32::MAX).0);
        let s: Value = serde_json::from_str(&state(&net, e, e - 100).unwrap()).unwrap();
        assert_eq!(s, json!({"expired": false, "blocks_left": 100, "seconds_left": 2_500}));
        assert!(state(&net, 0, 5).unwrap_err().contains("never expires"));
    }
}
