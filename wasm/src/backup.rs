//! Encrypted key share backups. One format for the web app and the iPhone app.
//!
//! `backupSeal(passphrase, plaintext)` returns a JSON file, and `backupOpen(passphrase, sealed)`
//! returns the plaintext. The plaintext is the backup JSON that the app builds. The file has these
//! fields, in this order, written without white space:
//!
//! `{"kind":"zigs-backup","v":1,"kdf":"argon2id","m":65536,"t":3,"p":1,"salt":B,"nonce":B,"ct":B}`
//!
//! - `B` is standard base64 with padding. `salt` is 16 random bytes. `nonce` is 24 random bytes.
//! - Key: Argon2id (RFC 9106, version 0x13) of the passphrase in UTF-8 with `salt`, `m` KiB of
//!   memory, `t` passes and `p` lanes, 32 bytes of output. The engine does not normalize the
//!   passphrase. The apps normalize it to Unicode NFC before the call (PROTOCOL.md, section 9).
//! - Cipher: XChaCha20-Poly1305 with `nonce`. `ct` is the ciphertext followed by the 16-byte tag.
//! - The associated data is the file without `ct`: the same object, the same field order, and the
//!   same compact form. A change to any header field makes the file fail to open.
//!
//! The passphrase must have at least 16 characters (Unicode scalar values, not bytes) and at least
//! 8 different ones. Opening refuses `m` above 262144, `t` above 10, `p` other than 1, and any
//! unknown `kind`, `v` or `kdf`.

use argon2::{Algorithm, Argon2, Params, Version};
use base64::Engine;
use chacha20poly1305::{
    aead::{Aead, Payload},
    KeyInit, XChaCha20Poly1305, XNonce,
};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

use super::{ensure, B64, R};

const KIND: &str = "zigs-backup";
const VERSION: u32 = 1;
const KDF: &str = "argon2id";
const MEMORY_KIB: u32 = 65536;
const PASSES: u32 = 3;
const LANES: u32 = 1;
const MAX_MEMORY_KIB: u32 = 262_144;
const MAX_PASSES: u32 = 10;
const MIN_PASSPHRASE_CHARS: usize = 16;
const MIN_DISTINCT_CHARS: usize = 8;

const NOT_BACKUP: &str = "This file is not a Zigs backup.";
const DAMAGED: &str = "This backup file is damaged.";
const WRONG: &str = "Wrong passphrase, or the file is damaged.";

/// The fields that the associated data covers. The field order is part of the format.
#[derive(Serialize, Deserialize)]
struct Header {
    kind: String,
    v: u32,
    kdf: String,
    m: u32,
    t: u32,
    p: u32,
    salt: String,
    nonce: String,
}

#[derive(Serialize, Deserialize)]
struct Sealed {
    #[serde(flatten)]
    header: Header,
    ct: String,
}

impl Header {
    fn aad(&self) -> Vec<u8> {
        serde_json::to_vec(self).expect("a header is always serializable")
    }
}

fn derive_key(passphrase: &str, salt: &[u8], h: &Header) -> R<[u8; 32]> {
    let params = Params::new(h.m, h.t, h.p, Some(32))
        .map_err(|_| "This backup file has settings that this app does not support.")?;
    let mut key = [0u8; 32];
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .map_err(|x| format!("key derivation: {x}"))?;
    Ok(key)
}

fn cipher(key: &[u8; 32]) -> XChaCha20Poly1305 {
    XChaCha20Poly1305::new(key.into())
}

/// The one rule on the strength of a passphrase. Both apps show the same rule before the call.
fn check_passphrase(passphrase: &str) -> R<()> {
    ensure(
        passphrase.chars().count() >= MIN_PASSPHRASE_CHARS,
        "The passphrase needs at least 16 characters.",
    )?;
    let distinct: HashSet<char> = passphrase.chars().collect();
    ensure(
        distinct.len() >= MIN_DISTINCT_CHARS,
        "The passphrase needs at least 8 different characters.",
    )
}

