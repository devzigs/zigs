//! Payment requests (ZIP 321): a `zcash:` URI that asks for one or more payments. The `zip321`
//! crate reads and writes the text. This module adds the rules of Zigs: the network, at most 20
//! payees, and memos that are ZIP 302 text. A request that passes can fill the Send form.
//!
//! A payee is named by its index in the URI plus one: the payee with no suffix is 1, the one with
//! the suffix `.1` is 2.

use serde_json::{json, Value};
use zcash_keys::address::Address;
use zcash_protocol::{consensus::Network, memo::MemoBytes, value::Zatoshis};
use zip321::{memo_from_base64, Payment, TransactionRequest, Zip321Error};

use super::{
    chain::MAX_PAYEES,
    ensure, from_json,
    memo::{parse_memo, MemoView},
    R,
};

fn request_net(s: &str) -> R<Network> {
    match s {
        "main" => Ok(Network::MainNetwork),
        "test" => Ok(Network::TestNetwork),
        _ => Err("network must be main or test".to_string()),
    }
}

fn net_name(net: Network) -> &'static str {
    if net == Network::MainNetwork { "mainnet" } else { "testnet" }
}

/// `{"payees": [{"to", "amount", "memo", "label", "message"}, …]}`. `amount` is in zatoshis, and
/// null when the payer chooses it. A zero amount is an error. A key without a value is null.
/// Errors name the payee.
pub(crate) fn parse_request(uri: &str, net: &str) -> R<String> {
    let net = request_net(net)?;
    let request = TransactionRequest::from_uri(uri).map_err(|err| uri_error(uri, err))?;
    let count = request.payments().len();
    ensure(count > 0, "the request has no payee")?;
    let most = format!("a request can have at most {MAX_PAYEES} payees; this one has {count}");
    ensure(count <= MAX_PAYEES, &most)?;
    let payees = request
        .payments()
        .iter()
        .map(|(&i, payment)| payee_json(i + 1, payment, net))
        .collect::<R<Vec<_>>>()?;
    Ok(json!({ "payees": payees }).to_string())
}

fn payee_json(n: usize, payment: &Payment, net: Network) -> R<Value> {
    let to = payment.recipient_address().encode();
    check_address(n, &to, net)?;
    let amount = payment.amount().map(u64::from);
    ensure(amount != Some(0), &format!("payee {n}: the amount is zero"))?;
    Ok(json!({
        "to": to,
        "amount": amount,
        "memo": memo_text(n, payment)?,
        "label": payment.label(),
        "message": payment.message(),
    }))
}

/// The address must belong to `net`. The error tells a wrong network from an unknown address.
fn check_address(n: usize, to: &str, net: Network) -> R<()> {
    if Address::decode(&net, to).is_some() {
        return Ok(());
    }
    let other = [Network::MainNetwork, Network::TestNetwork].into_iter().find(|&n| n != net);
    let why = if other.is_some_and(|n| Address::decode(&n, to).is_some()) {
        format!("is not a {} address", net_name(net))
    } else {
        "is not an address that Zigs can read".to_string()
    };
    Err(format!("payee {n}: the address {why}"))
}

/// The memo of a payee as text, or None for no memo. Binary memos and memos that the Send form
/// would refuse are errors, so a request that parses can always fill a row of the form.
fn memo_text(n: usize, payment: &Payment) -> R<Option<String>> {
    let Some(memo) = payment.memo() else { return Ok(None) };
    match MemoView::of(memo.as_array()) {
        MemoView::Empty => Ok(None),
        MemoView::NotText => Err(format!("payee {n}: the memo is not text")),
        MemoView::Text(text) => parse_memo(&json!(text))
            .map(|_| Some(text))
            .map_err(|err| format!("payee {n}: {err}")),
    }
}

const KNOWN_PARAMS: [&str; 5] = ["address", "amount", "memo", "label", "message"];

/// The words for an error of the crate. Its parse errors hold internal text, so they get one fixed
/// sentence, except a bad memo, which `bad_memo` finds.
fn uri_error(uri: &str, err: Zip321Error) -> String {
    match err {
        Zip321Error::TransparentMemo(i) => {
            format!("payee {}: a transparent address cannot receive a memo", i + 1)
        }
        Zip321Error::ZeroValuedTransparentOutput(i) => {
            format!("payee {}: a transparent address cannot receive zero", i + 1)
        }
        Zip321Error::RecipientMissing(i) => format!("payee {}: the address is missing", i + 1),
        Zip321Error::DuplicateParameter(param, i) => {
            // Any other name is text from the sender, so it stays out of the error.
            let name = param.name();
            let what = if KNOWN_PARAMS.contains(&name.as_str()) {
                format!("the parameter {name}")
            } else {
                "a parameter".to_string()
            };
            format!("payee {}: {what} appears twice", i + 1)
        }
        _ => bad_memo(uri).unwrap_or_else(|| "this is not a valid ZIP 321 request".to_string()),
    }
}

