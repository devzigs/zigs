//! Instruction data of the two fixed-shape instructions: the pool `deposit` (tag 15, the
//! Shield intent) and the registry `register` (tag 0).
//!
//! Layouts: `DepositIxData` in `program-libs/interface/.../deposit.rs` (wincode) and
//! `RegisterData` in `program-libs/user-registry-interface/src/instruction.rs` (borsh).

use crate::bytes::{Reader, Short};
use crate::consts::{Key, REG_REGISTER, TAG_DEPOSIT};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AssetKind {
    Sol,
    Spl { bump: u8 },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub asset_index: u8,
    pub view_tag: Key,
    pub owner: Key,
    pub amount: u64,
    pub memo: Option<Vec<u8>>,
}

/// Parsed `deposit` data.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Deposit {
    pub assets: Vec<AssetKind>,
    pub entries: Vec<Entry>,
}

fn malformed(_: Short) -> &'static str {
    "the data ends inside a field"
}

fn read_asset(r: &mut Reader) -> Result<AssetKind, &'static str> {
    match r.u8().map_err(malformed)? {
        0 => Ok(AssetKind::Sol),
        1 => Ok(AssetKind::Spl {
            bump: r.u8().map_err(malformed)?,
        }),
        _ => Err("unknown asset kind"),
    }
}

fn read_entry(r: &mut Reader) -> Result<Entry, &'static str> {
    let asset_index = r.u8().map_err(malformed)?;
    let view_tag = r.array().map_err(malformed)?;
    let owner = r.array().map_err(malformed)?;
    let amount = r.u64().map_err(malformed)?;
    let memo = match r.u8().map_err(malformed)? {
        0 => None,
        1 => {
            let len = usize::from(r.u16().map_err(malformed)?);
            Some(r.take(len).map_err(malformed)?.to_vec())
        }
        _ => return Err("memo flag is not 0 or 1"),
    };
    Ok(Entry {
        asset_index,
        view_tag,
        owner,
        amount,
        memo,
    })
}

/// Parses `deposit` data including the tag byte. The whole input must be consumed.
pub fn parse_deposit(data: &[u8]) -> Result<Deposit, &'static str> {
    let mut r = Reader::new(data);
    if r.u8().map_err(malformed)? != TAG_DEPOSIT {
        return Err("the first byte is not the deposit tag");
    }
    let mut assets = Vec::new();
    for _ in 0..r.u8().map_err(malformed)? {
        assets.push(read_asset(&mut r)?);
    }
    let mut entries = Vec::new();
    for _ in 0..r.u8().map_err(malformed)? {
        entries.push(read_entry(&mut r)?);
    }
    if !r.is_empty() {
        return Err("bytes follow the last entry");
    }
    Ok(Deposit { assets, entries })
}

fn put_count(out: &mut Vec<u8>, len: usize) -> Result<(), String> {
    out.push(u8::try_from(len).map_err(|_| format!("{len} items do not fit one byte"))?);
    Ok(())
}

impl Deposit {
    pub fn write(&self) -> Result<Vec<u8>, String> {
        let mut out = vec![TAG_DEPOSIT];
        put_count(&mut out, self.assets.len())?;
        for asset in &self.assets {
            match asset {
                AssetKind::Sol => out.push(0),
                AssetKind::Spl { bump } => out.extend_from_slice(&[1, *bump]),
            }
        }
        put_count(&mut out, self.entries.len())?;
        for entry in &self.entries {
            out.push(entry.asset_index);
            out.extend_from_slice(&entry.view_tag);
            out.extend_from_slice(&entry.owner);
            out.extend_from_slice(&entry.amount.to_le_bytes());
            out.push(u8::from(entry.memo.is_some()));
            if let Some(memo) = &entry.memo {
                let len = u16::try_from(memo.len()).map_err(|_| "memo exceeds 65535 bytes")?;
                out.extend_from_slice(&len.to_le_bytes());
                out.extend_from_slice(memo);
            }
        }
        Ok(out)
    }
}

/// Parsed registry `register` data.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Register {
    pub owner_p256: Option<[u8; 33]>,
    pub nullifier_pk: [u8; 32],
    pub viewing_pk: [u8; 33],
}

/// Parses `register` data including the discriminator byte. The whole input must be consumed.
pub fn parse_register(data: &[u8]) -> Result<Register, &'static str> {
    let mut r = Reader::new(data);
    if r.u8().map_err(malformed)? != REG_REGISTER {
        return Err("the first byte is not the register discriminator");
    }
    let owner_p256 = match r.u8().map_err(malformed)? {
        0 => None,
        1 => Some(r.array().map_err(malformed)?),
        _ => return Err("owner_p256 flag is not 0 or 1"),
    };
    let nullifier_pk = r.array().map_err(malformed)?;
    let viewing_pk = r.array().map_err(malformed)?;
    if !r.is_empty() {
        return Err("bytes follow the viewing key");
    }
    Ok(Register {
        owner_p256,
        nullifier_pk,
        viewing_pk,
    })
}

impl Register {
    pub fn write(&self) -> Vec<u8> {
        let mut out = vec![REG_REGISTER, u8::from(self.owner_p256.is_some())];
        out.extend(self.owner_p256.iter().flatten());
        out.extend_from_slice(&self.nullifier_pk);
        out.extend_from_slice(&self.viewing_pk);
        out
    }
}
