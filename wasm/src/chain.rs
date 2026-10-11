//! Zcash testnet sync, balance, spend creation and broadcast for one group
//! viewing key. The wallet only reads the chain through a grpc-web proxy.

use std::{cell::RefCell, convert::Infallible, rc::Rc};

use incrementalmerkletree::{frontier::Frontier, Marking, Position, Retention};
use orchard::{keys::Scope, note::Nullifier, tree::MerkleHashOrchard};
use serde_json::json;
use shardtree::{store::memory::MemoryShardStore, ShardTree};
use wasm_bindgen::prelude::*;
use zcash_client_backend::{
    data_api::BlockMetadata,
    proto::{
        compact_formats::CompactBlock,
        service::{
            compact_tx_streamer_client::CompactTxStreamerClient, BlockId, BlockRange, ChainSpec,
            RawTransaction,
        },
    },
    scanning::{scan_block, ScanningKeys, SpendIdentifiers},
};
use zcash_keys::{address::Address, keys::UnifiedFullViewingKey};
use zcash_protocol::consensus::{BlockHeight, Network};

use super::{build_ironwood_pczt, e, ensure, pczt_to_b64, R};

const BATCH: u32 = 1000;
const CONFIRMATIONS: u32 = 3;
const MARGINAL_FEE: u64 = 5000;

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

struct Rec {
    note: orchard::Note,
    position: Position,
    height: u32,
    nf: Nullifier,
    spent: bool,
    txid: String,
    change: bool,
}

impl Rec {
    fn value(&self) -> u64 {
        self.note.value().inner()
    }
}

// ponytail: all state lives in memory, so each page load re-syncs from the birthday;
// upgrade path is persisting the tree and notes in IndexedDB. Reorgs are not handled.
struct Inner {
    ufvk: UnifiedFullViewingKey,
    birthday: u32,
    endpoint: String,
    tree: Tree,
    keys: ScanningKeys<u32, (u32, Scope)>,
    ids: SpendIdentifiers<u32>,
    notes: Vec<Rec>,
    /// Transactions that spent our notes, as seen in blocks: proof that a payment went out.
    sent: Vec<String>,
    synced: u32,
    tip: u32,
    prior: Option<BlockMetadata>,
    busy: bool,
}

impl Inner {
    fn apply_block(&mut self, block: CompactBlock) -> R<()> {
        let height = u32::try_from(block.height).map_err(e("block height"))?;
        let sb = scan_block::<_, _, _, Infallible>(
            &Network::TestNetwork,
            block,
            &self.keys,
            &self.ids,
            self.prior.as_ref(),
        )
        .map_err(|x| format!("scan failed at block {height}: {x:?}"))?;
        for tx in sb.transactions() {
            let txid = tx.txid().to_string();
            if !tx.ironwood_spends().is_empty() && !self.sent.contains(&txid) {
                self.sent.push(txid.clone());
            }
            for sp in tx.ironwood_spends() {
                for n in self.notes.iter_mut().filter(|n| n.nf == *sp.nf()) {
                    n.spent = true;
                }
            }
            for out in tx.ironwood_outputs() {
                let nf = *out.nf().ok_or("decrypted note has no nullifier")?;
                let note = out.note().0;
                let position = out.note_commitment_tree_position();
                let change = out.is_change();
                self.notes.push(Rec { note, position, height, nf, spent: false, txid: txid.clone(), change });
            }
        }
        self.ids.update_with(&sb);
        self.prior = Some(sb.to_block_metadata());
        let commitments = sb.into_commitments().ironwood;
        let checkpointed = commitments.last().is_some_and(|(_, r)| r.is_checkpoint());
        for (cmx, retention) in commitments {
            self.tree.append(cmx, retention).map_err(e("tree append"))?;
        }
        if !checkpointed {
            self.tree.checkpoint(BlockHeight::from_u32(height)).map_err(e("tree checkpoint"))?;
        }
        self.synced = height;
        Ok(())
    }

    fn balance(&self) -> String {
        let (mut spendable, mut pending, mut count) = (0u64, 0u64, 0u64);
        for n in self.notes.iter().filter(|n| !n.spent) {
            count += 1;
            if is_confirmed(n.height, self.synced) {
                spendable += n.value();
            } else {
                pending += n.value();
            }
        }
        json!({"height": self.synced, "tip": self.tip, "spendable": spendable,
            "pending": pending, "notes": count})
        .to_string()
    }
}

