//! C interface for the native apps (iOS now, Android later).
//!
//! One entry point: `zf_call(method, args)` takes a method name and a JSON array of arguments and
//! returns a JSON object, `{"ok": "<result>"}` or `{"err": "<message>"}`. The caller frees the
//! returned string with `zf_free`. Method names match the WASM exports, so both apps share one
//! protocol.

use std::ffi::{c_char, CStr, CString};

use serde_json::{json, Value};

use super::*;

type Method = fn(&[Value]) -> R<String>;

fn s(a: &[Value], i: usize) -> R<&str> {
    a.get(i).and_then(Value::as_str).ok_or(format!("argument {i} must be a string"))
}

fn n(a: &[Value], i: usize) -> R<u16> {
    let v = a.get(i).and_then(Value::as_u64).ok_or(format!("argument {i} must be a number"))?;
    u16::try_from(v).map_err(|_| format!("argument {i} is out of range"))
}

const METHODS: &[(&str, Method)] = &[
    ("dkgPart1", |a| dkg_part1(n(a, 0)?, n(a, 1)?, n(a, 2)?)),
    ("dkgPart2", |a| dkg_part2(s(a, 0)?, s(a, 1)?)),
    ("dkgPart3", |a| dkg_part3(s(a, 0)?, s(a, 1)?, s(a, 2)?)),
    ("walletCreate", |a| wallet_create(s(a, 0)?, s(a, 1)?)),
    ("walletVerify", |a| wallet_verify(s(a, 0)?, s(a, 1)?)),
    ("inspect", |a| inspect(s(a, 0)?, s(a, 1)?)),
    ("signCommit", |a| sign_commit(s(a, 0)?, s(a, 1)?, s(a, 2)?)),
    ("signPackage", |a| sign_package(s(a, 0)?, s(a, 1)?, s(a, 2)?, n(a, 3)?)),
    ("signShare", |a| {
        sign_share(s(a, 0)?, s(a, 1)?, s(a, 2)?, s(a, 3)?, s(a, 4)?, s(a, 5)?, n(a, 6)?)
    }),
    ("signAggregate", |a| sign_aggregate(s(a, 0)?, s(a, 1)?, s(a, 2)?, s(a, 3)?)),
    ("finalize", |a| finalize(s(a, 0)?)),
    ("boxKeypair", |_| Ok(box_keypair())),
    ("boxSeal", |a| box_seal(s(a, 0)?, s(a, 1)?, s(a, 2)?, s(a, 3)?)),
    ("boxOpen", |a| box_open(s(a, 0)?, s(a, 1)?, s(a, 2)?, s(a, 3)?)),
    ("secretSeal", |a| secret_seal(s(a, 0)?, s(a, 1)?, s(a, 2)?)),
    ("secretOpen", |a| secret_open(s(a, 0)?, s(a, 1)?, s(a, 2)?)),
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
    fn null_pointers_are_errors() {
        let p = zf_call(std::ptr::null(), std::ptr::null());
        // SAFETY: `p` is a valid string from `zf_call`.
        let out = unsafe { CStr::from_ptr(p) }.to_str().unwrap().to_owned();
        zf_free(p);
        assert!(out.contains("method is null"));
    }
}
