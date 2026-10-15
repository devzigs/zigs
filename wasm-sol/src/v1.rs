//! The Solana v1 transaction message (SIMD-0385, version byte 0x81): parse and write.
//!
//! Layout: version, header (3 bytes), config mask (u32), lifetime (32), instruction count,
//! address count, addresses, config values, instruction headers, instruction payloads.
//! `tests/cross.rs` compares this code with `solana-message` 5.1.0.

use std::collections::BTreeSet;

use crate::bytes::{Reader, Short};
use crate::consts::Key;
use crate::rule::Rule;

pub const V1_PREFIX: u8 = 0x81;
const PRIORITY_BITS: u32 = 0b11;
pub const BIT_COMPUTE: u32 = 0b100;
pub const BIT_LOADED: u32 = 0b1000;
pub const BIT_HEAP: u32 = 0b1_0000;
const KNOWN_BITS: u32 = 0b1_1111;
pub const MAX_TX_BYTES: usize = 4096;
const SIGNATURE_BYTES: usize = 64;
const MAX_SIGNERS: u8 = 12;
const MAX_INSTRUCTIONS: usize = 64;
const MAX_ADDRESSES: usize = 64;
const MIN_HEAP: u32 = 32 * 1024;
const MAX_HEAP: u32 = 256 * 1024;

/// The optional config values of a v1 message.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Config {
    pub priority_fee: Option<u64>,
    pub compute_units: Option<u32>,
    pub loaded_limit: Option<u32>,
    pub heap_size: Option<u32>,
}

impl Config {
    /// The mask that the values imply. Bits 0 and 1 travel together.
    pub fn mask(&self) -> u32 {
        let bits = [
            (self.priority_fee.is_some(), PRIORITY_BITS),
            (self.compute_units.is_some(), BIT_COMPUTE),
            (self.loaded_limit.is_some(), BIT_LOADED),
            (self.heap_size.is_some(), BIT_HEAP),
        ];
        bits.iter()
            .filter(|(set, _)| *set)
            .fold(0, |mask, (_, bit)| mask | bit)
    }
}

/// One compiled instruction: indices into the key table, and the data.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ix {
    pub program: u8,
    pub accounts: Vec<u8>,
    pub data: Vec<u8>,
}

/// A parsed v1 message.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Message {
    /// Required signatures, readonly signed accounts, readonly unsigned accounts.
    pub header: [u8; 3],
    pub config: Config,
    pub lifetime: Key,
    pub keys: Vec<Key>,
    pub ixs: Vec<Ix>,
}

/// A parse failure with the rule that it breaks.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParseError {
    pub rule: Rule,
    pub detail: String,
}

impl ParseError {
    fn new(rule: Rule, detail: impl Into<String>) -> Self {
        Self {
            rule,
            detail: detail.into(),
        }
    }
}

fn short(_: Short) -> ParseError {
    ParseError::new(Rule::Truncated, "the message ends inside a field")
}

fn check_mask(mask: u32) -> Result<(), ParseError> {
    if mask & !KNOWN_BITS != 0 {
        return Err(ParseError::new(
            Rule::ConfigUnknownBits,
            format!("config mask {mask:#x} sets bits that SIMD-0385 does not define"),
        ));
    }
    let pair = mask & PRIORITY_BITS;
    if pair != 0 && pair != PRIORITY_BITS {
        return Err(ParseError::new(
            Rule::ConfigPriorityBits,
            format!("config mask {mask:#x} sets only one priority bit"),
        ));
    }
    Ok(())
}

fn read_config(r: &mut Reader, mask: u32) -> Result<Config, ParseError> {
    let mut config = Config::default();
    if mask & PRIORITY_BITS != 0 {
        config.priority_fee = Some(r.u64().map_err(short)?);
    }
    if mask & BIT_COMPUTE != 0 {
        config.compute_units = Some(r.u32().map_err(short)?);
    }
    if mask & BIT_LOADED != 0 {
        config.loaded_limit = Some(r.u32().map_err(short)?);
    }
    if mask & BIT_HEAP != 0 {
        config.heap_size = Some(r.u32().map_err(short)?);
    }
    Ok(config)
}

fn read_ixs(r: &mut Reader, count: usize) -> Result<Vec<Ix>, ParseError> {
    let mut heads = Vec::with_capacity(count);
    for _ in 0..count {
        let program = r.u8().map_err(short)?;
        let accounts = usize::from(r.u8().map_err(short)?);
        let data = usize::from(r.u16().map_err(short)?);
        heads.push((program, accounts, data));
    }
    let mut ixs = Vec::with_capacity(count);
    for (program, accounts, data) in heads {
        let accounts = r.take(accounts).map_err(short)?.to_vec();
        let data = r.take(data).map_err(short)?.to_vec();
        ixs.push(Ix {
            program,
            accounts,
            data,
        });
    }
    Ok(ixs)
}

