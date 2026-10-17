//! The approvals program as the seats see it (src/program.rs), against two payments that landed
//! on Devnet through version 2 (`vectors/program/landed.json`, read from the public RPC): tracks
//! "dmain" and "emain" of ZOLANA.md 6.10. The chain verified each value, so a client that
//! derives another address, digest or commitment would never execute.

use p3_check::program::{
    approval_digest, approval_ix_data, cancellation_address, commitment, owner_pda,
    proposal_address, Body, APPROVAL_IX_LEN,
};
use p3_check::sign::verify_strict;
use p3_check::transact;
use p3_check::wasm::sol_approval_digest;
use serde_json::Value;

fn landed() -> Value {
    let path = format!("{}/vectors/program/landed.json", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

fn bytes(v: &Value) -> Vec<u8> {
    hex::decode(v.as_str().unwrap()).unwrap()
}

fn key(v: &Value) -> [u8; 32] {
    bytes(v).try_into().unwrap()
}

/// The `transact` data inside a landed `execute`: the tag 16, then the data after its tag 1.
fn transact_of(execute: &[u8]) -> Vec<u8> {
    assert_eq!(execute[0], 1, "execute tag");
    [&[16u8][..], &execute[1..]].concat()
}

struct Landed {
    group: [u8; 32],
    body: Vec<u8>,
    proposal: [u8; 32],
    approval: Vec<u8>,
    transact: Vec<u8>,
    accounts: Vec<[u8; 32]>,
}

fn track(name: &str) -> Landed {
    let all = landed();
    let t = &all[name];
    Landed {
        group: key(&all["group"]),
        body: bytes(&t["body"]),
        proposal: key(&t["proposal"]),
        approval: bytes(&t["ed25519_data"]),
        transact: transact_of(&bytes(&t["execute_data"])),
        accounts: t["execute_accounts"]
            .as_array()
            .unwrap()
            .iter()
            .map(key)
            .collect(),
    }
}

#[test]
fn the_owner_pda_of_the_spike_group_is_the_landed_owner() {
    let all = landed();
    assert_eq!(owner_pda(&key(&all["group"])).unwrap(), key(&all["pda"]));
    for name in ["dmain", "emain"] {
        let t = track(name);
        assert_eq!(t.accounts[2], key(&all["pda"]), "{name}: execute account 2");
        assert_eq!(
            t.accounts.last(),
            Some(&key(&all["pda"])),
            "{name}: last account"
        );
    }
}

#[test]
fn the_landed_body_parses_and_writes_back_to_the_same_bytes() {
    for name in ["dmain", "emain"] {
        let t = track(name);
        let body = Body::parse(&t.body).unwrap();
        assert_eq!(body.write().unwrap(), t.body, "{name}");
        assert_eq!(body.group, t.group, "{name}");
        assert_eq!(
            body.authorities,
            vec![body.rent_recipient],
            "{name}: one authority"
        );
        assert_eq!(
            t.accounts[4], body.rent_recipient,
            "{name}: rent recipient account"
        );
    }
}

#[test]
fn the_proposal_address_is_of_version_5_and_the_cancellation_address_is_the_landed_one() {
    for name in ["dmain", "emain"] {
        let t = track(name);
        let body = Body::parse(&t.body).unwrap();
        let (address, _) = proposal_address(&t.group, &body.commitment, &t.body).unwrap();
        let v5 = key(&landed()[name]["proposal_v5"]);
        assert_eq!(
            address, v5,
            "{name}: the address of @solana/kit for the version 5 seeds"
        );
        assert_ne!(
            address, t.proposal,
            "{name}: version 5 moves the landed version 2 address"
        );
        assert_eq!(t.accounts[1], t.proposal, "{name}: execute account 1");
        assert_eq!(
            cancellation_address(&t.proposal).unwrap(),
            t.accounts[3],
            "{name}"
        );
    }
}

#[test]
fn the_commitment_of_the_landed_transact_data_is_the_commitment_of_the_body() {
    for name in ["dmain", "emain"] {
        let t = track(name);
        let tx = transact::parse(&t.transact).unwrap();
        let body = Body::parse(&t.body).unwrap();
        assert_eq!(
            commitment(&tx.private_tx_hash, &tx, &[]).unwrap(),
            body.commitment,
            "{name}"
        );
        assert_eq!(
            tx.expiry, body.expiry,
            "{name}: the pool expiry is the body expiry"
        );
    }
}

#[test]
fn the_digest_and_the_ed25519_data_are_those_that_landed_and_the_signature_verifies() {
    for name in ["dmain", "emain"] {
        let t = track(name);
        let digest = approval_digest(&t.proposal, &t.body);
        assert_eq!(t.approval.len(), APPROVAL_IX_LEN, "{name}");
        assert_eq!(&t.approval[112..], &digest, "{name}: digest");
        assert_eq!(&t.approval[16..48], &t.group, "{name}: key");
        let signature: [u8; 64] = t.approval[48..112].try_into().unwrap();
        assert_eq!(
            approval_ix_data(&t.group, &signature, &digest),
            t.approval,
            "{name}"
        );
        verify_strict(&t.group, &digest, &signature).unwrap();
    }
}

#[test]
fn the_digest_entry_of_the_page_gives_the_landed_digest_and_refuses_a_bad_body() {
    for name in ["dmain", "emain"] {
        let t = track(name);
        let got = sol_approval_digest(&hex::encode(t.proposal), &hex::encode(&t.body)).unwrap();
        assert_eq!(hex::decode(got).unwrap(), &t.approval[112..], "{name}");
    }
    let t = track("dmain");
    assert!(digest_entry_refuses(
        &hex::encode(t.proposal),
        &hex::encode(&t.body[..100])
    ));
    assert!(digest_entry_refuses("00", &hex::encode(&t.body)));
}

fn digest_entry_refuses(proposal: &str, body: &str) -> bool {
    std::panic::catch_unwind(|| sol_approval_digest(proposal, body).is_err()).unwrap_or(true)
}
