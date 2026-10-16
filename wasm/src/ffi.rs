//! C interface for the native apps (iOS now, Android later).
//!
//! One entry point: `zf_call(method, args)` takes a method name and a JSON array of arguments and
//! returns a JSON object, `{"ok": "<result>"}` or `{"err": "<message>"}`. The caller frees the
//! returned string with `zf_free`. Method names match the WASM exports, so both apps share one
//! protocol.

use std::ffi::{c_char, CStr, CString};

use serde_json::{json, Value};

use crate::account;
use crate::backup;
use crate::ceremony;
use crate::chain::native;
use crate::request;

use super::*;

type Method = fn(&[Value]) -> R<String>;

fn s(a: &[Value], i: usize) -> R<&str> {
    a.get(i).and_then(Value::as_str).ok_or(format!("argument {i} must be a string"))
}

fn n(a: &[Value], i: usize) -> R<u16> {
    let v = a.get(i).and_then(Value::as_u64).ok_or(format!("argument {i} must be a number"))?;
    u16::try_from(v).map_err(|_| format!("argument {i} is out of range"))
}

fn u(a: &[Value], i: usize) -> R<u64> {
    a.get(i).and_then(Value::as_u64).ok_or(format!("argument {i} must be a whole number"))
}

fn h(a: &[Value], i: usize) -> R<u32> {
    u32::try_from(u(a, i)?).map_err(|_| format!("argument {i} is out of range"))
}

fn list(a: &[Value], i: usize) -> R<&[Value]> {
    a.get(i).and_then(Value::as_array).map(Vec::as_slice).ok_or(format!("argument {i} must be a list"))
}