fn seal_with(passphrase: &str, plaintext: &str, salt: [u8; 16], nonce: [u8; 24]) -> R<String> {
    check_passphrase(passphrase)?;
    let header = Header {
        kind: KIND.into(),
        v: VERSION,
        kdf: KDF.into(),
        m: MEMORY_KIB,
        t: PASSES,
        p: LANES,
        salt: B64.encode(salt),
        nonce: B64.encode(nonce),
    };
    let key = derive_key(passphrase, &salt, &header)?;
    let ct = cipher(&key)
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plaintext.as_bytes(),
                aad: &header.aad(),
            },
        )
        .map_err(|_| "Could not encrypt the backup.")?;
    let sealed = Sealed {
        header,
        ct: B64.encode(ct),
    };
    Ok(serde_json::to_string(&sealed).expect("a sealed backup is always serializable"))
}

/// Encrypts `plaintext` with a key from `passphrase`. A new random salt and nonce go in the file.
pub fn seal(passphrase: &str, plaintext: &str) -> R<String> {
    let mut salt = [0u8; 16];
    let mut nonce = [0u8; 24];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce);
    seal_with(passphrase, plaintext, salt, nonce)
}

/// Reads only `kind`, `v` and `kdf`. A file of a later version can have other fields, and it must
/// get the version message, not "not a backup".
fn check_format(file: &Value) -> R<()> {
    ensure(
        file.get("kind").and_then(Value::as_str) == Some(KIND),
        NOT_BACKUP,
    )?;
    let version = file.get("v").and_then(Value::as_u64).ok_or(NOT_BACKUP)?;
    ensure(
        version == u64::from(VERSION),
        "This backup file has a version that this app cannot open.",
    )?;
    let kdf = file.get("kdf").and_then(Value::as_str).ok_or(NOT_BACKUP)?;
    ensure(
        kdf == KDF,
        "This backup file uses a key function that this app cannot open.",
    )
}

/// Refuses a file before any key derivation runs, so a hostile file cannot force heavy work.
fn check_header(h: &Header) -> R<()> {
    ensure(
        h.p == LANES,
        "This backup file has settings that this app does not support.",
    )?;
    ensure(
        h.m <= MAX_MEMORY_KIB,
        "This backup file needs too much memory to open safely.",
    )?;
    ensure(
        h.t <= MAX_PASSES,
        "This backup file needs too much time to open safely.",
    )
}

fn decode_exact<const N: usize>(b64: &str) -> R<[u8; N]> {
    let raw = B64.decode(b64).map_err(|_| DAMAGED)?;
    raw.try_into().map_err(|_| DAMAGED.to_string())
}

