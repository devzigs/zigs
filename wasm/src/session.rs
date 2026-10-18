//! The state of a group payment from data that one seat cannot forge (TICKETS.md ZEC-9, VEL-1).
//!
//! Any one seat can write the proposal, the combined signatures and the sent mark of a session,
//! and the group server can drop them. Only two things are out of its reach: spend authorization
//! signatures under the wallet key, which need t seats, and the sighash that this device approved,
//! which it keeps itself. This module decides "done", "expired" or "unknown" from those alone,
//! together with the chain that this device synced.

use std::collections::{HashMap, HashSet};

use orchard::keys::{FullViewingKey, SpendValidatingKey};
use pczt::{
    roles::verifier::{OrchardError, Verifier},
    Pczt,
};
use serde_json::json;

use super::{ensure, pczt_from_b64, shielded_only, sighash, txid_of, Custom, R};

/// A block reorganisation of up to this many blocks can still bring a transaction on chain after
/// its expiry height, or take back a spend. The web app waits the same margin (`EXPIRY_MARGIN` in
/// web/personal.js).
const REORG_MARGIN: u32 = 3;

/// What a transaction is: its id on chain, its sighash, its expiry height (if known) and the
/// nullifiers of all its actions (empty if unknown). The nullifiers are part of the txid, so a
/// seat cannot hide a spend from this list, whatever the PCZT says about its value.
#[derive(Debug, PartialEq)]
pub(crate) struct Facts {
    pub(crate) txid: String,
    pub(crate) sighash: [u8; 32],
    pub(crate) expiry: Option<u32>,
    pub(crate) nullifiers: Vec<[u8; 32]>,
}

/// The facts of a PCZT. At least one of its spends must use the wallet key of `fvk`. With
/// `signed`, every such spend must also carry a valid spend authorization signature over the
/// PCZT's own sighash: only t seats together can make one.
pub(crate) fn facts(p: &Pczt, fvk: &FullViewingKey, signed: bool) -> R<Facts> {
    shielded_only(p)?;
    let (_, h) = sighash(p)?;
    let ak = SpendValidatingKey::from(fvk.clone());
    let (mut nullifiers, mut wallet, mut bad) = (vec![], 0usize, None);
    let mut check = |b: &orchard::pczt::Bundle| -> Result<(), OrchardError<Custom>> {
        for (i, a) in b.actions().iter().enumerate() {
            let s = a.spend();
            nullifiers.push(s.nullifier().to_bytes());
            match wallet_spend(s, &ak, signed.then_some(&h)) {
                Ok(true) => wallet += 1,
                Ok(false) => {}
                Err(why) => bad = bad.take().or(Some(format!("action {i}: {why}"))),
            }
        }
        Ok(())
    };
    let ver = Verifier::new(p.clone());
    let ver = ver.with_orchard(&mut check).map_err(|x| format!("orchard bundle: {x:?}"))?;
    ver.with_ironwood(&mut check).map_err(|x| format!("ironwood bundle: {x:?}"))?;
    if let Some(why) = bad {
        return Err(why);
    }
    ensure(wallet > 0, "the transaction spends nothing from this wallet")?;
    let expiry = Some(*p.global().expiry_height());
    Ok(Facts { txid: txid_of(p)?, sighash: h, expiry, nullifiers })
}

/// Whether `s` spends with the wallet key `ak`: its `rk` is `ak` randomized by its `alpha`. The
/// test reads no value field, because the txid does not cover one. With `sighash`, such a spend
/// must carry a valid signature over it. A spend whose `alpha` was removed counts as no wallet
/// spend, and its signature is not checked: a PCZT needs at least one checked wallet spend.
fn wallet_spend(
    s: &orchard::pczt::Spend,
    ak: &SpendValidatingKey,
    sighash: Option<&[u8; 32]>,
) -> Result<bool, String> {
    if !s.alpha().is_some_and(|alpha| ak.randomize(&alpha) == *s.rk()) {
        return Ok(false);
    }
    if let Some(h) = sighash {
        let sig = s.spend_auth_sig().as_ref().ok_or("the spend is not signed")?;
        s.rk().verify(h, sig).map_err(|_| "the signature does not verify")?;
    }
    Ok(true)
}

/// The id of a transaction from its sighash. For a transaction without transparent inputs the
/// sighash is the txid digest (ZIP 244), and Zigs makes no other kind (`shielded_only`).
fn txid_from_sighash(h: &[u8; 32]) -> String {
    h.iter().rev().map(|b| format!("{b:02x}")).collect()
}

/// What this device knows of its own chain: the txids that spent its notes, the nullifiers that
/// are spent with the height of the spend, the nullifiers of its notes, and the synced height.
pub(crate) struct Chain<'a> {
    pub(crate) sent: &'a HashSet<String>,
    pub(crate) spent: &'a HashMap<[u8; 32], u32>,
    pub(crate) own: &'a HashSet<[u8; 32]>,
    pub(crate) synced: u32,
}

/// How the trusted transaction of a session is tied to this device.
enum Bond {
    /// This device approved it.
    Approved,
    /// This device approved it, but the signed part holds another transaction of this wallet
    /// that t seats signed: an older payment, or one that can still land.
    Contested,
    /// t seats signed it, but this device did not approve it. Any seat can copy the signed part
    /// of an older session, so nothing ties it to this session.
    Signed,
}

