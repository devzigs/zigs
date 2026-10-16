//! Zcash testnet sync, balance, spend creation and broadcast for one group
//! viewing key. The wallet only reads the chain through a grpc-web proxy.

use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    convert::Infallible,
    rc::Rc,
};

use incrementalmerkletree::{frontier::Frontier, Marking, Position, Retention};
use orchard::{keys::Scope, note::Nullifier, tree::MerkleHashOrchard};
use pczt::Pczt;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::{json, Value};
use shardtree::{store::memory::MemoryShardStore, ShardTree};
use wasm_bindgen::prelude::*;
use zcash_client_backend::{
    data_api::{BlockMetadata, ScannedBlock},
    proto::{
        compact_formats::CompactBlock,
        service::{
            compact_tx_streamer_client::CompactTxStreamerClient, BlockId, BlockRange, ChainSpec,
            RawTransaction, TreeState, TxFilter,
        },
    },
    scanning::{scan_block, ScanningKeys, SpendIdentifiers},
};
use zcash_keys::{address::Address, keys::UnifiedFullViewingKey};
use zcash_primitives::block::BlockHash;
use zcash_protocol::{
    consensus::{BlockHeight, Network},
    memo::MemoBytes,
    TxId,
};

use super::{
    account, build_ironwood_pczt, e, ensure, expiry,
    memo::{commitment_bytes, parse_memo, received as memos_in, MemoView},
    pczt_to_b64,
    snapshot::{decode_note, decode_store, encode_note, encode_store, hex32},
    Payee, Terms, R,
};

const BATCH: u32 = 1000;
const CONFIRMATIONS: u32 = 3;
const MARGINAL_FEE: u64 = 5000;
/// A priority payment pays this many times the ZIP 317 fee, and no payment pays more. Zebra 7.0
/// (NU7) raises the weight ratio cap of its block template from 4 to 10, so a higher fee buys a
/// faster block up to this ratio.
pub(crate) const PRIORITY_FACTOR: u64 = 10;
/// The most blocks that a reorganisation can undo.
const REORG_DEPTH: usize = 100;
/// Block hashes and tree checkpoints that the wallet keeps: one more than it can undo, because
/// the fork block itself must stay.
const KEPT: usize = REORG_DEPTH + 1;
/// Transactions that one call of `memo_needs` lists.
const MEMO_BATCH: usize = 25;
/// The largest transaction that `attach_transaction` reads: the consensus limit on the size of a
/// block, which no transaction can exceed. A larger answer comes from a faulty server.
const MAX_TX_BYTES: usize = 2_000_000;
/// The opening words of the error for a reorganisation that is deeper than the wallet can undo.
/// The apps ask `is_deep_reorg` for them, so they never keep their own copy of the text.
pub(crate) const DEEP_REORG: &str = "the chain reorganised by more than";

/// True when `message` is the error of a reorganisation that is deeper than the wallet can undo.
/// The saved state of the wallet is then of no use, and the wallet must scan again. Only the
/// start counts: server errors start with "lightwalletd: ", and a server chooses their text.
pub(crate) fn is_deep_reorg(message: &str) -> bool {
    message.starts_with(DEEP_REORG)
}

/// The opening words of the error for a transaction that the node refused. Any other broadcast
/// error (a timeout, a lost connection) leaves open whether the node took the transaction.
pub(crate) const NODE_REFUSED: &str = "node rejected the transaction";

/// True when `message` is the error of a node that answered and refused the transaction. Only the
/// start counts: server errors start with "lightwalletd: ", and a server chooses their text.
pub(crate) fn is_node_refusal(message: &str) -> bool {
    message.starts_with(NODE_REFUSED)
}

type Client = CompactTxStreamerClient<tonic_web_wasm_client::Client>;
type Tree = ShardTree<MemoryShardStore<MerkleHashOrchard, BlockHeight>, 32, 16>;

fn client(endpoint: &str) -> Client {
    CompactTxStreamerClient::new(tonic_web_wasm_client::Client::new(endpoint.to_string()))
}

fn rpc(s: tonic::Status) -> String {
    format!("lightwalletd: {}", s.message())
}

async fn tip_of(endpoint: &str) -> R<u32> {
    let id = client(endpoint).get_latest_block(ChainSpec {}).await.map_err(rpc)?.into_inner();
    u32::try_from(id.height).map_err(e("tip height"))
}

fn block_id(height: u32) -> BlockId {
    BlockId { height: height.into(), hash: vec![] }
}

/// Reads a unified viewing key. Its encoding names its network (uview1… or uviewtest1…).
pub(crate) fn decode_ufvk(text: &str) -> R<(Network, UnifiedFullViewingKey)> {
    [Network::MainNetwork, Network::TestNetwork]
        .into_iter()
        .find_map(|net| UnifiedFullViewingKey::decode(&net, text).ok().map(|k| (net, k)))
        .ok_or_else(|| "bad viewing key: not a mainnet or testnet unified viewing key".to_string())
}

struct Rec {
    note: orchard::Note,
    position: Position,
    height: u32,
    nf: Nullifier,
    /// Height of the block that spent the note.
    spent: Option<u32>,
    txid: String,
    change: bool,
    /// What the memo holds. None until the full transaction is read (never for change).
    memo: Option<MemoView>,
}

impl Rec {
    fn value(&self) -> u64 {
        self.note.value().inner()
    }
}

/// What `apply_block` did with a block.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Step {
    Applied,
    /// The block does not follow the stored tip. The wallet dropped its newest block, so the
    /// caller must ask for blocks again from `synced + 1`.
    Rewound,
}

struct Inner {
    net: Network,
    ufvk: UnifiedFullViewingKey,
    birthday: u32,
    endpoint: String,
    tree: Tree,
    keys: ScanningKeys<u32, (u32, Scope)>,
    notes: Vec<Rec>,
    /// Transactions that spent our notes, as seen in blocks: proof that a payment went out.
    /// Each has the height of its block.
    sent: Vec<(String, u32)>,
    synced: u32,
    tip: u32,
    /// Metadata of the last `KEPT` blocks, oldest first. The last one is the stored tip.
    chain: Vec<BlockMetadata>,
    busy: bool,
    /// How often `memo_needs` listed a transaction. Not saved: a restart starts again at zero.
    memo_listed: HashMap<String, u32>,
}

impl Inner {
    fn new(ufvk: &str, birthday: u32, endpoint: &str) -> R<Inner> {
        let (net, ufvk) = decode_ufvk(ufvk)?;
        let keys = ScanningKeys::from_account_ufvks([(0u32, ufvk.clone())]);
        Ok(Inner {
            net,
            ufvk,
            birthday,
            endpoint: endpoint.to_string(),
            tree: ShardTree::new(MemoryShardStore::empty(), KEPT),
            keys,
            notes: vec![],
            sent: vec![],
            synced: 0,
            tip: 0,
            chain: vec![],
            busy: false,
            memo_listed: HashMap::new(),
        })
    }

    /// Starts an empty wallet from the Ironwood tree state at `birthday - 1`. The hash of that
    /// block becomes the first stored block, so the first scanned block must chain onto it. A
    /// fork below the birthday then reaches the deep-reorganisation error, and the wallet scans
    /// again from a fresh tree state.
    fn start(&mut self, ts: &TreeState) -> R<()> {
        ensure(self.birthday > 0, "wallet birthday must be positive")?;
        let base = self.birthday - 1;
        ensure(ts.height == u64::from(base), &format!("lightwalletd sent the tree state of block \
            {} for block {base}", ts.height))?;
        let bad_hash = || "lightwalletd sent a tree state with a bad block hash".to_string();
        let mut hash = hex::decode(&ts.hash).map_err(|_| bad_hash())?;
        hash.reverse();   // lightwalletd writes block hashes in display order
        let hash: [u8; 32] = hash.try_into().map_err(|_| bad_hash())?;
        let frontier: Frontier<MerkleHashOrchard, 32> =
            ts.ironwood_tree().map_err(e("ironwood tree state"))?.to_frontier();
        let id = BlockHeight::from_u32(base);
        let retention = Retention::Checkpoint { id, marking: Marking::None };
        self.tree.insert_frontier(frontier, retention).map_err(e("tree frontier"))?;
        // Without tree sizes the scanner takes them from the first block, as it did before.
        self.chain = vec![BlockMetadata::from_parts(id, BlockHash(hash), None, None, None)];
        self.synced = base;
        Ok(())
    }

    /// The stored tip, if the wallet has scanned a block since it started.
    fn prior(&self) -> Option<&BlockMetadata> {
        self.chain.last()
    }

    /// True when `block` does not follow the stored tip.
    fn forks(&self, block: &CompactBlock) -> bool {
        self.prior().is_some_and(|p| block.prev_hash[..] != p.block_hash().0[..])
    }

    /// Scans `block`, which must be the one after `synced`. A block that does not chain onto the
    /// stored tip makes the wallet drop its newest block and return `Step::Rewound`: the tip was
    /// on a branch that the chain left. Asking for blocks again from `synced + 1` repeats this
    /// until a block chains, so the wallet finds the fork one block at a time.
    fn apply_block(&mut self, block: CompactBlock) -> R<Step> {
        let height = u32::try_from(block.height).map_err(e("block height"))?;
        ensure(
            block.hash.len() == 32 && block.prev_hash.len() == 32,
            &format!("lightwalletd sent block {height} with a hash of the wrong length"),
        )?;
        if self.forks(&block) {
            self.rewind_one()?;
            return Ok(Step::Rewound);
        }
        // Spends are matched against our own notes rather than through the scanner, whose
        // watch list cannot be rebuilt from a snapshot.
        let spends: Vec<(String, Vec<Vec<u8>>)> = block
            .vtx
            .iter()
            .map(|tx| (txid_text(&tx.txid), tx.ironwood_actions.iter().map(|a| a.nullifier.clone()).collect()))
            .collect();
        let sb = scan_block::<_, _, _, Infallible>(
            &self.net,
            block,
            &self.keys,
            &SpendIdentifiers::empty(),
            self.prior(),
        )
        .map_err(|x| format!("scan failed at block {height}: {x:?}"))?;
        self.record_notes(&sb, height)?;
        self.mark_spent(&spends, height);
        self.chain.push(sb.to_block_metadata());
        if self.chain.len() > KEPT {
            self.chain.remove(0);
        }
        let commitments = sb.into_commitments().ironwood;
        let checkpointed = commitments.last().is_some_and(|(_, r)| r.is_checkpoint());
        for (cmx, retention) in commitments {
            self.tree.append(cmx, retention).map_err(e("tree append"))?;
        }
        if !checkpointed {
            self.tree.checkpoint(BlockHeight::from_u32(height)).map_err(e("tree checkpoint"))?;
        }
        self.synced = height;
        Ok(Step::Applied)
    }

