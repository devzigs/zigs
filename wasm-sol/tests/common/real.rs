//! The one helper of the real-data tests that the other tests use. The P3 crate also reads the
//! solSeed file of the P5 run here. This copy has no code that reads a secret file: the tests
//! that did (`real_data.rs`, `repo_vectors.rs`) are not copied (CHECKER_PIN).
#![allow(dead_code)]

use p3_check::address::Address;

pub fn address_of(bytes: &[u8]) -> Address {
    assert_eq!(bytes.len(), 99);
    Address {
        signing: bytes[..34].try_into().unwrap(),
        nullifier_pk: bytes[34..66].try_into().unwrap(),
        viewing_pk: bytes[66..].try_into().unwrap(),
    }
}