/// Parses a v1 message. The whole input must be the message: a trailing byte is an error.
pub fn parse(bytes: &[u8]) -> Result<Message, ParseError> {
    let mut r = Reader::new(bytes);
    let version = r.u8().map_err(short)?;
    if version != V1_PREFIX {
        let detail = format!("first byte is {version:#04x}, v1 needs {V1_PREFIX:#04x}");
        return Err(ParseError::new(Rule::Version, detail));
    }
    let header = r.array::<3>().map_err(short)?;
    let mask = r.u32().map_err(short)?;
    check_mask(mask)?;
    let lifetime = r.array::<32>().map_err(short)?;
    let ix_count = usize::from(r.u8().map_err(short)?);
    let key_count = usize::from(r.u8().map_err(short)?);
    let mut keys = Vec::with_capacity(key_count);
    for _ in 0..key_count {
        keys.push(r.array::<32>().map_err(short)?);
    }
    let config = read_config(&mut r, mask)?;
    let ixs = read_ixs(&mut r, ix_count)?;
    if !r.is_empty() {
        return Err(ParseError::new(
            Rule::TrailingBytes,
            "bytes follow the last instruction",
        ));
    }
    Ok(Message {
        header,
        config,
        lifetime,
        keys,
        ixs,
    })
}

fn len_u8(len: usize, what: &str) -> Result<u8, String> {
    u8::try_from(len).map_err(|_| format!("{what} count {len} does not fit one byte"))
}

/// Writes a message in the v1 wire layout.
pub fn write(m: &Message) -> Result<Vec<u8>, String> {
    let mut out = vec![V1_PREFIX];
    out.extend_from_slice(&m.header);
    out.extend_from_slice(&m.config.mask().to_le_bytes());
    out.extend_from_slice(&m.lifetime);
    out.push(len_u8(m.ixs.len(), "instruction")?);
    out.push(len_u8(m.keys.len(), "address")?);
    m.keys.iter().for_each(|key| out.extend_from_slice(key));
    if let Some(fee) = m.config.priority_fee {
        out.extend_from_slice(&fee.to_le_bytes());
    }
    for value in [
        m.config.compute_units,
        m.config.loaded_limit,
        m.config.heap_size,
    ] {
        value
            .iter()
            .for_each(|v| out.extend_from_slice(&v.to_le_bytes()));
    }
    for ix in &m.ixs {
        out.push(ix.program);
        out.push(len_u8(ix.accounts.len(), "instruction account")?);
        let data_len = u16::try_from(ix.data.len()).map_err(|_| "instruction data too long")?;
        out.extend_from_slice(&data_len.to_le_bytes());
    }
    for ix in &m.ixs {
        out.extend_from_slice(&ix.accounts);
        out.extend_from_slice(&ix.data);
    }
    Ok(out)
}

impl Message {
    pub fn is_signer(&self, index: usize) -> bool {
        index < usize::from(self.header[0])
    }

    pub fn is_writable(&self, index: usize) -> bool {
        let signers = usize::from(self.header[0]);
        if index < signers {
            return index < signers.saturating_sub(usize::from(self.header[1]));
        }
        index < self.keys.len().saturating_sub(usize::from(self.header[2]))
    }

    /// The key at an instruction account position, if the indices are in range.
    pub fn account_key(&self, ix: &Ix, position: usize) -> Option<&Key> {
        let index = usize::from(*ix.accounts.get(position)?);
        self.keys.get(index)
    }

    pub fn program_key(&self, ix: &Ix) -> Option<&Key> {
        self.keys.get(usize::from(ix.program))
    }
}

fn check_counts(m: &Message) -> Result<(), String> {
    let signers = m.header[0];
    if signers > MAX_SIGNERS {
        return Err(format!(
            "{signers} required signatures, at most {MAX_SIGNERS}"
        ));
    }
    if m.ixs.len() > MAX_INSTRUCTIONS || m.keys.len() > MAX_ADDRESSES {
        return Err("more than 64 instructions or 64 addresses".to_string());
    }
    let needed = usize::from(signers) + usize::from(m.header[2]);
    if m.keys.len() < needed {
        return Err("fewer addresses than the header needs".to_string());
    }
    if m.header[1] >= signers {
        return Err("no writable signer: the fee payer must be a writable signer".to_string());
    }
    if m.keys.iter().collect::<BTreeSet<_>>().len() != m.keys.len() {
        return Err("duplicate address in the table".to_string());
    }
    Ok(())
}

fn check_heap(heap: Option<u32>) -> Result<(), String> {
    match heap {
        Some(size) if size % 1024 != 0 || !(MIN_HEAP..=MAX_HEAP).contains(&size) => Err(format!(
            "heap size {size} is not a multiple of 1024 in 32 KiB to 256 KiB"
        )),
        _ => Ok(()),
    }
}

fn check_ix_indices(m: &Message) -> Result<(), String> {
    for (n, ix) in m.ixs.iter().enumerate() {
        if ix.program == 0 || usize::from(ix.program) >= m.keys.len() {
            return Err(format!(
                "instruction {n}: program index {} is invalid",
                ix.program
            ));
        }
        if ix.accounts.iter().any(|a| usize::from(*a) >= m.keys.len()) {
            return Err(format!("instruction {n}: account index out of range"));
        }
    }
    Ok(())
}

/// The structural rules of SIMD-0385 and the transaction size limit. `size` is the byte length
/// of the message.
pub fn validate(m: &Message, size: usize) -> Result<(), String> {
    check_counts(m)?;
    check_heap(m.config.heap_size)?;
    check_ix_indices(m)?;
    let total = size + SIGNATURE_BYTES * usize::from(m.header[0]);
    if total > MAX_TX_BYTES {
        return Err(format!(
            "transaction of {total} bytes exceeds {MAX_TX_BYTES}"
        ));
    }
    Ok(())
}