    fn record_notes(&mut self, sb: &ScannedBlock<u32>, height: u32) -> R<()> {
        for tx in sb.transactions() {
            let txid = tx.txid().to_string();
            for out in tx.ironwood_outputs() {
                let nf = *out.nf().ok_or("decrypted note has no nullifier")?;
                let note = out.note().0;
                let position = out.note_commitment_tree_position();
                // Change goes to the internal address. The scanner's own change flag needs its
                // spend watch list, which this wallet does not keep.
                let change = out.recipient_key_scope() == Some(Scope::Internal);
                let (txid, spent, memo) = (txid.clone(), None, None);
                self.notes.push(Rec { note, position, height, nf, spent, txid, change, memo });
            }
        }
        Ok(())
    }

    fn mark_spent(&mut self, spends: &[(String, Vec<Vec<u8>>)], height: u32) {
        for (txid, nfs) in spends {
            let mut hit = false;
            for n in self.notes.iter_mut().filter(|n| n.spent.is_none()) {
                if nfs.iter().any(|nf| nf[..] == n.nf.to_bytes()[..]) {
                    n.spent = Some(height);
                    hit = true;
                }
            }
            if hit && !self.sent.iter().any(|(t, _)| t == txid) {
                self.sent.push((txid.clone(), height));
            }
        }
    }

    /// Drops the newest block: the tree goes back to the checkpoint before it, and the notes,
    /// spends, sent marks and memos that belong to it go away.
    fn rewind_one(&mut self) -> R<()> {
        let deep = || {
            format!(
                "{DEEP_REORG} {REORG_DEPTH} blocks. Scan the wallet again \
                 from its birthday."
            )
        };
        let target = self.synced.checked_sub(1).filter(|t| *t >= self.birthday.saturating_sub(1));
        let target = target.ok_or_else(deep)?;
        let truncated = self.tree.truncate_to_checkpoint(&BlockHeight::from_u32(target));
        ensure(matches!(truncated, Ok(true)), &deep())?;
        self.notes.retain(|n| n.height <= target);
        for n in self.notes.iter_mut().filter(|n| n.spent.is_some_and(|h| h > target)) {
            n.spent = None;
        }
        self.sent.retain(|(_, h)| *h <= target);
        self.chain.retain(|b| u32::from(b.block_height()) <= target);
        self.synced = target;
        Ok(())
    }

    fn snapshot(&self) -> R<String> {
        let notes: Vec<Value> = self
            .notes
            .iter()
            .map(|n| {
                json!({"note": encode_note(&n.note), "pos": u64::from(n.position), "h": n.height,
                    "nf": hex::encode(n.nf.to_bytes()), "spent": n.spent, "txid": n.txid,
                    "change": n.change, "memo": n.memo.as_ref().map(MemoView::to_json)})
            })
            .collect();
        let sent: Vec<Value> = self.sent.iter().map(|(t, h)| json!({"txid": t, "h": h})).collect();
        let blocks: Vec<Value> = self
            .chain
            .iter()
            .map(|p| {
                json!({"h": u32::from(p.block_height()), "hash": hex::encode(p.block_hash().0),
                    "s": p.sapling_tree_size(), "o": p.orchard_tree_size(),
                    "i": p.ironwood_tree_size()})
            })
            .collect();
        Ok(json!({"v": 3, "birthday": self.birthday, "synced": self.synced, "sent": sent,
            "blocks": blocks, "notes": notes, "tree": encode_store(self.tree.store())?})
        .to_string())
    }

    fn restore(&mut self, text: &str) -> R<()> {
        let v: Value = serde_json::from_str(text).map_err(e("saved wallet state"))?;
        // Older formats are dropped and resynced: version 1 marked change as received money,
        // and version 2 kept no block hashes for reorganisations.
        ensure(v["v"] == 3, "the saved wallet state has an old or unknown format")?;
        ensure(v["birthday"] == self.birthday, "the saved wallet state belongs to another wallet")?;
        let list = |k: &str, what: &str| v[k].as_array().ok_or(format!("saved {what}"));
        let synced = v["synced"].as_u64().and_then(|h| u32::try_from(h).ok());
        let synced = synced.ok_or("saved height")?;
        let chain: Vec<BlockMetadata> =
            list("blocks", "block hashes")?.iter().map(block_of).collect::<R<_>>()?;
        let at_start = synced == 0 || synced + 1 == self.birthday;
        let tip_ok = chain.last().map_or(at_start, |b| u32::from(b.block_height()) == synced);
        ensure(tip_ok && chain.len() <= KEPT, "the saved wallet state is damaged (blocks)")?;
        self.tree = ShardTree::new(decode_store(&v["tree"])?, KEPT);
        self.notes = list("notes", "notes")?.iter().map(rec_of).collect::<R<_>>()?;
        self.sent = list("sent", "sends")?.iter().map(sent_of).collect::<R<_>>()?;
        self.synced = synced;
        self.chain = chain;
        Ok(())
    }

    fn balance(&self) -> String {
        let (mut spendable, mut pending, mut count) = (0u64, 0u64, 0u64);
        let mut values = vec![];
        for n in self.notes.iter().filter(|n| n.spent.is_none()) {
            values.push((n.value(), n.height));
            count += 1;
            if is_confirmed(n.height, self.synced) {
                spendable += n.value();
            } else {
                pending += n.value();
            }
        }
        json!({"height": self.synced, "tip": self.tip, "spendable": spendable,
            "pending": pending, "notes": count, "max_send": max_send(&values, self.synced)})
        .to_string()
    }
}

impl Inner {
    /// Payments into this wallet from outside, newest first: one entry per transaction. `memos`
    /// lists the text and non-text memos of its notes (an empty memo shows nothing). Each memo
    /// has the `index` of the address that received its note: a number, or null when it does not
    /// fit in a u32. `indexes` lists the same for every note of the transaction, also a note whose
    /// memo is empty or not read yet: it names each address that got a payment. `memo_pending` is
    /// true while the full transaction of a note is not read yet.
    ///
    /// `ponytail:` the index is found again at each call, about 0.1 ms for each memo. Upgrade path:
    /// save it with the note when the block is scanned.
    fn received(&self) -> String {
        let ivk = self.ufvk.orchard().map(|fvk| fvk.to_ivk(Scope::External));
        let index = |n: &Rec| {
            let j = ivk.as_ref()?.diversifier_index(&n.note.recipient())?;
            u32::try_from(j).ok()
        };
        let mut by_tx: Vec<(String, u32, u64, Vec<&Rec>)> = vec![];
        for n in self.notes.iter().filter(|n| !n.change) {
            match by_tx.iter_mut().find(|(t, ..)| *t == n.txid) {
                Some(entry) => {
                    entry.2 += n.value();
                    entry.3.push(n);
                }
                None => by_tx.push((n.txid.clone(), n.height, n.value(), vec![n])),
            }
        }
        by_tx.sort_by_key(|(_, h, ..)| std::cmp::Reverse(*h));
        let list: Vec<_> = by_tx
            .iter()
            .map(|(txid, height, value, notes)| {
                let memos: Vec<Value> = notes
                    .iter()
                    .filter_map(|n| n.memo.as_ref().map(|m| (*n, m)))
                    .filter(|(_, m)| **m != MemoView::Empty)
                    .map(|(n, m)| {
                        let mut entry = m.to_json();
                        entry["index"] = json!(index(n));
                        entry
                    })
                    .collect();
                json!({"txid": txid, "height": height, "value": value,
                    "confirmed": is_confirmed(*height, self.synced), "memos": memos,
                    "indexes": notes.iter().map(|n| index(n)).collect::<Vec<_>>(),
                    "memo_pending": notes.iter().any(|n| n.memo.is_none())})
            })
            .collect();
        json!(list).to_string()
    }

    /// Transactions whose memos are not read yet, as `{"txid", "hash", "height"}`: `hash` is the
    /// transaction id in the byte order that `GetTransaction` takes, in hex. At most `MEMO_BATCH`.
    /// Every call counts as one try for each transaction it lists, and the transactions that were
    /// listed least come first, the oldest first among equals. A transaction that never gives its
    /// memo therefore moves back and cannot hold up the ones behind it.
    /// `ponytail:` a run that stops early still counts its unread transactions. Upgrade path: a
    /// count of failed reads, set by the caller.
    fn memo_needs(&mut self) -> R<String> {
        let mut seen = HashSet::new();
        let mut pending: Vec<(String, u32)> = vec![];
        for n in self.notes.iter().filter(|n| !n.change && n.memo.is_none()) {
            if seen.insert(n.txid.clone()) {
                pending.push((n.txid.clone(), n.height));
            }
        }
        pending.sort_by_key(|(txid, _)| self.memo_listed.get(txid).copied().unwrap_or(0));
        pending.truncate(MEMO_BATCH);
        let mut list: Vec<Value> = vec![];
        for (txid, height) in pending {
            let mut hash = hex::decode(&txid).map_err(e("saved transaction id"))?;
            hash.reverse();
            *self.memo_listed.entry(txid.clone()).or_default() += 1;
            list.push(json!({"txid": txid, "hash": hex::encode(hash), "height": height}));
        }
        Ok(json!(list).to_string())
    }

    /// Reads the memos of our notes from the full transaction `raw` (the bytes that
    /// `GetTransaction` returns) of the transaction `expected` (the `txid` of `memo_needs`).
    /// Returns how many notes left the pending state.
    ///
    /// The id of a transaction commits to every note ciphertext, tag included (ZIP 244). So a
    /// transaction with the expected id is the one on the chain, whatever server sent it. A note
    /// of it that cannot be decrypted in full has a damaged ciphertext on the chain. Its memo
    /// can never be read, so it is saved as `NotText` and the note is not asked for again.
    /// Anything else is an error that leaves every note pending: a transaction that is too
    /// large, that does not parse, or that has another id came from a faulty server. A
    /// transaction without pending notes is not an error (a reorganisation or an earlier call
    /// may have settled them).
    fn attach_transaction(&mut self, expected: &str, raw: &[u8]) -> R<usize> {
        let big = "the transaction is larger than a block can be";
        ensure(raw.len() <= MAX_TX_BYTES, big)?;
        let fvk = self.ufvk.orchard().ok_or("the viewing key has no Orchard component")?;
        let (txid, found) = memos_in(raw, &fvk.to_ivk(Scope::External))?;
        ensure(txid == expected, &format!("the server sent transaction {txid}, not {expected}"))?;
        let mut settled = 0;
        let waiting = |n: &&mut Rec| n.txid == txid && !n.change && n.memo.is_none();
        for rec in self.notes.iter_mut().filter(waiting) {
            let mine = commitment_bytes(&rec.note);
            let view = found.iter().find(|(cmx, _)| *cmx == mine).map(|(_, view)| view.clone());
            rec.memo = Some(view.unwrap_or(MemoView::NotText));
            settled += 1;
        }
        self.memo_listed.remove(&txid);
        Ok(settled)
    }
}

