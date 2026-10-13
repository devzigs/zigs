//! The personal account (CHAT.md section 5): one person's own Ironwood account, made from a random
//! seed. It has one signer, so it signs with its spend authorizing key and uses no FROST. This
//! module holds the keys, the rules that split a text into memos and join them again, and the
//! signature of a message transaction.

use orchard::{
    keys::{FullViewingKey, Scope, SpendAuthorizingKey, SpendingKey},
    primitives::redpallas::{self, SpendAuth},
};
use pczt::{
    roles::signer::{Error as SignError, Signer},
    Pczt,
};
use rand::{rngs::OsRng, RngCore};
use serde_json::{json, Value};
use zcash_protocol::consensus::Network;

use super::{
    address_of, chain::decode_ufvk, e, ensure, from_json, memo::MEMO_BYTES, network,
    pczt_from_b64, pczt_network, pczt_to_b64, receiver_address, rng, sighash, ufvk_text, R,
};

/// The seed is 32 random bytes, written as hexadecimal.
const SEED_HEX: usize = 64;
const MAX_PARTS: usize = 5;
const MAX_CHARS: usize = 2000;
/// The marker `(k/N) `, with one digit for k and one for N.
const MARKER_BYTES: usize = 6;

fn coin_type(net: Network) -> u32 {
    if net == Network::MainNetwork { 133 } else { 1 }
}

/// The spending key of account 0 (ZIP 32, path m/32'/coin'/0'). An error never holds the seed.
fn spending_key(seed: &str, net: Network) -> R<SpendingKey> {
    let bad = "The seed must be 64 hexadecimal characters.";
    ensure(seed.len() == SEED_HEX, bad)?;
    let bytes = hex::decode(seed).map_err(|_| bad.to_string())?;
    SpendingKey::from_zip32_seed(&bytes, coin_type(net), Default::default())
        .map_err(|_| "The seed gives no valid key.".to_string())
}

fn keys_of(seed: &str, net: Network) -> R<Value> {
    let fvk = FullViewingKey::from(&spending_key(seed, net)?);
    Ok(json!({"ufvk": ufvk_text(&fvk, net)?, "address": address_of(&fvk, net)?}))
}

/// A new account: `{"seed", "ufvk", "address"}`. The address is the public one, at index 0.
pub(crate) fn new_account(net: &str) -> R<String> {
    let net = network(net)?;
    let mut seed = [0u8; 32];
    OsRng.fill_bytes(&mut seed);
    let seed = hex::encode(seed);
    let mut out = keys_of(&seed, net)?;
    out["seed"] = json!(seed);
    Ok(out.to_string())
}

/// `{"ufvk", "address"}` of the account for `seed`.
pub(crate) fn keys(seed: &str, net: &str) -> R<String> {
    Ok(keys_of(seed, network(net)?)?.to_string())
}

/// The index argument that JavaScript gives `addressAt`: a whole number from 0 to 2^32 - 1. The
/// plain u32 conversion of wasm-bindgen turns `undefined`, -1 and 2^32 into other indexes, so a
/// missing contact index would give away the public address.
pub(crate) fn index_of(value: Option<f64>) -> R<u32> {
    let bad = "The address index must be a whole number from 0 to 4294967295.";
    let whole = |n: &f64| n.fract() == 0.0 && (0.0..=f64::from(u32::MAX)).contains(n);
    value.filter(whole).map(|n| n as u32).ok_or_else(|| bad.to_string())
}

/// The address of the viewing key `ufvk` at a diversifier index: the Orchard receiver only.
pub(crate) fn address_at(ufvk: &str, index: u32) -> R<String> {
    let (net, key) = decode_ufvk(ufvk)?;
    let fvk = key.orchard().ok_or("the viewing key has no Orchard component")?;
    receiver_address(fvk.address_at(index, Scope::External), net)
}

/// The memo texts of a message. A text of at most 512 bytes is one memo. A longer text goes into
/// parts with the marker `(k/N) ` in front, each part of at most 512 bytes, cut only between
/// characters.
pub(crate) fn split(text: &str) -> R<Vec<String>> {
    ensure(!text.is_empty(), "The message is empty.")?;
    ensure(!text.contains('\0'), "The message cannot contain a null character.")?;
    let chars = text.chars().count();
    let long = format!("The message has {chars} characters. The limit is {MAX_CHARS}.");
    ensure(chars <= MAX_CHARS, &long)?;
    if text.len() <= MEMO_BYTES {
        return Ok(vec![text.to_string()]);
    }
    let parts = chunks(text, MEMO_BYTES - MARKER_BYTES);
    let most = format!("The message needs more than {MAX_PARTS} parts. Make it shorter.");
    ensure(parts.len() <= MAX_PARTS, &most)?;
    let n = parts.len();
    Ok(parts.iter().enumerate().map(|(k, part)| format!("({}/{n}) {part}", k + 1)).collect())
}