impl Inner {
    /// Payments into this wallet from outside, newest first: one entry per transaction.
    fn received(&self) -> String {
        let mut by_tx: Vec<(String, u32, u64)> = vec![];
        for n in self.notes.iter().filter(|n| !n.change) {
            match by_tx.iter_mut().find(|(t, _, _)| *t == n.txid) {
                Some(entry) => entry.2 += n.value(),
                None => by_tx.push((n.txid.clone(), n.height, n.value())),
            }
        }
        by_tx.sort_by_key(|(_, h, _)| std::cmp::Reverse(*h));
        let list: Vec<_> = by_tx
            .iter()
            .map(|(txid, height, value)| {
                json!({"txid": txid, "height": height, "value": value,
                    "confirmed": is_confirmed(*height, self.synced)})
            })
            .collect();
        json!(list).to_string()
    }
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

fn zip317_fee(spends: usize) -> u64 {
    MARGINAL_FEE * spends.max(2) as u64
}

/// `notes` is `(value, height)` of each unspent note. Picks confirmed notes, largest first.
fn select_notes(notes: &[(u64, u32)], amount: u64, synced: u32) -> R<Pick> {
    ensure(amount > 0, "amount must be greater than zero")?;
    let mut eligible: Vec<usize> =
        (0..notes.len()).filter(|&i| is_confirmed(notes[i].1, synced)).collect();
    eligible.sort_by_key(|&i| std::cmp::Reverse(notes[i].0));
    let (mut picked, mut total) = (vec![], 0u64);
    for i in eligible {
        picked.push(i);
        total += notes[i].0;
        let fee = zip317_fee(picked.len());
        if total >= amount.saturating_add(fee) {
            return Ok(Pick { picked, fee, change: total - amount - fee, total });
        }
    }
    let need = amount.saturating_add(zip317_fee(picked.len()));
    Err(format!("not enough funds: {total} zat spendable, {need} zat needed (amount + fee)"))
}

pub(crate) fn parse_recipient(s: &str) -> R<orchard::Address> {
    match Address::decode(&Network::TestNetwork, s.trim()) {
        Some(Address::Unified(ua)) => ua
            .orchard()
            .copied()
            .ok_or_else(|| "the recipient address has no Orchard receiver".to_string()),
        _ => Err("the recipient must be a testnet unified address".to_string()),
    }
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
    let frontier: Frontier<MerkleHashOrchard, 32> =
        ts.ironwood_tree().map_err(e("ironwood tree state"))?.to_frontier();
    let mut s = state.borrow_mut();
    let retention =
        Retention::Checkpoint { id: BlockHeight::from_u32(birthday - 1), marking: Marking::None };
    s.tree.insert_frontier(frontier, retention).map_err(e("tree frontier"))?;
    s.synced = birthday - 1;
    Ok(())
}

async fn sync_to_tip(state: &RefCell<Inner>, on_progress: &js_sys::Function) -> R<()> {
    if state.borrow().synced == 0 {
        first_sync(state).await?;
    }
    let endpoint = state.borrow().endpoint.clone();
    let tip = tip_of(&endpoint).await?;
    state.borrow_mut().tip = tip;
    loop {
        let next = state.borrow().synced + 1;
        if next > tip {
            return Ok(());
        }
        let end = tip.min(next + BATCH - 1);
        let range = BlockRange {
            start: Some(block_id(next)),
            end: Some(block_id(end)),
            pool_types: vec![],
        };
        let mut stream =
            client(&endpoint).get_block_range(range).await.map_err(rpc)?.into_inner();
        while let Some(block) = stream.message().await.map_err(rpc)? {
            state.borrow_mut().apply_block(block)?;
        }
        let synced = state.borrow().synced;
        ensure(synced >= next, "lightwalletd returned no blocks for the requested range")?;
        let msg = json!({"height": synced, "tip": tip}).to_string();
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

fn spend_pczt(s: &Inner, payee: orchard::Address, amount: u64, tip: u32) -> R<String> {
    let fvk = s.ufvk.orchard().ok_or("the viewing key has no Orchard component")?;
    let unspent: Vec<&Rec> = s.notes.iter().filter(|n| !n.spent).collect();
    let values: Vec<(u64, u32)> = unspent.iter().map(|n| (n.value(), n.height)).collect();
    let pick = select_notes(&values, amount, s.synced)?;
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
    let pczt = build_ironwood_pczt(
        Network::TestNetwork,
        BlockHeight::from_u32(tip + 1),
        fvk,
        (inputs, orchard::Anchor::from(root)),
        (payee, amount, pick.change),
    )?;
    Ok(json!({"pczt": pczt_to_b64(pczt)?, "pool": "ironwood", "amount": amount,
        "change": pick.change, "fee": pick.fee, "note_value": pick.total})
    .to_string())
}

async fn create_spend(state: &RefCell<Inner>, recipient: &str, amount: u64) -> R<String> {
    let payee = parse_recipient(recipient)?;
    let endpoint = state.borrow().endpoint.clone();
    let tip = tip_of(&endpoint).await?;
    let mut s = state.borrow_mut();
    s.tip = tip;
    spend_pczt(&s, payee, amount, tip)
}

async fn broadcast(endpoint: &str, tx_hex: &str) -> R<String> {
    let data = hex::decode(tx_hex.trim()).map_err(e("transaction hex"))?;
    let r = client(endpoint)
        .send_transaction(RawTransaction { data, height: 0 })
        .await
        .map_err(rpc)?
        .into_inner();
    ensure(r.error_code == 0, &format!("node rejected the transaction: {}", r.error_message))?;
    Ok(json!({"txid": r.error_message.trim().trim_matches('"')}).to_string())
}

#[wasm_bindgen(js_name = latestHeight)]
pub async fn js_latest_height(endpoint: String) -> Result<u32, JsError> {
    super::js(tip_of(&endpoint).await)
}

#[wasm_bindgen]
pub struct ChainWallet(Rc<RefCell<Inner>>);

#[wasm_bindgen]
impl ChainWallet {
    #[wasm_bindgen(constructor)]
    pub fn new(ufvk: &str, birthday: u32, endpoint: &str) -> Result<ChainWallet, JsError> {
        let ufvk = UnifiedFullViewingKey::decode(&Network::TestNetwork, ufvk)
            .map_err(|x| JsError::new(&format!("bad viewing key: {x}")))?;
        let keys = ScanningKeys::from_account_ufvks([(0u32, ufvk.clone())]);
        let tree = ShardTree::new(MemoryShardStore::empty(), 100);
        Ok(ChainWallet(Rc::new(RefCell::new(Inner {
            ufvk,
            birthday,
            endpoint: endpoint.to_string(),
            tree,
            keys,
            ids: SpendIdentifiers::empty(),
            notes: vec![],
            sent: vec![],
            synced: 0,
            tip: 0,
            prior: None,
            busy: false,
        }))))
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
        json!(self.0.borrow().sent).to_string()
    }

    #[wasm_bindgen(js_name = createSpend)]
    pub async fn create_spend(&self, recipient: String, amount: f64) -> Result<String, JsError> {
        super::js(create_spend(&self.0, &recipient, amount as u64).await)
    }

    pub async fn broadcast(&self, tx_hex: String) -> Result<String, JsError> {
        let endpoint = self.0.borrow().endpoint.clone();
        super::js(broadcast(&endpoint, &tx_hex).await)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SYNCED: u32 = 100;

    #[test]
    fn exact_amount_uses_one_note_and_no_change() {
        let p = select_notes(&[(110_000, 50)], 100_000, SYNCED).unwrap();
        assert_eq!((p.picked, p.fee, p.change, p.total), (vec![0], 10_000, 0, 110_000));
    }

    #[test]
    fn not_enough_funds_reports_need() {
        let err = select_notes(&[(109_999, 50)], 100_000, SYNCED).unwrap_err();
        assert!(err.contains("not enough funds"), "{err}");
        assert!(err.contains("109999") && err.contains("110000"), "{err}");
        assert!(select_notes(&[], 1, SYNCED).unwrap_err().contains("not enough funds"));
        assert!(select_notes(&[(1, 50)], 0, SYNCED).is_err());
    }

    #[test]
    fn fee_grows_with_three_spends_largest_first() {
        let notes = [(40_000, 10), (90_000, 11), (50_000, 12), (5, 13)];
        let p = select_notes(&notes, 150_000, SYNCED).unwrap();
        assert_eq!(p.picked, vec![1, 2, 0]);
        assert_eq!((p.fee, p.total, p.change), (15_000, 180_000, 15_000));
    }

    #[test]
    fn unconfirmed_notes_are_excluded() {
        let notes = [(1_000_000, SYNCED - 1), (60_000, SYNCED - 2)];
        let err = select_notes(&notes, 100_000, SYNCED).unwrap_err();
        assert!(err.contains("60000 zat spendable"), "{err}");
        assert!(select_notes(&notes, 50_000, SYNCED).is_ok());
    }
}