/// The index of a name such as `memo.12`. ZIP 321 allows a digit from 1 to 9 and up to 3 more
/// digits. Any other suffix is not a payee index, and the crate refuses it too.
fn payee_suffix(suffix: &str) -> Option<usize> {
    let digits = suffix.strip_prefix('.')?;
    let shape = digits.len() <= 4 && !digits.starts_with('0');
    (shape && digits.bytes().all(|b| b.is_ascii_digit())).then_some(digits)?.parse().ok()
}

/// The crate reports a `memo` parameter that is not base64url of at most 512 bytes as a general
/// parse error. This finds the first such parameter and names its payee.
fn bad_memo(uri: &str) -> Option<String> {
    let query = uri.split_once('?')?.1;
    query.split('&').find_map(|pair| {
        let (name, value) = pair.split_once('=')?;
        let index = match name.strip_prefix("memo")? {
            "" => 0,
            suffix => payee_suffix(suffix)?,
        };
        memo_from_base64(value).err()?;
        let what = "the memo is not base64url text of at most 512 bytes";
        Some(format!("payee {}: {what}", index + 1))
    })
}

/// The URI for `[{"to", "amount"?, "memo"?, "message"?}, …]`. `amount` is in zatoshis; without it
/// the payer chooses. The addresses must belong to `net`. Errors name the payee, from 1.
pub(crate) fn make_request(payees: &str, net: &str) -> R<String> {
    let net = request_net(net)?;
    let rows: Vec<Value> = from_json(payees, "payee list")?;
    ensure(!rows.is_empty(), "add at least one payee")?;
    ensure(rows.len() <= MAX_PAYEES, &format!("a request can have at most {MAX_PAYEES} payees"))?;
    let payments = rows
        .iter()
        .enumerate()
        .map(|(i, row)| make_payment(i + 1, row, net))
        .collect::<R<Vec<_>>>()?;
    let request = TransactionRequest::new(payments).map_err(|err| uri_error("", err))?;
    Ok(request.to_uri())
}

fn make_payment(n: usize, row: &Value, net: Network) -> R<Payment> {
    let to = row["to"].as_str().ok_or(format!("payee {n}: missing address"))?.trim();
    check_address(n, to, net)?;
    let memo = parse_memo(&row["memo"]).map_err(|err| format!("payee {n}: {err}"))?;
    let memo = (memo != MemoBytes::empty()).then_some(memo);
    // The address string stays as the caller wrote it, so the URI holds the same text.
    let address = to.parse().map_err(|_| format!("payee {n}: the address is not valid"))?;
    let (amount, message) = (make_amount(n, &row["amount"])?, make_message(n, row)?);
    Payment::new(address, amount, memo, None, message, vec![])
        .map_err(|err| uri_error("", err.with_index(n - 1)))
}

fn make_amount(n: usize, v: &Value) -> R<Option<Zatoshis>> {
    if v.is_null() {
        return Ok(None);
    }
    let zat = v.as_u64().filter(|&z| z > 0).and_then(|z| Zatoshis::from_u64(z).ok());
    let rule = "the amount must be a whole number of zatoshis, above zero, at most 21 million ZEC";
    zat.map(Some).ok_or(format!("payee {n}: {rule}"))
}

