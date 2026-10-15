//! The second DKG (ZOLANA.md 4.1): frost parts 1 to 3, the commitment, the echo and `solSeed`.
//! Also RFC 9591 appendix E.1 through the crate, ported from the P1 tests.
//! Nothing here prints a secret: values are compared with `assert!(a == b)`.

#[path = "support/ceremony.rs"]
mod ceremony;

use blake2b_simd::Params;
use ceremony::*;
use curve25519_dalek::constants::ED25519_BASEPOINT_POINT;
use curve25519_dalek::edwards::{CompressedEdwardsY, EdwardsPoint};
use curve25519_dalek::scalar::Scalar;
use curve25519_dalek::traits::Identity;
use frost_ed25519::Ed25519Sha512;
use p3_check::frost;
use serde_json::{json, Value};

fn blake(personal: &[u8; 16], parts: &[&[u8]]) -> String {
    let mut state = Params::new().hash_length(32).personal(personal).to_state();
    parts.iter().for_each(|p| {
        state.update(p);
    });
    hex::encode(state.finalize().as_bytes())
}

fn lp_bytes(bytes: &[u8]) -> Vec<u8> {
    [&(bytes.len() as u32).to_le_bytes()[..], bytes].concat()
}

fn lp(text: &str) -> Vec<u8> {
    lp_bytes(text.as_bytes())
}

// ---- a whole ceremony ------------------------------------------------------------------------

#[test]
fn a_2_of_3_dkg_gives_every_seat_one_group_key_and_one_sol_seed() {
    let group = run(WALLET, 2, 3);
    let first = &group.done[0];
    for done in &group.done {
        assert!(done.group_key == first.group_key, "one group key");
        assert!(done.sol_seed == first.sol_seed, "one solSeed");
        assert!(json_of(&done.public_key_package) == json_of(&first.public_key_package));
    }
    let keys: Vec<&String> = group.done.iter().map(|d| &d.key_package).collect();
    assert!(
        keys[0] != keys[1] && keys[1] != keys[2],
        "each seat has its own share"
    );
    assert_eq!(first.group_key.len(), 64);
    assert_eq!(first.sol_seed.len(), 64);
}

#[test]
fn the_group_key_is_an_ed25519_point_of_the_prime_order_group() {
    let group = run(WALLET, 2, 3);
    let bytes = unhex32(&group.done[0].group_key);
    let point = CompressedEdwardsY(bytes).decompress().expect("a point");
    assert!(point.is_torsion_free() && point != EdwardsPoint::identity());
}

#[test]
fn a_3_of_5_and_a_7_of_7_dkg_agree_too() {
    for (t, n) in [(3, 5), (7, 7)] {
        let group = run(WALLET, t, n);
        let first = &group.done[0];
        assert!(group
            .done
            .iter()
            .all(|d| d.group_key == first.group_key && d.sol_seed == first.sol_seed));
    }
}

#[test]
fn two_ceremonies_give_two_groups_and_two_seeds() {
    let (a, b) = (run(WALLET, 2, 3), run(WALLET, 2, 3));
    assert!(a.done[0].group_key != b.done[0].group_key);
    assert!(a.done[0].sol_seed != b.done[0].sol_seed);
}

// ---- the three hashes ------------------------------------------------------------------------

#[test]
fn the_commitment_is_blake2b_with_the_personalization_over_the_named_fields() {
    let (box_pk, r_sol) = (random_hex(32), random_hex(32));
    let got = frost::commit(WALLET, 3, &box_pk, CLUSTER, &r_sol).unwrap();
    let data = [
        lp(WALLET),
        3u16.to_le_bytes().to_vec(),
        hex::decode(&box_pk).unwrap(),
        lp(CLUSTER),
        hex::decode(&r_sol).unwrap(),
    ]
    .concat();
    assert!(got == blake(b"Zigs_SolCmt___v1", &[&data]));
}

#[test]
fn the_commitment_changes_with_every_field() {
    let (box_pk, r_sol) = (random_hex(32), random_hex(32));
    let base = frost::commit(WALLET, 1, &box_pk, CLUSTER, &r_sol).unwrap();
    let other = [
        frost::commit("wallet-0002", 1, &box_pk, CLUSTER, &r_sol).unwrap(),
        frost::commit(WALLET, 2, &box_pk, CLUSTER, &r_sol).unwrap(),
        frost::commit(WALLET, 1, &random_hex(32), CLUSTER, &r_sol).unwrap(),
        frost::commit(WALLET, 1, &box_pk, CLUSTER, &random_hex(32)).unwrap(),
    ];
    assert!(other.iter().all(|c| *c != base));
}