fn txid_text(raw: &[u8]) -> String {
    <[u8; 32]>::try_from(raw).map(|b| TxId::from_bytes(b).to_string()).unwrap_or_default()
}

fn rec_of(v: &Value) -> R<Rec> {
    let nf = Option::from(Nullifier::from_bytes(&hex32(&v["nf"], "nullifier")?)).ok_or("saved nullifier")?;
    let height = |x: &Value| x.as_u64().and_then(|h| u32::try_from(h).ok());
    let memo = if v["memo"].is_null() { None } else { Some(MemoView::from_json(&v["memo"])?) };
    Ok(Rec {
        note: decode_note(v["note"].as_str().unwrap_or_default())?,
        position: Position::from(v["pos"].as_u64().ok_or("saved position")?),
        height: height(&v["h"]).ok_or("saved note height")?,
        nf,
        spent: match &v["spent"] {
            Value::Null => None,
            x => Some(height(x).ok_or("saved spend height")?),
        },
        txid: v["txid"].as_str().unwrap_or_default().to_string(),
        change: v["change"].as_bool().unwrap_or(false),
        memo,
    })
}

fn sent_of(v: &Value) -> R<(String, u32)> {
    let height = v["h"].as_u64().and_then(|h| u32::try_from(h).ok());
    Ok((v["txid"].as_str().ok_or("saved send")?.to_string(), height.ok_or("saved send height")?))
}

fn block_of(v: &Value) -> R<BlockMetadata> {
    let size = |k: &str| v[k].as_u64().and_then(|n| u32::try_from(n).ok());
    let height = v["h"].as_u64().and_then(|h| u32::try_from(h).ok()).ok_or("saved block height")?;
    Ok(BlockMetadata::from_parts(BlockHeight::from_u32(height), BlockHash(hex32(&v["hash"], "block hash")?), size("s"), size("o"), size("i")))
}

fn is_confirmed(note_height: u32, synced: u32) -> bool {
    note_height + CONFIRMATIONS - 1 <= synced
}

#[derive(Debug)]
struct Pick {
    picked: Vec<usize>,
    fee: u64,
    change: u64,
    total: u64,
}

/// ZIP 317 fee for an Ironwood bundle: one action per spend or output, whichever is more.
pub(crate) fn zip317_fee(spends: usize, outputs: usize) -> u64 {
    MARGINAL_FEE * spends.max(outputs).max(2) as u64
}

/// `notes` is `(value, height)` of each unspent note. Picks confirmed notes, largest first.
/// `outputs` counts every output, change included. The fee is `factor` times the ZIP 317 fee.
fn select_notes(
    notes: &[(u64, u32)], amount: u64, outputs: usize, synced: u32, factor: u64,
) -> R<Pick> {
    ensure(amount > 0, "amount must be greater than zero")?;
    pick_notes(notes, amount, outputs, synced, factor)
}

/// `select_notes` for an `amount` that may be zero, as in a message, which pays only the fee. A
/// note of zero value is a message part that someone sent: spending it only adds to the fee.
fn pick_notes(
    notes: &[(u64, u32)], amount: u64, outputs: usize, synced: u32, factor: u64,
) -> R<Pick> {
    let mut eligible: Vec<usize> = (0..notes.len())
        .filter(|&i| is_confirmed(notes[i].1, synced) && notes[i].0 > 0)
        .collect();
    eligible.sort_by_key(|&i| std::cmp::Reverse(notes[i].0));
    let (mut picked, mut total) = (vec![], 0u64);
    for i in eligible {
        picked.push(i);
        total += notes[i].0;
        let fee = zip317_fee(picked.len(), outputs) * factor;
        if total >= amount.saturating_add(fee) {
            return Ok(Pick { picked, fee, change: total - amount - fee, total });
        }
    }
    let need = amount.saturating_add(zip317_fee(picked.len(), outputs) * factor);
    Err(format!("not enough funds: {total} zat spendable, {need} zat needed (amount + fee)"))
}

/// The largest amount one payment can send: every confirmed note, less the fee for spending them.
fn max_send(notes: &[(u64, u32)], synced: u32) -> u64 {
    let confirmed: Vec<u64> =
        notes.iter().filter(|n| is_confirmed(n.1, synced) && n.0 > 0).map(|n| n.0).collect();
    let total: u64 = confirmed.iter().sum();
    if confirmed.is_empty() { 0 } else { total.saturating_sub(zip317_fee(confirmed.len(), 2)) }
}

/// Most recipients in one payment. ponytail: proof time grows with each action; raise this after
/// a timing test on a phone.
pub(crate) const MAX_PAYEES: usize = 20;

/// Parses `[{"to": "<unified address>", "amount": <zat>, "memo": "<text, optional>"}, …]`.
/// Errors name the row, from 1.
fn parse_payees(rows: &[Value], net: Network) -> R<Vec<Payee>> {
    ensure(!rows.is_empty(), "add at least one recipient")?;
    let most = format!("a payment can have at most {MAX_PAYEES} recipients");
    ensure(rows.len() <= MAX_PAYEES, &most)?;
    rows.iter().enumerate().map(|(i, row)| parse_payee(i + 1, row, net)).collect()
}

fn parse_payee(n: usize, row: &Value, net: Network) -> R<Payee> {
    let to = row["to"].as_str().ok_or(format!("recipient {n}: missing address"))?;
    let amount = row["amount"]
        .as_u64()
        .ok_or(format!("recipient {n}: amount must be a whole number of zatoshis"))?;
    ensure(amount > 0, &format!("recipient {n}: amount must be greater than zero"))?;
    let memo = parse_memo(&row["memo"]).map_err(|err| format!("recipient {n}: {err}"))?;
    let transparent = matches!(
        Address::decode(&net, to.trim()),
        Some(Address::Transparent(_) | Address::Tex(_))
    );
    ensure(
        memo == MemoBytes::empty() || !transparent,
        &format!("recipient {n}: a transparent address cannot receive a memo"),
    )?;
    let payee = parse_recipient(to, net).map_err(|err| format!("recipient {n}: {err}"))?;
    Ok((payee, amount, memo))
}

pub(crate) fn parse_recipient(s: &str, net: Network) -> R<orchard::Address> {
    let name = if net == Network::MainNetwork { "mainnet" } else { "testnet" };
    match Address::decode(&net, s.trim()) {
        Some(Address::Unified(ua)) => ua
            .orchard()
            .copied()
            .ok_or_else(|| "the recipient address has no Orchard receiver".to_string()),
        _ => Err(format!("the recipient must be a {name} unified address")),
    }
}

fn sent_ids(s: &Inner) -> String {
    json!(s.sent.iter().map(|(txid, _)| txid).collect::<Vec<_>>()).to_string()
}

fn attach(s: &mut Inner, txid: &str, raw_b64: &str) -> R<String> {
    let raw = B64.decode(raw_b64).map_err(|_| "the transaction is not base64".to_string())?;
    Ok(json!({"attached": s.attach_transaction(txid, &raw)?}).to_string())
}

async fn first_sync(state: &RefCell<Inner>) -> R<()> {
    let (endpoint, birthday) = {
        let s = state.borrow();
        (s.endpoint.clone(), s.birthday)
    };
    ensure(birthday > 0, "wallet birthday must be positive")?;
    let ts = client(&endpoint)
        .get_tree_state(block_id(birthday - 1))
        .await
        .map_err(rpc)?
        .into_inner();
    state.borrow_mut().start(&ts)
}

/// Reads blocks `next` to `end` into the wallet. True if the wallet rewound: the blocks did not
/// chain onto its tip, so the caller must ask again from the new `synced + 1`.
async fn apply_range(state: &RefCell<Inner>, endpoint: &str, next: u32, end: u32) -> R<bool> {
    let range = BlockRange {
        start: Some(block_id(next)),
        end: Some(block_id(end)),
        pool_types: vec![],
    };
    let mut stream = client(endpoint).get_block_range(range).await.map_err(rpc)?.into_inner();
    while let Some(block) = stream.message().await.map_err(rpc)? {
        if state.borrow_mut().apply_block(block)? == Step::Rewound {
            return Ok(true);
        }
    }
    let none = "lightwalletd returned no blocks for the requested range";
    ensure(state.borrow().synced >= next, none)?;
    Ok(false)
}

async fn sync_to_tip(state: &RefCell<Inner>, on_progress: &js_sys::Function) -> R<()> {
    if state.borrow().synced == 0 {
        first_sync(state).await?;
    }
    let endpoint = state.borrow().endpoint.clone();
    let tip = tip_of(&endpoint).await?;
    state.borrow_mut().tip = tip;
    let mut rewinds = 0;
    loop {
        let next = state.borrow().synced + 1;
        if next > tip {
            return Ok(());
        }
        if apply_range(state, &endpoint, next, tip.min(next + BATCH - 1)).await? {
            rewinds += 1;
            let flapping = "lightwalletd keeps changing its chain; try again later";
            ensure(rewinds <= REORG_DEPTH, flapping)?;
            continue;
        }
        let msg = json!({"height": state.borrow().synced, "tip": tip}).to_string();
        on_progress
            .call1(&JsValue::NULL, &JsValue::from_str(&msg))
            .map_err(|_| "the progress callback threw".to_string())?;
    }
}

async fn sync(state: &RefCell<Inner>, on_progress: &js_sys::Function) -> R<String> {
    ensure(!state.borrow().busy, "a sync is already running")?;
    state.borrow_mut().busy = true;
    let r = sync_to_tip(state, on_progress).await;
    state.borrow_mut().busy = false;
    r?;
    Ok(state.borrow().balance())
}

/// Builds the PCZT that pays `payees` and returns it with the notes that it spends. `choose`
/// picks those notes from the `(value, height)` of each unspent note.
fn build_spend(
    s: &Inner,
    payees: &[Payee],
    terms: &Terms,
    choose: impl FnOnce(&[(u64, u32)]) -> R<Pick>,
) -> R<(Pczt, Pick)> {
    let fvk = s.ufvk.orchard().ok_or("the viewing key has no Orchard component")?;
    let unspent: Vec<&Rec> = s.notes.iter().filter(|n| n.spent.is_none()).collect();
    let values: Vec<(u64, u32)> = unspent.iter().map(|n| (n.value(), n.height)).collect();
    let pick = choose(&values)?;
    let depth = (CONFIRMATIONS - 1) as usize;
    let root = s
        .tree
        .root_at_checkpoint_depth(Some(depth))
        .map_err(e("tree root"))?
        .ok_or("the wallet is not synced yet")?;
    let mut inputs = vec![];
    for &i in &pick.picked {
        let path = s
            .tree
            .witness_at_checkpoint_depth(unspent[i].position, depth)
            .map_err(e("witness"))?
            .ok_or("no Merkle path for a note; sync again")?;
        inputs.push((unspent[i].note, orchard::tree::MerklePath::from(path)));
    }
    let outs = (payees, pick.change);
    let pczt = build_ironwood_pczt(s.net, terms, fvk, (inputs, orchard::Anchor::from(root)), outs)?;
    Ok((pczt, pick))
}

