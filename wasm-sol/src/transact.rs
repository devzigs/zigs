//! Pool `transact` instruction data (tag 16): parse, write, and the fields that P3c needs.
//!
//! The layout is `TransactIxData` in `program-libs/interface/src/instruction/instruction_data/
//! transact.rs` (wincode, little endian, `u8` sequence lengths, `u16` byte-vector lengths).
//! Only the default ring circuit (`ConfidentialEddsa`, not cached) is parsed; any other circuit
//! tag has a different payload, so the parser stops there and the rule refuses it.

use crate::bytes::{Reader, Short};
use crate::consts::{Key, TAG_TRANSACT};

/// One public settlement leg (`InterfaceTransfer`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Leg {
    SolDeposit(u64),
    SolWithdrawal(u64),
    Spl {
        withdrawal: bool,
        amount: u64,
        bump: u8,
    },
}

/// How an output names its owner (`OwnerTag`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OwnerTag {
    Inline(Key),
    /// An index into the account list of the instruction.
    Account(u8),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Output {
    pub utxo_hash: Key,
    pub owner_tag: OwnerTag,
    pub data: Option<Vec<u8>>,
}

/// A published ciphertext that no output commits to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LooseMessage {
    pub view_tag: Key,
    pub data: Vec<u8>,
}

/// `CircuitId::ConfidentialEddsa(inputs, outputs, public asset slots)`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Circuit {
    pub inputs: u8,
    pub outputs: u8,
    pub slots: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Input {
    pub nullifier: Key,
    pub tree_index: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TreeContext {
    pub utxo_root_index: u16,
    pub nullifier_root_index: u16,
}

/// Parsed `transact` data. Every field that the P3c rules read is public.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Transact {
    pub expiry: u64,
    pub tx_viewing_pk: [u8; 33],
    pub salt: [u8; 16],
    pub legs: Vec<Leg>,
    pub data_hash: Option<Key>,
    pub ring_data_hash: Option<Key>,
    pub outputs: Vec<Output>,
    pub messages: Vec<LooseMessage>,
    pub private_tx_hash: Key,
    pub circuit: Circuit,
    pub proof: [u8; 192],
    pub inputs: Vec<Input>,
    pub tree_contexts: Vec<TreeContext>,
}

/// Why `transact` data did not parse.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error {
    /// The data is short, has a bad flag or tag, or has trailing bytes.
    Malformed(&'static str),
    /// The circuit tag is not `ConfidentialEddsa` (tag 0).
    Circuit(u16),
}

impl From<Short> for Error {
    fn from(_: Short) -> Self {
        Error::Malformed("the data ends inside a field")
    }
}

type Res<T> = Result<T, Error>;

fn flag(r: &mut Reader) -> Res<bool> {
    match r.u8()? {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(Error::Malformed("an option flag is not 0 or 1")),
    }
}

fn opt_key(r: &mut Reader) -> Res<Option<Key>> {
    Ok(if flag(r)? { Some(r.array()?) } else { None })
}

fn read_leg(r: &mut Reader) -> Res<Leg> {
    let tag = r.u8()?;
    let amount = r.u64()?;
    match tag {
        0 => Ok(Leg::SolDeposit(amount)),
        1 => Ok(Leg::SolWithdrawal(amount)),
        2 | 3 => Ok(Leg::Spl {
            withdrawal: tag == 3,
            amount,
            bump: r.u8()?,
        }),
        _ => Err(Error::Malformed("unknown interface transfer tag")),
    }
}

fn read_output(r: &mut Reader) -> Res<Output> {
    let utxo_hash = r.array()?;
    let owner_tag = match r.u8()? {
        0 => OwnerTag::Inline(r.array()?),
        1 => OwnerTag::Account(r.u8()?),
        _ => return Err(Error::Malformed("unknown owner tag kind")),
    };
    let data = if flag(r)? {
        let len = usize::from(r.u16()?);
        Some(r.take(len)?.to_vec())
    } else {
        None
    };
    Ok(Output {
        utxo_hash,
        owner_tag,
        data,
    })
}

fn read_message(r: &mut Reader) -> Res<LooseMessage> {
    let view_tag = r.array()?;
    let len = usize::from(r.u16()?);
    Ok(LooseMessage {
        view_tag,
        data: r.take(len)?.to_vec(),
    })
}

fn read_seq<T>(r: &mut Reader, item: fn(&mut Reader) -> Res<T>) -> Res<Vec<T>> {
    let count = r.u8()?;
    (0..count).map(|_| item(r)).collect()
}

fn read_circuit(r: &mut Reader) -> Res<Circuit> {
    let tag = r.u16()?;
    if tag != 0 {
        return Err(Error::Circuit(tag));
    }
    Ok(Circuit {
        inputs: r.u8()?,
        outputs: r.u8()?,
        slots: r.u8()?,
    })
}