#[test]
fn the_commitment_refuses_bad_input() {
    let ok = random_hex(32);
    assert!(
        frost::commit(WALLET, 0, &ok, CLUSTER, &ok).is_err(),
        "seat 0"
    );
    assert!(
        frost::commit(WALLET, 1, &ok, "mainnet", &ok).is_err(),
        "cluster"
    );
    assert!(
        frost::commit(WALLET, 1, &random_hex(31), CLUSTER, &ok).is_err(),
        "box key"
    );
    assert!(
        frost::commit(WALLET, 1, &ok, CLUSTER, "zz").is_err(),
        "not hex"
    );
    assert!(
        frost::commit(WALLET, 1, &ok, CLUSTER, &random_hex(33)).is_err(),
        "rSol length"
    );
}

#[test]
fn the_echo_binds_the_wallet_the_safety_number_the_cluster_and_every_package() {
    let seats = start(WALLET, 2, 3);
    let docs = round1_docs(&seats).to_string();
    let base = frost::echo(WALLET, SAFETY, CLUSTER, &docs).unwrap();
    assert!(
        base == frost::echo(WALLET, SAFETY, CLUSTER, &docs).unwrap(),
        "deterministic"
    );
    assert!(base != frost::echo("wallet-0002", SAFETY, CLUSTER, &docs).unwrap());
    assert!(base != frost::echo(WALLET, "00000 00000", CLUSTER, &docs).unwrap());
    let mut other_commit = round1_docs(&seats);
    other_commit["2"]["commit"] = Value::from(random_hex(32));
    assert!(base != frost::echo(WALLET, SAFETY, CLUSTER, &other_commit.to_string()).unwrap());
    let mut other_package = round1_docs(&seats);
    other_package["3"]["package"] = start(WALLET, 2, 3)[2].package.clone();
    assert!(base != frost::echo(WALLET, SAFETY, CLUSTER, &other_package.to_string()).unwrap());
    assert!(frost::echo(WALLET, SAFETY, "mainnet", &docs).is_err());
}

#[test]
fn the_echo_is_blake2b_over_the_wallet_the_safety_number_the_cluster_and_each_package() {
    let seats = start(WALLET, 2, 3);
    let mut data = [lp(WALLET), lp(SAFETY), lp(CLUSTER)].concat();
    for seat in &seats {
        let package: frost_ed25519::keys::dkg::round1::Package =
            serde_json::from_value(seat.package.clone()).unwrap();
        data.extend(seat.id.to_le_bytes());
        data.extend(lp_bytes(&package.serialize().unwrap()));
        data.extend(hex::decode(&seat.commit).unwrap());
    }
    assert!(echo_of(WALLET, &seats) == blake(b"Zigs_SolEcho__v1", &[&data]));
}

#[test]
fn a_seat_written_twice_under_two_spellings_is_refused() {
    let seats = start(WALLET, 2, 3);
    let mut docs = round1_docs(&seats);
    let again = docs["1"].clone();
    docs.as_object_mut().unwrap().insert("01".into(), again);
    let why = frost::echo(WALLET, SAFETY, CLUSTER, &docs.to_string()).unwrap_err();
    assert!(why.contains("twice"), "{why}");
}

#[test]
fn the_echo_does_not_depend_on_the_order_of_the_json_keys() {
    let seats = start(WALLET, 2, 3);
    let docs = round1_docs(&seats);
    let reversed: serde_json::Map<String, Value> = ["3", "2", "1"]
        .iter()
        .map(|k| (k.to_string(), docs[*k].clone()))
        .collect();
    let a = frost::echo(WALLET, SAFETY, CLUSTER, &docs.to_string()).unwrap();
    let b = frost::echo(
        WALLET,
        SAFETY,
        CLUSTER,
        &Value::Object(reversed).to_string(),
    )
    .unwrap();
    assert!(a == b);
}

#[test]
fn the_echo_needs_the_seats_1_to_n() {
    let seats = start(WALLET, 2, 3);
    let mut docs = round1_docs(&seats);
    docs.as_object_mut().unwrap().remove("2");
    assert!(frost::echo(WALLET, SAFETY, CLUSTER, &docs.to_string()).is_err());
    let one = json!({"1": round1_docs(&seats)["1"].clone()});
    assert!(frost::echo(WALLET, SAFETY, CLUSTER, &one.to_string()).is_err());
}

