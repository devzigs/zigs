//! Memos (ZIP 302): the text that a payer writes, and what a transaction holds. The engine reads a
//! memo from the transaction itself: an outgoing one with the wallet's outgoing viewing keys, an
//! incoming one with its incoming viewing key. It never trusts a description of a memo.

use std::{collections::HashMap, str::FromStr};

use orchard::{
    keys::{FullViewingKey, IncomingViewingKey, Scope},
    note::ExtractedNoteCommitment,
};
use pczt::Pczt;
use serde_json::{json, Value};
use zcash_primitives::transaction::Transaction;
use zcash_protocol::{
    consensus::BranchId,
    memo::{Memo, MemoBytes},
};

use super::{e, ensure, R};

/// The longest memo, in UTF-8 bytes (ZIP 302).
pub(crate) const MEMO_BYTES: usize = 512;

/// What a memo field holds.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum MemoView {
    /// No memo: the field starts with 0xF6, or it is an empty text.
    Empty,
    Text(String),
    /// Binary data, a format that this engine does not know, or text that is not UTF-8.
    NotText,
}

impl MemoView {
    pub(crate) fn of(field: &[u8; MEMO_BYTES]) -> MemoView {
        let memo = MemoBytes::from_bytes(field).ok().and_then(|m| Memo::try_from(&m).ok());
        match memo {
            Some(Memo::Empty) => MemoView::Empty,
            Some(Memo::Text(t)) if t.is_empty() => MemoView::Empty,
            Some(Memo::Text(t)) => MemoView::Text(String::from(t)),
            _ => MemoView::NotText,
        }
    }

    pub(crate) fn status(&self) -> &'static str {
        match self {
            MemoView::Empty => "empty",
            MemoView::Text(_) => "text",
            MemoView::NotText => "not_text",
        }
    }

    /// `{"status": "empty" | "text" | "not_text", "text": <only for text>}`
    pub(crate) fn to_json(&self) -> Value {
        match self {
            MemoView::Text(t) => json!({"status": "text", "text": t}),
            other => json!({"status": other.status()}),
        }
    }

    pub(crate) fn from_json(v: &Value) -> R<MemoView> {
        match (v["status"].as_str(), v["text"].as_str()) {
            (Some("empty"), _) => Ok(MemoView::Empty),
            (Some("not_text"), _) => Ok(MemoView::NotText),
            (Some("text"), Some(t)) => Ok(MemoView::Text(t.to_string())),
            _ => Err("the saved wallet state is damaged (memo)".to_string()),
        }
    }
}

/// The memo of one recipient: `v` is the row's `memo`. Missing, null and "" mean no memo. Else it
/// is a text of at most 512 UTF-8 bytes with no null character.
pub(crate) fn parse_memo(v: &Value) -> R<MemoBytes> {
    let text = match v {
        Value::Null => "",
        Value::String(s) => s,
        _ => return Err("the memo must be text".to_string()),
    };
    ensure(
        text.len() <= MEMO_BYTES,
        &format!("the memo is {} bytes long; the limit is {MEMO_BYTES}", text.len()),
    )?;
    ensure(!text.contains('\0'), "the memo cannot contain a null character")?;
    if text.is_empty() {
        return Ok(MemoBytes::empty());
    }
    Memo::from_str(text).map(|m| m.encode()).map_err(e("memo"))
}

/// Memos of the outputs of `p`, as `(pool name, action index) -> memo`, recovered from the
/// transaction with the wallet's outgoing viewing keys. An output that these keys cannot open is
/// missing: the payer used other keys, or the ciphertext was changed.
pub(crate) fn recover(p: &Pczt, fvk: &FullViewingKey) -> R<HashMap<(String, usize), MemoView>> {
    let tx = p.clone().into_effects().map_err(e("effects"))?;
    let ovks = [fvk.to_ovk(Scope::External), fvk.to_ovk(Scope::Internal)];
    let mut out = HashMap::new();
    for (pool, bundle) in [("Orchard", tx.orchard_bundle()), ("Ironwood", tx.ironwood_bundle())] {
        let found = bundle.map(|b| b.recover_outputs_with_ovks(&ovks)).unwrap_or_default();
        for (i, _, _, _, field) in found {
            out.insert((pool.to_string(), i), MemoView::of(&field));
        }
    }
    Ok(out)
}