/// A group payment: its approvals take hours, so it expires after the window of `expiry`.
/// `priority` pays `PRIORITY_FACTOR` times the ZIP 317 fee.
fn spend_pczt(s: &Inner, payees: &[Payee], tip: u32, priority: bool) -> R<String> {
    let amount = payees
        .iter()
        .try_fold(0u64, |sum, p| sum.checked_add(p.1))
        .ok_or("the amounts add up to more than any wallet can hold")?;
    let factor = if priority { PRIORITY_FACTOR } else { 1 };
    let target = BlockHeight::from_u32(tip + 1);
    let expiry = Some(expiry::expiry_for(&s.net, target));
    let terms = Terms { target, expiry, fee_factor: factor };
    let outputs = payees.len() + 1;
    let choose = |values: &[(u64, u32)]| select_notes(values, amount, outputs, s.synced, factor);
    let (pczt, pick) = build_spend(s, payees, &terms, choose)?;
    Ok(json!({"pczt": pczt_to_b64(pczt)?, "pool": "ironwood", "amount": amount,
        "change": pick.change, "fee": pick.fee, "note_value": pick.total})
    .to_string())
}

/// One output of zero value for each part of the message, all to `to`, each with its text memo.
fn message_payees(to: &str, text: &str, net: Network) -> R<Vec<Payee>> {
    let to = parse_recipient(to, net)?;
    let parts = account::split(text)?;
    parts.iter().map(|part| Ok((to, 0, parse_memo(&json!(part))?))).collect()
}

/// Like `spend_pczt` for the outputs of `message_payees`: the account pays the fee only. One
/// device signs and sends it at once, so it keeps the builder's expiry and the standard fee.
fn message_pczt(s: &Inner, payees: &[Payee], tip: u32) -> R<String> {
    let terms = Terms { target: BlockHeight::from_u32(tip + 1), expiry: None, fee_factor: 1 };
    let choose = |values: &[(u64, u32)]| pick_notes(values, 0, payees.len() + 1, s.synced, 1);
    let (pczt, pick) = build_spend(s, payees, &terms, choose)?;
    Ok(json!({"pczt": pczt_to_b64(pczt)?, "pool": "ironwood", "fee": pick.fee,
        "parts": payees.len(), "note_value": pick.total, "change": pick.change})
    .to_string())
}

async fn create_spend(state: &RefCell<Inner>, payees: &str, priority: bool) -> R<String> {
    let rows: Vec<Value> = serde_json::from_str(payees).map_err(e("recipient list"))?;
    let payees = parse_payees(&rows, state.borrow().net)?;
    let endpoint = state.borrow().endpoint.clone();
    let tip = tip_of(&endpoint).await?;
    let mut s = state.borrow_mut();
    s.tip = tip;
    spend_pczt(&s, &payees, tip, priority)
}

async fn create_message(state: &RefCell<Inner>, to: &str, text: &str) -> R<String> {
    let payees = message_payees(to, text, state.borrow().net)?;
    let endpoint = state.borrow().endpoint.clone();
    let tip = tip_of(&endpoint).await?;
    let mut s = state.borrow_mut();
    s.tip = tip;
    message_pczt(&s, &payees, tip)
}

async fn broadcast(endpoint: &str, tx_hex: &str) -> R<String> {
    let data = hex::decode(tx_hex.trim()).map_err(e("transaction hex"))?;
    let r = client(endpoint)
        .send_transaction(RawTransaction { data, height: 0 })
        .await
        .map_err(rpc)?
        .into_inner();
    ensure(r.error_code == 0, &format!("{NODE_REFUSED}: {}", r.error_message))?;
    Ok(json!({"txid": r.error_message.trim().trim_matches('"')}).to_string())
}

/// The full transaction with id `hash` (hex, in the byte order of `memoNeeds`), as base64.
async fn fetch_transaction(endpoint: &str, hash: &str) -> R<String> {
    let hash = hex::decode(hash).map_err(e("transaction hash"))?;
    ensure(hash.len() == 32, "a transaction hash has 32 bytes")?;
    let filter = TxFilter { block: None, index: 0, hash };
    let raw = client(endpoint).get_transaction(filter).await.map_err(rpc)?.into_inner();
    ensure(!raw.data.is_empty(), "lightwalletd returned an empty transaction")?;
    Ok(B64.encode(raw.data))
}

#[wasm_bindgen(js_name = latestHeight)]
pub async fn js_latest_height(endpoint: String) -> Result<u32, JsError> {
    super::js(tip_of(&endpoint).await)
}

/// True when an error message says that a reorganisation was deeper than the wallet can undo.
#[wasm_bindgen(js_name = isDeepReorg)]
pub fn js_is_deep_reorg(message: &str) -> bool {
    is_deep_reorg(message)
}

/// True when an error message says that the node answered and refused the transaction.
#[wasm_bindgen(js_name = isNodeRefusal)]
pub fn js_is_node_refusal(message: &str) -> bool {
    is_node_refusal(message)
}

/// Downloads one full transaction from the light-wallet server. The server learns that this
/// device is interested in it. Needs no wallet, so no wallet is borrowed during the download.
#[wasm_bindgen(js_name = fetchTransaction)]
pub async fn js_fetch_transaction(endpoint: String, hash: String) -> Result<String, JsError> {
    super::js(fetch_transaction(&endpoint, &hash).await)
}

#[wasm_bindgen]
pub struct ChainWallet(Rc<RefCell<Inner>>);

#[wasm_bindgen]
impl ChainWallet {
    #[wasm_bindgen(constructor)]
    pub fn new(ufvk: &str, birthday: u32, endpoint: &str) -> Result<ChainWallet, JsError> {
        Ok(ChainWallet(Rc::new(RefCell::new(super::js(Inner::new(ufvk, birthday, endpoint))?))))
    }

    /// A wallet that continues from `snapshot` (from `snapshot()`) instead of the birthday.
    pub fn restore(ufvk: &str, birthday: u32, endpoint: &str, snapshot: &str) -> Result<ChainWallet, JsError> {
        let cw = ChainWallet::new(ufvk, birthday, endpoint)?;
        super::js(cw.0.borrow_mut().restore(snapshot))?;
        Ok(cw)
    }

    /// The sync state as JSON: notes, scan position and note commitment tree.
    pub fn snapshot(&self) -> Result<String, JsError> {
        super::js(self.0.borrow().snapshot())
    }

    pub async fn sync(&self, on_progress: js_sys::Function) -> Result<String, JsError> {
        super::js(sync(&self.0, &on_progress).await)
    }

    pub fn balance(&self) -> String {
        self.0.borrow().balance()
    }

    pub fn received(&self) -> String {
        self.0.borrow().received()
    }

    /// Ids of mined transactions that spent this wallet's notes.
    pub fn sent(&self) -> String {
        sent_ids(&self.0.borrow())
    }

    /// Transactions whose memos are not read yet: `[{"txid", "hash", "height"}, …]`. Pass `hash`
    /// to `fetchTransaction`, then the result to `attachTransaction`.
    #[wasm_bindgen(js_name = memoNeeds)]
    pub fn memo_needs(&self) -> Result<String, JsError> {
        super::js(self.0.borrow_mut().memo_needs())
    }

    /// Reads the memos of this wallet's notes from a full transaction (base64). `txid` is the
    /// `txid` of `memoNeeds` for it. Returns `{"attached": <notes that left the pending state>}`.
    /// A transaction with another id is an error.
    #[wasm_bindgen(js_name = attachTransaction)]
    pub fn attach_transaction(&self, txid: &str, raw: &str) -> Result<String, JsError> {
        super::js(attach(&mut self.0.borrow_mut(), txid, raw))
    }

    /// `payees` is a JSON list: `[{"to": "<unified address>", "amount": <zat>, "memo": "<text>"},
    /// …]`. The memo is optional: at most 512 UTF-8 bytes. `priority` pays 10 times the ZIP 317
    /// fee. The payment expires one day after it is built (see `expiry`).
    #[wasm_bindgen(js_name = createSpend)]
    pub async fn create_spend(&self, payees: String, priority: bool) -> Result<String, JsError> {
        super::js(create_spend(&self.0, &payees, priority).await)
    }

    /// A message on chain. `to` is a unified address with an Orchard receiver and `text` is the
    /// message (`splitMessage` gives the rules). Each part is an output of zero value with its
    /// memo, so the account pays the fee only. Returns `{"pczt", "pool", "fee", "parts",
    /// "note_value", "change"}`. Sign it with `accountSign`, then `finalize`.
    #[wasm_bindgen(js_name = createMessage)]
    pub async fn create_message(&self, to: String, text: String) -> Result<String, JsError> {
        super::js(create_message(&self.0, &to, &text).await)
    }

    pub async fn broadcast(&self, tx_hex: String) -> Result<String, JsError> {
        let endpoint = self.0.borrow().endpoint.clone();
        super::js(broadcast(&endpoint, &tx_hex).await)
    }
}

/// Wallets for the native apps. The app downloads lightwalletd messages itself (grpc-web from
/// Swift) and passes the raw protobuf bytes, base64 encoded; wallets are kept by a caller key.
#[cfg(not(target_arch = "wasm32"))]
pub(crate) mod native {
    use std::{collections::HashMap, sync::Mutex};

    use prost::Message;

    use super::*;

    static WALLETS: Mutex<Option<HashMap<String, Inner>>> = Mutex::new(None);

    fn with<T>(key: &str, f: impl FnOnce(&mut Inner) -> R<T>) -> R<T> {
        let mut all = WALLETS.lock().map_err(|_| "wallet store poisoned".to_string())?;
        let w = all.get_or_insert_with(HashMap::new).get_mut(key).ok_or("no open wallet for this key")?;
        f(w)
    }

    fn bytes(b64: &str, what: &str) -> R<Vec<u8>> {
        B64.decode(b64).map_err(|_| format!("{what} is not base64"))
    }

    /// Opens (or replaces) the wallet for `key`. A snapshot that does not load is ignored, so the
    /// wallet then syncs from its birthday; the result says which.
    pub(crate) fn open(key: &str, ufvk: &str, birthday: u32, snapshot: Option<&str>) -> R<String> {
        let mut w = Inner::new(ufvk, birthday, "")?;
        let restored = snapshot.is_some_and(|s| w.restore(s).is_ok());
        if !restored {
            w = Inner::new(ufvk, birthday, "")?;
        }
        let mut all = WALLETS.lock().map_err(|_| "wallet store poisoned".to_string())?;
        all.get_or_insert_with(HashMap::new).insert(key.to_string(), w);
        Ok(json!({"restored": restored}).to_string())
    }

