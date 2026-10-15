//! The second DKG of ZOLANA.md 4.1: FROST(Ed25519, SHA-512) parts 1 to 3 as JSON strings, as the
//! Zcash engine writes them, and the three hashes that bind the ceremony to the wallet.
//!
//! Seats are numbered 1..=n. Every argument keyed by seat is a JSON object `{"1": X, ...}` that is
//! read into an ordered map. Byte strings are hex. `walletId`, the safety number and the cluster
//! enter a hash as `u32le(len) || UTF-8 bytes`, so no text runs into the next field.
//!
//! - `commit`: BLAKE2b-256("Zigs_SolCmt___v1", lp(walletId) || u16le(seat) || boxPk ||
//!   lp(cluster) || rSol). The seat commits to its secret part before round 2.
//! - `echo`: BLAKE2b-256("Zigs_SolEcho__v1", lp(walletId) || lp(safetyNumber) || lp(cluster) ||
//!   for each seat in order: u16le(seat) || lp(round-1 package) || commit). The package is the
//!   frost binary encoding, so the JSON key order does not matter.
//! - `sol_seed`: BLAKE2b-256("Zigs_SolSeed__v1", lp(walletId) || echo || rSol_1 || ... || rSol_n).
//!
//! `dkg3` takes the round-1 documents of every seat and computes the echo from them. The saved
//! echo of the seat and the echo that each other seat signed in round 2 must equal it, or the
//! seat ends. It checks every commitment next and names the first seat whose part does not match.
//! It gives a key package only after those checks and the frost round 3 all pass.
//!
//! `share_fits` checks a key share against its public share, and `PROGRAM_LABEL` is the version
//! label of the program ids that `soldone` documents carry.

use std::collections::BTreeMap;

use frost_ed25519::keys::{dkg, KeyPackage, VerifyingShare};
use frost_ed25519::{Identifier, VerifyingKey};
use rand_core::OsRng;
use serde_json::{json, Value};

use crate::bytes::hex;
use crate::codec::{
    blake2b_256, from_json, from_value, full_seat_map, push_len_prefixed, seat_map, text_of,
    to_value, unhex_array,
};

const COMMIT_PERSONAL: &[u8; 16] = b"Zigs_SolCmt___v1";
const ECHO_PERSONAL: &[u8; 16] = b"Zigs_SolEcho__v1";
const SEED_PERSONAL: &[u8; 16] = b"Zigs_SolSeed__v1";

/// The only cluster of the spike: a testnet wallet gets Devnet, a mainnet wallet gets no Solana.
pub const CLUSTER: &str = "devnet";
/// The wallet of the web app has 2 to 7 signers.
pub const MAX_SEATS: u16 = 7;
/// The version label of the program ids in the pins: the cluster, the pool and the registry. A
/// `soldone` document carries it, and a seat whose label differs from this one ends
/// (ZOLANA.md 4.1 step 6). `tests/roles.rs` ties the two addresses to `consts.rs`.
pub const PROGRAM_LABEL: &str = "zolana-devnet:sppU489D7A4U1exNo1oeMGZtLEofq3a6o2fR7UeoWB6:\
regyS5rkAcw2YzDJCmTwCTHs2s246FXxbmuRZ42u2PD";

/// A frost error as text, with what was being done.
fn frost_err(what: &'static str) -> impl Fn(frost_ed25519::Error) -> String {
    move |e| format!("{what}: {e}")
}

/// Refuses every cluster but Devnet. The pins of the checker are Devnet constants.
pub fn check_cluster(cluster: &str) -> Result<(), String> {
    if cluster == CLUSTER {
        Ok(())
    } else {
        Err(format!("the cluster must be {CLUSTER}"))
    }
}

fn ident(seat: u16) -> Result<Identifier, String> {
    Identifier::try_from(seat).map_err(frost_err("seat"))
}

/// The seat number of an identifier. The identifiers of this wallet fit in a `u16`.
pub fn seat_of(id: &Identifier) -> Result<u16, String> {
    let bytes = id.serialize();
    match bytes.split_first_chunk::<2>() {
        Some((low, rest)) if rest.iter().all(|b| *b == 0) => Ok(u16::from_le_bytes(*low)),
        _ => Err("an identifier is not a seat number".to_string()),
    }
}

/// `{"1": X, "2": Y}` as a map from identifier to a frost object.
pub fn id_map<T: serde::de::DeserializeOwned>(
    json: &str,
    what: &str,
) -> Result<BTreeMap<Identifier, T>, String> {
    let mut map = BTreeMap::new();
    for (seat, item) in seat_map(json, what)? {
        map.insert(ident(seat)?, from_value(&item, what)?);
    }
    Ok(map)
}

