//! Every pinned constant against the Zolana repo at commit c232da1b (read from the source text,
//! not from memory). The tests are ignored: they need a checkout of the repo, which the
//! variable ZOLANA_REPO names. Run: ZOLANA_REPO=<checkout> cargo test --test repo_pins -- --ignored

use std::str::FromStr;

use p3_check::consts::*;
use p3_check::template::LOADED_MAX;
use solana_address::Address;

const COMMIT: &str = "c232da1bd6748628b56bb8c277bcffbaaf2b0774";

fn repo() -> String {
    std::env::var("ZOLANA_REPO").expect("ZOLANA_REPO names a checkout of the Zolana repo")
}

fn source(path: &str) -> String {
    std::fs::read_to_string(format!("{}/{path}", repo())).unwrap_or_else(|e| panic!("{path}: {e}"))
}

/// The text of a const from its name to the `;` that ends its value (the type may hold a `;`).
fn const_text(text: &str, name: &str) -> String {
    let marker = format!("pub const {name}:");
    let start = text.find(&marker).unwrap_or_else(|| panic!("const {name}")) + marker.len();
    let equals = text[start..].find('=').expect("value") + start;
    let end = text[equals..].find(';').expect("end of const") + equals;
    text[start..end].to_string()
}

fn number(text: &str, name: &str) -> u64 {
    let body = const_text(text, name);
    body.split('=')
        .nth(1)
        .expect("value")
        .trim()
        .replace('_', "")
        .parse()
        .expect("number")
}

fn address(text: &str, name: &str) -> Key {
    let body = const_text(text, name);
    let quoted = body
        .split('"')
        .nth(1)
        .unwrap_or_else(|| panic!("{name}: no base58 text"));
    Address::from_str(quoted).expect("base58").to_bytes()
}

#[test]
#[ignore = "needs ZOLANA_REPO: a checkout of the Zolana repo at commit c232da1b"]
fn the_repo_is_at_the_pinned_commit() {
    let head = std::process::Command::new("git")
        .args(["-C", &repo(), "rev-parse", "HEAD"])
        .output()
        .expect("git");
    assert_eq!(String::from_utf8_lossy(&head.stdout).trim(), COMMIT);
}

#[test]
#[ignore = "needs ZOLANA_REPO: a checkout of the Zolana repo at commit c232da1b"]
fn pool_tags() {
    let tags = source("program-libs/event/src/tag.rs");
    assert_eq!(number(&tags, "DEPOSIT"), u64::from(TAG_DEPOSIT));
    assert_eq!(number(&tags, "TRANSACT"), u64::from(TAG_TRANSACT));
    assert_eq!(
        number(&tags, "MERGE_TRANSACT"),
        u64::from(TAG_MERGE_TRANSACT)
    );
}

#[test]
#[ignore = "needs ZOLANA_REPO: a checkout of the Zolana repo at commit c232da1b"]
fn registry_discriminators() {
    let text = source("program-libs/user-registry-interface/src/instruction.rs");
    assert_eq!(number(&text, "REGISTER"), u64::from(REG_REGISTER));
    assert_eq!(
        number(&text, "SET_MERGING_ENABLED"),
        u64::from(REG_SET_MERGING_ENABLED)
    );
    assert_eq!(number(&text, "UPDATE_KEYS"), u64::from(REG_UPDATE_KEYS));
}

#[test]
#[ignore = "needs ZOLANA_REPO: a checkout of the Zolana repo at commit c232da1b"]
fn program_ids() {
    let pool = source("program-libs/interface/src/lib.rs");
    let registry = source("program-libs/user-registry-interface/src/lib.rs");
    assert_eq!(address(&pool, "SHIELDED_POOL_PROGRAM_ID"), POOL_DEVNET);
    assert_eq!(
        address(&registry, "USER_REGISTRY_PROGRAM_ID"),
        REGISTRY_DEVNET
    );
    let pins = |text: &str| Address::from_str(text).expect("base58").to_bytes();
    assert_eq!(
        pins("ComputeBudget111111111111111111111111111111"),
        COMPUTE_BUDGET_PROGRAM
    );
    assert_eq!(
        pins("SysvarRecentB1ockHashes11111111111111111111"),
        RECENT_BLOCKHASHES
    );
    assert_eq!(
        pins("SysvarRent111111111111111111111111111111111"),
        RENT_SYSVAR
    );
    assert_eq!(pins("11111111111111111111111111111111"), SYSTEM_PROGRAM);
}

