//! What the group means to do. The approver compares the message with the intent, so the
//! intent holds every value that the message must repeat.

use crate::address::Address;
use crate::bytes::Reader;
use crate::consts::Key;

/// The values that a private spend (Transfer or Withdrawal) repeats in the message.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Spend {
    /// The value of the nonce account that the message uses as its lifetime.
    pub nonce: Key,
    /// The finite expiry: proposal time plus the expiry window.
    pub expiry: u64,
    /// The number of input UTXOs (nullifiers) of the proposal.
    pub inputs: u8,
    /// The number of output slots: payee, change and dummies.
    pub outputs: u8,
}

/// A payment of the program design (ZOLANA.md 7.2): what the group approves once with its digest.
/// The approval binds no nonce: the executor proves again at execution.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pay {
    /// The finite expiry of the pool data and of the proposal body.
    pub expiry: u64,
    pub inputs: u8,
    pub outputs: u8,
    pub payee: Payee,
    /// The asset. A withdrawal pays SOL only: its mint is all zero and is not on the wire.
    pub mint: Key,
    pub amount: u64,
}

/// Who a payment pays: the full shielded address of a private payment, or the public SOL account
/// of a withdrawal through the program (SOL-32).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Payee {
    Shielded(Address),
    Public(Key),
}

impl Pay {
    /// The public recipient of a withdrawal, none for a private payment.
    pub fn recipient(&self) -> Option<Key> {
        match self.payee {
            Payee::Public(recipient) => Some(recipient),
            Payee::Shielded(_) => None,
        }
    }
}

/// One of the intents of ZOLANA.md section 5, second table, and of the program design (7.2).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Intent {
    /// Create the nonce account. The lifetime is a recent blockhash.
    CreateNonce {
        blockhash: Key,
    },
    Register {
        nonce: Key,
        nullifier_pk: Key,
        viewing_pk: [u8; 33],
    },
    /// Add SOL: a pool deposit from the payer into the shielded balance of the group. The payer
    /// signs alone, with a recent blockhash: it is the SOL of one member, so the group does not
    /// approve it and does not touch its nonce account.
    Shield {
        blockhash: Key,
        amount: u64,
    },
    /// A private payment: the full shielded address of the payee, the asset and the amount.
    /// The approvers confirm the address on the screen (its fingerprint), so the checker binds
    /// the owner hash, the viewing key and the owner tag of the payee output to it, and never to
    /// the plaintext of the proposer.
    Transfer {
        spend: Spend,
        payee: Address,
        mint: Key,
        amount: u64,
    },
    Withdrawal {
        spend: Spend,
        recipient: Key,
        amount: u64,
    },
    Cancel {
        nonce: Key,
    },
    /// An intent of the program design (ZOLANA.md 7.2).
    Program(Program),
}

/// The intents of the program design (ZOLANA.md 7.2). None of them uses a nonce, all pay to or
/// from the PDA identity, and the group key signs none of their messages: it signs the digest of
/// an approval.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Program {
    /// The `create` message of a proposal account: the fee key of the proposing seat signs it
    /// alone, with a recent blockhash. `commitment` is the value that the device computed.
    Propose {
        pay: Pay,
        commitment: Key,
        blockhash: Key,
    },
    /// The `execute` message: the approval of the group in an Ed25519 instruction, then the
    /// program with a fresh proof. The fee key of the executing seat signs it alone. `recipient`
    /// is the public recipient of a withdrawal (tag 11), none for a private payment (tag 7).
    Execute {
        expiry: u64,
        rent_recipient: Key,
        signature: [u8; 64],
        blockhash: Key,
        recipient: Option<Key>,
    },
    /// The approval of a payment. It is no message: the group key signs its 32-byte digest.
    Approve { pay: Pay },
}

impl Program {
    /// The lifetime of the message: a recent blockhash. An approval has no message.
    fn lifetime(&self) -> Key {
        match self {
            Program::Propose { blockhash, .. } | Program::Execute { blockhash, .. } => *blockhash,
            Program::Approve { .. } => [0; 32],
        }
    }