#[test]
fn sol_seed_is_blake2b_over_the_wallet_the_echo_and_the_parts_in_seat_order() {
    let seats = start(WALLET, 2, 3);
    let echo = echo_of(WALLET, &seats);
    let (secrets, inbox) = round2(&seats);
    let ctx = context(WALLET, &seats, &echo);
    let done = finish_seat(1, &seats, &secrets[&1], &inbox[&1], &ctx).unwrap();
    let mut data = lp(WALLET);
    data.extend(hex::decode(&echo).unwrap());
    seats
        .iter()
        .for_each(|s| data.extend(hex::decode(&s.r_sol).unwrap()));
    assert!(done.sol_seed == blake(b"Zigs_SolSeed__v1", &[&data]));
}

// ---- what the page can do wrong --------------------------------------------------------------

#[test]
fn one_changed_r_sol_names_the_seat() {
    let seats = start(WALLET, 2, 3);
    let echo = echo_of(WALLET, &seats);
    let (secrets, inbox) = round2(&seats);
    let mut ctx = context(WALLET, &seats, &echo);
    ctx["parts"]["2"]["r"] = Value::from(random_hex(32));
    let why = finish_seat(1, &seats, &secrets[&1], &inbox[&1], &ctx)
        .err()
        .expect("refused");
    assert!(why.starts_with("seat 2:"), "{why}");
}

/// The round-1 documents with another commitment for seat `seat`, and the echo of those documents,
/// which every seat of the test saw: only the check of the commitments can find the change.
fn docs_with_another_commitment(seats: &[Seat], seat: &str) -> (Value, String) {
    let mut docs = round1_docs(seats);
    docs[seat]["commit"] = Value::from(random_hex(32));
    let echo = frost::echo(WALLET, SAFETY, CLUSTER, &docs.to_string()).unwrap();
    (docs, echo)
}

#[test]
fn one_changed_commitment_names_the_seat() {
    let seats = start(WALLET, 2, 3);
    let (secrets, inbox) = round2(&seats);
    let (docs, echo) = docs_with_another_commitment(&seats, "3");
    let ctx = context(WALLET, &seats, &echo);
    let why = finish_with(1, &docs, &secrets[&1], &inbox[&1], &ctx)
        .err()
        .expect("refused");
    assert!(why.starts_with("seat 3:"), "{why}");
}

#[test]
fn a_changed_box_key_or_wallet_id_or_cluster_breaks_the_commitment() {
    let seats = start(WALLET, 2, 3);
    let echo = echo_of(WALLET, &seats);
    let (secrets, inbox) = round2(&seats);
    let mut by_box = context(WALLET, &seats, &echo);
    by_box["parts"]["2"]["boxPk"] = Value::from(random_hex(32));
    let why = finish_seat(1, &seats, &secrets[&1], &inbox[&1], &by_box)
        .err()
        .expect("refused");
    assert!(why.starts_with("seat 2:"), "{why}");
    // The echo is the one of the other wallet, so only the commitments differ.
    let other_echo = frost::echo(
        "wallet-0002",
        SAFETY,
        CLUSTER,
        &round1_docs(&seats).to_string(),
    )
    .unwrap();
    let by_wallet = context("wallet-0002", &seats, &other_echo);
    let why = finish_seat(1, &seats, &secrets[&1], &inbox[&1], &by_wallet)
        .err()
        .expect("refused");
    assert!(why.starts_with("seat 1:"), "the first seat in order: {why}");
}

#[test]
fn the_first_bad_seat_in_order_is_named_when_two_are_bad() {
    let seats = start(WALLET, 2, 3);
    let echo = echo_of(WALLET, &seats);
    let (secrets, inbox) = round2(&seats);
    let mut ctx = context(WALLET, &seats, &echo);
    ctx["parts"]["3"]["r"] = Value::from(random_hex(32));
    ctx["parts"]["2"]["r"] = Value::from(random_hex(32));
    let why = finish_seat(1, &seats, &secrets[&1], &inbox[&1], &ctx)
        .err()
        .expect("refused");
    assert!(why.starts_with("seat 2:"), "{why}");
}