/// Adds `memo_status` (`empty`, `text`, `not_text` or `unknown`) and, for text, `memo` to every
/// output line of `inspect`. `unknown` means that the engine could not read the memo; the caller
/// must not treat it as an empty memo.
pub(crate) fn annotate(lines: &mut [Value], memos: &HashMap<(String, usize), MemoView>) {
    for line in lines.iter_mut().filter(|l| l["kind"] == "output") {
        let key = (
            line["pool"].as_str().unwrap_or_default().to_string(),
            line["action"].as_u64().unwrap_or(u64::MAX) as usize,
        );
        match memos.get(&key) {
            Some(MemoView::Text(t)) => {
                line["memo_status"] = json!("text");
                line["memo"] = json!(t);
            }
            Some(view) => line["memo_status"] = json!(view.status()),
            None => line["memo_status"] = json!("unknown"),
        }
    }
}

pub(crate) fn commitment_bytes(note: &orchard::Note) -> [u8; 32] {
    ExtractedNoteCommitment::from(note.commitment()).to_bytes()
}

/// The Ironwood notes of `ivk` in the transaction `raw`: its id (as text) and, for each note, the
/// bytes of its commitment and what its memo holds. Only the ciphertext authenticates a memo, so
/// the result is right even when the server that sent `raw` is not.
pub(crate) fn received(
    raw: &[u8],
    ivk: &IncomingViewingKey,
) -> R<(String, Vec<([u8; 32], MemoView)>)> {
    // The branch id matters for version 4 transactions only; Ironwood needs version 6.
    let tx = Transaction::read(raw, BranchId::Nu6_3).map_err(e("transaction"))?;
    let found = tx.ironwood_bundle().map(|b| b.decrypt_outputs_with_keys(&[ivk.clone()]));
    let notes = found
        .unwrap_or_default()
        .iter()
        .map(|(_, _, note, _, field)| (commitment_bytes(note), MemoView::of(field)))
        .collect();
    Ok((tx.txid().to_string(), notes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn field(bytes: &[u8]) -> [u8; MEMO_BYTES] {
        let mut f = [0u8; MEMO_BYTES];
        f[..bytes.len()].copy_from_slice(bytes);
        f
    }

    #[test]
    fn a_field_is_classified_by_its_first_byte() {
        assert_eq!(MemoView::of(&MemoBytes::empty().into_bytes()), MemoView::Empty);
        assert_eq!(MemoView::of(&field(b"")), MemoView::Empty, "an empty text shows nothing");
        let text = "héllo ✓";
        assert_eq!(MemoView::of(&field(text.as_bytes())), MemoView::Text(text.into()));
        assert_eq!(MemoView::of(&field(&[0xFF, 1, 2])), MemoView::NotText, "arbitrary data");
        assert_eq!(MemoView::of(&field(&[0xF7, b'a'])), MemoView::NotText, "a future format");
        assert_eq!(MemoView::of(&field(&[b'a', 0xC3])), MemoView::NotText, "broken UTF-8");
        let mut odd = MemoBytes::empty().into_bytes();
        odd[9] = 1;
        assert_eq!(MemoView::of(&odd), MemoView::NotText, "0xF6 with data after it");
        let full = "é".repeat(256);
        assert_eq!(MemoView::of(&field(full.as_bytes())), MemoView::Text(full));
    }

    #[test]
    fn views_survive_json() {
        for v in [MemoView::Empty, MemoView::NotText, MemoView::Text("a \"b\"\n".into())] {
            assert_eq!(MemoView::from_json(&v.to_json()).unwrap(), v);
        }
        assert!(MemoView::from_json(&json!({"status": "text"})).is_err());
        assert!(MemoView::from_json(&json!(null)).is_err());
    }

    #[test]
    fn memos_to_send_are_checked() {
        let bytes = |v: Value| parse_memo(&v).map(|m| m.into_bytes());
        assert_eq!(bytes(json!(null)).unwrap(), MemoBytes::empty().into_bytes());
        assert_eq!(bytes(json!("")).unwrap(), MemoBytes::empty().into_bytes());
        assert_eq!(bytes(json!("hi")).unwrap(), field(b"hi"));
        let top = "é".repeat(256);
        assert_eq!(bytes(json!(top)).unwrap()[..4], [0xC3, 0xA9, 0xC3, 0xA9]);
        let err = |v: Value| parse_memo(&v).unwrap_err();
        assert!(err(json!("é".repeat(256) + "a")).contains("513 bytes"));
        assert!(err(json!("a".repeat(600))).contains("limit is 512"));
        assert!(err(json!(5)).contains("must be text"));
        assert!(err(json!(["x"])).contains("must be text"));
        assert!(err(json!("a\0b")).contains("null character"));
    }
}