    fn name(&self) -> &'static str {
        match self {
            Program::Propose { .. } => "propose",
            Program::Execute { .. } => "execute",
            Program::Approve { .. } => "approve",
        }
    }

    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Program::Propose {
                pay,
                commitment,
                blockhash,
            } => {
                out.push(if pay.recipient().is_some() { 9 } else { 6 });
                encode_pay(out, pay);
                out.extend_from_slice(commitment);
                out.extend_from_slice(blockhash);
            }
            Program::Execute {
                expiry,
                rent_recipient,
                signature,
                blockhash,
                recipient,
            } => {
                out.push(if recipient.is_some() { 11 } else { 7 });
                out.extend_from_slice(&expiry.to_le_bytes());
                out.extend_from_slice(rent_recipient);
                out.extend_from_slice(signature);
                out.extend_from_slice(blockhash);
                out.extend_from_slice(recipient.as_ref().map_or(&[][..], |key| &key[..]));
            }
            Program::Approve { pay } => {
                out.push(if pay.recipient().is_some() { 10 } else { 8 });
                encode_pay(out, pay);
            }
        }
    }

    /// Reads the fields after the tag byte `tag`: 6 to 8 for a private payment, 9 to 11 for a
    /// withdrawal (the same intents with a public recipient).
    fn read(tag: u8, r: &mut Reader) -> Result<Self, String> {
        let short = |_| "the intent ends inside a field".to_string();
        let public = tag >= 9;
        Ok(match tag {
            6 | 9 => Program::Propose {
                pay: decode_pay(r, public).map_err(short)?,
                commitment: r.array().map_err(short)?,
                blockhash: r.array().map_err(short)?,
            },
            7 | 11 => Program::Execute {
                expiry: r.u64().map_err(short)?,
                rent_recipient: r.array().map_err(short)?,
                signature: r.array().map_err(short)?,
                blockhash: r.array().map_err(short)?,
                recipient: public.then(|| r.array()).transpose().map_err(short)?,
            },
            8 | 10 => Program::Approve {
                pay: decode_pay(r, public).map_err(short)?,
            },
            tag => return Err(format!("unknown intent tag {tag}")),
        })
    }
}

impl Intent {
    /// The lifetime that the message must carry.
    pub fn lifetime(&self) -> Key {
        match self {
            Intent::CreateNonce { blockhash } | Intent::Shield { blockhash, .. } => *blockhash,
            Intent::Register { nonce, .. } | Intent::Cancel { nonce } => *nonce,
            Intent::Transfer { spend, .. } | Intent::Withdrawal { spend, .. } => spend.nonce,
            Intent::Program(program) => program.lifetime(),
        }
    }

    /// True if the message starts with `AdvanceNonceAccount`: every intent that the group signs
    /// but the one that creates the nonce account. Shield has no group signature.
    pub fn uses_nonce(&self) -> bool {
        !matches!(
            self,
            Intent::CreateNonce { .. } | Intent::Shield { .. } | Intent::Program(_)
        )
    }

    /// The payment of an approval or of the `create` message that opens it.
    pub fn pay(&self) -> Option<&Pay> {
        match self {
            Intent::Program(Program::Propose { pay, .. } | Program::Approve { pay }) => Some(pay),
            _ => None,
        }
    }

    /// True for the intents of the PDA identity: the funds of the program design.
    pub fn uses_pda(&self) -> bool {
        matches!(self, Intent::Shield { .. } | Intent::Program(_))
    }

    /// True for the intents whose proposal carries a plan: the spends and the payments.
    pub fn has_plan(&self) -> bool {
        self.is_spend() || self.pay().is_some()
    }

    /// The owner tag of the payee of a Transfer, if its address has an Ed25519 or PDA key.
    pub fn payee_tag(&self) -> Option<Key> {
        match self {
            Intent::Transfer { payee, .. } => payee.tag(),
            _ => None,
        }
    }

    /// True for Transfer and Withdrawal, the intents that carry a `transact` instruction.
    pub fn is_spend(&self) -> bool {
        matches!(self, Intent::Transfer { .. } | Intent::Withdrawal { .. })
    }