#[test]
#[ignore = "needs ZOLANA_REPO: a checkout of the Zolana repo at commit c232da1b"]
fn seeds_and_slots() {
    let lib = source("program-libs/interface/src/lib.rs");
    let nullifier = source("program-libs/interface/src/state/nullifier_pda.rs");
    let registry = source("program-libs/user-registry-interface/src/lib.rs");
    assert!(const_text(&lib, "TREE_PDA_SEED").contains("b\"tree\""));
    assert!(const_text(&lib, "SOL_INTERFACE_PDA_SEED").contains("b\"sol_interface\""));
    assert!(const_text(&lib, "DEFAULT_SOL_INTERFACE_INDEX_SEED").contains("&[0]"));
    assert!(const_text(&nullifier, "NULLIFIER_PDA_SEED").contains("b\"nullifier\""));
    assert!(const_text(&registry, "USER_RECORD_SEED").contains("b\"zolana/registry/v0\""));
    assert_eq!(SEED_TREE, b"tree");
    assert_eq!(SEED_SOL_INTERFACE, b"sol_interface");
    assert_eq!(SEED_SOL_INTERFACE_INDEX, &[0]);
    assert_eq!(SEED_NULLIFIER, b"nullifier");
    assert_eq!(SEED_USER_RECORD, b"zolana/registry/v0");
    assert_eq!(number(&lib, "N_PUBLIC_SLOTS"), u64::from(PUBLIC_SLOTS));
}

#[test]
#[ignore = "needs ZOLANA_REPO: a checkout of the Zolana repo at commit c232da1b"]
fn the_repo_sol_interface_constant_is_the_derived_address() {
    let lib = source("program-libs/interface/src/lib.rs");
    let body = const_text(&lib, "SOL_INTERFACE");
    let list = body
        .split('[')
        .nth(2)
        .expect("array")
        .split(']')
        .next()
        .expect("end");
    let bytes: Vec<u8> = list
        .split(',')
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(|n| n.parse().expect("byte"))
        .collect();
    let pins = p3_check::pins::Pins::devnet([1; 32], [2; 32], [3; 33]).expect("pins");
    assert_eq!(bytes, pins.sol_interface);
}

#[test]
#[ignore = "needs ZOLANA_REPO: a checkout of the Zolana repo at commit c232da1b"]
fn off_chain_and_derivation_prefixes() {
    let derivation = source("sdk-libs/ts/src/keypair/derivation.ts");
    assert!(derivation.contains("DERIVATION_PAYLOAD_PREFIX = \"TSPP/derive/\""));
    assert_eq!(DERIVE_PREFIX, b"TSPP/derive/");
    assert_eq!(&OFFCHAIN_MAGIC[1..], b"solana offchain");
    assert_eq!(OFFCHAIN_MAGIC[0], 0xff);
    assert!(derivation.contains("0xff, 0x73, 0x6f, 0x6c, 0x61, 0x6e, 0x61, 0x20, 0x6f, 0x66"));
}

#[test]
#[ignore = "needs ZOLANA_REPO: a checkout of the Zolana repo at commit c232da1b"]
fn the_loaded_limit_maximum_is_the_sdk_default() {
    let compile = source("sdk-libs/ts/src/flows/compile.ts");
    assert!(compile.contains("LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 64 * 1024 * 1024;"));
    assert_eq!(LOADED_MAX, 64 * 1024 * 1024);
}

/// `SPP_SUPPORTED_SHAPES` of `program-libs/interface/src/shape.rs`: the names `Shape::INa_OUTb`
/// in the array, each name resolved through the constant that defines it, in the repo order.
#[test]
#[ignore = "needs ZOLANA_REPO: a checkout of the Zolana repo at commit c232da1b"]
fn the_supported_shapes_are_the_list_of_the_repo() {
    let text = source("program-libs/interface/src/shape.rs");
    let marker = "pub const SPP_SUPPORTED_SHAPES: [Shape; ";
    let at = text.find(marker).expect("SPP_SUPPORTED_SHAPES") + marker.len();
    let count: usize = text[at..]
        .split(']')
        .next()
        .unwrap()
        .parse()
        .expect("count");
    let list = &text[text[at..].find("= [").expect("array") + at + 3..];
    let list = &list[..list.find("];").expect("end")];
    let defined = |name: &str| -> (u8, u8) {
        let head = format!("pub const {name}: Self = Self {{");
        let body = &text[text.find(&head).unwrap_or_else(|| panic!("{name}")) + head.len()..];
        let field = |key: &str| -> u8 {
            let rest = &body[body.find(key).expect("field") + key.len()..];
            rest.trim_start_matches(':')
                .trim()
                .split(',')
                .next()
                .unwrap()
                .trim()
                .parse()
                .unwrap()
        };
        (field("n_inputs"), field("n_outputs"))
    };
    let repo: Vec<(u8, u8)> = list
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(|entry| defined(entry.trim_start_matches("Shape::")))
        .collect();
    assert_eq!(repo.len(), count, "the array length of the repo");
    assert_eq!(
        repo, SUPPORTED_SHAPES,
        "the order of the repo is the cost order"
    );
}