fn check_limits(id: u16, n: u16, t: u16) -> Result<(), String> {
    if !(2..=MAX_SEATS).contains(&n) {
        return Err(format!("n must be from 2 to {MAX_SEATS}"));
    }
    if t < 2 || t > n {
        return Err("t must be at least 2 and at most n".to_string());
    }
    if id < 1 || id > n {
        return Err("the seat must be from 1 to n".to_string());
    }
    Ok(())
}

/// Round 1 of seat `id` in an `t`-of-`n` wallet: `{"secret": ..., "package": ...}`.
pub fn dkg1(id: u16, n: u16, t: u16) -> Result<String, String> {
    check_limits(id, n, t)?;
    let (secret, package) = dkg::part1(ident(id)?, n, t, OsRng).map_err(frost_err("dkg part1"))?;
    Ok(json!({
        "secret": to_value(&secret, "round-1 secret")?,
        "package": to_value(&package, "round-1 package")?,
    })
    .to_string())
}

/// Round 2. `round1` holds the round-1 packages of every other seat. The answer is
/// `{"secret": ..., "outgoing": {"<seat>": package, ...}}`: one package for each other seat.
pub fn dkg2(secret: &str, round1: &str) -> Result<String, String> {
    let secret: dkg::round1::SecretPackage = from_json(secret, "round-1 secret")?;
    let round1 = id_map::<dkg::round1::Package>(round1, "round-1 packages")?;
    let (secret2, out) = dkg::part2(secret, &round1).map_err(frost_err("dkg part2"))?;
    let mut outgoing = serde_json::Map::new();
    for (to, package) in out {
        outgoing.insert(
            seat_of(&to)?.to_string(),
            to_value(&package, "round-2 package")?,
        );
    }
    Ok(json!({"secret": to_value(&secret2, "round-2 secret")?, "outgoing": outgoing}).to_string())
}

fn commitment(
    wallet_id: &str,
    seat: u16,
    box_pk: &[u8; 32],
    cluster: &str,
    r_sol: &[u8; 32],
) -> Result<[u8; 32], String> {
    let mut data = Vec::new();
    push_len_prefixed(&mut data, wallet_id.as_bytes())?;
    data.extend_from_slice(&seat.to_le_bytes());
    data.extend_from_slice(box_pk);
    push_len_prefixed(&mut data, cluster.as_bytes())?;
    data.extend_from_slice(r_sol);
    Ok(blake2b_256(COMMIT_PERSONAL, &[&data]))
}

/// The commitment of seat `seat` to its secret part `r_sol`, as hex.
pub fn commit(
    wallet_id: &str,
    seat: u16,
    box_pk: &str,
    cluster: &str,
    r_sol: &str,
) -> Result<String, String> {
    check_cluster(cluster)?;
    if seat < 1 {
        return Err("the seat must be 1 or more".to_string());
    }
    let box_pk = unhex_array(box_pk, "boxPk")?;
    let r_sol = unhex_array(r_sol, "rSol")?;
    Ok(hex(&commitment(wallet_id, seat, &box_pk, cluster, &r_sol)?))
}

/// The round-1 document of one seat: its package and its commitment.
struct Doc {
    package: dkg::round1::Package,
    commit: [u8; 32],
}

/// `{"1": {"package": ..., "commit": hex}, ...}`: the seats 1 to n, n of 2 or more.
fn parse_docs(json: &str) -> Result<BTreeMap<u16, Doc>, String> {
    let mut docs = BTreeMap::new();
    for (seat, doc) in full_seat_map(json, "round-1 documents")? {
        let package = from_value(
            doc.get("package").unwrap_or(&Value::Null),
            "round-1 package",
        )?;
        let commit = unhex_array(text_of(&doc, "commit", "round-1 document")?, "commit")?;
        docs.insert(seat, Doc { package, commit });
    }
    Ok(docs)
}

fn echo_of(
    wallet_id: &str,
    safety: &str,
    cluster: &str,
    docs: &BTreeMap<u16, Doc>,
) -> Result<[u8; 32], String> {
    let mut data = Vec::new();
    for text in [wallet_id, safety, cluster] {
        push_len_prefixed(&mut data, text.as_bytes())?;
    }
    for (seat, doc) in docs {
        let canonical = doc
            .package
            .serialize()
            .map_err(|e| format!("round-1 package of seat {seat}: {e}"))?;
        data.extend_from_slice(&seat.to_le_bytes());
        push_len_prefixed(&mut data, &canonical)?;
        data.extend_from_slice(&doc.commit);
    }
    Ok(blake2b_256(ECHO_PERSONAL, &[&data]))
}

