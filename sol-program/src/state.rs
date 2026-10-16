//! Account layouts. A proposal stores `[KIND_PROPOSAL, bump] || body`, where `body` is the
//! `create` instruction data and the canonical serialization that the approval signs:
//! `commitment (32) || multisig_pubkey (32) || expiry_unix_ts (u64 LE) || rent_recipient (32)
//! || count (u8) || abort_authorities (32 each)`.

use crate::error::MultisigError;

pub const KIND_PROPOSAL: u8 = 1;
pub const KIND_CANCELLED: u8 = 2;
pub const MAX_ABORT_AUTHORITIES: usize = 4;

const FIXED_BODY: usize = 32 + 32 + 8 + 32 + 1;
pub const HEADER: usize = 2;
pub const CANCELLED_LEN: usize = HEADER + 8 + 32;

/// A validated proposal body.
pub struct Proposal<'a> {
    pub body: &'a [u8],
    pub commitment: [u8; 32],
    pub multisig_pubkey: [u8; 32],
    pub expiry_unix_ts: u64,
    pub rent_recipient: [u8; 32],
    abort_authorities: &'a [u8],
}

fn take<const N: usize>(bytes: &[u8], at: usize) -> Result<[u8; N], MultisigError> {
    bytes
        .get(at..)
        .and_then(|rest| rest.first_chunk::<N>())
        .copied()
        .ok_or(MultisigError::BadProposalData)
}

impl<'a> Proposal<'a> {
    /// Validates the body layout: exact length, at most four abort authorities, no duplicates.
    pub fn parse(body: &'a [u8]) -> Result<Self, MultisigError> {
        let [count] = take::<1>(body, FIXED_BODY - 1)?;
        let count = usize::from(count);
        if count > MAX_ABORT_AUTHORITIES {
            return Err(MultisigError::TooManyAbortAuthorities);
        }
        if body.len() != FIXED_BODY + 32 * count {
            return Err(MultisigError::BadProposalData);
        }
        let proposal = Self {
            body,
            commitment: take(body, 0)?,
            multisig_pubkey: take(body, 32)?,
            expiry_unix_ts: u64::from_le_bytes(take(body, 64)?),
            rent_recipient: take(body, 72)?,
            abort_authorities: &body[FIXED_BODY..],
        };
        let authorities: [&[u8]; MAX_ABORT_AUTHORITIES] = core::array::from_fn(|i| {
            proposal
                .abort_authorities
                .get(32 * i..32 * i + 32)
                .unwrap_or_default()
        });
        for i in 0..count {
            if authorities[i + 1..count].contains(&authorities[i]) {
                return Err(MultisigError::DuplicateAbortAuthority);
            }
        }
        Ok(proposal)
    }

    pub fn is_abort_authority(&self, address: &[u8; 32]) -> bool {
        self.abort_authorities
            .as_chunks::<32>()
            .0
            .iter()
            .any(|key| key == address)
    }
}

/// A cancellation record: `[KIND_CANCELLED, bump] || expiry (u64 LE) || rent_recipient (32)`.
pub fn cancellation_record(
    bump: u8,
    expiry: u64,
    rent_recipient: &[u8; 32],
) -> [u8; CANCELLED_LEN] {
    let mut out = [0u8; CANCELLED_LEN];
    out[0] = KIND_CANCELLED;
    out[1] = bump;
    out[2..10].copy_from_slice(&expiry.to_le_bytes());
    out[10..].copy_from_slice(rent_recipient);
    out
}

/// The expiry of a cancellation record.
pub fn cancellation_expiry(record: &[u8; CANCELLED_LEN]) -> u64 {
    let [_, _, a, b, c, d, e, f, g, h, ..] = *record;
    u64::from_le_bytes([a, b, c, d, e, f, g, h])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(count: u8, keys: &[[u8; 32]]) -> Vec<u8> {
        let mut out = vec![1u8; 32];
        out.extend([2u8; 32]);
        out.extend(77u64.to_le_bytes());
        out.extend([3u8; 32]);
        out.push(count);
        keys.iter().for_each(|k| out.extend(k));
        out
    }

    #[test]
    fn parses_fields() {
        let data = body(2, &[[4; 32], [5; 32]]);
        let p = Proposal::parse(&data).unwrap();
        assert_eq!(p.commitment, [1; 32]);
        assert_eq!(p.multisig_pubkey, [2; 32]);
        assert_eq!(p.expiry_unix_ts, 77);
        assert_eq!(p.rent_recipient, [3; 32]);
        assert!(p.is_abort_authority(&[5; 32]));
        assert!(!p.is_abort_authority(&[6; 32]));
    }

    #[test]
    fn refuses_bad_layouts() {
        let dup = body(2, &[[4; 32], [4; 32]]);
        assert_eq!(
            Proposal::parse(&dup).err(),
            Some(MultisigError::DuplicateAbortAuthority)
        );
        let five = body(5, &[[1; 32], [2; 32], [3; 32], [4; 32], [5; 32]]);
        assert_eq!(
            Proposal::parse(&five).err(),
            Some(MultisigError::TooManyAbortAuthorities)
        );
        let short = body(2, &[[4; 32]]);
        assert_eq!(
            Proposal::parse(&short).err(),
            Some(MultisigError::BadProposalData)
        );
        let mut long = body(0, &[]);
        long.push(0);
        assert_eq!(
            Proposal::parse(&long).err(),
            Some(MultisigError::BadProposalData)
        );
        assert_eq!(
            Proposal::parse(&[]).err(),
            Some(MultisigError::BadProposalData)
        );
    }

    #[test]
    fn cancellation_round_trip() {
        let record = cancellation_record(9, 1234, &[7; 32]);
        assert_eq!(record[0], KIND_CANCELLED);
        assert_eq!(cancellation_expiry(&record), 1234);
    }
}
