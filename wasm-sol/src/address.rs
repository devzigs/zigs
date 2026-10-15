//! A full shielded address, as the wallet shows it and the approvers confirm it.

use crate::bytes::{Reader, Short};
use crate::consts::Key;

/// The length of a full shielded address: signing key (34), nullifier key (32), viewing key (33).
pub const ADDRESS_LEN: usize = 34 + 32 + 33;

/// A full shielded address (`ShieldedAddress`, spec "Shielded Address" 269-277). It holds public
/// keys only.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Address {
    /// The scheme-tagged signing key: byte 0 is 1 (Ed25519) or 2 (PDA), then 32 key bytes and a
    /// zero byte. The wallet refuses P-256 owners in `transact`.
    pub signing: [u8; 34],
    pub nullifier_pk: Key,
    pub viewing_pk: [u8; 33],
}

impl Address {
    /// The 32-byte owner tag of the address, if the signing key is an Ed25519 key or a PDA.
    pub fn tag(&self) -> Option<Key> {
        let (prefix, rest) = self.signing.split_first()?;
        let (key, pad) = rest.split_at_checked(32)?;
        if !matches!(prefix, 1 | 2) || pad != [0] {
            return None;
        }
        key.try_into().ok()
    }

    pub(crate) fn read(r: &mut Reader) -> Result<Self, Short> {
        Ok(Self {
            signing: r.array()?,
            nullifier_pk: r.array()?,
            viewing_pk: r.array()?,
        })
    }

    pub(crate) fn write(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(&self.signing);
        out.extend_from_slice(&self.nullifier_pk);
        out.extend_from_slice(&self.viewing_pk);
    }
}
