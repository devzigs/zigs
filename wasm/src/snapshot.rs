//! JSON snapshots of a wallet's sync state: notes and the note commitment tree. They let a
//! reloaded page continue from its last synced block instead of the wallet birthday.

use std::{collections::BTreeSet, sync::Arc};

use incrementalmerkletree::{Address, Level, Position};
use orchard::{
    note::{RandomSeed, Rho},
    tree::MerkleHashOrchard,
    value::NoteValue,
    Note, NoteVersion,
};
use serde_json::{json, Value};
use shardtree::{
    store::{memory::MemoryShardStore, Checkpoint, ShardStore, TreeState},
    LocatedTree, Node, PrunableTree, RetentionFlags, Tree,
};
use zcash_protocol::consensus::BlockHeight;

use super::R;

pub(crate) type Store = MemoryShardStore<MerkleHashOrchard, BlockHeight>;
type Hashes = PrunableTree<MerkleHashOrchard>;

fn bad(what: &str) -> String {
    format!("the saved wallet state is damaged ({what})")
}

pub(crate) fn hex32(v: &Value, what: &str) -> R<[u8; 32]> {
    let raw = hex::decode(v.as_str().unwrap_or_default()).map_err(|_| bad(what))?;
    raw.try_into().map_err(|_| bad(what))
}

fn hash_of(v: &Value) -> R<MerkleHashOrchard> {
    Option::from(MerkleHashOrchard::from_bytes(&hex32(v, "tree hash")?)).ok_or_else(|| bad("tree hash"))
}

// Nil is null, a leaf is ["L", hash, flags], a parent is ["P", hash or null, left, right].
fn encode_node(t: &Hashes) -> Value {
    match &**t {
        Node::Nil => Value::Null,
        Node::Leaf { value: (h, flags) } => json!(["L", hex::encode(h.to_bytes()), flags.bits()]),
        Node::Parent { ann, left, right } => {
            json!(["P", ann.as_ref().map(|h| hex::encode(h.to_bytes())), encode_node(left), encode_node(right)])
        }
    }
}

fn decode_node(v: &Value) -> R<Hashes> {
    if v.is_null() {
        return Ok(Tree::empty());
    }
    match v[0].as_str() {
        Some("L") => {
            let flags = v[2].as_u64().and_then(|b| u8::try_from(b).ok()).and_then(RetentionFlags::from_bits);
            Ok(Tree::leaf((hash_of(&v[1])?, flags.ok_or_else(|| bad("leaf flags"))?)))
        }
        Some("P") => {
            let ann = if v[1].is_null() { None } else { Some(Arc::new(hash_of(&v[1])?)) };
            Ok(Tree::parent(ann, decode_node(&v[2])?, decode_node(&v[3])?))
        }
        _ => Err(bad("tree node")),
    }
}

fn store_err(x: std::convert::Infallible) -> String {
    match x {}
}

pub(crate) fn encode_store(store: &Store) -> R<Value> {
    let mut shards = vec![];
    for addr in store.get_shard_roots().map_err(store_err)? {
        if let Some(s) = store.get_shard(addr).map_err(store_err)? {
            shards.push(json!([u8::from(addr.level()), addr.index(), encode_node(s.root())]));
        }
    }
    let mut checkpoints = vec![];
    store
        .for_each_checkpoint(usize::MAX, |id, cp| {
            let at = match cp.tree_state() {
                TreeState::Empty => None,
                TreeState::AtPosition(p) => Some(u64::from(p)),
            };
            let marks: Vec<u64> = cp.marks_removed().iter().map(|p| u64::from(*p)).collect();
            checkpoints.push(json!([u32::from(*id), at, marks]));
            Ok(())
        })
        .map_err(store_err)?;
    Ok(json!({"cap": encode_node(&store.get_cap().map_err(store_err)?), "shards": shards, "checkpoints": checkpoints}))
}

pub(crate) fn decode_store(v: &Value) -> R<Store> {
    let mut store = Store::empty();
    store.put_cap(decode_node(&v["cap"])?).map_err(store_err)?;
    for s in v["shards"].as_array().ok_or_else(|| bad("shards"))? {
        let level = s[0].as_u64().and_then(|l| u8::try_from(l).ok()).ok_or_else(|| bad("shard level"))?;
        let addr = Address::from_parts(Level::from(level), s[1].as_u64().ok_or_else(|| bad("shard index"))?);
        let shard = LocatedTree::from_parts(addr, decode_node(&s[2])?).map_err(|_| bad("shard shape"))?;
        store.put_shard(shard).map_err(store_err)?;
    }
    for c in v["checkpoints"].as_array().ok_or_else(|| bad("checkpoints"))? {
        let id = c[0].as_u64().and_then(|h| u32::try_from(h).ok()).ok_or_else(|| bad("checkpoint id"))?;
        let state = c[1].as_u64().map_or(TreeState::Empty, |p| TreeState::AtPosition(Position::from(p)));
        let marks: BTreeSet<Position> =
            c[2].as_array().ok_or_else(|| bad("checkpoint marks"))?.iter().filter_map(Value::as_u64).map(Position::from).collect();
        store.add_checkpoint(BlockHeight::from_u32(id), Checkpoint::from_parts(state, marks)).map_err(store_err)?;
    }
    Ok(store)
}