/// What every seat saw in round 1, as hex: `round1 = {"1": {"package": ..., "commit": hex}, ...}`.
/// Seats that hold other data, another safety number or another wallet get another echo.
pub fn echo(wallet_id: &str, safety: &str, cluster: &str, round1: &str) -> Result<String, String> {
    check_cluster(cluster)?;
    let docs = parse_docs(round1)?;
    Ok(hex(&echo_of(wallet_id, safety, cluster, &docs)?))
}

/// The secret part of a seat and its box key, which its commitment names.
struct Part {
    r_sol: [u8; 32],
    box_pk: [u8; 32],
}

/// What round 3 reads from the page besides the round-1 documents: the wallet, the safety number,
/// the cluster, this seat, the echo that this seat saved, the echo that each other seat signed
/// in its round-2 documents, and the part of every seat.
struct Ceremony {
    wallet_id: String,
    safety: String,
    cluster: String,
    seat: u16,
    echo: [u8; 32],
    peer_echoes: BTreeMap<u16, [u8; 32]>,
    parts: BTreeMap<u16, Part>,
}

impl Ceremony {
    /// `{"walletId", "safety", "cluster", "seat", "echo", "peerEchoes": {"<seat>": hex, ...},
    /// "parts": {"1": {"r", "boxPk"}, ...}}`.
    fn parse(json: &str) -> Result<Self, String> {
        let ctx: Value = from_json(json, "round-3 context")?;
        let text = |key: &str| text_of(&ctx, key, "round-3 context");
        let seat = ctx
            .get("seat")
            .and_then(Value::as_u64)
            .and_then(|seat| u16::try_from(seat).ok())
            .ok_or("round-3 context has no seat number")?;
        let cluster = text("cluster")?.to_string();
        check_cluster(&cluster)?;
        Ok(Self {
            wallet_id: text("walletId")?.to_string(),
            safety: text("safety")?.to_string(),
            cluster,
            seat,
            echo: unhex_array(text("echo")?, "echo")?,
            peer_echoes: peer_echoes(ctx.get("peerEchoes"))?,
            parts: parts_of(ctx.get("parts"))?,
        })
    }

    /// The seats of the documents are the seats of the parts, and this seat is one of them. The
    /// peer echoes are those of every other seat.
    fn check_roster(&self, docs: &BTreeMap<u16, Doc>) -> Result<(), String> {
        let seats: Vec<u16> = docs.keys().copied().collect();
        let others: Vec<u16> = seats.iter().copied().filter(|s| *s != self.seat).collect();
        if others.len() + 1 != seats.len() {
            return Err("this seat is not a seat of round 1".to_string());
        }
        if self.parts.keys().copied().collect::<Vec<_>>() != seats {
            return Err("the secret parts are not the seats of round 1".to_string());
        }
        if self.peer_echoes.keys().copied().collect::<Vec<_>>() != others {
            return Err("the peer echoes are not those of the other seats".to_string());
        }
        Ok(())
    }

    /// The echo of the documents. It must equal the echo that this seat saved and the echo that
    /// each other seat signed: a seat that saw other data ends the ceremony.
    fn checked_echo(&self, docs: &BTreeMap<u16, Doc>) -> Result<[u8; 32], String> {
        let echo = echo_of(&self.wallet_id, &self.safety, &self.cluster, docs)?;
        if echo != self.echo {
            return Err(format!("{DIFFERENT}: the echo of this seat differs"));
        }
        if let Some((seat, _)) = self.peer_echoes.iter().find(|(_, theirs)| **theirs != echo) {
            return Err(format!("{DIFFERENT}: the echo of seat {seat} differs"));
        }
        Ok(echo)
    }

    /// Every commitment, in seat order. The error names the first seat that does not match.
    fn check_commitments(&self, docs: &BTreeMap<u16, Doc>) -> Result<(), String> {
        for (seat, doc) in docs {
            let part = self
                .parts
                .get(seat)
                .ok_or_else(|| format!("seat {seat}: no secret part"))?;
            let want = commitment(
                &self.wallet_id,
                *seat,
                &part.box_pk,
                &self.cluster,
                &part.r_sol,
            )?;
            if want != doc.commit {
                return Err(format!(
                    "seat {seat}: the secret part does not match its commitment"
                ));
            }
        }
        Ok(())
    }