#[test]
fn the_commitments_are_checked_before_round_3_runs() {
    // The round-2 packages are wrong as well, so frost would also fail. The answer names the
    // seat of the bad commitment, which only the check before part 3 can do.
    let seats = start(WALLET, 2, 3);
    let (secrets, inbox) = round2(&seats);
    let (docs, echo) = docs_with_another_commitment(&seats, "2");
    let ctx = context(WALLET, &seats, &echo);
    let wrong_inbox = inbox[&2].clone();
    let why = finish_with(1, &docs, &secrets[&1], &wrong_inbox, &ctx)
        .err()
        .expect("refused");
    assert!(why.starts_with("seat 2:"), "{why}");
}

#[test]
fn a_seat_whose_saved_echo_differs_from_the_documents_ends() {
    let seats = start(WALLET, 2, 3);
    let (secrets, inbox) = round2(&seats);
    // The saved echo and the peers' echoes are one value, the echo of other data.
    let ctx = context(WALLET, &seats, &random_hex(32));
    let why = finish_seat(1, &seats, &secrets[&1], &inbox[&1], &ctx)
        .err()
        .expect("refused");
    assert!(why.contains("different setup data"), "{why}");
    assert!(why.contains("this seat"), "{why}");
}

#[test]
fn a_peer_that_signed_another_echo_ends_the_seat_and_is_named() {
    let seats = start(WALLET, 2, 3);
    let echo = echo_of(WALLET, &seats);
    let (secrets, inbox) = round2(&seats);
    let mut ctx = context(WALLET, &seats, &echo);
    ctx["peerEchoes"] = json!({"2": random_hex(32), "3": echo});
    let why = finish_seat(1, &seats, &secrets[&1], &inbox[&1], &ctx)
        .err()
        .expect("refused");
    assert!(why.contains("different setup data"), "{why}");
    assert!(why.contains("seat 2"), "{why}");
    ctx["peerEchoes"] = json!({"2": echo, "3": random_hex(32)});
    let why = finish_seat(1, &seats, &secrets[&1], &inbox[&1], &ctx)
        .err()
        .expect("refused");
    assert!(why.contains("seat 3"), "{why}");
}

#[test]
fn round_1_documents_that_changed_after_the_echo_was_saved_end_the_seat() {
    let seats = start(WALLET, 2, 3);
    let echo = echo_of(WALLET, &seats);
    let (secrets, inbox) = round2(&seats);
    let ctx = context(WALLET, &seats, &echo);
    let (changed, _) = docs_with_another_commitment(&seats, "2");
    let why = finish_with(1, &changed, &secrets[&1], &inbox[&1], &ctx)
        .err()
        .expect("refused");
    assert!(why.contains("different setup data"), "{why}");
}

#[test]
fn a_changed_safety_number_or_cluster_text_gives_another_echo_and_ends_the_seat() {
    let seats = start(WALLET, 2, 3);
    let echo = echo_of(WALLET, &seats);
    let (secrets, inbox) = round2(&seats);
    let mut ctx = context(WALLET, &seats, &echo);
    ctx["safety"] = Value::from("00000 00000 00000");
    let why = finish_seat(1, &seats, &secrets[&1], &inbox[&1], &ctx)
        .err()
        .expect("refused");
    assert!(why.contains("different setup data"), "{why}");
}

#[test]
fn the_peer_echoes_must_be_those_of_the_other_seats() {
    let seats = start(WALLET, 2, 3);
    let echo = echo_of(WALLET, &seats);
    let (secrets, inbox) = round2(&seats);
    let mut ctx = context(WALLET, &seats, &echo);
    for peers in [
        json!({"2": echo}),
        json!({"1": echo, "2": echo, "3": echo}),
        json!({"2": echo, "4": echo}),
        json!({"2": echo, "3": "abcd"}),
        json!({"2": echo, "3": 7}),
    ] {
        ctx["peerEchoes"] = peers.clone();
        let result = finish_seat(1, &seats, &secrets[&1], &inbox[&1], &ctx);
        assert!(result.is_err(), "peer echoes {peers}");
    }
    ctx["peerEchoes"] = Value::Null;
    assert!(finish_seat(1, &seats, &secrets[&1], &inbox[&1], &ctx).is_err());
    ctx.as_object_mut().unwrap().remove("peerEchoes");
    assert!(finish_seat(1, &seats, &secrets[&1], &inbox[&1], &ctx).is_ok());
}