const METHODS: &[(&str, Method)] = &[
    ("dkgPart1", |a| dkg_part1(n(a, 0)?, n(a, 1)?, n(a, 2)?)),
    ("dkgPart2", |a| dkg_part2(s(a, 0)?, s(a, 1)?)),
    ("dkgPart3", |a| dkg_part3(s(a, 0)?, s(a, 1)?, s(a, 2)?)),
    ("walletCreate", |a| wallet_create(s(a, 0)?, s(a, 1)?)),
    ("walletVerify", |a| wallet_verify(s(a, 0)?, s(a, 1)?)),
    ("normalizeAddress", |a| normalize_address(s(a, 0)?)),
    ("skCommit", |a| ceremony::sk_commit(s(a, 0)?, n(a, 1)?, s(a, 2)?, s(a, 3)?)),
    ("dkgEcho", |a| ceremony::dkg_echo(s(a, 0)?, s(a, 1)?)),
    ("vaultSk", |a| ceremony::vault_sk(s(a, 0)?, s(a, 1)?, s(a, 2)?)),
    ("safetyNumber", |a| {
        ceremony::safety_number(s(a, 0)?, n(a, 1)?, n(a, 2)?, s(a, 3)?, s(a, 4)?)
    }),
    ("walletCreateV2", |a| ceremony::wallet_create_v2(s(a, 0)?, s(a, 1)?, s(a, 2)?)),
    ("walletVerifyV2", |a| ceremony::wallet_verify_v2(s(a, 0)?, s(a, 1)?, s(a, 2)?)),
    ("inspect", |a| inspect(s(a, 0)?, s(a, 1)?)),
    // The iPhone and Mac apps pass no chain height yet (TICKETS.md, ZEC-8).
    ("signCommit", |a| sign_commit(s(a, 0)?, s(a, 1)?, s(a, 2)?, None)),
    ("signPackage", |a| sign_package(s(a, 0)?, s(a, 1)?, s(a, 2)?, n(a, 3)?)),
    ("signShare", |a| {
        sign_share(s(a, 0)?, s(a, 1)?, s(a, 2)?, s(a, 3)?, s(a, 4)?, n(a, 5)?)
    }),
    ("signAggregate", |a| sign_aggregate(s(a, 0)?, s(a, 1)?, s(a, 2)?, s(a, 3)?)),
    ("finalize", |a| finalize(s(a, 0)?)),
    ("boxKeypair", |_| Ok(box_keypair())),
    ("boxSeal", |a| box_seal(s(a, 0)?, s(a, 1)?, s(a, 2)?, s(a, 3)?)),
    ("boxOpen", |a| box_open(s(a, 0)?, s(a, 1)?, s(a, 2)?, s(a, 3)?)),
    ("secretSeal", |a| secret_seal(s(a, 0)?, s(a, 1)?, s(a, 2)?)),
    ("secretOpen", |a| secret_open(s(a, 0)?, s(a, 1)?, s(a, 2)?)),
    ("docPayload", |a| doc_payload(s(a, 0)?, s(a, 1)?, n(a, 2)?, s(a, 3)?)),
    ("backupSeal", |a| backup::seal(s(a, 0)?, s(a, 1)?)),
    ("backupOpen", |a| backup::open(s(a, 0)?, s(a, 1)?)),
    ("walletOpen", |a| native::open(s(a, 0)?, s(a, 1)?, h(a, 2)?, a.get(3).and_then(Value::as_str))),
    ("walletClose", |a| native::close(s(a, 0)?)),
    ("walletNeeds", |a| native::needs(s(a, 0)?)),
    ("walletStart", |a| native::start(s(a, 0)?, s(a, 1)?)),
    ("walletBlocks", |a| native::blocks(s(a, 0)?, list(a, 1)?, h(a, 2)?)),
    ("walletBalance", |a| native::balance(s(a, 0)?)),
    ("walletReceived", |a| native::received(s(a, 0)?)),
    ("walletSent", |a| native::sent(s(a, 0)?)),
    ("walletSnapshot", |a| native::snapshot(s(a, 0)?)),
    ("walletSpend", |a| native::spend(s(a, 0)?, list(a, 1)?, h(a, 2)?)),
    ("walletMemoNeeds", |a| native::memo_needs(s(a, 0)?)),
    ("walletTransaction", |a| native::transaction(s(a, 0)?, s(a, 1)?, s(a, 2)?)),
    ("isDeepReorg", |a| Ok(crate::chain::is_deep_reorg(s(a, 0)?).to_string())),
    ("isNodeRefusal", |a| Ok(crate::chain::is_node_refusal(s(a, 0)?).to_string())),
    ("accountNew", |a| account::new_account(s(a, 0)?)),
    ("accountKeys", |a| account::keys(s(a, 0)?, s(a, 1)?)),
    ("addressAt", |a| account::address_at(s(a, 0)?, h(a, 1)?)),
    ("splitMessage", |a| account::split_message(s(a, 0)?)),
    ("joinMessage", |a| account::join_message(s(a, 0)?)),
    ("accountSign", |a| account::sign(s(a, 0)?, s(a, 1)?, s(a, 2)?)),
    ("walletMessage", |a| native::message(s(a, 0)?, s(a, 1)?, s(a, 2)?, h(a, 3)?)),
    ("parseRequest", |a| request::parse_request(s(a, 0)?, s(a, 1)?)),
    ("makeRequest", |a| request::make_request(s(a, 0)?, s(a, 1)?)),
];

fn call(method: &str, args: &str) -> R<String> {
    let f = METHODS
        .iter()
        .find(|(name, _)| *name == method)
        .map(|(_, f)| f)
        .ok_or(format!("unknown method {method}"))?;
    let args: Vec<Value> = serde_json::from_str(args).map_err(|e| format!("bad arguments: {e}"))?;
    f(&args)
}

fn encode(r: R<String>) -> String {
    match r {
        Ok(v) => json!({ "ok": v }).to_string(),
        Err(m) => json!({ "err": m }).to_string(),
    }
}

