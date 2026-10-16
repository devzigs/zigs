//! The plaintext outputs of a spend: the asset, the amount and the blinding of each output slot,
//! and the root blinding seed of the transaction. ZOLANA.md 5.2 stores them in
//! `solsessions/<id>` with the intent. The proposer writes them, so the checker trusts none of
//! it: `approve` recomputes every blinding from the seed, every hash and every ciphertext, and
//! takes the payee, the asset and the amount of a payment from the intent.
//!
//! A `Proposal` is the intent followed by the plan. The browser entry point takes it as one
//! byte string, in the `intent` argument. A payment of the program design (`Intent::pay`) also
//! carries the `transact` data of its first proof, which holds the outputs and the ciphertexts
//! that the commitment binds.

use crate::bytes::{Reader, Short};
use crate::consts::Key;
use crate::intent::Intent;

/// Who owns an output slot.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    /// The payee of the intent.
    Payee,
    /// Change to the group: its `owner_hash`.
    Change,
    /// An empty output: `DummyDomain`, owner 0, amount 0.
    Dummy,
}

/// One output slot, in the order of the instruction. A `Payee` slot is paid to the payee address
/// of the intent, a `Change` slot to the group.
#[derive(Clone)]
pub struct OutPlan {
    pub role: Role,
    pub mint: Key,
    pub amount: u64,
    pub blinding: Key,
}

#[derive(Clone, Default)]
pub struct Plan {
    /// The private root seed of the proof (`prepared.blindingSeed` of the TS SDK). The circuit
    /// forces every output blinding, padding slots included, to be derived from it and from the
    /// first nullifier (`hashes::output_blinding`). It never leaves the group: the hosted prover
    /// has it already, and the chain sees only the hashes.
    pub blinding_seed: Key,
    pub outputs: Vec<OutPlan>,
}

/// The intent with its plaintext: the `intent` argument of the browser entry point.
pub struct Proposal {
    pub intent: Intent,
    pub plan: Plan,
    /// The `transact` data (tag byte included) of a payment, empty for every other intent.
    pub transact: Vec<u8>,
}

impl Role {
    fn byte(self) -> u8 {
        match self {
            Role::Payee => 0,
            Role::Change => 1,
            Role::Dummy => 2,
        }
    }

    fn from_byte(byte: u8) -> Result<Self, String> {
        match byte {
            0 => Ok(Role::Payee),
            1 => Ok(Role::Change),
            2 => Ok(Role::Dummy),
            other => Err(format!("unknown output role {other}")),
        }
    }
}

impl Plan {
    /// The wire form: the blinding seed, the count of outputs, then each output.
    pub fn encode(&self) -> Result<Vec<u8>, String> {
        let mut out = self.blinding_seed.to_vec();
        out.push(u8::try_from(self.outputs.len()).map_err(|_| "more than 255 outputs")?);
        for output in &self.outputs {
            out.push(output.role.byte());
            out.extend_from_slice(&output.mint);
            out.extend_from_slice(&output.amount.to_le_bytes());
            out.extend_from_slice(&output.blinding);
        }
        Ok(out)
    }

    fn read(r: &mut Reader) -> Result<Self, String> {
        let short = |_: Short| "the plan ends inside a field".to_string();
        let blinding_seed = r.array().map_err(short)?;
        let mut outputs = Vec::new();
        for _ in 0..r.u8().map_err(short)? {
            outputs.push(OutPlan {
                role: Role::from_byte(r.u8().map_err(short)?)?,
                mint: r.array().map_err(short)?,
                amount: r.u64().map_err(short)?,
                blinding: r.array().map_err(short)?,
            });
        }
        Ok(Self {
            blinding_seed,
            outputs,
        })
    }
}

impl Proposal {
    /// The intent wire form, then the plan wire form, then for a payment the length (u16) and
    /// the bytes of its `transact` data. Only a spend or a payment carries a plan.
    pub fn encode(&self) -> Result<Vec<u8>, String> {
        let mut out = self.intent.encode();
        if self.intent.has_plan() {
            out.extend(self.plan.encode()?);
        }
        if self.intent.pay().is_some() {
            let len =
                u16::try_from(self.transact.len()).map_err(|_| "the transact data is long")?;
            out.extend_from_slice(&len.to_le_bytes());
            out.extend_from_slice(&self.transact);
        }
        Ok(out)
    }

    /// Reads the wire form. The whole input must be used. An intent without a plan gets an
    /// empty plan.
    pub fn decode(bytes: &[u8]) -> Result<Self, String> {
        let mut r = Reader::new(bytes);
        let intent = Intent::read(&mut r)?;
        let plan = if intent.has_plan() {
            Plan::read(&mut r)?
        } else {
            Plan::default()
        };
        let mut transact = Vec::new();
        if intent.pay().is_some() {
            let short = |_: Short| "the transact data of the payment is short".to_string();
            let len = usize::from(r.u16().map_err(short)?);
            transact = r.take(len).map_err(short)?.to_vec();
        }
        if !r.is_empty() {
            return Err("bytes follow the proposal".to_string());
        }
        Ok(Self {
            intent,
            plan,
            transact,
        })
    }
}