fn make_message(n: usize, row: &Value) -> R<Option<String>> {
    match &row["message"] {
        Value::Null => Ok(None),
        Value::String(s) => Ok((!s.is_empty()).then(|| s.clone())),
        _ => Err(format!("payee {n}: the message must be text")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64URL, Engine};
    use orchard::keys::{FullViewingKey, Scope, SpendingKey};
    use zcash_keys::address::UnifiedAddress;

    const TEST: Network = Network::TestNetwork;
    const MAIN: Network = Network::MainNetwork;
    const FIXED: &str = "this is not a valid ZIP 321 request";
    const AMOUNT_RULE: &str =
        "the amount must be a whole number of zatoshis, above zero, at most 21 million ZEC";

    fn ua(seed: u8, net: Network) -> String {
        let sk = Option::<SpendingKey>::from(SpendingKey::from_bytes([seed; 32])).unwrap();
        let receiver = FullViewingKey::from(&sk).address_at(0u32, Scope::External);
        UnifiedAddress::from_receivers(Some(receiver), None, None, None, None).unwrap().encode(&net)
    }

    fn memo64(bytes: &[u8]) -> String {
        B64URL.encode(bytes)
    }

    /// The `payees` list that `parse_request` returns.
    fn parse(uri: &str, net: &str) -> Vec<Value> {
        let out: Value = serde_json::from_str(&parse_request(uri, net).unwrap()).unwrap();
        out["payees"].as_array().unwrap().clone()
    }

    fn refused(uri: &str, net: &str) -> String {
        parse_request(uri, net).unwrap_err()
    }

    fn make_err(rows: Value) -> String {
        make_request(&rows.to_string(), "test").unwrap_err()
    }

    #[test]
    fn a_request_round_trips() {
        let to = ua(1, TEST);
        let row =
            json!({"to": to, "amount": 150_000_000u64, "memo": "October rent", "message": "Hi"});
        let uri = make_request(&json!([row]).to_string(), "test").unwrap();
        assert!(uri.starts_with(&format!("zcash:{to}?amount=1.5&memo=")), "{uri}");
        let want = json!({"to": to, "amount": 150_000_000u64, "memo": "October rent",
            "label": null, "message": "Hi"});
        let got = parse(&uri, "test");
        assert_eq!(got, [want]);
        assert_eq!(make_request(&json!(got).to_string(), "test").unwrap(), uri);
    }

    #[test]
    fn several_payees_keep_their_order() {
        let (a, b, c) = (ua(1, TEST), ua(2, TEST), ua(3, TEST));
        let rows = json!([{"to": a, "amount": 1}, {"to": b}, {"to": c, "amount": 7, "memo": "é"}]);
        let uri = make_request(&rows.to_string(), "test").unwrap();
        assert!(uri.starts_with("zcash:?address="), "{uri}");
        let payees = parse(&uri, "test");
        let field = |k: &str| payees.iter().map(|p| p[k].clone()).collect::<Vec<_>>();
        assert_eq!(field("to"), [json!(a), json!(b), json!(c)]);
        assert_eq!(field("amount"), [json!(1), json!(null), json!(7)]);
        assert_eq!(field("memo"), [json!(null), json!(null), json!("é")]);
    }

    #[test]
    fn the_amount_can_be_left_out() {
        let to = ua(1, TEST);
        let amount = |q: &str| parse(&format!("zcash:{to}{q}"), "test")[0]["amount"].clone();
        assert_eq!(amount(""), json!(null));
        assert_eq!(amount("?amount=0.00000001"), 1);
        assert_eq!(amount("?amount=21000000"), 21_000_000u64 * 100_000_000);
        assert_eq!(refused(&format!("zcash:{to}?amount=21000000.00000001"), "test"), FIXED);
        let twice = refused(&format!("zcash:{to}?amount=1&amount=2"), "test");
        assert_eq!(twice, "payee 1: the parameter amount appears twice");
    }

    #[test]
    fn a_zero_amount_is_refused() {
        let (a, b) = (ua(1, TEST), ua(2, TEST));
        for zero in ["0", "0.0", "0.00000000"] {
            let one = refused(&format!("zcash:{a}?amount={zero}"), "test");
            assert_eq!(one, "payee 1: the amount is zero", "{zero}");
            let two = format!("zcash:?address={a}&amount=1&address.1={b}&amount.1={zero}");
            let second = refused(&two, "test");
            assert_eq!(second, "payee 2: the amount is zero", "{zero}");
        }
        assert_eq!(parse(&format!("zcash:{a}?amount=0.00000001"), "test")[0]["amount"], 1);
    }

    #[test]
    fn a_repeated_parameter_is_named_only_when_known() {
        let to = ua(1, TEST);
        let twice = |name: &str| refused(&format!("zcash:{to}?{name}=1&{name}=2"), "test");
        for name in ["amount", "message", "label", "memo"] {
            let want = format!("payee 1: the parameter {name} appears twice");
            let value = if name == "memo" { memo64(b"hi") } else { "1".to_string() };
            let uri = format!("zcash:{to}?{name}={value}&{name}={value}");
            assert_eq!(refused(&uri, "test"), want);
        }
        let hostile = "x-Verified+by+your+signers";
        assert_eq!(twice(hostile), "payee 1: a parameter appears twice");
        let second = format!("zcash:?address={to}&x-a.1=1&address.1={to}&x-a.1=2");
        assert_eq!(refused(&second, "test"), "payee 2: a parameter appears twice");
    }

    #[test]
    fn a_memo_must_be_text() {
        let to = ua(1, TEST);
        let with = |memo: &[u8]| format!("zcash:{to}?memo={}", memo64(memo));
        let memo = |memo: &[u8]| parse(&with(memo), "test")[0]["memo"].clone();
        assert_eq!(memo("café ✓".as_bytes()), "café ✓");
        assert_eq!(memo(&[0xF6]), json!(null), "0xF6 is no memo");
        assert!(memo("a".repeat(512).as_bytes()).is_string());
        let not_text = "payee 1: the memo is not text";
        assert_eq!(refused(&with(&[0xFF, 1, 2]), "test"), not_text);
        assert_eq!(refused(&with(&[0xF7, b'a']), "test"), not_text);
        assert_eq!(refused(&with(&[b'a', 0xC3]), "test"), not_text);
        let nul = "payee 1: the memo cannot contain a null character";
        assert_eq!(refused(&with(b"a\0b"), "test"), nul);
    }

    #[test]
    fn a_bad_memo_names_its_payee() {
        let (a, b) = (ua(1, TEST), ua(2, TEST));
        let two = |memo: &str| format!("zcash:?address={a}&address.1={b}&memo.1={memo}");
        let want = "payee 2: the memo is not base64url text of at most 512 bytes";
        assert_eq!(refused(&two("!!!"), "test"), want);
        assert_eq!(refused(&two("a"), "test"), want, "one character is not base64");
        assert_eq!(refused(&two(&memo64(&[b'a'; 513])), "test"), want, "513 bytes");
        let first = refused(&format!("zcash:{a}?memo=%%%"), "test");
        assert!(first.starts_with("payee 1: the memo is not base64url"), "{first}");
        let last = refused(&format!("zcash:{a}?memo.9999=!!!"), "test");
        assert!(last.starts_with("payee 10000: the memo is not base64url"), "{last}");
        // A suffix that ZIP 321 does not allow is no payee index. These must not wrap or panic.
        let suffixes = ["0", "01", "10000", "2147483647", "4294967295", "4294967296"];
        for suffix in suffixes.into_iter().chain(["18446744073709551615", "+5", "-1", "", "1x"]) {
            let uri = format!("zcash:{a}?memo.{suffix}=!!!");
            assert_eq!(refused(&uri, "test"), FIXED, "memo.{suffix}");
        }
    }

    #[test]
    fn the_network_must_match() {
        let (test, main) = (ua(1, TEST), ua(1, MAIN));
        assert_eq!(parse(&format!("zcash:{main}"), "main")[0]["to"], main);
        let wrong = refused(&format!("zcash:{test}"), "main");
        assert_eq!(wrong, "payee 1: the address is not a mainnet address");
        let second = refused(&format!("zcash:?address={test}&address.1={main}"), "test");
        assert_eq!(second, "payee 2: the address is not a testnet address");
        assert_eq!(refused(&format!("zcash:{}", test.replace("utest1", "utest2")), "test"), FIXED);
        for net in ["mainnet", "testnet", "regtest", ""] {
            assert_eq!(refused("zcash:x", net), "network must be main or test");
        }
    }

    #[test]
    fn the_zip_321_example_reads() {
        // A Sapling address is on the network, so the request passes. The Send form refuses it.
        let sapling = concat!(
            "ztestsapling10yy2ex5dcqkclhc7z7yrnjq2z6feyjad56ptwlfgmy77d",
            "maqqrl9gyhprdx59qgmsnyfska2kez"
        );
        let query = "amount=1&memo=VGhpcyBpcyBhIHNpbXBsZSBtZW1vLg&message=Thanks";
        let uri = format!("zcash:{sapling}?{query}");
        let p = &parse(&uri, "test")[0];
        let got = (p["to"].as_str(), p["amount"].as_u64(), p["memo"].as_str());
        assert_eq!(got, (Some(sapling), Some(100_000_000), Some("This is a simple memo.")));
        assert_eq!(refused(&uri, "main"), "payee 1: the address is not a mainnet address");
    }

    #[test]
    fn at_most_twenty_payees() {
        let uri = |n: u8| {
            let payments = (1..=n)
                .map(|i| make_payment(1, &json!({"to": ua(i, TEST), "amount": 1}), TEST).unwrap())
                .collect();
            TransactionRequest::new(payments).unwrap().to_uri()
        };
        assert_eq!(parse(&uri(20), "test").len(), 20);
        let err = refused(&uri(21), "test");
        assert_eq!(err, "a request can have at most 20 payees; this one has 21");
        let rows: Vec<Value> = (0..21).map(|_| json!({"to": ua(1, TEST)})).collect();
        assert_eq!(make_err(json!(rows)), "a request can have at most 20 payees");
    }

    #[test]
    fn a_transparent_address_takes_no_memo() {
        let (shielded, tex) = (ua(1, TEST), Address::Tex([3; 20]).encode(&TEST));
        let plain = parse(&format!("zcash:{tex}?amount=1"), "test");
        assert_eq!(plain[0]["to"], tex, "ZIP 321 allows it; the Send form refuses it");
        let memo = memo64(b"hi");
        let want = "payee 1: a transparent address cannot receive a memo";
        assert_eq!(refused(&format!("zcash:{tex}?memo={memo}"), "test"), want);
        let second = format!("zcash:?address={shielded}&address.1={tex}&memo.1={memo}");
        assert_eq!(refused(&second, "test"), want.replace("payee 1", "payee 2"));
        assert_eq!(make_err(json!([{"to": tex, "memo": "hi"}])), want);
    }

    #[test]
    fn text_that_is_not_a_request_is_refused() {
        let to = ua(1, TEST);
        let garbage = [
            "", "hello", "zcash", "zcash:hello", "ZCASH:x", "zcash:?amount=x", "zcash:🙂",
            "zcash:?address=x&amount=1", "zcash:?address=x&&", "zcash:?address",
        ];
        let tails = ["?req-x=1", "&amount=1", "?amount=1,5", "?amount=-1", "?amount=1.123456789"];
        let with_address = tails.map(|q| format!("zcash:{to}{q}"));
        for text in garbage.map(String::from).into_iter().chain(with_address) {
            assert_eq!(refused(&text, "test"), FIXED, "{text}");
        }
        assert_eq!(refused("zcash:", "test"), "the request has no payee");
        assert_eq!(refused("zcash:?", "test"), "the request has no payee");
        assert_eq!(refused("zcash:?amount=1", "test"), "payee 1: the address is missing");
    }

    #[test]
    fn a_label_and_a_message_are_decoded() {
        let to = ua(1, TEST);
        let q = "label=Alice%20B&message=Rent%20for%20%C3%A9t%C3%A9&x-extra=1";
        let p = &parse(&format!("zcash:{to}?{q}"), "test")[0];
        assert_eq!(p["label"], "Alice B");
        assert_eq!(p["message"], "Rent for été");
        assert_eq!(parse(&format!("zcash:{to}"), "test")[0]["label"], json!(null));
    }

    #[test]
    fn a_request_is_built_row_by_row() {
        let to = ua(1, TEST);
        assert_eq!(make_err(json!([])), "add at least one payee");
        assert!(make_err(json!({})).starts_with("bad payee list"));
        assert!(make_request("nope", "test").unwrap_err().starts_with("bad payee list"));
        assert_eq!(make_err(json!([{"amount": 1}])), "payee 1: missing address");
        let wrong = make_err(json!([{"to": to}, {"to": ua(1, MAIN)}]));
        assert_eq!(wrong, "payee 2: the address is not a testnet address");
        for amount in [json!(0), json!(1.5), json!("1"), json!(21e14 as u64 + 1), json!(-1)] {
            let err = make_err(json!([{"to": to, "amount": amount}]));
            assert_eq!(err, format!("payee 1: {AMOUNT_RULE}"), "{amount}");
        }
        let long = make_err(json!([{"to": to}, {"to": to, "memo": "a".repeat(513)}]));
        assert_eq!(long, "payee 2: the memo is 513 bytes long; the limit is 512");
        let nul = make_err(json!([{"to": to, "memo": "a\0b"}]));
        assert_eq!(nul, "payee 1: the memo cannot contain a null character");
        let message = make_err(json!([{"to": to, "message": 5}]));
        assert_eq!(message, "payee 1: the message must be text");
        let blank = json!([{"to": to, "memo": "", "message": ""}]);
        assert_eq!(make_request(&blank.to_string(), "test").unwrap(), format!("zcash:{to}"));
        assert_eq!(make_request("[]", "x").unwrap_err(), "network must be main or test");
    }
}