fn read(p: *const c_char, what: &str) -> R<String> {
    if p.is_null() {
        return Err(format!("{what} is null"));
    }
    // SAFETY: the caller passes a valid NUL-terminated string that outlives this call.
    let c = unsafe { CStr::from_ptr(p) };
    c.to_str().map(str::to_owned).map_err(|_| format!("{what} is not UTF-8"))
}

/// Runs one engine method. Never unwinds into the caller: a panic becomes an `err` result.
#[no_mangle]
pub extern "C" fn zf_call(method: *const c_char, args: *const c_char) -> *mut c_char {
    let out = std::panic::catch_unwind(|| {
        let method = read(method, "method")?;
        let args = read(args, "args")?;
        call(&method, &args)
    })
    .unwrap_or_else(|_| Err("engine panicked".into()));
    // A JSON string never contains a NUL byte, so this cannot fail.
    CString::new(encode(out)).expect("JSON has no NUL").into_raw()
}

/// Frees a string returned by `zf_call`.
#[no_mangle]
pub extern "C" fn zf_free(p: *mut c_char) {
    if !p.is_null() {
        // SAFETY: `p` came from `CString::into_raw` in `zf_call` and is freed once.
        drop(unsafe { CString::from_raw(p) });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ffi(method: &str, args: Value) -> Value {
        let m = CString::new(method).unwrap();
        let a = CString::new(args.to_string()).unwrap();
        let p = zf_call(m.as_ptr(), a.as_ptr());
        // SAFETY: `p` is a valid string from `zf_call`.
        let out = unsafe { CStr::from_ptr(p) }.to_str().unwrap().to_owned();
        zf_free(p);
        serde_json::from_str(&out).unwrap()
    }

    /// The message of the error that `method` gives.
    fn error_of(method: &str, args: Value) -> String {
        ffi(method, args)["err"].as_str().expect("an error").to_string()
    }

    #[test]
    fn seal_round_trip_and_errors() {
        let key = B64URL.encode([7u8; 32]);
        let sealed = ffi("secretSeal", json!([key, "groups/g/x\nname", "\"Treasury\""]));
        let ct = sealed["ok"].as_str().expect("seal works");
        let opened = ffi("secretOpen", json!([key, "groups/g/x\nname", ct]));
        assert_eq!(opened["ok"], "\"Treasury\"");
        assert!(ffi("secretOpen", json!([key, "groups/g/y\nname", ct]))["err"].is_string());
        assert!(ffi("noSuchMethod", json!([]))["err"].as_str().unwrap().contains("unknown"));
        assert!(ffi("dkgPart1", json!(["1", 2, 2]))["err"].is_string());
        assert!(ffi("dkgPart1", json!([1, 2, 2]))["ok"].is_string());
    }

    #[test]
    fn ceremony_methods_match_the_wasm_names() {
        let (pk, r) = (hex::encode([2u8; 32]), hex::encode([3u8; 32]));
        let commit = ffi("skCommit", json!(["w", 1, pk, r]));
        assert_eq!(commit["ok"], ceremony::sk_commit("w", 1, &pk, &r).unwrap());
        assert!(ffi("skCommit", json!(["w", "1", pk, r]))["err"].is_string());
        let seats = json!({"1": pk, "2": pk}).to_string();
        let number = ffi("safetyNumber", json!(["w", 2, 2, "testnet", seats]));
        assert_eq!(number["ok"].as_str().unwrap().len(), 35);
        assert!(ffi("safetyNumber", json!(["w", "2", 2, "testnet", seats]))["err"].is_string());
        assert!(ffi("safetyNumber", json!(["w", 2, 300, "testnet", seats]))["err"].is_string());
        for method in ["dkgEcho", "vaultSk", "walletCreateV2", "walletVerifyV2"] {
            let out = ffi(method, json!(["w", "{}", "{}"]));
            let err = out["err"].as_str().expect("empty input is refused");
            assert!(!err.contains("unknown method"), "{method} is in the table");
        }
    }

    #[test]
    fn backup_methods_match_the_wasm_names() {
        let pass = "correct horse battery staple";
        let plain = "{\"seat\":1}";
        let sealed = ffi("backupSeal", json!([pass, plain]));
        let file = sealed["ok"].as_str().expect("seal works");
        assert_eq!(ffi("backupOpen", json!([pass, file]))["ok"], plain);
        let wrong = ffi("backupOpen", json!(["another long passphrase", file]));
        assert_eq!(wrong["err"], "Wrong passphrase, or the file is damaged.");
        assert!(ffi("backupSeal", json!(["short", plain]))["err"].is_string());
        assert!(ffi("backupOpen", json!([pass, 1]))["err"].is_string());
    }

    #[test]
    fn doc_payload_matches_the_wasm_name() {
        let fields = r#"{"b": 1, "a": null}"#;
        let out = ffi("docPayload", json!(["w", "confirm/1", 1, fields]));
        assert_eq!(out["ok"], r#"["zigs-doc-v1","w","confirm/1",1,{"a":null,"b":1}]"#);
        assert_eq!(out["ok"], doc_payload("w", "confirm/1", 1, fields).unwrap());
        assert!(ffi("docPayload", json!(["w", "confirm/1", "1", fields]))["err"].is_string());
        assert!(ffi("docPayload", json!(["w", "confirm/1", 70000, fields]))["err"].is_string());
        let float = r#"{"a": 1.5}"#;
        assert!(ffi("docPayload", json!(["w", "confirm/1", 1, float]))["err"].is_string());
    }

    #[test]
    fn inbox_methods_are_in_the_table() {
        for (method, args) in [
            ("walletMemoNeeds", json!(["none"])),
            ("walletTransaction", json!(["none", "id", "AAAA"])),
        ] {
            let err = ffi(method, args)["err"].as_str().unwrap().to_string();
            assert!(err.contains("no open wallet"), "{method}: {err}");
        }
        let err = ffi("walletTransaction", json!(["none", "id", 5]));
        assert!(err["err"].as_str().unwrap().contains("argument 2"), "{err}");
    }

    #[test]
    fn request_methods_match_the_wasm_names() {
        let uri = "zcash:?amount=1";
        let err = ffi("parseRequest", json!([uri, "test"]));
        assert_eq!(err["err"], "payee 1: the address is missing");
        let rows = json!([{"to": "u1nope"}]).to_string();
        let made = ffi("makeRequest", json!([rows, "main"]));
        assert!(made["err"].as_str().unwrap().contains("payee 1"), "{made}");
        for method in ["parseRequest", "makeRequest"] {
            let out = ffi(method, json!([5, "test"]));
            assert!(out["err"].as_str().unwrap().contains("argument 0"), "{method}: {out}");
            let out = ffi(method, json!(["x", 5]));
            assert!(out["err"].as_str().unwrap().contains("argument 1"), "{method}: {out}");
        }
        let wasm = request::parse_request("zcash:?", "test");
        assert_eq!(ffi("parseRequest", json!(["zcash:?", "test"]))["err"], wasm.unwrap_err());
    }

    #[test]
    fn account_methods_match_the_wasm_names() {
        let made = ffi("accountNew", json!(["testnet"]));
        let account: Value = serde_json::from_str(made["ok"].as_str().unwrap()).unwrap();
        let (seed, ufvk) = (account["seed"].as_str().unwrap(), account["ufvk"].as_str().unwrap());
        let keys = ffi("accountKeys", json!([seed, "testnet"]));
        let keys: Value = serde_json::from_str(keys["ok"].as_str().unwrap()).unwrap();
        assert_eq!((&keys["ufvk"], &keys["address"]), (&account["ufvk"], &account["address"]));
        assert_eq!(ffi("addressAt", json!([ufvk, 0]))["ok"], account["address"]);
        let seven = ffi("addressAt", json!([ufvk, 7]));
        assert_eq!(seven["ok"], account::address_at(ufvk, 7).unwrap());
        assert!(error_of("addressAt", json!([ufvk, "7"])).contains("argument 1"));
        assert!(error_of("addressAt", json!([ufvk, 4_294_967_296u64])).contains("out of range"));
        assert!(error_of("accountKeys", json!(["0a", "testnet"])).contains("64"));
        assert!(error_of("accountNew", json!(["regtest"])).contains("network"));
        assert!(error_of("accountNew", json!([5])).contains("argument 0"));
    }

    #[test]
    fn message_methods_match_the_wasm_names() {
        let long = "ab".repeat(400);
        let parts = ffi("splitMessage", json!([long]));
        assert_eq!(parts["ok"], account::split_message(&long).unwrap());
        let list: Vec<String> = serde_json::from_str(parts["ok"].as_str().unwrap()).unwrap();
        assert_eq!(list.len(), 2);
        let joined = ffi("joinMessage", json!([parts["ok"]]));
        assert_eq!(joined["ok"], json!({"text": long}).to_string());
        let lone = ffi("joinMessage", json!([r#"["(1/2) a"]"#]));
        assert_eq!(lone["ok"], r#"{"text":null}"#);
        assert_eq!(ffi("splitMessage", json!([""]))["err"], "The message is empty.");
        assert!(error_of("splitMessage", json!([5])).contains("argument 0"));
        assert!(error_of("joinMessage", json!([5])).contains("argument 0"));
        assert!(error_of("joinMessage", json!(["{}"])).contains("memo list"));
        let err = error_of("walletMessage", json!(["none", "u1x", "hi", 5]));
        assert!(err.contains("no open wallet"), "{err}");
        let err = error_of("walletMessage", json!(["none", "u1x", "hi", "5"]));
        assert!(err.contains("argument 3"), "{err}");
    }

    #[test]
    fn account_sign_matches_the_wasm_name() {
        let seed = "0a".repeat(32);
        let err = error_of("accountSign", json!(["AAAA", seed, "testnet"]));
        assert!(err.contains("pczt"), "{err}");
        assert_eq!(err, account::sign("AAAA", &seed, "testnet").unwrap_err());
        let short = error_of("accountSign", json!(["AAAA", "0a", "testnet"]));
        assert!(short.contains("64 hexadecimal"), "{short}");
        assert!(error_of("accountSign", json!(["AAAA", seed])).contains("argument 2"));
    }

    #[test]
    fn the_apps_ask_the_engine_for_a_deep_reorganisation() {
        assert_eq!(ffi("isDeepReorg", json!(["sync failed"]))["ok"], "false");
        let said = format!("{} 100 blocks", crate::chain::DEEP_REORG);
        assert_eq!(ffi("isDeepReorg", json!([said.clone()]))["ok"], "true");
        let forged = format!("lightwalletd: {said}");
        assert_eq!(ffi("isDeepReorg", json!([forged]))["ok"], "false");
    }

    #[test]
    fn the_apps_ask_the_engine_for_a_node_refusal() {
        let said = format!("{}: bad-txns", crate::chain::NODE_REFUSED);
        assert_eq!(ffi("isNodeRefusal", json!([said.clone()]))["ok"], "true");
        assert_eq!(ffi("isNodeRefusal", json!(["lightwalletd: unavailable"]))["ok"], "false");
        assert_eq!(ffi("isNodeRefusal", json!([format!("lightwalletd: {said}")]))["ok"], "false");
        assert!(error_of("isNodeRefusal", json!([5])).contains("argument 0"));
    }

    #[test]
    fn null_pointers_are_errors() {
        let p = zf_call(std::ptr::null(), std::ptr::null());
        // SAFETY: `p` is a valid string from `zf_call`.
        let out = unsafe { CStr::from_ptr(p) }.to_str().unwrap().to_owned();
        zf_free(p);
        assert!(out.contains("method is null"));
    }
}
