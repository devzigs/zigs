//! Text forms and hashes at the entry points: hex in, seat maps in JSON, base64url, and the
//! personalized BLAKE2b-256 of the ceremony and of the signing digest. Every function returns an
//! error text that names what it read, never a secret.

use std::collections::BTreeMap;
use std::fmt;

use blake2b_simd::Params;
use serde::de::{self, DeserializeOwned, Deserializer, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value};

/// Bytes of lower or upper case hex. An odd length or a non-hex digit is an error.
pub fn unhex(text: &str, what: &str) -> Result<Vec<u8>, String> {
    if !text.len().is_multiple_of(2) || !text.is_ascii() {
        return Err(format!("bad {what}: hex needs an even number of digits"));
    }
    let digit = |pair: &[u8]| -> Option<u8> {
        let value = |c: u8| char::from(c).to_digit(16);
        let (high, low) = (value(*pair.first()?)?, value(*pair.get(1)?)?);
        u8::try_from(high * 16 + low).ok()
    };
    text.as_bytes()
        .chunks(2)
        .map(|pair| digit(pair).ok_or_else(|| format!("bad {what}: not a hex digit")))
        .collect()
}

/// Exactly `N` bytes of hex.
pub fn unhex_array<const N: usize>(text: &str, what: &str) -> Result<[u8; N], String> {
    unhex(text, what)?
        .try_into()
        .map_err(|_| format!("bad {what}: need {N} bytes"))
}

/// Base64url without padding (RFC 4648 section 5).
pub fn base64url(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let packed = chunk.iter().fold(0u32, |acc, b| acc << 8 | u32::from(*b));
        let word = packed << (8 * (3 - chunk.len()));
        for index in 0..=chunk.len() {
            let sextet = usize::try_from((word >> (18 - 6 * index)) & 63).unwrap_or(0);
            out.extend(ALPHABET.get(sextet).map(|c| char::from(*c)));
        }
    }
    out
}

/// A JSON value that refuses an object with one key twice, at any depth. `serde_json` keeps the
/// last of two equal keys without a word, so a plain `Value` would hide the first.
struct Strict(Value);

struct StrictVisitor;

impl<'de> Visitor<'de> for StrictVisitor {
    type Value = Strict;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a JSON value")
    }

    fn visit_bool<E>(self, v: bool) -> Result<Strict, E> {
        Ok(Strict(Value::Bool(v)))
    }

    fn visit_i64<E>(self, v: i64) -> Result<Strict, E> {
        Ok(Strict(Value::from(v)))
    }

    fn visit_u64<E>(self, v: u64) -> Result<Strict, E> {
        Ok(Strict(Value::from(v)))
    }

    fn visit_f64<E: de::Error>(self, v: f64) -> Result<Strict, E> {
        let number = Number::from_f64(v).ok_or_else(|| E::custom("a number that is not finite"))?;
        Ok(Strict(Value::Number(number)))
    }

    fn visit_str<E>(self, v: &str) -> Result<Strict, E> {
        Ok(Strict(Value::String(v.to_owned())))
    }

    fn visit_unit<E>(self) -> Result<Strict, E> {
        Ok(Strict(Value::Null))
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Strict, A::Error> {
        let mut items = Vec::new();
        while let Some(Strict(item)) = seq.next_element()? {
            items.push(item);
        }
        Ok(Strict(Value::Array(items)))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Strict, A::Error> {
        let mut object = Map::new();
        while let Some((key, Strict(item))) = map.next_entry::<String, Strict>()? {
            if object.contains_key(&key) {
                return Err(de::Error::custom(format!(
                    "the key {key:?} is written twice"
                )));
            }
            object.insert(key, item);
        }
        Ok(Strict(Value::Object(object)))
    }
}

impl<'de> Deserialize<'de> for Strict {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(StrictVisitor)
    }
}

/// JSON text as a value. An object with one key twice, at any depth, is an error.
pub fn parse_strict(text: &str, what: &str) -> Result<Value, String> {
    serde_json::from_str::<Strict>(text)
        .map(|strict| strict.0)
        .map_err(|e| format!("bad {what}: {e}"))
}

/// Reads `{"1": X, "2": Y, ...}` in seat order. A key is a seat number, written once, in one
/// spelling: a literal repeat and `"1"` with `"01"` are both refused.
pub fn seat_map(json: &str, what: &str) -> Result<BTreeMap<u16, Value>, String> {
    let Value::Object(object) = parse_strict(json, what)? else {
        return Err(format!("{what} must be an object"));
    };
    let mut seats = BTreeMap::new();
    for (key, item) in object {
        let seat: u16 = key
            .parse()
            .map_err(|_| format!("bad seat {key} in {what}"))?;
        if seats.insert(seat, item).is_some() {
            return Err(format!("seat {key} twice in {what}"));
        }
    }
    Ok(seats)
}

/// `seat_map` for a map that must hold the seats 1 to n with n >= 2.
pub fn full_seat_map(json: &str, what: &str) -> Result<BTreeMap<u16, Value>, String> {
    let seats = seat_map(json, what)?;
    if seats.len() < 2 || !seats.keys().zip(1u16..).all(|(key, want)| *key == want) {
        return Err(format!(
            "{what} must hold the seats 1 to n, with n of 2 or more"
        ));
    }
    Ok(seats)
}

/// One field of a JSON object, as text.
pub fn text_of<'a>(object: &'a Value, key: &str, what: &str) -> Result<&'a str, String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{what} has no text field {key}"))
}

/// A JSON value as a typed frost object.
pub fn from_value<T: DeserializeOwned>(value: &Value, what: &str) -> Result<T, String> {
    serde_json::from_value(value.clone()).map_err(|e| format!("bad {what}: {e}"))
}

/// JSON text as a typed frost object. A key written twice, at any depth, is an error.
pub fn from_json<T: DeserializeOwned>(text: &str, what: &str) -> Result<T, String> {
    serde_json::from_value(parse_strict(text, what)?).map_err(|e| format!("bad {what}: {e}"))
}

/// A frost object as a JSON value.
pub fn to_value<T: Serialize>(item: &T, what: &str) -> Result<Value, String> {
    serde_json::to_value(item).map_err(|e| format!("cannot write {what}: {e}"))
}

/// BLAKE2b-256 with a 16-byte personalization over the concatenated parts.
pub fn blake2b_256(personal: &[u8; 16], parts: &[&[u8]]) -> [u8; 32] {
    let mut state = Params::new().hash_length(32).personal(personal).to_state();
    for part in parts {
        state.update(part);
    }
    let mut out = [0u8; 32];
    for (slot, byte) in out.iter_mut().zip(state.finalize().as_bytes()) {
        *slot = *byte;
    }
    out
}

/// Appends `u32le(len) || bytes`, so that a text of any length cannot run into the next field.
pub fn push_len_prefixed(buf: &mut Vec<u8>, bytes: &[u8]) -> Result<(), String> {
    let len = u32::try_from(bytes.len()).map_err(|_| "a value is too long to hash")?;
    buf.extend_from_slice(&len.to_le_bytes());
    buf.extend_from_slice(bytes);
    Ok(())
}