/// The transaction that this device can trust for the session, and how it is tied to it. `pczt`
/// is the proposal, `signed` the combined signatures (each may be empty, and one seat can write
/// either), `approved` the sighash that this device approved (hex, empty when it did not
/// approve). An unreadable or unsigned `signed`, or one of another wallet, counts as absent.
fn trusted(fvk: &FullViewingKey, pczt: &str, signed: &str, approved: &str) -> R<(Facts, Bond)> {
    let approved = parse_sighash(approved)?;
    let signed = (!signed.is_empty())
        .then(|| pczt_from_b64(signed).and_then(|p| facts(&p, fvk, true)).ok())
        .flatten();
    match (signed, approved) {
        (Some(s), Some(a)) if s.sighash == a => Ok((s, Bond::Approved)),
        (Some(_), Some(a)) => Ok((approved_facts(fvk, pczt, a), Bond::Contested)),
        (Some(s), None) => Ok((s, Bond::Signed)),
        (None, Some(a)) => Ok((approved_facts(fvk, pczt, a), Bond::Approved)),
        (None, None) => {
            Err("no transaction that t seats signed or that this device approved".into())
        }
    }
}

/// The facts of the transaction that this device approved: from the proposal when its sighash is
/// the approved one, else only the txid.
fn approved_facts(fvk: &FullViewingKey, pczt: &str, approved: [u8; 32]) -> Facts {
    let proposal = (!pczt.is_empty()).then(|| pczt_from_b64(pczt).ok()).flatten();
    let known = proposal.and_then(|p| facts(&p, fvk, false).ok()).filter(|f| f.sighash == approved);
    known.unwrap_or(Facts {
        txid: txid_from_sighash(&approved),
        sighash: approved,
        expiry: None,
        nullifiers: vec![],
    })
}

fn parse_sighash(hex_text: &str) -> R<Option<[u8; 32]>> {
    if hex_text.is_empty() {
        return Ok(None);
    }
    let bytes = hex::decode(hex_text).map_err(|_| "the approved sighash is not hex")?;
    let h: [u8; 32] = bytes.try_into().map_err(|_| "the approved sighash is not 32 bytes")?;
    Ok(Some(h))
}

/// "expired" needs all of it (for a transaction that this device approved): its expiry height is
/// known, the synced chain passed it by `REORG_MARGIN` blocks, the transaction spends at least
/// one note that this device synced, and none of its notes that this device synced is spent.
/// Then this transaction can no longer land, unless a reorganisation deeper than the margin
/// takes blocks back. Another transaction of the same session, over other notes or some of the
/// same notes, can have landed, or can still land until its own expiry height.
fn is_expired(tx: &Facts, chain: &Chain) -> bool {
    let past = tx.expiry.is_some_and(|e| chain.synced >= e.saturating_add(REORG_MARGIN));
    let ours = tx.nullifiers.iter().any(|nf| chain.own.contains(nf));
    let free = tx.nullifiers.iter().all(|nf| !chain.spent.contains_key(nf));
    past && ours && free
}

/// `{"state", "txid", "why", "spent"}`. `spent`: no synced block holds the transaction, and
/// another one spent a note of it `REORG_MARGIN` blocks deep, so it can no longer land (it stays
/// "unknown": that other transaction may be the same payment). Without a PCZT the notes are not
/// known, so `spent` is false. "done": this device approved the transaction, and a
/// block that it synced holds it. "expired": this device approved it, the signed part holds no
/// other transaction that t seats signed (one seat can remove one), and `is_expired`.
/// "unknown": anything else; `why` says what is missing. A device that did not approve never
/// sees "done" or "expired": it cannot tell that the signatures belong to this session, but
/// `txid` names the transaction that t seats signed.
pub(crate) fn state(
    fvk: &FullViewingKey,
    session: (&str, &str, &str),
    chain: &Chain,
) -> String {
    let (pczt, signed, approved) = session;
    let answer = |state: &str, txid: Option<&str>, why: &str, spent: bool| {
        json!({"state": state, "txid": txid, "why": why, "spent": spent}).to_string()
    };
    let (tx, bond) = match trusted(fvk, pczt, signed, approved) {
        Ok(found) => found,
        Err(why) => return answer("unknown", None, &why, false),
    };
    let txid = Some(tx.txid.as_str());
    let landed = chain.sent.contains(&tx.txid);
    // A payment that landed spent its own notes; otherwise another transaction spent one.
    let deep = |nf: &[u8; 32]| {
        chain.spent.get(nf).is_some_and(|h| chain.synced >= h.saturating_add(REORG_MARGIN))
    };
    let spent = !landed && tx.nullifiers.iter().any(deep);
    let say = |state: &str, why: &str| answer(state, txid, why, spent);
    match (bond, landed) {
        (Bond::Signed, true) => say("unknown", "t seats signed it and a synced block holds it, \
            but this device did not approve it, so nothing ties it to this session"),
        (_, true) => say("done", "a synced block holds it"),
        (_, false) if spent => say("unknown", "another transaction spent a note of it, so it \
            can no longer land"),
        (Bond::Contested, false) => say("unknown", "the combined signatures cover another \
            transaction than the one this device approved: an older payment, or one that can \
            still land"),
        (Bond::Approved, false) if is_expired(&tx, chain) => {
            say("expired", "it expired and its notes are unspent")
        }
        _ => say("unknown", "no synced block holds it, and it may still land"),
    }
}