    pub(crate) fn close(key: &str) -> R<String> {
        let mut all = WALLETS.lock().map_err(|_| "wallet store poisoned".to_string())?;
        all.get_or_insert_with(HashMap::new).remove(key);
        Ok("null".into())
    }

    /// What the wallet needs next: the tree state at `treeState`, or blocks from `from`.
    pub(crate) fn needs(key: &str) -> R<String> {
        with(key, |w| {
            Ok(if w.synced == 0 {
                json!({"treeState": w.birthday.saturating_sub(1)})
            } else {
                json!({"from": w.synced + 1})
            }
            .to_string())
        })
    }

    pub(crate) fn start(key: &str, tree_state: &str) -> R<String> {
        let ts = TreeState::decode(&bytes(tree_state, "tree state")?[..]).map_err(e("tree state"))?;
        with(key, |w| w.start(&ts).map(|()| "null".into()))
    }

    /// Applies CompactBlock messages in order; `tip` is the chain height the app saw. A block that
    /// does not chain onto the wallet's tip makes the wallet drop its newest block and stop: the
    /// rest of the batch is ignored. The app asks `needs` again, which then names a lower `from`.
    pub(crate) fn blocks(key: &str, blocks: &[Value], tip: u32) -> R<String> {
        with(key, |w| {
            w.tip = w.tip.max(tip);
            for b in blocks {
                let raw = bytes(b.as_str().ok_or("blocks must be base64 strings")?, "block")?;
                let block = CompactBlock::decode(&raw[..]).map_err(e("compact block"))?;
                let height = u32::try_from(block.height).map_err(e("block height"))?;
                ensure(height == w.synced + 1, &format!("expected block {}, got {height}", w.synced + 1))?;
                if w.apply_block(block)? == Step::Rewound {
                    break;
                }
            }
            Ok(w.balance())
        })
    }

    /// Transactions whose memos are not read yet: `[{"txid", "hash", "height"}, …]`. `hash` is
    /// the id in hex, in the byte order of `TxFilter.hash`.
    pub(crate) fn memo_needs(key: &str) -> R<String> {
        with(key, |w| w.memo_needs())
    }

    /// Reads memos from a full transaction (the `data` of `RawTransaction`, base64). `txid` is
    /// the `txid` of `memo_needs` for it.
    pub(crate) fn transaction(key: &str, txid: &str, raw: &str) -> R<String> {
        with(key, |w| attach(w, txid, raw))
    }

    pub(crate) fn balance(key: &str) -> R<String> {
        with(key, |w| Ok(w.balance()))
    }

    pub(crate) fn received(key: &str) -> R<String> {
        with(key, |w| Ok(w.received()))
    }

    pub(crate) fn sent(key: &str) -> R<String> {
        with(key, |w| Ok(sent_ids(w)))
    }

    pub(crate) fn snapshot(key: &str) -> R<String> {
        with(key, |w| w.snapshot())
    }

    /// A message on chain, as `ChainWallet.createMessage` makes it. `tip` is the chain height the
    /// app saw.
    pub(crate) fn message(key: &str, to: &str, text: &str, tip: u32) -> R<String> {
        with(key, |w| {
            let payees = message_payees(to, text, w.net)?;
            w.tip = w.tip.max(tip);
            message_pczt(w, &payees, tip)
        })
    }

