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

/// One of the six intents of ZOLANA.md section 5, second table.
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
}

impl Intent {
    /// The lifetime that the message must carry.
    pub fn lifetime(&self) -> Key {
        match self {
            Intent::CreateNonce { blockhash } | Intent::Shield { blockhash, .. } => *blockhash,
            Intent::Register { nonce, .. } | Intent::Cancel { nonce } => *nonce,
            Intent::Transfer { spend, .. } | Intent::Withdrawal { spend, .. } => spend.nonce,
        }
    }

    /// True if the message starts with `AdvanceNonceAccount`: every intent that the group signs
    /// but the one that creates the nonce account. Shield has no group signature.
    pub fn uses_nonce(&self) -> bool {
        !matches!(self, Intent::CreateNonce { .. } | Intent::Shield { .. })
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
        tag => return Err(format!("unknown intent tag {tag}")),
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