/// Decrypts a file from `seal`. A wrong passphrase and a changed file give the same error.
pub fn open(passphrase: &str, sealed: &str) -> R<String> {
    let value: Value = serde_json::from_str(sealed).map_err(|_| NOT_BACKUP)?;
    check_format(&value)?;
    let file: Sealed = serde_json::from_value(value).map_err(|_| NOT_BACKUP)?;
    let h = &file.header;
    check_header(h)?;
    let salt = decode_exact::<16>(&h.salt)?;
    let nonce = decode_exact::<24>(&h.nonce)?;
    let ct = B64.decode(&file.ct).map_err(|_| DAMAGED)?;
    let key = derive_key(passphrase, &salt, h)?;
    let pt = cipher(&key)
        .decrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &ct,
                aad: &h.aad(),
            },
        )
        .map_err(|_| WRONG)?;
    String::from_utf8(pt).map_err(|_| WRONG.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    const PASS: &str = "correct horse battery staple";
    const PLAIN: &str = r#"{"kind":"zec-frost-key-share","seat":1}"#;

    /// Made outside this crate. The key comes from OpenSSL 3.6 (`openssl kdf ARGON2ID`, checked
    /// against the RFC 9106 test vector). The cipher is XChaCha20-Poly1305 built from Node's
    /// ChaCha20-Poly1305 and an HChaCha20 that matches the draft-irtf-cfrg-xchacha vectors.
    /// Salt is the bytes 0..16 and nonce is the bytes 16..40.
    const KNOWN: &str = concat!(
        r#"{"kind":"zigs-backup","v":1,"kdf":"argon2id","m":65536,"t":3,"p":1,"#,
        r#""salt":"AAECAwQFBgcICQoLDA0ODw==","nonce":"EBESExQVFhcYGRobHB0eHyAhIiMkJSYn","#,
        r#""ct":"MBvOScZGW9Q6uoILBMDyirHv/y7gZJX/BZfPIfyWc8LOWvtbG/OPp0EDPtIMXMS5R4dkcxjhGA=="}"#,
    );

    fn fixed() -> String {
        let salt: [u8; 16] = std::array::from_fn(|i| i as u8);
        let nonce: [u8; 24] = std::array::from_fn(|i| 16 + i as u8);
        seal_with(PASS, PLAIN, salt, nonce).unwrap()
    }

    fn changed(sealed: &str, field: &str, value: Value) -> String {
        let mut v: Value = serde_json::from_str(sealed).unwrap();
        v[field] = value;
        v.to_string()
    }

    #[test]
    fn known_answer_matches_an_independent_build() {
        assert_eq!(fixed(), KNOWN);
        assert_eq!(open(PASS, KNOWN).unwrap(), PLAIN);
    }

    #[test]
    fn round_trip_with_fresh_salt_and_nonce() {
        let a = seal(PASS, PLAIN).unwrap();
        let b = seal(PASS, PLAIN).unwrap();
        assert_ne!(a, b);
        assert!(a.starts_with(
            r#"{"kind":"zigs-backup","v":1,"kdf":"argon2id","m":65536,"t":3,"p":1,"salt":""#
        ));
        assert_eq!(open(PASS, &a).unwrap(), PLAIN);
        assert_eq!(open(PASS, &b).unwrap(), PLAIN);
        let big = "é".repeat(5000);
        assert_eq!(open(PASS, &seal(PASS, &big).unwrap()).unwrap(), big);
        assert_eq!(open(PASS, &seal(PASS, "").unwrap()).unwrap(), "");
    }

    #[test]
    fn wrong_passphrase_fails() {
        for pass in [
            "correct horse battery stapl3",
            "",
            "Correct horse battery staple",
        ] {
            assert_eq!(open(pass, KNOWN).unwrap_err(), WRONG);
        }
    }

    /// Changes one base64 character to another valid one.
    fn flip(sealed: &str, field: &str) -> Value {
        let v: Value = serde_json::from_str(sealed).unwrap();
        let mut b = v[field].as_str().unwrap().as_bytes().to_vec();
        b[3] = if b[3] == b'A' { b'B' } else { b'A' };
        Value::from(String::from_utf8(b).unwrap())
    }

    #[test]
    fn a_changed_header_field_fails() {
        let cases = [
            ("m", Value::from(65535)),
            ("m", Value::from(65537)),
            ("t", Value::from(2)),
            ("t", Value::from(4)),
            ("salt", flip(KNOWN, "salt")),
            ("nonce", flip(KNOWN, "nonce")),
            ("ct", flip(KNOWN, "ct")),
            ("ct", Value::from("")),
        ];
        for (field, value) in cases {
            let err = open(PASS, &changed(KNOWN, field, value.clone())).unwrap_err();
            assert_eq!(err, WRONG, "{field} = {value}");
        }
    }

    #[test]
    fn the_file_layout_does_not_matter() {
        let v: Value = serde_json::from_str(KNOWN).unwrap();
        let pretty = serde_json::to_string_pretty(&v).unwrap();
        assert_eq!(open(PASS, &pretty).unwrap(), PLAIN);
        assert_eq!(open(PASS, &format!("\n{KNOWN}\n")).unwrap(), PLAIN);
    }

    #[test]
    fn unknown_kind_version_or_kdf_is_refused() {
        let cases = [
            ("kind", Value::from("zec-frost-key-share"), NOT_BACKUP),
            ("v", Value::from(2), "version"),
            ("v", Value::from(0), "version"),
            ("kdf", Value::from("argon2i"), "key function"),
            ("kdf", Value::from("scrypt"), "key function"),
            ("p", Value::from(2), "settings"),
            ("p", Value::from(0), "settings"),
        ];
        for (field, value, text) in cases {
            let err = open(PASS, &changed(KNOWN, field, value.clone())).unwrap_err();
            assert!(err.contains(text), "{field} = {value}: {err}");
        }
    }

    #[test]
    fn limits_are_refused_and_the_boundary_is_not() {
        let m = open(PASS, &changed(KNOWN, "m", Value::from(262_145))).unwrap_err();
        assert!(m.contains("too much memory"), "{m}");
        let t = open(PASS, &changed(KNOWN, "t", Value::from(11))).unwrap_err();
        assert!(t.contains("too much time"), "{t}");
        // At the limit the file passes the check and then fails to open for another reason.
        let at_m = changed(
            &changed(KNOWN, "m", Value::from(262_144)),
            "t",
            Value::from(1),
        );
        assert_eq!(open(PASS, &at_m).unwrap_err(), WRONG);
        let at_t = changed(&changed(KNOWN, "m", Value::from(8)), "t", Value::from(10));
        assert_eq!(open(PASS, &at_t).unwrap_err(), WRONG);
        for bad in [0, 7] {
            let m = changed(KNOWN, "m", Value::from(bad));
            assert!(
                open(PASS, &m).unwrap_err().contains("settings"),
                "m = {bad}"
            );
        }
        let t = changed(KNOWN, "t", Value::from(0));
        assert!(open(PASS, &t).unwrap_err().contains("settings"));
    }

    #[test]
    fn damaged_files_are_errors_and_never_panics() {
        let wrong_length = ["", "AA==", "AAECAwQFBgcICQoLDA0O", "not base64!"];
        for field in ["salt", "nonce", "ct"] {
            for value in wrong_length {
                let err = open(PASS, &changed(KNOWN, field, value.into())).unwrap_err();
                assert!(err == DAMAGED || err == WRONG, "{field} = {value:?}: {err}");
            }
        }
        for junk in [
            "",
            "{}",
            "[]",
            "null",
            "not json",
            r#"{"kind":"zigs-backup"}"#,
        ] {
            assert_eq!(open(PASS, junk).unwrap_err(), NOT_BACKUP, "{junk:?}");
        }
        let float = changed(KNOWN, "m", Value::from(65536.5));
        assert_eq!(open(PASS, &float).unwrap_err(), NOT_BACKUP);
        let text = changed(KNOWN, "t", Value::from("3"));
        assert_eq!(open(PASS, &text).unwrap_err(), NOT_BACKUP);
    }

    #[test]
    fn a_short_passphrase_is_refused() {
        let msg = "The passphrase needs at least 16 characters.";
        for pass in ["", "short", "123456789012345", "é2345678901234"] {
            assert_eq!(seal(pass, PLAIN).unwrap_err(), msg, "{pass:?}");
        }
        // 16 characters, 32 bytes: the rule counts characters.
        let pass = "éèêëàâäçùûüôöîïñ";
        assert_eq!(pass.chars().count(), 16);
        assert_eq!(open(pass, &seal(pass, PLAIN).unwrap()).unwrap(), PLAIN);
    }

    #[test]
    fn a_passphrase_that_repeats_few_characters_is_refused() {
        let msg = "The passphrase needs at least 8 different characters.";
        for pass in [
            "a".repeat(16),
            " ".repeat(16),
            "ab".repeat(8),
            "abcdefg".repeat(3),
        ] {
            assert_eq!(seal(&pass, PLAIN).unwrap_err(), msg, "{pass:?}");
        }
        // 8 different characters is enough, and the length rule still comes first.
        let pass = "abcdefgh".repeat(2);
        assert_eq!(open(&pass, &seal(&pass, PLAIN).unwrap()).unwrap(), PLAIN);
        assert!(seal("aaaa", PLAIN).unwrap_err().contains("16 characters"));
    }

    #[test]
    fn a_later_version_with_other_fields_gets_the_version_message() {
        let later = r#"{"kind":"zigs-backup","v":2,"kdf":"argon2id","params":{"m":1},"ct":"AA=="}"#;
        assert!(open(PASS, later).unwrap_err().contains("version"));
        let bare = r#"{"kind":"zigs-backup","v":2}"#;
        assert!(open(PASS, bare).unwrap_err().contains("version"));
        let other = r#"{"kind":"zigs-backup","v":1,"kdf":"scrypt","n":1}"#;
        assert!(open(PASS, other).unwrap_err().contains("key function"));
        for bad in [
            r#"{"kind":"zigs-backup","v":"1"}"#,
            r#"{"kind":"zigs-backup","v":1}"#,
        ] {
            assert_eq!(open(PASS, bad).unwrap_err(), NOT_BACKUP, "{bad}");
        }
    }
}