/// `split` as a JSON list of memo texts.
pub(crate) fn split_message(text: &str) -> R<String> {
    split(text).map(|parts| json!(parts).to_string())
}

/// Pieces of at most `size` bytes, each one cut at a character boundary.
fn chunks(text: &str, size: usize) -> Vec<&str> {
    let (mut out, mut rest) = (vec![], text);
    while !rest.is_empty() {
        let mut end = size.min(rest.len());
        while !rest.is_char_boundary(end) {
            end -= 1;
        }
        let (head, tail) = rest.split_at(end);
        out.push(head);
        rest = tail;
    }
    out
}

/// A marker `(k/N) ` at the start of `memo`: k and N are one digit each, N is 2 to 5, and k is 1
/// to N. Returns k, N and the rest of the memo. A digit string such as `+1` or `01` is no marker.
fn marker(memo: &str) -> Option<(usize, usize, &str)> {
    let b = memo.as_bytes();
    let digit = |i: usize| {
        let c = b.get(i).filter(|c| (b'1'..=b'5').contains(c))?;
        Some(usize::from(c - b'0'))
    };
    let (k, n) = (digit(1)?, digit(3)?);
    let shape = b.len() >= MARKER_BYTES && (b[0], b[2], b[4], b[5]) == (b'(', b'/', b')', b' ');
    (shape && k <= n && n >= 2).then(|| (k, n, &memo[MARKER_BYTES..]))
}

/// The message in `memos`, or None. One memo without a marker is the message. Else the memos must
/// carry the markers 1 to N of N, each once, in any order.
fn join(memos: &[String]) -> Option<String> {
    if let [one] = memos {
        return marker(one).is_none().then(|| one.clone());
    }
    let mut parts: Vec<Option<&str>> = vec![None; memos.len()];
    for memo in memos {
        let (k, n, text) = marker(memo)?;
        if n != memos.len() || parts[k - 1].replace(text).is_some() {
            return None;
        }
    }
    parts.into_iter().collect::<Option<Vec<_>>>().filter(|p| !p.is_empty()).map(|p| p.concat())
}

/// `memos` is a JSON list of memo texts. The result is `{"text": <message or null>}`.
pub(crate) fn join_message(memos: &str) -> R<String> {
    let memos: Vec<String> = from_json(memos, "memo list")?;
    Ok(json!({ "text": join(&memos) }).to_string())
}

/// The actions of the Ironwood bundle whose spend has no signature yet. The builder signed its
/// dummy spends, so these are the real ones.
fn unsigned_spends(p: &Pczt) -> Vec<usize> {
    let actions = p.ironwood().actions().iter().enumerate();
    actions.filter(|(_, a)| a.spend().spend_auth_sig().is_none()).map(|(i, _)| i).collect()
}

fn sign_error(err: SignError) -> String {
    match err {
        SignError::IronwoodSign(orchard::pczt::SignerError::WrongSpendAuthorizingKey) => {
            "This seed does not own the notes that the transaction spends.".to_string()
        }
        other => format!("Signing failed: {other:?}"),
    }
}

/// Checks the signature of each spend in `indices` under the `rk` of its action.
fn check_signatures(p: &Pczt, indices: &[usize], sighash: &[u8; 32]) -> R<()> {
    for &i in indices {
        let spend = p.ironwood().actions()[i].spend();
        let sig = spend.spend_auth_sig().ok_or("A spend has no signature.")?;
        let rk = redpallas::VerificationKey::<SpendAuth>::try_from(*spend.rk())
            .map_err(|_| "A spend has a bad rk.")?;
        rk.verify(sighash, &redpallas::Signature::<SpendAuth>::from(sig))
            .map_err(|_| "A signature does not verify under its rk.")?;
    }
    Ok(())
}