    /// The native apps offer no priority fee yet (TICKETS.md, ZEC-8).
    pub(crate) fn spend(key: &str, payees: &[Value], tip: u32) -> R<String> {
        with(key, |w| {
            let payees = parse_payees(payees, w.net)?;
            w.tip = w.tip.max(tip);
            spend_pczt(w, &payees, tip, false)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SYNCED: u32 = 100;

    #[test]
    fn exact_amount_uses_one_note_and_no_change() {
        let p = select_notes(&[(110_000, 50)], 100_000, 2, SYNCED, 1).unwrap();
        assert_eq!((p.picked, p.fee, p.change, p.total), (vec![0], 10_000, 0, 110_000));
    }

    #[test]
    fn not_enough_funds_reports_need() {
        let err = select_notes(&[(109_999, 50)], 100_000, 2, SYNCED, 1).unwrap_err();
        assert!(err.contains("not enough funds"), "{err}");
        assert!(err.contains("109999") && err.contains("110000"), "{err}");
        assert!(select_notes(&[], 1, 2, SYNCED, 1).unwrap_err().contains("not enough funds"));
        assert!(select_notes(&[(1, 50)], 0, 2, SYNCED, 1).is_err());
    }

    #[test]
    fn fee_grows_with_three_spends_largest_first() {
        let notes = [(40_000, 10), (90_000, 11), (50_000, 12), (5, 13)];
        let p = select_notes(&notes, 150_000, 2, SYNCED, 1).unwrap();
        assert_eq!(p.picked, vec![1, 2, 0]);
        assert_eq!((p.fee, p.total, p.change), (15_000, 180_000, 15_000));
    }

    #[test]
    fn max_send_empties_the_confirmed_notes() {
        let notes = [(40_000, 10), (90_000, 11), (50_000, 12), (7_000_000, SYNCED)];
        let max = max_send(&notes, SYNCED);
        assert_eq!(max, 165_000);
        let p = select_notes(&notes, max, 2, SYNCED, 1).unwrap();
        assert_eq!((p.picked.len(), p.change), (3, 0));
        assert!(select_notes(&notes, max + 1, 2, SYNCED, 1).is_err());
        assert_eq!(max_send(&[(9_000, 10)], SYNCED), 0);
        assert_eq!(max_send(&[], SYNCED), 0);
    }

    #[test]
    fn native_wallet_follows_its_needs() {
        use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
        use orchard::keys::{FullViewingKey, SpendingKey};
        use prost::Message;
        let sk = Option::<SpendingKey>::from(SpendingKey::from_bytes([7; 32])).unwrap();
        let ufvk = UnifiedFullViewingKey::from_orchard_fvk(FullViewingKey::from(&sk)).unwrap()
            .encode(&Network::TestNetwork).unwrap();
        let k = "test-wallet";
        assert_eq!(native::open(k, &ufvk, 500, Some("{\"v\":1}")).unwrap(), r#"{"restored":false}"#);
        assert_eq!(native::needs(k).unwrap(), r#"{"treeState":499}"#);
        let ts = TreeState { height: 499, hash: "00".repeat(32), ..Default::default() };
        native::start(k, &B64.encode(ts.encode_to_vec())).unwrap();
        assert_eq!(native::needs(k).unwrap(), r#"{"from":500}"#);
        let wrong = CompactBlock { height: 501, ..Default::default() };
        let err = native::blocks(k, &[json!(B64.encode(wrong.encode_to_vec()))], 600).unwrap_err();
        assert!(err.contains("expected block 500"), "{err}");
        let snap = native::snapshot(k).unwrap();
        assert_eq!(native::open(k, &ufvk, 500, Some(&snap)).unwrap(), r#"{"restored":true}"#);
        assert_eq!(native::needs(k).unwrap(), r#"{"from":500}"#);
        let err = native::spend(k, &[json!({"to": "nope", "amount": 1})], 600).unwrap_err();
        assert!(err.contains("recipient 1"), "{err}");
        native::close(k).unwrap();
        assert!(native::needs(k).is_err());
    }

    #[test]
    fn mainnet_wallet_refuses_testnet_recipients() {
        use orchard::keys::{FullViewingKey, Scope, SpendingKey};
        let sk = Option::<SpendingKey>::from(SpendingKey::from_bytes([8; 32])).unwrap();
        let fvk = FullViewingKey::from(&sk);
        let ufvk = UnifiedFullViewingKey::from_orchard_fvk(fvk.clone()).unwrap();
        let k = "main-wallet";
        native::open(k, &ufvk.encode(&Network::MainNetwork).unwrap(), 3_500_000, None).unwrap();
        let ua = |net| zcash_keys::address::UnifiedAddress::from_receivers(
            Some(fvk.address_at(0u32, Scope::External)), None, None, None, None).unwrap().encode(&net);
        let rows = [json!({"to": ua(Network::TestNetwork), "amount": 1000})];
        let err = native::spend(k, &rows, 3_500_100).unwrap_err();
        assert!(err.contains("mainnet unified address"), "{err}");
        assert!(super::super::normalize_address(&ua(Network::MainNetwork)).unwrap().starts_with("u1"));
        assert!(super::super::normalize_address(&ua(Network::TestNetwork)).unwrap().starts_with("utest1"));
        native::close(k).unwrap();
    }

    #[test]
    fn fee_counts_outputs_when_they_outnumber_spends() {
        let p = select_notes(&[(1_000_000, 50)], 500_000, 6, SYNCED, 1).unwrap();
        assert_eq!((p.picked.len(), p.fee, p.change), (1, 30_000, 470_000));
        let notes = [(40_000, 10), (90_000, 11), (50_000, 12)];
        assert_eq!(select_notes(&notes, 150_000, 3, SYNCED, 1).unwrap().fee, 15_000);
    }

    #[test]
    fn payee_lists_are_checked_row_by_row() {
        use orchard::keys::{FullViewingKey, Scope, SpendingKey};
        let sk = Option::<SpendingKey>::from(SpendingKey::from_bytes([9; 32])).unwrap();
        let fvk = FullViewingKey::from(&sk);
        let ua = zcash_keys::address::UnifiedAddress::from_receivers(
            Some(fvk.address_at(0u32, Scope::External)), None, None, None, None).unwrap()
            .encode(&Network::TestNetwork);
        let net = Network::TestNetwork;
        let ok = json!({"to": ua, "amount": 5});
        assert_eq!(parse_payees(&[ok.clone(), ok.clone()], net).unwrap().len(), 2);
        let err = |rows: &[Value]| parse_payees(rows, net).unwrap_err();
        assert!(err(&[]).contains("at least one"));
        assert!(err(&vec![ok.clone(); MAX_PAYEES + 1]).contains("at most 20"));
        let zero = json!({"to": ua, "amount": 0});
        assert!(err(&[ok.clone(), zero]).contains("recipient 2: amount must be greater"));
        let half = json!({"to": ua, "amount": 1.5});
        assert!(err(&[half]).contains("recipient 1: amount must be a whole"));
        assert!(err(&[json!({"amount": 1})]).contains("recipient 1: missing address"));
        let bad = json!({"to": "u1nope", "amount": 1});
        let third = err(&[ok.clone(), ok.clone(), bad]);
        assert!(third.contains("recipient 3: the recipient must be a testnet"), "{third}");
        let main = parse_payees(&[json!({"to": ua, "amount": 1})], Network::MainNetwork);
        assert!(main.unwrap_err().contains("mainnet"));
        let with = |memo: Value| json!({"to": ua, "amount": 5, "memo": memo});
        let list = [with(json!("hi")), with(json!(null)), ok.clone(), with(json!(""))];
        let rows = parse_payees(&list, net).unwrap();
        let none: Vec<bool> = rows.iter().map(|r| r.2 == MemoBytes::empty()).collect();
        assert_eq!(none, [false, true, true, true]);
        assert_eq!(&rows[0].2.as_array()[..3], b"hi\0");
        let long = "a".repeat(513);
        let too_long = err(&[ok.clone(), with(json!(long))]);
        assert!(too_long.contains("recipient 2: the memo is 513 bytes"), "{too_long}");
        assert!(err(&[with(json!(7))]).contains("recipient 1: the memo must be text"));
        assert!(err(&[with(json!("a\0"))]).contains("null character"));
        assert!(parse_payees(&[with(json!("a".repeat(512)))], net).is_ok());
        let tex = Address::Tex([3; 20]).encode(&net);
        let to_tex = |memo: Value| json!({"to": tex, "amount": 5, "memo": memo});
        let refused = err(&[ok.clone(), to_tex(json!("hello"))]);
        let want = "recipient 2: a transparent address cannot receive a memo";
        assert!(refused.contains(want), "{refused}");
        assert!(err(&[to_tex(json!(null))]).contains("must be a testnet unified address"));
    }

    #[test]
    fn unconfirmed_notes_are_excluded() {
        let notes = [(1_000_000, SYNCED - 1), (60_000, SYNCED - 2)];
        let err = select_notes(&notes, 100_000, 2, SYNCED, 1).unwrap_err();
        assert!(err.contains("60000 zat spendable"), "{err}");
        assert!(select_notes(&notes, 50_000, 2, SYNCED, 1).is_ok());
    }

    use crate::testchain::{compact_of, external, fvk, memo_of, no_memo, pays, Chain};
    use orchard::keys::DiversifierIndex;
    use zcash_primitives::transaction::Transaction;
    use zcash_protocol::consensus::BranchId;
    use orchard::keys::FullViewingKey;
    use prost::Message as _;

    fn ufvk_of(key: &FullViewingKey) -> String {
        UnifiedFullViewingKey::from_orchard_fvk(key.clone())
            .unwrap()
            .encode(&Network::TestNetwork)
            .unwrap()
    }

    /// The tree state of the block before `birthday`. Its hash is zero, which the first block of
    /// a test chain names as its parent.
    fn base_state(birthday: u32) -> TreeState {
        TreeState { height: u64::from(birthday - 1), hash: "00".repeat(32), ..Default::default() }
    }

    fn started(seed: u8, birthday: u32) -> (Inner, FullViewingKey) {
        let key = fvk(seed);
        let mut w = Inner::new(&ufvk_of(&key), birthday, "").unwrap();
        w.start(&base_state(birthday)).unwrap();
        (w, key)
    }

    /// What a sync does: take the blocks of `chain` from `synced + 1` to its end. Returns how
    /// many times the wallet rewound.
    fn follow(w: &mut Inner, chain: &Chain) -> R<usize> {
        let mut rewinds = 0;
        while w.synced < chain.last_height() {
            let block = chain.at(w.synced + 1).ok_or("the chain has no such block")?;
            rewinds += usize::from(w.apply_block(block.clone())? == Step::Rewound);
        }
        Ok(rewinds)
    }

    /// Chain A pays the wallet in blocks 500 and 501 and spends the first note in block 502. Chain
    /// B has block 500 of A, then other blocks: it pays the wallet 7,000 in block 501.
    fn two_branches(key: &FullViewingKey) -> (Chain, Chain) {
        let (pay1, note1) = pays(external(key), 10_000, no_memo(), None);
        let (pay2, _) = pays(external(key), 20_000, no_memo(), None);
        let (spend1, _) = pays(external(&fvk(8)), 5_000, no_memo(), Some(note1.nullifier(key)));
        let mut a = Chain::new(500);
        for txs in [vec![pay1], vec![pay2], vec![spend1], vec![]] {
            a.push(txs, 0);
        }
        let mut b = a.fork(500);
        b.push(vec![pays(external(key), 7_000, no_memo(), None).0], 1);
        b.grow(3, 1);
        (a, b)
    }

    fn check_branch_b(w: &Inner, b: &Chain) {
        assert_eq!((w.synced, w.notes.len()), (504, 2));
        let (first, second) = (&w.notes[0], &w.notes[1]);
        assert_eq!((first.height, first.spent, first.value()), (500, None, 10_000));
        assert_eq!((second.height, second.value(), u64::from(second.position)), (501, 7_000, 1));
        assert!(w.sent.is_empty(), "the spend was on the dropped branch");
        assert_eq!(first.memo, Some(MemoView::Text("kept".into())));
        assert_eq!(second.memo, None, "a memo belongs to its note");
        assert_eq!(u32::from(w.chain.last().unwrap().block_height()), 504);
        let (mut fresh, _) = started(7, 500);
        assert_eq!(follow(&mut fresh, b).unwrap(), 0);
        let root = |t: &Inner| t.tree.root_at_checkpoint_depth(Some(0)).unwrap();
        assert_eq!(root(w), root(&fresh), "the tree equals one that never saw branch A");
        for n in &w.notes {
            let path = |t: &Inner| t.tree.witness_at_checkpoint_depth(n.position, 0).unwrap();
            assert_eq!(path(w), path(&fresh));
        }
        assert_eq!(w.balance(), fresh.balance());
    }

    #[test]
    fn a_reorg_drops_the_notes_spends_and_memos_of_the_dropped_blocks() {
        let (mut w, key) = started(7, 500);
        let (a, b) = two_branches(&key);
        assert_eq!(follow(&mut w, &a).unwrap(), 0);
        assert_eq!((w.synced, w.notes.len()), (503, 2));
        assert_eq!(w.notes[0].spent, Some(502));
        assert_eq!(w.sent.len(), 1);
        w.notes[0].memo = Some(MemoView::Text("kept".into()));
        w.notes[1].memo = Some(MemoView::Text("dropped".into()));
        assert_eq!(follow(&mut w, &b).unwrap(), 3, "blocks 503, 502 and 501 of branch A");
        check_branch_b(&w, &b);
    }

    #[test]
    fn a_reorg_after_a_snapshot_round_trip_works() {
        let (mut w, key) = started(7, 500);
        let (a, b) = two_branches(&key);
        follow(&mut w, &a).unwrap();
        w.notes[0].memo = Some(MemoView::Text("kept".into()));
        w.notes[1].memo = Some(MemoView::Empty);
        let snap = w.snapshot().unwrap();
        let mut back = Inner::new(&ufvk_of(&key), 500, "").unwrap();
        back.restore(&snap).unwrap();
        assert_eq!(back.snapshot().unwrap(), snap);
        assert_eq!(back.notes[0].spent, Some(502));
        assert_eq!(back.notes[1].memo, Some(MemoView::Empty));
        assert_eq!(follow(&mut back, &b).unwrap(), 3);
        back.notes[1].memo = None;
        check_branch_b(&back, &b);
    }

    #[test]
    fn a_reorg_of_100_blocks_works_and_one_of_101_fails_clearly() {
        for (depth, ok) in [(100u32, true), (101, false)] {
            let (mut w, _) = started(7, 500);
            let mut a = Chain::new(500);
            a.grow(150, 0);
            follow(&mut w, &a).unwrap();
            assert_eq!(w.chain.len(), KEPT);
            let mut b = a.fork(649 - depth);
            b.grow(depth as usize + 1, 1);
            let r = follow(&mut w, &b);
            if ok {
                assert_eq!(r.unwrap(), depth as usize);
                assert_eq!(w.synced, 650);
            } else {
                let err = r.unwrap_err();
                assert!(err.contains("more than 100 blocks"), "{err}");
                assert!(is_deep_reorg(&err), "the apps find this error by the engine's words");
                assert!(!is_deep_reorg("lightwalletd: unavailable"));
                let forged = format!("lightwalletd: {err}");
                assert!(!is_deep_reorg(&forged), "a server cannot make the wallet drop its state");
                assert_eq!(w.synced, 549, "the wallet stays consistent where it stopped");
                assert_eq!(u32::from(w.chain.last().unwrap().block_height()), 549);
            }
        }
    }

    #[test]
    fn only_a_node_answer_is_a_refusal() {
        let refused = format!("{NODE_REFUSED}: bad-txns-inputs-spent");
        assert!(is_node_refusal(&refused), "the apps find this error by the engine's words");
        assert!(!is_node_refusal("lightwalletd: unavailable"), "a lost link is not a refusal");
        assert!(!is_node_refusal("did not answer in 16 s"));
        let forged = format!("lightwalletd: {refused}");
        assert!(!is_node_refusal(&forged), "a transport error cannot free the notes of a send");
    }

    #[test]
    fn a_reorg_back_to_the_start_replays_the_new_chain() {
        let (mut w, key) = started(7, 500);
        let mut a = Chain::new(500);
        a.push(vec![pays(external(&key), 10_000, no_memo(), None).0], 0);
        a.grow(1, 0);
        follow(&mut w, &a).unwrap();
        let mut b = Chain::new(500);
        b.push(vec![], 1);
        b.push(vec![pays(external(&key), 3_000, no_memo(), None).0], 1);
        b.grow(1, 1);
        assert_eq!(follow(&mut w, &b).unwrap(), 2, "blocks 501 and 500 of branch A");
        assert_eq!((w.synced, w.notes.len(), w.notes[0].value()), (502, 1, 3_000));
        assert_eq!(w.chain.len(), 4, "the block before the birthday and blocks 500 to 502");
    }

    #[test]
    fn a_fork_below_the_birthday_needs_a_new_scan() {
        let (mut w, _) = started(7, 500);
        let mut a = Chain::new(500);
        a.grow(1, 0);
        let mut block = a.blocks[0].clone();
        block.prev_hash = vec![1; 32];   // block 499 is not the one of the tree state
        let err = w.apply_block(block).unwrap_err();
        assert!(is_deep_reorg(&err), "{err}");
        assert_eq!((w.synced, w.notes.len()), (499, 0), "the wallet stays where it started");
    }

    #[test]
    fn a_tree_state_must_name_its_block() {
        let key = fvk(7);
        let mut w = Inner::new(&ufvk_of(&key), 500, "").unwrap();
        let no_hash = TreeState { height: 499, ..Default::default() };
        assert!(w.start(&no_hash).unwrap_err().contains("bad block hash"));
        let wrong_height = TreeState { height: 498, ..base_state(500) };
        assert!(w.start(&wrong_height).unwrap_err().contains("tree state of block 498"));
    }

    #[test]
    fn a_block_with_a_hash_of_the_wrong_length_is_refused() {
        let (mut w, _) = started(7, 500);
        let mut a = Chain::new(500);
        a.grow(1, 0);
        let mut block = a.blocks[0].clone();
        block.prev_hash.pop();
        let err = w.apply_block(block).unwrap_err();
        assert!(err.contains("wrong length"), "{err}");
    }

    #[test]
    fn snapshots_of_other_formats_are_refused() {
        let (mut w, key) = started(7, 500);
        let snap = w.snapshot().unwrap();
        let mut v: Value = serde_json::from_str(&snap).unwrap();
        v["v"] = json!(2);
        let mut fresh = Inner::new(&ufvk_of(&key), 500, "").unwrap();
        assert!(fresh.restore(&v.to_string()).unwrap_err().contains("old or unknown"));
        v["v"] = json!(3);
        v["synced"] = json!(520);
        assert!(fresh.restore(&v.to_string()).unwrap_err().contains("damaged"));
        w.restore(&snap).unwrap();
    }

    #[test]
    fn the_native_interface_rewinds_and_asks_again() {
        let key = fvk(7);
        let k = "reorg-wallet";
        native::open(k, &ufvk_of(&key), 500, None).unwrap();
        let ts = TreeState { height: 499, hash: "00".repeat(32), ..Default::default() };
        native::start(k, &B64.encode(ts.encode_to_vec())).unwrap();
        let (a, b) = two_branches(&key);
        // The app asks `needs`, fetches blocks from `from` to the end, and calls `blocks`.
        let feed = |chain: &Chain| {
            let mut calls = 0;
            loop {
                let from = v(&native::needs(k).unwrap())["from"].as_u64().unwrap() as u32;
                if from > chain.last_height() {
                    return calls;
                }
                let batch: Vec<Value> = (from..=chain.last_height())
                    .map(|h| json!(B64.encode(chain.at(h).unwrap().encode_to_vec())))
                    .collect();
                native::blocks(k, &batch, chain.last_height()).unwrap();
                calls += 1;
            }
        };
        assert_eq!(feed(&a), 1);
        assert_eq!(v(&native::balance(k).unwrap())["notes"], 1, "note 1 is spent, note 2 is not");
        assert_eq!(feed(&b), 4, "three rewinds, then the batch that applies");
        let balance = v(&native::balance(k).unwrap());
        assert_eq!((&balance["height"], &balance["notes"]), (&json!(504), &json!(2)));
        assert_eq!(native::sent(k).unwrap(), "[]");
        native::close(k).unwrap();
    }

    fn v(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }

    #[test]
    fn received_lists_text_memos_and_hides_empty_ones_and_change() {
        let (mut w, key) = started(7, 500);
        let (mut both, _) = pays(external(&key), 1_000, no_memo(), None);
        let (second, _) = pays(external(&key), 2_000, no_memo(), None);
        both.ironwood_actions.extend(second.ironwood_actions);
        let internal = key.address_at(0u32, orchard::keys::Scope::Internal);
        let (change, _) = pays(internal, 300, no_memo(), None);
        let (single, _) = pays(external(&key), 5_000, memo_of("one"), None);
        let mut a = Chain::new(500);
        a.push(vec![both.clone(), change], 0);
        a.push(vec![single], 0);
        follow(&mut w, &a).unwrap();
        assert_eq!(w.notes.len(), 4);

        let list = v(&w.received());
        assert_eq!(list.as_array().unwrap().len(), 2, "change is not a payment");
        assert_eq!((&list[1]["value"], &list[1]["memo_pending"]), (&json!(3_000), &json!(true)));
        let needs = v(&w.memo_needs().unwrap());
        assert_eq!(needs.as_array().unwrap().len(), 2, "one entry for each transaction");
        let hash = hex::encode(&both.txid);
        assert_eq!(needs[0]["hash"], hash.as_str(), "the byte order that GetTransaction takes");
        let shown: Vec<u8> = hex::decode(needs[0]["txid"].as_str().unwrap()).unwrap();
        assert_eq!(shown.iter().rev().copied().collect::<Vec<_>>(), both.txid);

        w.notes[0].memo = Some(MemoView::Text("rent".into()));
        w.notes[1].memo = Some(MemoView::NotText);
        w.notes[3].memo = Some(MemoView::Empty);
        let list = v(&w.received());
        let shown = json!([{"status": "text", "text": "rent", "index": 0},
            {"status": "not_text", "index": 0}]);
        assert_eq!(list[1]["memos"], shown);
        assert_eq!(list[1]["memo_pending"], false);
        assert_eq!((&list[0]["memos"], &list[0]["memo_pending"]), (&json!([]), &json!(false)));
        assert_eq!(w.memo_needs().unwrap(), "[]", "change never needs its memo");
    }

    /// A message part is a zero-value note with a text memo. The wallet finds it like any other
    /// note, lists it with its memo pending, and asks for its transaction.
    #[test]
    fn a_zero_value_note_with_a_memo_is_found_and_waits_for_its_memo() {
        let (mut w, key) = started(7, 500);
        let (tx, _) = pays(external(&key), 0, memo_of("hi"), None);
        let id = txid_text(&tx.txid);
        let mut a = Chain::new(500);
        a.push(vec![tx], 0);
        follow(&mut w, &a).unwrap();
        let list = v(&w.received());
        assert_eq!(list.as_array().unwrap().len(), 1);
        assert_eq!((&list[0]["value"], &list[0]["memo_pending"]), (&json!(0), &json!(true)));
        let needs = v(&w.memo_needs().unwrap());
        assert_eq!(needs.as_array().unwrap().len(), 1);
        assert_eq!(needs[0]["txid"], id.as_str());
    }

    #[test]
    fn a_memo_list_holds_at_most_25_transactions() {
        let (mut w, key) = started(7, 500);
        let txs: Vec<_> = (0..30).map(|_| pays(external(&key), 1_000, no_memo(), None).0).collect();
        let mut a = Chain::new(500);
        a.push(txs, 0);
        follow(&mut w, &a).unwrap();
        assert_eq!(v(&w.memo_needs().unwrap()).as_array().unwrap().len(), MEMO_BATCH);
    }

    #[test]
    fn a_transaction_that_never_gives_its_memo_does_not_hold_back_the_others() {
        let (mut w, key) = started(7, 500);
        let txs: Vec<_> = (0..30).map(|_| pays(external(&key), 1_000, no_memo(), None).0).collect();
        let ids: Vec<String> = txs.iter().map(|t| txid_text(&t.txid)).collect();
        let mut a = Chain::new(500);
        a.push(txs, 0);
        follow(&mut w, &a).unwrap();
        let listed = |w: &mut Inner| -> Vec<String> {
            let list = v(&w.memo_needs().unwrap());
            list.as_array().unwrap().iter().map(|x| x["txid"].as_str().unwrap().into()).collect()
        };
        assert_eq!(listed(&mut w), ids[..MEMO_BATCH], "the oldest first");
        // None of the 25 gave its memo. The five that were never listed come first now.
        let second = listed(&mut w);
        assert_eq!(second.len(), MEMO_BATCH);
        assert_eq!(second[..5], ids[MEMO_BATCH..], "a listed transaction goes back");
        assert_eq!(second[5..], ids[..MEMO_BATCH - 5], "and the others keep their order");
        let visited: HashSet<_> = ids[..MEMO_BATCH].iter().chain(&second).collect();
        assert_eq!(visited.len(), ids.len(), "two rounds reach every transaction");
    }

    #[test]
    fn a_transaction_that_is_not_the_one_asked_for_is_refused() {
        let (mut w, key) = started(7, 500);
        let (tx, _) = pays(external(&key), 1_000, no_memo(), None);
        let id = txid_text(&tx.txid);
        let mut a = Chain::new(500);
        a.push(vec![tx], 0);
        follow(&mut w, &a).unwrap();
        assert!(w.attach_transaction(&id, &[1, 2, 3]).unwrap_err().contains("transaction"));
        let big = vec![0u8; MAX_TX_BYTES + 1];
        assert!(w.attach_transaction(&id, &big).unwrap_err().contains("larger"));
        assert!(attach(&mut w, &id, "not base64!").unwrap_err().contains("not base64"));
        assert_eq!(w.notes[0].memo, None, "a faulty answer never settles a note");
        assert_eq!(v(&w.memo_needs().unwrap()).as_array().unwrap().len(), 1);
    }

    #[test]
    fn received_names_the_address_that_got_the_note() {
        let (mut w, key) = started(7, 500);
        let at = |j: u32| key.address_at(j, Scope::External);
        let far = DiversifierIndex::try_from(1u128 << 40).unwrap();
        let (zero, _) = pays(at(0), 1_000, no_memo(), None);
        let (seven, _) = pays(at(7), 2_000, no_memo(), None);
        let (huge, _) = pays(key.address_at(far, Scope::External), 3_000, no_memo(), None);
        let (mut two, _) = pays(at(3), 4_000, no_memo(), None);
        two.ironwood_actions.extend(pays(at(5), 5_000, no_memo(), None).0.ironwood_actions);
        let mut a = Chain::new(500);
        for tx in [zero, seven, huge, two] {
            a.push(vec![tx], 0);
        }
        follow(&mut w, &a).unwrap();
        let before = v(&w.received());
        let used: Vec<Value> =
            before.as_array().unwrap().iter().map(|tx| tx["indexes"].clone()).collect();
        assert_eq!(json!(used), json!([[3, 5], [null], [7], [0]]), "known before any memo is read");
        assert_eq!(before[3]["memos"], json!([]));
        for (i, n) in w.notes.iter_mut().enumerate() {
            n.memo = Some(if i == 1 { MemoView::NotText } else { MemoView::Text(format!("m{i}")) });
        }
        let list = v(&w.received());
        let indexes: Vec<Value> = list
            .as_array()
            .unwrap()
            .iter()
            .map(|tx| tx["memos"].as_array().unwrap().iter().map(|m| m["index"].clone()).collect())
            .collect();
        let want = json!([[3, 5], [null], [7], [0]]);
        assert_eq!(json!(indexes), want, "newest first; null when it does not fit in a u32");
        assert_eq!(list[2]["memos"][0], json!({"status": "not_text", "index": 7}));
        assert_eq!(list[3]["memos"][0], json!({"status": "text", "text": "m0", "index": 0}));
        let snap: Value = serde_json::from_str(&w.snapshot().unwrap()).unwrap();
        assert!(snap["notes"][0]["memo"].get("index").is_none(), "the saved state has no index");
    }

    #[test]
    fn a_note_of_zero_value_is_never_spent_and_a_message_may_pay_the_fee_only() {
        let fee = |n: usize| zip317_fee(n, 2);
        let notes = [(0, 10), (0, 11), (60_000, 12)];
        let p = pick_notes(&notes, 0, 2, SYNCED, 1).unwrap();
        assert_eq!((p.picked, p.fee, p.change), (vec![2], fee(1), 50_000));
        assert!(select_notes(&notes, 0, 2, SYNCED, 1).is_err(), "a payment still needs an amount");
        let spam = pick_notes(&[(0, 10), (0, 11)], 0, 2, SYNCED, 1).unwrap_err();
        assert!(spam.contains("not enough funds: 0 zat spendable"), "{spam}");
        let small = pick_notes(&[(9_999, 10)], 0, 2, SYNCED, 1).unwrap_err();
        assert!(small.contains("9999 zat spendable, 10000 zat needed"), "{small}");
        assert_eq!(pick_notes(&[(10_000, 10)], 0, 2, SYNCED, 1).unwrap().change, 0);
        assert_eq!(max_send(&[(0, 10), (0, 11), (60_000, 12)], SYNCED), 50_000);
    }

    /// The first block of the test chains that build transactions. The builder needs the height of
    /// the NU7 upgrade (v6 transactions) on testnet.
    const NU7: u32 = 4_500_000;

    /// The wallet of the personal account for `seed`, and its key.
    fn account_wallet(seed: &str, birthday: u32) -> (Inner, FullViewingKey) {
        let keys = v(&account::keys(seed, "testnet").unwrap());
        let mut w = Inner::new(keys["ufvk"].as_str().unwrap(), birthday, "").unwrap();
        w.start(&base_state(birthday)).unwrap();
        let key = w.ufvk.orchard().unwrap().clone();
        (w, key)
    }

    /// An account that holds one note of each value in `notes`, confirmed.
    fn funded_account(seed: &str, notes: &[u64]) -> (Inner, Chain) {
        let (mut w, key) = account_wallet(seed, NU7);
        let mut chain = Chain::new(NU7);
        chain.push(notes.iter().map(|n| pays(external(&key), *n, no_memo(), None).0).collect(), 0);
        chain.grow(2, 0);
        follow(&mut w, &chain).unwrap();
        (w, chain)
    }

    fn address_for(seed: &str, index: u32) -> String {
        let keys = v(&account::keys(seed, "testnet").unwrap());
        account::address_at(keys["ufvk"].as_str().unwrap(), index).unwrap()
    }

    fn message_of(w: &Inner, to: &str, text: &str, tip: u32) -> R<Value> {
        let payees = message_payees(to, text, Network::TestNetwork)?;
        message_pczt(w, &payees, tip).map(|made| v(&made))
    }

    #[test]
    fn a_message_pays_the_fee_of_its_outputs_and_spends_no_zero_note() {
        let seed = "0a".repeat(32);
        let (w, chain) = funded_account(&seed, &[1_000_000, 0, 0]);
        let to = address_for(&"0b".repeat(32), 1);
        let tip = chain.last_height();
        let sized = |bytes: usize| message_of(&w, &to, &"a".repeat(bytes), tip).unwrap();
        for (bytes, parts, fee) in [(1, 1, 10_000), (512, 1, 10_000), (513, 2, 15_000),
                                    (1300, 3, 20_000), (2000, 4, 25_000)] {
            let made = sized(bytes);
            assert_eq!((&made["parts"], &made["fee"]), (&json!(parts), &json!(fee)), "{bytes}");
            assert_eq!(made["note_value"], 1_000_000, "the zero notes stay unspent");
            assert_eq!(made["change"], 1_000_000 - fee);
            assert_eq!(made["pool"], "ironwood");
            assert!(made.get("amount").is_none());
        }
        let five = message_of(&w, &to, &"é".repeat(1265), tip).unwrap();
        assert_eq!((&five["parts"], &five["fee"]), (&json!(5), &json!(30_000)));
    }

    /// A group payment expires one day of blocks after its target and may pay 10 times the fee.
    /// A message keeps the builder's 40 blocks and the standard fee.
    #[test]
    fn a_group_payment_expires_after_a_day_and_may_pay_the_priority_fee() {
        let (w, chain) = funded_account(&"0a".repeat(32), &[1_000_000]);
        let to = address_for(&"0b".repeat(32), 1);
        let payees = parse_payees(&[json!({"to": to, "amount": 100_000})], Network::TestNetwork);
        let (payees, tip) = (payees.unwrap(), chain.last_height());
        let fvk = hex::encode(w.ufvk.orchard().unwrap().to_bytes());
        let inspect = |made: &Value| {
            v(&crate::inspect(made["pczt"].as_str().unwrap(), &fvk).unwrap())
        };
        for (priority, fee) in [(false, 10_000), (true, 100_000)] {
            let made = v(&spend_pczt(&w, &payees, tip, priority).unwrap());
            assert_eq!((&made["fee"], &made["change"]), (&json!(fee), &json!(900_000 - fee)));
            let ins = inspect(&made);
            assert_eq!((&ins["fee"], &ins["standard_fee"]), (&json!(fee), &json!(10_000)));
            assert_eq!(ins["expiry_height"], tip + 1 + 3_456, "one day at 25 seconds");
        }
        let ins = inspect(&message_of(&w, &to, "hi", tip).unwrap());
        assert_eq!((&ins["fee"], &ins["expiry_height"]), (&json!(10_000), &json!(tip + 1 + 40)));
    }

    #[test]
    fn a_message_is_refused_for_its_text_its_address_or_its_funds() {
        let seed = "0a".repeat(32);
        let (w, chain) = funded_account(&seed, &[9_000]);
        let to = address_for(&"0b".repeat(32), 1);
        let tip = chain.last_height();
        let err = |to: &str, text: &str| message_of(&w, to, text, tip).unwrap_err();
        assert!(err(&to, "hi").contains("not enough funds: 9000 zat spendable"));
        assert_eq!(err(&to, ""), "The message is empty.");
        assert!(err(&to, "a\0b").contains("null character"));
        assert!(err(&to, &"a".repeat(2001)).contains("2001 characters"));
        assert!(err("nope", "hi").contains("must be a testnet unified address"));
        let main = account::address_at(
            v(&account::keys(&seed, "mainnet").unwrap())["ufvk"].as_str().unwrap(), 0).unwrap();
        assert!(err(&main, "hi").contains("must be a testnet unified address"));
        let tex = Address::Tex([3; 20]).encode(&Network::TestNetwork);
        assert!(err(&tex, "hi").contains("must be a testnet unified address"));
    }

    /// A message of 3 parts, built, signed with the seed, proved and read by the recipient.
    #[test]
    fn a_three_part_message_is_built_signed_proved_and_read_by_its_recipient() {
        let (sender, reader) = ("0a".repeat(32), "0b".repeat(32));
        let (mut w, mut chain) = funded_account(&sender, &[1_000_000]);
        let to = address_for(&reader, 7);
        let text = "Zigs ✓ 😀 héllo. ".repeat(55);
        let made = message_of(&w, &to, &text, chain.last_height()).unwrap();
        let shape = (&made["parts"], &made["fee"], &made["change"]);
        assert_eq!(shape, (&json!(3), &json!(20_000), &json!(980_000)));
        let pczt = made["pczt"].as_str().unwrap();

        let wrong = account::sign(pczt, &reader, "testnet").unwrap_err();
        assert!(wrong.contains("does not own the notes"), "{wrong}");
        assert!(account::sign(pczt, &sender, "mainnet").unwrap_err().contains("another network"));
        let signed = v(&account::sign(pczt, &sender, "testnet").unwrap());
        let signed = signed["signed_pczt"].as_str().unwrap();
        let again = account::sign(signed, &sender, "testnet").unwrap_err();
        assert!(again.contains("no spend to sign"), "{again}");
        let out = v(&crate::finalize(signed).unwrap());
        let txid = out["txid"].as_str().unwrap();
        let raw = hex::decode(out["tx_hex"].as_str().unwrap()).unwrap();

        let tx = Transaction::read(&raw[..], BranchId::Nu6_3).unwrap();
        chain.push(vec![compact_of(&tx)], 0);
        follow(&mut w, &chain).unwrap();
        assert_eq!((w.sent.len(), w.sent[0].0.as_str()), (1, txid), "the spend is on the chain");
        assert_eq!(v(&w.balance())["pending"], 980_000, "the change comes back");

        let (mut r, _) = account_wallet(&reader, NU7);
        follow(&mut r, &chain).unwrap();
        let list = v(&r.received());
        assert_eq!(list.as_array().unwrap().len(), 1);
        let first = (&list[0]["value"], &list[0]["memo_pending"], &list[0]["memos"]);
        assert_eq!(first, (&json!(0), &json!(true), &json!([])), "found, memo not read yet");
        let needs = v(&r.memo_needs().unwrap());
        assert_eq!(needs.as_array().unwrap().len(), 1);
        assert_eq!(needs[0]["txid"], txid);
        assert_eq!(r.attach_transaction(txid, &raw).unwrap(), 3);
        assert_eq!(r.memo_needs().unwrap(), "[]");
        let list = v(&r.received());
        assert_eq!(list[0]["memo_pending"], false);
        let memos = list[0]["memos"].as_array().unwrap();
        assert_eq!(memos.len(), 3);
        assert!(memos.iter().all(|m| m["status"] == "text" && m["index"] == 7), "{memos:?}");
        let texts: Vec<&Value> = memos.iter().map(|m| &m["text"]).collect();
        let joined = v(&account::join_message(&json!(texts).to_string()).unwrap());
        assert_eq!(joined["text"], text.as_str(), "the order of the outputs does not matter");
    }

    #[test]
    fn the_native_interface_builds_a_message() {
        use base64::Engine as _;
        let seed = "0c".repeat(32);
        let keys = v(&account::keys(&seed, "testnet").unwrap());
        let (k, to) = ("message-wallet", address_for(&"0b".repeat(32), 2));
        native::open(k, keys["ufvk"].as_str().unwrap(), NU7, None).unwrap();
        native::start(k, &B64.encode(base_state(NU7).encode_to_vec())).unwrap();
        let err = native::message(k, &to, "hi", NU7 + 10).unwrap_err();
        assert!(err.contains("not enough funds"), "{err}");
        let key = ufvk_key(keys["ufvk"].as_str().unwrap());
        let mut chain = Chain::new(NU7);
        chain.push(vec![pays(external(&key), 100_000, no_memo(), None).0], 0);
        chain.grow(2, 0);
        let batch: Vec<Value> =
            chain.blocks.iter().map(|b| json!(B64.encode(b.encode_to_vec()))).collect();
        native::blocks(k, &batch, chain.last_height()).unwrap();
        let made = v(&native::message(k, &to, "hello", chain.last_height()).unwrap());
        let shape = (&made["parts"], &made["fee"], &made["change"]);
        assert_eq!(shape, (&json!(1), &json!(10_000), &json!(90_000)));
        let err = native::message(k, "nope", "hello", chain.last_height()).unwrap_err();
        assert!(err.contains("must be a testnet unified address"), "{err}");
        native::close(k).unwrap();
        assert!(native::message(k, &to, "hello", 1).unwrap_err().contains("no open wallet"));
    }

    fn ufvk_key(ufvk: &str) -> FullViewingKey {
        decode_ufvk(ufvk).unwrap().1.orchard().unwrap().clone()
    }
}