#[test]
fn the_seed_binds_the_echo_of_the_documents_for_every_seat() {
    let seats = start(WALLET, 2, 3);
    let echo = echo_of(WALLET, &seats);
    let (secrets, inbox) = round2(&seats);
    let ctx = context(WALLET, &seats, &echo);
    let done: Vec<Done> = [1, 2, 3]
        .iter()
        .map(|id| finish_seat(*id, &seats, &secrets[id], &inbox[id], &ctx).unwrap())
        .collect();
    assert!(
        done.iter().all(|d| d.sol_seed == done[0].sol_seed),
        "one solSeed"
    );
    let mut data = lp(WALLET);
    data.extend(hex::decode(&echo).unwrap());
    seats
        .iter()
        .for_each(|s| data.extend(hex::decode(&s.r_sol).unwrap()));
    assert!(done[2].sol_seed == blake(b"Zigs_SolSeed__v1", &[&data]));
}

#[test]
fn part_3_reads_the_packages_of_the_other_seats_from_the_documents() {
    // Seat 2 published another package, and every seat of the test saw it, so the echo agrees.
    // Only the share check of frost can find it, and it must read the package of the document.
    let seats = start(WALLET, 2, 3);
    let (secrets, inbox) = round2(&seats);
    let mut docs = round1_docs(&seats);
    docs["2"]["package"] = start(WALLET, 2, 3)[1].package.clone();
    let echo = frost::echo(WALLET, SAFETY, CLUSTER, &docs.to_string()).unwrap();
    let ctx = context(WALLET, &seats, &echo);
    let why = finish_with(1, &docs, &secrets[&1], &inbox[&1], &ctx)
        .err()
        .expect("refused");
    assert!(why.contains("dkg part3"), "{why}");
}

#[test]
fn a_seat_number_that_is_not_the_seat_of_the_secret_is_refused() {
    let seats = start(WALLET, 2, 3);
    let echo = echo_of(WALLET, &seats);
    let (secrets, inbox) = round2(&seats);
    let ctx = context(WALLET, &seats, &echo);
    assert!(finish_seat(2, &seats, &secrets[&1], &inbox[&1], &ctx).is_err());
    let mut four = ctx.clone();
    four["seat"] = Value::from(4);
    four["peerEchoes"] = json!({"1": echo, "2": echo, "3": echo});
    let docs = round1_docs(&seats).to_string();
    let why = frost::dkg3(
        &secrets[&1],
        &docs,
        &inbox[&1].to_string(),
        &four.to_string(),
    );
    assert!(why.unwrap_err().contains("not a seat of round 1"));
}

#[test]
fn a_round_3_context_for_other_seats_than_round_1_is_refused() {
    let seats = start(WALLET, 2, 3);
    let echo = echo_of(WALLET, &seats);
    let (secrets, inbox) = round2(&seats);
    let mut ctx = context(WALLET, &seats, &echo);
    // A seat 4 with a valid part: only the roster of round 1 can refuse it.
    let extra = json!({"r": random_hex(32), "boxPk": random_hex(32)});
    ctx["parts"]
        .as_object_mut()
        .unwrap()
        .insert("4".into(), extra);
    let why = finish_seat(1, &seats, &secrets[&1], &inbox[&1], &ctx)
        .err()
        .expect("refused");
    assert!(why.contains("seats of round 1"), "{why}");
    let mut short = context(WALLET, &seats, &echo);
    short["parts"].as_object_mut().unwrap().remove("3");
    assert!(finish_seat(1, &seats, &secrets[&1], &inbox[&1], &short).is_err());
}

#[test]
fn round_3_refuses_a_mainnet_context_and_a_bad_echo() {
    let seats = start(WALLET, 2, 3);
    let echo = echo_of(WALLET, &seats);
    let (secrets, inbox) = round2(&seats);
    let mut ctx = context(WALLET, &seats, &echo);
    ctx["cluster"] = Value::from("mainnet");
    assert!(finish_seat(1, &seats, &secrets[&1], &inbox[&1], &ctx).is_err());
    let mut short_echo = context(WALLET, &seats, &echo);
    short_echo["echo"] = Value::from("abcd");
    assert!(finish_seat(1, &seats, &secrets[&1], &inbox[&1], &short_echo).is_err());
}

#[test]
fn round_3_of_a_seat_fails_with_a_round_2_package_that_was_not_addressed_to_it() {
    let seats = start(WALLET, 2, 3);
    let echo = echo_of(WALLET, &seats);
    let (secrets, inbox) = round2(&seats);
    let ctx = context(WALLET, &seats, &echo);
    assert!(finish_seat(1, &seats, &secrets[&1], &inbox[&3], &ctx).is_err());
}

// ---- a key written twice ---------------------------------------------------------------------

