//! A whole second DKG and split signing in one process, through the same functions that the wasm
//! entry points call (`frost`, `roles`, `sign`). Shared by `frost_dkg.rs` and `sign_split.rs`.
//! Every stage is a function, so a test can change what one seat sees between two stages.
//! Nothing here prints a secret.
#![allow(dead_code)]

use std::collections::BTreeMap;

use p3_check::intent::Intent;
use p3_check::plan::{Plan, Proposal};
use p3_check::sign::Check;
use p3_check::snapshot::Snapshot;
use p3_check::{frost, roles, sign, wasm};
use rand_core::{OsRng, RngCore};
use serde_json::{json, Value};

pub const CLUSTER: &str = "devnet";
pub const WALLET: &str = "wallet-0001";
pub const SAFETY: &str = "12345 67890 12345 67890 12345 67890";
/// The clock of the approving device: one hour before the usual expiry of the vectors.
pub const NOW: u64 = 1_800_000_000 - 3_600;

pub fn random_hex(len: usize) -> String {
    let mut bytes = vec![0u8; len];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn json_of(text: &str) -> Value {
    serde_json::from_str(text).expect("json")
}

/// One seat after round 1: its secret part, its box key, its commitment and its round-1 output.
pub struct Seat {
    pub id: u16,
    pub r_sol: String,
    pub box_pk: String,
    pub commit: String,
    pub secret1: String,
    pub package: Value,
}

/// Round 1 and the commitment of every seat of a `t`-of-`n` wallet.
pub fn start(wallet: &str, t: u16, n: u16) -> Vec<Seat> {
    (1..=n)
        .map(|id| {
            let (r_sol, box_pk) = (random_hex(32), random_hex(32));
            let commit = frost::commit(wallet, id, &box_pk, CLUSTER, &r_sol).expect("commit");
            let round1 = json_of(&frost::dkg1(id, n, t).expect("round 1"));
            Seat {
                id,
                r_sol,
                box_pk,
                commit,
                secret1: round1["secret"].to_string(),
                package: round1["package"].clone(),
            }
        })
        .collect()
}

/// `{"1": {"package", "commit"}, ...}`: what every seat publishes in round 1.
pub fn round1_docs(seats: &[Seat]) -> Value {
    let docs: serde_json::Map<String, Value> = seats
        .iter()
        .map(|s| {
            (
                s.id.to_string(),
                json!({"package": s.package, "commit": s.commit}),
            )
        })
        .collect();
    Value::Object(docs)
}

pub fn echo_of(wallet: &str, seats: &[Seat]) -> String {
    frost::echo(wallet, SAFETY, CLUSTER, &round1_docs(seats).to_string()).expect("echo")
}

/// The round-1 packages of every seat but `me`, as seat `me` reads them.
pub fn others_of(seats: &[Seat], me: u16) -> String {
    let others: serde_json::Map<String, Value> = seats
        .iter()
        .filter(|s| s.id != me)
        .map(|s| (s.id.to_string(), s.package.clone()))
        .collect();
    Value::Object(others).to_string()
}

/// Round 2 of every seat. Returns the round-2 secret of each seat and the inbox of each seat:
/// the packages that the other seats addressed to it.
pub fn round2(seats: &[Seat]) -> (BTreeMap<u16, String>, BTreeMap<u16, Value>) {
    let mut secrets = BTreeMap::new();
    let mut inbox: BTreeMap<u16, serde_json::Map<String, Value>> = BTreeMap::new();
    for seat in seats {
        let out =
            json_of(&frost::dkg2(&seat.secret1, &others_of(seats, seat.id)).expect("round 2"));
        secrets.insert(seat.id, out["secret"].to_string());
        for (to, package) in out["outgoing"].as_object().expect("outgoing") {
            let to: u16 = to.parse().expect("seat");
            inbox
                .entry(to)
                .or_default()
                .insert(seat.id.to_string(), package.clone());
        }
    }
    (
        secrets,
        inbox
            .into_iter()
            .map(|(k, v)| (k, Value::Object(v)))
            .collect(),
    )
}

/// The context of round 3 for all seats, with the echo that the seat computed. `finish_with` adds
/// the seat number and, unless the test sets `peerEchoes`, the same echo for every other seat.
pub fn context(wallet: &str, seats: &[Seat], echo: &str) -> Value {
    let parts: serde_json::Map<String, Value> = seats
        .iter()
        .map(|s| {
            let part = json!({"r": s.r_sol, "boxPk": s.box_pk});
            (s.id.to_string(), part)
        })
        .collect();
    json!({
        "walletId": wallet,
        "safety": SAFETY,
        "cluster": CLUSTER,
        "echo": echo,
        "parts": parts,
    })
}

/// What one seat holds after round 3.
pub struct Done {
    pub key_package: String,
    pub public_key_package: String,
    pub group_key: String,
    pub sol_seed: String,
}

/// Round 3 of one seat over the honest round-1 documents.
pub fn finish_seat(
    seat: u16,
    seats: &[Seat],
    secret2: &str,
    inbox: &Value,
    ctx: &Value,
) -> Result<Done, String> {
    finish_with(seat, &round1_docs(seats), secret2, inbox, ctx)
}

/// Round 3 of one seat over the round-1 documents `docs`, which a test may have changed.
pub fn finish_with(
    seat: u16,
    docs: &Value,
    secret2: &str,
    inbox: &Value,
    ctx: &Value,
) -> Result<Done, String> {
    let mut ctx = ctx.clone();
    ctx["seat"] = Value::from(seat);
    if ctx.get("peerEchoes").is_none() {
        let others = docs.as_object().expect("documents").keys();
        let peers: serde_json::Map<String, Value> = others
            .filter(|key| key.parse::<u16>() != Ok(seat))
            .map(|key| (key.clone(), ctx["echo"].clone()))
            .collect();
        ctx["peerEchoes"] = Value::Object(peers);
    }
    let out = frost::dkg3(
        secret2,
        &docs.to_string(),
        &inbox.to_string(),
        &ctx.to_string(),
    )?;
    let out = json_of(&out);
    Ok(Done {
        key_package: out["key_package"].to_string(),
        public_key_package: out["public_key_package"].to_string(),
        group_key: out["group_key"].as_str().expect("group key").to_string(),
        sol_seed: out["sol_seed"].as_str().expect("solSeed").to_string(),
    })
}

/// A finished wallet: the seats, and the role values that follow from the seed.
pub struct Group {
    pub seats: Vec<Seat>,
    pub done: Vec<Done>,
    pub pins: Vec<u8>,
    pub snapshot: Vec<u8>,
}

/// The whole ceremony, every seat honest.
pub fn run(wallet: &str, t: u16, n: u16) -> Group {
    let seats = start(wallet, t, n);
    let echo = echo_of(wallet, &seats);
    let (secrets, inbox) = round2(&seats);
    let ctx = context(wallet, &seats, &echo);
    let done: Vec<Done> = seats
        .iter()
        .map(|s| finish_seat(s.id, &seats, &secrets[&s.id], &inbox[&s.id], &ctx).expect("round 3"))
        .collect();
    let derived = roles_of(&done[0]);
    let snapshot = Snapshot {
        nullifier_secret: derived.nullifier_secret,
        viewing_sk: derived.viewing_sk,
        fee_per_nullifier: 0,
        inputs: Vec::new(),
        used_salts: Vec::new(),
    };
    Group {
        pins: derived.pins,
        snapshot: snapshot.encode().expect("snapshot"),
        seats,
        done,
    }
}

pub fn roles_of(done: &Done) -> roles::Roles {
    let seed = unhex32(&done.sol_seed);
    roles::derive(&seed, &unhex32(&done.group_key)).expect("roles")
}

pub fn unhex32(text: &str) -> [u8; 32] {
    p3_check::codec::unhex_array(text, "test value").expect("32 bytes of hex")
}

/// The proposal bytes and the message of a Cancel intent with this nonce, compiled from the
/// template under the pins of the group.
pub fn cancel(group: &Group, nonce: [u8; 32]) -> (Vec<u8>, Vec<u8>) {
    let proposal = Proposal {
        intent: Intent::Cancel { nonce },
        plan: Plan::default(),
    };
    let bytes = proposal.encode().expect("proposal");
    let message = wasm::compile_proposal(&bytes, &group.pins, &[]).expect("compile");
    (bytes, message)
}

pub fn check<'a>(group: &'a Group, proposal: &'a [u8]) -> Check<'a> {
    Check {
        intent: proposal,
        pins: &group.pins,
        snapshot: &group.snapshot,
    }
}

/// The nonces and commitments of the signers for one message: `(nonces by seat, commitments
/// by seat)`, each commitment as hex.
pub fn commit_all(
    group: &Group,
    signers: &[u16],
    message: &[u8],
) -> (BTreeMap<u16, String>, BTreeMap<u16, String>) {
    let digest = sign::digest(CLUSTER, message).expect("digest");
    let (mut nonces, mut commitments) = (BTreeMap::new(), BTreeMap::new());
    for seat in signers {
        let out = sign::nonces(&group.done[usize::from(*seat) - 1].key_package, &digest);
        let out = json_of(&out.expect("nonces"));
        nonces.insert(*seat, out["nonces"].as_str().expect("nonces").to_string());
        commitments.insert(
            *seat,
            out["commitments"]
                .as_str()
                .expect("commitments")
                .to_string(),
        );
    }
    (nonces, commitments)
}

pub fn map_json(items: &BTreeMap<u16, String>) -> String {
    let map: serde_json::Map<String, Value> = items
        .iter()
        .map(|(seat, text)| (seat.to_string(), Value::from(text.clone())))
        .collect();
    Value::Object(map).to_string()
}

/// The `round` argument of `sign_share` for one seat.
pub fn round_of(
    group: &Group,
    seat: u16,
    nonces: &str,
    commitments: &BTreeMap<u16, String>,
) -> String {
    json!({
        "now": NOW,
        "cluster": CLUSTER,
        "keyPackage": json_of(&group.done[usize::from(seat) - 1].key_package),
        "nonces": nonces,
        "commitments": json_of(&map_json(commitments)),
    })
    .to_string()
}

/// One share of one seat: the hex of the share.
pub fn share_of(
    group: &Group,
    seat: u16,
    (message, proposal): (&[u8], &[u8]),
    (nonces, commitments): (&BTreeMap<u16, String>, &BTreeMap<u16, String>),
) -> Result<String, String> {
    let round = round_of(group, seat, &nonces[&seat], commitments);
    let out = sign::sign_share(message, &check(group, proposal), &round)?;
    Ok(json_of(&out)["share"].as_str().expect("share").to_string())
}

/// A whole signing session of `signers` over a message that passes `approve`. Returns the
/// signature as hex.
pub fn session(
    group: &Group,
    signers: &[u16],
    message: &[u8],
    proposal: &[u8],
) -> Result<String, String> {
    let (nonces, commitments) = commit_all(group, signers, message);
    let mut shares = BTreeMap::new();
    for seat in signers {
        let share = share_of(group, *seat, (message, proposal), (&nonces, &commitments))?;
        shares.insert(*seat, share);
    }
    sign::aggregate(
        message,
        &group.done[0].public_key_package,
        &map_json(&commitments),
        &map_json(&shares),
    )
}