/// Parses `transact` data including the tag byte. The whole input must be consumed.
pub fn parse(data: &[u8]) -> Res<Transact> {
    let mut r = Reader::new(data);
    if r.u8()? != TAG_TRANSACT {
        return Err(Error::Malformed("the first byte is not the transact tag"));
    }
    let expiry = r.u64()?;
    let tx_viewing_pk = r.array()?;
    let salt = r.array()?;
    let legs = read_seq(&mut r, read_leg)?;
    let data_hash = opt_key(&mut r)?;
    let ring_data_hash = opt_key(&mut r)?;
    let outputs = read_seq(&mut r, read_output)?;
    let messages = read_seq(&mut r, read_message)?;
    let private_tx_hash = r.array()?;
    let circuit = read_circuit(&mut r)?;
    let proof = r.array()?;
    let inputs = read_seq(&mut r, |r| {
        Ok(Input {
            nullifier: r.array()?,
            tree_index: r.u8()?,
        })
    })?;
    let tree_contexts = read_seq(&mut r, |r| {
        Ok(TreeContext {
            utxo_root_index: r.u16()?,
            nullifier_root_index: r.u16()?,
        })
    })?;
    if !r.is_empty() {
        return Err(Error::Malformed("bytes follow the tree contexts"));
    }
    Ok(Transact {
        expiry,
        tx_viewing_pk,
        salt,
        legs,
        data_hash,
        ring_data_hash,
        outputs,
        messages,
        private_tx_hash,
        circuit,
        proof,
        inputs,
        tree_contexts,
    })
}

fn put_len(out: &mut Vec<u8>, len: usize) -> Result<(), String> {
    out.push(u8::try_from(len).map_err(|_| format!("{len} items do not fit one byte"))?);
    Ok(())
}

fn put_bytes(out: &mut Vec<u8>, bytes: &[u8]) -> Result<(), String> {
    let len = u16::try_from(bytes.len()).map_err(|_| "a byte vector exceeds 65535 bytes")?;
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(bytes);
    Ok(())
}

fn put_opt_key(out: &mut Vec<u8>, key: &Option<Key>) {
    out.push(u8::from(key.is_some()));
    key.iter().for_each(|k| out.extend_from_slice(k));
}

fn put_leg(out: &mut Vec<u8>, leg: &Leg) {
    let (tag, amount, bump) = match *leg {
        Leg::SolDeposit(amount) => (0, amount, None),
        Leg::SolWithdrawal(amount) => (1, amount, None),
        Leg::Spl {
            withdrawal,
            amount,
            bump,
        } => (2 + u8::from(withdrawal), amount, Some(bump)),
    };
    out.push(tag);
    out.extend_from_slice(&amount.to_le_bytes());
    out.extend(bump);
}

fn put_output(out: &mut Vec<u8>, output: &Output) -> Result<(), String> {
    out.extend_from_slice(&output.utxo_hash);
    match output.owner_tag {
        OwnerTag::Inline(tag) => {
            out.push(0);
            out.extend_from_slice(&tag);
        }
        OwnerTag::Account(index) => out.extend_from_slice(&[1, index]),
    }
    out.push(u8::from(output.data.is_some()));
    output.data.iter().try_for_each(|data| put_bytes(out, data))
}

impl Transact {
    /// Writes the data in the layout of the program, tag byte first.
    pub fn write(&self) -> Result<Vec<u8>, String> {
        let mut out = vec![TAG_TRANSACT];
        out.extend_from_slice(&self.expiry.to_le_bytes());
        out.extend_from_slice(&self.tx_viewing_pk);
        out.extend_from_slice(&self.salt);
        put_len(&mut out, self.legs.len())?;
        self.legs.iter().for_each(|leg| put_leg(&mut out, leg));
        put_opt_key(&mut out, &self.data_hash);
        put_opt_key(&mut out, &self.ring_data_hash);
        put_len(&mut out, self.outputs.len())?;
        self.outputs
            .iter()
            .try_for_each(|o| put_output(&mut out, o))?;
        put_len(&mut out, self.messages.len())?;
        for message in &self.messages {
            out.extend_from_slice(&message.view_tag);
            put_bytes(&mut out, &message.data)?;
        }
        out.extend_from_slice(&self.private_tx_hash);
        out.extend_from_slice(&[
            0,
            0,
            self.circuit.inputs,
            self.circuit.outputs,
            self.circuit.slots,
        ]);
        out.extend_from_slice(&self.proof);
        put_len(&mut out, self.inputs.len())?;
        for input in &self.inputs {
            out.extend_from_slice(&input.nullifier);
            out.push(input.tree_index);
        }
        put_len(&mut out, self.tree_contexts.len())?;
        for ctx in &self.tree_contexts {
            out.extend_from_slice(&ctx.utxo_root_index.to_le_bytes());
            out.extend_from_slice(&ctx.nullifier_root_index.to_le_bytes());
        }
        Ok(out)
    }

    /// The nullifiers, in instruction order.
    pub fn nullifiers(&self) -> Vec<Key> {
        self.inputs.iter().map(|input| input.nullifier).collect()
    }

    /// The output UTXO hashes, in instruction order.
    pub fn output_hashes(&self) -> Vec<Key> {
        self.outputs.iter().map(|output| output.utxo_hash).collect()
    }

    /// The output ciphertext blobs (`None` for a slot that a bundle covers).
    pub fn output_data(&self) -> Vec<Option<&[u8]>> {
        self.outputs
            .iter()
            .map(|output| output.data.as_deref())
            .collect()
    }
}