/// `text` with one more entry `extra` after the first `opening`, which ends with the start of an
/// object. The new entry has the same key as an entry that follows. The honest entry comes last:
/// a reader that keeps the later of two equal keys would not notice.
fn with_extra(text: &str, opening: &str, extra: &str) -> String {
    assert!(text.contains(opening), "{opening}");
    text.replacen(opening, &format!("{opening}{extra},"), 1)
}

fn refused_as_twice<T>(result: Result<T, String>, what: &str) {
    let why = result.err().unwrap_or_else(|| panic!("{what}: accepted"));
    assert!(why.contains("twice"), "{what}: {why}");
}

#[test]
fn a_key_written_twice_is_refused_at_every_depth() {
    let seats = start(WALLET, 2, 3);
    let echo = echo_of(WALLET, &seats);
    let honest = round1_docs(&seats).to_string();
    assert!(
        frost::echo(WALLET, SAFETY, CLUSTER, &honest).is_ok(),
        "the control"
    );
    // A seat key at the top level, and a field of a document below it.
    let top = with_extra(&honest, "{", "\"1\":{}");
    refused_as_twice(
        frost::echo(WALLET, SAFETY, CLUSTER, &top),
        "seat key in the echo",
    );
    let nested = with_extra(&honest, "\"1\":{", "\"commit\":\"00\"");
    refused_as_twice(
        frost::echo(WALLET, SAFETY, CLUSTER, &nested),
        "field of a document",
    );
    // The parts below the context, and the round-2 packages, in round 3.
    let (secrets, inbox) = round2(&seats);
    let mut ctx = context(WALLET, &seats, &echo);
    ctx["seat"] = Value::from(1);
    ctx["peerEchoes"] = json!({"2": echo, "3": echo});
    let (ctx, others) = (ctx.to_string(), inbox[&1].to_string());
    assert!(
        frost::dkg3(&secrets[&1], &honest, &others, &ctx).is_ok(),
        "the control"
    );
    let parts = with_extra(&ctx, "\"parts\":{", "\"1\":{}");
    refused_as_twice(
        frost::dkg3(&secrets[&1], &honest, &others, &parts),
        "parts of round 3",
    );
    let packages = with_extra(&others, "{", "\"2\":{}");
    refused_as_twice(
        frost::dkg3(&secrets[&1], &honest, &packages, &ctx),
        "round-2 packages",
    );
}

// ---- the share check -------------------------------------------------------------------------

/// The order L of the base point, as 32 little-endian bytes.
const L_LE: [u8; 32] = [
    0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10,
];

/// `a + b` for 32-byte little-endian integers below 2^255.
fn add_le(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let (mut out, mut carry) = ([0u8; 32], 0u16);
    for at in 0..32 {
        let sum = u16::from(a[at]) + u16::from(b[at]) + carry;
        out[at] = (sum & 0xff) as u8;
        carry = sum >> 8;
    }
    out
}

/// `a - 1` for a non-zero 32-byte little-endian integer.
fn minus_one(a: &[u8; 32]) -> [u8; 32] {
    let mut out = *a;
    for byte in out.iter_mut() {
        let (value, borrow) = byte.overflowing_sub(1);
        *byte = value;
        if !borrow {
            break;
        }
    }
    out
}

/// The key package `kp` (JSON) with other values for some fields.
fn with_fields(kp: &str, fields: &[(&str, String)]) -> String {
    let mut value = json_of(kp);
    for (key, text) in fields {
        value[*key] = Value::from(text.clone());
    }
    value.to_string()
}

fn field(kp: &str, key: &str) -> String {
    json_of(kp)[key].as_str().expect("text").to_string()
}

const BASE_POINT: &str = "5866666666666666666666666666666666666666666666666666666666666666";
const MINUS_BASE_POINT: &str = "58666666666666666666666666666666666666666666666666666666666666e6";

fn one_le() -> [u8; 32] {
    let mut one = [0u8; 32];
    one[0] = 1;
    one
}