    /// `BLAKE2b-256("Zigs_SolSeed__v1", lp(walletId) || echo || rSol_1 || ... || rSol_n)`.
    fn sol_seed(&self, echo: &[u8; 32]) -> Result<[u8; 32], String> {
        let mut data = Vec::new();
        push_len_prefixed(&mut data, self.wallet_id.as_bytes())?;
        data.extend_from_slice(echo);
        for part in self.parts.values() {
            data.extend_from_slice(&part.r_sol);
        }
        Ok(blake2b_256(SEED_PERSONAL, &[&data]))
    }
}

const DIFFERENT: &str = "the signers saw different setup data";

/// `{"<seat>": hex, ...}`: an echo of 32 bytes for each seat.
fn peer_echoes(value: Option<&Value>) -> Result<BTreeMap<u16, [u8; 32]>, String> {
    let json = value.unwrap_or(&Value::Null).to_string();
    let mut echoes = BTreeMap::new();
    for (seat, text) in seat_map(&json, "peer echoes")? {
        let hex = text.as_str().ok_or("a peer echo is not text")?;
        echoes.insert(seat, unhex_array(hex, "peer echo")?);
    }
    Ok(echoes)
}

/// `{"1": {"r", "boxPk"}, ...}`: the secret part and the box key of every seat.
fn parts_of(value: Option<&Value>) -> Result<BTreeMap<u16, Part>, String> {
    let json = value.unwrap_or(&Value::Null).to_string();
    let mut parts = BTreeMap::new();
    for (seat, part) in full_seat_map(&json, "secret parts")? {
        let field = |key: &str| unhex_array(text_of(&part, key, "a secret part")?, key);
        parts.insert(
            seat,
            Part {
                r_sol: field("r")?,
                box_pk: field("boxPk")?,
            },
        );
    }
    Ok(parts)
}

/// A verifying key (the group key of a key package or of a public key package), as 32 bytes.
pub fn key_bytes(key: &VerifyingKey) -> Result<[u8; 32], String> {
    key.serialize()
        .map_err(frost_err("group key"))?
        .try_into()
        .map_err(|_| "the group key is not 32 bytes".to_string())
}

/// Round 3: `{"key_package", "public_key_package", "group_key", "sol_seed"}`.
///
/// `round1` holds the round-1 documents of every seat, the same text that `echo` takes, and the
/// frost round 3 reads the packages of the other seats from it, so the echo and part 3 see the
/// same data. `round2` holds the round-2 packages that the other seats addressed to this seat.
/// `ctx` is the context of `Ceremony::parse`. The echo, the roster and the commitments are
/// checked before part 3 runs.
pub fn dkg3(secret2: &str, round1: &str, round2: &str, ctx: &str) -> Result<String, String> {
    let ceremony = Ceremony::parse(ctx)?;
    let docs = parse_docs(round1)?;
    ceremony.check_roster(&docs)?;
    let echo = ceremony.checked_echo(&docs)?;
    ceremony.check_commitments(&docs)?;
    let secret2: dkg::round2::SecretPackage = from_json(secret2, "round-2 secret")?;
    let mut others = BTreeMap::new();
    for (seat, doc) in docs.into_iter().filter(|(seat, _)| *seat != ceremony.seat) {
        others.insert(ident(seat)?, doc.package);
    }
    let round2 = id_map::<dkg::round2::Package>(round2, "round-2 packages")?;
    let (key_package, public_package) =
        dkg::part3(&secret2, &others, &round2).map_err(frost_err("dkg part3"))?;
    Ok(json!({
        "key_package": to_value(&key_package, "key package")?,
        "public_key_package": to_value(&public_package, "public key package")?,
        "group_key": hex(&key_bytes(public_package.verifying_key())?),
        "sol_seed": hex(&ceremony.sol_seed(&echo)?),
    })
    .to_string())
}

/// True when the signing share of a key package, times the base point, is its verifying share.
/// frost reads the share as a canonical scalar (below the group order L) and refuses the identity
/// as a verifying share, so a share that is zero, L or more, or damaged gives false, and so does
/// any text that is not a key package. The point arithmetic is constant time (curve25519-dalek).
/// ponytail: serde_json reads the JSON text into a value before frost decodes the share, and that
/// read is not constant time. The text is a value that this browser holds already.
pub fn share_fits(key_package: &str) -> bool {
    from_json::<KeyPackage>(key_package, "key package")
        .is_ok_and(|kp| VerifyingShare::from(*kp.signing_share()) == *kp.verifying_share())
}