    pub fn name(&self) -> &'static str {
        match self {
            Intent::CreateNonce { .. } => "create-nonce",
            Intent::Register { .. } => "register",
            Intent::Shield { .. } => "shield",
            Intent::Transfer { .. } => "transfer",
            Intent::Withdrawal { .. } => "withdrawal",
            Intent::Cancel { .. } => "cancel",
            Intent::Program(program) => program.name(),
        }
    }

    /// The wire form of the browser entry point: a tag byte, then the fields in order.
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::new();
        match self {
            Intent::CreateNonce { blockhash } => {
                out.push(0);
                out.extend_from_slice(blockhash);
            }
            Intent::Register {
                nonce,
                nullifier_pk,
                viewing_pk,
            } => {
                out.push(1);
                out.extend_from_slice(nonce);
                out.extend_from_slice(nullifier_pk);
                out.extend_from_slice(viewing_pk);
            }
            Intent::Shield { blockhash, amount } => {
                out.push(2);
                out.extend_from_slice(blockhash);
                out.extend_from_slice(&amount.to_le_bytes());
            }
            Intent::Transfer {
                spend,
                payee,
                mint,
                amount,
            } => {
                out.push(3);
                encode_spend(&mut out, spend);
                payee.write(&mut out);
                out.extend_from_slice(mint);
                out.extend_from_slice(&amount.to_le_bytes());
            }
            Intent::Withdrawal {
                spend,
                recipient,
                amount,
            } => {
                out.push(4);
                encode_spend(&mut out, spend);
                out.extend_from_slice(recipient);
                out.extend_from_slice(&amount.to_le_bytes());
            }
            Intent::Cancel { nonce } => {
                out.push(5);
                out.extend_from_slice(nonce);
            }
            Intent::Program(program) => program.encode(&mut out),
        }
        out
    }

    /// Reads the wire form. The whole input must be used.
    pub fn decode(bytes: &[u8]) -> Result<Self, String> {
        let mut r = Reader::new(bytes);
        let intent = read_intent(&mut r)?;
        if !r.is_empty() {
            return Err("bytes follow the intent".to_string());
        }
        Ok(intent)
    }

    /// Reads the wire form from the front of a reader, for a proposal that has a plan behind it.
    pub fn read(r: &mut Reader) -> Result<Self, String> {
        read_intent(r)
    }
}

fn read_intent(r: &mut Reader) -> Result<Intent, String> {
    let short = |_| "the intent ends inside a field".to_string();
    Ok(match r.u8().map_err(short)? {
        0 => Intent::CreateNonce {
            blockhash: r.array().map_err(short)?,
        },
        1 => Intent::Register {
            nonce: r.array().map_err(short)?,
            nullifier_pk: r.array().map_err(short)?,
            viewing_pk: r.array().map_err(short)?,
        },
        2 => Intent::Shield {
            blockhash: r.array().map_err(short)?,
            amount: r.u64().map_err(short)?,
        },
        3 => Intent::Transfer {
            spend: decode_spend(r).map_err(short)?,
            payee: Address::read(r).map_err(short)?,
            mint: r.array().map_err(short)?,
            amount: r.u64().map_err(short)?,
        },
        4 => Intent::Withdrawal {
            spend: decode_spend(r).map_err(short)?,
            recipient: r.array().map_err(short)?,
            amount: r.u64().map_err(short)?,
        },
        5 => Intent::Cancel {
            nonce: r.array().map_err(short)?,
        },
        tag => Intent::Program(Program::read(tag, r)?),
    })
}

fn encode_spend(out: &mut Vec<u8>, spend: &Spend) {
    out.extend_from_slice(&spend.nonce);
    out.extend_from_slice(&spend.expiry.to_le_bytes());
    out.extend_from_slice(&[spend.inputs, spend.outputs]);
}

fn decode_spend(r: &mut Reader) -> Result<Spend, crate::bytes::Short> {
    Ok(Spend {
        nonce: r.array()?,
        expiry: r.u64()?,
        inputs: r.u8()?,
        outputs: r.u8()?,
    })
}

/// A private payment writes the shielded address and the mint; a withdrawal writes its recipient.
fn encode_pay(out: &mut Vec<u8>, pay: &Pay) {
    out.extend_from_slice(&pay.expiry.to_le_bytes());
    out.extend_from_slice(&[pay.inputs, pay.outputs]);
    match &pay.payee {
        Payee::Shielded(address) => {
            address.write(out);
            out.extend_from_slice(&pay.mint);
        }
        Payee::Public(recipient) => out.extend_from_slice(recipient),
    }
    out.extend_from_slice(&pay.amount.to_le_bytes());
}

fn decode_pay(r: &mut Reader, public: bool) -> Result<Pay, crate::bytes::Short> {
    let (expiry, inputs, outputs) = (r.u64()?, r.u8()?, r.u8()?);
    let (payee, mint) = if public {
        (Payee::Public(r.array()?), [0; 32])
    } else {
        (Payee::Shielded(Address::read(r)?), r.array()?)
    };
    Ok(Pay {
        expiry,
        inputs,
        outputs,
        payee,
        mint,
        amount: r.u64()?,
    })
}