/// Note bytes: version (1), recipient (43), value (8, little endian), rho (32), rseed (32).
pub(crate) fn encode_note(n: &Note) -> String {
    let mut b = vec![if n.version() == NoteVersion::V3 { 3 } else { 2 }];
    b.extend_from_slice(&n.recipient().to_raw_address_bytes());
    b.extend_from_slice(&n.value().inner().to_le_bytes());
    b.extend_from_slice(&n.rho().to_bytes());
    b.extend_from_slice(n.rseed().as_bytes());
    hex::encode(b)
}

pub(crate) fn decode_note(s: &str) -> R<Note> {
    let b = hex::decode(s).map_err(|_| bad("note"))?;
    if b.len() != 116 {
        return Err(bad("note length"));
    }
    let version = match b[0] {
        2 => NoteVersion::V2,
        3 => NoteVersion::V3,
        _ => return Err(bad("note version")),
    };
    let arr32 = |r: std::ops::Range<usize>| -> [u8; 32] { b[r].try_into().unwrap_or([0; 32]) };
    let recipient: [u8; 43] = b[1..44].try_into().map_err(|_| bad("note recipient"))?;
    let recipient = Option::from(orchard::Address::from_raw_address_bytes(&recipient)).ok_or_else(|| bad("note recipient"))?;
    let value = NoteValue::from_raw(u64::from_le_bytes(b[44..52].try_into().map_err(|_| bad("note value"))?));
    let rho = Option::from(Rho::from_bytes(&arr32(52..84))).ok_or_else(|| bad("note rho"))?;
    let rseed = Option::from(RandomSeed::from_bytes(arr32(84..116), &rho)).ok_or_else(|| bad("note seed"))?;
    Option::from(Note::from_parts(recipient, value, rho, rseed, version)).ok_or_else(|| bad("note"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use incrementalmerkletree::Retention;
    use shardtree::ShardTree;

    fn leaf(i: u8) -> MerkleHashOrchard {
        let mut b = [0u8; 32];
        b[0] = i;
        Option::from(MerkleHashOrchard::from_bytes(&b)).expect("small values are field elements")
    }

    #[test]
    fn tree_survives_a_round_trip() {
        let mut tree: ShardTree<Store, 32, 16> = ShardTree::new(Store::empty(), 100);
        for i in 0..40u8 {
            let marking = if i % 7 == 3 { incrementalmerkletree::Marking::Marked } else { incrementalmerkletree::Marking::None };
            let retention = if i % 10 == 9 {
                Retention::Checkpoint { id: BlockHeight::from_u32(u32::from(i)), marking }
            } else if marking == incrementalmerkletree::Marking::Marked {
                Retention::Marked
            } else {
                Retention::Ephemeral
            };
            tree.append(leaf(i + 1), retention).unwrap();
        }
        let json = encode_store(tree.store()).unwrap().to_string();
        let back: ShardTree<Store, 32, 16> = ShardTree::new(decode_store(&serde_json::from_str(&json).unwrap()).unwrap(), 100);
        for depth in 0..3 {
            assert_eq!(tree.root_at_checkpoint_depth(Some(depth)).unwrap(), back.root_at_checkpoint_depth(Some(depth)).unwrap());
        }
        let p = Position::from(10u64);
        assert_eq!(tree.witness_at_checkpoint_depth(p, 0).unwrap(), back.witness_at_checkpoint_depth(p, 0).unwrap());
        assert!(decode_store(&json!({"cap": ["X"], "shards": [], "checkpoints": []})).is_err());
    }

    #[test]
    fn note_survives_a_round_trip() {
        use orchard::keys::{FullViewingKey, Scope, SpendingKey};
        let fvk = FullViewingKey::from(&Option::<SpendingKey>::from(SpendingKey::from_bytes([7; 32])).unwrap());
        let rho = Option::from(Rho::from_bytes(&[5; 32])).unwrap();
        let rseed = Option::from(RandomSeed::from_bytes([9; 32], &rho)).unwrap();
        let note: Note = Option::from(Note::from_parts(fvk.address_at(0u32, Scope::External), NoteValue::from_raw(12_345), rho, rseed, NoteVersion::V3)).unwrap();
        let back = decode_note(&encode_note(&note)).unwrap();
        assert_eq!(encode_note(&back), encode_note(&note));
        assert_eq!(back.nullifier(&fvk), note.nullifier(&fvk));
        assert_eq!(back.version(), NoteVersion::V3);
    }

    #[test]
    fn damaged_notes_are_rejected() {
        assert!(decode_note("00").is_err());
        assert!(decode_note(&"ff".repeat(116)).is_err());
    }
}