#[test]
fn an_honest_key_share_fits_its_public_share() {
    // The sign of the x coordinate of the public share is a coin: many runs have both.
    for _ in 0..12 {
        let group = run(WALLET, 2, 3);
        for done in &group.done {
            assert!(frost::share_fits(&done.key_package));
        }
    }
    // The shares with a known point: 1 gives the base point, L - 1 gives its negative.
    let kp = run(WALLET, 2, 3).done.remove(0).key_package;
    let at = |share: &[u8; 32], point: &str| {
        let fields = [
            ("signing_share", hex::encode(share)),
            ("verifying_share", point.into()),
        ];
        frost::share_fits(&with_fields(&kp, &fields))
    };
    assert!(at(&one_le(), BASE_POINT), "one times the base point");
    assert!(
        at(&minus_one(&L_LE), MINUS_BASE_POINT),
        "L minus one is minus the base point"
    );
    assert!(
        !at(&one_le(), MINUS_BASE_POINT),
        "one is not minus the base point"
    );
}

#[test]
fn a_damaged_or_foreign_key_share_does_not_fit() {
    let group = run(WALLET, 2, 3);
    let (kp, other) = (&group.done[0].key_package, &group.done[1].key_package);
    let share = field(kp, "signing_share");
    for at in 0..share.len() {
        let mut damaged = share.clone().into_bytes();
        damaged[at] = if damaged[at] == b'a' { b'b' } else { b'a' };
        let text = String::from_utf8(damaged).unwrap();
        let fields = [("signing_share", text)];
        assert!(!frost::share_fits(&with_fields(kp, &fields)), "digit {at}");
    }
    let mut foreign = [
        ("signing_share", field(other, "signing_share")),
        ("verifying_share", field(other, "verifying_share")),
    ];
    for (key, text) in foreign.iter_mut() {
        let fields = [(*key, text.clone())];
        assert!(
            !frost::share_fits(&with_fields(kp, &fields)),
            "{key} of seat 2"
        );
    }
    assert!(frost::share_fits(kp), "the control");
}

#[test]
fn a_key_share_at_or_above_the_group_order_does_not_fit() {
    // L + 1 and an honest share plus L are the same scalars as 1 and the share, but not below L.
    let kp = run(WALLET, 2, 3).done.remove(0).key_package;
    let honest: [u8; 32] = hex::decode(field(&kp, "signing_share"))
        .unwrap()
        .try_into()
        .unwrap();
    let at = |share: &[u8; 32], point: &str| {
        let fields = [
            ("signing_share", hex::encode(share)),
            ("verifying_share", point.into()),
        ];
        frost::share_fits(&with_fields(&kp, &fields))
    };
    assert!(at(&honest, &field(&kp, "verifying_share")), "the control");
    assert!(
        !at(&add_le(&honest, &L_LE), &field(&kp, "verifying_share")),
        "share plus L"
    );
    assert!(!at(&add_le(&one_le(), &L_LE), BASE_POINT), "L plus one");
    assert!(!at(&L_LE, BASE_POINT), "L");
    assert!(!at(&[0xff; 32], BASE_POINT), "2^256 - 1");
}

#[test]
fn a_zero_key_share_does_not_fit_even_with_the_identity_as_its_public_share() {
    let kp = run(WALLET, 2, 3).done.remove(0).key_package;
    let identity = format!("01{}", "00".repeat(31));
    for verifying in [identity, field(&kp, "verifying_share")] {
        let fields = [
            ("signing_share", "00".repeat(32)),
            ("verifying_share", verifying),
        ];
        assert!(!frost::share_fits(&with_fields(&kp, &fields)));
    }
}

#[test]
fn text_that_is_not_a_key_package_does_not_fit() {
    for text in [
        "",
        "{}",
        "null",
        "[]",
        "42",
        "not json",
        "{\"signing_share\":1}",
    ] {
        assert!(!frost::share_fits(text), "{text}");
    }
    let kp = run(WALLET, 2, 3).done.remove(0).key_package;
    let mut missing = json_of(&kp);
    missing.as_object_mut().unwrap().remove("verifying_share");
    assert!(!frost::share_fits(&missing.to_string()));
    let twice = with_extra(&kp, "{", "\"signing_share\":\"00\"");
    assert!(!frost::share_fits(&twice), "a key written twice");
}

// ---- limits ----------------------------------------------------------------------------------

#[test]
fn n_t_and_the_seat_number_have_limits() {
    // Frost refuses some of these too. The text tells which limit of the wallet applies.
    let cases = [
        ((1, 1, 1), "n must"),
        ((1, 8, 2), "n must"),
        ((1, 0, 0), "n must"),
        ((1, 3, 1), "t must"),
        ((1, 3, 4), "t must"),
        ((0, 3, 2), "seat must"),
        ((4, 3, 2), "seat must"),
    ];
    for ((id, n, t), text) in cases {
        let why = frost::dkg1(id, n, t).unwrap_err();
        assert!(why.contains(text), "id {id} n {n} t {t}: {why}");
    }
    for (id, n, t) in [(1, 2, 2), (2, 2, 2), (7, 7, 7), (1, 7, 2), (3, 5, 3)] {
        assert!(frost::dkg1(id, n, t).is_ok(), "id {id} n {n} t {t}");
    }
}