/// Signs every real Ironwood spend of `pczt` with the account of `seed`. The signer checks the
/// key against `rk`. Dummy spends keep the signature that the builder made. `finalize` proves and
/// extracts the result. Returns `{"signed_pczt"}`.
pub(crate) fn sign(pczt: &str, seed: &str, net: &str) -> R<String> {
    let net = network(net)?;
    let ask = SpendAuthorizingKey::from(&spending_key(seed, net)?);
    let p = pczt_from_b64(pczt)?;
    ensure(pczt_network(&p)? == net, "The transaction is for another network.")?;
    let (_, h) = sighash(&p)?;
    let todo = unsigned_spends(&p);
    ensure(!todo.is_empty(), "The transaction has no spend to sign.")?;
    let mut signer = Signer::new(p).map_err(e("signer"))?;
    for &i in &todo {
        signer.sign_ironwood(rng(), i, &ask).map_err(sign_error)?;
    }
    let signed = signer.finish();
    check_signatures(&signed, &todo, &h)?;
    Ok(json!({"signed_pczt": pczt_to_b64(signed)?}).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }

    fn fvk_bytes(ufvk: &str) -> [u8; 96] {
        decode_ufvk(ufvk).unwrap().1.orchard().unwrap().to_bytes()
    }

    #[test]
    fn keys_are_deterministic_and_differ_by_network() {
        let seed = "0a".repeat(32);
        let (a, b) = (keys(&seed, "testnet").unwrap(), keys(&seed, "testnet").unwrap());
        assert_eq!(a, b);
        let main = v(&keys(&seed, "mainnet").unwrap());
        let test = v(&a);
        let (main_key, test_key) = (main["ufvk"].as_str().unwrap(), test["ufvk"].as_str().unwrap());
        assert!(main_key.starts_with("uview1") && test_key.starts_with("uviewtest1"));
        assert_ne!(fvk_bytes(main_key), fvk_bytes(test_key), "coin type 133 or 1 changes the key");
        let raw = |ua: &Value| normalize_raw(ua.as_str().unwrap());
        assert_ne!(raw(&main["address"]), raw(&test["address"]));
        let other = keys(&"0b".repeat(32), "testnet").unwrap();
        assert_ne!(fvk_bytes(v(&other)["ufvk"].as_str().unwrap()), fvk_bytes(test_key));
    }

    fn normalize_raw(ua: &str) -> [u8; 43] {
        let test = ua.starts_with("utest1");
        let net = if test { Network::TestNetwork } else { Network::MainNetwork };
        super::super::chain::parse_recipient(ua, net).unwrap().to_raw_address_bytes()
    }

    /// The addresses of a fixed seed. A change of the derivation would cut a person off from the
    /// funds of an account, so it must break this test.
    #[test]
    fn the_derivation_of_a_fixed_seed_does_not_change() {
        let seed: String = (0..32).map(|i| format!("{i:02x}")).collect();
        let main = v(&keys(&seed, "mainnet").unwrap());
        let test = v(&keys(&seed, "testnet").unwrap());
        assert_eq!(main["address"], MAIN_ADDRESS);
        assert_eq!(test["address"], TEST_ADDRESS);
        let fvk = decode_ufvk(test["ufvk"].as_str().unwrap()).unwrap().1.orchard().unwrap().clone();
        let sk = SpendingKey::from_zip32_seed(&hex::decode(&seed).unwrap(), 1, Default::default());
        assert_eq!(fvk, FullViewingKey::from(&sk.unwrap()), "ZIP 32 path m/32'/1'/0'");
    }

    #[test]
    fn a_new_account_matches_its_seed() {
        let made = v(&new_account("testnet").unwrap());
        let seed = made["seed"].as_str().unwrap();
        assert_eq!(seed.len(), 64);
        let again = v(&keys(seed, "testnet").unwrap());
        assert_eq!((&made["ufvk"], &made["address"]), (&again["ufvk"], &again["address"]));
        assert_ne!(made["seed"], v(&new_account("testnet").unwrap())["seed"]);
        assert!(v(&new_account("mainnet").unwrap())["address"].as_str().unwrap().starts_with("u1"));
        assert!(new_account("regtest").unwrap_err().contains("network"));
    }

    #[test]
    fn a_seed_must_be_64_hex_characters_and_never_shows_in_an_error() {
        let secret = format!("{}zz", "ab".repeat(31));
        for bad in ["", "0a", &"0a".repeat(31), &"0a".repeat(33), &secret, &"é".repeat(32)] {
            let err = keys(bad, "testnet").unwrap_err();
            assert!(err.contains("64 hexadecimal"), "{err}");
            assert!(bad.is_empty() || !err.contains(bad));
        }
        assert!(keys(&"AB".repeat(32), "testnet").is_ok(), "capital letters are hex too");
        assert!(keys(&"0a".repeat(32), "regtest").is_err());
        let err = sign("AAAA", &secret, "testnet").unwrap_err();
        assert!(err.contains("64 hexadecimal") && !err.contains("zz"), "{err}");
    }

    #[test]
    fn an_address_comes_from_the_viewing_key_and_an_index() {
        let seed = "0a".repeat(32);
        let account = v(&keys(&seed, "testnet").unwrap());
        let ufvk = account["ufvk"].as_str().unwrap();
        assert_eq!(address_at(ufvk, 0).unwrap(), account["address"].as_str().unwrap());
        let (one, seven) = (address_at(ufvk, 1).unwrap(), address_at(ufvk, 7).unwrap());
        assert_ne!(one, seven);
        assert_ne!(one, address_at(ufvk, 0).unwrap());
        assert_eq!(seven, address_at(ufvk, 7).unwrap());
        assert!(address_at(&one, 0).is_err(), "an address is no viewing key");
        let main = v(&keys(&seed, "mainnet").unwrap());
        assert!(address_at(main["ufvk"].as_str().unwrap(), u32::MAX).unwrap().starts_with("u1"));
        let chain_error = address_at("nope", 0).unwrap_err();
        assert!(chain_error.contains("bad viewing key"), "{chain_error}");
    }

    #[test]
    fn an_address_index_from_javascript_is_a_whole_number_of_32_bits() {
        for good in [0.0, -0.0, 1.0, 7.0, 4_294_967_295.0] {
            assert_eq!(index_of(Some(good)).unwrap(), good as u32);
        }
        let bad = [None, Some(-1.0), Some(4_294_967_296.0), Some(1.5), Some(f64::NAN)];
        for value in bad.into_iter().chain([Some(f64::INFINITY), Some(f64::NEG_INFINITY)]) {
            assert!(index_of(value).unwrap_err().contains("whole number"), "{value:?}");
        }
    }

    fn texts(parts: &[String]) -> String {
        json!(parts).to_string()
    }

    fn round_trip(text: &str) -> Vec<String> {
        let parts = split(text).unwrap();
        for part in &parts {
            assert!(part.len() <= 512, "{} bytes", part.len());
        }
        let joined = v(&join_message(&texts(&parts)).unwrap());
        assert_eq!(joined["text"], text, "split then join gives the text back");
        parts
    }

    #[test]
    fn a_message_of_512_bytes_is_one_part_and_513_bytes_are_two() {
        let one = round_trip(&"a".repeat(512));
        assert_eq!(one, ["a".repeat(512)], "one part has no marker");
        let two = round_trip(&"a".repeat(513));
        assert_eq!(two.len(), 2);
        assert_eq!(two[0], format!("(1/2) {}", "a".repeat(506)));
        assert_eq!(two[1], format!("(2/2) {}", "a".repeat(7)));
        assert_eq!(round_trip("hello"), ["hello"]);
    }

    #[test]
    fn a_four_byte_character_is_never_cut() {
        // 505 bytes, then a character of 4 bytes that does not fit in the 506 bytes of the part.
        let text = format!("{}{}", "a".repeat(505), "😀".repeat(3));
        let parts = round_trip(&text);
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0], format!("(1/2) {}", "a".repeat(505)));
        assert_eq!(parts[1], "(2/2) 😀😀😀");
        // The boundary falls inside the character at every offset.
        for pad in 502..507 {
            round_trip(&format!("{}{}", "a".repeat(pad), "😀".repeat(40)));
        }
    }

    #[test]
    fn a_message_has_at_most_5_parts_and_2000_characters() {
        let five = round_trip(&"é".repeat(1265));
        assert_eq!(five.len(), 5);
        assert!(five.iter().all(|p| p.len() == 512), "253 letters of 2 bytes and the marker");
        let six = split(&"é".repeat(1266)).unwrap_err();
        assert_eq!(six, "The message needs more than 5 parts. Make it shorter.");
        assert_eq!(round_trip(&"a".repeat(2000)).len(), 4);
        let long = split(&"a".repeat(2001)).unwrap_err();
        assert_eq!(long, "The message has 2001 characters. The limit is 2000.");
        // A character counts once, whatever its size. 700 emoji are 2,800 bytes: too many parts.
        assert!(split(&"😀".repeat(700)).unwrap_err().contains("more than 5 parts"));
        assert_eq!(round_trip(&"😀".repeat(600)).len(), 5);
    }

    #[test]
    fn an_empty_text_and_a_null_character_are_refused() {
        assert_eq!(split("").unwrap_err(), "The message is empty.");
        let nul = "The message cannot contain a null character.";
        assert_eq!(split("a\0b").unwrap_err(), nul);
        assert_eq!(split(&format!("{}\0", "a".repeat(600))).unwrap_err(), nul);
        assert!(split(" ").is_ok(), "white space is text");
    }

    #[test]
    fn a_text_that_looks_like_a_marker_comes_back_whole() {
        for text in ["(1/1) hi", "(2/2) x", "(1/2) hello"] {
            assert_eq!(split(text).unwrap(), [text]);
        }
        // One memo that carries a marker is no message: the reader shows it as it is.
        assert_eq!(v(&join_message(r#"["(1/1) hi"]"#).unwrap())["text"], "(1/1) hi");
        assert_eq!(v(&join_message(r#"["(1/2) hello"]"#).unwrap())["text"], Value::Null);
        let long = format!("(2/3) {}", "a".repeat(600));
        let parts = round_trip(&long);
        assert!(parts[0].starts_with("(1/2) (2/3) "), "the real marker goes first");
    }

    fn join_of(memos: &[&str]) -> Value {
        v(&join_message(&json!(memos).to_string()).unwrap())["text"].clone()
    }

    #[test]
    fn parts_join_in_any_order_and_fake_markers_give_null() {
        assert_eq!(join_of(&["(2/3) b", "(3/3) c", "(1/3) a"]), "abc");
        assert_eq!(join_of(&["(3/3) c", "(1/3) a", "(2/3) b"]), "abc");
        assert_eq!(join_of(&["(2/2) é", "(1/2) 😀"]), "😀é");
        assert_eq!(join_of(&["plain"]), "plain");
        assert_eq!(join_of(&[]), Value::Null, "no memo, no message");
        let null = Value::Null;
        assert_eq!(join_of(&["(1/2) a", "(1/2) b"]), null, "a duplicate marker");
        assert_eq!(join_of(&["(1/2) a", "(2/2) b", "(2/2) c"]), null, "a marker too many");
        assert_eq!(join_of(&["(1/3) a", "(2/3) b"]), null, "a part is missing");
        assert_eq!(join_of(&["(1/2) a", "(2/3) b"]), null, "two different totals");
        assert_eq!(join_of(&["(1/2) a", "plain"]), null, "a memo without a marker");
        assert_eq!(join_of(&["plain", "other"]), null, "two memos and no marker");
        assert_eq!(join_of(&["(0/2) a", "(2/2) b"]), null, "k starts at 1");
        assert_eq!(join_of(&["(3/2) a", "(2/2) b"]), null, "k is at most N");
        assert_eq!(join_of(&["(+1/2) a", "(2/2) b"]), null, "a plus sign is no digit");
        assert_eq!(join_of(&["(01/2) a", "(2/2) b"]), null, "no leading zero");
        assert_eq!(join_of(&["(1/02) a", "(2/02) b"]), null, "no leading zero");
        assert_eq!(join_of(&["(1/2)a", "(2/2)b"]), null, "the space is part of the marker");
        assert_eq!(join_of(&["(1/2)  a", "(2/2) b"]), " ab", "the marker takes one space only");
        let six: Vec<String> = (1..=6).map(|k| format!("({k}/6) x")).collect();
        assert_eq!(v(&join_message(&texts(&six)).unwrap())["text"], null, "N is at most 5");
    }

    #[test]
    fn a_memo_list_must_be_a_list_of_texts() {
        for bad in ["", "{}", "\"a\"", "[1]", "[[\"a\"]]", "[null]"] {
            assert!(join_message(bad).unwrap_err().contains("memo list"), "{bad}");
        }
    }

    const MAIN_ADDRESS: &str = concat!(
        "u18a5uxx3zvkr4xv8ncx562gppvr2z4ymxw8hu5qv7dxnmuwnh729756fwaxh7ay0zstlc6t0v3t92ya3n63jp4t",
        "ktngnlk5gnfutgk5q6",
    );
    const TEST_ADDRESS: &str = concat!(
        "utest1v2umnp56lw2dv93war47f6ag3n5jgp2h9vgv2vvvtxlgygqmmfx6zw0vm6x5fgkj8t6futl7gpnup3xvh",
        "chz7dty4elzqkx03ucy87d3",
    );
}