#[test]
fn round_2_refuses_a_missing_or_foreign_round_1_package() {
    let seats = start(WALLET, 2, 3);
    let only_one = json!({"2": seats[1].package}).to_string();
    assert!(
        frost::dkg2(&seats[0].secret1, &only_one).is_err(),
        "seat 3 missing"
    );
    assert!(frost::dkg2(&seats[0].secret1, "{}").is_err());
    assert!(frost::dkg2("{}", &others_of(&seats, 1)).is_err());
    assert!(frost::dkg2(&seats[0].secret1, &others_of(&seats, 1)).is_ok());
}

// ---- RFC 9591 appendix E.1 through the crate --------------------------------------------------

const E1: &str = include_str!("data/rfc9591_e1.json");
const CRATE_VECTORS: &str = include_str!("data/frost_ed25519_2_2_0_vectors.json");

fn load(text: &str) -> Value {
    serde_json::from_str(text).expect("json")
}

fn bytes32(value: &Value) -> [u8; 32] {
    hex::decode(value.as_str().expect("string"))
        .unwrap()
        .try_into()
        .expect("32 bytes")
}

fn point(value: &Value) -> EdwardsPoint {
    CompressedEdwardsY(bytes32(value))
        .decompress()
        .expect("point")
}

fn scalar(value: &Value) -> Scalar {
    Option::from(Scalar::from_canonical_bytes(bytes32(value))).expect("canonical scalar")
}

#[test]
fn rfc9591_e1_matches_through_the_crate_harness() {
    frost_core::tests::vectors::check_sign_with_test_vectors::<Ed25519Sha512>(&load(E1));
}

#[test]
fn the_crate_vectors_pass_the_same_harness() {
    frost_core::tests::vectors::check_sign_with_test_vectors::<Ed25519Sha512>(&load(CRATE_VECTORS));
}

#[test]
fn rfc9591_e1_group_key_group_commitment_and_final_signature() {
    let v = load(E1);
    let secret = scalar(&v["inputs"]["group_secret_key"]);
    let group_key = point(&v["inputs"]["verifying_key_key"]);
    assert!(
        secret * ED25519_BASEPOINT_POINT == group_key,
        "group secret key to group key"
    );
    let sig = hex::decode(v["final_output"]["sig"].as_str().unwrap()).unwrap();
    let mut group_commitment = EdwardsPoint::identity();
    let mut z = Scalar::ZERO;
    let shares = v["round_two_outputs"]["outputs"].as_array().unwrap();
    for (one, share) in v["round_one_outputs"]["outputs"]
        .as_array()
        .unwrap()
        .iter()
        .zip(shares)
    {
        let rho = scalar(&one["binding_factor"]);
        let hiding = point(&one["hiding_nonce_commitment"]);
        let binding = point(&one["binding_nonce_commitment"]);
        group_commitment += hiding + rho * binding;
        z += scalar(&share["sig_share"]);
    }
    assert!(
        group_commitment.compress().as_bytes()[..] == sig[..32],
        "group commitment is R"
    );
    assert!(
        z.as_bytes()[..] == sig[32..],
        "sum of signature shares is S"
    );
}

fn harness_rejects(v: &Value) -> bool {
    let run = || frost_core::tests::vectors::check_sign_with_test_vectors::<Ed25519Sha512>(v);
    std::panic::catch_unwind(run).is_err()
}

#[test]
fn the_rfc_harness_is_not_vacuous() {
    let mut changed_sig = load(E1);
    let sig = changed_sig["final_output"]["sig"]
        .as_str()
        .unwrap()
        .replacen("3628", "3629", 1);
    changed_sig["final_output"]["sig"] = Value::from(sig);
    assert!(harness_rejects(&changed_sig), "changed signature accepted");
    let mut foreign = load(E1);
    let theirs = load(CRATE_VECTORS);
    foreign["round_one_outputs"]["outputs"][0]["hiding_nonce_randomness"] =
        theirs["round_one_outputs"]["outputs"][0]["hiding_nonce_randomness"].clone();
    assert!(
        harness_rejects(&foreign),
        "foreign nonce randomness accepted"
    );
}
